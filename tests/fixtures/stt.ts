/**
 * STT/TTS 목 픽스처 — MockSTT(fireResult/fireResultWithAlts)·mockSynth(__ttsLog) 주입의 SSOT
 * (v0.35.1 Stage 1-6 신설).
 *
 * 종전에는 24개 spec이 correction-flow.spec.ts의 MOCK_INIT_SCRIPT를 복붙해, 목 동작을 고치면
 * 전수 grep 갱신이 필요했다. 이 fixture가 규약을 한 곳으로 모은다.
 *
 *  - **신규 spec은 이 fixture 사용이 의무**(민구 승인 리팩토링 플랜, 2026-07-14). 기존 spec은
 *    점진 전환 — 손대는 김에 옮기되, 옮기기 위한 수정은 하지 않는다.
 *  - 주입 스크립트는 page.addInitScript({ content })로 실행되는 **문자열**이다(브라우저 컨텍스트
 *    직렬화 제약 — import 불가). 목 자체를 바꿀 땐 이 문자열만 고치면 된다.
 *
 * 사용법:
 *   import { installVoiceMocks, fireStt, fireSttAlts, ttsLog } from './fixtures/stt';
 *   test.beforeEach(async ({ page }) => { await installVoiceMocks(page); });
 *   ...
 *   await fireStt(page, '삼십오 점 일');
 *   await fireSttAlts(page, '네', ['16'], 400);
 *   expect(await ttsLog(page)).toContain('횡경');
 */

import type { Page } from '@playwright/test';

/** 브라우저 주입 스크립트 (correction-flow.spec.ts 계보의 정본 + [TEST-TTS-MOCK-1] 반영):
 *  - speechSynthesis 목: speak가 onstart를 즉시, **onend는 항상 비동기**(기본 200ms — 실기기
 *    수백ms~수초의 축약)로 발화 + window.__ttsLog에 문구 적재. 동기 onend는 TTS를 기다리는
 *    상태 전이(advance/review/확인 플래시)를 페인트 없이 접어 false-green을 만든다
 *    ([TEST-TTS-MOCK-1] 코드 확정 — 그래서 복붙 원본과 달리 여기서는 비동기가 기본).
 *  - 애니메이션/트랜지션 0ms 스타일(타이밍 flake 제거). 시각 애니메이션 자체를 검증할 때는
 *    `preserveAnimations:true`로 이 전역 오버라이드를 반드시 끈다([TEST-ANIMATION-ZERO-1]).
 *  - SpeechRecognition/webkitSpeechRecognition → MockSTT. 인스턴스는 window.__mockSTT로 노출되고
 *    fireResult(단일)·fireResultWithAlts(대안 포함, [STT-15] 재현)를 제공한다. */
const VOICE_MOCK_INIT_SCRIPT = `
(function() {
  window.__ttsLog = [];
  window.__ttsInFlight = 0;
  var mockSynth = {
    speak: function(utterance) {
      window.__ttsLog.push(utterance.text);
      window.__ttsInFlight++;
      try { if (utterance.onstart) utterance.onstart(new Event('start')); } catch(e) {}
      // [TEST-TTS-MOCK-1] onend는 항상 비동기(>=1 태스크). 지연은 installVoiceMocks 옵션으로 조절.
      var delay = typeof window.__ttsOnendDelayMs === 'number' ? window.__ttsOnendDelayMs : 200;
      setTimeout(function() {
        window.__ttsInFlight = Math.max(0, window.__ttsInFlight - 1);
        try { if (utterance.onend) utterance.onend(new Event('end')); } catch(e) {}
      }, delay);
    },
    cancel: function() {}, pause: function() {}, resume: function() {},
    getVoices: function() { return [{ name: 'Mock Korean', lang: 'ko-KR', default: true, localService: true, voiceURI: 'mock' }]; },
    speaking: false, pending: false, paused: false, onvoiceschanged: null,
    addEventListener: function() {}, removeEventListener: function() {}, dispatchEvent: function() { return true; },
  };
  try {
    Object.defineProperty(window, 'speechSynthesis', { get: function() { return mockSynth; }, configurable: true, enumerable: true });
  } catch(e1) {
    try { Object.defineProperty(Window.prototype, 'speechSynthesis', { get: function() { return mockSynth; }, configurable: true }); }
    catch(e2) { try { window.speechSynthesis = mockSynth; } catch(e3) {} }
  }
  var _addStyle = function() {
    if (window.__preserveTestAnimations === true) return;
    var s = document.createElement('style');
    s.textContent = '* { animation-duration: 0ms !important; transition-duration: 0ms !important; }';
    (document.head || document.documentElement).appendChild(s);
  };
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _addStyle); } else { _addStyle(); }

  function MockSTT() {
    this._ls = {};
    this.continuous = true; this.interimResults = true; this.lang = 'ko-KR'; this.maxAlternatives = 3;
    window.__mockSTT = this;
  }
  MockSTT.prototype.addEventListener = function(t, cb) { if (!this._ls[t]) this._ls[t] = []; this._ls[t].push(cb); };
  MockSTT.prototype.removeEventListener = function(t, cb) { if (this._ls[t]) this._ls[t] = this._ls[t].filter(function(f) { return f !== cb; }); };
  MockSTT.prototype.start = function() { var self = this; setTimeout(function() { (self._ls['start'] || []).forEach(function(cb) { cb(new Event('start')); }); }, 5); };
  MockSTT.prototype.stop = function() {};
  MockSTT.prototype.abort = function() { var self = this; setTimeout(function() { (self._ls['end'] || []).forEach(function(cb) { cb(new Event('end')); }); }, 5); };
  MockSTT.prototype.fireResult = function(transcript, confidence) {
    if (confidence === undefined) confidence = 0.95;
    var event = { resultIndex: 0, results: { length: 1, 0: { isFinal: true, length: 1, 0: { transcript: transcript, confidence: confidence } } } };
    (this._ls['result'] || []).forEach(function(cb) { cb(event); });
  };
  // interim(중간) 결과 주입 — fastRecognition(조기확정) 경로 검증용(리뷰 라운드2 Flash Medium).
  MockSTT.prototype.fireInterim = function(transcript, confidence) {
    if (confidence === undefined) confidence = 0.6;
    var event = { resultIndex: 0, results: { length: 1, 0: { isFinal: false, length: 1, 0: { transcript: transcript, confidence: confidence } } } };
    (this._ls['result'] || []).forEach(function(cb) { cb(event); });
  };
  // v0.33.0 [STT-15] 재현용 — 대안(alternatives) 포함 final 결과 주입.
  MockSTT.prototype.fireResultWithAlts = function(transcript, confidence, alts) {
    var alternatives = [{ transcript: transcript, confidence: confidence }];
    for (var i = 0; i < (alts || []).length; i++) {
      alternatives.push({ transcript: alts[i], confidence: confidence * 0.9 });
    }
    var result = { isFinal: true, length: alternatives.length };
    for (var j = 0; j < alternatives.length; j++) result[j] = alternatives[j];
    var event = { resultIndex: 0, results: { length: 1, 0: result } };
    (this._ls['result'] || []).forEach(function(cb) { cb(event); });
  };
  try { Object.defineProperty(window, 'SpeechRecognition', { value: MockSTT, writable: true, configurable: true, enumerable: true }); }
  catch(e1) { try { window.SpeechRecognition = MockSTT; } catch(e2) {} }
  try { Object.defineProperty(window, 'webkitSpeechRecognition', { value: MockSTT, writable: true, configurable: true, enumerable: true }); }
  catch(e) { try { window.webkitSpeechRecognition = MockSTT; } catch(e2) {} }
})();
`;

/** 🔴 v0.51 [rauth P2] — **GIS 오프라인 스텁.** 세션 시작 핸들러가 이제 토큰이 없으면 마이크
 *  획득 **이전에** 무팝업 갱신을 시도한다(`refreshBeforeSessionStart`). 토큰을 안 심는 음성
 *  스펙에서는 그 경로가 `window.google` 부재 → **실제 GIS 스크립트를 네트워크에서 받아**
 *  진짜 팝업을 열려고 든다. 실측 결과: 세션이 백그라운드로 판정돼 STT가 suspend되고
 *  `value` 이벤트가 아예 안 나 v043 T1~T4가 통째로 red였다(2026-08-27 빌더 회차 실측).
 *
 *  기본값은 **즉시 실패**다 — 토큰을 안 심은 스펙은 「로그인 안 된 상태」를 재려던 것이므로
 *  갱신이 실패해야 그 전제가 보존된다(P2 계약: 실패해도 세션은 그대로 시작한다).
 *  ⚠️ 자기 GIS mock이 필요한 스펙은 `installVoiceMocks` **뒤에** 자기 것을 addInitScript하면
 *     나중 스크립트가 이 스텁을 덮는다(sync-token-expiry·v051-* 가 그 형태다).
 *  ⚠️ 토큰을 심는 스펙에는 애초에 닿지 않는다 — 유효 토큰이면 P2가 null을 돌려주고 끝난다. */
const GIS_OFFLINE_STUB_SCRIPT = `
(function() {
  if (window.google && window.google.accounts) return; // 이미 mock이 있으면 건드리지 않는다
  window.google = {
    accounts: {
      oauth2: {
        initTokenClient: function(config) {
          return { requestAccessToken: function() {
            if (config && config.error_callback) config.error_callback({ type: 'popup_failed_to_open' });
          } };
        },
        revoke: function(_t, cb) { if (cb) cb(); },
      },
    },
  };
})();
`;

/** 페이지에 STT/TTS 목 주입 — page.goto 전에 호출한다.
 *  ttsOnendDelayMs: TTS onend 비동기 지연(기본 200ms — [TEST-TTS-MOCK-1] 권장). TTS-대기 전이를
 *  단언하지 않는 순수 파서/즉답 spec만 0으로 낮춰라(그래도 setTimeout(0) = 비동기 유지). */
export async function installVoiceMocks(page: Page, opts?: {
  ttsOnendDelayMs?: number;
  /** 시각 애니메이션 자체를 검증하는 스펙만 true. 기본 0ms는 다수 비시각 스펙의 flake 억제 계약. */
  preserveAnimations?: boolean;
}): Promise<void> {
  if (opts?.ttsOnendDelayMs !== undefined) {
    await page.addInitScript(
      (d) => { (window as unknown as { __ttsOnendDelayMs?: number }).__ttsOnendDelayMs = d; },
      opts.ttsOnendDelayMs,
    );
  }
  const base = opts?.preserveAnimations
    ? `window.__preserveTestAnimations = true;\n${VOICE_MOCK_INIT_SCRIPT}`
    : VOICE_MOCK_INIT_SCRIPT;
  // v0.51 P2 — GIS 오프라인 스텁을 함께 깐다(위 상수 주석: 실제 팝업이 세션을 백그라운드로 보낸다).
  const mockScript = `${base}\n${GIS_OFFLINE_STUB_SCRIPT}`;
  await page.addInitScript({ content: mockScript });
}

/** final 인식 결과 1건 주입 후 처리 대기. */
export async function fireStt(page: Page, transcript: string, waitMs = 300, confidence = 0.95): Promise<void> {
  await page.evaluate(
    ({ t, c }) => {
      (window as unknown as { __mockSTT?: { fireResult: (t: string, c: number) => void } }).__mockSTT?.fireResult(t, c);
    },
    { t: transcript, c: confidence },
  );
  await page.waitForTimeout(waitMs);
}

/** interim(중간) 결과 주입 — fastRecognition 조기확정 경로 재현용. 조기확정은 interim이
 *  EARLY_COMMIT_STABLE_MS(400ms) 동안 같은 값으로 안정돼야 발동하므로, 같은 transcript로
 *  2회 이상 간격을 두고 호출하라. */
export async function fireSttInterim(page: Page, transcript: string, waitMs = 100, confidence = 0.6): Promise<void> {
  await page.evaluate(
    ({ t, c }) => {
      (window as unknown as { __mockSTT?: { fireInterim: (t: string, c: number) => void } }).__mockSTT?.fireInterim(t, c);
    },
    { t: transcript, c: confidence },
  );
  await page.waitForTimeout(waitMs);
}

/** 대안(alternatives) 포함 final 결과 주입 — [STT-15] 계열 재현용. */
export async function fireSttAlts(page: Page, transcript: string, alts: string[], waitMs = 400, confidence = 0.95): Promise<void> {
  await page.evaluate(
    ({ t, a, c }) => {
      (window as unknown as { __mockSTT?: { fireResultWithAlts: (t: string, c: number, a: string[]) => void } })
        .__mockSTT?.fireResultWithAlts(t, c, a);
    },
    { t: transcript, a: alts, c: confidence },
  );
  await page.waitForTimeout(waitMs);
}

/** 지금까지 mockSynth가 발화한 TTS 문구 목록. */
export async function ttsLog(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __ttsLog?: string[] }).__ttsLog ?? []);
}

/** 비동기 mock TTS가 모두 끝날 때까지 대기. 다음 queued 발화가 같은 onend에서 이어지는 경우까지
 * 한 프레임 안정화 후 재확인한다([TEST-TTS-MOCK-1] 상태 전이 spec용). */
export async function waitForTtsIdle(page: Page): Promise<void> {
  const idle = () => page.waitForFunction(
    () => ((window as unknown as { __ttsInFlight?: number }).__ttsInFlight ?? 0) === 0,
  );
  await idle();
  await page.waitForTimeout(50);
  await idle();
}
