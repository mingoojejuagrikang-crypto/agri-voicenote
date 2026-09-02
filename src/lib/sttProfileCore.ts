/**
 * v0.51.1 R6 — **화자 프로필(순수 계층).** 기기에 누적되는 `(speaker, micClass)`별 혼동표 레코드와
 * export 동봉 파일(`stt-profile.json`)의 조립. IDB·logger 의존 없음 — Node 스펙이 직접 돈다
 * (`clipsManifest.ts` 패턴). 영속·캐시는 `sttProfileStore.ts`.
 *
 * 프로필 키가 `(speaker, micClass)`인 이유: 입력장치(Shokz BT vs 내장 마이크)가 인식 형상을 가르는데
 * 오늘 데이터로는 그 상관을 못 가렸다(STT 레인 §4). 갈라 두면 회차가 쌓일 때 표가 스스로 말한다.
 */
import type JSZip from 'jszip';
import {
  addNegative, addObservation, alignPair, emptyTable, noteSeen,
  type ConfusionTable, type Observation,
} from './sttConfusionCore.ts';

const STT_PROFILE_SCHEMA = 1;
export const STT_PROFILE_FILENAME = 'stt-profile.json';

export interface SttProfile {
  version: typeof STT_PROFILE_SCHEMA;
  speaker: string;
  micClass: string;
  builtAt: number;
  updatedAt: number;
  /** 정정 쌍 수(정렬 성공·실패 무관 — 받은 쌍 전부). */
  pairs: number;
  /** 음성 커밋 수(분모 갱신 횟수). */
  commits: number;
  /** 「첫째」 부정 사례 수. */
  negatives: number;
  /** 정렬이 자리 치환·「점」 소실 어느 쪽도 아닌 쌍의 형상 통계(`other:<태그>`). */
  lengthShift: Record<string, number>;
  table: ConfusionTable;
}

export function profileKey(speaker: string, micClass: string): string {
  return `${speaker}|${micClass}`;
}

export function emptyProfile(speaker: string, micClass: string, now = Date.now()): SttProfile {
  return {
    version: STT_PROFILE_SCHEMA, speaker, micClass, builtAt: now, updatedAt: now,
    pairs: 0, commits: 0, negatives: 0, lengthShift: {}, table: emptyTable(),
  };
}

/** 직렬화 왕복(IDB·zip)에서 형상이 깨졌으면 버린다 — 잘못된 표로 질문하느니 전역 표만 쓴다. */
export function isSttProfile(v: unknown): v is SttProfile {
  if (!v || typeof v !== 'object') return false;
  const p = v as Partial<SttProfile>;
  return p.version === STT_PROFILE_SCHEMA
    && typeof p.speaker === 'string' && typeof p.micClass === 'string'
    && !!p.table && typeof p.table === 'object' && p.table.direction === 'heard->said'
    && typeof p.table.ctx === 'object' && typeof p.table.byColumn === 'object';
}

/** 음성 커밋 1건 — 분모. */
export function applyCommit(p: SttProfile, col: string, heard: string, decimals: number, colType: string, now = Date.now()): void {
  noteSeen(p.table, col, heard, decimals, colType);
  p.commits += 1;
  p.updatedAt = now;
}

/** 정정 쌍 1건(heard → said). 정렬 결과를 표에 더하고, 안 맞는 형상은 통계로만 남긴다. */
export function applyCorrection(p: SttProfile, col: string, heard: string, said: string, decimals: number, now = Date.now()): Observation[] {
  const obs = alignPair(heard, said, decimals);
  for (const o of obs) {
    if (o.kind === 'other') p.lengthShift[o.tag] = (p.lengthShift[o.tag] ?? 0) + 1;
    else addObservation(p.table, col, o);
  }
  p.pairs += 1;
  p.updatedAt = now;
  return obs;
}

/** 「첫째」(들린 값이 맞았다) — 물었던 규칙의 분모만 올린다. */
export function applyNegative(p: SttProfile, col: string, rules: string[], now = Date.now()): void {
  for (const r of rules) addNegative(p.table, col, r);
  p.negatives += 1;
  p.updatedAt = now;
}

export interface SttProfileExport {
  schema: typeof STT_PROFILE_SCHEMA;
  appVersion: string;
  exportedAt: number;
  direction: 'heard->said';
  /** export 시점 로그인 화자(프로필이 여럿이면 어느 것이 「지금 사람」인지). */
  speakerId: string;
  profiles: SttProfile[];
}

function buildSttProfileExport(profiles: SttProfile[], appVersion: string, speakerId: string, now = Date.now()): SttProfileExport {
  return { schema: STT_PROFILE_SCHEMA, appVersion, exportedAt: now, direction: 'heard->said', speakerId, profiles };
}

/** export zip에 `stt-profile.json` 동봉(additive — 기존 엔트리 불변). 프로필이 0개여도 파일은 남긴다:
 *  「수집이 안 됐다」와 「정정이 없었다」를 판독이 가를 수 있어야 한다. */
export function attachSttProfile(zip: JSZip, profiles: SttProfile[], appVersion: string, speakerId: string, now = Date.now()): void {
  zip.file(STT_PROFILE_FILENAME, JSON.stringify(buildSttProfileExport(profiles, appVersion, speakerId, now), null, 2));
}
