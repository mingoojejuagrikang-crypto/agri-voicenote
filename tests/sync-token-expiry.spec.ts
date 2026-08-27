/**
 * v0.20.0 Phase 2 — 토큰 만료/미로그인 시 데이터탭 동기화 회귀 (red→green).
 *
 * v0.19.0 실기기 근본원인: OAuth 토큰이 만료돼 시트 업로드가 조용히 실패했다. 코드 근거 —
 * 토큰 없으면 syncSelected가 report.needsLogin + report.message를 돌려준다. 이 테스트가 검증:
 *   ① 토큰 만료 시 LoginRequiredModal("로그인이 필요합니다") 노출.
 *   ② 사유 메시지가 화면 배너에 항상 표면화(report.ok===0 "메시지 없음" 버그 방지).
 *   ③ 모달 [로그인] → 재로그인(여기선 GIS mock) 성공 → 같은 동기화가 이어져 시트에 append.
 *
 * 🔴 **v0.51 재정합** — rauth P1(제스처 안 선제 갱신)이 들어오면서 ①②③의 **전제**가 바뀌었다.
 * 토큰이 만료된 채 동기화를 눌러도 이제는 클릭의 동기 구간에서 무팝업 갱신이 서고, 그게 성공하면
 * **로그인 모달은 뜨지 않는다** — 그것이 이 회차의 목적(「매시간 로그인 풀림」 해소)이다.
 * 그래서 ①③은 「**갱신이 실패한 국면**의 폴백 계약」으로 재서술했고(`setSilentRefresh(false)`),
 * 「갱신이 되면 모달 없이 첫 시도에 성공한다」는 새 계약을 맨 아래 P1 오라클이 맡는다.
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
    // 🔴 v0.51 r3 [F-13] — 자동 갱신의 자격은 **살아 있는 4주 창** 하나다. 이 스펙의 전제는
    //    「연결된 사용자인데 토큰만 만료」이므로 그 창을 명시적으로 심는다. 안 심으면 P1이
    //    `auth_ensure:skipped:no_connection`으로 멈춰(정상 동작) 이 스펙이 재려는 축이 사라진다.
    googleConnected: true,
    userEmail: 'tester@example.com',
    googleConnection: {
      email: 'tester@example.com',
      connectedAt: Date.now() - 2 * 60 * 60 * 1000,
      lastUsedAt: Date.now() - 2 * 60 * 60 * 1000,
    },
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
  // 🔴 v0.51 P1 재정합 — 갱신 성공/실패를 **런타임에 뒤집을 수 있어야** 한다.
  //   P1(제스처 안 선제 갱신)이 들어오면서 「토큰 만료 상태로 동기화를 누른다」의 기본 결과가
  //   바뀌었다: 무팝업 갱신이 되면 그 자리에서 성공하고 **로그인 모달은 뜨지 않는다**(그게 이
  //   회차의 목적이다). 모달 경로는 이제 **갱신이 실패했을 때의 폴백**이므로, 그 계약을 재려면
  //   갱신을 한 번 실패시켰다가 모달의 [로그인] 클릭에서 성공시켜야 한다.
  await page.addInitScript(() => {
    // @ts-expect-error 테스트 전용 스위치(기본 성공)
    window.__gisFail = false;
    // @ts-expect-error 테스트 전용 전역 mock
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            callback: (r: unknown) => void;
            error_callback?: (e: { type: string }) => void;
          }) => ({
            requestAccessToken: () => {
              // @ts-expect-error 테스트 전용 스위치
              if (window.__gisFail) { config.error_callback?.({ type: 'popup_failed_to_open' }); return; }
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

/** 무팝업 갱신의 성공/실패를 뒤집는다(위 mock의 `__gisFail`). */
async function setSilentRefresh(page: Page, ok: boolean) {
  // @ts-expect-error 테스트 전용 스위치
  await page.evaluate((fail) => { window.__gisFail = fail; }, !ok);
}

/** 앱 로그에서 인증·업로드 이벤트만 순서대로 뽑는다(P1의 **순서** 단언용). */
async function readOrderedLog(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const { logger } = await import('/src/lib/logger.ts');
    return logger
      .getAll()
      .map((e) => e.extra)
      .filter((x): x is string =>
        typeof x === 'string' && (x.startsWith('auth_ensure') || x.startsWith('drive_upload')));
  });
}

/** 토큰 없이 부팅(만료 시뮬). settings/세션은 시드하되 gs10_google_token은 일부러 미설정.
 *  `connection`으로 4주 창 상태를 갈아끼운다(기본 = SETTINGS의 살아 있는 창). */
async function seedNoToken(page: Page, session: unknown, connection?: unknown) {
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
  }, {
    sess: session,
    // 🔴 `connection: null`은 「명시적 해제」다 — `googleConnected`도 함께 내려야 한다.
    //    안 내리면 v13 마이그레이션이 `googleConnected:true`를 보고 **새 창을 합성**해(승계 계약)
    //    "기록 없음" 전제가 사라진다(빌더 r3 실측).
    settings: connection === undefined
      ? SETTINGS
      : {
          ...SETTINGS,
          state: {
            ...SETTINGS.state,
            googleConnection: connection,
            ...(connection === null ? { googleConnected: false, userEmail: null } : {}),
          },
        },
    idb: IDB, schemaSrc: APPLY_APP_SCHEMA_SOURCE,
  });
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

test('토큰 만료 + 무팝업 갱신 실패: 동기화 시 ① 로그인 팝업 노출 ② 사유 메시지 표면화', async ({ page }) => {
  await installGisMock(page);
  await stubSheets(page);
  await seedNoToken(page, makeSession());
  // v0.51 — 갱신이 **실패했을 때**의 폴백 계약이다(P1이 성공하면 모달은 애초에 뜨지 않는다).
  await setSilentRefresh(page, false);

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
  await setSilentRefresh(page, false); // P1 선제 갱신 실패 → 모달 경로 진입

  await openSyncAndConfirm(page);

  // 재로그인 전: 토큰 없어 시트 호출 0.
  expect(calls.filter((c) => c.url.includes(':append'))).toHaveLength(0);

  // 모달 [로그인] 클릭 → GIS mock이 토큰 발급 → resume이 동기화를 이어 실행.
  const modal = page.locator('[role="dialog"][aria-labelledby="login-required-title"]');
  await expect(modal).toBeVisible();
  await setSilentRefresh(page, true); // 사용자가 다시 시도하는 국면 — 이번엔 갱신이 된다
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

// ─── v0.51 rauth P1 오라클 — 선제 갱신이 **제스처 안에서** 먼저 선다 ────────────────────────
// 2026-08-19 실측의 실패 모양은 `drive_upload:partial:fail=…` **다음에** 인증 이벤트가 오는
// 것이었다(만료된 토큰으로 업로드를 시작 → 사용자가 로그인 버튼을 눌러야 갱신). P1은 그 순서를
// 뒤집는다. 반증 축: 갱신을 종전처럼 업로드 직전으로 되돌리면 refreshed가 drive_upload보다
// **뒤로** 가거나 아예 `auth_ensure:skipped:no_gesture`가 되어 red.
test('P1: 만료 임박 상태에서 동기화 클릭 — auth_ensure:refreshed가 drive_upload보다 선행하고 모달이 없다', async ({ page }) => {
  await installGisMock(page);
  const calls = await stubSheets(page);
  await seedNoToken(page, makeSession());
  await setSilentRefresh(page, true); // 무팝업 갱신이 되는 정상 국면

  await openSyncAndConfirm(page);
  await page.waitForTimeout(800);

  const log = await readOrderedLog(page);
  const refreshedAt = log.findIndex((x) => x.startsWith('auth_ensure:refreshed'));
  const uploadAt = log.findIndex((x) => x.startsWith('drive_upload'));
  expect(refreshedAt, '선제 갱신이 아예 안 일어났다 — 제스처 밖으로 밀렸다').toBeGreaterThanOrEqual(0);
  expect(uploadAt, '업로드 계측이 없다 — 이 오라클의 전제가 깨졌다').toBeGreaterThanOrEqual(0);
  expect(refreshedAt, 'refreshed가 drive_upload보다 뒤에 왔다 — 2026-08-19 그 순서 그대로다')
    .toBeLessThan(uploadAt);
  // 갱신이 됐으므로 재로그인 모달은 뜨지 않는다(= 매시간 풀림 UX의 종결점).
  await expect(page.locator('[role="dialog"][aria-labelledby="login-required-title"]')).toBeHidden();
  // 그리고 시트 append가 첫 시도에 난다.
  expect(calls.filter((c) => c.url.includes(':append')).length).toBeGreaterThanOrEqual(1);
});

// ─── v0.51 r1 [F-3 / 리뷰 H-3] — 세션이 살아 있으면 동기화 클릭이 팝업을 열지 않는다 ──────────
// 「세션 중 갱신 절대 금지」(계획서 §2-6 · rauth §2-6 실측: 팝업이 앱을 1~2초 백그라운드로 보낸다
// = [CLIP-SILENT-1]·[CLIP-LOSS-1]의 조건)는 P2에만 걸려 있었다. 세션 중 데이터탭 진입은 막혀
// 있지 않고(세션이 살아 있으면 VoiceScreen이 keep-alive로 남는다 [STT-16]) 3시간 세션 × 1시간
// 토큰이면 2시간차 이후의 동기화 클릭은 「토큰 만료」가 기대값이라, P1은 정확히 녹음 중에 팝업을 연다.
// 반증 축: 세션 활성 가드를 지우면 `auth_signin_start`가 찍혀 red.
test('F-3: 세션 live 중 동기화 확정 — 선제 갱신을 하지 않는다(가드가 어떤 signIn보다 앞선다)', async ({ page }) => {
  await installGisMock(page);
  await stubSheets(page);
  await seedNoToken(page, makeSession());
  await setSilentRefresh(page, true); // 갱신이 **되는** 국면이어야 「안 했다」가 의미를 갖는다

  // 녹음 중 상태를 만든다 — 세션 스토어 phase만 세우면 제품 판정(isSessionLive)이 그대로 걸린다.
  await page.evaluate(async () => {
    const { useSessionStore } = await import('/src/stores/sessionStore.ts');
    useSessionStore.getState().setPhase('active');
    const { logger } = await import('/src/lib/logger.ts');
    logger.clear();
  });

  await openSyncAndConfirm(page);
  await page.waitForTimeout(600);

  const extras = await page.evaluate(async () => {
    const { logger } = await import('/src/lib/logger.ts');
    return logger.getAll().map((e) => e.extra).filter((x): x is string => typeof x === 'string');
  });
  const skipAt = extras.indexOf('auth_prerefresh:skipped:session_live');
  expect(skipAt, '세션 활성 가드가 안 걸렸다 — 클릭 즉시 팝업이 열린다').toBeGreaterThanOrEqual(0);
  // 🔴 **순서**가 계약이다: 클릭의 동기 구간에서 갱신이 시작되지 않았다.
  //    (업로드 직전 `ensureAccessToken`은 v0.50 [UPLOAD-AUTH-1]의 **종전 경로**라 그대로 남는다 —
  //     그래서 `auth_signin_start` 0건이 아니라 「가드가 그보다 앞선다」로 잰다. 잔존 축은
  //     빌더 산출물의 open_questions에 올렸다.)
  const firstSignIn = extras.indexOf('auth_signin_start');
  if (firstSignIn >= 0) {
    expect(skipAt, '🔴 선제 갱신이 가드보다 먼저 팝업을 열었다 — 녹음 중 백그라운드 전환 조건')
      .toBeLessThan(firstSignIn);
  }
  // 🔴 v0.51 **r2**가 그 잔존을 닫았다 — 업로드 직전 `ensureAccessToken`과 `withAuthRetry`의
  //    force 재시도에도 같은 세션 가드가 걸렸으므로, 이제 세션 중에는 **어떤 경로로도** 팝업이
  //    열리지 않는다. r1에서 「불가능」이라 적었던 그 단언을 여기서 세운다.
  expect(extras.filter((x) => x === 'auth_signin_start').length,
    '🔴 세션 중인데 어딘가에서 GIS 팝업이 열렸다 — 녹음 무결성 계약 위반').toBe(0);
  // 종전 경로로 수렴한다 — 재로그인 모달이 "다음 행동"을 맡는다(모달 클릭은 사용자 명시 의사).
  await expect(page.locator('[role="dialog"][aria-labelledby="login-required-title"]')).toBeVisible();
});


// ─── v0.51 r3 [F-13 / codex cx-H1] — 창이 죽었으면 동기화 클릭도 조용히 재연결하지 않는다 ──────
// 창 만료 강등은 설계상 `revoke`를 하지 않는다(계획서 §2-5). 그러면 **Google 쪽 grant는 살아
// 있으므로** 다음 동기화 클릭의 `prompt:''`가 조용히 토큰을 받아 오고, 콜백의 `upsertConnection`이
// **새 4주 창을 연다** → 「4주 미사용이면 풀린다」가 표시용으로 전락하고 창이 사실상 영구가 된다.
// 정책: 자동 갱신의 자격은 **살아 있는 창** 하나. 만료 후 재연결 경로는 모달 [로그인](명시 의사)뿐.
// 반증 축: `ensureAccessToken`의 `isConnectionAlive()` 게이트를 지우면 GIS가 호출돼 red.
for (const [name, connection] of [
  ['창 만료(29일 미사용)', { email: 'tester@example.com', connectedAt: Date.now() - 60 * 86_400_000, lastUsedAt: Date.now() - 29 * 86_400_000 }],
  ['명시적 해제(기록 없음)', null],
] as const) {
  test(`F-13: ${name} 상태에서 동기화 확정 — GIS 호출 0회 + 모달로 수렴`, async ({ page }) => {
    await installGisMock(page);
    await stubSheets(page);
    await seedNoToken(page, makeSession(), connection);
    await setSilentRefresh(page, true); // 갱신이 **되는** 국면이어야 「안 했다」가 의미를 갖는다

    // GIS 호출 계측 — mock의 requestAccessToken이 불렸는지 직접 센다.
    await page.evaluate(async () => {
      const { logger } = await import('/src/lib/logger.ts');
      logger.clear();
    });
    await openSyncAndConfirm(page);
    await page.waitForTimeout(600);

    const extras = await page.evaluate(async () => {
      const { logger } = await import('/src/lib/logger.ts');
      return logger.getAll().map((e) => e.extra).filter((x): x is string => typeof x === 'string');
    });
    expect(extras.filter((x) => x === 'auth_signin_start').length,
      '🔴 죽은 창이 동기화 클릭 한 번으로 되살아났다 — 4주 만료가 표시용으로 전락한다').toBe(0);
    expect(extras, '연결 게이트 계측이 없다').toContain('auth_ensure:skipped:no_connection');
    // 재연결 경로는 모달 [로그인]뿐이다(사용자 명시 의사).
    await expect(page.locator('[role="dialog"][aria-labelledby="login-required-title"]')).toBeVisible();
  });
}
