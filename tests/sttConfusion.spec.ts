/**
 * v0.51.1 R6 — 화자별 STT 혼동표 **순수 함수 오라클**(Node 러너 · 서버 불필요 · koreanNum.spec 패턴).
 *
 * 브리핑 §2 순수 스펙: 후보 생성(8.7 heard=1.7 → 8.7·7.7) · 「점」 소실(837 → 8.37/83.7 · decimals 기준) ·
 * 지지수 미만 치환 미적용 · 화자 프로필 우선 → 전역 폴백 · 부정 사례 반영 후 질문 억제 · 상한(셀당 1회).
 * 🔴 오라클은 제품 상수를 읽지 않고 **표를 손으로 만든다**([TEAMOPS-38]) — 전역 표 JSON의 형상은 아래 별도
 * describe가 스키마로 잰다(내용 숫자는 회차마다 바뀌므로 「상위 규칙이 무엇인가」만 고정).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_CANDIDATE_PARAMS, addNegative, addObservation, alignPair, applyDecimalLossRule, colKey, decide,
  decimalLossEligible, emptyTable, generateCandidates, mergeTables, noteSeen,
  shouldHintSevenEight, type ConfusionTable,
} from '../src/lib/sttConfusionCore.ts';
import defaultJson from '../src/data/stt-confusion-default.json' with { type: 'json' };

/** heard→said 관측을 n번 넣고 분모를 seen만큼 채운 표. */
function tableWith(col: string, obs: { heard: string; said: string; n: number; seen: number; decimals?: number }[]): ConfusionTable {
  const t = emptyTable();
  for (const o of obs) {
    for (let i = 0; i < o.seen; i++) noteSeen(t, col, o.heard, o.decimals ?? 1, 'float');
    for (let i = 0; i < o.n; i++) for (const a of alignPair(o.heard, o.said, o.decimals ?? 1)) addObservation(t, col, a);
  }
  return t;
}

test.describe('alignPair — 정정 쌍 정렬(heard → said)', () => {
  test('같은 자릿수 한 자리 치환은 정수부 문맥 L<자릿수>P<자리>로 잡힌다', () => {
    expect(alignPair('1.7', '8.7', 1)).toEqual([{ kind: 'digit', ctx: 'L1P0', heard: '1', said: '8' }]);
    expect(alignPair('11.2', '12.2', 1)).toEqual([{ kind: 'digit', ctx: 'L2P1', heard: '1', said: '2' }]);
    // 소수부 자리는 F<자리>로 **기록만** — 후보 생성 대상이 아니다(파일 헤더).
    expect(alignPair('7.9', '7.5', 1)).toEqual([{ kind: 'digit', ctx: 'F0', heard: '9', said: '5' }]);
  });
  test('「점」 소실 4형상 — 738→7.8(as3) · 7007→7.7(as00) · 7.8을 708로(as0) · 837→83.7(insert)', () => {
    expect(alignPair('738', '7.8', 1)).toEqual([{ kind: 'decimalLoss', rule: 'as3' }]);
    expect(alignPair('7007', '7.7', 1)).toEqual([{ kind: 'decimalLoss', rule: 'as00' }]);
    expect(alignPair('708', '7.8', 1)).toEqual([{ kind: 'decimalLoss', rule: 'as0' }]);
    expect(alignPair('837', '83.7', 1)).toEqual([{ kind: 'decimalLoss', rule: 'insert' }]);
    expect(alignPair('3303', '3.03', 2)).toEqual([{ kind: 'decimalLoss', rule: 'as3' }]);
  });
  test('두 자리 이상 다르거나 자릿수가 바뀐 쌍은 other 태그로만 남는다(표 오염 금지)', () => {
    expect(alignPair('1.4', '7.7', 1)).toEqual([{ kind: 'other', tag: 'multi_diff' }]);
    expect(alignPair('1.5', '51.5', 1)).toEqual([{ kind: 'other', tag: 'leading_digits_lost' }]);
    expect(alignPair('40', '42.2', 1)[0].kind).toBe('other');
    expect(alignPair('1.7', '1.7', 1)).toEqual([]);
    expect(alignPair('세 점 일', '3.1', 1)).toEqual([{ kind: 'other', tag: 'non_numeric' }]);
  });
});

test.describe('generateCandidates — 후보 생성', () => {
  test('브리핑 §2: heard=1.7 → 8.7·7.7 (지지수·확률 게이트 통과)', () => {
    const t = tableWith('당도', [
      { heard: '1.7', said: '8.7', n: 6, seen: 12 },
      { heard: '1.7', said: '7.7', n: 4, seen: 0 },
    ]);
    const c = generateCandidates({ heard: '1.7', col: '당도', decimals: 1, colType: 'float', tables: [t] });
    expect(c.map((x) => x.value)).toEqual(['8.7', '7.7']);
    expect(c[0]).toMatchObject({ rule: 'L1P0:1>8', scope: 'col0' });
    expect(c[0].p).toBeCloseTo(6 / 12, 5);
    expect(c[0].pHeard).toBeCloseTo(2 / 12, 5);
  });
  test('지지수 미만(kSupport=3) 치환은 후보가 되지 않는다', () => {
    const t = tableWith('당도', [{ heard: '1.7', said: '8.7', n: 2, seen: 4 }]);
    expect(generateCandidates({ heard: '1.7', col: '당도', decimals: 1, colType: 'float', tables: [t] })).toEqual([]);
    // 같은 표로 kSupport=2면 나온다 — 게이트가 지지수라는 것을 반증 짝으로 고정.
    expect(generateCandidates({ heard: '1.7', col: '당도', decimals: 1, colType: 'float', tables: [t], params: { kSupport: 2 } }).map((x) => x.value)).toEqual(['8.7']);
  });
  test('「점」 소실: 837(decimals=1) → 83.7 · 8.37은 decimals=2 컬럼에서만', () => {
    const t1 = tableWith('당도', [{ heard: '837', said: '83.7', n: 3, seen: 5 }]);
    expect(generateCandidates({ heard: '837', col: '당도', decimals: 1, colType: 'float', tables: [t1] }).map((x) => x.value)).toEqual(['83.7']);
    const t2 = tableWith('적정', [{ heard: '837', said: '8.37', n: 3, seen: 5, decimals: 2 }]);
    expect(generateCandidates({ heard: '837', col: '적정', decimals: 2, colType: 'float', tables: [t2] }).map((x) => x.value)).toEqual(['8.37']);
    // 정수 컬럼·소수부 있는 값·2자리 정수는 형상 자체가 적격이 아니다.
    expect(decimalLossEligible('837', 1, 'int')).toBe(false);
    expect(decimalLossEligible('83.7', 1, 'float')).toBe(false);
    expect(decimalLossEligible('40', 1, 'float')).toBe(false);
    expect(applyDecimalLossRule('738', 1, 'as3')).toBe('7.8');
    expect(applyDecimalLossRule('738', 1, 'as00')).toBeNull();
    expect(applyDecimalLossRule('7007', 1, 'as00')).toBe('7.7');
  });
  test('화자 프로필 표가 전역 표보다 먼저다 — 같은 규칙이면 프로필의 확률·분모를 쓴다', () => {
    const profile = tableWith('당도', [{ heard: '1.7', said: '8.7', n: 3, seen: 3 }]); // 3/3 = 1.0
    const global = tableWith('당도', [{ heard: '1.7', said: '8.7', n: 8, seen: 40 }]); // 8/40 = 0.2
    const c = generateCandidates({ heard: '1.7', col: '당도', decimals: 1, colType: 'float', tables: [profile, global] });
    expect(c[0]).toMatchObject({ value: '8.7', scope: 'col0' });
    expect(c[0].p).toBeCloseTo(1, 5);
    // 프로필에 그 규칙의 지지수가 모자라면 전역으로 **폴백**한다(scope 표 순번 1).
    const thin = tableWith('당도', [{ heard: '1.7', said: '8.7', n: 1, seen: 1 }]);
    const c2 = generateCandidates({ heard: '1.7', col: '당도', decimals: 1, colType: 'float', tables: [thin, global] });
    expect(c2[0]).toMatchObject({ value: '8.7', scope: 'col1' });
    expect(c2[0].p).toBeCloseTo(0.2, 5);
  });
  test('컬럼 스코프가 문맥 스코프보다 먼저다 — 다른 컬럼의 정정은 이 컬럼의 확률을 만들지 않는다', () => {
    const t = tableWith('당도', [{ heard: '1.7', said: '8.7', n: 5, seen: 10 }]);
    // 적정 컬럼에는 컬럼 스코프 지지수가 없다 → 전역 문맥(L1P0) 스코프(ctx0)로 답한다.
    const c = generateCandidates({ heard: '1.31', col: '적정', decimals: 2, colType: 'float', tables: [t] });
    expect(c[0]).toMatchObject({ value: '8.31', scope: 'ctx0' });
  });
});

test.describe('decide — 판정·부정 사례·상한', () => {
  test('후보가 없거나 확률이 낮으면 묻지 않는다 · 있으면 원값 확률과 견줘 묻는다', () => {
    expect(decide('49.5', []).ask).toBe(false);
    const t = tableWith('당도', [{ heard: '1.7', said: '8.7', n: 3, seen: 30 }]); // p=0.1 < θ
    const c = generateCandidates({ heard: '1.7', col: '당도', decimals: 1, colType: 'float', tables: [t] });
    expect(c).toEqual([]);
    const t2 = tableWith('당도', [{ heard: '1.7', said: '8.7', n: 4, seen: 20 }]); // p=0.2 · pHeard=0.8 → 0.2 < 0.5×0.8
    const c2 = generateCandidates({ heard: '1.7', col: '당도', decimals: 1, colType: 'float', tables: [t2] });
    expect(decide('1.7', c2).reason).toBe('below_rho');
    const t3 = tableWith('당도', [{ heard: '1.7', said: '8.7', n: 4, seen: 6 }]); // p=0.67 · pHeard=0.33
    const c3 = generateCandidates({ heard: '1.7', col: '당도', decimals: 1, colType: 'float', tables: [t3] });
    expect(decide('1.7', c3)).toMatchObject({ ask: true, reason: 'ask' });
  });
  test('「첫째」 부정 사례는 분모만 올려 P를 낮춘다 — 반복되면 질문이 스스로 멎는다', () => {
    const t = tableWith('당도', [{ heard: '1.7', said: '8.7', n: 3, seen: 5 }]); // 0.6
    const ask = () => decide('1.7', generateCandidates({ heard: '1.7', col: '당도', decimals: 1, colType: 'float', tables: [t] })).ask;
    expect(ask()).toBe(true);
    for (let i = 0; i < 5; i++) addNegative(t, '당도', 'L1P0:1>8'); // seen 5 → 10 · p=0.30 · pHeard=0.70 → 0.30 < 0.5×0.70
    expect(ask()).toBe(false);
    // 반증 짝: 부정 사례 없이 같은 횟수만큼 정정이 더 쌓이면 여전히 묻는다.
    const t2 = tableWith('당도', [{ heard: '1.7', said: '8.7', n: 8, seen: 10 }]);
    expect(decide('1.7', generateCandidates({ heard: '1.7', col: '당도', decimals: 1, colType: 'float', tables: [t2] })).ask).toBe(true);
  });
  test('후보는 최대 maxCands(2)개 · 확률 순', () => {
    const t = tableWith('당도', [
      { heard: '1.7', said: '8.7', n: 6, seen: 12 }, { heard: '1.7', said: '7.7', n: 4, seen: 0 }, { heard: '1.7', said: '9.7', n: 3, seen: 0 },
    ]);
    const d = decide('1.7', generateCandidates({ heard: '1.7', col: '당도', decimals: 1, colType: 'float', tables: [t] }));
    expect(d.cands.map((c) => c.value)).toEqual(['8.7', '7.7']);
  });
  test('🔴 그럴듯함은 혼동표 확률뿐 — 판정 함수는 세션 이전 값을 받지 않는다(민구 결정 09-02 ⓐ)', () => {
    // 소스 텍스트 계약: 이전 값·범위·중앙값을 읽는 코드가 되살아나면 여기가 먼저 깨진다(idb-fixture.spec 패턴).
    const src = readFileSync(new URL('../src/lib/sttConfusionCore.ts', import.meta.url), 'utf8');
    for (const banned of ['priorWeight', 'history', 'median(', 'usePrior']) expect(src, `core에 ${banned}`).not.toContain(banned);
    expect(DEFAULT_CANDIDATE_PARAMS).not.toHaveProperty('usePrior');
    // 같은 표·같은 후보면 어떤 문맥에서도 판정이 같다(순수).
    const t = tableWith('당도', [{ heard: '1.7', said: '8.7', n: 4, seen: 6 }]);
    const c = generateCandidates({ heard: '1.7', col: '당도', decimals: 1, colType: 'float', tables: [t] });
    expect(decide('1.7', c)).toEqual(decide('1.7', c));
  });
});

test.describe('표 유틸', () => {
  test('colKey — 괄호 단위·공백을 벗겨 시트 간 같은 이름을 잇는다', () => {
    expect(colKey('종경(mm)')).toBe('종경');
    expect(colKey('종경')).toBe('종경');
    expect(colKey('과피두께x4')).toBe('과피두께x4');
    expect(colKey(' 횡경 (mm) ')).toBe('횡경');
  });
  test('mergeTables — 화자별 표를 전역으로 합치면 지지수·분모가 더해진다', () => {
    const a = tableWith('당도', [{ heard: '1.7', said: '8.7', n: 2, seen: 3 }]);
    const b = tableWith('당도', [{ heard: '1.7', said: '8.7', n: 1, seen: 2 }]);
    const g = mergeTables(emptyTable(), a);
    mergeTables(g, b);
    expect(g.ctx.L1P0.conf['1']['8']).toBe(3);
    expect(g.ctx.L1P0.seen['1']).toBe(5);
    expect(g.byColumn['당도'].ctx.L1P0.conf['1']['8']).toBe(3);
  });
  test('shouldHintSevenEight — 7/8 혼동이 지지수 이상이면 true(R4 문구 훅 · 발화는 여기 없음)', () => {
    expect(shouldHintSevenEight([tableWith('당도', [{ heard: '1.7', said: '8.7', n: 3, seen: 3 }])])).toBe(true);
    expect(shouldHintSevenEight([tableWith('당도', [{ heard: '4.7', said: '5.7', n: 3, seen: 3 }])])).toBe(false);
    expect(shouldHintSevenEight([tableWith('당도', [{ heard: '1.7', said: '8.7', n: 2, seen: 3 }])])).toBe(false);
  });
});

test.describe('전역 표 v1 — src/data/stt-confusion-default.json 스키마', () => {
  const j = defaultJson as unknown as {
    schema: number; direction: string; sessions: number; pairs: number; aligned: number;
    top: { rule: string; support: number; seen: number; p: number }[]; table: ConfusionTable;
  };
  test('형상: schema 1 · direction heard->said · table.ctx/byColumn/decimalLoss · 세션·쌍 수 양수', () => {
    expect(j.schema).toBe(1);
    expect(j.direction).toBe('heard->said');
    expect(j.table.direction).toBe('heard->said');
    expect(j.sessions).toBeGreaterThan(0);
    expect(j.pairs).toBeGreaterThan(0);
    expect(j.aligned).toBeLessThanOrEqual(j.pairs);
    expect(typeof j.table.ctx).toBe('object');
    expect(typeof j.table.byColumn).toBe('object');
    expect(j.table.decimalLoss.rules).toEqual(expect.objectContaining({ as3: expect.any(Number), as00: expect.any(Number), as0: expect.any(Number), insert: expect.any(Number) }));
    // 모든 스코프에서 지지수 ≤ 분모(확률 ≤ 1) — 정렬·분모 갱신이 짝이 맞는다는 불변식.
    const holders = [j.table, ...Object.values(j.table.byColumn)];
    for (const h of holders) {
      for (const s of Object.values(h.ctx)) {
        for (const [x, row] of Object.entries(s.conf)) {
          let wrong = 0;
          for (const [y, n] of Object.entries(row)) if (y !== x) wrong += n;
          expect(wrong, `conf[${x}] ≤ seen[${x}]`).toBeLessThanOrEqual(s.seen[x] ?? 0);
        }
      }
    }
    // 이름·이메일이 표에 없다(화자는 해시뿐).
    expect(JSON.stringify(j)).not.toMatch(/@|농가|강남호|양훈성|양혁진|양승보|이원창/);
  });
  test('09-02 실측 상위 혼동쌍이 표에 있다 — L1P0:1>8 · dec:as3 · L1P0:1>7 (지지수 ≥ 3)', () => {
    const top = Object.fromEntries(j.top.map((r) => [r.rule, r.support]));
    expect(top['L1P0:1>8']).toBeGreaterThanOrEqual(3);
    expect(top['dec:as3']).toBeGreaterThanOrEqual(3);
    expect(top['L1P0:1>7']).toBeGreaterThanOrEqual(3);
    // 그래서 전역 표만으로 당도 「1.7」은 8.7을 묻는다(런타임 폴백 경로의 실제 형상).
    const d = decide('1.7', generateCandidates({ heard: '1.7', col: '당도', decimals: 1, colType: 'float', tables: [j.table] }));
    expect(d.ask).toBe(true);
    expect(d.cands[0].value).toBe('8.7');
  });
});
