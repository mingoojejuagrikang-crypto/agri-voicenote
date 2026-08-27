/**
 * v0.7.0 B5 — 클립 후반 0.5s post-roll e2e.
 *
 * Chromium fake media device(--use-fake-device-for-media-stream)로 실제 MediaRecorder 캡처를
 * 돌려 audioRecorder의 지연 정지를 검증한다. STT/TTS 주입은 correction-flow.spec.ts 패턴,
 * 단 TTS mock에 지연(ttsDelayMs)을 줄 수 있게 확장 — echo TTS가 post-roll(500ms)보다 길면
 * 다음 클립 시작 전에 post-roll이 온전히 끝난다(실기기 시나리오).
 *
 * 검증:
 *   1. echo TTS가 긴 경우(900ms): clip_duration 이벤트가 postrollMs≈500(400~1000 허용)을 동봉
 *      + clip_save_failed 없음 + clip_saved 존재
 *   2. echo TTS 즉시(0ms): 다음 필드 announceField의 startClip이 0.5s 안에 도착 → post-roll
 *      우아한 절단(postrollMs < 500), clip_save_failed 없이 클립 저장
 *
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다(수동 기동 불필요, [ORCH-27])
 */
import { test, expect, type Page } from '@playwright/test';
import { BASE } from './baseUrl';

test.setTimeout(120_000);
test.use({
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
});

const STORE_KEY = 'agri-voicenote-settings-v3';

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
      { id: 'c7', name: '조사과실', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 5 } },
      { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
      { id: 'c9', name: '종경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
    ],
    tableGenerated: true,
    totalRows: 10,
    ttsRate: 1.05,
    sessionLabelColId: null,
    sessionAutoLabel: 'postroll-test',
    noisyMode: false,
    preferredVoiceName: '',
  },
  version: 13,
};

/** correction-flow TTS/STT mock — TTS onend를 ttsDelayMs 뒤에 발화시킬 수 있게 확장.
 *  지연 TTS = echo가 post-roll보다 길어 지연 정지가 자연 완료되는 실기기 시나리오 재현. */
function mockScript(ttsDelayMs: number): string {
  return `
(function() {
  window.__micSettleSkipForTest = true; // F18 픽스처 우회 — 시작 시 1초 마이크 정착 생략(우회 심 오라클: v0440-c8-flow.spec.ts)
  window.__ttsLog = [];
  var TTS_DELAY = ${ttsDelayMs};

  var mockSynth = {
    speak: function(utterance) {
      window.__ttsLog.push(utterance.text);
      try { if (utterance.onstart) utterance.onstart(new Event('start')); } catch(e) {}
      if (TTS_DELAY > 0) {
        setTimeout(function() {
          try { if (utterance.onend) utterance.onend(new Event('end')); } catch(e) {}
        }, TTS_DELAY);
      } else {
        try { if (utterance.onend) utterance.onend(new Event('end')); } catch(e) {}
      }
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
  } catch(e1) { try { window.speechSynthesis = mockSynth; } catch(e3) {} }

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
}

async function setupAndStart(page: Page, ttsDelayMs: number) {
  await page.addInitScript(mockScript(ttsDelayMs));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ settings, storeKey }) => {
      localStorage.setItem(storeKey, JSON.stringify(settings));
    },
    { settings: SETTINGS, storeKey: STORE_KEY },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(200);

  const startBtn = page.locator('text=음성 입력 시작').first();
  await expect(startBtn).toBeVisible();
  await startBtn.click();
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 5000 });
  // recorder.init()(fake getUserMedia + 프리롤 그래프) 정착 — 첫 클립이 clip_no_stream으로
  // 비지 않게 시작 안내 TTS 구간 동안 기다린다.
  await page.waitForTimeout(1200);
}

async function fireStt(page: Page, transcript: string, waitMs: number) {
  await page.evaluate((t) => {
    (window as unknown as { __mockSTT?: { fireResult: (t: string, c: number) => void } })
      .__mockSTT?.fireResult(t, 0.95);
  }, transcript);
  await page.waitForTimeout(waitMs);
}

async function waitForActiveChip(page: Page, colName: string, timeout = 15000) {
  await page.waitForFunction(
    (name) => {
      const chip = document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
      return (chip?.dataset.colName ?? '').includes(String(name));
    },
    colName,
    { timeout },
  );
}

interface ClipEvent { extra?: string; postrollMs?: number; durationMs?: number }

async function getClipEvents(page: Page): Promise<ClipEvent[]> {
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
    return all.filter(
      (e) => typeof e.extra === 'string' &&
        (e.extra === 'clip_duration' || e.extra.startsWith('clip_saved') || e.extra.startsWith('clip_save_failed')),
    );
  });
}

test('post-roll 자연 완료 — 긴 echo TTS(900ms) 동안 clip_duration이 postrollMs≈500 동봉', async ({ page }) => {
  await setupAndStart(page, 900);

  // 횡경 값 커밋 → stopClip(지연 정지) → echo 900ms 동안 post-roll(500ms) 자연 완료.
  await waitForActiveChip(page, '횡경');
  await page.waitForTimeout(800); // 발화 구간(클립에 캡처될 시간) 확보
  await fireStt(page, '35.1', 2500); // echo(900ms) + post-roll(500ms) + 트림/저장 여유

  await waitForActiveChip(page, '종경');
  await page.waitForTimeout(1000); // fire-and-forget IDB 로깅 정착

  const events = await getClipEvents(page);
  const withPostroll = events.filter((e) => e.extra === 'clip_duration' && typeof e.postrollMs === 'number');
  expect(withPostroll.length).toBeGreaterThanOrEqual(1);
  // 자연 완료 케이스: 지연 정지 타이머(500ms) + 스케줄링 지터 허용.
  const full = withPostroll.find((e) => (e.postrollMs as number) >= 400);
  expect(full, `postrollMs≈500 클립이 없음: ${JSON.stringify(withPostroll)}`).toBeTruthy();
  expect((full!.postrollMs as number)).toBeLessThanOrEqual(1000);

  // post-roll 추가로 저장이 깨지지 않는다 — 실패 0, 저장 ≥1.
  expect(events.filter((e) => e.extra!.startsWith('clip_save_failed'))).toHaveLength(0);
  expect(events.filter((e) => e.extra!.startsWith('clip_saved')).length).toBeGreaterThanOrEqual(1);
});

test('post-roll 우아한 절단 — 즉시 echo(0ms) 후 다음 필드 startClip이 0.5s 내 도착 → postrollMs<500, 저장 실패 없음', async ({ page }) => {
  await setupAndStart(page, 0);

  // 횡경 커밋 → echo 즉시 → advance → 종경 announceField.startClip이 수십 ms 내 도착해
  // 이전 클립의 지연 정지 타이머를 절단(우아한 절단 경로).
  await waitForActiveChip(page, '횡경');
  await page.waitForTimeout(800);
  await fireStt(page, '35.1', 600);
  await waitForActiveChip(page, '종경');
  await page.waitForTimeout(800);
  await fireStt(page, '28.3', 1500); // 행 완료 — 두 번째 클립도 flush
  await page.waitForTimeout(1000);

  const events = await getClipEvents(page);
  const withPostroll = events.filter((e) => e.extra === 'clip_duration' && typeof e.postrollMs === 'number');
  expect(withPostroll.length).toBeGreaterThanOrEqual(1);
  // 절단 케이스: 다음 startClip이 500ms 전에 도착했으므로 실측 post-roll < 500.
  const truncated = withPostroll.find((e) => (e.postrollMs as number) < 500);
  expect(truncated, `절단(<500ms) 클립이 없음: ${JSON.stringify(withPostroll)}`).toBeTruthy();
  expect((truncated!.postrollMs as number)).toBeGreaterThanOrEqual(0);

  // 절단돼도 그 시점까지의 캡처로 정상 저장 — clip_save_failed 없음.
  expect(events.filter((e) => e.extra!.startsWith('clip_save_failed'))).toHaveLength(0);
  expect(events.filter((e) => e.extra!.startsWith('clip_saved')).length).toBeGreaterThanOrEqual(1);
});
