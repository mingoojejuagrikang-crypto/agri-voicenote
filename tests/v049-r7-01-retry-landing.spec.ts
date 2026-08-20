/**
 * 🔴 v0.49 r7 #1 오라클(codex R6-F3 High) — **저장 실패 재시도 뒤 음성 흐름이 복귀한다.**
 *
 * 결함: 음성 커밋 종단은 `proceedAfterCommit`을 부르기 **전에** `awaitingFieldRef.current = null`로
 * 만든다(커밋이 끝났다는 전제의 정리). 그 전제가 깨지는 유일한 지점이 «행 완료 부기의 durable
 * 실패»인데, 종전엔 그 분기가 실패 고지만 하고 소유자를 복원하지 않았다. 결과:
 *   · 재시도 버튼(`commitManualValue`)이 `ownsFlow=false`로 돌아 값·부기는 회복되는데 **착지가 없다** —
 *     활성 칩은 그대로, awaiting은 `null`.
 *   · 그 상태에서 숫자를 말해도 TTS 0·값 변화 0으로 **무음 흡수**. 2~3m 거리의 음성 전용 사용자는
 *     성공/실패 어느 안내도 없이 입력 불능에 주차된다(PRINCIPLES §2).
 *
 * 두 축을 따로 잰다 — 하나를 되돌리면 **정확히 그 축만** red다:
 *   ①② `proceedAfterCommit` 실패 분기의 `awaitingFieldRef.current = awaiting` 복원 (순차 완주)
 *   ③   `notifyRowPersistFailed`의 좌표 정본(landing) — **gap-fill에서만** 증상이 난다.
 *       순차 완주에서는 `awaiting.colId === 마지막 값 있는 음성 컬럼`이라 두 좌표가 우연히 같다.
 *       `row_gap_return`(advance)이 커서를 **앞 칸**으로 되돌려 거기서 행이 완성되면 갈린다.
 *
 * ⚠️ ✓·값 에코·화음은 이 형상에서 이미 나간 뒤다(음성 증분 persist가 fire-and-forget = R6-F1,
 *   **선행 내구성 부채**로 v0.50 라운드 몫). 여기서 ✓ 0건을 단언하면 그 축을 이 라운드로 끌어온다 —
 *   의도적으로 단언하지 않는다. 이 오라클이 잠그는 것은 «재시도 이후의 흐름»뿐이다.
 */

import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, ttsLog, waitForTtsIdle } from './fixtures/stt';

test.setTimeout(120_000);

// ⚠️ 행 수의 정본은 `settings.totalRows`가 아니라 **seq 컬럼의 상한**이다
//   (`computeTotalRows(getSessionColumns())`) — `to`를 안 내리면 totalRows만 1로 줘도 2행이 돈다.
//   ③이 요구하는 「아래에 미완료 행이 없음」은 `to: 1`로만 만들어진다(실측으로 확인).
const cols = (seqTo: number) => [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: seqTo }, sampleKey: true },
  { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  { id: 'm2', name: '측정항목02', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];

const bootR7 = (page: Page, totalRows: number) => boot(page, PHONE_402, {
  settings: {
    ...AZ_SETTINGS,
    state: { ...AZ_SETTINGS.state, columns: cols(totalRows), totalRows, sessionAutoLabel: 'r7-01' },
  } as unknown as typeof AZ_SETTINGS,
  headers: ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02'],
  sheetRows: [[PREV_ROUND, '이원창', '1', '100.0', '']],
});

const FAIL_TTS = '저장하지 못했습니다. 다시 저장 버튼을 눌러 주세요.';
const banner = (page: Page) => page.locator('[data-testid="cell-persist-error-banner"]');

/** 🔴 fixc(2026-08-15) — **배너 소멸은 착지 완료가 아니다.**
 *
 *  배너를 내리는 것은 `persistCellValue` 성공(`useVoiceSession.ts` `clearIfMatches`)이고, 완료
 *  낭독은 그 **뒤** `finalizeRowCompletion`(IDB await) → `proceedAfterCommit`에서 나온다. 그
 *  사이에 TTS가 하나도 없는 유휴 창이 있는데, 실측 **51~56ms**에 `waitForTtsIdle`의 재확인
 *  간격이 **50ms**라 마진이 1~5ms였다 — 배너 소멸을 착지 완료의 프록시로 쓰면 스케줄링 지터
 *  한 번에 `waitForTtsIdle`이 조기 반환해 낭독을 통째로 놓친다. 08-14 stage B 게이트 ② red ·
 *  08-15 stage C 게이트 ① red · 같은 날 단독 재판정 ①③ red가 전부 이것이고, **커밋과 무관**하다
 *  (분리 이전 tip에서도 같은 수치로 재현 — KNOWN-ISSUES [TEST-LANDING-PROXY-1]).
 *
 *  ⚠️ 여기서는 **동기화만** 한다. 낭독이 실제로 났는지의 **판정은 호출부의 원 단언**이 그대로
 *  한다 — 대기가 타임아웃해도 삼키는 이유다(여기서 red를 내면 원 오라클의 실패 메시지가 죽는다).
 *
 *  ⚠️ 헤더 「두 축」 계약에 붙는 각주: 이 대기가 기다리는 '완료'는 ③이 재는 제품 결함의 증상과
 *  같다(좌표가 갈리면 `ownsFlow=false`라 착지가 빠지고 완료 낭독이 없다). 그 결함이 되돌아오면
 *  여기서 5s 타임아웃을 채운 뒤 삼켜지고 **원 단언이 red를 낸다** — 되돌림 실패가 축당 ~5s
 *  느려질 뿐 **판정은 불변**이다(축 분리도 그대로). */
async function waitForLandingTts(page: Page, sinceLen: number): Promise<void> {
  await page
    .waitForFunction(
      (n) => ((window as unknown as { __ttsLog?: string[] }).__ttsLog ?? []).slice(n)
        .some((t) => t.includes('완료')),
      sinceLen,
      { timeout: 5000 },
    )
    .catch(() => { /* 판정은 호출부 단언 몫 */ });
  await waitForTtsIdle(page);
}

async function failAll(page: Page, v: boolean) {
  await page.evaluate((f) => {
    (window as unknown as { __survey011FailSessionPut?: boolean }).__survey011FailSessionPut = f;
  }, v);
}

/** IDB에 실제로 내구화된 것 — 시트로 올라갈 것을 잰다. */
async function persisted(page: Page): Promise<{ i: number; c: boolean; v: Record<string, string> }[]> {
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
    return (all.at(-1)?.rows ?? []).sort((a, b) => a.index - b.index)
      .map((r) => ({ i: r.index, c: r.complete, v: r.values }));
  });
}

/** 음성만으로 1행을 완주시키고 전 put을 실패시킨다 = R6-F3의 재현 전제. */
async function voiceRowThenFail(page: Page) {
  await failAll(page, true);
  await fireStt(page, '삼십오 점 일', 1600);
  await waitForTtsIdle(page);
  await fireStt(page, '사십이 점 삼', 1800);
  await waitForTtsIdle(page);
  await expect(banner(page), '전제: 행 완료 부기 실패가 배너로 선다').toBeVisible();
  expect((await ttsLog(page)).at(-1), '전제: 마지막 안내는 실패 고지').toBe(FAIL_TTS);
}

test('① 재시도 성공이 원 음성 착지를 재개한다 — 행 완료 낭독과 다음 행 전진', async ({ page }) => {
  await bootR7(page, 2);
  await voiceRowThenFail(page);
  const before = (await ttsLog(page)).length;

  await failAll(page, false);
  await page.locator('[data-testid="cell-persist-retry-btn"]').click();
  await expect(banner(page), 'durable 성공이 배너를 내린다').toHaveCount(0, { timeout: 5000 });
  await waitForLandingTts(page, before);

  const after = (await ttsLog(page)).slice(before);
  expect(
    after.some((t) => t.includes('완료')),
    '재시도로 내구화된 행은 완료 낭독을 받는다(원 흐름 재개 — 종전엔 여기가 통째로 없었다)',
  ).toBe(true);
  expect(
    after.some((t) => t.includes('조사나무 2')),
    '다음 행으로 전진한다 — 착지가 실제로 돌았다는 증거',
  ).toBe(true);
  expect((await persisted(page)).find((r) => r.i === 1)?.c, '완료 부기까지 내구화').toBe(true);
});

test('② 재시도 뒤 다음 발화가 실제 대상에 커밋된다 — 무음 흡수 없음', async ({ page }) => {
  await bootR7(page, 2);
  await voiceRowThenFail(page);

  await failAll(page, false);
  const beforeRetry = (await ttsLog(page)).length;
  await page.locator('[data-testid="cell-persist-retry-btn"]').click();
  await expect(banner(page)).toHaveCount(0, { timeout: 5000 });
  await waitForLandingTts(page, beforeRetry);

  // 🔴 fixc — 기준점이 **착지 낭독 뒤**로 굳었다(위 waitForLandingTts). 아래 「TTS 증가 0이 아니다」는
  //   이제 완료 낭독을 세지 않고 **이 발화가 낸 안내만** 센다 — 원 계약(무음 흡수 없음)을 더 좁게 잰다.
  const before = (await ttsLog(page)).length;
  await fireStt(page, '십일 점 일', 1800);
  await waitForTtsIdle(page);

  expect(
    (await ttsLog(page)).length,
    '숫자 발화가 무음으로 버려지지 않는다(종전 실측: TTS 증가 0)',
  ).toBeGreaterThan(before);
  const rows = await persisted(page);
  expect(rows.find((r) => r.i === 2)?.v.m1, '2행 첫 칸에 커밋된다 — 착지가 그 칸을 열었다').toBe('11.1');
  expect(rows.find((r) => r.i === 1)?.v.m1, '1행 값은 덮이지 않는다').toBe('35.1');
});

test('③ gap-fill 완성 — 배너 좌표는 흐름 소유자를 따르고, 재시도가 착지까지 회복한다', async ({ page }) => {
  // totalRows=1이라 아래 행이 없다 → m1을 비운 채 m2를 채우면 `row_gap_return`이 커서를 m1으로
  // 되돌린다. 거기서 행이 완성되므로 «완성시킨 칸(m1)» ≠ «값 있는 마지막 음성 컬럼(m2)»이다.
  await bootR7(page, 1);
  await fireStt(page, '다음', 1600);
  await waitForTtsIdle(page);
  expect((await ttsLog(page)).at(-1), '전제: m1을 건너뛰고 m2에 서 있다').toContain('측정항목02');

  await failAll(page, true);
  await fireStt(page, '사십이 점 삼', 1800);
  await waitForTtsIdle(page);
  expect((await ttsLog(page)).at(-1), '전제: gap 복귀로 m1이 다시 열린다').toContain('측정항목01');

  await fireStt(page, '삼십오 점 일', 1800);
  await waitForTtsIdle(page);
  await expect(banner(page), '전제: 여기서 행이 완성되고 부기가 실패한다').toBeVisible();
  await expect(
    banner(page),
    '배너 좌표는 행을 완성시킨 칸(m1)이다 — 마지막 음성 컬럼(m2)이 아니다',
  ).toContainText('측정항목01 35.1');

  await failAll(page, false);
  const before = (await ttsLog(page)).length;
  await page.locator('[data-testid="cell-persist-retry-btn"]').click();
  await expect(banner(page)).toHaveCount(0, { timeout: 5000 });
  await waitForLandingTts(page, before);

  expect(
    (await ttsLog(page)).slice(before).some((t) => t.includes('완료')),
    '좌표가 갈리면 ownsFlow=false라 착지가 통째로 빠진다 — 완료 낭독이 그 증거',
  ).toBe(true);

  const before2 = (await ttsLog(page)).length;
  await fireStt(page, '구십구 점 구', 1800);
  await waitForTtsIdle(page);
  expect(
    (await persisted(page)).find((r) => r.i === 1)?.v.m1,
    '착지 후 awaiting은 정리됐다 — 이어지는 발화가 방금 넣은 값을 덮지 않는다',
  ).toBe('35.1');
  expect((await ttsLog(page)).length, '무음도 아니다(끝 도달 국면의 안내가 돈다)').toBeGreaterThan(before2);
});

test('④ 대조군 — 실패가 없으면 종전 흐름 그대로', async ({ page }) => {
  await bootR7(page, 2);
  await fireStt(page, '삼십오 점 일', 1600);
  await waitForTtsIdle(page);
  await fireStt(page, '사십이 점 삼', 1800);
  await waitForTtsIdle(page);

  await expect(banner(page), '정상 경로에 실패 배너가 서면 안 된다').toHaveCount(0);
  const rows = await persisted(page);
  expect(rows.find((r) => r.i === 1)?.c, '완료 부기 정상').toBe(true);
  expect(
    (await ttsLog(page)).some((t) => t === FAIL_TTS),
    '정상 커밋에 실패 고지가 나면 안 된다',
  ).toBe(false);
});
