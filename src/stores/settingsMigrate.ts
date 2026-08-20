/**
 * 설정 persist의 **버전 마이그레이션 이력** (`agri-voicenote-settings-v3` — 구 `survey-011-settings-v3`, v0.50 개명 · version 12).
 *
 * [ENV-12] 2026-08-15 — `settingsStore.ts`에서 **본문 무수정**으로 옮겼다(들여쓰기만 6칸 제거).
 * 🔴 **이 파일에서 문장 순서를 바꾸지 마라.** 무조건 coercion 블록이 먼저 돌고 그 뒤에
 * `version < N` 게이트가 오름차순으로 온다 — 순서가 바뀌면 기존 사용자 저장본의 치유 결과가
 * 달라진다(예: v6 블록은 위쪽 `reconcileColumnFlags`가 이미 정규화한 columns를 전제한다).
 *
 * ⚠️ import 방향은 **단방향**이다 — `settingsState.ts`만 참조하고 `settingsStore.ts`는
 * 참조하지 않는다.
 */
import type { Column, SavedSheet, LegacyInputMode } from '../types';
import { reconcileColumnFlags } from '../lib/columnFlags';
import { isFolderCache } from '../lib/driveFolders';
import {
  DEFAULT_POSITIVE_BEEP_ID,
  DEFAULT_NEGATIVE_BEEP_ID,
  isBeepVariantId,
} from '../lib/beepVariants';
import { normalizeChipSweepSeconds } from '../lib/chipSweep';
import {
  applySemanticDefaults,
  RECOGNITION_TOLERANCE_MIN,
  RECOGNITION_TOLERANCE_MAX,
  type SettingsState,
} from './settingsState';

/** Migrate legacy mode-based columns to new input/ttsAnnounce shape. */
function migrateColumn(c: unknown): Column {
  const x = c as Partial<Column> & { mode?: LegacyInputMode };
  if (x.input !== undefined && x.ttsAnnounce !== undefined) {
    return applySemanticDefaults(x as Column);
  }
  let input: 'auto' | 'voice' = 'auto';
  let ttsAnnounce = true;
  switch (x.mode) {
    case 'voice':  input = 'voice'; ttsAnnounce = true;  break;
    case 'silent': input = 'auto';  ttsAnnounce = false; break;
    case 'auto':
    default:       input = 'auto';  ttsAnnounce = true;  break;
  }
  return applySemanticDefaults({
    id: x.id || `c${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: x.name || '새 항목',
    type: x.type || 'text',
    input,
    ttsAnnounce,
    auto: x.auto || { kind: 'fixed', value: '' },
    decimals: x.decimals,
  });
}

/** persist `migrate` 핸들러. zustand가 저장본 version < 현재 version일 때만 호출한다
 *  (같은 version이면 호출되지 않는다 — 그 축은 스토어의 `merge`가 담당한다). */
export function migrateSettings(persisted: unknown, version: number): SettingsState {
  const s = persisted as Partial<SettingsState> & {
    columns?: unknown[];
    trendAlertEnabled?: unknown;
    reviewScope?: unknown;
    speakerOutput?: unknown;
    speakerphoneMode?: unknown;
    noisyMode?: unknown;
    trendRuleClearedV6?: boolean;
    savedSheets?: unknown;
  };
  if (Array.isArray(s.columns)) {
    // 기존 컬럼 전부에 샘플키 유추 기본값 부여(사용자가 이미 토글한 boolean은 보존:
    // prev===next 호출은 structural change가 아니므로 undefined일 때만 유추) + 잘못된
    // trendRule/pctThreshold 값 방어적 정규화(columnFlags 규칙).
    s.columns = (s.columns as unknown[])
      .map(migrateColumn)
      .map((c) => reconcileColumnFlags(c, c));
  }
  if (typeof s.ttsRate !== 'number') s.ttsRate = 1.05;
  // v0.20.0 — 인식 허용범위(최소 신뢰도). 구버전 영속본엔 없으므로 기본 0.60으로 치유.
  // 비유한수·범위이탈도 안전 기본값으로(ttsRate와 동일한 무조건 coercion 패턴).
  if (
    typeof s.recognitionTolerance !== 'number' ||
    !Number.isFinite(s.recognitionTolerance) ||
    s.recognitionTolerance < RECOGNITION_TOLERANCE_MIN ||
    s.recognitionTolerance > RECOGNITION_TOLERANCE_MAX
  ) {
    s.recognitionTolerance = 0.6;
  }
  if (typeof s.sessionLabelColId !== 'string' && s.sessionLabelColId !== null) s.sessionLabelColId = null;
  if (typeof s.sessionAutoLabel !== 'string' && s.sessionAutoLabel !== null) s.sessionAutoLabel = null;
  // v0.22.0 — 자유입력 세션명. 구버전 영속본엔 없으므로 null로 치유(미사용=자동 라벨).
  if (typeof s.sessionCustomLabel !== 'string' && s.sessionCustomLabel !== null) s.sessionCustomLabel = null;
  if (typeof s.fastRecognition !== 'boolean') s.fastRecognition = false;
  // v0.33.0 10-B/10-C — 자동 캡처·비프음 선택 신설. sessionCustomLabel과 같은 무조건
  // coercion 패턴으로 구버전 누락/손상을 안전 기본값으로 치유한다.
  if (typeof s.autoScreenCapture !== 'boolean') s.autoScreenCapture = true;
  // v0.46.0 WP-D — 칩 왕복 편도 초. 구버전 영속본엔 없으므로 기본 8로 치유(autoScreenCapture와
  // 같은 무조건 coercion 패턴). 0(끔)은 **유효값**이라 통과한다 — 판정은 chipSweep.ts가 SSOT.
  s.chipSweepSeconds = normalizeChipSweepSeconds(s.chipSweepSeconds);
  if (!isBeepVariantId(s.beepPositiveId, 'positive')) s.beepPositiveId = DEFAULT_POSITIVE_BEEP_ID;
  if (!isBeepVariantId(s.beepNegativeId, 'negative')) s.beepNegativeId = DEFAULT_NEGATIVE_BEEP_ID;
  // v0.35.0 FB-D — 비프 마스터 볼륨. version 11 유지(무조건 coercion 한 줄, beepPositiveId 패턴).
  if (typeof s.beepVolume !== 'number' || !Number.isFinite(s.beepVolume) || s.beepVolume < 0 || s.beepVolume > 1) {
    s.beepVolume = 0.5;
  }
  // v0.44.0 §D1 — barge-in 토글. 구버전 영속본엔 없으므로 기본 ON(true)으로 치유(민구 확정:
  // "디폴트는 바지인 on" — 기존 사용자 = undefined → ON). 같은 persist version의 저장본은
  // migrate를 안 타지만, 그 경로는 merge의 current 기본값(true)이 같은 결과를 보장한다.
  if (typeof s.bargeInEnabled !== 'boolean') s.bargeInEnabled = true;
  if (typeof s.preferredVoiceName !== 'string') s.preferredVoiceName = '';
  // v0.35.1 — 계정 결합 폴더 캐시(형태 손상은 null로 치유). legacy 맨 문자열 캐시
  // (teamFolderId/userLogFolderId)는 계정 미상이라 승계하지 않는다(DEPRECATED strip —
  // 업데이트 후 첫 업로드에서 1회 재검색, 무해).
  if (s.teamFolderCache !== null && !isFolderCache(s.teamFolderCache)) s.teamFolderCache = null;
  if (s.userLogFolderCache !== null && !isFolderCache(s.userLogFolderCache)) s.userLogFolderCache = null;
  // v0.7.0 — 조사시기(회차) 컬럼 id는 유지(UI만 v0.8.0 조회탭으로 이전 — WS4).
  if (typeof s.roundDateColId !== 'string' && s.roundDateColId !== null) s.roundDateColId = null;
  // v0.44.0 §C8 F28 — 입력값 설정 스탬프. 구버전 영속본엔 없으므로 null(발동 안 함)로 치유
  // (sessionCustomLabel과 같은 무조건 coercion 패턴). ISO 형식이 아니면 신뢰하지 않는다.
  if (typeof s.inputSettingsDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.inputSettingsDate)) {
    s.inputSettingsDate = null;
  }

  // v0.35.1 Stage 0 — 비교탭 영속 6필드 제거는 migrate가 아니라 **merge 단계의
  // DEPRECATED_PERSIST_KEYS strip**이 담당한다(아래 persist 옵션). 이유(리뷰 라운드1
  // Codex·Flash 공통 지적): 저장본과 앱의 persist version이 같으면 zustand는 migrate를
  // 아예 호출하지 않는다 — migrate 안의 delete는 구버전 업그레이드에만 돌고,
  // 이미 현재 버전이던 기존 기기의 잔존 키는 영원히 남는다. merge는 모든
  // 하이드레이션에서 돌므로 같은 버전이어도 확실히 걷어낸다.

  // ── v6 (v0.8.0) — "추세 검증" → "이상치 알람" 전환 ──────────────────────────
  // 의미가 정반대로 반전됐으므로(increase: 작아지면 알람 → 커지면 알람) 기존 저장값을
  // 그대로 두면 사용자 의도와 반대로 동작한다. 따라서 마이그레이션 시 안전하게 초기화한다.
  //  1) 제거된 전역 마스터 토글 trendAlertEnabled 삭제(이상치 알람은 컬럼별 규칙 유무로 활성).
  //  2) 컬럼별 trendRule을 off로 초기화(민구 확정: swap 아닌 클리어). v0.7.0 신기능이라
  //     운영 설정값이 거의 없고, 라벨(커짐→증가) 혼란을 방지한다.
  //  3) pctThreshold는 신규 필드 → 위 reconcileColumnFlags가 정규화(부적격/비유한수/≤0 제거).
  // idempotent: 이미 v6 이상이면 trendRule은 사용자가 새 의미로 설정한 값이므로 보존한다.
  // 다운그레이드 라운드트립 방어: v0.8.0(v6)에서 설정 → v5 번들로 열려 스토리지가 v5로
  // 재기록 → v0.8.0 재오픈 시 version<6이 다시 참이 되어 사용자가 v6에서 새로 지정한
  // trendRule을 또 지우는 문제가 있다. 1회성 마커(trendRuleClearedV6)로 "이미 클리어함"을
  // 기억해, 한 번 클리어된 뒤에는 재삭제하지 않는다.
  if (version < 6 && !s.trendRuleClearedV6) {
    delete s.trendAlertEnabled;
    // 조회 탭 범위(직전 조사/작기 전체) 모드 폐기 — 조회탭은 이제 최근 2회차 고정(WS4).
    delete s.reviewScope;
    if (Array.isArray(s.columns)) {
      s.columns = (s.columns as Column[]).map((c) => {
        const out = { ...c };
        delete out.trendRule; // 권고: off로 초기화
        // 대안(swap): delete 대신 의미 반전 변환을 쓰려면 아래로 교체.
        //   if (out.trendRule === 'increase') out.trendRule = 'decrease';
        //   else if (out.trendRule === 'decrease') out.trendRule = 'increase';
        return out;
      });
    }
    s.trendRuleClearedV6 = true;
  }

  // ── v7 (v0.12.0 AREA1) — 입력탭 출력 라우팅 토글(speakerOutput) 폐기 ───────────────
  // echoCancellation을 항상 ON으로 하드코딩하고 토글을 읽기전용 입력장치 CATEGORY 배지로
  // 교체했다(IOS-5 후속). 인터페이스에서 필드를 제거했으므로 영속값을 무조건 삭제한다
  // (다운그레이드 라운드트립 마커 불필요 — 필드 자체가 더는 존재하지 않음).
  if (version < 7) {
    delete s.speakerOutput;
  }

  // ── v8 (v0.13.0 R1) — 저장된 시트 목록(savedSheets) 도입 ───────────────────────────
  // 구버전 영속본엔 없으므로 안전 기본값 []로. 손상(배열 아님/항목 형태 불일치)도 []로 치유.
  if (
    !Array.isArray(s.savedSheets) ||
    !s.savedSheets.every(
      (x) =>
        x !== null &&
        typeof x === 'object' &&
        typeof (x as SavedSheet).name === 'string' &&
        typeof (x as SavedSheet).url === 'string' &&
        typeof (x as SavedSheet).sheetId === 'string' &&
        typeof (x as SavedSheet).addedAt === 'number',
    )
  ) {
    s.savedSheets = [];
  }

  // ── v9 (v0.15.0 A6) — 스피커폰(소프트 half-duplex) 모드 폐기 ───────────────────────────
  // speakerphoneMode 토글 + 그것으로 게이트되던 가드(TTS-중 명령차단·post-TTS 잔향 폐기·신뢰도
  // 상향)를 전부 삭제했다(민구 결정 + Trace: 회귀신호 0). 인터페이스에서 필드를 없앴으므로
  // 잔존 영속값을 무조건 삭제한다(다운그레이드 마커 불필요 — 필드 자체가 더는 존재하지 않음).
  if (version < 9) {
    delete s.speakerphoneMode;
  }

  // ── v10 (v0.19.0 W4) — "소음 환경 모드"(noisyMode) 폐기 ──────────────────────────────
  // 토글 UI(Vance)·라이브 참조(신뢰도 상향·단일문자 거부)·세션 meta 필드를 전부 삭제했다
  // (민구 결정: TTS 되읽기로 오인식 판독 가능 → 소음모드는 오히려 방해, 신뢰도 0.65 통일).
  // 인터페이스에서 필드를 없앴으므로 잔존 영속값을 무조건 삭제한다(다운그레이드 마커 불필요).
  if (version < 10) {
    delete s.noisyMode;
  }

  // ── v11 (v0.20.0) — 인식 허용범위(recognitionTolerance) 신설(기본 0.60) ──────────────
  // 구버전 영속본엔 필드가 없다. 위 무조건 coercion 블록(ttsRate 인접)이 누락/손상을 이미
  // 0.60으로 치유하므로 여기선 추가 작업이 필요 없다(version 게이트는 마이그레이션 기록용).
  // 신규 필드라 다운그레이드 라운드트립 마커는 불필요.

  // ── v0.22.0 — 자유입력 세션명(sessionCustomLabel) 신설(기본 null). persist version은
  //   올리지 않는다(불필요): zustand initializer 기본값(null) + 위 sessionAutoLabel 인접
  //   coercion이 누락/손상 영속본을 null로 치유하므로 version bump 없이 안전하다. (version을
  //   당시에는 persist version을 올리지 않았다.)

  // ── v12 (v0.38.0) — columns의 시트 출처 기록 ────────────────────────────────
  // **출처를 추측해 backfill하지 않는다.** v11 저장본에는 columns가 어느 시트에서 왔는지를
  // 입증할 정보가 없고, "현재 연결된 sheetUrl·sheetTab에서 왔을 것"이라는 추측은 오류 경로에서
  // 깨진다: sheetUrl·sheetTab은 loadHeaders **전에** 먼저 저장되므로(useSettingsSheetConnection),
  // 헤더 조회가 오프라인·권한 오류로 실패하면 "URL은 B농가, columns는 A농가" 불일치가 남는다.
  // 그 상태를 backfill하면 A농가의 fixed 자동값이 B시트 것으로 확정돼 **B 시트에 기록된다**
  // (리뷰#3 Critical). 잘못 보존하느니 새로 유추하는 쪽이 안전하다.
  //
  // 대가: 업그레이드 후 **첫 재연결 한 번은** 사용자 설정이 시트 표본 유추값으로 초기화된다.
  // 이는 v0.37.0까지의 동작이라 회귀가 아니며, 다음 연결부터는 출처가 기록돼 정상 보존된다.
  if (version < 12) {
    s.columnsSheetId = null;
    s.columnsSheetTab = null;
  }

  return s as SettingsState;
}
