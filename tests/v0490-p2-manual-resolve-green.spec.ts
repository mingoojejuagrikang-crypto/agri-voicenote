/**
 * 🔴 v0.49 P-2(민구 제보 2026-08-12 · Larry (A) 승인 10:55) — **키패드로 알람을 해소해도 즉시 초록.**
 *
 * 민구 원문:
 *   *"알람 발생후 키패드 입력으로 알람 해지 조건에 해당되는 값을 넣었을때 화면의 붉은톤 전환이
 *   지나치게 늦다는거 였어. 그래서 사용자가 지금 정상적으로 진행되고 있는게 맞나? 라는 의문이
 *   생기는 문제였어."*
 *
 * 🔑 **실측이 범위를 좁혔다.** 08-12 세션의 알람 에피소드 12건 중 느린 것은 «음성으로 뜬 알람을
 * 키패드로 해소한» **2건뿐**이다 — 09:52:04.099 커밋 → 09:52:09.102 해제 = **5.003초**,
 * 09:55:09.610 → 09:55:13.441 = **3.831초**. 음성 해소 6건은 인식 순간 `status:'corrected'`라
 * 체감 0초였고, 수동 발동 알람(manualHold 재커밋)도 **0.318초**였다.
 * 원인은 지연값이 아니라 **전이 누락**이었다: `commitManualValue`의 무위반 경로에 음성 경로
 * (`useVoiceSession.ts:2700-2710`)와 대칭인 corrected 전환이 없어, 해제가 `announceField`의
 * `clearAnomalyAlert('announce_field')`까지 밀렸다(echo 1.414s + 행완료 1.095s + 행헤더 2.189s).
 *
 * 이 스펙이 지키는 계약:
 *  ① 🔴 키패드로 정상값을 커밋하면 **echo TTS보다 먼저** 톤이 green이 된다(= 안내 직렬에 안 묶인다).
 *  ② 알람 카드가 접히고 hero 확정 플래시가 **정정값**을 띄운다(FB-10 계보) —
 *     종전에 5초 동안 팝업이 **옛 이상치값**을 띄우던 시각·청각 불일치(PRINCIPLES §2)가 닫힌다.
 *  ③ 해제 계측이 `hadStatus=corrected`로 남는다(종전 `pending`) — 음성 경로와 같은 바이트.
 *  ④ **다른 셀 알람(정보성 팝업)은 불변**(승인 조건 ⓓ — row+colId 가드 축).
 *  ⑤ manualHold 재커밋 경로의 **로그 바이트 불변**(`manual_recommit` + `hadStatus=pending`).
 *     이 경로는 이미 0.318초라 손대지 않았다는 것을 반증 가능한 형태로 못박는다.
 *
 * ⚠️ 왕복 OFF는 activeZones SETTINGS 승계([TEAMOPS-81] — 칩을 클릭한다).
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt } from './fixtures/stt';

test.setTimeout(120_000);

/** `trendRule: 'increase'` = 직전보다 커지면 알람. 직전 회차 01=100.0 · 02=5.0.
 *  → 01은 `120.5`가 위반이고 `90.5`가 정상(= 알람 해지 조건에 해당하는 값).
 *  03은 규칙 없는 «행을 안 끝내는 꼬리»다(p5 스펙과 같은 이유 — 2개면 행이 완료돼 칩존이 다음
 *  행을 렌더한다). ④의 «다른 셀» 커밋 대상이기도 하다. */
const MINI_COLUMNS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'increase' },
  { id: 'm2', name: '측정항목02', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'increase' },
  { id: 'm3', name: '측정항목03', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];
const MINI_SETTINGS = {
  ...AZ_SETTINGS,
  state: { ...AZ_SETTINGS.state, columns: MINI_COLUMNS, totalRows: 2, sessionAutoLabel: 'p2-manual-resolve' },
};
const MINI_HEADERS = ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02', '측정항목03'];
const MINI_ROWS = [
  [PREV_ROUND, '이원창', '1', '100.0', '5.0', ''],
  [PREV_ROUND, '이원창', '2', '100.0', '5.0', ''],
];

const bootMini = (page: Page) => boot(page, PHONE_402, {
  settings: MINI_SETTINGS as unknown as typeof AZ_SETTINGS,
  headers: MINI_HEADERS,
  sheetRows: MINI_ROWS,
});

const chip = (page: Page, colName: string) =>
  page.locator(`[data-testid="column-chip"][data-col-name="${colName}"]`);

async function keypadCommit(page: Page, colName: string, keys: string[]) {
  await chip(page, colName).click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible({ timeout: 4000 });
  for (const k of keys) await page.locator(`[data-testid="manual-key-${k}"]`).click();
  await page.locator('[data-testid="manual-commit"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toHaveCount(0);
}

type Frame = { t: number; tone: string; central: string; hero: string; heroText: string; ttsN: number };

/** 커밋 직후 구간을 25ms로 샘플링한다. **벽시계 임계값을 쓰지 않는다** — 순서(green이 echo보다
 *  먼저인가)로 판정한다. 임계값은 테스트 환경의 TTS 목 속도에 종속돼 flake가 된다. */
async function startSampler(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __p2: Frame[]; __p2Timer?: number; __ttsLog: string[] };
    type Frame = { t: number; tone: string; central: string; hero: string; heroText: string; ttsN: number };
    w.__p2 = [];
    const t0 = performance.now();
    w.__p2Timer = window.setInterval(() => {
      const attr = (sel: string, name: string) =>
        (document.querySelector(sel) as HTMLElement | null)?.getAttribute(name) ?? '';
      const heroEl = document.querySelector('[data-hero-state]') as HTMLElement | null;
      w.__p2.push({
        t: Math.round(performance.now() - t0),
        tone: attr('[data-voice-tone]', 'data-voice-tone'),
        central: attr('[data-central-state]', 'data-central-state'),
        hero: attr('[data-hero-state]', 'data-hero-state'),
        heroText: (heroEl?.textContent ?? '').trim(),
        ttsN: (w.__ttsLog ?? []).length,
      });
    }, 25);
  });
}

async function stopSampler(page: Page): Promise<Frame[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __p2: Frame[]; __p2Timer?: number };
    type Frame = { t: number; tone: string; central: string; hero: string; heroText: string; ttsN: number };
    if (w.__p2Timer) window.clearInterval(w.__p2Timer);
    return w.__p2;
  });
}

async function trendEvents(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db || !db.objectStoreNames.contains('logEvents')) return [];
    const all = await new Promise<Array<{ type: string; extra?: string }>>((res) => {
      const req = db.transaction('logEvents', 'readonly').objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result as Array<{ type: string; extra?: string }>);
      req.onerror = () => res([]);
    });
    return all.filter((e) => e.type === 'trend').map((e) => e.extra ?? '');
  });
}

test('P-2① 🔴 음성 발동 알람을 키패드로 해소 → echo TTS보다 먼저 green + hero가 정정값', async ({ page }) => {
  await bootMini(page);

  // 알람을 **음성으로** 띄운다(민구 시나리오의 전반부 — 08-12 에피소드 6·10과 같은 형태).
  await fireStt(page, '120.5', 900);
  await expect(page.locator('[data-testid="anomaly-alert"][data-status="pending"]')).toBeVisible({ timeout: 6000 });
  expect(
    await page.locator('[data-voice-tone]').first().getAttribute('data-voice-tone'),
    '알람 중 톤은 red',
  ).toBe('red');

  // 샘플러를 켠 뒤 **키패드로** 알람 해지 조건 값(90.5 < 직전 100.0)을 커밋한다.
  const ttsBefore = (await page.evaluate(() => (window as unknown as { __ttsLog: string[] }).__ttsLog)).length;
  await startSampler(page);
  await keypadCommit(page, '측정항목01', ['9', '0', '.', '5']);
  await page.waitForTimeout(2500); // echo → 행완료 → 다음 안내까지 흐르게 둔다
  const frames = await stopSampler(page);

  expect(frames.length, '샘플러가 실제로 돌았다(무판정 방지)').toBeGreaterThanOrEqual(20);

  const firstGreen = frames.findIndex((f) => f.tone === 'green');
  const firstEcho = frames.findIndex((f) => f.ttsN > ttsBefore);
  expect(firstGreen, '커밋 후 톤이 green이 된 프레임이 있다').toBeGreaterThanOrEqual(0);
  expect(firstEcho, 'echo TTS가 실제로 나갔다').toBeGreaterThanOrEqual(0);

  // 🔴 ① 핵심 단언 — **초록이 발화보다 먼저다.** 수정 전에는 green이 announce까지 밀려
  //    이 순서가 뒤집혔다(08-12 실측 5.003s / 3.831s).
  expect(
    firstGreen,
    `green(idx ${firstGreen}, ${frames[firstGreen]?.t}ms)이 echo TTS(idx ${firstEcho}, ${frames[firstEcho]?.t}ms)보다 늦지 않다`,
  ).toBeLessThanOrEqual(firstEcho);

  // 🔴 ② 알람 카드가 접히고 hero가 **정정값**을 띄운다(옛 이상치값 잔존 금지).
  const alarmAfterGreen = frames.slice(firstGreen).filter((f) => f.central === 'alarm');
  expect(alarmAfterGreen.length, 'green 이후 알람 카드 프레임 0').toBe(0);
  const confirmTexts = [...new Set(
    frames.filter((f) => f.hero === 'confirm' && f.heroText).map((f) => f.heroText),
  )];
  expect(confirmTexts, 'hero 확정 플래시가 띄우는 값은 정정값 하나뿐(옛 120.5 아님)').toEqual(['90.5']);

  // 🔴 ③ 해제 계측이 corrected로 남는다(음성 경로와 같은 바이트).
  const trend = await trendEvents(page);
  const cleared = trend.filter((x) => x.startsWith('trend_alert_cleared'));
  expect(cleared.length, '해제 계측 1건').toBeGreaterThanOrEqual(1);
  expect(cleared[0], '종전엔 hadStatus=pending이었다').toContain('hadStatus=corrected');
});

test('P-2④ 다른 셀 알람(정보성 팝업)은 키패드 커밋에 불변 — row+colId 가드', async ({ page }) => {
  await bootMini(page);

  await fireStt(page, '120.5', 900);
  await expect(page.locator('[data-testid="anomaly-alert"][data-status="pending"]')).toBeVisible({ timeout: 6000 });

  // 알람은 측정항목01에 걸려 있는데, **다른 셀**(측정항목03)에 정상값을 키패드로 넣는다.
  await keypadCommit(page, '측정항목03', ['7', '.', '7']);
  await page.waitForTimeout(800);

  await expect(
    page.locator('[data-testid="anomaly-alert"][data-status="pending"]'),
    '남의 셀 커밋은 알람을 초록으로 만들지 않는다',
  ).toBeVisible();
  expect(
    await page.locator('[data-voice-tone]').first().getAttribute('data-voice-tone'),
    '톤도 red 유지',
  ).toBe('red');
  await expect(page.locator('[data-testid="anomaly-alert"]'), '팝업 값도 그대로').toContainText('120.5');
});

test('P-2⑤ manualHold 재커밋 경로는 손대지 않았다 — manual_recommit + hadStatus=pending 불변', async ({ page }) => {
  await bootMini(page);

  // 수동 커밋이 발동시킨 알람(= 08-12 에피소드 7, 이미 0.318초로 정상이던 경로).
  await keypadCommit(page, '측정항목01', ['1', '2', '0', '.', '5']);
  await expect(page.locator('[data-testid="anomaly-alert"]')).toBeVisible({ timeout: 6000 });

  // [수정] → 시트 재오픈 → 정상값 재커밋.
  await page.locator('[data-testid="anomaly-modify-btn"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible({ timeout: 4000 });
  for (const k of ['9', '0', '.', '5']) await page.locator(`[data-testid="manual-key-${k}"]`).click();
  await page.locator('[data-testid="manual-commit"]').click();
  await page.waitForTimeout(1200);

  const trend = await trendEvents(page);
  const cleared = trend.filter((x) => x.startsWith('trend_alert_cleared'));
  expect(cleared.length, '해제 계측 1건').toBeGreaterThanOrEqual(1);
  // 🔑 이 경로는 알람을 **먼저 내린다**(clearAnomalyAlert) → 새 corrected 전이가 도달할 알람이
  //    없다(no-op). 바이트가 바뀌었다면 내 변경이 이 경로까지 삼킨 것이다.
  expect(cleared[0], 'manual_recommit 경로 바이트 불변').toContain('reason=manual_recommit');
  expect(cleared[0], 'manual_recommit 경로 바이트 불변').toContain('hadStatus=pending');
});
