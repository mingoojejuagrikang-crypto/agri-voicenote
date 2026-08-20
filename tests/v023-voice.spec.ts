/**
 * v0.23.0 입력탭(Vance) — B1(팝업 중앙 흡수, 375px 잘림 0) + B2(재질문 사유 큐) + B3(마이크 재연결 쿨다운).
 *
 *  B1 — AnomalyAlert/ModifyIndicator/PausedCard를 position:fixed 오버레이가 아니라 중앙 흡수영역
 *       (grid row3, 1fr, overflow:hidden) **안에** 렌더한다. 긴 항목명 + 큰 음수소수(-355.5)도 잘리지
 *       않아야 한다(GL-005 375px). 검증: 흡수된 카드가 row3 트랙 안에 있고(상하 경계 안), 가로로
 *       새지 않으며(scrollWidth ≤ clientWidth), 카드가 떠도 하단 컨트롤바 Y가 불변(v0.19.0 인변량).
 *  B2 — listening hero 아래 재질문 사유 큐(reaskReason). Mack의 sessionStore.reaskReason이 아직
 *       머지 전이라, 컴포넌트(ReaskCue) 단위 렌더만 DOM 주입 없이 직접 검증한다(통합은 머지 후).
 *  B3 — 마이크 재연결 버튼: 탭 후 쿨다운(~3s) 동안 비활성+"재연결 중…"로 더블탭 무반응 오인 방지.
 *
 *  STT/TTS 주입 + 설정 시드는 trend-alert.spec.ts 패턴 재사용. 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다(수동 기동 불필요, [ORCH-27]).
 */
import { test, expect, type Page } from '@playwright/test';
import { GUM_GRANT_SCRIPT, GUM_DENY_SCRIPT } from './fixtures/gum';
import { BASE } from './baseUrl';

// ── 와이어프레임 §[2](2026-07-24 확정) 반영 ────────────────────────────────────────────────
// 이상치 응답 대기의 [확인]/[수정]은 **카드 안이 아니라 하단 `<` `>` 자리**로 이동했다
// ("하단 `<` `>` → 확인/수정으로 변경(알람 동안만)"). 따라서 종전
// `popup.locator('[data-testid="anomaly-confirm-btn"]')`(카드 하위 탐색)를 `page.locator(...)`로
// 스코프만 넓힌다. **버튼의 존재·동작 단언은 그대로다** — 바뀐 것은 화면상 위치뿐이다.
// 버튼이 하단 바에 있다는 사실 자체는 v039-active-zones.spec.ts가 별도로 고정한다.

test.setTimeout(120_000);

const STORE_KEY = 'agri-voicenote-settings-v3';
const PHONE_375 = { width: 375, height: 812 };

function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const PREV_ROUND = localISO(new Date(Date.now() - 86_400_000));

// 긴 항목명 + 큰 음수소수(-355.5)로 B1 잘림 0을 시험. 횡경(c8): decrease = 작아지면 알람.
//   직전 100.0 → -355.5 발화 = 크게 작아짐(감소) → 추세 감소 알람 + 큰 음수값 카드.
const LONG_NAME = '과실 횡경 평균 측정값(좌우)';
const COLUMNS = [
  { id: 'c1', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'c3', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'c8', name: LONG_NAME, type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'decrease' },
];

const SETTINGS = {
  state: {
    googleConnected: true,
    userEmail: 'tester@example.com',
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_V023_1/edit',
    sheetTab: 'Sheet1',
    columnsSheetId: 'SHEET_V023_1',
    columnsSheetTab: 'Sheet1',
    columns: COLUMNS,
    tableGenerated: true,
    totalRows: 2,
    ttsRate: 1.05,
    recognitionTolerance: 0.6,
    sessionLabelColId: null,
    sessionAutoLabel: 'v023-test',
    preferredVoiceName: '',
    roundDateColId: null,
  },
  version: 12,
};

const HEADERS = ['조사일자', '농가명', '조사나무', LONG_NAME];
const SHEET_ROWS = [
  [PREV_ROUND, '이원창', '1', '100.0'],
  [PREV_ROUND, '이원창', '2', '100.0'],
];

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
      await route.fulfill({ json: { values: [HEADERS, ...SHEET_ROWS] } });
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected' });
  });
}

/** @param gum 마이크 획득 스텁(v0.49 r2). 로컬 헤드리스에서 `start()`의 gUM이 **응답하지 않아**
 *    세션 시작 자체가 막히므로 어느 쪽이든 하나는 깔아야 한다(제품 회귀 아님).
 *    · `'grant'`(기본) — 정상 마이크. `fixtures/gum.ts` 계약상 **재연결 배너가 뜨지 않는다**.
 *    · `'deny'` — 즉시 `NotAllowedError`. `init()`이 false로 **즉시** 끝나 시작은 그대로 진행되고,
 *      micLost 래치 → 재연결 배너가 선다. **배너를 재는 B3가 이걸 쓴다**(실기기 BT 끊김과 동형). */
async function setupAndStart(page: Page, gum: 'grant' | 'deny' = 'grant') {
  await page.setViewportSize(PHONE_375);
  await stubSheets(page);
  await page.addInitScript({ content: gum === 'deny' ? GUM_DENY_SCRIPT : GUM_GRANT_SCRIPT });
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
  const startBtn = page.locator('text=음성 입력 시작').first();
  await expect(startBtn).toBeVisible();
  await startBtn.click();
  await page.waitForTimeout(800);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
}

async function fireStt(page: Page, transcript: string, waitMs = 400) {
  await page.evaluate((t) => {
    (window as unknown as { __mockSTT?: { fireResult: (t: string, c: number) => void } })
      .__mockSTT?.fireResult(t, 0.95);
  }, transcript);
  await page.waitForTimeout(waitMs);
}

/** 신뢰도 명시 발화(B2 저신뢰 게이트 검증용). */
async function fireSttConf(page: Page, transcript: string, confidence: number, waitMs = 500) {
  await page.evaluate(({ t, c }) => {
    (window as unknown as { __mockSTT?: { fireResult: (t: string, c: number) => void } })
      .__mockSTT?.fireResult(t, c);
  }, { t: transcript, c: confidence });
  await page.waitForTimeout(waitMs);
}

type LogEv = {
  type?: string; extra?: string; ttsText?: string; confidence?: number;
  /** v0.35.0 R2-FIX-2 — command 이벤트의 파싱 결과(ui_suspend/ui_resume 등). */
  parsed?: string;
  // v0.34.0 D11a — 세션 시작 설정 스냅샷 필드(logger.ts SessionMeta 확장분).
  meta?: {
    recognitionTolerance?: number;
    ttsRate?: number;
    beepPositiveId?: string;
    beepNegativeId?: string;
    autoScreenCapture?: boolean;
    anomalyRuleCount?: number;
  };
};
/** logger가 IDB('agri-voicenote' / store 'logEvents')에 영속한 진단 이벤트를 읽는다(meta 포함). */
async function loadLogEvents(page: Page): Promise<LogEv[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db) return [];
    return new Promise<LogEv[]>((res) => {
      const tx = db.transaction('logEvents', 'readonly');
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result as LogEv[]);
      req.onerror = () => res([]);
    });
  });
}

const ttsLog = (page: Page) => page.evaluate(() => (window as unknown as { __ttsLog: string[] }).__ttsLog ?? []);

/** 흡수영역(grid row3) = display:flex + overflow:hidden 인 가운데 트랙. 칩 그리드(grid)·컨트롤바와
 *  구분하기 위해 anomaly-alert/paused-card/modify-indicator의 부모를 직접 잡는다. */
async function absorbTrackMetrics(page: Page, cardTestId: string) {
  return page.evaluate((tid) => {
    const card = document.querySelector(`[data-testid="${tid}"]`) as HTMLElement | null;
    if (!card) return null;
    const track = card.parentElement as HTMLElement | null;
    if (!track) return null;
    const cardR = card.getBoundingClientRect();
    const trackR = track.getBoundingClientRect();
    return {
      cardTop: cardR.top, cardBottom: cardR.bottom,
      trackTop: trackR.top, trackBottom: trackR.bottom,
      cardScrollW: card.scrollWidth, cardClientW: card.clientWidth,
      trackOverflowY: getComputedStyle(track).overflowY,
      trackDisplay: getComputedStyle(track).display,
    };
  }, cardTestId);
}

// ─── B1 ─────────────────────────────────────────────────────────
test('B1 — 이상치 카드가 중앙 흡수영역 안에 렌더 + 375px 긴이름/음수소수(-355.5) 잘림 0', async ({ page }) => {
  await setupAndStart(page);

  // 컨트롤바 기준 Y(입력 조절 토글) — 카드 표시 전.
  // v0.44.0 §C5-b — 접힌 토글은 nav 전용 오버레이가 돼 anomaly/paused에서 사라진다.
  // 이 테스트의 계약은 "하단 컨트롤바가 안 밀린다"이므로 앵커를 컨트롤바 자체로 바꾼다.
  const controlAnchor = page.locator('[data-testid="voice-control-bar"]');
  await expect(controlAnchor).toBeVisible({ timeout: 5000 });
  const yBefore = (await controlAnchor.boundingBox())!.y;

  // 직전 100.0 → -355.5 발화 = 큰 감소 → 추세 감소 알람(큰 음수소수 + 긴 항목명 카드).
  await fireStt(page, '-355.5', 700);

  const card = page.locator('[data-testid="anomaly-alert"]');
  await expect(card).toBeVisible({ timeout: 3000 });
  await expect(card).toContainText('-355.5');
  // v0.33.0 항목7 — "확인 또는 수정" 텍스트 힌트는 [확인][수정] 터치 버튼으로 대체.
  await expect(page.locator('[data-testid="anomaly-confirm-btn"]')).toBeVisible();
  await expect(page.locator('[data-testid="anomaly-modify-btn"]')).toBeVisible();
  console.log('✓ 이상치 카드 표시 + 음수소수/행동 버튼 포함');

  const m = await absorbTrackMetrics(page, 'anomaly-alert');
  expect(m).not.toBeNull();
  console.log(`track: display=${m!.trackDisplay} overflowY=${m!.trackOverflowY}`);
  console.log(`card top=${m!.cardTop.toFixed(0)} bottom=${m!.cardBottom.toFixed(0)} | track top=${m!.trackTop.toFixed(0)} bottom=${m!.trackBottom.toFixed(0)}`);
  console.log(`card scrollW=${m!.cardScrollW} clientW=${m!.cardClientW}`);

  // 흡수영역 = overflow:hidden 트랙(fixed 오버레이가 아님 — 부모 트랙이 흡수형).
  expect(m!.trackOverflowY).toBe('hidden');
  // 카드가 트랙 세로 경계 안(상단은 트랙 위에서 시작, 하단은 트랙 아래로 안 넘침 — 흡수 + 내부 스크롤).
  expect(m!.cardTop).toBeGreaterThanOrEqual(m!.trackTop - 1);
  expect(m!.cardBottom).toBeLessThanOrEqual(m!.trackBottom + 1);
  // 가로 잘림 0: 카드가 가로로 새지 않는다.
  expect(m!.cardScrollW).toBeLessThanOrEqual(m!.cardClientW + 1);
  console.log('✓ 카드 트랙 내부 + 가로 잘림 0(375px)');

  // 컨트롤바 Y 불변(v0.19.0 인변량 — 카드가 떠도 row3 1fr라 하단이 안 밀림).
  const yAfter = (await controlAnchor.boundingBox())!.y;
  console.log(`controlbar Y: before=${yBefore} after=${yAfter}`);
  expect(Math.abs(yBefore - yAfter)).toBeLessThanOrEqual(1);
  console.log('✓ 카드 표시 후에도 컨트롤바 Y 불변');
});

// UI-c 규칙 1 — 일시정지는 **중앙 비움**이고 상태는 도트/톤으로 보이며 텍스트는 aria에만 남는다.
//   따라서 "일시정지 카드가 중앙 흡수영역 안"이라는 형태 단언은 성립하지 않는다. 이 테스트가
//   지키던 **계약**(카드가 떠도 컨트롤바 Y가 안 밀린다 — v0.19.0 버그B)은 그대로 유지하고,
//   중앙이 실제로 비었는지까지 함께 고정한다.
test('B1 — 일시정지 전환에도 컨트롤바 Y 불변 + 중앙 비움(§[3])', async ({ page }) => {
  await setupAndStart(page);
  // v0.44.0 §C5-b — 접힌 토글은 nav 전용 오버레이가 돼 anomaly/paused에서 사라진다.
  // 이 테스트의 계약은 "하단 컨트롤바가 안 밀린다"이므로 앵커를 컨트롤바 자체로 바꾼다.
  const controlAnchor = page.locator('[data-testid="voice-control-bar"]');
  await expect(controlAnchor).toBeVisible({ timeout: 5000 });
  const yBefore = (await controlAnchor.boundingBox())!.y;

  await page.locator('button[title="일시정지"]').click({ force: true });
  await page.waitForTimeout(400);
  const paused = page.locator('[data-testid="paused-card"]');
  await expect(paused).toBeVisible();
  await expect(paused, '시각 상태어 대신 접근 가능한 상태명').toHaveAttribute('aria-label', '일시정지');
  await expect(paused, '일시정지 시각 텍스트 미렌더').toHaveText('');

  // §[3] 중앙 비움 — 값도 "일시정지됨" 문구도 없다.
  expect((await page.locator('[data-testid="voice-center-stage"]').innerText()).trim()).toBe('');
  // 중앙 트랙은 여전히 흡수형(overflow:hidden)이라 어떤 카드가 떠도 아래를 밀지 않는다.
  const track = await page.locator('[data-testid="voice-center-stage"]')
    .evaluate((el) => getComputedStyle(el as HTMLElement).overflowY);
  expect(track).toBe('hidden');

  const yAfter = (await controlAnchor.boundingBox())!.y;
  expect(Math.abs(yBefore - yAfter)).toBeLessThanOrEqual(1);
  console.log('✓ 일시정지: 중앙 비움 + 컨트롤바 Y 불변');
});

// ─── B2 ─────────────────────────────────────────────────────────
test('B2 — 재질문 사유 큐: 머지 전(reaskReason 미존재)엔 안전하게 미표시, listening hero는 정상', async ({ page }) => {
  await setupAndStart(page);
  await page.waitForTimeout(300);

  // 머지 전 현실: sessionStore.reaskReason 필드 없음 → VoiceScreen의 (sess.reaskReason ?? null)이
  //   null로 떨어져 ReaskCue는 렌더되지 않는다(방어적 읽기 — 크래시 없음).
  const cue = page.locator('[data-testid="reask-cue"]');
  expect(await cue.count()).toBe(0);
  console.log('✓ reaskReason 미존재 시 큐 미표시(방어적, 크래시 없음)');

  // 그래도 listening hero(항목명)는 정상 노출 — 큐 부재가 hero를 막지 않는다.
  await expect(page.getByText(LONG_NAME, { exact: false }).first()).toBeVisible();
  console.log('✓ 큐 부재에도 listening hero 정상');

  // 머지 후 검증 훅(Mack의 setReaskReason): reaskReason='low_confidence'→"소리가 불확실",
  //   'parse_failed'→"숫자로 인식 실패". 통합 시 이 testid(reask-cue)+data-reason으로 확인.
  // 런타임에 zustand 스토어에 필드를 주입할 수 있으면(머지 후) 아래가 양성 경로가 된다:
  const injected = await page.evaluate(() => {
    // 스토어가 window에 노출돼 있지 않으면 주입 불가 — 머지 전엔 false(스킵 신호).
    const w = window as unknown as { __sessionStore?: { setState: (p: Record<string, unknown>) => void } };
    if (!w.__sessionStore) return false;
    w.__sessionStore.setState({ reaskReason: 'parse_failed' });
    return true;
  });
  if (injected) {
    await expect(page.locator('[data-testid="reask-cue"][data-reason="parse_failed"]')).toBeVisible();
    await expect(page.locator('[data-testid="reask-cue"]')).toContainText('숫자로 인식 실패');
    console.log('✓ (양성 경로) reaskReason 주입 시 큐 표시');
  } else {
    console.log('ℹ 스토어 미노출(머지 전) — 양성 경로는 통합 후 활성(testid/reason 계약 명시).');
  }
});

// ─── B3 ─────────────────────────────────────────────────────────
test('B3 — 마이크 재연결 버튼 탭 → 쿨다운 동안 "재연결 중…"·비활성 → ~3s 후 재활성', async ({ page }) => {
  // 🔴 이 테스트만 **거부** 스텁이다 — 재는 것이 「마이크가 죽었을 때의 재연결 UI」라서,
  //    정상 마이크(grant)를 깔면 배너 자체가 뜨지 않는다(fixtures/gum.ts 계약).
  await setupAndStart(page, 'deny');

  // mock STT 환경엔 실제 클립 오디오 스트림이 없어, STT 활동이 시작되면 클립 레코더가 스트림 소실로
  //   판정 → micLost 래치 → 재연결 배너가 뜬다(실기기의 블루투스 끊김과 같은 경로). 한 번 STT를
  //   발화시켜 배너 노출을 유도한다.
  await fireStt(page, '12.3', 600);

  const btn = page.locator('[data-testid="mic-reconnect-btn"]');
  await expect(btn).toBeVisible({ timeout: 5000 });
  // 평상시(쿨다운 아님): 활성 + "재연결".
  await expect(btn).toBeEnabled();
  await expect(btn).toContainText('재연결');

  // 탭 → 즉시 비활성 + "재연결 중…"(더블탭 무반응 오인 방지).
  await btn.click();
  await page.waitForTimeout(150);
  await expect(btn).toBeDisabled();
  await expect(btn).toContainText('재연결 중');
  console.log('✓ 탭 직후 비활성 + "재연결 중…"');

  // 두 번째 탭은 무시(disabled) — 여전히 "재연결 중".
  await btn.click({ force: true });
  await page.waitForTimeout(150);
  await expect(btn).toBeDisabled();

  // 쿨다운(3s) 경과 → 재활성("재연결" 복귀). 배너가 여전히 떠 있다는 전제(재연결 실패 케이스).
  //   micLost가 성공으로 풀리면 배너 자체가 사라지는데, mock 환경은 스트림 복구가 안 되므로 배너 유지
  //   → 버튼만 다시 활성으로 돌아오는 핵심 경로를 검증한다(데드버튼 방지의 본질).
  await expect(btn).toBeEnabled({ timeout: 5000 });
  await expect(btn).toContainText('재연결');
  console.log('✓ ~3s 후 버튼 재활성(데드버튼 방지)');
});

// ─── B4 (마지막 행 자동 종료 제거 — 안내 후 대기) ───────────────────────────────
test('B4 — 마지막 행 완료 후 자동 종료 안 함(대기) · 값 발화는 재안내 · "종료"로만 종료 + 세션메타 tolerance 박제', async ({ page }) => {
  await setupAndStart(page);
  // 2행 × 1 음성열(c8). 추세(decrease, 직전 100.0) 안 건드리게 ≥100 값으로 두 행 채운다.
  await fireStt(page, '105.0', 600); // row1 c8
  await fireStt(page, '106.0', 900); // row2 c8 = 마지막 행

  // ① 자동 종료 X — ready('음성 입력 시작') 화면으로 복귀하지 않는다(안내 후 대기).
  const readyAfterLast = await page.locator('text=음성 입력 시작').first()
    .isVisible({ timeout: 1200 }).catch(() => false);
  expect(readyAfterLast).toBe(false);

  // ①-b hero가 검토 대기 표시 — 마지막 컬럼을 다시 묻는 것처럼 보이지 않아야 한다.
  //    (v0.34.0 A4 — listening 전용화의 예외 1분기.)
  //    v0.37.0 FB-E(민구 확정) — 검토 표시가 대형 **행 번호**('2')에서 **방금 입력한 값**으로 바뀌었다
  //    (hero-primary = 행의 마지막 음성 컬럼 c8 커밋값 '106'). 행 번호 의미는 aria-label로 보존.
  //    "마지막 행 뒤 자동 종료 없이 대기한다"는 메커니즘 검증은 동일하다.
  // UI-c 규칙 1 — 마지막 행까지 끝나면 중앙은 시각 상태어 없이 `X / N` + 종료다.
  //   방금 커밋한 값(커밋 영수증, v0.37.0 리뷰#1)은 그 위 얇은 확인 줄로 살아 있다. 검증하는
  //   계약은 동일 — "자동 종료 없이 대기하고, 방금 넣은 값을 보여준다".
  await expect(page.locator('[data-testid="complete-summary"]')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('[data-testid="complete-receipt-value"]')).toHaveText('106');
  await expect(page.getByRole('status', { name: '조사 완료, 전체 2행 중 2행 입력됨' })).toBeVisible();

  // ② end_reached_waiting 로깅 + 세션 시작 메타에 recognitionTolerance(0.6) 박제(설정값 미로깅 갭 해소).
  const events = await loadLogEvents(page);
  expect(events.some((e) => (e.extra ?? '').startsWith('end_reached_waiting'))).toBe(true);
  const startMeta = events.find((e) => e.type === 'session' && e.extra === 'start');
  expect(startMeta?.meta?.recognitionTolerance).toBe(0.6);
  // v0.34.0 D11a — 세션 시작 설정 스냅샷: 비프 최종 선택·TTS 속도·자동 캡처·이상치 규칙 개수가
  // meta에 박제된다(로그만으로 자가검증). 시드에 없는 필드는 마이그레이션이 기본값으로 치유:
  // beep 기본 'pos-rise'/'neg-fall'(beepVariants SSOT), autoScreenCapture 기본 true.
  // anomalyRuleCount: COLUMNS 중 c8(trendRule 'decrease') 하나 → 1(개수만 — 컬럼명 미로깅).
  expect(startMeta?.meta?.ttsRate).toBe(1.05);
  expect(startMeta?.meta?.beepPositiveId).toBe('pos-rise');
  expect(startMeta?.meta?.beepNegativeId).toBe('neg-fall');
  expect(startMeta?.meta?.autoScreenCapture).toBe(true);
  expect(startMeta?.meta?.anomalyRuleCount).toBe(1);

  // ③ 끝 도달 안내 TTS가 나갔다.
  // 🔴 v0.49 r2 W2(확정표 #5+6, 민구 08-13) — 정당 파손. 두 트리거의 문구가 **하나로 통합**됐고
  //   ("마지막행 입력. 이번 세션에 완료된 행은 N행.") '종료하려면…' 꼬리는 삭제됐다.
  //   종료 수단은 하단 ⏹과 '종료' 명령으로 상시 노출되므로 안내가 매번 되풀이할 이유가 없다.
  // 🔴 v0.49 r2 A12(codex F5) — **부분 문자열이 아니라 전체 바이트**로 잠근다. 종전엔
  //   `includes('마지막행 입력')`뿐이라 완료 행 수·나머지 어절·문장부호가 무엇으로 바뀌어도
  //   green이었다(다음 문구 회귀가 게이트를 통과하는 구멍). 2행 전부 완주했고 빈 행이 없으므로
  //   꼬리도 붙지 않는다.
  const EXPECTED_END = '마지막행 입력. 이번 세션에 완료된 행은 2행.';
  const tts1 = await ttsLog(page);
  const entry = tts1.filter((t) => t.startsWith('마지막행 입력'));
  expect(entry.length, '끝 도달 안내가 나가지 않았다').toBeGreaterThan(0);
  expect(entry[0]).toBe(EXPECTED_END);
  // 종료 꼬리는 **삭제됐다**(W2 확정표 #5+6) — 되살아나면 red.
  expect(entry[0]).not.toContain('종료');

  // ④ 종료 대기 중 값 발화 → 새 행 커밋 안 하고 재안내만(자동 종료 제거의 핵심).
  //    통합 이후 ③과 ④는 **같은 문구**다 — 같은 상태를 두 이름으로 부르지 않는다.
  const before = tts1.length;
  await fireStt(page, '99.9', 700);
  const tts2 = await ttsLog(page);
  const absorbed = tts2.slice(before).filter((t) => t.startsWith('마지막행 입력'));
  expect(absorbed.length, '흡수 재안내가 나가지 않았다').toBeGreaterThan(0);
  // 🔑 두 트리거 **동등**을 글자로 단언한다 — 「한 SSOT를 공유한다」가 이 계약의 내용이다.
  expect(absorbed[0]).toBe(entry[0]);
  // 여전히 세션 유지(ready 아님).
  const stillActive = await page.locator('text=음성 입력 시작').first()
    .isVisible({ timeout: 600 }).catch(() => false);
  expect(stillActive).toBe(false);

  // ⑤ "종료" 음성 명령 → 세션 종료(ready 복귀).
  await fireStt(page, '종료', 900);
  await expect(page.locator('text=음성 입력 시작').first()).toBeVisible({ timeout: 4000 });
});

test('B4 — 마지막 행 대기(완료) 상태에서 하단 종료 버튼으로 종료된다(FB-G, 음성 외 경로)', async ({ page }) => {
  await setupAndStart(page);
  await fireStt(page, '105.0', 600); // row1
  await fireStt(page, '106.0', 900); // row2 = 마지막

  // 대기 상태(자동 종료 X) — ready 아님.
  const ready = await page.locator('text=음성 입력 시작').first()
    .isVisible({ timeout: 1000 }).catch(() => false);
  expect(ready).toBe(false);

  // UI-e1 — 완료 상태도 `[‹][⏹][⏸][›]`를 유지한다. 종료 심볼은
  //   저장확인 인라인을 여는 영속 상태 컨트롤이다.
  await expect(page.locator('button[title="일시정지"]')).toBeVisible();
  const endBtn = page.locator('[data-testid="voice-status-control"][data-status="exit"]');
  await expect(endBtn).toBeVisible();
  await endBtn.click();
  await page.locator('button[title="종료 확인"]').click();
  await expect(page.locator('text=음성 입력 시작').first()).toBeVisible({ timeout: 4000 });
});

// ─── v0.35.0 R2-FIX-1/2 (리뷰 라운드2 — 종료 경로 데이터 무결성) ─────────────

test('R2-FIX-1 — persistSession resolve 전엔 phase가 ready로 가지 않는다(지연 persist 회귀)', async ({ page }) => {
  await setupAndStart(page);
  await fireStt(page, '105.0', 600); // row1
  await fireStt(page, '106.0', 900); // row2 = 마지막 → 완료(대기)

  // 종료 시 최종 persist를 인위적으로 지연(db.ts saveSession의 기존 seam).
  await page.evaluate(() => {
    (globalThis as typeof globalThis & { __survey011DelaySessionPutMs?: number })
      .__survey011DelaySessionPutMs = 1500;
  });

  const endBtn = page.locator('[data-testid="voice-status-control"][data-status="exit"]');
  await expect(endBtn).toBeVisible();
  await endBtn.click();
  await page.locator('button[title="종료 확인"]').click();

  // 지연 창 안(≈700ms) — 아직 persist 미완이므로 ready('음성 입력 시작')가 뜨면 안 된다.
  //   종전 코드(setPhase('ready')가 persist 앞)에선 여기서 즉시 ready가 떠 start()가 최종 flush를
  //   덮어쓸 수 있었다(Flash Critical). 이제 UI는 persist 완료까지 종료 중 상태를 유지한다.
  await page.waitForTimeout(700);
  await expect(page.locator('text=음성 입력 시작')).toHaveCount(0);

  // persist가 resolve된 뒤에만 ready로 전환.
  await expect(page.locator('text=음성 입력 시작').first()).toBeVisible({ timeout: 6000 });
  console.log('✓ 종료: persist 완료 전 ready 미노출 → 완료 후 ready(덮어쓰기 race 창 제거)');
});

test('R2-FIX-2 — 저장확인 인라인 동안 STT suspend, 취소 시 resume(ui_suspend/ui_resume 계측)', async ({ page }) => {
  await setupAndStart(page);
  await fireStt(page, '105.0', 600);
  await fireStt(page, '106.0', 900); // 완료 대기 — 이 상태에선 '종료' 음성명령 대기로 STT가 살아있다.

  const countOf = async (parsed: string) =>
    (await loadLogEvents(page)).filter((e) => e.parsed === parsed && e.extra === 'exit_confirm').length;

  // 저장확인 인라인 열기 → suspend.
  await page.locator('[data-testid="voice-status-control"][data-status="exit"]').click();
  await expect(page.locator('button[title="종료 확인"]')).toBeVisible();
  await expect.poll(() => countOf('ui_suspend'), { timeout: 3000 }).toBeGreaterThanOrEqual(1);
  expect(await countOf('ui_resume')).toBe(0); // 아직 열려 있으므로 resume 없음

  // 취소 → resume(확인 경로는 stop()이 정지시키므로 resume 없음).
  await page.locator('button[title="계속 입력"]').click();
  await expect(page.locator('button[title="종료 확인"]')).toHaveCount(0);
  await expect.poll(() => countOf('ui_resume'), { timeout: 3000 }).toBeGreaterThanOrEqual(1);
  console.log('✓ 저장확인 인라인: 열림 suspend → 취소 resume(배경 음성 오파싱 차단)');
});

// ─── B2 (재질문 사유 큐 실동작) ──────────────────────────────────────────────
test('B2 — 저신뢰도(conf<허용범위) 발화 → 사유 큐 low_confidence + stt_rejected_low_confidence(tolerance 동봉), 성공 시 해제', async ({ page }) => {
  await setupAndStart(page);
  // 🔴 v0.43.0 #3 — 발화를 `105.0`(파싱 가능)에서 `담백`(파싱 불가)으로 바꿨다.
  //   순서 반전 이후 저신뢰 게이트는 **파싱에도 실패했을 때만** 돈다. `105.0`은 이제
  //   신뢰도와 무관하게 커밋되므로(그게 #3의 목적이다) 이 테스트의 주제인 "저신뢰 재질문 +
  //   extra 바이트"를 더 이상 검사하지 못한다 — **green인데 아무것도 안 보는 상태**가 된다.
  //   `담백`(07-30 실기기 실제 발화, conf 0.887)은 파서를 통과하지 못하므로 신뢰도가
  //   유일한 판별자로 남아 주제가 보존된다. 짝 테스트(아래 파싱 실패 건)와 대조축도 그대로다.
  // row1 c8에 conf 0.3(<tolerance 0.6) → 저신뢰 재질문.
  await fireSttConf(page, '담백', 0.3, 700);

  const cue = page.locator('[data-testid="reask-cue"]');
  await expect(cue).toBeVisible({ timeout: 2500 });
  expect(await cue.getAttribute('data-reason')).toBe('low_confidence');

  const events = await loadLogEvents(page);
  const lowConf = events.find((e) => e.type === 'stt_rejected_low_confidence');
  expect(lowConf).toBeTruthy();
  // v0.26.0 F1 재변경(민구 최종 결정: 높을수록 엄격, 직접 매핑): extra는 다이얼 값(tolerance)과
  // 실제 임계(minConf)를 함께 싣는다. 기본 0.60 → minConfidenceForTolerance(0.6)=0.60. conf 0.3<0.6 거부.
  expect(lowConf?.extra).toBe('tolerance:0.6,minConf:0.6'); // 설정값 vs 신뢰도 대조 근거(방향 명시)

  // v0.48.1 U3(리뷰 codex medium) — 화면 사유(data-reason)와 로그만 검사하고 TTS 문자열 자체를
  // 아무도 안 재고 있었다("green이 P3 요구를 보장 안 함"). 여기서 **화면과 같은 사유 어휘가
  // 실제로 스피커에서 나갔는지**를 전체 문자열 리터럴로 잠근다 — 제품 상수(REASK_TTS)를
  // expected로 import하지 않고 손으로 그대로 옮겨 적는다(상수만 바뀌어도 이 줄은 안 따라
  // 바뀐다 — 통째로 삭제돼야만 검출되는 진짜 회귀 오라클).
  // 🔴 v0.49 r2 W2(확정표 #1, 민구 08-13) — 정당 파손. 꼬리("잘 못 들었습니다. {항목} 다시 말씀해
  //   주세요.")가 **삭제**됐고 TTS는 사유만 말한다. 화면(`ReaskCue`)은 상세본을 유지하므로
  //   위 `data-reason` 단언과 함께 「TTS는 축약 · 화면은 상세」 계약을 이 테스트가 양쪽에서 잠근다.
  expect(await ttsLog(page)).toContain('소리가 불확실.');
  expect(await ttsLog(page), 'TTS 꼬리는 삭제됐다 — 되살아나면 red')
    .not.toContain(`소리가 불확실. 잘 못 들었습니다. ${LONG_NAME} 다시 말씀해 주세요.`);

  // 성공 커밋 → 사유 큐 해제.
  await fireSttConf(page, '105.0', 0.95, 700);
  await expect(cue).toBeHidden({ timeout: 2500 });
});

test('B2 — 고신뢰지만 파싱 실패 → 사유 큐 parse_failed + stt_parse_failed(허용범위 게이트와 무관함 입증)', async ({ page }) => {
  await setupAndStart(page);
  // conf 0.95(허용범위 통과)지만 숫자로 파싱 불가 → "80~90%인데 재인식" 혼동의 실제 원인.
  await fireStt(page, '바나나 사과 포도', 700);

  const cue = page.locator('[data-testid="reask-cue"]');
  await expect(cue).toBeVisible({ timeout: 2500 });
  expect(await cue.getAttribute('data-reason')).toBe('parse_failed');

  const events = await loadLogEvents(page);
  expect(events.some((e) => e.type === 'stt_parse_failed')).toBe(true);
  // 저신뢰 이벤트는 없어야 한다(이건 신뢰도 문제가 아니라 파싱 문제).
  expect(events.some((e) => e.type === 'stt_rejected_low_confidence')).toBe(false);

  // v0.48.1 U3(리뷰 codex medium) — 위 low_confidence 짝과 동일 근거: 화면·로그만이 아니라
  // 실제 TTS 문자열을 리터럴로 잠근다.
  // 🔴 v0.49 r2 W2(확정표 #2, 민구 08-13) — 정당 파손. 꼬리 삭제, 사유만 말한다(#1과 같은 근거).
  expect(await ttsLog(page)).toContain('숫자로 인식 실패.');
  expect(await ttsLog(page), 'TTS 꼬리는 삭제됐다 — 되살아나면 red')
    .not.toContain(`숫자로 인식 실패. ${LONG_NAME} 다시 말씀해 주세요.`);

  // 🔴 v0.49 r2 W4 — 「숫자가 아예 없는」 발화(no_number)에는 구제 후보가 없다.
  //    계측이 사유 경계를 넘지 않는다는 것을 배선 층에서도 확인한다.
  expect(events.some((e) => String(e.extra ?? '').startsWith('would_salvage:'))).toBe(false);
});

test('B2-W4 — extraneous_token은 거절을 유지하면서 would_salvage 관측을 남긴다 (섀도 계측 배선)', async ({ page }) => {
  await setupAndStart(page);
  // 08-13 실측 원문. conf 0.95라 **저신뢰 게이트를 통과**하고 파싱 실패 경로로 내려간다.
  //   (저신뢰였다면 `stt_rejected_low_confidence`가 앞에서 return해 계측 자체가 안 난다 —
  //    그건 이 지표의 알려진 한계다. 산출물 「미확인」에 기록.)
  await fireStt(page, '상식 3.3', 800);

  const events = await loadLogEvents(page);
  // ① 거절은 그대로 — 값이 커밋되지 않았다.
  expect(events.some((e) => e.type === 'stt_parse_failed' && e.extra === 'extraneous_token')).toBe(true);
  expect(events.some((e) => e.type === 'value'), '🔴 구제값이 커밋되면 안 된다').toBe(false);
  // ② 「채택했더라면」의 값이 로그에 남는다 — 다음 회차가 오채택률을 재는 유일한 재료다.
  const salvage = events.filter((e) => String(e.extra ?? '').startsWith('would_salvage:'));
  expect(salvage.length, 'would_salvage 라인이 없으면 다음 회차가 잴 것이 없다').toBe(1);
  expect(salvage[0].extra).toBe('would_salvage:3.3'); // 정답은 33.3 — 그래서 채택하지 않는다
  // ③ `stt_parse_failed`의 extra는 **사유 단독**이어야 한다(SOP-003 바이트 계약, PRINCIPLES §4).
  const failEv = events.find((e) => e.type === 'stt_parse_failed');
  expect(failEv?.extra, '사유 필드에 꼬리가 붙으면 기존 집계가 갈린다').toBe('extraneous_token');
});

test('A4-r2 — 소수부 재질문 문맥에서는 would_salvage를 남기지 않는다 (지표 오염 차단)', async ({ page }) => {
  await setupAndStart(page);

  // ① 「111 점 에」 = 실기기 원문(iOS STT가 소수부를 오전사) → 정수부 유지 + 소수부만 재질문.
  //    이 발화는 **평소 문맥**이므로 구제 후보가 있으면 남는 것이 맞다 — 여기서 세어 둔다.
  await fireStt(page, '111 점 에', 900);
  const afterFirst = await loadLogEvents(page);
  expect(
    afterFirst.some((e) => e.type === 'stt_parse_failed' && e.extra === 'decimal_fraction_lost'),
    '소수부 재질문 문맥이 서지 않으면 이 테스트가 재는 상태가 아니다',
  ).toBe(true);
  const baseline = afterFirst.filter((e) => String(e.extra ?? '').startsWith('would_salvage:')).length;

  // ② 소수부만 기다리는 상태에서 파싱 실패 발화 — 구제 후보(3.3)가 잡히는 원문이다.
  await fireStt(page, '상식 3.3', 900);
  const events = await loadLogEvents(page);

  // 🔴 v0.49 r2 A4(합집합 C10) — 이 문맥의 발화는 **조각**이고 구제 후보도 조각이다. 이 계측의
  //    판정 방법은 "후보 vs 재발화 후 실제 커밋값" 대조인데, 조각 후보를 전체값 커밋과 대조하면
  //    비교 자체가 성립하지 않는다(정수부 111 + 조각 후보 vs 커밋 111.x). 다음 회차 모수가
  //    조용히 오염되므로 이 문맥에서는 기록하지 않는다.
  const salvage = events.filter((e) => String(e.extra ?? '').startsWith('would_salvage:'));
  expect(salvage.length, '소수부 재질문 문맥의 조각이 would_salvage로 기록됐다 — 지표 오염').toBe(baseline);

  // 거절·재질문 동작 자체는 **현행 그대로**여야 한다(A4는 계측만 끈다).
  expect(events.filter((e) => e.type === 'stt_parse_failed').length, '거절이 사라지면 안 된다')
    .toBeGreaterThanOrEqual(2);
  expect(events.some((e) => e.type === 'value'), '구제값이 커밋되면 안 된다').toBe(false);
});

/** `beep_play:kind=<kind>` 재생 계측 집계(v047-cfix4-alert-order.spec.ts와 같은 채널). */
async function beepCount(page: Page, kind: string): Promise<number> {
  const events = await loadLogEvents(page);
  return events.filter((e) => e.type === 'app' && String(e.extra ?? '').startsWith(`beep_play:kind=${kind}`)).length;
}

test('B2-r2 — 거절(저신뢰·파싱실패) 두 분기가 부정 비프를 낸다 + ReaskCue 병행 (민구 결정 ⓐ)', async ({ page }) => {
  // 🔴 v0.49 r3 #13(claude r2 LOW) — **고정 대기 + 비재시도 호출을 걷어냈다.** 종전엔
  //    `fireStt(…, 700)`의 고정 대기 뒤에 `expect(await beepCount(…)).toBe(n)`(IDB 읽기)과
  //    `await cue.getAttribute(…)`를 썼다 — 둘 다 Playwright의 재시도를 못 받는 형태라, 느린
  //    러너에서 IDB 쓰기나 속성 반영이 그 창을 넘기면 red가 난다(신규 게이트 스펙의 flake 예약).
  //    ⓐ **도달**은 `expect.poll`/`toHaveAttribute`로 기다리고 ⓑ **과다 재생 없음**은 짧은
  //    안정화 창 뒤의 단언으로 잰다. 두 축을 갈라야 한다: poll만 쓰면 n+1이 나도 n에 닿는
  //    순간 통과해 ③의 목적이 죽고, 고정 대기만 쓰면 느린 러너에서 도착이 늦어 red가 난다.
  //    (이 파일의 TTS 목은 onend가 **동기**라 공용 `waitForTtsIdle`의 in-flight 카운터가 없다 —
  //     그래서 정지 신호로 못 쓴다. 안정화 창은 늘려도 red가 안 되는 방향이라 안전하다.)
  await setupAndStart(page);

  // ① 저신뢰 거절.
  await fireSttConf(page, '담백', 0.3, 300);
  const cue = page.locator('[data-testid="reask-cue"]');
  await expect(cue).toBeVisible({ timeout: 2500 });
  await expect(cue).toHaveAttribute('data-reason', 'low_confidence');
  // 🔴 W2가 재질문 TTS를 두 어절로 줄이며 "재시도 신호는 화면 큐와 **부정 비프**가 전담한다"고
  //    적었지만 그 비프는 배선된 적이 없었다(합집합 C2). 화면을 끄고 2~3m 떨어져 쓰는
  //    사용자에게는 그 두 어절이 유일한 신호였다.
  await expect
    .poll(() => beepCount(page, 'reject'), { timeout: 5000, message: '저신뢰 거절에 부정 비프가 없다' })
    .toBe(1);
  // 화면 큐는 그대로 병행한다(비프가 화면 신호를 대체하는 것이 아니다).
  await expect
    .poll(() => ttsLog(page), { timeout: 5000, message: '사유 TTS도 그대로다' })
    .toContain('소리가 불확실.');

  // ② 파싱 실패 거절 — 같은 신호.
  await fireStt(page, '바나나 사과 포도', 300);
  await expect(cue).toHaveAttribute('data-reason', 'parse_failed');
  await expect
    .poll(() => beepCount(page, 'reject'), { timeout: 5000, message: '파싱 실패 거절에 부정 비프가 없다' })
    .toBe(2);

  // ③ 🔴 실측: **거절당 정확히 1회**다(브리핑 「연타 시 과다 재생은 실측 후 판단」).
  //    3회 더 거절시켜 3회만 느는지 본다 — 재질문 TTS/화면 큐 갱신마다 덧나면 여기서 잡힌다.
  await fireStt(page, '바나나 사과 포도', 300);
  await fireStt(page, '바나나 사과 포도', 300);
  await fireStt(page, '바나나 사과 포도', 300);
  // 도달은 poll로 **기다리고**(느린 러너에서 IDB 쓰기가 늦어도 red가 아니다),
  await expect
    .poll(() => beepCount(page, 'reject'), { timeout: 6000, message: '거절 5건인데 비프가 모자란다' })
    .toBe(5);
  // 과다 재생은 **안정화 창**으로 잰다. 이 대기는 「도착을 기다리는」 고정 대기가 아니라
  // 「더 늘지 않는다」를 재는 창이라, 늘려도 red가 되지 않고 줄여야만 false-green이 된다
  // (#13이 지목한 flake 방향과 반대 — 도착 대기만 poll로 옮기면 ③의 목적이 죽는다).
  await page.waitForTimeout(300);
  expect(await beepCount(page, 'reject'), '거절 1건당 비프 1회를 넘었다(연타 과다 재생)').toBe(5);

  // ④ 알람 비프와 **섞이지 않는다** — 거절 경로는 값을 커밋하지 않으므로 이상치 알람 자체가
  //    성립하지 않는다(중첩 실측 결론). kind를 갈라 둔 덕에 기존 alert 집계도 오염되지 않는다.
  expect(await beepCount(page, 'alert'), '거절이 알람 비프 집계를 오염시켰다').toBe(0);
  expect(await beepCount(page, 'commit'), '거절인데 커밋 확인음이 났다').toBe(0);
});
