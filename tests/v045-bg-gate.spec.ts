/**
 * v0.45.0 WP-2 [D1] — 장기 임계(10분)·paused 화면끔 재시작 게이트.
 *
 * 오라클:
 *   P  정책 리터럴 — 유지 집합 {active, paused, complete}·임계 600000ms(Q2·Q3 민구 확정).
 *      값을 바꾸려면 이 테스트 diff에 드러나야 한다([TEAMOPS-38] — 독립 리터럴 검증).
 *   T  임계 도달 — hidden(유지) 중 임계가 지나면 ①음성 고지 ②기기 알림(notify_perm — 권한 없으면
 *      no_permission으로 정직하게) ③bg_keep 요약 ④완전 정지(dispose — 트랙 ended. 물림 예방
 *      선-정리: preroll AudioContext detach, WebKit bug 253951 클래스).
 *   R  임계 후 복귀 — 자동 재획득(새 gUM 트랙) + BG_RESUME 안내 + 복귀 브리핑 + 값 입력 재개.
 *   Q3 paused 화면끔 — hidden에도 인식기가 살아 "재시작" 음성이 통하고, 화면 끈 채 값이 들어간다.
 *
 * 임계값은 `window.__bgOffMsForTest` 심으로만 줄인다(__micSettleSkipForTest 계보 — 시퀀스·계측
 * 계약은 그대로). 기본값 10분은 P가 리터럴로 고정한다.
 */
import { test, expect, type Page } from '@playwright/test';
import { installVoiceMocks, fireStt, waitForTtsIdle, ttsLog } from './fixtures/stt';
import { BASE } from './baseUrl';
import { BG_KEEP_PHASES, LONG_BACKGROUND_OFF_MS, shouldKeepInBackground } from '../src/lib/backgroundSessionPolicy';

test.setTimeout(120_000);

const STORE_KEY = 'agri-voicenote-settings-v3';
const BG_MSG = '자리를 비운 동안 입력이 중지됐습니다. 다시 시작합니다.';
const THRESHOLD_MSG = '10분 동안 자리를 비워 음성 입력을 정지합니다. 입력한 값은 저장되어 있습니다.';
const BRIEFING_RETURN = '조사나무 1. 다음, 횡경.';
const BRIEFING_RESUME = '조사나무 1. 다음.';

const SETTINGS = {
  state: {
    googleConnected: false, userEmail: null, sheet: null,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_BGGATE_1/edit', sheetTab: 'Sheet1',
    columnsSheetId: 'SHEET_BGGATE_1', columnsSheetTab: 'Sheet1',
    availableSheets: [], manualMode: false,
    columns: [
      { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 3 } },
      { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
      { id: 'c9', name: '종경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
    ],
    tableGenerated: true, totalRows: 3,
    ttsRate: 1.05, sessionLabelColId: null, sessionAutoLabel: 'bg-gate', noisyMode: false, preferredVoiceName: '',
  },
  version: 13,
};

const FAKE_MIC_SCRIPT = `
(function() {
  window.__micSettleSkipForTest = true;
  window.__micTracks = [];
  var ac = null;
  var real = navigator.mediaDevices && navigator.mediaDevices.getUserMedia
    ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices) : null;
  if (!navigator.mediaDevices) return;
  navigator.mediaDevices.getUserMedia = function(constraints) {
    if (!constraints || !constraints.audio) return real ? real(constraints) : Promise.reject(new Error('no audio'));
    try {
      if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
      var dest = ac.createMediaStreamDestination();
      var t = dest.stream.getAudioTracks()[0];
      window.__micTracks.push(t);
      return Promise.resolve(dest.stream);
    } catch (e) {
      return Promise.reject(e);
    }
  };
})();
`;

async function loadLogEvents(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db || !db.objectStoreNames.contains('logEvents')) return [];
    return new Promise<Array<{ type: string; parsed?: string; extra?: string }>>((res) => {
      const tx = db.transaction('logEvents', 'readonly');
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result as Array<{ type: string; parsed?: string; extra?: string }>);
      req.onerror = () => res([]);
    });
  });
}

async function bgMicExtras(page: Page): Promise<string[]> {
  return (await loadLogEvents(page)).filter((e) => e.parsed === 'bg_mic').map((e) => e.extra ?? '');
}

async function trackStates(page: Page): Promise<{ count: number; last: string | null }> {
  return page.evaluate(() => {
    const tracks = (window as unknown as { __micTracks?: MediaStreamTrack[] }).__micTracks ?? [];
    return { count: tracks.length, last: tracks.length ? tracks[tracks.length - 1].readyState : null };
  });
}

async function setVisibility(page: Page, state: 'hidden' | 'visible') {
  await page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { value: s, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

async function waitForActiveChip(page: Page, colName: string, timeout = 6000) {
  await page.waitForFunction(
    (name) => {
      const chip = document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
      return (chip?.dataset.colName ?? '').includes(String(name));
    },
    colName,
    { timeout },
  );
}

async function boot(page: Page) {
  await page.addInitScript({ content: FAKE_MIC_SCRIPT });
  await installVoiceMocks(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ s, storeKey }) => {
      localStorage.clear();
      localStorage.setItem(storeKey, JSON.stringify(s));
      indexedDB.deleteDatabase('agri-voicenote');
    },
    { s: SETTINGS, storeKey: STORE_KEY },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(300);
  await page.locator('text=음성 입력 시작').first().click();
  await page.waitForTimeout(700);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
  await waitForActiveChip(page, '횡경');
  await waitForTtsIdle(page);
}

// ─── P: 정책 리터럴 — 값을 바꾸면 이 diff에 드러난다 ─────────────────────────────────────
test('P — 유지 집합 {active,paused,complete} · 임계 600000ms (Q2·Q3 민구 확정 리터럴)', () => {
  expect([...BG_KEEP_PHASES]).toEqual(['active', 'paused', 'complete']);
  expect(LONG_BACKGROUND_OFF_MS).toBe(600_000);
  expect(shouldKeepInBackground('active')).toBe(true);
  expect(shouldKeepInBackground('paused')).toBe(true);
  expect(shouldKeepInBackground('complete')).toBe(true);
  expect(shouldKeepInBackground('ready')).toBe(false);
  expect(shouldKeepInBackground('stopping')).toBe(false);
  expect(shouldKeepInBackground('done')).toBe(false);
});

// ─── T: 임계 도달 — 고지 → 알림 → 요약 → 완전 정지(선-정리) ──────────────────────────────
test('T — hidden(유지) 중 임계 도달: 음성 고지·notify_perm·bg_keep·트랙 완전 정지(dispose)', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { (window as unknown as { __bgOffMsForTest?: number }).__bgOffMsForTest = 1200; });

  await setVisibility(page, 'hidden');
  await expect.poll(() => bgMicExtras(page), { timeout: 4000 })
    .toEqual(['edge=enter,stt=kept,capture=kept']);

  // 임계(심 1.2초) 도달 — 시퀀스 완료를 threshold 바이트로 기다린다.
  await expect.poll(() => bgMicExtras(page), { timeout: 15_000 })
    .toEqual(['edge=enter,stt=kept,capture=kept', 'edge=threshold,stt=stopped,capture=off']);

  // ① 음성 고지(best-effort — 목 TTS는 hidden에도 적재된다).
  expect((await ttsLog(page)).filter((t) => t === THRESHOLD_MSG)).toHaveLength(1);
  // ② 기기 알림 — 이 환경은 권한이 없다. 조건 거짓을 정직하게 남긴다([FG-RETURN-LOG-1]).
  const events = await loadLogEvents(page);
  expect(events.filter((e) => e.extra === 'notify_perm:src=threshold,result=no_permission')).toHaveLength(1);
  // ③ 유지 구간 요약이 임계 시점에 소비된다(복귀 때 이중 방출 없음).
  const keeps = events.filter((e) => e.extra?.startsWith('bg_keep:'));
  expect(keeps).toHaveLength(1);
  expect(keeps[0].extra).toMatch(/^bg_keep:bg_s=\d+,finals=0,stt=ctrl,track=live$/);
  // ④ 완전 정지 — dispose = 물림 예방 선-정리. 트랙이 ended다(유지 경로의 enabled 토글과 다르다).
  expect((await trackStates(page)).last).toBe('ended');
});

// ─── T2: 임계 진행 중 복귀 경합 — 정지가 철회되고 세션이 산 채 유지된다(리뷰 C1 반증쌍) ─────
test('T2 — 임계 시퀀스 진행 중 복귀하면 정지가 철회된다: threshold 미방출·트랙 생존·입력 계속', async ({ page }) => {
  // 리뷰 C1(critical): 종전엔 await 사슬(고지 TTS~persist) 중 복귀해도 잔여 continuation이
  // 포그라운드에서 STT·레코더를 죽였다. 세대 가드(bgOffGenRef) + 단계별 중단 검사의 반증쌍 —
  // 이 가드를 지우면 threshold 바이트가 방출되고 트랙이 ended가 되어 이 테스트가 red다.
  await boot(page);
  await page.evaluate(() => { (window as unknown as { __bgOffMsForTest?: number }).__bgOffMsForTest = 1000; });
  const before = (await trackStates(page)).count;

  await setVisibility(page, 'hidden');
  // 타이머 발화 직후(고지 TTS 목 200ms 창 안) 복귀 — 알림 탭 동선의 재현.
  await page.waitForTimeout(1100);
  await setVisibility(page, 'visible');

  // 철회 확정 대기: 시퀀스가 완주했다면 3초 안에 threshold 바이트가 남는다 — 없어야 한다.
  await page.waitForTimeout(3000);
  expect((await bgMicExtras(page)).filter((x) => x.startsWith('edge=threshold')),
    '복귀가 이겼으면 임계 정지는 철회된다').toHaveLength(0);
  // 레코더는 dispose되지 않았다(재획득도 불필요 — 트랙 수 불변·live).
  const tracks = await trackStates(page);
  expect(tracks.count, '재획득이 필요 없었어야 한다(dispose 미실행)').toBe(before);
  expect(tracks.last).toBe('live');

  // 세션이 산 채다 — 값 입력이 그대로 계속된다(어느 인터리빙이든 이게 최종 계약이다).
  await waitForTtsIdle(page);
  await fireStt(page, '33.3', 800);
  await expect.poll(
    async () => (await loadLogEvents(page)).filter((e) => e.type === 'value').length,
    { timeout: 4000 },
  ).toBe(1);
});

// ─── R: 임계 후 복귀 — 자동 재획득 + 안내 + 브리핑 + 재개 ────────────────────────────────
test('R — 임계 정지 후 복귀: 새 트랙 재획득 + BG_RESUME 안내 + 브리핑 + 값 입력 재개', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { (window as unknown as { __bgOffMsForTest?: number }).__bgOffMsForTest = 1200; });
  const before = (await trackStates(page)).count;

  await setVisibility(page, 'hidden');
  await expect.poll(async () => (await bgMicExtras(page)).some((x) => x.startsWith('edge=threshold')), { timeout: 15_000 }).toBe(true);

  await setVisibility(page, 'visible');

  // 복귀 재획득 — 새 gUM 트랙이 늘고 live다(실패 시 v0.44.1 경보 경로는 실기기 게이트).
  await expect.poll(async () => (await trackStates(page)).count, { timeout: 5000 }).toBe(before + 1);
  expect((await trackStates(page)).last).toBe('live');
  // 정지가 실제로 있었으므로 BG_RESUME 안내가 1회 나간다(재개 성공 onStart) + 브리핑이 잇따른다.
  await expect.poll(async () => (await ttsLog(page)).filter((t) => t === BG_MSG).length, { timeout: 5000 }).toBe(1);
  await expect.poll(async () => (await ttsLog(page)).filter((t) => t === BRIEFING_RETURN).length, { timeout: 5000 }).toBe(1);
  await expect.poll(() => bgMicExtras(page), { timeout: 4000 }).toEqual([
    'edge=enter,stt=kept,capture=kept',
    'edge=threshold,stt=stopped,capture=off',
    'edge=return,stt=restored,capture=noop',
  ]);

  // 값 입력이 실제로 재개된다(복원이 말뿐이 아님).
  await waitForTtsIdle(page);
  await fireStt(page, '33.3', 600);
  await expect.poll(
    async () => (await loadLogEvents(page)).filter((e) => e.type === 'value').length,
    { timeout: 4000 },
  ).toBe(1);
});

// ─── Q3: paused 화면끔 — 인식기 유지 → "재시작" 음성이 hidden에서 통한다 ─────────────────────
test('Q3 — 일시정지 후 화면을 꺼도(재시작 음성 명령) 세션이 재개되고 화면 끈 채 값이 들어간다', async ({ page }) => {
  await boot(page);

  // 음성으로 일시정지(레코더는 dispose되지만 인식기는 유지 — pause 계약).
  await fireStt(page, '일시정지', 800);
  await expect.poll(async () => (await ttsLog(page)).some((t) => t === '일시정지됨.'), { timeout: 4000 }).toBe(true);

  // 화면끔(hidden) — paused도 유지 집합이다(Q3 민구 확정: 일시정지 중 마이크 유지 OK).
  // 리뷰 C5 바이트 정직화 — kept는 "돌던 것을 유지"다. pause()가 레코더를 이미 비웠으므로
  // capture는 noop(유지할 캡처가 없었다는 정직한 기록), 살아 있는 인식기만 stt=kept.
  await setVisibility(page, 'hidden');
  await expect.poll(async () => (await bgMicExtras(page)).at(-1), { timeout: 4000 })
    .toBe('edge=enter,stt=kept,capture=noop');

  // 화면 끈 채 "재시작" — 인식기가 살아 있어야 통한다.
  await fireStt(page, '재시작', 1000);
  await expect.poll(async () => (await ttsLog(page)).some((t) => t === '재시작.'), { timeout: 5000 }).toBe(true);
  // 재시작 브리핑(WP-3, includeNext 없음 — announceField가 항목명을 잇는다).
  await expect.poll(async () => (await ttsLog(page)).filter((t) => t === BRIEFING_RESUME).length, { timeout: 5000 }).toBe(1);

  // 화면 끈 채 값 입력 — E2'(검은 화면 진행)의 전제 조건이다.
  await waitForTtsIdle(page);
  await fireStt(page, '33.3', 800);
  await expect.poll(
    async () => (await loadLogEvents(page)).filter((e) => e.type === 'value').length,
    { timeout: 4000 },
  ).toBe(1);
});
