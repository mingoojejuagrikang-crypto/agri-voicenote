/**
 * v0.44.0 §C8 F13·F18 오라클 — red-first (민구 확정 2026-08-02)
 *
 * F13 — '다음'은 '이전'과 대칭인 **항상 +1 이동**이다.
 *   - 완료 행 건너뛰기(findNextIncompleteRow) 제거: 실기기 로그 실측에서 '다음'의 jump delta가
 *     +2·+4로 튀던 원인. 이 spec은 **모든 jump delta가 ±1**임을 고정한다(+2를 만들면 red).
 *   - v0.5.0 NAV-1 무한루프 방지의 대체 계약 = **마지막 행에서 멈춤**(전진 없음 → wrap-around
 *     불가 → 완료 행 재프롬프트 루프 구조적 불가). 완료 행 착지는 검토 대기(reviewWait)가 받는다.
 *   - skip 개념(값 없이 지나간 행 = placeholder)은 유지된다 — 실제로 행을 떠날 때만 마킹.
 *
 * F18 — 마이크 권한 요청 시점 = **'음성 입력 시작' 버튼 클릭**.
 *   ① 입력탭 진입 시 getUserMedia 0회(종전 v0.25.0 WS-2 prewarm 폐지).
 *   ② 클릭 후 정확히 1회.
 *   ③ 승인 → **1초 정착 지연** 후 화면 전환(민구 원문: "바로 음성 입력 화면 전환시 일부 초기
 *      음성 클립 생성이 안됨" — 1초는 그 방어).
 *   ④ 테스트 픽스처 우회(window.__micSettleSkipForTest)는 **이 spec이 오라클로 고정**한다
 *      (조용한 우회 금지 — 심이 사라지면 여기서 red).
 *
 * Mock: fixtures/stt(installVoiceMocks·fireStt·ttsLog). F18만 getUserMedia 스텁(승인 경로)을 얹는다.
 */

import { test, expect, type Page } from '@playwright/test';
import { MEDIA_RECORDER_STUB_SCRIPT } from './fixtures/mediaRecorder';
import { installVoiceMocks, fireStt, ttsLog, waitForTtsIdle } from './fixtures/stt';
import { BASE } from './baseUrl';
import { reviewWaitAbsorbTts } from '../src/lib/voicePrompts';

test.setTimeout(120_000);

const STORE_KEY = 'agri-voicenote-settings-v3';

/** F13용 5행 테이블 — 완료/미완료가 섞인 중간 구간(2~4행)을 만들 수 있는 최소 크기. */
function settingsRows(totalRows: number, label: string) {
  return {
    state: {
      googleConnected: false,
      userEmail: null,
      sheet: null,
      sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_C8_1/edit',
      sheetTab: 'Sheet1',
      columnsSheetId: 'SHEET_C8_1',
      columnsSheetTab: 'Sheet1',
      availableSheets: [],
      manualMode: false,
      columns: [
        { id: 'c6', name: '조사나무', type: 'int',   input: 'auto',  ttsAnnounce: true,  auto: { kind: 'seq', from: 1, to: totalRows } },
        { id: 'c8', name: '횡경',     type: 'float', input: 'voice', ttsAnnounce: true,  auto: { kind: 'fixed', value: '' }, decimals: 1 },
        { id: 'c9', name: '종경',     type: 'float', input: 'voice', ttsAnnounce: true,  auto: { kind: 'fixed', value: '' }, decimals: 1 },
      ],
      tableGenerated: true,
      totalRows,
      ttsRate: 1.05,
      sessionLabelColId: null,
      sessionAutoLabel: label,
      noisyMode: false,
      preferredVoiceName: '',
    },
    version: 13,
  };
}

async function seedAndOpenVoiceTab(page: Page, settings: object) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ s, storeKey }) => {
      localStorage.clear();
      localStorage.setItem(storeKey, JSON.stringify(s));
      indexedDB.deleteDatabase('agri-voicenote');
    },
    { s: settings, storeKey: STORE_KEY },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(300);
}

async function clickStart(page: Page) {
  const startBtn = page.locator('text=음성 입력 시작').first();
  await expect(startBtn).toBeVisible();
  await startBtn.click();
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 6000 });
  await page.waitForTimeout(400);
}

async function waitForActiveChip(page: Page, colName: string, timeout = 5000) {
  await page.waitForFunction(
    (name) => {
      const chip = document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
      return (chip?.dataset.colName ?? '').includes(String(name));
    },
    colName,
    { timeout },
  ).catch(() => {});
}

async function waitForRow(page: Page, targetRow: number, totalRows: number, timeout = 6000) {
  await page.waitForFunction(
    ({ r, total }) => {
      const m = document.body.innerText.match(new RegExp('(\\d+)\\s*\\/\\s*' + total + '\\s*행'));
      return m ? parseInt(m[1]) === r : false;
    },
    { r: targetRow, total: totalRows },
    { timeout },
  ).catch(() => {});
}

async function getActiveRow(page: Page, totalRows: number): Promise<number> {
  const text = await page.evaluate(() => document.body.innerText);
  const m = text.match(new RegExp('(\\d+)\\s*\\/\\s*' + totalRows + '\\s*행'));
  return m ? parseInt(m[1]) : -1;
}

/** 안내 TTS 체인이 끝나(awaiting 무장 완료) 값/명령이 dispatch 가능해진 뒤에 발화한다.
 *  fixtures/stt의 onend는 비동기(200ms)라, 행 전환 직후 바로 쏘면 handleFinal의
 *  `if (!awaiting) return` 게이트에 떨어져 발화가 조용히 유실된다. */
async function speakWhenArmed(page: Page, text: string, waitMs = 400) {
  await waitForTtsIdle(page);
  await fireStt(page, text, waitMs);
}

async function loadLogEventsFromIDB(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db || !db.objectStoreNames.contains('logEvents')) return [];
    return new Promise<Array<{ type: string; parsed?: string; extra?: string; ttsText?: string }>>((res) => {
      const tx = db.transaction('logEvents', 'readonly');
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result as Array<{ type: string; parsed?: string; extra?: string; ttsText?: string }>);
      req.onerror = () => res([]);
    });
  });
}

async function loadSessionsFromIDB(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db) return [];
    return new Promise<object[]>((res) => {
      const tx = db.transaction('sessions', 'readonly');
      const req = tx.objectStore('sessions').getAll();
      req.onsuccess = () => res(req.result as object[]);
      req.onerror = () => res([]);
    });
  });
}

/** 지금까지 기록된 jump 이벤트의 (from,to) 목록 — extra 형식 `<source>:<from>-><to>` (v0.33.0 B-1). */
async function jumpDeltas(page: Page): Promise<Array<{ from: number; to: number }>> {
  const events = await loadLogEventsFromIDB(page);
  return events
    .filter((e) => e.type === 'command' && e.parsed === 'jump')
    .map((e) => {
      const m = (e.extra ?? '').match(/^(?:voice|touch):(\d+)->(\d+)$/);
      return m ? { from: parseInt(m[1]), to: parseInt(m[2]) } : null;
    })
    .filter((x): x is { from: number; to: number } => x !== null);
}

// ─── F13 ────────────────────────────────────────────────────────────────────

test('F13 — "다음"은 완료 행을 건너뛰지 않는다: jump delta 전 구간 ±1', async ({ page }) => {
  const TOTAL = 5;
  await page.addInitScript({ content: GUM_GRANT_SCRIPT }); // M7 [TEST-GUM-1]
  await installVoiceMocks(page);
  await seedAndOpenVoiceTab(page, settingsRows(TOTAL, 'c8-f13-delta'));
  await clickStart(page);

  // 행 1·2 완료 → 행 3 진입.
  await waitForActiveChip(page, '횡경');
  await speakWhenArmed(page, '35.1', 300);
  await waitForActiveChip(page, '종경');
  await speakWhenArmed(page, '28.3', 500);
  await waitForRow(page, 2, TOTAL);
  await waitForActiveChip(page, '횡경');
  await speakWhenArmed(page, '36.2', 300);
  await waitForActiveChip(page, '종경');
  await speakWhenArmed(page, '29.4', 500);
  await waitForRow(page, 3, TOTAL);
  expect(await getActiveRow(page, TOTAL)).toBe(3);

  // '이전' ×2 → 행 1(완료, 검토 대기).
  await speakWhenArmed(page, '이전행', 700);
  await waitForRow(page, 2, TOTAL);
  await speakWhenArmed(page, '이전행', 700);
  await waitForRow(page, 1, TOTAL);
  expect(await getActiveRow(page, TOTAL)).toBe(1);

  // 🔴 v0.50 r2 [CF-5] — **이 스펙의 세계가 실기기와 같은지 잠근다.**
  //   이 파일은 로컬 `GUM_GRANT_SCRIPT` 사본을 쓰는데, 종전엔 거기에 `MediaRecorder` 스텁이 없어
  //   **클립이 항상 비었고** 커밋마다 래치·고지·(쿨다운 시) 배너가 섰다. 지금은 내비게이션만
  //   단언해 green이지만 상단 고정 배너가 클릭을 가로채는 `[CLIP-INIT-SILENT-1]` 계보의 지뢰였다.
  //   여기 4회 커밋 뒤에 `mic_lost`가 하나도 없어야 「정상 세션」이다.
  expect(
    (await page.evaluate(async () => {
      const db: IDBDatabase = await new Promise((r) => {
        const q = indexedDB.open('agri-voicenote');
        q.onsuccess = () => r(q.result);
      });
      const rows: { extra?: string }[] = await new Promise((r) => {
        const q = db.transaction('logEvents', 'readonly').objectStore('logEvents').getAll();
        q.onsuccess = () => r(q.result as { extra?: string }[]);
        q.onerror = () => r([]);
      });
      db.close();
      return rows.map((e) => String(e.extra ?? '')).filter((x) => x.startsWith('mic_lost'));
    })),
    '정상 커밋만 했는데 마이크 소실이 래치됐다 — 픽스처가 「클립이 항상 비는 세계」로 돌아갔다',
  ).toHaveLength(0);

  // 🔑 핵심 반증축: 행 2가 완료여도 '다음'은 행 2에 선다(+1). 건너뛰기 로직(구
  // findNextIncompleteRow)을 되살리면 1→3(+2)으로 튀어 여기서 red.
  await speakWhenArmed(page, '다음행', 700);
  await waitForRow(page, 2, TOTAL);
  expect(await getActiveRow(page, TOTAL)).toBe(2);

  await speakWhenArmed(page, '다음행', 700);
  await waitForRow(page, 3, TOTAL);
  expect(await getActiveRow(page, TOTAL)).toBe(3);

  // 미완료 행에서의 '다음' = skip 마킹 + 1행 전진(skip 개념 유지 축).
  await speakWhenArmed(page, '다음행', 700);
  await waitForRow(page, 4, TOTAL);
  expect(await getActiveRow(page, TOTAL)).toBe(4);
  await speakWhenArmed(page, '다음행', 700);
  await waitForRow(page, 5, TOTAL);
  expect(await getActiveRow(page, TOTAL)).toBe(5);

  // 전 구간 오라클: 이 세션의 모든 행 점프는 |delta| == 1 이다.
  const jumps = await jumpDeltas(page);
  expect(jumps.length).toBeGreaterThanOrEqual(6); // 이전×2 + 다음×4
  for (const j of jumps) {
    expect(Math.abs(j.to - j.from), `jump ${j.from}->${j.to}는 ±1이 아니다(건너뛰기 부활)`).toBe(1);
  }

  // skip 개념 유지: '다음'으로 지나간 미완료 행 3·4는 complete=false placeholder로 영속화된다.
  await page.waitForTimeout(600);
  const sessions = await loadSessionsFromIDB(page) as Array<{
    rows: Array<{ index: number; complete: boolean }>;
  }>;
  expect(sessions.length).toBe(1);
  const row3 = sessions[0].rows.find((r) => r.index === 3);
  const row4 = sessions[0].rows.find((r) => r.index === 4);
  expect(row3?.complete).toBe(false);
  expect(row4?.complete).toBe(false);
});

test('F13 — 마지막 행(미완료)에서 "다음"은 멈춘다: 이동·끝도달 전환 없음 + "마지막 행입니다" 안내', async ({ page }) => {
  const TOTAL = 5;
  await page.addInitScript({ content: GUM_GRANT_SCRIPT }); // M7 [TEST-GUM-1]
  await installVoiceMocks(page);
  await seedAndOpenVoiceTab(page, settingsRows(TOTAL, 'c8-f13-last-stop'));
  await clickStart(page);

  // 행 1 완료 후 '다음' ×3 으로 행 5(마지막, 미완료)까지.
  await waitForActiveChip(page, '횡경');
  await speakWhenArmed(page, '35.1', 300);
  await waitForActiveChip(page, '종경');
  await speakWhenArmed(page, '28.3', 500);
  await waitForRow(page, 2, TOTAL);
  await speakWhenArmed(page, '다음행', 600);
  await waitForRow(page, 3, TOTAL);
  await speakWhenArmed(page, '다음행', 600);
  await waitForRow(page, 4, TOTAL);
  await speakWhenArmed(page, '다음행', 600);
  await waitForRow(page, 5, TOTAL);
  expect(await getActiveRow(page, TOTAL)).toBe(5);

  // 🔑 마지막 행 경계: '다음'은 이동하지 않고 멈춘다. 구 코드는 여기서 announceEndReached로
  // 끝도달 화면(complete-summary)에 진입했다 — 그 전환이 일어나면 red.
  await speakWhenArmed(page, '다음행', 900);
  expect(await getActiveRow(page, TOTAL)).toBe(5);
  expect((await ttsLog(page)).some((t) => t.includes('마지막 행입니다'))).toBe(true);
  await expect(page.locator('[data-testid="complete-summary"]')).toHaveCount(0);
  // 세션은 그대로 산다(ready 복귀 없음).
  await expect(page.locator('text=음성 입력 시작')).toHaveCount(0);
  // 끝도달 대기 이벤트(end_reached_waiting)가 '다음' 경로로 발화되지 않았다.
  const events = await loadLogEventsFromIDB(page);
  expect(events.some((e) => (e.extra ?? '').startsWith('end_reached_waiting'))).toBe(false);
  // 경계 멈춤 자체도 계측된다(row_last_stop — SOP-003 진행 파서 추가 축).
  expect(events.some((e) => e.parsed === 'nextRow' && (e.extra ?? '').startsWith('row_last_stop:5'))).toBe(true);
});

test('F13 — 마지막 행(완료)에서 "다음"은 검토 대기를 재무장하며 멈춘다', async ({ page }) => {
  const TOTAL = 3;
  await page.addInitScript({ content: GUM_GRANT_SCRIPT }); // M7 [TEST-GUM-1]
  await installVoiceMocks(page);
  await seedAndOpenVoiceTab(page, settingsRows(TOTAL, 'c8-f13-last-review'));
  await clickStart(page);

  // 3행 전부 완료 → 끝도달 대기(advance 경로 — 여기는 F13 대상이 아니다).
  for (let r = 1; r <= TOTAL; r++) {
    await waitForActiveChip(page, '횡경');
    await speakWhenArmed(page, `${30 + r}.1`, 300);
    await waitForActiveChip(page, '종경');
    await speakWhenArmed(page, `${20 + r}.3`, 600);
  }
  await page.waitForTimeout(800);
  await expect(page.locator('[data-testid="complete-summary"]')).toBeVisible({ timeout: 4000 });

  // '이전' → 행 2 검토 대기(끝도달 해제) → '다음' → 행 3(완료, 검토 대기).
  await speakWhenArmed(page, '이전행', 800);
  await waitForRow(page, 2, TOTAL);
  await speakWhenArmed(page, '다음행', 800);
  await waitForRow(page, 3, TOTAL);
  expect(await getActiveRow(page, TOTAL)).toBe(3);

  // 🔑 마지막 행 경계(완료): 멈춤 + "마지막 행입니다" 안내 + 검토 대기 재무장(값 재낭독).
  // #14 — 접두가 겹치므로 흡수 안내를 뺀다(같은 파일 상단 주석 참조).
  const reviewOnly = (log: string[]) =>
    log.filter((t) => t.includes('3행 완료됨') && t !== reviewWaitAbsorbTts(3));
  const reviewsBefore = reviewOnly(await ttsLog(page)).length;
  await speakWhenArmed(page, '다음행', 900);
  expect(await getActiveRow(page, TOTAL)).toBe(3);
  const tts = await ttsLog(page);
  expect(tts.some((t) => t.includes('마지막 행입니다'))).toBe(true);
  expect(reviewOnly(tts).length, '검토 대기 재무장 낭독이 늘지 않았다').toBeGreaterThan(reviewsBefore);
  // 끝도달 화면으로 넘어가지 않는다(구 EXIT-REACH-1 대비 — 중앙 종료 부활 금지 계약은 유지).
  await expect(page.locator('[data-testid="complete-summary"]')).toHaveCount(0);
});

// ─── F18 ────────────────────────────────────────────────────────────────────

/** getUserMedia 스텁(승인 경로) + 호출 시각 기록 + 음성화면 등장 시각 기록.
 *  activeZones 픽스처의 fake 트랙 계보 — headless의 기본 거부와 달리 **승인**을 재현한다.
 *
 *  🔴 v0.50 r2 [CF-5] — **`MediaRecorder` 스텁을 앞에 붙인다.** 이 로컬 사본은 호출 **횟수** 계측이
 *  오라클 계약이라 공용 픽스처를 안 쓰는데, 그 때문에 `d3e46c6`의 스텁이 여기만 안 왔다.
 *  결과: 이 파일의 F13 3스펙(각 4회 이상 커밋)은 여전히 **「클립이 항상 비는 세계」**여서
 *  커밋마다 래치·고지·(쿨다운 시) 배너가 섰다 — 지금은 내비게이션만 단언해 green이지만
 *  `[CLIP-INIT-SILENT-1]` 계보의 지뢰(상단 고정 배너가 클릭을 가로챈다)가 그대로 남아 있었다.
 *  스텁은 `getUserMedia` 호출 수를 바꾸지 않으므로 이 파일의 계약과 무관하다. */
const GUM_GRANT_SCRIPT = MEDIA_RECORDER_STUB_SCRIPT + `
(function() {
  window.__gumCalls = [];
  function nextStream() {
    var fakeTrack = {
      kind: 'audio', label: 'Fake Mic', readyState: 'live', muted: false,
      getSettings: function(){ return { deviceId: 'fake-mic' }; },
      addEventListener: function(){}, removeEventListener: function(){}, stop: function(){},
    };
    return { getAudioTracks: function(){ return [fakeTrack]; }, getTracks: function(){ return [fakeTrack]; } };
  }
  if (!navigator.mediaDevices) { try { navigator.mediaDevices = {}; } catch(e){} }
  try {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: function(){ window.__gumCalls.push(Date.now()); return Promise.resolve(nextStream()); },
      writable: true, configurable: true,
    });
  } catch(e){}
  // 음성화면(voice-active-state) 첫 등장 시각 — rAF 폴링(≈16ms 해상도).
  window.__activeShownTs = 0;
  (function poll(){
    if (!window.__activeShownTs && document.querySelector('[data-testid="voice-active-state"]')) {
      window.__activeShownTs = Date.now();
      return;
    }
    requestAnimationFrame(poll);
  })();
})();
`;

async function gumCalls(page: Page): Promise<number[]> {
  return page.evaluate(() => (window as unknown as { __gumCalls?: number[] }).__gumCalls ?? []);
}

test('F18 — 입력탭 진입 시 getUserMedia 0회, "음성 입력 시작" 클릭 후 1회', async ({ page }) => {
  await installVoiceMocks(page);
  await page.addInitScript({ content: GUM_GRANT_SCRIPT });
  await seedAndOpenVoiceTab(page, settingsRows(3, 'c8-f18-count'));

  // ① 입력탭 진입만으로는 마이크를 만지지 않는다(구 prewarm이 살아나면 여기서 red).
  await page.waitForTimeout(700);
  expect((await gumCalls(page)).length, '입력탭 진입만으로 getUserMedia가 호출됐다(WS-2 prewarm 부활)').toBe(0);

  // ② 시작 버튼 클릭 → 정확히 1회(선행 획득과 start() 내 후행 init()은 스트림을 공유한다).
  await clickStart(page);
  expect((await gumCalls(page)).length).toBe(1);
});

/** 🔴 v0.46.1 WP-1c(민구 2차 지시 08-07)로 **계약이 다시 바뀌었다: 고정 대기 → 실제 확인.**
 *
 *  민구 원문: *"마이크 입/출력 권한을 허락하고 **3초뒤 화면 전환이 아닌**, 권한 수락하고 **실제
 *  마이크/스피커 입출력이 가능한지 확인**하고, 진행 상황을 바형태로 보여줘서 …"*
 *
 *  👉 이제 지연은 **고정값이 아니다** — 소리 출력·마이크·음성 안내 확인이 끝나는 시간에 따라
 *  달라지고, `MIC_SETTLE_MS`는 **최소 보장**으로만 남는다(첫 클립 유실 방어).
 *  **계약의 몸통은 세 회차째 그대로다** — "승인 즉시 전환 금지". 상한만 느슨하게 잡는다. */
test('F18 — 승인 후 준비 확인이 끝나야 전환된다(즉시 전환 금지 · 최소 보장 유지)', async ({ page }) => {
  await installVoiceMocks(page);
  await page.addInitScript({ content: GUM_GRANT_SCRIPT });
  await seedAndOpenVoiceTab(page, settingsRows(3, 'c8-f18-delay'));

  const clickTs = await page.evaluate(() => Date.now());
  await clickStart(page);

  const calls = await gumCalls(page);
  // 권한 요청이 클릭 **이후**에 일어났다(클릭 전 선획득이면 지연 측정 자체가 무의미 — red).
  const postClick = calls.filter((t) => t >= clickTs - 50);
  expect(postClick.length, '클릭 이후의 getUserMedia 호출이 없다(요청 시점이 클릭이 아니다)').toBeGreaterThan(0);

  const shownTs = await page.evaluate(() => (window as unknown as { __activeShownTs: number }).__activeShownTs);
  const delta = shownTs - postClick[postClick.length - 1];
  // 하한 900ms = `MIC_SETTLE_MS` 최소 보장(계약의 몸통 — 승인 즉시 전환 금지).
  // 상한 6000ms = 준비 확인(TTS 워밍업 최대 1.5s 포함)이 끝나지 않는 회귀를 잡는 선.
  // 🔴 **고정값을 단언하지 않는다** — 확인이 빨리 끝나면 빨리 넘어가는 것이 민구 요구다.
  expect(delta, `승인→화면 전환 지연 ${delta}ms — 최소 보장(MIC_SETTLE_MS) 위반`).toBeGreaterThanOrEqual(900);
  expect(delta, `승인→화면 전환 지연 ${delta}ms — 준비 확인이 안 끝난다`).toBeLessThanOrEqual(6000);
});

/** 🆕 v0.46.1 WP-1c — **진행바가 실제로 보이고 차오르는가**. 위 테스트는 「지연」만 재고
 *  「보임」은 안 잰다. 민구 요구의 절반이 그 표시다:
 *  *"진행 상황을 바형태로 보여줘서 사용자가 바로 전환되지 않는 화면이 오작동이 아님을 알게 해줘."* */
test('WP-1c — 시작 클릭 후 준비 진행바가 뜨고 차오른다', async ({ page }) => {
  await installVoiceMocks(page);
  await page.addInitScript({ content: GUM_GRANT_SCRIPT });
  await seedAndOpenVoiceTab(page, settingsRows(3, 'wp1-countdown'));

  // 🔴 `clickStart`는 전환 완료까지 기다리므로 여기선 쓰지 않는다 — 카운터는 그 **도중**에만 뜬다.
  await page.locator('[data-testid="voice-start-button"]').click();

  const overlay = page.locator('[data-testid="start-countdown-overlay"]');
  await overlay.waitFor({ state: 'visible', timeout: 3000 });
  const bar = page.locator('[data-testid="start-progress-bar"]');
  await expect(bar, '진행바가 보인다').toBeVisible();
  // 접근성 — 스크린리더도 진행을 읽는다.
  await expect(bar).toHaveAttribute('role', 'progressbar');
  const total = Number(await bar.getAttribute('aria-valuemax'));
  const now = Number(await bar.getAttribute('aria-valuenow'));
  expect(total, '단계 총수가 있다').toBeGreaterThan(0);
  expect(now, '진행이 0보다 크다(단계가 실제로 올라간다)').toBeGreaterThan(0);
  // 라벨이 **무엇을 하는 중인지** 말한다(빈 문자열이면 "오작동이 아님을 알게"가 성립 안 한다).
  const label = (await page.locator('[data-testid="start-progress-label"]').textContent())?.trim();
  expect(label && label.length > 0, `진행 라벨이 비었다: ${label}`).toBe(true);

  // 끝나면 사라진다(유령 오버레이 금지 — finally 정리 계약).
  await expect(overlay).toBeHidden({ timeout: 8000 });
});

test('F18 — 테스트 픽스처 우회(__micSettleSkipForTest)는 지연만 생략한다(우회 심 자체를 고정)', async ({ page }) => {
  await installVoiceMocks(page);
  await page.addInitScript({ content: GUM_GRANT_SCRIPT });
  // 🔴 이 플래그가 제품의 1초 정착을 생략하는 유일한 심이다. 픽스처(activeZones 등)가 이걸 쓴다.
  //    심이 조용히 사라지거나 이름이 바뀌면 이 테스트가 red — 조용한 우회 금지 계약.
  await page.addInitScript(() => {
    (window as unknown as { __micSettleSkipForTest?: boolean }).__micSettleSkipForTest = true;
  });
  await seedAndOpenVoiceTab(page, settingsRows(3, 'c8-f18-bypass'));

  const clickTs = await page.evaluate(() => Date.now());
  await clickStart(page);

  const calls = await gumCalls(page);
  const postClick = calls.filter((t) => t >= clickTs - 50);
  // 우회는 **지연만** 생략한다 — 요청 시점(클릭 후 1회)은 그대로다.
  expect(postClick.length).toBeGreaterThan(0);
  expect((await gumCalls(page)).length).toBe(1);

  const shownTs = await page.evaluate(() => (window as unknown as { __activeShownTs: number }).__activeShownTs);
  const delta = shownTs - postClick[postClick.length - 1];
  expect(delta, `우회 경로인데 지연 ${delta}ms — 심(__micSettleSkipForTest)이 죽었다`).toBeLessThan(900);
});

test('F18 리뷰 B1 — 정착 창에서 탭 이탈 시 고아 세션을 만들지 않는다', async ({ page }) => {
  // 독립 리뷰 B1(실측 재현): 정착 1초 창에서 다른 탭을 누르면 VoiceScreen이 언마운트되는데,
  // 고아 클로저가 세션을 계속 올려 리마운트된 훅이 닿을 수 없는 인식기·마이크가 영구 생존했다.
  // 수정(disposedRef): await 뒤 언마운트를 감지하면 스트림을 되돌리고 세션을 올리지 않는다.
  await installVoiceMocks(page);
  await page.addInitScript({ content: GUM_GRANT_SCRIPT });
  // 🔴 이 테스트는 정착 지연이 실제로 흘러야 의미가 있다 — 우회 심을 명시적으로 끈다.
  await page.addInitScript({ content: 'window.__micSettleSkipForTest = false;' });
  await seedAndOpenVoiceTab(page, settingsRows(3, 'c8-b1-orphan'));

  await page.locator('text=음성 입력 시작').first().click();
  // 🔴 v0.46.1 WP-1로 정착 창이 **1초 → 3초 카운트다운**이 됐다. 이 테스트의 대기는
  //    「그 창보다 길게」가 계약이므로 함께 늘린다 — 짧으면 카운트다운 도중에 복귀해
  //    오버레이가 아직 떠 있는 상태를 「고아 세션」으로 오독한다(실측: 1400ms에서 red).
  await page.waitForTimeout(200); // 카운트다운 창(3000ms) 한복판
  await page.locator('[data-testid="tab-data"]').click(); // 탭 이탈 → VoiceScreen 언마운트
  await page.waitForTimeout(3400); // 고아 클로저가 세션을 올렸다면 이 사이에 올라온다

  // 세션이 몰래 시작되지 않았다 — 입력탭에 돌아오면 ready 화면 그대로다.
  await page.locator('[data-testid="tab-voice"]').click();
  await expect(page.locator('text=음성 입력 시작').first()).toBeVisible({ timeout: 3000 });
  await expect(page.locator('[data-testid="voice-active-state"]')).toHaveCount(0);

  // 되돌아와 다시 시작하면 정상 동작한다(고아 상태가 새 세션을 오염시키지 않는다).
  await clickStart(page);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 5000 });
});
