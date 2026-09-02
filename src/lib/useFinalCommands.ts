/**
 * [ENV-12] Stage 3 서브 훅 #7 — **명령 스테이지**: `handleFinal` 구획의 블록 B(명령 핸들러 5종
 * 선언) + 블록 C(경로 판정 → 명령 dispatch)를 그대로 옮긴 것이다. 세션 컨텍스트는 여전히
 * `useVoiceSession`이 소유하므로 주입받는다(선행 6개 훅과 같은 계약).
 *
 * 🔴 **`runCommandStage`의 identity는 영구 고정이다.** `handleFinal`은 STT 컨트롤러의 `onFinal`로
 * **4곳**에 배선되고(마이크 재획득 복구·`start`·`resume`·포그라운드 복귀) 조기확정 경로 1곳이 같은
 * dep 축을 문다. handleFinal의 identity가 흔들리면 그 다섯이 전부 재생성되고 `SpeechController`가
 * 재구성돼 **인식이 끊긴다**(08-12 P6-1 「STT 배선 요동」). 그래서 `useCallback([])`+`depsRef`다 —
 * 선행 5개 훅이 같은 계약을 진 이유가 정확히 이것이고(`useClipCapture.ts:59-60` 등 5개 파일 헤더),
 * 이 훅은 그중 **가장 직접** handleFinal의 dep 배열에 들어간다.
 * ⚠️ 주입 심볼 중 `logCell`·`voiceColsList`·`isRowVoiceComplete`는 본체에서 `useCallback`이
 *   **아니다**(매 렌더 재생성). 그래서 이 훅은 선행 훅들이 이동 커밋에서 거쳤던 「상단 임시
 *   destructure + 정직한 dep 배열」 중간 형태를 **거칠 수 없다** — 그것만으로 매 렌더 재생성이라
 *   배선이 요동친다. 여기서 `depsRef`는 선택이 아니라 전제다.
 *
 * 🔴 **`stop`/`pause`는 값이 아니라 ref다(TDZ 매듭).** 이 훅의 호출부는 `handleFinal` 자리에 와야
 * 하는데(`useTrendGate`·`useFieldNav` 반환값을 주입하므로) `stop`·`pause` 선언은 한참 뒤다. 주입
 * 객체 리터럴은 **렌더 시점에 평가**되므로 값으로 받으면 첫 렌더 `ReferenceError`다. 순서를 바꿔
 * 피할 수도 없다 — `start`의 dep 배열이 `handleFinal`을 담아 handleFinal이 먼저여야 한다(구조적
 * 매듭). `resumeRef` 전례를 따라 `stopRef`/`pauseRef`를 그 **같은 effect**에 합류시켰다(민구 Q4-ⓐ).
 *
 * 🔴 **모듈 헬퍼 5종은 import가 아니라 주입이다(순환).** `isModifyLike`·`fractionWholeOf`·
 * `resumeCellOf`·`resumeReviewOf`·`demoteTrendConfirm`은 `useVoiceSession.ts`의 비-export 함수라
 * 값 import하면 `useVoiceSession → useFinalCommands → useVoiceSession` 순환이다
 * ([LOGEVENTS-CYCLE-1] 유형). **type-only import만 허용**한다. leaf 모듈로 내리는 대안은 쓰지
 * 않는다 — `demoteTrendConfirm`을 옮기면 `v049-r5-z4` ③의 소스 계약 앵커가 깨진다.
 *
 * ⚠️ 규범 이탈 자진 신고 — 아래 ref는 getter가 아니라 **ref 그대로** 받는다(영구):
 *  ① `awaitingFieldRef` — 본체(블록 A·D~H)와 이 훅이 함께 읽고 쓰는 **다중 기록자** 조정 상태다.
 *     접근자 분해는 간접층만 늘고, 소스 계약(`v049-r5-z2` ③)이 `awaitingFieldRef.current =` 바이트
 *     형태 위에 서 있다(선행 3개 훅과 같은 판단).
 *  ② `epochRef` 레이스 가드 SSOT — 여기선 bump만. ③ `uiCommandSeqRef` UI 명령 단조 seq — 증가만.
 *  ④ `ctrlRef` — `isTtsMuted()` **읽기 전용**(명령 로그의 tts_was_speaking 축). 셋 다 소유자는 본체.
 */
import { useCallback, useRef } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { extractModifyValue } from './koreanNum';
import { cancelTts } from './speech';
import { extractModifyColumn, isExactCommandUtterance, isVoiceUiCommand, type VoiceUiCommandSignal } from './voiceCommands';
import { resolveFinal } from './voiceFinalResolver';
import { cellWaitPrompt, formatNameForTts, relistenPrompt, REVIEW_WAIT_COMMANDS_TTS } from './voicePrompts';
import type { Column } from '../types';
import type { logger } from './logger';
import type { PendingCommandClip } from './useClipCapture';
import type { AwaitingField, FinalCtx, ResumeCell } from './useVoiceSession';

type LogCell = (entry: Omit<Parameters<typeof logger.log>[0], 'sessionId'>) => void;

export interface FinalCommandsDeps {
  logCell: LogCell;
  say: (text: string, interrupt?: boolean) => Promise<boolean>;
  /** 🔴 TDZ 매듭 — 값이 아니라 ref다(헤더). `stop`은 `Promise<boolean>`을 반환한다. */
  stopRef: { current: (announce?: boolean) => Promise<boolean> };
  pauseRef: { current: (source?: 'voice' | 'touch') => Promise<void> };
  /** 종전부터 ref였다(handleFinal ↔ resume 순환 차단 — useVoiceSession의 선언부 주석). */
  resumeRef: { current: (source?: 'voice' | 'touch') => Promise<void> };
  advance: () => Promise<void>;
  proceedAfterCommit: (awaiting: AwaitingField | null, opts?: { echoValue?: string }) => Promise<void>;
  enterModifyMode: (
    preExtractedValue?: string,
    pendingCmd?: PendingCommandClip | null,
    reviewTarget?: { row: number; idx: number; land?: 'review' | 'cell' },
  ) => Promise<void>;
  rejectValue: (
    reason: 'low_confidence' | 'parse_failed',
    awaiting?: AwaitingField | null,
    opts?: { restartClip?: boolean; tail?: string; whole?: string },
  ) => Promise<void>;
  relistenInContext: (a: AwaitingField) => Promise<void>;
  preserveCommandClip: (row: number, colId: string) => PendingCommandClip | null;
  gotoAdjacentField: (delta: -1 | 1) => Promise<void>;
  gotoAdjacentRow: (delta: -1, source?: 'voice' | 'touch') => Promise<void>;
  goNextRow: (source?: 'voice' | 'touch') => Promise<void>;
  formatRowList: (rows: number[]) => string;
  isRowVoiceComplete: (row: number, vCols: Column[]) => boolean;
  voiceColsList: () => Column[];
  clearAnomalyAlert: (reason: string) => void;
  /** `useState` setter — React가 안정성을 보장한다. */
  setUiCommand: (signal: VoiceUiCommandSignal | null) => void;
  /** 🔴 모듈 레벨 비-export 헬퍼 5종 — 값 import는 순환이다(헤더). */
  isModifyLike: (a: AwaitingField) => boolean;
  fractionWholeOf: (a: AwaitingField) => string | undefined;
  resumeCellOf: (a: AwaitingField) => ResumeCell | undefined;
  resumeReviewOf: (a: AwaitingField) => number | undefined;
  demoteTrendConfirm: (a: Extract<AwaitingField, { kind: 'trendConfirm' }>) => AwaitingField;
  awaitingFieldRef: { current: AwaitingField | null };
  epochRef: { current: number };
  uiCommandSeqRef: { current: number };
  ctrlRef: { current: { isTtsMuted: () => boolean } | null };
}

export function useFinalCommands(deps: FinalCommandsDeps) {
  // 주입 deps를 ref로 받아 **노출 함수 identity를 영구 고정**한다(헤더 🔴 첫 항목).
  const depsRef = useRef(deps);
  depsRef.current = deps;

  /**
   * 블록 B+C — 명령 경로 전량. **반환값이 곧 「이 final을 여기서 끝냈다」 신호**다.
   *  · `true`  = 명령으로 처리됐다(본체는 즉시 return — 종전 handleFinal 안의 조기 return).
   *  · `false` = 명령이 아니거나 dispatch가 매치되지 않았다 → 본체의 **값 경로로 폴스루**.
   * `awaiting` 재대입(trendConfirm 강등)은 `ctx.awaiting`에 기록해 본체로 돌린다.
   */
  const runCommandStage = useCallback(async (ctx: FinalCtx): Promise<boolean> => {
    const {
      logCell, say, stopRef, pauseRef, resumeRef, advance, proceedAfterCommit, enterModifyMode,
      rejectValue, relistenInContext, preserveCommandClip, gotoAdjacentField, gotoAdjacentRow,
      goNextRow, formatRowList, isRowVoiceComplete, voiceColsList, clearAnomalyAlert, setUiCommand,
      isModifyLike, fractionWholeOf, resumeCellOf, resumeReviewOf, demoteTrendConfirm,
      awaitingFieldRef, epochRef, uiCommandSeqRef, ctrlRef,
    } = depsRef.current;
    // 치환 ②(주입 분해) — TDZ 매듭 때문에 stop/pause만 ref에서 꺼낸다. 종전 본문이 부르던 이름을
    // 그대로 복원해 **본문 바이트를 보존**한다.
    const stop = stopRef.current;
    const pause = pauseRef.current;
    // 치환 ①(ctx 전달) — ctx를 본문에 흩뿌리는 대신 **진입부에서 1회 분해**한다. 종전 지역변수
    // 이름을 그대로 복원하므로 아래 본문은 바이트 동일이다. `awaiting`만 가변(강등 재대입)이라
    // `let`이고, **폴스루 종단에서** ctx로 되쓴다(아래 `return false` 직전).
    const { text, confidence, cmd } = ctx;
    let awaiting = ctx.awaiting;

    // ── Stage 3-2 명령 핸들러(액션 해석 계층) — 종전 인라인 if-체인 본문의 순수 이동. ──
    // 경로 판정은 아래 resolveFinal(순수 결정표)이, 실행은 이 핸들러들이 담당한다.

    /** '종료' — skip된 빈 행이 있으면 1회 안내 후 종료(v0.5.0 요청3, 민구 결정 4와 대칭).
     *  아직 도달하지 않은 뒷 행은 '빈 행'으로 세지 않는다 — skip한 행만 대상. */
    async function cmdEnd(): Promise<void> {
      cancelTts();
      const vcEnd = voiceColsList();
      const skippedEmpty = useSessionStore.getState().skippedRows
        .filter((r) => !isRowVoiceComplete(r, vcEnd));
      if (skippedEmpty.length > 0) {
        const msg = `${formatRowList(skippedEmpty)}이 비어 있습니다. 데이터 탭에서 확인해 주세요.`;
        useSessionStore.getState().setLastTts(msg);
        await say(msg);
      }
      await stop(true);
    }

    /** '유지' — 값이 있으면 그대로 진행, 없으면 안내(v0.5.0 NAV-2 일반화, 무음 금지 [REVIEW-4]).
     *  값 커밋 경로를 안 타므로 announceField가 시작한 클립은 저장되지 않아 기존 클립이 보존된다. */
    async function cmdKeep(a: AwaitingField): Promise<void> {
      cancelTts();
      const curVal = useSessionStore.getState().getRowValues(a.row)[a.colId] ?? '';
      if (curVal !== '') {
        // 🔴 v0.49 r3 #7(claude r2 MEDIUM) — **살아 있는 복귀 예약은 '유지'가 파기하지 않는다.**
        //   가드레일 [NAV-FILLED-CELL-1]: *"정본은 `proceedAfterCommit`이며 그 kind 분기를 우회해
        //   직접 `advance()`를 부르지 마라."* 도달 경로는 알람 강등이다: 이상치 알람(trendConfirm +
        //   resumeCell)에서 '수정'이라고 답하면 `demoteTrendConfirm`이 **예약을 보존한 채** modify로
        //   내리는데, 그 셀은 아직 값을 들고 있다(재청취 중일 뿐 지워지지 않았다). 거기서 마음을
        //   바꿔 '유지'라고 하면 종전엔 곧장 `advance()`로 빠져 셀 검토 문맥이 증발했다.
        //   같은 상태에서 '확인'은 `trendResolve`(:2475)가 `proceedAfterCommit`으로 착지시킨다 —
        //   **같은 상태·같은 목적의 조작이 어휘에 따라 갈리면 안 된다**(fix49b가 세운 대칭).
        //   ⚠️ 예약이 **없는** 상태(cellWait·reviewWait·atEnd 등)의 '유지'는 종전대로 전진한다.
        //   가드레일이 열거한 네 경로는 전부 **정정**(그 셀을 고친다)이고, '유지'는 정정이 아니라
        //   「그대로 두고 넘어간다」다 — 그 의미를 바꾸는 것은 민구 확정이 필요한 별개 결정이라
        //   여기서 하지 않는다(산출물에 보고).
        if (resumeCellOf(a) != null || resumeReviewOf(a) != null) {
          await proceedAfterCommit(a);
          return;
        }
        await advance();
        return;
      }
      logCell({
        type: 'command', parsed: 'keep', extra: 'keep_no_value',
        row: a.row, colId: a.colId,
      });
      const msg = `유지할 값이 없습니다. ${formatNameForTts(a.name)} 말씀해 주세요.`;
      useSessionStore.getState().setLastTts(msg);
      await say(msg);
    }

    /** '확인'(추세 알림 밖) — 상태 변경 없이 짧은 재안내만(v0.7.0 B4, 무음 금지 REVIEW-4).
     *  trendConfirm 중의 '확인'은 resolveFinal이 trendResolve로 먼저 처리한다.
     *
     *  🔴 v0.49 r7 #4(codex r6#15) — **꼬리는 국면이 정한다.** 종전 갈래는 `cellWait`/그 외
     *   **둘**뿐이었고, 그 「그 외」에 값을 **받을 수 없는** 두 국면이 들어 있었다.
     *   `atEnd`·`reviewWait`은 resolver가 일반 값을 전부 흡수하는 **명령 전용** 상태다
     *   (voiceFinalResolver). 거기서 「{항목} 말씀해 주세요」는 **실행 불가능한 지시**다 —
     *   시킨 대로 값을 말하면 흡수 안내가 되받고, 화면을 못 보는 음성 전용 사용자는 그 사이에서
     *   반복 실패 루프에 들어간다(PRINCIPLES §2).
     *   👉 저신뢰 명령 거절이 Y5에서 이미 닫은 것과 **같은 결함의 형제**다. 그래서 새 문구를
     *      만들지 않고 **그 국면별 꼬리 계약을 그대로 재사용한다**(§2 쌍 상수 규율 — 확정표 밖
     *      문구를 늘리지 않는다):
     *     · `cellWait`   → `cellWaitPrompt`(이미 그랬다)
     *     · `reviewWait` → 흡수 안내와 같은 조작 어휘(`REVIEW_WAIT_COMMANDS_TTS` SSOT)
     *     · `atEnd`      → **사유 단독**. 그 국면의 흡수 안내(`endReachedTts`)에 조작 어휘가
     *       없기 때문이다(W2가 「종료 수단은 상시 노출」로 꼬리를 삭제했다).
     *   오라클: tests/v049-r7-04-confirm-tail.spec.ts */
    async function cmdConfirm(a: AwaitingField): Promise<void> {
      cancelTts();
      const head = '확인할 알림이 없습니다.';
      const tail = a.kind === 'cellWait'
        ? cellWaitPrompt(a.name)
        : a.kind === 'reviewWait'
          ? REVIEW_WAIT_COMMANDS_TTS
          : a.kind === 'atEnd'
            ? undefined
            : `${formatNameForTts(a.name)} 말씀해 주세요.`;
      const msg = tail ? `${head} ${tail}` : head;
      useSessionStore.getState().setLastTts(msg);
      await say(msg);
    }

    /** '수정' — 명령 발화 클립을 보존한 뒤 수정 모드 진입. 이미 수정 의미론이면 같은 셀 재질문.
     *  reviewWait/atEnd에선 bare '수정'=포인터 컬럼, "수정 <컬럼명>"=지목 컬럼. */
    async function cmdModify(a: AwaitingField, utterance: string): Promise<void> {
      cancelTts();
      // Capture the '수정'/'정정' utterance itself (spoken into the awaiting cell's active clip)
      // before enterModifyMode starts a fresh clip. The SAVE is deferred: enterModifyMode resolves
      // the modify TARGET cell, and a direct "수정 <값>" re-keys the clip to that target so its
      // pointer isn't orphaned (CLIP-CMD). Background save — never blocks the voice flow.
      // 🔴 v0.49 r5 Z6(claude #6) — **소수 문맥에서는 활성 클립을 아예 건드리지 않는다.**
      //   `preserveCommandClip`은 첫 줄에서 `stopClip()`을 부른다. 소수 재질문 중이라면 그 슬롯이
      //   바로 [CLIP-DECIMAL-FRAG-1]이 「계속 녹음하라」고 못박은 원본 전체발화 버퍼다 — 여기서
      //   끊으면 커밋 클립이 조각만 담는다. 명령 발화(`'수정'`) 자체는 그 연속 녹음 **안에**
      //   남으므로 분석에서 사라지지 않는다(별도 `:cmd<n>` 키로 갈리지 않을 뿐이다).
      //   ⚠️ 순서 주의 — 판정을 `preserveCommandClip` **앞**에서 해야 한다(그 호출이 곧 stop이다).
      const relistenWhole = isModifyLike(a) ? fractionWholeOf(a) : undefined;
      const pendingCmd = relistenWhole != null ? null : preserveCommandClip(a.row, a.colId);
      if (isModifyLike(a)) {
        // No target re-link here (we're already re-listening for the value) — save against the
        // awaiting cell so the utterance still survives for analysis.
        pendingCmd?.saveDefault();
        // 🔴 v0.49 r4 M11 — 인라인 리터럴 → §2 쌍 상수. **거절이 아니다**: '수정'은 접수됐고 앱이
        //   같은 칸을 다시 듣는다. 그래서 `armRejectCue`(비프+거절 큐)를 붙이지 않는다 — 붙이면
        //   접수된 입력을 거절됐다고 고지하고 `beep_play:kind=reject` 집계까지 오염된다.
        // 🔴 v0.49 r5 Z6 — 문구·클립 규율은 `relistenInContext`가 소유한다(그 헤더 참조).
        //   소수 문맥이 **아닐 때만** 슬롯을 재무장한다([CLIP-VAL-1]①: `preserveCommandClip`이
        //   활성 클립을 STOP했으므로 재발화가 결정적으로 녹음되지 않던 결함). B4 trendConfirm이
        //   '수정'으로 해소된 착지도 이 경로다(trendConfirm은 수정 의미론을 겸장한다).
        await relistenInContext(a);
        return;
      }
      // 상호배타 순서 주의 — extractModifyValue는 '수정' 뒤 **임의 텍스트**를 값 후보로 돌려주므로
      // ("수정 종경" → '종경'), 완료 행 대기에서는 컬럼명 매치를 먼저 확인해야 한다(숫자 발화는
      // 컬럼명과 매치될 수 없어 "수정 30.7" 직접값 경로는 그대로 성립). reviewWait/atEnd 한정 —
      // 일반 수정 의미론(직전 필드·값 추출)은 불변. 직접값 적용 후엔 검토 대기 복귀(enterModifyMode).
      let modifyVal = extractModifyValue(utterance);
      let reviewTarget: { row: number; idx: number; land?: 'review' | 'cell' } | undefined;
      if (a.kind === 'reviewWait' || a.kind === 'atEnd' || a.kind === 'cellWait') {
        const vcRw = voiceColsList();
        let idx = Math.max(0, vcRw.findIndex((c) => c.id === a.colId));
        const named = extractModifyColumn(utterance, vcRw.map((c) => c.name));
        const namedIdx = named ? vcRw.findIndex((c) => c.name === named) : -1;
        // 🔴 v0.49 fix49 — 셀 검토 대기(cellWait)의 '수정'은 **그 셀**이 타깃이다. 기본 규칙
        //   (`curIdx - 1` = 직전 컬럼)에 맡기면 엉뚱한 셀을 열고, 0번 항목에서는 `targetIdx < 0`
        //   분기로 떨어져 값을 지운 뒤 재질문하며 직접값까지 버린다(실측 — _ASK-fix49 Q2).
        //   컬럼명 지목("수정 종경")은 reviewWait과 같은 규칙을 그대로 물려받는다.
        const land = a.kind === 'cellWait' ? 'cell' as const : 'review' as const;
        if (namedIdx >= 0) {
          idx = namedIdx;
          modifyVal = null; // 컬럼명 지목 — 값 후보('종경' 등 비숫자 잔여)로 오적용 금지
          reviewTarget = { row: a.row, idx, land };
        } else if (a.kind === 'reviewWait' || a.kind === 'cellWait') {
          reviewTarget = { row: a.row, idx, land };
        }
      }
      await enterModifyMode(modifyVal || undefined, pendingCmd, reviewTarget);
    }

    /** '취소' — 인식값을 지우고 같은 필드 재질문. [CLIP-VAL-1]① (cancel sibling): '수정'→'취소'
     *  체인 뒤 슬롯이 소비돼 있으므로 재발화 녹음 슬롯을 재무장한다(startClip은 멱등). */
    async function cmdCancel(a: AwaitingField): Promise<void> {
      cancelTts();
      useSessionStore.getState().setRecognized('');
      // 셀 검토 대기에는 **취소할 인식값이 없다**(값을 받는 상태가 아니다). 녹음 슬롯 재무장도
      //   의미가 없으므로 상태를 그대로 두고 판별 문구만 다시 말한다(#9 — 위 SSOT 주석).
      if (a.kind === 'cellWait') {
        const msg = cellWaitPrompt(a.name);
        useSessionStore.getState().setLastTts(msg);
        await say(msg);
        return;
      }
      // M11 — 같은 상수. '취소'도 접수된 명령이지 거절이 아니다(위 `cmdModify`와 같은 근거).
      // 🔴 v0.49 r5 Z6 — 문구·클립 규율은 `relistenInContext`가 소유한다. 여기는
      //   `preserveCommandClip`을 거치지 않으므로 소수 문맥의 활성 슬롯이 **살아 있고**,
      //   종전 무조건 `armClipForCell`이 그 원본 전체발화 버퍼를 폐기했다([CLIP-DECIMAL-FRAG-1]).
      await relistenInContext(a);
    }

    // ── 경로 판정(순수 결정표 — voiceFinalResolver, 특성화 spec 고정) ──
    const action = resolveFinal({
      cmd, confidence,
      paused: useSessionStore.getState().phase === 'paused',
      awaitingKind: awaiting.kind,
      // v0.51.1 R5 — 정확 일치 「수정」만 floor 0.40(레지스트리 `minConfidenceExact`). 판정은 여기 한 곳.
      exact: isExactCommandUtterance(text, cmd),
    });

    // While paused, accept only 'resume' and 'end' (v0.15.0 A5); ignore everything else.
    // resume = 멈춘 입력 재개. end = 멈춘 채로 입력 종료·저장(일시정지 카드가 '재시작'/'종료' 둘 다
    // 안내하므로 음성 '종료'도 paused에서 작동해야 한다 — 민구 요청).
    if (action.act === 'pausedResume') {
      epochRef.current++;
      cancelTts();
      await resumeRef.current('voice'); // v0.20.0 Phase 5 #3 — 음성 '재시작'으로 해제
      return true;
    }
    if (action.act === 'pausedEnd') {
      epochRef.current++;
      cancelTts();
      await stop(true);
      return true;
    }
    if (action.act === 'pausedIgnore') return true;

    // v0.15.0 A6 — 스피커폰 모드 삭제. 모드로 게이트되던 TTS-중 명령차단(post-TTS 가드)을 함께
    // 제거했다(민구: 모드 ON시 barge-in 안 됨을 불편으로 지목 + Trace: 가드 1회만 발화, 제거 안전).
    // self-confirm 환각 위험은 v0.13.0 alertText "확인해주세요" 제거로 이미 구조적 해소됨. 이어폰
    // 기본 경로의 barge-in(명령 즉시 실행)은 원래대로 유지된다.

    // T-2 (low-confidence command bypassing the gate): 명령별 신뢰도 floor는 resolveFinal이
    // 레지스트리(SSOT)에서 판정한다 — 명령은 상태를 되감거나 파괴하므로 값 게이트보다 엄격한 바를
    // 넘어야 한다. confidence 0은 "미보고" 센티널로 통과(엔진별 미보고 대응). paused-resume은 위에서
    // 이미 처리됐고 의도적으로 비게이트(일시정지 탈출의 유일한 경로).
    if (action.act === 'rejectLowConfidence' && cmd) {
      logCell({
        type: 'command',
        text,
        parsed: cmd,
        confidence,
        row: awaiting.row,
        colId: awaiting.colId,
        extra: 'rejected_low_confidence',
      });
      useSessionStore.getState().setRecognized('');
      // 🔴 v0.49 r4 M11(민구 D2 08-13 · codex r3 F8) — **이건 거절이다.** r3 #6이 값 거절 여섯
      //   분기를 하나의 종단으로 모았는데, 그 인접 형제인 **저신뢰 명령 거절**만 남아 있었다:
      //   부정 비프도 화면 큐도 없고 `beep_play:kind=reject` 집계에도 안 잡힌다. 화면을 자주 못
      //   보는 사용자에게 「종료/수정/확인이 먹히지 않았다」를 알리는 채널이 통째로 없었다.
      //   ⚠️ 사유는 `low_confidence`다 — 명령이 안 들린 것이지 값이 파싱 안 된 게 아니다.
      // 🔴 v0.49 r5 Z5(codex R4-F3) — **공통 거절 종단으로 합류한다.** M11이 비프·큐는 복구했지만
      //   이 분기는 `rejectValue`를 부르지 않고 소수 문맥을 **손으로 다시 복원한 뒤** 꼬리 문구를
      //   말했다. 그래서 소수 재질문 중 저신뢰 명령이 들어오면 **화면과 귀가 갈렸다**:
      //   화면·`awaiting`은 「111 점, 소수점 아래」를 유지하고 다음 '오'도 111.5로 합성되는데,
      //   귀에는 `측정항목01 다시 말씀해 주세요.`가 들린다 — 사용자는 전체값을 말해야 하는지
      //   소수부만 말해야 하는지 알 수 없다(PRINCIPLES §2 화면·청각 동일성 위반).
      //   이제 문맥 판정은 종단이 소유하고 이 분기는 **꼬리만** 넘긴다.
      //   ⚠️ 꼬리가 값 거절과 다른 것은 계약이다 — 명령이 안 들린 것이지 값이 파싱 안 된 게
      //     아니다(#9 — 셀 검토 대기에서는 값을 요구하지 않는다: cellWaitPrompt SSOT).
      //     그리고 필드 프롬프트 전체를 재생하지 않는다(T-2가 보고한 ~10초 비용).
      //   ⚠️ 클립은 재시작하지 않는다(`restartClip` 미지정) — 명령 거절은 값 발화 슬롯의 주인이
      //     아니다. 종전 동작과 같다.
      // 🔴 v0.49 r6 Y5(claude #4 = codex R5-F3, 독립 일치) — **꼬리는 국면이 정한다.** Z5가 꼬리를
      //   인자로 뺐지만 값은 `cellWait`/그 외 **두 갈래**뿐이었고, 그 「그 외」에 값을 **받을 수
      //   없는** 두 국면이 들어 있었다. `atEnd`·`reviewWait`은 resolver가 일반 값을 전부 흡수하는
      //   **명령 전용** 상태다(voiceFinalResolver:79-83). 거기서 「{항목} 다시 말씀해 주세요」는
      //   실행 불가능한 지시다 — 실측(codex): 끝 도달에서 저신뢰 '종료' → 마지막 TTS가
      //   「횡경 다시 말씀해 주세요.」. 시킨 대로 값을 말하면 흡수 안내가 되받는다. 화면을 못 보는
      //   음성 전용 사용자는 그 사이에서 반복 실패 루프에 들어간다(cellWaitPrompt가 같은 이유로
      //   먼저 닫은 형태 — 그 헤더).
      //   · `reviewWait` → 흡수 안내와 **같은 조작 어휘**(`REVIEW_WAIT_COMMANDS_TTS` SSOT).
      //   · `atEnd` → **사유 단독**. 그 국면의 흡수 안내(`endReachedTts`)에는 조작 어휘가 없다 —
      //     W2가 「종료 수단은 상시 노출이라 매번 되풀이하지 않는다」로 꼬리를 삭제했기 때문이다.
      //     없는 어휘를 여기서 새로 만들면 확정표 밖 문구가 하나 더 생긴다(§2 쌍 상수 규율).
      await rejectValue('low_confidence', awaiting, {
        tail: awaiting.kind === 'cellWait'
          ? cellWaitPrompt(awaiting.name)
          : awaiting.kind === 'reviewWait'
            ? REVIEW_WAIT_COMMANDS_TTS
            : awaiting.kind === 'atEnd'
              ? undefined
              : relistenPrompt(awaiting.name),
      });
      return true;
    }

    // Commands interrupt TTS immediately — bump epoch to invalidate in-flight advance/skip
    if (cmd) {
      epochRef.current++;
      logCell({
        type: 'command',
        text,
        parsed: cmd,
        confidence,
        row: awaiting.row,
        colId: awaiting.colId,
        extra: ctrlRef.current?.isTtsMuted() ? 'tts_was_speaking' : 'tts_silent',
      });
    }

    // ── v0.7.0 B4: 추세 확인 모드 해소 — 알림 TTS 직후의 첫 응답 ──
    // 커밋된 값은 이미 저장돼 있다(알림 ≠ 롤백). '확인'/'유지'는 그대로 확정·진행, 새 값 발화는
    // 아래 값 경로로 폴스루해 기존 수정 의미론으로 재커밋(재위반 시 재알림), 타 명령은 알림만
    // 해제하고 정상 dispatch된다.
    if (action.act === 'trendResolve' && cmd && awaiting.kind === 'trendConfirm') {
      cancelTts();
      clearAnomalyAlert('trend_resolve'); // 팝업 해제
      logCell({
        type: 'trend', extra: 'trend_alert_confirmed', parsed: cmd,
        row: awaiting.row, colId: awaiting.colId,
        ...(awaiting.previousValue != null ? { previousValue: awaiting.previousValue } : {}),
      });
      awaitingFieldRef.current = null;
      // P1 — 검토 대기 출신 직접 수정이 알람을 경유한 경우의 착지(resumeReviewOf 주석 참조).
      // 🔴 v0.49 r2 A2 — 착지 판정을 `proceedAfterCommit`에 넘긴다. 종전엔 여기서 행 예약만 읽고
      //   직접 `advance()`를 불러, **셀 검토 대기 출신 알람**이 '확인' 한 마디로 검토 문맥을
      //   잃었다(codex F1 = 합집합 C3 — 가드레일 [NAV-FILLED-CELL-1] 위반).
      await proceedAfterCommit(awaiting);
      return true;
    }
    if (action.act === 'dispatch' && action.trendDemoted && awaiting.kind === 'trendConfirm') {
      clearAnomalyAlert('trend_dismissed'); // 타 명령으로 해제 → 팝업 닫음
      logCell({
        type: 'trend', extra: `trend_alert_dismissed:${cmd}`,
        row: awaiting.row, colId: awaiting.colId,
      });
      // 알림만 해제 — 수정 의미론(종전 isModify 겸장)으로 강등 후 아래 정상 명령 dispatch로 폴스루.
      awaiting = demoteTrendConfirm(awaiting);
      awaitingFieldRef.current = awaiting;
    }
    // action 'value'의 trendCorrection(새 값 폴스루)은 값 경로가 처리 — 커밋 지점에서
    // trend_alert_corrected 기록.

    if (action.act === 'dispatch') {
      // v0.38.0 리뷰#1 — UI 전용 명령은 목록을 여기 복붙하지 않고 voiceCommands의 SSOT로 판정한다
      // (같은 목록이 resolveFinal의 이상치 분기에도 필요하다 — 복붙된 판단이 이번 회차 결함의 뿌리).
      if (isVoiceUiCommand(action.cmd)) {
        // v0.46.0 WP-F — `screenOff`만 신호가 아니라 **전역 상태**로 간다. 나머지 UI 명령은
        //   특정 컴포넌트(조절판·도움말)를 여는 것이라 seq 신호가 맞지만, 검은 화면은 앱 최상위
        //   오버레이라 소비자가 없다. 🔑 그래도 `VOICE_UI_COMMAND_IDS`에 남겨두는 이유는 그 목록이
        //   「값·행·세션을 건드리지 않는가」의 판정이고(resolveFinal의 이상치 분기가 그걸 읽는다),
        //   dispatch 방식과는 다른 축이기 때문이다.
        if (action.cmd === 'screenOff') {
          useSessionStore.getState().setBlackout(true);
          logCell({ type: 'command', parsed: 'screen_off', extra: 'src:voice' });
          return true;
        }
        setUiCommand({ id: action.cmd, seq: ++uiCommandSeqRef.current });
        return true;
      }
      switch (action.cmd) {
        case 'end': await cmdEnd(); return true;
        case 'pause':
          cancelTts();
          await pause('voice'); // v0.20.0 Phase 5 #3 — 음성 명령으로 일시정지
          return true;
        case 'resume':
          cancelTts();
          await resumeRef.current('voice'); // v0.20.0 Phase 5 #3 — 음성 명령으로 재개
          return true;
        // 🔴 v0.49 F-1(민구 결정 08-12) — 항목 이동. 짧은 두 단어가 여기로 재배정됐다.
        case 'prevField':
          await gotoAdjacentField(-1);
          return true;
        case 'nextField':
          await gotoAdjacentField(1);
          return true;
        case 'prevRow':
          // v0.33.0 백로그 A(민구 결정 1): 음성 **'이전행'**(v0.49 F-1 전에는 '이전') = ◀ 버튼과
          // 동일한 단순 행 이동(재입력 모드 폐지). **행 이동 로직 자체는 08-12에도 바뀌지 않았다 —
          // 어휘만 옮겨졌다.** 완료 행 착지는 jumpToRow가 "값 읽어주기 + 검토 대기"로 처리한다(결정 3).
          await gotoAdjacentRow(-1, 'voice');
          return true;
        case 'nextRow':
          // v0.44.0 §C8 F13: **'다음행'**(v0.49 F-1 전에는 '다음')은 '이전행'과 대칭인 항상 +1 이동(goNextRow) —
          // 미완료 행은 skip(placeholder) 처리, returnRow 미등록, 마지막 행에서 멈춤
          // (NAV-1 무한루프 방지의 대체 계약 — goNextRow 본문 주석 참조).
          await goNextRow('voice');
          return true;
        case 'keep': await cmdKeep(awaiting); return true;
        case 'confirm': await cmdConfirm(awaiting); return true;
        case 'modify': await cmdModify(awaiting, text); return true;
        case 'cancel': await cmdCancel(awaiting); return true;
      }
    }

    // 명령으로 끝나지 않았다 = 값 경로로 폴스루(종전 dispatch switch의 폴스루와 같은 의미).
    // 🔴 되받기 — 강등(trendConfirm → modify)이 일어났으면 그 값을 값 경로가 봐야 한다. 구획을
    //   가르기 전에는 같은 함수의 지역변수라 자동이었다. **오늘 이 경로로 강등값이 새는 일은
    //   없다**(trendDemoted는 cmd가 있을 때만 서고 dispatch가 모든 non-null cmd를 return시킨다).
    //   그래도 되쓴다 — 등가성을 「dispatch switch 목록이 완전하다」는 **우연**에 맡기지 않는다.
    ctx.awaiting = awaiting;
    return false;
  }, []);

  return { runCommandStage };
}
