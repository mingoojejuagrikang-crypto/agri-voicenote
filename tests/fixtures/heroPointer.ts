/**
 * 히어로 홀드 표면 전용 **포인터 시퀀스 구동기** (v0.51 H1·H7′).
 *
 * ## 🔴 왜 `page.mouse`도 CDP도 아닌가 — 실측으로 둘 다 못 쓴다
 *  · `page.mouse`는 **포인터가 하나뿐**이라 H1(둘째 손가락)을 **구조적으로 재현할 수 없다.**
 *  · `page.touchscreen`은 단일 탭만 지원한다.
 *  · CDP `Input.dispatchTouchEvent`는 세션이 터치 상태를 들고 있어야 하는데, 호출마다 세션을
 *    새로 열면 *"Must send a TouchStart first"* 로 죽는다(실측). 세션을 유지해도 다음 문제가 남는다:
 *  · 🔴 **왕복 지연이 계약을 먹는다.** H7′의 유예 창은 **120ms**인데, 테스트 러너에서
 *    `mouse.up()` → `waitForTimeout(80)` → `mouse.move()` → `mouse.down()`은 **네 번의 왕복**이다.
 *    거기에 중간 `locator.getAttribute()` 한 번이 더 끼면(진행값 관찰) 실측 간격이 120ms를 훌쩍
 *    넘어 **유예가 항상 만료된다** — 오라클이 제품이 아니라 **하네스 지연을 재게 된다.**
 *    (실제로 초안이 그렇게 red를 냈다. 게다가 `getAttribute`는 요소가 사라지면 30초를 기다려
 *     테스트를 타임아웃까지 밀어붙였다.)
 *
 * 👉 그래서 **한 번의 `page.evaluate` 안에서** 이벤트와 대기를 전부 처리한다. 페이지 안의
 *    `setTimeout`은 왕복이 없으므로 120ms 계약을 **의도한 정밀도로** 잰다.
 *
 * ## ⚠️ 이 방식이 재지 **못하는** 것 — 정직하게 적는다
 *  합성 `PointerEvent`는 브라우저의 히트테스트·암묵 포인터 캡처·`pointerleave` 자동 발행을
 *  **거치지 않는다.** 즉 이 구동기는 «앱이 포인터 이벤트를 어떻게 해석하는가»를 재는 것이지
 *  «실기기에서 그 이벤트가 실제로 오는가»를 재지 않는다.
 *  🔴 후자는 **실기기 대본(민구 20회 반복)** 만이 판정한다. 실입력 경로가 필요한 케이스는
 *  같은 스펙 안에서 `page.mouse`를 그대로 쓴다(둘을 섞어 쓰는 것이 의도다).
 */
import type { Page } from '@playwright/test';

export interface HeroPointerOp {
  type: 'down' | 'up' | 'cancel' | 'move';
  /** 포인터 id. 기본 1 — 둘째 손가락은 2를 쓴다. */
  id?: number;
  /** 히어로 **중앙 기준** 오프셋(px). */
  dx?: number;
  dy?: number;
  /** 기본 true. 둘째 손가락은 false(브라우저 동작과 같게 — `beginHold`의 `isPrimary` 가드 대상). */
  isPrimary?: boolean;
  /** 이 동작 **뒤** 페이지 안에서 기다릴 시간(ms). */
  wait?: number;
}

/**
 * 시퀀스를 실행하고, **각 동작(+대기) 직후의 진행값**을 순서대로 돌려준다.
 * @returns `data-progress` 배열. **`-1`은 「홀드 표시 자체가 없다」**(`hero-hold-cue` 미렌더)를
 *          뜻하며 `0`(표시는 있는데 진행값이 0)과 **구분된다** — V-FIX3b가 갈라 둔 두 축이고,
 *          H7′의 «깜빡임 없음» 판정이 정확히 그 구분 위에서 이뤄진다.
 */
export async function heroPointerSequence(page: Page, ops: HeroPointerOp[]): Promise<number[]> {
  return page.evaluate(async (steps: HeroPointerOp[]) => {
    const el = document.querySelector('[data-testid="hero-hold-surface"]');
    if (!el) throw new Error('hero-hold-surface 미존재 — hero 분기 미도달(무판정)');
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const TYPE: Record<string, string> = {
      down: 'pointerdown', up: 'pointerup', cancel: 'pointercancel', move: 'pointermove',
    };
    const read = () => {
      const f = document.querySelector('[data-testid="hero-hold-fill"]');
      return f ? Number(f.getAttribute('data-progress')) : -1;
    };
    const out: number[] = [];
    for (const op of steps) {
      el.dispatchEvent(new PointerEvent(TYPE[op.type], {
        pointerId: op.id ?? 1,
        isPrimary: op.isPrimary ?? true,
        clientX: cx + (op.dx ?? 0),
        clientY: cy + (op.dy ?? 0),
        pointerType: 'touch',
        // 🔴 React 18은 루트 컨테이너에 위임 청취한다 — `bubbles:true`가 없으면 핸들러에 안 닿는다.
        bubbles: true,
        cancelable: true,
      }));
      if (op.wait) await new Promise((res) => setTimeout(res, op.wait));
      out.push(read());
    }
    return out;
  }, ops);
}
