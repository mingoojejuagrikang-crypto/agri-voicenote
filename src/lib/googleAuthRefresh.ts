/**
 * **무팝업(silent) 자동 갱신의 정책층** — 「지금 갱신을 시도해도 되는가」를 판정하는 곳.
 *
 * [ENV-12] 계보의 분리다(v0.51 r4 · `max-lines` 500 초과 해소 — disable이 아니라 분리).
 * 경계는 **「정책인가 기계인가」**다:
 *  · `googleAuth.ts` = flight **기계**(pending · 세대 · epoch · 타임아웃 · GIS 콜백)
 *  · **이 파일** = 그 기계를 **부를 자격**의 판정(제스처 · 연결창 · 상한)과 두 진입점
 *    (`ensureAccessToken` = 갱신 요청 · `refreshBeforeSessionStart` = P2 세션 시작 진입)
 *
 * 🔴 `abandonSilentFlight`는 `pending` 내부를 만지므로 **기계부에 남는다** — 여기서는 필요한
 *    최소(그 함수와 상한 상수)만 import한다. 방향은 이 파일 → `googleAuth` **단방향**이고
 *    역참조가 없으므로 `[LOGEVENTS-CYCLE-1]` 형태의 순환이 아니다.
 *
 * 🔴 **재수출로 감추지 않는다.** `googleAuth`에서 이 두 함수를 다시 내보내면 순환이 생기고,
 *    무엇보다 `tests/v051-auth-callsite-allowlist.spec.ts`(F-20)가 **호출부 집합을 못 본다** —
 *    그 오라클의 존재 이유가 「새 호출부가 계약을 조용히 우회하는 것」을 막는 데 있기 때문이다.
 *    그래서 호출부 2곳(`useDataActions` · `useVoiceSession`)이 **이 경로를 직접** 가리킨다.
 *
 * 🔴 **본문은 무수정으로 옮겼다**(치환 0 · 바이트 동일).
 */
import { logger } from './logger';
import { isConnectionAlive } from './googleConnection';
import { getStoredToken } from './googleTokenStore';
import { abandonSilentFlight, signIn, SILENT_REFRESH_TIMEOUT_MS } from './googleAuth';

/** 지금 이 콜스택이 **사용자 제스처의 유효 창 안**인가.
 *  ⚠️ API 미지원 브라우저(구형 WebKit 등)에서는 **막지 않는다** — 이 가드의 목적은 헛된 팝업
 *  시도를 거르는 것이지 갱신 자체를 봉인하는 것이 아니다. 미지원인데 false를 돌려주면
 *  그 브라우저에선 무팝업 갱신이 통째로 죽는다. */
function hasTransientActivation(): boolean {
  const ua = (navigator as Navigator & { userActivation?: { isActive?: boolean } }).userActivation;
  if (!ua || typeof ua.isActive !== 'boolean') return true;
  return ua.isActive;
}

/** silent 갱신 경로에만 씌우는 상한(위 상수 주석). 타임아웃 사유를 이름으로 구분해 로그에 싣는다. */
function withSilentTimeout<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      abandonSilentFlight(); // [F-2] 선두가 silent면 flight 자체를 정리 — 합류자 포함 가시적 실패
      const e = new Error('무팝업 갱신 응답이 지연되었습니다.');
      e.name = 'SilentRefreshTimeout';
      reject(e);
    }, SILENT_REFRESH_TIMEOUT_MS);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e as Error); },
    );
  });
}

/** v0.50 [UPLOAD-AUTH-1] — **업로드 직전 유효 토큰을 보장한다**(무팝업 갱신 시도).
 *
 *  ## 왜 필요한가 — 2026-08-19 실측
 *  로그 백업이 그날 **5회 중 4회 첫 시도에 실패**했고, 실패 4건 모두 같은 모양이었다:
 *  `drive_upload:partial:fail=user_drive,admin_drive` → 1~2초 뒤 `login_prompt_login_clicked`
 *  → `auth_signin_start` → `auth_token_settled`(939~2000ms) → `drive_upload:ok`.
 *  즉 **만료된 토큰으로 업로드를 시작하고, 사용자가 로그인 버튼을 눌러야 갱신됐다.**
 *  양혁진 세션(07:24)만 그 클릭이 없어 로그가 **6시간 뒤 수동 재업로드까지 Drive에 없었다.**
 *
 *  `getStoredToken()`은 만료 1분 전부터 null을 돌려주므로(선반영), 그걸 먼저 보고 없을 때만
 *  `signIn()`을 부른다. `signIn()`은 `prompt: ''`라 기존 동의가 살아 있으면 팝업 없이 갱신된다.
 *
 *  @param force 서버가 이미 401/403을 준 경우 — 저장 토큰이 「아직 안 만료」로 보여도 다시 받는다.
 *  @returns 유효 토큰을 확보했는가. **실패해도 throw하지 않는다** — 호출부는 종전 실패 경로
 *    (재로그인 배너)로 그대로 수렴해야 하고, 이 함수가 흐름을 끊으면 그 경로가 사라진다. */
export async function ensureAccessToken(opts?: { force?: boolean }): Promise<boolean> {
  if (!opts?.force && getStoredToken()) {
    logger.log({ type: 'app', extra: 'auth_ensure:hit' });
    return true;
  }
  // ── v0.51 rauth P1ⓑ — **제스처 밖이면 시도 자체를 하지 않는다.** ───────────────────────
  // `signIn()`은 팝업을 여는데, 제스처가 소진된 뒤의 팝업은 브라우저가 막는다
  // (`popup_failed_to_open`). 그 시도는 실패할 뿐 아니라 **비싸다**: 무팝업 wedge면 타임아웃까지
  // 붙잡고, 그동안 호출부(업로드 루프)가 멈춘다. 즉시 false를 돌려주면 호출부는 종전 실패 경로
  // (재로그인 배너 → 사용자 클릭 = 새 제스처)로 곧장 수렴한다 — 그 경로가 실제로 성공하는 길이다.
  //
  // 🔴 v0.51 r1 [F-4 / 리뷰 M-1] — **`force`는 이 가드에서 면제한다.** (초판의 반대 판정이다.)
  //    `withAuthRetry`는 업로드 왕복 **뒤에** `ensureAuth({force:true})`를 부르므로 그 시점엔
  //    activation이 늘 소진돼 있다 → 가드를 걸면 v0.50 [UPLOAD-AUTH-1]의 간판 기능
  //    (「인증 실패 1회 자동 재시도」)이 실기기에서 **상시 no-op**이 된다. 401/403 수신 시점은
  //    사용자의 업로드 의사가 이미 확립된 뒤이고, 팝업이 막히는 환경이면 `popup_failed_to_open`이
  //    1초 내에 떨어져 종전 모달 폴백으로 수렴한다. [UA-1]이 막으려던 「zip마다 120초」는
  //    아래 `withSilentTimeout`(12초)이 대신 막는다 — 가드가 아니라 **상한**이 그 축의 처방이다.
  if (!opts?.force && !hasTransientActivation()) {
    logger.log({ type: 'app', extra: 'auth_ensure:skipped:no_gesture' });
    return false;
  }
  // ── 🔴 v0.51 r3 [F-13 / codex cx-H1] — **창이 죽었으면 자동 갱신은 없다.** ──────────────
  //
  // 창 만료 강등은 설계상 `revoke`를 하지 않는다(계획서 §2-5 — revoke하면 grant가 죽어 이후
  // 무팝업 갱신이 전부 동의 화면이 된다). 그 말은 **만료 뒤에도 Google 쪽 grant는 살아 있다**는
  // 뜻이고, 그래서 다음 동기화 클릭의 `prompt:''`가 조용히 토큰을 받아 온다 →
  // 콜백의 `upsertConnection`이 **새 4주 창을 연다.** 즉 「4주 미사용이면 풀린다」가 표시용으로
  // 전락하고, 창은 사실상 영구히 되살아난다.
  //
  // 정책(민구/Larry 확정): **자동 갱신의 자격은 「살아 있는 창」 하나다.**
  //   · `googleConnected` 플래그는 게이트에서 **제외**한다 — 강등이 아직 안 돈 시점(설정탭
  //     미마운트)에도 플래그가 true로 남아 사전강등 부활 구멍이 된다. eviction 복원은 IDB 미러가
  //     연결 **기록까지** 되살리므로 플래그에 기댈 필요가 없고, 잔여 corner는 모달 1클릭으로 복구된다.
  //   · 창 만료 후의 재연결 경로는 **재로그인 모달의 [로그인]뿐**이다(사용자 명시 의사 —
  //     `signIn()` 직접 호출이라 이 게이트를 지나지 않는다).
  //   · 🔴 **`force`도 이 게이트를 지난다** — 실측으로 확인한 축이다(빌더 r3): 창이 죽은 상태로
  //     동기화를 누르면 시트 단계는 `needsLogin`으로 죽지만 **업로드가 계속 진행**되고, 토큰 없는
  //     업로드가 인증 오류를 내 `withAuthRetry`의 `{force:true}`가 돈다 → 게이트를 면제하면
  //     거기서 `prompt:''`가 토큰을 받아 **죽은 창이 그 클릭 한 번으로 되살아난다**(cx-H1이 지목한
  //     바로 그 경로). F-4의 면제는 **제스처 가드**(`hasTransientActivation`)에 대한 것이고 —
  //     그건 그대로 살아 있다 — 「연결이 살아 있는가」는 다른 질문이다.
  //     연결이 살아 있는 사용자의 401 자동 재시도(=[UPLOAD-AUTH-1]의 실제 목적)는 영향받지 않는다.
  if (!isConnectionAlive()) {
    logger.log({ type: 'app', extra: `auth_ensure:skipped:no_connection${opts?.force ? ':forced' : ''}` });
    return false;
  }
  try {
    // 상한은 짧게(SILENT_REFRESH_TIMEOUT_MS 주석) — 이 경로엔 2FA가 없다. `silent` origin이라
    // 12초 시점에 flight까지 함께 정리된다([F-2] abandonSilentFlight).
    await withSilentTimeout(signIn('silent'));
    logger.log({ type: 'app', extra: `auth_ensure:refreshed${opts?.force ? ':forced' : ''}` });
    return true;
  } catch (e) {
    // 실패 사유는 남기되 토큰·이메일은 절대 싣지 않는다(signOut 주석의 동일 계약).
    logger.log({ type: 'app', extra: `auth_ensure:failed:${e instanceof Error ? e.name : 'unknown'}` });
    return false;
  }
}

/** v0.51 [rauth P2] — **음성 세션 시작 제스처 안**의 선제 갱신.
 *
 *  ## 왜
 *  앱을 열고 동기화 없이 바로 세션을 시작하면 토큰이 없어 이상치 알람용 과거값 프리페치가
 *  `past_index_skip:not_signed_in`으로 죽는다 — 알람이 전 세션 침묵하는 실전 영향(D-4 계열).
 *  세션 시작 탭은 확실한 제스처이고 3시간 현장 세션의 시작점이라, 여기서 한 번 갱신해 두면
 *  그 세션 내내 유효하다.
 *
 *  ## 계약 (호출부가 지켜야 하는 것)
 *  - 🔴 **마이크 획득 이전**에만 부른다. 세션 **중** 갱신은 절대 금지 — GIS 팝업이 앱을 1~2초
 *    백그라운드로 보내고(rauth §2-6 실측), 그게 정확히 [CLIP-SILENT-1]·[CLIP-LOSS-1]의 조건이다.
 *  - 🔴 **유효 토큰이면 `null`을 돌려준다** — 호출부가 `await`조차 하지 않게 하기 위해서다.
 *    공통 경로(토큰 있음)에 마이크로태스크 하나도 끼우지 않아야 `getUserMedia`가 클릭의 동기
 *    구간에 그대로 남는다([IOS-5]). 갱신이 필요한 드문 경로에서만 await가 생긴다.
 *  - **절대 throw하지 않는다.** 실패해도 세션은 그대로 시작한다(알람만 종전처럼 늦은 토큰
 *    복구 경로 `onTokenSettled`에 맡긴다). */
export function refreshBeforeSessionStart(): Promise<void> | null {
  if (getStoredToken()) return null;
  // 🔴 v0.51 r1 [F-1 / 리뷰 H-1] — **연결한 적 없는 사용자에게는 갱신을 시도하지 않는다.**
  //    판정이 「토큰 유무」 하나였던 탓에, 명시적으로 연결을 해제한 사용자와 한 번도 로그인한 적
  //    없는 사용자(수동입력·폴백 알람만 쓰는 운용)에게도 세션 시작마다 팝업이 열렸다.
  //    해제 경로는 revoke를 거치므로 그 팝업은 무팝업이 아니라 **동의 화면**이고, 승인하면
  //    `upsertConnection`이 4주 창을 **되살린다** — §2-5의 「명시적 해제 = 최상위 의사」와 충돌.
  //    계획서 §2-6의 P2 전제(*"앱 열고 동기화 없이 바로 세션을 시작하면 토큰이 없어서"*)는
  //    **이미 연결된 사용자**를 상정한 문장이라 이 가드는 계약을 좁히지 않는다.
  if (!isConnectionAlive()) return null;
  return ensureAccessToken().then(() => undefined, () => undefined);
}
