/**
 * v0.51.1 R6 — **정정 쌍 트래커(세션 스코프).** 셀마다 「마지막 음성 커밋의 STT 원문·신뢰도·alt 순번」과
 * 「그 커밋 전에 거절된 시도들」을 기억했다가, 값이 **정정되는 순간** `stt_correction` 이벤트 1건을 남기고
 * 화자 프로필(`sttProfileStore`)을 갱신한다. 종전엔 판독 레인이 `stt`·`value`·`command` 순서를 300줄
 * 스크립트로 재구성해야 쌍을 얻었다(`stt_cells.py`) — 앱이 직접 남기면 훈련 쌍이 견고해진다.
 *
 * 정정 경로 4종 + 확인 질문:
 *  · `rerecord`      — 「수정」 뒤 재녹음 커밋(awaiting modify/trendConfirm, previousValue ≠ parsed)
 *  · `direct_modify` — 「수정 8.4」 직접값 (enterModifyMode)
 *  · `touch`         — 수동 입력 시트·터치 인라인 편집 커밋
 *  · `reask`         — 거절된 시도(from=-)가 있는 채로 커밋된 값 — 거절된 시도 **하나마다 1건**
 *                      (각각이 서로 다른 STT 원문이라 별개 훈련 쌍이다)
 *  · `confusion`     — R6 확인 질문에서 「둘째」/재발화로 값이 바뀜
 *
 * 🔴 STT 기억이 없는 셀(터치로만 채워진 셀의 재편집 등)은 **쌍을 남기지 않는다** — STT가 들은 값이 아닌
 *   것을 훈련 쌍으로 넣으면 표가 오염된다. 같은 이유로 `from`이 기억 속 parsed와 다르면(사이에 다른
 *   경로가 값을 바꿨다) 프로필에는 넣지 않고 이벤트도 남기지 않는다.
 * 🔴 이 모듈은 로그를 **직접 방출하지 않는다** — 호출자의 `logCell`(sessionId 부착 SSOT)을 받는다.
 */
import { sttCorrection, type SttCorrectionPath } from './logEvents';
import { colKey } from './sttConfusionCore.ts';
import { recordSttCommit, recordSttCorrection } from './sttProfileStore';
import type { Column } from '../types';

export type SttLogFn = (entry: {
  type: 'stt'; extra: string; row: number; colId: string; colName?: string; text?: string;
}) => void;

interface VoiceMemory {
  text: string;
  conf: number;
  altIdx: number | null;
  parsed: string;
}

interface CellMemory {
  lastVoice: VoiceMemory | null;
  /** 마지막 커밋 뒤에 들어온 시도들(마지막 원소가 곧 다음 커밋의 발화일 수 있다). */
  attempts: { text: string; conf: number }[];
}

const cells = new Map<string, CellMemory>();

function key(row: number, colId: string): string {
  return `${row}:${colId}`;
}

function mem(row: number, colId: string): CellMemory {
  const k = key(row, colId);
  let m = cells.get(k);
  if (!m) {
    m = { lastVoice: null, attempts: [] };
    cells.set(k, m);
  }
  return m;
}

function decimalsOf(col: Column | null): number {
  if (!col) return 1;
  return col.type === 'float' ? (col.decimals ?? 1) : 0;
}

/** 세션 경계 — 기억을 비운다(이전 세션의 셀 좌표가 새 세션에 겹친다). */
export function resetSttCorrectionTracker(): void {
  cells.clear();
}

/** 값 게이트가 흡수·거절 가드를 지나 **값으로 판정하러 가는 발화**마다 1회. 커밋되면 마지막 원소가
 *  그 커밋의 발화이고, 그 앞의 것들이 「재질문으로 거절된 시도」다. */
export function noteSttAttempt(row: number, colId: string, text: string, conf: number): void {
  mem(row, colId).attempts.push({ text, conf });
}

/** 음성 커밋 1건(일반·재녹음·확인 질문 응답 공통). `previousValue`는 modify 의미론의 직전 값. */
export function noteSttVoiceCommit(input: {
  row: number; colId: string; colName: string; col: Column | null;
  text: string; conf: number; altIdx: number | null; parsed: string;
  previousValue: string | null;
  path: 'value' | 'rerecord' | 'confusion';
}, log: SttLogFn): void {
  const { row, colId, colName, col, text, conf, altIdx, parsed, previousValue, path } = input;
  const m = mem(row, colId);
  const ck = colKey(colName);
  const decimals = decimalsOf(col);

  // ① 재질문 쌍 — 이 커밋 전에 거절된 시도들(from=-). 마지막 시도가 이 커밋의 발화면 제외한다.
  const attempts = m.attempts;
  const last = attempts[attempts.length - 1];
  const rejected = last && last.text === text ? attempts.slice(0, -1) : attempts;
  for (const r of rejected) {
    log({
      type: 'stt', row, colId, colName, text: r.text,
      extra: sttCorrection({ from: null, to: parsed, path: 'reask', text: r.text, conf: r.conf, alt: null }),
    });
  }
  m.attempts = [];

  // ② 정정 쌍 — 직전 음성 커밋값이 이 값으로 바뀌었다.
  if (previousValue != null && previousValue !== parsed && m.lastVoice && m.lastVoice.parsed === previousValue) {
    const lv = m.lastVoice;
    log({
      type: 'stt', row, colId, colName, text: lv.text,
      extra: sttCorrection({
        from: previousValue, to: parsed, path: path === 'value' ? 'rerecord' : path,
        text: lv.text, conf: lv.conf, alt: lv.altIdx,
      }),
    });
    recordSttCorrection(ck, previousValue, parsed, decimals);
  }

  // ③ 이 커밋이 이제 그 셀의 STT 기억이다 + 분모.
  m.lastVoice = { text, conf, altIdx, parsed };
  if (col) recordSttCommit(ck, parsed, decimals, col.type);
}

/** STT가 아닌 경로(직접값·터치)가 음성 커밋값을 바꿨다. 기억이 없거나 `from`이 기억과 다르면 침묵. */
export function noteSttNonVoiceCorrection(input: {
  row: number; colId: string; colName: string; col: Column | null;
  from: string | null | undefined; to: string;
  path: Extract<SttCorrectionPath, 'direct_modify' | 'touch'>;
}, log: SttLogFn): void {
  const { row, colId, colName, col, from, to, path } = input;
  const m = cells.get(key(row, colId));
  if (!m?.lastVoice || from == null || from === to || m.lastVoice.parsed !== from || !to) return;
  const lv = m.lastVoice;
  log({
    type: 'stt', row, colId, colName, text: lv.text,
    extra: sttCorrection({ from, to, path, text: lv.text, conf: lv.conf, alt: lv.altIdx }),
  });
  recordSttCorrection(colKey(colName), from, to, decimalsOf(col));
  // 셀의 값이 더는 STT가 들은 값이 아니다 — 다음 정정은 이 값과 짝지을 STT 원문이 없다.
  m.lastVoice = null;
  m.attempts = [];
}

/** 테스트·판독용 — 셀의 STT 기억. */
export function peekSttCellMemory(row: number, colId: string): { lastParsed: string | null; pendingAttempts: number } {
  const m = cells.get(key(row, colId));
  return { lastParsed: m?.lastVoice?.parsed ?? null, pendingAttempts: m?.attempts.length ?? 0 };
}
