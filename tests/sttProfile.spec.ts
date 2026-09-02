/**
 * v0.51.1 R6 — 화자 프로필(순수 계층)·export 동봉·정정 쌍 트래커 오라클(Node 러너 · clipsManifest.spec 패턴).
 *
 *  - `applyCommit/applyCorrection/applyNegative`가 표를 브리핑 §1-1 스키마대로 갱신한다.
 *  - `attachSttProfile`이 zip에 `stt-profile.json`을 **항상**(프로필 0개여도) 동봉하고, 왕복 후 형상이 같다.
 *  - 트래커: 재녹음·직접값·터치·재질문 각각 `stt_correction` 1건, STT 기억이 없는 셀은 침묵.
 */
import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import {
  STT_PROFILE_FILENAME, applyCommit, applyCorrection, applyNegative, attachSttProfile, emptyProfile, isSttProfile,
  profileKey, type SttProfileExport,
} from '../src/lib/sttProfileCore.ts';
import {
  noteSttAttempt, noteSttNonVoiceCorrection, noteSttVoiceCommit, peekSttCellMemory, resetSttCorrectionTracker,
} from '../src/lib/sttCorrectionTracker';
import type { Column } from '../src/types';

const BRIX: Column = {
  id: 'c14', name: '당도', type: 'float', input: 'voice', ttsAnnounce: true,
  auto: { kind: 'fixed', value: '' }, decimals: 1,
};

test.describe('sttProfileCore', () => {
  test('emptyProfile → commit·correction·negative 갱신 — 분모·지지수·부정 사례가 스키마대로 쌓인다', () => {
    const p = emptyProfile('ab12cd34', 'earphone', 1_000);
    expect(isSttProfile(p)).toBe(true);
    expect(profileKey(p.speaker, p.micClass)).toBe('ab12cd34|earphone');
    applyCommit(p, '당도', '1.7', 1, 'float', 2_000);
    applyCommit(p, '당도', '8.3', 1, 'float', 2_000);
    const obs = applyCorrection(p, '당도', '1.7', '8.7', 1, 3_000);
    expect(obs).toEqual([{ kind: 'digit', ctx: 'L1P0', heard: '1', said: '8' }]);
    applyCorrection(p, '당도', '1.5', '51.5', 1, 3_000); // 정렬 불가 → lengthShift
    applyNegative(p, '당도', ['L1P0:1>8'], 4_000);
    expect(p).toMatchObject({ pairs: 2, commits: 2, negatives: 1, builtAt: 1_000, updatedAt: 4_000 });
    expect(p.lengthShift).toEqual({ leading_digits_lost: 1 });
    expect(p.table.ctx.L1P0.seen['1']).toBe(2); // 커밋 1 + 부정 1
    expect(p.table.ctx.L1P0.conf['1']['8']).toBe(1);
    expect(p.table.byColumn['당도'].ctx.L1P0.seen['8']).toBe(1);
  });
  test('isSttProfile — 형상이 깨진 레코드는 버린다(잘못된 표로 묻지 않는다)', () => {
    expect(isSttProfile(null)).toBe(false);
    expect(isSttProfile({ version: 1, speaker: 'x', micClass: 'y' })).toBe(false);
    expect(isSttProfile({ ...emptyProfile('x', 'y'), table: { direction: 'said->heard' } })).toBe(false);
  });
  test('attachSttProfile — 프로필 0개여도 파일이 있고, 왕복 후 speakerId·profiles가 같다', async () => {
    const zip = new JSZip();
    attachSttProfile(zip, [], '0.51.1', 'ab12cd34', 5_000);
    const p = emptyProfile('ab12cd34', 'earphone', 1_000);
    applyCorrection(p, '당도', '738', '7.8', 1, 2_000);
    const zip2 = new JSZip();
    attachSttProfile(zip2, [p], '0.51.1', 'ab12cd34', 5_000);
    for (const [z, n] of [[zip, 0], [zip2, 1]] as const) {
      const loaded = await JSZip.loadAsync(await z.generateAsync({ type: 'uint8array' }));
      const file = loaded.file(STT_PROFILE_FILENAME);
      expect(file).not.toBeNull();
      const parsed = JSON.parse(await file!.async('string')) as SttProfileExport;
      expect(parsed).toMatchObject({ schema: 1, direction: 'heard->said', appVersion: '0.51.1', speakerId: 'ab12cd34', exportedAt: 5_000 });
      expect(parsed.profiles).toHaveLength(n);
      if (n) expect(parsed.profiles[0].table.decimalLoss.rules.as3).toBe(1);
    }
  });
});

test.describe('sttCorrectionTracker — 정정 쌍 이벤트', () => {
  type Logged = { extra: string; row: number; colId: string; text?: string };
  const logged: Logged[] = [];
  const log = (e: Logged) => { logged.push(e); };
  test.beforeEach(() => { resetSttCorrectionTracker(); logged.length = 0; });

  test('재녹음: 음성 커밋 1.7 → 「수정」 재녹음 8.7 → stt_correction 1건(from=1.7,to=8.7,path=rerecord,원 STT text·conf·alt)', () => {
    noteSttAttempt(3, 'c14', '1.7', 0.91);
    noteSttVoiceCommit({ row: 3, colId: 'c14', colName: '당도', col: BRIX, text: '1.7', conf: 0.91, altIdx: null, parsed: '1.7', previousValue: null, path: 'value' }, log);
    expect(logged).toEqual([]);
    noteSttAttempt(3, 'c14', '팔 점 칠', 0.88);
    noteSttVoiceCommit({ row: 3, colId: 'c14', colName: '당도', col: BRIX, text: '팔 점 칠', conf: 0.88, altIdx: 1, parsed: '8.7', previousValue: '1.7', path: 'rerecord' }, log);
    expect(logged).toEqual([{ type: 'stt', row: 3, colId: 'c14', colName: '당도', text: '1.7', extra: 'stt_correction:from=1.7,to=8.7,path=rerecord,text=1.7,conf=0.91,alt=-' }]);
    expect(peekSttCellMemory(3, 'c14')).toEqual({ lastParsed: '8.7', pendingAttempts: 0 });
  });
  test('재질문: 거절된 시도 2건 뒤 커밋 → path=reask 2건(from=-), 커밋 발화 자체는 쌍이 아니다', () => {
    noteSttAttempt(1, 'c14', '베드로 전화', 0.05);
    noteSttAttempt(1, 'c14', '3. 육', 0.94);
    noteSttAttempt(1, 'c14', '7.6', 0.97);
    noteSttVoiceCommit({ row: 1, colId: 'c14', colName: '당도', col: BRIX, text: '7.6', conf: 0.97, altIdx: null, parsed: '7.6', previousValue: null, path: 'value' }, log);
    expect(logged.map((l) => l.extra)).toEqual([
      'stt_correction:from=-,to=7.6,path=reask,text=베드로 전화,conf=0.05,alt=-',
      'stt_correction:from=-,to=7.6,path=reask,text=3. 육,conf=0.94,alt=-',
    ]);
  });
  test('직접값·터치: 음성 기억이 있는 셀만 쌍을 남기고, 그 뒤 기억은 비워진다', () => {
    noteSttVoiceCommit({ row: 10, colId: 'c14', colName: '당도', col: BRIX, text: '100.4', conf: 0.7, altIdx: null, parsed: '100.4', previousValue: null, path: 'value' }, log);
    noteSttNonVoiceCorrection({ row: 10, colId: 'c14', colName: '당도', col: BRIX, from: '100.4', to: '8.4', path: 'direct_modify' }, log);
    expect(logged.map((l) => l.extra)).toEqual(['stt_correction:from=100.4,to=8.4,path=direct_modify,text=100.4,conf=0.7,alt=-']);
    // 같은 셀을 다시 손으로 고쳐도 STT 기억이 없으니 침묵.
    noteSttNonVoiceCorrection({ row: 10, colId: 'c14', colName: '당도', col: BRIX, from: '8.4', to: '8.5', path: 'touch' }, log);
    expect(logged).toHaveLength(1);
    // 터치 전용 셀(음성 커밋 없음)도 침묵 · from이 기억과 다르면(사이에 다른 경로가 바꿈) 침묵.
    noteSttNonVoiceCorrection({ row: 2, colId: 'c9', colName: '종경', col: null, from: '40', to: '41', path: 'touch' }, log);
    noteSttVoiceCommit({ row: 5, colId: 'c14', colName: '당도', col: BRIX, text: '9.1', conf: 0.9, altIdx: null, parsed: '9.1', previousValue: null, path: 'value' }, log);
    noteSttNonVoiceCorrection({ row: 5, colId: 'c14', colName: '당도', col: BRIX, from: '9.3', to: '9.5', path: 'touch' }, log);
    expect(logged).toHaveLength(1);
  });
  test('r2 P2-4 — 「둘째」로 고른 값(path=confusion)은 쌍만 남기고 STT 기억을 비운다 · 재발화(rerecord)는 기억을 남긴다', () => {
    noteSttAttempt(4, 'c14', '1.7', 0.95);
    noteSttVoiceCommit({ row: 4, colId: 'c14', colName: '당도', col: BRIX, text: '1.7', conf: 0.95, altIdx: null, parsed: '1.7', previousValue: null, path: 'value' }, log);
    noteSttVoiceCommit({ row: 4, colId: 'c14', colName: '당도', col: BRIX, text: '둘째', conf: 0.95, altIdx: null, parsed: '8.7', previousValue: '1.7', path: 'confusion' }, log);
    expect(logged.map((l) => l.extra)).toEqual(['stt_correction:from=1.7,to=8.7,path=confusion,text=1.7,conf=0.95,alt=-']);
    expect(peekSttCellMemory(4, 'c14')).toEqual({ lastParsed: null, pendingAttempts: 0 });
    // 이어지는 직접값 정정은 STT 기억이 없으니 침묵 — 「STT가 8.7로 들었다」는 가짜 쌍(리뷰 R-D)이 안 남는다.
    noteSttNonVoiceCorrection({ row: 4, colId: 'c14', colName: '당도', col: BRIX, from: '8.7', to: '8.4', path: 'direct_modify' }, log);
    expect(logged).toHaveLength(1);
    // 반증 짝: 값을 다시 말한 재커밋(rerecord)은 STT 관측이라 기억이 남고 다음 정정에 쌍이 난다.
    noteSttVoiceCommit({ row: 5, colId: 'c14', colName: '당도', col: BRIX, text: '1.7', conf: 0.95, altIdx: null, parsed: '1.7', previousValue: null, path: 'value' }, log);
    noteSttVoiceCommit({ row: 5, colId: 'c14', colName: '당도', col: BRIX, text: '팔 점 칠', conf: 0.9, altIdx: null, parsed: '8.7', previousValue: '1.7', path: 'rerecord' }, log);
    expect(peekSttCellMemory(5, 'c14')).toEqual({ lastParsed: '8.7', pendingAttempts: 0 });
    noteSttNonVoiceCorrection({ row: 5, colId: 'c14', colName: '당도', col: BRIX, from: '8.7', to: '8.4', path: 'direct_modify' }, log);
    expect(logged.at(-1)!.extra).toBe('stt_correction:from=8.7,to=8.4,path=direct_modify,text=팔 점 칠,conf=0.9,alt=-');
  });
  test('text는 escapeExtraValue를 거친다(쉼표·등호·24자 절단) · previousValue가 같으면 쌍 없음', () => {
    noteSttVoiceCommit({ row: 7, colId: 'c14', colName: '당도', col: BRIX, text: '십 2008, 그리고=아주 긴 발화 원문 문자열입니다', conf: 0.5, altIdx: 2, parsed: '10.8', previousValue: null, path: 'value' }, log);
    noteSttVoiceCommit({ row: 7, colId: 'c14', colName: '당도', col: BRIX, text: '10.8', conf: 0.9, altIdx: null, parsed: '10.8', previousValue: '10.8', path: 'rerecord' }, log);
    expect(logged).toEqual([]);
    noteSttVoiceCommit({ row: 7, colId: 'c14', colName: '당도', col: BRIX, text: '9.8', conf: 0.9, altIdx: null, parsed: '9.8', previousValue: '10.8', path: 'rerecord' }, log);
    expect(logged[0].extra).toBe('stt_correction:from=10.8,to=9.8,path=rerecord,text=10.8,conf=0.9,alt=-');
  });
});
