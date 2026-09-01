import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { T } from '../../tokens';
import { VOICE_TYPE } from './heroLayout';
import { useSessionStore } from '../../stores/sessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { logger } from '../../lib/logger';
import { holdAbort, holdStart, holdTtsSkipped } from '../../lib/logEvents';
import { speak } from '../../lib/speech';
import {
  HOLD_GRACE_BUDGET_MS, HOLD_GRACE_MS, HOLD_GRACE_RADIUS_PX,
  HOLD_TO_BLACKOUT_MS, REDUCED_STEPS, REDUCED_STEP_MS, prefersReducedMotion,
} from './heroHoldTiming';

/** 🔴 재수출 — 종전 이 파일이 `HOLD_TO_BLACKOUT_MS`를 export했다. 소비처가 없더라도
 *  (스펙은 [TEAMOPS-38]로 일부러 import하지 않는다) **공개 표면을 조용히 줄이지 않는다.** */
export { HOLD_TO_BLACKOUT_MS };

/**
 * v0.47.0 W7 — **중앙(히어로) 영역을 길게 눌러 검은 화면 모드에 들어간다.**
 * 🔴 **v0.51 H2 — 그 길이가 3초 → 2초가 됐다**(민구 재확정 08-31). 값은 `HOLD_TO_BLACKOUT_MS`가
 *    소유하고, 왜 바뀌었는지는 그 상수의 주석이 SSOT다. **이 헤더에 숫자를 다시 박지 마라.**
 *
 * 민구 원문(08-08): *"화면 중앙 히어로 영역을 사용자가 터치하면 안내음성/문구+진행바와 함께
 * 3초 유지하면 화면 끔. 화면 꺼진 상태에서 중앙 영역 잠깐이라도 터치하면 화면 켬으로 하자."*
 *
 * ## 왜 버튼이 아니라 홀드인가
 * t9 조사가 **전원 버튼 대체를 불가로 확정**했고(10분 백그라운드 캡이 세션을 정지시킨다),
 * 그 대안이던 「정지 버튼을 화면끔 버튼으로 전환」안은 충돌 5종(종료 3단계화·일시정지 중
 * 화면끔 소실·슬롯 오터치 레이스 등)을 낳았다. 홀드는 **버튼 4개를 그대로 두고** 진입만
 * 추가하므로 그 충돌이 전부 무효가 된다. 종전 유일 진입이던 음성 「화면」도 그대로 산다
 * (계측이 `src:voice`/`src:hold`로 둘을 가른다).
 *
 * ## 🔴 설계 계약 4가지 — 각각이 실패 모드 하나를 막는다
 *
 * ① **홀드 상태는 리렌더와 독립이다.** 진행 상태를 ref + rAF로 들고, 화면 갱신용 `progress`
 *    state는 **이 컴포넌트 안에만** 산다. `children`(히어로)은 prop으로 받은 **같은 엘리먼트
 *    객체**라 이 컴포넌트가 60fps로 리렌더돼도 React가 그 서브트리를 건너뛴다. 홀드 도중
 *    값이 확정돼 히어로가 리렌더돼도 rAF는 끊기지 않는다.
 *    ⚠️ 다만 **분기 전환(이상치·수정 카드)은 언마운트**라 홀드가 취소된다 — 의도한 동작이다.
 *    알람이 뜨는 순간은 사용자가 화면을 **봐야** 하는 순간이고, 그때 화면이 꺼지면 사고다.
 *
 * ② **`touchAction:'none'`** — iOS는 터치가 네이티브 스크롤로 전환되는 순간 `pointercancel`을
 *    쏜다(W3=FB-D와 같은 기전). 히어로 루트는 `overflowY:'auto'`라 **실제로 스크롤 컨테이너다**
 *    (브리핑의 "히어로는 비스크롤 영역"은 코드와 어긋난다 — `VoiceHero.tsx`의 height 계약 주석).
 *    이 표면에서 브라우저 팬을 아예 시작시키지 않는 것이 가장 확실한 방어다.
 *    🟡 대가: 히어로 안쪽을 손가락으로 스크롤할 수 없다. 히어로는 내용이 항상 중앙 정렬된
 *    표시 전용 영역이라 실사용 스크롤이 없다고 판단했다(`overflowY:auto`는 fit 높이 판정을
 *    위한 것이지 스크롤 UX를 위한 것이 아니다 — 그 주석이 근거).
 *
 * ③ 🔴 **안내 TTS는 「지연 · 취소 · 스킵」 3중으로 묶는다** (V-FIX1 — 이중 콜드 리뷰 blocker).
 *    종전 이 자리의 판단은 *"`speech.ts`의 뮤트가 알아서 막는다"* 였고 **틀렸다.**
 *
 *    🔑 **뮤트가 depth가 아니라 boolean이다**(`speech.ts:196` `ttsMuted: boolean` · `:620` `done()`이
 *    utterance마다 `unmuteForTts()` · `:658` `speak()`마다 `muteForTts()`). 그래서 **앞 발화가 끝나는
 *    순간 큐에 남은 발화가 있어도 뮤트가 풀린다** — 뒤이어 재생되는 홀드 안내는 STT가 그대로
 *    받아 적을 수 있고, `text` 컬럼이면 파서가 원문을 유효값으로 받아 **앱 자신의 안내 문구가
 *    시트 값으로 커밋된다.** Codex가 독립 큐 프로브로 재현했다. 데이터 무결성 사고다.
 *
 *    처방(구조 개선은 이월 — `speech.ts` 무수정 계약 유지):
 *    ⓐ **지연** — 발화를 `HOLD_TTS_DELAY_MS` 뒤로 민다. 스침 오터치에는 발화 자체가 없다.
 *    ⓑ **취소** — 조기 해제면 예약 타이머를 끈다(ⓐ와 결합하면 400ms 전 해제 = 발화 0건).
 *       개별 utterance 취소 수단이 `speech.ts`에 없으므로 **미발화 예약 취소**가 유일한 지렛대다.
 *    ⓒ **스킵** — 발화 시점에 다른 TTS가 **재생 중이거나 큐에 있으면 아예 큐잉하지 않는다.**
 *       위 boolean 뮤트 문제의 직접 차단축이다. 안내가 사라지는 대가는 **화면 문구+진행바가
 *       이미 대신 지고 있다**(민구가 요구한 피드백은 그 둘이 충족한다).
 *       🔴 조회는 Web API `speechSynthesis.speaking`/`.pending`만 쓴다 — `speech.ts`에 조회
 *       함수를 새로 만들지 않는다(그 파일 무수정 계약).
 *
 * ④ **진입은 커밋 지점이 하나다.** rAF가 1.0에 도달한 그 프레임에서만 `setBlackout(true)`이고,
 *    같은 프레임에 `firedRef`를 세워 다음 프레임의 중복 진입을 막는다.
 */



/** 🔴 안내 문구 SSOT — **화면과 TTS가 같은 배열에서 나온다**(ReaskCue/voicePrompts 계보 · FB#4).
 *  화면은 두 줄로, TTS는 공백으로 이어 한 문장으로 읽는다 — **글자는 완전히 같다.**
 *  ⚠️ 문구를 고칠 때 한쪽만 고치지 못하게 하려고 배열 하나로 묶었다(V-FIX2가 고친 것이
 *  정확히 «두 상수가 따로 놀아 시각·청각이 갈렸다»는 결함이다). */
const HOLD_LINE_ACTION = '계속 누르면 화면을 끕니다.';
const HOLD_LINES_OK = [HOLD_LINE_ACTION, '음성 입력은 계속됩니다.'] as const;
/** 🔴 v0.51 [CLIP-MUTED-SPAN-1] — **끄려는 그 순간 마이크가 멈춰 있으면 그 약속은 거짓이다.**
 *  화면을 끄는 것은 「소리는 계속 담긴다」는 믿음 위에서 하는 행동인데, 트랙이 `muted`면
 *  담기는 것이 없다(2026-09-01: 그 구간 클립이 5바이트였다). 여기서 사실을 말해야
 *  사용자가 **끌지 말지를 스스로 고른다** — 화면을 끈 뒤에 알려주는 것보다 낫다. */
const HOLD_LINES_MIC_OFF = [HOLD_LINE_ACTION, '⚠ 마이크가 멈춰 지금은 녹음되지 않습니다.'] as const;
/** 상태 → 문구. **분기는 여기 하나다**(화면·TTS·aria-label이 각자 고르면 갈린다 — V-FIX2). */
function holdLines(micInterrupted: boolean): readonly string[] {
  return micInterrupted ? HOLD_LINES_MIC_OFF : HOLD_LINES_OK;
}

/** 안내 발화를 미루는 시간(V-FIX1ⓐ). 스침·오터치는 여기 못 미친다 —
 *  **발화가 아예 없는 것**이 가장 확실한 에코 차단이다. */
const HOLD_TTS_DELAY_MS = 400;






export function HeroHoldToBlackout({ children }: { children: ReactNode }) {
  // v0.51 [CLIP-MUTED-SPAN-1] — 트랙 muted 여부(작성자는 `useMicInterruptionNotice` 하나).
  const micInterrupted = useSessionStore((st) => st.micInterrupted);
  const lines = holdLines(micInterrupted);
  const holdSentence = lines.join(' ');
  // 🔑 TTS 예약 콜백이 **발화 시점의** 문장을 읽게 한다 — 400ms 지연 동안 상태가 바뀔 수 있고,
  //    그때 예약 시점의 옛 문장을 말하면 화면과 귀가 갈린다(V-FIX2가 고친 그 결함의 재발).
  const holdSentenceRef = useRef(holdSentence);
  holdSentenceRef.current = holdSentence;
  const [progress, setProgress] = useState(0);
  /** 🔴 V-FIX3b(2차 재검증 신규 위험) — **표시 여부는 「눌렸는가」이지 「진행값이 0보다 큰가」가 아니다.**
   *
   *  종전엔 `holding = progress > 0` 파생이었다. V-FIX3이 reduce의 첫 갱신을 한 칸 뒤로 미루면서
   *  그 파생이 **즉시 피드백 계약을 깼다**: reduce 사용자는 홀드 시작 후 최대 `REDUCED_STEP_MS`
   *  동안 문구도 진행바도 못 보고, 400ms 안내 TTS가 **시각보다 먼저** 온다(소리는 나는데 화면은
   *  그대로). 🔴 H2로 그 칸이 750→500ms가 되면서 **간격은 줄었지만 계약은 그대로다** —
   *  400ms TTS보다 여전히 늦으므로 이 분리를 되돌리면 같은 결함이 되살아난다.
   *  🔑 두 계약이 서로를 갉은 것이라 **표시 트리거를 진행값에서 분리**하는 게 처방이다 —
   *  계단 간격도 홀드 시간 판정도 그대로 두고, «언제 나타나는가»만 포인터 다운 시점으로 되돌린다.
   *  ⚠️ 통상 모드에도 이득이 있다: 첫 rAF 프레임(≈16ms) 공백이 사라진다. */
  const [holding, setHolding] = useState(false);
  /** 진행 틱 핸들. V-FIX3 이후 **두 종류**다 — 통상은 rAF id, reduce에서는 타이머 id.
   *  어느 쪽으로 취소할지는 `tickIsRafRef`가 기억한다(숫자만으론 구분되지 않는다). */
  const tickHandleRef = useRef<number | null>(null);
  const tickIsRafRef = useRef(true);
  const startRef = useRef(0);
  const firedRef = useRef(false);

  /** V-FIX1ⓑ — 아직 발화하지 않은 안내 예약. 조기 해제가 이걸 끈다. */
  const ttsTimerRef = useRef<number | null>(null);

  /** 🔴 v0.51 H1 — **홀드를 시작한 그 포인터만 홀드를 끝낼 수 있다.**
   *
   *  ## 왜 이게 결함이었나 (비대칭이 근거다)
   *  같은 제스처를 다루는 두 컴포넌트 중 **한쪽에만 가드가 있었다**: `BlackoutOverlay`(켜기)는
   *  `pointerIdRef`로 남의 up을 걸러내는데(그쪽 `endHold`), 이 진입 쪽에는 없었다.
   *  `beginHold`는 `isPrimary` 가드로 둘째 손가락의 **시작**을 막지만, 둘째 손가락의
   *  **`pointerup`은 그대로 `stopHold`에 도달해** 첫 손가락의 홀드를 취소했다.
   *  즉 «엄지로 누른 채 다른 손가락으로 화면을 톡» 하면 진행바가 0으로 떨어졌다.
   *  설계 의도가 아니라 **누락**이다 — 대칭이 그 증거다.
   *
   *  ## 🔴 이번 증상의 원인은 **아니다** (정직하게 적는다)
   *  08-31 민구 확인: *"엄지 하나만 닿았다."* → 멀티터치 가설(C2)은 **폐기됐다.**
   *  이건 **「고쳐야 할 것」이지 「고치면 낫는 것」이 아니다.** 이 구분을 흐리면 다음 회차가
   *  «고쳤는데 그대로»를 만난다.
   *  🔑 그래도 지금 넣는 이유는 **H7′(유예 창)의 선행 조건**이기 때문이다: 가드가 없으면
   *  유예 로직이 *"방금 up한 것이 누구 것인가"* 를 **추가로** 판정해야 한다. 가드가 있으면
   *  추적할 포인터가 하나뿐이라 그 모호성이 애초에 생기지 않는다. */
  const pointerIdRef = useRef<number | null>(null);

  /** 🔴 v0.51 H7′ — 유예 중인 홀드. `null`이면 유예 없음.
   *
   *  🔴 **V-FIX3b의 계약을 확장한다(깨지 않는다).** 그 계약은 *"표시 트리거는 「눌렸는가」이지
   *  「진행값이 0보다 큰가」가 아니다"* 였다. 유예 중에는 **눌려 있지 않은데 표시는 남는다** —
   *  트리거가 「눌렸는가」에서 **「눌렸거나 유예 중인가」**로 넓어진 것이다.
   *  👉 그래서 유예 중 `holding`은 **true를 유지하고** `progress`는 **얼어붙는다.**
   *  ⚠️ 이 선택이 처방의 본체다: `holding`을 false로 떨어뜨렸다가 재접촉에 되살리면
   *  **민구가 제보한 바로 그 깜빡임**(0으로 갔다 다시 차오름)이 120ms짜리로 남는다.
   *  얼려 두면 사용자 눈에는 **아무 일도 일어나지 않는다** — 그게 목표다. */
  const graceRef = useRef<{ upAt: number; x: number; y: number; elapsedMs: number;
    reason: 'up' | 'cancel'; } | null>(null);
  /** 🔴 [P1-1] 이 홀드에서 유예가 **대신 채워 준 시간의 누계**(ms). 새 홀드에서 0으로 돌아간다.
   *  `HOLD_GRACE_BUDGET_MS`가 이 값의 상한이고, 그 상수 주석이 근거 SSOT다. */
  const graceSpentRef = useRef(0);
  /** 유예 만료 타이머. 🔴 언마운트에서 **반드시** 정리한다(안 하면 좀비 타이머가 사라진
   *  컴포넌트의 setState를 부른다 — 이 파일이 이미 tts·tick 두 개를 그렇게 정리하고 있다). */
  const graceTimerRef = useRef<number | null>(null);

  const cancelTick = useCallback(() => {
    if (tickHandleRef.current === null) return;
    if (tickIsRafRef.current) cancelAnimationFrame(tickHandleRef.current);
    else window.clearTimeout(tickHandleRef.current);
    tickHandleRef.current = null;
  }, []);

  /** 유예를 걷는다. `absorbed=true`면 재접촉이 이어받은 것이라 **취소로 세지 않는다** —
   *  그 흡수량이 곧 H7′의 효과 측정치다(재접촉 쪽에서 `resume=grace`로 따로 센다). */
  const clearGraceTimer = useCallback(() => {
    if (graceTimerRef.current !== null) {
      window.clearTimeout(graceTimerRef.current);
      graceTimerRef.current = null;
    }
  }, []);

  const stopHold = useCallback((
    e: PointerEvent<HTMLDivElement>,
    reason: 'up' | 'cancel' | 'leave',
  ) => {
    // 🔴 H1 — 남의 포인터가 낸 up/cancel/leave는 이 홀드를 끝내지 못한다.
    //    `BlackoutOverlay.endHold`에 있던 것과 **같은 형태**다(그쪽이 정답 형태였다).
    //    ⚠️ `null`일 때는 통과시킨다 — 다운 없는 잔여 up이 와도 취소할 홀드가 없어 무해하고,
    //    막으면 오히려 «시작을 놓친 홀드»가 영영 안 풀리는 반대쪽 구멍이 생긴다.
    if (pointerIdRef.current !== null && e.pointerId !== pointerIdRef.current) return;
    // 🔴 **도는 홀드가 없으면 아무것도 하지 않는다.** 두 가지를 동시에 막는 술어다:
    //    ① H3 — **완주한 홀드가 가짜 abort를 남기는 것.** 진입이 성사되는 순간 손가락은 아직
    //       화면에 있고 뒤이어 `pointerup`이 여기로 온다. 막지 않으면 모든 성공 홀드마다
    //       `screen_off` 뒤에 `screen_off_abort`가 붙어 **취소율이 통째로 오염된다** — 이 계측이
    //       존재하는 이유(C1″/X2 판별)를 정면으로 무너뜨린다.
    //    ② 🔴 H7′ — **방금 무장한 유예를 잔여 이벤트가 곧바로 걷어가는 것.** 포인터 캡처가
    //       걸린 상태에서 `pointerup` 뒤에 `pointerleave`가 **연달아** 온다(암묵 캡처 해제).
    //       그 두 번째 호출이 여기를 통과하면 유예가 무장 즉시 해제돼 **H7′가 조용히 무효**가
    //       된다. `tick`은 취소 시 `cancelTick()`으로 핸들을 비우므로, 두 번째 호출은 여기서 멈춘다.
    if (tickHandleRef.current === null) return;

    const atMs = performance.now() - startRef.current;
    cancelTick();
    if (ttsTimerRef.current !== null) {
      window.clearTimeout(ttsTimerRef.current);
      ttsTimerRef.current = null;
    }

    // 🔴 H7′ — `up`/`cancel`은 **즉시 리셋하지 않고 유예를 건다.** `leave`는 제외한다:
    //    손가락이 표면 밖으로 나간 것은 «끊김»이 아니라 «다른 데로 갔다»이고, 그건 새 홀드다.
    //    (캡처 때문에 leave는 사실상 up 뒤에만 오지만, 의미를 코드에 남긴다.)
    if (reason === 'up' || reason === 'cancel') {
      graceRef.current = {
        upAt: performance.now(),
        x: e.clientX, y: e.clientY,
        elapsedMs: atMs,
        reason,
      };
      // 진행값을 **얼린다** — `setProgress(0)`을 하지 않는 것이 이 처방의 본체다(위 `graceRef` 주석).
      //   `holding`도 true로 남겨 문구·진행바가 그대로 서 있게 한다.
      clearGraceTimer();
      graceTimerRef.current = window.setTimeout(() => {
        graceTimerRef.current = null;
        const g = graceRef.current;
        graceRef.current = null;
        pointerIdRef.current = null;
        setHolding(false);
        setProgress(0);
        // 유예가 만료됐다 = **진짜 취소**다. 여기서 비로소 센다(흡수된 것은 안 센다 —
        //   그 차이가 H7′가 얼마나 먹었는지의 측정치다).
        if (g) {
          logger.log({
            type: 'command',
            parsed: 'screen_off_abort',
            extra: holdAbort({ phase: 'screen_off', reason: g.reason, atMs: g.elapsedMs }),
          });
        }
      }, HOLD_GRACE_MS);
      return;
    }

    // `leave` — 종전대로 즉시 리셋.
    graceRef.current = null;
    clearGraceTimer();
    pointerIdRef.current = null;
    logger.log({
      type: 'command',
      parsed: 'screen_off_abort',
      extra: holdAbort({ phase: 'screen_off', reason, atMs }),
    });
    setHolding(false);
    setProgress(0);
  }, [cancelTick, clearGraceTimer]);

  // 언마운트 정리 — 남으면 히어로가 사라진 뒤에도 틱이 돌고, 최악의 경우 **화면이 안 보이는
  //   상태에서 blackout으로 진입**한다(분기 전환 = 홀드 취소 계약의 실효 지점이다).
  useEffect(() => () => {
    // 🔴 H3 — **언마운트도 취소다.** 분기 전환(이상치·수정 카드)이 홀드를 끊는 것은 «의도된 동작»
    //    이지만, 로그에서 그것이 사용자의 뗌과 구분되지 않으면 취소율 판정이 흐려진다.
    //    `reason:unmount`가 그 자리를 진다.
    //    술어가 둘인 이유: 홀드가 **도는 중**이거나 **유예 중**이면 둘 다 «살아 있던 홀드»다.
    if (tickHandleRef.current !== null || graceRef.current !== null) {
      const atMs = graceRef.current?.elapsedMs ?? (performance.now() - startRef.current);
      logger.log({
        type: 'command',
        parsed: 'screen_off_abort',
        extra: holdAbort({ phase: 'screen_off', reason: 'unmount', atMs }),
      });
    }
    cancelTick();
    // V-FIX1ⓑ — 언마운트(분기 전환)도 조기 해제다. 예약된 안내가 사라진 화면에서 발화하면
    //   그 문장이 그대로 STT 자기입력 후보가 된다.
    if (ttsTimerRef.current !== null) window.clearTimeout(ttsTimerRef.current);
    // 🔴 H7′ — **유예 타이머도 정리한다.** 안 하면 사라진 컴포넌트의 setState를 부르는
    //    좀비 타이머가 남는다(이 파일이 tick·tts를 이미 그렇게 정리하는 것과 같은 이유).
    if (graceTimerRef.current !== null) window.clearTimeout(graceTimerRef.current);
    graceRef.current = null;
  }, [cancelTick]);

  const beginHold = useCallback((e: PointerEvent<HTMLDivElement>) => {
    // 멀티터치·보조 버튼 무시. 이미 검은 화면이면 진입 자체가 무의미하다(오버레이가 위를 덮는다).
    if (!e.isPrimary || tickHandleRef.current !== null) return;
    if (useSessionStore.getState().blackout) return;
    // 🔴 포인터 캡처 — 손가락이 히어로 밖으로 밀려도 `pointerup`이 **이 요소로** 온다.
    //    없으면 경계에서 뗀 손가락이 취소를 못 보내 홀드가 떠 있는 채로 남는다.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 캡처 미지원 — rAF는 그대로 */ }

    // 🔴 H7′ — **유예를 이어받는가?** 조건 **셋을 전부** 만족할 때만이다:
    //    ㉠ 시간 — 직전 up/cancel으로부터 `HOLD_GRACE_MS` 안
    //    ㉡ 거리 — 직전 좌표에서 `HOLD_GRACE_RADIUS_PX` 안. 없으면 «뗐다가 화면 다른 데를 누른 것»
    //       까지 이어받아 의도치 않은 진입이 된다.
    //    ㉢ 🔴 **예산** — 이 홀드에서 유예가 대신 채운 시간의 누계가 `HOLD_GRACE_BUDGET_MS` 안.
    //       [P1-1] 독립 콜드 리뷰가 실증한 «연타로 홀드 조립»을 닫는 축이다. ㉠㉡만으로는
    //       조각 개수에 상한이 없어 2초를 100ms짜리 20조각으로 만들 수 있었다.
    const g = graceRef.current;
    const now = performance.now();
    const gapMs = g ? now - g.upAt : 0;
    const withinGrace = !!g
      && gapMs <= HOLD_GRACE_MS
      && Math.hypot(e.clientX - g.x, e.clientY - g.y) <= HOLD_GRACE_RADIUS_PX
      && graceSpentRef.current + gapMs <= HOLD_GRACE_BUDGET_MS;

    // 🔴 [P1-2] **유예를 버리기 전에 그 취소를 동기로 남긴다.**
    //    종전에는 `clearGraceTimer()`가 «아직 안 찍힌 abort»를 통째로 삼켰다 — 반경 밖 재접촉
    //    (그리고 이제 예산 초과 재접촉)에서 직전 홀드의 취소가 **로그에 한 줄도 안 남았다.**
    //    🔴 그 삼킴은 **한 방향으로만 편향된다**: `abort`만 줄고 `start`는 그대로라
    //    **H7′를 실제보다 잘 듣는 것처럼 보이게 한다.** 민구의 「H7′를 되돌릴까」 판단이
    //    정확히 그 비율로 내려지므로, 계측이 자기에게 유리하게 거짓말하는 형태였다.
    //    ⚠️ 이 abort는 바로 뒤 `screen_off_start`와 **같은 밀리초**에 찍힌다 — 판독 레인이
    //    「취소 후 재시작 간격 0」을 X2(iOS 재발행)로 오독하지 않게 `displaced`로 표시한다.
    if (g && !withinGrace) {
      logger.log({
        type: 'command',
        parsed: 'screen_off_abort',
        extra: holdAbort({ phase: 'screen_off', reason: g.reason, atMs: g.elapsedMs, displaced: true }),
      });
    }
    graceRef.current = null;
    clearGraceTimer();
    // 이어받으면 예산을 그만큼 쓰고, 새 홀드면 예산이 처음으로 돌아간다.
    graceSpentRef.current = withinGrace ? graceSpentRef.current + gapMs : 0;

    // 🔴 H1 — 이 홀드의 주인을 기억한다. 이 값이 `stopHold`의 가드를 무장시킨다.
    pointerIdRef.current = e.pointerId;
    firedRef.current = false;
    // 이어받으면 **누적 시간을 물려받는다** — 시작 시각을 그만큼 과거로 민다.
    //   ⚠️ `progress`를 직접 건드리지 않는다: 틱이 `startRef`에서 다시 계산하므로 값이 한 곳에서만
    //   결정된다(V-FIX3b가 지킨 «표시와 진행값의 분리»를 새 로직이 다시 흐리지 않게).
    startRef.current = withinGrace && g ? now - g.elapsedMs : now;
    // 🔴 H3 — **시작을 남긴다.** 이 이벤트가 이 묶음의 핵심이다: 「취소 직후 새 홀드가 얼마 만에
    //    시작됐는가」가 C1″(접촉 끊김)와 X2(iOS 재발행)를 가르는 **유일한** 신호다.
    //    abort만 있으면 두 가설이 로그에서 똑같이 보인다.
    //    🔑 `resume=grace`가 붙은 것은 **유예가 흡수한 왕복**이다 — 그 건수가 곧 H7′의 효과다
    //    (흡수된 왕복은 `abort`를 남기지 않으므로 이쪽으로만 셀 수 있다).
    logger.log({
      type: 'command', parsed: 'screen_off_start',
      extra: holdStart(withinGrace ? 'grace' : undefined),
    });
    // V-FIX3b — **누른 그 순간** 문구·진행바를 세운다. 진행값(계단)은 아래 틱이 채운다.
    //   유예를 이어받은 경우 `holding`은 이미 true고 progress도 얼어 있으므로 **깜빡임이 없다.**
    if (!withinGrace) setProgress(0);
    setHolding(true);
    // V-FIX1ⓐ+ⓒ — 400ms 뒤에, 그때 아무도 말하고 있지 않을 때만 발화한다.
    ttsTimerRef.current = window.setTimeout(() => {
      ttsTimerRef.current = null;
      const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
      if (synth && (synth.speaking || synth.pending)) {
        // 🔑 큐잉하지 않고 **버린다.** 뒤에 세우면 앞 발화 종료가 뮤트를 먼저 풀어(위 계약 ③)
        //    이 문장이 STT로 들어간다. 안내 손실은 화면 문구·진행바가 메운다.
        //    실패를 숨기지 않는다 — 얼마나 자주 버려지는지가 다음 회차의 판단 근거다.
        logger.log({ type: 'app', extra: holdTtsSkipped('tts_busy') });
        return;
      }
      void speak(holdSentenceRef.current, {
        interrupt: false, // 위 가드로 «자를 앞 발화»가 없는 상태다 — cancel 왕복을 아낀다
        rate: useSettingsStore.getState().ttsRate || 1.05,
      });
    }, HOLD_TTS_DELAY_MS);
    // V-FIX3 — reduce에서는 rAF 대신 저빈도 타이머로 4칸 계단을 그린다. **시간 판정은 불변이다.**
    const reduced = prefersReducedMotion();
    tickIsRafRef.current = !reduced;
    const schedule = () => {
      if (!reduced) { tickHandleRef.current = requestAnimationFrame(tick); return; }
      // 🔴 남은 시간으로 clamp한다 — 고정 간격으로만 밀면 마지막 틱이 홀드 시간을 지나쳐
      //    reduce 사용자만 **최대 한 칸 늦게** 진입한다(시간 판정 불변 계약 위반).
      const remaining = HOLD_TO_BLACKOUT_MS - (performance.now() - startRef.current);
      tickHandleRef.current = window.setTimeout(tick, Math.max(0, Math.min(REDUCED_STEP_MS, remaining)));
    };
    const tick = () => {
      const p = Math.min(1, (performance.now() - startRef.current) / HOLD_TO_BLACKOUT_MS);
      // reduce는 계단 — 타이머 지터로 0.26/0.49 같은 값이 새는 것을 막는다.
      //   🔴 칸 수는 `REDUCED_STEPS` 하나에서 온다(위 파생 상수 주석 — 종전엔 4가 두 곳에 박혔다).
      setProgress(reduced ? Math.round(p * REDUCED_STEPS) / REDUCED_STEPS : p);
      if (p >= 1) {
        tickHandleRef.current = null;
        if (firedRef.current) return;
        firedRef.current = true;
        // H1 — 완주로 홀드가 끝났다. 주인을 놓아준다(뒤따라올 up은 취소할 것이 없다).
        pointerIdRef.current = null;
        useSessionStore.getState().setBlackout(true);
        // 계측 — 음성 진입(`useVoiceSession.ts` `src:voice`)과 **같은 이벤트·같은 필드**로
        //   남기고 출처만 가른다. 새 이벤트 타입을 만들지 않는다(SOP-003 파서 계약).
        //   sessionId는 logger가 현재 세션 컨텍스트에서 자동 첨부한다(`logger.ts:189`).
        logger.log({ type: 'command', parsed: 'screen_off', extra: 'src:hold' });
        setProgress(0);
        setHolding(false);
        return;
      }
      schedule();
    };
    schedule();
  }, [clearGraceTimer]);

  return (
    <div
      data-testid="hero-hold-surface"
      onPointerDown={beginHold}
      // 🔴 H3 — 사유를 **핸들러 자리에서** 정한다. `stopHold` 안에서 추론할 수 없는 정보이고,
      //    `up`(사용자가 뗌) vs `cancel`(브라우저가 뺏음) vs `leave`(밖으로 나감)의 구분이
      //    C1″/X2 판별의 절반이다.
      onPointerUp={(e) => stopHold(e, 'up')}
      onPointerCancel={(e) => stopHold(e, 'cancel')}
      onPointerLeave={(e) => stopHold(e, 'leave')}
      style={{
        position: 'relative',
        width: '100%', height: '100%', minHeight: 0, minWidth: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        // 계약 ② — 브라우저 팬을 시작시키지 않는다(iOS pointercancel 차단).
        touchAction: 'none',
        // 길게 누르는 동안 iOS가 텍스트 선택·확대 메뉴를 띄우지 않게.
        userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
      }}
    >
      {children}
      {holding && (
        <div
          data-testid="hero-hold-cue"
          role="status"
          aria-label={holdSentence}
          style={{
            position: 'absolute', left: 0, right: 0, bottom: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
            // 히어로 값 위에 겹치므로 배경을 깔아 둘이 섞여 읽히지 않게 한다(알람 시트와 같은 판단).
            background: T.bg, padding: '8px 12px',
            pointerEvents: 'none', // 홀드 표면이 포인터를 계속 받아야 한다
          }}
        >
          <span
            data-testid="hero-hold-hint"
            style={{
              fontSize: VOICE_TYPE.caption,
              fontWeight: 800, color: T.textDim, letterSpacing: -0.2,
              // V-FIX2 — TTS와 **같은 문장 두 개**를 두 줄로 쓴다(줄바꿈은 표시 형식일 뿐
              //   글자는 동일하다). nowrap을 걷어야 두 줄이 온전히 보인다.
              textAlign: 'center', lineHeight: 1.35,
            }}
          >
            {lines.map((line) => (
              <span key={line} style={{ display: 'block' }}>{line}</span>
            ))}
          </span>
          {/* 차오르는 진행바 — 민구 지시의 "진행바". BlackoutOverlay의 차오르는 원과 같은 역할
              (*"피드백이 없으면 «왜 안 켜지지»가 된다"*)을 진입 쪽에서 맡는다. */}
          <div
            data-testid="hero-hold-track"
            style={{ width: '70%', height: 6, borderRadius: 3, background: T.line, overflow: 'hidden' }}
          >
            <div
              data-testid="hero-hold-fill"
              data-progress={progress.toFixed(3)}
              style={{ width: `${(progress * 100).toFixed(1)}%`, height: '100%', background: T.green }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
