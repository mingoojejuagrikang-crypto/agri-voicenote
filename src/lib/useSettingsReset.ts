/**
 * v0.49 R1 리팩토링 P1-2 — 설정탭 «전체 초기화·첫 진입 팁» 서브 훅 (useSettingsActions에서 순수 이동).
 * 초기화 확인 모달(v0.32.0 B3)·첫 진입 안내 배너(v0.23.0 설정탭#4)의 상태와 핸들러를 소유한다.
 * loading/error·요청 세대·loadHeaders는 시트 연결 서브 훅(useSettingsSheetConnection) 소유,
 * typeReview setter는 테이블 생성 서브 훅(useSettingsTableGeneration) 소유 — 둘 다 조립 훅
 * (useSettingsActions)이 배선해 준다. 로직·계측은 이동 전과 바이트 동일(SOP-003 파서 계약).
 */
import { useState } from 'react';
import { inputSettingsResetPatch, useSettingsStore } from '../stores/settingsStore';
import { saveSheetsRecord } from './db';
import { invalidatePastIndex } from './pastValues';
import { signOut as googleSignOut } from './googleAuth';
import { parseSpreadsheetId } from './sheets';
import { setPreferredVoiceName, setBargeInEnabled } from './speech';
import { logger } from './logger';
import type { SettingsActionsShared } from './useSettingsSheetConnection';
import type { TypeReviewState } from './useSettingsTableGeneration';

/** localStorage 키 — 첫 진입 안내를 본 적 있는지(스토리지 네임스페이스 agri-voicenote 준수).
 *  종전 components/settings/helpCopy.ts 소유였으나 유일 소비자가 이 훅이라 여기로 이동
 *  (v0.35.2 리뷰 r1 공통 지적 — lib→components 역참조 해소. v0.49 R1 P1-2에서
 *  useSettingsActions.ts → 이 서브 훅으로 재이동). */
// v0.50 개명 — 구 키는 namespaceBoot가 복사. namespaceMigrate.ts NEW_TIP_SEEN_KEY와 일치 계약.
const SETTINGS_TIP_SEEN_KEY = 'agri-voicenote-settings-tip-seen';

export function useSettingsReset(deps: {
  shared: SettingsActionsShared;
  setTypeReview: (v: TypeReviewState) => void;
}) {
  const { setLoading, setError, setConfirmedUrl, loadHeaders, beginSheetRequest, isCurrentSheetRequest } =
    deps.shared;
  const { setTypeReview } = deps;
  const s = useSettingsStore();
  // v0.32.0 설정탭 UX(Vance) B3 — 초기화 확인 모달(설정탭 전용; B2 요약 팝업 상태는 화면이 소유).
  const [resetOpen, setResetOpen] = useState(false);
  // v0.23.0 설정탭#4 — 첫 진입 안내 배너(1회 dismissible). "본 적 있는지"는 localStorage에 영속
  //   (UI 전용 상태라 persist 스키마 확장 불필요). 초기값은
  //   lazy로 읽어, 이미 본 적 있으면 처음부터 숨긴다. 테스트는 fresh context라 매번 뜨므로, 이 배너는
  //   fixed 오버레이가 아니라 스크롤 영역 내부 인라인 배너 → 기존 Playwright 클릭 흐름을 막지 않는다.
  const [tipDismissed, setTipDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(SETTINGS_TIP_SEEN_KEY) === '1'; } catch { return false; }
  });
  const dismissTip = () => {
    setTipDismissed(true);
    try { localStorage.setItem(SETTINGS_TIP_SEEN_KEY, '1'); } catch { /* private mode 등 */ }
  };

  /** v0.32.0 설정탭 UX(Vance) B3 — 전체 초기화. 컬럼·행수·세션명·다이얼·음성/검토 옵션·생성 상태를
   *  기본값(makeSettingsDefaults SSOT)으로 되돌린다. Google 로그인·시트 URL·저장된 시트는 기본
   *  **보존**(민구 확정) — 모달 체크박스로만 opt-in 삭제. 세션 데이터·클립·로그(IDB)는 건드리지 않는다. */
  const onResetConfirm = async ({ clearLogin, clearSheets }: { clearLogin: boolean; clearSheets: boolean }) => {
    // v0.44.0 §C8 F28 — 초기화 필드 목록은 settingsStore.inputSettingsResetPatch가 SSOT.
    // 날짜 변경 자동 초기화(onRehydrateStorage F28 블록)와 이 수동 경로가 같은 패치를 쓴다 —
    // 종전의 인라인 목록(컬럼+출처 동반 v0.38.0 리뷰#3 · beepVolume 복원 v0.35.0 FIX-5 등)을
    // 필드 단위 그대로 옮겼고, inputSettingsDate:null(초기화 직후 자동 발동 억제)만 추가됐다.
    s.set(inputSettingsResetPatch());
    setPreferredVoiceName(''); // 라이브 speech 모듈도 스토어 기본값과 동기화
    setBargeInEnabled(true);   // v0.44.0 §D1 — 초기화 = 기본 ON(말끊기 허용)도 라이브 동기화
    setTypeReview(null);
    if (clearLogin) {
      await googleSignOut('settings_reset'); // 토큰 없으면 no-op(clearToken만) — 로그아웃 상태에서도 안전
      s.set({ googleConnected: false, userEmail: null });
    }
    if (clearSheets) {
      s.set({ sheetUrl: '', sheet: null, sheetTab: '', availableSheets: [], savedSheets: [] });
      // 전용 IDB 레코드(onRehydrateStorage 복원 경로)도 함께 비운다 — 안 비우면 다음 부팅에서 되살아남.
      void saveSheetsRecord({ savedSheets: [], sheetUrl: '', updatedAt: Date.now() });
      // 진행 중인 조회까지 낡은 세대로 만든 뒤 메모리·IDB를 함께 비운다. 삭제 완료를 기다려야
      // 모달이 닫힌 직후 같은 시트를 재연결해 만든 새 스냅샷을 늦은 delete가 지우지 않는다.
      await invalidatePastIndex();
      setConfirmedUrl('');
    }
    // 첫 진입 안내 배너 재노출(초기화 = 처음부터 다시 시작하는 사용자).
    try { localStorage.removeItem(SETTINGS_TIP_SEEN_KEY); } catch { /* private mode 등 */ }
    setTipDismissed(false);
    logger.log({
      type: 'app',
      extra: `settings_reset:login=${clearLogin ? 'cleared' : 'kept'},sheet=${clearSheets ? 'cleared' : 'kept'}`,
    });
    setResetOpen(false);

    // v0.46.0 WP-J J-3 (민구 확정 08-05) — 초기화 직후 **연결된 시트에서 즉시 다시 받는다.**
    // 기본 컬럼 템플릿(MOCK_COLUMNS)의 '농가명'을 options로 바꾸는 원안 대신 이 형태를 택했다:
    // 그 템플릿은 감귤 시트 전용 목업이라 "하나의 시트를 기준으로 정하지 마라"(민구 08-05)와
    // 부딪힌다. 뒷단을 고치면 시트 불특정이면서 **모든 리스트 컬럼**이 그 시트 기준으로 재생성된다.
    // 종전엔 여기 loadHeaders가 없어 다음 수동 재연결까지 목업 상태로 남았다(§3-J 실측 ①).
    // best-effort — 오프라인·토큰 만료로 실패해도 초기화 자체는 이미 성립했다.
    const after = useSettingsStore.getState();
    const resetSheetId = clearSheets ? null : parseSpreadsheetId(after.sheetUrl);
    if (!resetSheetId || !after.sheetTab || !after.googleConnected) return;
    const requestSeq = beginSheetRequest();
    try {
      setLoading('시트에서 선택지 다시 받는 중...');
      const columns = await loadHeaders(resetSheetId, after.sheetTab, requestSeq);
      if (!columns || !isCurrentSheetRequest(requestSeq)) return;
      useSettingsStore.getState().set({
        columns,
        columnsSheetId: resetSheetId,
        columnsSheetTab: after.sheetTab,
        tableGenerated: false,
      });
      logger.log({ type: 'app', extra: `settings_reset_refetch:ok,cols=${columns.length}` });
    } catch (err) {
      logger.log({ type: 'app', extra: `settings_reset_refetch:failed,${(err as Error).message.slice(0, 60)}` });
    } finally {
      if (isCurrentSheetRequest(requestSeq)) setLoading(null);
    }
  };

  return {
    resetOpen, setResetOpen,
    tipDismissed, dismissTip,
    onResetConfirm,
  };
}
