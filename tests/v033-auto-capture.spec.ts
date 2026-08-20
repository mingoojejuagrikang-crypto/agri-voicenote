/**
 * v0.33.0 항목10-B (Vance) — 입력화면 자동 캡처: 트리거 매핑·스로틀·상한(순수) + IDB cascade(e2e).
 *
 *  [node] captureTriggerFor — 민구 확정 트리거(커밋 echo·이상치 알람·재질문·행 이동·micLost·
 *         pause/resume·세션 시작/종료)만 매핑, 그 외 null.
 *  [node] createAutoCapture — 2초 스로틀, 세션당 100장 상한(초과 시 capture_cap_reached 1회),
 *         토글 off/세션 문맥 없음 스킵, 키 `${sessionId}:${ts}:${trigger}`, capture_saved 계측(ms).
 *  [e2e]  세션 삭제 시 screenshots 스토어 cascade(다른 세션 것은 보존).
 *
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다(수동 기동 불필요, [ORCH-27]).
 */
import { test, expect, type Page } from '@playwright/test';
import {
  captureTriggerFor,
  createAutoCapture,
  CAPTURE_THROTTLE_MS,
  CAPTURE_SESSION_CAP,
} from '../src/lib/screenshot';
import type { LogEntry } from '../src/lib/logger';

import { BASE } from './baseUrl';

// ─── [node] 트리거 매핑 ──────────────────────────────────────────────────────

test('[node] captureTriggerFor — 확정 트리거만 매핑', () => {
  expect(captureTriggerFor({ type: 'value' })).toBe('commit');
  expect(captureTriggerFor({ type: 'trend', extra: 'trend_alert_fired:trigger=pct' })).toBe('anomaly');
  expect(captureTriggerFor({ type: 'trend', extra: 'trend_skip:no_index' })).toBeNull();
  expect(captureTriggerFor({ type: 'stt_parse_failed' })).toBe('reask');
  expect(captureTriggerFor({ type: 'stt_rejected_low_confidence' })).toBe('reask');
  expect(captureTriggerFor({ type: 'stt_rejected_ambiguous_syllable' })).toBe('reask');
  expect(captureTriggerFor({ type: 'command', parsed: 'jump', extra: 'voice:1->2' })).toBe('rowmove');
  expect(captureTriggerFor({ type: 'command', parsed: 'pause', extra: 'phase:touch' })).toBe('pause');
  expect(captureTriggerFor({ type: 'command', parsed: 'resume', extra: 'phase:voice' })).toBe('resume');
  expect(captureTriggerFor({ type: 'clip', extra: 'mic_lost:ended' })).toBe('miclost');
  expect(captureTriggerFor({ type: 'session', extra: 'start' })).toBe('session_start');
  expect(captureTriggerFor({ type: 'session', extra: 'stop' })).toBe('session_stop');
  // 비트리거: 일반 stt/tts/clip/app/명령·데이터 편집은 캡처하지 않는다.
  expect(captureTriggerFor({ type: 'stt' })).toBeNull();
  expect(captureTriggerFor({ type: 'tts' })).toBeNull();
  expect(captureTriggerFor({ type: 'clip', extra: 'clip_saved:1234' })).toBeNull();
  expect(captureTriggerFor({ type: 'app', extra: 'capture_saved:commit:100' })).toBeNull();
  expect(captureTriggerFor({ type: 'command', parsed: 'data_edit', extra: 'touch' })).toBeNull();
  expect(captureTriggerFor({ type: 'command', parsed: 'confirm' })).toBeNull();
});

// ─── [node] 컨트롤러(스로틀/상한/토글) ───────────────────────────────────────

interface Harness {
  controller: ReturnType<typeof createAutoCapture>;
  saved: { key: string; size: number }[];
  logged: { extra?: string; durationMs?: number; sessionId?: string }[];
  clock: { t: number };
  enabled: { v: boolean };
  captureCalls: { n: number };
}

function makeHarness(): Harness {
  const saved: Harness['saved'] = [];
  const logged: Harness['logged'] = [];
  const clock = { t: 100_000 };
  const enabled = { v: true };
  const captureCalls = { n: 0 };
  const controller = createAutoCapture({
    isEnabled: () => enabled.v,
    capture: async () => {
      captureCalls.n += 1;
      return new Blob([new Uint8Array(64)], { type: 'image/jpeg' });
    },
    save: async (key, blob) => { saved.push({ key, size: blob.size }); },
    now: () => clock.t,
    schedule: (fn) => fn(), // 테스트: 동기 실행
    log: (e) => logged.push(e as Harness['logged'][number]),
  });
  return { controller, saved, logged, clock, enabled, captureCalls };
}

const commitEntry = (sessionId: string): LogEntry => ({ ts: 0, type: 'value', sessionId });

// createAutoCapture.onLogEntry는 schedule→async 캡처를 태우므로 완료를 마이크로태스크 flush로 기다린다.
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

test('[node] 컨트롤러 — 트리거 → 캡처·저장·계측(키 규약 + 소요 ms)', async () => {
  const h = makeHarness();
  h.controller.onLogEntry(commitEntry('sess_a'));
  await flush();
  expect(h.saved).toHaveLength(1);
  expect(h.saved[0].key).toBe(`sess_a:${h.clock.t}:commit`);
  const savedLog = h.logged.find((l) => l.extra?.startsWith('capture_saved:'));
  expect(savedLog).toBeTruthy();
  expect(savedLog!.extra).toBe('capture_saved:commit:64');
  expect(typeof savedLog!.durationMs).toBe('number');
  expect(savedLog!.sessionId).toBe('sess_a');
});

test('[node] 컨트롤러 — 2초 스로틀: 창 안 후속 트리거는 스킵, 창 지나면 재개', async () => {
  const h = makeHarness();
  h.controller.onLogEntry(commitEntry('sess_a'));
  await flush();
  h.clock.t += CAPTURE_THROTTLE_MS - 1; // 1999ms 후 — 스킵
  h.controller.onLogEntry(commitEntry('sess_a'));
  await flush();
  expect(h.saved).toHaveLength(1);
  h.clock.t += 1; // 정확히 2000ms — 재개
  h.controller.onLogEntry(commitEntry('sess_a'));
  await flush();
  expect(h.saved).toHaveLength(2);
});

test('[node] 컨트롤러 — 세션당 상한 100장 + capture_cap_reached 1회만', async () => {
  const h = makeHarness();
  for (let i = 0; i < CAPTURE_SESSION_CAP + 10; i++) {
    h.controller.onLogEntry(commitEntry('sess_a'));
    await flush();
    h.clock.t += CAPTURE_THROTTLE_MS; // 스로틀 통과
  }
  expect(h.saved).toHaveLength(CAPTURE_SESSION_CAP);
  expect(h.controller.countFor('sess_a')).toBe(CAPTURE_SESSION_CAP);
  const capLogs = h.logged.filter((l) => l.extra?.startsWith('capture_cap_reached:'));
  expect(capLogs).toHaveLength(1);
  // 상한은 세션 단위 — 다른 세션은 계속 캡처된다.
  h.controller.onLogEntry(commitEntry('sess_b'));
  await flush();
  expect(h.saved).toHaveLength(CAPTURE_SESSION_CAP + 1);
});

test('[node] 컨트롤러 — 토글 off/세션 문맥 없음(__app__)/비트리거는 캡처 0', async () => {
  const h = makeHarness();
  h.enabled.v = false;
  h.controller.onLogEntry(commitEntry('sess_a'));
  await flush();
  expect(h.captureCalls.n).toBe(0);

  h.enabled.v = true;
  h.controller.onLogEntry({ ts: 0, type: 'value', sessionId: '__app__' });
  h.controller.onLogEntry({ ts: 0, type: 'value' }); // sessionId 없음
  h.controller.onLogEntry({ ts: 0, type: 'stt', sessionId: 'sess_a' }); // 비트리거
  await flush();
  expect(h.captureCalls.n).toBe(0);
  expect(h.saved).toHaveLength(0);
});

test('[node] 컨트롤러 — 캡처 실패(null blob)는 non-fatal: capture_failed 로깅 후 계속', async () => {
  const saved: Harness['saved'] = [];
  const logged: Harness['logged'] = [];
  const clock = { t: 100_000 };
  let fail = true;
  const controller = createAutoCapture({
    isEnabled: () => true,
    capture: async () => (fail ? null : new Blob([new Uint8Array(8)], { type: 'image/jpeg' })),
    save: async (key, blob) => { saved.push({ key, size: blob.size }); },
    now: () => clock.t,
    schedule: (fn) => fn(),
    log: (e) => logged.push(e as Harness['logged'][number]),
  });
  controller.onLogEntry(commitEntry('sess_a'));
  await flush();
  expect(saved).toHaveLength(0);
  expect(logged.some((l) => l.extra === 'capture_failed:commit:null_blob')).toBe(true);
  // 실패 후에도 다음 트리거는 정상 진행.
  fail = false;
  clock.t += CAPTURE_THROTTLE_MS;
  controller.onLogEntry(commitEntry('sess_a'));
  await flush();
  expect(saved).toHaveLength(1);
});

// ─── [e2e] screenshots 스토어 cascade ────────────────────────────────────────

async function seedForCascade(page: Page) {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('IDB open blocked'));
    });
    const columns = [
      { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 } },
      { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
    ];
    const mkSession = (id: string, date: string) => ({
      id, date, label: `캡처 ${id}`, columns,
      rows: [{ index: 1, values: { c6: '1', c8: '35.1' }, complete: true }],
      completedRows: 1, syncedRows: 0,
      startedAt: Date.now() - 60_000, finishedAt: Date.now() - 30_000,
    });
    const jpeg = { buf: new Uint8Array([255, 216, 255]).buffer, type: 'image/jpeg' };
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(['sessions', 'screenshots'], 'readwrite');
      tx.objectStore('sessions').put(mkSession('sess_cap_del', '2026-07-11'));
      tx.objectStore('sessions').put(mkSession('sess_cap_keep', '2026-07-12'));
      tx.objectStore('screenshots').put(jpeg, 'sess_cap_del:1700000000001:commit');
      tx.objectStore('screenshots').put(jpeg, 'sess_cap_del:1700000000002:anomaly');
      tx.objectStore('screenshots').put(jpeg, 'sess_cap_keep:1700000000003:commit');
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  });
}

async function readScreenshotKeys(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const keys = await new Promise<string[]>((res, rej) => {
      const tx = db.transaction('screenshots', 'readonly');
      const req = tx.objectStore('screenshots').getAllKeys();
      req.onsuccess = () => res(req.result as string[]);
      req.onerror = () => rej(req.error);
    });
    db.close();
    return keys;
  });
}

test('[e2e] 세션 삭제 → screenshots cascade(해당 세션만, 타 세션 보존)', async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await seedForCascade(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await page.locator('[data-testid="tab-data"]').click();
  await page.waitForTimeout(400);

  // sess_cap_del 카드의 삭제(휴지통) → 확인.
  const delCard = page.locator('button', { hasText: '캡처 sess_cap_del' });
  await expect(delCard).toBeVisible({ timeout: 3000 });
  await delCard.locator('xpath=following-sibling::button[@title="세션 삭제"]').click();
  await page.waitForTimeout(300);
  await page.locator('button:has-text("삭제")').last().click();
  await page.waitForTimeout(600);

  const keys = (await readScreenshotKeys(page)).sort();
  expect(keys).toEqual(['sess_cap_keep:1700000000003:commit']);
  console.log('✓ cascade: sess_cap_del 캡처 2장 삭제, sess_cap_keep 보존');
});
