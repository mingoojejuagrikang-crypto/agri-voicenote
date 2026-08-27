/**
 * v0.47.0 C-FIX5(리뷰 U7, minor) — **ModifyIndicatorPill 확정값 국면의 ellipsis 제거** 오라클.
 *
 * W5ⓑ(VoiceHero) 동형: 숫자 축약('29.9'→'29…')은 다른 숫자로의 오독이다. 넘침 방지는
 * useFitGroup이 맡고, 확정값(committed) 국면의 textOverflow는 'clip'이어야 한다.
 * interim 국면은 ellipsis 유지(Larry 확정 08-08 — 확정값 라인만. «…»는 임의 길이 STT
 * 문장의 "뒤가 더 있다" 표기 계약, v043-fit-group:333) — 그 축은 v043-fit-group이 짊어진다.
 *
 * 관측: 수정 성공 echo('수정 <값>' 꼴)만 onend 1.2s 동결하는 mock으로 committed 국면을
 * 세워 두고 modify-value의 computed textOverflow를 판독한다(v047-cfix1과 같은 기법).
 * ⚠️ 왕복 OFF([TEAMOPS-81]).
 */

import { test, expect, type Page } from '@playwright/test';
import { BASE } from './baseUrl';
import { GUM_GRANT_SCRIPT } from './fixtures/gum';

test.setTimeout(120_000);

const STORE_KEY = 'agri-voicenote-settings-v3';
const PHONE_402 = { width: 402, height: 874 };

const SETTINGS = {
  state: {
    chipSweepSeconds: 0, // 🔴 [TEAMOPS-81]
    googleConnected: false,
    userEmail: null,
    sheet: null,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_CFIX5/edit',
    sheetTab: 'Sheet1',
    columnsSheetId: 'SHEET_CFIX5',
    columnsSheetTab: 'Sheet1',
    availableSheets: [],
    manualMode: false,
    columns: [
      { id: 'c6', name: '조사나무', type: 'int',   input: 'auto',  ttsAnnounce: true,  auto: { kind: 'seq', from: 1, to: 3 } },
      { id: 'c8', name: '당도', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
      { id: 'c9', name: '산도', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
    ],
    tableGenerated: true,
    totalRows: 3,
    ttsRate: 1.05,
    sessionLabelColId: null,
    sessionAutoLabel: 'cfix5-pill-ellipsis',
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
      var delay = (u.text.indexOf('수정 ') === 0) ? 1200 : 0;
      try { if (u.onstart) u.onstart(new Event('start')); } catch(e) {}
      setTimeout(function() { try { if (u.onend) u.onend(new Event('end')); } catch(e) {} }, delay);
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

test('C-FIX5 — 확정값 국면 modify-value는 textOverflow:clip(축약 금지), 값 온전 표기', async ({ page }) => {
  await page.setViewportSize(PHONE_402);
  await page.addInitScript(GUM_GRANT_SCRIPT);
  await page.addInitScript(MOCK_INIT_SCRIPT);
  await page.addInitScript(() => {
    (window as unknown as { __micSettleSkipForTest?: boolean }).__micSettleSkipForTest = true;
  });
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
  await page.locator('text=음성 입력 시작').first().click();
  await page.waitForTimeout(800);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 4000 });

  // 당도 커밋 → "수정" → 새 값 44.4 → 성공 echo가 1.2s 동결돼 committed 국면이 서 있다.
  await fireStt(page, '33.3', 500);
  await fireStt(page, '수정', 600);
  await expect(page.locator('[data-testid="modify-indicator"]')).toBeVisible({ timeout: 4000 });
  await fireStt(page, '44.4', 250);

  const value = page.locator('[data-testid="modify-value"]');
  await expect(value, 'committed 국면 값 표시').toBeVisible({ timeout: 3000 });
  await expect(value).toHaveText('44.4'); // 값 온전(축약 표기 없음)
  const style = await value.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { textOverflow: cs.textOverflow, overflow: cs.overflowX };
  });
  expect(style.textOverflow, '확정값 국면 ellipsis 제거(W5 동형)').toBe('clip');
  expect(style.overflow, 'overflow:hidden 유지(레이아웃 계약)').toBe('hidden');
});
