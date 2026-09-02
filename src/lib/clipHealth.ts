/**
 * v0.50 [CLIP-SILENT-1] — **클립 캡처 건강도 장부**(순수 모듈).
 *
 * ## 왜 있나 — 2026-08-19 실기기 사고
 * 같은 날 두 세션에서 마이크 트랙이 **살아 있는 채 무음 프레임만** 흘렸다. `MediaRecorder`는
 * 컨테이너 조각 5바이트(또는 chunk 0)만 내놓았고, 앱은 **끝까지 아무것도 알아채지 못했다**:
 *   · 이원창 A — 60/60 전량 소실(40분) · 이원창 세션 `wave_stats:peak=0.00`
 *   · 양혁진 A — 연속 9셀 소실(2분 26초) 뒤 **외부 조건이 풀려** 저절로 회복
 * 값(STT)은 멀쩡히 시트까지 갔다. 잃은 것은 **「값이 맞는지 나중에 확인할 수단」**뿐이라
 * 화면에도 시트에도 이상이 없었다 — 그래서 **세션이 끝날 때까지 아무도 몰랐다.**
 *
 * ## 왜 「연속 실패 카운터」인가 — 다른 신호는 전부 막혔다
 *  · `AudioRecorder.isStreamLost()`는 `readyState === 'ended'`만 사망으로 본다. 무음 트랙은
 *    `ended`가 아니라 **`maybeAutoRecoverOrLatch`가 69회 호출되어 69회 no-op**이었다.
 *  · `navigator.audioSession`은 iOS 26.6에서 `state=unknown`만 주고 `statechange`가 0건이다
 *    (08-06~08-19 누적 로그 실측 — v0.46.0 P1 프로브가 이 기기에서 무용이라는 뜻).
 *  · `window.blur`는 비특이적이다(정상 세션도 같은 신호를 맞고 멀쩡했다).
 *  👉 남는 신뢰 가능한 신호는 **「빈 클립이 계속 나온다」는 결과 그 자체**뿐이다.
 *
 * ## 오탐이 왜 안 나는가
 * 진짜 조용한 발화도 webm/opus는 수만 바이트다(정상 3세션 실측 min **29,484B**). 임계
 * `EMPTY_CLIP_BYTES=200`과 사고 실측 **5B** 사이에 두 자릿수 배율의 여유가 있어 정상 클립이
 * 이 경로에 들어올 수 없다. 연속 2회 조건이 단발 사고(재질문 취소 등)를 한 겹 더 거른다.
 *
 * 🔴 **리셋은 `clip_saved`에서만이다.** 「다음 클립 시작(`clip_started`)」으로 리셋하면 안 된다 —
 * 양혁진 세션은 `clip_started` 123 vs `clip_stop_await` 68로 **정지 대기에 못 간 클립이 55개**다
 * (재질문·저신뢰 거부로 교체된 것들). 시작으로 리셋하면 **소란한 세션에서 래치가 영영 안 걸린다.**
 * `clip_stale_pending`도 리셋 대상이 아니다(저장 성공이 아니다).
 */

/** 연속 실패 몇 회에서 마이크 소실로 판정하는가.
 *
 *  **2인 이유**: 1회는 단발 사고(재질문 취소·경계 클립)에서도 나므로 오탐이 된다. 3회면 늦다 —
 *  실측으로 되짚으면 양혁진은 2회 지점이 발병 **20초 뒤**(07:12:31 → 07:12:51), 이원창은 세션
 *  시작 **48초 뒤**(09:41:39 → 09:41:48)다. 실제로는 각각 2분 26초·40분을 잃었다.
 *  3회로 올리면 그만큼 늦어지고, 얻는 것은 이미 두 자릿수 배율로 확보된 오탐 여유뿐이다. */
export const CLIP_FAIL_LATCH_THRESHOLD = 2;

/** 세션 1건의 클립 결산. `saved + failed` = 값 커밋 시 클립을 **정지 대기까지 보낸** 횟수다.
 *
 *  🔑 분모로 `clip_started`를 쓰지 않는 이유: 재질문·저신뢰 거부로 **버려진 클립까지 세어**
 *  분모가 부풀기 때문이다(양혁진 123 vs 68). 사용자에게 「0/60」을 보여줄 때 정직한 분모는
 *  「값이 커밋된 셀 수」인 이 합이다. */
export interface ClipHealthSummary {
  saved: number;
  failed: number;
  /** 🔴 v0.51 [CLIP-MUTED-SPAN-1] — **저장은 됐지만 증거로 쓸 수 없는** 클립 수(트랙 `muted`
   *  구간에 걸쳤다). `saved`도 `failed`도 아닌 **제3의 칸**이다.
   *
   *  ## 왜 칸을 새로 파나 — 둘 중 어디에 넣어도 거짓말이 된다
   *  · `saved`에 넣으면(= v0.51 이전의 동작) **집계가 무음을 성공이라고 말한다.** muted 구간
   *    클립이 `EMPTY_CLIP_BYTES(200)`을 넘겨 나오는 순간 실제로 그랬다 — 실측이 5바이트였던 것은
   *    iOS의 그 구간에서 그랬을 뿐, 크기는 기기·구간 길이에 따라 변한다.
   *  · `failed`에 넣으면 연속 카운터가 임계에 닿아 `micLost`가 서고 **멀쩡한 마이크에 재연결
   *    배너가 뜬다** — `getTrackState()` 주석(:354~358)이 「muted는 unmute 대기가 옳다」고
   *    못박은 바로 그 형상이다.
   *  👉 정확한 의미는 **판정 보류**다. 실패의 증거로도, 그 반증으로도 쓰지 않는다. */
  unreliable: number;
  /** 🔴 v0.51 r2 [P1-2] — **`failed`의 부분집합**: 그 실패가 muted 구간에 걸쳐 일어났는가.
   *
   *  ## 왜 넷째 칸인가 — 이건 회계가 아니라 **고지용**이다
   *  2026-09-01 실측 사고(`sess_1788216390429`)에서 죽은 클립 3건은 **전부 `failed` 경로**였다
   *  (`clip_too_small:5`×2 + `clip_empty`×1). 그래서 `unreliable`은 **0**이었고,
   *  「구간에 증거를 잃었나」를 `unreliable` 증가분으로만 물은 고지는 **가장 크게 잃은 형상에서
   *  정확히 아무 말도 하지 않았다**(2026-09-02 콜드 리뷰 [P1-2] 실측).
   *
   *  ## 🔴 회계 3칸(`saved`/`failed`/`unreliable`)은 **한 글자도 안 바뀐다**
   *  이 값은 이미 `failed`로 센 것을 **다시 세지 않는다** — 같은 클립을 두 칸에 세면 결산의 합이
   *  커밋 수를 넘는다(`useValueCommit` 주석이 못박은 그 계약). `streak`도 안 건드린다.
   *  👉 **`saved + failed + unreliable`이 분모다. 여기에 `mutedFailed`를 더하지 마라.** */
  mutedFailed: number;
}

export interface ClipHealth {
  /** 빈/극소 클립 1건 기록. **연속 실패가 임계 이상이면 true**(= 마이크 소실로 봐도 된다).
   *
   *  🔴 v0.51 r2 [P1-2] — `mutedSpan`은 **사유 표지일 뿐 회계를 바꾸지 않는다.** 이 클립은
   *  종전 그대로 `failed` 한 칸에만 서고 `streak`도 종전 그대로 오른다. 바뀌는 것은
   *  `summary().mutedFailed`가 함께 오른다는 것뿐이고, 그 값의 유일한 소비자는
   *  **회복 고지**(`useMicInterruptionNotice`)다.
   *
   *  ⚠️ 이 인자를 **가드레일 `[CLIP-MUTED-VERDICT-1]` ②의 위반으로 읽지 마라.** ②가 금지하는 것은
   *  「**저장에 성공한** muted 클립을 `recordFailure()`로 세는 것」이다(→ `recordUnreliable()`).
   *  여기 오는 클립은 muted와 무관하게 **이미 실패했다**(5바이트·chunk 0). 세는 칸이 바뀌지
   *  않으므로 래치 시점도 종전과 **비트 단위로 같다**.
   *
   *  🔑 왜 별도 메서드(`recordMutedFailure()`)가 아닌가: 실패 경로가 둘(`clip_empty`·
   *  `clip_too_small`)이고 앞으로 셋이 될 수 있는데, 장부 호출이 **한 클립에 두 줄**이면
   *  한쪽만 빠뜨리는 드리프트가 생기고 그 누락은 정상 세션에서 아무 증상이 없다. 한 호출로
   *  묶으면 **이중 계수도 누락도 구조적으로 불가능**하다.
   *
   *  @param mutedSpan 이 클립이 트랙 `muted` 구간에 걸쳤는가(`ClipResult.mutedSpan`) */
  recordFailure(mutedSpan?: boolean): boolean;
  /** 🔴 v0.50 r2 [CF-2] — **이 세션에서 아직 고지하지 않았으면 true**(그리고 이후 false).
   *
   *  종전 구현은 고지의 1회성을 `micLost` 상승 에지에 맡겼는데, 자동 재연결이 성공하면
   *  `micLost`가 곧 false로 내려가 **에지가 다시 생기고 셀마다 반복 발화**했다(콜드 리뷰 CF-2 실측:
   *  한 세션 `clip_fail_alert` 2건). 민구가 승인한 것은 「복구에 성공해도 **1회**」다.
   *  1회성의 소유자를 **세션 수명을 가진 이 장부**로 옮겨 구조로 보장한다 —
   *  재무장은 `reset()`(세션 start)에서만 일어난다. */
  alertOnce(): boolean;
  /** 클립 저장 성공 1건 — 연속 카운터를 0으로 되돌린다. */
  recordSaved(): void;
  /** 🔴 v0.51 [CLIP-MUTED-SPAN-1] — muted 구간에 걸친 클립 1건.
   *
   *  🔴 **연속 카운터(`streak`)를 건드리지 않는다 — 증가도 리셋도 하지 않는다.**
   *   · 증가시키면 → 래치 → `micLost` → 재연결 배너(위 `unreliable` 주석의 금지 형상).
   *   · 리셋하면 → 이 파일 헤더의 **「리셋은 `clip_saved`에서만」** 계약 위반. muted 클립은
   *     저장 성공이 아니다. 리셋을 허용하면 진짜 사망 구간에 muted가 하나 끼는 것만으로
   *     래치가 영영 안 걸린다.
   *  👉 판정 보류는 **아무 쪽으로도 세지 않는 것**으로만 성립한다. */
  recordUnreliable(): void;
  /** 🔴 v0.51.1 [CLIP-MUTED-SPAN-1] ⓓ — **muted 증거가 장부에 오르는 순간**을 구독한다.
   *  `recordUnreliable()`·`recordFailure(mutedSpan=true)`의 증가 **직후**에 동기로 불린다.
   *  `recordSaved()`·`recordFailure(false)`에는 울리지 않는다.
   *
   *  ## 왜 장부가 신호를 내나 — 회복 고지의 「판정 시점」 결함(2026-09-02 실기기 1차)
   *  unmute 핸들러가 **즉시** 증가분을 봤는데, 걸친 클립의 증거는 **클립이 닫힐 때**(unmute
   *  +8~11초 뒤 · `useValueCommit`) 장부에 올랐다 → `lost=0` → 침묵. 고지는 「걸친 클립이
   *  해소되는 자리」에서 판정해야 하고, 그 자리는 정확히 이 두 메서드의 증가 직후다.
   *  콜사이트(`useValueCommit`)에 콜백 줄을 두면 muted 증거 경로가 늘 때마다 한 줄씩 빠뜨릴 수
   *  있다(위 `recordFailure` 주석의 드리프트 논리 그대로) — 장부 **안**에서 울리면 경로가 늘어도
   *  구조적으로 못 빠뜨린다. 유일한 구독자는 `useMicInterruptionNotice`다.
   *
   *  🔴 **`reset()`은 구독을 지우지 않는다.** 구독자는 마운트당 1회 구독하고 세션은 그 안에서
   *  여러 번 돈다 — 세션 경계에서 끊으면 두 번째 세션부터 고지가 죽는다.
   *  @returns 해제 함수 */
  onMutedEvidence(cb: () => void): () => void;
  /** 세션 결산(누적). */
  summary(): ClipHealthSummary;
  /** 세션 경계 초기화 — 연속 카운터·누적 결산·고지 1회 플래그를 모두 비운다. */
  reset(): void;
}

export function createClipHealth(threshold: number = CLIP_FAIL_LATCH_THRESHOLD): ClipHealth {
  let streak = 0;
  let saved = 0;
  let failed = 0;
  let unreliable = 0;
  let mutedFailed = 0;
  let alerted = false;
  // v0.51.1 ⓓ — muted 증거 구독자(인터페이스 `onMutedEvidence` 주석이 SSOT). `reset()`과 무관하다.
  const evidenceListeners = new Set<() => void>();
  const notifyMutedEvidence = () => {
    for (const cb of Array.from(evidenceListeners)) {
      try { cb(); } catch { /* 구독자 하나가 실패해도 장부는 정상이다 */ }
    }
  };
  return {
    recordFailure(mutedSpan = false) {
      streak += 1;
      failed += 1;
      // 🔴 회계 3칸은 위 두 줄이 전부다 — 아래는 **고지용 표지**이지 넷째 회계 칸이 아니다.
      if (mutedSpan) {
        mutedFailed += 1;
        // v0.51.1 ⓓ — 증가 **직후** 알린다(구독자가 여기서 `summary()`를 읽는다).
        notifyMutedEvidence();
      }
      return streak >= threshold;
    },
    alertOnce() {
      if (alerted) return false;
      alerted = true;
      return true;
    },
    recordSaved() {
      streak = 0;
      saved += 1;
    },
    recordUnreliable() {
      // 🔴 `streak`는 의도적으로 손대지 않는다(인터페이스 주석이 근거의 SSOT).
      unreliable += 1;
      // v0.51.1 ⓓ — 증가 **직후** 알린다(위 `recordFailure`와 같은 자리).
      notifyMutedEvidence();
    },
    onMutedEvidence(cb) {
      evidenceListeners.add(cb);
      return () => { evidenceListeners.delete(cb); };
    },
    summary() {
      return { saved, failed, unreliable, mutedFailed };
    },
    reset() {
      streak = 0;
      saved = 0;
      failed = 0;
      unreliable = 0;
      mutedFailed = 0;
      alerted = false;
    },
  };
}

/** 세션 종료 시 1건 남기는 결산 이벤트의 `extra`. **신규 이벤트라 기존 바이트 계약과 무관**하다.
 *  `saved=0`이고 `failed>0`이면 그 세션은 **음성 증빙이 통째로 없다** — 종료 화면이 그 사실을
 *  사용자에게 남긴다(로그만 남기면 2026-08-19가 그대로 반복된다). */
export function clipSummaryExtra(s: ClipHealthSummary, audioSessionEvts?: number): string {
  // 🔴 v0.51 — `unreliable`은 **여기 붙이지 않는다.** PRINCIPLES §4: 승인 목록에 없는 이벤트는
  //   바이트 불변이고, 확장이 필요하면 **새 이벤트 이름**을 쓴다(→ `clipUnreliableSummaryExtra`).
  //   민구 확정 2026-09-01(③A).

  const base = `clip_summary:saved=${s.saved},failed=${s.failed}`;
  // v0.50 r2 [갈래 B] — 세션 총계. **신규 이벤트의 꼬리**라 계약 문제가 없고, 클립이 하나도
  // 안 남은 세션(이원창형)에서도 「그 세션에 오디오 세션 전이가 몇 번 있었나」가 남는다.
  return audioSessionEvts === undefined ? base : `${base},asEvt=${audioSessionEvts}`;
}

/** 🔴 v0.51 [CLIP-MUTED-SPAN-1] — **신규 이벤트**(기존 `clip_summary`는 바이트 불변).
 *
 *  `unreliable > 0` **또는 `mutedFailed > 0`** 인 세션에서만 1건 방출한다 — 정상 세션에는 나가지
 *  않으므로 2000개 링버퍼를 잠식하지 않는다(계측 추가 시 항상 묻는 질문: PRINCIPLES §4 ·
 *  계측 F 초안이 걸린 그 게이트).
 *
 *  🔴 v0.51 r2 [P1-2] — `mutedFail=` **꼬리를 붙인다.** 종전에는 `unreliable > 0`이 게이트라
 *  실측 사고 형상(muted 구간 클립이 전부 `failed`)에서 **이 이벤트가 아예 안 나갔다.** 즉
 *  판독이 `clip_summary:failed=3`만 보고 **사유(마이크 인터럽트)를 못 읽었다.**
 *  🔑 `muted=`·`spans=`는 **접두 그대로**라 기존 판독기가 안 깨진다(꼬리 추가는 v0.50 r2
 *  `asEvt=`와 같은 형태).
 *
 *  @param unreliable 저장은 됐지만 muted 구간에 걸쳐 증거로 쓸 수 없는 클립 수
 *  @param spans 그 세션에서 관측된 muted **구간** 수(클립 수와 다르다 — 한 구간이 여러 클립을
 *               덮을 수도, 한 클립도 안 덮을 수도 있다. 둘을 같이 실어야 판독이 「구간이 길었나
 *               잦았나」를 가른다)
 *  @param mutedFailed 그 구간에서 **저장조차 못 한** 클립 수(`failed`의 부분집합 — 합에 더하지
 *               마라). 고지가 「무엇을 근거로 말했나」의 감사 흔적이다 */
export function clipUnreliableSummaryExtra(unreliable: number, spans: number, mutedFailed: number): string {
  return `clip_unreliable_summary:muted=${unreliable},spans=${spans},mutedFail=${mutedFailed}`;
}
