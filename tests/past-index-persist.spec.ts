/**
 * v0.33.0 항목5 — 과거값 인덱스 영속화(IDB write-through) 순수 로직 단위 테스트.
 * (pastValues.spec.ts 패턴: 브라우저 의존부(IDB round-trip 자체)는 e2e
 *  past-index-fallback.spec.ts가 담당하고, 여기서는 Node에서 직접 검증한다.)
 *
 * 커버리지:
 *  - serializePastIndexEntry / deserializePastIndexEntry: Map↔entries 배열 round-trip
 *    (JSON 경유 포함 — IDB structured clone보다 엄격한 조건), 손상 레코드 → null.
 *  - isFallbackFresh: 28일 경계(경계 포함 = 유효, +1ms = 무효).
 *  - withTimeout: 시간 내 resolve / 초과 시 'timeout after' reject / 내부 오류 전파.
 */
import { test, expect } from '@playwright/test';
import {
  KEY_SEP,
  buildPastIndex,
  resolveRoundCol,
  previousRound,
  pastValue,
} from '../src/lib/pastValuesIndex';
import {
  serializePastIndexEntry,
  deserializePastIndexEntry,
  isFallbackFresh,
  FALLBACK_TTL_MS,
} from '../src/lib/pastValuesPersist';
// v0.38.0 — withTimeout은 계층 중립 유틸(lib/async)로 이동. 검증 내용은 그대로 여기서 유지한다.
import { withTimeout } from '../src/lib/async';
import type { Column } from '../src/types';

const col = (id: string, name: string, over: Partial<Column> = {}): Column => ({
  id,
  name,
  type: 'text',
  input: 'auto',
  ttsAnnounce: false,
  auto: { kind: 'fixed', value: '' },
  ...over,
});

const COLS: Column[] = [
  col('c1', '조사일자', { type: 'date' }),
  col('c3', '농가명'),
  col('c4', '라벨'),
  col('c6', '조사나무', { type: 'int' }),
  col('c8', '횡경', { type: 'float', input: 'voice', trendRule: 'increase' }),
  col('c10', '비고', { input: 'touch' }),
];

const HEADERS = ['조사일자', '농가명', '라벨', '조사나무', '횡경', '종경'];
const ROWS: string[][] = [
  ['2026-05-13', '이원창', 'A', '1', '111.1', '105.0'],
  ['2026-05-20', '이원창', 'A', '1', '122.2', '110.0'],
  ['2026-05-27', '이원창', 'A', '1', '133.3', '120.0'],
  ['2026-05-27', '이원창', 'A', '1', '144.4', '121.0'], // (키,회차) 중복 → 마지막 행 승리
  ['2026-05-20', '이원창', 'A', '2', '99.9', '95.0'],
];
const KEY1 = ['이원창', 'A', '1'].join(KEY_SEP);
const KEY2 = ['이원창', 'A', '2'].join(KEY_SEP);

function makeIndex() {
  return buildPastIndex(HEADERS, ROWS, COLS, resolveRoundCol(COLS, null));
}

test.describe('serialize / deserialize — round-trip', () => {
  test('JSON 경유 round-trip이 인덱스 조회 의미론을 보존한다', () => {
    const index = makeIndex();
    const entry = { fp: 'fp-test-1', builtAt: 1_760_000_000_000, index };
    const rec = serializePastIndexEntry(entry);
    // IDB structured clone보다 엄격한 JSON round-trip으로도 살아남아야 한다.
    const back = deserializePastIndexEntry(JSON.parse(JSON.stringify(rec)));
    expect(back).not.toBeNull();
    expect(back!.fp).toBe('fp-test-1');
    expect(back!.builtAt).toBe(1_760_000_000_000);

    const b = back!.index;
    expect(b.rowCount).toBe(index.rowCount);
    expect(b.duplicateCount).toBe(index.duplicateCount);
    expect(b.rounds).toEqual(index.rounds);
    expect(b.unmappedColumns).toEqual(index.unmappedColumns); // ['비고']
    expect([...b.headersMapped.entries()].sort()).toEqual([...index.headersMapped.entries()].sort());

    // 조회 함수가 원본과 동일하게 동작(폴백 인덱스가 evaluateTrend에 그대로 쓰이는 계약).
    expect(previousRound(b, KEY1, '2026-05-27')).toBe('2026-05-20');
    expect(pastValue(b, KEY1, '2026-05-27', 'c8')).toBe('144.4'); // 마지막 행 승리 보존
    expect(pastValue(b, KEY2, '2026-05-20', 'c8')).toBe('99.9');
    expect(pastValue(b, KEY2, '2026-05-13', 'c8')).toBeNull();
  });

  test('빈 인덱스(회차 0)도 round-trip', () => {
    const index = buildPastIndex(HEADERS, [], COLS, null);
    const rec = serializePastIndexEntry({ fp: 'fp-empty', builtAt: 1, index });
    const back = deserializePastIndexEntry(JSON.parse(JSON.stringify(rec)));
    expect(back).not.toBeNull();
    expect(back!.index.samples.size).toBe(0);
    expect(back!.index.rounds).toEqual([]);
    expect(back!.index.rowCount).toBe(0);
  });
});

test.describe('deserialize — 손상 레코드는 null(조용히 폐기)', () => {
  const good = serializePastIndexEntry({ fp: 'fp', builtAt: 100, index: makeIndex() });

  const badCases: Array<[string, unknown]> = [
    ['null', null],
    ['문자열', 'not-a-record'],
    ['빈 객체', {}],
    ['fp 비문자열', { ...good, fp: 42 }],
    ['builtAt 누락', (() => { const r = { ...good } as Record<string, unknown>; delete r.builtAt; return r; })()],
    ['builtAt NaN', { ...good, builtAt: Number.NaN }],
    ['headersMapped 비배열', { ...good, headersMapped: { c1: 0 } }],
    ['headersMapped 쌍 형태 오류', { ...good, headersMapped: [['c1', '0']] }],
    ['samples 비배열', { ...good, samples: 'oops' }],
    ['samples 엔트리 형태 오류', { ...good, samples: [['key1', 'not-an-array']] }],
    ['samples 회차 레코드 null', { ...good, samples: [['key1', [['2026-05-13', null]]]] }],
    ['rowCount 비숫자', { ...good, rowCount: '7' }],
  ];
  for (const [label, raw] of badCases) {
    test(`${label} → null`, () => {
      expect(deserializePastIndexEntry(raw)).toBeNull();
    });
  }

  test('정상 레코드는 통과(대조군)', () => {
    expect(deserializePastIndexEntry(JSON.parse(JSON.stringify(good)))).not.toBeNull();
  });
});

test.describe('isFallbackFresh — 28일 경계', () => {
  const NOW = 1_760_000_000_000;

  test('방금 빌드 → 유효', () => {
    expect(isFallbackFresh(NOW, NOW)).toBe(true);
  });

  test('정확히 28일 → 유효(경계 포함)', () => {
    expect(isFallbackFresh(NOW - FALLBACK_TTL_MS, NOW)).toBe(true);
  });

  test('28일 + 1ms → 무효', () => {
    expect(isFallbackFresh(NOW - FALLBACK_TTL_MS - 1, NOW)).toBe(false);
  });

  test('FALLBACK_TTL_MS = 28일(플랜 확정값 고정)', () => {
    expect(FALLBACK_TTL_MS).toBe(28 * 24 * 60 * 60 * 1000);
  });
});

test.describe('withTimeout — fetch 무한대기 방지 래퍼', () => {
  test('시간 내 resolve → 값 그대로', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
  });

  test('시간 초과 → "timeout after Nms" reject (재시도 버튼/백오프 경로의 트리거)', async () => {
    const never = new Promise<string>(() => { /* 영원히 pending — hang 시뮬레이션 */ });
    await expect(withTimeout(never, 20)).rejects.toThrow('timeout after 20ms');
  });

  test('내부 오류는 타임아웃 전에 그대로 전파', async () => {
    await expect(withTimeout(Promise.reject(new Error('HTTP 500')), 1000)).rejects.toThrow('HTTP 500');
  });
});
