import { openDB, type IDBPDatabase } from 'idb';
import type { Session } from '../types';
import { mergeLegacyIdb, shouldMigrateIdb } from './namespaceMigrate';

/** [ENV-11] SSOT — 테스트는 tests/fixtures/idb.ts가 이 상수와 applyAppSchema를 재수출해 쓴다
 *  (하드코딩 금지, tests/idb-fixture.spec.ts 가드가 강제). */
export const DB_NAME = 'agri-voicenote';   // v0.50 개명 — 구 'survey-011'은 namespaceMigrate가 merge
export const DB_VERSION = 6;

/** applyAppSchema가 받는 최소 인터페이스 — idb 래퍼(IDBPDatabase)와 원시 IDBDatabase 모두 충족
 *  (테스트가 브라우저 컨텍스트에 toString() 주입해 원시 DB에 실행한다). */
interface SchemaTarget {
  objectStoreNames: { contains(name: string): boolean };
  createObjectStore(
    name: string,
    opts?: IDBObjectStoreParameters,
  ): { createIndex(name: string, keyPath: string): unknown };
}

/** 앱 IDB 스키마 SSOT — **멱등**(존재 확인 후 생성)이라 어떤 oldVersion에서 시작해도 최종 형태로
 *  수렴한다(현행 이력은 전부 "스토어 추가"뿐이라 버전 게이트와 동등 — 스토어를 삭제/개조하는
 *  마이그레이션이 생기면 그 단계만 upgrade에서 버전 게이트로 처리할 것).
 *  테스트 픽스처(tests/fixtures/idb.ts)가 이 함수를 재수출하므로 프로덕션·테스트 스키마가 절대
 *  드리프트하지 않는다([ENV-3]/[ENV-11] 근절 — v0.35.1 리뷰 라운드3 Pro 제안 채택).
 *  ⚠️ 클로저 금지 — toString() 직렬화로 브라우저에 주입되므로 바깥 식별자를 참조할 수 없다.
 *  각 스토어의 도입 배경 주석은 아래 upgrade 핸들러가 아닌 여기서 유지한다:
 *  - sessions(v1) / audioClips(v2)
 *  - logEvents(v3): Logger events 영속화 — autoIncrement + sessionId 인덱스로 reload 후 조회.
 *  - kv(v4, v0.14.0 C): 설정 내구 미러 — iOS Safari localStorage evict 방어선.
 *  - screenshots(v5, v0.33.0 10-B): 자동 캡처 JPEG. 키 `${sessionId}:...` 접두 규약(cascade).
 *  - feedbackQueue(v6, v0.33.0 항목11): 개선요청 오프라인/미로그인 재전송 큐.
 *  sessions 레코드의 optional additive 필드(Session.target 등)는 object-store 구조를 바꾸지 않으므로
 *  DB version을 올리지 않는다. 구 레코드는 필드가 없는 채 그대로 로드하고 소비자가 fail-closed 처리한다. */
export function applyAppSchema(db: SchemaTarget): void {
  if (!db.objectStoreNames.contains('sessions')) {
    const store = db.createObjectStore('sessions', { keyPath: 'id' });
    store.createIndex('byDate', 'date');
    store.createIndex('bySync', 'syncedRows');
  }
  if (!db.objectStoreNames.contains('audioClips')) db.createObjectStore('audioClips');
  if (!db.objectStoreNames.contains('logEvents')) {
    const logs = db.createObjectStore('logEvents', { keyPath: 'id', autoIncrement: true });
    logs.createIndex('bySessionId', 'sessionId');
  }
  if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
  if (!db.objectStoreNames.contains('screenshots')) db.createObjectStore('screenshots');
  if (!db.objectStoreNames.contains('feedbackQueue')) {
    db.createObjectStore('feedbackQueue', { keyPath: 'id', autoIncrement: true });
  }
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb() {
  if (!dbPromise) {
    // D1(v0.4.5): rejected/끊긴 promise가 영구 캐시돼 "세션 복구"가 계속 실패하는 것을 방지.
    // - rethrowing-catch: open이 실패하면 캐시를 비워 다음 호출이 새 연결을 연다(현재 호출자는 거부 수신).
    // - terminated: 연결이 비정상 종료되면 캐시를 비워 다음 접근 시 재오픈.
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // 스키마 정의는 applyAppSchema(멱등, 위)가 SSOT — oldVersion 무관하게 부족한 스토어만
        // 생성한다. 스토어 삭제/개조 마이그레이션이 필요해지면 그 단계만 여기서 버전 게이트로.
        applyAppSchema(db);
      },
      terminated() {
        // 연결이 예기치 않게 닫힘(브라우저 회수, PWA 업데이트 등) → 캐시 무효화.
        dbPromise = null;
      },
    }).then(async (db) => {
      // v0.50 개명 — 구 DB('survey-011') 1회 스냅샷 승계. 🔴 resolve **전에** await한다:
      // 뒤로 미루면 업로드 큐·세션 복원이 반쯤 복사된 DB를 읽는다. 프리뷰 빌드는 승계하지
      // 않는다(관찰자 — namespaceMigrate 계약 2). terminated() 재오픈은 마커 point read 1회.
      const isPreview = typeof __PREVIEW_BUILD__ !== 'undefined' && __PREVIEW_BUILD__;
      const summary = shouldMigrateIdb(isPreview) ? await mergeLegacyIdb(db) : null;
      if (summary) {
        // logger는 이 파일(db)을 import한다 — 정적 순환을 피해 동적 import로 계측만 남긴다.
        void import('./logger').then(({ logger }) =>
          logger.log({ type: 'app', extra: `ns_migrate:idb:${summary}` }));
      }
      return db;
    }).catch((e) => {
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

/** D1(v0.4.5): 강제로 캐시된 연결을 버리고 다음 getDb()가 새로 열게 한다.
 *  "세션 복구" 버튼에서 stale/끊긴 연결을 우회해 재하이드레이션하기 위해 사용. */
export function resetDb(): void {
  dbPromise = null;
}

/** v0.49 r6 Y1 — `__survey011FailSessionPutAfter` 전용 카운터(성공한 세션 put 수). 테스트 seam이
 *  꺼져 있으면 증가만 하고 아무도 읽지 않는다(운영 경로 영향 없음).
 *  ⚠️ 기준점은 **seam 값이 바뀐 시점**이다(아래 리셋). 페이지 로드부터 세면 부팅·복원 경로의
 *  put이 몇 건인지를 오라클이 알아야 하는데, 그건 테스트가 재는 대상이 아니라 전제일 뿐이라
 *  조용히 어긋난다(실측으로 한 번 어긋났다 — ④가 「첫 put부터 실패」로 변질됐다). */
let sessionPutCount = 0;
let lastFailAfter: number | undefined;

export async function saveSession(session: Session): Promise<void> {
  // Playwright 지연 경쟁 회귀 seam. 기본 undefined라 운영 경로 비용은 분기 1회뿐이며, 테스트가
  // ManualValueSheet의 fire-and-forget onCommit 동안 sync/confirm 우회를 재현할 때만 사용한다.
  const delayMs = (globalThis as typeof globalThis & { __survey011DelaySessionPutMs?: number })
    .__survey011DelaySessionPutMs;
  if (delayMs && delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  // v0.35.0 R3-FIX-2(리뷰 라운드3) — IDB **쓰기 실패** 주입 seam. 위 지연 seam과 같은 계약(기본
  // undefined → 운영 경로는 분기 1회). 종전엔 '지연 성공'만 재현 가능해, 용량부족·DB 연결 종료·
  // 트랜잭션 실패 같은 durable 실패에서 stop()이 어떻게 행동하는지 검증할 수단이 없었다
  // (그 공백이 곧 "최종 저장 실패를 삼킨다" 버그가 테스트를 통과한 이유다).
  if ((globalThis as typeof globalThis & { __survey011FailSessionPut?: boolean }).__survey011FailSessionPut) {
    throw new Error('injected: session put failed (QuotaExceededError)');
  }
  // v0.49 r6 Y1 — 위 boolean seam의 **순번 변형**: 성공한 put이 N건 쌓인 **뒤부터** 실패한다.
  //   왜 필요한가: durable 실패의 실제 피해는 「첫 put이 실패」와 「값은 저장됐는데 뒤따르는
  //   완료 부기 put이 실패」가 서로 다른 코드 경로다(전자=persistCellValue, 후자=
  //   finalizeRowCompletion). boolean seam 하나로는 둘이 항상 함께 실패해서 **뒤쪽 경로를
  //   단독으로 잴 수 없었고**, 그 사각이 R5-F1(fire-and-forget persist)이 오라클을 통과한 이유다.
  //   운영 경로 비용은 위 둘과 같은 분기 1회(기본 undefined).
  const failAfter = (globalThis as typeof globalThis & { __survey011FailSessionPutAfter?: number })
    .__survey011FailSessionPutAfter;
  if (failAfter !== lastFailAfter) { lastFailAfter = failAfter; sessionPutCount = 0; }
  if (typeof failAfter === 'number' && sessionPutCount >= failAfter) {
    throw new Error('injected: session put failed (QuotaExceededError)');
  }
  // 🔴 v0.52 P2-1(콜드 리뷰 R1 §5) — **「쓰지 않고 성공을 돌려주는」 seam.** 위 두 seam은 put을
  //   *실패*시키므로 `persistSession`이 `false`를 돌려주고, 그러면 **반환값 감지기 하나만으로도**
  //   durable 실패가 잡힌다 — 즉 IDB 되읽기 감지기(`settleModifyDurable` · `commitManualValue`의
  //   hold 갈래)의 **단독 판별력을 잴 수단이 없었다**(리뷰 M4·M-P2b가 green인 이유).
  //   Y1 헤더가 경계한 형상 — *"`persistSession`은 실을 것이 없거나 단조 가드에 걸리면 쓰지 않고
  //   `true`를 돌린다"* — 의 최소 재현이 이것이다: **호출자에겐 성공, IDB엔 옛 값.**
  //   ⚠️ `sessionPutCount`를 올리지 않는다 — 일어나지 않은 put이다(형제 seam의 순번 계약 불변).
  //   운영 경로 비용은 형제 둘과 같은 분기 1회(기본 undefined).
  if ((globalThis as typeof globalThis & { __survey011SwallowSessionPut?: boolean }).__survey011SwallowSessionPut) {
    return;
  }
  const db = await getDb();
  // pendingValidationPersisting은 동시 UI 게이트용 메모리 플래그다. sync가 저장 중 Session을
  // 재저장해도 이 플래그가 IDB에 박혀 reload 후 [확인]을 영구 차단하지 않도록 DB 경계에서 제거한다.
  const durable = { ...session };
  delete durable.pendingValidationPersisting;
  await db.put('sessions', durable);
  sessionPutCount += 1;
}

export async function loadAllSessions(): Promise<Session[]> {
  const db = await getDb();
  const all = (await db.getAll('sessions')) as Session[];
  all.sort((a, b) => b.startedAt - a.startedAt);
  return all;
}

/** 단일 세션 내구 재조회. 메모리 dataStore가 아니라 실제 IDB write 결과를 검증할 때 사용한다. */
export async function loadSession(id: string): Promise<Session | null> {
  const db = await getDb();
  return (await db.get('sessions', id) as Session | undefined) ?? null;
}

/** Delete session row and cascade-delete its audio clips + log events + screenshots.
 *  Clip/screenshot keys follow `${sessionId}:...` so prefix match is safe. */
export async function deleteSession(id: string): Promise<void> {
  const db = await getDb();
  // v0.33.0 10-B — screenshots cascade. 일부 테스트 컨텍스트는 자체 upgrade 핸들러로 구버전 스키마
  // (screenshots 없음)를 만들 수 있어 방어적으로 존재 확인 후 트랜잭션에 포함한다.
  const hasScreens = db.objectStoreNames.contains('screenshots');
  const storeNames = hasScreens
    ? ['sessions', 'audioClips', 'logEvents', 'screenshots']
    : ['sessions', 'audioClips', 'logEvents'];
  const tx = db.transaction(storeNames, 'readwrite');
  await tx.objectStore('sessions').delete(id);

  const prefix = `${id}:`;
  const clipsStore = tx.objectStore('audioClips');
  const allKeys = (await clipsStore.getAllKeys()) as string[];
  for (const key of allKeys) {
    if (typeof key === 'string' && key.startsWith(prefix)) {
      await clipsStore.delete(key);
    }
  }

  if (hasScreens) {
    const screensStore = tx.objectStore('screenshots');
    const screenKeys = (await screensStore.getAllKeys()) as string[];
    for (const key of screenKeys) {
      if (typeof key === 'string' && key.startsWith(prefix)) {
        await screensStore.delete(key);
      }
    }
  }

  const logsStore = tx.objectStore('logEvents');
  const idx = logsStore.index('bySessionId');
  let cursor = await idx.openCursor(id);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }

  await tx.done;
}

/** iOS Safari는 Blob을 IndexedDB에 직접 저장할 때 실패하는 이력이 있음(WebKit 버그).
 *  ArrayBuffer + type 문자열로 분해 저장하면 모든 브라우저에서 안전하게 round-trip됨. */
interface StoredClip {
  buf: ArrayBuffer;
  type: string;
}

function isStoredClip(v: unknown): v is StoredClip {
  return (
    typeof v === 'object' &&
    v !== null &&
    'buf' in v &&
    (v as { buf: unknown }).buf instanceof ArrayBuffer
  );
}

/** v0.35.1 Stage 1-4 — {buf,type} 분해 저장 스토어 팩토리. audioClips·screenshots에 2벌이던
 *  save/load/keys를 통합한다. load는 구형 하위호환(Blob 직접 저장 레코드)도 그대로 지원. */
function blobStore(storeName: 'audioClips' | 'screenshots', defaultType: string) {
  return {
    async save(key: string, blob: Blob): Promise<void> {
      const db = await getDb();
      const buf = await blob.arrayBuffer();
      const record: StoredClip = { buf, type: blob.type || defaultType };
      await db.put(storeName, record, key);
    },
    async load(key: string): Promise<Blob | null> {
      const db = await getDb();
      const v = await db.get(storeName, key);
      if (v == null) return null;
      // 신형: { buf, type } 객체
      if (isStoredClip(v)) return new Blob([v.buf], { type: v.type });
      // 구형 하위호환: Blob을 직접 저장했던 레코드
      if (v instanceof Blob) return v;
      return null;
    },
    async keys(): Promise<string[]> {
      const db = await getDb();
      return (await db.getAllKeys(storeName)) as string[];
    },
  };
}

const audioClips = blobStore('audioClips', 'audio/webm');
// v0.33.0 항목10-B — 자동 화면 캡처. audioClips와 같은 {buf,type} 분해 저장(iOS Safari
// Blob-in-IDB 안전 규약). 캡처는 항상 best-effort — 실패는 호출자(screenshot.ts)가 로깅한다.
const screenshots = blobStore('screenshots', 'image/jpeg');

export const saveAudioClip = audioClips.save;
export const loadAudioClip = audioClips.load;
export const loadAllAudioClipKeys = audioClips.keys;

export async function deleteAudioClip(key: string): Promise<void> {
  const db = await getDb();
  await db.delete('audioClips', key);
}

export const saveScreenshot = screenshots.save;
export const loadScreenshot = screenshots.load;
export const loadAllScreenshotKeys = screenshots.keys;

// ─── 설정 내구 미러 (v0.14.0 C — localStorage eviction 방어) ────────────────
// v0.35.1 Stage 1-4 — 'kv' 스토어 접근 공용 헬퍼. 전 kv 레코드(설정 미러·시트 레코드·과거값
// 인덱스)가 같은 best-effort 계약을 공유한다: IDB 불가/쿼터 초과여도 각 레코드의 1차 경로
// (localStorage persist·인메모리 캐시)는 그대로 동작하므로 조용히 무시한다.
async function kvPut(key: string, value: unknown): Promise<void> {
  try {
    const db = await getDb();
    await db.put('kv', value, key);
  } catch { /* IDB 불가 — 1차 경로가 살아 있으므로 무해 */ }
}

async function kvGet(key: string): Promise<unknown | null> {
  try {
    const db = await getDb();
    return (await db.get('kv', key)) ?? null;
  } catch {
    return null;
  }
}

async function kvDelete(key: string): Promise<void> {
  try {
    const db = await getDb();
    await db.delete('kv', key);
  } catch { /* ignore */ }
}

/** persist된 설정 JSON 문자열을 IDB 'kv' 스토어에 미러(write-through). */
export async function saveSettingsBackup(key: string, value: string): Promise<void> {
  await kvPut(key, value);
}

/** IDB 미러에서 설정 JSON 문자열을 읽는다(localStorage가 evict된 경우 복원용). 없으면 null. */
export async function loadSettingsBackup(key: string): Promise<string | null> {
  const v = await kvGet(key);
  return typeof v === 'string' ? v : null;
}

/** IDB 미러 삭제(설정 초기화 시). */
export async function deleteSettingsBackup(key: string): Promise<void> {
  await kvDelete(key);
}

// ─── 시트 등록 전용 내구 레코드 (v0.19.0 W2 — 업데이트/evict 무관 복원 경로) ──────
/** v0.19.0 W2 — savedSheets(저장 시트 목록)·연결 시트 URL·토큰 표식을 settings persist와 **별개**
 *  IDB 'kv' 레코드로도 미러한다. 홈 설치형 앱 업데이트 부팅 시 localStorage가 evict되면 settings
 *  persist의 IDB 미러가 하이드레이션 레이스로 빈 배열에 덮일 위험이 있었다(W2 근본원인). 이 전용
 *  레코드는 saveSheet/removeSavedSheet에서만 쓰여 bulk write-through(전체 settings 직렬화)에
 *  절대 덮이지 않으므로, 버전 마이그레이션·evict와 무관하게 시트 목록을 결정론적으로 복원한다.
 *  키는 settings persist name과 충돌하지 않도록 `__saved_sheets__` 접두를 쓴다. */
const SHEETS_RECORD_KEY = '__saved_sheets__';

export interface SheetsRecord {
  /** 저장된 스프레드시트 링크 목록(SavedSheet[]의 JSON 직렬화 형태). */
  savedSheets: unknown[];
  /** 마지막으로 연결됐던 시트 URL(부팅 시 settings가 비면 함께 복원 후보). */
  sheetUrl?: string;
  /** 최종 갱신 시각(epoch ms) — 디버깅/관측용. */
  updatedAt: number;
}

export async function saveSheetsRecord(rec: SheetsRecord): Promise<void> {
  await kvPut(SHEETS_RECORD_KEY, rec);
}

export async function loadSheetsRecord(): Promise<SheetsRecord | null> {
  const v = await kvGet(SHEETS_RECORD_KEY);
  if (v && typeof v === 'object' && Array.isArray((v as SheetsRecord).savedSheets)) {
    return v as SheetsRecord;
  }
  return null;
}

// ─── 과거값 인덱스 내구 레코드 (v0.33.0 항목5 — 로그인 무관 이상치 알람) ─────────
/** v0.33.0 항목5 — 과거값 인덱스(pastValues)의 IDB write-through 레코드. 07-13 실기기에서 토큰
 *  만료(~1h, [AUTH-4]) 후 `past_index_skip:not_signed_in`으로 이상치 알람이 침묵해 -99.5% 오데이터가
 *  무알람 통과했다([TREND-AUTH-1] 잔여). 이 레코드는 loadPastIndex 성공 시마다 갱신되고, 부팅/세션
 *  시작 시 fp 일치 + 14일 이내면 폴백 인덱스로 복원되어 **미로그인이어도 알람이 작동**한다.
 *  기존 'kv' 스토어 재사용(신규 스토어·DB 버전 bump 불요). 직렬화/검증은 pastValues.ts 소유 —
 *  여기서는 JSON-호환 레코드의 round-trip만 담당한다(SheetsRecord 패턴). */
const PAST_INDEX_RECORD_KEY = '__past_index__';

export async function savePastIndexBackup(rec: unknown): Promise<void> {
  await kvPut(PAST_INDEX_RECORD_KEY, rec);
}

export async function loadPastIndexBackup(): Promise<unknown | null> {
  return kvGet(PAST_INDEX_RECORD_KEY);
}

/** 설정 초기화(시트 삭제 opt-in) 시 함께 비운다 — fp 불일치로 어차피 안 쓰이지만 데이터 위생. */
export async function deletePastIndexBackup(): Promise<void> {
  await kvDelete(PAST_INDEX_RECORD_KEY);
}

// ─── 화자 STT 프로필 내구 레코드 (v0.51.1 R6 — 기기 누적 혼동표) ────────────────
/** v0.51.1 R6 — `(speaker, micClass)`별 혼동표 프로필(`sttProfileCore.ts`)의 IDB write-through.
 *  기존 'kv' 스토어 재사용(신규 스토어·DB 버전 bump 불요 — 위 헤더의 additive 규약). 세션 경계와
 *  무관하게 앱 삭제 전까지 남는다. 검증·형상은 sttProfileStore.ts 소유 — 여기서는 JSON-호환
 *  레코드의 round-trip만(SheetsRecord 패턴). */
const STT_PROFILES_RECORD_KEY = '__stt_profiles__';

export async function saveSttProfilesRecord(rec: unknown): Promise<void> {
  await kvPut(STT_PROFILES_RECORD_KEY, rec);
}

export async function loadSttProfilesRecord(): Promise<unknown | null> {
  return kvGet(STT_PROFILES_RECORD_KEY);
}

// ─── 개선요청 큐 (v0.33.0 항목11 — 오프라인/미로그인/부분실패 재전송) ────────────
/** 큐 항목: 만들어 둔 feedback zip 원본 + 남은 업로드 레그. zip은 ArrayBuffer로 분해 저장
 *  (iOS Safari Blob-in-IDB 규약 — StoredClip과 동일 이유). 두 레그가 모두 끝나야 삭제된다. */
export interface FeedbackQueueItem {
  id?: number;
  createdAt: number;
  filename: string;
  zipBuf: ArrayBuffer;
  /** 사용자 Drive(agri-voicenote/feedback/) 레그 미완 여부. */
  pendingUser: boolean;
  /** 관리자 폴더(<email>/ 하위) 레그 미완 여부 — non-fatal: 사용자 레그만 성공해도 UX상 성공. */
  pendingAdmin: boolean;
  attempts: number;
  lastError?: string;
}

/** 큐 스토어 부재(구스키마 미러로 만든 테스트 DB 등) 방어 — 전 함수 공통. */
async function feedbackStoreReady(): Promise<IDBPDatabase | null> {
  try {
    const db = await getDb();
    return db.objectStoreNames.contains('feedbackQueue') ? db : null;
  } catch {
    return null;
  }
}

export async function enqueueFeedback(item: Omit<FeedbackQueueItem, 'id'>): Promise<void> {
  const db = await feedbackStoreReady();
  if (!db) return;
  await db.add('feedbackQueue', item);
}

export async function loadFeedbackQueue(): Promise<FeedbackQueueItem[]> {
  const db = await feedbackStoreReady();
  if (!db) return [];
  return (await db.getAll('feedbackQueue')) as FeedbackQueueItem[];
}

export async function updateFeedbackQueueItem(item: FeedbackQueueItem): Promise<void> {
  const db = await feedbackStoreReady();
  if (!db || item.id == null) return;
  await db.put('feedbackQueue', item);
}

export async function deleteFeedbackQueueItem(id: number): Promise<void> {
  const db = await feedbackStoreReady();
  if (!db) return;
  await db.delete('feedbackQueue', id);
}

// ─── Log events (v5.2 Codex 4차 MEDIUM) ────────────────────────────────────
export interface PersistedLogEntry {
  id?: number;
  ts: number;
  type: string;
  sessionId?: string;
  // Loose shape — logger.ts owns the full type; here we only need to round-trip JSON.
  [k: string]: unknown;
}

export async function appendLogEvent(entry: Omit<PersistedLogEntry, 'id'>): Promise<void> {
  try {
    const db = await getDb();
    await db.add('logEvents', entry);
  } catch { /* IDB unavailable or quota — fall back to in-memory only */ }
}

export async function loadLogEvents(sessionIds?: string[]): Promise<PersistedLogEntry[]> {
  const db = await getDb();
  if (!sessionIds) {
    return (await db.getAll('logEvents')) as PersistedLogEntry[];
  }
  if (sessionIds.length === 0) return [];
  const tx = db.transaction('logEvents', 'readonly');
  const idx = tx.objectStore('logEvents').index('bySessionId');
  const results: PersistedLogEntry[] = [];
  for (const sid of sessionIds) {
    const rows = (await idx.getAll(sid)) as PersistedLogEntry[];
    results.push(...rows);
  }
  await tx.done;
  results.sort((a, b) => a.ts - b.ts);
  return results;
}
