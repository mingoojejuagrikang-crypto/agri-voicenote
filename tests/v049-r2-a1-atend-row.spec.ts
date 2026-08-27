/**
 * v0.49 r2 A1 오라클 — **atEnd 센티넬의 행은 `activeRow`다**(리뷰 합집합 C1).
 *
 * 끝 도달(atEnd)은 「아래로 미완료 행이 없다」는 뜻일 뿐 「마지막 행에 서 있다」는 뜻이 아니다:
 * `advance()`의 `findNextIncompleteRow(row+1, total)`는 **아래 방향만** 본다(wrap 없음). 그래서
 * 사용자가 순서 밖으로 완주하면(3행을 먼저 끝내고 되돌아와 2행을 끝내면) 끝 도달 시점의
 * `activeRow`는 2행인데, 센티넬은 `row: total`(3행)로 고정돼 있었다.
 *
 * 이 스펙이 고정하는 문장:
 *   🔑 **끝 도달 후의 '수정'은 사용자가 서 있는 행을 고친다.** 다른 행의 확정값을 지우고
 *      그 행을 미완료로 되돌리지 않는다.
 *
 * 왜 데이터 사건인가: bare '수정'은 대상 셀을 비우고 `markRowIncomplete(targetRow)`를 부른다.
 * 센티넬이 남의 행을 가리키면 **사용자가 손대지 않은 완료 행이 미완료로 되돌아가고**(그 값은
 * 화면에서 사라진다), 정작 고치려던 칸은 그대로 남는다. 여기서 세션을 끝내면 시트에는 지워진
 * 값이 빈칸으로 간다.
 *
 * 픽스처 골격은 `v049-fix49b-cellwait-surface.spec.ts`와 같다(voice 컬럼 3개 · 3행) —
 * 같은 상태를 다른 축에서 재는 스펙끼리 픽스처가 갈리면 비교가 안 된다.
 *
 * Mock: fixtures/stt · fixtures/gum([TEST-GUM-1] — 세션 시작 스펙은 gUM 스텁 필수).
 */

import { test, expect, type Page } from '@playwright/test';
import { installVoiceMocks, fireStt, ttsLog, waitForTtsIdle } from './fixtures/stt';
import { GUM_GRANT_SCRIPT } from './fixtures/gum';
import { BASE } from './baseUrl';

test.setTimeout(120_000);

const STORE_KEY = 'agri-voicenote-settings-v3';
const TOTAL_ROWS = 3;

function settings() {
  return {
    state: {
      chipSweepSeconds: 0,
      googleConnected: false,
      userEmail: null,
      sheet: null,
      sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_R2A1/edit',
      sheetTab: 'Sheet1',
      columnsSheetId: 'SHEET_R2A1',
      columnsSheetTab: 'Sheet1',
      availableSheets: [],
      manualMode: false,
      columns: [
        { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: TOTAL_ROWS } },
        { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
        { id: 'c9', name: '종경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
        { id: 'c11', name: '당도', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
      ],
      tableGenerated: true,
      totalRows: TOTAL_ROWS,
      ttsRate: 1.05,
      sessionLabelColId: null,
      sessionAutoLabel: 'r2a1',
      noisyMode: false,
      preferredVoiceName: '',
    },
    version: 13,
  };
}

async function seedAndOpenVoiceTab(page: Page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ st, storeKey }) => {
      localStorage.clear();
      localStorage.setItem(storeKey, JSON.stringify(st));
      indexedDB.deleteDatabase('agri-voicenote');
    },
    { st: settings(), storeKey: STORE_KEY },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(300);
}

async function clickStart(page: Page) {
  const startBtn = page.locator('text=음성 입력 시작').first();
  await expect(startBtn).toBeVisible();
  await startBtn.click();
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 6000 });
  await page.waitForTimeout(400);
}

async function speakWhenArmed(page: Page, text: string, waitMs = 700) {
  await waitForTtsIdle(page);
  await fireStt(page, text, waitMs);
}

async function activeRow(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="active-row"]') as HTMLElement | null;
    return el?.innerText?.trim() ?? '';
  });
}

async function chipText(page: Page, colName: string): Promise<string> {
  return page.evaluate((name) => {
    const chip = document.querySelector(`[data-testid="column-chip"][data-col-name="${name}"]`) as HTMLElement | null;
    return chip?.innerText ?? '';
  }, colName);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript({ content: GUM_GRANT_SCRIPT });
  await installVoiceMocks(page);
});

test('① 순서 밖 완주 후의 bare 「수정」은 서 있는 행을 고친다 — 남의 완료 행을 되돌리지 않는다 (C1)', async ({ page }) => {
  await seedAndOpenVoiceTab(page);
  await clickStart(page);

  // 1행 완주 → 자동 전진(2행).
  await speakWhenArmed(page, '35.1');
  await speakWhenArmed(page, '42.5');
  await speakWhenArmed(page, '50.0', 1500);
  expect(await activeRow(page), '1행 완료 후 2행으로 전진해야 한다').toBe('2');

  // 2행을 건너뛰고 3행을 먼저 완주한다 — **순서 밖 완주**. 여기서 이미 끝 도달이다
  // (아래로 미완료 행이 없다 — 위쪽 2행은 `empties`로 남는다).
  await speakWhenArmed(page, '다음행', 1500);
  expect(await activeRow(page)).toBe('3');
  await speakWhenArmed(page, '11.1');
  await speakWhenArmed(page, '22.2');
  await speakWhenArmed(page, '33.3', 1800);
  // 🔴 v0.49 r2 A12(codex F5) — **빈 행 꼬리의 바이트**를 여기서 잠근다(꼬리가 붙는 유일한
  //   분기라 다른 스펙에는 관측점이 없다). 이 시점: 1·3행 완료 · 2행 비어 있음.
  const firstEnd = (await ttsLog(page)).filter((t) => t.startsWith('마지막행 입력'));
  expect(firstEnd.length, '3행 완주로 끝 도달에 들어가야 한다').toBeGreaterThan(0);
  expect(firstEnd[0]).toBe('마지막행 입력. 이번 세션에 완료된 행은 2행. 2행이 비어 있습니다.');

  // 되돌아와 2행을 마저 채운다 → 끝 도달 **재진입**. 이때 사용자는 2행에 서 있다.
  await speakWhenArmed(page, '이전행', 1500);
  expect(await activeRow(page)).toBe('2');
  await speakWhenArmed(page, '61.1');
  await speakWhenArmed(page, '62.2');
  await waitForTtsIdle(page);
  const beforeEnd = (await ttsLog(page)).length;
  await speakWhenArmed(page, '63.3', 1800);
  await waitForTtsIdle(page);
  const endLines = (await ttsLog(page)).slice(beforeEnd).filter((t) => t.startsWith('마지막행 입력'));
  expect(endLines.length, '2행 완주로 끝 도달에 재진입해야 한다').toBeGreaterThan(0);
  // 🔴 v0.49 r2 A12(codex F5) — 전체 바이트로 잠근다. 세 행 모두 완료라 **빈 행 꼬리가 없다**.
  expect(endLines[0]).toBe('마지막행 입력. 이번 세션에 완료된 행은 3행.');

  // 마지막으로 말한 값(2행 당도 63.3)이 틀렸다 → '수정'.
  await speakWhenArmed(page, '수정', 1200);

  // 🔴 센티넬이 `total`(3행)이면 여기서 3행 당도가 지워지고 3행이 미완료로 되돌아간다.
  //    사용자는 2행에 서 있었고, 2행의 값을 고치겠다고 말했다.
  expect(await activeRow(page), "끝 도달 '수정'이 사용자가 서 있지 않은 행을 열었다").toBe('2');
  expect(await chipText(page, '당도'), '수정 대상 셀은 비워져 재기록을 기다려야 한다').not.toContain('63.3');

  // 재기록은 2행에 들어간다.
  await speakWhenArmed(page, '64.4', 1800);
  expect(await chipText(page, '당도')).toContain('64.4');

  // 🔑 손대지 않은 3행은 **완료 상태 그대로**여야 한다. 완료 행 착지(reviewWait)의 값 낭독이
  //    그 증인이다 — 미완료로 되돌아갔다면 낭독 대신 값 재질문이 나온다.
  await waitForTtsIdle(page);
  const beforeJump = (await ttsLog(page)).length;
  await speakWhenArmed(page, '다음행', 1800);
  await waitForTtsIdle(page);
  const spoken = (await ttsLog(page)).slice(beforeJump).join(' | ');
  expect(await activeRow(page)).toBe('3');
  expect(spoken, '3행이 미완료로 되돌아갔다 — 남의 행을 지웠다').toContain('3행 완료됨');
  expect(spoken, '3행 당도의 확정값이 사라졌다').toContain('33.3');
  expect(spoken, '재기록값이 3행에 들어갔다 — 수정이 남의 행을 만졌다').not.toContain('64.4');
});
