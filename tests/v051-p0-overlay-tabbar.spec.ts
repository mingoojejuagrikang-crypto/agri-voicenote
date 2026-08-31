/**
 * v0.51 P0-1 오라클 — **보기 전용 오버레이가 하단 나비(TabBar)를 남긴다.**
 *
 * ## 이 스펙이 왜 생겼나 (민구 실기기 2026-08-31)
 * > *"「?」 도움말을 열어 놓고 개선요청 탭을 누르면 개선요청이 안 열리고 팝업만 닫힌다."*
 *
 * 원인은 z-index가 아니라 **면적**이었다. 「?」 팝업 오버레이가 `position:fixed; inset:0`이라
 * **탭 자리까지 덮고**, 그 자리를 누르면 백드롭의 `onClick={onClose}`가 먹어 팝업만 닫힌다.
 * **탭은 눌린 적이 없다.**
 * 🔴 **이건 UI 불편이 아니라 제보 채널의 폐색이다** — 민구가 개선요청을 쓰려던 순간이 곧
 * 「?」 팝업을 보던 순간이라, **이번 회차 개선요청 0건의 원인이 이것**이라는 판정이 나왔다.
 * 그래서 P0다.
 *
 * ## 🔴 여기가 지키는 것과, 여기가 **일부러 안 지키는 것**
 * 민구 확정(08-31)은 *"보기 전용 오버레이는 탭바를 남긴다"* 이지 *"전부 남긴다"* 가 아니다.
 * 이 스펙은 **양쪽을 다 잰다** — 남기는 쪽만 재면 「전부 열어버리는」 과잉 처방이 green이 된다.
 *  - 🟢 남긴다: 「?」 명령어 도움말 · 설정탭 도움말 · 표 미리보기(**비게이트**) · 세션 상세
 *  - 🔴 막는다(회귀 가드): 개선요청(작성 중 유실) · 데이터탭 내보내기류(`Backdrop` 기본값)
 *
 * ## 재는 축
 *  ① 「?」 팝업이 열린 채 **개선요청 탭이 눌린다** — 제보 채널 복구의 직접 반증 조건.
 *     🔑 팝업이 **닫히지 않은 채** 개선요청이 뜨는 것까지 잰다: 첨부 스크린샷에 그 팝업이
 *     찍혀야 민구가 *"이 화면에서 이게 문제다"* 를 보낼 수 있다(그게 이 기능의 목적이다).
 *  ② 같은 상태에서 **다른 탭(설정)도 눌린다** + 팝업이 사라진다 + **STT가 재개된다.**
 *     🔴 후자가 v0.37.0 리뷰#2가 세운 계약이다 — 탭은 눌리는데 STT가 정지된 채 남으면
 *     `requestOverlayClose` 경로가 실제로는 안 도는 것이고, 그때는 P0-1을 되돌려야 한다.
 *     (계획서 §2-5의 「반증」이 이 단언이다.)
 *  ③ **겹침 0** — 팝업 오버레이의 bottom ≤ 탭바의 top. ①②가 «눌린다»를 재고 ③이 «왜»를 잰다.
 *  ④ 설정탭 도움말이 열린 채 다른 탭이 눌린다(적용 4종 중 `ModalBase` 경로 커버).
 *  ⑤ **세로 안전망** — 목록이 넘쳐도 ① 마지막 항목에 도달할 수 있고 ② 하단 「닫기」가
 *     항상 보이고 탭 가능하다. 실측 수치를 실패 메시지에 실어 다음 회차가 눈금을 갖게 한다.
 *  ⑤′ **민구가 스크롤을 선택했다** `@pending-help-overflow` — 아래 테스트 주석이 SSOT.
 *     🔴 **「아직 못 고친 것」이 아니다.** 미해결로 읽으면 다음 회차가 헛수고한다.
 *  ⑥ 🔴 **회귀 가드 — 개선요청은 여전히 나비를 덮는다.** 작성 중 이탈 = 입력 유실.
 *
 * ## 🔴🔴 ⑤에서 실측으로 뒤집힌 것 — **초과는 이 회차가 만든 것이 아니다** [TEAMOPS-44]
 * 계획서는 *"P0-1로 팝업이 약 63px 짧아지니 넘치는지 확인하라"* 였다. 재 보니 **이미 넘쳐 있었다**:
 * ```
 *          내용(scrollHeight)   자리(clientHeight)   초과
 *  v0.50.0        831 px              562 px        269 px   ← 배포본이 이미 스크롤된다
 *  P0-1 직후      831 px              486 px        345 px   ← 자리 −76
 *  P0-1 + 100%    831 px              562 px        269 px   ← maxHeight 90%→100%로 원복
 * ```
 * 👉 **P0-1의 세로 대가는 `maxHeight` 한 줄로 전액 상환됐다**(제품 주석에 근거를 적었다).
 * 👉 그리고 **조사 산출물 §2-5의 «현행 18줄이 402×874에 꽉 찬다»는 과소평가였다** — 꽉 찬 게
 *    아니라 **269px 넘쳐 있었다**(설명이 402폭에서 2줄로 감겨 행당 ≈46px이 된다).
 * 🔑 그래서 도움말 표(P2-2)는 **새 실패 모드를 만들지 않는다** — 이미 있는 초과를 깊게 할 뿐이다.
 * 🟢 **민구 판정(2026-08-31): 「그냥 스크롤하게 둔다」.** 456px 그대로 간다 — ⑤′는 그 **결정의
 *    기록**이지 미해결 부채가 아니다(아래 그 테스트의 주석이 SSOT).
 *
 * ## 🔴 안 재는 축
 *  - 표 미리보기(비게이트)·세션 상세의 geometry — 같은 `bottomInset` 한 축을 ③④가 이미 잰다.
 *    저 둘은 도달 비용이 크고(테이블 생성·세션 시딩) 재는 계약이 같다. 대신 **막는 쪽**의
 *    회귀 가드(⑥)를 넣어 「전부 열림」 과잉을 잡는다.
 *  - 나비 자체의 높이·safe-area → `safe-area.spec.ts` · `v0470-r2-nav-label.spec.ts`(둘 다 게이트 안).
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402 } from './fixtures/activeZones';
import { waitForTtsIdle } from './fixtures/stt';

test.setTimeout(120_000);

const popup = (page: Page) => page.locator('[data-testid="command-help-popup"]');
const tabBar = (page: Page) => page.locator('[data-testid="tab-bar"]');

/** 「?」 도움말을 연다. 버튼 셀렉터는 기존 스펙들(`v026-tolerance-strict`·`v049-f1`)과 같은 것을 쓴다. */
async function openCommandHelp(page: Page) {
  await page.locator('button[title="음성 명령어 도움말"]').first().click();
  await expect(popup(page)).toBeVisible({ timeout: 3000 });
  await page.waitForTimeout(150);
}

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

test('① 🔴 「?」 팝업이 열린 채 개선요청 탭이 눌린다 — 팝업은 닫히지 않는다(스크린샷에 찍혀야 한다)', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForTtsIdle(page);
  await openCommandHelp(page);

  await page.locator('[data-testid="tab-feedback"]').click();

  await expect(
    page.locator('[data-testid="feedback-modal"]'),
    '개선요청이 안 열린다 — 백드롭이 탭을 먹고 팝업만 닫힌 것이다(제보 채널 폐색 재발)',
  ).toBeVisible({ timeout: 8000 });
  // 🔑 개선요청 인터셉트는 `requestOverlayClose`를 **타지 않는다**(App.tsx가 그 전에 return한다).
  //    그래서 팝업이 열린 채로 캡처가 돈다 — 민구가 원한 «그 화면 그대로 보내기»가 그것이다.
  await expect(
    popup(page),
    '팝업이 닫혔다 — 첨부 스크린샷에 문제 화면이 안 찍힌다',
  ).toBeVisible();
});

test('② 🔴 팝업이 열린 채 다른 탭이 눌린다 + 팝업이 걷히고 STT가 재개된다(v0.37.0 리뷰#2 회귀)', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForTtsIdle(page);
  await openCommandHelp(page);

  await page.locator('[data-testid="tab-settings"]').click();
  await page.waitForTimeout(600);

  await expect(popup(page), '탭을 옮겼는데 팝업이 남아 있다').toHaveCount(0);
  await expect(
    page.locator('[data-testid="tab-settings"]'),
    '설정 화면으로 전환되지 않았다',
  ).toHaveAttribute('aria-current', 'page');

  // 🔴 반증 조건 — 탭은 눌리는데 STT가 정지된 채 남으면 `requestOverlayClose`가 실제로는 안 도는
  //    것이다. 그 경우 P0-1을 되돌리고 다른 방식으로 가야 한다(계획서 §2-5).
  const events = await logEvents(page);
  expect(
    events.some((e) => e.type === 'command' && e.parsed === 'ui_resume' && e.extra === 'command_help'),
    'ui_resume(command_help)이 없다 — 도움말이 STT를 정지시킨 채 방치됐다',
  ).toBe(true);
});

test('③ 겹침 0 — 팝업 오버레이의 bottom이 탭바의 top을 넘지 않는다', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForTtsIdle(page);
  await openCommandHelp(page);

  const overlayBox = await popup(page).evaluate((el) => {
    const r = el.parentElement!.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom };
  });
  const navBox = (await tabBar(page).boundingBox())!;

  const EPS = 0.5;
  expect(
    overlayBox.bottom,
    `오버레이 bottom(${overlayBox.bottom})이 나비 top(${navBox.y})을 침범한다 — 탭이 안 눌린다`,
  ).toBeLessThanOrEqual(navBox.y + EPS);
});

test('④ 설정탭 도움말이 열린 채 다른 탭이 눌린다(ModalBase bottomInset 경로)', async ({ page }) => {
  await boot(page, PHONE_402);
  await page.locator('[data-testid="tab-settings"]').click();
  await page.waitForTimeout(400);

  await page.locator('[data-testid="settings-help-button"]').first().click();
  const helpModal = page.locator('[data-testid="settings-help-modal"]');
  await expect(helpModal).toBeVisible({ timeout: 3000 });
  await page.waitForTimeout(200);

  const navBox = (await tabBar(page).boundingBox())!;
  const overlayBottom = await helpModal.evaluate((el) => el.getBoundingClientRect().bottom);
  expect(
    overlayBottom,
    `설정 도움말 오버레이 bottom(${overlayBottom})이 나비 top(${navBox.y})을 침범한다`,
  ).toBeLessThanOrEqual(navBox.y + 0.5);

  await page.locator('[data-testid="tab-data"]').click();
  await page.waitForTimeout(500);
  await expect(
    page.locator('[data-testid="tab-data"]'),
    '설정 도움말이 열린 채로는 탭이 안 눌린다',
  ).toHaveAttribute('aria-current', 'page');
});

/** ⑤ **안전망은 산다** — 목록이 넘쳐도 기능은 안 깨진다(목록만 스크롤 · 하단 「닫기」 고정).
 *  🔑 이건 ⑤′의 약화판이 아니라 **다른 계약**이다: ⑤′는 *"스크롤이 필요하지 않다"*(UX),
 *  ⑤는 *"스크롤이 필요해도 갇히지 않는다"*(도달성). 초과가 해소돼도 ⑤는 그대로 살아야 한다. */
test('⑤ 세로 안전망 — 넘쳐도 마지막 항목에 닿고 하단 「닫기」는 항상 탭 가능하다', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForTtsIdle(page);
  await openCommandHelp(page);

  const list = page.locator('[data-testid="cmd-help-list"]');
  const m = await list.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
  // 🔬 수치를 로그로 남긴다 — 단언하지 않는다(그건 ⑤′의 몫이다). 다음 회차가 눈금을 갖는다.
  console.log(`[help-popup] scrollHeight=${m.sh} clientHeight=${m.ch} overflow=${m.sh - m.ch}`);

  const last = list.locator('> div').last();
  await last.scrollIntoViewIfNeeded();
  await expect(last, '마지막 항목에 스크롤로도 닿지 못한다 — 갇힘이다').toBeVisible();

  const closeBtn = page.locator('[data-testid="cmd-help-close"]');
  const closeBox = (await closeBtn.boundingBox())!;
  const lastBox = (await last.boundingBox())!;
  expect(
    lastBox.y + lastBox.height,
    '목록이 하단 닫기 버튼을 덮는다 — 스크롤 컨테이너 분리가 깨졌다',
  ).toBeLessThanOrEqual(closeBox.y + 1);
  // 실제 히트테스트 — 「보인다」와 「눌린다」는 다르다.
  await closeBtn.click({ trial: true });
});

/** ⑤′ **「스크롤 없이 다 보인다」는 이 앱이 더 이상 추구하지 않는 계약이다.** `@pending-help-overflow`
 *
 *  ## 🔴 이 red는 **미해결 부채가 아니라 결정의 기록**이다 — 오독 금지
 *  민구 08-07 판정(FB-4)은 *"서랍 펼칠시 **스크롤 없이** 보이게 변경"* 이었고, 같은 기준을 이
 *  팝업에 적용하면 **v0.50.0 배포본이 이미 269px 어기고 있었다**(위 헤더의 표 — P0-1이 만든 게
 *  아니다). 도움말 표(P2-2)를 넣으면 456px가 된다.
 *  👉 그 수치를 그대로 올려 물었고, **민구 판정(2026-08-31): *"그냥 스크롤하게 둔다."***
 *
 *  🔴 **그래서 이 테스트를 지우지도, 「고쳐야 할 것」으로 읽지도 마라.**
 *   · **지운다면** — 언젠가 도움말이 다시 한 화면에 들어오게 됐을 때 그 사실을 아무도 모른다.
 *     이 테스트는 그때 **green으로 바뀌며 알려 주는 눈금**이다(초과가 해소되면 태그를 뗀다).
 *   · **고치려 든다면** — 민구가 반대 방향을 이미 골랐다. 타이포 압축은 v0.26.0이 이미 했고
 *     더 줄이면 2~3m 판독성이 깨진다. **되돌아오지 마라.**
 *   · ⑤(안전망 · green)가 **실제 계약**이다: 넘쳐도 마지막 항목에 닿고 「닫기」는 항상 눌린다.
 *
 *  🔴 **`test.fail()`을 쓰지 않는다**(레포 관례 — `v044-alarm-compare-fit.spec.ts` §19):
 *  그걸 쓰면 **어떤** 실패든 「예상된 실패」로 green이 되어 다른 이유의 red를 삼킨다.
 *  대신 `@pending-fb5` 선례대로 **태그로 격리**한다 — 게이트 목록에 이 파일이 들어가 있으므로
 *  게이트 명령이 이 태그를 grep-invert로 제외한다(`package.json`). */
test('⑤′ 도움말이 한 화면에 들어오는가(민구 판정: 스크롤 허용 — red가 정상) @pending-help-overflow', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForTtsIdle(page);
  await openCommandHelp(page);

  const m = await page.locator('[data-testid="cmd-help-list"]').evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));

  // 🟢 이 red는 «민구가 스크롤을 선택했다»의 기록이다. green이 되면 **초과가 해소된 것**이므로
  //    그때 태그를 떼고 정상 계약으로 승격하라(위 주석).
  expect(
    m.scrollHeight,
    `도움말이 한 화면을 넘는다(내용 ${m.scrollHeight}px > 자리 ${m.clientHeight}px = 초과 ${m.scrollHeight - m.clientHeight}px).`
    + ' 🟢 민구 판정(08-31)으로 **이 초과는 허용된 상태**다 — 고치려 들지 말고 위 주석을 읽어라.',
  ).toBeLessThanOrEqual(m.clientHeight + 1);
});

test('⑥ 🔴 회귀 가드 — 개선요청은 여전히 나비를 덮는다(작성 중 이탈 = 입력 유실)', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForTtsIdle(page);

  await page.locator('[data-testid="tab-feedback"]').click();
  const modal = page.locator('[data-testid="feedback-modal"]');
  await expect(modal).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(200);

  const vpHeight = page.viewportSize()!.height;
  const overlayBottom = await modal.evaluate((el) => el.getBoundingClientRect().bottom);
  // 🔑 「덮는다」는 «오버레이가 뷰포트 바닥까지 간다»로 잰다 — 나비 top과 비교하면 「안 덮는다」의
  //    부정이라 임계에서 흔들린다. 바닥까지 가면 나비는 그 아래에 없다(=덮였다).
  expect(
    overlayBottom,
    `개선요청 오버레이 bottom(${overlayBottom})이 뷰포트 바닥(${vpHeight})에 못 미친다 — 「보기 전용」 처방이 여기까지 번졌다`,
  ).toBeGreaterThanOrEqual(vpHeight - 0.5);
});
