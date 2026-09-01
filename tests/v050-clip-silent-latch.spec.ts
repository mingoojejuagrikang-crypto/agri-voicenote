/**
 * v0.50 [CLIP-SILENT-1] 오라클 — **무음 클립 연속 실패 → 래치·고지·결산**.
 *
 * ## 무엇을 재나
 * 2026-08-19 실기기 사고의 형상은 **「트랙은 살아 있는데(`readyState==='live'`) 클립만 계속
 * 비어 나온다」**였다. 종전 판정(`isStreamLost()` = `ended`만 사망)은 그 상태를 **영원히 no-op**
 * 으로 흘려보냈다 — 이원창 세션에서 60번, 양혁진 세션에서 9번.
 *
 * 🔑 **재현 방법**: `fixtures/mediaRecorder.ts` 스텁의 `window.__clipSilentMode`를 켜면
 * 트랙은 `readyState:'live'`인 채 레코더만 빈 조각을 낸다 — **사고와 정확히 같은 축**이다.
 *   · `'tiny'` → 5바이트(`clip_too_small:5` — 이원창 60/60·양혁진 6건의 실측 형상)
 *   · `'none'` → chunk 0(`clip_stop_resolved:null` → `clip_empty` — 양혁진 3건의 형상)
 * 🔴 **종전 코드에서는 `mic_lost`가 절대 나지 않는다**(트랙이 `ended`가 아니라
 * `isStreamLost()`가 false다). 처방을 빼면 ⓑ가 즉시 red다.
 *
 * ## 반증 축(무엇을 빼면 red인가)
 *  · 연속 카운터를 지우면 → **ⓑ** red(`mic_lost:*` 없음)
 *  · 임계를 1로 낮추면 → **ⓐ** red(1회에서 이미 래치)
 *  · 🔴 **정정(r2 · CF-6)**: 리셋을 `clip_saved`가 아니라 `clip_started`로 옮기면 → **ⓒ가 아니라
 *    ⓑ가** red다. 초판 헤더는 ⓒ를 지목했는데 **틀렸다** — ⓒ는 `clip_summary`의 `failed>0`과 종료
 *    화면 경고만 재고, `failed`는 래치·연속 카운터와 무관하게 증가한다(`clipHealth.recordFailure`).
 *    즉 **래치를 어떻게 망가뜨려도 ⓒ는 green이다**(리뷰 실측 런 B). 요구(§1-3 「리셋은 저장
 *    성공에서만」)를 덮는 것은 ⓑ다(연속이 임계에 못 닿아 `mic_lost` 0).
 *  · 고지 배선(`useClipFailureAlert`)을 빼면 → ⓑ의 `clip_fail_alert` 단언이 red
 *  · [CF-1] 자동 재연결 게이트를 빼면 → ⓑ의 「자동 재획득 0회」 단언이 red
 *  · [CF-2] 고지 1회성을 `micLost` 에지로 되돌리면 → ⓑ(3회 실패에 1건)와 ⓔ(세션당 1건)가 red
 *  · 결산 로깅을 빼면 → ⓒ가 red
 *
 * ## 🔴 안 재는 것 — 정직하게 적는다
 * **iOS 오디오 세션 탈취 자체는 Playwright로 만들 수 없다**(OS 레벨 사건 —
 * `v0460-audio-interruption-probe.spec.ts` 헤더가 같은 한계를 명시한다). 여기서 재는 것은
 * 「빈 클립이 계속 오면 우리가 그것을 잡아 알리는가」이지 「iOS가 언제 무음을 만드는가」가 아니다.
 * `BlackoutOverlay`(z-9999)를 실제로 걷어내는지는 `clip_fail_alert:blackout=` 계측으로만 잰다 —
 * 홀드 제스처 경유 blackout 진입은 v0470-w7 계보가 이미 잠근다.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, waitForTtsIdle } from './fixtures/stt';
import { createClipHealth, clipSummaryExtra, CLIP_FAIL_LATCH_THRESHOLD } from '../src/lib/clipHealth';

test.setTimeout(120_000);

const MINI_COLUMNS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 1 }, sampleKey: true },
  { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  { id: 'm2', name: '측정항목02', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  { id: 'm3', name: '측정항목03', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];
const MINI_SETTINGS = {
  ...AZ_SETTINGS,
  state: { ...AZ_SETTINGS.state, columns: MINI_COLUMNS, totalRows: 1, sessionAutoLabel: 'clip-silent' },
};
const MINI_HEADERS = ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02', '측정항목03'];
const MINI_ROWS = [[PREV_ROUND, '이원창', '1', '100.0', '', '']];

/** ⓔ 전용 — **세션 2개에 각각 2회 이상 커밋**할 음성 필드가 필요하다.
 *  기본 MINI는 음성 3필드/1행이라 두 번째 세션에는 남은 필드가 1개뿐이고, 그러면 임계(2)에
 *  못 닿아 「재무장됐는데도 조용한」 위양성 red가 난다(실측으로 잡았다). */
const WIDE_COLUMNS = [
  ...MINI_COLUMNS,
  { id: 'm4', name: '측정항목04', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  { id: 'm5', name: '측정항목05', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  { id: 'm6', name: '측정항목06', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];
const WIDE_SETTINGS = {
  ...AZ_SETTINGS,
  state: { ...AZ_SETTINGS.state, columns: WIDE_COLUMNS, totalRows: 1, sessionAutoLabel: 'clip-silent-wide' },
};
const WIDE_HEADERS = [...MINI_HEADERS, '측정항목04', '측정항목05', '측정항목06'];
const WIDE_ROWS = [[PREV_ROUND, '이원창', '1', '100.0', '', '', '', '', '']];

/** clip/error/session 계열 로그의 `extra` — 「경로가 실제로 돌았는가」의 증명(r3-11과 같은 패턴). */
async function logExtras(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((r) => {
      const q = indexedDB.open('agri-voicenote');
      q.onsuccess = () => r(q.result);
    });
    const rows: { type?: string; extra?: string }[] = await new Promise((r) => {
      const q = db.transaction('logEvents', 'readonly').objectStore('logEvents').getAll();
      q.onsuccess = () => r(q.result as { type?: string; extra?: string }[]);
      q.onerror = () => r([]);
    });
    db.close();
    return rows
      .filter((e) => e.type === 'clip' || e.type === 'error' || e.type === 'session')
      .map((e) => String(e.extra ?? ''));
  });
}

/** 무음 사고를 **명시적으로** 켠 채 부팅한다.
 *  🔴 `addInitScript`로 **goto보다 먼저** 심는다 — 세션 시작(F18 선행 획득)이 이미 클립을
 *  만들기 시작하므로 `evaluate`로 나중에 켜면 첫 클립을 놓친다. */
async function bootMini(page: Page, mode: 'tiny' | 'none' = 'tiny', wide = false) {
  await page.addInitScript((m) => {
    (window as unknown as { __clipSilentMode: string }).__clipSilentMode = m;
  }, mode);
  await boot(page, PHONE_402, {
    settings: (wide ? WIDE_SETTINGS : MINI_SETTINGS) as unknown as typeof AZ_SETTINGS,
    headers: wide ? WIDE_HEADERS : MINI_HEADERS,
    sheetRows: wide ? WIDE_ROWS : MINI_ROWS,
  });
}

test('[node] ⓪ clipHealth 계약 — 연속만 세고, 성공에서만 리셋한다', () => {
  // 임계가 2라는 사실 자체를 잠근다(문서·주석이 아니라 계약으로).
  expect(CLIP_FAIL_LATCH_THRESHOLD, '임계가 바뀌면 아래 경계 단언의 의미도 바뀐다').toBe(2);

  const h = createClipHealth();
  expect(h.recordFailure(), '1회는 래치가 아니다(단발 사고 오탐 방지)').toBe(false);
  expect(h.recordFailure(), '연속 2회는 래치다').toBe(true);

  // 🔴 리셋은 성공에서만. 성공이 끼면 연속이 끊긴다.
  const h2 = createClipHealth();
  expect(h2.recordFailure()).toBe(false);
  h2.recordSaved();
  expect(h2.recordFailure(), '성공 뒤 첫 실패가 다시 래치가 되면 오탐이다').toBe(false);
  expect(h2.recordFailure()).toBe(true);

  // 결산은 누적이다(연속과 별개) — 종료 화면 문구의 분모가 여기서 나온다.
  // 🔴 v0.51 [CLIP-MUTED-SPAN-1] — `unreliable`이 **제3의 칸**으로 늘었다(muted 구간에 걸쳐
  //    저장은 됐지만 증거로 못 쓰는 클립). 여기서는 0이어야 한다 — 이 경로엔 muted가 없다.
  expect(h2.summary()).toEqual({ saved: 1, failed: 3, unreliable: 0 });
  // 🔴 `clip_summary` **문자열은 바이트 불변이다**(PRINCIPLES §4 · 민구 확정 2026-09-01 ③A).
  //    `unreliable`은 여기 붙지 않고 신규 이벤트 `clip_unreliable_summary`가 나른다.
  expect(clipSummaryExtra(h2.summary())).toBe('clip_summary:saved=1,failed=3');

  // 🔴 [CF-2] 고지 1회성의 소유자는 이 장부다 — 세션 안에서는 몇 번을 물어도 한 번만 true다.
  const h3 = createClipHealth();
  expect(h3.alertOnce(), '세션 첫 고지는 허용').toBe(true);
  expect(h3.alertOnce(), '같은 세션에서 두 번째 고지가 허용됐다 — 셀마다 반복 발화한다').toBe(false);
  expect(h3.alertOnce()).toBe(false);
  h3.reset();
  expect(h3.alertOnce(), '세션 경계에서 재무장되지 않았다 — 다음 세션이 영영 조용하다').toBe(true);

  // 세션 경계 리셋은 연속·누적을 **둘 다** 비운다(이전 세션이 새 세션을 임계로 밀면 안 된다).
  h2.reset();
  // v0.51 — 세션 경계는 **세 칸 모두** 비운다(unreliable 포함).
  expect(h2.summary()).toEqual({ saved: 0, failed: 0, unreliable: 0 });
  expect(h2.recordFailure(), '리셋 후 첫 실패가 곧바로 래치면 카운터가 안 비워진 것이다').toBe(false);
});

test('ⓐ 빈 클립 1회로는 래치하지 않는다 — 경계의 아래쪽(ⓑ가 공허하지 않다는 대조군)', async ({ page }) => {
  await bootMini(page);
  await fireStt(page, '11.1', 900);
  await waitForTtsIdle(page);

  const evs = await logExtras(page);
  expect(evs.some((e) => e.startsWith('clip_empty') || e.startsWith('clip_too_small')),
    '전제: 이 픽스처에서 클립은 비어야 한다(이 스펙이 재는 상태가 아니면 아래가 공허하다)').toBe(true);
  expect(evs.filter((e) => e.startsWith('mic_lost')),
    '실패 1회에 래치했다 — 단발 사고에도 배너가 뜬다').toHaveLength(0);
});

test('ⓑ 빈 클립 연속 2회 → 트랙이 live여도 래치하고, 그 자리에서 고지한다', async ({ page }) => {
  // 실측 형상(5바이트 = `clip_too_small`)으로 두 번 연속 실패시킨다.
  // ⚠️ **사유 혼합(5B + chunk-0)은 여기서 재지 않는다.** 다음 클립은 값 커밋 **직후** 시작되므로
  //    모드를 갈아끼울 창이 커밋과 겹쳐 첫 조각을 놓친다(08-19 실측). 혼합이 같은 카운터를
  //    쓴다는 계약은 ⓪(`recordFailure`가 **사유를 인자로 받지 않는다**)와 `useValueCommit`의
  //    두 호출부가 같은 `clipHealth`를 쓰는 구조가 보장한다.
  await bootMini(page, 'tiny');
  // 🔴 [CF-2] **3회** 실패시킨다. 2회면 「1회 고지」가 커밋 수 때문에 우연히 성립해 공허해진다
  //    (리뷰 실측: 종전 코드로 3회를 돌리면 `clip_fail_alert`가 2건이었다).
  await fireStt(page, '11.1', 900);
  await waitForTtsIdle(page);
  await fireStt(page, '22.2', 1500);
  await waitForTtsIdle(page);
  await fireStt(page, '33.3', 1500);
  await waitForTtsIdle(page);

  const evs = await logExtras(page);
  expect(evs.some((e) => e.startsWith('clip_too_small')), '전제: 실패 형상이 5바이트다').toBe(true);
  // 🔴 종전 판정(`isStreamLost()`)은 여기서 **false**다 — fake 트랙은 `readyState:'live'`다.
  //    그러니 이 단언은 새 경로가 아니면 절대 통과하지 않는다(반증 축).
  expect(evs.filter((e) => e.startsWith('mic_lost')).length,
    '연속 2회 빈 클립인데 래치가 안 걸렸다 — 2026-08-19가 그대로 재발하는 상태다').toBeGreaterThan(0);
  // 🔴 [CF-2] 고지는 **정확히 1건**이다. 3회 실패에도 반복되면 현장 방해다.
  expect(evs.filter((e) => e.startsWith('clip_fail_alert:')).length,
    '고지가 반복됐거나(반복=현장 방해) 아예 안 나갔다').toBe(1);
  // 🔴 [CF-1] **살아 있는 스트림에서 자동 재획득을 하지 않는다.** `recoverStream`은 destructive-first라
  //    제스처 밖에서 부르면 멀쩡한 스트림을 먼저 버린다(v0.22.0 P0가 롤백한 사고).
  expect(evs.filter((e) => e === 'mic_auto_reconnect:attempt').length,
    '트랙이 live인데 자동 재획득을 시도했다 — v0.22.0 P0 재개방이다').toBe(0);
  expect(evs.filter((e) => e.startsWith('mic_auto_reconnect:skipped=')).length,
    '건너뛴 사실이 계측되지 않았다 — 다음 회차가 「왜 자동 복구가 없었나」를 못 읽는다').toBe(1);
  // 복구 진입로는 사용자 제스처다 — 배너가 **즉시** 서야 한다(자동 시도를 안 하므로).
  await expect(page.locator('[data-testid="mic-reconnect-btn"]'),
    '자동 재획득을 건너뛰었는데 수동 복구 진입로도 없다').toBeVisible({ timeout: 10_000 });
});

test('ⓔ 고지는 **세션당** 1회다 — 새 세션에서 다시 한 번(경계에서만 재무장)', async ({ page }) => {
  await bootMini(page, 'tiny', true);
  await fireStt(page, '11.1', 900);
  await waitForTtsIdle(page);
  await fireStt(page, '22.2', 1500);
  await waitForTtsIdle(page);
  expect((await logExtras(page)).filter((e) => e.startsWith('clip_fail_alert:')).length,
    '전제: 첫 세션에서 1회 고지').toBe(1);

  // 세션 종료 → 새 세션 시작.
  await page.locator('button[title="입력 종료"]').click();
  await page.locator('button[title="종료 확인"]').click();
  await expect(page.locator('[data-testid="clip-warning"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('text=음성 입력 시작').first().click();
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 8_000 });

  await fireStt(page, '44.4', 900);
  await waitForTtsIdle(page);
  await fireStt(page, '55.5', 1500);
  await waitForTtsIdle(page);
  await fireStt(page, '66.6', 1500);
  await waitForTtsIdle(page);

  // 🔴 세션 경계에서 재무장되지 않으면 **두 번째 세션은 영영 조용하다**(CF-2 수정의 반대 방향 결함).
  // 🔑 `poll`인 이유: 클립 종단(stop → 트림 → 저장)은 커밋 TTS가 끝난 뒤에도 몇 틱 더 간다.
  //    즉시 읽으면 두 번째 세션의 실패 1건만 보이는 창이 있다(실측으로 잡았다).
  await expect
    .poll(async () => (await logExtras(page)).filter((e) => e.startsWith('clip_fail_alert:')).length,
      { timeout: 10_000, message: '새 세션에서 고지가 재무장되지 않았다' })
    .toBe(2);
});

test('ⓒ 세션 종료 — 클립 결산을 남기고 종료 화면에 경고를 세운다', async ({ page }) => {
  await bootMini(page);
  await fireStt(page, '11.1', 900);
  await waitForTtsIdle(page);
  await fireStt(page, '22.2', 1500);
  await waitForTtsIdle(page);

  await page.locator('button[title="입력 종료"]').click();
  await page.locator('button[title="종료 확인"]').click();

  // 종료 화면 표면 — 값은 멀쩡하므로 **여기가 유일한 사후 통지**다.
  // 🔑 이걸 **먼저** 기다린다: stop()은 클립 flush·persist를 await하므로, 이 표면이 서야
  //    아래 로그도 IDB에 내려가 있다(순서를 뒤집으면 결산을 읽는 시점이 stop 완료보다 앞선다).
  await expect(page.locator('[data-testid="clip-warning"]'),
    '클립이 통째로 실패했는데 종료 화면이 조용하다').toBeVisible({ timeout: 15_000 });

  // 결산 1건 — `saved + failed`가 「값 커밋 시 클립을 정지 대기까지 보낸 횟수」다.
  const summary = (await logExtras(page)).filter((e) => e.startsWith('clip_summary:'));
  expect(summary, '세션 결산이 없다 — 실패 총량을 사후에 알 길이 없다').toHaveLength(1);
  expect(summary[0], '결산이 실패를 0으로 보고했다 — 카운터가 안 붙었다').not.toContain('failed=0');
});
