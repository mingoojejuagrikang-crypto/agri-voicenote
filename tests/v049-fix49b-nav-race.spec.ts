/**
 * v0.49 fix49b 오라클 — **항목 이동 경계의 barge-in 레이스** (max 리뷰 2026-08-12 #6)
 *
 * `advance()`는 재안내 **직전마다** `epochRef`를 다시 읽는다(`if (epochRef.current !== startEpoch) return`).
 * 그 가드가 있는 이유는 하나다: `await say(...)` 중에 사용자가 명령을 말하면 그 명령의 핸들러가
 * 상태(행·열·awaiting)를 이미 옮겨 놓은 뒤에 **먼저 시작된 체인이 깨어나** 낡은 좌표로
 * 재무장하기 때문이다(RACE-1).
 *
 * F-1이 신설한 `gotoAdjacentField`는 그 패턴에서 **epoch bump만 복사하고 post-await 재확인은
 * 빠뜨렸다.** 경계 안내(`'첫/마지막 항목입니다.'`)가 유일하게 `await say()` **뒤에** 재무장하는
 * 지점이라 거기만 노출된다.
 *
 * 🔑 이 레이스가 왜 fix49 **이후에** 더 잘 터지는가: H-2 드레인이 `cancelTts()`를 만나면
 *    대기 중인 `say()`를 **즉시** 결말지어 주기 때문에, 낡은 체인이 「엔진이 onend를 줄 때까지」가
 *    아니라 **다음 명령의 처리 도중에** 깨어난다. 방어를 강화한 커밋이 레이스 창을 앞당겼다.
 *
 * 피해는 무음이 아니라 **오귀속**이다 — 사용자는 다음 행에 값을 말했다고 믿는데 낡은 컬럼에
 * 커밋된다. 값 자체는 정상으로 보이므로 시트에서만 뒤늦게 발견된다.
 *
 * Mock: fixtures/stt.
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
      sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_FIX49B_RACE/edit',
      sheetTab: 'Sheet1',
      columnsSheetId: 'SHEET_FIX49B_RACE',
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
      sessionAutoLabel: 'fix49b-race',
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

async function activeChipName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const chip = document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
    return chip?.dataset.colName ?? '';
  });
}

/** 칩은 **활성 행**을 렌더한다 — 이 스펙은 이동 후 그 행에 머문 채 재므로 칩으로 충분하다
 *  (프로덕션 코드에 테스트용 전역을 요구하지 않는다). */
async function chipText(page: Page, colName: string): Promise<string> {
  return page.evaluate((name) => {
    const chip = document.querySelector(`[data-testid="column-chip"][data-col-name="${name}"]`) as HTMLElement | null;
    return chip?.innerText ?? '';
  }, colName);
}

/** 활성 행 번호 — 히어로/상태 영역의 표기에서 읽는다. */
async function activeRowLabel(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="voice-active-state"]') as HTMLElement | null;
    return el?.innerText ?? '';
  });
}

async function speakWhenArmed(page: Page, text: string, waitMs = 500) {
  await waitForTtsIdle(page);
  await fireStt(page, text, waitMs);
}

test.beforeEach(async ({ page }) => {
  // v0.49 r2 — gUM 스텁(`fixtures/gum.ts`, v0.44.1). 없으면 `start()`의 `recorderRef.init()`가
  //   로컬 헤드리스에서 응답하지 않아 「마이크 권한을 확인하는 중…」에서 멈춘다(제품 회귀 아님).
  await page.addInitScript({ content: GUM_GRANT_SCRIPT });
  await installVoiceMocks(page);
});

test('경계 안내 중 「수정」 barge-in이 수정 대상을 낡은 컬럼으로 바꿔치지 않는다 (#6)', async ({ page }) => {
  await seedAndOpenVoiceTab(page);
  await clickStart(page);

  await speakWhenArmed(page, '35.1', 700);   // 횡경 확정 → 종경 대기
  await speakWhenArmed(page, '다음');         // 당도(마지막 항목·빈 칸)
  expect(await activeChipName(page)).toContain('당도');

  // 「다음」 → 경계 안내가 재생되는 **도중에** 「수정」을 말한다.
  await waitForTtsIdle(page);
  await fireStt(page, '다음', 60);
  await fireStt(page, '수정', 1800);
  await waitForTtsIdle(page);

  // 앱은 "수정. 종경."이라고 말했다 — 사용자는 종경을 다시 부른다고 믿는다.
  expect((await ttsLog(page)).join(' | ')).toContain('수정');
  expect(await activeChipName(page), '수정 대상이 낡은 컬럼으로 바꿔치기됐다').toContain('종경');

  await speakWhenArmed(page, '88.8', 1200);
  // 🔴 낡은 continuation이 `announceOrCellWait(당도)`로 재무장하면 사용자의 값이 **당도**에 붙는다.
  //    귀로 들은 안내("수정. 종경.")와 실제 커밋 대상이 갈린다 = 오귀속.
  expect(await chipText(page, '당도'), '값이 낡은 컬럼(당도)에 오귀속됐다').not.toContain('88.8');
  expect(await chipText(page, '종경'), '앱이 말한 대상(종경)에 값이 안 들어갔다').toContain('88.8');
});

test('경계 안내 중 「다음행」 barge-in은 낡은 컬럼으로 재무장하지 않는다 (#6)', async ({ page }) => {
  await seedAndOpenVoiceTab(page);
  await clickStart(page);

  // 커서를 1행 **마지막** 항목(당도)에 세운다 — 경계 안내를 내려면 끝에 서 있어야 한다.
  await speakWhenArmed(page, '다음');
  await speakWhenArmed(page, '다음');
  expect(await activeChipName(page)).toContain('당도');

  // 「다음」 → 경계라 '마지막 항목입니다.' TTS가 시작된다. **끝나기를 기다리지 않고**
  //   곧바로 「다음행」을 말한다(현장에서 흔한 barge-in — 안내를 끝까지 듣지 않는다).
  await waitForTtsIdle(page);
  await fireStt(page, '다음', 60);
  await fireStt(page, '다음행', 1800);
  await waitForTtsIdle(page);

  expect((await ttsLog(page)).join(' | ')).toContain('마지막 항목입니다');

  // 행은 실제로 넘어갔다 — 그러니 사용자가 2행에 말한다고 믿는 것은 옳다.
  expect(await activeRowLabel(page)).toContain('2');
  // 낡은 continuation이 이겼는지는 **커서가 어디에 재무장됐는가**로 먼저 드러난다.
  expect(await activeChipName(page), '커서가 낡은 컬럼(당도)에 재무장됐다 — post-await epoch 가드 부재').toContain('횡경');

  // 사용자는 이제 **2행의 첫 항목**을 말한다고 믿는다(행 이동 안내를 들었다).
  await speakWhenArmed(page, '77.7', 1200);

  // 🔴 경계 continuation이 낡은 `curIdx`(당도)로 살아 돌아오면 값이 그 칸에 붙는다.
  //    무음도 오류도 아니고 **정상처럼 보이는 오귀속**이라 시트에서만 뒤늦게 드러난다.
  expect(await chipText(page, '당도'), '낡은 컬럼(당도)에 값이 오귀속됐다').not.toContain('77.7');
  expect(await chipText(page, '횡경'), '사용자가 의도한 칸(2행 횡경)에 값이 없다').toContain('77.7');
});
