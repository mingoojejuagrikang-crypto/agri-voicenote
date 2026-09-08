import { useCallback, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSessionStore } from '../../stores/sessionStore';
import { computeRowFromAutoChange } from '../../lib/autoValue';
import type { Column } from '../../types';
import { CommandHelpPopup } from './CommandHelpPopup';
import { ManualValueSheet } from './ManualValueSheet';
import { type ReaskReason } from './ReaskCue';
import { TONE_BASE, type GlowTone } from './EdgeGlow';
import { useReviewCommit } from './VoiceHero';
import { useVoiceCommitMarkColId, useCommitMarkAlertColId } from './useVoiceCommitMark';
import { useHoldCandidateMask } from './useHoldCandidateMask';
import { ActiveHeaderStrip } from './ActiveHeaderStrip';
import { ChipZone } from './ChipZone';
import { CenterStage } from './CenterStage';
import { ActiveControlBar, type EdgeMode } from './ActiveControlBar';
import { activeZoneRows } from './heroLayout';
import { scheduleFontRenderSnapshot } from './fontRenderProbe';
import type { DotGlyph } from './StateDots';
import type { VoiceUiCommandSignal } from '../../lib/voiceCommands';

/** 우측 끝 정렬 시 칩과 트랙 오른쪽 가장자리 사이 여백(px). 칩이 가장자리에 딱 붙으면
 *  "더 있다"는 신호가 사라져 잘린 것처럼 보인다. */
const CHIP_SCROLL_PAD = 8;

/** 입력화면 조립 루트 — 와이어프레임 4상태(active·anomaly·paused·complete)를 **하나의 트리**에서
 *  표시만 바꿔 그린다(SSOT: `Deliverables/2026-07-24-survey-011-active-screen-wireframe.md`).
 *
 *  🔴 상태 전환은 **표시 전환**이지 트리 교체가 아니다. 세션 트리를 조건부로 갈아치우면 인식기·
 *  워치독·클립 레코더가 통째로 teardown된다([STT-16] 실기기 62초 사공백, [IOS-7]의 PortraitGuard가
 *  오버레이인 이유도 같다).
 *
 *  구역(§공통규칙1): 상단 스트립(auto) + **칩존 20% / 중앙 50% / 하단 30%**(UI-b). 비율의 분모는
 *  `ACTIVE_ZONE_ROWS` 주석 참조. */
export function ActiveState({
  totalRows, columns, voiceCols, currentColId, completing, endReached, paused, anomalyPending, tone,
  getAudioLevel, getTimeDomainData,
  reaskReason, uiCommand,
  onEnd, onJumpToRow, onPrevRow, onNextRow, onTogglePause, onTouchCommit,
  onManualCommit, onManualOpen, onManualClose, onAnomalyConfirm, onAnomalyModify,
  onManualAnomalyConfirm, onManualAnomalyModify,
  onCommandHelpOpen, onCommandHelpClose,
  onExitConfirmOpen, onExitConfirmCancel,
}: {
  totalRows: number;
  columns: Column[];
  voiceCols: Column[];
  currentColId?: string;
  /** phase 'complete' — 완료 행 검토 대기 **또는** 끝 도달. 둘의 화면 차이는 endReached가 가른다. */
  completing: boolean;
  /** 와이어프레임 §[4] — 조사 전체 완료(끝 도달). 검토 대기와 구분된다. */
  endReached: boolean;
  paused: boolean;
  /** v0.34.0 B8 — 이상치 대기(파생 SSOT는 VoiceScreen — EdgeGlow 톤과 동일 신호). */
  anomalyPending: boolean;
  /** 상태 톤(VoiceScreen glowTone SSOT) — 칩·도트·파형·엣지글로우가 같은 색으로 상태를 말한다. */
  tone: GlowTone;
  /** v0.34.0 B7 — 파동 레벨 getter(useVoiceSession, 안정 참조). */
  getAudioLevel: () => number;
  /** v0.35.0 — 시간영역 파형 getter(useVoiceSession). */
  getTimeDomainData: (out: Uint8Array) => boolean;
  reaskReason: ReaskReason;
  /** v0.38.0 #4-③ — useVoiceSession이 최종 판정한 UI 버튼 음성 명령(단조 seq). */
  uiCommand: VoiceUiCommandSignal | null;
  onEnd: () => void;
  onJumpToRow: (row: number) => void;
  onPrevRow: () => void;
  onNextRow: () => void;
  onTogglePause: () => void;
  onTouchCommit: (row: number, colId: string, value: string) => void;
  /** v0.33.0 항목6 — 수동 입력 시트 커밋 + 열림/닫힘 STT suspend 배선. */
  onManualCommit: (row: number, colId: string, value: string) => void;
  onManualOpen: () => void;
  onManualClose: () => void;
  /** v0.33.0 항목7 — 이상치 응답 대기의 터치 경로(음성 '확인'/'수정'과 동일 동작). */
  onAnomalyConfirm: () => void;
  onAnomalyModify: () => void;
  /** v0.34.0 A1 — 수동 입력 이상치 **보류**(manualHold) 전용 해제 콜백. */
  onManualAnomalyConfirm: () => void;
  onManualAnomalyModify: () => void;
  onCommandHelpOpen: () => void;
  onCommandHelpClose: () => void;
  /** v0.35.0 R2-FIX-2 — 저장확인 인라인 열림/취소 시 STT suspend·resume. */
  onExitConfirmOpen: () => void;
  onExitConfirmCancel: () => void;
}) {
  // 전체 store 구독 금지 — interimValue가 매 STT interim마다 바뀌면 칩·컨트롤 전체가 리렌더된다.
  const sess = useSessionStore(
    useShallow((s) => ({
      activeRow: s.activeRow,
      allRowValues: s.allRowValues,
      anomalyAlert: s.anomalyAlert,
      modifyIndicator: s.modifyIndicator,
      completedRows: s.completedRows,
      endReachedOnce: s.endReachedOnce,
      getRowValues: s.getRowValues,
    })),
  );
  const row = sess.activeRow;
  // v0.37.0 리뷰 #1(민구: 커밋 영수증) — 검토 표시값 파생을 **여기(항상 마운트)** 에서 한다.
  const reviewCommit = useReviewCommit(completing, row);
  // v0.45.0 UI③ — 방금 음성 확정된 칩의 V 마크(중앙 ✓+항목명 라벨 삭제의 승계 표시).
  const commitMarkColId = useVoiceCommitMarkColId();
  // v0.47.0-r2 P5(FB-F) — ✓의 **색**. 표시 여부(위)와 직교한 축이라 별도 파생이다.
  //   이 행에 알람이 걸린 셀만 빨강 — 저장 상태가 아니라 anomalyAlert에서 매 렌더 파생된다.
  const alertMarkColId = useCommitMarkAlertColId(row);
  const pct = totalRows > 0 ? (row / totalRows) * 100 : 0;
  const rowValues = sess.getRowValues(row);
  // 🔴 v0.47.0-r2 P5 보강(민구 08-09) — **미확정 후보값은 칩에 넣지 않는다.** 칩존에 내리는
  //   값만 직전 확정값으로 되돌린다(저장·동기화·복원은 무접촉 · 근거는 useHoldCandidateMask).
  //   ⚠️ `rowValues` 자체는 바꾸지 않는다 — [수정] 시트 프리필(:currentValue)은 후보값
  //   그대로여야 사용자가 방금 넣은 값의 한 자리를 고칠 수 있다.
  const { chipValues, maskedColId } = useHoldCandidateMask(row, rowValues);
  // 가려진 칩이 보여 주는 것은 **직전 확정값**이다 — 알람 대상이 아니므로 체크는 원래 색(초록).
  //   (민구: *"기존 값이 있던 셀이면 그 옛 값(+원래 색 체크)"*.) 「이 칩이 알람 대상」 신호는
  //   활성 칩의 빨강 강조·칩존 하단 경계가 계속 진다 — 값과 체크만 직전 상태로 되돌린다.
  const commitMarkAlertColId = maskedColId !== null && alertMarkColId === maskedColId
    ? null
    : alertMarkColId;
  const activeChipValue = currentColId ? rowValues[currentColId] : undefined;
  const [editingColId, setEditingColId] = useState<string | null>(null);
  const [cmdHelpOpen, setCmdHelpOpen] = useState(false);
  const cmdHelpSuspendedRef = useRef(false);
  const [confirmExitOpen, setConfirmExitOpen] = useState(false);
  // v0.35.0 R2-FIX-2 — 저장확인 인라인 동안 STT 정지(취소 → resume, 확인 → stop()).
  const openExitConfirm = useCallback(() => {
    onExitConfirmOpen();
    setConfirmExitOpen(true);
  }, [onExitConfirmOpen]);
  const cancelExitConfirm = useCallback(() => {
    setConfirmExitOpen(false);
    onExitConfirmCancel();
  }, [onExitConfirmCancel]);
  const confirmExit = useCallback(() => {
    // 확인 경로는 resume하지 않는다 — onEnd()=stop()이 인식기를 정지시킨다(R2-FIX-2).
    setConfirmExitOpen(false);
    onEnd();
  }, [onEnd]);
  // v0.33.0 항목6 — 수동 입력 시트(음성 칩 탭). 열림 중 STT hard-suspend, 닫힘 시 resume.
  const [manualCol, setManualCol] = useState<Column | null>(null);
  const manualSuspendedRef = useRef(false);
  const openManualSheet = useCallback((c: Column) => {
    setEditingColId(null);
    if (!manualSuspendedRef.current) {
      manualSuspendedRef.current = true;
      onManualOpen();
    }
    setManualCol(c);
  }, [onManualOpen]);
  const closeManualSheet = useCallback(() => {
    setManualCol(null);
    if (manualSuspendedRef.current) {
      manualSuspendedRef.current = false;
      onManualClose();
    }
  }, [onManualClose]);

  const currentCol = voiceCols.find((c) => c.id === currentColId) || voiceCols[0];

  // 직전값 캡처 — store에 prevValue가 없으므로 view 레이어 ref로 정정 직전의 값을 기억한다.
  //   빈 값은 추적값을 덮어쓰지 않는다(재프롬프트가 셀을 ''로 비우기 직전의 값을 잃지 않게).
  const lastNonEmptyRef = useRef<Record<string, string>>({});
  const lastRowRef = useRef(row);
  if (lastRowRef.current !== row) { lastNonEmptyRef.current = {}; lastRowRef.current = row; }
  const modCol = sess.modifyIndicator?.colId;
  const modCurrent = modCol ? (rowValues[modCol] ?? '') : '';
  const modPrev = modCol ? lastNonEmptyRef.current[modCol] : undefined;
  for (const c of voiceCols) {
    const v = rowValues[c.id] ?? '';
    if (v && c.id !== modCol) lastNonEmptyRef.current[c.id] = v;
  }

  // v0.44.0 §C4 — 칩/진행색은 tone(VoiceScreen SSOT)에서만 파생한다. 종전엔 여기서
  // anomalyPending/paused를 다시 조합해 SSOT와 두 곳이었고, 일시정지 활성칩이 green으로
  // 남아 점멸 대상(상태색 요소 전부 — 민구 확정 §4-a 8)에서 빠져 있었다.
  const chipAccent = TONE_BASE[tone];
  const progressAccent = TONE_BASE[tone];

  const openCommandHelp = useCallback(() => {
    if (!cmdHelpSuspendedRef.current) {
      cmdHelpSuspendedRef.current = true;
      onCommandHelpOpen();
    }
    setCmdHelpOpen(true);
  }, [onCommandHelpOpen]);

  const closeCommandHelp = useCallback(() => {
    setCmdHelpOpen(false);
    if (cmdHelpSuspendedRef.current) {
      cmdHelpSuspendedRef.current = false;
      onCommandHelpClose();
    }
  }, [onCommandHelpClose]);

  const handledUiCommandSeqRef = useRef(0);
  useEffect(() => {
    if (!uiCommand || uiCommand.seq <= handledUiCommandSeqRef.current) return;
    handledUiCommandSeqRef.current = uiCommand.seq;
    if (uiCommand.id === 'help') openCommandHelp();
  }, [uiCommand, openCommandHelp]);

  // §5-1 ④(v0.44.0) — 폰트 실렌더값 세션당 1회 계측 예약. 1회 계약(sessionId 가드)·안정 시점·
  // 프로브 규칙은 fontRenderProbe.ts가 SSOT로 소유한다. cleanup이 언마운트 시 대기 타이머를 끈다.
  useEffect(() => scheduleFontRenderSnapshot(), []);

  // v0.37.0 리뷰#2 — 탭 전환 직전 overlayCloseSeq 증가 → 열린 시트/도움말을 닫아 STT를 재개한다.
  const overlayCloseSeq = useSessionStore((s) => s.overlayCloseSeq);
  const closeOverlaysRef = useRef<() => void>(() => {});
  closeOverlaysRef.current = () => { closeManualSheet(); closeCommandHelp(); };
  const seenOverlayCloseRef = useRef(overlayCloseSeq);
  useEffect(() => {
    if (overlayCloseSeq === seenOverlayCloseRef.current) return; // 마운트 초기값 — no-op
    seenOverlayCloseRef.current = overlayCloseSeq;
    closeOverlaysRef.current();
  }, [overlayCloseSeq]);

  // 칩존 자동 스크롤 — **진행중 칩을 보이는 영역의 우측 끝에** 둔다(민구 확정 2026-07-27).
  //
  // 🔴 왜 "다음 항목 보기"가 아니라 우측 끝인가 — 되돌리기 전에 반드시 읽어라.
  //    민구 근거: "한국인들은 글을 읽을때 좌>우로 읽어. 그러니 진행칩의 하이라이트도 좌>우로 이동해야 해."
  //    이 앱에서 특히 맞는 이유: 칩이 **'항목명 + 값'을 함께** 보여주므로 진행중 칩 왼쪽에 남는 것이
  //    **이미 입력을 마친 칩들(값이 찍혀 있다) = 입력 확인 영역**이 된다. 반대로 오른쪽(다음 항목)은
  //    값이 아직 `—`라 미리 볼 실익이 적다.
  //    ⚠️ 일반적 직관은 "다음을 보여준다"라서 이 동작이 버그로 오인되기 쉽다. 실제로 설계 검토에서
  //       제시된 세 후보(왼쪽 끝/가운데/다음 최대)가 **전부** 다음 보기 우선이었고 민구가 전부 물렸다.
  //       "다음 항목이 안 보인다"는 제보가 오면 결함이 아니라 이 결정이다.
  //
  // 규칙 두 줄:
  //   · 넘침 **전**(칩이 트랙 폭에 다 들어갈 때): 스크롤 없음. 칩이 왼쪽부터 채워지고
  //     하이라이트가 자연히 좌→우로 이동한다. (아래 clamp의 하한 0이 이걸 자동으로 만든다.)
  //   · 넘침 **후**: 진행중 칩의 오른쪽 끝을 가시영역 오른쪽 끝에 맞춘다.
  //
  // ⚠️ `scrollIntoView`를 쓰지 않는다 — 'nearest'는 "보이면 안 움직인다"라 우측 끝 정렬이 안 되고,
  //    'end'는 스크롤 조상을 함께 움직여 하단 트랙까지 밀 수 있다. 칩존만 직접 민다.
  const activeChipRef = useRef<HTMLDivElement | null>(null);
  const chipGridRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const alignActiveChip = () => {
      const grid = chipGridRef.current;
      const chip = activeChipRef.current;
      if (!grid || !chip) return;
      // offsetLeft는 offsetParent 기준이라 스크롤 컨테이너와 어긋난다 → 화면 좌표 차이로 잰다.
      const delta = chip.getBoundingClientRect().left - grid.getBoundingClientRect().left;
      const target = grid.scrollLeft + delta - (grid.clientWidth - chip.offsetWidth) + CHIP_SCROLL_PAD;
      grid.scrollLeft = Math.max(0, Math.min(grid.scrollWidth - grid.clientWidth, target));
    };
    alignActiveChip();
    // C4 — 회전·뷰포트 변화도 같은 산술을 다시 적용한다. 칩/컨테이너를 관측하는 ResizeObserver가
    // 아니라 window 이벤트만 읽으므로 useFitScale에서 경계한 자기관측 루프가 생기지 않는다.
    window.addEventListener('resize', alignActiveChip);
    return () => window.removeEventListener('resize', alignActiveChip);
    // 리뷰 C12(v0.45.0) — '✓' 마크(commitMarkColId)가 활성 칩 왼쪽 칩의 폭을 1.5초간 키웠다
    // 되돌린다. 정렬 산술이 마크 삽입·소멸 렌더 뒤에도 다시 돌아야 활성 칩 우측 끝 계약(C4)이
    // 그 창에서도 유지된다 — deps에 포함.
    //
    // 🔴 v0.46.1 §C1-① (2026-08-07) — **칩 폭·칩존 배분을 바꾸는 축 세 개가 더 있었다.**
    //   ① `editingColId` 인라인 편집 칩이 `flex:1 0 auto`로 커진다(§C1-② 처방 뒤 더 커졌다)
    //   ② `manualCol`   `:275`가 `activeZoneRows('modify')`로 **칩존 비율 자체를 바꾼다**(16→20%)
    //   ③ `confirmExitOpen` 같은 줄이 `'dotless'`로 가른다
    //   셋 다 렌더를 유발하지만 이 effect는 안 돌았다 → **정렬이 낡은 채 남는다.**
    //   402×874 실측(`v0461-edit-chip-width`): 편집 진입 전 활성 칩 우측 여유 **7.7px**(계약 준수)
    //   → 진입 후 **−195.0px**. 사용자가 방금 탭한 칩이 화면 밖으로 나간다.
    //   🔑 C12가 이미 같은 형태를 한 번 고쳤다 — **「칩 폭을 바꾸는 축은 deps에 넣는다」가 규칙이다.**
    //   ⚠️ `manualCol`은 객체라 **`.id`로 넣는다** — 참조를 넣으면 내용이 같아도 매 렌더 재실행된다.
    //   게이트: `tests/v0461-edit-chip-width.spec.ts` §C1-① (editingColId 축을 대표로 잡는다)
  }, [currentColId, row, activeChipValue, commitMarkColId, editingColId, manualCol?.id, confirmExitOpen]);

  // ── 상태 파생(단일 지점) ────────────────────────────────────────────────────
  // 수동 입력 시트가 화면을 덮는 동안엔 알람 표시를 접는다(중복 표시 방지). **보류 상태 자체는
  //   유지**되므로 시트를 취소하면 알람이 그대로 다시 나타난다(v0.34.0 라운드2).
  const alertVisible = sess.anomalyAlert && !manualCol ? sess.anomalyAlert : null;
  // 와이어프레임 §[2] — 하단 `<` `>`가 확인/수정으로 바뀌는 건 **응답 대기 알람 동안만**이다.
  //   정보성 알람(수동 커밋 이상치, awaitingResponse 미지정)은 이전/다음을 유지한다.
  const anomalyActionable = !!alertVisible && alertVisible.status !== 'corrected' && !!alertVisible.awaitingResponse;
  const edgeMode: EdgeMode = confirmExitOpen
    ? 'exit'
    : paused ? 'paused' : anomalyActionable ? 'anomaly' : 'nav';
  const glyph: DotGlyph = paused ? 'pause' : anomalyPending ? 'alert' : endReached ? 'check' : 'mic';

  const handleAnomalyConfirm = useCallback(() => {
    if (useSessionStore.getState().anomalyAlert?.manualHold) onManualAnomalyConfirm();
    else onAnomalyConfirm();
  }, [onAnomalyConfirm, onManualAnomalyConfirm]);

  const handleAnomalyModify = useCallback(() => {
    const alert = useSessionStore.getState().anomalyAlert;
    if (!alert?.manualHold) { onAnomalyModify(); return; }
    // manualHold의 [수정]은 해당 셀의 ManualValueSheet를 재오픈한다(시트 open 상태는 여기 소유).
    const holdCol = columns.find((c) => c.id === alert.colId);
    onManualAnomalyModify(); // 팝업 해제(+로그) — colId 캡처 후 호출
    if (holdCol) openManualSheet(holdCol);
  }, [columns, onAnomalyModify, onManualAnomalyModify, openManualSheet]);

  return (
    <div
      style={{
        flex: 1, minHeight: 0,
        display: 'grid',
        // 저장확인만 20/70/10 dotless. 일시정지는 ⏸ 도트가 상태를 말하므로 base를 유지한다.
        gridTemplateRows: activeZoneRows(confirmExitOpen ? 'dotless' : manualCol ? 'modify' : 'base'),
      }}
      data-testid="voice-active-state"
    >
      <ActiveHeaderStrip
        row={row}
        totalRows={totalRows}
        progressPct={pct}
        progressAccent={progressAccent}
        onOpenHelp={openCommandHelp}
      />

      <ChipZone
        columns={columns}
        rowValues={chipValues}
        row={row}
        // 와이어프레임 §[4] — "마지막 행 확정, **활성 강조 없음**". 조사가 끝나면 가리킬 다음 칸이
        //   없으므로 하이라이트·점멸을 거둔다(끝났는데 무언가를 기다리는 것처럼 보이지 않게).
        currentColId={endReached ? undefined : currentColId}
        commitMarkColId={commitMarkColId}
        commitMarkAlertColId={commitMarkAlertColId}
        activeTone={chipAccent}
        anomalyPending={anomalyPending}
        editingColId={editingColId}
        /* 🔴 v0.46.1 WP-4 C3-①(민구 08-07) — *"사람이 칩을 터치하여 **수동 입력**시에도 스크롤
           멈춰야하고"*. `editingColId`(인라인 편집)만으로는 **부족하다** — `ManualValueSheet`는
           `manualCol`이 소유하는 별개 상태라, 시트가 열린 채 스윕이 계속 돌면 사용자가 값을
           보며 입력하는 동안 뒤에서 칩이 움직인다. **두 축을 함께** 넘긴다. */
        sweepPaused={editingColId != null || manualCol != null}
        activeChipRef={activeChipRef}
        gridRef={chipGridRef}
        onActivate={(c) => {
          if (c.type === 'date' && c.input !== 'voice') return;
          if (c.input === 'voice') openManualSheet(c);
          else setEditingColId(c.id);
        }}
        onCommit={(c, newValue, prevValue) => {
          setEditingColId(null);
          if (c.input === 'touch') {
            // 터치 컬럼: sessionStore + dataStore + IDB에 즉시 반영 → sync/CSV 누락 방지.
            void onTouchCommit(row, c.id, newValue);
          } else if (c.input !== 'voice' && newValue !== prevValue) {
            // auto 컬럼 변경 → 해당 값으로 행 점프
            const targetRow = computeRowFromAutoChange(columns, c, newValue, row);
            if (targetRow !== null) onJumpToRow(targetRow);
          }
        }}
        onCancel={() => setEditingColId(null)}
      />

      {manualCol ? (
        <ManualValueSheet
          col={manualCol}
          currentValue={rowValues[manualCol.id] ?? ''}
          tone={tone}
          onCommit={(v) => {
            const colId = manualCol.id;
            closeManualSheet();
            onManualCommit(row, colId, v);
          }}
          onClose={closeManualSheet}
        />
      ) : (
        <>
          <CenterStage
            exitConfirming={confirmExitOpen}
            paused={paused}
            anomalyAlert={alertVisible}
            endReached={endReached}
            modifyIndicator={sess.modifyIndicator}
            currentCol={currentCol}
            completedCount={sess.completedRows.length}
            totalRows={totalRows}
            row={row}
            tone={tone}
            reaskReason={reaskReason}
            completing={completing}
            reviewCommit={reviewCommit}
            modifyPrevValue={modPrev}
            modifyCurrentValue={modCurrent}
          />

          <ActiveControlBar
            tone={tone}
            mode={edgeMode}
            glyph={glyph}
            // 현재 끝 도달 전에는 도트 전체가 일시정지 터치 경로다. 끝 도달 화면에서는 false지만,
            // 바로 아래 indicatorExit가 같은 자리를 종료 컨트롤로 승계한다.
            indicatorInteractive={!confirmExitOpen && !endReached && !paused}
            // [EXIT-PERSIST-1] 끝 도달 뒤에는 현재 행과 무관하게 도트 자리를 종료가 승계한다.
            // 응답 대기 알람의 확인/수정과 일시정지의 재시작/종료가 더 높은 우선순위다.
            indicatorExit={sess.endReachedOnce && !paused && !anomalyActionable}
            waveActive={!paused}
            getAudioLevel={getAudioLevel}
            getTimeDomainData={getTimeDomainData}
            onPrevRow={onPrevRow}
            onNextRow={onNextRow}
            onTogglePause={onTogglePause}
            onExit={openExitConfirm}
            onExitCancel={cancelExitConfirm}
            onExitConfirm={confirmExit}
            onAnomalyConfirm={handleAnomalyConfirm}
            onAnomalyModify={handleAnomalyModify}
          />
        </>
      )}

      {/* 도움말만 fixed 오버레이다. 수동 입력과 저장확인은 인라인으로 같은 grid를 쓴다. */}
      {cmdHelpOpen && <CommandHelpPopup onClose={closeCommandHelp} />}
    </div>
  );
}
