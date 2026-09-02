/**
 * v0.51.1 R6 — 혼동 확인 질문 런타임 오라클(Node 러너): 답변 낱말 해석(순수) · 셀당 1회·세션 상한 · hint 1건/발동 계약 ·
 * 「첫째」 부정 사례. 표는 손으로 만들지 않고 **출하 전역 표**(프로필 미선택 → 전역 폴백)를 그대로 쓴다 — 런타임이 실제로
 * 읽는 경로다(PRINCIPLES §4 「프로덕션이 실제로 방출하는 형상」).
 */
import { test, expect } from '@playwright/test';
import {
  CONFUSION_SESSION_CAP, armSttConfusion, evaluateSttConfusion, finishSttConfusion, getPendingSttConfusion,
  parseConfusionAnswer, resetSttConfusionSession, resolveSttConfusion,
} from '../src/lib/sttConfusionRuntime';
import type { Column } from '../src/types';

const BRIX: Column = {
  id: 'c14', name: '당도', type: 'float', input: 'voice', ttsAnnounce: true,
  auto: { kind: 'fixed', value: '' }, decimals: 1,
};
const WIDTH: Column = { ...BRIX, id: 'c8', name: '횡경(mm)' };
const COUNT: Column = { id: 'c20', name: '과수', type: 'int', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' } };

test.describe('parseConfusionAnswer — 답변 어휘(민구 승인 #3)', () => {
  test('원값·후보·재청취 낱말 · 순번은 후보 수를 넘지 않는다 · 그 밖은 null', () => {
    for (const w of ['첫째', '첫 번째', '1번', '네', '예', '맞아요', '확인', '유지']) expect(parseConfusionAnswer(w, 2), w).toEqual({ kind: 'keep' });
    for (const w of ['둘째', '두 번째', '2번', '뒤에']) expect(parseConfusionAnswer(w, 2), w).toEqual({ kind: 'choice', index: 0 });
    for (const w of ['셋째', '세 번째', '3번']) expect(parseConfusionAnswer(w, 2), w).toEqual({ kind: 'choice', index: 1 });
    // r2 P2-3 — 맨 숫자·수사는 답변이 아니다(값 재발화·소수부 조각으로 파서에 간다): 리뷰 R-A 「일」·R-B 「삼」.
    for (const w of ['하나', '일', '1', '둘', '이', '2', '셋', '삼', '3', '일번', '이번', '삼번']) expect(parseConfusionAnswer(w, 2), w).toBeNull();
    for (const w of ['아니오', '아니요', '아니', '틀려요', '다시', '수정']) expect(parseConfusionAnswer(w, 2), w).toEqual({ kind: 'relisten' });
    expect(parseConfusionAnswer('셋째', 1)).toBeNull(); // 후보가 1개면 셋째는 없다
    expect(parseConfusionAnswer('팔 점 칠', 2)).toBeNull(); // 값 재발화 → 일반 값 경로
    expect(parseConfusionAnswer('8.7', 2)).toBeNull();
    expect(parseConfusionAnswer('', 2)).toBeNull();
  });
});

test.describe('evaluate/arm/resolve — 상한·계측 계약', () => {
  type Logged = { extra: string; row: number; colId: string };
  const logged: Logged[] = [];
  const log = (e: Logged) => { logged.push(e); };
  test.beforeEach(() => { resetSttConfusionSession(); logged.length = 0; });

  test('전역 표만으로 당도 「1.7」은 8.7을 묻고, 「49.5」·비숫자 컬럼은 묻지 않는다', () => {
    const q = evaluateSttConfusion({ row: 1, colId: 'c14', colName: '당도', col: BRIX, heard: '1.7' }, log);
    expect(q).not.toBeNull();
    // r2 P2-2 — 당도 컬럼 증거(seen[1]=11 · 1>8=7 ≥ k · 1>7=2 < k)라 후보는 8.7 하나다(1>7은 컬럼에서 미생성).
    expect(q!.cands).toEqual(['8.7']);
    expect(q!.rules).toEqual(['L1P0:1>8']);
    expect(evaluateSttConfusion({ row: 1, colId: 'c8', colName: '횡경(mm)', col: WIDTH, heard: '49.5' }, log)).toBeNull();
    expect(evaluateSttConfusion({ row: 1, colId: 'x', colName: '농가명', col: { ...BRIX, type: 'text' }, heard: '1.7' }, log)).toBeNull();
    // r2 P2-3 — 정수(개수) 컬럼은 묻지 않는다(리뷰 R-B: 과수 「1」이 root 폴백으로 매번 질문 → 「삼」이 셋째로 먹혀 7).
    expect(evaluateSttConfusion({ row: 1, colId: 'c20', colName: '과수', col: COUNT, heard: '1' }, log)).toBeNull();
    expect(logged).toEqual([]); // 후보가 없거나 안 묻는 경우엔 계측도 없다(발동이 아니다)
  });

  test('발동당 hint 정확히 1건 — 물었으면 답이 정해진 뒤(chosen), 「첫째」는 부정 사례로 다음 질문을 억제한다', () => {
    const q = evaluateSttConfusion({ row: 1, colId: 'c14', colName: '당도', col: BRIX, heard: '1.7' }, log)!;
    armSttConfusion(q);
    expect(getPendingSttConfusion()).toBe(q);
    expect(logged).toEqual([]); // 묻는 순간엔 남기지 않는다
    resolveSttConfusion('alt', log);
    expect(logged.map((l) => l.extra)).toEqual(['stt_confusion_hint:heard=1.7,cands=8.7,rule=L1P0:1>8,asked=1,chosen=alt']);
    expect(getPendingSttConfusion()).toBeNull();
    resolveSttConfusion('alt', log); // 대기 질문이 없으면 아무것도 안 남긴다
    expect(logged).toHaveLength(1);
  });

  test('셀당 1회 — 같은 셀의 두 번째 후보는 asked=0으로 계측만 남기고 묻지 않는다', () => {
    const q = evaluateSttConfusion({ row: 3, colId: 'c14', colName: '당도', col: BRIX, heard: '1.7' }, log)!;
    armSttConfusion(q);
    resolveSttConfusion('respoken', log);
    const again = evaluateSttConfusion({ row: 3, colId: 'c14', colName: '당도', col: BRIX, heard: '1.3' }, log);
    expect(again).toBeNull();
    expect(logged.map((l) => l.extra)).toEqual([
      'stt_confusion_hint:heard=1.7,cands=8.7,rule=L1P0:1>8,asked=1,chosen=respoken',
      'stt_confusion_hint:heard=1.3,cands=8.3,rule=L1P0:1>8,asked=0,chosen=-',
    ]);
    // 다른 셀은 묻는다(셀 단위 상한).
    expect(evaluateSttConfusion({ row: 4, colId: 'c14', colName: '당도', col: BRIX, heard: '1.7' }, log)).not.toBeNull();
  });

  test(`세션당 ${CONFUSION_SESSION_CAP}회 — 상한 뒤엔 새 셀도 묻지 않는다 · 세션 리셋으로 풀린다`, () => {
    for (let r = 1; r <= CONFUSION_SESSION_CAP; r++) {
      const q = evaluateSttConfusion({ row: r, colId: 'c14', colName: '당도', col: BRIX, heard: '1.7' }, log);
      expect(q, `row ${r}`).not.toBeNull();
      armSttConfusion(q!);
      resolveSttConfusion('heard', log);
    }
    expect(evaluateSttConfusion({ row: 99, colId: 'c14', colName: '당도', col: BRIX, heard: '1.7' }, log)).toBeNull();
    expect(logged.at(-1)!.extra).toContain('asked=0');
    resetSttConfusionSession();
    expect(evaluateSttConfusion({ row: 99, colId: 'c14', colName: '당도', col: BRIX, heard: '1.7' }, log)).not.toBeNull();
  });

  test('세션 종료 결산 — 답 없이 끝난 질문은 chosen=- 1건, 대기 질문이 없으면 0건', () => {
    finishSttConfusion(log);
    expect(logged).toEqual([]);
    const q = evaluateSttConfusion({ row: 1, colId: 'c14', colName: '당도', col: BRIX, heard: '1.7' }, log)!;
    armSttConfusion(q);
    finishSttConfusion(log);
    expect(logged.map((l) => l.extra)).toEqual(['stt_confusion_hint:heard=1.7,cands=8.7,rule=L1P0:1>8,asked=1,chosen=-']);
  });
});
