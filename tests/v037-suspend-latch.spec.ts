/**
 * v0.37.0 리뷰(3모델 공통: Codex High + Flash·Pro Critical, 민구 인가) — **suspend 소스 집합 래치** 회귀.
 *
 * 결함: `suspendRecognitionForUi`/`resumeRecognitionForUi`가 단일 boolean 래치를 공유해, 두 오버레이가
 *   겹치면(수동 입력 시트 + 개선요청 모달) 하나만 닫혀도 래치가 풀려 나머지 오버레이 뒤에서 STT가
 *   조기 재개됐다(발화 유실/오커밋 — 데이터무결성). 수정: 래치를 **소스 집합(reference-count)** 으로
 *   바꿔 **모든 소스가 해제될 때만** 실제 재개한다.
 *
 * 오라클(Codex가 지적한 negative test 공백을 메운다):
 *   A(중첩) 수동시트 + 개선요청 열고 → 개선요청만 닫음 → 수동시트 여전히 열림 + STT **여전히 suspend**
 *          (ui_resume 미발생·발화 미커밋). 그 뒤 수동시트까지 닫으면 → 재개(ui_resume + 발화 커밋).
 *   B(단일: 개선요청만) 열고 닫기 → 종전대로 정상 재개(회귀 없음).
 *   C(단일: 수동시트만) 열고 닫기 → 종전대로 정상 재개(회귀 없음).
 *   D(종료 확인 취소) 끝 도달 뒤 행 검토의 상시 종료 열고 닫기 → 래치가 비어 재오픈도 suspend.
 *   E(CLIP-WINDOW-2) suspend 중 신규 arm 차단·계측 + 마지막 source 해제 시 pending 복원.
 *   F(CLIP-WINDOW-2) resume 없는 세션 경계 clear가 pending을 폐기해 다음 세션 복원을 오염시키지 않음.
 *   G(TEST-CLIP-F-1) 세션 시작 TTS 구간에 모달이 열리면 인식기가 기동되지 않고 배경 발화도 커밋되지 않음.
 *
 * 🔴 v0.43.0 1d — F·G가 함께 가야 하는 이유(판정 §5-C, 측정으로 확정):
 *   F는 신설 이후 **자기 주제(stale pending 폐기)를 한 번도 검사한 적이 없다.** 세션2 무장 완료를
 *   기다리지 않아, 세션2 자신의 차단된 무장이 pending 슬롯을 덮어써 stale 슬롯이 노출되지 않았기
 *   때문이다(폐기를 고의로 깨고 돌려도 PASS였다). 대신 F는 **다른 결함**(시작 TTS 중 인식기 기동)을
 *   우연히 잡고 있었다. 그래서 수정은 두 갈래다 — F에 무장 완료 대기를 넣어 자기 주제를 검사하게
 *   하고(수정2), F가 우연히 덮던 오커밋 결함은 G로 독립시킨다(수정3).
 *
 * STT 목은 tests/fixtures/stt.ts SSOT 사용(Codex Medium #4 — 인라인 목 금지).
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다(수동 기동 불필요, [ORCH-27])
 */
import { test, expect, type Page } from '@playwright/test';
import { installVoiceMocks, fireStt, waitForTtsIdle } from './fixtures/stt';
import { BASE } from './baseUrl';

test.setTimeout(120_000);

const STORE_KEY = 'agri-voicenote-settings-v3';

const SETTINGS = {
  state: {
    googleConnected: false, userEmail: null, sheet: null,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_TEST_1/edit', sheetTab: 'Sheet1',
    columnsSheetId: 'SHEET_TEST_1', columnsSheetTab: 'Sheet1',
    availableSheets: [], manualMode: false,
    columns: [
      { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 3 } },
      { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
      { id: 'c9', name: '종경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
    ],
    tableGenerated: true, totalRows: 3,
    ttsRate: 1.05, sessionLabelColId: null, sessionAutoLabel: 'suspend-latch', noisyMode: false, preferredVoiceName: '',
  },
  version: 12,
};

/** D·F 전용 최소 끝 도달 구성. A·B·C·E의 기존 3행 설정은 그대로 격리한다. */
const TWO_ROW_SETTINGS = {
  ...SETTINGS,
  state: {
    ...SETTINGS.state,
    columns: SETTINGS.state.columns.map((col) =>
      col.id === 'c6'
        ? { ...col, auto: { ...col.auto, to: 2 } }
        : col,
    ),
    totalRows: 2,
    sessionAutoLabel: 'suspend-latch-2row',
  },
};

async function loadLogEvents(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db || !db.objectStoreNames.contains('logEvents')) return [];
    return new Promise<Array<{
      type: string;
      parsed?: string;
      extra?: string;
      row?: number;
      colId?: string;
    }>>((res) => {
      const tx = db.transaction('logEvents', 'readonly');
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result as Array<{
        type: string;
        parsed?: string;
        extra?: string;
        row?: number;
        colId?: string;
      }>);
      req.onerror = () => res([]);
    });
  });
}

async function clipStartAttemptCount(page: Page): Promise<number> {
  const events = await loadLogEvents(page);
  return events.filter((e) =>
    e.extra === 'clip_no_stream'
    || e.extra?.startsWith('clip_started:')
    || e.extra?.startsWith('clip_start_failed:'),
  ).length;
}

async function clickMounted(page: Page, selector: string): Promise<void> {
  await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!(el instanceof HTMLElement)) throw new Error(`mounted control not found: ${s}`);
    el.click();
  }, selector);
}

async function activeChipName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const chip = document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
    return chip?.dataset.colName ?? '';
  });
}

async function waitForActiveChip(page: Page, colName: string, timeout = 6000) {
  await page.waitForFunction(
    (name) => {
      const chip = document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
      return (chip?.dataset.colName ?? '').includes(String(name));
    },
    colName,
    { timeout },
  );
}

async function waitForRow(page: Page, targetRow: number, timeout = 5000) {
  await page.waitForFunction(
    (row) => {
      const match = document.body.innerText.match(/(\d+)\s*\/\s*\d+\s*행/);
      return match && Number(match[1]) === row;
    },
    targetRow,
    { timeout },
  );
}

async function boot(page: Page, settings = SETTINGS) {
  await installVoiceMocks(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ s, storeKey }) => {
      localStorage.clear();
      localStorage.setItem(storeKey, JSON.stringify(s));
      indexedDB.deleteDatabase('agri-voicenote');
    },
    { s: settings, storeKey: STORE_KEY },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(200);
  await page.locator('text=음성 입력 시작').first().click();
  await page.waitForTimeout(700);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
  await waitForActiveChip(page, '횡경');
}

/** G 전용 boot — **boot()의 `waitForTimeout(700)`을 뺀다.**
 *  그 700ms가 A~E를 green으로 유지해 온 이유이자, [TEST-CLIP-F-1]이 판정될 때까지 시작 TTS
 *  구간의 오커밋 결함이 스위트 어디에도 안 잡혔던 이유다. 여기서는 칩이 활성이 되는 즉시
 *  (=start()가 아직 :2522 시작 TTS를 await 중인 상태에서) 호출자에게 제어를 돌려준다. */
async function bootNoArmWait(page: Page, settings = SETTINGS) {
  await installVoiceMocks(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ s, storeKey }) => {
      localStorage.clear();
      localStorage.setItem(storeKey, JSON.stringify(s));
      indexedDB.deleteDatabase('agri-voicenote');
    },
    { s: settings, storeKey: STORE_KEY },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(200);
  await page.locator('text=음성 입력 시작').first().click();
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
  await waitForActiveChip(page, '횡경');
}

/** 검증된 [EXIT-PERSIST-1] 셋업과 동일하게 각 필드·행 전이를 확인한 뒤 다음 STT를 보낸다.
 *  TTS/advance 중 이전 MockSTT에 연속 발화를 밀어 넣으면 다음 행 값이 유실돼 끝 도달이 공허해진다. */
async function reachEnd(page: Page) {
  const rows = [
    { row: 1, c8: '11.1', c9: '21.1' },
    { row: 2, c8: '12.2', c9: '22.2' },
  ];
  for (const values of rows) {
    await waitForRow(page, values.row);
    await waitForActiveChip(page, '횡경');
    // activeRow/activeCol은 행 전환 안내보다 먼저 바뀐다. 칩 표시만 보고 즉시 final을 보내면
    // awaitingField가 아직 null인 정상 TTS 구간에 발화가 유실되므로 실제 입력 준비까지 기다린다.
    await waitForTtsIdle(page);
    await fireStt(page, values.c8);
    await waitForActiveChip(page, '종경');
    await waitForTtsIdle(page);
    await fireStt(page, values.c9, 600);
  }
  await expect(page.locator('[data-testid="complete-summary"]')).toBeVisible({ timeout: 6000 });
}

// ─── A: 중첩(수동시트 + 개선요청) — 개선요청만 닫아도 재개 금지, 수동시트까지 닫아야 재개 ───────────
test('A(중첩) — 수동시트+개선요청 겹침: 개선요청만 닫으면 STT 여전히 suspend, 수동시트까지 닫아야 재개', async ({ page }) => {
  await boot(page);

  // 수동 입력 시트 열기(활성 칩 횡경) → suspend('manual_input').
  await page.locator('[data-testid="column-chip"][data-active="true"]').click();
  const sheet = page.locator('[data-testid="manual-value-sheet"]');
  await expect(sheet).toBeVisible({ timeout: 3000 });

  // 그 위에 개선요청 모달 열기(탭 인터셉트 — setTab 없음, 시트 유지) → suspend('feedback_modal') 중첩.
  await page.locator('[data-testid="tab-feedback"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toBeVisible({ timeout: 15_000 });

  // 개선요청만 닫는다 → resume('feedback_modal'): 집합에 manual_input이 남아 **실제 재개 금지**.
  await page.locator('[data-testid="feedback-cancel"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toHaveCount(0);
  await page.waitForTimeout(300);

  // ① 수동 시트는 여전히 열려 있다(개선요청은 오버레이일 뿐 시트를 닫지 않는다).
  await expect(sheet).toBeVisible();
  // ② STT는 여전히 suspend — 아직 ui_resume이 하나도 없다(집합이 안 비었으므로 실제 재개 로그 없음).
  const before = await loadLogEvents(page);
  expect(before.some((e) => e.parsed === 'ui_suspend' && e.extra === 'manual_input'), 'manual_input suspend 기록').toBe(true);
  expect(before.filter((e) => e.parsed === 'ui_resume').length, '개선요청만 닫혔을 뿐 실제 재개 없음(ui_resume 0)').toBe(0);
  // ③ 배경 발화도 커밋되지 않는다(인식기 정지 상태 — 유실 아닌 '차단'이 정상: 시트가 소유권을 가짐).
  await fireStt(page, '99.9', 400);
  expect(await activeChipName(page), '발화가 커밋되지 않아 활성 칩 불변').toContain('횡경');
  await expect(page.locator('[data-testid="column-chip"][data-col-name="횡경"]')).not.toContainText('99.9');

  // 이제 수동 시트까지 닫는다 → resume('manual_input'): 집합이 비어 **실제 재개**.
  await page.locator('[data-testid="manual-cancel"]').click();
  await expect(sheet).toHaveCount(0);
  await page.waitForTimeout(300);
  const after = await loadLogEvents(page);
  expect(after.some((e) => e.parsed === 'ui_resume'), '모든 소스 해제 → 실제 재개(ui_resume 발생)').toBe(true);

  // ④ 재개 증명: 이제 음성 발화가 정상 커밋돼 활성 칩이 전진한다(발화 유실 없음).
  await fireStt(page, '35.1', 500);
  await waitForActiveChip(page, '종경');
});

// ─── B: 단일 소스(개선요청만) — 회귀 없음 ──────────────────────────────────────────────────────
test('B(단일) — 개선요청만 열고 닫기: 종전대로 정상 재개(회귀 없음)', async ({ page }) => {
  await boot(page);
  await page.locator('[data-testid="tab-feedback"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('[data-testid="feedback-cancel"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toHaveCount(0);
  await page.waitForTimeout(300);

  const ev = await loadLogEvents(page);
  expect(ev.some((e) => e.parsed === 'ui_suspend' && e.extra === 'feedback_modal')).toBe(true);
  expect(ev.some((e) => e.parsed === 'ui_resume' && e.extra === 'feedback_modal')).toBe(true);
  // 재개 증명: 발화 정상 커밋 → 활성 칩 전진.
  await fireStt(page, '12.3', 500);
  await waitForActiveChip(page, '종경');
});

// ─── C: 단일 소스(수동시트만) — 회귀 없음 ──────────────────────────────────────────────────────
test('C(단일) — 수동시트만 열고 닫기: 종전대로 정상 재개(회귀 없음)', async ({ page }) => {
  await boot(page);
  await page.locator('[data-testid="column-chip"][data-active="true"]').click();
  const sheet = page.locator('[data-testid="manual-value-sheet"]');
  await expect(sheet).toBeVisible({ timeout: 3000 });
  await page.locator('[data-testid="manual-cancel"]').click();
  await expect(sheet).toHaveCount(0);
  await page.waitForTimeout(300);

  const ev = await loadLogEvents(page);
  expect(ev.some((e) => e.parsed === 'ui_suspend' && e.extra === 'manual_input')).toBe(true);
  expect(ev.some((e) => e.parsed === 'ui_resume' && e.extra === 'manual_input')).toBe(true);
  await fireStt(page, '21.0', 500);
  await waitForActiveChip(page, '종경');
});

// ─── D: 끝 도달 뒤 상시 종료 — 취소가 래치를 비워 다음 모달도 suspend ────────────────────────
test('D [EXIT-PERSIST-1] — 검토 행 상시 종료 취소 후 suspend 래치가 비어 재오픈도 STT를 멈춘다', async ({ page }) => {
  await boot(page, TWO_ROW_SETTINGS);
  await reachEnd(page);

  // 마지막 행 완료 뒤 다른 완료 행을 검토해 중앙 종료가 사라진 상태를 만든다.
  await page.getByRole('button', { name: '이전행', exact: true }).click();
  await waitForRow(page, 1);
  await expect(page.locator('[data-hero-state="review"]')).toBeVisible({ timeout: 4000 });
  await expect(page.locator('[data-testid="complete-summary"]')).toHaveCount(0);
  const exit = page.locator('[data-testid="voice-status-control"][data-status="exit"]');
  await expect(exit).toBeVisible();

  const countOf = async (parsed: string) =>
    (await loadLogEvents(page)).filter((e) => e.parsed === parsed && e.extra === 'exit_confirm').length;

  await exit.click();
  await expect(page.locator('button[title="종료 확인"]')).toBeVisible();
  await expect.poll(() => countOf('ui_suspend'), { timeout: 3000 }).toBe(1);
  await page.locator('button[title="계속 입력"]').click();
  await expect.poll(() => countOf('ui_resume'), { timeout: 3000 }).toBe(1);

  // 첫 취소가 reason 집합을 비웠다면 같은 source 재오픈이 새 ui_suspend를 정확히 1건 더 남긴다.
  await exit.click();
  await expect(page.locator('button[title="종료 확인"]')).toBeVisible();
  await expect.poll(() => countOf('ui_suspend'), { timeout: 3000 }).toBe(2);
});

// ─── E: suspend 중 신규 arm 차단 + 마지막 source 해제 시 보류분 복원 ─────────────────────────
test('E [CLIP-WINDOW-2] — 피드백 모달 중 신규 arm은 차단·기록되고 닫으면 같은 awaiting에 복원된다', async ({ page }) => {
  await boot(page);

  // 수동 입력 뒤에 피드백 모달을 겹친다. 뒤쪽 키패드로 현재값을 커밋하면 manual_input은
  // 해제되지만 feedback_modal은 남은 채 다음 필드 announceField→arm이 돈다.
  await page.locator('[data-testid="column-chip"][data-active="true"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible();
  await page.locator('[data-testid="tab-feedback"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toBeVisible({ timeout: 15_000 });

  const startsBeforeBlockedArm = await clipStartAttemptCount(page);
  for (const key of ['3', '5', '.', '1']) await clickMounted(page, `[data-testid="manual-key-${key}"]`);
  await clickMounted(page, '[data-testid="manual-commit"]');
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toHaveCount(0);

  const blockedExtra = 'clip_arm_blocked:reason=feedback_modal,row=1,col=c9';
  await expect.poll(
    async () => (await loadLogEvents(page)).filter((e) => e.extra === blockedExtra).length,
    { timeout: 3000 },
  ).toBe(1);
  expect(
    await clipStartAttemptCount(page),
    'suspend 중 arm 요청이 실제 AudioRecorder.startClip까지 도달하면 안 된다',
  ).toBe(startsBeforeBlockedArm);

  // 마지막 source가 닫히면 pending 요청이 기존 좌표 가드 경로로 합류해 정확히 한 번 재무장된다.
  await page.locator('[data-testid="feedback-cancel"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toHaveCount(0);
  await expect.poll(() => clipStartAttemptCount(page), { timeout: 3000 }).toBe(startsBeforeBlockedArm + 1);
  expect((await loadLogEvents(page)).filter((e) => e.extra === blockedExtra)).toHaveLength(1);
  await waitForActiveChip(page, '종경');
});

// ─── F: resume 없이 clear하는 세션 경계는 pending arm도 함께 폐기 ───────────────────────────
test('F [CLIP-WINDOW-2] — suspend 중 arm 후 종료 clear는 pending을 버려 다음 세션 복원을 막지 않는다', async ({ page }) => {
  await boot(page, TWO_ROW_SETTINGS);

  // 현재 c8 수동 커밋을 feedback suspend 뒤에서 수행한다. 다음 필드 c9의 announceField가 arm을
  // 요청하므로, 제거된 voice-retry 전용 경로 없이도 실제 사용자 커밋 경로로 pending을 만든다.
  await page.locator('[data-testid="column-chip"][data-active="true"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible();
  await page.locator('[data-testid="tab-feedback"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toBeVisible({ timeout: 15_000 });
  for (const key of ['1', '1', '.', '1']) await clickMounted(page, `[data-testid="manual-key-${key}"]`);
  await clickMounted(page, '[data-testid="manual-commit"]');
  await expect.poll(
    async () => (await loadLogEvents(page))
      .filter((e) => e.extra === 'clip_arm_blocked:reason=feedback_modal,row=1,col=c9').length,
    { timeout: 3000 },
  ).toBe(1);

  // 일반 활성 화면의 종료를 모달 뒤에서 실제 호출한다. 확인 경로는 resume 없이 stop()으로 가며
  // clearUiSuspendLatch가 suspended/pending 두 슬롯을 함께 폐기해야 한다.
  await clickMounted(page, '[data-testid="voice-control-stop"]');
  await expect(page.locator('button[title="종료 확인"]')).toBeAttached();
  await clickMounted(page, 'button[title="종료 확인"]');
  await expect(page.locator('text=음성 입력 시작').first()).toBeAttached({ timeout: 10_000 });

  // 전역 피드백 모달을 닫고 새 세션 시작. 첫 awaiting은 c8이므로 stale c9 pending이 남았다면
  // 아래 feedback resume에서 최신 pending(c9)이 모달 전 활성 c8을 가려 복원이 발생하지 않는다.
  await page.locator('[data-testid="feedback-cancel"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toHaveCount(0);
  const startsBeforeSession2 = await clipStartAttemptCount(page);
  await page.locator('text=음성 입력 시작').first().click();
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
  await waitForActiveChip(page, '횡경');

  // 🔴 v0.43.0 1d(수정2) — **세션2의 첫 무장이 끝날 때까지 기다린다.**
  //   waitForActiveChip은 start()의 setActiveCol(0)만 보므로, start()가 아직 시작 TTS를 await
  //   중인 구간에 통과한다. 그 상태로 아래 모달을 열면 세션2 자신의 차단된 무장이
  //   uiBlockedClipArmRef를 {row:1,col:c8}로 덮어써, resume의 `blockedClip ?? uiSuspendedClipRef`가
  //   stale 슬롯까지 내려가지 않는다 → **stale pending이 남아 있어도 이 테스트가 통과한다.**
  //   측정으로 확인된 사실이다(판정 §5-C): pending 폐기(clearUiSuspendLatch)를 고의로 깨고
  //   돌려도 대기 없는 F는 PASS였다. 즉 F는 신설 이후 자기 주제를 한 번도 검사한 적이 없었다.
  //   TTS idle 대신 **무장 자체(clip start 시도 총계)** 를 본다 — reachEnd:166-168이 경고한
  //   "TTS 시작 전에 통과하는 창"이 없는 축이다. clip_no_stream은 좌표를 안 실으므로(audioRecorder
  //   :672) 좌표가 아니라 총계로 센다.
  await expect.poll(() => clipStartAttemptCount(page), { timeout: 5000 }).toBe(startsBeforeSession2 + 1);

  await page.locator('[data-testid="tab-feedback"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toBeVisible({ timeout: 15_000 });
  const startsBeforeResume = await clipStartAttemptCount(page);
  await page.locator('[data-testid="feedback-cancel"]').click();
  await expect.poll(() => clipStartAttemptCount(page), { timeout: 3000 }).toBe(startsBeforeResume + 1);
});

// ─── G: 시작 TTS 구간에 모달이 열리면 인식기가 기동되지 않는다(오커밋 차단) ────────────────────
test('G [TEST-CLIP-F-1] — 세션 시작 TTS 중 모달이 열리면 STT가 기동되지 않고 배경 발화도 커밋되지 않는다', async ({ page }) => {
  // 🔴 v0.43.0 1d(수정3) — F에 의존하지 않는 **직접** 회귀 테스트.
  //   F는 이 결함을 우연히 잡았고, 위 수정2(무장 완료 대기)를 넣는 순간 못 잡게 된다.
  //   여기가 그 오라클의 새 집이다. A(:202-205)가 같은 속성을 단언하지만 A는 boot()의 700ms
  //   대기가 있어 **이 경로를 영원히 안 밟는다** — 그 700ms를 뺀 것이 이 테스트의 전부다.
  //
  //   결함(수정 전): start()가 `await say('음성 입력을 시작합니다.')` 뒤에 래치 확인 없이
  //   SpeechController를 만들어 기동했다. 실기기에서 이 TTS는 수 초이고, 개선요청(나비)은
  //   상시 탭 가능하다(sessionStore.ts:85). 장갑 낀 손으로 "시작 누르고 바로 개선요청"은
  //   현실적 조작이며, mock 400ms보다 실기기의 창이 **더 넓다**.
  await bootNoArmWait(page);

  // 칩이 활성이 된 즉시(=start()가 아직 시작 TTS를 await 중) 개선요청 모달을 연다.
  await page.locator('[data-testid="tab-feedback"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(async () => (await loadLogEvents(page)).filter((e) => e.parsed === 'ui_suspend').length, { timeout: 3000 })
    .toBe(1);

  // start()의 남은 구간(TTS 종료 → 인식기 생성 지점 → announceField)이 다 지나가게 둔다.
  await waitForTtsIdle(page);
  await page.waitForTimeout(500);

  // ① 기동 자체가 없어야 한다. ui_suspend 이후 `lifecycle:start`가 하나라도 있으면 결함이다.
  const afterSuspend = await loadLogEvents(page);
  const idxSuspend = afterSuspend.findIndex((e) => e.parsed === 'ui_suspend');
  expect(idxSuspend, 'ui_suspend가 기록돼야 한다').toBeGreaterThanOrEqual(0);
  expect(
    afterSuspend.slice(idxSuspend).filter((e) => e.type === 'stt' && e.extra === 'lifecycle:start'),
    'suspend 뒤에 인식기가 기동되면 안 된다(모달 뒤 STT 생존)',
  ).toHaveLength(0);

  // ② 배경 발화가 커밋되면 안 된다 — 이것이 데이터 무결성 오라클이다.
  //    (결함 시: value parsed=33.3 row=1 col=c8 이 모달이 열린 채 찍혔다.)
  await fireStt(page, '33.3', 600);
  const afterSpeech = await loadLogEvents(page);
  expect(
    afterSpeech.filter((e) => e.type === 'value'),
    '모달이 열린 채 값이 커밋되면 안 된다',
  ).toHaveLength(0);
  expect(await activeChipName(page), '발화가 커밋되지 않아 활성 칩 불변').toContain('횡경');

  // ③ 무장도 전진하면 안 된다 — 결함 시 다음 필드(c9)로 clip_arm_blocked가 한 번 더 찍혔다.
  expect(
    afterSpeech.filter((e) => e.extra === 'clip_arm_blocked:reason=feedback_modal,row=1,col=c9'),
    '커밋이 없으므로 다음 필드로 전진하지 않는다',
  ).toHaveLength(0);

  // ④ 모달을 닫으면 기존 복원 경로가 살아난다(가드가 기능을 죽이지 않았다는 반대 방향 증거).
  await page.locator('[data-testid="feedback-cancel"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toHaveCount(0);
  await waitForTtsIdle(page);
  await fireStt(page, '35.1', 600);
  await waitForActiveChip(page, '종경');
});
