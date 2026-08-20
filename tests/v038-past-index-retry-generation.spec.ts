/**
 * 태스크 06 결함 1 — 낡은 세대의 403이 최신 지문의 백오프 예산을 소진하지 않는 회귀.
 *
 * 실제 로그인 → 같은 시트 헤더 재연결로 지문을 바꾼다. 구지문과 신지문 요청을 둘 다 보류한 뒤
 * 구지문 403을 먼저, 신지문 500을 나중에 완료해 현장 네트워크 순서를 결정적으로 만든다.
 */
import { test, expect, type Page } from '@playwright/test';

import { BASE } from './baseUrl';
const STORE_KEY = 'agri-voicenote-settings-v3';
const SHEET_ID = 'SHEET_V038_RETRY_GENERATION';
const INITIAL_HEADERS = ['조사일자', '농가명', '횡경'];
const UPDATED_HEADERS = ['조사일자', '농가', '횡경'];

const SETTINGS = {
  state: {
    googleConnected: true,
    userEmail: 'before@example.com',
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

interface FailureProbe { completedErrorBodies: number }

async function installGisAndFailureProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const testWindow = window as typeof window & {
      __survey011SettleGoogleLogin?: () => void;
      __survey011FailureProbe?: FailureProbe;
    };
    testWindow.__survey011FailureProbe = { completedErrorBodies: 0 };
    const originalText = Response.prototype.text;
    Response.prototype.text = async function text() {
      const value = await originalText.call(this);
      if (this.url.includes('sheets.googleapis.com') && this.status >= 400) {
        window.setTimeout(() => { testWindow.__survey011FailureProbe!.completedErrorBodies++; }, 0);
      }
      return value;
    };
    // @ts-expect-error 테스트 전용 GIS mock
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: (config: { callback: (r: unknown) => void }) => {
            let requested = false;
            testWindow.__survey011SettleGoogleLogin = () => {
              if (!requested) throw new Error('Google 로그인 요청 전에 토큰을 정착시킬 수 없습니다.');
              config.callback({
                access_token: 'fresh-login-token', expires_in: 3600, scope: '', token_type: 'Bearer',
              });
            };
            return { requestAccessToken: () => { requested = true; } };
          },
          revoke: (_token: string, cb?: () => void) => cb?.(),
        },
      },
    };
  });
}

async function settleGisLogin(page: Page): Promise<void> {
  await page.evaluate(() => {
    const settle = (window as typeof window & {
      __survey011SettleGoogleLogin?: () => void;
    }).__survey011SettleGoogleLogin;
    if (!settle) throw new Error('GIS mock token callback이 준비되지 않았습니다.');
    settle();
  });
}

async function completedErrorBodies(page: Page): Promise<number> {
  return page.evaluate(() => (
    window as typeof window & { __survey011FailureProbe?: FailureProbe }
  ).__survey011FailureProbe?.completedErrorBodies ?? 0);
}

async function persistedMeasurement(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!db.objectStoreNames.contains('kv')) { db.close(); return null; }
    const record = await new Promise<{
      samples?: [string, [string, Record<string, string>][]][];
    } | null>((resolve, reject) => {
      const req = db.transaction('kv', 'readonly').objectStore('kv').get('__past_index__');
      req.onsuccess = () => resolve((req.result ?? null) as never);
      req.onerror = () => reject(req.error);
    });
    db.close();
    const rows = record?.samples?.flatMap(([, rounds]) => rounds) ?? [];
    return rows.find(([round]) => round === '2026-07-21')?.[1]?.c3 ?? null;
  });
}

test('낡은 403 뒤 최신 일시 오류가 나도 백오프 재시도로 최신 인덱스를 준비한다', async ({ page }) => {
  let headers = INITIAL_HEADERS;
  let pastIndexGets = 0;
  let delayFailures = false;
  let oldRequestStarted = false;
  let currentRequestStarted = false;
  let releaseOld!: () => void;
  let releaseCurrent!: () => void;
  const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
  const currentGate = new Promise<void>((resolve) => { releaseCurrent = resolve; });

  await installGisAndFailureProbe(page);
  await page.route('**://www.googleapis.com/oauth2/v3/userinfo', (route) =>
    route.fulfill({ json: { email: 'after@example.com' } }));
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    if (!path.includes('/values/')) {
      await route.fulfill({ json: {
        spreadsheetId: SHEET_ID,
        properties: { title: '세대별 재시도 테스트' },
        sheets: [{ properties: { sheetId: 0, title: 'Sheet1', index: 0 } }],
      } });
      return;
    }
    if (path.includes('!')) {
      await route.fulfill({ json: { values: [headers, ['2026-07-21', '이원창', '111.1']] } });
      return;
    }

    pastIndexGets++;
    if (!delayFailures) {
      await route.fulfill({ json: { values: [headers, ['2026-07-21', '이원창', '111.1']] } });
      return;
    }
    if (!oldRequestStarted) {
      oldRequestStarted = true;
      await oldGate;
      await route.fulfill({ status: 403, body: 'old generation forbidden' });
      return;
    }
    if (!currentRequestStarted) {
      currentRequestStarted = true;
      await currentGate;
      await route.fulfill({ status: 500, body: 'current generation transient failure' });
      return;
    }
    await route.fulfill({ json: { values: [headers, ['2026-07-21', '이원창', '222.2']] } });
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ key, settings }) => {
    localStorage.clear();
    localStorage.setItem('gs10_google_token', JSON.stringify({
      access_token: 'before-token', expires_at: Date.now() + 3600_000, email: 'before@example.com',
    }));
    localStorage.setItem(key, JSON.stringify(settings));
  }, { key: STORE_KEY, settings: SETTINGS });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => pastIndexGets).toBe(1);
  await expect.poll(() => persistedMeasurement(page)).toBe('111.1');

  await page.evaluate(async () => {
    const auth = await import('/src/lib/googleAuth.ts');
    const { useSettingsStore } = await import('/src/stores/settingsStore.ts');
    await auth.signOut();
    useSettingsStore.getState().set({ googleConnected: false, userEmail: null });
  });
  headers = UPDATED_HEADERS;
  delayFailures = true;
  await page.locator('button:has-text("Google 로그인")').click();
  await settleGisLogin(page);

  await expect.poll(() => oldRequestStarted).toBe(true);
  await expect(page.locator('input[value="농가"]')).toBeVisible({ timeout: 8000 });
  await expect.poll(() => currentRequestStarted).toBe(true);

  releaseOld();
  await expect.poll(() => completedErrorBodies(page)).toBe(1);
  releaseCurrent();
  await expect.poll(() => completedErrorBodies(page)).toBe(2);

  // 600ms 첫 백오프 뒤 신지문 GET이 한 번 더 나가 222.2를 게시해야 한다.
  await expect.poll(() => pastIndexGets, { timeout: 5000 }).toBeGreaterThanOrEqual(4);
  await expect.poll(() => persistedMeasurement(page), { timeout: 5000 }).toBe('222.2');
  await expect(page.locator('[data-testid="connection-status-card"]'))
    .toContainText('1행 · 1회차 준비됨');
});
