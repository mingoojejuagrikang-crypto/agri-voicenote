/**
 * v0.46.0 WP-B — 🔴 **하한 오라클**: "영역이 남는데도 글자가 작으면 red".
 *
 * ## 왜 신설하나
 *
 * 민구 원문(08-05 재전달): *"화면 중단 알람이 **잘리거나 너무 작게** 표시"*.
 * **판정 축이 둘인데 스위트는 하나만 잰다.**
 *
 * | 축 | 뜻 | 종전 스위트 |
 * |---|---|---|
 * | 잘림 | 글자가 배정 영역을 넘는다 | 🟢 잰다 (`v0440-alarm-fit` 단언A·B, `v043-fit-group`) |
 * | **너무 작게** | **영역이 남는데도 글자가 작다** | 🔴 **안 잰다 — 이 파일이 그 축이다** |
 *
 * 🔑 넘침만 재면 **fit이 바닥에 눌려 작게 렌더되는 것은 전부 green으로 통과한다** —
 * 바닥 크기도 "안 넘침" 계약은 만족하기 때문이다. §C0가 정확히 그렇게 두 회차를 낭비했다.
 * `v0440-alarm-fit` 단언C(402↔640 크기 변화)가 그 축을 **일부** 잡지만 상대 비교라
 * "둘 다 작다"는 통과한다. 이 파일은 **절대 판정**을 준다.
 *
 * ## 판정 원리 — 「여유 프로브(headroom probe)」
 *
 * ```
 *   현재 실렌더 상태에서 대상 그룹의 폰트를 ×HEADROOM_FACTOR 강제 확대
 *     → 제품의 잘림 판정(overflowsWidth / overflowsHeight)을 재실행
 *       → **여전히 안 넘치면 red**  ("그만큼 여유가 있었는데 fit이 안 키웠다")
 * ```
 *
 * 🔴 **`trend-alert:400`을 뒤집어 만든 반증 테스트와 같은 형태다**(플랜 §3-6 지시).
 * 잘림 오라클이 "넘치면 red"라면, 이것은 **"안 넘칠 여유가 남으면 red"** 다.
 *
 * ### 이 설계가 세 함정을 동시에 피한다
 *
 * 1. 🔴 **새 공식을 만들지 않는다**(브리핑 §1 — 이 레포는 새 공식을 만들다 두 회차를 썼다).
 *    제품의 판정 함수를 `.toString()`으로 심어 그대로 쓴다(`installFitJudge`,
 *    `[TEAMOPS-64]` 기법). 판정식을 스펙에 복제하면 제품과 같은 눈이 되어 아무것도 못 잡는다
 *    (`[TEAMOPS-47]`). ⚠️ 이것이 성립하려면 두 판정 함수가 **자기 완결**이어야 한다 —
 *    `fitGroup.ts` 상단 주석이 그 계약을 지킨다. 거기서 상수를 모듈 스코프로 빼면 여기가 죽는다.
 * 2. 🔴 **절대 px 기준을 박지 않는다**(브리핑 §8 시트 불특정 원칙). "몇 px 이상이어야 한다"가
 *    아니라 **"더 키울 수 있는가"** 만 묻는다. 그래서 항목명이 1글자든 10글자든, 값이 `4.2`든
 *    `1234.56`이든 같은 판정이 성립한다. 내일 품질조사 시트로 바뀌어도 이 오라클은 유효하다.
 * 3. 🔴 **원인을 불문한다.** "영역이 남는데 작다"의 원인은 둘이고 **둘 다 red여야 한다**:
 *      (a) fit 배율이 낮게 잡혔다 (이진탐색이 바닥에서 이탈 — §C0 실패 모드)
 *      (b) 배율은 열렸는데 `clamp(…, N px)` **고정 상한**이 막았다 (규칙 2 위반 부채)
 *    폰트를 직접 키우는 프로브는 CSS 경로를 우회하므로 (a)·(b)를 가리지 않고 잡는다.
 *
 * ### 🔴 이 오라클이 **안 재는 축** (산출물 ②에 그대로 간다)
 *
 * - **미관·절대 가독성** — "22px가 장갑 낀 손으로 2~3m에서 읽히나"는 안 잰다.
 *   최소 가독 크기(ui-standard §7-2)가 민구 미확정이라 기준이 없다. 이건 실기기 판정 몫이다.
 * - **그룹 간 시각 위계** — "값이 라벨보다 커야 한다"는 `v0440-alarm-fit` 단언B 몫이다.
 * - **HEADROOM_FACTOR 미만의 미세 손실** — 아래 상수 주석 참조. 의도적으로 안 잰다.
 * - **세로 여백 배분의 적정성** — 글자를 더 키울 수 있는지만 보고, 남은 여백이 예쁘게
 *   나뉘었는지는 안 본다.
 * - **줄바꿈 가능 텍스트** — 중앙 3종은 전부 `whiteSpace: nowrap`이라 폭이 지배 제약이다.
 *   `wordBreak`로 접히는 텍스트에는 이 프로브의 폭 판정이 그대로 성립하지 않는다.
 */
import { test, expect, type Page } from '@playwright/test';
import { overflowsWidth, overflowsHeight } from '../src/components/voice/fitGroup';
import { boot } from './fixtures/activeZones';
import { fireStt, fireSttInterim, waitForTtsIdle } from './fixtures/stt';

test.setTimeout(120_000);

const PHONE_402 = { width: 402, height: 874 };
const PHONE_640 = { width: 640, height: 1024 };

/** 🔴 여유 판정 배수. "이만큼 키워도 안 넘치면 그건 너무 작은 것이다."
 *
 *  왜 1.15인가 — 두 잡음보다 크고, 사람이 "작다"고 느끼는 하한보다는 작아야 한다:
 *   - `fitGroups`의 이진탐색은 10회라 배율 해상도가 (high−low)/2¹⁰ ≈ **1% 미만**이다.
 *     그보다 작은 마진을 쓰면 탐색 잔차를 결함으로 오판한다(거짓 red).
 *   - 서브픽셀·폰트 폴백 흔들림도 이 아래다(§A2 실측 excess 0~5px).
 *   - 반대로 너무 크게 잡으면(예: 1.5) **바닥 고정처럼 몇 배씩 작은 것만** 잡고
 *     "조금씩 작다"는 놓친다. §C0의 실패 모드는 30px vs 60.6px = **2배**였으므로
 *     1.15는 그 형태를 여유 있게 잡는다.
 *  ⚠️ 이 값은 판정 감도이지 제품 계약이 아니다. 낮추면 민감해지고 flaky 위험이 오른다. */
const HEADROOM_FACTOR = 1.15;

/** 🔴 `page.evaluate` 앞에 **반드시** 부른다 (`[TEAMOPS-64]`).
 *
 *  Playwright는 넘긴 함수의 **본문만** 문자열화하므로 모듈 스코프 참조가 브라우저로 따라가지
 *  않는다. 제품 소스를 그대로 심어(`.toString()`) **판정식 복제를 피한다** — 스펙이 판정을
 *  베끼면 제품과 같은 눈이 되어 아무것도 못 잡는다(`[TEAMOPS-47]`).
 *  `v043-fit-group.spec.ts`와 같은 계약이며, 두 스펙이 같은 이유로 같은 형태를 쓴다. */
async function installFitJudge(page: Page) {
  await page.evaluate(
    ([widthSrc, heightSrc]) => {
      (globalThis as { __fitJudge?: unknown }).__fitJudge = {
        overflowsWidth: new Function(`return (${widthSrc})`)(),
        overflowsHeight: new Function(`return (${heightSrc})`)(),
      };
    },
    [overflowsWidth.toString(), overflowsHeight.toString()],
  );
}

interface HeadroomResult {
  /** 프로브 전 실렌더 폰트 px(멤버별). 계측 보고용 — 판정에는 안 쓴다(절대 px 기준 금지). */
  before: number[];
  /** ×factor 강제 후 적용된 폰트 px. 인라인 `!important`는 CSS 경로를 우회하므로 항상 before×factor다. */
  after: number[];
  /** 확대 상태에서 폭이 넘쳤나(멤버 중 하나라도). */
  widthOverflowed: boolean;
  /** 확대 상태에서 컨테이너 높이가 넘쳤나. */
  heightOverflowed: boolean;
  /** 🔴 판정: 확대해도 둘 다 안 넘쳤다 = 여유가 남아 있었다 = **red**. */
  hasHeadroom: boolean;
  /** 무엇이 확대를 막았나 — `width` · `height` · `both` · `none`(=여유 있음). */
  bound: 'width' | 'height' | 'both' | 'none';
  /** 프로브 대상이 실제로 글자를 갖고 있었나. false면 빈 요소를 잰 것이라 **무판정**이다. */
  hasText: boolean;
}

/**
 * 여유 프로브 — 대상 멤버들의 폰트를 함께 ×factor 하고 제품 판정을 재실행한다.
 *
 * 🔴 **`page.evaluate` 한 번 안에서 동기적으로** 프로브→측정→복원을 끝낸다.
 *    `useFitGroup`의 ResizeObserver가 **다음 프레임**에 발화해 원래 배율로 되돌리므로,
 *    비동기로 나누면 무엇을 쟀는지 알 수 없게 된다(조용히 무판정이 되는 형태 — §C0가 그랬다).
 * 🔴 **그룹 멤버는 함께 키운다.** 알람 비교 4칸처럼 배율을 공유하는 그룹을 하나만 키우면
 *    그룹 계약(§C5-c "같은 줄 같은 성격은 같은 크기")을 깨뜨린 상태를 재는 셈이 된다.
 */
async function probeHeadroom(
  page: Page,
  memberSelector: string,
  containerSelector: string,
  factor = HEADROOM_FACTOR,
): Promise<HeadroomResult> {
  await installFitJudge(page);
  return page.evaluate(
    ({ memberSelector, containerSelector, factor }) => {
      const judge = (globalThis as {
        __fitJudge?: {
          overflowsWidth: (el: HTMLElement) => boolean;
          overflowsHeight: (el: HTMLElement) => boolean;
        };
      }).__fitJudge;
      if (!judge) throw new Error('__fitJudge 미설치 — installFitJudge를 먼저 불러라');

      const container = document.querySelector<HTMLElement>(containerSelector);
      if (!container) throw new Error(`컨테이너를 못 찾았다: ${containerSelector}`);
      const members = Array.from(document.querySelectorAll<HTMLElement>(memberSelector));
      if (members.length === 0) throw new Error(`멤버를 못 찾았다: ${memberSelector}`);

      const read = (el: HTMLElement) => Number.parseFloat(getComputedStyle(el).fontSize);
      const before = members.map(read);
      // 🔴 빈 요소를 재면 `overflowsWidth`가 잉크폭 0 → `scrollWidth` 폴백 → 항상 false가 되어
      //    **빈 슬롯이 red로 둔갑한다**(AlarmInterimStrip은 interim이 없으면 visibility:hidden인
      //    빈 박스로 남는다). 판정 전에 글자 유무를 함께 반환해 호출자가 무판정 처리하게 한다.
      const hasText = members.every((el) => (el.textContent ?? '').trim().length > 0);

      // 원래 인라인 fontSize를 보존한다(React가 심은 값 — 복원 못 하면 이후 단언이 오염된다).
      const saved = members.map((el) => el.style.getPropertyValue('font-size'));
      const savedPriority = members.map((el) => el.style.getPropertyPriority('font-size'));
      members.forEach((el, i) => {
        // 🔴 `!important`로 심는다 — CenterStage 알람 `<style>`이 `!important`를 쓰므로
        //    보통 우선순위로는 덮이지 않는 슬롯이 있다(폰트는 현재 안 그렇지만, 조건부
        //    `<style>`이 늘어나면 조용히 무효가 되는 형태라 방어한다).
        el.style.setProperty('font-size', `${before[i] * factor}px`, 'important');
      });

      // 강제 리플로우 — 판정 전에 레이아웃이 확정돼야 한다.
      void container.getBoundingClientRect();
      const after = members.map(read);
      const widthOverflowed = members.some((el) => judge.overflowsWidth(el));
      const heightOverflowed = judge.overflowsHeight(container);

      // 즉시 복원.
      members.forEach((el, i) => {
        el.style.removeProperty('font-size');
        if (saved[i]) el.style.setProperty('font-size', saved[i], savedPriority[i]);
      });
      void container.getBoundingClientRect();

      return {
        before,
        after,
        widthOverflowed,
        heightOverflowed,
        hasHeadroom: !widthOverflowed && !heightOverflowed,
        bound: widthOverflowed && heightOverflowed ? 'both'
          : widthOverflowed ? 'width'
          : heightOverflowed ? 'height'
          : 'none',
        hasText,
      } as const;
    },
    { memberSelector, containerSelector, factor },
  );
}

/** 판정 + 계측 로그. 실패 메시지가 **왜 red인지**를 그대로 말하게 한다. */
function expectNoHeadroom(tag: string, r: HeadroomResult) {
  const fmt = (a: number[]) => a.map((n) => n.toFixed(2)).join('/');
  console.log(
    `[v0460-fit-headroom][${tag}] before=${fmt(r.before)}px after=${fmt(r.after)}px ` +
    `bound=${r.bound} (w=${r.widthOverflowed} h=${r.heightOverflowed}) ` +
    `hasText=${r.hasText} → hasHeadroom=${r.hasHeadroom}`,
  );

  // 🔴 빈 요소는 무판정이다 — `overflowsWidth`가 잉크폭 0에서 `scrollWidth` 폴백으로 빠져
  //    무조건 false를 내므로, 빈 슬롯은 **항상** red가 된다(가짜 red).
  expect(r.hasText, `${tag}: 프로브 대상이 비어 있다 — 무판정이다(픽스처가 값을 못 채웠다)`).toBe(true);

  // ⚠️ **green을 무조건 믿지 마라**(브리핑 §3-5). `overflow:hidden` + grid + `transform`이
  //    겹치면 `scrollHeight`가 실제보다 **크게** 나온다. 그 오탐은 heightOverflowed를 참으로
  //    만들어 **green 방향으로만** 작용하므로, "폭은 여유인데 높이만 막았다"는 green은
  //    신뢰 구간 밖이다. 실패시키지는 않는다 — 높이가 진짜 제약인 슬롯(hero는 중앙 트랙이
  //    실제로 높이에 묶인다)까지 red로 만들면 "해가 없다"를 인위적으로 만들게 된다(§3-4).
  //    대신 눈에 띄게 남겨 산출물이 이 케이스를 세도록 한다.
  if (!r.hasHeadroom && r.bound === 'height') {
    console.log(
      `[v0460-fit-headroom][⚠️신뢰주의][${tag}] 폭은 여유인데 높이만 막아 green이다 — ` +
      `scrollHeight 역방향 오탐(§3-5) 가능 구간. 폭 기준으로는 여유가 남아 있다.`,
    );
  }

  expect(
    r.hasHeadroom,
    `${tag}: 폰트를 ×${HEADROOM_FACTOR} 키워도 넘치지 않는다 — 영역이 남는데 글자가 작다.` +
    ` (실렌더 ${fmt(r.before)}px → 확대 ${fmt(r.after)}px, 막은 축=${r.bound})`,
  ).toBe(false);
}

// ─────────────────────────────────────────────────────────────────────────────
// 픽스처 — 🔴 §8 시트 불특정 원칙: 「긴 항목명 + 긴 값」을 **반드시** 포함한다.
//   항목명 길이·값 자릿수·컬럼 개수 가정을 코드에도 오라클에도 박지 않는다. 내일은
//   품질조사 시트를 쓴다(민구 08-05) — 특정 시트로만 검증하면 그때 조용히 깨진다.
// ─────────────────────────────────────────────────────────────────────────────

/** 두 시트 프로필. `short`는 현행 재현값, `long`은 §8이 요구하는 긴 항목명 + 긴 값이다. */
const PROFILES = {
  short: {
    label: '짧은 항목명·값',
    colName: '당도',
    prevValue: '9',
    spoken: '8',
    // 🔴 `decrease` = **작아지면** 알람(`trendCheck.ts:11`). 아래 `spoken`이 `prevValue`보다
    //    작으므로 이 규칙이어야 알람이 뜬다. 08-05에 `increase`(커지면 알람)로 잘못 적어
    //    **알람이 한 번도 안 떴고**, 대상 테스트 전부가 `red`가 아니라 `anomaly-alert`
    //    waitFor **타임아웃 = 무판정**이었다(§C0가 경고한 바로 그 형태 — "red가 아니라 무판정").
    trendRule: 'decrease' as const,
  },
  long: {
    label: '🔴긴 항목명·값(§8 시트 불특정)',
    // 품질조사 시트에서 실제로 나올 만한 길이. 1글자~10글자 폭을 양끝에서 잰다.
    colName: '과실종경측정값',
    prevValue: '1234.56',
    spoken: '1189.42',
    // 🔴 `decrease` = **작아지면** 알람(`trendCheck.ts:11`). 아래 `spoken`이 `prevValue`보다
    //    작으므로 이 규칙이어야 알람이 뜬다. 08-05에 `increase`(커지면 알람)로 잘못 적어
    //    **알람이 한 번도 안 떴고**, 대상 테스트 전부가 `red`가 아니라 `anomaly-alert`
    //    waitFor **타임아웃 = 무판정**이었다(§C0가 경고한 바로 그 형태 — "red가 아니라 무판정").
    trendRule: 'decrease' as const,
  },
} as const;

type Profile = (typeof PROFILES)[keyof typeof PROFILES];

function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const PREV_ROUND = localISO(new Date(Date.now() - 86_400_000));

/** `v0440-alarm-fit.spec.ts`의 검증된 형태를 그대로 따른다. 타입은 `float`(소수 자릿수 필요).
 *
 *  🔴 **음성 컬럼을 늘리지 마라.** 08-05에 기준②(확정 플래시)를 재려고 두 번째 음성 컬럼을
 *  넣었더니 **알람이 아예 안 떴다**(대상①~④ 16/16 `anomaly-alert` waitFor 타임아웃). 이 픽스처의
 *  과거값 매칭·진행 경로는 「음성 컬럼 1개」 형태로 검증된 것이고, 컬럼 구성을 바꾸면 알람
 *  재현부터 깨진다. 기준②는 컬럼을 늘리는 대신 **`review` 상태**로 잰다(아래 참조). */
function makeSettings(p: Profile) {
  const columns = [
    { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
    { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
    { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
    { id: 'v0', name: p.colName, type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, sampleKey: false, trendRule: p.trendRule },
  ];
  const settings = {
    state: {
      googleConnected: true, userEmail: 'tester@example.com',
      sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_WPB_HEADROOM/edit',
      sheetTab: 'Sheet1', columnsSheetId: 'SHEET_WPB_HEADROOM', columnsSheetTab: 'Sheet1',
      columns, tableGenerated: true, totalRows: 2, ttsRate: 1.05,
      recognitionTolerance: 0.6, sessionLabelColId: null, sessionAutoLabel: 'wpb-headroom',
      preferredVoiceName: '', roundDateColId: null,
    },
    version: 13,
  };
  const headers = ['조사일자', '농가명', '조사나무', p.colName];
  const sheetRows = [[PREV_ROUND, '이원창', '1', p.prevValue]];
  return { settings, headers, sheetRows };
}

async function bootProfile(page: Page, viewport: { width: number; height: number }, p: Profile) {
  const { settings, headers, sheetRows } = makeSettings(p);
  await boot(page, viewport, { settings, headers, sheetRows });
  await waitForTtsIdle(page);
}

/** 알람을 띄운다 — 🔴 함정 §3-6: 알람 전용 `<style>`은 이 분기에서만 DOM에 존재한다.
 *  중앙 크기 조사는 **반드시 증상이 재현된 상태**(알람을 띄운 채)에서 해야 한다. */
async function raiseAlarm(page: Page, p: Profile) {
  await fireStt(page, p.spoken, 900);
  await page.locator('[data-testid="anomaly-alert"]').waitFor({ state: 'visible', timeout: 4000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
}

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
}

// ─────────────────────────────────────────────────────────────────────────────
// 🟢 기준 경로 — 민구가 *"현재 사이즈를 유동적으로 잘 출력하고 있음"* 이라고 지목한 그것.
//    **이 두 테스트가 green이어야 오라클이 옳다.** 여기가 red면 프로브가 틀린 것이지
//    제품이 틀린 것이 아니다(감도 HEADROOM_FACTOR를 의심하라).
// ─────────────────────────────────────────────────────────────────────────────

for (const viewport of [PHONE_402, PHONE_640]) {
  for (const p of [PROFILES.short, PROFILES.long]) {
    test(`기준① 실시간 인식값에 여유가 없다 · ${p.label} @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await bootProfile(page, viewport, p);
      await fireSttInterim(page, p.spoken, 400);
      await page.locator('[data-hero-state] [data-testid="interim-value"]').waitFor({ state: 'visible', timeout: 4000 });
      await settle(page);
      const r = await probeHeadroom(
        page,
        '[data-hero-state] [data-testid="interim-value"]',
        '[data-hero-state]',
      );
      expectNoHeadroom(`기준①interim/${p.label}@${viewport.width}`, r);
    });

    test(`기준② 확정값에 여유가 없다 · ${p.label} @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await bootProfile(page, viewport, p);
      // 🔴 **`confirm`이 아니라 `review`로 잰다.** confirm 플래시는 `CONFIRM_MS = 1500`ms 창이라
      //    `waitFor` 성공과 프로브 사이에 **창이 닫힌다**(08-05 실측: waitFor는 통과했는데
      //    `page.evaluate`가 `[data-hero-state="confirm"]`를 못 찾았다). `review`는 타이머가
      //    없어 안정적이고, 같은 `HeroPrimaryLine`·같은 `--fit-value` 그룹이라 **같은 것을 잰다** —
      //    게다가 사용자가 실제로 오래 보는 화면이다.
      //    알람이 안 뜨는 값(직전값 그대로 = 추세 위반 아님)으로 커밋해 행을 완료시킨다.
      await fireStt(page, p.prevValue, 300);
      const target = '[data-hero-state="review"] [data-testid="hero-primary"]';
      await page.locator(target).waitFor({ state: 'visible', timeout: 6000 });
      const r = await probeHeadroom(page, target, '[data-hero-state="review"]');
      expectNoHeadroom(`기준②review/${p.label}@${viewport.width}`, r);
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 범위 대상 — 브리핑 §2 표. 여기가 red면 **제품이 틀린 것이다.**
// ─────────────────────────────────────────────────────────────────────────────

for (const viewport of [PHONE_402, PHONE_640]) {
  for (const p of [PROFILES.short, PROFILES.long]) {
    test(`대상① 알람 경보행에 여유가 없다 · ${p.label} @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await bootProfile(page, viewport, p);
      await raiseAlarm(page, p);
      const r = await probeHeadroom(
        page,
        '[data-testid="anomaly-headline"]',
        '[data-testid="anomaly-alert"]',
      );
      expectNoHeadroom(`대상①headline/${p.label}@${viewport.width}`, r);
    });

    test(`대상② 알람 비교 라벨 그룹에 여유가 없다 · ${p.label} @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await bootProfile(page, viewport, p);
      await raiseAlarm(page, p);
      const r = await probeHeadroom(
        page,
        '[data-testid="anomaly-prev-label"], [data-testid="anomaly-next-label"]',
        '[data-testid="anomaly-comparison"]',
      );
      expectNoHeadroom(`대상②compareLabel/${p.label}@${viewport.width}`, r);
    });

    test(`대상③ 알람 비교 값 그룹에 여유가 없다 · ${p.label} @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await bootProfile(page, viewport, p);
      await raiseAlarm(page, p);
      const r = await probeHeadroom(
        page,
        '[data-testid="anomaly-prev-value"], [data-testid="anomaly-next-value"]',
        '[data-testid="anomaly-comparison"]',
      );
      expectNoHeadroom(`대상③compareValue/${p.label}@${viewport.width}`, r);
    });

    test(`대상④ 알람 중 실시간 인식값에 여유가 없다 · ${p.label} @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await bootProfile(page, viewport, p);
      await raiseAlarm(page, p);
      // AlarmInterimStrip — 알람 카드 **아래**의 미확정 인식값 스트립(정정 발화 확인용).
      // hero의 InterimLine과 testid가 같으므로 알람 분기 자식으로 한정한다.
      // 🔴 interim이 비면 `visibility:hidden`인 빈 박스만 남아 프로브가 **가짜 red**를 낸다
      //    (잉크폭 0 → scrollWidth 폴백 → 항상 "안 넘침"). 글자가 실제로 찰 때까지 기다린다.
      await fireSttInterim(page, p.spoken, 400);
      await expect(
        page.locator('[data-central-state="alarm"] > [data-testid="interim-value"]'),
        '알람 중 인식값 스트립이 차지 않았다 — 무판정이 된다',
      ).toHaveText(/\S/, { timeout: 4000 });
      await settle(page);
      // 🔴 **member span을 재라.** `data-testid="interim-value"`는 바깥 flex 컨테이너에 있고
      //    실제 fit 대상은 그 안의 `[data-fit-group="alarm-interim"]` span이다. 바깥을 재면
      //    flex 컨테이너의 폭 판정이라 넘침이 안 잡혀 가짜 red가 난다(08-05 실측 16.00px).
      const r = await probeHeadroom(
        page,
        '[data-central-state="alarm"] [data-fit-group="alarm-interim"]',
        '[data-central-state="alarm"] > [data-testid="interim-value"]',
      );
      expectNoHeadroom(`대상④alarmInterim/${p.label}@${viewport.width}`, r);
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 §3-1 블래스트 반경 **재측정** — 계수가 아니라 구조를 잰다.
//
// 브리핑 §3-1은 `CenterStage.tsx:53`의 `line-height: 1 !important`가 현존한다고 전제하나
// **실측 0건이다** — 커밋 `488adbc`(§C0)가 제거했고 되돌려지지 않았다. 그래서 남은 강제는
// `ALARM_TWO_COLUMN_LAYOUT`의 `row-gap:0` · `overflow:hidden` · `padding-block:0` 셋이다.
//
// 재는 방법: **제품 코드를 건드리지 않고** 강제를 하나씩 인라인으로 무력화하며 "안 넘치는
// 최대 배수"가 얼마나 움직이는지 본다. 그 델타가 곧 각 강제의 블래스트 반경이다.
// 🔴 §3-6 준수 — 알람을 **띄운 채** 잰다. 그 `<style>`은 알람 분기에서만 DOM에 존재한다.
// ─────────────────────────────────────────────────────────────────────────────

/** 안 넘치는 **최대 폰트 배수**를 이진탐색한다. 1.0이면 여유 0(딱 맞음), 2.0이면 두 배까지 가능. */
async function measureMaxFactor(
  page: Page,
  memberSelector: string,
  containerSelector: string,
): Promise<number> {
  await installFitJudge(page);
  return page.evaluate(
    ({ memberSelector, containerSelector }) => {
      const judge = (globalThis as {
        __fitJudge?: {
          overflowsWidth: (el: HTMLElement) => boolean;
          overflowsHeight: (el: HTMLElement) => boolean;
        };
      }).__fitJudge!;
      const container = document.querySelector<HTMLElement>(containerSelector)!;
      const members = Array.from(document.querySelectorAll<HTMLElement>(memberSelector));
      const base = members.map((el) => Number.parseFloat(getComputedStyle(el).fontSize));
      const saved = members.map((el) => el.style.getPropertyValue('font-size'));
      const savedPriority = members.map((el) => el.style.getPropertyPriority('font-size'));

      const fitsAt = (factor: number) => {
        members.forEach((el, i) => {
          el.style.setProperty('font-size', `${base[i] * factor}px`, 'important');
        });
        void container.getBoundingClientRect();
        return !members.some((el) => judge.overflowsWidth(el)) && !judge.overflowsHeight(container);
      };

      let low = 1;
      let high = 1;
      // 실패 경계를 위로 열어 찾는다(fitGroups와 같은 형태 — 상한을 미리 정하지 않는다).
      for (let i = 0; i < 8 && fitsAt(high); i += 1) { low = high; high *= 2; }
      if (fitsAt(high)) low = high;
      else for (let i = 0; i < 12; i += 1) {
        const mid = (low + high) / 2;
        if (fitsAt(mid)) low = mid; else high = mid;
      }

      members.forEach((el, i) => {
        el.style.removeProperty('font-size');
        if (saved[i]) el.style.setProperty('font-size', saved[i], savedPriority[i]);
      });
      void container.getBoundingClientRect();
      return low;
    },
    { memberSelector, containerSelector },
  );
}

/** `ALARM_TWO_COLUMN_LAYOUT`의 개별 강제를 인라인으로 무력화한다(제품 코드 불변, 되돌릴 수 있다). */
const FORCES = [
  { key: '기준선(무력화 없음)', css: '' },
  { key: 'anomaly-alert padding-block:0 해제', css: `[data-central-state="alarm"] [data-testid="anomaly-alert"] { padding-block: revert !important; }` },
  { key: 'anomaly-alert row-gap:0 해제', css: `[data-central-state="alarm"] [data-testid="anomaly-alert"] { row-gap: revert !important; }` },
  { key: 'anomaly-comparison row-gap:0 해제', css: `[data-central-state="alarm"] [data-testid="anomaly-comparison"] { row-gap: revert !important; }` },
  { key: 'anomaly-comparison overflow:hidden 해제', css: `[data-central-state="alarm"] [data-testid="anomaly-comparison"] { overflow: visible !important; }` },
  { key: '🔴 넷 전부 해제', css: `[data-central-state="alarm"] [data-testid="anomaly-alert"] { padding-block: revert !important; row-gap: revert !important; } [data-central-state="alarm"] [data-testid="anomaly-comparison"] { row-gap: revert !important; overflow: visible !important; }` },
] as const;

test('§3-1 블래스트 반경 재측정 — 알람 CSS 강제별 여유 배수 @ 402x874', async ({ page }) => {
  await bootProfile(page, PHONE_402, PROFILES.long);
  await raiseAlarm(page, PROFILES.long);

  const targets = [
    { name: '경보행', member: '[data-testid="anomaly-headline"]', container: '[data-testid="anomaly-alert"]' },
    { name: '비교라벨', member: '[data-testid="anomaly-prev-label"], [data-testid="anomaly-next-label"]', container: '[data-testid="anomaly-comparison"]' },
    { name: '비교값', member: '[data-testid="anomaly-prev-value"], [data-testid="anomaly-next-value"]', container: '[data-testid="anomaly-comparison"]' },
  ] as const;

  for (const force of FORCES) {
    await page.evaluate((css) => {
      document.getElementById('__wpb_blast')?.remove();
      if (!css) return;
      const el = document.createElement('style');
      el.id = '__wpb_blast';
      el.textContent = css;
      document.head.appendChild(el);
    }, force.css);
    await page.waitForTimeout(250); // fit 훅의 rAF/RO가 새 박스로 재수렴할 시간

    const line: string[] = [];
    for (const t of targets) {
      const maxFactor = await measureMaxFactor(page, t.member, t.container);
      line.push(`${t.name}=×${maxFactor.toFixed(3)}`);
    }
    console.log(`[v0460-blast][402] ${force.key.padEnd(36)} ${line.join('  ')}`);
  }

  await page.evaluate(() => document.getElementById('__wpb_blast')?.remove());
  // 🔴 계측 전용 테스트다 — 단언하지 않는다. 수치는 산출물 §③으로 간다.
  //    여기에 기대값을 박으면 구조가 바뀔 때마다 무의미하게 깨진다(§3-4: 계수가 아니라 구조).
});

// 완료 요약은 마지막 행까지 채워야 도달하므로 프로필 1종·뷰포트 2종으로만 돈다(비용).
for (const viewport of [PHONE_402, PHONE_640]) {
  test(`대상⑤ 완료 요약 X/N에 여유가 없다 @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await bootProfile(page, viewport, PROFILES.long);
    const summary = page.locator('[data-testid="complete-summary"]');
    // 🔴 알람이 뜨면 진행이 멈춘다(응답 대기) — **직전값 그대로**를 넣어 추세 위반을 피한다.
    //    음성 컬럼 1개 × 2행 = 2커밋이면 끝 도달이다.
    //    (`fillAllRows` 픽스처는 기본 SETTINGS 전용이라 이 픽스처에는 못 쓴다.)
    for (let i = 0; i < 8 && (await summary.count()) === 0; i++) {
      await fireStt(page, PROFILES.long.prevValue, 320);
    }
    await expect(summary, '끝 도달(§[4])에 진입하지 못했다').toBeVisible({ timeout: 5000 });
    await settle(page);
    const r = await probeHeadroom(
      page,
      '[data-testid="complete-count"]',
      '[data-testid="complete-summary"]',
    );
    expectNoHeadroom(`대상⑤completeCount@${viewport.width}`, r);
  });
}
