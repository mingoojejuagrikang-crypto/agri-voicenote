/**
 * v0.47.0 W2(FB-C+FB-G①, 민구 08-08) — **수정 성공 = green + 화음 + 종단 해제** 오라클.
 *
 * 민구 확정 경계: "재청취 중 amber, 성공 순간부터 green".
 *
 * 무엇을 재나:
 *  ① 수정 **진입** = 중립 단음(`beep_play:kind=modify`) + amber(§C4 의미 보존 — v0440-c4-mono와 동축).
 *  ② 수정 **성공 커밋** = 커밋 화음(`beep_play:kind=commit`) + **green 전환**(톤 SSOT
 *     `data-voice-tone`) + ModifyIndicatorPill 성공 값이 green(rgb(57,255,20)).
 *     🔑 성공 국면은 echo TTS 동안만 살아 있으므로, mock synth가 **echo 발화(`수정 <값>` 꼴)만
 *     onend를 지연**시켜 관측 창을 동결한다(안내 "수정. <항목>."은 즉시 — 진입 국면은 안 늘린다).
 *  ③ 🔴 FB-G① — **마지막 행을 수정으로 마감**해도 amber 잔존 0: 종단 착지(end_reached)가
 *     modifyIndicator를 명시 해제한다. 종전엔 해제 유일 지점이 announceField라 완료 화면까지
 *     amber가 고착됐다(실기기 08-08).
 *
 * ⚠️ 왕복 OFF(`chipSweepSeconds: 0`) — [TEAMOPS-81] 규율. 하네스는 manual-input.spec.ts 계열.
 */

import { test, expect, type Page } from '@playwright/test';
import { BASE } from './baseUrl';
import { GUM_GRANT_SCRIPT } from './fixtures/gum';

test.setTimeout(120_000);

const STORE_KEY = 'agri-voicenote-settings-v3';

const settingsWith = (columns: unknown[], totalRows: number) => ({
  state: {
    chipSweepSeconds: 0, // 🔴 [TEAMOPS-81]
    googleConnected: false,
    userEmail: null,
    sheet: null,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_TEST_W2/edit',
    sheetTab: 'Sheet1',
    columnsSheetId: 'SHEET_TEST_W2',
    columnsSheetTab: 'Sheet1',
    availableSheets: [],
    manualMode: false,
    columns,
    tableGenerated: true,
    totalRows,
    ttsRate: 1.05,
    sessionLabelColId: null,
    sessionAutoLabel: 'w2-modify-green',
    noisyMode: false,
    preferredVoiceName: '',
  },
  version: 12,
});

const TWO_COL = [
  { id: 'c6', name: '조사나무', type: 'int',   input: 'auto',  ttsAnnounce: true,  auto: { kind: 'seq', from: 1, to: 3 } },
  { id: 'c8', name: '횡경',     type: 'float', input: 'voice', ttsAnnounce: true,  auto: { kind: 'fixed', value: '' }, decimals: 1 },
  { id: 'c9', name: '종경',     type: 'float', input: 'voice', ttsAnnounce: true,  auto: { kind: 'fixed', value: '' }, decimals: 1 },
];
const ONE_COL = [
  { id: 'c6', name: '조사나무', type: 'int',   input: 'auto',  ttsAnnounce: true,  auto: { kind: 'seq', from: 1, to: 1 } },
  { id: 'c8', name: '횡경',     type: 'float', input: 'voice', ttsAnnounce: true,  auto: { kind: 'fixed', value: '' }, decimals: 1 },
];

/** mock synth — `수정 <값>` 꼴(수정 성공 echo)만 onend를 지연시켜 성공 국면(green)을 동결한다.
 *  안내 "수정. <항목>."(진입)은 마침표라 즉시 경로다. 지연 1.2s < TTS 워치독 2.5s. */
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

async function setupAndStart(page: Page, settings: unknown) {
  // 🔴 이 스펙은 톤(data-voice-tone)을 단언한다 — gUM 기본 거부의 mic_lost 래치가 red를
  //   고정하면 amber/green 축이 전부 오염된다(v0.44.1 [CLIP-INIT-SILENT-1]). 정상 마이크 전제.
  await page.addInitScript(GUM_GRANT_SCRIPT);
  await page.addInitScript(MOCK_INIT_SCRIPT);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ s, storeKey }) => {
      localStorage.clear();
      localStorage.setItem(storeKey, JSON.stringify(s));
      indexedDB.deleteDatabase('agri-voicenote');
    },
    { s: settings, storeKey: STORE_KEY },
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

test('W2-①② 수정 진입=중립음+amber → 성공 커밋=화음+green(톤·필 동시)', async ({ page }) => {
  await setupAndStart(page, settingsWith(TWO_COL, 3));
  await waitForActiveChip(page, '횡경');

  // 정상 커밋으로 종경까지 진행(수정 대상 만들기).
  await fireStt(page, '33.3', 500);
  await waitForActiveChip(page, '종경');

  // ── ① 진입: bare "수정" → 직전 컬럼(횡경) 재청취. amber + 중립 단음 1회. ──
  await fireStt(page, '수정', 600);
  await expect(page.locator('[data-testid="modify-indicator"]')).toBeVisible({ timeout: 4000 });
  await expect(page.locator('[data-voice-tone="amber"]')).toHaveCount(1);
  let events = await loadLogEventsFromIDB(page);
  expect(countBeeps(events, 'modify'), '진입 중립 단음(신설)').toBe(1);
  const commitBeepsBefore = countBeeps(events, 'commit'); // 33.3 정상 커밋분

  // ── ② 성공: 새 값 발화 → echo(지연 1.2s) 동안 green 국면 동결 관측. ──
  await fireStt(page, '44.4', 250);
  // 성공 국면: 인디케이터가 아직 서 있는 채 톤이 green이다(amber 아님).
  await page.waitForFunction(() => {
    const pill = document.querySelector('[data-testid="modify-indicator"]');
    const green = document.querySelector('[data-voice-tone="green"]');
    return !!pill && !!green;
  }, { timeout: 3000 });
  // 성공 값 표기도 green(rgb(57,255,20)) — 종전 amber(255,234,0)가 아니다.
  const valueColor = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="modify-value"]');
    return el ? getComputedStyle(el).color : null;
  });
  expect(valueColor, '성공 값 green').toBe('rgb(57, 255, 20)');
  // 성공 화음: kind=commit +1 (중립 단음은 진입 1회 그대로).
  events = await loadLogEventsFromIDB(page);
  expect(countBeeps(events, 'commit'), '수정 성공 = 커밋 화음').toBe(commitBeepsBefore + 1);
  expect(countBeeps(events, 'modify'), '성공 시 중립 단음 재발화 없음').toBe(1);

  // 에코 종료 후: 다음 안내(종경)로 넘어가며 인디케이터 해제, green 유지.
  await waitForActiveChip(page, '종경', 6000);
  await expect(page.locator('[data-testid="modify-indicator"]')).toHaveCount(0);
  await expect(page.locator('[data-voice-tone="green"]')).toHaveCount(1);
});

test('W2-③ 🔴 FB-G① — 마지막 행을 수정으로 마감해도 완료 화면 amber 잔존 0', async ({ page }) => {
  await setupAndStart(page, settingsWith(ONE_COL, 1));
  await waitForActiveChip(page, '횡경');

  // 마지막(유일) 행 커밋 → 끝 도달 안내.
  await fireStt(page, '33.3', 800);
  await page.waitForFunction(
    // v0.49 r2 W2 — 끝 도달 안내 문구가 "마지막행 입력…"으로 통합됐다(확정표 #5+6).
    () => document.body.innerText.includes('마지막행 입력') || !!document.querySelector('[data-testid="complete-summary"]'),
    { timeout: 5000 },
  ).catch(() => { /* 안내 문구 비의존 — 아래 상태 단언이 본축 */ });

  // atEnd에서 "수정" → 마지막 컬럼 재청취(amber).
  await fireStt(page, '수정', 600);
  await expect(page.locator('[data-testid="modify-indicator"]')).toBeVisible({ timeout: 4000 });
  await expect(page.locator('[data-voice-tone="amber"]')).toHaveCount(1);

  // 수정 성공 → 재차 끝 도달. 🔴 종전엔 여기서 amber가 완료 화면까지 고착됐다(FB-G①).
  await fireStt(page, '44.4', 500);
  // echo 지연(1.2s) + 끝 도달 재안내까지 대기 후, 종단 상태 단언.
  await page.waitForFunction(() => !document.querySelector('[data-testid="modify-indicator"]'), { timeout: 8000 });
  await expect(page.locator('[data-voice-tone="amber"]')).toHaveCount(0);
  await expect(page.locator('[data-voice-tone="green"]')).toHaveCount(1);

  // 값은 수정본으로 서 있다.
  await expect(page.locator('[data-testid="column-chip"][data-col-name="횡경"]')).toContainText('44.4');
});
