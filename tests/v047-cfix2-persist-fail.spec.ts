/**
 * v0.47.0 C-FIX2(리뷰 U3, major) — **셀 영속 실패는 성공으로 고지되지 않는다** 오라클.
 *
 * 종전: persistCellValue가 saveSession 실패를 catch{}로 삼켜, 유실될 값에 커밋 화음·에코·
 * ✓ 등록·advance가 전부 나갔다(PRINCIPLES §1 위반 — manualHold [확인]의 durable 실패
 * 처리와 비대칭). 처방: 실패 시 성공 신호 전부 억제 + 경고 트릴·발화 고지 + ✓ 미등록
 * (등록을 durable 뒤로 옮겨 회수 자체가 불필요) + 진행 정지(재커밋 = 재시도).
 *
 * 실패 주입: db.ts의 공식 seam `__survey011FailSessionPut`(v0.35.0 R3-FIX-2 신설 — 용량부족
 * 계열 durable 실패 등가). ⚠️ saveSession은 세션이 IDB에 이미 있을 때만 불리므로(행 미완료면
 * 다음 persistSession 자연 반영 계약) 1행을 완주해 세션을 내구화한 뒤 2행에서 주입한다.
 * ⚠️ 왕복 OFF([TEAMOPS-81]).
 */

import { test, expect, type Page } from '@playwright/test';
import { GUM_GRANT_SCRIPT } from './fixtures/gum';
import { BASE } from './baseUrl';

test.setTimeout(120_000);

const STORE_KEY = 'agri-voicenote-settings-v3';

const SETTINGS = {
  state: {
    chipSweepSeconds: 0, // 🔴 [TEAMOPS-81]
    googleConnected: false,
    userEmail: null,
    sheet: null,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_CFIX2/edit',
    sheetTab: 'Sheet1',
    columnsSheetId: 'SHEET_CFIX2',
    columnsSheetTab: 'Sheet1',
    availableSheets: [],
    manualMode: false,
    columns: [
      { id: 'c6', name: '조사나무', type: 'int',   input: 'auto',  ttsAnnounce: true,  auto: { kind: 'seq', from: 1, to: 3 } },
      { id: 'c8', name: '횡경',     type: 'float', input: 'voice', ttsAnnounce: true,  auto: { kind: 'fixed', value: '' }, decimals: 1 },
      { id: 'c9', name: '종경',     type: 'float', input: 'voice', ttsAnnounce: true,  auto: { kind: 'fixed', value: '' }, decimals: 1 },
    ],
    tableGenerated: true,
    totalRows: 3,
    ttsRate: 1.05,
    sessionLabelColId: null,
    sessionAutoLabel: 'cfix2-persist-fail',
    noisyMode: false,
    preferredVoiceName: '',
  },
  version: 13,
};

const MOCK_INIT_SCRIPT = `
(function() {
  window.__ttsLog = [];
  var mockSynth = {
    speak: function(u) {
      window.__ttsLog.push(u.text);
      try { if (u.onstart) u.onstart(new Event('start')); } catch(e) {}
      try { if (u.onend)   u.onend(new Event('end'));     } catch(e) {}
    },
    cancel: function() {}, pause: function() {}, resume: function() {},
    getVoices: function() { return [{ name: 'Mock Korean', lang: 'ko-KR', default: true, localService: true, voiceURI: 'mock' }]; },
    speaking: false, pending: false, paused: false, onvoiceschanged: null,
    addEventListener: function() {}, removeEventListener: function() {}, dispatchEvent: function() { return true; },
  };
  try {
    Object.defineProperty(window, 'speechSynthesis', { get: function() { return mockSynth; }, configurable: true, enumerable: true });
  } catch(e1) {
    try { Object.defineProperty(Window.prototype, 'speechSynthesis', { get: function() { return mockSynth; }, configurable: true }); }
    catch(e2) { try { window.speechSynthesis = mockSynth; } catch(e3) {} }
  }
  var _addStyle = function() {
    var s = document.createElement('style');
    s.textContent = '* { animation-duration: 0ms !important; transition-duration: 0ms !important; }';
    (document.head || document.documentElement).appendChild(s);
  };
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _addStyle); } else { _addStyle(); }

  function MockSTT() {
    this._ls = {};
    this.continuous = true; this.interimResults = true; this.lang = 'ko-KR'; this.maxAlternatives = 3;
    window.__mockSTT = this;
    this._aborted = false;
  }
  MockSTT.prototype.addEventListener = function(t, cb) { if (!this._ls[t]) this._ls[t] = []; this._ls[t].push(cb); };
  MockSTT.prototype.removeEventListener = function(t, cb) { if (this._ls[t]) this._ls[t] = this._ls[t].filter(function(f) { return f !== cb; }); };
  MockSTT.prototype.start = function() { this._aborted = false; var self = this; setTimeout(function() { (self._ls['start'] || []).forEach(function(cb) { cb(new Event('start')); }); }, 5); };
  MockSTT.prototype.stop = function() {};
  MockSTT.prototype.abort = function() {
    this._aborted = true;
    var self = this;
    setTimeout(function() { (self._ls['end'] || []).forEach(function(cb) { cb(new Event('end')); }); }, 5);
  };
  MockSTT.prototype.fireResult = function(transcript, confidence) {
    if (this._aborted) return;
    if (confidence === undefined) confidence = 0.95;
    var event = { resultIndex: 0, results: { length: 1, 0: { isFinal: true, length: 1, 0: { transcript: transcript, confidence: confidence } } } };
    (this._ls['result'] || []).forEach(function(cb) { cb(event); });
  };
  try { Object.defineProperty(window, 'SpeechRecognition', { value: MockSTT, writable: true, configurable: true, enumerable: true }); }
  catch(e1) { try { window.SpeechRecognition = MockSTT; } catch(e2) {} }
  try { Object.defineProperty(window, 'webkitSpeechRecognition', { value: MockSTT, writable: true, configurable: true, enumerable: true }); }
  catch(e) { try { window.webkitSpeechRecognition = MockSTT; } catch(e2) {} }
})();
`;

async function fireStt(page: Page, transcript: string, waitMs = 300) {
  await page.evaluate((t) => {
    (window as unknown as { __mockSTT?: { fireResult: (t: string, c: number) => void } }).__mockSTT?.fireResult(t, 0.95);
  }, transcript);
  await page.waitForTimeout(waitMs);
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

async function loadLogEventsFromIDB(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db || !db.objectStoreNames.contains('logEvents')) return [];
    return new Promise<Array<{ type: string; extra?: string }>>((res) => {
      const tx = db.transaction('logEvents', 'readonly');
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result as Array<{ type: string; extra?: string }>);
      req.onerror = () => res([]);
    });
  });
}

const countBeeps = (events: Array<{ type: string; extra?: string }>, kind: string) =>
  events.filter((e) => e.type === 'app' && (e.extra ?? '').startsWith(`beep_play:kind=${kind}`)).length;

async function setupAndStart(page: Page) {
  // [TEST-GUM-1] — gUM 스텁이 없으면 `start()`의 마이크 획득이 로컬 헤드리스에서 응답하지 않아
  //   세션 시작 자체가 막힌다(제품 회귀 아님). 이 spec들의 계약은 마이크 상태와 무관하다.
  await page.addInitScript({ content: GUM_GRANT_SCRIPT });
  await page.addInitScript(MOCK_INIT_SCRIPT);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ s, storeKey }) => {
      localStorage.clear();
      localStorage.setItem(storeKey, JSON.stringify(s));
      indexedDB.deleteDatabase('agri-voicenote');
    },
    { s: SETTINGS, storeKey: STORE_KEY },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(200);
  const startBtn = page.locator('text=음성 입력 시작').first();
  await expect(startBtn).toBeVisible();
  await startBtn.click();
  await page.waitForTimeout(600);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
}

async function manualCommit(page: Page, colName: string, keys: string[]) {
  await page.locator(`[data-testid="column-chip"][data-col-name="${colName}"]`).click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible({ timeout: 3000 });
  for (const k of keys) await page.locator(`[data-testid="manual-key-${k}"]`).click();
  await page.locator('[data-testid="manual-commit"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toHaveCount(0);
  await page.waitForTimeout(500);
}

test('C-FIX2 — 영속 실패 시 성공 신호 0(화음·에코·✓·advance) + 경고 고지, seam 해제 후 재커밋이 회복', async ({ page }) => {
  await setupAndStart(page);
  await waitForActiveChip(page, '횡경');

  // 1행 완주(음성 커밋 ×2 = kind=commit 2회) → 세션이 IDB에 내구화돼 saveSession 경로가 열린다.
  await fireStt(page, '33.3', 500);
  await fireStt(page, '22.2', 800);
  await waitForActiveChip(page, '횡경'); // 2행 착지

  // ── 실패 주입 후 수동 커밋(awaiting 셀) ──
  await page.evaluate(() => { (window as unknown as { __survey011FailSessionPut?: boolean }).__survey011FailSessionPut = true; });
  await manualCommit(page, '횡경', ['3', '5', '.', '1']);

  // 성공 신호 0: 화음 없음(2회 그대로) · 에코 없음 · advance 없음 · ✓ 없음.
  let events = await loadLogEventsFromIDB(page);
  expect(countBeeps(events, 'commit'), '실패 커밋에 화음 금지').toBe(2);
  const tts1 = await page.evaluate(() => (window as unknown as { __ttsLog: string[] }).__ttsLog);
  expect(tts1.filter((t) => t === '35.1' || t.startsWith('35.1')).length, '실패 커밋에 값 에코 금지').toBe(0);
  await waitForActiveChip(page, '횡경'); // 전진 금지 — 재커밋이 재시도가 되도록 그 자리
  await expect(page.locator('[data-testid="chip-commit-mark"]'), '실패 커밋에 ✓ 금지').toHaveCount(0);

  // 고지: 경고 트릴 + 발화(현장은 화면을 못 본다 — §2) + 계측.
  expect(countBeeps(events, 'alert'), '경고 트릴 1회').toBe(1);
  expect(tts1.some((t) => t.includes('저장하지 못했습니다')), '실패 발화 고지').toBe(true);
  expect(events.some((e) => e.type === 'error' && (e.extra ?? '').startsWith('cell_persist_failed:')), '실패 계측').toBe(true);

  // ── C-FIX2b — **지속 배너**: TTS를 놓쳐도 화면에 남는다(PRINCIPLES §1) + 실패 셀·값 명시. ──
  const banner = page.locator('[data-testid="cell-persist-error-banner"]');
  await expect(banner, '실패가 화면에 지속된다').toBeVisible();
  await expect(banner).toContainText('횡경 35.1');

  // 재시도 ① — seam이 아직 켜져 있다: 실패가 반복돼도 배너가 남고 고지가 다시 난다.
  await page.locator('[data-testid="cell-persist-retry-btn"]').click();
  await page.waitForTimeout(600);
  await expect(banner, '재시도 실패 시 배너 유지').toBeVisible();
  events = await loadLogEventsFromIDB(page);
  expect(countBeeps(events, 'alert'), '재시도 실패 고지(트릴 2회째)').toBe(2);
  expect(countBeeps(events, 'commit'), '여전히 성공 화음 없음').toBe(2);

  // 재시도 ② — seam 해제 → [다시 저장] = 원래 커밋 플로우 전체 재개(화음·에코·advance·✓) + 배너 해소.
  await page.evaluate(() => { (window as unknown as { __survey011FailSessionPut?: boolean }).__survey011FailSessionPut = false; });
  await page.locator('[data-testid="cell-persist-retry-btn"]').click();
  await expect(banner, 'durable 성공이 배너를 내린다').toHaveCount(0, { timeout: 4000 });

  events = await loadLogEventsFromIDB(page);
  expect(countBeeps(events, 'commit'), '재시도 성공 화음').toBe(3);
  await waitForActiveChip(page, '종경'); // 이제 전진
  await expect(
    page.locator('[data-testid="column-chip"][data-col-name="횡경"] [data-testid="chip-commit-mark"]'),
    '재시도 성공 ✓',
  ).toBeVisible();
  await expect(page.locator('[data-testid="column-chip"][data-col-name="횡경"]')).toContainText('35.1');
});
