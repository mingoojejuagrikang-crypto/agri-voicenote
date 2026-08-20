/**
 * 인라인 편집 칩의 **폭 계약** — §C1 6축 감사 미처리 ② (08-03 진단 · 08-07 착수)
 *
 * ## 왜 이 파일이 새로 필요했나
 * 🔴 **편집 칩의 기하를 재는 스펙이 저장소에 0건이었다.** `v037-chip-2row`가 칩 잘림의
 * 정본 게이트지만 **비편집 칩만** 잰다. 그래서 아래 결함이 08-03에 진단되고도
 * 나흘간 아무 게이트에도 걸리지 않았다.
 *
 * ## 재는 것 — 「항목명이 칩 밖으로 잘리지 않는다」
 * `ColumnChip`은 `overflow:hidden` + `whiteSpace:nowrap`이고 ellipsis가 없다. 폭이 모자라면
 * 항목명이 **소리 없이 잘려나간다**. 그래서 판정축은 크기가 아니라 **잉크 경계**다 —
 * 라벨 rect가 칩 rect 안에 있는가. `[TEAMOPS-86]`(`toBeVisible`은 가림을 안 본다)과
 * `v037-chip-2row`의 `expectChipLabelNotClipped`가 세운 규율을 그대로 따른다.
 *
 * ## 🔴 이 오라클이 무엇을 **안** 재는지 (`[TEAMOPS-60]`)
 * - 편집 중 **입력 필드**의 사용성(폭이 충분한가)은 안 잰다 — 잘림만 본다.
 * - 비편집 칩은 `v037-chip-2row`가 잰다. 여기서 중복하지 않는다.
 * - 세로 축도 `v037`이 잰다. 이 결함의 기제는 **가로**다.
 *
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다([ORCH-27]).
 */
import { test, expect, type Page } from '@playwright/test';
import { BASE } from './baseUrl';

test.setTimeout(90_000);

const PHONE_402 = { width: 402, height: 874 };
const PHONE_375 = { width: 375, height: 667 };

/** 🔴 편집 대상은 **`input:'touch'`** 여야 한다 — `ActiveState.onActivate`가
 *  `input === 'voice'`면 `ManualValueSheet`(별개 UI)를 열고, 그 경우 인라인 편집에
 *  도달하지 못한다. `date && input!=='voice'`도 막힌다.
 *
 *  🔑 **길이를 이 값으로 고른 이유가 오라클의 정확성이다.** 처음 쓴 11글자
 *  (`수확기예상착과수측정값`)는 402에서 라벨이 **406.5px**라 칩 상한 `maxWidth:96cqw`(≈386px)를
 *  **비편집 상태에서도** 넘는다. 그러면 이 파일이 §C1-②(편집 칩 shrink)와 §C1-③(긴 항목명이
 *  칩을 넘는다)을 **섞어서** 재게 되고, ③을 고치기 전에는 영원히 red다.
 *  👉 5글자는 비편집에서 상한 안에 들어간다 — 그래서 red가 뜨면 **원인이 편집 경로 하나로 좁혀진다.**
 *  아래 「대조군」 테스트가 그 전제를 매 실행 검증한다. */
const EDIT_COL_NAME = '착과수측정';

/** 좁은 폭에서 결손을 만들려면 **한 줄에 다른 칩이 함께** 있어야 한다. 편집 칩이 유일한
 *  flex item이면 결손 자체가 생기지 않아 결함이 재현되지 않는다(= 오라클이 무력해진다). */
const VOICE_COLS = Array.from({ length: 6 }, (_, i) => ({
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
    //    기전·실측은 tests/fixtures/activeZones.ts의 chipSweepSeconds 주석이 정본. `[TEAMOPS-81]`
    chipSweepSeconds: 0,
    googleConnected: false, userEmail: null, sheet: null,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_EDITCHIP_1/edit', sheetTab: 'Sheet1',
    columnsSheetId: 'SHEET_EDITCHIP_1', columnsSheetTab: 'Sheet1',
    availableSheets: [], manualMode: false,
    columns: [
      { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 } },
      { id: 'edit1', name: EDIT_COL_NAME, type: 'text', input: 'touch', ttsAnnounce: false, auto: { kind: 'fixed', value: '' } },
      ...VOICE_COLS,
    ],
    tableGenerated: true, totalRows: 2,
    ttsRate: 1.05, sessionLabelColId: null, sessionAutoLabel: '편집칩폭', noisyMode: false, preferredVoiceName: '',
  },
  version: 12,
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

async function boot(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.addInitScript(MOCK_INIT_SCRIPT);
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

/** 편집 칩의 잉크 경계. 양수면 칩 안, 음수면 잘려나간 px다. */
async function editChipClip(page: Page) {
  return page.locator(`[data-testid="column-chip"][data-col-name="${EDIT_COL_NAME}"]`).evaluate((el) => {
    const chipEl = el as HTMLElement;
    const labelEl = chipEl.querySelector('[data-testid="column-chip-label"]') as HTMLElement;
    const cr = chipEl.getBoundingClientRect();
    const lr = labelEl.getBoundingClientRect();
    return {
      labelLeftInside: lr.left - cr.left,
      labelRightInside: cr.right - lr.right,
      labelTopInside: lr.top - cr.top,
      labelBottomInside: cr.bottom - lr.bottom,
      chipWidth: cr.width,
      labelWidth: lr.width,
      // 🔑 `scrollWidth`는 라벨이 **자기 박스보다** 넓은지를 본다. 위 rect 축과 층이 다르다 —
      //    rect는 「칩 밖으로 나갔나」, 이건 「라벨 박스 안에서 넘쳤나」.
      labelOverflowX: labelEl.scrollWidth - labelEl.clientWidth,
      flexBasis: getComputedStyle(chipEl).flexBasis,
      flexShrink: getComputedStyle(chipEl).flexShrink,
    };
  });
}

async function enterEdit(page: Page) {
  const chip = page.locator(`[data-testid="column-chip"][data-col-name="${EDIT_COL_NAME}"]`);
  await expect(chip).toBeVisible({ timeout: 5000 });
  await chip.scrollIntoViewIfNeeded();
  await chip.click();
  // 편집 진입은 input 등장으로 확인한다 — 클릭이 먹었는지 상태로 묻는다(시간 대기 금지).
  await expect(chip.locator('input')).toBeVisible({ timeout: 3000 });
  await page.waitForTimeout(150); // flex 재배치 + 폰트 정착
}

for (const [name, viewport] of [['402×874', PHONE_402], ['375×667', PHONE_375]] as const) {
  test(`§C1-② 편집 칩 — 항목명이 칩 밖으로 잘리지 않는다 @ ${name}`, async ({ page }) => {
    await boot(page, viewport);
    await enterEdit(page);

    const m = await editChipClip(page);
    console.log(
      `[edit-chip] ${name}: chipW=${m.chipWidth.toFixed(1)} labelW=${m.labelWidth.toFixed(1)} `
      + `left=${m.labelLeftInside.toFixed(1)} right=${m.labelRightInside.toFixed(1)} `
      + `ovX=${m.labelOverflowX} basis=${m.flexBasis} shrink=${m.flexShrink}`,
    );

    // 🔴 판정축 — 가로. 이 결함의 기제가 여기다.
    expect(m.labelLeftInside, `${name} 편집 칩 항목명이 좌측으로 잘림`).toBeGreaterThanOrEqual(-0.5);
    expect(m.labelRightInside, `${name} 편집 칩 항목명이 우측으로 잘림`).toBeGreaterThanOrEqual(-0.5);
    // 라벨 자신의 넘침 — `whiteSpace:nowrap`이라 폭이 모자라면 여기가 먼저 양수가 된다.
    expect(m.labelOverflowX, `${name} 편집 칩 항목명이 라벨 박스 안에서 넘침`).toBeLessThanOrEqual(1);
    // 세로는 v037이 정본이지만, 가로 처방이 세로를 깨지 않았는지 최소 가드만 둔다 `[TEAMOPS-97]`.
    expect(m.labelTopInside, `${name} 편집 칩 항목명이 위로 잘림`).toBeGreaterThanOrEqual(-0.5);
    expect(m.labelBottomInside, `${name} 편집 칩 항목명이 아래로 잘림`).toBeGreaterThanOrEqual(-0.5);
  });
}

test('§C1-② 대조군 — **비편집** 상태에서는 같은 항목명이 잘리지 않는다 @ 402×874', async ({ page }) => {
  await boot(page, PHONE_402);
  // 클릭하지 않는다. 위 테스트와 **유일하게 다른 것이 편집 여부**여야 원인이 좁혀진다.
  const m = await editChipClip(page);
  console.log(
    `[edit-chip:대조군] 402×874: chipW=${m.chipWidth.toFixed(1)} labelW=${m.labelWidth.toFixed(1)} `
    + `left=${m.labelLeftInside.toFixed(1)} right=${m.labelRightInside.toFixed(1)} shrink=${m.flexShrink}`,
  );
  // 🔴 이 단언이 red면 **위 테스트들의 판정이 무효다** — 항목명이 애초에 칩 상한을 넘는다는 뜻이라
  //    §C1-③(긴 항목명) 영역이고 편집 경로 탓이 아니다. 그때는 `EDIT_COL_NAME`을 줄여라.
  expect(m.labelLeftInside, '대조군: 비편집 칩에서 이미 잘린다면 이 파일의 전제가 깨진 것이다')
    .toBeGreaterThanOrEqual(-0.5);
  expect(m.labelRightInside, '대조군: 비편집 칩에서 이미 잘린다면 이 파일의 전제가 깨진 것이다')
    .toBeGreaterThanOrEqual(-0.5);
});

test('§C1-① 편집으로 칩 폭이 바뀌어도 활성 칩이 가시영역 밖으로 밀리지 않는다 @ 402×874', async ({ page }) => {
  await boot(page, PHONE_402);

  const grid = page.locator('[data-testid="voice-chip-grid"]');
  const before = await grid.evaluate((el) => {
    const g = el as HTMLElement;
    const active = g.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
    if (!active) return null;
    const gr = g.getBoundingClientRect();
    const ar = active.getBoundingClientRect();
    return { rightInside: gr.right - ar.right, leftInside: ar.left - gr.left, name: active.dataset.colName };
  });
  expect(before, '활성 칩이 있어야 한다').not.toBeNull();

  await enterEdit(page);
  // 🔴 `alignActiveChip`은 effect다. 재정렬이 **돌았다면** 이 시간 안에 끝난다.
  //    안 돌면 아무리 기다려도 안 온다 — 대기는 판정을 흐리지 않는다.
  await page.waitForTimeout(400);

  const after = await grid.evaluate((el) => {
    const g = el as HTMLElement;
    const active = g.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
    if (!active) return null;
    const gr = g.getBoundingClientRect();
    const ar = active.getBoundingClientRect();
    return { rightInside: gr.right - ar.right, leftInside: ar.left - gr.left, name: active.dataset.colName };
  });
  console.log(
    `[active-chip] 편집 전 left=${before!.leftInside.toFixed(1)} right=${before!.rightInside.toFixed(1)} `
    + `→ 후 left=${after!.leftInside.toFixed(1)} right=${after!.rightInside.toFixed(1)} (${after!.name})`,
  );

  // 🔑 **세 축이 같은 기전이다.** `confirmExitOpen`·`manualCol`·`editingColId` 셋 다
  //    「칩 폭 또는 칩존 배분을 바꾸는데 정렬 effect가 그것을 안 본다」는 하나의 결함이고
  //    (`ActiveState.tsx:275`가 `confirmExitOpen`·`manualCol`로 `gridTemplateRows`를 가른다),
  //    여기서는 **테스트로 도달하기 가장 쉬운 `editingColId`** 를 대표로 잡는다.
  //    ⚠️ 셋 중 하나만 deps에서 빠져도 이 테스트는 green이다 — **deps 목록 자체를 리뷰해라.**
  expect(after!.leftInside, '활성 칩이 그리드 왼쪽 밖으로 밀렸다').toBeGreaterThanOrEqual(-0.5);
  expect(after!.rightInside, '활성 칩이 그리드 오른쪽 밖으로 밀렸다').toBeGreaterThanOrEqual(-0.5);
});

test('§C1-② 편집 칩은 shrink 대상이 아니다 — 결손을 혼자 흡수하지 않는다 @ 402×874', async ({ page }) => {
  await boot(page, PHONE_402);
  await enterEdit(page);
  const m = await editChipClip(page);

  // 🔑 **왜 계산된 스타일을 직접 단언하나** — 위 잘림 축은 항목명 길이·폰트에 의존하므로
  //    시트가 바뀌면(§8 시트 불특정) 재현이 흔들린다. `flex-shrink`는 그와 무관한 **구조 계약**이라
  //    되돌림을 확실히 잡는다. 두 축을 함께 둔 이유는 `[TEAMOPS-97]`이다.
  //    ⚠️ 종전 값은 `flex: 1 1 220px`였다 — 단일 라인에서 유일한 shrink 대상이라 결손을 혼자
  //    흡수하고 `minWidth`까지 찌그러졌다. `ColumnChip.tsx`의 *"넘치면 줄이지 말고 가로로 밀어야
  //    한다"* 계약이 비편집 경로에만 적용돼 있던 것이 이 결함이다.
  expect(Number(m.flexShrink), '편집 칩이 shrink 대상이면 결손을 혼자 흡수한다').toBe(0);
});
