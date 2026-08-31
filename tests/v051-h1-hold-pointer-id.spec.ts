/**
 * v0.51 H1 오라클 — **끄기 홀드의 `pointerId` 가드.**
 *
 * ## 왜 생겼나 — **비대칭이 근거다**
 * 같은 제스처를 다루는 두 컴포넌트 중 **한쪽에만 가드가 있었다**:
 * `BlackoutOverlay`(켜기)의 `endHold`는 `pointerIdRef`로 남의 up을 걸러내는데,
 * `HeroHoldToBlackout`(끄기)의 `stopHold`는 **누가 뗐든 그대로 취소**했다.
 * `beginHold`의 `isPrimary` 가드는 둘째 손가락의 **시작**만 막지, 그 손가락의 `pointerup`이
 * 첫 손가락의 홀드를 죽이는 것은 못 막는다. 설계 의도가 아니라 **누락**이다.
 *
 * ## 🔴 이 스펙이 「증상 해소」를 재는 것이 **아니라는 점**을 먼저 적는다
 * 08-31 민구 확인(*"엄지 하나만 닿았다"*)으로 멀티터치 가설(C2)은 **폐기됐다.**
 * 즉 H1은 **「고쳐야 할 것」이지 「고치면 낫는 것」이 아니다.** 이 스펙이 green이어도
 * 민구의 증상(진행바 리셋)은 남을 수 있고, **그건 H1이 틀린 게 아니다.**
 * 🔑 그럼에도 지금 넣는 이유는 H7′(유예 창)의 **선행 조건**이기 때문이다 — 가드가 없으면
 * 유예 로직이 *"방금 up한 것이 누구 것인가"* 를 추가로 판정해야 한다.
 *
 * ## 🔴 왜 `page.mouse`가 아닌가 — 구동기는 `fixtures/heroPointer.ts`가 진다
 * `page.mouse`는 포인터가 **하나뿐**이라 이 결함을 **구조적으로 재현할 수 없다.**
 * CDP `Input.dispatchTouchEvent`도 실측에서 죽었다(*"Must send a TouchStart first"*).
 * 그래서 **페이지 안에서 합성 `PointerEvent`를 쏜다** — 근거·한계는 그 픽스처의 헤더가 SSOT다.
 * ⚠️ 이 파일이 이 레포에서 **멀티터치를 재는 첫 스펙**이다.
 *
 * ## 재는 축
 *  ① 🔴 엄지로 누른 채 **둘째 손가락이 톡** → 진행바가 **끊기지 않는다.**
 *  ② 그 상태로 홀드를 채우면 **진입한다**(둘째 손가락이 시간 판정도 못 건드린다).
 *  ③ H3 동거 — 가드가 먹은 둘째 포인터의 up은 **`screen_off_abort`를 남기지 않는다.**
 *     🔑 ①의 «진행바가 산다»와 **다른 축**이다: 화면은 멀쩡한데 로그만 오염되면 다음 회차의
 *     취소율 판정이 틀어진다(그 판정이 H2·H7′의 효과 측정 근거다).
 *  ④ 대조군 — **주 포인터**가 떼면 종전대로 취소된다(가드가 과잉이 아니다).
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402 } from './fixtures/activeZones';
import { heroPointerSequence } from './fixtures/heroPointer';
import { waitForTtsIdle } from './fixtures/stt';

test.setTimeout(120_000);

/** 제품 상수 `HOLD_TO_BLACKOUT_MS`와 같아야 한다 — [TEAMOPS-38] 관례로 **일부러 import하지
 *  않는다**(제품이 값을 바꾸면 계약이 여기 남아 오라클이 신호를 낸다). */
const HOLD_MS = 2000;

const overlay = (page: Page) => page.locator('[data-testid="blackout-overlay"]');

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

test('①②③ 엄지 홀드 중 둘째 손가락이 톡 — 진행바가 끊기지 않고, 진입하고, abort도 안 남는다', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForTtsIdle(page);

  // 엄지(id=1, primary) 다운 → 500ms → 둘째(id=2, **비primary**) 다운/업 → 엄지 그대로 유지.
  //   🔑 둘째를 `isPrimary:false`로 쏘는 것이 브라우저 동작과 같다 — `beginHold`의 `isPrimary`
  //      가드가 **시작**을 막는 것은 종전에도 됐고, 이 스펙이 재는 것은 그 손가락의 **up**이다.
  const seen = await heroPointerSequence(page, [
    { type: 'down', id: 1, wait: 500 },
    { type: 'down', id: 2, isPrimary: false, dx: 120, dy: 60, wait: 60 },
    { type: 'up', id: 2, isPrimary: false, dx: 120, dy: 60, wait: 120 },
  ]);
  const [afterThumb, afterSecondDown, afterSecondUp] = seen;

  expect(afterThumb, '전제: 엄지 홀드로 진행바가 차오르고 있다 — 0/-1이면 무판정').toBeGreaterThan(0);
  // ① 진행바가 살아 있다 — 가드가 없으면 둘째의 up에서 0(또는 표시 소멸 -1)이 된다.
  expect(
    afterSecondUp,
    `둘째 손가락의 up이 엄지의 홀드를 취소했다(${afterThumb} → ${afterSecondDown} → ${afterSecondUp})`
    + ' — pointerId 가드가 없다',
  ).toBeGreaterThanOrEqual(afterThumb);

  // ② 시간 판정도 안 건드린다 — 그대로 채우면 진입한다.
  await page.waitForTimeout(HOLD_MS);
  await expect(
    overlay(page),
    '둘째 손가락이 시간 판정을 되돌렸다 — 홀드가 처음부터 다시 셌다',
  ).toBeVisible({ timeout: 3000 });
  await heroPointerSequence(page, [{ type: 'up', id: 1 }]);

  // ③ 🔴 H3 동거 — 가드가 먹은 up은 `stopHold` 자체에 도달하지 않으므로 abort가 없어야 한다.
  //    (완주 뒤 따라오는 엄지의 up도 마찬가지다 — 「도는 홀드가 없으면 아무것도 안 한다」 술어.)
  const aborts = (await logEvents(page)).filter((e) => e.parsed === 'screen_off_abort');
  expect(
    aborts.map((e) => e.extra),
    '취소가 없었는데 abort가 남았다 — 취소율 집계가 오염된다(H2·H7′ 효과 측정의 근거다)',
  ).toEqual([]);
});

test('④ 대조군 — 주 포인터가 떼면 종전대로 취소된다(가드가 과잉이 아니다)', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForTtsIdle(page);

  // 🔴 실입력 경로(`page.mouse`)로 잰다 — 합성 이벤트가 아니라 **브라우저가 실제로 보내는**
  //    포인터로도 가드가 과잉이 아님을 확인하는 것이 이 대조군의 값어치다.
  const box = (await page.locator('[data-testid="hero-hold-surface"]').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // 🔴 **경계 있는 대기 + 논블로킹 읽기.** `locator.getAttribute()`는 `actionTimeout:0`이라
  //    요소가 안 뜨면 **테스트 타임아웃(120s)까지 붙잡는다** — 실측으로 그렇게 물렸다.
  //    그러면 실패 메시지가 «page closed»가 되어 **무엇이 틀렸는지 못 알려준다.**
  //    `expect.poll`은 상한이 있고, `evaluate`는 요소가 없으면 즉시 `-1`을 돌려준다.
  await expect(
    page.locator('[data-testid="hero-hold-cue"]'),
    '전제 미충족: 마우스 다운으로 홀드가 시작되지 않았다(hero 분기 미도달 등) — 무판정',
  ).toBeVisible({ timeout: 3000 });
  await expect
    .poll(
      async () => page.evaluate(() => {
        const f = document.querySelector('[data-testid="hero-hold-fill"]');
        return f ? Number(f.getAttribute('data-progress')) : -1;
      }),
      { timeout: 3000, message: '전제: 차오르고 있다' },
    )
    .toBeGreaterThan(0);

  await page.mouse.up();
  // 🔴 H7′ 유예(120ms)가 지나야 진짜 리셋이다 — 그 창 안에서 재면 「가드가 과잉」과
  //    「유예가 살아 있음」을 구분하지 못한다. 넉넉히 기다린다.
  await page.waitForTimeout(600);

  await expect(
    page.locator('[data-testid="hero-hold-cue"]'),
    '주 포인터가 뗐는데도 홀드 표시가 남는다 — 가드가 과잉이라 아무도 홀드를 못 끝낸다',
  ).toHaveCount(0);
  await page.waitForTimeout(HOLD_MS);
  await expect(overlay(page), '취소된 홀드가 나중에 진입했다').toHaveCount(0);
});
