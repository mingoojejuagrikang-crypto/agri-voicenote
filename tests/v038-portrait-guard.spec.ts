/**
 * v0.38.2 F2 — 가로 회전 안내 오버레이(fb-01 "세로모드 미고정").
 *
 * **무엇이 결함이었나:** `wakeLock.ts`의 `lockPortrait()`는 v0.22.0부터 있었고 `VoiceScreen`이 세션
 * 시작 시 호출해 왔다. 그런데 **iOS Safari는 `screen.orientation.lock`을 구현하지 않는다** — 즉
 * "잠갔다고 생각한 lock이 아무 일도 안 하고 있었다". 실제 방어는 CSS/미디어쿼리 오버레이가 한다.
 *
 * 🔴 **이 스펙의 존재 이유는 "오버레이가 뜬다"가 아니라 "떠도 세션이 안 죽는다"이다.**
 * 가로일 때 앱 트리를 조건부 렌더로 갈아치우면 `VoiceScreen`이 unmount되고 인식기·워치독·클립
 * 레코더가 통째로 teardown된다 — [STT-16]이 실기기 62초 사공백으로 겪은 그 실패다. 회전은 조사 중에
 * 수시로 일어나므로 그렇게 만들면 **탭 전환보다 더 자주 세션을 죽인다.**
 * 아래 마지막 단언(회전 왕복 후 발화가 그대로 커밋)이 그 회귀를 잡는 축이다.
 *
 * `(pointer: coarse)` 게이트가 필요해 이 파일은 터치 컨텍스트를 자체 지정한다(`test.use`).
 * 데스크탑(pointer: fine)에서는 가로여도 뜨지 않아야 한다 — 마지막 describe가 그걸 고정한다.
 *
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다(수동 기동 불필요, [ORCH-27])
 */
import { test, expect, type Page } from '@playwright/test';
import { fireStt, installVoiceMocks } from './fixtures/stt';
import { BASE } from './baseUrl';

test.setTimeout(120_000);

const STORE_KEY = 'agri-voicenote-settings-v3';
const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };

const SETTINGS = {
  state: {
    googleConnected: false,
    userEmail: null,
    sheet: null,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_PG_1/edit',
    sheetTab: 'Sheet1',
    columnsSheetId: 'SHEET_PG_1',
    columnsSheetTab: 'Sheet1',
    availableSheets: [],
    manualMode: false,
    columns: [
      { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 3 } },
      { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
      { id: 'c9', name: '종경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
    ],
    tableGenerated: true,
    totalRows: 3,
    ttsRate: 1.05,
    sessionLabelColId: null,
    sessionAutoLabel: 'portrait-guard',
    noisyMode: false,
    preferredVoiceName: '',
  },
  version: 12,
};

async function waitForActiveChip(page: Page, name: string) {
  await expect(
    page.locator(`[data-testid="column-chip"][data-col-name="${name}"][data-active="true"]`),
  ).toBeVisible({ timeout: 8000 });
}

async function startSession(page: Page) {
  await installVoiceMocks(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem('agri-voicenote-settings-v3', JSON.stringify(s));
    indexedDB.deleteDatabase('agri-voicenote');
  }, SETTINGS);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(200);
  const startBtn = page.locator('text=음성 입력 시작').first();
  await expect(startBtn).toBeVisible();
  await startBtn.click();
  await page.waitForTimeout(600);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
}

test.describe('[F2] 터치 기기 — 가로 회전 안내', () => {
  test.use({ viewport: PORTRAIT, hasTouch: true, isMobile: true });

  test('세로에선 안 뜨고, 가로로 돌리면 뜨고, 되돌리면 사라진다', async ({ page }) => {
    await installVoiceMocks(page);
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(({ s, k }) => {
      localStorage.clear();
      localStorage.setItem(k, JSON.stringify(s));
    }, { s: SETTINGS, k: STORE_KEY });
    await page.reload({ waitUntil: 'domcontentloaded' });

    const guard = page.locator('[data-testid="portrait-guard"]');
    await expect(guard).toHaveCount(0);

    await page.setViewportSize(LANDSCAPE);
    await expect(guard).toBeVisible({ timeout: 3000 });
    await expect(guard).toContainText('세로로 돌려주세요');

    await page.setViewportSize(PORTRAIT);
    await expect(guard).toHaveCount(0, { timeout: 3000 });
  });

  // 라운드A 리뷰 수렴 지적(Codex #4 · agy #1) — **시각적으로 덮는 것만으로는 부족하다.**
  // `position: fixed`로 가려도 보조공학(VoiceOver·스위치 제어) 포커스는 뒤쪽 앱을 그대로 훑고
  // **실행까지 된다.** 현장에서 잘못 눌린 버튼 하나가 조사를 망친다.
  test('가려진 앱이 보조공학·포커스에서도 격리된다(inert) — 그리고 세로 복귀 시 원복된다', async ({ page }) => {
    await installVoiceMocks(page);
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(({ s, k }) => {
      localStorage.clear();
      localStorage.setItem(k, JSON.stringify(s));
    }, { s: SETTINGS, k: STORE_KEY });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);

    const siblingState = () => page.evaluate(() => {
      const host = document.querySelector('[data-testid="portrait-guard"]');
      const parent = host?.parentElement ?? document.querySelector('#root')?.firstElementChild;
      if (!parent) return null;
      return Array.from(parent.children)
        .filter((c) => c !== host)
        .map((c) => ({ inert: (c as HTMLElement).inert === true, aria: c.getAttribute('aria-hidden') }));
    });

    // 세로: 아무것도 막혀 있지 않다.
    const before = await siblingState();
    expect(before?.every((s) => !s.inert && s.aria === null)).toBe(true);

    // 가로: 형제(앱 트리)가 전부 inert + aria-hidden.
    await page.setViewportSize(LANDSCAPE);
    await expect(page.locator('[data-testid="portrait-guard"]')).toBeVisible({ timeout: 3000 });
    const during = await siblingState();
    expect(during?.length).toBeGreaterThan(0);
    expect(during?.every((s) => s.inert && s.aria === 'true')).toBe(true);

    // 세로 복귀: 원복된다 — 격리가 남으면 앱 전체가 조작 불가로 굳는다(격리보다 더 나쁜 실패).
    await page.setViewportSize(PORTRAIT);
    await expect(page.locator('[data-testid="portrait-guard"]')).toHaveCount(0, { timeout: 3000 });
    const after = await siblingState();
    expect(after?.every((s) => !s.inert && s.aria === null)).toBe(true);
  });

  test('🔴 회전해도 세션이 죽지 않는다 — 왕복 후 발화가 그대로 커밋된다(오버레이 ≠ 언마운트)', async ({ page }) => {
    await startSession(page);
    await waitForActiveChip(page, '횡경');
    await fireStt(page, '35.1', 300);
    await waitForActiveChip(page, '종경');

    // 가로 회전 — 안내가 덮이지만 **아래 트리는 그대로 붙어 있어야 한다.**
    await page.setViewportSize(LANDSCAPE);
    await expect(page.locator('[data-testid="portrait-guard"]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeAttached();

    // 세로 복귀 — 안내가 사라지고 세션 UI가 ready로 리셋되지 않았다.
    await page.setViewportSize(PORTRAIT);
    await expect(page.locator('[data-testid="portrait-guard"]')).toHaveCount(0, { timeout: 3000 });
    await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });

    // 핵심: 아무 조작 없이 다음 발화가 커밋된다 = 인식기가 회전을 관통해 살아남았다.
    // (조건부 언마운트로 구현하면 여기서 무반응이 되어 실패한다 — [STT-16]과 같은 실패 모드.)
    await fireStt(page, '28.3', 600);
    await waitForActiveChip(page, '횡경'); // 행 1 완료 → 행 2 첫 음성 컬럼으로 전진
  });
});

test.describe('[F2] 데스크탑 — 가로여도 안내를 띄우지 않는다', () => {
  test.use({ viewport: { width: 1280, height: 720 }, hasTouch: false, isMobile: false });

  test('pointer:fine 환경은 게이트에 걸리지 않는다(개발·테스트 화면을 가리지 않는다)', async ({ page }) => {
    await installVoiceMocks(page);
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(({ s, k }) => {
      localStorage.clear();
      localStorage.setItem(k, JSON.stringify(s));
    }, { s: SETTINGS, k: STORE_KEY });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid="portrait-guard"]')).toHaveCount(0);
  });
});
