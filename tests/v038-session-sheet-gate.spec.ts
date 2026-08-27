/**
 * 태스크 07 결함 1 — 시트 전환은 fail-closed이며 메타→헤더 전체가 한 요청 세대를 공유한다.
 */
import { test, expect, type Page } from '@playwright/test';

import { BASE } from './baseUrl';
const STORE_KEY = 'agri-voicenote-settings-v3';
const SHEET_A = 'SHEET_GATE_A';
const SHEET_B = 'SHEET_GATE_B';
const SHEET_C = 'SHEET_GATE_C';
const URL_A = `https://docs.google.com/spreadsheets/d/${SHEET_A}/edit`;
const URL_B = `https://docs.google.com/spreadsheets/d/${SHEET_B}/edit`;
const URL_C = `https://docs.google.com/spreadsheets/d/${SHEET_C}/edit`;

const COLUMNS = [
  { id: 'c1', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, sampleKey: true, auto: { kind: 'fixed', value: 'A농가' } },
  { id: 'c2', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, sampleKey: false, auto: { kind: 'fixed', value: '' }, decimals: 1 },
];

async function seedReadyA(page: Page): Promise<void> {
  await page.addInitScript(
    ({ key, url, sheetId, columns }) => {
      localStorage.setItem('gs10_google_token', JSON.stringify({
        access_token: 'sheet-gate-token',
        expires_at: Date.now() + 3_600_000,
        email: 'tester@example.com',
      }));
      localStorage.setItem(key, JSON.stringify({
        version: 13,
        state: {
          googleConnected: true,
          userEmail: 'tester@example.com',
          sheetUrl: url,
          sheetTab: '농가',
          columnsSheetId: sheetId,
          columnsSheetTab: '농가',
          availableSheets: ['농가'],
          savedSheets: [],
          columns,
          tableGenerated: true,
          totalRows: 1,
          recognitionTolerance: 0.6,
        },
      }));
    },
    { key: STORE_KEY, url: URL_A, sheetId: SHEET_A, columns: COLUMNS },
  );
}

async function openSettings(page: Page): Promise<void> {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="tab-settings"]').click();
}

async function storedState(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null')?.state ?? {}, STORE_KEY);
}

async function sessionCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      const request = indexedDB.open('agri-voicenote');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    if (!db || !db.objectStoreNames.contains('sessions')) return 0;
    return new Promise<number>((resolve) => {
      const request = db.transaction('sessions', 'readonly').objectStore('sessions').count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(-1);
    });
  });
}

test('tableGenerated=true에서 메타 조회 실패 — 시작 버튼 비활성·세션 0건', async ({ page }) => {
  await seedReadyA(page);
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.includes(SHEET_B)) {
      await route.fulfill({ status: 500, body: 'offline' });
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected' });
  });
  await openSettings(page);

  const urlInput = page.getByPlaceholder('스프레드시트 URL 붙여넣기');
  await urlInput.fill(URL_B);
  await page.getByRole('button', { name: '확인', exact: true }).click();
  await expect(page.getByText(/500/)).toBeVisible();
  expect((await storedState(page)).tableGenerated).toBe(false);

  await page.locator('[data-testid="tab-voice"]').click();
  // 전환이 **원자적**이라 실패 시 sheetUrl·columns·출처가 전부 A로 남는다(출처는 일치).
  // 따라서 차단 사유는 "테이블 무효화"이고 안내도 그쪽 문구다 — 어느 쪽이든 **차단 사유가
  // 화면에 뜬다**는 것이 계약이다(무음 실패 금지). 문구 하나에 고정하지 않는다.
  await expect(page.getByRole('alert')).toContainText(/시트 연결을 다시 확인|테이블을 생성/);
  await expect(page.getByRole('button', { name: /음성 입력 시작/ })).toBeDisabled();
  expect(await sessionCount(page)).toBe(0);
});

test('tableGenerated=true에서 헤더 조회 실패 — 시작 버튼 비활성·세션 0건', async ({ page }) => {
  await seedReadyA(page);
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    if (path.includes(SHEET_B) && !path.includes('/values/')) {
      await route.fulfill({ json: {
        spreadsheetId: SHEET_B,
        properties: { title: 'B농가' },
        sheets: [{ properties: { sheetId: 0, title: '농가', index: 0 } }],
      } });
      return;
    }
    if (path.includes(SHEET_B)) {
      await route.fulfill({ status: 500, body: 'header offline' });
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected' });
  });
  await openSettings(page);

  const urlInput = page.getByPlaceholder('스프레드시트 URL 붙여넣기');
  await urlInput.fill(URL_B);
  await page.getByRole('button', { name: '확인', exact: true }).click();
  await expect(page.getByText(/500/)).toBeVisible();
  expect((await storedState(page)).tableGenerated).toBe(false);

  await page.locator('[data-testid="tab-voice"]').click();
  // 전환이 **원자적**이라 실패 시 sheetUrl·columns·출처가 전부 A로 남는다(출처는 일치).
  // 따라서 차단 사유는 "테이블 무효화"이고 안내도 그쪽 문구다 — 어느 쪽이든 **차단 사유가
  // 화면에 뜬다**는 것이 계약이다(무음 실패 금지). 문구 하나에 고정하지 않는다.
  await expect(page.getByRole('alert')).toContainText(/시트 연결을 다시 확인|테이블을 생성/);
  await expect(page.getByRole('button', { name: /음성 입력 시작/ })).toBeDisabled();
  expect(await sessionCount(page)).toBe(0);
});

test('늦은 이전 메타 응답 — 최신 URL·탭·컬럼·출처만 원자적으로 게시', async ({ page }) => {
  let releaseBMeta: (() => void) | null = null;
  let bMetaStarted = false;
  let bMetaFinished = false;

  await seedReadyA(page);
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    const spreadsheetId = path.match(/spreadsheets\/([^/]+)/)?.[1] ?? '';
    if (!path.includes('/values/')) {
      if (spreadsheetId === SHEET_B) {
        bMetaStarted = true;
        await new Promise<void>((resolve) => { releaseBMeta = resolve; });
      }
      await route.fulfill({ json: {
        spreadsheetId,
        properties: { title: spreadsheetId === SHEET_C ? 'C농가' : 'B농가' },
        sheets: [{ properties: { sheetId: 0, title: '농가', index: 0 } }],
      } });
      if (spreadsheetId === SHEET_B) bMetaFinished = true;
      return;
    }
    const farm = spreadsheetId === SHEET_C ? 'C농가' : 'B농가';
    await route.fulfill({ json: { values: [['농가명', '횡경'], [farm, '111.1']] } });
  });
  await openSettings(page);

  const urlInput = page.getByPlaceholder('스프레드시트 URL 붙여넣기');
  await urlInput.fill(URL_B);
  await page.getByRole('button', { name: '확인', exact: true }).click({ noWaitAfter: true });
  await expect.poll(() => bMetaStarted).toBe(true);

  await urlInput.fill(URL_C);
  await urlInput.press('Enter');
  await expect.poll(async () => (await storedState(page)).columnsSheetId).toBe(SHEET_C);

  releaseBMeta?.();
  await expect.poll(() => bMetaFinished).toBe(true);

  const final = await storedState(page);
  expect(final.sheetUrl).toBe(URL_C);
  expect(final.sheetTab).toBe('농가');
  expect(final.columnsSheetId).toBe(SHEET_C);
  expect(final.columnsSheetTab).toBe('농가');
  const farmColumn = (final.columns as Array<{ name: string; auto: { value?: string } }>).find((c) => c.name === '농가명');
  expect(farmColumn?.auto.value).toBe('C농가');
});

// ── v0.38.0 — **v11 업그레이드 직후**의 출처 미상 상태에서 입력을 차단한다 ──────────────
//
// migrate가 출처를 추측 backfill하지 않으므로(리뷰#3 Critical), 업데이트 후 첫 실행은
// `columnsSheetId/Tab = null` + `sheetUrl/sheetTab = 이전 시트` 상태가 된다. columns가 정말
// 그 시트 것인지 **앱이 알 수 없는** 상태라, 그대로 입력을 시작하면 다른 농가 시트에 기록될 수
// 있다. 이 경우 시작을 막고 시트 재연결을 요구하는 것이 fail-closed 계약이다.
//
// ⚠️ 이 테스트는 ReadyState의 `sourceMatches` 게이트를 **유일하게 반증 가능하게** 만든다
// (다른 경로는 전환이 원자적이라 출처가 항상 일치한다). GL-004 [ORCH-18].
test('v11 업그레이드 직후(출처 미상) — 시작이 차단되고 시트 재연결을 안내한다', async ({ page }) => {
  await page.addInitScript(
    ({ key, url, columns }) => {
      localStorage.setItem('gs10_google_token', JSON.stringify({
        access_token: 'sheet-gate-token',
        expires_at: Date.now() + 3_600_000,
        email: 'tester@example.com',
      }));
      // v11 저장본 — columnsSheetId/Tab이 아예 없다(migrate가 null로 둔다).
      localStorage.setItem(key, JSON.stringify({
        version: 11,
        state: {
          googleConnected: true,
          userEmail: 'tester@example.com',
          sheetUrl: url,
          sheetTab: '농가',
          availableSheets: ['농가'],
          savedSheets: [],
          columns,
          tableGenerated: true,
          totalRows: 1,
          recognitionTolerance: 0.6,
        },
      }));
    },
    { key: STORE_KEY, url: URL_A, columns: COLUMNS },
  );
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);

  // migrate가 출처를 null로 남겼는지 먼저 고정(결함 전제 자체를 단언).
  const st = await storedState(page);
  expect(st.columnsSheetId, 'migrate는 출처를 추측하지 않는다').toBeNull();

  await page.locator('[data-testid="tab-voice"]').click();
  await expect(page.getByRole('alert')).toContainText('시트 연결을 다시 확인해 주세요');
  await expect(page.getByRole('button', { name: /음성 입력 시작/ })).toBeDisabled();
  expect(await sessionCount(page)).toBe(0);
});
