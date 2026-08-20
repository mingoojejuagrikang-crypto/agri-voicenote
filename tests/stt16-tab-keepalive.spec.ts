/**
 * v0.33.0 항목4 [STT-16] — 탭 전환 후 마이크(STT) 생존 + 포그라운드 복귀 즉시 복구(kick)
 *
 * 07-13 실기기 로그(2/2 세션 재현): App.tsx 조건부 렌더 때문에 탭 전환 시 VoiceScreen이
 * unmount → 인식기·워치독·onTokenSettled 구독 전부 teardown. 복귀(재마운트) 후에도 인식이
 * 자동 재시작되지 않아 S1 62초 / S2 20초 사공백 — 사용자가 수동 pause/resume로만 소생.
 *
 * 수정(택일 (a) keep-alive 렌더): 세션이 살아 있는 동안 VoiceScreen을 display:none으로
 * 유지(unmount 금지) → 인식기가 탭 전환을 그대로 관통해 살아남는다. 세션이 없으면 기존대로
 * unmount. (v0.44.0 §C8 F18 — 마운트 prewarm 폐지: 세션 없는 탭 왕복은 getUserMedia 0회.
 * mic_prewarm_* 텔레메트리 기반 오라클은 그 계약으로 재작성됐다.)
 *
 * 함께 검증: 항목4의 visibilitychange/pageshow 복귀 훅 — kick_result:* 텔레메트리 배선.
 *
 * Mock 패턴은 nav-unidirectional.spec.ts와 동일 (instant TTS + MockSTT).
 */

import { test, expect, type Page } from '@playwright/test';
import {
  INITIAL_FOREGROUND_RETURN_STATE,
  LONG_BACKGROUND_TEARDOWN_MS,
  reduceForegroundReturn,
  shouldEmitRouteRevalidate,
} from '../src/lib/foregroundReturnPolicy';
import { resolveForegroundReturnEvent } from '../src/lib/foregroundReturnTelemetry';
import { BASE } from './baseUrl';

test.setTimeout(120_000);

const TOTAL_ROWS = 3;

test.describe('[MIC-B2] 포그라운드 복귀 순수 정책', () => {
  test('임계 미만 복귀는 teardown 없이 hiddenAt을 소비한다', () => {
    const hidden = reduceForegroundReturn(INITIAL_FOREGROUND_RETURN_STATE, 'hidden', 1_000);
    const visible = reduceForegroundReturn(
      hidden.state,
      'visible',
      1_000 + LONG_BACKGROUND_TEARDOWN_MS - 1,
    );

    expect(visible.shouldTeardown).toBe(false);
    expect(visible.state.hiddenAt).toBeNull();
    // phase 게이트와 무관하게 이미 소비됐으므로 훨씬 늦은 pageshow도 과거 hiddenAt을 재사용하지 않는다.
    const laterPageShow = reduceForegroundReturn(visible.state, 'pageshow', 999_999);
    expect(laterPageShow.shouldTeardown).toBe(false);
  });

  test('임계 이상 복귀는 정확히 1회 teardown 판정을 낸다', () => {
    const hidden = reduceForegroundReturn(INITIAL_FOREGROUND_RETURN_STATE, 'hidden', 5_000);
    const visible = reduceForegroundReturn(
      hidden.state,
      'visible',
      5_000 + LONG_BACKGROUND_TEARDOWN_MS,
    );
    const pageShow = reduceForegroundReturn(visible.state, 'pageshow', 999_999);

    expect(visible.shouldTeardown).toBe(true);
    expect(visible.backgroundMs).toBe(LONG_BACKGROUND_TEARDOWN_MS);
    expect(pageShow.shouldTeardown).toBe(false);
  });
});

test.describe('[FG-RETURN-LOG-1] 정직한 복귀 요약', () => {
  test('실제 hidden 사이클이 아니면 무기록, 임계 미달/레코더 없음은 구분', async () => {
    expect(await resolveForegroundReturnEvent({
      hadHiddenCycle: false, shouldTeardown: false, backgroundMs: 0, evt: 'pageshow', recorder: null,
    })).toBeNull();
    expect(await resolveForegroundReturnEvent({
      hadHiddenCycle: true, shouldTeardown: false, backgroundMs: 58_231, evt: 'vis', recorder: null,
    })).toBe('foreground_return:bg_s=58,teardown=skipped,evt=vis');
    expect(await resolveForegroundReturnEvent({
      hadHiddenCycle: true, shouldTeardown: true, backgroundMs: 61_000, evt: 'vis', recorder: null,
    })).toBe('foreground_return:bg_s=61,teardown=no_recorder,evt=vis');
  });

  test('지연된 teardown이 끝나기 전 completed를 만들지 않고 resolve/reject를 구분', async () => {
    let finish!: () => void;
    const delayed = new Promise<'completed'>((resolve) => {
      finish = () => resolve('completed');
    });
    let settled = false;
    const pending = resolveForegroundReturnEvent({
      hadHiddenCycle: true,
      shouldTeardown: true,
      backgroundMs: 62_000,
      evt: 'vis',
      recorder: { teardownAudioGraph: () => delayed },
    }).then((result) => { settled = true; return result; });
    await Promise.resolve();
    expect(settled, 'teardown 완료 전에 completed를 기록하면 안 된다').toBe(false);
    finish();
    expect(await pending).toBe('foreground_return:bg_s=62,teardown=completed,evt=vis');

    expect(await resolveForegroundReturnEvent({
      hadHiddenCycle: true,
      shouldTeardown: true,
      backgroundMs: 63_000,
      evt: 'pageshow',
      recorder: { teardownAudioGraph: () => Promise.reject(new Error('close failed')) },
    })).toBe('foreground_return:bg_s=63,teardown=failed,evt=pageshow');
  });
});

// ─── v0.38.2 F5 — 오디오 경로 재검증 계측의 순수 경계 ────────────────────────────────────
// 이 두 축(진입 스냅샷 / 발행 게이트)은 **각각 독립으로 반증**되어야 한다. 한쪽만 지워도 실패하는
// 케이스를 따로 두지 않으면 이중 방어 중 한 겹이 사라지는 회귀를 못 잡는다([ORCH-18]).
test.describe('[F5] 오디오 경로 재검증 정책', () => {
  test('진입 시점 라벨을 스냅샷해 복귀 결정에 실어 준다 — 이게 없으면 경로 변경을 알 수 없다', () => {
    const hidden = reduceForegroundReturn(INITIAL_FOREGROUND_RETURN_STATE, 'hidden', 1_000, {
      inputLabel: 'OpenDots ONE by Shokz',
    });
    expect(hidden.state.hiddenInputLabel).toBe('OpenDots ONE by Shokz');

    // 복귀 결정이 **진입 시점** 라벨을 그대로 전달한다(복귀 후 읽기가 아니라).
    const visible = reduceForegroundReturn(hidden.state, 'visible', 2_000);
    expect(visible.hiddenInputLabel).toBe('OpenDots ONE by Shokz');
    // 소비 후에는 비워져 다음 복귀가 낡은 스냅샷을 재사용하지 않는다.
    expect(visible.state.hiddenInputLabel).toBeNull();
    expect(reduceForegroundReturn(visible.state, 'pageshow', 3_000).hiddenInputLabel).toBeNull();
  });

  test('연속 hidden은 첫 진입 스냅샷을 덮지 않는다 — 나중 라벨로 갈아치우면 비교가 무의미해진다', () => {
    const first = reduceForegroundReturn(INITIAL_FOREGROUND_RETURN_STATE, 'hidden', 1_000, {
      inputLabel: 'OpenDots ONE by Shokz',
    });
    const second = reduceForegroundReturn(first.state, 'hidden', 9_000, {
      inputLabel: 'iPhone 마이크',
    });
    expect(second.state.hiddenInputLabel).toBe('OpenDots ONE by Shokz');
    expect(second.state.hiddenAt).toBe(1_000);
  });

  test('진입 기록이 없는 복귀는 스냅샷도 없다 — before=unknown으로 내려간다', () => {
    const visible = reduceForegroundReturn(INITIAL_FOREGROUND_RETURN_STATE, 'visible', 5_000);
    expect(visible.hiddenInputLabel).toBeNull();
    expect(visible.backgroundMs).toBe(0);
  });

  test('발행 게이트 (a) 경로 변경 — 임계 한참 미만이어도 발행한다', () => {
    expect(
      shouldEmitRouteRevalidate({
        beforeCategory: '블루투스',
        afterCategory: '내장 마이크',
        backgroundMs: 1_000,
      }),
    ).toBe(true);
  });

  test('발행 게이트 (b) 장기 백그라운드 — 경로가 그대로여도 발행한다', () => {
    expect(
      shouldEmitRouteRevalidate({
        beforeCategory: '블루투스',
        afterCategory: '블루투스',
        backgroundMs: LONG_BACKGROUND_TEARDOWN_MS,
      }),
    ).toBe(true);
  });

  test('둘 다 아니면 무발행 — 복귀마다 찍어 링버퍼를 잠식하지 않는다', () => {
    expect(
      shouldEmitRouteRevalidate({
        beforeCategory: '블루투스',
        afterCategory: '블루투스',
        backgroundMs: LONG_BACKGROUND_TEARDOWN_MS - 1,
      }),
    ).toBe(false);
    // 진입 스냅샷이 없으면 (a)는 성립할 수 없다 — (b)만으로 판단한다.
    expect(
      shouldEmitRouteRevalidate({
        beforeCategory: null,
        afterCategory: '내장 마이크',
        backgroundMs: 1_000,
      }),
    ).toBe(false);
  });
});

const SETTINGS_3ROWS = {
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
      { id: 'c6', name: '조사나무', type: 'int',   input: 'auto',  ttsAnnounce: true,  auto: { kind: 'seq', from: 1, to: 3 } },
      { id: 'c8', name: '횡경',     type: 'float', input: 'voice', ttsAnnounce: true,  auto: { kind: 'fixed', value: '' }, decimals: 1 },
      { id: 'c9', name: '종경',     type: 'float', input: 'voice', ttsAnnounce: true,  auto: { kind: 'fixed', value: '' }, decimals: 1 },
    ],
    tableGenerated: true,
    totalRows: TOTAL_ROWS,
    ttsRate: 1.05,
    sessionLabelColId: null,
    sessionAutoLabel: 'stt16-test',
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

async function loadLogEventsFromIDB(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db) return [];
    return new Promise<Array<{ type: string; extra?: string; parsed?: string }>>((res) => {
      const tx = db.transaction('logEvents', 'readonly');
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result as Array<{ type: string; extra?: string; parsed?: string }>);
      req.onerror = () => res([]);
    });
  });
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

test('[STT-16] 탭 전환(입력→데이터→입력) 후 STT 자동 생존 — 수동 pause/resume 없이 값 커밋 계속', async ({ page }) => {
  await startSession(page);

  // Row 1 횡경 커밋 → 종경 대기 상태에서 탭 전환
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '35.1', 300);
  await waitForActiveChip(page, '종경');

  // v0.44.0 §C8 F18 — 마운트 prewarm 폐지로 mic_prewarm_* 텔레메트리 기준점 단언은 은퇴했다.
  // (구 단언: 마운트분 prewarm > 0 + 탭 왕복 후 증가 없음 = "재마운트 없음"의 계측 증명.
  //  이제 마운트는 마이크를 만지지 않으므로 그 계측 자체가 없다 — keep-alive의 몸통 증명은
  //  아래 행동 단언(복귀 직후 STT 커밋 지속)이 그대로 담당한다.)

  // 입력 → 데이터 → 입력 (07-13 S1/S2 재현 시퀀스)
  await page.locator('[data-testid="tab-data"]').click();
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(400);

  // keep-alive: 세션 UI가 그대로 살아 있다(ready로 리셋되지 않음).
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });

  // 핵심 단언: 복귀 직후 아무 조작 없이 STT 발화가 그대로 커밋된다(구버전: 인식기 teardown → 무반응).
  await fireStt(page, '28.3', 600);
  await waitForRow(page, 2);
  expect(await getActiveRow(page)).toBe(2); // 행 1 완료 → 자동 전진 = 인식기 생존 증명

  // 텔레메트리: 탭 전환 왕복이 기록된다(B-4). (mic_prewarm 계측은 F18로 은퇴 — 위 주석.)
  const events = await loadLogEventsFromIDB(page);
  const tabEvents = events.filter((e) => e.type === 'command' && e.parsed === 'tab');
  expect(tabEvents.some((e) => e.extra === 'tab:voice->data')).toBe(true);
  expect(tabEvents.some((e) => e.extra === 'tab:data->voice')).toBe(true);
  expect(events.some((e) => (e.extra ?? '').startsWith('mic_prewarm'))).toBe(false); // F18 — prewarm 부활 금지

  // IDB: 탭 전환을 관통해 행 1이 정상 완료로 영속화됨.
  await fireStt(page, '종료', 1000);
  const sessions = await loadSessionsFromIDB(page) as Array<{
    rows: Array<{ index: number; complete: boolean; values: Record<string, string> }>;
  }>;
  const row1 = sessions[0]?.rows.find((r) => r.index === 1);
  expect(row1?.complete).toBe(true);
  expect(row1?.values['c8']).toBe('35.1');
  expect(row1?.values['c9']).toBe('28.3');
});

// v0.48.0 P5(NEW-6, 민구 제보 08-10) — "지금의 탭에서 진행중이던 세션은 '진행중'이란 표현을
// 추가해주길 바람." 완료 전 세션도 값 커밋마다 upsertSession돼 데이터탭에 실시간으로 뜨는데
// (이 파일의 keep-alive 계약과 같은 축 — 세션이 탭 전환을 관통해 산다), 카드엔 그게 "지금 그
// 세션"이라는 표시가 없었다. DataScreen.tsx가 phase 기반으로 판정해 SessionCard에 배지를
// 얹는다 — 종료(phase='ready') 후에는 sessionId가 안 지워지므로 phase 조건 없이 id만 비교하면
// 안 된다(scout 함정, 이 테스트가 잠근다).
test('[NEW-6] 데이터탭 세션 카드 — 진행중인 세션에 「진행중」 배지, 종료 후 사라짐', async ({ page }) => {
  await startSession(page);

  // 최소 1개 값 커밋 — persistSession이 activeHasData로 세션을 dataStore에 올린다(빈 세션은
  // 목록에 안 뜬다).
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '35.1', 300);
  await waitForActiveChip(page, '종경');

  // 데이터탭으로 전환 — 세션은 아직 살아있다(phase='active', STT-16 keep-alive와 같은 상태).
  await page.locator('[data-testid="tab-data"]').click();
  await page.waitForTimeout(500);

  const badge = page.locator('[data-testid^="session-inprogress-"]');
  await expect(badge).toHaveCount(1);
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText('진행중');

  // 음성탭 복귀 → 종료(음성 명령) → 데이터탭 재방문: phase가 'ready'로 내려가면 배지는 사라진다.
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(300);
  await fireStt(page, '종료', 1000);

  await page.locator('[data-testid="tab-data"]').click();
  // 🔴 v0.48.1 F11(리뷰 claude low) — 종전엔 여기서 `waitForTimeout(500)` 뒤 기본 5초 폴링
  // 여유(≈6.5초)에 기대는 **시간 가정**이었다. `stop()`은 `'stopping'`을 먼저 세우고 persist
  // (세션 저장 + 클립 flush)가 끝난 뒤에야 `'ready'`로 내려간다(`useVoiceSession.ts` — v0.35.0
  // R2-FIX-1이 의도적으로 그 순서로 만들었다) — 행·클립이 많거나 부하 상태면 6.5초를 넘을 수
  // 있다(AGENTS.md 30초 체크: "부하 지연이 결함을 가릴 수 있다"). `waitForTimeout` 자체는
  // 지워도 효과가 없다(`toHaveCount`가 어차피 폴링 단언이라 흡수한다) — 대신 타임아웃을 넉넉히
  // 명시해 상태 도달을 실제로 기다리게 한다(상태 대기 훅 `window.__sessionPhase`는 프로덕션에
  // 없고, 테스트만을 위해 새로 만들면 표면이 늘어나 이번 라운드 범위 밖 — union U2와 같은 판단).
  await expect(page.locator('[data-testid^="session-inprogress-"]')).toHaveCount(0, { timeout: 20_000 });
});

// v0.48.1 P5 보완(리뷰 F7, 민구 2차 결정 — "일시정지는 별도 배지로 분리") — F10이 지적한
// "넓힌 쪽에 오라클 0건"을 이 배지에서 반복하지 않는다. 일시정지 중엔 「일시정지」 배지가
// 뜨고 「진행중」 배지는 **동시에 뜨지 않는다**(상호배타)는 것까지 잠근다 — 재개하면 원복.
test('[NEW-6b] 데이터탭 세션 카드 — 일시정지 중엔 「일시정지」 배지, 「진행중」과 상호배타', async ({ page }) => {
  await startSession(page);

  await waitForActiveChip(page, '횡경');
  await fireStt(page, '35.1', 300);
  await waitForActiveChip(page, '종경');

  // 일시정지 — 음성탭 하단 상태 버튼(제목 "일시정지", ActiveControlBar.tsx)을 누른다.
  await page.locator('button[title="일시정지"]').click();
  await expect(page.locator('[data-testid="paused-card"]')).toBeVisible({ timeout: 3000 });

  await page.locator('[data-testid="tab-data"]').click();
  await page.waitForTimeout(500);

  await expect(page.locator('[data-testid^="session-paused-"]')).toHaveCount(1);
  await expect(page.locator('[data-testid^="session-paused-"]')).toHaveText('일시정지');
  // 상호배타 — 같은 세션이 두 배지를 동시에 달면 "지금 무슨 상태인지" 신호가 모순된다.
  await expect(page.locator('[data-testid^="session-inprogress-"]')).toHaveCount(0);

  // 재개 — 「진행중」으로 되돌아오고 「일시정지」는 사라진다.
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(300);
  await page.locator('button[title="재시작"]').click();
  await expect(page.locator('[data-testid="paused-card"]')).toHaveCount(0, { timeout: 3000 });

  await page.locator('[data-testid="tab-data"]').click();
  await page.waitForTimeout(500);
  await expect(page.locator('[data-testid^="session-inprogress-"]')).toHaveCount(1);
  await expect(page.locator('[data-testid^="session-paused-"]')).toHaveCount(0);
});

// v0.44.0 §C8 F18 재작성 — 구 오라클(재진입 fresh mount마다 prewarm 재발화)은 prewarm 폐지로
// 매체를 잃었다. 같은 자리(세션 없는 입력탭 수명주기)를 F18 계약으로 다시 고정한다:
// **어떤 탭 왕복도 getUserMedia를 호출하지 않는다**(요청 시점은 오직 '음성 입력 시작' 클릭).
// unmount 자체(자원 위생)는 유지되지만 이제 관찰 가능한 마이크 부작용이 없다 — 그 "없음"이 계약이다.
test('세션 없으면 입력탭 왕복이 마이크를 만지지 않는다 — getUserMedia 0회(F18)', async ({ page }) => {
  await page.addInitScript(MOCK_INIT_SCRIPT);
  // getUserMedia 호출 계수 스텁 — headless 기본과 동일하게 **거부**하되 호출만 센다.
  await page.addInitScript({
    content: `
      window.__gumCallCount = 0;
      if (navigator.mediaDevices) {
        try {
          Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
            value: function() { window.__gumCallCount++; return Promise.reject(new DOMException('denied', 'NotAllowedError')); },
            writable: true, configurable: true,
          });
        } catch(e) {}
      }
    `,
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem('agri-voicenote-settings-v3', JSON.stringify(s));
    indexedDB.deleteDatabase('agri-voicenote');
  }, SETTINGS_3ROWS);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  // 세션 시작 없이 입력탭 → 데이터탭 → 입력탭 왕복(재진입 fresh mount 포함).
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(400);
  await page.locator('[data-testid="tab-data"]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(400);

  const gumCalls = await page.evaluate(
    () => (window as unknown as { __gumCallCount?: number }).__gumCallCount ?? -1,
  );
  expect(gumCalls, '세션 없는 탭 왕복에서 getUserMedia가 호출됐다(WS-2 prewarm 부활)').toBe(0);
  // 구 prewarm 텔레메트리도 부활 금지.
  const events = await loadLogEventsFromIDB(page);
  expect(events.some((e) => (e.extra ?? '').startsWith('mic_prewarm'))).toBe(false);
});

test('항목4 — 포그라운드 복귀 훅: pageshow/visibilitychange가 kick_result:* + lifecycle:vis_*를 남긴다', async ({ page }) => {
  await startSession(page);
  await waitForActiveChip(page, '횡경');

  // OS 복귀 시뮬레이션: pageshow + visibilitychange(테스트 페이지는 visible 상태) 디스패치.
  await page.evaluate(() => {
    window.dispatchEvent(new Event('pageshow'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(400);

  const events = await loadLogEventsFromIDB(page);
  // 인식기가 정상 가동 중이므로 kick은 no-op 판정('running') — 맹목 재시작 churn 없음.
  const kickPageshow = events.find((e) => (e.extra ?? '').startsWith('kick_result:pageshow:'));
  expect(kickPageshow, 'pageshow kick_result 미기록').toBeTruthy();
  expect(kickPageshow!.extra).toBe('kick_result:pageshow:running');
  const kickVis = events.find((e) => (e.extra ?? '').startsWith('kick_result:vis:'));
  expect(kickVis, 'visibilitychange kick_result 미기록').toBeTruthy();
  expect(kickVis!.extra).toBe('kick_result:vis:running');
  // App 레벨 lifecycle:vis_* 계측(v0.33.0 B 신규)도 같은 디스패치로 발화.
  expect(events.some((e) => e.extra === 'lifecycle:vis_visible')).toBe(true);

  // 복귀 후에도 값 커밋 정상(회귀 방어).
  await fireStt(page, '35.1', 400);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '종료', 800);
});

// v0.44.0 §C8 F18 적응 — 구 제목은 "ready phase에서도"였다: prewarm이 마운트에서 레코더를
// 만들어 ready에도 teardown/revalidate 배선이 관측됐기 때문이다. prewarm 폐지로 ready엔
// 레코더가 없고(복귀 요약은 teardown=no_recorder로 침묵이 정상), 이 스펙이 잠그려던
// **레코더 존재 시의 실제 배선 바이트**는 세션 중에만 관측된다 → 세션을 시작하고 검증한다.
// (gum은 headless 기본 거부 — 스트림 없는 레코더 = 종전과 동일한 found=none 관측 경로.)
test('[MIC-B2] 실제 복귀 배선은 임계 경계와 vis→pageshow 중복 소비를 지킨다(레코더는 세션 중 존재 — F18)', async ({ page }) => {
  await page.addInitScript(MOCK_INIT_SCRIPT);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem('agri-voicenote-settings-v3', JSON.stringify(s));
    indexedDB.deleteDatabase('agri-voicenote');
  }, SETTINGS_3ROWS);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(500);
  const startBtn = page.locator('text=음성 입력 시작').first();
  await expect(startBtn).toBeVisible();
  await startBtn.click();
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(600);

  // 세션 활성(레코더 존재) 상태에서 정책 배선을 실제 DOM 이벤트로 발화한다.
  await page.evaluate((threshold) => {
    const originalNow = Date.now;
    let now = 1_000;
    let visibility: DocumentVisibilityState = 'hidden';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
    Date.now = () => now;
    try {
      document.dispatchEvent(new Event('visibilitychange'));
      now += threshold - 1;
      visibility = 'visible';
      document.dispatchEvent(new Event('visibilitychange')); // 임계 미만: 미발화 + hiddenAt 소비
      now += threshold * 2;
      window.dispatchEvent(new Event('pageshow'));            // 소비 확인: 여전히 미발화

      visibility = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
      now += threshold;
      visibility = 'visible';
      document.dispatchEvent(new Event('visibilitychange')); // 임계 이상: 정확히 1회
      window.dispatchEvent(new Event('pageshow'));            // 연속 복귀: 중복 금지
    } finally {
      Date.now = originalNow;
      delete (document as Document & { visibilityState?: DocumentVisibilityState }).visibilityState;
    }
  }, LONG_BACKGROUND_TEARDOWN_MS);
  await page.waitForTimeout(500);

  const teardown = (await loadLogEventsFromIDB(page))
    .filter((e) => (e.extra ?? '').startsWith('mic_teardown:found='));
  expect(teardown).toHaveLength(1);
  // 바이트는 logEvents SSOT 규약(kv는 ',')을 따른다 — 세그먼트가 ':'로 섞이면 파서가 필드를 쪼갠다.
  expect(teardown[0].extra).toContain(',reattach=');
  expect(teardown[0].extra).toContain(',evt=vis,bg_s=60');

  // hidden→visible→pageshow 통합 계약: 두 실제 hidden 사이클에서만 1건씩, 연속 pageshow는 0건.
  const foreground = (await loadLogEventsFromIDB(page))
    .filter((e) => (e.extra ?? '').startsWith('foreground_return:'));
  expect(foreground.map((e) => e.extra)).toEqual([
    'foreground_return:bg_s=60,teardown=skipped,evt=vis',
    'foreground_return:bg_s=60,teardown=completed,evt=vis',
  ]);
});

// ─── v0.38.2 F5 — **실제 배선** 회귀 (라운드A 리뷰 Codex #3) ─────────────────────────────
// 🔴 이 테스트가 왜 추가됐는지: 초판의 F5 테스트는 순수 정책(`reduceForegroundReturn` /
// `shouldEmitRouteRevalidate`)만 잠갔다. 그래서 `useVoiceSession`에서 **`emitRouteRevalidate()` 호출을
// 통째로 지워도 24개 테스트가 전부 통과했다**(실측 확인). 정책이 맞아도 아무도 그 정책을 부르지
// 않으면 계측은 존재하지 않는다 — [ORCH-18]("반증 없는 회귀 테스트는 회귀 테스트가 아니다")의
// 교과서적 사례라 리뷰 지적을 그대로 수용했다.
//
// 여기서는 **실제 DOM visibility 이벤트**로 배선을 발화시키고 IDB에 남은 바이트를 검사한다.
// v0.44.0 §C8 F18 적응 — 종전엔 ready phase에서 검증했다(prewarm이 레코더를 만들어 뒀으므로).
// 이제 ready엔 레코더가 없어 revalidate는 의도된 침묵(`!rec` 조기 반환 — 링버퍼 보호)이다.
// 호출-잠금(ORCH-18)의 관측처는 세션 중(레코더 존재)뿐이라 세션을 시작하고 검증한다.
test('[F5] 실제 복귀 배선이 audio_route_revalidate를 남긴다 — 정책만이 아니라 호출까지 잠근다', async ({ page }) => {
  await page.addInitScript(MOCK_INIT_SCRIPT);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem('agri-voicenote-settings-v3', JSON.stringify(s));
    indexedDB.deleteDatabase('agri-voicenote');
  }, SETTINGS_3ROWS);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(500);
  const startBtn = page.locator('text=음성 입력 시작').first();
  await expect(startBtn).toBeVisible();
  await startBtn.click();
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(600);

  await page.evaluate((threshold) => {
    const originalNow = Date.now;
    let now = 1_000;
    let visibility: DocumentVisibilityState = 'hidden';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    Date.now = () => now;
    try {
      // ① 임계 미만 복귀 — 경로 변경도 없으므로 **무발행**이어야 한다(링버퍼 잠식 방지).
      document.dispatchEvent(new Event('visibilitychange'));
      now += threshold - 1;
      visibility = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));

      // ② 임계 이상 복귀 — 발행. 연속 pageshow는 hiddenAt이 소비돼 중복 발행되지 않아야 한다.
      visibility = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
      now += threshold;
      visibility = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pageshow'));
    } finally {
      Date.now = originalNow;
      delete (document as Document & { visibilityState?: DocumentVisibilityState }).visibilityState;
    }
  }, LONG_BACKGROUND_TEARDOWN_MS);
  await page.waitForTimeout(800); // 계측이 비동기(revalidateActiveInput await)라 여유를 둔다

  const events = await loadLogEventsFromIDB(page);
  const revalidate = events.filter((e) => (e.extra ?? '').startsWith('audio_route_revalidate:'));

  // 배선이 살아 있다 = 정확히 1건(①은 무발행, ②는 1회, 연속 pageshow는 중복 없음).
  expect(revalidate).toHaveLength(1);
  const extra = revalidate[0].extra ?? '';
  // kv(',') 규약 — 접두 1개만 ':'를 쓴다(mic_teardown과 동일한 파서 계약).
  expect(extra.split(':')).toHaveLength(2);
  expect(extra).toContain('before=');
  expect(extra).toContain(',after=');
  expect(extra).toContain(',status=');
  // 같은 복귀 구간임을 mic_teardown과 대조할 수 있어야 한다(실기기 판독의 핵심).
  expect(extra).toContain(',evt=vis,bg_s=60');

  // headless는 getUserMedia가 거부돼 레코더가 미초기화다 → **'내장 마이크'로 확정하지 않는다.**
  // 관측 못 한 것을 관측한 것처럼 적으면 실기기 판독에서 unknown과 built-in을 구별할 수 없다
  // (라운드A 리뷰 Codex #2).
  expect(extra).toContain('after=unknown');
  expect(extra).not.toContain('status=ok');

  // teardown과 같은 복귀 이벤트에서 짝으로 남는다 — 둘의 evt/bg_s가 일치해야 대조가 성립한다.
  const teardown = events.filter((e) => (e.extra ?? '').startsWith('mic_teardown:found='));
  expect(teardown).toHaveLength(1);
  expect(teardown[0].extra).toContain(',evt=vis,bg_s=60');
});
