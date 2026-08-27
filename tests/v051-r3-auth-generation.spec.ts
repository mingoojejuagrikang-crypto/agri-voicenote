/**
 * v0.51 r3 — **인증 세대·epoch·flight origin·기록 정규화** 오라클 (codex 적대적 리뷰 F-14·16·17·18).
 *
 * 이 스펙이 재는 것은 전부 **모듈 상태 기계**다: 콜백이 어느 세대·어느 로그아웃 경계에 속하는가,
 * 합류가 flight의 성격을 어떻게 바꾸는가, 손상된 연결 기록이 읽기 시점에 어떻게 정규화되는가.
 * UI를 거치지 않고 `import('/src/lib/…')`로 직접 부른다(v038-login-past-refresh 계보) — 그래야
 * 「지각 콜백이 **다른** flight를 settle한다」 같은 경합을 결정론적으로 만들 수 있다.
 *
 * 🔴 시계는 `page.clock`으로 가상화한다(실시간 대기 금지 — gates/15). 가상 시계 아래에서는
 *    `setTimeout`이 스스로 돌지 않으므로 evaluate 안에서 대기를 넣지 않는다.
 *
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다(수동 기동 불필요, [ORCH-27])
 */
import { test, expect, type Page } from '@playwright/test';
import { BASE } from './baseUrl';

test.setTimeout(60_000);

const STORE_KEY = 'agri-voicenote-settings-v3';
const HOUR = 60 * 60 * 1000;

/** GIS mock — **콜백을 자동으로 부르지 않고 보관**한다. 테스트가 원하는 시점에, 원하는
 *  클라이언트(세대)의 콜백을 골라 발화시킨다: `window.__fire(i, token)`.
 *  `navigator.userActivation`도 「제스처 안」으로 세운다(evaluate에는 실제 활성화가 없다). */
async function installManualGisMock(page: Page) {
  await page.route('**://www.googleapis.com/oauth2/v3/userinfo', (route) =>
    route.fulfill({ json: { email: 'gen@example.com' } }));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userActivation', {
      value: { isActive: true, hasBeenActive: true }, configurable: true,
    });
    const configs: Array<{ callback: (r: unknown) => void }> = [];
    const revoked: string[] = [];
    let issued = 0;
    // @ts-expect-error 테스트 전용 계측
    window.__issued = () => issued;
    // @ts-expect-error 테스트 전용 계측
    window.__revoked = () => revoked;
    // @ts-expect-error 테스트 전용 계측 — i번째로 만들어진 클라이언트의 콜백을 발화한다.
    window.__fire = (i: number, token: string) => configs[i]?.callback({
      access_token: token, expires_in: 3600, scope: '', token_type: 'Bearer',
    });
    // @ts-expect-error 테스트 전용 전역 mock
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: (config: { callback: (r: unknown) => void }) => {
            configs.push(config);
            return { requestAccessToken: () => { issued += 1; } }; // 콜백은 수동 발화
          },
          revoke: (t: string, cb?: () => void) => { revoked.push(t); cb?.(); },
        },
      },
    };
  });
}

/** 살아 있는 4주 창(+선택적 토큰)으로 부팅. [F-13] 게이트를 통과시키기 위한 최소 시딩이다. */
async function boot(page: Page, opts?: { tokenExpiresInMs?: number }) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ key, twoHoursAgo, tokenMs }) => {
    localStorage.clear();
    localStorage.setItem(key, JSON.stringify({
      state: {
        googleConnected: true,
        userEmail: 'gen@example.com',
        googleConnection: { email: 'gen@example.com', connectedAt: twoHoursAgo, lastUsedAt: twoHoursAgo },
      },
      version: 13,
    }));
    if (typeof tokenMs === 'number') {
      localStorage.setItem('gs10_google_token', JSON.stringify({
        access_token: 'seeded-token', expires_at: Date.now() + tokenMs, email: 'gen@example.com',
      }));
    }
  }, { key: STORE_KEY, twoHoursAgo: Date.now() - 2 * HOUR, tokenMs: opts?.tokenExpiresInMs });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(200);
}

async function extras(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const { logger } = await import('/src/lib/logger.ts');
    return logger.getAll().map((e) => e.extra).filter((x): x is string => typeof x === 'string');
  });
}

// ─── [F-14ⓑ] 버려진 flight의 지각 콜백이 **다른** flight를 settle하면 안 된다 ────────────────
// r1의 `abandonSilentFlight`가 「버려진 flight A → 새 flight B」를 정상 흐름으로 만들었다.
// 세대 태깅이 없으면 A의 지각 성공이 B의 pending을 **A의 토큰으로** resolve한다 — A와 B 사이에
// 사용자가 계정을 바꿔 로그인했다면 그대로 **계정 오귀속**이다.
// 🔑 저장·알림은 계속 돈다(v0.29.0 지각 재조정) — 끊는 것은 「남의 flight settle」뿐이다.
test('F-14ⓑ: 버려진 세대의 지각 콜백은 새 flight를 settle하지 않는다(저장·알림은 유지)', async ({ page }) => {
  await installManualGisMock(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.clock.install();
  await boot(page);

  const out = await page.evaluate(async () => {
    const auth = await import('/src/lib/googleAuth.ts');
    const w = window as unknown as { __ensure?: Promise<boolean>; __b?: Promise<{ token: string }> };
    w.__ensure = auth.ensureAccessToken();        // flight A (silent, 클라이언트 세대 0)
    // @ts-expect-error 테스트 전용 계측
    return (window.__issued as () => number)();
  });
  expect(out, 'flight A가 안 열렸다 — 전제 붕괴').toBe(1);

  await page.clock.runFor(13_000);                // 12초 상한 → abandon → resetTokenClient(세대↑)
  expect(await page.evaluate(() => (window as unknown as { __ensure: Promise<boolean> }).__ensure))
    .toBe(false);

  const after = await page.evaluate(async () => {
    const auth = await import('/src/lib/googleAuth.ts');
    const w = window as unknown as { __b?: Promise<{ token: string }> };
    w.__b = auth.signIn('user');                  // flight B (새 클라이언트 = 세대 1)
    // @ts-expect-error 테스트 전용 계측
    window.__fire(0, 'TOKEN_A');                  // 🔴 **버려진** A의 지각 성공
    // @ts-expect-error 테스트 전용 계측
    window.__fire(1, 'TOKEN_B');                  // 그 뒤 B가 정상 도착
    return (await w.__b!).token;
  });

  expect(after, '🔴 버려진 세대의 토큰이 새 flight를 settle했다 — 계정 오귀속 경로다').toBe('TOKEN_B');
  const log = await extras(page);
  expect(log.some((x) => x.startsWith('auth_token_settled:stale_generation')),
    '세대 불일치 계측이 없다 — 판정이 안 돌았다').toBe(true);
  // 🔑 v0.29.0 지각 재조정은 살아 있다: 버려진 세대여도 **토큰 자체는 저장**된다(느린 2FA 축).
  const stored = await page.evaluate(() => localStorage.getItem('gs10_google_token'));
  expect(stored, '지각 성공의 저장까지 막았다 — v0.29.0 계약이 깨진다').toContain('TOKEN_B');
});

// ─── [F-14ⓐ] 로그아웃 경계를 넘은 지각 성공은 연결을 부활시키지 않는다 ───────────────────────
// `signOut()` 도중 살아 있던 flight의 지각 콜백이 `storeToken`+`upsertConnection`을 돌리면
// **방금 끊은 연결이 되살아난다**. epoch는 세대와 **다른 축**이다 — 여기서는 저장 자체를 드랍한다.
test('F-14ⓐ: signOut 뒤 도착한 지각 성공은 토큰도 연결도 남기지 않는다', async ({ page }) => {
  await installManualGisMock(page);
  await boot(page, { tokenExpiresInMs: 3600_000 });

  const out = await page.evaluate(async () => {
    const auth = await import('/src/lib/googleAuth.ts');
    void auth.signIn('user').catch(() => undefined); // flight 진행 중
    await auth.signOut('manual');                    // 사용자가 「연결 해제」
    // @ts-expect-error 테스트 전용 계측 — 해제 뒤에 도착한 지각 성공
    window.__fire(0, 'TOKEN_AFTER_SIGNOUT');
    await new Promise((r) => setTimeout(r, 100));
    const { useSettingsStore } = await import('/src/stores/settingsStore.ts');
    return {
      token: localStorage.getItem('gs10_google_token'),
      connection: useSettingsStore.getState().googleConnection,
    };
  });

  expect(out.token, '🔴 로그아웃 뒤 지각 콜백이 토큰을 되살렸다').toBeNull();
  expect(out.connection, '🔴 로그아웃 뒤 지각 콜백이 4주 창을 되살렸다').toBeNull();
  expect((await extras(page)).some((x) => x.startsWith('auth_token_settled:stale_epoch'))).toBe(true);
});

// ─── [F-16] revoke 대상 조회는 5분 조기판정 마진을 쓰지 않는다 ────────────────────────────────
// `getStoredToken()`은 만료 5분 전부터 null이다. 그 술어로 revoke 대상을 찾으면 **아직 4분 남은
// 살아 있는 토큰**을 「없다」고 보고 revoke를 건너뛴다 — 「연결 해제」를 눌렀는데 Google 쪽 grant는
// 그대로 살아 있는 상태가 된다(이후 무팝업 갱신이 계속 성립한다).
test('F-16: 만료 4분 전 토큰으로 연결 해제해도 revoke가 호출된다', async ({ page }) => {
  await installManualGisMock(page);
  await boot(page, { tokenExpiresInMs: 4 * 60 * 1000 }); // 마진(5분) 안 = getStoredToken()은 null

  const revoked = await page.evaluate(async () => {
    const auth = await import('/src/lib/googleAuth.ts');
    // 전제 확인: 사용 관점에서는 이미 「없는 토큰」이다.
    const usable = auth.getAccessToken();
    await auth.signOut('manual');
    // @ts-expect-error 테스트 전용 계측
    return { usable, list: (window.__revoked as () => string[])() };
  });

  expect(revoked.usable, '전제 붕괴 — 마진 안이라 사용 불가여야 한다').toBeNull();
  expect(revoked.list, '🔴 살아 있는 grant를 두고 해제했다 — 해제가 반쪽이 된다')
    .toContain('seeded-token');
});

// ─── [F-17] 사람이 합류하면 그 flight는 12초에 잘리지 않는다 ─────────────────────────────────
// r1 [F-2]는 「선두가 silent인 flight는 12초에 통째로 정리」였다. 그 12초 안에 **사용자가** 로그인
// 버튼을 눌러 합류하면 그 사람의 2FA까지 12초에 잘린다(120초 계약의 대상인데도).
test('F-17: silent flight에 user가 합류하면 origin이 승격돼 12초 정리에서 제외된다', async ({ page }) => {
  await installManualGisMock(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.clock.install();
  await boot(page);

  await page.evaluate(async () => {
    const auth = await import('/src/lib/googleAuth.ts');
    const w = window as unknown as { __s?: Promise<boolean>; __u?: Promise<{ token: string }> };
    w.__s = auth.ensureAccessToken();   // silent 선두
    w.__u = auth.signIn('user');        // 사람이 합류 → 승격
  });

  await page.clock.runFor(13_000);

  const log = await extras(page);
  expect(log, '승격 계측이 없다').toContain('auth_signin_join:promoted_user');
  expect(log.some((x) => x.startsWith('auth_signin_timeout:silent')),
    '🔴 사람이 합류한 flight를 12초에 끊었다 — 2FA 중인 사용자를 잘라낸다').toBe(false);
  // silent 호출자는 **자기 promise만** 포기한다(r1 설계 그대로).
  expect(await page.evaluate(() => (window as unknown as { __s: Promise<boolean> }).__s)).toBe(false);
  // flight는 살아 있다 — 사람의 늦은 성공이 그대로 도착한다.
  const token = await page.evaluate(async () => {
    // @ts-expect-error 테스트 전용 계측
    window.__fire(0, 'TOKEN_HUMAN');
    return (await (window as unknown as { __u: Promise<{ token: string }> }).__u).token;
  });
  expect(token, '승격된 flight가 죽어 사람의 로그인이 사라졌다').toBe('TOKEN_HUMAN');
});

// ─── [F-18] 비정상 수치는 **읽기 시점**에 정규화된다(현행본 손상까지 덮는다) ────────────────
// `isConnectionRecord`는 「number인가」만 본다 → `MAX_VALUE`·먼 미래가 통과하고, 그러면 창이
// **영원히 만료되지 않는다.** 게다가 touch 스로틀(`now - lastUsedAt < 1시간`)이 음수로 항상 참이라
// 치유 기록조차 못 남긴다. 마이그레이션은 `version < 13`에서만 도니 **v13 현행본 손상은 무주공산**이다.
test('F-18: 먼 미래·비정상 타임스탬프는 읽기 시점에 클램프되고 touch가 저장본을 치유한다', async ({ page }) => {
  await installManualGisMock(page);
  await boot(page);

  const out = await page.evaluate(async () => {
    const { useSettingsStore } = await import('/src/stores/settingsStore.ts');
    const conn = await import('/src/lib/googleConnection.ts');
    const FUTURE = Date.now() + 400 * 24 * 60 * 60 * 1000; // 400일 뒤 = 영구 alive 유발
    useSettingsStore.getState().set({
      googleConnection: { email: 'gen@example.com', connectedAt: FUTURE, lastUsedAt: FUTURE },
    });
    const now = Date.now();
    const read = conn.getConnection(now);
    conn.touchConnection(now);                       // 스로틀을 무시하고 치유해야 한다
    const healed = useSettingsStore.getState().googleConnection!;
    // 완전 손상(safe integer 아님)은 「기록 없음」으로 읽힌다 — 만료 쪽이 안전한 기본값.
    useSettingsStore.getState().set({
      googleConnection: { email: 'x', connectedAt: Number.MAX_VALUE, lastUsedAt: Number.MAX_VALUE },
    });
    return {
      readLastUsed: read!.lastUsedAt, now,
      healedLastUsed: healed.lastUsedAt,
      orderOk: healed.connectedAt <= healed.lastUsedAt,
      broken: conn.getConnection(),
      brokenAlive: conn.isConnectionAlive(),
    };
  });

  expect(out.readLastUsed, '🔴 미래 타임스탬프가 그대로 읽혔다 — 창이 영원히 안 죽는다')
    .toBeLessThanOrEqual(out.now);
  expect(out.healedLastUsed, '🔴 저장본이 안 고쳐졌다 — 다음 부팅에도 같은 상태다')
    .toBeLessThanOrEqual(out.now + 1000);
  expect(out.orderOk, 'connectedAt <= lastUsedAt 불변식이 깨졌다').toBe(true);
  expect(out.broken, 'safe integer가 아닌 손상본이 기록으로 통과했다').toBeNull();
  expect(out.brokenAlive, '손상본이 「연결 살아 있음」으로 읽혔다').toBe(false);
});
