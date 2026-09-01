/**
 * 🔴 v0.51 [CLIP-MUTED-SPAN-1] 오라클 — **오디오 인터럽트 중 클립 사망**(2026-09-01 A축).
 *
 * ## 무엇을 재나
 * 마이크를 OS가 가져간(트랙 `muted`) 동안에도 앱은 녹음을 계속하고 **그 결과물을 정상 커밋으로
 * 처리했다.** 실측(폐기 세션 `sess_1788216390429`):
 * ```
 * 07:46:34  mic_track_evt:mute                                    ← 마이크 전달 정지
 * 07:46:35  bg_enter_snapshot:rec=recording,track=muted            ← 앱은 「녹음 중」
 * 07:46:54  beep_play:kind=commit,result=suspended,ctx=interrupted ← 확인음이 안 울렸다
 * 07:46:55  clip_too_small:5                                       ← 5바이트
 * ```
 * 그 시간 절전 화면은 **「음성 입력은 계속됩니다」** 를 띄웠고, 결산은 실패를 세지 않았다.
 * 사용자가 받은 신호 **셋이 전부 거짓**이었다.
 *
 * ## 🔴 재현 축 — `window.__setFakeTrackMuted()`
 * `fixtures/fakeTrack.ts`가 `readyState:'live'`는 그대로 두고 `muted`만 뒤집으며 `mute`/`unmute`를
 * 디스패치한다. **실기기 형상 그대로다** — `isStreamLost()`는 이 구간에서 계속 `false`다.
 *
 * ## 🔴 이 스펙이 지는 가장 중요한 계약 — ⓒ(불가침)
 * A축 처방은 **기존 방어 설계 2개를 건드리지 않는다**는 조건에서만 옳다:
 *  ① 자동 재연결 스킵(`skipped=stream_live` · v0.50 r2 [CF-1]) — `recoverStream`은 destructive-first라
 *    제스처 밖 `getUserMedia` 거부 시 **멀쩡한 스트림까지 잃는다**(v0.22.0 P0가 롤백한 사고).
 *  ② `isStreamLost()`가 `muted`를 「살아 있음」으로 보는 것 — 래치하면 **멀쩡한 마이크에 재연결
 *    배너가 뜬다**([IOS-5]).
 * 👉 ⓒ가 **muted 동안 `mic_lost:*`·`mic_reconnect_attempt`·`mic_auto_reconnect:*` 0건**을 못 박는다.
 *    muted를 `failed`로 세는 순간(가장 쉬운 오구현) 이 단언이 red다.
 *
 * ## 반증 축(무엇을 빼면 red인가) — 실행 결과는 산출물 §구현 결과에 있다
 *  · `startClip`의 시작 시점 판정 제거      → ⓐ red
 *  · 트랙 리스너의 진행 중 래치 제거        → ⓑ red (ⓐ는 green — 두 경로가 다르다)
 *  · `recordUnreliable()` → `recordSaved()` → ⓐ의 결산 단언 red
 *  · `recordUnreliable()` → `recordFailure()` → 🔴 **ⓒ red**(금지사항 위반이 즉시 드러난다)
 *  · 문구 상태 분기 제거                    → ⓓ red
 *  · 자동 해제 타이머 제거                  → ⓔ red
 *  · 🔴 r2 [P1-2] 고지 판정을 `unreliable`만으로 되돌리면 → **ⓗ red**(실측 사고 형상에서 침묵)
 *  · 🔴 r2 [P1-2] `recordFailure(mutedSpan)`의 사유 인자를 빼면 → **ⓗ red**(같은 자리, 다른 층)
 *  · 🔴 r2 [P1-1] 게이트 목록에서 스펙 이름을 지우면 → **⓪-게이트 red**
 *
 * ## 🔴 안 재는 것 — 정직하게 적는다
 * **iOS가 언제 트랙을 muted로 만드는지는 Playwright로 만들 수 없다**(OS 레벨 사건 —
 * `v050-clip-silent-latch`·`v0460-audio-interruption-probe` 헤더의 같은 한계).
 * 여기서 재는 것은 **「muted 표면이 오면 우리가 그것을 구간으로 잡아, 세지 않고, 말하는가」**다.
 * 실기기 판정 전까지 `[CLIP-MUTED-SPAN-1]`의 상태는 `MONITORING`이다(AGENTS.md 계약 ④).
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, waitForTtsIdle, ttsLog } from './fixtures/stt';
import { createClipHealth, clipSummaryExtra, clipUnreliableSummaryExtra } from '../src/lib/clipHealth';
import fs from 'node:fs';
import path from 'node:path';

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
  state: { ...AZ_SETTINGS.state, columns: MINI_COLUMNS, totalRows: 1, sessionAutoLabel: 'muted-span' },
};
const MINI_HEADERS = ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02', '측정항목03'];
const MINI_ROWS = [[PREV_ROUND, '이원창', '1', '100.0', '', '']];

async function bootMini(page: Page) {
  await boot(page, PHONE_402, {
    settings: MINI_SETTINGS as unknown as typeof AZ_SETTINGS,
    headers: MINI_HEADERS,
    sheetRows: MINI_ROWS,
  });
}

/** clip/error/session 계열 로그의 `extra` — 「경로가 실제로 돌았는가」의 증명. */
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

/** 🔴 오디오 인터럽트의 **표면**을 만든다(readyState는 live 그대로 — 실기기 형상).
 *  @returns 실제로 상태가 바뀌었으면 true. false면 전제가 깨진 것이라 스펙이 공허해진다. */
async function setMuted(page: Page, muted: boolean): Promise<boolean> {
  return page.evaluate(
    (m) => (window as unknown as { __setFakeTrackMuted?: (v: boolean) => boolean }).__setFakeTrackMuted?.(m) ?? false,
    muted,
  );
}

/** 「금지사항 2개를 안 건드렸는가」 — 모든 muted 시나리오가 이걸 같이 단언한다(ⓒ). */
function expectNoRecoveryPath(evs: string[], where: string): void {
  expect(evs.filter((e) => e.startsWith('mic_lost')),
    `${where}: muted를 사망으로 래치했다 — 멀쩡한 마이크에 재연결 배너가 뜬다([IOS-5])`).toHaveLength(0);
  expect(evs.filter((e) => e === 'mic_reconnect_attempt'),
    `${where}: 제스처 밖에서 재획득을 시도했다 — recoverStream은 destructive-first다(v0.22.0 P0)`).toHaveLength(0);
  expect(evs.filter((e) => e.startsWith('mic_auto_reconnect')),
    `${where}: 자동 재연결 effect가 깨어났다 — muted를 failed로 세면 이렇게 된다`).toHaveLength(0);
}

/** 🔴 이 스펙 자신이 **릴리스 게이트 목록에 있는가**를 잰다 — 스펙 파일명이 SSOT다.
 *
 *  ## 왜 오라클이 스스로를 재는가
 *  `test:e2e:gate`는 **명시 파일 목록**이라 새 스펙은 여기 넣지 않으면 **아예 돌지 않는다.**
 *  이 레포는 그 함정에 이미 세 번 걸렸다:
 *   · v0.46.0 — `v043-typo-contract`가 목록 밖이라 red가 **하루 종일** 살아 있었다.
 *   · v0.50   — 원 커밋(`b9c5476`)이 빠뜨려 r2(`f98fd39`)에서 별도 커밋으로 닫았다.
 *   · v0.51   — 직전 커밋(`7b746f8`)이 *"게이트는 명시 파일 목록이라 새 스펙은 여기 넣지 않으면
 *               아예 돌지 않는다"* 를 커밋 메시지에 명문화했는데, **바로 다음 커밋이 또 걸렸다**
 *               (2026-09-02 콜드 리뷰 [P1-1] 실측: 목록 104건에 이 스펙이 없었다).
 *  🔴 **CI가 없다**(`.github/` 자체가 없다) — 로컬 `predeploy`가 유일한 게이트다. 등재를 빠뜨리면
 *  「muted를 `recordFailure()`로 바꿔도 predeploy는 green」이 된다(리뷰 원문).
 *
 *  👉 사람의 기억·문서·커밋 메시지는 **세 번 다 실패했다.** 그래서 계약으로 잠근다.
 *     이 단언은 `test:e2e:full`에서 돌므로, 누가 목록에서 이름을 지우면 그 순간 red다.
 *     (게이트 목록 자체에서 빠지면 게이트에서는 안 돌지만, 병합 전 전량 게이트가 잡는다.)
 */
test('[node] ⓪-게이트 이 오라클이 릴리스 게이트 목록에 등재돼 있다', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8')) as {
    scripts: Record<string, string>;
  };
  const gate = pkg.scripts['test:e2e:gate'] ?? '';
  expect(gate, '전제: test:e2e:gate 스크립트가 있어야 한다').not.toBe('');
  const listed = gate.split(/\s+/).filter((x) => x.startsWith('tests/'));
  expect(listed, 'v0.51 A축 오라클이 릴리스 게이트 목록에 없다 — predeploy에서 한 번도 돌지 않는다')
    .toContain('tests/v051-mic-muted-span.spec.ts');
  // 🔴 함께 등재돼야 하는 TTS 축(`feat/tts-strip-parens`) 오라클 2건. **이 브랜치에는 파일이
  //    아직 없다** — Playwright의 파일 인자는 경로가 아니라 **필터**라, 없는 이름은 조용히
  //    무시되고 게이트는 green이다(실측 확인: 없는 이름을 섞어 `--list` → exit 0).
  //    👉 그래서 병합 전에 미리 넣어 둔다. 병합 순서에 따라 잠깐 「목록에 있지만 파일은 없는」
  //    창이 생기는데, 그 창에서 게이트가 깨지지는 않는다.
  expect(listed, 'TTS 축약 오라클(단위)이 게이트 밖이다 — 괄호가 다시 귀로 나가도 predeploy는 green이다')
    .toContain('tests/tts-column-name.spec.ts');
  expect(listed, 'TTS 콜사이트 배선 오라클(e2e)이 게이트 밖이다 — 콜사이트 하나를 되돌려도 아무도 모른다')
    .toContain('tests/tts-column-name-e2e.spec.ts');
});

test('[node] ⓪ clipHealth 계약 — unreliable은 saved도 failed도 아니고, streak를 건드리지 않는다', () => {
  const h = createClipHealth();

  // 🔴 이 계약이 A축 처방의 핵심이다. muted 클립을 어느 쪽으로 세도 결함이 된다:
  //    saved로 세면 집계가 무음을 성공이라 하고, failed로 세면 재연결 배너가 뜬다.
  h.recordUnreliable();
  h.recordUnreliable();
  expect(h.summary(), 'unreliable이 제3의 칸으로 서지 않았다')
    .toEqual({ saved: 0, failed: 0, unreliable: 2, mutedFailed: 0 });

  // 🔴 **streak 불변** — unreliable을 아무리 쌓아도 래치 임계에 닿지 않는다.
  //    (닿으면 micLost → 재연결 배너 = 금지사항 ② 위반. ⓒ가 e2e에서 같은 것을 잰다.)
  expect(h.recordFailure(), 'unreliable이 streak를 밀어 올렸다 — 1회 실패가 곧바로 래치가 됐다').toBe(false);
  expect(h.recordFailure(), '연속 2회는 래치여야 한다(정상 경로가 죽으면 안 된다)').toBe(true);

  // 🔴 **리셋도 안 한다** — 「리셋은 clip_saved에서만」(clipHealth.ts 헤더). muted 하나가 끼었다고
  //    진짜 사망 구간의 연속이 끊기면, 그 구간에서 래치가 영영 안 걸린다.
  const h2 = createClipHealth();
  expect(h2.recordFailure()).toBe(false);
  h2.recordUnreliable();
  expect(h2.recordFailure(), 'unreliable이 연속을 끊었다 — 사망 구간에 muted가 끼면 래치 불발이다').toBe(true);

  // ── 🔴 v0.51 r2 [P1-2] — 넷째 칸 `mutedFailed`: **고지용이고 회계는 불변**이다 ──
  //    실측 사고에서 죽은 클립 3건이 전부 `failed` 경로였고, 그래서 고지가 침묵했다.
  //    그 사실을 잡으려면 `failed`에 사유 표지가 붙어야 하는데 — **이중 계수는 금지**다.
  const h3 = createClipHealth();
  expect(h3.recordFailure(true), '첫 실패는 래치가 아니다(임계 2)').toBe(false);
  expect(h3.summary(), 'muted 실패를 두 칸에 셌다 — 결산의 합이 커밋 수를 넘는다')
    .toEqual({ saved: 0, failed: 1, unreliable: 0, mutedFailed: 1 });
  // 🔴 **streak를 대체하지도 끊지도 않는다** — muted 실패 뒤 평범한 실패 하나면 임계에 닿아야 한다.
  //    (여기 오는 클립은 muted와 무관하게 **이미 실패했다**. 가드레일 ②가 금지한 것은
  //     「저장에 **성공한** muted 클립을 failed로 세는 것」이고, 이 경로는 그게 아니다.)
  expect(h3.recordFailure(), 'muted 표지가 연속 카운터를 갉아먹었다 — 진짜 사망 구간에서 래치가 늦어진다')
    .toBe(true);
  expect(h3.summary().mutedFailed, 'muted가 아닌 실패까지 muted로 셌다 — 고지가 위양성으로 나간다').toBe(1);
  // 인자 없는 호출은 **종전과 완전히 같다**(기존 콜사이트 회귀 방지).
  const h4 = createClipHealth();
  h4.recordFailure();
  expect(h4.summary(), '기본값이 muted 쪽으로 샜다').toEqual({ saved: 0, failed: 1, unreliable: 0, mutedFailed: 0 });

  // 결산 문자열: 🔴 `clip_summary`는 **바이트 불변**, unreliable은 신규 이벤트가 나른다.
  expect(clipSummaryExtra({ saved: 1, failed: 2, unreliable: 3, mutedFailed: 1 })).toBe('clip_summary:saved=1,failed=2');
  // 신규 이벤트의 꼬리 `mutedFail=` — 접두(`muted=`·`spans=`)는 그대로라 기존 판독이 안 깨진다.
  expect(clipUnreliableSummaryExtra(3, 2, 1)).toBe('clip_unreliable_summary:muted=3,spans=2,mutedFail=1');

  // 세션 경계는 넷 다 비운다.
  h.reset();
  expect(h.summary()).toEqual({ saved: 0, failed: 0, unreliable: 0, mutedFailed: 0 });
});

test('ⓐ muted 상태로 **시작된** 클립 → 저장은 되지만 「신뢰불가」로 센다 + ⓒ 불가침 + 결산', async ({ page }) => {
  await bootMini(page);
  await waitForTtsIdle(page);

  // 첫 커밋은 정상(대조군) — 이게 있어야 「원래 다 unreliable이더라」는 위양성이 배제된다.
  await fireStt(page, '11.1', 900);
  await waitForTtsIdle(page);

  // 🔴 **타이밍이 이 케이스의 전부다.** 시작 시점 판정을 **고립해서** 반증하려면 이렇게 짜야 한다:
  //   ① 지금 mute → 진행 중이던 클립2가 `mute` **이벤트**로 래치된다
  //   ② 커밋2 → 클립2가 닫히고, **클립3은 muted 상태에서 시작**된다
  //   ③ unmute → 클립3에는 `mute` 이벤트가 오지 않는다(이미 지난 전이다). 종료 시점도 `live`다
  //   ④ 커밋3 → 🔑 **클립3을 잡을 수 있는 것은 시작 시점 판정뿐이다**
  //   👉 그래서 기대값이 **2건**이다. 시작 판정을 빼면 1건이 되어 red다(반증 실측 확인).
  expect(await setMuted(page, true), '전제: 트랙 muted 토글이 동작해야 한다(픽스처 계약)').toBe(true);

  await fireStt(page, '22.2', 1500);
  await waitForTtsIdle(page);

  expect(await setMuted(page, false), '전제: unmute 회복 — 이후 클립은 시작 판정으로만 잡힌다').toBe(true);

  await fireStt(page, '33.3', 1500);
  await waitForTtsIdle(page);

  const evs = await logExtras(page);
  expect(evs.some((e) => e.startsWith('clip_saved:')),
    '전제: 정상 구간에서는 클립이 저장돼야 한다(아니면 이 스펙이 재는 대상이 아니다)').toBe(true);
  expect(evs.filter((e) => e === 'clip_unreliable:muted').length,
    'muted 구간에 걸친 클립 2건(이벤트 래치 1 + 시작 판정 1) 중 일부를 놓쳤다').toBe(2);
  expect(evs.some((e) => e.startsWith('mic_interrupt:on:')),
    '인터럽트 진입이 계측되지 않았다 — 다음 회차가 구간 길이를 못 읽는다').toBe(true);

  // 🔴 ⓒ — 금지사항 2개 불가침.
  expectNoRecoveryPath(evs, 'ⓐ');

  // ── 세션 종료 결산 ──
  await page.locator('button[title="입력 종료"]').click();
  await page.locator('button[title="종료 확인"]').click();
  // 🔑 종료 화면 표면을 **먼저** 기다린다: stop()이 flush·persist를 await하므로 이게 서야
  //    아래 로그도 IDB에 내려가 있다(v050 스펙과 같은 순서 계약).
  await expect(page.locator('[data-testid="clip-warning"]'),
    'muted 구간 클립이 있는데 종료 화면이 조용하다 — 값은 멀쩡해 아무도 모른다').toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="clip-warning"]'),
    '경고가 「저장 안 됨」만 말한다 — 「저장은 됐는데 무음일 수 있다」는 다른 사실이고 행동도 다르다')
    .toContainText('마이크가 멈춘 동안');

  const after = await logExtras(page);
  const unrelSummary = after.filter((e) => e.startsWith('clip_unreliable_summary:'));
  expect(unrelSummary, '신규 결산 이벤트가 없다 — 판독이 clip_summary만 보고 「실패 0」으로 읽는다').toHaveLength(1);
  expect(unrelSummary[0], '구간 수가 안 실렸다 — 「길었나 잦았나」를 못 가른다').toContain('spans=1');
  // 🔴 v0.51 r2 [P1-2] — ⓐ에는 **실패한** muted 클립이 없다. 여기서 mutedFail이 0이 아니면
  //    「저장은 된 클립」을 실패 쪽으로도 세고 있다는 뜻이다(이중 계수).
  expect(unrelSummary[0], 'muted 실패가 없는데 실패로 셌다 — 저장된 클립을 두 번 세고 있다').toContain('mutedFail=0');
  // 🔴 기존 결산은 **바이트 불변**이다(PRINCIPLES §4).
  const summary = after.filter((e) => e.startsWith('clip_summary:'));
  expect(summary, '기존 결산이 사라지거나 늘었다').toHaveLength(1);
  expect(summary[0], 'clip_summary에 꼬리가 붙었다 — 바이트 계약 위반이다').toMatch(/^clip_summary:saved=\d+,failed=\d+,asEvt=\d+$/);
  expectNoRecoveryPath(after, 'ⓐ-종료후');
});

test('ⓑ mute가 클립 **도중에** 왔다 갔다 — 종료 시점엔 live인데도 구간으로 잡는다', async ({ page }) => {
  // 🔴 이 케이스가 「구간 래치」의 존재 이유다. 종료 시점 스냅샷(`trackState`)으로는 **구조적으로**
  //    못 잡는다 — 클립이 닫힐 때 트랙은 이미 `live`로 돌아와 있다. 2026-09-01 판독이 걸린 사각.
  await bootMini(page);
  await waitForTtsIdle(page);
  await fireStt(page, '11.1', 900);
  await waitForTtsIdle(page);

  // 다음 클립은 이미 돌고 있다(커밋 직후 시작). 그 **구간 안에서** 뺏었다가 돌려준다.
  expect(await setMuted(page, true), '전제: mute 진입').toBe(true);
  await page.waitForTimeout(400);
  expect(await setMuted(page, false), '전제: unmute 회복').toBe(true);
  await page.waitForTimeout(200);

  // 그리고 그 클립을 닫는다 — 이 시점 트랙 상태는 `live`다.
  await fireStt(page, '22.2', 1500);
  await waitForTtsIdle(page);

  const evs = await logExtras(page);
  expect(evs.filter((e) => e === 'clip_unreliable:muted').length,
    '종료 시점이 live라고 정상으로 처리했다 — 스냅샷은 구간을 못 본다(래치가 필요한 이유)').toBeGreaterThan(0);
  expect(evs.some((e) => e.startsWith('mic_interrupt:off:') && /ms=\d+/.test(e)),
    '구간 길이가 안 남았다 — 자동 해제 임계를 실측으로 조정할 근거가 사라진다').toBe(true);
  expectNoRecoveryPath(evs, 'ⓑ');
});

test('ⓓ 절전 화면이 실상태를 말한다 — muted면 「음성 입력은 계속됩니다」가 사라진다', async ({ page }) => {
  await bootMini(page);
  await waitForTtsIdle(page);

  // 음성 명령으로 절전 진입(v0460 계보의 진입 경로 그대로).
  await fireStt(page, '화면', 800);
  const overlay = page.locator('[data-testid="blackout-overlay"]');
  await overlay.waitFor({ state: 'visible', timeout: 5000 });

  const hint = page.locator('[data-testid="blackout-hint"]');
  await expect(hint, '전제: 정상 상태에서는 종전 문구 그대로다').toContainText('음성 입력은 계속됩니다');

  expect(await setMuted(page, true), '전제: 트랙 muted 토글').toBe(true);

  // 🔴 화면이 **거짓말을 멈춰야 한다.** 이 순간 소리로는 알릴 방법이 없다(확인음이 suspended).
  await expect(hint, 'muted인데 화면이 「음성 입력은 계속됩니다」를 유지한다 — 사용자가 받는 유일한 통로가 거짓이다')
    .not.toContainText('음성 입력은 계속됩니다', { timeout: 5000 });
  await expect(hint, '무슨 일이 일어났는지 말하지 않는다 — 문구를 지우기만 하면 사용자는 여전히 모른다')
    .toContainText('마이크가 멈춰');
  expect(await hint.getAttribute('data-mic-interrupted'), '상태 플래그가 화면에 반영되지 않았다').toBe('1');

  // aria-label도 같은 배열에서 나온다 — 한쪽만 고치면 스크린리더는 계속 거짓을 읽는다.
  const aria = await overlay.getAttribute('aria-label');
  expect(aria ?? '', 'aria-label이 종전 문장을 그대로 읽는다(인라인 사본이 남아 있다)').not.toContain('음성 입력은 계속');
  expect(aria ?? '', 'aria-label이 실상태를 말하지 않는다').toContain('마이크가 멈춰');

  expectNoRecoveryPath(await logExtras(page), 'ⓓ');
});

test('ⓔ 인터럽트가 3초를 넘기면 절전 화면을 자동으로 연다 — 구간당 1회', async ({ page }) => {
  await bootMini(page);
  await waitForTtsIdle(page);
  await fireStt(page, '화면', 800);
  const overlay = page.locator('[data-testid="blackout-overlay"]');
  await overlay.waitFor({ state: 'visible', timeout: 5000 });

  expect(await setMuted(page, true), '전제: 트랙 muted 토글').toBe(true);

  // 임계(3000ms) 직전까지는 **열지 않는다** — 짧은 알림음에 화면을 켜면 배터리 손해이고,
  // 밭에서는 장갑 낀 손으로 2초 홀드를 다시 해야 한다.
  await page.waitForTimeout(1500);
  await expect(overlay, '임계 전에 화면을 열었다 — 짧은 인터럽트마다 절전이 깨진다').toBeVisible();

  // 임계를 넘기면 연다.
  await expect(overlay, '3초 넘게 마이크가 멈췄는데 절전 화면이 그대로다 — 배너도 문구도 못 보는 상태다')
    .toBeHidden({ timeout: 8000 });

  const evs = await logExtras(page);
  expect(evs.filter((e) => e === 'mic_muted_blackout:released').length,
    '자동 해제가 계측되지 않았다 — 다음 회차가 오탐률을 못 잰다').toBe(1);
  expectNoRecoveryPath(evs, 'ⓔ');
});

test('ⓕ 회복 직후 한 번 말한다 — muted 도중에는 말하지 않는다', async ({ page }) => {
  await bootMini(page);
  await waitForTtsIdle(page);
  await fireStt(page, '11.1', 900);
  await waitForTtsIdle(page);

  expect(await setMuted(page, true), '전제: mute 진입').toBe(true);
  await fireStt(page, '22.2', 1500);
  await waitForTtsIdle(page);

  // 🔴 muted 도중에는 발화하지 않는다 — 그 순간 오디오 출력도 죽어 있다
  //    (실측 `beep_play:result=suspended`). 큐잉하면 들리지도 않고 나중에 엉뚱하게 터진다.
  const during = await ttsLog(page);
  expect(during.filter((t) => t.includes('마이크가 잠시 멈춰')).length,
    'muted 도중에 고지를 발화했다 — 들리지 않고 큐에 남아 나중에 터진다').toBe(0);

  expect(await setMuted(page, false), '전제: unmute 회복').toBe(true);
  await waitForTtsIdle(page);

  await expect
    .poll(async () => (await ttsLog(page)).filter((t) => t.includes('마이크가 잠시 멈춰')).length,
      { timeout: 8000, message: '회복 후에도 고지가 없다 — 사용자는 증거를 잃은 줄 끝까지 모른다' })
    .toBe(1);

  expectNoRecoveryPath(await logExtras(page), 'ⓕ');
});

/** 🔴 v0.51 r2 [P1-2] — **2026-09-01 실측 사고의 형상 그 자체.**
 *
 *  ⓕ와 무엇이 다른가: ⓕ의 muted 클립은 **저장에 성공**해서 `unreliable`로 섰다. 그런데
 *  실측 사고(`sess_1788216390429`)에서 죽은 클립 3건은 **하나도 저장되지 않았다** —
 *  `clip_too_small:5`×2 + `clip_empty`×1, 전부 `failed` 경로다. 그래서 종전 고지 판정
 *  (`unreliable` 증가분만 본다)은 **가장 크게 잃은 형상에서 정확히 아무 말도 안 했다.**
 *
 *  🔴 이 스펙이 없으면 `KNOWN-ISSUES [CLIP-MUTED-SPAN-1]`의 실기기 판정 조건 ⓓ
 *  「회복 후 고지가 들리는가」가 **구조적으로 「안 들린다」**로 나오고, 다음 회차가 그걸
 *  「고지 배선이 안 됐다」로 오독해 엉뚱한 자리를 판다(2026-09-02 콜드 리뷰 [P1-2]).
 *
 *  ## 🔑 왜 커밋을 **한 번만** 하나 — ⓒ와 양립시키는 유일한 구성
 *  실패 2회면 임계(`CLIP_FAIL_LATCH_THRESHOLD=2`)에 닿아 `mic_lost`가 서고, 그건 [CF-1]이
 *  **정당하게** 내는 것이라 `expectNoRecoveryPath()`가 red가 된다(리뷰 관찰 ㉠ — 신규 결함이
 *  아니라 오라클 주석의 범위 문제다). 실패 1회는 임계 아래라 두 계약이 동시에 성립한다.
 *  🔑 그리고 **1건이야말로 최악의 형상**이다 — 기존 `useClipFailureAlert`는 임계 2에서만
 *  발화하므로, muted 구간 실패가 1건이면 이 고지가 **유일한 청각 통로**다.
 */
test('ⓗ 실측 사고 형상 — muted 구간의 클립이 **저장조차 안 돼도** 회복 후 고지가 나간다', async ({ page }) => {
  // 🔴 `addInitScript`로 goto보다 먼저 심는다 — 세션 시작이 이미 클립을 만들기 시작하므로
  //    `evaluate`로 나중에 켜면 첫 조각(30,000B)을 놓쳐 클립이 정상 크기가 된다(v050 헤더).
  await page.addInitScript(() => {
    (window as unknown as { __clipSilentMode: string }).__clipSilentMode = 'tiny';
  });
  await bootMini(page);
  await waitForTtsIdle(page);

  expect(await setMuted(page, true), '전제: mute 진입 — 이 커밋은 인터럽트 구간 안에서 일어난다').toBe(true);

  // 커밋 1회 = 실패 1회. 임계(2) 아래라 래치가 서지 않는다(위 헤더 🔑).
  await fireStt(page, '11.1', 1500);
  await waitForTtsIdle(page);

  const during = await logExtras(page);
  expect(during.some((e) => e.startsWith('clip_too_small:')),
    '전제: 실측 사고 형상(5바이트)이 재현돼야 한다 — 아니면 이 스펙은 다른 것을 재고 있다').toBe(true);
  expect(during.filter((e) => e === 'clip_muted_fail:too_small').length,
    '전제: 인과(muted 구간에서 죽었다)가 로그에 남아야 한다').toBe(1);
  // 🔴 **이중 계수 금지** — 이 클립은 `failed` 한 칸에만 선다. `unreliable`로도 세면
  //    결산의 합(saved+failed+unreliable)이 커밋 수를 넘는다.
  expect(during.filter((e) => e === 'clip_unreliable:muted'),
    '저장 실패한 클립을 unreliable로도 셌다 — 같은 클립이 두 칸에 섰다').toHaveLength(0);
  // 🔴 muted 도중에는 말하지 않는다(ⓕ와 같은 계약 — 그 순간 오디오 출력이 죽어 있다).
  expect((await ttsLog(page)).filter((t) => t.includes('마이크가 잠시 멈춰')),
    'muted 도중에 고지를 발화했다 — 들리지 않고 큐에 남아 나중에 터진다').toHaveLength(0);

  expect(await setMuted(page, false), '전제: unmute 회복').toBe(true);
  await waitForTtsIdle(page);

  await expect
    .poll(async () => (await ttsLog(page)).filter((t) => t.includes('마이크가 잠시 멈춰')).length,
      { timeout: 8000, message: '🔴 클립이 죽었는데 회복 후에도 조용하다 — 실측 사고에서 앱이 정확히 이랬다' })
    .toBe(1);

  const evs = await logExtras(page);
  // 🔑 내역까지 잠근다: 실기기 로그만 보고 「실패 경로로 잡혔나 unreliable로 잡혔나」를 갈라야 한다.
  expect(evs.filter((e) => e.startsWith('mic_interrupt_notice:')),
    '고지 계측의 내역이 다르다 — 다음 회차가 무엇이 고지를 냈는지 못 읽는다')
    .toEqual(['mic_interrupt_notice:lost=1,unrel=0,fail=1']);
  expectNoRecoveryPath(evs, 'ⓗ');

  // ── 세션 종료 결산 — 고지와 결산이 **같은 장부**를 봐야 한다 ──
  await page.locator('button[title="입력 종료"]').click();
  await page.locator('button[title="종료 확인"]').click();
  await expect(page.locator('[data-testid="clip-warning"]'),
    '클립이 죽었는데 종료 화면이 조용하다').toBeVisible({ timeout: 15_000 });

  const after = await logExtras(page);
  const summary = after.filter((e) => e.startsWith('clip_summary:'));
  // 🔴 **`failed=1` 정확히.** 2면 미커밋 클립이 회계에 섰다는 뜻이고, 그러면 임계에 닿아
  //    래치가 서서 위 ⓒ가 우연히 깨진다 — 이 단언이 「커밋 1회만」 전제를 지킨다.
  expect(summary[0], '회계가 종전과 달라졌다(mutedFailed를 failed에 더했거나, 미커밋 클립이 섰다)')
    .toMatch(/^clip_summary:saved=0,failed=1,asEvt=\d+$/);
  expect(after.filter((e) => e.startsWith('clip_unreliable_summary:')),
    '🔴 muted 구간 클립이 전부 실패면 신규 결산이 아예 안 나갔다 — 판독이 사유를 못 읽는다')
    .toEqual(['clip_unreliable_summary:muted=0,spans=1,mutedFail=1']);
  expectNoRecoveryPath(after, 'ⓗ-종료후');
});

test('ⓖ 정상 세션 회귀 — muted가 없으면 종전 그대로다(위양성 차단)', async ({ page }) => {
  await bootMini(page);
  await waitForTtsIdle(page);
  await fireStt(page, '11.1', 900);
  await waitForTtsIdle(page);
  await fireStt(page, '22.2', 1500);
  await waitForTtsIdle(page);

  const evs = await logExtras(page);
  expect(evs.some((e) => e.startsWith('clip_saved:')), '정상 클립이 저장되지 않았다').toBe(true);
  expect(evs.filter((e) => e === 'clip_unreliable:muted'),
    'muted가 없는데 신뢰불가로 셌다 — 오탐이면 결산이 반대 방향으로 거짓말한다').toHaveLength(0);
  expect(evs.filter((e) => e.startsWith('mic_interrupt:')),
    'muted가 없는데 인터럽트를 계측했다 — 링버퍼만 잠식한다').toHaveLength(0);
  expect((await ttsLog(page)).filter((t) => t.includes('마이크가 잠시 멈춰')),
    '정상 세션에서 고지가 나갔다 — 현장 방해다').toHaveLength(0);

  // 절전 화면 문구도 종전 그대로여야 한다.
  await fireStt(page, '화면', 800);
  await page.locator('[data-testid="blackout-overlay"]').waitFor({ state: 'visible', timeout: 5000 });
  await expect(page.locator('[data-testid="blackout-hint"]'),
    '정상인데 문구가 바뀌었다 — 이 기능이 절전 화면을 상시 오염시킨다').toContainText('음성 입력은 계속됩니다');

  const after = await logExtras(page);
  expect(after.filter((e) => e.startsWith('clip_unreliable_summary:')),
    'muted가 없는데 신규 결산이 나갔다').toHaveLength(0);
  expectNoRecoveryPath(after, 'ⓖ');
});
