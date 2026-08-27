/**
 * v0.44.0 §C8 F23·F27(UI 경로)·F28 오라클 — red-first (민구 확정 2026-08-02)
 *
 * F23 — 시트 동기화 상태를 **화면 중앙 큰 팝업**으로.
 *   ① 업로드 중 모달("시트에 추가중") 존재 · ② 성공 시 자동 닫힘(count 0) ·
 *   ③ 실패 주입 시 사유 + `재시도`/`나중에` 두 버튼. 반증: 팝업 렌더를 지우면 red.
 *
 * F27 — 날짜 컬럼 "지정" 기본값 = 오늘이 속한 **일요일 시작 주의 화요일**.
 *   함수 오라클은 tests/weekTuesday.spec.ts([node] 단위)가 3요일 고정 입력으로 잰다.
 *   여기서는 설정탭 UI 경로 1건: page.clock으로 2026-08-02(일)를 고정하고
 *   ① 기본 컬럼 '기준일자'(c2)의 지정 날짜가 08-04, ② '조사일자'(c1) 오늘→지정 전환 기본값이 08-04.
 *
 * F28 — 날짜(달력일)가 바뀌면 입력값 설정을 기본값으로 자동 복원.
 *   설정 스토어가 입력값 설정 최종 손질 날짜(inputSettingsDate)를 영속하고, 부팅 시 오늘과 다르면
 *   초기화 패치를 자동 적용한다. 🔴 제외 3항목(로그인정보·구글시트 주소·시트 선택 탭)은 불변.
 *   반증: 제외 항목이 초기화되면 red / 같은 날짜 재부팅에 초기화가 돌면 red.
 *
 * Mock: sheets.googleapis.com(헤더/append)·www.googleapis.com(Drive 백업)은 page.route stub —
 * sync-token-expiry.spec 패턴. 세션 시딩은 fixtures/idb(APPLY_APP_SCHEMA_SOURCE).
 */
import { test, expect, type Page } from '@playwright/test';
import { IDB, APPLY_APP_SCHEMA_SOURCE } from './fixtures/idb';
import { BASE } from './baseUrl';

test.setTimeout(60_000);

const STORE_KEY = 'agri-voicenote-settings-v3';

// ─── F23 하네스 ─────────────────────────────────────────────────────────────

const F23_SHEET_ID = 'SHEET_C8_F23';

const F23_SETTINGS = {
  state: {
    sheetUrl: `https://docs.google.com/spreadsheets/d/${F23_SHEET_ID}/edit`,
    sheetTab: 'Sheet1',
    savedSheets: [
      { name: '감귤조사', url: `https://docs.google.com/spreadsheets/d/${F23_SHEET_ID}/edit`, sheetId: F23_SHEET_ID, addedAt: 1781000000000 },
    ],
    recognitionTolerance: 0.6,
    columns: [
      { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 } },
      { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
    ],
  },
  version: 13,
};

function makeF23Session() {
  return {
    id: 'sess-c8-f23',
    date: '2026-08-04',
    label: 'F23테스트',
    target: { spreadsheetId: F23_SHEET_ID, sheetTab: 'Sheet1' },
    columns: F23_SETTINGS.state.columns,
    rows: [
      { index: 1, values: { c6: '1', c8: '11.1' }, complete: true },
      { index: 2, values: { c6: '2', c8: '22.2' }, complete: true },
    ],
    completedRows: 2,
    syncedRows: 0,
    startedAt: 1781000000000,
    finishedAt: 1781000600000,
  };
}

interface SheetStubControl {
  calls: Array<{ method: string; url: string }>;
  /** append 응답 모드 — 테스트 중간에 갈아끼울 수 있다(재시도 검증). */
  mode: { appendDelayMs: number; failAppend: boolean };
}

/** 헤더 GET + append stub. Drive(www.googleapis.com)도 stub해 백업 레그가 즉시 성공한다. */
async function stubSheetsAndDrive(page: Page): Promise<SheetStubControl> {
  const ctl: SheetStubControl = { calls: [], mode: { appendDelayMs: 0, failAppend: false } };
  await page.route('**://www.googleapis.com/**', (route) =>
    route.fulfill({ json: { id: 'stub', files: [{ id: 'stub' }] } }));
  let nextAppendRow = 2;
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    const req = route.request();
    ctl.calls.push({ method: req.method(), url: req.url() });
    if (req.url().includes(':append')) {
      if (ctl.mode.appendDelayMs > 0) {
        await new Promise((r) => setTimeout(r, ctl.mode.appendDelayMs));
      }
      if (ctl.mode.failAppend) {
        await route.fulfill({ status: 500, body: 'boom' });
        return;
      }
      const body = req.postDataJSON() as { values: unknown[][] };
      const first = nextAppendRow;
      const last = nextAppendRow + body.values.length - 1;
      nextAppendRow = last + 1;
      await route.fulfill({ json: { updates: { updatedRange: `Sheet1!A${first}:B${last}`, updatedRows: body.values.length } } });
      return;
    }
    if (req.method() === 'GET') {
      await route.fulfill({ json: { values: [['조사나무', '횡경']] } });
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected' });
  });
  return ctl;
}

/** 유효 토큰 + 설정 + IDB 세션 시딩 후 데이터탭 진입. */
async function seedF23(page: Page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async ({ sess, settings, idb, schemaSrc }) => {
    localStorage.clear();
    localStorage.setItem('gs10_google_token', JSON.stringify({
      access_token: 'test-token', expires_at: Date.now() + 3600_000, email: 'tester@example.com',
    }));
    localStorage.setItem('agri-voicenote-settings-v3', JSON.stringify(settings));
    // ⚠️ deleteDatabase 금지 — 부팅된 앱이 연결을 쥐고 있어 blocked로 영원히 대기한다.
    //    sync-token-expiry 패턴: 앱 DB를 그대로 열어 세션만 upsert(신규 컨텍스트라 잔재 없음).
    await new Promise<void>((resolve) => {
      const applySchema = (0, eval)(`(${schemaSrc})`) as (db: IDBDatabase) => void;
      const open = indexedDB.open(idb.name, idb.version);
      open.onupgradeneeded = () => applySchema(open.result);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('sessions', 'readwrite');
        tx.objectStore('sessions').put(sess);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); resolve(); };
      };
      open.onerror = () => resolve();
    });
  }, { sess: makeF23Session(), settings: F23_SETTINGS, idb: IDB, schemaSrc: APPLY_APP_SCHEMA_SOURCE });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-data"]').click();
  await page.waitForTimeout(300);
}

async function openSyncAndConfirm(page: Page) {
  await page.locator('text=시트에 추가').first().click();
  await page.waitForTimeout(200);
  await page.locator('button:has-text("추가 (")').click();
}

test('F23 — 업로드 중 큰 팝업("시트에 추가중") 존재, 성공 시 자동 닫힘(count 0)', async ({ page }) => {
  const ctl = await stubSheetsAndDrive(page);
  ctl.mode.appendDelayMs = 1500; // 업로드 중 상태를 관측할 창
  await seedF23(page);

  await openSyncAndConfirm(page);

  // ① 업로드 중 — 화면 중앙 모달 존재 + 큰 문구 "시트에 추가중".
  const modal = page.locator('[data-testid="sync-status-modal"]');
  await expect(modal).toBeVisible({ timeout: 3000 });
  await expect(modal).toContainText('시트에 추가중');

  // ② 성공 시 자동 닫힘 — append 완료(+Drive 백업 stub) 후 모달 count 0.
  await expect(modal).toHaveCount(0, { timeout: 15_000 });

  // 성공 배너는 기존대로 표면화(작은 줄 배너 계약 보존).
  await expect(page.locator('text=행 추가').first()).toBeVisible();
  expect(ctl.calls.filter((c) => c.url.includes(':append')).length).toBeGreaterThanOrEqual(1);
});

test('F23 — 실패 주입 시 사유 + [재시도]/[나중에] 두 버튼, 재시도가 재업로드를 수행', async ({ page }) => {
  const ctl = await stubSheetsAndDrive(page);
  ctl.mode.failAppend = true; // 500 주입(401/403 아님 — 로그인 팝업 경로와 분리)
  await seedF23(page);

  await openSyncAndConfirm(page);

  // 실패 화면 — 사유 텍스트 + 두 버튼.
  const modal = page.locator('[data-testid="sync-status-modal"]');
  await expect(modal).toBeVisible({ timeout: 8000 });
  const reason = modal.locator('[data-testid="sync-status-reason"]');
  await expect(reason).toBeVisible();
  await expect(reason).not.toHaveText('');
  const retryBtn = modal.locator('button', { hasText: '재시도' });
  const laterBtn = modal.locator('button', { hasText: '나중에' });
  await expect(retryBtn).toBeVisible();
  await expect(laterBtn).toBeVisible();

  // [재시도] — stub을 성공 모드로 바꾸고 클릭 → 재업로드 후 자동 닫힘 + 성공 배너.
  const failedAppends = ctl.calls.filter((c) => c.url.includes(':append')).length;
  expect(failedAppends).toBeGreaterThanOrEqual(1);
  ctl.mode.failAppend = false;
  await retryBtn.click();
  await expect(modal).toHaveCount(0, { timeout: 15_000 });
  expect(ctl.calls.filter((c) => c.url.includes(':append')).length).toBeGreaterThan(failedAppends);
  await expect(page.locator('text=행 추가').first()).toBeVisible();
});

test('F23 — 실패 팝업 [나중에]는 팝업만 닫는다(재업로드 없음, 배너는 유지)', async ({ page }) => {
  const ctl = await stubSheetsAndDrive(page);
  ctl.mode.failAppend = true;
  await seedF23(page);

  await openSyncAndConfirm(page);

  const modal = page.locator('[data-testid="sync-status-modal"]');
  await expect(modal).toBeVisible({ timeout: 8000 });
  // 실패 모달이 뜬 뒤에도 진행 중이던 업로드 루틴의 마지막 :append가 늦게 도착할 수 있다
  // (3회 반복 실측 2/3 재현). 스냅샷은 호출 수가 500ms 동안 불변일 때 뜬다 — 이 대기가 없으면
  // "재업로드 없음" 단언이 자기 스냅샷 경합을 재는 꼴이 된다.
  let appendsBefore = -1;
  await expect(async () => {
    const now = ctl.calls.filter((c) => c.url.includes(':append')).length;
    if (now !== appendsBefore) {
      appendsBefore = now;
      throw new Error('append 아직 진행 중');
    }
  }).toPass({ timeout: 8000, intervals: [500] });
  await modal.locator('button', { hasText: '나중에' }).click();
  await expect(modal).toHaveCount(0);
  await page.waitForTimeout(400);
  // 재업로드가 일어나지 않았고, 실패 사실은 작은 줄 배너에 남는다(조용한 실패 금지).
  expect(ctl.calls.filter((c) => c.url.includes(':append')).length).toBe(appendsBefore);
  await expect(page.locator('text=실패').first()).toBeVisible();
});

// ─── F27 — 설정탭 UI 경로 ───────────────────────────────────────────────────

test('F27 — 2026-08-02(일) 고정: 기준일자 기본값·조사일자 지정 전환 기본값 = 08-04(화)', async ({ page }) => {
  // page.clock으로 시스템 시간을 일요일로 고정 — '오늘' 파생 기본값이 결정론이 된다.
  // (문자열에 타임존 미표기 → 러너 로컬 기준. 제품 코드도 로컬 날짜 부품을 쓴다.)
  await page.clock.install({ time: new Date('2026-08-02T10:00:00') });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.clear();
    indexedDB.deleteDatabase('agri-voicenote');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500); // 기본 탭 = 설정

  // ① 신규 설치 기본 컬럼 c2(기준일자)의 지정 날짜 = 이번 주(일 시작) 화요일.
  //    🔴 월요일 시작으로 바꾸면 07-28이 나와 red.
  await expect(page.locator('[data-testid="date-picker-c2"]')).toHaveValue('2026-08-04');

  // ② c1(조사일자) '오늘' → '지정' 전환 시 기본값도 화요일(전환 시점 자동 채움).
  const c1Card = page.locator('[data-testid="col-card-c1"]');
  await c1Card.scrollIntoViewIfNeeded();
  await c1Card.locator('[data-testid="date-mode-c1"] button', { hasText: '지정' }).click();
  await expect(page.locator('[data-testid="date-picker-c1"]')).toHaveValue('2026-08-04');
});

// ─── F28 하네스 ─────────────────────────────────────────────────────────────

const F28_SHEET_ID = 'SHEET_C8_F28';
const F28_SHEET_URL = `https://docs.google.com/spreadsheets/d/${F28_SHEET_ID}/edit`;

/** 기본값이 아닌 입력값 설정 + 제외 3항목(로그인·시트 주소·시트 탭)이 채워진 시드.
 *  inputSettingsDate는 각 테스트가 주입한다(과거 날짜 vs 오늘). */
function f28Settings(inputSettingsDate: string) {
  return {
    state: {
      googleConnected: true,
      userEmail: 'tester@example.com',
      sheet: null,
      sheetUrl: F28_SHEET_URL,
      sheetTab: '측정',
      columnsSheetId: F28_SHEET_ID,
      columnsSheetTab: '측정',
      availableSheets: ['측정', '요약'],
      savedSheets: [
        { name: '감귤조사', url: F28_SHEET_URL, sheetId: F28_SHEET_ID, addedAt: 1781000000000 },
      ],
      manualMode: false,
      columns: [
        { id: 'k1', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 3, to: 9 } },
        { id: 'k2', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
      ],
      tableGenerated: true,
      totalRows: 7,
      ttsRate: 1.5,
      recognitionTolerance: 0.8,
      sessionLabelColId: null,
      sessionAutoLabel: '2026-08-01 조사',
      sessionCustomLabel: '주간조사',
      fastRecognition: true,
      autoScreenCapture: false,
      beepVolume: 0.9,
      preferredVoiceName: '유나',
      roundDateColId: null,
      inputSettingsDate,
    },
    version: 13,
  };
}

/** 토큰(로그인정보 불변 판정용) + 설정 시딩 후 재부팅. inputSettingsDate는 브라우저에서 계산해
 *  주입할 수 있게 함수로 받는다('today' 케이스는 러너/브라우저 시계 차이를 없애기 위함). */
async function seedF28AndBoot(page: Page, dateMode: 'past' | 'today') {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ mode, sheetUrl, sheetId }) => {
    localStorage.clear();
    localStorage.setItem('gs10_google_token', JSON.stringify({
      access_token: 'test-token', expires_at: Date.now() + 3600_000, email: 'tester@example.com',
    }));
    const d = new Date();
    const todayIso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const stamp = mode === 'past' ? '2026-01-05' : todayIso;
    // f28Settings와 동일 형태를 브라우저 쪽에서 조립(오늘 날짜 계산이 브라우저 시계 기준이어야 해서).
    const settings = {
      state: {
        googleConnected: true,
        userEmail: 'tester@example.com',
        sheet: null,
        sheetUrl,
        sheetTab: '측정',
        columnsSheetId: sheetId,
        columnsSheetTab: '측정',
        availableSheets: ['측정', '요약'],
        savedSheets: [{ name: '감귤조사', url: sheetUrl, sheetId, addedAt: 1781000000000 }],
        manualMode: false,
        columns: [
          { id: 'k1', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 3, to: 9 } },
          { id: 'k2', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
        ],
        tableGenerated: true,
        totalRows: 7,
        ttsRate: 1.5,
        recognitionTolerance: 0.8,
        sessionLabelColId: null,
        sessionAutoLabel: '2026-08-01 조사',
        sessionCustomLabel: '주간조사',
        fastRecognition: true,
        autoScreenCapture: false,
        beepVolume: 0.9,
        preferredVoiceName: '유나',
        roundDateColId: null,
        inputSettingsDate: stamp,
      },
      version: 13,
    };
    localStorage.setItem('agri-voicenote-settings-v3', JSON.stringify(settings));
    indexedDB.deleteDatabase('agri-voicenote');
  }, { mode: dateMode, sheetUrl: F28_SHEET_URL, sheetId: F28_SHEET_ID });
  await page.reload({ waitUntil: 'domcontentloaded' });
}

async function readPersistedState(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw).state as Record<string, unknown>) : {};
  }, STORE_KEY);
}

test('F28 — 날짜가 바뀐 뒤 부팅: 입력값 설정은 기본값 복귀, 제외 3항목(로그인·시트 주소·탭)은 불변', async ({ page }) => {
  await seedF28AndBoot(page, 'past'); // 입력값 설정 날짜 = 2026-01-05(과거)

  // 자동 초기화가 영속본에 반영될 때까지 대기(ttsRate 기본값 복귀가 신호).
  await page.waitForFunction((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const st = JSON.parse(raw).state;
    return st.ttsRate === 1.05 && st.tableGenerated === false;
  }, STORE_KEY, { timeout: 8000 });

  const st = await readPersistedState(page);

  // ── 입력값 설정: 기본값 복귀(리터럴 단언 — 제품 상수 import 금지) ──
  expect(st.tableGenerated).toBe(false);
  expect(st.totalRows).toBe(50);
  expect(st.ttsRate).toBe(1.05);
  expect(st.recognitionTolerance).toBe(0.6);
  expect(st.fastRecognition).toBe(false);
  expect(st.autoScreenCapture).toBe(true);
  expect(st.beepVolume).toBe(0.5);
  expect(st.preferredVoiceName).toBe('');
  expect(st.sessionCustomLabel).toBeNull();
  expect(st.sessionAutoLabel).toBeNull();
  // 컬럼도 기본 컬럼(신규 설치 10개)으로 복귀 — 시드했던 k1/k2가 남아 있으면 red.
  const cols = st.columns as Array<{ id: string; name: string }>;
  expect(cols.length).toBe(10);
  expect(cols.some((c) => c.id === 'k1' || c.id === 'k2')).toBe(false);
  expect(cols[0].name).toBe('조사일자');
  // 컬럼과 출처는 함께 움직인다(v0.38.0 리뷰#3 불변식).
  expect(st.columnsSheetId).toBeNull();
  expect(st.columnsSheetTab).toBeNull();
  // 스탬프는 소거 — 다음 날 재부팅에서 반복 발동하지 않는다.
  expect(st.inputSettingsDate).toBeNull();

  // ── 🔴 제외 3항목 불변 — 하나라도 초기화되면 red ──
  expect(st.googleConnected).toBe(true);                 // 로그인정보
  expect(st.userEmail).toBe('tester@example.com');
  expect(st.sheetUrl).toBe(F28_SHEET_URL);               // 구글시트 주소
  const saved = st.savedSheets as Array<{ sheetId: string }>;
  expect(saved.length).toBe(1);
  expect(saved[0].sheetId).toBe(F28_SHEET_ID);
  expect(st.sheetTab).toBe('측정');                       // 시트 선택 탭
  expect(st.availableSheets).toEqual(['측정', '요약']);
});

test('F28 — 같은 날짜 재부팅은 초기화가 돌지 않는다(입력값 설정 유지)', async ({ page }) => {
  await seedF28AndBoot(page, 'today'); // 입력값 설정 날짜 = 오늘(브라우저 시계 기준)

  // 초기화가 돌았다면 곧바로 영속본이 바뀌므로, 넉넉히 기다린 뒤 원값 유지를 단언한다.
  await page.waitForTimeout(1500);
  const st = await readPersistedState(page);
  expect(st.ttsRate).toBe(1.5);
  expect(st.tableGenerated).toBe(true);
  expect(st.totalRows).toBe(7);
  expect(st.sessionCustomLabel).toBe('주간조사');
  const cols = st.columns as Array<{ id: string }>;
  expect(cols.some((c) => c.id === 'k1')).toBe(true);
});
