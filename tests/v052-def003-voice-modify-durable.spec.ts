/**
 * 🔴🔴 v0.52 DEF-003 오라클 — **음성 「수정 <값>」의 내구 저장 전 거짓 성공.**
 *
 * 08-25 실배포 딥 테스트 A-1: *"화면·비프·에코 TTS가 전부 성공을 고지하는데 IDB에는 옛 값이
 * 남고 새로고침하면 유실된다. 사용자가 알아차릴 신호가 **0**이라는 점이 심각도의 본체다."*
 *
 * 🔑 **좌표 정정(2026-09-03 빌더 실측, Larry 수용).** 08-25 보고서의
 *   `useVoiceSession.ts:1286/1297/1313-1314`는 `handleFinal`이 아니라 **`enterModifyMode`의
 *   직접값 분기**다(`git show 7fed23a` 줄 대조). `refactor/uvs-series`는 `handleFinal`의 값 커밋만
 *   `useValueCommit.ts`로 옮겼고 이 구획은 손대지 않아, 수정 전 HEAD(2f14236)의 같은 세 줄이
 *   `:1315`(`void saveSession(...).catch(() => {})`) · `:1326`(`void persistSession()`) ·
 *   `:1347-1348`(burst + ✓)에 그대로 살아 있었다.
 *
 * ## 수정 전 실측(HEAD 2f14236, 코드 변경 0)
 *   ① green — m1 커밋 후 실패 주입 상태에서 「수정 사십일 점 사」:
 *      **IDB `row1.m1 = '35.1'`(옛 값)** · 화면 칩 `41.4` · 에코 `수정 측정항목01, 41.4` 발화 ·
 *      `beep_play:kind=commit` 1건 · `value/direct_modify` 1건 · **FAIL_TTS 0건 · 배너 0**.
 *   ② red — 배너가 끝내 서지 않는다(`element(s) not found`).
 *   ③ green(기준선) · ④ green(대조군: 정상이면 `row1.m1 = '41.4'`).
 *   👉 **재현 확정.** ⓐ(실패 고지)가 통째로 없고, ⓑ는 실패 경로에서만 깨진다.
 *
 * 🔴 **형제 경로는 이미 닫혀 있다 — 형상을 틀리면 「미재현」으로 오판한다.**
 *   · 수동/키패드 커밋 → `persistCellValue`가 durable을 반환한다(v0.47.0 C-FIX2 · v0.49 r6 Y1).
 *   · 음성 **재청취**(bare 「수정」 → 값) → `enterModifyMode`가 `correctionBackupRef`를 세우므로
 *     재커밋의 `finalizeRowCompletion`이 `hadBackup` 분기로 durable을 받는다(v0.49 r3 #1).
 *   · 음성 **행 완주** → `proceedAfterCommit` 진입부의 `finalizeRowCompletion`이 받는다(Y1 ③).
 *   남은 구멍이 **직접값 「수정 41.4」 한 갈래**였다. 그 안에서 다시 persist가 둘로 갈리므로
 *   (①=클립 포인터 있음 → `saveSession`, ⑤=무클립 → `persistSession`) **둘 다** 잰다.
 *
 * ## 이 스펙이 고정하는 계약
 *  ⓐ durable 실패는 **셀 배너**로 화면에 남고 실패 고지가 발화된다(PRINCIPLES §1 재시도 경로).
 *  ⓑ 값이 **실제로 IDB에 실린다** — 재시도가 그것을 회복한다.
 *  🔴 **확인음·에코는 durable 뒤로 미루지 않는다**(민구 확인음 계약). ①이 실패 경로에서도
 *     `beep_play:kind=commit`과 에코가 **그대로 나가는지**를 단언해 그 계약을 잠근다.
 *     durable을 따르는 것은 ✓·착지·배너 셋이다.
 *
 * ⚠️ **✓ 개수는 실패 형상에서 판별력이 없다.** `useSessionCommitMarks`는 add 전용 집합이고
 *   수정 대상 셀은 직전 커밋에서 이미 ✓를 받았다 — 실패해도 `add`가 no-op이라 개수가 안 변한다.
 *   그래서 ✓ 축은 **성공 경로(④)** 에서만 잰다(add를 durable 뒤로 옮긴 것이 정상 커밋의 ✓를
 *   떨어뜨리지 않는지). 실패 경로의 ✓ 억제는 이 형상에서 **관측 불가**다 — 콜드 리뷰 지점.
 */

import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, ttsLog, waitForTtsIdle } from './fixtures/stt';

test.setTimeout(120_000);

/** Y1 오라클과 **같은 스키마**(voice 2칸)를 쓴다 — 두 스펙의 형상 차이가 컬럼이 아니라
 *  「어느 커밋 경로인가」 하나로만 갈리게 하기 위함이다. 추세 규칙 없음(①~⑤는 알람 무관). */
const COLS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  { id: 'm2', name: '측정항목02', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];

/** ⑥ 전용 — 측정항목01만 `trendRule: 'increase'`(직전보다 커지면 알람 · 직전값 100.0).
 *  v0470-r2-p1의 MINI 픽스처와 같은 전제다(그쪽이 이 분기의 SSOT 오라클이다). */
const COLS_TREND = COLS.map((c) => (c.id === 'm1' ? { ...c, trendRule: 'increase' } : c));

const settingsOf = (columns: unknown[], label: string) => ({
  ...AZ_SETTINGS,
  state: { ...AZ_SETTINGS.state, columns, totalRows: 2, sessionAutoLabel: label },
} as unknown as typeof AZ_SETTINGS);

const HEADERS = ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02'];

const bootDef003 = (page: Page) => boot(page, PHONE_402, {
  settings: settingsOf(COLS, 'v052-def003'),
  headers: HEADERS,
  sheetRows: [[PREV_ROUND, '이원창', '1', '100.0', '']],
});

const bootTrend = (page: Page) => boot(page, PHONE_402, {
  settings: settingsOf(COLS_TREND, 'v052-def003-trend'),
  headers: HEADERS,
  sheetRows: [[PREV_ROUND, '이원창', '1', '100.0', '5.0']],
});

const FAIL_TTS = '저장하지 못했습니다. 다시 저장 버튼을 눌러 주세요.';
const ECHO_MODIFY = '수정 측정항목01, 41.4';
const banner = (page: Page) => page.locator('[data-testid="cell-persist-error-banner"]');
const chip = (page: Page, name: string) =>
  page.locator(`[data-testid="column-chip"][data-col-name="${name}"]`);
const mark = (page: Page, name: string) =>
  chip(page, name).locator('[data-testid="chip-commit-mark"]');

/** 전면 실패 주입(모든 세션 put) — Y1 오라클과 같은 seam(`db.ts` saveSession). */
async function failAll(page: Page, v: boolean) {
  await page.evaluate((f) => {
    (window as unknown as { __survey011FailSessionPut?: boolean }).__survey011FailSessionPut = f;
  }, v);
}

interface PersistedRow { i: number; c: boolean; v: Record<string, string>; clips: Record<string, string> }

/** IDB에 실제로 내구화된 것 — **시트로 올라갈 것**을 잰다(화면 상태가 아니다). */
async function persistedRows(page: Page): Promise<PersistedRow[]> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((r) => {
      const q = indexedDB.open('agri-voicenote');
      q.onsuccess = () => r(q.result);
    });
    const all: { rows?: { index: number; complete: boolean; values: Record<string, string>; audioClips?: Record<string, string> }[] }[] =
      await new Promise((r) => {
        const tx = db.transaction('sessions', 'readonly');
        const g = tx.objectStore('sessions').getAll();
        g.onsuccess = () => r(g.result as never);
        g.onerror = () => r([]);
      });
    db.close();
    return (all.at(-1)?.rows ?? []).sort((a, b) => a.index - b.index)
      .map((r) => ({ i: r.index, c: r.complete, v: r.values, clips: r.audioClips ?? {} }));
  });
}

const row1Of = async (page: Page) => (await persistedRows(page)).find((r) => r.i === 1);

/** 🔴 음성 증분 persist는 fire-and-forget이라 `waitForTtsIdle`만으로는 **착지를 보장하지 않는다**.
 *  실패 주입 시점을 「이전 값이 IDB에 실린 뒤」로 고정하려면 실제 값을 폴링해야 한다 —
 *  그래야 08-25가 보고한 「IDB에 **옛 값**이 남는다」 형상이 재현된다(처음부터 켜면 IDB 0건이
 *  되어 Y1이 이미 닫은 축과 구별되지 않는다). */
async function waitForPersistedValue(page: Page, row: number, colId: string, value: string) {
  await expect.poll(
    async () => (await persistedRows(page)).find((r) => r.i === row)?.v[colId],
    { timeout: 10_000, message: `전제: IDB row${row}.${colId} = ${value} 착지` },
  ).toBe(value);
}

interface LoggedEvent { type: string; parsed?: string; extra?: string; colId?: string; row?: number }

/** logEvents 스토어는 `sessions` seam의 영향을 받지 않는다 — 실패 주입 중에도 그대로 읽힌다. */
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

/** 1행 m1을 **음성으로** 커밋하고 그 값이 IDB에 실릴 때까지 기다린다.
 *  음성 커밋은 클립 포인터를 남기므로 이후 직접수정은 `saveSession`(:1315) 갈래를 탄다. */
async function voiceM1AndLand(page: Page) {
  await fireStt(page, '삼십오 점 일', 1600);
  await waitForTtsIdle(page);
  await waitForPersistedValue(page, 1, 'm1', '35.1');
}

/** 1행 m1을 **키패드로** 커밋한다 — 수동 커밋은 클립 포인터를 남기지 않으므로 이후 직접수정은
 *  `persistSession`(:1326) 갈래를 탄다(08-25 보고서의 `:1297` 좌표). */
async function keypadM1AndLand(page: Page) {
  await chip(page, '측정항목01').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible({ timeout: 5000 });
  for (const k of ['3', '5', '.', '1']) await page.locator(`[data-testid="manual-key-${k}"]`).click();
  await page.locator('[data-testid="manual-commit"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toHaveCount(0);
  await waitForTtsIdle(page);
  await waitForPersistedValue(page, 1, 'm1', '35.1');
}

test('① 직접값 「수정 <값>」 durable 실패 — 확인음·에코는 그대로 나가고, ✓ 대신 배너와 실패 고지가 선다', async ({ page }) => {
  await bootDef003(page);
  await voiceM1AndLand(page);
  expect((await row1Of(page))?.clips.m1, '전제: 음성 커밋이라 클립 포인터가 있다 = saveSession(:1315) 갈래').toBeTruthy();

  await failAll(page, true);
  await fireStt(page, '수정 사십일 점 사', 1800);
  await waitForTtsIdle(page);

  const tts = await ttsLog(page);
  const evts = await logEvents(page);

  // 전제 — 직접값 수정 경로를 탔다(재청취 캐스케이드가 아니다).
  expect(
    evts.some((e) => e.type === 'value' && e.extra === 'direct_modify' && e.colId === 'm1'),
    '전제: direct_modify 커밋',
  ).toBe(true);

  // 🔴 확인음·에코는 **미루지 않는다**(민구 확인음 계약 — WP-E 순서: 확인음 → 인식값).
  expect(
    evts.some((e) => e.extra?.startsWith('beep_play:kind=commit')),
    '실패해도 커밋 확인음은 제때 난다(durable 뒤로 미루지 않는다)',
  ).toBe(true);
  expect(tts, '실패해도 에코는 제때 나간다(같은 계약)').toContain(ECHO_MODIFY);

  // ⓐ 실패가 화면에 남고 마지막 안내가 실패 고지다.
  await expect(banner(page), '실패가 화면에 지속된다(PRINCIPLES §1 재시도 경로)').toBeVisible();
  await expect(banner(page)).toContainText('측정항목01 41.4');
  expect((await ttsLog(page)).at(-1), '마지막 안내는 실패 고지').toBe(FAIL_TTS);
  expect(
    evts.some((e) => e.type === 'error' && e.extra?.startsWith('cell_persist_failed:')),
    '실패가 로그에도 남는다(SOP-003 소비자와 같은 접두)',
  ).toBe(true);

  // 착지 재안내를 하지 않는다 — 갱신값 재낭독은 두 번째 성공 고지가 된다.
  //   ⚠️ 관측창은 **에코 이후**다. m1 커밋 직후의 정상 전진 안내(「측정항목02」)가 그 앞에 이미
  //   있으므로 전체 로그를 세면 그것까지 잡힌다(실측으로 한 번 어긋났다).
  expect(
    tts.slice(tts.indexOf(ECHO_MODIFY) + 1).filter((t) => t.startsWith('측정항목02')),
    '실패 뒤 착지 재안내는 없다',
  ).toHaveLength(0);

  // IDB는 옛 값 그대로(주입한 실패의 실제 귀결) — 화면과 갈린 것을 배너가 말해 준다.
  expect((await row1Of(page))?.v.m1, 'IDB에는 옛 값이 남는다').toBe('35.1');
  await expect(chip(page, '측정항목01'), '화면 칩은 새 값을 보여준다').toContainText('41.4');
});

test('② 재시도가 실제로 회복한다 — 배너가 내려가고 수정값이 IDB에 실린다(ⓑ)', async ({ page }) => {
  await bootDef003(page);
  await voiceM1AndLand(page);

  await failAll(page, true);
  await fireStt(page, '수정 사십일 점 사', 1800);
  await waitForTtsIdle(page);
  await expect(banner(page)).toBeVisible();

  await failAll(page, false);
  await page.locator('[data-testid="cell-persist-retry-btn"]').click();
  await expect(banner(page), 'durable 성공이 배너를 내린다').toHaveCount(0, { timeout: 5000 });
  await waitForTtsIdle(page);

  expect((await row1Of(page))?.v.m1, '재시도가 수정값을 실제로 내구화한다').toBe('41.4');
});

test('③ 실패 뒤에도 입력 흐름이 살아 있다 — 다음 발화가 원래 대기 칸으로 간다', async ({ page }) => {
  await bootDef003(page);
  await voiceM1AndLand(page);

  await failAll(page, true);
  await fireStt(page, '수정 사십일 점 사', 1800);
  await waitForTtsIdle(page);
  await expect(banner(page)).toBeVisible();

  // 🔴 착지 재안내를 생략하되 **대기 상태는 건드리지 않는다**(v0.49 r7 #1이 커밋 종단에서
  //   복원으로 얻은 것을 여기서는 손대지 않는 것으로 얻는다). 2~3m 거리의 음성 전용 사용자가
  //   무음 흡수로 입력 불능에 주차되면 안 된다(PRINCIPLES §2).
  await failAll(page, false);
  await fireStt(page, '사십이 점 삼', 1800);
  await waitForTtsIdle(page);

  expect((await row1Of(page))?.v.m2, '다음 발화는 여전히 m2로 커밋된다').toBe('42.3');
});

test('④ 대조군 — 실패가 없으면 수정값이 IDB에 실리고 ✓·에코가 종전 그대로다', async ({ page }) => {
  await bootDef003(page);
  await voiceM1AndLand(page);

  await fireStt(page, '수정 사십일 점 사', 1800);
  await waitForTtsIdle(page);
  await waitForPersistedValue(page, 1, 'm1', '41.4');

  const tts = await ttsLog(page);
  expect(tts, '정상 경로의 에코는 종전 그대로').toContain(ECHO_MODIFY);
  expect(tts, '정상 커밋에 실패 고지가 나면 안 된다').not.toContain(FAIL_TTS);
  await expect(banner(page), '과잉 방어로 정상 커밋을 막지 않는다').toHaveCount(0);
  // ✓ add를 durable 뒤로 옮긴 것이 **정상 커밋의 ✓를 떨어뜨리지 않는다**(W4 유지).
  await expect(mark(page, '측정항목01'), '성공 커밋에는 ✓가 그대로 붙는다').toHaveCount(1);
});

test('⑤ 무클립 셀(persistSession 갈래)도 같은 계약 — 08-25 보고서의 `:1297` 좌표', async ({ page }) => {
  await bootDef003(page);
  await keypadM1AndLand(page);
  expect((await row1Of(page))?.clips.m1, '전제: 수동 커밋이라 클립 포인터가 없다 = persistSession(:1326) 갈래').toBeFalsy();

  await failAll(page, true);
  await fireStt(page, '수정 사십일 점 사', 1800);
  await waitForTtsIdle(page);

  await expect(banner(page), '무클립 갈래도 실패를 화면에 남긴다').toBeVisible();
  await expect(banner(page)).toContainText('측정항목01 41.4');
  expect((await row1Of(page))?.v.m1, 'IDB에는 옛 값이 남는다').toBe('35.1');

  await failAll(page, false);
  await page.locator('[data-testid="cell-persist-retry-btn"]').click();
  await expect(banner(page)).toHaveCount(0, { timeout: 5000 });
  expect((await row1Of(page))?.v.m1, '재시도가 회복한다').toBe('41.4');
});

test('⑥ 이상치 알람 분기도 정산한다 — 알람과 배너는 서로 다른 사실이라 둘 다 선다', async ({ page }) => {
  await bootTrend(page);
  // 직전 회차 100.0과 같은 값 → 위반 없음. 커밋 뒤 IDB 착지까지 기다린다.
  //   ⚠️ 저장 문자열은 `'100'`이다 — `parseValueForCol`이 소수 꼬리 0을 남기지 않는다(실측).
  await fireStt(page, '100.0', 1200);
  await waitForTtsIdle(page);
  await waitForPersistedValue(page, 1, 'm1', '100');

  // 「수정 120.5」 = 직전 100.0 대비 increase 위반 → 알람 분기. 그 위에 durable 실패를 겹친다.
  await failAll(page, true);
  await fireStt(page, '수정 120.5', 1500);
  await expect(page.locator('[data-testid="anomaly-alert"]'), '위반은 종전대로 알람을 띄운다')
    .toBeVisible({ timeout: 6000 });
  await waitForTtsIdle(page);

  const tts = await ttsLog(page);
  expect(
    tts.filter((t) => t.startsWith('추세 알람')),
    '알람 TTS는 그대로 나간다(durable 뒤로 미루지 않는다)',
  ).not.toHaveLength(0);
  await expect(banner(page), '알람 분기의 durable 실패도 화면에 남는다').toBeVisible();
  await expect(banner(page)).toContainText('측정항목01 120.5');
  expect((await row1Of(page))?.v.m1, 'IDB에는 옛 값이 남는다').toBe('100');
});
