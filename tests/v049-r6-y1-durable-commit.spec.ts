/**
 * 🔴🔴 v0.49 r6 Y1 오라클(codex R5-F1 Critical) — **내구 저장 전에 성공을 고지하지 않는다.**
 *
 * 세 갈래가 같은 결함을 공유했다. 공통점은 「IDB에 한 글자도 안 들어갔는데 화면·귀·✓는 성공」:
 *   ① `persistCellValue`가 `patchRowValues → null`(= 세션이 아직 IDB에 없다)에서 **IDB 쓰기를
 *      한 번도 하지 않고** `true`를 반환했다. 주석은 이를 "다음 persist의 자연 반영"이라 불렀지만
 *      그 다음 persist가 성공한다는 보장은 어디에도 없었다.
 *   ② `finalizeRowCompletion`이 `void persistSession()`이라 호출부가 실패를 받지 못했다. 음성
 *      완주는 `persistCellValue`를 아예 지나지 않으므로 **이 put이 세션의 첫 IDB 쓰기**다.
 *   ③ 그래서 fixr5 Z8이 배선한 비-awaiting 수동 완성 커밋도 값 put은 성공하고 **완료 부기 put만
 *      실패**하는 형상에서 성공 고지가 그대로 나갔다(= 값은 남지만 `complete:false`로 굳어 sync
 *      대상에서 빠진다 — 시트에 영영 안 올라간다).
 *
 * 실측 재현(수정 전, 2026-08-14 fixr6, 실패 주입):
 *   · 음성 m1 → `'이전'`(cellWait) → 키패드 m2: IDB 세션 **0건**, 배너 **0**, ✓ 2개, 마지막 TTS `42.3`.
 *   · 음성만으로 1행 완주: IDB **0건**인데 「조사나무 1 완료」 + 2행 전진.
 *   · 키패드 한 칸(행 미완료): IDB **0건**인데 ✓ 1개 + 값 에코 + 다음 칸 전진.
 *
 * 반증 실측(2026-08-14 fixr6 — 되돌린 축마다 정확히 하나가 red):
 *   · `persistCellValue`의 else 분기 제거          → ① red (✓가 다시 붙는다)
 *   · `proceedAfterCommit`의 라우팅 제거           → ③ red (「완료」 낭독이 다시 나온다)
 *   · `commitManualValue` 종단의 라우팅 제거       → ④ red (부기 실패가 성공으로 고지된다)
 *   ⑤는 대조군이라 어느 축을 되돌려도 green이다.
 *   ⚠️ `advance`의 라우팅만 되돌리면 **다섯 건 모두 green**이다 — 음성 커밋 종단은
 *     `proceedAfterCommit`을 먼저 지나기 때문이다. 그 라우팅은 삭제하지 않고 남긴다:
 *     `advance()`를 **직접** 부르는 경로가 하나 있고(:「유지」 명령, 예약 없는 상태),
 *     거기서 행이 완성되면 그 자리가 유일한 방어다. 상세는 그 콜사이트 주석.
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

const bootY1 = (page: Page) => boot(page, PHONE_402, {
  settings: {
    ...AZ_SETTINGS,
    state: { ...AZ_SETTINGS.state, columns: COLS, totalRows: 2, sessionAutoLabel: 'r6-y1' },
  } as unknown as typeof AZ_SETTINGS,
  headers: ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02'],
  sheetRows: [[PREV_ROUND, '이원창', '1', '100.0', '']],
});

const FAIL_TTS = '저장하지 못했습니다. 다시 저장 버튼을 눌러 주세요.';
const banner = (page: Page) => page.locator('[data-testid="cell-persist-error-banner"]');
const chip = (page: Page, colName: string) =>
  page.locator(`[data-testid="column-chip"][data-col-name="${colName}"]`);

async function keypadCommit(page: Page, colName: string, keys: string[]) {
  await chip(page, colName).click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible({ timeout: 5000 });
  for (const k of keys) await page.locator(`[data-testid="manual-key-${k}"]`).click();
  await page.locator('[data-testid="manual-commit"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toHaveCount(0);
  await page.waitForTimeout(700);
}

/** 전면 실패 주입(모든 세션 put). */
async function failAll(page: Page, v: boolean) {
  await page.evaluate((f) => {
    (window as unknown as { __survey011FailSessionPut?: boolean }).__survey011FailSessionPut = f;
  }, v);
}

/** 성공 put N건 뒤부터 실패 — 「값은 저장됐는데 완료 부기만 실패」를 단독으로 만든다. */
async function failAfter(page: Page, n: number | undefined) {
  await page.evaluate((v) => {
    (window as unknown as { __survey011FailSessionPutAfter?: number }).__survey011FailSessionPutAfter = v;
  }, n);
}

/** IDB에 실제로 내구화된 것 — **시트로 올라갈 것**을 잰다(화면 상태가 아니다). */
async function persisted(page: Page): Promise<{ count: number; rows: { i: number; c: boolean; v: Record<string, string> }[] }> {
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
    return {
      count: all.length,
      rows: (all.at(-1)?.rows ?? []).sort((a, b) => a.index - b.index)
        .map((r) => ({ i: r.index, c: r.complete, v: r.values })),
    };
  });
}

/** 1행 m1을 음성으로 채우고 `'이전'`으로 그 셀에 주차 — 다음 키패드 커밋이 **비-awaiting**이 된다. */
async function voiceM1ThenPark(page: Page) {
  await fireStt(page, '삼십오 점 일', 1600);
  await waitForTtsIdle(page);
  await fireStt(page, '이전', 1600);
  await waitForTtsIdle(page);
  expect((await ttsLog(page)).at(-1), '전제: 셀 검토 대기 = 비-awaiting 커밋이 된다').toBe('측정항목01 기록값 35.1.');
}

test('① 최초 세션의 수동 커밋 — IDB 0건이면 성공 신호도 0이고 실패가 화면에 남는다', async ({ page }) => {
  await bootY1(page);
  await failAll(page, true);
  await voiceM1ThenPark(page);
  const marksBefore = await page.locator('[data-testid="chip-commit-mark"]').count();

  await keypadCommit(page, '측정항목02', ['4', '2', '.', '3']);
  await waitForTtsIdle(page);

  const idb = await persisted(page);
  expect(idb.count, '전제: 이 형상에서 IDB에는 아무것도 없다').toBe(0);
  expect(
    (await ttsLog(page)).at(-1),
    '유실될 값을 에코하지 않는다 — 마지막 안내는 실패 고지여야 한다',
  ).toBe(FAIL_TTS);
  expect(
    await page.locator('[data-testid="chip-commit-mark"]').count(),
    '내구화되지 않은 커밋에 ✓를 붙이지 않는다',
  ).toBe(marksBefore);
  await expect(banner(page), '실패가 화면에 지속된다(PRINCIPLES §1 재시도 경로)').toBeVisible();
  await expect(banner(page)).toContainText('측정항목02 42.3');
});

test('② 재시도가 실제로 회복한다 — 값 둘 + 완료 부기가 함께 내구화된다', async ({ page }) => {
  await bootY1(page);
  await failAll(page, true);
  await voiceM1ThenPark(page);
  await keypadCommit(page, '측정항목02', ['4', '2', '.', '3']);
  await expect(banner(page)).toBeVisible();

  await failAll(page, false);
  await page.locator('[data-testid="cell-persist-retry-btn"]').click();
  await expect(banner(page), 'durable 성공이 배너를 내린다').toHaveCount(0, { timeout: 5000 });
  await waitForTtsIdle(page);

  const row1 = (await persisted(page)).rows.find((r) => r.i === 1);
  expect(row1?.v.m1, '음성 값도 이 persist에 함께 실린다').toBe('35.1');
  expect(row1?.v.m2).toBe('42.3');
  expect(row1?.c, '완료 부기까지 내구화돼야 sync가 이 행을 올린다').toBe(true);
});

test('③ 음성 완주 — 저장 실패면 「완료」 낭독도 다음 행 전진도 없다', async ({ page }) => {
  await bootY1(page);
  await failAll(page, true);
  await fireStt(page, '삼십오 점 일', 1600);
  await waitForTtsIdle(page);
  await fireStt(page, '사십이 점 삼', 1800);
  await waitForTtsIdle(page);

  expect((await persisted(page)).count, '전제: IDB에는 아무것도 없다').toBe(0);
  const tts = await ttsLog(page);
  expect(tts.some((t) => t.includes('완료')), '유실될 행을 완료로 낭독하지 않는다').toBe(false);
  expect(tts.at(-1), '마지막 안내는 실패 고지').toBe(FAIL_TTS);
  expect(
    tts.some((t) => t.includes('조사나무 2')),
    '다음 행으로 전진하지 않는다(전진하면 유실된 행을 지나쳐 버린다 — 행 안내가 그 증거)',
  ).toBe(false);
  await expect(banner(page)).toBeVisible();
});

test('④ 값 put은 성공하고 완료 부기 put만 실패 — 그래도 성공 고지는 없고 재시도가 부기를 완성한다', async ({ page }) => {
  await bootY1(page);
  await voiceM1ThenPark(page);
  // seam 기준점은 **여기부터**다(그 시점의 성공 put 수를 오라클이 알 필요가 없게 db.ts가 리셋한다).
  // 다음 키패드 커밋에서 put#1 = persistCellValue(성공), put#2 = finalizeRowCompletion(실패).
  await failAfter(page, 1);
  await keypadCommit(page, '측정항목02', ['4', '2', '.', '3']);
  await waitForTtsIdle(page);

  // ⚠️ 이 형상의 피해는 「IDB에 값이 없다」가 아니다(값 put은 성공했다 — `patchRowValues`가
  //   complete까지 재계산해 IDB는 옳아 **보인다**). 피해는 **`sessionStore`의 완료 부기가 없는
  //   채로 성공 고지가 나가는 것**이고, 그 상태로 진행하면 다음 persist가 이 행을 rows 조립에서
  //   통째로 떨어뜨린다(Z8이 닫은 그 결함 — 여기서 실패 경로로 다시 열린다).
  expect((await persisted(page)).rows.find((r) => r.i === 1)?.v.m2, '전제: 값 put은 성공했다').toBe('42.3');
  expect((await ttsLog(page)).at(-1), '부기 실패를 성공으로 고지하지 않는다').toBe(FAIL_TTS);
  await expect(banner(page), '실패가 화면에 남는다').toBeVisible();

  // 재시도 = 이 커밋의 재실행. 부기까지 완성돼야 그 다음 persist가 행을 떨어뜨리지 않는다.
  await failAfter(page, undefined);
  await page.locator('[data-testid="cell-persist-retry-btn"]').click();
  await expect(banner(page)).toHaveCount(0, { timeout: 5000 });
  await waitForTtsIdle(page);
  await fireStt(page, '다음행', 1800);
  await waitForTtsIdle(page);
  await fireStt(page, '십일 점 일', 1800);
  await waitForTtsIdle(page);

  const row1 = (await persisted(page)).rows.find((r) => r.i === 1);
  expect(row1, '회복 후에는 다음 persist가 이 행을 떨어뜨리지 않는다').toBeTruthy();
  expect(row1!.c, '완료 부기가 내구화됐다').toBe(true);
});

test('⑤ 대조군 — 실패가 없으면 종전 흐름 그대로(과잉 방어로 정상 커밋을 막지 않는다)', async ({ page }) => {
  await bootY1(page);
  await voiceM1ThenPark(page);
  await keypadCommit(page, '측정항목02', ['4', '2', '.', '3']);
  await waitForTtsIdle(page);

  await expect(banner(page), '정상 경로에 실패 배너가 서면 안 된다').toHaveCount(0);
  const row1 = (await persisted(page)).rows.find((r) => r.i === 1);
  expect(row1?.v.m1).toBe('35.1');
  expect(row1?.v.m2).toBe('42.3');
  expect(row1?.c, '완료 부기 정상').toBe(true);
  expect(
    (await ttsLog(page)).some((t) => t === FAIL_TTS),
    '정상 커밋에 실패 고지가 나면 안 된다',
  ).toBe(false);
});
