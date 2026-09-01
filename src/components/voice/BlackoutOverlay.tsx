import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { VOICE_TYPE } from './heroLayout';
import { logger } from '../../lib/logger';
import { useSessionStore } from '../../stores/sessionStore';
import { holdAbort } from '../../lib/logEvents';

/**
 * v0.46.0 WP-F — **검은 화면 모드**(제보 F13② · 민구 R2 확정)
 *
 * 화면만 끄고 **음성 세션은 계속 돈다.** 장시간 현장 세션의 배터리·발열을 줄이는 것이 목적이고,
 * 부수적으로 **주머니 오터치를 막는다**(이 오버레이가 화면 전체를 덮으므로 아래 버튼에 터치가
 * 닿지 않는다 — 개별 버튼을 비활성화하지 않는다).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 **v0.47.0 r2 P6 — 해제가 「중앙 짧은 탭」에서 「중앙 2초 홀드」로 다시 바뀌었다** (민구 08-09).
 *
 *  민구 원문: *"화면을 끄기 위해 중앙 터치시 안내음과 함께 중앙 터치시 게이지는 올라가지만,
 *  정상적으로 화면이 꺼지진 않음. 손을 때는 순간 바로 검은 화면에서 복귀 됨. 터치를 끝내는 순간을
 *  재 터치로 하는게 아닐가 의심중. - 화면을 킬 때도 2초간 터치로 변경"*
 *
 *  ✅ **민구의 의심이 정확했다 — 로그가 기전을 특정한다.**
 *   `screen_off src:hold` 직후 300~700ms 만에 `screen_on src:tap`이 **10회 반복**됐다.
 *   진입 홀드(3초)가 완료되는 시점에 손가락은 **아직 화면에 있고**, 그때 오버레이가 마운트된다.
 *   손가락을 떼면 그 `pointerup`이 새로 생긴 중앙 히트존으로 떨어진다 —
 *   **끄기를 끝내는 동작이 그대로 켜기 탭이었다.**
 *
 *  ⏹ **08-08 W7 논증(「잠깐 탭」)이 어떻게 뒤집혔나** — 그 반전 근거를 남긴다.
 *   - W7은 08-05의 「0.9초 홀드」를 뒤집으며 *"오터치 방어를 **위치**로 옮긴다 — 중앙만 받고
 *     가장자리는 무시한다"* 고 했다. 그 판단 자체는 지금도 살아 있다(중앙 히트존은 그대로다).
 *   - 무너진 것은 **「탭」이라는 형태**다. 탭은 `pointerup` 하나로 성립하는데, 진입 제스처가
 *     끝나는 순간에 정확히 그 `pointerup`이 하나 남는다. **두 제스처가 같은 이벤트를 공유**하는
 *     한 위치 조건으로는 못 가른다 — 08-08 시점에는 진입 홀드가 막 도입돼 이 간섭이 안 보였다.
 *   - 👉 홀드는 `pointerdown` → 2초 유지 → 완료다. **다운이 없는 잔여 업은 구조적으로 무시된다**
 *     (조건문으로 거르는 게 아니라, 시작 이벤트가 없으면 아무것도 시작되지 않는다).
 *     민구가 요구한 「2초 터치」가 곧 이 버그의 처방이기도 하다.
 *   - 🔑 **대가는 되돌아온다**: 장갑 낀 손·급할 때의 복귀가 2초 느려진다. 08-08에 민구가 산
 *     그 즉시성을 08-09에 스스로 되판 것이다. 다음에 이 자리를 또 뒤집으려는 사람은
 *     **위 pointerup 공유 문제를 먼저 풀어야 한다** — 안 풀면 복귀 버그가 같이 돌아온다.
 *
 * ## 중앙 히트존 정의 (402×513 기준) — **W7 그대로 유지**
 * 뷰포트의 **가로 60% × 세로 50%**를 중앙 정렬한 사각형 = 402×513에서 **241×257px**.
 * 가장자리 여백은 좌우 각 80px · 상하 각 128px이다. 이 밖의 터치는 **아무 핸들러도 없다**
 * (무시가 기본값이지 조건문이 아니다 — 조건문은 언젠가 반대로 뒤집힌다).
 *
 * ⚠️ **하단 버튼을 비활성화하지 않는 이유**(민구가 내 주장을 약화시켰다):
 *    *"종료 버튼은 잘못 눌려도 확인 취소 버튼이 추가로 출력되고 있어."* → 종료는 2단계라
 *    우발 1회로 끝나지 않는다. 오버레이가 터치를 삼키는 것으로 충분하다.
 *
 * 🔴 **OLED 절전이 목적이므로 배경은 순수 검정(#000)이고 힌트는 최소 밝기다.**
 *    켜진 화소가 곧 전력이다 — 힌트를 밝게 하면 이 기능의 존재 이유가 줄어든다.
 *    👉 그래서 진행 표시를 **히어로(`HeroHoldToBlackout`)에서 복사하지 않았다.** 저쪽은
 *    `T.green` 채움 + `T.line` 트랙이라 이 계약과 정면으로 어긋난다.
 *
 * 🔑 **진행 표시는 rAF가 아니라 항상 저빈도 계단이다** — `RELEASE_STEP_MS` 간격 4칸.
 *    히어로는 통상 rAF / reduce 타이머의 **두 갈래**를 들고 `prefersReducedMotion()`을 조회하는데,
 *    여기서는 그 분기 자체가 없다. 한 수로 두 계약을 동시에 만족하기 때문이다:
 *      · **OLED** — 2초에 4번만 다시 그린다(180프레임 → 4프레임).
 *      · **reduced-motion** — 연속 애니메이션이 애초에 존재하지 않는다.
 *    분기가 없으면 «한쪽만 고쳐서 갈라지는» 실패 모드도 없고, 히어로의 로컬
 *    `prefersReducedMotion()`을 복제하지 않아도 된다(이중 기록 회피).
 *    ⚠️ V-FIX3b의 교훈은 지킨다: **표시 트리거는 「눌렸는가」이지 「진행값 > 0」이 아니다.**
 *    계단의 첫 칸은 500ms 뒤에 오므로, 파생으로 두면 그동안 아무 피드백도 없다.
 */

/** 중앙 히트존 비율(뷰포트 대비). 위 §중앙 히트존 정의가 이 두 수의 SSOT다. */
const CENTER_HIT_W = '60%';
const CENTER_HIT_H = '50%';

/** 🔴 민구 확정(08-09): *"화면을 킬 때도 2초간 터치로 변경"*.
 *  진입(3초)보다 짧다 — 켜기는 사용자가 **의도적으로 화면을 보려는** 동작이라 오터치 대가가
 *  진입 쪽(값이 날아간 것처럼 보인다)보다 작다.
 *  ⚠️ 스펙은 이 상수를 **일부러 import하지 않는다** — 두 스펙(`v0470-w7-hold-blackout`·
 *  `v0460-cr-blackout-escape`)이 [TEAMOPS-38](제품 상수 import 금지 — 제품이 값을 바꾸면 계약이
 *  스펙에 남아 오라클이 신호를 낸다) 관례로 리터럴 2000을 쓴다. 이 값을 바꾸려면 그 스펙들의
 *  리터럴도 **의도를 갖고** 함께 바꿔라. (r3 콜드 리뷰 §5 — 종전 주석 «스펙이 import한다»는
 *  허위였다. 다음 편집자가 그 말을 믿고 import를 추가하면 [TEAMOPS-38] 위반이 된다.) */
export const HOLD_TO_WAKE_MS = 2000;

/** 진행 계단 칸 수. 2000 / 4 = 500ms 간격. */
export const RELEASE_STEPS = 4;
/** 계단 간격(ms). `HOLD_TO_WAKE_MS`에서 파생 — 둘을 따로 적으면 갈라진다. */
export const RELEASE_STEP_MS = HOLD_TO_WAKE_MS / RELEASE_STEPS;

/** 🔴 안내 문구 SSOT — **화면과 aria-label이 같은 배열에서 나온다**(`HeroHoldToBlackout`의
 *  `HOLD_LINES` 선례 · V-FIX2가 고친 «두 상수가 따로 놀아 시각·청각이 갈렸다»는 결함).
 *  화면은 두 줄로, aria-label은 공백으로 이어 한 문장으로 읽는다 — 글자는 완전히 같다.
 *
 *  🔴 **v0.51 [CLIP-MUTED-SPAN-1] — 둘째 줄이 상태를 따른다.**
 *  2026-09-01 실기기: 마이크를 OS가 가져간(트랙 `muted`) 41초 동안 이 화면은
 *  **「음성 입력은 계속됩니다」** 를 띄우고 있었고, 그 시간에 나온 것은 5바이트 클립이었다.
 *  같은 순간 확인음은 `result=suspended`라 **소리로는 알릴 방법이 없었다** — 화면이 유일한
 *  통로인데 그 화면이 거짓을 말했다. 👉 **정상일 때만** 「계속됩니다」라고 말한다.
 *  ⚠️ 첫 줄(탈출 방법)은 상태와 무관하게 **항상 같다** — 갇힘 방지 계약은 마이크와 무관하다. */
const WAKE_LINE_ESCAPE = '가운데를 2초 누르면 화면이 켜집니다.';
const WAKE_LINES_OK = [WAKE_LINE_ESCAPE, '음성 입력은 계속됩니다.'] as const;
const WAKE_LINES_MIC_OFF = [WAKE_LINE_ESCAPE, '⚠ 마이크가 멈춰 지금은 녹음되지 않습니다.'] as const;
/** 상태 → 문구. **분기는 여기 하나다** — 화면·aria-label이 각자 고르면 반드시 갈린다. */
function wakeLines(micInterrupted: boolean): readonly string[] {
  return micInterrupted ? WAKE_LINES_MIC_OFF : WAKE_LINES_OK;
}

/** 고스트 클릭 삼킴 창(ms). **손가락을 뗀 시점부터** 센다(아래 §기준점 참조). */
const GHOST_SWALLOW_MS = 400;
/** 삼킴 리스너의 안전 상한(ms) — **포인터 소실 스톱로스**. `pointerup`도 `pointercancel`도
 *  영영 안 오는 경우(포인터 소실·시스템 제스처의 무통보 강탈)에만 발동한다.
 *
 *  🔴 v0.47.0 r3(콜드 리뷰 codex 5) — **2000ms에서 올리고 이름을 바꿨다.** 이 타이머는 무장
 *  시점(해제 2초 — 손가락이 **아직 눌린** 상태)부터 세므로, 종전 2000ms는 정상 장기 홀드
 *  (총 4초+)에서 `pointerup` **전에** 리스너를 전부 걷었다 — 뗀 뒤 첫 click이 하부 종료·
 *  일시정지로 그대로 샜다(이 차단막이 막으려던 바로 그 사고). «무제한 홀드 지원»과 유한
 *  상한은 시간만으로는 양립할 수 없다 — 눌린 채 조용한 손가락과 소실된 포인터는 이벤트로
 *  구분되지 않는다. 👉 **우선순위로 정한다**: 조기 발동의 대가는 세션 오조작(사고)이고,
 *  지연 발동의 대가는 소실 시 의도 탭 1회 삼킴(성가심 — §6과 같은 급, 그쪽도 low)이다.
 *  🔴 r4 — 그래서 **30초 제한 자체가 정식 계약이다**(승인: 민구 2026-08-09): 그 이상 홀드
 *  후 뗀 첫 탭은 통과할 수 있다. 30초는 어떤 현실적 wake 홀드보다 길어 정상 경로에서는
 *  사실상 발동하지 않고, 소실 시 사각지대도 유한하게 남는다.
 *  오라클: `v0470-w7-hold-blackout` ⑧-b — **종전 2초 상한의 복원**을 반증한다(현 30초
 *  상한의 실대기 오라클은 비용>가치라 두지 않는다 — 정책 승인으로 종결). */
const GHOST_SWALLOW_LOST_POINTER_MS = 30_000;

/** 해제 탭이 **아래 UI로 전파되지 않게** 한다(위험 축 ④).
 *
 *  🔴 왜 필요한가: 터치 한 번은 `pointerdown → pointerup → mousedown → mouseup → click`을
 *  순서대로 낸다. 우리가 오버레이를 걷으면 뒤따르는 **`click`은 그 자리에 있던 다른 요소로 간다**
 *  (고스트 클릭). 검은 화면 중앙 아래에는 히어로가 있고 그 아래 트랙에는 종료·일시정지 버튼이
 *  산다 — 화면을 켜려던 제스처가 세션을 건드리면 사고다.
 *
 *  🔴 **v0.47.0 r2 P6 — 고정 400ms 창으로는 부족해졌다.** 종전 「탭」 해제는 `pointerup`에서
 *  일어났으므로 `click`이 곧바로(수 ms 내) 뒤따랐다. 홀드 해제는 **손가락이 아직 닿아 있는 2초
 *  시점**에 일어난다 — 사용자가 그 뒤 500ms만 더 붙잡고 있으면 400ms 창이 만료되고, 그제서야
 *  나오는 `click`이 아래 UI를 때린다. 종전에 없던 회귀다.
 *  ## 기준점 — **손가락을 뗀 시점부터 센다** (한도: 30초 스톱로스)
 *  👉 창을 늘리는 대신 `pointerup`(또는 `pointercancel`)을 기다렸다가 **그 시점부터** 400ms를
 *  센다. 🔴 r4 — «얼마나 오래 붙잡고 있든»이 **아니다**: 30초 포인터 소실 스톱로스가 **계약의
 *  일부다**(승인: 민구 2026-08-09). 무장 후 30초 안에 up/cancel이 오면 «뗀 뒤 400ms»가
 *  보장되고, **그 이상 홀드 후 뗀 첫 탭은 통과할 수 있다** — 32초+ wake 홀드는 현실에 없다고
 *  보고 산 유한 사각이다. 종전의 무제한 문구는 코드(유한 타이머)와 모순이었다(codex r3
 *  재리뷰 :153 — 문구·코드·오라클 삼자 정렬이 이 문단의 존재 이유다).
 *
 *  🔴 **초기 타이머를 400ms로 걸면 안 된다** — 실측으로 확인한 함정이다. 홀드를 2초 넘겨
 *  붙잡고 있으면 떼기 **전에** 그 타이머가 만료돼 리스너가 전부 정리되고, **재무장 경로 자체가
 *  사라진다**(뒤이은 click이 그대로 하부로 샌다). 그래서 초기 타이머는 «up이 영영 안 올 때»만을
 *  위한 안전 상한이고, up/cancel이 오면 그 타이머를 **교체**한다.
 *  이 실패 모드는 `tests/v0470-w7-hold-blackout.spec.ts` ⑧이 잡는다 — 초안 구현이 거기서 red를
 *  냈다(스펙이 아니라 구현이 틀렸다).
 *  🔴 r3(콜드 리뷰 codex 5) — 같은 함정의 **잔존이 초기 상한 2000ms에도 있었다**: 400ms보다
 *  길 뿐, 2초 넘게 더 붙잡는 정상 장기 홀드에서 똑같이 떼기 전에 만료됐다(⑧의 추가 홀드가
 *  900ms라 그 상한 안이어서 못 잡았다). 처방은 상한의 **의미 축소**다 — 포인터 소실 스톱로스
 *  (`GHOST_SWALLOW_LOST_POINTER_MS`, 30초)로만 남기고, 삼킴 창은 오로지 up/cancel 시점부터
 *  센다. 오라클 범위(r4에서 정확화): ⑧-b는 **종전 2초 상한의 복원**을 반증한다 — 현 30초
 *  상한을 실제로 넘는 오라클은 두지 않는다(30초 실대기는 비용>가치, 제한 자체가 승인된
 *  정책이라 종결 — 위 §기준점). */
function swallowGhostClick(): void {
  let timer = 0;
  const disarm = () => {
    window.clearTimeout(timer);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('pointerup', onLift, true);
    window.removeEventListener('pointercancel', onLift, true);
  };
  const onClick = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
    disarm();
  };
  // 아직 닿아 있는 손가락이 떨어지는 순간부터 창을 연다 — `click`은 언제나 `up` 뒤에 온다.
  // cancel도 같이 듣는다: iOS 시스템 제스처로 포인터를 뺏기면 up이 영영 안 온다.
  const onLift = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(disarm, GHOST_SWALLOW_MS);
  };
  window.addEventListener('click', onClick, true);
  window.addEventListener('pointerup', onLift, true);
  window.addEventListener('pointercancel', onLift, true);
  timer = window.setTimeout(disarm, GHOST_SWALLOW_LOST_POINTER_MS);
}

export function BlackoutOverlay({ onRelease }: { onRelease: () => void }) {
  // v0.51 [CLIP-MUTED-SPAN-1] — 트랙 muted 여부. 작성자는 `useMicInterruptionNotice` 하나다.
  const micInterrupted = useSessionStore((st) => st.micInterrupted);
  const lines = wakeLines(micInterrupted);
  /** V-FIX5 — 해제도 계측한다. 진입(`screen_off` + `src:hold`/`src:voice`)과 **대칭**이어야
   *  «몇 번 껐다 켰나 · 어느 경로로»가 로그에서 짝지어진다. 새 이벤트 타입은 만들지 않는다
   *  (SOP-003 파서 계약 — `command`/`parsed`/`extra:src=` 문법 그대로).
   *  🔴 v0.47.0 r2 P6 — 포인터 경로의 `src`가 `tap` → **`hold`** 로 바뀌었다. 제스처가 실제로
   *  홀드이고, 끄기(`screen_off src:hold`)와 대칭이라 로그 고고학이 이 반전 지점에서 헷갈리지
   *  않는다. `src:tap`이 찍힌 로그는 v0.47.0 이전(08-08~09) 회차다. */
  const logRelease = (src: 'hold' | 'key') => {
    logger.log({ type: 'command', parsed: 'screen_on', extra: `src:${src}` });
  };

  const [progress, setProgress] = useState(0);
  /** V-FIX3b 계약 — 표시 트리거는 **「눌렸는가」**다. 진행값 파생으로 두면 첫 계단(500ms)까지
   *  피드백이 없어 *"왜 안 켜지지"* 가 된다(위 §진행 표시 주석). */
  const [holding, setHolding] = useState(false);
  const tickRef = useRef<number | null>(null);
  const startRef = useRef(0);
  const firedRef = useRef(false);
  /** 멀티터치 방어 — 홀드를 시작한 그 포인터만 홀드를 끝낼 수 있다. */
  const pointerIdRef = useRef<number | null>(null);

  const cancelHold = useCallback((reason?: 'up' | 'cancel' | 'leave') => {
    // 🔴 v0.51 H3 — **켜기 쪽도 취소를 남긴다.** 끄기와 대칭이어야 «어느 홀드가 얼마나 자주
    //    끊기는가»를 한 눈금으로 비교할 수 있다(끄기만 계측하면 «이 기기·이 손가락이 원래
    //    그런가»를 가를 대조군이 없다).
    //    ⚠️ 술어는 끄기 쪽과 **같다** — 도는 홀드가 있을 때만. 완주 프레임이 `tickRef`를 먼저
    //    비우므로, 해제 성공 뒤 따라오는 up이 가짜 abort를 남기지 않는다.
    //    `reason`이 없으면(내부 정리 호출) 계측하지 않는다.
    if (reason && tickRef.current !== null) {
      logger.log({
        type: 'command',
        parsed: 'screen_on_abort',
        extra: holdAbort({ phase: 'screen_on', reason, atMs: performance.now() - startRef.current }),
      });
    }
    if (tickRef.current !== null) {
      window.clearTimeout(tickRef.current);
      tickRef.current = null;
    }
    pointerIdRef.current = null;
    setHolding(false);
    setProgress(0);
  }, []);

  // 언마운트 정리 — 남으면 오버레이가 사라진 뒤에도 틱이 돌고, 최악의 경우 **이미 켜진 화면에서**
  //   해제 콜백이 한 번 더 불린다.
  useEffect(() => () => {
    if (tickRef.current !== null) window.clearTimeout(tickRef.current);
  }, []);

  const beginHold = useCallback((e: PointerEvent<HTMLDivElement>) => {
    // 🔴 멀티터치·보조 버튼 무시. 이미 도는 홀드가 있으면 두 번째 손가락은 아무것도 안 한다.
    if (!e.isPrimary || tickRef.current !== null) return;
    e.preventDefault();
    e.stopPropagation();
    // ⚠️ **포인터 캡처를 걸지 않는다.** 캡처하면 손가락이 히트존 밖으로 나가도 홀드가 이어지는데,
    //    그러면 「중앙만 받는다」는 위치 계약이 시작 시점에만 걸리고 유지에는 안 걸린다.
    //    나가면 `pointerleave`가 취소하는 것이 이 설계의 의도다(히어로 진입과 다른 판단 —
    //    저쪽은 표면이 화면 전체라 «나간다»가 사실상 없다).
    // 🔴 r3(콜드 리뷰 claude §2 — MONITORING) — «안 거는 것»으로는 부족하다: **터치(직접 조작)
    //    포인터는 pointerdown 타깃에 암묵 캡처가 자동으로 걸린다**(iOS WebKit·Chromium 공통).
    //    캡처 중에는 경계 이벤트가 억제되어 위 leave-취소 설계가 실기기에서 무효가 될 개연 —
    //    주머니 접촉이 중앙에서 시작해 밖으로 흘러도 2초를 채우면 켜진다(오터치 방어 절반 상실).
    //    명시 해제로 설계를 복원한다. 데스크톱 마우스는 암묵 캡처가 없어 no-op — 그래서 이 축은
    //    데스크톱 스펙으로 못 재고(계약 #4), **iOS 실기기 확인 전까지 MONITORING**이다.
    //    확인 절차: 중앙 홀드 시작 → 1초 내 손가락을 가장자리로 끌고 유지 → 게이지가 멈추고
    //    화면이 안 켜지면 해소, 계속 차오르면 재발(리뷰 §2의 재현 절차).
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    pointerIdRef.current = e.pointerId;
    firedRef.current = false;
    startRef.current = performance.now();
    setProgress(0);
    setHolding(true);

    const schedule = () => {
      // 🔴 남은 시간으로 clamp한다 — 500ms 고정으로 밀면 마지막 틱이 2000ms를 지나쳐
      //    해제가 최대 500ms 늦는다(홀드 시간 판정 불변 계약).
      const remaining = HOLD_TO_WAKE_MS - (performance.now() - startRef.current);
      tickRef.current = window.setTimeout(tick, Math.max(0, Math.min(RELEASE_STEP_MS, remaining)));
    };
    const tick = () => {
      const p = Math.min(1, (performance.now() - startRef.current) / HOLD_TO_WAKE_MS);
      // 타이머 지터로 0.26/0.49 같은 값이 새지 않게 칸에 스냅한다.
      setProgress(Math.round(p * RELEASE_STEPS) / RELEASE_STEPS);
      if (p >= 1) {
        tickRef.current = null;
        // 진입(계약 ④)과 같은 단일 커밋 지점 — 같은 홀드가 두 번 해제하지 않는다.
        if (firedRef.current) return;
        firedRef.current = true;
        pointerIdRef.current = null;
        setHolding(false);
        setProgress(0);
        swallowGhostClick();
        logRelease('hold');
        onRelease();
        return;
      }
      schedule();
    };
    schedule();
  }, [onRelease]);

  /** 🔴 **해제 경로에 맨 `onPointerUp`이 하나도 없다.** up은 «취소»만 한다 —
   *  진입 제스처가 남긴 다운 없는 잔여 up은 취소할 홀드조차 없어 아무 일도 일어나지 않는다.
   *  이것이 이 회차 버그(떼는 순간 복귀)를 구조로 닫는 지점이다. */
  const endHold = useCallback((
    e: PointerEvent<HTMLDivElement>,
    reason: 'up' | 'cancel' | 'leave',
  ) => {
    if (pointerIdRef.current !== null && e.pointerId !== pointerIdRef.current) return;
    cancelHold(reason);
  }, [cancelHold]);

  return (
    <div
      data-testid="blackout-overlay"
      role="button"
      tabIndex={0}
      // v0.51 — 🔴 **같은 배열에서 나온다.** 종전엔 앞 문장("음성 입력은 계속되고 있습니다")이
      //   여기 인라인으로 한 벌 더 있어, 화면만 고치면 스크린리더는 계속 거짓을 읽었다.
      aria-label={`검은 화면 모드입니다. ${lines.join(' ')}`}
      // 🔴 v0.46.0 콜드 리뷰 L3-5 — `role="button"` + `tabIndex={0}`을 선언했는데 **키 핸들러가
      //    없었다.** 탈출 경로가 하나뿐인 화면에서 그 약속을 어기면 포인터를 못 쓰는 경로는
      //    **앱에 갇힌다.**
      //    🟢 **갇힘 방지 계약(`v0460-cr-blackout-escape` ④)은 v0.47.0 r2에서도 「즉시」다.**
      //    포인터가 2초 홀드로 바뀌었다고 여기에 홀드를 붙이면 안 된다 — 그 계약의 존재 이유가
      //    *"길게 누르기가 불가능한 입력 수단의 탈출 경로"* 이기 때문이다. 키보드에는
      //    「가장자리」도 「누르고 있기」도 없다. 의미가 갈리는 것이 **의도된 비대칭**이다.
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); logRelease('key'); onRelease(); }
      }}
      style={{
        position: 'fixed',
        inset: 0,
        // 🔴 OLED에서 검은 화소는 꺼진다 — 이 값이 절전의 본체다.
        background: '#000',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        // 길게 누르는 동안 iOS가 텍스트 선택·확대 메뉴를 띄우지 않게.
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        touchAction: 'none',
        cursor: 'pointer',
      }}
    >
      {/* 🔴 **해제를 받는 유일한 노드.** 오버레이 루트에는 포인터 핸들러가 없다 —
          가장자리 무시는 «조건문»이 아니라 «핸들러의 부재»로 구현한다. 조건문은 리팩토링에서
          뒤집히지만 부재는 뒤집히지 않는다.
          🔑 이 상자가 곧 **어디를 눌러야 하는지의 시각 안내**이기도 하다. 가장자리를 무시하는
          설계에서 «중앙이 어디인가»를 안 보여주면 사용자는 «왜 안 켜지지»에 갇힌다. */}
      <div
        data-testid="blackout-center-hit"
        onPointerDown={beginHold}
        // 🔴 H3 — 사유는 핸들러 자리에서만 알 수 있다(끄기 쪽과 같은 형태).
        onPointerUp={(e) => endHold(e, 'up')}
        onPointerCancel={(e) => endHold(e, 'cancel')}
        onPointerLeave={(e) => endHold(e, 'leave')}
        style={{
          width: CENTER_HIT_W,
          height: CENTER_HIT_H,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 14,
          // 최소 밝기 테두리 — «여기» 를 말하는 데 필요한 최소한만 켠다(OLED 절전 계약).
          border: '1px solid #141414',
          borderRadius: 20,
          touchAction: 'none',
          cursor: 'pointer',
        }}
      >
        <div
          data-testid="blackout-hint"
          data-mic-interrupted={micInterrupted ? '1' : '0'}
          style={{
            fontSize: VOICE_TYPE.caption,
            fontWeight: 700,
            // 🔴 v0.51 — **경고일 때만 밝기를 올린다.** OLED 절전 계약(켜진 화소가 곧 전력)과
            //   정면으로 부딪히는 자리이고, 그 충돌은 PRINCIPLES §1(「실패를 숨기지 않는다」)이
            //   이긴다 — 읽히지 않는 경고는 경고가 아니다. 상시가 아니라 **muted 동안만**이라
            //   정상 세션의 절전은 종전 그대로다.
            color: micInterrupted ? '#c9a227' : '#3a3a3a',
            textAlign: 'center',
            lineHeight: 1.5,
            padding: '0 24px',
          }}
        >
          {lines.map((line) => (
            <span key={line} style={{ display: 'block' }}>{line}</span>
          ))}
        </div>
        {/* 🔴 홀드 진행 계단. **OLED 계약 안에서** 그린다 — 히어로의 `T.green` 채움을 가져오면
            이 화면의 존재 이유가 줄어든다. 트랙은 테두리와 같은 #141414, 채움은 힌트와 같은
            #3a3a3a 로 «이미 켜져 있는 두 밝기»만 재사용한다(새 밝기를 도입하지 않는다).
            폭·높이도 히어로(70%×6px)보다 작다 — 켜진 화소가 곧 전력이다.
            ⚠️ `transition`을 넣지 마라. 계단 사이를 보간하면 그리기 횟수가 도로 늘어나
            이 설계의 요점(2초에 4프레임)이 사라진다. */}
        {holding && (
          <div
            data-testid="blackout-hold-track"
            style={{ width: '50%', height: 4, borderRadius: 2, background: '#141414', overflow: 'hidden' }}
          >
            <div
              data-testid="blackout-hold-fill"
              data-progress={progress.toFixed(2)}
              style={{ width: `${(progress * 100).toFixed(0)}%`, height: '100%', background: '#3a3a3a' }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
