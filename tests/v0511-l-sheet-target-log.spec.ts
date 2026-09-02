/**
 * v0.51.1 L 오라클 (민구 지시 2026-09-02 · STT 레인 §6 L) — 로그에 **대상 시트**를 남긴다.
 *
 * 현황: 09-02 정식 4세션 events.json에 `sync|sheet|append|spreadsheet` 문자열이 0건 — 어느 시트·탭에 기록한
 * 세션인지는 `sessions.json.target`에만 있었다(SOP-003 [TEAMOPS-120]).
 *
 * 이 스펙이 고정하는 문장:
 *  ① `session start` 이벤트의 `meta.target = { sheet: spreadsheetId 앞 8자, tab, rows: totalRows }` — 그리고
 *     `extra:'start'`는 **바이트 그대로**(PRINCIPLES §4 · meta는 additive).
 *  ② 동기화가 시트에 실제로 밀어 올리면 세션당 `sheet_synced:sheet=<앞8자>,tab=<탭>,rows=<from>-<to>,n=<건수>`
 *     **정확히 1건**, 그 세션 id로 귀속(세션이 끝난 뒤의 동기화라 logger의 현재 세션 컨텍스트가 비어 있다).
 *
 * 🔴 반증(2026-09-02 실측): `useVoiceSession` meta의 `target` 줄을 빼면 ① red · `sync.ts`의 `logger.log(sheetSynced…)`를
 *    빼면 ② red.
 * 하네스: ①은 fixtures/activeZones(boot · 시트 SHEET_F3/Sheet1) · ②는 `v038-session-target-sync`의 세션·스텁을 그대로
 * (append 1행 → 43행 · dirty 1행 → 42행 update → rows=42-43,n=2).
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402 } from './fixtures/activeZones';
import { IDB, APPLY_APP_SCHEMA_SOURCE } from './fixtures/idb';
import { BASE } from './baseUrl';

test.setTimeout(60_000);

type LogEv = { type: string; extra?: string; sessionId?: string; meta?: Record<string, unknown> };

async function loadLogEvents(page: Page): Promise<LogEv[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db || !db.objectStoreNames.contains('logEvents')) return [];
    return new Promise<LogEv[]>((res) => {
      const req = db.transaction('logEvents', 'readonly').objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result as LogEv[]);
      req.onerror = () => res([]);
    });
  });
}

test('① session start meta.target = {sheet 앞8자, tab, rows} · extra:\'start\' 바이트 불변', async ({ page }) => {
  await boot(page, PHONE_402); // SETTINGS: sheetUrl …/d/SHEET_F3/edit · sheetTab Sheet1 · columnsSheetId SHEET_F3
  await expect.poll(async () => (await loadLogEvents(page))
    .filter((e) => e.type === 'session' && e.extra === 'start').length, { timeout: 5000 }).toBe(1);
  const start = (await loadLogEvents(page)).find((e) => e.type === 'session' && e.extra === 'start')!;
  // 바이트 계약 — extra는 종전 그대로 'start'다(meta만 늘었다).
  expect(start.extra).toBe('start');
  expect(start.meta?.target, 'meta.target이 없다 — 판독이 sessions.json 없이 시트를 알 수 없다').toEqual({
    sheet: 'SHEET_F3', tab: 'Sheet1', rows: start.meta?.totalRows,
  });
  // 종전 meta 필드는 그대로 실린다(additive 계약).
  expect(typeof start.meta?.appVersion).toBe('string');
  expect(typeof start.meta?.totalRows).toBe('number');
  expect(start.meta?.sessionMode).toBe('field');
});

// ── ② 동기화 — v038-session-target-sync 하네스 축약 ──────────────────────────────────────────────
const STORE_KEY = 'agri-voicenote-settings-v3';
const SHEET_A = 'SHEET_TARGET_A';
const SHEET_B = 'SHEET_TARGET_B';
const URL_B = `https://docs.google.com/spreadsheets/d/${SHEET_B}/edit`;
const COLUMNS_A = [
  { id: 'c1', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, sampleKey: true, auto: { kind: 'fixed', value: 'A농가' } },
  { id: 'c2', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, sampleKey: false, auto: { kind: 'fixed', value: '' }, decimals: 1 },
];

function settingsB() {
  return {
    version: 13,
    state: {
      googleConnected: true, userEmail: 'tester@example.com',
      sheetUrl: URL_B, sheetTab: '농가', columnsSheetId: SHEET_B, columnsSheetTab: '농가',
      availableSheets: ['농가'],
      savedSheets: [{ name: 'B농가', url: URL_B, sheetId: SHEET_B, addedAt: 2 }],
      columns: COLUMNS_A.map((c) => (c.id === 'c1' ? { ...c, auto: { kind: 'fixed', value: 'B농가' } } : c)),
      tableGenerated: true, totalRows: 1, recognitionTolerance: 0.6,
    },
  };
}

/** A target 세션: 1행 미동기(append → 43행) + 2행 dirty(sheetRow 42 → update). */
function sessionA() {
  return {
    id: 'sess-target-a', date: '2026-07-23', label: 'A농가 세션',
    target: { spreadsheetId: SHEET_A, sheetTab: '농가' },
    columns: COLUMNS_A,
    rows: [
      { index: 1, values: { c1: 'A농가', c2: '35.1' }, complete: true },
      { index: 2, values: { c1: 'A농가', c2: '36.2' }, complete: true, sheetRow: 42, syncState: 'dirty' },
    ],
    completedRows: 2, syncedRows: 1, startedAt: 1784750000000, finishedAt: 1784750600000,
  };
}

async function stubNetwork(page: Page): Promise<void> {
  await page.route('**://www.googleapis.com/**', (route) =>
    route.fulfill({ json: { id: 'stub', files: [{ id: 'stub' }] } }));
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    const url = route.request().url();
    if (url.includes(':append')) {
      await route.fulfill({ json: { updates: { updatedRange: '농가!A43:B43', updatedRows: 1 } } });
      return;
    }
    if (url.includes(':batchUpdate')) {
      await route.fulfill({ json: { spreadsheetId: 'stub', totalUpdatedCells: 2 } });
      return;
    }
    await route.fulfill({ json: { values: [['농가명', '횡경']] } });
  });
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

test('② 동기화 완료 → sheet_synced 정확히 1건(세션 귀속) — sheet=앞8자,tab,rows=42-43,n=2', async ({ page }) => {
  await stubNetwork(page);
  await seedSessionAndOpenData(page, sessionA());
  await page.getByText('시트에 추가').click();
  await page.locator('button:has-text("추가 (")').click();

  const synced = () => loadLogEvents(page).then((evs) => evs.filter((e) => e.extra?.startsWith('sheet_synced:')));
  await expect.poll(async () => (await synced()).length, { timeout: 8000, message: 'sheet_synced가 남지 않았다' }).toBe(1);
  const [ev] = await synced();
  expect(ev.type).toBe('app');
  expect(ev.sessionId, '세션이 끝난 뒤의 동기화라 명시 귀속이 없으면 __app__/빈 id로 흩어진다').toBe('sess-target-a');
  // SHEET_TARGET_A 앞 8자 = SHEET_TA · append 43행 + update 42행 → rows=42-43 · n=2.
  expect(ev.extra).toBe('sheet_synced:sheet=SHEET_TA,tab=농가,rows=42-43,n=2');
});
