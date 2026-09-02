/**
 * v0.7.0 B4 — 추세 검증 알림 음성 플로우 e2e.
 *
 * 패턴 조합: STT/TTS 주입(correction-flow.spec.ts MOCK) + Sheets GET stub(sync-skip-rows/
 * review-screen 패턴) + v5 설정 시드(settings-migration/review-screen 페이로드 형태).
 *
 * 검증:
 *   1. 위반 값 커밋 → echo 대신 알림 TTS(v0.20.0 입력탭#6: 문구 단축 "추세 알람 증가|감소 : NN" /
 *      "범위 알람 : ±NN%" — "~합니다/하세요"·"직전 조사보다" 제거, 팝업 라벨과 **글자까지** 동일
 *      (F3 반영 2026-07-25 — 조립부는 anomalyAlarmLabel 하나뿐. 화면·TTS·로그 3자 동등은 아래
 *       "경보 문구 SSOT" 테스트가 고정한다).
 *       v0.13.0 R7: 끝 '확인해주세요' 없음 — self-confirm 환각 방지)
 *      + advance 중단, '확인' → 값 유지·진행 (trend_alert_fired/confirmed 로깅)
 *   2. 위반 → 새 값 발화 → 재입력(trend_alert_corrected) + 재검증(재위반 시 재알림) →
 *      통과 값이면 정상 echo·진행; IDB 최종값 = 마지막 발화
 *   3. 알림 상태 밖의 '확인' → 상태 변경 없는 짧은 재안내(진행 안 함)
 *   4. fetch 실패(HTTP 500) → 알림 없이 조용히 진행 + trend_skip:no_index 1회만(원인당 1회)
 *   5. trend_* 이벤트가 IDB logEvents(로그 zip 소스)에 남는다
 *
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다(수동 기동 불필요, [ORCH-27])
 */
import { test, expect, type Page } from '@playwright/test';
import { BASE } from './baseUrl';

// ── 와이어프레임 §[2](2026-07-24 확정) 반영 ────────────────────────────────────────────────
// 이상치 응답 대기의 [확인]/[수정]은 **카드 안이 아니라 하단 `<` `>` 자리**로 이동했다
// ("하단 `<` `>` → 확인/수정으로 변경(알람 동안만)"). 따라서 종전
// `popup.locator('[data-testid="anomaly-confirm-btn"]')`(카드 하위 탐색)를 `page.locator(...)`로
// 스코프만 넓힌다. **버튼의 존재·동작 단언은 그대로다** — 바뀐 것은 화면상 위치뿐이다.
// 버튼이 하단 바에 있다는 사실 자체는 v039-active-zones.spec.ts가 별도로 고정한다.

test.setTimeout(120_000);

const STORE_KEY = 'agri-voicenote-settings-v3';

/** 직전 회차 = 어제(로컬) — previousRound가 '오늘 미만 strictly'라 당일 날짜는 못 쓴다. */
function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const PREV_ROUND = localISO(new Date(Date.now() - 86_400_000));

/** v0.8.0 설정(이상치 알람, 의미 반전) — 샘플키: 농가명(불변)+조사나무·조사과실(가변, seq 2×5=10행).
 *  횡경(c8): trendRule 'increase' = **커지면** 알람(예: 직전 100 → 오늘 120 발화).
 *  종경(c9): 방향 규칙 없이 pctThreshold 15 = 방향 무관 |Δ| 15% 이상이면 알람(% 단독 경로).
 *  v0.8.0은 전역 마스터 토글(trendAlertEnabled) 제거 — 컬럼 규칙 유무로 활성. */
const COLUMNS = [
  { id: 'c1', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'c3', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'c7', name: '조사과실', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 5 }, sampleKey: true },
  { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'increase' },
  { id: 'c9', name: '종경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, pctThreshold: 15 },
];

const SETTINGS = {
  state: {
    // 🔴 왕복 OFF — 켜져 있으면 칩 클릭이 Playwright `stable` 체크에서 데드락한다.
    //    기전·실측은 tests/fixtures/activeZones.ts의 chipSweepSeconds 주석이 정본.
    chipSweepSeconds: 0,
    googleConnected: true,
    userEmail: 'tester@example.com',
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_TREND_1/edit',
    sheetTab: 'Sheet1',
    columnsSheetId: 'SHEET_TREND_1',
    columnsSheetTab: 'Sheet1',
    columns: COLUMNS,
    tableGenerated: true,
    totalRows: 10,
    ttsRate: 1.05,
    sessionLabelColId: null,
    sessionAutoLabel: 'trend-test',
    noisyMode: false,
    speakerphoneMode: false,
    preferredVoiceName: '',
    roundDateColId: null,
  },
  version: 13,
};

/** 직전 회차 시트 데이터 — 행1(나무1·과실1): 횡경 100.0 / 행2(나무1·과실2): 횡경 110.0. */
const HEADERS = ['조사일자', '농가명', '조사나무', '조사과실', '횡경', '종경'];
const SHEET_ROWS = [
  [PREV_ROUND, '이원창', '1', '1', '100.0', '50.0'],
  [PREV_ROUND, '이원창', '1', '2', '110.0', '55.0'],
];

// correction-flow.spec.ts와 동일한 TTS/STT 주입 mock.
const MOCK_INIT_SCRIPT = `
(function() {
  window.__ttsLog = [];

  var mockSynth = {
    speak: function(utterance) {
      window.__ttsLog.push(utterance.text);
      try { if (utterance.onstart) utterance.onstart(new Event('start')); } catch(e) {}
      // 기본 0 = 종전과 **완전히 동일한 동기 onend**. 실제 발화처럼 지속시간이 필요한 테스트만
      // window.__ttsOnendDelayMs를 올려 쓴다(아래 [시각] 초록 팝업 캡처). 다른 11개는 무영향.
      var fireEnd = function() {
        try { if (utterance.onend) utterance.onend(new Event('end')); } catch(e) {}
      };
      var delay = window.__ttsOnendDelayMs || 0;
      if (delay > 0) setTimeout(fireEnd, delay); else fireEnd();
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
    try { window.speechSynthesis = mockSynth; } catch(e3) {}
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
  MockSTT.prototype.fireInterim = function(transcript, confidence) {
    if (confidence === undefined) confidence = 0.6;
    var event = {
      resultIndex: 0,
      results: {
        length: 1,
        0: { isFinal: false, length: 1, 0: { transcript: transcript, confidence: confidence } }
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

// ─── Helpers ────────────────────────────────────────────────────

async function stubSheets(page: Page, opts: { fail?: boolean; rows?: string[][] } = {}): Promise<{ gets: number }> {
  const counter = { gets: 0 };
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    if (route.request().method() === 'GET') {
      counter.gets++;
      if (opts.fail) {
        await route.fulfill({ status: 500, body: 'stub failure' });
      } else {
        await route.fulfill({ json: { values: [HEADERS, ...(opts.rows ?? SHEET_ROWS)] } });
      }
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected: ' + route.request().url() });
  });
  return counter;
}

// v0.25.0 기능3(WS-3) — settings/sheetRows 오버라이드 옵션 추가(기존 호출은 기본값 = 무변경).
async function setupAndStart(
  page: Page,
  opts: { sheetsFail?: boolean; settings?: Record<string, unknown>; sheetRows?: string[][] } = {},
) {
  await stubSheets(page, { fail: opts.sheetsFail, rows: opts.sheetRows });
  await page.addInitScript(MOCK_INIT_SCRIPT);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ settings, storeKey }) => {
      localStorage.clear();
      localStorage.setItem('gs10_google_token', JSON.stringify({
        access_token: 'test-token', expires_at: Date.now() + 3600_000, email: 'tester@example.com',
      }));
      localStorage.setItem(storeKey, JSON.stringify(settings));
    },
    { settings: opts.settings ?? SETTINGS, storeKey: STORE_KEY },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(200);

  const startBtn = page.locator('text=음성 입력 시작').first();
  await expect(startBtn).toBeVisible();
  await startBtn.click();
  await page.waitForTimeout(800); // start() 프리페치(stub GET) 정착 여유
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
}

async function fireStt(page: Page, transcript: string, waitMs = 300) {
  await page.evaluate((t) => {
    (window as unknown as { __mockSTT?: { fireResult: (t: string, c: number) => void } })
      .__mockSTT?.fireResult(t, 0.95);
  }, transcript);
  await page.waitForTimeout(waitMs);
}

// v0.48.1 r3 ② — interim(비확정) 결과 주입. speech.ts:353의 barge-in 컷 조건(뮤트 중 + 비어있지
// 않은 interim)을 재현하려면 final이 아니라 interim 이벤트가 필요하다(MockSTT.fireInterim, 위
// MOCK_INIT_SCRIPT 참조).
async function fireSttInterim(page: Page, transcript: string, waitMs = 100) {
  await page.evaluate((t) => {
    (window as unknown as { __mockSTT?: { fireInterim: (t: string, c: number) => void } })
      .__mockSTT?.fireInterim(t, 0.6);
  }, transcript);
  await page.waitForTimeout(waitMs);
}

async function getTtsLog(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __ttsLog: string[] }).__ttsLog ?? []);
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
    return sessions as Array<{ rows: Array<{ index: number; values: Record<string, string> }> }>;
  });
}

/** IDB logEvents(로그 zip의 events 소스)에서 trend_* 이벤트만. */
async function getTrendEvents(page: Page): Promise<Array<{ extra: string; row?: number; colId?: string }>> {
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
    return all.filter((e) => typeof e.extra === 'string' && e.extra.startsWith('trend_')) as Array<{
      extra: string; row?: number; colId?: string;
    }>;
  });
}

// ─── Tests ──────────────────────────────────────────────────────

test('이상치(증가) 값 → 알림 TTS(advance 중단) → "확인" → 값 유지·진행 + fired/confirmed 로깅', async ({ page }) => {
  await setupAndStart(page);

  // 행1 나무1·과실1, 직전 횡경 100.0 — 120.5는 increase(커지면) 알람(20.5% 증가).
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '120.5', 500);

  // echo 대신 알림 TTS + advance 중단(여전히 횡경 대기).
  const tts1 = await getTtsLog(page);
  // v0.20.0 입력탭#6: 문구 단축 "추세 알람 증가 : NN"(NN=절대 변화량 120.5−100.0=20.5). 팝업 라벨과 동일.
  expect(tts1.some((t) => t.includes('추세 알람 증가 : 20.5'))).toBe(true);
  expect(await getActiveChipName(page)).toContain('횡경');

  // v0.9.0 시각 팝업: 이전값(100)→현재값(120.5)과 항목명을 화면에 표시.
  const popup = page.locator('[data-testid="anomaly-alert"]');
  await expect(popup).toBeVisible();
  await expect(popup).toContainText('100');
  await expect(popup).toContainText('120.5');
  // v0.33.0 항목7 — "확인 또는 수정" 텍스트 힌트는 [확인][수정] 터치 버튼으로 대체(음성과 동일 동작).
  await expect(page.locator('[data-testid="anomaly-confirm-btn"]')).toBeVisible();
  await expect(page.locator('[data-testid="anomaly-modify-btn"]')).toBeVisible();

  // "확인" → 커밋된 값 유지, 종경으로 진행.
  await fireStt(page, '확인', 500);
  await waitForActiveChip(page, '종경');

  // 종경은 pctThreshold 15 — 49.5는 직전 50.0 대비 1% 변동(< 15%) → 알림 없이 행 완료.
  await fireStt(page, '49.5', 500);
  await waitForRow(page, 2);

  const sessions = await getIdbSessions(page);
  const row1 = sessions[sessions.length - 1].rows.find((r) => r.index === 1)!;
  expect(row1.values.c8).toBe('120.5');
  expect(row1.values.c9).toBe('49.5');

  const events = await getTrendEvents(page);
  expect(events.filter((e) => (e.extra ?? '').startsWith('trend_alert_fired'))).toHaveLength(1);
  expect(events.filter((e) => e.extra === 'trend_alert_confirmed')).toHaveLength(1);
  expect(events.filter((e) => e.extra === 'trend_alert_corrected')).toHaveLength(0);
});

// v0.48.0 P4(NEW-3, 민구 제보 08-10) — "값을 틀렸는지, 인식이 잘못됐는지 소리만으론 알 수
// 없다"(원문). alertText 자체는 §4 바이트 계약(logExtra text=)·위 "경보 문구 SSOT" triad
// 오라클에 묶여 불변이라(scout-v048 조사), 인식값은 **별도의 두 번째 발화**로만 붙는다.
// alertText 문구가 인식값을 삼키지 않는지(오염 없음)와, 인식값이 알람 뒤에 실제로 오는지
// (순서 계약) 둘 다 이 테스트가 고정한다 — 신설 오라클.
test('[NEW-3] 알람 발생 시 인식값도 별도 발화로 — alertText는 불변, 두 번째 say()로 분리', async ({ page }) => {
  await setupAndStart(page);

  // 행1 나무1·과실1, 직전 횡경 100.0 — 120.5는 increase 알람(20.5% 증가).
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '120.5', 500);

  const tts = await getTtsLog(page);
  const alarmIdx = tts.findIndex((t) => t === '추세 알람 증가 : 20.5');
  const valueIdx = tts.findIndex((t) => t === '인식값 120.5');
  // alertText 자체는 여전히 변화량만 말한다 — 인식값이 섞여 들어가지 않았다(§4·triad 불변 확인).
  expect(alarmIdx).toBeGreaterThanOrEqual(0);
  // 인식값은 알람 발화 **뒤**의 독립된 두 번째 발화다(순서 계약: 알람 → 인식값).
  expect(valueIdx).toBeGreaterThan(alarmIdx);
});

// v0.48.1 r3 U1 4절(리뷰 F1 잔여, claude+codex 재검증 일치) — [NEW-3]가 고정한 "정상" 순서
// (알람 → 인식값)와 달리, 실제 말끊기는 **final보다 interim이 먼저** alertText를 끊는다
// (speech.ts:353, "이어폰 기본" barge-in). epoch/awaitingFieldRef/anomalyAlert는 final에서만
// 바뀌므로, 그 사이엔 U1의 기존 세 절이 전부 참인 채로 남는다 — 4절(bargeInEpochRef)이 그
// 구멍을 막는다(useVoiceSession.ts 상단 bargeInEpochRef 선언부 참조). 재현은 claude의
// review-claude.md F1 스니펫을 이 파일 mock에 맞춘 것: alertText 발화 중(onend 지연으로 창을
// 벌린다) interim '확인'이 뮤트 중에 도착 → final '확인'은 그보다 늦게 옴 → 구 인식값 0회.
test('[NEW-7] alertText 발화 중 interim barge-in → final 도착 전 구 인식값 미발화', async ({ page }) => {
  await setupAndStart(page);

  // 행1 나무1·과실1, 직전 횡경 100.0 — 120.5는 increase 알람(20.5% 증가).
  await waitForActiveChip(page, '횡경');
  // alertText 재생에 지연을 둬 자연 종료 전에 interim이 끼어들 창을 연다(기본 0=동기 onend로는
  // interim이 도착할 시점에 이미 첫 발화가 끝나 있어 재현이 안 된다).
  await page.evaluate(() => { (window as unknown as { __ttsOnendDelayMs?: number }).__ttsOnendDelayMs = 300; });

  await fireStt(page, '120.5', 50); // 위반값 커밋 → say(alertText) 시작(300ms간 진행 중)
  await fireSttInterim(page, '확인', 50); // barge-in: 아직 뮤트 중 → bargeInEpochRef 마킹
  await page.waitForTimeout(300); // alertText onend 자연 발화 대기(await say(alertText) resolve)
  await fireStt(page, '확인', 500); // final은 그보다 늦게 도착 — 두 번째 발화(인식값) 시도 지점

  const tts = await getTtsLog(page);
  expect(tts.filter((t) => t === '인식값 120.5')).toHaveLength(0);
});

// 🟢 §C0 완결(2026-08-04)로 `@pending-c0` 태그를 뗐다 — 정상 회귀 가드다.
//    바닥 고정의 원인은 CenterStage 알람 `<style>`의 `line-height: 1 !important`였다
//    (글리프 초과가 fit 높이 판정을 전 배율에서 실패시켰다). 그 강제를 제거해 통과한다.
//    ⚠️ 이 테스트의 390×568 무스크롤 단언(아래 narrow 블록)은 **fit 배선 + line-height 1.2
//    체제에서는 이번(08-04)이 첫 실행**이다 — c0-r1 병합~08-04 사이엔 바닥 고정이 402→480
//    무성장 단언을 먼저 죽여 도달 불가였다(그 전 체제에선 실행 이력 있음). 여기서 red가
//    나면 회귀 단정 전에 git log로 어느 체제의 이력인지 확인하라.
// 🔴 @known-alert-compare-1 — 기지 red 격리 (2026-08-15, Phase 0 · [TEAMOPS-26] 사유):
//    단독에서도 red(08-06 판정) · 전량 08-12(1386/2)·08-15(1603/2) 재현 — 진성 선재 부채다.
//    원인 축: anomaly-comparison fontSize 성장 단언(:508)이 78px에서 멈춤 — A/B(31e5b8a 대조)
//    미실시 상태로 TODO.md 등재. 처방은 별도 회차 몫. 격리 해제 = 처방 커밋과 같은 커밋에서.
test('@known-alert-compare-1 [ALERT-COMPARE-1] 2열 비교 — 안 넘침·좌우 동일 크기(§C5-c)·상한 없음, 390×568 무넘침', async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 });
  await setupAndStart(page, {
    sheetRows: [[PREV_ROUND, '이원창', '1', '1', '100.0', '99.9']],
  });
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '80.5', 500); // decrease는 c8 increase 규칙을 통과
  await waitForActiveChip(page, '종경');
  await fireStt(page, '19.9', 500); // 99.9 대비 -80% → 범위 알람

  // ui-standard §3-2 — 각 열은 화면 절반을 온전히 쓰고, 1행 라벨/2행 값으로 비교한다.
  const comparison = page.locator('[data-testid="anomaly-comparison"]');
  const metrics = await comparison.evaluate((el) => {
    const child = (testId: string) =>
      el.querySelector(`[data-testid="${testId}"]`) as HTMLElement;
    const prevLabelEl = child('anomaly-prev-label');
    const nextLabelEl = child('anomaly-next-label');
    const prevValueEl = child('anomaly-prev-value');
    const nextValueEl = child('anomaly-next-value');
    const prevLabel = prevLabelEl.getBoundingClientRect();
    const nextLabel = nextLabelEl.getBoundingClientRect();
    const prevValue = prevValueEl.getBoundingClientRect();
    const nextValue = nextValueEl.getBoundingClientRect();
    return {
      labelRowDeltaY: Math.abs(prevLabel.y - nextLabel.y),
      valueRowDeltaY: Math.abs(prevValue.y - nextValue.y),
      labelAboveValue: prevLabel.bottom <= prevValue.y + 1 && nextLabel.bottom <= nextValue.y + 1,
      columnOrder: prevLabel.x < nextLabel.x && prevValue.x < nextValue.x,
      labelSize: parseFloat(getComputedStyle(prevLabelEl).fontSize),
      nextLabelSize: parseFloat(getComputedStyle(nextLabelEl).fontSize),
      valueSize: parseFloat(getComputedStyle(prevValueEl).fontSize),
      nextValueSize: parseFloat(getComputedStyle(nextValueEl).fontSize),
      labelFits: prevLabelEl.scrollWidth <= prevLabelEl.clientWidth + 1
        && nextLabelEl.scrollWidth <= nextLabelEl.clientWidth + 1,
      valueFits: prevValueEl.scrollWidth <= prevValueEl.clientWidth + 1
        && nextValueEl.scrollWidth <= nextValueEl.clientWidth + 1,
      valueColors: [getComputedStyle(prevValueEl).color, getComputedStyle(nextValueEl).color],
    };
  });
  expect(metrics.labelRowDeltaY, '두 라벨은 같은 1행').toBeLessThanOrEqual(1);
  expect(metrics.valueRowDeltaY, '두 값은 같은 2행').toBeLessThanOrEqual(1);
  expect(metrics.labelAboveValue, '라벨 행은 값 행 위').toBe(true);
  expect(metrics.columnOrder, '직전은 왼쪽 열, 현재는 오른쪽 열').toBe(true);
  // 🔴 v0440 §C0(Larry 판정, 08-03) — 종전 `toBeCloseTo(56/78, 0)`은 "이 크기여야 한다"가 아니라
  // "지금 vw 공식을 402px에 대입하면 이 값이 나온다"는 부산물을 재고 있어 정당 파손으로 뒤집는다.
  // ui-standard 규칙 2가 가르는 대로 "넘치지 않는다"·"같은 성격은 같은 크기(§C5-c)"만 잰다 —
  // 고정 px는 다음 T6 재발(clamp 상한) 경로라 다시 넣지 않는다.
  expect(metrics.labelFits, '라벨 둘 다 배정 폭 안').toBe(true);
  expect(metrics.valueFits, '값 둘 다 배정 폭 안').toBe(true);
  expect(metrics.labelSize, '좌우 라벨은 같은 크기(§C5-c)').toBeCloseTo(metrics.nextLabelSize, 3);
  expect(metrics.valueSize, '좌우 값은 같은 크기(§C5-c)').toBeCloseTo(metrics.nextValueSize, 3);
  // v0.44.0 §C6(F10, 민구 확정) — 빨강은 **원인 요소(현재값)에만**. 과거값은 회색(textDim).
  // 종전 ['red','red'] 단언은 §C6 이전 CSS(전 셀 red !important) 체제의 것이다.
  expect(metrics.valueColors, '현재값만 붉은 톤(§C6)').toEqual(['rgb(164, 168, 176)', 'rgb(255, 23, 68)']);

  await page.evaluate(() => {
    (window as unknown as { __mockSTT?: { fireInterim: (t: string, c: number) => void } })
      .__mockSTT?.fireInterim('19.9', 0.6);
  });
  await expect(page.locator('[data-testid="interim-value"]')).toHaveText('19.9');
  const reconnectButton = page.locator('[data-testid="mic-reconnect-btn"]');
  if (await reconnectButton.count()) {
    await reconnectButton.evaluate((button) => {
      const banner = button.closest('[role="alert"]') as HTMLElement | null;
      if (banner) banner.style.display = 'none'; // 캡처 하니스의 fake-media 부재만 숨긴다.
    });
  }
  // 🔴 `Deliverables/assets/2026-08-02-ui-e4/`(git 추적)에 쓰지 마라 — 그 회차 증거 PNG를 덮어쓴다.
  //   `test-results/`는 .gitignore에 있어 런이 작업 트리를 더럽히지 않는다. 이건 증거 덤프지 단언이 아니다.
  await page.screenshot({ path: 'test-results/ui-e4/alarm-402x874.png' });

  // 구 62px clamp를 지우는 데서 끝내면 다음 상한이 생길 수 있다. 영역을 넓혔을 때 실제로
  // 더 커지는지 단언해 T6 7회차를 막는다. 값뿐 아니라 라벨도 같은 상한 금지 계약이라 함께 잰다.
  await page.setViewportSize({ width: 480, height: 1000 });
  await page.waitForTimeout(300);
  const wide = await page.locator('[data-testid="anomaly-comparison"]').evaluate((el) => ({
    label: parseFloat(getComputedStyle(el.querySelector('[data-testid="anomaly-prev-label"]') as HTMLElement).fontSize),
    value: parseFloat(getComputedStyle(el.querySelector('[data-testid="anomaly-prev-value"]') as HTMLElement).fontSize),
  }));
  console.log(
    `[ALERT-COMPARE 402→480] label=${metrics.labelSize.toFixed(2)}→${wide.label.toFixed(2)} ` +
    `value=${metrics.valueSize.toFixed(2)}→${wide.value.toFixed(2)}`,
  );
  expect(wide.label, '영역이 남으면 라벨도 멈추지 않고 더 커진다').toBeGreaterThan(metrics.labelSize + 3);
  expect(wide.value, '영역이 남으면 값도 78px에서 멈추지 않고 더 커진다').toBeGreaterThan(metrics.valueSize + 5);

  await page.setViewportSize({ width: 390, height: 568 });
  await page.waitForTimeout(300);
  const narrow = await page.locator('[data-testid="anomaly-alert"]').evaluate((el) => {
    const comparisonEl = el.querySelector('[data-testid="anomaly-comparison"]') as HTMLElement;
    const headlineEl = el.querySelector('[data-testid="anomaly-headline"]') as HTMLElement;
    const style = getComputedStyle(el as HTMLElement);
    return {
      clientWidth: (el as HTMLElement).clientWidth,
      scrollWidth: (el as HTMLElement).scrollWidth,
      clientHeight: (el as HTMLElement).clientHeight,
      scrollHeight: (el as HTMLElement).scrollHeight,
      comparisonClientWidth: comparisonEl.clientWidth,
      comparisonScrollWidth: comparisonEl.scrollWidth,
      alertStyle: {
        display: style.display,
        gap: style.gap,
        paddingBlock: `${style.paddingTop}/${style.paddingBottom}`,
        minHeight: style.minHeight,
      },
      headlineHeight: headlineEl.getBoundingClientRect().height,
      comparisonHeight: comparisonEl.getBoundingClientRect().height,
    };
  });
  console.log(`[ALERT-COMPARE narrow] ${JSON.stringify(narrow)}`);
  expect(narrow.scrollWidth - narrow.clientWidth, '390×568 알람 카드 가로 넘침').toBeLessThanOrEqual(1);
  expect(narrow.scrollHeight - narrow.clientHeight, '390×568 알람 카드 세로 넘침').toBeLessThanOrEqual(1);
  expect(
    narrow.comparisonScrollWidth - narrow.comparisonClientWidth,
    '390×568 비교 영역 가로 넘침',
  ).toBeLessThanOrEqual(1);
});

test('% 변동률 단독 알람 — 종경 pctThreshold 15, 방향 무관 발화(증가/감소)', async ({ page }) => {
  await setupAndStart(page);

  // 행1 횡경: 직전 100.0 대비 통과 흐름(작아짐은 increase 미발화). 80.5는 알림 없음.
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '80.5', 500);
  await waitForActiveChip(page, '종경');
  expect((await getTtsLog(page)).some((t) => /추세 알람|범위 알람/.test(t))).toBe(false);

  // 종경: 직전 50.0 → 60.5 = +21.0% (>= 15%) → 범위 알람. v0.24.0: 표시는 **실제 편차+부호** "+21%"(팝업과 동일).
  await fireStt(page, '60.5', 500);
  expect((await getTtsLog(page)).some((t) => t.includes('범위 알람 : +21%'))).toBe(true);
  expect(await getActiveChipName(page)).toContain('종경'); // advance 중단

  await fireStt(page, '확인', 500);
  await waitForRow(page, 2);

  // 행2(나무1·과실2): 횡경 통과(80.5<100), 종경 직전 55.0 → 40.0 = -27.3% → % 단독 알람. 표시 "-27%"(부호·반올림).
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '80.5', 500);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '40.0', 500);
  expect((await getTtsLog(page)).some((t) => t.includes('범위 알람 : -27%'))).toBe(true);
  await fireStt(page, '확인', 500);

  const events = await getTrendEvents(page);
  expect(events.filter((e) => (e.extra ?? '').startsWith('trend_alert_fired'))).toHaveLength(2); // 증가 1 + 감소 1
  expect(events.filter((e) => e.extra === 'trend_alert_confirmed')).toHaveLength(2);
});

test('기능3(WS-3) — 추세+범위 동시 발동(both) → 범위 우선 발화·팝업 "범위 알람 : +20%"(추세 아님)', async ({ page }) => {
  // 횡경(c8)에 trendRule 'increase' + pctThreshold 15를 동시 부여 → 직전 100.0 → 120은 커짐(방향 발동)
  //   AND +20%(범위 발동) = trigger:'both'. 종전엔 'both'가 추세로 떨어졌으나(무커버리지) v0.25.0 기능3은
  //   범위 우선 → 음성·팝업 모두 "범위 알람 : +20%"(글자 동일 계약). 순수 direction만 추세 유지(위 테스트들).
  const COLUMNS_BOTH = COLUMNS.map((c) =>
    c.id === 'c8' ? { ...c, trendRule: 'increase', pctThreshold: 15 } : c,
  );
  const SETTINGS_BOTH = { ...SETTINGS, state: { ...SETTINGS.state, columns: COLUMNS_BOTH } };
  await setupAndStart(page, { settings: SETTINGS_BOTH });

  await waitForActiveChip(page, '횡경');
  await fireStt(page, '120', 500); // 100.0 → 120: +20% AND 증가 = both

  const tts = await getTtsLog(page);
  // 범위 우선(부호·정수 반올림) — "범위 알람 : +20%".
  expect(tts.some((t) => t.includes('범위 알람 : +20%'))).toBe(true);
  // 핵심 계약: both가 추세로 떨어지지 않는다(범위 우선).
  expect(tts.some((t) => t.includes('추세 알람'))).toBe(false);
  expect(await getActiveChipName(page)).toContain('횡경'); // advance 중단(알람 대기)

  // 팝업도 kind='range'로 동일 문구 — 시각·청각 일치.
  const popup = page.locator('[data-testid="anomaly-alert"]');
  await expect(popup).toBeVisible();
  // 와이어프레임 §[2](2026-07-24 확정) — 경보행 표기는 `<추세|범위>알람 : <넘어선 정도>`다.
  //   F3 반영(2026-07-25, 민구 결정): TTS·로그도 **같은 문자열**이다. 종전엔 여기 주석이
  //   "문장부호 차이는 허용 — 단어는 동일"이라며 화면만 콜론이 붙는 상태를 정당화해 위반을
  //   테스트에 고정하고 있었다. 지금은 조립부가 `anomalyAlarmLabel` 하나뿐이다.
  await expect(popup).toContainText('범위 알람 : +20%');

  await fireStt(page, '확인', 500);
  const events = await getTrendEvents(page);
  const fired = events.filter((e) => (e.extra ?? '').startsWith('trend_alert_fired'));
  expect(fired).toHaveLength(1);
  // v0.26.0 계측 보강(Trace 권장) — 라우팅 검증이 로그만으로 가능해야 한다: trigger=both가 kind=range로.
  expect(fired[0].extra).toContain('trigger=both');
  expect(fired[0].extra).toContain('kind=range');
  expect(fired[0].extra).toContain('text=범위 알람 : +20%');
  expect(events.filter((e) => e.extra === 'trend_alert_confirmed')).toHaveLength(1);
});

// ─── 경보 문구 SSOT — 화면 == TTS == 로그 text= (F3 반영, 2026-07-25) ──────────────────────
//
// PRINCIPLES §2 "시각·청각 일치": 현장에선 폰을 2~3m 떨어뜨려 두고 **귀로만** 듣는 경우가 많다.
// "들리는 말"과 "보이는 글"이 어긋나면 사용자는 둘 중 뭘 믿어야 할지 모른다.
//
// 종전엔 이 계약이 **주석으로만** 선언돼 있었고(AnomalyAlertPopup) 코드는 두 곳에서 따로 조립해
// 콜론만큼 어긋나 있었다. 이 테스트가 그 계약을 **실행 가능한 단언**으로 바꾼다 — 세 문자열을
// 실제 실행 경로에서 각각 꺼내 글자까지 비교한다.
//
// ⚠️ 유닛(anomalyAlert.spec.ts)이 못 보는 축을 여기서 본다: **팝업이 SSOT를 실제로 소비하는지**.
//    팝업이 자체 조립으로 돌아가 한 글자라도 흘러가면 이 단언이 깨진다(유닛은 DOM을 못 본다).
//    `changeNum` 빈 방어 분기는 checkAnomaly가 유한수만 통과시켜 e2e로 도달 불가 → 유닛 담당.

/** 화면 헤드라인 · 알람 TTS · `trend_alert_fired`의 `text=` 세 문자열을 뽑아 동등성을 단언한다. */
async function expectAlarmTriad(page: Page, expected: string) {
  const headline = page.locator('[data-testid="anomaly-headline"]');
  await expect(headline).toHaveText(expected);

  const spokenAlarms = (await getTtsLog(page)).filter((t) => /추세 알람|범위 알람/.test(t));
  const spoken = spokenAlarms[spokenAlarms.length - 1];

  const firedEvents = (await getTrendEvents(page))
    .filter((e) => (e.extra ?? '').startsWith('trend_alert_fired'));
  const logged = firedEvents[firedEvents.length - 1].extra.split(',text=')[1];

  const onScreen = (await headline.textContent())!;
  expect(spoken, 'TTS == 화면').toBe(onScreen);
  expect(logged, '로그 text= == 화면').toBe(onScreen);
  expect(onScreen).toBe(expected);
}

test('경보 문구 SSOT — 추세 증가·범위 증가·범위 감소: 화면 == TTS == 로그 text=', async ({ page }) => {
  await setupAndStart(page);

  // ① 추세(증가) — 횡경 trendRule 'increase', 직전 100.0 → 120.5 = 절대차 20.5.
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '120.5', 500);
  await expectAlarmTriad(page, '추세 알람 증가 : 20.5');

  await fireStt(page, '확인', 500);

  // ② 범위(증가) — 종경 pctThreshold 15, 직전 50.0 → 60.5 = +21.0% → 정수 반올림 +21%.
  await waitForActiveChip(page, '종경');
  await fireStt(page, '60.5', 500);
  await expectAlarmTriad(page, '범위 알람 : +21%');

  await fireStt(page, '확인', 500);
  await waitForRow(page, 2);

  // ③ 범위(감소) — 행2 종경 직전 55.0 → 40.0 = -27.3% → -27%.
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '80.5', 500); // 통과(작아짐은 increase 미발화)
  await waitForActiveChip(page, '종경');
  await fireStt(page, '40.0', 500);
  await expectAlarmTriad(page, '범위 알람 : -27%');
});

test('경보 문구 SSOT — 추세 감소: 화면 == TTS == 로그 text=', async ({ page }) => {
  // 기본 설정의 횡경은 'increase'라 감소 알람이 안 난다 → 이 케이스만 'decrease'로 뒤집는다
  //   (기능3 테스트와 동일한 설정 오버라이드 패턴). 직전 100.0 → 80.5 = 절대차 19.5.
  const COLUMNS_DEC = COLUMNS.map((c) => (c.id === 'c8' ? { ...c, trendRule: 'decrease' } : c));
  const SETTINGS_DEC = { ...SETTINGS, state: { ...SETTINGS.state, columns: COLUMNS_DEC } };
  await setupAndStart(page, { settings: SETTINGS_DEC });

  await waitForActiveChip(page, '횡경');
  await fireStt(page, '80.5', 500);
  await expectAlarmTriad(page, '추세 알람 감소 : 19.5');
});

test('이상치 → 새 값 발화 → 재입력+재검증(재알림) → 통과 값은 정상 진행 + corrected 로깅', async ({ page }) => {
  await setupAndStart(page);

  await waitForActiveChip(page, '횡경');
  await fireStt(page, '120.5', 500); // 알람 1차 (100.0 → 120.5, 절대차 +20.5)
  expect((await getTtsLog(page)).some((t) => t.includes('추세 알람 증가 : 20.5'))).toBe(true);
  // v0.13.0 시각검증: 빨강(pending) 팝업 + R3 hero 라벨 캡처(414px). 비단언 — 레이아웃 확인용.
  await expect(page.locator('[data-testid="anomaly-alert"][data-status="pending"]')).toBeVisible();
  await page.screenshot({ path: 'test-results/v013-anomaly-red.png' });

  // 새 값(여전히 커짐) → 재입력(corrected) + 재알림 (절대차 +30.5).
  await fireStt(page, '130.5', 500);
  expect((await getTtsLog(page)).some((t) => t.includes('추세 알람 증가 : 30.5'))).toBe(true);
  expect(await getActiveChipName(page)).toContain('횡경'); // 여전히 advance 중단

  // 통과 값(80.5 < 100 — increase는 작아짐 미발화) → 알림 없이 수정 echo + 종경으로 진행.
  await fireStt(page, '80.5', 500);
  await waitForActiveChip(page, '종경');
  const tts = await getTtsLog(page);
  expect(tts.some((t) => t.includes('수정 횡경, 80.5'))).toBe(true);
  // v0.20.0: 알람 문구가 값을 포함하지 않아 누적 TTS 로그론 "이번 80.5 커밋이 알람 없음"을 못 가린다
  // (앞선 120.5/130.5 알람 문자열이 로그에 남아 있음). 대신 알람 팝업이 닫혔고 종경으로 advance됐음
  // (위 waitForActiveChip)으로 "이번 커밋은 알람 없이 통과"를 확인한다.
  await expect(page.locator('[data-testid="anomaly-alert"]')).toBeHidden();

  await fireStt(page, '50.5', 500); // 종경: 직전 50.0 대비 1% < 15% → 알림 없음
  await waitForRow(page, 2);

  // 최종값 = 마지막 발화.
  const sessions = await getIdbSessions(page);
  const row1 = sessions[sessions.length - 1].rows.find((r) => r.index === 1)!;
  expect(row1.values.c8).toBe('80.5');

  // 로그 zip 소스(IDB logEvents)에 trend_* 전 계열이 남는다.
  const events = await getTrendEvents(page);
  expect(events.filter((e) => (e.extra ?? '').startsWith('trend_alert_fired'))).toHaveLength(2);
  expect(events.filter((e) => e.extra === 'trend_alert_corrected')).toHaveLength(2);
  expect(events.filter((e) => e.extra === 'trend_alert_confirmed')).toHaveLength(0);
  // v0.34.0 O1 — persist 검사 시점 이동 회귀: 교정 커밋(130.5 재위반 + 80.5 통과) 각각 검사 1회,
  // 전부 :ok — 커밋 경로 종단 이후로 미뤄 07-14 mismatch 오탐(정정 직후 조기 검사)이 재현되지 않는다.
  const persistChecks = events.filter((e) => (e.extra ?? '').startsWith('trend_corrected_persist_check'));
  expect(persistChecks).toHaveLength(2);
  expect(persistChecks.every((e) => e.extra === 'trend_corrected_persist_check:ok')).toBe(true);
  for (const e of events) {
    expect(e.row).toBe(1);
    expect(e.colId).toBe('c8');
  }
});

test('[리뷰 High] 교정 saveSession IDB 실패 → persist_check가 ok를 기록하지 않고 write_failed', async ({ page }) => {
  await setupAndStart(page);
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '120.5', 500);
  await expect(page.locator('[data-testid="anomaly-alert"]')).toBeVisible();

  // quota/transaction 실패를 sessions store put에만 주입한다. logEvents는 정상 저장돼 실패 텔레메트리를
  // 검증할 수 있고, dataStore 메모리값만 보고 :ok를 찍던 과거 결함을 정확히 재현한다.
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    Object.defineProperty(IDBObjectStore.prototype, 'put', {
      configurable: true,
      value: function(this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
        if (this.name === 'sessions') throw new DOMException('quota-test', 'QuotaExceededError');
        return original.apply(this, args);
      },
    });
  });
  await fireStt(page, '80.5', 700);

  await expect.poll(async () => {
    const events = await getTrendEvents(page);
    return events.filter((e) => (e.extra ?? '').startsWith('trend_corrected_persist_check')).map((e) => e.extra);
  }).toContain('trend_corrected_persist_check:write_failed');
  const checks = (await getTrendEvents(page))
    .filter((e) => (e.extra ?? '').startsWith('trend_corrected_persist_check'));
  expect(checks.some((e) => e.extra === 'trend_corrected_persist_check:ok')).toBe(false);
});

test('[리뷰 High] 교정 IDB 재조회 실패 → mismatch가 아닌 persist_check:read_failed', async ({ page }) => {
  await setupAndStart(page);
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '120.5', 500);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.get;
    Object.defineProperty(IDBObjectStore.prototype, 'get', {
      configurable: true,
      value: function(this: IDBObjectStore, ...args: Parameters<IDBObjectStore['get']>) {
        if (this.name === 'sessions') throw new DOMException('read-test', 'UnknownError');
        return original.apply(this, args);
      },
    });
  });
  await fireStt(page, '80.5', 700);
  await expect.poll(async () => {
    const events = await getTrendEvents(page);
    return events.filter((e) => (e.extra ?? '').startsWith('trend_corrected_persist_check')).map((e) => e.extra);
  }).toContain('trend_corrected_persist_check:read_failed');
  const checks = (await getTrendEvents(page)).filter((e) => (e.extra ?? '').startsWith('trend_corrected_persist_check'));
  expect(checks.some((e) => e.extra === 'trend_corrected_persist_check:mismatch')).toBe(false);
});

test('알림 상태 밖 "확인" → 상태 변경 없이 재안내(진행 안 함)', async ({ page }) => {
  await setupAndStart(page);

  await waitForActiveChip(page, '횡경');
  await fireStt(page, '확인', 500);

  expect((await getTtsLog(page)).some((t) => t.includes('확인할 알림이 없습니다. 횡경 말씀해 주세요.'))).toBe(true);
  expect(await getActiveChipName(page)).toContain('횡경'); // 진행 안 함

  // 이후 통과 값은 정상 흐름(80.5 < 100 — increase는 작아짐 미발화).
  await fireStt(page, '80.5', 500);
  await waitForActiveChip(page, '종경');
});

test('fetch 실패(500) → 알림 없이 조용히 진행 + trend_skip:no_index 원인당 1회', async ({ page }) => {
  await setupAndStart(page, { sheetsFail: true });

  // 행1: 알람이어야 할 120.5가 알림 없이 정상 echo·진행(인덱스 없음 → 조용히 skip).
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '120.5', 500);
  await waitForActiveChip(page, '종경');
  expect((await getTtsLog(page)).some((t) => /추세 알람|범위 알람/.test(t))).toBe(false);
  await fireStt(page, '50.5', 500);
  await waitForRow(page, 2);

  // 행2 횡경도 skip — 같은 원인(no_index)은 다시 로깅하지 않는다(세션당 1회).
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '130.5', 500);
  await waitForActiveChip(page, '종경');

  const events = await getTrendEvents(page);
  expect(events.filter((e) => (e.extra ?? '').startsWith('trend_alert_fired'))).toHaveLength(0);
  expect(events.filter((e) => e.extra === 'trend_skip:no_index')).toHaveLength(1);
});

// v0.13.0 R2 시각검증: 이상치(빨강) → 정상값 정정 → corrected(초록) 팝업 캡처(414px). 비단언.
// corrected 팝업은 echo TTS 동안만 노출되고 advance로 닫힌다(useVoiceSession의 setAnomalyAlert
// status:'corrected' → await speak(echo) → advance → clearAnomalyAlert).
//
// 🔴 2026-07-31 게이트 실패 판정 — **회귀 아니라 원래 있던 테스트측 레이스다.**
//   a018d68(기능 5건 이전) 단독 --repeat-each=10 → 5실패 / HEAD 단독 x10 → 5실패. 동률이다.
//   근인: mock의 onend가 **동기**라 echo TTS의 지속시간이 0이다. 그러면 초록 노출창이 앱의
//   비동기 continuation 한 틱까지로 줄어, toBeVisible 폴링이 절반쯤 그 창을 놓친다.
//   🔑 **노출창을 넓혀 통과시키는 게 아니다** — 초록 전환은 코드 경로에서 무조건 일어나고,
//   실제 브라우저의 TTS는 지속시간이 있다. 창을 0으로 만든 쪽이 mock 인공물이다. 그것만 걷어낸다.
//   지연은 알람 TTS가 끝난 뒤 켠다 — 셋업·알람 구간은 종전 동기 동작 그대로 둔다.
// 🔴 v0.46.1 FB-10(민구 제보 08-07) — **캡처 대상이 바뀌었다.** 정정 완료는 더 이상 초록 알람
//   카드로 표시되지 않는다. 카드를 접고 hero 확정 플래시(값 하나만 크게, 녹색 톤)로 착지한다 —
//   민구가 "붉은 배경톤의 알람카드에서 정상값 출력"을 지적했기 때문이다(CenterStage FB-10 주석).
//   위 「테스트측 레이스」 분석은 **여전히 유효하다**: mock의 동기 onend가 노출창을 0으로 만들고,
//   그 창을 넓히는 것이 이 테스트의 인공물 제거였다. 착지점만 카드 → hero로 바뀌었다.
//   계약 자체(무엇이 떠야 하는가)는 `tests/v0461-fb10-corrected-hero.spec.ts`가 단언한다.
test('[시각] 정정 완료 확정 플래시 캡처', async ({ page }) => {
  await setupAndStart(page);
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '120.5', 300); // 빨강 알람
  await page.evaluate(() => {
    (window as unknown as { __ttsOnendDelayMs?: number }).__ttsOnendDelayMs = 400;
  });
  await fireStt(page, '80.5', 0);    // 정상값 정정 → 알람 카드 접힘 + hero 확정 플래시
  const confirm = page.locator('[data-hero-state="confirm"]');
  await expect(confirm).toBeVisible({ timeout: 2000 });
  await expect(page.locator('[data-testid="anomaly-alert"]'), '알람 카드는 남지 않는다').toHaveCount(0);
  await page.screenshot({ path: 'test-results/v013-anomaly-green.png' });
});
