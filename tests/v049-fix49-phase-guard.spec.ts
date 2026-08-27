/**
 * v0.49 fix49 오라클 B — **미해결 국면에서 항목 이동을 거부한다**
 * (리뷰 2026-08-12 revc M-1 + M-2 · 민구 확정 08-12 「거부+안내」)
 *
 * 알람 응답 대기·수정 재청취·소수부 재질문은 **답을 기다리는 상태**다. 항목 이동은 그 문맥을
 * 조용히 파기했다 — 미확인 이상치가 「다음」 한 마디로 사라지고(M-1), 재질문은 정수부 문맥을
 * 잃는다(M-2). 어휘 재배정(08-12)으로 「다음」이 *옆 칸 한 칸*이 되어 심리적 비용이 사라진
 * 만큼 이 문이 훨씬 자주 열린다 — 그래서 거부하고 **한 마디로 안내**한다(무음 금지 [REVIEW-4]).
 *
 *   ① `trendConfirm`(음성 발동 이상치 알람) 중 「다음」 → 거부 + **알람 팝업 불변**
 *      🔴 종전엔 `resolveFinal`이 「나머지 명령」으로 분류해 `trendDemoted:true`로 내보냈고,
 *         호출부가 dispatch **이전에** `clearAnomalyAlert('trend_dismissed')`를 불렀다.
 *         즉 가드만 넣으면 오라클은 green인데 알람은 계속 사라진다 — **두 파일이 한 계약**이다
 *         (`voiceFinalResolver.spec.ts`의 「항목 이동은 알림을 유지」가 짝 단언).
 *   ② `modify`(수정 재청취) 국면 중 「다음」 → 거부 + 안내, 재청취 문맥 유지
 *   ③ 소수부 재질문(`fractionWhole`) 중 「다음」 → 거부 + 안내, **정수부 문맥 생존**
 *      (문맥이 끊기면 조각 발화가 전체값으로 오커밋된다 — 값 추측 금지 계약의 합성 문맥)
 *   ④ 거부는 **먹통이 아니다**(REVIEW-4) — 후속 명령이 그대로 먹힌다
 *   ⚠️ **행 이동(`prevRow`/`nextRow`)은 이 결정의 범위 밖이다**(민구 08-12) — 종전 의미 유지.
 *      ④가 그 불변을 함께 고정한다.
 *
 * 처방 전에 ①②③이 red임을 실측으로 확인했다(반증까지 해야 회귀 테스트다) — 특히 ①은
 * 현행에서 `anomaly-alert` 노드 자체가 사라졌다.
 *
 * filled 셀 보호(B-1)는 짝 스펙 `v049-fix49-cell-guard.spec.ts`가 잰다(다른 계약).
 *
 * Mock: fixtures/stt. ①만 Sheets GET stub이 추가로 필요하다(직전 회차 = 추세 비교선).
 */

import { test, expect, type Page } from '@playwright/test';
import { installVoiceMocks, fireStt, ttsLog, waitForTtsIdle } from './fixtures/stt';
import { GUM_GRANT_SCRIPT } from './fixtures/gum';
import { BASE } from './baseUrl';

test.setTimeout(120_000);

const STORE_KEY = 'agri-voicenote-settings-v3';
const TOTAL_ROWS = 3;

/** voice 컬럼 3개 — f1nav 스펙과 같은 골격. */
function settings(extra?: Record<string, unknown>) {
  return {
    state: {
      chipSweepSeconds: 0,
      googleConnected: false,
      userEmail: null,
      sheet: null,
      sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_FIX49P/edit',
      sheetTab: 'Sheet1',
      columnsSheetId: 'SHEET_FIX49P',
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
      sessionAutoLabel: 'fix49p',
      noisyMode: false,
      preferredVoiceName: '',
      ...extra,
    },
    version: 13,
  };
}

async function clickStart(page: Page) {
  const startBtn = page.locator('text=음성 입력 시작').first();
  await expect(startBtn).toBeVisible();
  await startBtn.click();
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 6000 });
  await page.waitForTimeout(400);
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
  await clickStart(page);
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

async function activeRow(page: Page): Promise<number> {
  const text = await page.evaluate(() => document.body.innerText);
  const m = text.match(new RegExp('(\\d+)\\s*\\/\\s*' + TOTAL_ROWS + '\\s*행'));
  return m ? parseInt(m[1]) : -1;
}

/** 안내 TTS 체인이 끝난(awaiting 무장 완료) 뒤에 발화한다 — f1nav 스펙과 동일 근거. */
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

// ─── ① 이상치 알람 응답 대기 ────────────────────────────────────────────────────

/** 음성 발동 이상치 알람(trendConfirm)을 세우려면 «직전 회차» 비교선이 필요하다 —
 *  Sheets GET stub + 샘플키 컬럼 조합은 trend-alert.spec.ts 계보를 따른다. */
const PREV_ROUND = (() => {
  const d = new Date(Date.now() - 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();
const TREND_HEADERS = ['조사일자', '농가명', '조사나무', '횡경', '종경', '당도'];
const TREND_ROWS = [[PREV_ROUND, '이원창', '1', '100.0', '50.0', '10.0']];

function trendSettings() {
  return settings({
    googleConnected: true,
    userEmail: 'tester@example.com',
    columns: [
      { id: 'c1', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
      { id: 'c3', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
      { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: TOTAL_ROWS }, sampleKey: true },
      // 🔴 trendRule 'increase' = 커지면 알람. 직전 100.0 → 120.0 발화로 위반을 만든다.
      { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'increase' },
      { id: 'c9', name: '종경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
      { id: 'c11', name: '당도', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
    ],
  });
}

async function seedTrendAndStart(page: Page) {
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { values: [TREND_HEADERS, ...TREND_ROWS] } });
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected' });
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ st, storeKey }) => {
      localStorage.clear();
      localStorage.setItem('gs10_google_token', JSON.stringify({
        access_token: 'test-token', expires_at: Date.now() + 3600_000, email: 'tester@example.com',
      }));
      localStorage.setItem(storeKey, JSON.stringify(st));
      indexedDB.deleteDatabase('agri-voicenote');
    },
    { st: trendSettings(), storeKey: STORE_KEY },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(300);
  await clickStart(page);
}

test('① 이상치 알람 응답 대기 중 「다음」은 거부되고 알람이 살아남는다', async ({ page }) => {
  await seedTrendAndStart(page);

  // 직전 회차 100.0 대비 증가 → 알람 발동(응답 대기).
  await speakWhenArmed(page, '120', 1200);
  const popup = page.locator('[data-testid="anomaly-alert"]');
  await expect(popup, '알람이 안 떴다 — 전제가 깨졌다').toBeVisible();

  const chipBefore = await activeChipName(page);
  await waitForTtsIdle(page);
  const before = (await ttsLog(page)).length;

  await speakWhenArmed(page, '다음', 1000);

  // 🔴 종전엔 resolveFinal이 「나머지 명령」으로 분류해 알람을 **조용히 닫고** 이동했다.
  //   미확인 이상치를 우회하는 경로라 manualHold 게이트와 대칭이 되어야 한다.
  await expect(popup, '미확인 이상치 알람이 항목 이동으로 dismiss됐다').toBeVisible();
  expect(await activeChipName(page), '알람 응답 대기 중 커서가 움직였다').toBe(chipBefore);

  const spoken = (await ttsLog(page)).slice(before).join(' | ');
  expect(spoken, '거부가 무음이면 안 된다(REVIEW-4)').not.toBe('');
  expect(spoken).toContain('먼저');

  // ④축 — 거부 후에도 알람 해소는 그대로 먹힌다(먹통 아님).
  await speakWhenArmed(page, '확인', 1200);
  await expect(popup).toBeHidden();
});

// ─── ②③ 수정 재청취 · 소수부 재질문 ────────────────────────────────────────────

test('② 수정 재청취 중 「다음」은 거부되고 문맥이 유지된다', async ({ page }) => {
  await seedAndOpenVoiceTab(page);

  await speakWhenArmed(page, '35.1', 700);
  await speakWhenArmed(page, '이전');
  await speakWhenArmed(page, '수정', 800);
  expect(await activeChipName(page)).toContain('횡경');

  await waitForTtsIdle(page);
  const before = (await ttsLog(page)).length;
  await speakWhenArmed(page, '다음', 800);

  expect(await activeChipName(page), '수정 국면에서 이동하면 재청취 문맥이 조용히 파기된다').toContain('횡경');
  const spoken = (await ttsLog(page)).slice(before).join(' | ');
  expect(spoken, '거부가 무음이면 안 된다(REVIEW-4)').not.toBe('');
  expect(spoken).toContain('먼저');

  // ④축 — 거부 후에도 세션은 살아 있다: 재청취가 그대로 이어진다.
  await speakWhenArmed(page, '41.4', 900);
  expect(await chipText(page, '횡경')).toContain('41.4');
});

test('③ 소수부 재질문 중 「다음」은 거부되고 정수부 문맥이 살아남는다', async ({ page }) => {
  await seedAndOpenVoiceTab(page);

  // 소수부 오전사 → 정수부(111) 유지한 채 "소수점 아래만" 타깃 재질문(fractionWhole 무장).
  await speakWhenArmed(page, '111 점 에', 800);
  expect((await ttsLog(page)).join(' | '), '소수부 재질문 국면 진입 실패 — 전제가 깨졌다').toContain('소수점 아래');

  await waitForTtsIdle(page);
  const before = (await ttsLog(page)).length;
  await speakWhenArmed(page, '다음', 800);

  expect(await activeChipName(page), '재질문 도중 「다음」 한 마디로 이동하면 안 된다').toContain('횡경');
  expect((await ttsLog(page)).slice(before).join(' | ')).toContain('먼저');

  // 🔴 문맥 보존의 증거 — 이어지는 소수부 조각("오")이 **전체값 5가 아니라 111.5**로 합성된다.
  await speakWhenArmed(page, '오', 900);
  expect(await chipText(page, '횡경'), '정수부 문맥이 유실돼 조각이 전체값으로 오커밋됐다').toContain('111.5');
});

// ─── ④ 범위 밖 계약 불변 + 먹통 아님 ────────────────────────────────────────────

test('④ 거부 뒤에도 행 이동은 그대로 먹힌다 (행 이동은 이번 결정의 범위 밖)', async ({ page }) => {
  await seedAndOpenVoiceTab(page);

  await speakWhenArmed(page, '111 점 에', 800);
  await speakWhenArmed(page, '다음', 800); // 거부

  const row0 = await activeRow(page);
  // ⚠️ 행 이동은 종전 의미(문맥 파기 허용)를 그대로 유지한다 — 민구 결정 08-12.
  await speakWhenArmed(page, '다음행', 1300);
  expect(await activeRow(page), '거부 후 후속 명령이 먹통이 됐다').toBe(row0 + 1);
});
