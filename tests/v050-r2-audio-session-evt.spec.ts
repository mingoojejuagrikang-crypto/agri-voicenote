/**
 * v0.50 r2 [갈래 B] 오라클 — **`statechange` 발화 자체를 센다**(값을 못 읽어도).
 *
 * ## 무엇이 있었나
 * 08-06~08-19 누적 로그에 `audio_interrupt`가 **0건**이었고, 08-19 조사는 그것을
 * *"iOS 26.6에서 `statechange`가 오지 않는다"*로 읽었다. **틀렸다.**
 * `rmic` 리서치(WebKit `safari-7624.4.5-branch` 소스 직접 대조): 26.6에서 `state`·`onstatechange`는
 * `DOMAudioSessionFullEnabled`(testable/false)로 **미노출**이지만 **이벤트는 발화한다.**
 * 우리 프로브의 `if (state === prev) return` dedupe가 `session.state === undefined` 때문에
 * **항상 참**이 되어 모든 발화를 삼켰다 — 우리가 신호를 버리고 있었다.
 *
 * ## 이 스펙이 재는 것
 * `state` 게터가 **아예 없는** 가짜 세션(= 우리 기기의 형상)에 `statechange`를 디스패치하면
 *  ⓐ `audio_session_evt`가 남고, ⓑ 누적 `n`이 발화 수와 같고,
 *  ⓒ 부팅 로그가 `stateReadable=no`로 **「값을 못 읽는 것」과 「이벤트가 안 오는 것」을 가른다.**
 *
 * ## 반증 축
 *  · dedupe 앞의 카운트(`audioSessionEventCount += 1`)를 지우면 → ⓐ·ⓑ red(현행 이전 코드가 그랬다)
 *  · `stateReadable` 필드를 빼면 → ⓒ red
 *  · `state`를 읽을 수 있는 기기에서는 기존 `audio_interrupt`가 그대로 나가야 한다 → ⓓ가 잠근다
 *
 * 🔴 **관측 전용이다.** 이 신호로 복구를 발화시키지 않는다(v0.46.0 P1 규율) — 재생 시작/종료마다도
 * 올 수 있어 비특이적일 가능성이 크다. 그 사실 자체가 다음 회차의 판정 재료다.
 */
import { test, expect, type Page } from '@playwright/test';
import { installVoiceMocks } from './fixtures/stt';
import { BASE } from './baseUrl';

test.setTimeout(120_000);

/** 🔑 **`state` 게터가 없다** — 우리 iOS 26.6의 형상(`DOMAudioSessionFullEnabled` 미노출).
 *  기존 `v0460-audio-interruption-probe`의 가짜 세션은 `state`를 갖고 있어 이 축을 못 잰다. */
const FAKE_SESSION_NO_STATE = `
(function () {
  var listeners = [];
  var session = {
    type: 'auto',
    addEventListener: function (t, cb) { if (t === 'statechange') listeners.push(cb); },
    removeEventListener: function (t, cb) {
      if (t !== 'statechange') return;
      var i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1);
    },
  };
  Object.defineProperty(navigator, 'audioSession', { value: session, configurable: true });
  window.__fireStateChange = function () { listeners.slice().forEach(function (cb) { cb(); }); };
})();
`;

/** `state`를 읽을 수 있는 기기(대조군) — 기존 계약(`audio_interrupt`)이 그대로 살아 있는지 본다. */
const FAKE_SESSION_WITH_STATE = `
(function () {
  var listeners = [];
  var session = {
    state: 'active',
    type: 'auto',
    addEventListener: function (t, cb) { if (t === 'statechange') listeners.push(cb); },
    // 🔴 **실제로 제거해야 한다.** no-op으로 두면 dev StrictMode 이중 마운트에서 리스너가 2개로
    //    남아 전이 1회에 로그가 2건 찍힌다(기존 v0460 스펙이 같은 함정을 주석으로 남겼다).
    removeEventListener: function (t, cb) {
      if (t !== 'statechange') return;
      var i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1);
    },
  };
  Object.defineProperty(navigator, 'audioSession', { value: session, configurable: true });
  window.__fireAudioState = function (s) {
    session.state = s;
    listeners.slice().forEach(function (cb) { cb(); });
  };
})();
`;

/** 프로브만 재므로 세션은 시작하지 않는다(기존 스펙과 같은 이유 — 부팅 이벤트가 관측 대상이다). */
async function bootProbeOnly(page: Page, script: string) {
  await page.addInitScript({ content: script });
  await installVoiceMocks(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
}

async function appLogs(page: Page, prefix: string): Promise<string[]> {
  return page.evaluate(async (p) => {
    const db: IDBDatabase = await new Promise((r) => {
      const q = indexedDB.open('agri-voicenote');
      q.onsuccess = () => r(q.result);
    });
    const rows: { extra?: string }[] = await new Promise((r) => {
      const q = db.transaction('logEvents', 'readonly').objectStore('logEvents').getAll();
      q.onsuccess = () => r(q.result as { extra?: string }[]);
      q.onerror = () => r([]);
    });
    db.close();
    return rows.map((e) => String(e.extra ?? '')).filter((x) => x.startsWith(p));
  }, prefix);
}

test('ⓐⓑ `state`를 못 읽어도 발화를 센다 — 누적 n이 발화 수와 같다', async ({ page }) => {
  await bootProbeOnly(page, FAKE_SESSION_NO_STATE);
  // 🔑 로그는 **초당 1건 상한**이다(링버퍼 보호). 그래서 간격을 두고 3회 쏜다 —
  //    상한 자체도 여기서 함께 잠긴다(즉시 3연발이면 1건만 남는 것이 설계다).
  const fire = () => page.evaluate(() => {
    (window as unknown as { __fireStateChange: () => void }).__fireStateChange();
  });
  await fire();
  await page.waitForTimeout(1100);
  await fire();
  await page.waitForTimeout(1100);
  await fire();
  await page.waitForTimeout(400);

  const evts = await appLogs(page, 'audio_session_evt:');
  // 🔴 현행 이전 코드에서는 **0건**이다(dedupe가 전부 삼켰다) — 이 단언이 반증 축이다.
  expect(evts.length, 'statechange가 3회 왔는데 아무 자국도 없다 — 08-19의 공백이 그대로다')
    .toBe(3);
  // 누적 `n`이 발화 수를 따라간다 — 「몇 번 왔는가」가 로그만으로 읽혀야 한다.
  expect(evts.map((e) => Number(/n=(\d+)/.exec(e)?.[1] ?? 0)),
    '발화 수를 누적으로 세지 않았다').toEqual([1, 2, 3]);

  // 값을 못 읽으므로 기존 `audio_interrupt`는 나가지 않는다(그게 정상이다).
  expect(await appLogs(page, 'audio_interrupt:'),
    'state를 못 읽는데 전이 이벤트가 나갔다 — 값 없이 전이를 단정한 것이다').toHaveLength(0);
});

test('ⓒ 부팅 로그가 「값을 못 읽는 것」과 「이벤트가 안 오는 것」을 가른다', async ({ page }) => {
  await bootProbeOnly(page, FAKE_SESSION_NO_STATE);
  const boot = await appLogs(page, 'audio_session:');
  expect(boot.length).toBeGreaterThanOrEqual(1);
  expect(boot[0], 'stateReadable이 없으면 다음 회차가 두 사실을 또 섞어 읽는다').toContain('stateReadable=no');
  // 🔴 기존 필드는 **바이트 그대로**여야 한다(접두 + 기존 필드 불변, 신규는 꼬리에만).
  expect(boot[0]).toContain('audio_session:supported=yes');
});

test('ⓓ `state`를 읽을 수 있으면 기존 계약(audio_interrupt)이 그대로 산다', async ({ page }) => {
  await bootProbeOnly(page, FAKE_SESSION_WITH_STATE);
  const boot = await appLogs(page, 'audio_session:');
  expect(boot[0]).toContain('stateReadable=yes');
  expect(boot[0]).toContain('state=active');

  await page.evaluate(() => {
    (window as unknown as { __fireAudioState: (s: string) => void }).__fireAudioState('interrupted');
  });
  await page.waitForTimeout(300);
  const interrupts = await appLogs(page, 'audio_interrupt:');
  expect(interrupts, '값이 실제로 바뀐 전이는 종전대로 남아야 한다').toHaveLength(1);
  expect(interrupts[0]).toContain('state=interrupted');
  expect(interrupts[0]).toContain('prev=active');
  // 같은 전이가 발화 카운터에도 잡힌다(두 이벤트는 서로를 대체하지 않는다).
  expect(await appLogs(page, 'audio_session_evt:')).toHaveLength(1);
});
