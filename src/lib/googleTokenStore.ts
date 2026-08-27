/**
 * Google 액세스 토큰의 **로컬 저장소 leaf** (`gs10_google_token`).
 *
 * [ENV-12] 계보의 분리다 — v0.51 r4에서 `googleAuth.ts`가 666줄이 되어 `max-lines`(500)를 넘었고,
 * ENV-12 예외는 오디오 3파일뿐이라 **disable이 아니라 분리로** 풀었다(08-07 VoiceHero 전례).
 * 경계는 **「GIS를 아는가」**다: 이 파일은 GIS도 flight도 모르고 `localStorage` 한 키만 안다.
 * 그래서 의존성이 **0**이고 어느 방향에서 import해도 순환이 생기지 않는다.
 *
 * 🔴 **본문은 무수정으로 옮겼다**(치환 0 · 바이트 동일). 호출부 10곳의 import 경로는
 * `googleAuth.ts`의 **단방향 재수출**이 그대로 보존한다(`settingsStore.ts`가 `settingsState`를
 * 재수출하는 것과 같은 관행) — 이동 커밋이 참조 갱신을 끌고 오지 않게 하는 장치다.
 * ⚠️ 이동 중 본문에 가한 유일한 변경은 **`export` 키워드 4개**(원본에서 module-private였던
 *    `StoredToken`·`getRawStoredToken`·`storeToken`·`clearToken`)다. [ENV-12]가 들여쓰기 제거를
 *    허용한 것과 같은 범주 — 로직·문자열은 바이트 그대로다.
 *
 * ⚠️ 여기 두 술어는 **다른 질문**이다 — 섞지 마라:
 *  · `getStoredToken()` = 「지금 **쓸 수 있는** 토큰인가」(만료 5분 전부터 null, rauth P3)
 *  · `getRawStoredToken()` = 「**지워야 할 것**이 있는가」(마진 무시 — revoke 대상 조회, r3 [F-16])
 */

const STORAGE_KEY = 'gs10_google_token';

export interface StoredToken {
  access_token: string;
  expires_at: number; // ms epoch
  email?: string;
}

export function getStoredToken(): StoredToken | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as StoredToken;
    // v0.51 [rauth P3] — 만료 **조기판정 마진 60초 → 5분**.
    // 우리 60초는 구글 공식 라이브러리 관행보다 3~5배 짧았다:
    //   `google-auth-library-nodejs` DEFAULT_EAGER_REFRESH_THRESHOLD_MILLIS = 5분
    //   `google-auth-library-python` REFRESH_THRESHOLD = 3분 45초
    // 2026-08-19 실측 10:21:50 실패는 마진 경계를 넘은 지 **11초 뒤**였다 — 5분 마진이면 그
    // 회차는 동기화 클릭 시점에 이미 "갱신 필요"로 잡혀 P1이 제스처 안에서 처리했을 것이다.
    // 대가: 유효 토큰을 5분 일찍 버린다 = 갱신 **시점**만 당겨지고 **빈도는 그대로**(1시간 1회).
    // 🔴 **P1과 세트로만 유효하다**(rauth P3ⓓ) — P1 없이 이것만 키우면 갱신 시도가 더 자주
    //    제스처 밖에서 실패한다. 앞 커밋이 P1이다.
    if (t.expires_at < Date.now() + 300_000) return null; // expire 5 min early
    return t;
  } catch {
    return null;
  }
}

/** v0.51 r3 [F-16 / codex cx-M1] — **마진을 적용하지 않은** 원시 저장 토큰.
 *
 *  `getStoredToken()`은 만료 5분 전부터 null을 돌려준다(P3 조기판정). 그 술어를 `signOut()`의
 *  **revoke 대상 조회**에 쓰면, 실제로는 아직 4분 남은 살아 있는 토큰을 「없다」고 보고 revoke를
 *  건너뛴다 — 사용자가 「연결 해제」를 눌렀는데 **Google 쪽 grant는 그대로 살아 있는** 상태가 된다
 *  (해제의 의미가 반쪽이 되고, 이후 무팝업 갱신이 계속 성립한다).
 *  「쓸 수 있는가」(마진 O)와 「지워야 할 것이 있는가」(마진 X)는 **다른 질문**이라 술어를 나눈다. */
export function getRawStoredToken(): StoredToken | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as StoredToken;
    return typeof t?.access_token === 'string' && t.access_token ? t : null;
  } catch {
    return null;
  }
}

export function storeToken(t: StoredToken) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
}

export function clearToken() {
  localStorage.removeItem(STORAGE_KEY);
}

/** v0.51 r1 [F-9 / 리뷰 L-3] — **저장된 토큰 레코드를 지운다(revoke 없음).**
 *  창 만료 강등 경로가 쓴다. 그 분기의 진입 조건이 `!getStoredToken()`이라 「기능상 없는 토큰」이긴
 *  하지만, 5분 조기판정 마진(`getStoredToken`) 때문에 **만료 5분 전 토큰이 원시 문자열로 무기한
 *  잔존**할 수 있다. 기능 영향은 없고(모든 읽기가 `getStoredToken`을 거친다) `settings_hydrated:
 *  …,token=Y` 계측이 오독을 유발하는 것이 문제다 — 그 오독을 제거한다.
 *  🔴 `signOut()`과 다르다: 여기엔 `revoke`가 없다(계획서 §2-5 — revoke하면 grant가 죽는다). */
export function clearStoredToken(): void {
  clearToken();
}

export function getAccessToken(): string | null {
  return getStoredToken()?.access_token || null;
}

export function getCurrentEmail(): string | null {
  return getStoredToken()?.email || null;
}
