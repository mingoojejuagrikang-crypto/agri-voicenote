/**
 * v0.6.0 W8 e2e — "세션 복구" 2단계(기간 조회 + 세션 선택) RecoverModal 경유.
 *
 * (구 v0.5.0 무조건 전량 복구 → v0.6.0 모달 선택 복구로 플로우 변경. 핵심 계약은 유지:
 *  Drive zip의 sessions.json + clips/를 IDB로 복원, 클립 키 문자열 그대로 round-trip,
 *  실물 없는 클립 포인터는 재생 시 무해, 미로그인 시 Drive 호출 0회, 목록 조회 실패 graceful.)
 *
 * page.route로 Drive API 전체 stub: 폴더 검색 → zip 목록(최신순) → zip alt=media.
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다(수동 기동 불필요, [ORCH-27])
 */

import { test, expect, type Page } from '@playwright/test';
import JSZip from 'jszip';
import { BASE } from './baseUrl';

test.setTimeout(60_000);

const DRIVE_SESSION = {
  id: 'drv-s1',
  date: '2026-06-09',
  label: 'Drive복구',
  columns: [
    { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 } },
    { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
  ],
  rows: [
    { index: 1, values: { c6: '1', c8: '35.1' }, complete: true, audioClips: { c8: 'drv-s1:1:c8' } },
    // 행 2의 클립 포인터는 zip에 실물이 없음 → 복원 후 재생 버튼이 깨지지 않아야 한다 (엣지)
    { index: 2, values: { c6: '2', c8: '41.3' }, complete: true, audioClips: { c8: 'drv-s1:2:c8:raw' } },
  ],
  completedRows: 2,
  syncedRows: 0,
  startedAt: Date.parse('2026-06-09T01:00:00Z'),
  finishedAt: Date.parse('2026-06-09T01:10:00Z'),
};

async function buildSnapshotZip(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('device.json', '{}');
  zip.file('events.json', '[]');
  zip.file('sessions.json', JSON.stringify({ schema: 1, appVersion: '0.6.0', sessions: [DRIVE_SESSION] }));
  // 키 문자열 그대로 round-trip 검증용 — 행 1 클립만 실물 포함 (행 2 포인터는 의도적 누락)
  zip.file('clips/drv-s1:1:c8.wav', new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0]));
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function buildLegacyZip(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('device.json', '{}');
  zip.file('events.json', '[]');
  zip.file('clips/old-s9:1:c8.webm', new Uint8Array([1, 2, 3]));
  return zip.generateAsync({ type: 'nodebuffer' });
}

const NOW = Date.parse('2026-06-11T12:00:00Z');
const ISO = (daysAgo: number) => new Date(NOW - daysAgo * 86400_000).toISOString();

/** Drive API 전체 stub. 반환된 배열에 수신한 요청 URL이 쌓인다. */
async function stubDriveApi(page: Page, opts: { listFails?: boolean } = {}): Promise<string[]> {
  const calls: string[] = [];
  const snapshotZip = await buildSnapshotZip();
  const legacyZip = await buildLegacyZip();

  await page.route('**://www.googleapis.com/**', async (route) => {
    const url = route.request().url();
    calls.push(url);
    const u = new URL(url);

    if (u.pathname === '/drive/v3/files' && u.searchParams.has('q')) {
      const q = u.searchParams.get('q') ?? '';
      if (q.includes("name='agri-voicenote'")) {
        await route.fulfill({ json: { files: [{ id: 'fld-app', createdTime: ISO(60) }] } });
        return;
      }
      if (q.includes("name='log'")) {
        await route.fulfill({ json: { files: [{ id: 'fld-log', createdTime: ISO(60) }] } });
        return;
      }
      if (q.includes("'fld-log' in parents")) {
        if (opts.listFails) {
          await route.fulfill({ status: 500, body: 'backend boom' });
          return;
        }
        await route.fulfill({
          json: {
            files: [
              { id: 'zip-new', name: 'growth-log_2026-06-09_2.zip', createdTime: ISO(2) },
              { id: 'zip-legacy', name: 'growth-log_2026-06-05_1.zip', createdTime: ISO(6) },
            ],
          },
        });
        return;
      }
      await route.fulfill({ json: { files: [] } });
      return;
    }
    if (u.pathname === '/drive/v3/files/zip-new' && u.searchParams.get('alt') === 'media') {
      await route.fulfill({ contentType: 'application/zip', body: snapshotZip });
      return;
    }
    if (u.pathname === '/drive/v3/files/zip-legacy' && u.searchParams.get('alt') === 'media') {
      await route.fulfill({ contentType: 'application/zip', body: legacyZip });
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected drive call: ' + url });
  });
  return calls;
}

async function bootApp(page: Page, { signedIn }: { signedIn: boolean }) {
  // 2026-07-06 Sonar 데스크탑 재현 QA(C1) — 이 스펙의 zip fixture들은 NOW(고정 앵커) 기준
  // 상대 오프셋(ISO(n)일 전)으로 createdTime을 만드는데, 앱의 실제 필터(DataScreen.tsx의
  // `since = Date.now() - chip.days*86400_000`, recoverFromDrive.ts의 inRange)는 **실제
  // 벽시계 시각**을 본다. 시간이 흐르면 zip-legacy(ISO(6)="NOW"의 6일 전)가 실제 "최근 30일"
  // 창 밖으로 밀려나 W8(로그인 상태) 테스트가 결정론적으로 실패했다(회귀 아님, 테스트 픽스처
  // 드리프트). session-local-date.spec.ts와 동일한 패턴으로 페이지의 시계를 NOW에 고정해
  // fixture 앵커와 앱이 보는 "현재 시각"을 동기화한다 — 실행 시점과 무관하게 항상 통과.
  await page.clock.setFixedTime(new Date(NOW));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate((withToken) => {
    localStorage.clear();
    indexedDB.deleteDatabase('agri-voicenote');
    if (withToken) {
      localStorage.setItem('gs10_google_token', JSON.stringify({
        access_token: 'test-token',
        expires_at: Date.now() + 3600_000,
        email: 'tester@example.com',
      }));
    }
  }, signedIn);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-data"]').click();
  await page.waitForTimeout(300);
}

async function readIdb(page: Page, store: 'sessions' | 'audioClips') {
  return page.evaluate(async (st) => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db) return { keys: [] as string[], values: [] as unknown[] };
    return new Promise<{ keys: string[]; values: unknown[] }>((res) => {
      const tx = db.transaction(st, 'readonly');
      const os = tx.objectStore(st);
      const kReq = os.getAllKeys();
      const vReq = os.getAll();
      tx.oncomplete = () => res({ keys: kReq.result as string[], values: vReq.result as unknown[] });
      tx.onerror = () => res({ keys: [], values: [] });
    });
  }, store);
}

test('W8 — 로그인 상태: 모달 목록 조회 → 선택 복구, 클립 round-trip, 구버전 제외, 재생 버튼 무해', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (e) => pageErrors.push(e));
  await stubDriveApi(page);
  await bootApp(page, { signedIn: true });

  await page.locator('text=세션 복구').click();
  await page.waitForTimeout(400);
  await expect(page.locator('text=Drive에서 세션 복구')).toBeVisible();

  // 목록 조회(기본 30일 → 2일·6일 zip 모두 포함)
  await page.locator('button:has-text("목록 조회")').click();
  await page.waitForTimeout(800);
  await expect(page.locator('text=Drive복구')).toBeVisible();
  await expect(page.locator('text=구버전 로그 1개 제외')).toBeVisible();

  // 선택 복구 — 세션 1개/클립 1개(행 2 클립은 zip에 없음)
  await page.locator('button:has-text("선택 복구")').click();
  await page.waitForTimeout(800);
  await expect(page.locator('text=세션 1개(클립 1개) 복구됨')).toBeVisible();

  // 완료 후 모달 닫기 → 데이터탭에 카드 표시
  await page.locator('button:has-text("완료")').click();
  await page.waitForTimeout(300);
  await expect(page.locator('text=2026-06-09').first()).toBeVisible();

  // IDB round-trip: 세션 그대로 + 클립 키 문자열 그대로
  const sessions = await readIdb(page, 'sessions');
  expect((sessions.values as Array<{ id: string }>).map((s) => s.id)).toEqual(['drv-s1']);
  expect((sessions.values[0] as { rows: unknown[] }).rows).toHaveLength(2);
  const clips = await readIdb(page, 'audioClips');
  expect(clips.keys).toEqual(['drv-s1:1:c8']);

  // 카드 펼쳐 재생 버튼 확인 — 행 2의 클립은 IDB에 없음 → 눌러도 깨지지 않아야 함
  // v0.13.0 R5: 인라인 확장 → 상세 모달 / R4: 재생 버튼 title '음성 재생: <값>'으로 변경 → 접두 매칭
  await page.locator('text=2026-06-09').first().click();
  await page.waitForTimeout(400);
  const playButtons = page.locator('button[title^="음성 재생"]');
  expect(await playButtons.count()).toBe(2);
  await playButtons.nth(1).click();
  await page.waitForTimeout(600);
  await playButtons.nth(0).click();
  await page.waitForTimeout(600);
  expect(pageErrors).toEqual([]);
});

// ─── v0.19.0 W6 — 세션별 개별 zip(각 sessions.json 단일세션) 복구 호환 ──────────────
// W6에서 "시트에 추가" 백업이 1 통합 zip → 세션당 1 zip으로 바뀐다. listRecoverableSessionsFromDrive가
// N개의 단일세션 zip을 정상 파싱·열거(dedupe)하는지 직접 검증한다(brief 명시 안전망). 기존
// recover-list-stage는 1 zip에 2세션을 담는 형태라, 여기서는 "각 zip = 단일세션" W6 산출 형태를 쓴다.
function makeSingleSessionZipBuilder(sessionId: string, label: string, date: string) {
  return async (): Promise<Buffer> => {
    const zip = new JSZip();
    zip.file('device.json', '{}');
    zip.file('events.json', '[]');
    const session = {
      id: sessionId, date, label,
      columns: DRIVE_SESSION.columns,
      rows: [{ index: 1, values: { c6: '1', c8: '35.1' }, complete: true, audioClips: { c8: `${sessionId}:1:c8` } }],
      completedRows: 1, syncedRows: 0,
      startedAt: Date.parse(`${date}T01:00:00Z`), finishedAt: Date.parse(`${date}T01:05:00Z`),
    };
    // W6 파일명 컨벤션 검증: prefix growth-log_<date> + sessionId 포함(별도 zip 단위).
    zip.file('sessions.json', JSON.stringify({ schema: 1, appVersion: '0.19.0', sessions: [session] }));
    zip.file(`clips/${sessionId}:1:c8.wav`, new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0]));
    return zip.generateAsync({ type: 'nodebuffer' });
  };
}

test('W6 — N개 단일세션 zip 열거: 각 zip의 sessions.json(1세션)을 모두 파싱·dedupe', async ({ page }) => {
  const zipA = await makeSingleSessionZipBuilder('sess_aaa', '세션A', '2026-06-22')();
  const zipB = await makeSingleSessionZipBuilder('sess_bbb', '세션B', '2026-06-23')();

  await page.route('**://www.googleapis.com/**', async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/drive/v3/files' && u.searchParams.has('q')) {
      const q = u.searchParams.get('q') ?? '';
      if (q.includes("name='agri-voicenote'")) { await route.fulfill({ json: { files: [{ id: 'fld-app', createdTime: ISO(60) }] } }); return; }
      if (q.includes("name='log'")) { await route.fulfill({ json: { files: [{ id: 'fld-log', createdTime: ISO(60) }] } }); return; }
      if (q.includes("'fld-log' in parents")) {
        // W6 산출: 세션당 개별 zip(파일명에 sessionId 포함). 둘 다 30일 내.
        await route.fulfill({ json: { files: [
          { id: 'zip-a', name: 'growth-log_2026-06-22_sess_aaa_1.zip', createdTime: ISO(1) },
          { id: 'zip-b', name: 'growth-log_2026-06-23_sess_bbb_2.zip', createdTime: ISO(0) },
        ] } });
        return;
      }
      await route.fulfill({ json: { files: [] } }); return;
    }
    if (u.searchParams.get('alt') === 'media') {
      const id = u.pathname.split('/').pop();
      if (id === 'zip-a') { await route.fulfill({ contentType: 'application/zip', body: zipA }); return; }
      if (id === 'zip-b') { await route.fulfill({ contentType: 'application/zip', body: zipB }); return; }
    }
    await route.fulfill({ status: 404, body: 'unexpected: ' + route.request().url() });
  });

  await bootApp(page, { signedIn: true });
  await page.locator('text=세션 복구').click();
  await page.waitForTimeout(400);
  await page.locator('button:has-text("목록 조회")').click();
  await page.waitForTimeout(800);

  // 두 단일세션 zip의 세션이 모두 열거돼야 한다(개별 zip → 1세션씩 병합).
  await expect(page.locator('text=세션A')).toBeVisible();
  await expect(page.locator('text=세션B')).toBeVisible();

  // 선택 복구 → 두 세션 모두 IDB에 저장.
  await page.locator('button:has-text("선택 복구")').click();
  await page.waitForTimeout(800);
  await page.locator('button:has-text("완료")').click();
  await page.waitForTimeout(300);

  const sessions = await readIdb(page, 'sessions');
  const ids = (sessions.values as Array<{ id: string }>).map((s) => s.id).sort();
  expect(ids).toEqual(['sess_aaa', 'sess_bbb']);
});

test('W8 — 미로그인: Drive 호출 0회 + 로그인 필요 팝업(복구 모달 미오픈)', async ({ page }) => {
  const calls = await stubDriveApi(page);
  await bootApp(page, { signedIn: false });

  await page.locator('text=세션 복구').click();
  await page.waitForTimeout(400);
  // v0.20.0 Phase 2 — 미로그인 시 안내 텍스트 대신 범용 LoginRequiredModal을 띄운다(시트 동기화·
  // Drive 백업·복구 공용). 재로그인 성공 시 Drive 복구 모달을 이어서 연다(graceful resume).
  const loginModal = page.locator('[role="dialog"][aria-labelledby="login-required-title"]');
  await expect(loginModal).toBeVisible({ timeout: 10_000 });
  await expect(loginModal).toContainText('로그인이 필요합니다');
  await expect(loginModal).toContainText('Drive');
  await expect(page.locator('text=Drive에서 세션 복구')).toHaveCount(0); // 복구 모달은 아직 미오픈
  expect(calls.filter((c) => c.includes('/drive/'))).toEqual([]); // Drive 호출 0회 유지
});

test('W8 — 목록 조회 실패(서버 오류): 모달 내 graceful 실패 메시지', async ({ page }) => {
  await stubDriveApi(page, { listFails: true });
  await bootApp(page, { signedIn: true });

  await page.locator('text=세션 복구').click();
  await page.waitForTimeout(400);
  await page.locator('button:has-text("목록 조회")').click();
  await page.waitForTimeout(800);
  await expect(page.locator('text=Drive 목록 조회 실패')).toBeVisible({ timeout: 15_000 });
});
