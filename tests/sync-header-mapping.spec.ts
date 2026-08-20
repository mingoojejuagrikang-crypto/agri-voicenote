/**
 * [SYNC-3] fix — header-name-based column mapping, full-app e2e regression.
 *
 * columnMapping.spec.ts already covers the pure-function logic in isolation. This file wires the
 * SAME scenarios through the real syncSelected() -> appendRows() -> Sheets API call path (stubbed
 * via page.route, same pattern as sync-skip-rows.spec.ts) to prove sync.ts actually USES the
 * header fetch + mapping — not just that the helper functions are individually correct.
 *
 * Real-device root cause (2026-07-07 v0.28.0 A5, Sonar): a local 6-column session synced against
 * a real 10-column sheet landed its values 2 columns over (positional write, no header check).
 *
 * Cases:
 *  (b) sheet has MORE columns than local — values must land at the NAMED column, not column A/B.
 *  (c) column order differs, names match — proves name-based (not positional) placement.
 *
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다(수동 기동 불필요, [ORCH-27])
 */
import { test, expect, type Page } from '@playwright/test';
import { IDB, APPLY_APP_SCHEMA_SOURCE } from './fixtures/idb';
import { BASE } from './baseUrl';

test.setTimeout(60_000);

interface SheetCall { method: string; url: string; body: unknown }

/** Sheets API stub. GET returns `headerRow` (the sheet's REAL header, independent of local
 *  session.columns order/count) — append recorded like sync-skip-rows.spec.ts. UPDATE goes
 *  through `values:batchUpdate` (sparse per-cell POST, [SYNC-3] follow-up) — recorded too so
 *  tests can assert exactly which cells a given sync touched. */
async function stubSheets(page: Page, headerRow: string[]): Promise<SheetCall[]> {
  const calls: SheetCall[] = [];
  let nextAppendRow = 2;
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    const req = route.request();
    const url = req.url();
    let body: unknown = null;
    try { body = req.postDataJSON(); } catch { /* GET */ }
    calls.push({ method: req.method(), url, body });
    if (url.includes(':append')) {
      const rows = (body as { values: unknown[][] }).values;
      const first = nextAppendRow;
      const last = nextAppendRow + rows.length - 1;
      nextAppendRow = last + 1;
      await route.fulfill({
        json: { updates: { updatedRange: `Sheet1!A${first}:Z${last}`, updatedRows: rows.length } },
      });
      return;
    }
    if (url.includes(':batchUpdate')) {
      const data = (body as { data: { range: string }[] }).data ?? [];
      await route.fulfill({ json: { spreadsheetId: 'stub', totalUpdatedCells: data.length } });
      return;
    }
    if (req.method() === 'GET') {
      await route.fulfill({ json: { values: [headerRow] } });
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected: ' + url });
  });
  return calls;
}

function settingsWithColumns(columns: unknown[]) {
  return {
    state: {
      sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_ID_MAP/edit',
      sheetTab: 'Sheet1',
      columns,
      recognitionTolerance: 0.6,
    },
    version: 0,
  };
}

function makeSession(columns: { id: string }[]) {
  const values: Record<string, string> = {};
  // Deterministic per-column values keyed by column id (c1 -> '1', c2 -> '2', ...) so assertions
  // can check exactly WHICH id's value landed at which array index.
  columns.forEach((c, i) => { values[c.id] = String(i + 1); });
  return {
    id: 'sess-map-1',
    date: '2026-07-07',
    label: '헤더매핑테스트',
    target: { spreadsheetId: 'SHEET_ID_MAP', sheetTab: 'Sheet1' },
    columns,
    rows: [{ index: 1, values, complete: true }],
    completedRows: 1,
    syncedRows: 0,
    startedAt: 1783000000000,
    finishedAt: 1783000600000,
  };
}

async function seedAndBoot(page: Page, settings: ReturnType<typeof settingsWithColumns>, session: unknown) {
  await page.route('**://www.googleapis.com/**', (r) =>
    r.fulfill({ json: { id: 'stub', files: [{ id: 'stub' }] } }));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async ({ sess, settings, idb, schemaSrc }) => {
    localStorage.clear();
    localStorage.setItem('gs10_google_token', JSON.stringify({
      access_token: 'test-token', expires_at: Date.now() + 3600_000, email: 'tester@example.com',
    }));
    localStorage.setItem('agri-voicenote-settings-v3', JSON.stringify(settings));
    await new Promise<void>((resolve) => {
      const applySchema = (0, eval)(`(${schemaSrc})`) as (db: IDBDatabase) => void;
      const open = indexedDB.open(idb.name, idb.version);
      open.onupgradeneeded = () => applySchema(open.result);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('sessions', 'readwrite');
        tx.objectStore('sessions').put(sess);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      };
      open.onerror = () => resolve();
    });
  }, { sess: session, settings, idb: IDB, schemaSrc: APPLY_APP_SCHEMA_SOURCE });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-data"]').click();
  await page.waitForTimeout(300);
}

async function runSync(page: Page) {
  await page.locator('text=시트에 추가').first().click();
  await page.waitForTimeout(200);
  await page.locator('button:has-text("추가 (")').click();
  await page.waitForTimeout(600);
}

test('(b) 시트가 로컬보다 컬럼이 많음 — 신규 컬럼이 앞뒤에 끼어들어도 이름 기준으로 정확히 안착', async ({ page }) => {
  const columns = [
    { id: 'c1', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 3 } },
    { id: 'c2', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
  ];
  // Real sheet grew: 2 columns before + 1 between + 1 after what this session tracks.
  const headerRow = ['날짜', '비고', '조사나무', '신규컬럼A', '횡경', '신규컬럼B'];
  const calls = await stubSheets(page, headerRow);
  await seedAndBoot(page, settingsWithColumns(columns), makeSession(columns));
  await runSync(page);

  const appends = calls.filter((c) => c.url.includes(':append'));
  expect(appends).toHaveLength(1);
  const sent = (appends[0].body as { values: string[][] }).values;
  expect(sent).toHaveLength(1);
  // c1='1' (조사나무) must land at index 2; c2='2' (횡경) at index 4. Index 5 (신규컬럼B, a
  // column this session doesn't own) must NOT be included at all — array stops at index 4.
  expect(sent[0]).toEqual(['', '', '1', '', '2']);
});

test('(c) 컬럼 순서만 다름(이름 동일) — 위치 기반이면 뒤바뀌지만 이름 기준은 정확히 안착', async ({ page }) => {
  const columns = [
    { id: 'c1', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 3 } },
    { id: 'c2', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
  ];
  // Sheet's real header has the SAME two columns, but in the OPPOSITE order.
  const headerRow = ['횡경', '조사나무'];
  const calls = await stubSheets(page, headerRow);
  await seedAndBoot(page, settingsWithColumns(columns), makeSession(columns));
  await runSync(page);

  const appends = calls.filter((c) => c.url.includes(':append'));
  expect(appends).toHaveLength(1);
  const sent = (appends[0].body as { values: string[][] }).values;
  // Positional (pre-fix) code would have sent ['1','2'] (local declaration order: 조사나무,횡경) —
  // silently swapping the two values relative to the sheet's real column order. Name-based
  // mapping must send ['2','1'] (횡경's value '2' at index 0, 조사나무's value '1' at index 1).
  expect(sent[0]).toEqual(['2', '1']);
});

test('로컬 컬럼명이 시트 헤더에 하나도 없음 — 침묵 성공 대신 명시적 실패로 보고', async ({ page }) => {
  const columns = [
    { id: 'c1', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 3 } },
  ];
  const headerRow = ['완전히다른헤더'];
  await stubSheets(page, headerRow);
  await seedAndBoot(page, settingsWithColumns(columns), makeSession(columns));
  await runSync(page);

  // Must NOT report a silent success — the failure banner (실패 count) surfaces instead.
  await expect(page.locator('text=실패').first()).toBeVisible();
});

test('[SYNC-3] follow-up — UPDATE 경로는 인터스티셜(시트 전용) 컬럼을 절대 건드리지 않음 (batchUpdate sparse per-cell)', async ({ page }) => {
  // 재현 조건: 로컬 6컬럼이 실 9컬럼 헤더에서 A,B,F,G,H,I에 매핑되고, C,D,E는 이 앱이 추적하지 않는
  // 시트 전용 인터스티셜 컬럼(민구 확인: 사용자가 앱이 만든 행에 나중에 시트에서 직접 값을
  // 채워넣고, 그 후 앱에서 같은 행을 수정해 재동기화하는 워크플로가 실제로 있다/있을 수 있다).
  // 이 행은 이미 한 번 synced(sheetRow=2)된 뒤 로컬에서 값이 바뀐(dirty) 상태 — 즉 APPEND가 아니라
  // UPDATE 경로를 정확히 태운다(연속범위 PUT이었다면 C2:E2가 빈 문자열로 재기록됐을 자리).
  const columns = [
    { id: 'c0', name: 'A', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '' } },
    { id: 'c1', name: 'B', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '' } },
    { id: 'c2', name: 'F', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '' } },
    { id: 'c3', name: 'G', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '' } },
    { id: 'c4', name: 'H', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '' } },
    { id: 'c5', name: 'I', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '' } },
  ];
  const headerRow = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']; // C,D,E = interstitial, sheet-only
  const calls = await stubSheets(page, headerRow);

  const values: Record<string, string> = { c0: 'a1', c1: 'b1', c2: 'f1', c3: 'g1', c4: 'h1', c5: 'i1' };
  const session = {
    id: 'sess-interstitial-1',
    date: '2026-07-07',
    label: '인터스티셜보호테스트',
    target: { spreadsheetId: 'SHEET_ID_MAP', sheetTab: 'Sheet1' },
    columns,
    rows: [{ index: 1, values, complete: true, sheetRow: 2, syncState: 'dirty' }],
    completedRows: 1,
    syncedRows: 1,
    startedAt: 1783000000000,
    finishedAt: 1783000600000,
  };
  await seedAndBoot(page, settingsWithColumns(columns), session);
  await runSync(page);

  const appends = calls.filter((c) => c.url.includes(':append'));
  const batchUpdates = calls.filter((c) => c.url.includes(':batchUpdate'));
  // Row already has a sheetRow and is 'dirty' — this MUST take the UPDATE path, not append.
  expect(appends).toHaveLength(0);
  expect(batchUpdates).toHaveLength(1);

  const body = batchUpdates[0].body as { data: { range: string; values: string[][] }[] };
  // Exactly 6 cells named — one per mapped column. The interstitial C2/D2/E2 do not appear in the
  // request AT ALL — not written blank, not written anything: physically absent from `data`.
  expect(body.data).toHaveLength(6);
  const ranges = body.data.map((d) => d.range);
  expect(ranges).not.toContain('Sheet1!C2:C2');
  expect(ranges).not.toContain('Sheet1!D2:D2');
  expect(ranges).not.toContain('Sheet1!E2:E2');
  const byRange = Object.fromEntries(body.data.map((d) => [d.range, d.values[0][0]]));
  expect(byRange['Sheet1!A2:A2']).toBe('a1');
  expect(byRange['Sheet1!B2:B2']).toBe('b1');
  expect(byRange['Sheet1!F2:F2']).toBe('f1');
  expect(byRange['Sheet1!G2:G2']).toBe('g1');
  expect(byRange['Sheet1!H2:H2']).toBe('h1');
  expect(byRange['Sheet1!I2:I2']).toBe('i1');

  await expect(page.locator('text=갱신')).toBeVisible();
});
