/**
 * v0.35.2 Stage 2 — 데이터탭 액션 오케스트레이션 훅 (DataScreen에서 순수 이동, GL-006 §7~8 UI/로직 분리).
 * 시트 동기화·Drive 로그 백업·삭제·재로그인 resume의 상태와 핸들러를 소유한다.
 * 화면(DataScreen)은 표현만 담당하고 이 훅의 반환값을 배선한다. 로직·계측(extra 문자열)은 이동 전과
 * 바이트 동일(SOP-003 파서 계약).
 *
 * v0.49 R1 리팩토링 P2 — [ENV-12] #0 해소(531줄 → 500 미만). 기재된 분리 계획 그대로
 * export 절(useExportActions)·recover 절(useRecoverActions)을 서브 훅으로 옮기고 이 훅이 조립한다
 * (반환 형태 불변 — DataScreen 수정 0). busy/msg·loginPrompt는 동기화 절과 공유라 여기 남는다.
 */
import { useCallback, useRef, useState } from 'react';
import { useDataStore } from '../stores/dataStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSessionStore, isSessionLive } from '../stores/sessionStore';
import { syncSelected, type SyncReport } from './sync';
import { deleteSession as dbDeleteSession, saveSession } from './db';
import type { Session } from '../types';
import { exportLogZipsPerSession } from './exportLog';
import { uploadLogToBothDrives } from './driveUpload';
import { withAuthRetry, isAuthError, sanitizeUploadError } from './uploadAuthRetry';
import { signIn, getStoredToken } from './googleAuth';
// 세션 활성 인증 가드(r2)는 응집 단위로 분리했다 — 계약·근거는 그 파일이 갖는다(r4).
import { ensureAuthUnlessSessionLive } from './syncAuthGuard';
// v0.51 r4 — 갱신 **정책층**은 별도 모듈이다(경계: 정책 / flight 기계). 재수출로 감추면
// F-20 allowlist가 호출부 집합을 못 본다 — 그래서 여기서 직접 가리킨다.
import { ensureAccessToken } from './googleAuthRefresh';
import { useExportActions } from './useExportActions';
import { useRecoverActions } from './useRecoverActions';
import { logger } from './logger';
import { rawUploadedRecordFailed } from './logEvents';
import { markRawUploaded } from './rawRetention';
import { clipPlayer } from './clipPlayer';
import { sessionTargetFromSettings } from './sheetConnection';
import {
  ACTIVE_SESSION_SYNC_MESSAGE,
  isSessionSyncBlocked,
  type LegacyTargetDecision,
} from './sessionSync';
import { applyLegacyTarget } from './legacyTargetApply';
import {
  advanceLegacySyncPrompt,
  buildLegacySyncPrompt,
  type LegacySyncPrompt,
} from './legacySyncFlow';

// 내보내기 결과 타입 — 소비처(ExportDoneModal)의 import 경로 호환(정의는 useExportActions.ts).
export type { ExportResult } from './useExportActions';

/** v0.44.0 §C8 F23 — 시트 동기화 상태 대형 팝업(SyncStatusModal)의 상태.
 *  uploading = 업로드 중(자동 표시) · failed = 사유 + [재시도]/[나중에] · null = 팝업 없음(성공 포함).
 *  타입은 lib이 소유하고 컴포넌트가 import한다(lib→components 역참조 금지 — v0.35.2 r1 규율). */
export type SyncStatus =
  | { phase: 'uploading' }
  | { phase: 'failed'; reason: string };

/** v0.6.0 — human label for a sync result that may both append and update rows in place.
 *  "N행 추가", "M행 갱신", or "N행 추가, M행 갱신" depending on what happened. */
function syncCountLabel(report: SyncReport): string {
  const parts: string[] = [];
  if (report.rows > 0) parts.push(`${report.rows}행 추가`);
  if (report.updatedRows > 0) parts.push(`${report.updatedRows}행 갱신`);
  if (parts.length === 0) parts.push('변경 없음');
  let label = parts.join(', ');
  if (report.fallbackAppended > 0) label += ` (${report.fallbackAppended}행 재추가)`;
  return label;
}

export function useDataActions() {
  const updateRowValue = useDataStore((s) => s.updateRowValue);
  const removeSession = useDataStore((s) => s.removeSession);

  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null);
  const [failureReport, setFailureReport] = useState<SyncReport | null>(null);
  // v0.44.0 §C8 F23 — 동기화 상태 대형 팝업(업로드 중/실패). 성공은 null(자동 닫힘).
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  // F23 — 세션별 실패 상세(FailureModal)는 이제 자동 마운트가 아니라 배너 '자세히'로만 연다.
  const [failureDetailOpen, setFailureDetailOpen] = useState(false);
  const [legacySyncPrompt, setLegacySyncPrompt] = useState<LegacySyncPrompt | null>(null);

  // v0.20.0 Phase 2 — 범용 "로그인 필요" 팝업 상태. 토큰 만료/미로그인이 감지되는 모든 지점(시트
  // 동기화·Drive 백업·세션 복구)에서 reason 문구와 함께 마운트한다. `resume`은 재로그인 성공 직후
  // 다시 실행할 직전 동작 클로저 — 사용자가 하던 일을 잃지 않고 이어가게 한다(graceful resume).
  const [loginPrompt, setLoginPrompt] = useState<{ reason: string; resume: () => void } | null>(null);

  // v0.49 R1 P2 — 내보내기·복구 절은 서브 훅으로 분리([ENV-12] #0 계획). busy/msg·loginPrompt는
  // 동기화 절과 공유 상태라 이 훅이 소유하고 setter만 배선한다.
  const exportActions = useExportActions({ setBusy, setMsg });
  const recoverActions = useRecoverActions({ setBusy, setMsg, setLoginPrompt });

  const lastSelectedIdsRef = useRef<string[]>([]);
  const excludeInProgress = (ids: string[]) => {
    const voice = useSessionStore.getState();
    return ids.filter((id) => !isSessionSyncBlocked(id, voice.sessionId, voice.phase));
  };

  // v0.20.0 Phase 2 — 재로그인 핸들러. signIn()은 GIS 팝업을 클릭 제스처 안에서 동기적으로 열어야
  // 하므로(googleAuth S-1) 반드시 모달의 onLogin 클릭에서 직접 호출된다. 재로그인 성공 시:
  //  ① 시트 연결이 풀렸으면(순수 토큰 만료가 아닌 강한 evict 케이스) savedSheets 최상단으로 재연결
  //     ([STORE-1] 설계 의도 — 순수 토큰 만료에선 sheetUrl/sheetTab이 살아 있어 이 분기는 no-op),
  //  ② 팝업을 닫고 ③ 직전 동작(resume)을 이어서 실행한다.
  const handleLoginPromptLogin = useCallback(() => {
    const prompt = loginPrompt;
    logger.log({ type: 'app', extra: 'login_prompt_login_clicked' });
    void signIn()
      .then(() => {
        // graceful resume: 순수 토큰 만료에선 sheetUrl이 살아 있어 재연결 불필요. 강한 evict로 연결이
        // 풀렸고 저장 시트가 있으면 최근 사용 시트로 1-탭 재연결한다(설계 의도, [STORE-1] 연계).
        const st = useSettingsStore.getState();
        if (!st.sheetUrl?.trim() && st.savedSheets.length > 0) {
          const top = st.savedSheets[0];
          st.set({ sheetUrl: top.url });
          logger.log({ type: 'app', extra: 'login_prompt_sheet_reconnected', parsed: top.sheetId });
        }
        setLoginPrompt(null);
        prompt?.resume(); // 중단 없이 직전 동작 재개
      })
      .catch((e) => {
        // 재로그인 실패(취소/팝업 차단 등) — 팝업은 닫고 사유를 배너로 남긴다(조용한 실패 금지).
        setLoginPrompt(null);
        setMsg('로그인 실패: ' + ((e as Error)?.message ?? '다시 시도해 주세요.'));
      });
  }, [loginPrompt]);

  const handleCellSave = async (sessionId: string, rowIndex: number, colId: string, value: string) => {
    // v0.33.0 B-8 — 데이터탭 셀 수동 편집 계측(음성탭 touch_commit :2256과 대칭 — 이전엔 무로깅이라
    // 오터치/수동 정정을 로그로 재구성할 수 없었다). 편집 대상 세션 id를 명시(현재 음성 세션 아님).
    logger.log({ type: 'command', parsed: 'data_edit', extra: 'touch', text: value, sessionId, row: rowIndex, colId });
    updateRowValue(sessionId, rowIndex, colId, value);
    const updated = useDataStore.getState().sessions.find((x) => x.id === sessionId);
    if (updated) {
      try { await saveSession(updated); } catch { /* ignore */ }
    }
  };

  const runSyncInner = async (ids: string[]): Promise<{ report: SyncReport; backupOk: boolean } | null> => {
    if (ids.length === 0) return null;
    const syncIds = excludeInProgress(ids);
    const excludedCount = ids.length - syncIds.length;
    if (syncIds.length === 0) {
      setMsg(ACTIVE_SESSION_SYNC_MESSAGE);
      return null;
    }
    lastSelectedIdsRef.current = syncIds;
    setBusy('시트에 추가 중...');
    setMsg(null);
    // F23 — 새 업로드 시작: 대형 팝업을 업로드 중으로, 직전 실패 상세/보고는 접는다.
    setSyncStatus({ phase: 'uploading' });
    setFailureDetailOpen(false);
    setFailureReport(null);
    let backupOk = false;
    try {
      const report = await syncSelected(syncIds);
      // 1) 시트 추가 결과 메시지
      if (report.message) {
        setMsg(report.message);
      } else if (report.failed > 0) {
        setMsg(`${report.ok}개 세션 성공, ${report.failed}개 실패 (${syncCountLabel(report)})`);
        setFailureReport(report);
      } else if (report.ok > 0) {
        setMsg(`✓ ${syncCountLabel(report)}`);
      } else {
        setMsg('추가할 새 데이터가 없습니다.');
      }
      // [SYNC-3] — 로컬 컬럼이 시트 헤더에 없어 일부 값이 비워진 세션이 있으면, 성공/실패 메시지와
      // 별개로 반드시 표면화한다(침묵 오정렬 방지 — report.message가 이미 다른 문구를 쓴 경우에도
      // 덧붙인다). 위 4가지 분기 중 어떤 것이 실행됐든 이 경고는 추가된다.
      if (report.columnWarnings.length > 0) {
        setMsg((prev) => `${prev ? `${prev} ` : ''}⚠ ${report.columnWarnings.join(' / ')}`);
      }
      if (excludedCount > 0) {
        setMsg((prev) => `${prev ? `${prev} · ` : ''}${ACTIVE_SESSION_SYNC_MESSAGE}`);
      }

      // 2) 로그 백업: 사용자 본인 드라이브 + 관리자 폴더 양쪽 업로드 (v0.10 멀티유저).
      // v0.10.1 Codex HIGH 수정: 관리자 폴더 설정 시 admin 업로드도 성공해야 backupOk → autoDelete 차단.
      // v0.23.0 데이터탭#1 — 로그 백업을 '새 행이 추가된 세션'(successIds)이 아니라 **선택한 모든
      // 세션(행 보유)**으로 확장한다. 이미 동기화돼 새 행이 0인 세션을 함께 선택해도 그 로그가 누락되지
      // 않게 한다(민구 제보: "일부만 업로드"). autoDelete는 아래에서 여전히 successIds로만 게이트한다.
      const allSessionsForBackup = useDataStore.getState().sessions;
      const hasRows = (id: string) =>
        (allSessionsForBackup.find((s) => s.id === id)?.rows.length ?? 0) > 0;
      const uploadIds = excludeInProgress(syncIds).filter(hasRows);
      if (uploadIds.length > 0) {
        try {
          // v0.50 [UPLOAD-AUTH-1] — **업로드를 시작하기 전에 토큰부터 확보한다.**
          // 2026-08-19: 이 한 줄이 없어 5회 중 4회가 첫 시도에 401/403으로 죽었고, 사용자가
          // 로그인 버튼을 눌러야 재시도가 붙었다. 클릭이 없던 세션 하나는 로그가 통째로 남지
          // 않았다. 실패해도 진행한다 — 종전 실패 경로(재로그인 배너)가 그대로 받는다.
          await ensureAuthUnlessSessionLive();
          // [UA-1] 위 주석 참조 — 작업 단위 1회 강제 갱신 게이트.
          let forceRefreshDone = false;
          const forceRefreshOnce = async (o?: { force?: boolean }): Promise<boolean> => {
            if (o?.force && forceRefreshDone) {
              logger.log({ type: 'app', extra: 'auth_ensure:skipped:already_forced' });
              return false;
            }
            if (o?.force) forceRefreshDone = true;
            return ensureAuthUnlessSessionLive(o);
          };
          // v0.19.0 W6 — 세션별 개별 zip 업로드. v0.23.0 데이터탭#1 — 대상 = 선택한 모든 세션(행 보유).
          // 파일명은 수확 prefix `growth-log_<date>` + 세션 식별자(rclone/SOP-003·복구 파싱 호환).
          const zips = await exportLogZipsPerSession(uploadIds);
          const anyUser = new Set<string>();   // 업로드 성공한 목적지 라벨 집계(메시지용)
          const anyAdmin = new Set<string>();
          const failedDests = new Set<string>();
          const backedUpOk = new Set<string>(); // 세션별 백업 성공 집계(autoDelete 불변식 + N/N 메시지)
          // v0.20.0 Phase 2 — Drive 백업 실패가 토큰 만료(401/403)면 시트추가와 독립으로 로그인
          // 팝업을 띄울 수 있게 신호를 모은다(시트추가는 성공해도 백업만 만료될 수 있다).
          let backupNeedsLogin = false;
          // v0.50 [UPLOAD-AUTH-1] — 판정은 driveUpload가 소유한다(재시도 결정과 같은 기준).
          const isAuth = isAuthError;
          // 데이터 유실 방지 불변식(v0.23.0): 로그는 선택한 모든 세션을 올리되, autoDelete 대상은
          // successIds(시트에 새로 반영된 세션)로만 한정한다. 그 successIds가 **모두** 완전 백업(본인
          // Drive 필수 + 관리자 설정 시 admin도 필수)됐을 때만 backupOk=true → 부분 성공으로는 삭제 안 함.
          for (const z of zips) {
            try {
              // v0.50 [UPLOAD-AUTH-1] — 인증 실패 1회 자동 재시도(계약·근거는 uploadAuthRetry).
              const dual = await withAuthRetry({
                upload: (keep) => uploadLogToBothDrives(z.blob, z.filename, keep),
                // 🔴 v0.50 r2 [UA-1] — **강제 갱신은 이 업로드 작업 전체에서 1회뿐이다.**
                //   `ensureAccessToken({force})`는 저장 토큰 단축이 없어 zip마다 `signIn()`을 다시
                //   부른다. 콜백 wedge면 `SIGNIN_TIMEOUT_MS`(120초)를 그대로 기다리므로 세션 N개면
                //   최악 N×120초 동안 동기화가 멈춘다 — 「진행을 막지 않는다」와 정면 충돌이다.
                ensureAuth: forceRefreshOnce,
                onRetry: () => logger.log({ type: 'app', extra: 'drive_upload_retry:auth', parsed: z.sessionId }),
              });
              // v0.50 [UPLOAD-AUTH-1] — **실패 사유를 남긴다.** 종전엔 `drive_upload:partial:fail=`에
              // 레그 이름만 남아(`e.split(':')[0]`) 「왜 죽었는지」를 로그로 알 수 없었다 —
              // 그래서 이번 조사도 인증 이벤트와의 시간 대조로만 근인을 잡았다.
              // 🔴 기존 `drive_upload:*` 문자열은 **바이트 그대로 둔다**(PRINCIPLES §4) — 신규 이벤트다.
              for (const e of dual.errors) {
                logger.log({ type: 'app', extra: `drive_upload_error:${sanitizeUploadError(e)}`, parsed: z.sessionId });
              }
              const sessionOk = !!dual.userDriveId && (!dual.adminConfigured || !!dual.adminDriveId);
              if (sessionOk) backedUpOk.add(z.sessionId);
              if (dual.userDriveId) anyUser.add('본인 Drive');
              if (dual.adminDriveId) anyAdmin.add('관리자 Drive');
              for (const e of dual.errors) {
                failedDests.add(e.split(':')[0]);
                if (isAuth(e)) backupNeedsLogin = true;
              }
              // 세션별 업로드 결과 계측 — 어느 세션 zip이 어느 목적지에서 실패했는지 정량 확인.
              logger.log({
                type: 'app',
                // v0.25.0 데이터탭 F2(Vance) — '일부 실패' 라벨 오해 소지 제거: 실패 레그(fail=)와
                // 성공 레그(ok=)를 분리 표기(빈 레그는 '-'). 접두 'drive_upload:partial:'는 유지(그렙 호환).
                extra: dual.errors.length === 0
                  ? 'drive_upload:ok'
                  : `drive_upload:partial:fail=${dual.errors.map((e) => e.split(':')[0]).join(',') || '-'}:ok=${
                      [dual.userDriveId ? '본인 Drive' : null, dual.adminDriveId ? '관리자 Drive' : null]
                        .filter(Boolean).join(',') || '-'
                    }`,
                text: z.filename,
                parsed: z.sessionId,
              });
            } catch (err) {
              failedDests.add('exception');
              const emsg = String((err as Error)?.message ?? err);
              if (isAuth(emsg)) backupNeedsLogin = true;
              // v0.50 r2 [UA-3] — 같은 함수의 자매 지점도 마스킹을 탄다. 「이 함수의 에러 문자열은
              //   마스킹된다」는 계약이 반쪽이면 다음 사람이 그 계약을 믿는다.
              logger.log({ type: 'app', extra: `drive_upload:failed:${z.sessionId}:${sanitizeUploadError(emsg)}` });
              console.warn('Drive 로그 업로드 실패(세션)', z.sessionId, err);
            }
          }
          // v0.54.0 G1 — 백업 성공 세션 ID들을 kv __raw_uploaded__ 에 기록
          try {
            await markRawUploaded([...backedUpOk]);
          } catch (e) {
            logger.log({
              type: 'error',
              sessionId: '__app__',
              extra: rawUploadedRecordFailed(String((e as Error)?.message ?? e)),
            });
          }
          // autoDelete 불변식: 삭제 대상(successIds)이 모두 백업됐을 때만 backupOk.
          backupOk = report.successIds.every((id) => backedUpOk.has(id));
          // 백업이 토큰 만료로 실패했으면 report에 needsLogin을 전파(시트추가 성공/실패와 독립).
          if (backupNeedsLogin) report.needsLogin = true;
          const dest = [...anyUser, ...anyAdmin];
          const okN = backedUpOk.size;
          const totalN = zips.length;
          // N/N 세션 로그 백업(+성공 목적지). '일부만 업로드' 재발 시 즉시 가시화(민구 데이터탭#1).
          setMsg((m) => {
            const base = `로그 ${okN}/${totalN} 세션 백업${dest.length ? ` (${dest.join('+')})` : ''}`;
            return m ? `${m} · ${base}` : `✓ ${base}`;
          });
          if (okN < totalN) {
            const failedIds = zips.filter((z) => !backedUpOk.has(z.sessionId)).map((z) => z.sessionId);
            setMsg((m) => `${m ?? ''} · ⚠️ ${totalN - okN}개 세션 로그 백업 실패`);
            console.warn('Drive 로그 백업 실패 세션', failedIds, [...failedDests]);
          }
        } catch (err) {
          // v0.50 r2 [UA-3] — 위와 같은 이유로 마스킹.
          logger.log({ type: 'app', extra: `drive_upload:failed:${sanitizeUploadError(String((err as Error)?.message ?? err))}` });
          setMsg((m) => (m ? `${m} · ⚠️ 로그 백업 실패` : '⚠️ 시트 추가 OK, 로그 백업 실패'));
          console.warn('Drive 로그 업로드 실패', err);
        }
      } else {
        // 선택 세션 중 행 보유 세션이 없음 → 백업 대상 없음, backupOk false → autoDelete 차단
      }
      // F23 — 대형 팝업 종료 판정. 시트 추가에 실패한 세션이 있으면 사유와 함께 실패 화면으로,
      // 그 외(성공·변경 없음)는 자동 닫힘. needsLogin은 LoginRequiredModal(z=120)이 "다음 행동"을
      // 전담하므로 실패 팝업을 겹쳐 띄우지 않는다(모달 스택 방지 — 재로그인 resume이 곧 재시도다).
      if (!report.needsLogin && report.failed > 0) {
        const first = report.failures[0]?.reason ?? '알 수 없는 오류';
        setSyncStatus({
          phase: 'failed',
          reason: report.failed === 1 ? first : `${report.failed}개 세션 실패 — ${first}`,
        });
      } else {
        setSyncStatus(null);
      }
      return { report, backupOk };
    } catch (err) {
      // 예외 경로(네트워크 단절 등)도 조용히 지나가지 않는다 — 사유 + 재시도/나중에.
      setSyncStatus({ phase: 'failed', reason: (err as Error).message || '알 수 없는 오류' });
      setMsg('실패: ' + (err as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const runConfirmedSync = async (ids: string[], autoDelete: boolean) => {
    const result = await runSyncInner(ids);
    if (!result) return;
    const { report, backupOk } = result;
    // v0.20.0 Phase 2 — 토큰 만료/미로그인(structured needsLogin)이면 로그인 팝업을 띄우고, 재로그인
    // 성공 시 같은 동기화를 그대로 재개한다. report.message는 runSyncInner에서 이미 항상 표면화됐다
    // (조용한 실패 제거) — 팝업은 그 위에 "다음 행동"을 명시한다.
    if (report.needsLogin) {
      setLoginPrompt({
        reason: '시트 동기화에 로그인이 필요합니다. 로그인하면 이어서 업로드합니다.',
        resume: () => { void runConfirmedSync(ids, autoDelete); },
      });
      return;
    }
    // 시트 업로드 성공한 세션 자동 삭제. 로그 백업 실패 시 데이터 유실 방지를 위해 삭제 보류.
    if (autoDelete && report.ok > 0 && report.successIds.length > 0) {
      if (!backupOk) {
        setMsg((m) =>
          (m ? `${m} · ` : '') +
          `자동 삭제 보류: 로그 백업 실패로 ${report.successIds.length}개 세션을 로컬에 유지합니다.`,
        );
        return;
      }
      const successIds = report.successIds;
      clipPlayer.stop(); // 클립 IDB 삭제 전 재생 정지 — 삭제된 세션 클립이 계속 재생되지 않도록 (Codex HIGH)
      for (const id of successIds) {
        try { await dbDeleteSession(id); } catch { /* ignore */ }
        removeSession(id);
      }
      setMsg((m) => (m ? m + ` · ${successIds.length}개 세션 삭제됨` : `✓ ${successIds.length}개 세션 삭제됨`));
    }
  };
  const handleSyncConfirm = async (ids: string[], autoDelete: boolean) => {
    // ── 🔴 v0.51 rauth P1 — **선제 갱신을 제스처 안으로 옮긴다. 이 줄이 첫 줄이어야 한다.** ──
    //
    // 종전에는 `runSyncInner`가 `await syncSelected(...)`(시트 왕복 전체)를 끝낸 **뒤에**
    // `ensureAccessToken()`을 불렀다 — 그 시점엔 클릭의 transient activation이 이미 소진돼
    // 무팝업 갱신이 브라우저에 막힌다. 2026-08-19 실측이 그 모양이었다: 로그 백업 5회 중 4회가
    // 첫 시도에 401/403으로 죽고, **사용자가 로그인 버튼을 눌러야**(=새 제스처) 갱신됐다.
    //
    // 만료 임박 판정(`getStoredToken()`)은 **동기**라 여기서 그대로 할 수 있고, `signIn()`도
    // 팝업을 동기적으로 연다(warmup 전제). 그래서 이 한 줄이 클릭의 동기 구간 안에 머문다.
    // 아래 `runSyncInner`의 업로드 직전 `ensureAccessToken()`은 **확인 전용**으로 남는다
    // (`auth_ensure:hit`) — 이 갱신이 이미 성공했으면 거기선 아무 일도 일어나지 않는다.
    //
    // ⚠️ `await`는 여기서 하지 않는다 — 제스처의 동기 구간을 끊지 않기 위해 **시작만** 하고,
    //    실제 대기는 아래 `runConfirmedSync` 직전에 한다(그 사이 코드는 순수 로컬 판정이다).
    //
    // 🔴 v0.51 r1 [F-3 / 리뷰 H-3] — **세션이 살아 있으면 이 갱신을 하지 않는다.**
    //    「세션 중 갱신 절대 금지」(계획서 §2-6 · rauth §2-6 실측)는 P2에만 걸려 있었고 P1엔 없었다.
    //    그런데 세션 중 데이터탭 진입은 막혀 있지 않고(App.tsx `changeTab`은 제한하지 않으며
    //    세션이 살아 있으면 VoiceScreen을 keep-alive로 렌더한다 [STT-16]), 3시간 세션 × 1시간
    //    토큰이면 **2시간차 이후의 동기화 클릭은 「토큰 만료」가 기대값**이다. 즉 P1이 정확히
    //    녹음 중에 팝업을 연다 — 앱이 1~2초 백그라운드로 가는 [CLIP-SILENT-1]·[CLIP-LOSS-1]의
    //    바로 그 조건이고, 대가는 **녹음 데이터 유실**이다.
    //    세션 중에는 종전 경로로 떨어뜨린다: 업로드 직전 `ensureAccessToken` → 실패 시
    //    `needsLogin` → 재로그인 모달. 그 모달 클릭은 **사용자 명시 의사**라 잔존을 허용한다.
    //    계측: 「왜 선제 갱신이 없었나」를 로그로 남긴다 — 안 남기면 이 가드는 관측 불가능하고
    //    (리뷰 M-3이 지적한 그 형태), 아래 업로드 직전 `ensureAccessToken`이 내는 이벤트와
    //    구분되지 않아 「선제 갱신이 돌았는가」를 로그로 판정할 수 없다.
    const sessionLive = isSessionLive(useSessionStore.getState().phase);
    if (sessionLive) logger.log({ type: 'app', extra: 'auth_prerefresh:skipped:session_live' });
    const preRefresh = sessionLive ? null : ensureAccessToken();
    setSyncModalOpen(false);
    const syncIds = excludeInProgress(ids);
    const sessions = useDataStore.getState().sessions.filter((s) => syncIds.includes(s.id));
    if (sessions.some((s) => !s.target)) {
      const settings = useSettingsStore.getState();
      const target = sessionTargetFromSettings(settings);
      if (!target) {
        setMsg('시트 연결을 다시 확인한 뒤 이전 세션의 대상을 선택해 주세요.');
        return;
      }
      const savedName = settings.savedSheets.find((s) => s.sheetId === target.spreadsheetId)?.name;
      const prompt = buildLegacySyncPrompt(
        sessions, ids, autoDelete, target, `${savedName ?? '시트'}의 “${target.sheetTab}” 탭`,
      );
      if (prompt) { setLegacySyncPrompt(prompt); return; }
    }
    // P1의 대기 지점. `ensureAccessToken`은 throw하지 않으므로(계약) 결과 boolean은 버려도 된다 —
    // 실패했으면(또는 [F-3]로 건너뛰었으면) 종전 실패 경로(needsLogin → 재로그인 배너)가 받는다.
    if (preRefresh) await preRefresh;
    await runConfirmedSync(ids, autoDelete);
  };
  /** 대기열의 **한 세션**에 대한 답을 확정한다. 남은 세션이 있으면 다음 세션을 이어서 묻고,
   *  대기열이 비면 좌표 없는 나머지(plain)를 일괄 결합한 뒤 동기화를 시작한다.
   *  중간 취소는 이미 답한 세션의 결정을 그대로 둔다 — 사용자가 명시적으로 고른 값이다. */
  const confirmLegacySync = async (decision: LegacyTargetDecision) => {
    const prompt = legacySyncPrompt;
    if (!prompt) return;
    const [current, ...rest] = prompt.pending;
    setBusy('대상 시트 저장 중...');
    setMsg(null);
    try {
      if (current) {
        const result = await applyLegacyTarget(current, prompt.target, decision);
        if (result === 'active') {
          setLegacySyncPrompt(null);
          setMsg(ACTIVE_SESSION_SYNC_MESSAGE);
          return;
        }
      } else {
        // 좌표 없는 세션은 어느 답이든 append다 — 묶어서 처리해도 교차 오염이 없다.
        for (const id of prompt.plain) {
          const result = await applyLegacyTarget(id, prompt.target, decision);
          if (result === 'active') {
            setLegacySyncPrompt(null);
            setMsg(ACTIVE_SESSION_SYNC_MESSAGE);
            return;
          }
        }
      }
    } catch (err) {
      setLegacySyncPrompt(null);
      setMsg('대상 시트 저장 실패: ' + ((err as Error).message || '다시 시도해 주세요.'));
      return;
    } finally {
      setBusy(null);
    }
    const next = advanceLegacySyncPrompt(prompt, useDataStore.getState().sessions);
    if (next) { setLegacySyncPrompt(next); return; }
    setLegacySyncPrompt(null);
    await runConfirmedSync(prompt.ids, prompt.autoDelete);
  };
  const handleRetry = async () => {
    setFailureReport(null);
    const ids = failureReport?.failures.map((f) => f.sessionId) ?? lastSelectedIdsRef.current;
    if (ids.length) await handleSyncConfirm(ids, false);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteTarget(null);
    clipPlayer.stop(); // 클립 IDB 삭제 전 재생 정지 (Codex HIGH)
    try { await dbDeleteSession(id); } catch { /* ignore */ }
    removeSession(id);
    setMsg('세션 삭제됨');
  };

  return {
    busy, msg,
    syncModalOpen, setSyncModalOpen,
    exportModalOpen: exportActions.exportModalOpen, setExportModalOpen: exportActions.setExportModalOpen,
    deleteTarget, setDeleteTarget,
    failureReport, setFailureReport,
    syncStatus, setSyncStatus,
    failureDetailOpen, setFailureDetailOpen,
    legacySyncPrompt, setLegacySyncPrompt,
    pendingZipIds: exportActions.pendingZipIds, setPendingZipIds: exportActions.setPendingZipIds,
    recoverModalOpen: recoverActions.recoverModalOpen, setRecoverModalOpen: recoverActions.setRecoverModalOpen,
    exportResult: exportActions.exportResult, setExportResult: exportActions.setExportResult,
    loginPrompt, setLoginPrompt,
    handleLoginPromptLogin,
    runZipExport: exportActions.runZipExport, handleExport: exportActions.handleExport, handleCellSave,
    handleSyncConfirm, confirmLegacySync, handleRetry, handleDeleteConfirm,
    handleRecoverClick: recoverActions.handleRecoverClick, handleRecoverRestore: recoverActions.handleRecoverRestore,
  };
}
