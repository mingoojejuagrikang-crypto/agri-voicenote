/**
 * v0.7.0 — persistSession이 세션 date를 **로컬 날짜**로 기록하는지 회귀.
 *
 * 버그(수정 전): useVoiceSession persistSession이 `new Date().toISOString().slice(0,10)`(UTC)로
 * date를 기록 — KST 00:00~08:59 세션은 어제 날짜가 박혀 조회 탭(ReviewScreen)의
 * localTodayISO() "오늘 세션" 매칭에서 사라졌다. 코드베이스 지배 규약은 로컬(autoValue.ts).
 *
 * 하네스: Playwright timezone 에뮬레이션(UTC+14 Pacific/Kiritimati) + clock.setFixedTime으로
 * "UTC 날짜 ≠ 로컬 날짜"인 시각을 결정적으로 고정한다(자정 mock 같은 Date 몽키패치 없음 —
 * 타이머는 실제로 흐른다). 고정 시각 2026-01-01T20:00:00Z → 로컬 2026-01-02 10:00.
 * 세션 한 행을 음성 커밋으로 완료시킨 뒤 IDB sessions의 date가 로컬(2026-01-02)인지 단언.
 * 수정 전 코드는 UTC(2026-01-01)를 기록해 이 테스트가 실패한다.
 *
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다(수동 기동 불필요, [ORCH-27])
 */
import { test, expect, type Page } from '@playwright/test';
import { BASE } from './baseUrl';

test.setTimeout(60_000);
test.use({ timezoneId: 'Pacific/Kiritimati' }); // UTC+14

const STORE_KEY = 'agri-voicenote-settings-v3';
// UTC 2026-01-01 20:00 = Kiritimati(UTC+14) 2026-01-02 10:00 — 날짜가 결정적으로 어긋난다.
const FIXED_TIME = '2026-01-01T20:00:00Z';
const LOCAL_DATE = '2026-01-02';
const UTC_DATE = '2026-01-01';

const SETTINGS = {
  state: {
    googleConnected: false,
    userEmail: null,
    sheet: null,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_TEST_1/edit',
    sheetTab: 'Sheet1',
    columnsSheetId: 'SHEET_TEST_1',
    columnsSheetTab: 'Sheet1',
    availableSheets: [],
    manualMode: false,
    columns: [
      { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 } },
      { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
      { id: 'c9', name: '종경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
    ],
    tableGenerated: true,
    totalRows: 5,
    ttsRate: 1.05,
    sessionLabelColId: null,
    sessionAutoLabel: 'local-date-test',
    noisyMode: false,
    preferredVoiceName: '',
  },
  version: 12,
};

// correction-flow / clip-modify-rerecord와 동일 계열의 STT·TTS·마이크 스텁(최소판).
const MOCK_INIT_SCRIPT = `
(function() {
  window.__micSettleSkipForTest = true; // F18 픽스처 우회 — 시작 시 1초 마이크 정착 생략(우회 심 오라클: v0440-c8-flow.spec.ts)
  var mockSynth = {
    speak: function(u) {
      try { if (u.onstart) u.onstart(new Event('start')); } catch(e) {}
      try { if (u.onend)   u.onend(new Event('end'));     } catch(e) {}
    },
    cancel: function() {}, pause: function() {}, resume: function() {},
    getVoices: function() {
      return [{ name: 'Mock Korean', lang: 'ko-KR', default: true, localService: true, voiceURI: 'mock' }];
    },
    speaking: false, pending: false, paused: false, onvoiceschanged: null,
    addEventListener: function() {}, removeEventListener: function() {},
    dispatchEvent: function() { return true; },
  };
  try {
    Object.defineProperty(window, 'speechSynthesis', {
      get: function() { return mockSynth; }, configurable: true, enumerable: true,
    });
  } catch(e1) { try { window.speechSynthesis = mockSynth; } catch(e3) {} }

  function MockSTT() {
    this._ls = {};
    this.continuous = true; this.interimResults = true;
    this.lang = 'ko-KR'; this.maxAlternatives = 3;
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
      results: { length: 1, 0: { isFinal: true, length: 1, 0: { transcript: transcript, confidence: confidence } } }
    };
    (this._ls['result'] || []).forEach(function(cb) { cb(event); });
  };
  try {
    Object.defineProperty(window, 'SpeechRecognition', { value: MockSTT, writable: true, configurable: true, enumerable: true });
  } catch(e1) { try { window.SpeechRecognition = MockSTT; } catch(e2) {} }
  try {
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: MockSTT, writable: true, configurable: true, enumerable: true });
  } catch(e) { try { window.webkitSpeechRecognition = MockSTT; } catch(e2) {} }

  try { window.AudioContext = undefined; } catch(e) {}
  try { window.webkitAudioContext = undefined; } catch(e) {}
  var fakeTrack = { label: 'stub-mic', getSettings: function() { return { deviceId: 'stub-mic' }; }, stop: function() {} };
  var fakeStream = { getAudioTracks: function() { return [fakeTrack]; }, getTracks: function() { return [fakeTrack]; } };
  if (!navigator.mediaDevices) { try { navigator.mediaDevices = {}; } catch(e) {} }
  try {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: function() { return Promise.resolve(fakeStream); }, writable: true, configurable: true,
    });
  } catch(e) {}
  function StubRecorder(stream, opts) {
    this.state = 'inactive';
    this.mimeType = (opts && opts.mimeType) || 'audio/webm';
    this.ondataavailable = null; this.onstop = null;
  }
  StubRecorder.isTypeSupported = function() { return true; };
  StubRecorder.prototype.start = function() { this.state = 'recording'; };
  StubRecorder.prototype.requestData = function() {};
  StubRecorder.prototype.stop = function() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    if (this.ondataavailable) {
      try { this.ondataavailable({ data: new Blob([new Uint8Array(8000)], { type: 'audio/webm' }) }); } catch(e) {}
    }
    if (this.onstop) { try { this.onstop(new Event('stop')); } catch(e) {} }
  };
  try {
    Object.defineProperty(window, 'MediaRecorder', { value: StubRecorder, writable: true, configurable: true });
  } catch(e) { try { window.MediaRecorder = StubRecorder; } catch(e2) {} }
})();
`;

async function fireStt(page: Page, transcript: string, waitMs = 600) {
  await page.evaluate((t) => {
    (window as unknown as { __mockSTT?: { fireResult: (t: string, c: number) => void } })
      .__mockSTT?.fireResult(t, 0.95);
  }, transcript);
  await page.waitForTimeout(waitMs);
}

test('persistSession은 UTC가 아닌 로컬 날짜를 session.date에 기록한다', async ({ page }) => {
  await page.clock.setFixedTime(new Date(FIXED_TIME));
  await page.addInitScript(MOCK_INIT_SCRIPT);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  // 하네스 자기검증: 에뮬레이션된 페이지에서 로컬 날짜와 UTC 날짜가 실제로 어긋나야
  // 이 테스트가 의미를 가진다(localTodayISO와 동일 포뮬러로 페이지 컨텍스트에서 계산).
  const dates = await page.evaluate(() => {
    const d = new Date();
    const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { local, utc: d.toISOString().slice(0, 10) };
  });
  expect(dates.local, '타임존 에뮬레이션 자기검증(로컬)').toBe(LOCAL_DATE);
  expect(dates.utc, '클럭 고정 자기검증(UTC)').toBe(UTC_DATE);

  await page.evaluate(
    ({ settings, storeKey }) => { localStorage.setItem(storeKey, JSON.stringify(settings)); },
    { settings: SETTINGS, storeKey: STORE_KEY },
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

  // 한 행 완료(c8, c9) → advance가 persistSession을 실행한다.
  await fireStt(page, '35.1', 800);
  await fireStt(page, '44.4', 1200);
  await page.waitForTimeout(1000); // fire-and-forget persist 정착

  const sessions = await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction('sessions', 'readonly');
    const all: unknown[] = await new Promise((resolve, reject) => {
      const req = tx.objectStore('sessions').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return all as Array<{ id: string; date: string }>;
  });

  expect(sessions.length).toBeGreaterThanOrEqual(1);
  const sess = sessions[sessions.length - 1];
  // 수정 전(UTC toISOString)은 2026-01-01을 기록해 여기서 실패한다.
  expect(sess.date, 'session.date는 로컬 날짜여야 한다(UTC면 KST 아침 세션이 조회 탭에서 사라짐)').toBe(LOCAL_DATE);
  expect(sess.date).not.toBe(UTC_DATE);
});
