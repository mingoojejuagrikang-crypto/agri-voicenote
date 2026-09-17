/**
 * v0.53.0 A e2e 오라클 (민구 Q3 ⓐ · §3 D 1번).
 *
 * 이 스펙이 고정하는 문장:
 *  ① 짧은 세션 완료 시 세션 로그에 session_health 정확히 1줄 방출.
 *  ② 종료 화면에 data-testid="session-health-line" 문구가 렌더됨.
 *  ③ 새 세션 시작 시 그 줄이 사라짐 (resetAll 수명).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, waitForTtsIdle } from './fixtures/stt';

test.setTimeout(60_000);

test('⓪-게이트 이 오라클이 릴리스 게이트 목록에 등재돼 있다 (v0.53.0)', () => {
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8')) as {
    scripts: Record<string, string>;
  };
  const listed = (pkg.scripts['test:e2e:gate'] ?? '').split(/\s+/).filter((x) => x.startsWith('tests/'));
  expect(listed, 'tests/v0530-session-health.spec.ts가 릴리스 게이트 목록에 없다').toContain('tests/v0530-session-health.spec.ts');
});

const MINI_COLUMNS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 1 }, sampleKey: true },
  { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];
const MINI_SETTINGS = {
  ...AZ_SETTINGS,
  state: { ...AZ_SETTINGS.state, columns: MINI_COLUMNS, totalRows: 1, sessionAutoLabel: 'health-e2e' },
};
const MINI_HEADERS = ['조사일자', '농가명', '조사나무', '측정항목01'];
const MINI_ROWS = [[PREV_ROUND, '이원창', '1', '100.0']];

test('session_health — 세션 종료 시 정확히 1줄 방출 · 종료 화면 session-health-line 표면 · 새 세션 시작 시 정리', async ({ page }) => {
  // 1. 부팅 및 세션 시작
  await boot(page, PHONE_402, {
    settings: MINI_SETTINGS as unknown as typeof AZ_SETTINGS,
    headers: MINI_HEADERS,
    sheetRows: MINI_ROWS,
  });
  await waitForTtsIdle(page);

  // 1개 값 커밋 (cells=1)
  await fireStt(page, '11.1', 900);
  await waitForTtsIdle(page);

  // 세션 종료
  await page.locator('button[title="입력 종료"]').click();
  await page.locator('button[title="종료 확인"]').click();

  // 종료 화면 표면: session-health-line 표시 대기
  const healthLine = page.locator('[data-testid="session-health-line"]');
  await expect(healthLine, '종료 화면에 session-health-line이 표시되어야 한다').toBeVisible({ timeout: 15_000 });
  const healthText = await healthLine.innerText();
  expect(healthText).toBe('이번 세션 · 다시 묻기 0 · 고친 칸 0 · 알람 0');

  // IDB logEvents에서 session_health 로그 검증: 정확히 1줄
  const healthEvents = await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => res(req.result);
    });
    const rows: { type?: string; extra?: string }[] = await new Promise((res) => {
      const req = db.transaction('logEvents', 'readonly').objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result as { type?: string; extra?: string }[]);
      req.onerror = () => res([]);
    });
    db.close();
    return rows.filter((r) => r.type === 'session' && (r.extra ?? '').startsWith('session_health:'));
  });

  expect(healthEvents.length, 'session_health는 정확히 1줄이어야 한다').toBe(1);
  const ev = healthEvents[0];
  expect(ev.extra).toContain('session_health:cells=1,reask=0,lowconf=0,alarm=0/0');

  // 2. 새 세션 시작 시 session-health-line 사라짐 검증
  await page.locator('text=음성 입력 시작').first().click();
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 10_000 });
  await expect(healthLine, '새 세션이 시작되면 session-health-line이 사라져야 한다').not.toBeVisible();
});

