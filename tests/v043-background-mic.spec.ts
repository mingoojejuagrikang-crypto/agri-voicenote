/**
 * v0.45.0 WP-2 [D1] — **세션-활성 게이트**(hidden 정책) 회귀. (v0.43.0 #4 "이탈-중지"의 재검토 실행)
 *
 * 역사: v0.43.0 #4는 "화면끔·앱이탈 둘 다 중지"(민구 지시 07-31)였다. 08-05 실사용 정정으로
 *   그 지시의 원 의도가 **"세션 밖에서 돌지 마라"**였음이 확인됐다([MIC-BG-STOP-1] 재검토 갈래) —
 *   세션 안까지 정지한 것은 과잉 교정이었고, 복귀마다의 인식기 재생성 + BT HFP 재협상 왕복이
 *   F15("한 번에 안 붙어")의 구조적 근원 후보였다(플랜 §1-③, 세션7 실측 6회).
 *
 * 🔴 이 파일의 A·B·C·F는 **v0.43.0 오라클의 의도적 뒤집기**다(정당 파손 — v0.45.0 [D1]):
 *   A' 진입(세션 중) — 트랙·STT를 **유지**한다. 배경 발화가 **커밋된다**(화면 끄고 진행 — E2' 전제).
 *   B' 복귀(유지 사이클) — 복원할 것이 없다(stt=noop). BG_RESUME 안내 **0회**, 대신 복귀
 *      브리핑(F14: "…​. 다음, <항목>.")이 나간다.
 *   C' 모달 닫기 — 안내·브리핑 모두 없다(종전 계약 유지 + 브리핑 누출 없음).
 *   D  세션 미가동(ready) 왕복 — **종전 그대로** 정지 경로의 noop(세션 밖 = 확실히 정지 축).
 *   E  백그라운드 중 세션 경계 — **종전 그대로** 안내 예약 폐기.
 *   F' 유지 구간 생존 요약(bg_keep) — hidden 중 final 수·트랙 상태가 복귀 시 1건으로 남는다(WP-1④).
 *
 * 장기 임계(10분)·paused 재시작·임계 후 재획득은 tests/v045-bg-gate.spec.ts가 잰다.
 *
 * ⛔ 유지 경로는 트랙을 **만지지 않는다**(enabled=true 그대로). 정지 경로(세션 밖·임계)만
 *   enabled 토글/dispose를 쓴다([IOS-5]: track.stop()은 임계 OFF의 dispose에서만 — 재획득 경로 동반).
 *
 * 🔑 가짜 마이크: AudioContext MediaStreamDestination의 **진짜 MediaStreamTrack** 주입(아래 스크립트).
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다([ORCH-27]).
 */
import { test, expect, type Page } from '@playwright/test';
import { installVoiceMocks, fireStt, waitForTtsIdle, ttsLog } from './fixtures/stt';
import { BASE } from './baseUrl';

test.setTimeout(120_000);

const STORE_KEY = 'agri-voicenote-settings-v3';

/** 정지 사이클 복원 시에만 나가는 안내(useVoiceSession BG_RESUME_MESSAGE와 글자 일치). */
const BG_MSG = '자리를 비운 동안 입력이 중지됐습니다. 다시 시작합니다.';
/** v0.45.0 WP-3 — 복귀 브리핑(Q5 형식). row1·값 미입력 상태의 기대 문장. */
const BRIEFING_ROW1 = '조사나무 1. 다음, 횡경.';

const SETTINGS = {
  state: {
    googleConnected: false, userEmail: null, sheet: null,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_BGMIC_1/edit', sheetTab: 'Sheet1',
    columnsSheetId: 'SHEET_BGMIC_1', columnsSheetTab: 'Sheet1',
    availableSheets: [], manualMode: false,
    columns: [
      { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 3 } },
      { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
      { id: 'c9', name: '종경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
    ],
    tableGenerated: true, totalRows: 3,
    ttsRate: 1.05, sessionLabelColId: null, sessionAutoLabel: 'bg-mic', noisyMode: false, preferredVoiceName: '',
  },
  version: 12,
};

/** 🔑 진짜 MediaStreamTrack을 돌려주는 가짜 마이크. 호출마다 새 destination을 만들어
 *  앱의 `stopAllTracks(dispose)`가 다음 획득을 오염시키지 않게 한다. */
const FAKE_MIC_SCRIPT = `
(function() {
  window.__micSettleSkipForTest = true; // F18 픽스처 우회 — 시작 시 1초 마이크 정착 생략(우회 심 오라클: v0440-c8-flow.spec.ts)
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

/** `bg_mic` 이벤트의 extra 목록(방출 순서 그대로). */
async function bgMicExtras(page: Page): Promise<string[]> {
  return (await loadLogEvents(page))
    .filter((e) => e.parsed === 'bg_mic')
    .map((e) => e.extra ?? '');
}

/** BG_RESUME 안내가 몇 번 발화됐는가. */
async function announceCount(page: Page): Promise<number> {
  return (await ttsLog(page)).filter((t) => t === BG_MSG).length;
}

/** 복귀 브리핑이 몇 번 발화됐는가(WP-3). */
async function briefingCount(page: Page): Promise<number> {
  return (await ttsLog(page)).filter((t) => t === BRIEFING_ROW1).length;
}

/** 첫 번째 마이크 트랙의 `enabled`. 트랙이 없으면 null(= 관찰 불가, false와 구분한다). */
async function trackEnabled(page: Page): Promise<boolean | null> {
  return page.evaluate(() => {
    const tracks = (window as unknown as { __micTracks?: MediaStreamTrack[] }).__micTracks ?? [];
    return tracks.length ? tracks[tracks.length - 1].enabled : null;
  });
}

/** Playwright에는 탭 숨김 API가 없다 — visibilityState를 덮고 이벤트를 직접 디스패치한다. */
async function setVisibility(page: Page, state: 'hidden' | 'visible') {
  await page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { value: s, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

async function clickMounted(page: Page, selector: string): Promise<void> {
  await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!(el instanceof HTMLElement)) throw new Error(`mounted control not found: ${s}`);
    el.click();
  }, selector);
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

/** 세션을 시작하지 않고 입력탭까지만 간다(F18: 이 상태에서 레코더·트랙은 없다). */
async function bootIdle(page: Page, settings = SETTINGS) {
  await page.addInitScript({ content: FAKE_MIC_SCRIPT });
  await installVoiceMocks(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ s, storeKey }) => {
      localStorage.clear();
      localStorage.setItem(storeKey, JSON.stringify(s));
      indexedDB.deleteDatabase('agri-voicenote');
    },
    { s: settings, storeKey: STORE_KEY },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(300);
}

async function startSession(page: Page) {
  await page.locator('text=음성 입력 시작').first().click();
  await page.waitForTimeout(700);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
  await waitForActiveChip(page, '횡경');
  await waitForTtsIdle(page);
}

async function boot(page: Page, settings = SETTINGS) {
  await bootIdle(page, settings);
  await startSession(page);
}

// ─── A': 진입(세션 중) — [D1] 유지. 트랙·STT가 살아 있고 배경 발화가 커밋된다 ───────────────
test("A' — hidden 진입에도 세션 중에는 트랙·STT가 유지되고 배경 발화가 커밋된다([D1] 게이트)", async ({ page }) => {
  await boot(page);
  expect(await trackEnabled(page), '가짜 마이크 트랙이 확보돼야 관찰이 성립한다').toBe(true);

  await setVisibility(page, 'hidden');

  // 🔴 v0.43.0 A의 의도적 뒤집기(v0.45.0 [D1]) — 정지가 아니라 유지가 계약이다.
  await expect.poll(() => bgMicExtras(page), { timeout: 4000 })
    .toEqual(['edge=enter,stt=kept,capture=kept']);
  expect(await trackEnabled(page), '유지 경로는 트랙을 만지지 않는다').toBe(true);
  expect(await page.evaluate(() => {
    const tracks = (window as unknown as { __micTracks?: MediaStreamTrack[] }).__micTracks ?? [];
    return tracks[tracks.length - 1].readyState;
  })).toBe('live');

  // 화면 끈 채 발화 = 정상 입력이다(민구 원 의도: "세션이 진행중엔 음성 입력 출력 모두 가능하게").
  await fireStt(page, '33.3', 600);
  await expect.poll(
    async () => (await loadLogEvents(page)).filter((e) => e.type === 'value').length,
    { timeout: 4000 },
  ).toBe(1);
});

// ─── B': 복귀(유지 사이클) — 복원할 것이 없다. 안내 0회, 브리핑 1회 ─────────────────────────
test("B' — 유지 사이클 복귀는 stt=noop이고 BG_RESUME 안내 대신 복귀 브리핑(F14)이 나간다", async ({ page }) => {
  await boot(page);
  await setVisibility(page, 'hidden');
  await expect.poll(() => bgMicExtras(page), { timeout: 4000 })
    .toEqual(['edge=enter,stt=kept,capture=kept']);

  await setVisibility(page, 'visible');

  await expect.poll(() => bgMicExtras(page), { timeout: 4000 })
    .toEqual(['edge=enter,stt=kept,capture=kept', 'edge=return,stt=noop,capture=noop']);
  // 멈춘 게 없으니 "다시 시작합니다"는 거짓말이다 — 나가면 안 된다.
  expect(await announceCount(page)).toBe(0);
  // 대신 "어디부터?"를 답하는 브리핑이 나간다(Q5 형식: 항목+값, "다음, <항목>").
  await expect.poll(() => briefingCount(page), { timeout: 5000 }).toBe(1);

  // STT는 끊긴 적이 없다 — 복귀 후 값이 그대로 들어간다.
  await waitForTtsIdle(page);
  await fireStt(page, '33.3', 600);
  await expect.poll(
    async () => (await loadLogEvents(page)).filter((e) => e.type === 'value').length,
    { timeout: 4000 },
  ).toBe(1);
});

// ─── C': 모달 닫기 — 안내·브리핑 모두 나가지 않는다 ─────────────────────────────────────
test("C' — 개선요청 모달을 닫아도 안내·브리핑이 나가지 않는다(컨트롤러 생성부 공유 축)", async ({ page }) => {
  await boot(page);

  // ① 모달 왕복 — 여기서 발화하면 원샷/게이트가 없는 것이다.
  await page.locator('[data-testid="tab-feedback"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('[data-testid="feedback-cancel"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toHaveCount(0);
  await page.waitForTimeout(600);
  expect(await announceCount(page)).toBe(0);
  expect(await briefingCount(page), '모달 복귀는 브리핑 대상이 아니다(hidden 사이클이 아니다)').toBe(0);

  // ② 백그라운드 왕복 — 유지 사이클이므로 안내는 여전히 0, 브리핑만 1회.
  await setVisibility(page, 'hidden');
  await setVisibility(page, 'visible');
  await expect.poll(() => briefingCount(page), { timeout: 5000 }).toBe(1);
  expect(await announceCount(page)).toBe(0);

  // ③ 그 뒤 다시 모달을 열고 닫아도 브리핑이 늘지 않는다(hidden 사이클 게이트).
  await waitForTtsIdle(page);
  await page.locator('[data-testid="tab-feedback"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('[data-testid="feedback-cancel"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toHaveCount(0);
  await page.waitForTimeout(800);
  expect(await briefingCount(page)).toBe(1);
  expect(await announceCount(page)).toBe(0);
});

// ─── D: 세션 미가동(ready) — 종전 그대로 정지 경로의 noop. "세션 밖 = 확실히 정지" 축 ─────────
// v0.44.0 §C8 F18 적응 — 유휴 = 레코더·트랙 자체가 없음(getUserMedia 0회). [D1] 게이트는
// ready를 유지 집합에 넣지 않으므로 이 왕복은 v0.43.0 정지 경로 그대로다(안 바뀐 것이 계약이다).
test('D — 세션 미가동 왕복에는 안내가 없다(stt=noop). 유휴엔 만질 트랙도 없다(F18)', async ({ page }) => {
  await bootIdle(page); // 세션 시작 없음 — F18: 마이크 미획득 상태
  expect(await trackEnabled(page), 'F18: 입력탭 진입만으로 트랙이 생기면 안 된다').toBe(null);

  await setVisibility(page, 'hidden');
  await setVisibility(page, 'visible');

  // 🔴 v0.43.0 리뷰(Codex 사소#1) — stt 축은 "실제로 멈췄나"다. 유휴엔 멈출 인식기가 없다.
  await expect.poll(() => bgMicExtras(page), { timeout: 4000 })
    .toEqual(['edge=enter,stt=noop,capture=noop', 'edge=return,stt=noop,capture=noop']);
  // 🔑 복원할 인식기가 없었으므로 "다시 시작합니다"는 거짓말이다 — 나가면 안 된다.
  expect(await announceCount(page)).toBe(0);
  // [D1]에서도 세션 밖 왕복은 브리핑 대상이 아니다(세션이 없다).
  expect(await briefingCount(page)).toBe(0);
  // F18: 왕복 후에도 여전히 트랙 없음(유휴 왕복이 마이크를 만들지 않는다).
  expect(await trackEnabled(page)).toBe(null);
});

// ─── E: 백그라운드 중 세션 경계가 지나가면 안내 예약이 폐기된다(종전 그대로) ─────────────────
test('E — 백그라운드 중 세션 시작(clearUiSuspendLatch)이 안내 예약을 폐기한다', async ({ page }) => {
  await bootIdle(page);

  // hidden에서 suspend가 걸려 안내가 예약된다(ready phase — 정지 경로. 래치 reasons={app_background}).
  await setVisibility(page, 'hidden');
  await expect.poll(async () => (await bgMicExtras(page)).some((x) => x.startsWith('edge=enter')), { timeout: 4000 }).toBe(true);

  // 🔑 hidden인 채로 세션을 시작한다 → start()의 clearUiSuspendLatch('start')가 래치·예약을 비운다.
  await startSession(page);
  await setVisibility(page, 'visible');
  await page.waitForTimeout(600);
  expect(await announceCount(page), '복원된 것이 없으므로 안내 대상이 아니다').toBe(0);

  // 다음 모달에서도 새어 나오지 않는다 — 이게 실제 누출 경로다.
  await clickMounted(page, '[data-testid="tab-feedback"]');
  await expect(page.locator('[data-testid="feedback-modal"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('[data-testid="feedback-cancel"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toHaveCount(0);
  await page.waitForTimeout(800);
  expect(await announceCount(page), '세션 경계를 넘어 살아남은 예약이 있으면 여기서 터진다').toBe(0);
});

// ─── F': 유지 구간 생존 요약(bg_keep) — WP-1④. hidden 중 final 수가 복귀 시 1건으로 남는다 ────
test("F' — 유지 사이클의 bg_keep 요약: hidden 중 final 2건이 finals=2로, 사이클당 정확히 1건", async ({ page }) => {
  await boot(page);
  await setVisibility(page, 'hidden');

  // hidden 중 발화 2건(횡경 → 종경) — 유지가 실효라는 가장 강한 증거.
  await fireStt(page, '33.3', 900);
  await waitForTtsIdle(page);
  await fireStt(page, '21.1', 900);

  await setVisibility(page, 'visible');

  await expect.poll(async () => {
    const keeps = (await loadLogEvents(page)).filter((e) => e.extra?.startsWith('bg_keep:'));
    return keeps.map((e) => e.extra);
  }, { timeout: 4000 }).toHaveLength(1);
  const keep = (await loadLogEvents(page)).find((e) => e.extra?.startsWith('bg_keep:'))!;
  // bg_s는 짧은 왕복이라 0~10초대, finals=2, 인식기·트랙 생존.
  expect(keep.extra).toMatch(/^bg_keep:bg_s=\d+,finals=2,stt=ctrl,track=live$/);

  // 재-hidden 없이 visible 이벤트가 또 와도(스퓨리어스) 두 번째 bg_keep은 없다.
  await setVisibility(page, 'visible');
  await page.waitForTimeout(400);
  expect((await loadLogEvents(page)).filter((e) => e.extra?.startsWith('bg_keep:'))).toHaveLength(1);
});
