/**
 * [ENV-12] Stage 3 서브 훅 #4 — **F-1 입력 항목 한 칸 이동**(v0.49 F-1 구획의 순수 이동).
 * 「이전」/「다음」 = 항목 이동(gotoAdjacentField). 행 이동('이전행'/'다음행')은 useRowNav 소유다.
 * 세션 컨텍스트는 여전히 `useVoiceSession`이 소유하므로 주입받는다(`useClipCapture`와 같은 계약).
 * ⚠️ `awaitingFieldRef`·`epochRef`는 ref 그대로 받는다 — 근거는 useRowNav.ts 헤더의 자진 신고와
 * 동일(다중 기록자 조정 상태 + 소스 계약 바이트 잠금). getter 전환 금지.
 */
import { useCallback, useRef } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import type { logger } from './logger';
import { cancelTts } from './speech';
import type { Column } from '../types';
import type { AwaitingField } from './useVoiceSession';
import { CONFUSION_ANSWER_FIRST_TTS } from './voicePrompts';

type LogCell = (entry: Omit<Parameters<typeof logger.log>[0], 'sessionId'>) => void;

export interface FieldNavDeps {
  logCell: LogCell;
  say: (text: string) => Promise<boolean>;
  voiceColsList: () => Column[];
  isManualHoldBlocked: (reason: string) => boolean;
  fractionWholeOf: (a: AwaitingField) => string | undefined;
  announceOrCellWait: (col: Column) => Promise<void>;
  awaitingFieldRef: { current: AwaitingField | null };
  epochRef: { current: number };
}

export function useFieldNav(deps: FieldNavDeps) {
  // 주입 deps를 ref로 받아 노출 함수 identity를 영구 고정한다(useClipCapture:57-63 계약).
  const depsRef = useRef(deps);
  depsRef.current = deps;
  // 민구 원문: *"「이전」, 「다음」은 사용자가 입력 대상 항목들을 하나씩 이동하고, 「이전행」,
  // 「다음행」은 아예 입력행 자체를 이동했으면 좋겠어."*
  // 종전엔 이 두 단어가 **행 이동**이었다(v0.33.0 백로그 A) — 08-12 결정이 행 이동을
  // '이전행'/'다음행'으로 옮기고, 짧은 두 단어를 항목 이동에 재배정했다.
  //
  // 🔴 **대상 집합 = `voiceColsList()`(input==='voice')** — 민구 확정 08-12 *"건너뛰어도 돼"*.
  //   민구 원문의 "자동입력되지 않는 항목"을 문자대로 읽으면 `input!=='auto'`(voice+**touch**)지만,
  //   `activeColIdx`는 애초에 voiceColsList()의 인덱스이고(:441) touch 컬럼은 칩 인라인 편집이
  //   소유한다(`ActiveState.tsx:334-339`). STT가 채울 수 없는 컬럼(예: '비고' text)에 값 대기를
  //   **새로 만드는 대신 건너뛴다** — 민구가 현행 구조를 택했다.
  //
  // 🔴 **경계에서 행을 넘기지 않는다.** 의미 분리가 이 기능의 목적이므로 행 이동은
  //   '이전행'/'다음행' 전용이다. 무음 금지(REVIEW-4)라 경계에서도 짧은 안내 + 현재 필드
  //   재안내를 한다 — `gotoAdjacentRow`의 '첫 행입니다' 패턴과 대칭.
  //
  // 🔴 **검토 대기(reviewWait)·끝 도달(atEnd) 스코프에서도 이동한다**(v0.49 r2 W1 — 민구 08-13
  //   FB-1·FB-4). fix49는 이 두 스코프에서 이동을 **거부**했다(리뷰 M-1+M-2·B-1). 거부의 근거는
  //   「`announceField`가 `kind:'value'`를 열어 bare 값이 완료 셀을 덮는다」였는데, **그 근거는
  //   같은 fix49의 `enterCellWait`(:1001)이 이미 해소했다** — 값이 든 셀 착지는 announceField가
  //   아니라 cellWait(낭독 + bare 값 흡수 + 덮어쓰기 없음)으로 간다. 즉 거부는 **해소된 위험에
  //   대한 잔존 방어**였고, 실기기에서 그 대가만 남았다:
  //     실측 08-13 — `field_nav_blocked:reviewWait` ×6(09:36·09:38·09:54~55). '이전행'으로 완료 행에
  //     착지한 사용자가 「다음」으로 항목을 넘기려 할 때마다 "검토 중입니다"가 나왔다. 민구 원문:
  //     *"'다음' 선언 했으나 기대했던것과 다른 반응… 기대 반응은 칩 포커스가 횡경에서 종경으로
  //     이동하고 값을 안내해줬어야 함."* / *"'이전행'(정상동작) >> '다음'(비정상 동작)"*
  //   완료 행 셀은 값이 있으므로 실질 착지는 전량 `enterCellWait`이다 — 「종경 기록값 35.1.」.
  //   **덮어쓰기 금지 계약(v0.33.0 결정 3)은 그대로 산다**: 지키는 주체가 「스코프 거부」에서
  //   「착지 상태(cellWait)」로 바뀌었을 뿐이고, 후자가 셀 단위라 더 정확하다.
  //
  // 🔴 **스코프를 떠날 때 phase를 값 입력 국면으로 되돌린다**(`jumpToRow:1623`과 같은 패턴).
  //   reviewWait/atEnd는 `phase='complete'`로 앉아 있다(정적 대기 라벨·UI-c 완료 화면). 그 상태로
  //   cellWait에 착지하면 화면은 「조사 완료」인데 귀로는 셀을 검토하는 **시각·청각 불일치**가 된다
  //   (PRINCIPLES §2). `setPhase`가 'complete' 이탈 시 `endReached`를 함께 내리고
  //   (`sessionStore:264`), 종료 수단은 `endReachedOnce`가 세션 경계까지 붙잡는다(:177) —
  //   그래서 atEnd를 떠나도 '종료'/종료 버튼은 살아 있다.
  //
  // 🔴 **경계에서는 센티넬을 건드리지 않는다.** 이동이 없으므로 reviewWait/atEnd가 **그대로 살아
  //   있고**, 그게 곧 재무장이다. 여기서 `announceOrCellWait` 재안내를 부르면 그 센티넬을
  //   cellWait으로 덮어 스코프가 조용히 증발한다(완료 행 검토 중인데 행 검토 문맥이 사라진다).
  //   ⚠️ 안내 문구를 늘리지 마라 — [TTS-WATCHDOG-1]에서 **긴 발화일수록 절단률이 단조 증가**한다.
  //
  // 🔴 **미해결 국면에서는 이동하지 않는다**(v0.49 fix49 — 리뷰 M-1+M-2, 민구 확정 08-12
  //   「거부+안내」). 알람 응답 대기(`trendConfirm`)·수정 재청취(`modify`)·소수부 재질문
  //   (`fractionWhole` 보유)은 **답을 기다리는 상태**다. 이동은 그 문맥을 조용히 파기한다:
  //   알람은 확인 없이 사라지고(미확인 이상치 우회 = `isManualHoldBlocked`가 막던 바로 그 축),
  //   재질문은 정수부 문맥을 잃는다. 어휘 재배정으로 「다음」이 *한 칸 이동*이 되어 심리적
  //   비용이 낮아진 만큼 이 문은 훨씬 자주 열린다 — 그래서 게이트를 명시한다.
  //   ⚠️ 행 이동(`prevRow`/`nextRow`)은 **이 결정의 범위 밖**이다(민구 08-12) — 종전 의미 유지.
  //
  // 🔴 **값이 든 셀에 착지하면 `announceField`가 아니라 `enterCellWait`이다**(fix49 — 리뷰 B-1
  //   blocker). 인접 인덱스를 값 유무와 무관하게 쓰므로, 이 함수는 filled 셀에 `kind:'value'`를
  //   여는 **첫 경로**였다 — 확정·저장된 값이 뒤이은 bare 숫자로 조용히 덮인다(실측 재현:
  //   35.1 → 「이전」 → "99.9" → 셀이 99.9). 착지 셀 값 유무 판정은 `announceOrCellWait`이 SSOT다.
  //
  // **값은 건드리지 않는다** — 커서만 옮긴다(setRecognized('')는 화면의 인식 중 텍스트만 비운다).
  // 오라클: tests/v049-f1-field-nav.spec.ts(①~④⑦ 이동·경계 · ⑩ 검토 대기 이동 = W1)
  //   · tests/v049-fix49-phase-guard.spec.ts(미해결 국면 거부 — W1의 범위 밖, 불변)
  //   · tests/v049-fix49-cell-guard.spec.ts(filled 셀 착지 = cellWait, B-1)
  const gotoAdjacentField = useCallback(async (delta: -1 | 1) => {
    const { logCell, say, voiceColsList, isManualHoldBlocked, fractionWholeOf, announceOrCellWait, awaitingFieldRef, epochRef } = depsRef.current;
    const sess = useSessionStore.getState();
    if (sess.phase === 'stopping') return;
    // manualHold 중 이동 거부 — gotoAdjacentRow/goNextRow와 동일 근거(미확인 이상치 우회 차단).
    if (isManualHoldBlocked(delta < 0 ? 'prev_field' : 'next_field')) return;

    const parsed = delta < 0 ? 'prevField' : 'nextField';
    const row = sess.activeRow;
    const awaiting = awaitingFieldRef.current;
    // 🔴 W1 — 검토/끝 도달 스코프 출신 이동. 커서 기준은 **`activeColIdx`(화면 활성 칩)**이지
    //   센티넬의 colId가 아니다: 민구 기대가 칩 기준으로 서술돼 있고(*"칩 포커스가 횡경에서
    //   종경으로 이동"*), reviewWait은 진입 시 `setActiveCol(0)`으로 둘을 이미 일치시킨다(:962).
    //   🔴 v0.49 r3 #2 — atEnd도 이제 **진입 시 커서를 센티넬 컬럼(마지막 음성 필드)에 주차**한다
    //   (`announceEndReached`). 종전 이 자리의 근거 *"atEnd는 커서를 옮기지 않으므로 화면 칩 =
    //   마지막 커밋 컬럼이고, 거기서 한 칸이 옳다"* 는 더 이상 사실이 아니다 — 그 「안 옮김」이
    //   두 커서를 만든 결함이었다. 결론(`activeColIdx` 기준)은 그대로다: 이제 두 축이 같은 값이라
    //   **정의상** 일치한다.
    const reviewScope = awaiting?.kind === 'reviewWait' || awaiting?.kind === 'atEnd'
      ? awaiting.kind
      : null;

    // 🔴 v0.49 fix49 — 미해결 국면 거부(위 헤더 주석). 국면을 로그에 남긴다.
    //   `trendConfirm`이 여기까지 **살아서** 도달하는 것은 `voiceFinalResolver`가 이 두 명령을
    //   `trendDemoted:false`로 통과시키기 때문이다(UI 명령과 같은 모양). 그 처리가 없으면
    //   dispatch **이전에** `clearAnomalyAlert('trend_dismissed')`가 이미 팝업을 닫아,
    //   여기서 거부해 봐야 알람은 사라진 뒤다 — 두 파일이 한 계약이다.
    const blockedPhase = awaiting?.kind === 'trendConfirm'
      ? 'trendConfirm'
      // v0.51.1 R6 — 혼동 확인 질문도 「답을 기다리는 국면」이다([PHASE-NAV-1] — 리졸버가 이동 명령을 보존
      //   통과시키고 여기서 거부한다 · 알람과 같은 두 반쪽). 값은 커밋돼 있어 데이터 유실은 없다.
      : awaiting?.kind === 'confusionConfirm'
        ? 'confusionConfirm'
      : awaiting?.kind === 'modify'
        ? 'modify'
        : (awaiting && fractionWholeOf(awaiting) != null) ? 'fractionWhole' : null;
    if (awaiting && blockedPhase) {
      cancelTts();
      epochRef.current++;
      logCell({
        type: 'command', parsed, extra: `field_nav_blocked:${blockedPhase}`,
        row, colId: awaiting.colId,
      });
      // 한 마디로 짧게 — H-2(긴 발화일수록 TTS 절단률 단조 증가). 어절 선두가 명령 단어와
      //   겹치지 않는다(detectCommand는 공백 제거 후 startsWith — "먼저…"로 시작하므로 안전).
      const msg = blockedPhase === 'trendConfirm'
        ? '먼저 알람을 확인하세요.'
        : blockedPhase === 'confusionConfirm'
          ? CONFUSION_ANSWER_FIRST_TTS
          : '먼저 값을 말씀해 주세요.';
      sess.setLastTts(msg);
      await say(msg);
      return;
    }

    const vc = voiceColsList();
    const curIdx = sess.activeColIdx;
    const target = curIdx + delta;
    cancelTts();
    epochRef.current++; // in-flight 안내 체인 무효화 (RACE-1 패턴 유지)
    // 🔴 v0.49 fix49b(max 리뷰 #6) — bump **직후** 값을 잡아 둔다. 아래 경계 분기는 이 함수에서
    //   유일하게 `await say(...)` **뒤에** 재무장하는 지점이고, `advance()`는 그런 지점마다
    //   재확인 가드를 둔다(:1077·:1098·:1120). F-1이 이 함수를 만들 때 bump만 복사하고 그
    //   재확인을 빠뜨렸다.
    const startEpoch = epochRef.current;

    if (target < 0 || target >= vc.length) {
      const msg = delta < 0 ? '첫 항목입니다.' : '마지막 항목입니다.';
      logCell({
        type: 'command', parsed,
        // 스코프 꼬리는 PRINCIPLES §4 **승인된 예외 ②**다(v0.49 r2 A14 등재) — 접두·기존 필드
      //   불변 + 스코프 출신에만 조건부 꼬리. 소비자는 `$` 앵커로 읽지 않는다.
      extra: `field_nav_edge:${delta < 0 ? 'first' : 'last'}${reviewScope ? `:${reviewScope}` : ''}`,
        row,
      });
      sess.setLastTts(msg);
      await say(msg);
      // 🔴 경계 안내 중 barge-in이 들어오면 그 명령의 핸들러가 이미 **커서와 대기 상태를 옮긴**
      //   뒤다. 여기서 낡은 `curIdx`로 재무장하면 사용자가 귀로 들은 대상("수정. 종경.")과
      //   실제 커밋 대상이 갈린다 — 무음도 오류도 아닌 **정상처럼 보이는 오귀속**이라 시트에서만
      //   뒤늦게 드러난다. fix49의 H-2 드레인이 `cancelTts()` 시점에 이 `say()`를 즉시
      //   결말지어 주므로 낡은 체인은 **명령 처리 도중에** 깨어난다(창이 더 앞당겨졌다).
      if (epochRef.current !== startEpoch) return;
      // 🔴 W1 — 검토/끝 도달 스코프는 **여기서 끝낸다.** 커서를 옮기지 않았으니 센티넬이 그대로
      //   살아 있고(= 재무장), 재안내를 부르면 그 센티넬을 cellWait으로 덮어 스코프가 증발한다.
      if (reviewScope) {
        // Y6 — 이 분기는 재안내를 부르지 않고 끝내므로 `armLanding`의 큐 해제도 타지 않는다.
        //   거절 직후 항목 이동을 시도한 경계에서 사유 큐가 화면에 남는다(위 흡수 셋과 같은 축).
        sess.setReaskReason(null);
        return;
      }
      const cur = vc[curIdx];
      // 경계에서도 **재안내 대상이 filled 셀일 수 있다**(값 넣고 「이전」으로 되돌아온 뒤 「이전」).
      if (cur) await announceOrCellWait(cur);
      return;
    }

    logCell({
      type: 'command', parsed,
      // 꼬리 계약은 위 `field_nav_edge`와 같다(PRINCIPLES §4 승인된 예외 ②).
      extra: `field_nav:${curIdx}->${target}${reviewScope ? `:${reviewScope}` : ''}`,
      row,
    });
    // 🔴 W1 — 스코프 이탈: 값 입력 국면으로 되돌린다(위 헤더 주석 · `jumpToRow:1623`과 같은 줄).
    //   `setPhase`가 `endReached`를 함께 내리고, 종료 수단은 `endReachedOnce`가 지킨다.
    if (reviewScope && sess.phase === 'complete') sess.setPhase('active');
    sess.setActiveCol(target);
    sess.setRecognized('');
    await announceOrCellWait(vc[target]);
  }, []);
  return { gotoAdjacentField };
}
