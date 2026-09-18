/**
 * tests/v0550-auth-expiry.spec.ts — v0.55.0 B-4: 세션 중 로그인 만료 오라클.
 *
 * 이 스펙이 고정하는 문장:
 *  ⓪ 릴리스 게이트 목록 등재 자기단언
 *  ① (페이지 안 단위) ensurePastIndex() 호출 시 auth_lost_in_session:since=<초> 세션당 1회 방출
 *     - phase: active 상태에서 중복 호출 방어 (1회 가드)
 *     - sessionId 변경 시 새 세션으로 1회 방출
 *     - phase: ready 전환 시 추가 방출 없음
 *  ② (page.clock) 16초 간격 40회 호출 시 무인증 헛기록 백오프
 *     - 10s -> 30s -> 120s -> 300s 백오프로 5줄만 방출 (0·16·48·176·480초)
 *  ③ (실제 세션 e2e) 무인증 세션 중 auth_lost_in_session 방출 + 폴백 알람 정상 +
 *     세션 중 로그인 시도/TTS 0건 + 세션 종료 후 데이터 탭 진입 시 LoginRequiredModal 1회 노출
 *     + 다른 탭 이동 후 복귀 시 재노출 없음
 *  ④ ③과 동일하되 데이터 탭 진입 전 유효 토큰 주입 시 모달 없이 auth_lost_prompt:token_ok 방출
 */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Column } from '../src/types';
import { effectiveSampleKey } from '../src/lib/columnFlags';
import { buildPastIndex, resolveRoundCol } from '../src/lib/pastValuesIndex';
import { serializePastIndexEntry, type PersistedPastIndexRecord } from '../src/lib/pastValuesPersist';

import { installVoiceMocks, fireStt, waitForTtsIdle } from './fixtures/stt';
import { daysAgoLocal } from './fixtures/localDate';

test.setTimeout(60_000);

const ROOT = process.cwd();
const BASE = process.env.SURVEY_BASE_URL || 'http://localhost:5179';
const SHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
const PREV_ROUND = daysAgoLocal(1);

const COLUMNS: Column[] = [
  { id: 'c1', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'c3', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'c7', name: '조사과실', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 5 }, sampleKey: true },
  { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'increase' },
  { id: 'c9', name: '종경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, pctThreshold: 15 },
];

const SETTINGS = {
  state: {
    googleConnected: false,
    googleConnection: null, // B-4 ③: 세션 시작 선제 갱신이 안 돌게 null
    userEmail: 'tester@example.com',
    sheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`,
    sheetTab: 'Sheet1',
    columnsSheetId: SHEET_ID,
    columnsSheetTab: 'Sheet1',
    columns: COLUMNS,
    tableGenerated: true,
    totalRows: 10,
    ttsRate: 1.05,
    sessionLabelColId: null,
    sessionAutoLabel: 'expiry-test',
    noisyMode: false,
    speakerphoneMode: false,
    preferredVoiceName: '',
    roundDateColId: null,
  },
  version: 13,
};

const HEADERS = ['조사일자', '농가명', '조사나무', '조사과실', '횡경', '종경'];
const SHEET_ROWS = [
  [PREV_ROUND, '이원창', '1', '1', '100.0', '50.0'],
  [PREV_ROUND, '이원창', '1', '2', '110.0', '55.0'],
];

function computeFp(): string {
  return JSON.stringify([
    SHEET_ID,
    'Sheet1',
    null,
    COLUMNS.map((c) => [c.id, c.name.trim(), c.type, effectiveSampleKey(c)]),
  ]);
}

function buildRecord(builtAt: number): PersistedPastIndexRecord {
  const index = buildPastIndex(HEADERS, SHEET_ROWS, COLUMNS, resolveRoundCol(COLUMNS, null));
  return serializePastIndexEntry({ fp: computeFp(), builtAt, index });
}

async function seedAndBoot(
  page: Page,
  opts: { record?: PersistedPastIndexRecord },
) {
  await installVoiceMocks(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ settings }) => {
      localStorage.clear();
      localStorage.setItem('agri-voicenote-settings-v3', JSON.stringify(settings));
    },
    { settings: SETTINGS },
  );
  if (opts.record) {
    await page.evaluate(async (rec) => {
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        const req = indexedDB.open('agri-voicenote');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(rec, '__past_index__');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    }, opts.record as unknown as Record<string, unknown>);
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
}

async function goVoiceAndStart(page: Page) {
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(200);
  const startBtn = page.locator('text=음성 입력 시작').first();
  await expect(startBtn).toBeVisible();
  await startBtn.click();
  await page.waitForTimeout(800);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 5000 });
}

test('[node] ⓪-게이트 이 오라클이 릴리스 게이트 목록에 등재돼 있다 (v0.55.0)', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as {
    scripts: Record<string, string>;
  };
  const listed = (pkg.scripts['test:e2e:gate'] ?? '').split(/\s+/).filter((x) => x.startsWith('tests/'));
  expect(listed, 'tests/v0550-auth-expiry.spec.ts가 릴리스 게이트 목록에 없다').toContain('tests/v0550-auth-expiry.spec.ts');
});

test('① ensurePastIndex auth_lost_in_session 세션당 1회 방출 및 ready 국면 무방출 (단위)', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  // 토큰·API key 없음 · 시트·탭·이상치 규칙 있는 설정 세팅
  await page.evaluate(async (settings) => {
    localStorage.clear();
    const { useSettingsStore } = await import('/src/stores/settingsStore.ts');
    useSettingsStore.setState(settings.state as any);
  }, SETTINGS);

  // 1. 스토어를 phase: 'active', sessionId: 'sess_a', startedAt: Date.now() - 5000으로 설정
  await page.evaluate(async () => {
    const { useSessionStore } = await import('/src/stores/sessionStore.ts');
    const { logger } = await import('/src/lib/logger.ts');
    const { resetPastIndexRetries } = await import('/src/lib/pastValues.ts');
    logger.clear();
    resetPastIndexRetries();
    useSessionStore.setState({
      phase: 'active',
      sessionId: 'sess_a',
      startedAt: Date.now() - 5000,
    });
  });

  // ensurePastIndex() -> resetPastIndexRetries() -> ensurePastIndex()
  await page.evaluate(async () => {
    const { ensurePastIndex, resetPastIndexRetries } = await import('/src/lib/pastValues.ts');
    ensurePastIndex();
    await new Promise((r) => setTimeout(r, 50));
    resetPastIndexRetries();
    ensurePastIndex();
    await new Promise((r) => setTimeout(r, 50));
  });

  // 단언: auth_lost_in_session:since=5 정확히 1줄 · past_index_skip:not_signed_in 2줄
  const resA = await page.evaluate(async () => {
    const { logger } = await import('/src/lib/logger.ts');
    const all = logger.getAll();
    return {
      authLost: all.filter((e) => (e.extra ?? '').startsWith('auth_lost_in_session:')),
      authSkip: all.filter((e) => (e.extra ?? '').startsWith('past_index_skip:not_signed_in')),
    };
  });
  expect(resA.authLost).toHaveLength(1);
  expect(resA.authLost[0].extra).toBe('auth_lost_in_session:since=5');
  expect(resA.authSkip).toHaveLength(2);

  // 2. sessionId: 'sess_b'로 바꾸고 리셋·호출
  await page.evaluate(async () => {
    const { useSessionStore } = await import('/src/stores/sessionStore.ts');
    const { ensurePastIndex, resetPastIndexRetries } = await import('/src/lib/pastValues.ts');
    useSessionStore.setState({
      sessionId: 'sess_b',
      startedAt: Date.now() - 3000,
    });
    resetPastIndexRetries();
    ensurePastIndex();
    await new Promise((r) => setTimeout(r, 50));
  });

  // 단언: auth_lost_in_session: 총 2줄
  const resB = await page.evaluate(async () => {
    const { logger } = await import('/src/lib/logger.ts');
    return logger.getAll().filter((e) => (e.extra ?? '').startsWith('auth_lost_in_session:'));
  });
  expect(resB).toHaveLength(2);
  expect(resB[1].extra).toBe('auth_lost_in_session:since=3');

  // 3. phase: 'ready'로 바꾸고 리셋·호출
  await page.evaluate(async () => {
    const { useSessionStore } = await import('/src/stores/sessionStore.ts');
    const { ensurePastIndex, resetPastIndexRetries } = await import('/src/lib/pastValues.ts');
    useSessionStore.setState({
      phase: 'ready',
      sessionId: 'sess_c',
    });
    resetPastIndexRetries();
    ensurePastIndex();
    await new Promise((r) => setTimeout(r, 50));
  });

  // 단언: 늘지 않음 (총 2줄)
  const resReady = await page.evaluate(async () => {
    const { logger } = await import('/src/lib/logger.ts');
    return logger.getAll().filter((e) => (e.extra ?? '').startsWith('auth_lost_in_session:'));
  });
  expect(resReady).toHaveLength(2);
});

test('② page.clock — 16초 간격 40번 호출 시 무인증 헛기록 백오프 5줄 (0·16·48·176·480초)', async ({ page }) => {
  await page.clock.install();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  await page.evaluate(async (settings) => {
    localStorage.clear();
    const { useSettingsStore } = await import('/src/stores/settingsStore.ts');
    useSettingsStore.setState(settings.state as any);
  }, SETTINGS);

  await page.evaluate(async () => {
    const { resetPastIndexRetries } = await import('/src/lib/pastValues.ts');
    const { logger } = await import('/src/lib/logger.ts');
    logger.clear();
    resetPastIndexRetries();
  });

  // 16초 간격으로 ensurePastIndex() 40번 (0초, 16초, ... 624초)
  for (let i = 0; i < 40; i++) {
    await page.evaluate(async () => {
      const { ensurePastIndex } = await import('/src/lib/pastValues.ts');
      ensurePastIndex();
    });
    if (i < 39) {
      await page.clock.fastForward(16_000);
    }
  }

  const skips = await page.evaluate(async () => {
    const { logger } = await import('/src/lib/logger.ts');
    return logger.getAll().filter((e) => (e.extra ?? '').startsWith('past_index_skip:not_signed_in'));
  });
  expect(skips).toHaveLength(5);
});

test('③ 무인증 실제 세션 e2e — auth_lost_in_session 1줄 · 알람 정상 · 세션 중 로그인 방지 · 종료 후 모달 1회', async ({ page }) => {
  // 토큰 없음 · 연결 기록 없음 · 유효 폴백 시드
  await seedAndBoot(page, {
    record: buildRecord(Date.now() - 60_000),
  });

  // 세션 시작
  await goVoiceAndStart(page);

  // 페이지 안에서 resetPastIndexRetries() 한 번 (부팅 10초 백오프 리셋)
  await page.evaluate(async () => {
    const { resetPastIndexRetries } = await import('/src/lib/pastValues.ts');
    resetPastIndexRetries();
  });

  // 값 커밋 (직전 횡경 100.0에 비해 120.5 커밋 → 이상치 알람 유도)
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="voice-active-state"]');
    return el && el.textContent && el.textContent.includes('횡경');
  }, { timeout: 10_000 });
  await fireStt(page, '120.5');
  await waitForTtsIdle(page);

  // 알람 팝업 확인 및 확인 발화
  const popup = page.locator('[data-testid="anomaly-alert"]');
  await expect(popup).toBeVisible({ timeout: 5000 });
  await fireStt(page, '확인');
  await waitForTtsIdle(page);

  // 종경 커밋
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="voice-active-state"]');
    return el && el.textContent && el.textContent.includes('종경');
  }, { timeout: 10_000 });
  await fireStt(page, '55.0');
  await waitForTtsIdle(page);

  // 단언: auth_lost_in_session: 1줄
  const events = await page.evaluate(async () => {
    const { logger } = await import('/src/lib/logger.ts');
    return logger.getAll();
  });
  const authLostLogs = events.filter((e) => (e.extra ?? '').startsWith('auth_lost_in_session:'));
  expect(authLostLogs).toHaveLength(1);

  // 단언: 폴백 알람 정상 발생
  const alertLogs = events.filter((e) => (e.extra ?? '').startsWith('trend_alert_fired:'));
  expect(alertLogs.length, '폴백 알람이 1줄 이상 울려야 한다').toBeGreaterThanOrEqual(1);

  // 금지 단언: 세션 중 auth_signin_start 0줄, 로그인 관련 TTS 0건
  const signinStartLogs = events.filter((e) => (e.extra ?? '').startsWith('auth_signin_start'));
  expect(signinStartLogs).toHaveLength(0);

  const ttsLogs = events.filter((e) => e.type === 'tts' && ((e as any).ttsText ?? '').includes('로그인'));
  expect(ttsLogs).toHaveLength(0);

  // 세션 종료
  await page.locator('button[title="입력 종료"]').click();
  await page.locator('button[title="종료 확인"]').click();
  await page.waitForFunction(async () => {
    const { useSessionStore } = await import('/src/stores/sessionStore.ts');
    return useSessionStore.getState().phase === 'ready';
  }, { timeout: 15_000 });

  // 데이터 탭 클릭
  await page.locator('[data-testid="tab-data"]').click();

  // LoginRequiredModal + reason 문구 1회 확인
  const modalHeader = page.locator('text=로그인이 필요합니다');
  await expect(modalHeader).toBeVisible({ timeout: 5000 });
  await expect(page.locator('text=조사 중에 로그인이 만료됐습니다. 시트에 올리기 전에 다시 로그인하세요.')).toBeVisible();

  const shownLogs = await page.evaluate(async () => {
    const { logger } = await import('/src/lib/logger.ts');
    return logger.getAll().filter((e) => (e.extra ?? '') === 'auth_lost_prompt:shown');
  });
  expect(shownLogs).toHaveLength(1);

  // 닫고 다른 탭 갔다 다시 데이터 탭 -> 다시 안 뜬다
  await page.locator('button:has-text("닫기")').click();
  await expect(modalHeader).toHaveCount(0);

  await page.locator('[data-testid="tab-settings"]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-testid="tab-data"]').click();
  await page.waitForTimeout(500);
  await expect(modalHeader).toHaveCount(0);

  const shownLogsAfter = await page.evaluate(async () => {
    const { logger } = await import('/src/lib/logger.ts');
    return logger.getAll().filter((e) => (e.extra ?? '') === 'auth_lost_prompt:shown');
  });
  expect(shownLogsAfter).toHaveLength(1);
});

test('④ 무인증 세션 종료 후 데이터 탭 진입 전 토큰 주입 시 auth_lost_prompt:token_ok 방출 및 모달 없음', async ({ page }) => {
  await seedAndBoot(page, {
    record: buildRecord(Date.now() - 60_000),
  });

  await goVoiceAndStart(page);

  await page.evaluate(async () => {
    const { resetPastIndexRetries } = await import('/src/lib/pastValues.ts');
    resetPastIndexRetries();
  });

  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="voice-active-state"]');
    return el && el.textContent && el.textContent.includes('횡경');
  }, { timeout: 10_000 });
  await fireStt(page, '120.5');
  await waitForTtsIdle(page);

  const popup = page.locator('[data-testid="anomaly-alert"]');
  await expect(popup).toBeVisible({ timeout: 5000 });
  await fireStt(page, '확인');
  await waitForTtsIdle(page);

  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="voice-active-state"]');
    return el && el.textContent && el.textContent.includes('종경');
  }, { timeout: 10_000 });
  await fireStt(page, '55.0');
  await waitForTtsIdle(page);

  // 세션 종료
  await page.locator('button[title="입력 종료"]').click();
  await page.locator('button[title="종료 확인"]').click();
  await page.waitForFunction(async () => {
    const { useSessionStore } = await import('/src/stores/sessionStore.ts');
    return useSessionStore.getState().phase === 'ready';
  }, { timeout: 15_000 });

  // 데이터 탭 가기 전에 유효 토큰 주입
  await page.evaluate(() => {
    localStorage.setItem('gs10_google_token', JSON.stringify({
      access_token: 'valid-test-token',
      expires_at: Date.now() + 3600_000,
      email: 'tester@example.com',
    }));
  });

  // 데이터 탭 클릭
  await page.locator('[data-testid="tab-data"]').click();
  await page.waitForTimeout(500);

  // 모달 없음 단언
  const modalHeader = page.locator('text=로그인이 필요합니다');
  await expect(modalHeader).toHaveCount(0);

  // auth_lost_prompt:token_ok 1줄 단언
  const tokenOkLogs = await page.evaluate(async () => {
    const { logger } = await import('/src/lib/logger.ts');
    return logger.getAll().filter((e) => (e.extra ?? '') === 'auth_lost_prompt:token_ok');
  });
  expect(tokenOkLogs).toHaveLength(1);
  expect((tokenOkLogs[0] as any).sessionId).toBe('__app__');
});

test('⑤ 일시정지 중 데이터 탭 진입 시 로그인 팝업 및 프롬프트 로그 0 (isSessionLive paused 가드 잠금)', async ({ page }) => {
  await seedAndBoot(page, {
    record: buildRecord(Date.now() - 60_000),
  });

  await goVoiceAndStart(page);

  await page.evaluate(async () => {
    const { resetPastIndexRetries } = await import('/src/lib/pastValues.ts');
    resetPastIndexRetries();
  });

  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="voice-active-state"]');
    return el && el.textContent && el.textContent.includes('횡경');
  }, { timeout: 10_000 });
  await fireStt(page, '120.5');
  await waitForTtsIdle(page);

  const popup = page.locator('[data-testid="anomaly-alert"]');
  await expect(popup).toBeVisible({ timeout: 5000 });
  await fireStt(page, '확인');
  await waitForTtsIdle(page);

  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="voice-active-state"]');
    return el && el.textContent && el.textContent.includes('종경');
  }, { timeout: 10_000 });
  await fireStt(page, '55.0');
  await waitForTtsIdle(page);

  // auth_lost_in_session 1줄 확인
  const events = await page.evaluate(async () => {
    const { logger } = await import('/src/lib/logger.ts');
    return logger.getAll().filter((e) => (e.extra ?? '').startsWith('auth_lost_in_session:'));
  });
  expect(events).toHaveLength(1);

  // 일시정지 음성 명령
  await fireStt(page, '일시정지', 1000);
  await waitForTtsIdle(page);

  await page.waitForFunction(async () => {
    const { useSessionStore } = await import('/src/stores/sessionStore.ts');
    return useSessionStore.getState().phase === 'paused';
  }, { timeout: 15_000 });

  // 데이터 탭 클릭
  await page.locator('[data-testid="tab-data"]').click();
  await page.waitForTimeout(500);

  // 로그인이 필요합니다 0개
  await expect(page.locator('text=로그인이 필요합니다')).toHaveCount(0);

  // auth_lost_prompt: 로 시작하는 로그 0줄
  const promptLogs = await page.evaluate(async () => {
    const { logger } = await import('/src/lib/logger.ts');
    return logger.getAll().filter((e) => (e.extra ?? '').startsWith('auth_lost_prompt:'));
  });
  expect(promptLogs).toHaveLength(0);
});

test('⑥ 새 세션 시작 시 옛 세션 로그인 만료 표지 폐기 오라클 (consumeAuthLostPrompt curSid 검사 잠금)', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  // 무인증 설정 주입
  await page.evaluate(async (settings) => {
    localStorage.clear();
    const { useSettingsStore } = await import('/src/stores/settingsStore.ts');
    useSettingsStore.setState(settings.state as any);
  }, SETTINGS);

  // 스토어 active, sessionId: 'sess_a' -> ensurePastIndex() -> auth_lost_in_session 1줄
  await page.evaluate(async () => {
    const { useSessionStore } = await import('/src/stores/sessionStore.ts');
    const { logger } = await import('/src/lib/logger.ts');
    const { resetPastIndexRetries, ensurePastIndex } = await import('/src/lib/pastValues.ts');
    logger.clear();
    resetPastIndexRetries();
    useSessionStore.setState({
      phase: 'active',
      sessionId: 'sess_a',
      startedAt: Date.now() - 5000,
    });
    ensurePastIndex();
    await new Promise((r) => setTimeout(r, 50));
  });

  const authLost = await page.evaluate(async () => {
    const { logger } = await import('/src/lib/logger.ts');
    return logger.getAll().filter((e) => (e.extra ?? '').startsWith('auth_lost_in_session:'));
  });
  expect(authLost).toHaveLength(1);

  // 새 세션 sessionId: 'sess_b' (active 유지) -> 종료 phase: 'ready'
  await page.evaluate(async () => {
    const { useSessionStore } = await import('/src/stores/sessionStore.ts');
    useSessionStore.setState({
      sessionId: 'sess_b',
    });
    useSessionStore.setState({
      phase: 'ready',
    });
  });

  // 데이터 탭 클릭 후 대기
  await page.locator('[data-testid="tab-data"]').click();
  await page.waitForTimeout(500);

  // 창 0개 · auth_lost_prompt: 0줄 단언
  await expect(page.locator('text=로그인이 필요합니다')).toHaveCount(0);

  const promptLogs = await page.evaluate(async () => {
    const { logger } = await import('/src/lib/logger.ts');
    return logger.getAll().filter((e) => (e.extra ?? '').startsWith('auth_lost_prompt:'));
  });
  expect(promptLogs).toHaveLength(0);
});


