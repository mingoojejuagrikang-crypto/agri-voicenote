/**
 * v0.51.1 통합(feat/v0511-round-0902) — 값 게이트의 **atEnd 흡수 본체**(`useFinalValueGate` 블록 D의 첫 흡수 가드).
 * 게이트 파일의 500줄 게이트(GL-006 §5) 때문에 분리했다 — `finalValueGateConfusion.ts`(R6 r3)와 같은 방식이고 기능
 * 변경은 없다. 가드 뼈대 `if (awaiting.kind === 'atEnd') { await absorbAtEnd(…); return true; }`는 게이트에 남아 있어
 * D·E에 걸친 판별 유니온 내로잉(게이트 헤더 「D와 E는 한 파일이어야 한다」)은 그대로다 — 여기엔 본체(큐 → 로그 →
 * 끝 도달 안내)와 그 근거만 있다. deps는 게이트 주입 심볼의 부분집합(type-only import · 런타임 순환 없음).
 */
import { useSessionStore } from '../stores/sessionStore';
import { computeTotalRows } from './autoValue';
import { endAbsorb } from './logEvents';
import { cellWaitPrompt } from './voicePrompts';
import type { AwaitingField } from './useVoiceSession';
import type { FinalValueGateDeps } from './useFinalValueGate';

export type AtEndAbsorbDeps = Pick<
  FinalValueGateDeps,
  'logCell' | 'rejectValue' | 'listEmptyRows' | 'buildEndReachedTts' | 'voiceColsList' | 'getSessionColumns'
>;

// v0.52 — **셀 검토 대기 흡수 본체**도 같은 이유로 여기 있다(게이트의 500줄 게이트 · 기능 변경 없음).
//   게이트에는 가드 뼈대 한 줄만 남아 D·E 내로잉이 그대로다(위 atEnd 흡수와 같은 방식).
//
// 🔴 v0.49 fix49(리뷰 B-1) — 셀 검토 대기(값 있는 셀에 항목 이동으로 착지): 명령은 위에서
//   이미 dispatch됐다. 여기 도달한 것은 일반 값 발화이므로 **커밋하지 않는다.** 이 흡수가
//   없으면 `setRowValue`가 확정·저장된 값을 무조건 덮는다(커밋 지점에 셀 단위 게이트 없음).
//   문구는 행 검토("N행은 완료된 행입니다")와 **다르다** — 여기서 행을 말하면 사용자는
//   행이 끝난 줄 안다. 정정 진입로('수정')를 한 마디로 가르친다(H-2 — 길이 압력).
export async function absorbCellWait(
  awaiting: Extract<AwaitingField, { kind: 'cellWait' }>,
  text: string,
  deps: Pick<FinalValueGateDeps, 'logCell' | 'say'>,
): Promise<void> {
  useSessionStore.getState().setRecognized('');
  useSessionStore.getState().setReaskReason(null); // Y6 — 위 atEnd 흡수와 같은 계약.
  deps.logCell({
    type: 'command', parsed: 'cell_wait_absorb',
    extra: `cell_wait_absorb:${awaiting.colId}`, text,
    row: awaiting.row, colId: awaiting.colId,
  });
  // ⚠️ 문구는 `cellWaitPrompt`(#9 SSOT — voicePrompts.ts)를 쓴다. 이 흡수 안내가 그 문장의
  //   **의미상 원본**이지만, 여기 리터럴을 남겨 두면 「선언은 하나인데 사본이 있는」
  //   [PAST-2] 형태가 된다. ([ENV-12] E1 — 선언은 handleFinal 안에서 voicePrompts로 올랐다.)
  await deps.say(cellWaitPrompt(awaiting.name));
}

// v0.23.0 입력탭#4 — 마지막 행 종료 대기(atEnd): 명령(종료/수정/이동 등)은 위에서 이미 dispatch됐다.
// 여기 도달한 것은 일반 값 발화이므로 새 행으로 커밋하지 않고 종료 안내만 재생한다(자동 종료 제거).
export async function absorbAtEnd(
  awaiting: Extract<AwaitingField, { kind: 'atEnd' }>,
  text: string,
  deps: AtEndAbsorbDeps,
): Promise<void> {
  const { logCell, rejectValue, listEmptyRows, buildEndReachedTts, voiceColsList, getSessionColumns } = deps;
  useSessionStore.getState().setRecognized('');
  // 🔴 v0.51.1 B2(제보② 2026-09-02 15:50 · read-fb F3) — atEnd 흡수는 **「못 알아들었다」 신호를 먼저
  //   낸다.** 종전 Y6(v0.49 r6)은 「흡수 = 처리됨 → 큐 해제」였는데, atEnd에서 흡수되는 발화의 실체는
  //   **명령 오인식**이다: 양승보 r18에서 「수정」이 STT '회'(0.243)로 와 명령 미매치 → 여기서 무로그
  //   흡수 → 「마지막행 입력…」만 반복. 끝 도달 안내에는 조작 어휘가 없어(W2) 사용자는 「수정이 안
  //   먹는다」만 겪었다. 저신뢰 명령 거절(M11·Z5)과 **같은 종단 `rejectValue`**를 탄다 — 부정 비프 + 화면
  //   「소리가 불확실」(`armRejectCue`는 종단만 부른다: z5 단일 호출 계약) + 꼬리 = 끝 도달 안내(사유 TTS 없음 ·
  //   atEnd엔 소수 문맥이 없어 종단이 꼬리를 그대로 말한다 · 클립 재시작 없음) + 로그 1줄(`cell_wait_absorb`와
  //   같은 꼴). 즉 큐가 먼저, 끝 도달 안내가 뒤따른다(확인음→말 순서 계약).
  //   ⚠️ reviewWait·cellWait 흡수(게이트에 남은 다음 두 가드)는 Y6 그대로다 — 그 두 국면은 값 발화 흡수가 정상이고 제보 형상도
  //   없다. 숫자 발화가 atEnd에서 흡수될 때도 같은 큐가 뜬다(빌드 산출물 §4 미결).
  logCell({
    type: 'command', parsed: 'end_absorb',
    extra: endAbsorb(awaiting.colId), text,
    row: awaiting.row, colId: awaiting.colId,
  });
  // 🔴 v0.49 r2 W2(확정표 #5+6) — 진입 안내와 **같은 문구**다. 종전엔 여기가 "입력이
  //   끝났습니다…", 진입이 "마지막 행까지 입력했습니다…"로 갈려 있어 같은 상태를 두 이름으로
  //   불렀다. 빈 행 목록은 **이 시점에 다시 센다** — 흡수 시점엔 값이 더 채워졌을 수 있다.
  const vcEnd = voiceColsList();
  await rejectValue('low_confidence', awaiting, {
    tail: buildEndReachedTts(listEmptyRows(computeTotalRows(getSessionColumns()), vcEnd)),
  });
}
