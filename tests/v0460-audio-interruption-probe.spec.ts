/** v0.46.0 **P1 오디오 인터럽션 프로브** 오라클 (민구 지시 08-06).
 *
 *  ## 🔴 무엇을 재고, 무엇을 안 재나
 *  전화·타앱 알람의 **실제 인터럽션은 Playwright로 만들 수 없다**(OS 레벨 사건이다).
 *  그래서 여기서는 **배선**만 잰다 — 「신호가 오면 우리가 그것을 로그로 남기는가」.
 *  *"iOS가 실제로 어떤 신호를 어떤 순서로 내는가"* 는 **실기기 로그로만** 확정된다.
 *  👉 그게 이 계측을 먼저 배포하는 이유다(P2~P5는 그 로그를 받고 설계한다).
 *
 *  ## 🔑 `[TEAMOPS-37]` 압력 — 이 오라클이 공허하지 않으려면
 *  `navigator.audioSession`은 Chromium에 **없다.** 그냥 부팅해서 "이벤트 0건"을 단언하면
 *  **프로브를 통째로 지워도 green**이다(= 압력 0). 그래서 **가짜 세션 객체를 주입**해
 *  전이를 실제로 발생시키고, 그때 로그가 남는지 본다.
 *
 *  ## 🔴 반증 축(과잉 방어 방지)
 *  ①미지원 환경에서 `supported=no`를 **남기는가** — 「안 찍힌 것」과 「관측 수단이 없는 것」을
 *    구분하는 분모다(`[MIC-B2]`가 `mic_teardown` 0건에서 겪은 곤란).
 *  ②같은 상태의 중복 통지를 **버리는가** — 안 버리면 `ms`가 「머문 시간」이 아니게 된다.
 *  ③프로브가 **복구를 하지 않는가** — P1의 정의. 상태를 바꾸는 부수효과가 없어야 한다. */
import { test, expect, type Page } from '@playwright/test';
import { installVoiceMocks } from './fixtures/stt';
import { BASE } from './baseUrl';

test.setTimeout(120_000);

/** 앱 로드 **전에** 가짜 `navigator.audioSession`을 심는다. 프로브는 부팅 1회에 구독하므로
 *  addInitScript로 넣어야 잡힌다. `__fireAudioState(s)`로 전이를 발생시킨다. */
const FAKE_SESSION = `
(function () {
  var listeners = [];
  var session = {
    state: 'active',
    type: 'auto',
    addEventListener: function (t, cb) { if (t === 'statechange') listeners.push(cb); },
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
  window.__audioListenerCount = function () { return listeners.length; };
})();
`;

/** 관측 프로브만 재므로 세션은 시작하지 않는다.
 *
 *  ⚠️ **`installVoiceMocks`는 필수다** — 없이 맨 `goto`를 하면 TTS/STT 실물이 붙어 부팅이
 *  멎는다(08-06 실측: 3스펙 전부 60초 타임아웃).
 *
 *  🔴 **`reload`를 하지 않는다.** `bootIdle`(v045-instrumentation) 계보를 그대로 베끼면
 *  `goto` + `reload`로 **앱이 두 번 뜨고 부팅 로그가 2건**이 된다(08-06 실측: `audio_session:`
 *  expected 1 / received 2). 그쪽은 reload가 **localStorage 설정을 태우기 위한** 것이고
 *  세션 시작 이후 이벤트만 세므로 드러나지 않았다. **여기는 부팅 이벤트 자체가 관측 대상**이다.
 *  🔑 Playwright는 테스트마다 BrowserContext를 격리하므로 IDB·localStorage도 이미 깨끗하다 —
 *  지울 필요가 없고, 지우려고 reload를 부르면 그게 오히려 오염원이 된다. */
async function bootProbeOnly(page: Page) {
  await page.addInitScript({ content: FAKE_SESSION });
  await installVoiceMocks(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
}

/** 미지원 환경(= `navigator.audioSession` 부재) 재현. FAKE_SESSION을 심지 않는다. */
async function bootUnsupported(page: Page) {
  await installVoiceMocks(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
}

/** IDB `logEvents`에서 extra가 접두사로 시작하는 항목을 뽑는다
 *  (`v045-instrumentation.spec.ts`의 `loadLogEvents` 계보 — 이 레포의 로그 판독 관례). */
async function logsStartingWith(page: Page, prefix: string) {
  return page.evaluate(async (p) => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db || !db.objectStoreNames.contains('logEvents')) return [];
    const all = await new Promise<{ extra?: string }[]>((res) => {
      const tx = db.transaction('logEvents', 'readonly');
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result);
      req.onerror = () => res([]);
    });
    return all.map((e) => e.extra ?? '').filter((x) => x.startsWith(p));
  }, prefix);
}

test.describe('P1 — 오디오 인터럽션 프로브 배선', () => {
  test('🔴 지원 환경: 전이가 로그로 남는다 + 지속시간(ms)이 실린다', async ({ page }) => {
    await bootProbeOnly(page);

    // 부팅 로그 — 지원 여부 판정의 분모.
    // ⚠️ dev(StrictMode)는 effect를 두 번 돌리므로 **부팅 로그 건수는 1~2건**이다(cleanup이
    //    리스너는 1개로 유지한다 — 아래 구독 수 단언이 그것을 잰다). 프로덕션 빌드는 1건.
    //    👉 건수로 프로브 존재를 판정하지 않고 **내용**으로 판정한다.
    const boot = await logsStartingWith(page, 'audio_session:');
    expect(boot.length, '부팅 시 audio_session을 남긴다').toBeGreaterThanOrEqual(1);
    expect(boot[0], '지원 + 초기 상태 + 타입').toContain('supported=yes');
    expect(boot[0]).toContain('state=active');

    // 🔴 프로브가 실제로 구독했는가 — 이게 0이면 아래 전이 단언이 공허해진다.
    // 🔴 정확히 1개여야 한다 — StrictMode 이중 실행에서도 cleanup이 겹침을 막는다.
    //    2개면 전이 1회에 로그가 2건 찍혀 「머문 시간(ms)」 해석이 통째로 틀어진다(08-06 실측).
    expect(await page.evaluate(() => (window as unknown as { __audioListenerCount(): number }).__audioListenerCount()),
      '프로브 구독은 정확히 1개다(구독 누수 없음)').toBe(1);

    // 전이 발생 — 전화·알람이 세션을 회수하는 그 순간
    await page.evaluate(() => (window as unknown as { __fireAudioState(s: string): void }).__fireAudioState('interrupted'));
    await page.waitForTimeout(250);
    await page.evaluate(() => (window as unknown as { __fireAudioState(s: string): void }).__fireAudioState('active'));
    await page.waitForTimeout(120);

    const evts = await logsStartingWith(page, 'audio_interrupt:');
    console.log(`audio_interrupt 로그: ${JSON.stringify(evts)}`);
    expect(evts.length, '전이 2회 → 이벤트 2건').toBe(2);
    expect(evts[0]).toContain('state=interrupted');
    expect(evts[0]).toContain('prev=active');
    // 🔑 vis 축 — visible인 인터럽션이 「포그라운드 회수」(기존 방어 사정권 밖)를 뜻한다.
    expect(evts[0], '화면 가시성이 함께 실린다').toContain('vis=visible');
    expect(evts[1]).toContain('state=active');
    expect(evts[1]).toContain('prev=interrupted');
    // 복귀 이벤트의 ms = 인터럽션이 지속된 시간. 250ms 대기했으므로 유의미한 값이어야 한다.
    const ms = Number(/ms=(\d+)/.exec(evts[1])?.[1] ?? '-1');
    expect(ms, '복귀 이벤트에 인터럽션 지속시간이 실린다').toBeGreaterThanOrEqual(200);
  });

  test('②중복 통지는 버린다 — ms가 「머문 시간」이 되게', async ({ page }) => {
    await bootProbeOnly(page);
    await page.evaluate(() => {
      const w = window as unknown as { __fireAudioState(s: string): void };
      w.__fireAudioState('interrupted');
      w.__fireAudioState('interrupted'); // 같은 값 재통지
      w.__fireAudioState('interrupted');
    });
    await page.waitForTimeout(150);
    const evts = await logsStartingWith(page, 'audio_interrupt:');
    expect(evts.length, '같은 상태 반복은 1건으로 접힌다').toBe(1);
  });

  test('①미지원 환경: supported=no를 남긴다 — 「관측 수단 없음」과 「사건 없음」을 가른다', async ({ page }) => {
    // audioSession을 심지 않는다(= Chromium 기본).
    await bootUnsupported(page);
    const boot = await logsStartingWith(page, 'audio_session:');
    expect(boot.length, '미지원이어도 남긴다').toBeGreaterThanOrEqual(1);
    expect(boot[0]).toContain('supported=no');
    const evts = await logsStartingWith(page, 'audio_interrupt:');
    expect(evts.length, '미지원 환경에서는 전이 이벤트가 없다').toBe(0);
  });

  test('③P1은 복구하지 않는다 — 프로브는 상태를 바꾸지 않는다', async ({ page }) => {
    // 🔴 P1의 정의이자 안전성. 복구 로직이 슬며시 들어오면 실기기 로그가
    //   「원래 거동」이 아니라 「우리가 개입한 뒤의 거동」이 되어 P2~P5 설계 근거가 오염된다.
    await bootProbeOnly(page);
    await page.evaluate(() => (window as unknown as { __fireAudioState(s: string): void }).__fireAudioState('interrupted'));
    await page.waitForTimeout(400);
    const state = await page.evaluate(
      () => (navigator as unknown as { audioSession: { state: string } }).audioSession.state,
    );
    expect(state, '프로브가 세션 상태를 되돌리려 시도하지 않는다').toBe('interrupted');
    // 타입 선언도 하지 않는다 — 관측 프로브가 관측 대상을 바꾸면 안 된다.
    const type = await page.evaluate(
      () => (navigator as unknown as { audioSession: { type: string } }).audioSession.type,
    );
    expect(type, 'audioSession.type을 건드리지 않는다').toBe('auto');
  });
});
