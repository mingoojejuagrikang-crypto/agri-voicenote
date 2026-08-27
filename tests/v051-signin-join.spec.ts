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

async function bootClean(page: Page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { localStorage.clear(); });
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
