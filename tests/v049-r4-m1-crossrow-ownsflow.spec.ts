/**
 * 🔴 v0.49 r4 M1 오라클(claude r3 #2 · Larry 소스 확증) — **행 검토 대기는 남의 행을 소유하지 않는다.**
 *
 * `commitManualValue`의 `ownsFlow`는 형제 분기에 `row === row && colId === colId`를 요구하면서
 * `awaiting.kind === 'reviewWait'` 하나만 **좌표를 아예 보지 않았다.** 그래서 **다른 행**에 대한
 * 수동 커밋이 검토 대기의 흐름을 소유했다.
 *
 * 도달로는 셀 저장 실패 배너의 [다시 저장]이다 — `cellPersistError`가 **실패 시점의 좌표**를 들고
 * 있다가 `commitManualValue(p.row, …)`를 재실행하는데, 그 사이 사용자가 '이전행'으로 완료 행에
 * 들어가 있으면 두 좌표가 갈린다(현장에서 흔한 순서다: 저장이 안 됐다는 안내를 듣고, 앞 행을
 * 확인해 본 뒤, 배너를 누른다).
 *
 * 피해는 **값 소실**이다. 보류(hold) 경로는 공유 코어(`persistCellValue`)를 쓰지 않고
 * `persistSession(pendingValidation, true)`로 세션을 통째로 다시 조립하는데, 그 조립은
 * `completedRows`(+정정 백업·activeRow·skipped)만 rows에 싣는다. 재시도 대상 행이 그 어느 집합에도
 * 없으면 **이미 IDB에 있던 그 행이 통째로 빠진다** — 값뿐 아니라 `sheetRow`/`syncState`까지 사라져
 * 다음 sync가 같은 행을 중복 append한다.
 *
 * ⚠️ 관측점은 칩/TTS가 **아니다**(A2 오라클이 그래서 결함을 놓쳤다 — r3-01 헤더 참조).
 * **IDB 영속 rows · 리로드 생존 · 보류 팝업 여부**를 잰다.
 *
 * ③은 **대조군**이다: 컬럼 축은 일부러 가드하지 않았다(`reviewWait`은 행 스코프 문맥 —
 * 사용자는 그 행의 아무 칩이나 눌러 고친다). ③이 red면 수정이 과했다는 뜻이다.
 *
 * 반증(수정 제거 시): ①은 2행이 IDB에서 사라져 red, ②는 보류 버튼이 떠서 red.
 * ⚠️ 왕복 OFF([TEAMOPS-81]) — 칩을 클릭한다.
 */

import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, waitForTtsIdle } from './fixtures/stt';

test.setTimeout(120_000);

/** m1·m3 = `trendRule:'increase'`(직전 100.0) → 130.5가 위반값, 95.5/77.7은 감소라 무알람. */
const MINI_COLUMNS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'increase' },
  { id: 'm2', name: '측정항목02', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  { id: 'm3', name: '측정항목03', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'increase' },
];
const MINI_SETTINGS = {
  ...AZ_SETTINGS,
  state: { ...AZ_SETTINGS.state, columns: MINI_COLUMNS, totalRows: 2, sessionAutoLabel: 'r4-m1' },
};
const MINI_HEADERS = ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02', '측정항목03'];
const MINI_ROWS = [
  [PREV_ROUND, '이원창', '1', '100.0', '', '100.0'],
  [PREV_ROUND, '이원창', '2', '100.0', '', '100.0'],
];

/** 영속된 세션의 rows — **IDB에서 직접** 읽는다(메모리 dataStore가 아니라 재시작 후 남을 것). */
async function persistedRows(page: Page) {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const sessions: Array<{
      startedAt: number;
      completedRows: number;
      rows: Array<{ index: number; complete: boolean; values: Record<string, string> }>;
    }> = await new Promise((resolve, reject) => {
      const req = db.transaction('sessions', 'readonly').objectStore('sessions').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    const latest = sessions.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0];
    return latest ? { completedRows: latest.completedRows, rows: latest.rows } : null;
  });
}

const chip = (page: Page, colName: string) =>
  page.locator(`[data-testid="column-chip"][data-col-name="${colName}"]`);

/** 칩 탭 → 키패드 커밋. */
async function commitManual(page: Page, colName: string, keys: string[]) {
  await chip(page, colName).click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible();
  for (const k of keys) await page.locator(`[data-testid="manual-key-${k}"]`).click();
  await page.locator('[data-testid="manual-commit"]').click();
  await page.waitForTimeout(900);
}

async function setFailPut(page: Page, on: boolean) {
  await page.evaluate((v) => {
    (window as unknown as { __survey011FailSessionPut?: boolean }).__survey011FailSessionPut = v;
  }, on);
}

/** 1행 완주 → 세션 내구화(= saveSession 경로가 열린다) · 2행 m1 커밋 → 2행도 IDB에 선다. */
async function bootAndSeed(page: Page) {
  await boot(page, PHONE_402, {
    settings: MINI_SETTINGS as unknown as typeof AZ_SETTINGS,
    headers: MINI_HEADERS,
    sheetRows: MINI_ROWS,
  });
  await fireStt(page, '95.5', 900);
  await fireStt(page, '88.8', 900);
  await fireStt(page, '77.7', 1500);
  await waitForTtsIdle(page);
  await fireStt(page, '95.5', 1200); // 2행 m1
  await waitForTtsIdle(page);
  await expect
    .poll(async () => (await persistedRows(page))?.rows.length, { timeout: 8000 })
    .toBe(2);
  const seeded = await persistedRows(page);
  expect(seeded?.rows.find((r) => r.index === 1)?.complete, '전제: 1행 완료·영속').toBe(true);
  expect(seeded?.rows.find((r) => r.index === 2)?.values.m1, '전제: 2행 부분값 영속').toBe('95.5');
}

/** 2행 m3(= awaiting 셀이 아닌 칸)에 위반값을 넣고 durable을 실패시켜 재시도 배너를 세운다. */
async function armRetryBannerOnRow2(page: Page) {
  await setFailPut(page, true);
  await commitManual(page, '측정항목03', ['1', '3', '0', '.', '5']);
  await expect(page.locator('[data-testid="cell-persist-retry-btn"]'), '셀 저장 실패 배너')
    .toBeVisible({ timeout: 6000 });
  const before = await persistedRows(page);
  expect(before?.rows.find((r) => r.index === 2)?.values.m3 ?? '', '전제: 실패했으므로 IDB엔 미반영').toBe('');
  await setFailPut(page, false);
}

test('① 🔴 다른 행 저장 재시도가 그 행을 IDB에서 지우지 않는다 — 검토 대기는 남의 행을 소유하지 않는다', async ({ page }) => {
  await bootAndSeed(page);
  await armRetryBannerOnRow2(page);

  // 배너를 누르기 전에 완료 행으로 들어간다 — 여기서 reviewWait(1행)이 선다.
  await fireStt(page, '이전행', 1500);
  await waitForTtsIdle(page);

  await page.locator('[data-testid="cell-persist-retry-btn"]').click();
  // ⚠️ 여기서 배너 해소를 먼저 기다리지 않는다 — 결함 상태에서는 배너가 **영원히** 남아
  //   (보류 경로가 공유 코어를 안 타므로 `clearIfMatches`가 안 돈다) 그 대기가 먼저 터지면
  //   정작 재려던 값 소실이 관측되지 않는다. 값부터 잰다.
  await page.waitForTimeout(2500);

  const after = await persistedRows(page);
  expect(after?.rows.map((r) => r.index), '2행이 rows에서 사라지면 값 소실이다').toEqual([1, 2]);
  expect(after?.rows.find((r) => r.index === 2)?.values.m1, '2행의 기존 값이 살아 있다').toBe('95.5');
  expect(after?.rows.find((r) => r.index === 2)?.values.m3, '재시도한 값이 내구화됐다').toBe('130.5');
  expect(after?.rows.find((r) => r.index === 1)?.complete, '1행 완료 부기는 그대로').toBe(true);
  expect(after?.completedRows, '완료 행 수 불변').toBe(1);
  // 공유 코어(`persistCellValue`)를 탔다는 것의 표식 — durable 성공이 실패 배너를 내린다.
  await expect(page.locator('[data-testid="cell-persist-retry-btn"]'), 'durable 성공이 배너를 내린다')
    .toHaveCount(0, { timeout: 6000 });

  // 리로드 생존 — 메모리가 아니라 IDB가 답이라는 것의 확인.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const reloaded = await persistedRows(page);
  expect(reloaded?.rows.find((r) => r.index === 2)?.values.m3, '리로드 후에도 남는다').toBe('130.5');
});

test('② 다른 행 커밋은 **보류 팝업**을 세우지 않는다 — 흐름 소유가 없으면 정보성 알람이다', async ({ page }) => {
  await bootAndSeed(page);
  await armRetryBannerOnRow2(page);
  await fireStt(page, '이전행', 1500);
  await waitForTtsIdle(page);

  await page.locator('[data-testid="cell-persist-retry-btn"]').click();
  await expect(page.locator('[data-testid="anomaly-alert"]'), '위반값이므로 알람 자체는 뜬다')
    .toBeVisible({ timeout: 6000 });
  // 보류는 「이 커밋이 진행을 소유한다」의 표식이다 — 남의 행 커밋에는 서면 안 된다.
  await expect(page.locator('[data-testid="anomaly-confirm-btn"]'), '남의 행 커밋에 [확인] 보류 버튼 금지')
    .toHaveCount(0);
});

test('③ 대조군 — 검토 중인 **그 행**의 다른 컬럼 커밋은 여전히 흐름을 소유한다(컬럼 미가드 계약)', async ({ page }) => {
  await bootAndSeed(page);
  // 1행으로 들어가 행 검토 대기(포인터=측정항목01)를 세운다.
  await fireStt(page, '이전행', 1500);
  await waitForTtsIdle(page);

  // 포인터가 아닌 컬럼(측정항목03)을 위반값으로 재커밋 — 같은 행이므로 소유가 성립한다.
  await commitManual(page, '측정항목03', ['1', '3', '0', '.', '5']);
  await expect(page.locator('[data-testid="anomaly-confirm-btn"]'), '검토 중인 행의 정정은 보류로 받는다')
    .toBeVisible({ timeout: 6000 });
});
