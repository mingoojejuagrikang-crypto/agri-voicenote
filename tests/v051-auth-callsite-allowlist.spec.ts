/**
 * v0.51 r3 [F-20 / codex cx-L2 + open3] — **인증 진입점 호출부 allowlist(정적 오라클).**
 *
 * ## 왜 정적 오라클인가
 * v0.51이 세운 계약들 — 「세션 중 갱신 금지」(계획서 §2-6) · 「창이 죽었으면 자동 갱신 없음」
 * ([F-13]) · 「제스처 안에서만」(rauth P1) — 은 **호출부에 걸린 가드**로 지켜진다.
 * `ensureAccessToken({force})` 자체에는 세션 가드가 없다(세션 개념은 `useDataActions`의 것이라
 * 의도적으로 그렇게 뒀다 — r2). 그 말은 **새 호출부가 하나 생기면 계약이 조용히 우회된다**는 뜻이다.
 * 런타임 오라클은 「지금 있는 호출부」만 재므로 그 축을 못 잡는다. 그래서 **호출부 집합 자체**를
 * 고정한다 — 파일이 하나 늘면 여기서 red가 나고, 그때 사람이 「이 호출부에도 가드가 필요한가」를
 * 판단하게 된다.
 *
 * ## 판정 방식
 * `googleAuth`에서 **인증을 개시하는 심볼**을 import하는 파일 집합을 센다(호출 문법 grep이 아니라
 * import 기준 — 주석 안의 `signIn()` 언급이나 `googleSignIn(` 별칭에 흔들리지 않는다).
 * 읽기 전용 심볼(`getAccessToken`·`getStoredToken`·`onTokenSettled`·`isConfigured`…)과
 * `signOut`은 인증을 **개시**하지 않으므로 대상이 아니다.
 *
 * 새 호출부를 정당하게 추가했다면: **가드를 먼저 확인하고** 아래 `ALLOWED`에 근거 주석과 함께 넣어라.
 */
import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** 인증을 **개시**하는 진입점(팝업을 열 수 있는 것). 읽기 전용 조회는 여기 없다. */
const INITIATORS = ['signIn', 'ensureAccessToken', 'refreshBeforeSessionStart'] as const;

/** 🔴 호출부 allowlist — 각 항목은 **어떤 가드를 지고 있는지**가 근거다. */
const ALLOWED: Record<string, string> = {
  'src/lib/useDataActions.ts':
    'P1 선제 갱신(세션 활성 가드 r1[F-3]) · 업로드 직전 ensure와 force 재시도(세션 활성 가드 r2) · 재로그인 모달 signIn(사용자 명시 의사)',
  'src/lib/useSettingsSheetConnection.ts':
    '설정탭 Google 로그인 버튼 — 사용자 명시 의사(signIn 직접 호출이라 자동 갱신 게이트를 지나지 않는다)',
  'src/lib/syncAuthGuard.ts':
    '동기화·업로드 경로의 세션 활성 가드 그 자체 — 세션 live면 갱신 없이 false(r2). r4에서 useDataActions에서 분리했고 가드 술어를 이 파일이 소유한다',
  'src/lib/useVoiceSession.ts':
    'P2 세션 시작 선제 갱신 — 마이크 획득 이전 · 연결 가드(refreshBeforeSessionStart 내부 isConnectionAlive) · r4부터 googleAuthRefresh에서 직접 import',
};

/** googleAuth 자신은 정의처라 대상에서 제외한다. */
const SELF_MODULES = ['src/lib/googleAuth.ts', 'src/lib/googleAuthRefresh.ts'];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** 파일이 **인증 모듈군**에서 가져오는 심볼 이름들(별칭 앞의 원래 이름).
 *
 *  🔴 v0.51 r4 — `googleAuth.ts`가 `max-lines`를 넘어 분리되면서 이 오라클이 **정확히 red를 냈다**
 *  (`refreshBeforeSessionStart`가 `./googleAuthRefresh`로 옮겨가자 `useVoiceSession`이 집합에서
 *  사라졌다). 그게 이 스펙이 살아 있다는 증거다 — 「호출부 집합」은 파일이 갈려도 하나다.
 *  그래서 판정 대상을 **모듈 하나가 아니라 인증 모듈군**(basename이 `googleAuth`로 시작)으로
 *  넓힌다. 앞으로 정책층이 더 갈려도(`googleAuthXxx.ts`) 집합 판정은 그대로 성립한다.
 *  ⚠️ `googleTokenStore`는 대상이 아니다 — 인증을 **개시**하지 않는 읽기/쓰기 leaf다. */
function importedFromGoogleAuth(src: string): string[] {
  const names: string[] = [];
  const re = /import\s*\{([^}]*)\}\s*from\s*['"][^'"]*\/googleAuth[A-Za-z]*['"]/g;
  for (const m of src.matchAll(re)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name) names.push(name);
    }
  }
  return names;
}

test('[node] F-20 — 인증 개시 함수의 호출부 집합이 allowlist와 정확히 일치한다', () => {
  const root = join(process.cwd(), 'src');
  const found: string[] = [];
  for (const abs of walk(root)) {
    const rel = relative(process.cwd(), abs);
    if (SELF_MODULES.includes(rel)) continue; // 정의처(기계부·정책층)는 대상이 아니다
    const names = importedFromGoogleAuth(readFileSync(abs, 'utf8'));
    if (names.some((n) => (INITIATORS as readonly string[]).includes(n))) found.push(rel);
  }

  const expected = Object.keys(ALLOWED).sort();
  const actual = found.sort();

  // 🔴 실패 메시지가 곧 다음 사람에게 주는 지시다.
  expect(actual, [
    '인증 개시 함수(signIn / ensureAccessToken / refreshBeforeSessionStart)의 호출부 집합이 바뀌었다.',
    '이 함수들에는 세션·연결 가드가 **호출부에** 걸려 있다(v0.51 r1~r3). 새 호출부는 그 가드를',
    '자동으로 물려받지 않는다 — 계약이 조용히 우회되는 자리다.',
    '정당한 추가라면: ① 그 호출부에 세션 활성 가드가 필요한가 ② 연결창 게이트로 충분한가를',
    '판단하고, 이 스펙의 ALLOWED에 **근거와 함께** 등재하라.',
  ].join('\n')).toEqual(expected);
});

test('[node] F-20 — allowlist 항목은 전부 실재하고 근거가 비어 있지 않다', () => {
  for (const [file, why] of Object.entries(ALLOWED)) {
    expect(() => readFileSync(join(process.cwd(), file), 'utf8'), `${file} 없음`).not.toThrow();
    expect(why.length, `${file}의 등재 근거가 비었다`).toBeGreaterThan(20);
  }
});
