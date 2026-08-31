/**
 * v0.51 H7′ 오라클 — **짧은 `pointerup` 유예 창** + H3 계측 동거.
 *
 * ## 무엇을 고치는가 (증명 → 처방)
 * 민구 제보(08-31): *"진행바가 0으로 갔다가 **저절로** 다시 차오른다."*
 * `setProgress` 호출 지점 전수(4개)가 그 현상의 경로를 **하나로** 좁혔다:
 * 「0으로 감」=`stopHold` · 「다시 차오름」=`beginHold`의 `schedule()`이고 `beginHold`는
 * `onPointerDown`으로만 불린다. ⇒ **`pointerup`→`pointerdown` 왕복이 실제로 일어났다.**
 * 민구가 «엄지 하나만» 닿았다고 했으므로 그 왕복은 **엄지 자신의 것**이다(C1″ — 접촉 간헐 끊김).
 * 👉 H7′는 그 왕복을 **흡수**한다: up 후 T ms 안에 R px 이내에서 down이 오면 **누적 시간을 잇는다.**
 *
 * ## 🔴 이 스펙이 재지 **못하는** 것 — 먼저 적는다
 * **접촉 끊김 자체는 데스크톱에서 재현되지 않는다.** 여기서 재는 것은 «유예 로직이 시간·거리
 * 조건대로 동작하는가»이지 «실기기에서 리셋이 사라지는가»가 아니다.
 * 🔴 후자는 **대본 B(민구 20회 반복)** 로만 판정되고, `T=120ms · R=40px`는 **미실측 첫 시도값**이다.
 * 반증 조건: T를 150ms로 올려도 리셋이 계속되면 접촉 문제가 아니라 X2(iOS가 `pointercancel` 뒤
 * 새 `pointerdown`을 발행)이고, 그때는 **H7′를 되돌린다.**
 *
 * ## 재는 축
 *  ① 🔴 T 안·R 안의 재접촉은 **이어받는다** — 총 시간이 홀드 길이에 닿으면 진입한다.
 *  ② T 밖의 재접촉은 **새 홀드**다 — 진입하지 않는다.
 *  ③ R 밖의 재접촉은 **새 홀드**다 — 진입하지 않는다.
 *  ④ 🔴 **깜빡임이 없다** — 유예 중 진행바가 0으로 떨어지지 않는다. 민구가 본 그 현상 자체다.
 *  ⑤ H3 동거 — 흡수된 왕복은 `abort`를 남기지 않고 `screen_off_start … resume=grace`로 세어진다.
 *  ⑥ H3 동거 — T를 넘긴 취소는 `screen_off_abort reason=up,at=<ms>`를 남긴다.
 *  ⑦ 🔴 **회귀** — 조기 해제 후 미진입(`v0470-w7` ②의 계약)이 유예 때문에 깨지지 않는다.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402 } from './fixtures/activeZones';
import { heroPointerSequence } from './fixtures/heroPointer';
import { waitForTtsIdle } from './fixtures/stt';

test.setTimeout(120_000);

/** 제품 상수와 같아야 한다 — [TEAMOPS-38] 관례로 **일부러 import하지 않는다.** */
const HOLD_MS = 2000;
/** 제품 `HOLD_GRACE_MS`. 🔴 **미실측 첫 시도값**이라 제품과 함께 흔들릴 수 있다. */
const GRACE_MS = 120;
/** 제품 `HOLD_GRACE_RADIUS_PX`. */
const GRACE_RADIUS_PX = 40;

const overlay = (page: Page) => page.locator('[data-testid="blackout-overlay"]');
const fill = (page: Page) => page.locator('[data-testid="hero-hold-fill"]');

interface LoggedEvent { type: string; parsed?: string; extra?: string }

async function logEvents(page: Page): Promise<LoggedEvent[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db || !db.objectStoreNames.contains('logEvents')) return [];
    return new Promise((res) => {
      const tx = db.transaction('logEvents', 'readonly');
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result);
      req.onerror = () => res([]);
    }) as Promise<LoggedEvent[]>;
  });
}

/** down → holdMs → up → gapMs → (dx,dy)만큼 옮겨 down → tailMs → up.
 *
 *  🔴 **한 번의 `page.evaluate`로 돈다**(`fixtures/heroPointer.ts`). 유예 창이 120ms인데
 *  러너 왕복이 그보다 커질 수 있어서다 — 그러면 오라클이 제품이 아니라 하네스 지연을 잰다.
 *  @returns `[홀드중, 유예중, 재접촉후]` 진행값. **`-1`은 홀드 표시 자체가 없다는 뜻**이고
 *           `0`(표시는 있는데 값이 0)과 다르다 — ④의 «깜빡임 없음» 판정이 그 구분에 기댄다. */
async function breakAndResume(
  page: Page,
  { holdMs, gapMs, dx, dy, tailMs }: { holdMs: number; gapMs: number; dx: number; dy: number; tailMs: number },
) {
  const [held, inGrace, resumed] = await heroPointerSequence(page, [
    { type: 'down', wait: holdMs },
    { type: 'up', wait: gapMs },
    { type: 'down', dx, dy, wait: tailMs },
  ]);
  await heroPointerSequence(page, [{ type: 'up', dx, dy }]);
  return { held, inGrace, resumed };
}

test('①④⑤ T·R 안의 재접촉은 이어받는다 — 진입하고, 깜빡이지 않고, abort 대신 resume=grace가 남는다', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForTtsIdle(page);

  // 1000ms 누르고 → 뗐다가 → **T의 1/3(40ms)** 뒤 같은 자리 → 1400ms 더 누른다.
  //   🔑 **재접촉 뒤 시간(1400ms)은 HOLD_MS(2000)보다 짧다** — 그래야 「진입했다」가
  //      «유예가 이어받았다»의 증거가 된다(길게 잡으면 이어받지 않아도 진입해 **공허한 green**).
  //   🔴 **간격을 T(120ms)에 붙이지 마라.** 페이지 안 `setTimeout`도 rAF 틱·React 렌더 부하에
  //      밀려 수십 ms 늦게 깨어난다 — 실측에서 `gapMs:80`이 간헐적으로 120을 넘겨 **유예가
  //      만료됐고**, 그러면 오라클이 제품이 아니라 **스케줄러 지터**를 재게 된다.
  //      1/3 지점이면 80ms의 여유가 생긴다(실제 접촉 끊김도 수십 ms라 현실성도 그쪽이 맞다).
  const { held, inGrace } = await breakAndResume(page, {
    holdMs: 1000, gapMs: Math.floor(GRACE_MS / 3), dx: 0, dy: 0, tailMs: HOLD_MS - 1000 + 400,
  });

  expect(held, '전제: 첫 홀드가 차올랐다 — 0/-1이면 무판정').toBeGreaterThan(0);
  // ④ 🔴 유예 중에는 진행바가 **0으로 떨어지지도, 사라지지도 않는다.** 민구가 본 현상이 이것이다.
  //    (얼어 있어야 한다 — 표시를 내렸다 되살리면 120ms짜리 깜빡임이 그대로 남는다.)
  expect(
    inGrace,
    `유예 중 진행 표시가 무너졌다(${held} → ${inGrace}; -1은 표시 소멸)`
    + ' — 사용자 눈에 「리셋됐다 다시 차오름」으로 보인다',
  ).toBeGreaterThanOrEqual(held);

  // ⑤ 🔴 H3 — 흡수된 왕복은 abort를 **안 남기고**, 대신 resume=grace 시작이 남는다.
  //    (흡수는 abort를 지우는 것이 목적이므로, 그 건수를 셀 곳은 여기뿐이다.)
  //    🔑 **①보다 먼저 단언한다** — 로그가 «흡수됐는가»를 직접 말해 주므로, 실패했을 때
  //    «제품이 안 이어받았다»와 «하네스 지터로 유예가 만료됐다»를 이 줄이 갈라 준다.
  const evts = await logEvents(page);
  const starts = evts.filter((e) => e.parsed === 'screen_off_start').map((e) => e.extra ?? '');
  expect(
    starts.filter((x) => x.includes('resume=grace')).length,
    '유예 흡수 표식이 없다 — 이어받지 않았다는 뜻이다.'
    + ` (starts=${JSON.stringify(starts)}) 간격이 T를 넘겼는지(스케줄러 지터)부터 확인하라`,
  ).toBe(1);
  expect(
    evts.filter((e) => e.parsed === 'screen_off_abort'),
    '흡수된 왕복이 abort로도 세어졌다 — 취소율이 이중 계상된다',
  ).toHaveLength(0);

  // ① 이어받아 진입한다 — 누적 시간이 실제로 이어졌다는 최종 증거.
  await expect(
    overlay(page),
    '흡수 표식은 남았는데 진입하지 않았다 — 누적 시간(elapsedMs)이 안 이어졌다',
  ).toBeVisible({ timeout: 3000 });
});

test('②⑥ T 밖(400ms)의 재접촉은 새 홀드다 — 진입하지 않고 abort가 남는다', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForTtsIdle(page);

  const { inGrace } = await breakAndResume(page, {
    holdMs: 1000, gapMs: 400, dx: 0, dy: 0, tailMs: HOLD_MS - 1000 + 400,
  });
  // 🔑 유예가 만료됐으면 표시 자체가 걷혀 있어야 한다(-1) — 얼어붙은 채 남으면 좀비 상태다.
  expect(inGrace, `T를 넘겼는데 홀드 표시가 남아 있다(${inGrace}) — 유예가 안 걷혔다`).toBe(-1);

  // ② 이어받으면 안 된다 — 두 번째 홀드는 (HOLD_MS-1000+400)=1400ms뿐이라 단독으로는 부족하다.
  await expect(
    overlay(page),
    'T(120ms)를 400ms나 넘겼는데 이어받았다 — 손을 뗀 사용자의 홀드가 완주해 화면이 꺼진다',
  ).toHaveCount(0);

  // ⑥ 🔴 H3 — 유예 만료 = 진짜 취소. `reason=up`과 `at=<경과 ms>`가 남아야 한다.
  //    🔑 `at`은 50ms 단위 반올림이다(링버퍼 보호 — 카디널리티를 낮춘다).
  const aborts = (await logEvents(page))
    .filter((e) => e.parsed === 'screen_off_abort')
    .map((e) => e.extra ?? '');
  expect(aborts.length, `취소가 로그에 안 남았다 — H3의 존재 이유다(aborts=${JSON.stringify(aborts)})`)
    .toBeGreaterThanOrEqual(1);
  expect(aborts[0]).toContain('src=hold');
  expect(aborts[0]).toContain('reason=up');
  expect(aborts[0], `at 필드가 없다 — C1″/X2 판별이 불가능해진다(${aborts[0]})`).toMatch(/at=\d+/);
});

test('③ R 밖(200px)의 재접촉은 새 홀드다 — 뗐다 다른 곳을 누른 것은 이어받지 않는다', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForTtsIdle(page);

  // 🔴 거리 조건이 없으면 «뗐다가 화면 다른 데를 누른 것»까지 이어받아 의도치 않게 화면이 꺼진다.
  //    이 처방의 가장 큰 대가가 그것이라, 시간 축과 **별도로** 잰다.
  expect(200, '전제: 200px는 제품 반경 밖이어야 한다').toBeGreaterThan(GRACE_RADIUS_PX);
  const { inGrace } = await breakAndResume(page, {
    holdMs: 1000, gapMs: Math.floor(GRACE_MS / 3), dx: 200, dy: 0, tailMs: HOLD_MS - 1000 + 400,
  });
  // 🔑 시간 축은 만족했으므로 유예 자체는 살아 있었다 — 그런데도 이어받지 않았다면 «거리»가 이유다.
  //    (여기가 -1이면 시간 축에서 이미 걸린 것이라 R 조건을 잰 것이 아니다 = 무판정.)
  expect(inGrace, 'T 안인데 유예가 이미 걷혔다 — 이 케이스가 R 조건을 재지 못한다(무판정)')
    .toBeGreaterThanOrEqual(0);

  await expect(
    overlay(page),
    'T 안이지만 R 밖인 재접촉을 이어받았다 — 거리 조건이 안 걸린다',
  ).toHaveCount(0);

  // 🔴 [P1-2] **밀려난 취소도 로그에 남는다.** 독립 콜드 리뷰가 잡은 계측 편향의 오라클이다.
  //    종전에는 `beginHold`가 `clearGraceTimer()`로 «아직 안 찍힌 abort»를 통째로 삼켜,
  //    1,000ms까지 차올랐던 첫 홀드의 취소가 **로그에 한 줄도 안 남았다**(프로브 실증:
  //    `start, start, abort` — 남은 abort는 둘째 홀드의 것이었다).
  //    🔴 그 삼킴은 **한 방향으로만 편향된다**: `abort`만 줄고 `start`는 그대로라
  //    **H7′를 실제보다 잘 듣는 것처럼 보이게 한다.** 민구의 되돌리기 판단이 그 비율로 내려진다.
  //    🔑 **③이 이걸 안 재던 것이 그 결함이 살아남은 이유**라 여기에 얹는다(시나리오 재사용 = 비용 0).
  // ⚠️ 둘째 홀드의 취소는 **유예가 만료돼야** 찍힌다 — 그 창을 지나서 읽는다.
  //    (여기를 안 기다리면 «삼킴이 살아 있다»와 «아직 안 찍혔다»가 구분되지 않는다.)
  await page.waitForTimeout(GRACE_MS + 200);
  const aborts = (await logEvents(page))
    .filter((e) => e.parsed === 'screen_off_abort')
    .map((e) => e.extra ?? '');
  expect(
    aborts.length,
    '취소 2건(밀려난 첫 홀드 + 스스로 만료한 둘째)이 나야 한다 — 1건이면 삼킴이 살아 있다'
    + ` (aborts=${JSON.stringify(aborts)})`,
  ).toBe(2);
  // 🔑 밀려난 쪽이 **첫 홀드**(1000ms까지 찼던 것)임을 못박는다 — 둘째 것으로 바꿔치기되면
  //    「취소가 남았다」는 green이 되면서 **정작 삼켜진 그 취소는 그대로 사라진다.**
  expect(
    aborts.find((x) => x.includes('displaced=1')),
    '밀려난 취소의 at이 첫 홀드(≈1000ms)의 것이 아니다',
  ).toMatch(/at=(1000|1050|950)\b/);
  expect(
    aborts.filter((x) => x.includes('displaced=1')).length,
    '밀려난 취소에 displaced 표식이 없다 — 판독 레인이 「간격 0」을 X2로 오독하게 된다',
  ).toBe(1);
});

test('⑦ 회귀 — 조기 해제 후 미진입(v0470-w7 ②)이 유예 때문에 깨지지 않는다', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForTtsIdle(page);

  // 🔴 여기만 **실입력 경로**(`page.mouse`)를 쓴다 — 합성 이벤트가 아니라 브라우저가 실제로
  //    보내는 포인터(뒤따르는 `pointerleave` 포함)로도 회귀가 없는지가 이 케이스의 값어치다.
  const box = (await page.locator('[data-testid="hero-hold-surface"]').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(Math.floor(HOLD_MS * 0.4));
  await page.mouse.up();

  // 🔴 유예 창(120ms)이 지난 뒤에도, 그리고 원래 홀드 시간이 다 흐른 뒤에도 진입하면 안 된다.
  //    「유예가 타이머를 안 끄고 살려뒀다」가 이 단언이 잡는 회귀다.
  await page.waitForTimeout(HOLD_MS + GRACE_MS + 200);
  await expect(
    overlay(page),
    '중도 이탈로 화면이 꺼진다 — 유예가 홀드를 끄지 않고 살려뒀다',
  ).toHaveCount(0);
  await expect(
    page.locator('[data-testid="hero-hold-cue"]'),
    '유예가 만료됐는데 홀드 표시가 남아 있다 — 좀비 상태다',
  ).toHaveCount(0);
});

/** ⑧ 🔴 **유예 누적 상한** — 같은 자리 연타로 홀드를 「조립」할 수 없다.
 *
 *  ## 이 케이스가 왜 생겼나 (독립 콜드 리뷰 [P1-1], 2026-08-31)
 *  H7′ 초안에는 **재개에 아무 상한이 없었다.** 「간격 < T · 거리 < R」만 지키면 조각 개수에도
 *  총 시간에도 제한이 없어, 리뷰어가 **100ms 접촉 / 40ms 간격 × 25회**로 3,592ms 만에
 *  blackout 진입을 실증했다(`resume=grace` 19건이 사슬로 이어졌다).
 *
 *  🔴 **원인 귀속:** 이건 **H7′가 만든 회귀**다. H7′ 이전에는 `stopHold`가 즉시 `setProgress(0)`을
 *  했으므로 구조적으로 불가능했다. **H2(3000→2000)를 되돌려도 사라지지 않는다** — H2는 필요한
 *  조각 수를 줄일 뿐이다.
 *
 *  ## 🔴 어려운 지점 — 흡수하려는 신호와 부작용의 재료가 **같은 입력**이다
 *  이 처방이 잡으려는 것이 *"떨리는 엄지가 같은 자리에서 붙었다 떨어졌다"* 이고,
 *  악용 경로도 정확히 그 모양이다. **상한을 좁게 걸면 원래 고치려던 것을 못 고친다.**
 *  👉 그래서 상한의 축을 「횟수」가 아니라 **「유예가 대신 채워 준 시간의 총합」**으로 잡았다 —
 *  근거는 `HOLD_GRACE_BUDGET_MS` 주석이 SSOT다.
 *
 *  ## 재는 축
 *   ⑧-a **연타로는 진입하지 않는다** — 리뷰어의 프로브를 그대로 오라클로 굳힌다.
 *   ⑧-b 🔴 **그런데도 「몇 번의 짧은 끊김」은 여전히 흡수한다** — 상한이 처방을 죽이지 않았다는
 *        반대쪽 단언이다. ⑧-a만 두면 **유예를 통째로 없애도 green**이 된다(공허한 green).
 */
test('⑧-a 🔴 같은 자리 연타(100ms×25, 간격 40ms)로는 홀드가 조립되지 않는다', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForTtsIdle(page);

  const ops = [];
  for (let i = 0; i < 25; i++) {
    ops.push({ type: 'down' as const, wait: 100 });
    ops.push({ type: 'up' as const, wait: 40 });
  }
  await heroPointerSequence(page, ops);

  // 접촉 누계는 2,500ms로 HOLD_MS(2000)를 훌쩍 넘는다 — 상한이 없으면 반드시 진입한다.
  await expect(
    overlay(page),
    '연타 25회로 화면이 꺼졌다 — 유예가 조각을 무제한으로 이어붙인다(H7′가 만든 회귀)',
  ).toHaveCount(0);
});

test('⑧-b 🔴 반대쪽 — 짧은 끊김 2회는 여전히 흡수한다(상한이 처방을 죽이지 않았다)', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForTtsIdle(page);

  // 🔑 떨리는 엄지 모형: **긴 접촉 + 아주 짧은 끊김**. 연타(짧은 접촉 + 긴 간격)와 듀티비가 다르다.
  //    접촉 누계 700+700+700 = 2100ms > HOLD_MS. 끊김 누계는 2×40 = 80ms뿐이다.
  const starts = await (async () => {
    await heroPointerSequence(page, [
      { type: 'down', wait: 700 },
      { type: 'up', wait: 40 },
      { type: 'down', wait: 700 },
      { type: 'up', wait: 40 },
      { type: 'down', wait: 700 },
    ]);
    return (await logEvents(page))
      .filter((e) => e.parsed === 'screen_off_start')
      .map((e) => e.extra ?? '');
  })();

  expect(
    starts.filter((x) => x.includes('resume=grace')).length,
    `끊김 2회가 흡수되지 않았다 — 상한이 처방 자체를 죽였다(starts=${JSON.stringify(starts)})`,
  ).toBe(2);
  await expect(
    overlay(page),
    '끊김 2회를 흡수했는데도 진입하지 않았다 — 누적 시간이 안 이어졌다',
  ).toBeVisible({ timeout: 3000 });
  await heroPointerSequence(page, [{ type: 'up' }]);
});
