/**
 * v0.51 — **「계정 연결」 4주 슬라이딩 창**의 상태 기계 오라클 (계획서 §2-1·§2-2·§2-5).
 *
 * 민구 08-27: *"최초 로그인시 4주간 유지되고, 앱 사용시마다 4주씩 연장되는 형태"* + 증상
 * *"쓰다 보면 매시간쯤 풀림"*. 근인은 토큰 수명(~1시간, [AUTH-4])이 그대로 UX에 노출된 것 —
 * `useSettingsSheetConnection` 마운트 분기가 「토큰 없음 = 연결 풀림」으로 강등해왔다(v0.13.0 R1).
 *
 * ## 시간은 **모킹하지 않고 과거를 시딩한다**
 * `gates/15`의 「타이밍 가드」 — 실시간 대기 금지. 여기서는 `page.clock`도 필요 없다: 판정이
 * `lastUsedAt + 28일 > now`라는 **순수 시각 함수**라, 저장된 `lastUsedAt`을 과거로 심으면
 * "27일 뒤에 열었다"가 결정론적으로 재현된다. 클록 조작보다 재현 경로가 짧고 실기기 상황
 * (앱을 껐다가 며칠 뒤 연다)과도 더 닮았다.
 *
 * 🔴 페이로드 version은 **13**이다(현재 버전) — 12로 두면 마이그레이션 승계가 돌아
 * `lastUsedAt`을 `now`로 덮어써서 "과거를 심는다"는 이 스펙의 전제가 사라진다.
 *
 * 🔴 **게이트 green은 Google 쪽 동작의 증거가 아니다** — GIS를 스텁으로 재므로 여기서 검증되는
 * 것은 **앱의 상태 기계**뿐이다([TEAMOPS-3] 계열). "무팝업 갱신이 실제로 되는가"의 정본 검증은
 * 실기기 축이다(계획서 §3-5).
 *
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다(수동 기동 불필요, [ORCH-27])
 */
import { test, expect, type Page } from '@playwright/test';
import { BASE } from './baseUrl';

test.setTimeout(60_000);

const STORE_KEY = 'agri-voicenote-settings-v3';
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** GIS mock — **revoke 호출을 기록한다**. 창 만료가 `signOut()`을 경유하면 안 되기 때문이다
 *  (revoke하면 grant가 죽어 이후 무팝업 갱신까지 전부 동의 화면으로 되돌아간다 — 계획서 §2-5). */
async function installGisSpy(page: Page) {
  await page.route('**://www.googleapis.com/oauth2/v3/userinfo', (route) =>
    route.fulfill({ json: { email: 'tester@example.com' } }));
  await page.addInitScript(() => {
    const calls: string[] = [];
    // @ts-expect-error 테스트 전용 계측
    window.__gisCalls = calls;
    // @ts-expect-error 테스트 전용 전역 mock
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: (config: { callback: (r: unknown) => void }) => ({
            requestAccessToken: () => {
              calls.push('requestAccessToken');
              config.callback({
                access_token: 'fresh-token', expires_in: 3600, scope: '', token_type: 'Bearer',
              });
            },
          }),
          revoke: (_t: string, cb?: () => void) => { calls.push('revoke'); cb?.(); },
        },
      },
    };
  });
}

/** 토큰 **없이**(만료 시뮬) + 지정한 연결 기록으로 부팅. persist version은 현재(13). */
async function bootWithConnection(page: Page, lastUsedAgoMs: number | null) {
  const now = Date.now();
  const state: Record<string, unknown> = {
    googleConnected: true,
    userEmail: 'tester@example.com',
    googleConnection: lastUsedAgoMs === null ? null : {
      email: 'tester@example.com',
      connectedAt: now - lastUsedAgoMs,
      lastUsedAt: now - lastUsedAgoMs,
    },
    sheet: null, sheetUrl: '', sheetTab: '', availableSheets: [], savedSheets: [],
    manualMode: false, columns: [], tableGenerated: false, totalRows: 50,
    ttsRate: 1.05, recognitionTolerance: 0.6, chipSweepSeconds: 0,
    sessionLabelColId: null, sessionAutoLabel: null, preferredVoiceName: '', roundDateColId: null,
  };
  await page.addInitScript(
    ({ key, payload }) => {
      // 토큰 키는 **일부러 심지 않는다** — 「창은 살아 있는데 토큰만 만료」가 이 스펙의 주제다.
      localStorage.setItem(key, JSON.stringify(payload));
    },
    { key: STORE_KEY, payload: { state, version: 13 } },
  );
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
}

async function readAuthLog(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const { logger } = await import('/src/lib/logger.ts');
    return logger
      .getAll()
      .map((e) => e.extra)
      .filter((x): x is string => typeof x === 'string' && (x.startsWith('auth_') || x.startsWith('auth_signout')));
  });
}

async function readConnection(page: Page) {
  return page.evaluate((key) => {
    const raw = JSON.parse(localStorage.getItem(key) ?? 'null') as
      | { state?: { googleConnected?: boolean; googleConnection?: { lastUsedAt: number } | null } }
      | null;
    return {
      googleConnected: raw?.state?.googleConnected ?? null,
      lastUsedAt: raw?.state?.googleConnection?.lastUsedAt ?? null,
    };
  }, STORE_KEY);
}

async function gisCalls(page: Page): Promise<string[]> {
  // @ts-expect-error 테스트 전용 계측
  return page.evaluate(() => (window.__gisCalls as string[]) ?? []);
}

// ─── ① 창 안에서 토큰이 만료되면 — **강등하지 않는다** ────────────────────────────────
test('① 창 내 토큰 만료 — 연결됨을 유지하고 auth_token_expired_kept를 남긴다(강등 없음)', async ({ page }) => {
  await installGisSpy(page);
  await bootWithConnection(page, 2 * HOUR); // 2시간 전 사용 = 토큰은 죽었고 창은 살아 있다

  const log = await readAuthLog(page);
  expect(log, 'kept 계측이 없다 — 유지 경로를 안 탔다').toContain('auth_token_expired_kept');
  // 🔴 강등 반증: 종전 코드라면 여기서 auth_signout:token_expired가 나고 googleConnected가 false가 된다.
  expect(log.some((x) => x.startsWith('auth_signout'))).toBe(false);

  const conn = await readConnection(page);
  expect(conn.googleConnected, '창이 살아 있는데 강등됐다 — 매시간 풀림 회귀').toBe(true);

  // 화면도 같은 판정이어야 한다(설정탭 Google 버튼).
  await expect(page.locator('button:has-text("tester@example.com")')).toBeVisible();
});

// ─── ② 창이 만료되면 — 강등하되 **revoke는 부르지 않는다** ─────────────────────────────
test('② 창 만료(28일+1h) — 강등 + connection_expired · revoke 미호출', async ({ page }) => {
  await installGisSpy(page);
  await bootWithConnection(page, 28 * DAY + HOUR);

  const log = await readAuthLog(page);
  expect(log).toContain('auth_signout:connection_expired');
  expect(log, '창이 만료됐는데 유지 경로를 탔다').not.toContain('auth_token_expired_kept');

  const conn = await readConnection(page);
  expect(conn.googleConnected).toBe(false);
  expect(conn.lastUsedAt, '만료된 연결 기록이 남아 있다').toBeNull();

  // 🔴 계획서 §2-5 — 창 만료는 **로컬 정리만** 한다. revoke하면 grant가 죽어 이후 무팝업 갱신까지
  //    전부 동의 화면으로 되돌아간다. signOut()을 경유하면 안 되는 이유가 이것이다.
  expect(await gisCalls(page), '창 만료가 revoke를 불렀다 — grant가 죽는다').not.toContain('revoke');

  await expect(page.locator('button:has-text("Google 로그인")')).toBeVisible();
});

// ─── ③ 슬라이딩 — 27일차 사용은 연장, 29일차는 만료(check-then-touch 경계) ──────────────
test('③-a 27일차 사용 — lastUsedAt이 now로 밀려 창이 +28일 재연장된다', async ({ page }) => {
  await installGisSpy(page);
  const before = Date.now();
  await bootWithConnection(page, 27 * DAY);

  const log = await readAuthLog(page);
  expect(log.some((x) => x.startsWith('auth_connection_touch')), 'touch가 안 돌았다 — 연장 없음').toBe(true);
  expect(log).toContain('auth_token_expired_kept');

  const conn = await readConnection(page);
  expect(conn.googleConnected).toBe(true);
  expect(conn.lastUsedAt!, 'lastUsedAt이 안 밀렸다 — 4주가 재연장되지 않는다').toBeGreaterThanOrEqual(before);
});

test('③-b 29일차에 열면 만료다 — touch가 판정을 앞질러 창을 되살리지 않는다', async ({ page }) => {
  await installGisSpy(page);
  await bootWithConnection(page, 29 * DAY);

  const log = await readAuthLog(page);
  // 🔴 check-then-touch의 핵심 단언: 부팅 touch(App.tsx)는 **죽은 창을 되살리길 거부**한다.
  //    touch가 먼저 lastUsedAt을 now로 밀면 기록이 있는 한 창이 영원히 안 죽어 4주 의도와 모순된다.
  expect(log.some((x) => x.startsWith('auth_connection_touch')), 'touch가 죽은 창을 되살렸다').toBe(false);
  expect(log).toContain('auth_signout:connection_expired');

  const conn = await readConnection(page);
  expect(conn.googleConnected).toBe(false);
  expect(await gisCalls(page)).not.toContain('revoke');
});

// ─── 경계 대칭 — 연결 기록 자체가 없으면 종전대로 강등한다 ────────────────────────────
test('연결 기록 없음(googleConnection:null) — 창이 없으므로 강등한다', async ({ page }) => {
  await installGisSpy(page);
  await bootWithConnection(page, null);

  const log = await readAuthLog(page);
  // v0.51 r1 [F-8] — 「4주 미사용으로 닫혔다」와 「창을 가진 적이 없다」는 원인이 다르다.
  // SOP-003 판독에서 갈리도록 서픽스를 분리했다(②의 진짜 만료는 서픽스 없음).
  expect(log).toContain('auth_signout:connection_expired:no_record');
  expect(log, '기록 부재가 진짜 만료와 같은 문자열로 뭉쳤다')
    .not.toContain('auth_signout:connection_expired');
  const conn = await readConnection(page);
  expect(conn.googleConnected).toBe(false);
});
