/**
 * 설정 스토어의 **상태 형태와 기본값** (`SettingsState` · `makeSettingsDefaults` ·
 * 입력값 설정 초기화 패치).
 *
 * [ENV-12] 2026-08-15 — `settingsStore.ts`에서 분리했다. 경계는 **선언 / 배선**이다:
 * 여기에는 zustand가 없다(create·persist는 `settingsStore.ts`가 소유). 그래서 기본값 SSOT와
 * 초기화 범위 계약을 스토어를 띄우지 않고 읽을 수 있다.
 *
 * ⚠️ import 방향은 **단방향**이다 — 이 파일은 `settingsStore.ts`를 import하지 않는다
 * (`settingsMigrate.ts`가 여기를 import하고, 스토어가 둘 다 import한다).
 */
import type { Column, SheetConfig, SavedSheet, GoogleConnection } from '../types';
import { reconcileColumnFlags } from '../lib/columnFlags';
import type { FolderCache } from '../lib/driveFolders';
import { defaultDesignatedDate } from '../lib/weekTuesday';
import { DEFAULT_POSITIVE_BEEP_ID, DEFAULT_NEGATIVE_BEEP_ID } from '../lib/beepVariants';
import { CHIP_SWEEP_DEFAULT_SECONDS } from '../lib/chipSweep';

// ── v0.26.0 F1 재변경(민구 최종 결정 2026-07-03) — "높을수록(100에 가까울수록) 엄격" ──────────────
// 이력: 종전(v0.24.0까지) 다이얼 값 = 최소 신뢰도(높을수록 엄격) → v0.25.0에서 "높일수록 관대"로
// 게이트 반전 → v0.25.0 실기기 후 민구 최종 결정으로 **원래 방향(높을수록 엄격) 복귀**. 이번에는
// 다이얼 캡션·aria로 방향을 화면에 명시해 의미 오해가 재발하지 않게 한다(VoiceScreen hint 참조).
// 저장값·다이얼 위치·기본값(0.60)·대역[0.40~0.90]은 전 과정 내내 불변 —
// 방향 결정은 이 함수 한 곳에만 살고, 값 게이트(useVoiceSession)와 신뢰도 색 임계(VoiceScreen)가
// 공유한다 → 시각·게이트 항상 일치. 또 방향을 바꾸게 되면 이 함수와 hint/aria 문구만 손대면 된다.
export const RECOGNITION_TOLERANCE_MIN = 0.4;
export const RECOGNITION_TOLERANCE_MAX = 0.9;
/** 허용범위 다이얼 값 → 실제 최소 신뢰도(직접 매핑: 다이얼 90% = minConf 0.90 가장 엄격).
 *  2자리 반올림은 반전식 시절의 부동소수 잔여 방지 관례를 유지(로그 문자열·색 임계 안정). */
export function minConfidenceForTolerance(tolerance: number): number {
  return Math.round(tolerance * 100) / 100;
}

/** v0.51 — 연결 기록(`googleConnection`)의 **형태 SSOT**. 손상된 영속본은 「연결 없음」으로
 *  취급한다(만료 쪽이 안전한 기본값이다 — 거짓 「연결됨」은 [AUTH-7]로 돌아가는 길이다).
 *
 *  🔴 **판정·갱신 규칙(`lib/googleConnection.ts`)이 아니라 여기 사는 이유**: 그 모듈은 라이브
 *  스토어(`settingsStore`)를 읽으므로, `settingsMigrate`가 그걸 import하면
 *  `settingsStore → settingsMigrate → googleConnection → settingsStore` 순환이 된다.
 *  하이드레이션(=migrate)은 스토어 **모듈 평가 도중** 돌기 때문에
 *  `[LOGEVENTS-CYCLE-1]`의 "위험 조건"이 실제로 성립하는 자리다. 형태 검사만 이 leaf로 내리면
 *  마이그레이션과 런타임이 **같은 술어**를 쓰면서도 순환이 생기지 않는다
 *  (`googleConnection.ts`가 이 함수를 재수출한다 — 호출부는 그쪽 한 곳만 알면 된다). */
export function isConnectionRecord(v: unknown): v is GoogleConnection {
  if (v === null || typeof v !== 'object') return false;
  const c = v as Partial<GoogleConnection>;
  return (
    (typeof c.email === 'string' || c.email === null) &&
    typeof c.connectedAt === 'number' && Number.isFinite(c.connectedAt) &&
    typeof c.lastUsedAt === 'number' && Number.isFinite(c.lastUsedAt)
  );
}

export interface SettingsState {
  googleConnected: boolean;
  userEmail: string | null;
  /** v0.51 — 「계정 연결」 4주 슬라이딩 창 기록. **토큰과 분리된** 앱 차원의 연결 개념이고,
   *  판정·갱신 규칙(28일 창 · 시간당 1회 touch · 죽은 창 부활 금지 · 만료 시 revoke 금지)은
   *  `lib/googleConnection.ts`가 SSOT다. `googleConnected`는 그 판정의 **화면용 투영**이 된다. */
  googleConnection: GoogleConnection | null;
  sheet: SheetConfig | null;
  sheetUrl: string;
  sheetTab: string;
  /** 현재 columns를 유추한 시트 출처. 두 값이 다음 로드 대상과 모두 같을 때만 사용자 설정을 보존한다. */
  columnsSheetId: string | null;
  columnsSheetTab: string | null;
  availableSheets: string[];
  /** v0.13.0 R1 — 저장된 스프레드시트 목록(파일명 기반, 최근 사용 순). localStorage에 영속(같은
   *  persist 키). 토큰 만료로 연결이 풀려도 목록은 남아, 재로그인 후 한 번에 다시 선택할 수 있다. */
  savedSheets: SavedSheet[];
  manualMode: boolean;
  columns: Column[];
  tableGenerated: boolean;
  totalRows: number;
  /** TTS playback rate (0.5 ~ 2.0) */
  ttsRate: number;
  /** v0.20.0 — 음성인식 허용범위 다이얼(입력탭). 사용자 조절, 범위 0.40~0.90, 기본 0.60. 장갑 손가락
   *  조작용 가로 다이얼이 이 값을 제어한다. v0.26.0 F1 재변경(민구 최종 결정): **높을수록 엄격(적게
   *  수용)**. 저장값은 다이얼 위치이고, 실제 최소 신뢰도 변환은 minConfidenceForTolerance() 한 곳에만
   *  산다(게이트=useVoiceSession, 색 임계=VoiceScreen 공유). 방향 이력은 그 함수 주석 참조. */
  recognitionTolerance: number;
  /** Which auto column's value is used as the session label suffix. null = auto-pick. */
  sessionLabelColId: string | null;
  /** Pre-computed session label captured at table generation time. */
  sessionAutoLabel: string | null;
  /** v0.22.0 — 사용자 자유입력 세션명(설정탭 "세션명" 텍스트칸). 비어있지 않으면 자동 라벨(생성일+
   *  상수들)보다 **우선**해 세션명이 된다(buildSessionLabel의 customName). null/'' = 미사용(자동). */
  sessionCustomLabel: string | null;
  /** v0.9.0 (딜레이 단축 실험) — 빠른 인식. true면 interim(중간) 결과가 유효 숫자로 안정되면
   *  브라우저 final(무음 종료감지)을 기다리지 않고 조기 커밋한다. 미완성 숫자 절단 리스크가 있어
   *  기본 false(실기기 A/B용). */
  fastRecognition: boolean;
  /** v0.33.0 10-B — 입력화면 자동 캡처(음성입력 반응 시점 JPEG 저장, 로그 zip 동봉). 기본 on
   *  (민구 확정). 가드(2초 스로틀·세션당 100장)는 src/lib/screenshot.ts가 SSOT. */
  autoScreenCapture: boolean;
  /** v0.46.0 WP-D(민구 R3, 제보 F17) — 칩존 좌우 왕복 스크롤의 **편도** 초. `0` = 끔.
   *  기본 8초(민구 확정: *"기본값은 8초, 0초는 OFF"*). 편도로 읽는 근거·왕복 산술·상한은
   *  src/lib/chipSweep.ts가 SSOT — 여기는 값만 담는다. */
  chipSweepSeconds: number;
  /** v0.33.0 10-C — 비프음 선택(긍정=값 수용, 부정=이상치 알람). 값은 beepVariants.ts의 변형 id.
   *  기본 = 현행 사운드(상승/하강 스윕). 해석(kind→극성→변형)은 src/lib/beep.ts가 SSOT. */
  beepPositiveId: string;
  beepNegativeId: string;
  /** v0.35.0 FB-D(Vance) — 비프음 마스터 볼륨(0~1). 기존 세그먼트 gain(0.04~0.055 하드코딩)에
   *  beep.ts가 곱하는 마스터 배수로 매핑(0~1 → 0~BEEP_VOLUME_MAX). 기본 0.5(현행 1×보다 큼 —
   *  민구 "확인음 더 크게"). 500–1200Hz·클립경계 제약은 beepVariants.ts에서 유지(STT 오트리거 방지). */
  beepVolume: number;
  /** v0.44.0 §D1(민구 확정 08-02) — barge-in(말끊기) 토글. true(기본) = 현행 이어폰 경로:
   *  TTS 재생 중에도 STT가 살아 있어 말하면 즉시 끊고 처리. false = half-duplex 복원:
   *  TTS 재생 중 STT를 물리적으로 중지(스피커폰에서 TTS 에코가 STT로 되먹임돼 45셀에
   *  771발화가 된 08-02 실측의 처방). 라이브 배선은 speech.setBargeInEnabled 모듈 플래그 —
   *  변경 지점(입력탭 서랍 토글·세션 시작·초기화)에서 동기화한다(preferredVoiceName 패턴). */
  bargeInEnabled: boolean;
  /** Preferred Web Speech API voice name for ko-KR TTS. Empty string = auto (first available). */
  preferredVoiceName: string;
  /** v0.10.1: 캐시된 관리자 폴더 내 본인 팀 하위 폴더 — race 방지용, 첫 결정 후 재사용.
   *  v0.35.1(리뷰 Codex High): 어느 계정의 캐시인지(email) 결합 — A 로그아웃 → B 로그인 시
   *  A의 폴더 ID 재사용으로 관리자 공유 폴더에서 로그가 계정 간 혼입되던 결함 차단.
   *  검증·해석은 driveFolders.cachedFolderIdFor가 SSOT(이메일 불일치 = 캐시 미스). */
  teamFolderCache: FolderCache | null;
  /** v0.4.5 Q1b: 캐시된 사용자 Drive 내 `agri-voicenote/log/`(전환기 구 `survey-011/log/`) 폴더 — 매 업로드 검색 방지.
   *  v0.35.1: teamFolderCache와 동일하게 계정 결합. */
  userLogFolderCache: FolderCache | null;
  /** v0.7.0 — 조사시기(회차) 컬럼 id. null = 자동(첫 date 컬럼, '조사일자' 우선) —
   *  해석은 pastValues.resolveRoundCol. */
  roundDateColId: string | null;
  /** v0.8.0(v6) 내부 마이그레이션 마커 — "추세→이상치" trendRule 클리어를 이미 1회 수행했는지.
   *  다운그레이드(v5) 라운드트립 후 재업그레이드 시 사용자가 v6에서 새로 지정한 trendRule을
   *  다시 지우지 않도록 한다. 사용자 설정 아님(UI 미노출). */
  trendRuleClearedV6?: boolean;
  /** v0.44.0 §C8 F28 — 입력값 설정을 마지막으로 손질한 **로컬 날짜**(ISO 'YYYY-MM-DD').
   *  INPUT_SETTINGS_KEYS(컬럼·생성 테이블·세션명·음성/소리 옵션)가 바뀔 때마다 자동 스탬프되고,
   *  부팅 시 오늘과 다르면 입력값 설정을 기본값으로 자동 복원한다(제외: 로그인·시트 주소·시트 탭 —
   *  onRehydrateStorage의 F28 블록 참조). null = 설정한 적 없음/초기화 직후 → 발동하지 않음.
   *  사용자 설정 아님(UI 미노출). */
  inputSettingsDate: string | null;
  /** v0.46.0 WP-J J-5 (민구 R11 확정) — **컬럼별 선택지 제외 목록**(colId → 지운 값들).
   *  사용자가 J-4로 선택지를 지우면 여기 들어가고, 이후 시트 자동 갱신이 그 값을 **건너뛴다**
   *  ("한 번 지우면 계속 유지"). 「설정 초기화」는 이 맵도 함께 비운다 — 그래야 초기화가
   *  *"리스트를 잃는 사고"* 가 아니라 *"선택지를 시트 기준으로 새로 받는 정상 동작"* 이 된다.
   *
   *  🔑 **왜 `Column` 안이 아니라 스토어 최상위 맵인가**(13번 세션 설계 인계):
   *   ① `Column`에 필드를 늘리면 보존 필드를 나열하는 `columnFlags.ts`를 만져야 하는데 그 파일은
   *      다른 레인(WP-A) 소유다. ② 더 중요한 건, 시트 재유추가 컬럼 배열을 **통째로 갈아끼워도**
   *      최상위 맵은 살아남는다는 것이다 — 컬럼 안에 두면 자동 갱신이 제외 목록을 지워 R11이 깨진다.
   *
   *  ⚠️ 키인 colId는 `sheets.stableColumnId`가 **컬럼 이름에서 만든 해시**라, 다른 시트라도 이름이
   *  같으면 같은 id가 된다. 그래서 컬럼 출처 시트가 바뀌면 이 맵을 비운다(useSettingsSheetConnection.loadHeaders)
   *  — 안 그러면 감귤 시트에서 지운 값이 품질조사 시트의 동명 컬럼에 새어 붙는다. */
  optionExclusions: Record<string, string[]>;

  set: (partial: Partial<Omit<SettingsState, 'set' | 'updateColumn' | 'addColumn' | 'removeColumn' | 'reorderColumns' | 'saveSheet' | 'removeSavedSheet'>>) => void;
  updateColumn: (id: string, next: Column) => void;
  addColumn: () => void;
  removeColumn: (id: string) => void;
  reorderColumns: (fromIdx: number, toIdx: number) => void;
  /** v0.13.0 R1 — 시트를 저장 목록에 추가/갱신(sheetId 기준 dedupe — 있으면 name/url/addedAt 갱신
   *  후 최상단으로, 없으면 unshift). 연결 성공 시 자동 호출 + 사용자가 명시 저장할 때도 사용. */
  saveSheet: (entry: SavedSheet) => void;
  /** v0.13.0 R1 — 저장 목록에서 제거(sheetId 기준). */
  removeSavedSheet: (sheetId: string) => void;
}

const MOCK_COLUMNS: Column[] = [
  { id: 'c1',  name: '조사일자', type: 'date',  input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' } },
  { id: 'c2',  name: '기준일자', type: 'date',  input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '2026-05-13' } },
  { id: 'c3',  name: '농가명',   type: 'text',  input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' } },
  { id: 'c4',  name: '라벨',     type: 'text',  input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: 'A' } },
  { id: 'c5',  name: '처리',     type: 'text',  input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '시험' } },
  { id: 'c6',  name: '조사나무', type: 'int',   input: 'auto', ttsAnnounce: true,  auto: { kind: 'seq', from: 1, to: 10 } },
  { id: 'c7',  name: '조사과실', type: 'int',   input: 'auto', ttsAnnounce: true,  auto: { kind: 'seq', from: 1, to: 5 } },
  { id: 'c8',  name: '횡경',     type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
  { id: 'c9',  name: '종경',     type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
  { id: 'c10', name: '비고',     type: 'text',  input: 'touch', ttsAnnounce: false, auto: { kind: 'fixed', value: '' } },
];

/**
 * 항목명 기반 의미 기본값(파일/시트/기존 사용자 불문 일관 적용):
 *  - "비고" → 터치 입력(메모). 사용자가 자유롭게 메모할 수 있어야 함.
 *
 * 롤백(v0.4.3): '농가명 → 이름 데이터형' 강제는 실사용에서 불편하여 제거. 세션명은 이름 문자열
 * 식별로 대체(VoiceScreen/SettingsScreen). 기존 persisted 'name' 컬럼은 로드 시 'text'로 치유.
 */
export function applySemanticDefaults(col: Column): Column {
  const nm = col.name?.trim();
  if (nm === '비고' && col.input !== 'touch') return { ...col, input: 'touch' };
  if (col.type === 'name') return { ...col, type: 'text' };
  return col;
}

/** 메서드를 제외한 설정 상태(기본값의 형태). */
export type SettingsDefaults = Omit<
  SettingsState,
  'set' | 'updateColumn' | 'addColumn' | 'removeColumn' | 'reorderColumns' | 'saveSheet' | 'removeSavedSheet'
>;

/**
 * v0.32.0 설정탭 UX(Vance) — 설정 기본값 SSOT. create() 초기 상태와 설정탭 '초기화'가 공유한다.
 * 상수가 아니라 **함수**인 이유: columns가 호출마다 fresh 배열/객체여야 하기 때문(초기 상태와
 * 초기화 결과가 가변 참조를 공유하면 안 됨). structuredClone으로 MOCK_COLUMNS의 중첩 auto까지
 * 새로 만든 뒤 기존과 동일하게 reconcileColumnFlags(c, c)로 샘플키 유추값을 부여한다.
 */
export function makeSettingsDefaults(): SettingsDefaults {
  return {
    googleConnected: false,
    userEmail: null,
    googleConnection: null,
    sheet: null,
    sheetUrl: '',
    sheetTab: '',
    columnsSheetId: null,
    columnsSheetTab: null,
    availableSheets: [],
    savedSheets: [],
    manualMode: false,
    // 신규 설치 기본 컬럼에도 샘플키 유추값을 미리 부여(prev===next → undefined일 때만 유추).
    // v0.44.0 §C8 F27 — 고정 날짜 샘플(기준일자 c2)의 기본값은 정적 과거 날짜가 아니라 호출 시점의
    // "이번 주(일요일 시작)의 화요일"로 계산한다(민구 원문: "기준일자 기본값은 오늘 주차의 화요일").
    // '오늘' 치환 컬럼(조사일자 c1)은 그대로 둔다 — 동적 치환은 autoValue가 담당.
    columns: structuredClone(MOCK_COLUMNS).map((c) => {
      const seeded =
        c.type === 'date' && c.auto.kind === 'fixed' && c.auto.value !== '오늘'
          ? { ...c, auto: { ...c.auto, value: defaultDesignatedDate() } }
          : c;
      return reconcileColumnFlags(seeded, seeded);
    }),
    tableGenerated: false,
    totalRows: 50,
    ttsRate: 1.05,
    recognitionTolerance: 0.6,
    sessionLabelColId: null,
    sessionAutoLabel: null,
    sessionCustomLabel: null,
    fastRecognition: false,
    autoScreenCapture: true,
    chipSweepSeconds: CHIP_SWEEP_DEFAULT_SECONDS,
    beepPositiveId: DEFAULT_POSITIVE_BEEP_ID,
    beepNegativeId: DEFAULT_NEGATIVE_BEEP_ID,
    beepVolume: 0.5,
    bargeInEnabled: true,
    preferredVoiceName: '',
    teamFolderCache: null,
    userLogFolderCache: null,
    roundDateColId: null,
    inputSettingsDate: null,
    optionExclusions: {},
  };
}

/** v0.44.0 §C8 F28 — "입력값 설정"으로 간주하는 키(자동 초기화 대상 = 스탬프 갱신 대상).
 *  범위 판단: 수동 '초기화'(useSettingsReset.onResetConfirm)가 기본 보존하는 로그인·시트
 *  주소·시트 탭·계정 캐시를 뺀 **나머지 전부** — 컬럼(+출처는 항상 동반), 생성 테이블, 세션명,
 *  음성/소리/검토 옵션. 민구 원문(F28): "초기화 기능 발동 조건 추가 … (로그인정보, 구글시트 주소,
 *  시트 선택 탭은 제외)" — 즉 효과는 기존 초기화(보존 기본값)와 동일해야 한다. */
const INPUT_SETTINGS_KEYS = [
  'columns', 'tableGenerated', 'totalRows', 'manualMode',
  'ttsRate', 'recognitionTolerance', 'fastRecognition', 'autoScreenCapture',
  'beepPositiveId', 'beepNegativeId', 'beepVolume', 'bargeInEnabled', 'preferredVoiceName',
  'sessionLabelColId', 'sessionAutoLabel', 'sessionCustomLabel', 'roundDateColId',
  // v0.46.0 WP-J J-5 — 선택지를 지우는 것도 "입력값 설정 손질"이다(컬럼과 같은 축).
  'optionExclusions',
] as const;

export function touchesInputSettings(partial: Record<string, unknown>): boolean {
  return INPUT_SETTINGS_KEYS.some((k) => k in partial);
}

/**
 * v0.44.0 §C8 F28 — 입력값 설정 초기화 패치(SSOT). 수동 '초기화'(onResetConfirm)와 날짜 변경
 * 자동 초기화가 **같은 패치**를 쓴다 — 두 경로의 범위가 어긋나면 "초기화 기능 발동 조건 추가"라는
 * 민구 원문 계약이 깨진다. 로그인(googleConnected/userEmail)·시트 주소(sheetUrl/sheet/savedSheets)·
 * 시트 탭(sheetTab/availableSheets)·계정 결합 폴더 캐시는 **건드리지 않는다**.
 * inputSettingsDate:null 포함 — 초기화 직후에는 다음 손질 전까지 자동 발동하지 않는다.
 */
export function inputSettingsResetPatch(): Partial<SettingsState> {
  const d = makeSettingsDefaults();
  return {
    columns: d.columns, // fresh copy — makeSettingsDefaults가 호출마다 새 객체를 만든다
    // v0.38.0 리뷰#3 — 컬럼과 **출처는 항상 함께** 움직여야 한다(오래된 출처가 남으면 다음 재연결이
    // 샘플 기본값을 "그 시트의 사용자 설정"으로 오인해 보존한다).
    columnsSheetId: d.columnsSheetId,
    columnsSheetTab: d.columnsSheetTab,
    tableGenerated: false,
    totalRows: d.totalRows,
    ttsRate: d.ttsRate,
    recognitionTolerance: d.recognitionTolerance,
    fastRecognition: d.fastRecognition,
    autoScreenCapture: d.autoScreenCapture,
    beepPositiveId: d.beepPositiveId,
    beepNegativeId: d.beepNegativeId,
    beepVolume: d.beepVolume,
    bargeInEnabled: d.bargeInEnabled,
    manualMode: d.manualMode,
    preferredVoiceName: d.preferredVoiceName,
    sessionLabelColId: d.sessionLabelColId,
    sessionAutoLabel: d.sessionAutoLabel,
    sessionCustomLabel: d.sessionCustomLabel,
    roundDateColId: d.roundDateColId,
    inputSettingsDate: null,
    // v0.46.0 WP-J J-5 (민구 R11 확정) — 초기화는 **제외 목록도 비운다**. 그래야 다음 갱신이
    // 시트 기준으로 선택지를 전부 재생성한다(초기화 = 리스트 유실이 아니라 재수신).
    optionExclusions: {},
  };
}
