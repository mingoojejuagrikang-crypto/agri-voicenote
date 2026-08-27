/**
 * v0.37.0 리뷰#1(Codex High, 민구: 커밋 영수증) — 검토(complete) 화면 '방금 입력한 값' 회귀.
 *
 * 결함(r2 잔여): 검토 표시값을 valueBurst에서 파생했는데 valueBurst는 **음성 커밋에서만** 발행됐다.
 *   따라서 한 행의 마지막 셀을
 *     (a) **수동 입력**으로 채우면  → 앞선 음성 셀의 stale 값을,
 *     (b) **이상치 정정**으로 채우면 → 정정 전 다른 셀의 값을,
 *   "방금 입력한 값"으로 오표시했다.
 * 수정: 모든 커밋 경로(음성·수동·이상치 정정)가 store commitReceipt를 발행하고, 검토 파생은 이 영수증을
 *   소비한다. 아래 오라클은 "마지막 셀을 어떤 경로로 채웠든 검토는 그 셀의 실제 커밋값을 보인다"이다.
 *   (d) '이전'으로 완료행을 재방문(새 영수증 없음)하면 중앙 값·상태어를 비우고 aria 상태만 남긴다.
 *
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다(수동 기동 불필요, [ORCH-27])
 * Mock/fixture 패턴은 manual-input.spec.ts와 동일(_aborted 가드 + __ttsLog).
 */
import { test, expect, type Page } from '@playwright/test';
import { BASE } from './baseUrl';

// ── 와이어프레임 §[2](2026-07-24 확정) 반영 ────────────────────────────────────────────────
// 이상치 응답 대기의 [확인]/[수정]은 **카드 안이 아니라 하단 `<` `>` 자리**로 이동했다
// ("하단 `<` `>` → 확인/수정으로 변경(알람 동안만)"). 따라서 종전
// `popup.locator('[data-testid="anomaly-confirm-btn"]')`(카드 하위 탐색)를 `page.locator(...)`로
// 스코프만 넓힌다. **버튼의 존재·동작 단언은 그대로다** — 바뀐 것은 화면상 위치뿐이다.
// 버튼이 하단 바에 있다는 사실 자체는 v039-active-zones.spec.ts가 별도로 고정한다.

test.setTimeout(120_000);

const STORE_KEY = 'agri-voicenote-settings-v3';

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
  try { Object.defineProperty(window,'speechSynthesis',{ get:function(){ return mockSynth; }, configurable:true, enumerable:true }); } catch(e){}
  var _addStyle = function() {
    var s = document.createElement('style');
    s.textContent = '* { animation-duration: 0ms !important; transition-duration: 0ms !important; }';
    (document.head || document.documentElement).appendChild(s);
  };
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _addStyle); } else { _addStyle(); }
  function MockSTT(){ this._ls={}; this.continuous=true; this.interimResults=true; this.lang='ko-KR'; this.maxAlternatives=3; window.__mockSTT=this; this._aborted=false; }
  MockSTT.prototype.addEventListener=function(t,cb){ if(!this._ls[t])this._ls[t]=[]; this._ls[t].push(cb); };
  MockSTT.prototype.removeEventListener=function(t,cb){ if(this._ls[t])this._ls[t]=this._ls[t].filter(function(f){return f!==cb;}); };
  MockSTT.prototype.start=function(){ this._aborted=false; var s=this; setTimeout(function(){ (s._ls['start']||[]).forEach(function(cb){cb(new Event('start'));}); },5); };
  MockSTT.prototype.stop=function(){};
  MockSTT.prototype.abort=function(){ this._aborted=true; var s=this; setTimeout(function(){ (s._ls['end']||[]).forEach(function(cb){cb(new Event('end'));}); },5); };
  MockSTT.prototype.fireResult=function(transcript,confidence){ if(this._aborted)return; if(confidence===undefined)confidence=0.95;
    var ev={ resultIndex:0, results:{ length:1, 0:{ isFinal:true, length:1, 0:{ transcript:transcript, confidence:confidence } } } };
    (this._ls['result']||[]).forEach(function(cb){cb(ev);}); };
  try { Object.defineProperty(window,'SpeechRecognition',{ value:MockSTT, writable:true, configurable:true, enumerable:true }); } catch(e){}
  try { Object.defineProperty(window,'webkitSpeechRecognition',{ value:MockSTT, writable:true, configurable:true, enumerable:true }); } catch(e){}
})();
`;

function localISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function fireStt(page: Page, transcript: string, waitMs = 400) {
  await page.evaluate((t) => {
    (window as unknown as { __mockSTT?: { fireResult: (t: string, c: number) => void } }).__mockSTT?.fireResult(t, 0.95);
  }, transcript);
  await page.waitForTimeout(waitMs);
}

async function loadLogEvents(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    if (!db || !db.objectStoreNames.contains('logEvents')) return [];
    return new Promise<Array<{ type: string; extra?: string }>>((resolve) => {
      const tx = db.transaction('logEvents', 'readonly');
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => resolve(req.result as Array<{ type: string; extra?: string }>);
      req.onerror = () => resolve([]);
    });
  });
}

async function waitForActiveChip(page: Page, colName: string, timeout = 5000) {
  await page.waitForFunction(
    (name) => {
      const chip = document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
      return (chip?.dataset.colName ?? '').includes(String(name));
    },
    colName,
    { timeout },
  );
}

async function openSheetFor(page: Page, colName: string) {
  await page.locator(`[data-testid="column-chip"][data-col-name="${colName}"]`).click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible({ timeout: 3000 });
}

async function typeKeys(page: Page, keys: string[]) {
  for (const k of keys) await page.locator(`[data-testid="manual-key-${k}"]`).click();
}

async function bootAndStart(page: Page, settings: unknown, route?: { prevRow: string[] }) {
  if (route) {
    await page.route('**://sheets.googleapis.com/**', async (r) => {
      if (r.request().method() === 'GET') {
        await r.fulfill({ json: { values: [
          ['조사일자', '농가명', '조사나무', '횡경', '종경'],
          route.prevRow,
        ] } });
        return;
      }
      await r.fulfill({ status: 404, body: 'unexpected' });
    });
  }
  await page.addInitScript(MOCK_INIT_SCRIPT);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ s, storeKey, withToken }) => {
      localStorage.clear();
      if (withToken) {
        localStorage.setItem('gs10_google_token', JSON.stringify({
          access_token: 'test-token', expires_at: Date.now() + 3600_000, email: 'tester@example.com',
        }));
      }
      localStorage.setItem(storeKey, JSON.stringify(s));
      indexedDB.deleteDatabase('agri-voicenote');
    },
    { s: settings, storeKey: STORE_KEY, withToken: !!route },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(200);
  await page.locator('text=음성 입력 시작').first().click();
  await page.waitForTimeout(700);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
}

// 1행 × 2 음성열(횡경·종경). 완료 시 다음 미완료 행이 없어 검토가 **머문다**(안정 단언).
function oneRowSettings(extra?: Record<string, unknown>) {
  return {
    state: {
      googleConnected: false, userEmail: null, sheet: null,
      sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_TEST_1/edit', sheetTab: 'Sheet1',
      columnsSheetId: 'SHEET_TEST_1', columnsSheetTab: 'Sheet1',
      availableSheets: [], manualMode: false,
      columns: [
        { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 1 } },
        { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
        { id: 'c9', name: '종경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, ...(extra ?? {}) },
      ],
      tableGenerated: true, totalRows: 1,
      ttsRate: 1.05, sessionLabelColId: null, sessionAutoLabel: 'review-receipt', noisyMode: false, preferredVoiceName: '',
    },
    version: 13,
  };
}

function oneRowThreeVoiceSettings() {
  const settings = oneRowSettings();
  settings.state.columns.push(
    { id: 'c10', name: '당도', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  );
  return settings;
}

function twoRowSettings() {
  const settings = oneRowSettings();
  settings.state.totalRows = 2;
  settings.state.columns[0] = {
    ...settings.state.columns[0],
    auto: { kind: 'seq', from: 1, to: 2 },
  };
  return settings;
}

function oneRowVoiceCorrectionSettings() {
  return {
    state: {
      googleConnected: true, userEmail: 'tester@example.com',
      sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_EXIT_PERSIST/edit', sheetTab: 'Sheet1',
      columnsSheetId: 'SHEET_EXIT_PERSIST', columnsSheetTab: 'Sheet1',
      columns: [
        { id: 'c1', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
        { id: 'c3', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
        { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 1 }, sampleKey: true },
        { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
        { id: 'c9', name: '종경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'increase' },
      ],
      tableGenerated: true, totalRows: 1, ttsRate: 1.05, sessionLabelColId: null,
      sessionAutoLabel: 'exit-persist-corrected', preferredVoiceName: '', roundDateColId: null,
    },
    version: 13,
  };
}

async function waitForRow(page: Page, targetRow: number, timeout = 5000) {
  await page.waitForFunction(
    (row) => {
      const match = document.body.innerText.match(/(\d+)\s*\/\s*\d+\s*행/);
      return match && Number(match[1]) === row;
    },
    targetRow,
    { timeout },
  );
}

// ─── [MODIFY-TARGET-1] 마지막 행 완료(atEnd) 수정 타깃 ────────────────────────
test('[MODIFY-TARGET-1] atEnd bare "수정" → 마지막 항목만 재입력 대상으로 비운다', async ({ page }) => {
  await bootAndStart(page, oneRowSettings());
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '30.7');
  await waitForActiveChip(page, '종경');
  await fireStt(page, '40.2', 600);
  await expect(page.locator('[data-testid="complete-summary"]')).toBeVisible({ timeout: 4000 });

  await fireStt(page, '수정', 600);
  await waitForActiveChip(page, '종경');

  const first = page.locator('[data-testid="column-chip"][data-col-name="횡경"]');
  const last = page.locator('[data-testid="column-chip"][data-col-name="종경"]');
  await expect(first).toContainText('30.7');
  await expect(last).toContainText('—');
  await expect(last).not.toContainText('40.2');
});

test('[MODIFY-TARGET-1] atEnd "수정 <첫컬럼명>" → 명시한 첫 항목을 타깃으로 캐스케이드한다', async ({ page }) => {
  await bootAndStart(page, oneRowThreeVoiceSettings());
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '30.7');
  await waitForActiveChip(page, '종경');
  await fireStt(page, '40.2');
  await waitForActiveChip(page, '당도');
  await fireStt(page, '12.3', 600);
  await expect(page.locator('[data-testid="complete-summary"]')).toBeVisible({ timeout: 4000 });

  await fireStt(page, '수정 횡경', 600);
  await waitForActiveChip(page, '횡경');

  const first = page.locator('[data-testid="column-chip"][data-col-name="횡경"]');
  const middle = page.locator('[data-testid="column-chip"][data-col-name="종경"]');
  const last = page.locator('[data-testid="column-chip"][data-col-name="당도"]');
  await expect(first).toContainText('—');
  await expect(first).not.toContainText('30.7');
  await expect(middle).toContainText('—');
  await expect(last).toContainText('—');
});

// ─── [EXIT-PERSIST-1] 조사 완료 뒤 종료 수단 상시 노출 ────────────────────────
test('[EXIT-PERSIST-1] 끝 도달 뒤 완료 행을 이동해도 하단 4버튼의 종료가 남는다', async ({ page }) => {
  await bootAndStart(page, twoRowSettings());
  // 짧은 현장폰 높이에서도 종료 승계가 기존 하단 밴드 높이를 바꾸지 않아야 한다.
  // 부트 뒤 축소해 이 과제와 무관한 기존 탭바↔시작버튼 겹침은 테스트 경로에서 분리한다.
  await page.setViewportSize({ width: 390, height: 568 });
  await waitForActiveChip(page, '횡경');
  await expect(page.locator('[data-testid="review-pause-hint"]')).toHaveCount(0);

  await fireStt(page, '30.7');
  await waitForActiveChip(page, '종경');
  await fireStt(page, '40.2');
  await waitForRow(page, 2);
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '31.8');
  await waitForActiveChip(page, '종경');
  await fireStt(page, '41.3', 600);

  // v0.44.0 §C3(F15·F21) — 중앙 종료 버튼은 삭제됐다. 완료 상태의 종료 진입은 하단 ⏹뿐이다.
  const centralExit = page.locator('[data-testid="complete-summary"] button');
  const persistentExit = page.locator('[data-testid="voice-status-control"][data-status="exit"]');
  await expect(page.locator('[data-testid="complete-summary"]')).toBeVisible({ timeout: 4000 });
  await expect(centralExit).toHaveCount(0);
  await expect(persistentExit).toBeVisible();
  await expect(persistentExit).toHaveText('⏹︎');
  await expect(persistentExit).toHaveAttribute('aria-label', '종료');
  await expect(persistentExit).toHaveAttribute('title', '입력 종료');

  // 끝 도달 뒤 다른 완료 행을 보면 중앙 요약은 사라지지만 하단 종료는 남는다.
  await page.getByRole('button', { name: '이전행', exact: true }).click();
  await waitForRow(page, 1);
  await expect(page.locator('[data-hero-state="review"]')).toBeVisible({ timeout: 4000 });
  await expect(centralExit).toHaveCount(0);
  await expect(persistentExit).toBeVisible();
  await expect(page.locator('[data-testid="review-pause-hint"]')).toHaveCount(0);

  // 완료 행에서 [다음]으로 완료 행에 재진입해도 announceEndReached가 재발화하지 않는다.
  await page.getByRole('button', { name: '다음행', exact: true }).click();
  await waitForRow(page, 2);
  await expect(page.locator('[data-hero-state="review"]')).toBeVisible({ timeout: 4000 });
  await expect(centralExit).toHaveCount(0);
  await expect(persistentExit).toBeVisible();

  // 인디케이터와 4버튼은 각자 배정된 세로 행 안에 남는다.
  const controlMetrics = await page.evaluate(() => {
    const indicatorRow = document.querySelector('[data-testid="voice-indicator-row"]')?.getBoundingClientRect();
    const actionRow = document.querySelector('[data-testid="voice-nav-row"]')?.getBoundingClientRect();
    const band = document.querySelector('[data-testid="live-listen-band"]')?.getBoundingClientRect();
    const dots = document.querySelector('[data-testid="state-dots"]')?.getBoundingClientRect();
    const exitControl = document.querySelector(
      '[data-testid="voice-status-control"][data-status="exit"]',
    )?.getBoundingClientRect();
    if (!indicatorRow || !actionRow || !band || !dots || !exitControl) return null;
    return {
      indicatorRow: { top: indicatorRow.top, bottom: indicatorRow.bottom, height: indicatorRow.height },
      actionRow: { top: actionRow.top, bottom: actionRow.bottom, height: actionRow.height },
      band: { top: band.top, bottom: band.bottom, height: band.height },
      dots: { top: dots.top, bottom: dots.bottom, height: dots.height },
      exit: { top: exitControl.top, bottom: exitControl.bottom, height: exitControl.height },
    };
  });
  const contained = (() => {
    if (!controlMetrics) return false;
    const epsilon = 1;
    return controlMetrics.band.top >= controlMetrics.indicatorRow.top - epsilon &&
      controlMetrics.band.bottom <= controlMetrics.indicatorRow.bottom + epsilon &&
      controlMetrics.dots.top >= controlMetrics.band.top - epsilon &&
      controlMetrics.dots.bottom <= controlMetrics.band.bottom + epsilon &&
      controlMetrics.exit.top >= controlMetrics.actionRow.top - epsilon &&
      controlMetrics.exit.bottom <= controlMetrics.actionRow.bottom + epsilon &&
      controlMetrics.indicatorRow.bottom <= controlMetrics.actionRow.top + epsilon;
  })();
  expect(
    contained,
    `검토 인디케이터/종료 컨트롤이 각 행 밖으로 넘침: ${JSON.stringify(controlMetrics)}`,
  ).toBe(true);

  // 기존 안전 게이트: 조절판이 열리면 종료를 포함한 하단 행동 행 전체가 사라지고, 닫으면 복귀한다.
  const controlsToggle = page.locator('[data-testid="input-control-toggle"]');
  await controlsToggle.click();
  await expect(controlsToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-testid="voice-nav-row"]')).toHaveCount(0);
  await expect(persistentExit).toHaveCount(0);
  await controlsToggle.click();
  await expect(controlsToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(persistentExit).toBeVisible();

  // 검토 상태의 가운데 종료도 기존 확인 다이얼로그를 재사용한다.
  await persistentExit.click();
  await expect(page.locator('button[title="종료 확인"]')).toBeVisible();
});

// ─── (a) 마지막 셀 = 수동 입력 ────────────────────────────────────────────────
test('(a) 앞 셀 음성 + 마지막 셀 수동 입력 → 검토는 수동값(4.2)을 보인다(앞 음성 셀 30.7 오표시 금지)', async ({ page }) => {
  await bootAndStart(page, oneRowSettings());
  await waitForActiveChip(page, '횡경');

  // 앞 셀(횡경)을 음성 커밋 → valueBurst=30.7(종전 파생 소스). advance로 종경 대기.
  await fireStt(page, '30.7');
  await waitForActiveChip(page, '종경');

  // 마지막 셀(종경)을 **수동 키패드**로 커밋 → 행 완료 → 검토 머묾.
  await openSheetFor(page, '종경');
  await typeKeys(page, ['4', '.', '2']);
  await page.locator('[data-testid="manual-commit"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toHaveCount(0);

  // 와이어프레임 §[4](2026-07-24 확정) — 마지막 행의 마지막 셀을 채우는 순간이 곧 **조사 완료**라
  //   중앙은 UI-c의 시각 상태어 없는 `X / N` + 종료로 바뀐다. 커밋 영수증(이 스펙의 계약: "방금 확정된 셀의 값을
  //   보여준다, stale·거부값 오표시 금지")은 그 위 확인 줄(complete-receipt)로 살아 있다.
  await expect(page.locator('[data-testid="complete-summary"]')).toBeVisible({ timeout: 4000 });
  // 핵심: 방금 수동 입력한 종경(4.2)을 보인다 — 종전 valueBurst 파생은 앞 음성 셀 30.7을 오표시했다.
  await expect(page.locator('[data-testid="complete-receipt-value"]')).toHaveText('4.2');
  await expect(page.getByRole('status', { name: '조사 완료, 전체 1행 중 1행 입력됨' })).toBeVisible();
});

// ─── (b) 마지막 셀 = 이상치 정정(수동 보류 [확인]) ─────────────────────────────
test('(b) 마지막 셀 이상치 정정 [확인] → 검토는 확정된 정정값(77.7)을 보인다(앞 셀 30.7·직전값 50 오표시 금지)', async ({ page }) => {
  const PREV = localISO(new Date(Date.now() - 86_400_000));
  const settings = {
    state: {
      googleConnected: true, userEmail: 'tester@example.com',
      sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_REVIEW_RECEIPT/edit', sheetTab: 'Sheet1',
      columnsSheetId: 'SHEET_REVIEW_RECEIPT', columnsSheetTab: 'Sheet1',
      columns: [
        { id: 'c1', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
        { id: 'c3', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
        { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 1 }, sampleKey: true },
        { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
        { id: 'c9', name: '종경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'increase' },
      ],
      tableGenerated: true, totalRows: 1, ttsRate: 1.05, sessionLabelColId: null,
      sessionAutoLabel: 'review-receipt-anomaly', preferredVoiceName: '', roundDateColId: null,
    },
    version: 13,
  };
  await bootAndStart(page, settings, { prevRow: [PREV, '이원창', '1', '10.0', '50.0'] });
  await waitForActiveChip(page, '횡경');

  // 앞 셀(횡경) 음성 커밋 → valueBurst=30.7. advance로 종경(이상치 규칙 열) 대기.
  await fireStt(page, '30.7');
  await waitForActiveChip(page, '종경');

  // 마지막 셀(종경)을 수동 77.7 커밋(직전 50.0 → increase 알람) → manualHold 보류 팝업.
  await openSheetFor(page, '종경');
  await typeKeys(page, ['7', '7', '.', '7']);
  await page.locator('[data-testid="manual-commit"]').click();
  const popup = page.locator('[data-testid="anomaly-alert"]');
  await expect(popup).toBeVisible({ timeout: 3000 });
  await expect(page.locator('[data-testid="anomaly-confirm-btn"]')).toBeVisible();

  // [확인] → confirmManualAnomaly가 77.7을 확정 + 진행 재개 → 행 완료 → 검토 머묾.
  await page.waitForTimeout(400); // durable put 정착(즉시 [확인] not_durable 차단 회피)
  await page.locator('[data-testid="anomaly-confirm-btn"]').click();
  await expect(popup).toHaveCount(0, { timeout: 4000 });

  // 와이어프레임 §[4](2026-07-24 확정) — 마지막 행의 마지막 셀을 채우는 순간이 곧 **조사 완료**라
  //   중앙은 UI-c의 시각 상태어 없는 `X / N` + 종료로 바뀐다. 커밋 영수증(이 스펙의 계약: "방금 확정된 셀의 값을
  //   보여준다, stale·거부값 오표시 금지")은 그 위 확인 줄(complete-receipt)로 살아 있다.
  await expect(page.locator('[data-testid="complete-summary"]')).toBeVisible({ timeout: 4000 });
  // 핵심: 정정 [확인]으로 확정된 종경(77.7)을 보인다 — 앞 음성 셀 30.7도, 비교 직전값 50.0도 아니다.
  const primary = page.locator('[data-testid="complete-receipt-value"]');
  await expect(primary).toHaveText('77.7');
  await expect(primary).not.toHaveText('30.7');
  await expect(primary).not.toHaveText('50');
});

test('[EXIT-PERSIST-1] 마지막 행 corrected 정정은 알람을 해제하고 종료 분기·계측 B/C를 방출한다', async ({ page }) => {
  const prev = localISO(new Date(Date.now() - 86_400_000));
  await bootAndStart(page, oneRowVoiceCorrectionSettings(), {
    prevRow: [prev, '이원창', '1', '10.0', '50.0'],
  });
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '30.7');
  await waitForActiveChip(page, '종경');

  // 직전 50.0보다 큰 77.7은 increase 알람, 이어 말한 40.0은 정상 정정값이다.
  await fireStt(page, '77.7');
  await expect(page.locator('[data-testid="anomaly-alert"]')).toBeVisible({ timeout: 3000 });
  await fireStt(page, '40.0', 800);

  await expect(page.locator('[data-testid="anomaly-alert"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="complete-summary"]')).toBeVisible({ timeout: 4000 });

  await expect.poll(async () => (await loadLogEvents(page)).map((event) => event.extra), {
    timeout: 4000,
  }).toContain('trend_alert_cleared:reason=end_reached,hadStatus=corrected');
  await expect.poll(async () => (await loadLogEvents(page)).map((event) => event.extra), {
    timeout: 4000,
  }).toContain('end_reached_render:branch=end,alertStatus=none');
});

// ─── (d) '이전'으로 완료행 재방문 → 시각 비움 + aria 상태(새 영수증 없음) ─────────
test('(d) 완료행을 "이전"으로 재방문(새 커밋 없음) → 중앙은 비우고 aria 완료 상태만 남긴다', async ({ page }) => {
  const settings = {
    state: {
      googleConnected: false, userEmail: null, sheet: null,
      sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_TEST_1/edit', sheetTab: 'Sheet1',
      columnsSheetId: 'SHEET_TEST_1', columnsSheetTab: 'Sheet1',
      availableSheets: [], manualMode: false,
      columns: [
        { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 } },
        { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
      ],
      tableGenerated: true, totalRows: 2,
      ttsRate: 1.05, sessionLabelColId: null, sessionAutoLabel: 'review-receipt-prev', noisyMode: false, preferredVoiceName: '',
    },
    version: 13,
  };
  await bootAndStart(page, settings);
  await waitForActiveChip(page, '횡경');

  // 행1 완료(음성) → 행2로 전진(활성). 커밋 시점 검토는 값을 보였으나 행 이동으로 fresh 창이 닫힌다.
  await fireStt(page, '11.1');
  await page.waitForFunction(() => {
    const m = document.body.innerText.match(/(\d+)\s*\/\s*\d+\s*행/);
    return m && parseInt(m[1]) === 2;
  }, undefined, { timeout: 6000 });

  // '이전' → 완료행(1) 재방문 = enterReviewWait(새 영수증 없음). stale 값도 시각 상태어도 없다.
  await fireStt(page, '이전행', 600);
  await expect(page.locator('[data-hero-state="review"]')).toBeVisible({ timeout: 4000 });
  await expect(page.locator('[data-testid="hero-primary"]'), 'stale 값·`1행 완료` 시각 문구 미렌더').toHaveCount(0);
  await expect(page.getByRole('status', { name: '1행 완료, 명령 대기' })).toBeVisible();
  await expect(page.locator('[data-testid="column-chip"][data-active="true"]'), '검토 포인터 항목은 칩존이 준다')
    .toContainText('횡경');
});

// ─── (e) 검토 중 터치 컬럼 인라인 편집 → 검토는 터치값을 보인다(Codex Medium #2, 터치 영수증) ─────
// 행 완료(voice)는 phase 'complete'로 검토를 띄운다. 그 상태에서 **터치 컬럼**을 인라인 편집하면
//   commitTouchValue가 커밋 영수증을 발행해 검토가 방금 입력한 터치값으로 갱신돼야 한다. 종전엔
//   터치 커밋이 영수증을 안 남겨 검토가 앞선 음성값(30.7)을 그대로 오표시했다.
test('(e) 검토 중 터치 컬럼 인라인 편집 → 검토는 터치값(88)을 보인다(앞 음성값 30.7 오표시 금지)', async ({ page }) => {
  const settings = {
    state: {
      googleConnected: false, userEmail: null, sheet: null,
      sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_TEST_1/edit', sheetTab: 'Sheet1',
      columnsSheetId: 'SHEET_TEST_1', columnsSheetTab: 'Sheet1',
      availableSheets: [], manualMode: false,
      columns: [
        { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 1 } },
        { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
        { id: 'cT', name: '수량', type: 'int', input: 'touch', ttsAnnounce: false, auto: { kind: 'fixed', value: '' }, sampleKey: false },
      ],
      tableGenerated: true, totalRows: 1,
      ttsRate: 1.05, sessionLabelColId: null, sessionAutoLabel: 'review-receipt-touch', noisyMode: false, preferredVoiceName: '',
    },
    version: 13,
  };
  await bootAndStart(page, settings);
  await waitForActiveChip(page, '횡경');

  // 유일 음성 컬럼(횡경) 커밋 → 행 완료(터치 컬럼은 완료 판정에 무관) → 검토 머묾, 값=30.7.
  await fireStt(page, '30.7');
  // 와이어프레임 §[4](2026-07-24 확정) — 마지막 행의 마지막 셀을 채우는 순간이 곧 **조사 완료**라
  //   중앙은 UI-c의 시각 상태어 없는 `X / N` + 종료로 바뀐다. 커밋 영수증(이 스펙의 계약: "방금 확정된 셀의 값을
  //   보여준다, stale·거부값 오표시 금지")은 그 위 확인 줄(complete-receipt)로 살아 있다.
  await expect(page.locator('[data-testid="complete-summary"]')).toBeVisible({ timeout: 4000 });
  await expect(page.locator('[data-testid="complete-receipt-value"]')).toHaveText('30.7');

  // 검토 중(phase complete) 터치 칩을 인라인 편집: 칩 탭 → input → 88 → Enter(커밋).
  const touchChip = page.locator('[data-testid="column-chip"][data-col-name="수량"]');
  await touchChip.click();
  const input = touchChip.locator('input');
  await expect(input).toBeVisible({ timeout: 2000 });
  await input.fill('88');
  await input.press('Enter');

  // 핵심: 검토가 방금 커밋된 터치값(88)으로 갱신된다 — 종전엔 앞 음성값 30.7이 그대로 남았다.
  await expect(page.locator('[data-testid="complete-receipt-value"]')).toHaveText('88', { timeout: 4000 });
  await expect(page.locator('[data-testid="column-chip"][data-col-name="수량"]')).toContainText('88');
});
