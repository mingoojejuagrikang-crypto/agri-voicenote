/**
 * v0.46.0 WP-J — 시트 **요청 범위** 계약 + 제외 목록 persist 하이드레이션.
 *
 * 🔴 왜 이 파일이 따로 있나: `v0460-wp-j-options.spec.ts`는 정렬·제외를 순수 함수로 재지만
 * **범위(`A2:A`·`A1:Z`)는 재지 못한다.** 범위를 `A2:A501`/`A1:Z1001`로 되돌려도 그 13건은 전부
 * 통과한다 — 그런데 그 한 줄이 민구 버그("리스트 값이 갱신되지 않는다")를 실제로 닫는 줄이다.
 * 정렬과 같은 이유로 오라클이 필요하다: 범위는 화면에 안 보이고, 좁아져도 목록은 그럴듯해 보인다.
 *
 * `authFetch`가 localStorage 토큰을 읽어 Node 스텁으로는 잴 수 없으므로 브라우저에서
 * `page.route`로 실제 요청 URL을 가로챈다(sync-header-mapping.spec.ts 패턴).
 */
import { test, expect, type Page } from '@playwright/test';
import { BASE } from './baseUrl';

test.setTimeout(60_000);

const STORE_KEY = 'agri-voicenote-settings-v3';
const SHEET_ID = 'WPJ_RANGE_SHEET';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;
const HEADERS = ['조사일자', '농가명', '횡경'];
/** 농가명은 헤더 index 1 → A1 표기로 B열. */
const FARM_COL_LETTER = 'B';

/** 시트에 쌓인 농가명(위에서 아래 = 오래된 것 → 최근). 마지막 것이 가장 최근이다. */
const FARMS_IN_SHEET = ['이원창', '이원창', '강남호', '위미리3407'];

async function seedSettings(page: Page, state: Record<string, unknown>): Promise<void> {
  await page.addInitScript(
    ({ key, seeded }) => {
      localStorage.setItem('gs10_google_token', JSON.stringify({
        access_token: 'wpj-range-token',
        expires_at: Date.now() + 3_600_000,
        email: 'tester@example.com',
      }));
      localStorage.setItem(key, JSON.stringify({ state: seeded, version: 12 }));
    },
    { key: STORE_KEY, seeded: state },
  );
}

/** 기본 시드 — optionExclusions를 **일부러 넣지 않는다**(구버전 저장본 재현, 아래 하이드레이션 테스트). */
function baseState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    googleConnected: true,
    userEmail: 'tester@example.com',
    sheetUrl: SHEET_URL,
    sheetTab: '탭1',
    columnsSheetId: SHEET_ID,
    columnsSheetTab: '탭1',
    availableSheets: ['탭1', '탭2'],
    savedSheets: [{ name: '레인지시트', url: SHEET_URL, sheetId: SHEET_ID, addedAt: 1 }],
    columns: [
      { id: 'seed-date', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' } },
      { id: 'seed-farm', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' } },
      { id: 'seed-width', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
    ],
    tableGenerated: false,
    ...overrides,
  };
}

/** 가로챈 `values` 요청의 A1 범위(디코드된 것)를 순서대로 모은다. */
async function mockSheetsRecordingRanges(page: Page): Promise<string[]> {
  const ranges: string[] = [];
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    if (!path.includes('/values/')) {
      await route.fulfill({ json: {
        spreadsheetId: SHEET_ID,
        properties: { title: '레인지시트' },
        sheets: ['탭1', '탭2'].map((title, index) => ({ properties: { sheetId: index, title, index } })),
      } });
      return;
    }
    const range = path.split('/values/')[1] ?? '';
    ranges.push(range);
    // 한 컬럼만 요청하는 것(선택지 조회)과 헤더+표본 요청을 범위 모양으로 가른다.
    if (range.includes(`!${FARM_COL_LETTER}`)) {
      await route.fulfill({ json: { values: FARMS_IN_SHEET.map((f) => [f]) } });
      return;
    }
    // 헤더 + 표본. 🔴 **농가명이 「반복」되어야 리스트로 승격돼 선택지 조회가 이어진다.**
    //    v0.46.0 콜드 리뷰 L2-1 처방으로 승격 기준이 「고유값 2~20개」에서 **평균 반복 ≥ 2회**로
    //    바뀌었다(`sheets.ts: OPTIONS_MIN_REPEAT`). 종전 픽스처는 2행·고유값 2개라 평균 1.0이어서
    //    승격되지 않고, 그러면 `fetchColumnUniqueValues`가 **아예 호출되지 않아** 이 오라클이
    //    측정 대상 자체를 잃는다(정당 파손 — 픽스처를 새 계약에 맞춘다).
    //    ⚠️ 표본이 작으면 반복이 관측되지 않는 것은 **의도된 보수성**이다: 자유서술 칸에 자동값이
    //       합성돼 시트에 기록되는 것(critical)을 막는 대가다. 데이터가 쌓인 뒤 재유추하면 승격된다.
    await route.fulfill({ json: { values: [
      HEADERS,
      ['2026-08-01', '이원창', '111.1'],
      ['2026-08-02', '강남호', '222.2'],
      ['2026-08-03', '이원창', '333.3'],
      ['2026-08-04', '강남호', '444.4'],
    ] } });
  });
  return ranges;
}

async function openSettings(page: Page): Promise<void> {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="tab-settings"]').click();
}

async function readColumns(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate((key) => {
    const stored = JSON.parse(localStorage.getItem(key) ?? 'null');
    return stored?.state?.columns ?? [];
  }, STORE_KEY);
}

function farmColumn(columns: Array<Record<string, unknown>>): Record<string, unknown> {
  const col = columns.find((c) => c.name === '농가명');
  if (!col) throw new Error('농가명 컬럼을 찾을 수 없습니다.');
  return col;
}

/** 탭을 바꿔 loadHeaders(헤더+표본 → 선택지 조회) 파이프라인을 태운다. */
async function switchTab(page: Page): Promise<void> {
  await page.locator('select:has(option[value="탭2"])').selectOption('탭2');
}

// ─── J-1 범위 오라클 ─────────────────────────────────────────────────────────

test('J-1 — 선택지는 **열 전체**(A2:A)를 읽는다. 500행 상한으로 되돌리면 깨진다', async ({ page }) => {
  await seedSettings(page, baseState());
  const ranges = await mockSheetsRecordingRanges(page);
  await openSettings(page);
  await switchTab(page);

  await expect.poll(() => ranges.some((r) => r.includes(`!${FARM_COL_LETTER}2:`))).toBe(true);
  const columnRange = ranges.find((r) => r.includes(`!${FARM_COL_LETTER}2:`))!;

  // 🔑 끝에 행 번호가 붙으면 안 된다. `'탭2'!B2:B501`이면 이 단언이 실패한다.
  expect(columnRange).toMatch(/!B2:B$/);
  expect(columnRange).not.toMatch(/\d$/);
});

test('J-1b — 타입 추론 표본은 **행 상한 없이**(A1:Z) 읽는다. 1,000행으로 되돌리면 깨진다', async ({ page }) => {
  await seedSettings(page, baseState());
  const ranges = await mockSheetsRecordingRanges(page);
  await openSettings(page);
  await switchTab(page);

  await expect.poll(() => ranges.some((r) => r.includes('!A1:Z'))).toBe(true);
  const sampleRange = ranges.find((r) => r.includes('!A1:Z'))!;

  // `'탭2'!A1:Z1001`이면 실패한다.
  expect(sampleRange).toMatch(/!A1:Z$/);
});

test('J-1 — 파이프라인 끝까지: 저장된 선택지가 최근 등장 우선으로 들어간다', async ({ page }) => {
  await seedSettings(page, baseState());
  await mockSheetsRecordingRanges(page);
  await openSettings(page);
  await switchTab(page);

  // 시트 순서는 이원창·이원창·강남호·위미리3407 → 최근순이면 뒤집혀야 하고,
  // 빈도순이었다면 2회 등장한 '이원창'이 맨 앞이었을 것이다.
  await expect.poll(async () => {
    const col = farmColumn(await readColumns(page)) as { auto?: { available?: string[] } };
    return col.auto?.available ?? [];
  }).toEqual(['위미리3407', '강남호', '이원창']);
});

// ─── J-5 persist 하이드레이션 ────────────────────────────────────────────────

test('J-5 — optionExclusions가 **없는** 구버전 저장본에서도 시트 연결이 성립한다', async ({ page }) => {
  // 계약 #3(persist 스키마 변경) 가드. 이 키가 undefined로 하이드레이트되면
  // loadHeaders의 Object.keys(...)와 OptionsPanel의 map 접근이 **둘 다 터져** 시트 연결이 죽는다.
  // baseState()는 optionExclusions를 일부러 넣지 않는다 = version 12 구버전 저장본 재현.
  await seedSettings(page, baseState());
  await mockSheetsRecordingRanges(page);
  await openSettings(page);
  await switchTab(page);

  await expect.poll(async () => {
    const col = farmColumn(await readColumns(page)) as { type?: string };
    return col.type;
  }).toBe('options');

  const stored = await page.evaluate((key) => {
    const s = JSON.parse(localStorage.getItem(key) ?? 'null');
    return s?.state?.optionExclusions;
  }, STORE_KEY);
  expect(stored).toEqual({}); // 기본값으로 치유돼 저장된다
});

test('J-5 — 지운 선택지는 재연결해도 돌아오지 않는다(끝에서 끝까지)', async ({ page }) => {
  await seedSettings(page, baseState());
  await mockSheetsRecordingRanges(page);
  await openSettings(page);
  await switchTab(page);

  await expect.poll(async () => {
    const col = farmColumn(await readColumns(page)) as { auto?: { available?: string[] } };
    return col.auto?.available?.length ?? 0;
  }).toBe(3);

  // 유추된 컬럼 id는 이름 해시라 스토어에서 읽어 쓴다.
  const farmId = (farmColumn(await readColumns(page)) as { id: string }).id;

  // 🔴 v0.46.1 WP-7(민구 방향 전환 08-07) — **삭제 흐름이 바뀌었다.**
  //    구 J-4: 지울 값을 입력창에 정확히 타이핑 → 버튼이 「삭제」로 변함 → 클릭.
  //    신 방식: **입력창을 비운 채 「삭제」** → 칩 앞에 `×` → **그 칩을 탭**.
  //    이유는 현장이다 — 장갑 낀 손으로 긴 값을 오타 없이 치는 것이 삭제보다 어려웠다.
  //    ⚠️ 이 테스트의 본질(J-5: 지운 값은 재연결해도 안 돌아온다)은 그대로다. 경로만 바뀐다.
  await expect(page.locator(`[data-testid="opt-input-${farmId}"]`)).toHaveValue('');
  // v0.48.1 P2 재작업(리뷰 F2/U5, 민구 2차 결정) — 버튼은 **전 상태**에서 「추가/삭제」 두 단어다
  // (하이라이트만 모드에 따라 바뀐다, 「취소」 문구는 폐지). toHaveText는 두 span의 textContent를
  // 이어붙여 비교하므로 기본 상태도 delete모드 상태도 똑같이 '추가/삭제'를 기대한다.
  await expect(page.locator(`[data-testid="opt-apply-${farmId}"]`)).toHaveText('추가/삭제');
  // v0.48.1 리뷰 F3/U4 — aria-label이 화면 어휘와 같은지 잠근다(스크린리더가 존재하지 않는
  // 단독 「삭제」 버튼을 가리키던 결함, F3). 기본 상태에선 삭제모드 진입 결과를 안내한다.
  await expect(page.locator(`[data-testid="opt-apply-${farmId}"]`))
    .toHaveAccessibleName('「추가/삭제」 — 누르면 삭제 모드로 바뀝니다. 그 다음 지울 값을 누르세요');
  await page.locator(`[data-testid="opt-apply-${farmId}"]`).click();
  // 삭제 모드 진입 표식 — 칩 앞 `×`가 실제로 뜬다.
  await expect(page.locator(`[data-testid="opt-del-mark-${farmId}-강남호"]`)).toBeVisible();
  // 🔴 v0.48.1 재작업의 핵심 회귀축 — 삭제모드 **중에도** 버튼 글자는 여전히 '추가/삭제'다
  // (종전엔 이 상태에서 '취소'로 바뀌었다). 옛 문구로 되돌리면 이 줄이 깨진다(반증 확인됨).
  await expect(page.locator(`[data-testid="opt-apply-${farmId}"]`)).toHaveText('추가/삭제');
  // U4 — 삭제모드 aria-label도 새 어휘로 동기화됐는지("취소됩니다" 잔존 금지).
  await expect(page.locator(`[data-testid="opt-apply-${farmId}"]`))
    .toHaveAccessibleName('「추가/삭제」 — 삭제 모드입니다. 지울 값을 누르세요. 이 버튼을 다시 누르면 삭제 모드가 꺼집니다');
  await page.locator(`[data-testid="opt-chip-${farmId}-강남호"]`).click();
  // 민구 지정 — 1건 삭제되면 모드가 꺼진다(오탭 1회가 2건을 지우지 못하게).
  await expect(page.locator(`[data-testid="opt-apply-${farmId}"]`)).toHaveText('추가/삭제');

  await expect.poll(async () => {
    const s = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), STORE_KEY);
    return s?.state?.optionExclusions?.[farmId];
  }).toEqual(['강남호']);

  // 같은 시트를 다시 연결한다 — 시트에는 '강남호'가 여전히 있지만 다시 들어오면 안 된다(R11).
  await page.locator('select:has(option[value="탭1"])').selectOption('탭1');
  await expect.poll(async () => {
    const col = farmColumn(await readColumns(page)) as { auto?: { available?: string[] } };
    return col.auto?.available ?? [];
  }).not.toContain('강남호');
});
