/**
 * 항목명 TTS 괄호 제거 — **콜사이트 배선 e2e 오라클**(`tts-column-name.spec.ts`의 짝).
 *
 * ## 왜 이 파일이 따로 있나 — 단위 오라클이 못 재는 축이 정확히 하나 있다
 * `tts-column-name.spec.ts` 18건은 **순수 함수 `formatNameForTts`만** 잰다. 그런데 이 변경의
 * 실질은 **콜사이트 13지점을 그 함수에 통과시키는 배선**이고, 단위 오라클은 그 배선을 한 줄도
 * 보지 않는다. 빌더가 §4-1에서 *"가장 얇은 자리"* 로 자기신고한 구멍이 여기다:
 *
 * > 🔴 **지금 콜사이트 하나를 원문 보간으로 되돌려도 기존 오라클 18건은 전부 green이다.**
 * >   (2026-09-02 콜드 리뷰 §5 실측)
 *
 * 빌더는 *"e2e로 잡으려면 픽스처를 새로 깔아야 한다"* 고 적었는데 **그렇지 않았다** —
 * `fixtures/activeZones.ts`의 `boot()`가 `settings.state.columns`를 통째로 받으므로
 * **컬럼명 두 줄만** 실 프로덕션 시트와 같게 바꾸면 끝난다(리뷰어가 프로브로 실증, 26초).
 * 이 파일은 그 프로브(`deliverables/2026-09-02-tts-paren-probe.spec.ts` P-1·P-2·P-4)의 승격본이다.
 *
 * ## 🔑 픽스처가 실 시트와 같아야 하는 이유
 * 기존 스펙의 픽스처 컬럼명은 **전부 괄호가 없다**(`횡경`·`측정항목01` …). 그래서 이 변경은
 * 기존 스펙 전 경로에서 **바이트 무연산**이고, 그 스펙들이 아무리 green이어도 배선을 증명하지
 * 못한다. 실 프로덕션 시트(2026-09-01 device inbox 6세션 전수)의 음성 컬럼은
 * `횡경(mm)`·`종경(mm)` **둘뿐**이고, 여기서는 그 이름을 그대로 쓴다.
 *
 * ## 반증 축(무엇을 빼면 red인가) — **둘 다 실행해서 red를 봤다**(2026-09-02, 기본 config)
 *  ① `formatNameForTts` 본문을 `return name;`으로 무력화
 *     → 신규 3건 중 **ⓐ·ⓑ red**(단위 18건 중 13건도 함께 red · 합계 15 failed / 6 passed).
 *     ⓒ는 그 무력화로 **green이 맞다** — 화면은 원래 원문을 그린다(귀만 축약).
 *     ⓒ가 red가 되는 것은 누가 **화면 표면에까지** 변환을 걸었을 때다(그건 다른 결함이다).
 *  ② 🔴 **콜사이트 한 곳만**(`useRowLanding:159`) 원문 보간으로 되돌리기
 *     → **단위 오라클 18건은 전부 green**, 신규 ⓐ·ⓑ만 red (2 failed / 19 passed).
 *     👉 **이것이 이 파일의 존재 이유 그 자체다.** 리뷰가 지목한 구멍(*"콜사이트 하나를
 *        되돌려도 기존 오라클은 전부 green"*)이 실제로 닫혔음을 같은 실험이 증명한다.
 *
 * ## 릴리스 게이트
 * `package.json`의 `test:e2e:gate`에 `tests/tts-column-name.spec.ts`와 이 파일이 함께
 * 등재돼 있다. 🔴 **그 편집은 `fix/axis-a-muted-span` 브랜치에서 한 번만** 했다 —
 * 양쪽 브랜치가 같은 한 줄을 고치면 병합 충돌이 나기 때문이다. 그래서 **이 브랜치가 먼저
 * 병합되면 그 사이엔 게이트에 이 스펙이 없다**(Playwright의 파일 인자는 필터라 반대 순서도
 * 안 깨진다). 두 브랜치가 다 들어간 뒤 `node -e "…test:e2e:gate…"`로 한 번 확인해라.
 *
 * ## 🔴 안 재는 것 — 정직하게 적는다
 *  · **알람 동반 경로**(`useTrendGate`·`useCommitLanding`) — 콜사이트는 코드로 확인됐지만
 *    이 스펙이 알람 국면까지 밟지는 않는다. 여기가 덮는 것은 진입·값에코·행완료·행전환·
 *    검토착지·재청취 6국면이다.
 *  · **실기기 발음** — `speechSynthesis`가 「횡경」을 실제로 어떻게 읽는지는 데스크톱
 *    Chromium 스텁으로 못 잰다(AGENTS.md 계약 ④).
 *  · **「수정 <컬럼명>」 캐스케이드** — 리뷰 [P1-2 TTS]가 지목한 선행 결함(지목 실패 →
 *    두 셀 소거)은 이 변경과 무관하고 **민구 결정 대기**다. 깨진 동작을 기대값으로 박으면
 *    처방이 들어오는 순간 오탐이 되므로 **여기 넣지 않는다**(리뷰어 프로브의 P-3 제외).
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, ttsLog, waitForTtsIdle } from './fixtures/stt';

test.setTimeout(120_000);

/** 실 시트(2026-09-01 device inbox 6건 전수)와 같은 이름 — 음성 컬럼 둘 다 괄호를 단다. */
const PAREN_COLUMNS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'm1', name: '횡경(mm)', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  { id: 'm2', name: '종경(mm)', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];
const PAREN_SETTINGS = {
  ...AZ_SETTINGS,
  state: { ...AZ_SETTINGS.state, columns: PAREN_COLUMNS, totalRows: 2, sessionAutoLabel: 'tts-paren' },
};
const HEADERS = ['조사일자', '농가명', '조사나무', '횡경(mm)', '종경(mm)'];
const ROWS = [
  [PREV_ROUND, '이원창', '1', '100.0', '5.0'],
  [PREV_ROUND, '이원창', '2', '100.0', '5.0'],
];

const bootParen = (page: Page) => boot(page, PHONE_402, {
  settings: PAREN_SETTINGS as unknown as typeof AZ_SETTINGS,
  headers: HEADERS,
  sheetRows: ROWS,
});

/** 어떤 표기로든 괄호 단위가 귀로 나갔는가(반각·전각 둘 다). */
const LEAK = /\(\s*mm\s*\)|（\s*mm\s*）/;

test('ⓐ 발화 전량에 괄호가 새지 않는다 — 진입·값에코·행완료·행전환·검토착지·재청취 6국면', async ({ page }) => {
  await bootParen(page);
  // 1행 완주 → 행 완료 낭독 + 2행 전환 낭독 + 2행 첫 항목 안내.
  await fireStt(page, '11.1', 900);
  await fireStt(page, '22.2', 1800);
  await waitForTtsIdle(page);
  // '이전행' → 완료 행 착지(enterReviewWait) = 값 낭독.
  await fireStt(page, '이전행', 1800);
  await waitForTtsIdle(page);
  // 검토 대기에서 bare '취소' → relistenPrompt / cellWaitPrompt 계열 문구.
  await fireStt(page, '취소', 1500);
  await waitForTtsIdle(page);

  const log = await ttsLog(page);
  const leaked = log.filter((t) => LEAK.test(t));
  expect(leaked, `괄호가 귀로 샜다 — 콜사이트 하나가 원문 보간으로 돌아갔다: ${JSON.stringify(leaked)}`)
    .toEqual([]);
  // 🔴 **과잉 통과 방지.** 로그가 비어도 위 단언은 green이다 — 축약본이 실제로 발화됐는지
  //    확인해야 이 스펙이 공허하지 않다.
  expect(log.some((t) => /횡경/.test(t)), '전제: 항목명이 발화된 로그가 있다').toBe(true);
  expect(log.some((t) => /종경/.test(t)), '전제: 두 번째 항목명도 발화됐다').toBe(true);
});

test('ⓑ 완료 행 검토 낭독이 축약본을 쓴다 — `useRowLanding` 콜사이트를 문장 단위로 고정', async ({ page }) => {
  // 🔴 ⓐ는 「괄호가 없다」만 잰다. 이 케이스는 **문장 전체를 바이트로** 고정한다 —
  //    누가 축약을 다른 자리(예: 값 포맷)로 옮겨도 이 문장이 먼저 red가 된다.
  await bootParen(page);
  await fireStt(page, '11.1', 900);
  await fireStt(page, '22.2', 1800);
  await waitForTtsIdle(page);
  await fireStt(page, '이전행', 1800);
  await waitForTtsIdle(page);

  const review = (await ttsLog(page)).filter((t) => t.startsWith('1행 완료됨'));
  expect(review.length, '전제: 검토 진입 낭독이 있다').toBeGreaterThan(0);
  expect(review[0], '검토 낭독이 원문을 읽는다 — 사용자가 들은 이름과 화면 이름이 갈린다')
    .toBe('1행 완료됨. 횡경 11.1, 종경 22.2.');
});

test('ⓒ 화면 표면은 원문을 그대로 그린다 — 축약본이 눈으로 새지 않는다', async ({ page }) => {
  // 🔑 **귀는 축약, 눈은 원문**이 이 변경의 계약이다. 화면까지 축약하면 사용자가
  //    시트의 컬럼(단위 포함)과 화면을 대조할 수 없다. `Column.name` 원본은 SSOT다.
  await bootParen(page);
  const chip = await page.evaluate(() => {
    const els = [...document.querySelectorAll('[data-testid="column-chip"]')] as HTMLElement[];
    return els.map((e) => e.dataset.colName ?? e.innerText.trim());
  });
  expect(chip.join(' | '), '화면 칩이 원문 괄호를 잃었다 — 축약이 화면 표면까지 샜다').toContain('횡경(mm)');
  expect(chip.join(' | ')).toContain('종경(mm)');
});
