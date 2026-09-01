/**
 * v0.27.0 — export zip 동봉용 `clips-manifest.json` 빌더 (클립 감사 SOP-003 §3 자동화).
 *
 * 클립 파일 ↔ 커밋값(sessions.json) ↔ STT 텍스트/confidence(events.json) ↔ 종류(파일명 서픽스)를
 * 한 매핑으로 묶는다. 분석 세션이 zip만 열고도 "어느 클립이 어느 셀의 몇 번째 시도이고,
 * 최종 커밋값·마지막 인식 결과가 무엇이었는지"를 코드로 join할 수 있게 한다.
 *
 * 설계 원칙:
 * - **순수 계층** — IDB/Drive/import.meta.env 의존 없음(sessionSnapshot.ts 패턴).
 *   Node 단위 테스트(tests/v027-clips-manifest.spec.ts)에서 직접 검증 가능.
 * - **추측 금지, 정직한 null** — sessions/events에서 매칭이 안 되면 null. 키 파싱이 안 되는
 *   클립도 버리지 않고 kind:'unknown' + null 필드로 그대로 실어 감사가 누락을 보게 한다.
 * - **additive** — 기존 zip 구조(device/events/sessions/clips)는 불변, 파일 하나만 추가.
 *   복구(restoreSessionsFromZip)는 clips/ 프리픽스만 읽으므로 영향 없음.
 *
 * 클립 키 규약(useVoiceSession.ts가 SSOT, 여기선 파싱만):
 *   `<sessionId>:<row>:<colId>`            → 최종 커밋 발화(kind 'final')
 *   `<sessionId>:<row>:<colId>:a<N>`       → 정정으로 보관된 N번째 시도(kind 'a<N>')
 *   `<sessionId>:<row>:<colId>:cmd<N>`     → 명령 발화(kind 'cmd<N>')
 *   `... :raw`                             → 트림 전 원본(kind에 ':raw' 서픽스, 단독이면 'raw')
 *   sessionId는 `sess_<ts>` 형태(콜론 없음), colId는 `c<N>` 형태 — split(':') 파싱 안전.
 */
import type JSZip from 'jszip';
import type { Session } from '../types';

export const CLIPS_MANIFEST_SCHEMA = 1;
export const CLIPS_MANIFEST_FILENAME = 'clips-manifest.json';

/** events.json 항목 중 manifest가 읽는 최소 형상(LogEntry의 부분집합 — 방어적 접근). */
export interface ManifestSourceEvent {
  type?: unknown;
  sessionId?: unknown;
  row?: unknown;
  colId?: unknown;
  text?: unknown;
  parsed?: unknown;
  confidence?: unknown;
  /** v0.49 r2 A3 — 합성 `stt` 라인 판별용(아래 findLastCellEvent). */
  extra?: unknown;
  /** v0.51 [CLIP-MUTED-SPAN-1] — `clip_unreliable:muted`가 **어느 클립**의 것인지 잇는 키. */
  clipKey?: unknown;
}

interface ClipManifestEntry {
  /** zip 내 경로 (예: `clips/sess_1:1:c8.wav`). */
  file: string;
  sessionId: string;
  /** 키 파싱 실패 시 null. */
  row: number | null;
  colId: string | null;
  /** 'final' | 'a<N>' | 'cmd<N>' | 'raw' | 'a<N>:raw' | 'cmd<N>:raw' | 'unknown'(키 형식 불일치). */
  kind: string;
  /** sessions.json의 해당 row/col 최종값. 세션/행/컬럼 매칭 실패 시 null ('' 는 실값으로 보존). */
  committedValue: string | null;
  /** 해당 셀의 마지막 value/stt 이벤트의 원문 text. 매칭 실패 시 null. */
  sttText: string | null;
  /** 위 이벤트의 confidence. 이벤트가 없거나 confidence 미탑재(iOS 등) 시 null. */
  confidence: number | null;
  /** 🔴 v0.51 [CLIP-MUTED-SPAN-1] — **이 클립이 트랙 `muted` 구간에 걸쳐 녹음됐는가.**
   *
   *  `true`면 **파일은 있는데 소리가 없을 수 있다** — 마이크를 OS가 가져간 동안(통화/Siri
   *  인터럽션·라우트 변경) 녹음된 것이다. 감사가 이 클립을 「무음이니 앱이 클립을 잃었다」로
   *  읽으면 틀린 결론에 간다. 반대로 이 표시가 **없으면** 무음은 진짜 조사 대상이다.
   *
   *  🔑 **화면에만 띄우면 부족하다**(민구 지시 2026-09-01): 감사는 zip만 열고 도는데, 그때
   *  「이 무음은 설명된 것인가」를 가릴 근거가 manifest 밖에 없으면 판독이 매번 events.json을
   *  손으로 뒤져야 한다. */
  mutedSpan: boolean;
}

export interface ClipsManifest {
  schema: number;
  appVersion: string;
  generatedAt: string;
  clipCount: number;
  clips: ClipManifestEntry[];
}

interface ParsedClipKey {
  sessionId: string;
  row: number | null;
  colId: string | null;
  kind: string;
}

/** 클립 IDB 키 → sessionId/row/colId/kind. 형식이 어긋나면 null 필드 + kind 'unknown'. */
export function parseClipKey(key: string): ParsedClipKey {
  const parts = key.split(':');
  const sessionId = parts[0] ?? '';
  const row = parts.length >= 3 ? Number(parts[1]) : NaN;
  if (parts.length < 3 || !Number.isFinite(row) || parts[2] === '') {
    return { sessionId, row: null, colId: null, kind: 'unknown' };
  }
  const suffixes = parts.slice(3);
  // 서픽스는 a<N> / cmd<N> / raw 만 알려져 있다. 모르는 서픽스도 버리지 않고 그대로 실어
  // (추측 금지) 감사가 신종 키를 발견할 수 있게 한다.
  const kind = suffixes.length === 0 ? 'final' : suffixes.join(':');
  return { sessionId, row, colId: parts[2], kind };
}

function findCommittedValue(
  sessions: Session[],
  sessionId: string,
  row: number | null,
  colId: string | null,
): string | null {
  if (row === null || colId === null) return null;
  const session = sessions.find((s) => s && s.id === sessionId);
  if (!session || !Array.isArray(session.rows)) return null;
  const r = session.rows.find((x) => x && x.index === row);
  const v = r?.values?.[colId];
  return v === undefined ? null : v;
}

function findLastCellEvent(
  events: ManifestSourceEvent[],
  sessionId: string,
  row: number | null,
  colId: string | null,
): { sttText: string | null; confidence: number | null } {
  if (row === null || colId === null) return { sttText: null, confidence: null };
  // 🔴 F5(2026-07-27 실기기 로그 분석) — **`value`(커밋)를 우선하고 `stt`는 `value`가 없을 때만**
  //    폴백한다. 종전엔 종류를 가리지 않고 "뒤에서 첫 매칭"을 채택해서, 커밋 **이후** 같은 셀에
  //    들어온 **비커밋 발화**가 감사 메타데이터를 덮었다.
  //    실측: B세션 row16 횡경이 `committedValue=311.1`인데 `sttText="완료"`(다음 명령 발화)로 남았다.
  //    오디오 blob·시트값은 무손상이지만, 안 고치면 **다음 클립 감사가 거짓 MISMATCH를 낸다** —
  //    감사 도구가 못 믿을 신호를 내면 진짜 오염을 찾는 능력이 같이 죽는다.
  //
  //    events.json은 append 순서(시간순)이므로 뒤에서부터 훑되, `value`를 만나면 즉시 채택하고
  //    `stt`는 **가장 마지막 것만 기억**했다가 `value`가 하나도 없을 때 쓴다.
  //
  // 🔴 v0.49 r2 A3(codex F3 실측) — **합성 `stt` 라인은 관측이 아니다.** W4의 섀도 계측
  //    (`would_salvage:<후보>`)은 원 final과 **같은 셀·같은 text**로 한 줄 더 쓰지만 confidence를
  //    싣지 않는다(직접값과 같은 이유 — 파서가 만든 값이지 엔진이 들은 값이 아니다). 역순 폴백이
  //    그 줄을 먼저 만나면 미커밋 셀의 감사 메타데이터에서 원 STT의 confidence가 사라진다
  //    (실측: 0.95 → null). 클립 감사가 못 믿을 신호를 내면 진짜 오염을 찾는 능력이 같이 죽는다 —
  //    이 함수가 F5에서 이미 한 번 배운 교훈이다. 판별 접두의 선언은 `logEvents.ts` 하나다.
  //    ⚠️ 「그 셀의 stt가 합성 라인뿐」이면 `sttText`도 null이다 — 합성값을 관측인 척 싣지 않는
  //    것이 이 계약이다(원 final stt는 :2505에서 무조건 선행하므로 실사용에선 도달하지 않는다).
  let sttFallback: { sttText: string | null; confidence: number | null } | null = null;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!e || (e.type !== 'value' && e.type !== 'stt')) continue;
    if (e.sessionId !== sessionId || e.row !== row || e.colId !== colId) continue;
    // 🔴 v0.49 r3 #10(claude r2 MEDIUM) — **판별을 접두 allowlist에서 구조로 바꾼다.** A3는
    //    `would_salvage:` 하나만 걸렀는데, `type:'stt'`로 남는 **주석 라인**은 그것만이 아니다:
    //    `manual_hold_restore_controller:started`(useVoiceSession :4334)는 같은 셀 좌표로 남되
    //    text·confidence가 **아예 없어** 같은 가림을 그대로 재현했고(0.95 → null),
    //    `decimal_fraction_recovered`·`kick_result:*`도 같은 부류다. allowlist는 **열린 채 실패**한다 —
    //    새 주석 라인이 추가될 때마다 조용히 새 구멍이 난다.
    //    🔑 판별자: **엔진 관측 라인에는 `extra`가 없다**(:2622 — text+confidence+alts만 싣는다).
    //    `extra` 태그가 붙은 stt는 앱이 덧붙인 주석이다. 이제 닫힌 채 실패한다(모르는 태그는 제외).
    if (e.type === 'stt' && typeof e.extra === 'string' && e.extra !== '') continue;
    const picked = {
      sttText: typeof e.text === 'string' ? e.text : null,
      confidence: typeof e.confidence === 'number' ? e.confidence : null,
    };
    if (e.type === 'value') return picked;
    if (sttFallback === null) sttFallback = picked;
  }
  return sttFallback ?? { sttText: null, confidence: null };
}

/** 🔴 v0.51 [CLIP-MUTED-SPAN-1] — 이 클립 키에 `clip_unreliable:muted`가 붙었는가.
 *
 *  **셀 좌표가 아니라 `clipKey` 정확 매칭이다.** 같은 셀이라도 재시도(`:a<N>`)·명령(`:cmd<N>`)
 *  클립은 **다른 시각의 다른 녹음**이라 muted 구간에 걸쳤는지가 서로 다르다 — 좌표로 매칭하면
 *  멀쩡한 클립까지 「무음일 수 있음」으로 물들어 표시가 신호를 잃는다.
 *  ⚠️ `:raw`(트림 전 원본)만 예외다 — **같은 녹음의 다른 표현**이므로 base 키로 되돌려 본다. */
function findMutedSpan(events: ManifestSourceEvent[], key: string): boolean {
  const base = key.endsWith(':raw') ? key.slice(0, -':raw'.length) : key;
  return events.some(
    (e) => e && e.type === 'clip' && e.extra === 'clip_unreliable:muted' && e.clipKey === base,
  );
}

/** zip 내 clips/ 항목 목록에서 manifest를 만든다. 입력이 뭐가 빠져 있든 throw하지 않고
 *  해당 필드를 null로 채우는 것이 계약(호출부 try/catch는 최후 방어선일 뿐). */
export function buildClipsManifest(
  clipFiles: { file: string; key: string }[],
  sessions: Session[],
  events: ManifestSourceEvent[],
  appVersion: string,
): ClipsManifest {
  const safeSessions = Array.isArray(sessions) ? sessions : [];
  const safeEvents = Array.isArray(events) ? events : [];
  const clips: ClipManifestEntry[] = clipFiles.map(({ file, key }) => {
    const { sessionId, row, colId, kind } = parseClipKey(key);
    const { sttText, confidence } = findLastCellEvent(safeEvents, sessionId, row, colId);
    return {
      file,
      sessionId,
      row,
      colId,
      kind,
      committedValue: findCommittedValue(safeSessions, sessionId, row, colId),
      sttText,
      confidence,
      // v0.51 — 🔑 `schema`는 **올리지 않는다.** 필드 추가는 additive이고(헤더 §설계 원칙),
      //   소비자(`vault-scripts/agy-clip-audit.sh` 등)는 jq로 필드를 읽지 schema를 단언하지
      //   않는다(2026-09-01 전수 확인). 올리면 얻는 것 없이 기존 판독만 흔든다.
      mutedSpan: findMutedSpan(safeEvents, key),
    };
  });
  return {
    schema: CLIPS_MANIFEST_SCHEMA,
    appVersion,
    generatedAt: new Date().toISOString(),
    clipCount: clips.length,
    clips,
  };
}

/** zip의 clips/*.{wav,mp4,webm}을 스캔해 manifest를 생성·동봉한다(exportLogZip 마지막 단계).
 *  파일명 파싱 정규식은 restoreSessionsFromZip(sessionSnapshot.ts)과 동일 규약 — 키에 ':'가
 *  여럿 있으므로 마지막 확장자만 뗀다. 반환값은 테스트/계측용. */
export function attachClipsManifest(
  zip: JSZip,
  sessions: Session[],
  events: ManifestSourceEvent[],
  appVersion: string,
): ClipsManifest {
  const clipFiles: { file: string; key: string }[] = [];
  zip.forEach((path, entry) => {
    if (entry.dir || !path.startsWith('clips/')) return;
    const m = path.slice('clips/'.length).match(/^(.+)\.(wav|mp4|webm)$/);
    if (!m) return;
    clipFiles.push({ file: path, key: m[1] });
  });
  const manifest = buildClipsManifest(clipFiles, sessions, events, appVersion);
  zip.file(CLIPS_MANIFEST_FILENAME, JSON.stringify(manifest, null, 2));
  return manifest;
}
