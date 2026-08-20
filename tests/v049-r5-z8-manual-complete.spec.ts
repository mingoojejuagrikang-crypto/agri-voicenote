/**
 * 🔴🔴 v0.49 r5 Z8 오라클(claude #8) — **완료의 진실이 둘이라 행이 통째로 사라졌다.**
 *
 * 두 진실:
 *   · `dataStore.patchRowValues`(C4)는 값에서 `complete`를 **다시 계산**하고 `completedRows`도
 *     맞춘다 — 그래서 키패드 커밋 직후 IDB는 옳아 **보인다**.
 *   · `sessionStore.completedRows`는 `markRowComplete`(=`finalizeRowCompletion`)로만 는다.
 *     그런데 **비-awaiting 수동 커밋 분기**(v0.47.0 W1)는 *"진행 상태를 건드리지 않는다"* 는
 *     계약을 지키며 그 **내구성 부기까지** 함께 건너뛰었다.
 *
 * `persistSession`은 후자만 본다 — `rows`를 `completedRows` + `activeRow` + `skippedRows`
 * **셋에서만** 만든다. 그래서 다음 persist가 그 행을 어느 목록에도 못 넣고 **통째로 떨어뜨린다.**
 * IDB에서 사라지고, 시트에도 영영 올라가지 않는다(sync는 IDB 세션을 읽는다).
 *
 * 실측 재현(수정 전, 2026-08-14):
 *   1행 m1을 음성으로 → 커서를 그 셀에 둔 채(`'이전'` = cellWait) m2를 **키패드**로 채워 행 완성
 *   → IDB `{m1:35.1, m2:42.3, complete:true}`. 그 뒤 2행에서 값 하나를 커밋하자
 *   **1행이 IDB에서 통째로 사라졌다.** 끝 도달 안내도 「완료된 행은 1행」(실제 2행).
 *
 * 이 시나리오가 인위적이지 않은 이유: 현장에서 STT가 한 칸만 계속 못 알아들으면 사용자는 그
 * 칸만 키패드로 넣는다(08-08 실측 `manual_commit` 8건 중 4건이 비-awaiting 커밋이었다 — W1의 근거).
 *
 * 반증(`finalizeRowCompletion(row)` 제거 시): ①② red. ③은 대조군(부분 입력은 종전 경로가 지킨다).
 */

import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, ttsLog, waitForTtsIdle } from './fixtures/stt';

test.setTimeout(120_000);

const COLS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  { id: 'm2', name: '측정항목02', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];

const bootZ8 = (page: Page) => boot(page, PHONE_402, {
  settings: {
    ...AZ_SETTINGS,
    state: { ...AZ_SETTINGS.state, columns: COLS, totalRows: 2, sessionAutoLabel: 'r5-z8' },
  } as unknown as typeof AZ_SETTINGS,
  headers: ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02'],
  sheetRows: [[PREV_ROUND, '이원창', '1', '100.0', '']],
});

const chip = (page: Page, colName: string) =>
  page.locator(`[data-testid="column-chip"][data-col-name="${colName}"]`);

async function keypadCommit(page: Page, colName: string, keys: string[]) {
  await chip(page, colName).click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible({ timeout: 5000 });
  for (const k of keys) await page.locator(`[data-testid="manual-key-${k}"]`).click();
  await page.locator('[data-testid="manual-commit"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toHaveCount(0);
  await page.waitForTimeout(600);
}

/** IDB에 실제로 내구화된 행들 — **시트로 올라갈 것**을 잰다(화면 상태가 아니다). */
async function persistedRows(page: Page): Promise<{ i: number; c: boolean; v: Record<string, string> }[]> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((r) => {
      const q = indexedDB.open('agri-voicenote');
      q.onsuccess = () => r(q.result);
    });
    const all: { rows?: { index: number; complete: boolean; values: Record<string, string> }[] }[] =
      await new Promise((r) => {
        const tx = db.transaction('sessions', 'readonly');
        const g = tx.objectStore('sessions').getAll();
        g.onsuccess = () => r(g.result as never);
        g.onerror = () => r([]);
      });
    db.close();
    return (all.at(-1)?.rows ?? [])
      .sort((a, b) => a.index - b.index)
      .map((r) => ({ i: r.index, c: r.complete, v: r.values }));
  });
}

/** 1행을 「음성 한 칸 + 키패드 한 칸」으로 완성한다 — 완성 커밋이 **비-awaiting**이 되게 한다.
 *  (`'이전'`으로 커서를 채운 셀에 주차 = cellWait. 그 상태에서 다른 칸을 키패드로 채운다.) */
async function completeRow1ByKeypad(page: Page) {
  await fireStt(page, '삼십오 점 일', 1600); // 1행 m1 → m2로 전진
  await waitForTtsIdle(page);
  await fireStt(page, '이전', 1600);          // 항목 이동 → 값 있는 m1 착지 = cellWait
  await waitForTtsIdle(page);
  expect((await ttsLog(page)).at(-1), '전제: 셀 검토 대기 = 비-awaiting 커밋이 된다').toBe('측정항목01 기록값 35.1.');
  await keypadCommit(page, '측정항목02', ['4', '2', '.', '3']);
}

test('① 키패드로 완성한 행이 다음 persist에서 사라지지 않는다 (값 유실)', async ({ page }) => {
  await bootZ8(page);
  await completeRow1ByKeypad(page);

  const step1 = await persistedRows(page);
  expect(step1.find((r) => r.i === 1)?.v.m2, '전제: 1행이 값 둘로 내구화됐다').toBe('42.3');

  // 다음 persist를 유발한다 — 2행으로 이동해 값 하나를 커밋한다.
  await fireStt(page, '다음행', 1800);
  await waitForTtsIdle(page);
  await fireStt(page, '십일 점 일', 1800);
  await waitForTtsIdle(page);

  const row1 = (await persistedRows(page)).find((r) => r.i === 1);
  expect(
    row1,
    '키패드로 완성한 행이 IDB에서 **통째로 사라졌다** — 시트에도 영영 안 올라간다',
  ).toBeTruthy();
  expect(row1!.v.m1).toBe('35.1');
  expect(row1!.v.m2).toBe('42.3');
  expect(row1!.c, '살아남았지만 미완료로 굳었다 — sync는 완료 행만 올린다').toBe(true);
});

test('② 끝 도달 안내의 완료 행 수가 실제와 같다 (두 진실 수렴)', async ({ page }) => {
  await bootZ8(page);
  await completeRow1ByKeypad(page);

  await fireStt(page, '다음행', 1800);
  await waitForTtsIdle(page);
  await fireStt(page, '십일 점 일', 1800);
  await waitForTtsIdle(page);
  await fireStt(page, '이십이 점 이', 1800); // 2행 완료 → 끝 도달
  await waitForTtsIdle(page);

  const last = (await ttsLog(page)).at(-1) ?? '';
  expect(last, '전제: 끝 도달 안내가 나왔다').toContain('완료된 행은');
  expect(
    last,
    '「완료된 행은 N행」이 실제 완료 행 수와 다르다 — 화면 `X / N`도 같은 출처라 함께 틀린다',
  ).toContain('완료된 행은 2행');
  expect(last, '빈 행이 없는데 있다고 말한다').not.toContain('비어 있습니다');
});

test('③ 대조군 — 부분 입력 행의 내구화는 종전 경로 그대로(부기가 과하게 돌지 않는다)', async ({ page }) => {
  await bootZ8(page);
  await fireStt(page, '삼십오 점 일', 1600); // 1행 m1만 (미완료)
  await waitForTtsIdle(page);
  await keypadCommit(page, '측정항목01', ['9', '9', '.', '9']); // 같은 칸 덮어쓰기 — 여전히 미완료

  const rows = await persistedRows(page);
  const row1 = rows.find((r) => r.i === 1);
  expect(row1?.v.m1, '부분 입력이 내구화되지 않았다').toBe('99.9');
  expect(row1?.c, '미완료 행을 완료로 마킹했다 — 빈 측정값이 complete:true로 굳는다').toBe(false);
});
