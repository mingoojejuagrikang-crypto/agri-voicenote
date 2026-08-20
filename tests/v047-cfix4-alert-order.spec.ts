/**
 * v0.47.0 C-FIX4(리뷰 U9, minor) — **정보성 이상치 알람이 값 에코 뒤로 밀리지 않는다** 오라클.
 *
 * 종전(W1): 비-awaiting 수동 커밋의 값 에코를 `await`한 뒤에야 fireManualAlert가 불려,
 * 정보성 이상치의 팝업·트릴·알람 TTS가 에코 종료까지 지연됐다. 처방: violation이면 에코를
 * 생략한다 — ⚠️ alertText는 **변화량/편차만** 발화한다(커밋값은 next로 팝업에 **표시**될 뿐,
 * 발화되지 않는다 — anomalyAlarmLabel 실측). 에코 생략이 안전한 근거는 「수동 커밋 = 화면 앞
 * 조작 + 팝업이 값을 표시」라 시각 확인이 이미 있다는 것이다(이중 발화 논리 아님 — 2차 재검증
 * 정정). 커밋 화음은 유지(저장됨≠이상함 — 별개 신호).
 *
 * 데이터: activeZones 픽스처(측정항목01 trendRule=increase · 직전 100.0 — stubSheets).
 * ⚠️ 왕복 OFF는 AZ_SETTINGS가 이미 보장([TEAMOPS-81]).
 */

import { test, expect, type Page } from '@playwright/test';
import { GUM_GRANT_SCRIPT } from './fixtures/gum';
import { BASE } from './baseUrl';
import { stubSheets, SETTINGS as AZ_SETTINGS, STORE_KEY, PHONE_402 } from './fixtures/activeZones';

test.setTimeout(120_000);

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

test('C-FIX4 — 비-awaiting 위반 수동 커밋: 알람 즉시(팝업·트릴·알람TTS) + 값 단독 에코 없음 + 화음·흐름 유지', async ({ page }) => {
  await page.setViewportSize(PHONE_402);
  await stubSheets(page); // 측정항목01 직전값 100.0 주입(추세 위반 재료)
  // [TEST-GUM-1] — gUM 스텁이 없으면 `start()`의 마이크 획득이 로컬 헤드리스에서 응답하지 않아
  //   세션 시작 자체가 막힌다(제품 회귀 아님). 이 spec들의 계약은 마이크 상태와 무관하다.
  await page.addInitScript({ content: GUM_GRANT_SCRIPT });
  await page.addInitScript(MOCK_INIT_SCRIPT);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ settings, storeKey }) => {
      localStorage.clear();
      localStorage.setItem('gs10_google_token', JSON.stringify({
        access_token: 'test-token', expires_at: Date.now() + 3600_000, email: 'tester@example.com',
      }));
      localStorage.setItem(storeKey, JSON.stringify(settings));
      indexedDB.deleteDatabase('agri-voicenote');
    },
    { settings: AZ_SETTINGS, storeKey: STORE_KEY },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(200);
  await page.locator('text=음성 입력 시작').first().click();
  await page.waitForTimeout(800);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 4000 });

  // 측정항목01 정상 커밋(100.0) → 측정항목02 대기.
  await fireStt(page, '100.0', 700);

  // 비-awaiting 덮어쓰기: 측정항목01 칩 시트로 위반값 120.5 커밋(increase 위반 → 정보성 알람).
  await page.locator('[data-testid="column-chip"][data-col-name="측정항목01"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible({ timeout: 3000 });
  for (const k of ['1', '2', '0', '.', '5']) await page.locator(`[data-testid="manual-key-${k}"]`).click();
  await page.locator('[data-testid="manual-commit"]').click();

  // 알람 즉시 — 시트 닫힘 직후 팝업이 선다(종전엔 값 에코 await 뒤에야 떴다).
  await expect(page.locator('[data-testid="anomaly-alert"]')).toBeVisible({ timeout: 3000 });
  await page.waitForTimeout(400);

  const tts = await page.evaluate(() => (window as unknown as { __ttsLog: string[] }).__ttsLog);
  // 값 단독 에코 금지 — 수동 커밋은 화면 앞 조작이고 팝업이 직전→현재 값을 보여준다(근거는
  // useVoiceSession C-FIX4 주석). ⚠️ alertText는 값이 아니라 변화량('추세 알람 증가 : 20.5')을
  // 말한다 — 값 포함 단언은 틀린 가정이라 두지 않는다(첫 구현에서 실측).
  expect(tts.filter((t) => t.trim() === '120.5').length, '값 단독 에코 없음').toBe(0);
  // 알람 TTS는 발화됐다(팝업 헤드라인과 글자 동일 계약 — anomalyAlarmLabel).
  expect(tts.some((t) => t.includes('알람')), '알람 TTS 발화').toBe(true);

  // 커밋 화음은 유지(음성 100.0 + 수동 120.5 = 2) + 경고 트릴 1 — 별개 신호.
  const events = await loadLogEventsFromIDB(page);
  const beeps = (kind: string) =>
    events.filter((e) => e.type === 'app' && (e.extra ?? '').startsWith(`beep_play:kind=${kind}`)).length;
  expect(beeps('commit'), '커밋 화음 유지').toBe(2);
  expect(beeps('alert'), '경고 트릴').toBe(1);

  // 흐름 불변 — 활성 칩은 여전히 측정항목02.
  const active = await page.evaluate(
    () => (document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null)?.dataset.colName,
  );
  expect(active, '흐름 불변(비-awaiting)').toBe('측정항목02');
});
