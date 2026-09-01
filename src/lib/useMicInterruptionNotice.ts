/**
 * 🔴 v0.51 [CLIP-MUTED-SPAN-1] — **마이크 인터럽트 고지**(단일 배선 지점).
 *
 * 트랙이 `muted`가 된 사실을 **사용자에게 도달시키는** 것만 한다. 복구는 하지 않는다 —
 * 재획득은 사용자 제스처(`reconnectMic`)가 소유하고, `micLost` 래치도 세우지 않는다
 * ([IOS-5] · v0.50 r2 [CF-1]). `useClipFailureAlert`의 형제이고 구조도 같다
 * (PRINCIPLES §3 기능 격리: 본체에는 호출 한 줄, 이 파일을 지우면 기능이 통째로 사라진다).
 *
 * ## 왜 필요한가 — 2026-09-01 실측, 사용자가 받은 신호 3개가 전부 거짓이었다
 * ```
 * 07:46:34  mic_track_evt:mute                                    ← 마이크를 OS가 가져감
 * 07:46:35  bg_enter_snapshot:rec=recording,track=muted            ← 앱은 「녹음 중」
 * 07:46:54  beep_play:kind=commit,result=suspended,ctx=interrupted ← 확인음이 안 울렸다
 * 07:46:55  clip_too_small:5                                       ← 5바이트
 * ```
 * 그 시간 절전 화면은 **「음성 입력은 계속됩니다」** 를 띄우고 있었다.
 *
 * ## 세 통로 중 둘은 이미 죽어 있다 — 그래서 화면에 건다
 *  · 👂 **소리** — 확인음이 `suspended`다. 그 순간 TTS를 큐잉하면 **들리지도 않고** 한참 뒤
 *    엉뚱한 자리에서 터진다. 👉 **소리는 회복된 뒤에만 쓴다**(아래 ③).
 *  · 📳 **햅틱** — iOS Safari에 `navigator.vibrate`가 없다. 통로 자체가 없다.
 *  · 👁 **화면** — 유일하게 살아 있다. 그래서 ①문구를 실상태로 바꾸고 ②오래 끌면 화면을 연다.
 *
 * ## 하는 일 셋
 *  ① muted 전이를 스토어에 반영 → 절전 화면·홀드 문구가 **실상태를 말한다**(문구 SSOT는 각 컴포넌트).
 *  ② muted가 `MIC_INTERRUPT_BLACKOUT_RELEASE_MS` 넘게 이어지면 **절전 화면을 자동 해제**한다.
 *  ③ 회복(unmute) 직후, **그 구간에 실제로 증거를 잃었을 때만** 한 문장 말한다.
 */
import { useEffect, useRef } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { subscribeMicMuted } from './micInterruption';
import { MIC_INTERRUPT_RECOVERED_TTS } from './voicePrompts';
import type { ClipHealth } from './clipHealth';
import type { logger } from './logger';

type LogCell = (entry: Omit<Parameters<typeof logger.log>[0], 'sessionId'>) => void;

/** 🔴 이 시간을 넘겨 muted가 이어지면 절전 화면을 자동으로 연다 (민구 확정 2026-09-01 ①A).
 *
 *  ## 왜 즉시가 아닌가
 *  짧은 인터럽트(알림음·시스템 사운드)는 **기다리면 저절로 풀린다.** 거기에 화면을 켜면
 *  얻는 것 없이 배터리만 쓰고, 밭에서는 **장갑 낀 손으로 2초 홀드를 다시 해야 한다**
 *  (`BlackoutOverlay` 해제 계약). 오탐 1건의 대가가 그만큼 크다.
 *
 *  ## 왜 3초인가 — 그리고 **이 값을 상수로 노출하는 이유**
 *  2026-09-01 폐기 세션의 인터럽트는 최소 **41초**였다(`foreground_return:bg_s=41`).
 *  즉 실제 사고 구간은 3초를 한참 넘고, 3초는 「알림음」과 「전화」를 가르는 자리다.
 *  🔴 다만 이건 **실측 1건에서 고른 값**이지 최적화된 값이 아니다. 다음 회차가
 *  `mic_interrupt:off:*:ms=<N>` 분포를 보고 조정할 수 있게 **매직넘버로 묻지 않는다**
 *  (민구 지시 2026-09-01). */
export const MIC_INTERRUPT_BLACKOUT_RELEASE_MS = 3000;

export interface MicInterruptionNoticeDeps {
  /** 구간 중 증거를 실제로 잃었는지 판정할 장부. 세션 결산과 **같은 장부**여야 한다 —
   *  사본을 만들면 「고지는 나갔는데 결산엔 없다」가 생긴다. */
  clipHealth: ClipHealth;
  say: (text: string, interrupt?: boolean) => Promise<boolean>;
  logCell: LogCell;
}

export function useMicInterruptionNotice({ clipHealth, say, logCell }: MicInterruptionNoticeDeps): void {
  // 최신 참조를 ref로 잡아 effect deps를 비운다 — 구독은 **마운트당 한 번**이어야 한다.
  // deps에 함수를 넣으면 호출부의 인라인 화살표마다 재구독되고, 그때 타이머가 조용히 유실된다.
  const depsRef = useRef({ clipHealth, say, logCell });
  depsRef.current = { clipHealth, say, logCell };

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    /** 이 muted **구간** 시작 시점의 unreliable 누적. 회복 시 증가분이 곧 「이 구간에 잃은 증거」다. */
    let unreliableAtEnter = 0;

    const clearTimer = () => {
      if (timer !== null) { clearTimeout(timer); timer = null; }
    };

    const onMuted = (muted: boolean) => {
      const { clipHealth: health, say: speak, logCell: log } = depsRef.current;
      useSessionStore.getState().setMicInterrupted(muted);

      if (muted) {
        unreliableAtEnter = health.summary().unreliable;
        clearTimer();
        // 🔴 **구간당 정확히 한 번만 발화한다.** 타이머를 재무장하지 않으므로, 사용자가 화면을
        //   다시 끄고 같은 인터럽트가 계속돼도 **다시 켜지 않는다.** 켜고/꺼지고를 반복하는 것이
        //   이 기능의 최악 형상이다(민구 지시 2026-09-01).
        timer = setTimeout(() => {
          timer = null;
          const st = useSessionStore.getState();
          // 🔑 **안 보이는 화면은 켜지 않는다.** 앱이 백그라운드면(전화 화면이 위에 있다) 절전을
          //   풀어도 사용자에게 도달하지 않고 배터리만 쓴다. 복귀 시점의 판정은
          //   `onForegroundReturn`의 `mic_track:muted` 경로가 이미 남긴다.
          if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
            log({ type: 'clip', extra: 'mic_muted_blackout:skipped=hidden' });
            return;
          }
          if (!st.blackout) {
            // 절전 중이 아니면 열 화면이 없다 — 문구 전환(①)이 이미 사실을 말하고 있다.
            log({ type: 'clip', extra: 'mic_muted_blackout:skipped=no_blackout' });
            return;
          }
          st.setBlackout(false);
          // 다음 회차가 **오탐률을 잴 수 있어야 한다**(민구 지시): 이 이벤트 수 대비
          // `mic_interrupt:off:*:ms=` 분포가 곧 「켤 만했나」의 답이다.
          log({ type: 'clip', extra: 'mic_muted_blackout:released' });
        }, MIC_INTERRUPT_BLACKOUT_RELEASE_MS);
        return;
      }

      // ── 회복(unmute) ──
      clearTimer();
      const lost = health.summary().unreliable - unreliableAtEnter;
      unreliableAtEnter = 0;
      // 🔴 **증거를 잃었을 때만 말한다.** 아무 클립도 안 걸친 인터럽트(대기 중 전화)는 사용자가
      //   알 필요가 없다 — 현장에서 무의미한 발화는 그 자체가 방해다(고지 피로).
      if (lost <= 0) return;
      log({ type: 'clip', extra: `mic_interrupt_notice:lost=${lost}` });
      // interrupt:false — 진행 중 echo(방금 커밋한 값의 되읽기)를 끊지 않는다.
      //   `useClipFailureAlert`와 같은 판단이고, 같은 이유다.
      void speak(MIC_INTERRUPT_RECOVERED_TTS, false);
    };

    const unsubscribe = subscribeMicMuted(onMuted);
    return () => { unsubscribe(); clearTimer(); };
  }, []);
}
