/**
 * v0.33.0 항목6 — 칩 터치 수동 입력(ManualValueSheet) E2E
 *
 * 음성 칩 탭 → 하단 시트 → 타입별 입력(키패드/선택지) → commitManualValue:
 *  - 열림/닫힘 동안 STT hard-suspend/resume (ui_suspend/ui_resume · manual_input — 도움말 팝업 경로 재사용)
 *  - `manual_commit` 텔레메트리(항목3 예약분, command + extra:'touch')
 *  - awaiting 필드 커밋이면 echo 후 advance (음성 커밋과 동일 진행)
 *  - float는 col.decimals 자리수 검증(validateManual) — 초과 시 커밋 차단 + 사유 표시
 *  - 취소/Escape는 값 없이 인라인 입력을 닫고 같은 항목의 음성 대기로 복귀
 *  - 검토 대기(reviewWait, 항목2) 중 커밋이면 검토 대기 재무장(재낭독)
 *  - v0.34.0 A1 — 이상치 규칙 위반 커밋(awaiting 셀)은 **진행 보류**: 팝업+[확인][수정] 버튼,
 *    활성 칩은 커밋한 칩에 유지(전진 버그 수정). [확인] 후에만 advance. 알람 TTS·음성 확인
 *    루프는 종전대로 없음(민구 확정 유지).
 *  (v0.33.0 항목8 시각 영수증은 v0.34.0 A5에서 제거 — 커밋 확인은 칩 값 갱신 단언으로 검증.)
 *
 * Mock/fixture 패턴은 nav-unidirectional.spec.ts(기본)·trend-alert.spec.ts(이상치)와 동일.
 */

import { test, expect, type Page } from '@playwright/test';
import { BASE } from './baseUrl';
// 🔴 v0.49 r4 M7(claude r3 #13) — [TEST-GUM-1] 최소 스텁. 이 스펙은 이번 diff가 단언을 고쳤는데
//   게이트 밖이고 gUM 스텁이 없어 `clickStart`에서 전멸했다 = **검증자가 없는 수정**이었다.
import { GUM_GRANT_SCRIPT } from './fixtures/gum';
import { reviewWaitAbsorbTts } from '../src/lib/voicePrompts';

// ── 와이어프레임 §[2](2026-07-24 확정) 반영 ────────────────────────────────────────────────
// 이상치 응답 대기의 [확인]/[수정]은 **카드 안이 아니라 하단 `<` `>` 자리**로 이동했다
// ("하단 `<` `>` → 확인/수정으로 변경(알람 동안만)"). 따라서 종전
// `popup.locator('[data-testid="anomaly-confirm-btn"]')`(카드 하위 탐색)를 `page.locator(...)`로
// 스코프만 넓힌다. **버튼의 존재·동작 단언은 그대로다** — 바뀐 것은 화면상 위치뿐이다.
// 버튼이 하단 바에 있다는 사실 자체는 v039-active-zones.spec.ts가 별도로 고정한다.

test.setTimeout(120_000);

const STORE_KEY = 'agri-voicenote-settings-v3';

const BASE_SETTINGS = {
  state: {
    // 🔴 왕복 OFF — 켜져 있으면 칩 클릭이 Playwright `stable` 체크에서 데드락한다.
    //    기전·실측은 tests/fixtures/activeZones.ts의 chipSweepSeconds 주석이 정본.
    chipSweepSeconds: 0,
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
      { id: 'c6', name: '조사나무', type: 'int',   input: 'auto',  ttsAnnounce: true,  auto: { kind: 'seq', from: 1, to: 3 } },
      { id: 'c8', name: '횡경',     type: 'float', input: 'voice', ttsAnnounce: true,  auto: { kind: 'fixed', value: '' }, decimals: 1 },
      { id: 'c9', name: '종경',     type: 'float', input: 'voice', ttsAnnounce: true,  auto: { kind: 'fixed', value: '' }, decimals: 1 },
    ],
    tableGenerated: true,
    totalRows: 3,
    ttsRate: 1.05,
    sessionLabelColId: null,
    sessionAutoLabel: 'manual-test',
    noisyMode: false,
    preferredVoiceName: '',
  },
  version: 13,
};

/** options 음성 컬럼 fixture — 선택지 버튼 그리드 검증용. */
const OPTIONS_SETTINGS = {
  ...BASE_SETTINGS,
  state: {
    // 🔴 왕복 OFF — 켜져 있으면 칩 클릭이 Playwright `stable` 체크에서 데드락한다.
    //    기전·실측은 tests/fixtures/activeZones.ts의 chipSweepSeconds 주석이 정본.
    chipSweepSeconds: 0,
    ...BASE_SETTINGS.state,
    columns: [
      { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 3 } },
      { id: 'c8', name: '과실상태', type: 'options', input: 'voice', ttsAnnounce: true, auto: { kind: 'options', available: ['정상', '병해', '낙과'], selected: [] } },
      { id: 'c9', name: '종경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
    ],
  },
};

const MOCK_INIT_SCRIPT = `
(function() {
  window.__ttsLog = [];
  window.__sttLifecycle = { created: 0, started: 0, aborted: 0 };
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
    window.__sttLifecycle.created++;
  }
  MockSTT.prototype.addEventListener = function(t, cb) { if (!this._ls[t]) this._ls[t] = []; this._ls[t].push(cb); };
  MockSTT.prototype.removeEventListener = function(t, cb) { if (this._ls[t]) this._ls[t] = this._ls[t].filter(function(f) { return f !== cb; }); };
  MockSTT.prototype.start = function() { this._aborted = false; window.__sttLifecycle.started++; var self = this; setTimeout(function() { (self._ls['start'] || []).forEach(function(cb) { cb(new Event('start')); }); }, 5); };
  MockSTT.prototype.stop = function() {};
  MockSTT.prototype.abort = function() {
    this._aborted = true;
    window.__sttLifecycle.aborted++;
    // 중지된 옛 인스턴스는 아래 fireResult의 _aborted 가드로 결과를 전달하지 않는다. listener 자체는
    // restartRecognition의 abort→동일 인스턴스 start 계약 때문에 보존해야 한다.
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

/** 🔴 v0.47.0-r2 P5 보강(민구 확정 08-09) — **미확정 후보값은 칩에 넣지 않는다.**
 *  그래서 「후보가 보존됐다」를 칩 DOM으로 잴 수 없게 됐다. 관측 채널을 **내구 상태**(IDB의
 *  pendingValidation)로 옮긴다 — 원래 재고 싶었던 것(«소음이 후보를 덮어쓰지 않았다»,
 *  «우회로 확정되지 않았다»)은 애초에 값의 내구성이지 화면 문자열이 아니었다. 더 강한 단언이다. */
async function heldCandidate(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const all: Array<{ pendingValidation?: { candidateValue: string } }> = await new Promise((res, rej) => {
      const r = db.transaction('sessions', 'readonly').objectStore('sessions').getAll();
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return all.find((x) => x.pendingValidation)?.pendingValidation?.candidateValue ?? null;
  });
}

async function loadLogEventsFromIDB(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db || !db.objectStoreNames.contains('logEvents')) return [];
    return new Promise<Array<{ type: string; extra?: string; parsed?: string; text?: string; row?: number; colId?: string; sessionId?: string }>>((res) => {
      const tx = db.transaction('logEvents', 'readonly');
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result as Array<{ type: string; extra?: string; parsed?: string; text?: string; row?: number; colId?: string; sessionId?: string }>);
      req.onerror = () => res([]);
    });
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
    return sessions as Array<{ rows: Array<{ index: number; complete: boolean; values: Record<string, string> }> }>;
  });
}

async function setupAndStart(page: Page, settings: unknown = BASE_SETTINGS) {
  await page.addInitScript({ content: GUM_GRANT_SCRIPT }); // M7 [TEST-GUM-1]
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

/** 활성/특정 음성 칩 탭 → 시트 열림 대기. */
async function openSheetFor(page: Page, colName: string) {
  await page.locator(`[data-testid="column-chip"][data-col-name="${colName}"]`).click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible({ timeout: 3000 });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

test('float 키패드 — 칩 탭→시트→3·5·.·1→입력: manual_commit + suspend/resume + advance + 칩 값 갱신', async ({ page }) => {
  await setupAndStart(page);
  await waitForActiveChip(page, '횡경');

  await openSheetFor(page, '횡경');
  for (const k of ['3', '5', '.', '1']) {
    await page.locator(`[data-testid="manual-key-${k}"]`).click();
  }
  await page.locator('[data-testid="manual-commit"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toHaveCount(0);
  await page.waitForTimeout(500);

  // awaiting 셀 커밋 → 음성 커밋과 동일하게 다음 필드(종경)로 진행.
  await waitForActiveChip(page, '종경');

  // v0.34.0 A5 — 시각 영수증 제거. 커밋 확인은 칩 값 갱신으로 검증(횡경 칩에 35.1 표시).
  await expect(page.locator('[data-testid="column-chip"][data-col-name="횡경"]')).toContainText('35.1');

  // 텔레메트리: manual_commit(항목3 예약분) + 시트 열림/닫힘의 STT suspend/resume(manual_input).
  const events = await loadLogEventsFromIDB(page);
  const mc = events.find((e) => e.type === 'command' && e.parsed === 'manual_commit');
  expect(mc, 'manual_commit 이벤트 미기록').toBeTruthy();
  expect(mc!.text).toBe('35.1');
  expect(mc!.extra).toBe('touch');
  expect(events.some((e) => e.parsed === 'ui_suspend' && e.extra === 'manual_input')).toBe(true);
  expect(events.some((e) => e.parsed === 'ui_resume' && e.extra === 'manual_input')).toBe(true);

  // STT 생존(resume 후): 종경을 음성으로 커밋해 행 완료 → 행 2.
  await fireStt(page, '22.2', 500);
  await waitForRow(page, 2);

  await fireStt(page, '종료', 1000);
  const sessions = await getIdbSessions(page);
  const row1 = sessions[sessions.length - 1]?.rows.find((r) => r.index === 1);
  expect(row1?.values['c8']).toBe('35.1');
  expect(row1?.values['c9']).toBe('22.2');
  expect(row1?.complete).toBe(true);
});

test('float decimals 검증 — 소수 2자리(35.12) 입력 차단 + 사유 표시, 백스페이스 후 정상 커밋', async ({ page }) => {
  await setupAndStart(page);
  await waitForActiveChip(page, '횡경');

  await openSheetFor(page, '횡경');
  for (const k of ['3', '5', '.', '1', '2']) {
    await page.locator(`[data-testid="manual-key-${k}"]`).click();
  }
  await page.locator('[data-testid="manual-commit"]').click();
  // 커밋 차단 — 시트 유지 + 사유(자리수) 표시.
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible();
  await expect(page.locator('[data-testid="manual-error"]')).toContainText('1자리');

  // 백스페이스로 35.1 → 정상 커밋.
  await page.locator('[data-testid="manual-key-back"]').click();
  await page.locator('[data-testid="manual-commit"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toHaveCount(0);
  await page.waitForTimeout(400);
  await waitForActiveChip(page, '종경');

  const events = await loadLogEventsFromIDB(page);
  const commits = events.filter((e) => e.parsed === 'manual_commit');
  expect(commits.length).toBe(1); // 차단된 35.12는 커밋되지 않음
  expect(commits[0].text).toBe('35.1');
});

test('취소 — 인라인 입력 닫힘 + 같은 항목의 음성 대기·STT 재개', async ({ page }) => {
  await setupAndStart(page);
  await waitForActiveChip(page, '횡경');

  await openSheetFor(page, '횡경');
  await page.locator('[data-testid="manual-cancel"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toHaveCount(0);
  await page.waitForTimeout(400);

  // 취소는 값을 지우거나 별도 restart를 만들지 않는다. 기존 awaiting을 유지한 채 STT만 재개한다.
  const events = await loadLogEventsFromIDB(page);
  expect(events.some((e) => e.type === 'command' && e.parsed === 'restart' && e.extra === 'touch')).toBe(false);
  expect(events.some((e) => e.parsed === 'ui_resume' && e.extra === 'manual_input')).toBe(true);
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '35.1', 400);
  await waitForActiveChip(page, '종경');
});

test('options 그리드 — 선택지 버튼 탭 즉시 커밋(선택지 외 값 없음)', async ({ page }) => {
  await setupAndStart(page, OPTIONS_SETTINGS);
  await waitForActiveChip(page, '과실상태');

  await openSheetFor(page, '과실상태');
  const grid = page.locator('[data-testid="manual-options-grid"]');
  await expect(grid).toBeVisible();
  await expect(grid.locator('button')).toHaveCount(3);
  await grid.getByText('병해', { exact: true }).click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toHaveCount(0);
  await page.waitForTimeout(400);
  await waitForActiveChip(page, '종경');

  // v0.34.0 A5 — 영수증 제거. 선택지 커밋은 칩 값 갱신으로 확인.
  await expect(page.locator('[data-testid="column-chip"][data-col-name="과실상태"]')).toContainText('병해');

  await fireStt(page, '22.2', 400);
  await fireStt(page, '종료', 1000);
  const sessions = await getIdbSessions(page);
  const row1 = sessions[sessions.length - 1]?.rows.find((r) => r.index === 1);
  expect(row1?.values['c8']).toBe('병해');
});

test('취소 — 값 미커밋 + resume 후 음성 입력 계속', async ({ page }) => {
  await setupAndStart(page);
  await waitForActiveChip(page, '횡경');

  await openSheetFor(page, '횡경');
  await page.locator('[data-testid="manual-key-9"]').click();
  await page.locator('[data-testid="manual-cancel"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toHaveCount(0);
  await page.waitForTimeout(400);

  const events = await loadLogEventsFromIDB(page);
  expect(events.some((e) => e.parsed === 'manual_commit')).toBe(false);
  // 여전히 횡경 대기 + STT 재개 확인.
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '35.1', 400);
  await waitForActiveChip(page, '종경');
});

test('검토 대기(항목2)와 상호작용 — 완료 행 검토 중 칩 수동 수정 → 검토 대기 재무장(갱신값 재낭독)', async ({ page }) => {
  await setupAndStart(page);

  // Row 1 완료(35.1/22.2) → Row 2 → "이전" → 검토 대기.
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '35.1', 300);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '22.2', 300);
  await waitForRow(page, 2);
  await fireStt(page, '이전행', 600);
  await waitForRow(page, 1);

  // 검토 대기 중 종경 칩 탭 → 시트 → 30.7 수동 커밋.
  await openSheetFor(page, '종경');
  for (const k of ['3', '0', '.', '7']) {
    await page.locator(`[data-testid="manual-key-${k}"]`).click();
  }
  await page.locator('[data-testid="manual-commit"]').click();
  await page.waitForTimeout(600);

  // 검토 대기 재무장: 행 1 유지 + 갱신값 재낭독 TTS("1행 완료됨. … 30.7").
  await waitForRow(page, 1);
  const tts = await page.evaluate(() => (window as unknown as { __ttsLog: string[] }).__ttsLog ?? []);
  // #14 — 검토 낭독과 bare 값 흡수 안내는 접두가 같다. 재낭독만 세려면 흡수 바이트를 뺀다.
  const rereads = tts.filter((t) => t.includes('1행 완료됨') && t !== reviewWaitAbsorbTts(1));
  expect(rereads.length, `검토 대기 재낭독 없음. tts=${JSON.stringify(tts.slice(-6))}`).toBeGreaterThanOrEqual(2);
  expect(rereads[rereads.length - 1]).toContain('30.7');

  // UI-c 상태별 판별: enterReviewWait는 활성 칩을 첫 컬럼(횡경)으로 되돌리지만 방금 수정한 항목은
  // 종경이다. 두 채널이 다를 때까지 항목명을 지우면 정보 유실이므로 중앙 영수증 항목은 유지한다.
  const review = page.locator('[data-hero-state="review"]');
  await expect(review).toBeVisible({ timeout: 4000 });
  await expect(page.locator('[data-testid="column-chip"][data-active="true"]')).toContainText('횡경');
  await expect(review).toContainText('종경');
  await expect(review).toContainText('30.7');

  // bare 값 발화는 여전히 흡수(덮어쓰기 금지 계약 유지).
  await fireStt(page, '99.9', 500);
  await waitForRow(page, 1);

  // "다음"으로 검토 종료 → 종료 후 값 확인(수동 30.7 반영, bare 99.9 미반영).
  await fireStt(page, '다음행', 600);
  await waitForRow(page, 2);
  await fireStt(page, '종료', 1000);
  const sessions = await getIdbSessions(page);
  const row1 = sessions[sessions.length - 1]?.rows.find((r) => r.index === 1);
  expect(row1?.values['c9']).toBe('30.7');
  expect(row1?.values['c8']).toBe('35.1');
});

test('커밋 확인 경로(A5) — 영수증 없이 칩 값 갱신: 음성 커밋 35.1 → "수정 36.2" 후 36.2', async ({ page }) => {
  await setupAndStart(page);
  await waitForActiveChip(page, '횡경');

  // v0.34.0 A5 — commit-receipt 제거 회귀: 렌더 자체가 없어야 하고, 커밋 확인은 칩 값으로.
  await fireStt(page, '35.1', 400);
  await expect(page.locator('[data-testid="commit-receipt"]')).toHaveCount(0);
  const chip = page.locator('[data-testid="column-chip"][data-col-name="횡경"]');
  await expect(chip).toContainText('35.1');

  // "수정 36.2" 직접 수정 → 칩 값이 새값으로 갱신.
  await fireStt(page, '수정 36.2', 600);
  await expect(chip).toContainText('36.2');
  await expect(page.locator('[data-testid="commit-receipt"]')).toHaveCount(0);
});

// ─── v0.34.0 A1 — 수동 커밋 이상치: 진행 보류(칩 부동) + [확인] 후 전진 ─────────────
// 이상치 fixture(직전 회차 시트 stub + 토큰)는 anomaly-touch-buttons.spec.ts와 동일 패턴.

function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 이상치 fixture로 세션 시작(직전 회차 100.0 stub + 토큰 + trendRule=increase) — 활성 칩=횡경. */
async function setupTrendAndStart(page: Page) {
  const PREV_ROUND = localISO(new Date(Date.now() - 86_400_000));
  const TREND_SETTINGS = {
    state: {
      // 🔴 왕복 OFF — 켜져 있으면 칩 클릭이 Playwright `stable` 체크에서 데드락한다.
      //    기전·실측은 tests/fixtures/activeZones.ts의 chipSweepSeconds 주석이 정본.
      chipSweepSeconds: 0,
      googleConnected: true,
      userEmail: 'tester@example.com',
      sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_A1_MANUAL/edit',
      sheetTab: 'Sheet1',
      columnsSheetId: 'SHEET_A1_MANUAL',
      columnsSheetTab: 'Sheet1',
      columns: [
        { id: 'c1', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
        { id: 'c3', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
        { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
        { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'increase' },
        { id: 'c9', name: '종경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
      ],
      tableGenerated: true,
      totalRows: 10,
      ttsRate: 1.05,
      sessionLabelColId: null,
      sessionAutoLabel: 'manual-anomaly-hold-test',
      preferredVoiceName: '',
      roundDateColId: null,
    },
    version: 13,
  };
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { values: [
        ['조사일자', '농가명', '조사나무', '횡경', '종경'],
        [PREV_ROUND, '이원창', '1', '100.0', '50.0'],
      ] } });
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected' });
  });
  await page.addInitScript({ content: GUM_GRANT_SCRIPT }); // M7 [TEST-GUM-1]
  await page.addInitScript(MOCK_INIT_SCRIPT);
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
    { s: TREND_SETTINGS, storeKey: STORE_KEY },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(200);
  await page.locator('text=음성 입력 시작').first().click();
  await page.waitForTimeout(800); // start() 프리페치(stub GET) 정착 여유
  await waitForActiveChip(page, '횡경');
}

test('v0.34.0 A1 — 수동 커밋 이상치: 팝업 보류 중 활성 칩 부동(전진 금지) + [확인] 후 전진', async ({ page }) => {
  await setupTrendAndStart(page);

  // 칩 탭 → 키패드 120.5(직전 100.0 → increase 알람) 수동 커밋.
  await openSheetFor(page, '횡경');
  for (const k of ['1', '2', '0', '.', '5']) {
    await page.locator(`[data-testid="manual-key-${k}"]`).click();
  }
  await page.locator('[data-testid="manual-commit"]').click();
  await page.waitForTimeout(700);

  // 팝업 보류: [확인][수정] 버튼이 보이고, **활성 칩은 횡경에 그대로**(v0.34.0 A1 — 전진 버그 수정).
  const popup = page.locator('[data-testid="anomaly-alert"]');
  await expect(popup).toBeVisible();
  await expect(page.locator('[data-testid="anomaly-confirm-btn"]')).toBeVisible();
  await expect(page.locator('[data-testid="anomaly-modify-btn"]')).toBeVisible();
  await waitForActiveChip(page, '횡경');
  // 🔴 fb-27-9(민구 확정 2026-07-27) — **수동 경로도 음성 경로와 완전히 동일하게 발화한다.**
  //    종전 계약은 "시각+비프만"이었으나 실기기에서 뒤집혔다: 이 알람은 hold=1이라 사용자 응답을
  //    기다리며 진행이 멈추는데, 무음이면 **왜 멈췄는지 소리로 알 수 없다.** 현장에서는 폰을
  //    2~3m 떨어뜨려 두므로 화면을 못 본다(PRINCIPLES §2 시각·청각 일치).
  //    실측: 실기기 알람 20건 중 음성 경로 19/19 발화, 수동 경로 0/1(유일한 미발화).
  const tts = await page.evaluate(() => (window as unknown as { __ttsLog: string[] }).__ttsLog ?? []);
  expect(tts.some((t) => t.includes('추세 알람')), '수동 알람도 발화한다').toBe(true);
  // 발화 문구는 화면 라벨과 **글자까지 같다**([UI-ALERT-1] — 조립부가 anomalyAlarmLabel 하나다).
  const headline = (await page.locator('[data-testid="anomaly-headline"]').textContent())?.trim();
  expect(tts.some((t) => t.trim() === headline), 'TTS와 화면 문구가 바이트 동일').toBe(true);

  // [확인] → 팝업 해제 + 그제서야 다음 칩(종경)으로 전진.
  await page.locator('[data-testid="anomaly-confirm-btn"]').click();
  await page.waitForTimeout(500);
  await expect(popup).toHaveCount(0);
  await waitForActiveChip(page, '종경');

  // 텔레메트리 — hold 마커 fired + touch:manual_hold attribution의 confirm + confirmed.
  const events = await loadLogEventsFromIDB(page);
  const fired = events.find((e) => e.type === 'trend' && (e.extra ?? '').startsWith('trend_alert_fired'));
  expect(fired?.extra).toContain('src=manual');
  expect(fired?.extra).toContain('hold=1');
  expect(events.some((e) => e.type === 'command' && e.parsed === 'confirm' && e.extra === 'touch:manual_hold')).toBe(true);
  expect(events.some((e) => e.type === 'trend' && e.extra === 'trend_alert_confirmed')).toBe(true);

  // v0.53.0 T1 (민구 Q8 ⓐ) — 종료 화면 인자 순서 잠금: alarm(fired) >= 1 이고 reask = 0 상태로 세션 종료 후 문구 글자 그대로 단언
  await page.locator('button[title="입력 종료"]').click();
  await page.locator('button[title="종료 확인"]').click();

  const healthLine = page.locator('[data-testid="session-health-line"]');
  await expect(healthLine, '종료 화면에 session-health-line이 표시되어야 한다').toBeVisible({ timeout: 15_000 });
  const healthText = await healthLine.innerText();
  expect(healthText).toBe('이번 세션 · 다시 묻기 0 · 고친 칸 0 · 알람 1');
});

// v0.34.0 코드리뷰 라운드1 회귀 — **manualHold 중 STT 하드 게이트**(3모델 전원 지적, 민구 결정
// 2026-07-14 = 터치 전용). 시나리오: 수동값 120.5 커밋 → 이상치 보류 팝업 → 사용자가 터치하기 전
// 지나가는 트럭 소음/혼잣말이 "30"으로 파싱돼 들어옴. 수정 전엔 같은 셀을 음성값으로 재커밋하고
// (팝업 표시값과 행 값 불일치) 위반이 아니면 advance까지 돌아 팝업이 사라지며 수동값이 소실됐다.
// 수정 후: STT 무시(stt_ignored:manual_hold) — 값·팝업·활성 칩 전부 불변, 터치만 해제 가능.
test('[리뷰] A1 회귀 — manualHold 팝업 중 STT 발화는 무시: 수동값 불변·팝업 유지·전진 없음', async ({ page }) => {
  await setupTrendAndStart(page);

  // 칩 탭 → 키패드 120.5 수동 커밋 → 이상치 보류 팝업.
  await openSheetFor(page, '횡경');
  for (const k of ['1', '2', '0', '.', '5']) {
    await page.locator(`[data-testid="manual-key-${k}"]`).click();
  }
  await page.locator('[data-testid="manual-commit"]').click();
  await page.waitForTimeout(700);
  const popup = page.locator('[data-testid="anomaly-alert"]');
  await expect(popup).toBeVisible();
  await waitForActiveChip(page, '횡경');

  // 팝업이 터치 전용이므로 '말로도 가능' 음성 힌트를 노출하지 않는다(거짓 어포던스 제거).
  await expect(popup.getByText('말로도 가능', { exact: false })).toHaveCount(0);

  // ⚡ 소음 발화 3종 주입: 숫자(재커밋 시도)·'확인'(해제 시도)·'다음'(전진 시도) — 전부 무시돼야.
  for (const noise of ['30', '확인', '다음']) {
    await page.evaluate((t) => {
      (window as unknown as { __mockSTT?: { fireResult: (t: string, c: number) => void } })
        .__mockSTT?.fireResult(t, 0.95);
    }, noise);
    await page.waitForTimeout(400);
  }

  // 팝업·활성 칩·값 전부 불변(수동값 120.5 보존 — 소음 "30"이 덮어쓰지 않았다).
  await expect(popup).toBeVisible();
  await waitForActiveChip(page, '횡경');
  // P5 보강 — 칩엔 후보값이 **없다**(민구 08-09). 보존은 내구 상태로 잰다.
  await expect(page.locator('[data-testid="column-chip"][data-col-name="횡경"]')).not.toContainText('120.5');
  expect(await heldCandidate(page), '후보값 보존(칩이 아니라 IDB로 확인)').toBe('120.5');

  const ignored = (await loadLogEventsFromIDB(page))
    .filter((e) => (e.extra ?? '') === 'blocked:manual_hold:stt');
  expect(ignored.length).toBe(3); // 세 발화 모두 게이트에서 버려짐

  // 터치 [확인]만이 해제한다 — 그제서야 전진.
  await page.locator('[data-testid="anomaly-confirm-btn"]').click();
  await expect(popup).toHaveCount(0);
  await waitForActiveChip(page, '종경');

  // 최종 저장값은 사용자가 손으로 넣은 120.5 그대로(소음 30 아님).
  await page.evaluate(() => {
    (window as unknown as { __mockSTT?: { fireResult: (t: string, c: number) => void } })
      .__mockSTT?.fireResult('종료', 0.95);
  });
  await page.waitForTimeout(1200);
  const sessions = await getIdbSessions(page);
  const row1 = sessions[sessions.length - 1]?.rows.find((r: { index: number }) => r.index === 1);
  expect(row1?.values['c8']).toBe('120.5');
});

test('[리뷰 High] manualHold → reload: 후보·팝업·중앙 게이트를 IDB에서 복구', async ({ page }) => {
  await setupTrendAndStart(page);
  await openSheetFor(page, '횡경');
  for (const k of ['1', '2', '0', '.', '5']) await page.locator(`[data-testid="manual-key-${k}"]`).click();
  await page.locator('[data-testid="manual-commit"]').click();
  await expect(page.locator('[data-testid="anomaly-alert"]')).toBeVisible();

  const before = await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    const tx = db.transaction('sessions', 'readonly');
    const all: any[] = await new Promise((resolve, reject) => {
      const req = tx.objectStore('sessions').getAll(); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    return all.find((s) => s.pendingValidation);
  });
  expect(before?.pendingValidation?.candidateValue).toBe('120.5');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.locator('[data-testid="tab-voice"]').click();
  const popup = page.locator('[data-testid="anomaly-alert"]');
  await expect(popup).toBeVisible();
  // P5 보강 — 칩엔 후보값이 **없다**(민구 08-09). 보존은 내구 상태로 잰다.
  await expect(page.locator('[data-testid="column-chip"][data-col-name="횡경"]')).not.toContainText('120.5');
  expect(await heldCandidate(page), '후보값 보존(칩이 아니라 IDB로 확인)').toBe('120.5');
  expect(await page.evaluate(() => !!(window as any).__mockSTT)).toBe(true);
  const lifecycle = await page.evaluate(() => (window as any).__sttLifecycle);
  // React.StrictMode: 첫 setup 컨트롤러는 simulated teardown에서 abort, 두 번째 setup은 새 생성/start.
  expect(lifecycle.created).toBeGreaterThanOrEqual(2);
  expect(lifecycle.started).toBeGreaterThanOrEqual(2);
  expect(lifecycle.aborted).toBeGreaterThanOrEqual(1);
  await fireStt(page, '30', 400);
  await expect(popup).toBeVisible();
  const restoredEvents = await loadLogEventsFromIDB(page);
  expect(restoredEvents.some((e) => e.extra === 'manual_hold_restore_controller:started')).toBe(true);
  const blocked = restoredEvents.filter((e) => e.extra === 'blocked:manual_hold:stt');
  expect(blocked.length).toBeGreaterThanOrEqual(1);

  // [확인] 뒤 복구 컨트롤러가 그대로 다음 셀 STT를 처리해야 한다(no-op mock 인스턴스 검증 아님).
  await page.locator('[data-testid="anomaly-confirm-btn"]').click();
  await waitForActiveChip(page, '종경');
  await fireStt(page, '22.2', 500);
  // 복구 컨트롤러가 실제로 값을 처리했는지는 **durable 결과**로 확인한다(no-op mock 검증 아님).
  // 칩 DOM을 보면 안 된다 — 종경은 행의 마지막 음성 컬럼이라 커밋 즉시 행 2로 전진하고, 칩 그리드는
  // 그때부터 행 2(빈 값)를 그린다(Larry 진단 2026-07-15: 원 단언이 이 전진을 고려하지 않아 실패했다.
  // Codex는 샌드박스 EPERM으로 브라우저 스위트를 못 돌려 이 단언 실수를 잡지 못했다 — [TEST-SANDBOX-1]).
  const committed = await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('agri-voicenote'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const all: Array<{ rows?: Array<{ index: number; values?: Record<string, string> }> }> = await new Promise((res, rej) => {
      const r = db.transaction('sessions', 'readonly').objectStore('sessions').getAll();
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return all[all.length - 1]?.rows?.find((r) => r.index === 1)?.values?.['c9'];
  });
  expect(committed).toBe('22.2');
  await waitForRow(page, 2); // 행 완료 → 정상 전진(복구된 흐름이 온전히 살아 있다)
});

test('v0.53.0 S1 — manualHold 이상치 보류 → reload: 복원 세션은 session_health_skip 방출, 새 세션은 정상 결산', async ({ page }) => {
  await setupTrendAndStart(page);
  await openSheetFor(page, '횡경');
  for (const k of ['1', '2', '0', '.', '5']) await page.locator(`[data-testid="manual-key-${k}"]`).click();
  await page.locator('[data-testid="manual-commit"]').click();
  const popup = page.locator('[data-testid="anomaly-alert"]');
  await expect(popup).toBeVisible();

  // IDB에 보류된 세션 ID 확인 (복원될 세션 id)
  const restoredSessionId = await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    const tx = db.transaction('sessions', 'readonly');
    const all: any[] = await new Promise((resolve, reject) => {
      const req = tx.objectStore('sessions').getAll(); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    return all.find((s) => s.pendingValidation)?.id;
  });
  expect(restoredSessionId, '복원 대상 세션 ID가 존재해야 한다').toBeTruthy();

  // 새로고침 실행
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.locator('[data-testid="tab-voice"]').click();
  await expect(popup).toBeVisible();

  // [확인] 클릭
  await page.locator('[data-testid="anomaly-confirm-btn"]').click();
  await expect(popup).toHaveCount(0);

  // 세션 종료 (복원된 세션 종료)
  await page.locator('button[title="입력 종료"]').click();
  await page.locator('button[title="종료 확인"]').click();

  // 종료 완료 대기 (ReadyState 복귀)
  const startBtn = page.locator('text=음성 입력 시작').first();
  await expect(startBtn, '복원 세션 종료 후 음성 입력 시작 버튼이 표시되어야 한다').toBeVisible({ timeout: 15_000 });

  // ⓐ session_health_skip:reason=restored 정확히 1줄 (복원된 세션 id)
  const allEventsAfterRestored = await loadLogEventsFromIDB(page);
  const skipEvents = allEventsAfterRestored.filter(
    (e) => e.sessionId === restoredSessionId && e.extra === 'session_health_skip:reason=restored',
  );
  expect(skipEvents.length, '복원 세션은 session_health_skip:reason=restored가 정확히 1줄이어야 한다').toBe(1);

  // ⓑ session_health: 0줄 (복원 세션)
  const healthEventsForRestored = allEventsAfterRestored.filter(
    (e) => e.sessionId === restoredSessionId && (e.extra ?? '').startsWith('session_health:'),
  );
  expect(healthEventsForRestored.length, '복원 세션은 session_health 이벤트가 0줄이어야 한다').toBe(0);

  // ⓒ session-health-line 화면 줄 없음
  const healthLine = page.locator('[data-testid="session-health-line"]');
  await expect(healthLine, '복원 세션 종료 후 화면에 session-health-line이 없어야 한다').toHaveCount(0);

  // ⓓ 이어서 새 세션 1번 → 그 세션은 정상 session_health 1줄
  await startBtn.click();
  await page.waitForTimeout(600);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 5000 });

  // 새 세션 종료
  await page.locator('button[title="입력 종료"]').click();
  await page.locator('button[title="종료 확인"]').click();

  // 새 세션 종료 후 session-health-line 표면 확인
  await expect(healthLine, '새 세션 종료 후 session-health-line이 표시되어야 한다').toBeVisible({ timeout: 15_000 });

  // 전체 로그에서 정상 session_health 이벤트는 정확히 1줄 (새 세션의 것)
  const allEventsFinal = await loadLogEventsFromIDB(page);
  const healthEventsFinal = allEventsFinal.filter(
    (e) => (e.extra ?? '').startsWith('session_health:'),
  );
  expect(healthEventsFinal.length, '새 세션 종료 후 정상 session_health는 정확히 1줄이어야 한다').toBe(1);
  expect(healthEventsFinal[0].sessionId, 'session_health는 복원 세션이 아닌 새 세션에 귀속되어야 한다').not.toBe(restoredSessionId);
});


/**
 * v0.38.0 [리뷰#9] 민구 결정(2026-07-23): **업로드는 입력을 종료한 뒤에만 가능하다.**
 * 따라서 "입력 중 데이터탭에서 업로드"라는 종전 시나리오는 제품에서 **의도적으로 차단**됐고
 * 이 e2e도 그 동작을 검증하도록 바꾼다(단언을 지운 게 아니라 대상이 바뀐 것).
 *
 * ⚠️ 원래 이 테스트가 지키던 계약 — **확인 전 후보는 실제 Sheets 요청에 실리지 않는다** — 은
 * `tests/pendingValidation.spec.ts`의 `[리뷰#9]` 단위 테스트로 **이관했다**(sync 코어를 직접 태워
 * 요청 본문을 검사한다). 커버리지를 잃지 않기 위한 조치다.
 */
test('[리뷰#9] manualHold 세션이 입력 중이면 동기화 모달에 뜨지 않고 이유가 안내된다', async ({ page }) => {
  let writes = 0;
  page.on('request', (req) => {
    if (req.url().includes('sheets.googleapis.com') && req.method() !== 'GET') writes++;
  });
  await setupTrendAndStart(page);
  await page.evaluate(() => { (window as any).__survey011DelaySessionPutMs = 1200; });
  await openSheetFor(page, '횡경');
  for (const k of ['1', '2', '0', '.', '5']) await page.locator(`[data-testid="manual-key-${k}"]`).click();
  await page.locator('[data-testid="manual-commit"]').click();
  await page.locator('[data-testid="tab-data"]').click();
  await page.getByRole('button', { name: /시트에 추가/ }).click();

  const modal = page.getByText('추가할 세션 선택').locator('..').locator('..');
  // 입력 중인 세션은 선택 목록에서 제외되고, 왜 없는지 사용자에게 보인다(조용히 빠지지 않는다).
  await expect(modal.getByText(/입력을 끝낸 뒤 업로드/)).toBeVisible();
  await expect(modal.getByRole('button', { name: /manual-anomaly-hold-test/ })).toHaveCount(0);
  await page.waitForTimeout(800);
  expect(writes).toBe(0);
});

test('[리뷰 High] manualHold 지연 put 중 즉시 [확인] → advance 금지, durable 후에만 진행', async ({ page }) => {
  await setupTrendAndStart(page);
  await page.evaluate(() => { (window as any).__survey011DelaySessionPutMs = 1200; });
  await openSheetFor(page, '횡경');
  for (const k of ['1', '2', '0', '.', '5']) await page.locator(`[data-testid="manual-key-${k}"]`).click();
  await page.locator('[data-testid="manual-commit"]').click();
  const popup = page.locator('[data-testid="anomaly-alert"]');
  await expect(popup).toBeVisible();

  await page.locator('[data-testid="anomaly-confirm-btn"]').click();
  await page.waitForTimeout(250);
  await expect(popup).toBeVisible();
  await waitForActiveChip(page, '횡경');
  expect((await loadLogEventsFromIDB(page)).some((e) => e.extra === 'blocked:manual_hold:not_durable')).toBe(true);

  await page.waitForTimeout(1200);
  await page.locator('[data-testid="anomaly-confirm-btn"]').click();
  await expect(popup).toHaveCount(0);
  await waitForActiveChip(page, '종경');
});

// v0.34.0 코드리뷰 라운드2 회귀 — **터치 우회 차단**(Codex High: 라운드1은 STT만 막아 [다음]/[이전]/
// [일시정지] 터치로 미확인 이상치를 우회할 수 있었다. announceField/PausedCard가 알람을 지워 검증
// 절차 자체가 소멸). 민구 결정(터치 전용)의 온전한 구현 = 해소는 [확인]/[수정] **둘뿐**.
test('[리뷰] A1 회귀 — manualHold 중 터치 [다음]/[이전]/[일시정지] 거부: 팝업·행·값 불변', async ({ page }) => {
  await setupTrendAndStart(page);

  await openSheetFor(page, '횡경');
  for (const k of ['1', '2', '0', '.', '5']) {
    await page.locator(`[data-testid="manual-key-${k}"]`).click();
  }
  await page.locator('[data-testid="manual-commit"]').click();
  await page.waitForTimeout(700);
  const popup = page.locator('[data-testid="anomaly-alert"]');
  await expect(popup).toBeVisible();

  // 와이어프레임 §[2](2026-07-24 확정) — 알람 동안 하단 양끝은 **확인/수정**으로 바뀐다. 즉
  //   [다음]/[이전]은 화면에 **존재하지 않는다**: 종전의 "눌리지만 상태기계가 거부한다"보다 강한
  //   보장이다(잘못 누를 어포던스 자체가 없다). 남는 터치 우회 후보는 인디케이터(일시정지)뿐이고,
  //   그건 여전히 상태기계가 거부해야 한다.
  await expect(page.locator('button[title="다음 행으로 이동"]'), '알람 중 [다음] 어포던스 없음').toHaveCount(0);
  await expect(page.locator('button[title="이전 행으로 이동"]'), '알람 중 [이전] 어포던스 없음').toHaveCount(0);
  await page.locator('button[title="일시정지"]').first().click();
  await page.waitForTimeout(300);

  // 팝업 유지 · 행 1 유지 · 활성 칩 횡경 유지 — 어떤 우회도 성립하지 않는다.
  await expect(popup).toBeVisible();
  await waitForActiveChip(page, '횡경');
  await waitForRow(page, 1); // 행 이동 없음
  // P5 보강 — 칩엔 후보값이 **없다**(민구 08-09). 보존은 내구 상태로 잰다.
  await expect(page.locator('[data-testid="column-chip"][data-col-name="횡경"]')).not.toContainText('120.5');
  expect(await heldCandidate(page), '후보값 보존(칩이 아니라 IDB로 확인)').toBe('120.5');

  // 상태기계의 거부 계측은 그대로 — 터치로 도달 가능한 경로(pause)가 실제로 거부됐다.
  const blocked = (await loadLogEventsFromIDB(page))
    .filter((e) => (e.extra ?? '').startsWith('blocked:manual_hold:'));
  expect(blocked.map((e) => e.extra)).toContain('blocked:manual_hold:pause');

  // [확인] 터치만이 해소 — 그제서야 전진한다.
  await page.locator('[data-testid="anomaly-confirm-btn"]').click();
  await expect(popup).toHaveCount(0);
  await waitForActiveChip(page, '종경');
});

// v0.34.0 코드리뷰 라운드2 회귀 — **[수정] 후 시트 취소 시 보류 유지**(Codex Medium: 이전엔 [수정]이
// 팝업·hold를 먼저 지워, 시트를 취소하면 이미 영속된 이상값이 확인된 것처럼 남고 STT도 재개됐다).
// 수정 후: 보류는 성공적인 재커밋으로만 풀린다 — 취소하면 팝업·게이트가 그대로 복귀.
test('[리뷰] A1 회귀 — [수정] 후 시트 취소: 팝업·보류 유지(미확인 값이 확정되지 않음)', async ({ page }) => {
  await setupTrendAndStart(page);

  await openSheetFor(page, '횡경');
  for (const k of ['1', '2', '0', '.', '5']) {
    await page.locator(`[data-testid="manual-key-${k}"]`).click();
  }
  await page.locator('[data-testid="manual-commit"]').click();
  await page.waitForTimeout(700);
  const popup = page.locator('[data-testid="anomaly-alert"]');
  await expect(popup).toBeVisible();

  // [수정] → 수동입력 시트 재오픈. 시트가 덮는 동안 팝업은 렌더되지 않지만 **보류 상태는 유지**된다.
  await page.locator('[data-testid="anomaly-modify-btn"]').click();
  await page.waitForTimeout(400);
  await expect(page.locator('[data-testid="manual-commit"]')).toBeVisible();
  await expect(page.locator('[data-testid="manual-value-sheet"]'), '보류 이상치 수정 중 붉은 톤 유지')
    .toHaveAttribute('data-tone', 'red');
  await expect(popup).toHaveCount(0); // 시트가 덮음 — 상태가 아니라 표시만 숨김

  // 값을 고치지 않고 시트를 **취소** → 팝업이 그대로 다시 보이고 보류도 살아 있다.
  await page.locator('[data-testid="manual-cancel"]').click();
  await page.waitForTimeout(400);
  await expect(popup).toBeVisible();

  // 보류 유지 증명: STT 발화가 여전히 게이트에서 거부된다(재개되지 않았다).
  await page.evaluate(() => {
    (window as unknown as { __mockSTT?: { fireResult: (t: string, c: number) => void } })
      .__mockSTT?.fireResult('30', 0.95);
  });
  await page.waitForTimeout(400);
  const blocked = (await loadLogEventsFromIDB(page))
    .filter((e) => (e.extra ?? '') === 'blocked:manual_hold:stt');
  expect(blocked.length).toBeGreaterThanOrEqual(1);
  // P5 보강 — 칩엔 후보값이 **없다**(민구 08-09). 보존은 내구 상태로 잰다.
  await expect(page.locator('[data-testid="column-chip"][data-col-name="횡경"]')).not.toContainText('120.5');
  expect(await heldCandidate(page), '후보값 보존(칩이 아니라 IDB로 확인)').toBe('120.5');

  // [수정] → 정상값 재커밋 → 그제서야 보류 해소·전진.
  // (규칙 주의: trendRule='increase'는 "커지면 알람"이라 직전 100.0보다 **작은** 값이 무알람 —
  //  trendCheck.ts checkAnomaly '의미 반전' 주석 참조.)
  await page.locator('[data-testid="anomaly-modify-btn"]').click();
  await page.waitForTimeout(400);
  for (const k of ['9', '5', '.', '5']) {
    await page.locator(`[data-testid="manual-key-${k}"]`).click();
  }
  await page.locator('[data-testid="manual-commit"]').click();
  await page.waitForTimeout(700);
  await expect(popup).toHaveCount(0);
  await waitForActiveChip(page, '종경');
  await expect(page.locator('[data-testid="column-chip"][data-col-name="횡경"]')).toContainText('95.5');
});
