/**
 * v0.47.0 W6 오라클 — **완료(체크 글리프) 화면에서 접힌 조절판 필이 도트를 덮지 않는다.**
 *
 * 제보: 민구 FB-G②(08-08 02:31) *"도트 애니메이션 잘림"* — 18/18 완료 대기 화면에서 ✓ 글리프
 * 하단이 「허용 인식률 60% · 안내속도 1.15x」 필에 덮였다.
 *
 * ## 🔴 처방이 「글리프 축소」가 아닌 이유 — 실측이 원안을 반증했다 (2026-08-08)
 * 민구 원안은 *"해당 애니메이션의 크기를 잘리지 않는 선에서 축소"* 였다. 격자는 밴드 안에서
 * **세로 중앙정렬**이고 필은 **하단 고정**이라, 격자 높이 `G`에 대해
 * `check 잉크 하단 = 밴드중심 + (잉크하단행/14 − 1/2)·G` 다.
 * ⚠️ **v0.48.0 P1(`30fda46`)로 이 분수가 바뀌었다** — 잉크 하단이 r8 → **r9**로 내려가
 * `9/14`(0.1429·G)에서 **`10/14 − 1/2 = 0.2143·G`** 가 됐다. 겹침 잠재량이 **1.5배**다.
 * 402×513 실측(밴드중심 339.6 · 필top 335.3)에서는 **중심이 이미 필보다 아래**라
 * `G → 0`에서도 겹친다(`G ≤ −20.1` — 종전 수로는 −30.1이었다). 축소로는 도달할 수 없는
 * 목표였고, **P1로 잉크가 더 내려간 지금은 그 결론이 더 강해졌다.**
 * 🟢 **처방 자체는 바뀌지 않는다** — 완료 동안 필이 아예 렌더되지 않으므로(ⓐ가 `pillVisible`을
 * 함께 단언한다) 겹칠 대상이 없다. P1의 r9 확장이 W6를 깨지 않는 이유가 그것이다.
 * 👉 민구 재확정(08-08): **완료 상태 한정으로 필이 양보한다.**
 *    (08-07의 「짧은 화면 전 구간 숨김」안은 같은 날 20:10 민구가 취소했다 — 세션 중에 서랍을
 *     터치로 못 열게 되기 때문. 이 스펙의 범위가 **완료 한정**인 이유가 그것이다.)
 *
 * ## 재는 축
 *  ⓐ 402×513·402×874 **완료(check)** 에서 켜진 도트와 필의 **잉크 겹침 0**, 그리고 그것이
 *     *"필이 숨겨졌기 때문"* 임을 함께 단언한다. 🔴 `overlap === []`만 재면 **기능이 삭제돼도
 *     green이 된다**(겹칠 게 없으니까) — `v0461-p-dot-pill-short`가 세워둔 그 교훈을 따른다.
 *  ⓑ **완료를 벗어나면 필이 돌아온다.** 숨김이 편도로 굳으면 세션 재개 후 터치로 서랍을
 *     못 여는 회귀다(=08-07 안이 취소된 바로 그 이유).
 *  ⓒ 🔴 **v0.51에서 이 축의 전제가 죽었다** — 아래 테스트 주석이 SSOT.
 *
 * ## 🔴 안 재는 축
 *  - **진행 중(idle 웨이브·파형) 도트 가림** = FB-5. 이 처방으로 **해결되지 않는다**
 *    (402×513 실측 38셀 겹침 그대로). `tests/v0461-p-dot-pill-short.spec.ts`의 `@pending-fb5`
 *    2건이 계속 red로 그 결함을 붙들고 있다 — **이 파일이 그걸 대신하지 않는다.**
 *  - 도트 판독성(2~3m) — Playwright가 못 잰다.
 *
 * 🔴 402×513으로 직접 boot하지 않는다 — `voice-start-button`이 disabled인 채 타임아웃한다
 * (`v0461-p-dot-pill-short.spec.ts:41`의 실측). 874로 시작해 축소하는 실기기 경로를 쓴다.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, fillAllRows } from './fixtures/activeZones';
import { fireStt } from './fixtures/stt';

test.setTimeout(180_000);

/** 🔴 민구 실기기 = 402×513 (제보 9건 중 7건). */
const SHORT = { width: 402, height: 513 };

/** 🔴 `page.evaluate` 문자열 안에서 모듈 스코프 헬퍼를 부르지 않는다 — 직렬화가 깨지면
 *  오라클이 **조용히 죽는다**(`v0461-p-dot-pill-short.spec.ts:58`과 같은 함정). */
const MEASURE = `(() => {
  const pill = document.querySelector('[data-testid="input-control-toggle"]');
  const grid = document.querySelector('[data-testid="state-dots"]');
  if (!grid) return { err: 'no state-dots' };
  const p = pill ? pill.getBoundingClientRect() : null;
  const pillVisible = !!p && p.width > 0 && p.height > 0;
  const overlapLit = [];
  let litCount = 0;
  for (const el of Array.from(grid.querySelectorAll('span'))) {
    // §C4 mono 점멸이 켜진 셀 opacity를 0.66~1로 흔든다. 꺼진 셀은 0 고정([UI-DOT-GHOST-1]).
    if (parseFloat(getComputedStyle(el).opacity) <= 0.3) continue;
    litCount++;
    if (!pillVisible) continue;
    const r = el.getBoundingClientRect();
    if (Math.min(r.right, p.right) - Math.max(r.left, p.left) > 0
      && Math.min(r.bottom, p.bottom) - Math.max(r.top, p.top) > 0) {
      overlapLit.push(el.getAttribute('data-cell') || '0,0');
    }
  }
  return {
    glyph: grid.getAttribute('data-glyph'), pillVisible, litCount, overlapLit,
    rowPx: +parseFloat(getComputedStyle(grid).gridTemplateRows.split(' ')[0] || '0').toFixed(2),
    pillH: p ? +p.height.toFixed(1) : null,
  };
})()`;

type Snapshot = {
  glyph: string | null; pillVisible: boolean; litCount: number; overlapLit: string[];
  rowPx: number; pillH: number | null;
};

async function measure(page: Page, label: string): Promise<Snapshot> {
  const m = (await page.evaluate(MEASURE)) as Snapshot;
  console.log(
    `[w6:${label}] glyph=${m.glyph} 켜진셀=${m.litCount} 겹침=${m.overlapLit?.length} `
    + `필보임=${m.pillVisible} 행피치=${m.rowPx}px 필H=${m.pillH}`,
  );
  return m;
}

/** 완료(endReached) 도달 — check 글리프는 정적이라 프레임 합집합이 필요 없다. */
async function reachComplete(page: Page) {
  await fillAllRows(page);
  await expect(
    page.locator('[data-testid="state-dots"]'),
    'complete = endReached → check 글리프. 다르면 상태 미도달(무판정)',
  ).toHaveAttribute('data-glyph', 'check', { timeout: 10_000 });
  await page.waitForTimeout(700); // hangover(400ms) 경과 → 정적 글리프 확정
}

for (const viewport of [SHORT, PHONE_402]) {
  test(`ⓐ ${viewport.width}×${viewport.height} 완료 — 체크 글리프와 필의 잉크 겹침 0`, async ({ page }) => {
    await boot(page, PHONE_402);
    if (viewport.height !== PHONE_402.height) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(400); // ResizeObserver → useBandHeight 재측정
    }
    await reachComplete(page);

    const m = await measure(page, `${viewport.width}x${viewport.height}`);
    // 🔴 도달 못 한 프로브의 「겹침 없음」은 무판정이지 음성 결과가 아니다.
    expect(m.litCount, 'check는 22셀을 켠다 — 0이면 상태 미도달(무판정)').toBeGreaterThan(0);
    // 🔴 「왜 안 겹치는가」를 함께 못박는다 — 이게 없으면 컨트롤바가 통째로 사라져도 green이다.
    expect(
      m.pillVisible,
      `완료 화면에서는 접힌 필을 숨긴다(민구 확정 08-08). 보이면 가림이 남는다 — `
      + `행피치 ${m.rowPx}px · 예약예산 ${(m.rowPx * 4).toFixed(1)}px vs 필H ${m.pillH}px`,
    ).toBe(false);
    expect(m.overlapLit, `필이 켜진 도트 ${m.overlapLit?.length}셀을 덮는다`).toEqual([]);
  });
}

/** 🟢 숨김이 **편도로 굳지 않는다.** 굳으면 세션을 이어갈 때 터치로 서랍을 못 여는 회귀이고,
 *  그게 정확히 08-07 「짧은 화면 전 구간 숨김」안이 민구에게 취소당한 이유다. */
test('ⓑ 완료를 벗어나면 접힌 필이 돌아온다 — 숨김은 완료 한정이다', async ({ page }) => {
  await boot(page, PHONE_402);
  const pill = page.locator('[data-testid="input-control-toggle"]');
  await expect(pill, '전제: 진행 중에는 접힌 필이 보인다').toBeVisible();

  await reachComplete(page);
  await expect(pill, '완료 동안에는 숨는다').toHaveCount(0);

  // '이전' 명령으로 완료를 벗어난다 → phase가 complete를 벗어나며 endReached가 자동 해제된다
  // (`sessionStore.ts:230` setPhase). 그 자동 해제가 복귀 경로다 — 별도 배선이 없다.
  await fireStt(page, '이전행', 800);
  await expect(
    pill,
    '완료를 벗어났는데 필이 안 돌아온다 — 터치로 서랍을 영영 못 여는 회귀다',
  ).toBeVisible({ timeout: 8000 });
});

/** 🔴🔴 **v0.51 — 이 테스트의 전제가 죽었다. 계약을 뒤집어 다시 단언한다.** (정당 파손)
 *
 *  ## 종전 계약과 그것이 왜 있었나
 *  종전 제목: *"ⓒ 완료 중에도 음성 「입력조절」로 조절판이 열린다(기능 생존)"*.
 *  W6(08-08 민구 확정)가 **완료 동안 접힌 필을 숨기면서** 「이건 기능 삭제가 아니다」의 근거로
 *  삼은 것이 **음성 경로의 생존**이었고, 이 케이스가 그것을 붙들고 있었다.
 *
 *  ## 무엇이 그것을 죽였나
 *  민구 확정(2026-08-31): ***"조절판은 손으로만 — 음성 명령은 아예 없앱니다."***
 *  `toggleInputControls`가 `voiceCommands.ts`에서 제거되면서 **이 단언의 전제가 사라졌다.**
 *  🔴 **그래서 이 red는 진짜 신호였다** — 스펙을 고쳐 통과시키기 전에 무엇이 깨졌는지 먼저 적는다:
 *
 *  > **완료(체크 글리프) 동안에는 조절판을 여는 경로가 하나도 남지 않는다.**
 *  > 접힌 필은 W6가 숨기고, 음성은 v0.51이 없앴다. (설정탭에는 인식률·안내속도를 **바꾸는**
 *  > 자리가 없다 — 요약 **표시**만 있다. `SettingsSummaryModal:288` 실측.)
 *
 *  ## 그래서 어떻게 했나
 *  ① **막힘의 범위를 이 오라클이 직접 고정한다** — 「완료에서는 안 열린다」를 단언한다.
 *     그러면 다음 사람이 이 상태를 **모르고 만나는** 일이 없다.
 *  ② **탈출구가 살아 있음을 함께 단언한다** — 완료를 벗어나면 필이 돌아온다(ⓑ가 그 축을 진다).
 *     즉 「그 화면에서 못 연다」이지 **「영영 갇힌다」가 아니다.**
 *  🔴 **판정은 민구 몫이라 `_ASK-build.md` Q1으로 올렸다.** (b)「완료에도 필을 보인다」나
 *     (c)「'입력 조절' 한 개만 음성으로 남긴다」를 고르면 **이 테스트를 다시 뒤집어야 한다.** */
test('ⓒ 🔴 v0.51 — 완료 중 조절판 음성 경로는 사라졌고(무동작), 완료를 벗어나면 손 경로가 돌아온다', async ({ page }) => {
  await boot(page, PHONE_402);
  await reachComplete(page);

  // 🔴 `input-control-panel`을 쓰면 안 된다 — 접힌 필을 감싸는 **루트 div**라 닫힌 상태에서도
  //    존재한다. `{open && …}` 블록 **안에만** 있는 노드를 단언한다.
  const opened = page.locator('[data-testid="stepper-tolerance"]');
  await expect(opened, '전제: 열기 전에는 조절판이 닫혀 있다').toHaveCount(0);

  // ① 음성은 이제 아무 일도 하지 않는다.
  await fireStt(page, '입력조절', 900);
  await expect(
    opened,
    '음성 「입력조절」이 아직 조절판을 연다 — 「손으로만」 계약(민구 08-31) 위반',
  ).toHaveCount(0);
  // 접힌 필도 완료 중에는 없다(W6) — 즉 이 순간 여는 경로가 0개다. 그 사실을 명시적으로 못박는다.
  await expect(
    page.locator('[data-testid="input-control-toggle"]'),
    '전제: 완료 중에는 접힌 필이 숨겨져 있다(W6)',
  ).toHaveCount(0);

  // ② 🟢 **탈출구** — 완료를 벗어나면 손 경로가 돌아오고 조절판이 열린다.
  //    여기가 red면 「그 화면에서 못 연다」가 「영영 못 연다」가 된 것이다(등급이 다르다).
  // 벗어나는 방법은 ⓑ와 **같은 것**을 쓴다 — 완료 화면에서 `‹` 버튼의 가시성은 별개 계약이라
  //   여기서 그것에 기대면 이 테스트가 남의 계약 변화에 흔들린다.
  await fireStt(page, '이전행', 800);
  const pill = page.locator('[data-testid="input-control-toggle"]');
  await expect(pill, '완료를 벗어났는데 필이 안 돌아온다 — 조절판이 영구히 닫힌다').toBeVisible({ timeout: 8000 });
  await pill.click();
  await expect(opened, '손으로도 조절판이 안 열린다 — 「경로 제거」가 아니라 「기능 삭제」다')
    .toBeVisible({ timeout: 5000 });
});
