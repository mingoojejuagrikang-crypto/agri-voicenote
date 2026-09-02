/**
 * [ENV-12] Stage 3 서브 훅 #10 — **착지(commit landing)**: `handleFinal` 구획의 블록 G(추세 위반
 * 알람) + H(정정 정상화 → 착지)를 그대로 옮긴 것이다. 값 커밋(`useValueCommit`)이 끝낸 값을
 * 받아 **추세를 검증**하고, 위반이면 알람을 조립·재무장하고 advance를 중단하며, 정상이면
 * 확인음 → 인식값 TTS → `value` 로그 → epoch 가드 → `proceedAfterCommit`로 착지시킨다.
 * 이것으로 `handleFinal` 파이프라인 4스테이지가 완성된다.
 *
 * 🔴 **`runCommitLanding`의 identity는 영구 고정이다** — 형제 스테이지와 같은 이유. 이 회차로
 * `handleFinal`의 dep 배열이 **정확히 스테이지 함수 4개**가 되므로(§5-1 ③), 그 넷이 전부
 * `useCallback([])`+`depsRef`인 것이 STT 배선 안정의 기계적 근거 전부다.
 * ⚠️ 주입 심볼 중 `logCell`·`getTtsRate`는 본체에서 `useCallback`이 **아니다**(매 렌더 재생성).
 *   임시 destructure 중간 형태를 거칠 수 없는 이유가 그것이다(형제 스테이지와 같은 판단).
 *
 * 🔴🔴 **이 스테이지는 `handleFinal`의 마지막 문이어야 한다 — 그것이 계약이다.**
 * 본문의 `return;` 두 곳(추세 위반 시 advance 중단 · 종단 epoch 가드)은 종전 `handleFinal`의
 * **조기 return**이었다. 이 호출 **뒤에 문장이 하나도 없기 때문에** 그 의미가 보존된다.
 * 누가 나중에 호출부 뒤에 한 줄을 추가하면 등가성이 **조용히** 깨진다 — epoch 가드를 통과하지
 * 못한(= 다른 handleFinal이 끼어든) 낡은 착지가 그 문장을 실행하게 된다. 본체 호출부에도 같은
 * 계약 주석이 있다. **뒤에 붙이지 마라. 붙여야 하면 스테이지 안으로 넣어라.**
 *
 * 🔑 **`committed`를 ctx가 아니라 인자로 받는 이유**(E3 `useValueCommit`과 같은 근거).
 * `FinalCtx`의 `parsed`·`col`·`lowConfParsedExtra`·`myEpoch`·`commitLatencyMs`·
 * `runCorrectedPersistCheck`는 **선택 필드**라 여기서 non-null을 타입으로 증명할 수 없다.
 * 본체는 값 게이트·값 커밋을 지나며 그 여섯을 이미 확정했으므로 그대로 넘겨 컴파일러가 계약을
 * 강제하게 한다. 스테이지 안에서 다시 좁히면 도달 불가 분기가 생기고, 그 분기가 침범당하면
 * **「값은 커밋됐는데 착지(확인음·echo·advance)만 증발」**이라는 가장 나쁜 형상이 된다.
 * 🔴 [ENV-12] E5 정리 — 종전 이 자리엔 *"`ctx`는 여전히 그 값들을 들고 있다"*가 있었다. 인자
 * 경로를 택한 순간 그 ctx 사본은 **독자가 0인 배관**이었고, E5에서 필드째 제거했다. 이 여섯은
 * 이제 **오직 인자로만** 온다 — `ctx`에서 찾지 마라(`FinalCtx`에 `parsed`·`col`·
 * `lowConfParsedExtra`가 남아 있는 것은 **본체 셸이 되받는 경로** 때문이지 이 스테이지용이 아니다).
 *
 * ⚠️ 규범 이탈 자진 신고
 *  ① `previousValueOf` — **이 스테이지가 처음 주입받는 모듈 헬퍼**다(`useFinalCommands`는 같은
 *     정보를 `awaiting.previousValue` 직접 접근으로 읽어 주입이 불요했다). 나머지 3종
 *     (`isModifyLike`·`resumeReviewOf`·`resumeCellOf`)과 같은 계약 — 값 import는 순환이다(§5-3).
 *  ② `getTtsRate` — 본체의 비-useCallback 지역 함수. echo `speak()`의 `rate`가 이 값을 쓴다.
 *     `useSettingsStore.getState().ttsRate || 1.05`를 여기 복제하면 **기본값 사본**이 생겨
 *     [PAST-2](선언은 하나인데 사본이 있는) 형태가 되므로 주입한다.
 *  ③ ref는 getter가 아니라 **ref 그대로**: `awaitingFieldRef`(여기서 trendConfirm 재무장 —
 *     다중 기록자) · `epochRef`(레이스 가드 SSOT — 여기서 두 번 **읽는다**) ·
 *     `bargeInEpochRef`(U1 4절 — 알람 TTS 직전 낡은 barge-in 흔적 소거).
 */
import { useCallback, useRef } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { buildAnomalyAlert } from './anomalyAlert';
import { playBeep } from './beep';
import { useModifyPhase } from './modifyPhase';
import { formatForTts, speak } from './speech';
import { formatNameForTts, confusionQuestionTts } from './voicePrompts';
import type { Column } from '../types';
import type { logger } from './logger';
import type { TrendViolation } from './trendCheck';
import type { AwaitingField, FinalCtx } from './useVoiceSession';
import { noteSttVoiceCommit } from './sttCorrectionTracker';
import { armSttConfusion, evaluateSttConfusion } from './sttConfusionRuntime';
import type { ValueCommitResult } from './useValueCommit';

type LogCell = (entry: Omit<Parameters<typeof logger.log>[0], 'sessionId'>) => void;

/** 값 커밋이 확정한 것들 — 본체가 좁혀서 넘긴다(헤더 🔑). `ValueCommitResult` 3종의 확장이다. */
export type CommitLandingInput = ValueCommitResult & {
  parsed: string;
  col: Column | null;
  lowConfParsedExtra: string | null;
};

export interface CommitLandingDeps {
  logCell: LogCell;
  say: (text: string, interrupt?: boolean) => Promise<boolean>;
  evaluateTrend: (col: Column | null, row: number, colId: string, nextRaw: string) => TrendViolation | null;
  getAnomalyAlertData: (row: number) => { sampleKey?: string; prevDate?: string };
  armClipForCell: (row: number, colId: string) => void;
  proceedAfterCommit: (awaiting: AwaitingField | null, opts?: { echoValue?: string }) => Promise<void>;
  /** 🔴 모듈 레벨 비-export 헬퍼 4종 — 값 import는 순환이다(§5-3). */
  isModifyLike: (a: AwaitingField) => boolean;
  previousValueOf: (a: AwaitingField) => string | undefined;
  resumeReviewOf: (a: AwaitingField) => number | undefined;
  resumeCellOf: (a: AwaitingField) => ResumeCellOf;
  /** 본체의 비-useCallback 지역 함수 — 기본값 사본을 만들지 않으려 주입한다(헤더 ②). */
  getTtsRate: () => number;
  awaitingFieldRef: { current: AwaitingField | null };
  epochRef: { current: number };
  bargeInEpochRef: { current: number };
}

type ResumeCellOf = { row: number; colId: string } | undefined;

export function useCommitLanding(deps: CommitLandingDeps) {
  // 주입 deps를 ref로 받아 **노출 함수 identity를 영구 고정**한다(헤더 🔴 첫 항목).
  const depsRef = useRef(deps);
  depsRef.current = deps;

  /**
   * 블록 G+H — 추세 검증 → (위반) 알람·재무장·advance 중단 / (정상) 확인음·echo·착지.
   * 🔴 **본체의 마지막 문으로만 불러라**(헤더 🔴🔴). 아래 `return;` 두 곳이 종전 handleFinal의
   *    조기 return과 등가인 근거가 정확히 그것이다.
   */
  const runCommitLanding = useCallback(async (
    ctx: FinalCtx,
    committed: CommitLandingInput,
  ): Promise<void> => {
    const {
      logCell, say, evaluateTrend, getAnomalyAlertData, armClipForCell, proceedAfterCommit,
      isModifyLike, previousValueOf, resumeReviewOf, resumeCellOf, getTtsRate,
      awaitingFieldRef, epochRef, bargeInEpochRef,
    } = depsRef.current;
    // 이동 계약 §3-7 치환 ① — ctx·committed를 본문에 흩뿌리는 대신 **진입부에서 분해**한다.
    // 종전 handleFinal 안의 지역변수 이름을 그대로 복원하므로 아래 본문은 바이트 동일이다.
    const { text, confidence, awaiting } = ctx;
    const {
      parsed, col, lowConfParsedExtra, myEpoch, commitLatencyMs, runCorrectedPersistCheck,
    } = committed;

    // ── v0.7.0 B4: 추세 검증 — 값 커밋 직후 · echo/advance 전 ──
    // 값↔클립 매핑은 위에서 이미 확정됐고 커밋된 값은 위반이어도 그대로 선다(롤백 없음 — 민구
    // 결정: 알림 후 '확인'/'유지'는 유지·진행, 새 값 발화는 재입력). 위반이면 echo 대신 알림
    // TTS를 내보내고 advance를 중단한 채 trendConfirm 상태로 응답을 기다린다.
    const trendViolation = evaluateTrend(col, awaiting.row, awaiting.colId, parsed);
    if (trendViolation) {
      const v = trendViolation;
      // 알람 페이로드(extra 문자열·팝업 코어) 조립은 buildAnomalyAlert(모듈 하단)가 SSOT —
      // v0.35.1 Stage 1-2에서 수동 커밋 경로(commitManualValue)와 통합했다(표시값 산출은 그 안의
      // buildAnomalyDisplay — v0.9.0~v0.25.0 이력·근거 주석은 그쪽 참조).
      // alertText는 팝업 라벨(AnomalyAlertPopup)과 **글자까지 동일** 계약(시각·청각 일치, v0.20.0 입력탭#6).
      // v0.12.0 AREA2 V2 — 어떤 샘플·행/직전 회차의 비교인지 식별정보를 함께 싣는다(별도 재계산).
      const alertExtra = getAnomalyAlertData(awaiting.row);
      const { alertText, logExtra, alert } = buildAnomalyAlert({
        col, v, colName: awaiting.name, next: formatForTts(parsed), row: awaiting.row,
        sampleKey: alertExtra.sampleKey, prevDate: alertExtra.prevDate,
      });
      // v0.26.0(Trace 권장, 2세션 연속 계측 갭) — 어떤 종류/트리거/문구로 알람이 나갔는지 extra에 동봉.
      //   직전까지는 extra='trend_alert_fired'뿐이라 기능3(both→범위 우선) 라우팅을 로그로 검증할 수
      //   없었다. 파서 호환을 위해 'trend_alert_fired' 접두는 유지하고 ':k=v' 목록을 덧붙인다.
      logCell({
        type: 'trend',
        extra: logExtra,
        row: awaiting.row, colId: awaiting.colId,
        colName: awaiting.name, text, parsed, confidence, previousValue: String(v.prev),
      });
      // value 이벤트는 정상 커밋과 동일하게 남긴다 — 분석 파이프라인이 위반 여부와 무관하게 본다.
      logCell({
        type: 'value',
        row: awaiting.row, colId: awaiting.colId, colName: awaiting.name,
        text, parsed, confidence,
        durationMs: commitLatencyMs, // v0.20.0 Phase 5 #4 — 발화 확정→커밋 반응속도(ms)
        // 🔴 v0.43.0 리뷰(Codex 중간#1, 2026-07-31 수용) — **이 줄이 빠져 있었다.**
        //   plan §2-5-b가 요구한 모수는 *"저신뢰인데 파싱돼 통과한 건 **전부**"* 인데, 종전엔
        //   아래 정상 커밋 분기에만 마커가 실려 **이상치 알람으로 분기한 커밋이 모수에서 빠졌다.**
        //   이 값도 :1918에서 store에 커밋되고 :1978에서 persist가 시작되므로 관찰 대상이 맞고,
        //   무엇보다 **이상치 값이야말로** 새 정책의 오인식 위험을 판단할 때 빼면 안 되는 표본이다
        //   (저신뢰 오인식이 이상치로 보이는 게 정확히 우리가 찾는 형태다).
        //   신규 이벤트는 안 늘어난다 — 아래와 **같은** extra를 같은 value 이벤트에 싣는다.
        ...(lowConfParsedExtra ? { extra: lowConfParsedExtra } : {}),
        ...(isModifyLike(awaiting) && previousValueOf(awaiting) != null
          ? { previousValue: previousValueOf(awaiting) }
          : {}),
      });
      // v0.51.1 R6 — 정정 쌍·분모(알람 분기도 커밋이다 — 위 value 이벤트와 같은 이유로 모수에서 빼지 않는다).
      noteSttVoiceCommit({
        row: awaiting.row, colId: awaiting.colId, colName: awaiting.name, col,
        text, conf: confidence, altIdx: ctx.altIdx ?? null, parsed,
        previousValue: isModifyLike(awaiting) ? previousValueOf(awaiting) ?? null : null,
        path: awaiting.kind === 'confusionConfirm' ? 'confusion' : isModifyLike(awaiting) ? 'rerecord' : 'value',
      }, logCell);
      // 응답 대기 상태 무장 — 새 값 발화가 기존 수정(isModify) 의미론으로 재커밋되도록
      // previousValue=방금 커밋된 값과 함께 세팅한다.
      // 🔴 v0.47.0-r3(이중 콜드 리뷰 08-09, codex f2 + claude §1 독립 일치) — **재위반 재무장도
      //   resumeReview를 보존한다.** 종전엔 이 재무장만 예약을 복사하지 않아, 검토 대기 출신
      //   직접 수정이 「위반 → 새 값(또 위반) → 확인」 조합에서만 advance로 새어 나갔다
      //   (v0.33.0 항목2 계약 파괴 — 해소 지점 4곳은 전부 새 객체에서 resumeReviewOf를 읽으므로
      //   여기서 떨어뜨리면 전 지점이 undefined를 받는다). demoteTrendConfirm(:136)과 같은 관례.
      //   오라클: tests/v0470-r2-p1-direct-modify-trend.spec.ts 「P1ⓒ-review-재위반」.
      awaitingFieldRef.current = {
        kind: 'trendConfirm',
        row: awaiting.row, colId: awaiting.colId, name: awaiting.name,
        previousValue: parsed,
        ...(resumeReviewOf(awaiting) != null ? { resumeReview: resumeReviewOf(awaiting) } : {}),
        // v0.49 r2 A2 — 셀 축 예약도 같은 이유로 보존한다(재위반 재무장에서 떨어뜨리면
        //   「위반 → 새 값(또 위반) → 확인」 조합에서만 셀 검토가 증발한다 — 위 주석과 같은 함정).
        ...(resumeCellOf(awaiting) != null ? { resumeCell: resumeCellOf(awaiting) } : {}),
      };
      // 응답 발화('확인'/새 값) 클립 시작 — announceField 패턴(TTS 이전 시작, barge-in 수록).
      armClipForCell(awaiting.row, awaiting.colId);
      // 시각 팝업: 이전값→현재값과 변화량을 띄운다(발화만으론 스쳐 지나가 확인이 어렵다는 요청).
      useSessionStore.getState().setAnomalyAlert({
        ...alert,
        // buildAnomalyAlert의 공통 코어는 colId를 의도적으로 모르므로, 음성 호출부의 정확한 awaiting
        // 좌표를 얹는다. 이후 clear 계측이 이름 추정 없이 같은 셀을 식별하는 주 출처다.
        colId: awaiting.colId,
        // v0.33.0 항목7 — 응답 대기 알람: 팝업이 [확인][수정] 터치 버튼을 그린다(음성 명령과 동일
        // 동작·동일 로그, 07-10 QA P1 #2). 수동 커밋의 정보성 팝업(확인 루프 없음)과 구분.
        awaitingResponse: true,
      });
      playBeep('alert');
      useSessionStore.getState().setLastTts(alertText);
      // 🔴 v0.48.1 U1(리뷰 F1/HIGH, claude+codex 독립일치) — `myEpoch`는 이 값 커밋 시작 시점
      //   (useValueCommit의 `++epochRef.current`)에 이미 캡처돼 본체가 넘겨준다 — 재사용한다
      //   (같은 handleFinal 호출, 같은 파이프라인).
      // 🔴 v0.48.1 r3 U1 4절 — 직접수정 경로(:1338 부근)와 동일 이유로, 이 alertText 재생 전
      //   구간에 우연히 같은(방금 bump된) epoch로 기록된 낡은 barge-in 흔적을 지운다.
      bargeInEpochRef.current = -1;
      const started = await say(alertText);
      // v0.48.0 P4(NEW-3, 민구 제보 08-10) — "값을 틀렸는지, 인식이 잘못됐는지 소리만으론 알 수
      // 없다"(원문). alertText는 팝업 라벨과 글자까지 동일해야 하는 §4 바이트 계약(logExtra의
      // text=)에 묶여 있어(위 :2494) 값을 거기 합치면 anomalyAlert.spec.ts·trend-alert.spec.ts
      // triad(화면==TTS==로그)가 깨진다(scout-v048 조사) — alertText/logExtra는 불변, **별도
      // 두 번째 발화**로만 분리한다. alert.next는 이미 formatForTts(parsed)로 조립돼 팝업
      // "현재" 값과 같은 문자열이다(시각·청각 일치).
      // 🔴 U1 가드 — `await say(alertText)`의 resolve는 발화 종료를 뜻하지 않는다(`cancel()`도
      //   `onend`를 쏜다 — barge-in이 :353·:1990 부근에서 건다, review-claude.md F1). 세 절이
      //   각각 다른 재진입 구멍을 막는다: `epoch` 불변 = cmd/값 barge-in(같은 셀 재위반 포함 —
      //   재위반도 값 재커밋이라 :2298에서 매번 새 epoch를 받는다); `kind==='trendConfirm'` =
      //   터치 종료 버튼의 `stop()`(`awaitingFieldRef.current=null`, epoch는 안 건드림, :3341
      //   부근); `anomalyAlert?.awaitingResponse` = `clearAnomalyAlert` 경유 해소. 셋 다 참이어야
      //   「아직 같은 알람이 대기 중」이다 — 그때만 지나간 값이 아니다.
      // U2(codex medium) — `started`=false(1차가 watchdog으로 스킵)면 2차도 생략해 직렬 대기가
      //   5초로 배증하는 것을 막는다. 잔여 축(started-but-no-onend)은 `say()` 주석 참조.
      // 🔴 v0.48.1 r3 U1 4절 — 직접수정 경로(:1332 부근)와 동일 근거. `bargeInEpochRef` 선언부·
      //   handleInterim 주석 참조.
      if (
        started
        && epochRef.current === myEpoch
        && awaitingFieldRef.current?.kind === 'trendConfirm'
        && useSessionStore.getState().anomalyAlert?.awaitingResponse
        && bargeInEpochRef.current !== myEpoch
      ) {
        // 🟡 v0.48.1 r3(codex 재검증 잔여) — `interrupt:false` 전환은 철회했다. 직접수정
        //   경로(:1332 부근)와 동일 근거 — 상세는 거기 주석 참조(④ TODO에 합류).
        await say(`인식값 ${alert.next}`);
      }
      // F5(low, claude) — lastTts는 갱신하지 않는다: alertText가 triad(화면==TTS==로그) SSOT라
      //   2차 발화까지 반영하면 화면의 "마지막 안내"와 로그 text=가 어긋난다(의도된 선택).
      // v0.34.0 O1 — 재위반(정정값이 또 위반) 커밋도 검사 대상(이전 .then 무조건 실행과 동등) —
      // 단 알람 TTS까지 끝난 지금 시점에 스케줄한다.
      runCorrectedPersistCheck();
      return; // advance 중단 — 해소는 명령 스테이지(useFinalCommands)의 trendConfirm 분기
    }

    // ── v0.51.1 R6 — 혼동 후보 확인 질문(민구 결정 09-02 ①: 커밋은 이미 됐다 · echo 대신 질문) ──
    //   알람이 위에서 떴으면 여기 오지 않는다(알람 우선 — 민구 #3). 답변 재커밋(confusionConfirm)에는 다시 묻지
    //   않고, 셀·세션 상한은 `evaluateSttConfusion`이 센다. 🔴 후보는 혼동표 확률만으로 고른다(ⓐ — 세션 내 값
    //   규칙 없음). 값 이벤트·정정 쌍은 정상 커밋과 **같은 형태**로 먼저 남긴다(질문은 그 뒤의 일이다).
    if (awaiting.kind !== 'confusionConfirm') {
      const q = evaluateSttConfusion({ row: awaiting.row, colId: awaiting.colId, colName: awaiting.name, col, heard: parsed }, logCell);
      if (q) {
        logCell({
          type: 'value',
          row: awaiting.row, colId: awaiting.colId, colName: awaiting.name,
          text, parsed, confidence,
          durationMs: commitLatencyMs,
          ...(lowConfParsedExtra ? { extra: lowConfParsedExtra } : {}),
          ...(isModifyLike(awaiting) && previousValueOf(awaiting) != null
            ? { previousValue: previousValueOf(awaiting) }
            : {}),
        });
        noteSttVoiceCommit({
          row: awaiting.row, colId: awaiting.colId, colName: awaiting.name, col,
          text, conf: confidence, altIdx: ctx.altIdx ?? null, parsed,
          previousValue: isModifyLike(awaiting) ? previousValueOf(awaiting) ?? null : null,
          path: isModifyLike(awaiting) ? 'rerecord' : 'value',
        }, logCell);
        armSttConfusion(q);
        // 응답 대기 상태 무장 — 「둘째」/재발화가 수정 의미론(previousValue=들린 값)으로 재커밋되도록. 착지 예약
        // (resumeReview/resumeCell)은 알람 재무장과 같은 이유로 보존한다.
        awaitingFieldRef.current = {
          kind: 'confusionConfirm',
          row: awaiting.row, colId: awaiting.colId, name: awaiting.name,
          previousValue: parsed, heard: parsed, cands: q.cands, rules: q.rules,
          ...(resumeReviewOf(awaiting) != null ? { resumeReview: resumeReviewOf(awaiting) } : {}),
          ...(resumeCellOf(awaiting) != null ? { resumeCell: resumeCellOf(awaiting) } : {}),
        };
        // 응답 발화 클립 시작(알람과 같은 패턴 — TTS 이전 시작, barge-in 수록).
        armClipForCell(awaiting.row, awaiting.colId);
        playBeep('alert');
        const question = confusionQuestionTts(parsed, q.cands);
        useSessionStore.getState().setLastTts(question);
        bargeInEpochRef.current = -1;
        await say(question);
        runCorrectedPersistCheck();
        return; // advance 중단 — 해소는 값 게이트(답변)·명령 스테이지('확인'/타 명령)의 confusionConfirm 분기
      }
    }

    // ── v0.13.0 R2(민구 요청): 추세 알림에 새 값으로 응답한 정정이 '정상'으로 판명된 경우 ──
    // (위 trendViolation 분기를 타지 않고 여기 도달 = 정정값이 정상 범위.) 화면에 떠 있던 빨강 이상치
    // 팝업을 초록(corrected)으로 전환하고 next를 정정값으로 즉시 반영한다. 이전엔 이 경로에서 팝업을
    // 전혀 갱신하지 않아 옛 이상치 값이 남은 채 echo TTS("수정 …")만 새 값을 말해 시각/청각이 어긋났다.
    // 팝업 닫힘은 advance()의 착지점(다음 필드·끝 도달·검토 대기)이 clearAnomalyAlert로 담당하므로,
    // echo TTS가 발화되는 동안 초록 팝업이 노출되고 착지 직전에 전수 계측과 함께 내려간다.
    let beeped = false;
    if (awaiting.kind === 'trendConfirm') {
      const cur = useSessionStore.getState().anomalyAlert;
      if (cur) {
        useSessionStore.getState().setAnomalyAlert({
          ...cur,
          next: formatForTts(parsed),
          status: 'corrected',
        });
        playBeep('corrected');
        beeped = true;
      }
    }
    // 🔴 v0.47.0 W2(FB-C+G①, 민구 08-08) — **수정 성공 커밋 = 화음 + green.** 종전엔 여기서
    //   중립 단음(playBeep('modify'))을 내고 beeped 가드로 아래 화음을 건너뛰었다 — 그 단음은
    //   "모드 전환" 신호라 진입(announceField isModify)으로 옮겼고, 성공은 다른 모든 커밋과
    //   동일한 화음을 받는다(kind='modify'는 beeped를 세우지 않아 아래 공용 화음이 난다).
    //   committed=true가 VoiceScreen 톤 파생을 amber→green으로 뒤집는다(재청취 중은 amber —
    //   §C4 의미 보존). 해제는 announceField(다음 안내)·종단 착지가 modifyIndicator와 함께.
    // v0.47.0 C-FIX1ⓑ(리뷰 U2·U5) — kind='modify'만 보던 종전 판정의 구멍: **수정→이상치 알람→
    //   정정 확정**은 awaiting이 trendConfirm으로 승격돼 있어 committed가 안 서고, 성공했는데
    //   착지까지 amber가 남았다. isModifyLike(modify+trendConfirm)로 판정한다 — 수정 문맥이
    //   없던 일반 정정은 modifyIndicator가 null이라 이 플래그가 시각 효과를 갖지 않는다(무해).
    if (isModifyLike(awaiting)) {
      useModifyPhase.getState().setCommitted(true);
    }

    // 🔴 v0.46.0 WP-E(제보 F7② — 민구 지시 08-05) — **커밋 확인음**. 종전엔 정상 커밋 경로에
    // 소리가 아예 없었다(alert·corrected·modify 3종뿐). 값이 저장되는 모든 커밋에 확인음이 난다.
    // 🔑 **순서가 계약이다: 확인음 → 인식값 TTS**(민구 지정). 그래서 아래 echo speak() 바로 앞이다.
    // `beeped` 가드는 **중복 방지 전용**이다 — 정정 완료(corrected)는 이미 자기 소리(긍정 화음)를
    // 냈고 그 위에 확인음을 겹치면 두 신호가 한 순간에 섞여 구분이 안 된다.
    // (수정 성공은 v0.47.0 W2부터 이 공용 화음을 그대로 받는다 — 위 분기 주석 참조.)
    // ⚠️ trendConfirm인데 팝업(anomalyAlert)이 이미 내려간 경우는 corrected 비프가 안 나므로
    // 여기서 확인음이 난다 — 커밋은 성공했으니 소리가 없는 편이 더 나쁘다.
    if (!beeped) playBeep('commit');

    const echoText = isModifyLike(awaiting)
      ? `수정 ${formatNameForTts(awaiting.name)} ${formatForTts(parsed)}`
      : formatForTts(parsed);
    const echoEnqueuedAt = Date.now();
    await speak(echoText, {
      interrupt: true,
      rate: getTtsRate(),
      onStart: (d) => {
        logCell({
          type: 'tts',
          ttsText: echoText,
          startDelayMs: d,
          durationMs: Date.now() - echoEnqueuedAt,
          row: awaiting.row,
          extra: 'echo',
        });
      },
    });

    logCell({
      type: 'value',
      row: awaiting.row,
      colId: awaiting.colId,
      colName: awaiting.name,
      text,
      parsed,
      confidence,
      durationMs: commitLatencyMs, // v0.20.0 Phase 5 #4 — 발화 확정→커밋 반응속도(ms)
      // v0.43.0 #3 계측 — 저신뢰인데 파싱돼서 통과한 커밋만 마커가 붙는다(정상 커밋은 없음).
      ...(lowConfParsedExtra ? { extra: lowConfParsedExtra } : {}),
      // #3 error-vs-intent: present only when this value re-commits a corrected cell.
      // previousValue (pre-modify) vs parsed (final) discriminates STT prefix-drop from re-entry.
      ...(isModifyLike(awaiting) && previousValueOf(awaiting) != null
        ? { previousValue: previousValueOf(awaiting) }
        : {}),
    });
    // v0.51.1 R6 — 정정 쌍 명시 이벤트(`stt_correction`) + 화자 프로필 갱신. `value` 이벤트 **뒤**에 남겨
    //   판독이 「커밋 → 그 커밋이 만든 쌍」 순서로 읽는다. 재녹음(modify/trendConfirm)이면 previousValue와 짝.
    noteSttVoiceCommit({
      row: awaiting.row, colId: awaiting.colId, colName: awaiting.name, col,
      text, conf: confidence, altIdx: ctx.altIdx ?? null, parsed,
      previousValue: isModifyLike(awaiting) ? previousValueOf(awaiting) ?? null : null,
      path: awaiting.kind === 'confusionConfirm' ? 'confusion' : isModifyLike(awaiting) ? 'rerecord' : 'value',
    }, logCell);

    // v0.34.0 O1 — 교정 persist 검사는 커밋 경로 종단(echo TTS·value 이벤트 이후)에 스케줄.
    runCorrectedPersistCheck();

    // Guard against race: another handleFinal ran while we were awaiting
    if (epochRef.current !== myEpoch) return;
    // v0.47.0-r2 P1 — 검토 대기 출신 직접 수정이 알람을 경유해 **새 값으로 재커밋**된 경우의
    //   착지. 예약이 없으면(=기존 모든 흐름) 값이 undefined라 종전대로 advance로 간다.
    // 🔴 v0.49 r2 A2 — 그 판정을 `proceedAfterCommit`(정본)에 넘긴다. 종전엔 여기서 행 예약만
    //   읽었기 때문에, **bare '수정' 후 재기록**(2단계 수정)이 셀 검토 대기 출신이어도 그대로
    //   `advance()`로 빠졌다(codex F1 = 합집합 C3). 이제 셀 축 예약(resumeCell)도 같은 문에서
    //   판정된다 — 예약이 둘 다 없으면 종전과 동일하게 advance()다.
    await proceedAfterCommit(awaiting);
  }, []);

  return { runCommitLanding };
}
