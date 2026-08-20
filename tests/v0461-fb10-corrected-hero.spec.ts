/**
 * 🔴 v0.46.1 FB-10(민구 실기기 제보 08-07) — **이상치 정정이 정상으로 판명되면 알람 카드가 아니라
 * hero 확정 플래시로 착지한다.**
 *
 * 민구 원문(조건절 그대로):
 *   *"이상값 알람 발생후 새 값 발화후, **화면이 녹색으로 변경되며 인식된 값만 크게 나오고 다음
 *   조사 항목으로 넘어가면 좋겠는데**, 붉은 배경톤의 알람카드에서 정상값 출력후 다음 조사 항목으로
 *   넘어간다는건 수정 되었으면 좋겠어. **알람 해지 조건을 갖췄는데 배경톤이 붉은 상태로 다음
 *   조사로 넘어가는건 사용자가 느끼기엔 부정과 긍정이 섞여 있는 느낌이야.**"*
 *
 * 🔑 **「배경톤」은 실측으로 반증됐다** — 톤(`data-voice-tone`)은 정정 즉시 green으로 뒤집히고
 * 붉은 글로우도 400ms transition으로 카드보다 **먼저** 꺼진다. 붉은 채로 남던 것은 **중앙**이다:
 * corrected 상태의 카드가 「직전 100 / 현재 80.5」 2열 비교 격자를 그대로 세워두고 있었고,
 * 정정 커밋만 확정 플래시에서 빠져 있었다(v0.15.0 A4의 burst 억제). 그 둘이 이 스펙의 대상이다.
 * 실측 구간표·재현: `tests/_probe-fb10-transition.spec.ts`(프로브, 게이트 아님).
 *
 * 🔴 이 스펙이 지키는 계약 4개:
 *   ① 정정 완료 시 **알람 카드(비교 격자 포함)가 화면에서 사라진다** — corrected 카드는 없다.
 *   ② 같은 순간 hero가 **`confirm`**이고 중앙에 **정정값 하나만** 크게 뜬다.
 *   ③ 톤은 **green**이다(부정/긍정 혼재 금지).
 *   ④ 확정 플래시가 **한 번만** 깜빡인다(진입 횟수 1). ⚠️ 이것은 v0.15.0 A4를 지키는 단언이
 *      **아니다** — 아래 ④ 본문의 주석이 왜 아닌지를 적는다. 과대 해석 금지.
 *
 * 뷰포트 **402×513**(민구 실기기). 픽스처는 `trend-alert.spec.ts`와 같은 값이다.
 */
import { test, expect, type Page } from '@playwright/test';

import { BASE } from './baseUrl';
import { GUM_GRANT_SCRIPT } from './fixtures/gum';

test.setTimeout(120_000);

const STORE_KEY = 'agri-voicenote-settings-v3';
const VIEWPORT = { width: 402, height: 513 };

function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const PREV_ROUND = localISO(new Date(Date.now() - 86_400_000));

// trend-alert.spec.ts와 **같은 픽스처**다(복제 — 그 파일의 헬퍼는 파일 스코프라 import하면
// 그쪽 test()가 함께 등록된다). 값을 바꾸면 두 곳이 갈라지므로 프로브는 읽기만 한다.
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
    sessionAutoLabel: 'fb10-probe',
    noisyMode: false,
    speakerphoneMode: false,
    preferredVoiceName: '',
    roundDateColId: null,
  },
  version: 12,
};

const HEADERS = ['조사일자', '농가명', '조사나무', '조사과실', '횡경', '종경'];
const SHEET_ROWS = [
  [PREV_ROUND, '이원창', '1', '1', '100.0', '50.0'],
  [PREV_ROUND, '이원창', '1', '2', '110.0', '55.0'],
];

const MOCK_INIT_SCRIPT = `
(function() {
  window.__ttsLog = [];
  var mockSynth = {
    speak: function(utterance) {
      window.__ttsLog.push(utterance.text);
      try { if (utterance.onstart) utterance.onstart(new Event('start')); } catch(e) {}
      var fireEnd = function() {
        try { if (utterance.onend) utterance.onend(new Event('end')); } catch(e) {}
      };
      var delay = window.__ttsOnendDelayMs || 0;
      if (delay > 0) setTimeout(fireEnd, delay); else fireEnd();
    },
    cancel: function() {}, pause: function() {}, resume: function() {},
    getVoices: function() {
      return [{ name: 'Mock Korean', lang: 'ko-KR', default: true, localService: true, voiceURI: 'mock' }];
    },
    speaking: false, pending: false, paused: false, onvoiceschanged: null,
    addEventListener: function() {}, removeEventListener: function() {},
    dispatchEvent: function() { return true; },
  };
  try {
    Object.defineProperty(window, 'speechSynthesis', {
      get: function() { return mockSynth; }, configurable: true, enumerable: true,
    });
  } catch(e1) { try { window.speechSynthesis = mockSynth; } catch(e3) {} }

  function MockSTT() {
    this._ls = {}; this.continuous = true; this.interimResults = true;
    this.lang = 'ko-KR'; this.maxAlternatives = 3; window.__mockSTT = this;
  }
  MockSTT.prototype.addEventListener = function(t, cb) {
    if (!this._ls[t]) this._ls[t] = []; this._ls[t].push(cb);
  };
  MockSTT.prototype.removeEventListener = function(t, cb) {
    if (this._ls[t]) this._ls[t] = this._ls[t].filter(function(f) { return f !== cb; });
  };
  MockSTT.prototype.start = function() {
    var self = this;
    setTimeout(function() { (self._ls['start'] || []).forEach(function(cb) { cb(new Event('start')); }); }, 5);
  };
  MockSTT.prototype.stop = function() {};
  MockSTT.prototype.abort = function() {
    var self = this;
    setTimeout(function() { (self._ls['end'] || []).forEach(function(cb) { cb(new Event('end')); }); }, 5);
  };
  MockSTT.prototype.fireResult = function(transcript, confidence) {
    if (confidence === undefined) confidence = 0.95;
    var event = { resultIndex: 0, results: { length: 1,
      0: { isFinal: true, length: 1, 0: { transcript: transcript, confidence: confidence } } } };
    (this._ls['result'] || []).forEach(function(cb) { cb(event); });
  };
  try {
    Object.defineProperty(window, 'SpeechRecognition', { value: MockSTT, writable: true, configurable: true, enumerable: true });
  } catch(e1) { try { window.SpeechRecognition = MockSTT; } catch(e2) {} }
  try {
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: MockSTT, writable: true, configurable: true, enumerable: true });
  } catch(e) { try { window.webkitSpeechRecognition = MockSTT; } catch(e2) {} }
})();
`;

/** rAF마다 화면 상태를 한 줄로 적는 샘플러. 속성과 **실제 페인트**를 같은 프레임에서 잡는다. */
const SAMPLER = `
(function() {
  window.__fb10 = [];
  var t0 = performance.now();
  function pick(sel, attr) {
    var el = document.querySelector(sel);
    return el ? el.getAttribute(attr) : null;
  }
  function op(tone) {
    var el = document.querySelector('[data-glow-layer="' + tone + '"]');
    return el ? Math.round(parseFloat(getComputedStyle(el).opacity) * 1000) / 1000 : null;
  }
  function tick() {
    window.__fb10.push({
      t: Math.round(performance.now() - t0),
      tone: pick('[data-voice-tone]', 'data-voice-tone'),
      central: pick('[data-central-state]', 'data-central-state'),
      status: pick('[data-testid="anomaly-alert"]', 'data-status'),
      hero: pick('[data-hero-state]', 'data-hero-state'),
      red: op('red'),
      green: op('green'),
      // micLost 래치 관측 — 이게 켜져 있으면 tone 측정은 무효다(§0-6 무판정).
      micBanner: !!document.querySelector('[data-testid="mic-reconnect-btn"]'),
      // 중앙에 실제로 그려진 값 텍스트(= 「인식된 값만 크게」인지 판정하는 근거).
      centerText: (function() {
        var stage = document.querySelector('[data-testid="voice-center-stage"]');
        return stage ? (stage.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 80) : null;
      })(),
    });
  }
  // 🔴 rAF가 아니라 setInterval이다 — headless에서 rAF가 throttle돼(실측 3.8초에 15샘플 =
  //    253ms 간격) 지속시간 수치가 통째로 못 믿을 값이 됐다. 구간의 **존재**는 맞았지만
  //    **길이**는 아니었다. 16ms 고정 간격으로 바꿔 둘 다 신뢰 가능하게 만든다.
  tick();
  window.__fb10raf = setInterval(tick, 16);
})();
`;

type Sample = {
  t: number; tone: string | null; central: string | null; status: string | null;
  hero: string | null; red: number | null; green: number | null; centerText: string | null;
  micBanner?: boolean;
};

async function stubSheets(page: Page) {
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { values: [HEADERS, ...SHEET_ROWS] } });
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected: ' + route.request().url() });
  });
}

async function setupAndStart(page: Page) {
  await page.setViewportSize(VIEWPORT);
  await stubSheets(page);
  // 🔴 헤드리스 크로미엄은 getUserMedia를 기본 거부하고, 그 거부가 `mic_lost` 래치로 이어져
  //    `VoiceScreen.tsx:129`의 `anomalyPending || micLost ? 'red'`가 **알람과 무관하게 톤을
  //    red로 붙든다**. 1차 실측(GUM 미승인)에서 「정상 커밋 비교군도 전 구간 red」가 나온 것이
  //    그 인공물이었다. 톤 전이를 재려면 반드시 승인 스텁을 깐다(fixtures/gum.ts).
  await page.addInitScript(GUM_GRANT_SCRIPT);
  await page.addInitScript(MOCK_INIT_SCRIPT);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ settings, storeKey }) => {
    localStorage.clear();
    localStorage.setItem('gs10_google_token', JSON.stringify({
      access_token: 'test-token', expires_at: Date.now() + 3600_000, email: 'tester@example.com',
    }));
    localStorage.setItem(storeKey, JSON.stringify(settings));
  }, { settings: SETTINGS, storeKey: STORE_KEY });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(200);
  const startBtn = page.locator('text=음성 입력 시작').first();
  await expect(startBtn).toBeVisible();
  // 🔴 v0.46.1 — 시작 버튼은 **잠시 disabled로 뜬다**(WP-1c 「시작 준비」 실제 확인 구간, 01da2ea).
  //    visible만 보고 바로 클릭하면 `element is not enabled`로 30초를 태우다 무판정으로 끝난다
  //    (실측 2회). 활성화까지 명시적으로 기다린다 — 이건 대기 조건이지 제품 동작 가정이 아니다.
  // ⏱ 30초다. 15초로는 부족했다 — 다른 레인과 CPU를 나눠 쓰면(실측 load 9+) 준비 절차가
  //    그만큼 늘어져 `element is not enabled`로 **무판정**이 난다(§0-6). 테스트 타임아웃 120초 안이다.
  await expect(startBtn).toBeEnabled({ timeout: 30_000 });
  await startBtn.click();
  await page.waitForTimeout(800);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
}

async function fireStt(page: Page, transcript: string, waitMs = 300) {
  await page.evaluate((t) => {
    (window as unknown as { __mockSTT?: { fireResult: (t: string, c: number) => void } })
      .__mockSTT?.fireResult(t, 0.95);
  }, transcript);
  await page.waitForTimeout(waitMs);
}

async function waitForActiveChip(page: Page, colName: string, timeout = 5000) {
  await page.waitForFunction((name) => {
    const chip = document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
    return (chip?.dataset.colName ?? '').includes(String(name));
  }, colName, { timeout });
}

/** 연속 샘플을 「상태가 바뀐 순간」만 남긴 구간표로 접는다. */
function toSegments(samples: Sample[]) {
  const key = (s: Sample) => `${s.tone}|${s.central}|${s.status}|${s.hero}`;
  const segs: Array<{ from: number; to: number; tone: string | null; central: string | null; status: string | null; hero: string | null; redRange: string; centerText: string | null }> = [];
  for (const s of samples) {
    const last = segs[segs.length - 1];
    if (last && key(samples[0]) !== undefined && `${last.tone}|${last.central}|${last.status}|${last.hero}` === key(s)) {
      last.to = s.t;
      const [lo, hi] = last.redRange.split('→');
      last.redRange = `${lo}→${s.red ?? '-'}`;
      if (!last.centerText && s.centerText) last.centerText = s.centerText;
      continue;
    }
    segs.push({
      from: s.t, to: s.t, tone: s.tone, central: s.central, status: s.status, hero: s.hero,
      redRange: `${s.red ?? '-'}→${s.red ?? '-'}`, centerText: s.centerText,
    });
  }
  return segs;
}

function report(title: string, samples: Sample[]) {
  const segs = toSegments(samples);
  const lines = segs.map((s) =>
    `  ${String(s.from).padStart(5)}~${String(s.to).padStart(5)}ms (${String(s.to - s.from).padStart(4)}ms) `
    + `tone=${String(s.tone).padEnd(5)} central=${String(s.central).padEnd(5)} `
    + `alert=${String(s.status).padEnd(9)} hero=${String(s.hero).padEnd(9)} `
    + `redGlow=${s.redRange.padEnd(13)} | ${s.centerText ?? ''}`);
  // eslint-disable-next-line no-console
  console.log(`\n===== ${title} =====\n${lines.join('\n')}`);
  return segs;
}

/** 붉은 글로우가 「눈에 보이는」 마지막 시점. 0.05는 4겹 적층에서 사실상 소등된 수준. */
function lastVisibleRed(samples: Sample[], threshold = 0.05): number | null {
  for (let i = samples.length - 1; i >= 0; i--) {
    if ((samples[i].red ?? 0) > threshold) return samples[i].t;
  }
  return null;
}


/** 🔴 시계열은 **MutationObserver**로 모은다 — 타이머로 재려던 시도는 세 번 다 실패했다.
 *
 *  | 방식 | 3.5초 동안 모인 샘플 | 왜 죽었나 |
 *  |---|---|---|
 *  | 페이지 `requestAnimationFrame` | 15개 (~253ms 간격) | 헤드리스 rAF 스로틀 |
 *  | 페이지 `setInterval(16ms)` | 5개 (~700ms) | 백그라운드 1초 클램프에 근접 |
 *  | 드라이버 `page.evaluate` 폴링 | **3~5개** | load 9+에서 왕복 자체가 700ms 넘게 걸린다 |
 *
 *  세 방식 모두 **표본 추출**이라 부하가 곧 해상도 손실이다. 그런데 이 스펙이 묻는 것은
 *  「몇 ms였나」가 아니라 **「그 상태가 한 번이라도 그려졌나」**다 — 그건 표본이 아니라
 *  **변화 이벤트**로 재는 것이 맞다. MutationObserver는 마이크로태스크로 돌아 타이머 정책과
 *  무관하고, DOM이 바뀔 때만 깨므로 부하에도 상태를 놓치지 않는다.
 *  ⚠️ 그래서 `t`는 참고값이다. 아래 단언은 **상태의 집합·순서·개수만** 쓰고 시간은 쓰지 않는다. */
const OBSERVER = `
(function() {
  window.__fb10 = [];
  var t0 = performance.now();
  function snap() {
    function pick(sel, attr) { var el = document.querySelector(sel); return el ? el.getAttribute(attr) : null; }
    var stage = document.querySelector('[data-testid="voice-center-stage"]');
    return {
      t: Math.round(performance.now() - t0),
      tone: pick('[data-voice-tone]', 'data-voice-tone'),
      central: pick('[data-central-state]', 'data-central-state'),
      status: pick('[data-testid="anomaly-alert"]', 'data-status'),
      hero: pick('[data-hero-state]', 'data-hero-state'),
      red: null, green: null,
      // 🔴 innerText가 아니라 textContent — innerText는 레이아웃을 강제해서 부하가 심할 때
      //    관측 자체가 느려진다. 우리가 보는 것은 「어떤 값이 그려졌나」뿐이라 충분하다.
      centerText: stage ? (stage.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80) : null,
    };
  }
  window.__fb10.push(snap());
  var mo = new MutationObserver(function() { window.__fb10.push(snap()); });
  mo.observe(document.body, { subtree: true, attributes: true, childList: true, characterData: true });
  window.__fb10stop = function() { mo.disconnect(); };
})();
`;

/** 알람이 뜬 상태에서 정상값을 발화하고, 그 전이 전 구간을 시계열로 받는다. */
async function captureCorrectionTimeline(page: Page, onendDelayMs: number): Promise<Sample[]> {
  await setupAndStart(page);
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '120.5', 600); // 직전 100.0 · trendRule=increase → 이상치 알람
  await expect(page.locator('[data-testid="anomaly-alert"][data-status="pending"]')).toBeVisible();
  await page.evaluate(({ script, delay }) => {
    (window as unknown as { __ttsOnendDelayMs?: number }).__ttsOnendDelayMs = delay;
    // eslint-disable-next-line no-eval
    eval(script);
  }, { script: OBSERVER, delay: onendDelayMs });
  await fireStt(page, '80.5', 3500); // 전이가 완전히 가라앉을 때까지 관측한다
  return page.evaluate(() => {
    const w = window as unknown as { __fb10: Sample[]; __fb10stop?: () => void };
    w.__fb10stop?.();
    return w.__fb10;
  });
}

// ⚠️ mock TTS의 onend는 기본 **동기**라 echo 지속시간이 0이다(trend-alert.spec.ts:765 주석).
//    정정 직후 구간이 인공적으로 짧아지므로 **두 조건 모두** 건다: 동기(최악 경계)와 1000ms(실기기 근사).
for (const [label, onendDelay] of [['동기 onend(최악 경계)', 0], ['onend 1000ms(실기기 근사)', 1000]] as const) {
  test(`[FB-10] 정정 완료 → 알람 카드 소멸 + hero 확정 플래시(값만, green) — ${label} @402×513`, async ({ page }) => {
    const samples = await captureCorrectionTimeline(page, onendDelay);
    expect(samples.length, '샘플러가 실제로 돌았다(무판정 방지)').toBeGreaterThanOrEqual(20);
    report(`FB-10 게이트 · ${label} · 402×513`, samples);

    // ── ① corrected 알람 카드가 **한 프레임도** 서 있지 않다 ─────────────────────────
    //  `toHaveCount(0)`으로는 이걸 못 잡는다 — 그건 재시도라서 "잠깐 떴다 사라진" 경우도
    //  통과시킨다. 민구가 지적한 것이 정확히 그 「잠깐」이므로 시계열로 센다.
    const correctedFrames = samples.filter((s) => s.status === 'corrected');
    expect(correctedFrames.length, 'corrected 알람 카드가 렌더된 프레임 수').toBe(0);
    const alarmCentralFrames = samples.filter((s) => s.central === 'alarm' && s.hero !== null);
    expect(alarmCentralFrames.length, '알람 중앙과 hero가 동시에 선 프레임(상호배타 계약)').toBe(0);
    await expect(
      page.locator('[data-testid="anomaly-comparison"]'),
      '정정 후 직전/현재 비교 격자는 남지 않는다',
    ).toHaveCount(0);
    await expect(page.locator('[data-testid="anomaly-alert"]'), '알람 카드 자체가 없다').toHaveCount(0);

    // ── ② 확정 플래시가 실제로 떴고, 중앙에 뜬 것은 **정정값 하나**다 ────────────────
    const confirmFrames = samples.filter((s) => s.hero === 'confirm');
    expect(confirmFrames.length, 'hero 확정 플래시 프레임이 존재한다').toBeGreaterThan(0);
    const confirmTexts = [...new Set(confirmFrames.map((s) => (s.centerText ?? '').trim()))];
    expect(confirmTexts, '확정 플래시 중 중앙 텍스트는 정정값 하나뿐').toEqual(['80.5']);

    // ── ③ 그 순간 톤은 green이다(부정/긍정 혼재 금지) ──────────────────────────────
    const tonesWhileConfirm = [...new Set(confirmFrames.map((s) => s.tone))];
    expect(tonesWhileConfirm, '확정 플래시 구간의 톤은 green 단독').toEqual(['green']);

    // ── ④ 확정 플래시가 **한 번만** 깜빡인다 ──────────────────────────────────
    //  confirm으로 **진입한 횟수**를 센다(1이어야 한다). 값이 떴다 사라졌다 다시 뜨면 2가 된다.
    //
    //  ⚠️ **이것은 v0.15.0 A4를 지키는 단언이 아니다 — 그렇게 읽지 마라.** A4가 막으려던 이중
    //  노출은 `CenterValueBurst`라는 별도 컴포넌트를 통했는데 **그 컴포넌트는 이미 코드에 없다**
    //  (`useVoiceSession.ts` A4 주석에 이름만 남아 있다). 그리고 `useVoiceSession`의 burst 억제를
    //  풀어도 이 개수는 **1로 남는다** — 그 push는 hero가 아직 언마운트인 시점이라 마운트 가드에
    //  삼켜지고, 플래시를 무장하는 것은 여전히 `confirmBurst` 하나뿐이기 때문이다.
    //  👉 A4 계약을 직접 재려면 store `valueBurst.seq`를 정정 전후로 비교해야 하는데, 그 store는
    //  window에 노출돼 있지 않다(계측용 노출을 새로 뚫는 것은 이 과제 범위 밖으로 뒀다).
    //  여기서 고정하는 것은 **화면이 한 번만 깜빡인다**는 것뿐이고, 그것만으로 적는다.
    let entries = 0;
    for (let i = 1; i < samples.length; i++) {
      if (samples[i].hero === 'confirm' && samples[i - 1].hero !== 'confirm') entries++;
    }
    expect(entries, '확정 플래시 진입 횟수(값이 두 번 깜빡이지 않는다)').toBe(1);
  });
}

test('[FB-10 대조군] 알람 대기(pending) 중에는 비교 격자가 그대로 있다 — 삭제가 무차별이 아니다', async ({ page }) => {
  await setupAndStart(page);
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '120.5', 600);
  // 정정 **전**에는 카드도 비교 격자도 살아 있어야 한다. 이 대조군이 없으면 위 스펙은
  // "알람을 통째로 없앴다"로도 통과한다.
  await expect(page.locator('[data-testid="anomaly-alert"][data-status="pending"]')).toBeVisible();
  await expect(page.locator('[data-testid="anomaly-comparison"]')).toBeVisible();
  await expect(page.locator('[data-testid="anomaly-headline"]')).toBeVisible();
  await expect(page.locator('[data-hero-state]'), '알람 중에는 hero가 붙지 않는다').toHaveCount(0);
});
