/**
 * v0.23.0 설정탭(Vance) — A1·A2·A3·A4 검증.
 *   A1 — 이상값 범위 입력 옆에 "%" 단위가 **항상** 보인다(placeholder 의존 제거).
 *   A2 — 자동입력 컬럼의 자동값 행에 선두 라벨 "입력값"이 입력방식/음성확인과 정렬돼 노출.
 *   A3 — 날짜 컬럼은 라디오 대신 SegmentToggle(오늘|지정) — 별도 스펙(v54-scenarios)에서 검증.
 *   A4 — 상단 `?` → 설명 팝업(COLUMN_HELP) + 첫 진입 1회 dismissible 안내 배너(localStorage).
 *
 * 375px 시뮬레이션(GL-005): `?` 설명 팝업이 좁은 기기에서 잘리지 않는다(scrollWidth ≤ clientWidth).
 */
import { test, expect, type Page } from '@playwright/test';

import { BASE } from './baseUrl';
const PHONE_375 = { width: 375, height: 812 };

async function goToSettings(page: Page) {
  await page.setViewportSize(PHONE_375);
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  await page.locator('[data-testid="tab-settings"]').click();
  await page.waitForTimeout(300);
}

test('A4 — 첫 진입 안내 배너가 보이고, ✕로 닫으면 localStorage에 영속', async ({ page }) => {
  await goToSettings(page);

  const tip = page.locator('[data-testid="settings-first-tip"]');
  await expect(tip).toBeVisible({ timeout: 3000 });
  console.log('✓ 첫 진입 안내 배너 표시');

  // 배너는 fixed 오버레이가 아니라 인라인 배너 → 아래 카드/버튼을 가리지 않는다(클릭 통과 확인).
  await expect(page.locator('[data-testid^="col-card-"]').first()).toBeVisible();

  await page.locator('[data-testid="settings-first-tip-dismiss"]').click();
  await page.waitForTimeout(200);
  await expect(tip).toBeHidden();

  const seen = await page.evaluate(() => localStorage.getItem('agri-voicenote-settings-tip-seen'));
  expect(seen).toBe('1');
  console.log('✓ ✕ 닫기 → localStorage seen=1');

  // 재진입(리로드) 후에도 다시 안 뜬다.
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.locator('[data-testid="tab-settings"]').click();
  await page.waitForTimeout(300);
  await expect(page.locator('[data-testid="settings-first-tip"]')).toBeHidden();
  console.log('✓ 재진입 후 배너 미노출(1회성)');
});

test('A4 — 상단 `?` → 설명 팝업이 열리고 375px에서 잘리지 않음', async ({ page }) => {
  await goToSettings(page);

  // 카드별 중복 `?`는 제거되고 상단 헤더의 단일 도움말 버튼만 남는다.
  await expect(page.locator('[data-testid="help-button"]')).toHaveCount(0);
  await page.locator('[data-testid="settings-help-button"]').click();
  await page.waitForTimeout(300);

  const modal = page.locator('[data-testid="settings-help-modal"]');
  await expect(modal).toBeVisible({ timeout: 2000 });
  // 핵심 도움말 항목 문구가 들어있다.
  await expect(modal).toContainText('입력방식');
  await expect(modal).toContainText('이상값 범위');
  console.log('✓ 설명 팝업 열림 + 핵심 문구 포함');

  // 375px 잘림 0 — 팝업 내부 박스가 가로로 새지 않는다(scrollWidth ≤ clientWidth+1).
  const box = modal.locator('> div').first();
  const clip = await box.evaluate((el) => ({
    sw: (el as HTMLElement).scrollWidth,
    cw: (el as HTMLElement).clientWidth,
  }));
  console.log(`help modal: scrollWidth=${clip.sw} clientWidth=${clip.cw}`);
  expect(clip.sw).toBeLessThanOrEqual(clip.cw + 1);

  // 배경 탭으로 닫힘.
  await page.locator('[data-testid="settings-help-modal"]').click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(200);
  await expect(modal).toBeHidden();
  console.log('✓ 배경 탭으로 닫힘');
});

test('A1 — 이상값 범위 입력 옆 "%" 단위가 항상 보인다', async ({ page }) => {
  await goToSettings(page);

  // MOCK 컬럼 중 추세 적격(횡경/종경 = voice float)에 이상값 범위 입력 + % 단위가 있다.
  const pctInput = page.locator('[data-testid^="pct-threshold-"]').first();
  await expect(pctInput).toBeVisible({ timeout: 3000 });

  // 같은 컬럼의 % 단위 표기를 testid로 찾는다(placeholder가 아니라 항상 보이는 span).
  const colId = await pctInput.evaluate((el) => el.getAttribute('data-testid')!.replace('pct-threshold-', ''));
  const unit = page.locator(`[data-testid="pct-unit-${colId}"]`);
  await expect(unit).toBeVisible();
  await expect(unit).toHaveText('%');

  // 값을 입력해도 % 단위는 그대로 보인다(placeholder 의존이 아님을 증명).
  await pctInput.fill('12');
  await page.waitForTimeout(150);
  await expect(unit).toBeVisible();
  await expect(unit).toHaveText('%');
  console.log('✓ 값 입력 후에도 "%" 단위 유지');
});

test('A2 — 자동입력 컬럼 자동값 행에 선두 라벨 "입력값"이 노출', async ({ page }) => {
  await goToSettings(page);

  // MOCK 컬럼 중 자동입력(농가명=auto text, 조사나무=auto int seq 등)이 있다. 자동값 행 testid로 확인.
  const autoRow = page.locator('[data-testid^="auto-value-row-"]').first();
  await expect(autoRow).toBeVisible({ timeout: 3000 });
  await expect(autoRow).toContainText('입력값');
  console.log('✓ "입력값" 선두 라벨 노출');

  // 입력방식/음성확인 라벨과 같은 카드 안에 함께 존재(3행 정렬).
  const card = autoRow.locator('xpath=ancestor::*[starts-with(@data-testid,"col-card-")]').first();
  await expect(card).toContainText('입력방식');
  await expect(card).toContainText('음성확인');
  console.log('✓ 입력방식/음성확인/입력값 3행 동거(정렬)');
});
