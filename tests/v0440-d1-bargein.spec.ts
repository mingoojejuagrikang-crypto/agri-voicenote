/**
 * v0.44.0 §D1 — barge-in(말끊기) 토글 + F17 안내음 볼륨 2배 (민구 확정 2026-08-02:
 * "2배로 진행하고, 바지인 기능 토글을 입력탭의 서랍메뉴(인식률, 안내음성속도)에 포함시키자.
 *  디폴트는 바지인 on.")
 *
 * 배경(실측): 같은 45셀에 iPhone(이어폰) 112발화 vs 태블릿(스피커폰) 771발화.
 * stt_barge_in 167건 전부가 TTS 재생창 안(우연 기대 41.2건의 4.05배) — TTS 에코가 STT로
 * 되먹임된 것. 원인은 v0.15.0 A6에서 스피커폰 half-duplex 가드를 "이어폰 쓸 거니까"로 삭제한 것
 * (src/lib/audioRecorder.ts:623 주석). echoCancellation 상시 ON으로도 못 막았다.
 *
 * 오라클(플랜 §D1 원문 순서):
 *  1. 서랍에 항목 3개 존재(허용 인식률·안내속도·말끊기).
 *  2. 기본값 ON(기존 사용자 = 영속본에 필드 없음 → ON).
 *  3. 🔴 핵심(반증 축): OFF에서 TTS 재생 중 모의 fireResult → stt 이벤트(커밋/파싱 경로) 0건.
 *     토글만 만들고 배선을 안 하면 이 단언이 잡는다. TTS 창은 지연 onend(ttsOnendDelayMs)로 벌린다.
 *  4. 볼륨 2배(리터럴 단언 — 제품 상수 import 금지).
 *  5. 회귀 가드: ON에서 TTS 재생 중 fireResult가 지금처럼 처리된다(이어폰 barge-in 불변).
 *
 * STT/TTS 목은 tests/fixtures/stt.ts SSOT. 서버는 webServer가 5177 자동 기동([ORCH-27]).
 */
import { test, expect, type Page } from '@playwright/test';
import { installVoiceMocks, fireStt, waitForTtsIdle } from './fixtures/stt';
import { GUM_GRANT_SCRIPT } from './fixtures/gum';
import { beepVolumeToMultiplier } from '../src/lib/beepVariants';
import { BASE } from './baseUrl';

test.setTimeout(120_000);

const STORE_KEY = 'agri-voicenote-settings-v3';

/** v043-parse-before-confidence 하네스 계보 — 음성 2컬럼(횡경·종경) 최소 시드.
 *  bargeInEnabled는 **의도적으로 기본 미포함**(기존 사용자 = 필드 없음 → merge가 기본 ON을 채움). */
function settings(overrides: Record<string, unknown> = {}) {
  return {
    state: {
      googleConnected: false, userEmail: null, sheet: null,
      sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_D1/edit', sheetTab: 'Sheet1',
      columnsSheetId: 'SHEET_D1', columnsSheetTab: 'Sheet1',
      availableSheets: [], manualMode: false,
      columns: [
        { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
        { id: 'c9', name: '종경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
      ],
      tableGenerated: true, totalRows: 2,
      ttsRate: 1.05, recognitionTolerance: 0.6,
      sessionLabelColId: null, sessionAutoLabel: 'v0440-d1', preferredVoiceName: '',
      ...overrides,
    },
    version: 13,
  };
}

type LogEv = { type?: string; parsed?: string; extra?: string; text?: string };

async function loadLogEvents(page: Page): Promise<LogEv[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db || !db.objectStoreNames.contains('logEvents')) return [];
    return new Promise<LogEv[]>((res) => {
      const tx = db.transaction('logEvents', 'readonly');
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result as LogEv[]);
      req.onerror = () => res([]);
    });
  });
}

/** 인식기 인스턴스 생성 카운터 — installVoiceMocks **뒤에** 주입해 MockSTT 생성자를 래핑한다.
 *  half-duplex의 "물리적 중지→재개"(abort→TTS 종료 후 fresh 재시작) 증거는 새 인스턴스 생성이다
 *  (결과 게이트만 있고 abort가 없으면 카운트가 늘지 않는다 — 스피커폰 에코의 물리 차단 반증 축). */
const STT_COUNTER_SCRIPT = `
(function() {
  window.__sttCreated = 0;
  function wrap(name) {
    var Orig = window[name];
    if (typeof Orig !== 'function') return;
    function Counted() { window.__sttCreated++; Orig.call(this); }
    Counted.prototype = Orig.prototype;
    window[name] = Counted;
  }
  wrap('SpeechRecognition');
  wrap('webkitSpeechRecognition');
})();
`;

async function boot(page: Page, opts: { seed?: Record<string, unknown>; ttsOnendDelayMs?: number } = {}) {
  await installVoiceMocks(page, opts.ttsOnendDelayMs !== undefined ? { ttsOnendDelayMs: opts.ttsOnendDelayMs } : undefined);
  // v0.44.1 [CLIP-INIT-SILENT-1] — 헤드리스 기본 gUM 거부 시 시작 경고 TTS가 큐에 끼어든다.
  // 이 스펙은 TTS 창 타이밍이 오라클이므로(정상 마이크 전제) 승인 스텁으로 그 간섭을 차단한다.
  await page.addInitScript({ content: GUM_GRANT_SCRIPT });
  await page.addInitScript({ content: STT_COUNTER_SCRIPT });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ s, storeKey }) => {
      localStorage.clear();
      localStorage.setItem(storeKey, JSON.stringify(s));
      indexedDB.deleteDatabase('agri-voicenote');
    },
    { s: settings(opts.seed ?? {}), storeKey: STORE_KEY },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
}

async function startSession(page: Page) {
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(200);
  await page.locator('text=음성 입력 시작').first().click();
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 5000 });
}

/** 인식 컨트롤러 기동 대기 — start()는 시작 TTS·행 안내 **뒤에** SpeechController를 만들므로
 *  (useVoiceSession :2671), 그 전 창에 fireResult를 쏘면 받을 인식기가 없어 조용히 증발한다
 *  (칩 active는 세션 시작 직후부터라 대기 축으로 부적합 — 초판 하네스의 실측 함정).
 *  __mockSTT가 생기면 다음 TTS 창은 announceField('횡경.') = awaiting 무장 상태다. */
async function waitForRecognitionLive(page: Page, timeout = 15_000) {
  await page.waitForFunction(
    () => Boolean((window as unknown as { __mockSTT?: unknown }).__mockSTT),
    undefined,
    { timeout },
  );
}

/** TTS 재생창(onstart~onend 사이) 안에 있음을 보장 — 지연 onend 스텁이 창을 벌려 둔다. */
async function waitForTtsWindow(page: Page, timeout = 10_000) {
  await page.waitForFunction(
    () => ((window as unknown as { __ttsInFlight?: number }).__ttsInFlight ?? 0) > 0,
    undefined,
    { timeout },
  );
}

// ── 오라클 1·2 — 서랍 3항목 + 기본 ON + 영속 ─────────────────────────────────

test('D1-T1 — 서랍에 항목 3개, 말끊기 기본 ON(기존 사용자 merge), 토글 시 영속', async ({ page }) => {
  await boot(page); // bargeInEnabled 미시드 = 기존 사용자
  await startSession(page);

  await page.locator('[data-testid="input-control-toggle"]').click();

  // 1) 항목 3개: 허용 인식률 · 안내속도 · 말끊기
  await expect(page.locator('[data-testid="stepper-tolerance"]')).toBeVisible();
  await expect(page.locator('[data-testid="stepper-tts-rate"]')).toBeVisible();
  const barge = page.locator('[data-testid="toggle-barge-in"]');
  await expect(barge).toBeVisible();

  // 2) 기본값 ON — 영속본에 필드가 없어도 ON이어야 한다.
  await expect(barge).toHaveAttribute('aria-checked', 'true');

  // 터치 타깃 48px 이상(§D1 서랍 관례).
  const box = await barge.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(48);

  // 토글 → OFF + settingsStore 영속(localStorage persist에 남는다).
  await barge.click();
  await expect(barge).toHaveAttribute('aria-checked', 'false');
  await expect.poll(async () => page.evaluate((storeKey) => {
    try {
      const raw = localStorage.getItem(storeKey);
      if (!raw) return 'missing';
      return String((JSON.parse(raw) as { state?: { bargeInEnabled?: unknown } }).state?.bargeInEnabled);
    } catch { return 'error'; }
  }, STORE_KEY)).toBe('false');

  // 되돌리기 → ON 영속.
  await barge.click();
  await expect(barge).toHaveAttribute('aria-checked', 'true');
});

// ── 오라클 3 — 🔴 핵심(반증 축): OFF에서 TTS 재생 중 stt 0건 + 물리 중지→재개 ──────────

test('D1-T2 — OFF: TTS 재생창 안의 fireResult가 커밋/파싱 경로에 0건, TTS 종료 후 재개', async ({ page }) => {
  // 지연 onend(2500ms)로 onstart~onend 창을 벌린다 — 그 창 안에서 무시됨을 잰다.
  await boot(page, { seed: { bargeInEnabled: false }, ttsOnendDelayMs: 2500 });
  await startSession(page);

  // 값 대기(awaiting) 무장 + 안내 TTS 재생창 확인 — 이 조합이어야 red 상태에서
  // barge-in 커밋(stt/stt_barge_in/value 로그)이 실제로 발생해 반증 축이 성립한다.
  await waitForRecognitionLive(page);
  await waitForTtsWindow(page);

  const createdBefore = await page.evaluate(
    () => (window as unknown as { __sttCreated?: number }).__sttCreated ?? 0,
  );

  await fireStt(page, '삼십오 점 일', 800);

  // 발화 주입이 실제로 TTS 재생창 안이었음을 보증(창이 이미 닫혔다면 이 테스트는 무의미).
  expect(await page.evaluate(
    () => (window as unknown as { __ttsInFlight?: number }).__ttsInFlight ?? 0,
  )).toBeGreaterThan(0);

  // 🔴 반증 축: 커밋/파싱 경로 도달 0건 — 발화 텍스트가 실린 로그(stt raw_confidence 포함),
  // stt_barge_in, value 모두 없어야 한다.
  const evs = await loadLogEvents(page);
  expect(evs.filter((e) => e.text && e.text.includes('삼십오'))).toEqual([]);
  expect(evs.filter((e) => e.type === 'stt_barge_in')).toEqual([]);
  expect(evs.filter((e) => e.type === 'value')).toEqual([]);

  // TTS 종료 후 재개 — half-duplex는 인식기를 물리적으로 내렸다가(abort) fresh로 되살린다.
  // 새 인스턴스 생성(카운터 증가)이 그 증거다(결과 게이트만으론 카운트가 늘지 않는다).
  await waitForTtsIdle(page);
  await expect.poll(async () => page.evaluate(
    () => (window as unknown as { __sttCreated?: number }).__sttCreated ?? 0,
  ), { timeout: 5000 }).toBeGreaterThan(createdBefore);

  // 재개 후 같은 발화는 정상 커밋된다(중지가 세션을 죽인 게 아니라 TTS 창에 국한됐다는 증거).
  await fireStt(page, '삼십오 점 일', 300);
  await expect.poll(async () => (await loadLogEvents(page)).some((e) => e.type === 'value' && e.parsed === '35.1'),
    { timeout: 15_000 }).toBe(true);
});

// ── 오라클 4 — F17 안내음 볼륨 2배 (리터럴 단언 — 제품 상수 import 금지) ─────────────

test('D1-T3 — F17: 비프 마스터 배수 2배 — 0/0.5/1 → 0/6/12', () => {
  // 기대값을 숫자로 박는다. BEEP_VOLUME_MAX를 import해 비교하면 상수만 바꿔도 초록이 된다.
  expect(beepVolumeToMultiplier(0)).toBe(0);
  expect(beepVolumeToMultiplier(0.5)).toBeCloseTo(6, 6);   // 기본 다이얼 0.5 → 종전 3×의 2배
  expect(beepVolumeToMultiplier(1)).toBe(12);              // 최대 → 종전 6×의 2배
  expect(beepVolumeToMultiplier(0.25)).toBeCloseTo(3, 6);  // 선형 유지
});

// ── 오라클 5 — 회귀 가드: ON에서 TTS 재생 중 fireResult가 지금처럼 처리(이어폰 경로 불변) ──

test('D1-T4 — ON(기본): TTS 재생창 안의 값 발화가 barge-in으로 그대로 커밋된다', async ({ page }) => {
  await boot(page, { ttsOnendDelayMs: 1500 }); // bargeInEnabled 미시드 = 기본 ON
  await startSession(page);

  await waitForRecognitionLive(page);
  await waitForTtsWindow(page);

  await fireStt(page, '삼십오 점 일', 300);

  // 지금 동작 그대로: stt_barge_in 계측 + 값 커밋(에코 TTS 후 value 로그).
  await expect.poll(async () => (await loadLogEvents(page)).some((e) => e.type === 'stt_barge_in'),
    { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => (await loadLogEvents(page)).some((e) => e.type === 'value' && e.parsed === '35.1'),
    { timeout: 15_000 }).toBe(true);
});
