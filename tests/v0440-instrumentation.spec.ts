/**
 * v0.44.0 §5-1 계측 백로그 — **발화 검증**(빌더 리터럴만으로는 부족하다 — v042 계보).
 *
 * 🔴 배선이 틀린 계측과 재현되지 않은 결함은 로그에서 똑같이 0건으로 보인다([FG-RETURN-LOG-1]).
 * 그래서 여기서는 실제 앱 경로를 밟아 이벤트가 IDB에 남는지를 단언한다.
 *
 * 커버:
 *  - §5-1 ② stt_barge_in text/confidence — 빈 final이 와도 같은 발화의 마지막 interim으로
 *    "무엇을 들었는지"가 남는다(§D2 종경 컬럼 미결의 원인: 실기기 167건 전부 text=''/conf=0).
 *  - §5-1 ③ audio_input_class — 세션 시작 시 활성 입력 트랙 분류 + 원시 라벨 1회.
 *    fake getUserMedia 라벨 'Fake Mic'(activeZones MOCK_INIT_SCRIPT) → 미지 외장 → earphone.
 *  - §5-1 ④ font_render — 세션당 1회, 각 슬롯 px 숫자 + 뷰포트, 두 번째 방출 없음.
 *
 * §5-1 ①(feedback.json viewportW/H)은 v033-feedback.spec.ts(스키마 스펙)가 잰다.
 * ③의 device_change 경로는 라벨 전이 게이트(emitInputDeviceChanged old!==new)에 같이 배선돼
 * 있고, 그 게이트 자체는 실기기 조건(devicechange)이라 여기서는 분류 단위 테스트
 * (inputDevice.spec)와 빌더 리터럴(logEvents.spec)로 막는다.
 *
 * 서버: playwright.config.ts의 webServer가 5177을 자동 기동한다([ORCH-27]).
 */
import { test, expect, type Page } from '@playwright/test';
import { installVoiceMocks, fireStt, fireSttInterim } from './fixtures/stt';
import { boot, PHONE_402 } from './fixtures/activeZones';
import { GUM_GRANT_SCRIPT } from './fixtures/gum';
import { BASE } from './baseUrl';

test.setTimeout(120_000);

const STORE_KEY = 'agri-voicenote-settings-v3';

type LogEv = {
  type?: string; extra?: string; text?: string; confidence?: number; sessionId?: string;
};

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

// ── §5-1 ② — barge-in 이벤트의 text/confidence ────────────────────────────────
// v0440-d1-bargein 하네스 계보(음성 2컬럼 최소 시드 + 지연 onend로 TTS 재생창을 벌린다).

function bargeSettings() {
  return {
    state: {
      googleConnected: false, userEmail: null, sheet: null,
      sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_I2/edit', sheetTab: 'Sheet1',
      columnsSheetId: 'SHEET_I2', columnsSheetTab: 'Sheet1',
      availableSheets: [], manualMode: false,
      columns: [
        { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
        { id: 'c9', name: '종경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
      ],
      tableGenerated: true, totalRows: 2,
      ttsRate: 1.05, recognitionTolerance: 0.6,
      sessionLabelColId: null, sessionAutoLabel: 'v0440-inst', preferredVoiceName: '',
    },
    version: 13,
  };
}

async function bootBarge(page: Page, ttsOnendDelayMs: number) {
  await installVoiceMocks(page, { ttsOnendDelayMs });
  // 🔴 v0.44.1 [CLIP-INIT-SILENT-1] — 이 스텁이 없으면 헤드리스 기본 gUM **거부**가 시작 init을
  //    실패시키고, 그 실패가 v0.44.1부터 **의도적으로 시끄럽다**(mic_lost 래치 + 재연결 배너 +
  //    고지 TTS). 그러면 `waitForTtsWindow`가 잡는 재생창이 「항목 안내」가 아니라 「마이크 실패
  //    고지」가 되고, 그 창에는 `awaiting`이 없어 handleFinal이 barge-in 블록 앞에서 return한다
  //    → `stt_barge_in` 0건. **제품 결함이 아니라 하네스 결함이다**(같은 시퀀스의
  //    v0440-d1-bargein D1-T4는 이 스텁을 깔고 green).
  //    아래 `boot`(activeZones)를 쓰는 §5-1 ③④가 통과해온 이유도 그 픽스처가 gUM을 목업해서다.
  await page.addInitScript({ content: GUM_GRANT_SCRIPT });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ s, storeKey }) => {
      localStorage.clear();
      localStorage.setItem(storeKey, JSON.stringify(s));
      indexedDB.deleteDatabase('agri-voicenote');
    },
    { s: bargeSettings(), storeKey: STORE_KEY },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(200);
  await page.locator('text=음성 입력 시작').first().click();
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 5000 });
}

/** 인식 컨트롤러 기동 대기 — start()는 시작 TTS 뒤에 SpeechController를 만든다(d1 하네스 실측 함정). */
async function waitForRecognitionLive(page: Page, timeout = 20_000) {
  await page.waitForFunction(
    () => Boolean((window as unknown as { __mockSTT?: unknown }).__mockSTT),
    undefined,
    { timeout },
  );
}

/** TTS 재생창(onstart~onend 사이) 안에 있음을 보장 — 지연 onend 스텁이 창을 벌려 둔다. */
async function waitForTtsWindow(page: Page, timeout = 15_000) {
  await page.waitForFunction(
    () => ((window as unknown as { __ttsInFlight?: number }).__ttsInFlight ?? 0) > 0,
    undefined,
    { timeout },
  );
}

test('§5-1 ② — 빈 final barge-in: text/confidence가 마지막 interim으로 채워진다(+출처 마커)', async ({ page }) => {
  await bootBarge(page, 2500);
  await waitForRecognitionLive(page);
  await waitForTtsWindow(page);

  // 같은 발화의 interim(비어있지 않음 — TTS 컷 트리거) → 브라우저가 빈 final을 확정한 시나리오.
  // 실기기(08-02) stt_barge_in 167건 전부 text=''/conf=0 — 이 재현이 그 공백의 최소형이다.
  await fireSttInterim(page, '삼십오 점 일', 150, 0.6);
  await fireStt(page, '', 150, 0);

  // 주입이 실제로 TTS 재생창 안이었음을 보증(창이 닫혔다면 이 테스트는 barge-in을 재지 않는다).
  expect(await page.evaluate(
    () => (window as unknown as { __ttsInFlight?: number }).__ttsInFlight ?? 0,
  )).toBeGreaterThan(0);

  await expect.poll(async () => (await loadLogEvents(page)).filter((e) => e.type === 'stt_barge_in').length,
    { timeout: 10_000 }).toBe(1);
  const barge = (await loadLogEvents(page)).filter((e) => e.type === 'stt_barge_in')[0];
  // 🔴 "무엇을 들었는지"가 남는다 — 종전엔 text=''/confidence=0이라 §D2 종경 컬럼 판정이 미결이었다.
  expect(barge.text).toBe('삼십오 점 일');
  expect(barge.confidence).toBe(0.6);
  // 출처 마커 — final 원문이 아니라 interim 폴백이었음을 로그가 스스로 말한다.
  expect(barge.extra).toBe('text_src=interim');
});

test('§5-1 ② 회귀 — 정상 final barge-in은 종전 그대로(final text/conf, 출처 마커 없음)', async ({ page }) => {
  await bootBarge(page, 2500);
  await waitForRecognitionLive(page);
  await waitForTtsWindow(page);

  await fireStt(page, '삼십오 점 일', 300, 0.95);

  await expect.poll(async () => (await loadLogEvents(page)).filter((e) => e.type === 'stt_barge_in').length,
    { timeout: 10_000 }).toBe(1);
  const barge = (await loadLogEvents(page)).filter((e) => e.type === 'stt_barge_in')[0];
  expect(barge.text).toBe('삼십오 점 일');
  expect(barge.confidence).toBe(0.95);
  expect(barge.extra).toBeUndefined(); // final 원문이면 마커가 붙지 않는다(과거 로그와 동형).
});

// ── §5-1 ③ — 입력장치 종류: 세션 시작 1회 방출 ────────────────────────────────

test('§5-1 ③ — 세션 시작 시 audio_input_class 1회: fake 라벨 분류 + 원시 라벨', async ({ page }) => {
  await boot(page, PHONE_402); // MOCK_INIT_SCRIPT가 getUserMedia에 'Fake Mic' 라벨을 주입한다.

  await expect.poll(async () =>
    (await loadLogEvents(page)).filter((e) => (e.extra ?? '').startsWith('audio_input_class:')).length,
  { timeout: 8000 }).toBe(1);

  const ev = (await loadLogEvents(page)).filter((e) => (e.extra ?? '').startsWith('audio_input_class:'))[0];
  // 'Fake Mic'은 내장 패턴이 아닌 미지 외장 → earphone (classifyAudioInputClass 폴백 계약).
  expect(ev.extra).toBe('audio_input_class:cls=earphone,src=session_start');
  expect(ev.text).toBe('Fake Mic'); // 원시 라벨 — 분류가 틀렸을 때 사후 재분류의 근거.
  expect(ev.type).toBe('session');
});

// ── §5-1 ④ — 폰트 실렌더값: 세션당 1회 + px 숫자 + 두 번째 방출 없음 ─────────────

function parseKv(extra: string): Record<string, string> {
  const body = extra.slice(extra.indexOf(':') + 1);
  const out: Record<string, string> = {};
  for (const pair of body.split(',')) {
    const i = pair.indexOf('=');
    out[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return out;
}

test('§5-1 ④ — font_render 세션당 1건: 각 슬롯 px 숫자 + 뷰포트, 두 번째 방출 없음', async ({ page }) => {
  await boot(page, PHONE_402);

  const fontEvents = async () =>
    (await loadLogEvents(page)).filter((e) => (e.extra ?? '').startsWith('font_render:'));

  // 안정 시점(세션 시작 수 초 후) 1건 — 제품 지연(3s)에 여유를 둔다(리터럴 대기, 상수 import 금지).
  await expect.poll(async () => (await fontEvents()).length, { timeout: 10_000 }).toBe(1);

  const ev = (await fontEvents())[0];
  const kv = parseKv(ev.extra!);
  // 각 슬롯 키에 px 숫자 — 가독 하한(휴리스틱 10px)보다 크다. 0/NaN이면 슬롯을 못 읽은 것이다.
  for (const key of ['hero', 'alarmLabel', 'alarmValue', 'chipLabel', 'chipValue'] as const) {
    const px = Number.parseFloat(kv[key]);
    expect(Number.isFinite(px), `${key}가 숫자여야 한다: ${kv[key]}`).toBe(true);
    expect(px, `${key} px가 가독 하한 이상이어야 한다`).toBeGreaterThanOrEqual(10);
  }
  // 뷰포트 동봉(402×874 리터럴).
  expect(kv.w).toBe('402');
  expect(kv.h).toBe('874');
  // 세션 시작 직후 대기 화면: 히어로 값 슬롯은 비어 있고 알람 카드도 없다 → 둘은 프로브 해석,
  // 칩은 실렌더. 출처가 로그에 남아야 실기기 판독이 "실측"과 "곡선 해석"을 구분한다.
  expect(kv.probe).toBe('hero+alarmLabel+alarmValue');
  expect(ev.type).toBe('session');

  // 링버퍼 잠식 금지 — 1회 계약: 충분히 기다려도 두 번째 방출이 없다.
  await page.waitForTimeout(4000);
  expect((await fontEvents()).length).toBe(1);
});
