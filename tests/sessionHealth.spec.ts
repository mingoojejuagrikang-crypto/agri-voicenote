/**
 * tests/sessionHealth.spec.ts — Node 환경 sessionHealth 순수 모듈 검증 및 방출처 문자열 오라클 잠금.
 *
 * ⓐ 빌더가 있는 접두: lowConfidenceParsed, sttCorrection, sttConfusionHint의 실제 빌더 출력을 onEntry에 공급.
 * ⓑ 빌더가 없는 접두: 방출처 소스 파일에 그 문자열이 있는지 fs.readFileSync로 단언 + 그 리터럴로 카운트.
 * ⓒ 필드별 경계:
 *   - wakeFail: wake_lock과 result=failed 포함 매칭 (앞머리가 wake_lock이 아니어도 매칭)
 *   - authSkip: sessionId 일치 + __app__ + '' 포함
 *   - corr: 고정 순서(reask -> direct_modify -> rerecord -> touch -> confusion), 0 생략, 전부 0이면 '-'
 *   - confQ: asked=0 제외, 분자 2가지 조건 (첫 parsed != finalValue && finalValue in cands), 0이어도 '0/0'
 *   - modMishear: 정규식 매칭 (일치 1건, 불일치 1건)
 *   - 다른 세션 id는 무시
 *   - reset(newId) 호출 시 0 리셋
 *   - 합성 기대값 및 getScreenValues 검증 (실데이터 대조는 Larry가 판 밖에서 5/5 일치 확인)
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
  sessionHealth,
  beepPlay,
} from '../src/lib/logEvents';
import { sessionHealthSummaryScreen } from '../src/lib/voicePrompts';

const ROOT = process.cwd();

test('[node] ⓪-게이트 이 오라클이 릴리스 게이트 목록에 등재돼 있다 (v0.53.0)', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as {
    scripts: Record<string, string>;
  };
  const listed = (pkg.scripts['test:e2e:gate'] ?? '').split(/\s+/).filter((x) => x.startsWith('tests/'));
  expect(listed, 'tests/sessionHealth.spec.ts가 릴리스 게이트 목록에 없다').toContain('tests/sessionHealth.spec.ts');
});

test('ⓑ 방출처 소스 파일 오라클 잠금 — 소스 변경 시 red', () => {
  // 1. beep_play:kind=reject (logEventsAudio.ts:275 빌더 출력 리터럴 순서: kind가 첫 필드)
  const audioSrc = readFileSync(resolve(ROOT, 'src/lib/logEventsAudio.ts'), 'utf-8');
  expect(audioSrc).toMatch(/`beep_play:\$\{kv\(\{\s*kind:\s*fields\.kind,/);
  const beepSrc = readFileSync(resolve(ROOT, 'src/lib/beep.ts'), 'utf-8');
  expect(beepSrc).toContain('extra: beepPlay({ kind, ...outcome })');

  // 2. lifecycle:error: (speech.ts:175 접두 생성 + speech.ts:367 error:${err})
  const speechSrc = readFileSync(resolve(ROOT, 'src/lib/speech.ts'), 'utf-8');
  expect(speechSrc).toContain("extra: `lifecycle:${kind}`");
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

  // lowConfidenceParsed: 실제 시그니처 객체 전달
  tracker.onEntry({
    ts: 1, type: 'value', sessionId: SID, row: 1, colId: 'm1', parsed: '10.5',
    extra: lowConfidenceParsed({ conf: 0.42, minConf: 0.6, tolerance: 3, via: 'primary' }),
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

  // 1. wakeFail: 포함 매칭 (앞머리가 wake_lock이 아니어도 매칭)
  tracker.onEntry({ ts: 1, type: 'session', sessionId: SID, extra: 'custom_prefix:wake_lock:action=acquire,result=failed,reason=NotAllowedError' });
  tracker.onEntry({ ts: 2, type: 'session', sessionId: SID, extra: 'wake_lock:action=reacquire,result=ok' }); // failed 없음 -> 미카운트
  tracker.onEntry({ ts: 3, type: 'session', sessionId: SID, extra: 'other_event:result=failed' }); // wake_lock 없음 -> 미카운트

  // S3-a: reask — beep_play:kind= 가 reject가 아닌 비프는 reask 카운트에 포함되지 않음 단언 (변이: beep_play: 전체를 셈 방지)
  tracker.onEntry({
    ts: 3.1,
    type: 'session',
    sessionId: SID,
    extra: beepPlay({ kind: 'ready', result: 'played', ctx: 'running', gain: 1, tones: 1 }),
  });
  tracker.onEntry({
    ts: 3.2,
    type: 'session',
    sessionId: SID,
    extra: beepPlay({ kind: 'commit', result: 'played', ctx: 'running', gain: 1, tones: 1 }),
  });

  // 2. lowconf: type!=='value'인 low_conf_parsed 이벤트는 안 센다
  tracker.onEntry({ ts: 4, type: 'stt', sessionId: SID, extra: 'low_conf_parsed:conf=0.4' });
  tracker.onEntry({ ts: 5, type: 'app', sessionId: SID, extra: 'low_conf_parsed:conf=0.4' });

  // S3-b: lowconf — low_conf_parsed 접두가 아닌데 low_conf를 포함하는 value 이벤트는 lowconf에 미반영 단언 (변이: includes('low_conf') 방지)
  tracker.onEntry({ ts: 5.1, type: 'value', sessionId: SID, extra: 'not_low_conf_parsed:conf=0.4' });
  tracker.onEntry({ ts: 5.2, type: 'value', sessionId: SID, extra: 'custom_low_conf_something:conf=0.4' });

  // 3. authSkip: SID, __app__, '', 다른 세션 ID
  tracker.onEntry({ ts: 6, type: 'app', sessionId: SID, extra: 'past_index_skip:not_signed_in' });
  tracker.onEntry({ ts: 7, type: 'app', sessionId: '__app__', extra: 'past_index_skip:not_signed_in' });
  tracker.onEntry({ ts: 8, type: 'app', sessionId: '', extra: 'past_index_skip:not_signed_in' });
  tracker.onEntry({ ts: 9, type: 'app', sessionId: 'sess_other', extra: 'past_index_skip:not_signed_in' }); // 다른 세션 ID -> 카운트 안 함

  // 4. alarm: fired ≠ confirmed (예: fired 2, confirmed 1) 및 순서/포맷 단언
  tracker.onEntry({ ts: 10, type: 'app', sessionId: SID, extra: 'trend_alert_fired:rule=r1' });
  tracker.onEntry({ ts: 11, type: 'app', sessionId: SID, extra: 'trend_alert_fired:rule=r2' });
  tracker.onEntry({ ts: 12, type: 'app', sessionId: SID, extra: 'trend_alert_confirmed' });

  // 5. corr: 입력을 고정 순서와 반대로 넣고 출력 순서 단언 (confusion -> touch -> rerecord -> direct_modify -> reask)
  tracker.onEntry({ ts: 13, type: 'stt', sessionId: SID, row: 5, colName: 'col1', extra: 'stt_correction:path=confusion' });
  tracker.onEntry({ ts: 14, type: 'stt', sessionId: SID, row: 4, colName: 'col1', extra: 'stt_correction:path=touch' });
  tracker.onEntry({ ts: 15, type: 'stt', sessionId: SID, row: 3, colName: 'col1', extra: 'stt_correction:path=rerecord' });
  tracker.onEntry({ ts: 16, type: 'stt', sessionId: SID, row: 2, colName: 'col1', extra: 'stt_correction:path=direct_modify' });
  tracker.onEntry({ ts: 17, type: 'stt', sessionId: SID, row: 1, colName: 'col1', extra: 'stt_correction:path=reask' });
  tracker.onEntry({ ts: 18, type: 'stt', sessionId: SID, row: 1, colName: 'col1', extra: 'stt_correction:path=reask' });

  // 6. confQ 및 숫자 비교 (R5-6):
  // - 칸 1: asked=0 (분모 제외)
  tracker.onEntry({ ts: 19, type: 'stt', sessionId: SID, row: 1, colId: 'c1', colName: 'col1', extra: 'stt_confusion_hint:heard=1.0,cands=8.0,rule=r1,asked=0,chosen=-' });

  // - 칸 2: 숫자 비교: 첫 '8' ↔ 최종 '8.0'은 같음 (isDiff=false -> 분자 아님!)
  tracker.onEntry({ ts: 20, type: 'value', sessionId: SID, row: 2, colId: 'c2', colName: 'col2', parsed: '8' });
  tracker.onEntry({ ts: 21, type: 'stt', sessionId: SID, row: 2, colId: 'c2', colName: 'col2', extra: 'stt_confusion_hint:heard=8,cands=8.0,rule=r1,asked=1,chosen=alt' });

  // - 칸 3: 숫자 비교: 첫 '7' ↔ 최종 '8', cands '8.0' ↔ 최종 '8' 적중 (isDiff=true && isCandHit=true -> HIT!)
  tracker.onEntry({ ts: 22, type: 'value', sessionId: SID, row: 3, colId: 'c3', colName: 'col3', parsed: '7' });
  tracker.onEntry({ ts: 23, type: 'stt', sessionId: SID, row: 3, colId: 'c3', colName: 'col3', extra: 'stt_confusion_hint:heard=7,cands=8.0,rule=r1,asked=1,chosen=alt' });

  // - 칸 4: 첫 value 없음 (value 이벤트 없음) -> heard 대체 금지, 분자 제외
  tracker.onEntry({ ts: 24, type: 'stt', sessionId: SID, row: 4, colId: 'c4', colName: 'col4', extra: 'stt_confusion_hint:heard=1.0,cands=9.0,rule=r1,asked=1,chosen=alt' });

  // - 칸 5: 최종 행 없음 (saved.rows에 row 5 없음) -> 분자 제외
  tracker.onEntry({ ts: 25, type: 'value', sessionId: SID, row: 5, colId: 'c1', colName: 'col1', parsed: '1.0' });
  // S2: 칸(row 5 · c1)에 parsed:'9.0' 값 이벤트를 하나 더 넣어 「최종 행 없으면 마지막 parsed로 대체」 변이에서 confQ가 바뀌게
  tracker.onEntry({ ts: 25.5, type: 'value', sessionId: SID, row: 5, colId: 'c1', colName: 'col1', parsed: '9.0' });
  tracker.onEntry({ ts: 26, type: 'stt', sessionId: SID, row: 5, colId: 'c1', colName: 'col1', extra: 'stt_confusion_hint:heard=1.0,cands=9.0,rule=r1,asked=1,chosen=alt' });

  // - 칸 6: 음성 열 아닌 이름 (colName: 'manual_col', input: 'manual') -> 분자 제외
  tracker.onEntry({ ts: 27, type: 'value', sessionId: SID, row: 6, colId: 'c_manual', colName: 'manual_col', parsed: '1.0' });
  tracker.onEntry({ ts: 28, type: 'stt', sessionId: SID, row: 6, colId: 'c_manual', colName: 'manual_col', extra: 'stt_confusion_hint:heard=1.0,cands=9.0,rule=r1,asked=1,chosen=alt' });

  // 7. modMishear: 정규식 매칭 (맞는 예, 안 맞는 예, extra 있는 경우)
  expect(MOD_MISHEAR_REGEX.test('소정 15.2')).toBe(true);
  expect(MOD_MISHEAR_REGEX.test('수 정 8')).toBe(true);
  expect(MOD_MISHEAR_REGEX.test('그 정 4.5')).toBe(true);
  expect(MOD_MISHEAR_REGEX.test('일반 15.2')).toBe(false);

  tracker.onEntry({ ts: 29, type: 'stt', sessionId: SID, text: '소정 15.2' }); // 매칭 1
  tracker.onEntry({ ts: 30, type: 'stt', sessionId: SID, text: '일반 15.2' }); // 매칭 안 됨
  tracker.onEntry({ ts: 31, type: 'stt', sessionId: SID, text: '수 정 8', extra: 'raw_confidence:0.9' }); // extra 존재 -> 제외

  // 8. 다른 세션 ID 이벤트는 무시하고 reask 등이 안 늘었음을 명시적 단언 (R5-1)
  const saved: SessionHealthSavedInput = {
    columns: [
      { id: 'c1', name: 'col1', input: 'voice' },
      { id: 'c2', name: 'col2', input: 'voice' },
      { id: 'c3', name: 'col3', input: 'voice' },
      { id: 'c4', name: 'col4', input: 'voice' },
      { id: 'c_manual', name: 'manual_col', input: 'manual' },
    ],
    rows: [
      { index: 1, values: { c1: '10' } },
      { index: 2, values: { c2: '8.0' } },
      { index: 3, values: { c3: '8' } },
      { index: 4, values: { c4: '9.0' } },
      { index: 6, values: { c_manual: '9.0' } },
    ],
  };

  const beforeOther = tracker.summary(saved);
  expect(beforeOther.reask, '다른 세션 전 reask=0 (S3-a: non-reject beepPlay 미카운트)').toBe(0);
  tracker.onEntry({ ts: 32, type: 'session', sessionId: 'other_sess', extra: 'beep_play:kind=reject' });
  const afterOther = tracker.summary(saved);
  expect(afterOther.reask, '다른 세션 이벤트 삽입 후에도 reask는 늘지 않아야 한다').toBe(0);

  // 결과 검증
  // S4: cells 필터 — 음성 열이면서 최종 행에 존재하는 2개 셀(c2 in row 2, c3 in row 3)만 카운트
  expect(afterOther.cells, 'cells는 음성 열이면서 최종 행에 존재하는 2개 셀만 카운트').toBe(2);
  expect(afterOther.wakeFail, 'wakeFail 1건').toBe(1);
  expect(afterOther.lowconf, 'type!=value 및 접두 불일치 lowconf는 0건 (S3-b)').toBe(0);
  expect(afterOther.authSkip, 'authSkip은 SID, __app__, 빈문자열 3건').toBe(3);
  expect(afterOther.alarm, 'alarm은 fired=2, confirmed=1').toEqual({ fired: 2, confirmed: 1 });
  expect(sessionHealth(afterOther), '빌더에서 alarm=2/1 형식 출력 확인').toContain('alarm=2/1');
  // S5: 배선이 confirmed가 아닌 alarmFired(2)를 넘기는지 단위 단언
  expect(tracker.getScreenValues().alarmFired, 'getScreenValues.alarmFired는 confirmed(1)가 아닌 fired(2)를 반환해야 한다').toBe(2);
  expect(afterOther.corr, 'corr은 역순 삽입에도 고정 순서 유지').toBe('reask:2/1|direct_modify:1/1|rerecord:1/1|touch:1/1|confusion:1/1');
  // asked=1인 힌트: 칸 2, 칸 3, 칸 4, 칸 5, 칸 6 (총 5건).
  // 분자: 칸 3만 적중 (첫 7 != 최종 8 && cands '8.0' == 최종 8) => 1건.
  expect(afterOther.confQ, 'confQ는 물은 5건 중 1건 적중 -> 5/1').toBe('5/1');
  expect(afterOther.modMishear, 'modMishear는 1건').toBe(1);

  // 9. R1/R2/R4 경계: saved 없음 검증 (cells=0, confQ 분모 5 유지, 분자 0)
  const noSavedRes = tracker.summary();
  expect(noSavedRes.cells, 'saved 없으면 cells=0').toBe(0);
  expect(noSavedRes.confQ, 'saved 없으면 confQ 분자 0').toBe('5/0');

  // 10. R2 경계: valueCells가 0일 때 saved.rows가 있어도 cells=0
  const cleanTracker = createSessionHealth();
  cleanTracker.reset('clean_sess');
  const emptyValRes = cleanTracker.summary(saved);
  expect(emptyValRes.cells, '값 이벤트가 0이면 saved.rows가 있어도 cells=0').toBe(0);
  expect(emptyValRes.confQ, '힌트가 0이면 0/0').toBe('0/0');

  // 11. reset 호출 시 전부 0 및 confQ='0/0', corr='-'
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
  expect(emptyRes.confQ, '물은 힌트가 0이어도 0/0').toBe('0/0');
  expect(emptyRes.modMishear).toBe(0);
});

test('합성 기대값 및 getScreenValues 검증', () => {
  // 실데이터 대조는 Larry가 판 밖에서 5/5 일치 확인
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
    tracker.onEntry({
      ts: 300, type: 'value', sessionId: SID, row: 1, colId: 'c1',
      extra: lowConfidenceParsed({ conf: 0.35, minConf: 0.6, tolerance: 3, via: 'primary' }),
    });
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

test('R7 getSessionId 및 복원 세션 판별 검증', () => {
  const tracker = createSessionHealth();
  // reset 전에는 '' (새로고침 직후 상태)
  expect(tracker.getSessionId()).toBe('');
  // 다른 sessionId와 대조 시 다름 -> 복원 판정
  expect(tracker.getSessionId() === 'sess_restored').toBe(false);

  // reset 호출 후
  tracker.reset('sess_normal');
  expect(tracker.getSessionId()).toBe('sess_normal');
  expect(tracker.getSessionId() === 'sess_normal').toBe(true);
});

test('S5 sessionHealthSummaryScreen 서로 다른 세 값 바이트 리터럴 단언', () => {
  expect(sessionHealthSummaryScreen(28, 36, 2)).toBe('이번 세션 · 다시 묻기 28 · 고친 칸 36 · 알람 2');
});


