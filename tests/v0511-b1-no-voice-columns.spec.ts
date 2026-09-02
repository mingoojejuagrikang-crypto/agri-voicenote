/**
 * v0.51.1 B1 오라클 (제보① 2026-09-02 14:53 「음성 항목 없는 입력방식에서 음성입력시작 무반응」).
 *
 * 원인(read-fb F1): `useVoiceSession.start()`가 `vc.length === 0`에서 **무음으로 false**를 돌려줬다 — 이 가드는
 * `audio_unlock`·gUM보다 앞이라 권한 프롬프트조차 뜨지 않고, 호출부는 반환값을 버리며, 시작 버튼의 활성
 * 조건(`ReadyState`)은 음성 열 수를 보지 않았다. 로그에는 `ready_probe` 뒤 16초 공백만 남았다.
 *
 * 이 스펙이 고정하는 문장:
 *  ① 음성 열 0개 구성에서 시작 버튼은 **잠기고**, 사유 배너가 그 이유를 말한다.
 *  ② 그래도 `start()`가 불리면(강제 호출 — DOM에서 `disabled`를 떼고 클릭) 갈래 자체가 **로그 1줄**을
 *     남기고 세션을 올리지 않는다. 종전엔 이 호출이 아무 흔적도 남기지 않았다(무음 결함의 재현 경로).
 *
 * 🔴 반증(2026-09-02 실측): `ReadyState`의 `!noVoiceColumns` 조건을 빼면 ① red · `start()`의 `logger.log`를
 *    빼면 ② red.
 * ⚠️ `setLastTts` 문구는 스토어에만 쓰이고 읽는 컴포넌트가 없다(시트 차단 갈래와 같다 — 실측) — 여기서는
 *    화면 배너(같은 상수 `NO_VOICE_COLUMNS_MESSAGE`)와 로그로 잰다.
 * Mock: fixtures/stt · fixtures/gum([TEST-GUM-1]).
 */
import { test, expect, type Page } from '@playwright/test';
import { installVoiceMocks } from './fixtures/stt';
import { GUM_GRANT_SCRIPT } from './fixtures/gum';
import { BASE } from './baseUrl';
import { NO_VOICE_COLUMNS_MESSAGE } from '../src/lib/voicePrompts';

test.setTimeout(60_000);

const STORE_KEY = 'agri-voicenote-settings-v3';

/** 제보① 구성 — 자동·터치 열만 있고 **음성 열이 0개**(테이블은 생성됨 · 3행). */
function settingsNoVoice() {
  return {
    state: {
      chipSweepSeconds: 0,
      googleConnected: false,
      userEmail: null,
      sheet: null,
      sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_B1/edit',
      sheetTab: 'Sheet1',
      columnsSheetId: 'SHEET_B1',
      columnsSheetTab: 'Sheet1',
      availableSheets: [],
      manualMode: false,
      columns: [
        { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 3 } },
        { id: 'c8', name: '횡경', type: 'float', input: 'touch', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
        { id: 'c9', name: '종경', type: 'float', input: 'touch', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
      ],
      tableGenerated: true,
      totalRows: 3,
      ttsRate: 1.05,
      sessionLabelColId: null,
      sessionAutoLabel: 'b1',
      noisyMode: false,
      preferredVoiceName: '',
    },
    version: 13,
  };
}

type LogEv = { type: string; extra?: string; sessionId?: string };

async function loadLogEvents(page: Page): Promise<LogEv[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db || !db.objectStoreNames.contains('logEvents')) return [];
    return new Promise<LogEv[]>((res) => {
      const req = db.transaction('logEvents', 'readonly').objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result as LogEv[]);
      req.onerror = () => res([]);
    });
  });
}

async function sessionCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      const request = indexedDB.open('agri-voicenote');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    if (!db || !db.objectStoreNames.contains('sessions')) return 0;
    return new Promise<number>((resolve) => {
      const request = db.transaction('sessions', 'readonly').objectStore('sessions').count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(-1);
    });
  });
}

async function openVoiceTab(page: Page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ st, storeKey }) => {
      localStorage.clear();
      localStorage.setItem(storeKey, JSON.stringify(st));
      indexedDB.deleteDatabase('agri-voicenote');
    },
    { st: settingsNoVoice(), storeKey: STORE_KEY },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(300);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript({ content: GUM_GRANT_SCRIPT });
  await installVoiceMocks(page);
});

test('① 음성 열 0개 — 시작 버튼이 잠기고 사유 배너가 뜬다', async ({ page }) => {
  await openVoiceTab(page);
  const btn = page.locator('[data-testid="voice-start-button"]');
  await expect(btn).toBeVisible();
  await expect(btn, '음성 열이 0개인데 시작 버튼이 활성이다(제보① 재현)').toBeDisabled();
  await expect(page.getByRole('alert'), '왜 못 시작하는지가 화면에 없다').toContainText(NO_VOICE_COLUMNS_MESSAGE);
  // 요약 카드는 사실을 그대로 보여준다(제보 스크린샷의 「음성입력 항목 0개」).
  await expect(page.getByText('음성입력 항목')).toBeVisible();
});

test('② 강제 호출 — start()의 차단 갈래가 로그 1줄을 남기고 세션을 올리지 않는다(종전 무음 결함)', async ({ page }) => {
  await openVoiceTab(page);
  const btn = page.locator('[data-testid="voice-start-button"]');
  await expect(btn).toBeDisabled();
  // 🔴 React는 `props.disabled`인 버튼의 onClick을 **DOM 속성과 무관하게** 억제한다(합성 이벤트 게이트) —
  //    DOM에서 `disabled`를 떼고 클릭해도 핸들러가 안 불린다(2026-09-02 실측 red). 제품 코드에 훅을 넣지 않고
  //    갈래를 밟는 방법은 노드에 달린 React 프롭스의 실제 `onClick`(= VoiceScreen의 `onStart` → `start()`)을
  //    직접 부르는 것뿐이다. 키가 없으면 여기서 throw — 조용히 green이 되지 않는다.
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="voice-start-button"]') as (HTMLButtonElement & Record<string, unknown>) | null;
    if (!el) throw new Error('start button missing');
    const key = Object.keys(el).find((k) => k.startsWith('__reactProps'));
    if (!key) throw new Error('react props key missing on start button');
    const props = el[key] as { onClick?: (e: unknown) => void };
    if (typeof props.onClick !== 'function') throw new Error('onClick missing on start button props');
    props.onClick({ preventDefault() {}, stopPropagation() {} });
  });
  await page.waitForTimeout(800);

  await expect
    .poll(async () => (await loadLogEvents(page))
      .filter((e) => e.type === 'app' && e.extra === 'session_start_blocked:reason=no_voice_columns').length,
      { timeout: 5000, message: '차단 갈래가 로그를 남기지 않는다 — 제보①의 16초 공백이 그대로다' })
    .toBe(1);
  const blocked = (await loadLogEvents(page)).find((e) => e.extra === 'session_start_blocked:reason=no_voice_columns');
  expect(blocked?.sessionId, '차단 시점엔 세션 id가 없다 — __app__으로 남아야 어느 zip에도 동봉된다').toBe('__app__');
  // 가드는 오디오 unlock·gUM보다 앞이다 — 그 뒤 이벤트가 없어야 종전 형상(권한 프롬프트 없음)과 같다.
  const all = await loadLogEvents(page);
  expect(all.some((e) => e.extra?.startsWith('audio_unlock:')), '차단 갈래가 unlock 뒤로 밀렸다').toBe(false);
  // 세션은 올라가지 않았고 화면은 ready 그대로다.
  await expect(page.locator('[data-testid="voice-active-state"]')).toHaveCount(0);
  await expect(btn).toBeVisible();
  expect(await sessionCount(page)).toBe(0);
});
