/**
 * v0.7.0 [CLIP-VAL-1] — 수정 재녹음 3중 결함 회귀.
 *
 * 06-11 v0.6.0 실기기 row8 c7: "수정" 재안내 후 발화("155.5")가 녹음되지 않았고(clip_empty),
 * unlink가 in-flight persistSession에 되덮여 이전 값(177.7) 음성이 새 값 셀의 재생버튼에 남았다.
 *
 * 검증:
 *   1. ① modify 재안내("수정" → isModify 분기) 후 재발화가 실제로 녹음된다 — clip_saved 재발생,
 *      clip_empty 0건.
 *   2. ① cancel 분기도 동일(수정→취소 체인 후 발화 녹음).
 *   3. ② 수정 재녹음이 빈 캡처로 끝나면 포인터가 `…:cmd<n>` 클립으로 재연결(clip_relink_cmd)되고,
 *      ③ 이후의 persistSession에서도 재연결 상태가 생존한다(tombstone 레이스 회귀).
 *   4. ② cmd 클립이 없으면 unlink — 이후 persist에 깨진 포인터가 부활하지 않는다(③).
 *
 * 하네스: correction-flow의 STT/TTS mock + getUserMedia/MediaRecorder 스텁.
 *   - window.__clipMode = 'ok' | 'empty' — stop() 시점에 읽어 'ok'면 8KB chunk를 내보내고
 *     'empty'면 아무것도 내보내지 않는다(빈 캡처 시뮬레이션).
 *   - AudioContext는 제거(undefined) — 프리롤/트림이 결정적으로 비활성(원본 blob 그대로 저장).
 *
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다(수동 기동 불필요, [ORCH-27])
 */
import { test, expect, type Page } from '@playwright/test';
import { BASE } from './baseUrl';

test.setTimeout(120_000);

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
    sessionAutoLabel: 'clip-rerecord-test',
    noisyMode: false,
    preferredVoiceName: '',
  },
  version: 13,
};

const MOCK_INIT_SCRIPT = `
(function() {
  window.__micSettleSkipForTest = true; // F18 픽스처 우회 — 시작 시 1초 마이크 정착 생략(우회 심 오라클: v0440-c8-flow.spec.ts)
  window.__ttsLog = [];
  window.__clipMode = 'ok';

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

  // ── 마이크/레코더 스텁 ──────────────────────────────────────
  // 프리롤·트림 경로 결정적 비활성: AudioContext 제거 → clip_preroll_unavailable + processClip
  // 원본 폴백(decode 시도 자체가 없음). 클립 바이트는 MediaRecorder 스텁이 공급한다.
  try { window.AudioContext = undefined; } catch(e) {}
  try { window.webkitAudioContext = undefined; } catch(e) {}

  var fakeTrack = {
    label: 'stub-mic',
    getSettings: function() { return { deviceId: 'stub-mic' }; },
    stop: function() {},
  };
  var fakeStream = {
    getAudioTracks: function() { return [fakeTrack]; },
    getTracks: function() { return [fakeTrack]; },
  };
  if (!navigator.mediaDevices) { try { navigator.mediaDevices = {}; } catch(e) {} }
  try {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: function() { return Promise.resolve(fakeStream); },
      writable: true, configurable: true,
    });
  } catch(e) {}

  function StubRecorder(stream, opts) {
    this.state = 'inactive';
    this.mimeType = (opts && opts.mimeType) || 'audio/webm';
    this.ondataavailable = null;
    this.onstop = null;
  }
  StubRecorder.isTypeSupported = function() { return true; };
  StubRecorder.prototype.start = function() { this.state = 'recording'; };
  StubRecorder.prototype.requestData = function() {};
  StubRecorder.prototype.stop = function() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    var mode = window.__clipMode || 'ok';
    if (mode === 'ok' && this.ondataavailable) {
      try {
        this.ondataavailable({ data: new Blob([new Uint8Array(8000)], { type: 'audio/webm' }) });
      } catch(e) {}
    }
    if (this.onstop) { try { this.onstop(new Event('stop')); } catch(e) {} }
  };
  try {
    Object.defineProperty(window, 'MediaRecorder', {
      value: StubRecorder, writable: true, configurable: true,
    });
  } catch(e) { try { window.MediaRecorder = StubRecorder; } catch(e2) {} }
})();
`;

// ─── Helpers ────────────────────────────────────────────────────

async function fireStt(page: Page, transcript: string, waitMs = 400) {
  await page.evaluate((t) => {
    (window as unknown as { __mockSTT?: { fireResult: (t: string, c: number) => void } })
      .__mockSTT?.fireResult(t, 0.95);
  }, transcript);
  await page.waitForTimeout(waitMs);
}

async function setClipMode(page: Page, mode: 'ok' | 'empty') {
  await page.evaluate((m) => { (window as unknown as { __clipMode: string }).__clipMode = m; }, mode);
}

async function waitForActiveChip(page: Page, colName: string, timeout = 6000) {
  await page.waitForFunction(
    (name) => {
      const chip = document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
      return (chip?.dataset.colName ?? '').includes(String(name));
    },
    colName,
    { timeout },
  );
}

async function waitForRow(page: Page, targetRow: number, timeout = 6000) {
  await page.waitForFunction(
    (r) => {
      const m = document.body.innerText.match(/(\d+)\s*\/\s*\d+\s*행/);
      return m && parseInt(m[1]) === r;
    },
    targetRow,
    { timeout },
  );
}

async function setupAndStart(page: Page) {
  await page.addInitScript(MOCK_INIT_SCRIPT);
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
  await page.waitForTimeout(600);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
}

interface LogEvt { type?: string; extra?: string; row?: number; colId?: string; clipKey?: string; kind?: string }

async function getClipLog(page: Page): Promise<LogEvt[]> {
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
    return all.filter((e) => typeof e.extra === 'string' && (
      e.extra === 'clip_empty' ||
      e.extra.startsWith('clip_too_small') ||
      e.extra.startsWith('clip_saved') ||
      e.extra === 'clip_relink_cmd' ||
      // [CLIP-CORRECTION-1] regression: command-clip preservation events (kind:'command') carry
      // the row/colId the '수정' utterance was ultimately filed under — used to assert it lands on
      // the correction TARGET column, not whatever column was awaiting when '수정' was said.
      e.extra === 'clip_preserved'
    ));
  });
}

async function getIdbSessions(page: Page) {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction('sessions', 'readonly');
    const sessions: unknown[] = await new Promise((resolve, reject) => {
      const req = tx.objectStore('sessions').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return sessions as Array<{
      id: string;
      rows: Array<{ index: number; values: Record<string, string>; audioClips?: Record<string, string> }>;
    }>;
  });
}

async function getClipDurations(page: Page): Promise<number[]> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!db.objectStoreNames.contains('logEvents')) { db.close(); return []; }
    const tx = db.transaction('logEvents', 'readonly');
    const all: Array<{ extra?: string; durationMs?: number }> = await new Promise((resolve, reject) => {
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return all
      .filter((e) => e.extra === 'clip_duration' && typeof e.durationMs === 'number')
      .map((e) => e.durationMs as number);
  });
}

// ─── Tests ──────────────────────────────────────────────────────

test('[CLIP-WINDOW-1] 개선요청 모달 대기 시간은 커밋 클립 녹음창에 포함되지 않는다', async ({ page }) => {
  await setupAndStart(page);
  await waitForActiveChip(page, '횡경');

  await page.locator('[data-testid="tab-feedback"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toBeVisible({ timeout: 6000 });

  const modalWaitMs = 3000;
  await page.waitForTimeout(modalWaitMs);
  await page.locator('[data-testid="feedback-cancel"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toBeHidden();

  // 닫힌 뒤 같은 셀의 새 녹음창에 값 발화를 커밋한다.
  await page.waitForTimeout(200);
  await fireStt(page, '35.1', 1400);
  await waitForActiveChip(page, '종경');

  const durations = await getClipDurations(page);
  expect(durations.length, `clip_duration 없음: ${JSON.stringify(durations)}`).toBeGreaterThanOrEqual(2);
  expect(
    Math.max(...durations),
    `모달 ${modalWaitMs}ms 대기가 녹음창에 포함됨: ${JSON.stringify(durations)}`,
  ).toBeLessThan(modalWaitMs - 500);

  const events = await getClipLog(page);
  expect(events.filter((e) => e.extra === 'clip_empty'), 'resume 후 값 클립이 비었음').toHaveLength(0);
  expect(
    events.some((e) => e.extra?.startsWith('clip_saved') && e.row === 1 && e.colId === 'c8'),
    'resume 후 같은 셀의 값 클립이 저장되지 않음',
  ).toBe(true);
});

test('① modify 재안내 후 재발화가 녹음된다 — 이중 수정("수정"→"수정 155.5") 체인 후 clip_saved, clip_empty 0건', async ({ page }) => {
  await setupAndStart(page);

  // 35.1 커밋 (c8 캐노니컬 클립 1회 저장)
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '35.1', 600);

  // 종경 안내 중 "수정" → c8 재녹음 모드(announceField가 클립 무장)
  await waitForActiveChip(page, '종경');
  await fireStt(page, '수정', 600);
  await waitForActiveChip(page, '횡경');

  // 재녹음 대기 중 "수정 155.5" → isModify 분기(06-11 실기기 evt 219 패턴).
  // 버그 시: 여기서 say()만 하고 클립을 재시작하지 않아 다음 발화가 결정적으로 미녹음.
  await fireStt(page, '수정 155.5', 600);

  // 재발화 → 커밋. 이 발화의 클립이 저장돼야 한다.
  await fireStt(page, '36.6', 800);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '44.4', 800);
  await waitForRow(page, 2);
  await page.waitForTimeout(1500); // 백그라운드 클립 저장 정착

  const events = await getClipLog(page);
  expect(events.filter((e) => e.extra === 'clip_empty'), 'clip_empty 발생').toHaveLength(0);
  expect(events.filter((e) => e.extra?.startsWith('clip_too_small'))).toHaveLength(0);
  const c8Saves = events.filter((e) => e.extra?.startsWith('clip_saved') && e.row === 1 && e.colId === 'c8');
  expect(c8Saves.length, '재녹음 클립이 저장되지 않음').toBeGreaterThanOrEqual(2);

  const sessions = await getIdbSessions(page);
  const row1 = sessions[sessions.length - 1].rows.find((r) => r.index === 1)!;
  expect(row1.values.c8).toBe('36.6');
});

test('① cancel 분기 — "수정"→"취소" 체인 후 재발화도 녹음된다', async ({ page }) => {
  await setupAndStart(page);

  await waitForActiveChip(page, '횡경');
  await fireStt(page, '35.1', 600);

  await waitForActiveChip(page, '종경');
  await fireStt(page, '수정', 600);
  await waitForActiveChip(page, '횡경');

  // 재녹음 대기 중 "수정 155.5"(슬롯 소비) → "취소"(같은 구조의 잠재 결함 분기) → 재발화
  await fireStt(page, '수정 155.5', 600);
  await fireStt(page, '취소', 600);
  await fireStt(page, '36.6', 800);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '44.4', 800);
  await waitForRow(page, 2);
  await page.waitForTimeout(1500);

  const events = await getClipLog(page);
  expect(events.filter((e) => e.extra === 'clip_empty')).toHaveLength(0);
  const c8Saves = events.filter((e) => e.extra?.startsWith('clip_saved') && e.row === 1 && e.colId === 'c8');
  expect(c8Saves.length).toBeGreaterThanOrEqual(2);

  const sessions = await getIdbSessions(page);
  const row1 = sessions[sessions.length - 1].rows.find((r) => r.index === 1)!;
  expect(row1.values.c8).toBe('36.6');
});

test('②③ 수정 재녹음 빈 캡처 → 포인터가 cmd 클립으로 재연결되고 이후 persist에서 생존한다', async ({ page }) => {
  await setupAndStart(page);

  // 35.1 커밋 → c8 캐노니컬 클립(이전 값 음성) 저장 — 결함 시 이 음성이 그대로 남는다.
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '35.1', 600);

  // 첫 "수정"(bare, cascade) — v0.28.0([CLIP-CORRECTION-1] 수정)부터 이 발화도 정정 대상(c8)에
  // 올바르게 저장돼 :cmd1을 소비한다(수정 전엔 대기 컬럼 c9로 오태깅돼 c8 카운터에 안 잡혔었다).
  await waitForActiveChip(page, '종경');
  await fireStt(page, '수정', 600);
  await waitForActiveChip(page, '횡경');

  // "수정 155.5" — 이 발화가 (1,c8):cmd2로 저장된다(새 값 발화를 담은 cmd 클립. 위 첫 "수정"이
  // 이제 cmd1을 정당하게 차지하므로 인덱스가 하나 밀린다).
  await fireStt(page, '수정 155.5', 600);

  // 재발화 캡처를 빈 캡처로 강제(06-11 row8 시나리오) → clip_empty → 재연결 경로.
  await setClipMode(page, 'empty');
  await fireStt(page, '155.5', 1800);
  await setClipMode(page, 'ok');

  // 이후 persistSession(행 완료)이 재연결 상태를 되덮지 않아야 한다(③ tombstone 회귀).
  await waitForActiveChip(page, '종경');
  await fireStt(page, '44.4', 800);
  await waitForRow(page, 2);
  await page.waitForTimeout(1500);

  const events = await getClipLog(page);
  expect(events.filter((e) => e.extra === 'clip_empty').length).toBeGreaterThanOrEqual(1);
  const relinks = events.filter((e) => e.extra === 'clip_relink_cmd' && e.row === 1 && e.colId === 'c8');
  expect(relinks.length, 'clip_relink_cmd 미발생').toBeGreaterThanOrEqual(1);

  const sessions = await getIdbSessions(page);
  const sess = sessions[sessions.length - 1];
  const row1 = sess.rows.find((r) => r.index === 1)!;
  expect(row1.values.c8).toBe('155.5');
  // 캐노니컬 키(이전 값 음성)가 아니라 cmd 클립을 가리켜야 한다 — 그리고 행 완료 persist 후에도 생존.
  // cmd2인 이유는 위 주석 참고(첫 bare "수정"이 이제 정당하게 cmd1을 차지).
  expect(row1.audioClips?.c8, '재연결 포인터가 persist에 덮임(레이스)').toBe(`${sess.id}:1:c8:cmd2`);
});

test('②③ cmd 클립도 못 잡히면(둘 다 빈 캡처) unlink — 이후 persist에 깨진 포인터가 부활하지 않는다', async ({ page }) => {
  await setupAndStart(page);

  await waitForActiveChip(page, '횡경');
  await fireStt(page, '35.1', 600);

  // "수정"만(인라인 값 없음) → cascade — v0.28.0([CLIP-CORRECTION-1] 수정)부터 cmd 클립은 정정
  // 대상 컬럼(c8)으로 올바르게 저장된다(아래 "[CLIP-CORRECTION-1]" 테스트 참고). 이 테스트는 그
  // cmd 클립 자체도 빈 캡처였던(발화가 안 잡힌) 진짜 "재연결 대상이 아예 없는" 경우를 검증한다 —
  // "수정" 발화 자체를 빈 캡처로 만들어 cmd 클립이 저장되지 않게 한다.
  await waitForActiveChip(page, '종경');
  await setClipMode(page, 'empty');
  await fireStt(page, '수정', 600);
  await waitForActiveChip(page, '횡경');

  await fireStt(page, '155.5', 1800);
  await setClipMode(page, 'ok');

  await waitForActiveChip(page, '종경');
  await fireStt(page, '44.4', 800);
  await waitForRow(page, 2);
  await page.waitForTimeout(1500);

  const events = await getClipLog(page);
  expect(events.filter((e) => e.extra === 'clip_empty').length).toBeGreaterThanOrEqual(1);
  expect(events.filter((e) => e.extra === 'clip_relink_cmd' && e.colId === 'c8')).toHaveLength(0);

  const sessions = await getIdbSessions(page);
  const sess = sessions[sessions.length - 1];
  const row1 = sess.rows.find((r) => r.index === 1)!;
  expect(row1.values.c8).toBe('155.5');
  // 빈 캡처의 캐노니컬 포인터는 unlink — in-flight persist가 부활시키면 안 된다([CLIP-3] 레이스).
  expect(row1.audioClips?.c8, '깨진 포인터가 persist에 부활(레이스)').toBeUndefined();
});

// ─── [CLIP-CORRECTION-1] — cascade 정정("수정"만 발화 → 새 값은 별도 발화) 시 명령 클립이
//     정정 대상 컬럼에 저장되는지 회귀 검증 (2026-07-06 Sonar 데스크탑 재현 QA, 근본원인 특정).
//
// 실기기 n=1 관측: "166.6 커밋 → 정정 발화(366.6)" 후 클립 감사에서 정정 발화 클립이 어디에도
// 없었다(정정 자체는 시트에 정상 반영). Sonar가 useVoiceSession.ts L754-756 cascade 경로로 코드
// 레벨 재현: direct-modify 경로("수정 <값>" 한 발화, L690)는 cmd 클립을 정정 대상 셀로 올바르게
// 재연결하지만, cascade 경로(L756, saveDefault())는 대신 "수정"이 발화된 시점에 **대기 중이던
// 다음 컬럼**의 키로 cmd 클립을 저장해 정정 대상 컬럼 기준으로는 "클립 없음"으로 보였다.
test('[CLIP-CORRECTION-1] cascade 정정 — 명령("수정") 클립이 대기 중이던 다음 컬럼이 아니라 정정 대상 컬럼에 저장된다', async ({ page }) => {
  await setupAndStart(page);

  // 횡경(c8) 커밋.
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '35.1', 600);

  // 종경(c9) 안내 중 "수정"만(인라인 값 미결합) → cascade. 정정 대상은 "이전 필드"인 c8(횡경) —
  // c9(종경, "수정"이 발화된 시점에 대기 중이던 다음 컬럼)가 아니다.
  await waitForActiveChip(page, '종경');
  await fireStt(page, '수정', 600);
  await waitForActiveChip(page, '횡경');

  // 새 값은 별도 발화로(cascade 재녹음 — direct-modify처럼 "수정 <값>" 한 발화로 합치지 않음).
  await fireStt(page, '36.6', 800);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '44.4', 800);
  await waitForRow(page, 2);
  await page.waitForTimeout(1500); // 백그라운드 cmd 클립 저장 정착

  const events = await getClipLog(page);
  const cmdEvents = events.filter(
    (e) => e.extra === 'clip_preserved' && e.kind === 'command' && e.row === 1,
  );
  expect(cmdEvents.length, '명령("수정") 클립 저장 이벤트가 없음').toBeGreaterThanOrEqual(1);
  // 정정 대상 컬럼(c8, 횡경)에 저장돼야 한다.
  expect(
    cmdEvents.every((e) => e.colId === 'c8'),
    `명령 클립이 정정 대상(c8)이 아닌 컬럼에 저장됨: ${JSON.stringify(cmdEvents)}`,
  ).toBe(true);
  // 회귀 방지: "수정"이 발화된 시점에 대기 중이던 다음 컬럼(c9, 종경)으로 오태깅되면 안 된다.
  expect(cmdEvents.some((e) => e.colId === 'c9'), '명령 클립이 엉뚱한 대기 컬럼(c9)에 오태깅됨').toBe(false);

  const sessions = await getIdbSessions(page);
  const row1 = sessions[sessions.length - 1].rows.find((r) => r.index === 1)!;
  expect(row1.values.c8).toBe('36.6'); // 정정 자체는 정상 커밋(회귀 아님 확인)
});
