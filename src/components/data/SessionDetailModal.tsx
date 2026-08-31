import { T } from '../../tokens';
import { I } from '../icons';
import type { Session } from '../../types';
import { clipPlayer } from '../../lib/clipPlayer';
import { Backdrop } from './Backdrop';
import { FullRowTable } from './FullRowTable';

// ─── session detail modal (v0.13.0 R5) ───────────────────────
/** 세션 상세를 인라인 확장 대신 넓은 센터 모달로 띄운다(민구 요청). 세션이 늘어날 때 인라인 펼침이
 *  리스트 흐름을 잠식해 데이터 화면이 줄어들던 문제 해소. 멀티컬럼 가로스크롤 표라 기존 좁은 모달
 *  (max 360) 대신 near-fullscreen 센터 패널(min(720px,96vw)/90vh)을 쓴다. 표 자체는 FullRowTable
 *  재사용(maxHeight를 모달용으로 키움). 닫을 때 재생 중 클립 정지. */
export function SessionDetailModal({
  session, onClose, onCellSave,
}: {
  session: Session;
  onClose: () => void;
  onCellSave: (rowIndex: number, colId: string, value: string) => void;
}) {
  const close = () => { clipPlayer.stop(); onClose(); };
  return (
    // 🔴 v0.51 P0-1 (민구 확정 08-31 — Q9 ②) — **데이터탭 모달 7종 중 이것만 나비를 남긴다.**
    //   이 모달은 지난 세션의 값을 **읽는** 화면이다(셀 편집은 그 안에서 즉시 저장되므로 «작성
    //   중 이탈로 유실»이 없다 — 나머지 6종의 내보내기·복원·삭제 확인과 갈리는 지점이다).
    //   ⚠️ `Backdrop`의 기본값은 여전히 「덮는다」이고, 이 한 줄이 유일한 예외다.
    <Backdrop onClose={close} bottomInset="var(--nav-h)">
      <div
        data-testid="session-detail-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: T.card, borderRadius: 18, border: `1px solid ${T.line}`,
          // v0.33.0 safe-area — maxHeight를 90vh → 100%로. vh는 safe-area를 모르는 물리 뷰포트
          //   기준이라 아이폰 노치/홈바를 침범했다(유력 원인). 부모 Backdrop이 safe-area 패딩을
          //   가지므로 그 콘텐츠 박스의 100%가 곧 "안전한 최대 높이"다.
          width: '100%', maxWidth: 'min(720px, 96vw)', maxHeight: '100%',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)', overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '16px 18px', borderBottom: `1px solid ${T.line}`, flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 17, fontWeight: 800, color: T.text, letterSpacing: -0.2,
                fontFamily: 'JetBrains Mono, ui-monospace, monospace', whiteSpace: 'nowrap',
              }}
            >
              {session.date}
            </div>
            {session.label && (
              <div style={{ fontSize: 13, color: T.textMute, marginTop: 2 }}>{session.label}</div>
            )}
          </div>
          <div style={{ flex: 1 }} />
          <div
            style={{
              display: 'flex', alignItems: 'baseline', gap: 4,
              padding: '6px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.04)',
            }}
          >
            <span style={{ fontSize: 18, fontWeight: 800, color: T.text, fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>
              {session.completedRows}
            </span>
            <span style={{ fontSize: 13, color: T.textMute, fontWeight: 600 }}>행</span>
          </div>
          <button
            onClick={close}
            title="닫기"
            data-testid="session-detail-close"
            style={{
              flexShrink: 0, width: 40, height: 40, borderRadius: 12,
              border: `1px solid ${T.lineStrong}`, background: 'transparent',
              color: T.textDim, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {I.close(18, T.textDim)}
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <FullRowTable session={session} onCellSave={onCellSave} tableMaxHeight="calc(90vh - 150px)" />
        </div>
      </div>
    </Backdrop>
  );
}
