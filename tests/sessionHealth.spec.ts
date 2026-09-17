/**
 * tests/sessionHealth.spec.ts — Node 환경 sessionHealth 순수 모듈 검증 및 방출처 문자열 오라클 잠금.
 *
 * ⓐ 빌더가 있는 접두: lowConfidenceParsed, sttCorrection, sttConfusionHint의 실제 빌더 출력을 onEntry에 공급.
 * ⓑ 빌더가 없는 접두: 방출처 소스 파일에 그 문자열이 있는지 fs.readFileSync로 단언 + 그 리터럴로 카운트.
 * ⓒ 필드별 경계:
 *   - wakeFail: wake_lock과 result=failed 포함 매칭
 *   - authSkip: sessionId 일치 + __app__ + '' 포함
 *   - corr: 고정 순서(reask -> direct_modify -> rerecord -> touch -> confusion), 0 생략, 전부 0이면 '-'
 *   - confQ: asked=0 제외, 분자 2가지 조건 (첫 parsed != finalValue && finalValue in cands)
 *   - modMishear: 정규식 매칭 (일치 1건, 불일치 1건)
 *   - 다른 세션 id는 무시
 *   - reset(newId) 호출 시 0 리셋
 *   - 09-16 세션 기대값 및 getScreenValues 검증
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createSessionHealth,
  MOD_MISHEAR_REGEX,
  type SessionHealthSavedInput,
} from '../src/lib/sessionHealth';
import {
  lowConfidenceParsed,
  sttCorrection,
  sttConfusionHint,
} from '../src/lib/logEvents';

const ROOT = process.cwd();

test('[node] ⓪-게이트 이 오라클이 릴리스 게이트 목록에 등재돼 있다 (v0.53.0)', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as {
    scripts: Record<string, string>;
  };
  const listed = (pkg.scripts['test:e2e:gate'] ?? '').split(/\s+/).filter((x) => x.startsWith('tests/'));
  expect(listed, 'tests/sessionHealth.spec.ts가 릴리스 게이트 목록에 없다').toContain('tests/sessionHealth.spec.ts');
});

test('ⓑ 방출처 소스 파일 오라클 잠금 — 소스 변경 시 red', () => {
  // 1. beep_play:kind=reject (logEventsAudio.ts의 beepPlay builder 및 useFinalCommands.ts 주석/beep.ts)
  const audioSrc = readFileSync(resolve(ROOT, 'src/lib/logEventsAudio.ts'), 'utf-8');
  expect(audioSrc).toContain('beep_play:');
  expect(audioSrc).toContain('kind: fields.kind');

  // 2. lifecycle:error: (speech.ts:367 `error:${err}`)
  const speechSrc = readFileSync(resolve(ROOT, 'src/lib/speech.ts'), 'utf-8');
  expect(speechSrc).toContain("this.logLifecycle(`error:${err}`, true)");

  // 3. wake_lock ... result=failed (wakeLock.ts:48 logRelease & logEventsAudio.ts:169 wakeLockEvent)
  const wakeLockSrc = readFileSync(resolve(ROOT, 'src/lib/wakeLock.ts'), 'utf-8');
  expect(audioSrc).toContain('wake_lock:');
  expect(wakeLockSrc).toContain("result: 'failed'");

  // 4. past_index_skip:not_signed_in (pastValues.ts:229)
  const pastSrc = readFileSync(resolve(ROOT, 'src/lib/pastValues.ts'), 'utf-8');
  expect(pastSrc).toContain('past_index_skip:not_signed_in');

  // 5. trend_alert_fired (anomalyAlert.ts:131)
  const anomalySrc = readFileSync(resolve(ROOT, 'src/lib/anomalyAlert.ts'), 'utf-8');
  expect(anomalySrc).toContain('trend_alert_fired:');

  // 6. trend_alert_confirmed (useTrendGate.ts:243)
  const trendGateSrc = readFileSync(resolve(ROOT, 'src/lib/useTrendGate.ts'), 'utf-8');
  expect(trendGateSrc).toContain("extra: 'trend_alert_confirmed'");
});

test('ⓐ 빌더 출력 공급 및 카운터 동작 검증', () => {
  const tracker = createSessionHealth();
  const SID = 'sess_test_1';
  tracker.reset(SID);

  // lowConfidenceParsed
  tracker.onEntry({
    ts: 1, type: 'value', sessionId: SID, row: 1, colId: 'm1', parsed: '10.5',
    extra: lowConfidenceParsed(0.42),
  });

  // sttCorrection
  tracker.onEntry({
    ts: 2, type: 'stt', sessionId: SID, row: 1, colId: 'm1', colName: '측정1',
    extra: sttCorrection({ from: null, to: '10.5', path: 'reask', text: '열 점 오', conf: 0.8, alt: null }),
  });

  // sttConfusionHint
  tracker.onEntry({
    ts: 3, type: 'stt', sessionId: SID, row: 1, colId: 'm1', colName: '측정1',
    extra: sttConfusionHint({ heard: '1.5', cands: ['10.5'], rules: ['dec:1>10'], asked: true, chosen: 'alt' }),
  });

  const saved: SessionHealthSavedInput = {
    columns: [{ id: 'm1', name: '측정1', input: 'voice' }],
    rows: [{ index: 1, values: { m1: '10.5' } }],
  };

  const sum = tracker.summary(saved);
  expect(sum.lowconf).toBe(1);
  expect(sum.corr).toBe('reask:1/1');
  // asked=1, firstParsed('10.5') === finalVal('10.5') => hit 0
  expect(sum.confQ).toBe('1/0');
});

test('ⓒ 경계 검증 — wakeFail, authSkip, corr, confQ, modMishear, 세션 ID 격리, reset', () => {
  const tracker = createSessionHealth();
  const SID = 'sess_bound';
  tracker.reset(SID);

  // 1. wakeFail 포함 매칭 검증
  tracker.onEntry({ ts: 1, type: 'session', sessionId: SID, extra: 'wake_lock:action=acquire,result=failed,reason=NotAllowedError' });
  tracker.onEntry({ ts: 2, type: 'session', sessionId: SID, extra: 'wake_lock:action=reacquire,result=ok' }); // failed 없음
  tracker.onEntry({ ts: 3, type: 'session', sessionId: SID, extra: 'other_event:result=failed' }); // wake_lock 없음

  // 2. authSkip: SID, __app__, '', 다른 세션 ID
  tracker.onEntry({ ts: 4, type: 'app', sessionId: SID, extra: 'past_index_skip:not_signed_in' });
  tracker.onEntry({ ts: 5, type: 'app', sessionId: '__app__', extra: 'past_index_skip:not_signed_in' });
  tracker.onEntry({ ts: 6, type: 'app', sessionId: '', extra: 'past_index_skip:not_signed_in' });
  tracker.onEntry({ ts: 7, type: 'app', sessionId: 'sess_other', extra: 'past_index_skip:not_signed_in' }); // 다른 세션 ID -> 카운트 안 함

  // 3. corr: 순서, 0 생략, 전부 0이면 '-'
  // reask 2건(같은 칸), direct_modify 1건
  tracker.onEntry({ ts: 8, type: 'stt', sessionId: SID, row: 1, colId: 'c1', colName: 'col1', extra: 'stt_correction:path=reask' });
  tracker.onEntry({ ts: 9, type: 'stt', sessionId: SID, row: 1, colId: 'c1', colName: 'col1', extra: 'stt_correction:path=reask' });
  tracker.onEntry({ ts: 10, type: 'stt', sessionId: SID, row: 2, colId: 'c2', colName: 'col2', extra: 'stt_correction:path=direct_modify' });

  // 4. confQ: asked=0 제외, 분자 조건(첫 parsed != final, final in cands)
  // 칸 1: asked=0 (제외되어야 함)
  tracker.onEntry({ ts: 11, type: 'stt', sessionId: SID, row: 1, colId: 'c1', colName: 'col1', extra: 'stt_confusion_hint:heard=1.0,cands=8.0,rule=r1,asked=0,chosen=-' });
  // 칸 2: asked=1, 첫 parsed='1.0', final='8.0', cands=['8.0'] -> HIT!
  tracker.onEntry({ ts: 12, type: 'value', sessionId: SID, row: 2, colId: 'c2', colName: 'col2', parsed: '1.0' });
  tracker.onEntry({ ts: 13, type: 'stt', sessionId: SID, row: 2, colId: 'c2', colName: 'col2', extra: 'stt_confusion_hint:heard=1.0,cands=8.0|7.0,rule=r1,asked=1,chosen=alt' });
  // 칸 3: asked=1, 첫 parsed='2.0', final='2.0'(미수정), cands=['9.0'] -> NOT hit!
  tracker.onEntry({ ts: 14, type: 'value', sessionId: SID, row: 3, colId: 'c3', colName: 'col3', parsed: '2.0' });
  tracker.onEntry({ ts: 15, type: 'stt', sessionId: SID, row: 3, colId: 'c3', colName: 'col3', extra: 'stt_confusion_hint:heard=2.0,cands=9.0,rule=r2,asked=1,chosen=heard' });

  // 5. modMishear: 정규식 매칭 (맞는 예 1건, 안 맞는 예 1건, extra 있는 경우 무시)
  expect(MOD_MISHEAR_REGEX.test('소정 15.2')).toBe(true);
  expect(MOD_MISHEAR_REGEX.test('수 정 8')).toBe(true);
  expect(MOD_MISHEAR_REGEX.test('그 정 4.5')).toBe(true);
  expect(MOD_MISHEAR_REGEX.test('일반 15.2')).toBe(false);

  tracker.onEntry({ ts: 16, type: 'stt', sessionId: SID, text: '소정 15.2' }); // 매칭 1
  tracker.onEntry({ ts: 17, type: 'stt', sessionId: SID, text: '일반 15.2' }); // 매칭 안 됨
  tracker.onEntry({ ts: 18, type: 'stt', sessionId: SID, text: '수 정 8', extra: 'raw_confidence:0.9' }); // extra 존재 -> 제외

  // 6. 다른 세션 ID 이벤트는 무시
  tracker.onEntry({ ts: 19, type: 'session', sessionId: 'other', extra: 'beep_play:kind=reject' });

  const saved: SessionHealthSavedInput = {
    columns: [
      { id: 'c1', name: 'col1', input: 'voice' },
      { id: 'c2', name: 'col2', input: 'voice' },
      { id: 'c3', name: 'col3', input: 'voice' },
    ],
    rows: [
      { index: 1, values: { c1: '10' } },
      { index: 2, values: { c2: '8.0' } },
      { index: 3, values: { c3: '2.0' } },
    ],
  };

  const res = tracker.summary(saved);
  expect(res.wakeFail, 'wakeFail은 wake_lock과 result=failed를 모두 포함한 1건').toBe(1);
  expect(res.authSkip, 'authSkip은 SID, __app__, 빈문자열 3건').toBe(3);
  expect(res.corr, 'corr은 reask와 direct_modify만 포함').toBe('reask:2/1|direct_modify:1/1');
  expect(res.confQ, 'confQ는 asked=1인 2건 중 hit 1건').toBe('2/1');
  expect(res.modMishear, 'modMishear는 1건').toBe(1);

  // 7. reset 호출 시 전부 0
  tracker.reset('sess_new');
  const emptyRes = tracker.summary();
  expect(emptyRes.cells).toBe(0);
  expect(emptyRes.reask).toBe(0);
  expect(emptyRes.lowconf).toBe(0);
  expect(emptyRes.alarm).toEqual({ fired: 0, confirmed: 0 });
  expect(emptyRes.sttErr).toBe(0);
  expect(emptyRes.wakeFail).toBe(0);
  expect(emptyRes.authSkip).toBe(0);
  expect(emptyRes.corr).toBe('-');
  expect(emptyRes.confQ).toBe('-');
  expect(emptyRes.modMishear).toBe(0);
});

test('09-16 세션 기대값 전수 재현 및 getScreenValues 검증', () => {
  const tracker = createSessionHealth();
  const SID = 'sess_0916';
  tracker.reset(SID);

  // cells: 144개 distinct voice cell (24 rows * 6 cols)
  const cols = [
    { id: 'c1', name: '항목1', input: 'voice' },
    { id: 'c2', name: '항목2', input: 'voice' },
    { id: 'c3', name: '항목3', input: 'voice' },
    { id: 'c4', name: '항목4', input: 'voice' },
    { id: 'c5', name: '항목5', input: 'voice' },
    { id: 'c6', name: '항목6', input: 'voice' },
  ];
  const rows = [];
  for (let r = 1; r <= 24; r++) {
    const values: Record<string, string> = {};
    for (const c of cols) {
      values[c.id] = `${r}.${c.id}`;
      tracker.onEntry({
        ts: 100, type: 'value', sessionId: SID, row: r, colId: c.id, colName: c.name, parsed: values[c.id],
      });
    }
    rows.push({ index: r, values });
  }

  // reask: 28
  for (let i = 0; i < 28; i++) {
    tracker.onEntry({ ts: 200, type: 'session', sessionId: SID, extra: 'beep_play:kind=reject,result=played' });
  }

  // lowconf: 12
  for (let i = 0; i < 12; i++) {
    tracker.onEntry({ ts: 300, type: 'value', sessionId: SID, row: 1, colId: 'c1', extra: 'low_conf_parsed:0.35' });
  }

  // alarm: 0/0 (발생 없음)

  // sttErr: 3
  for (let i = 0; i < 3; i++) {
    tracker.onEntry({ ts: 400, type: 'stt', sessionId: SID, extra: 'lifecycle:error:no-speech' });
  }

  // wakeFail: 3
  for (let i = 0; i < 3; i++) {
    tracker.onEntry({ ts: 500, type: 'session', sessionId: SID, extra: 'wake_lock:acquire,result=failed' });
  }

  // authSkip: 0 (발생 없음)

  // corr: reask:27/19|direct_modify:8/8|rerecord:7/6|touch:3/3
  // reask 27 lines across 19 cells
  for (let i = 1; i <= 19; i++) {
    tracker.onEntry({ ts: 600, type: 'stt', sessionId: SID, row: i, colId: 'c1', colName: '항목1', extra: 'stt_correction:path=reask' });
  }
  for (let i = 1; i <= 8; i++) {
    tracker.onEntry({ ts: 601, type: 'stt', sessionId: SID, row: i, colId: 'c1', colName: '항목1', extra: 'stt_correction:path=reask' });
  }
  // direct_modify 8 lines across 8 cells
  for (let i = 1; i <= 8; i++) {
    tracker.onEntry({ ts: 602, type: 'stt', sessionId: SID, row: i, colId: 'c2', colName: '항목2', extra: 'stt_correction:path=direct_modify' });
  }
  // rerecord 7 lines across 6 cells
  for (let i = 1; i <= 6; i++) {
    tracker.onEntry({ ts: 603, type: 'stt', sessionId: SID, row: i, colId: 'c3', colName: '항목3', extra: 'stt_correction:path=rerecord' });
  }
  tracker.onEntry({ ts: 604, type: 'stt', sessionId: SID, row: 1, colId: 'c3', colName: '항목3', extra: 'stt_correction:path=rerecord' });
  // touch 3 lines across 3 cells
  for (let i = 1; i <= 3; i++) {
    tracker.onEntry({ ts: 605, type: 'stt', sessionId: SID, row: i, colId: 'c4', colName: '항목4', extra: 'stt_correction:path=touch' });
  }

  // confQ: 3/2 (asked 3, hit 2)
  // cell 10: asked 1, first=1.0, final=8.0, cands=['8.0'] -> hit!
  tracker.onEntry({ ts: 700, type: 'value', sessionId: SID, row: 10, colId: 'c1', colName: '항목1', parsed: '1.0' });
  tracker.onEntry({ ts: 701, type: 'stt', sessionId: SID, row: 10, colId: 'c1', colName: '항목1', extra: 'stt_confusion_hint:heard=1.0,cands=8.0,rule=r1,asked=1,chosen=alt' });
  rows[9].values['c1'] = '8.0';

  // cell 11: asked 1, first=1.1, final=8.1, cands=['8.1'] -> hit!
  tracker.onEntry({ ts: 702, type: 'value', sessionId: SID, row: 11, colId: 'c1', colName: '항목1', parsed: '1.1' });
  tracker.onEntry({ ts: 703, type: 'stt', sessionId: SID, row: 11, colId: 'c1', colName: '항목1', extra: 'stt_confusion_hint:heard=1.1,cands=8.1,rule=r1,asked=1,chosen=alt' });
  rows[10].values['c1'] = '8.1';

  // cell 12: asked 1, first=1.2, final=1.2, cands=['8.2'] -> no hit
  tracker.onEntry({ ts: 704, type: 'value', sessionId: SID, row: 12, colId: 'c1', colName: '항목1', parsed: '1.2' });
  tracker.onEntry({ ts: 705, type: 'stt', sessionId: SID, row: 12, colId: 'c1', colName: '항목1', extra: 'stt_confusion_hint:heard=1.2,cands=8.2,rule=r1,asked=1,chosen=heard' });
  rows[11].values['c1'] = '1.2';

  // modMishear: 7
  for (let i = 0; i < 7; i++) {
    tracker.onEntry({ ts: 800, type: 'stt', sessionId: SID, text: `소정 ${i + 1}` });
  }

  const saved: SessionHealthSavedInput = { columns: cols, rows };
  const sum = tracker.summary(saved);

  expect(sum.cells).toBe(144);
  expect(sum.reask).toBe(28);
  expect(sum.lowconf).toBe(12);
  expect(sum.alarm).toEqual({ fired: 0, confirmed: 0 });
  expect(sum.sttErr).toBe(3);
  expect(sum.wakeFail).toBe(3);
  expect(sum.authSkip).toBe(0);
  expect(sum.corr).toBe('reask:27/19|direct_modify:8/8|rerecord:7/6|touch:3/3');
  expect(sum.confQ).toBe('3/2');
  expect(sum.modMishear).toBe(7);

  // getScreenValues: reask=28, correctedCells=19+8+6+3=36, alarmFired=0
  const screen = tracker.getScreenValues();
  expect(screen.reask).toBe(28);
  expect(screen.correctedCells).toBe(36);
  expect(screen.alarmFired).toBe(0);
});
