/**
 * v0.7.0 — 과거 조사값 인덱스의 **브라우저 사이드**: fetch + 모듈 캐시 + 영속 폴백
 * (B3 조회 탭 · B4 추세 검증 공용 모듈).
 *
 * [ENV-12] 2026-08-15 — 패턴(audioTrim.ts와 동일)에 따라 브라우저 의존이 없는 부분을
 * 별도 파일로 갈랐다. 데이터 모델·인덱스 계약은 그쪽 헤더가 SSOT다:
 *  - `pastValuesIndex.ts` — 키 구성·날짜 정규화·인덱스 빌드·회차 조회(순수)
 *  - `pastValuesPersist.ts` — IDB 레코드 직렬화/복원(순수)
 *  - **이 파일** — fetch·세대·in-flight·백오프 재시도·상태 구독(브라우저)
 *
 * 오프라인/미로그인/시트 미설정/HTTP 오류 → loadPastIndex가 null로 resolve(throw 안 함).
 * 호출자(조회 탭·추세 검증)는 null이면 기능을 조용히 건너뛴다.
 */
import type { Column } from '../types';
import { withTimeout } from './async';
import { effectiveSampleKey } from './columnFlags';
import { fetchAllRowsUnbounded, parseSpreadsheetId, readonlySheetsAuth } from './sheets';
import { useSettingsStore } from '../stores/settingsStore';
import { useSessionStore, isSessionLive } from '../stores/sessionStore';
import { logger } from './logger';
import { authLostInSession } from './logEvents';
import { deletePastIndexBackup, loadPastIndexBackup, savePastIndexBackup } from './db';
import { buildPastIndex, resolveRoundCol, type PastIndex } from './pastValuesIndex';
import {
  deserializePastIndexEntry,
  isFallbackFresh,
  serializePastIndexEntry,
} from './pastValuesPersist';

/** [ENV-12] 분리 전 호출부의 import 경로를 그대로 보존하는 재수출(순수 함수는
 *  `pastValuesIndex.ts`가 소유). **단방향**이다 — leaf는 이 파일을 import하지 않으므로
 *  `[LOGEVENTS-CYCLE-1]` 형태의 배럴 순환이 아니다. 새 코드는 `./pastValuesIndex`에서
 *  직접 가져오는 쪽이 낫다. */
export { buildSampleKey, keyColumns, pastValue, previousRound, previousSurveyRound } from './pastValuesIndex';
export type { PrevSurveyRound } from './pastValuesIndex';

// v0.38.0 — `withTimeout`은 `lib/async.ts`로 이동했다(계층 중립 유틸). 여기서 쓰는 이유는 그대로다:
// 시간 초과 시 reject → loadPastIndex의 catch가 `past_index_skip:timeout…`으로 로깅하고 null로
// 해소하므로, in-flight 가드가 풀려 백오프 재시도·수동 재시도 버튼 경로가 살아난다(07-13 §4).

// ─── 브라우저 사이드: fetch + 모듈 캐시 ─────────────────────────────────────

const CACHE_TTL_MS = 10 * 60 * 1000; // 10분 — 한 조사 세션 동안 재fetch 없이 충분, 당일 타 기기 업로드는 다음 세션에 반영

/** loadPastIndex 전체 fetch 상한 — 2272행 실측이 ~1s인 시트가 20s를 넘기면 hang으로 간주. */
const FETCH_TIMEOUT_MS = 20_000;

interface CacheEntry {
  fp: string;
  builtAt: number;
  index: PastIndex;
}

let cached: CacheEntry | null = null;
let latestLoadGeneration = 0;
let inflight: { fp: string; generation: number; promise: Promise<PastIndex | null> } | null = null;
let loginRefreshInflight: { fp: string; promise: Promise<PastIndex | null> } | null = null;

// v0.33.0 항목5 — IDB에서 복원한 영속 폴백(로그인 무관 이상치 알람). 유효성(fp 일치 + 14일 이내)은
// 읽기 시점(getFallbackEntry)에 매번 재검증한다 — 하이드레이션 후 설정이 바뀌어도 안전.
let fallback: CacheEntry | null = null;
let fallbackHydrateStarted = false;

// v0.33.0 항목5 — 상태 구독(설정탭·입력탭 시작 카드의 '과거값 준비' 배지 실시간 갱신용).
const statusListeners = new Set<() => void>();
function notifyStatusChanged(): void {
  for (const cb of [...statusListeners]) {
    try { cb(); } catch { /* 리스너 오류가 로더를 죽이지 않게 */ }
  }
}
export function subscribePastIndexStatus(cb: () => void): () => void {
  statusListeners.add(cb);
  return () => { statusListeners.delete(cb); };
}

// v0.14.0 A — 전송 실패(iOS Safari transient "Load failed") 자가 복구용 백오프 재시도 상태.
// 실기기 로그(v0.13.0)에서 세션 start 직후(~27ms) prefetch가 "Load failed"로 한 번 실패하면
// 세션 내내 past_index_ready가 0건이었다(토큰·연결은 정상 — 같은 세션 시트 쓰기는 성공). 원인은
// "한 번 실패 후 아무도 다시 부르지 않음"(prefetch 1회 + evaluateTrend는 getCachedIndex만 읽음).
// loadPastIndex는 실패를 캐시하지 않으므로 재호출하면 다시 시도된다 — ensurePastIndex가 반복
// 호출에 안전하게 자가 제한된 백오프 재시도를 건다.
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempts = 0;
const MAX_RETRIES = 5;

// v0.55.0 B-1 — 세션 중 로그인 만료 1회 기록 모듈 변수 및 B-3 종료 후 프롬프트 표지.
let authLostLoggedFor: string | null = null;
let authLostPendingSessionId: string | null = null;

// v0.55.0 B-2 — 무인증 헛기록 백오프 상태 (10초→30초→2분→5분).
let noAuthUntil = 0;
let noAuthStep = 0;
const NO_AUTH_BACKOFF_MS = [10_000, 30_000, 120_000, 300_000];

/** v0.55.0 B-3 — 세션 중 로그인 만료 후 세션 종료 시 로그인 모달 1회 띄우기 위한 소비 함수. */
export function consumeAuthLostPrompt(): boolean {
  const curSid = useSessionStore.getState().sessionId;
  const shouldPrompt = !!authLostPendingSessionId && authLostPendingSessionId === curSid;
  authLostPendingSessionId = null;
  return shouldPrompt;
}

/** v0.34.0 리뷰(Codex+agy-Flash 공통) — 권한 오류(401 미인증 / 403 권한없음) 판별.
 *  sheets.ts의 fetch 실패는 `시트 조회 실패 (HTTP 403): …` 형태로 상태코드를 메시지에 담는다
 *  (별도 status 필드가 없어 메시지 파싱 — 오탐해도 "재시도를 덜 한다"는 안전한 방향이고,
 *  실패 자체는 past_index_skip으로 항상 로깅되므로 침묵하지 않는다).
 *  비공개 시트를 API key로 읽는 조합이 대표 사례: 몇 번을 더 쏴도 결과는 같다. */
function isPermissionError(msg: string): boolean {
  return /\bHTTP (401|403)\b/.test(msg) || /\b(401|403)\b/.test(msg);
}

interface LoadContext {
  fp: string;
  spreadsheetId: string | null;
  sheetTab: string;
  columns: Column[];
  roundDateColId: string | null;
}

/** 캐시 키 = (시트 ID, 탭, 회차 컬럼, 컬럼 지문). 키/이름/타입이 바뀌면 인덱스 무효. */
function loadContext(): LoadContext {
  const s = useSettingsStore.getState();
  const spreadsheetId = parseSpreadsheetId(s.sheetUrl);
  const fp = JSON.stringify([
    spreadsheetId,
    s.sheetTab,
    s.roundDateColId,
    s.columns.map((c) => [c.id, c.name.trim(), c.type, effectiveSampleKey(c)]),
  ]);
  return { fp, spreadsheetId, sheetTab: s.sheetTab, columns: s.columns, roundDateColId: s.roundDateColId };
}

/** 유효한(TTL 내 + 현재 설정과 지문 일치) 캐시 인덱스. 없으면 null — fetch하지 않는다. */
export function getCachedIndex(): PastIndex | null {
  if (!cached) return null;
  if (Date.now() - cached.builtAt > CACHE_TTL_MS) return null;
  if (cached.fp !== loadContext().fp) return null;
  return cached.index;
}

// ─── v0.33.0 항목5 — 영속 폴백 (로그인 무관 이상치 알람) ───────────────────

/** 유효한(fp 일치 + 14일 이내) 영속 폴백 엔트리. 신선 캐시와 달리 10분 TTL이 없다 —
 *  토큰 만료·재부팅·미로그인 세션에서도 "직전 회차 대비" 비교선을 유지하는 것이 목적. */
function getFallbackEntry(): CacheEntry | null {
  if (!fallback) return null;
  if (!isFallbackFresh(fallback.builtAt, Date.now())) return null;
  if (fallback.fp !== loadContext().fp) return null;
  return fallback;
}

/** evaluateTrend 폴백 경로: `getCachedIndex() ?? getFallbackIndex()`. 폴백 사용 시 호출자가
 *  `trend_used_stale_index`를 로깅한다(세션당 1회 — useVoiceSession의 skip dedupe와 동일 컨벤션). */
export function getFallbackIndex(): PastIndex | null {
  return getFallbackEntry()?.index ?? null;
}

/** 폴백의 빌드 시각(epoch ms) — 배지의 "(x시간 전)" 표기·stale 로그의 age 산출용. 없으면 null. */
export function getFallbackBuiltAt(): number | null {
  return getFallbackEntry()?.builtAt ?? null;
}

/**
 * 🔴 v0.49 r4 M6(claude r3 #10) — 표시용 인덱스 + **출처**.
 *
 * 소비자(설정 요약)가 `getCachedIndex() === null`을 「백업에서 왔다」로 읽고 있었다. 그 둘은
 * **다른 질문**이다: 신선 캐시는 10분 TTL이 있고, 성공한 조회는 `cached`와 `fallback`에 **같은
 * 엔트리**를 심는다(`loadPastIndex` :642-645). 그래서 조회 성공 10분 뒤부터, 방금 이 세션이
 * 직접 읽어 온 인덱스가 「(백업)」으로 그려지고 `past_index_used_stale:…,age_h=0`이 기록됐다 —
 * 「최대 14일 묵은 IDB 백업」이라는 강한 주장이 **0시간짜리 자기 조회**에 붙는다.
 *
 * 판별자는 TTL이 아니라 **동일 엔트리인가**다. `fallback === cached`면 이 세션의 자기 조회이고,
 * TTL만 지났다(그 축은 준비 상태 배지 `getPastIndexStatus`가 따로 소유한다 — 이 함수는
 * 「답이 어디서 왔는가」만 답한다).
 */
export function readIndexWithProvenance(): { index: PastIndex; stale: boolean; builtAt: number } | null {
  const fresh = getCachedIndex();
  if (fresh && cached) return { index: fresh, stale: false, builtAt: cached.builtAt };
  const fb = getFallbackEntry();
  if (!fb) return null;
  return { index: fb.index, stale: fb !== cached, builtAt: fb.builtAt };
}

/**
 * 부팅/세션 시작 시 1회 — IDB `__past_index__` 레코드를 메모리 폴백으로 복원한다(idempotent).
 * 손상 레코드·14일 초과는 조용히 폐기. fp 검증은 여기서 하지 않는다(설정 하이드레이션 레이스
 * 방지 — 읽기 시점의 getFallbackEntry가 매번 검증). 실패해도 throw하지 않는다(best-effort).
 */
export async function hydratePastIndexFallback(): Promise<void> {
  if (fallbackHydrateStarted) return;
  fallbackHydrateStarted = true;
  try {
    const raw = await loadPastIndexBackup();
    if (raw == null) return;
    const entry = deserializePastIndexEntry(raw);
    if (!entry) return;
    if (!isFallbackFresh(entry.builtAt, Date.now())) return;
    // 이미 신선 캐시가 있으면(부팅 직후 prefetch가 먼저 성공) 캐시가 더 최신이다.
    if (!fallback || entry.builtAt > fallback.builtAt) fallback = entry;
    notifyStatusChanged();
  } catch { /* IDB 불가 — 폴백 없이 기존 경로로 동작 */ }
}

// ─── v0.33.0 항목5 — 상태 스냅샷 (3상태 배지의 '과거값 준비' 행) ──────────────

export interface PastIndexStatus {
  /** ready=신선 캐시 / stale=영속 폴백만 / loading=fetch 진행 중 / none=없음 */
  state: 'ready' | 'stale' | 'loading' | 'none';
  rowCount?: number;
  roundCount?: number;
  builtAt?: number;
}

export function getPastIndexStatus(): PastIndexStatus {
  const hit = getCachedIndex();
  if (hit && cached) {
    return { state: 'ready', rowCount: hit.rowCount, roundCount: hit.rounds.length, builtAt: cached.builtAt };
  }
  const fb = getFallbackEntry();
  if (fb) {
    return { state: 'stale', rowCount: fb.index.rowCount, roundCount: fb.index.rounds.length, builtAt: fb.builtAt };
  }
  if (inflight) return { state: 'loading' };
  return { state: 'none' };
}

/**
 * 과거값 인덱스 로드. 캐시 히트면 fetch 없이 반환, 동일 지문 in-flight면 그 promise 공유.
 * 미설정/미로그인/네트워크·HTTP 오류는 **null로 resolve**(throw 안 함) — 호출자는 조용히 skip.
 */
async function loadPastIndex(opts?: { force?: boolean }): Promise<PastIndex | null> {
  const ctx = loadContext();
  if (!opts?.force) {
    const hit = getCachedIndex();
    if (hit) return hit;
    if (inflight && inflight.fp === ctx.fp) return inflight.promise;
  }
  if (!ctx.spreadsheetId || !ctx.sheetTab) {
    logger.log({ type: 'app', extra: 'past_index_skip:not_configured' });
    return null;
  }
  // v0.34.0 C9 — 토큰 **또는** API key(공개 시트 읽기 폴백, readonlySheetsAuth SSOT)가 있으면
  // 진행. 둘 다 없을 때만 기존 not_signed_in skip(이벤트명 유지 — 로그 분석 호환).
  // 시트가 비공개라 key 경로가 403이면 fetch 오류가 아래 catch의 `past_index_skip:<msg>`로
  // 남는다(HTTP 상태 포함) — 침묵 실패 없음.
  const auth = readonlySheetsAuth();
  if (!auth) {
    logger.log({ type: 'app', extra: 'past_index_skip:not_signed_in' });
    const sessionState = useSessionStore.getState();
    if (isSessionLive(sessionState.phase)) {
      const curSid = sessionState.sessionId;
      if (curSid && authLostLoggedFor !== curSid) {
        authLostLoggedFor = curSid;
        authLostPendingSessionId = curSid;
        const sinceSec = Math.max(0, Math.floor((Date.now() - sessionState.startedAt) / 1000));
        logger.log({
          type: 'app',
          extra: authLostInSession(sinceSec),
        });
      }
    }
    noAuthUntil = Date.now() + NO_AUTH_BACKOFF_MS[Math.min(noAuthStep, 3)];
    noAuthStep++;
    return null;
  }
  const generation = ++latestLoadGeneration;
  const promise = (async (): Promise<PastIndex | null> => {
    try {
      // v0.33.0 항목5 — fetch 시작 계측(07-13 §4: 시작 이벤트가 없어 "미완 hang"을 로그로 판별
      // 불가했던 갭). ready/skip과 짝을 이뤄 미완주 fetch가 로그에서 보인다.
      // v0.34.0 C9 — auth=token|apikey 첨부: 어떤 인증 수단으로 준비됐는지 로그만으로 판정.
      logger.log({ type: 'app', extra: `past_index_fetch_start:auth=${auth}` });
      const { headers, rows } = await withTimeout(
        fetchAllRowsUnbounded(ctx.spreadsheetId!, ctx.sheetTab),
        FETCH_TIMEOUT_MS,
      );
      const roundCol = resolveRoundCol(ctx.columns, ctx.roundDateColId);
      const index = buildPastIndex(headers, rows, ctx.columns, roundCol);
      // v0.38.0 리뷰#1(Codex Medium) 검토 결과 — "게시 전 지문 재검증"은 **채택하지 않는다.**
      // 재연결(onUrlConfirmWithUrl)이 sheetTab을 잠깐 ''로 선리셋하는 과도 구간이 있어, 그 순간을
      // '낡음'으로 오인해 멀쩡한 조회 결과를 버렸다(실측: 로그인 갱신이 통째로 폐기됨).
      // 대신 요청 세대를 비교한다. 더 최신 조회가 시작됐다면 이 결과는 설정 과도 구간과 무관하게
      // 낡은 요청이므로, 메모리 캐시·폴백·IDB 어느 곳에도 게시하지 않는다.
      if (generation !== latestLoadGeneration) return null;
      // retryAttempts는 지문별 이력이 아니라 현재 준비 중인 인덱스의 단일 예산이다. 최신 요청의
      // 성공만 예산을 복구해야, 게시 직후 새 요청이 시작돼도 이전 세대가 최신 예산을 되감지 않는다.
      retryAttempts = 0;
      noAuthUntil = 0;
      noAuthStep = 0;
      cached = { fp: ctx.fp, builtAt: Date.now(), index };
      // v0.33.0 항목5 — IDB write-through(kv `__past_index__`) + 메모리 폴백 동기화.
      // 캐시 TTL(10분)·토큰 만료·재부팅 후에도 이 스냅샷이 알람 비교선으로 살아남는다.
      fallback = cached;
      void savePastIndexBackup(serializePastIndexEntry(cached));
      logger.log({
        type: 'app',
        extra:
          `past_index_ready:rows=${index.rowCount},samples=${index.samples.size},` +
          `rounds=${index.rounds.length},dup=${index.duplicateCount},unmapped=${index.unmappedColumns.length}`,
      });
      return index;
    } catch (e) {
      // 오프라인/HTTP 오류/타임아웃 — REVIEW-1: 삼키지 말고 로깅하되, 호출자에겐 null(조용히 skip).
      const msg = e instanceof Error ? e.message : String(e);
      // v0.34.0 리뷰(Codex+agy-Flash 공통) — 권한 오류(401/403)는 재시도해도 낫지 않는다. 비공개
      // 시트를 API key로 읽으려는 조합에서 지수 백오프 5회가 무의미한 403을 반복해 쿼터·대역폭을
      // 태우던 표면. 권한 오류로 판정되면 재시도 예산을 소진시켜 즉시 멈춘다(다른 실패는 종전대로
      // 재시도 — 오프라인·5xx·타임아웃은 회복 가능).
      // 낡은 요청의 권한 오류는 그 요청만의 결말이다. 최신 요청이 회복 가능한 오류로 재시도해야 할
      // 예산까지 소진하면, 현재 지문의 이상치 비교선이 준비되지 않는다.
      if (generation === latestLoadGeneration && isPermissionError(msg)) {
        retryAttempts = MAX_RETRIES;
        logger.log({ type: 'app', extra: `past_index_retry_blocked:permission:auth=${auth}` });
      }
      logger.log({ type: 'app', extra: `past_index_skip:${msg.slice(0, 120)}` });
      return null;
    } finally {
      if (inflight?.generation === generation) inflight = null;
      notifyStatusChanged();
    }
  })();
  inflight = { fp: ctx.fp, generation, promise };
  notifyStatusChanged();
  return promise;
}

/**
 * v0.38.0 #1 — Google 로그인 성공 직후의 강제 갱신. 10분 캐시는 의도적으로 우회하되,
 * 동일 설정 지문의 로그인 갱신이 이미 진행 중이면 같은 Promise를 공유한다. 로그인 직전의 일반
 * prefetch가 진행 중이었다면 그것을 먼저 정착시킨 다음 한 번 더 강제 조회해, "기존 요청에 합류해서
 * 실제 로그인 시점 갱신은 생략"되는 경우도 막는다. 인덱스 확정·메모리/IDB 반영은 loadPastIndex의
 * 기존 성공 경로만 사용한다.
 */
export function refreshPastIndexAfterLogin(): Promise<PastIndex | null> {
  const ctx = loadContext();
  if (loginRefreshInflight?.fp === ctx.fp) return loginRefreshInflight.promise;
  const pendingBeforeLogin = inflight?.fp === ctx.fp ? inflight.promise : null;
  const promise = (async () => {
    if (pendingBeforeLogin) await pendingBeforeLogin;
    return loadPastIndex({ force: true });
  })();
  loginRefreshInflight = { fp: ctx.fp, promise };
  void promise.finally(() => {
    if (loginRefreshInflight?.promise === promise) loginRefreshInflight = null;
  }).catch(() => {});
  return promise;
}

/** 재시도 가치 판단: 시트·탭·인증수단(토큰 또는 API key — v0.34.0 C9, readonlySheetsAuth SSOT)이
 *  모두 있는데 인덱스가 없으면 네트워크/HTTP 실패였다는 뜻 → 재시도 가치 있음.
 *  미설정/둘 다 없음이면 재시도 무의미(조용히 멈춤). */
function shouldRetryLoad(): boolean {
  const ctx = loadContext();
  return !!ctx.spreadsheetId && !!ctx.sheetTab && readonlySheetsAuth() !== null;
}

/**
 * v0.14.0 A — 반복 호출에 안전한 인덱스 로더. 캐시 히트/in-flight/재시도 예약 중이면 no-op.
 * 로드가 실패(null)했고 재시도 가치가 있으며 횟수 미초과면 지수 백오프(0.6→1.2→2.4→4.0s)로
 * 자동 재시도한다. evaluateTrend가 캐시 미스마다 호출해도 자가 제한되어 폭주하지 않는다.
 */
export function ensurePastIndex(): void {
  if (getCachedIndex()) return;
  // v0.55.0 B-2: 무인증 헛기록 백오프 가드
  if (Date.now() < noAuthUntil) return;
  // v0.38.0 리뷰#1(Codex Medium) — in-flight 가드는 **같은 지문**의 중복 조회만 막아야 한다.
  // 지문 비교 없이 막으면, 로그인 직후 느린 구지문 조회가 진행되는 동안 컬럼이 바뀌었을 때
  // 새 지문 재조회가 통째로 삼켜져 캐시가 빈 채로 남는다(현장 = 느린 네트워크에서 상시 조건).
  if (inflight && inflight.fp === loadContext().fp) return;
  if (retryTimer != null) return;
  const loadPromise = loadPastIndex();
  const generation = latestLoadGeneration;
  void loadPromise.then((idx) => {
    // 무효화/신규 조회 뒤 끝난 이전 ensure 체인이 새 전역 retryTimer를 다시 만들지 않게 한다.
    if (generation !== latestLoadGeneration) return;
    if (idx) return; // 성공 경로가 최신 세대를 확인한 뒤 예산까지 복구한다.
    if (!shouldRetryLoad() || retryAttempts >= MAX_RETRIES) return;
    const delay = Math.min(4000, 600 * 2 ** retryAttempts);
    retryAttempts++;
    retryTimer = setTimeout(() => { retryTimer = null; ensurePastIndex(); }, delay);
  });
}

/**
 * v0.38.0 리뷰#1 — "과거값 인덱스를 지금 만들 가치가 있는가"의 **단일 술어(SSOT)**.
 *
 * 이 판단이 App 부팅·로그인·설정 저장·테이블 생성·시트 재연결 등 호출부마다 복붙돼 있었고,
 * 모양이 조금씩 달라(`anyRule`만 보는 곳 vs 인증까지 보는 곳) 신규 호출부가 게이트를 통째로
 * 빠뜨리는 결함으로 이어졌다. 호출부는 이 함수만 쓴다 — 조건이 바뀌면 여기 한 곳만 고친다.
 *
 * 항상 보는 조건: ①이상치 알람 규칙(방향 또는 변동률)이 한 컬럼이라도 있고 ②시트가 지정돼 있다.
 * 둘 중 하나라도 없으면 만들어도 **소비자가 없다**.
 *
 * `requireAuth: true`일 때만 추가로 ③읽기 인증 수단(토큰 또는 API key)을 본다. 기본값이 아닌
 * 이유는 아래 본문 주석 참조 — 부팅 경로는 인증이 없어도 진입시켜야 스킵 사유가 로그에 남는다.
 */
export function shouldPreparePastIndex(opts?: { requireAuth?: boolean }): boolean {
  const s = useSettingsStore.getState();
  const anyAnomalyRule = s.columns.some(
    (c) => c.trendRule === 'increase' || c.trendRule === 'decrease' || c.pctThreshold != null,
  );
  if (!anyAnomalyRule || !s.sheetUrl || !s.sheetTab) return false;
  // 인증 검사는 **선택**이다. 부팅 경로는 인증이 없어도 진입시켜 loadPastIndex가
  // `past_index_skip:not_signed_in`을 남기게 한다 — 그 계측이 "왜 알람이 없었나"를 사후에
  // 판별하는 유일한 단서이고, SOP-003 파서와의 바이트 계약이다(v0.34.0 C9). 조회 자체는
  // loadPastIndex가 인증 없으면 즉시 skip하므로 네트워크 낭비는 없다.
  return opts?.requireAuth ? readonlySheetsAuth() !== null : true;
}

/**
 * 시트 연결 삭제 시 과거값 상태를 한 번에 무효화한다. 세대를 먼저 올려 이미 응답을 기다리는 조회가
 * 이후 메모리·IDB를 다시 게시하지 못하게 한 뒤, 현재 시트에만 의미가 있는 전역 상태를 정리한다.
 */
export async function invalidatePastIndex(): Promise<void> {
  latestLoadGeneration++;
  cached = null;
  fallback = null;
  inflight = null;
  loginRefreshInflight = null;
  resetPastIndexRetries();
  notifyStatusChanged();
  await deletePastIndexBackup();
}

/** 세션 시작 시 재시도 카운터/타이머 리셋 — 이전 세션이 오프라인으로 소진했어도 새 세션은 다시
 *  시도한다. 유효 캐시는 보존(무효화는 TTL/지문으로 getCachedIndex가 담당). */
export function resetPastIndexRetries(): void {
  retryAttempts = 0;
  noAuthUntil = 0;
  noAuthStep = 0;
  if (retryTimer != null) { clearTimeout(retryTimer); retryTimer = null; }
}

/** fire-and-forget 프리페치 — 세션 start() 등에서 호출(B4). v0.14.0: 백오프 재시도 포함. */
export function prefetchPastIndex(): void {
  ensurePastIndex();
}
