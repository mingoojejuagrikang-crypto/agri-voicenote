/**
 * **동기화·업로드 경로의 인증 갱신 가드** — 「세션이 살아 있는 동안에는 갱신하지 않는다」.
 *
 * v0.51 r4에서 `useDataActions.ts`가 `max-lines`(500)를 넘어 여기로 뺐다. 응집 단위가 분명해서
 * 고른 이음새다: 이 술어는 `runSyncInner`의 지역 상태를 하나도 안 쓰고 **모듈 수준 판정**만 한다
 * (세션 phase · 저장 토큰 · 로깅). 🔴 **본문 무수정**(들여쓰기 10칸 제거만 — [ENV-12] 관행).
 *
 * 계약과 근거는 아래 블록 주석이 그대로 갖는다. 요약하면 **녹음 무결성 > 갱신 편의**다.
 */
import { logger } from './logger';
import { getStoredToken, signIn } from './googleAuth';
import { ensureAccessToken } from './googleAuthRefresh';
import { useSessionStore, isSessionLive } from '../stores/sessionStore';
import { statusCardLogin } from './logEvents';

// ── 🔴 v0.51 r2 [F-3 잔존 + F-4 교차] — **세션 중에는 여기서도 갱신하지 않는다.** ──
//
// r1의 [F-3]은 클릭 선두(preRefresh)만 막았다. 그런데 「세션 중 갱신 절대 금지」
// (계획서 §2-6 · rauth §2-6 실측: GIS 팝업이 앱을 1~2초 백그라운드로 보낸다 =
// [CLIP-SILENT-1]·[CLIP-LOSS-1]의 조건)에는 **옆문이 둘 더** 있었다:
//   ① 이 업로드 직전 `ensureAccessToken()` — 클릭 직후라면 transient activation이
//      아직 살아 있어 제스처 가드를 통과한다.
//   ② `withAuthRetry`에 주입하는 `ensureAuth({force:true})` — r1 [F-4]가 제스처 가드를
//      **면제**했으므로 activation과 무관하게 팝업을 연다.
// 둘 다 세션 live 중 녹음 위로 팝업을 띄울 수 있다 = **녹음 데이터 유실**.
//
// 판정(민구/Larry triage): **녹음 무결성 계약이 갱신 편의보다 위다.** 세션 중 진짜 만료는
// 「보이는 실패」로 넘긴다 — 종전 실패 경로(`needsLogin` → LoginRequiredModal)로 수렴하고,
// 그 모달의 [로그인] 클릭은 **사용자 명시 의사**라 세션 중에도 그대로 허용한다(기존 동작).
// 세션 **밖** 동기화(대부분의 실사용)에서는 [F-4] 면제가 그대로 산다.
//
// 🔴 가드는 `googleAuth`가 아니라 **호출부**에 둔다 — 세션 개념은 `useDataActions`의
//    것이고, `googleAuth`를 세션 스토어에 묶으면 P2(동결 코어)까지 얽힌다.
//    술어는 [F-3]과 **같다**(`isSessionLive(useSessionStore.getState().phase)`).
export const ensureAuthUnlessSessionLive = async (o?: { force?: boolean }): Promise<boolean> => {
  // 유효 토큰이면 애초에 갱신 시도가 없다 — 그 경우까지 「skipped」로 남기면 계측이
  // 「세션 때문에 갱신을 못 했다」를 과대 집계한다(그대로 `auth_ensure:hit`이 나야 한다).
  if (!o?.force && getStoredToken()) return ensureAccessToken(o);
  if (isSessionLive(useSessionStore.getState().phase)) {
    logger.log({
      type: 'app',
      extra: `auth_ensure:skipped:session_live${o?.force ? ':forced' : ''}`,
    });
    return false;
  }
  return ensureAccessToken(o);
};

/** v0.55.0 C-2 — 연결 상태 카드 [탭해서 갱신] 로그인 핸들러. */
export function reloginUnlessSessionLive(): Promise<boolean> {
  if (isSessionLive(useSessionStore.getState().phase)) {
    logger.log({ type: 'app', extra: statusCardLogin('skipped_session_live') });
    return Promise.resolve(false);
  }
  logger.log({ type: 'app', extra: statusCardLogin('clicked') });
  return signIn().then(() => true, () => false);
}
