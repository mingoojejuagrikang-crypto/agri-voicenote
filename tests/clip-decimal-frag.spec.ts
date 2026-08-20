/**
 * v0.16.0 [CLIP-DECIMAL-FRAG-1] — 소수 재질문 후 조각 발화 시 원본 전체값 클립 유실 회귀.
 *
 * 실기기(2026-06-22 v0.15.0, 4/4 결정적): STT가 소수부를 조사로 오인식(decimal_fraction_lost) →
 * "N 점, 소수점 아래 숫자만 말씀해 주세요" 재질문 → 사용자가 소수 한 자리("구")만 발화 → 커밋된
 * 캐노니컬 클립에 조각만 담기고 원본 전체발화("이십구 점 부")가 사라졌다. 원인: 모든
 * stt_parse_failed 재질문 직전의 무조건 startClip()이 원본 슬롯을 폐기.
 *
 * 수정(v0.16.0): decimal_fraction_lost 분기에서만 startClip()을 생략 → 활성 슬롯이 재질문 TTS·조각
 * 발화를 거쳐 계속 녹음하다가 commit 지점 stopClip()에서 단일 연속 녹음으로 stop. audioTrim의
 * findSpeechSegments/concatRanges(CLIP-BLANK-1 경로)가 원본·조각을 이어붙여 전체값을 보존한다.
 *
 * ── 이 하네스가 검증할 수 있는 것(로직-검증) ──
 *  - 제어 흐름: 소수 재질문에서 새 clip_started가 발생하지 않는다(버그=재시작으로 1건 추가). 무력화
 *    (startClip 복원) 시 clip_started 카운트가 늘고 clip_decimal_kept가 사라져 실패한다.
 *  - clip_decimal_kept 계측 이벤트가 정확히 소수 재질문 시 1건 발생한다.
 *  - 값(합성 299.9)·진행은 그대로 커밋된다(기능 무회귀).
 *
 * ── 이 하네스가 검증할 수 *없는* 것(실기기-검증 대기) ──
 *  - 저장 webm이 실제로 원본+조각 두 발화를 담는지는 byte-level 검증 불가: MediaRecorder 스텁이
 *    매번 동일한 8KB 블롭을 내보내고 AudioContext가 제거돼(트림/concat 결정적 비활성) "원본 보존"과
 *    "조각만"이 같은 8KB라 구분되지 않는다. concat 로직 자체는 audioTrim.spec.ts(decimal-frag 케이스)
 *    가 합성 PCM으로 검증한다. iOS Safari에서 단일 연속 녹음이 두 발화를 모두 담아 디코드되는지는
 *    실기기 로그(clip_decimal_kept + clip_duration + whisper 전사)에서만 최종 확인 가능.
 *
 * 하네스: clip-modify-rerecord.spec.ts의 STT/TTS + getUserMedia/MediaRecorder 스텁을 그대로 차용.
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다(수동 기동 불필요, [ORCH-27])
 */
import { test, expect, type Page } from '@playwright/test';
import { BASE } from './baseUrl';
// v0.49 r5 Z9 — 재질문 TTS 정본(W2가 꼬리를 삭제한 뒤의 문구). 리터럴 복제 금지.
import { REASK_TTS } from '../src/lib/voicePrompts';

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
    sessionAutoLabel: 'clip-decimal-frag-test',
    noisyMode: false,
    preferredVoiceName: '',
  },
  version: 12,
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
    cancel: function() {}, pause: function() {}, resume: function() {},
    getVoices: function() { return [{ name: 'Mock Korean', lang: 'ko-KR', default: true, localService: true, voiceURI: 'mock' }]; },
    speaking: false, pending: false, paused: false, onvoiceschanged: null,
    addEventListener: function() {}, removeEventListener: function() {}, dispatchEvent: function() { return true; },
  };
  try {
    Object.defineProperty(window, 'speechSynthesis', { get: function() { return mockSynth; }, configurable: true, enumerable: true });
  } catch(e1) { try { window.speechSynthesis = mockSynth; } catch(e3) {} }

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
  try { Object.defineProperty(window, 'SpeechRecognition', { value: MockSTT, writable: true, configurable: true, enumerable: true }); }
  catch(e1) { try { window.SpeechRecognition = MockSTT; } catch(e2) {} }
  try { Object.defineProperty(window, 'webkitSpeechRecognition', { value: MockSTT, writable: true, configurable: true, enumerable: true }); }
  catch(e) { try { window.webkitSpeechRecognition = MockSTT; } catch(e2) {} }

  // 프리롤·트림 경로 결정적 비활성: AudioContext 제거 → processClip 원본 폴백. 클립 바이트는
  // MediaRecorder 스텁이 매번 동일 8KB로 공급(byte-level concat 검증 불가 — 위 헤더 주석 참조).
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
    var mode = window.__clipMode || 'ok';
    if (mode === 'ok' && this.ondataavailable) {
      try { this.ondataavailable({ data: new Blob([new Uint8Array(8000)], { type: 'audio/webm' }) }); } catch(e) {}
    }
    if (this.onstop) { try { this.onstop(new Event('stop')); } catch(e) {} }
  };
  try { Object.defineProperty(window, 'MediaRecorder', { value: StubRecorder, writable: true, configurable: true }); }
  catch(e) { try { window.MediaRecorder = StubRecorder; } catch(e2) {} }
})();
`;

// ─── Helpers ────────────────────────────────────────────────────

/** v0.49 r4 M3 — `confidence` 인자 추가(기본 0.95 = 종전 동작 불변). 저신뢰 거절 분기도
 *  [CLIP-DECIMAL-FRAG-1]의 대상이라 이 하네스에서 유도할 수 있어야 한다. */
async function fireStt(page: Page, transcript: string, waitMs = 400, confidence = 0.95) {
  await page.evaluate(({ t, c }) => {
    (window as unknown as { __mockSTT?: { fireResult: (t: string, c: number) => void } })
      .__mockSTT?.fireResult(t, c);
  }, { t: transcript, c: confidence });
  await page.waitForTimeout(waitMs);
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

async function ttsLog(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __ttsLog?: string[] }).__ttsLog || []);
}

interface LogEvt { type?: string; extra?: string; row?: number; colId?: string }

async function getClipLog(page: Page): Promise<LogEvt[]> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!db.objectStoreNames.contains('logEvents')) { db.close(); return []; }
    const tx = db.transaction('logEvents', 'readonly');
    const all: LogEvt[] = await new Promise((resolve, reject) => {
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return all;
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

async function setupAndStart(page: Page) {
  await page.addInitScript(MOCK_INIT_SCRIPT);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
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
  await waitForActiveChip(page, '횡경');
}

// ─── Tests ──────────────────────────────────────────────────────

test('소수 재질문은 클립을 재시작하지 않는다 — 원본 슬롯 보존(clip_decimal_kept, 추가 clip_started 0)', async ({ page }) => {
  await setupAndStart(page);

  // 원본 전체발화가 소수부 유실로 오전사("29 점 부") → decimal_fraction_lost 타깃 재질문.
  // 이 시점까지의 clip_started 카운트를 기준선으로 잡는다(c8 announce가 시작한 슬롯 1건).
  const beforeReask = await getClipLog(page);
  const startedBefore = beforeReask.filter((e) => e.extra?.startsWith('clip_started')).length;

  await fireStt(page, '29 점 부', 600);

  // 타깃 재질문 TTS(정수부 유지)가 떠야 한다.
  const log1 = await ttsLog(page);
  const reask = log1.find((t) => t.includes('소수점 아래'));
  expect(reask, `타깃 재질문 TTS 없음. ttsLog=${JSON.stringify(log1)}`).toBeTruthy();
  expect(reask).toContain('29');
  // 아직 커밋 안 됨 — 횡경에 머문다.
  await waitForActiveChip(page, '횡경');

  // 핵심 회귀: 재질문 직전 startClip()이 생략됐어야 한다(원본 슬롯 보존).
  const afterReask = await getClipLog(page);
  const startedAfter = afterReask.filter((e) => e.extra?.startsWith('clip_started')).length;
  expect(
    startedAfter - startedBefore,
    '소수 재질문에서 새 clip_started 발생 = 원본 슬롯 폐기(버그 재발/무력화)',
  ).toBe(0);
  // 계측 이벤트가 정확히 1건 떠야 한다.
  const kept = afterReask.filter((e) => e.extra === 'clip_decimal_kept' && e.row === 1 && e.colId === 'c8');
  expect(kept.length, 'clip_decimal_kept 미발생 = 분기 미진입/무력화').toBe(1);

  // 조각 한 자리 → 정수부와 합성(29.9) 후 진행. 이 commit에서 비로소 stopClip → 단일 연속 녹음 저장.
  await fireStt(page, '구', 600);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '22.2', 800);
  await page.waitForTimeout(1500);

  // 값(합성)·진행 무회귀.
  const sessions = await getIdbSessions(page);
  const row1 = sessions[sessions.length - 1].rows.find((r) => r.index === 1)!;
  expect(row1.values.c8).toBe('29.9'); // 추측이 아닌 사용자가 말한 조각 9 합성
  expect(row1.values.c9).toBe('22.2');
  // c8 클립 포인터가 캐노니컬 키에 살아있다(commit에서 stopClip 후 저장).
  expect(row1.audioClips?.c8).toBeTruthy();
});

test('소수 재질문 후 전체값 재발화("29.9")도 정상 — clip_decimal_kept 1건, 추가 clip_started 0', async ({ page }) => {
  await setupAndStart(page);

  const before = (await getClipLog(page)).filter((e) => e.extra?.startsWith('clip_started')).length;

  await fireStt(page, '29 점 부', 600);
  await waitForActiveChip(page, '횡경'); // 재질문 중

  const mid = await getClipLog(page);
  expect(mid.filter((e) => e.extra?.startsWith('clip_started')).length - before).toBe(0);
  expect(mid.filter((e) => e.extra === 'clip_decimal_kept').length).toBe(1);

  // 사용자가 전체를 다시 말함 → 합성하지 않고 그대로 커밋(보존된 원본 슬롯에 이어 녹음).
  await fireStt(page, '29.9', 600);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '22.2', 800);
  await page.waitForTimeout(1500);

  const sessions = await getIdbSessions(page);
  const row1 = sessions[sessions.length - 1].rows.find((r) => r.index === 1)!;
  expect(row1.values.c8).toBe('29.9');
});

/**
 * 🔴 v0.49 r5 Z6(claude #6) — **`'취소'`도 이 계약의 소비자다.**
 *
 * 이 파일이 지키던 것은 *거절* 경로의 클립 규율이었는데, 소수 재질문 중에 들어오는 **접수된
 * 명령**(`'취소'`)이 무조건 `armClipForCell`로 슬롯을 재시작해 같은 버퍼를 폐기하고 있었다.
 * 「누가 슬롯을 만지는가」는 거절/명령의 구분과 무관하다 — 문맥이 정한다.
 *
 * 클립 축을 여기 두는 이유: `[CLIP-DECIMAL-FRAG-1]`의 계측 하네스(MediaRecorder 스텁)를
 * 이 파일이 소유한다. 같은 수정의 **표면 축**(화면·TTS 일치)은 `v049-r5-z6-relisten-context`에 있다.
 */
test('Z6 — 소수 재질문 중 「취소」는 클립을 재시작하지 않는다(접수된 명령도 같은 계약)', async ({ page }) => {
  await setupAndStart(page);

  await fireStt(page, '29 점 부', 600); // decimal_fraction_lost → 정수부 29 보존 타깃 재질문
  expect((await ttsLog(page)).find((t) => t.includes('소수점 아래')), '전제: 소수 문맥이 섰다').toBeTruthy();
  const before = (await getClipLog(page)).filter((e) => e.extra?.startsWith('clip_started')).length;

  await fireStt(page, '취소', 700);

  expect(
    (await getClipLog(page)).filter((e) => e.extra?.startsWith('clip_started')).length - before,
    '소수 재질문 중 「취소」가 슬롯을 재시작했다 — 원본 전체발화 버퍼가 폐기돼 조각만 남는다',
  ).toBe(0);
  // 문맥은 살아 있다 — 이어지는 조각이 그대로 합성된다(취소가 문맥을 버리지 않았다).
  await fireStt(page, '구', 700);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '22.2', 800);
  await page.waitForTimeout(1500);
  const row1 = (await getIdbSessions(page)).at(-1)!.rows.find((r) => r.index === 1)!;
  expect(row1.values.c8, '취소가 소수 문맥을 끊어 조각이 전체값이 됐다').toBe('29.9');
});

test('Z6 대조군 — 소수 문맥이 아닌 「취소」는 종전대로 슬롯을 재무장한다([CLIP-VAL-1]①)', async ({ page }) => {
  await setupAndStart(page);
  const before = (await getClipLog(page)).filter((e) => e.extra?.startsWith('clip_started')).length;

  await fireStt(page, '취소', 700); // 일반 값 대기에서의 취소

  expect(
    (await getClipLog(page)).filter((e) => e.extra?.startsWith('clip_started')).length - before,
    '일반 취소가 슬롯을 재무장하지 않으면 재발화가 **결정적으로** 녹음되지 않는다(say는 클립을 안 연다)',
  ).toBeGreaterThanOrEqual(1);
  expect(await ttsLog(page), '일반 재청취 문구가 아니다').toContain('횡경 다시 말씀해 주세요.');
});

test('비-소수 재질문(미파싱)은 여전히 클립을 재시작한다 — 전체 재발화 분기 무회귀', async ({ page }) => {
  await setupAndStart(page);

  const before = (await getClipLog(page)).filter((e) => e.extra?.startsWith('clip_started')).length;

  // 소수점 없는 파싱 실패("뮤직" 류 비숫자) → 일반 재질문("횡경 다시...") → startClip 재시작이 옳다.
  await fireStt(page, '뮤직', 600);
  await waitForActiveChip(page, '횡경');

  const after = await getClipLog(page);
  // 일반 재질문 분기는 startClip()을 유지 → clip_started가 늘어야 한다(소수 분기와 분리됐다는 증거).
  expect(
    after.filter((e) => e.extra?.startsWith('clip_started')).length - before,
    '일반 재질문이 클립을 재시작하지 않음 = 분기 분리 실패',
  ).toBeGreaterThanOrEqual(1);
  // 소수 분기 계측은 떠선 안 된다.
  expect(after.filter((e) => e.extra === 'clip_decimal_kept')).toHaveLength(0);
  // 🔴 v0.49 r5 Z9(codex R4-F4①) — **낡은 단언이었다.** v0.49 r2 W2(민구 08-13 확정)가 재질문
  //   TTS의 꼬리("{항목} 다시 말씀해 주세요.")를 **삭제**했다 — 재질문 지시는 부정 비프 +
  //   화면 `ReaskCue`가 전담하고 귀에는 사유만 간다(`voicePrompts.REASK_TTS`의 「꼬리를 되살리지
  //   마라」 주석이 정본). 그런데 이 단언만 그 꼬리를 계속 찾아 `npm run test:e2e`(전체 suite)를
  //   **red로 고정**하고 있었다. 여기서 재려는 것은 「일반 재질문이 났는가」이지 옛 문구가 아니므로,
  //   정본 상수와 **전체 일치**로 바꾼다(부분일치는 다음 문구 변경에서 또 조용히 어긋난다).
  expect(await ttsLog(page), '일반 재질문 사유 TTS가 나오지 않았다').toContain(REASK_TTS.parse_failed);

  // 재발화로 정상 커밋.
  await fireStt(page, '29.9', 800);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '22.2', 800);
  await page.waitForTimeout(1200);

  const sessions = await getIdbSessions(page);
  const row1 = sessions[sessions.length - 1].rows.find((r) => r.index === 1)!;
  expect(row1.values.c8).toBe('29.9');
});

// ─── 🔴 v0.49 r4 M3 — 거절 분기도 [CLIP-DECIMAL-FRAG-1]의 대상이다 ──────────────────
//
// r3 #6이 거절 종단을 단일화하며 편입한 분기들 중 KNOWN_NOISE는 `startClip()`을 **무조건**
// 불렀고, 저신뢰 거절도 마찬가지였다. 소수부 타깃 재질문 중 그 두 발화가 들어오면 위 세 스펙이
// 지키는 「원본 전체발화 버퍼 보존」이 그대로 깨진다 — 파싱 실패 분기만 보호받고 있었다.
// M3는 클립 재시작 판정을 종단(`rejectValue`)으로 옮겨, 소수 문맥에서는 호출부 요청을 무시한다.

test('M3 — 소수 재질문 중 KNOWN_NOISE 거절도 클립을 재시작하지 않는다', async ({ page }) => {
  await setupAndStart(page);
  await fireStt(page, '29 점 부', 600);
  await waitForActiveChip(page, '횡경'); // 재질문 중(정수부 29 보존)

  const before = (await getClipLog(page)).filter((e) => e.extra?.startsWith('clip_started')).length;
  await fireStt(page, '변경', 600); // KNOWN_NOISE 동음이의 거절
  await waitForActiveChip(page, '횡경');

  const after = (await getClipLog(page)).filter((e) => e.extra?.startsWith('clip_started')).length;
  expect(after - before, '소수 재질문 중 거절이 원본 슬롯을 폐기했다').toBe(0);
  // 문맥이 살아 있고 그 사실을 말한다(무고지 합성 방지 — v049-r4-m3-reject-fraction이 본가).
  expect((await ttsLog(page)).at(-1)).toContain('소수점 아래');

  // 조각 합성이 그대로 성립한다.
  await fireStt(page, '구', 600);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '22.2', 800);
  await page.waitForTimeout(1500);
  const sessions = await getIdbSessions(page);
  expect(sessions[sessions.length - 1].rows.find((r) => r.index === 1)!.values.c8).toBe('29.9');
});

test('M3 — 소수 재질문 중 **저신뢰** 거절도 클립을 재시작하지 않는다(리뷰 미지목 분기)', async ({ page }) => {
  await setupAndStart(page);
  await fireStt(page, '29 점 부', 600);
  await waitForActiveChip(page, '횡경');

  const before = (await getClipLog(page)).filter((e) => e.extra?.startsWith('clip_started')).length;
  await fireStt(page, '콜록', 600, 0.2); // 파싱 실패 + 저신뢰 → stt_rejected_low_confidence
  await waitForActiveChip(page, '횡경');

  const after = (await getClipLog(page)).filter((e) => e.extra?.startsWith('clip_started')).length;
  expect(after - before, '저신뢰 거절이 원본 슬롯을 폐기했다').toBe(0);
  expect((await ttsLog(page)).at(-1)).toContain('소수점 아래');

  await fireStt(page, '구', 600);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '22.2', 800);
  await page.waitForTimeout(1500);
  const sessions = await getIdbSessions(page);
  expect(sessions[sessions.length - 1].rows.find((r) => r.index === 1)!.values.c8).toBe('29.9');
});
