/**
 * v0.47.0 W1(FB-A+FB-B, 민구 08-08) — **수동 커밋 확인 신호** 오라클.
 *
 * 무엇을 재나:
 *  ① awaiting 셀 수동 커밋 → 커밋 화음(`beep_play:kind=commit`) 1회 + echo 후 advance(기존 계약).
 *     종전엔 echo만 있고 화음이 없었다 — 화음 단언이 이 스펙의 신규 축이다.
 *  ② 🔴 **비-awaiting 덮어쓰기** 수동 커밋(앱이 다른 셀을 기다리는 중) → 화음 + **값 에코 TTS** +
 *     **흐름 불변**(활성 칩 부동·행 부동). 08-08 새벽 실측에서 manual_commit 8건 중 덮어쓰기 4건이
 *     **전부 무음**이었다(FB-A/B의 실체). 현장은 폰을 2~3m 떨어뜨려 두므로 소리 없는 커밋은
 *     "저장됐는지 모르는" 커밋이다.
 *
 * 관측점:
 *  - 화음: logger가 IDB logEvents에 남기는 `type:'app', extra:'beep_play:kind=commit,…'` 집계.
 *    (WebAudio 프로브가 아니라 계측 SSOT를 읽는다 — headless의 autoplay 정책과 무관하게 안정.)
 *  - 에코: MOCK_INIT_SCRIPT의 `window.__ttsLog`(SpeechSynthesis mock).
 *
 * ⚠️ 왕복 OFF(`chipSweepSeconds: 0`) — 칩 클릭 스펙의 데드락 규율([TEAMOPS-81]).
 * Mock/fixture 패턴은 manual-input.spec.ts와 동일(자급 하네스).
 */

import { test, expect, type Page } from '@playwright/test';
import { GUM_GRANT_SCRIPT } from './fixtures/gum';
import { BASE } from './baseUrl';

test.setTimeout(120_000);

const STORE_KEY = 'agri-voicenote-settings-v3';

const BASE_SETTINGS = {
  state: {
    // 🔴 왕복 OFF — 켜져 있으면 칩 클릭이 Playwright `stable` 체크에서 데드락한다([TEAMOPS-81]).
    chipSweepSeconds: 0,
    googleConnected: false,
    userEmail: null,
    sheet: null,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_TEST_W1/edit',
    sheetTab: 'Sheet1',
    columnsSheetId: 'SHEET_TEST_W1',
    columnsSheetTab: 'Sheet1',
    availableSheets: [],
    manualMode: false,
    // 추세/이상치 규칙 없는 float 2종 — 커밋이 항상 '깨끗한 확인' 경로다(alert/corrected 아님).
    columns: [
      { id: 'c6', name: '조사나무', type: 'int',   input: 'auto',  ttsAnnounce: true,  auto: { kind: 'seq', from: 1, to: 3 } },
      { id: 'c8', name: '횡경',     type: 'float', input: 'voice', ttsAnnounce: true,  auto: { kind: 'fixed', value: '' }, decimals: 1 },
      { id: 'c9', name: '종경',     type: 'float', input: 'voice', ttsAnnounce: true,  auto: { kind: 'fixed', value: '' }, decimals: 1 },
    ],
    tableGenerated: true,
    totalRows: 3,
    ttsRate: 1.05,
    sessionLabelColId: null,
    sessionAutoLabel: 'w1-manual-signal',
    noisyMode: false,
    preferredVoiceName: '',
  },
  version: 12,
};

const MOCK_INIT_SCRIPT = `
(function() {
  window.__ttsLog = [];
  var mockSynth = {
    speak: function(utterance) {
      window.__ttsLog.push(utterance.text);
      try { if (utterance.onstart) utterance.onstart(new Event('start')); } catch(e) {}
      try { if (utterance.onend)   utterance.onend(new Event('end'));     } catch(e) {}
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
    return new Promise<Array<{ type: string; extra?: string; parsed?: string; text?: string; row?: number; colId?: string }>>((res) => {
      const tx = db.transaction('logEvents', 'readonly');
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result as Array<{ type: string; extra?: string; parsed?: string; text?: string; row?: number; colId?: string }>);
      req.onerror = () => res([]);
    });
  });
}

const countCommitBeeps = (events: Array<{ type: string; extra?: string }>) =>
  events.filter((e) => e.type === 'app' && (e.extra ?? '').startsWith('beep_play:kind=commit')).length;

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
    { s: BASE_SETTINGS, storeKey: STORE_KEY },
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

async function openSheetFor(page: Page, colName: string) {
  await page.locator(`[data-testid="column-chip"][data-col-name="${colName}"]`).click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible({ timeout: 3000 });
}

async function keyIn(page: Page, keys: string[]) {
  for (const k of keys) {
    await page.locator(`[data-testid="manual-key-${k}"]`).click();
  }
  await page.locator('[data-testid="manual-commit"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toHaveCount(0);
}

test('W1 — 수동 커밋 확인 신호: awaiting 셀 화음 / 비-awaiting 덮어쓰기 화음+에코+흐름 불변', async ({ page }) => {
  await setupAndStart(page);
  await waitForActiveChip(page, '횡경');

  // ── ① awaiting 셀(횡경) 수동 커밋 33.3 → 화음 1회 + echo 후 advance(종경) ──
  await openSheetFor(page, '횡경');
  await keyIn(page, ['3', '3', '.', '3']);
  await page.waitForTimeout(600);
  await waitForActiveChip(page, '종경'); // 기존 계약: echo 후 advance

  let events = await loadLogEventsFromIDB(page);
  expect(countCommitBeeps(events), 'awaiting 수동 커밋에 커밋 화음 1회').toBe(1);
  const tts1 = await page.evaluate(() => (window as unknown as { __ttsLog: string[] }).__ttsLog);
  expect(tts1, 'awaiting 수동 커밋 echo').toContain('33.3');

  // ── ② 비-awaiting 덮어쓰기(FB-A/B의 실체): 종경 대기 중 횡경 칩 재커밋 35.1 ──
  await openSheetFor(page, '횡경');
  await keyIn(page, ['3', '5', '.', '1']);
  await page.waitForTimeout(600);

  // 화음: 총 2회(①+②). 종전엔 ②가 완전 무음이었다.
  events = await loadLogEventsFromIDB(page);
  expect(countCommitBeeps(events), '비-awaiting 덮어쓰기 커밋에도 커밋 화음').toBe(2);

  // 값 에코 TTS: '35.1'이 발화됐다(formatForTts는 pass-through).
  const tts2 = await page.evaluate(() => (window as unknown as { __ttsLog: string[] }).__ttsLog);
  expect(tts2, '비-awaiting 덮어쓰기 커밋 값 에코').toContain('35.1');

  // 🔴 흐름 불변 — 활성 칩은 여전히 종경(advance 없음), 행 부동, 칩 값만 갱신.
  await waitForActiveChip(page, '종경');
  await expect(page.locator('[data-testid="column-chip"][data-col-name="횡경"]')).toContainText('35.1');

  // 텔레메트리: manual_commit 2건(33.3 → 35.1).
  const commits = events.filter((e) => e.type === 'command' && e.parsed === 'manual_commit');
  expect(commits.map((c) => c.text)).toEqual(['33.3', '35.1']);
});
