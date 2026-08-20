/**
 * v0.6.0 — "세션 복구" 2단계(기간 조회 + 세션 선택) e2e.
 *
 * Drive API 전체를 page.route로 stub(폴더 검색 → zip 목록(최신순) → zip alt=media). zip은 실제
 * exportLogZip 구조(sessions.json + clips/)로 Node JSZip 생성.
 *
 * 검증:
 *   1. 기간 칩 기본 30일 → "목록 조회" → 세션 체크리스트(이미 로컬에 있는 세션 회색·선택 불가
 *      "이미 있음", 구버전 zip 제외 개수) → "선택 복구" → "세션 K개(클립 M개) 복구됨".
 *   2. 기간 필터: "최근 7일"은 7일보다 오래된 zip을 조회 대상에서 제외(다운로드 0).
 *   3. 선택 복구: 체크 해제한 세션은 IDB에 저장되지 않는다.
 *
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다(수동 기동 불필요, [ORCH-27])
 */
import { test, expect, type Page } from '@playwright/test';
import { IDB, APPLY_APP_SCHEMA_SOURCE } from './fixtures/idb';
import JSZip from 'jszip';
import { BASE } from './baseUrl';

test.setTimeout(60_000);

const COLS = [
  { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 } },
  { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
];

function makeSession(id: string, date: string, label: string, startedAt: number) {
  return {
    id, date, label, columns: COLS,
    rows: [
      { index: 1, values: { c6: '1', c8: '35.1' }, complete: true, audioClips: { c8: `${id}:1:c8` } },
      { index: 2, values: { c6: '2', c8: '41.3' }, complete: true },
    ],
    completedRows: 2, syncedRows: 0, startedAt, finishedAt: startedAt + 600000,
  };
}

async function buildZip(sessions: unknown[], clipKeys: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('device.json', '{}');
  zip.file('events.json', '[]');
  zip.file('sessions.json', JSON.stringify({ schema: 1, appVersion: '0.6.0', sessions }));
  for (const k of clipKeys) zip.file(`clips/${k}.wav`, new Uint8Array([82, 73, 70, 70]));
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function buildLegacyZip(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('device.json', '{}');
  zip.file('clips/old:1:c8.webm', new Uint8Array([1, 2, 3]));
  return zip.generateAsync({ type: 'nodebuffer' });
}

// 기간 필터("최근 7일/30일")는 앱이 *실제 현재 시각* 기준으로 판정하므로, zip modifiedTime도 실제
// 현재 기준 상대값이어야 한다. 과거엔 고정 날짜(2026-06-11)라 시간이 흐르면 2~3일 전 zip이 실제론
// 9~10일 전이 되어 7일 필터에서 전부 빠지는 날짜 의존 결함이 있었다 → Date.now() 상대 주입으로 수정.
const NOW = Date.now();
const ISO = (daysAgo: number) => new Date(NOW - daysAgo * 86400_000).toISOString();

/** Drive stub. zip-recent(2일 전, 세션 2개) + zip-old(20일 전, 세션 1개) + zip-legacy(3일 전). */
async function stubDrive(page: Page): Promise<string[]> {
  const calls: string[] = [];
  const recentZip = await buildZip(
    [makeSession('s-recent-a', '2026-06-09', '최근A', NOW - 2 * 86400_000),
     makeSession('s-recent-b', '2026-06-09', '최근B', NOW - 2 * 86400_000)],
    ['s-recent-a:1:c8', 's-recent-b:1:c8'],
  );
  // s-old: startedAt 0 — isValidSession은 통과(유한 number)하지만 hh:mm 표시 가드(>0)는 막는
  // 경계 케이스. v0.7.0 B0의 "시각 없음 → 표시 생략" 경로 검증용.
  const oldZip = await buildZip(
    [makeSession('s-old', '2026-05-22', '오래된', 0)],
    ['s-old:1:c8'],
  );
  const legacyZip = await buildLegacyZip();

  await page.route('**://www.googleapis.com/**', async (route) => {
    const url = route.request().url();
    calls.push(url);
    const u = new URL(url);
    if (u.pathname === '/drive/v3/files' && u.searchParams.has('q')) {
      const q = u.searchParams.get('q') ?? '';
      if (q.includes("name='agri-voicenote'")) {
        await route.fulfill({ json: { files: [{ id: 'fld-app', createdTime: ISO(60) }] } }); return;
      }
      if (q.includes("name='log'")) {
        await route.fulfill({ json: { files: [{ id: 'fld-log', createdTime: ISO(60) }] } }); return;
      }
      if (q.includes("'fld-log' in parents")) {
        await route.fulfill({ json: { files: [
          { id: 'zip-recent', name: 'growth-log_recent.zip', createdTime: ISO(2) },
          { id: 'zip-legacy', name: 'growth-log_legacy.zip', createdTime: ISO(3) },
          { id: 'zip-old', name: 'growth-log_old.zip', createdTime: ISO(20) },
        ] } });
        return;
      }
      await route.fulfill({ json: { files: [] } }); return;
    }
    if (u.searchParams.get('alt') === 'media') {
      const id = u.pathname.split('/').pop();
      if (id === 'zip-recent') { await route.fulfill({ contentType: 'application/zip', body: recentZip }); return; }
      if (id === 'zip-old') { await route.fulfill({ contentType: 'application/zip', body: oldZip }); return; }
      if (id === 'zip-legacy') { await route.fulfill({ contentType: 'application/zip', body: legacyZip }); return; }
    }
    await route.fulfill({ status: 404, body: 'unexpected: ' + url });
  });
  return calls;
}

async function bootApp(page: Page, { localSession }: { localSession?: unknown } = {}) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async ({ sess, idb, schemaSrc }) => {
    localStorage.clear();
    // NOTE: do NOT deleteDatabase here — App.tsx already holds an open connection from page.goto,
    // so a delete blocks and then deadlocks the open below (onsuccess never fires). Each test runs
    // in a fresh browser context, so the DB starts empty anyway; we just seed the session.
    localStorage.setItem('gs10_google_token', JSON.stringify({
      access_token: 'test-token', expires_at: Date.now() + 3600_000, email: 'tester@example.com',
    }));
    if (sess) {
      await new Promise<void>((resolve) => {
        const applySchema = (0, eval)(`(${schemaSrc})`) as (db: IDBDatabase) => void;
        const open = indexedDB.open(idb.name, idb.version);
        open.onupgradeneeded = () => applySchema(open.result);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('sessions', 'readwrite');
          tx.objectStore('sessions').put(sess);
          tx.oncomplete = () => resolve(); tx.onerror = () => resolve();
        };
        open.onerror = () => resolve();
      });
    }
  }, { sess: localSession ?? null, idb: IDB, schemaSrc: APPLY_APP_SCHEMA_SOURCE });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-data"]').click();
  await page.waitForTimeout(300);
}

async function sessionIds(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result); r.onerror = () => res(null);
    });
    if (!db) return [];
    return new Promise<string[]>((res) => {
      const tx = db.transaction('sessions', 'readonly');
      const g = tx.objectStore('sessions').getAllKeys();
      g.onsuccess = () => res(g.result as string[]); g.onerror = () => res([]);
    });
  });
}

test('기본 30일 조회 → 체크리스트 → 선택 복구, 구버전 제외 집계', async ({ page }) => {
  await stubDrive(page);
  await bootApp(page);

  await page.locator('text=세션 복구').click();
  await page.waitForTimeout(400);
  // RecoverModal 오픈 + 기본 30일 칩 활성
  await expect(page.locator('text=Drive에서 세션 복구')).toBeVisible();

  await page.locator('button:has-text("목록 조회")').click();
  await page.waitForTimeout(800);

  // 최근/오래된 zip 모두 30일 내 → 세션 3개 노출, legacy 1개 제외 집계
  await expect(page.locator('text=최근A')).toBeVisible();
  await expect(page.locator('text=최근B')).toBeVisible();
  await expect(page.locator('text=오래된')).toBeVisible();
  await expect(page.locator('text=구버전 로그 1개 제외')).toBeVisible();

  // v0.7.0 B0 — 같은 날짜 세션 구분용 시작 시각(hh:mm). Node와 Chromium이 같은 시스템
  // 타임존을 쓰므로 기대값을 동일 포맷으로 계산해 비교한다.
  const expectedTime = new Date(NOW - 2 * 86400_000).toLocaleTimeString('ko-KR', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  await expect(page.locator('button', { hasText: '최근A' })).toContainText(`2행 · ${expectedTime}`);
  // startedAt이 0(시각 정보 없음)인 세션은 hh:mm을 표시하지 않는다.
  await expect(page.locator('button', { hasText: '오래된' })).not.toContainText(/\d{1,2}:\d{2}/);

  await page.locator('button:has-text("선택 복구")').click();
  await page.waitForTimeout(800);
  await expect(page.locator('text=복구됨')).toBeVisible();

  const ids = await sessionIds(page);
  expect(ids.sort()).toEqual(['s-old', 's-recent-a', 's-recent-b']);
});

test('기간 필터 최근 7일 → 20일 전 zip은 다운로드 제외', async ({ page }) => {
  const calls = await stubDrive(page);
  await bootApp(page);
  await page.locator('text=세션 복구').click();
  await page.waitForTimeout(400);

  await page.locator('button[role="radio"]:has-text("최근 7일")').click();
  await page.locator('button:has-text("목록 조회")').click();
  await page.waitForTimeout(800);

  // 7일 내 zip(recent 2일, legacy 3일)만 조회 → 오래된(20일) 세션 미노출
  await expect(page.locator('text=최근A')).toBeVisible();
  await expect(page.locator('text=오래된')).toHaveCount(0);
  // zip-old는 alt=media로 다운로드되지 않아야 함(기간 필터)
  expect(calls.some((c) => c.includes('zip-old') && c.includes('alt=media'))).toBe(false);
});

test('이미 로컬에 있는 세션은 회색·선택 불가, 선택 복구는 나머지만 저장', async ({ page }) => {
  await stubDrive(page);
  // s-recent-a를 이미 로컬에 보유
  await bootApp(page, { localSession: makeSession('s-recent-a', '2026-06-09', '최근A', NOW - 2 * 86400_000) });

  await page.locator('text=세션 복구').click();
  await page.waitForTimeout(400);
  await page.locator('button:has-text("목록 조회")').click();
  await page.waitForTimeout(800);

  // s-recent-a 행에 "이미 있음" 표기 + 비활성
  await expect(page.locator('text=이미 있음')).toBeVisible();

  await page.locator('button:has-text("선택 복구")').click();
  await page.waitForTimeout(800);

  const ids = await sessionIds(page);
  // 기존 s-recent-a + 신규 s-recent-b, s-old
  expect(ids.sort()).toEqual(['s-old', 's-recent-a', 's-recent-b']);
});
