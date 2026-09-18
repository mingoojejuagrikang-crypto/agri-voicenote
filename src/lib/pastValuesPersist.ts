/**
 * 과거값 인덱스의 **영속 직렬화** (v0.33.0 항목5 — 순수 함수, Node 단위 테스트 대상).
 *
 * [ENV-12] 2026-08-15 — `pastValues.ts`에서 분리했다. IDB 접근은 여기 없다(`db.ts`가 소유):
 * 이 파일은 `PastIndex`의 `Map`을 JSON-호환 평면 레코드로 펴고 되접는 **형태 변환**만 한다.
 * 로더(`pastValues.ts`)가 write-through·하이드레이션 시점에 이 함수들을 부른다.
 *
 * ⚠️ import 방향은 **단방향**이다 — `pastValuesIndex.ts`의 타입만 받고, `pastValues.ts`는
 * 참조하지 않는다.
 */
import type { PastIndex } from './pastValuesIndex';

/** 폴백 유효기간: 28일. 회차 간격(주 단위 조사)을 넉넉히 덮되, 시즌이 지난 죽은 인덱스로
 *  엉뚱한 직전값 비교를 하지 않게 상한을 둔다(플랜 확정값).
 *  v0.55.0 민구 Q14 ⓑ — 조사 간격 ≈13일이라 14일은 하루만 밀려도 끊겼다 · 로그인 연결 4주와 같게. */
export const FALLBACK_TTL_MS = 28 * 24 * 60 * 60 * 1000;

/** 28일 경계 판정(경계 포함: 정확히 28일 = 아직 유효). 순수 함수 — 단위 테스트 대상. */
export function isFallbackFresh(builtAt: number, now: number): boolean {
  return now - builtAt <= FALLBACK_TTL_MS;
}

/** IDB 'kv' 스토어(`__past_index__`)에 저장되는 JSON-호환 레코드. Map은 entries 배열로 편다
 *  (structured clone이 Map을 지원하긴 하나, 검증 가능한 평면 형태가 복원 안전성·테스트에 유리). */
export interface PersistedPastIndexRecord {
  fp: string;
  builtAt: number;
  headersMapped: [string, number][];
  unmappedColumns: string[];
  rounds: string[];
  samples: [string, [string, Record<string, string>][]][];
  duplicateCount: number;
  rowCount: number;
  /** M8(#11) — 구버전 레코드에는 없다. 복원 시 0(= 종전 판정)으로 떨어진다. */
  roundParsedRows?: number;
  /** v0.50 D(#10) — 전체 샘플키 프루닝으로 버려진 행들(회차 파싱분). M8과 **같은 이유로**
   *  optional이다: 이 필드 이전 백업이 폐기되면 14일 폴백이 끊긴다. 없으면 `[]`(= 종전 판정).
   *  Map이 아니라 이미 평면 배열이라 펴고 접을 것이 없다. */
  prunedKeyRows?: { round: string; rec: Record<string, string> }[];
}

export function serializePastIndexEntry(entry: {
  fp: string;
  builtAt: number;
  index: PastIndex;
}): PersistedPastIndexRecord {
  const { fp, builtAt, index } = entry;
  return {
    fp,
    builtAt,
    headersMapped: [...index.headersMapped.entries()],
    unmappedColumns: [...index.unmappedColumns],
    rounds: [...index.rounds],
    samples: [...index.samples.entries()].map(
      ([key, byRound]) => [key, [...byRound.entries()]] as [string, [string, Record<string, string>][]],
    ),
    duplicateCount: index.duplicateCount,
    rowCount: index.rowCount,
    roundParsedRows: index.roundParsedRows,
    prunedKeyRows: index.prunedKeyRows,
  };
}

/** 레코드 복원 + 형태 검증. 손상/구버전/이형 레코드는 null(조용히 폐기 — 폴백은 best-effort). */
export function deserializePastIndexEntry(
  raw: unknown,
): { fp: string; builtAt: number; index: PastIndex } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Partial<PersistedPastIndexRecord>;
  if (typeof r.fp !== 'string' || typeof r.builtAt !== 'number' || !Number.isFinite(r.builtAt)) return null;
  if (
    !Array.isArray(r.headersMapped) || !Array.isArray(r.unmappedColumns) ||
    !Array.isArray(r.rounds) || !Array.isArray(r.samples) ||
    typeof r.duplicateCount !== 'number' || typeof r.rowCount !== 'number'
  ) return null;
  try {
    const headersMapped = new Map<string, number>();
    for (const pair of r.headersMapped) {
      if (!Array.isArray(pair) || typeof pair[0] !== 'string' || typeof pair[1] !== 'number') return null;
      headersMapped.set(pair[0], pair[1]);
    }
    const samples = new Map<string, Map<string, Record<string, string>>>();
    for (const entry of r.samples) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !Array.isArray(entry[1])) return null;
      const byRound = new Map<string, Record<string, string>>();
      for (const pair of entry[1]) {
        if (!Array.isArray(pair) || typeof pair[0] !== 'string' || typeof pair[1] !== 'object' || pair[1] === null) return null;
        byRound.set(pair[0], pair[1]);
      }
      samples.set(entry[0], byRound);
    }
    return {
      fp: r.fp,
      builtAt: r.builtAt,
      index: {
        headersMapped,
        unmappedColumns: r.unmappedColumns.filter((x): x is string => typeof x === 'string'),
        rounds: r.rounds.filter((x): x is string => typeof x === 'string'),
        samples,
        duplicateCount: r.duplicateCount,
        rowCount: r.rowCount,
        // M8(#11) — **형태 검증에 넣지 않는다.** 필수로 만들면 이 필드 이전에 저장된 백업이
        //   통째로 폐기돼(deserialize가 null) 14일 폴백이 끊긴다. 없으면 0 = 종전 판정.
        roundParsedRows: typeof r.roundParsedRows === 'number' ? r.roundParsedRows : 0,
        // v0.50 D(#10) — M8과 같다: **형태 검증에 넣지 않는다.** 항목별로 걸러 담아
        //   이형 엔트리 하나가 레코드 전체를 폐기시키지 않게 한다(폴백은 best-effort).
        prunedKeyRows: Array.isArray(r.prunedKeyRows)
          ? r.prunedKeyRows.filter(
              (x): x is { round: string; rec: Record<string, string> } =>
                typeof x === 'object' && x !== null &&
                typeof (x as { round?: unknown }).round === 'string' &&
                typeof (x as { rec?: unknown }).rec === 'object' &&
                (x as { rec?: unknown }).rec !== null,
            )
          : [],
      },
    };
  } catch {
    return null;
  }
}
