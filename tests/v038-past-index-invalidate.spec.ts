/**
 * 태스크 06 결함 2 — 시트 삭제가 진행 중 과거값 조회까지 무효화하는 회귀.
 *
 * 부팅 프리페치 응답을 보류한 채 설정 초기화의 `clearSheets`를 실행한다. 삭제가 끝난 뒤 응답을
 * 완료해도 메모리 게시와 같은 세대 가드 앞에 있는 IDB write-through가 다시 일어나면 안 된다.
 */
import { test, expect, type Page } from '@playwright/test';

import { BASE } from './baseUrl';
const STORE_KEY = 'agri-voicenote-settings-v3';
const SHEET_ID = 'SHEET_V038_INVALIDATE';
const HEADERS = ['조사일자', '농가명', '횡경'];

const SETTINGS = {
  state: {
    googleConnected: true,
    userEmail: 'tester@example.com',
    sheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`,
    sheetTab: 'Sheet1',
    columnsSheetId: SHEET_ID,
    columnsSheetTab: 'Sheet1',
    availableSheets: ['Sheet1'],
    savedSheets: [],
    tableGenerated: true,
    totalRows: 1,
    roundDateColId: 'c1',
    columns: [
      { id: 'c1', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' } },
      { id: 'c2', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, sampleKey: true, auto: { kind: 'fixed', value: '이원창' } },
      { id: 'c3', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, trendRule: 'increase', auto: { kind: 'fixed', value: '' } },
    ],
  },
  version: 12,
};

interface PastIndexWriteProbe {
  completedJson: number;
  writesStarted: number;
}

async function installPastIndexWriteProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const testWindow = window as typeof window & {
      __survey011PastIndexWriteProbe?: PastIndexWriteProbe;
    };
    testWindow.__survey011PastIndexWriteProbe = { completedJson: 0, writesStarted: 0 };

    const originalJson = Response.prototype.json;
    Response.prototype.json = async function json() {
      const value = await originalJson.call(this);
      if (this.url.includes('sheets.googleapis.com')) {
        const path = decodeURIComponent(new URL(this.url).pathname);
        if (path.includes('/values/') && !path.includes('!')) {
          window.setTimeout(() => { testWindow.__survey011PastIndexWriteProbe!.completedJson++; }, 0);
        }
      }
      return value;
    };

    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function put(
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (this.name === 'kv' && key === '__past_index__') {
        testWindow.__survey011PastIndexWriteProbe!.writesStarted++;
      }
      return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
    };
  });
}

async function readProbe(page: Page): Promise<PastIndexWriteProbe> {
  return page.evaluate(() => {
    const probe = (window as typeof window & {
      __survey011PastIndexWriteProbe?: PastIndexWriteProbe;
    }).__survey011PastIndexWriteProbe;
    if (!probe) throw new Error('과거값 write probe가 설치되지 않았습니다.');
    return { ...probe };
  });
}

async function hasPastIndexBackup(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!db.objectStoreNames.contains('kv')) { db.close(); return false; }
    const value = await new Promise<unknown>((resolve, reject) => {
      const req = db.transaction('kv', 'readonly').objectStore('kv').get('__past_index__');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return value !== undefined;
  });
}

test('조회 중 clearSheets 후 늦은 응답이 캐시·IDB 스냅샷을 되살리지 않는다', async ({ page }) => {
  let requestStarted = false;
  let releaseResponse!: () => void;
  const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });

  await installPastIndexWriteProbe(page);
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    if (!path.includes('/values/') || path.includes('!')) {
      await route.fulfill({ status: 404, body: 'unexpected request' });
      return;
    }
    requestStarted = true;
    await responseGate;
    await route.fulfill({ json: { values: [HEADERS, ['2026-07-21', '이원창', '111.1']] } });
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ key, settings }) => {
    localStorage.clear();
    localStorage.setItem('gs10_google_token', JSON.stringify({
      access_token: 'test-token', expires_at: Date.now() + 3600_000, email: 'tester@example.com',
    }));
    localStorage.setItem(key, JSON.stringify(settings));
  }, { key: STORE_KEY, settings: SETTINGS });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => requestStarted).toBe(true);
  expect((await readProbe(page)).writesStarted).toBe(0);

  await page.locator('[data-testid="settings-reset-open"]').click();
  await page.locator('[data-testid="settings-reset-clear-sheets"]').check();
  await page.locator('[data-testid="settings-reset-confirm"]').click();
  await expect(page.locator('[data-testid="settings-reset-modal"]')).toBeHidden();
  await expect.poll(() => hasPastIndexBackup(page)).toBe(false);

  releaseResponse();
  await expect.poll(async () => (await readProbe(page)).completedJson).toBe(1);

  expect((await readProbe(page)).writesStarted).toBe(0);
  expect(await hasPastIndexBackup(page)).toBe(false);
});
