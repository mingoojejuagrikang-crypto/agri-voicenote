/**
 * 🔬 **프로브 — FB-10(알람 해제 후 색 전이) A-1 실측.** 릴리스 게이트가 아니다(`_` 접두).
 *
 *   npx playwright test tests/_probe-fb10-transition.spec.ts --config=playwright.probe.config.ts
 *
 * 민구 제보(08-07): *"알람 해지 조건을 갖췄는데 배경톤이 붉은 상태로 다음 조사로 넘어가는건
 * 사용자가 느끼기엔 부정과 긍정이 섞여 있는 느낌이야."*
 *
 * 재는 것 — **추측 금지, 시계열로 그린다**:
 *   ① `data-voice-tone` / `data-central-state` / `anomaly-alert[data-status]` / `data-hero-state`
 *   ② EdgeGlow 각 톤 레이어의 **실제 computed opacity**(= 화면에 실제로 칠해진 붉은 양).
 *      🔑 `EdgeGlow.tsx:105`가 `transition: opacity 400ms ease`다 — tone 속성이 뒤집혀도
 *      픽셀은 즉시 안 꺼진다. 속성 전환과 페인트 전환은 다른 사건이다.
 *   ③ corrected 노출창(dwell) = corrected 등장 → 알람 카드 detach 까지 ms
 *
 * 뷰포트는 **402×513**(민구 실기기, 브리핑 §3 실측 출발점과 동일 근거).
 *
 * ⚠️ mock TTS의 onend는 기본 **동기**라 echo 지속시간이 0이다(trend-alert.spec.ts:765 주석).
 *    corrected 창은 `await speak(echo)` 안에서만 살아 있으므로 그 창이 인공적으로 0에 수렴한다.
 *    → **두 조건 모두 잰다**: (A) 동기 onend = 최악 경계, (B) onend 1000ms = 실기기 근사.
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
  version: 13,
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

for (const [label, onendDelay] of [['A: 동기 onend(최악 경계)', 0], ['B: onend 1000ms(실기기 근사)', 1000]] as const) {
  test(`[FB-10 A-1] 알람→정정→해제→다음항목 전이 실측 — ${label} @402×513`, async ({ page }) => {
    await setupAndStart(page);
    await waitForActiveChip(page, '횡경');

    // ① 이상치 발화 → 빨강 알람.
    await fireStt(page, '120.5', 600);
    await expect(page.locator('[data-testid="anomaly-alert"][data-status="pending"]')).toBeVisible();

    // ② 샘플러를 알람이 뜬 뒤에 켠다 — 관심 구간은 「해제 이후」다.
    await page.evaluate(({ script, delay }) => {
      (window as unknown as { __ttsOnendDelayMs?: number }).__ttsOnendDelayMs = delay;
      // eslint-disable-next-line no-eval
      eval(script);
    }, { script: SAMPLER, delay: onendDelay });
    await page.waitForTimeout(120); // 알람(pending) 정상 구간 몇 프레임 확보

    // ③ 정상값 정정 발화 → corrected 전이 → advance → 다음 항목.
    await fireStt(page, '80.5', 0);
    await page.waitForTimeout(3500); // 전이가 완전히 가라앉을 때까지

    const samples: Sample[] = await page.evaluate(() => {
      const w = window as unknown as { __fb10: Sample[]; __fb10raf?: number };
      if (w.__fb10raf) clearInterval(w.__fb10raf);
      return w.__fb10;
    });

    const segs = report(`FB-10 A-1 · ${label} · 402×513`, samples);

    // ── 파생 수치(추측 아님, 시계열에서 계산) ──────────────────────────────
    const tCorrected = samples.find((s) => s.status === 'corrected')?.t ?? null;
    const firstAfterCorrected = samples.findIndex((s) => s.status === 'corrected');
    const tAlertGone = firstAfterCorrected >= 0
      ? samples.slice(firstAfterCorrected).find((s) => s.status === null)?.t ?? null
      : null;
    const tToneGreen = samples.find((s) => s.tone === 'green')?.t ?? null;
    const tRedOut = lastVisibleRed(samples);
    const tHero = samples.find((s) => s.hero !== null)?.t ?? null;
    const heroStates = [...new Set(samples.map((s) => s.hero).filter(Boolean))];
    const centralStates = [...new Set(samples.map((s) => s.central).filter(Boolean))];
    // 알람 카드가 사라진 뒤에도 붉은 글로우가 남아 있었는가 = 민구 제보의 직접 형태.
    const redAfterAlertGone = tAlertGone != null && tRedOut != null ? tRedOut - tAlertGone : null;
    // corrected 노출창.
    const dwell = tCorrected != null && tAlertGone != null ? tAlertGone - tCorrected : null;

    // eslint-disable-next-line no-console
    console.log([
      `\n----- 파생 수치 (${label}) -----`,
      `  샘플 ${samples.length}개 / 구간 ${segs.length}개`,
      `  t(corrected 등장)        = ${tCorrected}`,
      `  t(tone→green)            = ${tToneGreen}`,
      `  t(알람 카드 detach)      = ${tAlertGone}`,
      `  t(붉은 글로우 마지막>.05)= ${tRedOut}`,
      `  t(hero 첫 등장)          = ${tHero}`,
      `  corrected 노출창(dwell)  = ${dwell} ms`,
      `  🔴 카드 detach 후 붉은 글로우 잔존 = ${redAfterAlertGone} ms`,
      `  micLost 배너 관측        = ${samples.some((s) => s.micBanner)} (true면 tone 측정 무효)`,
      `  central 상태 집합        = ${JSON.stringify(centralStates)}`,
      `  hero 상태 집합           = ${JSON.stringify(heroStates)}`,
    ].join('\n'));

    expect(samples.length).toBeGreaterThanOrEqual(10); // 샘플러가 실제로 돌았음을 확인(무판정 방지)
  });
}

/** 비교군 — **정상(비-정정) 커밋**의 확정 플래시. A-3이 재사용을 검토하는 경로다. */
test('[FB-10 A-1 비교군] 정상 커밋의 confirm 플래시 @402×513', async ({ page }) => {
  await setupAndStart(page);
  await waitForActiveChip(page, '횡경');
  await page.evaluate((script) => {
    // eslint-disable-next-line no-eval
    eval(script);
  }, SAMPLER);
  await page.waitForTimeout(120);
  await fireStt(page, '95.0', 0); // 정상 범위(직전 100.0, increase 규칙) → 알람 없음
  await page.waitForTimeout(3000);

  const samples: Sample[] = await page.evaluate(() => {
    const w = window as unknown as { __fb10: Sample[]; __fb10raf?: number };
    if (w.__fb10raf) cancelAnimationFrame(w.__fb10raf);
    return w.__fb10;
  });
  report('FB-10 비교군 · 정상 커밋 confirm 플래시 · 402×513', samples);
  const confirmSamples = samples.filter((s) => s.hero === 'confirm');
  const confirmMs = confirmSamples.length
    ? confirmSamples[confirmSamples.length - 1].t - confirmSamples[0].t : null;
  // eslint-disable-next-line no-console
  console.log([
    `\n----- 비교군 파생 -----`,
    `  confirm 지속 = ${confirmMs} ms (CONFIRM_MS=1500 계약)`,
    `  confirm 중 중앙 텍스트 = ${JSON.stringify([...new Set(confirmSamples.map((s) => s.centerText))].slice(0, 3))}`,
  ].join('\n'));
  expect(samples.length).toBeGreaterThanOrEqual(10);
});
