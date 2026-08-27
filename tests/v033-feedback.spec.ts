/**
 * v0.33.0 항목11 — 개선요청 탭 e2e.
 *
 * 검증:
 *   1. 탭 인터셉트: '개선요청' 탭 클릭 시 화면 전환 없이(현재 탭 유지) 캡처 → 모달.
 *      취소로 닫아도 화면 그대로. tab:<from>->feedback 전환 이벤트가 없고 feedback_open만 남는다.
 *   2. 제출(로그인+온라인, Drive 전부 목): 사용자 Drive 레그 업로드 발생 + 모달 닫힘 +
 *      feedback_uploaded:user=ok,admin=skip(관리자 폴더 env 미설정) 텔레메트리.
 *   3. 경량 zip 내용물: 업로드된 multipart에서 zip을 추출·파싱 — feedback.json(텍스트/컨텍스트),
 *      events.json, sessions.json 포함 / clips/·screens/ **제외**(민구 확정 — 시딩한 클립이
 *      IDB에 있어도 zip에 없음), screenshot.jpg는 feedback.json.hasScreenshot과 자기일관.
 *   4. 큐: 미로그인 제출 → feedbackQueue 저장(feedback_queued:not_signed_in) → 토큰 주입 후
 *      reload(부팅 flush) → 큐 소진 + 업로드 발생(feedback_flush:uploaded).
 *   5. DB v6 마이그레이션: 부팅 후 DB version=6 + feedbackQueue 스토어 존재(기존 스토어 보존).
 *
 * Drive 호출은 전부 route 목 — 클라우드 실쓰기 0. dev 서버 수동 기동([ENV-1/2]).
 */
import { test, expect, type Page } from '@playwright/test';
import JSZip from 'jszip';
import { BASE } from './baseUrl';

test.setTimeout(120_000);

interface DriveStub {
  uploads: { filename: string; zip: Buffer }[];
  folderCreates: string[];
}

/** Drive API 전체 목: 폴더 검색(빈 결과) → 생성(고정 id) → multipart 업로드(zip 캡처). */
async function stubDrive(page: Page): Promise<DriveStub> {
  const stub: DriveStub = { uploads: [], folderCreates: [] };
  await page.route('**://www.googleapis.com/upload/drive/v3/files**', async (route) => {
    const buf = route.request().postDataBuffer();
    if (buf) {
      const text = buf.toString('latin1');
      const nameMatch = text.match(/"name"\s*:\s*"([^"]+)"/);
      stub.uploads.push({ filename: nameMatch?.[1] ?? '?', zip: extractZipFromMultipart(buf) });
    }
    await route.fulfill({ json: { id: `file-${stub.uploads.length}` } });
  });
  await page.route('**://www.googleapis.com/drive/v3/files**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { files: [] } }); // 검색 — 항상 미존재(생성 경로 유도)
      return;
    }
    const body = route.request().postDataJSON() as { name?: string } | null;
    stub.folderCreates.push(body?.name ?? '?');
    await route.fulfill({ json: { id: `fold-${stub.folderCreates.length}` } });
  });
  return stub;
}

/** multipart/form-data 본문에서 zip 바이트를 추출(PK 시그니처 시작 ~ 마지막 boundary 직전). */
function extractZipFromMultipart(buf: Buffer): Buffer {
  const start = buf.indexOf(Buffer.from('PK', 'latin1'));
  const tail = buf.lastIndexOf(Buffer.from('\r\n--', 'latin1'));
  if (start < 0) return Buffer.alloc(0);
  return buf.subarray(start, tail > start ? tail : buf.length);
}

async function boot(page: Page, opts: { withToken: boolean } = { withToken: true }) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async (withToken) => {
    localStorage.clear();
    if (withToken) {
      localStorage.setItem('gs10_google_token', JSON.stringify({
        access_token: 'test-token', expires_at: Date.now() + 3600_000, email: 'tester@example.com',
      }));
    }
    // zip 제외 검증용 시딩: 클립 1개 + 자동캡처 1장 — 경량 zip엔 절대 담기면 안 된다.
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['audioClips', 'screenshots'], 'readwrite');
      tx.objectStore('audioClips').put({ buf: new ArrayBuffer(64), type: 'audio/wav' }, 'sess_x:1:c8');
      tx.objectStore('screenshots').put({ buf: new ArrayBuffer(64), type: 'image/jpeg' }, 'sess_x:1:commit');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, opts.withToken);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
}

async function getEventExtras(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const tx = db.transaction('logEvents', 'readonly');
    const all: Array<{ extra?: string }> = await new Promise((resolve, reject) => {
      const rq = tx.objectStore('logEvents').getAll();
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
    });
    db.close();
    return all.map((e) => e.extra).filter((x): x is string => typeof x === 'string');
  });
}

async function getFeedbackQueue(page: Page): Promise<Array<{ filename: string; pendingUser: boolean; pendingAdmin: boolean }>> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    if (!db.objectStoreNames.contains('feedbackQueue')) { db.close(); return []; }
    const tx = db.transaction('feedbackQueue', 'readonly');
    const all: Array<{ filename: string; pendingUser: boolean; pendingAdmin: boolean }> =
      await new Promise((resolve, reject) => {
        const rq = tx.objectStore('feedbackQueue').getAll();
        rq.onsuccess = () => resolve(rq.result);
        rq.onerror = () => reject(rq.error);
      });
    db.close();
    return all.map((x) => ({ filename: x.filename, pendingUser: x.pendingUser, pendingAdmin: x.pendingAdmin }));
  });
}

/** 개선요청 탭 클릭 → (캡처 후) 모달 대기. html2canvas 첫 dynamic import 시간 여유. */
async function openFeedbackModal(page: Page) {
  await page.locator('[data-testid="tab-feedback"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toBeVisible({ timeout: 15_000 });
}

// ─── Tests ──────────────────────────────────────────────────────

test('탭 인터셉트 — 화면 전환 없이 모달, 취소 후에도 현재 화면 유지 + feedback_open 계측', async ({ page }) => {
  await stubDrive(page);
  await boot(page);

  // 설정탭이 보이는 상태에서 개선요청 탭 클릭.
  await expect(page.locator('[data-testid="connection-status-card"]')).toBeVisible();
  await openFeedbackModal(page);

  // 화면 전환 없음 — 설정탭 콘텐츠가 모달 뒤에 그대로 마운트되어 있다.
  await expect(page.locator('[data-testid="connection-status-card"]')).toBeVisible();
  // 썸네일(캡처 성공) 또는 실패 안내 중 하나는 반드시 존재(캡처는 best-effort).
  const thumb = page.locator('[data-testid="feedback-thumbnail"], [data-testid="feedback-thumbnail-missing"]');
  await expect(thumb.first()).toBeVisible();
  // 텍스트가 비면 보내기 비활성.
  await expect(page.locator('[data-testid="feedback-send"]')).toBeDisabled();

  // 취소 → 모달만 닫히고 화면은 여전히 설정탭.
  await page.locator('[data-testid="feedback-cancel"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toBeHidden();
  await expect(page.locator('[data-testid="connection-status-card"]')).toBeVisible();

  const extras = await getEventExtras(page);
  expect(extras.some((x) => x === 'feedback_open:tab=settings')).toBe(true);
  // setTab이 일어나지 않았으므로 탭 전환 계측(tab:settings->feedback)은 없어야 한다.
  expect(extras.some((x) => x.includes('->feedback'))).toBe(false);
});

test('제출(로그인+온라인) — 사용자 Drive 레그 업로드 + 경량 zip 내용물(클립·자동캡처 제외) + 텔레메트리', async ({ page }) => {
  const stub = await stubDrive(page);
  await boot(page);
  await openFeedbackModal(page);

  await page.locator('[data-testid="feedback-text"]').fill('알람 소리가 너무 작아요');
  await page.locator('[data-testid="feedback-send"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toBeHidden({ timeout: 15_000 });

  // 업로드 1건(사용자 레그) — 관리자 폴더 env 미설정이라 admin은 skip. 폴더는 agri-voicenote/feedback 생성
  // (스텁 검색이 항상 빈 결과라 신·구 폴더 둘 다 miss → 새 이름 생성 경로).
  await expect.poll(() => stub.uploads.length).toBe(1);
  expect(stub.uploads[0].filename).toMatch(/^feedback_\d{4}-\d{2}-\d{2}_\d+\.zip$/);
  expect(stub.folderCreates).toEqual(['agri-voicenote', 'feedback']);

  // zip 내용물 — 경량 계약(민구 확정): feedback.json + events.json + sessions.json (+ screenshot.jpg
  // 자기일관). clips/·screens/ 절대 없음(부팅 시딩된 클립·자동캡처가 IDB에 실존하는데도).
  const zip = await JSZip.loadAsync(stub.uploads[0].zip);
  const names = Object.keys(zip.files);
  expect(names).toContain('feedback.json');
  expect(names).toContain('events.json');
  expect(names).toContain('sessions.json');
  expect(names.some((n) => n.startsWith('clips/'))).toBe(false);
  expect(names.some((n) => n.startsWith('screens/'))).toBe(false);

  const fb = JSON.parse(await zip.files['feedback.json'].async('string')) as {
    text: string; hasScreenshot: boolean; context: { tab: string; sessionPhase: string }; userEmail: string | null;
    device: { screenW: number; screenH: number; viewportW: number; viewportH: number };
  };
  expect(fb.text).toBe('알람 소리가 너무 작아요');
  expect(fb.context.tab).toBe('settings');
  expect(fb.context.sessionPhase).toBe('ready');
  expect(fb.userEmail).toBe('tester@example.com');
  expect(names.includes('screenshot.jpg')).toBe(fb.hasScreenshot); // 자기일관(캡처는 best-effort)

  // v0.44.0 §B4 — 스크린샷(html2canvas)은 100dvh(동적 가시 뷰포트)를 재고 screenH는 정적 OS
  // 해상도다(iPhone 62px·태블릿 31px 차 — 분석자가 잘림 좌표 판정을 그만큼 틀렸다). 실측 뷰포트
  // 두 키를 리터럴로 고정한다(Playwright 기본 뷰포트 1280×720 — 제품 상수 import 금지).
  expect(fb.device.viewportW).toBe(1280);
  expect(fb.device.viewportH).toBe(720);
  // 기존 screenW/screenH는 유지된다(과거 로그 호환) — 두 축이 함께 있어야 차이를 잴 수 있다.
  expect(typeof fb.device.screenW).toBe('number');
  expect(typeof fb.device.screenH).toBe('number');

  // events.json이 진짜 경량 로그를 담는다(부팅 계측 최소 1건 이상).
  const events = JSON.parse(await zip.files['events.json'].async('string')) as unknown[];
  expect(events.length).toBeGreaterThan(0);

  const extras = await getEventExtras(page);
  expect(extras.some((x) => x.startsWith(`feedback_submit:len=${'알람 소리가 너무 작아요'.length},shot=`))).toBe(true);
  expect(extras.some((x) => x.startsWith('feedback_uploaded:user=ok,admin=skip'))).toBe(true);
});

test('미로그인 제출 → feedbackQueue 저장 → 토큰 복귀(reload) 시 자동 재전송·큐 소진', async ({ page }) => {
  const stub = await stubDrive(page);
  await boot(page, { withToken: false });
  await openFeedbackModal(page);

  await page.locator('[data-testid="feedback-text"]').fill('오프라인에서도 보내지나요');
  await page.locator('[data-testid="feedback-send"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toBeHidden({ timeout: 15_000 });

  // 업로드 시도 없이 큐에 저장(사용자 레그 대기, admin은 env 미설정이라 레그 자체 없음).
  expect(stub.uploads.length).toBe(0);
  await expect.poll(async () => (await getFeedbackQueue(page)).length).toBe(1);
  const q = await getFeedbackQueue(page);
  expect(q[0].filename).toMatch(/^feedback_/);
  expect(q[0].pendingUser).toBe(true);
  expect(q[0].pendingAdmin).toBe(false);
  const extras1 = await getEventExtras(page);
  expect(extras1.some((x) => x === 'feedback_queued:not_signed_in')).toBe(true);

  // 토큰 주입 후 reload — 부팅 flush(initFeedbackQueueFlush)가 큐를 자동 재전송한다.
  await page.evaluate(() => {
    localStorage.setItem('gs10_google_token', JSON.stringify({
      access_token: 'test-token', expires_at: Date.now() + 3600_000, email: 'tester@example.com',
    }));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(async () => (await getFeedbackQueue(page)).length, { timeout: 10_000 }).toBe(0);
  await expect.poll(() => stub.uploads.length).toBe(1);
  expect(stub.uploads[0].filename).toMatch(/^feedback_/);
  const extras2 = await getEventExtras(page);
  expect(extras2.some((x) => x.startsWith('feedback_flush:uploaded:feedback_'))).toBe(true);
});

test('DB v6 마이그레이션 — feedbackQueue 스토어 신설 + 기존 스토어 보존', async ({ page }) => {
  await boot(page);
  const info = await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const out = { version: db.version, stores: [...db.objectStoreNames].sort() };
    db.close();
    return out;
  });
  expect(info.version).toBe(6);
  expect(info.stores).toEqual(
    ['audioClips', 'feedbackQueue', 'kv', 'logEvents', 'screenshots', 'sessions'].sort(),
  );
});

// ─── v0.34.0 A2 — 세션 중 개선요청 팝업 = STT 일시정지(suspend) / 닫힘 = 재개(resume) ────────
// 실기기 피드백: "사용자 피드백 팝업 작동시 음성입력은 잠시 일시 정지로 할 것."
// 배선: App.tsx(sessionStore.uiModalOpen) → useVoiceSession 구독 → suspendRecognitionForUi
// ('feedback_modal'). 판정 근거는 기존 ui_suspend/ui_resume 로그(추가 계측 없음).

const FEEDBACK_STT_SETTINGS = {
  state: {
    googleConnected: false, userEmail: null, sheet: null,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_TEST_1/edit', sheetTab: 'Sheet1',
    columnsSheetId: 'SHEET_TEST_1', columnsSheetTab: 'Sheet1',
    availableSheets: [], manualMode: false,
    columns: [
      { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 3 } },
      { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
    ],
    tableGenerated: true, totalRows: 3, ttsRate: 1.05,
    sessionLabelColId: null, sessionAutoLabel: 'feedback-stt-test', noisyMode: false, preferredVoiceName: '',
  },
  version: 13,
};

// manual-input.spec.ts와 동일한 instant-TTS + MockSTT 주입(이 스펙의 다른 테스트는 세션 불필요라 미사용).
const STT_MOCK_INIT = `
(function() {
  window.__ttsLog = [];
  var mockSynth = {
    speak: function(u) { window.__ttsLog.push(u.text);
      try { if (u.onstart) u.onstart(new Event('start')); } catch(e){}
      try { if (u.onend) u.onend(new Event('end')); } catch(e){} },
    cancel: function(){}, pause: function(){}, resume: function(){},
    getVoices: function(){ return [{ name:'Mock Korean', lang:'ko-KR', default:true, localService:true, voiceURI:'mock' }]; },
    speaking:false, pending:false, paused:false, onvoiceschanged:null,
    addEventListener:function(){}, removeEventListener:function(){}, dispatchEvent:function(){ return true; },
  };
  try { Object.defineProperty(window,'speechSynthesis',{ get:function(){ return mockSynth; }, configurable:true, enumerable:true }); }
  catch(e){ try { window.speechSynthesis = mockSynth; } catch(e2){} }
  function MockSTT(){ this._ls={}; this.continuous=true; this.interimResults=true; this.lang='ko-KR'; this.maxAlternatives=3; window.__mockSTT=this; }
  MockSTT.prototype.addEventListener=function(t,cb){ if(!this._ls[t])this._ls[t]=[]; this._ls[t].push(cb); };
  MockSTT.prototype.removeEventListener=function(t,cb){ if(this._ls[t])this._ls[t]=this._ls[t].filter(function(f){return f!==cb;}); };
  MockSTT.prototype.start=function(){ var s=this; setTimeout(function(){ (s._ls['start']||[]).forEach(function(cb){cb(new Event('start'));}); },5); };
  MockSTT.prototype.stop=function(){};
  MockSTT.prototype.abort=function(){ var s=this; setTimeout(function(){ (s._ls['end']||[]).forEach(function(cb){cb(new Event('end'));}); },5); };
  MockSTT.prototype.fireResult=function(transcript,confidence){ if(confidence===undefined)confidence=0.95;
    var ev={ resultIndex:0, results:{ length:1, 0:{ isFinal:true, length:1, 0:{ transcript:transcript, confidence:confidence } } } };
    (this._ls['result']||[]).forEach(function(cb){cb(ev);}); };
  try { Object.defineProperty(window,'SpeechRecognition',{ value:MockSTT, writable:true, configurable:true, enumerable:true }); }
  catch(e){ try { window.SpeechRecognition=MockSTT; } catch(e2){} }
  try { Object.defineProperty(window,'webkitSpeechRecognition',{ value:MockSTT, writable:true, configurable:true, enumerable:true }); }
  catch(e){ try { window.webkitSpeechRecognition=MockSTT; } catch(e2){} }
})();
`;

async function getSuspendEvents(page: Page) {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const r = indexedDB.open('agri-voicenote');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const tx = db.transaction('logEvents', 'readonly');
    const all: Array<{ type: string; parsed?: string; extra?: string }> = await new Promise((resolve, reject) => {
      const rq = tx.objectStore('logEvents').getAll();
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
    });
    db.close();
    return all.filter((e) => e.parsed === 'ui_suspend' || e.parsed === 'ui_resume');
  });
}

test('v0.34.0 A2 — 세션 중 개선요청 팝업 열기 → ui_suspend(feedback_modal)·STT 정지, 닫기 → 재개·값 커밋 계속', async ({ page }) => {
  await stubDrive(page);
  await page.addInitScript(STT_MOCK_INIT);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem('agri-voicenote-settings-v3', JSON.stringify(s));
    indexedDB.deleteDatabase('agri-voicenote');
  }, FEEDBACK_STT_SETTINGS);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  // 세션 시작(입력탭) + 첫 값 커밋으로 STT 생존 확인.
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(200);
  await page.locator('text=음성 입력 시작').first().click();
  await page.waitForTimeout(600);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
  await page.evaluate(() => {
    (window as unknown as { __mockSTT?: { fireResult: (t: string, c: number) => void } }).__mockSTT?.fireResult('35.1', 0.95);
  });
  // 단일 음성열이라 커밋 즉시 다음 행으로 진행 — 행 전환이 곧 커밋 증명.
  await page.waitForFunction(() => /2\s*\/\s*3\s*행/.test(document.body.innerText), undefined, { timeout: 5000 });

  // 개선요청 탭 → (캡처 후) 모달. 인터셉트 시점부터 uiModalOpen 신호 → STT suspend.
  await openFeedbackModal(page);
  await expect.poll(async () => {
    const ev = await getSuspendEvents(page);
    return ev.some((e) => e.parsed === 'ui_suspend' && e.extra === 'feedback_modal');
  }, { timeout: 5000 }).toBe(true);

  // 취소로 닫기 → ui_resume + STT 재개(다음 행 값이 정상 커밋된다 = 인식기 복구 증명).
  await page.locator('[data-testid="feedback-cancel"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toBeHidden();
  await expect.poll(async () => {
    const ev = await getSuspendEvents(page);
    return ev.some((e) => e.parsed === 'ui_resume' && e.extra === 'feedback_modal');
  }, { timeout: 5000 }).toBe(true);

  await page.waitForTimeout(400); // resume 후 인식기 재기동 여유
  await page.evaluate(() => {
    (window as unknown as { __mockSTT?: { fireResult: (t: string, c: number) => void } }).__mockSTT?.fireResult('42.0', 0.95);
  });
  // 재개된 인식기로 행 2 커밋 → 행 3 진행(정지-재개 후에도 값 커밋 계속).
  await page.waitForFunction(() => /3\s*\/\s*3\s*행/.test(document.body.innerText), undefined, { timeout: 5000 });
});
