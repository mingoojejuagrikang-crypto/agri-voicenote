/**
 * v0.38.0 Critical — 컬럼 사용자 설정은 정확히 같은 스프레드시트·탭 재연결에서만 보존한다.
 * 같은 헤더를 쓰는 다른 농가 시트/탭의 fixed 자동값이 이전 농가 값으로 오염되지 않아야 한다.
 */
import { test, expect, type Page } from '@playwright/test';

import { BASE } from './baseUrl';
const STORE_KEY = 'agri-voicenote-settings-v3';
const SHEET_A = 'SHEET_SOURCE_A';
const SHEET_B = 'SHEET_SOURCE_B';
const URL_A = `https://docs.google.com/spreadsheets/d/${SHEET_A}/edit`;
const URL_B = `https://docs.google.com/spreadsheets/d/${SHEET_B}/edit`;
const HEADERS = ['조사일자', '농가명', '횡경'];

const A_COLUMNS = [
  { id: 'legacy-date', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, sampleKey: false, auto: { kind: 'fixed', value: '오늘' } },
  { id: 'legacy-farm', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, sampleKey: true, auto: { kind: 'fixed', value: '이원창' } },
  { id: 'legacy-width', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, sampleKey: false, auto: { kind: 'fixed', value: '' }, decimals: 2, trendRule: 'decrease', pctThreshold: 30 },
];

type StoredColumn = {
  name: string;
  type: string;
  input: string;
  auto: { kind: string; value?: string };
  decimals?: number;
  trendRule?: string;
  pctThreshold?: number;
};

async function seedSettings(
  page: Page,
  overrides: Record<string, unknown>,
  version = 12,
): Promise<void> {
  await page.addInitScript(
    ({ key, state, persistedVersion }) => {
      localStorage.setItem('gs10_google_token', JSON.stringify({
        access_token: 'sheet-source-token',
        expires_at: Date.now() + 3_600_000,
        email: 'tester@example.com',
      }));
      localStorage.setItem(key, JSON.stringify({ state, version: persistedVersion }));
    },
    {
      key: STORE_KEY,
      persistedVersion: version,
      state: {
        googleConnected: true,
        userEmail: 'tester@example.com',
        sheetUrl: URL_A,
        sheetTab: '농가A',
        columnsSheetId: SHEET_A,
        columnsSheetTab: '농가A',
        availableSheets: ['농가A'],
        savedSheets: [{ name: 'A농가', url: URL_A, sheetId: SHEET_A, addedAt: 1 }],
        columns: A_COLUMNS,
        tableGenerated: false,
        ...overrides,
      },
    },
  );
}

async function mockSheets(page: Page): Promise<void> {
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    const spreadsheetId = path.match(/spreadsheets\/([^/]+)/)?.[1] ?? '';
    if (!path.includes('/values/')) {
      const tabs = spreadsheetId === SHEET_B ? ['농가B'] : ['농가A', '농가B탭'];
      await route.fulfill({ json: {
        spreadsheetId,
        properties: { title: spreadsheetId === SHEET_B ? 'B농가' : 'A농가' },
        sheets: tabs.map((title, index) => ({ properties: { sheetId: index, title, index } })),
      } });
      return;
    }
    const farm = spreadsheetId === SHEET_B || path.includes('농가B탭') ? '강남호' : '이원창';
    const width = farm === '강남호' ? '222' : '111';
    await route.fulfill({ json: { values: [HEADERS, ['2026-07-23', farm, width]] } });
  });
}

async function openSettings(page: Page): Promise<void> {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="tab-settings"]').click();
}

async function readColumnsState(page: Page): Promise<{
  columnsSheetId: unknown;
  columnsSheetTab: unknown;
  columns: StoredColumn[];
}> {
  return page.evaluate((key) => {
    const stored = JSON.parse(localStorage.getItem(key) ?? 'null');
    return {
      columnsSheetId: stored?.state?.columnsSheetId,
      columnsSheetTab: stored?.state?.columnsSheetTab,
      columns: stored?.state?.columns ?? [],
    };
  }, STORE_KEY);
}

function byName(state: { columns: StoredColumn[] }, name: string): StoredColumn {
  const column = state.columns.find((candidate) => candidate.name === name);
  if (!column) throw new Error(`${name} 컬럼을 찾을 수 없습니다.`);
  return column;
}

test('다른 스프레드시트 전환 — B농가 fixed 자동값이 A농가 값으로 오염되지 않는다', async ({ page }) => {
  await seedSettings(page, {
    savedSheets: [
      { name: 'A농가', url: URL_A, sheetId: SHEET_A, addedAt: 1 },
      { name: 'B농가', url: URL_B, sheetId: SHEET_B, addedAt: 2 },
    ],
  });
  await mockSheets(page);
  await openSettings(page);

  await page.getByRole('button', { name: /저장된 시트/ }).click();
  await page.getByTitle(URL_B).click();

  await expect.poll(async () => (await readColumnsState(page)).columnsSheetId).toBe(SHEET_B);
  const state = await readColumnsState(page);
  expect(state.columnsSheetTab).toBe('농가B');
  expect(byName(state, '농가명').auto).toEqual({ kind: 'fixed', value: '강남호' });
});

test('같은 스프레드시트의 다른 탭 전환 — 새 탭 fixed 자동값을 사용한다', async ({ page }) => {
  await seedSettings(page, { availableSheets: ['농가A', '농가B탭'] });
  await mockSheets(page);
  await openSettings(page);

  await page.locator('select:has(option[value="농가B탭"])').selectOption('농가B탭');

  await expect.poll(async () => (await readColumnsState(page)).columnsSheetTab).toBe('농가B탭');
  const state = await readColumnsState(page);
  expect(state.columnsSheetId).toBe(SHEET_A);
  expect(byName(state, '농가명').auto).toEqual({ kind: 'fixed', value: '강남호' });
});

// v0.38.0 리뷰#3(Critical) — v11 저장본은 출처를 **입증할 정보가 없어** backfill하지 않는다.
// 따라서 업그레이드 후 **첫 연결은 보존하지 않고**(시트 표본 유추가 이긴다) 그 시점에 출처를
// 기록한다. 그 다음 같은 시트 재연결부터 정상 보존된다. 이 2단계를 함께 고정한다.
test('v11 업그레이드 — 출처가 없으므로 첫 연결은 시트 표본 유추가 이긴다', async ({ page }) => {
  await seedSettings(page, {
    columnsSheetId: undefined,
    columnsSheetTab: undefined,
  }, 11);
  await mockSheets(page);
  await openSettings(page);

  await page.getByRole('button', { name: /저장된 시트/ }).click();
  await page.getByTitle(URL_A).click();

  await expect.poll(async () => (await readColumnsState(page)).columnsSheetId).toBe(SHEET_A);
  const state = await readColumnsState(page);
  expect(state.columnsSheetTab).toBe('농가A');
  // 시드(A_COLUMNS)의 사용자 설정이 살아남지 않아야 한다 — 출처 미상이므로 보존 대상이 아니다.
  expect(byName(state, '횡경').decimals, 'v11 첫 연결은 시트 표본 유추가 이긴다').not.toBe(2);
  // 이 시점에 출처가 기록되므로, 이후 같은 시트 재연결부터는 보존된다
  // (보존 계약 자체는 sheets-infer-columns.spec.ts의 mergeInferredColumnsForSheet 단위 테스트가 고정).
});

// ── v0.38.0 리뷰#3 Critical — 늦게 도착한 헤더 응답이 현재 탭을 덮지 않는다 ──────────
//
// 시트·탭 선택 컨트롤은 조회 중에도 활성이라 B탭 → C탭을 빠르게 누를 수 있다. C가 먼저 완료된 뒤
// 느린 B 응답이 도착하면 종전에는 무조건 게시해 **화면은 C탭인데 columns·출처는 B**가 됐고,
// 테이블을 재생성하면 B농가 fixed 값이 C 시트에 기록됐다.
test('[리뷰#3] 빠른 탭 전환 — 늦게 도착한 이전 탭 응답이 현재 탭 컬럼을 덮지 않는다', async ({ page }) => {
  let releaseSlowTab: (() => void) | null = null;
  const slowTabStarted = { value: false };
  const slowTabFinished = { value: false };

  await page.route('**://sheets.googleapis.com/**', async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    const spreadsheetId = path.match(/spreadsheets\/([^/]+)/)?.[1] ?? '';
    if (!path.includes('/values/')) {
      await route.fulfill({ json: {
        spreadsheetId,
        properties: { title: 'A농가' },
        sheets: [
          { properties: { sheetId: 0, title: '농가A', index: 0 } },
          { properties: { sheetId: 1, title: '농가B탭', index: 1 } },
        ],
      } });
      return;
    }
    // 먼저 고른 농가B탭의 값 조회만 보류시켜, 뒤에 고른 농가A가 먼저 완료되게 만든다.
    if (path.includes('농가B탭')) {
      slowTabStarted.value = true;
      await new Promise<void>((resolve) => { releaseSlowTab = resolve; });
      await route.fulfill({ json: { values: [HEADERS, ['2026-07-23', '강남호', '222']] } });
      slowTabFinished.value = true;
      return;
    }
    await route.fulfill({ json: { values: [HEADERS, ['2026-07-23', '이원창', '111']] } });
  });

  await seedSettings(page, { availableSheets: ['농가A', '농가B탭'] });
  await openSettings(page);

  const tabSelect = page.locator('select:has(option[value="농가B탭"])');

  // 1) 농가B탭 선택 → 값 조회가 보류된다.
  await tabSelect.selectOption('농가B탭');
  await expect.poll(() => slowTabStarted.value, { timeout: 8000 }).toBe(true);

  // 2) 보류 중에 농가A로 되돌린다 → 이쪽이 먼저 완료된다.
  await tabSelect.selectOption('농가A');
  await expect.poll(async () => (await readColumnsState(page)).columnsSheetTab, { timeout: 8000 })
    .toBe('농가A');
  expect(byName(await readColumnsState(page), '농가명').auto).toEqual({ kind: 'fixed', value: '이원창' });

  // 3) 이제 느린 농가B탭 응답을 흘려보낸다 — 현재 탭(농가A)을 덮으면 안 된다.
  releaseSlowTab?.();
  await expect.poll(() => slowTabFinished.value).toBe(true);

  const final = await readColumnsState(page);
  expect(final.columnsSheetTab, '늦은 응답이 현재 탭 출처를 덮었다').toBe('농가A');
  expect(byName(final, '농가명').auto, '늦은 응답이 현재 탭 자동값을 덮었다')
    .toEqual({ kind: 'fixed', value: '이원창' });
});
