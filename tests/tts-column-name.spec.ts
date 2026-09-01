/**
 * 항목명 TTS 괄호 제거 — `formatNameForTts` 단위 오라클 (민구 확정 2026-09-01).
 *
 * 민구 원문: *"음성입력중에 항목을 TTS 해주는데 다음 항목처럼 괄호 안의 내용은 TTS 하지 않아야해.
 * "종경(mm)" 위 상황에서 tts 되어야 하는 부분은 "종경" 만이야."*
 *
 * 왜 단위인가: 변환 자체가 순수 함수이고(브라우저 의존 없음), 콜사이트 11곳은 전부 이 함수 하나를
 * 통과한다. `announceColumns.spec.ts`·`koreanNum.spec.ts`와 같은 패턴으로 Node(Playwright 러너)에서
 * 직접 import한다.
 *
 * 🔴 **반증 절차**(회귀 테스트는 반증까지 해야 회귀 테스트다 — AGENTS.md 30초 체크):
 *   `voicePrompts.formatNameForTts`의 본문을 `return name;`으로 되돌리고 이 파일을 돌리면
 *   **18건 중 13건이 red**다. 실행 확인함(2026-09-01).
 *   남는 5건은 변환과 **무관하게** 성립해야 하는 불변이라 green이 맞다: 괄호 없는 이름 통과 ·
 *   대괄호 비대상 · 괄호 없는 이름의 프롬프트 바이트 불변 · STT 매칭 2건.
 *
 * ⚠️ 이 스펙이 **덮지 않는 것**: 화면 표면 불변(칩·표·수정 표식·`Column.name` 원본)은 DOM 계약이라
 *   여기서 못 잡는다. 근거는 산출물 보고서의 「발화 경로 전량 목록」 — 변환은 `say()`/`speak()`로
 *   나가는 문자열에만 걸었고, 화면 컴포넌트는 한 줄도 만지지 않았다(diff로 확인 가능).
 */

import { test, expect } from '@playwright/test';
import { cellWaitPrompt, formatNameForTts, relistenPrompt } from '../src/lib/voicePrompts';
import { extractModifyColumn } from '../src/lib/voiceCommands';

test.describe('formatNameForTts — 괄호와 그 안의 내용을 읽지 않는다', () => {
  // 실제 프로덕션 시트(2026-09-01 device inbox, sessions.json 7건 전수)의 컬럼명 표본.
  test('"종경(mm)" → "종경" (민구 지정 사례)', () => {
    expect(formatNameForTts('종경(mm)')).toBe('종경');
  });
  test('"횡경(mm)" → "횡경"', () => {
    expect(formatNameForTts('횡경(mm)')).toBe('횡경');
  });
  test('괄호가 없으면 그대로 — 같은 시트의 나머지 컬럼명 전부', () => {
    for (const n of ['조사나무', '조사과실', '라벨', '농가명', '기준일자', '조사일자', '처리', '비고']) {
      expect(formatNameForTts(n)).toBe(n);
    }
  });
  test('전각 괄호（）도 같은 종류로 취급한다 (IME 산물)', () => {
    expect(formatNameForTts('종경（mm）')).toBe('종경');
  });
  test('반각·전각이 섞인 짝도 닫힌 것으로 본다', () => {
    expect(formatNameForTts('종경(mm）')).toBe('종경');
    expect(formatNameForTts('종경（mm)')).toBe('종경');
  });
  test('앞뒤 공백을 턴다 — "종경 (mm)" → "종경"', () => {
    expect(formatNameForTts('종경 (mm)')).toBe('종경');
    expect(formatNameForTts('  종경(mm)  ')).toBe('종경');
  });
  test('괄호가 가운데면 남은 공백을 하나로 접는다', () => {
    expect(formatNameForTts('과실 (2번) 무게')).toBe('과실 무게');
  });
  test('중첩 괄호는 깊이로 센다 — 전부 사라진다', () => {
    expect(formatNameForTts('가(나(다))')).toBe('가');
    expect(formatNameForTts('종경(mm(측정))후')).toBe('종경후');
  });
  test('미닫힘 괄호는 그 뒤 전부를 뺀다 — 반쪽 단위는 잡음이다', () => {
    expect(formatNameForTts('종경(mm')).toBe('종경');
  });
  test('고아 닫는 괄호는 그 글자만 뺀다', () => {
    expect(formatNameForTts('종경)')).toBe('종경');
    expect(formatNameForTts('종경)mm')).toBe('종경mm');
  });

  // 🔴 폴백 — 화면을 못 보는 사용자에게 무음 안내는 「어느 칸인지 알 수 없음」이다(PRINCIPLES §2).
  test('전부 지워지면 원문으로 되돌린다 — "(mm)" → "(mm)"', () => {
    expect(formatNameForTts('(mm)')).toBe('(mm)');
    expect(formatNameForTts('（mm）')).toBe('（mm）');
    expect(formatNameForTts('  (mm)  ')).toBe('(mm)');
  });
  test('빈 이름은 빈 채로 — 폴백이 값을 지어내지 않는다', () => {
    expect(formatNameForTts('')).toBe('');
    expect(formatNameForTts('   ')).toBe('');
  });

  // 대괄호는 대상이 아니다(민구 지정이 `(`·`)`, 실 시트 표본에도 없다) — 확장 지점만 남긴다.
  test('대괄호 []는 손대지 않는다 (범위 밖 — 확장하려면 formatNameForTts 두 문자 비교에)', () => {
    expect(formatNameForTts('종경[mm]')).toBe('종경[mm]');
  });
});

test.describe('문구 합성 — 프롬프트 SSOT가 축약본을 쓴다', () => {
  test('cellWaitPrompt는 괄호를 읽지 않는다', () => {
    expect(cellWaitPrompt('종경(mm)')).toBe('종경 기록값입니다. 수정이라고 말하세요.');
  });
  test('relistenPrompt는 괄호를 읽지 않는다', () => {
    expect(relistenPrompt('횡경(mm)')).toBe('횡경 다시 말씀해 주세요.');
  });
  test('괄호 없는 이름의 바이트는 종전 그대로다 (기존 오라클 무영향)', () => {
    expect(cellWaitPrompt('횡경')).toBe('횡경 기록값입니다. 수정이라고 말하세요.');
    expect(relistenPrompt('횡경')).toBe('횡경 다시 말씀해 주세요.');
  });
});

test.describe('STT 매칭 불변 — 인식 경로는 원문 이름 위에 그대로 있다', () => {
  // 🔴 이번 변경은 **TTS 출력 경로에만** 걸었다. 아래 두 건이 그 반증이다.
  test('원문 이름 지목은 종전대로 먹힌다', () => {
    expect(extractModifyColumn('수정 종경(mm)', ['횡경(mm)', '종경(mm)'])).toBe('종경(mm)');
  });
  // ⚠️ **남긴 것(민구 보고 대상)**: 이제 앱은 "종경"이라고 읽어주는데 `extractModifyColumn`은
  //   원문("종경(mm)") 완전일치라 "수정 종경"으로는 지목되지 않는다. **이 변경이 만든 결함이
  //   아니다** — 괄호 컬럼명에서 종전부터 그랬다(축약 발화가 그 간극을 눈에 띄게 만들 뿐이다).
  //   브리프가 STT 무영향을 명시해 여기서 고치지 않는다. 이 단언은 「고쳤는지」가 아니라
  //   「이번에 건드리지 않았는지」를 잠근다 — 민구가 STT도 축약본을 받게 하기로 정하면 이 줄이
  //   가장 먼저 red가 되어야 한다.
  test('축약본 지목은 (종전과 같이) 매치되지 않는다 — 이번 변경이 STT를 건드리지 않았다는 증거', () => {
    expect(extractModifyColumn('수정 종경', ['횡경(mm)', '종경(mm)'])).toBe(null);
  });
});
