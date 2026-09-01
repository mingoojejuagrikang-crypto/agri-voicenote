/**
 * 🔴 v0.51 [CLIP-MUTED-SPAN-1] — **마이크 트랙 muted 구간의 SSOT**(순수 모듈).
 *
 * ## 무엇을 나르나
 * `AudioRecorder`의 트랙 리스너가 관측한 **UA의 미디어 전달 정지**(통화/Siri 인터럽션·라우트
 * 변경)를 앱 나머지 부분으로 흘린다. `mic_track_evt:mute`는 v0.50부터 로그에 남고 있었지만
 * **아무도 소비하지 않았다** — 그래서 2026-09-01 회차에서 앱은 마이크를 뺏긴 채로
 * 「음성 입력은 계속됩니다」를 화면에 띄우고 있었다.
 *
 * ## 🔴 왜 생성자 주입이 아니라 모듈 pub/sub인가
 * `new AudioRecorder()`가 **4곳**이다(`useVoiceSession` :2337 · :2471 · :2627 · :2906).
 * 콜백을 생성자 인자로 받으면 **한 곳만 빠져도 조용히 안 흐르고**, 그 누락은 정상 세션에서
 * 아무 증상이 없어 영영 안 잡힌다. 모듈 구독은 배선이 1곳이라 그 실패 모드가 없다.
 * 선례: `audioInterruption.ts`(앱 수명 누적 카운터)도 같은 이유로 모듈 상태다.
 *
 * ## 🔴 이 모듈은 복구를 하지 않는다
 * 관측·전파뿐이다. `recoverStream`·`getUserMedia` 재획득은 **사용자 제스처 경로만**이
 * 소유한다([IOS-5] · v0.50 r2 [CF-1]). muted를 「사망」으로 승격시키지도 않는다 —
 * `isStreamLost()`의 판정은 `ended`만 사망이고 그건 의도된 설계다.
 */
import { logger } from './logger';

type MutedListener = (muted: boolean) => void;

const listeners = new Set<MutedListener>();
/** 현재 muted인가. 레코더가 없으면(세션 전·dispose 후) false다 — 「모른다」가 아니라
 *  「지금 뺏긴 마이크가 없다」가 맞다(관측 대상 자체가 없다). */
let muted = false;
/** 현재 muted 구간의 시작 시각(epoch ms). muted가 아니면 null. 지속시간 판정용. */
let mutedSince: number | null = null;
/** 🔑 이 **세션**에서 관측된 muted 구간 수(진입 에지 기준). 결산 이벤트가 실어,
 *  판독이 「구간이 길었나 잦았나」를 클립 수와 대조할 수 있게 한다. */
let spanCount = 0;

/** 🔴 호출자는 `AudioRecorder`뿐이다(트랙 `mute`/`unmute` 리스너 · 리스너 부착 시 초기 동기화 ·
 *  `dispose`). 다른 곳에서 부르면 「관측된 사실」이 아니라 추측이 흐르기 시작한다.
 *
 *  같은 상태로의 중복 발행은 조용히 버린다(구간 수가 부풀지 않게).
 *  @returns 실제로 상태가 바뀌었으면 true. */
export function publishMicMuted(next: boolean, src: string): boolean {
  if (muted === next) return false;
  muted = next;
  if (next) {
    mutedSince = Date.now();
    spanCount += 1;
    logger.log({ type: 'clip', extra: `mic_interrupt:on:${src}` });
  } else {
    const ms = mutedSince === null ? 0 : Date.now() - mutedSince;
    mutedSince = null;
    // 🔑 **구간 길이를 남긴다.** 이게 없으면 다음 회차가 「짧은 알림음」과 「긴 통화」를
    //    구분하지 못하고, 자동 해제 임계(3초)를 실측으로 조정할 근거도 사라진다.
    logger.log({ type: 'clip', extra: `mic_interrupt:off:${src}:ms=${ms}` });
  }
  for (const cb of Array.from(listeners)) {
    try { cb(next); } catch { /* 구독자 하나가 실패해도 나머지에 전파한다 */ }
  }
  return true;
}

/** 구독. 반환값을 부르면 해제된다(effect cleanup). */
export function subscribeMicMuted(cb: MutedListener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function isMicMuted(): boolean {
  return muted;
}

/** 현재 muted 구간의 시작 시각(epoch ms) — muted가 아니면 null. */
export function getMutedSince(): number | null {
  return mutedSince;
}

/** 이 세션에서 관측된 muted **구간** 수. */
export function getMutedSpanCount(): number {
  return spanCount;
}

/** 🔴 세션 경계 초기화 — **구간 수만** 비운다.
 *
 *  현재 muted 여부(`muted`/`mutedSince`)는 **비우지 않는다.** 그건 「지금 마이크가 뺏겼는가」라는
 *  물리적 사실이고 세션 경계와 무관하다 — 여기서 false로 되돌리면 인터럽트 도중 새 세션을
 *  시작했을 때 앱이 스스로에게 「마이크는 멀쩡하다」고 거짓말하게 된다.
 *  (그 사실은 트랙 `unmute` 이벤트 또는 레코더 `dispose`로만 풀린다.) */
export function resetMicInterruptionSpans(): void {
  spanCount = 0;
}

/** 테스트 전용 — 스펙 간 모듈 상태가 새지 않게 한다(제품 경로에서는 호출하지 않는다). */
export function __resetMicInterruptionForTest(): void {
  listeners.clear();
  muted = false;
  mutedSince = null;
  spanCount = 0;
}
