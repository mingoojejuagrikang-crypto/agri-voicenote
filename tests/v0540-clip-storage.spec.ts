/**
 * tests/v0540-clip-storage.spec.ts — v0.54.0 R4 & R5 클립 저장 및 세션 용량 집계 오라클.
 *
 * 1. ⓪-게이트 이 오라클이 package.json의 test:e2e:gate 목록에 등재돼 있는지 단언.
 * 2. R4: deleteSession('sess_1') 호출 시 해당 세션의 audioClips(일반, raw, a<N>, cmd<N>)가 cascade 삭제되고,
 *    다른 세션(sess_10 등 접두 공유 세션)의 클립은 온전히 보존됨을 단언.
 * 3. R5: sumSessionClipBytes(sessionId)가 키 범위 커서로 audioClips를 순회하며
 *    total, raw, count를 정확히 집계하는지({buf, type} 레코드 및 구형 하위호환 Blob 레코드) 단언.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BASE } from './baseUrl';

test.setTimeout(60_000);

test('[node] ⓪-게이트 이 오라클이 릴리스 게이트 목록에 등재돼 있다 (v0.54.0)', () => {
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8')) as {
    scripts: Record<string, string>;
  };
  const listed = (pkg.scripts['test:e2e:gate'] ?? '').split(/\s+/).filter((x) => x.startsWith('tests/'));
  expect(listed, 'tests/v0540-clip-storage.spec.ts가 릴리스 게이트 목록에 없다').toContain('tests/v0540-clip-storage.spec.ts');
});

test('R4 세션 삭제 시 클립 cascade 삭제 및 R5 세션별 바이트 집계', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  const result = await page.evaluate(async () => {
    const {
      saveAudioClip,
      loadAllAudioClipKeys,
      deleteSession,
      sumSessionClipBytes,
    } = await import('/src/lib/db.ts');

    const makeBlob = (size: number) => new Blob([new Uint8Array(size)], { type: 'audio/webm' });

    // 1. sess_1에 키 5개, sess_10(접두 충돌 확인용)에 2개 저장 (크기가 서로 다른 바이트 배열)
    const clipsSess1: Record<string, number> = {
      'sess_1:1:c8': 10,
      'sess_1:1:c8:raw': 20,
      'sess_1:1:c8:a1': 30,
      'sess_1:1:c8:cmd2': 40,
      'sess_1:1:c8:cmd2:raw': 50,
    };
    for (const [key, size] of Object.entries(clipsSess1)) {
      await saveAudioClip(key, makeBlob(size));
    }

    const clipsSess10: Record<string, number> = {
      'sess_10:1:c8': 100,
      'sess_10:1:c8:raw': 200,
    };
    for (const [key, size] of Object.entries(clipsSess10)) {
      await saveAudioClip(key, makeBlob(size));
    }

    // 삭제 전 바이트 합계 단언용 실측
    // sess_1: total = 10 + 20 + 30 + 40 + 50 = 150, raw = 20 + 50 = 70, count = 5
    const sum1Before = await sumSessionClipBytes('sess_1');
    // sess_10: total = 100 + 200 = 300, raw = 200, count = 2
    const sum10Before = await sumSessionClipBytes('sess_10');

    // 2. deleteSession('sess_1') 실행
    await deleteSession('sess_1');

    // 삭제 후 키 목록 및 바이트 합계
    const remainingKeys = await loadAllAudioClipKeys();
    const sum1After = await sumSessionClipBytes('sess_1');
    const sum10After = await sumSessionClipBytes('sess_10');

    return {
      sum1Before,
      sum10Before,
      remainingKeys,
      sum1After,
      sum10After,
    };
  });

  // 삭제 전 sumSessionClipBytes 검증
  expect(result.sum1Before, 'sess_1 삭제 전 바이트 합계 일치').toEqual({ total: 150, raw: 70, count: 5 });
  expect(result.sum10Before, 'sess_10 바이트 합계 일치').toEqual({ total: 300, raw: 200, count: 2 });

  // R4: deleteSession('sess_1') 후 남은 키는 정확히 sess_10의 2개
  expect(result.remainingKeys.sort(), 'sess_1 키 5개는 모두 삭제되고 sess_10의 2개만 남아야 한다').toEqual(
    ['sess_10:1:c8', 'sess_10:1:c8:raw'].sort(),
  );

  // R5: 삭제 후 sess_1 합계는 0, sess_10은 그대로 유지
  expect(result.sum1After, 'sess_1 삭제 후 바이트 합계는 0').toEqual({ total: 0, raw: 0, count: 0 });
  expect(result.sum10After, 'sess_10 바이트 합계는 삭제 후에도 불변').toEqual({ total: 300, raw: 200, count: 2 });
});

test('R5 구형 Blob 직접 저장 레코드 1개도 blob.size로 정확히 집계', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  const result = await page.evaluate(async () => {
    // IDB에 직접 구형 Blob 레코드 1개 put (indexedDB.open 선례)
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    const legacyBlob = new Blob([new Uint8Array(65)], { type: 'audio/webm' });

    const tx = db.transaction('audioClips', 'readwrite');
    const store = tx.objectStore('audioClips');
    await new Promise<void>((resolve, reject) => {
      const req = store.put(legacyBlob, 'sess_legacy:1:c8');
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    const { sumSessionClipBytes } = await import('/src/lib/db.ts');
    return sumSessionClipBytes('sess_legacy');
  });

  // total = 65, raw = 0, count = 1
  expect(result, '구형 Blob 레코드 1개도 blob.size로 합산되어야 한다').toEqual({
    total: 65,
    raw: 0,
    count: 1,
  });
});
