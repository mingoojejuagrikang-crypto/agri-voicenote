/**
 * v0.50 (2026-08-19) — **「최신인가」를 서비스워커에 묻지 않고 배포본과 직접 대조한다**
 * (리서치 `deliverables/2026-08-19-research-rpwa.md` §P1).
 *
 * ## 왜 필요한가
 * 종전 `UpdateControl`은 `registration.update()`를 부르고 **1.8초 뒤 무조건 「최신 버전입니다」**를
 * 보여줬다. 즉 **오프라인·SW 부재·체크 실패가 전부 「최신」으로 뭉개졌다.** 프리뷰 빌드는 SW가
 * 아예 없어서(v0.46.0~) 그 경로가 **영원히 「최신」만 답했고**, 민구는 08-14 빌드를 5일간 썼다.
 *
 * ## 무엇을 하나
 * 라이브 `index.html`을 캐시 우회로 받아 `assets/index-<hash>.js`를 뽑고, **지금 실행 중인**
 * 번들 해시와 문자열 비교한다. **SW가 통째로 침묵해도 성립한다** — 그게 이 프로브의 존재 이유다.
 *
 * ## 캐시를 두 겹으로 우회한다
 *  ① `?fresh=<ts>` — 매번 다른 URL이라 **workbox precache 매칭이 깨진다**
 *     (기본 `ignoreURLParametersMatching`은 `utm_`/`fbclid`만 무시한다 · 리서치 F10)
 *  ② `cache: 'no-store'` — HTTP 캐시 우회(Safari 10.1+ · 리서치 F5)
 *  🔴 둘 다 필요하다. ①만으로는 HTTP 캐시가, ②만으로는 SW가 가로챌 수 있다.
 *
 * ## 🔴 상태를 다섯으로 가른다 — 「모른다」를 「최신」으로 접지 않는다
 *  · `latest`        해시 일치. **비로소 사실이다.**
 *  · `outdated`      해시 불일치 = 구버전 실행 중.
 *  · `unreachable`   fetch 실패(오프라인·타임아웃). **모르는 것이지 최신이 아니다.**
 *  · `unparseable`   fetch는 됐는데 해시를 못 뽑음(200으로 온 404 페이지 등).
 *  · `indeterminate` **로컬** 번들을 식별할 수 없음(dev 서버 등). 비교 자체가 성립하지 않는다.
 *  🔑 `unreachable`과 `unparseable`을 가르는 이유: 다음 조사가 **CDN 문제인지 코드 문제인지**를
 *     로그만으로 즉시 가른다.
 */
import { logger } from './logger';
import { extractBundleId, isComparableBundleId, readBundleId } from './bundleId';

export type LiveVersionStatus = 'latest' | 'outdated' | 'unreachable' | 'unparseable' | 'indeterminate';

export interface LiveVersionResult {
  status: LiveVersionStatus;
  /** 지금 실행 중인 번들(식별 불가면 `dev`/`unknown`). */
  local: string;
  /** 배포본에서 읽은 번들. 못 읽었으면 없음. */
  live?: string;
}

/** 응답 대기 상한 — 현장 LTE에서 무한정 매달리지 않는다. 실패는 `unreachable`이다. */
const PROBE_TIMEOUT_MS = 8000;

export interface LiveVersionProbeDeps {
  /** 지금 실행 중인 번들 해시. */
  readLocal: () => string;
  /** 라이브 index.html 본문을 가져온다. 실패하면 throw. */
  fetchLiveHtml: () => Promise<string>;
  log: (extra: string) => void;
}

/** 기본 구현 — 캐시를 두 겹으로 우회해 라이브 `index.html`을 받는다. */
async function defaultFetchLiveHtml(): Promise<string> {
  // 🔑 `new URL('index.html', location.href)` — `base: './'`(상대 배포)라서 이게 가장 안전하다.
  //    standalone 시작 URL이 `/agri-voicenote-preview/`든 `/survey-011/`(구 정식)든 그 아래로 정확히 풀린다.
  const url = new URL('index.html', location.href);
  url.searchParams.set('fresh', String(Date.now()));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const r = await fetch(url.toString(), { cache: 'no-store', signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 배포본과 실행 중 번들을 대조한다. **throw하지 않는다** — 모든 실패가 상태로 표현된다.
 *
 * @param deps 테스트 주입용. 실사용은 기본 구현(브라우저 `fetch` + DOM).
 */
export async function probeLiveVersion(deps?: Partial<LiveVersionProbeDeps>): Promise<LiveVersionResult> {
  const readLocal = deps?.readLocal ?? readBundleId;
  const fetchLiveHtml = deps?.fetchLiveHtml ?? defaultFetchLiveHtml;
  const log = deps?.log ?? ((extra: string) => logger.log({ type: 'app', extra }));

  const local = readLocal();
  if (!isComparableBundleId(local)) {
    // dev 서버 등 — 비교의 왼쪽이 없다. 🔴 이걸 「구버전」으로도 「최신」으로도 접지 않는다.
    log(`pwa_version_probe:indeterminate:local=${local}`);
    return { status: 'indeterminate', local };
  }
  let html: string;
  try {
    html = await fetchLiveHtml();
  } catch (e) {
    log(`pwa_version_probe:unreachable:${e instanceof Error ? e.name : 'unknown'}`);
    return { status: 'unreachable', local };
  }
  const live = extractBundleId(html);
  if (!live) {
    // fetch는 성공했는데 해시가 없다 — 200으로 온 404/에러 페이지일 수 있다.
    log('pwa_version_probe:unparseable');
    return { status: 'unparseable', local };
  }
  const status: LiveVersionStatus = live === local ? 'latest' : 'outdated';
  log(`pwa_version_probe:${status}`);
  return { status, local, live };
}
