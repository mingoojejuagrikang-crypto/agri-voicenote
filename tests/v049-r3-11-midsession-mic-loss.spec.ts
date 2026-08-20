/**
 * v0.49 r3 #11 오라클 — **세션 중 스트림 소실 → 재연결** 경로의 e2e 복원(claude r2 MEDIUM).
 *
 * B3(`v023-voice.spec.ts`)는 재연결 UI를 재는 유일한 e2e였는데, v0.44.1 이후 **deny 스텁**으로
 * 옮겨 갔다 — gUM이 처음부터 거부되는 상태다. 그건 「권한이 없다」이지 「쓰던 마이크가 죽었다」가
 * 아니다. 실기기에서 실제로 나는 형태(블루투스 헤드셋 낙하 · 라우트 변경으로 트랙이 `ended`)는
 * **세션이 정상으로 돌던 도중**에 일어나고, 그 경로가 e2e에서 통째로 비어 있었다.
 *
 * 제품의 판정은 `AudioRecorder.isStreamLost()`(:290) — `track.readyState === 'ended'`다.
 * 그래서 이 스펙은 grant 스텁으로 정상 세션을 만든 뒤 **트랙만 죽이고**(fixtures/gum.ts가
 * `window.__lastFakeTrack`으로 노출), 다음 클립 콜백이 그 죽음을 관측하게 한다.
 *
 * ⚠️ **실측이 설계를 한 번 고쳤다.** 처음엔 "소실 → 배너"로 잡았는데 red가 났다. 로그를 보니
 * 경로는 정확히 돌았고(`mic_lost:clip_empty` → `mic_auto_reconnect:attempt` →
 * `mic_reconnect_ok`) **자동 1회 재연결이 성공해 배너가 뜨기 전에 사라진** 것이다(v0.38.0 계약).
 * 그래서 두 갈래로 나눠 잰다 — 그게 제품의 실제 계약이다:
 *
 *   ⓐ 정상 세션에는 배너가 없다(과잉 래치 금지 — ⓑⓒ가 공허하지 않다는 대조군)
 *   ⓑ 소실 + 자동 재연결 **성공** → 배너 없이 자가 복구(계측으로 경로 도달을 증명한다)
 *   ⓒ 소실 + 재획득 **거부**(헤드셋이 아예 사라진 형태) → 배너 노출 + 버튼 동작
 *
 * 쿨다운 표면 자체는 B3가 계속 잠근다 — 여기서 중복하지 않는다.
 *
 * 반증(트랙을 죽이지 않으면): ⓑ의 계측 단언과 ⓒ의 배너가 red.
 */

import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, waitForTtsIdle } from './fixtures/stt';

test.setTimeout(120_000);

const MINI_COLUMNS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 1 }, sampleKey: true },
  { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  { id: 'm2', name: '측정항목02', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  { id: 'm3', name: '측정항목03', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];
const MINI_SETTINGS = {
  ...AZ_SETTINGS,
  state: { ...AZ_SETTINGS.state, columns: MINI_COLUMNS, totalRows: 1, sessionAutoLabel: 'r3-11' },
};
const MINI_HEADERS = ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02', '측정항목03'];
const MINI_ROWS = [[PREV_ROUND, '이원창', '1', '100.0', '', '']];

const banner = (page: Page) => page.locator('[data-testid="mic-reconnect-btn"]');

/** clip/error 계열 로그의 `extra` 목록 — 「경로가 실제로 돌았는가」의 증명에 쓴다. */
async function clipEvents(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((r) => {
      const q = indexedDB.open('agri-voicenote');
      q.onsuccess = () => r(q.result);
    });
    const rows: { type?: string; extra?: string }[] = await new Promise((r) => {
      const q = db.transaction('logEvents', 'readonly').objectStore('logEvents').getAll();
      q.onsuccess = () => r(q.result as { type?: string; extra?: string }[]);
      q.onerror = () => r([]);
    });
    db.close();
    return rows.filter((e) => e.type === 'clip' || e.type === 'error').map((e) => String(e.extra ?? ''));
  });
}

async function bootMini(page: Page) {
  await boot(page, PHONE_402, {
    settings: MINI_SETTINGS as unknown as typeof AZ_SETTINGS,
    headers: MINI_HEADERS,
    sheetRows: MINI_ROWS,
  });
}

/** 실기기의 블루투스 낙하와 같은 표면: 쓰던 트랙이 `ended`가 된다(재획득은 하지 않는다). */
async function killStream(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const t = (window as unknown as { __lastFakeTrack?: { readyState: string } }).__lastFakeTrack;
    if (!t) return false;
    t.readyState = 'ended';
    return true;
  });
}

test('ⓐ 정상 세션에는 재연결 배너가 없다 — 과잉 래치 금지(ⓑ의 대조군)', async ({ page }) => {
  await bootMini(page);
  await fireStt(page, '11.1', 900);
  await waitForTtsIdle(page);
  await expect(banner(page), '멀쩡한 마이크에 재연결 배너가 떴다').toHaveCount(0);
});

test('ⓑ 세션 중 소실 → 자동 1회 재연결로 자가 복구한다(배너 없이) — 경로 도달을 계측으로 증명', async ({ page }) => {
  await bootMini(page);
  await fireStt(page, '11.1', 900);
  await waitForTtsIdle(page);
  await expect(banner(page), '전제: 아직 정상이다').toHaveCount(0);

  expect(await killStream(page), '전제: fake 트랙 핸들이 노출돼 있다').toBe(true);
  // 다음 커밋의 클립 종단이 스트림 상태를 관측한다(maybeAutoRecoverOrLatch → isStreamLost).
  // 🔴 v0.50: **커밋이 두 번 필요하다.** 픽스처가 실기기에 맞춰지면서(`fixtures/mediaRecorder.ts`)
  //    첫 커밋이 닫는 클립은 **트랙 사망 전에 시작돼 이미 조각을 받아 둔** 것이라 정상 저장된다
  //    — 실기기도 그렇다(그때까지 녹음분은 남는다). 사망 **이후에 시작된** 클립이라야 빈다.
  await fireStt(page, '22.2', 1500);
  await waitForTtsIdle(page);
  await fireStt(page, '33.3', 1500);
  await waitForTtsIdle(page);

  const evs = await clipEvents(page);
  expect(evs, '세션 중 소실이 관측되지 않았다 — 이 스펙이 재는 상태가 아니다')
    .toContain('mic_lost:clip_empty');
  expect(evs, '자동 1회 재연결이 시도되지 않았다').toContain('mic_auto_reconnect:attempt');
  expect(evs.join(' | '), '자동 재연결이 성공하지 못했다').toContain('mic_reconnect_ok');
  // 자가 복구했으면 사용자에게 배너를 들이밀지 않는다(v0.38.0 계약 — 소음 금지).
  await expect(banner(page), '자가 복구했는데 재연결 배너가 남았다').toHaveCount(0);
});

test('ⓒ 소실 + 재획득 거부 → 배너가 서고 그 자리에서 재연결 버튼이 동작한다', async ({ page }) => {
  await bootMini(page);
  await fireStt(page, '11.1', 900);
  await waitForTtsIdle(page);

  // 헤드셋이 아예 사라진 형태 — 트랙도 죽고 재획득도 거부된다(자동 1회가 실패해야 배너가 뜬다).
  expect(await killStream(page)).toBe(true);
  await page.evaluate(() => { (window as unknown as { __gumDeny?: boolean }).__gumDeny = true; });
  // 🔴 v0.50: ⓑ와 같은 이유로 커밋 2회 — 사망 이후에 시작된 클립이라야 빈다.
  await fireStt(page, '22.2', 1500);
  await waitForTtsIdle(page);
  await fireStt(page, '33.3', 1500);
  await expect(banner(page), '재획득까지 실패했는데 배너가 없다').toBeVisible({ timeout: 10000 });

  // 복구 진입로가 살아 있다. 여기서는 재획득을 다시 열어 준다(사용자가 헤드셋을 다시 켠 상황).
  await expect(banner(page)).toBeEnabled();
  await page.evaluate(() => { (window as unknown as { __gumDeny?: boolean }).__gumDeny = false; });
  await banner(page).click();
  // 🔴 재연결이 성공하면 배너는 **사라진다**(micLost=false → 언마운트). 종전 초안은 여기서
  //   `toBeDisabled()`를 봤다가 red가 났다 — 이 목 환경에선 재획득이 즉시 성공해 비활성 프레임이
  //   남지 않는다. 쿨다운 표면(비활성·"재연결 중…")은 B3가 deny 스텁에서 계속 잠그고, 여기서는
  //   **복구가 실제로 됐는가**를 잰다(그게 이 경로의 목적이다).
  await expect(banner(page), '재연결을 눌렀는데 배너가 남았다 — 복구가 안 됐다').toHaveCount(0, { timeout: 8000 });
  expect((await clipEvents(page)).join(' | '), '사용자 제스처 재연결이 성공 계측을 안 냈다')
    .toContain('mic_reconnect_ok');
});
