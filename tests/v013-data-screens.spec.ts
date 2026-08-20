/**
 * v0.13.0 시각 검증 — 데이터탭 신규 모달 2종 402px 스크린샷(비단언, 레이아웃 확인용).
 *  (R5) 세션 상세 모달 — 인라인 확장 대신 넓은 센터 모달
 *  (R6) 내보내기 완료 팝업 — 작은 줄 배너 대신 큰 모달 + 공유/재다운로드
 * 실행: npx playwright test v013-data-screens (서버는 webServer가 5177로 자동 기동)
 */
import { test, expect, type Page } from '@playwright/test';

import { BASE } from './baseUrl';
test.use({ viewport: { width: 402, height: 874 } });

async function injectSession(page: Page) {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('IDB open blocked'));
    });
    const session = {
      id: 'sess_v013_shot',
      date: '2026-06-18',
      label: 'v0.13 UI 캡처',
      columns: [
        { id: 'c6', name: '조사나무', type: 'int',   input: 'auto',  ttsAnnounce: true,  auto: { kind: 'seq', from: 1, to: 3 } },
        { id: 'c8', name: '횡경',     type: 'float', input: 'voice', ttsAnnounce: true,  auto: { kind: 'fixed', value: '' }, decimals: 1 },
        { id: 'c9', name: '종경',     type: 'float', input: 'voice', ttsAnnounce: true,  auto: { kind: 'fixed', value: '' }, decimals: 1 },
      ],
      rows: [
        { index: 1, values: { c6: '1', c8: '35.1', c9: '38.5' }, complete: true },
        { index: 2, values: { c6: '2', c8: '36.2', c9: '39.2' }, complete: true },
        { index: 3, values: { c6: '3', c8: '37.3', c9: '40.1' }, complete: true },
      ],
      completedRows: 3,
      syncedRows: 0,
      startedAt: Date.now() - 120_000,
      finishedAt: Date.now() - 60_000,
    };
    await new Promise<void>((res, rej) => {
      const tx = db.transaction('sessions', 'readwrite');
      const req = tx.objectStore('sessions').put(session);
      req.onsuccess = () => res();
      req.onerror = () => rej(req.error);
    });
    db.close();
  });
}

async function bootDataTab(page: Page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await injectSession(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await page.locator('[data-testid="tab-data"]').click();
  await page.waitForTimeout(400);
}

test('[시각] R5 세션 상세 모달', async ({ page }) => {
  await bootDataTab(page);
  await page.locator('text=v0.13 UI 캡처').first().click();
  await expect(page.locator('[data-testid="session-detail-modal"]')).toBeVisible({ timeout: 3000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/v013-session-detail-modal.png' });
});

test('[시각] R6 내보내기 완료 팝업', async ({ page }) => {
  await bootDataTab(page);
  // 내보내기 → 모달에서 세션 선택 → CSV. 단일 세션이면 .csv, 완료 팝업이 떠야 한다.
  await page.locator('text=내보내기').first().click();
  await page.waitForTimeout(300);
  // ExportModal에서 세션 전체 선택 후 CSV 내보내기 트리거(버튼 텍스트는 앱 구현에 따름).
  const csvBtn = page.locator('button', { hasText: 'CSV' }).first();
  if (await csvBtn.isVisible().catch(() => false)) {
    await csvBtn.click();
  }
  // 완료 팝업: "내보내기 완료" 헤더
  const done = page.locator('text=내보내기 완료');
  await expect(done).toBeVisible({ timeout: 3000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/v013-export-done-modal.png' });
});
