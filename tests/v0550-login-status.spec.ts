/**
 * tests/v0550-login-status.spec.ts — v0.55.0 C-4: Google 연결 줄 3단계 및 [탭해서 갱신] 오라클.
 *
 * 이 스펙이 고정하는 문장:
 *  ⓪ 릴리스 게이트 목록 등재 자기단언
 *  ① 토큰 expires_at = Date.now() + 47.5분 => conn-google에 '사용 가능 · 42분 남음' · data-tone="ok" · conn-google-refresh 없음
 *  ② 토큰 없음 + 살아 있는 연결 기록 => '재인증 필요 · 연결 27일 남음' · data-tone="warn" · 버튼 있음 (설정탭 + 입력탭 시작 카드 둘 다)
 *  ③ 토큰 없음 + 연결 기록 없음 => '로그인 필요' · data-tone="bad" · 버튼 없음
 *  ④ ②에서 버튼 클릭 => 로그인 모달 -> [로그인] 클릭 => status_card_login:clicked 1줄 + GIS 1회 호출 -> 성공 뒤 conn-google ok
 *  ⑤ 세션 살아 있음(phase: active) => 버튼 없음 · reloginUnlessSessionLive() 직접 호출 => false · status_card_login:skipped_session_live 1줄 · GIS 0회
 */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test.setTimeout(60_000);

const ROOT = process.cwd();
const BASE = process.env.SURVEY_BASE_URL || 'http://localhost:5179';
const STORE_KEY = 'agri-voicenote-settings-v3';
const SHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';

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
    totalRows: 10,
    roundDateColId: null,
    columns: [
      { id: 'c1', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' } },
      { id: 'c2', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, sampleKey: true, auto: { kind: 'fixed', value: '이원창' } },
      { id: 'c3', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, trendRule: 'increase', auto: { kind: 'fixed', value: '' } },
    ],
    googleConnection: null,
  },
  version: 13,
};

async function installGisMock(page: Page) {
  await page.addInitScript(() => {
    const testWindow = window as typeof window & {
      __survey011SettleGoogleLogin?: () => void;
      __survey011GisCallCount?: number;
    };
    testWindow.__survey011GisCallCount = 0;
    // @ts-expect-error 테스트 전용 GIS mock
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: (config: { callback: (r: unknown) => void }) => {
            let requested = false;
            testWindow.__survey011SettleGoogleLogin = () => {
              if (!requested) throw new Error('Google 로그인 요청 전에 토큰을 정착시킬 수 없습니다.');
              config.callback({
                access_token: 'fresh-login-token',
                expires_in: 3600,
                scope: '',
                token_type: 'Bearer',
              });
            };
            return {
              requestAccessToken: () => {
                testWindow.__survey011GisCallCount = (testWindow.__survey011GisCallCount ?? 0) + 1;
                requested = true;
              },
            };
          },
          revoke: (_token: string, cb?: () => void) => cb?.(),
        },
      },
    };
  });
}

test('[node] ⓪-게이트 이 오라클이 릴리스 게이트 목록에 등재돼 있다 (v0.55.0)', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as {
    scripts: Record<string, string>;
  };
  const listed = (pkg.scripts['test:e2e:gate'] ?? '').split(/\s+/).filter((x) => x.startsWith('tests/'));
  expect(listed, 'tests/v0550-login-status.spec.ts가 릴리스 게이트 목록에 없다').toContain('tests/v0550-login-status.spec.ts');
  expect(listed, 'tests/v051-auth-callsite-allowlist.spec.ts가 릴리스 게이트 목록에 없다').toContain('tests/v051-auth-callsite-allowlist.spec.ts');
});

test('① 토큰 expires_at = Date.now() + 47.5분 => 사용 가능 · 42분 남음 (ok) · 갱신 버튼 없음', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const expiresAt = Date.now() + Math.floor(47.5 * 60 * 1000);

  await page.evaluate(({ settings, storeKey, exp }) => {
    localStorage.clear();
    localStorage.setItem(storeKey, JSON.stringify(settings));
    localStorage.setItem('gs10_google_token', JSON.stringify({
      access_token: 'valid-test-token',
      expires_at: exp,
      email: 'tester@example.com',
    }));
  }, { settings: SETTINGS, storeKey: STORE_KEY, exp: expiresAt });

  await page.reload({ waitUntil: 'domcontentloaded' });

  const card = page.locator('[data-testid="connection-status-card"]');
  await expect(card).toBeVisible();

  const googleRow = page.locator('[data-testid="conn-google"]');
  await expect(googleRow).toContainText('사용 가능 · 42분 남음');
  await expect(googleRow).toHaveAttribute('data-tone', 'ok');

  // conn-google-refresh 버튼 없음
  await expect(page.locator('[data-testid="conn-google-refresh"]')).toHaveCount(0);
});

test('② 토큰 없음 + 살아 있는 연결 기록 => 재인증 필요 · 연결 27일 남음 (warn) · 버튼 노출 (설정+입력)', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const oneHourAgo = Date.now() - 3600_000;

  await page.evaluate(({ settings, storeKey, t }) => {
    localStorage.clear();
    const s = {
      ...settings,
      state: {
        ...settings.state,
        googleConnection: {
          email: 'tester@example.com',
          connectedAt: t,
          lastUsedAt: t,
        },
      },
    };
    localStorage.setItem(storeKey, JSON.stringify(s));
    localStorage.setItem('gs10_google_connection', JSON.stringify({
      email: 'tester@example.com',
      connectedAt: t,
      lastUsedAt: t,
    }));
  }, { settings: SETTINGS, storeKey: STORE_KEY, t: oneHourAgo });

  await page.reload({ waitUntil: 'domcontentloaded' });

  // 1. 설정탭 확인
  const googleRowSettings = page.locator('[data-testid="conn-google"]');
  await expect(googleRowSettings).toContainText('재인증 필요 · 연결 27일 남음');
  await expect(googleRowSettings).toHaveAttribute('data-tone', 'warn');
  await expect(page.locator('[data-testid="conn-google-refresh"]')).toBeVisible();

  // 2. 입력탭 시작 카드 확인
  await page.locator('[data-testid="tab-voice"]').click();
  const googleRowVoice = page.locator('[data-testid="conn-google"]');
  await expect(googleRowVoice).toContainText('재인증 필요 · 연결 27일 남음');
  await expect(googleRowVoice).toHaveAttribute('data-tone', 'warn');
  await expect(page.locator('[data-testid="conn-google-refresh"]')).toBeVisible();
});

test('③ 토큰 없음 + 연결 기록 없음 => 로그인 필요 (bad) · 버튼 없음', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  await page.evaluate(({ settings, storeKey }) => {
    localStorage.clear();
    const s = {
      ...settings,
      state: {
        ...settings.state,
        googleConnected: false,
        googleConnection: null,
      },
    };
    localStorage.setItem(storeKey, JSON.stringify(s));
  }, { settings: SETTINGS, storeKey: STORE_KEY });

  await page.reload({ waitUntil: 'domcontentloaded' });

  const googleRow = page.locator('[data-testid="conn-google"]');
  await expect(googleRow).toContainText('로그인 필요');
  await expect(googleRow).toHaveAttribute('data-tone', 'bad');
  await expect(page.locator('[data-testid="conn-google-refresh"]')).toHaveCount(0);
});

test('④ ②에서 버튼 클릭 => 로그인 모달 -> [로그인] 클릭 => status_card_login:clicked 및 성공 후 ok', async ({ page }) => {
  await installGisMock(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const oneHourAgo = Date.now() - 3600_000;

  await page.evaluate(({ settings, storeKey, t }) => {
    localStorage.clear();
    const s = {
      ...settings,
      state: {
        ...settings.state,
        googleConnection: {
          email: 'tester@example.com',
          connectedAt: t,
          lastUsedAt: t,
        },
      },
    };
    localStorage.setItem(storeKey, JSON.stringify(s));
    localStorage.setItem('gs10_google_connection', JSON.stringify({
      email: 'tester@example.com',
      connectedAt: t,
      lastUsedAt: t,
    }));
  }, { settings: SETTINGS, storeKey: STORE_KEY, t: oneHourAgo });

  await page.reload({ waitUntil: 'domcontentloaded' });

  // [탭해서 갱신] 클릭
  const refreshBtn = page.locator('[data-testid="conn-google-refresh"]');
  await expect(refreshBtn).toBeVisible();
  await refreshBtn.click();

  // 로그인 모달 노출 확인
  const modalHeader = page.locator('text=로그인이 필요합니다');
  await expect(modalHeader).toBeVisible();
  await expect(page.getByRole('dialog').locator('p')).toHaveCount(0);

  // 모달 안의 [로그인] 클릭
  const loginBtn = page.locator('button:has-text("로그인")').first();
  await loginBtn.click();

  // GIS 가짜 콜백 정착
  await page.evaluate(() => {
    (window as any).__survey011SettleGoogleLogin();
  });

  // status_card_login:clicked 1줄 확인
  const logs = await page.evaluate(async () => {
    const { logger } = await import('/src/lib/logger.ts');
    return logger.getAll().filter((e) => (e.extra ?? '') === 'status_card_login:clicked');
  });
  expect(logs).toHaveLength(1);

  // GIS 1회 호출 확인
  const gisCount = await page.evaluate(() => (window as any).__survey011GisCallCount);
  expect(gisCount).toBe(1);

  // 성공 뒤 conn-google 이 ok 로 전환
  const googleRow = page.locator('[data-testid="conn-google"]');
  await expect(googleRow).toHaveAttribute('data-tone', 'ok');
});

test('⑤ 세션이 살아 있으면 버튼 없음 · reloginUnlessSessionLive() 호출 시 false 및 skipped', async ({ page }) => {
  await installGisMock(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const oneHourAgo = Date.now() - 3600_000;

  await page.evaluate(({ settings, storeKey, t }) => {
    localStorage.clear();
    const s = {
      ...settings,
      state: {
        ...settings.state,
        googleConnection: {
          email: 'tester@example.com',
          connectedAt: t,
          lastUsedAt: t,
        },
      },
    };
    localStorage.setItem(storeKey, JSON.stringify(s));
    localStorage.setItem('gs10_google_connection', JSON.stringify({
      email: 'tester@example.com',
      connectedAt: t,
      lastUsedAt: t,
    }));
  }, { settings: SETTINGS, storeKey: STORE_KEY, t: oneHourAgo });

  await page.reload({ waitUntil: 'domcontentloaded' });

  // 세션을 phase: 'active'로 설정
  await page.evaluate(async () => {
    const { useSessionStore } = await import('/src/stores/sessionStore.ts');
    useSessionStore.setState({
      phase: 'active',
      sessionId: 'sess_live_test',
    });
  });

  // 세션이 살아 있으므로 conn-google-refresh 버튼이 DOM에 없음
  await expect(page.locator('[data-testid="conn-google-refresh"]')).toHaveCount(0);

  // reloginUnlessSessionLive() 직접 호출 시 false 반환 및 status_card_login:skipped_session_live 방출
  const res = await page.evaluate(async () => {
    const { reloginUnlessSessionLive } = await import('/src/lib/syncAuthGuard.ts');
    return reloginUnlessSessionLive();
  });
  expect(res).toBe(false);

  const logs = await page.evaluate(async () => {
    const { logger } = await import('/src/lib/logger.ts');
    return logger.getAll().filter((e) => (e.extra ?? '') === 'status_card_login:skipped_session_live');
  });
  expect(logs).toHaveLength(1);

  // GIS 호출 0회 확인
  const gisCount = await page.evaluate(() => (window as any).__survey011GisCallCount);
  expect(gisCount).toBe(0);
});
