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

test('G4 pruneOldRawClips e2e — 12세션 중 10세션 밖 올린 세션 1개의 :raw만 정리 · 최신 id 목록 제외 및 로그', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  const result = await page.evaluate(async () => {
    const {
      saveSession,
      saveAudioClip,
      loadAllAudioClipKeys,
      loadRawUploadedRecord,
    } = await import('/src/lib/db.ts');
    const {
      markRawUploaded,
      pruneOldRawClips,
    } = await import('/src/lib/rawRetention.ts');

    const makeBlob = (size: number) => new Blob([new Uint8Array(size)], { type: 'audio/webm' });

    // 12개 세션 저장 (시작 시각 서로 다름: sess_1이 가장 오래됨)
    for (let i = 1; i <= 12; i++) {
      await saveSession({
        id: `sess_${i}`,
        date: '2026-09-18',
        startedAt: i * 100,
        completedRows: 1,
        syncedRows: 0,
        rows: [{ index: 1, values: { m1: '10' } }],
        columns: [{ id: 'm1', name: '측정1', input: 'voice' }],
      } as any);
    }

    // 클립 저장:
    // sess_1 (오래됨 & 올림 대상): :raw 2개 + 본클립 1개
    await saveAudioClip('sess_1:1:m1', makeBlob(100));
    await saveAudioClip('sess_1:1:m1:raw', makeBlob(200));
    await saveAudioClip('sess_1:1:m1:cmd2:raw', makeBlob(150));

    // sess_2 (오래됨 & 안 올림): :raw 1개
    await saveAudioClip('sess_2:1:m1:raw', makeBlob(300));

    // sess_12 (최신 10 & 올림 대상 & justSavedId): :raw 1개
    await saveAudioClip('sess_12:1:m1:raw', makeBlob(400));

    // sess_1과 sess_12를 올림 기록에 등록
    await markRawUploaded(['sess_1', 'sess_12']);

    // pruneOldRawClips 실행 (방금 저장된 세션은 sess_12)
    await pruneOldRawClips('sess_12');

    const remainingKeys = await loadAllAudioClipKeys();
    const uploadedAfter = await loadRawUploadedRecord();

    // IDB logEvents에서 raw_pruned 로그 확인
    const db: IDBDatabase = await new Promise((res) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => res(req.result);
    });
    const logRows: { type?: string; extra?: string; sessionId?: string }[] = await new Promise((res) => {
      const req = db.transaction('logEvents', 'readonly').objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result as { type?: string; extra?: string; sessionId?: string }[]);
      req.onerror = () => res([]);
    });
    db.close();

    const rawPrunedLogs = logRows.filter((r) => (r.extra ?? '').startsWith('raw_pruned:'));

    return {
      remainingKeys: remainingKeys.sort(),
      uploadedAfter,
      rawPrunedLogs,
    };
  });

  // sess_1의 :raw 키 2개는 삭제되고, sess_1 본클립, sess_2:1:m1:raw, sess_12:1:m1:raw는 유지되어야 함
  expect(result.remainingKeys).toEqual([
    'sess_12:1:m1:raw',
    'sess_1:1:m1',
    'sess_2:1:m1:raw',
  ].sort());

  // 로그 검증: 정확히 1줄 raw_pruned:sessions=1,clips=2
  expect(result.rawPrunedLogs.length).toBe(1);
  expect(result.rawPrunedLogs[0].extra).toBe('raw_pruned:sessions=1,clips=2');
  expect(result.rawPrunedLogs[0].sessionId).toBe('__app__');
  expect(result.rawPrunedLogs[0].type).toBe('app');

  // 올림 기록에서 sess_12가 빠지고 sess_1만 남아 있어야 함
  expect(result.uploadedAfter).toEqual({ ids: ['sess_1'] });
});

test('G4 업로드 후 markRawUploaded 기록 e2e (stubNetwork)', async ({ page }) => {
  await page.route('**://www.googleapis.com/**', (route) =>
    route.fulfill({ json: { id: 'stub-drive-file-id', files: [{ id: 'stub-drive-file-id' }] } })
  );
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    const url = route.request().url();
    if (url.includes(':append')) {
      await route.fulfill({ json: { updates: { updatedRange: '농가!A11:B11', updatedRows: 1 } } });
      return;
    }
    if (url.includes(':batchUpdate')) {
      await route.fulfill({ json: { spreadsheetId: 'stub', totalUpdatedCells: 2 } });
      return;
    }
    await route.fulfill({ json: { values: [['농가명', '횡경']] } });
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  const sessId = 'sess_upload_test';
  await page.evaluate(async ({ id }) => {
    localStorage.clear();
    localStorage.setItem('gs10_google_token', JSON.stringify({
      access_token: 'valid-token', expires_at: Date.now() + 3_600_000, email: 'tester@example.com',
    }));
    localStorage.setItem('agri-voicenote-settings-v3', JSON.stringify({
      version: 13,
      state: {
        googleConnected: true, userEmail: 'tester@example.com',
        sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_ID/edit', sheetTab: '농가',
        columnsSheetId: 'SHEET_ID', columnsSheetTab: '농가',
        availableSheets: ['농가'],
        columns: [
          { id: 'c1', name: '농가명', type: 'text', input: 'auto', sampleKey: true, auto: { kind: 'fixed', value: '농가A' } },
          { id: 'c2', name: '횡경', type: 'float', input: 'voice', auto: { kind: 'fixed', value: '' }, decimals: 1 },
        ],
        tableGenerated: true, totalRows: 1,
      },
    }));

    const { saveSession } = await import('/src/lib/db.ts');
    await saveSession({
      id,
      date: '2026-09-18',
      label: '업로드 테스트',
      startedAt: Date.now(),
      target: { spreadsheetId: 'SHEET_ID', sheetTab: '농가' },
      columns: [
        { id: 'c1', name: '농가명', type: 'text', input: 'auto', sampleKey: true, auto: { kind: 'fixed', value: '농가A' } },
        { id: 'c2', name: '횡경', type: 'float', input: 'voice', auto: { kind: 'fixed', value: '' }, decimals: 1 },
      ],
      rows: [
        { index: 1, values: { c1: '농가A', c2: '35.1' }, complete: true },
      ],
      completedRows: 1,
      syncedRows: 0,
    } as any);
  }, { id: sessId });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="tab-data"]').click();

  await page.getByText('시트에 추가').click();
  await page.locator('button:has-text("추가 (")').click();

  await expect.poll(async () => {
    return page.evaluate(async () => {
      const { loadRawUploadedRecord } = await import('/src/lib/db.ts');
      const rec = await loadRawUploadedRecord();
      return (rec as any)?.ids ?? [];
    });
  }, { timeout: 15_000, message: 'markRawUploaded가 기록되지 않았다' }).toContain(sessId);
});

test('H3 SessionCard 녹음 용량 표시 e2e (1.2MB / 0.0MB · 삭제 후 유지 · sumSessionClipBytes 일치)', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  const sessA = 'sess_size_a';
  const sessB = 'sess_size_b';
  const BYTES_A = 1_234_567; // 1.2MB

  await page.evaluate(async ({ idA, idB, sizeA }) => {
    localStorage.clear();
    const { saveSession, saveAudioClip } = await import('/src/lib/db.ts');
    await saveSession({
      id: idA,
      date: '2026-09-18',
      label: '용량 테스트 A',
      startedAt: 1000,
      completedRows: 1,
      syncedRows: 0,
      rows: [{ index: 1, values: { m1: '10' } }],
      columns: [{ id: 'm1', name: '측정1', input: 'voice' }],
    } as any);

    await saveSession({
      id: idB,
      date: '2026-09-18',
      label: '용량 테스트 B',
      startedAt: 2000,
      completedRows: 1,
      syncedRows: 0,
      rows: [{ index: 1, values: { m1: '20' } }],
      columns: [{ id: 'm1', name: '측정1', input: 'voice' }],
    } as any);

    // sessA에만 1,234,567 바이트 클립 저장
    await saveAudioClip(`${idA}:1:m1`, new Blob([new Uint8Array(sizeA)], { type: 'audio/webm' }));
  }, { idA: sessA, idB: sessB, sizeA: BYTES_A });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="tab-data"]').click();

  const cardA = page.locator(`[data-testid="session-clip-bytes-${sessA}"]`);
  const cardB = page.locator(`[data-testid="session-clip-bytes-${sessB}"]`);

  await expect(cardA).toBeVisible({ timeout: 10_000 });
  await expect(cardB).toBeVisible({ timeout: 10_000 });

  await expect(cardA).toHaveText('녹음 1.2MB');
  await expect(cardB).toHaveText('녹음 0.0MB');

  // 🔴 「표시 = 실제 저장 바이트」: 같은 페이지에서 sumSessionClipBytes를 불러 만든 문구와 같다
  const oracleTextA = await page.evaluate(async (id) => {
    const { sumSessionClipBytes } = await import('/src/lib/db.ts');
    const { total } = await sumSessionClipBytes(id);
    return `녹음 ${(total / 1_000_000).toFixed(1)}MB`;
  }, sessA);
  await expect(cardA).toHaveText(oracleTextA);

  // 세션 B 삭제
  await page.evaluate(async (id) => {
    const { deleteSession } = await import('/src/lib/db.ts');
    await deleteSession(id);
  }, sessB);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="tab-data"]').click();

  // sessA 카드 문구 유지 검증
  await expect(page.locator(`[data-testid="session-clip-bytes-${sessA}"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="session-clip-bytes-${sessA}"]`)).toHaveText('녹음 1.2MB');
  await expect(page.locator(`[data-testid="session-clip-bytes-${sessB}"]`)).toHaveCount(0);
});

