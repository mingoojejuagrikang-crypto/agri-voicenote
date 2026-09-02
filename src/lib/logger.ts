/** Event logger for voice session diagnostics.
 *  In-memory ring buffer for fast access + IDB persistence (v5.2 Codex 4차 MEDIUM)
 *  so reload-before-sync flows still have diagnostic events available for the auto-uploaded ZIP.
 */
import { appendLogEvent } from './db';

export interface LogEntry {
  ts: number;
  type: 'stt' | 'tts' | 'command' | 'session' | 'value' | 'error' | 'clip'
    | 'stt_blocked_tts_muted' | 'stt_barge_in' | 'stt_rejected_col_name' | 'stt_alt_used' | 'stt_parse_failed'
    | 'stt_rejected_ambiguous_syllable'
    // v0.23.0 입력탭#2: 신뢰도가 허용범위(recognitionTolerance) 미만이라 재질문된 케이스. confidence +
    // extra:'tolerance:<v>'를 동봉 → 차기 로그 분석이 "설정값 vs 실제 신뢰도"를 정량 대조(현재 갭).
    | 'stt_rejected_low_confidence'
    // v0.9.0 빠른 인식(조기확정): interim 안정화로 final 대기 없이 커밋. 절단/정정율 측정 근거.
    | 'stt_early_commit'
    // v0.5.0 W7(T-19): 세션 밖 앱 수명주기 이벤트 — app_boot / hydration_ok / recover_* /
    // drive_upload / setting_changed 등. sessionId가 없으면 '__app__' sentinel이 붙는다.
    | 'app'
    // v0.7.0 B4: 추세 검증 — extra에 trend_alert_fired / trend_alert_confirmed /
    // trend_alert_corrected / trend_alert_dismissed:<cmd> / trend_skip:<cause>를 싣는다.
    // 차기 로그 분석이 오알림률(fired 대비 corrected 비율)을 측정하는 근거.
    | 'trend';
  sessionId?: string;
  row?: number;
  colId?: string;
  colName?: string;
  text?: string;
  confidence?: number;
  alts?: string[];
  ttsText?: string;
  parsed?: string;
  command?: string;
  durationMs?: number;
  /** TTS engine cold-start latency (enqueue → audio onstart). v5.2 Additional-2. */
  startDelayMs?: number | null;
  extra?: string;
  altIdx?: number;
  originalText?: string;
  altsCount?: number;
  /** v0.9.0 딜레이 계측: 마지막 interim → final까지의 간격(ms) = 브라우저 무음 종료감지(EOS) 꼬리.
   *  `stt` 이벤트에 동봉. 앱 처리는 ~1ms이므로 이 값이 사용자 체감 딜레이의 실제 병목 지표. */
  eosTailMs?: number;
  // ── reach telemetry (additive; all optional, only set on specific events) ──
  /** Session-meta, attached to the `session` start/stop events. Lets multiple sessions be
   *  aggregated for real-field reach without changing existing `extra:'start'|'stop'` tags. */
  meta?: SessionMeta;
  /** value event during a correction: the value that was committed BEFORE this modify.
   *  Pairs with `parsed` (final value) to tell STT misrecognition (prefix-drop) apart from
   *  deliberate user re-entry. Only present when the value was reached via modify. */
  previousValue?: string;
  /** clip-preservation telemetry (additive; set on `clip` events only).
   *  `attempt` is the 1-based try index for a cell — every correction archives the prior clip
   *  under a fresh attempt key, so all tries for one cell survive in IDB. `kind` distinguishes a
   *  measurement-value clip from the '수정'/'정정' command utterance that declared the correction.
   *  `clipKey` is the IDB key the clip was preserved under, so analysis can re-join attempts. */
  attempt?: number;
  kind?: 'value' | 'command';
  clipKey?: string;
  /** v0.5.0 W6: preroll length (ms) merged into this clip — set on `clip_duration` /
   *  `clip_trimmed` events. 0 = no preroll captured for this clip. */
  prerollMs?: number;
  /** v0.7.0 B5: measured post-roll (ms) actually delivered before the recorder stopped —
   *  stop-request → actual stop. ≈500 when the full post-roll ran; <500 when a fast next-field
   *  startClip (or dispose) truncated it gracefully. Set on `clip_duration` events whose clip
   *  had a stop requested; absent on clips that were never stop-requested. */
  postrollMs?: number;
  /** v0.50 [CLIP-SILENT-1]: 이 클립이 끝난 시점의 마이크 트랙 상태(`AudioRecorder.getTrackState()`).
   *  2026-08-19 사고에서 트랙은 **살아 있는 채 무음**이었는데, 그 상태를 읽는 유일한 경로가
   *  포그라운드 복귀 훅 안에 있어 **한 번도 관측되지 않았다.** 클립마다 붙여 그 구멍을 닫는다. */
  trackState?: 'none' | 'ended' | 'muted' | 'live';
  /** v0.50 [CLIP-SILENT-1]: 이 클립 **구간**의 마이크 입력 레벨 peak(0~1). null/미동봉 = 프리롤 탭
   *  미가용(관측 수단 없음)이고, **0은 「관측했고 무음이었다」**로 서로 다른 사실이다.
   *  세션 단위 `wave_stats`만으로는 어느 클립이 죽었는지 가릴 수 없어 클립 단위로 내린다. */
  clipPeak?: number;
  /** v0.50 r2 [갈래 B]: 앱 수명 누적 `statechange` **발화 수**(`audioInterruption`).
   *  🔑 **클립과 클립 사이**에 일어난 오디오 세션 전이도 다음 클립에서 드러나게 한다 —
   *  「녹음 중일 때만」으로 좁히면 정작 그 전이(재생이 끝나는 순간)를 놓친다는 리서치 판단. */
  audioSessionEvts?: number;
  /** v0.51 [CLIP-MUTED-SPAN-1]: 이 클립이 **트랙 `muted` 구간에 걸쳤는가**(걸쳤을 때만 `true`,
   *  아니면 **미동봉**). 위 `trackState`와 축이 다르다 — 그쪽은 **종료 시점 스냅샷**이라
   *  `mute → (클립 전체) → unmute`가 클립 안에서 끝나면 `live`로 찍힌다(= 무음 클립인데 로그는
   *  「정상 트랙」이라고 말한다). 이 필드는 **구간 래치**라 그 사각을 덮는다.
   *  🔴 정상 세션에는 실리지 않는다 — 기존 클립 로그의 형상은 바이트·필드 모두 불변이다. */
  mutedSpan?: true;
}

/** Snapshot of session-level context, emitted on the `session` start/stop events. */
interface SessionMeta {
  appVersion: string;
  /** epoch ms; mirrors the sessionId timestamp for convenience */
  startedAt?: number;
  finishedAt?: number;
  /** total rows in the generated table (denominator for completion rate) */
  totalRows?: number;
  /** rows fully completed at the time of the event */
  completedRows?: number;
  /** session label (e.g. auto-built field/plot label). RESERVED — intentionally NOT populated
   *  by the session events: the auto-label derives from a grower-name column (PII). Kept in the
   *  type only so a future de-identified label can slot in without a schema change. */
  label?: string;
  /** active input device actually used for this session (built-in vs external mic) */
  inputDeviceId?: string;
  inputDeviceLabel?: string;
  /** v0.23.0 입력탭#2 — 세션 시작 시 활성 인식 허용범위(recognitionTolerance, 0.40~0.90). 세션 단위로
   *  설정값을 박제해 로그만으로 "허용범위 vs 인식률" 대조가 가능하게 한다(설정값 미로깅 갭 해소). */
  recognitionTolerance?: number;
  // ── v0.34.0 D11a — 세션 시작 설정 스냅샷(자가검증 계측). recognitionTolerance와 동일 패턴으로
  //    `extra:'start'` meta에만 박제 — 로그만으로 "그 세션에 어떤 설정이 활성이었나"(비프 최종
  //    선택·TTS 속도·자동 캡처·이상치 규칙 규모)를 판정한다. 신규 LogEntry type 없음(meta 확장만).
  //    내용성 데이터(컬럼명 등 PII 가능 값)는 싣지 않는다 — anomalyRuleCount는 '개수'만. ──
  /** TTS 배속(설정탭 다이얼, 기본 1.05). */
  ttsRate?: number;
  /** 긍정(커밋 echo) 비프 변형 id — beepVariants.ts SSOT. */
  beepPositiveId?: string;
  /** 부정(알람/재질문) 비프 변형 id. */
  beepNegativeId?: string;
  /** 입력화면 자동 캡처 토글(v0.33.0 항목10). */
  autoScreenCapture?: boolean;
  /** 이상치 알람 규칙(trendRule 또는 pctThreshold)이 걸린 컬럼 수 — 개수만, 컬럼명 제외. */
  anomalyRuleCount?: number;
  /** v0.45.0 WP-1③ — 세션 시작 시 D1 말끊기(barge-in) 토글 스냅샷. 축 C(TTS·확인음) 판정의
   *  전제 조건인데 세션 메타에 없어 로그만으로 D1 상태를 몰랐다(연구 A5). 세션 **중** 변경은
   *  기존 `setting_changed:bargeInEnabled` 이벤트가 남긴다 — 판독은 둘을 짝으로 읽는다(SOP-003). */
  bargeInEnabled?: boolean;
  /** v0.51.1 L(민구 지시 09-02) — 세션의 **대상 시트**. 종전엔 `sessions.json.target`에만 있어 events.json만으로는
   *  어느 시트·탭에 기록한 세션인지 알 수 없었다(09-02 4세션 events에 sync|sheet 문자열 0건). PII 최소화:
   *  spreadsheetId **앞 8자**와 탭 이름만. `rows`는 시작 시점의 totalRows(행 범위는 동기화 때 `sheet_synced`가 남긴다).
   *  시트 미연결(로컬 기록 모드)은 `null`. `extra:'start'` 바이트는 그대로다(meta는 additive). */
  target?: { sheet: string; tab: string; rows: number } | null;
  /** Reserved slot for self-test vs real-field split. Defaults to 'field'; an explicit UI
   *  toggle is a Vance follow-up. userEmail (device.json) + value-pattern already allow
   *  crude post-hoc splitting today. */
  sessionMode?: 'field' | 'test';
  /** v0.51.1 R6 — 화자 id(로그인 이메일 sha256 앞 8자 · 미로그인 `anon`). `session start`에만 실린다.
   *  프로필(`stt-profile.json`)·판독이 같은 값으로 사람을 잇는다 — 이메일 원문은 device.json에만. */
  speaker?: string;
}

export interface DeviceInfo {
  userAgent: string;
  platform: string;
  language: string;
  screenW: number;
  screenH: number;
  /** v0.44.0 §B4 — 실측 가시 뷰포트(innerWidth/innerHeight). 스크린샷(html2canvas)은 100dvh
   *  (동적 가시 뷰포트)를 재는데 screenW/screenH는 정적 OS 해상도라, 실기기에서 iPhone 62px
   *  (7.1%)·태블릿 31px(3.0%)만큼 어긋나 분석자가 잘림 좌표 판정을 그만큼 틀렸다.
   *  기존 screenW/screenH는 과거 로그 호환으로 유지하고 두 축을 나란히 싣는다. */
  viewportW: number;
  viewportH: number;
  deviceMemory?: number;
  hardwareConcurrency?: number;
  appVersion: string;
  audioInputDevices?: { deviceId: string; label: string; kind: string }[];
}

const entries: LogEntry[] = [];

/** 현재 세션 컨텍스트. sessionId를 명시하지 않은 로그(예: AudioRecorder 내부)에 자동 첨부되어
 *  exportLogZip(sessionIds)의 세션 필터 ZIP에서 누락되지 않도록 한다. */
let currentSessionId: string | undefined;

/** v0.33.0 10-B — 로그 tap 리스너. 자동 화면 캡처(screenshot.ts)가 "앱 반응으로 화면이 바뀌는
 *  순간"(커밋 echo·이상치 알람·재질문·행 이동·micLost·pause/resume·세션 시작/종료)을 이미 로깅되는
 *  이벤트에서 파생하기 위한 단일 배선 지점. 리스너 예외는 절대 로깅 흐름을 깨지 않는다. */
const listeners = new Set<(entry: LogEntry) => void>();

export const logger = {
  setSessionId(id: string | undefined): void {
    currentSessionId = id;
  },

  device(): DeviceInfo {
    const nav = navigator as Navigator & { deviceMemory?: number };
    return {
      userAgent: nav.userAgent,
      platform: nav.platform,
      language: nav.language,
      screenW: screen.width,
      screenH: screen.height,
      // §B4 — 호출 시점의 실측 뷰포트(피드백 제출·로그 내보내기 순간의 값).
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
      deviceMemory: nav.deviceMemory,
      hardwareConcurrency: nav.hardwareConcurrency,
      // 🔴 v0.46.0 (민구 지시 08-06) — 테스트 배포본은 **버전 문자열 자체에** 표식을 단다.
      //   왜: 프리뷰는 bump를 안 해서(게이트 통과 후에만) **프로덕션과 버전 숫자가 같아진다.**
      //   08-06 실측으로 둘 다 `0.45.0`이었고, 민구 제보 2건이 어느 빌드에서 왔는지 가르려고
      //   라이브 번들을 `curl`로 받아 회차 전용 문자열을 grep해야 했다(`SOP-003` 수확 절차 밖의
      //   임시 방편). 이 한 줄이면 **`device.json`만 보고 판정된다.**
      //   ⚠️ `appVersion`은 이 레포에서 **비교·파싱되지 않는다**(기록 전용 — `sessionSnapshot`도
      //   문자열로 담기만 한다). 확인하고 붙였다.
      appVersion:
        typeof __APP_VERSION__ !== 'undefined'
          ? `${__APP_VERSION__}${typeof __PREVIEW_BUILD__ !== 'undefined' && __PREVIEW_BUILD__ ? '-preview' : ''}`
          : '?',
    };
  },

  async deviceAsync(): Promise<DeviceInfo> {
    const base = this.device();
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((d) => d.kind === 'audioinput');
      base.audioInputDevices = audioInputs.map((d) => ({
        deviceId: d.deviceId, label: d.label, kind: d.kind,
      }));
    } catch { /* permission denied or unavailable */ }
    return base;
  },

  log(entry: Omit<LogEntry, 'ts'>): void {
    // sessionId 미지정 시 현재 세션 컨텍스트를 자동 첨부(entry가 명시하면 그대로 우선).
    const full = { ts: Date.now(), sessionId: currentSessionId, ...entry };
    // v0.5.0 W7(T-19): 세션 밖 이벤트(app_boot, hydration, recover, 업로드, 설정 변경 등)는
    // sessionId가 없어 IDB `bySessionId` 인덱스에 안 잡히고(undefined는 인덱싱 불가) 세션 필터
    // ZIP에서 통째로 빠졌다. '__app__' sentinel을 부여해 영속화·내보내기 모두에 포함시킨다.
    if (full.sessionId == null) full.sessionId = '__app__';
    entries.push(full);
    // Keep max 2000 entries in memory
    if (entries.length > 2000) entries.splice(0, entries.length - 2000);
    // Fire-and-forget IDB persistence (failures fall back to memory-only behavior)
    void appendLogEvent(full as unknown as Parameters<typeof appendLogEvent>[0]);
    // v0.33.0 10-B — tap 리스너 통지(자동 캡처 트리거 파생). 리스너 오류는 non-fatal.
    listeners.forEach((fn) => { try { fn(full); } catch { /* non-fatal */ } });
  },

  /** v0.33.0 10-B — 로그 tap 구독. 반환 함수로 해지. */
  subscribe(fn: (entry: LogEntry) => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },

  getAll(): LogEntry[] {
    return [...entries];
  },

  clear(): void {
    entries.length = 0;
  },
};
