/**
 * v0.50 개명 마이그레이션 — `survey-011` → `agri-voicenote` (민구 확정 2026-08-20).
 *
 * 🔴 **이 파일이 「구 이름」의 SSOT다.** 구 네임스페이스 문자열은 여기 말고 어디에도 새로
 * 적지 않는다. 새 이름 상수는 각자의 집(settingsStore·db·driveUpload)에 있고, 여기의
 * NEW_* 사본과 문자열이 일치해야 한다 — 드리프트는 tests/v050-namespace-migrate.spec.ts가
 * 「앱이 실제로 새 키에 쓰는가」로 잡는다.
 *
 * 설계 계약 v2 (이중 콜드 리뷰 1회전 소비 — codex 7건이 v1의 「매 부팅 merge-by-absence」를
 * 기각했다: 삭제 레코드 부활·pending 이중 소비·낡은 스냅샷 영구 승자. 정본 계획 §8~§9):
 *
 * 1. 🔴 **복사만 한다. 절대 지우지 않는다.** github.io는 프로젝트 경로가 달라도 **같은
 *    origin**이라 localStorage·IndexedDB를 구 정식(`/survey-011/` v0.48)·프리뷰·새 경로가
 *    **전부 공유한다.** 구 DB를 지우면 아직 살아 있는 구 정식 앱의 데이터를 지우는 것이다.
 *
 * 2. **프리뷰 빌드는 IDB를 승계하지 않는다**(`shouldMigrateIdb`). 프리뷰는 관찰자다 —
 *    Drive 폴더를 rename하지 않는 것과 같은 정신. 이래야 「프리뷰가 새 DB를 먼저 채워
 *    정식 첫 부팅의 복사가 낡은 스냅샷이 되는」 함정(v1 §8-2)이 원천 소멸한다:
 *    **정식 첫 부팅 = 민구가 전환하는 시점 = 구 데이터의 최종본**을 그때 뜬다.
 *
 * 3. **1회 스냅샷 + 새 DB 안의 마커.** 마커(`kv[IDB_MARKER_KEY]`)는 localStorage가 아니라
 *    새 DB에 둔다 — localStorage는 iOS가 evict한다(이 레포가 kv 미러를 만든 이유 그대로).
 *    🔴 마커는 **스냅샷을 시도했을 때만** 쓴다(구 DB가 아예 없으면 마커 없이 끝 — 신규
 *    설치 뒤 구 DB가 «나중에» 생기는 비정상 순서에도 안전). **부분 실패도 마커를 남긴다**
 *    (`partial: true`) — 실패 후 자동 재시도는 그 사이 사용자가 지운 레코드를 부활시키므로
 *    하지 않는다(3회전 확정). partial은 계측으로 올라가 사람이 판독·판단한다.
 *
 * 4. 🔴 **feedbackQueue는 복사하지 않는다.** pending의 소유권은 구 앱에 있다 — 복사하면
 *    양쪽이 같은 zip을 각각 업로드한다(codex #4). 전환 절차가 「전환 직전 구 앱을 마지막
 *    1회 열어 pending을 소진한다」를 갖는다(TODO §📛). logEvents도 제외(수천 건 진단
 *    텔레메트리 — 구 DB에 남아 구 앱에서 내보낼 수 있다).
 *
 * 5. **레코드 단위 원자성**: legacy 읽기는 tx 밖에서 먼저, 부재 재확인+put은 **같은
 *    readwrite tx 안**에서 한다 — 검사와 쓰기 사이에 다른 컨텍스트가 끼어들어 신 레코드를
 *    구 값으로 덮는 창(codex #3)을 닫는다.
 *
 * 6. 실패는 **fail-open** — 마이그레이션이 죽어도 부팅은 계속된다(계약 1이 구 데이터
 *    무손상을 보장하므로, 실패의 비용은 「연속성 지연」이지 「유실」이 아니다).
 *
 * ⚠️ **전환 후 구 정식 앱의 병행 사용은 미지원이다** — 스냅샷 이후 구 앱이 쌓는 데이터는
 * 구 DB에만 남는다(유실은 아니다 — 구 앱에서 그대로 보이고 내보낼 수 있다).
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

/** localStorage 복사 완료 마커. 🔴 이게 없으면 복사가 매 부팅 돌아서, 사용자가 새 키를
 *  지운 것(예: 초기화가 tip-seen을 removeItem — useSettingsReset.ts)을 구 키가 다음 부팅에
 *  **부활**시킨다(IDB 축 codex #1의 localStorage 아날로그). evict로 마커가 날아가면 새 키들도
 *  함께 날아간 상태라 재복사가 오히려 복원 경로다 — 일관적. */
const LS_MIGRATED_KEY = 'agri-voicenote-ns-migrated';

/** Drive 폴더 채택(adoption) 완료 마커 — driveUpload.ts가 쓴다. localStorage여도 되는 이유:
 *  rename은 멱등이고(새 이름을 찾으면 끝) 폴더 ID는 rename과 무관하게 불변이라, evict 후
 *  재시도는 검색 1~2회 비용뿐 오동작이 없다. */
export const DRIVE_ADOPTED_KEY = 'agri-voicenote-drive-adopted';

/** 새 DB kv 스토어 안의 IDB 승계 완료 마커 키. 설정 미러 키(`…-settings-v3`)와 네임스페이스가
 *  달라 충돌하지 않고, 구 앱은 이 키를 모른다(legacy kv 복사로 되살아날 일 없음). */
export const IDB_MARKER_KEY = 'ns:migrated';

/**
 * localStorage 키 복사 — **동기**. zustand persist가 스토어 생성 시점에 localStorage를
 * 동기로 읽으므로 settingsStore 모듈 평가 **전에** 돌아야 한다(→ namespaceBoot가 main.tsx
 * 첫 import).
 *
 * 🔴 **IDB와 완전 대칭의 스냅샷 의미론이다** (3회전 — codex 2회전 #3이 비대칭을 기각):
 * - **프리뷰**: copy-if-missing만, **마커를 남기지 않는다.** 프리뷰는 관찰자다 — 마커를
 *   선점하면 「프리뷰가 A를 복사 → 구 정식에서 B로 변경 → 정식 첫 부팅이 A를 정본으로」
 *   가 된다(sheetUrl 포함이라 업로드 대상 오류까지 가능).
 * - **정식 첫 부팅**(마커 없음): 구 키가 있으면 **덮어쓴다(force)** — 전환 시점의 구 정식
 *   설정이 최종본이다. 프리뷰 기간에 프리뷰가 새 키에 남긴 값은 관찰자의 흔적일 뿐이다.
 *   전부 성공했을 때만 마커(부분 실패에 마커를 쓰면 재시도가 영영 없다 — claude 2회전 #1).
 */
export function migrateLocalStorageNamespace(isPreviewBuild: boolean): void {
  try {
    if (localStorage.getItem(LS_MIGRATED_KEY) != null) return;
  } catch { return; }
  const pairs: Array<[string, string]> = [
    [LEGACY_SETTINGS_KEY, NEW_SETTINGS_KEY],
    [LEGACY_TIP_SEEN_KEY, NEW_TIP_SEEN_KEY],
  ];
  let sawLegacy = false;
  let allOk = true;
  for (const [oldKey, newKey] of pairs) {
    try {
      const v = localStorage.getItem(oldKey);
      if (v == null) continue;
      sawLegacy = true;
      if (isPreviewBuild) {
        if (localStorage.getItem(newKey) == null) localStorage.setItem(newKey, v);
      } else {
        localStorage.setItem(newKey, v); // 정식 스냅샷 — 구 정식이 정본, 덮는다
      }
    } catch {
      allOk = false;
    }
  }
  if (!isPreviewBuild && sawLegacy && allOk) {
    try { localStorage.setItem(LS_MIGRATED_KEY, '1'); } catch { /* ignore */ }
  }
}

/** IDB 승계를 이 부팅에서 시도해도 되는가 — 순수 함수(node 스펙이 직접 잰다).
 *  프리뷰가 false인 이유는 머리주석 계약 2. `__PREVIEW_BUILD__`는 컴파일 상수라
 *  브라우저 스펙으로는 프리뷰 분기를 잴 수 없다 — 그래서 판정을 여기로 뽑았다. */
export function shouldMigrateIdb(isPreviewBuild: boolean): boolean {
  return !isPreviewBuild;
}

/** 1회 스냅샷 대상 — feedbackQueue·logEvents 제외는 머리주석 계약 4. */
const SNAPSHOT_STORES = ['sessions', 'audioClips', 'kv', 'screenshots'] as const;

/**
 * 구 IDB(`survey-011`) → 새 IDB **1회 스냅샷 승계**. `getDb()` 체인 맨 앞에서 await된다 —
 * fire-and-forget이면 업로드 큐·세션 복원이 반쯤 복사된 DB를 읽는다.
 * 반환: 계측용 요약 문자열(null = 이미 승계됐거나 구 DB가 없음 — 조용히 통과).
 */
export async function mergeLegacyIdb(newDb: IDBPDatabase): Promise<string | null> {
  try {
    // 승계 완료 마커 — 있으면 끝. 이 검사가 매 부팅의 전체 비용이다(point read 1회).
    if ((await newDb.get('kv', IDB_MARKER_KEY)) !== undefined) return null;

    // 🔴 databases()로 존재를 먼저 확인한다 — 무버전 open은 없던 DB를 **만들어버린다**
    //    (빈 legacy DB가 생기면 다음 부팅부터 영원히 승계를 시도한다).
    //    databases() 미지원 환경(iOS 14 미만)은 legacy 여부를 알 수 없으므로 신규 설치로 취급.
    const listFn = indexedDB.databases?.bind(indexedDB);
    if (!listFn) return null;
    const names = await listFn();
    if (!names.some((d) => d.name === LEGACY_DB_NAME)) return null;

    const legacy = await openDB(LEGACY_DB_NAME); // 버전 무지정 — 현재 버전 그대로 연다
    try {
      let copied = 0;
      let skipped = 0;
      for (const store of SNAPSHOT_STORES) {
        if (!legacy.objectStoreNames.contains(store)) continue;
        if (!newDb.objectStoreNames.contains(store)) continue;
        const keys = await legacy.getAllKeys(store);
        if (keys.length === 0) continue;
        const hasKeyPath = newDb.transaction(store).store.keyPath !== null;
        for (const key of keys) {
          // advisory pre-check — 재시도 부팅에서 이미 복사된 키의 **Blob 전체를 읽고
          // 버리는** 낭비를 막는다(클립 수 MB × N · 부팅 임계 경로 — 2회전 claude #2).
          // 원자성 판정은 아래 tx 안의 재확인이 갖는다 — 이건 최적화일 뿐이다.
          if ((await newDb.getKey(store, key)) !== undefined) { skipped += 1; continue; }
          // legacy 읽기는 tx 밖에서 먼저 — 두 DB를 한 tx 안에서 번갈아 await하면 tx가
          // auto-commit돼 TransactionInactiveError가 난다. 그리고 getAll 일괄 적재는
          // audioClips(클립 Blob 수 MB × N)에서 메모리 피크를 만든다 — 레코드당 처리.
          const val: unknown = await legacy.get(store, key);
          if (val === undefined) continue;
          // 🔴 [store, kv] **복합 tx** — 부재 재확인 + put과 함께 **마커도 재확인**한다.
          //    느린 컨텍스트 B가, 먼저 완주한 A의 마커 이후에 낡은 put을 밀어넣는 창을
          //    닫는다(codex 2회전 #2 — 마커 이후의 모든 쓰기는 이 재확인에서 중단된다).
          const tx = newDb.transaction([store, 'kv'], 'readwrite');
          if ((await tx.objectStore('kv').getKey(IDB_MARKER_KEY)) !== undefined) {
            await tx.done;
            return `yielded:another-context-completed,copied=${copied}`;
          }
          const st = tx.objectStore(store);
          if ((await st.getKey(key)) !== undefined) {
            skipped += 1;
          } else if (hasKeyPath) {
            await st.put(val);
            copied += 1;
          } else {
            await st.put(val, key);
            copied += 1;
          }
          await tx.done;
        }
      }
      // kv 설정 미러 특례 — 스냅샷이 넘겨온 구 키 레코드를 새 키로도 복제해, localStorage가
      // evict된 부팅에서도 mirroredStorage 복원(새 키 조회)이 구 설정을 찾게 한다.
      // 성공 마커도 같은 tx다 — 특례 쓰기·마커 쓰기 모두 **마커 재확인과 원자**여야
      // 느린 컨텍스트가 완료 마커 이후에 값을 쓰거나 마커를 덮는 창이 없다(3회전 #2 잔존분).
      {
        const tx = newDb.transaction('kv', 'readwrite');
        if ((await tx.store.getKey(IDB_MARKER_KEY)) !== undefined) {
          await tx.done;
          return `yielded:another-context-completed,copied=${copied}`;
        }
        if ((await tx.store.getKey(NEW_SETTINGS_KEY)) === undefined) {
          const legacyMirror: unknown = await tx.store.get(LEGACY_SETTINGS_KEY);
          if (legacyMirror !== undefined) {
            await tx.store.put(legacyMirror, NEW_SETTINGS_KEY);
            copied += 1;
          }
        }
        const summary = `copied=${copied},skipped=${skipped}`;
        await tx.store.put({ at: new Date().toISOString(), summary }, IDB_MARKER_KEY);
        await tx.done;
        return summary;
      }
    } finally {
      legacy.close();
    }
  } catch (e) {
    // 🔴 부분 실패는 **재시도하지 않는다** (3회전 — codex 2회전 #1). 실패 후 재시도는
    //    「그 사이 사용자가 지운 레코드」를 부활시킨다 — 부활(시트 중복 행·중복 업로드 =
    //    데이터 오염)이 미복사(구 DB에 안전 보존 — 유실 아님)보다 나쁘다.
    //    partial 마커를 남겨 재시도를 멈추고, 계측이 SOP-003 판독으로 올라간다 —
    //    필요하면 사람이 판단해 수동 재승계한다(자동은 안전한 쪽, 판단은 사람).
    const summary = `error:${e instanceof Error ? e.name : 'unknown'}`;
    try {
      // 같은 tx에서 재확인 — 다른 컨텍스트의 **완료** 마커를 partial로 덮으면 안 된다.
      const tx = newDb.transaction('kv', 'readwrite');
      if ((await tx.store.getKey(IDB_MARKER_KEY)) === undefined) {
        await tx.store.put({ at: new Date().toISOString(), summary, partial: true }, IDB_MARKER_KEY);
      }
      await tx.done;
    } catch { /* 마커조차 못 쓰면 IDB 전체가 죽은 상황 — 다음 부팅 재시도가 낫다 */ }
    return summary; // fail-open (계약 6) — 부팅을 막지 않는다
  }
}
