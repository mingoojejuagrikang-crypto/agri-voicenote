import { test, expect, type Page } from '@playwright/test';
import { boot } from './fixtures/activeZones';
import { fireStt, waitForTtsIdle } from './fixtures/stt';

/**
 * v0.46.0 콜드 리뷰 L3-3(major) 게이트 — **검은 화면 모드의 탈출 경로.**
 *
 * ## 왜 신설하나
 *
 * WP-F가 신규 131줄(`BlackoutOverlay.tsx`)을 넣었는데 **오라클이 0건이었다**(L3 전수 grep).
 * 🔴 **이 기능의 실패 모드는 「앱에 갇힘」이다** — 오버레이는 `position:fixed; inset:0; zIndex:9999`로
 * 화면 전체를 덮고, 나가는 길은 **길게 누르기 하나**뿐이다. 그 하나가 깨지면 사용자는
 * 앱을 강제 종료해야 하고, **진행 중인 세션의 클립·값이 위험해진다.**
 * 게이트가 없는 채로 배포하면 그 상태를 **아무도 감지하지 못한다.**
 *
 * ## 이 파일이 재는 것
 *
 * | # | 축 | 왜 |
 * |---|---|---|
 * | 1 | 음성 `'화면'`으로 진입한다 | v0.47.0 W7 이후로도 **살아 있어야 하는** 경로(홀드가 추가됐을 뿐) |
 * | 2 | 중앙을 **2초 홀드**하면 해제된다 (r2 P6 전까지는 「탭」) | 포인터 탈출 경로 |
 * | 3 | 🆕 **키보드(Enter)로도 탈출한다** | `role="button"`+`tabIndex=0`을 선언했으므로 계약이다(L3-5) |
 * | 4 | 해제 후 입력이 계속된다 | 「음성 입력은 계속됩니다」 고지가 참인지 |
 *
 * ## 🔴 v0.47.0 W7 정당 파손 — 「길게 누르기」 계약이 「중앙 탭」으로 교체됐다 (민구 08-08)
 * 종전 이 파일의 축 3은 *"짧게 누르면 해제되지 않는다"* 였고 근거는 *"순간 입력으로 풀리면
 * 주머니 속 오작동으로 화면이 켜진다"* 였다. 민구 확정으로 **그 방어가 「시간」에서 「위치」로
 * 이전됐다**: 중앙 영역만 받고 가장자리는 무시한다. 그래서 그 케이스는 여기서 삭제하고,
 * 대체 계약(**가장자리 탭 무시**)은 `tests/v0470-w7-hold-blackout.spec.ts` ③이 진다.
 * ⚠️ 삭제가 아니라 **이전**이다 — 저쪽이 없어지면 절전 기능이 주머니에서 스스로 켜진다.
 *
 * ## 🔴 v0.47.0 r2 P6 정당 파손 2차 — 「중앙 탭」이 **「중앙 2초 홀드」**로 되돌아갔다 (민구 08-09)
 * 08-08의 「위치로 이전」은 살아 있다(중앙 히트존 그대로). 무너진 것은 **「탭」이라는 형태**다 —
 * 진입 홀드(3초)가 끝나는 순간 손가락이 아직 화면에 있어, 그 `pointerup`이 새로 마운트된 중앙
 * 히트존으로 떨어져 **끄기를 끝내는 동작이 곧 켜기 탭**이 됐다(로그: off→on 300~700ms ×10회).
 * 두 제스처가 같은 이벤트를 공유하므로 위치 조건으로는 못 가른다. 홀드는 `pointerdown`을
 * 요구하므로 다운 없는 잔여 업이 구조적으로 무시된다.
 * ⚠️ **축 3(키보드 Enter)은 여전히 「즉시」다.** 포인터가 홀드가 됐다고 여기에 홀드를 붙이면
 * 이 파일의 존재 이유가 깨진다 — 그 계약은 *"길게 누르기가 불가능한 입력 수단의 탈출 경로"*다.
 *
 * 이 파일의 존재 이유(**갇힘 방지**)는 그대로다. 탈출 제스처가 무엇이든 «나갈 수 있는가»는
 * 계속 여기서 잰다.
 */


function makeSettings() {
  const columns = [
    { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
    { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 3 }, sampleKey: true },
    { id: 'v0', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, sampleKey: false },
  ];
  return {
    settings: {
      state: {
        googleConnected: true, userEmail: 'tester@example.com',
        sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_CR_BLACKOUT/edit',
        sheetTab: 'Sheet1', columnsSheetId: 'SHEET_CR_BLACKOUT', columnsSheetTab: 'Sheet1',
        columns, tableGenerated: true, totalRows: 3, ttsRate: 1.05,
        recognitionTolerance: 0.6, sessionLabelColId: null, sessionAutoLabel: 'cr-blackout',
        preferredVoiceName: '', roundDateColId: null,
      },
      version: 13,
    },
    headers: ['조사일자', '조사나무', '횡경'],
    sheetRows: [],
  };
}

const overlay = (page: Page) => page.locator('[data-testid="blackout-overlay"]');

async function enterBlackout(page: Page) {
  await fireStt(page, '화면', 600);
  await overlay(page).waitFor({ state: 'visible', timeout: 4000 });
}

/** 🔴 v0.47.0 W7 — 해제는 **중앙 히트존**이다. 오버레이 루트가 아니라 그 안의
 *  `blackout-center-hit`을 눌러야 한다(가장자리는 핸들러 자체가 없다 — 그쪽 컴포넌트 주석).
 *
 *  🔴 **r2 P6 — 「탭」이 「2초 홀드」가 됐다** (민구 08-09 · 위 §정당 파손 2차 참조).
 *  `.click()`은 down→up이 즉시라 더 이상 해제되지 않는다. 이 파일이 지는 계약은 «나갈 수
 *  있는가»이지 «어떤 제스처인가»가 아니므로, 헬퍼 하나만 바꾸면 축 1·2·4가 그대로 산다. */
const WAKE_HOLD_MS = 2000;

async function holdCenter(page: Page) {
  const box = await page.locator('[data-testid="blackout-center-hit"]').boundingBox();
  if (!box) throw new Error('blackout-center-hit 박스를 얻지 못했다 — 오버레이 미도달(무판정)');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(WAKE_HOLD_MS + 300);
  await page.mouse.up();
}

test.describe('WP-F 검은 화면 — 갇히지 않는다', () => {
  test('음성 「화면」으로 진입하고, 중앙을 2초 눌러 나온다', async ({ page }) => {
    const { settings, headers, sheetRows } = makeSettings();
    await boot(page, { width: 402, height: 874 }, { settings, headers, sheetRows });
    await waitForTtsIdle(page);

    await enterBlackout(page);
    await expect(overlay(page)).toBeVisible();

    await holdCenter(page);
    await expect(
      overlay(page),
      `중앙을 2초 눌러도 안 나온다 — 포인터 탈출 경로가 죽으면 사용자가 앱에 갇힌다`,
    ).toBeHidden({ timeout: 3000 });
  });

  test('🆕 키보드(Enter)로도 나온다 — role=button·tabIndex 계약', async ({ page }) => {
    // L3-5: `role="button"`+`tabIndex={0}`을 선언했는데 키 핸들러가 없었다.
    // 포인터를 못 쓰는 경로에서 탈출구가 0개가 된다.
    const { settings, headers, sheetRows } = makeSettings();
    await boot(page, { width: 402, height: 874 }, { settings, headers, sheetRows });
    await waitForTtsIdle(page);

    await enterBlackout(page);
    await overlay(page).focus();
    // 🔴 r2 P6 — 포인터가 「2초 홀드」가 됐어도 키보드는 **누르는 즉시**다. 이 비대칭이 의도다:
    //   이 계약의 존재 이유가 «길게 누르기가 불가능한 입력 수단의 탈출 경로»이기 때문이다.
    await page.keyboard.press('Enter');
    await expect(
      overlay(page),
      'Enter로 안 나온다 — role=button을 선언했으면 키 경로도 계약이다',
    ).toBeHidden({ timeout: 3000 });
  });

  test('해제 후 음성 입력이 계속된다 — 「음성 입력은 계속됩니다」가 참인가', async ({ page }) => {
    const { settings, headers, sheetRows } = makeSettings();
    await boot(page, { width: 402, height: 874 }, { settings, headers, sheetRows });
    await waitForTtsIdle(page);

    await enterBlackout(page);
    await holdCenter(page);
    await expect(overlay(page)).toBeHidden({ timeout: 3000 });

    // 🔑 **음성 경로 생존은 「명령이 다시 먹는가」로 잰다.** 처음에는 값(`'123.4'`)을 말해
    //    `[data-hero-state]` 본문에 반영되는지 봤는데, 그 본문은 **세션 진행 상태에 의존**해서
    //    (값 입력 대기 / 확인 대기 / 커밋 직후) 빈 문자열이 정상인 구간이 있다 —
    //    실제로 그렇게 짜서 red가 났고, **제품이 아니라 오라클이 틀렸다.**
    //    `'화면'` 재진입은 STT → 명령 판별 → 상태 변경 전 경로를 한 번에 통과시키는 증거이고
    //    상태 의존이 없다.
    //    ⚠️ 「값 입력이 계속 되는가」는 이 파일 범위 밖이다 — 세션 흐름 스펙이 그 몫이다.
    await enterBlackout(page);
    await expect(
      overlay(page),
      '해제 후 음성 명령이 안 먹는다 — 「음성 입력은 계속됩니다」 고지가 거짓이 된다',
    ).toBeVisible();
  });
});
