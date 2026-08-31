/**
 * v0.47.0 r2 **P7** — 네비 라벨 복원 + 하단 패딩 축소 (민구 08-09 실기기 점검 FB-H).
 *
 * 민구 원문: *"네비게이션 버튼 아래 버튼 이름 출력 설정/ 입력/ 업로드/ 개선요청 - 스크린샷에는
 * 안보이지만 지금 하단에 빈 공간이 많이 보임. 아이폰의 키보드 펼쳤을때 언어와 마이크 버튼이 있는
 * 공간까지는 사용을 못하고 있음."*
 *
 * ## 🔴 이 스펙이 없으면 P7은 **실기기에서 아무 일도 안 일어난 채 green이 된다**
 * 종전 `paddingBottom: max(28px, var(--sab))`는 402×874 iOS에서 `--sab`≈34px가 **지배**했다.
 * 28을 12로 낮춰도 `max(12,34)=34`라 실기기 여백은 **1px도 안 줄어든다.** 「라벨이 보인다」만
 * 단언하는 스펙은 그 no-op을 통과시킨다 — 그래서 여기서 **높이를 숫자로 잰다.**
 *
 * ## 측정 정본 (402×874, 이 스펙이 재현한다)
 * | | --sab=0 | --sab=34(iPhone) |
 * |---|---|---|
 * | 변경 전 | 89px | **95px** |
 * | 변경 후 | 85px | **85px** |
 * `--sab` 추종을 끊었으므로 두 열이 같아진 것이 정상이다. 실기기 순 회수 = **10px**
 * (라벨이 +12px를 먹고 패딩이 −22px를 돌려준다).
 *
 * ## 계약 참조
 * 기대값을 리터럴로 적지 않고 `TabBar.tsx`의 export 상수를 **import**한다 — 상수와 스펙이 갈라져
 * 한쪽만 고친 채 통과하는 이중 기록을 막는다(`chipSweep.ts` 헤더 §왜 lib으로 뺐나와 같은 판단).
 * 🔑 동어반복을 피하려고, 상수 자체에도 **의미 있는 부등식**을 건다(패딩 < --sab).
 *
 * 관련: 홈인디케이터 침범 계약은 `tests/safe-area.spec.ts` ①이 (반대 방향으로) 진다.
 */
import { test, expect, type Page } from '@playwright/test';
import { BASE } from './baseUrl';
import { NAV_PAD_BOTTOM, NAV_PAD_TOP, NAV_TOUCH_TARGET, NAV_MIN_HEIGHT } from '../src/components/TabBar';

/** iPhone 402×874 세로의 홈인디케이터 inset. 레포 정본(`tests/safe-area.spec.ts:5`
 *  `fixtures/safeArea.ts` · `v0440-chip-viewport-sweep.spec.ts:179`)과 같은 값이다. */
const IPHONE_SAB = 34;

/** 변경 전 실측 높이(--sab=34). **회귀 상한**으로만 쓴다 — 이 값 이상이면 축소가 되돌려진 것. */
const BEFORE_HEIGHT_AT_SAB34 = 95;

const TAB_IDS = ['settings', 'voice', 'data', 'feedback'] as const;
const TAB_LABELS: Record<(typeof TAB_IDS)[number], string> = {
  settings: '설정', voice: '입력', data: '업로드', feedback: '개선요청',
};

async function boot(page: Page) {
  await page.setViewportSize({ width: 402, height: 874 });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="tab-bar"]');
  await page.waitForTimeout(400); // ResizeObserver의 --nav-h 발행 정착
}

async function setSab(page: Page, px: number) {
  await page.evaluate((v) => document.documentElement.style.setProperty('--sab', `${v}px`), px);
  await page.waitForTimeout(250);
}

/** 탭바 실측 — offsetHeight(패딩·보더 포함)와 발행된 `--nav-h`를 함께 돌려준다. */
async function measure(page: Page) {
  return page.evaluate(() => {
    const bar = document.querySelector('[data-testid="tab-bar"]') as HTMLElement;
    const btn = document.querySelector('[data-testid="tab-voice"]') as HTMLElement;
    const cs = getComputedStyle(bar);
    return {
      barHeight: bar.offsetHeight,
      navH: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')),
      padBottom: parseFloat(cs.paddingBottom),
      padTop: parseFloat(cs.paddingTop),
      minHeight: parseFloat(cs.minHeight),
      btnHeight: btn.getBoundingClientRect().height,
    };
  });
}

// ── ① 라벨 복원 ──────────────────────────────────────────────
test('① 네 탭 모두 아이콘 **아래**에 가시 라벨이 있다 (설정/입력/업로드/개선요청)', async ({ page }) => {
  await boot(page);
  for (const id of TAB_IDS) {
    const label = page.locator(`[data-testid="tab-label-${id}"]`);
    await expect(label, `tab-${id} 라벨이 보여야 한다`).toBeVisible();
    await expect(label).toHaveText(TAB_LABELS[id]);

    // 🔑 「보인다」로는 부족하다 — **아이콘 아래**여야 한다(민구 원문 "버튼 아래 버튼 이름").
    //    가로 배치나 겹침이면 여기서 잡힌다.
    const geo = await page.evaluate((tabId) => {
      const btn = document.querySelector(`[data-testid="tab-${tabId}"]`) as HTMLElement;
      const lab = document.querySelector(`[data-testid="tab-label-${tabId}"]`) as HTMLElement;
      const pill = btn.firstElementChild as HTMLElement;
      const lb = lab.getBoundingClientRect();
      const pb = pill.getBoundingClientRect();
      return { labelTop: lb.top, pillBottom: pb.bottom, labelHeight: lb.height };
    }, id);
    expect(geo.labelTop, `tab-${id} 라벨 top(${geo.labelTop})은 아이콘 pill bottom(${geo.pillBottom}) 아래`)
      .toBeGreaterThanOrEqual(geo.pillBottom - 0.5);
    expect(geo.labelHeight, `tab-${id} 라벨이 0높이로 접히지 않았다`).toBeGreaterThan(4);
  }
});

// ── ② 하단 공간 회수 (이 과제의 유일한 성공 판정) ─────────────
test('② 🔴 iPhone(--sab=34)에서 탭바가 실제로 낮아진다 — no-op 방지', async ({ page }) => {
  await boot(page);
  await setSab(page, IPHONE_SAB);
  const m = await measure(page);

  // 🔴 핵심. 종전엔 max(28px, --sab)라 --sab가 이겨 34px였다.
  expect(m.padBottom, `하단 패딩이 --sab(${IPHONE_SAB})보다 작아야 실기기에서 공간이 회수된다`)
    .toBeLessThan(IPHONE_SAB);
  expect(m.padBottom, '패딩 실측이 TabBar 상수와 일치').toBe(NAV_PAD_BOTTOM);
  expect(m.padTop, '상단 패딩 실측이 상수와 일치').toBe(NAV_PAD_TOP);

  // minHeight가 축소분을 되돌리지 않는다 — 88이 남아 있으면 여기서 잡힌다.
  expect(m.minHeight, 'minHeight 실측이 상수와 일치').toBe(NAV_MIN_HEIGHT);
  expect(m.barHeight, `탭바(${m.barHeight}px)가 minHeight(${NAV_MIN_HEIGHT})에 clamp되지 않았다 = 내용이 높이를 정한다`)
    .toBeGreaterThan(NAV_MIN_HEIGHT);

  // 회귀 상한 — 변경 전 95px보다 확실히 낮다.
  expect(m.barHeight, `탭바가 변경 전(${BEFORE_HEIGHT_AT_SAB34}px)보다 낮아야 한다`)
    .toBeLessThan(BEFORE_HEIGHT_AT_SAB34);
  console.log(`[P7] --sab=${IPHONE_SAB} 탭바 실측 ${m.barHeight}px (변경 전 ${BEFORE_HEIGHT_AT_SAB34}px · 회수 ${BEFORE_HEIGHT_AT_SAB34 - m.barHeight}px)`);
});

test('③ 탭바 높이가 --sab에 좌우되지 않는다 (safe-area 추종을 끊은 결과)', async ({ page }) => {
  await boot(page);
  await setSab(page, 0);
  const at0 = await measure(page);
  await setSab(page, IPHONE_SAB);
  const at34 = await measure(page);
  expect(at34.barHeight, `--sab 0(${at0.barHeight}px) / 34(${at34.barHeight}px)가 같아야 한다`)
    .toBe(at0.barHeight);
});

// ── ③ 유지되어야 하는 계약 ───────────────────────────────────
test('④ 최소 터치 타깃 56px와 --nav-h 발행은 유지된다', async ({ page }) => {
  await boot(page);
  await setSab(page, IPHONE_SAB);
  const m = await measure(page);
  expect(m.btnHeight, `탭 버튼 높이(${m.btnHeight})가 최소 타깃 ${NAV_TOUCH_TARGET}px 이상`)
    .toBeGreaterThanOrEqual(NAV_TOUCH_TARGET);
  // 🔴 --nav-h는 `ModalBase`의 `bottomInset`을 쓰는 오버레이들이 소비하는 SSOT다. 실측 높이와
  // 어긋나면 그 오버레이가 네비를 덮거나(잘림) 뜬다(v0.37.0 FB-I가 고친 그 결함).
  // ⚠️ **종전 주석의 「수동 입력 시트가 소비한다」는 거짓이었다**(2026-08-31 실측 정정 —
  //   `grep -rn bottomInset src`가 정의만 찾고 호출부를 0건 찾았다. 그 시트는 그리드 인라인이다).
  //   실제 첫 소비자는 v0.51 P0-1의 보기 전용 오버레이들이다 — 그래서 이 단언은 **그때부터**
  //   실효를 가진다(종전에는 아무도 안 읽는 값을 지키고 있었다).
  expect(m.navH, `--nav-h(${m.navH}) = 실측 offsetHeight(${m.barHeight})`).toBe(m.barHeight);
});
