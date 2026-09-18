import { useEffect, useState } from 'react';
import { T } from '../tokens';
import { I } from '../components/icons';
import { ScreenHeader } from '../components/ScreenHeader';
import { useDataStore } from '../stores/dataStore';
import { useSessionStore, isSessionLive } from '../stores/sessionStore';
import { hydrateSessions } from '../lib/hydrate';
import { clipPlayer } from '../lib/clipPlayer';
import { sessionPending } from '../lib/sessionSync';
import { useDataActions } from '../lib/useDataActions';
import { consumeAuthLostPrompt } from '../lib/pastValues';
import { getStoredToken } from '../lib/googleAuth';
import { logger } from '../lib/logger';
import { authLostPrompt } from '../lib/logEvents';
import { LoginRequiredModal } from '../components/LoginRequiredModal';
import { HelpButton, SettingsHelpModal } from '../components/settings/SettingsHelp';
import type { HelpItem } from '../components/settings/helpCopy';
import { SyncSessionModal } from '../components/data/SyncSessionModal';
import { ExportModal } from '../components/data/ExportModal';
import { RecoverModal } from '../components/data/RecoverModal';
import { FailureModal } from '../components/data/FailureModal';
import { SyncStatusModal } from '../components/data/SyncStatusModal';
import { ConfirmModal } from '../components/data/ConfirmModal';
import { ExportDoneModal } from '../components/data/ExportDoneModal';
import { SessionCard } from '../components/data/SessionCard';
import { SessionDetailModal } from '../components/data/SessionDetailModal';
import { LoadErrorState } from '../components/data/LoadErrorState';
import { EmptyState } from '../components/data/EmptyState';
import { useSessionClipBytes } from '../lib/useSessionClipBytes';


/** v0.25.0 데이터탭#4(Vance) — 작은 인라인 안내를 헤더 `?` on-demand 큰 팝업으로 이전.
 *  현장 기술자(장갑·소음·햇빛) 기준으로 짧고 정확하게. SettingsHelpModal(safe-area·스크롤) 재사용. */
const DATA_GUIDE: HelpItem[] = [
  {
    title: '이 화면은',
    body:
      '조사한 세션(측정 기록)이 카드로 쌓입니다. 카드를 눌러 값을 펼쳐 보고, 잘못 들어간 값은 그 자리에서 고칠 수 있어요.',
  },
  {
    title: '시트에 올리기 — 동기화',
    body:
      '‘동기화’를 누르면 고른 세션이 구글 시트에 추가되거나(같은 행은) 갱신됩니다. ' +
      '시트에 새로 반영되는 세션은 그 음성 로그도 Drive에 자동으로 백업돼요.',
  },
  {
    title: '기기로 내보내기',
    body:
      '‘내보내기’로 CSV(엑셀에서 열림)나 음성 로그를 이 기기에 저장하거나, 공유 버튼으로 다른 앱(엑셀·파일·메일)으로 바로 보낼 수 있어요.',
  },
  {
    title: '자동 백업과 복구',
    body:
      'Drive에 백업된 음성 로그는 나중에 세션을 되살릴 때 쓰입니다. ' +
      '일부만 올라간 경우 안내 메시지의 ‘자세히’에서 어떤 목적지가 실패했는지 확인하세요.',
  },
];

export function DataScreen() {
  const sessions = useDataStore((s) => s.sessions);
  const expandedSessionId = useDataStore((s) => s.expandedSessionId);
  const toggleExpand = useDataStore((s) => s.toggleExpand);
  const hydrationError = useDataStore((s) => s.hydrationError);
  // v0.48.0 P5(NEW-6, 민구 제보 08-10) — "지금의 탭에서 진행중이던 세션은 '진행중' 표현을
  // 추가해주길 바람." 활성 세션도 커밋마다 upsertSession돼 완료 전부터 이 목록에 실시간으로
  // 뜨는데(useVoiceSession.ts), 카드엔 그게 "지금 그 세션"이라는 표시가 없었다(scout-v048 조사).
  // 🔴 sessionId는 stop() 후에도 안 지워진다(다음 세션 시작 시 resetAll()에서만 초기화) — phase
  // 조건 없이 id만 비교하면 방금 끝난 세션도 "진행중"으로 잘못 뜬다(scout 함정 발견).
  //
  // v0.48.1 P5 보완(리뷰 F6·F7, 민구 2차 결정) — **일시정지는 별도 배지로 가른다.**
  //   F7(claude low): `App.tsx:38`의 `sessionLive`는 "VoiceScreen을 unmount하지 않기 위한
  //   신호"가 존재 이유고 배지의 "지금 그 세션이다"와 목적이 다르다 — `paused`·`stopping`·
  //   `complete`를 뭉뚱그려 전부 "진행중"으로 보여줬다. 민구가 `paused`만 분리하기로 결정
  //   (`stopping`·`complete`는 언급 없음 — 그 둘은 여전히 "진행중"으로 남긴다. F7 처방ⓐ
  //   취지: 침묵은 곧 현행 유지, 이 사실을 명시해 둔다).
  //   F6(low): `phase !== 'done'`은 `'done'`이 실제로 세팅되는 곳이 0건인 죽은 절의 복제였다
  //   (`App.tsx:38`·`sessionSync.ts:20`과 동일 지적). 부정조건으로 죽은 값을 반복하지 않고,
  //   실제로 도달하는 phase만 허용목록으로 나열한다 — `App.tsx`는 소유 파일 밖이라 안 건드리고
  //   이 파일 안에서만 SSOT를 새로 정한다(공유 셀렉터로 옮기는 안은 범위 밖).
  const livePhase = useSessionStore((s) => s.phase);
  const liveSessionId = useSessionStore((s) => s.sessionId);
  const isLiveProgress = livePhase === 'active' || livePhase === 'complete' || livePhase === 'stopping';
  const isLivePaused = livePhase === 'paused';

  // v0.54.0 H2 / K5 / L1 — 세션별 녹음 클립 바이트 비동기 집계 (진행 중 세션만 id만 의존)
  const clipBytesMap = useSessionClipBytes(sessions, (isLiveProgress || isLivePaused) ? liveSessionId : undefined);

  const unsynced = sessions.filter((s) => sessionPending(s) > 0).length;
  const empty = sessions.length === 0;
  // v0.13.0 R5 — 상세 모달 대상. expandedSessionId가 SSOT, 여기선 그 세션 객체를 파생만 한다.
  const detailSession = sessions.find((s) => s.id === expandedSessionId) ?? null;
  // v0.25.0 데이터탭#4 — 헤더 `?`로 여는 안내 팝업(상시 노출 아님).
  const [guideOpen, setGuideOpen] = useState(false);

  // 동기화·내보내기·복구·삭제·재로그인 오케스트레이션 — useDataActions(순수 이동)가 소유.
  const {
    busy, msg,
    syncModalOpen, setSyncModalOpen,
    exportModalOpen, setExportModalOpen,
    deleteTarget, setDeleteTarget,
    failureReport, setFailureReport,
    syncStatus, setSyncStatus,
    failureDetailOpen, setFailureDetailOpen,
    legacySyncPrompt, setLegacySyncPrompt,
    pendingZipIds, setPendingZipIds,
    recoverModalOpen, setRecoverModalOpen,
    exportResult, setExportResult,
    loginPrompt, setLoginPrompt,
    handleLoginPromptLogin,
    runZipExport, handleExport, handleCellSave,
    handleSyncConfirm, confirmLegacySync, handleRetry, handleDeleteConfirm,
    handleRecoverClick, handleRecoverRestore,
  } = useDataActions();

  // 데이터탭을 떠나면(언마운트) 재생 중인 음성 클립 정지 — 전역 싱글톤이라 화면 밖에서 계속 재생되지 않도록 (Codex HIGH)
  useEffect(() => () => { clipPlayer.stop(); }, []);

  // v0.55.0 B-3 — 세션 중 로그인 만료 시 세션 종료 후 데이터 탭에서 로그인 모달 1회 유도
  useEffect(() => {
    if (isSessionLive(livePhase)) return;
    if (!consumeAuthLostPrompt()) return;
    if (getStoredToken()) {
      logger.log({
        type: 'app',
        sessionId: '__app__',
        extra: authLostPrompt('token_ok'),
      });
      return;
    }
    logger.log({
      type: 'app',
      sessionId: '__app__',
      extra: authLostPrompt('shown'),
    });
    setLoginPrompt({
      reason: '조사 중에 로그인이 만료됐습니다. 시트에 올리기 전에 다시 로그인하세요.',
      resume: () => {},
    });
  }, [livePhase]);


  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ScreenHeader
        sub={`${sessions.length}개 세션`}
        right={
          <HelpButton
            onOpen={() => setGuideOpen(true)}
            label="데이터 탭 안내 보기"
            testid="data-guide-button"
          />
        }
      />

      {/* Action bar */}
      <div style={{ padding: '0 16px 10px', display: 'flex', gap: 8, flexShrink: 0 }}>
        <button
          onClick={() => setSyncModalOpen(true)}
          disabled={busy !== null || sessions.length === 0}
          style={{
            flex: 1, height: 52, borderRadius: 14, border: 'none',
            background: sessions.length === 0 ? '#2A2D32' : T.blue,
            color: '#fff', fontSize: 15, fontWeight: 800, letterSpacing: -0.2,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            cursor: sessions.length === 0 ? 'not-allowed' : 'pointer',
            position: 'relative',
            boxShadow: sessions.length === 0 ? 'none' : `0 4px 14px ${T.blueGlow}`,
            opacity: sessions.length === 0 ? 0.6 : 1,
          }}
        >
          {I.sync(18, '#fff')} 시트에 추가
          {unsynced > 0 && (
            <span
              style={{
                position: 'absolute', top: -6, right: -6,
                minWidth: 24, height: 24, padding: '0 7px',
                borderRadius: 999, background: T.amber, color: '#1a1300',
                fontSize: 12, fontWeight: 800,
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '2px solid #0E0F11',
              }}
            >
              {unsynced}
            </span>
          )}
        </button>
        <button
          onClick={handleRecoverClick}
          disabled={busy !== null}
          style={{
            height: 52, padding: '0 14px', borderRadius: 14,
            border: `1px solid ${T.lineStrong}`, background: T.card,
            color: T.text, fontSize: 13, fontWeight: 700,
            display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
          }}
          title="사라진 세션 복구 (저장된 기록 다시 불러오기)"
        >
          {I.download(18, T.text)} 세션 복구
        </button>
        <button
          onClick={() => setExportModalOpen(true)}
          disabled={busy !== null || sessions.length === 0}
          style={{
            height: 52, padding: '0 14px', borderRadius: 14,
            border: `1px solid ${T.lineStrong}`, background: T.card,
            color: T.text, fontSize: 13, fontWeight: 700,
            display: 'flex', alignItems: 'center', gap: 6,
            cursor: sessions.length === 0 ? 'not-allowed' : 'pointer',
            opacity: sessions.length === 0 ? 0.6 : 1,
          }}
          title="기기로 내보내기 (CSV / 사용자 로그)"
        >
          {I.download(18, T.text)} 내보내기
        </button>
      </div>


      {(busy || msg) && (
        <div
          style={{
            margin: '0 16px 10px',
            padding: '10px 14px', borderRadius: 10,
            background: 'rgba(255,255,255,0.04)',
            fontSize: 14, color: msg?.startsWith('✓') ? T.green : T.textDim,
            flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: 10,
          }}
        >
          <span style={{ flex: 1 }}>{busy || msg}</span>
          {failureReport && failureReport.failures.length > 0 && (
            <button
              onClick={() => setFailureDetailOpen(true)}
              style={{
                background: 'transparent', border: `1px solid ${T.line}`,
                color: T.text, fontSize: 12, padding: '4px 10px', borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              자세히
            </button>
          )}
        </div>
      )}

      <div
        style={{
          flex: 1, minHeight: 0, padding: '0 16px 16px',
          display: 'flex', flexDirection: 'column', gap: 10,
          overflowY: 'auto', overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {empty ? (
          hydrationError ? (
            <LoadErrorState error={hydrationError} onRetry={() => { void hydrateSessions(); }} />
          ) : (
            <EmptyState />
          )
        ) : (
          sessions.map((s) => (
            <SessionCard
              key={s.id}
              session={s}
              expanded={expandedSessionId === s.id}
              inProgress={s.id === liveSessionId && isLiveProgress}
              paused={s.id === liveSessionId && isLivePaused}
              clipBytes={clipBytesMap.get(s.id)}
              onToggle={() => toggleExpand(s.id)}
              onDelete={() => setDeleteTarget(s)}
              onCellSave={(rowIndex, colId, value) => handleCellSave(s.id, rowIndex, colId, value)}
            />
          ))
        )}
      </div>

      {syncModalOpen && (
        <SyncSessionModal
          sessions={sessions}
          onCancel={() => setSyncModalOpen(false)}
          onConfirm={handleSyncConfirm}
        />
      )}

      {exportModalOpen && (
        <ExportModal
          sessions={sessions}
          onCancel={() => setExportModalOpen(false)}
          onExport={handleExport}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title="세션 삭제"
          body={`${deleteTarget.date} 세션 (${deleteTarget.completedRows}행)을 삭제할까요?\n복구할 수 없습니다.`}
          confirmLabel="삭제"
          danger
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleDeleteConfirm}
        />
      )}

      {legacySyncPrompt && (
        <ConfirmModal
          title={legacySyncPrompt.pending.length > 0 && legacySyncPrompt.askTotal > 1
            ? `이전 세션 대상 확인 (${legacySyncPrompt.askedIndex}/${legacySyncPrompt.askTotal})`
            : '이전 세션 대상 확인'}
          // 업로드 이력이 있는 세션은 **한 번에 하나씩** 묻는다 — 세션마다 원본 시트가 다를 수 있고,
          // 묶어서 물으면 다른 시트에 올렸던 세션이 남의 행을 덮어쓴다(리뷰#6 Critical).
          body={legacySyncPrompt.pending.length > 0
            ? `${legacySyncPrompt.currentLabel}은 전에 시트에 올린 행이 있습니다.\n현재 연결된 ${legacySyncPrompt.targetLabel}이 이 세션을 원래 올린 시트인지 선택해 주세요.\n\n원래 시트: 기존 행 갱신\n다른 시트: 모든 행 새로 추가`
            : `${legacySyncPrompt.plain.length === 1 ? '이 세션' : `대상 없는 ${legacySyncPrompt.plain.length}개 세션`}의 대상 시트를 알 수 없습니다.\n현재 연결된 ${legacySyncPrompt.targetLabel}에 올릴까요?`}
          confirmLabel={legacySyncPrompt.pending.length > 0 ? '원래 이 시트 맞음' : '이 시트에 올리기'}
          alternativeLabel={legacySyncPrompt.pending.length > 0
            ? '다른 시트로 새로 올리기'
            : undefined}
          onCancel={() => setLegacySyncPrompt(null)}
          onConfirm={() => { void confirmLegacySync('same-sheet'); }}
          onAlternative={legacySyncPrompt.pending.length > 0
            ? () => { void confirmLegacySync('different-sheet'); }
            : undefined}
        />
      )}

      {/* v0.44.0 §C8 F23 — 세션별 실패 상세는 자동 마운트에서 배너 '자세히' 명시 오픈으로 전환.
          실패의 1차 표면은 아래 SyncStatusModal(사유+재시도/나중에)이 담당한다. */}
      {failureDetailOpen && failureReport && (
        <FailureModal
          report={failureReport}
          onClose={() => setFailureDetailOpen(false)}
          onRetry={handleRetry}
        />
      )}

      {/* v0.44.0 §C8 F23 — 동기화 상태 대형 팝업: 업로드 중 "시트에 추가중" · 성공 자동 닫힘 ·
          실패 시 사유+[재시도]/[나중에]. 재시도는 실패 세션(failureReport) 우선, 없으면 직전 선택. */}
      {syncStatus && (
        <SyncStatusModal
          status={syncStatus}
          onRetry={() => { setSyncStatus(null); void handleRetry(); }}
          onLater={() => setSyncStatus(null)}
        />
      )}

      {recoverModalOpen && (
        <RecoverModal
          localIds={new Set(sessions.map((s) => s.id))}
          onClose={() => setRecoverModalOpen(false)}
          onRestore={handleRecoverRestore}
        />
      )}

      {pendingZipIds && (
        <ConfirmModal
          title="사용자 로그 내보내기"
          body={`${pendingZipIds.length}개 세션의 사용자 로그를 ZIP으로 압축합니다.\n용량이 크거나 시간이 걸릴 수 있어요.\n\n계속할까요?`}
          confirmLabel="압축"
          onCancel={() => setPendingZipIds(null)}
          onConfirm={() => {
            const ids = pendingZipIds;
            setPendingZipIds(null);
            void runZipExport(ids);
          }}
        />
      )}

      {/* v0.13.0 R5 — 세션 상세 모달. expandedSessionId가 어떤 상세가 열렸는지의 SSOT(새 상태 불필요).
          삭제로 세션이 사라지면 find가 undefined → 자동으로 안 뜸(removeSession이 expandedSessionId도 정리). */}
      {detailSession && (
        <SessionDetailModal
          session={detailSession}
          onClose={() => toggleExpand(detailSession.id)}
          onCellSave={(rowIndex, colId, value) => handleCellSave(detailSession.id, rowIndex, colId, value)}
        />
      )}

      {/* v0.13.0 R6 — 내보내기 완료 큰 팝업(작은 줄 배너 대신). 클릭 시 공유시트/재다운로드. */}
      {exportResult && (
        <ExportDoneModal
          result={exportResult}
          onClose={() => setExportResult(null)}
        />
      )}

      {/* v0.20.0 Phase 2 — 범용 로그인 필요 팝업(시트 동기화·Drive 백업·세션 복구 공용). onLogin은
          GIS 팝업을 클릭 제스처 안에서 열고(googleAuth S-1) 성공 시 직전 동작을 이어서 실행한다. */}
      {loginPrompt && (
        <LoginRequiredModal
          reason={loginPrompt.reason}
          onLogin={handleLoginPromptLogin}
          onClose={() => setLoginPrompt(null)}
        />
      )}

      {/* v0.25.0 데이터탭#4 — 헤더 `?`로 여는 큰 안내 팝업(작은 인라인 안내 대체). */}
      {guideOpen && (
        <SettingsHelpModal
          title="데이터 탭 안내"
          items={DATA_GUIDE}
          onClose={() => setGuideOpen(false)}
          testid="data-guide-modal"
        />
      )}

    </div>
  );
}
