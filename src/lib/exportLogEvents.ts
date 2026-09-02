/**
 * v0.51.1 X1 (2026-09-02 · read-fb F6) — 세션 필터 export의 **이벤트 선택 술어**(순수 · 브라우저 의존 없음).
 *
 * 🔴 결함: `sessionId:""` 이벤트가 수확 zip에서 통째로 빠졌다. `useVoiceSession.logCell`은 `sessionIdRef.current`를
 * 명시로 싣는데 세션 시작 **전**(오디오 unlock·마이크·TTS 워밍업·알림 권한)엔 그 값이 빈 문자열이다 — `null`이
 * 아니라 `'__app__'` 센티널도 안 붙고, 필터 집합에도 없어 탈락했다. 09-02 정식 4세션 zip 5개 전부
 * `audio_unlock 0 · start_ready 0`이었고 제보 zip(전량 export)엔 36~43건이 있었다. 세션 **시작 직전 진단**이
 * 정식 수확에선 영구 부재였던 셈이다(09-02 프리뷰 판독이 `start_ready`를 못 본 이유).
 *
 * 창(window): IDB `logEvents`는 세션 삭제 cascade 외엔 영구 보존이라 `''` 이벤트는 기기 수명 내내 쌓인다
 * (자동 삭제된 세션의 것도 남는다). 세션당 zip마다 전량을 실으면 판독 잡음이 세션 수에 비례해 커지므로
 * **export 범위 세션의 `startedAt` 최소 − 10분 ~ `finishedAt`(없으면 now) 최대**로 한정한다 — 시작 직전 진단은
 * 클릭 뒤 수 초 안에 찍히고(08-07 실측 `start_ready … ms=1200대`), 10분은 「탭에 들어가 준비하다 시작」을 넉넉히
 * 덮는다. 🔑 세션을 하나도 못 찾으면(sessions.json 로드 실패 · 미영속 세션) **전량 동봉**한다 — 진단용이라
 * fail-open이 맞다(빠뜨리는 쪽이 이 결함 그 자체다).
 *
 * ⚠️ `''`를 `'__app__'`으로 바꾸는 «원인 수정»은 일부러 하지 않았다: 기기 IDB에 이미 쌓인 과거 `''` 이벤트는
 * 그 방법으로 못 살리고, `sessionId:""`가 곧 「세션 밖·앱 수명주기 아님」의 판별값이기도 하다(판독 SOP-003).
 *
 * 오라클: tests/exportLogEvents.spec.ts (Node) · tests/v0511-x1-export-blank-session.spec.ts (e2e · zip 실물).
 */

/** 세션 시작 전 `''` 이벤트를 몇 분까지 거슬러 동봉하는가. */
export const BLANK_SESSION_LEAD_MS = 10 * 60_000;

export const APP_SENTINEL = '__app__';

export interface ExportEventWindow {
  /** inclusive epoch ms */
  from: number;
  /** inclusive epoch ms */
  to: number;
}

/** export 범위 세션들로 `''` 이벤트 창을 만든다. 세션이 없으면 `null`(= 전량 동봉). */
export function blankSessionWindow(
  sessions: ReadonlyArray<{ startedAt: number; finishedAt?: number }>,
  now: number,
): ExportEventWindow | null {
  if (sessions.length === 0) return null;
  const from = Math.min(...sessions.map((s) => s.startedAt)) - BLANK_SESSION_LEAD_MS;
  const to = Math.max(...sessions.map((s) => s.finishedAt ?? now));
  return { from, to };
}

/** 세션 필터 export에 이 이벤트를 싣는가.
 *  - 범위 세션 id · `__app__` → 항상.
 *  - `''`(세션 밖 · 시작 직전 진단) → 창 안이면(창이 없으면 항상).
 *  - 그 밖의 세션 id(`sess_*` 등) → 제외(종전 계약). `sessionId`가 없는(undefined/null) 항목도 제외 —
 *    logger가 영속 전에 `__app__`을 붙이므로 실제로는 오지 않는다. */
export function includeEventInSessionExport(
  e: { sessionId?: string | null; ts: number },
  filterSet: ReadonlySet<string>,
  window: ExportEventWindow | null,
): boolean {
  const sid = e.sessionId;
  if (sid == null) return false;
  if (sid === APP_SENTINEL || filterSet.has(sid)) return true;
  if (sid !== '') return false;
  return window == null || (e.ts >= window.from && e.ts <= window.to);
}
