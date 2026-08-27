/**
 * v0.51 [AUTH-SF-1] — `signIn()` single-flight를 **「합류」**로 (rauth P1ⓓ③의 선결 수리).
 *
 * ## 왜 이 오라클이 있나
 * 종전 `signIn()`은 `if (pending) reject('이미 로그인 진행 중입니다.')`였다. 호출 지점이 설정탭
 * 로그인 버튼 하나뿐일 땐 무해했다. 그런데 로그인 4주 슬라이딩(v0.51)이 **제스처 안 선제 갱신**을
 * 두 곳 더 만든다 — 동기화 확정 클릭(P1)과 음성 세션 시작(P2). 두 갱신이 겹치면 **뒤엣것이
 * 조용히 실패**하고, 그 호출부는 "갱신 실패"로 수렴해 재로그인 배너를 띄운다. 앞엣것은 그 사이
 * 정상적으로 성공하는데도. rauth가 이걸 P1/P2의 **선결 조건**으로 지목했다.
 *
 * ## 무엇을 고정하나
 *  ① 동시 2호출이 **둘 다 resolve**하고 **같은 토큰**을 받는다(수정 전 red: 두 번째가 reject).
 *  ② `auth_signin_start`는 **1건**뿐이다 — SOP-003 파서 계약(시작 1건 : settle 1건이 대응해야
 *     `auth_token_settled:ms` 분포가 유효하다). 합류는 신규 `auth_signin_join`으로 분리 계측.
 *  ③ GIS `requestAccessToken`도 **1회** — 팝업이 두 번 열리지 않는다.
 *  ④ 실패도 합류자가 **같은 사유**로 함께 받는다(성공만이 아니라 결과 전체가 공유된다).
 *
 * 모듈 직접 호출(`import('/src/lib/googleAuth.ts')`)로 동시성을 결정론적으로 만든다 — UI에서는
 * 로그인 버튼이 `disabled={loading!==null}`이라 두 번째 제스처를 재현할 수 없다. 같은 URL이므로
 * Vite 모듈 그래프상 **앱이 쓰는 것과 동일 인스턴스**다(tests/v038-login-past-refresh.spec.ts와 같은 수법).
 *
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다(수동 기동 불필요, [ORCH-27])
 */
import { test, expect, type Page } from '@playwright/test';
import { BASE } from './baseUrl';

test.setTimeout(30_000);

/** 콜백이 **비동기로** 도착하는 GIS mock. 동기 콜백이면 첫 signIn()이 `requestAccessToken` 안에서
 *  이미 settle돼 `pending`이 비므로 합류 자체가 성립하지 않는다 — 겹침을 만들려면 지연이 필요하다. */
async function installAsyncGisMock(page: Page, delayMs: number, opts?: { fail?: boolean }) {
  await page.route('**://www.googleapis.com/oauth2/v3/userinfo', (route) =>
    route.fulfill({ json: { email: 'joiner@example.com' } }));
  await page.addInitScript(
    ({ delay, fail }) => {
      let issued = 0;
      // @ts-expect-error 테스트 전용 전역 mock
      window.google = {
        accounts: {
          oauth2: {
            initTokenClient: (config: {
              callback: (r: unknown) => void;
              error_callback?: (e: { type: string }) => void;
            }) => ({
              requestAccessToken: () => {
                issued += 1;
                const n = issued;
                setTimeout(() => {
                  if (fail) config.error_callback?.({ type: 'popup_closed' });
                  else
                    config.callback({
                      access_token: `join-token-${n}`, expires_in: 3600, scope: '', token_type: 'Bearer',
                    });
                }, delay);
              },
            }),
            revoke: (_t: string, cb?: () => void) => { cb?.(); },
          },
        },
      };
      // @ts-expect-error 테스트 전용 계측
      window.__gisIssuedCount = () => issued;
    },
    { delay: delayMs, fail: !!opts?.fail },
  );
}

/** 콜백이 **영원히 도착하지 않는** GIS mock — A7이 타임아웃을 만든 그 조건(standalone 콜백 wedge).
 *  `navigator.userActivation`도 「제스처 안」으로 세운다: `page.evaluate`에는 실제 사용자 활성화가
 *  없어 `ensureAccessToken`의 제스처 가드가 먼저 걸려버리기 때문이다(클릭 대신 쓰는 최소 스텁). */
async function installWedgedGisMock(page: Page) {
  await page.route('**://www.googleapis.com/oauth2/v3/userinfo', (route) =>
    route.fulfill({ json: { email: 'joiner@example.com' } }));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userActivation', {
      value: { isActive: true, hasBeenActive: true }, configurable: true,
    });
    let issued = 0;
    // @ts-expect-error 테스트 전용 전역 mock
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: () => ({ requestAccessToken: () => { issued += 1; /* 콜백 영구 미발화 */ } }),
          revoke: (_t: string, cb?: () => void) => { cb?.(); },
        },
      },
    };
    // @ts-expect-error 테스트 전용 계측
    window.__gisIssuedCount = () => issued;
  });
}

/** 두 signIn()을 **같은 태스크에서** 시작해 겹침을 보장하고, 결과와 인증 계측을 함께 걷어온다. */
async function raceTwoSignIns(page: Page) {
  return page.evaluate(async () => {
    const auth = await import('/src/lib/googleAuth.ts');
    const { logger } = await import('/src/lib/logger.ts');
    logger.clear();
    const p1 = auth.signIn();
    const p2 = auth.signIn();
    const settled = await Promise.allSettled([p1, p2]);
    const extras = logger
      .getAll()
      .map((e) => e.extra)
      .filter((x): x is string => typeof x === 'string' && x.startsWith('auth_signin'));
    return {
      statuses: settled.map((s) => s.status),
      results: settled.map((s) =>
        s.status === 'fulfilled' ? s.value.token : String((s.reason as Error)?.message ?? s.reason),
      ),
      starts: extras.filter((x) => x === 'auth_signin_start').length,
      joins: extras.filter((x) => x === 'auth_signin_join').length,
      // @ts-expect-error 테스트 전용 계측
      requests: (window.__gisIssuedCount as () => number)(),
    };
  });
}

async function bootClean(page: Page, opts?: { linked?: boolean }) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ linked, twoHoursAgo }) => {
    localStorage.clear();
    // v0.51 r3 [F-13] — `ensureAccessToken`의 자동 갱신은 **살아 있는 4주 창**을 요구한다.
    // 그 게이트를 재는 스펙이 아니라면(F-2 flight 정리 축) 창을 심어 둬야 경로에 도달한다.
    if (linked) {
      localStorage.setItem('agri-voicenote-settings-v3', JSON.stringify({
        state: {
          googleConnected: true,
          userEmail: 'joiner@example.com',
          googleConnection: { email: 'joiner@example.com', connectedAt: twoHoursAgo, lastUsedAt: twoHoursAgo },
        },
        version: 13,
      }));
    }
  }, { linked: !!opts?.linked, twoHoursAgo: Date.now() - 2 * 60 * 60 * 1000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(200);
}

test('동시 signIn() 2회 — 같은 promise에 합류해 둘 다 같은 토큰으로 resolve', async ({ page }) => {
  await installAsyncGisMock(page, 300);
  await bootClean(page);

  const out = await raceTwoSignIns(page);

  // ① 수정 전이라면 두 번째가 '이미 로그인 진행 중입니다.'로 reject된다(red).
  expect(out.statuses).toEqual(['fulfilled', 'fulfilled']);
  expect(out.results[0]).toBe(out.results[1]);
  expect(out.results[0]).toBe('join-token-1');
  // ② 시작 계측은 선두 1건 + 합류 1건.
  expect(out.starts).toBe(1);
  expect(out.joins).toBe(1);
  // ③ 팝업(=requestAccessToken)은 한 번만 열린다.
  expect(out.requests).toBe(1);
});

test('동시 signIn() 2회 — 실패도 합류자가 같은 사유로 함께 받는다', async ({ page }) => {
  await installAsyncGisMock(page, 300, { fail: true });
  await bootClean(page);

  const out = await raceTwoSignIns(page);

  expect(out.statuses).toEqual(['rejected', 'rejected']);
  expect(out.results[0]).toBe(out.results[1]);
  expect(out.results[0]).toContain('로그인 창이 닫혔습니다');
  expect(out.starts).toBe(1);
  expect(out.joins).toBe(1);
  expect(out.requests).toBe(1);
});

// ─── v0.51 r1 [F-2 / 리뷰 H-2] — silent 상한은 flight까지 함께 포기한다 ────────────────────
// 종전에는 12초 상한이 **바깥 promise만** 끊고 `pending`을 살려뒀다. 합류(위 오라클)와 곱해지면
// 12~120초 사이의 108초 동안 **모든 로그인 시도가 팝업 없이 죽은 flight에 붙는다** — 재로그인
// 모달의 [로그인] 클릭이 조용히 삼켜지고 모달이 열린 채 고착된다. 종전 실패(`이미 로그인 진행
// 중입니다.` 즉시 reject)보다 **후퇴**였다(조용·무기한 vs 즉시·가시적).
// 반증 축: `abandonSilentFlight()` 호출을 지우면 두 번째 `requestAccessToken`이 안 나 red.
test('F-2: silent 12초 상한 뒤 사람의 재클릭은 **새 flight로 팝업을 다시 연다**', async ({ page }) => {
  await installWedgedGisMock(page); // 콜백이 영원히 안 오는 GIS(A7이 타임아웃을 만든 그 조건)
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.clock.install();
  await bootClean(page, { linked: true }); // [F-13] 게이트가 아니라 flight 정리를 재는 스펙이다

  // ① silent 갱신 시작(제스처 스텁 — 실제 클릭 대신 userActivation을 참으로 세운 상태).
  // ⚠️ 가상 시계 아래에서는 `setTimeout`이 스스로 돌지 않는다 — 대기를 넣지 않는다.
  //    `signIn()`은 warmup된 클라이언트에서 `requestAccessToken`을 **동기로** 부르므로 즉시 센다.
  const started = await page.evaluate(async () => {
    const auth = await import('/src/lib/googleAuth.ts');
    (window as unknown as { __ensure?: Promise<boolean> }).__ensure = auth.ensureAccessToken();
    // @ts-expect-error 테스트 전용 계측
    return (window.__gisIssuedCount as () => number)();
  });
  expect(started, 'silent 갱신이 팝업을 열지 않았다 — 전제 붕괴').toBe(1);

  // ② 12초 경과 — 상한이 발화한다.
  await page.clock.runFor(13_000);
  const ensured = await page.evaluate(
    () => (window as unknown as { __ensure: Promise<boolean> }).__ensure);
  expect(ensured, '상한이 안 걸렸다').toBe(false);

  // ③ 사람이 재로그인 모달에서 [로그인]을 누른 것과 같은 호출.
  const after = await page.evaluate(async () => {
    const auth = await import('/src/lib/googleAuth.ts');
    const { logger } = await import('/src/lib/logger.ts');
    const joinsBefore = logger.getAll().filter((e) => e.extra === 'auth_signin_join').length;
    void auth.signIn().catch(() => undefined);
    return {
      // @ts-expect-error 테스트 전용 계측
      requests: (window.__gisIssuedCount as () => number)(),
      joins: logger.getAll().filter((e) => e.extra === 'auth_signin_join').length - joinsBefore,
    };
  });
  expect(after.requests, '🔴 죽은 flight에 합류해 팝업이 안 열렸다 — 사용자의 복구 클릭이 삼켜진다').toBe(2);
  expect(after.joins, '새 flight여야 하는데 합류로 처리됐다').toBe(0);
});

// ─── v0.51 r1 [F-4 / 리뷰 M-1] — 제스처 밖 `force`는 갱신을 **시도한다** ────────────────────
// `withAuthRetry`는 업로드 왕복 **뒤에** `ensureAuth({force:true})`를 부르므로 activation이 늘
// 소진돼 있다. 가드를 걸어두면 v0.50 [UPLOAD-AUTH-1]의 「인증 실패 1회 자동 재시도」가 실기기에서
// **상시 no-op**이 된다. 상한(12초)이 [UA-1]의 「zip마다 120초」를 대신 막는다.
// 반증 축: `force` 면제를 지우면 `requestAccessToken`이 0회가 되어 red.
test('F-4: 제스처 밖이어도 force 갱신은 시도된다(가드 면제) · 일반 갱신은 여전히 차단된다', async ({ page }) => {
  await installAsyncGisMock(page, 50);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userActivation', {
      value: { isActive: false, hasBeenActive: true }, configurable: true,
    });
  });
  await bootClean(page);

  const out = await page.evaluate(async () => {
    const auth = await import('/src/lib/googleAuth.ts');
    const { logger } = await import('/src/lib/logger.ts');
    logger.clear();
    const plain = await auth.ensureAccessToken();
    // @ts-expect-error 테스트 전용 계측
    const afterPlain = (window.__gisIssuedCount as () => number)();
    const forced = await auth.ensureAccessToken({ force: true });
    // @ts-expect-error 테스트 전용 계측
    const afterForced = (window.__gisIssuedCount as () => number)();
    return {
      plain, forced, afterPlain, afterForced,
      extras: logger.getAll().map((e) => e.extra).filter((x): x is string => typeof x === 'string'),
    };
  });

  // 일반 갱신: 제스처 밖이라 시도조차 하지 않는다(P1ⓑ 계약 유지).
  expect(out.plain).toBe(false);
  expect(out.afterPlain, '제스처 밖 일반 갱신이 팝업을 열었다').toBe(0);
  expect(out.extras).toContain('auth_ensure:skipped:no_gesture');
  // force: 가드를 면제받아 실제로 갱신한다([UPLOAD-AUTH-1] 자동 재시도 복원).
  expect(out.forced, '제스처 밖 force가 갱신을 포기했다 — v0.50 자동 재시도가 상시 no-op이 된다').toBe(true);
  expect(out.afterForced, 'force가 팝업(=requestAccessToken)을 시도하지 않았다').toBe(1);
  expect(out.extras).toContain('auth_ensure:refreshed:forced');
});
