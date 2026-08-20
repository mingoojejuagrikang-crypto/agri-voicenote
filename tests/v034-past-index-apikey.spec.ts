/**
 * v0.34.0 C9 — 과거값 준비 자동화: API key 읽기 폴백 + 부팅 트리거.
 *
 * 배경(민구): "시트가 연결되면 자동으로 작동해야 함. 시트는 링크가 있는 모든 사용자 읽기/쓰기."
 * 토큰은 ~1h면 만료([AUTH-4] refresh token 없음)라 토큰 단독 조건은 과거값 준비를 자주 침묵시켰다.
 * 공개 시트는 API key만으로 읽기가 가능하므로, pastValues 읽기 경로(fetchAllRowsUnbounded)에만
 * `?key=` 폴백을 격리 적용한다(planValuesReadonly). 쓰기·메타 경로(authFetch)는 무수정 —
 * 회귀는 sync-token-expiry.spec.ts가 지킨다.
 *
 * 구성:
 *  1) 단위(Node) — planValuesReadonly 순수 함수: 토큰 우선(Bearer, key 미노출) /
 *     key 폴백(?key=, 인코딩) / 둘 다 없음 → null.
 *  2) e2e — 토큰 없음 부팅: 이 dev 환경은 VITE_GOOGLE_API_KEY 미설정이므로
 *     `past_index_skip:not_signed_in`이 남고 Sheets GET이 없어야 한다. (key가 설정된 환경이라면
 *     같은 부팅이 `past_index_fetch_start:auth=apikey`로 진행되는 것이 정답 — 둘 중 하나를 허용해
 *     env 양쪽에서 참인 계약을 고정한다.)
 *  3) e2e — 토큰 있음 부팅: v0.34.0 C9(c) 부팅 트리거가 세션 시작 **전에**
 *     `past_index_fetch_start:auth=token` → `past_index_ready`를 만든다.
 *
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다(수동 기동 불필요, [ORCH-27])
 */
import { test, expect, type Page } from '@playwright/test';
import { planValuesReadonly } from '../src/lib/sheets';
import { BASE } from './baseUrl';

test.setTimeout(60_000);

const STORE_KEY = 'agri-voicenote-settings-v3';
const SHEET_ID = 'SHEET_V034_APIKEY_1';

// ─── 1) 단위 — planValuesReadonly ───────────────────────────────────────────

test.describe('planValuesReadonly — 읽기 전용 인증 계획(순수 함수)', () => {
  test('토큰 있음 → Bearer 헤더 + auth=token, URL에 key 미노출(토큰이 key보다 우선)', () => {
    const plan = planValuesReadonly('SID', 'Sheet1', 'TOK', 'KEY');
    expect(plan).not.toBeNull();
    expect(plan!.auth).toBe('token');
    expect(plan!.headers).toEqual({ Authorization: 'Bearer TOK' });
    expect(plan!.url).toBe('https://sheets.googleapis.com/v4/spreadsheets/SID/values/Sheet1');
    expect(plan!.url).not.toContain('key=');
  });

  test('토큰 없음 + key 있음 → ?key= 쿼리 + auth=apikey, Authorization 없음 (fetch 진행 경로)', () => {
    const plan = planValuesReadonly('SID', 'Sheet1', null, 'AIza/we+ird');
    expect(plan).not.toBeNull();
    expect(plan!.auth).toBe('apikey');
    expect(plan!.headers).toBeUndefined();
    // key는 반드시 URL-인코딩되어 실린다.
    expect(plan!.url).toBe(
      `https://sheets.googleapis.com/v4/spreadsheets/SID/values/Sheet1?key=${encodeURIComponent('AIza/we+ird')}`,
    );
  });

  test('둘 다 없음 → null (호출자 loadPastIndex가 not_signed_in skip을 결정)', () => {
    expect(planValuesReadonly('SID', 'Sheet1', null, null)).toBeNull();
  });
});

// ─── e2e 공통 시드 (past-index-fallback.spec.ts 패턴 축약) ──────────────────

const COLUMNS = [
  { id: 'c1', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'c3', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'increase' },
];

const SETTINGS = {
  state: {
    googleConnected: true, // persist true여도 토큰 스토리지가 진실([AUTH-7])
    userEmail: 'tester@example.com',
    sheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`,
    sheetTab: 'Sheet1',
    columnsSheetId: SHEET_ID,
    columnsSheetTab: 'Sheet1',
    columns: COLUMNS,
    tableGenerated: true,
    totalRows: 2,
    roundDateColId: null,
  },
  version: 12,
};

function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const PREV_ROUND = localISO(new Date(Date.now() - 86_400_000));
const HEADERS = ['조사일자', '농가명', '조사나무', '횡경'];
const SHEET_ROWS = [
  [PREV_ROUND, '이원창', '1', '100.0'],
  [PREV_ROUND, '이원창', '2', '110.0'],
];

async function stubSheets(
  page: Page,
  opts: { failStatus?: number } = {},
): Promise<{ gets: number; urls: string[] }> {
  const counter = { gets: 0, urls: [] as string[] };
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    if (route.request().method() === 'GET') {
      counter.gets++;
      counter.urls.push(route.request().url());
      // failStatus면 모든 GET을 그 상태로 실패시킨다(비공개 시트를 key로 읽는 상황 재현).
      if (opts.failStatus) {
        await route.fulfill({
          status: opts.failStatus,
          body: JSON.stringify({ error: { code: opts.failStatus, message: 'The caller does not have permission' } }),
        });
        return;
      }
      await route.fulfill({ json: { values: [HEADERS, ...SHEET_ROWS] } });
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected: ' + route.request().url() });
  });
  return counter;
}

async function seedAndBoot(page: Page, opts: { withToken: boolean; failStatus?: number }) {
  const counter = await stubSheets(page, { failStatus: opts.failStatus });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ settings, storeKey, withToken }) => {
      localStorage.clear();
      if (withToken) {
        localStorage.setItem('gs10_google_token', JSON.stringify({
          access_token: 'test-token', expires_at: Date.now() + 3600_000, email: 'tester@example.com',
        }));
      }
      localStorage.setItem(storeKey, JSON.stringify(settings));
    },
    { settings: SETTINGS, storeKey: STORE_KEY, withToken: opts.withToken },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800); // 부팅 트리거(hydratePastIndexFallback → ensurePastIndex) 여유
  return counter;
}

/** IDB logEvents의 extra 문자열 목록. */
async function getEventExtras(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!db.objectStoreNames.contains('logEvents')) { db.close(); return []; }
    const tx = db.transaction('logEvents', 'readonly');
    const all: Array<{ extra?: string }> = await new Promise((resolve, reject) => {
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return all.map((e) => e.extra).filter((x): x is string => typeof x === 'string');
  });
}

// ─── 2) e2e — 토큰 없음 부팅 ────────────────────────────────────────────────

test('토큰 없음 부팅 — key 미설정 env면 skip:not_signed_in(+GET 0), key 설정 env면 auth=apikey 진행', async ({ page }) => {
  const counter = await seedAndBoot(page, { withToken: false });
  const extras = await getEventExtras(page);

  const skipped = extras.some((x) => x === 'past_index_skip:not_signed_in');
  const apikeyStarted = extras.some((x) => x === 'past_index_fetch_start:auth=apikey');
  // env 무관 계약: 토큰이 없으면 (key 없음 → not_signed_in skip) XOR (key 있음 → apikey 진행).
  expect(skipped || apikeyStarted).toBe(true);
  // 토큰이 없으므로 auth=token 진행은 절대 없어야 한다.
  expect(extras.some((x) => x === 'past_index_fetch_start:auth=token')).toBe(false);
  if (skipped && !apikeyStarted) {
    // key 미설정 env(현 dev 기본): fetch 자체가 없어야 한다.
    expect(counter.gets).toBe(0);
  } else {
    // key 설정 env: GET URL에 ?key= 가 실리고 Bearer 헤더는 없다.
    expect(counter.urls.some((u) => u.includes('key='))).toBe(true);
  }
});

// ─── 3) e2e — 토큰 있음 부팅: C9(c) 부팅 트리거 ─────────────────────────────

test('토큰 있음 부팅 — 세션 시작 전 부팅 트리거가 auth=token으로 인덱스를 준비한다(C9(c))', async ({ page }) => {
  const counter = await seedAndBoot(page, { withToken: true });
  // 부팅 직후(세션 시작 없이) fetch가 나가고 ready까지 도달한다.
  await expect.poll(async () => {
    const extras = await getEventExtras(page);
    return extras.some((x) => x.startsWith('past_index_ready'));
  }, { timeout: 5000 }).toBe(true);
  const extras = await getEventExtras(page);
  expect(extras.some((x) => x === 'past_index_fetch_start:auth=token')).toBe(true);
  expect(counter.gets).toBeGreaterThanOrEqual(1);
  // 토큰 경로에선 key 쿼리가 URL에 노출되지 않는다.
  expect(counter.urls.every((u) => !u.includes('key='))).toBe(true);
});

// ─── 4) 회귀 — 권한 오류(403)는 백오프 재시도를 태우지 않는다 ────────────────
//
// v0.34.0 코드리뷰(Codex+agy-Flash 공통 지적): 비공개 시트를 API key로 읽으면 무조건 403인데
// shouldRetryLoad가 "인증수단 있음"만 보고 재시도 가치를 인정해 지수 백오프 5회를 강행 → 무의미한
// 쿼터·대역폭 소모. 수정 후: 401/403이면 재시도 예산을 즉시 소진(past_index_retry_blocked 계측).
// 회복 가능한 실패(5xx·오프라인·타임아웃)의 재시도는 그대로 유지된다.

test('[리뷰] 403 권한 오류 → 재시도 차단(GET 1회, retry_blocked 계측) — 무의미한 백오프 소모 없음', async ({ page }) => {
  const counter = await seedAndBoot(page, { withToken: true, failStatus: 403 });

  // 실패는 침묵하지 않는다 — skip 로깅 + 재시도 차단 계측이 남는다.
  await expect.poll(async () => {
    const extras = await getEventExtras(page);
    return extras.some((x) => x.startsWith('past_index_retry_blocked:permission'));
  }, { timeout: 5000 }).toBe(true);

  const extras = await getEventExtras(page);
  expect(extras.some((x) => x.startsWith('past_index_skip:'))).toBe(true);
  expect(extras.some((x) => x.startsWith('past_index_ready'))).toBe(false);

  // 핵심: 백오프가 돌지 않는다. 백오프(600·1200·2400…ms)가 살아 있으면 이 창에서 GET이 늘어난다.
  const getsAfterFail = counter.gets;
  await page.waitForTimeout(2500);
  expect(counter.gets).toBe(getsAfterFail);
});
