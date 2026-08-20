/**
 * v0.35.0 리뷰 라운드3(Codex gpt-5.6-sol) High 2건 회귀 — 둘 다 **데이터 무결성**.
 *
 *  R3-FIX-1 — STT suspend 래치 영구 잔존:
 *    저장확인 인라인의 [✓]는 resume 없이 stop()으로 간다(라운드2 배선: 취소만 resume).
 *    stop()도 start()도 래치를 안 풀어 uiSuspendRef가 **영구히 active**로 남았다. 그러면 다음
 *    세션에서 수동입력/도움말/피드백/종료 모달을 열 때 suspendRecognitionForUi가 조기 반환 →
 *    STT가 계속 살아 배경 발화가 값을 커밋하거나 행을 이동시킬 수 있다.
 *    오라클: **2번째 세션**의 수동입력 모달 열기에서 ui_suspend(manual_input)가 다시 찍히는가.
 *    (래치가 박혀 있으면 조기 반환이라 로그가 아예 없다 — 로그 기반 결정론적 판정, TEST-STT-UI-1.)
 *    + 모달이 열린 동안 배경 STT 결과가 무시되는지(값 미커밋)까지 함께 단언.
 *
 *  R3-FIX-2 — 최종 저장 실패를 삼킴:
 *    persistSession()이 false여도 stop()이 곧장 phase='ready'로 갔다 → 미저장 값·클립 포인터인
 *    채 새 세션 시작 가능(start()의 resetAll이 메모리 사본까지 지워 복구 불가).
 *    오라클: IDB 쓰기 실패 주입(__survey011FailSessionPut) → 종료해도 ready 미전환 + 오류 노출,
 *    실패 해제 후 [다시 저장] → 저장 성공 + ready 전환.
 *
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다(수동 기동 불필요, [ORCH-27])
 * Mock/fixture 패턴은 manual-input.spec.ts와 동일.
 */
import { test, expect, type Page } from '@playwright/test';
import { BASE } from './baseUrl';

test.setTimeout(120_000);

const STORE_KEY = 'agri-voicenote-settings-v3';

const BASE_SETTINGS = {
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
      { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 3 } },
      { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
      { id: 'c9', name: '종경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
    ],
    tableGenerated: true,
    totalRows: 3,
    ttsRate: 1.05,
    sessionLabelColId: null,
    sessionAutoLabel: 'r3-fix-test',
    noisyMode: false,
    preferredVoiceName: '',
  },
  version: 12,
};

const MOCK_INIT_SCRIPT = `
(function() {
  window.__micSettleSkipForTest = true; // F18 픽스처 우회 — 시작 시 1초 마이크 정착 생략(우회 심 오라클: v0440-c8-flow.spec.ts)
  window.__ttsLog = [];
  window.__mockSTTConstructCount = 0;
  window.__mockGetUserMediaCount = 0;
  var fakeTrack = {
    kind: 'audio', label: 'Fake Mic', readyState: 'live', muted: false,
    getSettings: function() { return { deviceId: 'fake-mic' }; },
    addEventListener: function() {}, removeEventListener: function() {}, stop: function() {},
  };
  var fakeStream = { getAudioTracks: function() { return [fakeTrack]; }, getTracks: function() { return [fakeTrack]; } };
  if (navigator.mediaDevices) {
    try { navigator.mediaDevices.getUserMedia = function() { window.__mockGetUserMediaCount++; return Promise.resolve(fakeStream); }; } catch(e) {}
  }
  var mockSynth = {
    speak: function(u) { window.__ttsLog.push(u.text);
      try { if (u.onstart) u.onstart(new Event('start')); } catch(e) {}
      try { if (u.onend) u.onend(new Event('end')); } catch(e) {} },
    cancel: function() {}, pause: function() {}, resume: function() {},
    getVoices: function() { return [{ name: 'Mock Korean', lang: 'ko-KR', default: true, localService: true, voiceURI: 'mock' }]; },
    speaking: false, pending: false, paused: false, onvoiceschanged: null,
    addEventListener: function() {}, removeEventListener: function() {}, dispatchEvent: function() { return true; },
  };
  try { Object.defineProperty(window, 'speechSynthesis', { get: function() { return mockSynth; }, configurable: true, enumerable: true }); }
  catch(e1) { try { window.speechSynthesis = mockSynth; } catch(e3) {} }
  var _addStyle = function() {
    var s = document.createElement('style');
    s.textContent = '* { animation-duration: 0ms !important; transition-duration: 0ms !important; }';
    (document.head || document.documentElement).appendChild(s);
  };
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _addStyle); } else { _addStyle(); }

  function MockSTT() {
    window.__mockSTTConstructCount++;
    this._ls = {};
    this.continuous = true; this.interimResults = true; this.lang = 'ko-KR'; this.maxAlternatives = 3;
    window.__mockSTT = this; this._aborted = false;
  }
  MockSTT.prototype.addEventListener = function(t, cb) { if (!this._ls[t]) this._ls[t] = []; this._ls[t].push(cb); };
  MockSTT.prototype.removeEventListener = function(t, cb) { if (this._ls[t]) this._ls[t] = this._ls[t].filter(function(f) { return f !== cb; }); };
  MockSTT.prototype.start = function() { this._aborted = false; var s = this; setTimeout(function() { (s._ls['start'] || []).forEach(function(cb) { cb(new Event('start')); }); }, 5); };
  MockSTT.prototype.stop = function() {};
  MockSTT.prototype.abort = function() { this._aborted = true; var s = this;
    setTimeout(function() { (s._ls['end'] || []).forEach(function(cb) { cb(new Event('end')); }); }, 5); };
  MockSTT.prototype.fireResult = function(transcript, confidence) {
    if (this._aborted) return;
    if (confidence === undefined) confidence = 0.95;
    var ev = { resultIndex: 0, results: { length: 1, 0: { isFinal: true, length: 1, 0: { transcript: transcript, confidence: confidence } } } };
    (this._ls['result'] || []).forEach(function(cb) { cb(ev); });
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
    return new Promise<Array<{ type: string; extra?: string; parsed?: string }>>((res) => {
      const tx = db.transaction('logEvents', 'readonly');
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result as Array<{ type: string; extra?: string; parsed?: string }>);
      req.onerror = () => res([]);
    });
  });
}

async function boot(page: Page) {
  await page.addInitScript(MOCK_INIT_SCRIPT);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ s, storeKey }) => {
    localStorage.clear();
    localStorage.setItem(storeKey, JSON.stringify(s));
    indexedDB.deleteDatabase('agri-voicenote');
  }, { s: BASE_SETTINGS, storeKey: STORE_KEY });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(200);
}

async function startSession(page: Page) {
  const startBtn = page.locator('text=음성 입력 시작').first();
  await expect(startBtn).toBeVisible();
  await startBtn.click();
  await page.waitForTimeout(600);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
}

/** 일시정지 → 입력 종료 → 저장확인 인라인. 확인 경로엔 resume이 없다 = R3-FIX-1 대상. */
async function exitViaInlineConfirm(page: Page) {
  await page.locator('button[title="일시정지"]').click();
  await page.waitForTimeout(300);
  await page.locator('button[title="입력 종료"]').click();
  await page.waitForTimeout(300);
  await page.locator('button[title="종료 확인"]').click();
  await page.waitForTimeout(900);
}

// ─── R3-FIX-1 ────────────────────────────────────────────────────────────────

test('R3-FIX-1 — 종료 확인 → 새 세션 → 수동입력 모달: suspend 래치가 풀려 STT가 다시 정지된다', async ({ page }) => {
  await boot(page);

  // 1세션: 저장확인 인라인으로 종료(= suspend('exit_confirm') 후 resume 없이 stop).
  await startSession(page);
  await exitViaInlineConfirm(page);
  await expect(page.locator('text=음성 입력 시작').first()).toBeVisible({ timeout: 5000 });

  // 래치 해제 로그(신규) — stop()이 복원 없이 래치를 풀었다는 직접 증거.
  const afterStop = await loadLogEventsFromIDB(page);
  expect(
    afterStop.some((e) => e.parsed === 'ui_suspend' && e.extra === 'exit_confirm'),
    '1세션 종료 확인 시 exit_confirm suspend가 걸린다(전제)',
  ).toBe(true);
  expect(
    afterStop.some((e) => e.parsed === 'ui_suspend_cleared' && (e.extra ?? '').startsWith('stop:')),
    'stop()이 suspend 래치를 해제한다(R3-FIX-1)',
  ).toBe(true);

  // 2세션 시작.
  await startSession(page);
  const beforeOpen = await loadLogEventsFromIDB(page);
  const suspendsBefore = beforeOpen.filter((e) => e.parsed === 'ui_suspend' && e.extra === 'manual_input').length;

  // 수동입력 모달 열기 — 래치가 박혀 있었다면 suspendRecognitionForUi가 조기 반환해 로그가 안 찍힌다.
  await page.locator('[data-testid="column-chip"][data-col-name="횡경"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible({ timeout: 3000 });
  await page.waitForTimeout(200);

  const afterOpen = await loadLogEventsFromIDB(page);
  const suspendsAfter = afterOpen.filter((e) => e.parsed === 'ui_suspend' && e.extra === 'manual_input').length;
  expect(
    suspendsAfter,
    '2세션에서도 수동입력 모달이 STT를 hard-suspend한다(래치 잔존이면 조기 반환 → 증가 없음)',
  ).toBeGreaterThan(suspendsBefore);

  // 행동 단언: 모달이 열린 동안 배경 발화는 값이 되지 않는다(데이터 무결성 그 자체).
  await fireStt(page, '77.7', 400);
  await expect(
    page.locator('[data-testid="column-chip"][data-col-name="횡경"]'),
    '모달 중 배경 STT는 무시된다(칩에 값이 커밋되지 않음)',
  ).not.toContainText('77.7');
  console.log(`✓ R3-FIX-1: manual_input suspend ${suspendsBefore} → ${suspendsAfter} (2세션에서 재발동), 배경 STT 무시`);
});

// ─── R3-FIX-2 ────────────────────────────────────────────────────────────────

/** IDB 세션 쓰기 실패 주입 on/off(db.ts saveSession seam). */
async function setPersistFailure(page: Page, fail: boolean) {
  await page.evaluate((f) => {
    (globalThis as typeof globalThis & { __survey011FailSessionPut?: boolean }).__survey011FailSessionPut = f;
  }, fail);
}

async function setPersistDelay(page: Page, delayMs: number) {
  await page.evaluate((ms) => {
    (globalThis as typeof globalThis & { __survey011DelaySessionPutMs?: number }).__survey011DelaySessionPutMs = ms;
  }, delayMs);
}

async function creationCounts(page: Page) {
  return page.evaluate(() => ({
    speech: (window as unknown as { __mockSTTConstructCount: number }).__mockSTTConstructCount,
    recorderInit: (window as unknown as { __mockGetUserMediaCount: number }).__mockGetUserMediaCount,
  }));
}

test('R3-FIX-2 — 최종 저장 실패면 ready로 전환하지 않고 오류를 노출한다 + [다시 저장] 성공 시 종료', async ({ page }) => {
  await boot(page);
  await startSession(page);

  // 행 1 완료(값 2개) — 저장할 실제 데이터를 만든다.
  await fireStt(page, '35.1', 500);
  await fireStt(page, '28.3', 800);

  // IDB 쓰기 실패 주입 → 종료 시도.
  await setPersistFailure(page, true);
  await exitViaInlineConfirm(page);

  // 핵심: ready로 내려가지 않는다(= '음성 입력 시작' 버튼 없음 → 새 세션의 resetAll이 미저장 값을
  //   덮을 수 없다) + 실패 사유가 화면에 노출된다.
  await expect(
    page.locator('[data-testid="persist-error-banner"]'),
    '저장 실패가 화면에 노출된다(삼키지 않는다)',
  ).toBeVisible({ timeout: 5000 });
  await expect(page.locator('text=음성 입력 시작')).toHaveCount(0);

  // 실패는 로깅된다(기존 컨벤션 + stop 경로 판정).
  const failLogs = await loadLogEventsFromIDB(page);
  expect(failLogs.some((e) => (e.extra ?? '').startsWith('session_persist_failed:'))).toBe(true);
  expect(failLogs.some((e) => e.extra === 'stop_persist_check:write_failed')).toBe(true);

  // 실패 원인 해소(예: 저장 공간 확보) 후 [다시 저장] → 성공 → 그제서야 ready.
  await setPersistFailure(page, false);
  await page.locator('[data-testid="persist-retry-btn"]').click();
  await expect(page.locator('[data-testid="persist-error-banner"]')).toHaveCount(0, { timeout: 5000 });
  await expect(page.locator('text=음성 입력 시작').first()).toBeVisible({ timeout: 5000 });

  const okLogs = await loadLogEventsFromIDB(page);
  expect(okLogs.some((e) => e.extra === 'stop_persist_retry:ok')).toBe(true);

  // 값이 실제로 durable하게 남았다(재시도가 형식이 아니라 진짜 저장이었다는 증거).
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
    return all as Array<{ rows: Array<{ index: number; complete: boolean; values: Record<string, string> }> }>;
  });
  const row1 = sessions[0]?.rows.find((r) => r.index === 1);
  expect(row1?.values['c8']).toBe('35.1');
  expect(row1?.values['c9']).toBe('28.3');
  console.log('✓ R3-FIX-2: 저장 실패 → ready 미전환 + 배너 노출 → 재시도 성공 → ready + 값 durable');
});

// ─── P1 stopping phase ──────────────────────────────────────────────────────

test('P1-1 — 일시정지→종료: stopping 중 stale 재시작 탭은 새 controller/recorder를 만들지 않는다', async ({ page }) => {
  await boot(page);
  await startSession(page);

  // 행 1 완료(값 2개) — persistSession 조기 반환을 피워 지연 seam이 실제로 발동하게 한다.
  await fireStt(page, '35.1', 500);
  await fireStt(page, '28.3', 800);

  await page.locator('button[title="일시정지"]').click();
  const resumeButton = await page.locator('button[title="재시작"]').elementHandle();
  expect(resumeButton).not.toBeNull();

  await setPersistDelay(page, 1500);
  await page.locator('button[title="입력 종료"]').click();
  await page.locator('button[title="종료 확인"]').click();
  await expect(page.locator('[data-testid="voice-stopping-state"]')).toBeVisible();
  const before = await creationCounts(page);

  // 실제 화면에선 버튼이 제거된다. 이미 손가락이 내려가 이벤트가 큐에 든 최악 조건을 detached
  // element의 React listener 호출로 재현해 resume() 내부 가드도 함께 검증한다.
  await resumeButton!.evaluate((el) => (el as HTMLButtonElement).click());
  await page.waitForTimeout(150);
  expect(await creationCounts(page)).toEqual(before);
  await expect(page.locator('[data-testid="voice-stopping-state"]')).toBeVisible();
  await expect(page.locator('text=음성 입력 시작').first()).toBeVisible({ timeout: 5000 });
});

test('P1-2 — 완료 검토→종료: stopping 중 stale 이전/다음 탭은 행을 바꾸지 않는다', async ({ page }) => {
  await boot(page);
  await startSession(page);
  await fireStt(page, '35.1', 350);
  await fireStt(page, '28.3', 450); // 1행 완료 후 2행
  await fireStt(page, '이전행', 500); // 완료된 1행 검토(phase complete)
  await expect(page.locator('[data-testid="active-row"]')).toHaveText('1');

  const prev = await page.locator('button[title="이전 행으로 이동"]').elementHandle();
  const next = await page.locator('button[title="다음 행으로 이동"]').elementHandle();
  await setPersistDelay(page, 1500);
  // 와이어프레임 §[1](2026-07-24 확정) — **완료 행 검토 대기**는 [1] active 레이아웃이라 하단이
  //   이전/다음이고 종료 버튼이 없다(종료는 §[3] 일시정지 또는 §[4] 조사 완료에서만 노출된다).
  //   이 테스트의 계약(= stopping 중 stale 이전/다음 탭이 행을 바꾸지 않는다)은 그대로이고,
  //   stale 핸들은 위에서 **검토 대기 상태일 때 이미 잡아 뒀다**.
  await page.locator('button[title="일시정지"]').click({ force: true });
  await page.waitForTimeout(300);
  await page.locator('button[title="입력 종료"]').click();
  await page.locator('button[title="종료 확인"]').click();
  await expect(page.locator('[data-testid="voice-stopping-state"]')).toBeVisible();

  await prev!.evaluate((el) => (el as HTMLButtonElement).click());
  await next!.evaluate((el) => (el as HTMLButtonElement).click());
  await page.waitForTimeout(150);
  // ActiveState는 제거됐지만 store의 최종 snapshot은 durable session row 구성으로 간접 확인한다.
  const stopLogs = await loadLogEventsFromIDB(page);
  expect(stopLogs.filter((e) => e.parsed === 'jump' || e.parsed === 'nextRow')).toHaveLength(1);
  await expect(page.locator('text=음성 입력 시작').first()).toBeVisible({ timeout: 5000 });
});

test('P1-3 — 종료 연타: detached 확인 버튼의 재진입 stop은 한 번만 실행된다', async ({ page }) => {
  await boot(page);
  await startSession(page);

  // 행 1 완료(값 2개) — stopping 재진입 창을 지연 seam으로 결정론적으로 유지한다.
  await fireStt(page, '35.1', 500);
  await fireStt(page, '28.3', 800);

  await page.locator('button[title="일시정지"]').click();
  await setPersistDelay(page, 1500);
  await page.locator('button[title="입력 종료"]').click();
  const confirm = await page.locator('button[title="종료 확인"]').elementHandle();
  await confirm!.click();
  await expect(page.locator('[data-testid="voice-stopping-state"]')).toBeVisible();
  await confirm!.evaluate((el) => (el as HTMLButtonElement).click());
  await page.waitForTimeout(200);

  const logs = await loadLogEventsFromIDB(page);
  expect(logs.filter((e) => e.type === 'session' && e.extra === 'stop')).toHaveLength(1);
  await expect(page.locator('text=음성 입력 시작').first()).toBeVisible({ timeout: 5000 });
});

test('P1-4 — persist 실패: stopping 화면 위 차단 모달 → 저장 재시도 성공 뒤에만 ready', async ({ page }) => {
  await boot(page);
  await startSession(page);

  // 행 1 완료(값 2개) — persistSession 조기 반환을 피워 실패 seam이 실제로 발동하게 한다.
  await fireStt(page, '35.1', 500);
  await fireStt(page, '28.3', 800);

  await setPersistFailure(page, true);
  await exitViaInlineConfirm(page);

  await expect(page.locator('[data-testid="voice-stopping-state"]')).toBeVisible();
  await expect(page.locator('[data-testid="persist-error-banner"]')).toBeVisible();
  await expect(page.locator('text=음성 입력 시작')).toHaveCount(0);
  await setPersistFailure(page, false);
  await page.locator('[data-testid="persist-retry-btn"]').click();
  await expect(page.locator('text=음성 입력 시작').first()).toBeVisible({ timeout: 5000 });
});

// ─── P2 Observer fallback ───────────────────────────────────────────────────

test('P2 — Observer API 둘 다 없어도 입력 화면과 정적 파형이 크래시 없이 렌더된다', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'ResizeObserver', { value: undefined, configurable: true });
    Object.defineProperty(window, 'IntersectionObserver', { value: undefined, configurable: true });
  });
  await boot(page);
  expect(await page.evaluate(() => ({
    resize: typeof ResizeObserver,
    intersection: typeof IntersectionObserver,
  }))).toEqual({ resize: 'undefined', intersection: 'undefined' });
  await startSession(page);

  const wave = page.locator('[data-testid="state-dots"]');
  await expect(wave).toBeVisible();
  // v0.40.0 — 파형이 별도 컴포넌트에서 **도트 격자 하나**로 합쳐졌다([UI-WAVE-1] 구조적 해소).
  //   계약은 그대로다: Observer 둘 다 undefined여도 입력 화면 + 정적 인디케이터가 pageerror 없이
  //   렌더되고, 오디오/레벨 0이면 상태 글리프가 정적으로 표시된다(움직이지 않는다).
  const cells = wave.locator('span');
  await expect(cells).toHaveCount(350); // 25열 × 14행 격자가 실제로 렌더됐다(WP-G — 종전 §C5 18×10)
  const litCount = async () => cells.evaluateAll(
    (els) => els.filter((el) => Number(getComputedStyle(el as HTMLElement).opacity) > 0.02).length,
  );
  const lit = await litCount();
  expect(lit, 'Observer 없어도 글리프가 그려진다').toBeGreaterThan(0);
  expect(await wave.getAttribute('data-mode'), '레벨 0이면 idle 웨이브(§C5 F19)').toBe('idle');
  // 🔴 이 테스트의 본체 — Observer 부재에서 **크래시가 없어야** 한다.
  expect(pageErrors, 'Observer 부재에서 pageerror 없음').toEqual([]);
});
