/**
 * v0.35.0 FIX-1(리뷰 라운드1, Vance) — 비프 마스터 GainNode 해제가 실시간 setTimeout이 아니라
 * oscillator `onended` 카운팅으로 이뤄지는지 검증.
 *
 * 🔴 v0.46.0 WP-I·WP-E 갱신 — **트리거가 바뀌었다(정당 파손).**
 *   종전엔 설정탭 비프 칩(`beep-chip-pos-triad`) **미리듣기 클릭**으로 재생을 유발했는데,
 *   WP-I가 소리 설정 UI를 통째로 숨기면서(민구: *"고를 게 없으면 안 보여준다"*) **그 트리거가
 *   사라졌다.** 오라클을 죽이지 않고 **실제 사용 경로**로 옮겼다: 음성 커밋 → WP-E 확인음.
 *   🔑 **덕분에 이 스펙이 WP-E의 오라클을 겸한다** — "값이 저장되면 확인음이 난다"를 여기서 잰다.
 *   세그먼트 수(3개)가 그대로인 이유: WP-I가 확인음을 **화음(pos-triad)으로 고정**했고 그 변형이
 *   종전 미리듣기 대상과 같다. 단언 수치(master 1 / segGain 3 / osc 3)는 그래서 불변이다.
 *
 * 재는 축: ① 마스터 GainNode가 **마지막 osc onended 후 정확히 1회** disconnect(누수 0·레이스 없음)
 *          ② 🆕 **커밋 확인음이 실제로 난다**(WP-E — 종전엔 정상 커밋에 소리가 아예 없었다)
 *          ③ 🆕 **볼륨 100% 고정**(WP-I) — 마스터 게인에 `BEEP_VOLUME_MAX`(12)가 걸린다
 * 안 재는 축: 확인음과 인식값 TTS의 **순서**(SpeechSynthesis는 WebAudio 프로브에 안 잡힌다 —
 *          순서 계약은 useVoiceSession의 코드 주석과 리뷰가 지킨다) · 실기기 가청 여부
 *          (🔴 F1 미리듣기 "작동안함"의 원인이 미규명이라 **실기기 확인이 필수다**, 플랜 §3-G).
 *
 * 가짜 AudioContext를 앱 로드 전에 주입해 connect/disconnect/게인값을 계측한다.
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다(수동 기동 불필요, [ORCH-27]).
 */
import { test, expect, type Page } from '@playwright/test';

import { BASE } from './baseUrl';
import { stubSheets } from './fixtures/activeZones';
import { installVoiceMocks, fireStt } from './fixtures/stt';
import { GUM_GRANT_SCRIPT } from './fixtures/gum';

test.setTimeout(120_000);

const STORE_KEY = 'agri-voicenote-settings-v3';
const PHONE_402 = { width: 402, height: 874 };

// 추세/이상치 규칙이 없는 음성 float 컬럼 → 커밋이 항상 '깨끗한 확인' 경로다(alert/corrected 아님).
// 그래야 WP-E의 `commit` 확인음만 울린다(useVoiceSession의 `beeped` 가드 반대편).
const COLUMNS = [
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'c2', name: '당도', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  { id: 'c3', name: '산도', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];

const SETTINGS = {
  state: {
    googleConnected: true,
    userEmail: 'tester@example.com',
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_BEEP_REL/edit',
    sheetTab: 'Sheet1',
    columnsSheetId: 'SHEET_BEEP_REL',
    columnsSheetTab: 'Sheet1',
    columns: COLUMNS,
    tableGenerated: true,
    totalRows: 2,
    ttsRate: 1.05,
    recognitionTolerance: 0.6,
    sessionLabelColId: null,
    sessionAutoLabel: 'beep-release-test',
    preferredVoiceName: '',
    roundDateColId: null,
  },
  version: 12,
};

// 앱 로드 전에 window.AudioContext를 가짜로 교체. 세션 오디오(레코더)도 같은 생성자를 쓰므로
// **커밋 직전에 프로브를 리셋**해 확인음 하나만 재는 것이 이 스펙의 계약이다(아래 resetProbe).
const FAKE_AUDIO = `
(function(){
  window.__beepProbe = { mastersConnected: 0, masterDisconnects: 0, segDisconnects: 0, oscEnded: 0, setGains: [] };
  function Param(){}
  Param.prototype.setValueAtTime = function(v){ try { window.__beepProbe.setGains.push(v); } catch(e){} return this; };
  Param.prototype.exponentialRampToValueAtTime = function(){ return this; };
  function Gain(ctx){ this._ctx = ctx; this.gain = new Param(); this._toDest = false; }
  Gain.prototype.connect = function(dst){ if (dst && dst.__isDest){ this._toDest = true; window.__beepProbe.mastersConnected++; } return dst; };
  Gain.prototype.disconnect = function(){ if (this._toDest) window.__beepProbe.masterDisconnects++; else window.__beepProbe.segDisconnects++; };
  function Osc(ctx){ this._ctx = ctx; this.frequency = new Param(); this.type = 'sine'; this.onended = null; }
  Osc.prototype.connect = function(dst){ return dst; };
  Osc.prototype.start = function(){};
  Osc.prototype.stop = function(t){ var self = this; var ms = Math.max(0, (t - self._ctx.currentTime) * 1000);
    setTimeout(function(){ window.__beepProbe.oscEnded++; if (self.onended) self.onended(); }, Math.min(ms, 400) + 15); };
  Osc.prototype.disconnect = function(){};
  function Analyser(){ this.fftSize = 2048; }
  Analyser.prototype.connect = function(){}; Analyser.prototype.disconnect = function(){}; Analyser.prototype.getByteTimeDomainData = function(){};
  function Ctx(){ this.state = 'running'; this.currentTime = 0; this.destination = { __isDest: true }; }
  Ctx.prototype.createGain = function(){ return new Gain(this); };
  Ctx.prototype.createOscillator = function(){ return new Osc(this); };
  Ctx.prototype.createAnalyser = function(){ return new Analyser(); };
  Ctx.prototype.createMediaStreamSource = function(){ return { connect: function(){}, disconnect: function(){} }; };
  Ctx.prototype.resume = function(){ return Promise.resolve(); };
  Ctx.prototype.close = function(){ return Promise.resolve(); };
  window.AudioContext = Ctx; window.webkitAudioContext = Ctx;
})();
`;

type BeepProbe = {
  mastersConnected: number; masterDisconnects: number;
  segDisconnects: number; oscEnded: number; setGains: number[];
};

async function resetProbe(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __beepProbe: BeepProbe }).__beepProbe = {
      mastersConnected: 0, masterDisconnects: 0, segDisconnects: 0, oscEnded: 0, setGains: [],
    };
  });
}

async function readProbe(page: Page): Promise<BeepProbe> {
  return page.evaluate(() => (window as unknown as { __beepProbe: BeepProbe }).__beepProbe);
}

test('FIX-1·WP-E — 커밋 확인음: 마스터 GainNode는 마지막 osc onended 후 정확히 1회 해제(누수 0)', async ({ page }) => {
  await page.setViewportSize(PHONE_402);
  await page.addInitScript(FAKE_AUDIO);
  await stubSheets(page);
  await installVoiceMocks(page);
  await page.addInitScript(GUM_GRANT_SCRIPT);
  // F18 정착 지연(1초)만 생략하는 공식 테스트 심 — 목이 아니라 대기 축약이다.
  await page.addInitScript(() => {
    (window as unknown as { __micSettleSkipForTest?: boolean }).__micSettleSkipForTest = true;
  });
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

  // 🔴 세션 오디오(레코더)가 만든 노드를 배제하고 **확인음 하나만** 재기 위해 여기서 리셋한다.
  await resetProbe(page);
  const before = await readProbe(page);
  expect(before.mastersConnected, '리셋 직후 프로브는 0에서 출발').toBe(0);

  // 음성 커밋 — 추세 규칙이 없는 깨끗한 float 컬럼이라 WP-E의 'commit' 확인음 경로를 탄다.
  await fireStt(page, '30.7', 300);

  // 확인음(화음 pos-triad = 세그먼트 3개)의 osc 3개가 모두 종료할 때까지 대기.
  await expect.poll(async () => (await readProbe(page)).oscEnded, { timeout: 5000 }).toBe(3);
  await page.waitForTimeout(50); // 마지막 onended 콜백의 master.disconnect 반영

  const probe = await readProbe(page);
  // ② WP-E — 커밋에 확인음이 실제로 났다(종전엔 이 경로에 소리가 아예 없었다).
  expect(probe.mastersConnected, 'WP-E — 커밋 확인음이 재생됐다(마스터 1개)').toBe(1);
  // ① FIX-1 — 정확히 1회 해제(누수 0), 세그먼트 gain 3개 해제, osc 3개 종료.
  expect(probe.masterDisconnects).toBe(1);
  expect(probe.segDisconnects).toBe(3);
  expect(probe.oscEnded).toBe(3);
  // ③ WP-I — 볼륨 100% 고정: 마스터 게인에 BEEP_VOLUME_MAX(12)가 걸린다.
  //    세그먼트 게인은 0.0001~0.06 범위라 12는 마스터에서만 나온다(값으로 구분 가능).
  expect(probe.setGains, 'WP-I — 마스터 게인 = 12(볼륨 100% 고정)').toContain(12);
  console.log(`✓ WP-E 확인음 + FIX-1 누수 0 (gains=${JSON.stringify(probe.setGains)})`);
});
