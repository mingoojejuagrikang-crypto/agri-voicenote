/**
 * v0.35.3 Stage 3-2 — handleFinal 결정표(resolveFinal) 특성화 테스트 (Node, 서버 불필요).
 *
 * 기대값은 리팩토링 이전 handleFinal 인라인 분기의 판정을 그대로 옮긴 것 — 여기를 바꾸고 싶어지면
 * 음성 코어의 명령 우선순위 계약이 바뀐 것이다(중단·보고 신호).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveFinal } from '../src/lib/voiceFinalResolver';
import { detectCommand } from '../src/lib/koreanNum';
import { VOICE_COMMANDS, VOICE_UI_COMMAND_IDS, isExactCommandUtterance } from '../src/lib/voiceCommands';

const base = { confidence: 0.95, paused: false, awaitingKind: 'value' as const };

test('paused — resume/end만 수용, 나머지(명령·값) 무시', () => {
  expect(resolveFinal({ ...base, paused: true, cmd: 'resume' })).toEqual({ act: 'pausedResume' });
  expect(resolveFinal({ ...base, paused: true, cmd: 'end' })).toEqual({ act: 'pausedEnd' });
  expect(resolveFinal({ ...base, paused: true, cmd: 'modify' })).toEqual({ act: 'pausedIgnore' });
  expect(resolveFinal({ ...base, paused: true, cmd: null })).toEqual({ act: 'pausedIgnore' });
});

test('명령 신뢰도 게이트(T-2) — 명령별 floor, 0은 미보고 센티널 통과', () => {
  // 기본 floor 0.7 (end 등)
  expect(resolveFinal({ ...base, cmd: 'end', confidence: 0.69 }))
    .toEqual({ act: 'rejectLowConfidence', minConfidence: 0.7 });
  expect(resolveFinal({ ...base, cmd: 'end', confidence: 0.7 }))
    .toEqual({ act: 'dispatch', cmd: 'end', trendDemoted: false });
  // T-12: modify는 0.55 완화 — 0.587 실기기 발화가 수용돼야 한다.
  expect(resolveFinal({ ...base, cmd: 'modify', confidence: 0.587 }))
    .toEqual({ act: 'dispatch', cmd: 'modify', trendDemoted: false });
  // 정확 경계 0.55 = 수용(조건은 `< floor` — `<=`로 바뀌면 여기서 잡힌다, 리뷰 s3r2 Codex Low).
  expect(resolveFinal({ ...base, cmd: 'modify', confidence: 0.55 }))
    .toEqual({ act: 'dispatch', cmd: 'modify', trendDemoted: false });
  expect(resolveFinal({ ...base, cmd: 'modify', confidence: 0.54 }))
    .toEqual({ act: 'rejectLowConfidence', minConfidence: 0.55 });
  // confidence 0 = 미보고 → 게이트 통과
  expect(resolveFinal({ ...base, cmd: 'end', confidence: 0 }))
    .toEqual({ act: 'dispatch', cmd: 'end', trendDemoted: false });
  // 값 발화(cmd 없음)는 이 게이트 대상 아님
  expect(resolveFinal({ ...base, cmd: null, confidence: 0.1 }))
    .toEqual({ act: 'value', trendCorrection: false });
});

/**
 * v0.51.1 R5 (2026-09-02 실기기 · STT 레인 §6 R5) — **정확 일치 「수정」만** floor 0.55 → 0.40.
 * 09-02 정식 4세션에서 또렷한 「수정」이 conf 0.443·0.469·0.505로 거절돼 각 4~5초를 잃었다(프리뷰 4 ·
 * 09-01 1). 오발동 대가는 직전 값 재청취(값 파괴 없음)이고 같은 로그에 conf<0.55 「수정」 오인식은 0건.
 * 🔴 반증(2026-09-02 실측): `minConfidenceExact: 0.4`를 레지스트리에서 지우면 ①③이 red.
 */
test('v0.51.1 R5 — 「수정」 정확 일치만 floor 0.40 · 비정확·타 명령은 종전 floor', () => {
  // ① 정확 일치 「수정」 conf 0.44 → 접수(09-02 실측 0.443).
  expect(resolveFinal({ ...base, cmd: 'modify', confidence: 0.44, exact: true }))
    .toEqual({ act: 'dispatch', cmd: 'modify', trendDemoted: false });
  // ② 정확 일치라도 0.35는 거절 — floor는 0.40이다(잡음 군집 최대 0.313 위).
  expect(resolveFinal({ ...base, cmd: 'modify', confidence: 0.35, exact: true }))
    .toEqual({ act: 'rejectLowConfidence', minConfidence: 0.4 });
  // ③ 정확 경계 0.40 = 수용(조건은 `< floor`).
  expect(resolveFinal({ ...base, cmd: 'modify', confidence: 0.4, exact: true }))
    .toEqual({ act: 'dispatch', cmd: 'modify', trendDemoted: false });
  // ④ 「종료」는 정확 일치여도 종전 0.7 그대로 — 상태를 파괴하는 명령은 완화하지 않는다.
  expect(resolveFinal({ ...base, cmd: 'end', confidence: 0.44, exact: true }))
    .toEqual({ act: 'rejectLowConfidence', minConfidence: 0.7 });
  // ⑤ 비정확 「수정」(「수정해줘」·「178.1 수정」)은 종전 0.55 — exact=false/생략 모두.
  expect(resolveFinal({ ...base, cmd: 'modify', confidence: 0.44, exact: false }))
    .toEqual({ act: 'rejectLowConfidence', minConfidence: 0.55 });
  expect(resolveFinal({ ...base, cmd: 'modify', confidence: 0.44 }))
    .toEqual({ act: 'rejectLowConfidence', minConfidence: 0.55 });
  // ⑥ 정확 일치 판정은 detectCommand와 같은 정규화 — 공백·`.`·`,`만 지운다.
  expect(isExactCommandUtterance('수정', 'modify')).toBe(true);
  expect(isExactCommandUtterance('수정.', 'modify')).toBe(true);
  expect(isExactCommandUtterance(' 수 정 ', 'modify')).toBe(true);
  expect(isExactCommandUtterance('수정해줘', 'modify')).toBe(false);
  expect(isExactCommandUtterance('178.1 수정', 'modify')).toBe(false);
  expect(isExactCommandUtterance('수정', 'end')).toBe(false);
  expect(isExactCommandUtterance('수정', null)).toBe(false);
  // ⑦ 레지스트리 계약 — 완화 필드는 '수정'에만 있다(다른 명령에 붙이려면 오발동 대가 실측이 먼저다).
  expect(VOICE_COMMANDS.filter((c) => c.minConfidenceExact != null).map((c) => c.id)).toEqual(['modify']);
});

test('trendConfirm 해소(B4) — 확인/유지=확정, 타 명령=강등 디스패치, 값=정정 폴스루', () => {
  const tc = { ...base, awaitingKind: 'trendConfirm' as const };
  expect(resolveFinal({ ...tc, cmd: 'confirm' })).toEqual({ act: 'trendResolve' });
  expect(resolveFinal({ ...tc, cmd: 'keep' })).toEqual({ act: 'trendResolve' });
  expect(resolveFinal({ ...tc, cmd: 'nextRow' }))
    .toEqual({ act: 'dispatch', cmd: 'nextRow', trendDemoted: true });
  expect(resolveFinal({ ...tc, cmd: null })).toEqual({ act: 'value', trendCorrection: true });
  // 신뢰도 게이트가 trendConfirm 해소보다 먼저다(종전 코드 순서).
  expect(resolveFinal({ ...tc, cmd: 'confirm', confidence: 0.5 }))
    .toEqual({ act: 'rejectLowConfidence', minConfidence: 0.7 });
});

/**
 * v0.38.0 리뷰#1(Codex High) — 이상치 대기 중 **화면 표시만 바꾸는 명령**은 알림을 소모하지 않는다.
 *
 * 결함: '확인'/'유지'가 아닌 **모든** 명령이 trendDemoted=true로 나가 useVoiceSession이
 * setAnomalyAlert(null)로 알림을 지웠다. 그래서 "도움말"이라고 말하면 **미확인 이상치 경고가
 * 사라졌다** — 같은 동작을 화면 버튼으로 누르면 알림이 유지되는데도. 음성/터치 불일치이자,
 * 사용자가 이상값을 확인·수정하지 않고 넘어갈 수 있는 데이터 무결성 문제다.
 */
test('[리뷰#1] trendConfirm 중 UI 전용 명령은 알림을 소모하지 않는다(터치 버튼과 동등)', () => {
  const tc = { ...base, awaitingKind: 'trendConfirm' as const };

  for (const cmd of VOICE_UI_COMMAND_IDS) {
    expect(resolveFinal({ ...tc, cmd }), `${cmd}는 알림을 유지해야 한다`)
      .toEqual({ act: 'dispatch', cmd, trendDemoted: false });
  }

  // 대조군 — 값·행을 움직이는 명령은 종전대로 알림을 해제하고 강등된다(회귀 방지).
  for (const cmd of ['nextRow', 'prevRow', 'modify', 'cancel', 'end'] as const) {
    expect(resolveFinal({ ...tc, cmd }), `${cmd}는 종전대로 강등돼야 한다`)
      .toEqual({ act: 'dispatch', cmd, trendDemoted: true });
  }

  // 🔴 v0.49 fix49(리뷰 M-1 · 민구 확정 08-12) — **항목 이동은 알림을 소모하지 않는다.**
  //   호출부가 trendDemoted에서 `clearAnomalyAlert`를 부르므로, 여기서 true를 돌려주면
  //   실제 거부 가드(`gotoAdjacentField`)가 돌기 **전에** 팝업이 이미 사라진다.
  //   ⚠️ 위 대조군의 `nextRow`/`prevRow`가 여전히 강등인 것이 이 계약의 짝이다 —
  //   **행 이동은 이번 결정의 범위 밖**이라 종전 의미를 그대로 둔다(민구 08-12).
  for (const cmd of ['prevField', 'nextField'] as const) {
    expect(resolveFinal({ ...tc, cmd }), `${cmd}는 알림을 유지해야 한다(거부는 가드가 한다)`)
      .toEqual({ act: 'dispatch', cmd, trendDemoted: false });
  }

  // 이상치 대기가 아닐 때는 UI 명령도 종전과 동일(강등 개념 자체가 없다).
  expect(resolveFinal({ ...base, awaitingKind: 'value', cmd: 'help' }))
    .toEqual({ act: 'dispatch', cmd: 'help', trendDemoted: false });
});

test('센티넬 흡수 — atEnd/reviewWait/cellWait의 일반 값 발화, 명령은 정상 디스패치', () => {
  expect(resolveFinal({ ...base, awaitingKind: 'atEnd', cmd: null })).toEqual({ act: 'absorbAtEnd' });
  expect(resolveFinal({ ...base, awaitingKind: 'reviewWait', cmd: null })).toEqual({ act: 'absorbReviewWait' });
  expect(resolveFinal({ ...base, awaitingKind: 'reviewWait', cmd: 'modify' }))
    .toEqual({ act: 'dispatch', cmd: 'modify', trendDemoted: false });
  expect(resolveFinal({ ...base, awaitingKind: 'atEnd', cmd: 'end' }))
    .toEqual({ act: 'dispatch', cmd: 'end', trendDemoted: false });

  // 🔴 v0.49 fix49(리뷰 B-1) — 셀 검토 대기: 값이 든 셀에 항목 이동으로 착지한 상태.
  //   커밋 지점에 셀 단위 거절 게이트가 없어 흡수하지 않으면 확정값이 bare 숫자로 덮인다.
  expect(resolveFinal({ ...base, awaitingKind: 'cellWait', cmd: null })).toEqual({ act: 'absorbCellWait' });
  // 명령은 그대로 산다 — 특히 '수정'(정정 진입로)과 항목 이동(착지 후에도 이동 계속).
  for (const cmd of ['modify', 'prevField', 'nextField', 'nextRow'] as const) {
    expect(resolveFinal({ ...base, awaitingKind: 'cellWait', cmd }))
      .toEqual({ act: 'dispatch', cmd, trendDemoted: false });
  }
});

test('일반 값 대기 — 명령 없으면 값 경로', () => {
  expect(resolveFinal({ ...base, cmd: null })).toEqual({ act: 'value', trendCorrection: false });
  expect(resolveFinal({ ...base, awaitingKind: 'modify', cmd: null }))
    .toEqual({ act: 'value', trendCorrection: false });
});

test('v0.38.0 #4-③ — 가시 UI 명령은 매핑되고 숫자·단위 발화는 명령으로 오인되지 않는다', () => {
  const uiCommands = [
    ['도움말', 'help'],
    ['화면', 'screenOff'],
  ] as const;
  for (const [spoken, expected] of uiCommands) expect(detectCommand(spoken)).toBe(expected);

  // 🔴 v0.51 (민구 확정 2026-08-31) — **조절판 5종이 여기서 사라졌다. 그 자리를 반대 단언이 잇는다.**
  //
  //  왜 지웠나: 민구 원문 ***"조절판은 손으로만"*** — ㉠ 이 명령이 필요한 순간은 「인식이 안 되는
  //  순간」인데 명령 자체가 신뢰도 0.7을 넘어야 한다(**순환**), ㉡ 6~7음절 최장이라 문턱이 가장 높다,
  //  ㉢ 결과(%)는 조절판을 봐야 안다.
  //
  //  🔴 **줄만 지우면 안 된다.** 지운 자리에 아무 오라클도 없으면 누군가 «편의로» 되살렸을 때
  //  아무도 모른다 — 그리고 그 순간 도움말(「손으로만 되는 것」)과 파서가 **정면으로 어긋난다**
  //  (v0.51이 고친 것이 정확히 그 «가르치지 않는데 동작하는» 불일치다).
  //  👉 **부활 감지 오라클**로 뒤집어 단언한다.
  for (const gone of ['입력 조절', '입력조절', '인식률 낮추기', '인식률 높이기', '안내속도 느리게', '안내속도 빠르게']) {
    expect(detectCommand(gone), `${gone}가 다시 명령으로 잡힌다 — 「손으로만」 계약 위반`).toBeNull();
  }
  // 🟢 기능 자체는 산다 — 스텝퍼·토글·요약 필은 그대로다(제거된 것은 «말로 부르는 경로»뿐).
  //    그 생존은 `v020-dials-layout` · `v026-tolerance-strict` T1~T3이 계속 진다.

  for (const measurement of ['12', '12.3', '십이 점 삼', '12 밀리미터', '당도 15.2', '영 점 오']) {
    expect(detectCommand(measurement), `${measurement}는 측정값 발화`).toBeNull();
  }

  // 🔴 v0.49 F-1(민구 결정 2026-08-12) — 이 가드가 강제하던 **「접두 충돌 0」 불변식이 대체됐다.**
  //   종전: 어떤 word도 다른 word의 접두일 수 없다(그래야 startsWith 순회가 순서 무관).
  //   현재: 「이전」/「다음」=항목 · 「이전행」/「다음행」=행으로 재배정되며 접두 쌍이 **의도적으로**
  //         생겼고, detectCommand가 **최장 일치**로 해소한다(koreanNum.ts COMMANDS_LONGEST_FIRST).
  //   그래서 가드를 지우지 않고 **뒤집어 잰다**: 접두 쌍은 «정확히 이 2개»여야 하고(모르는 사이에
  //   3번째가 생기면 red), 각 쌍에서 **긴 쪽이 이겨야** 한다.
  const normalizedWords = VOICE_COMMANDS.map((command) => command.word.replace(/\s+/g, ''));
  const prefixPairs: string[] = [];
  for (const word of normalizedWords) {
    for (const candidate of normalizedWords) {
      if (candidate !== word && candidate.startsWith(word)) prefixPairs.push(`${word}⊂${candidate}`);
    }
  }
  expect(prefixPairs.sort(), '의도되지 않은 접두 쌍이 생겼다 — 최장 일치로 해소되는지 확인하라')
    .toEqual(['다음⊂다음행', '이전⊂이전행']);

  // 긴 쪽이 이긴다 — 여기가 red면 행 이동 어휘가 짧은 항목 이동 어휘에 가로채인 것이다.
  expect(detectCommand('이전행')).toBe('prevRow');
  expect(detectCommand('다음행')).toBe('nextRow');
  expect(detectCommand('이전')).toBe('prevField');
  expect(detectCommand('다음')).toBe('nextField');
});

/** r2 P2-2 (2026-09-02 콜드 리뷰) — **게이트 자기단언.** 이 파일은 R5(정확 일치 「수정」 floor 0.40 · 레지스트리 계약)의 유일한 리터럴 오라클인데 `test:e2e:gate` 밖이라
 *  `predeploy`가 한 번도 안 돌았다(`v043-typo-contract.spec.ts:180`의 재현 조건). `v051-mic-muted-span.spec` ⓪과 같은 꼴 —
 *  목록에서 이 이름을 지우면 여기서 red다. */
test('[node] ⓪-게이트 이 오라클이 릴리스 게이트 목록에 등재돼 있다 (r2 P2-2)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8')) as {
    scripts: Record<string, string>;
  };
  const listed = (pkg.scripts['test:e2e:gate'] ?? '').split(/\s+/).filter((x) => x.startsWith('tests/'));
  expect(listed, 'tests/voiceFinalResolver.spec.ts가 릴리스 게이트 목록에 없다 — predeploy에서 한 번도 돌지 않는다').toContain('tests/voiceFinalResolver.spec.ts');
});

/** v0.51.1 R6 — 혼동 확인 질문 대기(민구 결정 09-02 ①): 값은 이미 커밋돼 있다. 기존 단언은 한 글자도 안 바뀐다 —
 *  `confusionDismissed`는 이 국면의 타 명령에만 붙는다(있을 때만). */
test('confusionConfirm — 확인/유지=원값 확정, UI·이동 명령=질문 보존 통과, 타 명령=질문 접고 디스패치, 값=폴스루', () => {
  const cc = { ...base, awaitingKind: 'confusionConfirm' as const };
  expect(resolveFinal({ ...cc, cmd: 'confirm' })).toEqual({ act: 'confusionResolve' });
  expect(resolveFinal({ ...cc, cmd: 'keep' })).toEqual({ act: 'confusionResolve' });
  // 항목 이동은 알림(질문)을 소모하지 않고 통과한다 — 거부는 gotoAdjacentField의 국면 가드가 한다([PHASE-NAV-1]).
  expect(resolveFinal({ ...cc, cmd: 'nextField' })).toEqual({ act: 'dispatch', cmd: 'nextField', trendDemoted: false });
  expect(resolveFinal({ ...cc, cmd: 'help' })).toEqual({ act: 'dispatch', cmd: 'help', trendDemoted: false });
  // 종료·수정 등은 질문을 접는다(confusionDismissed) — 호출부가 modify로 강등하고 정상 dispatch한다.
  expect(resolveFinal({ ...cc, cmd: 'end' })).toEqual({ act: 'dispatch', cmd: 'end', trendDemoted: false, confusionDismissed: true });
  expect(resolveFinal({ ...cc, cmd: 'modify' })).toEqual({ act: 'dispatch', cmd: 'modify', trendDemoted: false, confusionDismissed: true });
  // 명령 아님 = 값 경로(답변 낱말·값 재발화는 값 게이트가 해석). trendCorrection은 아니다.
  expect(resolveFinal({ ...cc, cmd: null })).toEqual({ act: 'value', trendCorrection: false });
  // 신뢰도 게이트가 먼저다(종전 순서 그대로).
  expect(resolveFinal({ ...cc, cmd: 'end', confidence: 0.3 })).toEqual({ act: 'rejectLowConfidence', minConfidence: 0.7 });
});
