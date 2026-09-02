/**
 * v0.51.1 R4 오라클 (2026-09-02 실기기 · STT 레인 §6 R4) — 도움말 팝업의 발화 안내 한 줄.
 *
 * 09-02 정식 4세션의 첫 자리 치환 15건 중 1↔7·1↔8·3↔7이 11건이었고, 사용자가 「일곱 점 하나」·「7. 팔」처럼
 * **고유어로 바꿔 말한 뒤 한 번에 통과**한 사례가 있다(양승보 r18 · 강남호 r15). 고유어 수사는 파서가 이미
 * 받으므로(koreanNumTokens) 코드 변경 없이 **가르치는 문장 한 줄**만 넣는다 — 화면 도움말표에만.
 * TTS 시작 안내에는 넣지 않는다([TTS-WATCHDOG-1] 길이 원칙). 효과는 다음 회차 치환 쌍 건수로 잰다.
 *
 * 🔴 반증(2026-09-02 실측): `CommandHelpPopup`의 `cmd-help-tip` span을 지우면 red.
 * Mock: fixtures/activeZones(boot) · fixtures/stt.
 */
import { test, expect } from '@playwright/test';
import { boot, PHONE_402 } from './fixtures/activeZones';

test.setTimeout(60_000);

test('R4 — 「?」 도움말에 「7·8은 일곱·여덟으로 말하면 잘 들립니다」 한 줄이 있다', async ({ page }) => {
  await boot(page, PHONE_402);
  await page.locator('button[title="음성 명령어 도움말"]').first().click();
  const popup = page.locator('[data-testid="command-help-popup"]');
  await expect(popup).toBeVisible({ timeout: 3000 });
  const tip = popup.locator('[data-testid="cmd-help-tip"]');
  await expect(tip, '발화 안내 한 줄이 도움말에 없다').toHaveText('7·8은 일곱·여덟으로 말하면 잘 들립니다');
  // 종전 계약(v026 T4)은 그대로다 — 「도움말 중 입력 정지」 문구가 같은 헤더에 남는다.
  await expect(popup).toContainText('도움말 중 입력 정지');
});
