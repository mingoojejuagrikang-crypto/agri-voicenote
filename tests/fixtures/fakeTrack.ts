/**
 * v0.51 [CLIP-MUTED-SPAN-1] — **fake 오디오 트랙의 SSOT**(브라우저에 심는 스크립트).
 *
 * ## 왜 새 파일인가 — 사본이 둘이었다
 * `gum.ts`(GUM_GRANT_SCRIPT)와 `activeZones.ts`(MOCK_INIT_SCRIPT)가 **같은 fake 트랙을 각자**
 * 만들고 있었고, 후자의 주석이 *"이 스크립트는 gum.ts의 **사본**이다 — 한쪽만 고치면 갈린다"*
 * 라고 이미 경고하고 있었다. muted 토글을 양쪽에 복붙하면 그 경고가 실현된다
 * (`[UI-ALERT-1]`과 같은 형태의 결함 — 조립부가 둘이면 반드시 갈린다).
 * 👉 트랙 **생성**만 여기로 올린다. `__gumCalls` 기록·`__micSettleSkipForTest` 같은
 *    **각 픽스처 고유 관심사는 그대로 각자 파일에 남긴다.**
 *
 * ## 종전과 무엇이 달라지나 — **기본 동작은 완전 불변이다**
 *  · 종전 `addEventListener`는 **no-op**이었다. 이제 실제로 등록하지만, **아무도 이벤트를
 *    쏘지 않으면 등록만 되고 끝**이다(제품은 구독만 한다). 기존 스펙의 관측 가능한 동작은 같다.
 *  · `readyState`·`label`·`getSettings`·`stop`·`__lastFakeTrack` 노출 모두 종전 그대로다.
 *    `__lastFakeTrack.readyState = 'ended'`로 스트림 사망을 만드는 경로(v0.49 r3 #11)도 그대로 산다.
 *
 * ## 🔴 왜 muted 토글이 필요한가
 * 종전 fake 트랙은 `muted`가 **상수 `false`**라 **오디오 인터럽트 구간을 만들 수 없었다.**
 * 2026-09-01 A축(마이크를 OS가 회수한 동안 녹음이 계속되고 그 결과가 정상 커밋된다)은
 * 정확히 그 표면에서 일어나므로, 그 표면이 없으면 오라클이 결함을 **재현조차 못 한다.**
 *
 * ⚠️ **재현하는 것은 「표면」이지 「원인」이 아니다.** iOS가 언제 트랙을 muted로 만드는지는
 *    Playwright로 만들 수 없다(`v050-clip-silent-latch` 헤더의 같은 한계). 여기서 만드는 것은
 *    **UA가 미디어 전달을 멈춘 상태 그 자체**이고, 제품 판정(`trackStateOf`)이 읽는 필드가
 *    정확히 `track.muted`다.
 */

/** 브라우저에 심는 스크립트. `addInitScript`로 **다른 스텁보다 먼저** 평가돼야 한다
 *  (`nextStream()`이 `window.__makeFakeTrack()`을 호출하므로). */
export const FAKE_TRACK_SCRIPT = `
(function () {
  if (window.__fakeTrackInstalled) return;
  window.__fakeTrackInstalled = true;

  /** 스펙이 직접 부르지 않는다 — GUM 스텁의 nextStream()이 부른다. */
  window.__makeFakeTrack = function () {
    var listeners = {};
    var track = {
      kind: 'audio', label: 'Fake Mic', readyState: 'live', muted: false,
      getSettings: function () { return { deviceId: 'fake-mic' }; },
      addEventListener: function (type, cb) {
        if (typeof cb !== 'function') return;
        (listeners[type] = listeners[type] || []).push(cb);
      },
      removeEventListener: function (type, cb) {
        var a = listeners[type]; if (!a) return;
        var i = a.indexOf(cb); if (i >= 0) a.splice(i, 1);
      },
      dispatchEvent: function (evt) {
        var a = listeners[evt && evt.type]; if (!a) return true;
        // 복사본을 순회한다 — 핸들러가 구독을 해제해도(dispose) 순회가 깨지지 않게.
        a.slice().forEach(function (cb) { try { cb(evt); } catch (e) {} });
        return true;
      },
      stop: function () {},
    };
    window.__lastFakeTrack = track;
    return track;
  };

  /** 🔴 오디오 인터럽트(통화/Siri·라우트 변경)의 **표면**을 만든다.
   *  readyState는 'live' 그대로 두고 muted만 뒤집는다 — 그것이 실기기의 형상이다
   *  (mic_track_evt:mute가 왔는데 isStreamLost()는 계속 false였다).
   *  @returns 실제로 상태가 바뀌었으면 true(이미 그 상태였거나 트랙이 없으면 false). */
  window.__setFakeTrackMuted = function (muted) {
    var t = window.__lastFakeTrack;
    if (!t || typeof t.dispatchEvent !== 'function') return false;
    var next = !!muted;
    if (t.muted === next) return false;
    t.muted = next;
    t.dispatchEvent({ type: next ? 'mute' : 'unmute' });
    return true;
  };
})();
`;
