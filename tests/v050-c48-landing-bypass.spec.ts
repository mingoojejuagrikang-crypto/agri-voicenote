/**
 * v0.50 묶음 C 오라클(claude r2 #4 · #8) — **`advance`/`proceedAfterCommit`이 착지 계약을 우회한다.**
 *
 * 두 건의 근인은 하나다: Z2가 착지 넷을 `armLanding`으로 모으고 fix49b가 경계 둘에 epoch 재확인을
 * 넣었는데, **그 둘 중 어느 쪽도 지나지 않는 전이가 두 함수 안에 남아 있었다.**
 *
 *   · #4 `advance()`가 phase를 **직접** 쓴다(행 완료 · 예약 복귀 · gap-return · 다음 행 = 4곳).
 *     `armLanding`은 `paused`에서 국면 전이를 보류하는데 여기는 그 문을 안 지난다 → 일시정지 중
 *     음성 칩을 탭해 수동 커밋하면 **사용자가 풀지 않은 일시정지가 조용히 풀린다.** 피해 둘:
 *     ⓐ `resolveFinal`의 `pausedIgnore` 방어가 통째로 꺼져 **주변 발화가 값이 된다**
 *     ⓑ recorder는 `pause()`가 dispose한 채고 되살리는 곳은 `resume()`뿐이라 **클립만 죽는다.**
 *     👉 결정론적이다(레이스 없음). 사용자는 「멈춰 있다」고 믿는 동안 값이 들어간다.
 *   · #8 `proceedAfterCommit`에 **epoch 참조가 한 줄도 없다.** 호출부(`useCommitLanding`)의
 *     재확인은 진입 **직전 1회**고, 그 안의 awaited IDB 쓰기 구간은 무방비다. 경합자는 실재한다 —
 *     `jumpToRow`가 **첫 await 이전에** 커서 이동 + epoch bump를 동기로 끝낸다. 그러면 예약 복귀
 *     분기가 커서를 **명시로 되끌어**(`setActiveRow`/`setActiveCol`) 사용자가 이미 떠난 셀에
 *     착지한다 — 유실이 아니라 **「틀린 자리에 맞는 값」**이라 사후 발견이 어렵다.
 *     `advance()`에도 **형제 창**이 있었다: awaited 쓰기 뒤 파괴적 쓰기 둘(`setPhase` ·
 *     `awaitingFieldRef = null`)을 **먼저** 하고 epoch를 **그 뒤에** 봤다.
 *
 * 🔴 **이 스펙의 절반은 「막지 않아야 할 것」을 잠근다**(브리핑 §3 · `[TEAMOPS-97]`).
 * 과잉 수정이 이 과제의 실제 함정이다 — 가드를 넓게 잡으면 기능이 죽는다:
 *   · ②  일시정지 중에도 **값 커밋 자체는 일어나야** 한다(버리면 값 유실). 착지 **전체**를
 *        거절하면 `awaiting`이 빈 채 남아 `resume` 폴스루가 `[CELL-OVERWRITE-1]`을 새 경로로
 *        재개방한다(`armLanding` 헤더 실측). 그래서 보류는 **국면 전이만**이다.
 *   · ④  경합자가 없으면 예약 복귀 착지는 **종전과 완전히 같은 경로**여야 한다. epoch 가드가
 *        정상 착지를 먹으면 `[NAV-FILLED-CELL-1]`의 「모든 탈출은 재진입」이 깨진다.
 * 형제 오라클: `v049-r5-z2-landing-guard.spec.ts` ②-b(자동칩 경로의 같은 과잉 거절 반증) —
 * 이 스펙은 그 반증을 **수동 커밋 경로**로 확장한다.
 *
 * 반증(처방 제거 시): ① red(일시정지 카드가 사라진다) · ③ red(커서가 1행으로 되끌린다).
 * ②④는 처방 유무와 무관하게 green이어야 한다 — 그게 「막지 않았다」의 증거다.
 */

import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, ttsLog, waitForTtsIdle } from './fixtures/stt';
import { buildPastIndex } from '../src/lib/pastValuesIndex';
import type { Column } from '../src/types';

test.setTimeout(120_000);

// ── 픽스처 A: 음성 컬럼 1개 — 한 번의 커밋이 **행 경계**를 밟는다(#4의 4곳 중 둘이 여기서 난다) ──
//    z2 ②/②-b와 같은 형상이라 일시정지 축의 형제 비교가 그대로 성립한다.
const SOLO_COLUMNS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];
// ── 픽스처 A′: A와 같되 m1에 추세 규칙 — ⑦(알람 [확인] 터치)이 쓴다 ──
const ALERT_COLUMNS = SOLO_COLUMNS.map((c) => (c.id === 'm1' ? { ...c, trendRule: 'increase' } : c));
const SOLO_HEADERS = ['조사일자', '농가명', '조사나무', '측정항목01'];
const SOLO_ROWS = [[PREV_ROUND, '이원창', '1', '100.0']];

// ── 픽스처 B: 음성 컬럼 3개 — 완료된 행의 **filled 셀**에 셀 검토 대기를 만든다(#8의 무대) ──
//    r3-01과 같은 형상: 예약 복귀 분기(`resumeCell`)를 타려면 행이 완료·영속된 이력이 필요하다.
const MINI_COLUMNS = [
  ...SOLO_COLUMNS,
  { id: 'm2', name: '측정항목02', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  { id: 'm3', name: '측정항목03', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];
const MINI_HEADERS = [...SOLO_HEADERS, '측정항목02', '측정항목03'];
const MINI_ROWS = [
  [PREV_ROUND, '이원창', '1', '100.0', '', ''],
  [PREV_ROUND, '이원창', '2', '100.0', '', ''],
];

async function bootWith(
  page: Page,
  columns: unknown[],
  headers: string[],
  sheetRows: string[][],
  label: string,
) {
  await boot(page, PHONE_402, {
    settings: {
      ...AZ_SETTINGS,
      state: { ...AZ_SETTINGS.state, columns, totalRows: 2, sessionAutoLabel: label },
    } as unknown as typeof AZ_SETTINGS,
    headers,
    sheetRows,
  });
  await waitForTtsIdle(page);
}

/** IDB `logEvents`의 `extra` 전량 — 순서 보존(z2의 같은 헬퍼와 동일 계약). */
async function logExtras(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => resolve(req.result);
    });
    const rows: { extra?: string }[] = await new Promise((resolve) => {
      const tx = db.transaction('logEvents', 'readonly');
      const r = tx.objectStore('logEvents').getAll();
      r.onsuccess = () => resolve(r.result as { extra?: string }[]);
      r.onerror = () => resolve([]);
    });
    db.close();
    return rows.map((e) => String(e.extra ?? ''));
  });
}

/** `<type>/<parsed> <extra>` 전량 — **순서 보존**. ③은 「무엇이 무엇 뒤에 왔는가」를 재므로
 *  `extra`만으로는 부족하다(커밋 `value` 이벤트의 extra는 빈 문자열이다). */
async function logTrace(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => resolve(req.result);
    });
    const rows: { type?: string; parsed?: string; extra?: string }[] = await new Promise((resolve) => {
      const tx = db.transaction('logEvents', 'readonly');
      const r = tx.objectStore('logEvents').getAll();
      r.onsuccess = () => resolve(r.result as { type?: string; parsed?: string; extra?: string }[]);
      r.onerror = () => resolve([]);
    });
    db.close();
    return rows.map((e) => `${e.type ?? ''}/${e.parsed ?? ''} ${e.extra ?? ''}`);
  });
}

/** 뒤에서부터 처음 맞는 인덱스(Node 18 호환 — `findLastIndex` 미사용). */
function lastIndexWhere(rows: string[], pred: (s: string) => boolean): number {
  for (let i = rows.length - 1; i >= 0; i--) if (pred(rows[i])) return i;
  return -1;
}

/** 영속된 세션의 한 행 — **IDB에서 직접** 읽는다(메모리 dataStore가 아니라 재시작 후 남을 것). */
async function persistedRow(page: Page, index: number) {
  return page.evaluate(async (rowIndex) => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const sessions: Array<{
      startedAt: number;
      rows: Array<{ index: number; complete: boolean; values: Record<string, string> }>;
    }> = await new Promise((resolve, reject) => {
      const req = db.transaction('sessions', 'readonly').objectStore('sessions').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    const latest = sessions.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0];
    return latest?.rows.find((r) => r.index === rowIndex) ?? null;
  }, index);
}

const chip = (page: Page, colName: string) =>
  page.locator(`[data-testid="column-chip"][data-col-name="${colName}"]`);

async function activeChipName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const c = document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
    return c?.dataset.colName ?? '';
  });
}

/** 음성 칩 탭 → 수동 입력 시트 → 키패드 커밋. **이 건이 지목한 진입로 그 자체다**
 *  (`ActiveState.tsx`의 voice 분기 → `openManualSheet` → `commitManualValue`). */
async function manualCommit(page: Page, colName: string, keys: string[]) {
  await chip(page, colName).click();
  await expect(
    page.locator('[data-testid="manual-value-sheet"]'),
    '전제: 음성 칩 탭이 수동 입력 시트를 연다(일시정지 중에도 열려 있는 경로)',
  ).toBeVisible({ timeout: 4000 });
  for (const k of keys) await page.locator(`[data-testid="manual-key-${k}"]`).click();
  await page.locator('[data-testid="manual-commit"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toHaveCount(0, { timeout: 4000 });
}

/** 자동입력 칩(조사나무)을 인라인 편집해 다른 행으로 점프 — z2 ②의 헬퍼와 동일한 경로.
 *  `jumpToRow`는 **첫 await 이전에** `setActiveRow` + `epochRef++`를 동기로 끝낸다(#8의 경합자). */
async function jumpViaAutoChip(page: Page, value: string) {
  const c = chip(page, '조사나무');
  await c.click();
  const input = c.locator('input');
  await expect(input, '전제: 자동입력 칩이 인라인 편집으로 열린다').toBeVisible({ timeout: 4000 });
  await input.fill(value);
  await input.press('Enter');
}

// ── ① #4 — 일시정지 중 수동 커밋이 일시정지를 풀지 않는다 ──────────────────────────
test('① 일시정지 중 음성 칩 수동 커밋이 일시정지를 조용히 풀지 않는다 (claude r2 #4)', async ({ page }) => {
  await bootWith(page, SOLO_COLUMNS, SOLO_HEADERS, SOLO_ROWS, 'c48-1');
  const pausedCard = page.locator('[data-testid="paused-card"]');

  await fireStt(page, '일시 정지', 1200);
  await waitForTtsIdle(page);
  await expect(pausedCard, '전제: 일시정지에 들어갔다').toBeVisible({ timeout: 4000 });

  // 음성 컬럼이 하나뿐이라 이 커밋 하나가 **행 경계**를 밟는다 → advance의 setPhase 두 곳
  // (행 완료 'complete' · 다음 행 'active')이 연달아 도달한다.
  await manualCommit(page, '측정항목01', ['9', '5', '.', '5']);
  await waitForTtsIdle(page);

  await expect(
    page.locator('[data-testid="anomaly-alert"]'),
    '전제: 이상치 알람이 끼지 않았다(끼면 이 시나리오가 다른 흐름이 된다)',
  ).toHaveCount(0);
  await expect(
    pausedCard,
    'advance가 phase를 직접 써서 사용자가 풀지 않은 일시정지가 풀렸다 — '
      + 'resolveFinal의 pausedIgnore 방어가 꺼지고 주변 발화가 값이 된다(claude r2 #4)',
  ).toBeVisible({ timeout: 4000 });

  // 🔴 비공허 증명은 **advance 고유 사유 전체 문자열**로 잰다. 접두(`landing_phase_held:paused:`)로
  //   재면 `armLanding`이 같은 흐름에서 찍는 `announce_field` 보류에 걸려 **가드가 없어도 green**이
  //   된다(형제 이벤트와 이름을 갈라 둔 이유가 그것이다).
  // 🔴 부하 회차에서는 이 조회가 **착지보다 이를 수 있다**(스위트 동시 실행 1회 red, 단독 3/3
  //   green — `[TEAMOPS-91]`). 「아직 안 왔다」와 「영영 안 온다」는 다르므로 폴링으로 기다린다.
  await expect
    .poll(async () => logExtras(page), { timeout: 8000 })
    .toContain('advance_phase_held:paused:row_complete');
  // 🔴 v0.50 r2 — **이 단언에도 폴링이 필요하다.** 위 주석의 근거가 여기에도 그대로 적용되는데
  //   초판은 앞 단언에만 `poll`을 걸었다. `next_row`는 `row_complete` **다음에** 오는 이벤트라
  //   앞이 막 도착한 시점엔 아직 안 왔을 수 있다 — 08-19 r2 게이트에서 실제로 그 창에 걸렸다
  //   (스위트 732번째 · 배치 red / 단독 green). 「아직 안 왔다」와 「영영 안 온다」는 다르다.
  await expect
    .poll(async () => logExtras(page), {
      timeout: 8000,
      message: '다음 행 전이가 보류된 흔적이 없다 — 4곳 중 한 곳만 막으면 나머지가 같은 구멍이다',
    })
    .toContain('advance_phase_held:paused:next_row');
});

// ── ② #4 과잉 수정 반증 — 보류는 국면 전이만이다 ([TEAMOPS-97] · 브리핑 §3) ────────────
test('② 과잉 수정 반증 — 일시정지 중 커밋한 값은 살아 있고 재시작이 문맥을 받는다', async ({ page }) => {
  await bootWith(page, SOLO_COLUMNS, SOLO_HEADERS, SOLO_ROWS, 'c48-2');

  await fireStt(page, '일시 정지', 1200);
  await waitForTtsIdle(page);
  await manualCommit(page, '측정항목01', ['9', '5', '.', '5']);
  await waitForTtsIdle(page);

  // ⓐ 값을 버리지 않았다 — 착지 **전체**를 거절하는 처방이면 부기가 안 돌아 이 행이
  //    `persistSession`의 rows에서 통째로 떨어진다(Z8이 닫은 값 유실의 재개방).
  await expect
    .poll(async () => (await persistedRow(page, 1))?.values.m1, { timeout: 8000 })
    .toBe('95.5');
  expect((await persistedRow(page, 1))?.complete, '일시정지 중 커밋도 행 완료 부기를 받는다').toBe(true);

  // ⓑ 문맥이 재무장됐다 — 커서·안내는 그대로 진행했으므로 재시작이 그것을 이어받는다.
  //    (막았다면 `awaiting`이 빈 채 남아 `resume` 폴스루가 값 있는 셀에 kind:'value'를 연다.)
  // 🔴 `재시작`은 **STT 발화**라 부하 지연에서 통째로 유실될 수 있다(`[TEAMOPS-91]` 실측:
  //   게이트 동시부하 회차에서 이 한 발화가 씹혀 red, 조용한 환경 4/4 green). 이 케이스가 재는
  //   것은 「보류가 문맥을 버리지 않았다」이지 **인식률이 아니다** — 그래서 해제가 설 때까지
  //   재발화한다. 🔑 **판별력은 안 무뎌진다**: 처방이 정말로 재개를 막으면(과잉 수정 = 착지 전체
  //   거절 → `awaiting`이 빈 채 남는다) 몇 번을 말해도 안 풀려 red 그대로다(반증 C에서 실측).
  let released = false;
  for (let i = 0; i < 3 && !released; i++) {
    await fireStt(page, '재시작', 2000);
    await waitForTtsIdle(page);
    released = (await page.locator('[data-testid="paused-card"]').count()) === 0;
  }
  expect(
    released,
    '재시작이 일시정지를 풀지 못했다 — 보류가 문맥(awaiting)까지 버려 해제 발화가 소유자를 못 찾는다',
  ).toBe(true);

  await fireStt(page, '사십이 점 삼', 1800);
  await waitForTtsIdle(page);
  // 🔴 v0.50 fixdc U3 훑기 — 종전 전제 `toContain('측정항목01.')`은 **공허했다**(부팅 안내가
  //   이미 그 문구를 남긴다). 전제는 「이 커밋이 2행에 들어갔다」이므로 **IDB로** 잰다.
  await expect
    .poll(async () => (await persistedRow(page, 2))?.values.m1, { timeout: 8000 })
    .toBe('42.3');
  expect(
    await ttsLog(page),
    '재개 후 값이 다음 행(2행)에 들어가지 않았다 — 보류가 국면뿐 아니라 문맥까지 버렸다',
  ).toContain('조사나무 2 완료.');
  // 1행의 확정값은 그대로다 — 재개가 확정 셀을 재개방하면 여기가 42.3으로 덮인다(U1의 형상).
  expect((await persistedRow(page, 1))?.values.m1, '재개가 확정된 1행 값을 덮었다').toBe('95.5');
});

// ── ③ #8 — 착지 await 중 행 이동이 끼어들면 커서를 되끌지 않는다 ──────────────────────
test('③ 착지 await 중 행 이동이 끼어들면 낡은 예약이 커서를 되끌지 않는다 (claude r2 #8)', async ({ page }) => {
  await bootWith(page, MINI_COLUMNS, MINI_HEADERS, MINI_ROWS, 'c48-3');

  // 1행을 끝까지 채워 완료·영속시킨다 — 예약 복귀(`resumeCell`) 분기는 정정 이력을 전제한다.
  await fireStt(page, '95.5', 900);
  await fireStt(page, '88.8', 900);
  await fireStt(page, '77.7', 1500);
  await waitForTtsIdle(page);
  await expect
    .poll(async () => (await persistedRow(page, 1))?.complete, { timeout: 8000 })
    .toBe(true);

  // 완료된 1행의 filled 셀(m2)에 셀 검토 대기를 만든다 → bare '수정'이 그 출신을 예약에 싣는다.
  await fireStt(page, '이전행', 1500);
  await waitForTtsIdle(page);
  await fireStt(page, '다음', 1200);
  await waitForTtsIdle(page);
  expect(await activeChipName(page), '전제: 셀 검토 대기가 m2에 섰다').toContain('측정항목02');
  await fireStt(page, '수정', 1500);
  await waitForTtsIdle(page);

  // 🔴 seam은 **커밋 직전에** 건다 — 모든 세션 put에 걸리는 지연이라 부팅·복원 persist까지 늦춘다.
  await page.evaluate(() => {
    (window as unknown as { __survey011DelaySessionPutMs?: number }).__survey011DelaySessionPutMs = 2500;
  });
  // 새 값 → 행이 재완성되므로 `finalizeRowCompletion`이 **실제 IDB put을 탄다**(await 창 보장).
  await fireStt(page, '66.6', 0);
  // echo TTS(≈200ms) + 호출부 epoch 재확인을 지난 **뒤** 경합자를 넣어야 이 오라클이 공허하지 않다.
  //   너무 이르면 `useCommitLanding`의 진입 직전 가드가 먼저 잡아 이 함수에 도달조차 안 한다.
  await page.waitForTimeout(900);
  await jumpViaAutoChip(page, '2');
  await page.evaluate(() => {
    delete (window as unknown as { __survey011DelaySessionPutMs?: number }).__survey011DelaySessionPutMs;
  });
  await waitForTtsIdle(page);
  // 🔴 **고정 대기가 필요하다.** 낡은 착지는 지연된 put이 결말난 **뒤에** 돈다(실측: 커밋 발사
  //   +2.5s). 그 전에 `toHaveText`류 폴링 단언을 걸면 아직 옳은 **과도기 값**을 잡고 즉시
  //   통과해 **결함이 있는데 green**이 된다(이 스펙 첫 회차에서 실제로 그랬다).
  await page.waitForTimeout(3000);
  await waitForTtsIdle(page);

  // 🔑 판정은 **순서**로 한다 — 시점 의존이 없고, 「무엇이 무엇 뒤에 왔는가」가 곧 피해다.
  const trace = await logTrace(page);
  const valueAt = lastIndexWhere(trace, (e) => e.startsWith('value/66.6'));
  const jumpAt = lastIndexWhere(trace, (e) => e.includes('command/jump touch:1->2'));
  expect(valueAt, '전제: 정정값이 실제로 커밋됐다').toBeGreaterThanOrEqual(0);
  // 🔴 비공허의 핵심 — `value` 로그는 `useCommitLanding`의 **진입 직전 epoch 가드 바로 앞**에
  //   찍힌다. 행 이동이 그보다 **뒤**에 들어왔다는 것이 곧 「호출부 가드가 먼저 잡은 게 아니라
  //   이 함수 안의 await 구간에 들어왔다」의 증명이다. 앞이면 이 오라클은 아무것도 재지 않는다.
  expect(
    jumpAt,
    '행 이동이 커밋 착지 진입보다 **앞**에 들어갔다 — 호출부 가드가 먼저 잡으므로 이 오라클은 공허하다',
  ).toBeGreaterThan(valueAt);

  expect(
    trace.slice(jumpAt).filter((e) => e.includes('command/cell_wait cell_wait:m2')),
    '행 이동 뒤에 낡은 예약이 다시 착지했다 — 사용자가 이미 떠난 셀로 커서를 되끌었다. '
      + '이후 값은 화면·귀와 다른 컬럼에 기록된다(유실이 아니라 「틀린 자리에 맞는 값」)',
  ).toEqual([]);
  await expect(
    page.locator('[data-testid="active-row"]'),
    '같은 피해의 다른 얼굴 — 커서가 떠나온 행으로 돌아와 있다',
  ).toHaveText('2');

  const extras = await logExtras(page);
  expect(
    extras,
    '착지 거절이 로그에 없다 — 가드가 실제로 발동한 자리를 증명하지 못한다',
  ).toContain('proceed_refused:epoch');

  // 막지 않아야 할 것: 커밋과 부기는 경합과 무관하게 끝났다(좌표가 커밋된 행이라 커서와 별개다).
  await expect
    .poll(async () => (await persistedRow(page, 1))?.values.m2, { timeout: 8000 })
    .toBe('66.6');
});

// ── ④ #8 과잉 수정 반증 — 경합자가 없으면 예약 복귀 착지는 종전 그대로다 ─────────────
test('④ 과잉 수정 반증 — 경합자가 없는 정정은 셀 검토 대기로 그대로 복귀한다', async ({ page }) => {
  await bootWith(page, MINI_COLUMNS, MINI_HEADERS, MINI_ROWS, 'c48-4');

  await fireStt(page, '95.5', 900);
  await fireStt(page, '88.8', 900);
  await fireStt(page, '77.7', 1500);
  await waitForTtsIdle(page);
  await expect
    .poll(async () => (await persistedRow(page, 1))?.complete, { timeout: 8000 })
    .toBe(true);

  await fireStt(page, '이전행', 1500);
  await waitForTtsIdle(page);
  await fireStt(page, '다음', 1200);
  await waitForTtsIdle(page);
  await fireStt(page, '수정', 1500);
  await waitForTtsIdle(page);
  await fireStt(page, '66.6', 1800);
  await waitForTtsIdle(page);

  // [NAV-FILLED-CELL-1] 「cellWait에서의 모든 탈출은 cellWait 재진입」 — epoch 가드가 이걸 먹으면
  //   정정이 문맥 밖으로 튀어 나간다. 그게 이 과제가 경계한 과잉 수정의 얼굴이다.
  //
  // 🔴 v0.50 fixdc U3 — **여기가 false-green이었다.** 종전 단언 셋은 전부 **정정 «전»에 이미
  //   성립**한다: `active-row=1`·m2 활성 칩은 선행 '다음'의 착지가 만든 상태고, 그 착지가
  //   이미 `측정항목02 기록값 88.8.`을 TTS 로그에 남긴다 — 그래서 사후 `toContain('기록값')`이
  //   **갱신값 66.6의 재착지 없이도** 만족했다. codex가 반증까지 냈다: `proceedAfterCommit`의
  //   `cellWait` 분기를 **즉시 return으로 바꿔도 통과**한다.
  //   👉 ③에서 쓴 것과 같은 **순서 판정**으로 바꾼다 — 「커밋 뒤에 새 착지가 왔는가」를 잰다.
  //   (같은 회차에서 한 번 배운 것을 나머지에 전파하지 않은 형태였다. ①②⑤도 함께 훑었다.)
  const trace4 = await logTrace(page);
  const valueAt4 = lastIndexWhere(trace4, (e) => e.startsWith('value/66.6'));
  expect(valueAt4, '전제: 정정값이 실제로 커밋됐다').toBeGreaterThanOrEqual(0);
  expect(
    trace4.slice(valueAt4).filter((e) => e.includes('command/cell_wait cell_wait:m2')),
    '정정 커밋 뒤에 셀 검토 대기 재착지가 없다 — 예약 복귀가 통째로 막혔다'
      + '([NAV-FILLED-CELL-1] 「모든 탈출은 cellWait 재진입」 위반)',
  ).not.toEqual([]);
  // 낭독도 **갱신값**을 요구한다 — 선행 착지가 남긴 `기록값 88.8`로는 만족되지 않는다.
  expect(
    await ttsLog(page),
    '갱신값 재낭독이 없다 — 옛 값의 낭독이 남아 있어도 그건 이 정정의 착지가 아니다',
  ).toContain('측정항목02 기록값 66.6.');
  await expect(page.locator('[data-testid="active-row"]')).toHaveText('1');
  expect(await activeChipName(page), '정상 착지가 거절돼 셀 검토 문맥이 증발했다').toContain('측정항목02');

  const extras = await logExtras(page);
  expect(
    extras.filter((e) => e === 'proceed_refused:epoch'),
    '경합자가 없는데 착지를 거절했다 — 가드가 정상 흐름을 먹는다',
  ).toEqual([]);
});

// ── ⑥ U1 회귀 — 정상 재개(resume)를 착지 가드가 「경합자」로 잡으면 안 된다 ──────────────
/** 🔴 v0.50 fixdc U1 — **이 묶음의 #8 처방이 만든 회귀**다. 리뷰 양측(revc·codex)이 서로 다른
 *  진입로로 독립 재현했다.
 *
 *  기제: `resume()`은 `epochRef`를 **0으로 리셋**한다(`start()`도 같다). 신규 착지 가드는
 *  「진입 때 잡은 값과 다른가」만 보므로 **정상 재개를 사용자 이동과 구별하지 못한다.**
 *  `jumpToRow`류가 안전한 이유는 커서를 옮긴 뒤 **자기 착지로 `awaiting`을 새로 무장**하기
 *  때문인데, `resume()`은 **epoch만 바꾸고 `awaiting`은 기존 것을 읽어 복원**한다 —
 *  그 비대칭이 결함의 정체다.
 *
 *  피해(실측): 착지가 거절돼 전진이 사라지고, 재개가 **확정값이 든 셀을 다시 연다**
 *  (`[CELL-OVERWRITE-1]` 재개방). 이어지는 발화가 **확정값을 덮는다** — 값 손상이다.
 *
 *  🔴 **창을 실제로 열어야 한다.** 오라클 ②가 이 결함을 놓친 이유는 중간의 `waitForTtsIdle`이
 *  `proceedAfterCommit`을 **완주시킨 뒤에** 재시작을 보냈기 때문이다(창이 닫힌 채로 돈다).
 *  여기서는 `__survey011DelaySessionPutMs`로 부기 put을 붙잡아 둔 채 pause→resume을 끼운다.
 *  ⚠️ `finalizeRowCompletion`은 **멱등**이라 창은 「그 커밋이 행을 완성시키는 **첫** 부기」인
 *  호출부에서만 열린다(선행 부기가 있는 `commitManualValue` 경유는 no-op이라 창이 없다 — 실측).
 *  그래서 ⑥은 **음성 커밋 종단**, ⑦은 **알람 [확인] 터치**를 쓴다. 둘 다 선행 부기가 없다. */
test('⑥ U1 — 착지 부기 중의 정상 재개가 착지를 죽이고 확정값을 덮게 하지 않는다', async ({ page }) => {
  await bootWith(page, SOLO_COLUMNS, SOLO_HEADERS, SOLO_ROWS, 'c48-6');

  await page.evaluate(() => {
    (window as unknown as { __survey011DelaySessionPutMs?: number }).__survey011DelaySessionPutMs = 4000;
  });
  // 음성 컬럼이 하나뿐 → 이 커밋이 1행을 완성시키고, `proceedAfterCommit`의 부기가 **첫 put**이다.
  await fireStt(page, '95.5', 0);
  // 🔴 `waitForTtsIdle`을 쓰지 않는다 — 그게 ②가 창을 닫아 이 결함을 놓친 이유다.
  await page.waitForTimeout(900); // echo TTS + 호출부 진입 가드를 지나 부기 await 안으로

  await page.locator('[data-testid="voice-status-control"]').click(); // 터치 일시정지
  await expect(page.locator('[data-testid="paused-card"]'), '전제: 부기 중에 일시정지가 걸렸다')
    .toBeVisible({ timeout: 6000 });
  await page.locator('[data-testid="voice-control-toggle-pause"]').click(); // 터치 재시작
  await expect(page.locator('[data-testid="paused-card"]'), '전제: 재개됐다').toHaveCount(0, { timeout: 6000 });

  // 🔴 v0.50 fixdc2 RD-4 — **창이 열렸음을 단언한다.** 종전엔 「echo onend 200ms < pause 900ms」라는
  //   mock 타이밍 «수치»만이 창을 열고 있었다 — TTS 지연이 바뀌거나 부팅 안내가 길어지면 재개가
  //   스냅샷보다 **앞서** 들어가 가드가 자명하게 통과하고, **처방을 되돌려도 green**이 된다
  //   (1회전이 ②에서 당한 그 형태다). 여기서 잰다: 이 시점에 행 완료 낭독이 아직 «없다» =
  //   붙잡힌 put이 결말나지 않았다 = `proceedAfterCommit`의 await 구간 «안»에서 재개했다.
  expect(
    await ttsLog(page),
    '재개 시점에 이미 행 완료 낭독이 났다 — 착지가 완주한 «뒤»라 창이 닫힌 채로 도는 것이다(RD-4)',
  ).not.toContain('조사나무 1 완료.');

  await page.evaluate(() => {
    delete (window as unknown as { __survey011DelaySessionPutMs?: number }).__survey011DelaySessionPutMs;
  });
  // 🔴 레이스 창은 **위 seam 해제로 닫혔다.** 아래 대기는 「창 닫기」가 아니라 **관측 안정화**다 —
  //   붙잡아 둔 put이 결말나고 착지 체인(행 완료 낭독 → 다음 행 이동 → 항목 안내)이 완주해야
  //   「착지가 살았는가」를 잴 수 있다. ⚠️ 이걸 빼면 이어지는 발화가 **안내 TTS 중 barge-in**으로
  //   들어가 값이 어디에도 안 앉는다(실측: 3/3 재현).
  await page.waitForTimeout(2500);
  await waitForTtsIdle(page);

  const extras = await logExtras(page);
  expect(
    extras.filter((e) => e === 'proceed_refused:epoch'),
    '정상 재개를 「경합자」로 잡아 착지를 거절했다 — resume은 커서를 옮기지 않고 '
      + '기존 awaiting을 읽어 복원하므로, 거절하면 그 착지가 갱신하려던 상태가 통째로 유실된다(U1)',
  ).toEqual([]);

  // RD-4 두 번째 축(③과 같은 형태) — 재개가 커밋 착지 «진입 뒤»에 들어왔다. `value` 로그는
  //   `useCommitLanding`의 `proceedAfterCommit` 직전에, `command/resume`은 `resetEpoch()` 직전에
  //   찍힌다 — 두 지점이 정확히 창의 양 끝이다.
  const trace6 = await logTrace(page);
  const valueAt6 = lastIndexWhere(trace6, (e) => e.startsWith('value/95.5'));
  const resumeAt6 = lastIndexWhere(trace6, (e) => e.startsWith('command/resume'));
  expect(valueAt6, '전제: 값이 실제로 커밋됐다').toBeGreaterThanOrEqual(0);
  expect(
    resumeAt6,
    '재개가 착지 진입보다 앞에 들어갔다 — 스냅샷 자체가 재개 뒤라 가드가 자명하게 통과한다(RD-4)',
  ).toBeGreaterThan(valueAt6);

  // 착지 생존의 **직접 증거** — 죽었으면 커서가 1행 m1에 그대로 남는다(처방 전 실측: `1`).
  await expect(
    page.locator('[data-testid="active-row"]'),
    '착지가 죽어 다음 행으로 전진하지 못했다 — 재개가 경합자로 잡혔다는 뜻이다',
  ).toHaveText('2');

  // 🔴 피해의 본체 — 재개 뒤 **다음 발화가 어디로 가는가**. 착지가 죽으면 커서가 1행 m1에
  //   그대로 남고 재개가 그 확정 셀을 `kind:'value'`로 다시 열어 다음 값이 95.5를 덮는다.
  await fireStt(page, '42.3', 1800);
  await waitForTtsIdle(page);
  expect(
    (await persistedRow(page, 1))?.values.m1,
    '재개가 확정된 1행 값을 다시 열어 다음 발화가 그것을 덮었다 — [CELL-OVERWRITE-1] 재개방(값 손상)',
  ).toBe('95.5');
  await expect
    .poll(async () => (await persistedRow(page, 2))?.values.m1, { timeout: 8000 })
    .toBe('42.3');
});

// ── ⑦ U1 두 번째 진입로 — 알람 [확인] 터치의 착지도 같은 창을 갖는다 ────────────────────
test('⑦ U1 — 알람 [확인] 터치의 착지 부기 중 재개도 착지를 죽이지 않는다', async ({ page }) => {
  await bootWith(page, ALERT_COLUMNS, SOLO_HEADERS, SOLO_ROWS, 'c48-7');

  // 직전 회차 100.0 대비 과도 증가 → 이상치 응답 대기(trendConfirm). 값은 이미 커밋돼 있고
  //   행 완료 부기는 **아직**이다 — 그래서 [확인]의 `proceedAfterCommit`이 첫 부기를 탄다.
  await fireStt(page, '120.5', 1500);
  const popup = page.locator('[data-testid="anomaly-alert"]');
  await expect(popup, '전제: 이상치 응답 대기가 섰다').toBeVisible({ timeout: 8000 });

  await page.evaluate(() => {
    (window as unknown as { __survey011DelaySessionPutMs?: number }).__survey011DelaySessionPutMs = 4000;
  });
  await page.locator('[data-testid="anomaly-confirm-btn"]').click(); // confirmAnomalyTouch
  await page.waitForTimeout(700);

  await page.locator('[data-testid="voice-status-control"]').click();
  await expect(page.locator('[data-testid="paused-card"]'), '전제: 부기 중에 일시정지가 걸렸다')
    .toBeVisible({ timeout: 6000 });
  await page.locator('[data-testid="voice-control-toggle-pause"]').click();
  await expect(page.locator('[data-testid="paused-card"]'), '전제: 재개됐다').toHaveCount(0, { timeout: 6000 });

  // 🔴 v0.50 fixdc2 RD-4 — ⑥과 같은 축. 창이 안 열려도 green이 되던 것을 여기서 막는다.
  expect(
    await ttsLog(page),
    '재개 시점에 이미 행 완료 낭독이 났다 — 착지가 완주한 «뒤»라 창이 닫힌 채로 도는 것이다(RD-4)',
  ).not.toContain('조사나무 1 완료.');

  await page.evaluate(() => {
    delete (window as unknown as { __survey011DelaySessionPutMs?: number }).__survey011DelaySessionPutMs;
  });
  // 🔴 레이스 창은 **위 seam 해제로 닫혔다.** 아래 대기는 「창 닫기」가 아니라 **관측 안정화**다 —
  //   붙잡아 둔 put이 결말나고 착지 체인(행 완료 낭독 → 다음 행 이동 → 항목 안내)이 완주해야
  //   「착지가 살았는가」를 잴 수 있다. ⚠️ 이걸 빼면 이어지는 발화가 **안내 TTS 중 barge-in**으로
  //   들어가 값이 어디에도 안 앉는다(실측: 3/3 재현).
  await page.waitForTimeout(2500);
  await waitForTtsIdle(page);

  expect(
    (await logExtras(page)).filter((e) => e === 'proceed_refused:epoch'),
    '알람 [확인] 경로에서도 정상 재개가 「경합자」로 잡혔다 — 진입로마다 막으면 다음 진입로가 남는다',
  ).toEqual([]);

  // RD-4 두 번째 축 — 재개가 [확인] 터치(=착지 진입)보다 뒤다.
  const trace7 = await logTrace(page);
  const confirmAt7 = lastIndexWhere(trace7, (e) => e.startsWith('command/confirm touch'));
  const resumeAt7 = lastIndexWhere(trace7, (e) => e.startsWith('command/resume'));
  expect(confirmAt7, '전제: [확인] 터치가 실제로 접수됐다').toBeGreaterThanOrEqual(0);
  expect(
    resumeAt7,
    '재개가 [확인]보다 앞에 들어갔다 — 스냅샷 자체가 재개 뒤라 가드가 자명하게 통과한다(RD-4)',
  ).toBeGreaterThan(confirmAt7);

  // 🔑 이 케이스의 판정축은 **「착지가 살았는가」**다 — 값 귀속의 상세(다음 발화가 어디로 가는가)는
  //   ⑥이 같은 기제로 이미 잰다. 여기서 후속 발화까지 얹으면 알람 해제 뒤 TTS 체인이 길어
  //   **발화가 간헐적으로 씹혀 1/2 flaky**가 됐다(실측) — 같은 축을 두 번 재면서 안정성만 잃는다.
  //   아래 셋으로 비공허하게 잠근다: 거절 없음 · 전진했음 · 착지 체인이 실제로 완주했음.
  await expect(
    page.locator('[data-testid="active-row"]'),
    '착지가 죽어 다음 행으로 전진하지 못했다 — 재개가 경합자로 잡혔다는 뜻이다(처방 전 실측: 1)',
  ).toHaveText('2');
  expect(
    await ttsLog(page),
    '행 완료 낭독이 없다 — 착지 체인이 아예 안 돌았다면 위 두 단언은 공허하다',
  ).toContain('조사나무 1 완료.');
  expect(
    (await persistedRow(page, 1))?.values.m1,
    '확정된 1행 값이 바뀌었다',
  ).toBe('120.5');
});

// ── ⑨ RD-1 — advance의 «기존» 안내 뒤 재확인 3곳이 정상 재개를 경합자로 잡는다 ────────────
/** 🔴 v0.50 fixdc2 RD-1(blocker) — 1회전이 닫은 것은 이 묶음이 **새로 만든** 가드 2곳뿐이고,
 *  `advance`의 형제 셋(`announceRowComplete` 뒤 · 예약 복귀 안내 뒤 · 다음 행 안내 뒤)은
 *  `epochRef.current !== startEpoch` 생값 비교를 그대로 갖고 있었다.
 *
 *  **창은 put이 아니라 TTS다.** `advance()`는 일시정지 중에도 끝까지 돈다(`setLandingPhase`가
 *  phase만 보류한다 — 오라클 ①이 `advance_phase_held:paused:row_complete`와 `:next_row`를
 *  **둘 다** 남기는 것이 그 증명이다). 그 사이 「…완료.」 낭독은 실기기 **≈1.095초**(P-2 계측)이고
 *  phase 게이트가 없다 — **행 완료마다 ~1초짜리 창**이다. 여기서 마이크를 탭하면 `resetEpoch()`가
 *  0을 만들고, 낭독이 끝난 `:915`가 `0 !== startEpoch`로 **return**한다.
 *
 *  피해는 **영구**다: `advance`가 죽어 커서가 완료 행에 고착하고 `awaiting`은 이미 null이라
 *  재개의 폴스루가 그 확정 셀을 `kind:'value'`로 연다 — **아무도 커서를 옮겨 주지 않는다.**
 *  이어지는 발화가 확정값을 덮는다([CELL-OVERWRITE-1] 재개방).
 *
 *  🔑 창을 mock TTS 길이(`__ttsOnendDelayMs`)로 «넓혀» 결정론으로 만든다 — 200ms 기본값에
 *  클릭을 맞추면 부하 회차에서 조용히 창 밖으로 나간다(1회전 ②가 당한 형태).
 *  ⚠️ 형제 둘(`:936`·`:995`)은 트립해도 재개의 폴스루가 그 자리에서 `awaiting`을 다시 무장하므로
 *  (커서는 이미 옮겨진 뒤다) **행동으로 갈리지 않는다** — 그 둘은 ⑤의 구조 단언이 잠근다. */
test('⑨ RD-1 — 행 완료 낭독 중의 재개를 advance가 「경합자」로 잡아 커서를 고착시키지 않는다', async ({ page }) => {
  await bootWith(page, SOLO_COLUMNS, SOLO_HEADERS, SOLO_ROWS, 'c48-9');
  const pausedCard = page.locator('[data-testid="paused-card"]');

  await fireStt(page, '일시 정지', 1200);
  await waitForTtsIdle(page);
  await expect(pausedCard, '전제: 일시정지에 들어갔다').toBeVisible({ timeout: 4000 });

  // 창을 넓힌다 — 이 축의 창은 `await announceRowComplete(row)`의 길이 그 자체다.
  await page.evaluate(() => {
    (window as unknown as { __ttsOnendDelayMs?: number }).__ttsOnendDelayMs = 3000;
  });
  // 음성 컬럼이 하나뿐이라 이 커밋 하나가 행을 완성시키고 `advance`가 행 경계를 밟는다.
  await manualCommit(page, '측정항목01', ['9', '5', '.', '5']);
  // mock은 speak() «시점»에 로그를 적재한다 → 이 폴링이 참이 된 순간이 곧 낭독 «시작»이다.
  await expect
    .poll(async () => (await ttsLog(page)).includes('조사나무 1 완료.'), { timeout: 20000 })
    .toBe(true);
  // 🔴 창 개방의 직접 증거 — 낭독이 «마지막» 발화다(끝났다면 다음 안내가 이미 로그에 있다).
  const midTts = await ttsLog(page);
  expect(
    midTts[midTts.length - 1],
    '행 완료 낭독이 이미 끝났다 — 창 밖에서 재개하므로 이 오라클은 아무것도 재지 않는다',
  ).toBe('조사나무 1 완료.');

  // 낭독 «중»의 마이크 탭 — 이 리셋은 `advance` **안**에서 일어난다(그게 이 건의 전부다).
  await page.locator('[data-testid="voice-control-toggle-pause"]').click();
  await expect(pausedCard, '전제: 재개됐다').toHaveCount(0, { timeout: 6000 });
  // 재개 체인은 다시 짧게 — 착지가 깨어나기 전에 끝나야 두 체인이 서로를 덮지 않는다.
  await page.evaluate(() => {
    (window as unknown as { __ttsOnendDelayMs?: number }).__ttsOnendDelayMs = 200;
  });

  await page.waitForTimeout(3500); // 붙잡힌 낭독이 결말나고 착지 체인이 완주할 때까지
  await waitForTtsIdle(page);

  // 순서 전제 — 재개가 커밋 «뒤»에 들어왔다(앞이면 리셋이 advance 밖이라 이 축이 아니다).
  const trace = await logTrace(page);
  // 수동 시트 커밋은 `command/manual_commit touch`로 남는다(음성 커밋의 `value/…`가 아니다).
  const commitAt = lastIndexWhere(trace, (e) => e.startsWith('command/manual_commit'));
  const resumeAt = lastIndexWhere(trace, (e) => e.startsWith('command/resume'));
  expect(commitAt, '전제: 수동 커밋이 실제로 일어났다').toBeGreaterThanOrEqual(0);
  expect(resumeAt, '재개가 커밋보다 앞이다 — 리셋이 advance 안에서 일어나지 않았다').toBeGreaterThan(commitAt);

  await expect(
    page.locator('[data-testid="active-row"]'),
    '착지가 죽어 커서가 완료 행에 고착했다 — 재개를 경합자로 잡은 결과다(RD-1, 처방 전 실측: 1)',
  ).toHaveText('2');

  // 🔴 피해의 본체 — 고착한 커서 위에서 재개가 확정 셀을 다시 열고, 다음 발화가 그것을 덮는다.
  await fireStt(page, '42.3', 1800);
  await waitForTtsIdle(page);
  expect(
    (await persistedRow(page, 1))?.values.m1,
    '재개가 확정된 1행 값을 다시 열어 다음 발화가 그것을 덮었다 — 회복 불가다(RD-1의 영구 갈래)',
  ).toBe('95.5');
  await expect
    .poll(async () => (await persistedRow(page, 2))?.values.m1, { timeout: 8000 })
    .toBe('42.3');
});

// ── ⑪ RD-3(a) — 경합자 bump «뒤에» 리셋이 와도 그 bump는 지워지지 않는다 ────────────────────
/** 🔴 v0.50 fixdc2 RD-3 — 1회전 처방은 리셋을 **기준선 교체**로 다뤘다(기준선 ← 리셋 직후 값 0).
 *  그래서 **리셋 이전의 bump가 흔적 없이 사라졌다**: 착지 창 안에서 행을 옮기고(bump + 자기 착지로
 *  `awaiting` 재무장) **그다음** 일시정지→재시작하면 낡은 착지가 **통과해** 방금 무장된 남의
 *  `awaiting`을 지우고 커서를 되끈다 — #8이 닫으려던 「틀린 자리에 맞는 값」 그 자체다.
 *
 *  현장 개연성이 높다: put이 멎으면 사용자는 **「이동해 본다 → 안 되면 마이크를 두 번 눌러 본다」**.
 *
 *  ③과 같은 무대에 **재개 한 번**을 더한 것이 이 케이스다 — ③이 green인데 여기가 red면 구멍의
 *  정체가 「리셋이 bump를 지운다」로 특정된다. */
test('⑪ RD-3 — 행 이동 «뒤»의 재개가 낡은 착지를 되살려 커서를 되끌지 않는다', async ({ page }) => {
  await bootWith(page, MINI_COLUMNS, MINI_HEADERS, MINI_ROWS, 'c48-11');

  await fireStt(page, '95.5', 900);
  await fireStt(page, '88.8', 900);
  await fireStt(page, '77.7', 1500);
  await waitForTtsIdle(page);
  await expect
    .poll(async () => (await persistedRow(page, 1))?.complete, { timeout: 8000 })
    .toBe(true);

  await fireStt(page, '이전행', 1500);
  await waitForTtsIdle(page);
  await fireStt(page, '다음', 1200);
  await waitForTtsIdle(page);
  expect(await activeChipName(page), '전제: 셀 검토 대기가 m2에 섰다').toContain('측정항목02');
  await fireStt(page, '수정', 1500);
  await waitForTtsIdle(page);

  // 창을 넓게 잡는다 — 이 케이스는 창 안에서 **두 사건**(이동 → 재개)을 연달아 끼워야 한다.
  await page.evaluate(() => {
    (window as unknown as { __survey011DelaySessionPutMs?: number }).__survey011DelaySessionPutMs = 4000;
  });
  await fireStt(page, '66.6', 0);
  await page.waitForTimeout(900);
  await jumpViaAutoChip(page, '2'); // ① 경합자 bump — 자기 착지로 awaiting을 새로 무장한다
  await page.waitForTimeout(300);
  await page.locator('[data-testid="voice-status-control"]').click(); // ② 그 «뒤»의 일시정지
  await expect(page.locator('[data-testid="paused-card"]'), '전제: 아직 부기 중에 일시정지가 걸렸다')
    .toBeVisible({ timeout: 6000 });
  await page.locator('[data-testid="voice-control-toggle-pause"]').click(); // …그리고 재시작 = 리셋
  await expect(page.locator('[data-testid="paused-card"]'), '전제: 재개됐다').toHaveCount(0, { timeout: 6000 });

  await page.evaluate(() => {
    delete (window as unknown as { __survey011DelaySessionPutMs?: number }).__survey011DelaySessionPutMs;
  });
  await page.waitForTimeout(3000);
  await waitForTtsIdle(page);

  const trace = await logTrace(page);
  const valueAt = lastIndexWhere(trace, (e) => e.startsWith('value/66.6'));
  const jumpAt = lastIndexWhere(trace, (e) => e.includes('command/jump touch:1->2'));
  const resumeAt = lastIndexWhere(trace, (e) => e.startsWith('command/resume'));
  expect(valueAt, '전제: 정정값이 실제로 커밋됐다').toBeGreaterThanOrEqual(0);
  expect(
    jumpAt,
    '행 이동이 착지 진입보다 앞이다 — 호출부 가드가 먼저 잡으므로 이 오라클은 공허하다',
  ).toBeGreaterThan(valueAt);
  // 🔴 이 케이스의 정체 — 리셋이 **bump 뒤에** 왔다. 앞이면 그냥 ③이다.
  expect(
    resumeAt,
    '재개가 행 이동보다 앞이다 — 「bump 뒤 리셋」 순서가 성립하지 않아 RD-3 축이 아니다',
  ).toBeGreaterThan(jumpAt);

  expect(
    trace.slice(jumpAt).filter((e) => e.includes('command/cell_wait cell_wait:m2')),
    '재개가 낡은 착지를 되살렸다 — 리셋이 경합자 bump를 지워 「내 스냅샷 이후 이동이 있었나」를 '
      + '판정할 수 없게 된 것이 근인이다(RD-3a)',
  ).toEqual([]);
  await expect(
    page.locator('[data-testid="active-row"]'),
    '같은 피해의 다른 얼굴 — 커서가 사용자가 떠나온 행으로 되끌렸다',
  ).toHaveText('2');
  expect(
    await logExtras(page),
    '착지 거절이 로그에 없다 — 가드가 실제로 발동한 자리를 증명하지 못한다',
  ).toContain('proceed_refused:epoch');

  // 막지 않아야 할 것 — 값과 부기는 경합·재개와 무관하게 끝났다.
  await expect
    .poll(async () => (await persistedRow(page, 1))?.values.m2, { timeout: 8000 })
    .toBe('66.6');
});

// ── ⑤ 구조 — 우회 지점이 다시 생기면 red ────────────────────────────────────────────
test('[node] ⑤ advance의 국면 전이 4곳은 한 헬퍼를 지나고, 두 함수의 epoch 재확인은 파괴적 쓰기 앞이다', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync('src/lib/useVoiceSession.ts', 'utf-8');

  /** 주석 줄은 걷어낸다 — 근거 주석이 옛 코드를 인용하므로 산문을 세면 계약이 영영 red다
   *  (`v049-r3-01` ①c가 실측으로 걸린 그 함정). */
  const strip = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');

  const advFrom = src.indexOf('const advance = useCallback(');
  const procFrom = src.indexOf('const proceedAfterCommit = useCallback(');
  expect(advFrom, 'advance를 찾지 못했다 — 이름이 바뀌었으면 이 계약도 함께 옮겨라').toBeGreaterThan(0);
  expect(procFrom, 'proceedAfterCommit을 찾지 못했다').toBeGreaterThan(advFrom);
  const advance = strip(src.slice(advFrom, procFrom));
  const proceed = strip(src.slice(procFrom, src.indexOf('}, [advance,', procFrom)));

  // ⓐ #4 — 국면 전이의 소유자는 하나다(사본이 다시 생기면 red · [LANDING-OWNER-1]의 형태).
  expect(
    advance.match(/setLandingPhase\(/g) ?? [],
    'advance의 국면 전이 4곳(행 완료·예약 복귀·gap-return·다음 행)이 헬퍼를 지나지 않는다',
  ).toHaveLength(4);
  expect(
    advance,
    'advance가 phase를 직접 쓴다 — armLanding의 일시정지 보류를 그대로 우회한다(claude r2 #4)',
  ).not.toContain('sess.setPhase(');
  // ⓑ allowlist여야 한다(GL-004 [ORCH-25]) — 「paused면 막는다」는 blocklist라 stopping이 샌다.
  expect(
    advance,
    '국면 가드가 blocklist다 — 열거에서 빠진 국면(stopping 등)이 그대로 덮인다',
  ).toContain("live.phase !== 'active' && live.phase !== 'complete'");
  // ⓒ 진입 스냅샷이 아니라 **매번 새로 읽는다**(await 뒤 phase 쓰기 + pause()는 epoch를 안 올린다).
  expect(
    advance.slice(advance.indexOf('const setLandingPhase'), advance.indexOf('const setLandingPhase') + 400),
    '헬퍼가 진입 스냅샷(sess)을 읽는다 — await 구간에 들어온 일시정지가 안 보인다',
  ).toContain('const live = useSessionStore.getState();');

  // ⓓ #8 형제 창 — 재확인이 파괴적 쓰기 **앞**에 있어야 한다. 뒤에 있으면 이미 지운 뒤다.
  const rowComplete = advance.indexOf("setLandingPhase('complete', 'row_complete')");
  const finalizeGate = advance.indexOf('if (!(await finalizeRowCompletion(row))) {');
  expect(finalizeGate, 'advance의 행 완료 부기를 찾지 못했다').toBeGreaterThan(0);
  expect(
    advance.slice(finalizeGate, rowComplete),
    '부기와 파괴적 쓰기 사이에 epoch 재확인이 없다 — 방금 무장된 남의 awaiting을 지운다(claude r2 #8)',
  ).toContain('if (!landingEpochHeld(landingSnap)) return;');

  // ⓔ #8 본체 — 진입 스냅샷 + 재확인이 부기 **뒤**·착지 **앞**이다.
  expect(
    proceed,
    'proceedAfterCommit이 진입 시점 스냅샷을 잡지 않는다 — 함수 안의 await 구간이 무방비다',
  ).toContain('const landingSnap = snapLandingEpoch();');
  const bookkeeping = proceed.indexOf('if (awaiting && !(await finalizeRowCompletion(awaiting.row))) {');
  const firstLanding = proceed.indexOf("if (awaiting?.kind === 'reviewWait') {");
  const recheck = proceed.indexOf('if (!landingEpochHeld(landingSnap)) {');
  expect(bookkeeping, '커밋 종단의 부기를 찾지 못했다').toBeGreaterThan(0);
  expect(firstLanding, '첫 착지 분기를 찾지 못했다').toBeGreaterThan(bookkeeping);
  expect(
    recheck,
    '재확인이 부기보다 앞이다 — 부기를 건너뛰면 그 행이 persistSession의 rows에서 통째로 떨어진다(Z8)',
  ).toBeGreaterThan(bookkeeping);
  expect(
    recheck,
    '재확인이 착지 분기보다 뒤다 — 낡은 예약이 이미 커서를 끌고 간 뒤다',
  ).toBeLessThan(firstLanding);
  expect(proceed, '착지 거절을 로그에 남기지 않으면 분석에서 「착지가 없었다」와 구별되지 않는다')
    .toContain('proceed_refused:epoch');

  // ── ⓕ v0.50 fixdc U1 / fixdc2 RD-1·RD-3·RD-6 — 재개는 「경합자」가 아니고, 경합자는 리셋으로
  //    지워지지 않는다. 그 둘 중 하나라도 무너지면 값 손상이 재개방된다. ──
  const whole = strip(src);

  // 🔴 fixdc2 RD-6 — 리셋 소유권 스캔은 **계약이 사는 범위**를 본다. `epochRef`는 6개 모듈에 ref
  //   그대로 주입되고 그 전부가 이미 이 ref를 변이한다 — 그중 어디에 리셋이 추가되면
  //   `landingEpochHeld`에도, 이 파일만 세던 종전 오라클에도 **안 보인다.**
  const libDir = 'src/lib';
  const libFiles = fs.readdirSync(libDir).filter((f: string) => f.endsWith('.ts'));
  const resetSites = libFiles.flatMap((f: string) => {
    const body = strip(fs.readFileSync(`${libDir}/${f}`, 'utf-8'));
    return (body.match(/epochRef\.current\s*=\s*0\s*;/g) ?? []).map(() => f);
  });
  expect(
    resetSites,
    'epochRef 리셋이 useVoiceSession 밖(또는 여러 곳)에 있다 — resetEpoch() 하나가 소유해야 '
      + '착지 가드가 리셋 전부를 본다. 스캔 범위는 계약이 사는 범위(src/lib 전체)다',
  ).toEqual(['useVoiceSession.ts']);
  expect(
    whole.match(/resetEpoch\(/g) ?? [],
    '리셋 호출부가 둘(start·resume)이 아니다 — 하나가 빠지면 그 경로의 재개가 다시 경합자로 잡힌다',
  ).toHaveLength(2);

  // 🔴 `resume()`이 리셋 소유자를 지나되 **자기 bump 흡수량을 함께 넘긴다**(fixdc2 RD-3).
  const resumeFrom = src.indexOf('const resume = useCallback(');
  expect(resumeFrom, 'resume을 찾지 못했다').toBeGreaterThan(0);
  expect(
    strip(src.slice(resumeFrom, resumeFrom + 1600)),
    'resume이 재개 «자신»의 bump를 흡수하지 않는다 — 음성 재시작이 스스로를 경합자로 만든다(U1)',
  ).toContain("resetEpoch({ ownBumps: source === 'voice' ? 1 : 0 });");
  // 🔴 `start()`는 세션 배리어다 — 옛 세션의 착지가 새 세션의 첫 셀 무장을 지운다(RD-3b).
  const startFrom = src.indexOf('const start = useCallback(');
  expect(startFrom, 'start를 찾지 못했다').toBeGreaterThan(0);
  expect(
    strip(src.slice(startFrom, src.indexOf('const stop = useCallback(', startFrom))),
    'start의 리셋이 세션 배리어가 아니다 — 옛 세션의 낡은 착지가 새 세션에서 되살아난다(RD-3b)',
  ).toContain('resetEpoch({ newSession: true });');

  // 🔴 fixdc2 RD-3 — 가드는 **누계(순서)와 세션 세대(출처)를 함께** 본다. 어느 한쪽만으로는
  //   판별력(bump 17곳 거절)과 U1 해소(재개 통과)를 동시에 만족할 수 없다.
  const helper = strip(src.slice(src.indexOf('const resetEpoch ='), src.indexOf('const logCell =')));
  expect(
    helper,
    '착지 가드가 이동 누계를 안 본다 — 리셋이 그 이전의 bump를 지워 「이동 → 재개」가 통과한다(RD-3a)',
  ).toContain('landingMoves() === snap.moves');
  expect(
    helper,
    '착지 가드가 세션 세대를 안 본다 — stop→start를 넘겨 살아남은 착지가 통과한다(RD-3b)',
  ).toContain('epochResetRef.current.sessionGen === snap.sessionGen');
  expect(
    helper,
    '흡수가 누계를 «줄일» 수 있다 — 단조성이 깨지면 낡은 착지가 뒤늦은 진짜 bump와 상쇄돼 통과한다',
  ).toContain('Math.max(0, epochRef.current - (opts?.ownBumps ?? 0))');

  // 🔴 fixdc2 RD-1 — `advance`의 재확인 **4곳 전부**가 리셋 보정을 받는다. 생값 비교가 하나라도
  //   남으면 그 자리에서 정상 재개가 경합자로 잡힌다(`:915` 축은 피해가 **영구**다).
  expect(
    advance.match(/landingEpochHeld\(landingSnap\)/g) ?? [],
    'advance의 재확인 4곳(부기 뒤 · 행 완료 낭독 뒤 · 예약 복귀 안내 뒤 · 다음 행 안내 뒤)이 '
      + '전부 리셋 보정을 받지 않는다 — 남은 자리가 정상 재개를 죽인다(RD-1)',
  ).toHaveLength(4);
  expect(
    advance,
    'advance가 epoch 생값을 다시 비교한다 — 리셋이 이 함수 안에서 일어나면 재개가 경합자가 된다(RD-1)',
  ).not.toContain('startEpoch');

  // 🔴 fixdc2 RD-3 — `ownBumps: 1`의 전제는 **소유 파일 밖**에 산다. `pausedResume`이 `++` 직후
  //   동기로 `resume('voice')`를 부르는 형태가 깨지면 흡수량이 조용히 틀어진다(그 사이에 await가
  //   생기면 다른 bump가 낄 수 있고, 그러면 경합자가 흡수돼 값 손상이 된다). 형태로 잠근다.
  const fcSrc = strip(fs.readFileSync('src/lib/useFinalCommands.ts', 'utf-8'));
  const prFrom = fcSrc.indexOf("action.act === 'pausedResume'");
  expect(prFrom, 'pausedResume 분기를 찾지 못했다 — 이름이 바뀌었으면 이 계약도 함께 옮겨라').toBeGreaterThan(0);
  expect(
    fcSrc.slice(prFrom, prFrom + 400).replace(/\s+/g, ' '),
    "pausedResume의 「++ → cancelTts() → await resume('voice')」 인접이 깨졌다 — "
      + 'useVoiceSession의 ownBumps:1 흡수가 그 인접에만 근거한다(그 자리 주석 참조)',
  ).toContain("epochRef.current++; cancelTts(); await resumeRef.current('voice');");
});

// ── ⑧ U4 — 소비 불가한 프루닝 행은 담지 않는다(단, 대조군은 그대로 담긴다) ─────────────
test('[node] ⑧ U4 — 키 후보가 0이면 prunedKeyRows를 담지 않고, 후보가 있으면 그대로 담는다', async () => {
  const HDR = ['조사일자', '농가명', '조사나무', '측정항목01'];
  // 두 행 다 키 컬럼(농가명)이 비어 **전체-키 프루닝**에 걸린다 — `prunedKeyRows`의 대상 형상.
  const ROWS_ = [['2026-08-01', '', '1', '10.0'], ['2026-08-08', '', '2', '20.0']];
  const col = (id: string, name: string, input: string, sampleKey: boolean): Column => ({
    id, name, type: 'text', input, ttsAnnounce: false, auto: { kind: 'fixed', value: '' }, sampleKey,
  } as unknown as Column);

  // ⓐ 키 «후보»가 있는 스키마 — 대조군. 담겨야 한다(#10이 닫은 「기록 없음 오진」의 유일한 증거).
  const cd = col('cd', '조사일자', 'auto', false);
  const withCandidates = buildPastIndex(HDR, ROWS_, [
    cd, col('cf', '농가명', 'auto', true),
    col('c0', '조사나무', 'auto', true), col('m1', '측정항목01', 'voice', false),
  ], cd);
  expect(
    withCandidates.prunedKeyRows.length,
    '키 후보가 있는데도 프루닝 행을 안 담았다 — v0.50 D(#10)가 닫은 「기록 없음」 오진이 되살아난다',
  ).toBe(2);

  // ⓑ 키 «후보»가 0인 스키마(auto+sampleKey 컬럼이 없다) — 담아도 `rec`이 언제나 `{}`라
  //    어떤 세션에서도 대조에 못 쓴다. 14일 폴백 레코드에 시트 전량이 실리는 낭비만 남는다.
  const noCandidates = buildPastIndex(HDR, ROWS_, [
    cd, col('cf', '농가명', 'voice', true),
    col('c0', '조사나무', 'voice', true), col('m1', '측정항목01', 'voice', false),
  ], cd);
  expect(
    noCandidates.prunedKeyRows,
    '소비 불가한(키 후보 0) 프루닝 행을 여전히 담는다 — 저장 낭비(U4)',
  ).toEqual([]);
  // 🔴 과잉 축소 반증 — 축소는 **프루닝 보관**에만 걸린다. 회차 계측은 그대로여야 한다
  //   (그게 M8이 「키 붙은 행 0줄」과 「회차를 못 읽었다」를 가르는 근거다).
  expect(noCandidates.roundParsedRows, '회차 계측까지 함께 죽였다 — M8의 오진 판별 근거가 사라진다').toBe(2);
});
