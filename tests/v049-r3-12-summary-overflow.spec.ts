/**
 * v0.49 r3 #12 오라클 — **설정 요약 팝업이 넘쳐도 출구를 잃지 않는다**(claude r2 LOW).
 *
 * 카드는 `maxHeight: 84vh`인데 넘침 처리가 **없었다**. 컬럼이 많은 스키마에서는 내용이 그냥
 * 잘리고(사용자가 볼 방법이 없다), 하단 [닫기]는 카드 밖으로 밀린다.
 *
 * ⚠️ **실측이 리뷰의 두 수치를 갈랐다**(375×812, 수정 전):
 *   · 기본 스키마 — 카드 502px · 예산 682px · **넘침 0px**(여유 180px). 리뷰가 말한
 *     「~1px 초과 잔존」은 현행 기본 스키마에서 **재현되지 않는다**(gap 회수분 계산과 무관하게
 *     지금은 남는다). 그래서 gap 값은 건드리지 않았다.
 *   · 측정 컬럼 12개 — 카드 682px = **예산 상한**, `scrollHeight - clientHeight = 4px`.
 *     즉 넘침은 실재하고, 넘친 만큼은 그대로 잘린다. 리뷰의 「overflow 없음」이 이쪽이다.
 *
 * 처방은 **본문에만** 스크롤 컨테이너를 주는 것(`minHeight:0` + `overflowY:auto`)이다 —
 * 헤더(×)와 하단 [닫기]는 고정으로 남고, 넘친 내용은 스크롤로 도달한다. 「무스크롤」 계약은
 * 그대로다: 기본 스키마에서는 넘치지 않아 스크롤바가 서지 않는다(①이 그 축을 잠근다).
 *
 * 반증(`minHeight:0`+`overflowY` 제거 시): ②의 「본문이 스크롤 가능」이 red.
 */

import { test, expect, type Page } from '@playwright/test';
import { BASE } from './baseUrl';

test.setTimeout(60_000);

const STORE_KEY = 'agri-voicenote-settings-v3';
const PHONE_375 = { width: 375, height: 812 };

function settingsWith(voiceCols: number, farm: string) {
  const cols: unknown[] = [
    { id: 'c1', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
    { id: 'c3', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: farm }, sampleKey: true },
    { id: 'c4', name: '라벨', type: 'options', input: 'auto', ttsAnnounce: false, auto: { kind: 'options', available: ['A'], selected: ['A'] }, sampleKey: true },
  ];
  for (let i = 0; i < voiceCols; i++) {
    cols.push({ id: `v${i}`, name: `측정항목${i}`, type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false });
  }
  return {
    state: {
      googleConnected: false, userEmail: null,
      sheetUrl: 'https://docs.google.com/spreadsheets/d/S1/edit', sheetTab: 'Sheet1',
      columnsSheetId: 'S1', columnsSheetTab: 'Sheet1',
      columns: cols, tableGenerated: true, totalRows: 2, roundDateColId: null,
    },
    version: 13,
  };
}

async function openSummary(page: Page, voiceCols: number, farm = '이원창') {
  await page.setViewportSize(PHONE_375);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ([k, v]) => { localStorage.clear(); localStorage.setItem(k as string, v as string); },
    [STORE_KEY, JSON.stringify(settingsWith(voiceCols, farm))],
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="tab-settings"]').click();
  await page.locator('[data-testid="settings-summary-shortcut"]').click({ timeout: 8000 });
  await expect(page.locator('[data-testid="settings-summary-card"]')).toBeVisible({ timeout: 4000 });
}

/** 카드·본문·[닫기]의 실측 기하. */
async function metrics(page: Page) {
  return page.evaluate(() => {
    const card = document.querySelector('[data-testid="settings-summary-card"]') as HTMLElement;
    const cr = card.getBoundingClientRect();
    // 본문 = 카드의 자식 중 스크롤 컨테이너 후보(헤더/푸터가 아닌 가운데 블록).
    const body = card.children[1] as HTMLElement;
    const btns = Array.from(card.querySelectorAll('button'));
    const close = btns[btns.length - 1] as HTMLElement;
    const br = close.getBoundingClientRect();
    return {
      cardH: Math.round(cr.height),
      budget: Math.round(window.innerHeight * 0.84),
      cardOverflow: card.scrollHeight - card.clientHeight,
      bodyOverflow: body.scrollHeight - body.clientHeight,
      bodyScrollable: getComputedStyle(body).overflowY === 'auto' || getComputedStyle(body).overflowY === 'scroll',
      closeInsideCard: br.bottom <= cr.bottom + 1 && br.top >= cr.top - 1,
      closeOnScreen: br.bottom <= window.innerHeight && br.top >= 0,
    };
  });
}

test('① 기본 스키마는 여전히 무스크롤이다 — 출구를 만든 대가로 스크롤바가 상시화되지 않는다', async ({ page }) => {
  await openSummary(page, 1);
  const m = await metrics(page);
  expect(m.cardH, `카드가 84vh 예산을 넘었다(${m.cardH} > ${m.budget})`).toBeLessThanOrEqual(m.budget);
  expect(m.bodyOverflow, '기본 스키마에서 본문이 넘쳤다 — 무스크롤 계약 위반').toBe(0);
  expect(m.closeInsideCard).toBe(true);
});

test('② 컬럼이 많아 넘치면 본문이 스크롤되고 [닫기]는 그대로 도달 가능하다', async ({ page }) => {
  await openSummary(page, 12, '아주아주긴농가이름주식회사연구소');
  const m = await metrics(page);
  expect(m.cardH, '카드는 예산 안에 머문다').toBeLessThanOrEqual(m.budget);
  // 🔴 넘침은 실재한다(실측 4px). 종전엔 그 넘침에 출구가 없어 그대로 잘렸다.
  expect(m.bodyScrollable, '본문에 넘침 출구(overflowY)가 없다 — 넘친 내용은 영영 못 본다').toBe(true);
  expect(m.bodyOverflow, '이 스키마가 실제로 넘치지 않으면 이 케이스는 공허하다').toBeGreaterThan(0);
  // 스크롤 컨테이너가 **본문에만** 있으므로 헤더·푸터는 고정이다.
  expect(m.cardOverflow, '카드 자체가 넘치면 헤더·푸터가 밀린다').toBe(0);
  expect(m.closeInsideCard, '[닫기]가 카드 밖으로 밀렸다').toBe(true);
  expect(m.closeOnScreen, '[닫기]가 화면 밖이다 — 팝업을 닫을 수 없다').toBe(true);
});
