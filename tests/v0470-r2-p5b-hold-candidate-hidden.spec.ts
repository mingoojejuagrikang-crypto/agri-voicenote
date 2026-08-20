/**
 * v0.47.0-r2 P5 보강(FB-F 후속 · 민구 확정 08-09) — **미확정 후보값을 칩에 넣지 않는다.**
 *
 * 민구 원문 맥락: *"알람 발생시킨 값이 칩에 안 들어가 있다면 그건 내가 더 원하는 상황."*
 * 선택지 셋(후보값 숨김 / 현행 유지 / 후보에도 빨간 체크) 중 **숨김**을 골랐다.
 *
 * 수동 입력 이상치가 **보류**(manualHold)되면 후보값은 [확인] 전까지 확정값이 아니다. 그런데
 * 칩존이 그 값을 확정값처럼 크게 보여 줘, 폰을 2~3m 떨어뜨려 두는 사용자에게 *"저 값이
 * 들어갔다"* 로 읽혔다. 후보값은 **알람 팝업에만** 남긴다.
 *
 * 이 스펙이 고정하는 계약:
 *  ⓐ **빈 셀**의 후보 — 칩은 **빈 채로**(마크도 없음), 팝업엔 후보값. [확인] 순간 값+초록 ✓ 등장.
 *  ⓑ **기존 값이 있던 셀**의 후보 — 칩은 **직전 확정값 + 원래 색(초록) 체크**를 유지한다.
 *     🔑 여기가 P5 본편과 부딪히는 지점이다: 알람 셀의 ✓는 빨강이 원칙인데, 이 칩이 보여 주는
 *     값은 **알람 대상이 아닌 직전 확정값**이라 초록이 맞다(민구: *"옛 값(+원래 색 체크)"*).
 *  ⓒ **reload 복구**에서도 가려진다 — 저장은 후보값 그대로 두고 **렌더 직전에만** 치환하는
 *     설계라, 복원 경로에 별도 배선 없이 같은 마스크가 걸린다는 증거다.
 *  ⓓ **[수정] 시트 프리필은 후보값 그대로** — 방금 넣은 값의 한 자리를 고치는 흐름이라
 *     거절된 옛 값으로 되돌리면 방해다. 「값을 숨긴다」가 「값을 잃는다」가 아님을 고정한다.
 *
 * ⚠️ 왕복 OFF([TEAMOPS-81]) — 칩을 클릭하므로 필수. activeZones SETTINGS 승계.
 */

import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt } from './fixtures/stt';

test.setTimeout(120_000);

/** 측정항목01 = `trendRule: 'increase'` · 직전 100.0 → 120.5 위반. 03은 「행을 안 끝내는 꼬리」다
 *  (2컬럼이면 두 번째 값에서 행이 완료돼 칩존이 다음 행을 그린다 — P5 본편에서 실측한 함정). */
const MINI_COLUMNS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'increase' },
  { id: 'm2', name: '측정항목02', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  { id: 'm3', name: '측정항목03', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];
const MINI_SETTINGS = {
  ...AZ_SETTINGS,
  state: { ...AZ_SETTINGS.state, columns: MINI_COLUMNS, totalRows: 2, sessionAutoLabel: 'r2-p5b-hidden' },
};
const MINI_HEADERS = ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02', '측정항목03'];
const MINI_ROWS = [
  [PREV_ROUND, '이원창', '1', '100.0', '5.0', ''],
  [PREV_ROUND, '이원창', '2', '100.0', '5.0', ''],
];

const chip = (page: Page, colName: string) =>
  page.locator(`[data-testid="column-chip"][data-col-name="${colName}"]`);
const markIn = (page: Page, colName: string) =>
  chip(page, colName).locator('[data-testid="chip-commit-mark"]');
const popup = (page: Page) => page.locator('[data-testid="anomaly-alert"]');

const bootMini = (page: Page) => boot(page, PHONE_402, {
  settings: MINI_SETTINGS as unknown as typeof AZ_SETTINGS,
  headers: MINI_HEADERS,
  sheetRows: MINI_ROWS,
});

/** 칩 탭 → 키패드 입력 → 커밋. */
async function commitManual(page: Page, colName: string, keys: string[]) {
  await chip(page, colName).click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible();
  for (const k of keys) await page.locator(`[data-testid="manual-key-${k}"]`).click();
  await page.locator('[data-testid="manual-commit"]').click();
}

test('P5b-ⓐ 🔴 빈 셀의 미확정 후보 — 칩은 빈 채로(마크 없음), 후보값은 팝업에만 → [확인] 후 등장', async ({ page }) => {
  await bootMini(page);

  await commitManual(page, '측정항목01', ['1', '2', '0', '.', '5']);
  await expect(popup(page), '수동 이상치 = 진행 보류').toBeVisible({ timeout: 6000 });

  // 🔴 회귀 지점 — 종전엔 칩에 120.5가 확정값처럼 들어가 있었다.
  await expect(chip(page, '측정항목01'), '후보값이 칩에 들어가면 안 된다').not.toContainText('120.5');
  await expect(markIn(page, '측정항목01'), '빈 셀이었으니 마크도 없다').toHaveCount(0);
  // 정보 손실이 아님을 같은 호흡에 고정한다 — 후보값은 팝업이 크게 진다.
  await expect(popup(page), '후보값은 팝업에 남는다').toContainText('120.5');

  // [확인] = 후보를 확정값으로 승격 → 그제서야 값 + 초록 ✓ 등장.
  await page.locator('[data-testid="anomaly-confirm-btn"]').click();
  await expect(popup(page)).toHaveCount(0, { timeout: 4000 });
  await expect(chip(page, '측정항목01'), '[확인] 후 값 등장').toContainText('120.5');
  await expect(markIn(page, '측정항목01')).toBeVisible({ timeout: 4000 });
  expect(await markIn(page, '측정항목01').getAttribute('data-mark-tone'), '[확인] 후 초록').toBe('ok');
});

test('P5b-ⓑ 🔴 기존 값이 있던 셀의 후보 — 칩은 직전 확정값 + **원래 색(초록)** 체크를 유지', async ({ page }) => {
  await bootMini(page);

  // 1행 완주 → 2행 → '이전'으로 검토 대기 복귀. 검토 대기 커밋은 어느 셀이든 흐름을 소유하므로
  // (ownsFlow) **이미 값이 있는 셀**에 보류를 걸 수 있다 — ⓐ와 다른 분기다.
  await fireStt(page, '100.0', 700);
  await fireStt(page, '5.0', 700);
  await fireStt(page, '1.0', 900);
  await fireStt(page, '이전행', 1500);
  await expect(chip(page, '측정항목01')).toContainText('100');
  expect(await markIn(page, '측정항목01').getAttribute('data-mark-tone'), '정상 커밋 = 초록').toBe('ok');

  await commitManual(page, '측정항목01', ['1', '2', '0', '.', '5']);
  await expect(popup(page)).toBeVisible({ timeout: 6000 });

  // 칩은 **직전 상태 그대로**다 — 옛 값 + 원래 색 체크.
  await expect(chip(page, '측정항목01'), '후보값 숨김').not.toContainText('120.5');
  await expect(chip(page, '측정항목01'), '직전 확정값 보존').toContainText('100');
  await expect(markIn(page, '측정항목01'), '체크도 보존').toBeVisible();
  expect(
    await markIn(page, '측정항목01').getAttribute('data-mark-tone'),
    '🔑 보여 주는 값이 알람 대상이 아니므로 체크는 **원래 색(초록)**',
  ).toBe('ok');
  await expect(popup(page)).toContainText('120.5');

  // [확인] → 후보가 확정값이 되며 칩에 등장.
  await page.locator('[data-testid="anomaly-confirm-btn"]').click();
  await expect(popup(page)).toHaveCount(0, { timeout: 4000 });
  await expect(chip(page, '측정항목01')).toContainText('120.5');
  expect(await markIn(page, '측정항목01').getAttribute('data-mark-tone')).toBe('ok');
});

test('P5b-ⓒ 🔴 reload 복구에서도 후보값은 칩에 없다 — 저장은 그대로, 렌더에서만 가린다', async ({ page }) => {
  await bootMini(page);

  await commitManual(page, '측정항목01', ['1', '2', '0', '.', '5']);
  await expect(popup(page)).toBeVisible({ timeout: 6000 });

  // 후보는 **IDB에 그대로 남아 있어야** 한다(가린 것은 표시일 뿐 — 유실이 아니다).
  const stored = await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const all: Array<{ pendingValidation?: { candidateValue: string } }> = await new Promise((res, rej) => {
      const r = db.transaction('sessions', 'readonly').objectStore('sessions').getAll();
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return all.find((s) => s.pendingValidation)?.pendingValidation?.candidateValue ?? null;
  });
  expect(stored, '후보값은 IDB에 보존된다').toBe('120.5');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.locator('[data-testid="tab-voice"]').click();
  await expect(popup(page), '팝업은 복구된다').toBeVisible({ timeout: 6000 });
  await expect(chip(page, '측정항목01'), '복구 후에도 후보값은 칩에 없다').not.toContainText('120.5');
  await expect(popup(page), '복구된 팝업엔 후보값이 있다').toContainText('120.5');
});

test('P5b-ⓓ [수정] 시트 프리필은 후보값 그대로 — 「숨김」이 「유실」이 아니다', async ({ page }) => {
  await bootMini(page);

  await commitManual(page, '측정항목01', ['1', '2', '0', '.', '5']);
  await expect(popup(page)).toBeVisible({ timeout: 6000 });

  await page.locator('[data-testid="anomaly-modify-btn"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible({ timeout: 4000 });
  // 사용자가 방금 넣은 값의 한 자리를 고치는 흐름이다 — 거절된 옛 값으로 되돌리면 방해다.
  await expect(page.locator('[data-testid="manual-keypad-display"]'), '프리필 = 후보값')
    .toContainText('120.5');
});
