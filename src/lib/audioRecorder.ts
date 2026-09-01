/* eslint-disable max-lines -- [ENV-12] 기존 초과 파일(GL-006 §5 도입 시점), 단일 책임 클래스 — 분리 경계 검토 후 해소. 해소 시 이 주석 제거. */
/**
 * MediaRecorder wrapper for per-field voice clip recording.
 * Records from the microphone independently of SpeechRecognition.
 *
 * Codex 4차 HIGH: 인스턴스별 상태 격리.
 * 각 녹음 슬롯이 자체 chunks/recorder/resolveStop을 소유하므로,
 * 이전 recorder의 큐잉된 ondataavailable/onstop 콜백이 새 슬롯 상태를 오염시키지 않음.
 *
 * v0.5.0 W6 — 클립 0.5s 프리롤 (CLIP: barge-in 앞부분 미수록):
 * init()에서 AudioContext + AudioWorklet(폴백 ScriptProcessor)으로 마이크 PCM을 1.5s
 * 링버퍼에 상시 캡처한다. startClip()이 직전 0.5s를 스냅샷해 슬롯에 마크하고, stopClip()이
 * 그 프리롤을 audioTrim(processClip)에 전달해 디코드 결과 앞에 결합한다. 워크릿·스크립트
 * 프로세서 모두 실패하면 `clip_preroll_unavailable`만 남기고 **현행 동작 그대로** 진행한다
 * (프리롤은 enhancement, 실패가 클립 저장을 막아선 안 됨 — 안전선).
 */

import { logger } from './logger';
import { TimeoutError, withTimeout } from './async';
import { audioInputClass, micTeardown, recoverTimeout, type ForegroundReturnTeardownResult } from './logEvents';
import { processClip, type PrerollPcm } from './audioTrim';
// [ENV-12] 마이크 PCM 캡처(링버퍼·레벨·파형)는 MicPrerollTap이 소유한다 — 이 클래스는 위임만.
import { MicPrerollTap, PREROLL_MS, clipWindowPeak, type ClipWindow } from './micPrerollTap';
import { classifyInputDevice, classifyAudioInputClass } from './inputDevice';
import { getAudioSessionEventCount } from './audioInterruption';
import { publishMicMuted } from './micInterruption';

interface ClipSlot {
  recorder: MediaRecorder;
  chunks: Blob[];
  mimeType: string;
  resolveStop: ((b: Blob | null) => void) | null;
  finalized: boolean;
  stopTimer: ReturnType<typeof setTimeout> | null;
  /** #2: wall-clock start (performance.now ms) so we can emit a measured clip duration —
   *  webm output from MediaRecorder has no duration cue (analysis sees N/A). This is a cheap
   *  measured fallback that fills the gap without remuxing the header. */
  startedAt: number;
  /** W6: PCM snapshot of the 0.5s BEFORE this clip started (barge-in first-syllable rescue).
   *  Captured synchronously at startClip() from the live ring buffer; null when preroll
   *  capture is unavailable on this device. */
  preroll: PrerollPcm | null;
  /** B5: pending delayed recorder.stop() (post-roll). Cleared + stopped immediately when the
   *  next clip starts or the recorder is disposed (graceful truncation protecting the next clip). */
  delayedStopTimer: ReturnType<typeof setTimeout> | null;
  /** B5: performance.now() at stopClip request — onstop logs postrollMs = actualStop − this.
   *  null = this clip was never stop-requested (e.g. replaced by a re-ask restart). */
  stopRequestedAt: number | null;
  /** v0.50 [CLIP-SILENT-1] — 이 슬롯이 녹음한 스트림. **콜백이 `this.stream`을 읽으면 안 되므로**
   *  (슬롯 격리 계약) 여기 캡처해 두고 종료 계측에서 자기 시점의 트랙 상태를 판정한다. */
  stream: MediaStream | null;
  /** v0.50 [CLIP-SILENT-1] — 이 클립 구간의 입력 레벨 관측 창(`MicPrerollTap.beginClipWindow`). */
  prerollWindow: ClipWindow | null;
  /** 🔴 v0.51 [CLIP-MUTED-SPAN-1] — **이 클립이 트랙 `muted` 구간에 걸쳤는가.**
   *
   *  ## 왜 종료 시점 스냅샷(`trackState`)으로는 안 되나
   *  `clipObservation()`은 `onstop` **그 순간**의 트랙 상태를 읽는다. 그래서
   *  `mute → (클립 전체) → unmute`가 클립 안에서 끝나면 `trackState=live`로 기록된다 —
   *  **무음 클립인데 로그는 「정상 트랙」이라고 말한다.** 2026-09-01 판독이 그 사각에 걸렸다.
   *  👉 필요한 것은 스냅샷이 아니라 **구간 래치**다.
   *
   *  🔑 **단방향이다(true로만 간다).** `unmute`로 되돌리지 않는다 — 구간에 **걸쳤다는 사실**은
   *  트랙이 회복해도 사라지지 않는다. 그 클립의 그 구간은 이미 전달되지 않았다.
   *
   *  ⚠️ 앱이 끄는 캡처(`setCaptureEnabled(false)` = `track.enabled`)와는 **다른 축**이다 —
   *  그쪽은 `muted`를 건드리지 않는다(그 메서드 주석이 SSOT). 여기 서는 것은 **UA가 미디어
   *  전달을 멈춘 사실**(통화/Siri 인터럽션·라우트 변경)뿐이다. */
  sawMuted: boolean;
}

/** stopClip()이 호출자에게 돌려주는 결과 — 트림본 + 트림 전 원본(다르면) + 프리롤 길이. */
export interface ClipResult {
  /** 저장/재생용 클립(트림됨; 프리롤 결합 반영). 녹음 실패 시 null. */
  blob: Blob | null;
  /** 트림 전 전체본(프리롤 포함). blob과 동일 내용이면 null — `…:raw` 중복 저장 방지. */
  raw: Blob | null;
  /** 이 클립에 결합된 프리롤 길이(ms). 프리롤 없으면 0. clip_duration 텔레메트리와 동일 값. */
  prerollMs: number;
  /** v0.20.0 BL-2 — 트림이 예외(decodeAudioData 실패 등)로 생략됐는지. true면 저장본은 원본(미트림)
   *  webm/mp4. 호출자(useVoiceSession)가 row/colId와 함께 clip_trim_failed를 남긴다. */
  trimFailed?: boolean;
  /** v0.20.0 BL-2 — 트림 실패 사유. trimFailed가 true일 때만. */
  trimFailReason?: string;
  /** 🔴 v0.51 [CLIP-MUTED-SPAN-1] — 이 클립이 트랙 `muted` 구간에 걸쳤으면 `true`, 아니면 **미동봉**.
   *
   *  호출자(`useValueCommit`)는 이걸로 **「저장했지만 증거로 쓸 수 없다」**를 가른다.
   *  🔴 **「스트림이 죽었나」와는 다른 판정이다.** `isStreamLost()`(복구가 필요한가)는 종전 그대로
   *  `ended`만 사망으로 보고, 이 필드는 **이 클립을 증거로 쓸 수 있는가**만 말한다. 소비자도
   *  다르다 — 전자는 재연결 배너, 후자는 저장·집계. 섞으면 멀쩡한 마이크에 배너가 뜬다. */
  mutedSpan?: true;
}

/** onstop이 끝내 발화하지 않는 환경(iOS Safari 마이크 점유 등)에서 hang을 막는 안전장치.
 *  B5: 실제 stop은 POSTROLL_MS 지연되므로 가드 스케줄 시 POSTROLL_MS를 더해 건다. */
const STOP_TIMEOUT_MS = 2000;
/** B5 — 클립 후반 0.5s post-roll: stopClip 요청 후에도 0.5s 더 녹음한 뒤 stop한다(지연 정지).
 *  발화 꼬리가 STT final 직후 잘리던 후반 짤림 보강. 음성 플로우는 stopClip을 await하지 않으므로
 *  체감 지연 0. 다음 클립이 0.5s 안에 시작되면 타이머를 클리어하고 즉시 stop(우아한 절단). */
const POSTROLL_MS = 500;
/** v0.14.0 B-1 — 스트림 재획득(recoverStream) 최소 간격. 연속 빈 클립/잦은 devicechange에 폭주
 *  하지 않도록 쿨다운을 둔다(장치 토글은 초당 수회씩 일어나지 않음). */
const RECOVER_COOLDOWN_MS = 3000;
/** v0.38.0 리뷰#1(Codex High) — 재획득 `getUserMedia` 응답 대기 상한.
 *
 *  **왜 필요한가:** 브라우저가 권한 요청을 resolve도 reject도 하지 않고 보류하면 `recovering`과
 *  호출부의 in-flight 가드가 영구히 잠긴다. 그러면 실패 폴백(수동 재연결 배너)이 `.then()` 안에
 *  있어 **배너조차 뜨지 않고**, teardown은 이미 끝난 뒤라 레코더가 종전보다 더 해체된 채 남는다
 *  = 세션 내내 조용한 녹음 사망. 거부보다 보류가 위험하다 — 반드시 결말을 만든다.
 *
 *  값 근거: 네트워크 왕복이 아니라 **권한 프롬프트 응답 대기**라 길 이유가 없다. 이미 권한이 있으면
 *  즉시 resolve되고, 사용자가 프롬프트를 보고 있다면 그건 제스처 경로(수동 배너)에서 다시 시도된다. */
const RECOVER_ACQUIRE_TIMEOUT_MS = 7000;
/** v0.38.1 [MIC-B2] 포그라운드 복귀 선-정리에서 낡은 `AudioContext.close()`를 기다리는 상한.
 *
 *  **왜 경계가 필수인가:** 이 정리는 "오디오 세션이 물려 있다"는 가정 위에서 도는데, 물린 컨텍스트는
 *  `close()` 자체가 늦거나 멈출 수 있다(Pax §4). 경계가 없으면 정리 코드가 되레 다음 제스처 획득을
 *  막아 — 고치려던 증상과 똑같은 "재연결 불가"를 우리가 만든다. 초과해도 실패로 끝내지 않고
 *  `closed=timeout`을 남기고 진행한다(정리는 best-effort, 획득이 본체다). */
const TEARDOWN_CLOSE_TIMEOUT_MS = 1500;

/** v0.50 [CLIP-SILENT-1] — 스트림의 오디오 트랙 상태 판정(모듈 함수).
 *
 *  🔑 **모듈 함수인 이유**: 클립 콜백은 `this.*`를 건드리지 않는 것이 계약이다(슬롯 격리 —
 *  아래 `startClip` 주석). 그래서 콜백은 **자기 슬롯에 캡처된 스트림**을 이 함수에 넘겨
 *  자기 시점의 상태를 읽는다. 인스턴스 메서드 `getTrackState()`도 같은 판정을 이걸로 한다. */
function trackStateOf(stream: MediaStream | null): AudioTrackState {
  const track = stream?.getAudioTracks()[0] ?? null;
  if (!track) return 'none';
  if (track.readyState === 'ended') return 'ended';
  if (track.muted) return 'muted';
  return 'live';
}

/** 🔴 v0.51 [CLIP-MUTED-SPAN-1] — 클립을 닫는 순간 `sawMuted`를 **마지막으로 한 번 더** 세운다.
 *
 *  **왜 이중 방어인가:** 래치의 주 경로는 트랙 `mute` 이벤트(`attachDeviceListeners`)와 시작 시점
 *  판정(`startClip`) 둘이다. 그런데 그 사이에 구멍이 둘 있다 —
 *   ① 리스너가 붙기 **전에**(init 직후 첫 클립) 시작된 클립,
 *   ② UA가 `muted` 상태로만 바꾸고 이벤트를 주지 않는 경우(실기기에서 배제할 수 없다).
 *  둘 다 「종료 시점에 트랙이 muted」로는 드러나므로, 닫을 때 한 번 더 읽어 덮는다.
 *  관측 비용은 `getAudioTracks()[0]` 한 번이고, **false로는 절대 되돌리지 않는다.**
 *
 *  🔑 슬롯을 인자로 받는다 — 콜백은 `this.*`를 읽지 않는다는 격리 계약을 지키기 위해서다. */
function latchMutedSpan(slot: ClipSlot): boolean {
  if (!slot.sawMuted && trackStateOf(slot.stream) === 'muted') slot.sawMuted = true;
  return slot.sawMuted;
}

/** 🔴 v0.50 r2 [CF-3] — 이 값 **미만**이면 그 클립을 「관측된 무음」으로 본다.
 *
 *  **왜 `=== 0`이면 안 되는가**(콜드 리뷰 실측): `clipPeak`의 원천 `inputLevel`은 **지수평활**이라
 *  (`micPrerollTap.ts`: `x += (target - x) * 0.15`) 한 번이라도 0이 아니었으면 **다시 정확히 0이
 *  되지 않는다** — denormal `1.5e-323`에서 고정점이다(500만 회 반복해도 0에 도달하지 않음).
 *  즉 `=== 0`은 **세션 시작 전부터 완전 디지털 무음**인 경우(이원창형)에만 성립하고,
 *  **정상 발화가 있다가 도중에 무음이 된 경우(양혁진형 — 정확히 조사가 못 밝힌 그 케이스)에는
 *  영원히 안 나갔다.**
 *
 *  **왜 1e-4인가**: 아래(고정점 `1e-323`)와 위(유효 신호) 사이에서 안전한 자리다.
 *  레벨은 `min(1, rms / 0.1)`이므로 `1e-4`는 **RMS 1e-5** — 16bit PCM의 1 LSB(3e-5)보다도 작아
 *  실제 소리로는 도달할 수 없는 구간이다. 반면 감쇠로 흘러내린 잔값(1e-5 이하로 금방 떨어진다)은
 *  전부 잡는다.
 *  ⚠️ `[미확인]`(리뷰 그대로 옮긴다): 실기기의 무음이 **정확한 0 샘플**인지 미세 잡음인지는
 *  확인하지 못했다. 미세 잡음이 1e-4를 넘으면 이 마커는 그 세션에서도 안 나간다 —
 *  그래서 **판정의 정본은 `clip_duration`에 항상 실리는 `trackState`+`clipPeak` 값**이다. */
const CLIP_SILENT_PEAK_MAX = 1e-4;

/** v0.50 r2 [CF-3] — 관측된 무음인가. **미관측(`undefined`)은 무음이 아니다.** */
function isObservedSilence(clipPeak: number | undefined): boolean {
  return clipPeak !== undefined && clipPeak < CLIP_SILENT_PEAK_MAX;
}

/** v0.50 [CLIP-SILENT-1] — 클립 종료 계측에 동봉하는 관측 조각.
 *  `clipPeak`은 **관측된 경우에만** 실린다(미동봉 = 프리롤 탭 미가용 ≠ 무음). */
function clipObservation(stream: MediaStream | null, window: ClipWindow | null): {
  trackState: AudioTrackState;
  clipPeak?: number;
  audioSessionEvts: number;
} {
  const trackState = trackStateOf(stream);
  const peak = clipWindowPeak(window);
  // v0.50 r2 [갈래 B] — 누적 발화 수를 클립마다 동봉한다(클립 사이 전이도 드러나게).
  const audioSessionEvts = getAudioSessionEventCount();
  return peak === null
    ? { trackState, audioSessionEvts }
    : { trackState, clipPeak: peak, audioSessionEvts };
}

/** 스트림의 모든 트랙을 멈춘다(마이크 인디케이터 해제). 실패해도 호출부를 막지 않는다. */
function stopAllTracks(stream: MediaStream | null): void {
  if (!stream) return;
  for (const t of stream.getTracks()) {
    try { t.stop(); } catch { /* 이미 종료된 트랙 */ }
  }
}

export interface ActiveInputInfo {
  deviceId: string;
  label: string;
}

export type AudioTrackState = 'none' | 'ended' | 'muted' | 'live';

export class AudioRecorder {
  private stream: MediaStream | null = null;
  /** v0.25.0 기능2(구 prewarm) — 진행 중 init() Promise 공유(동시 획득 직렬화). 두 init() 호출이
   *  겹치면 this.stream이 아직 없어 getUserMedia가 두 번 호출된다(스트림 누수·리스너 이중등록·
   *  iOS Safari 동시호출 거부). v0.44.0 F18 이후의 겹침 축은 start() 선두의 **선행 획득 await**과
   *  같은 start() 안의 후행 fire-and-forget init()이다(구 prewarm 마운트 축은 폐지). 진행 중
   *  Promise를 공유해 정확히 1회만 획득하고, 정착(성공/실패) 시 클리어한다 — 실패 시 다음 호출이
   *  재획득하는 폴백을 보존. */
  private initPromise: Promise<boolean> | null = null;
  /** v0.25.0 기능2 — 마지막 init() 실패 사유(DOMException.name 등). */
  private lastInitError: string | null = null;
  /** v0.38.0 [리뷰#6·#7] **획득 세대.** `dispose()`와 **모든 스트림 획득 시작**이 올린다.
   *  획득을 시작한 쪽은 자기 세대를 잡아 두고, 결과가 도착했을 때 세대가 그대로일 때만 그 스트림을
   *  인스턴스에 꽂는다. 어긋나면(=폐기됐거나 더 나중 획득에 밀렸으면) 트랙을 즉시 stop한다.
   *  `getUserMedia`는 취소할 수 없으므로, **결과가 온 뒤에 닫는 것**이 유일한 수단이다.
   *
   *  막는 것 두 가지:
   *  1. [리뷰#6] **폐기 후 늦게 열린 스트림.** 대기 중 `dispose()`되면 그 시점엔 닫을 스트림이 없고,
   *     뒤늦게 획득이 성공하면 이미 폐기된 인스턴스에 스트림·리스너·프리롤이 다시 붙는다. 그 인스턴스는
   *     호출부 ref에서 빠진 뒤라 아무도 `dispose()`를 부르지 않아 **마이크가 켜진 채 남는다**.
   *  2. [리뷰#7] **`init()`과 `recoverStream()`의 상호 경합.** `initPromise`는 init끼리만,
   *     `recovering`은 recover끼리만 직렬화한다(v0.37.0부터). prewarm `init()`이 권한 응답을 기다리는
   *     동안 `micLost` 자동복구가 `recoverStream()`을 시작하면 **둘이 각자 스트림을 연다.** 나중 것이
   *     `this.stream`을 덮어쓰고 `dispose()`는 마지막 하나만 stop하므로 **다른 하나가 영구 누수**된다.
   *     → 나중에 **시작된** 획득이 이긴다(recover는 이미 옛 스트림을 헐어낸 뒤라 그게 옳다).
   *
   *  `isDisposed` 하드가드는 StrictMode 이중마운트에서 같은 인스턴스의 재-init을 **영구** 차단해
   *  클립 녹음을 깨므로 쓸 수 없다. 세대 비교는 그 부작용이 없다 — 폐기 후 새 `init()`은 새 세대를
   *  잡고 정상 획득한다. */
  private acquireGen = 0;
  /** Active (recording) slot — only this one can be stopped via stopClip(). */
  private active: ClipSlot | null = null;
  /** Settings of the audio track actually granted by getUserMedia, captured at init().
   *  Lets the session log attribute STT accuracy to the real input device (built-in vs Shokz). */
  private activeInput: ActiveInputInfo | null = null;
  /** W6: 상시 PCM 링버퍼 캡처. null이면 프리롤 미지원(현행 동작). */
  /** [ENV-12] 마이크 PCM 상시 캡처 탭(링버퍼·입력 레벨·시간영역 파형). 스트림 수명에 맞춰 붙이고 뗀다. */
  private prerollTap = new MicPrerollTap();
  /** v0.13.0 R8 — 입력장치 변경(예: 음성입력 중 블루투스 해제)을 라이브로 배지에 반영하기 위한
   *  구독 핸들/대상 트랙. 라벨은 init()에서 1회만 캡처되던 frozen 값이라(민구 보고: 음성입력 중
   *  OS에서 BT를 끊어도 배지가 안 바뀜), devicechange/track ended·mute 신호 시 비파괴
   *  enumerateDevices로 activeInput.label을 갱신한다. 재-getUserMedia는 하지 않는다([IOS-5] 종결
   *  정책 + 진행 중 클립 손실 회귀 방지). dispose에서 반드시 해제(리스너 누수·좀비 콜백 방지). */
  private deviceChangeHandler: (() => void) | null = null;
  private listenedTrack: MediaStreamTrack | null = null;
  private trackChangeHandler: ((e: Event) => void) | null = null;
  /** v0.14.0 B-1/D — 스트림 재획득(recoverStream) 동시성/쿨다운 가드. */
  private recovering = false;
  /** dispose 뒤 새 복구를 허용하되, 폐기 전 복구의 finally가 새 가드를 풀지 못하게 한다. */
  private recoveryGuardGen = 0;
  // v0.38.0 — 쿨다운은 **연속** 재획득을 막기 위한 것이지 첫 회복을 막으면 안 된다. 0으로 두면
  // 비교값이 performance.now()(페이지 로드 후 경과 ms)라 **로드 직후 3초간 모든 recoverStream이
  // 조용히 차단**됐다. #5 자동 재연결은 사고 시점에 즉시 발화하므로 이 구간에 걸리면 getUserMedia를
  // 부르지도 못한 채 1회 가드만 소진하고 수동 배너로 떨어진다.
  private lastRecoverAt = -RECOVER_COOLDOWN_MS;
  /** v0.38.0 리뷰#1 — 재획득 응답 대기 상한. 인스턴스 필드로 둬서 단위 테스트가 실제 7초를
   *  기다리지 않고 타임아웃 경로를 결정론적으로 재현할 수 있게 한다(`lastRecoverAt`와 같은 패턴). */
  private acquireTimeoutMs = RECOVER_ACQUIRE_TIMEOUT_MS;
  /** teardown close/reattach 경계. 테스트가 실제 1.5초를 기다리지 않도록 인스턴스 필드로 둔다. */
  private teardownTimeoutMs = TEARDOWN_CLOSE_TIMEOUT_MS;
  /** v0.34.0 B7 — 지수평활된 마이크 입력 레벨(0~1). preroll push(pcm)에서만 갱신되고 UI(rAF)가
   *  getInputLevel()로 읽는다. React state 아님 — 리렌더 0. preroll 미가용이면 0에 머문다. */
  private inputLevel = 0;
  /** v0.34.0 D11b — 세션 파동 통계 누적(min/max/avg/활성비율용 카운터만 — **고빈도 로깅 절대
   *  금지**, ring buffer 2000 보호). 로깅은 useVoiceSession이 세션 stop 직전 1건으로 요약한다.
   *  솔직한 한계: 일시정지→재개는 새 AudioRecorder 인스턴스라 재개 이후 구간만 담긴다. */
  private waveStats = { peak: 0, sum: 0, count: 0, active: 0 };

  /** The microphone actually in use for this recorder (null until init() succeeds). */
  getActiveInput(): ActiveInputInfo | null {
    return this.activeInput;
  }

  /** v0.13.0 R8 — 활성 입력장치 라벨을 비파괴로 다시 읽어 activeInput을 갱신한다.
   *  - 활성 트랙이 ended(트랙 종료=장치 분리)면 라벨을 비워 classifyInputDevice가 '내장'으로 폴백.
   *  - 트랙이 살아있으면 enumerateDevices로 현재 deviceId 존재 여부를 확인해 사라졌으면 내장 폴백,
   *    있으면 최신 라벨(트랙 라벨 우선)로 갱신. 모든 단계 best-effort(권한 전 빈 라벨 등 무해).
   *  주의: track.muted는 '장치 분리'가 아니라 UA가 일시적으로 미디어 전달을 멈춘 상태(통화/Siri
   *  인터럽션, 라우트 변경 등)다. muted를 분리로 처리하면 BT/유선 연결 중 일시 mute에도 배지가
   *  '내장'으로 깜빡인다. 진짜 분리는 'ended' 또는 enumerate의 deviceId 부재로 잡으므로 muted는 보지
   *  않는다(unmute 리스너는 일시 mute 회복 시 라벨 재확인용으로 그대로 둔다). */
  private async refreshActiveInputLabel(): Promise<'ok' | 'unavailable' | 'error'> {
    if (!this.activeInput) return 'unavailable';
    const prevLabel = this.activeInput.label;
    try {
      const track = this.stream?.getAudioTracks()[0] ?? null;
      if (!track || track.readyState === 'ended') {
        this.activeInput = { ...this.activeInput, label: '' };
        this.emitInputDeviceChanged(prevLabel, '', 'refresh:track_ended');
        return 'ok';
      }
      const id = this.activeInput.deviceId;
      const enumerate = navigator.mediaDevices?.enumerateDevices?.bind(navigator.mediaDevices);
      if (enumerate) {
        const inputs = (await enumerate()).filter((d) => d.kind === 'audioinput');
        const match = id ? inputs.find((d) => d.deviceId === id) : undefined;
        if (id && !match) {
          // 활성 장치가 목록에서 사라짐 → 끊김으로 간주, 내장 폴백.
          this.activeInput = { ...this.activeInput, label: '' };
          this.emitInputDeviceChanged(prevLabel, '', 'refresh:device_gone');
          return 'ok';
        }
        if (match?.label) {
          this.activeInput = { ...this.activeInput, label: match.label };
          this.emitInputDeviceChanged(prevLabel, match.label, 'refresh:enumerate');
          return 'ok';
        }
      }
      // 트랙이 살아있고 라벨이 있으면 트랙 라벨을 신뢰(가장 정확).
      if (track.label) {
        this.activeInput = { ...this.activeInput, label: track.label };
        this.emitInputDeviceChanged(prevLabel, track.label, 'refresh:track_label');
      }
      return 'ok';
    } catch {
      // 라벨은 종전대로 유지하되(파괴하지 않는다) **실패했다는 사실을 호출자에게 알린다.**
      // 종전엔 조용히 삼켜서, 갱신 실패와 '변화 없음'이 호출자에게 구별되지 않았다
      // (v0.38.2 라운드A 리뷰 Codex #1 — 계측이 실패를 성공으로 보고하면 판독이 거짓이 된다).
      return 'error';
    }
  }

  /** v0.19.0 W7 — 입력장치 라벨이 실제로 바뀐 순간에만(old !== new) logger 이벤트를 방출한다.
   *  B-1 텔레메트리 갭(세션 시작/종료 meta만 기록 → 세션 중 route 변화 불가시) 보강. 분석이
   *  "어떤 입력 경로로 들었는지"를 세션 중 변화까지 식별할 수 있게 한다. classifyInputDevice로
   *  CATEGORY(내장/블루투스/유선)도 함께 싣는다. 기존 `session` 타입에 `extra`로 실어 LogEntry
   *  union·로그 파서(log-replay 등)를 건드리지 않는다(신규 이벤트 타입 무첨가 — 기존 로그 호환).
   *
   *  ⚠️ 솔직한 한계(iOS PWA): STT(Web Speech)는 자체 오디오 캡처라, 여기서 읽는 클립 레코더의
   *  getUserMedia track.label이 STT의 실제 입력 경로와 다를 수 있다. BT가 연결돼 있어도 getUserMedia가
   *  내장 default를 잡아 "iPhone 마이크"로 찍힐 수 있다(v0.18.0 로그가 그 증거 — BT/스피커폰을 실제로
   *  썼는데 두 세션 모두 내장으로 기록). route-change 계측은 신호를 늘리지만 iOS는 BT/내장을 완전
   *  구분 못 할 수 있다(AUDIO-ROUTE-1 네이티브 셸 영역, 본 계측 비범위). 그래도 enumerate/route-change
   *  신호는 다음 분석에 가치가 있다. */
  private emitInputDeviceChanged(oldLabel: string, newLabel: string, reason: string): void {
    if (oldLabel === newLabel) return;
    try {
      const oldCat = classifyInputDevice(oldLabel).text;
      const newCat = classifyInputDevice(newLabel).text;
      // v0.20.0 Phase 5 #5 — 직전 입력장치 전이를 stash해 clip_empty 컨텍스트로 동봉할 수 있게 한다.
      // BT clip_empty(이원창 row1)는 항상 직전 input_device_changed(내장↔블루투스 thrash)와 상관 —
      // 그 전이를 clip_empty 이벤트에 붙이면 다음 분석이 BT 라우팅 원인을 즉시 잇는다(W7 연계).
      this.lastInputChange = { reason, transition: `${oldCat}→${newCat}`, at: Date.now() };
      logger.log({
        type: 'session',
        extra: `input_device_changed:${reason}:${oldCat}→${newCat}`,
        text: `${oldLabel || '(빈)'}→${newLabel || '(빈)'}`,
      });
      // §5-1 ③(v0.44.0) — 장치 변경 감지 시의 입력장치 종류 계측. 라벨 실제 전이(old!==new)
      // 게이트에 동승하므로 링버퍼 잠식이 없다. 분류 휴리스틱·한계(speakerphone 부재,
      // [AUDIO-INPUT-2] frozen 라벨)는 classifyAudioInputClass 주석이 SSOT. 원시 라벨은 text에.
      logger.log({
        type: 'session',
        extra: audioInputClass({ cls: classifyAudioInputClass(newLabel), src: 'device_change' }),
        text: newLabel || '(빈)',
      });
    } catch { /* best-effort 계측 */ }
  }

  /** v0.20.0 Phase 5 #5 — 가장 최근 입력장치 전이(있으면). useVoiceSession이 clip_empty 로그에 동봉. */
  private lastInputChange: { reason: string; transition: string; at: number } | null = null;
  getLastInputChange(): { reason: string; transition: string; at: number } | null {
    return this.lastInputChange;
  }

  /** v0.22.0 P0 — 장치 변경(devicechange / track ended·mute·unmute) 처리.
   *  근인(2026-06-25 실기기 로그): v0.14.0이 **유휴 중 devicechange에서 자동 재-getUserMedia**
   *  (recoverStream)를 켰는데, iOS Safari는 **사용자 제스처 밖 getUserMedia를 NotAllowedError로
   *  거부**한다. recoverStream이 살아있던 스트림을 먼저 파괴(트랙 stop, this.stream=null)한 뒤
   *  재획득에 실패 → 살아있던 스트림까지 잃고 클립이 영구 소실됐다(세션시작 +2.6s devicechange
   *  1회 → clip_no_stream×56·clip_empty×41, 이후 1537 자동 재시도도 제스처 밖이라 전부 실패 폭주).
   *  → [IOS-5] 종결 정책("유휴 devicechange에서 재-getUserMedia 하지 않는다")으로 복귀한다:
   *   - **녹음 중이든 유휴든** 비파괴 라벨 갱신만(refreshActiveInputLabel). 스트림을 절대 버리지
   *     않으므로 클립이 계속 녹음되고, clip_empty 자동 재시도(useVoiceSession:1537)도 터지지 않는다.
   *  스트림/트랙이 실제로 죽은 경우의 복구는 **사용자 제스처 경로**(reconnectMic→recoverStream
   *  ('user_gesture'))로만 한다 — iOS가 getUserMedia를 거부하지 않는 유일한 컨텍스트. */
  private handleDeviceChange(): void {
    void this.refreshActiveInputLabel();
  }

  /** v0.22.0 P0 — 클립 레코더 스트림이 실제로 죽었는지(녹음 불가) 여부. 자동 복구를 멈추고
   *  사용자 제스처 재연결(reconnectMic)을 띄울지 판정하는 데 쓴다(useVoiceSession.micLost).
   *  스트림이 null이거나 활성 오디오 트랙이 없거나 ended면 죽은 것으로 본다. */
  isStreamLost(): boolean {
    if (!this.stream) return true;
    const track = this.stream.getAudioTracks()[0] ?? null;
    return !track || track.readyState === 'ended';
  }

  /** v0.33.0 항목4 — 포그라운드 복귀 시 마이크 트랙 정밀 판정용 스냅샷(관찰 전용, 재획득 없음 —
   *  [IOS-5]). 'ended'만 진짜 사망(micLost 래치 대상). 'muted'는 UA가 미디어 전달을 일시 정지한
   *  상태(통화/Siri 인터럽션·라우트 변경)로, unmute 대기가 옳다(래치하면 멀쩡한 마이크에 재연결
   *  배너가 뜬다 — refreshActiveInputLabel 주석의 동일 원칙). 'none'은 레코더 미초기화/해제
   *  (일시정지 등 의도된 상태)로 판정 대상이 아니다. */
  getTrackState(): AudioTrackState {
    return trackStateOf(this.stream);
  }

  /** 계측 H — 백그라운드 진입 순간 실제 MediaRecorder 슬롯이 녹음 중인지 읽는 관찰 전용 getter. */
  isRecording(): boolean {
    return this.active?.recorder.state === 'recording' && !this.active.finalized;
  }

  /** v0.43.0 #4 — **마이크 캡처를 끄고 켠다(장치는 놓지 않는다).** 백그라운드 진입/복귀 전용.
   *
   *  ⛔ **`track.stop()` 절대 금지**([IOS-5]). iOS는 재획득에 사용자 제스처를 요구하므로 복귀
   *  자동 재개가 **구조적으로 불가능**해진다. 반드시 `enabled` 토글이다.
   *
   *  계약(MDN `MediaStreamTrack.enabled`, 2026-07-31 확인): `enabled=false`인 트랙은 장치를
   *  점유한 채 **무음 프레임만**(every sample 0) 흘린다. 그래서:
   *   - `readyState`는 `'live'` 그대로다 → `getTrackState()`도 **여전히 `'live'`**를 보고한다.
   *     🔴 `AudioTrackState`를 넓히지 마라 — `bg_enter_snapshot`의 바이트 계약이다. 캡처 상태는
   *     별도 로그(`bg_mic`)로 노출한다.
   *   - `muted`(UA가 기술적 이유로 미디어를 멈춘 상태)와는 **다른 축**이다. iOS가 백그라운드에서
   *     트랙을 `muted`로 만드는 것(plan §3-2 관측)과 앱이 `enabled=false`로 끄는 것은 독립이다.
   *   - MediaRecorder는 계속 돌며 **무음을 쌓는다.** 그래서 호출자는 진행 중 클립을 먼저 정리한
   *     뒤에 이걸 꺼야 한다(useVoiceSession.suspendForBackground의 순서 계약).
   *
   *  @returns 실제로 상태가 바뀌었으면 true. 트랙이 없거나 이미 그 상태면 false. */
  setCaptureEnabled(enabled: boolean): boolean {
    const track = this.stream?.getAudioTracks()[0] ?? null;
    if (!track || track.enabled === enabled) return false;
    track.enabled = enabled;
    return true;
  }

  /** 현재 캡처가 켜져 있는가. 트랙이 없으면 false(= 잡을 소리가 없다). 관찰 전용. */
  isCaptureEnabled(): boolean {
    return this.stream?.getAudioTracks()[0]?.enabled ?? false;
  }

  /** v0.38.2 F5 — 포그라운드 복귀 시 **오디오 경로 재검증**(관찰 전용).
   *
   *  기존 `refreshActiveInputLabel()`(private)은 `devicechange`·트랙 이벤트가 발화했을 때만 돌았다.
   *  그런데 **백그라운드에서는 `devicechange`가 발화하지 않아** BT→스피커 전환이 아무 데도 안 남는다
   *  (2026-07-24 실기기 세션B의 트리거를 추론으로만 세워야 했던 이유). 복귀 시점에 한 번 능동으로
   *  다시 읽어 그 공백을 메운다.
   *
   *  🔴 **재-getUserMedia는 하지 않는다([IOS-5] 유지).** 비파괴 라벨 갱신 + 스냅샷 반환뿐이다 —
   *  유휴 중 재획득이 살아있던 스트림까지 잃게 만든 전례(v0.14.0 → v0.22.0 P0)를 되풀이하지 않는다.
   *
   *  🔴 **`status`가 계측의 정직성을 지킨다**(라운드A 리뷰 Codex #1). `enumerateDevices()`가 권한·
   *  WebKit 오류로 실패하면 라벨은 **직전 값 그대로** 남는데, 그걸 "재검증된 현재 경로"로 기록하면
   *  텔레메트리가 **실패를 성공으로 보고**한다 — 관측 공백을 메우려는 기능이 거짓 관측을 만든다.
   *   - `ok`          실제로 다시 읽었다.
   *   - `unavailable` 읽을 대상이 없었다(레코더 미초기화/`activeInput` 없음) — **모르는 것이지
   *                   '내장 마이크'가 아니다.**
   *   - `error`       읽으려다 실패했다. 라벨은 직전 값이므로 신뢰하면 안 된다. */
  async revalidateActiveInput(): Promise<{
    label: string | null;
    track: 'none' | 'ended' | 'muted' | 'live';
    status: 'ok' | 'unavailable' | 'error';
  }> {
    const status = await this.refreshActiveInputLabel();
    return { label: this.activeInput?.label ?? null, track: this.getTrackState(), status };
  }

  /** v0.33.0 항목4 — 활성 트랙의 다음 unmute 1회 관찰(once). 복귀 시 muted였던 트랙이 실제로
   *  회복되는지 텔레메트리로 잇는 용도. 트랙이 없으면 no-op. 관찰 전용(스트림 불변). */
  onceTrackUnmuted(cb: () => void): void {
    const track = this.stream?.getAudioTracks()[0] ?? null;
    if (!track) return;
    try { track.addEventListener('unmute', () => cb(), { once: true }); } catch { /* best-effort */ }
  }

  /** v0.38.1 [MIC-B2] **장기 백그라운드 복귀 시 낡은 오디오 그래프만 능동 해제한다.** 재획득은 하지
   *  않는다([IOS-5] — 제스처 밖 getUserMedia 금지는 그대로).
   *
   *  **왜 이 시점인가(2026-07-24 실기기 확증):** 앱이 50분 백그라운드에 있다 돌아온 뒤 BT→스피커
   *  경로가 바뀐 세션에서, 권한이 허용 상태인데도 재연결 getUserMedia가 8회 전부 `NotAllowedError`로
   *  ~10ms 내 즉시 거부됐다(0클립). 유력 원인은 iOS 오디오 세션이 interrupted로 물린 채 낡은
   *  `AudioContext`가 그 세션을 붙들고 있는 것이다(Pax P1). 그런데 첫 재연결 시도가 이미
   *  `prerollTap.detach()`로 참조를 버린 뒤라(fire-and-forget close) **2회차부터는 닫을 대상조차
   *  없었다.** 즉 낡은 컨텍스트를 실제로 닫을 수 있는 창은 **재연결 시도 이전, 포그라운드 복귀
   *  직후뿐**이다 — 그때는 prewarm이 붙여둔 캡처가 아직 살아 있다.
   *
   *  **왜 gUM 경로가 아닌가:** 획득 직전에 `await close()`를 끼우면 제스처 창을 소모하거나 hung
   *  close로 획득을 지연시켜, **정상 경로(같은 날 세션A는 78클립 정상)** 까지 깨뜨릴 수 있다
   *  (Pax §4·§6 명시 안티패턴). 그래서 정리는 획득 콜스택에서 완전히 떼어 여기서만 한다.
   *
   *  **계측이 본체다.** 원인 가설(P1)도 이 수정의 효과(P2)도 아직 미검증이라, 실기기 판정이
   *  "무엇을 확증/반증했는지" 읽히려면 바이트가 필요하다(#12-bis). `mic_teardown:found=…:closed=…`가
   *  ① `found=none` = 닫을 게 없었음 → JS측 컨텍스트는 원인이 아님(세션-레벨 물림) ② `closed=timeout`
   *  = close 자체가 물림 ③ `found=interrupted:closed=ok` 후 획득 성공 = P1·P2 확정 을 가른다.
   *  이 바이트 없이는 "고쳐도 안 풀린 것"과 "애초에 no-op이었던 것"을 구분할 수 없다.
   *
   *  ⚠️ `ctx.state`는 **분기 판정이 아니라 기록에만** 쓴다 — 복귀 직후 WebKit이 좀비 `'running'`을
   *  보고할 수 있어(Pax Q1) 상태를 믿고 정리를 건너뛰면 정작 필요한 경우를 놓친다. 그래서 게이트는
   *  상태가 아니라 **호출부의 백그라운드 경과시간**이 쥔다. */
  async teardownAudioGraph(
    evt: string,
    backgroundMs: number,
  ): Promise<ForegroundReturnTeardownResult> {
    // close 대기 중 recover/init/dispose가 소유권을 바꿀 수 있으므로 시작 시점의 세대+스트림을 함께 잡는다.
    const gen = this.acquireGen;
    const stream = this.stream;
    // found는 **close 전에** 읽어야 한다 — 타임아웃으로 끝나도 무엇을 닫으려 했는지는 남아야 한다.
    const found = this.prerollTap.getContextState();
    let closed: 'ok' | 'timeout' | 'error' = 'ok';
    try {
      await withTimeout(this.prerollTap.detach(), this.teardownTimeoutMs);
    } catch (e) {
      closed = e instanceof TimeoutError ? 'timeout' : 'error';
    }

    let reattach: 'ok' | 'timeout' | 'error' | 'skipped' = 'skipped';
    const stillOwnsSnapshot = () => this.acquireGen === gen && this.stream === stream;
    const track = stream?.getAudioTracks()[0] ?? null;
    // close 결과와 무관하게 복구를 시도한다. timeout/error 뒤 건너뛰면 live 트랙인데 파형·프리롤만
    // 세션 끝까지 죽는다. 단 close 대기 중 소유권이 바뀌었거나 트랙이 비생존이면 건드리지 않는다.
    if (stream && stillOwnsSnapshot() && track?.readyState === 'live') {
      try {
        await withTimeout(this.prerollTap.attach(stream), this.teardownTimeoutMs);
        if (!stillOwnsSnapshot()) {
          reattach = 'skipped';
        } else if (this.prerollTap.isAttachedTo(stream)) {
          reattach = 'ok';
        } else {
          reattach = 'error';
          // attach가 내부 폴백까지 소진하고 정상 반환했어도 게시된 그래프가 없으면 최종 실패다.
          void this.prerollTap.detach().catch(() => {});
        }
      } catch (e) {
        if (!stillOwnsSnapshot()) {
          reattach = 'skipped';
        } else {
          reattach = e instanceof TimeoutError ? 'timeout' : 'error';
          // timeout된 attach Promise는 취소할 수 없으므로 세대를 올려 늦은 그래프 게시를 막는다.
          void this.prerollTap.detach().catch(() => {});
        }
      }
    }
    // 바이트 조립은 `logEvents.ts` SSOT를 경유한다(신규 extra 규약 — kv는 ','로 잇는다).
    // 콜사이트에서 템플릿으로 만들면 특성화 테스트가 지키지 못하고, `evt`에 ':'가 섞이면
    // split(':') 파서가 필드를 쪼갠다(R2 리뷰 Medium).
    logger.log({ type: 'clip', extra: micTeardown({ found, closed, reattach, evt, backgroundMs }) });
    return closed === 'ok' && (reattach === 'ok' || reattach === 'skipped')
      ? 'completed'
      : 'failed';
  }

  /** v0.14.0 B-1 — 스트림을 재획득해 죽은 레코더/스테일 입력장치를 되살린다(재-getUserMedia).
   *  빈/극소 클립 감지(useVoiceSession) 또는 유휴 중 장치 변경 시 호출. 진행 중 active 슬롯은
   *  이미 실패(빈 클립)했거나 유휴이므로 정리 후 새 스트림으로 교체한다. 쿨다운/동시성 가드로
   *  연속 호출에 폭주하지 않는다. 성공/실패 모두 텔레메트리를 남긴다([REVIEW-1] 관측 대칭성). */
  async recoverStream(reason: string, opts?: { bypassCooldown?: boolean }): Promise<boolean> {
    if (this.recovering) return false;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    // v0.38.0 리뷰#1(Codex Medium) — 쿨다운은 **자동 폭주**를 막는 장치지, 사용자의 명시적
    // 재연결 탭을 삼키라는 게 아니다. 자동 시도가 즉시 실패한 직후(쿨다운 3초가 남은 상태)
    // 사용자가 배너를 바로 누르면, 실제 getUserMedia 호출 없이 실패하고 두 번 눌러야 했다.
    // 제스처 경로는 iOS가 getUserMedia를 허용하는 유일한 창이라 소모하면 안 된다.
    if (!opts?.bypassCooldown && now - this.lastRecoverAt < RECOVER_COOLDOWN_MS) return false;
    this.recovering = true;
    const recoveryGuardGen = ++this.recoveryGuardGen;
    this.lastRecoverAt = now;
    // v0.38.0 [리뷰#6·#7] 재획득 대기 중 dispose()·진행 중 init()이 끼어드는 핫마이크 레이스 —
    // init()과 **같은 카운터**를 쓴다. 여기서 올리는 순간 진행 중이던 init()의 획득은 stale이 된다.
    const gen = ++this.acquireGen;
    // v0.19.0 W7 — 재획득 전 라벨을 기억해 재획득 후 실제 변화가 있으면 route-change 이벤트를 방출.
    const prevLabel = this.activeInput?.label ?? '';
    let timedOut = false;
    let acquired: MediaStream | null = null;
    try {
      // 기존 그래프 정리 — 리스너 먼저(track.stop의 'ended'가 핸들러 재진입 못 하게), 프리롤, 스트림.
      this.detachDeviceListeners();
      // [MIC-B2] **의도적으로 await하지 않는다.** 동기 구간(그래프 disconnect·capture 비움)은 즉시
      // 끝나고 close만 뒤로 흘린다 — 여기서 close를 기다리면 gUM(아래) 앞에 대기가 생겨 제스처 창을
      // 소모하거나 hung close가 획득을 막는다(Pax §6 안티패턴). 낡은 세션 해제는 포그라운드 복귀의
      // `teardownAudioGraph()`가 담당한다.
      void this.prerollTap.detach().catch(() => {});
      const stale = this.active;
      this.active = null;
      if (stale && !stale.finalized) {
        if (stale.delayedStopTimer) { clearTimeout(stale.delayedStopTimer); stale.delayedStopTimer = null; }
        if (stale.stopTimer) { clearTimeout(stale.stopTimer); stale.stopTimer = null; }
        stale.finalized = true;
        try { if (stale.recorder.state !== 'inactive') stale.recorder.stop(); } catch { /* ignore */ }
        stale.resolveStop?.(null);
        stale.resolveStop = null;
      }
      stopAllTracks(this.stream);
      this.stream = null;
      this.activeInput = null;
      // 재획득 — v0.38.0 리뷰#1(Codex High): getUserMedia가 보류되면(권한 프롬프트 무응답)
      // 여기서 영원히 멈춰 recovering·호출부 in-flight 가드가 잠기고 배너조차 뜨지 않았다.
      // 타임아웃으로 반드시 결말을 만든다.
      const pending = this.acquireStream();
      try {
        acquired = await withTimeout(pending, this.acquireTimeoutMs);
      } catch (e) {
        // 이 시도는 결과를 **포기**했다. 원본 Promise는 취소할 수 없으므로, 뒤늦게 열리는 스트림은
        // 여기서 반드시 닫는다 — 안 그러면 아무도 참조하지 않는 마이크가 켜진 채 남는다(핫마이크).
        // 폐기 등록은 **포기 경로에서만** 한다(성공 경로에 걸면 쓰려던 스트림을 닫아버린다).
        void pending.then(stopAllTracks, () => { /* 늦은 실패는 폐기할 자원이 없다 */ });
        timedOut = e instanceof TimeoutError;
        throw e;
      }
      // [리뷰#6] 대기 중 dispose()가 있었으면 주인이 없는 스트림이다 — 꽂기 전에 닫고 실패로 끝낸다.
      if (this.acquireGen !== gen) {
        this.releaseAcquiredStream(acquired);
        return false;
      }
      this.stream = acquired;
      try {
        const track = this.stream.getAudioTracks()[0];
        if (track) {
          const settings = track.getSettings();
          this.activeInput = { deviceId: settings.deviceId ?? '', label: track.label ?? '' };
        }
      } catch { /* getSettings 미지원 — activeInput은 다음 refresh에서 채움 */ }
      this.attachDeviceListeners();
      await this.prerollTap.attach(this.stream);
      // [리뷰#9] attach 대기 중 다른 획득이 이기면 공유 필드가 아니라 이 작업의 스트림만 닫는다.
      if (this.acquireGen !== gen) {
        this.releaseAcquiredStream(acquired);
        return false;
      }
      logger.log({ type: 'clip', extra: `clip_recorder_recovered:${reason}:${this.activeInput?.label || 'default'}` });
      // v0.19.0 W7 — 재획득으로 입력 경로가 실제로 바뀌었으면 route-change 이벤트 방출(old !== new만).
      this.emitInputDeviceChanged(prevLabel, this.activeInput?.label ?? '', `recover:${reason}`);
      return true;
    } catch (e) {
      // [리뷰#9] attach 예외도 이 작업이 획득한 스트림을 반드시 닫는다. 더 최신 스트림의
      // 리스너·프리롤·공유 참조는 `releaseAcquiredStream`의 동일성 가드가 보존한다.
      this.releaseAcquiredStream(acquired);
      const message = String((e as Error)?.message ?? e);
      // v0.38.0 리뷰#1 — 보류(타임아웃)와 거부/오류를 로그에서 분리한다. 현장 원인이 다르다.
      // 기존 clip_recorder_recover_failed 문자열은 그대로 두고 신규 이벤트만 추가(바이트 계약).
      if (timedOut) logger.log({ type: 'error', extra: recoverTimeout(reason, this.acquireTimeoutMs) });
      else logger.log({ type: 'error', extra: `clip_recorder_recover_failed:${reason}:${message}` });
      return false;
    } finally {
      if (this.recoveryGuardGen === recoveryGuardGen) this.recovering = false;
    }
  }

  /** v0.13.0 R8 — devicechange + 활성 트랙 ended/mute/unmute 구독 등록(init 성공 직후 1회). */
  private attachDeviceListeners(): void {
    try {
      const md = navigator.mediaDevices;
      if (md?.addEventListener && !this.deviceChangeHandler) {
        this.deviceChangeHandler = () => { this.handleDeviceChange(); };
        md.addEventListener('devicechange', this.deviceChangeHandler);
      }
      const track = this.stream?.getAudioTracks()[0] ?? null;
      if (track && !this.trackChangeHandler) {
        this.listenedTrack = track;
        this.trackChangeHandler = (e: Event) => {
          // v0.50 [CLIP-SILENT-1] — **이 리스너는 종전에 아무것도 남기지 않았다.** 그래서
          // 2026-08-19 사고에서 트랙이 muted로 빠졌는지조차 확인할 수 없었다(`mic_track:*`는
          // 포그라운드 복귀 훅에서만 찍히는데 그 경로가 안 돌았다). 전이 자체를 여기서 남긴다.
          // 동작은 종전 그대로 — 라벨 갱신만 하고 **재획득은 하지 않는다**([IOS-5]).
          if (e?.type) logger.log({ type: 'clip', extra: `mic_track_evt:${e.type}` });
          // 🔴 v0.51 [CLIP-MUTED-SPAN-1] — **진행 중인 클립에 muted 구간을 래치한다.**
          //   종전에는 이 전이를 로그 한 줄로만 남기고 **아무도 소비하지 않았다** — 그래서
          //   녹음은 계속되고, 그 결과물이 정상 커밋으로 처리됐다(2026-09-01 A축의 본체).
          //   ⚠️ 슬롯 격리 계약과 방향이 반대라 괜찮다: 계약이 막는 것은 **MediaRecorder 콜백이
          //   `this.*`를 읽는 것**(stale 콜백이 새 슬롯을 오염시킨다)이고, 이건 인스턴스 메서드가
          //   **자기 시점의 활성 슬롯에 쓰는** 것이다. 이미 닫힌 슬롯은 건드리지 않는다.
          if (e?.type === 'mute' && this.active && !this.active.finalized) this.active.sawMuted = true;
          // v0.51 [CLIP-MUTED-SPAN-1] — 앱 나머지(절전 화면 문구·고지)가 실상태를 따르게 한다.
          //   🔴 **관측을 흘릴 뿐 복구는 하지 않는다** — 재획득은 사용자 제스처 전용([IOS-5]).
          if (e?.type === 'mute' || e?.type === 'unmute') publishMicMuted(e.type === 'mute', 'evt');
          this.handleDeviceChange();
        };
        track.addEventListener('ended', this.trackChangeHandler);
        track.addEventListener('mute', this.trackChangeHandler);
        track.addEventListener('unmute', this.trackChangeHandler); // BT 재연결 등 회복도 반영
        // v0.51 [CLIP-MUTED-SPAN-1] — **부착 순간 한 번 동기화한다.** 이미 muted인 트랙을 잡았으면
        //   'mute' 이벤트는 영영 오지 않는다(이미 지난 전이다) — 그러면 화면이 계속 「계속됩니다」다.
        publishMicMuted(trackStateOf(this.stream) === 'muted', 'attach');
      }
    } catch { /* best-effort */ }
  }

  /** v0.13.0 R8 — 구독 해제(dispose). track.stop()의 'ended'가 핸들러를 깨우지 않도록 먼저 호출. */
  private detachDeviceListeners(): void {
    try {
      const md = navigator.mediaDevices;
      if (md?.removeEventListener && this.deviceChangeHandler) {
        md.removeEventListener('devicechange', this.deviceChangeHandler);
      }
    } catch { /* ignore */ }
    this.deviceChangeHandler = null;
    if (this.listenedTrack && this.trackChangeHandler) {
      try {
        this.listenedTrack.removeEventListener('ended', this.trackChangeHandler);
        this.listenedTrack.removeEventListener('mute', this.trackChangeHandler);
        this.listenedTrack.removeEventListener('unmute', this.trackChangeHandler);
      } catch { /* ignore */ }
    }
    this.listenedTrack = null;
    this.trackChangeHandler = null;
    // v0.51 [CLIP-MUTED-SPAN-1] — 관측 대상이 사라졌다. muted로 굳은 채 남으면 레코더가 없는
    //   동안 화면이 영구 경고를 띄운다(그건 사실이 아니다 — 뺏긴 마이크 자체가 없다).
    publishMicMuted(false, 'detach');
  }

  /** getUserMedia 제약 — echoCancellation은 항상 ON(이어피스 기본; TTS 에코 되먹임 억제).
   *  noiseSuppression/autoGainControl은 소음 현장 정책 유지. */
  private acquireStream(): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        noiseSuppression: true,
        // 항상 ON(이어피스 기본) — TTS 에코가 마이크로 되먹임되는 것을 억제.
        echoCancellation: true,
        autoGainControl: false,
      },
      video: false,
    });
  }

  /** 획득 작업이 소유한 스트림을 닫는다. 공유 자원은 아직 그 스트림을 가리킬 때만 정리한다. */
  private releaseAcquiredStream(acquired: MediaStream | null): void {
    if (!acquired) return;
    if (this.stream === acquired) {
      this.detachDeviceListeners();
      void this.prerollTap.detach().catch(() => {}); // [MIC-B2] close를 기다리지 않되 rejection은 종결.
      stopAllTracks(acquired);
      this.stream = null;
      this.activeInput = null;
      return;
    }
    stopAllTracks(acquired);
  }

  async init(): Promise<boolean> {
    if (this.stream) return true;
    // v0.25.0 기능2(prewarm) — 동시 init() 직렬화. prewarm(입력탭 마운트)과 start()의 init()이 겹치면
    // this.stream이 아직 없어 getUserMedia가 두 번 호출된다(스트림 누수·리스너 이중등록·iOS 동시거부).
    // 진행 중 Promise를 공유해 정확히 1회만 획득하고, 정착 시 finally에서 클리어한다(실패 후 재획득
    // 폴백 보존 + dispose 후 재-init(StrictMode 이중마운트·재개) 시 정상 재획득). ⚠️ 핫마이크 주의:
    // v0.38.0 [리뷰#6·#7] 획득 대기 중 dispose()·다른 획득이 끼어드는 핫마이크 레이스는 **세대**로
    // 막는다(하드가드는 StrictMode 이중마운트를 깨므로 쓰지 않는다 — `acquireGen` 주석 참조).
    if (this.initPromise) return this.initPromise;
    // [리뷰#9] 새 시도의 false가 실제 실패인지 stale 조기반환인지 호출부가 구분하도록 이전 오류를
    // 비운다. 실제 catch만 현재 세대일 때 사유를 다시 채우며, stale은 null을 유지한다.
    this.lastInitError = null;
    const gen = ++this.acquireGen;
    const initPromise = (async (): Promise<boolean> => {
      let acquired: MediaStream | null = null;
      try {
        // 소음 환경(비닐하우스 등) 대응: 브라우저 내장 DSP 활성화 — 추가 지연 없음(1초 제약 무관).
        // echoCancellation은 이제 항상 ON(이어피스 기본) — TTS 에코가 마이크로 되먹임되는 것도 줄여줌.
        // (v0.15.0 A6: 스피커폰 소프트 half-duplex 모드 및 post-TTS 가드는 삭제됨 — 이어폰 barge-in 기본.)
        // autoGainControl은 소음 환경(빗소리 등)에서 무음 구간 게인을 키워 노이즈를 증폭할 수 있어 끔.
        acquired = await this.acquireStream();
        // [리뷰#6] 대기 중 dispose()가 있었으면 이 스트림의 주인은 이미 없다 — 즉시 닫고 실패로 끝낸다.
        // this.stream에 꽂기 **전에** 판정해야 리스너·프리롤이 폐기된 인스턴스에 붙지 않는다.
        if (this.acquireGen !== gen) {
          this.releaseAcquiredStream(acquired);
          return false;
        }
        this.stream = acquired;
        // Capture which input device was actually granted (built-in vs external mic like Shokz).
        // Numeric/string metadata only — device.json already enumerates the same deviceId+label set,
        // so this introduces no new PII category, it just records which of the known devices was used.
        try {
          const track = this.stream.getAudioTracks()[0];
          if (track) {
            const settings = track.getSettings();
            this.activeInput = {
              deviceId: settings.deviceId ?? '',
              label: track.label ?? '',
            };
          }
        } catch { /* getSettings unsupported — leave activeInput null */ }

        // v0.13.0 R8 — 입력장치 변경(BT 해제 등)을 배지에 라이브 반영하기 위한 구독 등록.
        this.attachDeviceListeners();

        // W6: 프리롤 캡처는 best-effort — 어떤 실패도 init 성공(현행 녹음 동작)을 막지 않는다.
        await this.prerollTap.attach(this.stream);
        // [리뷰#6] attach도 대기 구간이다(AudioContext.resume·worklet 로드가 지연될 수 있다).
        // 그 사이 더 최신 획득이 이기면 공유 필드가 아니라 이 작업의 스트림만 정리한다.
        if (this.acquireGen !== gen) {
          this.releaseAcquiredStream(acquired);
          return false;
        }
        this.lastInitError = null;
        return true;
      } catch (e) {
        // attach가 던져도 이 작업의 마이크는 남기지 않는다. 이긴 스트림은 동일성 가드로 보호한다.
        this.releaseAcquiredStream(acquired);
        // v0.25.0 기능2 — prewarm 텔레메트리 `_denied`가 읽도록 실패 사유(NotAllowedError 등)를 보존.
        if (this.acquireGen === gen) this.lastInitError = (e as Error)?.name || 'unknown';
        return false;
      }
    })().finally(() => {
      if (this.initPromise === initPromise) this.initPromise = null;
    });
    this.initPromise = initPromise;
    return initPromise;
  }

  /** v0.25.0 기능2 — 마지막 init() 실패 사유(DOMException.name). 성공 시 null. prewarm이 `_denied`에 싣는다. */
  getLastInitError(): string | null {
    return this.lastInitError;
  }

  // ── 마이크 캡처 탭 위임(공개 API는 종전 그대로 — 호출부 무수정) ──────────────
  /** v0.34.0 B7 — 현재 마이크 입력 레벨(0~1, 지수평활). 캡처 미가용이면 항상 0. */
  getInputLevel(): number { return this.prerollTap.getLevel(); }

  /** v0.35.0 (Vance) — 시간영역 파형 샘플을 `out`에 채운다. 채웠으면 true, analyser 미가용이면
   *  false(소비자가 레벨 기반 폴백으로 전환). */
  getTimeDomainData(out: Uint8Array): boolean { return this.prerollTap.getTimeDomainData(out); }

  /** v0.34.0 D11b — 프리롤 캡처 종류(계측용). null = 미가용. */
  getPrerollKind(): 'worklet' | 'script' | null { return this.prerollTap.getKind(); }

  /** v0.34.0 D11b — 세션 파동 통계 요약. 캡처가 한 번도 안 돌았으면 null. */
  getWaveStats(): { peak: number; avg: number; activePct: number } | null {
    return this.prerollTap.getWaveStats();
  }

  /** v0.34.0 D11b — 통계 리셋(세션 시작 시). */
  resetWaveStats(): void { this.prerollTap.resetWaveStats(); }

  startClip(): void {
    if (!this.stream) {
      logger.log({ type: 'clip', extra: 'clip_no_stream' });
      return;
    }
    // iOS: 백그라운드 전환 등으로 suspended가 되었으면 재개 시도(fire-and-forget).
    this.prerollTap.resumeIfSuspended();

    // Detach the previous active slot first — its callbacks will continue to read
    // ONLY its own captured `slot` reference, so they cannot pollute the new slot.
    const prev = this.active;
    if (prev) {
      // B5: a delayed post-roll stop may still be pending — clear it and stop IMMEDIATELY so the
      // post-roll of the previous clip can never bleed into (or delay) the next clip. This is the
      // graceful-truncation path: the previous clip keeps everything captured so far.
      if (prev.delayedStopTimer) { clearTimeout(prev.delayedStopTimer); prev.delayedStopTimer = null; }
      // If prev still has a pending stopClip waiter, resolve it now with whatever it captured.
      // The actual onstop may still fire later, but it will be a no-op (finalized guard).
      if (!prev.finalized && prev.recorder.state !== 'inactive') {
        try { prev.recorder.stop(); } catch { /* ignore */ }
      }
      if (!prev.finalized && prev.resolveStop) {
        prev.finalized = true;
        if (prev.stopTimer) { clearTimeout(prev.stopTimer); prev.stopTimer = null; }
        const blob = prev.chunks.length > 0
          ? new Blob(prev.chunks, { type: prev.mimeType || 'audio/webm' })
          : null;
        // B5 telemetry: this clip WAS stop-requested but its post-roll got truncated by the next
        // clip's start. onstop won't log clip_duration (finalized guard) — log it here so the
        // measured duration + actually-delivered postrollMs (<POSTROLL_MS) stay observable.
        // Clips never stop-requested (re-ask restarts) keep their pre-B5 behavior: no event.
        if (prev.stopRequestedAt != null) {
          const prevObservation = clipObservation(prev.stream, prev.prerollWindow);
          // v0.51 [CLIP-MUTED-SPAN-1] — 절단 경로도 대칭이다([CF-7]와 같은 이유).
          const prevMutedSpan = latchMutedSpan(prev);
          logger.log({
            type: 'clip',
            extra: 'clip_duration',
            durationMs: Math.round(performance.now() - prev.startedAt),
            prerollMs: prev.preroll ? Math.round((prev.preroll.pcm.length / prev.preroll.sampleRate) * 1000) : 0,
            postrollMs: Math.max(0, Math.round(performance.now() - prev.stopRequestedAt)),
            // v0.50 [CLIP-SILENT-1] — 이 클립이 무음이었는지·트랙이 어떤 상태였는지.
            ...prevObservation,
            // v0.51 [CLIP-MUTED-SPAN-1] — muted 구간에 걸쳤을 때만 실린다(정상 로그 형상 불변).
            ...(prevMutedSpan ? { mutedSpan: true as const } : {}),
          });
          // 🔴 v0.50 r2 [CF-7] — **절단 경로도 대칭이다.** 종전엔 정상 `onstop`에서만 `clip_silent`를
          //   남겨, 같은 사실이 경로에 따라 다르게 기록됐다(다음 클립이 post-roll 안에 시작하면
          //   이 경로로 닫힌다 — 빠른 커밋이 이어지는 세션에서는 오히려 이쪽이 흔하다).
          if (isObservedSilence(prevObservation.clipPeak)) {
            logger.log({ type: 'clip', extra: `clip_silent:track=${prevObservation.trackState}` });
          }
        }
        prev.resolveStop(blob);
        prev.resolveStop = null;
      }
    }

    try {
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : '';
      const recorder = mimeType
        ? new MediaRecorder(this.stream, { mimeType })
        : new MediaRecorder(this.stream);

      const slot: ClipSlot = {
        recorder,
        chunks: [],
        mimeType: recorder.mimeType || mimeType,
        resolveStop: null,
        finalized: false,
        stopTimer: null,
        startedAt: performance.now(),
        // W6 마크: 이 클립 시작 직전 0.5s — barge-in으로 잘린 첫 음절이 이 안에 있다.
        preroll: this.prerollTap.snapshot(PREROLL_MS),
        delayedStopTimer: null,
        stopRequestedAt: null,
        // v0.50 [CLIP-SILENT-1] — 종료 계측용 자기 시점 참조 2개(슬롯 격리 계약 유지).
        stream: this.stream,
        prerollWindow: this.prerollTap.beginClipWindow(),
        // 🔴 v0.51 [CLIP-MUTED-SPAN-1] — **이미 muted인 상태에서 시작된 클립**은 태어날 때부터
        //   신뢰할 수 없다(2026-09-01 폐기 세션의 07:46:55 클립이 정확히 이 형상 — mute가
        //   07:46:34에 왔고 그 뒤 시작된 클립이 5바이트로 닫혔다). 시작 시점 판정이 없으면
        //   그 클립은 `mute` 이벤트를 놓쳐 정상으로 기록된다.
        sawMuted: trackStateOf(this.stream) === 'muted',
      };

      // Callbacks close over `slot` exclusively — no `this.*` access, so a stale recorder
      // can never observe or corrupt the next slot's state.
      recorder.ondataavailable = (e) => {
        if (slot.finalized) return;
        if (e.data && e.data.size > 0) slot.chunks.push(e.data);
      };
      recorder.onstop = () => {
        if (slot.finalized) return;
        slot.finalized = true;
        if (slot.stopTimer) { clearTimeout(slot.stopTimer); slot.stopTimer = null; }
        const blob = slot.chunks.length > 0
          ? new Blob(slot.chunks, { type: slot.mimeType || 'audio/webm' })
          : null;
        // #2: measured clip duration (webm header has no duration cue → ffprobe sees N/A).
        // W6: prerollMs 동봉 — 이 클립에 결합될 프리롤 길이(0 = 프리롤 없음).
        // B5: postrollMs 동봉 — stop 요청 → 실제 stop까지 실측(≈POSTROLL_MS = 후반 보강 작동,
        // <POSTROLL_MS = 다음 클립 시작으로 절단). stop 요청이 없던 클립엔 미동봉.
        const observation = clipObservation(slot.stream, slot.prerollWindow);
        // v0.51 [CLIP-MUTED-SPAN-1] — 닫는 순간 마지막 래치(헬퍼 주석의 구멍 ①②를 덮는다).
        const mutedSpan = latchMutedSpan(slot);
        logger.log({
          type: 'clip',
          extra: 'clip_duration',
          durationMs: Math.round(performance.now() - slot.startedAt),
          prerollMs: slot.preroll ? Math.round((slot.preroll.pcm.length / slot.preroll.sampleRate) * 1000) : 0,
          ...(slot.stopRequestedAt != null
            ? { postrollMs: Math.max(0, Math.round(performance.now() - slot.stopRequestedAt)) }
            : {}),
          // v0.50 [CLIP-SILENT-1] — 이 클립이 무음이었는지·트랙이 어떤 상태였는지.
          ...observation,
          // v0.51 [CLIP-MUTED-SPAN-1] — muted 구간에 걸쳤을 때만 실린다(정상 로그 형상 불변).
          ...(mutedSpan ? { mutedSpan: true as const } : {}),
        });
        // v0.50 [CLIP-SILENT-1] — **관측된 무음**만 별도 1건으로 세운다(peak가 미관측이면 안 남긴다).
        // 정상 세션에서는 발생하지 않으므로 링버퍼(2000)를 잠식하지 않는다 — 2026-08-19 사고에서는
        // 이 한 줄이 「트랙이 muted였나 live였나」를 즉시 답했을 것이다.
        if (isObservedSilence(observation.clipPeak)) {
          logger.log({ type: 'clip', extra: `clip_silent:track=${observation.trackState}` });
        }
        slot.resolveStop?.(blob);
        slot.resolveStop = null;
      };

      this.active = slot;
      // timeslice 250ms: 짧은(1초 미만) 발화도 stop/timeout 전에 chunk를 확보하도록 자주 flush.
      // iOS Safari에서 stop 시 final dataavailable이 지연돼 timeout이 먼저 닫혀도 누락을 줄임.
      recorder.start(250);
      logger.log({ type: 'clip', extra: `clip_started:${slot.mimeType || 'default'}` });
    } catch (e) {
      this.active = null;
      logger.log({ type: 'error', extra: `clip_start_failed:${String((e as Error)?.message ?? e)}` });
    }
  }

  /** 녹음 정지 후 (프리롤 결합 →) 앞뒤 무음을 트림한 클립을 반환한다(D2/W6).
   *  트림이 실제로 일어났으면 트림 전 전체본(프리롤 포함)을 `raw`로 함께 돌려준다 —
   *  호출자가 `…:raw` 키로 보존(민구 결정). 트림/프리롤 실패 시 원본 그대로(현행 폴백). */
  async stopClip(): Promise<ClipResult> {
    const slot = this.active; // stopClipRaw 진행 중 active가 교체될 수 있어 미리 캡처
    const preroll = slot?.preroll ?? null;
    const rawRecording = await this.stopClipRaw();
    // 🔴 v0.51 [CLIP-MUTED-SPAN-1] — **await 뒤에 읽는다.** 정지를 기다리는 동안 도착한 `mute`도
    //   이 클립에 걸친 것이다(post-roll 0.5s가 그 창을 실제로 벌려 놓는다). 앞에서 읽으면 놓친다.
    //   `stopClipRaw`가 timeout으로 닫히면 `onstop`의 래치가 아직 없을 수 있어 여기서 한 번 더 센다.
    const mutedSpan = slot ? latchMutedSpan(slot) : false;
    const mutedField = mutedSpan ? { mutedSpan: true as const } : {};
    // 🔑 빈 클립(`clip_empty`) 경로도 사유를 나른다 — 「비었다」와 「muted 구간이라 비었다」는
    //   호출자에게 다른 사실이고, 실측 형상(5바이트·chunk 0)이 둘 다 이 구간에서 나왔다.
    if (!rawRecording) return { blob: null, raw: null, prerollMs: 0, ...mutedField };
    const prerollMs = preroll ? Math.round((preroll.pcm.length / preroll.sampleRate) * 1000) : 0;
    const processed = await processClip(rawRecording, preroll);
    if (processed.blob !== rawRecording) {
      logger.log({ type: 'clip', extra: `clip_trimmed:${rawRecording.size}->${processed.blob.size}`, prerollMs });
    }
    // v0.20.0 BL-2 — 트림 실패 신호를 ClipResult로 전파(이벤트는 row/colId가 있는 useVoiceSession에서).
    return {
      blob: processed.blob, raw: processed.raw, prerollMs,
      ...(processed.trimFailed ? { trimFailed: true, trimFailReason: processed.trimFailReason } : {}),
      ...mutedField,
    };
  }

  private stopClipRaw(): Promise<Blob | null> {
    const slot = this.active;
    return new Promise((resolve) => {
      if (!slot || slot.finalized) {
        resolve(null);
        return;
      }
      if (slot.recorder.state === 'inactive') {
        // Already stopped synchronously by startClip(); we should have resolved there but be defensive.
        slot.finalized = true;
        const blob = slot.chunks.length > 0
          ? new Blob(slot.chunks, { type: slot.mimeType || 'audio/webm' })
          : null;
        resolve(blob);
        return;
      }
      slot.resolveStop = resolve;
      slot.stopRequestedAt = performance.now();
      // onstop이 끝내 발화하지 않는 환경(iOS 마이크 점유)에서 hang 방지:
      // timeout 시 지금까지 수집된 chunks로 blob을 만들어 resolve.
      // B5: 실제 stop이 POSTROLL_MS 늦게 나가므로 가드도 POSTROLL_MS만큼 연장 — 정상 post-roll이
      // timeout으로 오인 절단되지 않게 한다(iOS onstop 미발화 보호는 그대로 유지).
      slot.stopTimer = setTimeout(() => {
        if (slot.finalized) return;
        slot.finalized = true;
        slot.stopTimer = null;
        if (slot.delayedStopTimer) { clearTimeout(slot.delayedStopTimer); slot.delayedStopTimer = null; }
        const blob = slot.chunks.length > 0
          ? new Blob(slot.chunks, { type: slot.mimeType || 'audio/webm' })
          : null;
        logger.log({ type: 'error', extra: `clip_stop_timeout:${slot.chunks.length}` });
        slot.resolveStop?.(blob);
        slot.resolveStop = null;
      }, STOP_TIMEOUT_MS + POSTROLL_MS);
      // B5 지연 정지: 즉시 stop하지 않고 POSTROLL_MS 동안 더 녹음한다(꼬리 발화 수록).
      // 이어붙임 없는 연속 녹음 — 같은 recorder가 계속 도는 것이라 별도 결합 처리가 없다.
      // startClip(prev-detach)/dispose()가 이 타이머를 클리어하고 즉시 stop해 다음 클립을 보호한다.
      slot.delayedStopTimer = setTimeout(() => {
        slot.delayedStopTimer = null;
        if (slot.finalized) return;
        try { slot.recorder.stop(); } catch { /* ignore */ }
      }, POSTROLL_MS);
    });
  }

  dispose(): void {
    // v0.38.0 [리뷰#6] 진행 중인 획득을 무효화한다 — 뒤늦게 열리는 스트림이 폐기된 인스턴스에
    // 다시 붙지 않도록. 취소할 수 없는 getUserMedia는 결과가 오는 즉시 stop된다(init/recoverStream).
    this.acquireGen += 1;
    // 진행 중 작업은 취소할 수 없으므로 참조만 분리한다. 각 finally는 자기 세대/Promise만 정리한다.
    this.initPromise = null;
    this.recoveryGuardGen += 1;
    this.recovering = false;
    // v0.13.0 R8 — 입력장치 구독 먼저 해제(아래 track.stop()의 'ended'가 핸들러를 깨우지 않도록).
    this.detachDeviceListeners();
    // Resolve any pending stopClip first so awaiters don't hang.
    const slot = this.active;
    this.active = null;
    if (slot && !slot.finalized) {
      // B5: pending post-roll delayed stop — clear FIRST and stop immediately (the stream is
      // about to be torn down; a late delayed stop would fire on a dead recorder).
      if (slot.delayedStopTimer) { clearTimeout(slot.delayedStopTimer); slot.delayedStopTimer = null; }
      slot.finalized = true;
      if (slot.stopTimer) { clearTimeout(slot.stopTimer); slot.stopTimer = null; }
      if (slot.recorder.state !== 'inactive') {
        try { slot.recorder.stop(); } catch { /* ignore */ }
      }
      if (slot.resolveStop) {
        slot.resolveStop(null);
        slot.resolveStop = null;
      }
    }
    // W6: 프리롤 캡처 그래프 해제 (stream stop 전에 — source가 stream을 참조).
    // [MIC-B2] dispose는 동기 계약이라 close를 기다리지 않는다(호출부가 언마운트 경로).
    void this.prerollTap.detach().catch(() => {});
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    this.activeInput = null;
  }
}
