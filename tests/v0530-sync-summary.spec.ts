/**
 * v0.53.0 C13 e2e 오라클 (민구 Q4 ⓐ) — 시트 올리기 합계 계측(sync_summary).
 *
 * 이 스펙이 고정하는 문장:
 *  ① 올리기 1회에 sync_summary 정확히 1줄 방출.
 *  ② sessionId: '__app__' 명시 귀속.
 *  ③ 값이 SyncReport(ok, failed, rows, updated, fallback)와 일치.
 *  ④ 선택 없음 / 미로그인 조기 return 시 sync_summary 미방출.
 */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

const STORE_KEY = 'agri-voicenote-settings-v3';
const SHEET_ID = 'SHEET_SYNC_SUM';
const URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;
const COLUMNS = [
  { id: 'c1', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, sampleKey: true, auto: { kind: 'fixed', value: '농가A' } },
  { id: 'c2', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, sampleKey: false, auto: { kind: 'fixed', value: '' }, decimals: 1 },
];

function settings() {
  return {
    version: 13,
    state: {
      googleConnected: true, userEmail: 'tester@example.com',
      sheetUrl: URL, sheetTab: '농가', columnsSheetId: SHEET_ID, columnsSheetTab: '농가',
      availableSheets: ['농가'],
      savedSheets: [{ name: '농가', url: URL, sheetId: SHEET_ID, addedAt: 1 }],
      columns: COLUMNS,
      tableGenerated: true, totalRows: 1, recognitionTolerance: 0.6,
    },
  };
}

function sampleSession() {
  return {
    id: 'sess-sync-sum-1', date: '2026-09-17', label: '세션 1',
    target: { spreadsheetId: SHEET_ID, sheetTab: '농가' },
    columns: COLUMNS,
    rows: [
      { index: 1, values: { c1: '농가A', c2: '35.1' }, complete: true },
      { index: 2, values: { c1: '농가A', c2: '36.2' }, complete: true, sheetRow: 10, syncState: 'dirty' },
    ],
    completedRows: 2, syncedRows: 1, startedAt: 1788300000000, finishedAt: 1788300600000,
  };
}

async function stubNetwork(page: Page): Promise<void> {
  await page.route('**://www.googleapis.com/**', (route) =>
    route.fulfill({ json: { id: 'stub', files: [{ id: 'stub' }] } }));
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    const url = route.request().url();
    if (url.includes(':append')) {
      await route.fulfill({ json: { updates: { updatedRange: '농가!A11:B11', updatedRows: 1 } } });
      return;
    }
    if (url.includes(':batchUpdate')) {
      await route.fulfill({ json: { spreadsheetId: 'stub', totalUpdatedCells: 2 } });
      return;
    }
    await route.fulfill({ json: { values: [['농가명', '횡경']] } });
  });
}

async function seedSessionAndOpenData(page: Page, sess: unknown): Promise<void> {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async ({ persisted, s, idb, schemaSrc, key }) => {
    localStorage.clear();
    localStorage.setItem('gs10_google_token', JSON.stringify({
      access_token: 'valid-token', expires_at: Date.now() + 3_600_000, email: 'tester@example.com',
    }));
    localStorage.setItem(key, JSON.stringify(persisted));
    await new Promise<void>((resolve) => {
      const applySchema = (0, eval)(`(${schemaSrc})`) as (db: IDBDatabase) => void;
      const open = indexedDB.open(idb.name, idb.version);
      open.onupgradeneeded = () => applySchema(open.result);
      open.onsuccess = () => {
        const tx = open.result.transaction('sessions', 'readwrite');
        tx.objectStore('sessions').put(s);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      };
      open.onerror = () => resolve();
    });
  }, { persisted: settings(), s: sess, idb: IDB, schemaSrc: APPLY_APP_SCHEMA_SOURCE, key: STORE_KEY });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="tab-data"]').click();
}

test('⓪-게이트 이 오라클이 릴리스 게이트 목록에 등재돼 있다 (v0.53.0)', () => {
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8')) as {
    scripts: Record<string, string>;
  };
  const listed = (pkg.scripts['test:e2e:gate'] ?? '').split(/\s+/).filter((x) => x.startsWith('tests/'));
  expect(listed, 'tests/v0530-sync-summary.spec.ts가 릴리스 게이트 목록에 없다').toContain('tests/v0530-sync-summary.spec.ts');
});

test('동기화 1회에 sync_summary 정확히 1줄 방출 · __app__ 귀속 · SyncReport와 값 일치', async ({ page }) => {
  await stubNetwork(page);
  await seedSessionAndOpenData(page, sampleSession());

  // v0.54.0 A-3: 올리기 전에 페이지 안에서 logger.setSessionId('sess_live_dummy')로 살아 있는 세션을 흉내 냄
  await page.evaluate(async () => {
    const { logger } = await import('/src/lib/logger.ts');
    logger.setSessionId('sess_live_dummy');
  });

  await page.getByText('시트에 추가').click();
  await page.locator('button:has-text("추가 (")').click();

  const summaries = () => loadLogEvents(page).then((evs) => evs.filter((e) => e.extra?.startsWith('sync_summary:')));
  await expect.poll(async () => (await summaries()).length, { timeout: 8000, message: 'sync_summary가 남지 않았다' }).toBe(1);

  const [ev] = await summaries();
  expect(ev.type).toBe('app');
  expect(ev.sessionId, 'sync_summary는 __app__으로 명시 귀속되어야 한다').toBe('__app__');
  // 1 append, 1 update -> ok=1, failed=0, rows=1, updated=1, fallback=0
  expect(ev.extra).toBe('sync_summary:ok=1,failed=0,rows=1,updated=1,fallback=0');

  // 끝나면 logger.setSessionId(undefined)로 되돌림
  await page.evaluate(async () => {
    const { logger } = await import('/src/lib/logger.ts');
    logger.setSessionId(undefined);
  });
});

test('[node] sync.ts의 syncSummary 호출부 매핑 잠금 — 5개 필드가 1:1로 전달됨', () => {
  const syncSrc = readFileSync(resolve(process.cwd(), 'src/lib/sync.ts'), 'utf-8');
  expect(syncSrc).toContain('ok: report.ok');
  expect(syncSrc).toContain('failed: report.failed');
  expect(syncSrc).toContain('rows: report.rows');
  expect(syncSrc).toContain('updated: report.updatedRows');
  expect(syncSrc).toContain('fallback: report.fallbackAppended');
});

test('선택 0건 또는 로그인 필요 조기 return 시 sync_summary가 방출되지 않는다', async ({ page }) => {
  await stubNetwork(page);
  await seedSessionAndOpenData(page, sampleSession());

  // 1. 조기 return 실행 (선택 0건 & 미로그인)
  await page.evaluate(async () => {
    const { syncSelected } = await import('/src/lib/sync.ts');
    // 선택 0건
    const rep1 = await syncSelected([]);
    if (!rep1.message) throw new Error('선택 0건 조기 return 실패');

    // 토큰 제거 후 호출 (미로그인)
    localStorage.removeItem('gs10_google_token');
    const rep2 = await syncSelected(['sess-sync-sum-1']);
    if (!rep2.needsLogin) throw new Error('미로그인 조기 return 실패');
  });

  const evs = await loadLogEvents(page);
  const syncSummaries = evs.filter((e) => e.extra?.startsWith('sync_summary:'));
  expect(syncSummaries.length, '조기 return에서는 sync_summary가 방출되지 않아야 한다').toBe(0);
});

