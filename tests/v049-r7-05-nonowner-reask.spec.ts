/**
 * v0.49 r7 #5 오라클(codex r6#9) — **비-awaiting 키패드 커밋은 남의 거절 큐를 내리지 않는다.**
 *
 * `reaskReason`은 「이 커밋이 성공했다」가 아니라 **`awaiting` 셀이 무엇을 기다리는가**를 설명하는
 * 화면 큐다(M4의 「거절 큐는 그 셀의 것이다」). 그런데 `commitManualValue`의 해제 줄이 소유권
 * 분기 **앞**에 무조건 있어서, 다른 셀을 덮어쓰는 커밋이 남의 큐를 내렸다.
 *
 * 피해는 M3가 닫은 **「무고지 합성」의 화면 축**이다: `setReaskReason(null)`은 store 계약상
 * `reaskDecimalWhole`까지 함께 지우는데, `awaiting`의 `fractionWhole`은 **그대로 살아 있다**
 * (이 분기는 진행 상태를 건드리지 않는다 — v0.47.0 W1). 화면에선 소수 문맥이 사라졌는데
 * 다음 발화는 여전히 정수부와 합성된다 = 사용자가 전체값을 말해야 하는지 알 수 없다(§2).
 *
 * Z4가 승계 규칙에서 `fractionWhole`을 일부러 두고 간 근거의 **반대편 반쪽**이다:
 * 그쪽은 「화면을 지웠으니 문맥도 들고 가지 마라」, 여기는 「문맥이 사는데 화면만 지우지 마라」.
 *
 * 반증(실측): `if (ownsFlow)` 가드를 떼면 **①만 red**다. ②③은 양방향 green이고 그건 계약이다 —
 *   ②가 고정하는 것은 「합성은 원래 살아 있다」는 **결함의 나머지 반쪽**이다(가드가 있든 없든
 *   `fractionWhole`은 죽지 않는다). 두 축을 함께 걸어 둬야 「화면만 갈렸다」가 오라클에서 읽힌다.
 *   ③은 과잉 방어 가드다(가드가 소유 커밋까지 막으면 M4가 재개방된다).
 */

import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, ttsLog, waitForTtsIdle } from './fixtures/stt';

test.setTimeout(120_000);

const COLS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 1 }, sampleKey: true },
  { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  { id: 'm2', name: '측정항목02', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];

const bootR7 = (page: Page) => boot(page, PHONE_402, {
  settings: {
    ...AZ_SETTINGS,
    state: { ...AZ_SETTINGS.state, columns: COLS, totalRows: 1, sessionAutoLabel: 'r7-05' },
  } as unknown as typeof AZ_SETTINGS,
  headers: ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02'],
  sheetRows: [[PREV_ROUND, '이원창', '1', '100.0', '']],
});

const cue = (page: Page) => page.locator('[data-testid="reask-cue"]');
const chip = (page: Page, colName: string) =>
  page.locator(`[data-testid="column-chip"][data-col-name="${colName}"]`);

async function keypadCommit(page: Page, colName: string, keys: string[]) {
  await chip(page, colName).click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible({ timeout: 5000 });
  for (const k of keys) await page.locator(`[data-testid="manual-key-${k}"]`).click();
  await page.locator('[data-testid="manual-commit"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toHaveCount(0);
  await page.waitForTimeout(600);
}

/** 01에서 **소수부 재질문**을 세운다 — 화면 큐와 `awaiting.fractionWhole`이 한 쌍으로 산다. */
async function decimalReaskOn01(page: Page) {
  await waitForTtsIdle(page);
  await fireStt(page, '백십일 점', 1700);
  await waitForTtsIdle(page);
  await expect(cue(page), '전제: 소수부 재질문 큐가 섰다').toBeVisible({ timeout: 4000 });
}

test('① 다른 셀 키패드 커밋이 대기 셀의 소수 큐를 내리지 않는다', async ({ page }) => {
  await bootR7(page);
  await decimalReaskOn01(page);

  await keypadCommit(page, '측정항목02', ['5', '0', '.', '0']); // 비-awaiting 커밋
  expect(
    (await ttsLog(page)).at(-1),
    '전제: 비-awaiting 커밋은 값만 에코하고 흐름을 건드리지 않는다(W1 계약)',
  ).toBe('50.0');

  await expect(
    cue(page),
    '남의 커밋이 큐를 내렸다 — 화면에선 소수 문맥이 사라졌는데 합성은 그대로 산다(§2 위반)',
  ).toBeVisible();
});

test('② 큐가 살아 있으므로 다음 발화가 정수부와 합성된다 — 화면과 합성이 갈리지 않는다', async ({ page }) => {
  await bootR7(page);
  await decimalReaskOn01(page);
  await keypadCommit(page, '측정항목02', ['5', '0', '.', '0']);

  await fireStt(page, '오', 1600);
  await waitForTtsIdle(page);
  // 이 커밋이 행을 완성시켜 뒤에 완료·끝도달 안내가 붙는다 — 마지막 줄이 아니라 **에코**를 본다.
  expect(
    (await ttsLog(page)).some((t) => t === '111.5'),
    '합성 결과(111.5)는 큐가 예고한 것과 같아야 한다 — 큐만 지우면 이 합성이 무고지가 된다',
  ).toBe(true);
  const m1 = await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((r) => {
      const q = indexedDB.open('agri-voicenote');
      q.onsuccess = () => r(q.result);
    });
    const all: { rows?: { index: number; values: Record<string, string> }[] }[] = await new Promise((r) => {
      const g = db.transaction('sessions', 'readonly').objectStore('sessions').getAll();
      g.onsuccess = () => r(g.result as never);
      g.onerror = () => r([]);
    });
    db.close();
    return all.at(-1)?.rows?.find((x) => x.index === 1)?.values.m1;
  });
  expect(m1, '실제로 합성된 값이 내구화된다').toBe('111.5');
});

test('③ 대조군 — 대기 셀 자신에 대한 키패드 커밋은 종전대로 큐를 내린다', async ({ page }) => {
  await bootR7(page);
  await decimalReaskOn01(page);

  await keypadCommit(page, '측정항목01', ['1', '2', '0', '.', '5']); // 소유 커밋
  await waitForTtsIdle(page);
  await expect(
    cue(page),
    '그 대기를 실제로 끝낸 커밋은 큐를 내려야 한다(과잉 방어로 큐가 남으면 M4 재개방)',
  ).toHaveCount(0);
});
