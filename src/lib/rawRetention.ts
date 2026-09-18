/**
 * src/lib/rawRetention.ts — v0.54.0 G1 & G2: 최근 10세션 밖 올린 세션의 :raw 정리.
 *
 * 규칙(민구 승인):
 *  - 세션 저장 직후
 *  - startedAt 기준 최근 10세션 밖
 *  - 드라이브 로그 백업이 끝난 세션만
 *  - :raw 키만 삭제 (:cmd<n>:raw 포함)
 *  - 고아 키는 건드리지 않음
 */
import {
  loadAllSessions,
  loadAllAudioClipKeys,
  deleteAudioClip,
  saveRawUploadedRecord,
  loadRawUploadedRecord,
} from './db';
import { logger } from './logger';
import { rawPruned, rawPruneFailed, rawUploadedRecordFailed } from './logEvents';

export const RAW_KEEP_SESSIONS = 10;

interface RawUploadedRecord {
  ids: string[];
}

export function parseRawUploadedRecord(rec: unknown): string[] {
  if (
    typeof rec === 'object' &&
    rec !== null &&
    'ids' in rec &&
    Array.isArray((rec as { ids: unknown }).ids)
  ) {
    const rawIds = (rec as { ids: unknown[] }).ids;
    if (rawIds.every((x) => typeof x === 'string')) {
      return rawIds as string[];
    }
  }
  return [];
}

const persistedIds = new Set<string>();
let chain: Promise<void> = Promise.resolve();

let _loadRecord = loadRawUploadedRecord;
let _saveRecord = saveRawUploadedRecord;
let _loadSessions: () => Promise<Array<{ id: string; startedAt: number }>> = loadAllSessions;
let _loadClipKeys = loadAllAudioClipKeys;
let _deleteClip = deleteAudioClip;

export function __setRawRetentionStorageForTest(storage: {
  load: () => Promise<unknown>;
  save: (rec: unknown) => Promise<void>;
  loadSessions?: () => Promise<Array<{ id: string; startedAt: number }>>;
  loadClipKeys?: () => Promise<string[]>;
  deleteClip?: (key: string) => Promise<void>;
} | null): void {
  if (storage) {
    _loadRecord = storage.load;
    _saveRecord = storage.save;
    if (storage.loadSessions) _loadSessions = storage.loadSessions;
    if (storage.loadClipKeys) _loadClipKeys = storage.loadClipKeys;
    if (storage.deleteClip) _deleteClip = storage.deleteClip;
  } else {
    _loadRecord = loadRawUploadedRecord;
    _saveRecord = saveRawUploadedRecord;
    _loadSessions = loadAllSessions;
    _loadClipKeys = loadAllAudioClipKeys;
    _deleteClip = deleteAudioClip;
  }
}

export function __resetPersistedIdsForTest(): void {
  persistedIds.clear();
  chain = Promise.resolve();
}

/** 드라이브 백업 완료 세션 ID 목록을 합집합으로 기록 (직렬 큐 적용). */
export function markRawUploaded(ids: string[]): Promise<void> {
  const p = chain.then(async () => {
    const rec = await _loadRecord();
    const currentIds = parseRawUploadedRecord(rec);
    const set = new Set([...currentIds, ...ids]);
    await _saveRecord({ ids: Array.from(set) });
    for (const id of ids) {
      persistedIds.delete(id);
    }
  });
  chain = p.catch(() => {});
  return p;
}

/** 세션이 재저장되었을 때 백업 완료 목록에서 제외 (직렬 큐 적용). */
export function forgetRawUploaded(id: string): Promise<void> {
  const p = chain.then(async () => {
    const rec = await _loadRecord();
    const currentIds = parseRawUploadedRecord(rec);
    const filtered = currentIds.filter((x) => x !== id);
    await _saveRecord({ ids: filtered });
  });
  chain = p.catch(() => {});
  return p;
}

/**
 * v0.54.0 K7: 세션 영속화 시 호출.
 * 이 앱 실행에서 그 id를 아직 안 잊었으면 forgetRawUploaded(id) 후 모듈 Set에 넣고,
 * markRawUploaded가 그 id를 기록하면 Set에서 뺀다.
 */
export async function noteSessionPersisted(id: string): Promise<void> {
  if (persistedIds.has(id)) return;
  persistedIds.add(id);
  try {
    await forgetRawUploaded(id);
  } catch (e) {
    persistedIds.delete(id);
    logger.log({
      type: 'error',
      sessionId: '__app__',
      extra: rawUploadedRecordFailed(String((e as Error)?.message ?? e)),
    });
  }
}

/**
 * 순수 선택 함수:
 *  - 세션을 startedAt 내림차순 정렬하여 앞 keep개 보존
 *  - 나머지 중 uploadedIds에 있는 세션만 대상
 *  - :raw로 끝나는 키 중 sessionId가 대상인 것만 추출
 *  - 세션 목록에 없는 고아 키는 무시
 */
export function selectRawKeysToPrune(
  sessions: ReadonlyArray<{ id: string; startedAt: number }>,
  clipKeys: ReadonlyArray<string>,
  uploadedIds: ReadonlySet<string>,
  keep = RAW_KEEP_SESSIONS,
): { keys: string[]; sessionIds: string[] } {
  const sorted = [...sessions].sort((a, b) => b.startedAt - a.startedAt);
  const olderSessions = sorted.slice(keep);
  const eligibleSessions = olderSessions.filter((s) => uploadedIds.has(s.id));
  const eligibleSessionIds = new Set(eligibleSessions.map((s) => s.id));
  const knownSessionIds = new Set(sessions.map((s) => s.id));

  const keysToPrune: string[] = [];
  const prunedSessionIdSet = new Set<string>();

  for (const key of clipKeys) {
    if (!key.endsWith(':raw')) continue;
    const colon = key.indexOf(':');
    if (colon <= 0) continue;
    const sessId = key.slice(0, colon);

    if (knownSessionIds.has(sessId) && eligibleSessionIds.has(sessId)) {
      keysToPrune.push(key);
      prunedSessionIdSet.add(sessId);
    }
  }

  return {
    keys: keysToPrune,
    sessionIds: Array.from(prunedSessionIdSet),
  };
}

/**
 * 세션 저장 직후 백업 완료된 구세션의 :raw 키들을 정리.
 * 호출자에게 예외를 던지지 않고 실패 시 raw_prune_failed 로깅.
 */
export async function pruneOldRawClips(justSavedId: string): Promise<void> {
  try {
    // 1. 방금 저장된 세션은 올린 뒤 새 녹음이 생겼을 수 있으므로 대상에서 제외
    await forgetRawUploaded(justSavedId);

    // 2. 세션 목록, 오디오 클립 키, 업로드 레코드 읽기
    const [sessions, clipKeys, rec] = await Promise.all([
      _loadSessions(),
      _loadClipKeys(),
      _loadRecord(),
    ]);

    const uploadedIds = new Set(parseRawUploadedRecord(rec));

    // 3. 정리 대상 키 선택
    const { keys, sessionIds } = selectRawKeysToPrune(sessions, clipKeys, uploadedIds);

    // 4. 대상 키 삭제
    for (const key of keys) {
      await _deleteClip(key);
    }

    // 5. 삭제된 건이 있으면 로그 방출
    if (keys.length > 0) {
      logger.log({
        type: 'app',
        sessionId: '__app__',
        extra: rawPruned(sessionIds.length, keys.length),
      });
    }
  } catch (e) {
    logger.log({
      type: 'error',
      sessionId: '__app__',
      extra: rawPruneFailed(String((e as Error)?.message ?? e)),
    });
  }
}
