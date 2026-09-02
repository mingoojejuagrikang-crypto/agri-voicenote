/**
 * v0.51.1 R6 — **화자 프로필 저장소.** `(speaker, micClass)`별 혼동표 프로필을 메모리에 들고 IDB `kv`에
 * write-through한다(세션 경계 무관 · 앱 삭제 전까지 유지). 순수 조립은 `sttProfileCore.ts`, 표 연산은
 * `sttConfusionCore.ts`. 전역 표(`src/data/stt-confusion-default.json` — `scripts/stt-confusion-build.mjs`가
 * 생성)는 화자 프로필 **뒤**의 폴백이다(브리핑 §1-2: 화자 프로필 우선 → 전역 표).
 *
 * 🔴 하이드레이션은 idempotent 프라미스 1개다 — 세션 시작이 부팅 직후여도 `selectSttProfile`이 그것을
 *   await하므로, 저장된 프로필을 빈 프로필로 덮어쓰는 레이스가 없다.
 * 🔴 프로필이 아직 선택되지 않은 순간(세션 시작 ~ 마이크 획득 사이)의 기록 요청은 **프로필에는 반영하지
 *   않는다**(이벤트는 그대로 남는다). 마이크 클래스가 그 뒤에 확정되기 때문이고, 그 창에 정정이 오는
 *   일은 실측상 없다(첫 값 커밋 전).
 */
import { loadSttProfilesRecord, saveSttProfilesRecord } from './db';
import { logger } from './logger';
import { withErr } from './logEvents';
// JSON은 import attribute로 읽는다 — Node ESM(스펙 러너·타입 스트리핑)이 요구하고 Vite·TS 5.x도 받는다.
import defaultTableJson from '../data/stt-confusion-default.json' with { type: 'json' };
import type { ConfusionTable, Observation } from './sttConfusionCore.ts';
import {
  applyCommit, applyCorrection, applyNegative, emptyProfile, isSttProfile, profileKey,
  type SttProfile,
} from './sttProfileCore.ts';

interface SttProfilesRecord {
  schema: 1;
  profiles: Record<string, SttProfile>;
}

const profiles = new Map<string, SttProfile>();
let hydratePromise: Promise<void> | null = null;
let current: SttProfile | null = null;
let persistChain: Promise<void> = Promise.resolve();

export function hydrateSttProfiles(): Promise<void> {
  if (!hydratePromise) {
    hydratePromise = (async () => {
      try {
        const rec = (await loadSttProfilesRecord()) as Partial<SttProfilesRecord> | null;
        if (rec && typeof rec === 'object' && rec.profiles && typeof rec.profiles === 'object') {
          for (const [k, v] of Object.entries(rec.profiles)) {
            if (isSttProfile(v) && !profiles.has(k)) profiles.set(k, v);
          }
        }
      } catch (e) {
        // [REVIEW-1] 빈 catch 금지 — 로드 실패는 「프로필이 없다」와 다른 사실이다.
        logger.log({ type: 'app', extra: withErr('stt_profile_load_failed', e) });
      }
    })();
  }
  return hydratePromise;
}

/** 세션의 화자·마이크가 확정되는 시점(마이크 획득 뒤)에 호출 — 없으면 새로 만든다. */
export async function selectSttProfile(speaker: string, micClass: string): Promise<SttProfile> {
  await hydrateSttProfiles();
  const key = profileKey(speaker, micClass);
  let p = profiles.get(key);
  if (!p) {
    p = emptyProfile(speaker, micClass);
    profiles.set(key, p);
  }
  current = p;
  return p;
}

export function clearCurrentSttProfile(): void {
  current = null;
}

export function listSttProfiles(): SttProfile[] {
  return [...profiles.values()];
}

function getDefaultConfusionTable(): ConfusionTable {
  return (defaultTableJson as unknown as { table: ConfusionTable }).table;
}

/** 후보 생성이 읽는 표 목록 — 우선순위 순(화자 프로필 → 전역). */
export function confusionTables(): ConfusionTable[] {
  const def = getDefaultConfusionTable();
  return current ? [current.table, def] : [def];
}

function persist(): void {
  const rec: SttProfilesRecord = { schema: 1, profiles: Object.fromEntries(profiles) };
  persistChain = persistChain
    .then(() => saveSttProfilesRecord(rec))
    .catch((e) => { logger.log({ type: 'app', extra: withErr('stt_profile_save_failed', e) }); });
}

export function recordSttCommit(col: string, heard: string, decimals: number, colType: string): void {
  if (!current) return;
  applyCommit(current, col, heard, decimals, colType);
  persist();
}

export function recordSttCorrection(col: string, heard: string, said: string, decimals: number): Observation[] | null {
  if (!current) return null;
  const obs = applyCorrection(current, col, heard, said, decimals);
  persist();
  return obs;
}

export function recordSttNegative(col: string, rules: string[]): void {
  if (!current) return;
  applyNegative(current, col, rules);
  persist();
}
