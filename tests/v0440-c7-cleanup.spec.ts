/**
 * §C7 잔여 3건 (v0.44.0 플랜 — F24·F25·F26, 전부 "중복 정보 삭제" 계열, 민구 확정 08-02) 오라클.
 *
 * 재는 축: ① F24 — 데이터탭에서 '작성중' 문자열·draft-badge 부재 + 행수 표기가 `완료/전체행`
 *             (`1/2행`·`2/2행`)으로 통합(v0.33.0 #9 배지 폐기 — 같은 정보를 한 곳에서).
 *          ② F25 — 생성 완료 안내문구("생성 완료 — 입력 탭에서 …") 부재(v0.32.0 B4 폐기).
 *          ③ F26 — 인라인 아코디언(v0.34.0 C10) 부재 + '입력탭으로 이동' 부재 + 그 자리
 *             3버튼(설정요약·생성 테이블 보기·재생성) 실동작. 종전 "총 N행 생성됨 (미리보기)"/
 *             "재생성" 행은 3버튼 행으로 **재배치**됐다(중복 금지).
 *             🔴 v0.45.0 UI①(민구 08-05) 갱신 — 종전 "'설정 요약' 상단 버튼 1개" 계약은 폐기:
 *             상단 유틸리티 행이 삭제돼 정확 문구 진입점은 **0개**, 유일 진입점은 하단
 *             '설정요약'(무공백)이다. '초기화'는 액션바 상시 2행(높이 56·글자 13, 모달 흐름 불변).
 * 안 재는 축: 팝업 내부 수치 정합(settings-ux B2가 소유) · 재생성 게이트 흐름(B1이 소유) ·
 *             동기화 라벨(`N/M`, '행' 없음)의 표기 — F24 대상 아님.
 *
 * 375×812(GL-005) / 데이터탭은 검증 기준 기기 402×874. 서버는 webServer가 5177 자동 기동.
 */
import { test, expect, type Page } from '@playwright/test';

import { BASE } from './baseUrl';

const STORE_KEY = 'agri-voicenote-settings-v3';
const PHONE_375 = { width: 375, height: 812 };
const PHONE_402 = { width: 402, height: 874 };

// ─── fixtures ────────────────────────────────────────────────────────────────

const COLUMNS = [
  { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 3 } },
  { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
];

/** 세션 2개 시드(IDB 직접 주입 — v033-data-clip-column 패턴):
 *  - sess_c7_draft — 완료 1행 + 미완료 1행 → 카드에 `1/2행` (배지 없음)
 *  - sess_c7_done  — 전 행 완료 → 카드에 `2/2행` */
async function injectSessions(page: Page) {
  await page.evaluate(async (columns) => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('IDB open blocked'));
    });
    const draft = {
      id: 'sess_c7_draft',
      date: '2026-08-03',
      label: 'c7 부분입력',
      columns,
      rows: [
        { index: 1, values: { c6: '1', c8: '31.0' }, complete: true },
        { index: 2, values: { c6: '2' }, complete: false },
      ],
      completedRows: 1,
      syncedRows: 0,
      startedAt: Date.now() - 120_000,
      finishedAt: Date.now() - 60_000,
    };
    const done = {
      id: 'sess_c7_done',
      date: '2026-08-04',
      label: 'c7 완료',
      columns,
      rows: [
        { index: 1, values: { c6: '1', c8: '35.1' }, complete: true },
        { index: 2, values: { c6: '2', c8: '36.2' }, complete: true },
      ],
      completedRows: 2,
      syncedRows: 0,
      startedAt: Date.now() - 240_000,
      finishedAt: Date.now() - 180_000,
    };
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(['sessions'], 'readwrite');
      tx.objectStore('sessions').put(draft);
      tx.objectStore('sessions').put(done);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, COLUMNS);
}

async function bootDataTab(page: Page) {
  await page.setViewportSize(PHONE_402);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await injectSessions(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await page.locator('[data-testid="tab-data"]').click();
  await page.waitForTimeout(400);
}

/** persist v12 페이로드로 생성 완료 상태를 시드하고 설정탭 진입(settings-ux 패턴). */
async function seedGeneratedSettings(page: Page) {
  await page.setViewportSize(PHONE_375);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ key, payload }) => {
    localStorage.clear();
    localStorage.setItem(key, JSON.stringify(payload));
  }, {
    key: STORE_KEY,
    payload: { state: { columns: COLUMNS, totalRows: 3, tableGenerated: true }, version: 12 },
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await page.locator('[data-testid="tab-settings"]').click();
  await page.waitForTimeout(300);
}

// ─── F24. 데이터탭 — 배지 삭제 + 행수 통합 ───────────────────────────────────

test('F24 — 데이터탭에 "작성중" 부재, 행수는 완료/전체(`N/M행`)로 통합', async ({ page }) => {
  await bootDataTab(page);

  // 배지(문자열·testid 모두) 부재 — v0.33.0 #9 폐기.
  await expect(page.getByText('작성중')).toHaveCount(0);
  await expect(page.locator('[data-testid="draft-badge"]')).toHaveCount(0);

  // 부분입력 세션 카드: 완료 1 / 전체 2 → `1/2행`. 완료 세션: `2/2행`.
  const draftCard = page.locator('button', { hasText: 'c7 부분입력' });
  await expect(draftCard).toContainText(/1\/2\s*행/);
  const doneCard = page.locator('button', { hasText: 'c7 완료' });
  await expect(doneCard).toContainText(/2\/2\s*행/);
  console.log('✓ F24 — 배지 부재 + 1/2행·2/2행 통합 표기');
});

// ─── F25. 설정탭 — 생성 완료 안내문구 삭제 ───────────────────────────────────

test('F25 — 생성 완료 후에도 안내문구("생성 완료 — 입력 탭에서 …")가 없다', async ({ page }) => {
  await seedGeneratedSettings(page);

  const body = await page.evaluate(() => document.body.innerText);
  expect(body, 'v0.32.0 B4 안내문구 폐기(민구 08-02)').not.toContain('생성 완료 — 입력 탭에서');
  expect(body).not.toContain('[음성 입력 시작]을 누르세요');
  console.log('✓ F25 — 안내문구 부재');
});

// ─── F26. 설정 요약 진입점 1개 + 입력탭 이동 → 3버튼 대체 ────────────────────

test('F26 — "설정 요약" 정확 문구 진입점 0개(v0.45.0 UI①): 인라인 아코디언 부재 + 유일 진입점은 하단 설정요약', async ({ page }) => {
  await seedGeneratedSettings(page);

  // 인라인 아코디언(컨테이너·토글) 부재.
  await expect(page.locator('[data-testid="settings-summary-inline"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="settings-summary-toggle"]')).toHaveCount(0);

  // 정당 파손(v0.45.0 UI①, 민구 08-05 추가요청3): 종전 "'설정 요약' 상단 버튼 count==1" 단언
  // 뒤집기 — 상단 유틸리티 행이 삭제돼 정확 문구 상호작용 요소는 0개가 맞다.
  await expect(page.locator('button', { hasText: '설정 요약' })).toHaveCount(0);
  await expect(page.locator('[data-testid="settings-summary-open"]')).toHaveCount(0);
  // 요약 팝업의 유일 진입점 = 생성 완료 액션바의 '설정요약'(무공백, settings-summary-shortcut).
  await expect(page.locator('[data-testid="settings-summary-shortcut"]')).toBeVisible();
  console.log('✓ F26(v0.45.0 UI① 갱신) — 정확 문구 진입점 0개, 유일 진입점은 하단 설정요약');
});

test('F26 — "입력탭으로 이동" 부재, 그 자리 3버튼 실동작 + 설정 초기화는 스크롤 말미(WP-H)', async ({ page }) => {
  await seedGeneratedSettings(page);

  // 종전 버튼·문구 부재.
  await expect(page.getByText('입력탭으로 이동')).toHaveCount(0);
  await expect(page.locator('[data-testid="settings-go-input"]')).toHaveCount(0);
  // 종전 "총 N행 생성됨 (미리보기)" 행은 3버튼으로 재배치 — 생성 상태 수치는 팝업이 갖는다.
  await expect(page.getByText('생성됨')).toHaveCount(0);

  // 3버튼 존재('설정요약'은 무공백 표기 — '설정 요약' 진입점 1개 계약 보호).
  const summaryBtn = page.getByRole('button', { name: '설정요약', exact: true });
  const previewBtn = page.getByRole('button', { name: '생성 테이블 보기', exact: true });
  // 🔴 v0.46.0 WP-H — '재생성' → '테이블 재생성'(민구 지시 08-05). exact 기대값을 갱신했다.
  //    되돌리지 마라 — '초기화' → '설정 초기화'와 짝을 이루는 명칭 정정이다.
  const regenBtn = page.getByRole('button', { name: '테이블 재생성', exact: true });
  await expect(summaryBtn).toBeVisible();
  await expect(previewBtn).toBeVisible();
  await expect(regenBtn).toBeVisible();
  // 종전 정확 문구('재생성' 단독)는 사라져야 한다 — 두 이름이 공존하면 정정이 반쪽이다.
  await expect(page.getByRole('button', { name: '재생성', exact: true })).toHaveCount(0);

  // 🔴 v0.46.0 WP-H — v0.45.0 UI①의 「액션바 2행 상시」 계약은 **철회**됐다(정당 파손).
  //    새 계약: '설정 초기화'는 **스크롤 영역 안**, 액션바 **밖**, Footer(버전)보다 **뒤**다.
  //    근거: 재생성은 일상이고 초기화는 예외인데(민구), 상시 배치가 그 빈도를 거꾸로 반영해
  //    08-05 하루 settings_reset 6회(26초 간격 연타 포함)를 냈다. 되살리기 전에 이 줄을 읽어라.
  //    🔴 판정은 **DOM 순서**로 한다. 첫 시도는 "조상 중 overflowY:auto가 있나"로 쟀는데
  //    **액션바도 true가 나왔다** — 설정탭 스크롤 영역 위에 또 다른 스크롤 조상이 있어서
  //    그 술어가 두 버튼을 못 가른다(실측 red). 순서는 그 혼선이 없다: 스크롤 영역이
  //    액션바보다 **앞**이고, Footer(버전)는 스크롤 영역 안에서 초기화보다 **앞**이다.
  //    높이 56·글자 13 동일 계약은 그대로 유지한다.
  const resetBtn = page.locator('[data-testid="settings-reset-open"]');
  const rowMetrics = await page.evaluate(() => {
    const reset = document.querySelector('[data-testid="settings-reset-open"]') as HTMLElement;
    const summary = document.querySelector('[data-testid="settings-summary-shortcut"]') as HTMLElement;
    // Footer 버전 줄 — 텍스트로 특정한다(전용 testid가 없다).
    const version = Array.from(document.querySelectorAll('div'))
      .find((d) => /^v\d+\.\d+\.\d+\s/.test(d.textContent ?? '') && d.children.length === 1) as HTMLElement | undefined;
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING; // 인자가 기준 노드 **뒤**에 온다
    let scroller: HTMLElement | null = null;
    for (let p: HTMLElement | null = reset.parentElement; p; p = p.parentElement) {
      if (p.scrollHeight > p.clientHeight + 1 && getComputedStyle(p).overflowY === 'auto') { scroller = p; break; }
    }
    return {
      resetH: reset.getBoundingClientRect().height,
      resetFs: parseFloat(getComputedStyle(reset).fontSize),
      summaryH: summary.getBoundingClientRect().height,
      summaryFs: parseFloat(getComputedStyle(summary).fontSize),
      // DOM 순서: 초기화 **앞에** 액션바가 오면 안 된다(액션바가 뒤여야 한다).
      actionBarFollowsReset: !!(reset.compareDocumentPosition(summary) & FOLLOWING),
      // Footer 버전 줄은 초기화보다 **앞**이다(초기화가 스크롤 영역의 마지막).
      resetFollowsVersion: version ? !!(version.compareDocumentPosition(reset) & FOLLOWING) : null,
      // 스크롤이 실제로 존재하는가 — "상시가 아니다"의 전제.
      hasScroll: !!scroller,
      resetTop: reset.getBoundingClientRect().top,
      summaryTop: summary.getBoundingClientRect().top,
    };
  });
  expect(rowMetrics.resetH, '초기화 행 높이 56').toBeCloseTo(56, 0);
  expect(rowMetrics.resetFs, '초기화 글자 13').toBeCloseTo(13, 0);
  expect(rowMetrics.resetH, '3버튼 행과 동일 높이').toBeCloseTo(rowMetrics.summaryH, 0);
  expect(rowMetrics.resetFs, '3버튼 행과 동일 글자 크기').toBeCloseTo(rowMetrics.summaryFs, 0);
  expect(rowMetrics.actionBarFollowsReset, 'WP-H — 설정 초기화는 액션바보다 앞이다(= 스크롤 영역 안)').toBe(true);
  expect(rowMetrics.resetFollowsVersion, 'WP-H — 설정 초기화는 Footer(버전)보다 뒤다').toBe(true);
  // 상시가 아니다 — 스크롤 최상단에서는 액션바보다 아래(화면 밖)에 놓인다.
  expect(rowMetrics.hasScroll, '설정탭 스크롤 영역이 실제로 넘친다(전제)').toBe(true);
  expect(rowMetrics.resetTop, 'WP-H — 최상단에서 설정 초기화는 액션바 아래(비노출)').toBeGreaterThan(
    rowMetrics.summaryTop,
  );
  // 이름도 함께 바뀌었다 — '초기화' 단독 문구는 남지 않는다.
  await expect(resetBtn).toHaveText('설정 초기화');
  // 🔴 안 재는 축: 스크롤해서 도달 가능한지(Playwright click이 자동 스크롤하므로 settings-ux B3가
  //    간접 확인한다) · 오탭 빈도(실사용 계측 몫) · 모달 내부 동작(settings-ux B3가 소유).

  // 375px에서 액션바(3버튼 행) + 스크롤 말미 초기화 행이 가로 오버플로를 만들지 않는다.
  const sw = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  expect(sw.sw).toBeLessThanOrEqual(sw.cw + 1);

  // ① 설정요약 → 기존 팝업(SettingsSummaryModal)이 열린다.
  await summaryBtn.click();
  await page.waitForTimeout(300);
  const modal = page.locator('[data-testid="settings-summary-modal"]');
  await expect(modal).toBeVisible({ timeout: 2000 });
  await modal.locator('button', { hasText: '닫기' }).click();
  await page.waitForTimeout(200);
  await expect(modal).toBeHidden();

  // ② 생성 테이블 보기 → 닫기 전용 테이블 미리보기가 열린다.
  await previewBtn.click();
  await page.waitForTimeout(300);
  const preview = page.locator('[data-testid="table-preview-card"]');
  await expect(preview).toBeVisible({ timeout: 2000 });
  await expect(page.getByText('테이블 미리보기', { exact: true })).toBeVisible();
  await preview.locator('button', { hasText: '확인' }).click();
  await page.waitForTimeout(200);
  await expect(preview).toBeHidden();

  // ③ 재생성 → 게이트('재생성 — 설정값 확인')가 열린다(즉시 재생성 아님 — W3 계약 유지).
  await regenBtn.click();
  await page.waitForTimeout(400);
  await expect(page.locator('[data-testid="gate-card"]')).toBeVisible({ timeout: 3000 });
  await expect(page.getByText('재생성 — 설정값 확인')).toBeVisible();
  console.log('✓ F26 — 3버튼 실동작(팝업·미리보기·재생성 게이트)');
});
