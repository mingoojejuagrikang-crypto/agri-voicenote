/**
 * v0.51.1 B3 콜사이트 e2e 오라클 (제보③ 2026-09-02 15:54 「과피두께 TTS 42.2 · 칩 12.2」 · read-fb F2).
 *
 * 단위 오라클(`tts-column-name.spec.ts` B3 블록)은 `formatNameForTts`만 잰다. 이 파일은 **배선 둘**을 잰다:
 *  ⓐ 수정 확인 TTS의 원문에 꼬리 `x4`가 없고, 이름과 값 사이에 **쉼표(짧은 휴지)**가 있다
 *     (`수정 과피두께, 13.3` — 직접 수정 `useVoiceSession` 콜사이트).
 *  ⓑ 진입 안내를 포함해 **발화 전량**에 `x4`가 새지 않는다(「과피두께x4.」 안내 96회의 그 자리).
 *  ⓒ 화면 칩은 원문 「과피두께x4」 그대로다(귀는 축약, 눈은 원문 — 괄호 변경과 같은 계약).
 *
 * 🔴 반증(2026-09-02 실측): `formatNameForTts`의 꼬리 치환을 빼면 ⓐ·ⓑ red · ⓒ green. 콜사이트의 쉼표를 빼면 ⓐ만 red.
 * Mock: fixtures/activeZones(boot) · fixtures/stt. 픽스처 컬럼명은 실 시트 `품질조사`의 원문이다.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, ttsLog, waitForTtsIdle } from './fixtures/stt';

test.setTimeout(120_000);

const TAIL_COLUMNS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '양훈성' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'm1', name: '과피두께x4', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  { id: 'm2', name: '당도', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];
const TAIL_SETTINGS = {
  ...AZ_SETTINGS,
  state: { ...AZ_SETTINGS.state, columns: TAIL_COLUMNS, totalRows: 2, sessionAutoLabel: 'b3-tail' },
};
const HEADERS = ['조사일자', '농가명', '조사나무', '과피두께x4', '당도'];
const ROWS = [
  [PREV_ROUND, '양훈성', '1', '9.0', '8.5'],
  [PREV_ROUND, '양훈성', '2', '9.0', '8.5'],
];

const bootTail = (page: Page) => boot(page, PHONE_402, {
  settings: TAIL_SETTINGS as unknown as typeof AZ_SETTINGS,
  headers: HEADERS,
  sheetRows: ROWS,
});

test('ⓐ+ⓑ 수정 확인 TTS는 「수정 과피두께, 13.3」 — 꼬리 x4 없음·쉼표 있음 · 발화 전량에 x4가 새지 않는다', async ({ page }) => {
  await bootTail(page);
  await waitForTtsIdle(page);
  // 1행 첫 항목(과피두께x4) 커밋 → 당도로 전진.
  await fireStt(page, '12.2', 1200);
  await waitForTtsIdle(page);
  // 직접 수정 「수정 13.3」 → 직전 항목(과피두께x4)을 고친다 → 수정 확인 TTS(useVoiceSession 콜사이트).
  await fireStt(page, '수정 13.3', 1800);
  await waitForTtsIdle(page);

  const log = await ttsLog(page);
  expect(log.some((t) => t === '수정 과피두께, 13.3'),
    `수정 확인 TTS 원문이 「수정 과피두께, 13.3」이 아니다: ${JSON.stringify(log.filter((t) => t.startsWith('수정')))}`)
    .toBe(true);
  const leaked = log.filter((t) => /x\s*4/i.test(t) || /×\s*4/.test(t));
  expect(leaked, `꼬리 x4가 귀로 샜다: ${JSON.stringify(leaked)}`).toEqual([]);
  // 🔴 과잉 통과 방지 — 항목명이 실제로 발화된 로그가 있어야 이 단언이 공허하지 않다.
  expect(log.some((t) => /^과피두께/.test(t)), '전제: 진입 안내가 축약본 이름으로 났다').toBe(true);
});

test('ⓒ 화면 칩은 원문 「과피두께x4」 그대로다 — 축약이 눈으로 새지 않는다', async ({ page }) => {
  await bootTail(page);
  const chips = await page.evaluate(() => {
    const els = [...document.querySelectorAll('[data-testid="column-chip"]')] as HTMLElement[];
    return els.map((e) => e.dataset.colName ?? e.innerText.trim());
  });
  expect(chips.join(' | '), '화면 칩이 원문 꼬리를 잃었다 — 축약이 화면 표면까지 샜다').toContain('과피두께x4');
});
