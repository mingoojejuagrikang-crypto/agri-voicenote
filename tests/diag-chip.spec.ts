/**
 * Minimal diagnostic: does fireStt actually trigger advance() and chip switch?
 */
import { test, expect } from '@playwright/test';
import { BASE } from './baseUrl';

test.setTimeout(60_000);

const SETTINGS_2COL = {
  state: {
    googleConnected: false, userEmail: null, sheet: null,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_TEST_1/edit', sheetTab: 'Sheet1',
    columnsSheetId: 'SHEET_TEST_1', columnsSheetTab: 'Sheet1',
    availableSheets: [], manualMode: false,
    columns: [
      { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 } },
      { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
      { id: 'c9', name: '종경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
    ],
    tableGenerated: true, totalRows: 2,
    ttsRate: 1.05, sessionLabelColId: null, sessionAutoLabel: '진단', noisyMode: false, preferredVoiceName: '',
  },
  version: 12,
};

const MOCK_INIT_SCRIPT = `
(function() {
  var mockSynth = {
    speak: function(utterance) {
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
  } catch(e) {}

  var _addStyle = function() {
    var s = document.createElement('style');
    s.textContent = '* { animation-duration: 0ms !important; transition-duration: 0ms !important; }';
    (document.head || document.documentElement).appendChild(s);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _addStyle);
  else _addStyle();

  function MockSTT() {
    this._ls = {};
    this.continuous = true; this.interimResults = true; this.lang = 'ko-KR'; this.maxAlternatives = 3;
    window.__mockSTT = this;
  }
  MockSTT.prototype.addEventListener = function(t, cb) { if (!this._ls[t]) this._ls[t] = []; this._ls[t].push(cb); };
  MockSTT.prototype.removeEventListener = function(t, cb) { if (this._ls[t]) this._ls[t] = this._ls[t].filter(function(f) { return f !== cb; }); };
  MockSTT.prototype.start = function() { var self = this; setTimeout(function() { (self._ls['start'] || []).forEach(function(cb) { cb(new Event('start')); }); }, 5); };
  MockSTT.prototype.stop = function() {};
  MockSTT.prototype.abort = function() { var self = this; setTimeout(function() { (self._ls['end'] || []).forEach(function(cb) { cb(new Event('end')); }); }, 5); };
  MockSTT.prototype.fireResult = function(transcript, confidence) {
    if (confidence === undefined) confidence = 0.95;
    var event = { resultIndex: 0, results: { length: 1, 0: { isFinal: true, length: 1, 0: { transcript: transcript, confidence: confidence } } } };
    (this._ls['result'] || []).forEach(function(cb) { cb(event); });
  };

  try { Object.defineProperty(window, 'SpeechRecognition', { value: MockSTT, writable: true, configurable: true, enumerable: true }); } catch(e) {}
  try { Object.defineProperty(window, 'webkitSpeechRecognition', { value: MockSTT, writable: true, configurable: true, enumerable: true }); } catch(e) {}
})();
`;

test('chip switch diagnostic', async ({ page }) => {
  await page.addInitScript(MOCK_INIT_SCRIPT);
  await page.goto(BASE);
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem('agri-voicenote-settings-v3', JSON.stringify(s));
  }, SETTINGS_2COL);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(400);

  // Navigate to voice tab
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(200);

  const startBtn = page.locator('text=음성 입력 시작').first();
  await expect(startBtn).toBeVisible();

  // Start voice session
  await startBtn.click();
  await page.waitForTimeout(800);

  // Check active state
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
  console.log('✓ REC 표시 확인');

  // Check MockSTT
  const mockSttActive = await page.evaluate(() => !!(window as unknown as Record<string,unknown>).__mockSTT);
  console.log(`MockSTT 활성: ${mockSttActive ? '✓' : '✗'}`);

  // Check initial chip
  const initialBody = await page.evaluate(() => document.body.innerText);
  console.log(`초기 body 포함 '횡경': ${initialBody.includes('횡경')}`);

  // Check active chip marker
  const activeChipCount = await page.evaluate(() =>
    document.querySelectorAll('[data-testid="column-chip"][data-active="true"]').length
  );
  console.log(`활성 칩 개수: ${activeChipCount}`);

  // Get active chip details
  const chipDetails = await page.evaluate(() => {
    const chip = document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
    if (!chip) return 'no active chip found';
    return `active chip "${chip.dataset.colName ?? ''}" textContent: "${chip.textContent?.replace(/\s+/g, ' ').trim()}"`;
  });
  console.log(`칩 상세: ${chipDetails}`);

  // Check listeners before firing
  const listenerCheck = await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const stt = w.__mockSTT as { _ls?: Record<string, unknown[]> } | null;
    if (!stt) return 'null';
    return `listeners: result=${stt._ls?.['result']?.length ?? 0}, start=${stt._ls?.['start']?.length ?? 0}`;
  });
  console.log(`STT 리스너 상태: ${listenerCheck}`);

  // Wait longer for SpeechController to start
  await page.waitForTimeout(2000);

  const mockSttAfterWait = await page.evaluate(() => !!(window as unknown as Record<string,unknown>).__mockSTT);
  console.log(`2초 후 MockSTT 활성: ${mockSttAfterWait ? '✓' : '✗'}`);

  // Fire STT for 횡경
  console.log('\n--- fireStt("34.2") 발화 ---');
  await page.evaluate((t) => {
    const stt = (window as unknown as Record<string, {fireResult:(t:string,c:number)=>void}>).__mockSTT;
    if (stt) stt.fireResult(t, 0.95);
    else console.error('__mockSTT is null!');
  }, '34.2');

  // Immediately check state (before any timeout)
  const immediateBody = await page.evaluate(() => document.body.innerText);
  console.log(`즉시 체크 — body 포함 '34.2': ${immediateBody.includes('34.2')}`);

  // Wait for async operations to complete
  await page.waitForTimeout(500);

  // Check state after 500ms
  const bodyAfter = await page.evaluate(() => document.body.innerText);
  console.log(`500ms 후 — body 포함 '34.2': ${bodyAfter.includes('34.2')}`);
  console.log(`500ms 후 — body 포함 '종경 말씀': ${bodyAfter.includes('종경 말씀')}`);
  console.log(`500ms 후 — body 포함 '횡경 말씀': ${bodyAfter.includes('횡경 말씀')}`);

  const activeChipAfterCount = await page.evaluate(() =>
    document.querySelectorAll('[data-testid="column-chip"][data-active="true"]').length
  );
  console.log(`500ms 후 활성 칩 개수: ${activeChipAfterCount}`);

  const chipDetailsAfter = await page.evaluate(() => {
    const chip = document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
    if (!chip) return 'no active chip found';
    return `active chip "${chip.dataset.colName ?? ''}" textContent: "${chip.textContent?.replace(/\s+/g, ' ').trim()}"`;
  });
  console.log(`500ms 후 칩 상세: ${chipDetailsAfter}`);

  // Check awaitingField indirectly via lastTts
  const lastTts = await page.evaluate(() => {
    const ttsEl = document.querySelector('[data-testid="last-tts"]');
    if (ttsEl) return ttsEl.textContent;
    // Look for "말씀해 주세요" text
    const all = document.querySelectorAll('*');
    for (const el of Array.from(all)) {
      if (el.textContent?.includes('말씀해 주세요') && el.children.length === 0) {
        return el.textContent;
      }
    }
    return 'not found';
  });
  console.log(`lastTts: "${lastTts}"`);
});
