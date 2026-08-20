/**
 * v0.45.0 WP-1 계측 발화 배선 — 바이트 계약은 tests/logEvents.spec.ts가, **발화 여부**는 여기가 잰다
 * (v0440-instrumentation.spec.ts 계보).
 *
 *   ① ready_probe — ready 화면 마운트에서 1건 + 스로틀(연속 재마운트 무증가). F15 근원 판정 축.
 *   ② font_render_echo — 🔴 **v0.47.0 W5ⓐ 정당 파손**: 「세션당 정확히 1건」 → **에코 표시마다 1건**.
 *      민구 확정(08-08, FB-F): 세션 1회 표본으로는 *"nn.n만, 확정 시에만"* 을 로그에서 가를 수
 *      없다 — 갈린 그 에코가 표본에 들어올 보장이 없다. 이 파일이 지키던 **1회 계약이 곧
 *      판정 불가의 원인**이었으므로, 계약 자체를 갈아끼운다(오라클 약화가 아니다: 아래 ②는
 *      「늘지 않는다」를 「순번대로 는다」로 바꿔 **같은 강도로** 못박는다).
 *   ③ session start meta.bargeInEnabled — D1 토글 스냅샷(축 C 판정 전제).
 */
import { test, expect, type Page } from '@playwright/test';
import { installVoiceMocks, fireStt, waitForTtsIdle } from './fixtures/stt';
import { GUM_GRANT_SCRIPT } from './fixtures/gum';
import { BASE } from './baseUrl';

test.setTimeout(120_000);

const STORE_KEY = 'agri-voicenote-settings-v3';

const SETTINGS = {
  state: {
    googleConnected: false, userEmail: null, sheet: null,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_INSTR45_1/edit', sheetTab: 'Sheet1',
    columnsSheetId: 'SHEET_INSTR45_1', columnsSheetTab: 'Sheet1',
    availableSheets: [], manualMode: false,
    columns: [
      { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 3 } },
      { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
    ],
    tableGenerated: true, totalRows: 3,
    ttsRate: 1.05, sessionLabelColId: null, sessionAutoLabel: 'instr45', noisyMode: false, preferredVoiceName: '',
  },
  version: 12,
};

interface LoggedEvent { type: string; parsed?: string; extra?: string; meta?: Record<string, unknown> }

async function loadLogEvents(page: Page): Promise<LoggedEvent[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db || !db.objectStoreNames.contains('logEvents')) return [];
    return new Promise((res) => {
      const tx = db.transaction('logEvents', 'readonly');
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result);
      req.onerror = () => res([]);
    });
  });
}

async function readyProbes(page: Page): Promise<string[]> {
  return (await loadLogEvents(page))
    .filter((e) => e.extra?.startsWith('ready_probe:'))
    .map((e) => e.extra ?? '');
}

async function bootIdle(page: Page) {
  await page.addInitScript({ content: GUM_GRANT_SCRIPT });
  await installVoiceMocks(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ s, storeKey }) => {
      localStorage.clear();
      localStorage.setItem(storeKey, JSON.stringify(s));
      indexedDB.deleteDatabase('agri-voicenote');
    },
    { s: SETTINGS, storeKey: STORE_KEY },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(300);
}

async function startSession(page: Page) {
  await page.evaluate(() => { (window as unknown as { __micSettleSkipForTest?: boolean }).__micSettleSkipForTest = true; });
  await page.locator('text=음성 입력 시작').first().click();
  await page.waitForTimeout(700);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
  await waitForTtsIdle(page);
}

// ─── ① ready_probe — 마운트 1건 + 스로틀 ─────────────────────────────────────────────
test('① ready_probe — ready 화면에서 1건 발화, 연속 탭 왕복은 스로틀로 무증가', async ({ page }) => {
  await bootIdle(page);

  await expect.poll(() => readyProbes(page), { timeout: 4000 }).toHaveLength(1);
  const probe = (await readyProbes(page))[0];
  // 값 자체는 환경 의존(목 TTS·헤드리스 장치) — 형태와 stt 축만 고정한다.
  expect(probe).toMatch(/^ready_probe:stt=(yes|no),synth=(none|idle|speaking|paused),voicesKo=\d+,mics=(\d+|unknown),perm=(granted|denied|prompt|unknown)$/);

  // 탭 왕복(ReadyState 재마운트) — 10초 스로틀 안이라 늘지 않는다(링버퍼 보호, [F5] 계보).
  await page.locator('[data-testid="tab-settings"]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(500);
  expect(await readyProbes(page)).toHaveLength(1);
});

// ─── ② font_render_echo — 확정(에코) 표시마다 1건 (v0.47.0 W5ⓐ) ──────────────────────
const echoes = async (page: Page) =>
  (await loadLogEvents(page)).filter((e) => e.extra?.startsWith('font_render_echo:'));

test('② font_render_echo — 커밋 에코마다 1건이 순번(n)대로 늘어난다(W5ⓐ 전수화)', async ({ page }) => {
  await bootIdle(page);
  await startSession(page);

  await fireStt(page, '33.3', 800);
  // 에코 정착 지연(300ms)+rAF 뒤 방출 — 플래시 창(1.5s) 안에서 hero 실렌더를 읽는다.
  await expect.poll(async () => (await echoes(page)).length, { timeout: 5000 }).toBe(1);
  const echo = (await echoes(page))[0];
  // 🔴 v0.46.0 정당 파손 (2026-08-07) — `c401a30`(08-07 16:00)이 **확정값 넘침 계측**을 넣어
  //    필드가 3개 → 6개가 됐다(`ovX`·`ovY`·`len`). 종전 정규식은 `h=\d+$`로 **끝을 못박고
  //    있어** 새 필드가 붙는 순간 red가 됐다.
  //    🔴🔴 **그 red는 08-07 하루 종일 아무에게도 안 보였다** — 이 파일이 `test:e2e:gate`
  //    목록 **밖**이라 회차 내내 한 번도 안 돌았고, 08-07 밤 전량 스위트에서야 드러났다.
  //    같은 날 `v043-typo-contract`가 **똑같은 기전**으로 red였다(게이트 밖 + 새벽 커밋).
  //    👉 계측 포맷을 늘릴 때 **그 포맷을 단언하는 오라클이 게이트 안에 있는지** 먼저 봐라.
  //    ⚠️ 필드를 늘리면 여기도 함께 늘려라. `$`를 떼서 느슨하게 만들지 마라 —
  //    **끝을 못박는 것이 「형식이 조용히 바뀌는 것」을 잡는 이 단언의 존재 이유다.**
  // 🔴 v0.47.0 W5ⓐ 정당 파손 — 6필드 → 최대 13필드(`n`·`ell`·`fit`·`px0`·`ovX0`·`fit0`·`txt`).
  //    `txt`가 마지막이고 값에 ','가 들어갈 수 없으므로(빌더가 %-이스케이프한다) `[^,]*$`가
  //    **`$`의 엄격함을 그대로 유지한다** — 느슨하게 푼 것이 아니다.
  //    전환 직후 3종(`px0`·`ovX0`·`fit0`)은 그 시점에 요소가 없으면 빠지므로 여기서는
  //    optional로 두고, **실제로 실렸는지는 아래에서 따로 단언**한다(무엇이 깨졌는지 갈리게).
  expect(echo.extra).toMatch(
    /^font_render_echo:hero=\d+(\.\d)?,w=\d+,h=\d+,ovX=-?\d+,ovY=-?\d+,len=\d+,n=\d+,ell=[01],fit=[\d.]+(,px0=\d+(\.\d)?,ovX0=-?\d+,fit0=[\d.]+)?,txt=[^,]*$/,
  );
  // 실렌더값이 0이면 요소를 못 읽은 것이다 — 프로브 폴백 금지 계약의 실효 확인.
  expect(Number(/hero=([\d.]+)/.exec(echo.extra ?? '')?.[1])).toBeGreaterThan(0);
  // 🔑 신규 3필드가 **실제로 측정된 값인지** 본다. 형식만 맞고 값이 안 채워지면
  //    민구 제보(`33…` 잘림)를 판정하려고 넣은 계측이 로그만 늘리는 꼴이 된다.
  //    `len`은 표시 문자열 길이이므로 확정값 `33.3`에서 **반드시 4**다 — 0이면 요소를 못 읽었다.
  expect(Number(/len=(\d+)/.exec(echo.extra ?? '')?.[1])).toBe(4);
  // W5ⓐ — 표시 **문자열 자체**가 실린다. `len=4`만으로는 "33.3을 그렸다"와 "33…을 그렸다"가
  //   같아 보인다(민구 제보의 핵심이 정확히 그 구분이다).
  expect(/txt=([^,]*)$/.exec(echo.extra ?? '')?.[1], 'txt = 화면에 실제로 그려진 문자열').toBe('33.3');
  expect(/,n=(\d+),/.exec(echo.extra ?? '')?.[1], '세션 첫 에코의 순번은 1').toBe('1');
  // W5ⓑ 이후 hero 확정 라인에 ellipsis가 남아 있으면 안 된다 — 배포 번들 판정 지표.
  expect(/,ell=([01])/.exec(echo.extra ?? '')?.[1], 'W5ⓑ 후 ellipsis는 계산 스타일에서 사라진다').toBe('0');
  // 전환 직후 판독(후보 ① 판정 축)이 실제로 실렸는가 — 이게 빠지면 정착값만 남아
  //   "첫 프레임에만 넘쳤다"를 **구조적으로 못 본다**(전수화의 절반이 무의미해진다).
  expect(echo.extra, 'px0 — rAF 2회 시점(전환 직후) 판독').toMatch(/,px0=/);

  // 🔴 두 번째 커밋 — **늘어야 한다.** 종전 계약(「늘지 않는다」)의 반전이다.
  await waitForTtsIdle(page);
  await fireStt(page, '21.1', 800);
  await expect
    .poll(async () => (await echoes(page)).length, { timeout: 5000 })
    .toBe(2);
  const second = (await echoes(page))[1];
  expect(/,n=(\d+),/.exec(second.extra ?? '')?.[1], '두 번째 에코의 순번은 2 — 구멍/중복은 여기서 드러난다').toBe('2');
  expect(/txt=([^,]*)$/.exec(second.extra ?? '')?.[1]).toBe('21.1');
});

// ─── ③ session meta — bargeInEnabled 스냅샷 ────────────────────────────────────────
test('③ 세션 시작 메타에 bargeInEnabled(D1 토글)가 박힌다', async ({ page }) => {
  await bootIdle(page);
  await startSession(page);

  const start = (await loadLogEvents(page)).find((e) => e.type === 'session' && e.extra === 'start');
  expect(start, '세션 시작 메타 이벤트가 있어야 한다').toBeTruthy();
  // 기본값 ON(스토어 기본 true — Q9 민구 확정: 기본적으로 barge-in 켠다).
  expect(start?.meta?.bargeInEnabled).toBe(true);
});
