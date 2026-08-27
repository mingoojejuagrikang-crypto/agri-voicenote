/**
 * v0.51 [rauth P2] — **음성 세션 시작 버튼 안의 선제 갱신** 오라클.
 *
 * ## 왜 (계획서 §2-6 · 민구 확정 결정①: 포함)
 * 앱을 열고 동기화 없이 바로 세션을 시작하면 토큰이 없어 이상치 알람용 과거값 프리페치가
 * `past_index_skip:not_signed_in`으로 죽는다 — **알람이 전 세션 침묵**하는 실전 영향이다.
 * 세션 시작 탭은 확실한 제스처이고 3시간 현장 세션의 시작점이라, 여기서 한 번 갱신해 둔다.
 *
 * ## 🔴 이 스펙이 지키는 경계 — 「마이크 획득 **이전**」
 * GIS 팝업은 앱을 1~2초 백그라운드로 보낸다(rauth §2-6 실측: `lifecycle:vis_hidden` →
 * 1.5초 → `vis_visible`). 그 조건이 정확히 [CLIP-SILENT-1]·[CLIP-LOSS-1]이 나던 상태다.
 * 그래서 갱신은 **마이크를 잡기 전에** 끝나야 하고, **세션 중에는 절대 금지**다.
 * 여기서는 `requestAccessToken`과 `getUserMedia` 호출을 같은 배열에 순서대로 적어 그 경계를 잰다.
 *
 * 반증 축: 갱신을 `recorderRef.init()` **뒤로** 옮기면 순서 단언이 red. 갱신 실패에 세션 시작을
 * 막으면 두 번째 테스트가 red.
 *
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다(수동 기동 불필요, [ORCH-27])
 */
import { test, expect, type Page } from '@playwright/test';
import { BASE } from './baseUrl';
import { SETTINGS, MOCK_INIT_SCRIPT } from './fixtures/activeZones';

test.setTimeout(90_000);

const STORE_KEY = 'agri-voicenote-settings-v3';

/** `requestAccessToken`(=팝업)과 `getUserMedia`(=마이크 획득)를 **한 배열에 순서대로** 기록한다. */
async function installOrderProbe(page: Page) {
  await page.route('**://sheets.googleapis.com/**', (route) => route.fulfill({ json: { values: [] } }));
  await page.route('**://www.googleapis.com/**', (route) => route.fulfill({ json: { files: [] } }));
  await page.route('**://www.googleapis.com/oauth2/v3/userinfo', (route) =>
    route.fulfill({ json: { email: 'tester@example.com' } }));
  await page.addInitScript(() => {
    const order: string[] = [];
    // @ts-expect-error 테스트 전용 계측
    window.__order = order;
    // @ts-expect-error 테스트 전용 스위치
    window.__gisFail = false;
    // 픽스처(MOCK_INIT_SCRIPT)가 먼저 깐 getUserMedia를 **감싸기만** 한다 — 동작은 그대로.
    const md = navigator.mediaDevices as MediaDevices | undefined;
    if (md && typeof md.getUserMedia === 'function') {
      const orig = md.getUserMedia.bind(md);
      Object.defineProperty(md, 'getUserMedia', {
        value: (...args: unknown[]) => {
          order.push('gum');
          return (orig as (...a: unknown[]) => Promise<MediaStream>)(...args);
        },
        writable: true, configurable: true,
      });
    }
    // @ts-expect-error 테스트 전용 전역 mock
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            callback: (r: unknown) => void;
            error_callback?: (e: { type: string }) => void;
          }) => ({
            requestAccessToken: () => {
              order.push('signin');
              // @ts-expect-error 테스트 전용 스위치
              if (window.__gisFail) { config.error_callback?.({ type: 'popup_closed' }); return; }
              config.callback({
                access_token: 'p2-token', expires_in: 3600, scope: '', token_type: 'Bearer',
              });
            },
          }),
          revoke: (_t: string, cb?: () => void) => { cb?.(); },
        },
      },
    };
  });
}

/** 토큰 **없이**(만료 시뮬) 입력탭까지 부팅. 설정은 activeZones 픽스처(테이블 생성 완료 상태).
 *  `linked:false`면 **연결한 적 없는 사용자**를 재현한다(googleConnected:false + 연결 기록 없음) —
 *  v0.51 r1 [F-1] 가드의 대상. */
async function bootVoiceNoToken(page: Page, opts?: { linked?: boolean }) {
  // 🔴 순서가 중요하다 — 픽스처가 `getUserMedia`를 **덮어쓰므로** 프로브를 그 뒤에 깔아야
  //    감싸기가 살아남는다(반대로 깔면 계측이 조용히 사라져 'gum'이 0건이 된다).
  await page.addInitScript(MOCK_INIT_SCRIPT);
  await installOrderProbe(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ settings, key, linked, twoHoursAgo }) => {
    localStorage.clear();
    // gs10_google_token은 일부러 심지 않는다 — 「토큰 만료 상태로 세션을 시작한다」가 주제다.
    // linked: **연결된 사용자 + 토큰만 만료** = 살아 있는 4주 창을 명시적으로 심는다(2시간 전 사용).
    //   픽스처 version이 현재(13)라 마이그레이션 승계가 돌지 않으므로 여기서 직접 세운다.
    //   안 세우면 설정탭 마운트가 창 만료로 판정해 강등하고, F-1 가드가 갱신을 막아 P2 자체가 안 돈다.
    const payload = linked
      ? { ...settings, state: { ...settings.state, googleConnection: { email: 'tester@example.com', connectedAt: twoHoursAgo, lastUsedAt: twoHoursAgo } } }
      : { ...settings, state: { ...settings.state, googleConnected: false, userEmail: null, googleConnection: null } };
    localStorage.setItem(key, JSON.stringify(payload));
  }, { settings: SETTINGS, key: STORE_KEY, linked: opts?.linked !== false, twoHoursAgo: Date.now() - 2 * 60 * 60 * 1000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(200);
}

async function order(page: Page): Promise<string[]> {
  // @ts-expect-error 테스트 전용 계측
  return page.evaluate(() => (window.__order as string[]) ?? []);
}

async function startSession(page: Page) {
  const startBtn = page.locator('text=음성 입력 시작').first();
  await expect(startBtn).toBeVisible();
  await startBtn.click();
  await expect(page.locator('[data-testid="voice-active-state"]').first())
    .toBeVisible({ timeout: 10_000 });
}

test('P2: 만료 상태로 세션 시작 — 갱신이 마이크 획득보다 **먼저** 서고 세션은 정상 시작된다', async ({ page }) => {
  await bootVoiceNoToken(page);
  expect(await order(page), '세션 시작 전에 이미 마이크/팝업이 열렸다 — 픽스처 전제 붕괴').toEqual([]);

  await startSession(page);

  const seq = await order(page);
  expect(seq[0], '갱신이 안 일어났다 — 제스처 안 선제 갱신이 빠졌다').toBe('signin');
  expect(seq.indexOf('gum'), '마이크를 안 잡았다 — 이 오라클의 전제가 깨졌다').toBeGreaterThan(0);
  expect(seq.indexOf('signin'), '🔴 갱신이 마이크 획득 **뒤**로 갔다 — GIS 팝업이 세션 중 앱을 백그라운드로 보낸다')
    .toBeLessThan(seq.indexOf('gum'));

  // 갱신이 실제로 토큰을 남겼다(알람 프리페치가 살아나는 조건).
  const hasToken = await page.evaluate(() => !!localStorage.getItem('gs10_google_token'));
  expect(hasToken, '갱신은 했는데 토큰이 없다').toBe(true);

  // 🔴 세션 **중**에는 갱신이 없다 — rauth P2ⓔ의 "세션 진행 중 auth_signin_start 0건".
  const beforeSignins = seq.filter((x) => x === 'signin').length;
  await page.waitForTimeout(1500);
  const after = await order(page);
  expect(after.filter((x) => x === 'signin').length, '세션 중에 갱신이 또 돌았다').toBe(beforeSignins);
});

test('P2: 갱신이 실패해도 세션은 그대로 시작된다(알람만 늦은 토큰 복구에 맡긴다)', async ({ page }) => {
  await bootVoiceNoToken(page);
  await page.evaluate(() => {
    // @ts-expect-error 테스트 전용 스위치
    window.__gisFail = true;
  });

  await startSession(page); // 여기서 실패하면 red — 갱신 실패가 세션을 막았다는 뜻

  const seq = await order(page);
  expect(seq).toContain('signin');
  expect(seq).toContain('gum');
  const hasToken = await page.evaluate(() => !!localStorage.getItem('gs10_google_token'));
  expect(hasToken, '갱신은 실패했어야 한다 — 이 테스트의 전제').toBe(false);
});

test('P2: 유효 토큰이면 갱신을 아예 시도하지 않는다(공통 경로에 지연 0)', async ({ page }) => {
  await bootVoiceNoToken(page);
  await page.evaluate(() => {
    localStorage.setItem('gs10_google_token', JSON.stringify({
      access_token: 'still-valid', expires_at: Date.now() + 3600_000, email: 'tester@example.com',
    }));
  });

  await startSession(page);

  const seq = await order(page);
  expect(seq, '유효 토큰인데 팝업을 열었다 — 매 세션 시작이 1~2초 느려진다').not.toContain('signin');
  expect(seq).toContain('gum');

  // 🔴 v0.51 r1 [F-7 / 리뷰 L-1] — 계약의 **나머지 절반**: 유효 토큰이면 `null`을 돌려준다.
  //    이미 resolve된 Promise를 돌려줘도 위 단언들은 green인데, 그 차이가 정확히
  //    `getUserMedia`가 클릭의 **동기 구간**에 남느냐다(마이크로태스크 하나도 끼우면 안 된다,
  //    [IOS-5]). 모듈을 직접 불러 반환값 자체를 문다.
  const returned = await page.evaluate(async () => {
    // v0.51 r4 — 갱신 정책층은 `googleAuthRefresh`로 갈렸다(경계: 정책 / flight 기계).
    const refresh = await import('/src/lib/googleAuthRefresh.ts');
    return refresh.refreshBeforeSessionStart();
  });
  expect(returned, '🔴 유효 토큰인데 Promise를 돌려줬다 — 호출부가 await하게 되어 gUM이 제스처 밖으로 밀린다')
    .toBeNull();
});

// ─── v0.51 r1 [F-1 / 리뷰 H-1] — 연결한 적 없는 사용자에게는 갱신을 시도하지 않는다 ──────────
// 판정이 「토큰 유무」 하나였던 탓에, 명시적으로 연결을 해제한 사용자(§2-5 「최상위 의사」)와
// 한 번도 로그인한 적 없는 사용자(수동입력·폴백 알람만 쓰는 운용)에게도 세션 시작마다 팝업이
// 열렸다. 해제는 revoke를 거치므로 그 팝업은 무팝업이 아니라 **동의 화면**이고, 승인하면
// `upsertConnection`이 4주 창을 **되살린다**.
// 반증 축: `refreshBeforeSessionStart`의 연결 가드를 지우면 `signin`이 기록되어 red.
test('F-1: 미연결 사용자(googleConnected:false·기록 없음)는 세션 시작에서 GIS를 건드리지 않는다', async ({ page }) => {
  await bootVoiceNoToken(page, { linked: false });

  await startSession(page);

  const seq = await order(page);
  expect(seq, '연결한 적 없는 사용자에게 로그인 팝업이 열렸다').not.toContain('signin');
  expect(seq, '마이크는 정상적으로 잡아야 한다 — 세션 자체는 막지 않는다').toContain('gum');
  // 창이 되살아나지 않았다(§2-5 「명시적 해제 = 최상위 의사」).
  const conn = await page.evaluate((key) => {
    const raw = JSON.parse(localStorage.getItem(key) ?? 'null') as { state?: { googleConnection?: unknown } } | null;
    return raw?.state?.googleConnection ?? null;
  }, STORE_KEY);
  expect(conn, '미연결 사용자에게 4주 창이 생겼다').toBeNull();
});
