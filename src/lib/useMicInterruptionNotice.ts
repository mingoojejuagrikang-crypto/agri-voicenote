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
 *  ③ 회복(unmute) 뒤, **그 구간에 실제로 증거를 잃었을 때만** 한 문장 말한다.
 *     🔴 「잃었다」는 `unreliable`(파일은 남았는데 못 믿는다) **+ `mutedFailed`**(파일조차
 *     안 남았다) 둘 다다 — 실측 사고는 **후자뿐**이었고, 그래서 v0.51 초판은 침묵했다.
 *
 * ## 🔴 v0.51.1 ⓓ — 판정 「시점」은 걸친 클립이 해소된 **뒤**다 (2026-09-02 실기기 1차 · 민구 결정 (a))
 * 정식 v0.51.0의 unmute 핸들러는 **즉시** 증가분을 봤다. 그런데 걸친 클립의 증거
 * (`recordUnreliable()`·`recordFailure(mutedSpan)`)는 **클립이 닫힐 때**(`useValueCommit`) 장부에
 * 오른다. 실측(`sess_1788316707658`) 2건 모두 클립이 unmute **+11.3s · +8.0s 뒤** 닫혔다:
 * ```
 * 11:53:32.941 clip_started                                        ← 클립 열림(14행 횡경)
 * 11:53:35.331 mic_track_evt:mute · mic_interrupt:on:evt
 * 11:53:40.401 mic_track_evt:unmute · mic_interrupt:off:evt:ms=5070  ← 여기서 판정 → lost=0 → 침묵
 * 11:53:51.653 clip_unreliable:muted                                ← 증거는 여기. 판정은 이미 끝났다
 * ```
 * 값을 말하려고 듣는 도중에 인터럽트가 오는 형상 = **이 앱의 기본 형상**이라, 즉시 판정은 항상 이렇게
 * 된다. 민구 결정 (a): **unreliable이면 무조건 고지** — 회복 후 발화가 담겼든 아니든, 절전 여부와 무관.
 *
 * **규칙(둘 다여야 유예다):** unmute 시점에 ⓐ 증가분이 0이고 **그리고** ⓑ 걸친 클립이 아직 장부에
 * 오를 수 있으면 — 가장 최근 슬롯이 muted 구간에 걸쳤고 **결과가 아직 커밋 경로에 전달되지 않았거나**
 * (`hasMutedClipOpen` = `AudioRecorder.hasOpenMutedClip`), 전달됐지만 **커밋 경로가 정산 중**이면
 * (`clipHealth.hasMutedClipInFlight`) — 판정을 **유예**하고, 그 클립의 증거가 장부에 오르는 순간
 * (`clipHealth.onMutedEvidence`)에 판정한다. 🔴 r2(콜드 리뷰 P2-1): r1은 ⓑ를 「슬롯이 `sawMuted`」로만
 * 봐서 **이미 계수된** muted 슬롯이 다음 클립 전까지 남아 클립 없는 인터럽트를 헛유예시켰다(ⓙ′).
 * 「이미 판정된 슬롯」을 슬롯 정체로 기억하는 방식은 쓰지 않는다 — 전달·정산 **상태**로만 가른다(ⓛ′).
 *  · ⓐ가 아니면(이미 잃은 게 있다) **즉시** 말한다. 🔴 「열린 muted 클립이 있으면 무조건 유예」로
 *    짜면 안 된다 — mute 중 커밋이 일어나면 걸친 클립은 unmute **전에** 닫히고, **다음 클립이 muted
 *    상태로 열려 있다**(오라클 ⓕ·ⓗ의 형상). 그때 유예하면 이미 확정된 손실을 다음 커밋까지
 *    (영영일 수도) 안 말한다.
 *  · ⓑ가 아니면 종전 즉시 판정 그대로다(클립 없는 인터럽트 = 대기 중 전화 = 무발화 유지 · G1 `skipped`).
 *
 * **구간당 1회 · 유예 중 새 구간:** `pendingVerdict`는 원샷이고 진입 기준선은 **첫 구간 것을 유지**한다
 * (유예 = 「기준선 고정」 한 규칙. 구간 사이에 닫힌 증거는 `onMutedEvidence`가 그 자리에서 소비하므로
 * 다시 찍어도 값은 같다 — 규칙을 둘로 두면 판독이 두 갈래가 된다). 두 구간에 걸친
 * 클립 하나 = 고지 **1회**다. 클립이 muted **도중에** 해소되면 말하지 않고 pending을 유지한다(그 순간
 * 오디오 출력이 죽어 있다 — ⓕ·ⓗ 계약) → 다음 unmute가 증가분>0을 보고 즉시 판정해 소비한다.
 * 절전 자동 해제 타이머(②)는 종전대로 구간마다 무장한다 — 유예와 무관하다.
 *
 * **폐기:** 유예가 풀리지 않은 채 세션이 끝나거나 언마운트되면 `mic_interrupt_notice:dropped:<reason>`
 * 1줄을 남기고 버린다. 다음 세션으로 새면 `clipHealth.reset()` 뒤 기준선이 낡아 진짜 손실에서 Δ≤0 →
 * 침묵이 재발하므로 **세션 경계에서 반드시** 버린다(`dropPendingVerdict('session_end')` — 호출 위치
 * 계약은 핸들 주석).
 * 🔴 **판독 규칙(r2 · 콜드 리뷰 P2-1/P2-2):** `deferred` → `dropped:session_end`는 **「유예가 장부 증거
 * 없이 세션을 넘겼다」**는 뜻이지 「종료 시 클립이 열려 있었다」는 뜻이 **아니다.** 걸친 클립이 장부에
 * 오르지 않는 경로가 여럿이다 — 클립 미닫힘 **또는** 재질문 재시작 절단(`startClip`이 prev를
 * `resolveStop` 없이 stop → 결과가 아무 데도 안 간다) · `clip_stale_pending` · `clip_save_failed`. 전부
 * 같은 줄로 합쳐진다. 고지 누락은 아니다 — 장부에 안 오른 클립은 민구 결정 (a)의 「unreliable」이 아니고
 * 결산에도 없다(재질문 클립은 버려지고 다음 클립이 증거다).
 *
 * **판독 불변식(로그):** `mic_interrupt:off` 1건당 unmute 시점에 `mic_interrupt_notice:` **정확히 1줄**
 * (`lost=…` 판정 · `skipped,lost=…` G1 · `deferred`). 유예는 그 뒤 **첫 판정 줄**(`lost=…`·`skipped,…`)
 * 또는 `dropped:<reason>`로 종결된다 — 그 판정 줄이 **다음 unmute의 줄을 겸할 수 있다**(유예 중 다음
 * 구간이 클립 없이 끝나면 그 unmute의 `skipped`가 앞 유예의 종결이다). 기존 `lost=` 접두 판독은 그대로다.
 */
import { useEffect, useRef } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { isMicMuted, subscribeMicMuted } from './micInterruption';
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
 *  (민구 지시 2026-09-01). 09-02 실기기 1차(표본 n=3 전부 ≥5초 · <3초 표본 0)에서 **유지**로 판정. */
export const MIC_INTERRUPT_BLACKOUT_RELEASE_MS = 3000;

export interface MicInterruptionNoticeDeps {
  /** 구간 중 증거를 실제로 잃었는지 판정할 장부. 세션 결산과 **같은 장부**여야 한다 —
   *  사본을 만들면 「고지는 나갔는데 결산엔 없다」가 생긴다.
   *  🔴 v0.51.1 — `onMutedEvidence` 구독도 이 장부에 건다. 마운트 동안 **같은 인스턴스**여야 한다
   *  (호출부는 `useRef`로 고정한다 — 바꿔 끼우면 구독이 옛 장부에 남아 유예가 영영 안 풀린다). */
  clipHealth: ClipHealth;
  /** 🔴 v0.51.1 ⓓ — unmute 시점에 「가장 최근 클립 슬롯이 muted 구간에 걸쳤고 결과가 아직 커밋 경로에
   *  전달되지 않았는가」(관찰 전용 — `AudioRecorder.hasOpenMutedClip`). 증가분이 0일 때 판정을 유예할지
   *  가르는 두 조건 중 하나다(다른 하나는 장부의 `hasMutedClipInFlight`). 레코더가 없으면 false
   *  (= 클립 없는 인터럽트 → 즉시 판정). */
  hasMutedClipOpen: () => boolean;
  say: (text: string, interrupt?: boolean) => Promise<boolean>;
  logCell: LogCell;
}

/** 본체(`useVoiceSession`)가 세션 경계에서 부르는 손잡이. identity는 마운트 동안 고정이다
 *  (`stop`이 `useCallback`에 잡는다). */
export interface MicInterruptionNoticeHandle {
  /** 유예 중인 회복 판정을 폐기한다(있을 때만 `mic_interrupt_notice:dropped:session_end` 1줄).
   *  🔴 레코더 `dispose()` **뒤**에 불러라 — muted 상태로 세션을 끝내면 dispose의 detach가 unmute
   *  콜백을 만들고, 그 순간 활성 슬롯의 `sawMuted`가 아직 살아 있어 새 유예가 생길 수 있다. */
  dropPendingVerdict: (reason: 'session_end') => void;
}

type PendingDropReason = 'session_end' | 'unmount';

export function useMicInterruptionNotice(
  { clipHealth, hasMutedClipOpen, say, logCell }: MicInterruptionNoticeDeps,
): MicInterruptionNoticeHandle {
  // 최신 참조를 ref로 잡아 effect deps를 비운다 — 구독은 **마운트당 한 번**이어야 한다.
  // deps에 함수를 넣으면 호출부의 인라인 화살표마다 재구독되고, 그때 타이머가 조용히 유실된다.
  const depsRef = useRef({ clipHealth, hasMutedClipOpen, say, logCell });
  depsRef.current = { clipHealth, hasMutedClipOpen, say, logCell };
  // effect 안의 폐기 함수를 밖으로 내는 통로. 핸들 자체는 ref로 identity를 고정한다.
  const dropRef = useRef<((reason: PendingDropReason) => void) | null>(null);
  const handleRef = useRef<MicInterruptionNoticeHandle>({
    dropPendingVerdict: (reason) => { dropRef.current?.(reason); },
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    /** 이 muted **구간** 시작 시점의 누적치. 회복 시 증가분이 곧 「이 구간에 잃은 증거」다.
     *
     *  🔴 v0.51 r2 [P1-2] — **두 칸을 다 본다.** 종전에는 `unreliable`만 봤는데, 2026-09-01
     *  실측 사고(`sess_1788216390429`)에서 죽은 클립 3건은 **전부 `failed` 경로**였다
     *  (`clip_too_small:5`×2 + `clip_empty`×1). 그래서 `unreliable=0` → `lost=0` →
     *  **가장 크게 잃은 형상에서 정확히 아무 말도 안 했다**(2026-09-02 콜드 리뷰 [P1-2] 실측).
     *
     *  🔑 「증거를 잃었다」는 **두 가지 모습**으로 온다:
     *   · `unreliable` — 파일은 남았는데 muted 구간에 걸쳐 **믿을 수 없다**
     *   · `mutedFailed` — muted 구간에 걸쳤고 **파일조차 안 남았다**(`failed`의 부분집합)
     *  사용자에게는 둘 다 「그동안의 음성 기록은 확인이 필요하다」로 같다. 회계에서 칸을 나눈
     *  이유(`recordUnreliable` 주석)와 **고지에서 합치는 이유는 다른 축**이다 —
     *  전자는 「복구가 필요한가」, 후자는 「사용자에게 말할 것이 있는가」다.
     *
     *  🔴 v0.51.1 ⓓ — 유예 중(`pendingVerdict`)에는 새 구간이 와도 **다시 찍지 않는다**(헤더 규칙). */
    let unreliableAtEnter = 0;
    let mutedFailedAtEnter = 0;
    /** 🔴 v0.51.1 ⓓ — 회복 판정이 「걸친 클립 해소」를 기다리는 중인가(원샷). */
    let pendingVerdict = false;

    const clearTimer = () => {
      if (timer !== null) { clearTimeout(timer); timer = null; }
    };

    /** 회복 판정 **1회** — 증가분을 계산해 로그 1줄을 남기고, 잃었으면 한 문장 말한다.
     *  원샷은 호출자가 보장한다(`pendingVerdict`를 먼저 내리고 부른다). */
    const verdict = () => {
      const { clipHealth: health, say: speak, logCell: log } = depsRef.current;
      const exit = health.summary();
      const unrel = exit.unreliable - unreliableAtEnter;
      const fail = exit.mutedFailed - mutedFailedAtEnter;
      const lost = unrel + fail;
      unreliableAtEnter = 0;
      mutedFailedAtEnter = 0;
      if (lost <= 0) {
        // 🔴 **증거를 잃었을 때만 말한다.** 아무 클립도 안 걸친 인터럽트(대기 중 전화)는 사용자가
        //   알 필요가 없다 — 현장에서 무의미한 발화는 그 자체가 방해다(고지 피로).
        // G1(v0.51.1) — 그래도 **줄은 남긴다.** 종전엔 여기서 조용히 끝나 「판정이 돌았는데 0」과
        //   「판정이 안 돌았다」를 로그로 못 갈랐다(09-02 판독 §5 G1). 값은 계산값 그대로다 —
        //   음수면 기준선이 세션 경계를 넘었다는 뜻이라 그 자체가 정보다. `lost=` 토큰은 그대로.
        log({ type: 'clip', extra: `mic_interrupt_notice:skipped,lost=${lost},unrel=${unrel},fail=${fail}` });
        return;
      }
      // 🔑 **내역을 함께 남긴다**(v0.51 r2 [P1-2]): 실기기 판정에서 민구가 고지를 들었을 때,
      //   다음 회차가 「실패 경로로 잡혔나 unreliable로 잡혔나」를 이 한 줄로 갈라야 한다.
      //   `lost=` 접두는 그대로라 기존 판독이 안 깨진다.
      log({ type: 'clip', extra: `mic_interrupt_notice:lost=${lost},unrel=${unrel},fail=${fail}` });
      // interrupt:false — 진행 중 echo(방금 커밋한 값의 되읽기)를 끊지 않는다.
      //   `useClipFailureAlert`와 같은 판단이고, 같은 이유다.
      void speak(MIC_INTERRUPT_RECOVERED_TTS, false);
    };

    const onMuted = (muted: boolean) => {
      const { clipHealth: health, hasMutedClipOpen: mutedClipOpen, logCell: log } = depsRef.current;
      const st = useSessionStore.getState();
      st.setMicInterrupted(muted);
      // G2(v0.51.1) — 문구 전환의 순간 사용자가 보고 있던 화면. 종전엔 이 전이가 무로그라 실기기
      //   판정 ⓑ(절전 화면 문구가 실제로 바뀌었나)를 로그로는 영구히 못 닫았다(09-02 판독 §5 G2).
      //   전이당 1줄이라 링버퍼 부담 = 인터럽트 수 × 2.
      log({
        type: 'clip',
        extra: `mic_interrupt_ui:muted=${muted ? 1 : 0},blackout=${st.blackout ? 1 : 0},hold=${st.heroHolding ? 1 : 0}`,
      });

      if (muted) {
        // 유예 중이면 기준선을 **유지**한다(헤더 「유예 중 새 구간」 — 유예 = 기준선 고정). 구간 사이에
        //   닫힌 증거는 이미 `onMutedEvidence`가 소비했으므로 다시 찍어도 값은 같다 — 규칙을 하나로 둔다.
        if (!pendingVerdict) {
          const enter = health.summary();
          unreliableAtEnter = enter.unreliable;
          mutedFailedAtEnter = enter.mutedFailed;
        }
        clearTimer();
        // 🔴 **구간당 정확히 한 번만 발화한다.** 타이머를 재무장하지 않으므로, 사용자가 화면을
        //   다시 끄고 같은 인터럽트가 계속돼도 **다시 켜지 않는다.** 켜고/꺼지고를 반복하는 것이
        //   이 기능의 최악 형상이다(민구 지시 2026-09-01).
        timer = setTimeout(() => {
          timer = null;
          const now = useSessionStore.getState();
          // 🔑 **안 보이는 화면은 켜지 않는다.** 앱이 백그라운드면(전화 화면이 위에 있다) 절전을
          //   풀어도 사용자에게 도달하지 않고 배터리만 쓴다. 복귀 시점의 판정은
          //   `onForegroundReturn`의 `mic_track:muted` 경로가 이미 남긴다.
          if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
            log({ type: 'clip', extra: 'mic_muted_blackout:skipped=hidden' });
            return;
          }
          if (!now.blackout) {
            // 절전 중이 아니면 열 화면이 없다 — 문구 전환(①)이 이미 사실을 말하고 있다.
            log({ type: 'clip', extra: 'mic_muted_blackout:skipped=no_blackout' });
            return;
          }
          now.setBlackout(false);
          // 다음 회차가 **오탐률을 잴 수 있어야 한다**(민구 지시): 이 이벤트 수 대비
          // `mic_interrupt:off:*:ms=` 분포가 곧 「켤 만했나」의 답이다.
          log({ type: 'clip', extra: 'mic_muted_blackout:released' });
        }, MIC_INTERRUPT_BLACKOUT_RELEASE_MS);
        return;
      }

      // ── 회복(unmute) ──
      clearTimer();
      // 🔴 v0.51.1 ⓓ — 유예 조건은 **둘 다**다(헤더 규칙): 아직 잃은 게 0이고 && 걸친 클립이 열려 있다.
      //   잃은 게 이미 있으면 지금 말한다 — 그 뒤에 열린 muted 클립이 하나 더 닫혀도 이 구간의 고지는
      //   끝났다(구간당 1회). 걸친 클립이 없으면 종전 즉시 판정(G1 `skipped`)이다.
      const now = health.summary();
      const lostNow = (now.unreliable - unreliableAtEnter) + (now.mutedFailed - mutedFailedAtEnter);
      // 「걸친 클립이 아직 장부에 오를 수 있다」 = 레코더가 결과를 아직 안 냈거나(X) · 냈는데 커밋 경로가
      //   정산 중(Y). r2: 이미 계수된 슬롯은 둘 다 false라 헛유예가 없다(ⓙ′) · 슬롯 정체는 보지 않는다(ⓛ′).
      if (lostNow <= 0 && (mutedClipOpen() || health.hasMutedClipInFlight())) {
        pendingVerdict = true;
        // 판독 불변식(헤더): unmute 시점에 정확히 1줄 — 유예도 「판정이 안 돌았다」와 갈라야 한다.
        log({ type: 'clip', extra: 'mic_interrupt_notice:deferred' });
        return;
      }
      pendingVerdict = false;
      verdict();
    };

    /** 🔴 v0.51.1 ⓓ — 걸친 클립의 증거가 장부에 오른 순간(`recordUnreliable`·`recordFailure(mutedSpan)`
     *  직후). 유예 중이 아니면 무시(즉시 판정으로 이미 소비된 구간의 후속 클립 — 구간당 1회). */
    const onMutedEvidence = () => {
      if (!pendingVerdict) return;
      // 🔴 muted 도중에는 말하지 않는다(그 순간 오디오 출력이 죽어 있다 — 헤더 ③·ⓕ·ⓗ 계약).
      //   pending은 그대로 두고, 이 구간의 unmute가 증가분>0을 보고 즉시 판정해 소비한다.
      if (isMicMuted()) return;
      pendingVerdict = false;
      verdict();
    };

    /** 유예 폐기(헤더 「폐기」). 유예가 없으면 아무것도 남기지 않는다. */
    const drop = (reason: PendingDropReason) => {
      if (!pendingVerdict) return;
      pendingVerdict = false;
      unreliableAtEnter = 0;
      mutedFailedAtEnter = 0;
      depsRef.current.logCell({ type: 'clip', extra: `mic_interrupt_notice:dropped:${reason}` });
    };
    dropRef.current = drop;

    const unsubscribeMuted = subscribeMicMuted(onMuted);
    // 🔴 마운트 시점의 장부에 건다 — 호출부가 `useRef`로 고정한 인스턴스다(deps 주석).
    const unsubscribeEvidence = depsRef.current.clipHealth.onMutedEvidence(onMutedEvidence);
    return () => {
      unsubscribeMuted();
      unsubscribeEvidence();
      clearTimer();
      drop('unmount');
      dropRef.current = null;
    };
  }, []);

  return handleRef.current;
}
