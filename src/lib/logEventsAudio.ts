/**
 * v0.49 R1 리팩토링 P1-3 — 로그 이벤트 빌더 «마이크·오디오·수명주기» 도메인
 * (logEvents.ts에서 순수 이동 — 500줄 게이트).
 *
 * 🔴 소비처는 계속 `./logEvents`(배럴)에서 import한다 — 바이트 계약·SOP-003 파서 매핑·계약
 * 전문(꼬리 확장 금지 등)은 전부 `logEvents.ts` 헤더가 정본이다. 이 파일은 빌더 본문만 옮겼고
 * 방출 문자열은 이동 전과 바이트 동일하다(tests/logEvents.spec.ts 특성화 테스트가 고정).
 *
 * ⚠️ `kv`를 logEvents에서 가져오는 순환 import는 안전하다: 두 파일 모두 최상위 실행 없이
 * 함수 정의만 export한다(ESM 함수 호이스팅 — 호출은 런타임에만 일어난다.
 * logEventsInstrumentation.ts가 같은 패턴의 전례다).
 */
import { kv } from './logEvents';

/** `lifecycle:zombie_restart:stale_ms=<ms>,n=<streak>` — STT 좀비 재시작 진단.
 *  stale_ms/n 순서는 SOP-003 판독 계약이므로 이 빌더와 특성화 테스트에서 고정한다. */
export function zombieRestart(staleMs: number, streak: number): string {
  return `lifecycle:zombie_restart:${kv({ stale_ms: staleMs, n: streak })}`;
}

/** v0.38.0 #5 — 사용자 제스처 밖 자동 마이크 재연결의 시도/결과.
 *  기존 mic_reconnect_* 이벤트는 수동 경로와 공유하므로, 이 이벤트만으로 자동 경로를 식별한다. */
export function micAutoReconnect(stage: 'attempt' | 'ok' | 'failed'): string {
  return stage === 'attempt'
    ? 'mic_auto_reconnect:attempt'
    : `mic_auto_reconnect:${kv({ result: stage })}`;
}

/** v0.50 r2 [CF-1] — 자동 재연결을 **시도하지 않고 건너뛴** 경우.
 *
 *  `stream_live`: 스트림이 아직 살아 있다(트랙이 `ended`가 아니다). `recoverStream`은
 *  destructive-first라 그 상태에서 자동으로 부르면 **멀쩡한 스트림을 먼저 버린다** —
 *  v0.22.0 P0가 롤백한 사고이고 `[IOS-5]` 종결 정책이다. 재획득은 사용자 제스처에 맡기고
 *  배너를 즉시 세운다.
 *
 *  🔴 기존 `mic_auto_reconnect:attempt` / `:result=ok|failed` 문자열은 **바이트 불변**이다 —
 *  이건 **신규 접미**이고 소비자는 접두(`mic_auto_reconnect:`)로 읽는다. */
export function micAutoReconnectSkipped(reason: 'stream_live'): string {
  return `mic_auto_reconnect:${kv({ skipped: reason })}`;
}

/** v0.38.0 리뷰#1 — 재획득 `getUserMedia`가 **응답 없이 보류**돼 타임아웃으로 포기한 경우.
 *
 *  기존 `clip_recorder_recover_failed:<reason>:<message>`(거부·오류)와 **별도 이벤트**로 둔다.
 *  거부와 보류는 현장 원인이 다르기 때문 — 거부는 권한/정책, 보류는 OS·브라우저 교착이라
 *  로그에서 섞이면 실기기 판독이 불가능하다. 기존 문자열은 바이트 계약이라 변경하지 않는다. */
export function recoverTimeout(reason: string, ms: number): string {
  return `clip_recorder_recover_timeout:${reason}:${kv({ ms })}`;
}

/** v0.44.1 [CLIP-INIT-SILENT-1] — 세션 시작 클릭의 선행 마이크 획득(F18 init)이 실패한 사건.
 *
 *  2026-08-05 실기기(sess_1785877588821): 85분 백그라운드 복귀 뒤 시작 클릭의 getUserMedia가
 *  즉시 거부됐는데(iOS 오디오 세션 물림 — [MIC-B2] 클래스) **어떤 이벤트도 안 남아** 37분·63행이
 *  클립 0개로 돌았다(첫 흔적이 40초 뒤 첫 커밋의 clip_empty). 이 이벤트가 그 공백을 메운다 —
 *  `err`는 DOMException.name(NotAllowedError=거부/물림 · NotFoundError=장치 없음 등),
 *  실패 사유를 몰랐으면 'unknown'. 시작 클릭당 최대 1건이라 링버퍼 잠식 없음. */
export function micInitFailed(errName: string): string {
  return `mic_init_failed:${kv({ err: errName })}`;
}

/** v0.38.1 [MIC-B2] 포그라운드 복귀 선-정리(`AudioRecorder.teardownAudioGraph`) 결과 —
 *  **실기기 판정 사다리의 핵심 바이트**.
 *
 *  세 필드가 각각 다른 결론을 가른다(#12-bis — 계측 없이는 "고쳐도 안 풀린 것"과 "애초에 아무것도
 *  안 한 것"을 구분할 수 없다):
 *   - `found`    닫으려 한 컨텍스트 상태. `none`이면 **닫을 게 없었다** = 이 수정이 no-op이었고
 *                원인은 JS측 AudioContext가 아니다(세션-레벨 물림) → 폴백(리로드)으로 분기.
 *   - `closed`   낡은 컨텍스트 close 결과. `timeout`이면 **close 자체가 물렸다**.
 *   - `reattach` 정리 후 캡처 재부착 결과. `ok`가 아니면 마이크는 멀쩡한데 **프리롤·파형만 죽은** 상태다.
 *
 *  ⚠️ 초안(R1)은 필드를 `:`로 잇고 이벤트·경과를 `vis:bg=3000s`로 박아 **세그먼트가 모호**했다
 *  (`reason` 안에 `:`가 들어가 `split(':')` 파서가 필드를 쪼갠다). 이 파일 헤더의 신규 이벤트
 *  규약대로 **kv(',')로 통일**한다 — 배포 전이라 지금 바꾸는 것이 무비용이고, 한 번 방출되면
 *  그 형태가 영원히 정답이 된다. */
/** v0.38.2 F5 — 포그라운드 복귀 시 **오디오 경로 재검증** 결과.
 *
 *  **메우는 공백:** 백그라운드에서는 `devicechange`가 발화하지 않는다. 그래서 2026-07-24 실기기
 *  세션B의 "BT 이어폰 → 아이폰 스피커" 전환은 **어떤 이벤트로도 남지 않았고**, 트리거를 추론으로만
 *  세워야 했다(로그 분석 §2.4). 이 이벤트가 그 구간의 유일한 관측점이다.
 *
 *  `before`는 **백그라운드 진입 시점의 스냅샷**이다(`foregroundReturnPolicy`의 `hiddenInputLabel`).
 *  복귀 후 둘 다 읽으면 항상 같은 값이라 경로 변경을 판정할 수 없다 — 그 설계를 쓰면 이 이벤트가
 *  존재 이유를 잃는다.
 *
 *  값은 raw 장치명이 아니라 `classifyInputDevice`의 **CATEGORY**(내장 마이크/블루투스/유선 이어폰)다.
 *  raw 라벨은 OS·브라우저마다 표기가 제각각이라 로그 대조에 쓸 수 없고, 개인 장치명이 로그에 남는
 *  것도 피한다. 진입 스냅샷이 없으면 `before=unknown`.
 *
 *  `mic_teardown`과 **같은 복귀 이벤트에서 짝으로** 읽는다 — teardown이 `found=none`인데 경로가
 *  바뀌었다면 원인이 JS측 AudioContext가 아니라는 근거가 된다.
 *
 *  🔴 `status`는 **계측이 자기 실패를 숨기지 않게** 한다(라운드A 리뷰 Codex #1·#2).
 *  `ok`=실제로 다시 읽었다 / `unavailable`=읽을 대상이 없었다 / `error`=읽으려다 실패했다.
 *  `ok`가 아니면 `after`는 `unknown`이며, **그 복귀는 경로를 관측하지 못한 것**이다 — 이 구분이
 *  없으면 "재검증했는데 그대로였다"와 "재검증 자체가 실패했다"가 로그에서 같아 보인다.
 *
 *  🔴 v0.42.0 계측 F — **`catch` 침묵만 메운다.** 2026-07-29에 이 이벤트가 **0건**이었는데
 *  그 0이 무엇의 0인지 판정할 수 없었다. 조기 반환이 세 갈래였기 때문이다:
 *  `!rec` / 방출 게이트 / `catch`.
 *
 *  실측으로 세 갈래를 갈라보니 **둘은 이미 다른 이벤트가 덮고 있었다**(07-29 복귀 5건 대조):
 *   - `!rec` → 같은 복귀의 `foreground_return:teardown=no_recorder`가 남긴다(`bg_s=256`·`7058`)
 *   - 게이트 → 같은 복귀의 `foreground_return:bg_s`가 임계 미달을 보여준다(`bg_s=48`·`15`)
 *   - `catch` → **어떤 이벤트로도 남지 않는다** ← 진짜 공백
 *
 *  그래서 `catch`에서만 `status='error'`로 1건 남긴다. `bg_s=67,teardown=completed`(레코더도
 *  있었고 게이트도 통과했는데 침묵)의 정체를 다음 회차가 판정할 수 있게 하는 것이 목적이다.
 *
 *  ⚠️ **세 갈래를 전부 방출하려던 초안은 게이트에서 반증됐다.** `[F5]` 스펙이 *"임계 미만
 *  복귀는 무발행"* 을 **링버퍼 잠식 방지** 계약으로 못박고 있고, 실제로 전수 방출하자 레코더가
 *  붙기 전 복귀(`bg_s=0` 즉시 pageshow 포함)까지 4건이 쌓였다. 로그는 2000개 링버퍼다 —
 *  **계측을 늘리면 다른 계측이 밀려난다.** 이미 관측 가능한 것을 중복으로 남기지 마라. */
export function audioRouteRevalidate(fields: {
  before: string;
  after: string;
  track: 'none' | 'ended' | 'muted' | 'live';
  status: 'ok' | 'unavailable' | 'error';
  evt: string;
  backgroundMs: number;
}): string {
  return `audio_route_revalidate:${kv({
    before: fields.before,
    after: fields.after,
    track: fields.track,
    status: fields.status,
    evt: fields.evt,
    bg_s: Math.round(fields.backgroundMs / 1000),
  })}`;
}

/** 🔴 F6(2026-07-27 실기기 분석) — **포그라운드 복귀를 빠짐없이 1건 남긴다.**
 *
 *  왜 필요한가: `shouldTeardown=false`인 복귀(임계 미달)는 v0.39.0까지 **아무 이벤트도 남기지
 *  않았다.** 그래서 2026-07-27 회차에서 `mic_teardown` 0건을 두고 "판단해서 건너뛴 것"인지
 *  "훅이 아예 안 돈 것"인지 **구별할 수 없었고**, [MIC-B2] 판정 사다리가 통째로 미결로 남았다.
 *  (그 회차의 bg 58.2s < 임계 60s라는 사실조차 `vis_hidden`/`vis_visible` 두 이벤트를 **손으로
 *  뺀 것**이지 계측이 알려준 게 아니다.)
 *
 *  `teardown`은 임계 미달 / 대상 없음 / 실제 완료 / 실패를 서로 다른 값으로 남긴다.
 *  이벤트가 **없으면** 실제 hidden 사이클의 복귀가 아니었다 — 이 구분이 다음 회차 판정을
 *  가능하게 만든다. */
export type ForegroundReturnTeardownResult = 'completed' | 'failed';
export type ForegroundReturnTeardown =
  | 'skipped'
  | 'no_recorder'
  | ForegroundReturnTeardownResult;

export function foregroundReturn(fields: {
  backgroundMs: number;
  teardown: ForegroundReturnTeardown;
  evt: string;
}): string {
  return `foreground_return:${kv({
    bg_s: Math.round(fields.backgroundMs / 1000),
    teardown: fields.teardown,
    evt: fields.evt,
  })}`;
}

/** [WAKELOCK-LOG-1] 화면 wake lock의 요청·결과·해제 전 경로.
 *  실패 reason은 Error.name 같은 저카디널리티 분류만 받는다(원문 메시지/PII 금지). */
export function wakeLockEvent(fields: {
  action: 'acquire' | 'reacquire' | 'release';
  result: 'attempt' | 'ok' | 'failed' | 'unsupported';
  source?: 'browser' | 'cleanup' | 'late_request';
  reason?: string;
}): string {
  return `wake_lock:${kv({
    action: fields.action,
    result: fields.result,
    ...(fields.source ? { source: fields.source } : {}),
    ...(fields.reason ? { reason: fields.reason } : {}),
  })}`;
}

/** [SCREEN-LOCK-1] visibility 전환 순간까지 실제 관측된 수명주기 신호.
 *  `evidence=none`은 화면 잠금/앱 전환을 웹 표준 신호만으로 구별하지 못했다는 뜻이다. */
export function visibilityContext(fields: {
  state: 'hidden' | 'visible';
  focus: boolean;
  evidence: string;
}): string {
  return `visibility_context:${kv({
    state: fields.state,
    focus: fields.focus,
    evidence: fields.evidence,
  })}`;
}

/** [SCREEN-LOCK-1] blur/pagehide/freeze 및 대응 복귀 신호를 추측 없이 원형대로 기록한다. */
export function lifecycleSignal(fields: {
  signal: 'blur' | 'focus' | 'pagehide' | 'pageshow' | 'freeze' | 'resume';
  visibility: 'hidden' | 'visible';
  focus: boolean;
  persisted: 'yes' | 'no' | 'na';
}): string {
  return `lifecycle_signal:${kv({
    signal: fields.signal,
    vis: fields.visibility,
    focus: fields.focus,
    persisted: fields.persisted,
  })}`;
}

/** [CLIP-WINDOW-2] UI suspend 래치가 신규 셀 녹음창 개시를 차단한 요청. */
export function clipArmBlocked(fields: {
  reason: string;
  row: number;
  col: string;
}): string {
  return `clip_arm_blocked:${kv(fields)}`;
}

export function micTeardown(fields: {
  found: string;
  closed: 'ok' | 'timeout' | 'error';
  reattach: 'ok' | 'timeout' | 'error' | 'skipped';
  evt: string;
  backgroundMs: number;
}): string {
  return `mic_teardown:${kv({
    found: fields.found,
    closed: fields.closed,
    reattach: fields.reattach,
    evt: fields.evt,
    bg_s: Math.round(fields.backgroundMs / 1000),
  })}`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * v0.42.0 계측 — 2026-07-29 실기기 회차가 "판정 불가"로 닫은 축들을 연다.
 *
 * 🔑 이 묶음의 공통 원칙: **어떤 이벤트도 0건이 두 가지 뜻을 갖게 두지 않는다.**
 * 배선이 틀린 계측과 재현되지 않은 결함은 로그에서 똑같이 0건으로 보인다(`[FG-RETURN-LOG-1]`).
 * 그래서 "일어나지 않았다"를 남기는 값(`skipped`·`silent`·`none`)을 유니온에 명시한다.
 *
 * ⚠️ 신규 이벤트를 추가할 때는 **볼트 `SOP-003` 파서 매핑표도 함께 갱신**해야 한다.
 * 안 하면 이벤트는 남는데 다음 회차 분석이 읽지 못한다(v0.39.0 `trend_alert_fired` 전례).
 * ──────────────────────────────────────────────────────────────────────────── */

/** 계측 A — **알람음 재생 시도와 그 결과.** 제보 #5 *"알람음이 안 들린다"*의 3갈래를 가른다.
 *
 *  현재 `beep.ts`에는 **로깅이 전무**하고 07-29 로그의 `beep` 이벤트는 0건이다. 그래서
 *  ①호출 자체가 없었다 ②호출됐으나 무음이었다 ③TTS에 묻혔다 — 셋을 구별할 수 없다.
 *  `playBeep`·`playSchedule`이 둘 다 `catch {}`로 삼키는 구조라 실패도 흔적이 없다.
 *
 *  `result`가 셋을 가른다:
 *   - `played`     오실레이터를 실제로 스케줄했다. 안 들렸다면 원인은 앱 밖(무음 스위치·볼륨·TTS 중첩)
 *   - `no_ctx`     `getCtx()`가 null — AudioContext 자체가 없다(iOS 제스처 미획득 등)
 *   - `suspended`  ctx가 있으나 `state='suspended'` — **스케줄해도 소리가 안 난다.** 가장 유력한 무음 원인
 *   - `silent`     마스터 게인이 0 — 볼륨 설정이 0이거나 배수가 0으로 클램프됐다
 *   - `empty`      재생할 톤이 0개 — 변형 조회가 빈 스케줄을 냈다
 *   - `error`      예외
 *
 *  `gain`은 실제 적용된 마스터 배수(소수 3자리)다. `silent` 판정의 근거를 남긴다.
 *
 *  🔴 **`ctx`에 iOS 전용 `interrupted`를 별도 값으로 둔다**(구현 중 레인 질의로 드러났다).
 *  TS DOM의 `AudioContextState`는 이 값을 포함하는데, 초안 유니온에는 없어서 `suspended`로
 *  정규화할 뻔했다. **그러면 안 된다** — 이 앱은 농가 현장에서 아이폰으로 돌고, 전화·Siri
 *  인터럽션은 일상이다. `suspended`(사용자 제스처 전 미개시)와 `interrupted`(개시됐다가
 *  OS가 뺏음)는 **원인도 대응도 다른데** 뭉개면 로그에서 영원히 구분되지 않는다.
 *  제보 #5 "알람음 안 들림"의 유력 후보라 더더욱 갈라야 한다.
 *
 *  `result`는 뭉개도 된다 — `interrupted`든 `suspended`든 *"스케줄해도 소리가 안 난다"*는
 *  **결과는 같다**(`result='suspended'`). 두 필드는 직교한다: `result`=무슨 일이 벌어졌나,
 *  `ctx`=왜 그랬나. */
export function beepPlay(fields: {
  kind: string;
  result: 'played' | 'no_ctx' | 'suspended' | 'silent' | 'empty' | 'error';
  ctx: 'running' | 'suspended' | 'interrupted' | 'closed' | 'none';
  gain: number;
  tones: number;
}): string {
  return `beep_play:${kv({
    kind: fields.kind,
    result: fields.result,
    ctx: fields.ctx,
    gain: Math.round(fields.gain * 1000) / 1000,
    tones: fields.tones,
  })}`;
}

/** 계측 G — **개선요청 업로드가 마이크를 죽이는가.** 07-29 최대 미판정 축.
 *
 *  **왜 초 단위로는 안 갈리나:** 모달 닫힘 10건을 갈라보니 실제 업로드 6건 중 **5건**에서 마이크가
 *  죽었고 취소·큐잉 4건은 **0건**이었다. 그런데 사망 3건이 `feedback_uploaded`와 **같은 초**에
 *  찍혀 인과 방향이 확정되지 않는다. 가설은 *"6.77~7.12MB zip 업로드가 메인스레드·메모리를 압박해
 *  iOS가 오디오 트랙을 회수한다"* 인데, 이를 판정하려면 **ms 해상도와 zip 바이트**가 필요하다.
 *
 *  `phase`가 같은 제출을 앞뒤로 묶는다 — `start`(업로드 직전)와 종료(`uploaded`/`queued`/`failed`)를
 *  **같은 `bytes`로 짝지어** 읽는다. 그 사이 `elapsedMs` 동안 `track`이 `live`→`ended`로 바뀌었다면
 *  업로드가 원인이라는 직접 증거가 된다.
 *
 *  🔴 `track`은 **업로드 경로가 아니라 레코더에서 읽은 실제 트랙 상태**다. `unknown`은 레코더를
 *  못 읽었다는 뜻이며 *"트랙이 없다"(`none`)와 다르다* — 이 구분이 없으면 계측 실패가 결함으로
 *  오독된다. */
export function feedbackUploadMic(fields: {
  phase: 'start' | 'uploaded' | 'queued' | 'failed';
  track: 'none' | 'ended' | 'muted' | 'live' | 'unknown';
  bytes: number;
  elapsedMs: number;
}): string {
  return `feedback_upload_mic:${kv({
    phase: fields.phase,
    track: fields.track,
    bytes: fields.bytes,
    ms: fields.elapsedMs,
  })}`;
}

/** 계측 H — **백그라운드 진입 *시점*의 오디오 스택 스냅샷.**
 *
 *  **메우는 공백:** 07-29의 `foreground_return:bg_s=7058,teardown=no_recorder`는 *복귀 시점에*
 *  레코더가 null이었음을 알려줄 뿐, **언제 어디서 사라졌는지**는 말하지 않는다. 진입 시점 상태가
 *  없으면 "들어갈 때 이미 없었다"와 "백그라운드에서 회수됐다"가 구분되지 않는다 — [MIC-B2]의
 *  근인 축이 3회차째 여기서 막혔다.
 *
 *  기존 `lifecycle:vis_hidden`·`visibility_context`는 **화면 상태만** 찍는다. 이 이벤트는 같은
 *  순간의 **레코더·트랙·인식기**를 함께 찍어 복귀 시점 스냅샷과 앞뒤로 대조하게 한다.
 *
 *  `rec=none`이면 진입 시점에 이미 레코더가 없었다는 뜻이고, 그 경우 복귀의 `no_recorder`는
 *  백그라운드 회수가 **아니다**. */
export function bgEnterSnapshot(fields: {
  rec: 'none' | 'idle' | 'recording';
  track: 'none' | 'ended' | 'muted' | 'live' | 'unknown';
  stt: 'none' | 'idle' | 'listening' | 'suspended';
  phase: string;
}): string {
  return `bg_enter_snapshot:${kv({
    rec: fields.rec,
    track: fields.track,
    stt: fields.stt,
    phase: fields.phase,
  })}`;
}

/** v0.43.0 #4 — **백그라운드 진입/복귀에서 앱이 실제로 한 일.**
 *
 *  `bg_enter_snapshot`이 *"그 순간 무엇이 돌고 있었나"* 라면 이건 *"그래서 무엇을 껐나"* 다.
 *  둘을 앞뒤로 대조해야 07-30 관측(백그라운드에서 `rec=recording`·`stt=listening`인데 트랙만
 *  `muted` → 클립 에러 5건이 그 구간에 몰림, plan §3-2)이 닫혔는지 판정할 수 있다.
 *
 *  🔴 `capture`는 **`getTrackState()`로 읽을 수 없다.** `track.enabled=false`여도 `readyState`는
 *  `'live'`라 트랙 상태는 그대로 `live`로 보인다(MDN). 이 축이 없으면 "껐다"는 사실이 로그에
 *  남지 않는다. `AudioTrackState`를 넓히는 대신 여기서 별도로 노출한다(바이트 계약 보존).
 *
 *  값의 의미 — 🔴 **edge마다 다르다. 뭉쳐서 읽지 마라**(v0.43.0 리뷰 사소#1, 2026-07-31):
 *   - `enter`의 `stt`    `stopped` = **돌고 있던 인식기를 실제로 멈췄다.**
 *                        `noop` = 멈출 인식기가 없었다(세션 미가동·prewarm 유휴, 또는 다른 소스가
 *                        이미 suspend 중인 중첩). 종전에는 래치 전이(빈 집합→비빈 집합)를 그대로
 *                        `stopped`로 썼기 때문에 **유휴 왕복까지 "중지했다"로 세어** 실제 중지
 *                        횟수의 분자가 오염됐다. 이제 인식기 존재를 본다.
 *   - `return`의 `stt`   `restored` = 실제로 인식기를 복원했다. `noop` = 복원하지 않았다.
 *   - `capture`          `off`/`on` = 트랙 토글 실제 전환. `noop` = 트랙이 없거나 이미 그 상태.
 *
 *  🔑 **복귀 안내는 `return`의 `restored`에만 걸린다** — "재개 성공"에만 건다([MIC-B2]: 복귀
 *  32.5초 뒤 `audio-capture` 오류가 난 전례라 "시도" 시점 안내는 거짓말이 된다).
 *  ⚠️ **`enter`가 `noop`인데 안내가 나가는 회차는 정상이다.** 세션 시작 TTS 중에 백그라운드로
 *  가면 그 순간엔 인식기가 없어(`enter,stt=noop`) 멈출 것이 없지만, 뒤이은 `start()`가 래치
 *  가드에 막히며 복원 의무를 승격시켜 복귀 시 **실제로 복원**된다(v0.43.0 1c). 두 축은 서로
 *  다른 사실이므로 `enter`의 `stt`로 안내 유무를 추론하지 마라 — `return`의 `stt`를 봐라.
 *
 *  ⚠️ **아무 일도 안 한 회차(`stt=noop,capture=noop`)도 남긴다** — `[ORCH-47]`(링버퍼 2000 압박)
 *  검토 결과 **유지**로 판단했다. 지우면 *"발동하지 않았다"* 와 *"배선이 안 붙었다"* 가 로그에서
 *  **똑같이 0건**으로 보인다 — `[FG-RETURN-LOG-1]`이 기록한 바로 그 함정이다. plan §3-2의
 *  가설(앱이 헛도는 녹음·STT를 멈춘다)이 실제로 발동했는지는 noop 회차가 **분모를 만들어야**
 *  판정된다. 비용은 왕복당 2건 — 07-30 실측(세션당 `visibility_context` 12건) 기준 세션당
 *  ~24건으로 2000 링버퍼에 무해하다. */
export function bgMicAction(fields: {
  // v0.45.0 WP-2 [D1] — 값 공간 확장(additive — 기존 바이트 불변):
  //   edge 'threshold'  = 장기 백그라운드 임계(10분) 도달 시점의 정지.
  //   stt/capture 'kept' = 세션-활성 게이트가 hidden에도 유지를 선택했다(정지 안 함).
  //   enter가 kept인 사이클은 return에서 stt=noop이 정상이다(멈춘 게 없어 복원할 것도 없다) —
  //   유지 구간의 생존 증거는 짝 이벤트 `bg_keep`이 담는다(bgKeep 주석).
  edge: 'enter' | 'return' | 'threshold';
  stt: 'stopped' | 'restored' | 'noop' | 'kept';
  capture: 'off' | 'on' | 'noop' | 'kept';
}): string {
  return kv({ edge: fields.edge, stt: fields.stt, capture: fields.capture });
}

/** v0.54.0 E2 — 트림 미발생 등으로 :raw 저장이 생략되었을 때 사유 계측. */
export function clipRawSkipped(reason: string): string {
  return `clip_raw_skipped:reason=${reason}`;
}

/** v0.54.0 F1 — :raw 저장 실패 계측 (본 클립 실패와 분리). */
export function clipRawSaveFailed(message: string): string {
  return `clip_raw_save_failed:${message}`;
}

