/**
 * 🔴 v0.52 — **「수정 <이름>」 모호 확인 질문**(민구 결정 2026-09-03 · `_ASK-l1-def003` Q1「C」/Q2「가」).
 *
 * 앱은 `종경(mm)`을 「종경」이라고 가르친다(09-02 괄호 미독). 그 축약 이름을 가진 열이 **둘 이상**이면
 * (`수확량(1차)`·`수확량(2차)`, 또는 시트 중복 헤더) 어느 칸인지 결정할 수 없다. 종전엔 그런 발화가
 * 캐스케이드로 떨어져 **셀을 지웠다.** 이제는 묻는다.
 *
 * ## 왜 R6 `confusionConfirm`을 재사용하지 않는가 (실측 · Larry 수용)
 *
 * 브리핑은 *"바퀴를 새로 만들지 마라 — R6 확인 질문 흐름에 같은 어휘·같은 형상으로 붙여라"* 였다.
 * **그 전제가 성립하지 않는다:** `confusionConfirm`은 **값 의미론**이고, 그 답변 게이트
 * (`finalValueGateConfusion.ts`)의 「둘째」가 `ctx.parsed = awaiting.cands[i]` → **값 커밋 경로**로 간다.
 * 컬럼명을 `cands`에 실으면 **컬럼명이 값으로 커밋된다.** 그래서 재사용하는 것은 딱 둘이다:
 *  · **어휘** — 순번 정규식은 `sttConfusionRuntime`에서 **import**한다(사본 없음 — [PAST-2]).
 *  · **형상** — 질문 TTS → 대기 상태 → 답변 해석 → 원상 복귀.
 * 값 커밋 경로에는 **태우지 않는다.** 답이 고른 것은 값이 아니라 **어느 칸을 다시 부를지**다.
 *
 * ## 계약
 *  · 「첫 번째/첫째」 = **시트 열 순서상 앞선 것**(민구 못박음). 후보는 `voiceColsList()` 순서 그대로다.
 *  · 「아니오」 = 지목 취소 → 질문 전 국면으로 그대로 되돌린다.
 *  · **답이 아닌 발화**도 같은 복귀를 한다 — 질문 상태가 남아 다음 값 발화를 삼키면 안 된다
 *    (그 세 국면은 전부 값 발화를 흡수하는 상태라, 되돌리는 것이 곧 종전 동작이다).
 *  · 🔴 **어느 셀도 지워지지 않는다** — 답하기 전에는 아무것도 건드리지 않고, 답한 뒤에도
 *    지목된 **한 칸만** 재기록 대기가 된다(`single`).
 */
import { useSessionStore } from '../stores/sessionStore';
import { FIRST_ORDINAL, RELISTEN, SECOND, THIRD } from './sttConfusionRuntime';
import {
  MODIFY_COLUMN_MAX_CANDS, REVIEW_WAIT_COMMANDS_TTS, cellWaitPrompt, modifyColumnConfirmTts,
} from './voicePrompts';
import { computeTotalRows } from './autoValue';
import type { ModifyGuardKind } from './voiceCommands';
import type { FinalValueGateDeps } from './useFinalValueGate';
import type { AwaitingField } from './useVoiceSession';
import type { logger } from './logger';

type LogCell = (entry: Omit<Parameters<typeof logger.log>[0], 'sessionId'>) => void;

export type ModifyColumnAwaiting = Extract<AwaitingField, { kind: 'modifyColumnConfirm' }>;

/** 순번 정규식 — **R6의 표를 그대로 import**한다(낱말 사본 0). 배열 순서 = 후보 순서. */
const ORDINALS: readonly RegExp[] = [FIRST_ORDINAL, SECOND, THIRD];

/** 확인 질문에 대한 발화 해석(순수). 답변 낱말이 아니면 `null` — 호출자가 원상 복귀시킨다.
 *  `n`보다 큰 순번은 `null`이다(「셋째」인데 후보가 둘이면 답이 아니다). */
export function parseModifyColumnAnswer(
  text: string,
  n: number,
): { kind: 'pick'; index: number } | { kind: 'cancel' } | null {
  const s = text.replace(/[\s.,!?]+/g, '');
  if (!s) return null;
  if (RELISTEN.test(s)) return { kind: 'cancel' };
  for (let i = 0; i < Math.min(n, ORDINALS.length); i += 1) {
    if (ORDINALS[i].test(s)) return { kind: 'pick', index: i };
  }
  return null;
}

/** 질문 전 국면의 **기존 대기 문구**(새 문구를 만들지 않는다 — 전부 기존 SSOT). */
export function originPrompt(
  a: Pick<ModifyColumnAwaiting, 'originKind' | 'name'>,
  endReachedTts: () => string,
): string {
  if (a.originKind === 'cellWait') return cellWaitPrompt(a.name);
  if (a.originKind === 'reviewWait') return REVIEW_WAIT_COMMANDS_TTS;
  return endReachedTts();
}

/** 질문 전 국면으로 되돌린 `AwaitingField` — 복원은 **필드 재구성**이다(재귀 저장 없이). */
export function restoreOrigin(a: ModifyColumnAwaiting): AwaitingField {
  const base = { row: a.row, colId: a.colId, name: a.name };
  if (a.originKind === 'cellWait') return { ...base, kind: 'cellWait', previousValue: a.previousValue ?? '' };
  if (a.originKind === 'reviewWait') return { ...base, kind: 'reviewWait' };
  return { ...base, kind: 'atEnd' };
}

export interface ModifyColumnConfirmDeps {
  logCell: LogCell;
  say: (text: string, interrupt?: boolean) => Promise<boolean>;
  awaitingFieldRef: { current: AwaitingField | null };
}

/** 모호 판정 직후 — 질문을 세운다. 🔴 후보가 순번 어휘보다 많으면 **묻지 않고** `false`를 돌려
 *  호출자가 비파괴 착지로 보내게 한다(후보를 잘라 물으면 고를 수 없는 열이 생긴다). */
export async function armModifyColumnConfirm(
  origin: { kind: ModifyGuardKind; row: number; colId: string; name: string; previousValue?: string },
  spoken: string,
  cands: string[],
  deps: ModifyColumnConfirmDeps,
): Promise<boolean> {
  if (cands.length < 2 || cands.length > MODIFY_COLUMN_MAX_CANDS) return false;
  deps.logCell({
    type: 'command', parsed: 'modify_column_confirm',
    extra: `modify_column_confirm:${cands.length}`, text: spoken,
    row: origin.row, colId: origin.colId,
  });
  deps.awaitingFieldRef.current = {
    row: origin.row, colId: origin.colId, name: origin.name,
    kind: 'modifyColumnConfirm',
    spoken, cands,
    originKind: origin.kind,
    ...(origin.previousValue != null ? { previousValue: origin.previousValue } : {}),
  };
  const q = modifyColumnConfirmTts(spoken, cands.length);
  useSessionStore.getState().setLastTts(q);
  await deps.say(q);
  return true;
}

/** 값 게이트 주입 심볼의 **부분집합**을 그대로 받는다(형제 흡수 모듈과 같은 계약) — 게이트에
 *  조립 코드를 두지 않기 위해서다(그 파일은 500줄 상한에 붙어 있다). */
export type ModifyColumnAnswerDeps = Pick<
  FinalValueGateDeps,
  'logCell' | 'say' | 'awaitingFieldRef' | 'enterModifyMode'
  | 'voiceColsList' | 'listEmptyRows' | 'buildEndReachedTts' | 'getSessionColumns'
>;

/** 값 게이트에서 부르는 답변 처리. **항상 이 final을 끝낸다**(게이트는 `true`를 돌려준다). */
export async function runModifyColumnAnswerGate(
  awaiting: ModifyColumnAwaiting,
  text: string,
  deps: ModifyColumnAnswerDeps,
): Promise<void> {
  const { logCell, say, awaitingFieldRef, enterModifyMode } = deps;
  const vc = deps.voiceColsList();
  const voiceColIndex = (id: string) => vc.findIndex((c) => c.id === id);
  const endReachedTts = () =>
    deps.buildEndReachedTts(deps.listEmptyRows(computeTotalRows(deps.getSessionColumns()), vc));
  const ans = parseModifyColumnAnswer(text, awaiting.cands.length);
  const picked = ans?.kind === 'pick' ? awaiting.cands[ans.index] : null;
  const idx = picked ? voiceColIndex(picked) : -1;
  if (picked && idx >= 0) {
    logCell({
      type: 'command', parsed: 'modify_column_picked',
      extra: `modify_column_picked:${ans!.kind === 'pick' ? ans!.index : -1}`, text,
      row: awaiting.row, colId: picked,
    });
    // 🔑 값 커밋 경로에 태우지 않는다 — 고른 것은 값이 아니라 **어느 칸을 다시 부를지**다.
    //   `single`이 그 한 칸만 비운다(민구: 한 칸만 지목한다).
    await enterModifyMode(undefined, null, {
      row: awaiting.row, idx,
      land: awaiting.originKind === 'cellWait' ? 'cell' : 'review',
      single: true,
    });
    return;
  }
  // 「아니오」 · 답이 아닌 발화 — 질문 전 국면으로 그대로 되돌린다(셀은 건드리지 않는다).
  logCell({
    type: 'command', parsed: 'modify_column_cancelled',
    extra: `modify_column_cancelled:${ans?.kind ?? 'not_an_answer'}`, text,
    row: awaiting.row, colId: awaiting.colId,
  });
  useSessionStore.getState().setRecognized('');
  awaitingFieldRef.current = restoreOrigin(awaiting);
  const msg = originPrompt(awaiting, endReachedTts);
  useSessionStore.getState().setLastTts(msg);
  await say(msg);
}
