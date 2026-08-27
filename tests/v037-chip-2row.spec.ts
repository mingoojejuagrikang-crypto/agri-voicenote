/**
 * v0.37.0 FB-B(민구, Vance) — 컬럼 칩 그리드 2줄 캡 + 활성 칩 자동 스크롤 회귀.
 *
 * 민구 확정: 전체 컬럼 칩 그리드는 기본(입력) 화면에 유지하되(트레이로 옮기지 않음, §8 거부),
 *   세로 캡을 3줄→2줄로 줄여 hero가 자라날 공간을 넓힌다. 2줄을 넘는 칩은 그리드 내부 스크롤로
 *   접근하고, 활성 칩은 항목 전환 시 자동으로 가시영역에 스크롤된다("지금 어디" 상실 방지).
 *
 * 오라클(형태가 아니라 계약):
 *   1) 칩이 2줄을 넘치면 그리드 clientHeight는 2줄 캡(≈108px) 이하로 고정되고 scrollHeight가
 *      그를 초과한다(= 내부 스크롤이 실제로 생긴다). 전체 그리드가 화면을 잠식하지 않는다.
 *   2) 뒤쪽 음성 컬럼으로 진행하면 활성 칩이 그리드의 가시 스크롤 창 안으로 들어온다(자동 스크롤).
 *
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다(수동 기동 불필요, [ORCH-27])
 */
import { test, expect, type Page } from '@playwright/test';
import { BASE } from './baseUrl';

/** 🔴 T3(레이아웃 밀도, 6회차) 7회차 방어선 — **기준선을 테스트에 둔다.**
 *  종전엔 `heroLayout.ts`에 있었는데 Codex 리뷰가 반증했다: 기준값만 `46.23/36.92 → 40/30`으로
 *  낮추자 **실제 글자는 그대로인데 1/1 통과**했다. 제품 파일에 있으면 `CHIP_TYPE.name`과 함께
 *  낮추는 한 번의 diff로 크기 회귀가 승인된다. *"상수를 낮추지 마라"* 는 주석은 계약이 아니다.
 *  👉 값 변경이 **이 테스트의 diff로 드러나야** 한다.
 *
 *  값은 `36a01b1`(UI-a 완료) 실측이다. 두 뷰포트를 다 두는 이유는 `min(11.5vw, 6.5vh)`의
 *  **이기는 항이 서로 다르기** 때문이다(402×874는 vw, 390×568은 vh).
 *  🔴 red일 때 이 숫자를 낮추지 마라 — 그게 T6 6회차 재발의 형태다. 공간을 회수해서 되돌린다.
 *  원 제보는 `fb-28-1`("칩 항목명이 너무 작다")이고 v0.40.0 `CHIP_TYPE`이 겨우 닫았다. */
/** 🔴 §C1(2026-08-03) 갱신 — 종전 `{ standard: 46.23, short: 36.92 }`(36a01b1 실측, 칩존 20%).
 *  **허용치(`CHIP_LABEL_TOLERANCE_PX`)는 건드리지 않았다.** 가드를 무르게 하는 게 아니라
 *  기준점 자체가 이동한 것이라, A0-probe §7-4의 3-b 해석 지침대로 **새 실측으로 값만** 옮긴다.
 *
 *  왜 「공간을 회수해서 되돌린다」(아래 §방어① 주석)로 못 푸는가:
 *   ① **회수할 빈 공간이 없다.** `lineHeight: normal`의 27% 회수는 v0.43.0 UI-b가 이미 했다
 *      (`ColumnChip.tsx:126` `lineHeight: 1`). 남은 여백은 padding 1cqh + border뿐이다.
 *   ② **물리적으로 불가능하다.** 칩존 16%면 390×568의 칩 content가 56.78px인데 36.92 × 2행 =
 *      73.84px다. 20%(content 73.44px)에서도 **이미 0.4px 초과**였다 — `ui-standard`가 경고한
 *      "T3 잘림 재발 하한"은 §C1 이전에 이미 발동해 있었고, 이 갱신이 그걸 정상화한다.
 *
 *  🔑 축소는 F20(칩존 20 → 16%, 민구 확정 §4-a 12건 중 4번)의 **직접 대가**이고, plan §C1
 *  「동반 필수」가 *"CHIP_TYPE의 하한을 낮추거나 2행 배치를 조정. 이걸 안 하면 C1은 잘림을
 *  만든다"* 로 이미 지시한 경로다. fb-28-1("항목명이 너무 작다")을 뒤집은 게 아니라
 *  **새 확정이 이긴 것**이다(plan §4-b 패턴).
 *  🔑 **2차 갱신(같은 날) — 값이 올라갔다.** `CHIP_TYPE`이 `min(높이항, 폭항)`에서
 *  **두 축의 합**으로 바뀌면서(민구 지적, `heroLayout.ts` CHIP_TYPE 주석) 폭이 다시 크기에
 *  기여하게 됐다. 1차 갱신값 `{ 37.38, 20.74 }` → 실측 `{ 42.85, 24.55 }`.
 *  **올리는 방향이라 가드가 조여진다** — 낮추기와 성격이 다르다.
 *  ⚠️ 390의 24.55px는 여전히 민구 실기기 확인 대상이다(20% 시절 36.92px 대비 −33%). */
const CHIP_LABEL_BASELINE_PX = { standard: 42.85, short: 24.55 } as const;

/** 허용 오차 — **절대 px**다. 종전 비율 `0.95`는 402에서 2.31px 축소를 이미 허용했다(리뷰 🟡-2).
 *  폰트 로딩·서브픽셀 라운딩 변동만 흡수하는 크기여야 한다. */
const CHIP_LABEL_TOLERANCE_PX = 0.6;

test.setTimeout(90_000);

const PHONE_402 = { width: 402, height: 874 };
const PHONE_375 = { width: 375, height: 667 };
const PHONE_390_SHORT = { width: 390, height: 568 };

// 1 auto(seq) + 12 voice float — 402px 폭에서 확실히 2줄을 넘긴다.
const VOICE_COLS = Array.from({ length: 12 }, (_, i) => ({
  id: `v${i}`,
  name: `측정항목${String(i + 1).padStart(2, '0')}`,
  type: 'float',
  input: 'voice',
  ttsAnnounce: true,
  auto: { kind: 'fixed', value: '' },
  decimals: 1,
}));

const SETTINGS = {
  state: {
    // 🔴 왕복 OFF — 켜져 있으면 칩 클릭이 Playwright `stable` 체크에서 데드락한다.
    //    기전·실측은 tests/fixtures/activeZones.ts의 chipSweepSeconds 주석이 정본.
    chipSweepSeconds: 0,
    googleConnected: false, userEmail: null, sheet: null,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_TEST_1/edit', sheetTab: 'Sheet1',
    columnsSheetId: 'SHEET_TEST_1', columnsSheetTab: 'Sheet1',
    availableSheets: [], manualMode: false,
    columns: [
      { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 } },
      ...VOICE_COLS,
    ],
    tableGenerated: true, totalRows: 2,
    ttsRate: 1.05, sessionLabelColId: null, sessionAutoLabel: '칩2줄', noisyMode: false, preferredVoiceName: '',
  },
  version: 13,
};

const MOCK_INIT_SCRIPT = `
(function() {
  var mockSynth = {
    speak: function(u) { try { if (u.onstart) u.onstart(new Event('start')); } catch(e){}
      try { if (u.onend) u.onend(new Event('end')); } catch(e){} },
    cancel: function(){}, pause: function(){}, resume: function(){},
    getVoices: function(){ return [{ name:'Mock Korean', lang:'ko-KR', default:true, localService:true, voiceURI:'mock' }]; },
    speaking:false, pending:false, paused:false, onvoiceschanged:null,
    addEventListener:function(){}, removeEventListener:function(){}, dispatchEvent:function(){ return true; },
  };
  try { Object.defineProperty(window,'speechSynthesis',{ get:function(){ return mockSynth; }, configurable:true, enumerable:true }); } catch(e){}
  function MockSTT(){ this._ls={}; this.continuous=true; this.interimResults=true; this.lang='ko-KR'; this.maxAlternatives=3; window.__mockSTT=this; }
  MockSTT.prototype.addEventListener=function(t,cb){ if(!this._ls[t])this._ls[t]=[]; this._ls[t].push(cb); };
  MockSTT.prototype.removeEventListener=function(t,cb){ if(this._ls[t])this._ls[t]=this._ls[t].filter(function(f){return f!==cb;}); };
  MockSTT.prototype.start=function(){ var s=this; setTimeout(function(){ (s._ls['start']||[]).forEach(function(cb){cb(new Event('start'));}); },5); };
  MockSTT.prototype.stop=function(){};
  MockSTT.prototype.abort=function(){ var s=this; setTimeout(function(){ (s._ls['end']||[]).forEach(function(cb){cb(new Event('end'));}); },5); };
  MockSTT.prototype.fireResult=function(transcript,confidence){ if(confidence===undefined)confidence=0.95;
    var ev={ resultIndex:0, results:{ length:1, 0:{ isFinal:true, length:1, 0:{ transcript:transcript, confidence:confidence } } } };
    (this._ls['result']||[]).forEach(function(cb){cb(ev);}); };
  try { Object.defineProperty(window,'SpeechRecognition',{ value:MockSTT, writable:true, configurable:true, enumerable:true }); } catch(e){}
  try { Object.defineProperty(window,'webkitSpeechRecognition',{ value:MockSTT, writable:true, configurable:true, enumerable:true }); } catch(e){}
})();
`;

async function boot(page: Page, opts?: { viewport?: { width: number; height: number }; sab?: number }) {
  await page.setViewportSize(opts?.viewport ?? PHONE_402);
  await page.addInitScript(MOCK_INIT_SCRIPT);
  // FB-I — 홈인디케이터(--sab) 시뮬레이션: 나비 실측 높이(--nav-h)에 safe-area가 포함되는지,
  //   시트가 그 위에 정확히 올라앉는지 검증하기 위해 fixtures/safeArea.ts와 동일 방식으로 주입.
  if (opts?.sab != null) {
    const sab = opts.sab;
    await page.addInitScript((v) => {
      document.documentElement.style.setProperty('--sab', `${v}px`);
    }, sab);
  }
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem('agri-voicenote-settings-v3', JSON.stringify(s));
  }, SETTINGS);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(200);
  await page.locator('text=음성 입력 시작').first().click();
  await page.waitForTimeout(800);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
}

async function fireStt(page: Page, transcript: string) {
  await page.evaluate((t) => {
    (window as unknown as { __mockSTT?: { fireResult: (t: string, c: number) => void } })
      .__mockSTT?.fireResult(t, 0.95);
  }, transcript);
}

test('FB-B — 칩 그리드가 한 행 + 초과분 가로 스크롤(전체 그리드가 화면 잠식 안 함)', async ({ page }) => {
  await boot(page);
  const grid = page.locator('[data-testid="voice-chip-grid"]');
  await expect(grid).toBeVisible();

  const { clientH, scrollH, clientW, scrollW } = await grid.evaluate((el) => ({
    clientH: (el as HTMLElement).clientHeight,
    scrollH: (el as HTMLElement).scrollHeight,
    clientW: (el as HTMLElement).clientWidth,
    scrollW: (el as HTMLElement).scrollWidth,
  }));
  console.log(`chip grid clientH=${clientH} scrollH=${scrollH} clientW=${clientW} scrollW=${scrollW}`);

  // 🔴 v0.40.0 민구 확정 — 2줄 캡이 **한 행 + 가로 스크롤**로 바뀌었다.
  //   근거: "세로 스크롤 영역이 너무 작기에"(실기기에서 보고 판단). 원 요청 fb-27-2는 "가로가 아닌
  //   세로"였으나 화면을 보고 뒤집혔다 — 원문만 보고 되돌리지 마라.
  //   계약의 목적(칩존이 hero 공간을 잠식하지 않는다)은 그대로이므로 그 단언은 유지한다.
  const visibleRows = await grid.evaluate((el) => {
    const g = el as HTMLElement;
    const tops: number[] = [];
    for (const c of Array.from(g.querySelectorAll('[data-testid="column-chip"]')) as HTMLElement[]) {
      if (!tops.some((t) => Math.abs(t - c.offsetTop) <= 8)) tops.push(c.offsetTop);
    }
    return tops.filter((t) => t < g.clientHeight - 4).length;
  });
  expect(visibleRows, '칩 그리드는 한 행').toBe(1);
  // 13개 칩(1 auto + 12 voice)은 402px 폭을 넘겨 **가로** 스크롤이 생긴다.
  expect(scrollW, '한 행 초과 → 가로 스크롤 존재').toBeGreaterThan(clientW + 20);
  expect(scrollH - clientH, '세로 스크롤은 생기지 않는다').toBeLessThanOrEqual(1);
  // 칩존이 화면을 잠식하지 않는다(hero가 자라날 공간 보존 — FB-B의 본래 목적).
  expect(clientH, '칩존이 화면 높이의 30%를 넘지 않는다').toBeLessThanOrEqual(874 * 0.3);
});

/** 첫 칩에서 항목명이 칩 박스 밖으로 잘려나갔는지 잰다.
 *  칩이 `overflow:hidden` + grid `placeItems:center`라, 내용이 배정 높이를 넘으면 위아래로
 *  동시에 삐져나가며 **잘린다**. fontSize는 그대로이므로 크기 단언으로는 절대 안 잡힌다. */
async function chipClip(page: Page) {
  return page.locator('[data-testid="column-chip"]').first().evaluate((el) => {
    const chipEl = el as HTMLElement;
    const labelEl = chipEl.querySelector('[data-testid="column-chip-label"]') as HTMLElement;
    const cr = chipEl.getBoundingClientRect();
    const lr = labelEl.getBoundingClientRect();
    const cs = getComputedStyle(chipEl);
    const kids = Array.from(chipEl.children).map((k) => {
      const kr = (k as HTMLElement).getBoundingClientRect();
      const ks = getComputedStyle(k as HTMLElement);
      return `${(k as HTMLElement).dataset.testid ?? k.tagName}:h=${kr.height.toFixed(1)}/fs=${parseFloat(ks.fontSize).toFixed(1)}/lh=${ks.lineHeight}`;
    });
    // 값 span(라벨 다음 자식)도 같이 잰다 — 칩은 `placeItems:center`라 넘치면 **위아래 동시에**
    // 잘리므로, 라벨만 보면 아래쪽에서 값이 잘려나가는 것을 통째로 놓친다.
    const valueEl = Array.from(chipEl.children).find((k) => k !== labelEl) as HTMLElement | undefined;
    const vr = valueEl?.getBoundingClientRect();
    return {
      labelTopInside: lr.top - cr.top,        // 음수면 칩 위로 삐져나감
      labelBottomInside: cr.bottom - lr.bottom, // 음수면 칩 아래로 삐져나감
      valueTopInside: vr ? vr.top - cr.top : Number.POSITIVE_INFINITY,
      valueBottomInside: vr ? cr.bottom - vr.bottom : Number.POSITIVE_INFINITY,
      // 🔴 §C1(2026-08-03) — **가로 축이 없었다.** 이 함수가 릴리스 게이트의 정본 잘림
      //    판정인데 top/bottom 4항만 봤다. 실제 파손 기제는 가로다:
      //    `maxWidth:'96cqw'` + `whiteSpace:'nowrap'` + `overflow:'hidden'`(ellipsis 없음).
      //    감사가 320×1200에서 값 **156px 소실**을 실측했는데 이 게이트는 green이었다.
      labelLeftInside: lr.left - cr.left,
      labelRightInside: cr.right - lr.right,
      valueLeftInside: vr ? vr.left - cr.left : Number.POSITIVE_INFINITY,
      valueRightInside: vr ? cr.right - vr.right : Number.POSITIVE_INFINITY,
      contentOverflow: chipEl.scrollHeight - chipEl.clientHeight,
      chipHeight: cr.height,
      padding: cs.paddingTop,
      kids: kids.join(' | '),
    };
  });
}

/** 🔑 오라클은 "칩 내용이 안 잘린다"이지 `scrollHeight === clientHeight`가 아니다.
 *  칩은 `overflow:hidden`으로 **의도적으로** 자르므로 넘침 자체는 설계다. 문제는 **글자가**
 *  잘리는 것이고, `placeItems:center` 때문에 넘치면 위아래 동시에 잘린다.
 *  ⚠️ 그래서 라벨과 값을 **둘 다** 봐야 한다 — 한쪽만 보면 반대편 잘림을 놓친다. */
function expectChipLabelNotClipped(
  m: {
    labelTopInside: number; labelBottomInside: number;
    valueTopInside: number; valueBottomInside: number;
    labelLeftInside: number; labelRightInside: number;
    valueLeftInside: number; valueRightInside: number;
  },
  vp: string,
) {
  expect(m.labelTopInside, `${vp} 항목명이 칩 위로 잘림`).toBeGreaterThanOrEqual(-0.5);
  expect(m.labelBottomInside, `${vp} 항목명이 칩 아래로 잘림`).toBeGreaterThanOrEqual(-0.5);
  expect(m.valueTopInside, `${vp} 값이 칩 위로 잘림`).toBeGreaterThanOrEqual(-0.5);
  expect(m.valueBottomInside, `${vp} 값이 칩 아래로 잘림`).toBeGreaterThanOrEqual(-0.5);
  // 🔴 §C1(2026-08-03) 신설 — 가로. 위 주석 참고(이 게이트가 156px 소실을 놓쳤다).
  expect(m.labelLeftInside, `${vp} 항목명이 칩 좌측으로 잘림`).toBeGreaterThanOrEqual(-0.5);
  expect(m.labelRightInside, `${vp} 항목명이 칩 우측으로 잘림`).toBeGreaterThanOrEqual(-0.5);
  expect(m.valueLeftInside, `${vp} 값이 칩 좌측으로 잘림`).toBeGreaterThanOrEqual(-0.5);
  expect(m.valueRightInside, `${vp} 값이 칩 우측으로 잘림`).toBeGreaterThanOrEqual(-0.5);
}

test('[CHIP-TYPO-1] rounded rect + 커진 항목명, 390×568에서도 세로 넘침 없음', async ({ page }) => {
  await boot(page);
  const chip = page.locator('[data-testid="column-chip"]').first();
  const label = chip.locator('[data-testid="column-chip-label"]');
  const metrics = await chip.evaluate((el) => {
    const style = getComputedStyle(el);
    const labelEl = el.querySelector('[data-testid="column-chip-label"]') as HTMLElement;
    return {
      height: el.getBoundingClientRect().height,
      radius: parseFloat(style.borderTopLeftRadius),
      labelSize: parseFloat(getComputedStyle(labelEl).fontSize),
    };
  });
  console.log(`[CHIP-TYPO-1] 402x874 labelSize=${metrics.labelSize.toFixed(2)} chipH=${metrics.height.toFixed(2)}`);
  expect(metrics.labelSize, 'v0.40.0 항목명 상한 22px보다 커야 한다').toBeGreaterThan(22);
  // 🔴 T3 7회차 방어 ①/② — **선언된 크기**를 지킨다.
  //   ⚠️ 이 단언이 잡는 것과 못 잡는 것을 정확히 적는다(UI-a 리뷰 🔴-3: 적힌 근거가 사실이어야 한다):
  //     잡는다   — 누군가 `CHIP_TYPE.name` 공식이나 그 상한/비례항을 낮추는 것
  //     못 잡는다 — 칩존 배분 축소. 라벨 크기는 `min(11.5vw, 6.5vh)`와 `--fit-lo`가 정하는데
  //                **`--fit-lo`는 칩 트리에 설정되지 않는다**(항상 1). 배분을 줄여도 이 값은 안 변한다.
  //   👉 배분 축소는 크기가 아니라 **잘림**으로 나타난다 → 아래 방어 ②가 그걸 잡는다.
  //   기준값 SSOT는 **이 파일 상단의 상수**다(제품 파일에 두면 한 diff로 우회된다 — 리뷰 🟡-2).
  //   **red일 때 상수를 낮추지 마라** — 공간을 회수해서 되돌린다
  //   (HANDOFF UI-a 함정 2). 원 제보는 `fb-28-1`("칩 항목명이 너무 작다")이다.
  expect(
    metrics.labelSize,
    `402×874 항목명이 36a01b1 실측 ${CHIP_LABEL_BASELINE_PX.standard}px에서 깎이면 안 된다`,
  ).toBeGreaterThanOrEqual(CHIP_LABEL_BASELINE_PX.standard - CHIP_LABEL_TOLERANCE_PX);
  expect(metrics.radius, '캡슐 반지름(height / 2)이 아니어야 한다').toBeLessThan(metrics.height / 2 - 1);
  await expect(label).toBeVisible();

  // 🔴 T3 7회차 방어 ②/② — **실제로 보이는가.** 여기가 배분 축소를 잡는 진짜 방어선이다.
  //   칩은 `overflow:hidden` + `placeItems:center`라, 칩존이 줄면 fontSize는 그대로인 채
  //   내용이 위아래로 잘려나간다. UI-a에서 375px 항목명이 **소멸**한 것과 같은 형태다
  //   (`KNOWN-ISSUES` · HANDOFF 함정 1). 크기만 재는 단언은 이걸 통과시킨다.
  const clip402 = await chipClip(page);
  console.log(`[CHIP-TYPO-1] 402x874 clip top=${clip402.labelTopInside.toFixed(2)} bottom=${clip402.labelBottomInside.toFixed(2)} overflow=${clip402.contentOverflow.toFixed(2)} chipH=${clip402.chipHeight.toFixed(1)} pad=${clip402.padding} kids=[${clip402.kids}]`);
  expectChipLabelNotClipped(clip402, '402×874');

  await page.setViewportSize(PHONE_390_SHORT);
  await page.waitForTimeout(250);
  const grid = page.locator('[data-testid="voice-chip-grid"]');
  const narrow = await grid.evaluate((el) => ({
    clientHeight: (el as HTMLElement).clientHeight,
    scrollHeight: (el as HTMLElement).scrollHeight,
    pageClientWidth: document.documentElement.clientWidth,
    pageScrollWidth: document.documentElement.scrollWidth,
  }));
  const narrowLabel = await chip.evaluate((el) => {
    const labelEl = el.querySelector('[data-testid="column-chip-label"]') as HTMLElement;
    return parseFloat(getComputedStyle(labelEl).fontSize);
  });
  console.log(`[CHIP-TYPO-1] 390x568 labelSize=${narrowLabel.toFixed(2)} chipZoneH=${narrow.clientHeight}`);
  // 🔴 좁고 짧은 기기의 방어선. 여기서는 `min(11.5vw, 6.5vh)`의 **vh 항이 이긴다**(402×874는 vw).
  //   즉 세로가 짧은 축이라 칩존 높이 축소의 영향을 먼저 받는다. 402 하나만 지키면 못 잡는다.
  expect(
    narrowLabel,
    `390×568 항목명이 36a01b1 실측 ${CHIP_LABEL_BASELINE_PX.short}px에서 깎이면 안 된다`,
  ).toBeGreaterThanOrEqual(CHIP_LABEL_BASELINE_PX.short - CHIP_LABEL_TOLERANCE_PX);
  const clip390 = await chipClip(page);
  console.log(`[CHIP-TYPO-1] 390x568 clip top=${clip390.labelTopInside.toFixed(2)} bottom=${clip390.labelBottomInside.toFixed(2)} overflow=${clip390.contentOverflow.toFixed(2)} chipH=${clip390.chipHeight.toFixed(1)} valTop=${clip390.valueTopInside.toFixed(2)} valBot=${clip390.valueBottomInside.toFixed(2)}`);
  expectChipLabelNotClipped(clip390, '390×568');
  expect(narrow.scrollHeight - narrow.clientHeight, '390×568 칩존 세로 넘침').toBeLessThanOrEqual(1);

  // 🔴 375×667 — plan §7:824가 실기기 점검 대상으로 지목한 좁은 기기다. 점검이 릴리스 **뒤**
  //   1회뿐이므로(민구 확정) 여기서 기계가 먼저 본다.
  await page.setViewportSize(PHONE_375);
  await page.waitForTimeout(250);
  const label375 = await chip.evaluate((el) => {
    const labelEl = el.querySelector('[data-testid="column-chip-label"]') as HTMLElement;
    return parseFloat(getComputedStyle(labelEl).fontSize);
  });
  const clip375 = await chipClip(page);
  console.log(`[CHIP-TYPO-1] 375x667 labelSize=${label375.toFixed(2)} clip top=${clip375.labelTopInside.toFixed(2)} bottom=${clip375.labelBottomInside.toFixed(2)} overflow=${clip375.contentOverflow.toFixed(2)} chipH=${clip375.chipHeight.toFixed(1)}`);
  expectChipLabelNotClipped(clip375, '375×667');
  expect(narrow.pageScrollWidth - narrow.pageClientWidth, '390×568 페이지 가로 넘침').toBeLessThanOrEqual(1);
});

// FB-I(민구, "네비는 항상 보여야 함") — 수동 입력 시트가 **열려 있는 동안** 하단 나비가
//   ① 시트에 덮이지 않고(geometry: 나비 top ≥ 시트 bottom) ② 보이고 ③ 탭 가능해야 한다.
//   402×874(sab 0) + 375×667(sab 34)에서 검증. z-index 단언은 하지 않는다 — bottomInset로 나비/
//   시트가 공간상 안 겹치므로 z 순서는 무의미하고, z만 보면 잘림을 놓친다(geometry가 진짜 오라클).
for (const vp of [
  { name: '402×874(sab 0)', viewport: PHONE_402, sab: undefined },
  { name: '375×667(sab 34)', viewport: PHONE_375, sab: 34 },
]) {
  test(`FB-I — 수동 입력 시트 열림 중 하단 나비 상시 노출·탭 가능(시트가 나비를 덮지 않음) @ ${vp.name}`, async ({ page }) => {
    await boot(page, { viewport: vp.viewport, sab: vp.sab });

    // 시트가 글로우 위에 뜨는 기존 계약도 유지(입력 UI 오염 차단).
    const glow = page.locator('[data-testid="edge-glow"]');
    await expect(glow).toBeVisible();
    const glowZ = await glow.evaluate((el) => parseInt(getComputedStyle(el).zIndex || '0', 10));

    // 활성 음성 칩 탭 → 수동 입력 시트 open.
    await page.locator('[data-testid="column-chip"][data-active="true"]').click();
    const sheet = page.locator('[data-testid="manual-value-sheet"]');
    await expect(sheet).toBeVisible({ timeout: 3000 });
    const sheetZ = await sheet.evaluate((el) => parseInt(getComputedStyle(el.parentElement as HTMLElement).zIndex || '0', 10));
    expect(sheetZ, '시트가 글로우 위').toBeGreaterThan(glowZ);
    // 시트가 실제 조작 가능(글로우가 위를 막지 않음).
    await page.locator('[data-testid="manual-key-1"]').click({ trial: true });

    // ── FB-I 핵심 오라클: 시트가 열린 상태에서 나비가 살아 있다 ──
    const sheetBox = await sheet.boundingBox();
    expect(sheetBox, '시트 boundingBox').not.toBeNull();
    for (const id of ['settings', 'voice', 'data']) {
      const tab = page.locator(`[data-testid="tab-${id}"]`);
      await expect(tab, `tab-${id} 보임`).toBeVisible();
      const tabBox = await tab.boundingBox();
      expect(tabBox, `tab-${id} boundingBox`).not.toBeNull();
      // ① 시트가 나비를 덮지 않는다: 나비 top ≥ 시트 bottom(0.5px 서브픽셀 슬랙).
      expect(tabBox!.y, `tab-${id} top(${tabBox!.y})이 시트 bottom(${sheetBox!.y + sheetBox!.height}) 아래`).
        toBeGreaterThanOrEqual(sheetBox!.y + sheetBox!.height - 0.5);
      // ②③ 시트 열림 중에도 실제 탭 가능(히트테스트 — 시트 오버레이/dim이 가리지 않음).
      await tab.click({ trial: true });
    }
  });
}

// v0.37.0 리뷰#2(Critical, 민구: 탭 탭 = 시트 닫고 재개) — FB-I가 나비를 상시 탭 가능하게 만든 뒤의
//   데이터 무결성 구멍: 수동 입력 시트가 열려(STT hard-suspend) 있는데 탭을 누르면 onClose가 발화하지
//   않아 STT가 **정지된 채** 화면만 전환돼 이후 발화가 유실됐다. 수정: 탭 탭이 시트를 먼저 닫고(→resume)
//   전환한다. 오라클(계약): ① 탭 후 시트가 닫힌다 ② 음성 탭 복귀 후 즉시 STT 결과가 커밋된다(유실 없음).
//   종전 FB-I 테스트의 trial:true 히트테스트(line 159)를 **실제 탭 전환**으로 승격한다.
async function activeChipName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const chip = document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
    return chip?.dataset.colName ?? '';
  });
}

test('리뷰#2 — 수동 시트 열림 중 탭 탭 → 시트 닫힘 + STT 재개(복귀 후 즉시 커밋, 발화 유실 없음)', async ({ page }) => {
  await boot(page);
  // 활성 칩(측정항목01)에서 수동 입력 시트 open → STT hard-suspend.
  await page.locator('[data-testid="column-chip"][data-active="true"]').click();
  const sheet = page.locator('[data-testid="manual-value-sheet"]');
  await expect(sheet).toBeVisible({ timeout: 3000 });
  expect(await activeChipName(page), '커밋 전 활성 칩').toContain('측정항목01');

  // 시트가 열린 채 **실제** 데이터 탭으로 전환(trial 아님).
  await page.locator('[data-testid="tab-data"]').click();
  await page.waitForTimeout(300);
  // ① 시트가 닫혔다(숨겨진 채 남지 않음 — 복귀 시 유령 시트 방지 + resume 배선 발화).
  await expect(sheet).toHaveCount(0, { timeout: 3000 });

  // 음성 탭 복귀.
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(300);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });

  // ② STT 재개 증명: 즉시 음성 결과가 커밋돼 활성 칩이 다음 항목으로 전진한다(suspend된 채였다면 유실).
  await fireStt(page, '42.0');
  await expect
    .poll(async () => activeChipName(page), 'STT 재개 → 커밋 후 활성 칩 전진(측정항목02)')
    .toContain('측정항목02');
});

test('FB-B — 뒤쪽 음성 컬럼으로 진행하면 활성 칩이 가시영역으로 자동 스크롤', async ({ page }) => {
  await boot(page);
  const grid = page.locator('[data-testid="voice-chip-grid"]');
  await expect(grid).toBeVisible();

  // 여러 음성 컬럼을 커밋해 활성 칩을 그리드 아래쪽(스크롤 필요 위치)으로 이동시킨다.
  for (let i = 0; i < 8; i++) {
    await fireStt(page, `${10 + i}.${i}`);
    await page.waitForTimeout(150);
  }

  // 활성 칩이 그리드 가시 창(clip 영역) 안에 들어와 있어야(자동 스크롤). 오라클 동일 — 즉시 스크롤이
  //   렌더 후 정착할 시간을 폴링으로 준다(기대값 완화 아님: "칩이 보인다"는 계약 그대로).
  await expect
    .poll(async () => grid.evaluate((g) => {
      const gridEl = g as HTMLElement;
      const active = gridEl.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
      if (!active) return false;
      const gr = gridEl.getBoundingClientRect();
      const ar = active.getBoundingClientRect();
      return ar.top >= gr.top - 4 && ar.bottom <= gr.bottom + 4;
    }), '활성 칩이 그리드 가시영역 안에 있어야(자동 스크롤)')
    .toBe(true);
});
