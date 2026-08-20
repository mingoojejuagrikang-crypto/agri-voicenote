/**
 * 🔴 v0.49 r4 M3 오라클(claude r3 #3) — **거절이 소수부 재질문 문맥을 조용히 지우지 않는다.**
 *
 * r3 #6이 거절 종단을 단일화하면서 신규 편입한 두 분기(컬럼명 일치 · KNOWN_NOISE)에 소수 문맥
 * 가드가 없었다. 그 상태에서 소수부 타깃 재질문 중 컬럼명/잡음어가 들어오면:
 *   ① `armRejectCue`의 `setReaskReason`이 `reaskDecimalWhole`을 **함께 지운다**(store 계약) →
 *      화면 큐가 「111 점, 소수점 아래…」에서 일반 사유로 바뀐다.
 *   ② TTS도 일반 사유만 읽는다.
 *   ③ 그런데 `awaiting.fractionWhole`은 **살아 있다** → 다음 '오'가 `111.5`로 합성 커밋된다.
 *   👉 화면·귀 어디에도 「아직 소수부를 기다린다」가 없는데 값은 합성된다 — **무고지 커밋**.
 * KNOWN_NOISE는 추가로 `startClip()`을 무조건 불러 [CLIP-DECIMAL-FRAG-1](소수 재질문 중 클립
 * 재시작 금지 — 원본 전체발화 버퍼 폐기)까지 어겼다.
 *
 * ③은 **리뷰가 지목하지 않은 세 번째 구멍**이다(재검증 중 발견): 저신뢰 거절도 소수 문맥에서
 * 도달하며 같은 두 결함을 그대로 갖고 있었다. 처방을 분기가 아니라 **종단**(`rejectValue`)에
 * 둔 이유가 이것이다.
 *
 * ④는 무회귀 대조군 — 소수 문맥이 **아니면** 종전대로 사유 문구를 읽는다(r3 #6 계약).
 *
 * ⚠️ **클립 축은 여기서 재지 않는다.** `fixtures/activeZones`의 fake 트랙은 진짜 MediaStream이
 * 아니라 `MediaRecorder`가 던지고 `clip_started`가 **한 건도 안 나온다**(fixtures/gum.ts 헤더:
 * *"클립 바이트 검증에는 못 쓴다"*). 여기서 `clip_started` 증가 0을 단언하면 항상 참인 공허한
 * 단언이 된다. [CLIP-DECIMAL-FRAG-1] 축은 스텁 레코더를 가진 그 계약의 본가
 * `tests/clip-decimal-frag.spec.ts`에 같은 커밋으로 추가했다.
 *
 * 반증(종단의 문맥 판정 제거 시): ①②③ red(큐·TTS가 일반 사유로 바뀐다).
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
  state: { ...AZ_SETTINGS.state, columns: MINI_COLUMNS, totalRows: 1, sessionAutoLabel: 'r4-m3' },
};
const MINI_HEADERS = ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02'];
const MINI_ROWS = [[PREV_ROUND, '이원창', '1', '100.0', '']];

/** 정수부 111의 소수부 타깃 재질문 문구(voicePrompts.decimalReaskPrompt와 같은 바이트). */
const DECIMAL_PROMPT = '111 점, 소수점 아래 숫자만 말씀해 주세요.';

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

async function persistedRow1(page: Page) {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const sessions: Array<{ startedAt: number; rows: Array<{ index: number; values: Record<string, string> }> }> =
      await new Promise((resolve, reject) => {
        const req = db.transaction('sessions', 'readonly').objectStore('sessions').getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    db.close();
    const latest = sessions.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0];
    return latest?.rows.find((r) => r.index === 1) ?? null;
  });
}

async function bootMini(page: Page) {
  await boot(page, PHONE_402, {
    settings: MINI_SETTINGS as unknown as typeof AZ_SETTINGS,
    headers: MINI_HEADERS,
    sheetRows: MINI_ROWS,
  });
  await waitForTtsIdle(page);
}

/** "111 점 에" → 소수부 유실 → 정수부 111 보존 타깃 재질문(v0.10.0 A1 경로). */
async function enterDecimalReask(page: Page) {
  await fireStt(page, '111 점 에', 1500);
  await waitForTtsIdle(page);
  await expect(cue(page), '전제: 소수 재질문 큐').toBeVisible({ timeout: 4000 });
  await expect(cue(page)).toContainText(DECIMAL_PROMPT);
}

/** 한 거절 분기를 소수 문맥에서 유도하고 **문맥이 살아 있음을 고지하는지** 잰다. */
async function expectFractionAwareReject(
  page: Page,
  utterance: string,
  reason: 'parse_failed' | 'low_confidence',
  confidence = 0.95,
) {
  const beepsBefore = await rejectBeeps(page);
  await fireStt(page, utterance, 1500, confidence);
  await waitForTtsIdle(page);

  // 거절 종단은 그대로 — 비프는 난다(r3 #6 계약 무회귀).
  await expect
    .poll(() => rejectBeeps(page), { timeout: 5000, message: `「${utterance}」 거절에 부정 비프가 없다` })
    .toBe(beepsBefore + 1);
  // 🔴 화면·귀 둘 다 **소수 문맥**을 말해야 한다. 종전엔 둘 다 일반 사유로 바뀌었다.
  await expect(cue(page), `「${utterance}」 뒤 큐가 사라졌다`).toBeVisible({ timeout: 3000 });
  await expect(cue(page), `「${utterance}」 뒤 소수 문맥이 화면에서 지워졌다`).toContainText(DECIMAL_PROMPT);
  await expect(cue(page), '사유 자체는 실제 사유를 그대로 싣는다').toHaveAttribute('data-reason', reason);
  expect((await ttsLog(page)).at(-1), `「${utterance}」 뒤 TTS가 소수 문맥을 안 말한다`).toBe(DECIMAL_PROMPT);
}

/** 문맥이 살아 있다는 것의 최종 확인 — 조각 '오'가 111.5로 합성되어 IDB에 선다. */
async function expectFractionStillSynthesises(page: Page) {
  await fireStt(page, '오', 1800);
  await waitForTtsIdle(page);
  await expect
    .poll(async () => (await persistedRow1(page))?.values.m1, { timeout: 8000 })
    .toBe('111.5');
}

test('① 소수 재질문 중 컬럼명 거절 — 문맥을 그대로 고지한다', async ({ page }) => {
  await bootMini(page);
  await enterDecimalReask(page);
  await expectFractionAwareReject(page, '측정항목02', 'parse_failed');
  await expectFractionStillSynthesises(page);
});

test('② 소수 재질문 중 KNOWN_NOISE 거절 — 문맥을 그대로 고지한다', async ({ page }) => {
  await bootMini(page);
  await enterDecimalReask(page);
  await expectFractionAwareReject(page, '변경', 'parse_failed');
  await expectFractionStillSynthesises(page);
});

test('③ 소수 재질문 중 **저신뢰** 거절(리뷰 미지목 세 번째 구멍) — 같은 계약', async ({ page }) => {
  await bootMini(page);
  await enterDecimalReask(page);
  await expectFractionAwareReject(page, '콜록', 'low_confidence', 0.2);
  await expectFractionStillSynthesises(page);
});

test('④ 대조군 — 소수 문맥이 아니면 종전대로 사유 문구를 읽는다(r3 #6 무회귀)', async ({ page }) => {
  await bootMini(page);
  const beepsBefore = await rejectBeeps(page);
  await fireStt(page, '변경', 1500);
  await waitForTtsIdle(page);

  await expect.poll(() => rejectBeeps(page), { timeout: 5000 }).toBe(beepsBefore + 1);
  await expect(cue(page)).toHaveAttribute('data-reason', 'parse_failed');
  await expect(cue(page)).toContainText('숫자로 인식 실패');
  expect((await ttsLog(page)).at(-1)).toBe('숫자로 인식 실패.');
});
