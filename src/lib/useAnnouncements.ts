/**
 * [ENV-12] Stage 3 서브 훅 #6 — **안내(announcements)**(구획 하나의 순수 이동):
 * 행 전환·행 완료 낭독(announceRowDiff·announceRowComplete) + 복귀·재시작 브리핑
 * (buildReturnBriefing) + 클립 슬롯 무장([CLIP-VAL-1]① armClipForCell) + 착지 리셋 소유자
 * (v0.49 r5 Z2 armLanding) + 항목 안내(announceField).
 * 세션 컨텍스트는 여전히 `useVoiceSession`이 소유하므로 주입받는다(`useClipCapture`와 같은 계약).
 *
 * 🔴 `armClipForCell`이 이 훅에 있는 이유 — **안내와 클립 슬롯 무장은 한 몸**이다(그 헤더
 * [CLIP-VAL-1]①: arm은 동반 TTS **이전**에 일어나야 barge-in 발화가 클립에 담긴다). 클립 장부를
 * 소유하는 `useClipCapture`와는 별개 축이라 그쪽으로 합치지 않는다 — 이 훅은 `useClipCapture`를
 * 직접 부르지 않고, 두 훅의 접점은 본체가 반환값을 배선하는 형태 그대로다.
 *
 * ⚠️ 규범 이탈 자진 신고 — 아래 ref들은 getter가 아니라 **ref 그대로** 받는다(영구):
 *  ① `awaitingFieldRef` — 본체(handleFinal·advance·복귀 경로)와 이 훅이 함께 읽고 쓰는 다중
 *     기록자 조정 상태라 접근자 분해는 간접층만 늘린다(useRowNav.ts·useTrendGate.ts와 같은 판단).
 *     소스 계약 스펙(r5-z2 ③)이 `awaitingFieldRef.current =` 바이트 형태 위에 서 있다.
 *  ② 클립 슬롯 4종(`clipStartRowRef`·`clipStartColIdRef`·`activeClipRef`·`uiBlockedClipArmRef`)
 *     — `armClipForCell`이 **쓰고** 본체의 커밋 종단·재획득 복구·suspend 해제가 읽는 공유 장부다.
 *     한쪽만 옮기면 무장 좌표가 두 벌이 된다(clip_empty 재개방).
 *  ③ `uiSuspendRef` — 이 구획에선 읽기 전용이지만 소유자는 본체(모달 suspend 래치)다.
 */
import { useCallback, useRef } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { buildCyclingValues } from './autoValue';
import type { AudioRecorder } from './audioRecorder';
import { playBeep } from './beep';
import { clipArmBlocked } from './logEvents';
import type { logger } from './logger';
import { useModifyPhase } from './modifyPhase';
import { formatForTts } from './speech';
import { formatNameForTts } from './voicePrompts';
import type { Column } from '../types';
import type { AwaitingField, ResumeCell } from './useVoiceSession';

type LogCell = (entry: Omit<Parameters<typeof logger.log>[0], 'sessionId'>) => void;

export interface AnnouncementsDeps {
  logCell: LogCell;
  /** 두 번째 인자(interrupt)를 쓴다 — 안내는 전부 `false`(앞선 발화를 자르지 않는다). */
  say: (text: string, interrupt?: boolean) => Promise<boolean>;
  clearAnomalyAlert: (reason: string) => void;
  getSessionColumns: () => Column[];
  voiceColsList: () => Column[];
  getRecorder: () => AudioRecorder | null;
  /** 모달 suspend 래치(읽기 전용) — 소유자는 본체다(헤더 ③). */
  uiSuspendRef: { current: { hadController: boolean; reasons: Set<string> } };
  /** suspend·레코더 부재로 보류된 무장 좌표 — 재획득 완료·suspend 해제가 소비한다(헤더 ②). */
  uiBlockedClipArmRef: { current: { row: number; colId: string } | null };
  clipStartRowRef: { current: number };
  clipStartColIdRef: { current: string };
  activeClipRef: { current: { row: number; colId: string } | null };
  awaitingFieldRef: { current: AwaitingField | null };
}

export function useAnnouncements(deps: AnnouncementsDeps) {
  // 주입 deps를 ref로 받아 **노출 함수 identity를 영구 고정**한다(useClipCapture:57-63 계약 —
  // 반환 함수들이 본체 handleFinal 의존성에 들어가므로 identity가 흔들리면 STT 배선이 요동친다).
  const depsRef = useRef(deps);
  depsRef.current = deps;

  /** Announce only auto+ttsAnnounce columns whose value differs between rows. */
  const announceRowDiff = useCallback(
    async (fromRow: number | null, toRow: number) => {
      const { getSessionColumns, say } = depsRef.current;
      const cols = getSessionColumns();
      const toAuto = buildCyclingValues(cols, toRow);
      const fromAuto = fromRow != null ? buildCyclingValues(cols, fromRow) : null;
      const parts: string[] = [];
      for (const c of cols) {
        if (c.input !== 'auto' || !c.ttsAnnounce) continue;
        const tv = toAuto[c.id] ?? '';
        const fv = fromAuto?.[c.id] ?? '';
        if (!tv) continue;
        if (fromAuto === null || fv !== tv) parts.push(`${formatNameForTts(c.name)} ${tv}`);
      }
      if (parts.length) await say(parts.join(', ') + '.', false);
    },
    [],
  );

  /** Announce row completion: only auto+ttsAnnounce columns that differ from the previous row. */
  const announceRowComplete = useCallback(
    async (row: number) => {
      const { getSessionColumns, say } = depsRef.current;
      const cols = getSessionColumns();
      const curAuto = buildCyclingValues(cols, row);
      const prevAuto = row > 1 ? buildCyclingValues(cols, row - 1) : null;
      const parts: string[] = [];
      for (const c of cols) {
        if (c.input !== 'auto' || !c.ttsAnnounce) continue;
        const cv = curAuto[c.id] ?? '';
        if (!cv) continue;
        if (prevAuto === null || (prevAuto[c.id] ?? '') !== cv) {
          parts.push(`${formatNameForTts(c.name)} ${cv}`);
        }
      }
      if (parts.length) await say(parts.join(', ') + ' 완료.', false);
      else await say('완료.', false);
    },
    [],
  );

  /** v0.45.0 WP-3 (F14, Q5 민구 확정) — 복귀·재시작 브리핑 텍스트.
   *  "입력행의 첫 컬럼부터 지금 입력해야 되는 항목까지"(민구 원문)를 **음성안내(ttsAnnounce)가
   *  켜진 항목만** 항목+값 순서로 읽는다: "나무 3, 과실 2, 횡경 45.1. 다음, 횡경."
   *
   *  - 표(테이블) 컬럼 순서 그대로, **현재 항목에서 멈춘다** — 그 뒤는 "다음" 꼬리가 담당.
   *  - `includeNextName` true(복귀 — 뒤에 announceField가 없다)면 "다음, <항목명>."으로 끝나고,
   *    false(재시작 — 곧바로 announceField가 "<항목명>."을 잇는다)면 "다음."으로 끝난다.
   *  - active 밖(paused·complete)에서는 null — 일시정지 복귀 브리핑은 '재시작' 시점이 담당한다
   *    (Q4-답 민구 확정 08-05: 이중 낭독 방지. PausedCard 상태 안내와의 충돌도 피한다).
   *  - 읽을 것이 없으면 null — 억지 발화로 STT 무장을 지연시키지 않는다(barge-in OFF에선
   *    낭독 길이만큼 인식이 죽는 창이다, speech.ts half-duplex 계약). */
  const buildReturnBriefing = useCallback((includeNextName: boolean): string | null => {
    const { uiSuspendRef, getSessionColumns, voiceColsList } = depsRef.current;
    const sess = useSessionStore.getState();
    if (sess.phase !== 'active') return null;
    // 리뷰 C3·C5·C11 — 모달 suspend 중(STT 정지)·알람 응답 대기 중에는 브리핑을 내지 않는다.
    // "다음, X"는 '지금 말하면 입력된다'는 신호인데 그 상태에선 거짓이거나(모달 — 발화 전량
    // 미커밋) 알람 응답 흐름과 충돌한다. 모든 발화 지점(onStart·kept 복귀·재시작)의 단일 관문.
    if (uiSuspendRef.current.reasons.size > 0) return null;
    if (sess.anomalyAlert) return null;
    const cols = getSessionColumns();
    if (cols.length === 0) return null;
    const row = sess.activeRow;
    const auto = buildCyclingValues(cols, row);
    const values = sess.getRowValues(row);
    const cur = voiceColsList()[sess.activeColIdx] ?? null;
    const parts: string[] = [];
    for (const c of cols) {
      if (cur && c.id === cur.id) break; // 현재 항목부터는 꼬리("다음, …")가 담당
      if (!c.ttsAnnounce) continue;
      const v = c.input === 'auto' ? auto[c.id] ?? '' : values[c.id] ?? '';
      if (v !== '') parts.push(`${formatNameForTts(c.name)} ${c.input === 'auto' ? v : formatForTts(v)}`);
    }
    const tail = includeNextName ? (cur ? `다음, ${formatNameForTts(cur.name)}.` : null) : '다음.';
    if (parts.length === 0) return includeNextName ? tail : null;
    return tail ? `${parts.join(', ')}. ${tail}` : `${parts.join(', ')}.`;
  }, []);

  /** [CLIP-VAL-1]① — start (or restart) the recording slot for a cell, with the full
   *  announceField choreography: mark the start refs, start the clip, and register it as the
   *  active clip. Called BEFORE the accompanying TTS so a barge-in utterance lands in the clip.
   *  Shared by announceField, the B4 trend-alert prompt, and the modify/cancel re-prompts —
   *  the latter two used to re-ask via say() WITHOUT restarting the slot, so the re-spoken
   *  value was deterministically never recorded (06-11 v0.6.0 row8: "155.5" → clip_empty). */
  const armClipForCell = useCallback((row: number, colId: string) => {
    const {
      uiSuspendRef, uiBlockedClipArmRef, logCell, getRecorder,
      clipStartRowRef, clipStartColIdRef, activeClipRef,
    } = depsRef.current;
    const suspendReasons = uiSuspendRef.current.reasons;
    if (suspendReasons.size > 0) {
      uiBlockedClipArmRef.current = { row, colId };
      logCell({
        type: 'clip',
        extra: clipArmBlocked({
          reason: [...suspendReasons].join('+') || 'unknown',
          row,
          col: colId,
        }),
        row,
        colId,
      });
      return;
    }
    // 리뷰 C6 — 레코더가 없으면(임계 정지 직후 복귀·재획득 init 대기 창) activeClipRef를 세우지
    // 않는다. 세우면 커밋 시 stopClip이 "시작한 적 없는" 새 레코더에 걸려 clip_empty가 난다.
    // 좌표는 보류 슬롯에 남겨 재획득 완료(resumeFromBackground init.then)가 소비한다.
    // ⚠️ getter 전환(stage A 규범)으로 `recorderRef.current` 2회 참조가 지역 `rec` 1회 취득으로
    //   바뀌었다 — 가드와 startClip 사이에 레코더가 갈리지 않게 **같은 인스턴스**를 쓴다.
    const rec = getRecorder();
    if (!rec) {
      uiBlockedClipArmRef.current = { row, colId };
      logCell({ type: 'clip', extra: clipArmBlocked({ reason: 'no_recorder', row, col: colId }), row, colId });
      return;
    }
    clipStartRowRef.current = row;
    clipStartColIdRef.current = colId;
    rec.startClip();
    activeClipRef.current = { row, colId };
  }, []);

  /**
   * 🔴 v0.49 r5 Z2 — **착지 국면 전이의 단일 지점.**
   *
   * 「착지」 = 커서가 어딘가에 서서 다음 입력/명령을 기다리기 시작하는 순간이다. 이 앱에는 그런
   * 지점이 넷 있고(`announceField` · `enterCellWait` · `enterReviewWait` · `announceEndReached`),
   * 넷 다 같은 리셋 묶음을 수행한다: **알람 해제 · 거절 큐 해제 · 수정 표식 해제 · phase 전이.**
   * 종전엔 그 네 줄이 네 곳에 **손으로 복사**돼 있었고, 이번 라운드 회귀 3건이 전부 그 사본의
   * 누락이었다:
   *   · M4  — `announceField`만 `setReaskReason(null)`이 빠져, 거절당한 셀을 떠나도 큐가 남았다.
   *   · M8① — `announceField`가 phase를 안 열어, 행 경계 착지에서 거절 큐가 `completing` 게이트에
   *            먹혀 **비프만 남았다**.
   *   · M8② — `enterCellWait`도 같은 누락(헤더는 "phase는 active"라고 **선언만** 하고 있었다).
   * 사본을 늘리는 대신 소유자를 하나 만든다 — 다음 착지가 생겨도 빠뜨릴 자리가 없다.
   *
   * 🔴 **평탄화하지 않는다.** 네 착지는 실제로 다르고, 그 차이가 계약이다 — 그래서 전부 인자다:
   *   · `phase`  값을 여는 착지는 `'active'`, 검토/끝 도달은 `'complete'`.
   *   · `reason` `clearAnomalyAlert` 사유는 **로그에 실린다**(PRINCIPLES §4). 하드코딩하면 네
   *              착지가 로그에서 한 덩어리가 된다.
   *   · `modifyIndicator` `announceField`의 수정 재안내만 값이 있고 나머지는 전부 해제다.
   *   · `decimalReason` 🔴 **소수부 재질문 문맥은 지우는 게 아니라 다시 그린다.** 그건 지나간
   *              거절이 아니라 지금 살아 있는 대기 상태고(`awaiting`이 정수부를 들고 있다),
   *              화면만 비우면 M3가 닫은 「무고지 합성」이 재개 경로로 되살아난다(데이터 오염).
   *              큐 해제를 무조건으로 평탄화하면 M4 오라클은 통과하면서 이 축이 새로 열린다.
   *
   * 🔴 **가드 — 종료·일시정지는 착지를 이긴다**(codex R4-F2 · claude #2). fixr4의 M8이 phase를
   * **무조건** 쓰게 만들면서, 이전엔 잠겨 있던 두 국면이 뒤늦은 continuation에 덮이게 됐다:
   *   · `stopping`: `stop()`은 첫 await 전에 phase를 잠그고 TTS를 cancel한다. 그 cancel이 앞선
   *     `await say(...)`를 settle시키면 **낡은 행 이동 continuation이 재개된다.** v0.35의 「종료
   *     teardown 전체를 단일 비대화형 phase로 잠근다」 상호배타 계약이 거기서 깨졌다.
   *     ⚠️ **epoch 재확인으로는 못 닫는다** — `stop()`은 epoch를 올리지 않는다(:4179~ 확인).
   *     그래서 **착지 전체를 거절**한다(phase만 막으면 awaiting·클립이 recorder dispose와 경쟁한다).
   *     안전한 이유: 대화형 진입점은 전부 이미 `phase === 'stopping'`을 자기 앞에서 거른다
   *     (`goNextRow` · `gotoAdjacentRow` · `gotoAdjacentField` · `pause` · `resume`) — 여기 닿는
   *     것은 정의상 낡은 continuation뿐이다.
   *   · `paused`: **국면 전이만** 보류하고 문맥 재무장(awaiting·수정 표식)은 그대로 진행한다.
   *     착지 전체를 거절하면 `awaiting`이 null인 채로 남아, `resume`의 폴스루가
   *     `announceField(cur)`로 떨어져 **값 있는 셀에 `kind:'value'`가 다시 열린다**(_ASK-fix49 Q5의
   *     선행 파손을 새 경로로 재개방 — 실측 확인). 일시정지 해제는 `resume()`만의 소관이다.
   *
   * 🔴 **`endReached`는 phase와 한 쌍이다.** 가드를 phase 한 줄에만 걸면 짝의 반쪽이 그대로 나가
   * R4-F2와 **같은 형태**(쌍 중 한쪽만 배선)의 결함이 남는다. `setPhase`가 'complete' 이탈 시
   * `endReached`를 함께 내리므로(sessionStore 계약) 순서는 phase → endReached로 고정한다.
   *
   * @returns 착지를 계속해도 되면 `true`. `false`면 **호출부는 즉시 return한다** — awaiting 재무장·
   *          클립 arm·TTS 전부 하지 않는다.
   * 오라클: tests/v049-r5-z2-landing-guard.spec.ts
   */
  const armLanding = useCallback((opts: {
    /** `clearAnomalyAlert` 사유 = 로그 축. 착지마다 다르다. */
    reason: string;
    /** 값을 여는 착지는 'active', 검토/끝 도달 착지는 'complete'. */
    phase: 'active' | 'complete';
    /** 'complete' 착지만 명시한다(끝 도달=true · 행 검토=false). 미지정이면 setPhase가 정한다. */
    endReached?: boolean;
    /** 수정 재안내만 값이 있다. 미지정 = 해제. */
    modifyIndicator?: { name: string; colId: string } | null;
    /** 살아 있는 소수부 재질문의 정수부. 있으면 큐를 **다시 그린다**. */
    decimalReason?: string | null;
  }): boolean => {
    const { logCell, clearAnomalyAlert } = depsRef.current;
    const sess = useSessionStore.getState();
    if (sess.phase === 'stopping') {
      // 새 이름으로 계측한다(PRINCIPLES §4) — 기존 착지 이벤트에 얹으면 「착지했다」와
      //   「착지를 거절했다」가 로그에서 같은 줄이 된다.
      logCell({ type: 'session', extra: `landing_refused:stopping:${opts.reason}` });
      return false;
    }
    clearAnomalyAlert(opts.reason);
    // 🔴 v0.49 r5 Z9(claude #10) — 소수 문맥을 **다시 그릴 때 사유를 잃지 않는다.**
    //   `setReaskReason(null)`이 사유와 정수부를 함께 지우므로(store 계약) 재기록 시 사유를
    //   안 넘기면 기본값 `'parse_failed'`로 굳는다 — 저신뢰로 거절된 소수 재질문이 재개
    //   (일시정지→재시작)만 거치면 화면 `data-reason`이 **사실과 다른 사유**로 바뀐다.
    //   M3가 `setDecimalReason(whole, reason)` 인자를 만든 이유가 그것인데 이 재기록만 안 쓰고
    //   있었다. 문구는 어느 사유든 소수 프롬프트로 같으므로(확정표 #3) 바뀌는 것은 사유뿐이다.
    const carriedReason = sess.reaskReason;
    sess.setReaskReason(null);
    if (opts.decimalReason != null) {
      sess.setDecimalReason(opts.decimalReason, carriedReason ?? undefined);
    }
    sess.setModifyIndicator(opts.modifyIndicator ?? null);
    // v0.47.0 W2(FB-C) — committed=false는 「재청취 국면 시작(amber)」 선언이다. 일반 안내(국면
    //   종료)도 같은 값이라 네 착지 전부 무조건 내린다.
    useModifyPhase.getState().setCommitted(false);
    if (sess.phase === 'paused') {
      logCell({ type: 'session', extra: `landing_phase_held:paused:${opts.reason}` });
      return true;
    }
    sess.setPhase(opts.phase);
    if (opts.endReached !== undefined) sess.setEndReached(opts.endReached);
    return true;
  }, []);

  const announceField = useCallback(
    // v0.47.0 C-FIX1b — opts.fractionWhole: 재개(resume) 재안내가 소수부 재질문 문맥(정수부)을
    // 잃지 않고 재구성하기 위한 전달로. 값 추측 금지 계약(:113-120)의 합성 문맥이 여기서 끊기면
    // 재개 후 조각 발화("5")가 전체값으로 오커밋된다(데이터 오염).
    // v0.49 r2 A2 — opts.resumeCell: bare '수정'이 **셀 검토 대기(cellWait) 출신**임을 재기록
    // 대기 상태에 실어 보내는 전달로. 이게 없으면 재발화 커밋 종단이 출신을 알 수 없어
    // `advance()`로 빠진다([NAV-FILLED-CELL-1] 불변식 위반 — resumeCellOf 주석).
    async (col: Column, opts?: { isModify?: boolean; previousValue?: string; fractionWhole?: string; resumeCell?: ResumeCell }) => {
      const { awaitingFieldRef, say } = depsRef.current;
      const row = useSessionStore.getState().activeRow;
      // 🔴 v0.49 r5 Z2 — 착지 리셋 4종(알람 해제 · 거절 큐 · 수정 표식 · phase)은 `armLanding`이
      //   소유한다. 종전엔 이 자리에 그 넷이 손으로 적혀 있었고, 형제 착지 셋과의 **사본 차이**가
      //   이번 라운드 회귀 3건(M4 · M8 두 건)이었다 — 근거·차이 축·가드는 그 헤더 참조.
      //   여기 남은 것은 **이 착지 고유의 것**뿐이다: 수정 표식의 값, 소수부 문맥, 진입 단음.
      //   ⚠️ `false`면 즉시 return — 종료 중(stopping) 낡은 continuation은 awaiting도 클립도
      //     TTS도 열지 않는다(R4-F2).
      if (!armLanding({
        // v0.9.0 — 다음 필드로 진입하면 이전 이상치 알람 팝업은 해제(해소된 것으로 간주).
        reason: 'announce_field',
        phase: 'active',
        // v0.12.0 AREA2 V4 — 수정 재안내면 '수정 값' 인디케이터를 켜고, 일반 안내면 해제한다.
        modifyIndicator: opts?.isModify ? { name: col.name, colId: col.id } : null,
        // 🔴 M3/M4 — 살아 있는 소수부 재질문은 **지우는 게 아니라 다시 그린다**(armLanding 헤더).
        decimalReason: opts?.fractionWhole ?? null,
      })) return;
      // v0.47.0 W2(FB-C, 민구 08-08) — 수정 **진입** = 중립 단음 + amber(§C4 의미 보존).
      //   종전엔 이 단음이 성공 커밋 시점(:handleFinal)에 났다 — W2가 성공을 화음+green으로
      //   재정의하며 중립 단음은 "모드 전환" 본래 의미대로 진입으로 옮겼다.
      if (opts?.isModify) playBeep('modify');
      awaitingFieldRef.current = opts?.isModify
        ? {
          kind: 'modify', row, colId: col.id, name: col.name,
          previousValue: opts?.previousValue,
          ...(opts?.fractionWhole != null ? { fractionWhole: opts.fractionWhole } : {}),
          ...(opts?.resumeCell != null ? { resumeCell: opts.resumeCell } : {}),
        }
        : {
          kind: 'value', row, colId: col.id, name: col.name,
          ...(opts?.fractionWhole != null ? { fractionWhole: opts.fractionWhole } : {}),
        };
      // v0.4.4 barge-in 클립 복구: 클립을 announce TTS '이전에' 시작한다. 레코더(audioRecorder)는
      // TTS mute와 무관하게 영구 mic 스트림에서 연속 캡처하므로, 안내 음성이 나가는 동안 사용자가
      // 값을 말하면(barge-in) 그 발화가 클립에 담긴다. 이전엔 announce 후 시작이라 barge-in 구간이
      // 비어 데이터탭 재생 시 무음이었음. (announce 후 시작을 강제하던 redo-inline 가드[MEDIUM-4]는
      // redo 명령 제거로 사라짐.) 클립 앞에 새는 announce TTS는 mic AEC가 억제하고, 앞 무음은
      // audioTrim이 정리한다.
      armClipForCell(row, col.id);
      // 🔴 항목명 TTS는 괄호와 그 안의 내용을 읽지 않는다(민구 2026-09-01 — `formatNameForTts` 헤더).
      //   `hint`(=`lastTts`)도 같은 축약본을 쓴다: `lastTts`는 **귀로 나간 안내의 상태 미러**이지
      //   화면 표면이 아니다(렌더하는 컴포넌트가 없다 — 전 소비자 grep 확인). 여기만 원문을 쓰면
      //   같은 문장이 두 표기로 갈리고, 형제 착지(`useRowLanding`)는 발화문과 `lastTts`가 **같은
      //   지역 변수**라 갈라놓으려면 리터럴을 복제해야 한다([PAST-2] 사본 금지).
      //   ⚠️ 화면에 항목명을 그리는 표면(수정 표식 `modifyIndicator`·칩·표)은 **원문 그대로**다.
      const spokenName = formatNameForTts(col.name);
      const hint = opts?.isModify
        ? `수정. ${spokenName} 다시 말씀해 주세요.`
        : `${spokenName} 말씀해 주세요.`;
      useSessionStore.getState().setLastTts(hint);
      await say(opts?.isModify ? `수정. ${spokenName}.` : `${spokenName}.`, false);
    },
    // 동일-훅 상호 참조(armLanding·armClipForCell)는 `[]`-고정 const의 클로저 캡처라 identity가
    // 불변이다 — deps 배열에 넣지 않아도 낡은 참조가 생기지 않는다(useTrendGate와 같은 판단).
    [],
  );

  return {
    announceRowDiff,
    announceRowComplete,
    buildReturnBriefing,
    armClipForCell,
    armLanding,
    announceField,
  };
}
