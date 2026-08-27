/**
 * v0.44.1 [CLIP-INIT-SILENT-1] — 세션 시작 마이크 획득 실패의 「무음 소실」 방지 오라클.
 *
 * 근거(2026-08-05 실기기 sess_1785877588821): 85분 백그라운드 복귀 뒤 시작 클릭의 getUserMedia가
 * 즉시 NotAllowedError로 거부됐는데(iOS 오디오 세션 물림 — [MIC-B2] 클래스) 어떤 경고도 없어
 * 37분·63행이 클립 0개로 돌았다(F11 "음성클립 소실"). 값 커밋은 전량 정상(시트 63행 synced) —
 * 소실은 증거 채널(클립)만이다. 수동 재연결 16회 전부 실패 → 실효 복구는 앱 재시작뿐.
 *
 * 재는 축:
 *   ① gUM 거부 시 `mic_init_failed:err=<name>` 계측이 남는다 (시작 클릭당 1건)
 *   ② `mic_lost:init_failed` 래치 → 재연결 배너가 세션 시작 직후 노출된다 (40초 뒤가 아니라)
 *   ③ TTS 1회 고지 — 현장은 화면을 안 본다
 *   ④ 세션 자체는 시작된다 — 값 입력 채널(STT)은 이 스트림과 무관하므로 막지 않는다
 *   ⑤ (반증 방향) 승인 경로에서는 위 ①~③이 하나도 나타나지 않는다
 * 안 재는 축: iOS 실물 물림의 재현(브라우저 불가 — 실기기 게이트) · 재연결 성공 경로(기존 spec) ·
 *   TTS 문구가 실제 가청인지(speechSynthesis 목).
 */
import { test, expect, type Page } from '@playwright/test';
import { installVoiceMocks, ttsLog } from './fixtures/stt';
import { BASE } from './baseUrl';
import { GUM_DENY_SCRIPT, GUM_GRANT_SCRIPT } from './fixtures/gum';

test.setTimeout(120_000);

const STORE_KEY = 'agri-voicenote-settings-v3';

/** v0440-c8-flow.spec의 최소 3컬럼 시드와 동형 — 세션 시작만 필요하므로 2행. */
const SETTINGS = {
  state: {
    googleConnected: false,
    userEmail: null,
    sheet: null,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_V0441_1/edit',
    sheetTab: 'Sheet1',
    columnsSheetId: 'SHEET_V0441_1',
    columnsSheetTab: 'Sheet1',
    availableSheets: [],
    manualMode: false,
    columns: [
      { id: 'c6', name: '조사나무', type: 'int',   input: 'auto',  ttsAnnounce: true,  auto: { kind: 'seq', from: 1, to: 2 } },
      { id: 'c8', name: '횡경',     type: 'float', input: 'voice', ttsAnnounce: true,  auto: { kind: 'fixed', value: '' }, decimals: 1 },
      { id: 'c9', name: '종경',     type: 'float', input: 'voice', ttsAnnounce: true,  auto: { kind: 'fixed', value: '' }, decimals: 1 },
    ],
    tableGenerated: true,
    totalRows: 2,
    ttsRate: 1.05,
    sessionLabelColId: null,
    sessionAutoLabel: 'V0441',
    noisyMode: false,
    preferredVoiceName: '',
  },
  version: 13,
};

async function bootAndStart(page: Page, gumScript: string) {
  await installVoiceMocks(page);
  await page.addInitScript({ content: gumScript });
  // 정착 1초 지연은 이 spec의 관심 축이 아니다 — 우회 심(계약은 v0440-c8-flow가 고정).
  await page.addInitScript({ content: 'window.__micSettleSkipForTest = true;' });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ s, storeKey }) => {
      localStorage.clear();
      localStorage.setItem(storeKey, JSON.stringify(s));
      indexedDB.deleteDatabase('agri-voicenote');
    },
    { s: SETTINGS, storeKey: STORE_KEY },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(300);
  const startBtn = page.locator('text=음성 입력 시작').first();
  await expect(startBtn).toBeVisible();
  await startBtn.click();
}

/** logEvents IDB 스토어 통독 (v042-instrumentation-emit.spec 동일 헬퍼). */
async function loadLogEvents(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    if (!db || !db.objectStoreNames.contains('logEvents')) return [];
    return new Promise<Array<{ type: string; extra?: string }>>((resolve) => {
      const tx = db.transaction('logEvents', 'readonly');
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => resolve(req.result as Array<{ type: string; extra?: string }>);
      req.onerror = () => resolve([]);
    });
  });
}

async function extras(page: Page): Promise<string[]> {
  return (await loadLogEvents(page)).map((e) => e.extra ?? '');
}

test('거부 경로 — mic_init_failed 계측 + 배너 즉시 노출 + TTS 고지, 세션은 시작된다', async ({ page }) => {
  await bootAndStart(page, GUM_DENY_SCRIPT);

  // ④ 세션은 시작된다 — 값 입력 채널을 막지 않는다.
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 6000 });

  // ② 재연결 배너가 세션 시작 직후 노출된다(자동 1회 시도 실패 → 수동 폴백).
  //    실기기에서는 첫 경고가 40초 뒤 첫 커밋이었다 — 이 단언이 그 지연을 금지한다.
  await expect(page.locator('[data-testid="mic-reconnect-btn"]')).toBeVisible({ timeout: 8000 });

  // ① 계측 — 시작 클릭의 실패 사유가 이름으로 남는다(iOS 물림 판정 축).
  await page.waitForTimeout(800); // logger IDB flush는 fire-and-forget — 정착 대기.
  const all = await extras(page);
  const initFailed = all.filter((x) => x.startsWith('mic_init_failed:'));
  expect(initFailed.length, 'mic_init_failed 계측이 없다 — 시작 실패가 다시 무음이 됐다').toBeGreaterThan(0);
  expect(initFailed[0]).toBe('mic_init_failed:err=NotAllowedError');
  expect(
    all.some((x) => x === 'mic_lost:init_failed'),
    'mic_lost:init_failed 래치 이벤트가 없다',
  ).toBe(true);

  // ③ TTS 고지 — 현장은 화면을 안 본다. 문구 전문이 아니라 핵심 구(클립 미저장)로 단언한다.
  const spoken = await ttsLog(page);
  expect(
    spoken.some((t) => t.includes('음성 클립이 저장되지 않습니다')),
    `TTS 고지가 없다. 발화 목록: ${JSON.stringify(spoken)}`,
  ).toBe(true);

  // 🔴 v0.50 r2 [CF-4] — **이 경로의 경고는 하나여야 한다.**
  //   v0.50이 넣은 클립 실패 고지(`useClipFailureAlert`)가 종전엔 `micLost` 전반에 걸려 있어,
  //   init 실패에서도 거의 같은 뜻의 두 번째 문장(*"…저장되지 않고 **있습니다**…"*)이 연달아
  //   나가고 세션 시작 안내가 그만큼 밀렸다(리뷰 실측 3발화).
  //   ⚠️ 위 ③의 부분 매칭은 두 문구가 **안 겹쳐서** 그 회귀를 못 잡았다 — 그래서 계측으로 잠근다.
  expect(
    all.filter((x) => x.startsWith('clip_fail_alert')),
    '클립 실패 고지가 init 실패 경로에도 붙었다 — 같은 뜻의 문장이 두 번 나간다',
  ).toHaveLength(0);
  expect(
    spoken.filter((t) => t.includes('음성 클립이 저장되지 않고 있습니다')),
    `클립 연속 실패 문구가 init 실패 경로에서 발화됐다: ${JSON.stringify(spoken)}`,
  ).toHaveLength(0);
});

test('승인 경로(반증) — mic_init_failed 0건 · 배너 없음 · 경고 TTS 없음', async ({ page }) => {
  await bootAndStart(page, GUM_GRANT_SCRIPT);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 6000 });
  await page.waitForTimeout(1500); // fire-and-forget init 정착 + IDB flush 창.

  const all = await extras(page);
  expect(all.filter((x) => x.startsWith('mic_init_failed:')).length, '승인 경로에서 mic_init_failed가 났다').toBe(0);
  expect(all.some((x) => x.startsWith('mic_lost:')), '승인 경로에서 mic_lost 래치가 났다').toBe(false);
  await expect(page.locator('[data-testid="mic-reconnect-btn"]')).toHaveCount(0);
  const spoken = await ttsLog(page);
  expect(spoken.some((t) => t.includes('음성 클립이 저장되지 않습니다'))).toBe(false);
});
