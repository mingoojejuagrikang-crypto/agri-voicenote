/**
 * v0.51.1 R6 — **회귀 오라클: clean 셀에서 질문이 늘지 않는다.** 09-02 정식 4세션 + 프리뷰 + 09-01 5세션의
 * 음성 커밋 984건(`tests/fixtures/stt-commits-0902.json` · 세션 순서)에 출하되는 전역 표·기본 파라미터·
 * 런타임 상한(셀당 1회)을 그대로 적용해 **clean(커밋값 = 최종값) 시도에서 발동 0**을 단언한다(브리핑 §2).
 *
 * 🔴 이 표는 같은 데이터로 만든 것이다(in-sample). 그래서 이 스펙이 지키는 것은 「출하 표 + 출하 파라미터 +
 *   출하 픽스처」의 조합이 위양성을 내지 않는다는 **회귀 계약**이지 일반화 성능이 아니다 — 일반화는
 *   `scripts/stt-confusion-sim.mjs --mode loso`(산출물 §4)가 잰다. 표를 재생성하면 이 스펙이 먼저 말한다.
 * 🔴 픽스처를 잘라 맞추지 마라 — 위양성이 나면 파라미터·지지수를 손보고 산출물에 적는다(gates/15 [TEAMOPS-37]).
 */
import { test, expect } from '@playwright/test';
import { DEFAULT_CANDIDATE_PARAMS, decide, generateCandidates, type ConfusionTable } from '../src/lib/sttConfusionCore.ts';
import defaultJson from '../src/data/stt-confusion-default.json' with { type: 'json' };
import fixture from './fixtures/stt-commits-0902.json' with { type: 'json' };
import { evaluateSttConfusion, resetSttConfusionSession } from '../src/lib/sttConfusionRuntime';
import type { Column } from '../src/types';

interface Commit { sid: string; row: number; colId: string; col: string; colType: string; decimals: number; heard: string; truth: string }

const table = (defaultJson as unknown as { table: ConfusionTable }).table;
const commits = (fixture as { commits: Commit[] }).commits;

function simulate(params = DEFAULT_CANDIDATE_PARAMS) {
  const asked = new Set<string>();
  const out = { attempts: 0, clean: 0, wrong: 0, asked: 0, caught: 0, fp: [] as Commit[] };
  for (const c of commits) {
    out.attempts += 1;
    const wrong = c.heard !== c.truth;
    if (wrong) out.wrong += 1; else out.clean += 1;
    const d = decide(c.heard, generateCandidates({ heard: c.heard, col: c.col, decimals: c.decimals, colType: c.colType, tables: [table], params }), params);
    const cell = `${c.sid}:${c.row}:${c.colId}`;
    if (!d.ask || asked.has(cell)) { if (d.ask) asked.add(cell); continue; }
    asked.add(cell);
    out.asked += 1;
    if (wrong && d.cands.some((x) => x.value === c.truth)) out.caught += 1;
    if (!wrong) out.fp.push(c);
  }
  return out;
}

test('픽스처 형상 — 세션 10 · 음성 커밋 984 · clean 892 · 오커밋 92 (STT 레인 stt-attempts.tsv와 같은 전수)', () => {
  expect(new Set(commits.map((c) => c.sid)).size).toBe(10);
  expect(commits.length).toBe(984);
  expect(commits.filter((c) => c.heard === c.truth).length).toBe(892);
});

test('🔴 clean 892 시도에서 발동 0 — 위양성이 있으면 목록으로 실패한다', () => {
  const r = simulate();
  expect(r.fp.map((c) => `${c.sid} r${c.row} ${c.col} heard=${c.heard}`), 'clean 셀에서 질문이 났다').toEqual([]);
  // 반증 짝(압력): 같은 시뮬이 오커밋 쪽에서는 실제로 발동·포착한다 — 게이트가 「아무것도 안 묻는다」로
  // 통과하는 것이 아니다([TEAMOPS-37]). 숫자는 표 재생성 시 바뀔 수 있어 하한만 고정한다.
  // r2 P2-2(컬럼 증거 우선) 뒤 인샘플 실측 발동 19 · 포착 12 — 하한은 그 아래로 고정한다.
  expect(r.asked).toBeGreaterThanOrEqual(15);
  expect(r.caught).toBeGreaterThanOrEqual(10);
});

/** r2 P2-6 — 픽스처 984건은 지배 규칙(`L1P0:1>8`)에 대해 「1.x가 정상인 clean」이 사실상 없어(적정 1.95 1건 · 셀 상한에 가려짐)
 *  공집합 검증이었다. 1.x가 정상인 컬럼의 **합성 clean**을 런타임 경로(`evaluateSttConfusion` · 출하 표 · 프로필 미선택)로
 *  넣어 발동 0을 단언한다. 같은 describe에 반드시 발동해야 하는 행(당도 1.7)을 두어 압력을 건다([TEAMOPS-37]). */
test.describe('r2 P2-6 — 1.x가 정상인 컬럼의 합성 clean 픽스처 · 출하 표 · 발동 0', () => {
  const col = (id: string, name: string, type: 'float' | 'int', decimals?: number): Column => ({
    id, name, type, input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, ...(decimals != null ? { decimals } : {}),
  });
  const TITR = col('c15', '적정', 'float', 2);      // 적정 1.9x — 실측 정상값(09-02 r5 1.95)
  const PEEL = col('c7', '과피두께x4', 'float', 1);  // 과피두께 1.x — mm 단위 정상 범위
  const COUNT = col('c20', '과수', 'int');          // 개수 「1」
  const BRIX = col('c14', '당도', 'float', 1);
  const noop = () => {};
  test.beforeEach(() => resetSttConfusionSession());

  test('적정 1.91~1.95 ×5 · 과피두께 1.1~1.5 ×5 · 과수 「1」 ×3 → 발동 0', () => {
    const fired: string[] = [];
    let row = 1;
    for (const heard of ['1.91', '1.92', '1.93', '1.94', '1.95']) if (evaluateSttConfusion({ row: row++, colId: TITR.id, colName: TITR.name, col: TITR, heard }, noop)) fired.push(`적정 ${heard}`);
    for (const heard of ['1.1', '1.2', '1.3', '1.4', '1.5']) if (evaluateSttConfusion({ row: row++, colId: PEEL.id, colName: PEEL.name, col: PEEL, heard }, noop)) fired.push(`과피두께 ${heard}`);
    for (const heard of ['1', '1', '1']) if (evaluateSttConfusion({ row: row++, colId: COUNT.id, colName: COUNT.name, col: COUNT, heard }, noop)) fired.push(`과수 ${heard}`);
    expect(fired, '1.x가 정상인 컬럼에서 질문이 났다').toEqual([]);
  });
  test('압력: 같은 표·같은 경로에서 당도 「1.7」은 발동한다(발동 0이 「아무것도 안 묻는 코드」로 통과하지 않게)', () => {
    const q = evaluateSttConfusion({ row: 1, colId: BRIX.id, colName: BRIX.name, col: BRIX, heard: '1.7' }, noop);
    expect(q?.cands).toEqual(['8.7']);
  });
});
