/**
 * 🔴 v0.49 r4 M2 오라클(claude r3 #1 · Larry 소스 확증) — **끝 도달은 완료된 행에서만 무장한다.**
 *
 * `advance()`의 마지막 두 스캔은 **둘 다 아래만 본다**: 전진 스캔은 포인터 **뒤** 칸만 보고
 * (`useVoiceSession.ts` :1160 자기 주석), `findNextIncompleteRow`는 `row + 1`부터 본다.
 * 그래서 포인터 **앞**에 빈 칸이 남은 행 — 항목 이동('다음')으로 빈 칸을 지나쳐 뒤 칸을 채운
 * 경우 — 에서 아래에 미완료 행이 없으면, **미완료 행에 선 채로** 끝 도달이 선언됐다.
 *
 * 그 상태의 atEnd 센티넬은 `{row: 미완료 activeRow, colId: 마지막 음성 컬럼}`이고 r3 #2가 커서까지
 * 거기 주차하므로, **화면과 센티넬이 일치한 채로 함께 틀린다.** 피해 둘:
 *   ⓐ bare 값이 atEnd 가드에 **흡수**돼 남은 빈 칸이 영영 안 채워진다(행이 완료되지 않는다).
 *   ⓑ bare '수정'은 `reviewTarget`이 서지 않아(:2382가 atEnd 제외) 행 스코프로 지우는데, 그
 *      타깃이 채워야 할 빈 칸이 아니라 **확정된 마지막 셀**이다 — 남은 일을 가리키는 대신
 *      끝낸 일을 지운다.
 *
 * 처방은 컬럼 축이 아니라 **도달 자체**다(반대 방향은 [MODIFY-TARGET-1] 재발 — r3-02 헤더 참조).
 * 미완료면 남은 빈 칸으로 커서를 되돌린다.
 *
 * ③은 **과수정 방지 대조군**이다: 순서대로 채워 완료된 행의 끝 도달은 한 바이트도 바뀌지 않는다.
 *
 * 반증(수정 제거 시): ①은 끝 도달 안내가 나가 red, ②는 값이 흡수돼 IDB 행이 미완료로 남아 red.
 */

import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, ttsLog, waitForTtsIdle } from './fixtures/stt';

test.setTimeout(120_000);

const MINI_COLUMNS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 1 }, sampleKey: true },
  { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  { id: 'm2', name: '측정항목02', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  { id: 'm3', name: '측정항목03', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];
const MINI_SETTINGS = {
  ...AZ_SETTINGS,
  state: { ...AZ_SETTINGS.state, columns: MINI_COLUMNS, totalRows: 1, sessionAutoLabel: 'r4-m2' },
};
const MINI_HEADERS = ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02', '측정항목03'];
const MINI_ROWS = [[PREV_ROUND, '이원창', '1', '100.0', '', '']];

/** 영속된 세션의 한 행 — **IDB에서 직접** 읽는다. */
async function persistedRow(page: Page, index: number) {
  return page.evaluate(async (rowIndex) => {
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
    if (!latest) return null;
    return {
      completedRows: latest.completedRows,
      row: latest.rows.find((r) => r.index === rowIndex) ?? null,
    };
  }, index);
}

async function activeChipName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const c = document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
    return c?.dataset.colName ?? '';
  });
}

async function bootMini(page: Page) {
  await boot(page, PHONE_402, {
    settings: MINI_SETTINGS as unknown as typeof AZ_SETTINGS,
    headers: MINI_HEADERS,
    sheetRows: MINI_ROWS,
  });
}

/** 01 커밋 → '다음'으로 **빈 02를 건너뛰고** 03에 커밋. 유일한 행이므로 아래에 미완료 행이 없다. */
async function reachEndWithGapBehindPointer(page: Page) {
  await fireStt(page, '11.1', 900);
  await waitForTtsIdle(page);
  await fireStt(page, '다음', 1200); // 항목 이동 — 빈 02를 지나 03으로
  await waitForTtsIdle(page);
  expect(await activeChipName(page), '전제: 커서가 03에 서 있다').toContain('측정항목03');
  await fireStt(page, '33.3', 1800);
  await waitForTtsIdle(page);
}

test('① 🔴 포인터 앞에 빈 칸이 남았으면 끝 도달이 아니라 그 빈 칸으로 되돌아간다', async ({ page }) => {
  await bootMini(page);
  const before = (await ttsLog(page)).length;
  await reachEndWithGapBehindPointer(page);
  const spoken = (await ttsLog(page)).slice(before).join(' | ');

  expect(spoken, '미완료 행에서 끝 도달을 선언하면 안 된다').not.toContain('마지막행 입력');
  expect(spoken, '남은 빈 칸(02)을 안내한다').toContain('측정항목02');
  expect(await activeChipName(page), '커서도 그 빈 칸에 선다').toContain('측정항목02');
  await expect(page.locator('[data-testid="complete-summary"]'), '조사 완료 화면이 뜨면 안 된다')
    .toHaveCount(0);
});

test('② 되돌아간 칸의 값이 실제로 그 칸에 선다 — 행이 완료되고 IDB에 남는다(끝 도달 흡수 반증)', async ({ page }) => {
  await bootMini(page);
  await reachEndWithGapBehindPointer(page);

  await fireStt(page, '22.2', 1800);
  await waitForTtsIdle(page);

  // 🔴 결함 상태에서는 이 발화가 atEnd 가드에 **흡수**돼 02가 영영 빈다(행 미완료로 고착).
  await expect
    .poll(async () => (await persistedRow(page, 1))?.row?.complete, { timeout: 8000 })
    .toBe(true);
  const p = await persistedRow(page, 1);
  expect(p?.row?.values.m1).toBe('11.1');
  expect(p?.row?.values.m2, '건너뛴 칸이 채워졌다').toBe('22.2');
  expect(p?.row?.values.m3, '먼저 채운 칸은 그대로다').toBe('33.3');
  expect(p?.completedRows, '완료 행 부기도 함께 선다').toBe(1);

  // 계약 보존 — 행이 실제로 완료된 **뒤에는** 종전대로 끝 도달이 뜬다.
  expect((await ttsLog(page)).join(' | '), '완료 후에는 끝 도달').toContain('마지막행 입력');
  await expect(page.locator('[data-testid="complete-summary"]')).toBeVisible({ timeout: 6000 });

  // 리로드 생존.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  expect((await persistedRow(page, 1))?.row?.values.m2, '리로드 후에도 남는다').toBe('22.2');
});

test('③ 대조군 — 순서대로 채운 완료 행의 끝 도달은 그대로다(과수정 방지)', async ({ page }) => {
  await bootMini(page);
  const before = (await ttsLog(page)).length;
  await fireStt(page, '11.1', 900);
  await fireStt(page, '22.2', 900);
  await fireStt(page, '33.3', 1800);
  await waitForTtsIdle(page);
  const spoken = (await ttsLog(page)).slice(before).join(' | ');

  expect(spoken, '완료 행에서는 종전대로 끝 도달').toContain('마지막행 입력');
  expect(spoken, '빈 행 꼬리는 붙지 않는다').not.toContain('비어 있습니다');
  await expect(page.locator('[data-testid="complete-summary"]')).toBeVisible({ timeout: 6000 });
});
