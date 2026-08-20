/**
 * Correction Flow Tests — 수정/정정 명령 후 진행 검증
 *
 * 검증:
 *  - 같은 행 내 수정 후 정상 진행
 *  - 행 경계 수정 (이전 행 마지막 필드) 후 복귀
 *  - 연속 수정 2~3회 스트레스
 *  - 수정 중 파싱 실패 → 재시도
 *  - "정정"/"수정" 교차 사용
 *  - 실제 5/27 필드 로그 리플레이 (4번 연속 수정)
 */

import { test, expect, type Page } from '@playwright/test';
import { extractModifyColumn } from '../src/lib/voiceCommands';
import { BASE } from './baseUrl';

test.setTimeout(120_000);

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
    sessionAutoLabel: 'correction-test',
    noisyMode: false,
    preferredVoiceName: '',
  },
  version: 12,
};

const MOCK_INIT_SCRIPT = `
(function() {
  window.__ttsLog = [];

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
  } catch(e1) {
    try {
      Object.defineProperty(Window.prototype, 'speechSynthesis', {
        get: function() { return mockSynth; }, configurable: true,
      });
    } catch(e2) {
      try { window.speechSynthesis = mockSynth; } catch(e3) {}
    }
  }

  var _addStyle = function() {
    var s = document.createElement('style');
    s.textContent = '* { animation-duration: 0ms !important; transition-duration: 0ms !important; }';
    (document.head || document.documentElement).appendChild(s);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _addStyle);
  } else {
    _addStyle();
  }

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
  MockSTT.prototype.fireResultWithAlts = function(transcript, confidence, alts) {
    var alternatives = [{ transcript: transcript, confidence: confidence }];
    for (var i = 0; i < (alts || []).length; i++) {
      alternatives.push({ transcript: alts[i], confidence: confidence * 0.9 });
    }
    var result = { isFinal: true, length: alternatives.length };
    for (var i = 0; i < alternatives.length; i++) result[i] = alternatives[i];
    var event = { resultIndex: 0, results: { length: 1, 0: result } };
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

// ─── Helpers ────────────────────────────────────────────────────

async function fireStt(page: Page, transcript: string, waitMs = 300) {
  await page.evaluate((t) => {
    (window as any).__mockSTT?.fireResult(t, 0.95);
  }, transcript);
  await page.waitForTimeout(waitMs);
}

async function fireSttWithAlts(
  page: Page, transcript: string, confidence: number, alts: string[], waitMs = 300,
) {
  await page.evaluate(({ t, c, a }) => {
    (window as any).__mockSTT?.fireResultWithAlts(t, c, a);
  }, { t: transcript, c: confidence, a: alts });
  await page.waitForTimeout(waitMs);
}

async function getActiveRow(page: Page): Promise<number> {
  const text = await page.evaluate(() => document.body.innerText);
  const m = text.match(/(\d+)\s*\/\s*\d+\s*행/);
  return m ? parseInt(m[1]) : -1;
}

async function getActiveChipName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const chip = document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
    return chip?.dataset.colName ?? '';
  });
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

async function setupAndStart(page: Page) {
  await page.addInitScript(MOCK_INIT_SCRIPT);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate((s) => {
    localStorage.setItem('agri-voicenote-settings-v3', JSON.stringify(s));
  }, SETTINGS);
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

async function inputRow(page: Page, h: string, j: string, nextRow?: number) {
  await waitForActiveChip(page, '횡경');
  await fireStt(page, h, 300);
  await waitForActiveChip(page, '종경');
  await fireStt(page, j, 300);
  if (nextRow !== undefined) await waitForRow(page, nextRow);
}

async function getIdbSessions(page: Page) {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => resolve(req.result as any);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction('sessions', 'readonly');
    const store = tx.objectStore('sessions');
    const sessions: any[] = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result as any);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return sessions;
  });
}

// ─── Tests ──────────────────────────────────────────────────────

test('같은 행 내 수정 — 횡경 입력 후 수정하여 종경까지 정상 진행', async ({ page }) => {
  await setupAndStart(page);

  await waitForActiveChip(page, '횡경');
  await fireStt(page, '35.1', 300);

  await waitForActiveChip(page, '종경');
  await fireStt(page, '수정', 500);

  await waitForActiveChip(page, '횡경');
  const chip = await getActiveChipName(page);
  expect(chip).toContain('횡경');

  await fireStt(page, '36.0', 300);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '28.3', 300);

  await waitForRow(page, 2);
  expect(await getActiveRow(page)).toBe(2);
});

test('행 경계 수정 — 행 2에서 행 1 마지막 필드 수정 후 복귀', async ({ page }) => {
  await setupAndStart(page);

  await inputRow(page, '35.1', '28.3', 2);

  await waitForActiveChip(page, '횡경');
  await fireStt(page, '수정', 500);

  expect(await getActiveRow(page)).toBe(1);
  await waitForActiveChip(page, '종경');

  await fireStt(page, '29.0', 500);
  await waitForRow(page, 2);
  await waitForActiveChip(page, '횡경');

  await fireStt(page, '42.0', 300);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '31.5', 300);
  await waitForRow(page, 3);
});

test('연속 수정 2회 — 같은 필드를 두 번 수정 후 정상 진행', async ({ page }) => {
  await setupAndStart(page);

  await waitForActiveChip(page, '횡경');
  await fireStt(page, '35.1', 300);

  // 수정 1회
  await waitForActiveChip(page, '종경');
  await fireStt(page, '수정', 500);
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '36.0', 300);

  // 수정 2회
  await waitForActiveChip(page, '종경');
  await fireStt(page, '수정', 500);
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '37.0', 300);

  await waitForActiveChip(page, '종경');
  await fireStt(page, '28.3', 300);

  await waitForRow(page, 2);
  expect(await getActiveRow(page)).toBe(2);
});

test('연속 수정 3회 + 행 경계 — 행 2에서 행 1을 3번 연속 수정', async ({ page }) => {
  await setupAndStart(page);

  await inputRow(page, '35.1', '28.3', 2);

  // 수정 1회: 행 2 → 행 1 종경
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '수정', 500);
  expect(await getActiveRow(page)).toBe(1);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '29.0', 500);
  await waitForRow(page, 2);

  // 수정 2회
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '수정', 500);
  expect(await getActiveRow(page)).toBe(1);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '30.0', 500);
  await waitForRow(page, 2);

  // 수정 3회
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '수정', 500);
  expect(await getActiveRow(page)).toBe(1);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '31.0', 500);
  await waitForRow(page, 2);

  // 행 2 정상 완료
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '42.0', 300);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '33.8', 300);
  await waitForRow(page, 3);
});

test('수정 중 파싱 실패 → 재시도 → 정상 진행', async ({ page }) => {
  await setupAndStart(page);

  await waitForActiveChip(page, '횡경');
  await fireStt(page, '35.1', 300);

  // 수정 → 횡경으로
  await waitForActiveChip(page, '종경');
  await fireStt(page, '수정', 500);
  await waitForActiveChip(page, '횡경');

  // 노이즈 워드 입력 (파싱 실패)
  await fireSttWithAlts(page, '광장', 0.70, ['광장', '당장'], 400);

  // 아직 횡경 대기 중
  expect(await getActiveChipName(page)).toContain('횡경');

  // 정상 값 입력
  await fireStt(page, '36.0', 300);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '28.3', 300);

  await waitForRow(page, 2);
});

test('수정 명령 — 행 1·2 연속 적용 (I-1: 단일 단어 "수정")', async ({ page }) => {
  await setupAndStart(page);

  // Row 1: "수정" 사용
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '35.1', 300);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '수정', 500);
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '36.0', 300);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '28.3', 300);
  await waitForRow(page, 2);

  // Row 2: "수정" 사용
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '42.0', 300);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '수정', 500);
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '43.0', 300);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '31.5', 300);

  await waitForRow(page, 3);
});

test('실제 5/27 로그 리플레이 — 10행 전체 + 4번 연속 수정', async ({ page }) => {
  await setupAndStart(page);

  // ── Row 1: 횡경 입력 → 수정 → 재입력 ──
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '10', 300);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '수정', 500);
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '11.1', 300);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '22.2', 300);
  await waitForRow(page, 2);

  // ── Row 2-3: 일반 ──
  await inputRow(page, '33.3', '44.4', 3);
  await inputRow(page, '55.5', '66.6', 4);

  // ── Row 4: 일반 ──
  await inputRow(page, '77.7', '18.8', 5);

  // ── Row 5: 4번 연속 수정 (행 4 종경) ──
  // 수정 1
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '수정', 500);
  expect(await getActiveRow(page)).toBe(4);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '8.8', 500);
  await waitForRow(page, 5);

  // 수정 2
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '수정', 500);
  expect(await getActiveRow(page)).toBe(4);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '8.8', 500);
  await waitForRow(page, 5);

  // 수정 3
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '수정', 500);
  expect(await getActiveRow(page)).toBe(4);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '8.8', 500);
  await waitForRow(page, 5);

  // 수정 4 (최종값)
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '수정', 500);
  expect(await getActiveRow(page)).toBe(4);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '88.8', 500);
  await waitForRow(page, 5);

  // ── Row 5: 일반 ──
  await inputRow(page, '99.9', '100', 6);

  // ── Row 6: 수정 포함 ──
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '111', 300);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '수정', 500);
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '111.1', 300);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '122.2', 300);
  await waitForRow(page, 7);

  // ── Row 7-9: 일반 ──
  await inputRow(page, '133.3', '144.4', 8);
  await inputRow(page, '155.5', '166.6', 9);
  await inputRow(page, '177.7', '188.8', 10);

  // ── Row 10: 수정 포함 + 세션 완료 ──
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '109.9', 300);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '수정', 500);
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '199.9', 300);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '200', 300);

  // 세션 완료 대기
  await page.waitForTimeout(2000);

  // IDB 값 검증
  const sessions = await getIdbSessions(page);
  expect(sessions.length).toBeGreaterThan(0);
  const session = sessions[sessions.length - 1];
  expect(session.rows.length).toBe(10);

  const val = (row: number, col: string) =>
    session.rows.find((r: any) => r.index === row)?.values?.[col];

  // 수정된 값 검증
  expect(val(1, 'c8')).toBe('11.1');
  expect(val(1, 'c9')).toBe('22.2');
  expect(val(4, 'c8')).toBe('77.7');
  expect(val(4, 'c9')).toBe('88.8');   // 4번 수정 후 최종값
  expect(val(5, 'c8')).toBe('99.9');
  expect(val(5, 'c9')).toBe('100');
  expect(val(6, 'c8')).toBe('111.1');  // 수정 후
  expect(val(6, 'c9')).toBe('122.2');
  expect(val(10, 'c8')).toBe('199.9'); // 수정 후
  expect(val(10, 'c9')).toBe('200');
});

test('마지막 행 수정 후 세션 정상 완료 + IDB 전체 검증', async ({ page }) => {
  await setupAndStart(page);

  // Row 1-9 빠르게 입력
  await inputRow(page, '11.1', '22.2', 2);
  await inputRow(page, '33.3', '44.4', 3);
  await inputRow(page, '55.5', '66.6', 4);
  await inputRow(page, '77.7', '88.8', 5);
  await inputRow(page, '99.9', '100', 6);
  await inputRow(page, '111.1', '122.2', 7);
  await inputRow(page, '133.3', '144.4', 8);
  await inputRow(page, '155.5', '166.6', 9);
  await inputRow(page, '177.7', '188.8', 10);

  // Row 10: 횡경 입력 → 수정 → 재입력 → 종경 → 세션 완료
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '199.0', 300);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '수정', 500);
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '199.9', 300);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '200', 300);

  // 세션 완료 대기
  await page.waitForTimeout(2000);

  // IDB 전체 검증
  const sessions = await getIdbSessions(page);
  expect(sessions.length).toBeGreaterThan(0);
  const session = sessions[sessions.length - 1];
  expect(session.rows.length).toBe(10);

  const expected: Record<number, [string, string]> = {
    1: ['11.1', '22.2'],
    2: ['33.3', '44.4'],
    3: ['55.5', '66.6'],
    4: ['77.7', '88.8'],
    5: ['99.9', '100'],
    6: ['111.1', '122.2'],
    7: ['133.3', '144.4'],
    8: ['155.5', '166.6'],
    9: ['177.7', '188.8'],
    10: ['199.9', '200'],  // 수정 후 최종값
  };

  for (const [row, [h, j]] of Object.entries(expected)) {
    const r = session.rows.find((r: any) => r.index === parseInt(row));
    expect(r, `행 ${row} 누락`).toBeTruthy();
    expect(r.values.c8).toBe(h);
    expect(r.values.c9).toBe(j);
  }
});

// ─── D-2 (RACE-7): sessionId가 in-app 언마운트(탭 전환)에서도 유실되지 않는다 ──────

async function switchTab(page: Page, id: string) {
  await page.locator(`[data-testid="tab-${id}"]`).click();
  await page.waitForTimeout(200);
}

test('D-2 RACE-7 — pause 중 탭 전환(언마운트)→재개→종료 후에도 빈 sessionId/NaN startedAt 없음', async ({ page }) => {
  await setupAndStart(page);

  // 행 1 완료 → persistSession이 정상 id로 1회 저장
  await inputRow(page, '11.1', '22.2', 2);

  // 일시정지 (마이크 버튼)
  await page.locator('button[title="일시정지"]').click();
  await expect(page.locator('button[title="재시작"]')).toBeVisible();

  // 데이터 탭으로 이동 → VoiceScreen(=useVoiceSession) 언마운트 → 다시 음성 탭(리마운트)
  await switchTab(page, 'data');
  await switchTab(page, 'voice');

  // 재개: 리마운트 후 store에서 복원된 sessionId로 이어가야 한다
  await expect(page.locator('button[title="재시작"]')).toBeVisible();
  await page.locator('button[title="재시작"]').click();
  await page.waitForTimeout(400);

  // 종료 → 최종 persist. 활성 하단에는 종료가 없으므로 일시정지 패널에서 종료한다.
  await page.locator('button[title="일시정지"]').click();
  await expect(page.locator('[data-testid="paused-card"]')).toBeVisible();
  await page.locator('button[title="입력 종료"]').click();
  await page.locator('button[title="종료 확인"]').click();
  await page.waitForTimeout(1500);

  // IDB의 모든 세션은 유효한 id와 유한한 startedAt을 가져야 한다.
  // 버그 시: 언마운트로 ref 유실 → stop이 id:'' / startedAt:NaN 세션을 추가로 저장한다.
  // (이 테스트는 restore effect 누락과 setSessionMeta가 resetAll 앞에 호출되는 순서 버그를 모두 잡는다.)
  const sessions = await getIdbSessions(page);
  expect(sessions.length).toBeGreaterThan(0);
  for (const s of sessions) {
    expect(s.id, `세션 id가 비어있음: ${JSON.stringify(s.id)}`).toMatch(/^sess_\d+$/);
    expect(
      Number.isFinite(s.startedAt),
      `startedAt이 유한하지 않음 (id=${s.id}, startedAt=${s.startedAt})`,
    ).toBe(true);
    expect(s.startedAt).toBeGreaterThan(0);
  }
});

test('D-2 — fresh start→종료→reload 후 세션이 유효 id/startedAt으로 hydrate된다', async ({ page }) => {
  await setupAndStart(page);

  await inputRow(page, '11.1', '22.2', 2);

  // 종료 → persist. 활성 하단에는 종료가 없으므로 일시정지 패널에서 종료한다([TEST-UI-2]).
  await page.locator('button[title="일시정지"]').click();
  await expect(page.locator('[data-testid="paused-card"]')).toBeVisible();
  await page.locator('button[title="입력 종료"]').click();
  await page.locator('button[title="종료 확인"]').click();
  await page.waitForTimeout(1500);

  // 리로드 → App이 IDB에서 hydrate (D-1 경로)
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);

  const sessions = await getIdbSessions(page);
  expect(sessions.length).toBeGreaterThan(0);
  const s = sessions[sessions.length - 1];
  expect(s.id).toMatch(/^sess_\d+$/);
  expect(Number.isFinite(s.startedAt)).toBe(true);
  expect(s.startedAt).toBeGreaterThan(0);

  // D-1: hydrate가 세션을 로드해 데이터 탭이 빈 상태("아직 기록된 데이터가 없습니다")가 아니어야 한다.
  await switchTab(page, 'data');
  await expect(page.locator('text=아직 기록된 데이터가 없습니다')).toHaveCount(0);
});

// ─── I-2: 행 이동(이전행/다음행) — 음성 + 버튼, 검토/수정용 ───────────────────────

test('I-2 행 이동 — "이전행"/"다음행" 음성·버튼으로 이동, 경계는 reprompt', async ({ page }) => {
  await setupAndStart(page);

  // 행 1 완료 → 행 2
  await inputRow(page, '11.1', '22.2', 2);
  expect(await getActiveRow(page)).toBe(2);

  // 음성 "이전행" → 행 1
  await fireStt(page, '이전행', 500);
  await waitForRow(page, 1);
  expect(await getActiveRow(page)).toBe(1);

  // 음성 "다음행" → 행 2
  await fireStt(page, '다음행', 500);
  await waitForRow(page, 2);
  expect(await getActiveRow(page)).toBe(2);

  // 버튼 "이전행" → 행 1 (음성과 동일 동작)
  await page.locator('button[title="이전 행으로 이동"]').click();
  await waitForRow(page, 1);
  expect(await getActiveRow(page)).toBe(1);

  // 경계: 행 1에서 "이전행" → 무음 정지 없이 행 1 유지 (REVIEW-4 reprompt)
  await fireStt(page, '이전행', 500);
  expect(await getActiveRow(page)).toBe(1);
});

// ─── v0.34.0 A3 — "수정 <컬럼명>" (검토 대기 스코프) ─────────────────────────────

// 유닛: extractModifyColumn(voiceCommands SSOT) — 브라우저 불필요(Node에서 직접 실행).
test.describe('extractModifyColumn 유닛 (v0.34.0 A3)', () => {
  const COLS = ['초장', '횡경', '과실 상태'];
  const cases: Array<[string, string | null]> = [
    ['수정 초장', '초장'],            // 기본 전치
    ['수정 초 장', '초장'],           // STT가 컬럼명을 쪼갠 변형(공백 제거 정규화)
    ['수정초장', '초장'],             // 붙은 발화
    ['수정 초장으로', '초장'],         // 조사 꼬리 — 전방 일치
    ['초장 수정', '초장'],            // 후치
    ['수정 과실 상태', '과실 상태'],   // 컬럼명 자체에 공백
    ['수정 30.7', null],             // 숫자 발화 — 컬럼명 아님(직접값 경로 소관)
    ['수정', null],                  // bare 수정 — 포인터 컬럼 소관
    ['수정 없는컬럼', null],          // 미등록 이름
  ];
  for (const [input, expected] of cases) {
    test(`"${input}" → ${JSON.stringify(expected)}`, () => {
      expect(extractModifyColumn(input, COLS)).toBe(expected);
    });
  }
});

// 회귀: 접두사가 겹치는 컬럼명 섀도잉 (v0.34.0 코드리뷰 Codex+agy 3모델 공통 지적).
// 구 코드(첫 startsWith 매치 반환)는 '횡경'이 배열상 먼저 오면 "수정 횡경도"가 '횡경'을 잘못 지목.
// 수정 후: 완전 일치 우선 + 가장 긴 전방 일치 → 긴 이름이 짧은 접두사에 가로채이지 않는다.
test.describe('extractModifyColumn 접두사 섀도잉 회귀 (v0.34.0 리뷰)', () => {
  const OVERLAP = ['횡경', '횡경도', '과장', '과장방향'];
  const cases: Array<[string, string | null]> = [
    ['수정 횡경도', '횡경도'],     // 긴 이름 — 짧은 접두사('횡경')에 가로채이면 안 됨
    ['수정 횡경', '횡경'],         // 짧은 이름은 완전 일치로 그대로
    ['수정 과장방향', '과장방향'], // 배열 순서상 '과장'이 먼저 와도 완전/최장 일치로 방어
    ['수정 과장', '과장'],
    ['수정 횡경도로', '횡경도'],   // 조사 꼬리 + 최장 전방 일치
  ];
  for (const [input, expected] of cases) {
    test(`"${input}" → ${JSON.stringify(expected)}`, () => {
      expect(extractModifyColumn(input, OVERLAP)).toBe(expected);
    });
  }
});

// 회귀 2 (v0.34.0 리뷰 라운드1 — Codex High): 임의 접미사 불허 + 중복 헤더 모호 거부.
// 오지목은 곧 엉뚱한 셀 초기화·시트 오염이므로, 확신이 없으면 지목하지 않는다(거부 → 재질문).
test.describe('extractModifyColumn 접미사·중복 방어 (v0.34.0 리뷰 라운드1)', () => {
  test('임의 접미사 불허 — 컬럼이 "횡경"뿐일 때 "수정 횡경도"는 매치 실패(오지목 금지)', () => {
    expect(extractModifyColumn('수정 횡경도', ['횡경', '초장'])).toBeNull();
  });
  test('허용 조사 꼬리는 계속 인정 — "수정 횡경으로" → 횡경', () => {
    expect(extractModifyColumn('수정 횡경으로', ['횡경', '초장'])).toBe('횡경');
  });
  test('중복 헤더는 모호 거부 — 동명 컬럼 2개면 null(첫 컬럼 오지목 금지)', () => {
    expect(extractModifyColumn('수정 횡경', ['횡경', '횡경'])).toBeNull();
  });
  test('중복이 있어도 유일한 다른 이름은 정상 지목', () => {
    expect(extractModifyColumn('수정 초장', ['횡경', '횡경', '초장'])).toBe('초장');
  });
});

// 통합: 검토 대기(완료 행 착지)에서 "수정 종경" → 포인터(첫=횡경)가 아닌 지목 컬럼(종경) 수정.
test('REVIEW+A3 — 검토 대기 중 "수정 <컬럼명>": 지목 컬럼(종경) 재녹음, 첫 컬럼 불변', async ({ page }) => {
  await setupAndStart(page);

  // 행 1 완료(35.1/28.3) → 행 2 → "이전" → 검토 대기(포인터=첫 컬럼 횡경, v0.34.0 A3).
  await inputRow(page, '35.1', '28.3', 2);
  await fireStt(page, '이전행', 600);
  await waitForRow(page, 1);
  await waitForActiveChip(page, '횡경'); // 착지 포인터 = 첫 음성 필드

  // "수정 종경" → 컬럼명 지목: 종경 재녹음 진입(cascade — 종경이 마지막 필드라 종경만 clear).
  await fireStt(page, '수정 종경', 700);
  await waitForActiveChip(page, '종경');

  // 새 값 발화 → 종경 재커밋 → 행 완료 → returnRow(행 2) 복귀.
  await fireStt(page, '22.9', 700);
  await waitForRow(page, 2);

  await fireStt(page, '종료', 1000);
  const sessions = await getIdbSessions(page);
  const row1 = sessions[sessions.length - 1]?.rows.find((r: { index: number }) => r.index === 1);
  expect(row1?.values['c8']).toBe('35.1'); // 첫 컬럼(포인터) 불변 — 지목 컬럼만 수정
  expect(row1?.values['c9']).toBe('22.9'); // "수정 종경" 타깃 반영
});

// ─── v0.34.0 O2 [STT-17] — 값 대기 중 단독 응답어 수사 오커밋 금지 (07-14 09:34:59 실사례) ─────
//
// 실기기: 값 대기 중 "예"(conf 0.729)가 alt "네"(native 4)로 폴백돼 수사 4로 커밋됨(stt_alt_used).
// 수정 후: 숫자 컬럼 값-대기 문맥에서 단독 응답어(예/네/응/어…)는 primary·alt 모두 수사로 커밋하지
// 않고 재질문(stt_rejected_ambiguous_syllable + extra:'response_word'). 파서는 불변("사"/"넷" 유효).

async function loadAllLogEvents(page: Page) {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction('logEvents', 'readonly');
    const events: Array<{ type: string; extra?: string; text?: string; parsed?: string }> =
      await new Promise((resolve, reject) => {
        const req = tx.objectStore('logEvents').getAll();
        req.onsuccess = () => resolve(req.result as Array<{ type: string; extra?: string; text?: string; parsed?: string }>);
        req.onerror = () => reject(req.error);
      });
    db.close();
    return events;
  });
}

test('[O2/STT-17] 값 대기 "예"(alt "네") → 4 커밋 금지·재질문(response_word) → 정상값 커밋 계속', async ({ page }) => {
  await setupAndStart(page);

  // 값 대기(횡경) — "예" + alt "네": 이전엔 alt "네"가 native 4로 커밋됐다.
  await waitForActiveChip(page, '횡경');
  await fireSttWithAlts(page, '예', 0.729, ['네'], 600);

  // 커밋·진행 없음 — 여전히 횡경, 재질문 이벤트에 response_word 태그.
  await waitForActiveChip(page, '횡경');
  expect(await getActiveRow(page)).toBe(1);
  const events1 = await loadAllLogEvents(page);
  const rejected = events1.find(
    (e) => e.type === 'stt_rejected_ambiguous_syllable' && e.extra === 'response_word',
  );
  expect(rejected, 'response_word 재질문 이벤트 미기록').toBeTruthy();
  expect(rejected!.text).toBe('예');

  // 단독 "네"(primary)도 동일 차단.
  await fireStt(page, '네', 500);
  await waitForActiveChip(page, '횡경');

  // 이후 정상 값은 그대로 커밋·진행 — 재질문이 흐름을 죽이지 않는다.
  await fireStt(page, '35.1', 400);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '28.3', 400);
  await waitForRow(page, 2);

  // IDB: 어떤 셀에도 "4"가 서지 않았다(오커밋 부재의 결정 증거).
  await fireStt(page, '종료', 1000);
  const sessions = await getIdbSessions(page);
  const rows = sessions[sessions.length - 1]?.rows ?? [];
  expect(rows.some((r: { values: Record<string, string> }) => r.values['c8'] === '4' || r.values['c9'] === '4')).toBe(false);
  const row1 = rows.find((r: { index: number }) => r.index === 1);
  expect(row1?.values['c8']).toBe('35.1');
});
