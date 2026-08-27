/**
 * v0.49 R1 리팩토링 P1-2 — 설정탭 «시트 연결» 서브 훅 (useSettingsActions에서 순수 이동).
 * Google 인증(로그인·만료 강등·late-success 조정)·시트 URL draft/confirm·탭 전환·Drive Picker·
 * 저장된 시트 선택의 상태와 핸들러를 소유한다.
 *
 * loading/error·요청 세대(sheetRequestSeqRef)·loadHeaders는 설정탭 오케스트레이션의 공유 기반이라
 * 이 훅이 소유하고, 형제 서브 훅(테이블 생성 useSettingsTableGeneration · 초기화 useSettingsReset)은
 * 조립 훅(useSettingsActions)이 배선하는 `internal` 번들(SettingsActionsShared)로 접근한다.
 * 로직·계측(extra 문자열)은 이동 전과 바이트 동일(SOP-003 파서 계약).
 */
import { useEffect, useRef, useState } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import {
  prefetchPastIndex,
  resetPastIndexRetries,
  shouldPreparePastIndex,
} from './pastValues';
import type { Column } from '../types';
import {
  getAccessToken,
  getCurrentEmail,
  clearStoredToken,
  getStoredToken,
  isConfigured as isGoogleConfigured,
  onTokenSettled,
  signIn as googleSignIn,
  signOut as googleSignOut,
  warmupGoogleAuth,
} from './googleAuth';
import { clearConnection, getConnection, isConnectionAlive } from './googleConnection';
import {
  fetchHeaderAndSample,
  fetchSpreadsheetMeta,
  fetchColumnUniqueValues,
  inferColumns,
  parseSpreadsheetId,
} from './sheets';
import { mergeInferredColumnsForSheet } from './columnFlags';
import { enrichOptionColumns } from './optionExclusions';
import { getPickerApiKey, openDrivePicker } from './drivePicker';
import { logger } from './logger';

/** 형제 서브 훅이 쓰는 공유 기반 — 조립 훅(useSettingsActions)만 배선하고 화면에는 노출하지 않는다. */
export interface SettingsActionsShared {
  setLoading: (v: string | null) => void;
  setError: (v: string | null) => void;
  setConfirmedUrl: (v: string) => void;
  loadHeaders: (
    spreadsheetId: string,
    sheetTitle: string,
    requestSeq: number,
  ) => Promise<Column[] | null>;
  beginSheetRequest: () => number;
  isCurrentSheetRequest: (requestSeq: number) => boolean;
}

export function useSettingsSheetConnection() {
  const s = useSettingsStore();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmedUrl, setConfirmedUrl] = useState<string>(s.sheetUrl);
  // URL 입력값은 연결이 검증된 활성 sheetUrl과 분리한다. 메타/헤더 조회가 실패한 URL을 활성 대상으로
  // 먼저 영속하면 이전 columns와 새 URL이 섞이므로, 최신 요청 성공 때만 둘을 함께 게시한다.
  const [sheetUrlDraft, setSheetUrlDraft] = useState<string>(s.sheetUrl);
  const [showUrlInput, setShowUrlInput] = useState(false);
  // v0.14.0 F — 저장된 시트 목록을 기본 접힌 드롭다운으로(세로 풀리스트가 시트 多 시 화면 점유 과다).
  const [savedSheetsOpen, setSavedSheetsOpen] = useState(false);
  const googleConfigured = isGoogleConfigured();
  const pickerAvailable = s.googleConnected && !!getPickerApiKey();

  useEffect(() => {
    const t = getStoredToken();
    if (t && !s.googleConnected) {
      s.set({ googleConnected: true, userEmail: getCurrentEmail() });
    } else if (!t && s.googleConnected) {
      // ── v0.51 — **강등 분기의 의미가 바뀌었다**(계획서 §2-2 · 민구 08-27) ─────────────
      //
      // v0.13.0 R1의 원래 규칙은 「토큰 없음 = 연결 풀림」이었다. 토큰은 ~1시간이면 만료되는데
      // (refresh token 없음 [AUTH-4]) googleConnected는 persist라 true로 재하이드레이트돼,
      // UI는 '연결됨'인데 모든 시트 호출은 실패하는 거짓 표시가 났다([AUTH-7]). 그때는 강등이
      // **옳았다** — 거짓 「연결됨」보다 정직했다.
      //
      // 지금은 무팝업 갱신(`prompt:''`)이 실측되고(rauth §2-6) 제스처 지점에서 조용히 갱신하므로,
      // 정직한 대안이 「강등」 말고 「조용한 갱신」이다. 그래서 판정 축을 **토큰이 아니라 연결창**
      // 으로 옮긴다: 창이 살아 있으면 유지하고, 창이 만료됐을 때만 강등한다. 이것이 민구가 보던
      // 「매시간 로그인 풀림」을 「4주 미사용 시에만 풀림」으로 바꾸는 한 지점이다.
      //
      // 🔴 **check-then-touch**: 여기서 창 유효를 **먼저** 판정한다. 부팅 touch(App.tsx)는
      //    이미 지나갔지만 touchConnection이 죽은 창을 되살리길 거부하므로 29일차 진입은
      //    정확히 만료로 떨어진다(googleConnection.ts 계약).
      // ⚠️ 계측: 종전 `auth_signout:token_expired`는 **은퇴**한다 — 그 조건(토큰 만료)이 더는
      //    강등 사유가 아니기 때문이다. 대신 유지는 `auth_token_expired_kept`(강등 아님),
      //    진짜 만료는 `auth_signout:connection_expired`로 갈린다(SOP-003 매핑표 갱신 대상).
      if (isConnectionAlive()) {
        logger.log({ type: 'app', extra: 'auth_token_expired_kept' });
      } else {
        // v0.51 r1 [F-8 / 리뷰 L-2] — **사유를 가른다.** 「4주 미사용으로 창이 닫혔다」와
        // 「창을 가진 적이 없다」(v13 승계를 못 받은 기기·신규 시딩)는 원인이 전혀 다른데
        // 종전엔 한 문자열로 뭉쳐 SOP-003 판독에서 분리가 불가능했다.
        const hadRecord = !!getConnection();
        logger.log({ type: 'app', extra: `auth_signout:connection_expired${hadRecord ? '' : ':no_record'}` });
        // 🔴 revoke하지 않는다 — 로컬 정리만(googleConnection.ts §계약). revoke하면 grant가 죽어
        //    이후 무팝업 갱신까지 전부 동의 화면으로 되돌아간다. signOut()을 경유하면 안 된다.
        clearStoredToken(); // [F-9] 5분 마진 탓에 남아 있을 수 있는 원시 토큰 레코드도 정리(revoke 아님)
        clearConnection('connection_expired');
        s.set({ googleConnected: false });
      }
    }
    // S-1: preload GIS + token client so the first 로그인 click opens the popup in one shot
    // (avoids the "popup_failed_to_open" that required a second click).
    void warmupGoogleAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v0.29.0 (Mack, 2026-07-07 A5 finding #1) — late-success reconciliation. signIn()'s own
  // SIGNIN_TIMEOUT_MS can fire and reject BEFORE a slow real-world 2FA flow (~60s+ observed)
  // actually completes; the onGoogleClick catch block below then shows "로그인 응답이 지연되어
  // 취소되었습니다" even though the GIS callback lands moments later with a genuine token
  // (storeToken already ran — localStorage has it). Without this subscription the UI stayed
  // wrong ("로그인 실패") until the user remounted the tab (reload / tab-away-and-back), because
  // googleConnected only re-synced from getStoredToken() at mount. Subscribing here closes that
  // gap reactively — no remount needed — using the already-existing onTokenSettled broadcast
  // (googleAuth.ts now fires it for late arrivals too, decoupled from the timed-out promise).
  useEffect(() => {
    const unsubscribe = onTokenSettled(({ email }) => {
      setError(null);
      useSettingsStore.getState().set({ googleConnected: true, userEmail: email });
    });
    return unsubscribe;
  }, []);

  const onGoogleClick = async () => {
    setError(null);
    if (s.googleConnected) {
      await googleSignOut();
      s.set({ googleConnected: false, userEmail: null });
      return;
    }
    if (!googleConfigured) {
      setError('.env.local의 VITE_GOOGLE_CLIENT_ID를 설정해주세요');
      return;
    }
    try {
      setLoading('Google 로그인 중...');
      const { email } = await googleSignIn();
      s.set({ googleConnected: true, userEmail: email });
      // v0.13.0 R1 — 재로그인 직후, 직전에 쓰던 시트(sheetUrl)가 있으면 자동 재연결한다(사용자가
      // 매번 Drive에서 공유링크를 다시 붙여넣지 않도록). 토큰이 막 갱신됐으므로 authFetch가 성공한다.
      const prevUrl = useSettingsStore.getState().sheetUrl.trim();
      if (prevUrl) await onUrlConfirmWithUrl(prevUrl);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(null);
    }
  };

  /** URL 입력은 상태만 갱신, 적용은 confirm 버튼에서 */
  const onUrlTyping = (url: string) => {
    setSheetUrlDraft(url);
    ++sheetRequestSeqRef.current;
    s.set({ tableGenerated: false });
    setLoading(null);
    setError(null);
  };

  /** "확인" 버튼: 현재 URL로 시트 정보 조회 시도 */
  const onUrlConfirm = async () => {
    setError(null);
    const url = sheetUrlDraft.trim();
    if (!url) { setError('URL을 입력하세요.'); return; }
    if (!s.googleConnected) { setError('먼저 Google 로그인 후 다시 확인하세요.'); return; }
    await onUrlConfirmWithUrl(url);
  };

  const onSheetTabChange = async (newTab: string) => {
    const requestSeq = beginSheetRequest();
    const current = useSettingsStore.getState();
    const id = parseSpreadsheetId(current.sheetUrl);
    if (!id) {
      if (isCurrentSheetRequest(requestSeq)) setError('시트 연결을 다시 확인해 주세요.');
      return;
    }
    try {
      setLoading('컬럼 분석 중...');
      const columns = await loadHeaders(id, newTab, requestSeq);
      if (!columns || !isCurrentSheetRequest(requestSeq)) return;
      useSettingsStore.getState().set({
        sheetUrl: current.sheetUrl,
        sheetTab: newTab,
        columns,
        columnsSheetId: id,
        columnsSheetTab: newTab,
        tableGenerated: false,
      });
      if (shouldPreparePastIndex()) {
        resetPastIndexRetries();
        prefetchPastIndex();
      }
    } catch (err) {
      if (isCurrentSheetRequest(requestSeq)) setError((err as Error).message);
    } finally {
      if (isCurrentSheetRequest(requestSeq)) setLoading(null);
    }
  };

  // 대상 전환의 메타→헤더 전체 요청 세대. 메타가 늦게 끝난 이전 요청도 최신 sheetTab/columns를
  // 덮지 못해야 하므로 헤더 단계만이 아니라 연결 파이프라인의 시작점에서 발급한다.
  const sheetRequestSeqRef = useRef(0);
  const isCurrentSheetRequest = (requestSeq: number) => requestSeq === sheetRequestSeqRef.current;
  const beginSheetRequest = () => {
    const requestSeq = ++sheetRequestSeqRef.current;
    useSettingsStore.getState().set({ tableGenerated: false });
    setError(null);
    return requestSeq;
  };

  const loadHeaders = async (
    spreadsheetId: string,
    sheetTitle: string,
    requestSeq: number,
  ): Promise<Column[] | null> => {
      const { headers, sample } = await fetchHeaderAndSample(spreadsheetId, sheetTitle);
      if (!isCurrentSheetRequest(requestSeq)) return null;
      // v0.38.0 — 사용자 설정과 기존 id는 정확히 같은 스프레드시트·탭의 재연결에서만 보존한다.
      // 다른 농가 시트가 같은 헤더를 써도 id가 같아지는 탓에 이전 fixed 자동값이 새 시트에
      // 복사되던 침묵 오염을 차단한다. 출처는 sheetUrl/sheetTab보다 늦게 바뀌는 columns와 함께
      // 저장하므로, 호출부가 대상 시트 상태를 먼저 써도 비교 기준이 흔들리지 않는다.
      const current = useSettingsStore.getState();
      const freshlyInferred = inferColumns(headers, sample);
      const inferred = mergeInferredColumnsForSheet(
        freshlyInferred,
        current.columns,
        { spreadsheetId: current.columnsSheetId, sheetTab: current.columnsSheetTab },
        { spreadsheetId, sheetTab: sheetTitle },
      );
      // v0.46.0 WP-J J-5 — 출처 시트가 바뀌면 제외 목록을 **버린다**. colId는 stableColumnId가
      // 컬럼 **이름**에서 만든 해시라 다른 시트라도 이름이 같으면 같은 id다 — 안 버리면 감귤
      // 시트에서 지운 값이 품질조사 시트의 동명 컬럼에 새어 붙는다. (초기화 직후에도
      // columnsSheetId가 null이라 여기 걸린다 = R11 "초기화는 제외 목록도 비운다".)
      const sheetChanged =
        current.columnsSheetId !== spreadsheetId || current.columnsSheetTab !== sheetTitle;
      if (sheetChanged && Object.keys(current.optionExclusions).length > 0) {
        useSettingsStore.getState().set({ optionExclusions: {} });
      }
      const exclusions = sheetChanged ? {} : current.optionExclusions;

      // 'options' 컬럼의 선택지를 시트 열 전체의 고유값으로 보강하고 제외 목록을 적용한다(J-1·J-5).
      const enriched = await enrichOptionColumns(inferred, exclusions, (i) =>
        fetchColumnUniqueValues(spreadsheetId, sheetTitle, i));
      return enriched.length && isCurrentSheetRequest(requestSeq) ? enriched : null;
  };

  const onPickerClick = async () => {
    setError(null);
    const token = getAccessToken();
    if (!token) {
      setError('먼저 Google 로그인 후 Drive에서 선택하세요.');
      return;
    }
    try {
      setLoading('Drive 파일 선택 중...');
      const result = await openDrivePicker(token);
      if (result) {
        setSheetUrlDraft(result.url);
        setConfirmedUrl('');
        setError(null);
        await onUrlConfirmWithUrl(result.url);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(null);
    }
  };

  /** v0.13.0 R1 — 저장 목록에서 시트를 선택하면 활성 시트로 전환(URL 세팅 후 메타 재조회). 토큰이
   *  만료됐으면 onUrlConfirmWithUrl 내부 authFetch가 실패하므로, 그 경우 재로그인을 안내한다. */
  const onSelectSavedSheet = async (entry: { url: string }) => {
    setError(null);
    if (!s.googleConnected || !getAccessToken()) {
      // 연결이 풀린(토큰 만료) 상태 — URL만 세팅해 두고 재로그인을 유도한다(재로그인 후 자동 재연결).
      // availableSheets/sheetTab도 함께 비워, 저장목록의 'active 배지'(새 시트)와 아래 탭 셀렉터(직전
      // 시트의 탭 목록)가 어긋나지 않게 한다 — onUrlConfirmWithUrl의 선(先)리셋과 동일 처리.
      ++sheetRequestSeqRef.current;
      setSheetUrlDraft(entry.url);
      s.set({ sheetUrl: entry.url, availableSheets: [], sheetTab: '', tableGenerated: false });
      setConfirmedUrl('');
      setError('연결이 만료되었습니다. Google 로그인을 다시 하면 이 시트로 자동 연결됩니다.');
      return;
    }
    setSheetUrlDraft(entry.url);
    setConfirmedUrl('');
    await onUrlConfirmWithUrl(entry.url);
  };

  const onUrlConfirmWithUrl = async (url: string) => {
    const requestSeq = beginSheetRequest();
    const id = parseSpreadsheetId(url);
    if (!id) {
      if (isCurrentSheetRequest(requestSeq)) setError('스프레드시트 URL 형식이 올바르지 않습니다.');
      return;
    }
    try {
      setLoading('시트 정보 조회 중...');
      const meta = await fetchSpreadsheetMeta(id);
      if (!isCurrentSheetRequest(requestSeq)) return;
      const tabs = meta.sheets.map((sh) => sh.title);
      const sheetTab = tabs[0] || '';
      if (!sheetTab) throw new Error('사용할 수 있는 시트 탭이 없습니다.');
      setLoading('컬럼 분석 중...');
      const columns = await loadHeaders(id, sheetTab, requestSeq);
      if (!columns || !isCurrentSheetRequest(requestSeq)) return;
      useSettingsStore.getState().set({
        sheetUrl: url,
        availableSheets: tabs,
        sheetTab,
        columns,
        columnsSheetId: id,
        columnsSheetTab: sheetTab,
        tableGenerated: false,
      });
      setSheetUrlDraft(url);
      setConfirmedUrl(url);
      // v0.13.0 R1 — 연결에 성공한 시트를 '파일명'(meta.title)으로 저장 목록에 자동 등록한다(민구
      // 요청). sheetId 기준 dedupe(saveSheet) — 같은 시트 재연결 시 최근 사용으로 갱신만 된다.
      s.saveSheet({ name: meta.title || url, url, sheetId: id, addedAt: Date.now() });
      // v0.34.0 C9(b) — 시트 연결 확정 직후 프리페치. 이 함수는 Drive Picker 선택·저장목록 선택·
      // URL 확인·재로그인 자동 재연결의 공통 종점이라 여기 1곳 배선으로 전부 커버된다(단일 배선).
      // 컬럼은 위 loadHeaders가 방금 교체했을 수 있으므로 getState()로 최신을 읽는다.
      if (shouldPreparePastIndex({ requireAuth: true })) { resetPastIndexRetries(); prefetchPastIndex(); }
    } catch (err) {
      if (isCurrentSheetRequest(requestSeq)) setError((err as Error).message);
    } finally {
      if (isCurrentSheetRequest(requestSeq)) setLoading(null);
    }
  };

  return {
    // 조립 훅(useSettingsActions)이 화면에 그대로 반환하는 공개 멤버
    loading, error,
    confirmedUrl, sheetUrlDraft,
    showUrlInput, setShowUrlInput,
    savedSheetsOpen, setSavedSheetsOpen,
    pickerAvailable,
    onGoogleClick, onUrlTyping, onUrlConfirm, onSheetTabChange,
    onPickerClick, onSelectSavedSheet,
    // 형제 서브 훅 전용 공유 기반 — 화면에는 노출하지 않는다(조립 훅만 배선).
    internal: {
      setLoading, setError, setConfirmedUrl,
      loadHeaders, beginSheetRequest, isCurrentSheetRequest,
    } satisfies SettingsActionsShared,
  };
}
