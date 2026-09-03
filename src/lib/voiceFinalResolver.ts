/**
 * v0.35.3 Stage 3-2 — handleFinal 결정표(순수). 최종 인식 결과 1건이 어느 경로로 가는지를
 * (명령, 신뢰도, 세션 phase, 대기 모드)만으로 판정한다. 부수효과 없음 — 실행(액션 해석)은
 * useVoiceSession.handleFinal이 담당하고, 이 표는 tests/voiceFinalResolver.spec.ts가
 * 특성화로 고정한다(종전 handleFinal 인라인 분기와 판정 동일).
 *
 * 판정 순서(종전 코드 순서 그대로 — 순서가 곧 우선순위 계약):
 *  1. paused면 resume/end만 수용, 나머지 무시(v0.15.0 A5 — resume은 신뢰도 게이트도 안 탄다:
 *     일시정지 탈출의 유일한 경로라 의도적 비게이트).
 *  2. 명령 신뢰도 게이트(T-2): 명령별 floor(레지스트리 SSOT, 기본 0.7) 미달이면 재질문.
 *     confidence 0은 "미보고" 센티널 — 통과. v0.51.1 R5: 발화가 `word`와 **정확히 일치**하면
 *     (`exact`) 레지스트리의 `minConfidenceExact`가 floor를 대체한다(현재 '수정'만 0.40).
 *  3. trendConfirm 해소(v0.7.0 B4): '확인'/'유지'=확정·진행, 타 명령=알림 해제 후 명령 디스패치
 *     (수정 의미론 'modify'로 강등), 명령 아님=값 경로 폴스루(정정 재커밋).
 *     **단 화면 표시만 바꾸는 UI 명령은 알림을 해제하지 않는다**(v0.38.0 리뷰#1) — 같은 동작의
 *     화면 버튼은 알림을 유지하는데 음성만 해제하면 음성/터치가 어긋나고, 무엇보다 사용자가
 *     이상치를 **확인하지 않은 채** 다음으로 넘어갈 수 있다(데이터 무결성).
 *  4. modifyColumnConfirm(v0.52 P1-1): 칸을 대상으로 하는 명령 넷(cellScoped)은 명령이 아니라
 *     **답**이다 — 값 게이트의 답변 가드로 보낸다. 나머지 명령은 5로 간다.
 *  5. 명령 디스패치.
 *  6. atEnd/reviewWait/cellWait 센티넬은 일반 값 발화를 흡수(안내만).
 *  7. 값 경로.
 */
import {
  VOICE_COMMANDS, isCellScopedCommand, isVoiceUiCommand, preservesAnomalyAlert, type VoiceCommand,
} from './voiceCommands';

// 🔴 v0.52 P1-1(콜드 리뷰 R1 §2) — `modifyColumnConfirm`(「수정 <축약이름>」 모호 확인 질문)은
//   종전 **분기가 없었다**: 「명령이면 종전대로 dispatch」였는데, 그 「종전대로」가 **대상이 없는
//   좌표 추측**이었다. 그래서 질문 국면 전용 분기를 둔다 — 근거·실측은 `CommandSpec.cellScoped`.
//   흡수 3종처럼 여기서 act를 **새로** 만들지는 않는다: 답변 낱말이 아닌 발화는 `value`로 떨어져
//   **값 게이트의 전용 가드**(`runModifyColumnAnswerGate`)가 원상 복귀까지 책임진다.
export type AwaitingKind = 'value' | 'modify' | 'trendConfirm' | 'confusionConfirm' | 'modifyColumnConfirm' | 'atEnd' | 'reviewWait' | 'cellWait';

export type FinalAction =
  | { act: 'pausedResume' }
  | { act: 'pausedEnd' }
  | { act: 'pausedIgnore' }
  | { act: 'rejectLowConfidence'; minConfidence: number }
  | { act: 'trendResolve' }
  /** v0.51.1 R6 — 혼동 확인 질문의 「확인/유지」(원값 확정·진행). */
  | { act: 'confusionResolve' }
  /** `confusionDismissed`는 혼동 질문 대기 중 타 명령이 질문을 접을 때만 붙는다(있을 때만 — 기존 단언 불변). */
  | { act: 'dispatch'; cmd: Exclude<VoiceCommand, null>; trendDemoted: boolean; confusionDismissed?: true }
  | { act: 'absorbAtEnd' }
  | { act: 'absorbReviewWait' }
  | { act: 'absorbCellWait' }
  | { act: 'value'; trendCorrection: boolean };

export function resolveFinal(input: {
  cmd: VoiceCommand;
  confidence: number;
  paused: boolean;
  awaitingKind: AwaitingKind;
  /** v0.51.1 R5 — 발화가 명령 `word`와 정확히 일치하는가(`isExactCommandUtterance`). 생략 = false
   *  (종전 floor). 정확 일치일 때만 레지스트리의 `minConfidenceExact`가 floor를 대체한다. */
  exact?: boolean;
}): FinalAction {
  const { cmd, confidence, paused, awaitingKind, exact = false } = input;

  if (paused) {
    if (cmd === 'resume') return { act: 'pausedResume' };
    if (cmd === 'end') return { act: 'pausedEnd' };
    return { act: 'pausedIgnore' };
  }

  const spec = VOICE_COMMANDS.find((c) => c.id === cmd);
  const minConfidence = (exact ? spec?.minConfidenceExact : undefined) ?? spec?.minConfidence ?? 0.7;
  if (cmd && confidence > 0 && confidence < minConfidence) {
    return { act: 'rejectLowConfidence', minConfidence };
  }

  if (awaitingKind === 'trendConfirm') {
    if (cmd === 'confirm' || cmd === 'keep') return { act: 'trendResolve' };
    // v0.38.0 리뷰#1 — 화면 표시만 바꾸는 명령(도움말·조절판·인식률·안내속도)은 이상치 판단과
    // 무관하므로 알림을 소모하지 않는다. 같은 동작의 화면 버튼과 동등해야 한다.
    if (isVoiceUiCommand(cmd)) return { act: 'dispatch', cmd, trendDemoted: false };
    // 🔴 v0.49 fix49(리뷰 M-1 · 민구 확정 08-12 「거부+안내」) — **항목 이동은 알림을 소모하지
    //   않는다.** 종전엔 「나머지」로 떨어져 `trendDemoted:true` → 호출부가
    //   `clearAnomalyAlert('trend_dismissed')`로 팝업을 닫은 **뒤** dispatch했다. 즉 미확인
    //   이상치가 「다음」 한 마디로 소멸했다 — `isManualHoldBlocked`가 터치 이동에 대해 막던
    //   바로 그 우회다(음성 발동 알람은 `manualHold`가 아니라 그 게이트를 안 탄다).
    //   어휘 재배정(08-12)으로 「다음」이 *옆 칸 한 칸*이 되어 심리적 비용이 사라진 만큼 노출
    //   확률이 구조적으로 커졌다. 여기서 알림을 **보존한 채** 통과시키고, 실제 거부와 안내는
    //   `gotoAdjacentField`의 국면 가드가 한다(같은 계약의 두 반쪽 — 한쪽만 고치면 무의미하다).
    //   🔴 v0.49 fix49b(max 리뷰 #15) — 종전엔 여기에 id 리터럴 두 개가 박혀 있었다. 그러면
    //   「알림을 소모하지 않는다」는 성질이 **명령 선언부에서 보이지 않아**, 다음에 같은 성질의
    //   명령이 생기거나 id가 바뀔 때 이 줄을 함께 고쳐야 한다는 걸 알 방법이 없다(잊으면 M-1이
    //   조용히 되살아난다). 성질을 `CommandSpec.preservesAlert`로 옮겨 선언과 계약을 붙였다.
    if (cmd && preservesAnomalyAlert(cmd)) return { act: 'dispatch', cmd, trendDemoted: false };
    if (cmd) return { act: 'dispatch', cmd, trendDemoted: true };
    return { act: 'value', trendCorrection: true };
  }

  // v0.51.1 R6 — 혼동 확인 질문 대기(민구 결정 09-02 ①: 값은 이미 커밋돼 있다). '확인'/'유지'=원값 확정·진행,
  //   UI 명령·항목 이동은 질문을 보존한 채 통과(이동은 `gotoAdjacentField` 국면 가드가 거부 — [PHASE-NAV-1]의
  //   두 반쪽), 그 밖의 명령(종료·일시정지·수정…)=질문을 접고(원값 유지) 디스패치, 명령 아님=값 경로(답변 낱말
  //   해석은 값 게이트 — 「둘째」는 후보 재커밋, 값 재발화는 그 값으로 재커밋).
  if (awaitingKind === 'confusionConfirm') {
    if (cmd === 'confirm' || cmd === 'keep') return { act: 'confusionResolve' };
    if (isVoiceUiCommand(cmd)) return { act: 'dispatch', cmd, trendDemoted: false };
    if (cmd && preservesAnomalyAlert(cmd)) return { act: 'dispatch', cmd, trendDemoted: false };
    if (cmd) return { act: 'dispatch', cmd, trendDemoted: false, confusionDismissed: true };
    return { act: 'value', trendCorrection: false };
  }

  // 🔴 v0.52 P1-1 — 「수정 <축약이름>」 모호 확인 질문 대기. 이 국면의 `awaiting`은 **칸이 아니라
  //   질문**이라, 칸의 값을 대상으로 하는 명령 넷(`cellScoped`)은 **명령이 아니라 답**으로 받는다:
  //   값 게이트의 전용 가드가 「수정/다시/아니오」=지목 취소, 그 밖=답 아님으로 갈라 **어느 쪽이든
  //   질문 전 국면으로 되돌린다**(셀 불변). 나머지 아홉(UI·항목/행 이동·세션)은 칸을 대상으로 하지
  //   않으므로 종전대로 dispatch하고 질문은 접힌다 — `confusionConfirm`의 「그 밖의 명령」과 같은 판단.
  if (awaitingKind === 'modifyColumnConfirm' && isCellScopedCommand(cmd)) {
    return { act: 'value', trendCorrection: false };
  }

  if (cmd) return { act: 'dispatch', cmd, trendDemoted: false };
  if (awaitingKind === 'atEnd') return { act: 'absorbAtEnd' };
  if (awaitingKind === 'reviewWait') return { act: 'absorbReviewWait' };
  // v0.49 fix49 — 셀 검토 대기(값 있는 셀 착지)도 일반 값 발화를 흡수한다. 커밋 지점에 셀 단위
  // 거절 게이트가 없으므로, 여기서 흡수하지 않으면 확정된 값이 bare 숫자로 덮인다(B-1).
  if (awaitingKind === 'cellWait') return { act: 'absorbCellWait' };
  return { act: 'value', trendCorrection: false };
}
