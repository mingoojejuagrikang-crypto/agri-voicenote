/**
 * v0.44.0 §C0 — 알람 비교값(`compareLabel`/`compareValue`) 오버플로 오라클.
 *
 * 대상: `AnomalyAlertPopup.tsx`의 2열 비교(`anomaly-comparison` 안
 * `anomaly-{prev,next}-{label,value}`). 현재 `heroLayout.ts`는
 * `compareLabel: 'max(22px, calc(13.93vw * var(--fit-compare-label, 1)))'` ·
 * `compareValue: 'max(30px, calc(19.4vw * var(--fit-compare-value, 1)))'`로 fit 배선이 있다
 * (c0-r1). 배선 전 상한·fit 부재 시절엔 제보 37건 중 8건(iPhone F03·F04·F07·F09·F10·F11 +
 * 태블릿 F33·F36)이 이 화면 하나에서 나왔다(단일 최대 오염원).
 *
 * 🟢 [08-04 §C0 완결] `compareLabel`/`compareValue`의 `useFitGroup` 배선(c0-r1) 위에서,
 * 바닥 고정의 원인이던 CenterStage 알람 `<style>`의 `line-height: 1 !important`를 제거해
 * fit이 살아났다(375에서 값 30→60.6px · 640 태블릿 9자리 31→48.7px, 잉크는 슬롯 안).
 * 「인라인 line-height 무시 현상」(A0-probe.md §8)도 같은 규칙이 원인이었다 — 알람 분기에서만
 * DOM에 존재하는 `<style>`이라 알람 밖 시트 전수조사가 0건으로 나왔던 것(gates/15 TEAMOPS-69).
 * `@pending-lineheight` 태그는 전부 뗐고 단언 A·B·C가 정상 회귀 가드다.
 *
 * 아래 두 값 쌍은 실제 재현 값이다(짧은 값 `9`↔`8`은 배선 없이도 통과하는 반증 함정이라 쓰지 않는다):
 *   - iPhone(F11): 직전 `255.5` → 현재 `255`
 *   - 태블릿(F33·F36): 직전 `3` → 현재 `388859857`
 *
 * 🔴 [실측 이탈 보고 — COMMON §0-2] 브리핑 §3의 단언 A는 "좌우 두 칸의 `getBoundingClientRect()`가
 * 교집합을 갖지 않는다"를 겹침 판정으로 쓰라고 되어 있다. 실측 결과 이 판정은 4개 시나리오
 * (2뷰포트×2값쌍) **전부에서 상시 false(교집합 없음)**로 나와 압력이 전혀 없다 — `COMPARE_LABEL`/
 * `COMPARE_VALUE`의 `maxWidth: '100%'`가 grid item의 박스 자체를 트랙 폭에 고정해, 텍스트가 아무리
 * 넘쳐도 **박스는 절대 안 겹치기 때문**이다(F11 스크린샷의 "글자끼리 겹쳐 보임"은 박스가 아니라
 * 페인트된 잉크가 겹치는 것). 그래서 겹침 판정은 `Range.selectNodeContents`로 얻는 **잉크 rect**
 * 교집합으로 치환한다(A1이 `fitGroup.ts` 판정에 쓰는 것과 같은 기법 — 브리핑 §2 지시대로 "같은
 * 눈으로" 쟀다). `scrollWidth <= clientWidth`는 브리핑 문구대로 유지한다 — 실측상 이 컴포넌트는
 * (A0가 별도 컴포넌트에서 잡은 inline-flex 좌측 오버플로 미감지와 달리) grid item blockify 덕에
 * 라벨 쪽도 scrollWidth가 정확히 넘침을 반영했다(예: 640px 라벨 scrollWidth 272 vs clientWidth 168,
 * 잉크폭 271.94와 거의 일치) — 그래도 두 신호를 모두 남겨 어느 한쪽만으로 가짜 green이 되는 경로를
 * 막는다.
 *
 * 🔴 [실측 이탈 보고] 태블릿 재현값 `388859857`은 음성 경로로 도달 불가능하다 —
 * `koreanNum.ts:27`의 `OVERFLOW_THRESHOLD = 9999`가 음성/STT 파싱값을 절대값 9999로 캡한다.
 * `manualInput.ts`의 `validateManual`은 `int` 타입에 그런 상한이 없어, 이 값은 **터치 키패드
 * 수동입력 경로**(`manual-key-*` → `manual-commit`, `commitManualValue`)로만 재현된다 — 태블릿
 * 사용자가 음성 대신 터치 키패드를 썼다는 정황과도 맞는다.
 *
 * 단언 B(§C5-c)는 "같은 성격 같은 크기" 그 자체가 아니라 **"같은 크기이며 동시에 배정폭 안"**의
 * 결합이다(현 코드가 좌우 동일한 정적 CSS 공식만 쓰므로 크기 동일 자체는 늘 참이라 압력이 없다 —
 * 결합해야 "그룹이 아니라 멤버별로 fit을 잘못 배선"한 경우도 잡는다: 그러면 크기는 갈라지고
 * 배정폭 안은 만족해 결합이 여전히 red가 된다).
 *
 * 단언 C(뷰포트 차이)는 "무변화 카드"(clamp 상한·바닥 고정 재발) 방지 회귀 가드다.
 * 🔑 **단언 A·B만으로는 바닥 고정이 안 보인다**(바닥 크기도 겹침·오버플로 계약은 만족하므로) —
 * 크기가 실제로 자라는지는 이 단언이 유일하게 잡는다(Larry, 08-03: "단언 C가 아니었으면
 * 이 회귀는 green으로 통과했다"). 08-04 원인 해소로 정식 회귀 가드로 승격됐다.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot } from './fixtures/activeZones';
import { fireStt, waitForTtsIdle } from './fixtures/stt';

test.setTimeout(120_000);

const PHONE_402 = { width: 402, height: 874 };
const PHONE_640 = { width: 640, height: 1024 };

function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const PREV_ROUND = localISO(new Date(Date.now() - 86_400_000));

/** 컬럼은 `int`(무상한) — 태블릿 값(`388859857`)이 `float`의 소수 자리 검증에 걸리지 않게 한다.
 *  prev는 시트 원본 문자열 그대로 표시되므로(`String(v.prev)`) 컬럼 타입과 무관하다. */
function makeSettings(trendRule: 'increase' | 'decrease', prevValue: string) {
  const columns = [
    { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
    { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
    { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
    { id: 'v0', name: '측정항목01', type: 'int', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, sampleKey: false, trendRule },
  ];
  const settings = {
    state: {
      googleConnected: true, userEmail: 'tester@example.com',
      sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_C0_ALARM/edit',
      sheetTab: 'Sheet1', columnsSheetId: 'SHEET_C0_ALARM', columnsSheetTab: 'Sheet1',
      columns, tableGenerated: true, totalRows: 2, ttsRate: 1.05,
      recognitionTolerance: 0.6, sessionLabelColId: null, sessionAutoLabel: 'c0-alarm-fit',
      preferredVoiceName: '', roundDateColId: null,
    },
    version: 13,
  };
  const headers = ['조사일자', '농가명', '조사나무', '측정항목01'];
  const sheetRows = [[PREV_ROUND, '이원창', '1', prevValue]];
  return { settings, headers, sheetRows };
}

type ElemMetrics = {
  text: string;
  fontSize: number;
  clientWidth: number;
  scrollWidth: number;
  ink: { x: number; right: number };
};

async function measure(page: Page): Promise<{
  metrics: Record<'anomaly-prev-label' | 'anomaly-prev-value' | 'anomaly-next-label' | 'anomaly-next-value', ElemMetrics>;
  labelInkOverlap: boolean;
  valueInkOverlap: boolean;
}> {
  return page.locator('[data-testid="anomaly-comparison"]').evaluate((el) => {
    // 잉크 rect — A1의 fitGroup.ts 판정과 같은 기법(Range.selectNodeContents). getBoundingClientRect의
    // 박스는 maxWidth:100%로 트랙 폭에 고정돼 넘침을 반영하지 않는다(위 docstring 실측 이탈 보고).
    const inkRect = (node: HTMLElement) => {
      const text = node.firstChild;
      if (!text) return node.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(text);
      const rects = range.getClientRects();
      return rects.length > 0 ? rects[0] : node.getBoundingClientRect();
    };
    const ids = ['anomaly-prev-label', 'anomaly-prev-value', 'anomaly-next-label', 'anomaly-next-value'] as const;
    const m = {} as Record<(typeof ids)[number], ElemMetrics>;
    for (const id of ids) {
      const node = el.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
      const ink = inkRect(node);
      m[id] = {
        text: node.textContent ?? '',
        fontSize: parseFloat(getComputedStyle(node).fontSize),
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        ink: { x: ink.x, right: ink.right },
      };
    }
    const overlaps = (a: ElemMetrics, b: ElemMetrics) => a.ink.x < b.ink.right && b.ink.x < a.ink.right;
    return {
      metrics: m,
      labelInkOverlap: overlaps(m['anomaly-prev-label'], m['anomaly-next-label']),
      valueInkOverlap: overlaps(m['anomaly-prev-value'], m['anomaly-next-value']),
    };
  });
}

/** 태블릿 재현값은 음성 경로(OVERFLOW_THRESHOLD=9999)를 못 넘어 터치 키패드로 커밋한다. */
async function commitViaKeypad(page: Page, digits: string) {
  await page.locator('[data-testid="column-chip"][data-active="true"]').click();
  await page.locator('[data-testid="manual-value-sheet"]').waitFor({ state: 'visible', timeout: 3000 });
  for (const k of digits) {
    await page.locator(`[data-testid="manual-key-${k}"]`).click();
  }
  await page.locator('[data-testid="manual-commit"]').click();
}

const CASES = [
  { name: 'iPhone 255.5→255(음성)', trendRule: 'decrease' as const, prevValue: '255.5', spoken: '255', viaKeypad: false },
  { name: '태블릿 3→388859857(키패드)', trendRule: 'increase' as const, prevValue: '3', spoken: '388859857', viaKeypad: true },
  // 🔴 등길이 값쌍(리뷰② 2026-08-04) — 위 두 쌍은 5:3·1:9라 구조적으로 충돌 불가다(짧은 쪽에
  // 항상 여유). fit은 잉크를 트랙 경계까지 키우므로(경계 추구 평형) column-gap이 죽으면
  // **글자수가 같은 쌍**만 ~2px로 맞붙어 한 덩어리로 읽힌다(실캡처 "99.919.9"). 이 쌍이 그 축을
  // 잰다. ⚠️ 소수쌍(`99.9`)은 못 쓴다 — 이 픽스처의 컬럼이 `int`(9자리 무상한용)라 커밋이 안 돼
  // 알람이 아예 안 뜬다(08-04 실측 timeout). 등길이 int 쌍으로 같은 축을 잰다.
  { name: '등길이 999→199(음성)', trendRule: 'decrease' as const, prevValue: '999', spoken: '199', viaKeypad: false },
];

async function setupCase(
  page: Page,
  viewport: { width: number; height: number },
  c: (typeof CASES)[number],
) {
  const { settings, headers, sheetRows } = makeSettings(c.trendRule, c.prevValue);
  await boot(page, viewport, { settings, headers, sheetRows });
  await waitForTtsIdle(page);
  if (c.viaKeypad) await commitViaKeypad(page, c.spoken);
  else await fireStt(page, c.spoken, 900);
  await page.locator('[data-testid="anomaly-alert"]').waitFor({ state: 'visible', timeout: 4000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
}

// 🟢 §C0 완결(08-04) — 바닥 고정의 근인은 CenterStage 알람 `<style>`의
// `line-height: 1 !important`였다(글리프 초과 → overflowsHeight 전 배율 true → 이진탐색
// low 즉시 이탈). "인라인 line-height 무시 현상"(A0-probe.md §8)도 같은 규칙이 원인
// (알람 분기에서만 DOM에 존재해 알람 밖 시트 조사가 0건 — TEAMOPS-69). 강제 제거로
// 전 케이스 green 전환을 직렬 2회 실측 확인, @pending-lineheight 태그를 전부 뗐다.

for (const viewport of [PHONE_402, PHONE_640]) {
  for (const c of CASES) {
    test(`§C0 단언A — 겹치지 않는다 · ${c.name} @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await setupCase(page, viewport, c);
      const r = await measure(page);
      console.log(`[v0440-alarm-fit][A] ${c.name}@${viewport.width}x${viewport.height} = ${JSON.stringify(r)}`);

      expect(r.labelInkOverlap, '좌우 라벨 잉크 rect 교집합 없음').toBe(false);
      expect(r.valueInkOverlap, '좌우 값 잉크 rect 교집합 없음').toBe(false);
      // 🔴 교집합 없음만으로는 부족하다(리뷰② 2026-08-04) — 간격 0.1px도 통과해 두 수가
      // 한 덩어리로 읽히는 결함("99.919.9")이 안 보인다. 최소 간격은 팝업 인라인
      // columnGap clamp(4px,…)의 하한 4px — CenterStage가 column-gap을 다시 강제하면 red다.
      const labelGap = r.metrics['anomaly-next-label'].ink.x - r.metrics['anomaly-prev-label'].ink.right;
      const valueGap = r.metrics['anomaly-next-value'].ink.x - r.metrics['anomaly-prev-value'].ink.right;
      console.log(`[v0440-alarm-fit][A-gap] ${c.name}@${viewport.width} labelGap=${labelGap.toFixed(2)} valueGap=${valueGap.toFixed(2)}`);
      expect(labelGap, '좌우 라벨 잉크 간격 ≥ 4px(한 덩어리로 안 읽힘)').toBeGreaterThanOrEqual(4);
      expect(valueGap, '좌우 값 잉크 간격 ≥ 4px(한 덩어리로 안 읽힘)').toBeGreaterThanOrEqual(4);
      for (const id of ['anomaly-prev-label', 'anomaly-prev-value', 'anomaly-next-label', 'anomaly-next-value'] as const) {
        expect(r.metrics[id].scrollWidth, `${id} scrollWidth<=clientWidth`)
          .toBeLessThanOrEqual(r.metrics[id].clientWidth + 1);
      }
    });

    test(`§C5-c 단언B — 같은 성격은 같은 크기(배정폭 안과 결합) · ${c.name} @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await setupCase(page, viewport, c);
      const r = await measure(page);
      const fits = (id: 'anomaly-prev-label' | 'anomaly-prev-value' | 'anomaly-next-label' | 'anomaly-next-value') =>
        r.metrics[id].scrollWidth <= r.metrics[id].clientWidth + 1;

      const labelSizesEqual = Math.abs(r.metrics['anomaly-prev-label'].fontSize - r.metrics['anomaly-next-label'].fontSize) < 0.01;
      const labelsFit = fits('anomaly-prev-label') && fits('anomaly-next-label');
      const valueSizesEqual = Math.abs(r.metrics['anomaly-prev-value'].fontSize - r.metrics['anomaly-next-value'].fontSize) < 0.01;
      const valuesFit = fits('anomaly-prev-value') && fits('anomaly-next-value');

      console.log(
        `[v0440-alarm-fit][B] ${c.name}@${viewport.width}x${viewport.height} ` +
        `label(equal=${labelSizesEqual},fit=${labelsFit},sizes=${r.metrics['anomaly-prev-label'].fontSize.toFixed(2)}/${r.metrics['anomaly-next-label'].fontSize.toFixed(2)}) ` +
        `value(equal=${valueSizesEqual},fit=${valuesFit},sizes=${r.metrics['anomaly-prev-value'].fontSize.toFixed(2)}/${r.metrics['anomaly-next-value'].fontSize.toFixed(2)})`,
      );

      // 🔴 반증 함정(브리핑 §3) — 좌우 폰트 동일 자체는 지금도 항상 참이다(정적 CSS 공식 공유).
      // 압력은 "동일 ∧ 배정폭 안" 결합에서 나온다: 멤버별(그룹 아닌) fit으로 잘못 배선하면
      // 안 fit은 고쳐져도 동일함이 깨져 여전히 red다.
      expect(labelSizesEqual && labelsFit, '라벨 그룹 — 동일 크기이며 둘 다 배정폭 안').toBe(true);
      expect(valueSizesEqual && valuesFit, '값 그룹 — 동일 크기이며 둘 다 배정폭 안').toBe(true);
    });
  }
}

test('§C0 단언C — 402×874와 640×1024에서 값이 서로 달라야 한다(무변화 카드 방지)', async ({ page }) => {
  const c = CASES[0];
  await setupCase(page, PHONE_402, c);
  const narrow = await measure(page);

  await page.setViewportSize(PHONE_640);
  await page.waitForTimeout(300);
  const wide = await measure(page);

  console.log(
    `[v0440-alarm-fit][C] label ${narrow.metrics['anomaly-prev-label'].fontSize.toFixed(2)}→${wide.metrics['anomaly-prev-label'].fontSize.toFixed(2)}px, ` +
    `value ${narrow.metrics['anomaly-prev-value'].fontSize.toFixed(2)}→${wide.metrics['anomaly-prev-value'].fontSize.toFixed(2)}px`,
  );
  // 🔑 단언 A·B(겹침·배정폭)는 바닥 크기로도 대부분 만족되어 바닥 고정을 못 잡는다 —
  // 크기가 실제로 자라는지는 이 단언이 유일하게 잡는다(Larry 08-03: "단언 C가 아니었으면
  // 이 회귀는 green으로 통과했다"). 08-04 §C0 완결로 정식 회귀 가드가 됐다(실측
  // label 61→96px · value 65→102px).
  expect(wide.metrics['anomaly-prev-label'].fontSize, '뷰포트가 넓어지면 라벨도 커진다')
    .toBeGreaterThan(narrow.metrics['anomaly-prev-label'].fontSize + 5);
  expect(wide.metrics['anomaly-prev-value'].fontSize, '뷰포트가 넓어지면 값도 커진다')
    .toBeGreaterThan(narrow.metrics['anomaly-prev-value'].fontSize + 5);
});
