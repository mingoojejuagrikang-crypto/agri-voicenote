/**
 * v0.50 [UPLOAD-AUTH-1] 오라클 — **로그 백업의 인증 실패 1회 자동 재시도 + 사유 기록**.
 *
 * ## 무엇이 있었나 (2026-08-19 실측)
 * 로그 백업이 그날 **5회 중 4회 첫 시도에 실패**했고, 실패 4건의 모양이 전부 같았다:
 * ```
 * drive_upload:partial:fail=user_drive,admin_drive   ← 첫 시도
 *   → login_prompt_login_clicked → auth_signin_start → auth_token_settled(939~2000ms)
 * drive_upload:ok                                     ← 재시도
 * ```
 * 즉 **만료된 토큰으로 업로드를 시작했고, 사용자가 로그인 버튼을 눌러야 갱신됐다.**
 * 그 클릭이 없던 세션(양혁진 07:24)은 로그가 **6시간 뒤 수동 재업로드 전까지 Drive에 없었다** —
 * 클립 소실 조사의 핵심 증거가 그동안 통째로 비어 있었다.
 *
 * ## 왜 주입 테스트인가
 * `withAuthRetry`는 업로드·인증을 **주입으로** 받는다. fetch·GIS·브라우저 없이
 * 「몇 번 불렀는가 · 언제 갱신했는가」를 그대로 관측할 수 있다(driveFolders.spec 계보).
 *
 * ## 🔴 v0.51 경계 — 실제 `ensureAccessToken`이 이 재시도에서 무엇을 하는가
 * 이 스펙은 `ensureAuth`를 **주입**으로 받으므로 계약(401이면 force로 1회 재시도)은 그대로다.
 * 실제 주입되는 `ensureAccessToken()`에는 v0.51에서 `navigator.userActivation` 가드가 붙었지만,
 * **`force`는 그 가드에서 면제된다**(r1 [F-4]). 면제하지 않으면 `withAuthRetry`가 업로드 왕복
 * **뒤에** 부르는 특성상 activation이 늘 소진돼 있어, v0.50의 간판 기능이 실기기에서 **상시
 * no-op**이 됐을 것이다(콜드 리뷰 M-1이 그 축을 잡았다). 대신 [UA-1]의 「zip마다 120초」는
 * `SILENT_REFRESH_TIMEOUT_MS`(12초) 상한이 막는다 — 가드가 아니라 **상한**이 그 축의 처방이다.
 * 제스처 밖 force가 실제로 갱신을 **시도**하는지는 `tests/v051-signin-join.spec.ts`가 문다
 * (여기 [node] 테스트들은 그 축과 무관하게 재시도 **골격**만 고정한다).
 *
 * ## 반증 축
 *  · 재시도를 빼면 → ⓐ red(두 번째 호출이 없다)
 *  · 인증 판정 없이 무조건 재시도하면 → ⓑ red(500에도 두 번 부른다 = 폭주 재발)
 *  · `force: true`를 빼면 → ⓐ의 갱신 인자 단언이 red(만료 전으로 보이는 토큰을 그대로 재사용)
 *  · 마스킹을 빼면 → ⓔ red(이메일이 로그로 샌다)
 */
import { test, expect } from '@playwright/test';
import { withAuthRetry, isAuthError, sanitizeUploadError, type UploadLegsResult } from '../src/lib/uploadAuthRetry';

type Dual = UploadLegsResult;

const AUTH_FAIL: Dual = { errors: ['user_drive: 로그 업로드 실패: 401', 'admin_drive: 로그 업로드 실패: 401'] };
const SERVER_FAIL: Dual = { errors: ['user_drive: 로그 업로드 실패: 500'] };
const OK: Dual = { errors: [], userDriveId: 'u1', adminDriveId: 'a1' };

test('[node] ⓐ 401이면 토큰을 강제 갱신하고 정확히 1회 다시 올린다', async () => {
  const results = [AUTH_FAIL, OK];
  let uploads = 0;
  const ensureCalls: (boolean | undefined)[] = [];
  let retried = 0;

  const out = await withAuthRetry({
    upload: async () => results[uploads++],
    ensureAuth: async (o) => { ensureCalls.push(o?.force); return true; },
    onRetry: () => { retried++; },
  });

  expect(uploads, '재시도가 안 붙었다 — 2026-08-19가 그대로 재발한다').toBe(2);
  expect(ensureCalls, '갱신을 강제하지 않았다 — 서버가 거부한 토큰을 그대로 다시 썼다').toEqual([true]);
  expect(retried, '재시도 계측이 없다 — 로그에서 자동 복구를 확인할 수 없다').toBe(1);
  expect(out.userDriveId, '재시도 결과를 돌려주지 않았다').toBe('u1');
});

test('[node] ⓑ 인증이 아닌 실패(500)는 재시도하지 않는다 — 폭주 금지', async () => {
  let uploads = 0;
  let ensured = 0;
  const out = await withAuthRetry({
    upload: async () => { uploads++; return SERVER_FAIL; },
    ensureAuth: async () => { ensured++; return true; },
  });
  expect(uploads, '500에도 재시도했다 — v0.22.0 P0가 되돌린 그 폭주다').toBe(1);
  expect(ensured, '인증 실패가 아닌데 토큰을 건드렸다').toBe(0);
  expect(out.errors).toHaveLength(1);
});

test('[node] ⓒ 갱신이 실패하면 재시도하지 않고 첫 결과를 돌려준다', async () => {
  let uploads = 0;
  const out = await withAuthRetry({
    upload: async () => { uploads++; return AUTH_FAIL; },
    ensureAuth: async () => false,
  });
  expect(uploads, '토큰을 못 받았는데 그대로 다시 올렸다').toBe(1);
  expect(out.errors, '첫 실패 사유가 사라지면 재로그인 배너가 근거를 잃는다').toHaveLength(2);
});

test('[node] ⓓ 첫 시도가 성공이면 업로드는 1회뿐이다(정상 경로를 건드리지 않는다)', async () => {
  let uploads = 0;
  let ensured = 0;
  const out = await withAuthRetry({
    upload: async () => { uploads++; return OK; },
    ensureAuth: async () => { ensured++; return true; },
  });
  expect(uploads).toBe(1);
  expect(ensured, '성공 경로에서 토큰을 건드렸다').toBe(0);
  expect(out.userDriveId).toBe('u1');
});

test('[node] ⓖ 부분 성공 재시도는 **이미 성공한 레그를 다시 올리지 않는다** — Drive 중복 파일 방지', async () => {
  // admin만 401, user는 성공 — 08-19 실측 4건은 전부 양쪽 실패였지만 이 형상도 실재한다.
  const partial: Dual = { errors: ['admin_drive: 로그 업로드 실패: 401'], userDriveId: 'u1' };
  const calls: ({ userDriveId?: string; adminDriveId?: string } | undefined)[] = [];
  const out = await withAuthRetry({
    upload: async (keep) => {
      calls.push(keep);
      return calls.length === 1 ? partial : { errors: [], userDriveId: keep?.userDriveId ?? 'u2', adminDriveId: 'a1' };
    },
    ensureAuth: async () => true,
  });
  expect(calls).toHaveLength(2);
  expect(calls[0], '첫 호출에는 keep이 없다').toBeUndefined();
  expect(calls[1], '재시도가 이미 성공한 user 레그를 넘겨받지 못했다 — 같은 파일이 두 번 올라간다')
    .toEqual({ userDriveId: 'u1', adminDriveId: undefined });
  expect(out.userDriveId, '첫 시도의 성공 id가 유지돼야 한다').toBe('u1');
  expect(out.adminDriveId).toBe('a1');
});

test('[node] ⓔ 실패 사유는 남기되 비밀은 남기지 않는다', () => {
  expect(sanitizeUploadError('user_drive: 하위 폴더 검색 실패 mingoo@example.com 401'))
    .toBe('user_drive: 하위 폴더 검색 실패 <email> 401');
  expect(sanitizeUploadError('admin_drive: Bearer ya29.a0AfB_abcdef 거부'))
    .not.toContain('ya29');
  // 개행이 접히고 길이가 잘린다 — 링버퍼(2000)를 한 건이 잠식하지 못하게.
  const long = sanitizeUploadError(`user_drive: ${'x'.repeat(400)}`);
  expect(long.length).toBeLessThanOrEqual(120);
  expect(sanitizeUploadError('a\n b')).toBe('a b');
});

test('[node] ⓕ 인증 실패 판정은 재시도와 재로그인 신호가 같은 기준을 쓴다', () => {
  expect(isAuthError('user_drive: 실패: 401')).toBe(true);
  expect(isAuthError('user_drive: 실패: 403')).toBe(true);
  expect(isAuthError('로그인이 필요합니다')).toBe(true);
  expect(isAuthError('user_drive: 실패: 500')).toBe(false);
  // 🔴 숫자가 다른 자리에 섞인 경우까지 인증으로 보면 500 계열이 재시도로 새어든다.
  expect(isAuthError('user_drive: 실패: 4011')).toBe(false);
});
