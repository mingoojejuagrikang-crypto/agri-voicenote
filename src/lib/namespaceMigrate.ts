/**
 * v0.50 개명 마이그레이션 — `survey-011` → `agri-voicenote` (민구 확정 2026-08-20).
 *
 * 🔴 **이 파일이 「구 이름」의 SSOT다.** 구 네임스페이스 문자열은 여기 말고 어디에도 새로
 * 적지 않는다. 새 이름 상수는 각자의 집(settingsStore·db·driveUpload)에 있고, 여기의
 * NEW_* 사본과 문자열이 일치해야 한다 — 드리프트는 tests/v050-namespace-migrate.spec.ts가
 * 「앱이 실제로 새 키에 쓰는가」로 잡는다.
 *
 * 설계 계약 (plans/2026-08-20-rename-agri-voicenote.md §8):
 *
 * 1. 🔴 **복사만 한다. 절대 지우지 않는다.** github.io는 프로젝트 경로가 달라도 **같은
 *    origin**이라 localStorage·IndexedDB를 구 정식(`/survey-011/` v0.48)·프리뷰·새 경로가
 *    **전부 공유한다.** 구 DB를 지우면 아직 살아 있는 구 정식 앱의 데이터를 지우는 것이다.
 *    구 네임스페이스 정리는 구 PWA가 퇴역한 뒤의 별도 회차 몫.
 *
 * 2. **매 부팅 merge-by-absence.** 「새 DB가 비었을 때 1회 복사」로 하면 프리뷰가 새 DB를
 *    먼저 채운 뒤 정식이 부팅할 때 복사가 건너뛰어져 **그 사이 구 정식이 쌓은 데이터가
 *    새 네임스페이스에 영영 안 온다**(스냅샷 함정). 키 단위 부재 복사는 멱등이고 이 함정이 없다.
 *    한계: 같은 키가 양쪽에서 갱신되면 새 쪽이 이긴다(구 값은 구 DB에 그대로 남는다).
 *
 * 3. **logEvents는 복사하지 않는다.** 진단 텔레메트리라 연속성 가치가 낮고 수천 건이라
 *    매 부팅 부재 검사 비용이 크다. 구 진단은 구 DB에 남아 구 앱에서 내보낼 수 있다.
 *
 * 4. 실패는 **fail-open** — 마이그레이션이 죽어도 부팅은 계속된다(구 데이터 무손상이 1번
 *    계약으로 보장되므로, 실패의 비용은 「연속성 지연」이지 「유실」이 아니다).
 */
import { openDB, type IDBPDatabase } from 'idb';

// ── 구 네임스페이스 (여기가 SSOT — 다른 파일에 새로 적지 마라) ─────────────
export const LEGACY_DB_NAME = 'survey-011';
export const LEGACY_SETTINGS_KEY = 'survey-011-settings-v3';
export const LEGACY_TIP_SEEN_KEY = 'survey-011-settings-tip-seen';
export const LEGACY_APP_FOLDER_NAME = 'survey-011';

// ── 새 네임스페이스 사본 — 🔴 각 집(settingsStore.ts·useSettingsReset.ts)과 문자열 일치 필수
const NEW_SETTINGS_KEY = 'agri-voicenote-settings-v3';
const NEW_TIP_SEEN_KEY = 'agri-voicenote-settings-tip-seen';

/**
 * localStorage 키 복사 — **동기**. zustand persist가 스토어 생성 시점에 localStorage를
 * 동기로 읽으므로, 이 함수는 settingsStore 모듈이 평가되기 **전에** 돌아야 한다.
 * → `src/lib/namespaceBoot.ts`를 main.tsx **첫 import**로 둔다(모듈 평가 순서 계약).
 */
export function migrateLocalStorageNamespace(): void {
  const pairs: Array<[string, string]> = [
    [LEGACY_SETTINGS_KEY, NEW_SETTINGS_KEY],
    [LEGACY_TIP_SEEN_KEY, NEW_TIP_SEEN_KEY],
  ];
  for (const [oldKey, newKey] of pairs) {
    try {
      if (localStorage.getItem(newKey) != null) continue; // 이미 있음 — 새 쪽이 정본
      const v = localStorage.getItem(oldKey);
      if (v != null) localStorage.setItem(newKey, v);
    } catch { /* private mode 등 — persist 자체가 없는 환경이라 무해 */ }
  }
}

/** merge-by-absence 대상 스토어 — logEvents 제외는 머리주석 3번. */
const MERGE_STORES = ['sessions', 'audioClips', 'kv', 'screenshots', 'feedbackQueue'] as const;

/**
 * 구 IDB(`survey-011`) → 새 IDB merge-by-absence. `getDb()` 체인 맨 앞에서 await된다 —
 * fire-and-forget이면 업로드 큐·세션 복원과 경쟁한다(플랜 §8-4).
 * 반환: 계측용 요약 문자열(없으면 null = 구 DB 자체가 없음).
 */
export async function mergeLegacyIdb(newDb: IDBPDatabase): Promise<string | null> {
  try {
    // 🔴 databases()로 존재를 먼저 확인한다 — 무버전 open은 없던 DB를 **만들어버린다**
    //    (빈 legacy DB가 생기면 다음 부팅부터 영원히 merge를 시도한다).
    //    databases() 미지원 환경(iOS 14 미만)은 legacy 여부를 알 수 없으므로 신규 설치로 취급.
    const listFn = indexedDB.databases?.bind(indexedDB);
    if (!listFn) return null;
    const names = await listFn();
    if (!names.some((d) => d.name === LEGACY_DB_NAME)) return null;

    const legacy = await openDB(LEGACY_DB_NAME); // 버전 무지정 — 현재 버전 그대로 연다
    try {
      let copied = 0;
      let skipped = 0;
      for (const store of MERGE_STORES) {
        if (!legacy.objectStoreNames.contains(store)) continue;
        if (!newDb.objectStoreNames.contains(store)) continue;
        const keys = await legacy.getAllKeys(store);
        if (keys.length === 0) continue;
        // keyPath 유무로 put 서명이 갈린다(sessions·feedbackQueue는 in-line key).
        const hasKeyPath = newDb.transaction(store).store.keyPath !== null;
        for (const key of keys) {
          // 🔴 레코드당 짧은 트랜잭션 — 두 DB를 한 tx 안에서 번갈아 await하면 tx가
          //    auto-commit돼 TransactionInactiveError가 난다. 그리고 getAll 일괄 적재는
          //    audioClips(클립 Blob 수 MB × N)에서 메모리 피크를 만든다.
          if ((await newDb.getKey(store, key)) !== undefined) { skipped += 1; continue; }
          const val: unknown = await legacy.get(store, key);
          if (val === undefined) continue;
          if (hasKeyPath) await newDb.put(store, val);
          else await newDb.put(store, val, key);
          copied += 1;
        }
      }
      // kv 설정 미러 특례 — merge가 넘겨온 구 키 레코드를 새 키로도 복제해, localStorage가
      // evict된 부팅에서도 mirroredStorage 복원(새 키 조회)이 구 설정을 찾게 한다.
      if (newDb.objectStoreNames.contains('kv')) {
        const cur: unknown = await newDb.get('kv', NEW_SETTINGS_KEY);
        if (cur === undefined) {
          const legacyMirror: unknown = await newDb.get('kv', LEGACY_SETTINGS_KEY);
          if (legacyMirror !== undefined) {
            await newDb.put('kv', legacyMirror, NEW_SETTINGS_KEY);
            copied += 1;
          }
        }
      }
      return `copied=${copied},skipped=${skipped}`;
    } finally {
      legacy.close();
    }
  } catch (e) {
    // fail-open (머리주석 4번) — 부팅을 막지 않는다. 계측만 남긴다.
    return `error:${e instanceof Error ? e.name : 'unknown'}`;
  }
}
