/**
 * v0.34.0 Wave 2(Vance) — B7 음성 반응 파동 + B8 edge glow 검증.
 *
 *  B7 — '듣는 중' hero 항목명(HeroPrimaryLine)에 rAF 루프(useAudioLevelVar)가 `--voice-level`
 *       CSS 변수를 흘리고, text-shadow 확산 + 미세 opacity가 그 변수로 변조된다(리렌더 0).
 *       레벨 소스는 audioRecorder의 기존 preroll 캡처 tap — headless는 getUserMedia가 거부돼
 *       레벨 0 폴백이므로, 테스트는 훅의 test seam(window.__voiceLevelOverride)으로 주입한다.
 *  B8 — 화면 외곽 글로우(EdgeGlow): 상태 톤 매핑(anomaly→red, paused→amber, active→green),
 *       pointer-events 통과, zIndex 54(팝업 아래), 세션 비활성 미렌더, 레벨로 강도 변조.
 *  D11b — 세션 시작 ui_fx:wave=on,glow=on,preroll=<...> 계측 1건(IDB logEvents로 확인).
 *
 *  서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다(수동 기동 불필요, [ORCH-27])
 */
import { test, expect, type Page } from '@playwright/test';
import { fireStt, fireSttInterim, installVoiceMocks, waitForTtsIdle } from './fixtures/stt';
import { BASE } from './baseUrl';

test.setTimeout(120_000);

const STORE_KEY = 'agri-voicenote-settings-v3';
const PHONE_375 = { width: 375, height: 812 };

function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const PREV_ROUND = localISO(new Date(Date.now() - 86_400_000));

const COLUMNS = [
  { id: 'c1', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'c3', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'increase' },
];

const SETTINGS = {
  state: {
    // 🔴 왕복 OFF — 켜져 있으면 칩 클릭이 Playwright `stable` 체크에서 데드락한다.
    //    기전·실측은 tests/fixtures/activeZones.ts의 chipSweepSeconds 주석이 정본.
    chipSweepSeconds: 0,
    googleConnected: true,
    userEmail: 'tester@example.com',
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_V034_WG/edit',
    sheetTab: 'Sheet1',
    columnsSheetId: 'SHEET_V034_WG',
    columnsSheetTab: 'Sheet1',
    columns: COLUMNS,
    tableGenerated: true,
    totalRows: 2,
    ttsRate: 1.05,
    recognitionTolerance: 0.6,
    sessionLabelColId: null,
    sessionAutoLabel: 'v034-wave-glow-test',
    preferredVoiceName: '',
    roundDateColId: null,
  },
  version: 13,
};

const HEADERS = ['조사일자', '농가명', '조사나무', '횡경'];
const SHEET_ROWS = [
  [PREV_ROUND, '이원창', '1', '100.0'],
  [PREV_ROUND, '이원창', '2', '100.0'],
];

// STT/TTS는 fixtures/stt.ts의 비동기 onend SSOT([TEST-TTS-MOCK-1])를 쓴다.
// v0.34.0 B8 — getUserMedia 스텁: headless는 마이크가 거부돼 첫 값 커밋의 clip_empty가
//   micLost를 래치(→ 글로우가 정당하게 red 고정)하므로, 'live' 트랙의 fake 스트림을 줘서
//   isStreamLost()=false를 유지한다(톤 전환 검증이 결정적이 되게). MediaRecorder/
//   createMediaStreamSource는 fake를 거부하지만 둘 다 기존 안전선(clip_start_failed/
//   clip_preroll_unavailable)으로 흡수된다. __fakeMicTrack.readyState를 'ended'로 바꾸면
//   micLost 경로를 의도적으로 발화시킬 수 있다(전용 테스트).
const MOCK_INIT_SCRIPT = `
(function() {
  window.__micSettleSkipForTest = true; // F18 픽스처 우회 — 시작 시 1초 마이크 정착 생략(우회 심 오라클: v0440-c8-flow.spec.ts)
  window.__getUserMediaCallCount = 0;
  window.__failNextGetUserMedia = 0;
  function nextStream() {
    var fakeTrack = {
      kind: 'audio', label: 'Fake Mic', readyState: 'live', muted: false,
      getSettings: function(){ return { deviceId: 'fake-mic' }; },
      addEventListener: function(){}, removeEventListener: function(){}, stop: function(){},
    };
    window.__fakeMicTrack = fakeTrack;
    return {
      getAudioTracks: function(){ return [fakeTrack]; },
      getTracks: function(){ return [fakeTrack]; },
    };
  }
  if (navigator.mediaDevices) {
    try { navigator.mediaDevices.getUserMedia = function(){
      window.__getUserMediaCallCount += 1;
      if (window.__failNextGetUserMedia > 0) {
        window.__failNextGetUserMedia -= 1;
        return Promise.reject(new DOMException('mock auto reconnect failure', 'NotAllowedError'));
      }
      return Promise.resolve(nextStream());
    }; } catch(e){}
  }
})();
`;

async function stubSheets(page: Page) {
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { values: [HEADERS, ...SHEET_ROWS] } });
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected' });
  });
}

/** 부팅 + 입력탭 진입(세션 시작 전 — ready 상태 검증용). */
async function boot(page: Page, viewport = PHONE_375) {
  await page.setViewportSize(viewport);
  await stubSheets(page);
  await installVoiceMocks(page);
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
    { settings: SETTINGS, storeKey: STORE_KEY },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(200);
}

async function startSession(page: Page) {
  const startBtn = page.locator('text=음성 입력 시작').first();
  await expect(startBtn).toBeVisible();
  await startBtn.click();
  await page.waitForTimeout(800);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
}

/** 훅 test seam으로 레벨 주입 후 rAF 반영 대기. */
async function injectLevel(page: Page, level: number) {
  await page.evaluate((v) => {
    (window as unknown as { __voiceLevelOverride?: number }).__voiceLevelOverride = v;
  }, level);
  await page.waitForTimeout(150); // rAF 수 프레임
}

async function loadLogExtras(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const all = await new Promise<Array<{ extra?: string }>>((res, rej) => {
      const req = db.transaction('logEvents', 'readonly').objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result as Array<{ extra?: string }>);
      req.onerror = () => rej(req.error);
    });
    db.close();
    return all.flatMap((event) => typeof event.extra === 'string' ? [event.extra] : []);
  });
}

// v0.35.0 — 레벨 rAF 시임(__voiceLevelOverride)은 이제 파형 canvas가 아니라 EdgeGlow(useAudioLevelVar)
//   에서 소비된다. rAF 정지/재개 검증은 edge-glow 루트의 --voice-level로 관측한다.
async function glowVar(page: Page): Promise<string> {
  return page.locator('[data-testid="edge-glow"]').evaluate(
    (el) => el.style.getPropertyValue('--voice-level'),
  );
}

// ─── B7. 파동 — CSS 변수 반영 + 시각 변조 ──────────────────────────────────

test('B7 — 대기 카드: 화면 2/3 폭의 세로 도트 파형(25열), "듣는 중" 텍스트 제거', async ({ page }) => {
  await boot(page, { width: 402, height: 874 });
  await startSession(page);

  // v0.40.0 fb-27-2 — 대기 중 **중앙 항목명은 렌더하지 않는다**. 항목명은 칩존 활성 칩이 준다.
  await expect(page.locator('[data-testid="hero-primary"]'), '대기 중 중앙 항목명 미렌더').toHaveCount(0);
  await expect(page.locator('[data-testid="column-chip"][data-active="true"]'), '항목명은 활성 칩이 준다')
    .toContainText('횡경');

  // 대기 상태 표식 + "듣는 중" 텍스트 제거(파형이 신호).
  await expect(page.locator('[data-hero-state="listening"]')).toBeVisible();
  await expect(page.locator('text=듣는 중')).toHaveCount(0);

  // v0.40.0 — 인디케이터가 **도트 격자 하나**로 합쳐졌다([UI-WAVE-1] 구조적 해소).
  // UI-e2 — 원형 도트는 유지하고 열 피치만 화면 2/3로 넓힌다(§C5에서 18×10 → WP-G에서 25×14).
  // 밴드 높이는 하단 1행이 정하며 60px 하한만 남는다. 제품 상수 import 없이 설계 리터럴을
  // 독립 검증한다. ⚠️ 350셀 중 **하단 4행은 접힌 조절판 필의 자리**라 표시가 쓰지 않는다 —
  // 그 계약은 `v0460-g-dot-pill.spec.ts`가 재고 여기서는 격자 기하만 본다.
  const band = page.locator('[data-testid="live-listen-band"]');
  const wave = page.locator('[data-testid="state-dots"]');
  await expect(wave).toBeVisible();
  const geometry = await band.evaluate((el) => {
    const bandStyle = getComputedStyle(el);
    const waveEl = el.querySelector('[data-testid="state-dots"]') as HTMLElement;
    const indicatorRow = el.closest('[data-testid="voice-indicator-row"]') as HTMLElement;
    const dotRects = Array.from(waveEl.querySelectorAll('span'), (dot) => dot.getBoundingClientRect());
    return {
      availableWidth: el.clientWidth - parseFloat(bandStyle.paddingLeft) - parseFloat(bandStyle.paddingRight),
      waveWidth: waveEl.getBoundingClientRect().width,
      waveHeight: waveEl.getBoundingClientRect().height,
      bandHeight: el.getBoundingClientRect().height,
      indicatorRowHeight: indicatorRow.getBoundingClientRect().height,
      expectedWaveWidth: window.innerWidth * (2 / 3),
      maxDotSkew: Math.max(...dotRects.map((dot) => Math.abs(dot.width - dot.height))),
      cells: waveEl.querySelectorAll('span').length,
    };
  });
  console.log(`band geometry: ${JSON.stringify(geometry)}`);
  expect(geometry.cells, '25열 × 14행 격자(WP-G — 종전 §C5의 18×10=180)').toBe(350);
  expect(geometry.bandHeight, '밴드는 하단 1행 높이를 전부 쓴다').toBeCloseTo(geometry.indicatorRowHeight, 0);
  expect(geometry.bandHeight, '밴드 가독 하한 60px').toBeGreaterThanOrEqual(60);
  expect(geometry.waveWidth, '파형 폭은 화면의 2/3').toBeCloseTo(geometry.expectedWaveWidth, 0);
  expect(geometry.maxDotSkew, '넓어진 것은 열 피치이며 도트는 원형').toBeLessThanOrEqual(0.5);
  expect(geometry.waveHeight, '격자가 밴드 높이를 넘지 않는다').toBeLessThanOrEqual(geometry.bandHeight + 1);
  expect(geometry.waveWidth, '격자가 가용 폭을 넘지 않는다').toBeLessThanOrEqual(geometry.availableWidth + 1);
});

// v0.40.0 — 진폭은 막대 높이가 아니라 **켜진 셀 수**로 읽는다(도트 격자). 레벨이 오르면
// 중앙 행에서 위아래로 더 많은 셀이 켜지므로 같은 "진폭 반응" 계약이 성립한다.
async function waveLitCells(page: Page): Promise<number> {
  return page.locator('[data-testid="state-dots"]').evaluate(
    (el) => Array.from(el.querySelectorAll('span'))
      .filter((b) => Number((b as HTMLElement).style.opacity || '1') > 0.02).length,
  );
}

test('B7 — 도트 파형 실제 렌더 + 주입 레벨에 진폭 반응(FB-D)', async ({ page }) => {
  await boot(page);
  await startSession(page);
  await expect(page.locator('[data-testid="state-dots"]')).toBeVisible();

  // 레벨 0: v0.44.0 §C5(F11, 민구 확정) — mic 글리프 대신 **idle 웨이브**가 흐른다.
  //   "음성이 들리지 않아도 진동을 보여줘서 인식중이란 걸 알려라" — 종전 "레벨 0 정지" 계약의
  //   의도적 폐기다(플랜 §4-b 계열). 마이크 사망 신호는 micLost(red 톤+재연결 배너)가 맡는다.
  await injectLevel(page, 0);
  await page.waitForTimeout(600); // hangover 경과
  const lo = await waveLitCells(page);
  expect(lo, '무입력에도 idle 웨이브가 보인다(빈 격자 아님)').toBeGreaterThan(0);
  expect(await page.locator('[data-testid="state-dots"]').getAttribute('data-mode'), '레벨 0 = idle 모드').toBe('idle');

  // 레벨↑: 같은 격자가 **파형**으로 바뀌고 켜진 셀이 늘어난다(진폭 반응).
  await injectLevel(page, 0.85);
  await page.waitForTimeout(200);
  const hi = await waveLitCells(page);
  expect(await page.locator('[data-testid="state-dots"]').getAttribute('data-mode')).toBe('wave');
  console.log(`waveLitCells: level0=${lo} level0.85=${hi}`);
  expect(hi, '레벨이 오르면 켜진 셀이 늘어난다').toBeGreaterThan(lo);
});

test('[리뷰#1] 짧은 화면(375×667) 최대 진폭에서도 격자가 밴드를 벗어나지 않는다', async ({ page }) => {
  await boot(page, { width: 375, height: 667 });
  await startSession(page);
  await expect(page.locator('[data-testid="state-dots"]')).toBeVisible();

  // v0.40.0 — 종전 전제("밴드가 레퍼런스 막대 78px보다 낮은 뷰포트")는 막대 파형 시절의 조건이었다.
  //   도트 격자에는 고정 상수가 없고 셀 크기를 밴드에서 역산하므로, 결함 조건은 "밴드가 좁다"가
  //   아니라 **"진폭이 최대여도 격자가 밴드를 못 넘는다"** 자체다. 좁은 화면을 계속 쓰되(짧은 화면이
  //   가장 빡빡한 예산) 전제는 실제 불변식으로 바꾼다.
  const bandHeight = await page.locator('[data-testid="live-listen-band"]')
    .evaluate((el) => el.getBoundingClientRect().height);
  // v0.44.0 §C5-b — 하단1행이 pool의 24%가 되며 375×667 실측 밴드가 ~126px로 커졌다. 게이트 재보정.
  expect(bandHeight, '짧은 화면에서 밴드 예산이 실제로 빡빡하다(§C5-b 24% 반영)').toBeLessThanOrEqual(140);

  await injectLevel(page, 1);
  await page.waitForTimeout(250);

  const geom = await page.locator('[data-testid="live-listen-band"]').evaluate((el) => {
    const band = el.getBoundingClientRect();
    const grid = el.querySelector('[data-testid="state-dots"]') as HTMLElement;
    const gr = grid.getBoundingClientRect();
    const cells = Array.from(grid.querySelectorAll('span')) as HTMLElement[];
    let worstOverflow = 0;
    for (const c of cells) {
      const r = c.getBoundingClientRect();
      worstOverflow = Math.max(worstOverflow, band.top - r.top, r.bottom - band.bottom);
    }
    return { gridHeight: gr.height, bandHeight: band.height, worstOverflow };
  });

  // ⚠️ 판정은 **레이아웃 높이**로 한다(시계 비의존, GL-004 [ORCH-18]).
  //   도트 격자는 셀 크기를 밴드 높이에서 역산하므로 진폭과 무관하게 상한이 고정된다 —
  //   종전 막대 파형이 scaleY로 밴드를 넘치던 경로가 **구조적으로** 사라졌다.
  expect(geom.gridHeight, '격자 높이가 밴드를 넘지 않는다').toBeLessThanOrEqual(geom.bandHeight);
  expect(geom.worstOverflow, '어떤 셀도 밴드 밖으로 삐져나오지 않는다').toBeLessThan(1);
});

/** v0.40.0 — 인디케이터가 도트 격자 하나로 합쳐졌다([UI-WAVE-1] 구조적 해소). 지문의 계약은
 *  그대로다: 두 시점을 비교해 **움직임 여부**를 판정한다. 정지=동일 / 움직임=상이.
 *  ⚠️ `opacity`(켜짐/꺼짐)를 읽는다 — 호흡 애니메이션은 CSS라 인라인 style에 남지 않으므로
 *  이 지문은 **rAF가 그리는 내용**만 본다(시계 잡음 배제). */
function waveFingerprint(page: Page): Promise<string> {
  return page.locator('[data-testid="state-dots"]').evaluate(
    (el) => Array.from(el.querySelectorAll('span')).map((b) => (b as HTMLElement).style.opacity).join(''),
  );
}

// v0.35.0 R3-FIX-3 → 🔴 v0.44.0 §C5(F11)에서 계약 반전(아래 본문 주석) — **무음에도 idle 웨이브**.
//   이 파형의 존재 이유가 "2~3m 밖에서 내 말을 듣고 있나 확인"이라, 마이크/프리롤 초기화가 실패해
//   아무것도 안 듣는 상태에서 흔들리면 기능의 목적을 배신한다. 종전 합성 폴백은 진폭이
//   `0.12 + lv*0.88`이라 레벨 0에서도 12% 진폭으로 계속 흔들렸다.
//   회귀 오라클 = 두 시점의 canvas 픽셀 지문이 **동일**(정지). 대조군으로 레벨↑에선 달라야 한다
//   (지문 비교가 움직임을 실제로 탐지할 수 있음을 같은 테스트가 증명 — 공허한 단언 방지).
test('R3-FIX-3 — 레벨 0(마이크 사망)이면 파형이 정지(정적 세로막대), 레벨↑이면 움직인다', async ({ page }) => {
  await boot(page);
  await startSession(page);
  await expect(page.locator('[data-testid="state-dots"]')).toBeVisible();

  // 🔴 v0.44.0 §C5(F11) — 이 테스트의 원 계약("레벨 0 = 정지")은 민구 확정으로 **폐기**됐다:
  //   "음성이 들리지 않아도 진동을 보여줘서 인식중이란 걸 알려라." 죽은 마이크의 신호는 이제
  //   micLost(red 톤 + MicReconnectBanner)가 맡고, 레벨 0의 idle 웨이브는 저진폭(행 4~6)으로
  //   흘러 파형(최대 10행)과 **모드·진폭으로** 구분된다. 되살리려면 F11 확정을 먼저 뒤집어라.
  await injectLevel(page, 0);
  await page.waitForTimeout(300); // 정착
  const a1 = await waveFingerprint(page);
  // 병렬 부하에서 rAF가 기아 상태면 고정 400ms 두 샘플이 같은 프레임을 잡는다(전체 스위트
  // 1회 실측·단독 3회 green). 지문이 바뀔 때까지 폴링한다 — 계약은 "흐른다"이지 "400ms 안에
  // 바뀐다"가 아니다.
  await expect(async () => {
    expect(await waveFingerprint(page), '레벨 0: idle 웨이브가 흐른다(F11 — 죽은 화면 금지)').not.toBe(a1);
  }).toPass({ timeout: 5000, intervals: [250] });
  const a2 = await waveFingerprint(page);
  expect(await page.locator('[data-testid="state-dots"]').getAttribute('data-mode'), '레벨 0 = idle').toBe('idle');
  const idleLitCount = (a1.match(/1/g) ?? []).length;

  // 대조군: 실제 레벨이 있으면 wave 모드로 바뀌고 켜진 셀이 는다(idle과 실발화가 구분됨).
  await injectLevel(page, 0.85);
  await page.waitForTimeout(300);
  const b1 = await waveFingerprint(page);
  // 같은 rAF 기아 축 — 대조군도 폴링으로 잰다(위 idle 단언과 동일 근거).
  await expect(async () => {
    expect(await waveFingerprint(page), '레벨 0.85: 파형이 실제로 흐른다(대조군)').not.toBe(b1);
  }).toPass({ timeout: 5000, intervals: [250] });
  expect(await page.locator('[data-testid="state-dots"]').getAttribute('data-mode'), '레벨 0.85 = wave').toBe('wave');
  expect((b1.match(/1/g) ?? []).length, '실발화 진폭이 idle보다 크다').toBeGreaterThan(idleLitCount);
  console.log('✓ R3-FIX-3(재협상): 레벨0=idle 저진폭 흐름 / 레벨0.85=wave 고진폭 (모드·진폭 구분)');
});

// v0.35.0 R3-FIX-4(리뷰 라운드3, Codex Medium·perf) — 렌더 루프의 **가시성 백오프 계약 보존**.
//   라운드2(R2-FIX-3)는 "keep-alive display:none이면 즉시 백오프"를 매 프레임 offsetParent 읽기로
//   달성했는데, 그게 매 프레임 레이아웃 조회 비용이었다. 라운드3에서 수단을 IntersectionObserver로
//   교체했으므로 **취지가 살아있는지**를 여기서 직접 지킨다(수단이 아니라 결과를 단언).
//   오라클: 세션 중 다른 탭으로 가면(VoiceScreen display:none, [STT-16] keep-alive) canvas stroke
//   호출이 **완전히 멈춘다**. 복귀하면 다시 돈다.
/** v0.37.0 FB-D — 파형 막대가 지정 시간 동안 **움직였는지**(scaleY 지문 변화). canvas stroke 카운터
 *  대체 — rAF 루프의 가동/정지를 막대 transform 변화로 직접 관측한다(정지=지문 불변). */
async function waveMoved(page: Page, ms: number): Promise<boolean> {
  const a = await waveFingerprint(page);
  await page.waitForTimeout(ms);
  const b = await waveFingerprint(page);
  return a !== b;
}

test('R3-FIX-4 — 세션 중 탭 이탈(display:none)이면 파형 렌더 정지, 복귀 시 재개', async ({ page }) => {
  await boot(page);
  await startSession(page);
  await expect(page.locator('[data-testid="state-dots"]')).toBeVisible();
  await injectLevel(page, 0.8); // 움직이는 상태 = 루프가 실제로 도는 상태.

  await page.waitForTimeout(200);
  expect(await waveMoved(page, 500), '보이는 동안엔 막대가 움직인다').toBe(true);

  // 데이터 탭으로 이탈 → 세션은 keep-alive(display:none)로 살아 있다. IO가 rAF를 정지시킨다.
  await page.locator('[data-testid="tab-data"]').click();
  await page.waitForTimeout(600); // IO 콜백 + 백오프 정착(마지막 프레임에서 얼어붙는다)
  expect(await waveMoved(page, 700), '숨김(display:none) 중엔 막대 transform이 얼어 있어야').toBe(false);

  // 복귀 → 다시 움직인다(백오프가 영구 정지가 아님).
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(400);
  expect(await waveMoved(page, 500), '복귀 시 렌더 재개').toBe(true);
  console.log('✓ R3-FIX-4 백오프: visible=이동 / hidden=정지 / resumed=이동');
});

// v0.35.0 FIX-7b(리뷰 라운드1) — 일시정지(levelActive=false) 시 edge-glow opacity가 직전 큰 레벨에
//   고착되지 않고 baseline(≈0.55)으로 수렴하는지(FIX-2 검증). '동결' 성공 단언(hidden 탭)과 달리,
//   여기선 정지 시 실제 표시 밝기가 baseline인지를 목적으로 본다.
test('B8 — 일시정지 시 edge-glow opacity가 baseline(≈0.55)으로 수렴(FIX-2/7b)', async ({ page }) => {
  await boot(page);
  await startSession(page);
  const glow = page.locator('[data-testid="edge-glow"]');

  // 큰 레벨 주입 → 활성 중엔 opacity가 높다(≈1.0).
  await injectLevel(page, 1);
  await page.waitForTimeout(200);
  const active = await glow.evaluate((el) => parseFloat(getComputedStyle(el).opacity));
  expect(active).toBeGreaterThan(0.9);

  // 일시정지(levelActive=false) → --voice-level과 무관하게 baseline 0.55로 강제.
  await page.locator('button[title="일시정지"]').click();
  await page.waitForTimeout(300);
  await expect(glow).toHaveAttribute('data-tone', 'mono'); // 일시정지 톤(v0.44.0 §C4: amber→mono)
  const paused = await glow.evaluate((el) => parseFloat(getComputedStyle(el).opacity));
  console.log(`edge-glow opacity: active(level1)=${active} paused=${paused}`);
  expect(paused, '정지 시 직전 큰 레벨에 고착되지 않고 baseline으로').toBeCloseTo(0.55, 2);
});

// v0.35.0 FIX-6(리뷰 라운드1) — reduced-motion이면 확인 카드(hero) 애니메이션도 정지(EdgeGlow·
//   VoiceWaveform과 일관). 대기 카드의 panel-pulse / hero-primary chip-pop이 'none'이어야 한다.
test('B7 — prefers-reduced-motion 시 hero 카드 애니메이션 정지(FIX-6)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await boot(page);
  await startSession(page);

  const card = page.locator('[data-hero-state="listening"]');
  await expect(card).toBeVisible();
  const cardAnim = await card.evaluate((el) => getComputedStyle(el).animationName);
  expect(cardAnim === 'none' || cardAnim === '').toBeTruthy(); // panel-pulse 미적용

  // v0.40.0 — 대기 중엔 중앙 항목명이 없다(fb-27-2). chip-pop은 **값**에 붙는 애니메이션이므로
  //   값이 실제로 그려지는 상태(커밋 직후 확인 카드)에서 정지 계약을 잰다.
  await fireStt(page, '25.0');
  const hero = page.locator('[data-testid="hero-primary"]');
  await expect(hero).toBeVisible({ timeout: 4000 });
  const heroAnim = await hero.evaluate((el) => getComputedStyle(el).animationName);
  expect(heroAnim === 'none' || heroAnim === '').toBeTruthy(); // chip-pop 미적용

  // edge-glow는 reduced에서 고정 밝기(0.72) — pulse 레이어 애니메이션 없음(기존 계약).
  const pulseAnim = await page.locator('[data-glow-pulse]').evaluate((el) => getComputedStyle(el).animationName);
  expect(pulseAnim === 'none' || pulseAnim === '').toBeTruthy();
  console.log('✓ reduced-motion: hero panel-pulse·chip-pop·edge-pulse 전부 정지');
});

test('B7 — listening 외 상태(일시정지) 무동작: hero 파동 대상 자체가 없다 + 글로우 amber', async ({ page }) => {
  await boot(page);
  await startSession(page);
  await expect(page.locator('[data-hero-state="listening"]')).toBeVisible();

  // 일시정지 — EdgeGlow(zIndex 54, inset:0)가 컨트롤바 위를 덮고 있으므로, 이 클릭 성공 자체가
  // pointer-events:none 통과 증명이기도 하다(force 미사용).
  await page.locator('button[title="일시정지"]').click();
  await page.waitForTimeout(400);
  await expect(page.locator('[data-testid="paused-card"]')).toBeVisible();
  // 일시정지에서는 hero 자체가 사라진다(중앙 비움 — §[3]). 대기 중엔 항목명이 없으므로
  // hero-primary가 아니라 **hero 상태 노드**로 판정한다.
  await expect(page.locator('[data-hero-state]')).toHaveCount(0);
  await expect(page.locator('[data-testid="edge-glow"]')).toHaveAttribute('data-tone', 'mono');

  // 재시작 → 다시 듣는 중(green) + hero 복귀.
  await page.locator('button[title="재시작"]').click();
  await page.waitForTimeout(400);
  await expect(page.locator('[data-hero-state="listening"]')).toBeVisible();
  await expect(page.locator('[data-testid="edge-glow"]')).toHaveAttribute('data-tone', 'green');
  console.log('✓ 일시정지: hero 파동 대상 제거 + 글로우 amber↔green 전환 + 글로우 아래 버튼 터치 통과');
});

test('B7 — 탭 숨김(visibilityState hidden) 시 레벨 rAF 정지(EdgeGlow), 복귀 시 재개', async ({ page }) => {
  await boot(page);
  await startSession(page);

  await injectLevel(page, 0.3);
  expect(await glowVar(page)).toBe('0.300');

  // visibilityState를 hidden으로 오버라이드 + visibilitychange 발화 → 루프 정지.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(200);
  await injectLevel(page, 0.9);
  await page.waitForTimeout(300);
  expect(await glowVar(page)).toBe('0.300'); // 갱신 없음 = rAF 정지

  // 복귀 → 재개.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(300);
  expect(await glowVar(page)).toBe('0.900');
  console.log('✓ hidden 중 --voice-level 동결(rAF 정지) → visible 복귀 시 재개');
});

// ─── B8. Edge glow — 톤 매핑 · 통과 · 레벨 변조 · 비활성 미렌더 ─────────────

test('B8 — 세션 비활성 미렌더 → active green → 이상치 red → 확인 후 green + pointer-events/zIndex', async ({ page }) => {
  await boot(page);

  // ready(세션 전) — 글로우 미렌더(no-op).
  await expect(page.locator('[data-testid="edge-glow"]')).toHaveCount(0);

  await startSession(page);
  const glow = page.locator('[data-testid="edge-glow"]');
  await expect(glow).toHaveAttribute('data-tone', 'green');
  const style = await glow.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { pointerEvents: cs.pointerEvents, zIndex: cs.zIndex, position: cs.position };
  });
  expect(style.pointerEvents).toBe('none');
  expect(style.zIndex).toBe('54');
  // v0.37.0 FB-A+H(민구) — full-bleed: absolute→fixed(뷰포트=물리 화면 가장자리, safe-area 패딩 탈출).
  expect(style.position).toBe('fixed');
  // v0.38.0 #6 — 불투명 네비는 그대로 두되 글로우보다 아래에 쌓아 하단 코어+sweep이 가려지지 않는다.
  const tabBarZ = await page.locator('[data-testid="tab-bar"]').evaluate((el) => getComputedStyle(el).zIndex);
  expect(Number(tabBarZ)).toBeLessThan(Number(style.zIndex));
  const bottomSweep = await page.locator('[data-glow-sweep="bottom"]').boundingBox();
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  expect(bottomSweep, '하단 sweep이 렌더됨').not.toBeNull();
  expect(bottomSweep!.y + bottomSweep!.height, '하단 sweep이 물리 뷰포트 끝에 닿음').toBeCloseTo(viewportHeight, 0);
  // green 레이어만 불투명, red/amber 레이어는 투명(크로스페이드 구조 — box-shadow 재페인트 없음).
  const layerOpacity = await glow.evaluate((el) => {
    const get = (t: string) =>
      parseFloat(getComputedStyle(el.querySelector(`[data-glow-layer="${t}"]`)!).opacity);
    return { green: get('green'), amber: get('amber'), red: get('red') };
  });
  expect(layerOpacity.green).toBe(1);
  expect(layerOpacity.amber).toBe(0);
  expect(layerOpacity.red).toBe(0);

  // 직전 100.0 → 120.5 = increase 알람 → red.
  await fireStt(page, '120.5', 700);
  await expect(page.locator('[data-testid="anomaly-alert"]')).toBeVisible({ timeout: 3000 });
  await expect(glow).toHaveAttribute('data-tone', 'red');

  // [확인] 터치(글로우가 팝업 버튼을 안 가리고 안 막는다) → 해제 → green 복귀.
  // 고정 타임아웃 대신 관측 결과(팝업 해제)를 먼저 기다린 뒤 톤을 단언한다(비동기 advance 체인과
  // 레이스하던 fixed-wait 제거 — confirmAnomalyTouch가 setAnomalyAlert(null) 후 advance/announceField가
  // 이어져 톤 반영이 500ms를 넘길 수 있었다).
  await page.locator('[data-testid="anomaly-confirm-btn"]').click();
  await expect(page.locator('[data-testid="anomaly-alert"]')).toBeHidden();
  await expect(glow).toHaveAttribute('data-tone', 'green');
  console.log('✓ 글로우: ready 미렌더 → green → 이상치 red → 확인 green, pointer-events:none·zIndex 54');
});

test('B8/#5 — micLost 자동 1회 성공: 수동 배너는 한 번도 노출되지 않고 green으로 복귀', async ({ page }) => {
  await boot(page);
  await startSession(page);
  const glow = page.locator('[data-testid="edge-glow"]');
  const statusControl = page.locator('[data-testid="voice-status-control"]');
  await expect(glow).toHaveAttribute('data-tone', 'green');
  await expect(statusControl).toHaveAttribute('data-tone', 'green');
  await expect(statusControl).toHaveAttribute('data-status', 'listening');

  const callsBefore = await page.evaluate(() => (window as unknown as { __getUserMediaCallCount: number }).__getUserMediaCallCount);
  await page.evaluate(() => {
    const w = window as unknown as {
      __fakeMicTrack: { readyState: string };
      __micBannerEverSeen?: boolean;
    };
    w.__micBannerEverSeen = false;
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="mic-reconnect-btn"]')) w.__micBannerEverSeen = true;
    }).observe(document.body, { childList: true, subtree: true });
    w.__fakeMicTrack.readyState = 'ended';
  });
  await fireStt(page, '99.5', 700);

  await expect.poll(() => page.evaluate(() => (window as unknown as { __getUserMediaCallCount: number }).__getUserMediaCallCount))
    .toBe(callsBefore + 1);
  await expect(page.locator('[data-testid="mic-reconnect-btn"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __micBannerEverSeen: boolean }).__micBannerEverSeen)).toBe(false);
  await expect(glow).toHaveAttribute('data-tone', 'green');
  await expect(statusControl).toHaveAttribute('data-status', 'listening');
});

test('B8/#5 — 자동 실패 계측·배너·1회 가드, 이후 수동 탭에는 자동 이벤트 없음', async ({ page }) => {
  await boot(page);
  await startSession(page);
  const callsBefore = await page.evaluate(() => (window as unknown as { __getUserMediaCallCount: number }).__getUserMediaCallCount);
  await page.evaluate(() => {
    const w = window as unknown as {
      __fakeMicTrack: { readyState: string };
      __failNextGetUserMedia: number;
    };
    w.__failNextGetUserMedia = 1;
    w.__fakeMicTrack.readyState = 'ended';
  });
  await fireStt(page, '99.5', 700);

  await expect(page.locator('[data-testid="mic-reconnect-btn"]')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('[data-testid="edge-glow"]')).toHaveAttribute('data-tone', 'red');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __getUserMediaCallCount: number }).__getUserMediaCallCount))
    .toBe(callsBefore + 1);
  await page.waitForTimeout(3500); // recoverStream 쿨다운이 끝나도 자동 반복 금지
  expect(await page.evaluate(() => (window as unknown as { __getUserMediaCallCount: number }).__getUserMediaCallCount))
    .toBe(callsBefore + 1);

  const autoBeforeManual = (await loadLogExtras(page)).filter((extra) => extra.startsWith('mic_auto_reconnect:'));
  expect(autoBeforeManual).toEqual([
    'mic_auto_reconnect:attempt',
    'mic_auto_reconnect:result=failed',
  ]);

  await page.locator('[data-testid="mic-reconnect-btn"]').click();
  await expect(page.locator('[data-testid="mic-reconnect-btn"]')).toHaveCount(0);
  await page.waitForTimeout(300); // logger IDB fire-and-forget 정착
  const autoAfterManual = (await loadLogExtras(page)).filter((extra) => extra.startsWith('mic_auto_reconnect:'));
  expect(autoAfterManual).toEqual(autoBeforeManual);
});

test('B8 — --voice-level로 글로우 강도 변조(레벨 0이어도 톤 표시 유지)', async ({ page }) => {
  await boot(page);
  await startSession(page);
  const glow = page.locator('[data-testid="edge-glow"]');

  await injectLevel(page, 0);
  const base = await glow.evaluate((el) => parseFloat(getComputedStyle(el).opacity));
  expect(base).toBeGreaterThan(0.5); // baseline — 레벨 0(프리롤 미가용 폴백)에도 톤은 보인다
  // 오라클 동일(loud > base+0.3) — 전체 스위트 부하에서 rAF가 --voice-level=1을 150ms 안에 못
  //   밀 수 있어 poll로 감싼다(완화 아님: 같은 변조 임계를 그대로 검증, 비동기 정착만 대기).
  await injectLevel(page, 1);
  await expect
    .poll(() => glow.evaluate((el) => parseFloat(getComputedStyle(el).opacity)))
    .toBeGreaterThan(base + 0.3); // calc(0.55 + level*0.45) 변조
  console.log('✓ 글로우 강도: baseline 유지 + 레벨 변조');
});

// ─── D11b. 계측 — ui_fx 1건(세션 시작) ──────────────────────────────────────

test('D11b — 세션 시작 시 ui_fx:wave=on,glow=on,preroll=<...> 1건(IDB logEvents)', async ({ page }) => {
  await boot(page);
  await startSession(page);
  await page.waitForTimeout(700); // recorder.init() 정착 + IDB fire-and-forget flush

  const uiFx = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const all = await new Promise<Array<{ extra?: string }>>((res, rej) => {
      const r = db.transaction('logEvents', 'readonly').objectStore('logEvents').getAll();
      r.onsuccess = () => res(r.result as Array<{ extra?: string }>);
      r.onerror = () => rej(r.error);
    });
    db.close();
    return all.filter((e) => typeof e.extra === 'string' && e.extra.startsWith('ui_fx:'));
  });
  console.log(`ui_fx events: ${JSON.stringify(uiFx.map((e) => e.extra))}`);
  expect(uiFx.length).toBe(1);
  expect(uiFx[0].extra).toMatch(/^ui_fx:wave=on,glow=on,preroll=(worklet|script|unavailable)$/);
  // headless는 getUserMedia 거부 → preroll=unavailable = 파동 레벨 0 폴백 경로가 계측에 남는다.
  console.log('✓ ui_fx 계측 1건 (wave_stats는 프리롤 가용 기기에서만 — 실기기 로그 확인 항목)');
});

// ─── v0.36.0 리뷰 라운드1 수용분 (Codex/Flash/Pro) ─────────────────────────────

// v0.37.0 FB-D — 막대 파형 전환으로 canvas stroke 카운터는 waveMoved(scaleY 지문 변화)로 대체됨.

// R1-1 (Codex+Pro 공통, A1) — confirm 1회 확산 레이어가 tone 전환(green→red) 후 잔존하지 않는다.
//   종전 useConfirmSeq는 단일 effect라 플래시 도중 tone이 바뀌면 cleanup이 제거 타이머를 취소하고
//   재실행은 seq 조기 반환 → setSeq(null) 미호출 → 초록 레이어가 경고색 위에 영구 잔존했다.
test('R1-1 — 깨끗한 커밋: confirm 확산 1회 후 소멸 / 이상치 전환 후 confirm 레이어 잔존 0', async ({ page }) => {
  await boot(page);
  await startSession(page);
  const glow = page.locator('[data-testid="edge-glow"]');
  await expect(glow).toHaveAttribute('data-tone', 'green');

  // 대조군(공허 방지): 깨끗한 커밋(감소 — trendRule 'increase'라 미발화) → 확산 레이어가 실제로
  // 떴다가 900ms 애니메이션 뒤 제거된다(레이어 장착 경로가 살아 있음을 증명).
  await fireStt(page, '99.5', 150);
  await expect(page.locator('[data-glow-confirm]')).toBeVisible({ timeout: 1500 });
  await expect(page.locator('[data-glow-confirm]')).toHaveCount(0, { timeout: 2500 });

  // 이상치 커밋(row2 직전 100.0 → 120.5 증가) → tone red 전환. 확산 레이어가 어느 시점에 장착됐든
  // 1.3초(타이머 950ms 초과) 뒤에는 잔존이 없어야 한다.
  await fireStt(page, '120.5', 400);
  await expect(glow).toHaveAttribute('data-tone', 'red', { timeout: 3000 });
  await page.waitForTimeout(1300);
  await expect(page.locator('[data-glow-confirm]'), 'tone 전환 후 confirm 레이어 잔존 금지').toHaveCount(0);
  await expect(glow).toHaveAttribute('data-tone', 'red');
  console.log('✓ R1-1: confirm 확산 1회 소멸 + red 전환 후 잔존 0');
});

// R1-2 (Codex+Flash 공통, A2) — 발화 도중 일시정지 → 재개 시 interim 찌꺼기가 남지 않는다.
//   인식기가 멈추면 final이 안 와 종전엔 이전 발화가 재개 화면에 현재 값처럼 재노출됐다.
test('R1-2 — 발화 도중 일시정지 → 재개 시 interim 표시가 비어 있다', async ({ page }) => {
  await boot(page);
  await startSession(page);

  await fireSttInterim(page, '사십이 점', 150);
  await expect(page.locator('[data-testid="interim-value"]')).toBeVisible();
  await expect(page.locator('[data-testid="interim-value"]')).toHaveText('사십이 점');

  await page.locator('button[title="일시정지"]').click();
  await expect(page.locator('[data-testid="paused-card"]')).toHaveAttribute('aria-label', '일시정지');
  await expect(page.locator('[data-testid="paused-card"]')).toHaveText('');
  await page.locator('button[title="재시작"]').click();
  await expect(page.locator('[data-hero-state="listening"]')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('[data-testid="interim-value"]'), '재개 후 이전 발화 찌꺼기 금지').toHaveCount(0);
  console.log('✓ R1-2: pause→resume 후 interim 비어 있음');
});

// R1-3 (Codex, A3) — complete(검토 대기)에서도 STT는 종료/수정/이동 명령을 듣는다 → 파형·글로우
//   레벨이 계속 살아 있어야 한다(죽은 표시는 "안 듣는다" 오인). paused만 정지.
test('R1-3 — complete 검토 대기: 글로우 레벨 rAF·파형 draw가 계속 살아 있다', async ({ page }) => {
  await boot(page);
  await startSession(page);
  // 2행 × 1 음성열(c8, trendRule increase) — 감소 값 2회로 알람 없이 완주 → phase 'complete'.
  await fireStt(page, '99.5', 300);
  // [TEST-TTS-MOCK-1] 비동기 onend: 첫 행의 완료/다음 항목 안내가 끝나 실제로 2행 listening에
  // 도달한 뒤 다음 발화를 보낸다. 고정 wait로 TTS 중 발화를 버리는 false-red를 막는다.
  await expect(page.locator('[data-testid="active-row"]')).toHaveText('2', { timeout: 5000 });
  await expect(page.locator('[data-hero-state="listening"]')).toBeVisible({ timeout: 5000 });
  await waitForTtsIdle(page);
  await fireStt(page, '99.0', 300);
  await expect(page.locator('[data-hero-state="review"]')).toBeVisible({ timeout: 4000 });

  // 글로우 레벨 rAF 가동(complete에서도 --voice-level 갱신). 오라클 동일('0.300'/'0.900') — 전체
  //   스위트 부하에서 rAF 플러시가 150ms 고정대기보다 늦을 수 있어 poll로 감싼다(완화 아님).
  await injectLevel(page, 0.3);
  await expect.poll(() => glowVar(page), { message: 'complete에서 레벨 rAF 가동' }).toBe('0.300');
  await injectLevel(page, 0.9);
  await expect.poll(() => glowVar(page)).toBe('0.900');

  // 파형 막대 지속(정지 평막대가 아니라 실시간으로 움직인다).
  await injectLevel(page, 0.8);
  await page.waitForTimeout(200);
  expect(await waveMoved(page, 500), 'complete에서 파형 막대 지속(움직임)').toBe(true);
  console.log('✓ R1-3: complete에서 glowVar 갱신 + 파형 막대 이동');
});

// R1-4 (Flash 테스트 노트, D13) — paused에서 파형 rAF가 실제로 멈춘다(수명주기 단언 — toBeVisible
//   같은 표면 단언이 아니라 막대 transform 정지/재개를 직접 관측).
test('R1-4 — 일시정지: 파형 rAF 실중지(막대 정지), 재시작 시 재개', async ({ page }) => {
  await boot(page);
  await startSession(page);
  const band = page.locator('[data-testid="live-listen-band"]');
  const activeBandBox = await band.boundingBox();
  await injectLevel(page, 0.8);
  await page.waitForTimeout(200);
  expect(await waveMoved(page, 400), '활성 중엔 막대가 움직인다').toBe(true);

  await page.locator('button[title="일시정지"]').click();
  await expect(page.locator('[data-testid="paused-card"]')).toBeVisible();
  await page.waitForTimeout(400); // effect 재실행(평막대 정착) — active=false → rAF 미가동
  expect(await waveMoved(page, 700), 'paused 중 막대 transform 정지(rAF 미가동)').toBe(false);
  const pausedBandBox = await band.boundingBox();
  expect(pausedBandBox!.height, '상태 전환에도 파형 밴드 높이 고정').toBe(activeBandBox!.height);
  // v0.40.0 — 정지 상태의 표현이 "납작 막대"에서 **정적 글리프**로 바뀌었다. 계약은 그대로:
  //   일시정지에서는 rAF가 돌지 않고(위 waveMoved=false), 인디케이터가 정지 상태를 그린다.
  const pausedGlyph = await page.locator('[data-testid="state-dots"]').evaluate((el) => ({
    glyph: el.getAttribute('data-glyph'),
    mode: el.getAttribute('data-mode'),
    lit: Array.from(el.querySelectorAll('span'))
      .filter((c) => Number((c as HTMLElement).style.opacity || '1') > 0.02).length,
  }));
  expect(pausedGlyph.glyph, '일시정지 글리프(||)').toBe('pause');
  expect(pausedGlyph.mode, '일시정지에는 파형 모드가 아니다').toBe('glyph');
  expect(pausedGlyph.lit, '정지 상태에도 글리프가 그려진다').toBeGreaterThan(0);

  // 재시작하면 rAF가 다시 돈다(수명주기 계약의 반대 방향).
  await page.locator('button[title="재시작"]').first().click();
  await expect(page.locator('[data-testid="paused-card"]')).toHaveCount(0);
  await injectLevel(page, 0.8);
  await page.waitForTimeout(200);
  expect(await waveMoved(page, 400), '재시작 후 다시 움직인다').toBe(true);
});

// ─── v0.37.0 FB-A — 듣는 중 traveling sweep(4엣지 순환) 실제 적용 확인 ────────────────────────
/** edge-glow 내부에서 edge-sweep-* 애니메이션을 가진 요소들의 animationName 목록. */
async function sweepAnims(page: Page): Promise<string[]> {
  return page.locator('[data-testid="edge-glow"]').evaluate((el) =>
    Array.from(el.querySelectorAll('div'))
      .map((d) => getComputedStyle(d as HTMLElement).animationName)
      .filter((n) => n.startsWith('edge-sweep')),
  );
}

test('FB-A — 듣는 중(green): traveling sweep 바 4개가 edge-sweep 4엣지 순환 애니메이션으로 흐른다(점멸 아님)', async ({ page }) => {
  await boot(page);
  await startSession(page);
  const glow = page.locator('[data-testid="edge-glow"]');
  const statusControl = page.locator('[data-testid="voice-status-control"]');
  await expect(glow).toHaveAttribute('data-tone', 'green');
  await expect(statusControl).toHaveAttribute('data-status', 'listening');
  await expect(statusControl).toHaveAttribute('aria-label', '일시정지');

  // 호흡(점멸) 레이어는 sweep과 별개로 존재 — "점멸만"이 아니라 sweep도 함께 흐르는지 본다.
  const pulseAnim = await page.locator('[data-glow-pulse]').evaluate((el) => getComputedStyle(el).animationName);
  expect(pulseAnim, '호흡(edge-pulse) 레이어 존재').toBe('edge-pulse');

  // 4엣지 순환 sweep: 상(x)·하(x-reverse)·우(y)·좌(y-reverse) — reference-ui inset-sweep 동형.
  const sweeps = await sweepAnims(page);
  console.log(`sweep anims: ${JSON.stringify(sweeps)}`);
  expect(sweeps.length, '듣는 중 sweep 바 4개').toBe(4);
  expect(new Set(sweeps)).toEqual(
    new Set(['edge-sweep-x', 'edge-sweep-x-reverse', 'edge-sweep-y', 'edge-sweep-y-reverse']),
  );

  // 일시정지(mono, v0.44.0 §C4) → sweep 제거(호흡만 — §5.2 배터리). "점멸만" 상태와 대비되는 대조군.
  await page.locator('button[title="일시정지"]').click();
  await expect(glow).toHaveAttribute('data-tone', 'mono');
  expect(await sweepAnims(page), 'paused엔 sweep 없음(호흡만)').toHaveLength(0);
  // 와이어프레임 §[3](2026-07-24 확정) — 일시정지에서는 하단 `<`가 **재개** 버튼이므로 인디케이터를
  //   또 하나의 재개 버튼으로 두지 않는다(같은 행동의 중복 타깃 제거) → voice-status-control 부재.
  //   상태 표시 계약은 유지된다: 인디케이터 도트가 `||` 글리프로 바뀌고 재개 버튼이 노출된다.
  await expect(statusControl, '일시정지에선 인디케이터가 버튼이 아니다').toHaveCount(0);
  await expect(page.locator('[data-testid="state-dots"]')).toHaveAttribute('data-glyph', 'pause');
  await expect(page.locator('button[title="재시작"][aria-label="재시작"]')).toBeVisible();
  console.log('✓ FB-A: 듣는 중 4엣지 sweep+상태심볼 fade / paused는 글로우 호흡+정지심볼 fade');
});

// ─── v0.37.0 FB-I — 알람 영역 격리(인접 영역 침범 없음) ───────────────────────────────────────
test('FB-I — 이상치 알람 카드가 흡수영역에 격리 — 파형/컨트롤 영역을 침범하지 않는다', async ({ page }) => {
  await boot(page);
  await startSession(page);
  const listeningBandHeight = await page.locator('[data-testid="live-listen-band"]').evaluate(
    (el) => el.getBoundingClientRect().height,
  );

  await fireStt(page, '120.5', 700);
  const card = page.locator('[data-testid="anomaly-alert"]');
  await expect(card).toBeVisible({ timeout: 3000 });

  const cardBox = await card.boundingBox();
  const bandBox = await page.locator('[data-testid="live-listen-band"]').boundingBox();
  const waveBox = await page.locator('[data-testid="state-dots"]').boundingBox();
  expect(bandBox!.height, '알람 중에도 파형 밴드는 상태 전 높이를 유지').toBe(listeningBandHeight);
  // 알람 카드는 파형 밴드(row3) 위(흡수영역 row2)에 머문다 — 파형/컨트롤을 덮지 않는다(격리).
  expect(cardBox!.y + cardBox!.height, '알람 카드 하단이 파형 밴드 위').toBeLessThanOrEqual(waveBox!.y + 2);
  // 컨트롤바(중앙 일시정지 버튼)는 알람과 겹치지 않고 정상 조작 가능(격리 = 컨트롤 접근 유지).
  const pause = page.locator('button[title="일시정지"]');
  const pauseBox = await pause.boundingBox();
  expect(pauseBox!.y, '컨트롤바가 알람 카드보다 아래(비침범)').toBeGreaterThanOrEqual(cardBox!.y + cardBox!.height - 2);
  await pause.click({ trial: true }); // 알람 중에도 컨트롤 히트테스트 가능
  console.log(`✓ FB-I 격리: card.bottom=${Math.round(cardBox!.y + cardBox!.height)} wave.y=${Math.round(waveBox!.y)} pause.y=${Math.round(pauseBox!.y)}`);
});

// ─── v0.37.0 FB-F — 알람 중 미확정 인식값 스트립(카드 아래·파형 위, 실제 인식값만) ─────────────
test('FB-F — 이상치 알람 중 정정 발화 interim이 카드 아래·파형 위 스트립에 실제 인식값으로 표시', async ({ page }) => {
  await boot(page);
  await startSession(page);

  // 직전 100.0 → 120.5 = increase 알람.
  await fireStt(page, '120.5', 700);
  const card = page.locator('[data-testid="anomaly-alert"]');
  await expect(card).toBeVisible({ timeout: 3000 });

  // 정정 재발화 interim → 미확정 인식값 스트립. §10: 표시값은 STT 원문(interimValue)이지 lastTts/항목명이 아님.
  await fireSttInterim(page, '110.0', 150);
  const strip = page.locator('[data-testid="interim-value"]');
  await expect(strip).toBeVisible({ timeout: 2000 });
  await expect(strip, '스트립은 실제 인식 원문을 그대로 보인다').toHaveText('110.0');

  // 위치: 알람 카드 아래 + 파형 위.
  const cardBox = await card.boundingBox();
  const stripBox = await strip.boundingBox();
  const waveBox = await page.locator('[data-testid="state-dots"]').boundingBox();
  expect(stripBox!.y, '스트립은 알람 카드 상단보다 아래').toBeGreaterThanOrEqual(cardBox!.y);
  expect(stripBox!.y, '스트립은 파형 밴드보다 위').toBeLessThanOrEqual(waveBox!.y + 2);
  console.log(`✓ FB-F: 알람 중 인식 스트립 '110.0' (card.y=${Math.round(cardBox!.y)} strip.y=${Math.round(stripBox!.y)} wave.y=${Math.round(waveBox!.y)})`);
});
