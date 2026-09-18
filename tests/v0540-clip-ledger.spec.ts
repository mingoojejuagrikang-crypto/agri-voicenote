/**
 * tests/v0540-clip-ledger.spec.ts — v0.54.0 F3: 클립 저장 실패 분리 및 결산 원장 검증.
 *
 * 이 스펙이 고정하는 문장:
 *  ① ⓪-게이트 목록 등재 자기단언
 *  ② ⓐ :raw 키 저장만 실패 시:
 *     - clip_raw_save_failed: 1줄
 *     - clip_save_failed: 0줄
 *     - 해당 셀의 클립 포인터 보존 (audioClips에 키 유지)
 *     - session_health의 saveErr=0
 *  ③ ⓑ 본 클립 키 저장 실패 시:
 *     - clip_save_failed: 1줄
 *     - session_health의 saveErr=1
 *     - 재연결 배너 미발생 (마이크 소실/재연결 표시 0, clip_summary의 failed 0, clip_unreliable_summary 0줄)
 *  ④ ⓒ 두 세션 모두 검산식 성립:
 *     clip_stop_await 수 === saved + failed + unreliable + saveErr + discarded
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BASE } from './baseUrl';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, waitForTtsIdle } from './fixtures/stt';

test.setTimeout(60_000);

const ROOT = process.cwd();

test('⓪-게이트 이 오라클이 릴리스 게이트 목록에 등재돼 있다 (v0.54.0)', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as {
    scripts: Record<string, string>;
  };
  const listed = (pkg.scripts['test:e2e:gate'] ?? '').split(/\s+/).filter((x) => x.startsWith('tests/'));
  expect(listed, 'tests/v0540-clip-ledger.spec.ts가 릴리스 게이트 목록에 없다').toContain('tests/v0540-clip-ledger.spec.ts');
});

const MINI_COLUMNS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 1 }, sampleKey: true },
  { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];
const MINI_SETTINGS = {
  ...AZ_SETTINGS,
  state: { ...AZ_SETTINGS.state, columns: MINI_COLUMNS, totalRows: 1, sessionAutoLabel: 'clip-ledger' },
};
const MINI_HEADERS = ['조사일자', '농가명', '조사나무', '측정항목01'];
const MINI_ROWS = [[PREV_ROUND, '이원창', '1', '100.0']];

test('ⓐ :raw 저장만 실패 → clip_raw_save_failed: 1줄, 본 클립 보존, saveErr=0, 검산식 성립', async ({ page }) => {
  // IDBObjectStore.prototype.put 가로채기: :raw 키에서만 throw
  // AudioContext.prototype.decodeAudioData 스텁: 트림 가능한 오디오 버퍼 반환 (rawBlob 생성 유도)
  await page.addInitScript(() => {
    (window as any).__failAudioPutPattern = ':raw';

    const origPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: any, key?: any) {
      const targetKey = typeof key === 'string' ? key : '';
      if (this.name === 'audioClips' && (window as any).__failAudioPutPattern) {
        if ((window as any).__failAudioPutPattern === ':raw' && targetKey.endsWith(':raw')) {
          throw new Error('intercepted audioClips put error for :raw: ' + targetKey);
        }
      }
      return origPut.apply(this, arguments as any);
    };

    const origCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (origCtx) {
      origCtx.prototype.decodeAudioData = async function () {
        const rate = 16000;
        const buf = this.createBuffer(1, 40000, rate);
        const d = buf.getChannelData(0);
        // 1초 침묵 + 0.5초 발화 + 1초 침묵
        for (let i = 16000; i < 24000; i++) {
          d[i] = i % 2 === 0 ? 0.5 : -0.5;
        }
        return buf;
      };
    }
  });

  await boot(page, PHONE_402, {
    settings: MINI_SETTINGS as unknown as typeof AZ_SETTINGS,
    headers: MINI_HEADERS,
    sheetRows: MINI_ROWS,
  });
  await waitForTtsIdle(page);

  // 1개 값 커밋
  await fireStt(page, '12.3', 900);
  await waitForTtsIdle(page);

  // 세션 종료
  await page.locator('button[title="입력 종료"]').click();
  await page.locator('button[title="종료 확인"]').click();

  const healthLine = page.locator('[data-testid="session-health-line"]');
  await expect(healthLine).toBeVisible({ timeout: 15_000 });

  // IDB 로그 및 세션 행 검증
  const { events, sessionRow } = await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => res(req.result);
    });
    const logRows: { type?: string; extra?: string }[] = await new Promise((res) => {
      const req = db.transaction('logEvents', 'readonly').objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result as { type?: string; extra?: string }[]);
      req.onerror = () => res([]);
    });
    const sessRows: any[] = await new Promise((res) => {
      const req = db.transaction('sessions', 'readonly').objectStore('sessions').getAll();
      req.onsuccess = () => res(req.result);
      req.onerror = () => res([]);
    });
    db.close();
    return { events: logRows, sessionRow: sessRows[0]?.rows?.[0] };
  });

  const rawFailEvents = events.filter((e) => (e.extra ?? '').startsWith('clip_raw_save_failed:'));
  const clipFailEvents = events.filter((e) => (e.extra ?? '').startsWith('clip_save_failed:'));
  const healthEvents = events.filter((e) => (e.extra ?? '').startsWith('session_health:'));

  expect(rawFailEvents.length, 'clip_raw_save_failed는 정확히 1줄이어야 한다').toBe(1);
  expect(clipFailEvents.length, 'clip_save_failed는 0줄이어야 한다').toBe(0);

  // 본 클립 포인터 보존 검증: sessionRow.audioClips['m1']이 존재
  expect(sessionRow?.audioClips?.m1, '본 클립 포인터가 남아 있어야 한다').toBeTruthy();
  expect(sessionRow?.audioClips?.m1).not.toContain(':raw');

  // session_health saveErr=0 단언 (정확히 1줄)
  expect(healthEvents.length, 'session_health는 정확히 1줄이어야 한다').toBe(1);
  const healthExtra = healthEvents[0].extra ?? '';
  expect(healthExtra).toContain('saveErr=0');
  expect(healthExtra).toContain('discarded=0');

  // clip_summary 및 session_health 파싱을 통한 실제 검산식 단언
  // clip_stop_await = saved + failed + unreliable + saveErr + discarded
  const clipSummaryEvents = events.filter((e) => (e.extra ?? '').startsWith('clip_summary:'));
  expect(clipSummaryEvents.length, 'clip_summary는 정확히 1줄이어야 한다').toBe(1);
  const clipSummaryExtra = clipSummaryEvents[0].extra ?? '';
  const mSaved = clipSummaryExtra.match(/saved=(\d+)/);
  const mFailed = clipSummaryExtra.match(/failed=(\d+)/);
  expect(mSaved, 'clip_summary에 saved가 있어야 한다').toBeTruthy();
  expect(mFailed, 'clip_summary에 failed가 있어야 한다').toBeTruthy();
  const savedCount = Number(mSaved![1]);
  const failedCount = Number(mFailed![1]);

  const unreliableEvents = events.filter((e) => (e.extra ?? '').startsWith('clip_unreliable_summary:'));
  let unreliableCount = 0;
  if (unreliableEvents.length > 0) {
    const mUnreliable = (unreliableEvents[0].extra ?? '').match(/unreliable=(\d+)/);
    if (mUnreliable) unreliableCount = Number(mUnreliable[1]);
  }

  const mSaveErr = healthExtra.match(/saveErr=(\d+)/);
  const mDiscarded = healthExtra.match(/discarded=(\d+)/);
  expect(mSaveErr, 'session_health에 saveErr가 있어야 한다').toBeTruthy();
  expect(mDiscarded, 'session_health에 discarded가 있어야 한다').toBeTruthy();
  const saveErrCount = Number(mSaveErr![1]);
  const discardedCount = Number(mDiscarded![1]);

  const stopAwaitCount = events.filter((e) => (e.extra ?? '') === 'clip_stop_await').length;
  expect(stopAwaitCount).toBe(savedCount + failedCount + unreliableCount + saveErrCount + discardedCount);

  // K4 원장 잠금: 값 클립마다 raw_saved + raw_skipped + raw_save_failed = clip_saved + unreliable:muted
  const rawSavedEvents = events.filter((e) => (e.extra ?? '').startsWith('clip_raw_saved:'));
  const rawSkippedEvents = events.filter((e) => (e.extra ?? '').startsWith('clip_raw_skipped:'));
  const mutedEvents = events.filter((e) => (e.extra ?? '').startsWith('clip_unreliable:reason=muted'));

  expect(rawSavedEvents.length + rawSkippedEvents.length + rawFailEvents.length)
    .toBe(savedCount + mutedEvents.length);

  // 나온 clip_raw_skipped:reason= 값은 6개 중 하나이고 unknown이 아님
  const VALID_REASONS = new Set(['no_ctx', 'no_audio', 'decode_failed', 'no_segments', 'no_effect', 'over_trimmed']);
  for (const ev of rawSkippedEvents) {
    const m = (ev.extra ?? '').match(/reason=([a-z_]+)/);
    expect(m, 'clip_raw_skipped에 reason이 있어야 한다').toBeTruthy();
    const reason = m![1];
    expect(VALID_REASONS.has(reason), `유효하지 않은 reason: ${reason}`).toBe(true);
    expect(reason).not.toBe('unknown');
  }
});

test('ⓑ 본 클립 저장 실패 → clip_save_failed: 1줄, saveErr=1, 재연결 배너 미발생, 검산식 성립', async ({ page }) => {
  // IDBObjectStore.prototype.put 가로채기: 본 클립 키(raw 아닌 키)에서 throw
  await page.addInitScript(() => {
    (window as any).__failAudioPutPattern = 'main';

    const origPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: any, key?: any) {
      const targetKey = typeof key === 'string' ? key : '';
      if (this.name === 'audioClips' && (window as any).__failAudioPutPattern) {
        if ((window as any).__failAudioPutPattern === 'main' && targetKey && !targetKey.endsWith(':raw')) {
          throw new Error('intercepted audioClips put error for main: ' + targetKey);
        }
      }
      return origPut.apply(this, arguments as any);
    };

    const origCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (origCtx) {
      origCtx.prototype.decodeAudioData = async function () {
        const rate = 16000;
        const buf = this.createBuffer(1, 40000, rate);
        const d = buf.getChannelData(0);
        for (let i = 16000; i < 24000; i++) {
          d[i] = i % 2 === 0 ? 0.5 : -0.5;
        }
        return buf;
      };
    }
  });

  await boot(page, PHONE_402, {
    settings: MINI_SETTINGS as unknown as typeof AZ_SETTINGS,
    headers: MINI_HEADERS,
    sheetRows: MINI_ROWS,
  });
  await waitForTtsIdle(page);

  // 1개 값 커밋
  await fireStt(page, '14.5', 900);
  await waitForTtsIdle(page);

  // 🔴 재연결 배너(마이크 소실)가 뜨지 않아야 함 (K9)
  await expect(page.locator('[data-testid="mic-reconnect-btn"]')).toHaveCount(0);

  // 세션 종료
  await page.locator('button[title="입력 종료"]').click();
  await page.locator('button[title="종료 확인"]').click();

  const healthLine = page.locator('[data-testid="session-health-line"]');
  await expect(healthLine).toBeVisible({ timeout: 15_000 });

  // IDB 로그 및 세션 행 검증
  const { events } = await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => res(req.result);
    });
    const logRows: { type?: string; extra?: string }[] = await new Promise((res) => {
      const req = db.transaction('logEvents', 'readonly').objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result as { type?: string; extra?: string }[]);
      req.onerror = () => res([]);
    });
    db.close();
    return { events: logRows };
  });

  const clipFailEvents = events.filter((e) => (e.extra ?? '').startsWith('clip_save_failed:'));
  const healthEvents = events.filter((e) => (e.extra ?? '').startsWith('session_health:'));

  expect(clipFailEvents.length, 'clip_save_failed는 정확히 1줄이어야 한다').toBe(1);

  // session_health saveErr=1 단언
  expect(healthEvents.length).toBe(1);
  const healthExtra = healthEvents[0].extra ?? '';
  expect(healthExtra).toContain('saveErr=1');
  expect(healthExtra).toContain('discarded=0');

  // clip_summary는 정확히 1줄이어야 함 (failed=0, unreliable도 0 — 재연결 배너 미발생 확인)
  const clipSummaryEvents = events.filter((e) => (e.extra ?? '').startsWith('clip_summary:'));
  expect(clipSummaryEvents.length, 'clip_summary는 정확히 1줄이어야 한다').toBe(1);
  const clipSummaryExtra = clipSummaryEvents[0].extra ?? '';
  const mSaved = clipSummaryExtra.match(/saved=(\d+)/);
  const mFailed = clipSummaryExtra.match(/failed=(\d+)/);
  expect(mSaved, 'clip_summary에 saved가 있어야 한다').toBeTruthy();
  expect(mFailed, 'clip_summary에 failed가 있어야 한다').toBeTruthy();
  const savedCount = Number(mSaved![1]);
  const failedCount = Number(mFailed![1]);
  expect(failedCount).toBe(0);

  const unreliableEvents = events.filter((e) => (e.extra ?? '').startsWith('clip_unreliable_summary:'));
  expect(unreliableEvents.length, 'clip_unreliable_summary는 0줄이어야 한다').toBe(0);
  const unreliableCount = 0;

  // session_health 파싱
  const mSaveErr = healthExtra.match(/saveErr=(\d+)/);
  const mDiscarded = healthExtra.match(/discarded=(\d+)/);
  expect(mSaveErr, 'session_health에 saveErr가 있어야 한다').toBeTruthy();
  expect(mDiscarded, 'session_health에 discarded가 있어야 한다').toBeTruthy();
  const saveErrCount = Number(mSaveErr![1]);
  const discardedCount = Number(mDiscarded![1]);
  expect(saveErrCount).toBe(1);

  // 검산식 단언: clip_stop_await = saved + failed + unreliable + saveErr + discarded
  const stopAwaitCount = events.filter((e) => (e.extra ?? '') === 'clip_stop_await').length;
  expect(stopAwaitCount).toBe(savedCount + failedCount + unreliableCount + saveErrCount + discardedCount);
});

test('K4 processClip rawSkip 브라우저 단위 검증 (no_audio, decode_failed, no_ctx)', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  const res1 = await page.evaluate(async () => {
    const { processClip } = await import('/src/lib/audioTrim.ts');
    const emptyBlob = new Blob([]);
    const corruptBlob = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], { type: 'audio/webm' });
    const r1 = await processClip(emptyBlob);
    const r2 = await processClip(corruptBlob);
    return { r1Skip: r1.rawSkip, r2Skip: r2.rawSkip };
  });
  expect(res1.r1Skip).toBe('no_audio');
  expect(res1.r2Skip).toBe('decode_failed');

  // 새 페이지에서 AudioContext 제거 후 no_ctx 검증
  const pageNoCtx = await page.context().newPage();
  await pageNoCtx.addInitScript(() => {
    delete (window as any).AudioContext;
    delete (window as any).webkitAudioContext;
  });
  await pageNoCtx.goto(BASE, { waitUntil: 'domcontentloaded' });
  const resNoCtx = await pageNoCtx.evaluate(async () => {
    const { processClip } = await import('/src/lib/audioTrim.ts');
    const dummyBlob = new Blob([new Uint8Array([10, 20, 30])], { type: 'audio/webm' });
    const r = await processClip(dummyBlob);
    return r.rawSkip;
  });
  expect(resNoCtx).toBe('no_ctx');
  await pageNoCtx.close();
});

test('K4 명령 클립 :raw 실패 분리 — :cmd<n>:raw put 실패 시 clip_raw_save_failed 1줄, clip_cmd_save_failed 0줄, 본체 저장', async ({ page }) => {
  await page.addInitScript(() => {
    const origPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: any, key?: any) {
      const targetKey = typeof key === 'string' ? key : '';
      if (this.name === 'audioClips' && targetKey.includes(':cmd') && targetKey.endsWith(':raw')) {
        throw new Error('intercepted cmd raw put error: ' + targetKey);
      }
      return origPut.apply(this, arguments as any);
    };

    const origCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (origCtx) {
      origCtx.prototype.decodeAudioData = async function () {
        const rate = 16000;
        const buf = this.createBuffer(1, 40000, rate);
        const d = buf.getChannelData(0);
        for (let i = 16000; i < 24000; i++) {
          d[i] = i % 2 === 0 ? 0.5 : -0.5;
        }
        return buf;
      };
    }
  });

  const TWO_COLUMNS = [
    { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
    { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
    { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 1 }, sampleKey: true },
    { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
    { id: 'm2', name: '측정항목02', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  ];
  const TWO_SETTINGS = {
    ...AZ_SETTINGS,
    state: { ...AZ_SETTINGS.state, columns: TWO_COLUMNS, totalRows: 1, sessionAutoLabel: 'clip-ledger' },
  };
  const TWO_HEADERS = ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02'];
  const TWO_ROWS = [[PREV_ROUND, '이원창', '1', '100.0', '100.0']];

  await boot(page, PHONE_402, {
    settings: TWO_SETTINGS as unknown as typeof AZ_SETTINGS,
    headers: TWO_HEADERS,
    sheetRows: TWO_ROWS,
  });
  await waitForTtsIdle(page);

  // 1. 값 커밋 (m1)
  await fireStt(page, '12.3', 900);
  await waitForTtsIdle(page);

  // 2. 직접 수정 ("수정 15.5") 발화 -> m2 대기 중 발화되어 명령 클립 생성
  await fireStt(page, '수정 15.5', 900);
  await waitForTtsIdle(page);

  // 3. 세션 종료
  await page.locator('button[title="입력 종료"]').click();
  await page.locator('button[title="종료 확인"]').click();
  await expect(page.locator('[data-testid="session-health-line"]')).toBeVisible({ timeout: 15_000 });

  const events = await page.evaluate(async () => {
    const { logger } = await import('/src/lib/logger.ts');
    return logger.getAll();
  });

  // 단언:
  // - clip_raw_save_failed: 1줄 (kind: 'command')
  // - clip_cmd_save_failed: 0줄
  // - clip_preserved: 1줄 이상 (kind: 'command')
  const cmdRawFails = events.filter((e) => (e.extra ?? '').startsWith('clip_raw_save_failed:') && (e as any).kind === 'command');
  const cmdSaveFails = events.filter((e) => (e.extra ?? '').startsWith('clip_cmd_save_failed:'));
  const cmdPreserved = events.filter((e) => (e.extra ?? '') === 'clip_preserved' && (e as any).kind === 'command');

  expect(cmdRawFails.length, '명령 클립 :raw 실패 계측이 1줄이어야 함').toBe(1);
  expect(cmdSaveFails.length, '명령 클립 본체 저장 실패는 0줄이어야 함').toBe(0);
  expect(cmdPreserved.length, '명령 클립 본체는 저장되어야 함').toBeGreaterThanOrEqual(1);
});
