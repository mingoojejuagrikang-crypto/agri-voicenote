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
/** 값 게이트 블록 E에 도달한 kind(atEnd/reviewWait/cellWait는 흡수 가드가 앞에서 return — 게이트 헤더의 내로잉 증명). */
type ValueAwaiting = Exclude<AwaitingField, { kind: 'atEnd' | 'reviewWait' | 'cellWait' }>;

export interface ConfusionAnswerGateDeps {
  logCell: SttLogFn;
  getColById: (id: string) => Column | null;
  awaitingFieldRef: { current: AwaitingField | null };
  proceedAfterCommit: (awaiting: AwaitingField | null, opts?: { echoValue?: string }) => Promise<void>;
  relistenInContext: (a: AwaitingField) => Promise<void>;
  demoteConfusionConfirm: (a: ConfusionAwaiting) => Extract<AwaitingField, { kind: 'modify' }>;
}

/** 🔴 r2 P1-1(정본 ⓑ) — 질문 대기 중 재발화가 「점」 뒤를 잃었다(`decimal_fraction_lost`) = 답은 「값을 다시 말한다」로 정해졌다
 *  (chosen=respoken). 질문을 **여기서 접고**(modify 강등 · previousValue=들린 값 보존) 돌려준다 — 게이트는 그 위에
 *  `fractionWhole`을 세운다. 접지 않으면 다음 조각 「일」(= .1)이 답변 해석에 먼저 걸려 순번 「첫째」로 먹히고, 사용자가
 *  8.1을 말했는데 1.7이 무에코로 남는다(리뷰 R-A · 조용한 오커밋). 질문 대기가 아니면 그대로 돌려준다. */
export function closeConfusionForRespoken(
  awaiting: ValueAwaiting,
  deps: Pick<ConfusionAnswerGateDeps, 'logCell' | 'demoteConfusionConfirm'>,
): Exclude<ValueAwaiting, ConfusionAwaiting> {
  if (awaiting.kind !== 'confusionConfirm') return awaiting;
  resolveSttConfusion('respoken', deps.logCell);
  return deps.demoteConfusionConfirm(awaiting);
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
