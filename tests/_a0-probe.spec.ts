/**
 * 🔴 **A0 레인 조사용 임시 계측 스펙 — 오라클이 아니다. 규명이 끝나면 삭제한다.**
 *
 *  목적: 실기기 제보 F01(히어로 값이 화면 폭을 넘어 잘림)이 데스크톱 Chromium 402×874에서
 *  재현되는지, 재현된다면 `--fit-value`가 어느 방향으로 틀어졌는지를 **숫자로** 남긴다.
 *  단언은 최소한만 둔다(측정이 실제로 일어났는지 확인용). 판정은 산출물 문서가 한다.
 *
 *  Part A — 계측기 자체의 검증(앱 무관 순수 CSS).
 *    `fitGroup.ts:38`의 넘침 판정 `member.scrollWidth > member.clientWidth`가
 *    `text-align:center` + `white-space:nowrap` + `overflow:hidden` 조합에서 실제 오버플로를
 *    보는지 잰다. **못 보면 계측기가 곧 용의자**이므로 Part B를 scrollWidth로 판정하면 안 된다.
 *    독립 계측기로 텍스트 노드 `Range.getBoundingClientRect()`(잉크 폭, clip 무관)를 쓴다.
 *
 *  Part B — F01 재현 실측(앱).
 *    F01 원문/스크린샷 근거: ~/workspace_teamops/inbox/2026-08-02-devacct/x-fb/
 *      feedback_2026-08-02_1785652500526/ (iPhone iOS 18.7 Safari, screenW/H 402/874, v0.43.0,
 *      tab=voice, sessionPhase=active, 2/18행, confirm 상태, 항목명 "종경", 값 "44.4")
 *
 *  harness(MOCK_INIT_SCRIPT/boot/startSession/fireStt)는 `v035-hero-confirm.spec.ts`에서 복제했다.
 *  (그 파일을 import하면 그쪽 test들이 같이 돌아 조사 비용이 커진다 — 복제가 의도적이다)
 */
import { test, expect, type Page } from '@playwright/test';
import { BASE } from './baseUrl';

test.setTimeout(120_000);

const STORE_KEY = 'agri-voicenote-settings-v3';
const PHONE_402 = { width: 402, height: 874 };

// ── Part A ──────────────────────────────────────────────────────────────────
// HeroPrimaryLine(VoiceHero.tsx:296-309)의 CSS를 그대로 옮긴 최소 재현. 앱을 띄우지 않는다.
const CSS_PROBE_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:#000;color:#fff;font-family:system-ui,sans-serif}
  /* VoiceHero 루트(113-131)의 폭 계약: width:100%; maxWidth:min(560px,94vw) */
  #root{width:100%;max-width:min(560px,94vw);margin:0 auto;min-width:0}
  /* HeroValueSlot(270-275) */
  #slot{width:100%;display:flex;align-items:center;justify-content:center;min-width:0;flex-shrink:0}
  /* HeroPrimaryLine(296-309) — fontSize만 테스트가 주입한다 */
  #line{font-weight:900;line-height:1.04;letter-spacing:-2px;font-variant-numeric:tabular-nums;
        display:block;width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
        word-break:normal;overflow-wrap:normal;text-align:center}
</style></head><body>
  <div id="root"><div id="slot"><span id="line"></span></div></div>
</body></html>`;

/** 텍스트 노드의 실제 잉크 폭 — clip/overflow와 무관한 독립 계측기. */
const MEASURE_FN = `(el) => {
  const node = el.firstChild;
  const r = document.createRange();
  r.selectNodeContents(el);
  const rangeW = r.getBoundingClientRect().width;
  const box = el.getBoundingClientRect();
  return {
    text: el.textContent,
    fontSize: getComputedStyle(el).fontSize,
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    rangeInkWidth: rangeW,
    boxLeft: box.left, boxRight: box.right, boxWidth: box.width,
    hasTextNode: !!node,
  };
}`;

test('[A0-PartA] 계측기 검증 — center+nowrap+hidden에서 scrollWidth가 오버플로를 보는가', async ({ page }) => {
  await page.setViewportSize(PHONE_402);
  await page.setContent(CSS_PROBE_HTML, { waitUntil: 'domcontentloaded' });

  const rows: unknown[] = [];
  // F01 값 '44.4'를 여러 fontSize에서 — 어디서부터 넘치고, 그때 scrollWidth가 반응하는가.
  for (const [text, fontSize] of [
    ['44.4', 64], ['44.4', 100], ['44.4', 140], ['44.4', 170], ['44.4', 200], ['44.4', 300],
    ['1234.5', 64], ['1234.5', 120],
  ] as const) {
    const r = await page.evaluate(
      ({ text, fontSize, fn }) => {
        const el = document.getElementById('line')!;
        el.textContent = text;
        el.style.fontSize = `${fontSize}px`;
        // eslint-disable-next-line no-eval
        return (eval(fn) as (e: HTMLElement) => unknown)(el);
      },
      { text, fontSize, fn: MEASURE_FN },
    );
    rows.push({ input: { text, fontSize }, ...(r as object) });
  }

  // 같은 CSS에서 text-align만 left로 바꾼 대조군 — 방향성이 원인인지 가른다.
  const leftAligned: unknown[] = [];
  for (const align of ['left', 'center', 'right'] as const) {
    const r = await page.evaluate(
      ({ align, fn }) => {
        const el = document.getElementById('line')!;
        el.textContent = '44.4';
        el.style.fontSize = '200px';
        el.style.textAlign = align;
        // eslint-disable-next-line no-eval
        return (eval(fn) as (e: HTMLElement) => unknown)(el);
      },
      { align, fn: MEASURE_FN },
    );
    leftAligned.push({ align, ...(r as object) });
  }

  console.log('=== A0-PartA::sweep ===\n' + JSON.stringify(rows, null, 1));
  console.log('=== A0-PartA::align ===\n' + JSON.stringify(leftAligned, null, 1));
  expect(rows.length).toBe(8);
});

/** Part A2 — 🔴 **멤버의 display 형태별로 scrollWidth가 다른 것을 보는가.**
 *  Part A는 텍스트 노드 단독 block(HeroPrimaryLine 형태)만 검증했다. 그런데
 *  HeroNameLine(VoiceHero.tsx:244-262)은 **inline-flex + 자식 span 2개 + justifyContent:center**다.
 *  flex 컨테이너에서 자식이 넘치면 inline-start(LTR 좌측) 오버플로는 스크롤 불가 영역이 되어
 *  scrollWidth에 잡히지 않는다는 알려진 동작이 있다. 실측으로 가른다. */
const CSS_PROBE2_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:#000;color:#fff;font-family:system-ui,sans-serif}
  #root{width:100%;max-width:min(560px,94vw);margin:0 auto;min-width:0}
  /* A: HeroPrimaryLine 형태 — block + text-align:center, 텍스트 노드 단독 */
  #blockLine{font-weight:900;line-height:1.04;letter-spacing:-2px;display:block;width:100%;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center}
  /* B: HeroNameLine 형태 — inline-flex + justify-content:center, 자식 span 2개 */
  #flexLine{font-weight:900;line-height:1.04;letter-spacing:-0.6px;
        display:inline-flex;align-items:baseline;justify-content:center;gap:0.22em;
        width:100%;white-space:nowrap;overflow:hidden;flex-shrink:0;text-align:center}
</style></head><body>
  <div id="root">
    <span id="blockLine"></span>
    <span id="flexLine"><span id="chk" style="flex-shrink:0">✓</span><span id="nm"></span></span>
  </div>
</body></html>`;

const MEASURE2_FN = `(el) => {
  const r = document.createRange(); r.selectNodeContents(el);
  const ink = r.getBoundingClientRect();
  const box = el.getBoundingClientRect();
  return {
    fontSize: getComputedStyle(el).fontSize,
    scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
    boxLeft: +box.left.toFixed(3), boxRight: +box.right.toFixed(3), boxW: +box.width.toFixed(3),
    inkLeft: +ink.left.toFixed(3), inkRight: +ink.right.toFixed(3), inkW: +ink.width.toFixed(3),
    overflowLeftPx: +(box.left - ink.left).toFixed(3),
    overflowRightPx: +(ink.right - box.right).toFixed(3),
    overflowTotalPx: +(ink.width - box.width).toFixed(3),
    scrollWidthMinusClient: el.scrollWidth - el.clientWidth,
  };
}`;

test('[A0-PartA2] 계측기 검증2 — block(값) vs inline-flex(라벨)에서 scrollWidth가 보는 것이 다른가', async ({ page }) => {
  await page.setViewportSize(PHONE_402);
  await page.setContent(CSS_PROBE2_HTML, { waitUntil: 'domcontentloaded' });

  const out: unknown[] = [];
  for (const fs of [60, 100, 132.229, 160, 200] as const) {
    const r = await page.evaluate(
      ({ fs, fn }) => {
        const bl = document.getElementById('blockLine')!;
        bl.textContent = '44.4';
        bl.style.fontSize = `${fs}px`;
        const fl = document.getElementById('flexLine')!;
        document.getElementById('nm')!.textContent = '종경';
        fl.style.fontSize = `${fs}px`;
        void document.body.offsetHeight;
        // eslint-disable-next-line no-eval
        const m = eval(fn) as (e: HTMLElement) => Record<string, unknown>;
        return { fontSize: fs, block: m(bl), flex: m(fl) };
      },
      { fs, fn: MEASURE2_FN },
    );
    out.push(r);
  }
  console.log('=== A0-PartA2::form-compare ===\n' + JSON.stringify(out, null, 1));
  expect(out.length).toBe(5);
});

// ── Part B ──────────────────────────────────────────────────────────────────
// F01 재현: 항목명 "종경"(행의 마지막 음성 컬럼 아님 — confirm 창을 CONFIRM_MS 동안 유지하려면
// 뒤에 음성 컬럼이 하나 더 있어야 한다. F01 스크린샷은 종경이 활성 칩이고 확인표시가 떠 있는
// 상태이므로, 재현에서는 "종경" 커밋 직후의 confirm 프레임을 잰다).
const COLUMNS = [
  { id: 'c1', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 18 }, sampleKey: true },
  { id: 'c2', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  { id: 'c3', name: '종경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  { id: 'c4', name: '착과수', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];

const SETTINGS = {
  state: {
    googleConnected: true,
    userEmail: 'tester@example.com',
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_A0_PROBE/edit',
    sheetTab: 'Sheet1',
    columnsSheetId: 'SHEET_A0_PROBE',
    columnsSheetTab: 'Sheet1',
    columns: COLUMNS,
    tableGenerated: true,
    totalRows: 18,
    ttsRate: 1.05,
    recognitionTolerance: 0.5,
    sessionLabelColId: null,
    sessionAutoLabel: 'a0-probe',
    preferredVoiceName: '',
    roundDateColId: null,
  },
  version: 12,
};

const HEADERS = ['조사일자', '조사나무', '횡경', '종경', '착과수'];
const SHEET_ROWS = Array.from({ length: 18 }, (_, i) => ['2026-01-01', String(i + 1), '', '', '']);

const MOCK_INIT_SCRIPT = `
(function() {
  window.__ttsLog = [];
  var fakeTrack = {
    kind: 'audio', label: 'Fake Mic', readyState: 'live', muted: false,
    getSettings: function(){ return { deviceId: 'fake-mic' }; },
    addEventListener: function(){}, removeEventListener: function(){}, stop: function(){},
  };
  window.__fakeMicTrack = fakeTrack;
  var fakeStream = { getAudioTracks: function(){ return [fakeTrack]; }, getTracks: function(){ return [fakeTrack]; } };
  if (navigator.mediaDevices) {
    try { navigator.mediaDevices.getUserMedia = function(){ return Promise.resolve(fakeStream); }; } catch(e){}
  }
  var mockSynth = {
    speak: function(u) { window.__ttsLog.push(u.text);
      try { if (u.onstart) u.onstart(new Event('start')); } catch(e){}
      setTimeout(function(){ try { if (u.onend) u.onend(new Event('end')); } catch(e){} }, 200); },
    cancel: function(){}, pause: function(){}, resume: function(){},
    getVoices: function(){ return [{ name:'Mock Korean', lang:'ko-KR', default:true, localService:true, voiceURI:'mock' }]; },
    speaking:false, pending:false, paused:false, onvoiceschanged:null,
    addEventListener:function(){}, removeEventListener:function(){}, dispatchEvent:function(){ return true; },
  };
  try { Object.defineProperty(window,'speechSynthesis',{ get:function(){ return mockSynth; }, configurable:true, enumerable:true }); }
  catch(e){ try { window.speechSynthesis = mockSynth; } catch(e2){} }

  function MockSTT(){ this._ls={}; this.continuous=true; this.interimResults=true; this.lang='ko-KR'; this.maxAlternatives=3; window.__mockSTT=this; }
  MockSTT.prototype.addEventListener=function(t,cb){ if(!this._ls[t])this._ls[t]=[]; this._ls[t].push(cb); };
  MockSTT.prototype.removeEventListener=function(t,cb){ if(this._ls[t])this._ls[t]=this._ls[t].filter(function(f){return f!==cb;}); };
  MockSTT.prototype.start=function(){ var s=this; setTimeout(function(){ (s._ls['start']||[]).forEach(function(cb){cb(new Event('start'));}); },5); };
  MockSTT.prototype.stop=function(){};
  MockSTT.prototype.abort=function(){ var s=this; setTimeout(function(){ (s._ls['end']||[]).forEach(function(cb){cb(new Event('end'));}); },5); };
  MockSTT.prototype.fireResult=function(transcript,confidence){ if(confidence===undefined)confidence=0.95;
    var ev={ resultIndex:0, results:{ length:1, 0:{ isFinal:true, length:1, 0:{ transcript:transcript, confidence:confidence } } } };
    (this._ls['result']||[]).forEach(function(cb){cb(ev);}); };
  MockSTT.prototype.fireInterim=function(transcript){
    var ev={ resultIndex:0, results:{ length:1, 0:{ isFinal:false, length:1, 0:{ transcript:transcript, confidence:0.9 } } } };
    (this._ls['result']||[]).forEach(function(cb){cb(ev);}); };
  try { Object.defineProperty(window,'SpeechRecognition',{ value:MockSTT, writable:true, configurable:true, enumerable:true }); }
  catch(e){ try { window.SpeechRecognition=MockSTT; } catch(e2){} }
  try { Object.defineProperty(window,'webkitSpeechRecognition',{ value:MockSTT, writable:true, configurable:true, enumerable:true }); }
  catch(e){ try { window.webkitSpeechRecognition=MockSTT; } catch(e2){} }
})();
`;

async function stubSheets(page: Page) {
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { values: [HEADERS, ...SHEET_ROWS] } });
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected' });
  });
}

async function boot(page: Page) {
  await page.setViewportSize(PHONE_402);
  await stubSheets(page);
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
    { settings: SETTINGS, storeKey: STORE_KEY },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(200);
}

async function startSession(page: Page) {
  const startBtn = page.locator('text=음성 입력 시작').first();
  await expect(startBtn).toBeVisible();
  await startBtn.click();
  await page.waitForTimeout(800);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
}

async function fireStt(page: Page, transcript: string) {
  await page.evaluate((t) => {
    (window as unknown as { __mockSTT?: { fireResult: (t: string, c: number) => void } })
      .__mockSTT?.fireResult(t, 0.95);
  }, transcript);
}

/** 히어로 루트 + 값 멤버 + 라벨 멤버를 한 번에 잰다. 잉크 폭(Range)은 clip 무관 독립 계측기. */
const SNAPSHOT_FN = `() => {
  const root = document.querySelector('[data-hero-state]');
  const val = document.querySelector('[data-testid="hero-primary"]')
           || document.querySelector('[data-testid="interim-value"]');
  const label = document.querySelector('[data-fit-group="label"]');
  const ink = (el) => { if (!el) return null; const r = document.createRange(); r.selectNodeContents(el); const b = r.getBoundingClientRect(); return { w: b.width, left: b.left, right: b.right }; };
  const box = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { w: b.width, h: b.height, left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
  const rs = root ? getComputedStyle(root) : null;
  return {
    heroState: root ? root.getAttribute('data-hero-state') : null,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    fitValueVar: rs ? rs.getPropertyValue('--fit-value').trim() : null,
    fitLabelVar: rs ? rs.getPropertyValue('--fit-label').trim() : null,
    fitValueInline: root ? root.style.getPropertyValue('--fit-value').trim() : null,
    fitLabelInline: root ? root.style.getPropertyValue('--fit-label').trim() : null,
    root: root ? {
      scrollWidth: root.scrollWidth, clientWidth: root.clientWidth,
      scrollHeight: root.scrollHeight, clientHeight: root.clientHeight,
      box: box(root),
      overflowY: rs.overflowY, overflowX: rs.overflowX,
    } : null,
    value: val ? {
      testid: val.getAttribute('data-testid'),
      text: val.textContent,
      fontSize: getComputedStyle(val).fontSize,
      scrollWidth: val.scrollWidth, clientWidth: val.clientWidth,
      scrollHeight: val.scrollHeight, clientHeight: val.clientHeight,
      box: box(val), ink: ink(val),
    } : null,
    label: label ? {
      text: label.textContent,
      fontSize: getComputedStyle(label).fontSize,
      scrollWidth: label.scrollWidth, clientWidth: label.clientWidth,
      box: box(label), ink: ink(label),
    } : null,
  };
}`;

async function snapshot(page: Page, tag: string) {
  const s = await page.evaluate((fn) => {
    // eslint-disable-next-line no-eval
    return (eval(fn) as () => unknown)();
  }, SNAPSHOT_FN);
  console.log(`=== A0-PartB::${tag} ===\n` + JSON.stringify(s, null, 1));
  return s as Record<string, any>;
}

test('[A0-PartB] F01 재현 — confirm(종경 / 44.4) 402×874 실측', async ({ page }) => {
  await boot(page);
  await startSession(page);
  await snapshot(page, 'listening-initial');

  // 횡경 커밋(F01 스크린샷의 완료 칩 33.3) → confirm 창을 지나 다음 항목(종경) 대기로.
  await fireStt(page, '33.3');
  await page.waitForTimeout(2200);
  await snapshot(page, 'after-hoenggyeong-33.3');

  // 종경 커밋 = F01 프레임. 뒤에 착과수가 남아 있어 phase는 active 유지 → confirm이 CONFIRM_MS 유지.
  await fireStt(page, '44.4');
  const confirm = page.locator('[data-hero-state="confirm"]');
  await expect(confirm).toBeVisible({ timeout: 3000 });
  await expect(page.locator('[data-testid="hero-primary"]')).toHaveText('44.4');
  await page.waitForTimeout(150); // fit rAF + fonts.ready 재계산이 끝난 뒤 잰다
  const f01 = await snapshot(page, 'F01-confirm-44.4');
  await page.screenshot({ path: 'test-results/a0-f01-confirm.png' });

  // 폰트 로드 완료 후 한 번 더 — 타이밍(단계 3 후보) 확인용.
  await page.evaluate(() => (document as any).fonts?.ready);
  await page.waitForTimeout(400);
  await snapshot(page, 'F01-confirm-44.4-after-fonts');

  expect(f01.value).toBeTruthy();
});

/** fitGroup.ts:35-41의 fits()를 **그대로 복제**해 페이지에서 재현한다(제품 코드 수정 없이,
 *  판정 함수가 각 배율에서 뭐라고 답하는지 보기 위해). tolerancePx는 파라미터로 뺐다. */
const SWEEP_FN = `(scales) => {
  const root = document.querySelector('[data-hero-state]');
  const val = document.querySelector('[data-testid="hero-primary"]')
           || document.querySelector('[data-testid="interim-value"]');
  const out = [];
  const inkOf = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect(); };
  // 마지막 문자 1개의 rect — 이 문자가 박스 오른쪽을 넘으면 화면에서 사라진다.
  const lastCharRect = (el) => {
    const node = el.firstChild; if (!node || node.nodeType !== 3) return null;
    const n = node.textContent.length; if (n < 1) return null;
    const r = document.createRange(); r.setStart(node, n - 1); r.setEnd(node, n);
    const b = r.getBoundingClientRect(); return { left: b.left, right: b.right, w: b.width };
  };
  for (const s of scales) {
    root.style.setProperty('--fit-value', String(s));
    void root.offsetHeight; // 강제 리플로우
    const ink = inkOf(val);
    const box = val.getBoundingClientRect();
    const last = lastCharRect(val);
    const widthArmFails = (tol) => val.scrollWidth > val.clientWidth + tol;
    out.push({
      scale: s,
      fontSize: getComputedStyle(val).fontSize,
      scrollWidth: val.scrollWidth, clientWidth: val.clientWidth,
      inkW: ink.width, inkRight: ink.right,
      boxW: box.width, boxRight: box.right,
      inkOverflowPx: +(ink.width - box.width).toFixed(3),
      lastChar: last,
      lastCharClipped: last ? last.right > box.right + 0.01 : null,
      rootScrollH: root.scrollHeight, rootClientH: root.clientHeight,
      // fitGroup.ts:35-41 복제
      widthArmFails_tol1: widthArmFails(1),
      widthArmFails_tol0: widthArmFails(0),
      heightArmFails: root.scrollHeight > root.clientHeight + 1,
      fits_tol1: !widthArmFails(1) && root.scrollHeight <= root.clientHeight + 1,
      fits_tol0: !widthArmFails(0) && root.scrollHeight <= root.clientHeight + 1,
      // 실제 진실: 잉크가 박스를 넘는가
      trulyOverflows: ink.width > box.width + 0.01,
    });
  }
  return out;
}`;

test('[A0-PartC] 배율 스윕 — fits()가 true인데 실제로는 잘리는 구간이 있는가', async ({ page }) => {
  await boot(page);
  await startSession(page);
  await fireStt(page, '33.3');
  await page.waitForTimeout(2200);
  await fireStt(page, '44.4');
  await expect(page.locator('[data-hero-state="confirm"]')).toBeVisible({ timeout: 3000 });
  await page.waitForTimeout(150);

  const converged = await page.evaluate(() =>
    document.querySelector('[data-hero-state]')!.getAttribute('style'));
  console.log('=== A0-PartC::converged-style ===\n' + converged);

  // fit이 확정한 2.6491 주변을 촘촘히. 0.01 간격이면 fontSize 0.64px 간격이다.
  const scales = [
    2.40, 2.45, 2.50, 2.55, 2.58, 2.60, 2.61, 2.62, 2.63, 2.64,
    2.6491, 2.65, 2.66, 2.68, 2.70, 2.75, 2.80, 3.00,
  ];
  const rows = await page.evaluate(
    ({ fn, scales }) => {
      // eslint-disable-next-line no-eval
      return (eval(fn) as (s: number[]) => unknown)(scales);
    },
    { fn: SWEEP_FN, scales },
  );
  console.log('=== A0-PartC::sweep ===\n' + JSON.stringify(rows, null, 1));
  expect(Array.isArray(rows)).toBe(true);
});

/** 수렴 상태에서 「fit이 고른 배율」과 「실제로 온전한 최대 배율」의 격차를 잰다. */
const CONVERGED_FN = `() => {
  const root = document.querySelector('[data-hero-state]');
  const val = document.querySelector('[data-testid="hero-primary"]');
  if (!val) return null;
  const s = Number(root.style.getPropertyValue('--fit-value'));
  const ink = () => { const r = document.createRange(); r.selectNodeContents(val); return r.getBoundingClientRect().width; };
  const boxW = val.getBoundingClientRect().width;
  const inkAt = (x) => { root.style.setProperty('--fit-value', String(x)); void root.offsetHeight; return ink(); };
  const inkConverged = inkAt(s);
  // 온전히 들어가는 최대 배율을 이분해서 찾는다(순수 측정 — 제품 코드와 무관).
  let lo = 0.1, hi = s;
  for (let i = 0; i < 24; i += 1) { const m = (lo + hi) / 2; if (inkAt(m) <= boxW) lo = m; else hi = m; }
  const sTrue = lo;
  const inkTrue = inkAt(sTrue);
  root.style.setProperty('--fit-value', String(s)); void root.offsetHeight; // 원복
  return {
    text: val.textContent, boxW,
    scaleChosen: s, inkAtChosen: inkConverged, overflowPx: +(inkConverged - boxW).toFixed(3),
    scaleTrueMax: +sTrue.toFixed(4), inkAtTrueMax: inkTrue,
    fontSizeChosen: 64 * s, fontSizeTrueMax: +(64 * sTrue).toFixed(3),
    scaleGap: +(s - sTrue).toFixed(4),
  };
}`;

test('[A0-PartD] 일반성 — 여러 값에서도 fit이 고른 배율이 항상 폭을 넘는가', async ({ page }) => {
  await boot(page);
  await startSession(page);

  const results: unknown[] = [];
  // 컬럼 3개(횡경/종경/착과수) × 2행 = 6회 커밋. 마지막 컬럼 커밋은 review로 잘리므로 제외한다.
  const values = ['33.3', '44.4', '106', '8.5', '222.2', '1234.5'];
  for (const v of values) {
    await fireStt(page, v);
    const confirm = page.locator('[data-hero-state="confirm"]');
    try {
      await expect(confirm).toBeVisible({ timeout: 2500 });
      await page.waitForTimeout(120);
      const r = await page.evaluate((fn) => {
        // eslint-disable-next-line no-eval
        return (eval(fn) as () => unknown)();
      }, CONVERGED_FN);
      if (r) results.push(r);
    } catch { /* review로 잘린 프레임은 건너뛴다 */ }
    await page.waitForTimeout(2200); // confirm 창이 닫히고 다음 항목 대기로 복귀
  }
  console.log('=== A0-PartD::converged ===\n' + JSON.stringify(results, null, 1));
  expect(results.length).toBeGreaterThan(0);
});

test('[A0-PartD2] 반증 압력 — 배율을 한 칸 낮추면 잘림이 사라지는가(렌더 스크린샷)', async ({ page }) => {
  await boot(page);
  await startSession(page);
  await fireStt(page, '33.3');
  await page.waitForTimeout(2200);
  await fireStt(page, '44.4');
  await expect(page.locator('[data-hero-state="confirm"]')).toBeVisible({ timeout: 3000 });
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'test-results/a0-d2-chosen.png' });
  // fit이 고른 값에서 0.0091 낮춘 2.64 — fontSize로는 0.58px 차이다.
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('[data-hero-state]')!.style.setProperty('--fit-value', '2.64');
  });
  await page.waitForTimeout(80);
  await page.screenshot({ path: 'test-results/a0-d2-minus-one-step.png' });
  expect(true).toBe(true);
});

/** A1 진단 — 라벨(inline-flex, 자식 span 2개)에서 Range가 무엇을 재는지, 폴백을 탔는지. */
const LABEL_DIAG_FN = `() => {
  const label = document.querySelector('[data-fit-group="label"]');
  const val = document.querySelector('[data-testid="hero-primary"]');
  const rectOf = (el) => { const b = el.getBoundingClientRect(); return { w:+b.width.toFixed(3), left:+b.left.toFixed(3), right:+b.right.toFixed(3) }; };
  const rangeInk = (el) => { const r = document.createRange(); r.selectNodeContents(el); const b = r.getBoundingClientRect(); return { w:+b.width.toFixed(3), left:+b.left.toFixed(3), right:+b.right.toFixed(3) }; };
  const describe = (el, name) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      name,
      measuredBy: el.dataset.fitMeasuredBy ?? '(none)',
      fontSize: cs.fontSize, display: cs.display, overflow: cs.overflow,
      box: rectOf(el),
      rangeInk: rangeInk(el),
      scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
      children: Array.from(el.children).map((c) => ({
        tag: c.tagName, text: c.textContent,
        flexShrink: getComputedStyle(c).flexShrink,
        minWidth: getComputedStyle(c).minWidth,
        box: rectOf(c), rangeInk: rangeInk(c),
      })),
    };
  };
  return { label: describe(label, 'label'), value: describe(val, 'value') };
}`;

test('[A1-DIAG] 라벨 inline-flex에서 Range가 무엇을 재는가 + 폴백 진입 여부', async ({ page }) => {
  await boot(page);
  await startSession(page);
  await fireStt(page, '33.3');
  await page.waitForTimeout(2200);
  await fireStt(page, '44.4');
  await expect(page.locator('[data-hero-state="confirm"]')).toBeVisible({ timeout: 3000 });
  await page.waitForTimeout(200);
  const d = await page.evaluate((fn) => {
    // eslint-disable-next-line no-eval
    return (eval(fn) as () => unknown)();
  }, LABEL_DIAG_FN);
  console.log('=== A1-DIAG::label ===\n' + JSON.stringify(d, null, 1));
  expect(d).toBeTruthy();
});

/** 🔴 A1 잔여 위험 검증 — **`check-pop`(320ms) 완료 후에도 라벨이 배정 안에 있는가.**
 *
 *  fit은 confirm 진입 시점에 돈다. 그 시점의 ✓ span은 애니메이션 진행 중이라 폭이 0에 가깝고,
 *  실제로 A1-DIAG에서 `width: 0`으로 측정된 프레임이 있었다. 애니메이션이 끝나 ✓가 제 크기를
 *  찾으면 라벨에 필요한 폭이 **늘어난다** — 그때 재계산이 돌지 않으면 넘친 채로 굳는다.
 *  `useFitGroup`의 재계산 트리거는 deps 변화 · ResizeObserver(부모 크기) · `fonts.ready` ·
 *  window resize뿐이고, **자식 애니메이션 완료는 그중 어디에도 없다.**
 *  → confirm 진입 직후와 애니메이션 완료 후를 각각 재서 비교한다. */
test('[A1-ANIM] check-pop 완료 후 라벨이 여전히 배정 안에 있는가', async ({ page }) => {
  await boot(page);
  await startSession(page);
  await fireStt(page, '33.3');
  await page.waitForTimeout(2200);
  await fireStt(page, '44.4');
  await expect(page.locator('[data-hero-state="confirm"]')).toBeVisible({ timeout: 3000 });

  const samples: unknown[] = [];
  // check-pop = 320ms. CONFIRM_MS = 1500ms이므로 1200ms까지는 confirm이 살아 있다.
  let elapsed = 0;
  for (const atMs of [80, 200, 420, 700, 1200]) {
    await page.waitForTimeout(atMs - elapsed);
    elapsed = atMs;
    const s = await page.evaluate((fn) => {
      // eslint-disable-next-line no-eval
      return (eval(fn) as () => unknown)();
    }, LABEL_DIAG_FN);
    samples.push({ atMs, ...(s as object) });
  }
  console.log('=== A1-ANIM::timeline ===\n' + JSON.stringify(samples, null, 1));
  expect(samples.length).toBe(5);
});

/** A1 과제 3 — 🔴 **CHIP_TYPE 회귀.** `UI-b` 함정 1이 "390×568에서 칩 여유 1.92px뿐"이라고
 *  경고한다. `fitGroups`는 공용 코어라 칩(`--fit-lo`/`--fit-hi`)도 같은 판정을 쓴다.
 *  처방으로 배율이 0.3~0.5% 줄면 그 여유가 어떻게 되는지 **숫자로** 남긴다. */
const CHIP_PROBE_FN = `() => {
  const chips = Array.from(document.querySelectorAll('[data-testid="column-chip"]'));
  const bounds = (el) => {
    const cs = getComputedStyle(el);
    const px = (v) => Number.parseFloat(v) || 0;
    const box = el.getBoundingClientRect();
    const contentLeft = box.left + px(cs.borderLeftWidth) + px(cs.paddingLeft);
    const contentRight = box.right - px(cs.borderRightWidth) - px(cs.paddingRight);
    const r = document.createRange(); r.selectNodeContents(el);
    const ink = r.getBoundingClientRect();
    return {
      text: (el.textContent || '').trim(),
      fontSize: cs.fontSize,
      measuredBy: el.dataset.fitMeasuredBy ?? '(none)',
      contentW: +(contentRight - contentLeft).toFixed(3),
      inkW: +ink.width.toFixed(3),
      overflowLeftPx: +(contentLeft - ink.left).toFixed(3),
      overflowRightPx: +(ink.right - contentRight).toFixed(3),
      slackPx: +Math.min(contentLeft - ink.left, contentRight - ink.right).toFixed(3),
      scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
    };
  };
  const root = document.querySelector('[data-hero-state]');
  const rootStyle = root ? getComputedStyle(root) : null;
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    fitLo: rootStyle ? rootStyle.getPropertyValue('--fit-lo').trim() : null,
    fitHi: rootStyle ? rootStyle.getPropertyValue('--fit-hi').trim() : null,
    chipCount: chips.length,
    chips: chips.map(bounds),
    chipInner: chips.flatMap((c) => Array.from(c.querySelectorAll('*')).map(bounds)),
  };
}`;

for (const vp of [{ width: 390, height: 568 }, { width: 402, height: 874 }] as const) {
  test(`[A1-CHIP] CHIP_TYPE 여유 실측 @ ${vp.width}x${vp.height}`, async ({ page }) => {
    // boot()는 402로 띄운다 — 탭 진입까지 끝낸 뒤 목표 뷰포트로 줄인다(작은 뷰포트에서
    // 탭 클릭이 타임아웃하는 harness 문제를 피하면서, 측정은 목표 뷰포트에서 한다).
    await boot(page);
    await startSession(page);
    await page.setViewportSize(vp);
    await page.waitForTimeout(400);
    await fireStt(page, '33.3');
    await page.waitForTimeout(2400);
    const d = await page.evaluate((fn) => {
      // eslint-disable-next-line no-eval
      return (eval(fn) as () => unknown)();
    }, CHIP_PROBE_FN);
    console.log(`=== A1-CHIP::${vp.width}x${vp.height} ===\n` + JSON.stringify(d, null, 1));
    expect(d).toBeTruthy();
  });
}

/** 🔴 A1 성능 회귀 규명 — 판정 1회 비용을 세 방식으로 잰다(앱 무관, 제품 코드 미사용).
 *  ① old: `scrollWidth > clientWidth + 1` (종전)
 *  ② new: `getComputedStyle` + `getBoundingClientRect` + `Range` (현 구현)
 *  ③ new-cached: padding/border를 그룹 탐색 1회당 한 번만 읽고 루프에서는 rect 2개만 */
test('[A1-PERF] 넘침 판정 1회 비용 — old vs new vs new-cached', async ({ page }) => {
  await page.setViewportSize(PHONE_402);
  await page.setContent(CSS_PROBE2_HTML, { waitUntil: 'domcontentloaded' });
  const r = await page.evaluate(() => {
    const bl = document.getElementById('blockLine')!;
    bl.textContent = '44.4';
    const fl = document.getElementById('flexLine')!;
    document.getElementById('nm')!.textContent = '종경';
    const members = [bl, fl];
    const range = document.createRange();
    const px = (v: string) => Number.parseFloat(v) || 0;

    const old = (el: HTMLElement) => el.scrollWidth > el.clientWidth + 1;
    const neu = (el: HTMLElement) => {
      const st = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      const cl = box.left + px(st.borderLeftWidth) + px(st.paddingLeft);
      const cr = box.right - px(st.borderRightWidth) - px(st.paddingRight);
      range.selectNodeContents(el);
      const ink = range.getBoundingClientRect();
      return (cl - ink.left) > 0.05 || (ink.right - cr) > 0.05;
    };
    // ③ 캐시 버전 — padding/border는 배율에 따라 안 변하므로 탐색 시작 시 1회만 읽는다.
    const insets = members.map((el) => {
      const st = getComputedStyle(el);
      return { l: px(st.borderLeftWidth) + px(st.paddingLeft), r: px(st.borderRightWidth) + px(st.paddingRight) };
    });
    const cached = (el: HTMLElement, i: number) => {
      const box = el.getBoundingClientRect();
      const cl = box.left + insets[i].l;
      const cr = box.right - insets[i].r;
      range.selectNodeContents(el);
      const ink = range.getBoundingClientRect();
      return (cl - ink.left) > 0.05 || (ink.right - cr) > 0.05;
    };

    const bench = (fn: (el: HTMLElement, i: number) => boolean, iters: number) => {
      // 매 반복마다 fontSize를 바꿔 레이아웃을 무효화한다(실제 이진탐색과 같은 조건).
      const t0 = performance.now();
      for (let k = 0; k < iters; k += 1) {
        const size = 60 + (k % 40);
        members.forEach((el) => { el.style.fontSize = `${size}px`; });
        members.forEach((el, i) => { fn(el, i); });
      }
      return performance.now() - t0;
    };
    const ITERS = 400;
    bench(old, 50); bench(neu, 50); bench(cached, 50); // warmup
    return {
      iters: ITERS,
      oldMs: +bench(old, ITERS).toFixed(2),
      newMs: +bench(neu, ITERS).toFixed(2),
      cachedMs: +bench(cached, ITERS).toFixed(2),
    };
  });
  console.log('=== A1-PERF ===\n' + JSON.stringify(r, null, 1));
  expect(r.iters).toBe(400);
});

test('[A0-PartB2] listening interim 실측 — 실시간 인식값 경로', async ({ page }) => {
  await boot(page);
  await startSession(page);
  for (const t of ['사십사', '사십사 점', '사십사 점 사']) {
    await page.evaluate((s) => {
      (window as unknown as { __mockSTT?: { fireInterim: (t: string) => void } })
        .__mockSTT?.fireInterim(s);
    }, t);
    await page.waitForTimeout(250);
    await snapshot(page, `interim-${t.replace(/\s/g, '_')}`);
  }
  expect(true).toBe(true);
});
