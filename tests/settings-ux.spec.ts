/**
 * v0.32.0 설정탭 UX(Vance) — B1·B2·B3·B4 검증.
 *   B1 — 생성 게이트('설정값 확인')가 무스크롤: 테이블 본문 제거, 요약(SettingsSummary)만.
 *        ≤12컬럼(1줄씩)·15컬럼(2열 그리드) 둘 다 카드가 스크롤 없이 들어간다.
 *        게이트 안 "생성될 테이블 미리보기"로 닫기 전용 테이블 미리보기를 오버레이.
 *   B2 — 설정 요약 팝업(설정탭 전용): 로그인/시트/생성 상태 + 요약 + 다이얼 한 줄, 무스크롤.
 *        🔴 v0.45.0 UI①(민구 확정 08-05) — 상단 유틸리티 행('설정 요약'+'초기화')이 삭제돼
 *        유일 진입점은 생성 완료 액션바의 '설정요약'(settings-summary-shortcut)이다.
 *   B3 — 초기화: 기본값 복귀 + Google 로그인·시트 URL은 기본 보존, 체크박스로 opt-in 삭제.
 *        🔴 v0.46.0 WP-H(민구 지시 08-05) — 버튼 이름이 '초기화' → **'설정 초기화'**, 위치는
 *        하단 액션바 상시 2행(v0.45.0 UI①)에서 **스크롤 영역 맨 아래**로 내려갔다. testid·모달
 *        흐름은 불변. 위치 계약의 오라클은 v0440-c7-cleanup이 소유한다(여기선 존재·이름만 잰다).
 *   B4 — (폐기: v0.44.0 §C7 F25·F26, 민구 08-02) 이동 버튼·안내문구 → 3버튼 행으로 대체.
 *        C10(v0.34.0) 인라인 요약도 같은 회차에 폐기 — 두 테스트는 폐기 계약으로 갱신됐고,
 *        3버튼 행의 실동작 오라클은 v0440-c7-cleanup.spec.ts가 소유한다.
 *
 * 375×812 시뮬레이션(GL-005). 생성 게이트 테스트는 검증된 시트 출처를 v12 형식으로 시드한다.
 */
import { test, expect, type Page } from '@playwright/test';

import { BASE } from './baseUrl';
const STORE_KEY = 'agri-voicenote-settings-v3';
const PHONE_375 = { width: 375, height: 812 };

// settingsStore.ts MOCK_COLUMNS와 동일한 신규 설치 기본 10컬럼(시드용 사본).
const DEFAULT_COLUMNS = [
  { id: 'c1',  name: '조사일자', type: 'date',  input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' } },
  { id: 'c2',  name: '기준일자', type: 'date',  input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '2026-05-13' } },
  { id: 'c3',  name: '농가명',   type: 'text',  input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' } },
  { id: 'c4',  name: '라벨',     type: 'text',  input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: 'A' } },
  { id: 'c5',  name: '처리',     type: 'text',  input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '시험' } },
  { id: 'c6',  name: '조사나무', type: 'int',   input: 'auto', ttsAnnounce: true,  auto: { kind: 'seq', from: 1, to: 10 } },
  { id: 'c7',  name: '조사과실', type: 'int',   input: 'auto', ttsAnnounce: true,  auto: { kind: 'seq', from: 1, to: 5 } },
  { id: 'c8',  name: '횡경',     type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
  { id: 'c9',  name: '종경',     type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
  { id: 'c10', name: '비고',     type: 'text',  input: 'touch', ttsAnnounce: false, auto: { kind: 'fixed', value: '' } },
];

/** 2열 그리드 경로(>12컬럼) 검증용 — 기본 10 + 자동입력 텍스트 5 = 15컬럼. */
const FIFTEEN_COLUMNS = [
  ...DEFAULT_COLUMNS,
  ...Array.from({ length: 5 }, (_, i) => ({
    id: `x${i + 1}`, name: `추가항목${i + 1}`, type: 'text', input: 'auto',
    ttsAnnounce: false, auto: { kind: 'fixed', value: `값${i + 1}` },
  })),
];

const CONNECTED_SHEET = {
  sheetUrl: 'https://docs.google.com/spreadsheets/d/abc123def/edit',
  sheetTab: '시트1',
  columnsSheetId: 'abc123def',
  columnsSheetTab: '시트1',
};

// ─── helpers ─────────────────────────────────────────────────────────────────

/** localStorage 초기화 후 설정탭 진입(신규 설치 기본 상태). */
async function freshSettings(page: Page) {
  await page.setViewportSize(PHONE_375);
  await page.goto(BASE);
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(400);
  await page.locator('[data-testid="tab-settings"]').click();
  await page.waitForTimeout(300);
}

/** persist version 12 페이로드로 부분 상태를 시드하고 설정탭 진입. */
async function seedSettings(page: Page, state: Record<string, unknown>) {
  await page.setViewportSize(PHONE_375);
  await page.goto(BASE);
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(({ key, payload }) => {
    localStorage.clear();
    localStorage.setItem(key, JSON.stringify(payload));
  }, { key: STORE_KEY, payload: { state, version: 12 } });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(400);
  await page.locator('[data-testid="tab-settings"]').click();
  await page.waitForTimeout(300);
}

async function readStore(page: Page): Promise<{ version: number; state: Record<string, unknown> }> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), STORE_KEY);
}

/** "입력 테이블 생성"(또는 재생성) 클릭 → 게이트 오픈 대기. */
async function openGate(page: Page) {
  await page.locator('text=입력 테이블 생성').first().click();
  await page.waitForTimeout(400);
  await expect(page.locator('[data-testid="gate-card"]')).toBeVisible({ timeout: 3000 });
}

/** 카드 자신 + 내부 어디에도 세로 스크롤이 없어야 한다(무스크롤 원칙). */
async function expectNoScroll(page: Page, testid: string) {
  const card = page.locator(`[data-testid="${testid}"]`);
  const metrics = await card.evaluate((el) => {
    const scrollables = Array.from(el.querySelectorAll('*')).filter((n) => {
      const cs = getComputedStyle(n);
      return (
        (cs.overflowY === 'auto' || cs.overflowY === 'scroll') &&
        n.scrollHeight > n.clientHeight + 1
      );
    }).length;
    return { sh: el.scrollHeight, ch: el.clientHeight, scrollables };
  });
  console.log(`${testid}: scrollHeight=${metrics.sh} clientHeight=${metrics.ch} innerScrollables=${metrics.scrollables}`);
  expect(metrics.sh).toBeLessThanOrEqual(metrics.ch + 1);
  expect(metrics.scrollables).toBe(0);
}

// ─── B1. 게이트 무스크롤 ─────────────────────────────────────────────────────

test('B1 — 게이트(기본 10컬럼)가 스크롤 없이 다 보인다 + 제목/확인 버튼', async ({ page }) => {
  await seedSettings(page, { ...CONNECTED_SHEET, columns: DEFAULT_COLUMNS });
  await openGate(page);

  // 제목은 기존 그대로(v5-ui.spec.ts:176 정확 일치 보호).
  await expect(page.locator('text=입력 테이블 생성 — 설정값 확인')).toBeVisible();

  await expectNoScroll(page, 'gate-card');

  // 확인 버튼 문구 '이대로 생성'(마지막 '생성' 포함 버튼 = 게이트 확인 — 기존 헬퍼 호환).
  const confirmBtn = page.locator('button', { hasText: '이대로 생성' });
  await expect(confirmBtn).toBeVisible();
  const lastGen = page.locator('button', { hasText: '생성' }).last();
  await expect(lastGen).toHaveText(/이대로 생성/);
  console.log('✓ 게이트 무스크롤 + 이대로 생성 확인');
});

test('B1 — 게이트(15컬럼, 2열 그리드)도 스크롤 없이 다 보인다', async ({ page }) => {
  await seedSettings(page, { ...CONNECTED_SHEET, columns: FIFTEEN_COLUMNS, totalRows: 50 });
  await openGate(page);

  // 15컬럼 → 2열 그리드 경로. 그리드 셀에 추가 컬럼이 실제 렌더됐는지 확인.
  await expect(page.locator('[data-testid="gate-card"]')).toContainText('추가항목5');
  await expectNoScroll(page, 'gate-card');
  console.log('✓ 15컬럼 게이트 무스크롤(2열 그리드)');
});

test('B1 — 게이트의 "생성될 테이블 미리보기"로 테이블 미리보기 오버레이', async ({ page }) => {
  await seedSettings(page, { ...CONNECTED_SHEET, columns: DEFAULT_COLUMNS });
  await openGate(page);

  await page.locator('button', { hasText: '생성될 테이블 미리보기' }).click();
  await page.waitForTimeout(300);

  // 닫기 전용 미리보기(제목 정확 일치 — 게이트 버튼 문구와 구분)가 게이트 위에 열린다.
  const previewCard = page.locator('[data-testid="table-preview-card"]');
  await expect(previewCard).toBeVisible({ timeout: 2000 });
  await expect(page.getByText('테이블 미리보기', { exact: true })).toBeVisible();
  // 테이블 헤더(첫 컬럼명)가 실제 렌더된다.
  await expect(previewCard).toContainText('조사일자');

  // 닫으면 게이트는 그대로 남아 있다.
  await previewCard.locator('button', { hasText: '확인' }).click();
  await page.waitForTimeout(200);
  await expect(previewCard).toBeHidden();
  await expect(page.locator('[data-testid="gate-card"]')).toBeVisible();
  console.log('✓ 게이트 → 미리보기 오버레이 → 닫기 → 게이트 유지');
});

// ─── B2. 설정 요약 팝업 ──────────────────────────────────────────────────────

test('B2 — 설정 요약 팝업: 컬럼 수·행수·다이얼 표시 + 무스크롤 + 닫기', async ({ page }) => {
  // v0.45.0 UI①(민구 확정 08-05) — 상단 '설정 요약' 버튼(settings-summary-open)이 삭제돼
  // 유일 진입점은 생성 완료 액션바의 '설정요약'(settings-summary-shortcut)이다. 그래서 생성
  // 상태를 시드해 연다 — 팝업 내부 수치 계약 자체는 불변, 진입 경로만 바뀌었다.
  await seedSettings(page, { columns: DEFAULT_COLUMNS, totalRows: 50, tableGenerated: true });

  await page.locator('[data-testid="settings-summary-shortcut"]').click();
  await page.waitForTimeout(300);

  const modal = page.locator('[data-testid="settings-summary-modal"]');
  await expect(modal).toBeVisible({ timeout: 2000 });
  await expect(modal).toContainText('전체 항목');
  await expect(modal).toContainText('총 행수');
  await expect(modal).toContainText('인식 60%');   // recognitionTolerance 기본 0.60
  // 정당 파손(v0.45.0 UI①): 진입점이 생성 후에만 존재하므로 '미생성' 대신 생성 상태를 잰다.
  await expect(modal).toContainText('생성됨');
  await expect(modal).toContainText('미연결');      // 로그인/시트 미연결
  await expectNoScroll(page, 'settings-summary-card');

  await modal.locator('button', { hasText: '닫기' }).click();
  await page.waitForTimeout(200);
  await expect(modal).toBeHidden();
  console.log('✓ 설정 요약 팝업 표시·무스크롤·닫기(하단 설정요약 진입)');
});

// ─── B3. 초기화 ──────────────────────────────────────────────────────────────

const CUSTOMIZED_STATE = {
  columns: [...DEFAULT_COLUMNS, {
    id: 'x9', name: '임시항목', type: 'text', input: 'auto',
    ttsAnnounce: false, auto: { kind: 'fixed', value: 'tmp' },
  }],
  totalRows: 77,
  tableGenerated: true,
  fastRecognition: true,
  ttsRate: 1.3,
  recognitionTolerance: 0.8,
  beepVolume: 0.95, // v0.35.0 FIX-5 — 비기본 볼륨 시드(초기화가 기본 0.5로 복원하는지 검증)
  sessionCustomLabel: '내세션',
  googleConnected: true,
  userEmail: 'tester@example.com',
  sheetUrl: 'https://docs.google.com/spreadsheets/d/abc123def/edit',
  sheetTab: '시트1',
  columnsSheetId: 'abc123def',
  columnsSheetTab: '시트1',
  savedSheets: [{ name: '측정시트A', url: 'https://docs.google.com/spreadsheets/d/abc123def/edit', sheetId: 'abc123def', addedAt: 1 }],
};

test('B3 — 초기화(체크박스 없음): 기본값 복귀 + 로그인·시트 보존', async ({ page }) => {
  await seedSettings(page, CUSTOMIZED_STATE);

  await page.locator('[data-testid="settings-reset-open"]').click();
  await page.waitForTimeout(300);
  const modal = page.locator('[data-testid="settings-reset-modal"]');
  await expect(modal).toBeVisible({ timeout: 2000 });
  // 보존 항목 안내가 보인다.
  await expect(modal).toContainText('Google 로그인');

  await page.locator('[data-testid="settings-reset-confirm"]').click();
  await page.waitForTimeout(500);
  await expect(modal).toBeHidden();

  const stored = await readStore(page);
  // 초기화됨 — 기본값 복귀.
  expect(stored.state.totalRows).toBe(50);
  expect(stored.state.tableGenerated).toBe(false);
  expect(stored.state.fastRecognition).toBe(false);
  expect(stored.state.ttsRate).toBe(1.05);
  expect(stored.state.recognitionTolerance).toBe(0.6);
  expect(stored.state.beepVolume).toBe(0.5); // v0.35.0 FIX-5 — 볼륨도 기본값 복원
  expect(stored.state.sessionCustomLabel).toBeNull();
  expect((stored.state.columns as unknown[]).length).toBe(10); // 임시항목 제거 → 기본 10항목
  // 보존됨 — 로그인·시트(기본 opt-out).
  expect(stored.state.userEmail).toBe('tester@example.com');
  expect(stored.state.sheetUrl).toContain('abc123def');
  expect((stored.state.savedSheets as unknown[]).length).toBe(1);
  // 행수 힌트도 기본 50행으로 돌아온다(UI 검증).
  await expect(page.locator('text=생성 예정')).toContainText('50행');
  // 첫 진입 안내 배너 재노출(SETTINGS_TIP_SEEN_KEY 제거).
  await expect(page.locator('[data-testid="settings-first-tip"]')).toBeVisible();
  console.log('✓ 초기화: 기본값 복귀 + 로그인/시트 보존 + 안내 배너 재노출');
});

test('B3 — 초기화(체크박스 2개): 로그인 해제 + 시트 URL·저장 시트 삭제', async ({ page }) => {
  await seedSettings(page, CUSTOMIZED_STATE);

  await page.locator('[data-testid="settings-reset-open"]').click();
  await page.waitForTimeout(300);
  await expect(page.locator('[data-testid="settings-reset-modal"]')).toBeVisible({ timeout: 2000 });

  // 두 opt-in 체크박스 모두 선택(기본은 unchecked).
  const loginCb = page.locator('[data-testid="settings-reset-clear-login"]');
  const sheetsCb = page.locator('[data-testid="settings-reset-clear-sheets"]');
  await expect(loginCb).not.toBeChecked();
  await expect(sheetsCb).not.toBeChecked();
  await loginCb.check();
  await sheetsCb.check();

  // googleSignOut()은 토큰이 없으면 no-op — throw 없이 진행돼야 한다.
  await page.locator('[data-testid="settings-reset-confirm"]').click();
  await page.waitForTimeout(600);
  await expect(page.locator('[data-testid="settings-reset-modal"]')).toBeHidden();

  const stored = await readStore(page);
  expect(stored.state.googleConnected).toBe(false);
  expect(stored.state.userEmail).toBeNull();
  expect(stored.state.sheetUrl).toBe('');
  expect(stored.state.sheetTab).toBe('');
  expect((stored.state.savedSheets as unknown[]).length).toBe(0);
  expect(stored.state.totalRows).toBe(50);
  console.log('✓ 초기화 + opt-in 삭제: 로그인 해제 · 시트 URL/저장 시트 삭제');
});

// ─── C10(v0.34.0)·B4(v0.32.0) → 폐기: v0.44.0 §C7 F25·F26(민구 08-02) ────────

/** v0.44.0 §C7 F26 — C10 인라인 요약 폐기 계약. 🔴 v0.45.0 UI①(민구 08-05, 추가요청3) 갱신:
 *  상단 유틸리티 행까지 삭제돼 '설정 요약'(공백 포함 정확 문구) 상호작용 요소는 이제 **0개**다.
 *  요약 팝업의 유일 진입점은 생성 완료 액션바의 '설정요약'(무공백) — 미생성이면 진입점이 없다.
 *  (구 C10 계약과 summaryPills 헬퍼는 이 갱신에서 삭제 — 팝업 내부 수치는 B2가 계속 잰다.) */
test('C10 폐기(F26·WP-H) — 인라인 요약 부재 + "설정 요약" 진입점 0개(미생성) + 설정 초기화 존재', async ({ page }) => {
  await freshSettings(page);

  await expect(page.locator('[data-testid="settings-summary-inline"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="settings-summary-toggle"]')).toHaveCount(0);
  // 정당 파손(v0.45.0 UI①): 종전 "상단 버튼 1개(count==1)" 단언 뒤집기 — 상단 유틸리티 행 삭제.
  await expect(page.locator('button', { hasText: '설정 요약' })).toHaveCount(0);
  await expect(page.locator('[data-testid="settings-summary-open"]')).toHaveCount(0);
  // 미생성 상태에는 하단 바로가기도 없다(tableGenerated=true에서만 렌더) → 진입점 자체가 0개.
  await expect(page.locator('[data-testid="settings-summary-shortcut"]')).toHaveCount(0);
  // 🔴 v0.46.0 WP-H — '상시 2행' 계약은 철회됐다(정당 파손). '설정 초기화'는 스크롤 영역 맨
  //    아래로 내려갔다. 여기서 재는 것은 **존재와 이름**뿐이고, 위치 계약은 v0440-c7-cleanup이
  //    소유한다(조상 스크롤 컨테이너 소속 + Footer보다 뒤). 미생성 상태에도 존재한다는 축은 유지.
  await expect(page.locator('[data-testid="settings-reset-open"]')).toHaveText('설정 초기화');
  console.log('✓ C10 폐기+WP-H — 인라인·상단 진입점 없음, 미생성 진입점 0개, 설정 초기화 존재');
});

/** v0.44.0 §C7 F25·F26 — B4 폐기 계약: 안내문구·"입력탭으로 이동 →" 삭제, 그 자리 3버튼
 *  (설정요약·생성 테이블 보기·재생성). 종전 "총 N행 생성됨 (미리보기)"/"재생성" 행도 이 3버튼
 *  행으로 재배치됐다. 3버튼 실동작은 v0440-c7-cleanup.spec.ts가 잰다. */
test('B4 폐기(F25·F26) — 생성 완료 시 이동 버튼·안내문구 대신 3버튼 행', async ({ page }) => {
  await seedSettings(page, {
    ...CONNECTED_SHEET,
    columns: DEFAULT_COLUMNS,
    totalRows: 50,
    tableGenerated: true,
  });

  await expect(page.locator('[data-testid="settings-go-input"]')).toHaveCount(0);
  await expect(page.getByText('입력탭으로 이동')).toHaveCount(0);
  await expect(page.getByText('생성 완료 — 입력 탭에서')).toHaveCount(0);
  await expect(page.getByText('생성됨')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '설정요약', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '생성 테이블 보기', exact: true })).toBeVisible();
  // 🔴 v0.46.0 WP-H — '재생성' → '테이블 재생성'(민구 지시 08-05). 기대값을 되돌리지 마라.
  await expect(page.getByRole('button', { name: '테이블 재생성', exact: true })).toBeVisible();
  // 🔴 v0.46.0 WP-H — '초기화 상시 2행' 철회. 존재·이름만 재고 위치는 v0440-c7-cleanup이 잰다.
  await expect(page.locator('[data-testid="settings-reset-open"]')).toHaveText('설정 초기화');
  console.log('✓ B4 폐기+WP-H — 3버튼 행(설정요약·생성 테이블 보기·테이블 재생성) + 설정 초기화');
});
