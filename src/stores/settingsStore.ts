/**
 * 설정 스토어의 **배선**: zustand `create` + `persist` 미들웨어 + 컬럼 편집 액션.
 *
 * [ENV-12] 2026-08-15 — 세 갈래를 별도 파일로 갈랐다. 경계는 「zustand를 아는가」다:
 *  - `settingsState.ts` — `SettingsState` 형태 + 기본값 SSOT + 입력값 설정 초기화 패치
 *  - `settingsStorage.ts` — localStorage/IDB 미러 + 하이드레이션 게이트
 *  - `settingsMigrate.ts` — persist 버전 마이그레이션 이력(🔴 **문장 순서가 계약**)
 *  - **이 파일** — create·persist 옵션(merge/onRehydrateStorage)·액션
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Column, SavedSheet } from '../types';
import { inferSampleKey, reconcileColumnFlags } from '../lib/columnFlags';
import { isCycling, computeTotalRows } from '../lib/autoValue';
import { localTodayIso } from '../lib/weekTuesday';
import { saveSheetsRecord, loadSheetsRecord } from '../lib/db';
import { logger } from '../lib/logger';
import { markHydrationComplete, mirroredStorage } from './settingsStorage';
import { migrateSettings } from './settingsMigrate';
import {
  inputSettingsResetPatch,
  makeSettingsDefaults,
  touchesInputSettings,
  type SettingsState,
} from './settingsState';

/** [ENV-12] 분리 전 호출부의 import 경로를 그대로 보존하는 재수출. **단방향**이다 —
 *  leaf 3파일은 이 파일을 import하지 않으므로 `[LOGEVENTS-CYCLE-1]` 형태의 배럴 순환이 아니다.
 *  새 코드는 `./settingsState`에서 직접 가져오는 쪽이 낫다. */
export { inputSettingsResetPatch, minConfidenceForTolerance } from './settingsState';

/** v0.35.1 — 인터페이스에서 제거돼 더는 존재하지 않는 영속 키. 하이드레이션 merge에서 걷어낸다
 *  (아래 persist 옵션 merge 참조). 새 필드를 폐기할 땐 여기 추가만 하면 된다.
 *   - review* 6종: 비교탭 정식 제거(Stage 0).
 *   - teamFolderId/userLogFolderId: 계정 미결합 legacy 폴더 캐시 → teamFolderCache/userLogFolderCache로 대체. */
const DEPRECATED_PERSIST_KEYS = [
  'reviewFilters', 'reviewTargetRound', 'reviewBaselineBack',
  'reviewGroupCols', 'reviewMeasureCols', 'reviewSelectedRows',
  'teamFolderId', 'userLogFolderId',
] as const;

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...makeSettingsDefaults(),

      // v0.44.0 §C8 F28 — 입력값 설정 키가 바뀌면 "언제 손질했는지"를 로컬 날짜로 스탬프한다.
      // 호출부가 inputSettingsDate를 명시하면(초기화 패치의 null 등) 그 값을 존중한다.
      set: (partial) => {
        const stamped =
          touchesInputSettings(partial as Record<string, unknown>) && !('inputSettingsDate' in partial)
            ? { ...partial, inputSettingsDate: localTodayIso() }
            : partial;
        set(stamped);
      },
      updateColumn: (id, next) =>
        set((state) => {
          const prev = state.columns.find((c) => c.id === id) ?? null;
          let merged = next;
          // v0.9.0 — 순차/복수선택(cycling) 자동입력으로 *전이*할 때만 음성확인(ttsAnnounce) 기본값을
          // '유'로 올린다. 전이 기반(객체/파라미터 비교가 아님)이라, 한 번 cycling이 된 뒤 사용자가
          // 수동으로 '무'로 되돌리거나 seq 범위·options를 편집해도 그 값이 보존된다(민구 명시 요구:
          // "굳이 들을 필요 없다고 판단하면 수동으로 다시 무로"). non-cycling→cycling 진입에서만 발동.
          if (prev && !isCycling(prev) && isCycling(next)) {
            merged = { ...next, ttsAnnounce: true };
          }
          // v0.12.0 S1 — 대칭 down-transition(민구 명시 요구): cycling→non-cycling 전이 시 음성확인을
          // 자동으로 '무'로 내린다(다값→단일값 ⇒ 음성확인 무). 전이(edge) 기반이라, 이미 단일값 상태에서
          // 사용자가 수동으로 켠 ttsAnnounce는 건드리지 않고 cycling 해제 edge에서만 발동한다. 이 down-edge는
          // up-transition의 "수동 보존" 주석을 의도적으로 덮어쓴다(민구 결정). up/down edge는 상호배타적.
          if (prev && isCycling(prev) && !isCycling(next)) {
            merged = { ...next, ttsAnnounce: false };
          }
          // v0.7.0 — input/type 변경 시 sampleKey 재유추 + 부적격 trendRule 제거(columnFlags 규칙).
          // F28 — 컬럼 손질도 입력값 설정 스탬프 갱신(내부 set은 공개 set 래퍼를 안 거친다).
          const columns = state.columns.map((c) => (c.id === id ? reconcileColumnFlags(prev, merged) : c));
          return {
            columns,
            // 🔴 v0.49 r6 Y10(claude #11) — **행 수가 달라지면 생성 상태를 무효화한다.**
            //   `totalRows`는 「생성」 시점의 `computeTotalRows(columns)` 스냅샷이고(그 액션),
            //   그 뒤 순환 컬럼의 범위(`spanOf`)를 편집해도 종전에는 아무도 다시 세지 않았다.
            //   그러면 `tableGenerated:true`인 채로 화면·세션이 **옛 행 수**를 쓰고 자동값 조합은
            //   **새 span**을 따라 — 끝 도달 판정("아래로 미완료 행 없음")과 실제 조사 대상이 갈린다.
            //   처방은 보수적으로: 행 수가 **실제로 바뀐 경우에만** 생성을 되돌려 사용자가 다시
            //   확인하게 한다(이름·표시 옵션 편집은 종전대로 생성 상태를 유지한다).
            ...(state.tableGenerated && computeTotalRows(columns) !== state.totalRows
              ? { tableGenerated: false }
              : {}),
            inputSettingsDate: localTodayIso(),
          };
        }),
      addColumn: () =>
        set((state) => {
          const col: Column = {
            id: 'c' + Date.now(),
            name: '새 항목',
            type: 'text',
            input: 'auto',
            ttsAnnounce: false,
            auto: { kind: 'fixed', value: '' },
          };
          // v0.7.0 — 신규 컬럼도 샘플키 유추 기본값을 받는다(auto+text → true).
          col.sampleKey = inferSampleKey(col);
          const columns = [...state.columns, col];
          // Y10 — 위 `updateColumn`과 같은 계약(신규 컬럼이 순환이면 행 수가 곱해진다).
          return {
            columns,
            ...(state.tableGenerated && computeTotalRows(columns) !== state.totalRows
              ? { tableGenerated: false }
              : {}),
            inputSettingsDate: localTodayIso(),
          };
        }),
      removeColumn: (id) =>
        set((state) => {
          const columns = state.columns.filter((c) => c.id !== id);
          // Y10 — 순환 컬럼을 지우면 행 수가 나뉜다(같은 계약).
          return {
            columns,
            ...(state.tableGenerated && computeTotalRows(columns) !== state.totalRows
              ? { tableGenerated: false }
              : {}),
            inputSettingsDate: localTodayIso(),
          };
        }),
      reorderColumns: (fromIdx, toIdx) =>
        set((state) => {
          if (fromIdx === toIdx) return state;
          const copy = [...state.columns];
          const [moved] = copy.splice(fromIdx, 1);
          copy.splice(toIdx, 0, moved);
          return { columns: copy, inputSettingsDate: localTodayIso() };
        }),
      saveSheet: (entry) =>
        set((state) => {
          if (!entry.sheetId) return state; // id 없으면 dedupe 불가 — 저장하지 않음
          const rest = state.savedSheets.filter((x) => x.sheetId !== entry.sheetId);
          const savedSheets = [entry, ...rest]; // 최근 사용을 최상단으로
          // v0.19.0 W2 — 전용 IDB 레코드에도 미러(bulk write-through와 무관한 결정론적 복원 경로).
          void saveSheetsRecord({ savedSheets, sheetUrl: state.sheetUrl, updatedAt: Date.now() });
          return { savedSheets };
        }),
      removeSavedSheet: (sheetId) =>
        set((state) => {
          const savedSheets = state.savedSheets.filter((x) => x.sheetId !== sheetId);
          void saveSheetsRecord({ savedSheets, sheetUrl: state.sheetUrl, updatedAt: Date.now() });
          return { savedSheets };
        }),
    }),
    {
      // v0.50 개명 — 구 키 'survey-011-settings-v3'는 namespaceBoot(부팅 첫 import)가
      // 부재 시 복사한다. 🔴 이 문자열은 namespaceMigrate.ts의 NEW_SETTINGS_KEY와 일치 계약.
      name: 'agri-voicenote-settings-v3',
      // v0.51 — v13: 계정 연결 4주 슬라이딩 창(`googleConnection`) 신설 + 기존 로그인 상태 승계.
      version: 13,
      // v0.14.0 C — localStorage + IDB 내구 미러(eviction 방어).
      storage: createJSONStorage(() => mirroredStorage),
      // v0.35.1 — 폐기된 영속 키 제거의 SSOT. migrate가 아닌 merge에 두는 이유: 같은 persist
      // version의 저장본은 zustand가 migrate를 호출하지 않는다 — merge는
      // 모든 하이드레이션에서 돌므로 같은 버전의 기존 기기에서도 잔존 키가 확실히 제거된다
      // (리뷰 라운드1 Codex·Flash 공통 지적). 제거 후 첫 저장부터 직렬화에도 안 남는다.
      merge: (persisted, current) => {
        const p = { ...(persisted as Record<string, unknown>) };
        for (const k of DEPRECATED_PERSIST_KEYS) delete p[k];
        return { ...current, ...(p as Partial<SettingsState>) };
      },
      // v0.14.0 C — 하이드레이션 breadcrumb. 다음 강제종료/시간경과 테스트 로그에서 시트 등록이
      // 살아있었는지(eviction 여부)와 IDB 복원이 작동했는지 판별할 계측. token은 별도 키라 함께 본다.
      onRehydrateStorage: () => (state) => {
        // v0.19.0 W2 — 하이드레이션 게이트 해제(setItem write-through 재개). 세 부팅 경로 모두 이
        // 콜백을 거치므로 여기서 단 1회 연다. 반드시 호출돼야 이후 쓰기가 IDB로 미러된다.
        markHydrationComplete();
        try {
          const hasUrl = !!(state?.sheetUrl && state.sheetUrl.trim());
          const cols = state?.columns?.length ?? 0;
          const saved = state?.savedSheets?.length ?? 0;
          let token = false;
          try { token = !!localStorage.getItem('gs10_google_token'); } catch { /* ignore */ }
          logger.log({
            type: 'app',
            extra: `settings_hydrated:url=${hasUrl ? 'Y' : 'N'},cols=${cols},saved=${saved},token=${token ? 'Y' : 'N'}`,
          });
          // v0.19.0 W2 — settings의 savedSheets가 비었으면(업데이트/evict로 settings persist는
          // 풀렸으나) 전용 IDB 레코드에서 결정론적으로 복원한다. 전용 레코드는 bulk write-through에
          // 절대 덮이지 않으므로 버전 마이그레이션·evict와 무관한 복원 경로다(비동기, best-effort).
          if (saved === 0) {
            void loadSheetsRecord().then((rec) => {
              if (!rec || !Array.isArray(rec.savedSheets) || rec.savedSheets.length === 0) return;
              const cur = useSettingsStore.getState();
              if (cur.savedSheets.length > 0) return; // 그새 채워졌으면 덮지 않음
              const restored = (rec.savedSheets as unknown[]).filter(
                (x): x is SavedSheet =>
                  x !== null && typeof x === 'object' &&
                  typeof (x as SavedSheet).name === 'string' &&
                  typeof (x as SavedSheet).url === 'string' &&
                  typeof (x as SavedSheet).sheetId === 'string' &&
                  typeof (x as SavedSheet).addedAt === 'number',
              );
              if (restored.length === 0) return;
              const patch: Partial<SettingsState> = { savedSheets: restored };
              // 연결 시트 URL도 비어 있으면 전용 레코드 값으로 함께 복원.
              if (!cur.sheetUrl?.trim() && rec.sheetUrl?.trim()) patch.sheetUrl = rec.sheetUrl;
              cur.set(patch);
              logger.log({ type: 'app', extra: `saved_sheets_restored_from_record:${restored.length}` });
            });
          }
        } catch { /* best-effort 계측 */ }
        // v0.44.0 §C8 F28 — 날짜 변경 자동 초기화(민구 확정 08-02: "사용자가 입력값 설정후 날짜가
        // 변경되면 기본값으로 자동 변경 … 로그인정보·구글시트 주소·시트 선택 탭은 제외").
        // 트리거 = **달력 날짜**: 입력값 설정을 마지막으로 손질한 날(inputSettingsDate 스탬프)과
        // 부팅일이 다르면 초기화 패치를 적용한다. 스토어 참조는 비동기로 미룬다 — 이 콜백은
        // create() 도중에도 불릴 수 있어 동기 useSettingsStore 참조가 TDZ에 걸린다(위 loadSheetsRecord
        // .then 패턴과 동일 이유). 한계: 부팅 시에만 검사한다 — 앱을 끄지 않고 자정을 넘긴 뒤
        // 포그라운드 복귀만 하는 경우는 다음 부팅에서 잡힌다(진행 중 세션을 중간에 파괴하지 않기
        // 위한 의도적 보수 — 세션 자체는 session.columns 스냅샷이라 어차피 안전).
        void Promise.resolve().then(() => {
          try {
            const cur = useSettingsStore.getState();
            const stamp = cur.inputSettingsDate;
            const today = localTodayIso();
            if (stamp && stamp !== today) {
              cur.set(inputSettingsResetPatch());
              logger.log({ type: 'app', extra: `input_settings_auto_reset:${stamp}->${today}` });
            }
          } catch { /* best-effort — 실패해도 부팅을 막지 않는다 */ }
        });
      },
      // [ENV-12] 버전 마이그레이션 이력은 `settingsMigrate.ts`가 소유한다 — 본문 무수정 이동.
      // 🔴 문장 순서가 계약이다(무조건 coercion → `version < N` 오름차순). 그 파일 헤더 참조.
      migrate: migrateSettings,
    },
  ),
);
