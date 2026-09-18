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
import { boot, PHONE_402, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, waitForTtsIdle } from './fixtures/stt';

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

test('K2 e2e — 시드 세션 11개(+올림 1개) 주입 후 실제 짧은 세션 종료 시 raw_pruned 1줄 및 해당 :raw만 정리', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  // 1. 오래된 세션 11개 시드 (sess_old_1: startedAt 100 ... sess_old_11: 1100)
  await page.evaluate(async () => {
    const { saveSession, saveAudioClip, loadAllAudioClipKeys, deleteAudioClip, saveRawUploadedRecord } = await import('/src/lib/db.ts');
    const existing = await loadAllAudioClipKeys();
    for (const k of existing) await deleteAudioClip(k);

    for (let i = 1; i <= 11; i++) {
      await saveSession({
        id: `sess_old_${i}`,
        date: '2026-09-18',
        startedAt: i * 100,
        completedRows: 1,
        syncedRows: 0,
        rows: [{ index: 1, values: { m1: '10' } }],
        columns: [{ id: 'm1', name: '측정1', input: 'voice' }],
      } as any);
    }

    // sess_old_1 (11개 중 가장 오래됨 & 올림): 본체 1개 + :raw 1개
    await saveAudioClip('sess_old_1:1:m1', new Blob(['main clip'], { type: 'audio/webm' }));
    await saveAudioClip('sess_old_1:1:m1:raw', new Blob(['raw clip'], { type: 'audio/webm' }));

    // sess_old_2 (오래됨 & 안 올림): :raw 1개
    await saveAudioClip('sess_old_2:1:m1:raw', new Blob(['raw clip 2'], { type: 'audio/webm' }));

    // 올림 기록에 sess_old_1만 등록
    await saveRawUploadedRecord({ ids: ['sess_old_1'] });
  });

  const MINI_COLUMNS = [
    { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
    { id: 'm1', name: '측정1', type: 'float', input: 'voice', ttsAnnounce: false, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  ];
  const MINI_SETTINGS = {
    ...AZ_SETTINGS,
    state: { ...AZ_SETTINGS.state, columns: MINI_COLUMNS, totalRows: 1 },
  };

  // 2. 실제 짧은 세션 시작 (boot)
  await boot(page, PHONE_402, {
    settings: MINI_SETTINGS as unknown as typeof AZ_SETTINGS,
  });
  await waitForTtsIdle(page);

  // 3. 바로 세션 종료
  await page.locator('button[title="입력 종료"]').click();
  await page.locator('button[title="종료 확인"]').click();
  await expect(page.locator('[data-testid="session-health-line"]')).toBeVisible({ timeout: 15_000 });

  // 4. 단언:
  // - raw_pruned 로그 1줄: sessions=1,clips=1
  // - sess_old_1:1:m1:raw는 삭제됨
  // - sess_old_1:1:m1 (본체)는 보존됨
  // - sess_old_2:1:m1:raw (안 올린 세션)은 보존됨
  const check = await page.evaluate(async () => {
    const { loadAllAudioClipKeys } = await import('/src/lib/db.ts');
    const { logger } = await import('/src/lib/logger.ts');
    const keys = await loadAllAudioClipKeys();
    const pruneLogs = logger.getAll().filter((e) => typeof e.extra === 'string' && e.extra.startsWith('raw_pruned:'));
    return { keys, pruneLogs };
  });

  expect(check.pruneLogs).toHaveLength(1);
  expect(check.pruneLogs[0].extra).toBe('raw_pruned:sessions=1,clips=1');
  expect(check.keys).toContain('sess_old_1:1:m1');
  expect(check.keys).not.toContain('sess_old_1:1:m1:raw');
  expect(check.keys).toContain('sess_old_2:1:m1:raw');
});

async function seedUploadSyncSession(page: any, sessId: string, withClip: boolean) {
  await page.evaluate(async ({ id, hasClip }) => {
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

    const { saveSession, saveAudioClip, loadAllAudioClipKeys, deleteAudioClip, saveRawUploadedRecord } = await import('/src/lib/db.ts');
    const existingKeys = await loadAllAudioClipKeys();
    for (const k of existingKeys) {
      await deleteAudioClip(k);
    }
    await saveRawUploadedRecord({ ids: [] });
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

    if (hasClip) {
      await saveAudioClip(`${id}:1:c2`, new Blob(['clip data'], { type: 'audio/webm' }));
    }
  }, { id: sessId, hasClip: withClip });
}

function routeSheetsSuccess(page: any) {
  return page.route('**://sheets.googleapis.com/**', async (route: any) => {
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
}

test('K1-a: Drive 백업 성공 + 클립 전부 읽힘 → raw_uploaded 기록됨', async ({ page }) => {
  await page.route('**://www.googleapis.com/**', (route) =>
    route.fulfill({ json: { id: 'stub-drive-file-id', files: [{ id: 'stub-drive-file-id' }] } })
  );
  await routeSheetsSuccess(page);

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const sessId = 'sess_upload_ok';
  await seedUploadSyncSession(page, sessId, true);

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

test('K1-b: Drive 백업 실패(user leg 실패) → raw_uploaded 기록 안 됨', async ({ page }) => {
  await page.route('**://www.googleapis.com/**', (route) =>
    route.fulfill({ status: 500, json: { error: 'drive error' } })
  );
  await routeSheetsSuccess(page);

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const sessId = 'sess_upload_drive_fail';
  await seedUploadSyncSession(page, sessId, true);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="tab-data"]').click();

  await page.getByText('시트에 추가').click();
  await page.locator('button:has-text("추가 (")').click();

  // 시트 업로드는 성공하나 로그 백업 경고 표시 대기
  await expect(page.locator('text=로그 백업 실패')).toBeVisible({ timeout: 15_000 });

  const uploadedIds = await page.evaluate(async () => {
    const { loadRawUploadedRecord } = await import('/src/lib/db.ts');
    const rec = await loadRawUploadedRecord();
    return (rec as any)?.ids ?? [];
  });
  expect(uploadedIds).not.toContain(sessId);
});

test('K1-c: 클립 1개 읽기 실패(get 가로채 throw) → 업로드 성공해도 raw_uploaded 기록 안 됨 + export_clips_* 로그 1줄', async ({ page }) => {
  await page.route('**://www.googleapis.com/**', (route) =>
    route.fulfill({ json: { id: 'stub-drive-file-id', files: [{ id: 'stub-drive-file-id' }] } })
  );
  await routeSheetsSuccess(page);

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const sessId = 'sess_upload_clip_fail';
  await seedUploadSyncSession(page, sessId, true);

  await page.reload({ waitUntil: 'domcontentloaded' });

  // 클립 get을 가로채 throw
  await page.evaluate(({ id }) => {
    const origGet = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (key: any) {
      if (this.name === 'audioClips' && typeof key === 'string' && key.startsWith(id)) {
        throw new Error('intercepted clip read error');
      }
      return origGet.apply(this, arguments as any);
    };
  }, { id: sessId });

  await page.locator('[data-testid="tab-data"]').click();

  await page.getByText('시트에 추가').click();
  await page.locator('button:has-text("추가 (")').click();

  // 동기화 완료 대기
  await expect(page.locator('text=로그 1/1 세션 백업')).toBeVisible({ timeout: 15_000 });

  // clipsComplete가 false이므로 raw_uploaded 에 기록되지 않아야 함
  const uploadedIds = await page.evaluate(async () => {
    const { loadRawUploadedRecord } = await import('/src/lib/db.ts');
    const rec = await loadRawUploadedRecord();
    return (rec as any)?.ids ?? [];
  });
  expect(uploadedIds).not.toContain(sessId);

  // export_clips_* 로그가 정확히 1줄 존재해야 함
  const exportClipsLogs = await page.evaluate(async () => {
    const { logger } = await import('/src/lib/logger.ts');
    return logger.getAll().filter((e) => typeof e.extra === 'string' && e.extra.startsWith('export_clips_'));
  });
  expect(exportClipsLogs).toHaveLength(1);
  expect(exportClipsLogs[0].extra).toContain('export_clips_failed');
});

test('H3 / K8 SessionCard 녹음 용량 표시 e2e (1.5MB / 0.0MB · 삭제 버튼 경로 · 셈 전 문구 · 실패 로깅)', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  const sessA = 'sess_size_a';
  const sessB = 'sess_size_b';
  const BYTES_A = 1_500_000; // 10진 1.5MB (2진이면 1.4MB)

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

    // sessA에만 1,500,000 바이트 클립 저장 (10진 1.5MB)
    await saveAudioClip(`${idA}:1:m1`, new Blob([new Uint8Array(sizeA)], { type: 'audio/webm' }));
  }, { idA: sessA, idB: sessB, sizeA: BYTES_A });

  // 셈 전 문구 '녹음 …' 확인을 위해 openCursor success 리스너를 게이트로 보류 (addInitScript로 reload 생존)
  await page.addInitScript(() => {
    let resume: (() => void) | null = null;
    (window as any).__cursorGate = new Promise<void>((res) => { resume = res; });
    (window as any).__releaseCursor = () => { resume?.(); (window as any).__cursorGate = null; };

    const origOpen = IDBObjectStore.prototype.openCursor;
    IDBObjectStore.prototype.openCursor = function (...args: any[]) {
      if (this.name === 'audioClips') {
        const failPattern = localStorage.getItem('__fail_open_cursor');
        if (failPattern) {
          const range = args[0] as IDBKeyRange;
          if (range && typeof range.lower === 'string' && range.lower.includes(failPattern)) {
            throw new Error('forced openCursor error for ' + failPattern);
          }
        }
        const req = origOpen.apply(this, args as any);
        const origAdd = req.addEventListener;
        req.addEventListener = function (type: string, listener: any, ...rest: any[]) {
          if (type === 'success') {
            const wrapped = async function (ev: any) {
              if ((window as any).__cursorGate) {
                await (window as any).__cursorGate;
              }
              listener.call(req, ev);
            };
            return origAdd.call(req, type, wrapped, ...rest);
          }
          return origAdd.call(req, type, listener, ...rest);
        };
        return req;
      }
      return origOpen.apply(this, args as any);
    };
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="tab-data"]').click();

  const cardA = page.locator(`[data-testid="session-clip-bytes-${sessA}"]`);
  const cardB = page.locator(`[data-testid="session-clip-bytes-${sessB}"]`);

  await expect(cardA).toBeVisible({ timeout: 10_000 });
  await expect(cardB).toBeVisible({ timeout: 10_000 });

  // 1. 셈 전 문구 단언: 게이트 보류 중 '녹음 …'
  await expect(cardA).toHaveText('녹음 …');

  // 게이트 해제 -> 집계 완료 유도
  await page.evaluate(() => { (window as any).__releaseCursor(); });

  // 2. 1,500,000 B -> 10진수 1.5MB 단언 (계산 완료 후)
  await expect(cardA).toHaveText('녹음 1.5MB', { timeout: 10_000 });
  await expect(cardB).toHaveText('녹음 0.0MB', { timeout: 10_000 });

  // 🔴 「표시 = 실제 저장 바이트」: 같은 페이지에서 sumSessionClipBytes를 불러 만든 문구와 같다
  const oracleTextA = await page.evaluate(async (id) => {
    const { sumSessionClipBytes } = await import('/src/lib/db.ts');
    const { total } = await sumSessionClipBytes(id);
    return `녹음 ${(total / 1_000_000).toFixed(1)}MB`;
  }, sessA);
  await expect(cardA).toHaveText(oracleTextA);

  // 3. 세션 B 삭제 (DB 직접이 아니라 UI 상의 '세션 삭제' 버튼 경로 사용)
  const deleteBtnB = page
    .locator(`[data-testid="session-clip-bytes-${sessB}"]`)
    .locator('xpath=ancestor::div[button[@title="세션 삭제"]][1]/button[@title="세션 삭제"]');
  await deleteBtnB.click();
  // 삭제 확인 모달의 '삭제' 버튼 클릭
  await page.locator('button:has-text("삭제")').click();

  // sessB 카드는 즉시 사라지고 sessA 카드는 reload 없이도 '녹음 1.5MB' 문구를 그대로 유지
  await expect(page.locator(`[data-testid="session-clip-bytes-${sessB}"]`)).toHaveCount(0);
  await expect(cardA).toBeVisible();
  await expect(cardA).toHaveText('녹음 1.5MB');

  // 4. 실패 시 clip_bytes_count_failed 로깅 및 카드 '녹음 …' 유지 검증
  await page.evaluate(async () => {
    localStorage.setItem('__fail_open_cursor', 'sess_err_test');
    const { saveSession } = await import('/src/lib/db.ts');
    await saveSession({
      id: 'sess_err_test',
      date: '2026-09-18',
      label: '에러 테스트',
      startedAt: 3000,
      completedRows: 1,
      syncedRows: 0,
      rows: [{ index: 1, values: { m1: '99' } }],
      columns: [{ id: 'm1', name: '측정1', input: 'voice' }],
    } as any);
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="tab-data"]').click();

  const cardErr = page.locator('[data-testid="session-clip-bytes-sess_err_test"]');
  await expect(cardErr).toBeVisible({ timeout: 10_000 });
  await expect(cardErr).toHaveText('녹음 …');

  const errorLogs = await page.evaluate(async () => {
    const { logger } = await import('/src/lib/logger.ts');
    return logger.getAll().filter((e) => (e.extra ?? '').startsWith('clip_bytes_count_failed:'));
  });
  expect(errorLogs.length, 'clip_bytes_count_failed 로그가 1줄 이상 남아야 함').toBeGreaterThanOrEqual(1);
});

test('L1 useSessionClipBytes 실제 세션(커밋 뒤 추가 셈 0 · 종료 뒤 1바퀴 · 카드 문구 = 실제 IDB 바이트)', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__audioClipsCursorCount = 0;
    const origOpenCursor = IDBObjectStore.prototype.openCursor;
    IDBObjectStore.prototype.openCursor = function (...args: any[]) {
      if (this.name === 'audioClips') {
        (window as any).__audioClipsCursorCount++;
      }
      return origOpenCursor.apply(this, args as any);
    };
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  const sessOld = 'sess_l1_old';
  await page.evaluate(async (oldId) => {
    localStorage.clear();
    const { saveSession } = await import('/src/lib/db.ts');
    await saveSession({
      id: oldId,
      date: '2026-09-18',
      label: '과거 세션',
      startedAt: 500,
      finishedAt: 600,
      completedRows: 1,
      syncedRows: 0,
      rows: [{ index: 1, values: { m1: '20' } }],
      columns: [{ id: 'm1', name: '측정1', input: 'voice' }],
    } as any);
  }, sessOld);

  // 1. 실제 음성 세션 시작 (boot)
  const MINI_COLUMNS = [
    { id: 'm1', name: '측정1', type: 'float', input: 'voice', ttsAnnounce: false, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  ];
  const MINI_SETTINGS = {
    ...AZ_SETTINGS,
    state: { ...AZ_SETTINGS.state, columns: MINI_COLUMNS, totalRows: 2 },
  };
  await boot(page, PHONE_402, {
    settings: MINI_SETTINGS as unknown as typeof AZ_SETTINGS,
  });
  await waitForTtsIdle(page);

  const liveSessionId = await page.evaluate(async () => {
    const { useSessionStore } = await import('/src/stores/sessionStore.ts');
    return useSessionStore.getState().sessionId;
  });
  expect(liveSessionId).toBeTruthy();

  // 첫 값 커밋 (세션이 dataStore에 등록됨)
  await fireStt(page, '10.0', 900);
  await waitForTtsIdle(page);

  // 2. 데이터 탭으로 이동 (세션은 백그라운드 keepalive로 계속 동작)
  await page.locator('[data-testid="tab-data"]').click();
  await expect(page.locator(`[data-testid="session-clip-bytes-${liveSessionId}"]`)).not.toHaveText('녹음 …', { timeout: 10_000 });
  await expect(page.locator(`[data-testid="session-clip-bytes-${sessOld}"]`)).not.toHaveText('녹음 …', { timeout: 10_000 });
  const initialCount = await page.evaluate(() => (window as any).__audioClipsCursorCount);

  // 3. 데이터 탭이 열린 채로 실제 값 커밋 (fireStt)
  await fireStt(page, '12.3', 900);
  await waitForTtsIdle(page);

  // 커밋으로 finishedAt이 찍혔지만 진행 중 세션이므로 추가 openCursor 호출은 0
  const midCount = await page.evaluate(() => (window as any).__audioClipsCursorCount);
  expect(midCount - initialCount, '진행 중 세션 커밋 시 추가 집계는 0이어야 함').toBe(0);

  // 4. 데이터 탭이 열린 채로 실제 세션 종료 (fireStt '종료')
  await fireStt(page, '종료', 1000);
  await waitForTtsIdle(page);
  await page.waitForFunction(async () => {
    const { useSessionStore } = await import('/src/stores/sessionStore.ts');
    return useSessionStore.getState().phase === 'ready';
  }, { timeout: 15_000 });

  // 세션이 실제 종료(phase === ready)되면 liveSessionId가 undefined로 넘어가 정확히 1바퀴(2개 세션) 다시 계산됨
  await page.waitForFunction(
    (expected) => (window as any).__audioClipsCursorCount >= expected,
    midCount + 2,
    { timeout: 10_000 }
  );
  const finalCount = await page.evaluate(() => (window as any).__audioClipsCursorCount);
  expect(finalCount - midCount, '세션 종료 시 정확히 1바퀴(2개 세션) 추가 집계되어야 함').toBe(2);

  // 5. 카드 문구 = 실제 IDB 바이트 검증
  const expectedText = await page.evaluate(async (sid) => {
    const { sumSessionClipBytes } = await import('/src/lib/db.ts');
    const { total } = await sumSessionClipBytes(sid);
    return `녹음 ${(total / 1_000_000).toFixed(1)}MB`;
  }, liveSessionId);
  await expect(page.locator(`[data-testid="session-clip-bytes-${liveSessionId}"]`)).toHaveText(expectedText);
});

