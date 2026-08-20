/**
 * v0.47.0 W4(FB-E, 민구 확정 08-08) — **✓ 마크 세션 유지** 오라클.
 *
 * 민구 확정: ✓ 대상 = 성공 입력 전부(수동 포함 — v0.45.0 UI③ "음성만" 대체).
 * ✓ 의미 = "이 칸은 채워졌다". 성공 입력으로 덮으면 유지, 값 삭제(비움) 시 회수.
 * 종전 구조: VOICE_COMMIT_MARK_MS=1500 플래시 + 행 전환 즉시 회수(C13) — 최신 1건만 담는
 * valueBurst라 구조적으로 유지 불가 → 세션 영속 (row,colId) 집합(useSessionCommitMarks) 신설.
 *
 * 재는 축:
 *  ① 커밋 ✓가 1.5초 플래시 창 밖에서도 유지 + 여러 셀에 **누적**(종전엔 최신 1건 플래시뿐).
 *  ② 행 전환 → 새 행 ✓ 0 — 마크 이식 없음(C13 가드와 구조 공존: 집합 키가 (row,colId)).
 *  ③ 이전 행 복귀(검토 대기) → ✓ **복원** — FB-E("행 전환 즉시 회수")의 해소 본축.
 *  ④ 수정(직접값)으로 덮어쓰기 → ✓ 유지 · cascade 수정이 셀을 비우면 ✓ 회수 → 재커밋 시 복원.
 *
 * 수동 커밋 ✓는 v035-hero-confirm.spec.ts(UI③→W4 정당 파손 갱신)가 잰다 — 여기서 중복 안 잰다.
 * ⚠️ 왕복 OFF(chipSweepSeconds: 0) — 칩 클릭 데드락 규율([TEAMOPS-81]).
 */

import { test, expect, type Page } from '@playwright/test';
import { BASE } from './baseUrl';
import { stubSheets } from './fixtures/activeZones';
import { installVoiceMocks, fireStt } from './fixtures/stt';
import { GUM_GRANT_SCRIPT } from './fixtures/gum';

test.setTimeout(120_000);

const STORE_KEY = 'agri-voicenote-settings-v3';
const PHONE_402 = { width: 402, height: 874 };

// 추세/이상치 규칙 없는 음성 float 2컬럼(당도=행 중간, 산도=행 마지막) × 2행 — v035 하네스와 동형.
const COLUMNS = [
  { id: 'c1', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'c2', name: '당도', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  { id: 'c3', name: '산도', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];

const SETTINGS = {
  state: {
    chipSweepSeconds: 0, // 🔴 [TEAMOPS-81]
    googleConnected: true,
    userEmail: 'tester@example.com',
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_W4_MARK/edit',
    sheetTab: 'Sheet1',
    columnsSheetId: 'SHEET_W4_MARK',
    columnsSheetTab: 'Sheet1',
    columns: COLUMNS,
    tableGenerated: true,
    totalRows: 2,
    ttsRate: 1.05,
    recognitionTolerance: 0.6,
    sessionLabelColId: null,
    sessionAutoLabel: 'w4-mark-session',
    preferredVoiceName: '',
  },
  version: 12,
};

const markIn = (page: Page, colName: string) =>
  page.locator(`[data-testid="column-chip"][data-col-name="${colName}"] [data-testid="chip-commit-mark"]`);
const allMarks = (page: Page) => page.locator('[data-testid="chip-commit-mark"]');

async function boot(page: Page) {
  await page.setViewportSize(PHONE_402);
  await stubSheets(page);
  await installVoiceMocks(page);
  await page.addInitScript(GUM_GRANT_SCRIPT);
  await page.addInitScript(() => {
    (window as unknown as { __micSettleSkipForTest?: boolean }).__micSettleSkipForTest = true;
  });
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
  const startBtn = page.locator('text=음성 입력 시작').first();
  await expect(startBtn).toBeVisible();
  await startBtn.click();
  await page.waitForTimeout(800);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
}

test('W4-①②③④ — ✓ 누적·행 전환 무이식·이전 행 복귀 시 복원·수정 덮어쓰기 유지', async ({ page }) => {
  await boot(page);

  // ① 당도 커밋 → ✓. 플래시 창(1.5초) 밖에서도 유지.
  await fireStt(page, '30.7', 400);
  await expect(markIn(page, '당도'), '당도 ✓').toBeVisible({ timeout: 2000 });
  await page.waitForTimeout(2000); // > VOICE_COMMIT_MARK_MS
  await expect(markIn(page, '당도'), '플래시 창 밖에서도 유지(세션 영속)').toBeVisible();

  // ① 산도(행 마지막) 커밋 — 누적 확인은 ③의 복귀 화면에서(마지막 커밋은 행 전환을 동반한다).
  await fireStt(page, '22.2', 800);

  // ② 행 전환(2행 착지) — 새 행 칩에 ✓가 이식되지 않는다.
  await page.waitForFunction(() => {
    const m = document.body.innerText.match(/(\d+)\s*\/\s*\d+\s*행/);
    return m && parseInt(m[1]) === 2;
  }, { timeout: 6000 });
  await expect(allMarks(page), '새 행 ✓ 0 (이식 없음)').toHaveCount(0);

  // ③ '이전' → 1행 검토 대기 — 이 세션에서 커밋한 두 셀의 ✓가 **복원**된다(FB-E 본축).
  await fireStt(page, '이전행', 800);
  await expect(markIn(page, '당도'), '복귀 시 당도 ✓ 복원').toBeVisible({ timeout: 3000 });
  await expect(markIn(page, '산도'), '복귀 시 산도 ✓ 복원').toBeVisible();
  await expect(allMarks(page), '커밋된 두 셀 전부 ✓(누적)').toHaveCount(2);

  // ④ 검토 대기에서 직접 수정("수정 31.5" → 포인터=첫 음성 필드 당도) — 덮어쓰기도 성공 입력, ✓ 유지.
  await fireStt(page, '수정 31.5', 800);
  await expect(page.locator('[data-testid="column-chip"][data-col-name="당도"]')).toContainText('31.5');
  await expect(markIn(page, '당도'), '수정 덮어쓰기 후에도 ✓ 유지').toBeVisible();
  await expect(allMarks(page)).toHaveCount(2);
});

test('W4-④ — cascade 수정이 셀을 비우면 ✓ 회수, 재커밋하면 복원(값 삭제 = 회수 계약)', async ({ page }) => {
  await boot(page);

  // 당도 커밋 → ✓ 1.
  await fireStt(page, '30.7', 400);
  await expect(markIn(page, '당도'), '당도 ✓').toBeVisible({ timeout: 2000 });

  // 산도 대기 중 bare "수정" → 직전 컬럼(당도)부터 행 끝까지 cascade 비움 → 당도 값·✓ 함께 회수.
  await fireStt(page, '수정', 800);
  await expect(allMarks(page), '셀이 비면 ✓도 회수').toHaveCount(0);

  // 재커밋 → ✓ 복원.
  await fireStt(page, '29.9', 500);
  await expect(markIn(page, '당도'), '재커밋 시 ✓ 복원').toBeVisible({ timeout: 2000 });
});
