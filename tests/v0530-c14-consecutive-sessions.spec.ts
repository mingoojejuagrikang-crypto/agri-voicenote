/**
 * v0.53.0 C14 e2e 오라클 (민구 Q1 ⓐ) — 같은 화면에서 연속 2세션 진행 시 시작 진단 로그 분리 및 보존.
 *
 * 결함 배경:
 *  `sessionIdRef`를 `''`로 리셋하지 않아, 같은 화면에서 두 번째 세션을 시작하면
 *  두 번째 세션의 시작 진단(`audio_unlock`·`start_ready`)이 직전 세션 id로 찍혀
 *  두 번째 세션의 zip에서 누락되고 첫 번째 세션 zip으로 새어 들어갔다.
 *
 * 이 스펙이 고정하는 문장:
 *  ① 같은 화면에서 연속 2세션 진행(탭 이동 없음).
 *  ② 둘째 세션 zip에 audio_unlock·start_ready 존재.
 *  ③ 첫 세션 zip에는 둘째 세션의 시작 진단이 들어가지 않음 (각각 정확히 1건).
 */
import { test, expect } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, waitForTtsIdle } from './fixtures/stt';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test.setTimeout(120_000);

const MINI_COLUMNS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 1 }, sampleKey: true },
  { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  { id: 'm2', name: '측정항목02', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];
const MINI_SETTINGS = {
  ...AZ_SETTINGS,
  state: { ...AZ_SETTINGS.state, columns: MINI_COLUMNS, totalRows: 1, sessionAutoLabel: 'c14-consec' },
};
const MINI_HEADERS = ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02'];
const MINI_ROWS = [[PREV_ROUND, '이원창', '1', '100.0', '']];

test('⓪-게이트 이 오라클이 릴리스 게이트 목록에 등재돼 있다 (v0.53.0)', () => {
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8')) as {
    scripts: Record<string, string>;
  };
  const listed = (pkg.scripts['test:e2e:gate'] ?? '').split(/\s+/).filter((x) => x.startsWith('tests/'));
  expect(listed, 'tests/v0530-c14-consecutive-sessions.spec.ts가 릴리스 게이트 목록에 없다').toContain('tests/v0530-c14-consecutive-sessions.spec.ts');
});

test('C14 — 같은 화면에서 연속 2세션 → 둘째 세션 zip에 audio_unlock·start_ready 존재 · 첫 세션에 둘째 세션 진단 누출 없음', async ({ page }) => {
  // 실제 프로덕션 동작: 마이크 정착 및 start_ready 방출 강제 (MOCK_INIT_SCRIPT의 true 덮어쓰기 방지)
  await page.addInitScript({
    content: `
      Object.defineProperty(window, '__micSettleSkipForTest', {
        get: () => false,
        set: () => {},
        configurable: true,
      });
    `,
  });

  // 1. 부팅 및 세션 1 시작
  await boot(page, PHONE_402, {
    settings: MINI_SETTINGS as unknown as typeof AZ_SETTINGS,
    headers: MINI_HEADERS,
    sheetRows: MINI_ROWS,
  });
  await waitForTtsIdle(page);

  // 세션 1 입력 및 종료
  await fireStt(page, '11.1', 900);
  await waitForTtsIdle(page);
  await page.locator('button[title="입력 종료"]').click();
  await page.locator('button[title="종료 확인"]').click();
  await expect(page.locator('text=음성 입력 시작').first()).toBeVisible({ timeout: 15_000 });

  // 2. 같은 화면(입력 탭 유지)에서 세션 2 시작
  const beforeSess2ClickTs = await page.evaluate(() => Date.now());
  await page.locator('text=음성 입력 시작').first().click();
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 10_000 });
  await waitForTtsIdle(page);

  // 세션 2 입력 및 종료
  await fireStt(page, '22.2', 900);
  await waitForTtsIdle(page);
  await page.locator('button[title="입력 종료"]').click();
  await page.locator('button[title="종료 확인"]').click();
  await expect(page.locator('text=음성 입력 시작').first()).toBeVisible({ timeout: 15_000 });

  // 3. IDB에서 세션 목록 읽기
  const sessions = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => res(req.result);
    });
    return new Promise<Array<{ id: string; startedAt: number; label?: string }>>((res) => {
      const req = db.transaction('sessions', 'readonly').objectStore('sessions').getAll();
      req.onsuccess = () => res(req.result);
    });
  });
  expect(sessions.length, '2개 세션이 생성되어 있어야 한다').toBe(2);
  sessions.sort((a, b) => a.startedAt - b.startedAt);
  const [sess1, sess2] = sessions;

  // 4. 데이터 탭 이동 후 내보내기 모달 열기
  await page.locator('[data-testid="tab-data"]').click();
  await page.getByRole('button', { name: /내보내기/ }).first().click();
  await expect(page.getByText('기기로 내보내기')).toBeVisible();

  // 5. 둘째 세션(sess2)만 선택하여 zip 다운로드
  // 전체 선택 해제 후 둘째 세션(c14-consec-2) 선택
  await page.getByRole('button', { name: /전체 선택/ }).click();
  await page.getByRole('button', { name: /c14-consec-2 0행/ }).click();

  const download2Promise = page.waitForEvent('download');
  await page.getByRole('button', { name: /사용자 로그/ }).last().click();
  const file2 = await download2Promise;
  const zip2 = await JSZip.loadAsync(readFileSync((await file2.path())!));
  const raw2 = await zip2.file('events.json')!.async('string');
  const evs2 = JSON.parse(raw2) as Array<{ sessionId?: string; extra?: string }>;
  const extras2 = evs2.map((e) => e.extra ?? '');

  // 완료 모달 닫기
  await page.getByRole('button', { name: '닫기' }).click();

  // 검증 ②: 둘째 세션 시작(beforeSess2ClickTs) 뒤 ts인 audio_unlock, start_ready가 zip2에 존재!
  const unlockInSess2 = evs2.filter((e) => (e.ts ?? 0) >= beforeSess2ClickTs && (e.extra ?? '').startsWith('audio_unlock:'));
  const readyInSess2 = evs2.filter((e) => (e.ts ?? 0) >= beforeSess2ClickTs && (e.extra ?? '').startsWith('start_ready:'));
  expect(unlockInSess2.length, '둘째 세션 시작 뒤 ts인 audio_unlock이 zip2에 있어야 한다').toBe(1);
  expect(readyInSess2.length, '둘째 세션 시작 뒤 ts인 start_ready가 zip2에 있어야 한다').toBe(1);

  // 6. 첫째 세션(sess1)만 선택하여 zip 다운로드
  await page.getByRole('button', { name: /내보내기/ }).first().click();
  await expect(page.getByText('기기로 내보내기')).toBeVisible();
  await page.getByRole('button', { name: /전체 선택/ }).click(); // 전체 선택 해제
  await page.getByRole('button', { name: /c14-consec 0행/ }).click(); // 첫 세션(c14-consec) 선택

  const download1Promise = page.waitForEvent('download');
  await page.getByRole('button', { name: /사용자 로그/ }).last().click();
  const file1 = await download1Promise;
  const zip1 = await JSZip.loadAsync(readFileSync((await file1.path())!));
  const raw1 = await zip1.file('events.json')!.async('string');
  const evs1 = JSON.parse(raw1) as Array<{ sessionId?: string; extra?: string }>;
  const extras1 = evs1.map((e) => e.extra ?? '');

  // 검증 ③: 첫째 세션 zip에는 둘째 세션의 진단 로그가 새어 들어가지 않아야 함 (각각 정확히 1건)
  const unlockInSess1 = extras1.filter((e) => e.startsWith('audio_unlock:'));
  const readyInSess1 = extras1.filter((e) => e.startsWith('start_ready:'));
  expect(unlockInSess1.length, '첫 세션 zip에 audio_unlock은 정확히 1건이어야 한다(둘째 세션 누출 없음)').toBe(1);
  expect(readyInSess1.length, '첫 세션 zip에 start_ready는 정확히 1건이어야 한다(둘째 세션 누출 없음)').toBe(1);
});
