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

