/**
 * v0.42.0 계측 — **발화 검증**(빌더 리터럴 고정만으로는 부족하다).
 *
 * 🔴 **왜 이 파일이 따로 있나:** `tests/logEvents.spec.ts`는 빌더가 *올바른 문자열을 만드는지*만
 * 검사한다. 그런데 **배선이 틀린 계측과 재현되지 않은 결함은 로그에서 똑같이 0건으로 보인다**
 * (`[FG-RETURN-LOG-1]`가 기록한 함정). 빌더가 완벽해도 호출부가 안 부르면 다음 실기기 회차는
 * 또 "0건인데 그 0이 무슨 뜻인지 모르는" 자리에 선다 — 이번 릴리스가 통째로 헛수고가 된다.
 *
 * 그래서 여기서는 **실제 앱 경로를 밟아 이벤트가 IDB에 남는지**를 단언한다.
 *
 * 커버:
 *  - 계측 I(`orientation_change`) — 뷰포트 회전. 07-29까지 **0건**이라 3회차 연속 판정 불가였다
 *  - 계측 H(`bg_enter_snapshot`) — `visibilitychange`로 백그라운드 진입
 *
 * 계측 A·F·G는 실기기 조건(오디오 세션 인터럽션·장기 백그라운드 복귀·Drive 업로드)이 필요해
 * 브라우저에서 재현할 수 없다. 그쪽은 빌더 리터럴 + 코드 리뷰로 막고, 이 파일은 **재현 가능한
 * 두 축만** 실측한다. 무리하게 목을 세우면 통과해도 실기기와 무관한 통과가 된다.
 *
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다([ORCH-27]).
 */
import { test, expect, type Page } from '@playwright/test';
import { installVoiceMocks } from './fixtures/stt';
import { BASE } from './baseUrl';

test.setTimeout(120_000);

const STORE_KEY = 'agri-voicenote-settings-v3';
const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };

/** 최소 설정 — 이 스펙은 세션을 시작하지 않는다(회전·가시성만 본다). */
const SETTINGS = {
  state: {
    googleConnected: false,
    userEmail: null,
    sheet: null,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_INST_1/edit',
    sheetTab: 'Sheet1',
    columnsSheetId: 'SHEET_INST_1',
    columnsSheetTab: 'Sheet1',
    availableSheets: [],
    manualMode: false,
  },
  version: 0,
};

/** logEvents 스토어를 통째로 읽는다(v037-review-receipt.spec의 동일 헬퍼). */
async function loadLogEvents(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    if (!db || !db.objectStoreNames.contains('logEvents')) return [];
    return new Promise<Array<{ type: string; extra?: string }>>((resolve) => {
      const tx = db.transaction('logEvents', 'readonly');
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => resolve(req.result as Array<{ type: string; extra?: string }>);
      req.onerror = () => resolve([]);
    });
  });
}

async function extras(page: Page): Promise<string[]> {
  return (await loadLogEvents(page)).map((e) => e.extra ?? '');
}

async function bootApp(page: Page) {
  await installVoiceMocks(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ s, k }) => {
    localStorage.clear();
    localStorage.setItem(k, JSON.stringify(s));
  }, { s: SETTINGS, k: STORE_KEY });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
}

// ─── 계측 I — 회전이 실제로 로그에 남는가 ────────────────────────────────────

test.describe('[계측 I] orientation_change — 3회차 연속 판정 불가였던 축', () => {
  // PortraitGuard의 안내는 `(pointer: coarse)`를 요구하므로 터치 컨텍스트를 지정한다.
  test.use({ viewport: PORTRAIT, hasTouch: true, isMobile: true });

  test('가로로 돌리면 전환과 가드 표시가 함께 남고, 되돌리면 1건 더 남는다', async ({ page }) => {
    await bootApp(page);

    // 🔑 마운트 초기 상태는 방출하지 않는다(빌더에 "초기 관측" 구별자가 없다).
    // 그래서 회전 전에는 0건이어야 한다 — 이게 아래 단언들의 분모다.
    expect((await extras(page)).filter((e) => e.startsWith('orientation_change:'))).toHaveLength(0);

    await page.setViewportSize(LANDSCAPE);
    await expect(page.locator('[data-testid="portrait-guard"]')).toBeVisible({ timeout: 3000 });

    // 터치 컨텍스트라 가드가 실제로 떴다 → guard=shown.
    await expect.poll(async () => (await extras(page)).filter((e) => e.startsWith('orientation_change:')), {
      timeout: 4000,
    }).toEqual([expect.stringContaining('orientation_change:to=landscape,guard=shown,')]);

    await page.setViewportSize(PORTRAIT);
    await expect(page.locator('[data-testid="portrait-guard"]')).toHaveCount(0, { timeout: 3000 });

    await expect.poll(async () => (await extras(page)).filter((e) => e.startsWith('orientation_change:')), {
      timeout: 4000,
    }).toEqual([
      expect.stringContaining('orientation_change:to=landscape,guard=shown,'),
      expect.stringContaining('orientation_change:to=portrait,guard=hidden,'),
    ]);
  });

  test('같은 방향으로의 반복 리사이즈는 중복 방출하지 않는다(분모 오염 방지)', async ({ page }) => {
    await bootApp(page);

    await page.setViewportSize(LANDSCAPE);
    await expect.poll(async () => (await extras(page)).filter((e) => e.startsWith('orientation_change:')), {
      timeout: 4000,
    }).toHaveLength(1);

    // 가로 → 가로(크기만 변경). 방향이 안 바뀌었으므로 새 이벤트가 없어야 한다.
    await page.setViewportSize({ width: 900, height: 400 });
    await page.waitForTimeout(600);
    await page.setViewportSize({ width: 1000, height: 420 });
    await page.waitForTimeout(600);

    expect((await extras(page)).filter((e) => e.startsWith('orientation_change:'))).toHaveLength(1);
  });
});

test.describe('[계측 I] 데스크톱 — 돌려도 안내가 안 뜬다는 사실이 로그에 남는가', () => {
  // pointer: fine — 가드는 안 뜨지만 **회전 자체는 일어난다**. 이 구분이 계측 I의 존재 이유다.
  test.use({ viewport: { width: 1280, height: 720 }, hasTouch: false, isMobile: false });

  test('가로 전환은 남되 guard=hidden으로 남는다', async ({ page }) => {
    await bootApp(page);

    // 세로(높이 > 너비)로 만든 뒤 가로로 되돌려 전환을 일으킨다.
    await page.setViewportSize({ width: 720, height: 1280 });
    await page.waitForTimeout(500);
    await page.setViewportSize({ width: 1280, height: 720 });

    await expect.poll(async () => (await extras(page)).filter((e) => e.startsWith('orientation_change:to=landscape')), {
      timeout: 4000,
    }).toEqual([expect.stringContaining('orientation_change:to=landscape,guard=hidden,')]);

    // 가드는 뜨지 않는다 — 로그의 guard=hidden과 화면이 일치해야 한다.
    await expect(page.locator('[data-testid="portrait-guard"]')).toHaveCount(0);
  });
});

// ─── 계측 H — 백그라운드 진입 스냅샷 ─────────────────────────────────────────

test.describe('[계측 H] bg_enter_snapshot — no_recorder의 원인 창', () => {
  test.use({ viewport: PORTRAIT, hasTouch: true, isMobile: true });

  test('hidden 전환에서만 1건 남고, visible 복귀에서는 남지 않는다', async ({ page }) => {
    await bootApp(page);

    const snapshots = async () => (await extras(page)).filter((e) => e.startsWith('bg_enter_snapshot:'));
    expect(await snapshots()).toHaveLength(0);

    // visibilitychange를 직접 디스패치한다 — Playwright에는 탭 숨김 API가 없다.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await expect.poll(snapshots, { timeout: 4000 }).toHaveLength(1);

    // 세션 전이라 레코더·인식기가 없다 — 그 사실이 그대로 남아야 한다.
    // 🔑 track은 'none'이 아니라 'unknown'이다: "트랙이 없다"와 "읽지 못했다"는 다르다.
    expect((await snapshots())[0]).toMatch(/^bg_enter_snapshot:rec=none,track=\w+,stt=\w+,phase=\w+$/);

    // 🔴 복귀에서는 방출하지 않는다 — 이 이벤트는 **진입 전용**이다.
    // 양쪽에서 찍히면 진입 스냅샷과 복귀 스냅샷이 섞여 대조 축이 무너진다.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(600);
    expect(await snapshots()).toHaveLength(1);
  });

  test('기존 lifecycle·visibility_context 계측과 함께 남는다(대체가 아니라 추가)', async ({ page }) => {
    await bootApp(page);

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await expect.poll(async () => {
      const all = await extras(page);
      return {
        lifecycle: all.some((e) => e === 'lifecycle:vis_hidden'),
        context: all.some((e) => e.startsWith('visibility_context:state=hidden')),
        snapshot: all.some((e) => e.startsWith('bg_enter_snapshot:')),
      };
    }, { timeout: 4000 }).toEqual({ lifecycle: true, context: true, snapshot: true });
  });
});
