/**
 * v0.50 (2026-08-19) 오라클 — **프리뷰 갱신 경로 복구**.
 *
 * ## 무엇이 있었나 (민구 제보)
 * > *"지금 프리뷰앱은 설치형이야. 그래서 새로 고침을 할 수가 없어… 지금 보니 08-14에 만든 버전이야."*
 *
 * 프리뷰 빌드는 SW가 꺼져 있었고(`vite.config.ts` `disable: IS_PREVIEW_BUILD`), `pwaUpdate`가
 * `registerSW`에 전적으로 걸려 있어 **`UpdateBanner`도 `UpdateControl`도 영원히 침묵**했다.
 * standalone에는 새로고침 UI가 없다 → **갱신 경로 0개.**
 *
 * ## 이 스펙이 잠그는 네 축(브리핑 §6)
 *  ① 프로브가 **해시 불일치를 실제로 감지**한다
 *  ② **fetch 실패를 「최신」으로 뭉개지 않는다** (종전 `checkedNoUpdate` 함정)
 *  ③ SW scope 비침범 — `/survey-011-preview/`는 `/survey-011/`로 **시작하지 않는다**(문자열 접두)
 *  ④ 업데이트 UI가 **렌더된다**(프리뷰 여부와 무관)
 *
 * ## 반증 축
 *  · 상태를 셋(latest/outdated/error)으로 합치면 → ⓑ·ⓒ red(모르는 것이 「최신」이 된다)
 *  · `isComparableBundleId` 게이트를 빼면 → ⓓ red(dev에서 상시 「구버전」 = 배너 상시 노출)
 *  · `extractBundleId`가 실패를 `null`로 안 돌려주면 → ⓒ red
 *  · 폴백에서 IndexedDB를 건드리면 → ⓕ red 🔴 **세션·클립이 거기 있다**
 */
import { test, expect, type Page } from '@playwright/test';
import { BASE } from './baseUrl';
import { installVoiceMocks } from './fixtures/stt';
import { extractBundleId, isComparableBundleId } from '../src/lib/bundleId';
import { probeLiveVersion } from '../src/lib/liveVersionProbe';
import { forceUpdateReload } from '../src/lib/forceUpdateReload';

const LIVE_HTML = (hash: string) => `<!doctype html><html><head>
  <script type="module" crossorigin src="./assets/${hash}"></script>
  <link rel="stylesheet" href="./assets/index-D0YHH.css">
</head><body><div id="root"></div></body></html>`;

function probeDeps(over: Partial<Parameters<typeof probeLiveVersion>[0]> = {}) {
  const logs: string[] = [];
  return {
    logs,
    deps: {
      readLocal: () => 'index-AAAA1111.js',
      fetchLiveHtml: async () => LIVE_HTML('index-AAAA1111.js'),
      log: (e: string) => logs.push(e),
      ...over,
    },
  };
}

test('[node] ⓐ 해시가 같으면 — 비로소 「최신」이다', async () => {
  const { deps, logs } = probeDeps();
  const r = await probeLiveVersion(deps);
  expect(r.status).toBe('latest');
  expect(r.live).toBe('index-AAAA1111.js');
  expect(logs).toEqual(['pwa_version_probe:latest']);
});

test('[node] ⓑ 🔴 해시가 다르면 구버전이다 — 이게 이 회차의 존재 이유다', async () => {
  const { deps, logs } = probeDeps({ fetchLiveHtml: async () => LIVE_HTML('index-BBBB2222.js') });
  const r = await probeLiveVersion(deps);
  expect(r.status, '배포본이 바뀌었는데 감지하지 못했다 — 민구가 08-14 빌드를 5일 쓴 그 상태다')
    .toBe('outdated');
  expect(r.local).toBe('index-AAAA1111.js');
  expect(r.live).toBe('index-BBBB2222.js');
  expect(logs).toEqual(['pwa_version_probe:outdated']);
});

test('[node] ⓒ 🔴 「모르는 것」을 「최신」으로 뭉개지 않는다 — 세 가지를 갈라 답한다', async () => {
  // 오프라인·타임아웃 — fetch 자체가 실패.
  const offline = probeDeps({ fetchLiveHtml: async () => { throw new TypeError('Failed to fetch'); } });
  const a = await probeLiveVersion(offline.deps);
  expect(a.status, '오프라인을 「최신」으로 답하면 종전 checkedNoUpdate 함정의 재판이다')
    .toBe('unreachable');
  expect(offline.logs[0]).toBe('pwa_version_probe:unreachable:TypeError');

  // 🔑 fetch는 **성공**했는데 해시를 못 뽑는 경우 — 200으로 온 404/에러 페이지.
  //    「네트워크 실패」와 다르므로 상태도 로그도 갈라야 다음 조사가 CDN/코드를 즉시 가른다.
  const junk = probeDeps({ fetchLiveHtml: async () => '<!doctype html><h1>404 Not Found</h1>' });
  const b = await probeLiveVersion(junk.deps);
  expect(b.status).toBe('unparseable');
  expect(junk.logs[0]).toBe('pwa_version_probe:unparseable');
});

test('[node] ⓓ 로컬 번들을 식별 못 하면 **판정하지 않는다**(dev 서버)', async () => {
  const dev = probeDeps({ readLocal: () => 'dev' });
  const r = await probeLiveVersion(dev.deps);
  expect(r.status, 'dev를 구버전으로 답하면 개발·e2e에서 배너가 상시 뜬다').toBe('indeterminate');
  expect(r.live, '비교를 시작조차 하지 않는다 — 네트워크도 안 친다').toBeUndefined();
  expect(dev.logs[0]).toBe('pwa_version_probe:indeterminate:local=dev');

  expect(isComparableBundleId('dev')).toBe(false);
  expect(isComparableBundleId('unknown')).toBe(false);
  expect(isComparableBundleId('')).toBe(false);
  expect(isComparableBundleId('index-AAAA1111.js')).toBe(true);
});

test('[node] ⓔ 해시 추출은 순수 함수다 — 못 뽑으면 null', () => {
  expect(extractBundleId(LIVE_HTML('index-ZZZ9.js'))).toBe('index-ZZZ9.js');
  // 상대/절대 경로 모두에서 뽑힌다(배포는 `base: './'`이지만 프록시가 절대화할 수 있다).
  expect(extractBundleId('<script src="/survey-011-preview/assets/index-Q1.js"></script>'))
    .toBe('index-Q1.js');
  expect(extractBundleId('<h1>404</h1>'), '못 뽑으면 null이어야 호출자가 「최신」으로 접지 않는다')
    .toBeNull();
});

test('[node] ⓕ 🔴 폴백 리로드는 캐시만 지운다 — **IndexedDB는 건드리지 않는다**', async () => {
  const deleted: string[] = [];
  let unregistered = 0;
  let reloaded = 0;
  const fakeCaches = {
    keys: async () => ['workbox-precache-v2', 'runtime'],
    delete: async (k: string) => { deleted.push(k); return true; },
  } as unknown as CacheStorage;

  const out = await forceUpdateReload({
    caches: fakeCaches,
    getRegistrations: async () => [
      { unregister: async () => { unregistered += 1; return true; } } as ServiceWorkerRegistration,
    ],
    reload: () => { reloaded += 1; },
  });

  expect(deleted, '캐시를 지우지 않으면 리로드가 다시 옛 번들을 받는다')
    .toEqual(['workbox-precache-v2', 'runtime']);
  expect(unregistered, 'SW를 해제하지 않으면 precache가 계속 가로챈다').toBe(1);
  expect(reloaded, '리로드하지 않으면 아무 일도 안 일어난다').toBe(1);
  expect(out).toEqual({ cachesDeleted: 2, unregistered: 1 });

  // 🔴 **세션·음성 클립이 IndexedDB에 있다.** 「업데이트 버튼이 클립을 지웠다」는 최악의 사고다
  //    (PRINCIPLES §1). 소스에 `indexedDB` 참조가 **없다**는 것을 계약으로 잠근다.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/lib/forceUpdateReload.ts', import.meta.url), 'utf-8');
  // 🔑 **주석은 빼고 코드만** 본다 — 그 파일의 주석은 「IndexedDB를 건드리지 않는다」고 적고 있어서
  //    통째로 검사하면 그 문장 자체에 걸린다(첫 실행에서 실제로 걸렸다).
  const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  // 🔑 **IDB로 가는 모든 문**을 막는다 — 이 앱은 `idb`(openDB) 래퍼를 쓰므로 `indexedDB` 문자열만
  //    보면 구멍이 남는다(첫 버전이 그랬다). 직접 API·래퍼·우리 db 모듈 셋 다 본다.
  const IDB_ANY = /indexedDB|deleteDatabase|openDB|from '\.\/db'|from 'idb'/i;
  expect(stripComments(src), '폴백이 IndexedDB로 가는 경로를 갖는다 — 데이터 무결성 위반')
    .not.toMatch(IDB_ANY);
  // 검사기가 공허하지 않다는 증명: 같은 규칙을 **실제로 IDB를 쓰는 모듈**에 대면 걸린다.
  const dbSrc = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf-8');
  expect(stripComments(dbSrc), '이 검사기는 IDB 참조를 실제로 잡아낼 수 있어야 한다').toMatch(IDB_ANY);
});

test('[node] ⓖ SW scope 비침범 — 문자열 접두 규칙이 근거다', () => {
  // Service Worker scope 매칭은 **문자열 접두**다(URL 경로 세그먼트가 아니다).
  // v0.50 개명 — 계약 쌍을 새 배포 경로로 갱신. 전환기엔 구 정식(`/survey-011/`)도 살아
  // 있으므로 **세 경로 전부** 서로 비침범이어야 한다.
  const prodScope = '/agri-voicenote/';
  const previewScope = '/agri-voicenote-preview/';
  const legacyProdScope = '/survey-011/';
  expect(previewScope.startsWith(prodScope),
    '프리뷰가 프로덕션 SW의 scope 안에 들어가면 캐시가 서로를 가로챈다').toBe(false);
  expect(prodScope.startsWith(previewScope), '반대 방향도 안전해야 한다').toBe(false);
  expect(prodScope.startsWith(legacyProdScope) || legacyProdScope.startsWith(prodScope),
    '전환기 구 정식(v0.48)과 새 정식은 서로의 scope 밖이어야 한다').toBe(false);
  expect(previewScope.startsWith(legacyProdScope),
    '새 프리뷰가 구 정식 SW의 scope 안에 들어가면 안 된다').toBe(false);
  // 🔑 하이픈이 슬래시가 아니라는 사실 하나가 이 안전성의 전부다 — 경로를
  //    `/agri-voicenote/preview/`로 바꾸면 **즉시 침범**한다. 그래서 이 단언을 남긴다.
  expect('/agri-voicenote/preview/'.startsWith(prodScope),
    '경로를 슬래시 하위로 바꾸면 프로덕션 SW가 프리뷰를 가로챈다 — 배포 경로를 바꾸지 마라').toBe(true);
});


// ── ④ 업데이트 UI가 **렌더된다**(브리핑 §6 ④) ─────────────────────────────────
// 🔴 종전엔 `__PREVIEW_BUILD__`면 `UpdateControl`을 통째로 숨기고 *"화면을 아래로 당겨
//    새로고침"* 을 안내했다 — standalone에는 그 제스처가 없으므로 **틀린 문장**이었다.
//    이제 빌드 종류와 무관하게 같은 컨트롤이 선다.

async function bootToSettings(page: Page) {
  await installVoiceMocks(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  await page.locator('[data-testid="tab-settings"]').click();
  await page.waitForTimeout(200);
}

test('ⓗ 설정탭에 버전 확인 컨트롤이 있고, 눌러도 「최신」으로 뭉개지 않는다', async ({ page }) => {
  await bootToSettings(page);
  const control = page.locator('[data-testid="update-control"]');
  await control.scrollIntoViewIfNeeded();
  await expect(control, '업데이트 컨트롤이 렌더되지 않았다 — 갱신 경로가 다시 0개다').toBeVisible();

  // 종전 안내 문구는 사라졌다(있으면 standalone에서 성립하지 않는 거짓 안내가 남은 것이다).
  await expect(page.locator('[data-testid="preview-update-note"]')).toHaveCount(0);

  await page.locator('[data-testid="version-check-btn"]').click();
  const result = page.locator('[data-testid="version-check-result"]');
  await expect(result, '버튼을 눌렀는데 아무 결과도 안 나온다').toBeVisible({ timeout: 10_000 });
  // 🔴 dev 서버는 번들 해시가 없다(`readBundleId()` → 'dev'). 그 상태를 **「최신」이라고 답하면
  //    안 된다** — 종전 `checkedNoUpdate`가 정확히 그 함정이었다.
  await expect(result, 'dev 빌드에서 「최신」이라고 답했다 — 모르는 것을 아는 척한 것이다')
    .toHaveAttribute('data-status', 'indeterminate');
  await expect(page.locator('[data-testid="apply-update-btn"]'),
    '판정 불가인데 업데이트 버튼을 띄웠다').toHaveCount(0);
});
