/**
 * v0.49 r5 Z3 오라클(claude #1) — **이미 기록된 행의 파생값은 다시 파생하지 않는다.**
 *
 * `persistSession`의 `composeRowValues`는 자동 컬럼을 **매 persist마다 재계산**한다. 그 값은
 * 사람이 넣은 것이 아니라 스키마·시계에서 나오므로 기록 시점과 달라질 수 있다:
 *   · 날짜 컬럼 `'오늘'` — `autoValue`가 **호출 시각의 로컬 날짜**를 돌려준다. 자정을 넘긴
 *     세션의 **기존 행 전부**가 다음 날짜로 다시 쓰인다.
 *   · 순환 컬럼 자릿수 — 세션 중 스키마가 갈리면 전 행의 값이 밀린다.
 *
 * 피해는 「기록 안 됨」이 아니라 **능동 덮어씀**이다: `buildRow`의 diff가 `synced`를 `dirty`로
 * 강등하고, 다음 동기화가 그 행을 시트에서 **in-place UPDATE**한다 — 농가 의사결정에 쓰이는
 * 프로덕션 시트의 확정 행이 사용자가 아무것도 안 했는데 다른 날짜로 바뀐다.
 *
 * 🔴 **자정 축을 재는 이유**(span 축이 아니라): 레인 실측에서 span 축은 **현행 UI에서 도달
 * 불가**였다 — `sessionColumnsRef`가 세션 시작에 컬럼을 동결하고, `App`이 세션 중 VoiceScreen을
 * keep-alive로 유지해(`tab === 'voice' || sessionLive`) 훅이 리마운트되지 않으므로 설정탭 변경이
 * 라이브 세션의 persist에 닿지 않는다. 같은 기전의 **도달 가능한** 발현이 날짜 드리프트라
 * 여기를 잰다. 처방은 두 축 공통(자동 컬럼 승계)이므로 span 축도 함께 닫힌다.
 *
 * 반증(승계 제거 시): ① red — 기존 행의 `조사일자`가 다음 날짜로 다시 쓰인다.
 * ②는 **과잉 방어 반증**이다 — 승계가 사람이 넣는 컬럼까지 얼리면 red.
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
];

async function bootZ3(page: Page) {
  await boot(page, PHONE_402, {
    settings: {
      ...AZ_SETTINGS,
      state: { ...AZ_SETTINGS.state, columns: COLS, totalRows: 2, sessionAutoLabel: 'r5-z3' },
    } as unknown as typeof AZ_SETTINGS,
    headers: ['조사일자', '농가명', '조사나무', '측정항목01'],
    sheetRows: [[PREV_ROUND, '이원창', '1', '100.0']],
  });
  await waitForTtsIdle(page);
}

type Row = { i: number; v: Record<string, string>; sync?: string };

/** IDB에 내구화된 이 세션의 행들(index 순). 화면이 아니라 **시트로 올라갈 것**을 잰다. */
async function persistedRows(page: Page): Promise<Row[]> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((r) => {
      const q = indexedDB.open('agri-voicenote');
      q.onsuccess = () => r(q.result);
    });
    const all: { rows?: { index: number; values: Record<string, string>; syncState?: string }[] }[] =
      await new Promise((r) => {
        const tx = db.transaction('sessions', 'readonly');
        const g = tx.objectStore('sessions').getAll();
        g.onsuccess = () => r(g.result as never);
        g.onerror = () => r([]);
      });
    db.close();
    const rows = all.flatMap((s) => s.rows ?? []);
    return rows
      .sort((a, b) => a.index - b.index)
      .map((rw) => ({ i: rw.index, v: rw.values, sync: rw.syncState }));
  });
}

/** 로컬 자정을 넘긴다 — `new Date()`와 `Date.now()`를 하루 앞으로 민다(다른 API는 그대로). */
async function crossMidnight(page: Page) {
  await page.evaluate(() => {
    const Real = Date;
    const DAY = 24 * 60 * 60 * 1000;
    class Shifted extends Real {
      constructor(...a: ConstructorParameters<typeof Date>) {
        // 인자 없는 생성만 민다 — 명시 인자로 만든 Date는 그대로여야 파싱/비교가 안 깨진다.
        if (a.length === 0) super(Real.now() + DAY);
        else super(...(a as [number]));
      }
      static now() { return Real.now() + DAY; }
    }
    (window as unknown as { Date: DateConstructor }).Date = Shifted as unknown as DateConstructor;
  });
}

test('① 자정을 넘겨도 이미 기록된 행의 조사일자는 다시 쓰이지 않는다 (synced 시트 능동 덮어씀 차단)', async ({ page }) => {
  await bootZ3(page);

  await fireStt(page, '삼십오 점 일', 1500); // 1행 완료 → persist
  await waitForTtsIdle(page);
  const before = await persistedRows(page);
  const row1Date = before.find((r) => r.i === 1)?.v.cd;
  expect(row1Date, '전제: 1행이 오늘 날짜로 기록됐다').toMatch(/^\d{4}-\d{2}-\d{2}$/);

  await crossMidnight(page);

  await fireStt(page, '사십이 점 삼', 1800); // 2행 완료 → persist 재실행(1행도 다시 쓰인다)
  await waitForTtsIdle(page);
  const after = await persistedRows(page);

  const row2Date = after.find((r) => r.i === 2)?.v.cd;
  expect(row2Date, '전제: 자정 이동이 실제로 먹혔다 — 새 행은 다음 날짜로 기록된다').not.toBe(row1Date);

  expect(
    after.find((r) => r.i === 1)?.v.cd,
    '자정을 넘겼다고 **이미 기록된 행**의 조사일자가 다시 쓰였다 — 다음 동기화가 시트의 확정 행을 덮는다',
  ).toBe(row1Date);
  // 사람이 넣은 값은 당연히 그대로다(승계가 값을 잃지 않았다는 확인).
  expect(after.find((r) => r.i === 1)?.v.m1).toBe('35.1');
});

test('② 과잉 방어 반증 — 승계는 자동 컬럼만이다. 기존 행의 측정값 정정은 그대로 반영된다', async ({ page }) => {
  await bootZ3(page);

  await fireStt(page, '삼십오 점 일', 1500);
  await waitForTtsIdle(page);
  expect((await persistedRows(page)).find((r) => r.i === 1)?.v.m1, '전제').toBe('35.1');

  // 1행으로 되돌아가 정정한다 — 사람이 넣는 컬럼은 라이브 스토어가 이겨야 한다.
  await fireStt(page, '이전행', 1500);
  await waitForTtsIdle(page);
  await fireStt(page, '수정', 1500);
  await waitForTtsIdle(page);
  await fireStt(page, '구십구 점 구', 2000);
  await waitForTtsIdle(page);

  expect(
    (await persistedRows(page)).find((r) => r.i === 1)?.v.m1,
    '승계가 사람이 넣는 컬럼까지 얼렸다 — 정정이 내구화되지 않으면 시트가 옛값으로 남는다',
  ).toBe('99.9');
});

// ── v0.49 r6 Y7 — 첫 persist가 **in-flight**인 창(codex R5-F2 · claude #6) ─────────────────
/** IDB에 내구화된 세션 헤더(날짜) — 행이 아니라 **세션 자체**의 `date`를 잰다. */
async function persistedSessionDate(page: Page): Promise<string | undefined> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((r) => {
      const q = indexedDB.open('agri-voicenote');
      q.onsuccess = () => r(q.result);
    });
    const all: { date?: string }[] = await new Promise((r) => {
      const tx = db.transaction('sessions', 'readonly');
      const g = tx.objectStore('sessions').getAll();
      g.onsuccess = () => r(g.result as never);
      g.onerror = () => r([]);
    });
    db.close();
    return all.at(-1)?.date;
  });
}

/**
 * ③ ⚠️ **반증 red가 없는 테스트다**(정직한 표기 — fixr6 실측).
 *
 * codex R5-F2는 첫 put을 8초 늦춘 상태에서 두 persist가 겹치면 `existingSession=null`이라
 * 1행 날짜가 덮인다고 보고했다. 같은 형상을 여기서 재현하려 했으나 **현행 코드에서는 창이
 * 열리지 않는다**: 같은 라운드의 Y1이 `finalizeRowCompletion`을 `await`로 바꿔 행 완료 persist가
 * **직렬화**됐기 때문에, 두 번째 커밋이 시작될 때 첫 put은 이미 정착해 있다. `persistSession`의
 * in-flight 스냅샷 폴백(Y7)을 제거해도 이 테스트는 green이다 — 즉 이 테스트가 지키는 것은
 * **「창이 닫혀 있다」는 현행 상태**이지 폴백 코드가 아니다.
 * 그래도 남긴다: Y1의 await가 언젠가 풀리면(성능 사유 등) 그 순간 이 형상이 다시 열리고,
 * 그때 이 테스트가 먼저 운다. 폴백 코드 자체는 그 재개방에 대한 방어로 유지한다.
 */
test('③ 두 persist가 겹쳐도 기존 행의 조사일자가 덮이지 않는다 (R5-F2 — 반증 red 없음)', async ({ page }) => {
  await bootZ3(page);
  // ①과 갈리는 지점: ①은 1행 persist가 **IDB에 정착한 뒤** 자정을 넘긴다. 여기서는 첫 put을
  //   늦춰 두 persist를 겹치게 한다.
  await page.evaluate(() => {
    (window as unknown as { __survey011DelaySessionPutMs?: number }).__survey011DelaySessionPutMs = 4000;
  });
  await fireStt(page, '삼십오 점 일', 300); // 1행 완료 → persist 시작(4초 지연)
  await page.waitForTimeout(400);
  await crossMidnight(page);
  // 두 put이 **겹친 채로** 끝나야 한다 — 지연을 여기서 풀면 두 번째가 먼저 정착해 창이 닫힌다.
  await fireStt(page, '사십이 점 삼', 300); // 첫 put이 끝나기 전에 2행 커밋 → 두 번째 persist
  await page.waitForTimeout(9000); // 두 put이 모두 끝나기를 기다린다(각 4초 지연)
  await page.evaluate(() => {
    (window as unknown as { __survey011DelaySessionPutMs?: number }).__survey011DelaySessionPutMs = 0;
  });

  const rows = await persistedRows(page);
  const row1 = rows.find((r) => r.i === 1);
  const row2 = rows.find((r) => r.i === 2);
  expect(row1?.v.m1, '전제: 1행이 내구화됐다').toBe('35.1');
  expect(row2?.v.cd, '전제: 자정 이동이 실제로 먹혔다').not.toBe(row1?.v.cd);
  expect(
    row1?.v.cd,
    '게시 전 창에서 승계원이 안 보여 1행의 조사일자가 다음 날로 덮였다 — 다음 sync가 시트를 UPDATE한다',
  ).not.toBe(row2?.v.cd);
});

test('④ 세션의 date는 세션이 시작된 날이다 — persist마다 다시 스탬프하지 않는다 (claude #6)', async ({ page }) => {
  await bootZ3(page);
  await fireStt(page, '삼십오 점 일', 1500);
  await waitForTtsIdle(page);
  const first = await persistedSessionDate(page);
  expect(first, '전제: 세션 날짜가 기록됐다').toMatch(/^\d{4}-\d{2}-\d{2}$/);

  await crossMidnight(page);
  await fireStt(page, '사십이 점 삼', 1800);
  await waitForTtsIdle(page);

  expect(
    await persistedSessionDate(page),
    '자정을 넘긴 persist가 세션 헤더의 날짜를 다시 스탬프했다 — 「오늘 세션」 매칭에서 그날 세션이 사라진다',
  ).toBe(first);
});
