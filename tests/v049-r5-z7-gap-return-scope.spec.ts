/**
 * v0.49 r5 Z7 계약 오라클(claude #7) — **현행 동작의 기준선.** 이 라운드는 여기를 **고치지
 * 않았다**(등재: `[ATEND-REACH-SKIPPED-1]`). 다음 회차가 반증할 기준선을 남기는 것이 이 파일의 일이다.
 *
 * ## 원 발견의 두 반쪽이 실측에서 갈렸다
 *
 * ### ① 「스킵 행 강제 재개방」 — **기각(구조적으로 불가)**
 * `advance()`는 `proceedAfterCommit`(=커밋 뒤) 또는 `'유지'`(그 셀에 값이 있을 때만)로만 도달하고,
 * 교차행 수동 커밋은 `ownsFlow` 게이트(M1)에 막혀 `advance()`를 아예 타지 않는다. 즉 M2의
 * gap-return이 발동하는 순간 그 행에는 **사용자가 방금 넣은 값이 반드시 있다** — 「손대지 않은
 * 스킵 행에 강제 재진입」하는 경로가 없다. 그 순간의 스킵 행은 **다른 부분입력 미완료 행과
 * 구별할 근거가 없다.** ①이 이 성질을 고정한다.
 *
 * ### ② 「완료화면 도달불가」 — **확인. 그러나 안전한 처방이 셋 다 막혀 있다**
 * 스킵했던 행에 되돌아와 일부만 채우면, 그 행이 완성되기 전까지 `X / N` 요약 화면(끝 도달)에
 * 다시 도달할 수 없다. `announceEndReached`의 유일한 호출부가 `advance()`이고 M2가 미완료 행에서
 * 그것을 막기 때문이다. 후보 처방 셋이 각각 **독립된 선행 결정**에 막힌다:
 *
 * | 후보 | 막는 것 |
 * |---|---|
 * | 스킵 행에서 atEnd 허용 | **M2 재개방** — atEnd 센티넬 colId=마지막 컬럼이라 bare '수정'이 방금 넣은 값을 지운다 |
 * | atEnd 센티넬 컬럼을 gap으로 이동 | `[MODIFY-TARGET-1]` — `announceEndReached` 주석이 *"반대 방향은 안 된다"* 고 명시 |
 * | `goNextRow` 경계에서 end-reached 재발화 | **F13이 명시적으로 제거**(*"'다음'은 더 이상 announceEndReached를 부르지 않는다"*) |
 *
 * 그리고 피해가 데이터 손실도 막다른 길도 아니다 — `endReachedOnce`가 종료 수단을 세션 경계까지
 * 붙잡으므로 ⏹은 항상 열려 있다(③이 그 안전망을 고정한다). 잃는 것은 요약 **화면** 하나다.
 * 👉 다음 회차가 이걸 고치려면 **atEnd 센티넬 컬럼 재설계**가 선행해야 한다.
 */

import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, waitForTtsIdle } from './fixtures/stt';

test.setTimeout(120_000);

const COLS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  { id: 'm2', name: '측정항목02', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];

const bootZ7 = (page: Page) => boot(page, PHONE_402, {
  settings: {
    ...AZ_SETTINGS,
    state: { ...AZ_SETTINGS.state, columns: COLS, totalRows: 2, sessionAutoLabel: 'r5-z7' },
  } as unknown as typeof AZ_SETTINGS,
  headers: ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02'],
  sheetRows: [[PREV_ROUND, '이원창', '1', '100.0', '']],
});

async function logExtras(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((r) => {
      const q = indexedDB.open('agri-voicenote');
      q.onsuccess = () => r(q.result);
    });
    const rows: { extra?: string }[] = await new Promise((r) => {
      const tx = db.transaction('logEvents', 'readonly');
      const g = tx.objectStore('logEvents').getAll();
      g.onsuccess = () => r(g.result as never);
      g.onerror = () => r([]);
    });
    db.close();
    return rows.map((e) => String(e.extra ?? ''));
  });
}

/** 1행을 스킵 → 2행 완주(끝 도달) → 1행 복귀 → 앞 칸을 건너뛰고 뒤 칸만 채운다. */
async function skipThenPartiallyRefill(page: Page) {
  await fireStt(page, '다음행', 1800); // 1행 스킵(값 없이 지나간다) → 2행
  await waitForTtsIdle(page);
  await fireStt(page, '삼십오 점 일', 1600);
  await waitForTtsIdle(page);
  await fireStt(page, '사십이 점 삼', 1800); // 2행 완료 → 끝 도달
  await waitForTtsIdle(page);
  await expect(page.locator('[data-testid="complete-summary"]'), '전제: 끝 도달 화면에 왔다').toBeVisible();

  await fireStt(page, '이전행', 1800); // 스킵했던 1행으로 복귀
  await waitForTtsIdle(page);
  await fireStt(page, '다음', 1500);    // 항목 이동 — 앞 칸(m1)을 비워 둔 채 m2로
  await waitForTtsIdle(page);
  await fireStt(page, '십일 점 일', 1800); // m2만 커밋 → advance → gap-return
  await waitForTtsIdle(page);
}

test('① 스킵했던 행도 값이 들어오면 다른 미완료 행과 똑같이 gap-return한다(구별 근거 없음)', async ({ page }) => {
  await bootZ7(page);
  await skipThenPartiallyRefill(page);

  const extras = await logExtras(page);
  expect(extras, '전제: 1행이 실제로 스킵됐다').toContain('row_skipped:1,src=voice');
  expect(
    extras.filter((e) => e.startsWith('row_gap_return:')),
    '스킵 행에서 gap-return이 안 돌았다 — 남은 빈 칸을 가리키지 않으면 사용자가 그 칸을 찾을 방법이 없다',
  ).toEqual(['row_gap_return:col=m1']);
});

test('② 그 상태에서 끝 도달 화면은 다시 오지 않는다 — 현행 동작(등재: 다음 회차 대상)', async ({ page }) => {
  await bootZ7(page);
  await skipThenPartiallyRefill(page);

  await expect(
    page.locator('[data-testid="complete-summary"]'),
    '현행 계약이 바뀌었다 — 바뀌었다면 M2(미완료 행 atEnd 금지)가 어떻게 유지되는지 확인하고 이 계약을 갱신하라',
  ).toHaveCount(0);
  // 끝 도달 안내도 그 뒤로 다시 나지 않았다(로그 기준 — 1회는 위 전제에서 났다).
  expect(
    (await logExtras(page)).filter((e) => e.startsWith('end_reached_waiting')).length,
    '끝 도달이 두 번 났다면 ②의 전제가 무너진 것이다',
  ).toBe(1);
});

test('③ 안전망 — 요약 화면을 못 봐도 종료 수단은 살아 있다(endReachedOnce 래치)', async ({ page }) => {
  await bootZ7(page);
  await skipThenPartiallyRefill(page);

  // [EXIT-PERSIST-1] — 끝 도달을 한 번이라도 거쳤으면 도트 자리를 종료가 승계한다.
  await expect(
    page.locator('[data-testid="voice-status-control"][data-status="exit"]'),
    '요약 화면도 없고 종료 수단도 없으면 그건 막다른 길이다 — 등재가 아니라 즉시 수정 대상이 된다',
  ).toBeVisible({ timeout: 4000 });
});
