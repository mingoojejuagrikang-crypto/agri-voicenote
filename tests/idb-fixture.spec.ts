/**
 * [ENV-11] 가드 — 앱 DB 이름·버전 하드코딩 재유입 차단 (v0.35.1 Stage 1-5 신설, Node 러너).
 *
 * 규약(tests/fixtures/idb.ts가 SSOT):
 *  - 이미 부팅된 앱 DB에 시딩 → 버전 무지정 `indexedDB.open('agri-voicenote')`.
 *  - 부팅 전 시딩(스키마 필요) → fixture의 IDB/APPLY_APP_SCHEMA_SOURCE를 evaluate 인자로 주입.
 *  ⇒ 어느 spec도 "리터럴 DB명 + 버전 인자" 형태의 open을 다시 하드코딩해선 안 된다.
 *    (하드코딩이 남으면 DB_VERSION bump 때 전수 grep 갱신이 되살아난다 — [ENV-11] 재발.)
 */

import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DB_NAME, APP_STORE_NAMES, APPLY_APP_SCHEMA_SOURCE } from './fixtures/idb';
import { BASE } from './baseUrl';

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));

test('spec에 indexedDB.open 버전 하드코딩이 없다 (fixture 주입만 허용)', () => {
  const offenders: string[] = [];
  for (const f of readdirSync(TESTS_DIR)) {
    if (!f.endsWith('.spec.ts')) continue;
    const src = readFileSync(join(TESTS_DIR, f), 'utf8');
    // 문자열 리터럴 DB명 + 두 번째 인자 = 하드코딩(숫자 리터럴이든 로컬 상수든 — [ENV-11]
    // 재발 1회가 정확히 변수형이었다). 파일 전체를 스캔해 개행을 끼운 다중행 호출도 잡는다
    // (리뷰 라운드3 Codex Medium). 허용되는 버전 지정은 fixture 주입 식별자를 인자로 받은
    // open(<식별자>.name/…, <버전식별자>)뿐이고, 그 형태는 DB명이 리터럴이 아니라 안 걸린다.
    // v0.50 개명 — 구 이름 재유입도 함께 잡는다(마이그레이션 스펙만 예외 — 아래 allowlist).
    const re = /indexedDB\.open\(\s*['"`](?:agri-voicenote|survey-011)['"`]\s*,/g;
    for (const m of src.matchAll(re)) {
      const line = src.slice(0, m.index).split('\n').length;
      offenders.push(`${f}:${line}`);
    }
  }
  expect(offenders, `버전 하드코딩 발견 — tests/fixtures/idb.ts를 쓰세요: ${offenders.join(', ')}`).toEqual([]);
});

// ─── [ENV-3] 스키마 signature 가드 ───────────────────────────────────────────
// applyAppSchema는 이제 db.ts에서 재수출되는 진짜 SSOT(라운드3)라 미러 드리프트는 원천 불가하나,
// 이 가드는 계속 가치가 있다: ① 재수출 배선이 깨지거나 ② upgrade가 applyAppSchema 밖에서 스토어를
// 만들기 시작하거나 ③ toString() 주입이 실제 스키마와 다른 DB를 만들면 즉시 표면화한다.
test('픽스처 스키마 미러가 실제 앱 DB와 일치한다 (스토어 + keyPath/autoIncrement/인덱스 signature 대조)', async ({ page }) => {
  // signature = 스토어별 {keyPath, autoIncrement, indexNames}. 이름만 비교하면 인덱스·키 옵션
  // 드리프트를 놓친다(리뷰 라운드2 Codex Medium) — 옵션까지 문자열로 접어 비교한다.
  const signatureOf = (dbName: string) =>
    new Promise<string[]>((resolve, reject) => {
      const open = indexedDB.open(dbName); // 버전 무지정 — 기존 DB 그대로
      open.onsuccess = () => {
        const db = open.result;
        const sig = Array.from(db.objectStoreNames).sort().map((name) => {
          const tx = db.transaction(name, 'readonly');
          const s = tx.objectStore(name);
          const idx = Array.from(s.indexNames).sort().map((n) => {
            const ix = s.index(n);
            return `${n}(${JSON.stringify(ix.keyPath)},u=${ix.unique},m=${ix.multiEntry})`;
          }).join(',');
          return `${name}|keyPath=${JSON.stringify(s.keyPath)}|autoInc=${s.autoIncrement}|idx=${idx}`;
        });
        db.close();
        resolve(sig);
      };
      open.onerror = () => reject(open.error);
    });

  // ① 실제 앱이 만든 DB의 signature.
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800); // 앱 부팅 → getDb() upgrade 완료 대기
  const appSig = await page.evaluate(signatureOf, DB_NAME);
  expect(appSig.map((s) => s.split('|')[0])).toEqual([...APP_STORE_NAMES].sort());

  // ② 픽스처 미러(applyAppSchema)가 빈 DB에 만든 signature — 앱과 완전 일치해야 한다.
  const fixtureSig = await page.evaluate(
    ({ schemaSrc }) =>
      new Promise<string[]>((resolve, reject) => {
        const applySchema = (0, eval)(`(${schemaSrc})`) as (db: IDBDatabase) => void;
        const name = '__fixture_schema_probe__';
        const del = indexedDB.deleteDatabase(name);
        del.onsuccess = del.onerror = () => {
          const open = indexedDB.open(name, 1);
          open.onupgradeneeded = () => applySchema(open.result);
          open.onsuccess = () => {
            const db = open.result;
            const sig = Array.from(db.objectStoreNames).sort().map((n) => {
              const tx = db.transaction(n, 'readonly');
              const s = tx.objectStore(n);
              const idx = Array.from(s.indexNames).sort().map((iname) => {
                const ix = s.index(iname);
                return `${iname}(${JSON.stringify(ix.keyPath)},u=${ix.unique},m=${ix.multiEntry})`;
              }).join(',');
              return `${n}|keyPath=${JSON.stringify(s.keyPath)}|autoInc=${s.autoIncrement}|idx=${idx}`;
            });
            db.close();
            indexedDB.deleteDatabase(name);
            resolve(sig);
          };
          open.onerror = () => reject(open.error);
        };
      }),
    { schemaSrc: APPLY_APP_SCHEMA_SOURCE },
  );
  expect(fixtureSig).toEqual(appSig);
});
