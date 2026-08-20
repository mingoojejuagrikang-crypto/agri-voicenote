/**
 * v0.33.0 safe-area 게이트 — 아이폰 17 일반(노치, 402×874) standalone PWA 기준.
 *
 * playwright.config.ts의 `iphone17` 프로젝트 전용 spec(chromium 프로젝트는 testIgnore).
 * fixtures/safeArea.ts가 --sat:62px/--sab:34px를 주입해 노치+홈인디케이터를 시뮬레이션한다.
 * 검증 대상: v0.33.0에서 보호가 추가된 fixed 오버레이 3곳 + 탭바 —
 *   ① 데이터탭 Backdrop/SessionDetailModal (maxHeight 90vh→100%가 핵심 수정)
 *   ② 입력탭 CommandHelpPopup (하단 닫기 버튼이 홈바에 잘리지 않아야 함)
 *   ③ 입력탭 저장확인 인라인
 *   ④ TabBar (탭 버튼이 홈인디케이터 위에 있어야 함)
 * 각 오버레이가 시뮬레이션된 inset 안(safe bounds)에 완전히 들어오고, 인터랙티브 요소가
 * 잘리지 않고 실제로 탭 가능한지를 단언한다.
 *
 * 실행: `npx playwright test safe-area` — 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다(수동 기동 불필요, [ORCH-27]).
 */
import { type Page, type Locator } from '@playwright/test';
import { test, expect, safeBounds } from './fixtures/safeArea';
import { BASE } from './baseUrl';
import { GUM_GRANT_SCRIPT } from './fixtures/gum';

test.setTimeout(120_000);

const STORE_KEY = 'agri-voicenote-settings-v3';

// ── 공용 단언 ────────────────────────────────────────────────
/** 요소가 safe bounds(노치 아래·홈바 위·좌우 inset 안)에 **완전히** 들어와 있는지 단언.
 *
 *  🔴 v0.47.0 r2 P7 — `skipBottom` 옵션이 생겼다. **탭바 하나만 쓴다.** 기본값은 종전 그대로
 *  (하단도 단언)이라 다른 8개 호출부의 계약은 1비트도 바뀌지 않는다. 옵션을 「기본 off」로 둔 이유가
 *  그것이다 — 계약 완화가 파일 전체로 새면 이 스펙의 존재 이유가 사라진다. */
async function expectWithinSafeBounds(
  page: Page, locator: Locator, label: string, opts: { skipBottom?: boolean } = {},
) {
  const vp = page.viewportSize();
  expect(vp, 'viewport must be set by the iphone17 project').not.toBeNull();
  const safe = safeBounds(vp!);
  const box = await locator.boundingBox();
  expect(box, `${label} must be visible (boundingBox null)`).not.toBeNull();
  const b = box!;
  const EPS = 0.5; // sub-pixel rounding
  expect(b.y, `${label} top(${b.y}) must clear the notch(${safe.top})`).toBeGreaterThanOrEqual(safe.top - EPS);
  if (!opts.skipBottom) {
    expect(b.y + b.height, `${label} bottom(${b.y + b.height}) must clear the home indicator(${safe.bottom})`).toBeLessThanOrEqual(safe.bottom + EPS);
  } else {
    // 하단 계약을 면제해도 **뷰포트 밖으로 나가는 것은 여전히 실패**다(잘림 = 탭 불가).
    expect(b.y + b.height, `${label} bottom(${b.y + b.height}) must stay inside the viewport(${vp!.height})`).toBeLessThanOrEqual(vp!.height + EPS);
  }
  expect(b.x, `${label} left(${b.x})`).toBeGreaterThanOrEqual(safe.left - EPS);
  expect(b.x + b.width, `${label} right(${b.x + b.width})`).toBeLessThanOrEqual(safe.right + EPS);
}

/** 인터랙티브 요소가 잘리지 않았는지: safe bounds 안 + 가시 + 실제 히트테스트(탭) 가능. */
async function expectTappable(page: Page, locator: Locator, label: string, opts: { skipBottom?: boolean } = {}) {
  await expectWithinSafeBounds(page, locator, label, opts);
  await expect(locator, `${label} must be visible`).toBeVisible();
  // trial:true — 실제 클릭 없이 액션 가능성(히트테스트·가림 여부)만 검증.
  await locator.click({ trial: true });
}

// ── ① 탭바 ───────────────────────────────────────────────────
/**
 * 🔴 **v0.47.0 r2 P7 — 이 테스트의 계약이 뒤집혔다** (정당 파손 · 민구 08-09 실기기 점검 FB-H).
 *
 * 종전 제목은 *"탭 버튼이 홈인디케이터(--sab) 위에 완전히 위치"* 였고 그게 v0.33.0 이래의 계약이었다.
 * 민구 원문: *"지금 하단에 빈 공간이 많이 보임. 아이폰의 키보드 펼쳤을때 언어와 마이크 버튼이 있는
 * 공간까지는 사용을 못하고 있음."* → 하단 패딩 축소를 **확정**했고, 그 대가인 **iOS 하단 스와이프
 * 오터치 위험을 명시적으로 감수**했다.
 *
 * 🔑 종전 계약을 「완화」한 게 아니라 **반대 방향으로 다시 단언**한다 — 침범이 사라지면 red다.
 *    그냥 하단 단언만 지우면 P7이 조용히 되돌려져도 green이라 회귀를 못 잡는다.
 *    좌우 inset·노치·히트테스트·뷰포트 잘림은 **그대로 전부 유지**된다.
 * 실측 근거(`TabBar.tsx` §반전): 버튼 하단이 840(= 874−34) → 862로 22px 내려왔다.
 */
test('탭바 — 탭 버튼이 홈인디케이터 영역을 의도적으로 침범한다 (P7 · 좌우/노치/히트테스트는 유지)', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const vp = page.viewportSize()!;
  const safe = safeBounds(vp);
  for (const id of ['settings', 'voice', 'data']) {
    const loc = page.locator(`[data-testid="tab-${id}"]`);
    await expectTappable(page, loc, `tab-${id}`, { skipBottom: true });
    const b = (await loc.boundingBox())!;
    // 🔴 회귀 방향 단언 — 「되찾았는가」를 직접 잰다.
    expect(
      b.y + b.height,
      `tab-${id} bottom(${b.y + b.height})은 홈인디케이터 경계(${safe.bottom})보다 아래여야 한다 — `
      + 'P7이 되돌려지면 여기서 잡힌다',
    ).toBeGreaterThan(safe.bottom);
  }
});

// ── ①-b 부팅 inset 실측 텔레메트리(main.tsx, v0.33.0 C) ──────
test('부팅 텔레메트리 — sa_insets가 시뮬레이션된 inset 실측값을 기록', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(800); // load 후 logger.log → IDB fire-and-forget 정착 대기
  const events = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db) return [];
    return new Promise<{ type?: string; extra?: string }[]>((res) => {
      const tx = db.transaction('logEvents', 'readonly');
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result as { type?: string; extra?: string }[]);
      req.onerror = () => res([]);
    });
  });
  const sa = events.filter((e) => e.type === 'app' && (e.extra ?? '').startsWith('sa_insets:'));
  expect(sa.length).toBeGreaterThanOrEqual(1);
  // 픽스처가 주입한 --sat:62/--sab:34를 getComputedStyle로 실측해 그대로 기록해야 한다.
  expect(sa[sa.length - 1].extra).toBe('sa_insets:top=62,bottom=34,left=0,right=0,standalone=browser');
});

// ── ② 데이터탭 — Backdrop + 세션 상세 모달 ───────────────────
/** 30행 세션 주입 — 모달이 maxHeight에 확실히 걸리게(90vh 침범 회귀를 실측으로 잡는 키). */
async function injectTallSession(page: Page) {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('IDB open blocked'));
    });
    const rows = Array.from({ length: 30 }, (_, i) => ({
      index: i + 1,
      values: { c6: String(i + 1), c8: (30 + i).toFixed(1), c9: (35 + i).toFixed(1) },
      complete: true,
    }));
    const session = {
      id: 'sess_safearea_tall',
      date: '2026-07-13',
      label: 'safe-area 게이트',
      columns: [
        { id: 'c6', name: '조사나무', type: 'int',   input: 'auto',  ttsAnnounce: true,  auto: { kind: 'seq', from: 1, to: 30 } },
        { id: 'c8', name: '횡경',     type: 'float', input: 'voice', ttsAnnounce: true,  auto: { kind: 'fixed', value: '' }, decimals: 1 },
        { id: 'c9', name: '종경',     type: 'float', input: 'voice', ttsAnnounce: true,  auto: { kind: 'fixed', value: '' }, decimals: 1 },
      ],
      rows,
      completedRows: 30,
      syncedRows: 0,
      startedAt: Date.now() - 120_000,
      finishedAt: Date.now() - 60_000,
    };
    await new Promise<void>((res, rej) => {
      const tx = db.transaction('sessions', 'readwrite');
      const req = tx.objectStore('sessions').put(session);
      req.onsuccess = () => res();
      req.onerror = () => rej(req.error);
    });
    db.close();
  });
}

test('데이터탭 — 세션 상세 모달이 노치/홈바를 침범하지 않음(30행, maxHeight 스트레스)', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await injectTallSession(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await page.locator('[data-testid="tab-data"]').click();
  await page.waitForTimeout(400);

  await page.locator('text=safe-area 게이트').first().click();
  const modal = page.locator('[data-testid="session-detail-modal"]');
  await expect(modal).toBeVisible({ timeout: 3000 });
  await page.waitForTimeout(300); // fade-up 애니메이션 정착

  await expectWithinSafeBounds(page, modal, 'session-detail-modal');
  await expectTappable(page, page.locator('[data-testid="session-detail-close"]'), 'session-detail-close');

  // 상한 불변식 — 모달의 해석된 maxHeight가 Backdrop의 safe-area 콘텐츠 박스를 넘지 않아야 한다.
  // vh 단위는 computed style에서 px로 절대화되므로(예: 90vh → '786.6px'), safe-area를 모르는
  // 물리 뷰포트 기준 상한(구버그 90vh)을 콘텐츠 높이와 무관하게 직접 잡는다. %/none은 부모
  // 콘텐츠 박스 기준이라 본질적으로 안전.
  const cap = await modal.evaluate((el) => {
    const backdrop = el.parentElement!;
    const bs = getComputedStyle(backdrop);
    const contentH = backdrop.clientHeight - parseFloat(bs.paddingTop) - parseFloat(bs.paddingBottom);
    return { maxHeight: getComputedStyle(el).maxHeight, contentH };
  });
  if (cap.maxHeight.endsWith('px')) {
    expect(parseFloat(cap.maxHeight), `modal maxHeight(${cap.maxHeight}) must fit backdrop content box(${cap.contentH}px)`).toBeLessThanOrEqual(cap.contentH + 0.5);
  }

  // 닫기 실동작(잘림 없이 실제 탭 가능) 확인.
  await page.locator('[data-testid="session-detail-close"]').click();
  await expect(modal).toBeHidden({ timeout: 3000 });
});

// ── ③·④ 입력탭 — 명령어 도움말 팝업 + 저장확인 인라인 ──
// STT/TTS 목 + 설정 시드는 v023-voice.spec.ts 패턴 재사용(자족 spec 관례).
const COLUMNS = [
  { id: 'c1', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];

const SETTINGS = {
  state: {
    googleConnected: true,
    userEmail: 'tester@example.com',
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_SAFEAREA_1/edit',
    sheetTab: 'Sheet1',
    columnsSheetId: 'SHEET_SAFEAREA_1',
    columnsSheetTab: 'Sheet1',
    columns: COLUMNS,
    tableGenerated: true,
    totalRows: 2,
    ttsRate: 1.05,
    recognitionTolerance: 0.6,
    sessionLabelColId: null,
    sessionAutoLabel: 'safearea-test',
    preferredVoiceName: '',
    roundDateColId: null,
  },
  version: 12,
};

const MOCK_INIT_SCRIPT = `
(function() {
  window.__ttsLog = [];
  var mockSynth = {
    speak: function(u) { window.__ttsLog.push(u.text);
      try { if (u.onstart) u.onstart(new Event('start')); } catch(e){}
      try { if (u.onend) u.onend(new Event('end')); } catch(e){} },
    cancel: function(){}, pause: function(){}, resume: function(){},
    getVoices: function(){ return [{ name:'Mock Korean', lang:'ko-KR', default:true, localService:true, voiceURI:'mock' }]; },
    speaking:false, pending:false, paused:false, onvoiceschanged:null,
    addEventListener:function(){}, removeEventListener:function(){}, dispatchEvent:function(){ return true; },
  };
  try { Object.defineProperty(window,'speechSynthesis',{ get:function(){ return mockSynth; }, configurable:true, enumerable:true }); }
  catch(e){ try { window.speechSynthesis = mockSynth; } catch(e2){} }

  function MockSTT(){ this._ls={}; this.continuous=true; this.interimResults=true; this.lang='ko-KR'; this.maxAlternatives=3; window.__mockSTT=this; }
  MockSTT.prototype.addEventListener=function(t,cb){ if(!this._ls[t])this._ls[t]=[]; this._ls[t].push(cb); };
  MockSTT.prototype.removeEventListener=function(t,cb){ if(this._ls[t])this._ls[t]=this._ls[t].filter(function(f){return f!==cb;}); };
  MockSTT.prototype.start=function(){ var s=this; setTimeout(function(){ (s._ls['start']||[]).forEach(function(cb){cb(new Event('start'));}); },5); };
  MockSTT.prototype.stop=function(){};
  MockSTT.prototype.abort=function(){ var s=this; setTimeout(function(){ (s._ls['end']||[]).forEach(function(cb){cb(new Event('end'));}); },5); };
  MockSTT.prototype.fireResult=function(transcript,confidence){ if(confidence===undefined)confidence=0.95;
    var ev={ resultIndex:0, results:{ length:1, 0:{ isFinal:true, length:1, 0:{ transcript:transcript, confidence:confidence } } } };
    (this._ls['result']||[]).forEach(function(cb){cb(ev);}); };
  try { Object.defineProperty(window,'SpeechRecognition',{ value:MockSTT, writable:true, configurable:true, enumerable:true }); }
  catch(e){ try { window.SpeechRecognition=MockSTT; } catch(e2){} }
  try { Object.defineProperty(window,'webkitSpeechRecognition',{ value:MockSTT, writable:true, configurable:true, enumerable:true }); }
  catch(e){ try { window.webkitSpeechRecognition=MockSTT; } catch(e2){} }
})();
`;

async function stubSheets(page: Page) {
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { values: [['조사일자', '조사나무', '횡경']] } });
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected' });
  });
}

async function setupAndStartVoice(page: Page) {
  await stubSheets(page);
  await page.addInitScript(MOCK_INIT_SCRIPT);
  // v0.44.1 [CLIP-INIT-SILENT-1] — 헤드리스 기본 gUM 거부가 이제 시끄럽다(재연결 배너가 상단
  // 도움말 버튼 클릭을 가로챔 — 실측). 이 스펙은 "정상 마이크" 전제이므로 승인 스텁을 깐다.
  await page.addInitScript({ content: GUM_GRANT_SCRIPT });
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
  const startBtn = page.locator('text=음성 입력 시작').first();
  await expect(startBtn).toBeVisible();
  await startBtn.click();
  await page.waitForTimeout(800);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
}

// ── ⑤ v0.37.0 FB-A+H — 엣지글로우 full-bleed(물리 화면 가장자리까지, safe-area 패딩 탈출) ──
//   종전 absolute 글로우는 App 루트의 safe-area 패딩(--sat:62/--sab:34) 안쪽 VoiceScreen 사각형에
//   갇혀 상단 레터박스가 생겼다. position:fixed inset:0으로 바꿔 뷰포트 전체(0,0)~(vw,vh)를 덮어야
//   한다 — 이 테스트는 safe-area가 주입된 iphone17 프로젝트에서 글로우가 (0,0)에서 시작함을 단언한다.
test('입력탭 — 엣지글로우가 safe-area를 넘어 물리 화면 가장자리까지 full-bleed', async ({ page }) => {
  await setupAndStartVoice(page);
  const vp = page.viewportSize()!;
  const glow = page.locator('[data-testid="edge-glow"]');
  await expect(glow).toBeVisible();
  const box = await glow.boundingBox();
  expect(box, 'edge-glow boundingBox').not.toBeNull();
  const b = box!;
  const EPS = 1;
  // 상단이 노치(--sat=62) 아래로 밀려나지 않고 물리 상단(0)에서 시작한다(레터박스 해소의 핵심).
  expect(b.y, `glow top(${b.y})은 safe-area(62)에 밀리지 않고 물리 상단 0`).toBeLessThanOrEqual(EPS);
  expect(b.x, `glow left(${b.x})은 물리 좌측 0`).toBeLessThanOrEqual(EPS);
  // 뷰포트 전체를 덮는다(하단 홈바 영역·탭바 뒤까지).
  expect(b.width, `glow width(${b.width}) ≈ 뷰포트 폭(${vp.width})`).toBeGreaterThanOrEqual(vp.width - EPS);
  expect(b.y + b.height, `glow bottom(${b.y + b.height}) ≈ 뷰포트 높이(${vp.height})`).toBeGreaterThanOrEqual(vp.height - EPS);
});

test('입력탭 — 명령어 도움말 팝업이 safe-area 안에 있고 하단 닫기가 잘리지 않음', async ({ page }) => {
  await setupAndStartVoice(page);

  await page.locator('button[aria-label="음성 명령어 도움말"]').click();
  const popup = page.locator('[data-testid="command-help-popup"]');
  await expect(popup).toBeVisible({ timeout: 3000 });
  await page.waitForTimeout(200);

  await expectWithinSafeBounds(page, popup, 'command-help-popup');
  // 핵심 인터랙티브: 하단 전폭 닫기 버튼 — 홈바(--sab) 위에 완전히 보여야 한다.
  await expectTappable(page, page.locator('[data-testid="cmd-help-close"]'), 'cmd-help-close');

  await page.locator('[data-testid="cmd-help-close"]').click();
  await expect(popup).toBeHidden({ timeout: 3000 });
});

test('입력탭 — 저장확인 인라인과 하단 버튼이 safe-area 안에 있고 팝업은 없다', async ({ page }) => {
  await setupAndStartVoice(page);

  // 일시정지 → 종료 → 같은 화면의 중앙/하단 의미만 저장확인으로 전환.
  await page.locator('button[title="일시정지"]').click();
  await page.waitForTimeout(300);
  await page.locator('button[title="입력 종료"]').click();
  const inline = page.locator('[data-testid="exit-confirm-inline"]');
  await expect(inline).toBeVisible({ timeout: 3000 });
  await page.waitForTimeout(200);

  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  await expectWithinSafeBounds(page, inline, 'exit-confirm-inline');
  await expectTappable(page, page.locator('button[title="계속 입력"]'), '계속 입력');
  await expectTappable(page, page.locator('button[title="종료 확인"]'), '종료 확인');

  // 잘림 없이 실동작: 계속 입력 → 인라인 상태 닫힘(세션 유지).
  await page.locator('button[title="계속 입력"]').click();
  await expect(inline).toBeHidden({ timeout: 3000 });
});
