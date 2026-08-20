/**
 * v0.5.0 W2/W3 회귀 테스트 — 단방향 진행(NAV-1) + "유지" 일반화(NAV-2)
 *
 * 2026-06-10 실기기 로그(NAV-1)의 시퀀스 재현:
 *   행 skip("다음") → 후속 행 완료 → (수정 전) returnRow가 skip한 행으로 복귀 →
 *   다시 "다음" → 완료 행 재프롬프트 → 완료 행으로 복귀 루프 (세션 마지막 80초 중 70초 소모).
 *
 * 수정 후 기대 동작:
 *   - "다음"은 아래 방향으로만 전진, 미완료 행은 skip 표시 + 빈 행 placeholder로 즉시 영속화.
 *   - 마지막 행까지 입력하면 빈 행 안내("N행이 비어 있습니다…") 후 자동 종료 (복귀 루프 없음).
 *   - 데이터탭에서 complete=false 행 번호가 amber(#FFB300)로 강조됨.
 *   - "유지": 값 있으면(완료 행 검토 대기 포함) 유지+다음, 없으면 "유지할 값이 없습니다…" 명시 피드백.
 *
 * v0.33.0 백로그 A(민구 결정 1·3) — "이전" 재입력(reentry) 모드 폐지:
 *   - 음성 "이전" = ◀ 버튼과 동일한 단순 행 이동(gotoAdjacentRow → jumpToRow).
 *   - 완료 행 착지 시 "N행 완료됨. <항목> <값>…" 낭독 후 명령 대기(reviewWait).
 *   - bare 값 발화는 완료 행을 덮어쓰지 않음 — 수정은 '수정' 명령으로만.
 *   - v0.34.0 A3(확정 규칙, 실기기 피드백): 착지 포인터 = **첫 음성 필드**(이전 규칙 '마지막
 *     필드'는 첫 항목을 음성으로 수정 불가하게 했다). bare "수정 <값>"은 포인터(첫) 컬럼,
 *     "수정 <컬럼명>"으로 다른 컬럼 지목.
 *
 * Mock 패턴은 log-replay.spec.ts / v54-30rows.spec.ts와 동일 (instant TTS + MockSTT).
 */

import { test, expect, type Page } from '@playwright/test';
import { BASE } from './baseUrl';

test.setTimeout(120_000);

const TOTAL_ROWS = 3;

const SETTINGS_3ROWS = {
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
    totalRows: TOTAL_ROWS,
    ttsRate: 1.05,
    sessionLabelColId: null,
    sessionAutoLabel: 'nav-test',
    noisyMode: false,
    preferredVoiceName: '',
  },
  version: 12,
};

const MOCK_INIT_SCRIPT = `
(function() {
  var mockSynth = {
    speak: function(utterance) {
      try { if (utterance.onstart) utterance.onstart(new Event('start')); } catch(e) {}
      try { if (utterance.onend)   utterance.onend(new Event('end'));     } catch(e) {}
    },
    cancel: function() {},
    pause: function() {},
    resume: function() {},
    getVoices: function() {
      return [{ name: 'Mock Korean', lang: 'ko-KR', default: true, localService: true, voiceURI: 'mock' }];
    },
    speaking: false,
    pending: false,
    paused: false,
    onvoiceschanged: null,
    addEventListener: function() {},
    removeEventListener: function() {},
    dispatchEvent: function() { return true; },
  };
  try {
    Object.defineProperty(window, 'speechSynthesis', {
      get: function() { return mockSynth; },
      configurable: true,
      enumerable: true,
    });
  } catch(e1) {
    try {
      Object.defineProperty(Window.prototype, 'speechSynthesis', {
        get: function() { return mockSynth; },
        configurable: true,
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
  try {
    Object.defineProperty(window, 'SpeechRecognition', {
      value: MockSTT, writable: true, configurable: true, enumerable: true,
    });
  } catch(e1) {
    try { window.SpeechRecognition = MockSTT; } catch(e2) {}
  }
  try {
    Object.defineProperty(window, 'webkitSpeechRecognition', {
      value: MockSTT, writable: true, configurable: true, enumerable: true,
    });
  } catch(e) {
    try { window.webkitSpeechRecognition = MockSTT; } catch(e2) {}
  }
})();
`;

async function fireStt(page: Page, transcript: string, waitMs = 300) {
  await page.evaluate((t) => {
    const stt = (window as unknown as { __mockSTT?: { fireResult: (t: string, c: number) => void } }).__mockSTT;
    if (stt) stt.fireResult(t, 0.95);
  }, transcript);
  await page.waitForTimeout(waitMs);
}

async function waitForActiveChip(page: Page, colName: string, timeout = 4000) {
  await page.waitForFunction(
    (name) => {
      const chip = document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
      return (chip?.dataset.colName ?? '').includes(String(name));
    },
    colName,
    { timeout },
  ).catch(() => {});
}

async function waitForRow(page: Page, targetRow: number, timeout = 6000) {
  await page.waitForFunction(
    ({ r, total }) => {
      const m = document.body.innerText.match(new RegExp('(\\d+)\\s*\\/\\s*' + total + '\\s*행'));
      return m ? parseInt(m[1]) === r : false;
    },
    { r: targetRow, total: TOTAL_ROWS },
    { timeout },
  ).catch(() => {});
}

async function getActiveRow(page: Page): Promise<number> {
  const text = await page.evaluate(() => document.body.innerText);
  const m = text.match(new RegExp('(\\d+)\\s*\\/\\s*' + TOTAL_ROWS + '\\s*행'));
  return m ? parseInt(m[1]) : -1;
}

async function loadSessionsFromIDB(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db) return [];
    return new Promise<object[]>((res) => {
      const tx = db.transaction('sessions', 'readonly');
      const req = tx.objectStore('sessions').getAll();
      req.onsuccess = () => res(req.result as object[]);
      req.onerror = () => res([]);
    });
  });
}

async function startSession(page: Page) {
  await page.addInitScript(MOCK_INIT_SCRIPT);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem('agri-voicenote-settings-v3', JSON.stringify(s));
    indexedDB.deleteDatabase('agri-voicenote');
  }, SETTINGS_3ROWS);
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

// ─── Tests ──────────────────────────────────────────────────────────────────

test('NAV-1 — "다음" 행 skip → 후속 행 완료 시 완료 행 복귀 루프 없이 빈 행 안내 후 종료 대기(v0.23.0: 자동 종료 제거)', async ({ page }) => {
  await startSession(page);

  // ── Row 1: 정상 입력 ──
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '35.1', 300);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '28.3', 300);
  await waitForRow(page, 2);

  // ── Row 2: "다음"으로 skip (2026-06-10 로그의 행 17 skip 재현) ──
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '다음행', 400);
  await waitForRow(page, 3);
  expect(await getActiveRow(page)).toBe(3);

  // ── Row 3(마지막): 완료 — 수정 전엔 여기서 returnRow가 skip 행(2)으로 복귀시키고,
  //    이후 "다음"이 완료 행을 재프롬프트하는 무한 루프(NAV-1)에 빠졌다.
  //    v0.23.0 입력탭#4 — 자동 종료를 제거했다. 마지막 행 완료 후엔 빈 행 안내 후 '종료'까지
  //    세션을 유지하되(ready 복귀 금지), NAV-1 루프(row 2로 무한 복귀)는 없어야 한다. ──
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '41.3', 300);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '30.2', 600);

  // v0.23.0 — 자동 종료하지 않으므로 ready('음성 입력 시작')로 복귀하지 않는다(안내 후 대기).
  await page.waitForTimeout(900); // 종료 안내 TTS·증분 persist 안정화
  const backToReady = await page.locator('text=음성 입력 시작').first()
    .isVisible({ timeout: 1500 }).catch(() => false);
  expect(backToReady).toBe(false);
  // NAV-1 루프 부재: skip 행 2로 되돌아가 머물지 않는다(완료 행 무한 복귀 금지).
  expect(await getActiveRow(page)).not.toBe(2);

  // 빈 행 안내 멘트가 마지막 TTS로 나갔는지 (lastTts는 ready 전환 후 사라질 수 있으므로 로그로 검증)
  const events = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db) return [];
    return new Promise<Array<{ type: string; ttsText?: string; extra?: string }>>((res) => {
      const tx = db.transaction('logEvents', 'readonly');
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result as Array<{ type: string; ttsText?: string; extra?: string }>);
      req.onerror = () => res([]);
    });
  });
  const emptyAnnounce = events.find(
    (e) => (e.ttsText ?? '').includes('비어 있습니다')
      || (e.extra ?? '').startsWith('end_with_empty_rows')
      || (e.extra ?? '').startsWith('end_reached_waiting'), // v0.23.0 — 안내 후 대기 이벤트
  );
  expect(emptyAnnounce).toBeTruthy();

  // ── IDB: skip한 행 2가 complete=false placeholder로 존재 + 행 순서 정렬 ──
  const sessions = await loadSessionsFromIDB(page) as Array<{
    completedRows: number;
    rows: Array<{ index: number; complete: boolean; values: Record<string, string> }>;
  }>;
  expect(sessions.length).toBe(1);
  const sess = sessions[0];
  expect(sess.completedRows).toBe(2);
  expect(sess.rows.map((r) => r.index)).toEqual([1, 2, 3]);
  const row2 = sess.rows.find((r) => r.index === 2)!;
  expect(row2.complete).toBe(false);
  expect(row2.values['c8'] ?? '').toBe('');
  expect(row2.values['c9'] ?? '').toBe('');
  expect(row2.values['c6']).toBe('2'); // 자동값은 채워짐
  const row3 = sess.rows.find((r) => r.index === 3)!;
  expect(row3.complete).toBe(true);
  expect(row3.values['c8']).toBe('41.3');

  // ── 데이터탭: complete=false 행 번호 amber 강조 ──
  await page.locator('[data-testid="tab-data"]').click();
  await page.waitForTimeout(400);
  // 세션 카드 펼치기 (오늘 날짜 카드)
  // 앱은 로컬 날짜(getFullYear/Month/Date)로 세션 카드를 표시한다(session-local-date 수정). 테스트도
  //   동일 포뮬러를 써야 자정 경계(로컬↔UTC 날짜 어긋남)에서 카드를 못 찾는 flaky를 피한다.
  const _d = new Date();
  const today = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, '0')}-${String(_d.getDate()).padStart(2, '0')}`;
  await page.locator(`text=${today}`).first().click();
  await page.waitForTimeout(400);
  const amberRowNum = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('div'))
      .filter((d) => d.children.length === 0 && d.textContent?.trim() === '2');
    return cells.some((c) => getComputedStyle(c).color === 'rgb(255, 234, 0)');
  });
  expect(amberRowNum).toBe(true);
});

test('NAV-1 — "종료" 명령 시에도 skip된 빈 행 안내 1회', async ({ page }) => {
  await startSession(page);

  // Row 1 완료 → Row 2 skip → Row 3에서 "종료"
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '35.1', 300);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '28.3', 300);
  await waitForRow(page, 2);
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '다음행', 400);
  await waitForRow(page, 3);
  await fireStt(page, '종료', 1200);

  const backToReady = await page.locator('text=음성 입력 시작').first()
    .isVisible({ timeout: 6000 }).catch(() => false);
  expect(backToReady).toBe(true);

  const events = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db) return [];
    return new Promise<Array<{ type: string; ttsText?: string }>>((res) => {
      const tx = db.transaction('logEvents', 'readonly');
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result as Array<{ type: string; ttsText?: string }>);
      req.onerror = () => res([]);
    });
  });
  const announce = events.filter((e) => (e.ttsText ?? '').includes('비어 있습니다'));
  expect(announce.length).toBe(1); // 1회만 안내
});

test('NAV-2 / W3 — "유지": 빈 칸이면 명시 피드백, 완료 행 검토 대기에선 값 보존 후 원래 행 복귀', async ({ page }) => {
  await startSession(page);

  // ── 케이스 1: 빈 칸에서 "유지" → 명시 피드백(음성 안내 + advance 안 함) ──
  // v0.21.0 입력탭#1 — 화면 본문 TTS 에코(sess.lastTts 렌더)가 제거되어 "유지할 값이 없습니다"는
  //   더 이상 화면에 글자로 뜨지 않는다(say()/setLastTts 음성·스토어 안내는 유지). 따라서 화면
  //   텍스트 대신 keep_no_value 로그 이벤트로 "빈 칸 유지 → 명시 피드백" 계약을 검증한다.
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '유지', 500);
  const keepNoValueLogged = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db) return false;
    const events = await new Promise<Array<{ type: string; extra?: string }>>((res) => {
      const tx = db.transaction('logEvents', 'readonly');
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result as Array<{ type: string; extra?: string }>);
      req.onerror = () => res([]);
    });
    return events.some((e) => e.type === 'command' && e.extra === 'keep_no_value');
  });
  expect(keepNoValueLogged).toBe(true);
  // 여전히 행 1 횡경 대기 (advance되지 않음)
  expect(await getActiveRow(page)).toBe(1);

  // ── Row 1 완료 → Row 2 진입 ──
  await fireStt(page, '35.1', 300);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '28.3', 300);
  await waitForRow(page, 2);

  // ── 케이스 2(v0.33.0 재작성): "이전" → 완료 행 검토 대기 → "유지" → 값 보존 + 원래 행 복귀 ──
  // (구 동작: 행 1 재입력 모드 진입 + 필드별 "유지" 2회. 신 동작: 단순 이동 + 값 낭독 대기,
  //  "유지" 1회로 검토를 마치고 returnRow(행 2)로 복귀.)
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '이전행', 600); // 행 1(완료)로 단순 이동 → 검토 대기
  await waitForRow(page, 1);
  expect(await getActiveRow(page)).toBe(1);
  await fireStt(page, '유지', 600); // 검토 종료 → 원래 있던 행 2로 복귀
  await waitForRow(page, 2);
  expect(await getActiveRow(page)).toBe(2);

  // 값이 그대로인지 확인 후 종료
  await fireStt(page, '종료', 1000);
  const sessions = await loadSessionsFromIDB(page) as Array<{
    rows: Array<{ index: number; values: Record<string, string> }>;
  }>;
  const row1 = sessions[0]?.rows.find((r) => r.index === 1);
  expect(row1?.values['c8']).toBe('35.1');
  expect(row1?.values['c9']).toBe('28.3');
});

// ─── v0.33.0 백로그 A(민구 결정 3): 완료 행 착지 = "값 읽어주기 + 대기" ────────────────

async function loadLogEventsFromIDB(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db) return [];
    return new Promise<Array<{ type: string; ttsText?: string; extra?: string; parsed?: string }>>((res) => {
      const tx = db.transaction('logEvents', 'readonly');
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result as Array<{ type: string; ttsText?: string; extra?: string; parsed?: string }>);
      req.onerror = () => res([]);
    });
  });
}

test('REVIEW — "이전"으로 완료 행 착지: 값 낭독 + bare 값 무시 + "수정 <값>"만 반영(포인터=첫 필드) + "다음" 복귀', async ({ page }) => {
  await startSession(page);

  // Row 1 완료(35.1 / 28.3) → Row 2 진입
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '35.1', 300);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '28.3', 300);
  await waitForRow(page, 2);

  // "이전" → 완료 행 1 착지: 기록값 낭독("1행 완료됨. 횡경 35.1, 종경 28.3") 후 명령 대기
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '이전행', 600);
  await waitForRow(page, 1);
  const events1 = await loadLogEventsFromIDB(page);
  const reviewTts = events1.find(
    (e) => e.type === 'tts' && (e.ttsText ?? '').includes('1행 완료됨'),
  );
  expect(reviewTts, '완료 행 착지 시 "N행 완료됨" 값 낭독 TTS가 없음').toBeTruthy();
  expect(reviewTts!.ttsText).toContain('35.1');
  expect(reviewTts!.ttsText).toContain('28.3');
  // 음성 '이전' 경유 이동의 attribution이 voice로 기록된다(v0.33.0 B-1).
  const voiceJump = events1.find(
    (e) => e.type === 'command' && e.parsed === 'jump' && (e.extra ?? '').startsWith('voice:'),
  );
  expect(voiceJump, "음성 '이전' 이동이 voice: attribution으로 기록되지 않음").toBeTruthy();

  // bare 값 발화는 완료 행을 덮어쓰지 않는다(민구 결정 3 — 덮어쓰기 금지).
  await fireStt(page, '99.9', 600);
  expect(await getActiveRow(page)).toBe(1); // 이동/advance 없음

  // v0.34.0 A3 — 검토 대기 계측: 착지 컬럼(첫 필드)이 로그로 재구성 가능해야 한다(D11c).
  const reviewArm = events1.find(
    (e) => e.type === 'command' && e.parsed === 'review_wait' && (e.extra ?? '').includes('row=1,col=first'),
  );
  expect(reviewArm, 'review_wait 계측(row=1,col=first) 미기록').toBeTruthy();

  // "수정 <값>"은 그 행 **포인터(첫) 음성 필드**(횡경)를 고친다(v0.34.0 A3 확정 규칙 — 이전의
  // '마지막 필드' 타깃 단언에서 의도적으로 반전) 후 검토 대기 재낭독.
  await fireStt(page, '수정 30.7', 800);
  expect(await getActiveRow(page)).toBe(1);

  // "다음" → 검토를 마치고 다음 미완료 행(2)으로 전진.
  await fireStt(page, '다음행', 600);
  await waitForRow(page, 2);
  expect(await getActiveRow(page)).toBe(2);

  // 종료 후 IDB 확인: bare 값(99.9)은 어디에도 없고, 수정(30.7)만 반영, 횡경은 원본 유지.
  await fireStt(page, '종료', 1000);
  const sessions = await loadSessionsFromIDB(page) as Array<{
    rows: Array<{ index: number; complete: boolean; values: Record<string, string> }>;
  }>;
  const row1 = sessions[0]?.rows.find((r) => r.index === 1);
  expect(row1?.values['c8']).toBe('30.7'); // '수정 30.7' → 포인터(첫) 음성 필드 반영(v0.34.0 A3 반전)
  expect(row1?.values['c9']).toBe('28.3'); // 마지막 필드는 불변 + bare 99.9로 덮이지 않음
  expect(row1?.complete).toBe(true);
  const anyBareCommit = sessions[0]?.rows.some(
    (r) => r.values['c8'] === '99.9' || r.values['c9'] === '99.9',
  );
  expect(anyBareCommit).toBe(false);
});
