/**
 * v0.49 r5 Z2 오라클 — **착지는 종료·일시정지를 이기지 못한다** (codex R4-F2 · claude #2 · #14).
 *
 * 배경: fixr4의 M8이 착지 두 곳(`announceField`·`enterCellWait`)에 **무조건** `setPhase('active')`를
 * 넣어 「값을 여는 착지는 phase를 함께 연다」를 닫았다. 그 무조건성이 새 구멍을 열었다 — 이전에는
 * 잠겨 있던 두 국면을 **뒤늦은 continuation**이 덮는다:
 *
 *   ① `stopping` — `stop()`은 첫 await 전에 phase를 잠그고 `cancelTts()`로 앞선 안내를 끊는다.
 *      그 cancel이 대기 중이던 `await say(...)`를 결말지으면 **낡은 행 이동 continuation이 재개**되고,
 *      그 안의 착지가 phase를 다시 연다. v0.35의 「종료 teardown 전체를 단일 비대화형 phase로
 *      잠근다」 상호배타 계약이 거기서 깨진다.
 *      🔴 **epoch 재확인으로는 못 닫는다** — `stop()`은 epoch를 올리지 않는다. 이 스펙 ①이
 *      그 사실을 함께 고정한다(경계 핸들러의 epoch 가드가 살아 있어도 ①은 red가 된다).
 *   ② `paused` — 일시정지 중에도 자동입력 칩 편집으로 행 이동이 열려 있다. 그 착지가 phase를
 *      'active'로 쓰면 **사용자가 풀지 않은 일시정지가 조용히 풀린다**(해제는 `resume()`만의 소관).
 *
 * 처방은 개별 가드가 아니라 **소유자 단일화**다(`armLanding`) — 착지 리셋 4종(알람 해제·거절 큐·
 * 수정 표식·phase)이 한 곳에 모이고, 그 한 곳이 두 국면을 존중한다. ③이 그 구조를 고정한다:
 * 사본이 다시 생기면 red다 = 이번 라운드 회귀 3건(M4·M8 두 건)의 **형태 자체**가 재발 불가능해진다.
 *
 * 🔴 **①의 자물쇠는 둘이고, 반증 사다리로 그 순서를 실측했다**(08-14 KST, 포트 5197):
 *   · 둘 다 있음        → 종료 뒤 착지 없음. TTS 마지막은 `입력을 종료합니다.`
 *   · 경계 epoch 가드만 제거 → 여전히 착지 없음. 대신 `landing_refused:stopping:review_wait`가
 *                          찍힌다 = **`armLanding`의 거절이 실제로 발동한 증거**.
 *   · 둘 다 제거        → `review_wait:row=1,col=first`가 **`stop` 뒤에** 찍히고, TTS에서
 *                          `입력을 종료합니다.`가 **사라진다**(착지 안내가 종료 안내를 밀어냈다).
 *                          그게 R4-F2의 실제 피해다.
 * 그래서 ①은 「피해 부재」를 재고(두 자물쇠 중 하나라도 살아 있으면 green), 각 자물쇠의 존재는
 * ③·④의 소스 계약이 따로 잠근다. 하나만 잰다고 주장하지 않는다.
 *
 * ⚠️ **전제 정정(실측)**: 리뷰는 *"`stop()`은 epoch를 올리지 않는다"* 를 근거로 이 경로를 열린
 * 것으로 봤는데, 음성 명령은 `handleFinal`이 **모든 명령에서** epoch를 올린다(:2665). 그래서
 * 현행 UI에서 이 창을 여는 것은 경계 핸들러의 재확인 누락 쪽이었다. `armLanding`의 거절은
 * 그 위에 얹는 **구조적 backstop**이다 — 다음 착지가 epoch 규율 없이 생겨도 국면은 지켜진다.
 *
 * 반증(가드 제거 시): ① red(위 사다리 3단) · ② red(일시정지 카드가 사라진다) · ③④ red(사본·누락
 * 검출). ②-b는 **과잉 거절 반증**이다 — 가드가 문맥 재무장까지 막으면 red.
 */

import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, ttsLog, waitForTtsIdle } from './fixtures/stt';

test.setTimeout(120_000);

function columns(seqTo: number) {
  return [
    { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
    { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
    { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: seqTo }, sampleKey: true },
    { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  ];
}
const HEADERS = ['조사일자', '농가명', '조사나무', '측정항목01'];
const SHEET_ROWS = [[PREV_ROUND, '이원창', '1', '100.0']];

async function bootRows(page: Page, rows: number) {
  await boot(page, PHONE_402, {
    settings: {
      ...AZ_SETTINGS,
      state: { ...AZ_SETTINGS.state, columns: columns(rows), totalRows: rows, sessionAutoLabel: 'r5-z2' },
    } as unknown as typeof AZ_SETTINGS,
    headers: HEADERS,
    sheetRows: SHEET_ROWS,
  });
  await waitForTtsIdle(page);
}

/** IDB `logEvents`의 `extra` 전량 — **순서 보존**(이 스펙은 「stop 뒤에 무엇이 왔는가」를 잰다). */
async function logExtras(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
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
}

// ── ① stopping — 종료 중 경계 안내 continuation ────────────────────────────────
test('① 종료 중 행 경계 안내의 낡은 continuation이 착지를 다시 열지 않는다 (R4-F2)', async ({ page }) => {
  await bootRows(page, 1);

  // 1행(=마지막 행)을 완주시켜 끝 도달로 보낸다.
  await fireStt(page, '삼십오 점 일', 1500);
  await waitForTtsIdle(page);

  // 🔴 안내가 **실제로 재생되는 동안** 종료해야 창이 열린다. 기본 mock onend(200ms)로는
  //   "마지막 행입니다."가 interrupt 갭 안에서 삼켜져(`tts_silent`) 경쟁 자체가 안 생긴다 —
  //   실기기 발화는 수백ms~수초다. 그 축약을 여기서 되돌린다([TEST-TTS-MOCK-1] 규율).
  await page.evaluate(() => { (window as unknown as { __ttsOnendDelayMs?: number }).__ttsOnendDelayMs = 1200; });

  // '다음행' → 마지막 행 경계 → "마지막 행입니다." 안내 시작. **그 안내가 흐르는 동안** 종료한다.
  //   `stop()`은 첫 await 전에 phase를 'stopping'으로 잠그고 그 다음 `cancelTts()`로 이 안내를
  //   끊는다 → 대기 중이던 promise가 결말나고 낡은 `goNextRow` continuation이
  //   `enterReviewWait`으로 들어간다(리뷰가 지목한 그 경로).
  await fireStt(page, '다음행', 80);
  await fireStt(page, '종료', 0);
  await waitForTtsIdle(page);
  await page.waitForTimeout(900); // stop()의 flush·dispose·persist까지 흘려보낸다

  const extras = await logExtras(page);
  const stopAt = extras.lastIndexOf('stop');
  const boundaryAt = extras.findIndex((e) => e.startsWith('row_last_stop'));
  // 전제 3종 — 하나라도 깨지면 아래 단언은 공허하다(경쟁이 아예 안 일어난 것).
  expect(boundaryAt, '전제: 마지막 행 경계를 실제로 밟았다').toBeGreaterThanOrEqual(0);
  expect(stopAt, '전제: 종료가 실제로 실행됐다').toBeGreaterThan(boundaryAt);
  expect(await ttsLog(page), '전제: 경계 안내가 실제로 발화됐다(삼켜지지 않았다)').toContain('마지막 행입니다.');

  expect(
    extras.slice(stopAt).filter((e) => e.startsWith('review_wait:')),
    '종료 teardown 중에 검토 대기 착지가 열렸다 — v0.35 상호배타 계약 위반(R4-F2)',
  ).toEqual([]);
  // 피해의 다른 얼굴: 착지 안내가 종료 안내를 밀어낸다(반증 실측에서 이 문구가 통째로 사라졌다).
  expect(
    (await ttsLog(page)).at(-1),
    '종료 안내가 낡은 착지 안내에 밀렸다 — 사용자는 세션이 끝났는지 알 수 없다',
  ).toBe('입력을 종료합니다.');
});

// ── ② paused — 일시정지 중 행 이동 ──────────────────────────────────────────────
/** 자동입력 칩(조사나무)을 인라인 편집해 다른 행으로 점프한다 — 일시정지 중에도 열려 있는 경로
 *  (`ActiveState`의 auto 칩 onCommit → `computeRowFromAutoChange` → `jumpToRow`). */
async function jumpViaAutoChip(page: Page, value: string) {
  const chip = page.locator('[data-testid="column-chip"][data-col-name="조사나무"]');
  await chip.click();
  const input = chip.locator('input');
  await expect(input, '전제: 자동입력 칩이 인라인 편집으로 열린다').toBeVisible({ timeout: 4000 });
  await input.fill(value);
  await input.press('Enter');
  await waitForTtsIdle(page);
}

test('② 일시정지 중 행 이동이 일시정지를 조용히 풀지 않는다 (claude #2)', async ({ page }) => {
  await bootRows(page, 2);
  const pausedCard = page.locator('[data-testid="paused-card"]');

  await fireStt(page, '일시 정지', 1200);
  await waitForTtsIdle(page);
  await expect(pausedCard, '전제: 일시정지에 들어갔다').toBeVisible({ timeout: 4000 });

  await jumpViaAutoChip(page, '2');

  await expect(
    pausedCard,
    '일시정지 중 행 이동의 착지가 phase를 active로 써서 사용자가 풀지 않은 일시정지가 풀렸다',
  ).toBeVisible({ timeout: 4000 });
  const extras = await logExtras(page);
  expect(
    extras.some((e) => e.startsWith('landing_phase_held:paused:')),
    '국면 전이를 보류한 흔적이 없다 — 착지 자체가 안 왔다면 이 오라클은 공허하다',
  ).toBe(true);
});

test('②-b 과잉 거절 반증 — 보류는 국면 전이만이다. 문맥은 재무장되고 재시작이 그것을 받는다', async ({ page }) => {
  await bootRows(page, 2);

  await fireStt(page, '일시 정지', 1200);
  await waitForTtsIdle(page);
  await jumpViaAutoChip(page, '2');

  // 🔴 착지 **전체**를 거절하면 `awaiting`이 null인 채 남고, `resume`의 폴스루가
  //   `announceField(cur)`로 떨어져 값 있는 셀에 `kind:'value'`가 다시 열린다(_ASK-fix49 Q5의
  //   선행 파손을 새 경로로 재개방). 그래서 `paused`에서는 국면 전이만 보류한다.
  await fireStt(page, '재시작', 2000);
  await waitForTtsIdle(page);
  await expect(page.locator('[data-testid="paused-card"]')).toHaveCount(0);

  await fireStt(page, '사십이 점 삼', 1800);
  await waitForTtsIdle(page);
  // 🔴 칩이 아니라 TTS를 잰다 — 2행이 완성되면 `advance`가 예약(1행)으로 되돌아가므로, 잠시 뒤
  //   화면 칩은 이미 **1행**의 값을 그린다. 「값이 어느 행에 들어갔나」의 증거는 완료 낭독이다.
  const log = await ttsLog(page);
  expect(log, '전제: 재개 후 이동한 행에서 안내가 있었다').toContain('측정항목01.');
  expect(
    log,
    '재개 후 값이 이동한 행(2행)에 들어가지 않았다 — 보류가 국면뿐 아니라 문맥까지 버렸다',
  ).toContain('조사나무 2 완료.');
});

// ── ③ 구조 — 착지 리셋의 소유자는 하나다 ────────────────────────────────────────
test('[node] ③ 착지 리셋 4종은 armLanding 한 곳이 소유한다 — 사본이 다시 생기면 red', async () => {
  const fs = await import('node:fs');
  // uvs-b(ENV-12 #3) — 착지 셋(enterCellWait·enterReviewWait·announceEndReached)이 useRowNav.ts로
  // 분리됐다. 착지별로 읽는 소스만 갈린다 — 마커·계약 바이트는 이동 전과 동일하다(ref 주입이
  // 형태를 보존).
  // uvs-d(ENV-12 #6) — 남은 둘(소유자 `armLanding`과 `announceField`)도 useAnnouncements.ts로
  // 갔다. 형제 순서(armLanding → announceField)가 보존돼 armLanding 본문 종료 마커
  // (`const announceField = useCallback(`)도 그대로다 — 소스 경로만 재표적한다.
  // r2-nearcap(ENV-12) — 착지 셋이 useRowNav.ts 안에서 다시 useRowLanding.ts로 갈렸다(착지 계열
  // 대 행 이동). ④의 gotoAdjacentRow·goNextRow는 **useRowNav.ts 잔류**라 그쪽 `src`는 안 바뀐다 —
  // 한 파일에 소스 상수가 둘이니 경로를 일괄 치환하지 마라. 마커·계약 바이트는 이동 전과 동일하다.
  const src = fs.readFileSync('src/lib/useAnnouncements.ts', 'utf-8');
  const navSrc = fs.readFileSync('src/lib/useRowLanding.ts', 'utf-8');

  /** `const <name> = useCallback(` 부터 다음 착지/함수 경계까지 — 주석 줄은 제거한다
   *  (근거 주석이 옛 코드를 인용하므로, 주석을 보면 이 계약은 영영 red다). */
  function body(name: string, until: string, source = src): string {
    const from = source.indexOf(`const ${name} = useCallback(`);
    expect(from, `${name}을 찾지 못했다 — 이름이 바뀌었으면 이 계약도 함께 갱신하라`).toBeGreaterThan(0);
    const slice = source.slice(from, from + source.slice(from).indexOf(until));
    return slice.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  }

  const landings: Array<[string, string, string, string?]> = [
    // [함수, 본문 종료 마커, 기대 phase, 소스(기본=본체)]
    ['announceField', 'armClipForCell(row, col.id)', "phase: 'active'"],
    ['enterCellWait', 'awaitingFieldRef.current = {', "phase: 'active'", navSrc],
    ['enterReviewWait', 'awaitingFieldRef.current = firstCol', "phase: 'complete'", navSrc],
    ['announceEndReached', 'awaitingFieldRef.current = lastCol', "phase: 'complete'", navSrc],
  ];

  for (const [name, marker, wantPhase, source] of landings) {
    const b = body(name, marker, source);
    expect(b, `${name}: 착지 리셋을 armLanding에 맡기지 않는다`).toContain('armLanding({');
    expect(b, `${name}: armLanding 거절(종료 중)에서 즉시 return하지 않는다 — awaiting·클립·TTS가 샌다`)
      .toContain(')) return;');
    expect(b, `${name}: 착지 국면이 계약과 다르다`).toContain(wantPhase);
    // 🔴 사본 금지 — 이 넷이 다시 손으로 리셋을 적으면 M4·M8이 같은 형태로 재발한다.
    for (const copy of ['setPhase(', 'setEndReached(', 'setModifyIndicator(', 'setReaskReason(', 'clearAnomalyAlert(']) {
      expect(b, `${name}: 착지 리셋 사본이 다시 생겼다(${copy}) — 소유자는 armLanding이다`).not.toContain(copy);
    }
  }

  // 소유자 쪽 계약: 두 국면을 실제로 존중한다.
  const arm = body('armLanding', 'const announceField = useCallback(');
  expect(arm, 'armLanding이 종료(stopping)에서 착지를 거절하지 않는다').toContain("sess.phase === 'stopping'");
  expect(arm, 'armLanding이 일시정지(paused)에서 국면 전이를 보류하지 않는다').toContain("sess.phase === 'paused'");
  // phase → endReached 순서(sessionStore 계약: setPhase가 'complete' 이탈 시 endReached를 함께 내린다).
  expect(
    arm.indexOf('setPhase(opts.phase)'),
    'endReached를 phase보다 먼저 쓰면 setPhase가 그것을 도로 지운다',
  ).toBeLessThan(arm.indexOf('setEndReached(opts.endReached)'));
});

// ── ④ 행 경계 두 곳의 epoch 재확인(fix49b #6 패턴 복제) ──────────────────────────
test('[node] ④ 행 경계 재무장 두 곳이 안내 뒤 epoch를 재확인한다', async () => {
  const fs = await import('node:fs');
  // uvs-b(ENV-12 #3) — gotoAdjacentRow·goNextRow가 useRowNav.ts로 분리됐다. 소스만 재표적.
  const src = fs.readFileSync('src/lib/useRowNav.ts', 'utf-8');

  for (const [name, marker] of [
    ['gotoAdjacentRow', "await say(msg);"],
    ['goNextRow', "await say(msg);"],
  ] as const) {
    const from = src.indexOf(`const ${name} = useCallback(`);
    const b = src.slice(from, from + src.slice(from).indexOf('}, ['));
    const sayAt = b.indexOf(marker);
    expect(sayAt, `${name}: 경계 안내를 찾지 못했다`).toBeGreaterThan(0);
    expect(
      b.slice(0, sayAt),
      `${name}: bump 직후 startEpoch를 잡지 않는다(재확인의 기준점이 없다)`,
    ).toContain('const startEpoch = epochRef.current;');
    expect(
      b.slice(sayAt).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'),
      `${name}: 경계 안내 뒤 재무장 전에 epoch를 재확인하지 않는다(fix49b #6과 같은 누락)`,
    ).toContain('if (epochRef.current !== startEpoch) return;');
  }
});
