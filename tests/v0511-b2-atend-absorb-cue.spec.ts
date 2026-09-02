/**
 * v0.51.1 B2 오라클 (제보② 2026-09-02 15:50 「마지막 값 뒤 수정 명령 안 됨」 · read-fb F3).
 *
 * 형상: 끝 도달(atEnd)에서 「수정」이 STT '회'(conf 0.243)로 와 명령 미매치 → `absorbAtEnd`가 **무로그·무신호**로
 * 흡수 → 끝 도달 안내만 반복. 끝 도달 안내에는 조작 어휘가 없어(W2) 사용자는 「수정이 안 먹는다」만 겪었다.
 *
 * 이 스펙이 고정하는 문장:
 *  ① atEnd에서 명령이 아닌 발화가 흡수되면 **「못 알아들었다」 신호가 먼저** 난다 — 부정 비프 1 + 화면 큐
 *     (「소리가 불확실」, 저신뢰 명령 거절 M11과 같은 종단) + 로그 `command parsed=end_absorb` 1줄. 끝 도달
 *     안내는 그대로 뒤따른다.
 *  ② 회귀 — 제대로 들린 「수정」은 종전대로 dispatch된다(흡수 로그 0 · 수정 진입 TTS).
 *
 * 🔴 반증(2026-09-02 실측): `useFinalValueGate` atEnd 갈래의 `armRejectCue`+`logCell`을 종전(`setReaskReason(null)`)
 *    으로 되돌리면 ① red · ②는 green(회귀 대조군).
 * Mock: fixtures/activeZones(boot) · fixtures/stt. 픽스처는 `v049-r4-m11-command-reject`와 같은 1행·2열.
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
  state: { ...AZ_SETTINGS.state, columns: MINI_COLUMNS, totalRows: 1, sessionAutoLabel: 'b2-atend' },
};
const MINI_HEADERS = ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02'];
const MINI_ROWS = [[PREV_ROUND, '이원창', '1', '100.0', '']];

/** 제보② 원문: 「수정」이 '회' conf 0.243으로 왔다. */
const MISHEARD = { text: '회', conf: 0.243 };
const END_REACHED = '마지막행 입력. 이번 세션에 완료된 행은 1행.';

type LogEv = { type: string; parsed?: string; extra?: string; text?: string };

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

const rejectBeeps = async (page: Page) => (await loadLogEvents(page))
  .filter((e) => e.type === 'app' && String(e.extra ?? '').startsWith('beep_play:kind=reject')).length;
const endAbsorbs = async (page: Page) => (await loadLogEvents(page))
  .filter((e) => e.type === 'command' && e.parsed === 'end_absorb');
const cue = (page: Page) => page.locator('[data-testid="reask-cue"]');

/** 1행·2열을 완주해 atEnd에 선다. */
async function bootToAtEnd(page: Page) {
  await boot(page, PHONE_402, {
    settings: MINI_SETTINGS as unknown as typeof AZ_SETTINGS,
    headers: MINI_HEADERS,
    sheetRows: MINI_ROWS,
  });
  await waitForTtsIdle(page);
  await fireStt(page, '95.5', 1200);
  await waitForTtsIdle(page);
  await fireStt(page, '40.2', 1800);
  await waitForTtsIdle(page);
  expect((await ttsLog(page)).at(-1), '전제: 끝 도달 안내가 났다').toBe(END_REACHED);
  // 전제: 흡수 전에는 큐가 없다(착지·커밋이 지웠다).
  await expect(cue(page)).toHaveCount(0);
}

test('① atEnd에서 오인식 발화(「회」 0.243)가 흡수되면 부정 비프 + 화면 큐 + end_absorb 로그 1줄, 끝 도달 안내는 뒤따른다', async ({ page }) => {
  await bootToAtEnd(page);
  const beepsBefore = await rejectBeeps(page);
  const ttsBefore = (await ttsLog(page)).length;

  await fireStt(page, MISHEARD.text, 1500, MISHEARD.conf);
  await waitForTtsIdle(page);

  await expect
    .poll(() => rejectBeeps(page), { timeout: 5000, message: '흡수가 여전히 무신호다 — 「수정이 안 먹는다」가 그대로다' })
    .toBe(beepsBefore + 1);
  await expect(cue(page), '흡수됐는데 화면에 아무 표시가 없다').toBeVisible({ timeout: 3000 });
  await expect(cue(page), '저신뢰 명령 거절(M11)과 같은 계열 큐').toHaveAttribute('data-reason', 'low_confidence');

  const absorbed = await endAbsorbs(page);
  expect(absorbed.length, '흡수 로그가 정확히 1줄이어야 판독이 센다').toBe(1);
  expect(absorbed[0].extra, 'cell_wait_absorb와 같은 꼴 — end_absorb:<colId>').toMatch(/^end_absorb:m[12]$/);
  expect(absorbed[0].text, '무엇을 흡수했는지가 남는다').toBe(MISHEARD.text);

  // 끝 도달 안내는 유지되되 **큐 뒤에** 난다(비프가 먼저 — 확인음→말 순서 계약).
  const after = (await ttsLog(page)).slice(ttsBefore);
  expect(after, '흡수 안내 재발화가 사라졌다').toContain(END_REACHED);
  // 사유 TTS(「소리가 불확실.」)는 붙이지 않는다 — 큐는 비프+화면이고 귀에는 끝 도달 안내만 간다([TTS-WATCHDOG-1] 길이).
  expect(after.some((t) => t.startsWith('소리가 불확실')), '사유 TTS가 끼어들었다').toBe(false);
});

test('② 회귀 — 제대로 들린 「수정」은 종전대로 dispatch된다(흡수 로그 0 · 수정 진입 TTS)', async ({ page }) => {
  await bootToAtEnd(page);
  const beepsBefore = await rejectBeeps(page);

  await fireStt(page, '수정', 1500);
  await waitForTtsIdle(page);

  expect((await endAbsorbs(page)).length, '접수된 명령이 흡수로 찍히면 판독이 오염된다').toBe(0);
  expect(await rejectBeeps(page), '접수된 명령에 거절 비프가 나면 안 된다(M11 ③)').toBe(beepsBefore);
  const last = (await ttsLog(page)).at(-1) ?? '';
  expect(last, '「수정」이 atEnd에서 안 먹는다').toMatch(/^수정/);
});
