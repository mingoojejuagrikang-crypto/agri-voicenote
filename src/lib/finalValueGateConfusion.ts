/**
 * v0.51.1 R6 — 값 게이트의 **혼동 확인 질문 답변 분기**(`useFinalValueGate` 블록 E 앞머리에서 호출).
 * 게이트 파일의 500줄 게이트(GL-006 §5) 때문에 분리했고, 계약은 게이트 헤더 그대로다 — 반환값이 곧 신호:
 *  · `'handled'` = 이 final을 여기서 끝냈다(「첫째」 진행 · 「아니오」 재청취) → 게이트는 `true`를 돌려준다.
 *  · `'commit'`  = 후보를 골랐다(「둘째/셋째」) → `ctx.parsed`를 채웠으니 게이트는 `false`(커밋 경로)로 간다.
 *  · `null`      = 답변 낱말이 아니다 → 게이트의 일반 값 경로(값 재발화 = 수정 의미론 재커밋 · 실패 = 거절 큐).
 *
 * 민구 결정(09-02 · `_ASK-build-r6-fable-xhigh` ① · #3): 들린 값은 이미 커밋돼 있다 · 「하나/둘」「일/이」「1/2」는
 * 이 국면에서 **순번**이다(값으로 파싱되면 침묵 오커밋 — 그래서 컬럼명·응답어·단음절 가드보다 앞에서 해석한다).
 */
import { useSessionStore } from '../stores/sessionStore';
import { parseConfusionAnswer, resolveSttConfusion } from './sttConfusionRuntime';
import type { SttLogFn } from './sttCorrectionTracker';
import type { Column } from '../types';
import type { AwaitingField, FinalCtx } from './useVoiceSession';

type ConfusionAwaiting = Extract<AwaitingField, { kind: 'confusionConfirm' }>;

export interface ConfusionAnswerGateDeps {
  logCell: SttLogFn;
  getColById: (id: string) => Column | null;
  awaitingFieldRef: { current: AwaitingField | null };
  proceedAfterCommit: (awaiting: AwaitingField | null, opts?: { echoValue?: string }) => Promise<void>;
  relistenInContext: (a: AwaitingField) => Promise<void>;
  demoteConfusionConfirm: (a: ConfusionAwaiting) => AwaitingField;
}

export async function runConfusionAnswerGate(
  ctx: FinalCtx,
  awaiting: ConfusionAwaiting,
  deps: ConfusionAnswerGateDeps,
): Promise<'handled' | 'commit' | null> {
  const ans = parseConfusionAnswer(ctx.text, awaiting.cands.length);
  if (!ans) return null;
  if (ans.kind === 'keep') {
    useSessionStore.getState().setRecognized('');
    resolveSttConfusion('heard', deps.logCell); // 원값이 맞았다 → 계측(chosen=heard) + 프로필 부정 사례
    deps.awaitingFieldRef.current = null;
    await deps.proceedAfterCommit(awaiting);
    return 'handled';
  }
  if (ans.kind === 'relisten') {
    useSessionStore.getState().setRecognized('');
    resolveSttConfusion('respoken', deps.logCell);
    const demoted = deps.demoteConfusionConfirm(awaiting);
    deps.awaitingFieldRef.current = demoted;
    await deps.relistenInContext(demoted); // 「{항목} 다시 말씀해 주세요.」 — 재청취 규율은 그 함수 소유
    return 'handled';
  }
  // 「둘째/셋째」 — 후보값을 **파싱 없이** 커밋값으로 삼는다(그 값은 파서가 이미 만든 형태다). 커밋 경로가
  // 수정 의미론(previousValue=들린 값)으로 재커밋하고 정정 쌍(path=confusion)을 남긴다.
  resolveSttConfusion('alt', deps.logCell);
  ctx.col = deps.getColById(awaiting.colId);
  ctx.parsed = awaiting.cands[ans.index];
  ctx.lowConfParsedExtra = null;
  ctx.altIdx = null;
  return 'commit';
}
