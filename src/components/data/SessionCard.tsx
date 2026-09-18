import { T } from '../../tokens';
import { I } from '../icons';
import type { Session } from '../../types';
import { sessionPending, sessionEverUploaded, sessionDirtyCount } from '../../lib/sessionSync';

// ─── session card ────────────────────────────────────────────
export function SessionCard({
  session, expanded, inProgress = false, paused = false, clipBytes, onToggle, onDelete, onCellSave,
}: {
  session: Session;
  expanded: boolean;
  /** v0.48.1 P5 보완(리뷰 F7, 민구 2차 결정) — `active`·`complete`·`stopping` 중 지금 이
   *  세션인가(paused는 별도 프로퍼티로 분리됐다). DataScreen.tsx가 phase를 나눠 계산해 넘긴다.
   *  기본값 false — 호출부가 아직 안 넘겨도 안전. `inProgress`·`paused`는 배타적(DataScreen이
   *  분리된 phase 집합에서 파생하므로 동시에 true일 수 없다). */
  inProgress?: boolean;
  /** v0.48.1 P5 보완(리뷰 F7) — 지금 이 세션이 일시정지 중인가. */
  paused?: boolean;
  /** v0.54.0 H2 — 이 세션의 녹음 클립 바이트 수 합계 (total). */
  clipBytes?: number;
  onToggle: () => void;
  onDelete: () => void;
  onCellSave: (rowIndex: number, colId: string, value: string) => void;
}) {
  const pending = sessionPending(session);
  const fullySynced = pending === 0 && session.completedRows > 0;
  // F9: "uploaded before" is row-based, not the raw syncedRows counter — a session whose uploaded
  // rows were all edited since (now 'dirty', syncedRows=0) must still read as partial, not 미업로드.
  const everUploaded = sessionEverUploaded(session);
  const partial = everUploaded && !fullySynced;
  const dirtyCount = sessionDirtyCount(session);
  const syncIcon = fullySynced
    ? I.cloudCheck(16, T.green)
    : partial
    ? I.cloud(16, T.amber)
    : I.cloudOff(16, T.textMute);
  // Label: fully synced → 업로드완료. Partial with edits-since → "N행 변경" (distinct amber state).
  // Partial without edits (some rows just not uploaded yet) → "synced/completed" progress.
  const syncLabel = fullySynced
    ? '업로드완료'
    : partial
    ? (dirtyCount > 0 ? `${dirtyCount}행 변경` : `${session.syncedRows}/${session.completedRows}`)
    : '미업로드';
  const syncColor = fullySynced ? T.green : partial ? T.amber : T.textMute;
  // v0.44.0 §C7 F24: v0.33.0 #9 '작성중 N' 배지 폐기(민구 08-02) — 되살리려면 §4-b를 먼저 읽어라.
  // 같은 정보(미완료 행 수)를 배지와 행수로 두 번 보이던 중복을 삭제하고, 행수 표기를
  // `완료/전체행`(예: 1/2행)으로 통합한다. 부분입력 세션이 "0행"으로 보이던 #9의 원 문제는
  // 전체 행수가 분모로 항상 보이므로 여전히 생기지 않는다.

  return (
    <div
      style={{
        background: T.card, borderRadius: 12,
        border: `1px solid ${expanded ? 'rgba(41,121,255,0.4)' : T.line}`,
        overflow: 'hidden',
        transition: 'border 200ms',
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        <button
          onClick={onToggle}
          style={{
            flex: 1, border: 'none', background: 'transparent',
            padding: '14px 14px',
            display: 'flex', alignItems: 'center', gap: 12,
            cursor: 'pointer', textAlign: 'left', color: 'inherit', minHeight: 56,
            minWidth: 0, overflow: 'hidden',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div
                style={{
                  fontSize: 16, fontWeight: 700, color: T.text,
                  letterSpacing: -0.2,
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                  whiteSpace: 'nowrap',
                }}
              >
                {session.date}
              </div>
              {/* v0.48.0 P5(NEW-6, 민구 제보 08-10) — "지금의 탭에서 진행중이던 세션은 '진행중'
                  이란 표현을 추가해주길 바람." 완료 전 세션도 실시간으로 이 목록에 뜨는데
                  (커밋마다 upsertSession) 카드엔 그게 "지금 그 세션"이라는 표시가 없었다.
                  v0.48.1 P5 보완(F7) — 일시정지 중엔 이 배지 대신 아래 「일시정지」 배지를 쓴다
                  (DataScreen이 넘기는 inProgress/paused가 배타적이라 동시에 안 뜬다). */}
              {inProgress && (
                <span
                  data-testid={`session-inprogress-${session.id}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center',
                    padding: '2px 8px', borderRadius: 999,
                    background: T.blueGlow, border: `1px solid ${T.blue}`,
                    color: T.blue, fontSize: 11, fontWeight: 800,
                    whiteSpace: 'nowrap', flexShrink: 0,
                  }}
                >
                  진행중
                </span>
              )}
              {/* v0.48.1 P5 보완(리뷰 F7, 민구 2차 결정) — 일시정지는 "진행중"과 다른 배지다.
                  색은 T.mono(무채) — VoiceScreen의 기존 상태색 우선순위(ActiveControlBar 주석
                  "이상치/마이크소실(red) > 일시정지(mono) > 수정(amber) > 입력중(green)")와
                  같은 톤을 재사용해, 이 탭에서도 "일시정지 = amber 아님"이 흔들리지 않는다. */}
              {paused && (
                <span
                  data-testid={`session-paused-${session.id}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center',
                    padding: '2px 8px', borderRadius: 999,
                    background: T.monoGlow, border: `1px solid ${T.mono}`,
                    color: T.mono, fontSize: 11, fontWeight: 800,
                    whiteSpace: 'nowrap', flexShrink: 0,
                  }}
                >
                  일시정지
                </span>
              )}
            </div>
            {session.label && (
              <div style={{ fontSize: 13, color: T.textMute, marginTop: 3 }}>{session.label}</div>
            )}
            <div
              data-testid={`session-clip-bytes-${session.id}`}
              style={{ fontSize: 12, color: T.textMute, marginTop: 3 }}
            >
              {clipBytes !== undefined
                ? `녹음 ${(clipBytes / 1_000_000).toFixed(1)}MB`
                : '녹음 …'}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <div
            style={{
              display: 'flex', alignItems: 'baseline', gap: 4,
              padding: '6px 12px', borderRadius: 10,
              background: 'rgba(255,255,255,0.04)',
            }}
          >
            <span
              style={{
                fontSize: 18, fontWeight: 800, color: T.text,
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              }}
            >
              {session.completedRows}/{session.rows.length}
            </span>
            <span style={{ fontSize: 13, color: T.textMute, fontWeight: 600 }}>행</span>
          </div>
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              color: syncColor, fontSize: 13, fontWeight: 700,
            }}
          >
            {syncIcon}
            <span style={{ fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>{syncLabel}</span>
          </div>
          {/* v0.13.0 R5 — 상세는 인라인 확장이 아니라 팝업으로 연다. chevron은 '열기' 어포던스로
              유지(회전 애니메이션 제거 — 더는 펼침/접힘이 아님). */}
          <div style={{ color: expanded ? T.blue : T.textDim }}>
            {I.chevron(18, expanded ? T.blue : T.textDim)}
          </div>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          style={{
            padding: '0 14px',
            background: 'transparent', border: 'none', borderLeft: `1px solid ${T.line}`,
            color: T.red, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, minWidth: 44,
          }}
          title="세션 삭제"
        >
          {I.trash(18, T.red)}
        </button>
      </div>
    </div>
  );
}
