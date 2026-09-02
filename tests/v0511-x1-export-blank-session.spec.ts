/**
 * v0.51.1 X1 e2e 오라클 (read-fb F6) — 세션 필터 zip에 **빈 sessionId 이벤트가 동봉**된다(zip 실물).
 *
 * 결함: 세션 시작 직전 진단(`audio_unlock`·`start_ready`·`notify_perm`)은 `sessionIdRef` 미배정 시점에
 * `sessionId:""`로 찍힌다. `exportLogZip(ids)`는 `[...ids, '__app__']`만 IDB에서 읽었고 `''`는 `null`이 아니라
 * 센티널도 안 붙어 **통째로 빠졌다** — 09-02 정식 4세션 zip 5개 전부 `audio_unlock 0 · start_ready 0`.
 *
 * 이 스펙이 고정하는 문장(술어 자체는 `exportLogEvents.spec.ts`가 Node에서 잰다 — 여기는 **배선**):
 *  ① 범위 세션 시작 직전의 `''` 이벤트 2건이 events.json에 있다.
 *  ② 창 밖(하루 전)의 `''` 이벤트는 없다 · 다른 `sess_*`는 여전히 없다 · `__app__`과 범위 세션 이벤트는 있다.
 *
 * 🔴 반증(2026-09-02 실측): `exportLog.ts`의 `loadLogEvents([...ids, APP_SENTINEL, ''])`에서 `''`를 빼면 ① red.
 * 하네스: fixtures/idb 스키마로 세션 1건 + 이벤트 6건을 심고, 데이터탭 「내보내기」→ 세션 선택 → 「사용자 로그」의
 * 다운로드를 받아 JSZip으로 연다(로그 LOG 버튼 경로 = `exportLogZip(ids)` 세션 필터 export).
 */
import { test, expect, type Page } from '@playwright/test';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import { IDB, APPLY_APP_SCHEMA_SOURCE } from './fixtures/idb';
import { BASE } from './baseUrl';

test.setTimeout(60_000);

const STORE_KEY = 'agri-voicenote-settings-v3';
const T0 = 1_788_300_000_000; // 세션 시작(epoch ms)
const SID = 'sess-x1';
const COLUMNS = [
  { id: 'c1', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, sampleKey: true, auto: { kind: 'fixed', value: 'X농가' } },
  { id: 'c2', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, sampleKey: false, auto: { kind: 'fixed', value: '' }, decimals: 1 },
];

function settings() {
  return {
    version: 13,
    state: {
      googleConnected: false, userEmail: null,
      sheetUrl: '', sheetTab: '', columnsSheetId: '', columnsSheetTab: '',
      availableSheets: [], savedSheets: [],
      columns: COLUMNS, tableGenerated: true, totalRows: 1, recognitionTolerance: 0.6,
    },
  };
}

function session() {
  return {
    id: SID, date: '2026-09-02', label: 'X1 세션',
    columns: COLUMNS,
    rows: [{ index: 1, values: { c1: 'X농가', c2: '35.1' }, complete: true }],
    completedRows: 1, syncedRows: 0, startedAt: T0, finishedAt: T0 + 10 * 60_000,
  };
}

/** 이벤트 6건 — `''` 창 안 2 · `''` 창 밖 1 · 범위 세션 1 · 다른 세션 1 · `__app__` 1. */
function events() {
  return [
    { ts: T0 - 2_000, type: 'app', sessionId: '', extra: 'audio_unlock:ctx=running,src=session_start' },
    { ts: T0 - 1_000, type: 'app', sessionId: '', extra: 'start_ready:audio=ok,mic=ok,tts=spoken,ms=1200' },
    { ts: T0 - 86_400_000, type: 'app', sessionId: '', extra: 'audio_unlock:ctx=stale,src=session_start' },
    { ts: T0, type: 'session', sessionId: SID, extra: 'start' },
    { ts: T0 + 5_000, type: 'value', sessionId: 'sess-other', extra: 'other_session_value' },
    { ts: T0 - 5_000, type: 'app', sessionId: '__app__', extra: 'app_boot' },
  ];
}

async function seedAndOpenData(page: Page): Promise<void> {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async ({ persisted, sess, evs, idb, schemaSrc, key }) => {
    localStorage.clear();
    localStorage.setItem(key, JSON.stringify(persisted));
    await new Promise<void>((resolve) => {
      const applySchema = (0, eval)(`(${schemaSrc})`) as (db: IDBDatabase) => void;
      const open = indexedDB.open(idb.name, idb.version);
      open.onupgradeneeded = () => applySchema(open.result);
      open.onsuccess = () => {
        const tx = open.result.transaction(['sessions', 'logEvents'], 'readwrite');
        tx.objectStore('sessions').put(sess);
        const logs = tx.objectStore('logEvents');
        for (const e of evs) logs.add(e);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      };
      open.onerror = () => resolve();
    });
  }, { persisted: settings(), sess: session(), evs: events(), idb: IDB, schemaSrc: APPLY_APP_SCHEMA_SOURCE, key: STORE_KEY });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="tab-data"]').click();
}

test('①② 세션 필터 zip — 시작 직전 `sessionId:""` 2건 동봉 · 창 밖 `""`·다른 sess_* 제외 · __app__·범위 세션 유지', async ({ page }) => {
  await seedAndOpenData(page);
  await page.getByRole('button', { name: /내보내기/ }).first().click();
  await expect(page.getByText('기기로 내보내기')).toBeVisible();
  // 내보내기 모달은 **기본 전체 선택**이다(ExportModal `useState(new Set(allIds))`) — 토글을 누르면 도리어 풀린다.
  await expect(page.getByRole('button', { name: /전체 선택 \(1\/1\)/ })).toBeVisible();
  const download = page.waitForEvent('download');
  // 데이터탭에도 「사용자 로그 내보내기」 버튼(title)이 있어 모달 뒤에서 먼저 잡힌다 — 모달은 DOM 끝에 뜨므로 last().
  await page.getByRole('button', { name: /사용자 로그/ }).last().click();
  const file = await download;
  const zip = await JSZip.loadAsync(readFileSync((await file.path())!));
  const raw = await zip.file('events.json')!.async('string');
  const evs = JSON.parse(raw) as Array<{ sessionId?: string; extra?: string }>;
  const extras = evs.map((e) => e.extra);

  // ① 시작 직전 진단 2건이 살아났다.
  expect(extras, 'audio_unlock(sessionId "")가 zip에서 여전히 빠진다').toContain('audio_unlock:ctx=running,src=session_start');
  expect(extras, 'start_ready(sessionId "")가 zip에서 여전히 빠진다').toContain('start_ready:audio=ok,mic=ok,tts=spoken,ms=1200');
  expect(evs.filter((e) => e.sessionId === '').length, '창 안의 "" 이벤트는 정확히 2건').toBe(2);
  // ② 창 밖·다른 세션은 없고, 종전 동봉 대상은 그대로다.
  expect(extras, '하루 전 "" 이벤트가 실렸다 — 창이 안 걸렸다').not.toContain('audio_unlock:ctx=stale,src=session_start');
  expect(extras, '다른 세션 이벤트가 새어 들어왔다').not.toContain('other_session_value');
  expect(extras).toContain('app_boot');
  expect(evs.some((e) => e.sessionId === SID && e.extra === 'start')).toBe(true);
  // sessions.json은 종전대로 동봉된다(순서 변경이 엔트리를 잃지 않았다).
  expect(zip.file('sessions.json'), 'sessions.json이 zip에서 사라졌다').not.toBeNull();
});
