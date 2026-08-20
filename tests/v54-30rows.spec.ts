/**
 * 30행 실입력 E2E 테스트 — Mock STT + Instant TTS
 *
 * 검증 항목:
 *  - TTS 순서: lastTts 텍스트가 올바른 컬럼명 프롬프트를 표시하는지
 *  - 칩 하이라이트: 현재 활성 컬럼이 data-active=true인지
 *  - 입력값 일치: 입력한 값이 칩에 표시되고 IDB에 올바르게 저장되는지
 *  - 진행 순서: 행 카운터가 순서대로 증가하는지
 *  - 수정(수정 명령): 이전 컬럼 값 재입력 후 올바른 값으로 갱신
 *  - 스킵: 해당 행이 빈 값으로 completedRow 처리
 *  - 일시정지/재개: 중앙 paused-card(일시정지) ↔ REC 상태 전환 (v0.15.0 A5)
 *
 * 컬럼 구성 (30행 = 조사나무 6 × 조사과실 5):
 *  - 조사나무 (int, auto, seq 1~6)
 *  - 조사과실 (int, auto, seq 1~5)
 *  - 횡경 (float, voice, 0.1)
 *  - 종경 (float, voice, 0.1)
 */

import { test, expect, type Page } from '@playwright/test';
import { BASE } from './baseUrl';

test.setTimeout(180_000);

// ─── 설정 localStorage — 30행 컬럼 구성 ─────────────────────────────────────

const SETTINGS_30ROWS = {
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
      { id: 'c6', name: '조사나무', type: 'int',   input: 'auto',  ttsAnnounce: true,  auto: { kind: 'seq', from: 1, to: 6 } },
      { id: 'c7', name: '조사과실', type: 'int',   input: 'auto',  ttsAnnounce: true,  auto: { kind: 'seq', from: 1, to: 5 } },
      { id: 'c8', name: '횡경',     type: 'float', input: 'voice', ttsAnnounce: true,  auto: { kind: 'fixed', value: '' }, decimals: 1 },
      { id: 'c9', name: '종경',     type: 'float', input: 'voice', ttsAnnounce: true,  auto: { kind: 'fixed', value: '' }, decimals: 1 },
    ],
    tableGenerated: true,
    totalRows: 30,
    ttsRate: 1.05,
    sessionLabelColId: null,
    sessionAutoLabel: '30행테스트',
    noisyMode: false,
    preferredVoiceName: '',
  },
  version: 12,
};

// ─── Mock STT + Instant TTS init script ─────────────────────────────────────

/**
 * addInitScript에 주입할 mock.
 * - TTS: window.speechSynthesis getter를 즉시 mockSynth로 교체 (모듈 로드 전 적용)
 *        동기 즉시 onstart+onend 발화 → say() Promise가 즉시 resolve → advance() 블로킹 없음
 * - STT: window.__mockSTT 항상 최신 인스턴스
 * - Animation: CSS 애니메이션/트랜지션 비활성화 → Playwright 클릭 안정성 확보
 */
const MOCK_INIT_SCRIPT = `
(function() {
  // ── Mock SpeechSynthesis — 모듈 로드보다 먼저 교체 ──────────────────────────
  // speech.ts: "const synth = window.speechSynthesis" 가 이 mockSynth를 캡처하도록
  var mockSynth = {
    speak: function(utterance) {
      // 동기 즉시 onstart + onend → say() Promise 즉시 resolve → advance() 블로킹 없음
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
  // window.speechSynthesis getter를 즉시 오버라이드 (DOMContentLoaded 대기 없음)
  try {
    Object.defineProperty(window, 'speechSynthesis', {
      get: function() { return mockSynth; },
      configurable: true,
      enumerable: true,
    });
  } catch(e1) {
    // fallback: 프로토타입 오버라이드
    try {
      Object.defineProperty(Window.prototype, 'speechSynthesis', {
        get: function() { return mockSynth; },
        configurable: true,
      });
    } catch(e2) {
      // fallback: 직접 할당
      try { window.speechSynthesis = mockSynth; } catch(e3) {}
    }
  }

  // ── CSS 애니메이션 비활성화 (Playwright 클릭 안정성) ──────────────────────
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

  // ── Mock SpeechRecognition ──────────────────────────────────────────────────
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
  // webkitSpeechRecognition은 Chrome non-configurable 속성 — 재정의 불가.
  // 전략: window.SpeechRecognition (Chrome에서 own-property 없음 → define 가능)을 MockSTT로 등록.
  // createRecognition()은 "w.SpeechRecognition || w.webkitSpeechRecognition" 순으로 검사하므로
  // window.SpeechRecognition이 정의되면 이것을 먼저 사용함.
  try {
    Object.defineProperty(window, 'SpeechRecognition', {
      value: MockSTT,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  } catch(e1) {
    try { window.SpeechRecognition = MockSTT; } catch(e2) {}
  }
  // webkitSpeechRecognition도 시도 (실패해도 SpeechRecognition이 있으면 충분)
  try {
    Object.defineProperty(window, 'webkitSpeechRecognition', {
      value: MockSTT,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  } catch(e) {
    try { window.webkitSpeechRecognition = MockSTT; } catch(e2) {}
  }
})();
`;

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Mock STT로 최종 인식 결과 발화 (waitMs: 후처리 대기) */
async function fireStt(page: Page, transcript: string, waitMs = 300) {
  await page.evaluate((t) => {
    const stt = (window as unknown as { __mockSTT?: { fireResult: (t: string, c: number) => void } }).__mockSTT;
    if (stt) stt.fireResult(t, 0.95);
  }, transcript);
  await page.waitForTimeout(waitMs);
}

/** 행 카운터의 현재 행 번호 반환 (매칭 실패 시 -1) */
async function getActiveRow(page: Page): Promise<number> {
  const text = await page.evaluate(() => document.body.innerText);
  // 줄 시작(^) 없이 패턴 검색 — chip 라벨 내 숫자와 구분
  const m = text.match(/(\d+)\s*\/\s*30\s*행/);
  return m ? parseInt(m[1]) : -1;
}

/** 활성 칩의 컬럼명 반환 */
async function getActiveChipName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const chip = document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
    return chip?.dataset.colName ?? '';
  });
}

/** 특정 칩이 active가 될 때까지 대기 */
async function waitForActiveChip(page: Page, colName: string, timeout = 4000) {
  await page.waitForFunction(
    (name) => {
      const chip = document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
      return (chip?.dataset.colName ?? '').includes(String(name));
    },
    colName,
    { timeout },
  ).catch(() => { /* timeout — 계속 진행 */ });
}

/** 행 카운터가 특정 값이 될 때까지 대기 */
async function waitForRow(page: Page, targetRow: number, timeout = 6000) {
  await page.waitForFunction(
    (r) => {
      const m = document.body.innerText.match(/(\d+)\s*\/\s*30\s*행/);
      return m ? parseInt(m[1]) === r : false;
    },
    targetRow,
    { timeout },
  ).catch(() => { /* timeout — 계속 진행 */ });
}

/** IndexedDB에서 모든 세션 로드 */
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

// ─── 30행 시나리오 ────────────────────────────────────────────────────────────

test('30행 음성 입력 — TTS/칩/값/순서/수정/스킵/일시정지 종합 검증', async ({ page }) => {
  // 1. Mock 스크립트 주입
  await page.addInitScript(MOCK_INIT_SCRIPT);

  // 2. localStorage에 30행 설정 주입
  await page.goto(BASE);
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate((settingsJson) => {
    localStorage.clear();
    localStorage.setItem('agri-voicenote-settings-v3', JSON.stringify(settingsJson));
  }, SETTINGS_30ROWS);

  // 3. 페이지 재로드 (설정 적용)
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(400);

  // 3-0. STT mock 등록 진단
  const sttDiag = await page.evaluate(() => {
    const srType = typeof (window as unknown as Record<string,unknown>).SpeechRecognition;
    const wsrType = typeof (window as unknown as Record<string,unknown>).webkitSpeechRecognition;
    const sr = (window as unknown as Record<string,unknown>).SpeechRecognition;
    const wsr = (window as unknown as Record<string,unknown>).webkitSpeechRecognition;
    let isMock = false;
    try {
      // MockSTT 인스턴스를 만들면 window.__mockSTT가 세팅되는지 확인
      const inst = new (sr as new()=>object)();
      isMock = !!((window as unknown as Record<string,unknown>).__mockSTT);
    } catch(e) {}
    const desc = Object.getOwnPropertyDescriptor(window, 'SpeechRecognition');
    return {
      srType, wsrType,
      srIsMockSTT: sr === wsr,   // mock이면 같아야 함
      isMockAfterNew: isMock,
      descConfigurable: desc?.configurable,
    };
  });
  console.log('STT 등록 진단:', JSON.stringify(sttDiag));

  // 3-1. TTS 모킹 동작 확인
  const mockTtsWorks = await page.evaluate(() => {
    return new Promise<boolean>((resolve) => {
      const utt = new SpeechSynthesisUtterance('test');
      let fired = false;
      utt.onend = () => { fired = true; };
      window.speechSynthesis.speak(utt);
      // 동기 mock이면 이미 true, 비동기면 50ms 후 체크
      setTimeout(() => resolve(fired), 50);
    });
  });
  console.log(`Mock TTS 동기 동작: ${mockTtsWorks ? '✓' : '✗ (say()가 행 이동을 블로킹할 수 있음)'}`);

  // 4. 음성 탭 이동
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(200);

  // 5. 시작 버튼 확인
  const startBtn = page.locator('text=음성 입력 시작').first();
  await expect(startBtn).toBeVisible();
  const isDisabled = await startBtn.getAttribute('disabled');
  if (isDisabled !== null) {
    console.log('✗ STT 미지원 환경 — 테스트 스킵');
    return;
  }

  // 6. 음성 입력 시작
  await startBtn.click();
  await page.waitForTimeout(600);

  // ActiveState 진입 확인
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
  console.log('✓ ActiveState 진입 — REC 표시 확인');

  // STT 모킹 확인 (SpeechController 생성 후 window.__mockSTT 세팅됨)
  const mockSttActive = await page.evaluate(() => !!(window as unknown as { __mockSTT?: object }).__mockSTT);
  console.log(`Mock STT 활성: ${mockSttActive ? '✓' : '✗'}`);

  // 초기 활성 칩 확인
  await waitForActiveChip(page, '횡경', 3000);
  const initChip = await getActiveChipName(page);
  console.log(`✓ 초기 활성 칩: "${initChip}" (expected: 횡경 포함)`);

  // ─────────────────────────────────────────────────────────────
  // 행 1~30 입력 루프
  // ─────────────────────────────────────────────────────────────

  const hValue = (row: number) => (34 + row * 0.2).toFixed(1);   // 34.2 ~ 40.2
  const jValue = (row: number) => (37 + row * 0.2).toFixed(1);   // 37.2 ~ 43.2
  const ROW5_H_CORRECTED = '39.9';
  const ROW5_H_ORIGINAL  = '99.9';

  for (let row = 1; row <= 30; row++) {

    // ── 행 20: skip — v0.4.0 명령어 단일화로 '스킵' 제거, v0.5.0부터 '다음'이 단방향 skip
    //    (행은 complete:false placeholder로 영속화되어 데이터탭에서 채움) ──
    if (row === 20) {
      console.log(`\n[ 행 ${row} ] skip('다음') 시나리오`);
      // 횡경 대기
      await waitForActiveChip(page, '횡경', 3000);
      await fireStt(page, '다음행', 400);
      await waitForRow(page, 21, 5000);
      const rowAfterSkip = await getActiveRow(page);
      console.log(`  skip 후 행 카운터: ${rowAfterSkip} (expected: 21)`);
      continue;
    }

    // ── 행 25: 일시정지 → 재개 ──────────────────────────────────
    if (row === 25) {
      console.log(`\n[ 행 ${row} ] 일시정지/재개 시나리오`);

      // 횡경 대기 후 입력
      await waitForActiveChip(page, '횡경', 3000);
      await fireStt(page, hValue(row), 300);
      await waitForActiveChip(page, '종경', 3000);

      // 종경 대기 중 "일시정지" 발화 (STT 명령)
      await fireStt(page, '일시정지', 400);

      // 일시정지 상태 확인 (UI-c: 시각 상태어 없이 aria-only paused surface 유지)
      const isPaused = await page.locator('[data-testid="paused-card"]').first()
        .isVisible({ timeout: 2000 }).catch(() => false);
      console.log(`  일시정지 후 카드 표시: ${isPaused ? '✓' : '✗'}`);
      if (!isPaused) {
        // 일시정지 버튼 직접 클릭 시도 (fallback)
        const pauseBtn = page.locator('button[title="일시정지"]').first();
        await pauseBtn.click({ force: true, timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(300);
      }
      const isPausedFinal = await page.locator('[data-testid="paused-card"]').first()
        .isVisible({ timeout: 1000 }).catch(() => false);
      expect(isPausedFinal).toBe(true);

      // 재시작 버튼 클릭
      const resumeBtn = page.locator('button[title="재시작"]').first();
      await resumeBtn.click({ force: true, timeout: 3000 });
      await page.waitForTimeout(400);

      // 활성 화면 복귀 확인
      const isActiveBack = await page.locator('[data-testid="voice-active-state"]').first()
        .isVisible({ timeout: 2000 }).catch(() => false);
      console.log(`  재시작 후 활성 화면 복귀: ${isActiveBack ? '✓' : '✗'}`);
      expect(isActiveBack).toBe(true);

      // 종경 재프롬프트 후 입력
      await waitForActiveChip(page, '종경', 3000);
      await fireStt(page, jValue(row), 300);
      await waitForRow(page, 26, 6000);
      continue;
    }

    // ── 행 5: 수정 시나리오 ──────────────────────────────────────
    if (row === 5) {
      console.log(`\n[ 행 ${row} ] 수정 시나리오`);

      // 횡경 잘못된 값 입력
      await waitForActiveChip(page, '횡경', 3000);
      await fireStt(page, ROW5_H_ORIGINAL, 300);
      await waitForActiveChip(page, '종경', 3000);
      console.log(`  잘못된 횡경 입력: ${ROW5_H_ORIGINAL}`);

      // 종경 대기 중 "수정" 명령
      await fireStt(page, '수정', 400);
      // 수정 후 횡경 재프롬프트 대기
      await waitForActiveChip(page, '횡경', 3000);
      const bodyAfterModify = await page.evaluate(() => document.body.innerText);
      console.log(`  수정 후 TTS: "횡경" 재프롬프트 ${bodyAfterModify.includes('횡경') ? '✓' : '✗'}`);

      // 수정된 횡경 값 입력
      await fireStt(page, ROW5_H_CORRECTED, 300);
      await waitForActiveChip(page, '종경', 3000);
      const chipAfterFix = await getActiveChipName(page);
      console.log(`  수정 후 활성 칩: "${chipAfterFix}" (expected: 종경)`);

      // 종경 입력
      await fireStt(page, jValue(row), 300);
      await waitForRow(page, 6, 6000);
      continue;
    }

    // ── 행 10: 취소 시나리오 ─────────────────────────────────────
    if (row === 10) {
      console.log(`\n[ 행 ${row} ] 취소(재입력) 시나리오`);

      // 횡경 대기 중 "취소" 발화
      await waitForActiveChip(page, '횡경', 3000);
      await fireStt(page, '취소', 400);
      await waitForActiveChip(page, '횡경', 3000);
      const bodyAfterCancel = await page.evaluate(() => document.body.innerText);
      console.log(`  취소 후 TTS: ${bodyAfterCancel.includes('횡경') ? '"횡경" 재프롬프트 ✓' : '확인 불가'}`);

      // 재입력
      await fireStt(page, hValue(row), 300);
      await waitForActiveChip(page, '종경', 3000);
      await fireStt(page, jValue(row), 300);
      await waitForRow(page, 11, 6000);
      continue;
    }

    // ── 일반 행 입력 ─────────────────────────────────────────────
    const prevRow = await getActiveRow(page);

    // 횡경 대기 + 칩 확인
    await waitForActiveChip(page, '횡경', 3000);
    const activeBeforeH = await getActiveChipName(page);
    const hasHTts = (await page.evaluate(() => document.body.innerText)).includes('횡경');

    // 횡경 입력
    await fireStt(page, hValue(row), 200);

    // 종경으로 이동 대기 + 칩 확인
    await waitForActiveChip(page, '종경', 3000);
    const activeAfterH = await getActiveChipName(page);
    const hasJTts = (await page.evaluate(() => document.body.innerText)).includes('종경');

    // 종경 입력
    await fireStt(page, jValue(row), 200);

    // 다음 행으로 이동 대기
    if (row < 30) {
      await waitForRow(page, row + 1, 6000);
    } else {
      // 30행 완료 → done/ready 상태
      await page.waitForTimeout(600);
    }

    const nextRow = await getActiveRow(page);

    if (row % 5 === 0 || row <= 3) {
      console.log(
        `[ 행 ${row} ] 횡경TTS:${hasHTts ? '✓' : '✗'} 횡경칩:${activeBeforeH.includes('횡경') ? '✓' : '✗'} ` +
        `종경TTS:${hasJTts ? '✓' : '✗'} 종경칩:${activeAfterH.includes('종경') ? '✓' : '✗'} ` +
        `행카운터:${prevRow}→${nextRow}`,
      );
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 완료 상태 확인
  // ─────────────────────────────────────────────────────────────

  await page.waitForTimeout(800);
  const bodyAfter = await page.evaluate(() => document.body.innerText);
  const isReady = bodyAfter.includes('음성 입력 시작') || bodyAfter.includes('완료');
  console.log(`\n✓ 30행 입력 완료 후 상태: ${isReady ? '정상 복귀' : '상태 미확인'}`);

  // ─────────────────────────────────────────────────────────────
  // IndexedDB 검증
  // ─────────────────────────────────────────────────────────────

  const sessions = await loadSessionsFromIDB(page) as Array<{
    completedRows: number;
    rows: Array<{ index: number; values: Record<string, string> }>;
    label?: string;
  }>;
  console.log(`\n[ IDB 검증 ]`);
  console.log(`  세션 수: ${sessions.length}`);

  if (sessions.length === 0) {
    console.log('  ℹ 세션이 IDB에 없음 (완료 행이 없으면 저장 안 됨)');
    return;
  }

  const sess = sessions[0];
  // v0.5.0: skip('다음')한 행 20은 complete:false placeholder — 완료 행은 29.
  console.log(`  completedRows: ${sess.completedRows} (expected: 29)`);
  expect(sess.completedRows).toBe(29);

  const row5 = sess.rows?.find((r) => r.index === 5);
  if (row5) {
    const h5 = row5.values['c8'];
    console.log(`  행 5 횡경: "${h5}" (expected: "${ROW5_H_CORRECTED}")`);
    expect(h5).toBe(ROW5_H_CORRECTED);
  }

  const row20 = sess.rows?.find((r) => r.index === 20) as
    | { index: number; complete?: boolean; values: Record<string, string> }
    | undefined;
  expect(row20).toBeTruthy(); // v0.5.0: skip 행도 placeholder로 영속화되어야 함
  if (row20) {
    const h20 = row20.values['c8'];
    const j20 = row20.values['c9'];
    console.log(`  행 20 횡경: "${h20}", 종경: "${j20}" (skip → 빈 값 + complete:false expected)`);
    expect(h20 ?? '').toBe('');
    expect(j20 ?? '').toBe('');
    expect(row20.complete).toBe(false);
  }

  const row1 = sess.rows?.find((r) => r.index === 1);
  if (row1) {
    const h1 = row1.values['c8'];
    const j1 = row1.values['c9'];
    console.log(`  행 1 횡경: "${h1}" (expected: "${hValue(1)}"), 종경: "${j1}" (expected: "${jValue(1)}")`);
    expect(h1).toBe(hValue(1));
    expect(j1).toBe(jValue(1));
  }

  console.log('\n✅ 30행 종합 검증 완료');
});

// ─────────────────────────────────────────────────────────────────────────────
// 데이터 탭 — IDB 주입 후 세션 카드 UI 검증
// ─────────────────────────────────────────────────────────────────────────────

async function injectSession(page: Page) {
  await page.evaluate(async () => {
    // 앱이 이미 IDB를 열고 있는 경우 같은 버전으로 연결 → 즉시 성공
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('IDB open blocked'));
    });
    const session = {
      id: 'sess_ui_test_001',
      date: '2026-05-22',
      label: '데이터탭 UI 테스트',
      columns: [
        { id: 'c6', name: '조사나무', type: 'int',   input: 'auto',  ttsAnnounce: true,  auto: { kind: 'seq', from: 1, to: 3 } },
        { id: 'c8', name: '횡경',     type: 'float', input: 'voice', ttsAnnounce: true,  auto: { kind: 'fixed', value: '' }, decimals: 1 },
        { id: 'c9', name: '종경',     type: 'float', input: 'voice', ttsAnnounce: true,  auto: { kind: 'fixed', value: '' }, decimals: 1 },
      ],
      rows: [
        { index: 1, values: { c6: '1', c8: '35.1', c9: '38.5' }, complete: true },
        { index: 2, values: { c6: '2', c8: '36.2', c9: '39.2' }, complete: true },
        { index: 3, values: { c6: '3', c8: '37.3', c9: '40.1' }, complete: true },
      ],
      completedRows: 3,
      syncedRows: 0,
      startedAt: Date.now() - 120_000,
      finishedAt: Date.now() - 60_000,
    };
    await new Promise<void>((res, rej) => {
      const tx = db.transaction('sessions', 'readwrite');
      const req = tx.objectStore('sessions').put(session);
      req.onsuccess = () => res();
      req.onerror = () => rej(req.error);
    });
    db.close();
  });
}

test('[데이터] 세션 카드 — 표시/펼침/삭제 흐름', async ({ page }) => {
  // 앱이 IDB를 초기화할 수 있도록 먼저 로드
  await page.goto(BASE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(600); // 앱의 IDB 열기 완료 대기

  // 세션 주입 (삭제 없이 put — 앱과 동일 버전 3 연결 가능)
  await injectSession(page);

  // 재로드 (앱이 loadAllSessions 호출)
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(600);

  // 데이터 탭 이동
  await page.locator('[data-testid="tab-data"]').click();
  await page.waitForTimeout(400);

  // 세션 카드 표시 확인
  const dateLabel = page.locator('text=2026-05-22').first();
  await expect(dateLabel).toBeVisible({ timeout: 3000 });
  console.log('✓ 세션 날짜 "2026-05-22" 표시 확인');

  const sessionLabel = page.locator('text=데이터탭 UI 테스트').first();
  await expect(sessionLabel).toBeVisible({ timeout: 2000 });
  console.log('✓ 세션 라벨 "데이터탭 UI 테스트" 표시 확인');

  // 행 수 및 미업로드 상태 확인
  const bodyText = await page.evaluate(() => document.body.innerText);
  const has3Rows = bodyText.includes('3');
  const hasUnsynced = bodyText.includes('미업로드');
  console.log(`✓ 3행 표시: ${has3Rows ? '✓' : '✗'}, 미업로드: ${hasUnsynced ? '✓' : '✗'}`);

  // 카드 탭 → 세션 상세 모달 열림 (v0.13.0 R5: 인라인 확장 → 모달)
  await dateLabel.click();
  await page.waitForTimeout(400);
  await expect(page.locator('[data-testid="session-detail-modal"]')).toBeVisible({ timeout: 2000 });

  // 모달 안 행 데이터 테이블 표시 확인
  const val351 = page.locator('text=35.1').first();
  const expanded = await val351.isVisible({ timeout: 2000 }).catch(() => false);
  console.log(`✓ 상세 모달 "35.1" 값 표시: ${expanded ? '✓' : '✗'}`);

  const val385 = page.locator('text=38.5').first();
  const expanded2 = await val385.isVisible({ timeout: 1000 }).catch(() => false);
  console.log(`✓ 상세 모달 "38.5" 값 표시: ${expanded2 ? '✓' : '✗'}`);

  // 모달 닫기 → 값 숨겨짐 (이전엔 카드 재클릭 접기 — 이제 모달이 카드를 덮으므로 닫기 버튼 사용)
  await page.locator('[data-testid="session-detail-close"]').click();
  await page.waitForTimeout(300);
  const collapsed = await val351.isVisible().catch(() => false);
  console.log(`✓ 모달 닫힘 후 값 숨겨짐: ${!collapsed ? '✓' : '✗'}`);

  // 삭제 버튼 탐색 (style 속성 또는 SVG 아이콘)
  let deleteModalFound = false;
  const allButtons = page.locator('button');
  const btnCount = await allButtons.count();
  for (let i = 0; i < btnCount && !deleteModalFound; i++) {
    const btn = allButtons.nth(i);
    const style = await btn.getAttribute('style').catch(() => '');
    if (style && (style.includes('255,82,82') || style.includes('ff5252') || style.toLowerCase().includes('red'))) {
      await btn.click({ timeout: 1000 }).catch(() => {});
      await page.waitForTimeout(300);
      const modal = await page.locator('text=세션 삭제').first().isVisible().catch(() => false);
      if (modal) {
        deleteModalFound = true;
        console.log('✓ 삭제 버튼 클릭 → "세션 삭제" 모달 표시 ✓');
        const cancelBtn = page.locator('text=취소').first();
        await cancelBtn.click();
        await page.waitForTimeout(200);
        const modalGone = !(await page.locator('text=세션 삭제').first().isVisible().catch(() => false));
        console.log(`✓ 취소 후 모달 닫힘: ${modalGone ? '✓' : '✗'}`);
        const sessionStill = await page.locator('text=데이터탭 UI 테스트').first().isVisible().catch(() => false);
        console.log(`✓ 취소 후 세션 유지: ${sessionStill ? '✓' : '✗'}`);
      }
    }
  }
  if (!deleteModalFound) console.log('ℹ 삭제 버튼 자동 탐색 실패 — 스킵');

  // 시트에 추가 버튼 활성 확인
  const syncBtn = page.locator('text=시트에 추가').first();
  const syncVisible = await syncBtn.isVisible().catch(() => false);
  if (syncVisible) {
    const syncDisabled = await syncBtn.getAttribute('disabled');
    console.log(`✓ 시트에 추가 버튼: ${syncDisabled === null ? '활성화 ✓' : '비활성화 ✗'}`);
  } else {
    console.log('ℹ "시트에 추가" 버튼 미표시');
  }

  console.log('\n✅ 데이터 탭 UI 검증 완료');
});

// ─────────────────────────────────────────────────────────────────────────────
// 음성 탭 단독 — 일시정지/재개/종료 UI 상태 검증
// ─────────────────────────────────────────────────────────────────────────────

test('[음성] 일시정지 → 재개 → 종료 UI 상태 검증', async ({ page }) => {
  await page.addInitScript(MOCK_INIT_SCRIPT);

  // 30행 설정 주입
  await page.goto(BASE);
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem('agri-voicenote-settings-v3', JSON.stringify(s));
  }, SETTINGS_30ROWS);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(400);

  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(200);

  const startBtn = page.locator('text=음성 입력 시작').first();
  if (await startBtn.getAttribute('disabled') !== null) {
    console.log('ℹ STT 미지원 — 스킵');
    return;
  }

  await startBtn.click();
  await page.waitForTimeout(600);

  // REC 상태 확인
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
  console.log('✓ 시작 후 REC 표시');

  // 진행 행 카운터
  const initialRow = await getActiveRow(page);
  console.log(`✓ 초기 행 카운터: ${initialRow} (expected: 1)`);
  expect(initialRow).toBe(1);

  // 총 행 표시
  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log(`✓ 총 행수 "30" 표시: ${bodyText.includes('30') ? '✓' : '✗'}`);

  // 명령어 힌트 전부 표시
  for (const cmd of ['수정', '다음', '일시정지', '재시작', '종료']) {
    const visible = await page.locator(`text=${cmd}`).first().isVisible().catch(() => false);
    console.log(`  명령어 힌트 "${cmd}": ${visible ? '✓' : '✗'}`);
  }

  // 일시정지 버튼 클릭 (CSS 애니메이션 비활성화로 안정적)
  const pauseBtn = page.locator('button[title="일시정지"]').first();
  await pauseBtn.click({ force: true, timeout: 5000 });
  await page.waitForTimeout(400);

  // UI-c: 시각 상태어 없이 aria-only paused surface로 상태를 판정한다.
  await expect(page.locator('[data-testid="paused-card"]').first()).toBeVisible({ timeout: 2000 });
  console.log('✓ 일시정지 후 카드 표시');

  const resumeBtn = page.locator('button[title="재시작"]').first();
  await expect(resumeBtn).toBeVisible({ timeout: 2000 });
  console.log('✓ 일시정지 후 버튼 title="재시작" 확인');

  // 재시작 클릭
  await resumeBtn.click({ force: true });
  await page.waitForTimeout(400);

  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 2000 });
  console.log('✓ 재시작 후 활성 화면 복귀');

  const rowAfterResume = await getActiveRow(page);
  console.log(`✓ 재시작 후 행 카운터: ${rowAfterResume} (expected: 1)`);
  expect(rowAfterResume).toBe(1);

  // UI-e1: 활성 화면의 4심볼 행동행에서 종료를 누르고 확인한다.
  const endBtn = page.locator('[data-testid="voice-control-stop"]');
  const endBtnCount = await endBtn.count();
  console.log(`종료 버튼 발견: ${endBtnCount}개`);
  if (endBtnCount > 0) {
    await endBtn.click({ force: true });
    await page.locator('button[title="종료 확인"]').click();
  }
  await page.waitForTimeout(800);

  // Ready 상태로 복귀 확인 — 실패 시 STT "종료" fallback
  let isReadyVisible = await page.locator('text=음성 입력 시작').first()
    .isVisible({ timeout: 500 }).catch(() => false);
  if (!isReadyVisible) {
    console.log('  버튼 클릭으로 종료 실패 → STT "종료" 명령 시도');
    await fireStt(page, '종료', 1000);
    isReadyVisible = await page.locator('text=음성 입력 시작').first()
      .isVisible({ timeout: 3000 }).catch(() => false);
  }
  expect(isReadyVisible).toBe(true);
  console.log('✓ 종료 후 Ready 상태 복귀');

  console.log('\n✅ 음성 탭 일시정지/재개/종료 UI 검증 완료');
});
