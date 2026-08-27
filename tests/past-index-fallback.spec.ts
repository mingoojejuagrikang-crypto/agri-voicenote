/**
 * v0.33.0 항목5 — 로그인 무관 이상치 알람 e2e (past_index IDB 영속화 + 폴백 + 3상태 배지).
 *
 * 배경(07-13 실기기 §4): 토큰 만료(~1h, [AUTH-4]) → `past_index_skip:not_signed_in` →
 * 알람 침묵 → -99.5% 오데이터("1")가 무알람 통과·시트 동기화. 이 spec은 그 시나리오의 방어를
 * 직접 재현한다: **토큰이 없어도** IDB `__past_index__` 스냅샷(fp 일치 + 14일 이내)으로 알람이
 * 발화하고, 폴백 사용은 `trend_used_stale_index`로 계측된다.
 *
 * 패턴: trend-alert.spec.ts의 STT/TTS 주입 + Sheets stub + 설정 시드. IDB kv 레코드는
 * Node에서 buildPastIndex + serializePastIndexEntry로 만든 뒤(fp도 브라우저와 동일 규칙으로
 * Node에서 합성) page.evaluate로 주입한다.
 *
 * 검증:
 *   1. 미로그인 + 유효 폴백(2h 전) → 이상치 알람 발화 + trend_used_stale_index:age_h=2
 *   2. 14일 초과 폴백 → 무알람(조용히 skip) + trend_skip:no_index (죽은 비교선 미사용)
 *   3. 로그인 세션 past_index_ready → IDB write-through 레코드 존재 + past_index_fetch_start 계측
 *      + 신선 캐시 경로는 stale 로그 없음
 *   4. 3상태 배지(설정탭·입력탭 시작 카드): Google 연결(토큰 실시간)/시트 연결/과거값 준비 + 재시도 버튼
 *
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다(수동 기동 불필요, [ORCH-27])
 */
import { test, expect, type Page } from '@playwright/test';
import { buildPastIndex, resolveRoundCol } from '../src/lib/pastValuesIndex';
import {
  serializePastIndexEntry,
  FALLBACK_TTL_MS,
  type PersistedPastIndexRecord,
} from '../src/lib/pastValuesPersist';
import { effectiveSampleKey } from '../src/lib/columnFlags';
import type { Column } from '../src/types';
import { BASE } from './baseUrl';
// 🔴 v0.49 r4 M7(claude r3 #13) — [TEST-GUM-1] 최소 스텁(위 manual-input과 같은 사유).
import { GUM_GRANT_SCRIPT } from './fixtures/gum';
// A11 — 「어제」는 달력 연산으로 만든다(DST 함정). 사유는 fixtures/localDate.ts 헤더.
import { daysAgoLocal } from './fixtures/localDate';

test.setTimeout(120_000);

const STORE_KEY = 'agri-voicenote-settings-v3';
const SHEET_ID = 'SHEET_PASTIDX_1';

const PREV_ROUND = daysAgoLocal(1); // 어제 — previousRound는 오늘 미만 strictly

// trend-alert.spec.ts와 동일 스키마 — 샘플키: 농가명 + 조사나무·조사과실(seq 2×5=10행).
const COLUMNS = [
  { id: 'c1', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'c3', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'c7', name: '조사과실', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 5 }, sampleKey: true },
  { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'increase' },
  { id: 'c9', name: '종경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, pctThreshold: 15 },
];

const SETTINGS = {
  state: {
    googleConnected: true, // persist가 true여도 토큰이 없으면 배지·알람은 정직해야 한다([AUTH-7])
    userEmail: 'tester@example.com',
    sheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`,
    sheetTab: 'Sheet1',
    columnsSheetId: SHEET_ID,
    columnsSheetTab: 'Sheet1',
    columns: COLUMNS,
    tableGenerated: true,
    totalRows: 10,
    ttsRate: 1.05,
    sessionLabelColId: null,
    sessionAutoLabel: 'pastidx-test',
    noisyMode: false,
    speakerphoneMode: false,
    preferredVoiceName: '',
    roundDateColId: null,
  },
  version: 12,
};

const HEADERS = ['조사일자', '농가명', '조사나무', '조사과실', '횡경', '종경'];
const SHEET_ROWS = [
  [PREV_ROUND, '이원창', '1', '1', '100.0', '50.0'],
  [PREV_ROUND, '이원창', '1', '2', '110.0', '55.0'],
];

/** 브라우저 loadContext()와 동일 규칙의 캐시 지문 — 여기가 어긋나면 폴백이 조용히 무시되므로
 *  effectiveSampleKey(SSOT)를 그대로 사용해 합성한다. */
function computeFp(): string {
  return JSON.stringify([
    SHEET_ID,
    'Sheet1',
    null,
    (COLUMNS as unknown as Column[]).map((c) => [c.id, c.name.trim(), c.type, effectiveSampleKey(c)]),
  ]);
}

/** IDB kv `__past_index__`에 주입할 영속 레코드(builtAt 지정). */
function buildRecord(builtAt: number): PersistedPastIndexRecord {
  const cols = COLUMNS as unknown as Column[];
  const index = buildPastIndex(HEADERS, SHEET_ROWS, cols, resolveRoundCol(cols, null));
  return serializePastIndexEntry({ fp: computeFp(), builtAt, index });
}

// trend-alert.spec.ts와 동일한 TTS/STT 주입 mock.
const MOCK_INIT_SCRIPT = `
(function() {
  window.__ttsLog = [];

  var mockSynth = {
    speak: function(utterance) {
      window.__ttsLog.push(utterance.text);
      try { if (utterance.onstart) utterance.onstart(new Event('start')); } catch(e) {}
      try { if (utterance.onend)   utterance.onend(new Event('end'));     } catch(e) {}
    },
    cancel: function() {},
    pause: function() {},
    resume: function() {},
    getVoices: function() {
      return [{ name: 'Mock Korean', lang: 'ko-KR', default: true, localService: true, voiceURI: 'mock' }];
    },
    speaking: false, pending: false, paused: false, onvoiceschanged: null,
    addEventListener: function() {},
    removeEventListener: function() {},
    dispatchEvent: function() { return true; },
  };
  try {
    Object.defineProperty(window, 'speechSynthesis', {
      get: function() { return mockSynth; }, configurable: true, enumerable: true,
    });
  } catch(e1) {
    try { window.speechSynthesis = mockSynth; } catch(e3) {}
  }

  function MockSTT() {
    this._ls = {};
    this.continuous = true;
    this.interimResults = true;
    this.lang = 'ko-KR';
    this.maxAlternatives = 3;
    window.__mockSTT = this;
  }
  MockSTT.prototype.addEventListener = function(t, cb) {
    if (!this._ls[t]) this._ls[t] = [];
    this._ls[t].push(cb);
  };
  MockSTT.prototype.removeEventListener = function(t, cb) {
    if (this._ls[t]) this._ls[t] = this._ls[t].filter(function(f) { return f !== cb; });
  };
  MockSTT.prototype.start = function() {
    var self = this;
    setTimeout(function() {
      (self._ls['start'] || []).forEach(function(cb) { cb(new Event('start')); });
    }, 5);
  };
  MockSTT.prototype.stop = function() {};
  MockSTT.prototype.abort = function() {
    var self = this;
    setTimeout(function() {
      (self._ls['end'] || []).forEach(function(cb) { cb(new Event('end')); });
    }, 5);
  };
  MockSTT.prototype.fireResult = function(transcript, confidence) {
    if (confidence === undefined) confidence = 0.95;
    var event = {
      resultIndex: 0,
      results: {
        length: 1,
        0: { isFinal: true, length: 1, 0: { transcript: transcript, confidence: confidence } }
      }
    };
    (this._ls['result'] || []).forEach(function(cb) { cb(event); });
  };
  try {
    Object.defineProperty(window, 'SpeechRecognition', {
      value: MockSTT, writable: true, configurable: true, enumerable: true,
    });
  } catch(e1) { try { window.SpeechRecognition = MockSTT; } catch(e2) {} }
  try {
    Object.defineProperty(window, 'webkitSpeechRecognition', {
      value: MockSTT, writable: true, configurable: true, enumerable: true,
    });
  } catch(e) { try { window.webkitSpeechRecognition = MockSTT; } catch(e2) {} }
})();
`;

// ─── Helpers ────────────────────────────────────────────────────

async function stubSheets(page: Page, opts: { fail?: boolean } = {}): Promise<{ gets: number }> {
  const counter = { gets: 0 };
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    if (route.request().method() === 'GET') {
      counter.gets++;
      if (opts.fail) {
        await route.fulfill({ status: 500, body: 'stub failure' });
      } else {
        await route.fulfill({ json: { values: [HEADERS, ...SHEET_ROWS] } });
      }
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected: ' + route.request().url() });
  });
  return counter;
}

/**
 * 부팅 시드. 순서가 중요하다: ① 첫 goto(앱이 IDB 스토어 생성) → ② localStorage 시드(토큰은
 * withToken일 때만) + IDB kv 레코드 주입 → ③ reload(부팅 경로 hydratePastIndexFallback이
 * 주입 레코드를 복원).
 */
async function seedAndBoot(
  page: Page,
  opts: { withToken: boolean; record?: PersistedPastIndexRecord; sheetsFail?: boolean },
) {
  await stubSheets(page, { fail: opts.sheetsFail });
  await page.addInitScript({ content: GUM_GRANT_SCRIPT }); // M7 [TEST-GUM-1]
  await page.addInitScript(MOCK_INIT_SCRIPT);
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
  if (opts.record) {
    await page.evaluate(async (rec) => {
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        const req = indexedDB.open('agri-voicenote');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(rec, '__past_index__');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    }, opts.record as unknown as Record<string, unknown>);
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
}

async function goVoiceAndStart(page: Page) {
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(200);
  const startBtn = page.locator('text=음성 입력 시작').first();
  await expect(startBtn).toBeVisible();
  await startBtn.click();
  await page.waitForTimeout(800);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
}

async function fireStt(page: Page, transcript: string, waitMs = 300) {
  await page.evaluate((t) => {
    (window as unknown as { __mockSTT?: { fireResult: (t: string, c: number) => void } })
      .__mockSTT?.fireResult(t, 0.95);
  }, transcript);
  await page.waitForTimeout(waitMs);
}

async function getTtsLog(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __ttsLog: string[] }).__ttsLog ?? []);
}

async function waitForActiveChip(page: Page, colName: string, timeout = 5000) {
  await page.waitForFunction(
    (name) => {
      const chip = document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
      return (chip?.dataset.colName ?? '').includes(String(name));
    },
    colName,
    { timeout },
  );
}

/** IDB logEvents에서 extra 문자열 전체 목록(필터는 호출자). */
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

async function getKvPastIndexRecord(page: Page): Promise<PersistedPastIndexRecord | null> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!db.objectStoreNames.contains('kv')) { db.close(); return null; }
    const tx = db.transaction('kv', 'readonly');
    const rec: unknown = await new Promise((resolve, reject) => {
      const req = tx.objectStore('kv').get('__past_index__');
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rec as never;
  });
}

// ─── Tests ──────────────────────────────────────────────────────

test('미로그인 + 유효 폴백(2h 전) → 이상치 알람 발화 + trend_used_stale_index 계측', async ({ page }) => {
  const builtAt = Date.now() - 2 * 3_600_000;
  await seedAndBoot(page, { withToken: false, record: buildRecord(builtAt), sheetsFail: true });

  // 입력탭 시작 카드 배지: 과거값은 폴백 준비됨(warn).
  // 🔴 v0.51 재정합 — Google 배지의 판정 축이 「유효 토큰」에서 **「유효 토큰 ∪ 살아 있는 4주
  //    연결창」**으로 바뀌었다. 이 픽스처는 `googleConnected:true` + version 12라 v13 마이그레이션이
  //    연결 기록을 승계해(민구 확정 결정②) 창이 살아 있다 → 토큰이 없어도 '로그인됨'이 맞다.
  //    창이 죽었을 때 정직하게 강등하는가는 아래 3상태 배지 테스트 ①-b가 고정한다.
  //    이 테스트의 본 주제(**토큰 없이도 폴백 인덱스로 알람이 발화하는가**)는 그대로다.
  await page.locator('[data-testid="tab-voice"]').click();
  await expect(page.locator('[data-testid="conn-google"]')).toContainText('로그인됨');
  await expect(page.locator('[data-testid="conn-google"]')).toHaveAttribute('data-tone', 'ok');
  await expect(page.locator('[data-testid="conn-past"]')).toContainText('2행 · 1회차 준비됨');
  await expect(page.locator('[data-testid="conn-past"]')).toHaveAttribute('data-tone', 'warn');
  // v0.35.0 항목8 — stale(영속 폴백)엔 ready ✓ 표식이 없다(ready일 때만 붙는다).
  await expect(page.locator('[data-testid="conn-past-check"]')).toHaveCount(0);

  const startBtn = page.locator('text=음성 입력 시작').first();
  await startBtn.click();
  await page.waitForTimeout(800);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });

  // 행1(나무1·과실1) 직전 횡경 100.0 — 120.5는 increase 알람. **토큰이 없어도** 발화해야 한다.
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '120.5', 500);

  const tts = await getTtsLog(page);
  expect(tts.some((t) => t.includes('추세 알람 증가 : 20.5'))).toBe(true);
  const popup = page.locator('[data-testid="anomaly-alert"]');
  await expect(popup).toBeVisible();
  await expect(popup).toContainText('100');
  await expect(popup).toContainText('120.5');

  // '확인' → 값 유지·진행(알람 플로우 자체도 폴백 위에서 정상).
  await fireStt(page, '확인', 500);
  await waitForActiveChip(page, '종경');

  const extras = await getEventExtras(page);
  expect(extras.filter((x) => x.startsWith('trend_alert_fired'))).toHaveLength(1);
  // 폴백 사용 계측 — age_h=2(빌드 2h 전), 세션당 1회.
  expect(extras.filter((x) => x.startsWith('trend_used_stale_index'))).toEqual(['trend_used_stale_index:age_h=2']);
  // 미로그인이라 신선 인덱스는 못 만들었어야 한다(폴백이 유일한 비교선이었음을 확인).
  expect(extras.some((x) => x.startsWith('past_index_ready'))).toBe(false);
});

test('14일 초과 폴백 → 무알람(조용히 skip) + trend_skip:no_index — 죽은 비교선 미사용', async ({ page }) => {
  const builtAt = Date.now() - FALLBACK_TTL_MS - 3_600_000; // 14일 + 1h
  await seedAndBoot(page, { withToken: false, record: buildRecord(builtAt), sheetsFail: true });

  // 배지: 만료 폴백은 하이드레이션에서 폐기 → 미준비 + 재시도 버튼.
  // 🔴 v0.46.1 WP-2(민구 FB-1) — 「미준비」가 **왜 아직 아닌지**를 함께 밝히도록 바뀌었다.
  //    이 시나리오는 토큰·API key가 둘 다 없으므로 정확한 사유는 「로그인 필요」다.
  //    상태 자체(off)는 `data-tone`으로 고정한다 — 문구가 또 바뀌어도 이 축은 안 흔들린다.
  await page.locator('[data-testid="tab-voice"]').click();
  await expect(page.locator('[data-testid="conn-past"]')).toContainText('로그인 필요');
  await expect(page.locator('[data-testid="conn-past"]')).toHaveAttribute('data-tone', 'off');
  // 🔴 v0.46.1 WP-2 — **재시도 버튼은 「지금 시도할 수 있을 때」만 뜬다.** 인증 수단이 전혀
  //    없으면 눌러봐야 `past_index_skip:not_signed_in`으로 끝나므로, 무의미한 어포던스 대신
  //    사유 문구가 무엇을 해야 하는지 알려준다(`[TEAMOPS-7]` — 헛도는 알림은 신뢰를 깎는다).
  await expect(page.locator('[data-testid="past-index-retry"]')).toHaveCount(0);

  const startBtn = page.locator('text=음성 입력 시작').first();
  await startBtn.click();
  await page.waitForTimeout(800);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });

  // 알람이어야 할 120.5가 알람 없이 정상 echo·진행(인덱스 없음 → 조용히 skip — 기존 계약 유지).
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '120.5', 500);
  await waitForActiveChip(page, '종경');
  expect((await getTtsLog(page)).some((t) => /추세 알람|범위 알람/.test(t))).toBe(false);

  const extras = await getEventExtras(page);
  expect(extras.filter((x) => x === 'trend_skip:no_index')).toHaveLength(1);
  expect(extras.some((x) => x.startsWith('trend_used_stale_index'))).toBe(false);
});

test('로그인 세션 → past_index_fetch_start 계측 + IDB write-through 레코드 + 신선 경로는 stale 로그 없음', async ({ page }) => {
  await seedAndBoot(page, { withToken: true }); // 레코드 미주입 — write-through가 처음 만든다
  await goVoiceAndStart(page);

  // start() 프리페치 성공 → write-through 레코드가 IDB에 남는다(재부팅·토큰만료 대비 스냅샷).
  await expect.poll(async () => (await getKvPastIndexRecord(page))?.rowCount, { timeout: 5000 }).toBe(2);
  const rec = (await getKvPastIndexRecord(page))!;
  expect(typeof rec.fp).toBe('string');
  expect(rec.rounds).toEqual([PREV_ROUND]);
  expect(Math.abs(Date.now() - rec.builtAt)).toBeLessThan(60_000);
  // fp가 브라우저 합성과 일치해야 다음 부팅의 폴백이 실제로 쓰인다(테스트 1의 전제 교차 검증).
  expect(rec.fp).toBe(computeFp());

  // 계측: fetch 시작 이벤트가 ready와 짝으로 남는다(07-13 §4 hang 판별 갭 해소).
  // v0.34.0 C9 — auth=token|apikey 첨부: 토큰 세션이므로 auth=token이어야 한다.
  const extras = await getEventExtras(page);
  expect(extras.filter((x) => x === 'past_index_fetch_start:auth=token').length).toBeGreaterThanOrEqual(1);
  expect(extras.some((x) => x.startsWith('past_index_ready:rows=2'))).toBe(true);

  // 신선 캐시 경로: 알람은 뜨되 stale 계측은 없어야 한다.
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '120.5', 500);
  expect((await getTtsLog(page)).some((t) => t.includes('추세 알람 증가 : 20.5'))).toBe(true);
  const extras2 = await getEventExtras(page);
  expect(extras2.some((x) => x.startsWith('trend_used_stale_index'))).toBe(false);
});

test('v0.35.0 항목8 — 로그인+시트연결로 과거값 ready → 굵은 녹색 ✓ 표식(중앙카드 커밋 ✓와 동일 시각언어)', async ({ page }) => {
  // 토큰 있음 + 시트 stub 성공 → 부팅/연결 프리페치가 신선 인덱스를 만들어 ready.
  await seedAndBoot(page, { withToken: true });
  await page.locator('[data-testid="tab-voice"]').click();

  const past = page.locator('[data-testid="conn-past"]');
  // 프리페치 완료(ready) 대기 — 그때만 tone ok + ✓ 표식.
  await expect(past).toHaveAttribute('data-tone', 'ok', { timeout: 6000 });
  await expect(past).toContainText('준비됨');
  const check = page.locator('[data-testid="conn-past-check"]');
  await expect(check).toBeVisible();
  // 표식은 과거값 준비 행 안(값 앞)에 있다.
  await expect(past.locator('[data-testid="conn-past-check"]')).toHaveCount(1);
});

test('3상태 배지(설정탭) — 연결 실시간 판정([AUTH-7] stale 표시 해소) / 시트 / 과거값+재시도', async ({ page }) => {
  // ①-a 토큰 없음 + **연결창 살아 있음**(v13 승계): 로그인됨(ok) / 시트 ok / 과거값 미준비+재시도.
  // 🔴 v0.51 재정합 — 종전 계약은 「토큰 없음 = 재로그인 필요」였다. 이제 판정 축이 4주 연결창이라,
  //    창 안에서는 제스처 지점(동기화 클릭·세션 시작)에서 무팝업으로 조용히 갱신되므로 매시간
  //    '재로그인 필요'로 깜빡이는 쪽이 오히려 사실과 멀다(계획서 §2-2). [AUTH-7]이 막으려던
  //    「끝내 아무것도 안 되는데 연결됨이라 우기는 상태」는 ①-b가 계속 지킨다.
  await seedAndBoot(page, { withToken: false, sheetsFail: true });
  const card = page.locator('[data-testid="connection-status-card"]');
  await expect(card).toBeVisible();
  await expect(page.locator('[data-testid="conn-google"]')).toContainText('로그인됨 · tester@example.com');
  await expect(page.locator('[data-testid="conn-google"]')).toHaveAttribute('data-tone', 'ok');
  // ①-b 연결창까지 죽으면 **정직하게 강등한다** — 배지의 원래 존재 이유([AUTH-7])는 여기 남는다.
  await page.evaluate(() => {
    const KEY = 'agri-voicenote-settings-v3';
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { state: Record<string, unknown> };
    raw.state.googleConnection = null; // 4주 창 소멸(미사용 만료 후 정리된 상태)
    localStorage.setItem(KEY, JSON.stringify(raw));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="conn-google"]')).toContainText('재로그인 필요');
  await expect(page.locator('[data-testid="conn-google"]')).toHaveAttribute('data-tone', 'warn');
  await expect(page.locator('[data-testid="conn-sheet"]')).toContainText('Sheet1');
  await expect(page.locator('[data-testid="conn-sheet"]')).toHaveAttribute('data-tone', 'ok');
  // 🔴 v0.46.1 WP-2 — 사유를 밝히는 표시로 바뀌었다(위 주석 참조). 토큰·API key 모두 없는 상태.
  await expect(page.locator('[data-testid="conn-past"]')).toContainText('로그인 필요');
  await expect(page.locator('[data-testid="conn-past"]')).toHaveAttribute('data-tone', 'off');

  // ② 토큰 주입 후 reload: Google 연결이 로그인됨(ok)으로 — 토큰 스토리지 실시간 판정.
  await page.evaluate(() => {
    localStorage.setItem('gs10_google_token', JSON.stringify({
      access_token: 'test-token', expires_at: Date.now() + 3600_000, email: 'tester@example.com',
    }));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="conn-google"]')).toContainText('로그인됨 · tester@example.com');
  await expect(page.locator('[data-testid="conn-google"]')).toHaveAttribute('data-tone', 'ok');
});
