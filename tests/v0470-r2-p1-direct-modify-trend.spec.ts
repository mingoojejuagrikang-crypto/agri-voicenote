/**
 * v0.47.0-r2 P1(FB-A · 민구 실기기 08-09) — **직접 수정("수정 <값>")도 추세 평가를 받는다.**
 *
 * 무엇이 깨져 있었나: 추세 검사는 일반 음성 커밋 경로와 수동 커밋 경로에만 걸려 있었고,
 * `enterModifyMode`의 **직접값 분기**만 `evaluateTrend`를 부르지 않았다. 그래서 음성
 * 「수정 77」로 들어온 값은 설정 임계를 아무리 넘겨도 조용히 섰다.
 * 실측(08-09 세션 로그, +84.5초): row4 횡경 117→77 direct_modify, 직전 회차 111.1 대비
 * -30.9%(설정 decrease·10% 초과)인데 **trend 이벤트 0건**. 민구 원문 *"지금 값 알람 조건에
 * 맞을거야. 근데 알람 발생이 없어."*
 *
 * 이 스펙이 고정하는 계약 3개:
 *  ⓐ 직접 수정 커밋이 위반이면 **알람 팝업 + 응답 대기(trendConfirm)** 가 뜬다.
 *  ⓑ 위반이면 **에코("수정 <항목> <값>") 대신 알람 TTS** — 일반 커밋 경로의 계약과 동일.
 *     (동시에: 값 자체는 롤백되지 않고 칩에 그대로 선다 — 알림 ≠ 롤백.)
 *  ⓒ 해소('확인') 후 **원래 대기하던 필드로 돌아온다.** 포인터를 수정 대상 셀로 옮겨 두고
 *     advance()의 자연 진행(채워진 칸 건너뛰기)에 태우는 방식이라, 착지가 알람이 없었을 때와
 *     같아야 한다. 검토 대기(reviewWait) 출신이면 착지는 **검토 대기 재진입**이다(v0.33.0 항목2).
 *
 * ⚠️ 픽스처 전제: activeZones의 측정항목01만 `trendRule: 'increase'`(= 직전보다 **커지면** 알람,
 *    trendCheck.ts 헤더)이고 직전 회차값은 100.0이다. 그래서 정상값 = 100.0, 위반값 = 120.5.
 * ⚠️ 왕복 OFF([TEAMOPS-81]) — activeZones SETTINGS가 `chipSweepSeconds: 0`을 갖는다.
 */

import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, ttsLog } from './fixtures/stt';
import { reviewWaitAbsorbTts } from '../src/lib/voicePrompts';

test.setTimeout(120_000);

/** 검토 대기(reviewWait)까지 가려면 **한 행을 완주**해야 한다. activeZones 기본 12 음성 컬럼으로는
 *  발화 12회가 필요하고, 실측에서 그 사이 안내 TTS와 겹친 final이 삼켜져 행이 완료되지 않았다
 *  (speech.ts — TTS 재생 중 비명령 결과는 걸러진다). 2 음성 컬럼으로 줄여 3발화로 완주시킨다.
 *  추세 전제는 동일하게 유지: 측정항목01만 `trendRule: 'increase'`(커지면 알람) · 직전값 100.0. */
const MINI_COLUMNS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'increase' },
  { id: 'm2', name: '측정항목02', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];
const MINI_SETTINGS = {
  ...AZ_SETTINGS,
  state: { ...AZ_SETTINGS.state, columns: MINI_COLUMNS, totalRows: 2, sessionAutoLabel: 'r2-p1-mini' },
};
const MINI_HEADERS = ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02'];
const MINI_ROWS = [
  [PREV_ROUND, '이원창', '1', '100.0', '5.0'],
  [PREV_ROUND, '이원창', '2', '100.0', '5.0'],
];

/** 🔴 v0.49 r3 #14(claude r2 LOW) — **접두가 겹친다.** 검토 대기 낭독(`enterReviewWait`)과 bare 값
 *  흡수 안내(`reviewWaitAbsorbTts`, 확정표 #4)는 둘 다 `"{N}행 완료됨."` 으로 시작한다. 접두만 보는
 *  관측창은 그 둘을 **한 사건으로 센다** — 흡수가 한 번 끼면 「진입 낭독 N회」 류의 정확 개수 단언이
 *  조용히 갈린다(문구 자체는 민구 확정 바이트라 바꾸지 않는다 — 관측창을 옮기는 것이 처방이다).
 *  판별자는 SSOT에서 가져온다(리터럴 사본을 두면 확정 바이트가 갈릴 때 여기가 먼저 썩는다). */
/** 「N행 완료됨 …」 **검토 낭독만** 추린다 — 흡수 안내(같은 접두)는 제외한다. */
const reviewSays = (log: string[]) =>
  log.filter((t) => t.startsWith('1행 완료됨') && t !== reviewWaitAbsorbTts(1));

const chip = (page: Page, name: string) =>
  page.locator(`[data-testid="column-chip"][data-col-name="${name}"]`);

/** 지금 활성인 칩의 컬럼명(포인터 착지 판정용). */
async function activeChipName(page: Page): Promise<string | undefined> {
  return page.evaluate(() =>
    (document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null)
      ?.dataset.colName);
}

test('P1ⓐⓑⓒ 🔴 직접 수정이 이상치면 알람이 뜨고, 에코 대신 알람 TTS가 나가며, 확인 후 원위치로 돌아온다', async ({ page }) => {
  await boot(page, PHONE_402);

  // 측정항목01 = 100.0 (직전값과 같음 → 통과) → 측정항목02 대기.
  await fireStt(page, '100.0', 700);
  expect(await activeChipName(page), '정상 커밋 후 다음 필드로 전진').toBe('측정항목02');

  // 🔴 여기가 회귀 지점 — 「수정 120.5」는 측정항목01(직전 100.0)을 겨냥한 direct_modify다.
  //    종전 코드는 값만 세우고 조용히 측정항목02를 재안내했다(알람 0건).
  await fireStt(page, '수정 120.5', 1000);

  // ⓐ 알람 팝업 + 응답 대기.
  await expect(page.locator('[data-testid="anomaly-alert"]'), '직접 수정 위반 → 알람 팝업')
    .toBeVisible({ timeout: 6000 });
  // 값은 롤백되지 않는다(알림 ≠ 롤백 — 일반 경로와 같은 계약).
  await expect(chip(page, '측정항목01')).toContainText('120.5');
  // 포인터는 수정 대상 셀로 옮겨 간다(알람이 난 칩이 활성 = 일반 음성 알람과 같은 화면).
  expect(await activeChipName(page), '알람 중 활성 칩 = 알람 난 셀').toBe('측정항목01');

  // ⓑ 위반이면 에코 대신 알람 TTS. 「수정 측정항목01 120.5」가 나갔다면 계약 위반이다.
  const spoken = await ttsLog(page);
  expect(
    spoken.filter((t) => t.startsWith('수정 측정항목01 120')),
    '위반 커밋은 에코하지 않는다(알람 TTS가 대신 나간다)',
  ).toHaveLength(0);
  expect(
    spoken.filter((t) => t.startsWith('추세 알람')),
    '알람 TTS가 실제로 발화됐다(무음 알람 금지 — fb-27-9 계약)',
  ).not.toHaveLength(0);

  // v0.48.1 U3(리뷰 claude F10/medium) — P4(NEW-3)가 구현 중 이 직접수정 경로까지 넓혔는데
  // 오라클이 없었다("`say('인식값 …')`은 지금 어떤 테스트도 지키지 않는다 — 지워도 green이다").
  // 알람 뒤에 별도의 「인식값 120.5」 발화가 실제로 나가는지 순서까지 잠근다.
  const modIdx = spoken.findIndex((t) => t.startsWith('추세 알람'));
  const valIdx = spoken.findIndex((t) => t === '인식값 120.5');
  expect(valIdx, '직접수정 알람도 인식값을 별도 발화한다(알람 뒤)').toBeGreaterThan(modIdx);

  // ⓒ '확인' → 해소 후 **원래 대기하던 필드**(측정항목02)로 복귀.
  await fireStt(page, '확인', 1000);
  await expect(page.locator('[data-testid="anomaly-alert"]')).toHaveCount(0);
  await page.waitForFunction(
    () => (document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null)
      ?.dataset.colName === '측정항목02',
    { timeout: 6000 },
  );
});

test('P1ⓒ-review 🔴 검토 대기 출신 직접 수정: 알람 해소 후 착지는 advance가 아니라 검토 대기 재진입', async ({ page }) => {
  // v0.33.0 항목2 계약(검토 대기 출신 커밋은 advance로 검토를 강제 종료하지 않는다)이 **알람을
  // 경유하는 경로**에서도 서는지 본다. 알람 해소 지점은 전부 advance()로 끝나므로, 대기 상태가
  // 착지처(resumeReview)를 들고 다니지 않으면 이 조합에서만 계약이 깨진다.
  await boot(page, PHONE_402, {
    settings: MINI_SETTINGS as unknown as typeof AZ_SETTINGS,
    headers: MINI_HEADERS,
    sheetRows: MINI_ROWS,
  });

  // 1행 완주(측정항목01=100.0 통과값, 측정항목02=10.0) → 2행으로 전진 → '이전'으로 되돌아오면
  // 완료 행 착지 = 검토 대기(값 낭독 + 명령 대기).
  await fireStt(page, '100.0', 700);
  await fireStt(page, '10.0', 900);
  await fireStt(page, '이전행', 1500);
  expect(reviewSays(await ttsLog(page)), '검토 대기 진입 낭독 1회').toHaveLength(1);

  // 검토 대기 중 「수정 120.5」 = 포인터 컬럼(측정항목01) 직접 수정 → 위반 → 알람.
  await fireStt(page, '수정 120.5', 1200);
  await expect(page.locator('[data-testid="anomaly-alert"]'), '검토 대기 출신 직접 수정도 알람')
    .toBeVisible({ timeout: 6000 });

  // '확인' → 검토 대기 **재진입**("1행 완료됨 …" 재낭독). advance로 빠지면 이 낭독이 늘지 않는다.
  await fireStt(page, '확인', 1200);
  await expect(page.locator('[data-testid="anomaly-alert"]')).toHaveCount(0);
  const after = reviewSays(await ttsLog(page));
  expect(after, '해소 후 검토 대기 재진입(낭독 2회째)').toHaveLength(2);
  // 갱신값이 재낭독에 반영돼 있어야 한다(재낭독의 의미 — 종전 계약 보존의 증거).
  expect(after[1], '검토 재낭독에 정정값 반영').toContain('120.5');
});

// ─────────────────────────────────────────────────────────────────────────────
// v0.47.0-r3 판정축 오라클 3건 (이중 콜드 리뷰 2026-08-09 — codex f1·f2·f3 / claude §1).
// 셋 다 게이트 164 passed와 공존하던 기존 오라클의 사각이다.
// ─────────────────────────────────────────────────────────────────────────────

test('P1ⓒ-review-재위반 🔴 정정값이 또 위반이어도 검토 대기 예약이 산다 — 2번째 알람 확인 후 재진입', async ({ page }) => {
  // 이중 확인(codex f2 · claude §1): 재위반 재무장(:2499)만 resumeReview를 복사하지 않아,
  // 「위반 → 새 값(또 위반) → 확인」 조합에서만 v0.33.0 항목2 계약이 깨진다.
  // 위 ⓒ-review(첫 알람 즉시 확인)는 green인 채로 — 정확히 그 사각을 메우는 오라클이다.
  await boot(page, PHONE_402, {
    settings: MINI_SETTINGS as unknown as typeof AZ_SETTINGS,
    headers: MINI_HEADERS,
    sheetRows: MINI_ROWS,
  });

  await fireStt(page, '100.0', 700);
  await fireStt(page, '10.0', 900);
  await fireStt(page, '이전행', 1500);
  expect(reviewSays(await ttsLog(page)), '검토 대기 진입 낭독 1회').toHaveLength(1);

  // 첫 위반 알람.
  await fireStt(page, '수정 120.5', 1200);
  await expect(page.locator('[data-testid="anomaly-alert"]')).toBeVisible({ timeout: 6000 });

  // '확인' 대신 **여전히 위반인 새 값** — 재위반 재무장 경로는 이때만 돈다.
  await fireStt(page, '130.5', 1500);
  await expect(page.locator('[data-testid="anomaly-alert"]'), '재위반 → 알람 재무장').toBeVisible();
  await expect(chip(page, '측정항목01')).toContainText('130.5');

  // 2번째 알람에서 '확인' → 검토 대기 재진입. 재무장이 예약을 버렸으면 advance로 빠져 낭독이
  // 늘지 않는다(red).
  await fireStt(page, '확인', 1200);
  await expect(page.locator('[data-testid="anomaly-alert"]')).toHaveCount(0);
  const after = reviewSays(await ttsLog(page));
  expect(after, '재위반 해소 후에도 검토 대기 재진입(낭독 2회째)').toHaveLength(2);
  expect(after[1], '재낭독에 최종 정정값 반영').toContain('130.5');
});

/** IDB sessions에서 (rowIndex, colId) 값을 읽는다 — persist 내구화 오라클용
 *  (correction-flow.spec.ts의 getIdbSessions 패턴, 셀 단위로 축소). */
async function idbRowValue(page: Page, rowIndex: number, colId: string): Promise<string | null> {
  return page.evaluate(async ({ rowIndex, colId }) => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db) return null;
    const sessions = await new Promise<Array<{ rows?: Array<{ index: number; values?: Record<string, string> }> }>>((res) => {
      const tx = db.transaction('sessions', 'readonly');
      const req = tx.objectStore('sessions').getAll();
      req.onsuccess = () => res(req.result as never);
      req.onerror = () => res([]);
    });
    db.close();
    const last = sessions[sessions.length - 1];
    const row = last?.rows?.find((r) => r.index === rowIndex);
    return row?.values?.[colId] ?? null;
  }, { rowIndex, colId });
}

test('P1-persist 🔴 현재 행·무클립 셀 직접수정은 알람 응답 대기 중 IDB로 내구화된다(eventual)', async ({ page }) => {
  // codex f1: targetRow===curRow && 무클립 && !reviewTarget 조합은 두 저장 갈래
  // (saveSession/persistSession)를 모두 건너뛴다 → 알람/다음 필드 대기 중 reload가 오면
  // IDB의 이전 값으로 복귀(값 유실). 수동으로 입력한 셀이 정확히 이 무클립 조건에 도달한다.
  await boot(page, PHONE_402);

  // 측정항목01(v0)을 **수동으로** 100 입력 — 수동 커밋은 클립 포인터를 남기지 않는다(무클립 전제).
  await page.locator('[data-testid="column-chip"][data-col-name="측정항목01"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible({ timeout: 3000 });
  for (const k of ['1', '0', '0']) {
    await page.locator(`[data-testid="manual-key-${k}"]`).click();
  }
  await page.locator('[data-testid="manual-commit"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toHaveCount(0);
  // 수동 커밋(awaiting 셀)은 흐름을 재개한다 — 다음 필드 대기까지 전진.
  await page.waitForFunction(
    () => (document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null)
      ?.dataset.colName === '측정항목02',
    undefined,
    { timeout: 6000 },
  );
  // 전제 확인 — 이 시점에 120.5는 IDB 어디에도 없다(아래 본단언이 직접수정의 persist만 재도록).
  //   ⚠️ '100'을 기대하지 마라: persistCellValue는 행이 아직 IDB에 없으면 sessionStore만 갱신하고
  //   다음 persistSession에 미룬다(:3799 계약) — 세션 첫 셀의 수동 커밋 직후 IDB엔 행 자체가 없다.
  //   그래서 이 조합의 유실은 「이전 값 복귀」가 아니라 **행 통째 미영속**으로 나타난다(더 나쁘다).
  expect(await idbRowValue(page, 1, 'v0'), '직접수정 전 IDB 전제').not.toBe('120.5');

  // 현재 행의 무클립 셀을 음성 직접수정(직전 100.0 → 120.5 = increase 위반) → 알람.
  await fireStt(page, '수정 120.5', 1000);
  await expect(page.locator('[data-testid="anomaly-alert"]')).toBeVisible({ timeout: 6000 });
  await expect(chip(page, '측정항목01')).toContainText('120.5'); // 메모리 값은 섰다(알림 ≠ 롤백)

  // 🔴 본축 — 알람 **응답 대기 동안**(이후 상호작용 0회) 120.5의 내구화가 완료된다.
  //    persist 0회면 행이 통째로 미영속(실측 null — codex f1), 이 poll이 타임아웃으로 red가 된다.
  //    ⚠️ 주장 범위(codex r4 low :230 반영): 이 오라클은 「알람 **전에** durable」이라는 순서를
  //    증명하지 않는다 — 제품 계약이 애초에 fire-and-forget(void persistSession, 모든 커밋 경로
  //    동일)이라 그런 순서 약속이 없다. 여기서 증명하는 것은 persist의 **시작이 직접수정 경로
  //    자신에게 있다**는 사실이다: 알람 후 아무 상호작용이 없으므로, 대기 중 write가 관측되면
  //    그 시작점은 직접수정 커밋뿐이다(0회 결함 복원 시 red — 반증력의 축).
  await expect.poll(() => idbRowValue(page, 1, 'v0'), { timeout: 5000 }).toBe('120.5');
});

/** 중첩 복귀 픽스처 — **마지막** 음성 컬럼(m2)에만 추세 규칙. 교차행 직접수정("수정 <값>")의
 *  대상은 이전 행 마지막 음성 컬럼이므로, 중첩 시나리오의 알람은 m2에서 떠야 한다. */
const NESTED_COLUMNS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 3 }, sampleKey: true },
  { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  { id: 'm2', name: '측정항목02', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'increase' },
];
const NESTED_SETTINGS = {
  ...AZ_SETTINGS,
  state: { ...AZ_SETTINGS.state, columns: NESTED_COLUMNS, totalRows: 3, sessionAutoLabel: 'r3-p1-nested' },
};
const NESTED_HEADERS = ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02'];
const NESTED_ROWS = [
  [PREV_ROUND, '이원창', '1', '5.0', '100.0'],
  [PREV_ROUND, '이원창', '2', '5.0', '100.0'],
  [PREV_ROUND, '이원창', '3', '5.0', '100.0'],
];

/** 화면의 행 표시("N / 3 행")에서 현재 행을 읽는다 — nav-unidirectional.spec.ts의 패턴. */
async function activeRowOf(page: Page): Promise<number> {
  const text = await page.evaluate(() => document.body.innerText);
  const m = text.match(/(\d+)\s*\/\s*3\s*행/);
  return m ? parseInt(m[1], 10) : -1;
}

test('P1-중첩복귀 🔴 기존 복귀 예약 위의 교차행 직접수정: 확인 후 안쪽 출발 행으로 먼저, 바깥 예약은 그 행 완료 후', async ({ page }) => {
  // codex f3: 복귀 예약(returnRow)이 이미 걸려 있으면 교차행 직접수정 알람이 출발점을 기록하지
  // 못한다(:1259 "덮지 않는다" 조건). '확인' 후 advance가 **바깥** 예약을 소비해 안쪽 출발 행을
  // 건너뛰고, 이후 값이 엉뚱한 행에 들어갈 수 있다(오귀속).
  await boot(page, PHONE_402, {
    settings: NESTED_SETTINGS as unknown as typeof AZ_SETTINGS,
    headers: NESTED_HEADERS,
    sheetRows: NESTED_ROWS,
  });

  // 1행 완주(m1=5.0, m2=100.0 통과값) → 2행 m1 대기.
  await fireStt(page, '5.0', 700);
  await fireStt(page, '100.0', 1200);
  await expect.poll(() => activeRowOf(page), { timeout: 6000 }).toBe(2);

  // '다음'으로 2행 skip → 3행(복귀 예약 없음) → '이전'으로 2행 복귀 = **바깥 예약(3행) 성립**.
  await fireStt(page, '다음행', 1200);
  await expect.poll(() => activeRowOf(page), { timeout: 6000 }).toBe(3);
  await fireStt(page, '이전행', 1500);
  await expect.poll(() => activeRowOf(page), { timeout: 6000 }).toBe(2);
  expect(await activeChipName(page), '2행 첫 미완료 필드 착지').toBe('측정항목01');

  // 2행 m1 대기 중 「수정 120.5」 → 대상은 1행 m2(직전 100.0, increase 위반) → 알람 + 포인터 1행.
  await fireStt(page, '수정 120.5', 1200);
  await expect(page.locator('[data-testid="anomaly-alert"]'), '교차행 직접수정 위반 → 알람')
    .toBeVisible({ timeout: 6000 });
  expect(await activeRowOf(page), '알람 중 포인터 = 수정 대상 행').toBe(1);

  // 🔴 본축 — '확인' 후 **안쪽 출발 행(2)** 복귀. 예약이 유실되면 바깥 예약(3)으로 점프한다(red).
  await fireStt(page, '확인', 1500);
  await expect(page.locator('[data-testid="anomaly-alert"]')).toHaveCount(0);
  await expect.poll(() => activeRowOf(page), { timeout: 6000 }).toBe(2);
  expect(await activeChipName(page), '안쪽 출발 좌표(2행 m1) 복원').toBe('측정항목01');

  // 경계 조건 — 바깥 예약(3행)은 파괴되지 않는다: 2행 완주가 그것을 소비한다(:977-994 계약 유지).
  await fireStt(page, '5.0', 700);
  await fireStt(page, '100.0', 1500);
  await expect.poll(() => activeRowOf(page), { timeout: 8000 }).toBe(3);
});

/** IDB sessions에서 행 레코드(complete 플래그 + values)를 읽는다 — 거짓 완료 오염 오라클용. */
async function idbRow(
  page: Page,
  rowIndex: number,
): Promise<{ complete?: boolean; values?: Record<string, string> } | null> {
  return page.evaluate(async ({ rowIndex }) => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db) return null;
    const sessions = await new Promise<Array<{ rows?: Array<{ index: number; complete?: boolean; values?: Record<string, string> }> }>>((res) => {
      const tx = db.transaction('sessions', 'readonly');
      const req = tx.objectStore('sessions').getAll();
      req.onsuccess = () => res(req.result as never);
      req.onerror = () => res([]);
    });
    db.close();
    const last = sessions[sessions.length - 1];
    return last?.rows?.find((r) => r.index === rowIndex) ?? null;
  }, { rowIndex });
}

test('P1-미완료대상 🔴 skip 행을 겨냥한 교차행 직접수정 알람: 확인이 그 행을 거짓 완료로 내구화하지 않는다', async ({ page }) => {
  // codex r4 :968(Larry 코드 재검증 완료): advance()는 포인터 **앞** 빈 칸을 검사하지 않는다.
  // 교차행 직접수정 알람은 포인터를 대상 행 **마지막** 칸에 세우므로, 대상 행이 미완료(skip)면
  // '확인' 한 번에 markRowComplete가 돌아 빈 측정값(m1='')이 complete:true로 내구화되고
  // skippedRows 표식(데이터탭 placeholder의 근거)까지 지워진다 — 값 유실이 완료로 위장된다.
  // 설계(Larry 확정): 미완료 대상 행은 완료 처리 금지·skip 보존, 복귀는 returnStack 소비 그대로.
  await boot(page, PHONE_402, {
    settings: NESTED_SETTINGS as unknown as typeof AZ_SETTINGS,
    headers: NESTED_HEADERS,
    sheetRows: NESTED_ROWS,
  });

  // 1행을 **비운 채** '다음' → skip placeholder로 영속 + 2행 m1 대기.
  await fireStt(page, '다음행', 1500);
  await expect.poll(() => activeRowOf(page), { timeout: 6000 }).toBe(2);

  // 2행 m1에서 「수정 120.5」 → 대상은 skip된 1행의 **마지막** 칸 m2(직전 100.0, increase 위반).
  await fireStt(page, '수정 120.5', 1200);
  await expect(page.locator('[data-testid="anomaly-alert"]'), 'skip 행 대상 직접수정도 알람')
    .toBeVisible({ timeout: 6000 });
  expect(await activeRowOf(page), '알람 중 포인터 = 대상 행').toBe(1);

  // '확인' → 원 출발점(2행 m1) 복귀는 그대로 성립해야 하고(returnStack 소비),
  await fireStt(page, '확인', 1500);
  await expect(page.locator('[data-testid="anomaly-alert"]')).toHaveCount(0);
  await expect.poll(() => activeRowOf(page), { timeout: 6000 }).toBe(2);
  expect(await activeChipName(page), '원 출발 좌표(2행 m1) 복귀').toBe('측정항목01');

  // 🔴 본축 — 1행은 **미완료로 남는다.** 수정값(m2=120.5)은 내구화되되 m1은 비어 있고,
  //    complete는 false를 유지해야 한다. 현재 결함은 확인 직후 complete:true로 내구화한다(red).
  await expect.poll(async () => (await idbRow(page, 1))?.values?.m2, { timeout: 5000 }).toBe('120.5');
  await expect.poll(async () => (await idbRow(page, 1))?.complete, {
    timeout: 4000,
  }).toBe(false);
  expect((await idbRow(page, 1))?.values?.m1 ?? '', '빈 측정값은 빈 채로 남는다').toBe('');
});
