/**
 * v0.47.0 W7 오라클 — **히어로 홀드 진입 · 중앙 2초 홀드 해제.** (민구 지시 08-08 → 08-09 반전)
 * 🔴 **v0.51 H2 — 진입 홀드가 3초 → 2초가 됐다**(민구 재확정 08-31). 아래 `HOLD_MS` 주석이 SSOT.
 *
 * > 08-08: *"화면 중앙 히어로 영역을 사용자가 터치하면 안내음성/문구+진행바와 함께 3초 유지하면
 * >  화면 끔. 화면 꺼진 상태에서 중앙 영역 잠깐이라도 터치하면 화면 켬으로 하자."*
 *
 * 🔴 **v0.47.0 r2 P6 — 해제가 「잠깐 탭」에서 「2초 홀드」로 바뀌었다** (민구 08-09 실기기 점검 FB-G).
 *
 * > 08-09: *"화면을 끄기 위해 중앙 터치시 안내음과 함께 중앙 터치시 게이지는 올라가지만,
 * >  정상적으로 화면이 꺼지진 않음. 손을 때는 순간 바로 검은 화면에서 복귀 됨. 터치를 끝내는
 * >  순간을 재 터치로 하는게 아닐가 의심중. - 화면을 킬 때도 2초간 터치로 변경"*
 *
 *  민구의 의심이 맞았다. 로그 실측: `screen_off src:hold` → 300~700ms → `screen_on src:tap`이
 *  **10회 반복.** 진입 홀드가 완료되는 순간 손가락은 아직 화면에 있고, 그때 마운트된 오버레이의
 *  중앙 히트존이 `pointerup` 하나로 해제됐다 — **끄기를 끝내는 동작이 곧 켜기 탭**이었다.
 *  🔑 위치 조건(중앙만)으로는 못 가른다. 두 제스처가 **같은 이벤트를 공유**하기 때문이다.
 *  홀드는 `pointerdown`을 요구하므로 다운 없는 잔여 업이 구조적으로 무시된다.
 *  👉 이 파일에서 「짧은 탭으로 풀린다」를 단언하던 지점(③ ④ ⑧)이 **정당하게 파손**됐고,
 *     전부 「2초 홀드로 풀린다 · 짧은 탭으로는 안 풀린다」로 갱신됐다.
 *
 * `v0460-cr-blackout-escape.spec.ts`는 **갇힘 방지**(탈출 경로가 살아 있는가)를 계속 진다.
 * 이 파일은 **새로 생긴 두 계약**을 진다: 진입 제스처와, 해제의 위치 조건.
 *
 * ## 재는 축
 *  ① 히어로 홀드(`HOLD_MS`) → 진입한다. 홀드 중 **문구+진행바**가 뜬다(민구가 명시한 피드백).
 *  ② 🔴 **`HOLD_MS` 미만에 떼면 진입하지 않는다.** 오터치 방어가 이 기능의 전제다 — 현장에서
 *     화면이 제멋대로 꺼지면 값이 날아간 것처럼 보인다.
 *  ③ 🔴 **가장자리는 해제하지 않는다.** 08-05에 「두 번 탭」을 기각시킨 근거(*"주머니에서도
 *     두 번 눌린다 — 옷 스침은 연속 접촉"*)가 08-08 확정에서는 **위치 조건**으로 이전됐다.
 *     이 단언이 그 이전의 실체다. 여기가 죽으면 절전 기능이 주머니에서 스스로 켜진다.
 *     (r2 P6에서 **홀드 조건이 하나 더 얹혔다** — 위치와 시간 둘 다 걸린다.)
 *  ④ 계측이 진입 경로를 가른다(`src:hold` vs 기존 `src:voice`). 두 경로의 사용 비율은
 *     다음 회차의 UI 판단 근거다 — 안 남기면 또 추론이 된다.
 *  ⑨ 🔴 **r2 P6 신규 — 짧은 탭으로는 해제되지 않는다.** 이 회차 버그의 직접 반증 조건이다.
 *     여기가 green이면 「떼는 순간 복귀」가 재발하지 않는다.
 *  ⑧ 🔴 **해제가 하부 UI로 전파되지 않는다**(V-FIX5 · 리뷰 U8이 지목한 오라클 공백).
 *     터치 한 번은 `pointerdown → pointerup → mousedown → mouseup → click`을 낸다. 오버레이를
 *     걷으면 뒤따르는 `click`은 **그 자리에 있던 다른 요소로** 간다. 검은 화면 중앙
 *     아래에는 히어로가, 그 아래 트랙에는 종료·일시정지가 산다 — 화면을 켜려던 제스처가 세션을
 *     건드리면 사고다. 해제 계측(`screen_on`/`src:hold`)도 여기서 함께 잰다.
 *     🔑 r2 P6에서 **삼킴의 기준점이 바뀌었다**: 해제가 «손가락이 아직 닿아 있는 2초 시점»에
 *     일어나므로 고정 400ms 창은 사용자가 더 붙잡고 있으면 만료된다. 이제 `pointerup`을
 *     기다렸다가 그 시점부터 400ms를 다시 센다 — ⑧이 그 새 기준점 위에서 같은 계약을 잰다.
 *
 * ## 🔴 안 재는 축
 *  - **갇힘 방지 전반**(키보드 탈출·해제 후 음성 생존) → `v0460-cr-blackout-escape.spec.ts`.
 *  - **iOS `pointercancel`** — Playwright/Chromium은 iOS의 스크롤 전환을 재현하지 않는다.
 *    방어(`touchAction:'none'`)는 코드에 있으나 **기계로 확인되지 않았다**(「미확인」).
 *  - **홀드 중 안내 TTS가 STT에 에코로 들어가는가** — `speech.ts`의 half-duplex 래치가 지는
 *    계약이고 이 파일은 그걸 다시 재지 않는다(그쪽 스코프).
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402 } from './fixtures/activeZones';
import { fireStt, waitForTtsIdle } from './fixtures/stt';

test.setTimeout(120_000);

/** 제품 상수 `HOLD_TO_BLACKOUT_MS`와 같아야 한다. 🔴 **import하지 않는 건 의도다**
 *  (`v0460-g-dot-pill`과 같은 계약): 제품이 값을 바꾸면 계약은 여기 남아 오라클이 신호를 낸다.
 *
 *  🔴 **v0.51 H2 — 3000 → 2000**(민구 재확정 08-31). 이 리터럴은 제품과 **함께** 바뀐 것이지
 *  red를 지우려고 따라간 것이 아니다: 근거는 `HeroHoldToBlackout`의 상수 주석이 SSOT다
 *  (접촉 끊김 노출 창을 1/3 줄인다).
 *  🔴 **아래 `WAKE_HOLD_MS`와 값이 같아졌지만 합치지 마라** — 근거가 다른 두 계약이다.
 *  🟢 이 변경으로 red가 되는 기존 케이스는 **0건**임을 확인했다(전수): `holdHero` 호출 4개 중
 *     둘은 `HOLD_MS` 파생이라 자동 축소되고(:182 `*0.4` · :349 `+400`), 나머지 둘은
 *     200ms·1300ms 고정이라 2000 미만을 유지한다. **2000~3000 사이를 눌러 놓고 「진입 안 함」을
 *     단언하는 케이스가 없다**는 것이 이 전수의 결론이다. */
const HOLD_MS = 2000;

/** 🔴 r2 P6 — 해제 홀드. 제품 상수 `HOLD_TO_WAKE_MS`와 같아야 한다(위 `HOLD_MS`와 같은 이유로
 *  일부러 import하지 않는다 — 제품이 값을 바꾸면 계약이 여기 남아 오라클이 신호를 낸다). */
const WAKE_HOLD_MS = 2000;

const overlay = (page: Page) => page.locator('[data-testid="blackout-overlay"]');
const heroSurface = (page: Page) => page.locator('[data-testid="hero-hold-surface"]');
const centerHit = (page: Page) => page.locator('[data-testid="blackout-center-hit"]');

/** 🔴 r2 P6 — 검은 화면 중앙을 `ms` 동안 누른다. **`.click()`을 쓰면 안 된다** —
 *  down→up이 즉시라 2초 홀드를 만족하지 못하고, 그게 정확히 이 회차가 만든 새 계약이다.
 *  @param releaseAfter false면 손가락을 **떼지 않는다**(해제가 «닿아 있는 동안» 일어나는지를
 *         재는 축 · ⑧의 고스트 삼킴 기준점 검증에 필요하다). 호출부가 나중에 `mouse.up()`한다. */
async function holdCenter(page: Page, ms: number, releaseAfter = true) {
  const box = await centerHit(page).boundingBox();
  if (!box) throw new Error('blackout-center-hit 박스를 얻지 못했다 — 오버레이 미도달(무판정)');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  if (releaseAfter) await page.mouse.up();
}

/** 히어로 표면 중앙을 `ms` 동안 누른다. */
async function holdHero(page: Page, ms: number) {
  const box = await heroSurface(page).boundingBox();
  if (!box) throw new Error('hero-hold-surface 박스를 얻지 못했다 — hero 분기 미도달(무판정)');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

/** 🔴 V-FIX1 오라클용 — **엔진에 실제로 들어간 발화 문자열을 기록한다.**
 *
 *  왜 로그가 아니라 엔진인가: 우리가 재려는 것은 *"이 문장이 스피커로 나갔는가"* 이고, 그게
 *  곧 *"STT가 자기 안내를 받아 적을 수 있는가"* 다. 앱 로그는 그 사실을 안 남긴다.
 *  공용 mock의 `speak`를 감싸 `__utterances`에 쌓는다(mock 자체는 건드리지 않는다 —
 *  `tests/fixtures/stt.ts`는 다른 레인도 쓰는 공용물이다). */
const RECORD_UTTERANCES = `(() => {
  const w = window;
  if (w.__utterances) return;
  w.__utterances = [];
  const synth = w.speechSynthesis;
  const orig = synth.speak.bind(synth);
  synth.speak = function (u) { w.__utterances.push(String(u && u.text || '')); return orig(u); };
})()`;

async function utterances(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __utterances?: string[] }).__utterances ?? []);
}

/** 홀드 안내 문구(제품 `HOLD_LINES`의 결합형과 같아야 한다 — 상수를 import하지 않는 건 의도다). */
const HOLD_TTS = '계속 누르면 화면을 끕니다. 음성 입력은 계속됩니다.';
/** 제품 `HOLD_TTS_DELAY_MS`와 같아야 한다. */
const HOLD_TTS_DELAY_MS = 400;

interface LoggedEvent { type: string; parsed?: string; extra?: string }

async function screenLogs(page: Page, parsed: 'screen_off' | 'screen_on'): Promise<LoggedEvent[]> {
  const all = await page.evaluate(async () => {
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
  return all.filter((e) => e.parsed === parsed);
}

test('① 히어로 홀드(HOLD_MS)로 진입한다 + 홀드 중 문구·진행바가 뜬다', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForTtsIdle(page);
  await expect(overlay(page), '전제: 시작은 검은 화면이 아니다').toHaveCount(0);

  const box = await heroSurface(page).boundingBox();
  if (!box) throw new Error('hero-hold-surface 미존재 — 무판정');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();

  // 민구가 명시한 피드백 — *"안내음성/문구+진행바와 함께"*. 진행바가 없으면 사용자는
  //   시간이 얼마나 남았는지 모른 채 손가락을 떼고 "안 된다"고 판단한다.
  await expect(page.locator('[data-testid="hero-hold-cue"]'), '홀드 중 안내 문구').toBeVisible({ timeout: 1500 });
  // 🔴 V-FIX2(리뷰 U10) — **화면 문구와 TTS가 글자까지 같다.** 상수는 배열 SSOT 하나로 묶여
  //    있지만 «렌더»는 별개다 — 두 줄 중 하나를 떨어뜨리는 리팩토링은 상수만 봐서는 안 잡힌다.
  //    (*"계약이 지켜지는지 확인하는 테스트가 없다면 그 계약은 주석일 뿐이다"* — v043-typo-contract)
  const shownHint = (await page.locator('[data-testid="hero-hold-hint"]').innerText())
    .replace(/\s+/g, ' ').trim();
  expect(shownHint, 'V-FIX2 — 화면 문구가 TTS와 글자까지 같아야 한다').toBe(HOLD_TTS);
  // 🔴 «진행바가 보인다»는 **트랙**으로 잰다 — 채움(fill)은 0%일 때 폭 0이라 Playwright가
  //    hidden으로 읽는다. V-FIX3b 이후 0%는 정상 상태이므로 fill 가시성은 계약이 아니다.
  await expect(page.locator('[data-testid="hero-hold-track"]'), '진행바 트랙').toBeVisible();
  const fill = page.locator('[data-testid="hero-hold-fill"]');
  // ⚠️ V-FIX3b 이후 표시는 «눌렸는가»로 뜨므로 **첫 프레임의 진행값은 0이 정상**이다.
  //    「차오른다」는 값 하나가 아니라 **증가**로 재야 한다(단발 읽기는 flaky를 만든다).
  await expect
    .poll(async () => Number(await fill.getAttribute('data-progress')), { timeout: 2000 })
    .toBeGreaterThan(0);
  const mid = Number(await fill.getAttribute('data-progress'));
  expect(mid, '아직 홀드 시간이 안 찼으므로 1 미만').toBeLessThan(1);

  await page.waitForTimeout(HOLD_MS);
  await page.mouse.up();
  await expect(
    overlay(page),
    '홀드를 유지했는데 화면이 안 꺼진다 — 진입 경로가 음성 하나로 돌아간 것이다',
  ).toBeVisible({ timeout: 3000 });
});

test('② 🔴 HOLD_MS 미만에서 떼면 진입하지 않는다 (오터치 방어가 전제다)', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForTtsIdle(page);

  await holdHero(page, Math.floor(HOLD_MS * 0.4));
  await page.waitForTimeout(HOLD_MS); // 남은 시간이 흘러도 진입하면 안 된다(타이머 잔존 확인)
  await expect(
    overlay(page),
    '중도 이탈로 화면이 꺼진다 — 현장에서 값이 날아간 것처럼 보인다',
  ).toHaveCount(0);
  // 취소는 무동작이지 「나중에 발화」가 아니다 — 계측에도 안 남아야 한다.
  expect(await screenLogs(page, 'screen_off'), '취소된 홀드가 screen_off를 남기면 안 된다').toHaveLength(0);
});

test('③ 🔴 검은 화면 — 중앙 2초 홀드는 켜고, 가장자리는 무시한다', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForTtsIdle(page);
  await fireStt(page, '화면', 600);
  await expect(overlay(page)).toBeVisible({ timeout: 4000 });

  // 가장자리 — 히트존(가로 60%×세로 50% 중앙)의 밖. 402×874에서 좌우 여백 각 80px.
  await page.mouse.click(12, 12);
  await page.waitForTimeout(300);
  await expect(
    overlay(page),
    '가장자리 탭으로 풀린다 — 주머니·팔 스침으로 화면이 켜져 절전이 무의미해진다',
  ).toBeVisible();

  await page.mouse.click(24, 500); // 세로 중앙이지만 가로는 가장자리 — 두 축이 함께 걸린다
  await page.waitForTimeout(300);
  await expect(overlay(page), '가로 가장자리도 무시한다').toBeVisible();

  // 🔴 r2 P6 — 중앙을 **2초 홀드**하면 풀린다(민구 08-09: *"화면을 킬 때도 2초간 터치로 변경"*).
  await holdCenter(page, WAKE_HOLD_MS + 300);
  await expect(
    overlay(page),
    '중앙을 2초 눌렀는데 안 켜진다 — 탈출 경로가 이것뿐이라 사용자가 앱에 갇힌다',
  ).toBeHidden({ timeout: 3000 });
});

/** 🔴 **r2 P6 신규 — 이 회차 버그(FB-G)의 직접 반증 조건.**
 *
 *  로그 실측: `screen_off src:hold` 직후 300~700ms 만에 `screen_on src:tap` **10회**.
 *  진입 홀드가 끝나는 순간 손가락이 아직 화면에 있고, 그 `pointerup`이 새로 마운트된 중앙
 *  히트존으로 떨어져 **끄기를 끝내는 동작이 그대로 켜기 탭**이 됐다.
 *  👉 여기서는 그 잔여 업을 **재현**한다: 히어로를 홀드해 진입하되 `holdHero`가 이미 손을 떼므로
 *  (Playwright는 실기기와 달리 down/up 타깃이 분리된다) 같은 형태의 «짧은 탭»을 오버레이에
 *  직접 쏘아 **안 풀리는지**를 잰다. 이게 green이면 「떼는 순간 복귀」가 구조적으로 닫혔다. */
test('⑨ 🔴 짧은 탭으로는 해제되지 않는다 — 「떼는 순간 복귀」(FB-G)의 반증 조건', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForTtsIdle(page);
  await fireStt(page, '화면', 600);
  await expect(overlay(page)).toBeVisible({ timeout: 4000 });

  // ① 즉시 탭(= 잔여 pointerup과 같은 형태)
  await centerHit(page).click();
  await page.waitForTimeout(400);
  await expect(
    overlay(page),
    '짧은 탭으로 풀렸다 — 끄기 제스처의 잔여 pointerup이 그대로 켜기가 되는 그 버그다',
  ).toBeVisible();

  // ② 홀드 시간에 못 미치는 누름도 안 풀린다(경계 확인 — 위 ①만으로는 «0ms만 막았다»가 남는다)
  //    🔑 그 홀드 **도중에** 진행 표시가 뜨는지도 여기서 잰다. 히어로 쪽 등가 계약(①)과 대칭이다 —
  //    코드 주석이 *"피드백이 사라지면 「왜 안 켜지지」가 된다"* 라고 적었는데 오라클이 없으면
  //    그건 주석일 뿐이다(`v043-typo-contract` 표어).
  await holdCenter(page, 900, false); // 손을 뗀 상태로 두지 않는다 — 홀드 중을 관측한다
  await expect(
    page.locator('[data-testid="blackout-hold-track"]'),
    '홀드 중 진행 트랙이 보이지 않는다 — 사용자가 2초를 눌러야 하는지 알 방법이 없다',
  ).toBeVisible();
  // 계단은 500ms 간격이므로 900ms 시점엔 최소 한 칸 차 있어야 한다.
  await expect
    .poll(async () => Number(await page.locator('[data-testid="blackout-hold-fill"]').getAttribute('data-progress')), { timeout: 1500 })
    .toBeGreaterThan(0);
  await page.mouse.up(); // 2초 전에 뗀다 → 해제되면 안 된다
  await page.waitForTimeout(300);
  await expect(overlay(page), '2초 미만 홀드로 풀렸다 — 홀드 시간 판정이 헐겁다').toBeVisible();
  await expect(
    page.locator('[data-testid="blackout-hold-track"]'),
    '떼었는데 진행 표시가 남아 있다 — 다음 홀드가 이어서 차오르는 것처럼 보인다',
  ).toHaveCount(0);

  // ③ 충분히 누르면 풀린다(①②가 «영영 안 풀린다»로 통과하는 공허한 green이 아님을 증명)
  await holdCenter(page, WAKE_HOLD_MS + 300);
  await expect(overlay(page), '2초 홀드로도 안 풀린다 — 사용자가 앱에 갇힌다').toBeHidden({ timeout: 3000 });
});

/** 🔴 V-FIX1ⓐ+ⓑ (이중 콜드 리뷰 blocker) — 스침 오터치는 **발화 자체를 만들지 않는다.**
 *  종전에는 `pointerdown` 즉시 전문을 발화했고 조기 해제로도 취소되지 않아, barge-in OFF에서
 *  ~4초 인식 공백이 났다. */
test('⑤ 🔴 400ms 전에 떼면 홀드 안내가 **발화되지 않는다** (V-FIX1ⓐⓑ)', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForTtsIdle(page);
  await page.evaluate(RECORD_UTTERANCES);

  await holdHero(page, Math.floor(HOLD_TTS_DELAY_MS * 0.5)); // 200ms — 지연 임계 전
  await page.waitForTimeout(1200); // 예약이 살아 있었다면 이 창에서 터진다
  expect(
    (await utterances(page)).filter((t) => t === HOLD_TTS),
    '스침 오터치가 안내를 발화한다 — barge-in OFF에서 그만큼 인식이 죽는다',
  ).toHaveLength(0);
  await expect(overlay(page), '전제: 진입도 하지 않았다').toHaveCount(0);
});

/** 🔴 V-FIX1ⓒ — **다른 TTS가 재생·큐잉 중이면 홀드 안내를 큐에 세우지 않는다.**
 *  `speech.ts`의 뮤트가 depth가 아니라 boolean이라(`:196`·`:620`·`:658`) 앞 발화가 끝나는 순간
 *  뮤트가 풀리고, 뒤이어 재생되는 이 문장을 STT가 받아 적을 수 있다. `text` 컬럼이면 파서가
 *  원문을 유효값으로 받아 **앱 안내가 시트 값으로 커밋된다** — 데이터 무결성 사고다. */
test('⑥ 🔴 TTS 재생·큐잉 중에는 홀드 안내를 큐잉하지 않는다 (V-FIX1ⓒ)', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForTtsIdle(page);
  await page.evaluate(RECORD_UTTERANCES);
  // 공용 mock은 `speaking`/`pending`을 항상 false로 두므로(고정 필드) 재생 중 상태를 여기서 세운다.
  //   🔴 mock 파일을 고치지 않는다 — 그 플래그는 `handleFinal`의 STT 무시 경로도 읽으므로
  //   전역으로 바꾸면 다른 레인의 스펙 판정이 조용히 달라진다.
  await page.evaluate(() => { (window.speechSynthesis as unknown as { speaking: boolean }).speaking = true; });

  await holdHero(page, HOLD_TTS_DELAY_MS + 900); // 지연 임계를 넘겨 발화 시점을 확실히 지난다
  expect(
    (await utterances(page)).filter((t) => t === HOLD_TTS),
    'TTS 재생 중인데 홀드 안내가 큐에 섰다 — 앞 발화 종료가 뮤트를 먼저 풀어 STT 자기입력이 열린다',
  ).toHaveLength(0);
});

/** V-FIX3(리뷰 U11) — `prefers-reduced-motion: reduce`에서 진행 표현이 **저빈도 계단**이 되고,
 *  **홀드 시간 판정은 그대로**다. 「reduce면 아무것도 안 그린다」로 가지 않은 이유는 위치 기반
 *  진입에서 피드백이 사라지면 *"왜 안 꺼지지"* 가 되기 때문이다. */
test('⑦ reduced-motion — 진행 표현은 0.25 계단, 홀드 시간 판정은 불변 (V-FIX3)', async ({ page }) => {
  await boot(page, PHONE_402);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await waitForTtsIdle(page);

  const box = await heroSurface(page).boundingBox();
  if (!box) throw new Error('hero-hold-surface 미존재 — 무판정');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();

  // 🔴 V-FIX3b(2차 재검증) — **즉시** 떠야 한다. reduce의 첫 계단은 `HOLD_MS/4` 뒤이고 안내 TTS는
  //    400ms 뒤라, 표시가 진행값에 묶여 있으면 «소리는 나는데 화면은 그대로»인 구간이 생긴다.
  //    300ms 안에 못 뜨면 그 회귀다(400·첫 계단 둘 다보다 앞이라 두 축을 한 번에 가른다).
  //    🔴 v0.51 H2 — 첫 계단이 750 → **500ms**가 됐다. 300ms 문턱은 그대로 유효하다(여전히 앞선다).
  const fill = page.locator('[data-testid="hero-hold-fill"]');
  await expect(
    page.locator('[data-testid="hero-hold-cue"]'),
    'reduce에서 시각 피드백이 늦다 — 안내 TTS가 화면보다 먼저 온다',
  ).toBeVisible({ timeout: 300 });
  await expect(
    page.locator('[data-testid="hero-hold-track"]'),
    'reduce에서도 진행 피드백 자체는 남는다(트랙으로 잰다 — 0% 채움은 폭 0이라 hidden이다)',
  ).toBeVisible({ timeout: 300 });
  // 여러 번 읽어도 0.25 배수만 나온다 = 연속 애니메이션이 아니다.
  const seen = new Set<string>();
  for (let i = 0; i < 6; i++) {
    seen.add(String(await fill.getAttribute('data-progress')));
    await page.waitForTimeout(120);
  }
  const offGrid = [...seen].filter((v) => Math.abs(Number(v) * 4 - Math.round(Number(v) * 4)) > 1e-6);
  expect(offGrid, `reduce인데 0.25 격자 밖 값이 나왔다(연속 애니메이션) — ${[...seen].join(',')}`).toEqual([]);

  await page.waitForTimeout(HOLD_MS);
  await page.mouse.up();
  await expect(
    overlay(page),
    'reduce에서 홀드 시간 판정이 늦어졌다 — 시각 표현만 바꾸는 계약이 깨졌다',
  ).toBeVisible({ timeout: 2000 });
});

test('④ 계측 — 홀드 진입은 src:hold, 음성 진입은 src:voice로 갈린다', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForTtsIdle(page);

  await holdHero(page, HOLD_MS + 400);
  await expect(overlay(page)).toBeVisible({ timeout: 3000 });
  await holdCenter(page, WAKE_HOLD_MS + 300); // r2 P6 — 탭이 아니라 홀드로 푼다
  await expect(overlay(page)).toBeHidden({ timeout: 3000 });

  await waitForTtsIdle(page);
  await fireStt(page, '화면', 600);
  await expect(overlay(page)).toBeVisible({ timeout: 4000 });

  const logs = await screenLogs(page, 'screen_off');
  expect(logs.map((e) => e.extra), '두 진입이 같은 이벤트에 출처만 다르게 남는다')
    .toEqual(['src:hold', 'src:voice']);
  // 새 이벤트 타입을 만들지 않았다는 확인 — SOP-003 파서 계약(기존 command/screen_off 그대로).
  expect(logs.every((e) => e.type === 'command')).toBe(true);
});

/** 🔴 V-FIX5 (리뷰 U8 — 오라클 공백) — 해제가 **하부 UI로 새지 않는다** + 해제 계측.
 *
 *  ## ⚠️ v0.47.0 W7 시점의 한계와, r2 P6에서 그게 어떻게 사라졌나
 *  W7 초안은 «`.click()` 후 window 버블 청취자에 click이 안 잡힌다»로 썼는데 **반증 확인에서
 *  죽었다**: `swallowGhostClick()`를 지워도 green이었다. 탭 해제는 `pointerup`에서 일어나고
 *  Chromium은 그 시점에 React가 동기 flush로 오버레이를 걷어 **down/up 타깃이 분리 → click 자체가
 *  발생하지 않았다.** 막을 고스트가 없었으니 그 위의 단언은 **공허한 green**이었고, 그래서 W7은
 *  차단막의 «기제»를 `dispatchEvent`로 대신 쟀다.
 *
 *  🔑 **r2 P6에서도 이 환경엔 실제 고스트가 없다 — 실측으로 확인했다**(아래 `seen` 로그가 0을
 *  찍는다). 홀드 해제는 «손가락이 아직 닿아 있는 2초 시점»에 일어나 오버레이가 먼저 걷히고 뒤에
 *  `pointerup`이 오는데도, Chromium은 down 타깃이 사라진 그 up에서 `click`을 합성하지 않는다.
 *  👉 그래서 **차단막의 기제를 `dispatchEvent`로 재는 W7 방식을 유지한다.** 다만 기준점이
 *  바뀌었으므로 **재는 시점**이 달라졌다 — 아래 ①.
 *
 *  ## 재는 축
 *   ① 🔴 **손가락을 뗀 직후**의 첫 click은 먹힌다. 여기가 r2 P6의 새 계약이다.
 *      해제(2초) 후 900ms를 **더 붙잡고 있다가** 뗀다. 삼킴이 고정 400ms 창이면 떼기 전에
 *      이미 만료돼 이 click이 그대로 샌다 — 실제로 초안 구현이 여기서 red를 냈고,
 *      **스펙이 아니라 구현이 틀렸다**(초기 타이머가 재무장 경로를 먼저 죽였다).
 *      화면을 켜려던 홀드가 종료·일시정지 버튼을 때리는 축이 정확히 여기다.
 *   ② 두 번째 click은 **통과한다** — 차단막이 «정확히 한 번»만 먹고 물러난다.
 *      ②가 없으면 사각지대가 무한이 되는 반대쪽 회귀를 못 잡는다. 장갑 낀 현장에서
 *      «화면 켜고 바로 누른 버튼이 안 먹는다»가 되는 축이다.
 *   🔬 `seen`(캡처 단계 관측)을 함께 찍는다 — 언젠가 이 환경에서 실제 고스트가 나기 시작하면
 *      로그가 먼저 알려준다. **단언하지는 않는다**(브라우저 구현 세부에 계약을 묶지 않는다).
 *  🔴 dispatch는 `document.body`에 쏜다 — `window`에 직접 쏘면 at-target 단계라 캡처/버블이
 *     **등록 순서**로 섞여 판정이 무의미해진다. */
test('⑧ 🔴 해제 차단막 — 뗀 직후 첫 click은 먹고 두 번째는 통과 + screen_on(src:hold) (V-FIX5 · r2 P6)', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForTtsIdle(page);
  await fireStt(page, '화면', 600);
  await expect(overlay(page)).toBeVisible({ timeout: 4000 });

  await page.evaluate(() => {
    const w = window as unknown as { __seenClicks: number; __leakedClicks: number };
    w.__seenClicks = 0;
    w.__leakedClicks = 0;
    // 캡처 단계 — 차단막(해제 시점에 등록)보다 **먼저** 달리므로 stopPropagation 이전에
    //   «click이 실제로 발생했는가»를 센다. 이게 있어야 ①이 공허한 green인지 아닌지 보인다.
    window.addEventListener('click', () => { w.__seenClicks += 1; }, true);
    window.addEventListener('click', () => { w.__leakedClicks += 1; }, false); // 버블 = 하부 도달
  });

  // 🔴 r2 P6 — **손가락을 붙잡은 채** 해제가 일어나는 상황을 그대로 재현한다.
  //    해제(2초)가 먼저 나고, 그 뒤에도 900ms를 더 누르고 있다가 뗀다.
  await holdCenter(page, WAKE_HOLD_MS + 900, false);
  await expect(overlay(page), '2초 시점에 해제된다 — 떼기를 기다리지 않는다').toBeHidden({ timeout: 3000 });
  await page.mouse.up();
  await page.waitForTimeout(80); // 브라우저가 mouseup→click을 합성할 여유

  const [seen, firstLeaked, secondLeaked] = await page.evaluate(() => {
    const w = window as unknown as { __seenClicks: number; __leakedClicks: number };
    const fire = () => document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const seenReal = w.__seenClicks; // 실제 제스처가 만든 click 수(관측만 — 단언 안 함)
    const before = w.__leakedClicks;
    fire();
    const afterFirst = w.__leakedClicks;
    fire();
    return [seenReal, afterFirst - before, w.__leakedClicks - afterFirst];
  });
  console.log(`[⑧] 실제 제스처가 만든 click ${seen}건 (0이면 이 환경엔 진짜 고스트가 없다 — 기제로 잰다)`);
  expect(
    firstLeaked,
    '뗀 직후 첫 click이 하부로 샌다 — 검은 화면 아래 종료·일시정지 버튼을 때릴 수 있다. '
    + '삼킴이 pointerup 기준으로 재무장하지 않으면(고정 400ms면) 정확히 여기서 죽는다',
  ).toBe(0);
  expect(
    secondLeaked,
    '차단막이 두 번째 click까지 먹는다 — 사각지대가 넓어져 «버튼이 안 먹는다»가 된다',
  ).toBe(1);

  // 하부가 실제로 멀쩡한지 상태로도 확인한다(이벤트 수만 보면 «다른 경로로 눌렸다»를 놓친다).
  await expect(page.locator('[data-testid="voice-active-state"]'), '세션 화면 유지').toBeVisible();
  await expect(page.locator('[data-testid="exit-confirm-inline"]'), '종료 확인이 뜨지 않았다').toHaveCount(0);
  await expect(page.locator('[data-testid="paused-card"]'), '일시정지되지 않았다').toHaveCount(0);

  const on = await screenLogs(page, 'screen_on');
  // 🔴 r2 P6 — `src:tap` → `src:hold`. 제스처가 실제로 홀드이고 끄기(`screen_off src:hold`)와
  //    대칭이라 로그 고고학이 이 반전 지점에서 헷갈리지 않는다.
  expect(on.map((e) => e.extra), '해제도 진입과 대칭으로 계측된다 — 체류 시간 계산의 전제').toEqual(['src:hold']);
  expect(on.every((e) => e.type === 'command'), '새 이벤트 타입을 만들지 않았다').toBe(true);
});

/** 🔴 r3(콜드 리뷰 codex 5) — **종전 2초 안전 상한(복원 시)의 조기 disarm을 반증한다.**
 *
 *  ⑧의 추가 홀드는 900ms라 종전 안전 상한(2000ms — 무장 시점, 즉 손가락이 아직 눌린 해제
 *  2초 시점부터 셌다) **안**이었다. 그 상한이 `pointerup` 전에 만료되는 정상 장기 홀드(총 4초+)
 *  에서는 리스너가 떼기 전에 전부 정리돼 첫 click이 하부로 그대로 샜다 — 차단막이 막으려던
 *  바로 그 사고(종료·일시정지 오조작)가 «천천히 뗀 사용자»에게만 일어난다. 여기서는 추가
 *  홀드를 **종전 상한 너머**(2000 + 900ms — 리터럴 2000은 종전 `GHOST_SWALLOW_MAX_MS`,
 *  [TEAMOPS-38] 관례로 import하지 않는다)로 늘려 그 회귀를 잰다. r3 처방(상한을 포인터 소실
 *  스톱로스 30초로 의미 축소)을 되돌리면 여기가 red다 — 실측 확인.
 *
 *  ⚠️ **범위(r4 재리뷰 codex :153에서 정확화)** — 이 테스트가 반증하는 것은 «종전 2초 상한의
 *  복원»뿐이다. **현 30초 스톱로스는 넘지 않는다**: 30초+ 홀드 후 뗀 첫 탭이 통과하는 것은
 *  결함이 아니라 **승인된 제한 계약**이다(민구 2026-08-09 — 제품 §기준점 주석이 정본).
 *  30초 실대기 오라클은 비용>가치라 두지 않는다 — 이 제한을 좁히려는 편집자는 제품 주석과
 *  이 범위 문단을 함께 고쳐라. */
test('⑧-b 🔴 종전 2초 상한 복원 반증 — 총 4.9초 홀드에서도 뗀 직후 첫 click을 먹는다 (r3 · codex 5 / 범위 r4 정확화)', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForTtsIdle(page);
  await fireStt(page, '화면', 600);
  await expect(overlay(page)).toBeVisible({ timeout: 4000 });

  await page.evaluate(() => {
    const w = window as unknown as { __leakedClicks: number };
    w.__leakedClicks = 0;
    window.addEventListener('click', () => { w.__leakedClicks += 1; }, false); // 버블 = 하부 도달
  });

  // 해제(2초)가 지나고도 2.9초를 더 붙잡는다 — 종전 코드면 이 사이(무장 후 2000ms)에 안전
  //   타이머가 리스너를 걷어, 아래 첫 click이 그대로 샌다.
  await holdCenter(page, WAKE_HOLD_MS + 2900, false);
  await expect(overlay(page), '2초 시점에 해제된다 — 떼기를 기다리지 않는다').toBeHidden({ timeout: 3000 });
  await page.mouse.up();
  await page.waitForTimeout(80); // 브라우저가 mouseup→click을 합성할 여유

  const [firstLeaked, secondLeaked] = await page.evaluate(() => {
    const w = window as unknown as { __leakedClicks: number };
    const fire = () => document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const before = w.__leakedClicks;
    fire();
    const afterFirst = w.__leakedClicks;
    fire();
    return [afterFirst - before, w.__leakedClicks - afterFirst];
  });
  expect(
    firstLeaked,
    '장기 홀드 후 뗀 직후 첫 click이 하부로 샌다 — 안전 상한이 pointerup 전에 차단막을 걷었다'
    + '(codex 5). 천천히 떼는 사용자만 종료·일시정지 오조작 위험에 노출된다',
  ).toBe(0);
  expect(
    secondLeaked,
    '차단막이 두 번째 click까지 먹는다 — «켜자마자 누른 버튼이 안 먹는다» 반대쪽 회귀',
  ).toBe(1);

  // 하부 상태 확인 — 이벤트 수만 보면 «다른 경로로 눌렸다»를 놓친다(⑧과 같은 축).
  await expect(page.locator('[data-testid="voice-active-state"]'), '세션 화면 유지').toBeVisible();
  await expect(page.locator('[data-testid="exit-confirm-inline"]'), '종료 확인이 뜨지 않았다').toHaveCount(0);
  await expect(page.locator('[data-testid="paused-card"]'), '일시정지되지 않았다').toHaveCount(0);
});
