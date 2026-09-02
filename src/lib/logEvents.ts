/**
 * v0.35.2 Stage 2 — 로그 이벤트 extra 문자열 빌더 (SSOT).
 *
 * 계약(SOP-003 파서·과거 zip 하위호환) — 📍 **정본은 `PRINCIPLES.md` §4다. 여기는 요약이다.**
 *  - 이 모듈의 빌더는 기존 콜사이트가 방출하던 extra 문자열과 **바이트 동일**하게 방출한다.
 *    tests/logEvents.spec.ts 특성화 테스트가 기대 문자열을 리터럴로 고정한다 — 여기를 바꾸면
 *    외부 파서(SOP-003)·과거 로그 zip과의 계약이 깨진다.
 *  - 🔴 **「꼬리 확장」은 일반 규칙이 아니라 이벤트별 개별 승인이다**(v0.47.0 · 리뷰 U4).
 *    기본값은 위 줄 그대로 **바이트 영구 불변**이다. 예외는 «그 이벤트에 실소비 파서가 없다»는
 *    전수 grep 실측을 근거로 건별 승인하고 `PRINCIPLES.md` §4 목록에 적는다.
 *    **승인된 예외는 현재 `font_render_echo` 1건**(접두 불변 + 꼬리 확장 허용 —
 *    빌더 주석은 `logEventsInstrumentation.ts`). 목록에 없는 이벤트를 확장해야 하면
 *    필드를 늘리지 말고 **새 이벤트 이름**을 써라.
 *  - 기존 이벤트의 표기(유니코드 '→'/ASCII '->' 혼용 포함)는 바꾸지 않는다 — 이미 방출된
 *    이벤트 문자열은 영원히 그 형태가 정답이다.
 *
 * 신규 이벤트 규약(v0.35.2+ — 새 extra는 이 모듈을 경유한다):
 *  - 🔴 대상은 **이벤트 이름을 새로 만드는 extra**다. 기존 `parsed` 이벤트에 실리는 **필드
 *    문자열**(`screen_off`/`screen_on`의 `src:hold`·`src:tap` 등)은 어휘가 이미 고정돼 있어
 *    콜사이트 인라인을 허용한다 — 새 이름을 만드는 쪽만 빌더를 거친다(V-FIX6b에서 명문화).
 *  - 세그먼트 구분은 ':' — `event:detail` / `event:detail:sub`
 *  - key=value 쌍은 ','로 연결 — `event:key=val,key2=val2` (kv() 사용)
 *  - 전이 표기는 ASCII '->' (유니코드 '→' 금지 — 신규 한정, 기존 이벤트는 불변)
 *  - 에러 접미는 withErr() — `prefix:<message>` 표준화
 *
 * v0.49 R1 리팩토링 P1-3 — 500줄 게이트로 빌더 본문을 도메인별 파일로 분리하고 이 파일은
 * **배럴(re-export)로 유지**한다. 소비처 import 경로는 불변이다(호출부 수정 0 — 플랜 §3-4):
 *  - 마이크·오디오·수명주기 → `logEventsAudio.ts`
 *  - 세션·행 진행 → `logEventsSession.ts`
 *  - 설정·UI 계측 → `logEventsUi.ts`
 *  - v0.44.0 §5-1 계측(선행 분리) → `logEventsInstrumentation.ts`
 * 계약 정본은 계속 이 헤더다 — 도메인 파일 헤더는 여기를 가리킨다.
 */

/** key=value 쌍을 ','로 연결 — 신규 이벤트 표준 표기. 예: kv({row: 3, src: 'voice'}) → 'row=3,src=voice'. */
export function kv(pairs: Record<string, string | number | boolean>): string {
  return Object.entries(pairs)
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
}

/** `${prefix}:${에러 메시지}` — 에러 접미 표준. 기존 콜사이트들의
 *  `String((err as Error)?.message ?? err)` 산출과 바이트 동일. */
export function withErr(prefix: string, err: unknown): string {
  return `${prefix}:${String((err as Error)?.message ?? err)}`;
}

// 마이크·오디오·수명주기 도메인 — 빌더 주석·판정 사다리 설명은 logEventsAudio.ts.
export {
  zombieRestart, micAutoReconnect, micAutoReconnectSkipped, recoverTimeout, micInitFailed,
  audioRouteRevalidate, foregroundReturn, wakeLockEvent,
  visibilityContext, lifecycleSignal, clipArmBlocked, micTeardown,
  beepPlay, feedbackUploadMic, bgEnterSnapshot, bgMicAction,
  type ForegroundReturnTeardownResult, type ForegroundReturnTeardown,
} from './logEventsAudio';

// 세션·행 진행 도메인 — logEventsSession.ts. (WOULD_SALVAGE_PREFIX는 임포터 0이라 — r3 #10이
// 접두 판별을 구조 판별로 대체 — 배럴 재수출 없이 정의 파일에만 둔다. knip 검출 파리티.)
export {
  rowMarked, endReachedRender, anomalyAlertCleared, lowConfidenceParsed,
  wouldSalvage,
  // v0.51.1 B1 — 음성 열 0개 구성의 세션 시작 차단(제보①).
  sessionStartBlocked,
  // v0.51.1 B2 — atEnd에서 비명령 발화가 흡수된 사건(제보②).
  endAbsorb,
  // v0.51.1 L — 동기화 완료(대상 시트·탭·행 범위·건수).
  sheetSynced,
} from './logEventsSession';

// 설정·UI 계측 도메인 — logEventsUi.ts.
export { settingChanged, inputControlPanelOpened, orientationChange } from './logEventsUi';

// v0.44.0 §5-1 계측 빌더 3종(audioInputClass·fontRenderSnapshot·bargeInTextSource)은
// logEventsInstrumentation.ts로 분리했다(500줄 게이트). 소비처 import 경로는 불변이다.
// v0.45.0 WP-1·WP-2 — readyProbe·fontRenderEcho·bgKeep·notifyPerm 동거(같은 분리 파일·같은 계약).
export {
  audioInputClass, fontRenderSnapshot, bargeInTextSource,
  readyProbe, fontRenderEcho, bgKeep, notifyPerm,
  // v0.47.0 W5ⓐ — 에코 전수화가 표시 문자열을 싣게 되면서 필요해진 `extra` 값 이스케이프.
  escapeExtraValue,
  // v0.47.0 W7 V-FIX1ⓒ — 홀드 안내 TTS를 큐잉하지 않고 버린 사건(빈도가 판정 근거다).
  holdTtsSkipped,
  // v0.47.0-r2 P2(FB-C) — 수동입력 보류 중 음성 차단을 **안내**한 사건(종전 무음 차단의 해소).
  manualHoldGuide,
  // v0.51 H3 — 홀드 시작·취소 계측(C1″ vs X2 판별 + H2·H7′ 효과 측정).
  holdStart, holdAbort,
} from './logEventsInstrumentation';
