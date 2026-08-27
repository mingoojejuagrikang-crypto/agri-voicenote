/**
 * v0.51 — **「계정 연결」의 4주 슬라이딩 창.** Google 토큰과 분리된 앱 차원의 연결 개념.
 *
 * ## 왜 생겼나 (민구 08-27: *"최초 로그인시 4주간 유지되고, 앱 사용시마다 4주씩 연장"*)
 * Google 암시적 OAuth 토큰은 ~1시간이면 만료되고 refresh token이 없다([AUTH-4], rauth 실측으로
 * 재확인 — 브라우저만으로는 연장 경로가 없다). 그런데 `useSettingsSheetConnection` 마운트 분기가
 * **토큰 없음 = 연결 풀림**으로 강등해왔다(v0.13.0 R1, `auth_signout:token_expired`) — 즉 토큰
 * 수명이 그대로 UX에 노출됐고, 그것이 민구가 보던 「매시간 로그인 풀림」이다.
 *
 * v0.13.0 당시 그 강등은 **옳았다**: 무팝업 갱신 경로가 없어서 *거짓 「연결됨」 표시*(모든 시트
 * 호출이 실패)보다 정직했다([AUTH-7]). 지금은 `prompt:''` 무팝업 갱신이 실측되고
 * (rauth §2-6 — iOS 26.6 standalone에서 15회 중 13회 ≤2초) `ensureAccessToken()`이 있어서,
 * **정직한 대안이 「강등」 말고 「조용한 갱신」**이 됐다. 그 갱신의 유효기간을 재는 것이 이 모듈이다.
 *
 * ## 계약
 *  - **창 = `lastUsedAt + 28일 > now`.** `connectedAt`은 판정에 쓰지 않는다(진단·표시용).
 *  - **「앱 사용」 = 앱을 여는 것.** 부팅 1회 + `visibilitychange→visible`(App.tsx 배선).
 *    세션·동기화 등 모든 사용이 이걸 경유하므로 별도 지점을 늘리지 않는다.
 *  - 🔴 **touch는 기록만 한다 — 토큰 갱신을 시도하지 않는다.** 부팅·포그라운드 복귀는 사용자
 *    제스처가 아니다. 거기서 `signIn()`을 부르면 rauth P1이 막으려던 「제스처 밖 실패」가
 *    되살아난다(팝업 차단 → `popup_failed_to_open`). 갱신은 제스처 지점(P1 동기화 클릭 ·
 *    P2 세션 시작)에서만.
 *  - 🔴 **check-then-touch.** 판정이 먼저, touch가 나중이다 — 29일차에 열면 **만료**다(엄격
 *    해석, 민구 확정). touch를 먼저 하면 기록이 있는 한 창이 영원히 안 죽어 4주 의도와 모순된다.
 *    그 순서 계약이 배선 위치에 의존하지 않도록 **`touchConnection()` 자신이 죽은 창을 되살리길
 *    거부한다**(아래 aliveness 가드) — 부팅 touch가 설정탭 판정보다 먼저 돌아도 안전하다.
 *  - 🔴 **창 만료는 revoke하지 않는다.** `clearConnection()`은 로컬 상태만 지운다. `signOut()`은
 *    Google `revoke`를 부르는데, revoke하면 grant가 죽어 **이후 무팝업 갱신까지 전부 동의
 *    화면으로 되돌아간다.** revoke는 설정탭 「연결 해제」(사용자 명시 의사)에만 남는다.
 *
 * 저장은 `settingsStore` persist(v13)다 — 신규 raw localStorage 키를 만들지 않는 이유는
 * [AUTH-8] eviction 대응 IDB 미러·breadcrumb를 공짜로 물려받기 위해서다. 토큰
 * (`gs10_google_token`)은 지금처럼 별도 키에 남는다.
 *
 * ⚠️ import 방향: 이 모듈은 `settingsStore`를 **읽는 쪽**이다. 반대 방향(스토어가 이 모듈을
 * import)은 만들지 마라 — `settingsStore → settingsMigrate → googleConnection → settingsStore`
 * 순환이 되고, 하이드레이션이 모듈 평가 도중 돌기 때문에 `[LOGEVENTS-CYCLE-1]`의 "위험 조건"이
 * 실제로 성립하는 자리다. 그래서 **형태 검사(`isConnectionRecord`)만 leaf인 `settingsState.ts`에
 * 산다** — 마이그레이션은 거기서 직접 가져오고, 여기서는 재수출만 한다(호출부는 이 모듈 하나만
 * 알면 된다). 규칙(창 길이·스로틀·판정)은 전부 여기가 SSOT다.
 */
import type { GoogleConnection } from '../types';
import { useSettingsStore } from '../stores/settingsStore';
import { isConnectionRecord } from '../stores/settingsState';
import { logger } from './logger';

/** 형태 검사는 leaf(`settingsState.ts`)가 소유한다 — 위 import 방향 주석 참조. 재수출로 호출부의
 *  import 지점을 이 모듈 하나로 유지한다(`settingsStore.ts`의 단방향 재수출과 같은 처리). */
export { isConnectionRecord };

/** 슬라이딩 창 길이 = 4주. 민구 원문 "4주간 유지 / 사용할 때마다 4주씩 연장". */
export const CONNECTION_WINDOW_MS = 28 * 24 * 60 * 60 * 1000;

/** touch 스로틀 = 1시간. 포그라운드 복귀가 잦아도 persist 쓰기는 시간당 1회로 묶인다.
 *  별도 모듈 상태가 아니라 **저장된 `lastUsedAt` 자체**로 재기 때문에 리로드에도 유효하다. */
const TOUCH_THROTTLE_MS = 60 * 60 * 1000;

/** 순수 판정 — 저장소를 안 본다. 테스트·마이그레이션이 임의 시각으로 부를 수 있게 분리. */
export function isConnectionAliveAt(rec: GoogleConnection | null, now: number): boolean {
  return !!rec && rec.lastUsedAt + CONNECTION_WINDOW_MS > now;
}

/** 현재 영속된 연결 기록(형태 손상은 null). */
export function getConnection(): GoogleConnection | null {
  const c = useSettingsStore.getState().googleConnection;
  return isConnectionRecord(c) ? c : null;
}

/** **연결창이 살아 있는가.** 토큰 유무와 무관하다 — 그게 이 설계의 요점이다. */
export function isConnectionAlive(now: number = Date.now()): boolean {
  return isConnectionAliveAt(getConnection(), now);
}

/** 남은 일수(내림). 계측 문자열용 — 판정에 쓰지 마라(판정은 isConnectionAlive 하나). */
export function connectionDaysLeft(rec: GoogleConnection | null, now: number = Date.now()): number {
  if (!rec) return 0;
  return Math.max(0, Math.floor((rec.lastUsedAt + CONNECTION_WINDOW_MS - now) / 86_400_000));
}

/** 「앱을 열었다」를 기록해 창을 4주 더 민다. **토큰은 건드리지 않는다**(모듈 주석 계약).
 *  - 기록이 없으면 아무것도 만들지 않는다(연결이 없는데 창이 생기면 안 된다).
 *  - 🔴 **이미 만료된 창은 되살리지 않는다** — check-then-touch를 배선 순서와 무관하게 만든다.
 *  - 스로틀: 마지막 기록으로부터 1시간 이내면 쓰기를 건너뛴다. */
export function touchConnection(now: number = Date.now()): void {
  const rec = getConnection();
  if (!rec) return;
  if (!isConnectionAliveAt(rec, now)) return;
  if (now - rec.lastUsedAt < TOUCH_THROTTLE_MS) return;
  // 🔑 계측은 **연장 직전 남은 일수**다. 연장 후 값을 실으면 항상 28이라 정보가 0이 된다 —
  //    알고 싶은 것은 "사용자가 만료에 얼마나 가까워졌다가 돌아왔나"(창 길이 튜닝의 근거)다.
  const leftBefore = connectionDaysLeft(rec, now);
  useSettingsStore.getState().set({ googleConnection: { ...rec, lastUsedAt: now } });
  logger.log({ type: 'app', extra: `auth_connection_touch:left=${leftBefore}` });
}

/** 토큰이 실제로 확정된 순간(googleAuth 콜백의 `storeToken` 직후) 연결 기록을 세우거나 갱신한다.
 *  `connectedAt`은 기존 기록이 있으면 보존한다 — "언제부터 연결돼 있었나"는 진단 정보다. */
export function upsertConnection(email: string | null, now: number = Date.now()): void {
  const prev = getConnection();
  const next: GoogleConnection = {
    email: email ?? prev?.email ?? null,
    connectedAt: prev?.connectedAt ?? now,
    lastUsedAt: now,
  };
  useSettingsStore.getState().set({ googleConnection: next });
  if (!prev) logger.log({ type: 'app', extra: 'auth_connection_opened' });
}

/** 연결 기록을 지운다. 🔴 **revoke하지 않는다** — 모듈 주석의 계약. 창 만료(자동)와
 *  전체 초기화의 로그인 삭제 옵트인이 이 경로를 쓴다. 설정탭 「연결 해제」 버튼만 `signOut()`. */
export function clearConnection(reason: 'connection_expired' | 'settings_reset' | 'manual'): void {
  if (!useSettingsStore.getState().googleConnection) return;
  useSettingsStore.getState().set({ googleConnection: null });
  logger.log({ type: 'app', extra: `auth_connection_cleared:${reason}` });
}
