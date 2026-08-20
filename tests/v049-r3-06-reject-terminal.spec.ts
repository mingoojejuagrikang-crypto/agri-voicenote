/**
 * v0.49 r3 #6 오라클 — **거절 여섯 분기가 하나의 종단을 쓴다**(claude r2 MEDIUM).
 *
 * 거절은 한 벌의 신호다: 화면 큐(`ReaskCue` 사유) + 부정 비프 + 사유 TTS(§2 쌍 상수 `REASK_TTS`).
 * B2는 그중 **뒤 2개 분기**(저신뢰·파싱 실패)에만 배선했고, 앞 4개는 무비프 + W2 개정 **이전의**
 * 인라인 리터럴("{항목} 다시 말씀해 주세요.")을 그대로 읽었다:
 *
 *   ① 컬럼명 완전 일치(`stt_rejected_col_name`)
 *   ② KNOWN_NOISE 동음이의(`known_noise`)
 *   ③ bare 응답어(`response_word` — "예/네")
 *   ④ 단음절 동음이의(`ambiguous_syllable` — "이"→2)
 *
 * 피해는 둘이다: ⓐ 같은 사건이 **어느 분기로 들어오느냐에 따라** 소리와 문구가 갈린다(PRINCIPLES
 * §2 — 구조적 분리는 쌍 상수로만) ⓑ `beep_play:kind=reject` 집계가 실제 거절의 일부만 세어
 * 다음 회차의 거절률 모수가 조용히 축소된다.
 *
 * B2-r2 오라클(`v023-voice.spec.ts`)이 못 잡은 이유: 두 분기만 발화로 유도했다. 이 스펙은
 * **네 분기를 각각 발화로 유도**하고 세 신호를 함께 잰다.
 *
 * 반증(`rejectValue`/`armRejectCue` 호출을 종전 인라인 3줄로 되돌리면): ①~④ 전부 red.
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
  state: { ...AZ_SETTINGS.state, columns: MINI_COLUMNS, totalRows: 1, sessionAutoLabel: 'r3-06' },
};
const MINI_HEADERS = ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02'];
const MINI_ROWS = [[PREV_ROUND, '이원창', '1', '100.0', '']];

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

/** `beep_play:kind=reject` 재생 계측 집계(v023-voice B2-r2와 같은 채널). */
async function rejectBeeps(page: Page): Promise<number> {
  const events = await loadLogEvents(page);
  return events.filter((e) => e.type === 'app' && String(e.extra ?? '').startsWith('beep_play:kind=reject')).length;
}

const cue = (page: Page) => page.locator('[data-testid="reask-cue"]');

async function bootMini(page: Page) {
  await boot(page, PHONE_402, {
    settings: MINI_SETTINGS as unknown as typeof AZ_SETTINGS,
    headers: MINI_HEADERS,
    sheetRows: MINI_ROWS,
  });
}

/** 한 거절 분기를 유도하고 **세 신호를 함께** 잰다(비프 증가 · 큐 사유 · §2 TTS 바이트). */
async function expectRejectTerminal(page: Page, utterance: string, before: number) {
  await fireStt(page, utterance, 1500);
  await waitForTtsIdle(page);
  // #13 계약 — IDB 로그 쓰기는 fire-and-forget이라 도달은 **기다린다**(비재시도 읽기 금지).
  await expect
    .poll(() => rejectBeeps(page), { timeout: 5000, message: `「${utterance}」 거절에 부정 비프가 없다` })
    .toBe(before + 1);
  await expect(cue(page), `「${utterance}」 거절에 화면 큐가 없다`).toBeVisible({ timeout: 3000 });
  await expect(cue(page)).toHaveAttribute('data-reason', 'parse_failed');
  expect((await ttsLog(page)).at(-1), `「${utterance}」 거절이 W2 이전 문구를 읽는다`)
    .toBe('숫자로 인식 실패.');
}

test('① 컬럼명 완전 일치 거절도 비프·큐·§2 TTS를 낸다', async ({ page }) => {
  await bootMini(page);
  await waitForTtsIdle(page);
  await expectRejectTerminal(page, '측정항목02', await rejectBeeps(page));
});

test('② KNOWN_NOISE 동음이의 거절도 같은 종단을 쓴다', async ({ page }) => {
  await bootMini(page);
  await waitForTtsIdle(page);
  await expectRejectTerminal(page, '변경', await rejectBeeps(page));
});

test('③ bare 응답어("예") 거절도 같은 종단을 쓴다 [O2/STT-17]', async ({ page }) => {
  await bootMini(page);
  await waitForTtsIdle(page);
  await expectRejectTerminal(page, '예', await rejectBeeps(page));
});

test('④ 단음절 동음이의("이") 거절도 같은 종단을 쓴다 [T-3]', async ({ page }) => {
  await bootMini(page);
  await waitForTtsIdle(page);
  await expectRejectTerminal(page, '이', await rejectBeeps(page));
});

test('⑤ 네 분기를 연속으로 겪으면 reject 비프가 정확히 4회 는다 — 지표 과소집계 차단', async ({ page }) => {
  await bootMini(page);
  await waitForTtsIdle(page);
  const before = await rejectBeeps(page);
  for (const u of ['측정항목02', '변경', '예', '이']) {
    await fireStt(page, u, 1200);
    await waitForTtsIdle(page);
  }
  await expect
    .poll(() => rejectBeeps(page), { timeout: 6000, message: '거절 4건인데 비프가 모자란다' })
    .toBe(before + 4);
  // 과다 재생은 안정화 창으로 — 늘려도 red가 안 되는 방향이다(#13의 flake 방향과 반대).
  await page.waitForTimeout(300);
  expect(await rejectBeeps(page), '거절 1건당 비프 1회를 넘었다').toBe(before + 4);
  // 값은 하나도 서지 않았다 — 거절 경로가 커밋을 열어 주면 안 된다(가드).
  const events = await loadLogEvents(page);
  expect(events.some((e) => e.type === 'value'), '거절 경로에서 값이 커밋됐다').toBe(false);
});
