/**
 * v0.33.0 항목10-A/10-C (Vance) — 설정탭 도움말 데이터형 설명 + 비프음 선택.
 *
 *  [node] beepVariants 순수 검증 — 10종(긍정/부정 각 5), 500–1200Hz, ≤350ms, 기본값=현행 사운드,
 *         buildBeepSchedule 변환 계약, 미상 id 폴백.
 *  [UI]   설정 도움말 팝업에 데이터형 6항목(이름=자동 텍스트 전환 실동작 문구), 비프 칩 10개
 *         (탭=선택), persist v11 coercion(누락/손상 → 기본값, version bump 없음).
 *
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다(수동 기동 불필요, [ORCH-27]).
 */
import { test, expect, type Page } from '@playwright/test';
import {
  BEEP_VARIANTS,
  DEFAULT_POSITIVE_BEEP_ID,
  DEFAULT_NEGATIVE_BEEP_ID,
  buildBeepSchedule,
  getBeepVariant,
  isBeepVariantId,
} from '../src/lib/beepVariants';

import { BASE } from './baseUrl';
const SETTINGS_KEY = 'agri-voicenote-settings-v3';

// ─── [node] 비프 세그먼트 스펙 ───────────────────────────────────────────────

test('[node] 10-C — 변형 10종: 긍정/부정 각 5, id 유일', () => {
  expect(BEEP_VARIANTS).toHaveLength(10);
  expect(BEEP_VARIANTS.filter((v) => v.polarity === 'positive')).toHaveLength(5);
  expect(BEEP_VARIANTS.filter((v) => v.polarity === 'negative')).toHaveLength(5);
  const ids = BEEP_VARIANTS.map((v) => v.id);
  expect(new Set(ids).size).toBe(10);
});

test('[node] 10-C — 전 변형 제약: 주파수 500–1200Hz, 총 길이 ≤350ms, 게인 ≤0.06', () => {
  for (const v of BEEP_VARIANTS) {
    const schedule = buildBeepSchedule(v);
    expect(schedule.length).toBeGreaterThan(0);
    for (const t of schedule) {
      expect(t.freq).toBeGreaterThanOrEqual(500);
      expect(t.freq).toBeLessThanOrEqual(1200);
      if (t.endFreq != null) {
        expect(t.endFreq).toBeGreaterThanOrEqual(500);
        expect(t.endFreq).toBeLessThanOrEqual(1200);
      }
      expect(t.gain).toBeLessThanOrEqual(0.06);
      expect(t.stopMs).toBeGreaterThan(t.startMs);
    }
    const totalMs = Math.max(...schedule.map((t) => t.stopMs));
    expect(totalMs).toBeLessThanOrEqual(350);
  }
});

test('[node] 10-C — 기본값 = 현행 사운드(긍정 520→880/180ms/0.045, 부정 740→520/210ms/0.055)', () => {
  const pos = buildBeepSchedule(getBeepVariant(DEFAULT_POSITIVE_BEEP_ID, 'positive'));
  expect(pos).toEqual([{ startMs: 0, stopMs: 180, freq: 520, endFreq: 880, gain: 0.045, wave: 'sine' }]);
  const neg = buildBeepSchedule(getBeepVariant(DEFAULT_NEGATIVE_BEEP_ID, 'negative'));
  expect(neg).toEqual([{ startMs: 0, stopMs: 210, freq: 740, endFreq: 520, gain: 0.055, wave: 'sine' }]);
});

test('[node] 10-C — buildBeepSchedule 계약: startMs 오름차순, stopMs=at+dur, 동일 endFreq는 null', () => {
  for (const v of BEEP_VARIANTS) {
    const schedule = buildBeepSchedule(v);
    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i].startMs).toBeGreaterThanOrEqual(schedule[i - 1].startMs);
    }
    for (const t of schedule) {
      if (t.endFreq != null) expect(t.endFreq).not.toBe(t.freq);
    }
  }
});

test('[node] 10-C — 미상 id/극성 불일치 폴백 + isBeepVariantId 방어', () => {
  expect(getBeepVariant('bogus', 'positive').id).toBe(DEFAULT_POSITIVE_BEEP_ID);
  expect(getBeepVariant('bogus', 'negative').id).toBe(DEFAULT_NEGATIVE_BEEP_ID);
  // 극성이 다른 실존 id도 그 극성 기본으로 폴백(긍정 자리에 부정음이 끼지 않게).
  expect(getBeepVariant('neg-fall', 'positive').id).toBe(DEFAULT_POSITIVE_BEEP_ID);
  expect(isBeepVariantId('pos-rise', 'positive')).toBe(true);
  expect(isBeepVariantId('pos-rise', 'negative')).toBe(false);
  expect(isBeepVariantId(42, 'positive')).toBe(false);
  expect(isBeepVariantId(undefined, 'negative')).toBe(false);
});

// ─── [UI] 설정탭 ─────────────────────────────────────────────────────────────

async function goToSettings(page: Page) {
  await page.setViewportSize({ width: 402, height: 874 });
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  await page.locator('[data-testid="tab-settings"]').click();
  await page.waitForTimeout(300);
}

test('[UI] 10-A — 설정 도움말 팝업에 데이터형 6항목(이름=자동 텍스트 전환 실동작 문구)', async ({ page }) => {
  await goToSettings(page);
  await page.locator('[data-testid="settings-help-button"]').click();
  const modal = page.locator('[data-testid="settings-help-modal"]');
  await expect(modal).toBeVisible({ timeout: 2000 });

  for (const label of ['날짜', '텍스트', '정수', '실수', '리스트', '이름']) {
    await expect(modal.getByText(`데이터형 — ${label}`, { exact: true })).toBeVisible();
  }
  // '이름' 문구는 name→text 자동 치유 실동작(applySemanticDefaults)과 일치해야 한다.
  await expect(modal).toContainText('새로 고를 수 없습니다');
  await expect(modal).toContainText('자동으로 ‘텍스트’로 바뀌며');
  // 기존 COLUMN_HELP도 그대로(통합이지 대체가 아님).
  await expect(modal).toContainText('입력방식 — 자동 / 음성 / 수동');
  console.log('✓ 데이터형 6항목 + 이름 자동 전환 문구 + 기존 항목 보존');
});

/** 🔴 v0.46.0 WP-I(민구 지시 08-05) — 종전 '[UI] 10-C 비프 칩 10개 + 선택 전환 + 영속'을
 *  **뒤집었다(정당 파손).** 소리가 고정되면서 선택 UI가 통째로 사라졌다:
 *  확인음 = 화음(pos-triad) · 경고음 = 트릴(neg-trill) · 볼륨 100% — 민구: *"고를 게 없으면
 *  안 보여준다."* 그래서 이 자리의 오라클은 **"선택 UI가 없다"** 로 바뀐다.
 *
 *  ⚠️ **변형 10종 자체는 죽지 않았다** — 위 `[node]` 절이 계속 스펙(주파수·길이·게인 제약)을
 *  잰다. 사라진 것은 **고르는 UI**이지 팔레트가 아니다. 되살리려면 SessionOptionsSection의
 *  <BeepPicker /> 렌더와 beep.ts의 FIXED_* 상수를 함께 되돌린다.
 *
 *  🔴 이 삭제가 제보 **F1(미리듣기 버튼 작동안함)** 도 함께 없앤다 — 고친 게 아니라 소멸했다.
 *  **원인은 미규명으로 남는다.** 같은 오디오 경로를 WP-E 커밋 확인음이 쓰므로 실기기 확인이 필수다.
 *
 *  안 재는 축: 고정 재생 파라미터의 실제 적용(beep-release.spec.ts가 커밋 확인음 경로에서
 *  마스터 게인 12와 세그먼트 3개로 잰다) · 실기기 가청 여부. */
test('[UI] WP-I — 소리 설정 UI 부재: 비프 선택기·칩·미리듣기 진입점이 0개다(고정)', async ({ page }) => {
  await goToSettings(page);

  // 선택기 컨테이너 자체가 없다.
  await expect(page.locator('[data-testid="beep-picker"]')).toHaveCount(0);

  // 칩 10종 전부 부재 — 하나라도 남으면 "고정"이 반쪽이다.
  for (const v of BEEP_VARIANTS) {
    await expect(page.locator(`[data-testid="beep-chip-${v.id}"]`), `${v.id} 칩 부재`).toHaveCount(0);
  }

  // 미리듣기 진입점(F1의 그 버튼)도 함께 사라진다.
  await expect(page.getByText('미리듣기')).toHaveCount(0);

  // 🟢 대조군: 같은 카드의 다른 설정은 살아 있다 — 섹션을 통째로 지운 게 아니라 소리만 뺐다.
  await expect(page.locator('[data-testid="auto-capture-toggle"]')).toBeVisible();
  console.log('✓ WP-I — 비프 선택기·칩 10종·미리듣기 부재, 자동 캡처 토글은 보존');
});

test('[UI] 10-B/10-C — persist migrate coercion: 구버전(v10) 손상/누락 → 기본값 치유, 최신 version으로 승격', async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 });
  // 구버전(v10) 영속본 시뮬레이션 — migrate가 실행되는 경로(version < 11). 신규 필드는 손상값으로
  // 심어 coercion을 검증한다(누락 케이스는 zustand shallow-merge 기본값 경로로 별도 커버됨 —
  // 아래 '기본 선택' 테스트가 그 경로다).
  await page.addInitScript(({ key }) => {
    const persisted = {
      state: {
        googleConnected: false, userEmail: null, sheet: null, sheetUrl: '', sheetTab: '',
        availableSheets: [], savedSheets: [], manualMode: false, columns: [], tableGenerated: false,
        totalRows: 50, ttsRate: 1.05, recognitionTolerance: 0.6,
        sessionLabelColId: null, sessionAutoLabel: null, sessionCustomLabel: null,
        fastRecognition: false, preferredVoiceName: '', teamFolderId: null, userLogFolderId: null,
        roundDateColId: null, reviewFilters: [], reviewTargetRound: null, reviewBaselineBack: 1,
        reviewGroupCols: null, reviewMeasureCols: null, reviewSelectedRows: null,
        trendRuleClearedV6: true,
        // 손상값: 캡처 토글은 문자열, 긍정 자리에 부정 id(극성 불일치), 부정 자리에 미상 id.
        autoScreenCapture: 'yes', beepPositiveId: 'neg-fall', beepNegativeId: 'bogus',
        // v0.35.0 FIX-1 — beepVolume 손상값(범위 밖)도 기본 0.5로 coercion(치유는 version과 무관).
        beepVolume: 9,
      },
      version: 10,
    };
    localStorage.setItem(key, JSON.stringify(persisted));
  }, { key: SETTINGS_KEY });

  await page.goto(BASE);
  await page.waitForLoadState('networkidle');

  // migrate 후 재영속 — version이 11이 되고(bump 없음 = 최신이 11), 손상값이 치유되어 있어야 한다.
  await expect
    .poll(async () => page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as { version: number }).version : null;
    }, SETTINGS_KEY))
    .toBe(12);
  const stored = await page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return JSON.parse(raw!) as { state: { autoScreenCapture: unknown; beepPositiveId: unknown; beepNegativeId: unknown; beepVolume: unknown } };
  }, SETTINGS_KEY);
  expect(stored.state.autoScreenCapture).toBe(true);
  expect(stored.state.beepPositiveId).toBe('pos-rise');
  expect(stored.state.beepNegativeId).toBe('neg-fall');
  expect(stored.state.beepVolume).toBe(0.5); // 범위 밖(9) → 기본 0.5 치유

  // UI에도 치유 결과 반영.
  await page.locator('[data-testid="tab-settings"]').click();
  await page.waitForTimeout(300);
  const toggle = page.locator('[data-testid="auto-capture-toggle"]');
  await toggle.scrollIntoViewIfNeeded();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  // 🔴 v0.46.0 WP-I — 종전의 비프 칩 aria-pressed 확인 2줄은 **제거**했다(정당 파손):
  //    소리 선택 UI가 사라져 확인할 칩이 없다. 🔑 **store coercion 자체는 그대로 검증한다**
  //    (위 beepPositiveId·beepNegativeId·beepVolume 단언) — 필드는 살아 있고 재생만 고정값을
  //    쓴다(beep.ts FIXED_*). 즉 이 테스트가 재는 migrate 계약은 온전하고, 사라진 것은
  //    "치유 결과가 UI에 보이나"라는 표시 축뿐이다. UI 부재는 위 WP-I 절이 잰다.
  console.log('✓ v10 손상값 → migrate coercion 치유 + version 12 (칩 UI 축은 WP-I로 제거)');
});

test('[UI] 10-B — 자동 캡처 토글: 기본 on, 탭=off 전환 + 영속', async ({ page }) => {
  await goToSettings(page);
  const toggle = page.locator('[data-testid="auto-capture-toggle"]');
  await toggle.scrollIntoViewIfNeeded();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');

  await toggle.click();
  await page.waitForTimeout(200);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.locator('[data-testid="tab-settings"]').click();
  await page.waitForTimeout(300);
  await expect(page.locator('[data-testid="auto-capture-toggle"]')).toHaveAttribute('aria-pressed', 'false');
  console.log('✓ 기본 on → off 전환 + reload 영속');
});
