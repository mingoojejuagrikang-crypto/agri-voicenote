/* eslint-disable max-lines -- [ENV-12] 기존 초과 파일(GL-006 §5 도입 시점), Stage 3(음성 코어 재설계)에서 해소. 해소 시 이 주석 제거. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { useSessionStore, isSessionLive } from '../stores/sessionStore';
import { useDataStore } from '../stores/dataStore';
import { recountSynced } from './sessionSync';
import { parseKoreanNumber, detectCommand } from './koreanNum';
// [ENV-12] v0.43.0 #3 — 값 파싱 시도는 순수 모듈이 소유한다(부수효과 없음). 이 파일은 호출만.
import { parseValueForCol } from './valueParseAttempt';
import { VOICE_COMMANDS, type VoiceCommand, type VoiceUiCommandSignal } from './voiceCommands';
import { decimalReaskPrompt, formatNameForTts, NO_VOICE_COLUMNS_MESSAGE, REASK_TTS } from './voicePrompts';
import { SpeechController, speak, cancelTts, isSpeechSupported, formatForTts, warmupTts, setActiveController, setPreferredVoiceName, setBargeInEnabled, refreshVoices, resumeTtsEngine } from './speech';
import { computeTotalRows, buildCyclingValues, nestedAutoValue, isUserInputColumn } from './autoValue';
import type { Column, Session, SessionRow, SessionTarget } from '../types';
import { saveSession } from './db';
import { playBeep, unlockAudioPlayback } from './beep';
import { useModifyPhase } from './modifyPhase';
import { useSessionCommitMarks } from '../components/voice/useVoiceCommitMark';
import { useCellPersistError } from './cellPersistError';
import { AudioRecorder, type AudioTrackState } from './audioRecorder';
import { logger } from './logger';
import {
  anomalyAlertCleared,
  audioInputClass,
  audioRouteRevalidate,
  bgKeep,
  bgMicAction,
  clipArmBlocked,
  manualHoldGuide,
  micAutoReconnect,
  micAutoReconnectSkipped,
  micInitFailed,
  notifyPerm,
  // v0.51.1 B1 — 음성 열 0개 구성의 세션 시작 차단(제보①).
  sessionStartBlocked,
} from './logEvents';
import { shouldKeepInBackground, LONG_BACKGROUND_OFF_MS } from './backgroundSessionPolicy';
import { requestNotifyPermissionOnce, showBackgroundOffNotification } from './backgroundNotify';
import { resolveForegroundReturnEvent } from './foregroundReturnTelemetry';
import { hydratePastIndexFallback, prefetchPastIndex, resetPastIndexRetries } from './pastValues';
import { checkAnomaly, type TrendViolation } from './trendCheck';
import { buildAnomalyAlert } from './anomalyAlert';
import { readonlySheetsAuth } from './sheets';
import { withoutPendingCandidate } from './pendingValidation';
import { isSheetSourceBlocked, sessionTargetFromSettings } from './sheetConnection';
import { refreshBeforeSessionStart } from './googleAuthRefresh'; // v0.51 [rauth P2] — 세션 시작 선제 갱신
import { ensureUniqueSessionLabel } from './sessionLabel';
// [ENV-12] Stage 3 — 클립 캡처·보존 장부는 useClipCapture가 소유한다(이 파일은 호출만).
import { useClipCapture, type PendingCommandClip } from './useClipCapture';
import { createClipHealth, clipSummaryExtra, clipUnreliableSummaryExtra, type ClipHealth } from './clipHealth';
import { getMutedSpanCount, resetMicInterruptionSpans } from './micInterruption';
import { getAudioSessionEventCount } from './audioInterruption';
import { useClipFailureAlert } from './useClipFailureAlert';
import { useMicInterruptionNotice } from './useMicInterruptionNotice';
import { clipFailSummaryScreen, clipUnreliableSummaryScreen } from './voicePrompts';
// [ENV-12] Stage 3 — 세션 영속화(persistSession)는 usePersistSession이 소유한다(이 파일은 호출만).
import { usePersistSession } from './usePersistSession';
// [ENV-12] Stage 3 — 행 이동 계열 내비게이션은 useRowNav가, 항목 한 칸 이동(F-1)은 useFieldNav가
// 소유한다(이 파일은 호출만).
import { useRowNav } from './useRowNav';
import { useFieldNav } from './useFieldNav';
// [ENV-12] Stage 3 — 추세 검증·이상치 응답 구획은 useTrendGate가 소유한다(이 파일은 호출만).
import { useTrendGate } from './useTrendGate';
// [ENV-12] Stage 3 — 안내(행 전환·행 완료 낭독·복귀 브리핑·클립 슬롯 무장·착지 리셋·항목 안내)
// 구획은 useAnnouncements가 소유한다(이 파일은 호출만).
import { useAnnouncements } from './useAnnouncements';
// [ENV-12] E단계 — handleFinal의 명령 경로(경로 판정 + 명령 핸들러 5종)는 useFinalCommands가
// 소유한다(이 파일은 호출만).
import { useFinalCommands } from './useFinalCommands';
// [ENV-12] E단계 — handleFinal의 값 자격 판정(흡수·가드·파싱·거절)은 useFinalValueGate가
// 소유한다(이 파일은 호출만).
import { useFinalValueGate } from './useFinalValueGate';
// [ENV-12] E단계 — handleFinal의 값 커밋(store 커밋·증분 영속화·클립 종결)은 useValueCommit이
// 소유한다(이 파일은 호출만).
import { useValueCommit } from './useValueCommit';
// [ENV-12] E단계 — handleFinal의 착지(추세 알람·정정 정상화·echo·advance)는 useCommitLanding이
// 소유한다(이 파일은 호출만). 이것으로 handleFinal 파이프라인 4스테이지가 완성된다.
import { useCommitLanding } from './useCommitLanding';
import {
  INITIAL_FOREGROUND_RETURN_STATE,
  reduceForegroundReturn,
  shouldEmitRouteRevalidate,
  type ForegroundReturnState,
} from './foregroundReturnPolicy';
import { classifyInputDevice, classifyAudioInputClass } from './inputDevice';


/** 대기 셀 공통 좌표. */
interface AwaitingBase {
  row: number;
  colId: string;
  name: string;
}

/**
 * v0.35.3 Stage 3 — 대기 상태 판별 유니온(종전 boolean 5개: isModify/trendConfirm/fractionWhole/
 * atEnd/reviewWait). 실측 상태기계를 그대로 옮겼고 무효 조합(atEnd/reviewWait가 수정·소수 페이로드를
 * 갖는 것 등)은 컴파일이 차단한다. 상태 의미(각 boolean 시절 주석 요약):
 *
 *  - 'value'        일반 값 대기. fractionWhole(v0.10.0 A1): STT가 소수부를 유실("111 점 에" →
 *                   decimal_fraction_lost)하면 정수부를 담고 "소수점 아래만" 재질문 — 다음 발화가
 *                   소수 한 자리면 `${fractionWhole}.${digit}` 합성 커밋. 값 추측(에→1)은 하지
 *                   않는다(같은 STT 문자열이 111.1·111.5 양쪽에서 나옴 — 민구 결정).
 *  - 'modify'       다음 final을 수정 값으로 처리. previousValue(#3 error-vs-intent): 정정 시작 전
 *                   커밋돼 있던 값 — 최종 값과 함께 로깅해 STT 앞자리 유실(133.3→33.3)과 의도적
 *                   재입력을 분석에서 구분. fractionWhole은 수정 중 소수부 유실 재질문에서도 유지.
 *  - 'trendConfirm' v0.7.0 B4 추세 확인 — 위반 알림 직후 '확인'/'유지'(확정·진행) 또는 새 값
 *                   (수정 의미론으로 재커밋 → 재검증) 대기. **수정 의미론을 포함**한다(종전
 *                   isModify=true 겸장) — isModifyLike()로 판별. 커밋된 값 자체는 유효하게 저장돼
 *                   있다. 재커밋 발화가 소수부 유실이면 fractionWhole 재질문도 이 모드에서 가능.
 *  - 'atEnd'        v0.23.0 입력탭#4 — 마지막 행 완료 후 "종료 대기" 센티넬. 명령은 계속 처리하되
 *                   일반 값 발화는 handleFinal의 atEnd 가드가 종료 안내로 흡수.
 *  - 'reviewWait'   v0.33.0 백로그 A(민구 결정 3) — 완료 행 착지 "검토 대기" 센티넬. 값 낭독 후
 *                   대기, bare 값 발화는 흡수(덮어쓰기 금지 — 수정은 '수정' 명령으로만). 포인터는
 *                   그 행 첫 음성 필드(v0.34.0 A3 확정 규칙).
 *  - 'cellWait'     🔴 v0.49 fix49(리뷰 B-1 blocker) — **값이 든 셀에 항목 이동으로 착지**했을 때의
 *                   "셀 검토 대기". reviewWait의 **셀 단위 형태**다: 값을 낭독하고 명령을 기다리며,
 *                   bare 값 발화는 흡수한다.
 *
 *                   왜 별도 kind인가 — reviewWait을 재사용할 수 없다: 그쪽은 **행 상태**라
 *                   bare 값 발화를 「그 행은 끝났다」는 문구로 흡수하는데, 진행 중인 행의 한 칸에
 *                   서 있는 상태에 그 문구를 쓰면 사용자는 행이 끝난 줄 안다(V-FIX4 안내계약).
 *                   🔴 v0.49 r2 A13(codex F6) — 이 자리의 종전 근거 *"gotoAdjacentField가
 *                   reviewWait/atEnd에서 이동 자체를 거부하므로"* 는 **더 이상 사실이 아니다**:
 *                   W1(08-13 민구 결정)이 두 상태에서의 항목 이동을 허용했다. kind를 가른 판단
 *                   자체는 그대로 유효하고(문구·스코프가 다르다), 근거만 낡았다.
 */
/** 🔴 v0.49 r2 A2 — **셀 검토 대기(cellWait) 복귀 예약**. `resumeReview`(행)의 셀 축 짝이다.
 *  좌표를 실어 다니는 이유: 착지 지점에서 `enterCellWait`을 부르려면 그 전에 커서를 그 셀에
 *  세워야 하는데(`enterCellWait`은 `sess.activeRow`를 읽는다), 그 시점의 커서가 맞다는 보장을
 *  **우연**에 맡기지 않기 위해서다. */
export type ResumeCell = { row: number; colId: string };

export type AwaitingField =
  | (AwaitingBase & { kind: 'value'; fractionWhole?: string })
  | (AwaitingBase & { kind: 'modify'; previousValue?: string; fractionWhole?: string; resumeReview?: number; resumeCell?: ResumeCell })
  | (AwaitingBase & { kind: 'trendConfirm'; previousValue: string; fractionWhole?: string; resumeReview?: number; resumeCell?: ResumeCell })
  | (AwaitingBase & { kind: 'atEnd' })
  | (AwaitingBase & { kind: 'reviewWait' })
  | (AwaitingBase & { kind: 'cellWait'; previousValue: string });

/**
 * 🔴 [ENV-12] E단계(2026-08-15) — `handleFinal` 파이프라인의 **구획 간 전달 상자**.
 *
 * handleFinal 구획(1,192줄)은 `max-lines:500`(주석 포함) 때문에 단일 파일 착지가 산술적으로
 * 불가능해 네 스테이지 훅으로 갈린다(명령 / 값 게이트 / 값 커밋 / 착지). 그런데 그 구획은
 * **함수 하나**라, 여러 블록을 가로지르는 지역변수가 있다 — 가르면 그 값들의 전달 수단이
 * 필요하다. 이 타입이 그것이고, **실측된 가로지르기 목록**(계획서 §1-3)이 필드의 원료다.
 *
 * 🔑 **필드는 E1에서 최종 형태로 전부 선언한다** — 회차마다 타입을 넓히면 그 churn이 곧
 *   회차 간 diff 잡음이 되고, 리뷰가 「이번 회차가 무엇을 바꿨나」를 잃는다. 이후 회차는
 *   **채우는 시점만** 달라진다(선언은 이미 여기 있다).
 *
 * 채우는 주체(= 소유자):
 *  · 블록 A(본체 셸)  — `handleFinalAt` `text` `alts` `confidence` `awaiting` `cmd`
 *  · 명령 스테이지     — `awaiting` **재대입**(trendConfirm → modify 강등. 이 구획의 유일한 변이)
 *  · 값 게이트 스테이지 — `col` `parsed` `lowConfParsedExtra`
 *  · 값 커밋 스테이지   — **없다.** 그 산출물(`myEpoch`·`commitLatencyMs`·
 *    `runCorrectedPersistCheck`)은 ctx가 아니라 **반환값 → 인자**로 착지에 간다.
 *
 * 🔴 [ENV-12] E5 정리 — E1이 선언한 13필드 중 **4개를 지웠다**(`fractionWhole` `myEpoch`
 *   `commitLatencyMs` `runCorrectedPersistCheck`). 넷 다 **쓰기만 있고 독자가 0**이었다.
 *   원인은 하나다: E3·E4가 그 값들을 ctx의 **선택 필드**로 넘기면 non-null을 타입으로 증명할 수
 *   없다는 이유로 **명시 인자 경로**(`runValueCommit(ctx, parsed)` ·
 *   `runCommitLanding(ctx, committed)`)를 택했고, 그러자 ctx 사본이 아무도 읽지 않는 배관이 됐다.
 *   👉 **남은 필드의 기준은 「실제 독자가 있는가」다.** 「나중에 읽을지도 모른다」로 필드를
 *   남기지 마라 — E2가 정확히 그 근거로 `fractionWhole`을 실었고 아무도 읽지 않았다.
 *
 * ⚠️ 이 상자는 **한 번의 final 처리 동안만** 산다(handleFinal 진입 시 생성 · 종료 시 폐기).
 *   렌더를 가로질러 살아남는 상태는 여전히 ref가 소유한다 — 여기에 옮기지 마라.
 */
export interface FinalCtx {
  /** 커밋 반응속도 계측 시점(A) → `commitLatencyMs` 산출(값 커밋). */
  readonly handleFinalAt: number;
  /** 실효 발화. `let`이었으나 실측상 재대입이 없다(주석의 redo 경로는 사문). */
  text: string;
  readonly alts: string[];
  readonly confidence: number;
  /** 🔴 유일한 가변 필드 — 명령 스테이지의 `demoteTrendConfirm` 강등이 여기 기록된다. */
  awaiting: AwaitingField;
  readonly cmd: VoiceCommand;
  /** 값 게이트가 채우고 **본체 셸이 되받아** 착지 인자로 넘긴다(그 셋만 실제 독자가 있다). */
  col?: Column | null;
  parsed?: string | null;
  lowConfParsedExtra?: string | null;
}

/** 수정 의미론 보유 여부 — 종전 `awaiting.isModify`(trendConfirm은 isModify를 겸장했다). */
function isModifyLike(a: AwaitingField): boolean {
  return a.kind === 'modify' || a.kind === 'trendConfirm';
}

/** 종전 `awaiting.previousValue` 접근(모드 무관 optional 읽기 지점용). */
function previousValueOf(a: AwaitingField): string | undefined {
  return a.kind === 'modify' || a.kind === 'trendConfirm' ? a.previousValue : undefined;
}

/** 🔴 v0.47.0-r2 P1(FB-A) — 알람 해소 후 **검토 대기 재진입** 예약(그 행 번호).
 *  검토 대기(reviewWait) 중의 직접 수정("수정 88.9")이 이상치 알람을 띄운 경우에만 선다.
 *  왜 필요한가: 알람 해소 경로는 전부 `advance()`로 끝나는데, v0.33.0 항목2는 *"검토 대기 출신
 *  커밋은 advance로 검토를 강제 종료하지 않는다"* 를 계약으로 못박았다(enterModifyMode 직접값
 *  분기의 `enterReviewWait` 복귀가 그 이행이다). 알람이 중간에 끼면 그 복귀 지점이 사라지므로
 *  대기 상태가 착지처를 들고 다닌다. **다른 경로는 이 필드를 세우지 않는다** — 세우지 않으면
 *  값이 undefined라 모든 기존 흐름이 종전대로 `advance()`로 간다(무해한 추가).
 *  `demoteTrendConfirm`('수정' 등 타 명령으로 강등)도 이 예약을 **보존**한다 — 강등 뒤 재커밋의
 *  착지 역시 검토 대기여야 한다. */
function resumeReviewOf(a: AwaitingField): number | undefined {
  return a.kind === 'modify' || a.kind === 'trendConfirm' ? a.resumeReview : undefined;
}

/** 🔴 v0.49 r2 A2(codex F1 = 합집합 C3) — 알람/재기록 뒤 **셀 검토 대기 재진입** 예약.
 *  `resumeReviewOf`와 같은 계약의 셀 축이다. 가드레일 [NAV-FILLED-CELL-1]은 *"cellWait에서의
 *  모든 탈출은 cellWait 재진입"* 을 불변식으로 못박았는데, 두 경로가 그 예약을 들고 다니지
 *  못해 새고 있었다: ⓐ bare '수정' 후 재기록(`announceField`가 modify로 재무장하며 출신을
 *  잃는다) ⓑ 그 상태에서 뜬 이상치 알람의 '확인'. 둘 다 종단에서 `advance()`로 빠져 사용자가
 *  **의도적으로 이동해 들어온** 검토 문맥이 증발했다.
 *  ⚠️ `resumeReview`와 동시에 서지 않는다 — 출신은 행(reviewWait) 아니면 셀(cellWait) 하나다. */
function resumeCellOf(a: AwaitingField): ResumeCell | undefined {
  return a.kind === 'modify' || a.kind === 'trendConfirm' ? a.resumeCell : undefined;
}

/** 종전 `awaiting.fractionWhole` 접근(모드 무관 optional 읽기 지점용). 추세확인 중 소수부 유실
 *  재질문(trendConfirm+fractionWhole)도 실측 도달 조합이라 포함한다. */
function fractionWholeOf(a: AwaitingField): string | undefined {
  return a.kind === 'value' || a.kind === 'modify' || a.kind === 'trendConfirm'
    ? a.fractionWhole
    : undefined;
}

/** trendConfirm → modify 강등(알림 해제, 수정 의미론 유지 — 종전 `trendConfirm=false` 변이와 동등).
 *  **fractionWhole을 반드시 보존한다** — 소수부 재질문 중 강등되면 정수부 문맥('111')이 유실돼
 *  다음 소수부 발화가 전체값으로 오커밋되던 회귀(v0.35.3 리뷰 r1, 3모델 공통 Critical/High).
 *  v0.47.0-r2 P1 — `resumeReview`(검토 대기 착지 예약)도 같은 이유로 보존한다.
 *  v0.49 r2 A2 — `resumeCell`(셀 검토 대기 착지 예약)도 같다. ⚠️ 이 시그니처는 trendConfirm
 *  모양을 **인라인으로** 적어 놨다 — 위 union만 넓히고 여기를 빠뜨리면 TS가 새 필드를 조용히
 *  떨어뜨린다(강등 경로에서만 복귀가 사라지는, 오라클 없으면 안 보이는 결함). */
function demoteTrendConfirm(a: AwaitingBase & { kind: 'trendConfirm'; previousValue: string; fractionWhole?: string; resumeReview?: number; resumeCell?: ResumeCell }): AwaitingField {
  return {
    kind: 'modify', row: a.row, colId: a.colId, name: a.name,
    previousValue: a.previousValue, fractionWhole: a.fractionWhole,
    ...(a.resumeReview != null ? { resumeReview: a.resumeReview } : {}),
    ...(a.resumeCell != null ? { resumeCell: a.resumeCell } : {}),
  };
}

/** 🔴 v0.47.0-r2 P2(FB-C) — 수동입력 이상치 보류 중 **음성이 차단됐을 때** 나가는 안내 문구.
 *
 *  ⚠️ **명령 어휘를 문구에 넣지 마라.** detectCommand는 공백을 지우고 `startsWith`로 맞추므로,
 *  이 발화가 재인식되면 문장이 **명령으로 실행된다.** 특히 `screenOff`의 word는 `'화면'`이라
 *  초안의 *"화면의 버튼을 눌러 주세요"* 는 검은 화면을 켤 수 있었다(실제로 위험한 조합 —
 *  민구는 화면이 꺼지면 「갇혔다」고 읽는다). 같은 이유로 「확인」·「수정」·「다음」·「이전」·
 *  「유지」·「종료」·「취소」도 금지다.
 *  현재 문구의 어절은 전량 대조했다 — 명령 16개 중 어느 것으로도 시작하지 않는다
 *  (검증 명령: `grep -n "word: '" src/lib/voiceCommands.ts`).
 *  「표시된 버튼」이라 부르는 이유: 민구는 폰을 2~3m 떨어뜨려 두므로(PRINCIPLES §2) *"가서
 *  화면을 봐야 한다"* 가 이 안내의 실질 내용이다. 버튼 이름을 말해 줘도 음성으로는 못 누른다. */
const MANUAL_HOLD_GUIDE_TTS = '알림은 터치로만 응답할 수 있습니다. 표시된 버튼을 눌러 주세요.';

/** v0.9.0 빠른 인식(조기확정): interim 숫자가 이 시간(ms) 동안 같은 값으로 안정되면 final을
 *  기다리지 않고 커밋한다. 짧을수록 빠르지만 미완성 숫자(소수점 추가 전) 절단 위험이 커진다. */
const EARLY_COMMIT_STABLE_MS = 400;

/** 빈/극소 클립 판정 임계(바이트) — webm/opus 컨테이너 헤더만 담긴 캡처가 이 이하로 온다.
 *  이하이면 저장하지 않고 clip_empty/clip_cmd_empty로 계측한다([CLIP-POINTER-1] 가드, 구 [CLIP-3]). */
/** pause()가 recorder dispose 전에 in-flight 클립 저장을 기다리는 상한(ms). 경로별 유예는
 *  의도적 차등 — stop() 5초(세션 종료, 최대 보존), 아카이브 flush 1.5초(백그라운드, UX 무영향). */
const PAUSE_FLUSH_GRACE_MS = 3000;

/** v0.44.0 §C8 F18(민구 확정 08-02) — 마이크 **승인 후 화면 전환까지의 정착 지연**(ms).
 *  민구 원문: "바로 음성 입력 화면 전환시 일부 초기 음성 클립 생성이 안됨" — 스트림이 실제로
 *  데이터를 흘리기 전에 세션이 시작되면 첫 클립이 비는 문제의 방어다(구 v0.25.0 WS-2 prewarm의
 *  첫 클립 유실 완화를 이 지연이 승계한다). 오라클: tests/v0440-c8-flow.spec.ts(1000ms 계약). */
const MIC_SETTLE_MS = 1000;
/** 🔴 v0.46.1 WP-1c(민구 지시 08-07) — 시작 준비 **단계 수**(진행바 분모).
 *  ①소리 출력 열기 ②마이크 권한·획득 ③음성 안내 확인 ④마이크 안정화.
 *  🔑 **고정 대기가 아니다** — 각 단계가 실제 확인이고, 빨리 끝나면 빨리 넘어간다.
 *  민구: *"3초뒤 화면 전환이 아닌, … 실제 마이크/스피커 입출력이 가능한지 확인하고."* */
const START_STEPS = 4;

/** v0.43.0 #4 — 백그라운드 복귀 안내 문구(plan §3-3, 민구 확정).
 *
 *  🔴 **중지 안내와 복귀 안내가 한 문장으로 합쳐져 있다.** iOS는 백그라운드 TTS를 막으므로
 *  `hidden` 진입 순간의 `say()`는 소리가 안 나거나 큐에 쌓였다가 복귀 때 터진다 — 실질적으로
 *  둘 다 복귀 시점에만 나갈 수 있다. 그래서 "중지됐다 + 다시 시작한다"를 한 번에 말한다. */
const BG_RESUME_MESSAGE = '자리를 비운 동안 입력이 중지됐습니다. 다시 시작합니다.';

/** #4 — **정확히 한 번만** 발화하는 `onStart` 핸들러를 만든다.
 *
 *  `SpeechController`의 `onStart`는 인식기 **인스턴스마다** 온다 — 워치독 재시작·EOS 후
 *  자동 재시작에서도 발화하므로(speech.ts가 매 `start` 이벤트에 건다), 클로저 안의 once
 *  가드가 없으면 백그라운드 복귀 뒤 **재시작할 때마다** 같은 안내를 반복한다.
 *
 *  v0.45.0 WP-3 (F14) — 안내 뒤에 **복귀 브리핑**(현재 행 요약 + 다음 항목)을 잇는다.
 *  브리핑 텍스트는 발화 **시점**에 만든다(getBriefing 클로저) — 복원 예약 시점의 낡은 행
 *  좌표를 읽지 않게. 안내는 "재개 성공"(onStart)에만 건다는 계약([MIC-B2])은 그대로다. */
function bgResumeAnnouncerOnce(
  // v0.48.1 U2 — say()가 Promise<boolean>을 돌려주도록 넓어졌다(started 신호). 이 자리는 반환값을
  // 안 쓰므로 시그니처만 맞춘다.
  say: (text: string, interrupt?: boolean) => Promise<boolean>,
  getBriefing: () => string | null,
): () => void {
  let announced = false;
  return () => {
    if (announced) return;
    announced = true;
    void say(BG_RESUME_MESSAGE, false)
      .then(() => {
        const briefing = getBriefing();
        if (briefing) void say(briefing, false);
      })
      .catch(() => {});
  };
}

export type VoiceTrackState = AudioTrackState | 'unknown';

export interface VoiceRuntimeSnapshot {
  rec: 'none' | 'idle' | 'recording';
  track: VoiceTrackState;
  stt: 'none' | 'idle' | 'listening' | 'suspended';
}

export function useVoiceSession() {
  const ctrlRef = useRef<SpeechController | null>(null);
  // F18 — start()의 마이크 획득+정착 대기 중 재클릭 가드. 그 창에서는 phase가 아직 'ready'라
  // '음성 입력 시작' 버튼이 살아 있어, 가드 없이는 start()가 이중 진입한다(세션 이중 생성).
  const startingRef = useRef(false);
  // 🔴 F18 리뷰 B1(v0.44.0 독립 리뷰, 실측 재현) — start()의 await 창(권한 프롬프트 무한 +
  // 정착 1초)에서 탭을 이탈하면 VoiceScreen이 언마운트되는데, 고아가 된 이 클로저가 계속
  // 실행돼 세션을 올리고 인식기·레코더를 **고아 인스턴스의 ref**에 만든다 — 리마운트된 새
  // 훅은 ctrlRef가 null이라 종료를 눌러도 abort가 0회(마이크·인식기 영구 생존). await 뒤에
  // 이 플래그를 재확인해 언마운트됐으면 중단한다. StrictMode의 모의 재마운트에서 ref가
  // 유지되므로 mount 시 false로 되돌리는 형태가 필수다.
  const disposedRef = useRef(false);
  useEffect(() => {
    disposedRef.current = false;
    return () => { disposedRef.current = true; };
  }, []);
  const sessionIdRef = useRef<string>('');
  const sessionLabelRef = useRef<string | undefined>(undefined);
  // 설정탭은 활성 세션 중에도 바뀔 수 있다. 목적지와 컬럼은 start()에서 함께 고정해 한 세션의
  // 자동값·음성값·sheetRow가 서로 다른 농가 설정과 섞이지 않게 한다.
  const sessionTargetRef = useRef<SessionTarget | null>(null);
  const sessionColumnsRef = useRef<Column[] | null>(null);
  const [sessionColumns, setSessionColumns] = useState<Column[] | null>(null);
  const awaitingFieldRef = useRef<AwaitingField | null>(null);
  const epochRef = useRef(0);
  /**
   * 🔴 v0.50 fixdc U1 / fixdc2 RD-1·RD-3 — **`epochRef`는 단조가 아니다.** 두 곳이 0으로
   * **리셋**한다: `start()`(새 세션) · `resume()`(일시정지 해제). 나머지 **17곳**은 전부 `++`다.
   * ⚠️ 이 수를 믿고 완전성을 판단하는 사람이 있으므로 **실측 절차를 남긴다**:
   * `grep -rn "epochRef.current++\|++epochRef.current" src/ \
   *   | grep -vE "^[^:]+:[0-9]+:[[:space:]]*(\*|//)"` → **17** (2026-08-19 실측).
   * 🔴 **필터 없이 세지 마라**: 이 주석 자신을 포함해 bump를 «인용»하는 주석이 여럿이라 히트가
   * 부풀고, 그 수는 주석이 늘 때마다 또 변한다(필터 없이는 21 — fixdc2 RE-3). 블록(`*`)과
   * 줄(`//`) 주석을 **둘 다** 걸러야 한다 — 한쪽만 거르면 19가 나온다(이 정정 자체의 1차 실패).
   * 결론 수치의 근거는 파일별 전수다:
   * `useRowNav` 3 · `useFieldNav` 2 · `useValueCommit` 1 · `useTrendGate` 4 ·
   * `useFinalCommands` 3 · `useVoiceSession` 3 · `useFinalValueGate` 1 = **17**.
   * (fixdc2 RD-5 — 종전 이 주석은 `14`였다. 그 수로는 조사가 빠진다.)
   *
   * 그 비대칭이 v0.50 C의 신규 착지 가드에서 **회귀**를 냈다(리뷰 양측이 서로 다른 진입로로
   * 독립 재현). 「낡은 착지인가」를 **값 하나의 차이**로만 재면 **정상 재개가 경합자로 잡힌다** —
   * 그리고 그 거절이 치명적인 이유는 **재개와 이동이 다르기 때문**이다:
   *   · `jumpToRow`류(bump 17곳)는 커서를 옮긴 뒤 **자기 착지로 `awaiting`을 새로 무장**한다.
   *     그래서 낡은 착지를 거절해도 상태가 빈 채로 남지 않는다 — 거절이 **옳다.**
   *   · `resume()`은 **epoch만 바꾸고 `awaiting`은 기존 것을 읽어 복원**한다. 거절하면 그 착지가
   *     갱신하려던 것이 통째로 유실되고, 재개가 **확정값이 든 셀을 다시 연다**
   *     (`[CELL-OVERWRITE-1]` 재개방 → 이어지는 발화가 확정값을 덮는다 = 값 손상).
   *
   * 🔴 **리셋 «값»은 여전히 건드리지 않는다** — `resetEpoch` 안의 `epochRef.current = 0` 한 줄이
   * 그대로 산다. 바뀐 것은 **리셋이 지우는 것을 잃지 않는다**는 점이다. 1회전 처방은 리셋을
   * 「기준선 교체」(기준선 ← 리셋 직후 값 0)로 다뤘는데, 그러면 **리셋 «이전»의 bump가 흔적 없이
   * 사라져** 「이동 → 재개」가 낡은 착지를 통과시켰다(fixdc2 RD-3(a) — #8이 닫으려던 「틀린 자리에
   * 맞는 값」의 재개방). 그래서 리셋이 버리는 bump를 **누계(`carried`)로 이월**한다:
   *   `landingMoves() = carried + epochRef.current` — **리셋을 건너 단조 증가**하는 소유권 이동 수.
   *
   * 🔴 누계«만»으로는 **음성 '재시작'이 즉시 깨진다**: `pausedResume`이 `epochRef.current++`를
   * **먼저** 하고 `resume('voice')`를 부르기 때문이다(`useFinalCommands.ts:294` · 명령 공통 bump
   * `:370` → `:440` — 둘 다 그 사이에 await가 없어 **정확히 1회**다). 그 자기 bump는 경합자가
   * 아니므로 리셋이 **흡수**한다(`ownBumps`). 즉 이 설계는 **순서(누계)와 출처(흡수·세션 배리어)를
   * 함께** 본다 — 어느 한쪽만으로는 판별력(bump 17곳 거절)과 U1 해소(재개 통과)를 **동시에**
   * 만족할 수 없다. 🔑 한쪽을 지우려는 사람은 그 둘이 서로를 대신하지 못한다는 것부터 확인해라.
   *
   * 🔴 `start()`는 **무조건 배리어**다(`sessionGen`). 새 세션이 시작됐는데 옛 세션의 착지가 살아
   * 돌면 `awaitingFieldRef`를 비워 **새 세션의 첫 셀 무장을 지운다**(입력 불능 — RD-3(b)).
   * 종전 값 비교는 `startEpoch === 0`인 창에서 그것을 오히려 통과시켰다.
   * ⚠️ `stop()`은 배리어가 **아니다** — `stop()` 뒤 `start()` 전의 창은 `advance`의 `stopping`
   * 진입 가드와 `armLanding`의 거절이 받는다(B 묶음이 `stop()`을 열 때 함께 볼 값).
   */
  const epochResetRef = useRef({ carried: 0, sessionGen: 0 });
  // 🔴 v0.48.1 r3 U1 4절 — interim barge-in이 일어난 시점의 epoch를 기록한다. speech.ts:353는
  //   TTS가 뮤트 중일 때 비어있지 않은 interim만 오면 즉시 cancel()하지만, epochRef는 건드리지
  //   않는다(final에서만 bump) — 그래서 알람 2차 발화 가드의 「epoch 불변」 절이 이 경로를 못
  //   잡는다(review-claude.md F1). `await say(alertText)` 뒤 isTtsMuted()를 다시 읽는 처방ⓐ
  //   원안은 채택하지 않았다 — done()이 resolve 직전에 무조건 unmuteForTts()부터 돌려서
  //   barge-in 여부와 무관하게 항상 false로 읽힌다(코드로 반증: speech.ts의 done() 참조).
  //   대신 barge-in이 실제 발생하는 이 시점(=아직 뮤트 중인데 interim이 들어온 순간)에서
  //   epoch 스냅샷을 남겨, 가드가 "이 alertText 재생 도중 barge-in이 있었는가"를 물을 수 있게 한다.
  const bargeInEpochRef = useRef(-1);
  const lastConfidenceRef = useRef<number>(1);
  // v0.9.0 딜레이 계측 — 마지막 interim(중간) 결과의 텍스트·도착시각. final 시 (final.ts − 이 시각)
  // = EOS 꼬리(브라우저 무음 종료감지 대기)를 정량화한다(stt_eos_tail).
  // §5-1 ②(v0.44.0) — confidence(엔진이 interim에 점수를 준 경우만) 추가: 빈 final barge-in의
  // stt_barge_in text/confidence 폴백 근거. 신규 필드는 optional — 기존 소비자(EOS 꼬리) 불변.
  const lastInterimRef = useRef<{ text: string; at: number; confidence?: number } | null>(null);
  // v0.9.0 빠른 인식(조기확정) — 같은 파싱값이 interim에서 안정되기 시작한 시각. 임계 시간 유지 시 커밋.
  const earlyCommitStableRef = useRef<{ value: string; since: number } | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const clipStartRowRef = useRef<number>(0);
  const clipStartColIdRef = useRef<string>('');
  // Codex MEDIUM-4: tracks the field whose recording clip is CURRENTLY active (set only after
  // startClip() actually runs at the end of announceField, cleared at commit-time stopClip).
  // Used to gate redo-inline ("다시 8.4") so it cannot commit before its clip has started
  // (i.e. while announceField's TTS prompt is still playing) — which would otherwise stop a
  // non-existent clip or let a cancelled announceField start an obsolete clip.
  const activeClipRef = useRef<{ row: number; colId: string } | null>(null);
  // [CLIP-WINDOW-1] UI suspend가 끊은 셀. 모달 전 조각은 저장하지 않고, 모든 중첩 UI가 닫힌 뒤
  // 여전히 같은 셀의 값을 기다릴 때만 새 녹음창을 연다(모달 대기 구간 splice/보존 금지).
  const uiSuspendedClipRef = useRef<{ row: number; colId: string } | null>(null);
  // [CLIP-WINDOW-2] suspend 중 arm 요청의 단일 보류 슬롯. 가장 최근 요청이 이전 활성 슬롯보다
  // 현재 awaiting에 가까운 의도이므로 resume에서 우선 소비하고, 세션 경계 clear에서는 폐기한다.
  const uiBlockedClipArmRef = useRef<{ row: number; colId: string } | null>(null);
  // rowIndex → colId → IDB key; accumulated in-memory until persistSession writes to dataStore
  const pendingClipsRef = useRef<Record<number, Record<string, string>>>({});
  // Snapshot of a persisted row being cascade-corrected; included in persistSession if stop()
  // fires before re-completion so original measurements are not lost.
  const correctionBackupRef = useRef<SessionRow | null>(null);
  // [CLIP-VAL-1]③ / [CLIP-POINTER-1] unlink race: tombstones for clip keys whose capture FAILED
  // (clip_empty / clip_too_small / clip_save_failed). persistSession builds its rows
  // synchronously BEFORE its first await, so an in-flight persist could re-persist a pointer
  // that unlinkClipPointer just removed (06-11 v0.6.0 row8 c7 — pointer resurrected in the
  // harvested sessions.json). Every audioClips merge consults this set, and persistSession
  // re-checks it AFTER its await, so a tombstoned key can never be re-persisted. A key is
  // cleared only when a NEW clip is successfully saved under it. Reset in start().
  const brokenClipKeysRef = useRef<Set<string>>(new Set());
  // v0.7.0 B4: trend_skip 원인별 1회 로깅(세션당) — 같은 원인(no_index 등)이 셀마다 반복
  // 로깅돼 텔레메트리를 도배하지 않게 한다. start()에서 리셋.
  const trendSkipLoggedRef = useRef<Set<string>>(new Set());
  // v0.47.0-r2 P2(FB-C) — 홀드 안내 TTS를 이미 낸 알람의 식별키. **알람 1건당 1회**의 저장소다
  //   (재안내 없음 · 알람이 바뀌면 리셋). clearAnomalyAlert가 null로 되돌린다.
  const holdGuideKeyRef = useRef<string | null>(null);
  // 세션 시작 시점의 로컬 오늘 ISO — evaluateTrend가 값 커밋마다 Date를 새로 만들지 않게
  // start()에서 1회 계산(현장 세션은 자정을 의미 있게 넘기지 않는다).
  const sessionTodayRef = useRef<string>('');
  // Ref to resume() — breaks the circular dependency between handleFinal and resume.
  // v0.20.0 Phase 5 #3 — resume이 해제 방식(source)을 받도록 시그니처 확장.
  const resumeRef = useRef<(source?: 'voice' | 'touch') => Promise<void>>(async () => {});
  // 🔴 [ENV-12] E단계(2026-08-15) — `resumeRef`와 **같은 매듭**을 stop/pause에도 푼다.
  //   handleFinal은 `stop(true)`(cmdEnd·pausedEnd)와 `pause('voice')`를 부르는데, 선언 순서는
  //   handleFinal → start → stop → pause다. 오늘 동작하는 이유는 handleFinal **본문**이 렌더
  //   이후에만 실행되고 dep 배열에도 그 둘이 없기 때문이다. 그러나 명령 구획을 서브 훅으로
  //   가르면 훅 호출부(= handleFinal 자리)의 주입 객체 리터럴이 **렌더 시점에 평가**되어
  //   첫 렌더에 `ReferenceError`가 난다. 순서를 바꿔 피할 수도 없다 — `start`의 dep 배열이
  //   `handleFinal`을 담으므로 handleFinal은 stop/pause보다 앞서야 한다(구조적 매듭).
  //   ⚠️ 동기화는 아래 `resumeRef` effect와 **같은 effect**에 둔다(실행 순서를 새 변수로
  //   만들지 않는다). 첫 STT final은 사용자 클릭 이후에만 도착하므로 채워짐이 보장된다.
  const stopRef = useRef<(announce?: boolean) => Promise<boolean>>(async () => false);
  const pauseRef = useRef<(source?: 'voice' | 'touch') => Promise<void>>(async () => {});
  // UI modal hard-suspend. This is deliberately narrower than pause(): it stops STT delivery
  // while a full-screen UI modal is open, but it does not change session phase or recorder state.
  // v0.37.0 리뷰(3모델 공통, 민구 인가) — **소스 집합(reference-count) 래치**. 종전 단일 boolean
  //   래치는 두 suspend 소스(예: 수동 시트 + 개선요청 모달)가 겹칠 때, 하나만 닫혀도 래치가 풀려
  //   나머지 오버레이 뒤에서 STT가 조기 재개됐다(데이터무결성). 이제 **모든 소스가 해제될 때만**
  //   실제 재개한다. active 여부는 reasons.size>0로 파생(별도 boolean 없음).
  // 🔴 v0.43.0 1c([TEST-CLIP-F-1] 판정) — **hadController의 의미가 넓어졌다.**
  //   종전: *"첫 suspend 시점에 인식기가 있었나"* (순수 스냅샷).
  //   현재: *"마지막 소스가 해제될 때 인식기를 복원해야 하나"* (복원 의무 플래그).
  //   첫 suspend 스냅샷이 기본값이지만, suspend가 걸린 동안 start()가 인식기를 만들려다
  //   :2541 가드에 막히면 **그 사실을 여기 true로 남긴다** — 그래야 resume이 복원한다.
  //   생존 범위는 종전과 동일: reasons가 비는 두 경로(resumeRecognitionForUi / clearUiSuspendLatch)가
  //   모두 false로 되돌리므로 세션 밖으로 새지 않는다.
  const uiSuspendRef = useRef<{ hadController: boolean; reasons: Set<string> }>({
    hadController: false,
    reasons: new Set<string>(),
  });
  /** v0.43.0 #4 — 백그라운드 복귀 안내가 **예약돼 있는가**(원샷).
   *  `suspendForBackground`가 **실제로 중지했을 때만** 세우고, `resumeRecognitionForUi`가 첫
   *  전이에서 소비한다. 이 플래그가 없으면 resume의 컨트롤러 생성부를 공유하는 다른 소스
   *  (`feedback_modal`·`manual_input`·`command_help`·`exit_confirm`)에서도 안내가 나간다. */
  const bgAnnouncePendingRef = useRef(false);
  /** v0.45.0 WP-2 [D1] — 세션-활성 게이트가 hidden에 유지한 사이클의 생존 관측(WP-1④ bg_keep).
   *  hidden 진입(유지 선택) 시 세우고, 복귀 또는 임계 도달에서 요약 1건으로 소비한다. */
  const bgKeepRef = useRef<{ hiddenAt: number; finals: number } | null>(null);
  /** WP-2 — 장기 임계(10분) 타이머. hidden(유지) 진입에 무장, 복귀·세션 종료·발화 시 해제.
   *  iOS가 페이지를 얼리면 안 울릴 수 있다 — 그 경우 복귀 경로의 경과시간 검사가 받는다. */
  const bgOffTimerRef = useRef<number | null>(null);
  /** 🔴 v0.45.0 리뷰 C1(critical) — 임계 정지 시퀀스의 **세대 가드.** applyBackgroundOff의 await
   *  사슬(고지 TTS 최대 10초 워치독 + 알림 + flush 3초 + persist) 도중 사용자가 복귀하면 —
   *  기기 알림 문구가 정확히 그 복귀를 유도한다 — 잔여 continuation이 **포그라운드 활성 세션**에서
   *  STT를 정지하고 레코더를 dispose했다(조용한 입력 사망, 경보 전무). 복귀·세션 경계마다 세대를
   *  올리고, 시퀀스는 파괴적 단계 직전마다 세대·가시성을 재검사해 어긋나면 중단한다. */
  const bgOffGenRef = useRef(0);
  // v0.22.0 P0 — 클립 레코더 스트림이 실제로 죽었을 때만 true. v0.38.0 #5는 이 전이에서 기존
  // reconnectMic→recoverStream 경로를 자동으로 딱 1회 호출하고, 실패했을 때만 수동 배너를 노출한다.
  const [micLost, setMicLost] = useState(false);
  const [micReconnectFallbackVisible, setMicReconnectFallbackVisible] = useState(false);
  const micAutoReconnectAttemptedRef = useRef(false);
  const micReconnectInFlightRef = useRef<Promise<boolean> | null>(null);
  // v0.38.0 #4-③ — 파서/세션 액션을 UI 세부 구현과 결합하지 않고, 최종 명령 1건을 표현 계층에
  // 단조 seq로 전달한다. ActiveState/Steppers가 각자 담당 버튼과 동일 콜백을 정확히 1회 실행한다.
  const uiCommandSeqRef = useRef(0);
  const [uiCommand, setUiCommand] = useState<VoiceUiCommandSignal | null>(null);
  // clip_empty 자동 재시도 once 가드(세션당). 스트림이 죽어 micLost로 전환되면 더 이상 자동
  // recoverStream을 부르지 않는다(제스처 밖이라 어차피 실패). start()에서 리셋.
  const micLostLatchedRef = useRef(false);
  // v0.50 [CLIP-SILENT-1] — 클립 건강도 장부(연속 실패 카운터 + 세션 결산). 무음 트랙은
  // `isStreamLost()`로 안 잡히므로(트랙이 `ended`가 아니다) **결과**로 판정한다. start()에서 리셋,
  // stop()에서 결산 1건. 근거·임계 근거는 clipHealth.ts 헤더.
  const clipHealthRef = useRef<ClipHealth>(createClipHealth());
  /** v0.50 r2 [CF-2·CF-4] — 클립 연속 실패 고지 요청(세션당 1회 상승). `useClipFailureAlert`가 소비. */
  const [clipFailAlert, setClipFailAlert] = useState(false);
  /** React state가 아닌 순수 정책 상태 — 복귀 이벤트가 phase와 무관하게 hiddenAt을 소비한다. */
  const foregroundReturnRef = useRef<ForegroundReturnState>(INITIAL_FOREGROUND_RETURN_STATE);

  // ── helpers ────────────────────────────────────────────────
  const getTtsRate = () => useSettingsStore.getState().ttsRate || 1.05;
  const getSessionColumns = (): Column[] =>
    sessionColumnsRef.current ?? useSettingsStore.getState().columns;
  /** 🔴 v0.50 fixdc U1 — `epochRef` 리셋의 **단일 소유자**. 리셋 지점이 둘(`start`·`resume`)이라
   *  사본을 만들지 않는다(Z2의 교훈: 사본을 늘리는 대신 소유자를 하나 만든다).
   *  리셋 «값»은 **바꾸지 않는다** — 리셋이 지우는 bump를 `carried`로 이월할 뿐이다(그 헤더).
   *  @param ownBumps 이 리셋 «자신»이 만든 bump 수. `pausedResume`의 선행 `++`가 그것이며,
   *    경합자가 아니므로 누계에서 뺀다(fixdc2 RD-3). ⚠️ `Math.max(0, …)`은 방어다: 흡수가 실제
   *    bump보다 크면 누계가 **줄어** 낡은 착지가 뒤늦은 진짜 bump와 상쇄돼 통과한다 —
   *    이 가드의 근거는 `landingMoves()`의 **단조성**이므로 그것부터 깨진다.
   *  @param newSession 세션 경계(`start`). 옛 세션의 착지는 값과 무관하게 거절한다(RD-3(b)). */
  const resetEpoch = (opts?: { ownBumps?: number; newSession?: boolean }): void => {
    const prev = epochResetRef.current;
    epochResetRef.current = {
      carried: prev.carried + Math.max(0, epochRef.current - (opts?.ownBumps ?? 0)),
      sessionGen: prev.sessionGen + (opts?.newSession ? 1 : 0),
    };
    epochRef.current = 0;
  };
  /** 착지 소유권을 남에게 넘긴 **이동의 누계**. 리셋이 `epochRef`를 0으로 되돌려도 여기 남는다 —
   *  「내 스냅샷 이후 이동이 있었는가」가 리셋을 건너 판정 가능해지는 것이 이 값의 존재 이유다. */
  const landingMoves = (): number => epochResetRef.current.carried + epochRef.current;
  /** 착지 가드의 진입 스냅샷. `epochRef` 값 하나로는 재개를 이동과 구별할 수 없다(그 헤더). */
  const snapLandingEpoch = (): { moves: number; sessionGen: number } =>
    ({ moves: landingMoves(), sessionGen: epochResetRef.current.sessionGen });
  /** 스냅샷이 아직 「이 착지의 것」인가. 🔑 **판별력과 U1 해소를 동시에** 만족한다:
   *  · bump 17곳은 누계를 올리므로 여전히 거절된다 — **뒤따라 리셋이 와도 지워지지 않는다**(RD-3a).
   *  · 재개는 자기 bump가 흡수돼 누계가 불변이라 통과한다(U1 — 터치·음성 두 경로 모두).
   *  · 세션 경계(`start`)는 값과 무관한 배리어다(RD-3b).
   *  오라클: v050-c48-landing-bypass ③(거절) · ④⑥⑦(통과) · ⑨(advance 안의 리셋) · ⑪(bump 뒤 리셋). */
  const landingEpochHeld = (snap: { moves: number; sessionGen: number }): boolean =>
    landingMoves() === snap.moves && epochResetRef.current.sessionGen === snap.sessionGen;
  /** v0.35.3 Stage 3-4 — 세션 컨텍스트 로거. 이 훅의 모든 계측은 현재 세션 id를 동봉하므로
   *  sessionId 고정 인자를 여기서 1회 주입한다. 나머지 필드(extra 문자열 포함)는 호출부 그대로
   *  전개 — SOP-003 파서 계약 불변. */
  const logCell = (entry: Omit<Parameters<typeof logger.log>[0], 'sessionId'>): void => {
    logger.log({ sessionId: sessionIdRef.current, ...entry } as Parameters<typeof logger.log>[0]);
  };
  const clearAnomalyAlert = useCallback((reason: string) => {
    const sess = useSessionStore.getState();
    const alert = sess.anomalyAlert;
    if (!alert) return;
    // 신규 음성 알람은 아래 발화 지점에서 colId를 직접 싣고, 수동 알람도 이미 colId를 가진다.
    // 그래도 공통 코어/구버전 형태처럼 optional인 객체를 받을 수 있으므로, 알람을 해제하기 **전**
    // 아직 같은 셀을 가리키는 awaiting(row+name 일치)을 신뢰 가능한 1차 폴백으로 쓴다.
    // awaiting이 이미 바뀐 방어 상황에서는 세션 컬럼의 이름 역인덱스로 마지막 폴백한다.
    const awaiting = awaitingFieldRef.current;
    const colId = alert.colId
      ?? (
        awaiting?.row === alert.row && awaiting.name === alert.colName
          ? awaiting.colId
          : undefined
      )
      ?? getSessionColumns().find((col) => col.name === alert.colName)?.id;
    logCell({
      type: 'trend',
      extra: anomalyAlertCleared({
        reason,
        hadStatus: alert.status ?? 'pending',
      }),
      row: alert.row,
      ...(colId ? { colId } : {}),
    });
    sess.setAnomalyAlert(null);
    // v0.47.0-r2 P2 — 알람이 내려갔으니 홀드 안내 1회 제한도 푼다(다음 알람은 다시 안내받는다).
    holdGuideKeyRef.current = null;
  }, []);
  // v0.48.1 U2(리뷰 codex medium) — 반환값을 `Promise<boolean>`으로 넓혔다(기존 호출부 전부
  // `await say(...)`로 반환값을 무시하므로 하위호환). `started`는 `speak()`의 `onStart`가 실제로
  // 불렸는지(watchdog(`speech.ts:646`)이 onstart조차 못 받고 2.5초 뒤 대신 resolve했으면 false)다.
  // P4의 두 번째 발화(:1298/:2562 부근) 직전 이 값을 확인해, **1차 발화가 시작도 못 한 경우** 2차를
  // 생략한다 — 원래 watchdog 2.5초 피해가 두 발화 직렬이라 5초로 배증하던 것(U2)을 막는다.
  // ⚠️ **부분 커버리지다.** onstart는 왔는데 onend/onerror가 안 와서 watchdog이 구제한 경우
  // (`started`=true)까지는 못 잡는다 — `speak()`가 그 두 실패 모드를 구분해 반환하려면 반환값
  // 자체를 enum으로 바꿔야 하고, 그건 `speech.ts` 계약 변경(이번 라운드 범위 밖, union U2 처방
  // "speech.ts 대수술은 범위 밖"). 잔여 축(started-but-no-onend)은 실기기 관측 항목으로 남긴다.
  // TODO(v0.49, review-codex.md 미해소2) — `started` 하나로는 못 가르는 잔여 두 갈래가 남는다:
  //   (a) onstart 후 onend/onerror 둘 다 소실 → 1차도 watchdog 2.5s를 다 쓰고 `started=true`로
  //       빠져나와 2차도 자기 watchdog을 또 써 총 ~5s(U2가 막은 건 "1차가 onstart조차 못 받은"
  //       경우뿐). (b) onstart 후 onerror(실패) → `started=true`라 "성공"처럼 보여 불필요한
  //       2차 발화를 시도한다. 둘 다 `speak()`가 `spoken | error | watchdog-unstarted |
  //       watchdog-started` 같은 완료 상태를 반환해야 풀린다 — `Promise<boolean>` 계약 자체를
  //       enum으로 넓히는 `speech.ts` 변경이라 이번 r3(소수정) 범위 밖. v0.49 이월.
  //   (c) 같은 갈래의 파생 — codex 재검증 잔여 ③: P4 2차 발화(`인식값 ...`)의 `interrupt:true`
  //       cancel()+50ms 대기는 가드 재확인 없이 지나가는 창이라 `interrupt:false`로 없애는 안을
  //       검토했지만, (a)에서 `done()`이 watchdog으로 resolve될 때 `synth.cancel()`을 호출하지
  //       않는다(`speech.ts` `done()` 참조) — 즉 (a)가 벌어진 채 여기 도달하면 1차 utterance가
  //       여전히 살아있을 수 있고, 그 상태의 `interrupt:false`는 2차를 큐잉시켜 뮤트 구간을
  //       늘린다(C-FIX4가 기각한 "큐잉이 뮤트 해제 창을 연다" 부류, WP-1이 줄이려던 마비와 동종).
  //       (a)/(b)와 같은 완료상태 enum이 있어야 "1차가 정상 종료했다"를 안전하게 전제할 수
  //       있으므로 별도로 풀지 않고 여기 합류시킨다 — 그때까지 두 발화 모두 `interrupt:true` 유지.
  const say = useCallback(async (text: string, interrupt = true): Promise<boolean> => {
    if (!text) return false;
    const ttsStart = Date.now();
    let startDelayMs: number | null = null;
    await speak(text, {
      interrupt,
      rate: getTtsRate(),
      onStart: (d) => { startDelayMs = d; },
    });
    logCell({
      type: 'tts',
      ttsText: text,
      durationMs: Date.now() - ttsStart,
      startDelayMs,
      row: useSessionStore.getState().activeRow,
    });
    return startDelayMs !== null;
  }, []);

  const getColById = (id: string): Column | null =>
    getSessionColumns().find((c) => c.id === id) || null;

  const voiceColsList = (): Column[] =>
    getSessionColumns().filter((c) => c.input === 'voice');

  /** v0.34.0 리뷰(민구 결정 2026-07-14 = 수동입력 이상치 보류는 **터치 [확인]/[수정] 전용**) —
   *  manualHold 팝업이 떠 있는 동안 **보류를 해소하지 않는 모든 동작을 중앙에서 거부**하는 단일
   *  게이트(SSOT). 라운드1에선 STT만 막았는데 터치 [이전]/[다음]/[일시정지]가 그대로 열려 있어
   *  미확인 이상치를 우회할 수 있었다(Codex 라운드2 High: announceField/PausedCard가 알람을 지워
   *  검증 절차 자체가 소멸). 해소 경로는 confirmManualAnomaly/modifyManualAnomaly 둘뿐이다.
   *  `reason`은 무엇이 막혔는지 다음 로그 분석에서 보이게 한다(막힌 시도가 잦으면 UX 재고 신호).
   *
   *  🔴 v0.47.0-r2 P2(FB-C · 민구 실기기 08-09) — **차단은 유지하되 「들리게」 한다.**
   *  위 주석이 예고한 *"막힌 시도가 잦으면 UX 재고 신호"* 가 실제로 왔다: 08-09 홀드 중 민구가
   *  「확인」×6·「100」×3·「일시 정지」×3을 말했고 **12건 전부 무음 차단**됐다. 07-14 결정
   *  (터치 전용)은 옳았지만 그 대가가 «앱이 죽은 것처럼 보이는» 상태였다 — 민구는 TTS 고장으로
   *  읽었다. 결정은 **뒤집지 않고**(민구 확정 08-09) 차단 사실만 발화한다.
   *
   *  ⚠️ `reason === 'stt'`로 좁힌다. 홀드 중 **음성** 명령은 handleFinal 선두의 STT 게이트에서
   *  먼저 잘리므로 `prev`/`next`/`pause` 차단은 사실상 **터치 전용**이다(실측 12건 전부 stt).
   *  터치까지 포함시키면 「알람 1건당 1회」라는 희소한 슬롯을 오탭이 먼저 소모해, 정작 말을 건
   *  사용자가 무음을 받는다. 👉 터치 차단은 여전히 무음이다 — 필요하면 별건으로 잡는다.
   *
   *  🔑 **1회 제한은 스팸 방지가 아니라 루프 차단이다.** speech.ts는 TTS 재생 중에도 final을
   *  handleFinal까지 올린다 — 이 안내 발화 자체가 재인식돼 다시 여기로 들어올 수 있다. 키가
   *  같으면 재발화하지 않으므로 그 지점에서 루프가 끊긴다. *"3번에 1번씩 안내"* 같은 완화는
   *  이 루프를 되연다 — 바꾸려면 재인식 축을 먼저 막아라. */
  const isManualHoldBlocked = (reason: string): boolean => {
    const alert = useSessionStore.getState().anomalyAlert;
    if (!alert?.manualHold) return false;
    logCell({
      type: 'command',
      extra: `blocked:manual_hold:${reason}`,
      row: useSessionStore.getState().activeRow,
    });
    if (reason === 'stt') {
      // 알람 식별키 — 같은 셀이라도 후보값이 바뀌면(=[수정] 후 재위반) 새 알람이라 재안내한다.
      const key = `${alert.row}:${alert.colId ?? alert.colName}:${alert.prev}->${alert.next}`;
      if (holdGuideKeyRef.current !== key) {
        holdGuideKeyRef.current = key;
        logCell({
          type: 'command',
          extra: manualHoldGuide('stt'),
          row: alert.row,
          ...(alert.colId ? { colId: alert.colId } : {}),
        });
        useSessionStore.getState().setLastTts(MANUAL_HOLD_GUIDE_TTS);
        // 게이트는 동기 함수다(터치 이동·일시정지도 같은 함수로 거부한다) — 발화는 비대기로
        //   띄운다. interrupt는 say의 기본값 그대로 true다: 사용자가 이미 말을 겹쳐 온 시점이라
        //   재생 중인 앞 발화를 자르는 편이 맞고, 큐잉(interrupt=false)은 앞 발화 종료가 뮤트를
        //   먼저 풀어 이 문장이 STT로 들어가는 경로를 연다(V-FIX1ⓒ가 홀드 안내에서 실측한 함정).
        void say(MANUAL_HOLD_GUIDE_TTS);
      }
    }
    return true;
  };

  // ── clip preservation ──────────────────────────────────────
  // [ENV-12] Stage 3 — 캡처 장부(재시도·명령 인덱스, in-flight 저장 집합)는 useClipCapture가
  // 소유한다. 세션 컨텍스트만 getter/callback으로 넘긴다(훅이 이 파일의 ref를 직접 보지 않게).
  const clipCapture = useClipCapture({
    getSessionId: () => sessionIdRef.current,
    getRecorder: () => recorderRef.current,
    logCell,
    onCommandClipDetached: () => { activeClipRef.current = null; },
  });
  const { archiveCellClip, preserveCommandClip } = clipCapture;

  const isRowVoiceComplete = (row: number, vCols: Column[]): boolean => {
    if (useSessionStore.getState().isRowComplete(row)) return true;
    const values = useSessionStore.getState().getRowValues(row);
    return vCols.every((c) => {
      const v = values[c.id];
      return v !== undefined && v !== '';
    });
  };

  const firstIncompleteColIdx = (row: number, vCols: Column[]): number => {
    const values = useSessionStore.getState().getRowValues(row);
    for (let i = 0; i < vCols.length; i++) {
      const v = values[vCols[i].id];
      if (v === undefined || v === '') return i;
    }
    return 0;
  };

  // v0.5.0 NAV-1: 단방향 진행 — wrap-around 2차 루프(위쪽 빈 행으로 되돌아가던 탐색) 제거.
  // 행 완료(advance)는 아래 방향으로만 전진하고, 건너뛴 행은 complete:false placeholder로 남아
  // 데이터탭(EditableCell 터치 편집)에서 채운다.
  // ⚠️ v0.44.0 §C8 F13 — '다음'(goNextRow)은 더 이상 이 탐색을 쓰지 않는다(항상 +1 이동).
  //   이 함수의 소비자는 advance()의 행 완료 자동 전진뿐이다.
  const findNextIncompleteRow = (start: number, total: number, vCols: Column[]): number | null => {
    for (let r = start; r <= total; r++) {
      if (!isRowVoiceComplete(r, vCols)) return r;
    }
    return null;
  };

  // ── persistence ────────────────────────────────────────────
  // [ENV-12] Stage 3 서브 훅 #2 — 세션 영속화(persistSession)는 usePersistSession이 소유한다
  // (이 파일은 호출만). 세션 컨텍스트는 getter/callback으로 넘긴다(훅이 이 파일의 ref를 직접
  // 보지 않게 — useClipCapture와 동일 계약).
  const { persistSession } = usePersistSession({
    getSessionId: () => sessionIdRef.current,
    getSessionColumns,
    getCorrectionBackup: () => correctionBackupRef.current,
    getPendingClips: () => pendingClipsRef.current,
    getBrokenClipKeys: () => brokenClipKeysRef.current,
    getSessionTarget: () => sessionTargetRef.current,
    getSessionLabel: () => sessionLabelRef.current,
    getSessionToday: () => sessionTodayRef.current,
    composeRowValues,
    localTodayISO,
  });

  // ── announcements ──────────────────────────────────────────
  // [ENV-12] Stage 3 서브 훅 #6 — 안내 구획(행 전환·행 완료 낭독 · 복귀·재시작 브리핑 · 클립 슬롯
  // 무장 armClipForCell · 착지 리셋 소유자 armLanding · 항목 안내 announceField)은
  // useAnnouncements가 소유한다(이 파일은 호출만). 세션 컨텍스트는 주입으로 넘긴다.
  // ⚠️ awaitingFieldRef·클립 슬롯 4종·uiSuspendRef는 의도된 ref 주입이다(useAnnouncements.ts 헤더).
  const {
    announceRowDiff, announceRowComplete, buildReturnBriefing, armClipForCell, armLanding,
    announceField,
  } = useAnnouncements({
    logCell,
    say,
    clearAnomalyAlert,
    getSessionColumns,
    voiceColsList,
    getRecorder: () => recorderRef.current,
    uiSuspendRef,
    uiBlockedClipArmRef,
    clipStartRowRef,
    clipStartColIdRef,
    activeClipRef,
    awaitingFieldRef,
  });

  // ── end-of-table (v0.5.0 NAV-1 / 요청3) ────────────────────
  // [ENV-12] Stage 3 서브 훅 #3 — 행 이동 계열(end-of-table 착지 계열·jumpToRow·gotoAdjacentRow·
  // goNextRow — 구 jump/F13 구획 포함)은 useRowNav가 소유한다(이 파일은 호출만). 세션 컨텍스트는
  // 주입으로 넘긴다. ⚠️ awaitingFieldRef·epochRef는 의도된 ref 주입이다(useRowNav.ts 헤더 참조).
  const {
    formatRowList, listEmptyRows, buildEndReachedTts, announceEndReached, enterReviewWait,
    enterCellWait, announceOrCellWait, notifyCellPersistFailed, notifyRowPersistFailed,
    jumpToRow, gotoAdjacentRow, goNextRow,
  } = useRowNav({
    logCell,
    say,
    armLanding,
    announceField,
    announceRowDiff,
    persistSession,
    getSessionColumns,
    voiceColsList,
    isRowVoiceComplete,
    firstIncompleteColIdx,
    isManualHoldBlocked,
    awaitingFieldRef,
    epochRef,
  });

  // ── progression ────────────────────────────────────────────
  /** 🔴 v0.49 r3 #1(claude r2 크리티컬) — **행 완료 부기**(완료 마킹 · 정정 백업 해제 · 영속화).
   *  종전엔 `advance()` 안에만 있었다. 그 자리에서 뽑아낸 이유가 곧 이 결함이다: A2가 커밋
   *  종단에 「예약 복귀」 착지(cellWait/reviewWait 재무장)를 추가하면서 그 경로들이 `advance()`를
   *  **타지 않고 return**하는데, 부기가 advance 안에만 있어 통째로 건너뛰어졌다.
   *
   *  피해는 **값 되돌림**이다. 캐스케이드 정정(`enterModifyMode`)은 정정 **이전**의 행 스냅샷을
   *  `correctionBackupRef`에 세우고 `markRowIncomplete`한다. 부기가 안 돌면 그 백업이 살아남고,
   *  다음 `persistSession`이 :636에서 그 낡은 행(complete:true·syncState:'synced')을 rows에
   *  push한다 — completedRows에 없는 행이라 조건이 그대로 성립한다. 그 push는 :639의
   *  `!rows.some(...)` 때문에 **신선한 buildRow(activeRow)를 밀어낸다.** 결과: 수정값은
   *  메모리에만 살고 IDB에는 옛값이 남아 리로드 시 복원되고, 'synced'가 유지되므로 시트도
   *  교정되지 않으며, 완료 마킹이 없어 X/N이 하나 줄어든 채 굳는다.
   *
   *  ⚠️ 낭독(`announceRowComplete`)과 phase 전이는 **여기 넣지 않는다** — 그건 착지마다 다르다.
   *  셀 검토 복귀는 "N행 완료됨"이 아니라 "…기록값 …"을 말해야 한다(enterCellWait 헤더의 문구
   *  계약). 이 함수가 다루는 것은 «내구성»뿐이고, «무엇을 말하는가»는 호출부가 정한다.
   *
   *  🔴🔴 v0.49 r6 Y1(codex R5-F1 Critical, 동적 재현 확증) — **`void persistSession()`이 실패를
   *  삼켰다.** 이 부기가 세션의 **첫** IDB 쓰기가 되는 형상(= 아직 durable 세션이 없다)에서는
   *  여기가 실패해도 호출부는 결과를 받지 못해 완료 낭독·다음 행 전진·✓·화음을 그대로 냈다.
   *  실측(2026-08-14, fixr6): 실패 주입 뒤 음성으로 1행을 완주하면 **IDB 세션 0건**인데
   *  「조사나무 1 완료」가 나오고 2행으로 넘어갔다 — 리로드하면 두 값이 전부 사라진다.
   *  PRINCIPLES §1 「durable 실패를 삼키지 않는다」 정면 위반이고 피해는 **값 유실**이다.
   *  👉 durable 결과를 **반환**한다. «무엇을 말하는가»가 호출부 몫인 것처럼 «실패를 어떻게
   *     고지하는가»도 호출부 몫이다(`notifyRowPersistFailed` 참조).
   *  ⚠️ **no-op은 `true`다.** 미완료 행(가드)·이미 내구화된 부기(둘 다 거짓)는 «쓸 것이 없음»이지
   *     실패가 아니다 — `false`로 두면 `advance` 뒤 `proceedAfterCommit`의 멱등 재호출이
   *     **가짜 실패 배너**를 띄운다(수정이 결함보다 나빠지는 지점).
   *  ⚠️ 실패 시 **메모리 부기를 되돌린다.** 되돌리지 않으면 `wasComplete`가 참이 돼 재시도가
   *     no-op `true`로 통과한다 = IDB엔 아무것도 없는데 배너만 사라지는 **거짓 회복**. 백업도
   *     함께 복원한다 — 캐스케이드 원본 스냅샷을 지운 채 persist가 실패하면 원본이 영영 없다.
   *  오라클: tests/v049-r3-01-resume-persist.spec.ts · tests/v049-r6-y1-durable-commit.spec.ts */
  const finalizeRowCompletion = useCallback(async (row: number): Promise<boolean> => {
    const sess = useSessionStore.getState();
    if (!isRowVoiceComplete(row, voiceColsList())) return true;
    const backup = correctionBackupRef.current;
    const hadBackup = backup?.index === row;
    const wasComplete = sess.isRowComplete(row);
    if (hadBackup) correctionBackupRef.current = null;
    if (!wasComplete) sess.markRowComplete(row);
    // 실제로 부기가 바뀐 경우에만 쓴다 — 한 커밋에서 두 번(proceedAfterCommit 진입 + advance)
    // 불려도 IDB 쓰기는 1회다. 바뀐 게 없으면 직전 커밋의 persist가 이미 같은 스냅샷을
    // 내구화했으므로 여기서 또 쓰는 것은 순수 낭비다(현장 배터리 — PRINCIPLES §6).
    if (!hadBackup && wasComplete) return true;
    const durable = await persistSession();
    if (!durable) {
      if (!wasComplete) useSessionStore.getState().markRowIncomplete(row);
      if (hadBackup) correctionBackupRef.current = backup;
    }
    return durable;
  }, [persistSession]);

  /** Move to next voice col in current row, or finalize row + jump to next target. */
  const advance = useCallback(async () => {
    // 🔴 v0.50 fixdc2 RD-1(blocker) — **안내 뒤 재확인 셋도 이 스냅샷을 쓴다.** 종전엔 그 셋만
    //   `epochRef.current` 생값(`startEpoch`)을 비교했는데, 리셋이 이 함수 «안»에서 일어나면
    //   `0 !== startEpoch`가 되어 **정상 재개를 경합자로 잡았다.** 도달한다: 이 함수는 일시정지
    //   중에도 끝까지 돌고(`setLandingPhase`가 phase만 보류한다 — 오라클 ①이 `row_complete`와
    //   `next_row` 보류를 **둘 다** 남기는 것이 관통의 증명이다), 그 사이 「…완료.」 낭독은
    //   phase 게이트가 없는 **≈1.095초**(`commitManualValue`의 P-2 실측 인용 — 「행완료 1.095s」)라
    //   **행 완료마다 창이 열린다.** 피해는 갈린다 — **행 완료 낭독 뒤**의 트립은 커서를 완료 행에
    //   고착시켜 `[CELL-OVERWRITE-1]` 재개방을 **영구**로 만들고(회복 불가), 안내 뒤 둘(예약 복귀·
    //   다음 행)은 마지막 안내를 스킵한다.
    //   오라클: tests/v050-c48-landing-bypass.spec.ts ⑨.
    const landingSnap = snapLandingEpoch();
    const sess = useSessionStore.getState();
    // 리뷰 라운드1(Codex+Flash, 수용) — 필드/행 이동 시 미확정 interim 표시 정리(표시 전용).
    sess.setInterimValue(null);
    const vc = voiceColsList();
    const row = sess.activeRow;
    const total = computeTotalRows(getSessionColumns());

    // 🔴 v0.50 C #4(claude r2 #4) — **advance의 국면 전이도 `armLanding`의 일시정지 계약을 진다.**
    //   ⚠️ v0.50 fixdc U2 정정 — *"같은 계약을 진다"*는 **`stopping` 축에서는 사실이 아니다.**
    //     `armLanding`은 `stopping`에서 `false`를 돌려 **착지 전체를 거절**하고(R4-F2 — phase만
    //     막으면 awaiting·클립이 recorder dispose와 경쟁한다), 이 헬퍼는 **phase만 보류**한다 —
    //     `advance`의 나머지(커서 이동 · `awaitingFieldRef` null화 · TTS)는 그대로 간다.
    //     그래서 아래 진입 가드(`phase === 'stopping'`이면 즉시 return)가 **여전히 유일한 방어**다.
    //     🔴 **그 진입 가드를 지우지 마라** — 이 헬퍼가 대신 막아 주지 않는다.
    //     본체 정합화(착지 전체 거절로 맞출지)는 **B 묶음(#5·#6) 몫**이다: B가 `stop()`과
    //     `finalizeRowCompletion` 롤백을 다루므로 같은 자리를 두 번 열지 않는다.
    //   이 함수는 Z2가 모은 착지 넷의 호출부이면서 그 넷에 **속하지 않는 전이를 스스로 한다**
    //   (아래 4곳). 그래서 `armLanding`의 문을 안 지나고, 그 결과 **일시정지가 조용히 풀렸다**:
    //   일시정지 중 음성 칩을 탭해 수동 커밋하면 `proceedAfterCommit` → 여기 →
    //   `setPhase('complete')`/`setPhase('active')`가 `paused`를 덮는다. 그러면
    //   `resolveFinal`의 paused 방어(`pausedIgnore`)가 통째로 꺼져 **주변 발화가 값이 되고**,
    //   recorder는 `pause()`가 dispose한 채라(`resume()`만 재생성한다) **클립만 죽는다** —
    //   사용자는 「멈춰 있다」고 믿는 동안 값이 들어간다.
    //   🔑 형제 `jumpToRow`가 이미 이 계약을 지킨다(`useRowNav.ts` — *"'paused' 등 다른 phase는
    //     건드리지 않는다, 일시정지 해제는 `resume()`만의 소관"*). 그 모양을 그대로 쓴다.
    //   🔴 **allowlist다**(GL-004 [ORCH-25] — "무엇을 막을까"가 아니라 "무엇만 허용할까"). 「paused면
    //     막는다」로 적으면 await 구간에 `stop()`이 끼었을 때 `stopping` 위에 `active`를 쓴다.
    //   🔴 **막지 않는 것**: 값 커밋·내구성 부기·문맥 재무장(`awaiting`)·커서 이동·안내는 전부
    //     그대로 간다. 착지 **전체**를 거절하면 `awaiting`이 빈 채 남아 `resume`의 폴스루가
    //     [CELL-OVERWRITE-1]을 새 경로로 재개방한다(`armLanding` 헤더의 실측 · 오라클 z2 ②-b).
    //   ⚠️ 진입 스냅샷(`sess`)이 아니라 **매번 새로 읽는다**(zustand `set`은 새 객체를 만든다) —
    //     이 함수는 await 뒤에도 phase를 쓰고, `pause()`는 epoch를 올리지 않아 그 창은 아래
    //     epoch 가드에 안 잡힌다([LANDING-OWNER-1] *"둘 중 하나로 다른 하나를 대신할 수 없다"*).
    //   오라클: tests/v050-c48-landing-bypass.spec.ts
    const setLandingPhase = (next: 'active' | 'complete', reason: string): void => {
      const live = useSessionStore.getState();
      if (live.phase !== 'active' && live.phase !== 'complete') {
        logCell({ type: 'session', extra: `advance_phase_held:${live.phase}:${reason}`, row });
        return;
      }
      live.setPhase(next);
    };

    // 🔴 v0.49 r6 Y3(claude #3) — **종료 중에는 진행하지 않는다. 단 내구성 부기는 남긴다.**
    //   이 함수는 Z2가 모은 착지 넷의 호출부이면서, 그 넷에 **속하지 않는 전이를 스스로 한다**:
    //   아래 `sess.setPhase('complete')`(행 완료 표시)와 행 이동이 그것이다. 종료 중 커밋
    //   continuation이 여기 도달하면 `stopping`이 `complete`로 덮여 종료 절차의 상태 판정이
    //   무너지고, 완료 낭독이 종료 안내를 밀어낸다(R4-F2가 착지 축에서 닫은 그 형태).
    //   ⚠️ **부기까지 건너뛰면 안 된다** — 그러면 방금 커밋된 값이 완료 마킹 없이 남아
    //     `stop()`의 persist가 `complete:false`로 굳힌다(= sync가 영영 안 올린다). 종료 중에는
    //     셀 배너로 고지할 표면이 없으므로(화면이 StoppingState) durable 실패는 `stop()`의
    //     `persistError` 경로가 받는다 — 여기서는 `void`로 부기만 태운다.
    if (sess.phase === 'stopping') {
      if (isRowVoiceComplete(row, vc)) void finalizeRowCompletion(row);
      logCell({ type: 'session', extra: 'advance_refused:stopping', row });
      return;
    }

    // Still voice cols in this row?
    // (v0.33.0 백로그 A — v0.4.5 I3 "이전" 재입력 모드(isReentry) 폐지: 채워진 필드 스킵이 유일 경로.)
    const nextIdx = sess.activeColIdx + 1;
    if (nextIdx < vc.length) {
      const values = sess.getRowValues(row);
      let target = nextIdx;
      // Skip cols already filled with non-empty values (empty string = cleared by modify)
      while (target < vc.length) {
        const v = values[vc[target].id];
        if (v === undefined || v === '') break;
        target++;
      }
      if (target < vc.length) {
        sess.setActiveCol(target);
        sess.setRecognized('');
        await announceField(vc[target]);
        return;
      }
    }

    // All voice cols AFTER the pointer are filled — but that alone doesn't prove the row is
    // complete: the forward scan never looks at cols BEFORE the pointer.
    // 🔴 v0.47.0-r3 후속(codex r4 :968, Larry 확정 08-09) — 교차행 직접수정 알람은 포인터를 대상
    //   행 **마지막** 칸에 세우므로(:1273 부근), 대상이 skip 행이면 여기서 앞선 빈 칸을 안 보고
    //   markRowComplete가 돌아 **빈 측정값이 complete:true로 내구화**되고 skippedRows 표식까지
    //   지워졌다(markRowComplete가 skip을 제거한다 — 값 유실이 완료로 위장). cascade 변형(skip
    //   행 bare '수정' — 예약 없음, :1365)도 같은 구멍이었다. 미완료 행은 완료 처리 전체(마킹·
    //   persist·완료 낭독)를 건너뛰고, 아래 복귀 예약 소비/다음 행 탐색만 그대로 수행한다 —
    //   P1 알람 경로는 returnStack이 원 출발점을 들고 있으니 그 소비가 곧 복귀다.
    //   오라클: tests/v0470-r2-p1-direct-modify-trend.spec.ts 「P1-미완료대상」.
    if (isRowVoiceComplete(row, vc)) {
      // 🔴 v0.49 r3 #1 — 부기 3줄(백업 해제·완료 마킹·persist)은 `finalizeRowCompletion`으로
      //   옮겼다. 여기가 유일한 소유자였던 것이 결함의 근인이다(그 헤더 참조).
      // 🔴 v0.49 r6 Y1 — **완료 낭독보다 durable 판정이 먼저다.** 실패인 채로 아래를 진행하면
      //   「N행 완료」 + 다음 행 전진이 **유실될 값을 성공 고지**한다(실측: IDB 0건 + 「조사나무 1
      //   완료」). 낭독 뒤로 미루면 이미 귀에 들어간 뒤라 늦다.
      //   ⚠️ 실측 정정: 음성 커밋 종단은 `proceedAfterCommit`을 먼저 지나므로 **그쪽 라우팅이
      //     실제로 이 시나리오를 잡는다**(이 줄만 되돌리면 오라클 5건이 전부 green). 그럼에도
      //     남기는 이유는 `advance()`를 **직접** 부르는 경로가 실재하기 때문이다 — 예약이 없는
      //     상태의 '유지'(:2638)가 그것이고, 그 자리에서 행이 완성되면 여기가 유일한 방어다.
      if (!(await finalizeRowCompletion(row))) {
        // awaiting은 **여기서 비우지 않는다** — 아래 `awaitingFieldRef.current = null`(성공 경로)에
        //   닿기 전에 return하므로 이 경로의 소유자는 그대로 살아 있다(r7 #1의 보존 계약과 동일).
        notifyRowPersistFailed(row, awaitingFieldRef.current);
        return;
      }
      // 🔴 v0.50 C #8(claude r2 #8 "형제 창") — 재확인을 **파괴적 쓰기 앞으로** 당긴다.
      //   종전 순서는 `setPhase` → `awaitingFieldRef = null` → 안내 → **그제서야** epoch였다.
      //   그 사이 `jumpToRow`는 **첫 await 이전에** 커서 이동 + epoch bump를 동기로 끝내므로
      //   (`useRowNav.ts`), 느린 IDB 쓰기 중 barge-in이 들어오면 **방금 무장된 남의 awaiting을
      //   여기가 지운다** — 값도 소리도 없이 입력 불능이 되는 형상이다.
      //   ⚠️ 부기(`finalizeRowCompletion`)는 **이 위에서 이미 끝났다** — 좌표가 커밋된 행이라
      //     커서 경합과 무관하고, 건너뛰면 그 행이 `persistSession`의 rows에서 통째로 떨어진다(Z8).
      //   ⚠️ 아래 재확인은 **지우지 마라** — 저건 안내(`announceRowComplete`) 중의 barge-in을
      //     막는 별개 창이다. 두 창은 겹치지 않는다(fixdc2 RD-1로 같은 스냅샷을 쓰게 됐을 뿐이다).
      if (!landingEpochHeld(landingSnap)) return;
      setLandingPhase('complete', 'row_complete');
      awaitingFieldRef.current = null;
      await announceRowComplete(row);
      // 🔴 fixdc2 RD-1 — 여기가 **영구 피해**의 자리다: 트립하면 `awaiting`은 이미 null인데
      //   커서가 완료 행에 고착해 아무도 옮겨 주지 않는다(재개 폴스루가 그 확정 셀을 다시 연다).
      if (!landingEpochHeld(landingSnap)) return;
    }

    // If a return reservation is set (came from modify/jump), go back.
    // v0.5.0 NAV-1 이중 가드: 복귀 대상이 이미 완료된 행이면 복귀하지 않는다 — 완료 행을
    // 재프롬프트하며 같은 행으로 반복 복귀하던 루프의 2차 차단(1차는 goNextRow의 setReturn 제거).
    // v0.47.0-r3(codex f3) — 단일 returnRow → returnStack **최상단 1건 소비**(pop). 깊이 ≤1에서는
    // 종전(읽고 즉시 클리어)과 동작이 같고, P1 교차행 알람이 쌓은 중첩 예약(깊이 2)에서만
    // 안쪽 출발점이 먼저 나온다. 폴스루(완료 행 복귀 무시) 시에도 pop한 1건만 버려진다 —
    // 남은 바깥 예약은 다음 행 완료가 소비한다(종전 계약의 스택 일반화).
    const ret = sess.returnStack[sess.returnStack.length - 1] ?? null;
    if (ret != null && ret.row !== row) {
      sess.popReturn();
      if (!isRowVoiceComplete(ret.row, vc)) {
        const targetCol = ret.colIdx ?? firstIncompleteColIdx(ret.row, vc);
        sess.setActiveRow(ret.row);
        sess.setActiveCol(targetCol);
        sess.setRecognized('');
        setLandingPhase('active', 'return_landing');
        awaitingFieldRef.current = null;
        await announceRowDiff(row, ret.row);
        // 🔴 fixdc2 RD-1 — 트립하면 커서는 옮겨졌는데 마지막 안내가 스킵된다(아래 「다음 행」 형제와 동형).
        if (!landingEpochHeld(landingSnap)) return;
        // 🔴 v0.49 fix49b(max 리뷰 #3) — `ret.colIdx`는 `jumpToRow`가 **떠날 때의 activeColIdx**를
        //   그대로 적어 둔 것이다. F-1 이전엔 그 값이 언제나 빈 칸을 가리켰지만(기록자 전량이
        //   그랬다), 항목 이동이 커서를 **filled 셀에 주차**시킬 수 있게 되면서 예약에 채워진
        //   칸이 실린다 — 그대로 `announceField`를 부르면 B-1이 여기서 다시 열린다.
        if (vc[targetCol]) await announceOrCellWait(vc[targetCol]);
        return;
      }
      // 완료 행으로의 복귀는 무시하고 아래 '다음 미완료 행' 탐색으로 폴스루.
    }

    // Otherwise find next incomplete row (아래 방향만 — wrap-around 없음)
    const next = findNextIncompleteRow(row + 1, total, vc);
    if (next === null) {
      // 🔴 v0.49 r4 M2(claude r3 #1 — Larry 소스 확증) — **미완료 행에 선 채로 끝 도달을 선언하지
      //   않는다.** 이 지점의 두 스캔은 **둘 다 아래만 본다**: 위 전진 스캔은 포인터 **뒤** 칸만
      //   보고(:1160 자기 주석), `findNextIncompleteRow`는 `row + 1`부터 본다. 그래서 포인터
      //   **앞**에 빈 칸이 남은 행(항목 이동으로 빈 칸을 지나쳐 뒤 칸을 채운 경우)에서 아래에
      //   미완료 행이 없으면, 미완료 행에 선 채로 `announceEndReached`가 돌았다.
      //
      //   그 상태의 atEnd 센티넬은 `{row: activeRow(미완료), colId: 마지막 음성 컬럼}`이고,
      //   #2가 커서까지 거기 주차하므로 화면·센티넬이 **일치한 채로 함께 틀린다.** 이어지는
      //   bare '수정'은 `reviewTarget`이 서지 않아(:2382가 atEnd를 제외) 행 스코프로 지우는데,
      //   그 타깃이 사용자가 채워야 할 **빈 칸**이 아니라 **확정된 마지막 셀**이다 — 남은 일을
      //   가리키는 대신 끝낸 일을 지운다.
      //
      //   처방은 컬럼 축이 아니라 **도달 자체**를 막는 것이다(반대 방향은 [MODIFY-TARGET-1]
      //   재발 — :955 경고 참조). 남은 빈 칸으로 커서를 되돌린다. 루프는 없다: 여기 도달은
      //   값 커밋 뒤이고, 그 빈 칸이 채워지면 위 `isRowVoiceComplete` 가지가 행을 완료시킨다.
      //   👉 이로써 **atEnd는 완료된 행에서만 무장한다**가 구조적 불변식이 된다
      //   (`announceEndReached`의 유일한 호출부가 여기다).
      //   오라클: tests/v049-r4-m2-atend-incomplete.spec.ts
      if (!isRowVoiceComplete(row, vc)) {
        const gapIdx = firstIncompleteColIdx(row, vc);
        // 새 이름으로 계측한다(PRINCIPLES §4) — 이 전이는 `end_reached_waiting`을 **대체**하므로,
        //   같은 이름에 얹으면 끝 도달 집계가 조용히 부풀고 두 상태를 로그에서 못 가른다.
        logCell({
          type: 'session', extra: `row_gap_return:col=${vc[gapIdx].id}`,
          row, colId: vc[gapIdx].id,
        });
        sess.setActiveCol(gapIdx);
        sess.setRecognized('');
        setLandingPhase('active', 'row_gap_return');
        awaitingFieldRef.current = null;
        await announceField(vc[gapIdx]);
        return;
      }
      // v0.23.0 입력탭#4 — 자동 종료 제거. 안내 후 '종료' 명령/버튼까지 세션 유지.
      await announceEndReached();
      return;
    }

    sess.setActiveRow(next);
    const targetCol = firstIncompleteColIdx(next, vc);
    sess.setActiveCol(targetCol);
    sess.setRecognized('');
    setLandingPhase('active', 'next_row');
    awaitingFieldRef.current = null;
    await announceRowDiff(row, next);
    // 🔴 fixdc2 RD-1 — 위 예약 복귀 분기의 형제. 트립하면 항목 안내 없이 멈춘다.
    if (!landingEpochHeld(landingSnap)) return;
    if (vc[targetCol]) await announceField(vc[targetCol]);
  }, [announceField, announceOrCellWait, announceRowComplete, announceRowDiff, announceEndReached, finalizeRowCompletion, notifyRowPersistFailed, say]);

  /** v0.35.3 Stage 3-5 — 커밋 경로 진행 공용. 검토 대기(reviewWait) 출신 커밋은 검토 대기를
   *  재무장해 갱신값을 재낭독하고(advance로 검토를 강제 종료하지 않음 — v0.33.0 항목2 계약),
   *  그 외에는 대기를 해제하고 다음 셀로 진행한다. echoValue를 주면 advance 전에 값을 에코
   *  (수동 칩 커밋의 청각 확인 — 음성 커밋과 동일). 종전 commitManualValue·confirmManualAnomaly의
   *  이중 구현을 흡수(순수 이동 — epoch/cancelTts는 호출부가 커밋 확정 시점에 이미 수행). */
  const proceedAfterCommit = useCallback(async (
    awaiting: AwaitingField | null,
    opts?: { echoValue?: string },
  ) => {
    // 🔴 v0.50 C #8(claude r2 #8) — **진입 시점의 epoch를 잡아 둔다.** 이 함수 전체에 epoch
    //   참조가 한 줄도 없었다: 호출부(`useCommitLanding`)의 재확인은 **진입 직전 1회**이고,
    //   아래 awaited IDB 쓰기를 지난 뒤 모든 착지 분기는 호출 시점에 캡처된 `awaiting`을 그대로
    //   소비한다. 경합자는 실재한다 — `jumpToRow`가 **첫 await 이전에** 커서 이동 + epoch bump를
    //   동기로 끝낸다. 재확인 지점은 부기 **뒤**·착지 **앞**이다(그 사이 근거는 그 자리 주석).
    const landingSnap = snapLandingEpoch();
    // 🔴 v0.49 r3 #1(claude r2 크리티컬) — **행 완료 부기는 착지와 무관하다.** 아래 재무장/예약
    //   복귀 분기는 전부 `advance()`를 타지 않고 return하므로, 부기가 advance 안에만 있으면
    //   그 경로에서 통째로 빠진다(값 되돌림 — `finalizeRowCompletion` 헤더). 분기마다 배선하면
    //   **다음 착지가 추가될 때 또 빠진다** — A2가 착지를 하나 늘리자마자 정확히 그렇게 됐다.
    //   그래서 분기 앞 **진입점 한 곳**에서 한다. 좌표는 커밋된 셀의 행(`awaiting.row`)이지
    //   호출 시점의 activeRow가 아니다(교차행 정정은 둘이 갈린다). 부기는 멱등이라 아래
    //   폴스루가 advance로 가도 IDB 쓰기는 늘지 않는다.
    // 🔴 v0.49 r6 Y1 — 여기도 durable 실패면 착지 전체를 멈춘다. 아래 착지들은 「저장됐다」를
    //   전제로 갱신값을 재낭독하거나 다음 셀로 나가므로, 실패를 통과시키면 그 낭독이 곧
    //   성공 고지가 된다(C-FIX2가 수동 커밋에서 세운 「실패면 영수증·에코·진행 전부 억제」와 동일).
    // 🔴 v0.49 r7 #1(codex R6-F3 High) — **실패 시 흐름 소유자를 복원한다.** 음성 커밋 종단은
    //   이 함수를 부르기 **전에** `awaitingFieldRef.current = null`로 만든다(:handleFinal의 burst
    //   직후) — 커밋이 끝났다는 전제의 정리다. 그 전제가 깨진 게 이 분기다.
    //   실측(codex R6-F3, 2026-08-14): 음성으로 행을 완주시키고 put을 전부 실패시키면 배너가 서고,
    //   seam 해제 후 [다시 저장]을 눌러 IDB가 회복돼도 **awaiting이 null이라** 이어지는 숫자 발화가
    //   TTS 0·값 변화 0으로 **무음 흡수**됐다. 2~3m 거리의 음성 전용 사용자(PRINCIPLES §2)는
    //   성공/실패 어느 안내도 없이 입력 불능에 주차된다.
    //   👉 복원이 닫는 것은 둘이다: ①재시도 버튼의 `commitManualValue`가 `ownsFlow=true`를 얻어
    //      `proceedAfterCommit` 착지(행 완료 낭독·다음 행 전진)를 **원 흐름 그대로** 재개한다
    //      ②버튼에 손이 닿지 않아도 **같은 값을 다시 말하면** 커밋 경로 전체가 재시도가 된다.
    //   ⚠️ 형제 실패 분기들(`advance`의 부기 실패, `commitManualValue`의 두 durable 게이트)은
    //     애초에 이 ref를 비우기 전에 return하므로 이미 보존돼 있다 — 비우고 나서 실패를 아는
    //     경로가 여기 하나뿐이라 처방도 여기 하나다.
    //   ⚠️ ✓·값 에코·화음은 이미 나간 뒤다(음성 증분 persist가 fire-and-forget인 별개 축 —
    //     R6-F1, 선행 내구성 부채로 v0.50 라운드 몫). 이 수정은 **재시도 이후의 흐름**만 닫는다.
    //   오라클: tests/v049-r7-01-retry-landing.spec.ts
    if (awaiting && !(await finalizeRowCompletion(awaiting.row))) {
      awaitingFieldRef.current = awaiting;
      notifyRowPersistFailed(awaiting.row, awaiting);
      return;
    }
    // 🔴 v0.50 C #8 — **여기부터가 착지다. 낡은 예약은 착지하지 않는다.**
    //   위 부기까지는 좌표가 `awaiting.row`(커밋된 셀의 행)라 커서 경합과 무관하고, 건너뛰면
    //   값이 `persistSession`의 rows에서 통째로 떨어진다(Z8). 반면 아래 분기들은 전부 **커서·
    //   대기 상태를 쓴다** — 특히 예약 복귀 분기는 `setActiveRow`/`setActiveCol`로 커서를
    //   **명시로 끌어온다**. 그 사이 사용자가 행을 옮겼다면 사용자가 이미 떠난 셀로 되끌려
    //   **다음 값이 화면·귀와 다른 컬럼에 기록된다**(유실이 아니라 「틀린 자리에 맞는 값」이라
    //   사후 발견이 어렵다).
    //   🔴 **막는 것은 낡은 착지뿐이다** — 경합자가 없으면(epoch 동일) 아래는 종전과 완전히
    //     같은 경로다. 정상 착지를 막으면 [NAV-FILLED-CELL-1]의 「모든 탈출은 재진입」이 깨진다.
    //   ⚠️ 거절을 로그에 남긴다(형제 `advance_refused:stopping`·`jump_refused:stopping`과 같은
    //     계약) — 무음 return은 분석에서 「착지가 원래 없었다」와 구별되지 않는다.
    if (!landingEpochHeld(landingSnap)) {
      logCell({ type: 'session', extra: 'proceed_refused:epoch', row: awaiting?.row });
      return;
    }
    if (awaiting?.kind === 'reviewWait') {
      await enterReviewWait(awaiting.row);
      return;
    }
    // 🔴 v0.49 fix49b(max 리뷰 #7) — **셀 검토 대기도 재무장한다**(행 검토와 같은 계약, 스코프만
    //   셀). 사용자가 「이전」/「다음」으로 **의도적으로 이동해 들어온** 검토 문맥인데, 그 문맥이
    //   초대한 정정(키패드 재커밋·보류 해소)이 문맥 자체를 파괴하고 advance로 튀어 나가면
    //   검토가 성립하지 않는다. 음성 「수정 <값>」은 이미 cellWait으로 복귀한다(fix49 오라클 ⑤) —
    //   같은 상태·같은 목적의 조작이 입력 수단에 따라 갈리지 않게 한다.
    //   `enterCellWait`이 갱신값을 낭독하므로 echo는 넘기지 않는다(행 검토 분기와 동일 이유).
    if (awaiting?.kind === 'cellWait') {
      const col = getColById(awaiting.colId);
      const v = useSessionStore.getState().getRowValues(awaiting.row)[awaiting.colId] ?? '';
      if (col && v !== '') { await enterCellWait(col, v); return; }
    }
    // 🔴 v0.49 r2 A2 — **예약된 복귀는 여기 한 곳에서 판정한다.** 종전엔 알람 해소(:trendResolve)와
    //   커밋 종단(:handleFinal 말미)이 각자 `resumeReviewOf`를 읽고 직접 `advance()`를 불렀다 —
    //   가드레일 [NAV-FILLED-CELL-1]이 *"정본은 proceedAfterCommit이며 그 kind 분기를 우회해 직접
    //   advance()를 부르지 마라"* 고 못박은 바로 그 형태다(그래서 셀 축 예약이 추가됐을 때 두 곳
    //   모두에서 새로 빠뜨릴 수 있었다). 두 호출부가 이 함수를 부르게 하고 판정을 여기 모은다.
    if (awaiting) {
      const cell = resumeCellOf(awaiting);
      if (cell) {
        const col = getColById(cell.colId);
        const v = useSessionStore.getState().getRowValues(cell.row)[cell.colId] ?? '';
        if (col && v !== '') {
          // `enterCellWait`은 좌표를 받지 않고 `sess.activeRow`를 읽는다 — 이 진입로는 예약
          //   좌표로 들어오므로 커서를 **명시로** 세운다(호출 시점 커서가 맞다는 우연에 기대지 않는다).
          const idx = voiceColsList().findIndex((c) => c.id === cell.colId);
          useSessionStore.getState().setActiveRow(cell.row);
          if (idx >= 0) useSessionStore.getState().setActiveCol(idx);
          await enterCellWait(col, v);
          return;
        }
      }
      const resumeRow = resumeReviewOf(awaiting);
      if (resumeRow != null) { await enterReviewWait(resumeRow); return; }
    }
    awaitingFieldRef.current = null;
    if (opts?.echoValue != null) await say(formatForTts(opts.echoValue));
    await advance();
  }, [advance, enterCellWait, enterReviewWait, finalizeRowCompletion, notifyRowPersistFailed, say]);

  // ── v0.7.0 B4: 추세 검증 ───────────────────────────────────
  // [ENV-12] Stage 3 서브 훅 #5 — 추세 검증 계열(rejectValue 종단·evaluateTrend·식별정보)과
  // 이상치 응답 터치 4종(trendConfirm 2 · manualHold 2)은 useTrendGate가 소유한다(이 파일은
  // 호출만). 세션 컨텍스트는 주입으로 넘긴다. ⚠️ awaitingFieldRef·epochRef·trendSkipLoggedRef는
  // 의도된 ref 주입이다(useTrendGate.ts 헤더 참조).
  const {
    rejectValue, relistenInContext, evaluateTrend, getAnomalyAlertData,
    confirmAnomalyTouch, modifyAnomalyTouch, confirmManualAnomaly, modifyManualAnomaly,
  } = useTrendGate({
    logCell,
    say,
    armClipForCell,
    clearAnomalyAlert,
    proceedAfterCommit,
    finalizeRowCompletion,
    notifyRowPersistFailed,
    getSessionColumns,
    composeRowValues,
    localTodayISO,
    fractionWholeOf,
    isModifyLike,
    demoteTrendConfirm,
    getSessionToday: () => sessionTodayRef.current,
    getRecorder: () => recorderRef.current,
    getSessionId: () => sessionIdRef.current,
    trendSkipLoggedRef,
    awaitingFieldRef,
    epochRef,
  });

  // ── modify (cross-row) ─────────────────────────────────────
  const enterModifyMode = useCallback(async (
    preExtractedValue?: string,
    pendingCmd?: PendingCommandClip | null,
    // v0.34.0 A3(확정 규칙 — 실기기 피드백): 완료 행 "검토 대기"(reviewWait) 중의 '수정'은
    // **포인터(첫) 음성 필드**를 타깃하고, "수정 <컬럼명>"이면 그 컬럼을 타깃한다(handleFinal이
    // idx를 해석해 넘긴다). 직접값("수정 88.9") 적용 후에는 검토 대기(값 재낭독+대기)로 복귀한다.
    //
    // 🔴 v0.49 fix49 — `land`가 그 **복귀처**를 가른다. `'cell'`(기본 아님)은 셀 검토 대기
    //   (`cellWait`) 출신이라는 뜻이다: 항목 이동으로 값 있는 셀에 착지한 상태에서 '수정'이
    //   들어온 경우. 종전엔 이 상태에서 타깃이 `curIdx - 1`(직전 컬럼)로 잡혀 **엉뚱한 셀**을
    //   열거나(0번 항목이면 `targetIdx < 0` 분기로 떨어져 값을 지우고 재질문), 직접값
    //   "수정 41.4"가 **통째로 유실**됐다(실측 — _ASK-fix49 Q2, Larry 승인).
    reviewTarget?: { row: number; idx: number; land?: 'review' | 'cell' },
  ) => {
    const sess = useSessionStore.getState();
    const vc = voiceColsList();
    const curRow = sess.activeRow;
    const curIdx = sess.activeColIdx;
    const endSentinel = awaitingFieldRef.current?.kind === 'atEnd'
      ? awaitingFieldRef.current
      : null;
    const endTargetIdx = endSentinel
      ? vc.findIndex((c) => c.id === endSentinel.colId)
      : -1;

    // Find previous voice col (could be in previous row)
    let targetRow = endSentinel?.row ?? curRow;
    // [MODIFY-TARGET-1] 마지막 행 완료 뒤 bare "수정"은 "직전 인덱스"가 아니라 atEnd 센티넬이
    // 이미 가리키는 마지막 컬럼을 다시 연다. 센티넬 불일치 시에만 기존 직전-컬럼 규칙으로 폴백.
    let targetIdx = endTargetIdx >= 0 ? endTargetIdx : curIdx - 1;
    if (reviewTarget) {
      targetRow = reviewTarget.row;
      targetIdx = reviewTarget.idx;
    } else if (targetIdx < 0) {
      if (curRow <= 1) {
        // No previous — treat as redo current. Save the utterance against the awaiting cell.
        pendingCmd?.saveDefault();
        sess.setRowValue(curRow, vc[curIdx].id, '');
        sess.setRecognized('');
        await announceField(vc[curIdx]);
        return;
      }
      targetRow = curRow - 1;
      targetIdx = vc.length - 1;
    }

    // Pre-extracted value? Apply directly.
    const target = vc[targetIdx];
    if (preExtractedValue) {
      const parsed = parseValueForCol(target, preExtractedValue);
      if (parsed !== null) {
        // #3 error-vs-intent: capture pre-modify value before overwrite (direct "수정 <값>" path).
        const prevDirectValue = sess.getRowValues(targetRow)[target.id];
        sess.setRowValue(targetRow, target.id, parsed);
        // D1(2026-06-08): 수정한 셀의 음성 클립/재생버튼이 사라지는 문제 수정.
        // Direct modify는 새 값 클립을 재녹음하지 않지만, 직전 캡처한 수정 발화("수정 82.7" — 곧
        // 새 값을 담은 음성)를 저장해 둔다. 이전처럼 셀 포인터를 비우면(재생버튼 소멸) 대신, 그
        // 수정 발화 클립을 셀에 재연결한다 → 재생버튼 유지 + 재생 내용이 새 값과 일치.
        // v0.6.0 CLIP-CMD: cmd 클립을 **수정 대상 셀**(targetRow:target.id) 키로 저장·재연결한다.
        // 종경(c8) 안내 중 횡경(c7)을 direct_modify했을 때 cmd 클립이 c8 키로 만들어져 c7 포인터가
        // orphan되던 문제(명령 발화 컬럼≠수정 대상 컬럼)를 차단. saveFor가 그 cmdKey를 돌려준다.
        const cmdKey = pendingCmd?.saveFor(targetRow, target.id) ?? null;
        // (1) pendingClipsRef: archive 이전 시도 → 수정 발화 클립으로 포인터 재연결(없으면 unlink)
        const pendingMap = pendingClipsRef.current[targetRow];
        if (pendingMap && pendingMap[target.id]) {
          archiveCellClip(targetRow, target.id);
          if (cmdKey) pendingMap[target.id] = cmdKey;
          else delete pendingMap[target.id];
        }
        // (2) 이미 persistSession으로 dataStore에 들어간 경우 — archive 후 동일하게 재연결
        const existing = useDataStore.getState().sessions.find((s) => s.id === sessionIdRef.current);
        const existingRow = existing?.rows.find((r) => r.index === targetRow);
        if (existing && existingRow?.audioClips?.[target.id]) {
          archiveCellClip(targetRow, target.id);
          const { [target.id]: _removed, ...restClips } = existingRow.audioClips;
          const nextClips = cmdKey ? { ...restClips, [target.id]: cmdKey } : restClips;
          // F3: direct-modify of an already-synced row must demote it synced→dirty so the next
          // sync UPDATEs its sheet row in place (this path upserts directly + re-links the clip
          // pointer, so it can't go through patchRowValues — apply the invariant inline).
          const valueChanged = (existingRow.values[target.id] ?? '') !== (parsed ?? '');
          const nextSyncState =
            existingRow.syncState === 'synced' && valueChanged ? 'dirty' : existingRow.syncState;
          const updatedRow: SessionRow = {
            ...existingRow,
            values: { ...existingRow.values, [target.id]: parsed },
            audioClips: Object.keys(nextClips).length > 0 ? nextClips : undefined,
            ...(nextSyncState !== undefined ? { syncState: nextSyncState } : {}),
          };
          const nextRows = existing.rows.map((r) => (r.index === targetRow ? updatedRow : r));
          const updatedSession = {
            ...existing,
            rows: nextRows,
            syncedRows: recountSynced(nextRows),
          };
          useDataStore.getState().upsertSession(updatedSession);
          void saveSession(updatedSession).catch(() => {});
        } else {
          // If the cell had no clip pointer to hang the update on, make sure the new value is
          // (re)persisted. persistSession preserves sheetRow/syncState and demotes synced→dirty
          // on change.
          // 🔴 v0.47.0-r3(이중 콜드 리뷰 08-09, codex f1) — 종전 조건(targetRow < curRow ||
          //   reviewTarget)은 **현재 행의 무클립 셀**(수동으로 입력한 셀이 정확히 이 조합)을
          //   건너뛰어 두 저장 갈래 모두 persist 0회였다. 그 뒤 아래 P1 알람 분기가 무기한 응답
          //   대기로 들어가므로, 알람/다음 필드 대기 중 reload가 오면 값이 유실됐다(행이 아직
          //   IDB에 없던 경우 행 통째 미영속 — 실측). 값이 서는 모든 커밋은 persist를 동반한다.
          //   오라클: tests/v0470-r2-p1-direct-modify-trend.spec.ts 「P1-persist」.
          void persistSession();
        }
        // #3 error-vs-intent: log the direct-modify commit with previousValue → parsed.
        // extra:'direct_modify' marks the inline-value path (no re-record), distinct from the
        // cascade path's value event which carries previousValue via awaiting.previousValue.
        logCell({
          type: 'value',
          row: targetRow,
          colId: target.id,
          colName: target.name,
          text: preExtractedValue,
          parsed,
          extra: 'direct_modify',
          ...(prevDirectValue != null ? { previousValue: prevDirectValue } : {}),
        });
        sess.setRecognized(parsed);
        sess.pushValueBurst(target.name, parsed, target.id); // I-3: 중앙 버스트 + 칩 V(UI③)
        useSessionCommitMarks.getState().add(targetRow, target.id); // W4 — 직접 수정도 성공 커밋

        // ── 🔴 v0.47.0-r2 P1(FB-A · 민구 실기기 08-09) — **직접 수정도 추세 평가를 받는다** ──
        //   종전엔 이 경로만 evaluateTrend를 부르지 않았다: 일반 커밋 경로와 수동 커밋 경로만
        //   검사해서, 음성 「수정 <값>」으로 들어온 값은 아무리 이상해도 조용히 섰다.
        //   실측(08-09 세션 +84.5초): row4 횡경 117→77 direct_modify, 직전 회차 111.1 대비
        //   -30.9%로 설정(decrease·10%)을 넘겼는데 **trend 이벤트 0건**. 민구 제보 *"지금 값
        //   알람 조건에 맞을거야. 근데 알람 발생이 없어"* 의 실체가 이 누락이다.
        //   조립·발화·무장은 일반 커밋 경로와 **같은 부품**을 쓴다(buildAnomalyAlert가 SSOT).
        const directViolation = evaluateTrend(target, targetRow, target.id, parsed);
        if (directViolation) {
          const alertExtra = getAnomalyAlertData(targetRow);
          const { alertText, logExtra, alert } = buildAnomalyAlert({
            col: target, v: directViolation, colName: target.name,
            next: formatForTts(parsed), row: targetRow,
            sampleKey: alertExtra.sampleKey, prevDate: alertExtra.prevDate,
          });
          // ⚠️ value 이벤트는 **바로 위에서 이미** 남겼다(extra:'direct_modify') — 여기서는 trend만
          //   추가한다. 그래서 이 경로만 value→trend 순이다(일반 경로는 trend→value). 순서에
          //   의존하는 파서·스펙이 없음을 확인하고 택했다 — value를 여기서 또 남기면 direct_modify
          //   커밋이 로그에서 2건으로 세어져 분석 모수가 오염된다. confidence는 이 경로에 존재하지
          //   않는 값이라(직접값은 명령 발화에서 추출된다) 싣지 않는다.
          logCell({
            type: 'trend', extra: logExtra,
            row: targetRow, colId: target.id, colName: target.name,
            text: preExtractedValue, parsed, previousValue: String(directViolation.prev),
          });
          // P5(FB-F) 주의 — 위 add는 **그대로 둔다.** 알람 중 ✓는 지우는 게 아니라 **붉게**
          //   물든다(민구 재정의 08-09). 색은 anomalyAlert에서 파생되므로 여기 배선이 없다 —
          //   정본은 useVoiceCommitMark.ts 헤더.
          // 응답 대기 무장 — 좌표는 **수정 대상 셀**이다(안내 중이던 셀이 아니다).
          //   '확인'/'유지'는 확정·진행, 새 값 발화는 수정 의미론으로 재커밋(재위반 시 재알림).
          awaitingFieldRef.current = {
            kind: 'trendConfirm',
            row: targetRow, colId: target.id, name: target.name,
            previousValue: parsed,
            // 검토 대기 출신이면 해소 후 착지는 advance가 아니라 **검토 대기 재진입**이다
            //   (아래 일반 복귀 계약을 알람 경유에서도 지킨다 — resumeReviewOf 주석 참조).
            // 🔴 v0.49 r2 A2(codex F1 = 합집합 C3) — **셀 출신도 예약한다.** 종전 이 자리의 주석은
            //   *"land:'cell'은 의도적으로 예약하지 않는다 — 해소 뒤 advance()의 착지처는 반드시
            //   빈 칸이라 B-1 조합이 아니다"* 라고 적혀 있었다. 값 손상 축으로는 맞는 말이었지만
            //   계약 축에서 틀렸다: 가드레일 [NAV-FILLED-CELL-1]은 *"cellWait에서의 모든 탈출은
            //   cellWait 재진입"* 을 불변식으로 세웠고, 사용자가 **의도적으로 이동해 들어온** 검토
            //   문맥이 알람 '확인' 한 마디로 증발하는 것 자체가 위반이다. 「오라클 없는 분기가
            //   는다」는 우려는 분기를 안 만드는 대신 **오라클을 만들어** 답한다
            //   (tests/v049-r2-a2-cellwait-resume.spec.ts ②). 두 예약은 동시에 서지 않는다.
            ...(reviewTarget?.land === 'cell'
              ? { resumeCell: { row: targetRow, colId: target.id } }
              : reviewTarget ? { resumeReview: targetRow } : {}),
          };
          // 응답 발화 녹음 슬롯 재무장 — cmdModify의 preserveCommandClip이 활성 클립을 이미
          //   **멈춰** 놨다([CLIP-VAL-1]① 와 같은 사유). 무장하지 않으면 알람에 새 값으로 답한
          //   발화가 통째로 녹음되지 않는다. 「확인」으로 답하면 클립 저장이 일어나지 않으므로
          //   (명령 경로) 위에서 cmdKey로 재연결해 둔 D1 재생 포인터는 그대로 산다.
          armClipForCell(targetRow, target.id);
          // 🔑 해소 후 「원위치 복귀」 — 캐스케이드 재녹음 경로와 **같은 계약**이다(그쪽 주석:
          //   *"No returnRow — advance() naturally proceeds from targetIdx forward"*).
          //   포인터를 수정 대상 셀에 세워 두면 해소 시 advance()가 채워진 칸을 건너뛰며 전진해
          //   원래 대기하던 필드에 그대로 착지한다(별도 복귀 로직 불필요).
          //   부수 효과가 오히려 목적에 맞는다: 알람이 떠 있는 동안 칩존의 **활성 칩이 알람 난
          //   셀**이 되어 일반 음성 알람과 화면이 같아진다(P5가 그 칩의 ✓를 다루므로 중요).
          //   행이 다르면 자연 진행만으로는 원래 행으로 못 돌아오니 복귀 예약을 세운다.
          // 🔴 v0.47.0-r3(이중 콜드 리뷰 08-09, codex f3) — 종전 「이미 걸린 예약은 덮지 않는다」
          //   조건은 바깥 예약을 지키는 대신 **안쪽 출발점을 버렸다**: '이전' 등으로 이미 예약이
          //   걸린 상태에서 교차행 직접수정 알람이 뜨면, 확인 후 advance가 바깥 예약을 소비해
          //   출발 행을 건너뛰었다(값 오귀속 위험). 이제 **위에 쌓는다**(pushReturn) — 안쪽 복귀가
          //   먼저(알람 대상 행 완료 시), 바깥 예약은 그 행 완료가 소비한다(LIFO, advance 소비부의
          //   스택 일반화 주석 참조). 오라클: 같은 스펙 「P1-중첩복귀」.
          if (targetRow !== curRow) {
            sess.pushReturn(curRow, curIdx);
          }
          sess.setActiveRow(targetRow);
          sess.setActiveCol(targetIdx);
          sess.setPhase('active');
          useSessionStore.getState().setAnomalyAlert({
            ...alert, colId: target.id, awaitingResponse: true,
          });
          playBeep('alert');
          useSessionStore.getState().setLastTts(alertText);
          // 🔑 위반이면 **에코 대신 알림 TTS** — 일반 커밋 경로가 명문화한 계약 그대로다.
          //   커밋 확인음 playBeep('commit')도 내지 않는다(아래 W2 분기를 타지 않는다):
          //   「저장됐다」와 「이상하다」가 한 순간에 겹치면 두 신호가 섞여 구분이 안 된다.
          // 🔴 v0.48.1 U1(리뷰 F1/HIGH, claude+codex 독립일치) — barge-in 가드 기준점. 이 함수
          //   (`enterModifyMode`)는 epochRef를 스스로 건드리지 않으므로, 여기서 캡처한 값은
          //   `await say(alertText)` 진행 중 사용자가 응답(확인/새 값)하면 그 처리(`handleFinal`의
          //   cmd 게이트:1889 또는 값 재커밋:2263)에서 반드시 bump된다 — RACE-1과 동일 기전.
          const myEpoch = epochRef.current;
          // 🔴 v0.48.1 r3 U1 4절 — 이 함수는 epoch를 bump하지 않고 **읽기만** 하므로, 이전에
          //   전혀 다른(무관한) TTS 도중 기록된 `bargeInEpochRef`가 우연히 같은 epoch 값으로
          //   남아 있으면 이번 alertText가 실제로는 끊기지 않았는데도 4절이 거짓으로 걸린다
          //   (claude 재검증 후 발견 — 피해는 인식값 에코 1회 생략뿐, 데이터 영향 없음이지만
          //   교정). 여기서 지워 "이 alertText 재생 중"으로만 좁힌다.
          bargeInEpochRef.current = -1;
          const started = await say(alertText);
          // v0.48.0 P4(NEW-3, 민구 제보 08-10) — 「수정 NN」도 음성 인식값이라 같은 처방을 받는다
          // (P4 계획은 일반 값-커밋 알람 경로만 적었지만, 이 경로도 STT 추출값이라 "소리만으론
          // 오인식 판별 불가"가 똑같이 적용된다 — 구현 중 발견해 범위에 포함, wlog로 보고).
          // alertText/logExtra는 불변 — 별도 두 번째 발화로 분리(§4 바이트 계약 회피, 아래 일반
          // 경로와 동일 근거).
          // 🔴 U1 가드 — `await say(alertText)`의 resolve는 발화 종료를 뜻하지 않는다. `cancel()`도
          //   `onend`를 쏘므로(barge-in이 :353·:1990 부근에서 건다) 응답 처리 중인 다른 frame이
          //   먼저 이 프라미스를 조기 해제할 수 있다(review-claude.md F1 — 재진입 게이트 없음을
          //   `handleFinal` 정의부로 확인). 세 절 각각 다른 구멍을 막는다: `epoch` 불변 = cmd/값
          //   barge-in(같은 셀 재위반 포함, :2263이 값 재커밋마다 bump); `kind==='trendConfirm'` =
          //   터치 종료 버튼의 `stop()`(`awaitingFieldRef.current=null`, epoch는 안 건드림, :3341);
          //   `anomalyAlert?.awaitingResponse` = `clearAnomalyAlert` 경유 해소. 셋 다 참이어야
          //   「아직 같은 알람이 대기 중」이 성립 — 그때만 지나간 값이 아니다.
          // U2(codex medium) — `started`가 false면 1차 발화가 watchdog(2.5s)으로 스킵된 것이라
          //   2차도 생략한다(직렬 대기가 5초로 배증하는 것 방지). `started`-but-no-onend 잔여는
          //   위 `say()` 주석 참조(실기기 관측 항목, 이번 라운드 범위 밖).
          // 🔴 v0.48.1 r3 U1 4절(리뷰 F1 잔여, claude+codex 재검증 일치) — 위 세 절은 **final**이
          //   먼저 도착해 상태를 바꾼 경우만 잡는다. 실제로는 interim이 먼저 TTS를 끊고(barge-in,
          //   speech.ts:353) final은 그보다 수백ms~수초 늦게 온다 — 그 사이엔 epoch도
          //   awaitingFieldRef도 anomalyAlert도 안 바뀌어 위 세 절이 전부 그대로 참이다. 4절이
          //   그 구멍을 막는다: `bargeInEpochRef`는 handleInterim이 "지금 이 epoch에서 뮤트 중에
          //   비어있지 않은 interim이 들어왔다"를 관찰한 순간 기록한다(위 handleInterim 참조).
          //   isTtsMuted()를 **여기서(await 이후)** 다시 읽는 처방ⓐ 원안은 쓰지 않았다 — done()이
          //   resolve 직전에 unmuteForTts()부터 무조건 돌려서, barge-in 여부와 무관하게 이 시점엔
          //   항상 false로 읽힌다(speech.ts의 done() 참조 — 반증 가능).
          if (
            started
            && epochRef.current === myEpoch
            && awaitingFieldRef.current?.kind === 'trendConfirm'
            && useSessionStore.getState().anomalyAlert?.awaitingResponse
            && bargeInEpochRef.current !== myEpoch
          ) {
            // 🟡 v0.48.1 r3(codex 재검증 잔여) — `interrupt:false`로 50ms cancel-대기 자체를
            //   없애는 안을 검토했으나 **철회**했다: "겹쳐 재생될 다른 발화가 없다"는 전제가
            //   1차가 정상 종료(onend/onerror)한 경우에만 성립한다. ④ TODO의 잔여
            //   (`started`=true인데 onend/onerror 둘 다 소실 → watchdog이 대신 resolve)에서는
            //   `done()`이 `cancel()`을 부르지 않으므로(위 `say()` 선언부 TODO 참조) 브라우저
            //   utterance가 여전히 살아있는 채로 여기 도달할 수 있다 — 그 상태에서
            //   `interrupt:false`면 2차가 **큐잉**돼(자연 종료를 무기한 기다림) 뮤트 구간이
            //   그만큼 늘어난다. 정확히 C-FIX4·`isManualHoldBlocked`가 경계했던 "큐잉이 뮤트
            //   해제 창을 연다" 부류이고, WP-1(워치독 10s→2.5s)이 줄이려던 바로 그 마비다. 이
            //   전제를 지키려면 1차가 "정상 종료했는지"를 알아야 하는데, 그건 ④와 같은
            //   `speech.ts` 완료상태 enum 없이는 판별 불가 — 그래서 50ms 창은 고치지 않고 ④
            //   TODO에 합류시킨다(interrupt:true 유지가 지금은 더 안전).
            await say(`인식값 ${alert.next}`);
          }
          // F5(low, claude) — lastTts는 갱신하지 않는다: alertText가 triad(화면==TTS==로그) SSOT라
          //   2차 발화까지 반영하면 화면의 "마지막 안내"와 로그 text=가 어긋난다(의도된 선택).
          return;
        }

        // 🔴 v0.49 r3 #1 — 이 경로의 세 착지(셀 검토 복귀 · 행 검토 복귀 · 원위치 재안내)도
        //   `advance()`·`proceedAfterCommit` 어느 쪽도 타지 않으므로 부기를 여기서 한다.
        //   🔴 v0.49 r4 M10(codex r3 F9 재검증) — **이 자리의 종전 서술을 정정한다.** 종전엔
        //   *"문제는 캐스케이드 재기록 중에 들어온 직접 수정이다('수정' → 값 대신 '수정 66.6')"*
        //   라고 적혀 있었는데, **그 상태는 도달하지 않는다**: bare '수정' 뒤 상태는 `kind:'modify'`고
        //   `cmdModify`의 `isModifyLike` 분기(:117)가 «이미 수정 의미론이면 같은 셀 재질문»으로
        //   먼저 가로채 직접값을 버린다(r4 실측 — 칩이 `—` 그대로).
        //   더 좁히면 이 줄은 **현재 모든 음성 도달 상태에서 no-op**이다:
        //     · 직접 수정의 타깃은 언제나 커서 **앞** 칸이거나 `cellWait`/센티넬이 가리키는
        //       **이미 값이 있는** 칸이라, 그 쓰기가 행의 완성 여부를 바꾸지 못한다.
        //     · 백업은 캐스케이드가 `markRowIncomplete`와 **함께** 세우므로, 백업이 서 있는 동안
        //       `finalizeRowCompletion`은 `isRowVoiceComplete` 가드에서 즉시 return한다.
        //   그래도 **지우지 않는다.** #1의 근인이 「부기 소유자가 한 곳뿐이라 새 착지가 추가될 때
        //   조용히 빠진다」였고, 이 배선은 그 재발을 막는 방어선이다(부기는 멱등이라 비용도 없다).
        //   반증은 소스 계약으로 잠갔다: tests/v049-r3-01-resume-persist.spec.ts [node] ①c.
        //   알람 분기(위 `return`)는 여기 오지 않는다: 미확인 알람 중에 X/N을 올리면 화면이
        //   확정을 먼저 말한다(해소 후 proceedAfterCommit이 부기한다).
        //   ⚠️ v0.49 r6 Y1 — 형제 셋과 달리 여기만 `void`다. 위 서술대로 이 줄은 **현재 모든 음성
        //     도달 상태에서 no-op**(가드에서 즉시 `true`)이라 고지할 실패가 없고, 그럼에도 흐름을
        //     끊는 라우팅을 걸면 「방어선」이 도달 불가 분기에서 사용자 흐름을 막는 위험만 남는다.
        //     이 줄이 실제로 부기를 하게 되는 착지가 생기면 그때 형제와 같이 배선한다.
        void finalizeRowCompletion(targetRow);
        // v0.47.0 W2 — 직접 수정("수정 88.9")도 성공 커밋이다: 화음 → 에코 순서 계약(WP-E).
        //   종전엔 이 경로만 무음이었다(재청취 경로의 성공음과 비대칭 — 값이 저장되는 모든
        //   커밋에 확인음이 난다는 WP-E 원칙에 합류).
        playBeep('commit');
        // v0.51.1 B3(제보③) — 열 이름과 값 사이 **쉼표(짧은 휴지)**. 이름 꼬리와 값이 붙어 읽히던 것의 두 번째
        //   방어선(첫째는 `formatNameForTts`의 꼬리 제거). 재청취 에코(useCommitLanding)와 같은 꼴.
        await say(`수정 ${formatNameForTts(target.name)}, ${formatForTts(parsed)}`);
        // v0.33.0 — 검토 대기 출신 직접 수정: 값 수신 재안내 대신 검토 대기로 복귀
        // (수정 반영값 재낭독 + 대기 — bare 값 덮어쓰기 금지 계약 유지).
        // 🔴 v0.49 fix49 — 셀 검토 대기 출신은 **셀 단위**로 복귀한다. 아래 일반 복귀
        //   (`announceField(vc[curIdx])`)로 떨어지면 방금 값을 채운 그 셀에 `kind:'value'`가
        //   **다시** 열린다 — B-1과 완전히 같은 구멍이라 같은 계약으로 닫는다(오라클 ⑤).
        if (reviewTarget) {
          if (reviewTarget.land === 'cell') {
            sess.setActiveRow(targetRow);
            sess.setActiveCol(targetIdx);
            await enterCellWait(target, parsed);
            return;
          }
          await enterReviewWait(targetRow);
          return;
        }
        // Return immediately to where we were
        sess.setActiveRow(curRow);
        sess.setActiveCol(curIdx);
        if (vc[curIdx]) await announceField(vc[curIdx]);
        return;
      }
    }

    // Cascade re-record path (no usable inline value): target/targetRow are already resolved above
    // (the cell the user is about to re-answer) and don't change for the rest of this correction.
    // v0.28.0 [CLIP-CORRECTION-1] fix: this used to call saveDefault(), which files the '수정'
    // command clip under the AWAITING cell (the field that was about to be prompted when '수정' was
    // said) — a DIFFERENT column from the one being corrected. clips-manifest/audit then can't find
    // "what triggered this correction" under the corrected column (Sonar 2026-07-06 desktop repro,
    // sonar-a4-direct2.js: cmd clip landed on c9 while the correction target was c8). Re-key it to
    // the target cell instead, mirroring the direct-modify path above (L690) — same invariant
    // (command clip lives under the cell it corrects), just without the pointer re-link (the
    // target's own value clip is re-recorded fresh under its bare key below, so no relink needed).
    pendingCmd?.saveFor(targetRow, target.id);

    // Snapshot the existing row before clearing in-memory. persistSession() includes this backup
    // if stop() fires before re-completion. If persistSession fire-and-forget hasn't flushed yet
    // (row in sessionStore.completedRows but not yet in useDataStore), build from live store.
    {
      const existingForBackup = useDataStore.getState().sessions.find((s) => s.id === sessionIdRef.current);
      const persistedRow = existingForBackup?.rows.find((r) => r.index === targetRow);
      if (persistedRow) {
        correctionBackupRef.current = persistedRow;
      } else if (sess.isRowComplete(targetRow)) {
        const columns = getSessionColumns();
        const bAuto = buildCyclingValues(columns, targetRow);
        const bFixed = autoNonCyclingValues(columns, targetRow);
        correctionBackupRef.current = {
          index: targetRow,
          values: { ...bFixed, ...bAuto, ...sess.getRowValues(targetRow) },
          complete: true,
        };
      } else {
        correctionBackupRef.current = null;
      }
    }

    // #3 error-vs-intent: snapshot the target cell's current value BEFORE the cascade clear,
    // so the eventual re-commit can log previousValue → finalValue for misrecognition analysis.
    const prevTargetValue = sess.getRowValues(targetRow)[target.id];

    // Cascade clear in-memory only: target col through end of row (so user re-records all remaining cols).
    // Persisted IDB/dataStore state is left intact until the row is successfully re-completed and
    // persistSession() overwrites it — this ensures old measurements survive a crash/reload during correction.
    //
    // 🔴 v0.49 fix49b(max 리뷰 #4) — **셀 검토 대기 출신은 그 셀 하나만 다시 받는다.**
    //   캐스케이드는 «행 전체 검토»(reviewWait)의 계약이다: 그 행은 이미 다 채워졌고 사용자가
    //   처음부터 다시 부르겠다고 선언한 상태다. 진행 중인 행의 **한 칸에 주차해** '수정'이라고
    //   말한 사용자는 그 칸만 다시 부를 생각인데, 종전 범위(targetIdx→행 끝)는 바꾸겠다고 한
    //   적 없는 뒤 칸의 확정값까지 지웠다(중단되면 그대로 유실).
    //   같은 상태의 직접값 경로("수정 41.4", :1249 분기)는 이미 **그 셀만** 고친다 — 한 상태에서
    //   같은 명령의 두 형태가 파괴성으로 갈리면 안 된다. 여기서 대칭을 맞춘다.
    const clearEnd = reviewTarget?.land === 'cell' ? targetIdx + 1 : vc.length;
    for (let i = targetIdx; i < clearEnd; i++) {
      sess.setRowValue(targetRow, vc[i].id, '');
      // Clip preservation (was: delete pending clips). Archive the prior attempt under an attempt
      // key so the misrecognised original audio survives, then unlink the pending pointer so the
      // re-record writes a fresh bare key. Already-persisted clips are left under their bare key —
      // persistSession() overwrites the cell value on re-completion, but the archived attempt(s)
      // keep the older audio for analysis.
      const pendingMap = pendingClipsRef.current[targetRow];
      if (pendingMap?.[vc[i].id]) {
        archiveCellClip(targetRow, vc[i].id);
        delete pendingMap[vc[i].id];
      }
    }
    sess.markRowIncomplete(targetRow);
    // No returnRow — advance() naturally proceeds from targetIdx forward
    sess.setActiveRow(targetRow);
    sess.setActiveCol(targetIdx);
    sess.setRecognized('');
    // v0.33.0 — 검토 대기(phase 'complete')에서 진입한 재녹음이 대기 라벨 히어로("명령 대기")를
    // 단 채 값을 기다리지 않도록 active로 전환(일반 경로는 이미 active — 무해).
    sess.setPhase('active');
    // 🔴 v0.49 r2 A2(codex F1 = 합집합 C3) — **출신을 재기록 대기에 실어 보낸다.** 종전엔 여기서
    //   `announceField`가 kind:'modify'로 재무장하며 cellWait provenance를 잃었고, 재발화 커밋
    //   종단은 행 예약(resumeReview)만 보고 `advance()`로 빠졌다 — 2단계 수정(「수정」 → 값)이
    //   가드레일 [NAV-FILLED-CELL-1]의 「모든 탈출은 cellWait 재진입」에서 유일하게 새던 구멍이다.
    //   (직접값 「수정 41.4」는 위 :1504 분기가 이미 cellWait으로 복귀한다 — 한 상태에서 같은
    //   명령의 두 형태가 착지처로 갈리면 안 된다는 것이 fix49b가 세운 대칭 계약이다.)
    await announceField(target, {
      isModify: true,
      previousValue: prevTargetValue,
      ...(reviewTarget?.land === 'cell' ? { resumeCell: { row: targetRow, colId: target.id } } : {}),
    });
    // v0.47.0-r2 P1 — evaluateTrend·getAnomalyAlertData·armClipForCell 추가. 세 콜백 모두 이
    //   useCallback보다 **위**에서 정의돼야 한다(dep 배열은 렌더 중 평가된다 — TDZ). 추세 헬퍼
    //   3종을 이 함수 위로 옮긴 선행 커밋이 그 전제를 만든다.
  }, [announceField, armClipForCell, enterCellWait, enterReviewWait, evaluateTrend, finalizeRowCompletion, getAnomalyAlertData, persistSession, say]);

  // ── 🔴 v0.49 F-1 (민구 결정 2026-08-12): 「이전」/「다음」 = **입력 항목 한 칸 이동** ─────────
  // [ENV-12] Stage 3 서브 훅 #4 — 항목 한 칸 이동(gotoAdjacentField)은 useFieldNav가 소유한다
  // (이 파일은 호출만 — F-1 계약·근거 주석은 그 파일로 이동). 세션 컨텍스트는 주입으로 넘긴다.
  const { gotoAdjacentField } = useFieldNav({
    logCell,
    say,
    voiceColsList,
    isManualHoldBlocked,
    fractionWholeOf,
    announceOrCellWait,
    awaitingFieldRef,
    epochRef,
  });

  // ── v0.22.0 P0: 클립 레코더 스트림 소실 → micLost 게이트 ──────────────
  /** 빈/극소 클립이 났을 때의 처리. 이 콜백 자체에서는 **재-getUserMedia를 하지 않는다** —
   *  recoverStream은 destructive-first(살아있던 스트림을 먼저 stop·null 처리)이고 이 콜백은
   *  클립 저장 콜백(사용자 제스처 밖)에서 불리므로, iOS Safari가 getUserMedia를 NotAllowedError로
   *  거부해 멀쩡하던 스트림까지 죽인다 — 그게 바로 이번 P0 근인이다(clip_empty×41 폭주).
   *   - 스트림이 실제로 죽었으면(isStreamLost) micLost로 래치(once). v0.38.0은 별도 effect가 기존
   *     reconnectMic을 자동 1회만 호출하고, 실패 후에는 사용자 제스처에 맡긴다.
   *   - 스트림이 멀쩡하면(트랙 살아있음) **no-op**. 복구가 필요 없다 — 다음 startClip()이 살아있는
   *     스트림 위에 새 MediaRecorder를 만들어 자가 치유한다(transient 빈 클립의 자연 회복). */
  /** 🔴 v0.50 r2 — **마이크 소실 래치 시 화면부터 연다**(사유 무관 · 공통).
   *
   *  왜 고지 훅이 아니라 여기인가: 고지 TTS는 **클립 연속 실패 전용**이다([CF-4] — init 실패 등엔
   *  이미 고유 안내가 있어 같은 뜻이 두 번 나갔다). 그러나 **화면을 여는 것은 사유와 무관하게
   *  필요하다** — `BlackoutOverlay`(z-9999)가 `MicReconnectBanner`(z-60)를 완전히 가리므로,
   *  화면이 꺼진 채 래치되면 **복구 진입로 자체가 사용자에게 보이지 않는다**(2026-08-19 이원창
   *  세션의 형상 그대로다).
   *  🔴 특히 트랙 `ended`로 먼저 래치되면 `micLostLatchedRef`가 서서 이후 클립 연속 실패가
   *  `force` 분기에 **못 들어가고**, 그러면 고지 훅도 안 돌아 화면이 영영 안 열린다 —
   *  그 좁은 경로를 이 헬퍼가 덮는다. 이미 켜져 있지 않으면 no-op이라 정상 세션엔 무영향이다. */
  const releaseBlackoutOnMicLost = useCallback(() => {
    if (!useSessionStore.getState().blackout) return;
    useSessionStore.getState().setBlackout(false);
    logCell({ type: 'clip', extra: 'mic_lost_blackout:released' });
  }, []);

  const maybeAutoRecoverOrLatch = useCallback((reason: string, opts?: { force?: boolean }) => {
    const rec = recorderRef.current;
    if (!rec) return;
    // v0.50 [CLIP-SILENT-1] — `force`는 **연속 실패 임계 도달**이다. 2026-08-19 실기기 사고에서
    // 트랙은 살아 있고(`ended` 아님) 무음만 흘러 이 판정이 69회 연속 no-op이었다. 결과로 판정한
    // 호출자(useValueCommit)가 그 사실을 여기로 넘긴다.
    if ((opts?.force === true || rec.isStreamLost()) && !micLostLatchedRef.current) {
      micLostLatchedRef.current = true;
      setMicLost(true);
      logCell({
        type: 'clip', extra: `mic_lost:${reason}`,
      });
      releaseBlackoutOnMicLost();
      // 🔴 v0.50 r2 [CF-2·CF-4] — 고지는 **클립 연속 실패(force)로 선 래치에만**, 그리고
      //   **세션당 정확히 1회**다.
      //   · CF-4: `micLost`는 init 실패·복귀 시 트랙 ended에서도 선다. 그 경로엔 이미 고유 안내가
      //     있어(`init_failed` 직후 say) 같은 뜻의 문장이 연달아 나갔다.
      //   · CF-2: 종전엔 `micLost`가 false로 내려갈 때(=자동 재연결 성공) 에지 가드가 풀려
      //     **셀마다 반복 발화**했다. 민구가 승인한 것은 「복구에 성공해도 1회」이지 반복이 아니다.
      //   `clipHealth.alertOnce()`가 세션 경계(`reset()`)에서만 재무장되므로 1회가 구조로 보장된다.
      if (opts?.force === true && clipHealthRef.current.alertOnce()) setClipFailAlert(true);
    }
    // 스트림이 살아있으면 복구 금지(no-op) — 다음 클립이 자가 치유. recoverStream 진입은 오직
    // reconnectMic 한 곳(자동 1회/수동 공용)이다.
  }, []);

  /** v0.22.0 P0 → v0.38.0 #5 — 수동 버튼과 자동 1회 시도가 공유하는 유일한 복구 진입점.
   *  같은 Promise가 진행 중이면 그대로 반환해 recoverStream/getUserMedia 중복 진입을 막는다.
   *  recoverStream reason의 legacy 문자열은 기존 텔레메트리 바이트 계약 보존을 위해 유지한다. */
  const reconnectMic = useCallback((opts?: { userGesture?: boolean }): Promise<boolean> => {
    if (micReconnectInFlightRef.current) return micReconnectInFlightRef.current;
    const rec = recorderRef.current;
    logCell({ type: 'clip', extra: 'mic_reconnect_attempt' });
    if (!rec) {
      logCell({ type: 'clip', extra: 'mic_reconnect_no_recorder' });
      return Promise.resolve(false);
    }
    // 리뷰#1(Codex Medium) — 사용자 제스처는 iOS가 getUserMedia를 허용하는 유일한 창이라
    // 자동 시도가 남긴 쿨다운에 삼켜지면 안 된다. 자동 경로(opts 없음)는 종전대로 쿨다운을 지킨다.
    const attempt = rec.recoverStream('user_gesture', { bypassCooldown: opts?.userGesture === true }).then((ok) => {
      // 복구 중 pause/stop/resume이 레코더를 폐기·교체했으면 늦게 열린 스트림을 즉시 닫는다.
      // stale 인스턴스가 micLost를 풀거나 핫마이크로 남지 않게 하되 STT lifecycle에는 관여하지 않는다.
      if (ok && recorderRef.current !== rec) {
        rec.dispose();
        logCell({ type: 'clip', extra: 'mic_reconnect_failed' });
        return false;
      }
      if (ok) {
        micLostLatchedRef.current = false;
        setMicLost(false);
        logCell({ type: 'clip', extra: 'mic_reconnect_ok' });
      } else {
        logCell({ type: 'clip', extra: 'mic_reconnect_failed' });
      }
      return ok;
    });
    micReconnectInFlightRef.current = attempt;
    void attempt.then(() => {
      if (micReconnectInFlightRef.current === attempt) micReconnectInFlightRef.current = null;
    });
    return attempt;
  }, []);

  // v0.50 [CLIP-SILENT-1] — 실패 고지(화면 끄기 자동 해제 + TTS 1문장)의 **유일한 배선 지점**.
  // 복구는 여기서 하지 않는다 — 바로 아래 자동 재연결 effect가 종전대로 소유한다.
  useClipFailureAlert({ alert: clipFailAlert, say, logCell });

  // v0.51 [CLIP-MUTED-SPAN-1] — 마이크 인터럽트 고지(절전 화면 문구·자동 해제·회복 후 1문장)의
  // **유일한 배선 지점**. 복구는 하지 않는다 — 위 자동 재연결 effect의 소유권을 건드리지 않는다.
  // v0.51.1 ⓓ — 회복 판정을 「걸친 클립 해소 뒤」로 유예하기 위해 관찰 getter 1개를 더 넘기고,
  //   세션 경계에서 유예를 폐기할 손잡이를 받는다(`stop()`의 dispose 뒤 한 줄).
  const micInterruptionNotice = useMicInterruptionNotice({
    clipHealth: clipHealthRef.current,
    hasMutedClipOpen: () => recorderRef.current?.hasOpenMutedClip() === true,
    say,
    logCell,
  });

  // v0.38.0 #5 — micLost 한 번의 연속 구간마다 자동 복구는 정확히 1회뿐이다. 실패 상태가 계속
  // 유지돼도 attempted ref가 effect 재실행을 차단하며, 성공/세션 리셋으로 micLost가 false가 된 뒤에만
  // 다음 사고를 위한 가드를 해제한다. STT 컨트롤러 시작/정지/재시작 판단에는 관여하지 않는다.
  // ⚠️ 이 effect는 사용자 제스처 밖이므로 iOS Safari가 getUserMedia를 거부할 수 있다. 그 경우
  // 자동 결과를 failed로 계측하고 수동 재연결 배너 폴백으로 수렴한다.
  useEffect(() => {
    if (!micLost) {
      micAutoReconnectAttemptedRef.current = false;
      setMicReconnectFallbackVisible(false);
      return;
    }
    if (micAutoReconnectAttemptedRef.current) return;
    micAutoReconnectAttemptedRef.current = true;
    // 🔴 v0.50 r2 [CF-1] — **스트림이 살아 있으면 자동 재획득을 하지 않는다.**
    //   `recoverStream`은 destructive-first다(`audioRecorder.ts` — 트랙 stop → stream=null → 재획득).
    //   종전 판정(`isStreamLost()`)은 **이미 죽은 스트림**에서만 참이라 잃을 게 없었는데, v0.50이
    //   넣은 `force` 래치(빈 클립 연속 2회)가 **살아 있는 스트림**에서도 이 effect를 깨웠다 —
    //   그러면 iOS가 제스처 밖 getUserMedia를 거부하는 순간 **멀쩡하던 스트림까지 잃는다.**
    //   그게 v0.22.0 P0가 롤백한 바로 그 사고이고([IOS-5] 종결 정책), 2026-08-19 양혁진 세션처럼
    //   **외부 조건이 풀려 저절로 회복하는 경로 자체**를 없앤다.
    //   👉 감지(래치·고지)는 그대로 두고 **재획득만 사용자 제스처에 맡긴다** — 배너를 즉시 세운다.
    if (!recorderRef.current?.isStreamLost()) {
      logCell({ type: 'clip', extra: micAutoReconnectSkipped('stream_live') });
      setMicReconnectFallbackVisible(true);
      return;
    }
    setMicReconnectFallbackVisible(false);
    logCell({ type: 'clip', extra: micAutoReconnect('attempt') });
    let active = true;
    void reconnectMic().then((ok) => {
      logCell({ type: 'clip', extra: micAutoReconnect(ok ? 'ok' : 'failed') });
      if (active && !ok) setMicReconnectFallbackVisible(true);
    });
    return () => { active = false; };
  }, [micLost, reconnectMic]);

  /** v0.35.0 R3-FIX-1(리뷰 라운드3, Codex High·데이터무결성) — **복원 없이** suspend 래치만 해제한다.
   *  세션 경계(stop/start)에서 쓴다. resumeRecognitionForUi와 달리 인식기를 다시 만들지 않는다 —
   *  세션이 끝나는(또는 새로 시작하는) 시점이라 복원 대상 자체가 없기 때문.
   *
   *  왜 필요한가: 래치(uiSuspendRef.reasons)는 suspend→resume 쌍으로만 풀린다. 그런데 종료 확인
   *  다이얼로그의 **확인(confirm)** 경로는 resume 없이 곧장 stop()으로 간다(R2-FIX-2 배선: 취소만
   *  resume). stop()도 start()도 래치를 안 만졌으므로 래치가 **영구히 잔존**했다(집합에 소스가 남음).
   *  그러면 같은 입력탭에서 다음 세션을 시작한 뒤 수동입력·명령어 도움말·피드백·종료 모달을 열 때
   *  suspend가 이미-active로 **조기 반환**(집합 비우지 못함) → STT가 계속 살아 배경 발화가 값을
   *  커밋하거나 행을 이동시킬 수 있었다(데이터 무결성). */
  const clearUiSuspendLatch = useCallback((reason: string) => {
    const latch = uiSuspendRef.current;
    // 🔴 v0.43.0 #4 — 래치를 통째로 비우면 resume이 **조기 반환**한다(reasons에 소스가 없으니
    //   no-op). 그러면 백그라운드 안내 플래그를 소비할 주체가 사라져, 세션 경계를 넘어 살아남았다가
    //   **다음 세션의 첫 모달을 닫을 때 엉뚱하게 발화**한다. 래치와 같은 수명으로 묶는다.
    bgAnnouncePendingRef.current = false;
    if (latch.reasons.size === 0) return;
    // 세션 경계 — 남은 **모든** suspend 소스를 통째로 비운다(복원 없음). 중첩 소스가 있었으면
    //   was=a+b로 함께 남겨 어떤 소스들이 걸려 있었는지 로그로 판별한다(단일 소스는 종전과 동일).
    const prev = [...latch.reasons].join('+') || 'unknown';
    uiSuspendRef.current = { hadController: false, reasons: new Set<string>() };
    uiSuspendedClipRef.current = null;
    uiBlockedClipArmRef.current = null;
    // 기존 ui_resume/ui_suspend와 같은 command 레인 — 신규 이벤트 타입 무첨가(log-replay 호환).
    logCell({
      type: 'command',
      parsed: 'ui_suspend_cleared',
      extra: `${reason}:was=${prev ?? 'unknown'}`,
      row: useSessionStore.getState().activeRow,
    });
  }, []);

  /** @returns 두 사실을 **분리해서** 돌려준다. 하나의 boolean으로 겸하면 안 된다 —
   *  v0.43.0 리뷰(Codex 사소#1, 2026-07-31 수용)가 지적한 계측 의미 오염이 정확히 그것이었다.
   *
   *   - `latched`     빈 집합 → 비빈 집합 **전이를 이 호출이 수행했는가.** 래치 부기의 사실이다.
   *                   🔴 **복원 의무(1c)는 이 값에 걸어야 한다** — 시작 TTS 중 suspend가 들어오면
   *                   아직 인식기가 없어도(`sttStopped=false`) 뒤이은 `start()`가 가드에 막히며
   *                   `hadController`를 true로 승격시키고, resume이 **실제로 복원**한다.
   *                   여기서 예약을 세우지 않으면 그 복원이 조용해진다([TEST-CLIP-F-1] 계열).
   *   - `sttStopped`  **돌고 있던 인식기를 실제로 멈췄는가.** `bg_mic`의 `stt` 축이 이걸 쓴다.
   *                   종전에는 `latched`를 그대로 `stt=stopped`로 썼기 때문에, 세션이 아예 안 돌던
   *                   유휴 왕복까지 "STT를 중지했다"로 기록돼 실제 중지 횟수의 분자가 오염됐다. */
  const suspendRecognitionForUi = useCallback((reason = 'ui_modal'): { latched: boolean; sttStopped: boolean } => {
    const latch = uiSuspendRef.current;
    // 같은 소스 재진입 — 멱등(중복 add·중복 로그 방지)
    if (latch.reasons.has(reason)) return { latched: false, sttStopped: false };
    const wasActive = latch.reasons.size > 0;
    latch.reasons.add(reason);
    // 이미 다른 소스가 suspend 중이면(중첩) 집합에만 추가하고 실제 STT 상태는 건드리지 않는다.
    //   ui_suspend/ui_resume 로그는 **실제 STT 상태 전이**(빈집합↔비빈집합)에만 남겨(단일 소스 계약
    //   바이트 불변), 중첩 add/remove는 조용한 래치 부기다. hadController는 첫 suspend에서만 스냅샷하고,
    //   그 뒤 start()가 가드에 막히면 :2541이 true로 승격한다(v0.43.0 1c — 복원 의무 플래그).
    if (wasActive) return { latched: false, sttStopped: false };
    // 🔑 이 스냅샷이 곧 "돌고 있던 인식기를 실제로 멈췄는가"다 — 아래 `ctrlRef.current?.stop()`이
    //   실제로 무언가를 멈추는 경우와 정확히 일치한다. 그대로 `sttStopped`로 반환한다.
    latch.hadController = !!ctrlRef.current;
    const sttStopped = latch.hadController;
    logCell({
      type: 'command',
      parsed: 'ui_suspend',
      extra: reason,
      row: useSessionStore.getState().activeRow,
    });
    earlyCommitStableRef.current = null;
    lastInterimRef.current = null;
    // 리뷰 라운드1(Codex+Flash, 수용) — 모달 suspend 진입 시 미확정 interim 표시 정리. 인식기가
    // 멈추면 final이 안 와, 닫은 뒤 이전 발화가 현재 값처럼 남던 찌꺼기 차단(표시 전용, 계약 무해).
    useSessionStore.getState().setInterimValue(null);
    setActiveController(null);
    ctrlRef.current?.stop();
    ctrlRef.current = null;
    cancelTts();
    // [CLIP-WINDOW-1] STT와 독립인 MediaRecorder도 함께 끊는다. 반환 blob은 의도적으로 버려
    // 모달 전 조각이 가짜 셀 클립으로 저장되지 않게 하고, resume에서 새 창으로 다시 녹음한다.
    const activeClip = activeClipRef.current;
    if (activeClip) {
      uiSuspendedClipRef.current = activeClip;
      activeClipRef.current = null;
      void recorderRef.current?.stopClip().catch((error) => {
        logCell({
          type: 'error',
          extra: `clip_ui_suspend_stop_failed:${reason}:${String((error as Error)?.message ?? error)}`,
          row: activeClip.row,
          colId: activeClip.colId,
        });
      });
    }
    return { latched: true, sttStopped };
  }, []);

  // [ENV-12] Stage 3 서브 훅 #7 — handleFinal의 **명령 경로**(블록 B+C)는 useFinalCommands가
  // 소유한다(이 파일은 호출만 — 계약·근거 주석은 그 파일 헤더로 이동). 호출 지점은 구 구획
  // 자리(handleFinal 직전)다: 주입 심볼의 선언이 전부 그 앞이고(`useTrendGate` 조립 ·
  // `useFieldNav` · `useRowLanding`의 formatRowList · refs), 소비자(handleFinal)는 그 뒤다.
  // 🔴 `stop`·`pause`만 **ref로** 넘긴다 — 선언이 이 지점보다 뒤라 값으로 넘기면 첫 렌더
  //   ReferenceError다(stopRef 선언부 주석의 TDZ 매듭).
  const { runCommandStage } = useFinalCommands({
    logCell,
    say,
    stopRef,
    pauseRef,
    resumeRef,
    advance,
    proceedAfterCommit,
    enterModifyMode,
    rejectValue,
    relistenInContext,
    preserveCommandClip,
    gotoAdjacentField,
    gotoAdjacentRow,
    goNextRow,
    formatRowList,
    isRowVoiceComplete,
    voiceColsList,
    clearAnomalyAlert,
    setUiCommand,
    isModifyLike,
    fractionWholeOf,
    resumeCellOf,
    resumeReviewOf,
    demoteTrendConfirm,
    awaitingFieldRef,
    epochRef,
    uiCommandSeqRef,
    ctrlRef,
  });

  // [ENV-12] Stage 3 서브 훅 #8 — handleFinal의 **값 자격 판정**(블록 D+E: barge-in·STT/EOS
  // 계측·흡수 3종 + 값 가드 4종·파싱·거절 4분기)은 useFinalValueGate가 소유한다(이 파일은
  // 호출만). 호출 지점은 형제 스테이지 바로 뒤 — 주입 심볼(rejectValue:useTrendGate ·
  // listEmptyRows/buildEndReachedTts:useRowLanding · refs)의 선언이 전부 그 앞이다.
  const { runValueGate } = useFinalValueGate({
    logCell,
    say,
    rejectValue,
    listEmptyRows,
    buildEndReachedTts,
    voiceColsList,
    getSessionColumns,
    getColById,
    fractionWholeOf,
    ctrlRef,
    lastInterimRef,
    lastConfidenceRef,
    earlyCommitStableRef,
    epochRef,
    awaitingFieldRef,
  });

  // [ENV-12] Stage 3 서브 훅 #9 — handleFinal의 **값 커밋**(블록 F: store 커밋·✓집합·영수증·
  // burst + 증분 영속화 발사 + 클립 stop/저장/포인터 복구)은 useValueCommit이 소유한다
  // (이 파일은 호출만). 주입 심볼의 선언이 전부 그 앞이다(clipCapture:594 · persistSession:636 ·
  // maybeAutoRecoverOrLatch · refs).
  const { runValueCommit } = useValueCommit({
    logCell,
    persistSession,
    archiveCellClip,
    clipCapture,
    maybeAutoRecoverOrLatch,
    clipHealth: clipHealthRef.current,
    isModifyLike,
    epochRef,
    awaitingFieldRef,
    sessionIdRef,
    recorderRef,
    activeClipRef,
    pendingClipsRef,
    brokenClipKeysRef,
  });

  // [ENV-12] Stage 3 서브 훅 #10 — handleFinal의 **착지**(블록 G+H: 추세 위반 알람·재무장·2단
  // TTS / 정정 정상화·확인음·echo·value 로그·epoch 가드·proceedAfterCommit)는 useCommitLanding이
  // 소유한다(이 파일은 호출만). 사슬의 마지막 스테이지다.
  const { runCommitLanding } = useCommitLanding({
    logCell,
    say,
    evaluateTrend,
    getAnomalyAlertData,
    armClipForCell,
    proceedAfterCommit,
    isModifyLike,
    previousValueOf,
    resumeReviewOf,
    resumeCellOf,
    getTtsRate,
    awaitingFieldRef,
    epochRef,
    bargeInEpochRef,
  });

  // ── final result handler ───────────────────────────────────
  const handleFinal = useCallback(async (textArg: string, alts: string[], confidence: number) => {
    // v0.20.0 Phase 5 #4 — 반응속도(발화 확정→값 커밋) 측정 시작점. STT final이 handleFinal에
    // 진입한 순간을 찍어, 값 커밋 시점(아래 value 이벤트)까지의 경과ms를 commitLatencyMs로 동봉한다.
    // EOS 꼬리([STT-11], 브라우저 무음종료)와 달리 이건 **앱 파이프라인** 지연(파싱·추세검사·persist).
    const handleFinalAt = Date.now();
    // v0.45.0 WP-1④ — hidden 유지 구간의 final 도착 카운트(bg_keep의 finals 축 — 유지 실효 증거).
    if (bgKeepRef.current && document.visibilityState === 'hidden') bgKeepRef.current.finals += 1;
    // v0.36.0 FB#2(Vance) — final 진입 = interim 발화 종결. 미확정 표시값을 즉시 정리한다(확정 흐름이
    //   화면을 이어받으므로 흐린 임시값이 남지 않게). 순수 표시 정리 — 커밋/파싱/텔레메트리 무관.
    useSessionStore.getState().setInterimValue(null);
    // `text` is mutable so the redo-with-inline-value path (e.g. "다시 8.4") can rewrite the
    // effective utterance to just the value and fall through to the normal value-commit path.
    let text = textArg;
    // 판별 유니온 전환(v0.35.3): trendConfirm 해제 시 'modify'로 강등 재대입하므로 let.
    let awaiting = awaitingFieldRef.current;
    if (!awaiting) return;
    const cmd = detectCommand(text);

    // v0.34.0 리뷰(Codex High·agy Pro Critical 공통 지적 → 민구 결정 2026-07-14: **터치 전용**):
    // 수동입력 이상치 보류(manualHold) 팝업이 떠 있는 동안 STT 결과를 **전부 버린다**.
    //   근거: 팝업은 사용자가 손으로 넣은 값에 대해 [확인]/[수정] 터치를 기다리는 상태다. 이때
    //   현장 소음·혼잣말이 숫자로 파싱되면 같은 셀을 음성값으로 재커밋해(팝업이 가리키는 값과
    //   실제 행 값 불일치) 위반이 아니면 advance까지 돌아 **팝업이 사라지고 원본 수동값이 영구
    //   소실**된다(3모델 전원 지적). 수동입력은 이미 손 입력이라 음성 재커밋 편의의 가치보다
    //   데이터 무결성이 우선(민구 결정). 팝업의 '말로도 가능' 힌트도 함께 제거됐다
    //   (AnomalyAlertPopup — manualHold면 터치 버튼만 노출).
    //   해제는 confirmManualAnomaly/modifyManualAnomaly(터치)만 담당한다.
    //   (게이트 SSOT = isManualHoldBlocked — 터치 이동/일시정지도 같은 함수로 거부한다.)
    if (isManualHoldBlocked('stt')) return;

    // [ENV-12] E단계 — 블록 B+C(명령 핸들러 5종 선언 + 경로 판정·dispatch)는 useFinalCommands가
    //   소유한다. 여기서는 구획 간 전달 상자(FinalCtx)를 열어 넘기기만 한다.
    //   반환 true = 명령으로 끝났다(즉시 return, 종전 조기 return과 등가) · false = 값 경로 폴스루.
    const ctx: FinalCtx = { handleFinalAt, text, alts, confidence, awaiting, cmd };
    if (await runCommandStage(ctx)) return;
    // 🔴 유일한 되받기 — 추세 확인 강등(trendConfirm → modify)은 스테이지 안에서 일어난다.
    //   종전 `awaiting = demoteTrendConfirm(awaiting)`(같은 구획 안의 재대입)과 등가다.
    awaiting = ctx.awaiting;

    // [ENV-12] E단계 — 블록 D+E(barge-in·STT/EOS 계측·흡수 3종 + 값 가드 4종·파싱·거절 4분기)는
    //   useFinalValueGate가 소유한다. true = 흡수/거절로 끝났다 · false = 값이 파싱됐다.
    if (await runValueGate(ctx)) return;
    // 스테이지 산출물을 종전 지역변수 이름으로 되받는다 — 아래 블록 F~H의 바이트를 보존한다.
    //   `?? null`은 ctx의 선택 필드를 종전 선언 타입으로 되돌리는 것뿐이다(게이트가 셋 다 채운다).
    const col = ctx.col ?? null;
    const lowConfParsedExtra = ctx.lowConfParsedExtra ?? null;
    const parsed = ctx.parsed;
    // 🔴 스테이지 계약의 재확인 — `false` 반환은 「파싱 성공」이고, 파싱 실패는 전부 위에서
    //   `true`로 끝난다. 그래서 여기는 **도달 불가**다. 그래도 확인하는 이유: 이 불변식이
    //   깨지면 증상이 크래시가 아니라 **무음 값 유실**(빈 값 커밋)이라 아무도 모른다.
    if (parsed == null) return;

    // [ENV-12] E단계 — 블록 F(store 커밋·✓집합·영수증·burst + 증분 영속화 + 클립 종결)는
    //   useValueCommit이 소유한다. 조기 종료가 없는 **직선 커밋**이라 handled 신호가 없다.
    //   🔑 `parsed`를 인자로 넘기는 이유: ctx의 선택 필드로는 non-null을 타입으로 증명할 수
    //   없는데 그 확인은 바로 위(값 게이트 뒤)에서 이미 했다. 산출물 3종을 **반환으로** 받는
    //   이유: ctx로 받으면 여기서 도달 불가 가드를 하나 더 써야 하고, 그 가드가 침범당하면
    //   「값은 커밋됐는데 착지만 증발」이 된다 — 반환값은 그 상태를 구성으로 막는다.
    const { myEpoch, commitLatencyMs, runCorrectedPersistCheck } = await runValueCommit(ctx, parsed);

    // [ENV-12] E단계 — 블록 G+H(추세 위반 알람·재무장·2단 TTS / 정정 정상화·확인음·echo·
    //   value 로그·epoch 가드·proceedAfterCommit)는 useCommitLanding이 소유한다.
    //   🔑 `committed` 6종을 인자로 넘기는 이유는 값 커밋과 같다(그 호출 주석 참조) —
    //   ctx의 선택 필드로는 non-null을 타입으로 증명할 수 없고, 스테이지 안 가드는 침범 시
    //   「값은 커밋됐는데 착지만 증발」이 된다.
    // 🔴🔴 **이 호출 뒤에 문장을 추가하지 마라.** 스테이지 안의 `return;` 두 곳(추세 위반 시
    //   advance 중단 · 종단 epoch 가드)이 종전 handleFinal의 **조기 return과 등가인 근거**가
    //   정확히 「이 호출이 handleFinal의 마지막 문」이라는 사실이다. 뒤에 한 줄이라도 붙으면,
    //   epoch 가드를 통과하지 못한(= 다른 handleFinal이 끼어든) 낡은 착지가 그 문장을 실행한다 —
    //   조용히 깨지는 형태다. 붙여야 하면 스테이지 **안으로** 넣어라(그 파일 헤더에 같은 계약).
    await runCommitLanding(ctx, {
      parsed, col, lowConfParsedExtra, myEpoch, commitLatencyMs, runCorrectedPersistCheck,
    });
    // 🔴 [ENV-12] E단계 완료 — dep 배열이 **정확히 스테이지 함수 4개**다(§5-1 ③ 완성).
    //   궤적: 16(E 착수 전) → 9(E1 명령) → 9(E2 값 게이트, 구성 교체) → 8(E3 값 커밋) → **4**.
    //   소멸분은 전부 「그 구획이 handleFinal 안의 유일 콜러였다」가 실측으로 확인된 것들이고,
    //   남은 넷은 전부 `useCallback([])`+`depsRef`라 **영구 고정**이다. 그래서 `handleFinal`은
    //   1회 생성이고 `onFinal` 배선 4곳 + 조기확정 1곳이 재구성되지 않는다 — 그것이 이 분리가
    //   지켜야 했던 것 전부다(08-12 P6-1 「STT 배선 요동」).
    //   ⚠️ 여기 **다섯 번째가 생기면 그 자체가 리뷰 대상**이다. 스테이지가 아닌 값이 dep에
    //     들어왔다는 뜻이고, 그 값이 `[]`-고정이 아니면 배선이 매 렌더 흔들린다.
  }, [runCommandStage, runValueGate, runValueCommit, runCommitLanding]);

  // ── v0.9.0 interim(중간) 결과 처리: EOS 계측 마킹 + (빠른 인식 ON 시) 조기확정 ──
  const handleInterim = useCallback((text: string, confidence?: number) => {
    const now = Date.now();
    // EOS 계측: 마지막 interim 도착 시각 기록 — handleFinal이 final.ts와의 차로 꼬리를 산출.
    // §5-1 ② — 엔진이 interim에 준 원시 confidence도 함께(미보고면 undefined 그대로).
    lastInterimRef.current = { text, at: now, confidence };

    // v0.36.0 FB#2(Vance) — 미확정 인식 텍스트를 **표시 전용** store 필드에 기록(파형과 함께 "지금
    //   이렇게 들었다"를 원거리에 노출). 값-대기(value/trendConfirm) 문맥에서만 — 이동/종료 대기
    //   중엔 임시값을 띄우지 않는다. 명령어는 확정값이 아니므로 제외. 순수 표시 — 조기확정·커밋·
    //   텔레메트리 경로는 아래 로직 그대로(이 write는 그 앞에서 무조건 실행, fastRecognition 무관).
    const trimmedInterim = text.trim();
    // 🔴 v0.48.1 r3 U1 4절 — speech.ts:353와 같은 조건(뮤트 중 + 비어있지 않은 interim)을 여기서도
    //   재확인해, "이 순간 barge-in이 실제로 발생했다"를 이 알람의 epoch에 못박는다. cancel()이
    //   쏘는 onend는 비동기라 이 시점엔 아직 unmuteForTts()가 돌지 않았으므로 isTtsMuted()가
    //   true로 읽힌다(위 bargeInEpochRef 선언부 주석 — done() 대조로 반증됨).
    if (trimmedInterim && ctrlRef.current?.isTtsMuted()) {
      bargeInEpochRef.current = epochRef.current;
    }
    const awaitingForDisplay = awaitingFieldRef.current;
    const showInterim =
      !!trimmedInterim &&
      !!awaitingForDisplay &&
      awaitingForDisplay.kind !== 'atEnd' &&
      awaitingForDisplay.kind !== 'reviewWait' &&
      // v0.49 fix49 — 셀 검토 대기도 값을 받지 않는 상태다. 임시값을 띄우면 화면이
      //   "이 값을 받는 중"이라고 말하는데 실제로는 흡수된다(표시와 동작 불일치).
      awaitingForDisplay.kind !== 'cellWait' &&
      useSessionStore.getState().phase === 'active' &&
      !detectCommand(trimmedInterim);
    useSessionStore.getState().setInterimValue(showInterim ? trimmedInterim : null);

    // 조기확정(빠른 인식) — 기본 OFF(실험). 브라우저 final(무음 종료감지)을 기다리지 않고
    // interim 숫자가 안정되면 커밋해 체감 딜레이를 줄인다. 보수적으로 숫자 컬럼 + 명령어 아님 +
    // TTS중 아님 + active 단계에서만. 절단 리스크가 있어 실기기 A/B 전까지 default off.
    if (!useSettingsStore.getState().fastRecognition) return;
    // A8 계측: fastRecognition ON인데 현장 로그에서 stt_early_commit 0건 — '소음이 interim 안정화를
    // 막아 미발동(정상)'인지 '미배선(버그)'인지 현 계측으론 구분 불가. 아래 stt_early_commit_attempt
    // 로 안정화 시도 진입·리셋 사유를 가시화한다. 동작은 변경하지 않는다(가시성만 추가). OFF면 위
    // early-return으로 무발화(오버헤드 0). 로그 폭주를 막기 위해 전이(transition) 시에만 찍는다.
    const logAttempt = (extra: string) =>
      logCell({ type: 'stt_early_commit',
        row: awaitingFieldRef.current?.row, colId: awaitingFieldRef.current?.colId,
        extra: `attempt:${extra}` });
    const awaiting = awaitingFieldRef.current;
    // 🔴 v0.49 fix49 — `cellWait`은 phase를 'active'로 **유지**하므로(행이 아직 진행 중이라
    //   'complete'로 내리면 히어로 ✓·레이아웃이 「조사 완료」가 된다), 조기확정 차단을 아래
    //   phase 게이트에 기댈 수 없다. 여기서 kind로 명시 차단한다 — 안 막으면 interim 숫자가
    //   확정된 셀에 곧장 커밋된다(B-1을 final 경로에서만 막고 interim으로 새는 형태).
    if (!awaiting || awaiting.kind === 'trendConfirm' || awaiting.kind === 'atEnd'
      || awaiting.kind === 'reviewWait' || awaiting.kind === 'cellWait') return;
    if (useSessionStore.getState().phase !== 'active') return;
    if (ctrlRef.current?.isTtsMuted()) {
      // TTS 중 barge-in은 final 경로가 처리 — 안정화 후보가 무장돼 있었다면 무산 사유를 기록.
      if (earlyCommitStableRef.current) { logAttempt('cancel:tts_muted'); earlyCommitStableRef.current = null; }
      return;
    }
    const t = text.trim();
    if (!t || detectCommand(t)) return; // 명령어는 반드시 final로
    const col = getSessionColumns().find((c) => c.id === awaiting.colId) || null;
    if (!col || (col.type !== 'int' && col.type !== 'float')) return; // 숫자 컬럼만 조기확정
    const parsed = parseValueForCol(col, t);
    if (parsed === null) {
      // interim이 더 이상 숫자로 파싱 안 됨 → 안정화 타이머 리셋(후보가 있었을 때만 기록).
      if (earlyCommitStableRef.current) { logAttempt('reset:parse_null'); earlyCommitStableRef.current = null; }
      return;
    }
    const stable = earlyCommitStableRef.current;
    if (!stable || stable.value !== parsed) {
      // 새 후보 무장(첫 진입) 또는 후보값 변경(새 interim 도착으로 안정화 타이머 리셋).
      logAttempt(stable ? `reset:new_interim:${stable.value}->${parsed}` : `armed:${parsed}`);
      earlyCommitStableRef.current = { value: parsed, since: now };
      return;
    }
    if (now - stable.since < EARLY_COMMIT_STABLE_MS) return;
    // 안정 충족 → 조기확정. 이중 커밋 방지: 인식기 abort로 같은 발화의 in-flight final 폐기.
    earlyCommitStableRef.current = null;
    logCell({
      type: 'stt_early_commit', text: t, parsed,
      row: awaiting.row, colId: awaiting.colId,
      extra: `stable=${EARLY_COMMIT_STABLE_MS}`,
    });
    ctrlRef.current?.restartRecognition();
    // confidence 0 = "미보고" 센티넬 → 신뢰도 게이트 통과(interim엔 신뢰도 없음). 안정성으로 갈음.
    void handleFinal(t, [t], 0);
  }, [handleFinal]);

  /** @returns **실제로 인식기를 복원했는가.** #4의 복귀 안내가 이 값에 걸린다. */
  const resumeRecognitionForUi = useCallback((reason = 'ui_modal') => {
    const latch = uiSuspendRef.current;
    if (!latch.reasons.has(reason)) return false; // 이 소스는 suspend 중이 아님 — no-op(스퓨리어스 resume 방어)
    latch.reasons.delete(reason);
    // v0.37.0 리뷰(3모델 공통) — **다른 suspend 소스가 아직 남아 있으면 실제 재개하지 않는다.**
    //   수동 시트 + 개선요청 모달 중첩 시, 개선요청만 닫혀도 시트 뒤에서 STT가 살아나던 레이스의 차단축.
    //   집합이 완전히 빌 때만 인식기를 복원한다(모든 오버레이 해제 확인).
    if (latch.reasons.size > 0) return false;
    // 🔴 v0.43.0 #4 — 안내 플래그는 **여기서 무조건 소비한다.** 이 지점 아래의 모든 경로
    //   (복원 안 함 / 이미 컨트롤러 있음 / 정상 복원)가 소비된 상태로 진행해야, 복원되지 않은
    //   회차의 플래그가 살아남아 **다음 모달을 닫을 때 발화**하는 일이 없다.
    //   ⚠️ 이 콜백의 컨트롤러 생성부는 `feedback_modal`·`manual_input` 등과 **공유된다** —
    //   onStart를 무조건 걸면 모달을 닫을 때마다 "다시 시작합니다"가 나간다.
    const announceBgResume = bgAnnouncePendingRef.current;
    bgAnnouncePendingRef.current = false;
    const hadController = latch.hadController;
    latch.hadController = false;
    logCell({
      type: 'command',
      parsed: 'ui_resume',
      extra: reason,
      row: useSessionStore.getState().activeRow,
    });
    const phase = useSessionStore.getState().phase;
    const shouldRestore =
      hadController &&
      (phase === 'active' || phase === 'complete' || phase === 'paused') &&
      isSpeechSupported();
    const blockedClip = uiBlockedClipArmRef.current;
    const suspendedClip = blockedClip ?? uiSuspendedClipRef.current;
    uiBlockedClipArmRef.current = null;
    uiSuspendedClipRef.current = null;
    if (!shouldRestore) return false;

    // 값 대기 좌표가 그대로일 때만 재무장한다. 모달 안의 터치 처리 등으로 타깃이 바뀌었다면
    // announceField가 새 좌표의 녹음창을 소유하므로 오래된 셀을 되살리지 않는다.
    // [CLIP-WINDOW-2] 선택 (b): 위에서 마지막 suspend source를 먼저 삭제해 reasons가 빈 뒤에만
    // armClipForCell을 호출한다. 이 순서를 뒤집으면 복원 arm도 게이트에 재차 막혀 영원히 보류된다.
    // suspend 중 들어온 최신 arm 요청은 모달 전 활성 슬롯보다 우선해 같은 기존 복원 경로로 합류한다.
    const awaiting = awaitingFieldRef.current;
    if (
      suspendedClip &&
      !activeClipRef.current &&
      awaiting?.row === suspendedClip.row &&
      awaiting.colId === suspendedClip.colId
    ) {
      armClipForCell(suspendedClip.row, suspendedClip.colId);
    }

    if (!ctrlRef.current) {
      ctrlRef.current = new SpeechController({
        onFinal: handleFinal,
        onInterim: handleInterim,
        onError: () => {},
        // v0.43.0 #4 5번 — **"재개 시도"가 아니라 "재개 성공"에 건다**(plan §3-3). `onStart`는
        //   인식기가 실제로 기동한 신호다. [MIC-B2] 전례(복귀 32.5초 뒤 `audio-capture` 오류)라
        //   시도 시점에 "다시 시작합니다"라고 말하면 거짓말이 된다.
        //   ⚠️ `onStart`는 **워치독 재시작마다** 온다(speech.ts가 매 인스턴스 `start` 이벤트에
        //   건다) — 그래서 클로저 안에 once 가드가 필요하다. 플래그만으로는 부족하다.
        //   v0.45.0 WP-3 — 안내 뒤 복귀 브리핑을 잇는다(F14). 텍스트는 발화 시점에 조립.
        ...(announceBgResume
          ? { onStart: bgResumeAnnouncerOnce(say, () => buildReturnBriefing(true)) }
          : {}),
      });
      setActiveController(ctrlRef.current);
      ctrlRef.current.start();
    }
    return true;
  }, [armClipForCell, handleFinal, handleInterim, say, buildReturnBriefing]);

  // ── v0.45.0 WP-2 [D1] — 세션-활성 게이트 (v0.43.0 #4 "이탈-중지"의 재검토 실행) ──────
  /** WP-1④ — 유지 사이클의 생존 요약 1건(bg_keep). 복귀·임계 어느 쪽이 먼저 오든 한 번만. */
  const emitBgKeepSummary = useCallback(() => {
    const keep = bgKeepRef.current;
    if (!keep) return;
    bgKeepRef.current = null;
    logCell({
      type: 'app',
      extra: bgKeep({
        backgroundMs: Date.now() - keep.hiddenAt,
        finals: keep.finals,
        stt: ctrlRef.current ? 'ctrl' : 'gone',
        track: recorderRef.current?.getTrackState() ?? 'none',
      }),
    });
  }, []);

  const clearBgOffTimer = useCallback(() => {
    if (bgOffTimerRef.current !== null) {
      window.clearTimeout(bgOffTimerRef.current);
      bgOffTimerRef.current = null;
    }
  }, []);

  /** WP-2 — 장기 임계(10분, Q2 민구 확정) 도달 시의 정지 시퀀스: ①음성 고지(best-effort —
   *  iOS가 TTS를 이미 막았을 수 있어 Notification이 주 채널) ②기기 알림 ③저장 ④정지.
   *  ④의 dispose가 곧 물림 예방 선-정리다 — prerollTap detach(무음 분석 AudioContext 해제,
   *  WebKit bug 253951 클래스) + 전 트랙 stop. 복귀 시 자동 재획득 + 실패 시 v0.44.1 경보 재사용.
   *
   *  🔴 리뷰 C1(critical, 콜드 리뷰 08-05) — **파괴적 단계 직전마다 중단 검사.** await 사슬 도중
   *  복귀(알림 탭이 유도하는 설계된 동선)하면 잔여 continuation이 포그라운드에서 STT·레코더를
   *  죽였다. `aborted()`가 세대(bgOffGenRef — 복귀·세션 경계마다 증가)와 가시성을 재검사한다:
   *   - 고지·알림 뒤 중단 → 아무것도 안 건드린 채 종료(복귀측이 bg_keep·브리핑을 정상 수행).
   *   - suspend 뒤 중단 → dispose를 생략(복귀측 resumeRecognitionForUi가 래치로 STT 복원,
   *     레코더는 산 채로 남는다 — 일관 상태).
   *  bg_keep 요약도 정지가 확정된 뒤에만 여기서 소비한다 — 중단 시 복귀측 몫으로 남긴다. */
  const applyBackgroundOff = useCallback(async () => {
    bgOffTimerRef.current = null;
    if (document.visibilityState !== 'hidden') return; // 타이머 경합 — 이미 복귀했다
    if (!shouldKeepInBackground(useSessionStore.getState().phase)) return; // 세션이 그 사이 끝났다
    const gen = bgOffGenRef.current;
    const aborted = () =>
      bgOffGenRef.current !== gen || document.visibilityState !== 'hidden';
    // ① 음성 고지 — suspend가 cancelTts를 부르므로 **먼저** 시도하고 완료(또는 10초 워치독)를
    //   기다린다. iOS가 막았으면 워치독이 해소하고, 복귀 재고지(onStart 안내)가 보강한다.
    await say('10분 동안 자리를 비워 음성 입력을 정지합니다. 입력한 값은 저장되어 있습니다.', false)
      .catch(() => {});
    if (aborted()) return; // 고지 중 복귀 — 정지 없이 철회(세션은 산 채 그대로)
    // ② 기기 알림 — 결과를 조건 거짓 포함 기록([FG-RETURN-LOG-1]).
    const notified = await showBackgroundOffNotification();
    logCell({ type: 'app', extra: notifyPerm({ src: 'threshold', result: notified }) });
    if (aborted()) return; // 알림 직후 복귀(알림 탭) — 정지 철회
    // ③ 저장 — 유지 요약을 먼저 확정 소비하고, 진행 클립을 정상 마감(suspend가 stopClip) 후
    //   pending save flush + 세션 영속. 안내 예약은 **무조건** 세운다(리뷰 ?1 — 모달 래치가
    //   선점돼 latched=false여도 10분 정지는 사실이므로, 최종 복원 시점의 재고지가 맞다).
    emitBgKeepSummary();
    const { sttStopped } = suspendRecognitionForUi('app_background');
    bgAnnouncePendingRef.current = true;
    const hadRecorder = recorderRef.current !== null;
    await clipCapture.flushSaves(PAUSE_FLUSH_GRACE_MS);
    await persistSession();
    if (aborted()) return; // flush·persist 중 복귀 — STT는 복귀측이 래치로 복원했다. dispose 생략
    // ④ 정지 — dispose = 선-정리(preroll AudioContext detach + 전 트랙 stop). track.enabled
    //   토글이 아니라 완전 해제인 이유: 10분 이상은 OS 재량 회수 영역이라 잡고 있어봐야 물림
    //   (253951)만 키운다. 재개는 복귀 경로의 재획득 불변식이 받는다(리뷰 C2).
    recorderRef.current?.dispose();
    recorderRef.current = null;
    logCell({
      type: 'command',
      parsed: 'bg_mic',
      // 리뷰 C8 — capture 축은 "실제 전환"만 off다. 레코더가 처음부터 없던 세션([CLIP-INIT-
      // SILENT-1] 모집단)이면 noop으로 남겨 판독 오염을 막는다.
      extra: bgMicAction({
        edge: 'threshold',
        stt: sttStopped ? 'stopped' : 'noop',
        capture: hadRecorder ? 'off' : 'noop',
      }),
      row: useSessionStore.getState().activeRow,
    });
  }, [emitBgKeepSummary, say, suspendRecognitionForUi, clipCapture, persistSession]);
  const applyBackgroundOffRef = useRef(applyBackgroundOff);
  useEffect(() => { applyBackgroundOffRef.current = applyBackgroundOff; }, [applyBackgroundOff]);

  /** 백그라운드 진입. `visibilitychange`(hidden)의 유일한 호출자는 `App.tsx onVis`다.
   *
   *  🔑 **[D1] 세션-활성 게이트(v0.45.0, 민구 확정 08-05):** phase가 세션 중(active·paused·
   *  complete)이면 **정지하지 않는다** — STT·TTS·클립 캡처를 hidden에도 유지하고 계측만 남긴다.
   *  v0.43.0 #4("화면끔·이탈 둘 다 중지", 민구 지시 07-31)는 08-05 정정으로 **과잉 교정**으로
   *  판정됐다(원 의도 = "세션 밖에서 돌지 마라". [MIC-BG-STOP-1] 재검토 갈래의 실행).
   *  그 정지가 만들던 복귀 왕복(인식기 재생성 + BT HFP 재협상 1~2초 × 세션7 실측 6회)이 F15
   *  ("한 번에 안 붙어")의 구조적 근원 후보였다(플랜 §1-③). 경계·임계는 backgroundSessionPolicy.
   *
   *  세션 밖(ready·stopping)에서는 종전 그대로 확실히 정지한다 — 아래 suspend 경로.
   *  🔴 **순서가 계약이다**(정지 경로에서). suspend가 먼저다 — 그게 진행 중 클립을 `stopClip()`
   *  으로 닫고 재개용으로 보관한다. 뒤집어서 트랙부터 끄면 클립이 무음으로 채워진 채 닫혀
   *  `clip_too_small`/`clip_empty`가 재발한다(07-30 실측 5건 — `enabled=false`는 녹음을 멈추는
   *  게 아니라 무음을 흘린다, MDN).
   *
   *  ⚠️ 화면 끄기와 앱 이탈은 **구분할 수 없다**([SCREEN-LOCK-1]: 53/53 `evidence=blur`).
   *  게이트는 그 구분을 전제하지 않는다 — phase 하나로 가른다. */
  const suspendForBackground = useCallback(() => {
    if (shouldKeepInBackground(useSessionStore.getState().phase)) {
      // [D1] 유지 — 정지 없음. 생존 관측(WP-1④)과 임계 타이머만 세운다.
      bgKeepRef.current = { hiddenAt: Date.now(), finals: 0 };
      clearBgOffTimer();
      // 🔴 테스트 전용 우회(조용한 우회 금지 — __micSettleSkipForTest 계보): 픽스처가
      //    `window.__bgOffMsForTest`를 세우면 **임계값만** 줄인다(시퀀스·계측 계약은 그대로).
      //    기본값 10분은 tests/backgroundSessionPolicy 단언이 리터럴로 고정한다.
      const offMs =
        (window as unknown as { __bgOffMsForTest?: number }).__bgOffMsForTest ?? LONG_BACKGROUND_OFF_MS;
      bgOffTimerRef.current = window.setTimeout(() => { void applyBackgroundOffRef.current(); }, offMs);
      logCell({
        type: 'command',
        parsed: 'bg_mic',
        // 리뷰 C5 계보 — kept는 "돌던 것을 유지"다. 모달 suspend로 이미 죽어 있거나(ctrl=null)
        // 레코더가 없으면 noop으로 남겨 계측이 거짓이 되지 않게 한다.
        extra: bgMicAction({
          edge: 'enter',
          stt: ctrlRef.current ? 'kept' : 'noop',
          capture: recorderRef.current ? 'kept' : 'noop',
        }),
        row: useSessionStore.getState().activeRow,
      });
      return;
    }
    // v0.43.0 리뷰 사소#1 — **두 축을 갈라 쓴다.**
    //   `latched`    → 복원 의무(안내 예약). 1c의 시작-TTS race에서는 아직 인식기가 없어도
    //                  뒤이은 `start()`가 `hadController`를 승격시켜 resume이 실제로 복원한다.
    //                  종전 동작 그대로다 — 여기를 `sttStopped`로 좁히면 그 복원이 조용해진다.
    //   `sttStopped` → 계측의 `stt` 축. "돌던 인식기를 실제로 멈췄나"만 기록한다.
    const { latched, sttStopped } = suspendRecognitionForUi('app_background');
    if (latched) bgAnnouncePendingRef.current = true;
    const captureOff = recorderRef.current?.setCaptureEnabled(false) ?? false;
    logCell({
      type: 'command',
      parsed: 'bg_mic',
      extra: bgMicAction({ edge: 'enter', stt: sttStopped ? 'stopped' : 'noop', capture: captureOff ? 'off' : 'noop' }),
      row: useSessionStore.getState().activeRow,
    });
  }, [suspendRecognitionForUi, clearBgOffTimer]);

  /** 포그라운드 복귀: 캡처 on + STT 복원. 안내는 여기서 하지 않는다 — 복원된 인식기의
   *  `onStart`가 낸다(위 `announceBgResume`).
   *
   *  [D1] 유지 사이클의 복귀는 대개 **복원할 것이 없다**(stt=noop이 정상) — 생존 요약(bg_keep)을
   *  남기고 임계 타이머를 해제한다. 임계 정지(threshold)가 실행됐던 복귀만 레코더를 재획득한다.
   *
   *  🔴 캡처를 **먼저** 켠다(진입의 역순). 복원된 인식기·클립이 무음을 먹지 않게 한다.
   *  🔑 캡처 복구는 **무조건** 돈다 — 백그라운드 중 세션이 끝나 래치가 비어도(`clearUiSuspendLatch`)
   *  트랙이 꺼진 채 남으면 다음 세션이 조용히 무음을 녹음한다. */
  const resumeFromBackground = useCallback(() => {
    // 🔴 리뷰 C1 — 진행 중일 수 있는 임계 정지 continuation을 무효화한다(세대 증가).
    bgOffGenRef.current += 1;
    // WP-3 브리핑 게이트 — 유지 사이클이 실제로 있었는가(스퓨리어스 visible 이벤트 방어).
    const hadKeepCycle = bgKeepRef.current !== null;
    clearBgOffTimer();
    emitBgKeepSummary();
    const captureOn = recorderRef.current?.setCaptureEnabled(true) ?? false;
    const restored = resumeRecognitionForUi('app_background');
    // 🔴 리뷰 C2 — 재획득은 플래그가 아니라 **불변식**이다: 세션이 진행/완료 중인데 레코더가
    //   없으면(임계 정지·경합 잔해 어느 쪽이든) 무조건 재획득한다. paused는 제외 — pause()가
    //   의도적으로 레코더를 비우고 resume()이 재생성하는 기존 계약이다. 실패는 v0.44.1 경보
    //   재사용([CLIP-INIT-SILENT-1] — 무음 실패 금지: 계측 + 배너 래치 + TTS 고지).
    const phaseAtReturn = useSessionStore.getState().phase;
    if (!recorderRef.current && (phaseAtReturn === 'active' || phaseAtReturn === 'complete')) {
      const rec = new AudioRecorder();
      recorderRef.current = rec;
      void rec.init().then((ok) => {
        if (recorderRef.current !== rec) return; // 그 사이 세션 경계를 지났다
        if (!ok) {
          logCell({ type: 'error', extra: micInitFailed(rec.getLastInitError() ?? 'unknown') });
          maybeAutoRecoverOrLatch('init_failed');
          void say('주의. 음성 클립이 저장되지 않습니다. 재연결이 안 되면 앱을 껐다 다시 열어 주세요.', false).catch(() => {});
          return;
        }
        micLostLatchedRef.current = false;
        setMicLost(false);
        // 리뷰 C6 — 재획득 전에 보류된 클립 무장(armClipForCell의 no_recorder 가드가 보관)을
        //   스트림이 실제로 선 뒤 소비한다. 좌표가 여전히 현재 대기 셀일 때만(오래된 셀 금지).
        const pendingArm = uiBlockedClipArmRef.current;
        const awaiting = awaitingFieldRef.current;
        if (
          pendingArm && !activeClipRef.current && uiSuspendRef.current.reasons.size === 0 &&
          awaiting?.row === pendingArm.row && awaiting.colId === pendingArm.colId
        ) {
          uiBlockedClipArmRef.current = null;
          armClipForCell(pendingArm.row, pendingArm.colId);
        }
      });
    }
    logCell({
      type: 'command',
      parsed: 'bg_mic',
      extra: bgMicAction({ edge: 'return', stt: restored ? 'restored' : 'noop', capture: captureOn ? 'on' : 'noop' }),
      row: useSessionStore.getState().activeRow,
    });
    // v0.45.0 WP-3 (F14, Q4-답 민구 확정) — **유지 사이클의 복귀 브리핑.** 인식기가 안 죽었으니
    //   onStart 슬롯이 없다 — 여기서 직접 낸다. active만: paused 복귀는 '재시작' 시점이 담당
    //   (이중 낭독 방지), 정지 사이클 복귀(restored=true)는 onStart 안내+브리핑이 담당.
    //   모달·알람 게이트는 buildReturnBriefing 내부에 있다(리뷰 C3·C5 — 단일 관문).
    if (hadKeepCycle && !restored && useSessionStore.getState().phase === 'active') {
      const briefing = buildReturnBriefing(true);
      if (briefing) void say(briefing, false).catch(() => {});
    }
  }, [resumeRecognitionForUi, clearBgOffTimer, emitBgKeepSummary, maybeAutoRecoverOrLatch, say, buildReturnBriefing, armClipForCell]);

  // ── v0.34.0 A2 — 개선요청(피드백) 팝업 열림 중 STT 일시정지 ──
  // App.tsx가 sessionStore.uiModalOpen('feedback')을 올리고/내리는 단일 신호를 구독한다.
  // 열림 → suspendRecognitionForUi('feedback_modal')(기존 ui_suspend 로그가 판정 근거),
  // 닫힘 → resumeRecognitionForUi. 세션 비활성이면 hadController=false라 자연 no-op(기능 격리).
  // keep-alive([STT-16], App.tsx) 덕에 세션 중엔 어느 탭에서 열어도 이 effect가 살아 신호가 닿는다.
  useEffect(() => {
    return useSessionStore.subscribe((s, prev) => {
      if (s.uiModalOpen === prev.uiModalOpen) return;
      if (s.uiModalOpen === 'feedback') suspendRecognitionForUi('feedback_modal');
      else if (prev.uiModalOpen === 'feedback') resumeRecognitionForUi('feedback_modal');
    });
  }, [suspendRecognitionForUi, resumeRecognitionForUi]);

  // ── start / stop ───────────────────────────────────────────
  const start = useCallback(async (label?: string) => {
    const s = useSettingsStore.getState();
    setPreferredVoiceName(s.preferredVoiceName);
    // v0.44.0 §D1 — barge-in 설정을 라이브 speech 모듈에 동기화(세션 시작 = 항상 최신 영속값.
    // F28 날짜 초기화 등 스토어만 바뀐 경로도 여기서 따라잡는다).
    setBargeInEnabled(s.bargeInEnabled);
    const sess = useSessionStore.getState();
    if (sess.phase === 'stopping') return false;
    // v0.38.0 리뷰#4 — 세션 대상(target)은 **연결된 시트가 있을 때만** 고정한다.
    // 시트 미연결(로컬 기록 모드)은 PRINCIPLES §5가 보장하는 정상 사용이라 막지 않는다 —
    // target 없이 시작하고, 업로드 시점에 대상을 확인받는다(sync의 legacy 세션 경로와 같다).
    // 반대로 **연결된 시트가 있는데 columns 출처가 그 시트가 아니면** 다른 농가 시트에 기록될
    // 위험이라 시작을 막는다.
    if (isSheetSourceBlocked(s)) {
      sess.setLastTts('시트 연결을 다시 확인해 주세요.');
      return false;
    }
    const target = sessionTargetFromSettings(s);
    if (!s.tableGenerated) return false;
    const columns = structuredClone(s.columns);
    const vc = columns.filter((c) => c.input === 'voice');
    if (vc.length === 0) {
      // 🔴 v0.51.1 B1(제보① 2026-09-02 14:53) — 종전엔 여기서 **무음으로** false였다. 이 갈래는 아래
      //   `audio_unlock`·gUM보다 앞이라 권한 프롬프트조차 안 뜨고, 호출부(VoiceScreen)는 반환값을 버린다
      //   → 사용자에겐 「눌렀는데 아무 일도 없다」(로그 16초 공백 · read-fb F1). 시작 버튼은 이제
      //   `ReadyState`가 같은 조건으로 잠그지만, 강제 호출·상태 드리프트에 대비해 갈래 자체가 말한다 —
      //   위 시트 차단 갈래와 같은 꼴(`setLastTts`) + 로그 1줄. 새 세션 id가 아직 없으므로 `__app__`으로
      //   남긴다(직전 세션 id에 얹으면 남의 세션에 귀속된다 — `logCell`을 쓰지 않는 이유).
      sess.setLastTts(NO_VOICE_COLUMNS_MESSAGE);
      logger.log({ type: 'app', extra: sessionStartBlocked('no_voice_columns'), sessionId: '__app__' });
      return false;
    }
    const total = computeTotalRows(columns);
    if (total === 0) return false;

    // v0.38.0 리뷰#1(Codex High) — 이전 세션의 마지막 UI 음성명령(도움말·인식률 등)이 남아 있으면,
    // 새 세션에서 ActiveState가 마운트될 때 소비 시퀀스가 0으로 초기화돼 **그 명령이 자동 재실행**된다
    // (세션 B 시작하자마자 도움말이 열리고, 인식률 설정이 한 번 더 바뀐다). 세션 경계에서 비운다.
    // 🔴 F18 이후 이 클리어는 **아래 첫 await보다 앞(클릭 이벤트의 동기 구간)** 이어야 한다.
    //    await 뒤로 밀리면 클릭 배치가 끝난 프라미스 연속에서 zustand setPhase('active')의 동기
    //    렌더가 useState 클리어 flush보다 먼저 ActiveState를 마운트해 stale 신호가 재실행된다
    //    (실측: v026 [리뷰#1] red — 세션 B에서 도움말이 저절로 열림).
    uiCommandSeqRef.current = 0;
    setUiCommand(null);
    // v0.45.0 WP-2 — 알림 권한 요청은 이 클릭의 **동기 구간**에서만 성립한다(iOS 제스처 요건).
    //   앱 수명당 1회, 이미 결정돼 있으면 skipped(무로깅 — 요청 자체가 없었다). 임계 10분 알림
    //   (Q2)의 주 채널이 이 권한이다. gUM 프롬프트와 같은 제스처에 얹히는 것은 의도된 비용 —
    //   첫 세션 1회뿐이고, 임계 알림 없이는 10분 정지가 무음이 된다.
    void requestNotifyPermissionOnce().then((result) => {
      if (result !== 'skipped') {
        logCell({ type: 'app', extra: notifyPerm({ src: 'session_start', result }) });
      }
    });

    // ── 🔴 v0.46.1 WP-1(민구 실기기 08-07) — **오디오 출력 unlock은 여기여야 한다** ──────
    // 08-07 실기기에서 세션 초반 2분간 TTS 11건이 전부 `onstart` 미도착(10초 워치독)이었고
    // 비프도 `ctx=suspended`였다. 같은 시각 wake lock이 `NotAllowedError`를 냈다 — 즉
    // **그 시점엔 이미 사용자 활성화가 없었다.**
    //
    // 근인: `warmupTts()`가 아래 `await recorderRef.init()`(gUM 프롬프트) + 1초 정착 **뒤**에
    // 있었다. `await` 뒤는 클릭 콜스택이 아니므로 iOS가 오디오 개시를 거부한다.
    // 👉 **첫 `await`보다 앞**(이 클릭의 동기 구간)으로 올린다. 위 알림 권한 요청이 같은 이유로
    //    이미 여기 있다 — 같은 계약이다.
    // 🔴 **이 두 줄 사이에 `await`를 넣지 마라.** 넣는 순간 원래 버그로 되돌아간다.
    const audioCtxState = unlockAudioPlayback();  // AudioContext 생성 + resume (비프 경로)
    const ttsWarmup = warmupTts();                 // speechSynthesis 개시 (TTS 경로) — 결과는 아래에서 확인
    logCell({ type: 'app', extra: `audio_unlock:ctx=${audioCtxState},src=session_start` });
    // 🔴 v0.46.1 WP-1c(민구 지시 08-07) — 준비 **진행 상태**를 화면에 낸다.
    //    *"3초뒤 화면 전환이 아닌, 권한 수락하고 실제 마이크/스피커 입출력이 가능한지 확인하고,
    //      진행 상황을 바형태로 보여줘서 … 오작동이 아님을 알게 해줘."*
    const prog = (step: number, label: string, warn?: string) =>
      useSessionStore.getState().setStartProgress({ step, total: START_STEPS, label, warn });
    const audioOk = audioCtxState === 'running';
    prog(1, '소리 출력을 여는 중…', audioOk ? undefined : '소리 출력이 아직 안 열렸어요');

    // ── v0.44.0 §C8 F18(민구 확정 08-02) — 마이크 권한 요청 시점 = **이 클릭** ─────────
    // 종전 v0.25.0 WS-2는 입력탭 마운트에서 prewarm(getUserMedia)을 돌렸다 — 탭에 들어가기만
    // 해도 권한 요청이 떴다. 이제 요청은 여기(시작 버튼의 사용자 제스처 콜스택)서만 일어난다
    // (iOS의 제스처 요건 [IOS-5]에도 부합). 승인되면 MIC_SETTLE_MS(1초) 정착 후에 화면을
    // 전환한다(민구 원문: "바로 음성 입력 화면 전환시 일부 초기 음성 클립 생성이 안됨").
    // 거부/실패 시에는 지연 없이 즉시 진행한다 — 기존 폴백(아래 fire-and-forget init 재시도 +
    // micLost/재연결 배너)이 그대로 받는다. 이 await 구간 phase는 아직 'ready'(화면 전환 전).
    if (startingRef.current) return false; // 정착 대기 중 재클릭 → 이중 세션 시작 차단
    startingRef.current = true;
    try {
      // v0.51 [rauth P2] — 마이크 획득 **이전**, 이 클릭의 제스처 안에서 토큰을 선제 갱신한다.
      // 계약·근거는 googleAuth.refreshBeforeSessionStart 주석(유효 토큰이면 null → await 0회).
      const preRefresh = refreshBeforeSessionStart();
      if (preRefresh) await preRefresh;
      if (!recorderRef.current) recorderRef.current = new AudioRecorder();
      prog(1, '마이크 권한을 확인하는 중…');
      const granted = await recorderRef.current.init().catch(() => false);
      prog(2, granted ? '마이크가 준비됐어요' : '마이크를 열지 못했어요',
        granted ? undefined : '마이크 권한을 확인해 주세요');
      // 🔴 테스트 전용 우회(조용한 우회 금지): 픽스처가 `window.__micSettleSkipForTest = true`를
      //    세우면 **정착 지연만** 생략한다(요청 시점·횟수 계약은 그대로). 제품 경로의 1초 지연과
      //    이 우회 심 자체를 tests/v0440-c8-flow.spec.ts가 모두 오라클로 고정한다 — 심을 지우면 red.
      const skipSettle =
        (window as unknown as { __micSettleSkipForTest?: boolean }).__micSettleSkipForTest === true;
      if (granted && !skipSettle) {
        const t0 = Date.now();
        // ③ **음성 안내가 실제로 났는가.** 08-07 무음 사고(회차 SSOT §2)를 여기서 잡는다 —
        //    종전엔 세션이 한참 진행된 뒤에야 사용자가 알았다.
        prog(2, '음성 안내를 확인하는 중…');
        const warm = await ttsWarmup;
        const ttsOk = warm === 'spoken';
        prog(3, ttsOk ? '음성 안내가 준비됐어요' : '음성 안내가 나오지 않아요',
          ttsOk ? undefined : '소리가 안 들리면 일시정지 후 재시작해 주세요');
        // ④ **마이크 안정화** — 첫 클립 유실 완화(WS-2 승계 목적). 위 확인들이 이미 쓴 시간을
        //    빼고 남은 만큼만 기다린다. 🔑 **고정 대기가 아니라 「최소 보장」이다**(민구 요구).
        prog(3, '마이크를 안정시키는 중…');
        const spent = Date.now() - t0;
        if (spent < MIC_SETTLE_MS) await new Promise((r) => setTimeout(r, MIC_SETTLE_MS - spent));
        prog(4, '준비 완료');
        // 다음 로그에서 「시작 시점에 무엇이 준비됐나」를 판정할 수 있게 남긴다.
        logCell({ type: 'app', extra: `start_ready:audio=${audioOk ? 'ok' : audioCtxState},mic=${granted ? 'ok' : 'fail'},tts=${warm},ms=${Date.now() - t0}` });
      }
    } finally {
      startingRef.current = false;
      // 🔴 성공·실패·중도이탈 어느 경로로 빠져나가도 진행바를 반드시 지운다 —
      //    남으면 ready 화면에 유령 진행바가 붙는다.
      useSessionStore.getState().setStartProgress(null);
    }
    // 🔴 F18 리뷰 B1 — await 창에서 언마운트됐으면(탭 이탈) 여기서 끝낸다. 이 클로저가
    // 만든 레코더의 스트림을 되돌려 놓는다(획득 세대 카운터가 늦게 열린 스트림도 닫는다 —
    // audioRecorder [리뷰#6]). 세션은 올리지 않는다: 올리면 새 훅이 닿을 수 없는 고아다.
    if (disposedRef.current) {
      recorderRef.current?.dispose();
      recorderRef.current = null;
      return false;
    }

    sessionTargetRef.current = target;
    sessionColumnsRef.current = columns;
    setSessionColumns(columns);

    // v0.35.0 R3-FIX-1 — 방어적 초기화. stop()이 이미 풀지만, stop을 거치지 않은 경로(크래시 후
    //   재개·언마운트/리마운트 등)로 래치가 남아 들어와도 새 세션은 항상 깨끗한 상태에서 시작한다.
    //   already-false면 no-op(로그도 없음).
    clearUiSuspendLatch('start');
    // v0.45.0 WP-2 — 같은 방어: 이전 세션의 임계 타이머·유지 관측·정지 시퀀스가 새지 않게.
    clearBgOffTimer();
    bgKeepRef.current = null;
    bgOffGenRef.current += 1;

    const startTs = Date.now();
    sessionIdRef.current = `sess_${startTs}`;
    // v0.15.0 A3 — 같은 날 자동 세션명 중복 방지. 라벨 생성 출처(설정탭 sessionAutoLabel / 입력탭
    // buildAutoLabel)와 무관하게, 세션 생성 시점에 기존 세션 라벨과 충돌하면 `-2`,`-3`… 순번을 붙여
    // 고유화한다(데이터탭에서 같은 날 세션 구분). 라벨이 비면(undefined) 손대지 않는다.
    const baseLabel = label?.trim();
    sessionLabelRef.current = baseLabel
      ? ensureUniqueSessionLabel(baseLabel, useDataStore.getState().sessions.map((x) => x.label))
      : undefined;
    sess.resetAll();
    // v0.47.0 W4(FB-E) — 세션 경계: 영속 ✓ 집합 리셋(이전 세션의 확정 표시가 새지 않게).
    useSessionCommitMarks.getState().reset();
    // v0.47.0 C-FIX2b — 세션 경계: 셀 저장 실패 배너도 리셋(유령 배너 방지).
    useCellPersistError.getState().clear();
    // D-2 (RACE-7): persist session id/startedAt in the store so an in-app unmount during pause
    // can't lose them. MUST run AFTER resetAll() — resetAll clears sessionId/startedAt too.
    sess.setSessionMeta({ sessionId: sessionIdRef.current, startedAt: startTs, label: sessionLabelRef.current });
    sess.setPhase('active');
    sess.setActiveRow(1);
    sess.setActiveCol(0);

    if (!isSpeechSupported()) {
      sess.setLastTts('이 기기는 음성 인식을 지원하지 않습니다.');
      return false;
    }

    // 🔴 v0.46.1 WP-1 — `warmupTts()`는 **위 동기 구간으로 올렸다**(첫 await 앞).
    //    여기(gUM await + 1초 정착 뒤)에 있던 것이 08-07 TTS 무음 11건의 근인이었다.
    //    되돌리지 마라 — 되돌리면 iOS에서 다시 무음이 된다.
    // v0.5.0 W1: 세션 시작 시 음성 목록 재조회 1회 — iOS가 늦게 채운 한국어 음성을
    // 이 세션의 TTS가 바로 쓸 수 있게 하고, tts_voices_loaded 텔레메트리(개수 변화 시)도 남긴다.
    refreshVoices();
    // 🔴 fixdc2 RD-3(b) — 세션 경계는 **배리어**다. 붙잡힌 put이 `stop()` 해체를 넘겨 살아 있으면
    //   옛 세션의 착지가 여기서 되살아나 `awaitingFieldRef`를 비운다(새 세션 첫 셀 = 입력 불능).
    resetEpoch({ newSession: true });
    pendingClipsRef.current = {};
    clipCapture.resetCounters();
    brokenClipKeysRef.current = new Set();
    correctionBackupRef.current = null;
    trendSkipLoggedRef.current = new Set();
    // v0.22.0 P0 — micLost 게이트 리셋: 이전 세션이 마이크 소실로 끝났어도 새 세션은 깨끗한
    // 스트림으로 시작한다(start()가 새 AudioRecorder.init()로 재획득).
    micLostLatchedRef.current = false;
    setMicLost(false);
    // v0.50 [CLIP-SILENT-1] — 클립 결산·연속 실패 카운터도 세션 경계에서 비운다(이전 세션의
    // 실패가 새 세션의 첫 클립을 임계로 밀어 올리면 안 된다).
    clipHealthRef.current.reset();
    // v0.51 [CLIP-MUTED-SPAN-1] — muted **구간 수**도 세션 경계에서 비운다(결산이 이전 세션의
    //   구간까지 세면 안 된다). 🔴 현재 muted 여부는 비우지 않는다 — 그건 물리적 사실이고
    //   세션 경계와 무관하다(`micInterruption.resetMicInterruptionSpans` 주석이 SSOT).
    resetMicInterruptionSpans();
    // 🔴 [CF-2] 고지 재무장은 **세션 경계에서만**이다. 이 한 줄을 빠뜨리면 다음 세션에서 상태가
    //   true로 남아 상승 에지가 없어 **고지가 아예 안 나간다**(반대 방향 결함).
    setClipFailAlert(false);
    // (UI 음성명령 신호 클리어는 F18로 setPhase('active') **이전**으로 이동 — 위 주석 참조.)
    sessionTodayRef.current = localTodayISO();
    // v0.8.0: 과거값 인덱스 프리페치(fire-and-forget) — 마스터 토글 제거 → 이상치 알람 규칙
    // (방향 trendRule 또는 변동률 pctThreshold)이 한 컬럼이라도 있고 Google 연결 시에만.
    // loadPastIndex는 모든 실패를 null로 해소하고 past_index_skip 텔레메트리만 남기므로
    // 세션 시작 흐름을 절대 막지 않는다. 셀 단위 검사(evaluateTrend)는 이 캐시만 읽는다.
    // v0.34.0 D11a — 규칙 '개수'를 세션 스냅샷 meta에도 박제(개수만 — 컬럼명 등 내용 제외).
    const anomalyRuleCount = columns.filter(
      (c) => c.trendRule === 'increase' || c.trendRule === 'decrease' || c.pctThreshold != null,
    ).length;
    const anyAnomalyRule = anomalyRuleCount > 0;
    // v0.33.0 항목5 — 영속 폴백 하이드레이션(idempotent, 토큰 무관). 미로그인/토큰 만료 세션에서도
    // IDB 스냅샷이 있으면 evaluateTrend가 폴백으로 알람을 발화한다(App 부트 경로와 이중 안전망).
    void hydratePastIndexFallback();
    // v0.34.0 C9(d) — 토큰 조건을 (토큰 || API key)로 완화(readonlySheetsAuth SSOT). 공개 시트면
    // 토큰 만료 세션에서도 신선 인덱스를 당길 수 있다 — [TREND-AUTH-1]의 침묵 창이 좁아진다.
    if (anyAnomalyRule && readonlySheetsAuth()) { resetPastIndexRetries(); prefetchPastIndex(); }
    logger.setSessionId(sessionIdRef.current);
    // #1 reach telemetry: attach session-meta alongside the existing `extra:'start'` tag.
    // `extra` is preserved so any analysis keying on it keeps working; new fields are additive.
    logCell({
      type: 'session',
      extra: 'start',
      meta: {
        appVersion: logger.device().appVersion,
        startedAt: Date.now(),
        totalRows: total,
        completedRows: 0,
        // v0.23.0 입력탭#2 — 세션 시작 시 활성 인식 허용범위를 박제(설정값 미로깅 갭 해소).
        recognitionTolerance: s.recognitionTolerance,
        // v0.34.0 D11a — 세션 시작 설정 스냅샷(자가검증 계측): 비프 최종 선택·TTS 속도·자동 캡처·
        // 이상치 규칙 규모를 로그만으로 판정. anomalyRuleCount는 개수만(컬럼명 등 내용 제외).
        ttsRate: s.ttsRate,
        beepPositiveId: s.beepPositiveId,
        beepNegativeId: s.beepNegativeId,
        autoScreenCapture: s.autoScreenCapture,
        anomalyRuleCount,
        // v0.45.0 WP-1③ — D1 말끊기 스냅샷(축 C 판정 전제). :2512가 이미 읽는 같은 s를 재사용.
        bargeInEnabled: s.bargeInEnabled,
        // v0.51.1 L(민구 지시 09-02) — 대상 시트(앞 8자·탭·행 수). 판독이 sessions.json 없이 시트를 식별한다.
        //   위 `target`은 이 함수 첫머리에서 고정한 세션 목적지(sessionTargetFromSettings)와 같은 객체다.
        target: target ? { sheet: target.spreadsheetId.slice(0, 8), tab: target.sheetTab, rows: total } : null,
        // NOTE: session label intentionally NOT logged — buildAutoLabel derives it from the first
        // fixed auto column (농가명 = grower name), a PII vector. Reach is fully computable from
        // sessionId + appVersion + totalRows + completedRows. The label still lives on the Session
        // object (unchanged); it just stays out of telemetry events.
        sessionMode: 'field',
      },
    });

    // F18 이후에도 이 fire-and-forget init은 남긴다: 위 선행 획득이 성공했으면 멱등(스트림 존재 →
    // 즉시 true, getUserMedia 재호출 없음)이고, 거부/실패였으면 여기가 재시도 폴백이다. ui_fx/
    // input_device 텔레메트리의 방출 지점이기도 하다. STT 기동을 막지 않도록 await하지 않는다.
    if (!recorderRef.current) recorderRef.current = new AudioRecorder();
    // 🔴 v0.43.0 #4 — 레코더는 **세션 간 재사용된다**(위 조건이 null일 때만 새로 만든다). 그래서
    //   백그라운드에서 캡처를 끈 뒤 복귀 이벤트를 못 받고 세션이 끝나면(탭 unmount 등) 트랙이
    //   꺼진 채 남아 **다음 세션이 조용히 무음을 녹음한다.** 세션 경계에서 무조건 되돌린다.
    recorderRef.current.setCaptureEnabled(true);
    // v0.34.0 D11b — 파동 통계 리셋: F18의 선행 획득(클릭~1초 정착)이 세션 확정 전부터 캡처를
    // 돌리므로 세션 밖 구간이 wave_stats에 섞이지 않게 시작 시점에 0으로 되돌린다.
    recorderRef.current.resetWaveStats();
    // #4 active mic: once init() resolves, emit a follow-up session event carrying the granted
    // input device. Done async (not awaited) so STT startup is never blocked; emitted as its own
    // event so analysis can attribute STT accuracy to the real device per session.
    const recAtStart = recorderRef.current;
    void recAtStart.init().then((ok) => {
      // v0.34.0 D11b — UI 이펙트 자가검증 1건: 파동/글로우 활성 + 프리롤 캡처 경로. init 실패
      // (ok=false)여도 남긴다 — preroll=unavailable이 곧 "파동 무동작(레벨 0 폴백)" 판정 근거.
      logCell({
        type: 'session',
        extra: `ui_fx:wave=on,glow=on,preroll=${recorderRef.current?.getPrerollKind() ?? 'unavailable'}`,
      });
      if (!ok) {
        // v0.44.1 [CLIP-INIT-SILENT-1] — 시작 마이크 획득 실패는 여기까지 **무음**이었다.
        // 2026-08-05 실기기(sess_1785877588821): 85분 백그라운드 복귀 뒤 시작 클릭의 gUM이 즉시
        // 거부됐는데([MIC-B2] 물림 클래스) 아무 경고가 없어 37분·63행이 클립 0개로 돌았고, 수동
        // 재연결 16회도 전부 NotAllowedError였다(물림은 페이지 수명 내내 지속 — 실효 복구는 앱
        // 재시작뿐). 값 커밋(STT)은 이 스트림과 무관해 정상이므로 세션은 막지 않는다. 대신
        // ①실패 사유 계측 ②micLost 래치(재연결 배너를 첫 화면부터) ③TTS 1회 고지(현장은
        // 화면을 안 본다)를 즉시 한다. TTS는 interrupt=false — 시작 안내를 끊지 않고 뒤에 잇는다.
        if (disposedRef.current || recorderRef.current !== recAtStart) return;
        logCell({ type: 'error', extra: micInitFailed(recAtStart.getLastInitError() ?? 'unknown') });
        maybeAutoRecoverOrLatch('init_failed');
        void say('주의. 음성 클립이 저장되지 않습니다. 재연결이 안 되면 앱을 껐다 다시 열어 주세요.', false).catch(() => {});
        return;
      }
      const input = recorderRef.current?.getActiveInput();
      if (!input) return;
      logCell({
        type: 'session',
        extra: 'input_device',
        meta: {
          appVersion: logger.device().appVersion,
          inputDeviceId: input.deviceId,
          inputDeviceLabel: input.label,
        },
      });
      // §5-1 ③(v0.44.0) — 입력장치 종류 계측: 세션 시작 시 best-effort 분류 + 원시 라벨 1회.
      // §D의 인과(스피커폰 half-duplex 필요)를 다음 실기기 로그에서 로그만으로 확정하는 축이다.
      // 분류 휴리스틱·한계(출력 경로 측정 불가 = speakerphone 부재, [AUDIO-INPUT-2] frozen 라벨)는
      // classifyAudioInputClass 주석이 SSOT. 장치 변경 감지 시의 방출은 audioRecorder의
      // emitInputDeviceChanged(라벨 실제 전이 게이트)에 동승한다 — 링버퍼 잠식 없음.
      logCell({
        type: 'session',
        extra: audioInputClass({ cls: classifyAudioInputClass(input.label), src: 'session_start' }),
        text: input.label,
      });
    }).catch(() => {});

    await say('음성 입력을 시작합니다.');
    await announceRowDiff(null, 1);

    // 🔴 v0.43.0 1c [TEST-CLIP-F-1] — **start()가 UI suspend 래치를 존중한다.**
    //   위 두 await(시작 TTS·행 안내)는 실기기에서 수 초다. 그 창에 오버레이(개선요청·수동입력·
    //   도움말·종료확인)가 열리면 suspendRecognitionForUi가 이미 돌아 래치가 걸려 있는데,
    //   종전 코드는 그걸 확인하지 않고 인식기를 새로 만들어 기동했다 — **모달 뒤에서 STT가 살아
    //   배경 발화가 셀에 커밋되는 데이터 무결성 결함**(판정: v037-suspend-latch A의 오라클 위반).
    //   덤으로 hadController가 false로 스냅샷돼 모달을 닫아도 재무장이 죽었다(F가 red였던 이유).
    //   → 래치가 걸려 있으면 **인식기를 만들지 않고 복원 의무만 남긴다.** 마지막 소스가 해제되면
    //   resumeRecognitionForUi가 :2358에서 인식기를 만들고 :2355가 pending 좌표로 재무장한다.
    //   **새 경로를 만들지 않는다 — 기존 복원 경로에 그대로 합류한다.**
    if (uiSuspendRef.current.reasons.size > 0) {
      uiSuspendRef.current.hadController = true;
    } else {
      ctrlRef.current = new SpeechController({
        onFinal: handleFinal,
        onInterim: handleInterim,
        onError: () => {},
      });
      setActiveController(ctrlRef.current);
      ctrlRef.current.start();
    }

    await announceField(vc[0]);
    return true;
  }, [announceField, announceRowDiff, handleFinal, handleInterim, say, clearUiSuspendLatch]);

  const stop = useCallback(async (announce = true) => {
    const phaseAtEntry = useSessionStore.getState().phase;
    // v0.35.0 P1 — 종료 teardown 전체를 단일 비대화형 phase로 잠근다. 첫 await보다 먼저 전환해야
    // pause→stop 사이 재시작, 완료행 이동, 중복 stop이 같은 이벤트 루프 틈에서도 끼어들 수 없다.
    if (phaseAtEntry === 'stopping') return false;
    useSessionStore.getState().setPhase('stopping');
    setActiveController(null);
    ctrlRef.current?.stop();
    ctrlRef.current = null;
    cancelTts();
    awaitingFieldRef.current = null;
    // 리뷰 라운드1(Codex+Flash, 수용) — 종료 전환 시 미확정 interim 표시 정리(표시 전용).
    useSessionStore.getState().setInterimValue(null);
    // v0.47.0 W2(FB-G①) — 세션 종료도 종단 착지: 수정 표시·성공 국면 명시 해제(잔존 방지).
    useSessionStore.getState().setModifyIndicator(null);
    useModifyPhase.getState().setCommitted(false);
    // v0.47.0 C-FIX2b — 셀 저장 실패 배너 해소: stop의 persistSession이 세션 전체(미저장 셀 값
    // 포함)를 다시 쓰고, 그 실패는 stop 전용 persistError 모달이 이어받는다(이중 모달 방지).
    useCellPersistError.getState().clear();
    // v0.35.0 R3-FIX-1 — 종료 확인 '확인' 경로는 resume 없이 여기로 온다. 래치를 여기서 풀지 않으면
    //   다음 세션의 모달 suspend가 전부 조기 반환돼 STT가 안 멈춘다. 복원은 불필요(세션 종료 중).
    clearUiSuspendLatch('stop');
    // v0.45.0 WP-2 — 세션 경계: 임계 타이머·유지 관측 정리 + 진행 중 정지 시퀀스 무효화(세대).
    clearBgOffTimer();
    bgKeepRef.current = null;
    bgOffGenRef.current += 1;
    // #1 reach telemetry: session-meta on stop. `extra:'stop'` preserved; new fields additive.
    // completedRows here is the denominator-complement for reach/completion-rate aggregation.
    {
      const sessNow = useSessionStore.getState();
      const input = recorderRef.current?.getActiveInput();
      logCell({
        type: 'session',
        extra: 'stop',
        meta: {
          appVersion: logger.device().appVersion,
          startedAt: parseInt(sessionIdRef.current.replace('sess_', ''), 10) || undefined,
          finishedAt: Date.now(),
          totalRows: computeTotalRows(getSessionColumns()),
          completedRows: sessNow.completedRows.length,
          // label intentionally omitted (PII — grower name); see start-event note.
          inputDeviceId: input?.deviceId,
          inputDeviceLabel: input?.label,
          sessionMode: 'field',
        },
      });
    }
    // v0.34.0 D11b — 세션 파동 통계 1건(stop 직전, dispose 전에 읽는다). audioRecorder가 세션
    // 동안 누적한 요약치만 — 고빈도 로깅 절대 금지(ring buffer 2000 보호). 프리롤 미가용이면
    // 통계가 없어(null) 생략 — ui_fx의 preroll=unavailable이 부재 사유를 설명한다.
    {
      const ws = recorderRef.current?.getWaveStats();
      if (ws) {
        logCell({
          type: 'session',
          extra: `wave_stats:peak=${ws.peak.toFixed(2)},avg=${ws.avg.toFixed(2)},activePct=${ws.activePct}`,
        });
      }
    }
    if (announce) await say('입력을 종료합니다.');
    // Codex 3차 HIGH: 클립 저장을 dispose보다 먼저 flush.
    // dispose는 in-flight stopClip의 resolveStop을 null로 해소하지만(zombie 방지),
    // 가능하면 자연 onstop으로 실제 blob을 저장하는 것이 우선.
    // 5초 안전 타임아웃: dispose가 즉시 해소하므로 일반적으로 즉시 끝나지만 race 대비.
    await clipCapture.flushSaves(5000);
    // v0.50 [CLIP-SILENT-1] — 클립 결산 1건(신규 이벤트라 기존 바이트 계약과 무관). 실패가 있으면
    // 종료 화면에 남긴다 — 로그만 남기면 2026-08-19가 그대로 반복된다(값은 멀쩡해 아무도 모른다).
    const clipSummary = clipHealthRef.current.summary();
    logCell({ type: 'session', extra: clipSummaryExtra(clipSummary, getAudioSessionEventCount()) });
    // 🔴 v0.51 [CLIP-MUTED-SPAN-1] — **신규 이벤트**(기존 `clip_summary`는 바이트 불변 —
    //   PRINCIPLES §4, 민구 확정 ③A). muted가 없는 세션에는 안 나가므로 링버퍼 잠식이 없다.
    //   🔴 v0.51 r2 [P1-2] — 게이트가 `unreliable > 0`**만**이면 실측 사고 형상(muted 구간 클립이
    //   전부 `failed`)에서 이 이벤트가 **아예 안 나간다.** 그러면 판독은 `clip_summary:failed=3`만
    //   보고 **사유(마이크 인터럽트)를 못 읽는다** — 고지는 나갔는데 결산엔 없는 상태다.
    if (clipSummary.unreliable > 0 || clipSummary.mutedFailed > 0) {
      logCell({
        type: 'session',
        extra: clipUnreliableSummaryExtra(clipSummary.unreliable, getMutedSpanCount(), clipSummary.mutedFailed),
      });
    }
    // 분모는 「값 커밋 시 클립을 정지 대기까지 보낸 횟수」다 — v0.51부터 `unreliable`이 그 합에
    // 들어간다(종전엔 그 클립들이 `saved`에 섞여 있었다. 합계 자체는 달라지지 않는다).
    // 🔴 `mutedFailed`는 **여기 더하지 마라** — `failed`의 부분집합이라 더하면 분모가 커밋 수를
    //   넘는다(`clipHealth.ts`의 `mutedFailed` 주석이 SSOT).
    const clipTotal = clipSummary.saved + clipSummary.failed + clipSummary.unreliable;
    // 🔑 **두 사실을 한 문장으로 뭉치지 않는다.** 「아예 저장 안 됨」과 「저장됐는데 무음일 수
    //   있음」은 사용자가 할 행동이 다르다(후자는 들어보면 안다). 둘 다면 둘 다 보여준다.
    const clipWarnings = [
      clipSummary.failed > 0 ? clipFailSummaryScreen(clipSummary.failed, clipTotal) : null,
      clipSummary.unreliable > 0 ? clipUnreliableSummaryScreen(clipSummary.unreliable, clipTotal) : null,
    ].filter((x): x is string => x !== null);
    useSessionStore.getState().setClipWarning(clipWarnings.length > 0 ? clipWarnings.join(' ') : null);
    recorderRef.current?.dispose();
    recorderRef.current = null;
    // 🔴 v0.51.1 [CLIP-MUTED-SPAN-1] ⓓ — 유예 중인 회복 판정이 있으면 **여기서** 폐기한다(로그 1줄).
    //   다음 세션으로 새면 start()의 `clipHealth.reset()` 뒤 기준선이 낡아 진짜 손실에서 Δ≤0 → 침묵이
    //   재발한다. 🔑 dispose **뒤**여야 한다 — muted 상태로 세션을 끝내면 dispose의 detach가 unmute
    //   콜백을 만들고, 그 순간 활성 슬롯의 `sawMuted`가 아직 살아 있어 새 유예가 생길 수 있다.
    //   (위 `flushSaves` 중에 걸친 클립이 정상 해소되면 그 경로가 먼저 판정을 내고 유예는 이미 없다.)
    micInterruptionNotice.dropPendingVerdict('session_end');
    // v0.10: await로 변경 — audioClips 키가 IDB session에 확실히 저장된 후 종료
    // v0.35.0 R3-FIX-2(리뷰 라운드3, Codex High·데이터무결성) — 반환값을 **더 이상 무시하지 않는다**.
    //   persistSession은 IDB 쓰기 실패 시 false를 돌려주는데(그 자체는 이미 session_persist_failed로
    //   로깅됨 — 여기서 중복 로깅하지 않는다), 종전엔 곧장 setPhase('ready')로 넘어가 **최신 값·클립
    //   포인터가 미저장인 채** 새 세션을 시작할 수 있었다(start()의 resetAll이 메모리 사본까지 지워
    //   복구 기회 소멸). v0.34.0 "durable 실패를 삼키지 않는다" 원칙과 정면 충돌 → 실패면 ready 미전환.
    const durable = await persistSession();
    if (!durable) {
      // stopping을 유지해 '음성 입력 시작' 버튼과 모든 세션 컨트롤을 띄우지 않는다
      //   → 새 세션의 resetAll이 미저장 값을 덮을 수 없다. 화면엔 재시도 배너(VoiceScreen).
      //   logger.setSessionId도 유지 — 재시도/후속 이벤트가 같은 세션에 귀속돼야 한다.
      useSessionStore.getState().setPersistError({ retrying: false });
      logCell({
        type: 'session', extra: 'stop_persist_check:write_failed',
        row: useSessionStore.getState().activeRow,
      });
      return false;
    }
    // v0.35.0 R2-FIX-1(리뷰 라운드2, Flash Critical·데이터무결성) — setPhase('ready')를 **persist
    //   완료 뒤**로 이동. 종전엔 이 위(say/clip flush/dispose/persist await 전)에서 ready로 렌더돼,
    //   그 await 구간에 사용자가 '음성 입력 시작'을 누르면 start()의 resetAll+새 sessionId가 최종
    //   flush·audioClips 키를 덮어써 오염될 수 있었다. persist 완료까지 UI가 전용 'stopping'을
    //   유지 → race 창 제거. teardown~persist 사이 로직은 phase==='ready'에 의존하지 않음(확인).
    useSessionStore.getState().setPersistError(null);
    logCell({
      type: 'session', extra: 'stop_persist_check:ok',
      row: useSessionStore.getState().activeRow,
    });
    useSessionStore.getState().setPhase('ready');
    logger.setSessionId(undefined);
    sessionTargetRef.current = null;
    sessionColumnsRef.current = null;
    setSessionColumns(null);
    return true;
  }, [persistSession, say, clearUiSuspendLatch]);

  /** v0.35.0 R3-FIX-2 — 최종 저장 실패 후 **저장만** 재시도한다. stop()의 teardown(인식기 정지·
   *  recorder dispose·종료 안내·session:stop 로그)은 이미 끝났으므로 stop() 전체를 다시 돌리지
   *  않는다 — 값·클립 포인터는 메모리(sessionStore/pendingClipsRef)에 그대로 살아 있어 persist만
   *  다시 쏘면 된다. 성공하면 그때 비로소 ready로 전환한다. */
  const retryFinalPersist = useCallback(async (): Promise<boolean> => {
    const store = useSessionStore.getState();
    if (!store.persistError || store.persistError.retrying) return false;
    store.setPersistError({ retrying: true });
    const durable = await persistSession();
    logCell({
      type: 'session', extra: `stop_persist_retry:${durable ? 'ok' : 'write_failed'}`,
      row: useSessionStore.getState().activeRow,
    });
    if (!durable) {
      useSessionStore.getState().setPersistError({ retrying: false });
      return false;
    }
    useSessionStore.getState().setPersistError(null);
    useSessionStore.getState().setPhase('ready');
    logger.setSessionId(undefined);
    sessionTargetRef.current = null;
    sessionColumnsRef.current = null;
    setSessionColumns(null);
    return true;
  }, [persistSession, clearBgOffTimer]);

  /** Pause STT value processing without stopping the controller.
   *  The controller stays active so the user can say '재시작' to resume.
   *  Recorder is disposed to prevent clip accumulation while paused. */
  // v0.20.0 Phase 5 #3 — 일시정지/재개에 진입·해제 방식(source)을 명시 동봉. 'voice'=음성 명령,
  // 'touch'=마이크 버튼 탭. 기존 호출부(VoiceScreen 탭)는 인자 없이 호출하므로 기본값을 둔다 —
  // 그 경로가 곧 touch다. extra를 `phase:<source>`로 확장(신규 이벤트 타입 무첨가, log-replay 호환).
  // 다음 분석이 "일시정지 횟수 + 어떤 방식으로 해제했는지"(민구 요청·Trace #4)를 정량화한다.
  const pause = useCallback(async (source: 'voice' | 'touch' = 'touch') => {
    if (useSessionStore.getState().phase === 'stopping') return;
    // v0.34.0 리뷰 라운드2(Codex High) — manualHold 중 일시정지 거부. paused 진입은 팝업 렌더를
    // PausedCard로 교체해(VoiceScreen 분기: paused가 알람보다 우선) 보류를 화면에서 지워버린다.
    if (isManualHoldBlocked('pause')) return;
    logCell({ type: 'command', parsed: 'pause', extra: `phase:${source}`, row: useSessionStore.getState().activeRow });
    cancelTts();
    // dispose가 in-flight stopClip을 null로 해소해 정상 클립이 clip_empty로 떨어지는 것을 방지:
    // stop()과 동일하게 pending save를 먼저 flush.
    await clipCapture.flushSaves(PAUSE_FLUSH_GRACE_MS);
    recorderRef.current?.dispose();
    recorderRef.current = null;
    useSessionStore.getState().setPhase('paused');
    // 리뷰 라운드1(Codex+Flash, 수용) — 일시정지 진입 시 미확정 interim 표시 정리. 발화 도중
    // 정지하면 final이 안 와, 재개 화면에 이전 발화가 현재 값처럼 남던 찌꺼기 차단(표시 전용).
    useSessionStore.getState().setInterimValue(null);
    useSessionStore.getState().setLastTts('일시정지됨. 마이크 다시 탭하면 재개됩니다.');
    await say('일시정지됨.');
  }, [say]);

  /** Resume from paused: re-announce current field. Controller is kept alive during pause. */
  const resume = useCallback(async (source: 'voice' | 'touch' = 'touch') => {
    const sess = useSessionStore.getState();
    if (sess.phase === 'stopping') return;
    if (sess.phase !== 'paused') return;
    // v0.20.0 Phase 5 #3 — 해제 방식 동봉(voice='재시작' 음성, touch=마이크 버튼). 일시정지가 어떤
    // 경로로 풀렸는지를 정량화해 "분투→해제" 패턴(강남호 13/14 churn)을 다음 세션부터 분해한다.
    logCell({ type: 'command', parsed: 'resume', extra: `phase:${source}`, row: sess.activeRow });
    sess.setPhase('active');
    // 🔴 fixdc2 RD-3 — 재개 «자신»의 bump를 흡수한다. 음성 '재시작'은 `pausedResume`이
    //   `epochRef.current++` 뒤 **동기로**(사이에 `cancelTts()`뿐, await 없음) 이 함수를 부르므로
    //   **정확히 1회**다(`useFinalCommands.ts:294` · 명령 공통 bump `:370`→`:440`도 같은 형태).
    //   터치 재개(마이크 버튼 → `VoiceScreen.tsx`)는 선행 bump가 **없다**.
    //   흡수하지 않으면 음성 재시작이 스스로를 경합자로 만들어 진행 중인 착지를 죽인다(U1 재개방).
    //   ⚠️ 그 인접성이 이 인자의 유일한 근거다 — `useFinalCommands`가 그 형태를 바꾸면 여기가
    //     조용히 틀어진다. 그래서 오라클 ⑤가 그 형태를 **구조로** 잠근다.
    resetEpoch({ ownBumps: source === 'voice' ? 1 : 0 });
    // Controller stays alive during pause (pause() no longer stops it).
    // Recreate only if it was somehow stopped (e.g., programmatic stop from outside).
    if (!ctrlRef.current) {
      ctrlRef.current = new SpeechController({
        onFinal: handleFinal,
        onInterim: handleInterim,
        onError: () => {},
      });
      setActiveController(ctrlRef.current);
      ctrlRef.current.start();
    }
    // Recorder was disposed during pause — recreate for the resumed session.
    if (!recorderRef.current) {
      recorderRef.current = new AudioRecorder();
      await recorderRef.current.init().catch(() => {});
      // v0.22.0 P0 — 재개는 fresh AudioRecorder.init()로 살아있는 스트림을 새로 잡으므로 micLost
      // 게이트를 푼다(일시정지 전 마이크 소실로 켜졌던 재연결 버튼이 멀쩡한 마이크에 남지 않게).
      micLostLatchedRef.current = false;
      setMicLost(false);
    }
    const vc = voiceColsList();
    const cur = vc[sess.activeColIdx];
    await say('재시작.');
    // v0.45.0 WP-3 (F14) — 재시작 브리핑: 현재 행 요약("나무 3, … 45.1. 다음.") 뒤에
    // announceField가 항목명을 잇는다(Q5 형식 완성: "…, 다음, 횡경."). 일시정지 중 복귀는
    // 브리핑을 생략하고 이 '재시작' 시점이 담당한다(Q4-답 — 이중 낭독 방지).
    const briefing = buildReturnBriefing(false);
    if (briefing) await say(briefing, false);
    // 🔴 v0.47.0 C-FIX1ⓐ(리뷰 U2, Codex 프로브 재현) — **수정 재청취 중 일시정지→재개가 수정
    //   문맥을 지우면 안 된다.** 종전엔 무옵션 announceField(cur)가 awaiting을 kind:'value'로
    //   덮고 modifyIndicator를 해제해, 성공 커밋 전인데 amber가 꺼지고(green 오표시) 다음
    //   발화가 '수정'이 아닌 일반 커밋 의미론으로 흘렀다. pause()는 awaitingFieldRef를 보존
    //   하므로 여기서 그 문맥을 그대로 재안내한다(isModify — 진입 중립음·amber·previousValue 복원).
    // 🔴 C-FIX1b(2차 재검증) — **문맥은 전체를 보존한다.** 1차는 kind·previousValue만 넘겨
    //   fractionWhole(소수부 재질문의 정수부, :88-93)이 유실됐다 — "111 점 에" 재질문 중
    //   일시정지→재시작 뒤 "5"가 111.5 합성 대신 전체값이 될 수 있다(값 추측 금지 계약 :113-120이
    //   데이터 오염으로 규정). announceField에 fractionWhole 전달로를 뚫어 재구성이 무손실이
    //   되게 했다(value-kind 재질문도 같은 축 — 아래 announceField(cur) 호출에 동일 전달).
    {
      const awaiting = awaitingFieldRef.current;
      const fw = awaiting ? fractionWholeOf(awaiting) : undefined;
      if (awaiting?.kind === 'modify') {
        const target = getColById(awaiting.colId);
        if (target) {
          await announceField(target, { isModify: true, previousValue: awaiting.previousValue, fractionWhole: fw });
          return;
        }
      }
      // C-FIX1b — trendConfirm(이상치 응답 대기)도 같은 축이다(실측 확인: 터치 [일시정지]는
      // manualHold만 막고 trendConfirm은 통과한다). announceField(cur)를 부르면
      // clearAnomalyAlert('announce_field')가 알람을 지우고 awaiting이 value로 덮여 **확인
      // 루프가 무응답으로 소멸**한다. 재구성하지 않고 그대로 둔다 — 팝업은 paused 해제로
      // 다시 보이고, awaiting·previousValue·fractionWhole 전부 산 채로 응답을 기다린다.
      // 응답 발화 클립만 재무장한다(pause가 recorder를 dispose했다 — 알람 시점의 arm은 죽었다).
      if (awaiting?.kind === 'trendConfirm') {
        armClipForCell(awaiting.row, awaiting.colId);
        return;
      }
      // 🔴 v0.49 fix49 — 셀 검토 대기(cellWait)도 **문맥을 보존해야 하는 국면**이다(위 두 분기와
      //   같은 축). 여기서 아래 `announceField(cur)`로 떨어지면 커서가 서 있던 **값 있는 셀에
      //   `kind:'value'`가 다시 열려** B-1이 재개방된다 — 실측 확인: 35.1 주차 → 일시정지 →
      //   재시작 → "99.9" → 셀이 99.9. 이동 경로만 막고 여기를 두면 처방이 반만 닫힌다.
      //   ⚠️ v0.49 r6 Y2 — 종전 이 자리의 *"`reviewWait`/`atEnd`도 같은 형태로 새지만 선행
      //   파손이라 건드리지 않는다(`_ASK-fix49` Q5). 고칠 사람은 이 목록에 두 kind를 더 얹으면
      //   된다"* 를 **집행한다.** 실측(fixr6): 끝 도달에서 일시정지→재시작 뒤 「측정항목01.」이
      //   나오고(=확정 셀에 `kind:'value'` 개방) 이어 말한 값이 **확정값 35.1을 99.9로 덮었다.**
      //   검토 대기도 같다 — 완료 행 착지가 일시정지 중이면(착지는 `armLanding`이 국면만 보류하고
      //   센티넬은 세운다) 재시작이 그 문맥을 버리고 값을 연다.
      if (awaiting?.kind === 'cellWait') {
        const target = getColById(awaiting.colId);
        if (target) { await enterCellWait(target, awaiting.previousValue); return; }
      }
      // 🔴 Y2 — 두 착지는 **다시 착지시켜** 복원한다(문맥 재구성이 아니라 재실행). 그래야 국면이
      //   일시정지에 보류됐던 경우까지 함께 낫는다: `armLanding`의 paused 분기는 `setPhase`와
      //   `setEndReached`를 건너뛰므로(그 헤더) 보류된 착지의 **래치**는 아무도 복원하지 않는데,
      //   여기서 착지를 다시 부르면 phase·endReached·센티넬·낭독이 한 벌로 다시 선다.
      //   ⚠️ 이 시점 phase는 위에서 이미 `'active'`라 paused 가드에 걸리지 않는다.
      if (awaiting?.kind === 'atEnd') { await announceEndReached(); return; }
      if (awaiting?.kind === 'reviewWait') { await enterReviewWait(awaiting.row); return; }
      if (cur) await announceField(cur, fw != null ? { fractionWhole: fw } : undefined);
    }
  }, [announceEndReached, announceField, armClipForCell, enterCellWait, enterReviewWait, handleFinal, handleInterim, say, buildReturnBriefing]);

  // Keep resumeRef in sync so handleFinal can call resume without a circular dep.
  // [ENV-12] E단계 — stop/pause도 같은 매듭(선언 순서: handleFinal → start → stop → pause)이라
  // 같은 effect에서 채운다. 명령 스테이지 훅이 이 셋을 ref로 주입받는다(그 선언부 주석 참조).
  useEffect(() => {
    resumeRef.current = resume;
    stopRef.current = stop;
    pauseRef.current = pause;
  }, [resume, stop, pause]);

  // hydrateSessions가 IDB의 pendingValidation을 sessionStore에 복구한 뒤 VoiceScreen이 마운트된다.
  // 팝업만 복원하고 이 내부 포인터를 비워 두면 [확인]이 advance 문맥을 잃으므로 같은 셀/검토대기를
  // 재구성한다. manualHold 게이트가 살아 있어 복구 중 STT가 후보를 우회 커밋할 수는 없다.
  useEffect(() => {
    const live = useSessionStore.getState();
    const restoredSession = useDataStore.getState().sessions.find((s) => s.id === live.sessionId);
    const pending = restoredSession?.pendingValidation;
    if (!pending || !live.anomalyAlert?.manualHold) return;
    sessionIdRef.current = live.sessionId;
    sessionLabelRef.current = live.sessionLabel;
    sessionTargetRef.current = restoredSession.target ?? null;
    sessionColumnsRef.current = restoredSession.columns;
    setSessionColumns(restoredSession.columns);
    logger.setSessionId(live.sessionId);
    // v0.47.0 W4(FB-E) 🟡 hydrate 가정 — 복원 세션의 **값이 있는 셀 = 과거 성공 커밋**으로
    //   ✓ 집합을 재구성한다("이 칸은 채워졌다"는 reload를 넘어 이어진다고 읽음). 단, 지금
    //   복구 중인 미확정 후보 셀(pending)은 제외 — [확인] 시점에 add된다.
    {
      const seed: Array<{ row: number; colId: string }> = [];
      for (const r of restoredSession.rows) {
        for (const [colId, v] of Object.entries(r.values)) {
          if (v !== '' && !(r.index === pending.row && colId === pending.colId)) {
            seed.push({ row: r.index, colId });
          }
        }
      }
      useSessionCommitMarks.getState().reset(seed);
    }
    const col = getColById(pending.colId);
    if (!col) return;
    awaitingFieldRef.current = pending.reviewWait
      ? { kind: 'reviewWait', row: pending.row, colId: pending.colId, name: col.name }
      : { kind: 'modify', row: pending.row, colId: pending.colId, name: col.name, previousValue: pending.candidateValue };
    // reload 전 컨트롤러 인스턴스는 사라진다. 팝업만 복원하면 테스트의 fireResult가 optional no-op이고,
    // [확인] 뒤 다음 셀도 영구 무음이 된다. 실제 SpeechController를 다시 만들되 manualHold 중앙 게이트가
    // 복구 직후 STT 결과를 모두 거부하므로 후보는 터치 전용 계약을 유지한다.
    if (isSpeechSupported() && !ctrlRef.current) {
      ctrlRef.current = new SpeechController({
        onFinal: handleFinal,
        onInterim: handleInterim,
        onError: () => {},
      });
      setActiveController(ctrlRef.current);
      ctrlRef.current.start();
      logger.log({ type: 'stt', extra: 'manual_hold_restore_controller:started', sessionId: live.sessionId, row: pending.row, colId: pending.colId });
    }
  }, [handleFinal, handleInterim]);

  // ── v0.33.0 항목4 — 포그라운드 복귀 즉시 복구(visibilitychange + pageshow) ─────────
  // 세션 활성 중(active/complete/paused — paused도 음성 '재시작'을 들어야 하므로 포함) 화면이
  // 다시 보이면: ① TTS 엔진 해동(resume — iOS가 백그라운드에서 paused로 얼려둠) ② 인식기
  // 워치독 1회 즉시 실행(kick — 죽었으면 즉시 부활, 최대 4초 tick 대기 제거) ③ 마이크 트랙
  // 정밀 판정: 'ended'만 micLost 래치(기존 배너/재연결 버튼 재사용), 'muted'는 unmute 대기 +
  // mic_track:* 텔레메트리. **제스처 밖 getUserMedia 재획득은 하지 않는다([IOS-5]).**
  // v0.38.1 [MIC-B2] ④ **장기 백그라운드(≥LONG_BACKGROUND_TEARDOWN_MS) 복귀면 낡은 오디오 그래프
  // 선-정리**(teardownAudioGraph) — 이건 phase 게이트보다 앞에서, 재획득 없이 정리만 한다. iOS
  // 오디오 세션이 물린 채 낡은 AudioContext가 그걸 붙들고 있으면 이후 제스처 재연결의 gUM이
  // NotAllowedError로 즉시 거부되는데(2026-07-24 실기기 세션B: 8시도/0성공), 첫 재연결 시도가
  // 그 컨텍스트 참조를 버리므로 **닫을 수 있는 창은 여기뿐**이다.
  // 인앱 탭 전환([STT-16])은 visibility가 안 변하므로 이 경로가 아니라 App.tsx의 keep-alive
  // 렌더(세션 활성 중 VoiceScreen 유지)가 담당한다.
  useEffect(() => {
    // v0.38.2 F5 — 복귀 시 오디오 경로 재검증 계측. 발행 여부 판단은 순수 함수
    // (`shouldEmitRouteRevalidate`)에 있어 브라우저 없이 경계를 검증한다.
    // 값은 raw 장치명이 아니라 CATEGORY — OS별 표기 편차를 걷어내고 개인 장치명도 로그에 남기지 않는다.
    const emitRouteRevalidate = async (
      evt: 'vis' | 'pageshow',
      beforeLabel: string | null,
      backgroundMs: number,
    ) => {
      const emit = (fields: Parameters<typeof audioRouteRevalidate>[0]) => {
        try {
          logCell({ type: 'clip', extra: audioRouteRevalidate(fields) });
        } catch {
          /* best-effort 계측 — 로그 실패가 복귀 경로를 막지 않는다 */
        }
      };
      // 레코더 미초기화 — 비교할 경로 자체가 없다.
      // 🔴 v0.42.0 계측 F: **여기서는 방출하지 않는다.** 같은 복귀의 `foreground_return`이
      // `teardown=no_recorder`로 이미 이 사실을 남긴다(2026-07-29 로그 실측 확인). 여기서 또
      // 남기면 레코더가 붙기 전 모든 복귀(`bg_s=0` 즉시 pageshow 포함)가 로그를 채워
      // **2000개 링버퍼를 잠식한다** — `[F5]` 스펙이 "임계 미만 무발행"을 계약으로 못박은 이유다.
      const rec = recorderRef.current;
      if (!rec) return;
      try {
        const { label, track, status } = await rec.revalidateActiveInput();
        // 🔴 **관측 못 한 것을 '내장 마이크'로 확정하지 않는다**(라운드A 리뷰 Codex #2).
        // `classifyInputDevice`는 빈 라벨을 내장으로 폴백하는데, 그건 **UI 배지의 표시 규칙**이지
        // "관측됐다"는 뜻이 아니다. 그 의미를 텔레메트리에 재사용하면 실기기 판독에서 `unknown`과
        // 진짜 내장 마이크를 구별할 수 없다.
        const observed = status === 'ok' && label !== null && track !== 'none';
        const afterCategory = observed ? classifyInputDevice(label).text : 'unknown';
        const beforeCategory = beforeLabel === null ? null : classifyInputDevice(beforeLabel).text;
        // 방출 게이트(경로 무변화 + 임계 미달)도 조용히 빠진다 — **의도된 침묵이다.**
        // 같은 복귀의 `foreground_return:bg_s`가 임계 미달 사실을 남기고 있어 판독이 가능하고,
        // 여기서 방출하면 짧은 탭 전환마다 로그가 쌓여 링버퍼를 잠식한다(위 `!rec`과 같은 이유).
        if (!shouldEmitRouteRevalidate({ beforeCategory, afterCategory, backgroundMs })) return;
        emit({
          before: beforeCategory ?? 'unknown',
          after: afterCategory,
          track,
          status,
          evt,
          backgroundMs,
        });
      } catch {
        emit({
          before: 'unknown',
          after: 'unknown',
          track: 'none',
          status: 'error',
          evt,
          backgroundMs,
        });
      }
    };

    const onForegroundReturn = (evt: 'vis' | 'pageshow') => {
      // reducer가 hiddenAt을 소비하기 **전**에 캡처한다. visible 직후 pageshow가 연달아 와도
      // 첫 이벤트만 true라 실제 백그라운드 사이클당 foreground_return은 정확히 1건이다.
      const hadHiddenCycle = foregroundReturnRef.current.hiddenAt !== null;
      const decision = reduceForegroundReturn(
        foregroundReturnRef.current,
        evt === 'vis' ? 'visible' : 'pageshow',
        Date.now(),
      );
      foregroundReturnRef.current = decision.state;
      // v0.38.2 F5 — 오디오 경로 재검증. teardown과 **같은 복귀 이벤트에서 짝으로** 읽히도록 여기서
      // 시작한다(비동기라 순서는 보장 안 되지만 같은 복귀 구간임은 bg_s로 대조된다).
      // phase 게이트보다 앞인 이유도 teardown과 같다 — 캡처가 세션 확정 전(F18: 시작 클릭~1초
      // 정착 구간, 구 prewarm 계보)부터 붙을 수 있다.
      void emitRouteRevalidate(evt, decision.hiddenInputLabel, decision.backgroundMs);
      // v0.38.1 [MIC-B2] 낡은 오디오 그래프 선-정리는 **세션 phase보다 먼저, phase와 무관하게** 본다.
      // (원 근거였던 「prewarm이 세션 전부터 캡처를 붙여둔다」는 F18로 사라졌지만, paused/stopping
      // 등 phase 게이트 밖 구간과 F18 선행 획득~정착 창이 남아 있어 순서는 유지한다.)
      // 물린 그래프를 진 채 세션을 시작하면 첫 획득부터 인터럽트된 오디오 세션 위에서 돈다.
      // 재획득은 하지 않는다([IOS-5] 유지) — 정리만.
      // F6 — 복귀당 정확히 1건. completed는 teardown Promise가 **실제로 끝난 뒤**에만 기록한다.
      // close/reattach 상세의 정본은 기존 mic_teardown이고, 여기서는 skipped/no_recorder/
      // completed/failed로 복귀 처리 결과만 요약한다(PRINCIPLES §4 중복 계측 금지).
      void resolveForegroundReturnEvent({
        hadHiddenCycle,
        shouldTeardown: decision.shouldTeardown,
        backgroundMs: decision.backgroundMs,
        evt,
        recorder: recorderRef.current,
      }).then((extra) => {
        if (extra) logger.log({ type: 'app', extra });
      });
      const phase = useSessionStore.getState().phase;
      if (phase !== 'active' && phase !== 'complete' && phase !== 'paused') return;
      resumeTtsEngine();
      const result = ctrlRef.current ? ctrlRef.current.kick() : 'no_controller';
      logCell({ type: 'stt', extra: `kick_result:${evt}:${result}` });
      const rec = recorderRef.current;
      if (!rec) return;
      const trackState = rec.getTrackState();
      if (trackState === 'ended') {
        // 진짜 사망(트랙 종료)만 래치 — reconnectMic 자동 1회 후 실패 시 사용자 제스처로 복구.
        if (!micLostLatchedRef.current) {
          micLostLatchedRef.current = true;
          setMicLost(true);
          logCell({ type: 'clip', extra: `mic_track:ended:${evt}` });
          // v0.50 r2 — 이 경로에도 화면을 연다(위 헬퍼 주석: 배너가 블랙아웃에 가린다).
          releaseBlackoutOnMicLost();
        }
      } else if (trackState === 'muted') {
        // UA 일시 정지(통화/Siri/라우트 변경) — 분리로 오판해 래치하지 않고 unmute를 기다린다.
        logCell({ type: 'clip', extra: `mic_track:muted:${evt}` });
        rec.onceTrackUnmuted(() => {
          logCell({ type: 'clip', extra: 'mic_track:unmuted' });
        });
      }
      // 'live'/'none'(레코더 미초기화·일시정지 해제 상태)은 무로깅 — 복귀마다 링버퍼를 잠식하지 않는다.
    };
    const onVis = () => {
      if (document.visibilityState !== 'visible') {
        // v0.38.2 F5 — **여기서 라벨을 스냅샷하는 것이 핵심.** 복귀 후에 읽으면 before/after가 같은
        // 읽기가 돼 "백그라운드 중 경로가 바뀌었다"를 판정할 수 없다.
        const decision = reduceForegroundReturn(foregroundReturnRef.current, 'hidden', Date.now(), {
          inputLabel: recorderRef.current?.getActiveInput()?.label ?? null,
        });
        foregroundReturnRef.current = decision.state;
        return;
      }
      onForegroundReturn('vis');
    };
    const onPageShow = () => onForegroundReturn('pageshow');
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  // v0.12.0 AREA1 — 입력탭 읽기전용 입력장치 CATEGORY 배지용. getUserMedia가 실제로 잡은 마이크
  // 라벨을 노출(init() 비동기 resolve 후 채워짐). 안정 참조(useCallback []) — VoiceScreen이
  // 폴링으로 읽어 classifyInputDevice로 CATEGORY를 표시한다.
  const getActiveInputLabel = useCallback(
    () => recorderRef.current?.getActiveInput()?.label ?? null,
    [],
  );

  // 계측 G·H 공용 판독 경로. 레코더 자체를 읽을 수 없으면 `none`으로 단정하지 않고 unknown.
  const getTrackState = useCallback(
    (): VoiceTrackState => recorderRef.current?.getTrackState() ?? 'unknown',
    [],
  );

  const getRuntimeSnapshot = useCallback(
    (): VoiceRuntimeSnapshot => {
      const recorder = recorderRef.current;
      const controller = ctrlRef.current;
      const suspend = uiSuspendRef.current;
      return {
        rec: !recorder ? 'none' : recorder.isRecording() ? 'recording' : 'idle',
        track: getTrackState(),
        stt:
          suspend.reasons.size > 0 && suspend.hadController
            ? 'suspended'
            : controller?.getRecognitionState() ?? 'none',
      };
    },
    [getTrackState],
  );

  // v0.34.0 B7 — 파동 레벨 getter(안정 참조, React state 금지 — 리렌더 0). rAF 소비자
  // (useAudioLevelVar)가 매 프레임 읽는다. recorder가 없거나(세션 전/일시정지) 프리롤 미가용이면 0.
  const getAudioLevel = useCallback(
    () => recorderRef.current?.getInputLevel() ?? 0,
    [],
  );

  // v0.35.0 (Vance) — 시간영역 파형 getter(안정 참조). VoiceWaveform의 rAF가 out 버퍼에 실시간
  //   샘플을 채운다. recorder 없음/analyser 미가용이면 false → 소비자가 레벨 기반 폴백.
  const getTimeDomainData = useCallback(
    (out: Uint8Array) => recorderRef.current?.getTimeDomainData(out) ?? false,
    [],
  );

  // D-2 (RACE-7): restore session id/label from the store on (re)mount. If the hook unmounted
  // mid-session (e.g. tab switch while paused) the local refs were lost, but the store kept the
  // id — recover it so resumed events and the final persist carry the correct sessionId.
  useEffect(() => {
    if (sessionIdRef.current) return;
    const s = useSessionStore.getState();
    // v0.48.1 r3 F6 — SSOT는 sessionStore.ts의 `isSessionLive`(허용목록 형태로 통합).
    if (s.sessionId && isSessionLive(s.phase)) {
      sessionIdRef.current = s.sessionId;
      sessionLabelRef.current = s.sessionLabel;
      const restoredSession = useDataStore.getState().sessions.find((x) => x.id === s.sessionId);
      if (restoredSession) {
        sessionTargetRef.current = restoredSession.target ?? null;
        sessionColumnsRef.current = restoredSession.columns;
        setSessionColumns(restoredSession.columns);
      }
      logger.setSessionId(s.sessionId);
    }
  }, []);

  // unmount cleanup
  useEffect(() => () => {
    setActiveController(null);
    ctrlRef.current?.stop();
    // StrictMode simulated teardown 뒤 effect setup이 다시 돌 때 stopped 인스턴스를 재사용하지 않는다.
    // ref가 남으면 pending restore effect의 `!ctrlRef.current` 가드가 새 컨트롤러 생성을 건너뛴다.
    ctrlRef.current = null;
    cancelTts();
    recorderRef.current?.dispose();
    // dispose된 recorder도 StrictMode 2차 setup/prewarm에서 새 인스턴스로 재생성되게 수명을 끝낸다.
    recorderRef.current = null;
    // v0.45.0 WP-2 — 언마운트가 임계 타이머를 살려두면 죽은 클로저가 10분 뒤 깨어난다.
    if (bgOffTimerRef.current !== null) {
      window.clearTimeout(bgOffTimerRef.current);
      bgOffTimerRef.current = null;
    }
  }, []);

  /** v0.33.0 항목6 — 셀 값 영속 공유 코어. 터치 인라인 편집(commitTouchValue)과 수동 입력 시트
   *  (commitManualValue)가 공유한다: sessionStore + dataStore(patchRowValues — F2: "값 변경 ⇒
   *  synced→dirty" 불변식으로 업로드된 행도 다음 sync가 시트 행을 UPDATE) + IDB 반영.
   *
   *  🔴🔴 v0.49 r6 Y1(codex R5-F1 Critical) — 종전 이 헤더의 마지막 줄은 *"행이 아직 완료된 적이
   *  없으면 sessionStore만 갱신되고, 다음 persistSession에서 자연 반영된다"* 였다. 그 문장은
   *  **다음 persist가 실제로 일어나고 성공한다**는 보장 위에 서 있었는데, 그 보장이 없었다:
   *    · 세션이 아직 IDB에 없으면(첫 커밋) `patchRowValues`는 붙일 대상이 없어 `null`을 돌려주고,
   *      이 코어는 **IDB 쓰기를 한 번도 하지 않은 채** `true`(=성공)를 반환했다.
   *    · 호출부는 그 `true`로 ✓·화음·에코·전진을 낸다. 실측(fixr6): 실패 주입 상태에서 첫
   *      키패드 커밋 한 건만 해도 **IDB 0건 · 배너 0 · ✓ 1 · 값 에코 정상**이었다(행이 완성되지
   *      않아 `finalizeRowCompletion`조차 no-op인 형상 — 즉 이 축은 Z8 배선과 무관하게 실재했다).
   *  👉 처방: null 분기를 **지연이 아니라 아직 안 쓴 상태**로 보고 `persistSession()`을 직접
   *     await한다. 그리고 그 persist가 이 행·이 값을 **실제로 실었는지**까지 확인한다 —
   *     `persistSession`은 rows를 `completedRows`+백업+`activeRow`+`skippedRows`에서만 조립하고
   *     (그 헤더) 아무것도 실을 게 없으면 **쓰지 않고 `true`** 를 돌려주므로, 반환값만 보면
   *     같은 거짓 성공이 한 겹 안쪽에서 재현된다. `dataStore`는 durable 성공 뒤에만 갱신되므로
   *     (persistSession 말미 `upsertSession`) 거기서 값을 되읽는 것이 곧 내구화 확인이다. */
  const persistCellValue = useCallback(async (row: number, colId: string, value: string): Promise<boolean> => {
    useSessionStore.getState().setRowValue(row, colId, value);
    const updatedSession = useDataStore
      .getState()
      .patchRowValues(sessionIdRef.current, row, { [colId]: value });
    if (updatedSession) {
      // 🔴 v0.47.0 C-FIX2(리뷰 U3, major) — **saveSession 실패를 삼키지 않는다.** 종전 catch{}는
      //   실패해도 호출부가 화음·에코·✓·advance로 성공을 고지하게 했다 — 유실될 값을 성공
      //   고지(PRINCIPLES §1 위반, manualHold [확인]의 durable 실패 처리와 비대칭). false를
      //   반환해 호출부가 성공 신호를 억제하고 사용자에게 고지하게 한다.
      try {
        await saveSession(updatedSession);
      } catch (e) {
        logCell({
          type: 'error',
          extra: `cell_persist_failed:${String((e as Error)?.message ?? e)}`,
          row, colId,
        });
        return false;
      }
    } else {
      // v0.49 r6 Y1 — 위 헤더의 null 분기. 실패 사유는 두 갈래이고 배너 문구는 같지만, 로그는
      //   가른다(`session_not_durable`=IDB가 거절 · `row_unlanded`=persist는 성공했는데 이 행이
      //   rows 조립에 안 실림). 기존 `cell_persist_failed:` 이벤트의 **메시지 슬롯**만 쓴다 —
      //   접두·필드 구성은 바이트 불변이라 SOP-003 소비자와 기존 오라클이 그대로 읽는다.
      const durable = await persistSession();
      const landed = (useDataStore.getState().sessions
        .find((s) => s.id === sessionIdRef.current)
        ?.rows.find((r) => r.index === row)?.values[colId] ?? '') === value;
      if (!durable || !landed) {
        logCell({
          type: 'error',
          extra: `cell_persist_failed:${durable ? 'row_unlanded' : 'session_not_durable'}`,
          row, colId,
        });
        return false;
      }
    }
    // v0.47.0 W4(FB-E) — 수동/터치 확정 커밋의 ✓ 집합 등록. 이 코어는 manualHold 후보 경로를
    //   지나지 않으므로(그쪽은 patchRowValues 직행) 미확정 후보가 ✓를 받는 일이 없다.
    //   C-FIX2 — 등록은 durable 확정 **뒤**다: 실패 시 회수(remove)가 필요 없는 순서라
    //   add 전용 집합 계약이 그대로 선다.
    //   (v0.49 r6 Y1 — 종전 이 자리의 괄호 주석은 *"updatedSession null = … 실패가 아니라 지연
    //    이므로 true"* 였다. 그 전제가 R5-F1의 근인이라 위 else 분기로 대체됐다 — 이제 여기
    //    도달은 **두 갈래 모두 durable 확정 뒤**다.)
    if (value !== '') useSessionCommitMarks.getState().add(row, colId);
    // C-FIX2b — 같은 셀의 durable 성공이 실패 배너를 해소한다(재시도 성공·수동 재입력 성공 공통).
    useCellPersistError.getState().clearIfMatches(row, colId);
    return true;
  }, [persistSession]);

  /** v0.11.0: touch 컬럼 값 commit 시 sessionStore + dataStore + IDB 모두에 즉시 반영.
   *  Codex MEDIUM: setRowValue만으로는 휘발성 상태만 변경 → sync/CSV가 누락하는 위험 해결.
   *  v0.33.0 항목6 — 영속 코어는 persistCellValue로 추출(수동 입력 시트와 공유). */
  const commitTouchValue = useCallback(async (row: number, colId: string, value: string) => {
    logCell({ type: 'command', parsed: 'touch_commit', extra: 'touch', text: value, row, colId });
    // C-FIX2 — durable 실패면 영수증(성공 표식)을 만들지 않고 고지한다.
    if (!(await persistCellValue(row, colId, value))) {
      notifyCellPersistFailed(row, colId, value);
      return;
    }
    // v0.37.0 리뷰#1 후속(Codex Medium) — 터치 인라인 커밋도 검토 영수증을 발행한다(음성·수동·이상치
    //   정정과 동일 패턴). 검토(complete) 중 터치 컬럼을 편집하면 검토 화면이 그 값을 보여야 오표시가
    //   없다. 커밋/전진 조건 무수정 — 기존 persist 뒤 표시 전용 영수증만 추가.
    const col = getColById(colId);
    if (col) useSessionStore.getState().pushCommitReceipt(row, colId, col.name, value);
  }, [notifyCellPersistFailed, persistCellValue]);

  /** v0.33.0 항목6 — 칩 터치 수동 입력(ManualValueSheet) 커밋. 음성 없이 값이 서므로:
   *   ① `manual_commit` 텔레메트리(항목3에서 예약한 기존 command 타입 + extra:'touch')
   *   ② 기존 클립 archive 후 셀 포인터 해제 — 수동 값에는 대응 음성이 없어, 이전 발화 클립이
   *      그대로 걸려 있으면 "값과 다른 오디오 재생"(155.5/177.7 계열 stale-클립 결함)이 된다.
   *   ③ persistCellValue(공유 영속 코어)
   *   ④ 이상치 검사 — 음성 확인 루프(trendConfirm) 무장·알람 TTS 없음(민구 확정)은 유지하되,
   *      v0.34.0 A1: 이 커밋이 진행을 소유하면(awaiting 셀/검토 대기) violation 시 echo/advance를
   *      **보류**하고 [확인][수정] 터치 응답을 기다린다(manualHold 팝업 — 포인터는 커밋한 칩 유지).
   *      이전엔 advance()가 먼저 실행되고 팝업 세팅이 나중이라, 팝업이 뜬 채 대상 칩이 다음 칩으로
   *      전진·활성화되던 버그(실기기 재현). awaiting이 다른 셀인 커밋의 violation은 종전대로 정보성
   *      팝업(버튼 없음, 흐름 불변) — announceField가 진입 시 팝업을 해제하므로 진행 뒤에 세팅한다.
   *   ⑤ awaiting 필드에 대한 커밋이면(무위반) echo TTS 후 advance() — 음성 커밋과 같은 진행.
   *      검토 대기(reviewWait, 항목2) 중이면 advance 대신 검토 대기를 재무장(갱신값 재낭독). */
  const commitManualValue = useCallback(async (row: number, colId: string, value: string) => {
    const col = getColById(colId);
    if (!col) return;
    const sess = useSessionStore.getState();
    const prevValue = sess.getRowValues(row)[colId] ?? '';
    // 클립 포인터를 해제하기 전 확정 상태를 캡처한다. pending 안전 뷰가 값만 원복하고 오디오를
    // 잃으면 확인 전 export가 직전 확정값과 맞지 않는 불완전한 감사 레코드가 된다.
    const existingBeforeCommit = useDataStore.getState().sessions
      .find((s) => s.id === sessionIdRef.current);
    const oldPending = existingBeforeCommit?.pendingValidation;
    const originalRow = existingBeforeCommit?.rows.find((r) => r.index === row);
    logCell({
      type: 'command', parsed: 'manual_commit', extra: 'touch', text: value,
      row, colId,
      ...(prevValue ? { previousValue: prevValue } : {}),
    });

    // ② 기존 클립 보존(archive) 후 포인터 해제 — pending·persisted 양쪽(enterModifyMode direct
    //    경로의 (1)(2)와 같은 구조, 단 재연결할 cmd 클립이 없으므로 순수 해제).
    const pendingMap = pendingClipsRef.current[row];
    if (pendingMap?.[colId]) {
      archiveCellClip(row, colId);
      delete pendingMap[colId];
    }
    {
      const existing = useDataStore.getState().sessions.find((s) => s.id === sessionIdRef.current);
      const existingRow = existing?.rows.find((r) => r.index === row);
      if (existing && existingRow?.audioClips?.[colId]) {
        archiveCellClip(row, colId);
        const { [colId]: _gone, ...restClips } = existingRow.audioClips;
        const updatedRow: SessionRow = {
          ...existingRow,
          audioClips: Object.keys(restClips).length > 0 ? restClips : undefined,
        };
        const updatedSession = {
          ...existing,
          rows: existing.rows.map((r) => (r.index === row ? updatedRow : r)),
        };
        useDataStore.getState().upsertSession(updatedSession);
        void saveSession(updatedSession).catch(() => {});
      }
    }

    // 재커밋 중이면 최초 확정값/syncState를 계속 보존한다. 두 번째 후보를 기준값으로 덮으면
    // [수정] 반복 뒤 sync/export가 첫 미확정 후보를 내보내는 구멍이 생긴다.

    // ④ 이상치 검사 — hold 여부를 **값 저장 전에** 결정한다. 후보값을 먼저 일반 Session으로
    // 저장한 뒤 pending 태그를 두 번째 write로 붙이면 그 사이 reload에서 후보가 확정값으로 보이는
    // 원래 결함이 그대로 남는다. hold면 아래에서 후보+태그를 단일 IDB put으로 저장한다.
    const violation = evaluateTrend(col, row, colId, value);
    const fireManualAlert = (v: TrendViolation, hold: boolean) => {
      // 알람 페이로드 조립은 buildAnomalyAlert가 SSOT(v0.35.1) — 수동 경로 전용
      // ',src=manual[,hold=1]' 접미사 조립까지 buildAnomalyAlert가 담당한다(SOP-003 바이트 계약,
      // 특성화 테스트가 실제 조립 경로를 그대로 검증).
      const alertExtra = getAnomalyAlertData(row);
      // 🔴 `alertText`를 반드시 함께 받는다(fb-27-9, 민구 확정 2026-07-27).
      //    v0.39.0까지 이 줄이 `alertText`를 구조분해에서 빼고 `say()`도 호출하지 않아, **수동 커밋이
      //    유발한 이상치 알람만 무음**이었다(실기기 20건 중 음성 19/19 발화, 수동 0/1).
      //    hold=1이면 사용자 응답을 기다리며 진행이 멈추는데 **왜 멈췄는지 소리로 알 수 없는** 상태가
      //    된다 — 현장에서는 폰을 2~3m 떨어뜨려 두므로 화면을 못 본다(PRINCIPLES §2 시각·청각 일치).
      const { alertText, logExtra, alert } = buildAnomalyAlert({
        col, v, colName: col.name, next: formatForTts(value), row,
        sampleKey: alertExtra.sampleKey, prevDate: alertExtra.prevDate,
        manual: { hold },
      });
      logCell({
        type: 'trend',
        extra: logExtra,
        row, colId,
        colName: col.name, text: value, parsed: value, previousValue: String(v.prev),
      });
      useSessionStore.getState().setAnomalyAlert({
        ...alert,
        colId, // v0.34.0 A1 — [수정]의 시트 재오픈 키(VoiceScreen)
        // v0.34.0 A1 — hold면 [확인][수정] 버튼 표시(awaitingResponse 재사용) + manualHold 라우팅.
        //   음성 확인 루프(trendConfirm)는 여전히 무장하지 않는다(민구 기존 결정).
        //   비-hold(awaiting이 다른 셀)는 종전 그대로 정보성 팝업(버튼 없음).
        ...(hold ? { awaitingResponse: true, manualHold: true } : {}),
      });
      playBeep('alert');
      // 민구 확정(2026-07-27): **음성 경로와 완전 동일하게 전 알람 발화**(hold 여부 무관).
      //   비-hold 정보성 알람도 말한다 — 값이 이상하다는 사실 자체가 현장에서 즉시 필요한 정보고,
      //   경로에 따라 들리다 안 들리다 하면 그게 더 혼란스럽다는 판단이다.
      useSessionStore.getState().setLastTts(alertText);
      void say(alertText);
    };

    const awaiting = awaitingFieldRef.current;
    // 🔴 v0.49 r4 M1(claude r3 #2 — Larry 소스 확증) — **행 검토 대기 분기에도 행 가드를 건다.**
    //   종전 `awaiting.kind === 'reviewWait'`는 **좌표를 아예 보지 않았다.** 형제 분기가
    //   `row === row && colId === colId`를 요구하는데 이 하나만 무조건 참이라, **다른 행**에 대한
    //   수동 커밋이 검토 대기의 흐름을 소유했다. 도달로는 셀 저장 실패 배너의 [다시 저장]이다
    //   (`VoiceScreen.tsx`가 `cellPersistPending`에 **떠날 때의 좌표**를 들고 있다가
    //   `commitManualValue(p.row, …)`를 재실행한다 — 그 사이 사용자가 '이전'으로 완료 행에
    //   들어가 있으면 두 좌표가 갈린다).
    //
    //   피해는 **값 소실**이다. 이 분기의 보류 경로는 공유 코어(`persistCellValue`)를 쓰지 않고
    //   `persistSession(pendingValidation, true)`로 세션을 **통째로 다시 조립**하는데, 그 조립은
    //   `completedRows`(+백업·activeRow·skipped)만 rows에 싣는다(:633~644). 재시도 대상 행이
    //   그 어느 집합에도 없으면 **이미 영속돼 있던 그 행이 rows에서 통째로 빠진다** — 값뿐 아니라
    //   `sheetRow`/`syncState`까지 사라져 다음 sync가 같은 행을 **중복 append**한다.
    //   이어서 [확인]은 `proceedAfterCommit(awaiting)`을 부르므로 `finalizeRowCompletion`도
    //   **남의 행**(검토 중인 행)에 걸리고, 실제 커밋 행은 완료 부기를 영영 못 받는다.
    //
    //   ⚠️ **컬럼은 가드하지 않는다**(리뷰 표기 「행·컬럼 가드 없음」과 갈리는 지점 — 산출물 보고).
    //   `reviewWait`은 **행 스코프** 문맥이다: 센티넬 `colId`는 포인터(첫 음성 컬럼)일 뿐이고,
    //   사용자는 그 행의 **아무 칩이나** 눌러 고친다(v0.34.0 A3). 컬럼까지 요구하면 첫 컬럼 외
    //   전부가 흐름 밖으로 떨어져 「검토 중 정정」 계약([NAV-FILLED-CELL-1] 계열)이 깨진다.
    //   오라클: tests/v049-r4-m1-crossrow-ownsflow.spec.ts
    const ownsReviewWait = awaiting?.kind === 'reviewWait' && awaiting.row === row;
    const ownsCell = !!awaiting && awaiting.kind !== 'reviewWait' && awaiting.kind !== 'atEnd'
      && awaiting.row === row && awaiting.colId === colId;
    const ownsFlow = ownsReviewWait || ownsCell;
    if (violation && ownsFlow) {
      epochRef.current++;
      cancelTts();
      // 🔴 v0.49 fix49b(max 리뷰 #7) — 셀 검토 대기도 행 검토와 **같이** 보존한다. 보류가
      //   [확인]으로 풀리면 `confirmManualAnomaly`가 `proceedAfterCommit(awaiting)`을 부르고,
      //   그 SSOT가 kind별 착지를 결정한다 — 여기서 `modify`로 덮으면 그 분기가 영영 안 잡혀
      //   사용자가 이동해 들어온 검토 문맥이 보류 해소와 함께 사라진다.
      //   ⚠️ **reload 복원(:3980)은 여기 못 따라온다** — `pendingValidation`은 `reviewWait`
      //   boolean만 싣고, cellWait을 기존 필드로 파생할 수도 없다(후보값이 이미 셀에 서 있어
      //   「값 있음」이 항상 참 · `previousValue`는 캐스케이드가 IDB를 안 지우므로 modify와
      //   구별 불가). 스키마 확장은 마이그레이션 동반 계약이라 이 라운드 범위 밖 —
      //   [CELLWAIT-HOLD-RELOAD-1]에 기록했다.
      // 🔴 v0.49 r5 Z4(claude #3) — **재무장은 문맥을 들고 간다.** 종전 이 한 줄은 새 `modify`
      //   객체를 **맨손으로** 만들어, 들어올 때의 `awaiting`이 갖고 있던 세 문맥을 통째로
      //   떨어뜨렸다. 형제 재무장 둘은 전부 보존한다 — `demoteTrendConfirm`(:158)과 음성
      //   재위반 재무장(:3329 부근). 이 세 번째만 빠져 **수동(키패드) 커밋에서만** 새는
      //   비대칭이었다(같은 상태에서 같은 값을 말로 넣으면 보존되고 손으로 넣으면 유실된다).
      //     · `resumeReview`/`resumeCell` — 착지 예약. 보류가 [확인]으로 풀리면
      //       `proceedAfterCommit`이 이걸 보고 검토 대기로 복귀한다. 떨어뜨리면 `advance()`로
      //       빠져 사용자가 의도적으로 이동해 들어온 검토 문맥이 증발한다
      //       ([NAV-FILLED-CELL-1]의 「모든 탈출은 재진입」 불변식 위반).
      //   ⚠️ 승계원은 **직전 `awaiting`**이지 새 값이 아니다. `previousValue`만 방금 커밋된
      //     후보값으로 갈아 끼운다(재발화가 이 값을 대체 대상으로 삼는다 — 종전 의미 유지).
      //
      //   🔴 **`fractionWhole`은 일부러 승계하지 않는다**(브리핑 원문에서 갈린 지점 — 레인 실측).
      //     승계 규칙은 「예약이냐 값 문맥이냐」가 아니라 **「새 완결값이 들어왔는가」**다:
      //       · `demoteTrendConfirm`은 승계한다 — 강등은 **같은 값**에 대한 모드 전환일 뿐이다.
      //       · 이 자리와 :3329(음성 재위반 재무장)는 승계하지 **않는다** — 둘 다 사용자가
      //         **완결된 새 값**을 넣은 뒤다. 브리핑이 대칭 대상으로 지목한 :3329가 정확히
      //         `resumeReview`/`resumeCell`만 승계하고 `fractionWhole`은 두고 간다.
      //     승계하면 오히려 결함이 된다: 바로 아래 `setReaskReason(null)`이 화면의 소수 문맥을
      //     지우는데(`reaskDecimalWhole`도 함께 — sessionStore 계약) `awaiting`만 정수부를 들고
      //     남으면 **화면과 합성이 갈린다**(R4-F3와 같은 형태). 「111 점 에」 뒤 키패드로 120.5를
      //     넣었는데 다음 '오'가 111.5로 합성돼 방금 넣은 값을 덮는 것이 그 귀결이다 —
      //     M3가 닫은 「무고지 합성」 그 자체다.
      //   오라클: tests/v049-r5-z4-hold-context.spec.ts
      if (awaiting!.kind !== 'reviewWait' && awaiting!.kind !== 'cellWait') {
        const prev = awaiting!;
        awaitingFieldRef.current = {
          kind: 'modify', row, colId, name: col.name, previousValue: value,
          ...(resumeReviewOf(prev) != null ? { resumeReview: resumeReviewOf(prev) } : {}),
          ...(resumeCellOf(prev) != null ? { resumeCell: resumeCellOf(prev) } : {}),
        };
      }
      sess.setRowValue(row, colId, value);
      sess.setRecognized(value);
      sess.setReaskReason(null);
      // dataStore는 UI 후보를 보여 주되 여기서는 saveSession을 호출하지 않는다. persistSession에
      // pendingOverride를 넘긴 단 한 번의 put만 후보를 내구화해 crash window를 제거한다.
      useDataStore.getState().patchRowValues(sessionIdRef.current, row, { [colId]: value });
      fireManualAlert(violation, true);
      const alert = useSessionStore.getState().anomalyAlert;
      if (!alert?.manualHold) return;
      const pendingValidation: NonNullable<Session['pendingValidation']> = {
        row,
        colId,
        candidateValue: value,
        previousValue: oldPending?.previousValue ?? originalRow?.values[colId] ?? prevValue,
        previousSyncState: oldPending?.previousSyncState ?? originalRow?.syncState,
        previousAudioClip: oldPending?.previousAudioClip ?? originalRow?.audioClips?.[colId],
        reviewWait: awaiting.kind === 'reviewWait',
        activeColIdx: useSessionStore.getState().activeColIdx,
        alert: { ...alert, colId, awaitingResponse: true, manualHold: true },
      };
      const durable = await persistSession(pendingValidation, true);
      if (!durable) {
        // 태그와 후보가 함께 저장되지 못했으므로 후보를 확정 상태처럼 메모리에 남기지 않는다.
        // 직전 값으로 롤백하고 보류 UI를 닫아 reload 전후가 동일한 확정값을 가리키게 한다.
        sess.setRowValue(row, colId, pendingValidation.previousValue);
        sess.setRecognized(pendingValidation.previousValue);
        clearAnomalyAlert('persist_rollback');
        const current = useDataStore.getState().sessions.find((s) => s.id === sessionIdRef.current);
        if (current) useDataStore.getState().upsertSession(withoutPendingCandidate({ ...current, pendingValidation }));
      }
      return;
    }

    // 일반값/정보성 이상치는 기존 즉시 영속 계약을 유지한다.
    // 🔴 C-FIX2 — durable 실패면 여기서 끝낸다: 영수증·화음·에코·진행·정보성 알람 전부 억제
    //   (유실될 값을 성공 고지하지 않는다). 값은 화면에 남아 재커밋이 재시도가 된다
    //   (notifyCellPersistFailed 주석의 🟡 선택 근거 참조).
    if (!(await persistCellValue(row, colId, value))) {
      notifyCellPersistFailed(row, colId, value);
      return;
    }
    // v0.37.0 리뷰#1 — 수동 시트 커밋 영수증(검토 화면 파생 SSOT). 보류(manualHold) 분기는 위에서
    //   return하므로 여기 도달 = 확정 커밋(일반값·정보성 이상치). 보류 정정값은 confirmManualAnomaly가 발행.
    useSessionStore.getState().pushCommitReceipt(row, colId, col.name, value);
    sess.setRecognized(value);
    // 🔴 v0.49 r7 #5(codex r6#9) — **거절 큐 해제는 흐름을 소유한 커밋만 한다.**
    //   `reaskReason`은 「이 커밋이 성공했다」가 아니라 **`awaiting` 셀이 무엇을 기다리는가**를
    //   설명하는 화면 큐다(M4가 세운 「거절 큐는 그 셀의 것이다」). 그런데 이 줄이 소유권 분기
    //   **앞**에 무조건 있어서, **다른 셀을 덮어쓰는 비-awaiting 키패드 커밋**이 남의 큐를 내렸다.
    //   피해는 M3가 닫은 **「무고지 합성」의 화면 축**이다: `setReaskReason(null)`은 store 계약상
    //   `reaskDecimalWhole`까지 함께 지우는데, `awaiting`의 `fractionWhole`은 **그대로 살아 있다**
    //   (이 분기는 진행 상태를 건드리지 않는다는 v0.47.0 W1 계약). 그래서 화면에서는 「111 점,
    //   소수점 아래」 큐가 사라졌는데 다음 발화 '오'는 여전히 111.5로 합성된다 — 사용자는 전체값을
    //   말해야 하는지 소수부만 말해야 하는지 알 수 없다(PRINCIPLES §2 화면·청각 동일성).
    //   Z4가 승계 규칙에서 `fractionWhole`을 일부러 두고 간 근거의 **반대편 반쪽**이다: 그쪽은
    //   「화면을 지웠으니 문맥도 들고 가지 마라」였고, 여기는 「문맥이 사는데 화면만 지우지 마라」다.
    //   ⚠️ 소유 커밋(`ownsFlow`)에서는 종전 그대로다 — 그건 실제로 그 대기를 끝낸 커밋이다.
    //   오라클: tests/v049-r7-05-nonowner-reask.spec.ts
    if (ownsFlow) sess.setReaskReason(null);

    // 🔴🔴 v0.49 r5 Z8(claude #8) — **행 완료 부기는 흐름 소유권과 무관하다. 값 유실이었다.**
    //
    //   완료의 진실이 둘이었다:
    //     · `dataStore.patchRowValues`(C4)는 값에서 `complete`를 **다시 계산**하고
    //       `completedRows`도 맞춘다 — 그래서 키패드 커밋 직후 IDB는 옳아 보인다.
    //     · `sessionStore.completedRows`는 `markRowComplete`(=`finalizeRowCompletion`)로만 는다.
    //       그런데 아래 **비-awaiting 커밋 분기**(v0.47.0 W1)는 *"진행 상태를 건드리지 않는다"*
    //       는 계약을 지키며 그 부기까지 함께 건너뛰었다.
    //   `persistSession`은 후자만 본다: `rows`를 `completedRows` + `activeRow` + `skippedRows`
    //   **셋에서만** 만든다. 그래서 다음 persist가 그 행을 **어느 목록에도 못 넣고 통째로
    //   떨어뜨린다** — IDB에서 사라지고, 시트에도 영영 안 올라간다.
    //   실측(2026-08-14): 1행 m1을 음성으로, 커서를 그 셀에 둔 채(cellWait) m2를 **키패드**로
    //   채워 행을 완성 → IDB에 `{m1:35.1, m2:42.3, complete:true}`. 그 뒤 2행에서 값 하나를
    //   커밋하자 **1행이 IDB에서 통째로 사라졌다.** 끝 도달 안내도 「완료된 행은 1행」이라
    //   말했다(실제 2행) — 두 진실이 화면·시트·귀에서 동시에 갈린 형태다.
    //
    //   🔑 처방이 **여기**인 이유: `finalizeRowCompletion`의 계약이 *"이 함수가 다루는 것은
    //   «내구성»뿐이고, «무엇을 말하는가»는 호출부가 정한다"*(그 헤더)다. 부기는 흐름 소유권이
    //   아니라 **커밋 사실**에 붙는다. 그래서 소유권 분기 **앞**에서 한 번 부른다 — 아래
    //   `proceedAfterCommit`도 같은 함수를 부르지만 멱등이라 IDB 쓰기가 늘지 않는다(그 헤더).
    //   ⚠️ 좌표는 **커밋된 셀의 행**(`row`)이지 `awaiting.row`가 아니다. M1이 세운 것은
    //     「어느 awaiting을 소유하는가」의 행 가드이고, 내구성 부기는 **값이 들어간 행**을 따른다 —
    //     둘을 같은 축으로 읽으면 교차행 수동 커밋에서 남의 행 부기를 건드리게 된다.
    //   ⚠️ 미완료 행이면 `isRowVoiceComplete` 가드가 즉시 return한다(no-op) — 부분 입력은
    //     종전대로 `activeHasData` 경로가 내구화한다.
    //   오라클: tests/v049-r5-z8-manual-complete.spec.ts
    // 🔴 v0.49 r6 Y1 — 위 `persistCellValue`와 **같은 계약**으로 실패를 받는다(C-FIX2 대칭).
    //   Z8이 이 줄을 넣을 때는 `void persistSession()`이라 실패가 보이지 않았다: 값은 화면에
    //   서고 ✓·화음·에코가 나가는데 IDB엔 아무것도 없는 상태(codex R5-F1의 재현 형상).
    //   좌표가 정확히 있는 유일한 호출부라 셀 배너를 그대로 쓴다 — 재시도 = 이 커밋의 재실행.
    if (!(await finalizeRowCompletion(row))) {
      notifyCellPersistFailed(row, colId, value);
      return;
    }

    // 🔴 v0.47.0 W1(FB-A+B, 민구 08-08) — **수동 커밋 확인음은 awaiting 여부와 무관하다.**
    //   종전엔 커밋 화음이 음성 경로(:2373)에만 있었고 수동 경로는 awaiting 셀일 때 echo TTS만
    //   났다 — 비-awaiting 덮어쓰기 커밋(08-08 새벽 실측 manual_commit 8건 중 4건)은 **완전 무음**.
    //   현장에서는 폰을 2~3m 떨어뜨려 두므로(PRINCIPLES §2) 소리 없는 커밋은 "저장됐는지 모르는"
    //   커밋이다. 여기 = manualHold 보류가 아닌 **확정 커밋의 유일 도달점**(보류는 위에서 return).
    //   순서 계약은 음성 경로와 동일: **확인음 → 인식값 TTS**(v0.46.0 WP-E, 민구 지정).
    //   화음이 WebAudio, 에코가 SpeechSynthesis라 아래 어느 분기의 TTS와도 채널 충돌이 없다.
    playBeep('commit');

    // ⑤ 진행: awaiting 셀이면 음성 커밋과 동일하게 echo 후 advance. 검토 대기면 재무장.
    //    v0.34.0 A1 — 단, violation이면 진행을 보류하고 팝업 응답을 기다린다(칩 전진 버그 수정).
    if (oldPending && oldPending.row === row && oldPending.colId === colId) {
      const staged = useDataStore.getState().sessions.find((s) => s.id === sessionIdRef.current);
      if (staged) {
        const confirmed = { ...staged };
        delete confirmed.pendingValidation;
        await saveSession(confirmed);
        useDataStore.getState().upsertSession(confirmed);
      }
      // 성공적인 정상 재커밋만 보류를 해소한다. 시트 취소는 이 함수에 들어오지 않으므로 유지된다.
      clearAnomalyAlert('manual_recommit');
    }

    // 🔴 v0.49 P-2(민구 제보 08-12 · Larry (A) 승인 08-12 10:55) — **키패드 해소도 즉시 초록.**
    //   음성 경로(:2700-2710)와 **대칭**인 전이다: 알람이 걸린 바로 그 셀에 위반 없는 값이
    //   커밋되면 팝업을 `next=정정값 · status:'corrected'`로 뒤집는다. 종전엔 이 전이가
    //   **수동 경로에만 없어서**, 음성으로 뜬 알람을 키패드로 해소하면 `announceField`의
    //   `clearAnomalyAlert('announce_field')`(:835)까지 붉은톤이 그대로 남았다.
    //   08-12 실측(2건 전부 이 형태): 09:51:53 발동 → 09:52:04.099 키패드 `188.8` →
    //   09:52:09.102 해제 = **5.003초** · 09:55:01 → 09:55:09.610 `344.4` → 09:55:13.441 =
    //   **3.831초**. 지연의 정체는 announce까지의 TTS 직렬이다(echo 1.414s + 행완료 1.095s +
    //   행헤더 2.189s). 같은 세션의 음성 해소 6건은 전부 인식 순간 corrected라 체감 0초였고,
    //   수동 발동 알람(manualHold, 위 `manual_recommit`)도 이미 0.318초였다 — **이 경로만 구멍.**
    //   표시 4곳이 전부 같은 게이트를 읽으므로 이 한 전이가 함께 되돌린다: 글로우
    //   (`VoiceScreen.tsx:139`) · FB-F 칩 적색(`useVoiceCommitMark.ts:132`) · 알람 카드
    //   (`CenterStage.tsx:139` FB-10) · 팝업 색(`AnomalyAlertPopup.tsx:74`). 계약 위반이 아니라
    //   v0.47 "확인·수정으로 해소한 뒤에만 녹색"을 키패드 경로에도 **적용**하는 것이다.
    //   부수 해소: 종전 5초 동안 팝업이 **옛 이상치값**을 띄운 채 echo TTS만 정정값을 말했다
    //   (PRINCIPLES §2 시각·청각 불일치) — `next` 갱신이 그것도 같이 닫는다.
    //
    //   위치·가드 근거(승인 조건):
    //   ⓐ **durable persist 성공 이후**다(:4189 게이트 통과). 저장되지 못한 값에 초록을 주지 않는다.
    //   ⓑ **row+colId 일치 가드** — 다른 셀 알람(정보성 팝업)은 이 커밋과 무관하므로 불변.
    //   ⓒ **`!violation`** — 정보성 이상치(awaiting이 다른 셀)로 여기 도달한 커밋은 그 자체가
    //      위반이다. :4251의 `fireManualAlert`가 곧 새 알람을 세우므로 초록 1프레임도 주면 안 된다.
    //   ⓓ manualHold 보류는 위에서 `clearAnomalyAlert('manual_recommit')`로 이미 내려갔다 →
    //      여기 도달 시 `alert === null` → no-op. **그 경로의 로그 바이트는 불변**이다.
    //   ⓔ 화음은 **미러하지 않는다.** 음성 경로는 `playBeep('corrected')` 하나지만 수동 경로는
    //      v0.47 W1(민구 08-08)이 "모든 확정 커밋에 화음"을 이미 보장한다(:4206) — 여기서
    //      corrected 화음을 더 내면 같은 커밋이 두 번 울린다.
    if (!violation) {
      const liveAlert = useSessionStore.getState().anomalyAlert;
      if (liveAlert && liveAlert.row === row && liveAlert.colId === colId && liveAlert.status !== 'corrected') {
        useSessionStore.getState().setAnomalyAlert({
          ...liveAlert, next: formatForTts(value), status: 'corrected',
        });
      }
    }

    // M1 — 착지도 **같은 술어**를 쓴다(위 `ownsReviewWait`/`ownsCell`). 종전엔 여기서 같은 조건을
    //   다시 손으로 적었고, 그 사본에도 행 가드가 없어 다른 행 커밋이 남의 검토 대기를 재무장했다
    //   (값은 공유 코어가 이미 옳게 저장했으므로 이쪽 피해는 오착지·오낭독이지만, 같은 결함이다).
    if (ownsReviewWait) {
      epochRef.current++;
      cancelTts();
      await proceedAfterCommit(awaiting); // 검토 대기 재무장(갱신값 재낭독)
    } else if (ownsCell) {
      epochRef.current++;
      cancelTts();
      // v0.47.0 W2 — 수정 재청취 중 수동 재커밋도 「수정 성공」이다(amber→green 전환 신호).
      if (awaiting.kind === 'modify') useModifyPhase.getState().setCommitted(true);
      await proceedAfterCommit(awaiting, { echoValue: value }); // echo 후 진행
    } else {
      // v0.47.0 W1(FB-A+B) — 비-awaiting(다른 셀 덮어쓰기)·atEnd 수동 커밋도 **값을 에코**한다.
      //   종전 "흐름 불변 = 무음"이 FB-A/B의 실체다. 진행 상태는 여전히 건드리지 않는다
      //   (epoch bump·cancelTts 없음 — advance 소유권이 없는 커밋이다). interrupt=false로
      //   큐잉해 진행 중인 안내 TTS(awaiting 셀 재촉 등)를 자르지 않는다 — 화음이 즉시 나므로
      //   "커밋됐다"는 신호는 지연 없이 전달되고, 에코는 안내가 끝난 직후 이어진다(순서 계약
      //   확인음→에코 유지 — 사이가 벌어질 수는 있어도 뒤집히지는 않는다).
      // v0.47.0 C-FIX4(리뷰 U9) — 정보성 이상치(violation)면 **에코를 생략**한다. 두 이유:
      //   ①이 await가 알람 팝업·트릴·알람 TTS를 에코 종료까지 지연시켰다(값이 이상하다는
      //   사실이 즉시 필요한 정보인데 늦는다 — U9의 본축) ②수동 커밋은 정의상 **화면 앞
      //   키패드 조작**이고(2~3m 음성 시나리오가 아니다) 알람 팝업이 직전→현재 값을 크게
      //   보여준다 — 값 확인 채널이 살아 있으니, 에코→알람 이중 TTS로 경고를 뒤로 미는 것보다
      //   경고 단독이 낫다. ⚠️ alertText는 값이 아니라 **변화량**을 말한다(anomalyAlarmLabel) —
      //   "알람이 값을 발화한다"는 가정은 틀렸다(이 스펙 첫 구현에서 실측). 순서를 뒤집어
      //   알람 뒤에 에코를 큐잉하는 안은 기각: fireManualAlert의 say가 비대기(void)라
      //   interrupt 50ms 갭과 레이스해 에코가 알람을 앞지를 수 있다.
      //   화음(위)은 그대로 — "저장됐다"와 "이상하다"는 별개 신호다(화음→트릴→알람 TTS 순).
      if (!violation) await say(formatForTts(value), false);
    }

    if (violation) fireManualAlert(violation, false);
  }, [archiveCellClip, clearAnomalyAlert, evaluateTrend, finalizeRowCompletion, getAnomalyAlertData, notifyCellPersistFailed, persistCellValue, persistSession, proceedAfterCommit, say]);

  // v0.44.0 §C8 F18 — v0.25.0 기능2(WS-2) prewarmMic(입력탭 마운트 시 마이크 선획득)를 **폐지**했다.
  // 민구 확정(08-02): 권한 요청 시점 = '음성 입력 시작' 클릭. 획득은 start() 선두의 선행 init()이
  // 담당하고, WS-2의 목적(첫 클립 유실 완화)은 승인 후 MIC_SETTLE_MS(1초) 정착 지연이 승계한다.
  // mic_prewarm_* 텔레메트리도 함께 은퇴 — 진입 시 getUserMedia 0회는 v0440-c8-flow.spec.ts가 고정.

  return {
    start,
    stop,
    /** v0.35.0 R3-FIX-2 — 종료 저장 실패 배너의 [다시 저장] 핸들러(VoiceScreen). */
    retryFinalPersist,
    jumpToRow,
    gotoAdjacentRow,
    goNextRow,
    pause,
    resume,
    suspendRecognitionForUi,
    resumeRecognitionForUi,
    // v0.43.0 #4 — App.tsx의 visibilitychange 핸들러가 유일한 호출자다(VoiceScreen 경유 브리지).
    suspendForBackground,
    resumeFromBackground,
    commitTouchValue,
    commitManualValue,
    confirmAnomalyTouch,
    modifyAnomalyTouch,
    confirmManualAnomaly,
    modifyManualAnomaly,
    lastConfidenceRef,
    getActiveInputLabel,
    getTrackState,
    getRuntimeSnapshot,
    getAudioLevel,
    getTimeDomainData,
    micLost,
    micReconnectFallbackVisible,
    reconnectMic,
    uiCommand,
    sessionColumns,
  };
}

// ─── helpers ─────────────────────────────────────────────────
function autoNonCyclingValues(columns: Column[], row: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of columns) {
    // v0.46.0 FB-A — 수동(touch)도 사람이 넣는 값이라 자동 합성에서 뺀다. 근거는
    // `autoValue.ts`의 `isUserInputColumn` 주석이 SSOT(이 경로가 시트 기록에 닿는다).
    if (isUserInputColumn(c)) continue;
    out[c.id] = nestedAutoValue(columns, c, row);
  }
  return out;
}

/** 행 전체 값 합성(고정/비순환 자동 → 순환 자동 → 음성 입력 순으로 덮어씀) —
 *  persistSession과 evaluateTrend가 공유하는 단일 합성 규칙. */
function composeRowValues(columns: Column[], row: number): Record<string, string> {
  return {
    ...autoNonCyclingValues(columns, row),
    ...buildCyclingValues(columns, row),
    ...useSessionStore.getState().getRowValues(row),
  };
}

/** 로컬(기기) 기준 오늘 ISO — toISOString()은 UTC라 자정 부근에 하루 어긋난다. */
function localTodayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
