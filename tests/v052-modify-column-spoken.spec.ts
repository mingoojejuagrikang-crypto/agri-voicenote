/**
 * 🔴🔴 v0.52 — **「수정 <괄호앞이름>」 지목**(민구 결정 2026-09-03).
 *
 * > 괄호 앞 이름으로 매칭한다. **한 칸만** 지목한다. 앞부분이 같은 열이 둘 이상이면 확인 질문.
 * > 🔴 **어느 셀도 지워지지 않아야 한다** — 지목 실패든 성공이든 데이터 파괴는 금지다.
 *
 * ## 무엇이 깨져 있었나 (콜드 리뷰 `2026-09-02-tts-paren-review-cold.md` §4 P1② 실측)
 *
 * 09-02 회차가 TTS에서 괄호를 벗겨(`formatNameForTts`) 앱은 `종경(mm)`을 **「종경」이라고
 * 가르친다.** 그런데 `extractModifyColumn`은 **원문 완전일치**였고 STT는 괄호를 절대 출력하지
 * 않으므로 「수정 종경」은 **구조적으로 매치 불가**였다. 귀결은 「지목 실패」가 아니라:
 *
 * ```
 * 앱이 읽어준 것 → "1행 완료됨. 횡경 11.1, 종경 22.2."
 * 사용자 발화     → "수정 종경"
 * 이후 발화       → "수정. 횡경."            ← 종경이 아니라 횡경이 열렸다
 * 값 before       → {횡경:"11.1", 종경:"22.2"}
 * 값 after        → {횡경:"",     종경:""}    ← 두 칸 다 지워졌다
 * ```
 *
 * 경로: `resolveModifyTarget`이 지목에 실패 → 값 후보 `"종경"`이 살아남아 포인터 컬럼으로
 * 내려감 → `parseValueForCol` 실패 → **캐스케이드 재기록**(`clearEnd = vc.length`)으로 낙하.
 *
 * ## 이 스펙이 고정하는 계약 넷
 *  ⓐ **축약형 지목이 먹힌다** — 「수정 종경」 → `종경(mm)`.
 *  ⓑ **한 칸만** — 지목된 열만 비운다. 종전엔 `reviewWait` 지목이 그 열부터 **행 끝까지** 지웠다
 *    (실 시트 표본 7열의 「수정 과중」 = 다섯 칸. 프로덕션 시트는 종경이 마지막 열이라 우연히 한 칸).
 *  ⓒ **미매칭은 파괴하지 않는다** — 값도 컬럼명도 아닌 텍스트는 그 국면의 대기 문구로 되돌린다.
 *  ⓓ **모호도 파괴하지 않는다** — 축약형이 같은 열이 둘 이상이면 지목하지 않는다.
 *
 * ⚠️ **모호의 「확인 질문」은 이번 회차 범위 밖이다**(`_ASK-l1-def003.md` — BLOCKING 대기).
 *   브리핑의 *"R6 `confusionConfirm`에 같은 형상으로 붙여라"* 는 전제가 실측과 어긋난다:
 *   그 대기 상태는 **값 의미론**이라 「둘째」가 `ctx.parsed = cands[i]` → 값 커밋으로 간다.
 *   컬럼명을 실으면 컬럼명이 값으로 커밋된다. 여기서는 **비파괴만** 단언한다 — 답이 오면
 *   그 위에 질문을 얹으면 되고, 이 단언들은 그때도 그대로 산다.
 */

import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, ttsLog, waitForTtsIdle } from './fixtures/stt';
import { matchModifyColumn } from '../src/lib/voiceCommands';
import { REVIEW_WAIT_COMMANDS_TTS } from '../src/lib/voicePrompts';

test.setTimeout(120_000);

// ─────────────────────────────────────────────────────────────────────────────
// 단위 — 규약 밖 열 이름에서 무엇이 일어나는가(산출물 §3의 근거표)
// 🔴 시트 스키마 불특정 설계다 — 아래 어느 단언도 「컬럼이 이런 이름일 것」을 앱에 요구하지
//    않는다. 각 형태에서 **무엇이 일어나는지**를 세어서 고정할 뿐이다.
// ─────────────────────────────────────────────────────────────────────────────

/** 실 시트 표본(브리핑 제공) — 축약형이 전부 다르므로 모호가 **0건**이다. */
const REAL = ['종경(mm)', '횡경(mm)', '과중(g)', '과피중(g)', '과피두께x4(mm)', '당도(Brix)', '적정(%)'];

test.describe('matchModifyColumn — 실 시트 표본 7종은 축약형만으로 전부 유일하게 지목된다', () => {
  const cases: Array<[string, string]> = [
    ['수정 종경', '종경(mm)'],
    ['수정 횡경', '횡경(mm)'],
    ['수정 과중', '과중(g)'],
    ['수정 과피중', '과피중(g)'],
    ['수정 과피두께', '과피두께x4(mm)'], // 🔑 `x4` 꼬리도 `formatNameForTts`가 벗긴다 = 앱이 가르친 이름
    ['수정 당도', '당도(Brix)'],
    ['수정 적정', '적정(%)'],
  ];
  for (const [utter, expected] of cases) {
    test(`"${utter}" → ${expected}`, () => {
      expect(matchModifyColumn(utter, REAL)).toEqual({ kind: 'match', name: expected });
    });
  }
  test('접두 섀도잉 없음 — 「과중」이 「과피중」을 가로채지 않는다(완전 일치가 이긴다)', () => {
    expect(matchModifyColumn('수정 과중', REAL)).toEqual({ kind: 'match', name: '과중(g)' });
    expect(matchModifyColumn('수정 과피중', REAL)).toEqual({ kind: 'match', name: '과피중(g)' });
  });
});

test.describe('matchModifyColumn — 규약 밖 열 이름', () => {
  test('괄호 없음 — 축약형 = 원문이라 종전 동작 그대로', () => {
    expect(matchModifyColumn('수정 초장', ['초장', '엽수'])).toEqual({ kind: 'match', name: '초장' });
  });
  test('원문 지목도 계속 먹힌다(더 구체적인 발화라 죽이지 않는다)', () => {
    expect(matchModifyColumn('수정 종경(mm)', ['횡경(mm)', '종경(mm)'])).toEqual({ kind: 'match', name: '종경(mm)' });
  });
  test('중첩 괄호 — 전부 벗겨진 축약형으로 잡힌다', () => {
    expect(matchModifyColumn('수정 가', ['가(나(다))', '라'])).toEqual({ kind: 'match', name: '가(나(다))' });
  });
  test('전각 괄호(IME 산물)도 같은 종류다', () => {
    expect(matchModifyColumn('수정 종경', ['종경（mm）'])).toEqual({ kind: 'match', name: '종경（mm）' });
  });
  test('괄호가 이름 전체 — 축약형이 비면 `formatNameForTts`가 원문으로 폴백한다(빈 키 없음)', () => {
    expect(matchModifyColumn('수정 (mm)', ['(mm)', '초장'])).toEqual({ kind: 'match', name: '(mm)' });
    expect(matchModifyColumn('수정 초장', ['(mm)', '초장'])).toEqual({ kind: 'match', name: '초장' });
  });
  test('조사 꼬리는 축약형에도 붙는다 — "수정 종경으로"', () => {
    expect(matchModifyColumn('수정 종경으로', ['종경(mm)', '횡경(mm)'])).toEqual({ kind: 'match', name: '종경(mm)' });
  });
  test('임의 접미사는 여전히 불허 — "수정 종경도"는 매치 실패(오지목 금지 계약 불변)', () => {
    expect(matchModifyColumn('수정 종경도', ['종경(mm)', '횡경(mm)'])).toBeNull();
  });
  test('그런 이름이 없으면 null', () => {
    expect(matchModifyColumn('수정 초장', ['종경(mm)', '횡경(mm)'])).toBeNull();
  });
});

test.describe('matchModifyColumn — 모호(지목하지 않는다)', () => {
  test('축약형 충돌 — 수확량(1차)·수확량(2차)는 둘 다 「수확량」이다', () => {
    expect(matchModifyColumn('수정 수확량', ['수확량(1차)', '수확량(2차)']))
      .toEqual({ kind: 'ambiguous', names: ['수확량(1차)', '수확량(2차)'] });
  });
  test('중복 헤더 — 종전의 「모호 거부」가 같은 경로로 합류한다', () => {
    expect(matchModifyColumn('수정 횡경', ['횡경', '횡경'])).toEqual({ kind: 'ambiguous', names: ['횡경', '횡경'] });
  });
  test('괄호 없는 이름과 괄호 있는 이름이 같은 소리를 낼 때도 모호다', () => {
    expect(matchModifyColumn('수정 종경', ['종경', '종경(mm)']))
      .toEqual({ kind: 'ambiguous', names: ['종경', '종경(mm)'] });
  });
  test('모호가 있어도 유일한 다른 이름은 정상 지목', () => {
    expect(matchModifyColumn('수정 당도', ['수확량(1차)', '수확량(2차)', '당도(Brix)']))
      .toEqual({ kind: 'match', name: '당도(Brix)' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// e2e — 콜드 리뷰 프로브 P-3의 형상을 그대로 승격한다(실 프로덕션 시트와 같은 컬럼명)
// ─────────────────────────────────────────────────────────────────────────────

const COL = (id: string, name: string) => ({
  id, name, type: 'float', input: 'voice', ttsAnnounce: true,
  auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false,
});
const AUTO = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
];

/** 실 시트(2026-09-01 device inbox 6건 전수)와 같은 이름 — 음성 컬럼 둘 다 괄호를 단다. */
const PAREN2 = [...AUTO, COL('m1', '횡경(mm)'), COL('m2', '종경(mm)')];
/** ⓑ 전용 — 지목 대상이 **가운데** 열이라 「한 칸만」이 실제로 판별력을 갖는다. */
const PAREN3 = [...AUTO, COL('m1', '횡경(mm)'), COL('m2', '종경(mm)'), COL('m3', '과중(g)')];
/** ⓓ 전용 — 축약형이 같은 두 열(콜드 리뷰 §3 P2의 형상). */
const DUP = [...AUTO, COL('m1', '수확량(1차)'), COL('m2', '수확량(2차)')];

const bootWith = (page: Page, columns: unknown[], label: string) => boot(page, PHONE_402, {
  settings: {
    ...AZ_SETTINGS,
    state: { ...AZ_SETTINGS.state, columns, totalRows: 2, sessionAutoLabel: label },
  } as unknown as typeof AZ_SETTINGS,
  headers: [...AUTO, ...(columns as { name: string }[]).slice(AUTO.length)].map((c) => (c as { name: string }).name),
  sheetRows: [
    [PREV_ROUND, '이원창', '1', ...Array((columns as unknown[]).length - AUTO.length).fill('100.0')],
    [PREV_ROUND, '이원창', '2', ...Array((columns as unknown[]).length - AUTO.length).fill('100.0')],
  ],
});

/** 라이브 세션 store의 행 값 — 「지워졌는가」를 IDB 지연 없이 직접 잰다(프로브와 같은 방식). */
async function rowValues(page: Page, row: number): Promise<Record<string, string>> {
  return page.evaluate(async (r) => {
    const { useSessionStore } = await import('/src/stores/sessionStore.ts');
    return useSessionStore.getState().getRowValues(r) as Record<string, string>;
  }, row);
}

const activeChipName = (page: Page) => page.evaluate(() =>
  (document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null)?.dataset.colName);

/** 1행을 완주하고 「이전행」으로 그 행의 **검토 대기**(reviewWait)에 착지한다. */
async function completeRowThenReview(page: Page, values: string[]) {
  for (const v of values) await fireStt(page, v, 1000);
  await waitForTtsIdle(page);
  await fireStt(page, '이전행', 1800);
  await waitForTtsIdle(page);
}

test('ⓐ 「수정 종경」이 종경을 연다 — 앱이 가르친 이름 그대로 지목된다', async ({ page }) => {
  await bootWith(page, PAREN2, 'v052-mc-a');
  await completeRowThenReview(page, ['11.1', '22.2']);
  // 전제 — 앱은 방금 「종경 22.2」라고 가르쳤다.
  expect((await ttsLog(page)).filter((t) => t.startsWith('1행 완료됨'))[0])
    .toBe('1행 완료됨. 횡경 11.1, 종경 22.2.');

  await fireStt(page, '수정 종경', 2000);
  await waitForTtsIdle(page);

  expect(await activeChipName(page), '지목된 열이 열린다(종전엔 포인터 횡경이 열렸다)').toBe('종경(mm)');
  const v = await rowValues(page, 1);
  expect(v.m1, '🔴 지목하지 않은 열은 지워지지 않는다').toBe('11.1');
  expect(v.m2, '지목된 열만 재기록 대기로 비워진다').toBe('');

  // 재발화가 그 열로 들어간다(지목이 실제로 살아 있다는 증거).
  await fireStt(page, '33.3', 1200);
  await waitForTtsIdle(page);
  expect((await rowValues(page, 1)).m2).toBe('33.3');
});

test('ⓑ 한 칸만 — 가운데 열을 지목해도 뒤 칸은 지워지지 않는다', async ({ page }) => {
  await bootWith(page, PAREN3, 'v052-mc-b');
  await completeRowThenReview(page, ['11.1', '22.2', '33.3']);

  await fireStt(page, '수정 종경', 2000);
  await waitForTtsIdle(page);

  const v = await rowValues(page, 1);
  expect(v.m1, '앞 칸 불변').toBe('11.1');
  expect(v.m2, '지목된 가운데 칸만 비워진다').toBe('');
  // 🔴 여기가 이번 처방의 판별력이다 — 종전 `clearEnd = vc.length`면 이 칸도 비었다.
  expect(v.m3, '🔴 뒤 칸은 지워지지 않는다(종전엔 행 끝까지 지웠다)').toBe('33.3');
});

test('ⓒ 미매칭 — 없는 이름을 불러도 어느 셀도 지워지지 않고 대기 문구로 되돌아온다', async ({ page }) => {
  await bootWith(page, PAREN2, 'v052-mc-c');
  await completeRowThenReview(page, ['11.1', '22.2']);
  const logBefore = (await ttsLog(page)).length;

  await fireStt(page, '수정 초장', 2000);
  await waitForTtsIdle(page);

  const v = await rowValues(page, 1);
  expect(v.m1, '🔴 어느 셀도 지워지지 않는다').toBe('11.1');
  expect(v.m2, '🔴 어느 셀도 지워지지 않는다').toBe('22.2');
  expect(
    (await ttsLog(page)).slice(logBefore),
    '그 국면의 기존 대기 문구를 다시 말한다(새 문구를 만들지 않는다)',
  ).toContain(REVIEW_WAIT_COMMANDS_TTS);

  // 상태가 살아 있다 — 이어서 제대로 부르면 그대로 먹힌다.
  await fireStt(page, '수정 종경', 2000);
  await waitForTtsIdle(page);
  expect(await activeChipName(page)).toBe('종경(mm)');
});

test('ⓓ 모호 — 축약형이 같은 열이 둘이면 지목하지 않고, 역시 아무것도 지우지 않는다', async ({ page }) => {
  await bootWith(page, DUP, 'v052-mc-d');
  await completeRowThenReview(page, ['11.1', '22.2']);

  await fireStt(page, '수정 수확량', 2000);
  await waitForTtsIdle(page);

  const v = await rowValues(page, 1);
  expect(v.m1, '🔴 모호해도 어느 셀도 지워지지 않는다').toBe('11.1');
  expect(v.m2, '🔴 모호해도 어느 셀도 지워지지 않는다').toBe('22.2');

  // 원문(괄호 포함)으로는 여전히 유일하게 지목된다 — 모호를 못 가른다고 길이 막히지 않는다.
  // (STT가 괄호를 내지 않으므로 실사용 경로는 아니다 — 「확인 질문」이 붙을 자리가 여기다.)
  expect(matchModifyColumn('수정 수확량(2차)', ['수확량(1차)', '수확량(2차)']))
    .toEqual({ kind: 'match', name: '수확량(2차)' });
});

test('ⓔ 셀 검토 대기(cellWait)의 미매칭도 그 칸을 지우지 않는다', async ({ page }) => {
  await bootWith(page, PAREN2, 'v052-mc-e');
  await fireStt(page, '11.1', 1000);
  await waitForTtsIdle(page);
  // 「이전」 = 항목 한 칸 이동 → 값 있는 셀 착지 = cellWait.
  await fireStt(page, '이전', 1800);
  await waitForTtsIdle(page);
  expect(await activeChipName(page), '전제: 값 있는 셀에 주차했다').toBe('횡경(mm)');
  const logBefore = (await ttsLog(page)).length;

  await fireStt(page, '수정 초장', 2000);
  await waitForTtsIdle(page);

  expect((await rowValues(page, 1)).m1, '🔴 주차한 칸이 지워지지 않는다').toBe('11.1');
  expect(
    (await ttsLog(page)).slice(logBefore).join(' | '),
    'cellWait의 기존 대기 문구(SSOT)를 다시 말한다',
  ).toContain('횡경 기록값입니다');
});

test('ⓕ 끝 도달(atEnd)의 미매칭도 마지막 칸을 지우지 않는다', async ({ page }) => {
  await bootWith(page, PAREN2, 'v052-mc-f');
  // 2행 × 2칸 완주 → 끝 도달 센티넬.
  for (const v of ['11.1', '22.2', '33.3', '44.4']) await fireStt(page, v, 1000);
  await waitForTtsIdle(page);
  const logBefore = (await ttsLog(page)).length;

  await fireStt(page, '수정 초장', 2000);
  await waitForTtsIdle(page);

  const v2 = await rowValues(page, 2);
  expect(v2.m1, '🔴 어느 셀도 지워지지 않는다').toBe('33.3');
  expect(v2.m2, '🔴 어느 셀도 지워지지 않는다').toBe('44.4');
  expect(
    (await ttsLog(page)).slice(logBefore).length,
    '무음으로 삼키지 않는다 — 끝 도달 안내를 다시 말한다',
  ).toBeGreaterThan(0);
});
