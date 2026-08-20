/**
 * v0.20.0 Phase 2 — 토큰 만료/미로그인 시 데이터탭 동기화 회귀 (red→green).
 *
 * v0.19.0 실기기 근본원인: OAuth 토큰이 만료돼 시트 업로드가 조용히 실패했다. 코드 근거 —
 * 토큰 없으면 syncSelected가 report.needsLogin + report.message를 돌려준다. 이 테스트가 검증:
 *   ① 토큰 만료 시 LoginRequiredModal("로그인이 필요합니다") 노출.
 *   ② 사유 메시지가 화면 배너에 항상 표면화(report.ok===0 "메시지 없음" 버그 방지).
 *   ③ 모달 [로그인] → 재로그인(여기선 GIS mock) 성공 → 같은 동기화가 이어져 시트에 append.
 *
 * GIS(google.accounts.oauth2)를 mock해 signIn()이 토큰을 발급하도록 한다(실 네트워크/팝업 없음).
 * Sheets API는 sync-skip-rows 패턴으로 page.route stub.
 *
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다(수동 기동 불필요, [ORCH-27])
 */
import { test, expect, type Page } from '@playwright/test';
import { IDB, APPLY_APP_SCHEMA_SOURCE } from './fixtures/idb';
import { BASE } from './baseUrl';

test.setTimeout(60_000);

const SETTINGS = {
  state: {
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_ID_EXP/edit',
    sheetTab: 'Sheet1',
    // 순수 토큰 만료에선 sheetUrl/sheetTab이 살아 있어 재로그인 후 바로 재개(reconnect no-op).
    savedSheets: [
      { name: '감귤조사', url: 'https://docs.google.com/spreadsheets/d/SHEET_ID_EXP/edit', sheetId: 'SHEET_ID_EXP', addedAt: 1781000000000 },
    ],
    recognitionTolerance: 0.6,
    columns: [
      { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 } },
      { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
    ],
  },
  version: 0,
};

function makeSession() {
  return {
    id: 'sess-expiry-1',
    date: '2026-06-24',
    label: '만료테스트',
    target: { spreadsheetId: 'SHEET_ID_EXP', sheetTab: 'Sheet1' },
    columns: SETTINGS.state.columns,
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

interface SheetCall { method: string; url: string }

async function stubSheets(page: Page): Promise<SheetCall[]> {
  const calls: SheetCall[] = [];
  let nextAppendRow = 2;
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    const req = route.request();
    calls.push({ method: req.method(), url: req.url() });
    if (req.url().includes(':append')) {
      const body = req.postDataJSON() as { values: unknown[][] };
      const first = nextAppendRow;
      const last = nextAppendRow + body.values.length - 1;
      nextAppendRow = last + 1;
      await route.fulfill({ json: { updates: { updatedRange: `Sheet1!A${first}:B${last}`, updatedRows: body.values.length } } });
      return;
    }
    if (req.method() === 'GET') {
      // [SYNC-3] fix — syncSelected() fetches the sheet header once per batch before appending.
      // Header matches SETTINGS.state.columns (조사나무, 횡경) exactly so existing assertions
      // below (which predate the header-mapping fix) keep holding.
      await route.fulfill({ json: { values: [['조사나무', '횡경']] } });
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected' });
  });
  return calls;
}

/** GIS(google.accounts.oauth2) mock 주입 — signIn()의 requestAccessToken이 콜백으로 토큰을 발급.
 *  userinfo(이메일)도 stub해 fetchEmail이 성공하게 한다(드라이브 백업 admin 경로 진입은 별개). */
async function installGisMock(page: Page) {
  // 재로그인 후 성공 동기화는 Drive 로그 백업까지 이어진다. Drive(www.googleapis.com)를 stub해
  // 백업이 성공하게 한다(미stub이면 백업 401 → LoginRequiredModal 재마운트로 모달이 다시 떠 flaky).
  // 광범위 stub을 먼저 등록하고, userinfo(이메일)는 그 뒤에 등록해 우선 매칭되게 한다
  // (Playwright는 나중에 등록한 route가 우선).
  await page.route('**://www.googleapis.com/**', (route) =>
    route.fulfill({ json: { id: 'stub', files: [{ id: 'stub' }] } }));
  await page.route('**://www.googleapis.com/oauth2/v3/userinfo', async (route) => {
    await route.fulfill({ json: { email: 'tester@example.com' } });
  });
  await page.addInitScript(() => {
    // @ts-expect-error 테스트 전용 전역 mock
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: (config: { callback: (r: unknown) => void }) => ({
            requestAccessToken: () => {
              // 클릭 제스처 안에서 동기적으로 토큰 콜백 — 실 GIS 팝업 흐름을 모사.
              config.callback({ access_token: 'fresh-token-after-relogin', expires_in: 3600, scope: '', token_type: 'Bearer' });
            },
          }),
          revoke: (_t: string, cb?: () => void) => { cb?.(); },
        },
      },
    };
  });
}

/** 토큰 없이 부팅(만료 시뮬). settings/세션은 시드하되 gs10_google_token은 일부러 미설정. */
async function seedNoToken(page: Page, session: unknown) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async ({ sess, settings, idb, schemaSrc }) => {
    localStorage.clear();
    // 토큰 없음 = 만료/미로그인 상태.
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
  }, { sess: session, settings: SETTINGS, idb: IDB, schemaSrc: APPLY_APP_SCHEMA_SOURCE });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-data"]').click();
  await page.waitForTimeout(300);
}

async function openSyncAndConfirm(page: Page) {
  await page.locator('text=시트에 추가').first().click();
  await page.waitForTimeout(200);
  await page.locator('button:has-text("추가 (")').click();
  await page.waitForTimeout(500);
}

test('토큰 만료: 동기화 시 ① 로그인 팝업 노출 ② 사유 메시지 표면화', async ({ page }) => {
  await installGisMock(page);
  await stubSheets(page);
  await seedNoToken(page, makeSession());

  await openSyncAndConfirm(page);

  // ① LoginRequiredModal — 제목 "로그인이 필요합니다" + 동기화용 reason.
  const modal = page.locator('[role="dialog"][aria-labelledby="login-required-title"]');
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('로그인이 필요합니다');
  await expect(modal).toContainText('시트 동기화');

  // ② 사유 메시지가 화면 배너에도 표면화(report.ok===0이어도 "메시지 없음" 아님).
  await expect(page.locator('text=Google 로그인이 필요합니다').first()).toBeVisible();
});

test('토큰 만료: ③ 모달 [로그인] → 재로그인 → 같은 동기화 재개(시트 append)', async ({ page }) => {
  await installGisMock(page);
  const calls = await stubSheets(page);
  await seedNoToken(page, makeSession());

  await openSyncAndConfirm(page);

  // 재로그인 전: 토큰 없어 시트 호출 0.
  expect(calls.filter((c) => c.url.includes(':append'))).toHaveLength(0);

  // 모달 [로그인] 클릭 → GIS mock이 토큰 발급 → resume이 동기화를 이어 실행.
  const modal = page.locator('[role="dialog"][aria-labelledby="login-required-title"]');
  await expect(modal).toBeVisible();
  await modal.locator('button:has-text("로그인")').click();

  // 모달 닫힘(재로그인 성공 → resume) — signIn은 fetchEmail(stub)까지 await하므로 넉넉히 대기.
  await expect(modal).toBeHidden({ timeout: 10_000 });
  await page.waitForTimeout(600); // resume 동기화 완료 여유

  // 동기화 재개로 append 발생.
  const appends = calls.filter((c) => c.url.includes(':append'));
  expect(appends.length).toBeGreaterThanOrEqual(1);

  // 성공 메시지(행 추가/갱신) 배너 표면화(✓ 접두 = 성공 배너, 액션바 버튼과 구별).
  await expect(page.locator('text=행 추가').first()).toBeVisible();
});
