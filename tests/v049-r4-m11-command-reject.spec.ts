/**
 * 🔴 v0.49 r4 M11 오라클(민구 D2 08-13 · codex r3 F8) — **저신뢰 명령 거절도 거절이다.**
 *
 * r3 #6이 값 거절 여섯 분기를 하나의 종단(`armRejectCue`)으로 모았는데, 인접 형제인
 * **저신뢰 명령 거절**(`rejectLowConfidence`)만 그 밖에 남아 있었다: 부정 비프도 화면 큐도 없고
 * `beep_play:kind=reject` 집계에도 안 잡힌다. 현장에서는 폰을 2~3m 떨어뜨려 두므로
 * (PRINCIPLES §2) 「'종료'라고 말했는데 안 먹혔다」를 알 채널이 통째로 없었다.
 *
 * ③은 **전제 재검증의 결과를 고정하는 대조군**이다. 브리핑은 인라인 형제 셋
 * (`cmdModify` 재수정 · `cmdCancel` · `modifyAnomalyTouch`)도 종단 편입 후보로 지목했지만,
 * 그 셋은 「값 거절 흐름과 등가」가 **아니다**: 사용자의 입력은 접수됐고 앱이 같은 칸을 다시
 * 들을 뿐이다. 거절 신호를 붙이면 접수된 입력을 거절됐다고 고지하고 집계까지 오염된다.
 * 그래서 그 셋은 **문구만** §2 쌍 상수(`relistenPrompt`)로 옮겼다(바이트 불변).
 *
 * ④는 M3가 세운 불변식의 가드다 — `armRejectCue`의 `setReaskReason`이 소수 정수부를 함께
 * 지우므로, 명령 거절 입구에서도 그 문맥을 되살리지 않으면 「무고지 합성」이 부활한다.
 *
 * 반증(`armRejectCue` 제거 시): ①② red.
 */

import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, ttsLog, waitForTtsIdle } from './fixtures/stt';

test.setTimeout(120_000);

const MINI_COLUMNS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 1 }, sampleKey: true },
  { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  { id: 'm2', name: '측정항목02', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];
const MINI_SETTINGS = {
  ...AZ_SETTINGS,
  state: { ...AZ_SETTINGS.state, columns: MINI_COLUMNS, totalRows: 1, sessionAutoLabel: 'r4-m11' },
};
const MINI_HEADERS = ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02'];
const MINI_ROWS = [[PREV_ROUND, '이원창', '1', '100.0', '']];

/** 명령 게이트 기본값은 0.7(`commandMinConfidence`) — 0.5는 확실히 그 아래다. */
const LOW_CONF = 0.5;
/** v0.51.1 R5 — **정확 일치 「수정」**은 floor가 0.40이다(`minConfidenceExact` · 09-02 실기기 0.443~0.505 거절 구제).
 *  종전 0.5는 이제 접수되므로, 「수정」 거절 케이스(②·④)는 0.40 **아래**로 쏜다(잡음 군집 최대 0.313 부근). */
const LOW_CONF_MODIFY = 0.3;

type LogEv = { type: string; extra?: string };

async function loadLogEvents(page: Page): Promise<LogEv[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db) return [];
    return new Promise<LogEv[]>((res) => {
      const req = db.transaction('logEvents', 'readonly').objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result as LogEv[]);
      req.onerror = () => res([]);
    });
  });
}

async function rejectBeeps(page: Page): Promise<number> {
  return (await loadLogEvents(page))
    .filter((e) => e.type === 'app' && String(e.extra ?? '').startsWith('beep_play:kind=reject')).length;
}

const cue = (page: Page) => page.locator('[data-testid="reask-cue"]');

async function bootMini(page: Page) {
  await boot(page, PHONE_402, {
    settings: MINI_SETTINGS as unknown as typeof AZ_SETTINGS,
    headers: MINI_HEADERS,
    sheetRows: MINI_ROWS,
  });
  await waitForTtsIdle(page);
}

test('① 🔴 저신뢰 「종료」 거절에 부정 비프 1 + 화면 큐 — 집계에도 잡힌다', async ({ page }) => {
  await bootMini(page);
  const before = await rejectBeeps(page);

  await fireStt(page, '종료', 1500, LOW_CONF);
  await waitForTtsIdle(page);

  await expect
    .poll(() => rejectBeeps(page), { timeout: 5000, message: '명령 거절이 집계에 안 잡힌다' })
    .toBe(before + 1);
  await expect(cue(page), '명령이 거절됐는데 화면에 아무 표시가 없다').toBeVisible({ timeout: 3000 });
  await expect(cue(page), '명령이 안 들린 것이지 값 파싱 실패가 아니다')
    .toHaveAttribute('data-reason', 'low_confidence');
  // 거절이므로 실제로 종료되지 않는다(세션 유지) — 재청취 안내로 되돌아온다.
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible();
  expect((await ttsLog(page)).at(-1)).toBe('측정항목01 다시 말씀해 주세요.');
});

test('② 셀 검토 대기에서도 같은 거절 신호 — 문구만 그 상태의 SSOT를 쓴다(#9 보존)', async ({ page }) => {
  await bootMini(page);
  await fireStt(page, '95.5', 1200); // 01 커밋 → 02로 전진
  await waitForTtsIdle(page);
  await fireStt(page, '이전', 1500); // 값 있는 01로 되돌아가 cellWait 착지
  await waitForTtsIdle(page);
  expect((await ttsLog(page)).join(' | '), '전제: cellWait 착지').toContain('기록값');

  const before = await rejectBeeps(page);
  await fireStt(page, '수정', 1500, LOW_CONF_MODIFY);
  await waitForTtsIdle(page);

  await expect.poll(() => rejectBeeps(page), { timeout: 5000 }).toBe(before + 1);
  await expect(cue(page)).toHaveAttribute('data-reason', 'low_confidence');
  expect((await ttsLog(page)).at(-1), '셀 검토 대기에 값을 요구하면 안 된다(#9)')
    .toBe('측정항목01 기록값입니다. 수정이라고 말하세요.');
});

test('③ 대조군 — 접수된 명령(「취소」)은 거절 신호를 내지 않는다(형제 3분기 미편입 근거)', async ({ page }) => {
  await bootMini(page);
  const before = await rejectBeeps(page);

  await fireStt(page, '취소', 1500); // 고신뢰 = 접수된 명령. 같은 칸 재청취.
  await waitForTtsIdle(page);

  expect(await rejectBeeps(page), '접수된 명령에 거절 비프가 나면 집계가 오염된다').toBe(before);
  await expect(cue(page), '접수된 명령에 거절 큐가 뜨면 사용자가 거절로 읽는다').toHaveCount(0);
  // 문구는 §2 쌍 상수로 옮겼을 뿐 바이트가 그대로다.
  expect((await ttsLog(page)).at(-1)).toBe('측정항목01 다시 말씀해 주세요.');
});

test('④ 가드 — 소수 재질문 중의 명령 거절이 소수 문맥을 지우지 않는다(M3 불변식)', async ({ page }) => {
  await bootMini(page);
  await fireStt(page, '111 점 에', 1500); // 소수부 유실 → 정수부 111 보존 타깃 재질문
  await waitForTtsIdle(page);
  await expect(cue(page)).toContainText('111 점, 소수점 아래');

  await fireStt(page, '수정', 1500, LOW_CONF_MODIFY); // 저신뢰 **명령** 거절(R5 뒤에도 0.40 아래)
  await waitForTtsIdle(page);

  // `armRejectCue`의 setReaskReason이 정수부를 함께 지운다 — 되살리지 않으면 여기서 red.
  await expect(cue(page), '명령 거절 입구로 「무고지 합성」이 되살아났다')
    .toContainText('111 점, 소수점 아래');
  await expect(cue(page), '사유는 실제 사유(명령이 안 들렸다)').toHaveAttribute('data-reason', 'low_confidence');
});
