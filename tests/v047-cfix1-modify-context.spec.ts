/**
 * v0.47.0 C-FIX1(리뷰 U2+U5, major) — **수정 문맥 수명** 오라클.
 *
 *  ⓐ 수정 재청취 중 일시정지→재개: 종전 resume()이 무옵션 announceField(cur)로 awaiting을
 *     kind:'value'로 덮고 modifyIndicator를 해제 — **성공 커밋 전인데 amber→green 오표시**
 *     (Codex 프로브 재현). 수정 문맥(isModify·previousValue)이 재개 후에도 보존돼야 한다.
 *  ⓑ 수정→이상치 알람→정정 확정: awaiting이 trendConfirm으로 승격돼 있어 종전 committed
 *     판정(kind='modify'만)이 안 서고 성공 후에도 착지까지 amber 잔존(Claude 지적).
 *     정정 확정 순간부터 green이어야 한다.
 *
 * 톤 단언 → GUM_GRANT 필수(mic_lost red 오염 방지 — v047-w2에서 실측한 함정).
 * ⓑ는 추세 규칙·직전값이 필요해 activeZones 픽스처 데이터(HEADERS·SHEET_ROWS·SETTINGS)로
 * 부트하고, 관측 창 동결은 mock TTS의 onend 지연(전 발화 800ms)으로 만든다 — 정정 echo가
 * __ttsLog에 등장한 순간(= 커밋 직후)에 톤을 1회 판독한다(폴링이면 old code도 착지 후
 * green이 되어 회귀 검출력이 없다).
 * ⚠️ 왕복 OFF([TEAMOPS-81]) — 두 픽스처 모두 chipSweepSeconds: 0.
 */

import { test, expect, type Page } from '@playwright/test';
import { BASE } from './baseUrl';
import { stubSheets, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { GUM_GRANT_SCRIPT } from './fixtures/gum';

test.setTimeout(120_000);

const STORE_KEY = 'agri-voicenote-settings-v3';
const PHONE_402 = { width: 402, height: 874 };

const TWO_COL_SETTINGS = {
  state: {
    chipSweepSeconds: 0, // 🔴 [TEAMOPS-81]
    googleConnected: false,
    userEmail: null,
    sheet: null,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_CFIX1/edit',
    sheetTab: 'Sheet1',
    columnsSheetId: 'SHEET_CFIX1',
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
    sessionAutoLabel: 'cfix1-modify-context',
    noisyMode: false,
    preferredVoiceName: '',
  },
  version: 12,
};

/** mock synth+STT. ⚠️ 전 발화 지연은 못 쓴다 — speak()가 muteForTts를 걸어 지연 동안 STT
 *  결과가 전부 삼켜진다(이 스펙 첫 구현에서 실측). `window.__ttsFreezeModifyEcho`가 서 있으면
 *  **수정 echo('수정 <값>' 꼴)만** onend를 1.2s 지연시켜 커밋 직후 관측 창을 동결한다
 *  (안내 '수정. <항목>.'은 마침표라 즉시 — 재청취 진입은 안 늦춘다). */
const MOCK_INIT_SCRIPT = `
(function() {
  window.__ttsLog = [];
  var mockSynth = {
    speak: function(u) {
      window.__ttsLog.push(u.text);
      var delay = (window.__ttsFreezeModifyEcho && u.text.indexOf('수정 ') === 0) ? 1200 : 0;
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

async function setupAndStart(page: Page, settings: unknown, opts?: { stubAzSheets?: boolean; freezeModifyEcho?: boolean }) {
  await page.setViewportSize(PHONE_402);
  if (opts?.stubAzSheets) await stubSheets(page); // ⓑ — 추세 직전값(100.0) 주입
  await page.addInitScript(GUM_GRANT_SCRIPT);
  if (opts?.freezeModifyEcho) {
    await page.addInitScript(() => { (window as unknown as { __ttsFreezeModifyEcho?: boolean }).__ttsFreezeModifyEcho = true; });
  }
  await page.addInitScript(MOCK_INIT_SCRIPT);
  await page.addInitScript(() => {
    (window as unknown as { __micSettleSkipForTest?: boolean }).__micSettleSkipForTest = true;
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ s, storeKey }) => {
      localStorage.clear();
      localStorage.setItem('gs10_google_token', JSON.stringify({
        access_token: 'test-token', expires_at: Date.now() + 3600_000, email: 'tester@example.com',
      }));
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
  await page.waitForTimeout(800);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 4000 });
}

test('C-FIX1ⓐ — 수정 재청취 중 일시정지→재개: 수정 문맥(amber·indicator·의미론) 보존', async ({ page }) => {
  await setupAndStart(page, TWO_COL_SETTINGS);

  // 당도 커밋 → 산도 대기 → bare "수정"으로 당도 재청취(amber).
  await fireStt(page, '33.3', 500);
  await fireStt(page, '수정', 600);
  await expect(page.locator('[data-testid="modify-indicator"]')).toBeVisible({ timeout: 4000 });
  await expect(page.locator('[data-voice-tone="amber"]')).toHaveCount(1);

  // 일시정지 → mono → 재시작.
  await fireStt(page, '일시정지', 600);
  await expect(page.locator('[data-voice-tone="mono"]')).toHaveCount(1);
  await fireStt(page, '재시작', 900);

  // 🔴 종전엔 여기서 indicator가 해제되고 green이 됐다(성공 커밋 전 오표시).
  await expect(page.locator('[data-testid="modify-indicator"]'), '재개 후 수정 표시 보존').toBeVisible({ timeout: 4000 });
  await expect(page.locator('[data-voice-tone="amber"]'), '재개 후 amber 보존(아직 미성공)').toHaveCount(1);

  // 새 값 발화 → 수정 의미론으로 커밋(에코 '수정 당도 44.4') + green 전환.
  await fireStt(page, '44.4', 700);
  await expect(page.locator('[data-testid="column-chip"][data-col-name="당도"]')).toContainText('44.4');
  const tts = await page.evaluate(() => (window as unknown as { __ttsLog: string[] }).__ttsLog);
  expect(tts.some((t) => t.startsWith('수정 당도 44.4')), '수정 의미론 에코(문맥 보존 증거)').toBe(true);
  await expect(page.locator('[data-voice-tone="green"]')).toHaveCount(1);
});

test('C-FIX1b-ⓒ 🔴 소수부 재질문 중 일시정지→재개: fractionWhole 보존 — "5"가 111.5로 합성된다', async ({ page }) => {
  // 2차 재검증(major): 1차 C-FIX1ⓐ가 kind·previousValue만 보존해 fractionWhole(정수부 문맥)이
  // 재개 재안내에서 유실됐다 — 조각 "5"가 전체값 5로 오커밋될 수 있다(값 추측 금지 계약이
  // 데이터 오염으로 규정하는 축). announceField fractionWhole 전달로가 처방.
  await setupAndStart(page, TWO_COL_SETTINGS);

  // 소수부 유실 발화 → 정수부(111) 유지 + 소수부 타깃 재질문.
  await fireStt(page, '111 점 에', 600);
  // 일시정지 → 재시작(재안내가 awaiting을 재구성하는 지점 — 종전엔 여기서 문맥이 사라졌다).
  await fireStt(page, '일시정지', 600);
  await expect(page.locator('[data-voice-tone="mono"]')).toHaveCount(1);
  await fireStt(page, '재시작', 900);

  // 조각 응답 "5" → 111.5 합성 커밋(종전: 전체값 5).
  await fireStt(page, '5', 700);
  await expect(page.locator('[data-testid="column-chip"][data-col-name="당도"]'), 'fractionWhole 보존 합성')
    .toContainText('111.5');
});

test('C-FIX1b-ⓓ 🔴 이상치 응답 대기(trendConfirm) 중 일시정지→재개: 확인 루프가 소멸하지 않는다', async ({ page }) => {
  // 같은 축 실측 확인: 터치 [일시정지]는 manualHold만 거부하고 trendConfirm은 통과한다.
  // 종전 resume은 무옵션 announceField(cur)로 alert를 지우고(clearAnomalyAlert) awaiting을
  // value로 덮어 — 미확인 이상치가 응답 없이 증발했다. 재개 후 팝업·응답 대기가 살아 있고
  // '확인'이 정상 해소(advance)돼야 한다.
  await setupAndStart(page, AZ_SETTINGS, { stubAzSheets: true });

  // 위반값 → 추세 알람(응답 대기).
  await fireStt(page, '120.5', 900);
  await expect(page.locator('[data-testid="anomaly-alert"]')).toBeVisible({ timeout: 6000 });

  // 터치 [일시정지] → 재시작. ⚠️ 톤은 red가 mono보다 우선(§C4 — anomalyPending 생존 중)이라
  // paused 판정은 톤이 아니라 paused-card(CenterStage에서 paused 분기가 알람보다 우선)로 한다.
  await page.locator('button[title="일시정지"]').first().click();
  await page.waitForTimeout(600);
  await expect(page.locator('[data-testid="paused-card"]')).toBeVisible({ timeout: 3000 });
  await fireStt(page, '재시작', 900);

  // 팝업 생존 + '확인' 응답이 확인 루프를 정상 해소(다음 필드로 전진).
  await expect(page.locator('[data-testid="anomaly-alert"]'), '재개 후 알람 팝업 생존').toBeVisible({ timeout: 4000 });
  await fireStt(page, '확인', 900);
  await expect(page.locator('[data-testid="anomaly-alert"]')).toHaveCount(0);
  await page.waitForFunction(
    () => (document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null)
      ?.dataset.colName === '측정항목02',
    { timeout: 5000 },
  );
});

test('C-FIX1ⓑ — 수정→이상치 알람→정정 확정: 확정 순간부터 green(amber 잔존 0)', async ({ page }) => {
  // activeZones 데이터(측정항목01 trendRule=increase · 직전 100.0) + 정정 echo만 1.2s 동결 —
  // 정정 echo가 발화되는 동안 톤을 판독할 관측 창을 만든다.
  await setupAndStart(page, AZ_SETTINGS, { stubAzSheets: true, freezeModifyEcho: true });

  // 측정항목01 정상 커밋(100.0 = 직전값 그대로, 알람 없음) → 측정항목02 대기.
  await fireStt(page, '100.0', 700);
  // bare "수정" → 측정항목01 재청취(amber).
  await fireStt(page, '수정', 700);
  await expect(page.locator('[data-testid="modify-indicator"]')).toBeVisible({ timeout: 6000 });
  await expect(page.locator('[data-voice-tone="amber"]')).toHaveCount(1);

  // 위반값 → 추세 알람(red · trendConfirm 응답 대기).
  await fireStt(page, '120.5', 900);
  await expect(page.locator('[data-testid="anomaly-alert"]')).toBeVisible({ timeout: 6000 });
  await expect(page.locator('[data-voice-tone="red"]')).toHaveCount(1);

  // 정정값(정상) → 확정. echo('수정 측정항목01 100.0')가 __ttsLog에 등장한 순간 = 커밋 직후 —
  // 그 시점 톤을 **1회 판독**한다(폴링이면 old code도 착지 후 green이라 검출력 0).
  await fireStt(page, '100.0', 150);
  await page.waitForFunction(
    () => (window as unknown as { __ttsLog?: string[] }).__ttsLog?.some((t) => t.startsWith('수정 측정항목01 100')),
    { timeout: 6000 },
  );
  const toneAtCommit = await page.evaluate(
    () => document.querySelector('[data-voice-tone]')?.getAttribute('data-voice-tone'),
  );
  expect(toneAtCommit, '정정 확정 순간부터 green(종전 amber 잔존)').toBe('green');
});
