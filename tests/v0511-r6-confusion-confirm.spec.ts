/**
 * v0.51.1 R6 — 혼동 확인 질문 e2e(브리핑 §2): 후보 발동 → 확인 TTS 1회 + `stt_confusion_hint` 1건 · 「둘째」 → 후보값
 * 커밋(정정 쌍 path=confusion) · 「첫째/네」 → 원값 유지 + 프로필 부정 사례 · 유일 후보(횡경 49.5) → 질문 0 ·
 * 「아니오」 → 재청취 + 같은 셀 두 번째 후보는 셀당 1회 상한 · 이동 명령은 「먼저 답해 주세요.」로 거부([PHASE-NAV-1]).
 *
 * 표는 **출하 전역 표**(프로필이 비어 있으니 폴백)다 — 당도 「1.x」의 L1P0:1>8(지지 8)·1>7(지지 4)이 런타임이 실제로
 * 읽는 형상이다. 표를 재생성해 그 규칙이 사라지면 이 스펙이 먼저 말한다(그때는 픽스처 프로필 시딩으로 바꿔라).
 *
 * 민구 결정(09-02 `_ASK-build-r6-fable-xhigh`): ① 먼저 커밋 → 질문 · ⓐ 혼동표 확률만 · #3 어휘·상한 승인.
 * MockSTT/mockSynth는 fixtures/stt.ts(SSOT). 서버는 playwright.config webServer가 띄운다.
 */
import { test, expect, type Page } from '@playwright/test';
import { GUM_GRANT_SCRIPT } from './fixtures/gum';
import { installVoiceMocks, fireStt, ttsLog, waitForTtsIdle } from './fixtures/stt';
import { BASE } from './baseUrl';

test.setTimeout(120_000);

const SETTINGS = {
  state: {
    googleConnected: false,
    userEmail: null,
    sheet: null,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_TEST_R6/edit',
    sheetTab: 'Sheet1',
    columnsSheetId: 'SHEET_TEST_R6',
    columnsSheetTab: 'Sheet1',
    availableSheets: [],
    manualMode: false,
    columns: [
      { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 3 } },
      { id: 'c8', name: '횡경(mm)', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
      { id: 'c14', name: '당도', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
    ],
    tableGenerated: true,
    totalRows: 3,
    ttsRate: 1.05,
    sessionLabelColId: null,
    sessionAutoLabel: 'r6-confusion-test',
    noisyMode: false,
    preferredVoiceName: '',
  },
  version: 13,
};

async function waitForActiveChip(page: Page, colName: string, timeout = 8000) {
  await page.waitForFunction(
    (name) => {
      const chip = document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
      return (chip?.dataset.colName ?? '').includes(String(name));
    },
    colName,
    { timeout },
  );
}

async function setupAndStart(page: Page) {
  await page.addInitScript({ content: GUM_GRANT_SCRIPT });
  await installVoiceMocks(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate((s) => { localStorage.setItem('agri-voicenote-settings-v3', JSON.stringify(s)); }, SETTINGS);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(200);
  const startBtn = page.locator('text=음성 입력 시작').first();
  await expect(startBtn).toBeVisible();
  await startBtn.click();
  await page.waitForTimeout(800);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
  await waitForActiveChip(page, '횡경');
  // 🔴 인식기는 시작 안내 TTS(3문장)가 끝난 뒤에야 만들어진다 — 그 전의 fireStt는 `__mockSTT`가 없어 **조용히 무시**된다
  //   (실측: 1.5초 뒤에도 null). v051-mic-muted-span과 같이 TTS 유휴 + 인스턴스 존재를 기다린다.
  await waitForTtsIdle(page);
  await page.waitForFunction(() => !!(window as unknown as { __mockSTT?: unknown }).__mockSTT, undefined, { timeout: 8000 });
}

/** IDB logEvents 중 extra가 접두로 시작하는 것(시간순). 버전 무지정 open — fixtures/idb.ts 규약. */
async function eventsWithPrefix(page: Page, prefix: string): Promise<{ extra: string; row?: number; colId?: string; text?: string; parsed?: string; previousValue?: string; type: string }[]> {
  return page.evaluate(async (p) => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const all: any[] = await new Promise((resolve, reject) => {
      const req = db.transaction('logEvents', 'readonly').objectStore('logEvents').getAll();
      req.onsuccess = () => resolve(req.result as any[]);
      req.onerror = () => reject(req.error);
    });
    return all.filter((e) => typeof e.extra === 'string' && e.extra.startsWith(p)).map((e) => ({ type: e.type, extra: e.extra, row: e.row, colId: e.colId, text: e.text, parsed: e.parsed, previousValue: e.previousValue }));
  }, prefix);
}

/** `session start` 이벤트의 meta.speaker — R6 수집 배선(미로그인 mock 환경이면 `anon`). */
async function sessionStartSpeaker(page: Page): Promise<string | undefined> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const all: any[] = await new Promise((resolve, reject) => {
      const req = db.transaction('logEvents', 'readonly').objectStore('logEvents').getAll();
      req.onsuccess = () => resolve(req.result as any[]);
      req.onerror = () => reject(req.error);
    });
    const start = all.filter((e) => e.type === 'session' && e.extra === 'start').at(-1);
    return start?.meta?.speaker;
  });
}

async function valueEvents(page: Page) {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const all: any[] = await new Promise((resolve, reject) => {
      const req = db.transaction('logEvents', 'readonly').objectStore('logEvents').getAll();
      req.onsuccess = () => resolve(req.result as any[]);
      req.onerror = () => reject(req.error);
    });
    return all.filter((e) => e.type === 'value').map((e) => ({ row: e.row, colId: e.colId, text: e.text, parsed: e.parsed, previousValue: e.previousValue }));
  });
}

async function cellValue(page: Page, row: number, colId: string): Promise<string | undefined> {
  return page.evaluate(async ({ r, c }) => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const sessions: any[] = await new Promise((resolve, reject) => {
      const req = db.transaction('sessions', 'readonly').objectStore('sessions').getAll();
      req.onsuccess = () => resolve(req.result as any[]);
      req.onerror = () => reject(req.error);
    });
    const s = sessions.sort((a, b) => b.startedAt - a.startedAt)[0];
    return s?.rows?.find((x: any) => x.index === r)?.values?.[c];
  }, { r: row, c: colId });
}

async function sttProfiles(page: Page): Promise<any[]> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const rec: any = await new Promise((resolve, reject) => {
      const req = db.transaction('kv', 'readonly').objectStore('kv').get('__stt_profiles__');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return rec ? Object.values(rec.profiles ?? {}) : [];
  });
}

test('유일 후보(횡경 49.5)는 묻지 않고 · 당도 「1.7」은 「1.7인가요, 8.7인가요…」 1회 → 「둘째」 → 8.7 재커밋 + 정정 쌍', async ({ page }) => {
  await setupAndStart(page);
  // 수집 배선: 세션 시작 메타에 화자 id — 미로그인 mock 환경이라 `anon`(로그인이면 이메일 sha256 앞 8자).
  expect(await sessionStartSpeaker(page)).toBe('anon');
  await fireStt(page, '49.5', 500);
  await waitForActiveChip(page, '당도');
  await waitForTtsIdle(page);
  const before = await ttsLog(page);
  expect(before.some((t) => t.includes('인가요')), `횡경 49.5에 질문이 났다: ${JSON.stringify(before)}`).toBe(false);
  expect(await eventsWithPrefix(page, 'stt_confusion_hint')).toEqual([]);

  await fireStt(page, '1.7', 600);
  await waitForTtsIdle(page);
  const asked = (await ttsLog(page)).filter((t) => t.startsWith('1.7인가요, 8.7인가요'));
  expect(asked, `확인 TTS 1회 — ttsLog=${JSON.stringify(await ttsLog(page))}`).toHaveLength(1);
  expect(asked[0].endsWith('?')).toBe(true);
  // 값은 이미 커밋돼 있다(민구 결정 ①) — 셀에 1.7이 서 있고 커서는 당도에 머문다(진행 안 함).
  await waitForActiveChip(page, '당도');
  expect(await cellValue(page, 1, 'c14')).toBe('1.7');
  // 묻는 순간엔 hint를 남기지 않는다(답이 정해진 뒤 1건).
  expect(await eventsWithPrefix(page, 'stt_confusion_hint')).toEqual([]);

  await fireStt(page, '둘째', 800);
  await waitForTtsIdle(page);
  await waitForActiveChip(page, '횡경'); // 2행으로 진행했다
  await page.waitForTimeout(500);
  expect(await cellValue(page, 1, 'c14')).toBe('8.7');
  const hints = await eventsWithPrefix(page, 'stt_confusion_hint');
  expect(hints).toHaveLength(1);
  expect(hints[0].extra).toBe('stt_confusion_hint:heard=1.7,cands=8.7|7.7,rule=L1P0:1>8|L1P0:1>7,asked=1,chosen=alt');
  const corrections = await eventsWithPrefix(page, 'stt_correction');
  expect(corrections.map((c) => c.extra)).toEqual(['stt_correction:from=1.7,to=8.7,path=confusion,text=1.7,conf=0.95,alt=-']);
  // 재커밋 value 이벤트는 previousValue=1.7을 싣는다(기존 판독 호환 — 원 STT text는 첫 커밋에 있다).
  const values = await valueEvents(page);
  expect(values.filter((v) => v.colId === 'c14').map((v) => [v.text, v.parsed, v.previousValue])).toEqual([['1.7', '1.7', undefined], ['둘째', '8.7', '1.7']]);
  // echo는 수정 의미론으로 새 값을 읽는다.
  expect((await ttsLog(page)).some((t) => t === '수정 당도 8.7')).toBe(true);
});

test('「네」(첫째) → 원값 유지·진행 + hint chosen=heard + 프로필 부정 사례 1', async ({ page }) => {
  await setupAndStart(page);
  await fireStt(page, '49.5', 500);
  await waitForActiveChip(page, '당도');
  await fireStt(page, '1.3', 600);
  await waitForTtsIdle(page);
  expect((await ttsLog(page)).filter((t) => t.startsWith('1.3인가요, 8.3인가요'))).toHaveLength(1);
  await fireStt(page, '네', 800);
  await waitForTtsIdle(page);
  await waitForActiveChip(page, '횡경');
  await page.waitForTimeout(500);
  expect(await cellValue(page, 1, 'c14')).toBe('1.3');
  const hints = await eventsWithPrefix(page, 'stt_confusion_hint');
  expect(hints.map((h) => h.extra)).toEqual(['stt_confusion_hint:heard=1.3,cands=8.3|7.3,rule=L1P0:1>8|L1P0:1>7,asked=1,chosen=heard']);
  expect(await eventsWithPrefix(page, 'stt_correction')).toEqual([]); // 원값 유지 — 정정이 아니다
  // 프로필: 「첫째」는 물었던 규칙의 분모만 올린다(negatives 1 · conf 증가 0).
  const profiles = await sttProfiles(page);
  expect(profiles, '마이크 획득 뒤 프로필이 선택돼 있어야 한다').toHaveLength(1);
  expect(profiles[0].negatives).toBe(1);
  expect(profiles[0].pairs).toBe(0);
  expect(profiles[0].table.byColumn['당도'].ctx.L1P0.seen['1']).toBeGreaterThanOrEqual(2); // 커밋 1 + 부정 1
  expect(profiles[0].table.byColumn['당도'].ctx.L1P0.conf['1']).toBeUndefined();
});

test('「아니오」 → 재청취 · 같은 셀의 두 번째 후보는 셀당 1회 상한으로 묻지 않는다(asked=0)', async ({ page }) => {
  await setupAndStart(page);
  await fireStt(page, '49.5', 500);
  await waitForActiveChip(page, '당도');
  await fireStt(page, '1.7', 600);
  await waitForTtsIdle(page);
  await fireStt(page, '아니오', 600);
  await waitForTtsIdle(page);
  expect((await ttsLog(page)).some((t) => t === '당도 다시 말씀해 주세요.')).toBe(true);
  await waitForActiveChip(page, '당도');
  // 다시 1.7로 들려도(같은 셀) 질문은 없다 — 수정 의미론 echo로 바로 진행.
  await fireStt(page, '1.7', 800);
  await waitForTtsIdle(page);
  await waitForActiveChip(page, '횡경');
  const log = await ttsLog(page);
  expect(log.filter((t) => t.includes('인가요'))).toHaveLength(1);
  expect(log.some((t) => t === '수정 당도 1.7')).toBe(true);
  const hints = await eventsWithPrefix(page, 'stt_confusion_hint');
  expect(hints.map((h) => h.extra)).toEqual([
    'stt_confusion_hint:heard=1.7,cands=8.7|7.7,rule=L1P0:1>8|L1P0:1>7,asked=1,chosen=respoken',
    'stt_confusion_hint:heard=1.7,cands=8.7|7.7,rule=L1P0:1>8|L1P0:1>7,asked=0,chosen=-',
  ]);
});

test('질문 대기 중 「다음」은 거부+안내([PHASE-NAV-1]) · 「확인」으로 해소하면 진행한다', async ({ page }) => {
  await setupAndStart(page);
  await fireStt(page, '49.5', 500);
  await waitForActiveChip(page, '당도');
  await fireStt(page, '1.7', 600);
  await waitForTtsIdle(page);
  await fireStt(page, '다음', 600);
  await waitForTtsIdle(page);
  expect((await ttsLog(page)).some((t) => t === '먼저 답해 주세요.')).toBe(true);
  await waitForActiveChip(page, '당도');
  const blocked = await eventsWithPrefix(page, 'field_nav_blocked');
  expect(blocked.map((b) => b.extra)).toEqual(['field_nav_blocked:confusionConfirm']);
  await fireStt(page, '확인', 800);
  await waitForTtsIdle(page);
  await waitForActiveChip(page, '횡경');
  expect(await cellValue(page, 1, 'c14')).toBe('1.7');
  expect((await eventsWithPrefix(page, 'stt_confusion_hint')).map((h) => h.extra)).toEqual(['stt_confusion_hint:heard=1.7,cands=8.7|7.7,rule=L1P0:1>8|L1P0:1>7,asked=1,chosen=heard']);
});
