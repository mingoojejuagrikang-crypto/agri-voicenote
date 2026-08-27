/**
 * v0.49.0 W3(FB-3) — 설정요약 팝업 「이전 조사」 행의 3상태 e2e.
 *
 * 민구 원문(08-13 프리뷰 실기기, 09:46): *"'설정요약' 팝업시 이전 조사일 정보도 표기 해줄 것.
 * 조사전 이전 조사일을 사용자가 알아야 할 경우가 있음."*
 *
 * 판정 규칙 자체(세션 고정 샘플키 · strictly-< · 키 조각 위치 대조)는 순수 함수 단위 테스트
 * (tests/pastValues.spec.ts)가 갖는다. 이 spec은 **화면까지 배선이 닿는지**만 본다:
 *   1. 인덱스 미로드(오프라인·미로그인) → 「미확인」  — 로딩이 팝업을 막지 않는다
 *   2. IDB 영속 폴백 + 세션 고정 키 일치 → 직전 조사일(ISO)
 *   3. IDB 영속 폴백 + 일치 0건(다른 농가) → 「기록 없음」
 *
 * 시딩 패턴은 past-index-fallback.spec.ts를 따른다 — 인덱스를 Node에서 buildPastIndex +
 * serializePastIndexEntry로 만들고 fp도 브라우저 loadContext()와 같은 규칙으로 합성해
 * IDB kv `__past_index__`에 주입한다(fp가 어긋나면 폴백이 조용히 무시된다).
 *
 * 🔴 미로그인으로만 돈다 — 신선 캐시(loadPastIndex fetch) 경로가 아니라 **폴백만** 쓰는 것이
 * 이 화면의 계약이다(팝업은 절대 fetch를 기다리지 않는다).
 *
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다([ORCH-27])
 */
import { test, expect, type Page } from '@playwright/test';
import { buildPastIndex, previousSurveyRound, resolveRoundCol } from '../src/lib/pastValuesIndex';
import {
  deserializePastIndexEntry,
  serializePastIndexEntry,
  type PersistedPastIndexRecord,
} from '../src/lib/pastValuesPersist';
import { effectiveSampleKey } from '../src/lib/columnFlags';
import { stubSheets } from './fixtures/activeZones';
import { IDB, APPLY_APP_SCHEMA_SOURCE } from './fixtures/idb';
import type { Column } from '../src/types';
import { BASE } from './baseUrl';
// A11 — 「어제」는 달력 연산으로 만든다(DST 함정). 사유는 fixtures/localDate.ts 헤더.
import { daysAgoLocal } from './fixtures/localDate';

const STORE_KEY = 'agri-voicenote-settings-v3';
const SHEET_ID = 'SHEET_PREVSURVEY_1';
const PHONE_375 = { width: 375, height: 812 };

/** 어제 — previousSurveyRound는 오늘 미만 strictly이므로 오늘로 두면 제외된다. */
const PREV_ROUND = daysAgoLocal(1);
const OLDER_ROUND = daysAgoLocal(8);

/**
 * 현 스키마 근사. 세션 고정 샘플키 = 농가명(fixed) + 라벨(단일선택 options).
 * 조사나무는 seq(행마다 순환)라 고정이 아니고, 조사일자는 회차 컬럼이라 제외된다.
 */
const COLUMNS = [
  { id: 'c1', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'c3', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c4', name: '라벨', type: 'options', input: 'auto', ttsAnnounce: false, auto: { kind: 'options', available: ['A', 'B'], selected: ['A'] }, sampleKey: true },
  { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];

const HEADERS = ['조사일자', '농가명', '라벨', '조사나무', '횡경'];
const SHEET_ROWS = [
  [OLDER_ROUND, '이원창', 'A', '1', '90.0'],
  [PREV_ROUND, '이원창', 'A', '1', '100.0'],
  [PREV_ROUND, '이원창', 'A', '2', '110.0'],
];

/**
 * 🔴 v0.50 D(#10) 전용 시트 — **부분 회차만 키 탈락**. `SHEET_ROWS`를 건드리지 않는 이유는
 * [TEAMOPS-84]다: 이 전제를 공용 픽스처에 넣으면 W3-1~W3-9가 전부 이 전제 위에 서 버려,
 * 「이 픽스처를 안 쓰는 스펙」(특히 W3-3 정상 「기록 없음」)이 사라진다.
 *
 * 형상: 조사나무(seq·샘플키)가 **나중에 추가된 컬럼**이라 과거 두 회차에만 공란이다. 전체
 * 샘플키 프루닝(`buildPastIndex` `if (!key) continue`)이 그 두 행을 통째로 버리는데, 오늘
 * 회차는 키가 완전해 `rounds`를 채우므로 M8 가드(`rounds.length === 0`)가 침묵한다.
 * 오늘 회차는 strictly-< 로 답에서 빠지므로 이중 루프는 0건 → `{kind:'none'}`.
 */
const PARTIAL_KEY_ROWS = [
  [OLDER_ROUND, '이원창', 'A', '', '90.0'],   // 조사나무 공란 → 프루닝
  [PREV_ROUND, '이원창', 'A', '', '100.0'],   // ← 진실은 여기다. 이 회차가 통째로 안 보인다
  [daysAgoLocal(0), '이원창', 'A', '1', '110.0'], // 완전 키 → rounds를 채워 M8을 침묵시킨다
];

function settingsFor(farmName: string, signedIn = false) {
  return {
    state: {
      googleConnected: signedIn, // 기본은 미로그인 — 신선 캐시 경로를 배제하고 폴백만 남긴다
      userEmail: null,
      sheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`,
      sheetTab: 'Sheet1',
      columnsSheetId: SHEET_ID,
      columnsSheetTab: 'Sheet1',
      columns: COLUMNS.map((c) =>
        c.id === 'c3' ? { ...c, auto: { kind: 'fixed', value: farmName } } : c,
      ),
      tableGenerated: true,
      totalRows: 2,
      roundDateColId: null,
    },
    version: 13,
  };
}

/** 브라우저 loadContext()와 동일 규칙의 지문. 어긋나면 폴백이 조용히 무시된다.
 *  fp는 컬럼의 id·name·type·sampleKey만 본다 — 농가명 **값**이 달라도 지문은 같다(테스트 3의 전제). */
function computeFp(): string {
  return JSON.stringify([
    SHEET_ID,
    'Sheet1',
    null,
    (COLUMNS as unknown as Column[]).map((c) => [c.id, c.name.trim(), c.type, effectiveSampleKey(c)]),
  ]);
}

/** 기본값은 `SHEET_ROWS` — 기존 케이스의 전제는 하나도 안 바뀐다([TEAMOPS-84]). */
function buildRecord(headers: string[] = HEADERS, rows: string[][] = SHEET_ROWS): PersistedPastIndexRecord {
  const cols = COLUMNS as unknown as Column[];
  const index = buildPastIndex(headers, rows, cols, resolveRoundCol(cols, null));
  return serializePastIndexEntry({ fp: computeFp(), builtAt: Date.now() - 2 * 3_600_000, index });
}

/** 설정 시드(+선택적 IDB 폴백 주입) → 설정탭 → 설정요약 팝업 오픈. */
async function openSummary(
  page: Page,
  opts: { farmName: string; withRecord: boolean; headers?: string[]; rows?: string[][]; withSheet?: boolean },
): Promise<void> {
  await page.setViewportSize(PHONE_375);
  // B1 전용: 신선 조회 경로(토큰 + 시트 stub). 기본 경로는 종전대로 폴백만 쓴다.
  if (opts.withSheet) await stubSheets(page, HEADERS, SHEET_ROWS);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ key, payload, signedIn }) => {
      localStorage.clear();
      localStorage.setItem(key, JSON.stringify(payload));
      if (signedIn) {
        localStorage.setItem('gs10_google_token', JSON.stringify({
          access_token: 'test-token', expires_at: Date.now() + 3600_000, email: 'tester@example.com',
        }));
      }
    },
    { key: STORE_KEY, payload: settingsFor(opts.farmName, !!opts.withSheet), signedIn: !!opts.withSheet },
  );
  if (opts.withRecord) {
    // 🔴 v0.49 r3 #15(claude r2 LOW) — **버전 무지정 open은 여기서 레이스다.** 바로 위 `goto`는
    //   `domcontentloaded`에서 끊으므로 앱의 versioned open(`getDb()`)이 아직 안 끝났을 수 있다.
    //   그 상태에서 무버전 open이 이기면 브라우저는 **스토어 0개짜리 v1**을 만들고, 이어지는
    //   `transaction('kv')`가 NotFoundError로 터진다 — 이 파일의 시드 의존 케이스가 통째로 red다
    //   (무버전 open은 「이미 부팅된 앱 DB에 시딩」 규약이지, 부팅 **중**에 쓰는 형태가 아니다).
    //   fixtures/idb.ts의 **부팅 전 시딩** 규약으로 바꾼다: 버전+스키마를 주입해 누가 먼저 열든
    //   같은 스키마가 선다(앱이 이미 만들었으면 같은 버전이라 upgrade 없이 그대로 열린다).
    await page.evaluate(async ({ rec, idb, schemaSrc }) => {
      const applySchema = (0, eval)(`(${schemaSrc})`) as (db: IDBDatabase) => void;
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        const req = indexedDB.open(idb.name, idb.version);
        req.onupgradeneeded = () => applySchema(req.result);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(rec, '__past_index__');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    }, {
      rec: buildRecord(opts.headers, opts.rows) as unknown as Record<string, unknown>,
      idb: IDB,
      schemaSrc: APPLY_APP_SCHEMA_SOURCE,
    });
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="tab-settings"]').click();
  const shortcut = page.locator('[data-testid="settings-summary-shortcut"]');
  await expect(shortcut).toBeVisible({ timeout: 5000 });
  // 🔴 v0.49 r2 A10(합집합 C5) — 종전엔 `waitForTimeout(600)`으로 `hydratePastIndexFallback`
  //   (부팅 1회, async IDB 읽기)을 기다렸다. 고정 대기에는 근거가 없다: 느린 CI에서는 짧고
  //   (그때 팝업은 인덱스 없이 「미확인」을 그린 상태로 단언에 들어간다), 평소엔 매 테스트가
  //   그만큼 논다. **전제 자체**(폴백이 실제로 반영됐다)를 결정적으로 기다린다 — 3상태 배지의
  //   stale(warn)이 그 신호다(전례 past-index-fallback.spec.ts:327).
  //   ⚠️ 정직한 기록: 이 교체로 **red를 재현하지는 못했다**(Playwright 단언이 재시도하므로
  //   600ms→0ms로 줄여도 7건 green). 그래도 남긴다 — 재시도가 못 구하는 형태(속성·부정 단언,
  //   전제 미충족 상태의 조용한 통과)가 이 파일에 이미 있고, 스위트가 12.2s→5.6s로 줄었다.
  if (opts.withRecord) {
    await expect(page.locator('[data-testid="conn-past"]'))
      .toHaveAttribute('data-tone', 'warn', { timeout: 6000 });
  }
  await shortcut.click();
  await expect(page.locator('[data-testid="settings-summary-modal"]')).toBeVisible({ timeout: 2000 });
}

test('W3-1 — 인덱스 미로드(미로그인·폴백 없음): 「이전 조사 · 미확인」, 팝업은 즉시 열린다', async ({ page }) => {
  await openSummary(page, { farmName: '이원창', withRecord: false });
  const modal = page.locator('[data-testid="settings-summary-modal"]');
  await expect(modal).toContainText('이전 조사');
  await expect(modal).toContainText('미확인');
  await expect(modal).not.toContainText('기록 없음');
  console.log('✓ 인덱스 미로드 → 미확인(로딩 블로킹 없음)');
});

test('W3-2 — IDB 폴백 + 세션 고정 키 일치: 직전 조사일 표시', async ({ page }) => {
  await openSummary(page, { farmName: '이원창', withRecord: true });
  const modal = page.locator('[data-testid="settings-summary-modal"]');
  await expect(modal).toContainText('이전 조사');
  // 어제 회차. 오늘 회차가 아닌 것(strictly <)과 8일 전이 아닌 것(최신) 둘 다 이 단언에 걸린다.
  await expect(modal).toContainText(PREV_ROUND);
  await expect(modal).not.toContainText(OLDER_ROUND);
  await expect(modal).not.toContainText('미확인');
  console.log(`✓ 폴백 인덱스 + 고정 키(농가명+라벨) 일치 → ${PREV_ROUND}`);
});


/** IDB `logEvents`의 `extra` 전량(순서 보존). 아래 두 필터가 공유한다. */
async function readLogExtras(page: Page): Promise<string[]> {
  const extras = await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => resolve(req.result);
    });
    const rows: { type?: string; extra?: string }[] = await new Promise((resolve) => {
      const tx = db.transaction('logEvents', 'readonly');
      const r = tx.objectStore('logEvents').getAll();
      r.onsuccess = () => resolve(r.result as { type?: string; extra?: string }[]);
      r.onerror = () => resolve([]);
    });
    db.close();
    return rows.map((e) => String(e.extra ?? ''));
  });
  return extras;
}

/** `past_index_used_stale:summary` 로그 전량(순서 보존). W3-5/W3-3b/W3-8이 공유한다. */
async function staleSummaryLogs(page: Page): Promise<string[]> {
  return (await readLogExtras(page)).filter((x) => x.startsWith('past_index_used_stale:summary'));
}

/** v0.50 D(#10) — 조회 불가 사유 로그 전량. W3-11이 쓴다(W3-9는 자기 인라인 판독을 유지한다 —
 *  그쪽은 `past_index_skip:*`의 **공존**까지 같은 배열에서 봐야 해서 필터가 다르다). */
async function unqueryableSummaryLogs(page: Page): Promise<string[]> {
  return (await readLogExtras(page)).filter((x) => x.startsWith('past_index_unqueryable:summary'));
}

test('W3-3 — IDB 폴백 + 일치 기록 0건(다른 농가): 「이전 조사 · 기록 없음 (백업)」', async ({ page }) => {
  // 시트에는 '이원창'만 있고 세션은 '없는농가' — 지문(fp)은 같아 폴백은 쓰이되 매칭이 0건이다.
  await openSummary(page, { farmName: '없는농가', withRecord: true });
  const modal = page.locator('[data-testid="settings-summary-modal"]');
  await expect(modal).toContainText('이전 조사');
  // 🔴 v0.49 r3 F7(codex r2) — **0건도 출처를 밝힌다.** 종전 이 단언은 `'기록 없음'`만 봤고
  //    화면도 그렇게 그렸다: 최대 14일 묵은 백업으로 계산한 0건이 **방금 시트를 조회해 0건인
  //    것처럼** 보였다. 백업 이후 시트에 새 일치 행이 추가됐는데 지금 fetch가 실패한 경우가
  //    정확히 그 상황이고, 이 화면은 조사를 **시작하기 전에** 보는 화면이라 판단을 오도한다.
  //    날짜에만 (백업)을 붙이고 0건에는 안 붙이면 「화면은 아는 만큼만 말한다」가 반쪽이 된다.
  await expect(modal).toContainText('기록 없음 (백업)');
  await expect(modal).not.toContainText(PREV_ROUND);
  console.log('✓ 폴백 인덱스 + 고정 키 불일치 → 기록 없음 (백업)');
});

test('W3-3b(r3 F7) — 백업으로 답한 0건도 stale 계측을 낸다 — 집계가 답의 종류로 갈리지 않는다', async ({ page }) => {
  await openSummary(page, { farmName: '없는농가', withRecord: true });
  await expect(page.locator('[data-testid="settings-summary-modal"]')).toContainText('기록 없음 (백업)');
  const stale = (await staleSummaryLogs(page));
  expect(stale.length, '0건을 백업으로 답했는데 stale 사용 집계에 안 잡힌다').toBe(1);
  expect(stale[0]).toMatch(/age_h=\d+/);
});

test("W3-4(r2 A5) — 인덱스는 있는데 **조회가 불가능**하면 「기록 없음」이 아니라 「미확인」이다", async ({ page }) => {
  // 🔴 codex F4 = 합집합 C6. 고정 키 컬럼의 시트 헤더가 개명되면(농가명 → 농가명(구)) 그 컬럼은
  //    인덱스에 매핑되지 않아 **어떤 과거 행과도 대조할 수 없다.** 종전엔 이 상태가 일치 0건과
  //    같은 null이라 화면이 「기록 없음」으로 단정했고, 사용자는 "과거 기록이 없구나"라는 틀린
  //    결론을 내린다 — 헤더를 되돌리기 전까지 영구 고정되는 거짓말이다.
  //    지문(fp)은 컬럼만 보므로 폴백 인덱스는 그대로 로드된다(= 이 단언은 공허하지 않다).
  const RENAMED = ['조사일자', '농가명(구)', '라벨', '조사나무', '횡경'];
  await openSummary(page, { farmName: '이원창', withRecord: true, headers: RENAMED });

  // ① 인덱스는 실제로 로드됐다(폴백 = stale = warn). 「미확인」이 미로드 때문이 아님을 고정한다.
  await expect(page.locator('[data-testid="conn-past"]')).toHaveAttribute('data-tone', 'warn');

  // ② 그런데도 「이전 조사」는 조회 불가 → 미확인.
  const modal = page.locator('[data-testid="settings-summary-modal"]');
  await expect(modal).toContainText('이전 조사');
  await expect(modal).toContainText('미확인');
  await expect(modal, '조회 불가를 「기록 없음」으로 단정하면 안 된다').not.toContainText('기록 없음');
  await expect(modal).not.toContainText(PREV_ROUND);
});

test('W3-5(r2 A6) — 백업 인덱스에서 온 날짜는 「(백업)」으로 밝히고 stale 사용을 로깅한다', async ({ page }) => {
  // 🔴 합집합 C4. 폴백은 **14일까지** 유효하다. 그 날짜를 방금 시트에서 읽은 값과 픽셀 단위로
  //    같게 그리면, "조사 전에 직전 조사일을 확인"하는 이 화면에서 사용자가 출처를 알 방법이 없다.
  //    그리고 `pastValues.ts`의 폴백 계약은 *"폴백 사용 시 호출자가 로깅한다"* 인데 이 신규
  //    소비자만 그 계약을 안 지키고 있었다(§477 주석).
  await openSummary(page, { farmName: '이원창', withRecord: true });
  const modal = page.locator('[data-testid="settings-summary-modal"]');
  await expect(modal).toContainText(`${PREV_ROUND} (백업)`);

  const extras = await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => resolve(req.result);
    });
    const rows: { type?: string; extra?: string }[] = await new Promise((resolve) => {
      const tx = db.transaction('logEvents', 'readonly');
      const r = tx.objectStore('logEvents').getAll();
      r.onsuccess = () => resolve(r.result as { type?: string; extra?: string }[]);
      r.onerror = () => resolve([]);
    });
    db.close();
    return rows.map((e) => String(e.extra ?? ''));
  });
  const stale = extras.filter((x) => x.startsWith('past_index_used_stale:summary'));
  // 🔴 v0.49 r3 #9(= codex F9) — **정확히 1회다.** 종전 단언은 `> 0`이라 중복 기록을 통과시켰고,
  //    실제로 중복이 났다: 이 훅의 effect dep이 `[state]`였는데 `useMemo` 키에 `version`이 들어
  //    있고 로더가 시작·종료 **양쪽에서** 통지하므로, 같은 답이어도 매 통지마다 새 객체가 나와
  //    effect가 다시 돌았다. A6 지표가 팝업 열람 수보다 부풀고 그 로그를 세는 A9 단언도 함께
  //    무의미해진다. 이제 `stale+iso+builtAt` 의미 키로 dedupe한다.
  expect(stale.length, '백업으로 답했는데 stale 로그가 없다/중복이다(§477 폴백 계약 + #9 dedupe)').toBe(1);
  expect(stale[0], 'age가 없으면 얼마나 묵은 답인지 사후 판별이 안 된다').toMatch(/age_h=\d+/);
  // ⚠️ 이벤트 이름은 `trend_used_stale_index`와 **다르다** — 얹으면 이상치 알람의 stale 집계가
  //    설정 팝업 열람으로 오염된다(PRINCIPLES §4: 늘릴 땐 새 이름).
  expect(extras.some((x) => x.startsWith('trend_used_stale_index'))).toBe(false);
});

test('W3-6(r2 B1) — 이상치 규칙 0개 스키마: 팝업을 여는 순간 준비를 깨우고, 열린 채로 값이 갱신된다', async ({ page }) => {
  // 🔴 민구 결정 08-13 ⓐ(합집합 B1 = codex F2). `shouldPreparePastIndex`는 이상치 규칙이 하나도
  //    없으면 false다 — 이 픽스처의 컬럼에는 trendRule/pctThreshold가 **하나도 없다**(현 기본
  //    스키마의 흔한 형태). 종전엔 부팅·연결 프리페치가 전부 그 술어에 막혀 캐시를 만들 경로가
  //    아예 없었고, 백업도 없으면 설정요약은 영원히 「미확인」이었다.
  //    이 진입로(팝업 열기)에서는 술어를 적용하지 않고 `ensurePastIndex()`로 깨운다.
  await openSummary(page, { farmName: '이원창', withRecord: false, withSheet: true });
  const modal = page.locator('[data-testid="settings-summary-modal"]');

  // 준비가 끝나면 **열려 있는 팝업의 값이 갱신된다**(subscribePastIndexStatus 구독).
  await expect(modal).toContainText(PREV_ROUND, { timeout: 8000 });
  // 신선 조회분이므로 백업 표식은 붙지 않는다(A6의 대조군 — 표식이 상시 표시가 아님을 고정).
  await expect(modal).not.toContainText('(백업)');
  await expect(modal).not.toContainText('미확인');
});

/**
 * W3-7(r2 A9) — **소유권 계약**(합집합 C13). 이 항목만 소스 레벨로 잰다.
 *
 * 결함은 「팝업이 열려 있는 동안 설정 store에 쓰기가 일어날 때마다 인덱스 전수 스캔이 돈다」인데,
 * 그 재계산은 화면에 **아무 흔적도 남기지 않는다**(같은 값을 다시 그린다). 브라우저에서 관측할
 * 지점이 없어(로그를 새로 심으면 그건 제품 오염이다) 계약 자체를 고정한다:
 *   ① `SettingsScreen`은 렌더 중에 상태를 계산하지 않는다 — prop으로 내리던 호출이 사라졌다.
 *   ② 팝업이 `useMemo`로 소유하고, 키에 인덱스 상태 버전이 들어간다(준비 완료 시 갱신 — B1).
 * 소스 계약 테스트의 전례: `tests/v043-typo-contract.spec.ts`.
 */
test('[node] W3-7(r2 A9) — 「이전 조사」 계산의 소유자는 팝업이고 useMemo로 잠겨 있다', async () => {
  const fs = await import('node:fs');
  // r2-nearcap(ENV-12) — 화면에서 액션바·푸터가 분리됐다. 분리 전에는 이 파일 전역이 아래 부정
  // 단언의 우발 커버였으므로 분리 파일도 합산한다(R1 C-1 전례 — 부정 단언만 확장). 자식이
  // 렌더 중에 스캔해도 결함(설정 쓰기마다 전수 스캔)은 똑같이 재발한다.
  const screen = ['src/screens/SettingsScreen.tsx',
    'src/components/settings/SettingsActionBar.tsx',
    'src/components/settings/SettingsFooter.tsx']
    .map((p) => fs.readFileSync(p, 'utf-8')).join('\n');
  const modal = fs.readFileSync('src/components/settings/SettingsSummaryModal.tsx', 'utf-8');

  expect(
    screen.includes('readPrevSurveyState('),
    'SettingsScreen이 렌더 중에 인덱스를 다시 스캔한다 — 설정 쓰기마다 전수 스캔이 돈다(C13)',
  ).toBe(false);
  expect(modal.includes('useMemo('), '팝업이 계산을 잠그지 않았다').toBe(true);
  // 메모 키에 상태 버전이 없으면 준비가 끝나도 열린 팝업이 갱신되지 않는다(B1과 한 설계다).
  // ⚠️ 이 정규식은 **변수명에 결합돼 있다.** 이름을 바꿨다면 정규식도 같이 고쳐라 —
  //    계약은 「메모 키에 columns · roundDateColId · **인덱스 상태 버전**이 들어간다」이지
  //    특정 식별자가 아니다. 여기서 단언을 느슨하게 푸는 것은 수정이 아니라 **위반 승인**이다
  //    ([UI-ALERT-1]이 기록한 형태 — 계약을 아는 테스트가 계약을 봐준다).
  expect(
    modal,
    '메모 키에 인덱스 상태 버전이 없다(또는 변수명이 바뀌었다 — 위 주석 참조)',
  ).toMatch(/useMemo\([\s\S]{0,200}\[columns, roundDateColId, version\]/);
  expect(modal.includes('subscribePastIndexStatus('), '준비 완료 신호를 구독하지 않는다').toBe(true);
});

/**
 * 🔴 W3-8(r4 M6 · claude r3 #10) — **「(백업)」은 출처지 신선도가 아니다.**
 *
 * 종전 `stale = getCachedIndex() === null`은 다른 질문의 답이었다. 성공한 조회는 `cached`와
 * `fallback`에 **같은 엔트리**를 심으므로(`loadPastIndex` :642-645), 조회 10분 뒤 TTL이 지나면
 * **방금 이 세션이 직접 읽어 온 인덱스**가 「(백업)」으로 그려지고
 * `past_index_used_stale:summary,age_h=0`이 기록됐다 — 「최대 14일 묵은 IDB 백업」이라는
 * 강한 주장이 0시간짜리 자기 조회에 붙는다(A6가 세운 표기의 의미가 무너진다).
 *
 * 재현: 신선 조회 성공(W3-6과 같은 경로) → 이후 조회를 **막고** 시계를 11분 앞으로 → 팝업 재개봉.
 * `ensurePastIndex()`가 재조회를 시도하지만 실패하므로 `cached`는 그대로 TTL 밖에 남는다.
 *
 * 반증(`readIndexWithProvenance` 제거 시): 「(백업)」이 붙고 stale 로그가 1건 난다.
 */
test('W3-8(r4 M6) — 신선 TTL만 지난 자기 조회는 「(백업)」이 아니다(age_h=0 오기록 차단)', async ({ page }) => {
  await openSummary(page, { farmName: '이원창', withRecord: false, withSheet: true });
  const modal = page.locator('[data-testid="settings-summary-modal"]');
  await expect(modal, '전제: 신선 조회가 성공했다').toContainText(PREV_ROUND, { timeout: 8000 });
  await expect(modal, '전제: 신선 조회에는 표식이 없다').not.toContainText('(백업)');

  // 이후 조회는 막는다 — 재개봉의 `ensurePastIndex()`가 성공하면 TTL 경과 상태가 안 만들어진다.
  await page.route('**://sheets.googleapis.com/**', (route) => route.abort());
  // 시계를 11분 앞으로(캐시 TTL 10분). `builtAt`은 실제 시각으로 이미 박혀 있다.
  await page.evaluate(() => {
    const real = Date.now.bind(Date);
    Date.now = () => real() + 11 * 60 * 1000;
  });

  await page.locator('[data-testid="settings-summary-modal"] button[aria-label="닫기"]').click();
  await expect(modal).toHaveCount(0);
  await page.locator('[data-testid="settings-summary-shortcut"]').click();
  await expect(modal).toBeVisible({ timeout: 4000 });

  await expect(modal, 'TTL 경과를 백업 출처로 오표시했다').not.toContainText('(백업)');
  await expect(modal, '답 자체는 그대로다').toContainText(PREV_ROUND);
  expect(await staleSummaryLogs(page), 'TTL 경과에 stale 사용 계측이 붙었다(age_h=0 오기록)')
    .toHaveLength(0);
});

/**
 * 🔴 W3-9(r4 M8 · claude r3 #11) — **조회 불가 사유를 로그에 남긴다.**
 *
 * 순수층은 6사유를 갈라 두었는데(A5 2 + r3 #3 3 + M8 1) 이 소비자가 전부 「미확인」으로 접어
 * 버려, 사유가 **한 건도 기록되지 않았다.**
 * (v0.50 D(#10)에서 `partial_keyed_rows`가 붙어 **지금은 7종**이다 — W3-11.) 화면 문구는 사용자에게 하나여야 맞지만(A5), 그
 * 화면이 영구 고정된 스키마를 다음 회차가 고치려면 「어느 축이 무너졌는가」가 유일한 단서다.
 *
 * 여기서 만드는 상태는 W3-4와 같다(고정 키 컬럼 헤더 개명 → `headers_unmapped`).
 * 반증(사유 계측 제거 시): red.
 */
test('W3-9(r4 M8) — 「미확인」의 사유가 로그에 남는다(r4 당시 6사유 무로깅 해소)', async ({ page }) => {
  const RENAMED = ['조사일자', '농가명(구)', '라벨', '조사나무', '횡경'];
  await openSummary(page, { farmName: '이원창', withRecord: true, headers: RENAMED });
  const modal = page.locator('[data-testid="settings-summary-modal"]');
  await expect(modal, '전제: 조회 불가 = 미확인').toContainText('미확인');

  const extras = await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => resolve(req.result);
    });
    const rows: { extra?: string }[] = await new Promise((resolve) => {
      const tx = db.transaction('logEvents', 'readonly');
      const r = tx.objectStore('logEvents').getAll();
      r.onsuccess = () => resolve(r.result as { extra?: string }[]);
      r.onerror = () => resolve([]);
    });
    db.close();
    return rows.map((e) => String(e.extra ?? ''));
  });
  const unq = extras.filter((x) => x.startsWith('past_index_unqueryable:summary'));
  expect(unq, '조회 불가 사유가 통째로 무로깅이다').toHaveLength(1);
  expect(unq[0], '어느 축이 무너졌는지가 사유다').toBe('past_index_unqueryable:summary,reason=headers_unmapped');
  // ⚠️ 이름은 로더의 진입 스킵(`past_index_skip:*`)과 **다르다** — 얹으면 두 축이 섞인다.
  //    (이 픽스처는 미로그인이라 `past_index_skip:not_signed_in`이 **함께** 난다. 그 공존이
  //     곧 두 축이 갈려 있다는 증거다 — 같은 이름이었다면 여기서 사유가 뭉개진다.)
  expect(unq[0].startsWith('past_index_skip:'), '두 축이 같은 이름을 쓴다').toBe(false);
  expect(extras.some((x) => x.startsWith('past_index_skip:')), '전제: 로더 스킵도 따로 난다').toBe(true);
});

/**
 * 🔴 W3-10(r4 M8 · claude r3 #9) — **값을 여는 착지는 phase를 함께 연다**(소스 계약).
 *
 * `CenterStage`의 `reaskReason={completing ? null : reaskReason}` 게이트 자체는 옳다(완료 화면에
 * 값 재질문 큐는 없어야 한다). 결함은 **phase가 거짓말을 한다**는 것이었다: 행 경계 착지
 * (`goNextRow` 마지막 행 · `gotoAdjacentRow` 첫 행)가 검토/끝 도달 국면에서 들어오면
 * `announceField`/`enterCellWait`이 값 대기를 무장하면서도 phase는 'complete'로 남아, 거절이
 * **비프만 남고 화면에서 사라졌다**.
 *
 * ⚠️ **왜 소스 계약인가** — r4 M2가 「atEnd는 완료된 행에서만 무장한다」를 구조적 불변식으로
 * 만들면서, 리뷰가 관측한 도달 경로(미완료 행의 atEnd → 행 경계)가 **음성으로는 닫혔다**.
 * 즉 지금은 브라우저에서 red를 만들 상태를 만들 수 없다. 그래도 배선은 남긴다: 다음 착지가
 * 추가될 때 다시 열리는 형태이고, 두 원시 착지가 각자 그 불변식을 **선언만** 하고 있었다
 * (`enterCellWait` 헤더의 *"phase는 active 그대로 둔다"*). 소스 계약 테스트의 전례: W3-7·
 * `v043-typo-contract`.
 */
test('[node] W3-10(r4 M8 → r5 Z2) — 값을 여는 착지가 phase를 스스로 active로 연다(이제 armLanding 경유)', async () => {
  const fs = await import('node:fs');
  // uvs-d(ENV-12 #6) — announceField가 소유자 armLanding과 함께 useAnnouncements.ts로 분리됐다
  // (이동 커밋). 마커·계약 바이트는 이동 전과 동일하다 — 소스 경로만 재표적한다.
  const src = fs.readFileSync('src/lib/useAnnouncements.ts', 'utf-8');

  // r4 M8은 이 두 함수 안에 `setPhase('active')`를 **손으로** 넣어 닫았다. r5 Z2가 그 네 줄을
  // `armLanding`으로 모았으므로 계약의 **표현**이 바뀐다 — 계약 자체(값을 여는 착지는 phase를
  // 호출부에 맡기지 않는다)는 그대로다. 사본이 아니라 소유자를 지목하도록 갱신한다.
  const announceField = src.slice(src.indexOf('const announceField = useCallback('));
  expect(
    announceField.slice(0, announceField.indexOf('armClipForCell(row, col.id)')),
    'announceField가 값 대기를 열면서 phase를 호출부에 맡긴다(행 경계 착지가 그 배선을 빠뜨렸다)',
  ).toContain("phase: 'active'");

  // uvs-b(ENV-12 #3) — enterCellWait이 useRowNav.ts로 분리됐다(announceField는 본체 잔류).
  // r2-nearcap(ENV-12) — 그 착지 계열이 다시 useRowLanding.ts로 갈렸다. 계약(값을 여는 착지는
  // phase를 호출부에 맡기지 않는다)과 마커 바이트는 불변 — 소스 경로만 재표적.
  const navSrc = fs.readFileSync('src/lib/useRowLanding.ts', 'utf-8');
  const enterCellWait = navSrc.slice(navSrc.indexOf('const enterCellWait = useCallback('));
  expect(
    enterCellWait.slice(0, enterCellWait.indexOf('awaitingFieldRef.current = {')),
    'enterCellWait 헤더가 선언한 「phase는 active」를 집행하지 않는다',
  ).toContain("phase: 'active'");
});

/**
 * 🔴 W3-11(v0.50 D · claude r6 #10) — **부분 회차만 키 탈락한 상태를 「기록 없음」이라 단정하지 않는다.**
 *
 * 결함: `buildPastIndex`는 **전체 샘플키**로 행을 프루닝하는데(`if (!key) continue` — 키 셀
 * 하나라도 비면 행 통째 폐기) 대조는 **행 불변 부분집합**(`sessionFixedKeyColumns`)으로만 한다.
 * 그래서 나중에 추가된 키 컬럼(조사나무)이 과거 회차에만 공란이면 그 과거 행들이 전부 버려지는데,
 * **이후의 완전-키 회차가 `rounds`를 채워** M8 가드(`rounds.length === 0`)가 안 뜬다. 이중 루프는
 * 0건을 돌고 마지막 줄이 `{kind:'none'}`을 낸다 → 화면이 「기록 없음」이라고 **단정**한다.
 *
 * 🔴 이게 W3-4(A5)와 다른 축인 이유: W3-4는 `no_fixed_key`/`headers_unmapped` — 조회 **입구**가
 * 막힌 형상이다. 여기는 입구가 다 열려 있고(고정 키 있음·헤더 매핑됨·회차 인덱싱됨) **데이터가
 * 실재하는데도** 0건이 나온다. A5(r2)·#3(r3)·M8(r4)이 세 회차에 걸쳐 없애온 「거짓 단언」의
 * 마지막 구멍이다.
 *
 * 계약선(민구 08-14): *"과거값 비교도 컬럼명 불일치 시 **비교 불가** 처리로 충분"* —
 * `unqueryable`(「미확인」)은 계약이 허용한 결말이고, `none`(「기록 없음」)은 적극 단언이다.
 * 그래서 이 케이스는 **날짜를 요구하지 않는다.** 요구하는 것은 「없다고 말하지 말 것」이다.
 *
 * 반증([TEAMOPS-30]): 처방(`prunedKeyRows` 보관 + `partial_keyed_rows` 가드)을 빼면 다시 red.
 * 과잉 교정 대조군([TEAMOPS-97]): W3-3(정상 「기록 없음」)이 green으로 남아야 한다 — 진짜
 * 0건까지 「미확인」으로 바꾸면 이 처방은 A5가 세운 구분을 반대 방향으로 무너뜨린 것이다.
 */
test('W3-11(v0.50 D) — 과거 회차만 키 컬럼 공란: 「기록 없음」이 아니라 「미확인」이다', async ({ page }) => {
  // ① 전제를 Node에서 고정한다 — 이 형상이 **M8 가드에 안 걸린다**는 것이 결함의 핵심이다.
  const cols = COLUMNS as unknown as Column[];
  const idx = buildPastIndex(HEADERS, PARTIAL_KEY_ROWS, cols, resolveRoundCol(cols, null));
  expect(idx.rowCount, '전제: 행은 세 줄 다 읽혔다').toBe(3);
  expect(idx.roundParsedRows, '전제: 회차 축은 세 줄 다 멀쩡하다').toBe(3);
  expect(idx.rounds, '전제: 오늘 회차가 rounds를 채운다 → M8 가드가 침묵한다').toEqual([daysAgoLocal(0)]);
  expect(idx.samples.size, '전제: 과거 두 회차는 전체키 프루닝으로 통째로 사라졌다').toBe(1);

  await openSummary(page, { farmName: '이원창', withRecord: true, rows: PARTIAL_KEY_ROWS });
  const modal = page.locator('[data-testid="settings-summary-modal"]');
  await expect(modal).toContainText('이전 조사');

  // ② 조회 입구는 다 열려 있는데도 답이 0건이다 — 그걸 「없다」고 말하면 안 된다.
  await expect(modal, '데이터가 실재하는데 「기록 없음」이라고 단정했다').not.toContainText('기록 없음');
  await expect(modal).toContainText('미확인');
  // ③ 프루닝된 진짜 직전 조사일을 **날짜로 답하지도 않는다**(계약: 비교 불가로 충분).
  await expect(modal).not.toContainText(PREV_ROUND);

  // ④ W3-9 축 — 사유가 로그에 남아야 다음 회차가 어느 축을 고칠지 안다. 이 형상의 수리는
  //    「과거 회차의 빈 키 칸을 채운다」이지 헤더·회차 축이 아니다.
  const unq = await unqueryableSummaryLogs(page);
  expect(unq, '조회 불가 사유가 무로깅이다').toHaveLength(1);
  expect(unq[0], '기존 사유를 재사용하면 M8이 고친 오진(수리 방향 오도)을 재생산한다')
    .toBe('past_index_unqueryable:summary,reason=partial_keyed_rows');
});

/**
 * 🔴 W3-11b(v0.50 D) — **처방이 대신 깨뜨릴 수 있는 것 ①: 구버전 백업 폐기**([TEAMOPS-97]).
 *
 * `prunedKeyRows`는 `PersistedPastIndexRecord`의 신규 필드다. 이걸 `deserializePastIndexEntry`의
 * **형태 검증 목록에 넣으면** 이 필드 이전에 저장된 백업이 통째로 폐기되고(`null`), 14일 폴백이
 * 끊긴다 — 오프라인 농가 현장에서 「이전 조사」가 통째로 「미확인」이 된다. M8(`roundParsedRows`)이
 * `pastValuesPersist.ts:96-98` 주석에 이미 적어 둔 학습이고, 이 처방은 그 선례를 문자 그대로 따랐다.
 *
 * 여기서 고정하는 것은 둘이다: ⓐ구버전 레코드가 **살아남는다** ⓑ복원값은 `[]`라서 판정이
 * **종전 그대로**다(구버전 백업이 이 결함까지 고쳐 주지는 않는다 — 정직하게 그렇게 적는다).
 *
 * ⚠️ 이 파일에 사는 이유: 브리핑 §2가 준 소유 파일이 여기다. 순수/영속층 단언이지만 W3-11의
 * **반증 잠금**이라 같은 자리에 두는 편이 다음 사람에게 읽힌다.
 */
test('[node] W3-11b(v0.50 D) — 구버전 백업(prunedKeyRows 없음)은 폐기되지 않고 종전 판정으로 복원된다', () => {
  const cols = COLUMNS as unknown as Column[];
  const index = buildPastIndex(HEADERS, PARTIAL_KEY_ROWS, cols, resolveRoundCol(cols, null));
  expect(index.prunedKeyRows.length, '전제: 신선 인덱스는 프루닝된 두 행을 들고 있다').toBe(2);

  const legacy = { ...serializePastIndexEntry({ fp: 'fp-old', builtAt: 1, index }) } as Record<string, unknown>;
  delete legacy.prunedKeyRows;
  const restored = deserializePastIndexEntry(legacy);
  expect(restored, '구버전 백업이 통째로 폐기되면 14일 폴백이 끊긴다').not.toBeNull();
  expect(restored!.index.prunedKeyRows, '없으면 빈 배열 = 종전 판정').toEqual([]);
  // 정직한 기록: 구버전 백업으로는 이 결함이 안 고쳐진다(고칠 근거가 레코드에 없다).
  expect(previousSurveyRound(restored!.index, cols, null, daysAgoLocal(0)))
    .toEqual({ kind: 'none' });
});

/**
 * 🔴 W3-11c(v0.50 D) — **처방이 대신 깨뜨릴 수 있는 것 ②: 정상 날짜 답의 「미확인」화**([TEAMOPS-97]).
 *
 * 가드는 *"프루닝된 회차가 답을 **바꿀 때만** 접는다"*(`prunedBest > best`)로 좁혀져 있다.
 * 이 좁힘이 없으면 — 즉 `prunedKeyRows`에 일치 행이 하나라도 있으면 접는 식으로 넓히면 —
 * **직전 조사일을 정상적으로 답할 수 있는 세션까지 「미확인」이 된다.** 시트 어딘가에 키 칸이
 * 빈 과거 행이 한 줄 섞여 있는 것은 흔한 일이라, 넓히면 이 기능이 사실상 죽는다.
 *
 * 형상: 프루닝된 행이 **고정 키와 일치하지만 더 과거**다(8일 전) — 답은 여전히 어제다.
 * 반증: 가드 조건에서 `(best === null || prunedBest > best)`를 빼면 red.
 */
test('[node] W3-11c(v0.50 D) — 프루닝된 회차가 답을 바꾸지 않으면 날짜를 계속 답한다(과잉 접힘 차단)', () => {
  const cols = COLUMNS as unknown as Column[];
  const rows = [
    [OLDER_ROUND, '이원창', 'A', '', '90.0'],    // 프루닝 + 고정 키 일치, 그러나 best보다 과거
    [PREV_ROUND, '이원창', 'A', '1', '100.0'],   // 인덱싱됨 → 이게 답이다
  ];
  const index = buildPastIndex(HEADERS, rows, cols, resolveRoundCol(cols, null));
  expect(index.prunedKeyRows.map((r) => r.round), '전제: 프루닝된 행이 실재한다').toEqual([OLDER_ROUND]);
  expect(previousSurveyRound(index, cols, null, daysAgoLocal(0)))
    .toEqual({ kind: 'date', iso: PREV_ROUND });
});
