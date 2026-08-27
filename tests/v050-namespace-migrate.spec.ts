/**
 * v0.50 개명 마이그레이션 계약 — `survey-011` → `agri-voicenote` (설계 v2 — 1회 스냅샷).
 * 정본 설계: namespaceMigrate.ts 머리주석 + 계획서 §8~§9.
 *
 * 왜 이 스펙이 필수인가: 민구 기기가 이 마이그레이션의 **유일한 실데이터**다. 여기서
 * 검증 안 하면 첫 실행이 곧 실전이 된다. 계약 (이중 콜드 리뷰 1회전 반영):
 *   T1 localStorage 구 설정키 복사 + **앱이 실제로 새 키에 다시 쓴다** — 값이 시드
 *      문자열에서 **달라져야** 통과(복사만으로 통과하던 v1 오라클을 codex #7이 기각)
 *   T2 tip-seen 키 복사
 *   T3 구 IDB 스냅샷(sessions·audioClips) + kv 특례는 **값 동일성**으로 + 🔴 구 DB 무삭제
 *   T4 기존 새 DB 레코드를 절대 덮지 않는다(per-key 부재 검사)
 *   T5 승계는 **1회다** — 마커 이후 legacy 추가분은 오지 않는다(낡은 스냅샷이 정본을
 *      오염시키지 않는다 — codex #2의 뒤집힌 보증)
 *   T6 새 DB에서 지운 레코드는 재부팅해도 **부활하지 않는다**(codex #1을 오라클로)
 *   T7 [node] 프리뷰 게이트 순수 함수 — `__PREVIEW_BUILD__`는 컴파일 상수라 브라우저로 못 잰다
 *   T8 초기화가 지운 tip-seen을 구 키가 부활시키지 않는다(localStorage 마커)
 *   T9 정식 첫 부팅은 구 키로 **덮어쓴다**(force 스냅샷) — 프리뷰가 남긴 새 키 값이
 *      전환 시점의 구 정식 설정을 가리지 않는다(codex 2회전 #3의 뒤집힌 보증)
 *
 * ⚠️ 구 DB 생성은 이름을 **인자로** 넘긴다 — idb-fixture 가드는 리터럴+버전 조합만 잡으므로
 * 이 스펙은 예외 목록 없이 통과한다(가드 주석 참조).
 */
import { test, expect, type Page } from '@playwright/test';
import { BASE } from './baseUrl';
import { IDB, APPLY_APP_SCHEMA_SOURCE } from './fixtures/idb';
import {
  LEGACY_DB_NAME, LEGACY_SETTINGS_KEY, LEGACY_TIP_SEEN_KEY, shouldMigrateIdb,
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

// 시드 JSON — T1이 「달라졌는가」를 재므로 문자열 원형을 상수로 쥔다.
// 🔑 inputSettingsDate를 과거로 심는 이유: 부팅 set()은 보장이 아니다(첫 강화판이 'not-yet'로
// 실측 반증). F28 날짜 변경 자동 초기화(settingsStore onRehydrateStorage)가 «스탬프 ≠ 오늘»에서
// set(inputSettingsResetPatch())를 **결정적으로** 부른다 — 그 재직렬화가 새 키에 착지하는지 잰다.
// sheetUrl은 F28 초기화의 명시적 보존 대상(민구 확정 08-02)이라 마커로 쓴다.
const SEED_SETTINGS = JSON.stringify({
  state: { sheetUrl: 'https://example.com/ns-t1-marker', inputSettingsDate: '2026-08-01' },
  version: 13,
});

test('T1+T2 localStorage — 구 키 복사 + 앱이 새 키에 실제로 다시 쓴다(강화 드리프트 가드)', async ({ page }) => {
  await page.addInitScript(({ lk, tk, seed }) => {
    if (localStorage.getItem('__ns_seeded') == null) {
      localStorage.setItem(lk, seed);
      localStorage.setItem(tk, '1');
      localStorage.setItem('__ns_seeded', '1');
    }
  }, { lk: LEGACY_SETTINGS_KEY, tk: LEGACY_TIP_SEEN_KEY, seed: SEED_SETTINGS });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  expect(await page.evaluate((k) => localStorage.getItem(k), NEW_TIP_SEEN_KEY)).toBe('1');
  // 🔴 구 키는 지우지 않는다 — 같은 origin의 구 정식(v0.48)이 아직 쓴다
  expect(await page.evaluate((k) => localStorage.getItem(k), LEGACY_SETTINGS_KEY)).not.toBeNull();

  // 🔴 강화 드리프트 가드(codex #7 소비) — 복사는 시드 «원형»을 놓지만, settingsStore가
  // 새 키에 실제로 persist하면 재직렬화로 필드가 늘어 **문자열이 달라진다.** 시드 값이
  // 유지되면서(마이그레이션 승계) 원형과는 달라야(앱이 새 키에 씀) 둘 다 증명된다.
  await expect.poll(async () => {
    const v = await page.evaluate((k) => localStorage.getItem(k), NEW_SETTINGS_KEY);
    if (v == null || v === SEED_SETTINGS) return 'not-yet';
    return v.includes('ns-t1-marker') ? 'rewritten-with-seed-value' : `seed-lost:${v.slice(0, 80)}`;
  }, { timeout: 15_000 }).toBe('rewritten-with-seed-value');
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
  // kv 특례 — 존재가 아니라 **값 동일성**(codex #7: 존재만 보면 특례가 삭제돼도 통과한다)
  const kv = await readNewDb(page, 'kv');
  const kvMap = new Map(kv.keys.map((k, i) => [k, kv.vals[i]]));
  expect(kvMap.get(NEW_SETTINGS_KEY), 'kv 특례 — 구 미러 값이 새 키로 그대로 복제돼야 한다')
    .toBe(kvMap.get(LEGACY_SETTINGS_KEY));
  // 🔴 무삭제 계약 — 구 DB가 그대로 있다
  const legacyAlive = await page.evaluate(async (name) => {
    const dbs = await indexedDB.databases();
    return dbs.some((d) => d.name === name);
  }, LEGACY_DB_NAME);
  expect(legacyAlive, '구 DB를 지우면 같은 origin의 구 정식(v0.48) 데이터를 지우는 것이다').toBe(true);

  // ── T5 1회성 — 마커 이후 legacy 추가분은 오지 않는다 ─────────────────────
  await seedLegacyDb(page, { sessions: [{ id: 'legacy-late', date: '2026-08-02' }] });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(async () => (await readNewDb(page, 'sessions')).vals
    .some((v) => (v as { id?: string }).id === 'legacy-A'), { timeout: 20_000 }).toBe(true);
  expect((await readNewDb(page, 'sessions')).vals.some((v) => (v as { id?: string }).id === 'legacy-late'),
    '승계는 1회다 — 마커 이후의 legacy 추가분이 오면 낡은 스냅샷이 계속 흘러들어온다(codex #2)').toBe(false);

  // ── T6 부활 없음 — 새 DB에서 지운 레코드가 재부팅에 되살아나지 않는다 ────
  await page.evaluate(async ({ name }) => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('sessions', 'readwrite');
      tx.objectStore('sessions').delete('legacy-A');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, { name: NEW_DB_NAME });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500); // 승계가 (잘못) 돌았다면 이 안에 부활한다
  expect((await readNewDb(page, 'sessions')).vals.some((v) => (v as { id?: string }).id === 'legacy-A'),
    '지운 레코드가 부활하면 삭제·업로드 완료가 무의미해진다(codex #1)').toBe(false);
});

test('T7 [node] 프리뷰 게이트 — 프리뷰 빌드는 IDB를 승계하지 않는다', () => {
  // __PREVIEW_BUILD__는 컴파일 상수라 브라우저 스펙으로 프리뷰 분기를 잴 수 없다 —
  // 판정을 순수 함수로 뽑아 여기서 잰다(namespaceMigrate 계약 2).
  expect(shouldMigrateIdb(true), '프리뷰는 관찰자다 — 새 DB를 먼저 채우면 정식 첫 부팅의 스냅샷이 낡는다').toBe(false);
  expect(shouldMigrateIdb(false)).toBe(true);
});

test('T8 localStorage 부활 방지 — 초기화가 지운 tip-seen을 구 키가 되살리지 않는다', async ({ page }) => {
  await page.addInitScript(({ tk }) => {
    if (localStorage.getItem('__ns_seeded') == null) {
      localStorage.setItem(tk, '1');
      localStorage.setItem('__ns_seeded', '1');
    }
  }, { tk: LEGACY_TIP_SEEN_KEY });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), NEW_TIP_SEEN_KEY)).toBe('1');
  // 초기화가 하는 일(useSettingsReset.ts): 새 tip-seen 키를 지운다
  await page.evaluate((k) => localStorage.removeItem(k), NEW_TIP_SEEN_KEY);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  expect(await page.evaluate((k) => localStorage.getItem(k), NEW_TIP_SEEN_KEY),
    '마커 없이 매 부팅 복사하면 사용자의 «지우기»가 구 키에 의해 계속 뒤집힌다').toBeNull();
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

test('T9 정식 첫 부팅 force 스냅샷 — 프리뷰가 남긴 새 키 값을 구 정식 설정이 이긴다', async ({ page }) => {
  const LEGACY_VAL = JSON.stringify({ state: { sheetUrl: 'https://example.com/from-old-prod' }, version: 12 });
  const PREVIEW_VAL = JSON.stringify({ state: { sheetUrl: 'https://example.com/from-preview' }, version: 12 });
  await page.addInitScript(({ lk, nk, lv, pv }) => {
    if (localStorage.getItem('__ns_seeded') == null) {
      localStorage.setItem(lk, lv);   // 구 정식이 쌓은 설정(전환 시점의 정본)
      localStorage.setItem(nk, pv);   // 프리뷰(관찰자)가 새 키에 남긴 흔적 — 마커는 없다
      localStorage.setItem('__ns_seeded', '1');
    }
  }, { lk: LEGACY_SETTINGS_KEY, nk: NEW_SETTINGS_KEY, lv: LEGACY_VAL, pv: PREVIEW_VAL });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  // dev 서버는 __PREVIEW_BUILD__=false = 정식 경로 — force 스냅샷이 프리뷰 흔적을 덮는다
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), NEW_SETTINGS_KEY))
    .toContain('from-old-prod');
});
