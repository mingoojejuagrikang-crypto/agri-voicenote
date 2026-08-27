/**
 * v0.51 r2 — **세션이 살아 있는 동안에는 업로드 경로도 토큰을 갱신하지 않는다.**
 *
 * ## 왜 (r1 open_questions ①②의 triage 판정)
 * 「세션 중 갱신 절대 금지」(계획서 §2-6 · rauth §2-6 실측 — GIS 팝업이 앱을 1~2초 백그라운드로
 * 보내고, 그게 [CLIP-SILENT-1]·[CLIP-LOSS-1]의 정확한 조건이다)는 r1의 [F-3]에서 **동기화 클릭
 * 선두(preRefresh)** 에만 걸렸다. 옆문이 둘 남아 있었다:
 *   ① 업로드 직전 `ensureAccessToken()` — 클릭 직후면 transient activation이 아직 살아 있어
 *      제스처 가드를 그냥 통과한다.
 *   ② `withAuthRetry`에 주입되는 `ensureAuth({force:true})` — r1 [F-4]가 제스처 가드를 **면제**
 *      했으므로 activation과 무관하게 팝업을 연다.
 * 둘 다 녹음 위로 팝업을 띄울 수 있다 = **녹음 데이터 유실**.
 *
 * 판정: **녹음 무결성이 갱신 편의보다 위다.** 세션 중 진짜 만료는 「보이는 실패」(재로그인 모달)로
 * 넘긴다 — 그 모달의 [로그인] 클릭은 사용자 명시 의사라 세션 중에도 그대로 허용한다.
 * 세션 **밖** 동기화(대부분의 실사용)에서는 [F-4] 면제가 그대로 산다 — 아래 두 테스트가 그 **대조
 * 쌍**이다. 같은 401을 세션 유무만 바꿔 두 번 재고, 결과가 갈리는 것이 계약이다.
 *
 * 반증 축: `ensureAuthUnlessSessionLive`의 세션 가드를 지우면 ①이 red(팝업이 열린다).
 *          [F-4]의 `force` 면제를 지우면 ②가 red(세션 밖에서도 갱신을 포기한다).
 *
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다(수동 기동 불필요, [ORCH-27])
 */
import { test, expect, type Page } from '@playwright/test';
import { IDB, APPLY_APP_SCHEMA_SOURCE } from './fixtures/idb';
import { BASE } from './baseUrl';

test.setTimeout(60_000);

const STORE_KEY = 'agri-voicenote-settings-v3';
const SHEET_ID = 'SHEET_R2_GUARD';

const COLUMNS = [
  { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 } },
  { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
];

const SETTINGS = {
  state: {
    googleConnected: true,
    userEmail: 'tester@example.com',
    // 살아 있는 4주 창(2시간 전 사용) — 「연결된 사용자 · 토큰은 유효」 상태를 정확히 심는다.
    googleConnection: {
      email: 'tester@example.com',
      connectedAt: Date.now() - 2 * 60 * 60 * 1000,
      lastUsedAt: Date.now() - 2 * 60 * 60 * 1000,
    },
    sheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`,
    sheetTab: 'Sheet1',
    savedSheets: [
      { name: '감귤조사', url: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`, sheetId: SHEET_ID, addedAt: 1781000000000 },
    ],
    recognitionTolerance: 0.6,
    chipSweepSeconds: 0,
    columns: COLUMNS,
  },
  version: 13,
};

function makeSession() {
  return {
    id: 'sess-r2-guard-1',
    date: '2026-08-27',
    label: 'r2가드',
    target: { spreadsheetId: SHEET_ID, sheetTab: 'Sheet1' },
    columns: COLUMNS,
    rows: [
      { index: 1, values: { c6: '1', c8: '11.1' }, complete: true },
      { index: 2, values: { c6: '2', c8: '22.2' }, complete: true },
    ],
    completedRows: 2,
    syncedRows: 0,
    startedAt: 1781000000000,
    finishedAt: 1781000600000,
  };
}

/** 시트는 성공, **Drive 업로드만 401**. 그래야 `withAuthRetry`의 force 갱신 경로에 진입한다. */
async function stubNetwork(page: Page) {
  let nextAppendRow = 2;
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    const req = route.request();
    if (req.url().includes(':append')) {
      const body = req.postDataJSON() as { values: unknown[][] };
      const first = nextAppendRow;
      const last = nextAppendRow + body.values.length - 1;
      nextAppendRow = last + 1;
      await route.fulfill({ json: { updates: { updatedRange: `Sheet1!A${first}:B${last}`, updatedRows: body.values.length } } });
      return;
    }
    if (req.method() === 'GET') {
      await route.fulfill({ json: { values: [['조사나무', '횡경']] } });
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected' });
  });
  // 폴더 조회/생성 등 일반 Drive 호출은 성공시키고(그래야 업로드 지점까지 간다),
  // 업로드 엔드포인트만 401로 떨군다 — `isAuthError`가 \b401\b로 판정한다.
  await page.route('**://www.googleapis.com/**', (route) =>
    route.fulfill({ json: { id: 'stub', files: [{ id: 'stub' }] } }));
  await page.route('**://www.googleapis.com/upload/drive/v3/**', (route) =>
    route.fulfill({ status: 401, body: '401 Unauthorized: invalid credentials' }));
  await page.route('**://www.googleapis.com/oauth2/v3/userinfo', (route) =>
    route.fulfill({ json: { email: 'tester@example.com' } }));
}

/** GIS mock — `requestAccessToken` 호출 횟수를 기록한다(이 스펙의 핵심 계측). */
async function installGisSpy(page: Page) {
  await page.addInitScript(() => {
    let issued = 0;
    // @ts-expect-error 테스트 전용 계측
    window.__gisIssued = () => issued;
    // @ts-expect-error 테스트 전용 전역 mock
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: (config: { callback: (r: unknown) => void }) => ({
            requestAccessToken: () => {
              issued += 1;
              config.callback({ access_token: 'r2-fresh-token', expires_in: 3600, scope: '', token_type: 'Bearer' });
            },
          }),
          revoke: (_t: string, cb?: () => void) => { cb?.(); },
        },
      },
    };
  });
}

/** **유효 토큰**으로 부팅한다 — 이 스펙의 만료는 「로컬 토큰」이 아니라 「서버가 준 401」이다. */
async function seedAndBoot(page: Page) {
  await stubNetwork(page);
  await installGisSpy(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async ({ sess, settings, idb, schemaSrc }) => {
    localStorage.clear();
    localStorage.setItem('gs10_google_token', JSON.stringify({
      access_token: 'locally-valid-token', expires_at: Date.now() + 3600_000, email: 'tester@example.com',
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
  }, { sess: makeSession(), settings: SETTINGS, idb: IDB, schemaSrc: APPLY_APP_SCHEMA_SOURCE });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-data"]').click();
  await page.waitForTimeout(300);
}

async function setSessionLive(page: Page, live: boolean) {
  await page.evaluate(async (isLive) => {
    const { useSessionStore } = await import('/src/stores/sessionStore.ts');
    useSessionStore.getState().setPhase(isLive ? 'active' : 'ready');
    const { logger } = await import('/src/lib/logger.ts');
    logger.clear();
  }, live);
}

async function openSyncAndConfirm(page: Page) {
  await page.locator('text=시트에 추가').first().click();
  await page.waitForTimeout(200);
  await page.locator('button:has-text("추가 (")').click();
  await page.waitForTimeout(900);
}

async function authExtras(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const { logger } = await import('/src/lib/logger.ts');
    return logger.getAll().map((e) => e.extra).filter((x): x is string => typeof x === 'string');
  });
}

async function gisCount(page: Page): Promise<number> {
  // @ts-expect-error 테스트 전용 계측
  return page.evaluate(() => (window.__gisIssued as () => number)());
}

// ─── 세션 live 중 401 — 갱신을 시도하지 않고 「보이는 실패」로 넘긴다 ────────────────────────
test('r2 ①: 세션 live 중 업로드 401 — GIS 미호출 + skipped:session_live:forced + 재로그인 모달', async ({ page }) => {
  await seedAndBoot(page);
  await setSessionLive(page, true);

  await openSyncAndConfirm(page);

  const extras = await authExtras(page);
  expect(await gisCount(page),
    '🔴 녹음 중에 GIS 팝업이 열렸다 — 앱이 1~2초 백그라운드로 가 클립이 죽는 조건이다').toBe(0);
  expect(extras, '세션 가드 계측이 없다 — force 재시도가 그대로 갱신을 시도했다')
    .toContain('auth_ensure:skipped:session_live:forced');
  // 종전 실패 경로로 수렴한다 — 「다음 행동」은 모달이 맡고, 그 클릭은 사용자 명시 의사다.
  await expect(page.locator('[role="dialog"][aria-labelledby="login-required-title"]')).toBeVisible();
});

// ─── 대조 쌍: 세션이 없으면 같은 401에서 force 갱신이 **살아 있다**([F-4] 면제) ──────────────
test('r2 ②: 세션 없음 + 업로드 401 — force 갱신이 시도된다(F-4 면제가 세션 밖에서는 그대로 산다)', async ({ page }) => {
  await seedAndBoot(page);
  await setSessionLive(page, false);

  await openSyncAndConfirm(page);

  const extras = await authExtras(page);
  expect(await gisCount(page),
    '세션이 없는데 force 갱신이 팝업을 안 열었다 — v0.50 [UPLOAD-AUTH-1] 자동 재시도가 죽는다')
    .toBeGreaterThanOrEqual(1);
  expect(extras).toContain('auth_ensure:refreshed:forced');
  expect(extras, '세션이 없는데 세션 가드가 걸렸다').not.toContain('auth_ensure:skipped:session_live:forced');
});
