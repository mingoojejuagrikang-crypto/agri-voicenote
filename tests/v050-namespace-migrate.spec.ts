/**
 * v0.50 개명 마이그레이션 계약 — `survey-011` → `agri-voicenote`.
 * 정본 설계: `~/workspace_teamops/plans/2026-08-20-rename-agri-voicenote.md` §8.
 *
 * 왜 이 스펙이 필수인가: 민구 기기가 이 마이그레이션의 **유일한 실데이터**다. 여기서
 * 검증 안 하면 첫 실행이 곧 실전이 된다. 계약 4개:
 *   T1 localStorage 구 설정키 → 새 키 복사 + **앱이 실제로 새 키에 쓴다**(드리프트 가드 —
 *      namespaceMigrate의 NEW_* 사본과 settingsStore 리터럴이 어긋나면 여기서 죽는다)
 *   T2 tip-seen 키 복사
 *   T3 구 IDB merge-by-absence(sessions·audioClips·kv 특례) + 🔴 **구 DB 무삭제**
 *   T4 기존 새 DB 레코드를 절대 덮지 않는다(merge-by-absence의 절반은 「absence」다)
 *
 * ⚠️ 구 DB 생성은 이름을 **인자로** 넘긴다 — idb-fixture 가드는 리터럴+버전 조합만 잡으므로
 * 이 스펙은 예외 목록 없이 통과한다(가드 주석 참조).
 */
import { test, expect, type Page } from '@playwright/test';
import { BASE } from './baseUrl';
import { IDB, APPLY_APP_SCHEMA_SOURCE } from './fixtures/idb';
import {
  LEGACY_DB_NAME, LEGACY_SETTINGS_KEY, LEGACY_TIP_SEEN_KEY,
} from '../src/lib/namespaceMigrate';

test.setTimeout(120_000);

// 🔴 새 키는 **의도적으로 리터럴**이다 — settingsStore·useSettingsReset의 실제 값과
// namespaceMigrate NEW_* 사본이 전부 일치하는지가 이 스펙의 검증 대상이라, 어느 한쪽을
// import하면 그 축의 드리프트를 놓친다.
const NEW_SETTINGS_KEY = 'agri-voicenote-settings-v3';
const NEW_TIP_SEEN_KEY = 'agri-voicenote-settings-tip-seen';
const NEW_DB_NAME = 'agri-voicenote';

/** 구(legacy) IDB를 앱 스키마 그대로 만들고 시딩한다 — 부팅 전 실행 필수. */
async function seedLegacyDb(page: Page, seed: {
  sessions?: Array<Record<string, unknown>>;
  clips?: Array<[string, unknown]>;
  kv?: Array<[string, string]>;
}) {
  await page.evaluate(async ({ name, version, schemaSrc, s }) => {
    const applySchema = (0, eval)(`(${schemaSrc})`) as (db: IDBDatabase) => void;
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const open = indexedDB.open(name, version);
      open.onupgradeneeded = () => applySchema(open.result);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['sessions', 'audioClips', 'kv'], 'readwrite');
      for (const sess of s.sessions ?? []) tx.objectStore('sessions').put(sess);
      for (const [k, v] of s.clips ?? []) tx.objectStore('audioClips').put(v, k);
      for (const [k, v] of s.kv ?? []) tx.objectStore('kv').put(v, k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, { name: LEGACY_DB_NAME, version: IDB.version, schemaSrc: APPLY_APP_SCHEMA_SOURCE, s: seed });
}

/** 새 DB에서 스토어 내용을 읽는다(버전 무지정 open — 부팅된 앱 DB 규약). */
async function readNewDb(page: Page, store: string) {
  return page.evaluate(async ({ name, st }) => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const tx = db.transaction(st, 'readonly');
    const [keys, vals] = await Promise.all([
      new Promise<unknown[]>((res, rej) => {
        const q = tx.objectStore(st).getAllKeys();
        q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
      }),
      new Promise<unknown[]>((res, rej) => {
        const q = tx.objectStore(st).getAll();
        q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
      }),
    ]);
    db.close();
    return { keys, vals };
  }, { name: NEW_DB_NAME, st: store });
}

test('T1+T2 localStorage — 구 키 복사 + 앱이 새 키에 실제로 쓴다(드리프트 가드)', async ({ page }) => {
  await page.addInitScript(({ lk, tk }) => {
    if (localStorage.getItem('__ns_seeded') == null) {
      localStorage.setItem(lk, JSON.stringify({ state: { chipSweepSeconds: 0 }, version: 12 }));
      localStorage.setItem(tk, '1');
      localStorage.setItem('__ns_seeded', '1');
    }
  }, { lk: LEGACY_SETTINGS_KEY, tk: LEGACY_TIP_SEEN_KEY });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  // 복사 — 마커 값이 새 키로 왔다
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), NEW_SETTINGS_KEY))
    .toContain('"chipSweepSeconds":0');
  expect(await page.evaluate((k) => localStorage.getItem(k), NEW_TIP_SEEN_KEY)).toBe('1');
  // 🔴 구 키는 지우지 않는다 — 같은 origin의 구 정식(v0.48)이 아직 쓴다
  expect(await page.evaluate((k) => localStorage.getItem(k), LEGACY_SETTINGS_KEY)).not.toBeNull();

  // 드리프트 가드 — 하이드레이션 후 persist 쓰기가 **새 키**로 나간다(부팅 초기 set()이
  // 반드시 있다 — settingsStorage.ts W2 주석). 값에 version 필드가 있어야 설정 persist다.
  await expect.poll(async () => {
    const v = await page.evaluate((k) => localStorage.getItem(k), NEW_SETTINGS_KEY);
    return v != null && v.includes('"version"');
  }).toBe(true);
});

test('T3 IDB — 구 DB merge(세션·클립·kv 특례) + 구 DB 무삭제', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' }); // 새 DB 골격 생성
  await seedLegacyDb(page, {
    sessions: [{ id: 'legacy-A', date: '2026-08-01', syncedRows: 0 }],
    clips: [['legacy-A:1:c8', { type: 'audio/wav', size: 64 }]],
    kv: [[LEGACY_SETTINGS_KEY, JSON.stringify({ state: {}, version: 12 })]],
  });
  await page.reload({ waitUntil: 'domcontentloaded' }); // 부팅 → getDb 체인에서 merge

  await expect.poll(async () => (await readNewDb(page, 'sessions')).vals
    .some((v) => (v as { id?: string }).id === 'legacy-A'), { timeout: 20_000 }).toBe(true);
  expect((await readNewDb(page, 'audioClips')).keys).toContain('legacy-A:1:c8');
  // kv 특례 — 구 미러가 **새 키로도** 복제돼 evict 부팅에서 mirroredStorage 복원이 찾는다
  const kv = await readNewDb(page, 'kv');
  expect(kv.keys).toContain(NEW_SETTINGS_KEY);
  // 🔴 무삭제 계약 — 구 DB가 그대로 있다
  const legacyAlive = await page.evaluate(async (name) => {
    const dbs = await indexedDB.databases();
    return dbs.some((d) => d.name === name);
  }, LEGACY_DB_NAME);
  expect(legacyAlive, '구 DB를 지우면 같은 origin의 구 정식(v0.48) 데이터를 지우는 것이다').toBe(true);
});

test('T4 merge-by-absence — 새 DB에 이미 있는 키는 절대 덮지 않는다', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  // 새 DB에 먼저 dup-1(신 값)을 넣는다
  await page.evaluate(async ({ name }) => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('sessions', 'readwrite');
      tx.objectStore('sessions').put({ id: 'dup-1', date: '2026-08-19', marker: 'new' });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, { name: NEW_DB_NAME });
  await seedLegacyDb(page, {
    sessions: [
      { id: 'dup-1', date: '2026-08-01', marker: 'old' },
      { id: 'legacy-only', date: '2026-08-01' },
    ],
  });
  await page.reload({ waitUntil: 'domcontentloaded' });

  await expect.poll(async () => (await readNewDb(page, 'sessions')).vals
    .some((v) => (v as { id?: string }).id === 'legacy-only'), { timeout: 20_000 }).toBe(true);
  const dup = (await readNewDb(page, 'sessions')).vals
    .find((v) => (v as { id?: string }).id === 'dup-1') as { marker?: string };
  expect(dup.marker, '새 쪽이 정본이다 — merge가 덮으면 최신 데이터가 과거로 되돌아간다').toBe('new');
});
