/**
 * v0.35.2 Stage 2-6 — 기능 격리(상시 원칙 #2: 활성/비활성 무영향) 확인 spec.
 *
 * 토글 보유 기능은 "꺼짐 상태에서 배선 지점이 조용한 no-op"이어야 한다. 현재 커버리지 지도
 * (정확한 주장 — v0.35.2 리뷰 r1 Codex 지적 반영):
 *  - 빠른 인식   → **이 파일** (기본 OFF에서 interim 안정화가 아무 커밋/계측도 만들지 않음 — 완전한 off no-op 검증)
 *  - 자동 캡처   → tests/v033-auto-capture.spec.ts ([node] createAutoCapture 토글 off 스킵 케이스)
 *  - 개선요청    → tests/v033-feedback.spec.ts — admin env 미주입 시 admin 레그 skip(부분 격리).
 *                  기능 전체에는 off 토글이 없음(탭 자체가 기능) — 캡처 실패 non-fatal은 v0.33.0 계약.
 *  - 비프음      → on/off 플래그 없음(변형 선택형, 기본값=현행이 격리 계약) —
 *                  tests/v033-beep-help.spec.ts가 기본값 sanitize·복원을 고정. 재생 실패 non-fatal의
 *                  직접 단언은 미보유(갭 — beep.ts previewBeep try/catch 계약, 백로그).
 *
 * 빠른 인식(fastRecognition, 조기확정)의 배선은 useVoiceSession.handleInterim의 단일 게이트
 * (`if (!fastRecognition) return`) 1곳이다. OFF면: ① interim이 아무리 안정돼도 커밋 없음
 * ② stt_early_commit(attempt 포함) 계측 0건(오버헤드 0) ③ 이후 final 경로는 평소대로 동작.
 */
import { test, expect, type Page } from '@playwright/test';
import { installVoiceMocks, fireStt, fireSttInterim } from './fixtures/stt';
import { BASE } from './baseUrl';

test.setTimeout(120_000);

// fastRecognition을 명시하지 않는다 — 기본값(OFF)이 격리 대상 그 자체다.
const SETTINGS = {
  state: {
    googleConnected: false,
    userEmail: null,
    sheet: null,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_TEST_1/edit',
    sheetTab: 'Sheet1',
    columnsSheetId: 'SHEET_TEST_1',
    columnsSheetTab: 'Sheet1',
    availableSheets: [],
    manualMode: false,
    columns: [
      { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 } },
      { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
      { id: 'c9', name: '종경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
    ],
    tableGenerated: true,
    totalRows: 4,
    ttsRate: 1.05,
    sessionLabelColId: null,
    sessionAutoLabel: 'feature-isolation-test',
    noisyMode: false,
    preferredVoiceName: '',
  },
  version: 13,
};

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

async function getEventTypes(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const tx = db.transaction('logEvents', 'readonly');
    const all: Array<{ type?: string }> = await new Promise((resolve, reject) => {
      const rq = tx.objectStore('logEvents').getAll();
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
    });
    db.close();
    return all.map((e) => e.type ?? '');
  });
}

test('빠른 인식 OFF(기본) — interim 안정화가 커밋·계측 모두 no-op, final 경로는 무영향', async ({ page }) => {
  await installVoiceMocks(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate((s) => { localStorage.setItem('agri-voicenote-settings-v3', JSON.stringify(s)); }, SETTINGS);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(200);
  const startBtn = page.locator('text=음성 입력 시작').first();
  await expect(startBtn).toBeVisible();
  await startBtn.click();
  await page.waitForTimeout(600);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
  await waitForActiveChip(page, '횡경');

  // 조기확정이 켜져 있었다면 커밋됐을 시나리오: 같은 숫자 interim을 안정 윈도(400ms)보다 길게 반복.
  await fireSttInterim(page, '33.3', 250);
  await fireSttInterim(page, '33.3', 250);
  await fireSttInterim(page, '33.3', 250);
  await page.waitForTimeout(600);

  // ① 커밋 없음 — 여전히 첫 음성 컬럼(횡경)에 머문다(종경으로 전진하지 않음).
  await waitForActiveChip(page, '횡경');
  // ② 계측 0건 — OFF는 게이트 앞 early-return이라 stt_early_commit(attempt 포함)이 존재하지 않는다.
  const types = await getEventTypes(page);
  expect(types.filter((t) => t === 'stt_early_commit')).toHaveLength(0);

  // ③ final 경로 무영향 — 평소처럼 final로 커밋되고 다음 컬럼으로 진행한다.
  await fireStt(page, '33.3', 400);
  await waitForActiveChip(page, '종경');
});
