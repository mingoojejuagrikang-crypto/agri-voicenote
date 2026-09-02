/**
 * v0.51.1 R6 — **혼동 확인 질문 런타임(세션 스코프).** 값 커밋 착지가 후보를 물어보고, 값 게이트·명령 스테이지가
 * 답을 해석해 여기로 결산한다. 표·후보·판정의 순수 부분은 `sttConfusionCore.ts`, 프로필은 `sttProfileStore.ts`.
 *
 * 민구 결정(2026-09-02 · `_ASK-build-r6-fable-xhigh`):
 *  ① **먼저 커밋 → 질문.** 들린 값은 이미 셀에 서 있다(알람 `trendConfirm`과 같은 꼴). 「첫째/네/확인」= 그대로 진행 ·
 *     「둘째」= 후보로 재커밋(previousValue=들린 값) · 값 재발화 = 그 값으로 재커밋 · 「아니오/수정」= 재청취.
 *  ⓐ **그럴듯함은 혼동표 확률뿐이다.** 세션 내 이전 값·범위 규칙은 어떤 형태로도 넣지 않는다(값 범위는 사용자가
 *     설정하는 이상치 알람의 몫). 여기에 스토어의 다른 셀 값을 읽는 코드를 넣지 마라.
 *  #3 답변 어휘·상한(셀당 1회 · 세션당 `CONFUSION_SESSION_CAP`)·알람 우선·「첫째」 부정 사례 반영 승인.
 *
 * 계측 계약: `stt_confusion_hint`는 **후보 발동당 정확히 1건** — 물었으면 답이 정해진 뒤(chosen=heard|alt|respoken,
 * 명령·세션 종료로 소멸=-), 상한으로 안 물었으면 그 자리에서 asked=0. 발동 자체는 `evaluateSttConfusion`이 센다.
 */
import { sttConfusionHint } from './logEvents';
import { colKey, decide, generateCandidates } from './sttConfusionCore.ts';
import { confusionTables, recordSttNegative } from './sttProfileStore';
import type { SttLogFn } from './sttCorrectionTracker';
import type { Column } from '../types';

/** 세션당 질문 상한 — 표가 어긋나 있어도 세션 하나를 질문으로 덮지 않는다(셀당 1회는 별도). */
export const CONFUSION_SESSION_CAP = 30;

export interface ConfusionQuestion {
  row: number;
  colId: string;
  colName: string;
  heard: string;
  cands: string[];
  rules: string[];
}

let askedCells = new Set<string>();
let askedCount = 0;
let pending: ConfusionQuestion | null = null;

function cellKey(row: number, colId: string): string {
  return `${row}:${colId}`;
}

function hint(q: ConfusionQuestion, asked: boolean, chosen: 'heard' | 'alt' | 'respoken' | null, log: SttLogFn): void {
  log({
    type: 'stt', row: q.row, colId: q.colId, colName: q.colName,
    extra: sttConfusionHint({ heard: q.heard, cands: q.cands, rules: q.rules, asked, chosen }),
  });
}

/** 세션 경계 — 상한 카운터·대기 질문을 비운다(대기 중이던 질문은 `finishSttConfusion`이 먼저 결산한다). */
export function resetSttConfusionSession(): void {
  askedCells = new Set();
  askedCount = 0;
  pending = null;
}

/** 값 커밋 직후(알람이 안 떴을 때) — 후보가 있고 상한 안이면 질문을 돌려준다. 상한에 걸리면 asked=0으로 계측만. */
export function evaluateSttConfusion(input: {
  row: number; colId: string; colName: string; col: Column | null; heard: string;
}, log: SttLogFn): ConfusionQuestion | null {
  const { row, colId, colName, col, heard } = input;
  // 🔴 r2 P2-3 — **소수(float) 컬럼만** 묻는다. 정수(개수) 컬럼은 1·2·3이 정상값이라 root 폴백의 「1」 질문이 매번 위양성이고
  //   (09-02 오커밋 64건은 전부 소수 컬럼), 답변 낱말에서 맨 숫자를 뺀 지금은 int 컬럼에 후보 선택 어휘도 없다.
  if (!col || col.type !== 'float') return null;
  const decimals = col.decimals ?? 1;
  const cands = generateCandidates({ heard, col: colKey(colName), decimals, colType: col.type, tables: confusionTables() });
  const d = decide(heard, cands);
  if (!d.ask) return null;
  const q: ConfusionQuestion = { row, colId, colName, heard, cands: d.cands.map((c) => c.value), rules: d.cands.map((c) => c.rule) };
  if (askedCells.has(cellKey(row, colId)) || askedCount >= CONFUSION_SESSION_CAP) {
    hint(q, false, null, log);
    return null;
  }
  return q;
}

/** 질문을 실제로 물을 때(TTS 직전) — 상한 카운터에 올리고 대기 상태로 든다. */
export function armSttConfusion(q: ConfusionQuestion): void {
  askedCells.add(cellKey(q.row, q.colId));
  askedCount += 1;
  pending = q;
}

export function getPendingSttConfusion(): ConfusionQuestion | null {
  return pending;
}

/** 답이 정해졌다 — 계측 1건 + 「첫째」면 물었던 규칙의 부정 사례를 프로필에. */
export function resolveSttConfusion(chosen: 'heard' | 'alt' | 'respoken' | null, log: SttLogFn): ConfusionQuestion | null {
  const q = pending;
  if (!q) return null;
  pending = null;
  hint(q, true, chosen, log);
  if (chosen === 'heard') recordSttNegative(colKey(q.colName), q.rules);
  return q;
}

/** 세션 종료 — 답 없이 끝난 질문은 chosen=- 로 결산한다(발동당 1건 계약). */
export function finishSttConfusion(log: SttLogFn): void {
  resolveSttConfusion(null, log);
}

export type ConfusionAnswer =
  | { kind: 'keep' }
  | { kind: 'choice'; index: number }
  | { kind: 'relisten' };

// 🔴 r2 P2-3 — **순서 낱말과 네/아니오만**이다. 맨 숫자·수사(1/2/3 · 일/이/삼 · 하나/둘/셋 · 일번/이번/삼번)는 뺐다: 질문
//   국면에서도 그것들은 **값 재발화**로 파서에 넘어간다(리뷰 R-A 「일」=소수부 .1 · R-B int 「삼」=값 3). 「N번」은 순서
//   표지가 붙어 있어 남긴다.
const KEEP = /^(첫째|첫번째|첫째거|1번|처음|앞|앞에|앞에꺼|앞의것|앞엣것|네|예|응|어|넵|맞아|맞아요|맞습니다|맞다|그래|그래요|확인|유지|그대로)$/;
const SECOND = /^(둘째|두번째|둘째거|2번|뒤|뒤에|뒤에꺼|뒤의것|뒤엣것|나중|나중거)$/;
const THIRD = /^(셋째|세번째|셋째거|3번)$/;
const RELISTEN = /^(아니오|아니요|아니|아냐|아니야|틀려|틀려요|틀렸어|틀렸어요|틀렸습니다|다시|수정|둘다아니|둘다아니야|둘다아니요|둘다아니에요)$/;

/** 확인 질문에 대한 발화 해석(순수). 답변 낱말이 아니면 null — 호출자가 일반 값 경로로 넘긴다(값 재발화 · 소수부 조각 포함).
 *  `nCands`보다 큰 순번은 null. */
export function parseConfusionAnswer(text: string, nCands: number): ConfusionAnswer | null {
  const s = text.replace(/[\s.,!?]+/g, '');
  if (!s) return null;
  if (KEEP.test(s)) return { kind: 'keep' };
  if (RELISTEN.test(s)) return { kind: 'relisten' };
  if (SECOND.test(s)) return nCands >= 1 ? { kind: 'choice', index: 0 } : null;
  if (THIRD.test(s)) return nCands >= 2 ? { kind: 'choice', index: 1 } : null;
  return null;
}
