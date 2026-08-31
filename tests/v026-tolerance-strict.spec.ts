/**
 * v0.26.0 F1 재변경(민구 최종 결정 2026-07-03) — 인식 허용범위 "높을수록 엄격" 직접 매핑 검증.
 *
 *  이력: v0.24.0까지 높을수록 엄격 → v0.25.0 반전(높을수록 관대) → v0.26.0 원복(높을수록 엄격).
 *  방향이 두 번 뒤집혔으므로 **매핑 방향 자체를 고정하는 전용 스펙**을 둔다. 이 스펙이 깨지면
 *  방향이 또 바뀐 것이다 — 반드시 민구 결정 이력(settingsStore.ts 주석)을 확인하고 수정할 것.
 *
 *  T1 — 다이얼 0.9(엄격): conf 0.85 발화 → 거부(minConf 0.9). extra에 tolerance:0.9,minConf:0.9.
 *  T2 — 다이얼 0.4(관대): conf 0.45 발화 → 수용(값 커밋, 거부 이벤트 0).
 *  T3 — 입력 조절 스탭퍼가 "높을수록 엄격"을 명시(오해 재발 방지 가드).
 *
 *  STT/TTS 목·설정 시드는 v023-voice.spec.ts 패턴 재사용. 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다(수동 기동 불필요, [ORCH-27]).
 */
import { test, expect, type Page } from '@playwright/test';
import { BASE } from './baseUrl';
import { GUM_GRANT_SCRIPT } from './fixtures/gum';

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
  { id: 'c8', name: '과실 횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];

function settingsWithTolerance(tolerance: number) {
  return {
    state: {
      googleConnected: true,
      userEmail: 'tester@example.com',
      sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_V026_F1/edit',
      sheetTab: 'Sheet1',
      columnsSheetId: 'SHEET_V026_F1',
      columnsSheetTab: 'Sheet1',
      columns: COLUMNS,
      tableGenerated: true,
      totalRows: 2,
      ttsRate: 1.05,
      recognitionTolerance: tolerance,
      sessionLabelColId: null,
      sessionAutoLabel: 'v026-f1-test',
      preferredVoiceName: '',
      roundDateColId: null,
    },
    version: 13,
  };
}

const HEADERS = ['조사일자', '농가명', '과실 횡경'];
const SHEET_ROWS = [
  [PREV_ROUND, '이원창', '100.0'],
  [PREV_ROUND, '이원창', '100.0'],
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
  MockSTT.prototype.start=function(){ this._active=true; var s=this; setTimeout(function(){ (s._ls['start']||[]).forEach(function(cb){cb(new Event('start'));}); },5); };
  MockSTT.prototype.stop=function(){ this._active=false; };
  MockSTT.prototype.abort=function(){ this._active=false; var s=this; setTimeout(function(){ (s._ls['end']||[]).forEach(function(cb){cb(new Event('end'));}); },5); };
  MockSTT.prototype.fireResult=function(transcript,confidence){ if(confidence===undefined)confidence=0.95;
    if(!this._active) return;
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

async function setupAndStart(page: Page, tolerance: number) {
  await page.setViewportSize(PHONE_375);
  await stubSheets(page);
  await page.addInitScript(MOCK_INIT_SCRIPT);
  // v0.44.1 [CLIP-INIT-SILENT-1] — 헤드리스 기본 gUM 거부가 이제 시끄럽다(재연결 배너가 상단
  // 도움말 버튼 클릭을 가로챔 — T4·T5 실측). 이 스펙은 "정상 마이크" 전제이므로 승인 스텁을 깐다.
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
    { settings: settingsWithTolerance(tolerance), storeKey: STORE_KEY },
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

async function fireSttConf(page: Page, transcript: string, confidence: number, waitMs = 500) {
  await page.evaluate(({ t, c }) => {
    (window as unknown as { __mockSTT?: { fireResult: (t: string, c: number) => void } })
      .__mockSTT?.fireResult(t, c);
  }, { t: transcript, c: confidence });
  await page.waitForTimeout(waitMs);
}

type LogEv = { type?: string; parsed?: string; extra?: string; text?: string };
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

// ─── T1: 다이얼 높음(0.9) = 엄격 — 적당한 신뢰도(0.85)도 거부 ───────────────────
test('T1 — tolerance 0.9(엄격): conf 0.85 발화 거부 + extra tolerance:0.9,minConf:0.9', async ({ page }) => {
  await setupAndStart(page, 0.9);
  // 🔴 v0.43.0 #3 — 발화를 `105.0`(파싱 가능)에서 `담백`(파싱 불가)으로 바꿨다.
  //   순서 반전 이후 저신뢰 게이트는 **파싱에도 실패했을 때만** 돈다. `105.0`은 이제 다이얼과
  //   무관하게 커밋되므로 이 spec의 주제(다이얼→minConf **직접 매핑**)를 검사할 수 없다.
  //   파싱 불가 발화로 바꾸면 신뢰도가 유일한 판별자로 남아 매핑 방향이 그대로 관측된다.
  //   ⚠️ 이 spec이 지키는 것은 여전히 **매핑 방향**이다 — 깨지면 방향이 또 뒤집힌 것이니
  //   settingsStore.ts 주석의 민구 결정 이력부터 확인하라(#3 때문이라고 넘겨짚지 마라).
  await fireSttConf(page, '담백', 0.85, 700);

  const cue = page.locator('[data-testid="reask-cue"]');
  await expect(cue).toBeVisible({ timeout: 2500 });
  expect(await cue.getAttribute('data-reason')).toBe('low_confidence');

  const events = await loadLogEvents(page);
  const lowConf = events.find((e) => e.type === 'stt_rejected_low_confidence');
  expect(lowConf).toBeTruthy();
  expect(lowConf?.extra).toBe('tolerance:0.9,minConf:0.9'); // 직접 매핑: 다이얼값 = 임계
});

// ─── T2: 다이얼 낮음(0.4) = 관대 — 낮은 신뢰도(0.45)도 수용 ─────────────────────
test('T2 — tolerance 0.4(관대): conf 0.45 발화 수용(거부 이벤트 0)', async ({ page }) => {
  await setupAndStart(page, 0.4);
  await fireSttConf(page, '105.0', 0.45, 700);

  // 거부 큐가 뜨지 않고 값이 커밋된다(다음 행 진행 or 값 반영).
  const cueVisible = await page.locator('[data-testid="reask-cue"]')
    .isVisible({ timeout: 1200 }).catch(() => false);
  expect(cueVisible).toBe(false);

  const events = await loadLogEvents(page);
  expect(events.some((e) => e.type === 'stt_rejected_low_confidence')).toBe(false);
  expect(events.some((e) => e.type === 'value')).toBe(true); // 값 커밋 실재
});

// ─── T2b: 매핑의 관대 방향을 **게이트로** 확인 — #3 이후 T2만으로는 부족하다 ───────────
test('T2b — tolerance 0.4(관대): 파싱 불가 발화도 conf 0.45면 저신뢰 거절이 아니다(파싱 실패로 간다)', async ({ page }) => {
  // 🔴 v0.43.0 #3 이후 T2는 매핑을 검사하지 못한다. `105.0`은 파싱되므로 다이얼이 0.9였어도
  //   커밋됐을 것이다 — 즉 T2의 green은 **매핑과 무관해졌다.** T1과 같은 발화(`담백`)로
  //   신뢰도만 게이트 위/아래로 바꿔, 다이얼이 실제로 임계를 움직인다는 것을 양방향으로 고정한다.
  //   (T1: 0.85 < minConf 0.9 → 저신뢰 거절 / 여기: 0.45 > minConf 0.4 → 게이트 통과)
  await setupAndStart(page, 0.4);
  await fireSttConf(page, '담백', 0.45, 700);

  const events = await loadLogEvents(page);
  expect(events.some((e) => e.type === 'stt_rejected_low_confidence'), '0.45 > minConf 0.4 — 게이트를 통과해야 한다').toBe(false);
  expect(events.some((e) => e.type === 'stt_parse_failed'), '게이트를 통과했으니 파싱 실패로 재질문된다').toBe(true);

  const cue = page.locator('[data-testid="reask-cue"]');
  await expect(cue).toBeVisible({ timeout: 2500 });
  expect(await cue.getAttribute('data-reason')).toBe('parse_failed');
});

// ─── T3: 방향 문구 가드 — 스탭퍼 설명이 "높을수록 엄격" 명시 ──────────────────────
test('T3 — 입력 조절 스탭퍼에 "높을수록 엄격" 명시', async ({ page }) => {
  await setupAndStart(page, 0.6);

  const toggle = page.locator('[data-testid="input-control-toggle"]');
  // v0.37.0 FB-K(민구) — 라벨 '입력 조절'·'인식' 제거 → '허용 인식률'.
  await expect(toggle).toContainText('허용 인식률 60%');
  await toggle.click();

  const stepper = page.locator('[data-testid="stepper-tolerance"]');
  await expect(stepper).toBeVisible();
  await expect(stepper).toContainText('높을수록 엄격');
  await expect(page.locator('input[type="range"]')).toHaveCount(0);
});

// ─── T4: ？명령어 팝업 잘림 0 — 명령 추가 후에도 전 항목 접근 + 하단 닫기 고정 ────────────
test('T4 — 명령어 팝업: 마지막 명령까지 스크롤 접근 가능하고 하단 닫기는 항상 보임', async ({ page }) => {
  await setupAndStart(page, 0.6);

  await page.locator('button[title="음성 명령어 도움말"]').first().click();
  const closeBtn = page.locator('[data-testid="cmd-help-close"]');
  await expect(closeBtn).toBeVisible({ timeout: 3000 });
  await expect(page.locator('[data-testid="command-help-popup"]')).toContainText('도움말 중 입력 정지');

  // v0.38.0 #4-③ — 가시 버튼 명령 추가로 목록은 의도적으로 스크롤 가능하다. 마지막 명령도
  // 잘리지 않고 접근 가능하며, 하단 닫기는 목록 스크롤과 분리돼 항상 화면 안에 남아야 한다.
  // 🔴 v0.51 — 종전 기준점('음성 안내 속도를 한 단계 높입니다')은 **조절판 음성 명령 5종과 함께
  //   사라졌다**(민구 확정 08-31 «조절판은 손으로만»). 마지막 명령이 `screenOff`로 바뀌었으므로
  //   기준점도 그 문구로 옮긴다 — 🔑 이 문구는 **V-FIX4 계약**이라(도움말이 틀린 해제법을
  //   가르치면 사용자가 «켜지지 않는 화면»에 갇힌다) 앞으로도 임의로 바뀌지 않는다.
  const lastDesc = page.locator('text=2초 누르면 다시 켜집니다').first();
  await lastDesc.scrollIntoViewIfNeeded();
  await expect(lastDesc).toBeVisible();
  const box = (await lastDesc.boundingBox())!;
  const closeBox = (await closeBtn.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(closeBox.y + 1); // 목록이 닫기 버튼과 안 겹침
  expect(closeBox.y + closeBox.height).toBeLessThanOrEqual(PHONE_375.height + 1); // 닫기 버튼 화면 안

  // 하단 닫기 버튼으로 닫힌다(상단 ✕가 배너에 가려져도 닫기 경로 확보).
  await closeBtn.click();
  await expect(closeBtn).toBeHidden({ timeout: 2000 });
});

/** 🔴 **v0.51 — 이 테스트의 계약이 뒤집혔다**(정당 파손 · 민구 확정 2026-08-31).
 *
 *  종전 제목은 *"음성으로 도움말·입력 조절·인식률·안내속도 버튼을 동일 동작시킨다"* 였고
 *  그게 v0.38.0 #4-③ 이래의 계약이었다. 민구 원문: ***"조절판은 손으로만."***
 *  근거(조사 §⑪): ㉠ 이 명령이 필요한 순간은 「인식이 안 되는 순간」인데 명령 자체가 신뢰도
 *  0.7을 넘어야 한다(**순환**) ㉡ 6~7음절 최장이라 그 문턱이 가장 높다 ㉢ 결과(%)는 조절판을
 *  봐야 알고, 조절판이 닫혀 있으면 바뀐 줄도 모른다.
 *
 *  🔑 **계약을 「완화」한 게 아니라 반대 방향으로 다시 단언한다** — 그냥 음성 단언만 지우면
 *  누가 명령을 되살려도 green이라 회귀를 못 잡는다(`safe-area` P7이 같은 판단을 한 선례).
 *  ① 조절판 음성 경로는 **아무 일도 하지 않는다** ② **손 경로는 그대로 산다**
 *  ③ 남은 UI 음성 명령(도움말)은 종전대로 동작한다. */
test('T6 — 조절판은 손으로만 동작하고(음성 무동작) 도움말 음성은 그대로 산다', async ({ page }) => {
  await setupAndStart(page, 0.6);

  const toggle = page.locator('[data-testid="input-control-toggle"]');
  const tolStepper = page.locator('[data-testid="stepper-tolerance"]');

  // ① 🔴 음성은 무동작이다 — 접힌 채로 남는다.
  await fireSttConf(page, '입력 조절', 0.95);
  await expect(toggle, '음성 「입력 조절」이 아직 조절판을 연다 — 「손으로만」 계약 위반')
    .toHaveAttribute('aria-expanded', 'false');
  await expect(tolStepper, '조절판 내용이 렌더됐다 — 음성 경로가 살아 있다').toHaveCount(0);

  // ② 🟢 손 경로는 산다 — 여기가 red면 「경로 제거」가 아니라 「기능 삭제」가 된 것이다.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(tolStepper).toBeVisible();
  await expect(tolStepper).toContainText('60%');

  // ③ 🔴 스텝퍼 자체도 그대로 — 값이 손으로 움직인다(음성으로 하던 -0.05와 같은 한 단계).
  await page.locator('[data-testid="stepper-tolerance-minus"]').click();
  await expect(tolStepper, '스텝퍼가 값을 못 내린다 — 조절 기능 자체가 죽었다').toContainText('55%');

  // ④ 남은 UI 음성 명령은 종전대로 동작한다(제거가 UI 명령 전체로 번지지 않았다는 대조군).
  await fireSttConf(page, '도움말', 0.95);
  await expect(page.locator('[data-testid="command-help-popup"]')).toBeVisible();
});

test('T5 — 명령어 도움말이 열린 동안 STT 명령은 실행되지 않고 닫으면 복원된다', async ({ page }) => {
  await setupAndStart(page, 0.6);

  await expect(page.locator('[data-testid="active-row"]')).toHaveText('1');
  await page.locator('button[title="음성 명령어 도움말"]').first().click();
  await expect(page.locator('[data-testid="command-help-popup"]')).toBeVisible();

  await fireSttConf(page, '다음행', 0.95, 500);
  await expect(page.locator('[data-testid="active-row"]')).toHaveText('1');
  let events = await loadLogEvents(page);
  expect(events.some((e) => e.type === 'command' && e.parsed === 'nextRow')).toBe(false);

  await page.locator('[data-testid="cmd-help-close"]').click();
  await expect(page.locator('[data-testid="command-help-popup"]')).toBeHidden();

  await fireSttConf(page, '다음행', 0.95, 700);
  events = await loadLogEvents(page);
  expect(events.some((e) => e.type === 'command' && e.parsed === 'ui_resume' && e.extra === 'command_help')).toBe(true);
  expect(events.some((e) => e.type === 'command' && e.parsed === 'nextRow' && e.text === '다음행')).toBe(true);
});

/**
 * v0.38.0 리뷰#1(Codex High) — UI 음성명령이 **세션 경계를 넘어 재실행**되던 결함 회귀.
 *
 * 세션 A의 마지막 명령이 "도움말"인 채로 종료하면 uiCommand 신호가 남는다. 세션 B에서
 * ActiveState가 새로 마운트될 때 소비 시퀀스가 0으로 초기화돼, 사용자가 말하지도 않은 도움말이
 * 즉시 다시 열렸다(인식률 명령이면 설정이 한 번 더 바뀐다). 세션 시작 시 신호를 비워야 한다.
 */
test('[리뷰#1] 세션 A의 UI 음성명령이 세션 B 시작 시 재실행되지 않는다', async ({ page }) => {
  await setupAndStart(page, 0.6);

  // 세션 A: 도움말을 음성으로 연 뒤 그 상태로 세션을 끝낸다.
  await fireSttConf(page, '도움말', 0.95);
  await expect(page.locator('[data-testid="command-help-popup"]')).toBeVisible();
  await page.locator('[data-testid="cmd-help-close"]').click();
  await expect(page.locator('[data-testid="command-help-popup"]')).toHaveCount(0);
  // 일시정지 → 입력 종료 → 저장확인 인라인 (v035-r3-fixes와 동일 경로)
  await page.locator('button[title="일시정지"]').click();
  await page.waitForTimeout(300);
  await page.locator('button[title="입력 종료"]').click();
  await page.waitForTimeout(300);
  await page.locator('button[title="종료 확인"]').click();
  await page.waitForTimeout(1200);

  // 세션 B 시작 — 아무 명령도 말하지 않았으므로 도움말이 저절로 열리면 안 된다.
  const startBtn = page.locator('text=음성 입력 시작').first();
  await expect(startBtn).toBeVisible({ timeout: 5000 });
  await startBtn.click();
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
  await page.waitForTimeout(800);
  await expect(page.locator('[data-testid="command-help-popup"]')).toHaveCount(0);
});
