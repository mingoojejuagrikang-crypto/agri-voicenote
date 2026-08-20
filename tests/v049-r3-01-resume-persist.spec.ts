/**
 * 🔴 v0.49 r3 #1 오라클 — **예약 복귀 착지도 행 완료 부기를 한다**(값 되돌림 크리티컬).
 *
 * A2가 커밋 종단에 「셀 검토 대기로 복귀」 착지를 추가했는데, 그 착지는 `advance()`를 타지 않고
 * `proceedAfterCommit`에서 return한다. 행 완료 부기(완료 마킹 · `correctionBackupRef` 해제 ·
 * `persistSession`)가 `advance()` 안에만 있었으므로 그 경로에서 통째로 빠졌다:
 *
 *   캐스케이드 정정이 세운 **정정 이전 스냅샷**(complete:true·syncState:'synced')이 해제되지 않고
 *   남는다 → 다음 `persistSession`이 `useVoiceSession.ts` :636에서 그 낡은 행을 rows에 push하고
 *   (completedRows에 없는 행이라 조건 성립), 그 push가 :639의 `!rows.some(...)` 때문에 **신선한
 *   buildRow(activeRow)를 밀어낸다.** → 수정값은 메모리에만 살고 IDB엔 옛값이 남는다.
 *
 * ⚠️ **A2 오라클(v049-r2-a2-cellwait-resume)이 왜 못 잡았나** — 그 스펙은 착지 상태(활성 칩 ·
 * 「기록값」 낭독 · bare 값 흡수)만 쟀고, 픽스처의 행이 **완료된 적이 없었다**(01만 채우고 「이전」).
 * 완료·영속 이력이 없으면 `correctionBackupRef`가 서지 않아 결함 자체가 성립하지 않는다.
 * 그래서 이 스펙은 ① **행을 끝까지 채워 완료·영속시키고** ② 칩/TTS가 아니라 **IDB 영속값 ·
 * 완료 카운트(X/N) · 리로드 생존**을 잰다 — 리뷰가 지적한 관측 공백이 정확히 그 셋이다.
 *
 * 반증(fix 제거 시): ①③은 IDB에 옛값(88.8 / 95.5)이 남아 red, ②는 `1 / 2`로 red.
 */

import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, ttsLog, waitForTtsIdle } from './fixtures/stt';

test.setTimeout(120_000);

const MINI_COLUMNS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'increase' },
  { id: 'm2', name: '측정항목02', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  { id: 'm3', name: '측정항목03', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];
const MINI_SETTINGS = {
  ...AZ_SETTINGS,
  state: { ...AZ_SETTINGS.state, columns: MINI_COLUMNS, totalRows: 2, sessionAutoLabel: 'r3-01' },
};
const MINI_HEADERS = ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02', '측정항목03'];
const MINI_ROWS = [
  [PREV_ROUND, '이원창', '1', '100.0', '', ''],
  [PREV_ROUND, '이원창', '2', '100.0', '', ''],
];

const chip = (page: Page, colName: string) =>
  page.locator(`[data-testid="column-chip"][data-col-name="${colName}"]`);

async function activeChipName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const c = document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
    return c?.dataset.colName ?? '';
  });
}

/** 영속된 세션의 한 행 — **IDB에서 직접** 읽는다(메모리 dataStore가 아니라 재시작 후 남을 것).
 *  버전 무지정 open은 이미 부팅된 앱 DB를 그 버전 그대로 여는 표준이다(tests/fixtures/idb.ts). */
async function persistedRow(page: Page, index: number) {
  return page.evaluate(async (rowIndex) => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const sessions: Array<{
      startedAt: number;
      rows: Array<{ index: number; complete: boolean; syncState?: string; values: Record<string, string> }>;
    }> = await new Promise((resolve, reject) => {
      const req = db.transaction('sessions', 'readonly').objectStore('sessions').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    // 이 픽스처는 세션을 하나만 만든다 — 그래도 최신 것을 고른다(재시작 후 잔재 방어).
    const latest = sessions.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0];
    return latest?.rows.find((r) => r.index === rowIndex) ?? null;
  }, index);
}

async function bootMini(page: Page) {
  await boot(page, PHONE_402, {
    settings: MINI_SETTINGS as unknown as typeof AZ_SETTINGS,
    headers: MINI_HEADERS,
    sheetRows: MINI_ROWS,
  });
}

/** 1행을 **끝까지** 채워 완료·영속시킨다(= `correctionBackupRef`가 설 수 있는 유일한 상태).
 *  m1의 95.5는 직전 회차 100.0 대비 감소라 이상치 알람이 끼지 않는다. */
async function completeRow1(page: Page) {
  await fireStt(page, '95.5', 900);
  await fireStt(page, '88.8', 900);
  await fireStt(page, '77.7', 1500);
  await waitForTtsIdle(page);
  await expect
    .poll(async () => (await persistedRow(page, 1))?.complete, { timeout: 8000 })
    .toBe(true);
  expect((await persistedRow(page, 1))?.values.m2, '전제: 1행이 옛값으로 영속됐다').toBe('88.8');
}

/** 완료된 1행으로 되돌아가 **그 행의 filled 셀**에 셀 검토 대기(cellWait)를 만든다. */
async function enterCellWaitOnRow1(page: Page, colName: string, steps: number) {
  await fireStt(page, '이전행', 1500); // 완료 행 착지 → 행 검토 대기(포인터=첫 음성 컬럼)
  await waitForTtsIdle(page);
  for (let i = 0; i < steps; i++) {
    await fireStt(page, '다음', 1200); // 항목 이동 — filled 셀이면 cellWait 착지
    await waitForTtsIdle(page);
  }
  expect(await activeChipName(page)).toContain(colName);
  expect((await ttsLog(page)).join(' | '), '착지 안내(기록값 낭독)가 나야 cellWait이다').toContain('기록값');
}

test('① 셀 검토 대기 출신 2단계 수정의 새 값이 **IDB에 남는다** — 낡은 정정 백업이 이기지 않는다', async ({ page }) => {
  await bootMini(page);
  await completeRow1(page);
  await enterCellWaitOnRow1(page, '측정항목02', 1);

  await fireStt(page, '수정', 1500);
  await waitForTtsIdle(page);
  await fireStt(page, '66.6', 1800);
  await waitForTtsIdle(page);

  // A2 계약(착지처)은 그대로여야 한다 — 이 스펙은 그 위에 내구성 축을 얹는다.
  await expect(chip(page, '측정항목02')).toContainText('66.6');
  expect(await activeChipName(page), '2단계 수정이 셀 검토 문맥을 파괴했다').toContain('측정항목02');

  // 🔴 여기가 크리티컬 축이다. 화면·TTS는 66.6인데 IDB는 88.8 — 리로드 한 번에 값이 되돌아간다.
  await expect
    .poll(async () => (await persistedRow(page, 1))?.values.m2, { timeout: 8000 })
    .toBe('66.6');
  const row1 = await persistedRow(page, 1);
  expect(row1?.complete, '재완료된 행은 complete:true로 영속된다').toBe(true);
  // 낡은 백업은 정정 **이전**의 syncState를 실어 나른다 — 그게 남으면 시트가 영영 안 고쳐진다.
  // (이 픽스처는 업로드를 하지 않아 값 자체는 undefined다. 단언의 대상은 "백업의 syncState가
  //  그대로 재사용되지 않는다"이며, 위 값·complete 단언과 함께 백업 push 자체를 배제한다.)
  expect(row1?.syncState, '정정된 행이 synced로 굳으면 시트 교정이 영구히 막힌다').not.toBe('synced');

  // 후속 persist가 또 낡은 백업을 push하지 않는지 — 백업이 실제로 **해제**됐는지의 증명.
  await fireStt(page, '다음행', 1500);
  await waitForTtsIdle(page);
  await fireStt(page, '11.1', 1500);
  await waitForTtsIdle(page);
  await expect
    .poll(async () => (await persistedRow(page, 1))?.values.m2,
      { timeout: 6000, message: '후속 persist가 낡은 백업을 되살렸다' })
    .toBe('66.6');

  // 리로드 생존 — 사용자가 실제로 겪는 형태(앱 재시작 후 옛값 복원)를 그대로 잰다.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await expect
    .poll(async () => (await persistedRow(page, 1))?.values.m2,
      { timeout: 6000, message: '리로드 후 옛값이 복원됐다' })
    .toBe('66.6');
});

/**
 * 🔴 ①b (v0.49 r4 M10 · codex r3 F9) — **직접 수정 경로의 착지·영속 계약**.
 *
 * codex F9는 세 번째 배선(`enterModifyMode`의 직접 `수정 <값>` 성공 경로의
 * `finalizeRowCompletion`)에 「제거 시 red」 오라클이 없다고 지적했고, 처방으로
 * *"완료 셀 cellWait → bare `수정` → 값 대신 `수정 66.6`"* 을 줬다.
 *
 * ⚠️ **그 처방은 도달하지 않는다(r4 M10 실측).** bare '수정' 뒤의 상태는 `kind:'modify'`이고,
 * `cmdModify`의 `isModifyLike` 분기(:117 · 2436 부근)가 «이미 수정 의미론이면 같은 셀 재질문»으로
 * **먼저 가로챈다** — 직접값은 그 자리에서 버려진다(실측: 칩이 `—` 그대로).
 * 더 좁히면 그 배선은 **모든 음성 도달 상태에서 no-op**이다:
 *   · 직접 수정의 타깃은 언제나 커서 **앞** 칸(`curIdx-1`)이거나 `cellWait`/센티넬이 가리키는
 *     **이미 값이 있는** 칸이다 → 그 쓰기가 행의 완성 여부를 바꾸지 못한다.
 *   · 정정 백업(`correctionBackupRef`)은 캐스케이드가 세우면서 `markRowIncomplete`도 함께 하므로,
 *     백업이 서 있는 동안 `finalizeRowCompletion`은 `isRowVoiceComplete` 가드에서 즉시 return한다.
 * 그래서 그 줄은 **방어적 배선**으로 유지하고(다음 착지가 추가될 때 열리는 형태다), 반증은
 * 소스 계약으로 잠근다(아래 [node] ①c). 대신 이 테스트는 그 경로가 실제로 하는 일 —
 * **직접값의 영속과 셀 검토 복귀** — 를 잰다(r3-01의 ①②③이 비워 둔 축이다).
 */
test('①b 셀 검토 대기의 **직접값** 수정도 IDB에 남고 셀 검토로 복귀한다', async ({ page }) => {
  await bootMini(page);
  await completeRow1(page);
  await enterCellWaitOnRow1(page, '측정항목02', 1);

  await fireStt(page, '수정 66.6', 1800); // 직접값 — advance/proceedAfterCommit 둘 다 우회
  await waitForTtsIdle(page);

  await expect(chip(page, '측정항목02')).toContainText('66.6');
  expect(await activeChipName(page), '직접값 수정이 셀 검토 문맥을 파괴했다').toContain('측정항목02');
  expect((await ttsLog(page)).join(' | '), '복귀 시 갱신값을 되읽는다').toContain('기록값');

  await expect
    .poll(async () => (await persistedRow(page, 1))?.values.m2, { timeout: 8000 })
    .toBe('66.6');
  expect((await persistedRow(page, 1))?.complete, '완료 행은 완료로 남는다').toBe(true);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  expect((await persistedRow(page, 1))?.values.m2, '리로드 후 옛값으로 되돌아갔다').toBe('66.6');
});

/**
 * 🔴 ①c (r4 M10 · codex r3 F9) — **행 완료 부기의 세 배선이 모두 살아 있다**(소스 계약).
 *
 * 위 ①b 헤더가 적었듯 세 번째 배선은 현재 모든 음성 도달 상태에서 no-op이라 브라우저 red를
 * 만들 수 없다. 그래도 지워지면 안 된다: `#1`의 근인이 「부기 소유자가 한 곳뿐이라 새 착지가
 * 추가될 때 조용히 빠진다」였고, 이 배선은 그 재발을 막는 방어선이다.
 * 소스 계약 테스트의 전례: `v049-prev-survey` W3-7·W3-10 · `v043-typo-contract`.
 */
test('[node] ①c 행 완료 부기 배선 6곳(advance 2 · 커밋 종단 · 직접 수정 우회 · 수동 커밋 · 보류 확인)이 모두 있다', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync('src/lib/useVoiceSession.ts', 'utf-8');
  // 🔴 v0.49 r7 — **주석을 먼저 걷어낸다.** 종전엔 원문에서 셌는데, 이 배선을 **설명하는 주석**이
  //   같은 식별자를 인용하면 개수가 조용히 늘어 계약이 «코드»가 아니라 «산문»을 세게 된다
  //   (r7 #6에서 실측으로 걸렸다 — 6곳인데 7로 셌다. fixr6 Z9 ③이 겪은 함정의 반대 방향).
  //   블록 주석 + 줄 시작이 `//`/`*`인 줄만 지운다(코드 중간의 문자열은 건드리지 않는다).
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  const calls = code.match(/finalizeRowCompletion\((?!row: number)/g) ?? [];
  // uvs-a(ENV-12 #2) — persistSession이 usePersistSession.ts로 분리됐다. 분리 전에는 이 파일
  // 전역이 이 개수 계약의 우발 커버 안이었으므로, 분리 파일의 호출도 합산해 커버를 유지한다
  // (R1 C-1 전례 — 부정 단언만 확장). 현재 분리 파일의 호출은 0이다 — 생기면 그것도
  // 「새 커밋 경로가 조용히 추가되는」 이 계약의 감시 대상이다.
  const persistCode = fs.readFileSync('src/lib/usePersistSession.ts', 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  const persistCalls = persistCode.match(/finalizeRowCompletion\((?!row: number)/g) ?? [];
  // uvs-b(ENV-12 #3·#4) — 내비 구획이 useRowNav.ts/useFieldNav.ts로 분리됐다. 같은 우발 커버를
  // 유지한다(R1 C-1 전례 — 부정 단언만 확장). 현재 두 파일의 호출은 0이다.
  // uvs-c(ENV-12 #5) — 추세/이상치 구획이 useTrendGate.ts로 분리되며 **여섯 번째 배선**
  // (`confirmManualAnomaly`의 보류 [확인] 부기)이 그 파일로 갔다. 합산 대상에 넣어 개수 6을
  // 유지한다(본체 5 + 훅 1). 주입 deps 선언(`finalizeRowCompletion: (row: number) => ...`)은
  // 프로퍼티 표기라 위 정규식에 걸리지 않는다.
  // uvs-d(ENV-12 #6) — 안내 구획이 useAnnouncements.ts로 분리됐다. 같은 우발 커버를 유지한다
  // (R1 C-1 전례 — 부정 단언만 확장). 현재 그 파일의 호출은 0이고, 개수 6은 불변이다.
  // r2-nearcap(ENV-12) — useRowNav의 착지 계열이 useRowLanding.ts로 갈렸다. 같은 우발 커버를
  // 유지한다(R1 C-1 전례 — 부정 단언만 확장). 현재 그 파일의 호출은 0이고, 개수 6은 불변이다.
  // uvs-e1(ENV-12 #7) — handleFinal의 **명령 경로**(블록 B+C)가 useFinalCommands.ts로 갈렸다.
  // 그 구획의 `finalizeRowCompletion` 호출은 분리 전에도 0이었으므로(실측) 개수 6은 불변이지만,
  // 종전 이 파일 전역이 갖던 우발 커버를 유지하기 위해 합산 대상에 넣는다(R1 C-1 전례).
  // ⚠️ 이 경로는 명령이 행을 옮기는 곳(end/nextRow/prevRow dispatch)이라 「새 커밋 경로가 조용히
  // 추가되는」 이 계약의 감시 대상으로 특히 값이 있다.
  const navCalls = ['src/lib/useRowNav.ts', 'src/lib/useRowLanding.ts', 'src/lib/useFieldNav.ts',
    'src/lib/useTrendGate.ts', 'src/lib/useAnnouncements.ts',
  // uvs-e2(ENV-12 #8) — handleFinal의 **값 게이트**(블록 D+E)가 useFinalValueGate.ts로 갈렸다.
  // 그 구획의 호출은 0이므로 개수 6은 불변이지만, 같은 우발 커버를 유지한다(R1 C-1 전례).
  // uvs-e3(ENV-12 #9) — handleFinal의 **값 커밋 종단**(블록 F)이 useValueCommit.ts로 갈렸다.
  // 🔴 이 계약이 감시하는 「커밋 종단」이 바로 그 파일이다(#1 근인의 무대). 현재 그 파일의
  // 호출은 0이고 개수 6은 불변이지만, 합산에서 빠지면 새 커밋 경로가 **가장 들어오기 쉬운 곳**이
  // 감시망 밖이 된다.
    'src/lib/useFinalCommands.ts', 'src/lib/useFinalValueGate.ts',
  // uvs-e4(ENV-12 #10) — handleFinal의 **착지**(블록 G+H)가 useCommitLanding.ts로 갈렸다.
  // 이것으로 handleFinal 4스테이지가 전부 분리됐고, 이 계약의 합산 목록이 그 넷을 모두 덮는다.
  // 현재 그 파일의 호출은 0이고 개수 6은 불변이다.
    'src/lib/useValueCommit.ts', 'src/lib/useCommitLanding.ts'].flatMap((p) => {
    const navCode = fs.readFileSync(p, 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    return navCode.match(/finalizeRowCompletion\((?!row: number)/g) ?? [];
  });
  // 선언부(`const finalizeRowCompletion = useCallback`)는 위 정규식에 안 걸린다.
  // 🔴 v0.49 r5 Z8 — **3 → 4.** 이 계약이 예언한 그대로 「새 커밋 경로가 추가될 때 조용히
  //   빠지는」 네 번째가 실재했다: `commitManualValue`의 **비-awaiting 분기**가
  //   *"진행 상태를 건드리지 않는다"*(v0.47.0 W1)를 지키며 **내구성 부기까지** 건너뛰었다.
  //   피해는 값 유실이다 — `persistSession`이 `completedRows`에 없는 행을 통째로 떨어뜨려
  //   키패드로 완성한 행이 IDB에서 사라졌다(실측). 오라클: v049-r5-z8-manual-complete.spec.ts.
  //   ⚠️ 숫자를 올릴 때는 **왜 늘었는지**를 여기 적어라 — 그게 이 계약의 값어치다.
  //   🔴 v0.49 r6 Y1 — **숫자는 그대로 4, 형태가 바뀌었다.** 부기가 `void persistSession()`으로
  //   durable 실패를 삼키던 것이 R5-F1(Critical)의 절반이었다. 이제 `finalizeRowCompletion`은
  //   `Promise<boolean>`을 돌려주고, 배선 넷 중 **셋**이 그 결과를 받아 실패면 고지하고 멈춘다.
  //   나머지 하나(직접 수정 우회)만 `void`인데, 그 자리는 현재 모든 음성 도달 상태에서 no-op이라
  //   고지할 실패가 없다(그 콜사이트 주석). 그래서 이 계약은 **개수 + 실패를 받는가**를 함께 잰다 —
  //   `void`로 되돌아가면 「성공 고지 뒤 값 유실」이 조용히 재개방되기 때문이다.
  //   🔴 v0.49 r6 Y3 — **4 → 5.** 다섯 번째는 `advance()`의 **종료 가드**다: 종료 중에는 국면
  //   전이·낭독·전진을 하지 않되 부기는 남겨야 한다(건너뛰면 커밋된 값이 완료 마킹 없이
  //   `stop()`의 persist에 `complete:false`로 굳어 sync가 영영 안 올린다). 그 자리는 실패를
  //   고지할 표면이 없어(StoppingState) `void`다 — durable 실패는 `stop()`의 `persistError`가 받는다.
  //   🔴 v0.49 r7 #6 — **5 → 6.** 여섯 번째는 `confirmManualAnomaly`(수동 이상치 보류 [확인])다.
  //   그 종단은 `proceedAfterCommit(awaiting)`에 부기를 **위임**하고 있었는데, `awaiting`이 보류한
  //   셀과 어긋나면 부기가 **남의 행에** 걸린다 — 보류한 행은 completedRows에 못 들어가고 다음
  //   persist가 통째로 떨어뜨린다(Z8이 닫은 값 유실의 재개방). 그래서 부기를 위임하지 않고
  //   **보류된 셀의 행(`pendingValidation.row`)에 직접** 건다. 이 계약이 또 한 번 예언한
  //   「새 커밋 경로가 부기를 조용히 빠뜨린다」의 여섯 번째다.
  //   오라클: v049-r7-06-hold-confirm-owner.spec.ts
  expect(calls.length + persistCalls.length + navCalls.length, '배선이 6곳이 아니다 — 어느 커밋 경로가 빠졌는지 확인해라(#1 근인)').toBe(6);
  // uvs-c(ENV-12 #5) — 이 한 줄만 useTrendGate.ts로 갔다(나머지 배선 다섯은 본체 잔류). 소스만 재표적.
  const gateCode = fs.readFileSync('src/lib/useTrendGate.ts', 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  expect(gateCode, '수동 보류 [확인]의 부기(r7 #6 — 좌표는 보류된 셀의 행이다)')
    .toContain('if (pv && !(await finalizeRowCompletion(pv.row))) {');
  expect(code, 'advance() 종료 가드의 부기(Y3)').toContain('if (isRowVoiceComplete(row, vc)) void finalizeRowCompletion(row);');
  expect(code, 'advance()의 행 완료 부기(durable 결과 수신)').toContain('if (!(await finalizeRowCompletion(row))) {');
  expect(code, '커밋 종단(proceedAfterCommit) 진입점 부기(durable 결과 수신)')
    .toContain('if (awaiting && !(await finalizeRowCompletion(awaiting.row))) {');
  expect(code, '직접 수정 우회 배선(F9 — no-op 방어선이라 void)').toContain('void finalizeRowCompletion(targetRow);');
  // 수동(키패드) 커밋 — 소유권 분기 **앞**이어야 한다(비-awaiting 분기도 지나가야 하므로).
  const manual = code.slice(code.indexOf('const commitManualValue = useCallback('));
  expect(
    manual.slice(0, manual.indexOf("playBeep('commit')")),
    '수동 커밋 부기가 소유권 분기 앞에 없다 — 비-awaiting 커밋이 행을 완성하면 그 행이 사라진다',
  ).toContain('if (!(await finalizeRowCompletion(row))) {');
  // Y1 — 부기 자체가 durable 결과를 돌려주는 형태인가(선언부 계약).
  expect(
    src,
    '행 완료 부기가 durable 결과를 반환하지 않는다 — 호출부가 실패를 받을 방법이 사라진다(R5-F1)',
  ).toContain('const finalizeRowCompletion = useCallback(async (row: number): Promise<boolean> => {');
});

test('② 정정된 행은 완료 카운트(X / N)에 그대로 남는다 — markRowComplete 누락', async ({ page }) => {
  await bootMini(page);
  await completeRow1(page);
  await enterCellWaitOnRow1(page, '측정항목02', 1);

  await fireStt(page, '수정', 1500);
  await waitForTtsIdle(page);
  await fireStt(page, '66.6', 1800);
  await waitForTtsIdle(page);

  // 2행까지 채워 조사 완료 화면으로 — X는 sessionStore.completedRows.length다(메모리 축).
  await fireStt(page, '다음행', 1500);
  await waitForTtsIdle(page);
  await fireStt(page, '11.1', 900);
  await fireStt(page, '22.2', 900);
  await fireStt(page, '33.3', 1800);
  await waitForTtsIdle(page);

  await expect(page.locator('[data-testid="complete-summary"]')).toBeVisible({ timeout: 8000 });
  // 🔴 정정 시 markRowIncomplete만 돌고 재완료 마킹이 없으면 여기가 `1 / 2`로 굳는다.
  await expect(page.locator('[data-testid="complete-count"]'), '정정한 행이 완료 수에서 빠졌다')
    .toHaveText('2 / 2');
});

test('③ 알람 경유(재기록 값이 이상치 → 「확인」)도 새 값이 IDB에 남는다', async ({ page }) => {
  await bootMini(page);
  await completeRow1(page);
  // 추세 규칙이 걸린 m1에 **셀** 검토 대기로 착지한다. 행 검토 대기의 포인터가 이미 m1이지만
  // 거기서 바로 「수정」하면 **행 스코프 캐스케이드**(행 전체 재기록)라 다른 계약이다 — 그리고
  // 그 상태에서는 낡은 백업이 IDB를 지키는 것이 **정상**이다(재완료 전까지의 크래시 안전망).
  // 셀 스코프로 들어가려면 항목 이동으로 한 번 나갔다 돌아온다(경계 분기는 reviewWait 스코프를
  // 그대로 두므로 — gotoAdjacentField:1963 — 「다음」 후 「이전」이 유일한 진입로다).
  await enterCellWaitOnRow1(page, '측정항목02', 1);
  await fireStt(page, '이전', 1200);
  await waitForTtsIdle(page);
  expect(await activeChipName(page)).toContain('측정항목01');

  await fireStt(page, '수정', 1500);
  await waitForTtsIdle(page);
  // 직전 회차 100.0 대비 증가 → 이상치 알람. 「확인」이 값을 확정하고 셀 검토로 복귀한다.
  await fireStt(page, '120.5', 1800);
  await expect(page.locator('[data-testid="anomaly-alert"]')).toBeVisible({ timeout: 6000 });
  await waitForTtsIdle(page);
  await fireStt(page, '확인', 1800);
  await waitForTtsIdle(page);

  await expect(chip(page, '측정항목01')).toContainText('120.5');
  await expect
    .poll(async () => (await persistedRow(page, 1))?.values.m1, { timeout: 8000 })
    .toBe('120.5');
  await expect
    .poll(async () => (await persistedRow(page, 1))?.complete,
      { timeout: 6000, message: '재완료된 행은 complete:true로 영속된다' })
    .toBe(true);
});
