/**
 * settings persist 마이그레이션 + 설정탭 토글 round-trip.
 *
 * v0.7.0 B1: v4→v5 — 샘플키 자동 유추 + junk 정규화.
 * v0.12.0 AREA1: v6→v7 — speakerOutput(출력 라우팅 토글) 폐기. 순수 추가 마이그(필드 삭제만),
 *   v6 의미는 보존.
 * v0.13.0 R1: v7→v8 — savedSheets(저장 시트 목록) 도입. 구버전 누락/손상은 []로 치유(순수 추가).
 * v0.15.0 A6: v8→v9 — speakerphoneMode(스피커폰 모드) 폐기. 잔존 영속값 삭제만(순수 추가).
 * v0.19.0 W4: v9→v10 — noisyMode(소음 환경 모드) 폐기. 잔존 영속값 삭제만(순수 추가).
 * v0.38.0: v11→v12 — columns를 유추한 스프레드시트·탭 출처를 현재 연결값으로 backfill.
 * v0.19.0 W2: 업데이트/evict로 savedSheets가 소실되지 않음 — ① 구버전(version<10) 유효 savedSheets는
 *   migrate 후 보존 ② 전용 IDB 레코드(__saved_sheets__)에 savedSheets가 있고 settings persist가
 *   비었으면 하이드레이션 후 복원.
 * v0.8.0 WS1: v5→v6 — "추세 검증" → "이상치 알람" 전환.
 *   - 전역 마스터 토글 trendAlertEnabled 삭제(이상치 알람은 컬럼별 규칙 유무로 활성).
 *   - 컬럼별 trendRule을 off로 초기화(의미 반전이라 기존 값은 사용자 의도와 반대 — 클리어).
 *   - pctThreshold(신규 변동률 % 임계값) reconcile 정규화(부적격/비유한수/≤0 제거).
 *   - reviewScope(직전 조사/작기 전체 모드) 삭제 — 조회탭은 최근 2회차 고정(WS4).
 *   - roundDateColId는 보존(UI만 v0.8.0 조회탭으로 이전 — WS4).
 *
 * 샘플키 토글 UI는 v0.8.0에서 조회탭으로 이전(WS4)되므로 설정탭 UI 검증 대신 store 페이로드로
 * 마이그레이션 결과를 검증한다.
 *
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다(수동 기동 불필요, [ORCH-27])
 */
import { test, expect, type Page } from '@playwright/test';
import { IDB, APPLY_APP_SCHEMA_SOURCE } from './fixtures/idb';
import { BASE } from './baseUrl';

test.setTimeout(60_000);
const STORE_KEY = 'agri-voicenote-settings-v3';
const BLUE = 'rgb(41, 121, 255)'; // T.blue — SegmentToggle 활성 배경

async function readStore(page: Page): Promise<{ version: number; state: Record<string, unknown> }> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), STORE_KEY);
}

function colById(stored: { state: Record<string, unknown> }, id: string): Record<string, unknown> {
  const cols = stored.state.columns as Array<Record<string, unknown>>;
  return cols.find((c) => c.id === id)!;
}

/** SegmentToggle 내부에서 라벨이 정확히 일치하는 옵션 버튼. */
function opt(page: Page, toggleId: string, label: string) {
  return page.locator(`[data-testid="${toggleId}"]`).getByRole('button', { name: label, exact: true });
}

// ─── v4→v5: 샘플키 자동 유추 + junk 정규화 (store 페이로드로 검증) ─────────────

/** v0.6.0(version 4) 페이로드 — sampleKey/trendRule/전역 필드 없음. junk 2건 포함. */
const V4_COLUMNS = [
  { id: 'c1', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' } },
  { id: 'c3', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: 'yes' },
  { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 10 } },
  { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, trendRule: 'bogus' },
  { id: 'c10', name: '비고', type: 'text', input: 'touch', ttsAnnounce: false, auto: { kind: 'fixed', value: '' } },
];

const V4_PAYLOAD = {
  state: {
    googleConnected: false, userEmail: null, sheet: null, sheetUrl: '', sheetTab: '',
    availableSheets: [], manualMode: false, columns: V4_COLUMNS, tableGenerated: false,
    totalRows: 50, ttsRate: 1.05, sessionLabelColId: null, sessionAutoLabel: null,
    noisyMode: false, speakerphoneMode: false, preferredVoiceName: '',
    teamFolderId: null, userLogFolderId: null,
  },
  version: 4,
};

async function bootWith(page: Page, payload: unknown) {
  await page.addInitScript(
    ({ key, p }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(p));
    },
    { key: STORE_KEY, p: payload },
  );
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
}

test('v4→v6 migrate — 샘플키 자동 유추 + junk 정규화 + 최신 버전', async ({ page }) => {
  await bootWith(page, V4_PAYLOAD);

  await expect.poll(async () => (await readStore(page)).version).toBe(13);
  const stored = await readStore(page);

  // 샘플키 유추 규칙: auto && !date → true. junk 'yes'(c3)는 boolean 아니라 유추 적용.
  expect(colById(stored, 'c1').sampleKey).toBe(false); // date → 무
  expect(colById(stored, 'c3').sampleKey).toBe(true);  // junk 'yes' → 유추 true
  expect(colById(stored, 'c6').sampleKey).toBe(true);  // auto int → 유
  expect(colById(stored, 'c8').sampleKey).toBe(false); // voice → 무
  expect(colById(stored, 'c10').sampleKey).toBe(false); // touch → 무

  // v6 전환: trendRule(junk 'bogus' 포함) 전부 클리어, pctThreshold 없음, 전역 토글 삭제.
  expect(colById(stored, 'c8').trendRule).toBeUndefined();
  expect(colById(stored, 'c8').pctThreshold).toBeUndefined();
  expect(stored.state.trendAlertEnabled).toBeUndefined();
  // reviewScope는 삭제(조회탭 최근 2회차 고정), roundDateColId는 보존(UI만 WS4 조회탭으로 이전).
  expect(stored.state.reviewScope).toBeUndefined();
  expect(stored.state.roundDateColId).toBe(null);

  // v11(v0.20.0): 구버전 영속본엔 recognitionTolerance 필드가 없으므로 기본 0.60으로 치유된다.
  expect(stored.state.recognitionTolerance).toBe(0.6);
});

// ─── v5→v6: 이상치 알람 전환 ──────────────────────────────────────────────

/** v0.7.0(version 5) 페이로드 — 전역 trendAlertEnabled + 컬럼별 trendRule(구 의미) + pctThreshold
 *  junk. v6 migrate가 토글 삭제 + trendRule 클리어 + pctThreshold 정규화를 해야 한다. */
const V5_COLUMNS = [
  { id: 'c1', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 10 }, sampleKey: true },
  // 적격 컬럼 — trendRule(구 의미) 저장돼 있고 pctThreshold도 음수 junk.
  { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'increase', pctThreshold: -5 },
  // 부적격(텍스트) 컬럼에 잘못 들어간 pctThreshold도 제거돼야 한다.
  { id: 'c10', name: '비고', type: 'text', input: 'touch', ttsAnnounce: false, auto: { kind: 'fixed', value: '' }, sampleKey: false, pctThreshold: 20 },
];

const V5_PAYLOAD = {
  state: {
    googleConnected: false, userEmail: null, sheet: null, sheetUrl: '', sheetTab: '',
    availableSheets: [], manualMode: false, columns: V5_COLUMNS, tableGenerated: false,
    totalRows: 50, ttsRate: 1.05, sessionLabelColId: null, sessionAutoLabel: null,
    noisyMode: false, speakerphoneMode: false, preferredVoiceName: '',
    teamFolderId: null, userLogFolderId: null,
    trendAlertEnabled: true, roundDateColId: 'c1', reviewScope: 'season',
  },
  version: 5,
};

test('v5→v6 migrate — trendAlertEnabled 삭제 + trendRule 초기화 + pctThreshold 정규화', async ({ page }) => {
  await bootWith(page, V5_PAYLOAD);

  await expect.poll(async () => (await readStore(page)).version).toBe(13);
  const stored = await readStore(page);

  // 전역 마스터 토글 제거.
  expect(stored.state.trendAlertEnabled).toBeUndefined();

  // 컬럼별 trendRule off로 초기화(의미 반전 → 클리어).
  expect(colById(stored, 'c8').trendRule).toBeUndefined();

  // pctThreshold: 음수 junk(c8)·부적격 컬럼(c10) 모두 제거.
  expect(colById(stored, 'c8').pctThreshold).toBeUndefined();
  expect(colById(stored, 'c10').pctThreshold).toBeUndefined();

  // reviewScope('season')는 삭제, roundDateColId('c1')는 보존(UI만 WS4 조회탭으로 이전).
  expect(stored.state.reviewScope).toBeUndefined();
  expect(stored.state.roundDateColId).toBe('c1');

  // v11(v0.20.0): recognitionTolerance 없는 구버전 → 기본 0.60으로 치유.
  expect(stored.state.recognitionTolerance).toBe(0.6);
});

test('v5→v6 migrate idempotent — 이미 v6면 사용자가 새 의미로 설정한 trendRule 보존', async ({ page }) => {
  const v6Payload = {
    state: { ...V5_PAYLOAD.state, trendAlertEnabled: undefined,
      columns: [
        { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'increase', pctThreshold: 15 },
      ] },
    version: 6,
  };
  await bootWith(page, v6Payload);

  await expect.poll(async () => (await readStore(page)).version).toBe(13);
  const stored = await readStore(page);
  // v6 이상은 새 의미 — trendRule/pctThreshold 보존.
  expect(colById(stored, 'c8').trendRule).toBe('increase');
  expect(colById(stored, 'c8').pctThreshold).toBe(15);
});

test('다운그레이드 라운드트립 방어 — v5로 재기록돼도 마커 있으면 v6 trendRule 보존', async ({ page }) => {
  // 시나리오: v6에서 trendRule 설정(+마커 set) → v5 번들로 열려 스토리지가 version:5로 재기록
  // (마커는 shallow merge로 잔존) → v6 재오픈. version<6이 다시 참이지만 마커 때문에 재클리어 안 함.
  const downgradedPayload = {
    state: {
      ...V5_PAYLOAD.state,
      trendRuleClearedV6: true, // v6 클리어를 이미 1회 수행했다는 마커(다운그레이드에도 잔존)
      columns: [
        { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'increase', pctThreshold: 15 },
      ],
    },
    version: 5, // 다운그레이드로 v5로 재기록된 상태
  };
  await bootWith(page, downgradedPayload);

  await expect.poll(async () => (await readStore(page)).version).toBe(13);
  const stored = await readStore(page);
  // 마커가 있으므로 재클리어하지 않고 사용자가 v6에서 설정한 값 보존.
  expect(colById(stored, 'c8').trendRule).toBe('increase');
  expect(colById(stored, 'c8').pctThreshold).toBe(15);
});

// ─── 설정탭 토글 round-trip (이상치 알람 라벨 + % 임계값 입력) ──────────────

test('이상치 알람 토글 round-trip — 증가 선택 + % 임계값 입력 → store 반영 + reload 유지', async ({ page }) => {
  await bootWith(page, V4_PAYLOAD);
  await page.locator('[data-testid="tab-settings"]').click();

  // c8(적격) 이상치 알람: '증가' 선택(구 라벨 '커짐' 대체).
  await opt(page, 'trend-rule-c8', '증가').click();
  // % 변동률 임계값 입력.
  const pct = page.locator('[data-testid="pct-threshold-c8"]');
  await pct.fill('15');
  await pct.blur();

  await expect.poll(async () => colById(await readStore(page), 'c8').trendRule).toBe('increase');
  expect(colById(await readStore(page), 'c8').pctThreshold).toBe(15);

  // reload 후 유지.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="tab-settings"]').click();
  await expect(opt(page, 'trend-rule-c8', '증가')).toHaveCSS('background-color', BLUE);
  await expect(page.locator('[data-testid="pct-threshold-c8"]')).toHaveValue('15');
});

test('% 임계값 빈 값 → undefined, 부적격 전환 시 trendRule·pctThreshold 클리어', async ({ page }) => {
  await bootWith(page, V4_PAYLOAD);
  await page.locator('[data-testid="tab-settings"]').click();

  await opt(page, 'trend-rule-c8', '감소').click();
  const pct = page.locator('[data-testid="pct-threshold-c8"]');
  await pct.fill('30');
  await pct.blur();
  await expect.poll(async () => colById(await readStore(page), 'c8').pctThreshold).toBe(30);

  // 빈 값 → undefined.
  await pct.fill('');
  await pct.blur();
  await expect.poll(async () => colById(await readStore(page), 'c8').pctThreshold).toBeUndefined();

  // c8 입력 음성 → 자동: 부적격 전환 → 토글·% 입력 소멸 + trendRule/pctThreshold 클리어.
  await opt(page, 'trend-rule-c8', '증가').click();
  await pct.fill('25'); // 다시 채우고
  await pct.blur();
  const c8Card = page.locator('[data-testid="col-card-c8"]');
  await c8Card.getByRole('button', { name: '자동', exact: true }).click();
  await expect(page.locator('[data-testid="trend-rule-c8"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="pct-threshold-c8"]')).toHaveCount(0);
  const c8 = colById(await readStore(page), 'c8');
  expect(c8.trendRule).toBeUndefined();
  expect(c8.pctThreshold).toBeUndefined();
});

// ─── v0.19.0 W2 — savedSheets 생존(앱 업데이트/evict 무관) ─────────────────────

const VALID_SHEETS = [
  { name: '이원창 농장', url: 'https://docs.google.com/spreadsheets/d/SHEET_A', sheetId: 'SHEET_A', addedAt: 1_700_000_000_000 },
  { name: '시험구 B', url: 'https://docs.google.com/spreadsheets/d/SHEET_B', sheetId: 'SHEET_B', addedAt: 1_700_000_100_000 },
];

/** ① 구버전(version<10) 영속본에 유효 savedSheets가 있으면 migrate 후 보존(순수 추가 마이그가
 *  유효 배열을 절대 떨어뜨리지 않는다). */
test('W2 ① v8→v10 migrate — 유효 savedSheets 보존', async ({ page }) => {
  const payload = {
    state: { ...V4_PAYLOAD.state, savedSheets: VALID_SHEETS },
    version: 8,
  };
  await bootWith(page, payload);

  await expect.poll(async () => (await readStore(page)).version).toBe(13);
  const stored = await readStore(page);
  const saved = stored.state.savedSheets as Array<{ sheetId: string }>;
  expect(saved.map((s) => s.sheetId)).toEqual(['SHEET_A', 'SHEET_B']);
});

/** ② 전용 IDB 레코드 복원(결정론적, 레이스 타이밍 없음): settings persist의 savedSheets는 비었지만
 *  전용 IDB 레코드 __saved_sheets__에 유효 savedSheets가 있으면 하이드레이션 후 복원된다. 이 레코드는
 *  saveSheet/removeSavedSheet만 쓰므로 bulk write-through(전체 settings 직렬화)에 절대 덮이지 않는
 *  버전 마이그/evict 무관 복원 경로다(W2 근본원인 = bulk write-through clobber의 회피 백본). */
test('W2 ② 전용 IDB 레코드에서 savedSheets 복원 (settings persist는 비어있음)', async ({ page }) => {
  // settings persist는 savedSheets:[]인 상태로 부팅하되, 전용 레코드를 미리 IDB에 심는다.
  await page.addInitScript(
    ({ key, rec, idb, schemaSrc }) => {
      // settings persist 시드(savedSheets 비어있음 — 업데이트로 풀린 상태 모사).
      const persisted = {
        state: {
          googleConnected: false, userEmail: null, sheet: null, sheetUrl: '', sheetTab: '',
          availableSheets: [], savedSheets: [], manualMode: false, columns: [], tableGenerated: false,
          totalRows: 50, ttsRate: 1.05, sessionLabelColId: null, sessionAutoLabel: null,
          fastRecognition: false, preferredVoiceName: '', teamFolderId: null, userLogFolderId: null,
          roundDateColId: null, reviewFilters: [], reviewTargetRound: null, reviewBaselineBack: 1,
          reviewGroupCols: null, reviewMeasureCols: null, reviewSelectedRows: null,
        },
        version: 10,
      };
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(persisted));
      // 전용 IDB 레코드 __saved_sheets__를 'kv' 스토어에 직접 심는다(스키마는 fixture 미러 SSOT).
      const applySchema = (0, eval)(`(${schemaSrc})`) as (db: IDBDatabase) => void;
      const open = indexedDB.open(idb.name, idb.version);
      open.onupgradeneeded = () => applySchema(open.result);
      open.onsuccess = () => {
        try {
          const db = open.result;
          const tx = db.transaction('kv', 'readwrite');
          tx.objectStore('kv').put({ savedSheets: rec, sheetUrl: '', updatedAt: Date.now() }, '__saved_sheets__');
        } catch { /* ignore */ }
      };
    },
    { key: STORE_KEY, rec: VALID_SHEETS, idb: IDB, schemaSrc: APPLY_APP_SCHEMA_SOURCE },
  );
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  // 하이드레이션 후 onRehydrateStorage의 비동기 복원이 settings store에 savedSheets를 채운다.
  await expect.poll(async () => {
    const saved = await page.evaluate((key) => {
      const raw = JSON.parse(localStorage.getItem(key) ?? 'null');
      return (raw?.state?.savedSheets ?? []).length;
    }, STORE_KEY);
    return saved;
  }, { timeout: 10_000 }).toBe(2);

  const stored = await readStore(page);
  const saved = stored.state.savedSheets as Array<{ sheetId: string }>;
  expect(saved.map((s) => s.sheetId).sort()).toEqual(['SHEET_A', 'SHEET_B']);
});

// ─── v0.38.0 — v11→v12 columns 출처 backfill ─────────────────────────────────

// v0.38.0 리뷰#3(Critical) — v11에는 columns의 출처를 **입증할 정보가 없다.** 종전 구현은
// 현재 sheetUrl·sheetTab에서 backfill했는데, 그 추측은 오류 경로에서 깨진다: sheetUrl·sheetTab은
// loadHeaders **전에** 저장되므로 헤더 조회가 실패하면 "URL은 B농가, columns는 A농가" 불일치가
// 남고, backfill이 A컬럼을 B의 것으로 확정해 **B 시트에 A농가 값이 기록**된다.
// 그래서 backfill하지 않고 null로 둔다 — 첫 재연결에서 새 유추값을 쓰는 안전한 방향으로 실패한다.
test('v11→v12 migrate — columns 출처를 추측해 backfill하지 않는다(null)', async ({ page }) => {
  const payload = {
    state: {
      ...V4_PAYLOAD.state,
      sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_A/edit',
      sheetTab: '농가A',
    },
    version: 11,
  };
  await bootWith(page, payload);

  await expect.poll(async () => (await readStore(page)).version).toBe(13);
  const stored = await readStore(page);
  expect(stored.state.columnsSheetId).toBeNull();
  expect(stored.state.columnsSheetTab).toBeNull();
});

// ─── v0.35.1 — 같은 버전(현재 v13) 폐기 키 제거: merge-strip (리뷰 라운드1 Codex·Flash 공통 지적) ───
// 저장본도 현재 version이면 zustand는 migrate를 호출하지 않는다.
// 폐기 키 제거는 merge 단계(DEPRECATED_PERSIST_KEYS strip)가 담당해야 하고, 이 테스트가 그 계약을
// 고정한다: 이미 현재 버전인 기기에 남은 review* 6키 + legacy 폴더 캐시 2키가 하이드레이션에서
// 제거되고 다음 저장(설정 조작)에 다시 직렬화되지 않는다.
// v0.51 — persist version이 12→13으로 오르면서 페이로드 version도 함께 올렸다. 12로 두면 migrate가
// 돌아버려 「같은 버전이라 migrate가 안 도는데도 제거되는가」라는 이 테스트의 전제 자체가 사라진다.
test('현재 버전 동일 저장본: 폐기 키(review* 6종 + legacy 폴더 캐시)가 merge에서 제거되어 다음 저장에 안 남는다', async ({ page }) => {
  const V12_LEFTOVER_PAYLOAD = {
    state: {
      googleConnected: false, userEmail: null, sheet: null, sheetUrl: '', sheetTab: '',
      availableSheets: [], savedSheets: [], manualMode: false, columns: [], tableGenerated: false,
      totalRows: 50, ttsRate: 1.05, sessionLabelColId: null, sessionAutoLabel: null,
      fastRecognition: false, preferredVoiceName: '', roundDateColId: null,
      // 폐기 키 8종 — v0.35.0 이하가 남긴 잔존값 모사.
      reviewFilters: [{ colId: 'c3', value: 'A' }], reviewTargetRound: '2026-07-01',
      reviewBaselineBack: 2, reviewGroupCols: ['c3'], reviewMeasureCols: null, reviewSelectedRows: null,
      teamFolderId: 'stale-team-folder', userLogFolderId: 'stale-log-folder',
    },
    version: 13,
  };
  await bootWith(page, V12_LEFTOVER_PAYLOAD);
  await page.waitForTimeout(400);

  // 설정 하나를 조작해 재직렬화를 트리거(자동 캡처 토글 off→on — 순수 쓰기 트리거).
  await page.locator('[data-testid="tab-settings"]').click();
  const toggle = page.locator('[data-testid="auto-capture-toggle"]');
  await toggle.scrollIntoViewIfNeeded();
  await toggle.click();
  await page.waitForTimeout(200);
  await toggle.click();
  await page.waitForTimeout(200);

  const stored = await readStore(page);
  expect(stored.version).toBe(13);
  for (const k of [
    'reviewFilters', 'reviewTargetRound', 'reviewBaselineBack',
    'reviewGroupCols', 'reviewMeasureCols', 'reviewSelectedRows',
    'teamFolderId', 'userLogFolderId',
  ]) {
    expect(stored.state[k], `${k} 잔존`).toBeUndefined();
  }
  // 대체 필드는 기본값으로 존재(계정 결합 캐시 — 초기 null).
  expect(stored.state.teamFolderCache).toBeNull();
  expect(stored.state.userLogFolderCache).toBeNull();
});

// ─── v13 (v0.51) — 「계정 연결」 4주 슬라이딩 창 도입 + 기존 로그인 상태 승계 ───────────────
// 민구 확정(08-27 결정②): 업데이트 직후 **재로그인 0회**. v12 이하 저장본에 googleConnected:true가
// 있으면 연결 기록을 `{connectedAt: now, lastUsedAt: now}`로 합성해 업데이트가 곧 4주 창의 시작이
// 되게 한다. 🔴 이 합성은 **블래스트 반경이 있다** — googleConnected:true를 시딩하는 기존 스펙들이
// 전부 "연결 살아있음" 전제로 바뀐다(빌더 산출물의 전수 판정표 참조).

test('v12→v13 migrate — googleConnected:true면 연결 기록을 합성한다(재로그인 0회)', async ({ page }) => {
  const before = Date.now();
  const payload = {
    state: { ...V4_PAYLOAD.state, googleConnected: true, userEmail: 'tester@example.com' },
    version: 12,
  };
  await bootWith(page, payload);

  await expect.poll(async () => (await readStore(page)).version).toBe(13);
  const stored = await readStore(page);
  const conn = stored.state.googleConnection as { email: string; connectedAt: number; lastUsedAt: number };
  expect(conn, '연결 기록이 합성되지 않았다 — 전 사용자가 업데이트 후 재로그인해야 한다').toBeTruthy();
  expect(conn.email).toBe('tester@example.com');
  // 마이그레이션 시점(now) 기준 — 진짜 마지막 사용 시각은 v12 저장본에 없다(의도된 추정).
  expect(conn.connectedAt).toBeGreaterThanOrEqual(before);
  expect(conn.lastUsedAt).toBeGreaterThanOrEqual(before);
  // ⚠️ `googleConnected` 자체가 유지되는가는 **이 마이그레이션의 계약이 아니다** — 강등 분기의
  //    의미 변경(토큰 無 + 창 유효 → 유지)이 담당하고, tests/v051-connection-window.spec.ts가 고정한다.
});

test('v12→v13 migrate — 미로그인(googleConnected:false)에는 창을 만들지 않는다', async ({ page }) => {
  await bootWith(page, { state: { ...V4_PAYLOAD.state, googleConnected: false }, version: 12 });

  await expect.poll(async () => (await readStore(page)).version).toBe(13);
  const stored = await readStore(page);
  expect(stored.state.googleConnection, '연결한 적 없는 사용자에게 창이 생겼다').toBeNull();
});

test('v13 coercion — 손상된 연결 기록은 null로 치유한다(만료 쪽이 안전 기본값)', async ({ page }) => {
  await bootWith(page, {
    state: {
      ...V4_PAYLOAD.state,
      googleConnected: true,
      userEmail: 'tester@example.com',
      // 형태 손상: lastUsedAt이 문자열 — isConnectionRecord 실패 → null 치유 → 그 다음 v13 게이트가
      // googleConnected:true를 보고 **새로** 합성한다(치유가 승계를 막지 않는다는 순서 계약).
      googleConnection: { email: 'x@y.z', connectedAt: 'nope', lastUsedAt: 'nope' },
    },
    version: 12,
  });

  await expect.poll(async () => (await readStore(page)).version).toBe(13);
  const stored = await readStore(page);
  const conn = stored.state.googleConnection as { email: string; connectedAt: number; lastUsedAt: number };
  expect(typeof conn.connectedAt).toBe('number');
  expect(typeof conn.lastUsedAt).toBe('number');
  expect(conn.email).toBe('tester@example.com');
});

test('v13 idempotent — 이미 있는 연결 기록은 다운그레이드 라운드트립에도 덮지 않는다', async ({ page }) => {
  // v13에서 20일 전에 열린 연결이, 어떤 이유로 version만 12로 재기록된 저장본(다운그레이드
  // 라운드트립 — v6 마커 방어와 같은 축). 합성이 lastUsedAt을 now로 밀면 창이 **부당하게 연장**된다.
  const OLD = Date.now() - 20 * 24 * 60 * 60 * 1000;
  await bootWith(page, {
    state: {
      ...V4_PAYLOAD.state,
      googleConnected: true,
      userEmail: 'tester@example.com',
      googleConnection: { email: 'tester@example.com', connectedAt: OLD, lastUsedAt: OLD },
    },
    version: 12,
  });

  await expect.poll(async () => (await readStore(page)).version).toBe(13);
  const stored = await readStore(page);
  const conn = stored.state.googleConnection as { connectedAt: number; lastUsedAt: number };
  expect(conn.connectedAt).toBe(OLD);
  // 부팅 touch(App.tsx)는 창이 살아 있으면 lastUsedAt을 now로 민다 — 그건 정상 동작이므로
  // 여기서는 「마이그레이션이 connectedAt을 덮지 않았다」만 고정한다(창 슬라이딩 계약은 별도 스펙).
  expect(conn.lastUsedAt).toBeGreaterThanOrEqual(OLD);
});
