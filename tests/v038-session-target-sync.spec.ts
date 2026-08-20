/** 태스크 07 결함 2 — 세션 target·columns는 시작 시 고정되고 동기화는 그 target만 사용한다. */
import { test, expect, type Page } from '@playwright/test';
import { IDB, APPLY_APP_SCHEMA_SOURCE } from './fixtures/idb';
import { fireStt, installVoiceMocks } from './fixtures/stt';
import { BASE } from './baseUrl';

test.setTimeout(60_000);
const STORE_KEY = 'agri-voicenote-settings-v3';
const SHEET_A = 'SHEET_TARGET_A';
const SHEET_B = 'SHEET_TARGET_B';
const URL_A = `https://docs.google.com/spreadsheets/d/${SHEET_A}/edit`;
const URL_B = `https://docs.google.com/spreadsheets/d/${SHEET_B}/edit`;

const COLUMNS_A = [
  { id: 'c1', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, sampleKey: true, auto: { kind: 'fixed', value: 'A농가' } },
  { id: 'c2', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, sampleKey: false, auto: { kind: 'fixed', value: '' }, decimals: 1 },
];
const COLUMNS_B = COLUMNS_A.map((column) => column.id === 'c1'
  ? { ...column, auto: { kind: 'fixed', value: 'B농가' } }
  : column);

function settingsB() {
  return {
    version: 12,
    state: {
      googleConnected: true,
      userEmail: 'tester@example.com',
      sheetUrl: URL_B,
      sheetTab: '농가',
      columnsSheetId: SHEET_B,
      columnsSheetTab: '농가',
      availableSheets: ['농가'],
      savedSheets: [{ name: 'B농가', url: URL_B, sheetId: SHEET_B, addedAt: 2 }],
      columns: COLUMNS_B,
      tableGenerated: true,
      totalRows: 1,
      recognitionTolerance: 0.6,
    },
  };
}

function makeSession(target: boolean) {
  return {
    id: target ? 'sess-target-a' : 'sess-legacy',
    date: '2026-07-23',
    label: target ? 'A농가 세션' : '이전 세션',
    ...(target ? { target: { spreadsheetId: SHEET_A, sheetTab: '농가' } } : {}),
    columns: COLUMNS_A,
    rows: [
      { index: 1, values: { c1: 'A농가', c2: '35.1' }, complete: true },
      ...(target
        ? [{ index: 2, values: { c1: 'A농가', c2: '36.2' }, complete: true, sheetRow: 42, syncState: 'dirty' }]
        : []),
    ],
    completedRows: target ? 2 : 1,
    syncedRows: target ? 1 : 0,
    startedAt: 1784750000000,
    finishedAt: 1784750600000,
  };
}

function makeUploadedLegacySession() {
  return {
    ...makeSession(false),
    id: 'sess-legacy-uploaded',
    rows: [
      {
        index: 1,
        values: { c1: 'A농가', c2: '35.1' },
        complete: true,
        sheetRow: 42,
        syncState: 'dirty',
      },
    ],
  };
}

interface SheetCall { method: string; url: string; body: unknown }

async function stubNetwork(page: Page): Promise<SheetCall[]> {
  const calls: SheetCall[] = [];
  await page.route('**://www.googleapis.com/**', (route) =>
    route.fulfill({ json: { id: 'stub', files: [{ id: 'stub' }] } }));
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    const request = route.request();
    let body: unknown = null;
    try { body = request.postDataJSON(); } catch { /* GET */ }
    calls.push({ method: request.method(), url: request.url(), body });
    if (request.url().includes(':append')) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await route.fulfill({ json: { updates: { updatedRange: '농가!A43:B43', updatedRows: 1 } } });
      return;
    }
    if (request.url().includes(':batchUpdate')) {
      await route.fulfill({ json: { spreadsheetId: 'stub', totalUpdatedCells: 2 } });
      return;
    }
    await route.fulfill({ json: { values: [['농가명', '횡경']] } });
  });
  return calls;
}

async function seedSessionAndOpenData(page: Page, session: unknown): Promise<void> {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async ({ persisted, sess, idb, schemaSrc, key }) => {
    localStorage.clear();
    localStorage.setItem('gs10_google_token', JSON.stringify({
      access_token: 'target-token', expires_at: Date.now() + 3_600_000, email: 'tester@example.com',
    }));
    localStorage.setItem(key, JSON.stringify(persisted));
    await new Promise<void>((resolve) => {
      const applySchema = (0, eval)(`(${schemaSrc})`) as (db: IDBDatabase) => void;
      const open = indexedDB.open(idb.name, idb.version);
      open.onupgradeneeded = () => applySchema(open.result);
      open.onsuccess = () => {
        const tx = open.result.transaction('sessions', 'readwrite');
        tx.objectStore('sessions').put(sess);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      };
      open.onerror = () => resolve();
    });
  }, { persisted: settingsB(), sess: session, idb: IDB, schemaSrc: APPLY_APP_SCHEMA_SOURCE, key: STORE_KEY });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="tab-data"]').click();
}

async function selectAndSync(page: Page): Promise<void> {
  await page.getByText('시트에 추가').click(); // 아이콘이 함께 렌더돼 exact 매칭 불가
  await page.locator('button:has-text("추가 (")').click();
}

async function readSession(page: Page, id: string): Promise<Record<string, unknown> | null> {
  return page.evaluate(async ({ dbName, sessionId }) => {
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      const request = indexedDB.open(dbName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    if (!db) return null;
    return new Promise<Record<string, unknown> | null>((resolve) => {
      const request = db.transaction('sessions', 'readonly').objectStore('sessions').get(sessionId);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => resolve(null);
    });
  }, { dbName: IDB.name, sessionId: id });
}

async function readAllSessions(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(async (dbName) => {
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      const request = indexedDB.open(dbName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    if (!db) return [];
    return new Promise<Array<Record<string, unknown>>>((resolve) => {
      const request = db.transaction('sessions', 'readonly').objectStore('sessions').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve([]);
    });
  }, IDB.name);
}

test('A target 세션을 B 설정에서 동기화 — B POST/PUT 0건, A append/update만 발생', async ({ page }) => {
  const calls = await stubNetwork(page);
  await seedSessionAndOpenData(page, makeSession(true));
  await selectAndSync(page);

  await expect.poll(() => calls.filter((call) => call.url.includes(SHEET_A) && call.method !== 'GET').length)
    .toBe(2);
  expect(calls.filter((call) => call.url.includes(SHEET_B) && call.method !== 'GET')).toHaveLength(0);
  expect(calls.filter((call) => call.url.includes(SHEET_A) && call.url.includes(':append'))).toHaveLength(1);
  expect(calls.filter((call) => call.url.includes(SHEET_A) && call.url.includes(':batchUpdate'))).toHaveLength(1);
});

test('target 없는 legacy 세션 — 확인 전 Sheets 요청 0건, 확인 target을 IDB에 고정한 뒤 업로드', async ({ page }) => {
  const calls = await stubNetwork(page);
  await seedSessionAndOpenData(page, makeSession(false));
  await selectAndSync(page);

  const prompt = page.getByText('이전 세션 대상 확인', { exact: true });
  await expect(prompt).toBeVisible();
  await expect(page.getByText(/현재 연결된 B농가의 “농가” 탭에 올릴까요/)).toBeVisible();
  expect(calls).toHaveLength(0);

  await page.getByRole('button', { name: '이 시트에 올리기' }).click();
  await expect.poll(() => calls.filter((call) => call.url.includes(SHEET_B) && call.url.includes(':append')).length)
    .toBe(1);
  const stored = await readSession(page, 'sess-legacy') as { target?: unknown } | null;
  expect(stored?.target).toEqual({ spreadsheetId: SHEET_B, sheetTab: '농가' });
});

test('업로드 이력 legacy를 다른 시트로 선택 — B 42행 update 없이 전 행 append', async ({ page }) => {
  const calls = await stubNetwork(page);
  await seedSessionAndOpenData(page, makeUploadedLegacySession());
  await selectAndSync(page);

  await expect(page.getByText('이전 세션 대상 확인', { exact: true })).toBeVisible();
  await expect(page.getByText(/전에 시트에 올린 행이 있습니다/)).toBeVisible();
  expect(calls).toHaveLength(0);

  await page.getByRole('button', { name: '다른 시트로 새로 올리기' }).click();
  await expect.poll(() => calls.filter((call) =>
    call.url.includes(SHEET_B) && call.url.includes(':append')).length).toBe(1);
  expect(calls.filter((call) => call.url.includes(SHEET_B) && call.url.includes(':batchUpdate')))
    .toHaveLength(0);
  // 🔴 IDB는 **2단으로** 쓰인다 — 한 번 읽어선 안 된다(2026-07-31 게이트 실패 판정).
  //   1단 `assignLegacySessionTarget(_, _, 'different-sheet')`: target을 박고 **기존 좌표를 지운다**
  //        (`sessionSync.ts:96-101` — sheetRow·syncState delete). 여기서 이미 저장된다.
  //   2단 `syncSessions`: append **응답**을 받은 뒤 43/synced를 병합해 다시 저장(`sync.ts:349-374`).
  //   위 `expect.poll`은 append **요청**이 나간 순간 풀린다(라우트 핸들러가 fulfill 전에 push한다).
  //   그래서 종전처럼 곧바로 1회 읽으면 **1단 상태**(좌표 없음)를 잡는다 — 실제로 그렇게 실패했다.
  //   실패 diff의 received가 `42`/`dirty`가 아니라 좌표 자체가 **없었던** 것이 그 증거다.
  //   → 2단이 착지할 때까지 폴링한다. 앱 동작은 그대로고, 테스트가 부수효과를 기다리게 한 것뿐이다.
  await expect.poll(async () => {
    const s = await readSession(page, 'sess-legacy-uploaded') as {
      rows?: Array<{ sheetRow?: number; syncState?: string }>;
    } | null;
    return { sheetRow: s?.rows?.[0]?.sheetRow, syncState: s?.rows?.[0]?.syncState };
  }, { timeout: 5000 }).toEqual({ sheetRow: 43, syncState: 'synced' });
  const stored = await readSession(page, 'sess-legacy-uploaded') as { target?: unknown } | null;
  expect(stored?.target).toEqual({ spreadsheetId: SHEET_B, sheetTab: '농가' });
});

test('활성 A 세션 중 B 전환 — persist는 시작 시 target·columns 스냅샷을 유지', async ({ page }) => {
  await installVoiceMocks(page, { ttsOnendDelayMs: 10 });
  await page.addInitScript(({ key, urlA, urlB, sheetA, sheetB, columns }) => {
    localStorage.setItem('gs10_google_token', JSON.stringify({
      access_token: 'target-token', expires_at: Date.now() + 3_600_000, email: 'tester@example.com',
    }));
    localStorage.setItem(key, JSON.stringify({
      version: 12,
      state: {
        googleConnected: true, userEmail: 'tester@example.com',
        sheetUrl: urlA, sheetTab: '농가', columnsSheetId: sheetA, columnsSheetTab: '농가',
        availableSheets: ['농가'],
        savedSheets: [
          { name: 'A농가', url: urlA, sheetId: sheetA, addedAt: 1 },
          { name: 'B농가', url: urlB, sheetId: sheetB, addedAt: 2 },
        ],
        columns, tableGenerated: true, totalRows: 1, recognitionTolerance: 0.6,
      },
    }));
  }, { key: STORE_KEY, urlA: URL_A, urlB: URL_B, sheetA: SHEET_A, sheetB: SHEET_B, columns: COLUMNS_A });
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    if (!path.includes('/values/')) {
      await route.fulfill({ json: {
        spreadsheetId: SHEET_B,
        properties: { title: 'B농가' },
        sheets: [{ properties: { sheetId: 0, title: '농가', index: 0 } }],
      } });
      return;
    }
    await route.fulfill({ json: { values: [['농가명', '횡경'], ['B농가', '222.2']] } });
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="tab-voice"]').click();
  await page.getByRole('button', { name: /음성 입력 시작/ }).click();
  await expect(page.locator('[data-testid="voice-active-state"]')).toBeVisible();

  await page.locator('[data-testid="tab-settings"]').click();
  await page.getByRole('button', { name: /저장된 시트/ }).click();
  await page.getByTitle(URL_B).click();
  await expect.poll(async () => page.evaluate((key) =>
    JSON.parse(localStorage.getItem(key) ?? 'null')?.state?.columnsSheetId, STORE_KEY)).toBe(SHEET_B);

  await page.locator('[data-testid="tab-voice"]').click();
  await fireStt(page, '삼십오 점 일', 100);
  await expect.poll(async () => (await readAllSessions(page)).length).toBe(1);

  const stored = (await readAllSessions(page))[0] as {
    target?: unknown;
    columns?: Array<{ id: string; name: string }>;
    rows?: Array<{ values: Record<string, string> }>;
  } | undefined;
  expect(stored?.target).toEqual({ spreadsheetId: SHEET_A, sheetTab: '농가' });
  const farmColumn = stored?.columns?.find((column) => column.name === '농가명');
  const widthColumn = stored?.columns?.find((column) => column.name === '횡경');
  expect(stored?.rows?.[0].values[farmColumn!.id]).toBe('A농가');
  expect(stored?.rows?.[0].values[widthColumn!.id]).toBe('35.1');
});
