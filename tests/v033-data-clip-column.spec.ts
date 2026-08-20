/**
 * v0.33.0 #9 (Vance) — 데이터탭 값/클립 컬럼 분리 + 완료/작성중 구분 (07-10 QA P1 #4).
 *
 *   배경: 값 셀 안에 클립 재생 버튼(28px)이 붙어 있어 값을 탭하려다 클립을 오터치(민구 실사용 제보).
 *   변경: ① 클립이 있는 voice 컬럼 오른쪽에 44px 클립 전용 컬럼(ClipCell) — EditableCell은 값 전용.
 *         클립 없는 세션/컬럼엔 클립 컬럼이 아예 안 생긴다.
 *        ② (폐기: v0.44.0 §C7 F24, 민구 08-02) '작성중 N' 배지 → 행수 `완료/전체행` 통합.
 *          #9-4는 F24 계약으로 갱신됐다 — 배지 부재 + `N/M행` 표기.
 *
 * 402×874(iphone17 대리) 시뮬레이션. 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다(수동 기동 불필요, [ORCH-27]).
 */
import { test, expect, type Page } from '@playwright/test';

import { BASE } from './baseUrl';
test.use({ viewport: { width: 402, height: 874 } });

const COLUMNS = [
  { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 3 } },
  { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
  { id: 'c9', name: '종경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
];

/** 세션 2개 시드:
 *  - sess_v033_clip  — 전 행 완료 + c8 클립 2개(c9는 voice지만 클립 없음 → 컬럼 없어야 함)
 *  - sess_v033_draft — 완료 1행 + 미완료(부분입력) 1행, 클립 없음 → `1/2행` 표기 + 클립 컬럼 없음 */
async function injectSessions(page: Page) {
  await page.evaluate(async (columns) => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('IDB open blocked'));
    });
    const clipSession = {
      id: 'sess_v033_clip',
      date: '2026-07-11',
      label: 'v033 클립세션',
      columns,
      rows: [
        { index: 1, values: { c6: '1', c8: '35.1', c9: '38.5' }, complete: true, audioClips: { c8: 'sess_v033_clip:1:c8' } },
        { index: 2, values: { c6: '2', c8: '36.2', c9: '39.2' }, complete: true, audioClips: { c8: 'sess_v033_clip:2:c8' } },
      ],
      completedRows: 2,
      syncedRows: 0,
      startedAt: Date.now() - 240_000,
      finishedAt: Date.now() - 180_000,
    };
    const draftSession = {
      id: 'sess_v033_draft',
      date: '2026-07-12',
      label: 'v033 부분입력세션',
      columns,
      rows: [
        { index: 1, values: { c6: '1', c8: '31.0', c9: '33.3' }, complete: true },
        { index: 2, values: { c6: '2', c8: '1.0' }, complete: false }, // 부분입력(미완료 행)
      ],
      completedRows: 1,
      syncedRows: 0,
      startedAt: Date.now() - 120_000,
      finishedAt: Date.now() - 60_000,
    };
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(['sessions', 'audioClips'], 'readwrite');
      tx.objectStore('sessions').put(clipSession);
      tx.objectStore('sessions').put(draftSession);
      // 재생 버튼 클릭 무해성 확인용 최소 WAV 헤더 바이트(실디코딩은 불필요 — 실패해도 advance).
      tx.objectStore('audioClips').put(new Blob([new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0])], { type: 'audio/wav' }), 'sess_v033_clip:1:c8');
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, COLUMNS);
}

async function bootDataTab(page: Page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await injectSessions(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await page.locator('[data-testid="tab-data"]').click();
  await page.waitForTimeout(400);
}

async function openClipSessionDetail(page: Page) {
  await page.locator('text=v033 클립세션').first().click();
  await expect(page.locator('[data-testid="session-detail-modal"]')).toBeVisible({ timeout: 3000 });
  await page.waitForTimeout(300);
}

test('#9-1 클립 컬럼 분리 — 클립 있는 voice 컬럼에만 44px 전용 컬럼, 값 셀엔 재생 버튼 없음', async ({ page }) => {
  await bootDataTab(page);
  await openClipSessionDetail(page);
  const modal = page.locator('[data-testid="session-detail-modal"]');

  // 헤더: c8(클립 있음)에만 클립 컬럼. c9는 voice지만 클립이 없어 컬럼 자체가 없다.
  await expect(modal.locator('[data-testid="clip-col-header-c8"]')).toBeVisible();
  await expect(modal.locator('[data-testid="clip-col-header-c9"]')).toHaveCount(0);
  await expect(modal.locator('[data-testid="clip-col-header-c6"]')).toHaveCount(0);
  console.log('✓ 클립 컬럼은 클립 있는 voice 컬럼(c8)에만');

  // 클립 셀 2행 + 재생 버튼 2개(각 행 c8), 값 셀 내부에는 버튼이 중첩되지 않는다.
  await expect(modal.locator('[data-testid="clip-cell"]')).toHaveCount(2);
  const clipButtons = modal.locator('[data-testid="clip-cell-button"]');
  await expect(clipButtons).toHaveCount(2);
  await expect(clipButtons.first()).toHaveAttribute('aria-label', '음성 재생: 35.1');
  const nestedInValueCell = await modal.locator('button:has(button)').count();
  expect(nestedInValueCell).toBe(0);
  console.log('✓ 재생 버튼은 전용 셀에만(값 버튼 내 중첩 0)');
});

test('#9-2 클립 버튼 터치 타깃 ≥44×44 + 재생 탭 무해(값 편집 미발동)', async ({ page }) => {
  await bootDataTab(page);
  await openClipSessionDetail(page);
  const modal = page.locator('[data-testid="session-detail-modal"]');

  const btn = modal.locator('[data-testid="clip-cell-button"]').first();
  const box = await btn.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  console.log(`✓ 클립 버튼 ${box!.width}×${box!.height} ≥ 44×44`);

  // 클립 버튼 탭 → 편집 input이 열리면 안 된다(재생 전용). 페이지 에러도 0.
  const pageErrors: Error[] = [];
  page.on('pageerror', (e) => pageErrors.push(e));
  await btn.click();
  await page.waitForTimeout(500);
  await expect(modal.locator('input')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
  console.log('✓ 클립 탭=재생 전용(편집 미발동, 에러 0)');
});

test('#9-3 값 셀 탭 = 편집만 — 재생 시작 없이 input이 열린다', async ({ page }) => {
  await bootDataTab(page);
  await openClipSessionDetail(page);
  const modal = page.locator('[data-testid="session-detail-modal"]');

  // 클립이 귀속된 c8 값 셀(35.1)을 탭 → 편집 input만 열리고 재생('정지' 상태 버튼)은 없다.
  await modal.locator('button', { hasText: '35.1' }).first().click();
  await page.waitForTimeout(300);
  const input = modal.locator('input');
  await expect(input).toHaveCount(1);
  await expect(input).toHaveValue('35.1');
  await expect(modal.locator('button[title="정지"]')).toHaveCount(0);
  console.log('✓ 값 셀 탭 → 편집만(재생 미발동)');

  // Escape로 편집 취소 — 값 불변.
  await input.press('Escape');
  await page.waitForTimeout(200);
  await expect(modal.locator('input')).toHaveCount(0);
  await expect(modal.locator('button', { hasText: '35.1' }).first()).toBeVisible();
  console.log('✓ Escape 취소 후 값 보존');
});

test('#9-4 (F24로 갱신) 행수 통합 — 배지 없이 `완료/전체행` 표기', async ({ page }) => {
  await bootDataTab(page);

  // v0.44.0 §C7 F24(민구 08-02) — '작성중 N' 배지 폐기: 문자열·testid 모두 부재.
  await expect(page.getByText('작성중')).toHaveCount(0);
  await expect(page.locator('[data-testid="draft-badge"]')).toHaveCount(0);

  // 부분입력 세션(완료 1/전체 2)은 `1/2행`, 전 행 완료 세션은 `2/2행`.
  const draftCard = page.locator('button', { hasText: 'v033 부분입력세션' });
  await expect(draftCard).toContainText(/1\/2\s*행/);
  const cleanCard = page.locator('button', { hasText: 'v033 클립세션' });
  await expect(cleanCard).toContainText(/2\/2\s*행/);
  console.log('✓ F24 — 배지 부재 + 완료/전체행 통합 표기');
});

test('#9-5 402×874 — 클립 컬럼 추가/배지 표시에도 가로 오버플로 0', async ({ page }) => {
  await bootDataTab(page);

  // 카드 리스트(행수 통합 `N/M행` 표기 포함) 화면: 문서 가로 스크롤 없음.
  const listSw = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  expect(listSw.sw).toBeLessThanOrEqual(listSw.cw + 1);
  console.log(`✓ 카드 리스트 가로 오버플로 0 (sw=${listSw.sw} cw=${listSw.cw})`);

  // 상세 모달(클립 컬럼 포함): 표는 내부 스크롤, 모달 상자 자체는 잘림 없음.
  await openClipSessionDetail(page);
  const modalBox = page.locator('[data-testid="session-detail-modal"]');
  const clip = await modalBox.evaluate((el) => ({
    sw: (el as HTMLElement).scrollWidth,
    cw: (el as HTMLElement).clientWidth,
  }));
  expect(clip.sw).toBeLessThanOrEqual(clip.cw + 1);
  const docSw = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(docSw).toBeLessThanOrEqual(402);
  console.log(`✓ 상세 모달 가로 오버플로 0 (modal sw=${clip.sw} cw=${clip.cw}, doc sw=${docSw})`);
});
