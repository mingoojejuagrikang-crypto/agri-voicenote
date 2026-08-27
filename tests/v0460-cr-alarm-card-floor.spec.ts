import { test, expect, type Page } from '@playwright/test';
import { boot } from './fixtures/activeZones';
import { fireStt, fireSttInterim, waitForTtsIdle } from './fixtures/stt';

/** 🔴 카드가 「쓸모 있는」 최소 높이. 알람 카드는 수정·확인 버튼(44px 터치 타깃 계약)과
 *  비교값 행을 담는다.
 *
 *  ## §실측 (08-07 · 처방 후)
 *  | 뷰포트 | 스테이지 | 인식값 있을 때 카드 | 없을 때 카드 |
 *  |---|---|---|---|
 *  | 375×667 | 248.7px | **124.3px** | 202.7px |
 *  | 402×812 | 318.3px | 159.1px | 265.5px |
 *  | 402×874 | 348.0px | 174.0px | 291.2px |
 *  → 최소 지원 규격(375)의 **124.3px가 하한**이고, 임계 `120`은 그 아래 4.3px 여유다.
 *  ⚠️ 처방 전에는 세 뷰포트 모두 **카드 0px · 도달 실패**였다. */
const CARD_MIN_H = 120;

/**
 * v0.46.0 콜드 리뷰 L3-1(critical) 게이트 — **알람 카드가 인식값 스트립에 먹히지 않는다.**
 *
 * ## 결함 (08-06 콜드 리뷰 L3 실측 · Larry 코드 확인)
 *
 * `AlarmInterimStrip`의 fit **컨테이너가 스트립 자신**(`height:auto`)이고 부모 그리드가
 * `minmax(0,1fr) auto`다. 그래서 **스트립이 커질수록 형제(알람 카드) 행이 눌리고, 눌린 만큼
 * 스트립에 배정될 높이가 또 늘어난다** → 평형점은 「스트립이 스테이지 전량」이다.
 * 폭만 묶여 있어 **1~2글자 인식값에서는 아무것도 안 묶인다**: 실측 402×874에서 폰트 304.8px ·
 * 스트립 348px · **알람 카드 높이 0 · `elementFromPoint` 도달 실패**. 375×667도 카드 0.
 * A/B: 종전 공식을 강제 주입하면 76.38px·카드 256px로 생존 → **v0.46.0 신규 회귀.**
 *
 * ## 이 파일이 재는 것
 *
 * 🔴 **「카드가 살아 있는가」는 픽셀 크기가 아니라 두 축이다**: ①높이 > 0 ②중앙점이 실제로
 * 카드(또는 그 자손)로 히트된다. `[TEAMOPS-86]`이 세운 정본대로 `elementFromPoint`를 쓴다 —
 * `toBeVisible()`은 조상 클리핑도 가림도 판정하지 않는다.
 *
 * ⚠️ **인식값이 짧을 때가 위험 구간이다.** 3~4글자부터는 폭이 묶여 저절로 회복하므로
 * `'1'`·`'12'`를 반드시 포함한다 — 이 결함은 **긴 값에서 보이지 않는다.**
 */

/** 🔴 `v0460-fit-headroom`·`v0440-alarm-fit`의 **검증된 형태를 그대로 따른다.**
 *  처음에 `trendRule`을 객체로, 과거 회차 날짜를 고정 문자열로 줬더니 **알람이 아예 안 떴다**
 *  (3/3 `anomaly-alert` waitFor 타임아웃). `trendRule`은 문자열이고(`'decrease'` = 작아지면 알람),
 *  과거 회차는 **어제 날짜**여야 매칭된다. 픽스처를 새로 짜지 말고 검증된 것을 복사해라. */
function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const PREV_ROUND = localISO(new Date(Date.now() - 86_400_000));
const PREV_VALUE = '1234.56';
const SPOKEN = '1189.42';

type Case = { interim: string; label: string };
const CASES: Case[] = [
  { interim: '1', label: '1글자' },
  { interim: '12', label: '2글자' },
  { interim: '118', label: '3글자' },
  { interim: '118.2', label: '5글자' },
];

const VIEWPORTS = [
  { width: 375, height: 667, label: '최소 지원 규격' },
  { width: 402, height: 812, label: '민구 실기기' },
  { width: 402, height: 874, label: 'screen 높이' },
];

function makeSettings() {
  const columns = [
    { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
    { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
    { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
    { id: 'v0', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, sampleKey: false, trendRule: 'decrease' as const },
  ];
  return {
    settings: {
      state: {
        googleConnected: true, userEmail: 'tester@example.com',
        sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_CR_CARD_FLOOR/edit',
        sheetTab: 'Sheet1', columnsSheetId: 'SHEET_CR_CARD_FLOOR', columnsSheetTab: 'Sheet1',
        columns, tableGenerated: true, totalRows: 2, ttsRate: 1.05,
        recognitionTolerance: 0.6, sessionLabelColId: null, sessionAutoLabel: 'cr-card-floor',
        preferredVoiceName: '', roundDateColId: null,
      },
      version: 13,
    },
    headers: ['조사일자', '농가명', '조사나무', '횡경'],
    sheetRows: [[PREV_ROUND, '이원창', '1', PREV_VALUE]],
  };
}

/** 알람을 띄운다 — 알람 전용 `<style>`은 이 분기에서만 DOM에 있다(플랜 §3-6 함정). */
async function raiseAlarm(page: Page) {
  await fireStt(page, SPOKEN, 900);
  await page.locator('[data-testid="anomaly-alert"]').waitFor({ state: 'visible', timeout: 4000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
}

/** 알람 중 인식값 스트립에 값을 올린다(확정 전 interim). */
async function setInterim(page: Page, text: string) {
  await fireSttInterim(page, text, 300);
  await page.locator('[data-testid="interim-value"]').waitFor({ state: 'visible', timeout: 4000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
}

type Measured = {
  cardH: number;
  cardReachable: boolean;
  stripH: number;
  stripFont: number;
  stageH: number;
};

async function measure(page: Page): Promise<Measured> {
  return page.evaluate(() => {
    const card = document.querySelector('[data-testid="anomaly-alert"]') as HTMLElement | null;
    const strip = document.querySelector('[data-testid="interim-value"]') as HTMLElement | null;
    const stage = document.querySelector('[data-central-state="alarm"]') as HTMLElement | null;
    const cb = card?.getBoundingClientRect();
    const sb = strip?.getBoundingClientRect();
    let reachable = false;
    if (card && cb && cb.height > 0) {
      const top = document.elementFromPoint(cb.left + cb.width / 2, cb.top + cb.height / 2);
      reachable = !!(top && card.contains(top));   // contains는 자기 자신을 포함한다
    }
    return {
      cardH: cb?.height ?? 0,
      cardReachable: reachable,
      stripH: sb?.height ?? 0,
      stripFont: strip ? parseFloat(getComputedStyle(strip).fontSize) : 0,
      stageH: stage?.getBoundingClientRect().height ?? 0,
    };
  });
}

for (const vp of VIEWPORTS) {
  test(`알람 카드가 인식값에 먹히지 않는다 @ ${vp.width}×${vp.height} (${vp.label})`, async ({ page }) => {
    const { settings, headers, sheetRows } = makeSettings();
    await boot(page, vp, { settings, headers, sheetRows });
    await waitForTtsIdle(page);
    await raiseAlarm(page);

    const rows: string[] = [];
    for (const c of CASES) {
      await setInterim(page, c.interim);
      const m = await measure(page);
      rows.push(
        `${c.label}(${c.interim}): 카드 ${m.cardH.toFixed(1)}px 도달=${m.cardReachable} · ` +
        `스트립 ${m.stripH.toFixed(1)}px/${m.stripFont.toFixed(1)}px · 스테이지 ${m.stageH.toFixed(1)}px`,
      );

      // ① 카드가 남아 있다 — 0이면 알람이 화면에서 사라진 것이다.
      expect(
        m.cardH,
        `${c.label}: 알람 카드 높이가 0이다 — 인식값 스트립이 스테이지를 전량 먹었다`,
      ).toBeGreaterThan(0);

      // ② 🔴 카드 중앙점이 카드로 히트된다 — 「보인다」가 아니라 「닿는다」를 잰다([TEAMOPS-86]).
      expect(
        m.cardReachable,
        `${c.label}: 카드 중앙이 다른 요소에 잡힌다 — 덮였거나 조상에 클리핑됐다`,
      ).toBe(true);

      // ③ 스트립이 스테이지를 독식하지 않는다. 🔑 상한을 「카드가 쓸모 있는 최소」로 잡는다 —
      //    알람 카드에는 수정·확인 버튼(터치 타깃)과 비교값이 들어간다.
      expect(
        m.cardH,
        `${c.label}: 카드가 ${CARD_MIN_H}px 미만이다 — 버튼·비교값이 들어갈 자리가 없다`,
      ).toBeGreaterThanOrEqual(CARD_MIN_H);
    }
    console.log(`[card-floor@${vp.width}x${vp.height}]\n  ${rows.join('\n  ')}`);
  });

  test(`인식값이 없으면 카드가 스테이지를 거의 다 쓴다 @ ${vp.width}×${vp.height}`, async ({ page }) => {
    // 🔴 이 케이스는 **처방의 첫 시도가 만든 회귀를 잡아서 생겼다.** 스트립에 `height:'100%'`를
    //    무조건 주면 인식값이 없을 때도 트랙 절반을 차지해 **카드가 항상 절반으로 줄어든다**
    //    (375×667 실측: 248.7 → 124.3px). 알람 중 대부분의 시간은 인식값이 없는 상태다.
    //    🔑 처방이 다른 축을 깨뜨리지 않았는지 재는 것이 이 케이스의 몫이다.
    const { settings, headers, sheetRows } = makeSettings();
    await boot(page, vp, { settings, headers, sheetRows });
    await waitForTtsIdle(page);
    await raiseAlarm(page);

    const m = await measure(page);
    console.log(
      `[card-idle@${vp.width}x${vp.height}] 카드 ${m.cardH.toFixed(1)}px · ` +
      `스트립 ${m.stripH.toFixed(1)}px · 스테이지 ${m.stageH.toFixed(1)}px`,
    );
    expect(m.cardH, '인식값이 없는데 카드가 스테이지 절반 이하다').toBeGreaterThan(m.stageH * 0.6);
    expect(m.cardReachable).toBe(true);
  });
}

