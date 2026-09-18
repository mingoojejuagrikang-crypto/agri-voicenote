/**
 * v0.55.0 D-3 — 과거값 준비 상태 배지 오라클 (V6 D-1~D-3).
 *
 * 민구 결정 Q14 ⓑ & Q15 ⓐ:
 *  - 폴백 유효기간 14일 → 28일
 *  - 준비됨 행에 (<나이> · <남은>일 남음) 표기
 *  - 이상치 규칙이 있으나 인덱스 미준비 시: <notReadyReason> · 알람 안 울림 (bad)
 *  - 이상치 규칙이 없으면 알람 안 울림 표기 없음 (off)
 */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildPastIndex, resolveRoundCol } from '../src/lib/pastValuesIndex';
import { serializePastIndexEntry, type PersistedPastIndexRecord } from '../src/lib/pastValuesPersist';
import { effectiveSampleKey } from '../src/lib/columnFlags';
import type { Column } from '../src/types';
import { daysAgoLocal } from './fixtures/localDate';
import { BASE } from './baseUrl';

test.setTimeout(60_000);

test('[node] ⓪-게이트 이 오라클이 릴리스 게이트 목록에 등재돼 있다 (v0.55.0)', () => {
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8')) as {
    scripts: Record<string, string>;
  };
  const listed = (pkg.scripts['test:e2e:gate'] ?? '').split(/\s+/).filter((x) => x.startsWith('tests/'));
  expect(listed, 'tests/v0550-past-ready.spec.ts가 릴리스 게이트 목록에 없다').toContain('tests/v0550-past-ready.spec.ts');
});

const STORE_KEY = 'agri-voicenote-settings-v3';
const SHEET_ID = 'SHEET_PAST_READY_1';
const PREV_ROUND = daysAgoLocal(1);

const COLUMNS = [
  { id: 'c1', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'c3', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'c7', name: '조사과실', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 5 }, sampleKey: true },
  { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'increase' },
  { id: 'c9', name: '종경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, pctThreshold: 15 },
];

const SETTINGS = {
  state: {
    googleConnected: false,
    googleConnection: null,
    userEmail: null,
    sheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`,
    sheetTab: 'Sheet1',
    columnsSheetId: SHEET_ID,
    columnsSheetTab: 'Sheet1',
    columns: COLUMNS,
    tableGenerated: true,
    totalRows: 10,
    ttsRate: 1.05,
    sessionLabelColId: null,
    sessionAutoLabel: 'pastready-test',
    noisyMode: false,
    speakerphoneMode: false,
    preferredVoiceName: '',
    roundDateColId: null,
  },
  version: 13,
};

const HEADERS = ['조사일자', '농가명', '조사나무', '조사과실', '횡경', '종경'];
const SHEET_ROWS = [
  [PREV_ROUND, '이원창', '1', '1', '100.0', '50.0'],
  [PREV_ROUND, '이원창', '1', '2', '110.0', '55.0'],
];

function computeFp(cols: Column[] = COLUMNS as unknown as Column[]): string {
  return JSON.stringify([
    SHEET_ID,
    'Sheet1',
    null,
    cols.map((c) => [c.id, c.name.trim(), c.type, effectiveSampleKey(c)]),
  ]);
}

function buildRecord(builtAt: number): PersistedPastIndexRecord {
  const cols = COLUMNS as unknown as Column[];
  const index = buildPastIndex(HEADERS, SHEET_ROWS, cols, resolveRoundCol(cols, null));
  return serializePastIndexEntry({ fp: computeFp(cols), builtAt, index });
}

async function stubSheets(page: Page) {
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    await route.fulfill({ status: 500, body: 'stub failure' });
  });
}

async function seedAndBoot(
  page: Page,
  opts: { withToken: boolean; record?: PersistedPastIndexRecord; settings?: typeof SETTINGS },
) {
  await stubSheets(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ settings, storeKey, withToken }) => {
      localStorage.clear();
      if (withToken) {
        localStorage.setItem('gs10_google_token', JSON.stringify({
          access_token: 'test-token', expires_at: Date.now() + 3600_000, email: 'tester@example.com',
        }));
      }
      localStorage.setItem(storeKey, JSON.stringify(settings));
    },
    { settings: opts.settings ?? SETTINGS, storeKey: STORE_KEY, withToken: opts.withToken },
  );
  if (opts.record) {
    await page.evaluate(async (rec) => {
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        const req = indexedDB.open('agri-voicenote');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(rec, '__past_index__');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    }, opts.record as unknown as Record<string, unknown>);
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
}

test('① 폴백 builtAt = Date.now() - (13일 + 1시간) => 준비됨(13일 전 · 14일 남음) · warn', async ({ page }) => {
  const builtAt = Date.now() - (13 * 86_400_000 + 3600_000);
  await seedAndBoot(page, { withToken: false, record: buildRecord(builtAt) });
  await page.locator('[data-testid="tab-settings"]').click();
  const pastRow = page.locator('[data-testid="conn-past"]');
  await expect(pastRow).toContainText('준비됨(13일 전 · 14일 남음)');
  await expect(pastRow).toHaveAttribute('data-tone', 'warn');
});

test('② 폴백 builtAt = Date.now() - (20일 + 1시간) => 준비됨(20일 전 · 7일 남음) · warn', async ({ page }) => {
  const builtAt = Date.now() - (20 * 86_400_000 + 3600_000);
  await seedAndBoot(page, { withToken: false, record: buildRecord(builtAt) });
  await page.locator('[data-testid="tab-settings"]').click();
  const pastRow = page.locator('[data-testid="conn-past"]');
  await expect(pastRow).toContainText('준비됨(20일 전 · 7일 남음)');
  await expect(pastRow).toHaveAttribute('data-tone', 'warn');
});

test('③ 폴백 builtAt = Date.now() - (28일 + 1시간) => 로그인 필요 · 알람 안 울림 · bad', async ({ page }) => {
  const builtAt = Date.now() - (28 * 86_400_000 + 3600_000);
  await seedAndBoot(page, { withToken: false, record: buildRecord(builtAt) });
  await page.locator('[data-testid="tab-settings"]').click();
  const pastRow = page.locator('[data-testid="conn-past"]');
  await expect(pastRow).toContainText('로그인 필요 · 알람 안 울림');
  await expect(pastRow).toHaveAttribute('data-tone', 'bad');
});

test('④ 규칙 없는 설정 + 폴백 없음 => 알람 안 울림 없음 · off', async ({ page }) => {
  const NO_RULE_COLUMNS = COLUMNS.map((c) => {
    const copy = { ...c };
    delete (copy as any).trendRule;
    delete (copy as any).pctThreshold;
    return copy;
  });
  const noRuleSettings = {
    ...SETTINGS,
    state: {
      ...SETTINGS.state,
      columns: NO_RULE_COLUMNS,
    },
  };
  await seedAndBoot(page, { withToken: false, settings: noRuleSettings });
  await page.locator('[data-testid="tab-settings"]').click();
  const pastRow = page.locator('[data-testid="conn-past"]');
  await expect(pastRow).not.toContainText('알람 안 울림');
  await expect(pastRow).toHaveAttribute('data-tone', 'off');
});
