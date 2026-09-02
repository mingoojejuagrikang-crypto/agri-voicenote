/**
 * Korean spoken number parser.
 *
 * Supports:
 *  - Sino-Korean: 일~구, 십/백/천/만/억
 *  - Native Korean: 하나/한, 둘/두, 셋/세 … 열
 *  - Decimal separator: 점/쩜
 *  - Mixed STT outputs ("일점오", "1 점 5", "1.5", "35.1")
 *  - Comma noise / leading garbage stripped via shortest-clean-number heuristic
 *
 * Returns numeric string or null.
 *
 * [ENV-12 · r2-nearcap] 수사 표와 정수/소수부 원시 파싱은 `koreanNumTokens.ts`가 소유한다.
 * 이 파일에 남은 것은 **정책**이다 — 모호성 판정(잡토큰·다중 숫자·소수부 유실)과 실패 사유
 * 계측(`fail`), 그리고 그 위에 얹힌 음성 명령 판별. 경계는 「왜 안 읽혔는지를 말하는가」다:
 * 토큰 계층은 null만 돌려주고, 여기서만 사유가 붙는다.
 */
import {
  OVERFLOW_THRESHOLD, SINO, parseFractionDigits, parseKoreanInt, parseKoreanSpokenAll,
  splitDecimal, tryArabic,
} from './koreanNumTokens';

/** v0.5.0 W4/W5: machine-readable reason for the most recent parseKoreanNumber() null.
 *  Set fresh on every call; read by the caller (handleFinal) to tag stt_parse_failed.
 *
 *  🔴 **v0.43.0 #3-2 — 모든 실패 경로가 사유를 남긴다**(plan §2-6). 종전에는 아래 3개만
 *  실렸고 나머지 `return null`은 사유 없이 빠져나갔다 — 07-30 실기기 `stt_parse_failed`
 *  22건 중 **14건이 사유 공백**이었고, `담배`(숫자가 아예 없음)와 `Siri 점에`(숫자 오인식)가
 *  로그에서 구별되지 않았다. **대책이 다른데 같은 줄로 보인다** → 값 입력 실패율 32.6%의
 *  출처를 못 가른다. 그래서 모든 실패는 `fail(...)`을 거친다 — 새 실패 경로를 추가할 때도
 *  `return null` 대신 `return fail('<사유>')`를 써라. 사유 없는 실패는 다시 눈이 먼다.
 *
 *  - 'multi_numeric'          — ≥2 independent valid numeric tokens ("이 166.7") → ambiguous (STT-A)
 *  - 'decimal_fraction_lost'  — "<정수> 점 <비숫자>" — decimal intent, fraction lost (STT-B)
 *  - 'extraneous_token'       — single number + unrelated non-numeric token(s) ("제17.7",
 *                               "현백 33.3") → ambiguous, re-ask (STT-C, v0.7.0)
 *  - 'no_number'              — 숫자로 읽히는 토큰이 하나도 없다 ("담백" · "담배" · "상대").
 *                               🔑 **공백 14건의 주범.** 대책은 파서가 아니라 STT 문법/재질문 문구다
 *  - 'decimal_whole_invalid'  — 소수 구조인데 정수부가 정수로 안 읽힌다 ("세대 점 칠" · "33.5 점 칠")
 *  - 'multi_decimal'          — 점/쩜이 2개 이상이고 마지막이 소수부다 ("칠십사 점 칠 점 팔")
 *  - 'digit_token_unparsed'   — 공백 분리 토큰이 숫자를 품었는데 깨끗이 안 읽힌다 ("105시 5.5", T-1)
 *  - 'multi_arabic_chunk'     — 붙어 있는 아라비아 숫자 덩어리가 2개 이상 ("105시5.5", T-1 형제)
 *  - 'overflow'               — 값이 범위를 넘거나 유한수가 아니다
 *  - 'empty'                  — 발화가 비었다
 *  - 'unparsed'               — 위 어디에도 안 걸린 잔여. 🔴 이게 로그에서 늘면 분류를 쪼갤 신호다 */
let _lastParseFailReason: string | null = null;
export function getLastParseFailReason(): string | null {
  return _lastParseFailReason;
}

/** 실패 사유를 기록하고 null을 돌려준다(#3-2). `salvage`는 W4 계측 전용(`extraneous_token`만). */
function fail(reason: string, whole?: number, salvage?: string): null {
  _lastParseFailReason = reason;
  if (whole !== undefined) _lastParseFailWhole = String(whole);
  if (salvage !== undefined) _lastSalvageCandidate = salvage;
  return null;
}

/** 🔴 v0.49 r2 W4 **섀도 계측**(민구 08-13) — 「자동 채택했더라면」의 값. 채택은 **하지 않는다**:
 *  08-13·08-12 로그에서 재발화 정답과 대조하면 6/6이 틀렸고(299 vs 299.9 · 95.5 vs 325.5 …),
 *  잡토큰이 곧 유실된 앞자리의 오인식이라(`상식`←삼십) 이 가드의 원사례를 재생산한다.
 *  🔴 커밋 경로로 새면 안 된다. 대조표 `_ASK-voice.md` · 오라클 `koreanNum.spec.ts` W4. */
let _lastSalvageCandidate: string | null = null;
export function getLastSalvageCandidate(): string | null { return _lastSalvageCandidate; }

/** v0.10.0 A1: decimal_fraction_lost일 때(소수 의도인데 소수부 유실) 파싱된 정수부 문자열.
 *  호출자가 "<정수부>점, 소수점 아래만 다시 말씀해 주세요" 타깃 재질문에 쓴다. 다른 실패 사유엔 null. */
let _lastParseFailWhole: string | null = null;
export function getLastParseFailWhole(): string | null {
  return _lastParseFailWhole;
}

/** v0.7.0 STT-C: non-numeric residual tokens that legitimately accompany a spoken measurement
 *  and must NOT make a single-number utterance ambiguous. Deliberately tight — the documented
 *  leading-syllable mishears ([STT-6] 백→액/에봇/개/엑, 06-12 제/현백) are NOT here, so those
 *  shapes re-ask instead of silently committing a value with its hundreds digit lost. */
const HARMLESS_RESIDUAL_TOKENS = new Set([
  // 단위어 — 측정 발화에 정당하게 동반 ("33.3 밀리", "20.5 mm")
  '밀리미터', '미리미터', '밀리', '미리', '밀',
  '센티미터', '센치미터', '센티', '센치', '미터',
  '그램', '그람', '킬로그램', '킬로', '키로',
  '브릭스', '퍼센트', '프로', '도',
  'mm', 'cm', 'kg', 'g',
  // 조사·어미 — 값에 붙는 종결/조사 ("33.3이요", "35 입니다")
  '은', '는', '이', '가', '요', '이요', '예요', '이에요', '에요', '입니다', '임',
  // 기존 커밋 보장 어휘(HIGH-1/T-1 회귀 계약 — "당도 8"/"점수 8"/"다시 점수 8"은 커밋 유지)
  '당도', '점수', '다시',
]);

function isHarmlessResidual(tok: string): boolean {
  const t = tok.replace(/[\s.,!?]+/g, '').toLowerCase();
  if (!t) return true;
  return HARMLESS_RESIDUAL_TOKENS.has(t);
}

/**
 * Try to parse `raw` as a Korean spoken number.
 * `maxDecimals` (optional) rounds the result.
 */
export function parseKoreanNumber(raw: string, maxDecimals?: number): string | null {
  _lastParseFailReason = null;
  _lastParseFailWhole = null;
  _lastSalvageCandidate = null; // W4 — 잔류 창 금지(사유와 같은 수명이어야 한다)
  if (!raw) return fail('empty');
  const s = raw.replace(/[, 　]/g, ' ').trim();
  if (!s) return fail('empty');

  // Fast path: pure arabic.
  const direct = tryArabic(s);
  if (direct !== null) return formatNum(direct, maxDecimals);

  // v0.5.0 W5 (STT-B): a trailing 점/쩜 ("33 점", "삼십점") means the user spoke a decimal
  // but STT dropped the fraction — the whole-spoken shortcut would silently commit the bare
  // integer. Skip it and let the decimal-discriminator branch below re-ask. A trailing "."
  // (punctuation, e.g. "33.") is NOT 점/쩜 and keeps the fast paths.
  const trailingDecimalWord = /[점쩜]$/.test(s);

  // If the whole string is a clean spoken-Korean number (incl. 점-decimal), parse it.
  // 🔴 v0.51.1 R2(2026-09-02 실기기 · STT 레인 §5 A1) — 아래 형상 검사의 문자 집합에 `하`·`한`은
  //   있는데 **`나`가 없어** 「3.3 하나」(적정 컬럼 · STT가 「삼점삼일」을 이렇게 낸다)가 이 경로에서
  //   탈락하고 per-token에서 `multi_numeric` 재질문이 됐다 — 같은 꼴 「3.2 둘」은 3.22로 커밋되는데
  //   「하나」만 안 됐다(09-02 정식 4세션 8시도/6셀 · 4명 전원).
  //   ⚠️ 집합에 bare `나`를 넣지 **않는다** — 넣으면 「4.11 나」(alt 실측)가 4.11로 조용히 통과해
  //   잡토큰 재질문(`extraneous_token`) 원칙이 깎인다. 형상 검사에서만 「하나」를 「한」으로 접어
  //   구제 범위를 정확히 「하나」로 고정한다(값 자체는 위 `parseKoreanSpokenAll`이 이미 3.31로 읽는다).
  //   대가 0: 오늘 커밋 1,113시도 전량 재실행에서 커밋값이 바뀌는 시도 0 · bare 「나」 형상 무변화
  //   (빌드 산출물 §2). 「333 하나」는 `parseKoreanSpokenAll`이 null이라 여전히 `multi_numeric`이다
  //   (「점」 소실을 살리지 않는다). 오라클: tests/koreanNum.spec.ts R2.
  const wholeSpoken = trailingDecimalWord ? null : parseKoreanSpokenAll(s.replace(/\s+/g, ''));
  if (
    wholeSpoken !== null &&
    Math.abs(wholeSpoken) <= OVERFLOW_THRESHOLD &&
    /^[\s영공일이삼사사오육륙칠팔구하한둘두셋세넷네다섯여섯일곱여덟아홉열십백천만억점쩜.\d]+$/.test(s.replace(/하나/g, '한'))
  ) {
    return formatNum(wholeSpoken, maxDecimals);
  }

  // H1: Preserve `<정수부> 점 <소수부>` structure before per-token splitting, but ONLY
  // when the utterance is genuinely a decimal. STT emits the decimal as whitespace-separated
  // tokens (e.g. "칠십사 점 칠"), and the per-token loop below would drop the "점" token and
  // keep only the last digit. Recombine into a single value when the structure is unambiguous.
  //
  // The discriminator is the FRACTION part: only treat 점/쩜 as a decimal separator when the
  // tail parses as valid fraction digits. This avoids false positives where "점" is part of an
  // ordinary word ("점수 8", "당도 점수 8") — there the tail ("수 8" / "수 8") is NOT fraction
  // digits, so we fall through to the per-token loop, which correctly commits the trailing 8.
  const decimalParts = s.split(/\s*[점쩜]\s*/);

  if (decimalParts.length === 2) {
    // Exactly one 점/쩜 — decimal candidate. The fraction part is the discriminator:
    // parseFractionDigits emits output ONLY when the tail STARTS with a fraction digit.
    const tail = decimalParts[1].trim().replace(/\s+/g, '');
    const frac = parseFractionDigits(tail);
    // Codex HIGH-1: tail does NOT start with a fraction digit (e.g. "점수 8" → tail="수 8" →
    // frac="") → "점" is a literal word, not a separator. Fall through to per-token extraction,
    // which correctly commits the trailing 8. (Unit suffixes like "칠도"→"7" still combine.)
    if (frac) {
      const head = decimalParts[0].trim().replace(/\s+/g, '');
      // Empty integer part ("점 칠") → null (stray fraction, no whole).
      // Unparseable integer part ("세대 점 칠") → null.
      const whole = head ? parseKoreanInt(head) : null;
      // Codex MEDIUM-3: reject a non-integer whole ("33.5 점 칠" → parseKoreanInt("33.5")=33.5
      // via tryArabic). Combining 33.5 + "." + 7 would silently drop the spoken fraction.
      // Only a clean integer whole may carry a spoken decimal fraction.
      if (whole === null || !Number.isInteger(whole)) return fail('decimal_whole_invalid');
      const combined = parseFloat(`${whole}.${frac}`);
      if (Number.isFinite(combined) && Math.abs(combined) <= OVERFLOW_THRESHOLD) {
        return formatNum(combined, maxDecimals);
      }
      return fail('overflow');
    }
    // v0.5.0 W5 (STT-B): decimal INTENT with a LOST fraction — "111 점 에" (STT garbled the
    // fraction syllable). Discriminators: the head parses as a clean integer AND the tail
    // carries no digit at all. Last-wins used to silently commit the bare integer (111),
    // dropping the spoken decimal — a wrong measurement with no signal. Re-ask instead.
    // "점수 8"/"당도 점수 8" stay safe: their head ("", "당도") is NOT an integer → fall through.
    // "111 점 5" never reaches here (frac non-empty → handled above).
    {
      const head = decimalParts[0].trim().replace(/\s+/g, '');
      if (head && !/\d/.test(tail)) {
        const whole = parseKoreanInt(head);
        if (whole !== null && Number.isInteger(whole)) {
          // v0.10.0 A1 (민구 결정: 타깃 재질문): "에→1" 같은 값 추측은 하지 않는다 — 같은
          // "111 점 에"가 111.1(06-16)·111.5(06-10) 양쪽에서 나와 추측은 조용한 오커밋이 된다.
          // 대신 정수부를 노출해 호출자(useVoiceSession)가 "소수점 아래만 다시"로 타깃 재질문하게 한다.
          return fail('decimal_fraction_lost', whole);
        }
      }
    }
    // frac empty + head not an integer → not a decimal → fall through (HIGH-1).
  } else if (decimalParts.length >= 3) {
    // Codex HIGH-2: multiple 점/쩜 ("칠십사 점 칠 점 팔"). If the LAST segment starts with a
    // fraction digit, committing only the trailing token would be a silent wrong commit → null
    // so the caller re-asks. Otherwise ("점" is a literal word) fall through to the per-token loop.
    const last = decimalParts[decimalParts.length - 1].trim().replace(/\s+/g, '');
    if (last && parseFractionDigits(last)) return fail('multi_decimal');
    // else fall through.
  }

  // Per-token pass: split by whitespace, prefer the LAST clean small one.
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    let lastValid: number | null = null;
    let validCount = 0;
    const residuals: string[] = [];
    for (const tok of tokens) {
      const a = tryArabic(tok);
      if (a !== null && Math.abs(a) <= OVERFLOW_THRESHOLD) {
        lastValid = a;
        validCount++;
        continue;
      }
      const k = parseKoreanSpokenAll(tok);
      if (k !== null && Math.abs(k) <= OVERFLOW_THRESHOLD) {
        lastValid = k;
        validCount++;
        continue;
      }
      // T-1 (silent wrong-value commit): this token parsed as NEITHER a clean
      // arabic value NOR a spoken-Korean number, yet it carries a digit
      // (e.g. "105시" in STT output "105시 5.5"). last-wins would silently drop
      // it and commit the trailing "5.5" — a wrong measurement with no signal.
      // Treat the whole utterance as AMBIGUOUS → return null so the caller
      // (useVoiceSession handleFinal) logs stt_parse_failed and re-asks,
      // exactly like the Codex HIGH-2 / MEDIUM-3 multi-token guards above.
      if (/\d/.test(tok)) return fail('digit_token_unparsed');
      residuals.push(tok);
    }
    // v0.5.0 W4 (STT-A): ≥2 independently-valid numeric tokens (e.g. "이 166.7" — STT split
    // "이백 66.7" misrecognition; row would silently commit the LAST one). Legitimate multi-token
    // numerals ("백 이십삼", "칠십사 점 칠") never reach this loop — the whole-spoken and decimal
    // recombination paths above consume them. Whatever survives to here with two valid numbers
    // is genuinely ambiguous → null so the caller logs stt_parse_failed:multi_numeric and re-asks.
    // No auto-correction is attempted (민구/Trace decision — observe via telemetry first).
    if (validCount >= 2) return fail('multi_numeric');
    // v0.7.0 STT-C: exactly ONE valid number accompanied by unrelated non-numeric token(s)
    // ("현백 33.3" — intended 333.3, STT mangled the leading "삼백" into a noun; cumulative ×4
    // across 3 field sessions). The dot-bearing siblings are caught by W4/W5 above, but this
    // dot-less single-number shape used to silently commit the bare number with its hundreds
    // digit lost. Unless EVERY residual token is a known-harmless unit/particle ("33.3 밀리",
    // "35 입니다" still commit), treat as ambiguous → re-ask, tagged 'extraneous_token'.
    if (lastValid !== null && residuals.length > 0 && !residuals.every(isHarmlessResidual)) {
      // W4 계측 — 여기 도달 = 유효 숫자 **정확히 1개**(≥2는 위 `multi_numeric`이 걷어냈다).
      return fail('extraneous_token', undefined, formatNum(lastValid, maxDecimals));
    }
    if (lastValid !== null) return formatNum(lastValid, maxDecimals);
  }

  // T-1 sibling (no-space single token, e.g. "105시5.5"): the per-token loop is
  // skipped (tokens.length === 1) but the arabicMatches fallback below would
  // re-run the same last-wins extraction. If a digit-bearing chunk failed to
  // parse cleanly AND there are multiple arabic chunks, that's the same silent
  // wrong commit — bail to ambiguous. We detect it by: more than one arabic
  // chunk present while the string is not itself a clean number (we already
  // know it isn't — tryArabic returned null at the top).
  const allArabicChunks = Array.from(s.matchAll(/\d+(?:\.\d+)?/g)).map((m) => m[0]);
  if (allArabicChunks.length > 1) {
    // Multiple disjoint numeric chunks in an unclean utterance → cannot reduce
    // to a single unambiguous value. Re-ask instead of last-wins. (Pure
    // decimals like "33.5" never reach here — handled by the top fast path.)
    return fail('multi_arabic_chunk');
  }

  // Look for arabic chunks inside text (e.g. STT mixed "33.3이요").
  const arabicMatches = allArabicChunks;
  if (arabicMatches.length) {
    const candidates = arabicMatches.filter((x) => {
      const intPart = x.split('.')[0];
      return intPart.length <= 4 && parseFloat(intPart) <= OVERFLOW_THRESHOLD;
    });
    if (candidates.length) {
      // v0.7.0 STT-C (no-space sibling): "제17.7" — intended 77.7, STT mangled the leading
      // "칠십" syllable into "제" (field log 06-11 evt 108) and the bare 17.7 was silently
      // committed. A single embedded number may only carry known-harmless unit/particle
      // residue ("33.3이요", "20.5mm" commit); anything else is ambiguous → re-ask.
      const chunk = candidates[candidates.length - 1];
      const idx = s.lastIndexOf(chunk);
      const pre = s.slice(0, idx);
      const post = s.slice(idx + chunk.length);
      if (!isHarmlessResidual(pre) || !isHarmlessResidual(post)) {
        // W4 계측(무공백 형제 "제17.7"). 덩어리 2개↑는 위 `multi_arabic_chunk`가 걷어냈다.
        return fail('extraneous_token', undefined, formatNum(parseFloat(chunk), maxDecimals));
      }
      const n = parseFloat(chunk);
      if (Number.isFinite(n)) return formatNum(n, maxDecimals);
    }
  }

  // Spoken Korean path
  const parts = splitDecimal(s).map((p) => p.replace(/\s+/g, ''));

  if (parts.length === 1) {
    const n = parseKoreanInt(parts[0]);
    // 🔑 #3-2: 여기가 "숫자가 아예 없는 발화"("담백"·"담배"·"상대")의 종착지다 — 07-30 사유
    //   공백 14건의 주범. 숫자 오인식(digit_token_unparsed·extraneous_token)과 대책이 다르므로
    //   반드시 갈라서 남긴다.
    if (n === null) return fail('no_number');
    return formatNum(n, maxDecimals);
  }

  if (parts.length === 2) {
    const whole = parseKoreanInt(parts[0]);
    if (whole === null) return fail('decimal_whole_invalid');
    const frac = parseFractionDigits(parts[1]);
    if (!frac) return formatNum(whole, maxDecimals);
    const combined = parseFloat(`${whole}.${frac}`);
    if (!Number.isFinite(combined)) return fail('overflow');
    return formatNum(combined, maxDecimals);
  }

  return fail('unparsed');
}

function formatNum(n: number, maxDecimals?: number): string {
  if (maxDecimals === undefined) return String(n);
  return Number(n.toFixed(maxDecimals)).toString();
}

// ─── Voice commands ────────────────────────────────────────────
// The command set + canonical words live in voiceCommands.ts (single source of truth, I-1).
import { VOICE_COMMANDS, type VoiceCommand } from './voiceCommands';
export type { VoiceCommand } from './voiceCommands';

/** 🔴 v0.49 F-1 — **최장 일치 우선**을 위한 파생 정렬 사본(word 긴 것부터).
 *
 *  ⚠️ `VOICE_COMMANDS` **자체를 재정렬하지 마라.** `CommandHelpPopup.tsx`가 그 배열을
 *  **순서대로** 렌더하므로 배열 순서 = 도움말 표시 순서다. 매칭 우선순위와 표시 순서는
 *  서로 다른 관심사이므로, 정렬은 여기(매칭 쪽)에서만 한다.
 *
 *  모듈 로드 시 1회만 정렬한다 — detectCommand는 발화마다 불린다. */
const COMMANDS_LONGEST_FIRST = [...VOICE_COMMANDS].sort((a, b) => b.word.length - a.word.length);

export function detectCommand(raw: string): VoiceCommand {
  const s = raw.replace(/[\s.,]+/g, '');
  if (!s) return null;
  // 후치 정정: "178.1 수정" → modify (값-우선 형태, 숫자 시작만). 별칭 '정정'은 단일화로 제거됨.
  if (/수정$/.test(s) && /^[0-9]/.test(s)) return 'modify';
  // 전치 매칭: 각 명령의 단일 표준 단어로 시작하면 그 명령. 활용형 꼬리("수정해줘")는 허용.
  //
  // 🔴 v0.49 F-1 — **긴 word가 이긴다.** 종전엔 "표준 단어끼리 prefix 관계가 없다"는
  //   voiceCommands.ts 불변식 덕에 순회 순서가 무관했지만, 08-12 민구 결정이 '이전'⊂'이전행'·
  //   '다음'⊂'다음행'을 의도적으로 만들었다. 선언 순서대로 돌면 「이전행」 발화가 짧은
  //   '이전'(prevField)에 먼저 걸려 **행 이동이 영영 불가능해진다** — 그래서 정렬 사본을 쓴다.
  //   공백은 위에서 이미 제거되므로 「다음 행」(띄어쓰기 STT 변형)도 '다음행'으로 잡힌다.
  for (const c of COMMANDS_LONGEST_FIRST) {
    if (s.startsWith(c.word)) return c.id;
  }
  return null;
}

/** "수정 18.4" → "18.4",  "178.1 수정" → "178.1" — 단일 단어 '수정'만 인식(별칭 '정정' 제거). */
export function extractModifyValue(raw: string): string | null {
  // 전치: "수정 178.1" → "178.1"
  const prefix = raw.match(/(?:수정)[\s,.]*(.+)/);
  if (prefix) return prefix[1].trim();
  // 후치: "178.1 수정" → "178.1"
  const suffix = raw.match(/^(.+?)[\s,.]*(?:수정)$/);
  if (suffix && /^[0-9]/.test(suffix[1].trim())) return suffix[1].trim();
  return null;
}

/**
 * T-3 (single-syllable homophone): true when `raw` is a single bare Sino-Korean
 * syllable that is also a common non-number word/particle (이=2/조사, 사=4/死,
 * 오=5/감탄사, 일=1/일감, 구=9, 영=0, 공=0 …). On a measurement column STT can
 * return one of these with HIGH confidence yet the user almost never speaks a
 * lone single digit for a mm/Brix measurement, so it must be re-confirmed rather
 * than silently committed. Multi-syllable numerals ("이백삼십삼"), arabic ("2"),
 * and native words ("세","두") are NOT flagged — only a lone SINO syllable.
 */
export function isAmbiguousSingleSyllable(raw: string): boolean {
  const s = raw.replace(/[\s.,]+/g, '');
  if (s.length !== 1) return false;
  return SINO[s] !== undefined;
}

/** v0.34.0 O2 [STT-17] — 단독 응답어("예/네/응/어/넵") 판별. 07-14 실기기: 값 대기 중 "예"
 *  (conf 0.729)가 alt "네"로 폴백돼 native 수사 4로 커밋됨(알람이 잡았지만 알람 없는 컬럼이면
 *  침묵 오염). "네"=native 4라 **파서 전역 차단은 불가**("사"/"넷"은 유효 수사) — 호출자
 *  (useVoiceSession handleFinal)가 숫자 컬럼 값-대기 문맥에서만 이 판별로 재질문한다.
 *  '확인'/'유지' 명령 경로와 무관(응답어는 어느 명령에도 매핑돼 있지 않다 — voiceCommands SSOT). */
const RESPONSE_WORDS = new Set(['예', '네', '응', '어', '넵', '넹', '예예', '네네']);
export function isBareResponseWord(raw: string): boolean {
  const s = raw.replace(/[\s.,!?]+/g, '');
  return RESPONSE_WORDS.has(s);
}
