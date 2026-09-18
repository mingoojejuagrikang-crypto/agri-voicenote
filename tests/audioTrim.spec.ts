/**
 * audioTrim — pure-logic unit tests (v0.5.0 W6: 0.5s 프리롤 결합 + 비대칭 PAD + 원본 보존).
 *
 * koreanNum.spec.ts와 같은 패턴: AudioContext 의존부(processClip/decodeAudioData)는 제외하고,
 * 분리된 순수 함수(resampleLinear/combineWithPreroll/findSpeechRange/applyAsymmetricPad/
 * buildClipBlobs)를 합성 PCM으로 Node에서 직접 검증한다. encodeWavMono는 Node 18+의
 * global Blob으로 동작하므로 크기(=샘플 수) 검증이 가능하다.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('[node] ⓪-게이트 이 오라클이 릴리스 게이트 목록에 등재돼 있다 (v0.55.0)', () => {
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8')) as {
    scripts: Record<string, string>;
  };
  const listed = (pkg.scripts['test:e2e:gate'] ?? '').split(/\s+/).filter((x) => x.startsWith('tests/'));
  expect(listed, 'tests/audioTrim.spec.ts가 릴리스 게이트 목록에 없다').toContain('tests/audioTrim.spec.ts');
});
import {
  resampleLinear,
  combineWithPreroll,
  findSpeechRange,
  findSpeechSegments,
  buildKeptRanges,
  applyAsymmetricPad,
  encodeWavMono,
  buildClipBlobs,
  PAD_FRONT_MS,
  PAD_BACK_MS,
} from '../src/lib/audioTrim';

const RATE = 16000; // TARGET_RATE와 동일 — encodeWavMono가 다운샘플하지 않아 샘플 수 계산이 정확

/** [silence|speech|silence] 합성 mono PCM. speech 구간은 진폭 0.5 구형파(RMS 0.5). */
function synth(silenceA: number, speech: number, silenceB: number, amp = 0.5): Float32Array {
  const out = new Float32Array(silenceA + speech + silenceB);
  for (let i = 0; i < speech; i++) out[silenceA + i] = i % 2 === 0 ? amp : -amp;
  return out;
}

/** WAV blob(16bit mono)의 PCM 샘플 수. */
function wavSamples(b: Blob): number {
  return (b.size - 44) / 2;
}

test.describe('resampleLinear', () => {
  test('same rate → identity (no copy)', () => {
    const src = synth(0, 100, 0);
    expect(resampleLinear(src, RATE, RATE)).toBe(src);
  });
  test('48k → 16k: length /3', () => {
    const src = new Float32Array(4800).fill(0.3);
    const out = resampleLinear(src, 48000, 16000);
    expect(out.length).toBe(1600);
    expect(out[0]).toBeCloseTo(0.3, 5);
    expect(out[out.length - 1]).toBeCloseTo(0.3, 5);
  });
});

test.describe('combineWithPreroll', () => {
  test('no preroll → passthrough, prerollSamples 0', () => {
    const mono = synth(100, 100, 100);
    const r = combineWithPreroll(mono, RATE, null);
    expect(r.mono).toBe(mono);
    expect(r.prerollSamples).toBe(0);
  });
  test('preroll PCM이 본 녹음 앞에 결합된다', () => {
    const mono = synth(0, 100, 0, 0.5);
    const pre = new Float32Array(50).fill(0.25);
    const r = combineWithPreroll(mono, RATE, { pcm: pre, sampleRate: RATE });
    expect(r.prerollSamples).toBe(50);
    expect(r.mono.length).toBe(150);
    expect(r.mono[0]).toBeCloseTo(0.25, 5);  // 프리롤이 앞
    expect(r.mono[50]).toBeCloseTo(0.5, 5);  // 본 녹음이 뒤
  });
  test('프리롤 rate가 다르면 본 녹음 rate로 리샘플된다 (48k 0.5s → 16k 0.5s)', () => {
    const mono = synth(0, 100, 0);
    const pre = new Float32Array(24000).fill(0.2); // 0.5s @ 48k
    const r = combineWithPreroll(mono, RATE, { pcm: pre, sampleRate: 48000 });
    expect(r.prerollSamples).toBe(8000); // 0.5s @ 16k
    expect(r.mono.length).toBe(8100);
  });
});

test.describe('findSpeechRange', () => {
  test('무음만 → null', () => {
    expect(findSpeechRange(new Float32Array(RATE), RATE)).toBeNull();
  });
  test('발화 구간을 윈도우 정밀도로 찾는다', () => {
    // 0.5s 무음 + 0.25s 발화 + 0.25s 무음
    const mono = synth(8000, 4000, 4000);
    const r = findSpeechRange(mono, RATE);
    expect(r).not.toBeNull();
    const win = (RATE * 20) / 1000; // WIN_MS=20 → 320 samples
    expect(Math.abs(r!.start - 8000)).toBeLessThanOrEqual(win);
    expect(Math.abs(r!.end - 12000)).toBeLessThanOrEqual(win);
  });
});

test.describe('applyAsymmetricPad — 앞 300ms / 뒤 180ms', () => {
  test('padding 적용 + 경계 클램프', () => {
    const length = RATE; // 1s
    const padded = applyAsymmetricPad({ start: 8000, end: 12000 }, RATE, length);
    expect(padded.start).toBe(8000 - (RATE * PAD_FRONT_MS) / 1000); // 8000-4800=3200
    expect(padded.end).toBe(Math.min(length, 12000 + (RATE * PAD_BACK_MS) / 1000)); // 14880
    // 클램프: 시작 직후 발화
    const clamped = applyAsymmetricPad({ start: 100, end: length - 100 }, RATE, length);
    expect(clamped.start).toBe(0);
    expect(clamped.end).toBe(length);
  });
});

test.describe('buildClipBlobs — 트림 + 원본 보존 계약', () => {
  const original = new Blob([new Uint8Array(1000)], { type: 'audio/webm' });

  test('프리롤 없음 + 트림 발생 → blob=트림 WAV, raw=원본 컨테이너', () => {
    // 2s: 1s 무음 + 0.5s 발화 + 0.5s 무음 → 충분히 트림됨
    const mono = synth(16000, 8000, 8000);
    const r = buildClipBlobs(mono, RATE, false, original);
    expect(r.blob).not.toBe(original);
    expect(r.blob.type).toBe('audio/wav');
    expect(r.raw).toBe(original); // 트림 전 전체본 = 원본 webm
    // 트림본 길이 ≈ 발화 0.5s + 앞 300ms + 뒤 180ms (윈도우 오차 허용)
    const samples = wavSamples(r.blob);
    const expected = 8000 + 4800 + 2880;
    expect(Math.abs(samples - expected)).toBeLessThanOrEqual(2 * 320);
  });

  test('프리롤 있음 + 트림 발생 → 트림본에 프리롤 발화 포함, raw=결합 전체 WAV', () => {
    // 프리롤 0.5s: 끝 0.1s에 발화(barge-in 첫 음절), 본 녹음: 0.3s 발화 + 1.2s 무음
    const pre = synth(6400, 1600, 0, 0.4); // 8000 samples
    const rec = synth(0, 4800, 19200);     // 24000 samples
    const { mono, prerollSamples } = combineWithPreroll(rec, RATE, { pcm: pre, sampleRate: RATE });
    expect(prerollSamples).toBe(8000);
    const r = buildClipBlobs(mono, RATE, true, original);
    expect(r.blob.type).toBe('audio/wav');
    expect(r.raw).not.toBeNull();
    expect(r.raw!.type).toBe('audio/wav');
    expect(wavSamples(r.raw!)).toBe(mono.length); // raw = 트림 전 결합 전체본 (32000 샘플)
    // 발화는 결합본의 [6400, 12800) — 프리롤 끝 0.1s + 본 녹음 앞 0.3s가 연속.
    // PAD: start 6400-4800=1600, end 12800+2880=15680 → 트림본 ≈ 14080 샘플.
    const trimmedSamples = wavSamples(r.blob);
    expect(Math.abs(trimmedSamples - 14080)).toBeLessThanOrEqual(3 * 320);
    // 핵심 계약: 트림 시작점(≈1600)이 프리롤 발화 시작(6400)보다 앞 →
    // barge-in 첫 음절(프리롤 구간)이 저장 클립에 포함된다.
    expect(trimmedSamples).toBeGreaterThanOrEqual(14080 - 3 * 320);
  });

  test('발화 미검출 + 프리롤 없음 → 원본 그대로, raw 없음 (현행 폴백)', () => {
    const mono = new Float32Array(RATE); // 전부 무음
    const r = buildClipBlobs(mono, RATE, false, original);
    expect(r.blob).toBe(original);
    expect(r.raw).toBeNull();
  });

  test('발화 미검출 + 프리롤 있음 → 결합 전체본 저장(프리롤 증거 보존), raw 없음(동일본)', () => {
    const mono = new Float32Array(RATE + 8000); // 결합본 전부 무음
    const r = buildClipBlobs(mono, RATE, true, original);
    expect(r.blob).not.toBe(original);
    expect(wavSamples(r.blob)).toBe(mono.length);
    expect(r.raw).toBeNull();
  });

  test('트림 효과 미미(전체가 발화) + 프리롤 없음 → 원본 유지, raw 없음', () => {
    const mono = synth(0, RATE, 0); // 1s 전체 발화
    const r = buildClipBlobs(mono, RATE, false, original);
    expect(r.blob).toBe(original);
    expect(r.raw).toBeNull();
  });
});

/** 두 발화 덩어리(선언 + 값)를 긴 무음으로 분리한 합성 PCM. */
function synth2(silA: number, sp1: number, gap: number, sp2: number, silB: number, amp = 0.5): Float32Array {
  const out = new Float32Array(silA + sp1 + gap + sp2 + silB);
  for (let i = 0; i < sp1; i++) out[silA + i] = i % 2 === 0 ? amp : -amp;
  const off = silA + sp1 + gap;
  for (let i = 0; i < sp2; i++) out[off + i] = i % 2 === 0 ? amp : -amp;
  return out;
}

test.describe('findSpeechSegments + buildKeptRanges (v0.21.0 CLIP-MIDSPEECH-1: 중간 갭 보존)', () => {
  test('긴 무음으로 갈린 두 발화 → 2개 세그먼트', () => {
    // 0.2s 무음 + 0.3s 발화 + 1.5s 긴 무음 + 0.3s 발화 + 0.2s 무음
    const mono = synth2(3200, 4800, 24000, 4800, 3200);
    const segs = findSpeechSegments(mono, RATE);
    expect(segs.length).toBe(2);
    expect(Math.abs(segs[0].start - 3200)).toBeLessThanOrEqual(320);
    expect(Math.abs(segs[1].start - 32000)).toBeLessThanOrEqual(320);
  });

  test('짧은 갭(<150ms)으로 갈린 발화 → 1개 세그먼트(어절 내 정지 보존)', () => {
    // 0.2s 무음 + 0.3s 발화 + 0.1s 짧은 무음 + 0.3s 발화 + 0.2s 무음 (gap 1600 < mergeGap 2400)
    const mono = synth2(3200, 4800, 1600, 4800, 3200);
    expect(findSpeechSegments(mono, RATE).length).toBe(1);
  });

  test('buildKeptRanges: 단일 세그먼트 = applyAsymmetricPad와 동일 범위', () => {
    const ranges = buildKeptRanges([{ start: 8000, end: 12000 }], RATE, RATE * 2);
    expect(ranges.length).toBe(1);
    const pad = applyAsymmetricPad({ start: 8000, end: 12000 }, RATE, RATE * 2);
    expect(ranges[0].start).toBe(pad.start);
    expect(ranges[0].end).toBe(pad.end);
  });

  // [CLIP-MIDSPEECH-1] v0.21.0 — 발화 중간 splice 금지. 다중 세그먼트라도 buildKeptRanges는 모두를
  // 감싸는 **단일 포괄 범위**만 돌려준다([min start − FRONT, max end + BACK]). 세그먼트 사이 무음은
  // 범위 안에 그대로 담겨 보존되고(중간 갭 미제거), 가장자리만 트림된다 → concatRanges 미경유(splice 0).
  test('buildKeptRanges: 다중 세그먼트도 단일 포괄 범위로 통합(중간 갭 보존, splice 0)', () => {
    const FRONT = (RATE * PAD_FRONT_MS) / 1000; // 4800
    const BACK = (RATE * PAD_BACK_MS) / 1000;   // 2880
    // 두 발화 세그먼트(긴 갭으로 분리) + 충분한 leading/trailing 여백
    const segs = [
      { start: 16000, end: 20800 }, // 발화1
      { start: 28800, end: 33600 }, // 발화2 (사이 8000 무음)
    ];
    const total = 49600;
    const ranges = buildKeptRanges(segs, RATE, total);
    // 핵심: 다중 세그먼트인데도 단일 범위 — concatRanges를 탈 다중범위가 만들어지지 않는다.
    expect(ranges.length, '다중 세그먼트가 여러 범위로 쪼개짐 → splice 발생 위험').toBe(1);
    expect(ranges[0].start).toBe(16000 - FRONT); // min start − FRONT
    expect(ranges[0].end).toBe(33600 + BACK);    // max end + BACK
    // 단일 범위가 두 발화 사이의 8000 무음을 통째로 포함(중간 갭 보존 = 발화 중간 미편집).
    const gapStart = 20800, gapEnd = 28800;
    expect(ranges[0].start).toBeLessThanOrEqual(gapStart);
    expect(ranges[0].end).toBeGreaterThanOrEqual(gapEnd);
  });

  // [CLIP-MIDSPEECH-1] v0.21.0 — (구 CLIP-BLANK-1 갱신) 발화 중간 splice 금지. 두 발화 사이의 내부
  // 무음은 이제 **보존**된다(이전엔 concatRanges로 제거 → 발화 중간을 잘라 이어붙여 값 청취 불가).
  // 가장자리(앞 침묵/뒤 꼬리)만 트림되고, 트림본은 두 발화 + 사이 갭을 모두 단일 연속 범위로 담는다.
  test('buildClipBlobs: 다중 발화도 중간 갭을 보존한 단일 범위로 트림(splice 없음)', () => {
    const original = new Blob([new Uint8Array(1000)], { type: 'audio/webm' });
    // 1s 무음 + 0.3s 발화 + 0.5s 갭(>MERGE) + 0.3s 발화 + 1s 무음 → 가장자리 트림은 KEEP_RATIO 통과.
    const mono = synth2(16000, 4800, 8000, 4800, 16000); // span 49600
    const r = buildClipBlobs(mono, RATE, false, original);
    expect(r.blob).not.toBe(original); // 가장자리 트림이 실제로 일어남(전체본 폴백 아님)
    expect(r.blob.type).toBe('audio/wav');
    const samples = (r.blob.size - 44) / 2;
    // 포괄 범위 = [16000−4800, 33600+2880] = [11200, 36480] → 25280 샘플.
    // 핵심: 단일범위라 두 발화 사이 0.5s(8000) 갭이 **그대로 포함**된다(중간 미편집).
    expect(Math.abs(samples - 25280)).toBeLessThanOrEqual(2 * 320);
    // 갭이 제거됐다면 ≈17280이 됐을 것 — 그보다 분명히 길다 = 내부 무음 보존됨(splice 0의 증거).
    const ifGapRemoved = 25280 - 8000;
    expect(samples, '내부 갭이 제거됨 → 발화 중간 splice 발생').toBeGreaterThan(ifGapRemoved + 4 * 320);
    // 앞뒤 가장자리는 잘렸으므로 전체 span(49600)보다는 분명히 짧다.
    expect(samples).toBeLessThan(mono.length - 10000);
  });

  // [CLIP-DECIMAL-FRAG-1] v0.16.0 → v0.21.0 CLIP-MIDSPEECH-1 갱신 — 소수 재질문에서 startClip
  // 재시작을 생략하면, 원본 전체발화("이십구 점 부")와 재질문 TTS 뒤의 조각 발화("구")가 한 연속
  // 녹음에 담긴다. 그 사이는 긴 무음(TTS·사용자 반응 갭 ≫ MERGE_GAP_MS)이지만, v0.21.0부터는 발화
  // 중간 splice 금지에 따라 이 갭을 **제거하지 않고 보존**한다(단일 포괄 범위). 저장 클립은 원본·갭·
  // 조각을 모두 담아 전체값 audit를 보존한다. (단일 녹음 디코드라 iOS decodeAudioData webm/opus 위험 회피.)
  test('decimal-frag: 원본 발화 + 긴 재질문 갭 + 조각 발화 → 갭 포함 단일 범위로 모두 보존', () => {
    const original = new Blob([new Uint8Array(1000)], { type: 'audio/webm' });
    // 1s 무음 + 0.6s 원본("이십구 점 부") + 0.75s 재질문 갭 + 0.3s 조각("구") + 1s 무음
    const ORIG = 9600;   // 0.6s
    const GAP = 12000;   // 0.75s (> MERGE_GAP_MS)
    const FRAG = 4800;   // 0.3s
    const mono = synth2(16000, ORIG, GAP, FRAG, 16000); // span 58400
    const segs = findSpeechSegments(mono, RATE);
    expect(segs.length, '원본과 조각이 두 세그먼트로 분리되지 않음').toBe(2);
    const r = buildClipBlobs(mono, RATE, false, original);
    expect(r.blob).not.toBe(original);
    const samples = (r.blob.size - 44) / 2;
    // 포괄 범위 = [16000−4800, (16000+9600+12000+4800)+2880] = [11200, 45280] → 34080 샘플.
    const FRONT = (RATE * PAD_FRONT_MS) / 1000, BACK = (RATE * PAD_BACK_MS) / 1000;
    const expected = (16000 + ORIG + GAP + FRAG + BACK) - (16000 - FRONT); // 34080
    expect(Math.abs(samples - expected)).toBeLessThanOrEqual(2 * 320);
    // 원본·갭·조각이 모두 한 범위에 담긴다 → 원본만(트림 ≈0.6s+패딩)보다 분명히 길다.
    const origAlone = ORIG + FRONT + BACK; // ≈ 17280
    expect(samples, '원본 발화가 유실되고 조각만 남음').toBeGreaterThan(origAlone);
    // 핵심: 갭(0.75s=12000)이 보존됐는지 — 갭을 제거했다면 ≈22080이 됐을 것보다 분명히 길다.
    expect(samples, '재질문 갭이 제거됨 → 발화 중간 splice 발생').toBeGreaterThan(expected - GAP + 4 * 320);
    // 가장자리(앞뒤 1s씩)는 잘렸으므로 전체 span(58400)보다는 짧다.
    expect(samples).toBeLessThan(mono.length - 10000);
  });
});

test.describe('encodeWavMono — WAV 헤더/크기 계약', () => {
  test('16bit mono, 44바이트 헤더 + 2바이트/샘플', () => {
    const mono = synth(0, 1000, 0);
    const b = encodeWavMono(mono, RATE, 0, 1000);
    expect(b.type).toBe('audio/wav');
    expect(b.size).toBe(44 + 1000 * 2);
  });
});

test.describe('buildClipBlobs rawSkip (v0.54.0 E3)', () => {
  const origBlob = new Blob([new Uint8Array(100)], { type: 'audio/webm' });

  test('no_segments: 발화 미검출 시 rawSkip=no_segments (프리롤 유/무 모두)', () => {
    const silence = new Float32Array(RATE);
    const withPre = buildClipBlobs(silence, RATE, true, origBlob);
    expect(withPre.raw).toBeNull();
    expect(withPre.rawSkip).toBe('no_segments');

    const withoutPre = buildClipBlobs(silence, RATE, false, origBlob);
    expect(withoutPre.raw).toBeNull();
    expect(withoutPre.rawSkip).toBe('no_segments');
  });

  test('no_effect: 거의 전부 발화(트림 효과 미미) 시 rawSkip=no_effect', () => {
    // 16000 샘플 중 15800 샘플 발화 -> keptRatio >= KEEP_RATIO (0.85)
    const mono = synth(100, 15800, 100);
    const r = buildClipBlobs(mono, RATE, false, origBlob);
    expect(r.raw).toBeNull();
    expect(r.rawSkip).toBe('no_effect');
  });

  test('over_trimmed: 원본은 길지만 트림 결과가 과도하게 짧은 경우 rawSkip=over_trimmed', () => {
    // 1초(16000) 버퍼 중 800샘플(50ms) 발화: robustPeak(0.97) 통과, kept ≈ 530ms < MIN_KEPT_MS(600ms)
    const mono = synth(8000, 800, 7200);
    const r = buildClipBlobs(mono, RATE, false, origBlob);
    expect(r.raw).toBeNull();
    expect(r.rawSkip).toBe('over_trimmed');
  });

  test('정상 트림: 실제 트림 발생 시 raw !== null 이고 rawSkip 미동봉(undefined)', () => {
    // 1초 무음 + 0.5초 발화 + 1초 무음 -> 정상 트림
    const mono = synth(16000, 8000, 16000);
    const r = buildClipBlobs(mono, RATE, false, origBlob);
    expect(r.raw).not.toBeNull();
    expect(r.rawSkip).toBeUndefined();
  });
});

