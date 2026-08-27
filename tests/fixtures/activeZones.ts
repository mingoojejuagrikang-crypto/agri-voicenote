/**
 * F3 입력화면(§공통규칙/§[2]/§[3]/§[4]) 브라우저 픽스처 — **동작 불변 이동**.
 *
 * 원래 `tests/v039-active-zones.spec.ts` 안에 있던 시딩·부팅·상태진입 헬퍼를 그대로 옮긴 것이다.
 * 두 번째 소비자(`tests/capture-current-states.spec.ts` — 실렌더 캡처)가 생기면서 복제를 피하려고
 * 뺐다(GL-006 §14 — 리팩토링과 기능추가를 같은 커밋에 섞지 않는다. 이 이동만 담은 커밋이다).
 *
 * ⚠️ 이 파일에는 `test()`를 두지 않는다 — 스펙이 import하면 그 테스트까지 재등록된다.
 *
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다([ORCH-27]).
 */
import { expect, type Page } from '@playwright/test';
import { MEDIA_RECORDER_STUB_SCRIPT } from './mediaRecorder';
import { fireStt, installVoiceMocks } from './stt';
import { BASE } from '../baseUrl';

export const STORE_KEY = 'agri-voicenote-settings-v3';
export const PHONE_402 = { width: 402, height: 874 };
export const PHONE_375 = { width: 375, height: 667 };

function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const PREV_ROUND = localISO(new Date(Date.now() - 86_400_000));

/** 1 auto(샘플키) + 12 voice — 402px 폭에서 한 행을 확실히 넘겨 가로 스크롤 계약이 실제로 물린다. */
const VOICE_COLS = Array.from({ length: 12 }, (_, i) => ({
  id: `v${i}`,
  name: `측정항목${String(i + 1).padStart(2, '0')}`,
  type: 'float',
  input: 'voice',
  ttsAnnounce: true,
  auto: { kind: 'fixed', value: '' },
  decimals: 1,
  sampleKey: false,
  // 첫 컬럼만 추세 규칙 — 이상치(§[2]) 진입용.
  ...(i === 0 ? { trendRule: 'increase' } : {}),
}));

export const COLUMNS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  ...VOICE_COLS,
];

export const SETTINGS = {
  state: {
    googleConnected: true,
    userEmail: 'tester@example.com',
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_F3/edit',
    sheetTab: 'Sheet1',
    columnsSheetId: 'SHEET_F3',
    columnsSheetTab: 'Sheet1',
    columns: COLUMNS,
    tableGenerated: true,
    totalRows: 2,
    ttsRate: 1.05,
    recognitionTolerance: 0.6,
    sessionLabelColId: null,
    // 🔴 v0.46.0 WP-D — 칩 왕복 **끔**. 이 픽스처를 쓰는 스펙들(v039 우측끝 6단언 · 72조합 스윕 ·
    //    프리뷰 캡처 재현)은 전부 칩존 `scrollLeft`를 **정지 상태로** 잰다.
    //    ① 무엇을 대체했나: 07-27 「활성 칩 우측 끝 고정」 계약 — **폐기가 아니다.** 여기서 0을
    //       넣음으로써 그 계약은 「왕복 OFF일 때의 동작」으로 **명시적으로 살아남는다.**
    //    ② 왜: 제보 F17(멀리서 진행 상황이 안 보인다) · 민구 R3(기본 8초, 0초 OFF).
    //    ③ 되살리려면: src/components/voice/ChipZone.tsx의 대체 주석(①②③)을 먼저 읽어라.
    //    ⚠️ 이 줄을 지우면 기본값 8초가 살아나 왕복이 돌고, 위 스펙들이 시간에 따라 흔들린다.
    //
    // 🔴🔴 **기전 — 이 픽스처 밖의 스펙에도 왜 이 줄이 필요한가** (v0.46.0 세션3 실측, 정본):
    //    왕복이 켜져 있으면 칩을 클릭하는 **모든** 스펙이 죽는다. "흔들린다"가 아니라 **확정적으로
    //    타임아웃**이다. Playwright의 `click()`은 actionability 체크(visible·enabled·**stable**)를
    //    통과해야 pointer 이벤트를 보내는데, `stable`은 «두 연속 프레임에서 bounding box가 같을 것»
    //    이다. 등속 왕복 중인 칩은 **그 조건을 영원히 만족하지 못한다** → `element is not stable`을
    //    반복하다 테스트 타임아웃(120s).
    //    🔑 **제품에는 방어가 있다** — ChipZone이 `pointerdown`에서 왕복을 멈춘다(장갑 오탭 대비).
    //       그런데 Playwright는 **stable 체크가 pointerdown보다 먼저**라 그 방어에 도달하지 못한다.
    //       **데드락이고, 실사용 결함이 아니다**(사람 손가락은 stable 체크를 안 거친다).
    //    실측 A/B (`manual-input`, 같은 두 테스트):
    //       왕복 ON  → 2.0분 × 2건 **실패**(`locator.click` 타임아웃)
    //       왕복 OFF → 7.9초 · 8.9초 **통과** — 약 15배.
    //    👉 그래서 칩을 클릭·단언하는 스펙은 이 픽스처를 쓰지 않더라도 자기 설정에
    //       `chipSweepSeconds: 0`을 **직접** 넣어야 한다. 왕복 자체의 계약은
    //       `tests/v046-chip-sweep.spec.ts`가 명시적으로 켜서 잰다(그쪽이 정본 게이트).
    chipSweepSeconds: 0,
    sessionAutoLabel: 'f3-active-zones',
    preferredVoiceName: '',
    roundDateColId: null,
  },
  version: 13,
};

export const HEADERS = ['조사일자', '농가명', '조사나무', ...VOICE_COLS.map((c) => c.name)];
export const SHEET_ROWS = [
  [PREV_ROUND, '이원창', '1', '100.0', ...Array.from({ length: 11 }, () => '')],
  [PREV_ROUND, '이원창', '2', '100.0', ...Array.from({ length: 11 }, () => '')],
];

/** headless는 getUserMedia가 거부돼 micLost가 래치되면 톤이 red로 고정된다 → fake 'live' 트랙 제공. */
export const MOCK_INIT_SCRIPT = MEDIA_RECORDER_STUB_SCRIPT + `
(function() {
  window.__micSettleSkipForTest = true; // F18 픽스처 우회 — 시작 시 1초 마이크 정착 생략(우회 심 오라클: v0440-c8-flow.spec.ts)
  function nextStream() {
    var fakeTrack = {
      kind: 'audio', label: 'Fake Mic', readyState: 'live', muted: false,
      getSettings: function(){ return { deviceId: 'fake-mic' }; },
      addEventListener: function(){}, removeEventListener: function(){}, stop: function(){},
    };
    // 🔴 v0.49 r3 #11 — 마지막 fake 트랙을 노출한다(fixtures/gum.ts의 GUM_GRANT_SCRIPT와 같은
    //   한 줄). 세션 **중** 스트림 사망(블루투스 낙하)을 e2e로 재현하려면 밖에서 readyState를
    //   'ended'로 뒤집을 수 있어야 하고, 제품 판정(isStreamLost)이 정확히 그 필드를 본다.
    //   ⚠️ 이 스크립트는 gum.ts의 **사본**이다(원본 주석의 계보 참조) — 한쪽만 고치면 갈린다.
    window.__lastFakeTrack = fakeTrack;
    return { getAudioTracks: function(){ return [fakeTrack]; }, getTracks: function(){ return [fakeTrack]; } };
  }
  if (navigator.mediaDevices) {
    // #11 — window.__gumDeny로 **재획득 실패**를 만들 수 있다(트랙 사망 + 재획득 거부 = 헤드셋이
    //   아예 사라진 형태). 기본값은 종전대로 항상 승인이다.
    try { navigator.mediaDevices.getUserMedia = function(){
      if (window.__gumDeny) return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
      return Promise.resolve(nextStream());
    }; } catch(e){}
  }
})();
`;

export async function stubSheets(
  page: Page,
  headers: readonly string[] = HEADERS,
  sheetRows: readonly (readonly string[])[] = SHEET_ROWS,
) {
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { values: [headers, ...sheetRows] } });
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected' });
  });
}

export async function boot(
  page: Page,
  viewport = PHONE_402,
  opts?: {
    preserveAnimations?: boolean;
    settings?: typeof SETTINGS;
    headers?: readonly string[];
    sheetRows?: readonly (readonly string[])[];
  },
) {
  await page.setViewportSize(viewport);
  await stubSheets(page, opts?.headers, opts?.sheetRows);
  await installVoiceMocks(page, opts);
  await page.addInitScript(MOCK_INIT_SCRIPT);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ settings, storeKey }) => {
      localStorage.clear();
      localStorage.setItem('gs10_google_token', JSON.stringify({
        access_token: 'test-token', expires_at: Date.now() + 3600_000, email: 'tester@example.com',
      }));
      localStorage.setItem(storeKey, JSON.stringify(settings));
    },
    { settings: opts?.settings ?? SETTINGS, storeKey: STORE_KEY },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(200);
  await page.locator('text=음성 입력 시작').first().click();
  await page.waitForTimeout(900);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 4000 });
}

/** 훅 test seam으로 마이크 레벨 주입 후 rAF 반영 대기. */
export async function injectLevel(page: Page, level: number) {
  await page.evaluate((v) => {
    (window as unknown as { __voiceLevelOverride?: number }).__voiceLevelOverride = v;
  }, level);
  await page.waitForTimeout(200);
}

/** ActiveState의 4개 grid 트랙 실측(상단 스트립 / 칩존 / 중앙 / 하단). */
export async function zoneMetrics(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="voice-active-state"]') as HTMLElement;
    const rootR = root.getBoundingClientRect();
    const rect = (sel: string) => {
      const el = root.querySelector(sel) as HTMLElement | null;
      return el ? el.getBoundingClientRect() : null;
    };
    const header = (root.firstElementChild as HTMLElement).getBoundingClientRect();
    const chips = rect('[data-testid="voice-chip-grid"]')!;
    const center = rect('[data-testid="voice-center-stage"]')!;
    const bottom = rect('[data-testid="voice-control-bar"]')!;
    return {
      rootHeight: rootR.height,
      headerHeight: header.height,
      chipHeight: chips.height,
      centerHeight: center.height,
      bottomHeight: bottom.height,
      centerTop: center.top,
      centerBottom: center.bottom,
      centerLeft: center.left,
      centerRight: center.right,
    };
  });
}

export async function triggerAnomaly(page: Page) {
  // 직전 100.0 → 120.5 = 추세 규칙(increase) 위반 → 추세 알람(응답 대기).
  await fireStt(page, '120.5', 900);
  await expect(page.locator('[data-testid="anomaly-alert"]')).toBeVisible({ timeout: 4000 });
}

/** 마지막 행까지 채워 §[4] 끝 도달 상태로 만든다. 첫 컬럼은 추세 규칙이 걸려 있으므로 직전값
 *  (100.0)을 그대로 넣어 알람 없이 통과시킨다(여기서 검증하려는 건 완료 화면이지 알람이 아니다). */
export async function fillAllRows(page: Page) {
  const summary = page.locator('[data-testid="complete-summary"]');
  for (let i = 0; i < 40; i++) {
    if (await summary.count() > 0) return;
    const col = i % 12;
    await fireStt(page, col === 0 ? '100.0' : `${20 + col}.0`, 320);
  }
  await expect(summary, '끝 도달(§[4])에 진입하지 못했다').toBeVisible({ timeout: 5000 });
}
