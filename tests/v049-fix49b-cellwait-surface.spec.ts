/**
 * v0.49 fix49b 오라클 — **cellWait 표면의 통합 불변식** (max 리뷰 2026-08-12 #4·#7·#8·#9)
 *
 * fix49가 신설한 `cellWait`(값 있는 셀에 항목 이동으로 착지 = 값 낭독 + 명령 대기)은
 * **상태만 만들고 그 상태의 표면을 다 채우지 못했다.** 새 상태를 하나 만들면 그 상태로
 * 들어오고 나가는 모든 문에 대칭 처리가 필요한데, 리뷰가 네 개의 미봉 지점을 찾았다.
 *
 * 이 스펙이 고정하는 **하나의 문장**:
 *   🔑 **cellWait에서의 모든 탈출은 cellWait 재진입이다.**
 *   (음성 「수정 <값>」 · bare 「수정」 후 재기록 · 키패드 재커밋 — 셋 다 「그 셀을 고치고
 *    그 셀의 검토 대기로 돌아온다」. 사용자가 **의도적으로 navigate해 들어온** 검토 문맥을
 *    그 문맥이 초대한 정정 자체가 파괴하면 안 된다.)
 * 그리고 그 상태가 말하는 **안내 문구는 실제 동작과 일치해야 한다**(v0.47.0 V-FIX4 —
 * 이 앱은 문구를 계약으로 다룬다. 폰이 2~3m 떨어져 있으면 문구가 유일한 조작 설명서다).
 *
 *   ① bare 「수정」은 **그 셀 하나만** 재기록한다 — 뒤 칸의 확정값을 캐스케이드로 지우지 않는다(#4)
 *   ② 키패드 재커밋도 cellWait으로 복귀한다 — 검토 문맥이 정정으로 파괴되지 않는다(#7)
 *   ③ 완료 행 흡수 안내는 **실제로 먹히는 어휘**를 가르친다(#8 — F-1 어휘 재배정 미이관)
 *   ④ cellWait의 「취소」는 값을 요구하지 않는다 — 흡수가 거부할 말을 시키지 않는다(#9)
 *
 * B-1 본계약(덮어쓰기 금지) 자체는 `v049-fix49-cell-guard.spec.ts`가 잰다 — 여기는 그
 * 상태의 **표면**이다.
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

/** cell-guard 스펙과 **같은 골격**(voice 컬럼 3개) — 두 스펙이 같은 상태를 다른 축에서 재므로
 *  픽스처가 갈리면 비교가 안 된다. */
function settings(extra?: Record<string, unknown>) {
  return {
    state: {
      chipSweepSeconds: 0,
      googleConnected: false,
      userEmail: null,
      sheet: null,
      sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_FIX49B/edit',
      sheetTab: 'Sheet1',
      columnsSheetId: 'SHEET_FIX49B',
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
      sessionAutoLabel: 'fix49b',
      noisyMode: false,
      preferredVoiceName: '',
      ...extra,
    },
    version: 13,
  };
}

async function seedAndOpenVoiceTab(page: Page, s: ReturnType<typeof settings> = settings()) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ st, storeKey }) => {
      localStorage.clear();
      localStorage.setItem(storeKey, JSON.stringify(st));
      indexedDB.deleteDatabase('agri-voicenote');
    },
    { st: s, storeKey: STORE_KEY },
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

async function chipText(page: Page, colName: string): Promise<string> {
  return page.evaluate((name) => {
    const chip = document.querySelector(`[data-testid="column-chip"][data-col-name="${name}"]`) as HTMLElement | null;
    return chip?.innerText ?? '';
  }, colName);
}

async function speakWhenArmed(page: Page, text: string, waitMs = 500) {
  await waitForTtsIdle(page);
  await fireStt(page, text, waitMs);
}

/** 칩을 눌러 키패드 시트를 열고 값을 찍어 커밋한다(manual-input.spec.ts와 같은 조작). */
async function keypadCommit(page: Page, colName: string, value: string) {
  await page.locator(`[data-testid="column-chip"][data-col-name="${colName}"]`).click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible({ timeout: 3000 });
  for (const k of value.split('')) {
    await page.locator(`[data-testid="manual-key-${k}"]`).click();
  }
  await page.locator('[data-testid="manual-commit"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  // v0.49 r2 — gUM 스텁(`fixtures/gum.ts`, v0.44.1). 없으면 `start()`의 `recorderRef.init()`가
  //   로컬 헤드리스에서 응답하지 않아 「마이크 권한을 확인하는 중…」에서 멈춘다(제품 회귀 아님).
  await page.addInitScript({ content: GUM_GRANT_SCRIPT });
  await installVoiceMocks(page);
});

test('① cellWait의 bare 「수정」은 그 셀만 재기록한다 — 뒤 칸 확정값을 지우지 않는다 (#4)', async ({ page }) => {
  await seedAndOpenVoiceTab(page);
  await clickStart(page);

  // 진행 중인 행: 횡경 35.1 · 종경 42.0 확정 → 지금은 당도를 묻고 있다.
  await speakWhenArmed(page, '35.1', 700);
  await speakWhenArmed(page, '42.5', 700);
  expect(await activeChipName(page)).toContain('당도');

  // 「이전」 두 번 — 사용자는 **횡경 하나만** 확인하러 되돌아간다.
  await speakWhenArmed(page, '이전');
  await speakWhenArmed(page, '이전');
  expect(await activeChipName(page)).toContain('횡경');

  await speakWhenArmed(page, '수정', 900);

  // 🔴 캐스케이드는 **행 전체 검토**(reviewWait) 문맥의 계약이다 — 그 행은 이미 다 채워졌고
  //    사용자가 처음부터 다시 부르겠다고 선언한 상태다. 진행 중인 행의 **한 칸**에 주차해
  //    「수정」이라고 말한 사용자는 그 칸만 다시 부를 생각이다. 종경 42.5는 사용자가 바꾸겠다고
  //    한 적이 없는데도 화면에서 사라지고 다시 말하게 만든다(중단되면 그대로 유실).
  expect(await chipText(page, '종경'), 'cellWait의 bare 「수정」이 뒤 칸의 확정값까지 지웠다').toContain('42.5');

  // 재기록 자체는 살아 있어야 한다 — 그 셀은 지금 값을 받는다.
  await speakWhenArmed(page, '41.4', 900);
  expect(await chipText(page, '횡경')).toContain('41.4');
  expect(await chipText(page, '종경'), '재기록 뒤에도 종경은 그대로다').toContain('42.5');
});

test('② cellWait에서의 키패드 재커밋도 cellWait으로 복귀한다 (#7)', async ({ page }) => {
  await seedAndOpenVoiceTab(page);
  await clickStart(page);

  await speakWhenArmed(page, '35.1', 700);
  await speakWhenArmed(page, '이전');
  expect(await activeChipName(page)).toContain('횡경');

  await waitForTtsIdle(page);
  const before = (await ttsLog(page)).length;

  // 값을 들어보니 틀렸다 → 칩을 눌러 키패드로 고친다.
  await keypadCommit(page, '횡경', '41.4');
  await page.waitForTimeout(800);
  await waitForTtsIdle(page);

  expect(await chipText(page, '횡경')).toContain('41.4');
  // 🔴 사용자가 **의도적으로 이동해 들어온** 검토 문맥이다. 음성 「수정 41.4」는 (fix49 오라클 ⑤)
  //    같은 셀의 검토 대기로 돌아오는데, 같은 정정을 키패드로 하면 커서가 채워진 칸들을 지나
  //    다음 빈 칸/다음 행으로 튀어버린다 — 같은 상태에서 같은 목적의 두 조작이 갈린다.
  expect(await activeChipName(page), '키패드 재커밋이 셀 검토 문맥을 파괴하고 전진했다').toContain('횡경');

  const spoken = (await ttsLog(page)).slice(before).join(' | ');
  expect(spoken, '정정값을 되읽어 주지 않으면 2~3m 떨어진 사용자는 고쳐졌는지 모른다').toContain('41.4');

  // 복귀처가 cellWait이라는 것의 실증 — bare 숫자는 다시 흡수된다(kind:'value'가 아니다).
  await speakWhenArmed(page, '99.9', 900);
  const after = await chipText(page, '횡경');
  expect(after, '키패드 복귀 경로가 filled 셀에 kind:value를 열었다').toContain('41.4');
  expect(after).not.toContain('99.9');
});

test('③ 완료 행 흡수 안내는 실제로 먹히는 어휘를 가르친다 (#8)', async ({ page }) => {
  await seedAndOpenVoiceTab(page);
  await clickStart(page);

  // 1행 완료 → 2행으로 자동 전진 → 「이전행」으로 완료된 1행에 착지(reviewWait).
  await speakWhenArmed(page, '35.1', 700);
  await speakWhenArmed(page, '42.5', 700);
  await speakWhenArmed(page, '50.0', 1500);
  await speakWhenArmed(page, '이전행', 1500);
  expect((await ttsLog(page)).join(' | ')).toContain('완료됨');

  await waitForTtsIdle(page);
  const before = (await ttsLog(page)).length;

  // 완료 행에 대고 무심코 값을 말한다 → 흡수 안내가 「다음 행으로 가는 법」을 가르친다.
  await speakWhenArmed(page, '99.9', 900);
  await waitForTtsIdle(page);
  const guide = (await ttsLog(page)).slice(before).join(' | ');
  // 🔴 v0.49 r2 W2(확정표 #4, 민구 08-13) — 정당 파손. 흡수 안내가
  //   "{N}행은 완료된 행입니다. 수정하려면 '수정', 다음 행은 '다음행'이라고…" → **"{N}행 완료됨.
  //   수정 또는 다음행."**으로 축약됐다. 이 테스트의 계약(「먹히는 어휘를 가르친다」)은 그대로다.
  expect(guide).toContain('완료됨');
  // 🔴 v0.49 r2 A12(codex F5) — **전체 바이트**로 잠근다. 종전엔 '완료됨'·'다음행' 부분
  //   문자열뿐이라 완료 행 번호·어절·문장부호가 바뀌어도 green이었다. 착지한 행은 1행이다.
  const absorbLine = (await ttsLog(page)).slice(before).find((t) => t.includes('완료됨'));
  expect(absorbLine, '흡수 안내 문구가 확정 바이트와 다르다').toBe('1행 완료됨. 수정 또는 다음행.');

  // 🔴 F-1(08-12) 어휘 재배정으로 「다음」은 **항목 이동**이 됐다 — 행을 넘기는 말이 아니다.
  //    그래서 종전 안내('다음')는 이 상태에서 **행을 넘겨주지 못하는** 단어를 가르치고 있었다.
  //    화면을 끄고 2~3m 떨어져 쓰는 사용자에게 TTS는 유일한 조작 설명서다(V-FIX4 계약).
  //    ⚠️ v0.49 r2 A13(codex F6) — 종전 이 주석의 *"항목 이동은 reviewWait에서 거부된다"* 는
  //    **현행과 반대다**: W1(08-13)이 reviewWait·atEnd에서의 항목 이동을 허용했다. 이 케이스가
  //    잠그는 것은 「안내가 **행 이동**을 가르치는가」이지 이동 거부가 아니다.
  expect(guide, "흡수 안내가 낡은 어휘('다음')를 가르친다 — 어휘 재배정 미이관").toContain('다음행');

  // 문자열 검사만으로는 계약이 안 잡힌다 — **가르친 대로 했을 때 실제로 되는지**를 잰다.
  const taught = guide.includes('다음행') ? '다음행' : '다음';
  await speakWhenArmed(page, taught, 1500);
  expect(await activeChipName(page), '안내가 가르친 말이 실제로는 먹히지 않는다').toBeTruthy();
  const rowLabel = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="voice-active-state"]') as HTMLElement | null;
    return el?.innerText ?? '';
  });
  expect(rowLabel, '가르친 말대로 했는데 행이 이동하지 않았다').toContain('2');
});

test('④ cellWait의 「취소」는 값을 요구하지 않는다 (#9)', async ({ page }) => {
  await seedAndOpenVoiceTab(page);
  await clickStart(page);

  await speakWhenArmed(page, '35.1', 700);
  await speakWhenArmed(page, '이전');
  expect(await activeChipName(page)).toContain('횡경');

  await waitForTtsIdle(page);
  const before = (await ttsLog(page)).length;
  await speakWhenArmed(page, '취소', 900);
  await waitForTtsIdle(page);
  const reply = (await ttsLog(page)).slice(before).join(' | ');

  // 🔴 "횡경 다시 말씀해 주세요"는 **값을 말하라는 뜻**이다. 그런데 cellWait은 값을 흡수하고
  //    "수정이라고 말하세요"로 되받는다 — 앱이 시킨 대로 한 사용자가 거절당한다. 두 문장이
  //    서로를 부정하는 루프에 갇히면 음성 전용 사용자는 빠져나올 방법을 알 수 없다.
  expect(reply, 'cellWait에서 값 재질문 문구가 나왔다 — 흡수가 거절할 말을 시킨다').not.toContain('다시 말씀해');
  expect(reply, '정정 진입로를 가르쳐야 한다').toContain('수정');

  // 상태 자체는 불변이어야 한다(「취소」가 셀을 여는 것이 아니다).
  await speakWhenArmed(page, '99.9', 900);
  const after = await chipText(page, '횡경');
  expect(after, '「취소」가 filled 셀에 kind:value를 열었다').toContain('35.1');
  expect(after).not.toContain('99.9');
});
