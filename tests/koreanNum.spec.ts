/**
 * Korean spoken-number parser — pure-function unit tests.
 *
 * koreanNum.ts has no DOM/browser dependencies, so we import it directly and
 * exercise it in Node (no page.goto). Uses the project's existing Playwright
 * test runner so no new tooling is introduced.
 *
 * Coverage focus:
 *  - H1: decimal token preservation ("<정수부> 점 <소수부>" recombination)
 *  - H1: unparseable integer part → null (no stray-fraction auto-commit)
 *  - Regression guard for previously-correct utterances
 *  - M1: extractRedoValue inline-value extraction
 */

import { test, expect } from '@playwright/test';
import {
  parseKoreanNumber,
  extractModifyValue,
  detectCommand,
  isAmbiguousSingleSyllable,
  isBareResponseWord,
  getLastParseFailReason,
  getLastSalvageCandidate,
  getLastParseFailWhole,
} from '../src/lib/koreanNum';

test.describe('parseKoreanNumber — decimal preservation (H1)', () => {
  const ok: Array<[string, string]> = [
    // whole-spoken path (already worked) — regression guards
    ['칠십사 점 칠', '74.7'],
    ['이십 점 오', '20.5'],
    ['일 점 오', '1.5'],
    ['삼십오 점 일', '35.1'],
    // space-separated decimal tokens (per-token loop used to drop "점")
    ['세 점 칠', '3.7'],
    ['칠 점 칠', '7.7'],
    // mixed sino integer + sino fraction across spaces
    ['이십삼 점 사', '23.4'],
    // forces the new recombination block: a unit suffix (도) fails the whole-spoken
    // charset regex, so this routes through the per-token-preceding decimal recombine path.
    ['칠십사 점 칠도', '74.7'],
    ['이십 점 오 mm', '20.5'],
  ];
  for (const [input, expected] of ok) {
    test(`"${input}" → ${expected}`, () => {
      expect(parseKoreanNumber(input)).toBe(expected);
    });
  }
});

test.describe('parseKoreanNumber — stray fraction must not auto-commit (H1)', () => {
  // "세대" has no numeric mapping (74 = 칠십사). Previously this parsed to "7"
  // (last token only). It must now yield null so the caller re-asks.
  test('"세대 점 칠" → null (unparseable integer part)', () => {
    expect(parseKoreanNumber('세대 점 칠')).toBeNull();
  });
  test('"점 칠" → null (no integer part)', () => {
    expect(parseKoreanNumber('점 칠')).toBeNull();
  });
});

test.describe('parseKoreanNumber — "점" as a literal word, not a decimal separator (Codex HIGH-1)', () => {
  // The 점/쩜 decimal-split was too aggressive: any "점" caused integer-part validation,
  // turning normal utterances containing the WORD "점" (점수=score) into null (re-ask).
  // Now "점" is only a separator when the tail starts with fraction digits.
  test('"점수 8" → "8" (tail "수 8" is not fraction digits → fall through)', () => {
    expect(parseKoreanNumber('점수 8')).toBe('8');
  });
  test('"당도 점수 8" → "8"', () => {
    expect(parseKoreanNumber('당도 점수 8')).toBe('8');
  });
  test('"다시 점수 8" → "8" (redo keyword stripped by caller; bare parse keeps 8)', () => {
    // parseKoreanNumber itself does not handle the redo keyword, but "다시 점수 8" must
    // still not collapse to null — the trailing 8 is recoverable.
    expect(parseKoreanNumber('다시 점수 8')).toBe('8');
  });
});

test.describe('parseKoreanNumber — multiple 점/쩜 must not silently commit a trailing token (Codex HIGH-2)', () => {
  test('"칠십사 점 칠 점 팔" → null (stray trailing fraction)', () => {
    expect(parseKoreanNumber('칠십사 점 칠 점 팔')).toBeNull();
  });
});

test.describe('parseKoreanNumber — arabic decimal whole + spoken fraction (Codex MEDIUM-3)', () => {
  // "33.5 점 칠": whole "33.5" is a non-integer arabic decimal. Combining 33.5 + "." + 7
  // would yield "33.5.7" → parseFloat keeps only 33.5, silently dropping the spoken fraction.
  // Must be null so the caller re-asks rather than commit a wrong number.
  test('"33.5 점 칠" → null (non-integer whole)', () => {
    expect(parseKoreanNumber('33.5 점 칠')).toBeNull();
  });
  // Sanity: a clean arabic INTEGER whole with a spoken fraction still combines.
  test('"33 점 칠" → "33.7" (integer whole + spoken fraction)', () => {
    expect(parseKoreanNumber('33 점 칠')).toBe('33.7');
  });
});

test.describe('parseKoreanNumber — T-1 silent wrong-value commit (digit-bearing discarded token)', () => {
  // Reported bug: STT returned "105시 5.5" (conf 0.96). The per-token last-wins
  // heuristic dropped the unclean leading token "105시" (a digit-bearing token
  // that parses as NEITHER clean arabic NOR spoken-Korean) and silently
  // committed the trailing "5.5" — a wrong measurement with no detection signal.
  // It must now return null so the caller (useVoiceSession handleFinal) logs
  // stt_parse_failed and re-asks.
  test('"105시 5.5" → null (was silently 5.5)', () => {
    expect(parseKoreanNumber('105시 5.5')).toBeNull();
  });
  // No-space sibling: same garbage, no whitespace. The per-token loop is skipped
  // (single token) but the arabicMatches fallback used to do the same last-wins.
  test('"105시5.5" → null (no-space sibling)', () => {
    expect(parseKoreanNumber('105시5.5')).toBeNull();
  });
  // Leading digit-garbage token before a clean spoken value.
  test('"5시 5.5" → null (digit-bearing discarded token + clean tail)', () => {
    expect(parseKoreanNumber('5시 5.5')).toBeNull();
  });
  // Regression: a NON-digit garbage token (no digits) before a clean value must
  // still commit — this is the "당도 점수 8" class and must NOT become null.
  test('"당도 8" → "8" (non-digit garbage token still commits)', () => {
    expect(parseKoreanNumber('당도 8')).toBe('8');
  });
});

test.describe('v0.5.0 W4 (STT-A) — multiple valid numeric tokens must not silently commit', () => {
  // Field log 2026-06-10 (STT-A): "수정 266.7" was recognized as "수정이 166.7";
  // extractModifyValue handed the parser "이 166.7" — two independently-valid numeric
  // tokens — and last-wins silently committed 166.7 (wrong value, no signal).
  // Now ambiguous → null → re-ask, tagged multi_numeric.
  test('"이 166.7" → null (two valid numeric tokens, was silently 166.7)', () => {
    expect(parseKoreanNumber('이 166.7')).toBeNull();
    expect(getLastParseFailReason()).toBe('multi_numeric');
  });
  test('"오 25.5" → null (sino syllable + arabic decimal)', () => {
    expect(parseKoreanNumber('오 25.5')).toBeNull();
    expect(getLastParseFailReason()).toBe('multi_numeric');
  });
  // Boundary doc: pure-arabic utterances with spaces are joined by the TOP fast path
  // (tryArabic strips [,\s] — thousand-separator tolerance, pre-existing since v0.1).
  // They never reach the per-token loop, so W4 does not change this behavior.
  test('"3 5" → "35" (pre-existing arabic fast path, untouched by W4)', () => {
    expect(parseKoreanNumber('3 5')).toBe('35');
  });
  // Legitimate multi-token numerals are consumed by the whole-spoken / decimal recombination
  // paths BEFORE the per-token loop — they must keep parsing.
  test('회귀: "백 이십삼" → "123" (whole-spoken path, not multi_numeric)', () => {
    expect(parseKoreanNumber('백 이십삼')).toBe('123');
  });
  test('회귀: "칠십사 점 칠" → "74.7"', () => {
    expect(parseKoreanNumber('칠십사 점 칠')).toBe('74.7');
  });
  test('회귀: "백이십삼" → "123"', () => {
    expect(parseKoreanNumber('백이십삼')).toBe('123');
  });
  test('회귀: "이십 점 오" → "20.5"', () => {
    expect(parseKoreanNumber('이십 점 오')).toBe('20.5');
  });
  // Single numeric token + non-numeric garbage still commits (the "당도 8" class).
  test('회귀: "당도 8" → "8" (one valid numeric token only)', () => {
    expect(parseKoreanNumber('당도 8')).toBe('8');
  });
});

test.describe('v0.5.0 W5 (STT-B) — "점" 뒤 소수부 유실 시 재질문', () => {
  // 소수 의도("점")인데 소수부가 유실/오전사된 경우, 값을 추측하지 않고 재질문한다. last-wins로
  // 정수부만 침묵 커밋하면(111 점 에 → 111) 측정값이 조용히 틀린다. v0.10.0 A1부터는 정수부를
  // getLastParseFailWhole()로 노출해, 호출자(useVoiceSession)가 "소수점 아래만" 타깃 재질문한다.
  test('"33 점" → null (trailing 점, fraction never spoken)', () => {
    expect(parseKoreanNumber('33 점')).toBeNull();
  });
  // The literal-word "점" classes must keep falling through (HIGH-1 보존).
  test('폴스루 유지: "점수 8" → "8" (head가 정수가 아님)', () => {
    expect(parseKoreanNumber('점수 8')).toBe('8');
  });
  test('폴스루 유지: "당도 점수 8" → "8"', () => {
    expect(parseKoreanNumber('당도 점수 8')).toBe('8');
  });
  // Genuine decimals through the same branch keep combining.
  test('회귀: "111 점 5" → "111.5"', () => {
    expect(parseKoreanNumber('111 점 5')).toBe('111.5');
  });
  test('회귀: "33 점 칠" → "33.7"', () => {
    expect(parseKoreanNumber('33 점 칠')).toBe('33.7');
  });
});

test.describe('v0.10.0 A1 — iOS STT 소수부 오전사: "이"=2 복구 / "에"는 타깃 재질문(추측 금지)', () => {
  // Field log 2026-06-16 실기기: 사용자가 "111.1"을 말하면 iOS STT가 소수부를 종결조사로 오전사
  // → "111 점 에" / "211 점에" / "일 점 에" / "22점이" / "200 점이". 두 갈래로 갈린다:
  //  (a) "이" — SINO에 2로 매핑된 정상 음절. parseFractionDigits("이")="2" → 기존 경로가 결정적
  //      으로 복구(추측 아님). 코드 변경 없이 통과해야 하는 회귀 가드.
  //  (b) "에" — 숫자 매핑이 없는 종결조사. "에→1" 같은 값 추측은 하지 않는다 — 같은 "111 점 에"가
  //      111.1(06-16)·111.5(06-10) 양쪽에서 나와 추측은 조용한 오커밋이 된다(민구 결정). 대신
  //      decimal_fraction_lost + 정수부 노출 → 호출자가 "소수점 아래만" 타깃 재질문.

  // (a) "이"=2 — 결정적 Sino 경로로 복구(추측 아님).
  test('"22점이" → "22.2" (이=2, 기존 Sino 소수 경로)', () => {
    expect(parseKoreanNumber('22점이')).toBe('22.2');
  });
  test('"200 점이" → "200.2" (이=2, 공백 분리)', () => {
    expect(parseKoreanNumber('200 점이')).toBe('200.2');
  });
  test('"211 점이" → "211.2" (이=2)', () => {
    expect(parseKoreanNumber('211 점이')).toBe('211.2');
  });

  // (b) "에" — 추측 금지. null + decimal_fraction_lost + 정수부 노출(타깃 재질문용).
  test('"111 점 에" → null + whole="111" (추측 금지, 타깃 재질문)', () => {
    expect(parseKoreanNumber('111 점 에')).toBeNull();
    expect(getLastParseFailReason()).toBe('decimal_fraction_lost');
    expect(getLastParseFailWhole()).toBe('111');
  });
  test('"211 점에" → null + whole="211" (붙여쓰기)', () => {
    expect(parseKoreanNumber('211 점에')).toBeNull();
    expect(getLastParseFailReason()).toBe('decimal_fraction_lost');
    expect(getLastParseFailWhole()).toBe('211');
  });
  test('"일 점 에" → null + whole="1" (한글 정수 head)', () => {
    expect(parseKoreanNumber('일 점 에')).toBeNull();
    expect(getLastParseFailReason()).toBe('decimal_fraction_lost');
    expect(getLastParseFailWhole()).toBe('1');
  });

  // ── 과교정 금지: "에"는 어디서도 숫자값을 갖지 않는다(전역 매핑 누수 검출).
  test('과교정 금지: "에" → null (홑 "에"는 숫자 아님)', () => {
    expect(parseKoreanNumber('에')).toBeNull();
  });
  test('과교정 금지: "점 에" → null (정수 head 없음 — stray fraction)', () => {
    expect(parseKoreanNumber('점 에')).toBeNull();
  });
  test('과교정 금지: "세대 점 에" → null (head가 정수가 아님 → 폴스루)', () => {
    expect(parseKoreanNumber('세대 점 에')).toBeNull();
  });
  // "에"가 head를 미스히어한 형태(소수점 없음)는 STT-C(extraneous_token) 정책 유지.
  test('과교정 금지: "에봇 15.5" → null ([STT-6] 백→에봇, STT-C 유지)', () => {
    expect(parseKoreanNumber('에봇 15.5')).toBeNull();
  });
  // "33 점"(소수 의도 + 소수부 없음)도 decimal_fraction_lost + whole="33" → 타깃 재질문 대상.
  test('"33 점" → null + whole="33" (소수부 미발화도 타깃 재질문)', () => {
    expect(parseKoreanNumber('33 점')).toBeNull();
    expect(getLastParseFailReason()).toBe('decimal_fraction_lost');
    expect(getLastParseFailWhole()).toBe('33');
  });
  // whole 노출은 decimal_fraction_lost에 한정 — 다른 실패 사유엔 null이어야(오용 방지).
  test('whole 격리: "제17.7" → null + extraneous_token, whole=null', () => {
    expect(parseKoreanNumber('제17.7')).toBeNull();
    expect(getLastParseFailReason()).toBe('extraneous_token');
    expect(getLastParseFailWhole()).toBeNull();
  });
  test('whole 격리: 정상 파싱 후 whole=null ("33.7")', () => {
    expect(parseKoreanNumber('33 점 칠')).toBe('33.7');
    expect(getLastParseFailWhole()).toBeNull();
  });
});

test.describe('v0.7.0 STT-C — 단일 숫자 + 무관 비숫자 토큰은 침묵 커밋하지 않는다 (extraneous_token)', () => {
  // Field log 2026-06-11 v0.6.0 (evt 108): "백칠십칠 점 칠"(177.7 의도)이 "제17.7"로 인식돼
  // 17.7이 침묵 커밋됨(선행 음절 유실). 같은 세션 evt 493: "삼백삼십삼 점 삼"(333.3 의도)이
  // "현백 33.3"으로 인식돼 33.3 침묵 커밋. 누적 4건(06-10×1, 06-11×1, 06-12 분석분×2).
  test('"제17.7" → null (was silently 17.7; no-space sibling)', () => {
    expect(parseKoreanNumber('제17.7')).toBeNull();
    expect(getLastParseFailReason()).toBe('extraneous_token');
  });
  test('"현백 33.3" → null (was silently 33.3; spaced sibling)', () => {
    expect(parseKoreanNumber('현백 33.3')).toBeNull();
    expect(getLastParseFailReason()).toBe('extraneous_token');
  });
  // [STT-6] documented 백-mishear family — same shape, must also re-ask now.
  test('"액 77.7" → null ([STT-6] 백→액 mishear)', () => {
    expect(parseKoreanNumber('액 77.7')).toBeNull();
    expect(getLastParseFailReason()).toBe('extraneous_token');
  });
  test('"에봇 15.5" → null ([STT-6] 백→에봇 mishear)', () => {
    expect(parseKoreanNumber('에봇 15.5')).toBeNull();
  });
  test('"개 95.5" → null ([STT-6] 백→개 mishear — 개는 화이트리스트에 없다)', () => {
    expect(parseKoreanNumber('개 95.5')).toBeNull();
  });

  // ── 🔴 v0.49 r2 W4 — 섀도 계측(민구 재결정 2026-08-13) ────────────────────────────────
  // 브리핑 원안은 「유효 숫자 1개면 자동 채택」이었다. 08-13 로그를 실측해 반증했다: 재질문
  // 직후 사용자가 다시 말해 커밋된 값(=정답)과 대조하면 **동일 셀에서 정답이 확정되는 4건
  // 전부 채택값이 틀렸다**(299→299.9 · 300→311.1 · 3.3→33.3 · 133.3→333.3). 결정적인 건 개수가
  // 아니라 방향이다 — 잡토큰이 곧 유실된 앞자리의 오인식이라(`상식`←삼십, `단`←삼백), 자동
  // 채택은 위 STT-C 원사례(`현백 33.3`)를 그대로 재생산한다.
  // → **거절·재질문은 현행 그대로**, 「채택했더라면」의 값만 관측한다.
  //   집계 명령(다음 회차용): `type='stt'` & `extra^='would_salvage:'` 를 재발화 커밋값과 대조.
  test.describe('W4 섀도 계측 — 거절은 그대로, 구제 후보만 관측한다', () => {
    // 08-13 실측 extraneous_token **6건 전량**(브리핑 목록엔 `300 기를 떠네`가 빠져 있었다).
    const salvageObserved: Array<[string, string]> = [
      ['그냥 351.5', '351.5'],
      ['단 133.3', '133.3'],
      ['299 정도', '299'],
      ['상식 3.3', '3.3'],
      ['희정 355 제곱', '355'],
      ['300 기를 떠네', '300'],
    ];
    for (const [utterance, candidate] of salvageObserved) {
      test(`"${utterance}" → 여전히 null(재질문 유지) + would_salvage=${candidate}`, () => {
        expect(parseKoreanNumber(utterance, 1), '🔴 구제값이 커밋 경로로 새면 안 된다').toBeNull();
        expect(getLastParseFailReason()).toBe('extraneous_token');
        expect(getLastSalvageCandidate()).toBe(candidate);
      });
    }

    // 🔴 불변 유지 — 다른 사유는 구제 후보 자체가 없다(계측이 사유 경계를 넘지 않는다).
    const noCandidate: Array<[string, string]> = [
      ['100 122.2', 'multi_numeric'],
      ['삼배', 'no_number'],
      ['음식점', 'decimal_whole_invalid'],
      ['300일 전 일', 'digit_token_unparsed'],
      ['33 점 선', 'decimal_fraction_lost'],
    ];
    for (const [utterance, reason] of noCandidate) {
      test(`"${utterance}" → ${reason}, 구제 후보 없음`, () => {
        expect(parseKoreanNumber(utterance, 1)).toBeNull();
        expect(getLastParseFailReason()).toBe(reason);
        expect(getLastSalvageCandidate(), '거절 사유가 다르면 후보를 만들지 않는다').toBeNull();
      });
    }

    test('성공 파싱은 직전 발화의 구제 후보를 물려받지 않는다 (잔류 창 금지)', () => {
      expect(parseKoreanNumber('상식 3.3', 1)).toBeNull();
      expect(getLastSalvageCandidate()).toBe('3.3');
      expect(parseKoreanNumber('44.4', 1)).toBe('44.4');
      expect(getLastSalvageCandidate(), '성공 발화가 앞 발화의 후보를 끌고 오면 안 된다').toBeNull();
    });
  });

  // Whitelisted units / particles still commit (no false-positive re-asks).
  const stillCommit: Array<[string, string]> = [
    ['33.3 밀리', '33.3'],
    ['155.5 센치', '155.5'],
    ['177.7 그램', '177.7'],
    ['20.5 mm', '20.5'],
    ['35 입니다', '35'],
    ['33.3이요', '33.3'], // no-space particle suffix
    ['12.5밀리', '12.5'], // no-space unit suffix
  ];
  for (const [input, expected] of stillCommit) {
    test(`화이트리스트 유지: "${input}" → ${expected}`, () => {
      expect(parseKoreanNumber(input)).toBe(expected);
    });
  }

  // Pre-existing commit contracts (HIGH-1 / T-1 suites) — must stay green.
  test('회귀: "당도 8" → "8" (기존 커밋 계약 유지)', () => {
    expect(parseKoreanNumber('당도 8')).toBe('8');
  });
  test('회귀: "당도 점수 8" → "8"', () => {
    expect(parseKoreanNumber('당도 점수 8')).toBe('8');
  });
  test('회귀: "다시 점수 8" → "8"', () => {
    expect(parseKoreanNumber('다시 점수 8')).toBe('8');
  });

  // The healthy re-question guards observed working in the same field log stay intact.
  // (v0.10.0 A1: "111 점 에" itself now RECOVERS to 111.1 — covered in the W5/A1 suite above.)
  test('회귀: "이 166.7" → null + multi_numeric (W4 유지)', () => {
    expect(parseKoreanNumber('이 166.7')).toBeNull();
    expect(getLastParseFailReason()).toBe('multi_numeric');
  });
  // The alt-transcript rescue shape (06-11 evt 170: primary "111 점 에" → alt "111 .1" committed
  // 111.1) rides the top arabic fast path — untouched by STT-C.
  test('회귀: "111 .1" → "111.1" (alt-transcript rescue shape, arabic fast path)', () => {
    expect(parseKoreanNumber('111 .1')).toBe('111.1');
  });
});

test.describe('parseKoreanNumber — integer regression guards', () => {
  const cases: Array<[string, string]> = [
    ['칠십사', '74'],
    ['이십', '20'],
    ['삼십오', '35'],
    ['열다섯', '15'],
    ['세', '3'],
    ['33.5', '33.5'],
    ['35.1', '35.1'],
    ['1.5', '1.5'],
  ];
  for (const [input, expected] of cases) {
    test(`"${input}" → ${expected}`, () => {
      expect(parseKoreanNumber(input)).toBe(expected);
    });
  }
});

test.describe('parseKoreanNumber — maxDecimals rounding', () => {
  test('"칠십사 점 칠칠" rounds to 1 decimal', () => {
    expect(parseKoreanNumber('칠십사 점 칠칠', 1)).toBe('74.8');
  });
});

/**
 * v0.51.1 R2 (2026-09-02 실기기 · STT 레인 §5 A1) — whole-spoken 정규식 문자 집합의 「나」 누락.
 *
 * 09-02 정식 4세션에서 STT가 「삼점삼일」을 「3.3 하나」로 낸 시도가 8건(6셀 · 4명 전원)인데 전부
 * `multi_numeric` 재질문이었다. 같은 꼴 「3.2 둘」은 3.22로 커밋됐다 — `하`·`한`은 집합에 있고 `나`만
 * 없어서 「하나」 하나만 whole-spoken 경로를 못 탔다. 아래 세 형상은 그 로그의 원문이다.
 *
 * 🔴 반증(2026-09-02 실측): `koreanNum.ts`의 문자 집합에서 `나`를 도로 빼면 ①②③이 red(multi_numeric),
 *    ④는 그대로 green(변환과 무관한 불변 — 「점」 소실은 살리지 않는다).
 */
test.describe('v0.51.1 R2 — 「X.Y 하나」는 「X.Y 둘」과 같은 계약으로 X.Y1', () => {
  test('① "3.3 하나" → 3.31 (적정 컬럼 · decimals 2)', () => {
    expect(parseKoreanNumber('3.3 하나', 2)).toBe('3.31');
    expect(getLastParseFailReason()).toBeNull();
  });
  test('② "50. 하나" → 50.1', () => {
    expect(parseKoreanNumber('50. 하나', 2)).toBe('50.1');
  });
  test('③ "4.5 하나" → 4.51', () => {
    expect(parseKoreanNumber('4.5 하나', 2)).toBe('4.51');
  });
  test('④ 회귀 — "333 하나" → null + multi_numeric (「점」 소실은 살리지 않는다)', () => {
    expect(parseKoreanNumber('333 하나', 2)).toBeNull();
    expect(getLastParseFailReason()).toBe('multi_numeric');
  });
  test('기존 계약 대조 — "3.2 둘" → 3.22 (「하나」와 같은 경로)', () => {
    expect(parseKoreanNumber('3.2 둘', 2)).toBe('3.22');
  });
  // 🔴 구제 범위는 정확히 「하나」다. 문자 집합에 bare `나`를 넣으면 아래가 4.11로 조용히 통과한다
  //   (09-02 alt 실측 「4.11 나」) — 잡토큰 재질문 원칙(STT-C)을 지킨다.
  test('⑤ 가드 — bare "나"는 여전히 잡토큰: "4.11 나" → null + extraneous_token', () => {
    expect(parseKoreanNumber('4.11 나', 2)).toBeNull();
    expect(getLastParseFailReason()).toBe('extraneous_token');
  });
});

test.describe('extractModifyValue — 단일 단어 "수정"만 인식', () => {
  test('"수정 178.1" → "178.1"', () => {
    expect(extractModifyValue('수정 178.1')).toBe('178.1');
  });
  // I-1 단일화: 후치 정정도 '수정'으로. 별칭 '정정'은 제거.
  test('"178.1 수정" → "178.1"', () => {
    expect(extractModifyValue('178.1 수정')).toBe('178.1');
  });
  test('"178.1 정정" → null (별칭 제거됨)', () => {
    expect(extractModifyValue('178.1 정정')).toBeNull();
  });
});

test.describe('T-2 — command confidence gate (detection contract the gate relies on)', () => {
  // The gate in useVoiceSession.handleFinal rejects a detected command when
  // `confidence > 0 && confidence < 0.7` (COMMAND_MIN_CONFIDENCE). It only fires
  // when detectCommand() actually returns a command, so the gate's correctness
  // depends on detectCommand recognizing the reported misfires ("수정"/"정정").
  // These assert that contract; the threshold itself is exercised in the hook.
  test('"수정" → modify (the low-conf 0.16 misfire from row 14)', () => {
    expect(detectCommand('수정')).toBe('modify');
  });
  test('"수정해줘" → modify (활용형 꼬리 허용 — startsWith)', () => {
    expect(detectCommand('수정해줘')).toBe('modify');
  });
  // I-1 단일화: 별칭 '정정' 제거 → 더 이상 명령으로 인식되지 않는다.
  test('"정정" → null (별칭 제거됨)', () => {
    expect(detectCommand('정정')).toBeNull();
  });
  // A plain measurement value is NOT a command → the command gate never applies to it,
  // so legitimate low-confidence VALUES still go through the (separate) value gate.
  test('"33.3" → null (not a command, untouched by the command gate)', () => {
    expect(detectCommand('33.3')).toBeNull();
  });
  test('"이백삼십삼" → null (spoken numeral is not a command)', () => {
    expect(detectCommand('이백삼십삼')).toBeNull();
  });
});

test.describe('v0.4.4 — 명령어 통합·리네임 (이전/다음, 스킵·다시 제거)', () => {
  // 🔴 v0.49 F-1(민구 결정 2026-08-12) — **의미가 재배정됐다.** 이 describe의 원 기대값
  //   ('이전'→prevRow · '다음'→nextRow)은 v0.4.4가 '이전행/다음행'을 '이전/다음'으로 리네임한
  //   결과였고, 08-12 결정이 그것을 되돌리며 **짧은 두 단어를 항목 이동에 재배정**했다.
  //   여기 4개 단언은 **정당 파손**이다 — 아래가 새 계약이다.
  //   전체 항목/행 이동 동작 오라클은 tests/v049-f1-field-nav.spec.ts.
  test('"이전" → prevField (v0.49 F-1: 항목 이동으로 재배정)', () => {
    expect(detectCommand('이전')).toBe('prevField');
  });
  test('"다음" → nextField (v0.49 F-1: 항목 이동으로 재배정)', () => {
    expect(detectCommand('다음')).toBe('nextField');
  });
  // 🔴 **최장 일치 우선**의 핵심 단언. '이전'⊂'이전행'이므로 선언 순서대로 순회하면 짧은 쪽
  //   (prevField)이 먼저 걸려 **행 이동이 영영 불가능해진다.** 이 2건이 그 회귀를 잡는다.
  test('"다음행" → nextRow (최장 일치 — 짧은 nextField에 가로채이지 않는다)', () => {
    expect(detectCommand('다음행')).toBe('nextRow');
  });
  test('"이전행" → prevRow (최장 일치 — 짧은 prevField에 가로채이지 않는다)', () => {
    expect(detectCommand('이전행')).toBe('prevRow');
  });
  // STT가 「다음 행」처럼 띄어 내놓는 변형 — detectCommand가 공백을 먼저 지우므로 동일하게 잡힌다.
  test('"다음 행"(띄어쓰기 STT 변형) → nextRow', () => {
    expect(detectCommand('다음 행')).toBe('nextRow');
  });
  test('"이전 행"(띄어쓰기 STT 변형) → prevRow', () => {
    expect(detectCommand('이전 행')).toBe('prevRow');
  });
  // 🔴 최장 일치로 바꾸면서 **죽이면 안 되는** 두 기존 계약(정확 일치를 못 쓰는 이유):
  //   ① screenOff의 word는 일부러 짧은 '화면'이라 "화면 꺼"가 잡혀야 한다(voiceCommands:117-120).
  //   ② 활용형 꼬리 허용("수정해줘").
  test('"화면 꺼" → screenOff (짧은 word의 startsWith 계약 보존)', () => {
    expect(detectCommand('화면 꺼')).toBe('screenOff');
  });
  test('"수정해줘" → modify (활용형 꼬리 허용 보존)', () => {
    expect(detectCommand('수정해줘')).toBe('modify');
  });
  // 스킵: '다음'으로 통합되어 제거됨 → 더 이상 명령으로 인식되지 않는다.
  test('"스킵" → null (다음으로 통합·제거됨)', () => {
    expect(detectCommand('스킵')).toBeNull();
  });
  // 다시(redo): '수정'으로 통합되어 제거됨.
  test('"다시" → null (수정으로 통합·제거됨)', () => {
    expect(detectCommand('다시')).toBeNull();
  });
  // v0.4.5: "유지"(keep) 신규 — "이전" 재입력 중 현재 값 유지하고 다음 필드로.
  test('"유지" → keep', () => {
    expect(detectCommand('유지')).toBe('keep');
  });
  // 나머지 표준 단어 유지 스팟 체크
  test('표준 단어 유지: 수정/취소/일시정지/재시작/종료', () => {
    expect(detectCommand('수정')).toBe('modify');
    expect(detectCommand('취소')).toBe('cancel');
    expect(detectCommand('일시정지')).toBe('pause');
    expect(detectCommand('재시작')).toBe('resume');
    expect(detectCommand('종료')).toBe('end');
  });
  test('별칭/제거 확인: 지우기/멈춤/계속/마침/스톱/건너 → null', () => {
    expect(detectCommand('지우기')).toBeNull();
    expect(detectCommand('멈춤')).toBeNull();
    expect(detectCommand('계속')).toBeNull();
    expect(detectCommand('마침')).toBeNull();
    expect(detectCommand('스톱')).toBeNull();
    expect(detectCommand('건너')).toBeNull();
  });
});

test.describe('T-3 — ambiguous single-syllable homophone re-confirm', () => {
  // On a measurement column, a lone Sino-Korean syllable that doubles as a common
  // non-number word ("이"=2/조사, "사"=4/死, "오"=5/감탄사, "일"=1) must be re-confirmed
  // regardless of noisyMode (handleFinal gates on isAmbiguousSingleSyllable + single alt).
  const ambiguous = ['이', '일', '사', '오', '구', '영', '공', '삼', '육', '칠', '팔'];
  for (const s of ambiguous) {
    test(`"${s}" → flagged ambiguous`, () => {
      expect(isAmbiguousSingleSyllable(s)).toBe(true);
    });
  }
  // Whitespace/punctuation noise around a lone syllable still flags.
  test('" 이 ." → flagged (noise-stripped single syllable)', () => {
    expect(isAmbiguousSingleSyllable(' 이 .')).toBe(true);
  });
  // MUST NOT flag genuine numerals / non-SINO single tokens — these still commit.
  const safe: Array<[string, string]> = [
    ['이백삼십삼', 'multi-syllable numeral'],
    ['233', 'arabic'],
    ['2', 'arabic single digit'],
    ['세', 'native single digit (not SINO)'],
    ['두', 'native single digit (not SINO)'],
    ['열', 'native ten (not in SINO map)'],
    ['이십', 'two-syllable sino numeral'],
  ];
  for (const [input, why] of safe) {
    test(`"${input}" → NOT flagged (${why})`, () => {
      expect(isAmbiguousSingleSyllable(input)).toBe(false);
    });
  }
  // Regression: the genuine numeral the report warns against breaking must still PARSE.
  test('"이백삼십삼" → "233" (real numeral still parses, not collapsed)', () => {
    expect(parseKoreanNumber('이백삼십삼')).toBe('233');
  });
  // And a lone "이" still PARSES to 2 at the parser level — the re-confirm is a
  // CALLER-side (handleFinal) decision, the parser stays pure/unchanged.
  test('"이" → "2" (parser unchanged; re-confirm is caller-side)', () => {
    expect(parseKoreanNumber('이')).toBe('2');
  });
});

// ─── v0.34.0 O2 [STT-17] — 단독 응답어 판별(값 오커밋 금지의 판별 유닛) ──────────
test.describe('isBareResponseWord (v0.34.0 O2 [STT-17])', () => {
  const yes = ['예', '네', '응', '어', '넵', '네네', '예예', ' 네 ', '네.'];
  for (const input of yes) {
    test(`"${input}" → 응답어(true)`, () => {
      expect(isBareResponseWord(input)).toBe(true);
    });
  }
  // 유효 수사·유사 발화는 응답어가 아니다 — 파서 전역 차단 금지 계약("사"/"넷"은 커밋 유지).
  const no = ['사', '넷', '네시', '35.1', '네 점 오', '어제', ''];
  for (const input of no) {
    test(`"${input}" → 응답어 아님(false)`, () => {
      expect(isBareResponseWord(input)).toBe(false);
    });
  }
  // 파서 자체는 불변 — "네"는 여전히 native 4로 파싱된다(차단은 handleFinal 문맥 판단).
  test('"네" → "4" (parser unchanged; 값-대기 차단은 caller-side)', () => {
    expect(parseKoreanNumber('네')).toBe('4');
  });
});

// ─── v0.34.0 O3 — "점요/점 요" 소수 의도 변형: 침묵 커밋 금지(재질문) 사전 회귀 고정 ──────
// (07-14 실사례 "266 점요"→266 침묵 커밋의 실제 누출로는 alts 폴백 — e2e는
//  decimal-targeted-reask.spec.ts. 여기는 primary 파서가 전 변형에서 재질문함을 고정한다.)
test.describe('decimal_fraction_lost — 점요 변형 (v0.34.0 O3)', () => {
  const reask = ['266 점요', '266점요', '266 점 요', '266점 요', '266 쩜요', '이백육십육 점요'];
  for (const input of reask) {
    test(`"${input}" → null + decimal_fraction_lost(whole=266)`, () => {
      expect(parseKoreanNumber(input, 1)).toBeNull();
      expect(getLastParseFailReason()).toBe('decimal_fraction_lost');
      expect(getLastParseFailWhole()).toBe('266');
    });
  }
  // 소수부가 실제로 들린 경우는 종전대로 합성 커밋(재질문 아님).
  test('"266 점 오" → "266.5" (정상 합성 무회귀)', () => {
    expect(parseKoreanNumber('266 점 오', 1)).toBe('266.5');
  });
});

// ─── v0.43.0 #3-2 — 모든 실패 경로가 기계 판독 사유를 남긴다 (plan §2-6) ──────────────
// 07-30 실기기 로그에서 `stt_parse_failed` 22건 중 **14건이 사유 공백**이었다. `담배`(숫자가
// 아예 없음)와 `Siri 점에`(숫자 오인식)는 대책이 다른데 같은 줄로 보였고, 값 입력 실패율
// 32.6%의 출처를 가를 수 없었다. 사유 부착은 **다음 회차의 판정력 그 자체**라 회귀로 고정한다.
test.describe('#3-2 — 파싱 실패 사유 전 경로 부착', () => {
  const CASES: Array<[string, string]> = [
    ['', 'empty'],
    ['   ', 'empty'],
    // 🔑 공백 14건의 주범 — 숫자로 읽히는 토큰이 하나도 없다.
    ['담백', 'no_number'],
    ['담배', 'no_number'],
    ['상대', 'no_number'],
    ['하악', 'no_number'],
    // 소수 구조인데 정수부가 정수로 안 읽힌다. `Siri 점에`가 `담배`와 갈리는 축이다.
    ['세대 점 칠', 'decimal_whole_invalid'],
    ['33.5 점 칠', 'decimal_whole_invalid'],
    ['Siri 점에', 'decimal_whole_invalid'],
    ['칠십사 점 칠 점 팔', 'multi_decimal'],
    ['105시 5.5', 'digit_token_unparsed'],
    ['105시5.5', 'multi_arabic_chunk'],
    ['구천구백구십구 점 구', 'overflow'],
    ['가나 점 다라 점 마바', 'unparsed'],
    // 기존 3종은 의미가 바뀌지 않았다(A층은 동작 불변 — 사유 이름 재배치 금지).
    ['이 166.7', 'multi_numeric'],
    ['266 점요', 'decimal_fraction_lost'],
    ['현백 33.3', 'extraneous_token'],
  ];
  for (const [input, reason] of CASES) {
    test(`"${input}" → null + ${reason}`, () => {
      expect(parseKoreanNumber(input, 1)).toBeNull();
      expect(getLastParseFailReason()).toBe(reason);
    });
  }

  // 🔴 이게 진짜 회귀 가드다 — 개별 이름보다 **"사유 없는 실패가 하나도 없다"** 는 불변식이
  //   #3-2의 계약이다. 새 실패 경로를 `return null`로 추가하면 여기서 잡힌다.
  test('불변식: 파싱에 실패한 모든 입력은 사유를 남긴다(사유 null 금지)', () => {
    const blind: string[] = [];
    for (const [input] of CASES) {
      if (parseKoreanNumber(input, 1) === null && getLastParseFailReason() === null) blind.push(input);
    }
    expect(blind, `사유 없이 실패한 입력: ${JSON.stringify(blind)}`).toEqual([]);
  });

  // 성공 경로는 사유를 남기지 않는다(직전 실패의 잔류가 성공 로그를 오염시키지 않는다).
  test('성공하면 사유는 비워진다 — 직전 실패의 잔류 금지', () => {
    expect(parseKoreanNumber('담백', 1)).toBeNull();
    expect(getLastParseFailReason()).toBe('no_number');
    expect(parseKoreanNumber('33.3', 1)).toBe('33.3');
    expect(getLastParseFailReason()).toBeNull();
    expect(getLastParseFailWhole()).toBeNull();
  });
});
