/**
 * 🔬 **진단 프로브** — 판정 스위트가 아니다(`_` 접두 = `testIgnore`, 08-03 확정분).
 *
 * ## 무엇을 재나
 *
 * 민구 실기기 제보 **FB-6·FB-7**(2026-08-07, v0.46.0-preview):
 * - FB-6: *"중앙 출력 잘림. 인식 및 출력되어야 할 값. 33.3 / 실제 기기에서 보이는 값. 33…"*
 * - FB-7: *"화면 중앙 확정값 표시 불안정. … **정수자리가 2자리 일때와, 3자리 일때를 비교해볼것.**"*
 *
 * 🔴 **기존 게이트가 이 기기를 구조적으로 못 본다:**
 * - `v0440-chip-viewport-sweep`의 `WIDTHS = [375, 430, 540, …]` — **402가 없다.**
 * - `v0460-fit-headroom`의 `PHONE_402 = 402×874` — **높이가 874다.**
 * - 민구 실측 뷰포트는 **402×513**(제보 9건 중 7건. Safari 크롬이 874−513=361px를 먹는다).
 *
 * 이 프로브는 **판정하지 않고 수치를 뜬다.** 잘림 여부·폰트·형제 카드 높이를 뷰포트×값자릿수
 * 격자로 뽑아 콘솔에 표로 낸다. 판정 오라클 신설은 이 수치를 보고 결정한다.
 *
 * ⚠️ 스크린샷은 근거로 쓰지 않는다(`[TEAMOPS-65]`) — 여기 수치는 **브라우저 실렌더 계측**이다.
 */
import { test, type Page } from '@playwright/test';
import { boot } from './fixtures/activeZones';
import { fireStt, fireSttInterim, waitForTtsIdle } from './fixtures/stt';

test.setTimeout(180_000);

/** 🔴 민구 실기기 = 402×513. 나머지는 대조군이다. */
const VIEWPORTS = [
  { width: 402, height: 513, label: '402x513·민구실측' },
  { width: 402, height: 812, label: '402x812·FB4/FB9' },
  { width: 402, height: 874, label: '402x874·기존오라클' },
];

/** FB-7이 지목한 축 = **정수부 자릿수**. 소수 1자리 고정.
 *
 *  🔑 **민구 2차 제보(08-07)가 경계를 직접 줬다** — 이 값들이 그 원문이다:
 *  > *"「22.4」, 「45.7」 이건 인식 확정후 「24…」, 「45…」 이런식으로 보여.
 *  >  하지만 「224.3」, 「135.6」 이런식으로 **정수부가 3자리 이상 되면 확정값이 화면에
 *  >  정상 출력**이 되고 있어."*
 *
 *  👉 **잘림 기대 = 정수 2자리 / 정상 기대 = 정수 3자리.** 1·4자리는 경계 바깥 대조군이다. */
const CASES = [
  { prev: '9.9', spoken: '8.8', label: '정수1자리(8.8)·대조군' },
  { prev: '99.9', spoken: '22.4', label: '🔴정수2자리(22.4)·민구 잘림 실측값' },
  { prev: '99.9', spoken: '45.7', label: '🔴정수2자리(45.7)·민구 잘림 실측값' },
  { prev: '999.9', spoken: '224.3', label: '🟢정수3자리(224.3)·민구 정상 실측값' },
  { prev: '999.9', spoken: '135.6', label: '🟢정수3자리(135.6)·민구 정상 실측값' },
  { prev: '9999.9', spoken: '3333.3', label: '정수4자리(3333.3)·대조군' },
  // 🔴 **양성 대조** — 402 폭에서 반드시 가로로 넘쳐야 하는 값. 여기서도 `ovX=0`이면
  //    프로브가 엉뚱한 박스를 재고 있다는 뜻이고, 다른 모든 수치가 무의미해진다.
  { prev: '1234567.89', spoken: '1234567.89', label: '⚙️양성대조(1234567.89)·ovX>0 나와야 정상' },
];

function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const PREV_ROUND = localISO(new Date(Date.now() - 86_400_000));

/** `v0460-fit-headroom.spec.ts`의 검증된 형태. 🔴 음성 컬럼을 늘리지 마라(그 파일 주석 참조).
 *  🔴 `chipSweepSeconds: 0` 명시 — 왕복 칩은 Playwright `stable`을 영원히 통과 못 해
 *  `click()`이 120초 데드락한다(`[TEAMOPS-81]`, 회차 SSOT §2). */
function makeSettings(colName: string, trendRule?: 'decrease') {
  const columns = [
    { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
    { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
    { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
    { id: 'v0', name: colName, type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, sampleKey: false, ...(trendRule ? { trendRule } : {}) },
  ];
  return {
    state: {
      googleConnected: true, userEmail: 'tester@example.com',
      sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_FB67/edit',
      sheetTab: 'Sheet1', columnsSheetId: 'SHEET_FB67', columnsSheetTab: 'Sheet1',
      columns, tableGenerated: true, totalRows: 2, ttsRate: 1.05,
      recognitionTolerance: 0.6, sessionLabelColId: null, sessionAutoLabel: 'fb67-probe',
      preferredVoiceName: '', roundDateColId: null, chipSweepSeconds: 0,
    },
    version: 13,
  };
}

/** 실렌더 계측. **판정하지 않는다** — 잘림 후보 신호를 전부 같이 뜬다.
 *  `scrollWidth > clientWidth`(가로 넘침) · `scrollHeight > clientHeight`(세로 넘침) ·
 *  rect가 부모 밖으로 나가는지(클리핑) · 폰트 실렌더값. */
async function measure(page: Page, sel: string, parentSel: string) {
  return page.evaluate(({ sel, parentSel }) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    const parent = document.querySelector(parentSel) as HTMLElement | null;
    if (!el) return { found: false as const };
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const pr = parent?.getBoundingClientRect() ?? null;
    // 알람 카드(형제) 높이 — 콜드리뷰 finding #2의 「카드 0」 축
    const card = document.querySelector('[data-testid="anomaly-alert"]') as HTMLElement | null;
    return {
      found: true as const,
      text: el.textContent ?? '',
      fontPx: Math.round(parseFloat(cs.fontSize) * 10) / 10,
      scrollW: el.scrollWidth, clientW: el.clientWidth,
      scrollH: el.scrollHeight, clientH: el.clientHeight,
      overflowX: el.scrollWidth - el.clientWidth,
      overflowY: el.scrollHeight - el.clientHeight,
      rectW: Math.round(r.width * 10) / 10, rectH: Math.round(r.height * 10) / 10,
      // 부모 밖으로 얼마나 나갔나(양수 = 넘침)
      outLeft: pr ? Math.round((pr.left - r.left) * 10) / 10 : null,
      outRight: pr ? Math.round((r.right - pr.right) * 10) / 10 : null,
      outTop: pr ? Math.round((pr.top - r.top) * 10) / 10 : null,
      outBottom: pr ? Math.round((r.bottom - pr.bottom) * 10) / 10 : null,
      textOverflow: cs.textOverflow, overflowCss: cs.overflow, whiteSpace: cs.whiteSpace,
      cardH: card ? Math.round(card.getBoundingClientRect().height * 10) / 10 : null,
    };
  }, { sel, parentSel });
}

const rows: string[] = [];
function record(vp: string, kase: string, phase: string, m: Awaited<ReturnType<typeof measure>>) {
  if (!m.found) { rows.push(`${vp} | ${kase} | ${phase} | ❌ 요소 없음`); return; }
  const clip = m.overflowX > 0 || m.overflowY > 0 || (m.outRight ?? 0) > 0.5 || (m.outLeft ?? 0) > 0.5;
  rows.push(
    `${vp} | ${kase} | ${phase} | ${clip ? '🔴잘림' : '🟢'} ` +
    `text="${m.text}" font=${m.fontPx}px rect=${m.rectW}x${m.rectH} ` +
    `ovX=${m.overflowX} ovY=${m.overflowY} outR=${m.outRight} outB=${m.outBottom} ` +
    `card=${m.cardH} ws=${m.whiteSpace} to=${m.textOverflow}`,
  );
}

/** 🔴 **알람을 켜지 않는다.** FB-6·FB-7은 *"인식 **확정후**"* 의 정상 표시 축이고, 알람이 뜨면
 *  `review`에 도달하지 못해 **정작 재야 할 상태를 못 잰다**(1차 실행에서 12/12 「review 미도달」).
 *  알람 화면의 스트립↔카드 순환 판정은 별개 축이라 `v0460-fit-headroom`이 갖는다. */
for (const vp of VIEWPORTS) {
  for (const c of CASES) {
    test(`프로브 ${vp.label} · ${c.label}`, async ({ page }) => {
      const settings = makeSettings('과실횡경');
      const headers = ['조사일자', '농가명', '조사나무', '과실횡경'];
      const sheetRows = [[PREV_ROUND, '이원창', '1', c.prev]];
      await boot(page, { width: vp.width, height: vp.height }, { settings, headers, sheetRows });
      await waitForTtsIdle(page);

      // ① interim(실시간 인식값)
      await fireSttInterim(page, c.spoken, 400);
      await page.locator('[data-hero-state] [data-testid="interim-value"]').waitFor({ state: 'visible', timeout: 6000 });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
      record(vp.label, c.label, 'interim',
        await measure(page, '[data-hero-state] [data-testid="interim-value"]', '[data-hero-state]'));
    });

    // ② 🔑 **확정값(review)** — FB-6·FB-7이 가리키는 바로 그 상태.
    //    🔴 interim을 선행하면 **조기확정**이 걸려 review를 지나치고 다음 행 `listening`으로 간다
    //    (1차·2차 실행에서 30/30 미도달. `hero-state=listening`이 그 증거였다).
    //    👉 `v0460-fit-headroom` 기준②의 검증된 형태를 그대로 쓴다: interim 없이 **직전값 그대로**
    //    커밋해 행을 완료시킨다.
    test(`프로브 ${vp.label} · ${c.label} · 확정값`, async ({ page }) => {
      const settings = makeSettings('과실횡경');
      const headers = ['조사일자', '농가명', '조사나무', '과실횡경'];
      // 🔑 직전값 = 말할 값. 추세 위반이 아니라 알람이 안 뜨고 곧장 review로 간다.
      const sheetRows = [[PREV_ROUND, '이원창', '1', c.spoken]];
      await boot(page, { width: vp.width, height: vp.height }, { settings, headers, sheetRows });
      await waitForTtsIdle(page);

      await fireStt(page, c.spoken, 300);
      await page.locator('[data-hero-state="review"]').waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);

      // 🔴 3차 실행에서 `hero-state=review`인데 `hero-primary`가 「요소 없음」이었다.
      //    셀렉터를 추측하지 말고 **그 분기의 실제 DOM을 덤프**해서 무엇이 있는지 먼저 본다.
      const dump = await page.evaluate(() => {
        const root = document.querySelector('[data-hero-state="review"]') as HTMLElement | null;
        if (!root) return { state: document.querySelector('[data-hero-state]')?.getAttribute('data-hero-state') ?? null, ids: [] as string[] };
        const ids = Array.from(root.querySelectorAll('[data-testid]'))
          .map((n) => `${n.getAttribute('data-testid')}="${(n.textContent ?? '').slice(0, 12)}"`);
        return { state: 'review', ids };
      });
      rows.push(`${vp.label} | ${c.label} | 🔎DOM | state=${dump.state} testids=[${dump.ids.join(', ')}]`);

      // 값을 담은 요소를 **텍스트로** 찾는다(testid 추측 금지).
      const found = await page.evaluate(({ want }) => {
        const root = document.querySelector('[data-hero-state="review"]') as HTMLElement | null;
        if (!root) return null;
        const cands = Array.from(root.querySelectorAll('*')).filter(
          (n) => (n.textContent ?? '').trim() === want && n.children.length === 0,
        ) as HTMLElement[];
        const el = cands[cands.length - 1];
        if (!el) return null;
        el.setAttribute('data-probe-target', '1');
        return true;
      }, { want: c.spoken });

      if (found) {
        record(vp.label, c.label, '🔑확정값', await measure(page, '[data-probe-target]', '[data-hero-state="review"]'));
      } else {
        rows.push(`${vp.label} | ${c.label} | 🔑확정값 | ⚪ 값 요소 못 찾음 (state=${dump.state})`);
      }
    });
  }
}

test.afterAll(() => {
  console.log('\n\n═══════ FB-6·FB-7 프로브 결과 ═══════');
  for (const r of rows) console.log(r);
  console.log('═══════════════════════════════════\n');
});
