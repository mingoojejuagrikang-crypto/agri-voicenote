/**
 * v0.47.0-r2 P2(FB-C · 민구 실기기 08-09) — **수동입력 보류 중 음성 차단을 「들리게」 한다.**
 *
 * 무엇이 문제였나: 07-14 결정으로 수동입력 이상치는 터치 [확인]/[수정] 전용이고, 그 사이 음성은
 * `isManualHoldBlocked`가 **전부 버린다**. 그런데 버리는 것이 무음이었다 — 08-09 실측에서 민구가
 * 「확인」×6·「100」×3·「일시 정지」×3을 말했고 12건이 `blocked:manual_hold:stt`로 조용히
 * 사라졌다. 민구는 그걸 **TTS 고장**으로 읽었다(*"tts가 몇번 알람 후 작동을 안하네"*).
 *
 * 민구 확정(08-09): **차단은 유지**하고 안내만 낸다. 이 스펙이 고정하는 계약:
 *  ⓐ 홀드 중 첫 음성 차단에 안내 TTS가 나간다(+ `manual_hold_guide:stt` 계측).
 *  ⓑ 같은 알람에서 반복 차단돼도 **재안내하지 않는다.** 이건 스팸 방지가 아니라 **루프 차단**이다
 *     — speech.ts는 TTS 재생 중에도 final을 올리므로 안내 발화 자체가 재인식돼 되돌아올 수 있다.
 *  ⓒ 알람이 **바뀌면** 리셋된다([수정] 후 다른 값으로 재위반 = 새 알람 = 새 안내).
 *  ⓓ 🔴 안내 문구에 **명령 어휘가 없다.** detectCommand는 공백을 지우고 startsWith로 맞으므로
 *     문구가 재인식되면 명령이 실행된다. 특히 `screenOff`의 word가 `'화면'`이라 초안
 *     *"화면의 버튼을 눌러 주세요"* 는 검은 화면을 켤 수 있었다(설계 중 실측으로 잡아 교체).
 *     이 단언이 그 회귀를 막는다.
 *
 * ⚠️ 왕복 OFF([TEAMOPS-81]) — 칩을 **클릭**하므로 `chipSweepSeconds: 0`이 필수다
 *    (activeZones SETTINGS가 이미 갖고 있고, 아래 MINI_SETTINGS가 그것을 승계한다).
 */

import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, ttsLog } from './fixtures/stt';

test.setTimeout(120_000);

/** 측정항목01 = `trendRule: 'increase'`(커지면 알람) · 직전값 100.0 → 120.5/130.5가 위반값. */
const MINI_COLUMNS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'increase' },
  { id: 'm2', name: '측정항목02', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];
const MINI_SETTINGS = {
  ...AZ_SETTINGS,
  state: { ...AZ_SETTINGS.state, columns: MINI_COLUMNS, totalRows: 2, sessionAutoLabel: 'r2-p2-hold-guide' },
};
const MINI_HEADERS = ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02'];
const MINI_ROWS = [
  [PREV_ROUND, '이원창', '1', '100.0', '5.0'],
  [PREV_ROUND, '이원창', '2', '100.0', '5.0'],
];

const GUIDE_PREFIX = '알림은 터치로만';

/** 칩 탭 → 키패드 수동 입력 커밋. awaiting 셀 자신을 커밋하므로 위반이면 **보류**(manualHold)다. */
async function commitManual(page: Page, colName: string, keys: string[]) {
  await page.locator(`[data-testid="column-chip"][data-col-name="${colName}"]`).click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible();
  for (const k of keys) await page.locator(`[data-testid="manual-key-${k}"]`).click();
  await page.locator('[data-testid="manual-commit"]').click();
  await page.waitForTimeout(800);
}

async function logEventsFromIDB(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db || !db.objectStoreNames.contains('logEvents')) return [];
    return new Promise<Array<{ type: string; extra?: string; parsed?: string }>>((res) => {
      const tx = db.transaction('logEvents', 'readonly');
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result as Array<{ type: string; extra?: string; parsed?: string }>);
      req.onerror = () => res([]);
    });
  });
}

const countExtra = (events: Array<{ extra?: string }>, needle: string) =>
  events.filter((e) => (e.extra ?? '') === needle).length;

async function bootHold(page: Page) {
  await boot(page, PHONE_402, {
    settings: MINI_SETTINGS as unknown as typeof AZ_SETTINGS,
    headers: MINI_HEADERS,
    sheetRows: MINI_ROWS,
  });
  await commitManual(page, '측정항목01', ['1', '2', '0', '.', '5']);
  await expect(page.locator('[data-testid="anomaly-alert"]'), '수동 커밋 이상치 = 진행 보류 팝업')
    .toBeVisible({ timeout: 6000 });
  await expect(page.locator('[data-testid="anomaly-confirm-btn"]')).toBeVisible();
}

test('P2ⓐⓑⓓ 🔴 홀드 중 음성 차단에 안내 TTS 1회 — 반복 차단은 무음, 문구에 명령 어휘 없음', async ({ page }) => {
  await bootHold(page);

  // 🔴 회귀 지점 — 종전엔 이 세 발화가 전부 무음으로 사라졌다(민구: "TTS가 작동을 안 하네").
  await fireStt(page, '확인', 700);
  await fireStt(page, '100', 700);
  await fireStt(page, '일시 정지', 700);

  const spoken = await ttsLog(page);
  const guides = spoken.filter((t) => t.startsWith(GUIDE_PREFIX));
  // ⓐ 안내가 나갔다. ⓑ 3번 막혔지만 **1번만** 나갔다.
  expect(guides, '홀드 차단 안내는 알람 1건당 정확히 1회').toHaveLength(1);

  // ⓓ 문구에 명령 어휘가 없다. '화면'은 screenOff의 word라 재인식 시 검은 화면이 켜진다.
  const guide = guides[0];
  for (const w of ['화면', '확인', '수정', '다음', '이전', '유지', '종료', '취소', '재시작', '도움말']) {
    expect(guide, `안내 문구에 명령 어휘 '${w}'가 있으면 자기입력으로 실행된다`).not.toContain(w);
  }

  // 차단은 그대로 유지된다(07-14 결정은 뒤집지 않는다) — 팝업 생존 + 포인터 부동.
  await expect(page.locator('[data-testid="anomaly-alert"]'), '음성으로는 여전히 해소되지 않는다')
    .toBeVisible();

  // 계측: 차단 3건 / 안내 1건 — 이 비(比)가 "안내를 듣고도 계속 말했는가"의 다음 회차 판정 근거다.
  const events = await logEventsFromIDB(page);
  expect(countExtra(events, 'blocked:manual_hold:stt'), 'STT 차단 3건').toBe(3);
  expect(countExtra(events, 'manual_hold_guide:stt'), '안내 계측 1건').toBe(1);

  // 해소는 터치로만 — [확인] 뒤 전진(기존 계약 회귀 없음).
  await page.locator('[data-testid="anomaly-confirm-btn"]').click();
  await page.waitForTimeout(700);
  await expect(page.locator('[data-testid="anomaly-alert"]')).toHaveCount(0);
});

test('P2ⓒ 🔴 알람이 바뀌면 안내가 리셋된다 — [수정] 후 다른 값으로 재위반하면 다시 안내', async ({ page }) => {
  await bootHold(page);

  await fireStt(page, '확인', 700);
  expect((await ttsLog(page)).filter((t) => t.startsWith(GUIDE_PREFIX)), '첫 알람 안내 1회')
    .toHaveLength(1);

  // [수정] → 시트 재오픈(보류는 유지된다 — v0.34.0 라운드2 계약) → 또 다른 위반값으로 재커밋.
  await page.locator('[data-testid="anomaly-modify-btn"]').click();
  await page.waitForTimeout(400);
  await commitManual(page, '측정항목01', ['1', '3', '0', '.', '5']);
  await expect(page.locator('[data-testid="anomaly-alert"]'), '재위반 → 새 보류 알람')
    .toBeVisible({ timeout: 6000 });

  // 새 알람이므로 다시 안내한다(1회 제한은 **알람 단위**이지 세션 단위가 아니다).
  await fireStt(page, '확인', 700);
  expect((await ttsLog(page)).filter((t) => t.startsWith(GUIDE_PREFIX)), '새 알람 = 새 안내(누적 2회)')
    .toHaveLength(2);
});
