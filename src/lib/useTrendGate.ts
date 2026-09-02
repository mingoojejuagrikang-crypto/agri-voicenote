/**
 * [ENV-12] Stage 3 서브 훅 #5 — **추세 검증 · 이상치 응답**(구획 3개의 순수 이동):
 * 추세 검증 계열(logTrendSkip·armRejectCue·rejectValue 종단·relistenInContext·evaluateTrend·
 * getAnomalyAlertData) + trendConfirm 응답 대기 중 터치 2종(confirmAnomalyTouch·modifyAnomalyTouch)
 * + 수동 입력 이상치 보류(manualHold) 터치 2종(confirmManualAnomaly·modifyManualAnomaly).
 * 세션 컨텍스트는 여전히 `useVoiceSession`이 소유하므로 주입받는다(`useClipCapture`와 같은 계약).
 *
 * ⚠️ 규범 이탈 자진 신고 — `awaitingFieldRef`·`epochRef`·`trendSkipLoggedRef` 3종은 getter가 아니라
 * **ref 그대로** 받는다(영구):
 *  ① 앞의 둘은 본체(handleFinal·advance)와 이 훅이 함께 읽고 쓰는 다중 기록자 조정 상태라 접근자
 *     분해는 간접층만 늘린다. 소스 계약 스펙(r7-06 ①)이 `proceedAfterCommit(awaitingFieldRef.current)`
 *     **부재**를 재는 것도 이 바이트 형태 위에 서 있다(useRowNav.ts 헤더와 같은 판단).
 *  ② `trendSkipLoggedRef`는 **동결 코어 `start()`가 직접 리셋**하는 세션 경계 장부다
 *     (`trendSkipLoggedRef.current = new Set();`). ref 주입이 그 한 줄을 바이트 불변으로 남기는
 *     유일한 방법이다 — 동결 코어의 접점은 절단이 아니라 주입으로 보존한다. getter 전환 금지.
 */
import { useCallback, useRef } from 'react';
import { useSessionCommitMarks } from '../components/voice/useVoiceCommitMark';
import { useDataStore } from '../stores/dataStore';
import { useSessionStore } from '../stores/sessionStore';
import type { AudioRecorder } from './audioRecorder';
import { playBeep } from './beep';
import { saveSession } from './db';
import type { logger } from './logger';
import { useModifyPhase } from './modifyPhase';
import { cancelTts } from './speech';
import { type TrendViolation } from './trendCheck';
import { evaluateTrendForRow, anomalyAlertContext } from './trendEvaluate';
import type { Column } from '../types';
import type { AwaitingField } from './useVoiceSession';
import { decimalReaskPrompt, REASK_TTS, relistenPrompt } from './voicePrompts';

type LogCell = (entry: Omit<Parameters<typeof logger.log>[0], 'sessionId'>) => void;

export interface TrendGateDeps {
  logCell: LogCell;
  say: (text: string) => Promise<boolean>;
  armClipForCell: (row: number, colId: string) => void;
  clearAnomalyAlert: (reason: string) => void;
  proceedAfterCommit: (awaiting: AwaitingField | null, opts?: { echoValue?: string }) => Promise<void>;
  /** 행 완료 부기 — durable 결과를 돌려준다(r6 Y1). 보류 [확인]이 실패를 받아 멈춘다. */
  finalizeRowCompletion: (row: number) => Promise<boolean>;
  notifyRowPersistFailed: (row: number, landing?: AwaitingField | null) => void;
  getSessionColumns: () => Column[];
  /** 행 전체 값 합성 규칙 — persistSession과 evaluateTrend가 공유하는 단일 출처(본체 모듈 헬퍼). */
  composeRowValues: (columns: Column[], row: number) => Record<string, string>;
  localTodayISO: () => string;
  fractionWholeOf: (a: AwaitingField) => string | undefined;
  isModifyLike: (a: AwaitingField) => boolean;
  demoteTrendConfirm: (a: Extract<AwaitingField, { kind: 'trendConfirm' }>) => AwaitingField;
  /** 세션 시작 시점의 로컬 오늘 ISO(start()에서 1회 계산) — 미설정 센티넬은 ''다(r7 #2 `||`). */
  getSessionToday: () => string;
  getRecorder: () => AudioRecorder | null;
  /** 현재 세션 id — 세션 경계마다 바뀌므로 값이 아니라 getter로 받는다. */
  getSessionId: () => string;
  /** 세션당 1회 dedupe 장부 — 동결 코어 start()가 세션 경계마다 리셋한다(헤더 ② 참조). */
  trendSkipLoggedRef: { current: Set<string> };
  awaitingFieldRef: { current: AwaitingField | null };
  epochRef: { current: number };
}

export function useTrendGate(deps: TrendGateDeps) {
  // 주입 deps를 ref로 받아 **노출 함수 identity를 영구 고정**한다(useClipCapture:57-63 계약 —
  // 반환 함수들이 본체 handleFinal 의존성에 들어가므로 identity가 흔들리면 STT 배선이 요동친다).
  const depsRef = useRef(deps);
  depsRef.current = deps;

  /** trend_skip 텔레메트리 — 같은 원인은 세션당 1회만 기록(셀마다 반복돼 로그를 도배하지 않게).
   *  Set은 start()에서 리셋된다. */
  const logTrendSkip = useCallback((cause: string, row: number, colId: string) => {
    const { logCell, trendSkipLoggedRef } = depsRef.current;
    if (trendSkipLoggedRef.current.has(cause)) return;
    trendSkipLoggedRef.current.add(cause);
    logCell({ type: 'trend', extra: `trend_skip:${cause}`, row, colId });
  }, []);

  /** 🔴 v0.49 r3 #6(claude r2 MEDIUM) — **값 거절의 단일 종단.**
   *
   *  거절은 한 벌의 신호다: 화면 큐(`ReaskCue` 사유) + 부정 비프 + 사유 TTS(§2 쌍 상수).
   *  그런데 거절 분기는 **6개**이고(컬럼명 일치 · KNOWN_NOISE · bare 응답어 · 단음절 동음이의 ·
   *  저신뢰 · 파싱 실패) B2는 그중 **뒤 2개만** 배선했다. 앞 4개는 무비프에다 W2 개정 **이전의**
   *  인라인 리터럴("{항목} 다시 말씀해 주세요.")을 그대로 읽고 있었다 — 같은 사건이 어느 분기로
   *  들어오느냐에 따라 소리도 문구도 갈렸고(§2 「구조적 분리는 쌍 상수로만」 위반), `beep_play:
   *  kind=reject` 집계는 실제 거절의 1/3만 셌다.
   *
   *  ⚠️ **분기마다 배선하지 않는다.** 파싱 실패 분기의 자기 주석이 이미 *"분기마다 배선하면 다음
   *  분기가 추가될 때 조용히 빠진다(이 파일이 반복해 겪은 드리프트)"* 라고 적어 놨는데, 그 경고가
   *  **분기 안**에만 적혀 있어서 형제 4개가 그대로 빠져 있었다. 종단을 하나로 만든다.
   *
   *  분기별로 다른 것(로그 타입 · 클립 재시작 여부 · `recognized` 정리)은 **호출부에 남긴다** —
   *  그건 거절 표면이 아니라 각 분기의 고유 계약이다. */
  const armRejectCue = useCallback((reason: 'low_confidence' | 'parse_failed') => {
    useSessionStore.getState().setReaskReason(reason);
    // TTS **이전에** 낸다 — 커밋 확인음이 세운 「신호음 → 말」 순서 계약과 같다(민구 지정).
    playBeep('reject');
  }, []);

  /** 거절 종단 — 표면 + 사유 TTS.
   *
   *  🔴 v0.49 r4 M3(claude r3 #3) — **소수부 타깃 재질문 문맥을 이 종단이 직접 안다.**
   *  종전엔 「소수 문맥이면 전용 문구」를 각 분기가 알아서 처리했고, r3 #6이 신규 편입한 두 분기
   *  (컬럼명 일치 · KNOWN_NOISE)가 그 처리를 빠뜨렸다. 그러면 이렇게 된다:
   *    ① `armRejectCue`의 `setReaskReason`이 `reaskDecimalWhole`을 **함께 지운다**(store 계약) →
   *       화면 큐가 「111 점, 소수점 아래…」에서 일반 사유로 바뀐다.
   *    ② TTS도 일반 사유만 읽는다.
   *    ③ 그런데 `awaiting.fractionWhole`은 **살아 있다**(분기가 awaiting을 안 건드리고 return).
   *    👉 사용자는 소수 문맥이 끝난 줄 아는데 다음 '오'는 `111.5`로 합성된다 — **무고지 커밋**.
   *  게다가 KNOWN_NOISE는 `startClip()`을 무조건 불러 [CLIP-DECIMAL-FRAG-1](소수 재질문 중
   *  클립 재시작 금지 — 원본 전체발화 버퍼 폐기)까지 어겼다.
   *
   *  ⚠️ **분기마다 배선하지 않는다** — #6이 세운 그 교훈이 정확히 여기서 또 깨졌다. 재검증 중
   *  리뷰가 지목하지 않은 **세 번째 구멍**을 찾았다: 저신뢰 거절(`stt_rejected_low_confidence`)도
   *  소수 문맥에서 도달 가능하고 같은 두 결함을 그대로 갖고 있었다. 그래서 문맥 판정을 종단이
   *  소유하고, 분기는 「클립을 다시 시작할 것인가」만 옵션으로 넘긴다(그건 분기 고유 계약이다 —
   *  단, 소수 문맥에서는 종단이 그 요청을 **무시**한다. 그게 [CLIP-DECIMAL-FRAG-1]이다).
   *  오라클: tests/v049-r4-m3-reject-fraction.spec.ts */
  const rejectValue = useCallback(async (
    reason: 'low_confidence' | 'parse_failed',
    awaiting?: AwaitingField | null,
    // 🔴 v0.49 r5 Z5(codex R4-F3) — `tail`은 **소수 문맥이 아닐 때만** 쓰는 꼬리 문구다.
    //   저신뢰 **명령** 거절은 값 거절과 꼬리가 달라야 한다("사유"가 아니라 "다시 말씀해 주세요") —
    //   명령이 안 들린 것이지 값이 파싱 안 된 게 아니기 때문이다. 그 차이 때문에 그 분기가 이
    //   종단을 통째로 우회했고, 우회한 김에 **소수 문맥 처리까지 손으로 다시 적어** 화면과 다른
    //   TTS를 말했다(R4-F3). 꼬리만 인자로 받으면 문맥 처리는 종단이 계속 소유한다.
    //   ⚠️ `whole`은 **새로 여는** 소수 문맥의 정수부다(`awaiting`엔 아직 안 실려 있다).
    //     기존 문맥은 종전대로 `awaiting`에서 읽는다 — 두 입구가 같은 꼬리로 수렴한다.
    opts?: { restartClip?: boolean; tail?: string; whole?: string },
  ) => {
    const { say, fractionWholeOf, getRecorder } = depsRef.current;
    armRejectCue(reason);
    const whole = opts?.whole ?? (awaiting ? fractionWholeOf(awaiting) : null);
    if (whole != null) {
      // [CLIP-DECIMAL-FRAG-1] — 클립 재시작 금지(호출부 요청 무시). 정수부를 다시 실어 화면 큐가
      //   TTS와 같은 문구를 유지한다(확정표 #3 「현행 유지」 — 문구는 사유와 무관하게 하나다).
      useSessionStore.getState().setDecimalReason(String(whole), reason);
      await say(decimalReaskPrompt(whole));
      return;
    }
    if (opts?.restartClip) getRecorder()?.startClip();
    await say(opts?.tail ?? REASK_TTS[reason]);
  }, []);

  /**
   * 🔴 v0.49 r5 Z6(claude #6) — **재청취 안내의 소수 문맥 판정 한 곳.**
   *
   * `'수정'`(재수정)과 `'취소'`는 **거절이 아니다** — 접수된 명령이고 앱이 같은 칸을 다시 듣는다.
   * 그래서 `rejectValue`(비프 + 거절 큐)를 타지 않는다. 하지만 「살아 있는 소수부 재질문 문맥에서는
   * 문구도 클립도 그 문맥을 따른다」는 **같은 계약**을 진다. 두 곳이 그걸 각자 안 지키고 있었다:
   *
   *   ① **표면 모순** — 화면은 「111 점, 소수점 아래」인데(문맥이 살아 있으므로 큐가 그대로 떠
   *      있다) 귀에는 `측정항목01 다시 말씀해 주세요.`가 들렸다. 사용자가 전체값을 말해야 하는지
   *      소수부만 말해야 하는지 알 수 없다(PRINCIPLES §2 — R4-F3와 같은 형태). 그리고 전체값을
   *      말하면 `awaiting.fractionWhole`이 살아 있어 합성 규칙과 충돌한다.
   *   ② **[CLIP-DECIMAL-FRAG-1] 위반** — `armClipForCell`이 슬롯을 재시작하면 직전 원본 전체발화
   *      버퍼가 폐기돼 커밋 클립에 조각만 남는다. 소수 재질문은 조각 발화만 유도하므로 그 슬롯은
   *      **계속 녹음**해야 한다(그 계약의 본문).
   *
   * ⚠️ 소수 문맥이 아니면 종전 그대로다 — 슬롯 재무장은 [CLIP-VAL-1]①이 세운 계약이고
   *   (`say()`는 `announceField`와 달리 클립을 시작하지 않는다), 문구는 §2 쌍 상수다.
   * 오라클: tests/v049-r5-z6-relisten-context.spec.ts
   */
  const relistenInContext = useCallback(async (a: AwaitingField): Promise<void> => {
    const { say, armClipForCell, fractionWholeOf } = depsRef.current;
    const whole = fractionWholeOf(a);
    if (whole != null) {
      // 화면 큐는 이미 이 문구를 그리고 있다(아무도 지우지 않았다) — 다시 세우지 않고 맞춘다.
      await say(decimalReaskPrompt(whole));
      return;
    }
    armClipForCell(a.row, a.colId);
    await say(relistenPrompt(a.name));
  }, []);

  /** 방금 커밋된 값의 이상치 알람 검사(v0.8.0). 전역 마스터 토글 제거 — 컬럼에 방향 규칙
   *  (trendRule) 또는 변동률 % 임계값(pctThreshold)이 하나라도 있으면 활성. 규칙 없는 컬럼은
   *  검사 자체가 없고(로그 없음), 판정 불가(인덱스 없음·키 불완전·직전 회차/과거값 없음)는
   *  조용히 skip + trend_skip 1회(telemetry 키 'trend'/trend_skip 유지 — 로그 연속성).
   *  여기서는 절대 fetch하지 않는다 — start()의 프리페치가 채운 캐시(getCachedIndex)만 본다
   *  (행 단위 재fetch 금지, B2 설계). */
  const evaluateTrend = useCallback(
    (col: Column | null, row: number, colId: string, nextRaw: string): TrendViolation | null => {
      const {
        logCell, getSessionColumns, composeRowValues, localTodayISO, getSessionToday, trendSkipLoggedRef,
      } = depsRef.current;
      const columns = getSessionColumns();
      return evaluateTrendForRow({
        col,
        columns,
        // 현재 행의 전체 값(자동·고정·음성) — persistSession과 같은 composeRowValues 합성.
        // thunk로 넘겨 인덱스/키 검사 통과 시에만 계산(종전 순서 보존).
        composeRow: () => composeRowValues(columns, row),
        // 로컬 날짜(UTC 아님) — start()에서 세션당 1회 계산(핫패스 호이스팅), ref 빈 경우만 지연 계산.
        today: getSessionToday() || localTodayISO(),
        nextRaw,
        onSkip: (cause) => logTrendSkip(cause, row, colId),
        // 폴백 사용 계측(세션당 1회 — trend_skip과 동일 dedupe 컨벤션). age_h = 비교선 나이.
        onStaleIndex: (ageH) => {
          if (trendSkipLoggedRef.current.has('used_stale_index')) return;
          trendSkipLoggedRef.current.add('used_stale_index');
          logCell({
            type: 'trend', extra: `trend_used_stale_index:age_h=${ageH}`,
            row, colId,
          });
        },
      });
    },
    // logTrendSkip은 []-고정 const라 클로저 캡처로 identity가 불변이다(동일-훅 상호 참조).
    [],
  );

  /** v0.12.0 AREA2 V2 — 이상치 팝업에 곁들일 식별정보(샘플키 + 직전 회차 ISO 날짜)를 재계산한다.
   *  evaluateTrend와 같은 캐시(getCachedIndex)·키 합성을 쓰되 TrendViolation 타입은 순수하게 유지
   *  한다(trendCheck.ts 오염 금지 — 표시용 부가정보는 여기서 별도 산출). 캐시 없음·키 불완전이면
   *  해당 필드를 undefined로 둔다(팝업이 '행 N' 폴백 + 날짜 라벨 생략으로 안전 처리). */
  const getAnomalyAlertData = useCallback(
    (row: number): { sampleKey?: string; prevDate?: string } => {
      const { getSessionColumns, composeRowValues, localTodayISO, getSessionToday } = depsRef.current;
      const columns = getSessionColumns();
      return anomalyAlertContext({
        columns,
        composeRow: () => composeRowValues(columns, row),
        today: getSessionToday() || localTodayISO(),
      });
    },
    [],
  );

  // ── v0.33.0 항목7 — 이상치 응답 대기(trendConfirm) 중 터치 버튼: 음성 명령과 동일 동작·동일 로그 ──
  /** [확인] 버튼 — 음성 '확인'과 동일: 커밋된 값 확정 + 팝업 해제 + advance 1회. attribution은
   *  선행 command 이벤트의 extra('touch' vs 음성의 tts_*)로 구분되고 trend 이벤트는 글자 동일. */
  const confirmAnomalyTouch = useCallback(async () => {
    const { logCell, clearAnomalyAlert, proceedAfterCommit, awaitingFieldRef, epochRef } = depsRef.current;
    const awaiting = awaitingFieldRef.current;
    if (awaiting?.kind !== 'trendConfirm') return; // 응답 대기 중이 아니면 no-op(정보성 팝업 등)
    epochRef.current++;
    cancelTts();
    logCell({
      type: 'command', parsed: 'confirm', extra: 'touch',
      row: awaiting.row, colId: awaiting.colId,
    });
    clearAnomalyAlert('touch_confirm');
    logCell({
      type: 'trend', extra: 'trend_alert_confirmed', parsed: 'confirm',
      row: awaiting.row, colId: awaiting.colId,
      ...(awaiting.previousValue != null ? { previousValue: awaiting.previousValue } : {}),
    });
    awaitingFieldRef.current = null;
    // 🔴 v0.49 r2 A2 — 음성 '확인'(:trendResolve)과 **같은 문**을 쓴다. 종전엔 이 터치 형제만
    //   행 예약을 직접 읽어, 같은 상태·같은 목적의 조작이 **입력 수단에 따라** 갈렸다
    //   (fix49b #7이 키패드 재커밋에서 고친 것과 정확히 같은 비대칭). P1 검토 대기 착지 계약은
    //   `proceedAfterCommit` 안에 그대로 산다.
    await proceedAfterCommit(awaiting);
  }, []);

  /** [수정] 버튼 — 음성 '수정'(trendConfirm 해제 → isModify 재청취)과 동일 착지: 같은 필드에서
   *  대기하며 기존값은 새 발화가 덮어쓰기 전까지 보존된다. 터치에는 보존할 명령 발화가 없으므로
   *  preserveCommandClip 없이 클립 슬롯만 재무장한다. */
  const modifyAnomalyTouch = useCallback(async () => {
    const {
      logCell, clearAnomalyAlert, demoteTrendConfirm, awaitingFieldRef, epochRef,
    } = depsRef.current;
    const awaiting = awaitingFieldRef.current;
    if (awaiting?.kind !== 'trendConfirm') return;
    epochRef.current++;
    cancelTts();
    logCell({
      type: 'command', parsed: 'modify', extra: 'touch',
      row: awaiting.row, colId: awaiting.colId,
    });
    clearAnomalyAlert('touch_modify');
    logCell({
      type: 'trend', extra: 'trend_alert_dismissed:modify',
      row: awaiting.row, colId: awaiting.colId,
    });
    // 음성 경로의 trendConfirm 해제('modify' 강등 후 재질문)와 동일 상태(fractionWhole 보존).
    const demoted = demoteTrendConfirm(awaiting);
    awaitingFieldRef.current = demoted;
    // 🔴 v0.49 r6 Y4(claude #2) — **재청취 안내는 `relistenInContext`가 소유한다**(그 헤더).
    //   종전 이 두 줄(`armClipForCell` + `say(relistenPrompt)`)은 Z6이 만든 깔때기를 안 타는
    //   **세 번째 재청취**였다. 바로 위 `demoteTrendConfirm`이 `fractionWhole`을 **보존**하므로
    //   (그 계약) 소수 문맥이 살아 있는 채로 여기 오는데, 그 상태에서 두 반쪽을 다 어겼다:
    //     ① 표면 모순 — 화면 큐는 「130 점, 소수점 아래」인데 귀는 「횡경 다시 말씀해 주세요」.
    //        안내를 믿고 전체값을 말하면 살아 있는 `fractionWhole`과 합성 규칙이 충돌한다.
    //     ② [CLIP-DECIMAL-FRAG-1] — `armClipForCell`이 슬롯을 재시작해 직전 원본 전체발화
    //        버퍼를 폐기한다. 소수 재질문은 조각 발화만 유도하므로 그 슬롯은 계속 녹음해야 한다.
    //   M11의 「[수정] 터치는 접수된 조작이라 거절 신호를 붙이지 않는다」는 그대로다 —
    //   `relistenInContext`도 비프·거절 큐를 만들지 않는다(그게 그 함수의 존재 이유다).
    await relistenInContext(demoted);
    // relistenInContext는 []-고정 const라 클로저 캡처로 identity가 불변이다(동일-훅 상호 참조).
  }, []);

  // ── v0.34.0 A1 — 수동 입력 이상치 **보류**(manualHold) 팝업의 터치 버튼 ──
  //   위 confirmAnomalyTouch/modifyAnomalyTouch는 trendConfirm 가드라 음성 경로 전용 — 수동 보류는
  //   별도 함수로 무충돌 분리한다(트리거 가드도 anomalyAlert.manualHold). 해제 콜백은 RACE-1 패턴
  //   (epoch bump + cancelTts 후 진행 — confirmAnomalyTouch와 동일 복제).
  /** [확인] — 커밋된 수동 값 확정 + 팝업 해제 + 보류했던 진행 재개(advance 1회.
   *  검토 대기 출신이면 enterReviewWait 재진입 — 갱신값 재낭독 + 명령 대기). */
  const confirmManualAnomaly = useCallback(async () => {
    const {
      logCell, clearAnomalyAlert, proceedAfterCommit, finalizeRowCompletion, notifyRowPersistFailed,
      isModifyLike, getSessionId, awaitingFieldRef, epochRef,
    } = depsRef.current;
    const alert = useSessionStore.getState().anomalyAlert;
    if (!alert?.manualHold) return; // 보류 팝업이 아니면 no-op
    const staged = useDataStore.getState().sessions.find((s) => s.id === getSessionId());
    // 팝업이 보이더라도 후보+pending 단일 put이 아직 끝나지 않았거나 태그 자체가 없으면 절대
    // alert를 해제/advance하지 않는다. 느린 IDB와 ManualValueSheet fire-and-forget 사이 우회 차단.
    if (!staged?.pendingValidation || staged.pendingValidationPersisting) {
      logCell({
        type: 'command', parsed: 'confirm', extra: 'blocked:manual_hold:not_durable',
        row: alert.row, ...(alert.colId ? { colId: alert.colId } : {}),
      });
      return;
    }
    epochRef.current++;
    cancelTts();
    logCell({
      type: 'command', parsed: 'confirm', extra: 'touch:manual_hold',
      row: alert.row, ...(alert.colId ? { colId: alert.colId } : {}),
    });
    if (staged.pendingValidation) {
      const confirmed = { ...staged };
      delete confirmed.pendingValidation;
      // [확인]은 후보를 확정값으로 승격하는 유일한 경로다. IDB 저장이 끝난 뒤에만 메모리 hold를
      // 지워, 쿼터/트랜잭션 실패 시 화면만 확정된 것처럼 진행하는 불일치를 막는다.
      try {
        await saveSession(confirmed);
        useDataStore.getState().upsertSession(confirmed);
      } catch (err) {
        logCell({
          type: 'error', extra: `manual_hold_confirm_persist_failed:${String((err as Error)?.message ?? err)}`,
          row: alert.row, ...(alert.colId ? { colId: alert.colId } : {}),
        });
        return;
      }
    }
    clearAnomalyAlert('manual_hold_confirm');
    logCell({
      type: 'trend', extra: 'trend_alert_confirmed', parsed: 'confirm',
      row: alert.row, ...(alert.colId ? { colId: alert.colId } : {}),
    });
    // v0.37.0 리뷰#1 — 이상치 정정(수동 보류) [확인] 커밋 영수증: 검토 화면은 **정정되어 확정된**
    //   후보값(candidateValue)을 보여야 한다(거부된 직전값 아님). proceedAfterCommit(advance→검토) 전에 발행.
    {
      const pv = staged.pendingValidation;
      if (pv) {
        useSessionStore.getState().pushCommitReceipt(pv.row, pv.colId, alert.colName, pv.candidateValue);
        // v0.47.0 W4(FB-E) — 보류 후보가 [확인]으로 **확정되는 순간** ✓ 등록(후보 단계는 제외).
        useSessionCommitMarks.getState().add(pv.row, pv.colId);
      }
    }
    // v0.47.0 C-FIX1ⓑ 동축 — 보류 [확인] 확정도 수정 문맥(수정 중 수동 재커밋의 hold)이면
    // 성공 신호를 세운다(voice 정정 경로와 대칭 — amber 잔존 방지).
    {
      const aw = awaitingFieldRef.current;
      if (aw && isModifyLike(aw)) useModifyPhase.getState().setCommitted(true);
    }
    // 보류 시 재무장을 미뤘던 진행 재개 — reviewWait 출신은 검토 대기 재진입, 그 외 advance
    // (commitManualValue와 동일 착지, proceedAfterCommit SSOT).
    //
    // 🔴 v0.49 r7 #6(codex r6#14) — **착지 전에 보류 셀의 소유권을 다시 확인한다.**
    //   종전엔 `awaitingFieldRef.current`를 그대로 넘겼다. 그 ref가 보류 시점의 것이라는 보장이
    //   이 함수 안에는 없는데, 넘긴 값이 어긋나면 피해가 둘이다:
    //     ① `proceedAfterCommit`이 **남의 행에 착지한다** — 그 행의 열린 칸을 `advance()`로
    //        지나쳐 사용자가 방금 안내받은 칸이 조용히 건너뛰어진다.
    //     ② 그 안의 `finalizeRowCompletion(awaiting.row)`가 **남의 행에 걸려** 보류한 행이 완료
    //        부기를 영영 못 받는다. `persistSession`은 rows를 completedRows·activeRow·skippedRows
    //        셋에서만 만들므로 어느 집합에도 없는 그 행은 다음 persist에서 **통째로 떨어진다**
    //        (Z8이 닫은 값 유실이 이 경로로 다시 열린다).
    //   👉 술어는 `commitManualValue`와 **같다**(M1이 세운 「착지도 같은 술어를 쓴다」). 좌표 정본은
    //      `pendingValidation`이다 — 그게 보류된 커밋의 SSOT다.
    //   👉 내구성 부기는 **소유와 무관**하게 보류된 행에 건다(Z8의 계약: 부기는 흐름 소유권이
    //      아니라 커밋 사실에 붙는다). 소유면 `proceedAfterCommit`이 같은 함수를 다시 부르지만
    //      멱등이라 IDB 쓰기가 늘지 않는다.
    //
    //   ⚠️ **전제 재검증(실측 2026-08-14, 브리핑 원문과 갈림)**: 리뷰가 상정한 「점프 창」은
    //     현행 UI에서 **도달 불가**다. manualHold 중 포인터를 옮길 수 있는 진입로는 넷인데
    //     STT·[이전]/[다음]·[일시정지] 셋은 `isManualHoldBlocked`가 막고, 게이트를 안 지나는
    //     넷째(자동 컬럼 칩 인라인 편집 → `computeRowFromAutoChange` → `jumpToRow`)는 팝업
    //     오버레이가 칩을 덮어 **클릭 자체가 불가**했다(브라우저 실측: click actionability 타임아웃).
    //     남는 도달로는 reload 복원 경로가 `getColById(pending.colId)` 실패로 조기 return해
    //     ref가 **null인 채** 팝업만 서는 형상뿐이다 — 그때 종전 코드는 `proceedAfterCommit(null)`로
    //     부기를 통째로 건너뛴다.
    //   👉 그래서 이건 증상 수정이 아니라 **구조적 backstop**이다(Z2의 armLanding 거절·Y3의 종료
    //     가드와 같은 성격). 넷째 진입로가 게이트를 안 지난다는 사실 자체는 남아 있고 그 방어가
    //     오버레이 z-순서라는 **UI 우연**에 걸려 있다 — 이 라운드 범위 밖이라 산출물에 보고만 한다.
    //   오라클: tests/v049-r7-06-hold-confirm-owner.spec.ts
    const pv = staged.pendingValidation;
    if (pv && !(await finalizeRowCompletion(pv.row))) {
      notifyRowPersistFailed(pv.row, awaitingFieldRef.current);
      return;
    }
    const aw = awaitingFieldRef.current;
    const ownsHold = !!pv && !!aw && (aw.kind === 'reviewWait'
      ? aw.row === pv.row
      : aw.kind !== 'atEnd' && aw.row === pv.row && aw.colId === pv.colId);
    if (!ownsHold) {
      logCell({
        type: 'command', parsed: 'confirm', extra: 'manual_hold:flow_not_owned',
        row: pv?.row ?? alert.row, ...(pv?.colId ? { colId: pv.colId } : {}),
      });
      return;
    }
    await proceedAfterCommit(aw);
  }, []);

  /** [수정] — 팝업 해제만 수행. 해당 셀 ManualValueSheet 재오픈은 시트 open 상태를 소유한
   *  VoiceScreen이 조립한다(이 콜백 직후 alert.colId로 openManualSheet). awaiting은
   *  commitManualValue가 무장해 둔 isModify(같은 셀) 또는 reviewWait 센티넬을 그대로 둔다 —
   *  시트 재커밋(commitManualValue)이 같은 경로로 재평가한다. */
  const modifyManualAnomaly = useCallback(() => {
    const { logCell, epochRef } = depsRef.current;
    const alert = useSessionStore.getState().anomalyAlert;
    if (!alert?.manualHold) return;
    epochRef.current++;
    cancelTts();
    logCell({
      type: 'command', parsed: 'modify', extra: 'touch:manual_hold',
      row: alert.row, ...(alert.colId ? { colId: alert.colId } : {}),
    });
    // v0.34.0 리뷰 라운드2(Codex Medium) — **보류를 여기서 풀지 않는다.** 이전엔 setAnomalyAlert(null)로
    // 팝업·hold를 먼저 지웠는데, 그 뒤 사용자가 수동입력 시트를 취소하면 **이미 영속된 이상값이
    // 확인된 것처럼 남고 STT까지 재개**됐다(미확인 값이 검증 없이 확정 — 민구 결정 "터치로 해소될
    // 때까지 보류"에 어긋남). 보류는 **성공적인 재커밋으로만** 풀린다:
    //   · 새 값이 정상 → commitManualValue → advance → announceField가 알람을 지운다.
    //   · 새 값이 또 위반 → fireManualAlert(hold=1)이 팝업을 갱신해 다시 보류.
    //   · 시트 취소 → 알람·hold가 그대로 남아 팝업이 다시 보이고 게이트도 유지된다(누수 없음).
    logCell({
      type: 'trend', extra: 'trend_alert_modify_reopen:hold_kept',
      row: alert.row, ...(alert.colId ? { colId: alert.colId } : {}),
    });
  }, []);

  return {
    rejectValue,
    relistenInContext,
    evaluateTrend,
    getAnomalyAlertData,
    confirmAnomalyTouch,
    modifyAnomalyTouch,
    confirmManualAnomaly,
    modifyManualAnomaly,
  };
}
