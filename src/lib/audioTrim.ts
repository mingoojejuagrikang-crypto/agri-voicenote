/**
 * 음성 클립 무음 트리밍 + 프리롤 결합.
 *
 * 녹음된 클립(webm/opus 또는 mp4)을 decodeAudioData로 PCM으로 푼 뒤, RMS 진폭 기반으로
 * 실제 발화 구간만 남기고 앞뒤 무음을 잘라 16kHz mono WAV로 재인코딩한다.
 *
 * 설계 의도(2026-06-08 D2):
 *  - "음성 클립에 공백이 너무 많다 → 음성 부분만 저장" 요구 해결.
 *  - iOS Safari에서 onspeechstart/onspeechend로 녹음 자체를 게이팅하면 첫 음절이 잘릴 위험이
 *    있으므로(데이터 손실), 녹음은 현행대로 계속하고 "저장 직전"에만 트림한다.
 *  - decode 불가/음성 미검출/트림 효과 미미 시에는 원본 blob을 그대로 반환한다(안전 우선).
 *  - 16kHz mono 다운샘플로 청취 효율과 용량을 동시에 개선(전화 품질, STT/사람 청취 충분).
 *
 * v0.5.0 W6 (CLIP — barge-in 앞부분 미수록):
 *  - `preroll`(AudioRecorder의 PCM 링버퍼에서 startClip 직전 0.5s)을 디코드 결과 **앞에 결합**
 *    한 뒤 트림한다 — barge-in으로 MediaRecorder 시작 전에 발화된 첫 음절을 복구.
 *  - PAD 비대칭: 앞 300ms(첫 음절 강보호) / 뒤 180ms.
 *  - **원본 보존(민구 결정)**: 트림 전 전체 오디오(프리롤 포함)를 함께 반환 — 호출자가
 *    `…:raw` suffix 키로 audioClips store에 저장해 로그 zip(clips/)에 포함시킨다.
 *  - AudioContext 의존부(decodeAudioData)는 processClip에만 두고, 결합·검출·인코딩 로직은
 *    순수 함수로 분리해 Node 단위 테스트가 가능하다.
 */

export const PAD_FRONT_MS = 300;    // 발화 구간 앞 여유(첫 음절 보호 — barge-in 클립 강화)
export const PAD_BACK_MS = 180;     // 발화 구간 뒤 여유
const WIN_MS = 20;                  // RMS 분석 윈도우
const REL_THRESHOLD = 0.08;         // 피크 대비 발화 판정 비율
const ABS_FLOOR = 0.004;            // 절대 무음 바닥(노이즈 게이트)
/** v0.14.0 B-2: 발화 판정 임계의 기준 피크를 max(|sample|) 대신 상위 백분위로 잡는다. 초반의 짧은
 *  transient(클릭/팝/TTS 잔향)가 단일 샘플 최대치를 끌어올려 thr를 부풀리면, 정작 더 조용한 실제
 *  발화가 thr 미만으로 묻혀 엉뚱한(무음) 구간만 보존되던 문제(v0.13.0 클립 다수가 값 미수록)를
 *  완화한다. 백분위 피크는 소수의 이상 샘플에 둔감하다. */
const PEAK_PERCENTILE = 0.97;
/** v0.14.0 B-2: 트림 결과가 이보다 짧으면 검출이 값 구간을 놓쳤다고 보고 트림을 포기(전체본 유지).
 *  값 발화("삼십삼점삼" 등)는 보통 0.8s 이상 — 0.6s 미만 클립은 값이 잘렸을 가능성이 높다.
 *  raw가 따로 보존되더라도 사용자가 실제 재생하는 것은 blob이므로, blob을 안전한 전체본으로 둔다. */
const MIN_KEPT_MS = 600;
const TARGET_RATE = 16000;          // 다운샘플 목표 (음성 충분)
const KEEP_RATIO = 0.95;            // 트림 후 길이가 원본의 이 비율 이상이면 효과 미미 → 트림 생략
/** v0.9.0 CLIP-BLANK-1: 발화 세그먼트 사이 무음이 이보다 짧으면 같은 발화로 보고 합친다(어절 내
 *  미세 정지). 이보다 긴 무음은 "긴 공백"으로 간주해 클립에서 제거한다(선언↔값 사이 긴 정지 등). */
const MERGE_GAP_MS = 150;
/** v0.13.0 R4: 다중 보존 범위를 이어붙일 때 각 내부 경계에 적용하는 선형 페이드 길이(ms). 보존 범위
 *  직결 자리의 진폭 불연속(클릭/팝)이 "부자연" 체감의 1차 원인이라, 짧은 램프로 이음새를 부드럽게
 *  한다. 단일 범위(트림 효과 미미·단일 발화)는 concatRanges를 타지 않아 바이트 불변이 보존된다. */
const SPLICE_FADE_MS = 3;
/** v0.24.0 CLIP-BLANK-2: 조용한/노이즈 클립에서 robustPeak·thr이 노이즈 수준으로 붕괴하면 초반
 *  노이즈·TTS잔향이 약한 세그먼트로 검출돼, buildKeptRanges의 min(seg.start)를 실제 값 발화보다 한참
 *  앞으로 앵커시켜 긴 앞 공백을 남긴다(2026-06 실기기 51/287클립, 최악 10.8s). 가장 강한 세그먼트(값
 *  발화는 또렷이 크다) 대비 이 비율 미만의 약한 세그먼트를 버려 트림 앵커가 실제 값에 붙게 한다.
 *  단일/동급-강도 세그먼트(정상 클립·소수 재발화 등)는 전부 살아남아 기존 동작이 보존된다. */
const SEG_KEEP_RATIO = 0.25;

/** AudioRecorder의 PCM 링버퍼에서 추출한 프리롤 구간(mono). */
export interface PrerollPcm {
  pcm: Float32Array;
  sampleRate: number;
}

/** v0.54.0 E1 — raw가 생략(null)된 사유. */
export type RawSkipReason = 'no_ctx' | 'no_audio' | 'decode_failed' | 'no_segments' | 'no_effect' | 'over_trimmed';

/** 클립 저장 직전 처리 결과.
 *  - `blob`: 실제 저장/재생용 클립(트림됨; 프리롤이 있으면 결합본 기준).
 *  - `raw`: 트림이 실제로 일어났을 때만 트림 전 전체본 · 그 밖엔 null이고 본 클립이 곧 전체본(프리롤이 있으면 WAV 재인코딩 · 없으면 원래 컨테이너) — 사유는 rawSkip. */
export interface ProcessedClip {
  blob: Blob;
  raw: Blob | null;
  /** v0.54.0 E1 — raw===null일 때 사유 (트림된 경우엔 미동봉). */
  rawSkip?: RawSkipReason;
  /** v0.20.0 BL-2 — 트림 **실패**(decodeAudioData 등 예외) 신호. 정상 no-op 트림(빈 blob·발화
   *  미검출·효과 미미·과트림 등 healthy 폴백)과 구별하기 위해 **catch(예외 경로)에서만** true가
   *  된다. 호출자(stopClip)가 이를 ClipResult로 전파하고, useVoiceSession이 row/colId 컨텍스트와
   *  함께 `clip_trim_failed` 텔레메트리를 방출한다(현재 무이벤트 침묵 폴백이라 빈도 추적 불가).
   *  ⚠️ raw===null을 실패 신호로 쓰면 안 된다 — healthy 경로 5종도 raw===null이라 오탐(분석 오염). */
  trimFailed?: boolean;
  /** v0.20.0 BL-2 — 실패 사유(decode_error 등). trimFailed가 true일 때만 의미. */
  trimFailReason?: string;
}

let _ctx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!_ctx) _ctx = new Ctor();
    return _ctx;
  } catch {
    return null;
  }
}

// ─── 순수 로직 (Node 단위 테스트 대상 — AudioContext 불필요) ─────────────────

/** 선형 보간 리샘플 (프리롤 sampleRate ↔ 디코드 sampleRate 정렬용). */
export function resampleLinear(src: Float32Array, srcRate: number, dstRate: number): Float32Array {
  if (srcRate === dstRate || src.length === 0) return src;
  const ratio = srcRate / dstRate;
  const outLen = Math.max(1, Math.floor(src.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = src[i0] ?? 0;
    const b = src[i0 + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** 프리롤 PCM을 본 녹음 mono 앞에 결합. 프리롤은 본 녹음 rate로 리샘플된다. */
export function combineWithPreroll(
  mono: Float32Array,
  sampleRate: number,
  preroll?: PrerollPcm | null,
): { mono: Float32Array; prerollSamples: number } {
  if (!preroll || preroll.pcm.length === 0) return { mono, prerollSamples: 0 };
  const pre = resampleLinear(preroll.pcm, preroll.sampleRate, sampleRate);
  const out = new Float32Array(pre.length + mono.length);
  out.set(pre, 0);
  out.set(mono, pre.length);
  return { mono: out, prerollSamples: pre.length };
}

/** v0.14.0 B-2 — transient에 둔감한 기준 피크(상위 PEAK_PERCENTILE 백분위의 |sample|).
 *  max(|sample|)는 단일 클릭에 끌려가 thr를 부풀리지만, 백분위 피크는 소수 이상치에 강건하다.
 *  비용 절감 위해 최대 ~20k개로 균일 서브샘플 후 정렬(클립당 수 ms, 정확도 충분). */
function robustPeak(mono: Float32Array): number {
  const n = mono.length;
  if (!n) return 0;
  const MAX_SAMPLES = 20000;
  const stride = Math.max(1, Math.floor(n / MAX_SAMPLES));
  const mags: number[] = [];
  for (let i = 0; i < n; i += stride) mags.push(Math.abs(mono[i]));
  if (mags.length === 0) return 0;
  mags.sort((a, b) => a - b);
  const idx = Math.min(mags.length - 1, Math.floor(mags.length * PEAK_PERCENTILE));
  return mags[idx];
}

/** RMS 기반 발화 구간 검출. 미검출/전체 무음이면 null. */
export function findSpeechRange(
  mono: Float32Array,
  sampleRate: number,
): { start: number; end: number } | null {
  const length = mono.length;
  if (!length) return null;
  const peak = robustPeak(mono);
  if (peak < ABS_FLOOR) return null; // 사실상 전체 무음

  const thr = Math.max(ABS_FLOOR, peak * REL_THRESHOLD);
  const win = Math.max(1, Math.floor((sampleRate * WIN_MS) / 1000));
  let startSample = -1;
  let endSample = -1;
  for (let i = 0; i < length; i += win) {
    const end = Math.min(length, i + win);
    let sum = 0;
    for (let j = i; j < end; j++) sum += mono[j] * mono[j];
    const rms = Math.sqrt(sum / (end - i));
    if (rms >= thr) {
      if (startSample < 0) startSample = i;
      endSample = end;
    }
  }
  if (startSample < 0 || endSample <= startSample) return null;
  return { start: startSample, end: endSample };
}

/** v0.9.0 CLIP-BLANK-1 — RMS 기반 **다중** 발화 세그먼트 검출. findSpeechRange가 [첫 발화, 마지막
 *  발화] 단일 구간(내부 긴 무음 포함)을 돌려주던 것과 달리, 발화 덩어리들을 각각 분리해 돌려준다.
 *  MERGE_GAP_MS보다 짧은 무음은 같은 세그먼트로 합쳐 어절 내 미세 정지로 인한 과분할을 막는다.
 *  전체 무음/미검출이면 빈 배열. */
export function findSpeechSegments(
  mono: Float32Array,
  sampleRate: number,
): { start: number; end: number }[] {
  const length = mono.length;
  if (!length) return [];
  const peak = robustPeak(mono); // v0.14.0 B-2: transient 둔감 백분위 피크
  if (peak < ABS_FLOOR) return [];

  const thr = Math.max(ABS_FLOOR, peak * REL_THRESHOLD);
  const win = Math.max(1, Math.floor((sampleRate * WIN_MS) / 1000));
  const mergeGap = Math.floor((sampleRate * MERGE_GAP_MS) / 1000);
  // 세그먼트마다 내부 최대 윈도 RMS(peak)를 함께 추적한다 — 약한(노이즈) 세그먼트 솎기에 쓴다.
  const segs: { start: number; end: number; peak: number }[] = [];
  let curStart = -1;
  let curEnd = -1;
  let curPeak = 0;
  for (let i = 0; i < length; i += win) {
    const end = Math.min(length, i + win);
    let sum = 0;
    for (let j = i; j < end; j++) sum += mono[j] * mono[j];
    const rms = Math.sqrt(sum / (end - i));
    if (rms >= thr) {
      if (curStart < 0) {
        curStart = i;
        curEnd = end;
        curPeak = rms;
      } else if (i - curEnd <= mergeGap) {
        curEnd = end; // 짧은 갭 → 같은 발화로 이어붙임
        if (rms > curPeak) curPeak = rms;
      } else {
        segs.push({ start: curStart, end: curEnd, peak: curPeak }); // 긴 갭 → 세그먼트 분리
        curStart = i;
        curEnd = end;
        curPeak = rms;
      }
    }
  }
  if (curStart >= 0) segs.push({ start: curStart, end: curEnd, peak: curPeak });
  // v0.24.0 CLIP-BLANK-2 — 약한 세그먼트 솎기. 가장 강한 세그먼트(값 발화) 대비 SEG_KEEP_RATIO 미만의
  // 약한 세그먼트(초반 노이즈·TTS잔향)를 버려 앞 공백을 차단한다. 세그먼트가 2개 이상일 때만 적용하고,
  // 모두 약하면(예외 방지) 원본을 그대로 둔다. 단일/동급 세그먼트는 영향 없음(기존 동작 보존).
  let kept = segs;
  if (segs.length > 1) {
    let maxPeak = 0;
    for (const s of segs) if (s.peak > maxPeak) maxPeak = s.peak;
    const keepThr = maxPeak * SEG_KEEP_RATIO;
    const strong = segs.filter((s) => s.peak >= keepThr);
    if (strong.length > 0) kept = strong;
  }
  return kept.map(({ start, end }) => ({ start, end }));
}

/** v0.21.0 CLIP-MIDSPEECH-1 — **모든 세그먼트를 감싸는 단일 포괄 범위**를 만든다.
 *  [min(seg.start) − PAD_FRONT, max(seg.end) + PAD_BACK] 한 구간만 반환하므로, 발화 세그먼트
 *  **사이의 무음(어절 내 정지·선언↔값 갭 등)은 그대로 보존**된다. 앞 침묵/TTS 잔향과 뒤 EOS 꼬리만
 *  잘리는 가장자리 트림만 남는다(짧고 깔끔).
 *
 *  배경(2026-06-24 v0.20.0 실기기 분석): 이전 다중 범위 + concatRanges 경로가 발화 세그먼트 사이
 *  150ms↑ 갭을 제거해 72클립 중 15개(21%)에서 **발화 중간을 잘라 이어붙였다** — 농가가 저장 클립을
 *  들어도 값을 알 수 없다는 불만. 민구 지시: "발화 중간은 편집하지 말 것." 이 단일범위 통합으로
 *  splice가 0이 되고(buildClipBlobs가 항상 단일 range를 받음), 중간 무음은 audit에 보존된다.
 *
 *  세그먼트가 비면 빈 배열(호출자가 발화 미검출로 처리). 단일 세그먼트면 applyAsymmetricPad와
 *  동일한 범위가 나온다(기존 단일발화 동작 그대로 보존). */
export function buildKeptRanges(
  segments: { start: number; end: number }[],
  sampleRate: number,
  length: number,
): { start: number; end: number }[] {
  if (segments.length === 0) return [];
  const front = Math.floor((sampleRate * PAD_FRONT_MS) / 1000);
  const back = Math.floor((sampleRate * PAD_BACK_MS) / 1000);
  let minStart = segments[0].start;
  let maxEnd = segments[0].end;
  for (const seg of segments) {
    if (seg.start < minStart) minStart = seg.start;
    if (seg.end > maxEnd) maxEnd = seg.end;
  }
  // 모든 발화를 감싸는 단일 범위 — 가장자리만 트림, 내부 무음은 보존(splice 없음).
  return [{ start: Math.max(0, minStart - front), end: Math.min(length, maxEnd + back) }];
}

/** 보존 범위들의 실제 오디오를 순서대로 이어붙인 mono PCM. 범위 사이 무음은 제거된다.
 *  v0.13.0 R4 — 각 내부 경계(이전 범위 끝/다음 범위 시작)에 짧은 선형 페이드를 적용해 직결 자리의
 *  진폭 불연속(클릭/팝)을 부드럽게 한다. 페이드 길이는 구간 절반을 넘지 않게 클램프(짧은 구간 보호).
 *  ⚠️ v0.21.0 CLIP-MIDSPEECH-1 이후 buildKeptRanges가 단일 범위만 돌려주므로 **이 함수는 기본 경로가
 *  아니다**(발화 중간 splice 금지). 다중범위 로직·테스트 보존을 위해 남겨둔 휴면 폴백이다. */
function concatRanges(
  mono: Float32Array,
  ranges: { start: number; end: number }[],
  sampleRate: number,
): Float32Array {
  let total = 0;
  for (const r of ranges) total += r.end - r.start;
  const out = new Float32Array(total);
  const ramp = Math.max(1, Math.floor((sampleRate * SPLICE_FADE_MS) / 1000));
  let pos = 0;
  for (let ri = 0; ri < ranges.length; ri++) {
    const r = ranges[ri];
    const len = r.end - r.start;
    out.set(mono.subarray(r.start, r.end), pos);
    const fade = Math.min(ramp, len >> 1);
    if (fade > 0) {
      // 들어오는 구간 시작 페이드인(첫 범위 제외 — 클립 맨 앞은 원형 유지).
      if (ri > 0) for (let i = 0; i < fade; i++) out[pos + i] *= i / fade;
      // 나가는 구간 끝 페이드아웃(마지막 범위 제외 — 클립 맨 끝은 원형 유지).
      if (ri < ranges.length - 1) for (let i = 0; i < fade; i++) out[pos + len - 1 - i] *= i / fade;
    }
    pos += len;
  }
  return out;
}

/** 비대칭 PAD 적용(앞 300ms / 뒤 180ms) + 경계 클램프. */
export function applyAsymmetricPad(
  range: { start: number; end: number },
  sampleRate: number,
  length: number,
): { start: number; end: number } {
  const front = Math.floor((sampleRate * PAD_FRONT_MS) / 1000);
  const back = Math.floor((sampleRate * PAD_BACK_MS) / 1000);
  return {
    start: Math.max(0, range.start - front),
    end: Math.min(length, range.end + back),
  };
}

/** mono PCM [start,end) 구간을 TARGET_RATE로 다운샘플한 16bit PCM WAV로 인코딩. */
export function encodeWavMono(mono: Float32Array, srcRate: number, start: number, end: number): Blob {
  const srcLen = Math.max(0, end - start);
  const seg = mono.subarray(start, end);

  // 다운샘플(업샘플은 하지 않음 — 저품질 마이크 보호)
  const targetRate = Math.min(TARGET_RATE, srcRate);
  const ratio = srcRate / targetRate;
  const outLen = Math.max(1, Math.floor(srcLen / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = seg[i0] ?? 0;
    const b = seg[i0 + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }

  // WAV (PCM 16bit mono)
  const bytesPerSample = 2;
  const dataSize = outLen * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  let off = 44;
  for (let i = 0; i < outLen; i++) {
    const s = Math.max(-1, Math.min(1, out[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/** 결합(mono+preroll) PCM에 대해 저장용/원본용 blob 쌍을 만든다 — 순수(테스트 가능).
 *  반환 raw가 null이면 트림 무효(저장본=전체본)라 원본 별도 보존이 불필요하다는 뜻. */
export function buildClipBlobs(
  mono: Float32Array,
  sampleRate: number,
  hadPreroll: boolean,
  originalBlob: Blob,
): ProcessedClip {
  // v0.21.0 CLIP-MIDSPEECH-1 — 다중 세그먼트를 검출하되, buildKeptRanges가 **모두를 감싸는 단일
  // 포괄 범위**로 통합한다. 발화 사이 무음은 보존되고(splice 0) 가장자리만 트림된다. (이전 v0.9.0은
  // 세그먼트별 범위 + concat으로 내부 공백을 제거했으나, 발화 중간을 잘라 이어붙여 값 청취 불가.)
  const segments = findSpeechSegments(mono, sampleRate);
  if (segments.length === 0) {
    // 발화 미검출: 프리롤이 결합돼 있으면 결합 전체본을 저장본으로(프리롤 증거 보존),
    // 아니면 원본 그대로(현행 동작 유지).
    return hadPreroll
      ? { blob: encodeWavMono(mono, sampleRate, 0, mono.length), raw: null, rawSkip: 'no_segments' }
      : { blob: originalBlob, raw: null, rawSkip: 'no_segments' };
  }
  const ranges = buildKeptRanges(segments, sampleRate, mono.length);
  let keptSamples = 0;
  for (const r of ranges) keptSamples += r.end - r.start;
  const noEffect = keptSamples >= mono.length * KEEP_RATIO;
  // v0.14.0 B-2 — 트림본이 MIN_KEPT_MS보다 짧으면 검출이 값 구간을 놓쳤다고 보고 트림을 포기한다
  // (전체본 유지). 단, 원본 자체가 그보다 짧으면(아주 짧은 발화) 트림해도 그 길이라 폴백 무의미 →
  // 정상 트림. 즉 "원본은 충분히 긴데 트림 결과만 과도하게 짧은" 경우만 값 잘림으로 보고 막는다.
  const keptMs = (keptSamples / sampleRate) * 1000;
  const monoMs = (mono.length / sampleRate) * 1000;
  const overTrimmed = keptMs < MIN_KEPT_MS && monoMs >= MIN_KEPT_MS;
  if (noEffect || overTrimmed) {
    // 트림 효과 미미(거의 전부 발화) 또는 과도 축소(값 잘림 의심): 프리롤이 있으면 결합 전체본으로
    // 재인코딩(프리롤 포함이 목적), 없으면 원본 유지.
    const rawSkip: RawSkipReason = noEffect ? 'no_effect' : 'over_trimmed';
    return hadPreroll
      ? { blob: encodeWavMono(mono, sampleRate, 0, mono.length), raw: null, rawSkip }
      : { blob: originalBlob, raw: null, rawSkip };
  }
  // v0.21.0 CLIP-MIDSPEECH-1 — buildKeptRanges가 항상 단일 범위를 돌려주므로 이 경로는 늘 연속
  // 인코딩(기존 단일발화 동작과 바이트 동일, splice 0). concatRanges 분기는 도달하지 않는 보존용
  // 폴백(테스트·로직 보존). 발화 사이 무음은 범위 안에 그대로 담겨 audit가 전체 값을 보존한다.
  const trimmed =
    ranges.length === 1
      ? encodeWavMono(mono, sampleRate, ranges[0].start, ranges[0].end)
      : encodeWavMono(concatRanges(mono, ranges, sampleRate), sampleRate, 0, keptSamples);
  // 트림이 실제로 일어남 → 트림 전 전체본(프리롤 포함)을 raw로 보존.
  const raw = hadPreroll
    ? encodeWavMono(mono, sampleRate, 0, mono.length)
    : originalBlob; // 프리롤 없으면 원본 컨테이너(webm/mp4)가 곧 전체본
  return { blob: trimmed, raw };
}

// ─── 브라우저 의존부 ────────────────────────────────────────────────────────

/** decode → (프리롤 결합) → 트림. 실패 시 원본 blob 그대로(raw 없음 — 동일본). */
export async function processClip(blob: Blob, preroll?: PrerollPcm | null): Promise<ProcessedClip> {
  try {
    const ctx = getCtx();
    if (!ctx) return { blob, raw: null, rawSkip: 'no_ctx' };
    if (!blob || blob.size === 0) return { blob, raw: null, rawSkip: 'no_audio' };
    const arr = await blob.arrayBuffer();
    // 일부 구현이 입력 ArrayBuffer를 detach하므로 복사본 전달.
    const audio = await ctx.decodeAudioData(arr.slice(0));
    const { sampleRate, numberOfChannels, length } = audio;
    if (!length) return { blob, raw: null, rawSkip: 'no_audio' };

    // mono mix (트림 분석과 인코딩 모두 mono 기준)
    const mono = new Float32Array(length);
    for (let c = 0; c < numberOfChannels; c++) {
      const d = audio.getChannelData(c);
      for (let i = 0; i < length; i++) mono[i] += d[i] / numberOfChannels;
    }

    const combined = combineWithPreroll(mono, sampleRate, preroll);
    return buildClipBlobs(combined.mono, sampleRate, combined.prerollSamples > 0, blob);
  } catch (e) {
    // v0.20.0 BL-2 — decodeAudioData 등 트림 **예외 경로**. 저장본은 안전하게 원본(webm/mp4) 유지
    // (= 재생 가능한 클립이라 capture 플로우는 안 깨짐). 다만 트림이 통째로 생략됐음을 신호로
    // 표시(trimFailed)해, 호출자가 row/colId와 함께 clip_trim_failed를 남긴다. 이전엔 이 폴백이
    // 무이벤트(침묵)라 "음성클립 편집 실패"(미트림 .webm)가 로그상 보이지 않았다(BL-2 근본 가시화).
    // **healthy no-op 트림과 구별** — 그 경로들은 buildClipBlobs/상단 early-return이라 여기 안 온다.
    return { blob, raw: null, trimFailed: true, trimFailReason: `decode:${String((e as Error)?.name ?? e)}`, rawSkip: 'decode_failed' };
  }
}

/**
 * 앞뒤 무음을 제거한 WAV blob을 반환한다. 실패/미검출 시 원본 blob 그대로.
 * (기존 시그니처 호환 wrapper — 원본 보존본이 필요하면 processClip을 직접 사용.)
 */
export async function trimSilenceToWav(blob: Blob, preroll?: PrerollPcm | null): Promise<Blob> {
  return (await processClip(blob, preroll)).blob;
}
