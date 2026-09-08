import { T } from '../../tokens';
import { I } from '../icons';
import type { Column } from '../../types';
import { nestedAutoValue, buildCyclingValues, isUserInputColumn } from '../../lib/autoValue';
import { SettingsSummary } from './SettingsSummary';
import { ModalBase } from '../ModalBase';

// ─── table preview modal ───────────────────────────────────────
export function TablePreviewModal({
  columns, totalRows, onClose, onConfirm, onOpenPreview, sessionLabel, regenerating,
}: {
  columns: Column[];
  totalRows: number;
  onClose: () => void;
  /** v0.19.0 W3 — 주어지면 '최종 설정값 확인' 게이트 모드. v0.32.0 B1 — 게이트는 **무스크롤 요약
   *  전용**(테이블 본문 없음): SettingsSummary(카운트 pill + 세션명 + 압축 컬럼 목록)만 보여주고,
   *  푸터를 "취소 / 이대로 생성"으로 바꿔 확인 시에만 onConfirm을 호출한다.
   *  미주입 시(생성 후 '미리보기')는 기존대로 50행 테이블 + 닫기 전용. */
  onConfirm?: () => void;
  /** v0.32.0 B1 — 게이트 안 "생성될 테이블 미리보기" 버튼. 닫기 전용 미리보기를 게이트 위에 연다. */
  onOpenPreview?: () => void;
  sessionLabel?: string;
  regenerating?: boolean;
}) {
  const MAX_PREVIEW = 50;
  const displayRows = Math.min(totalRows, MAX_PREVIEW);
  const colWidths = columns.map((c) =>
    c.type === 'date' ? 110 : c.type === 'text' || c.type === 'name' || c.type === 'options' ? 100 : 70,
  );
  const isGate = !!onConfirm;

  return (
    // 🔴 v0.51 P0-1 (민구 확정 08-31 — Q9 ①) — **「승인 단계일 때만 막는다.」**
    //   이 한 컴포넌트가 두 얼굴을 가진다: `onConfirm`이 있으면 *"이 설정으로 진행할까요?"* 라는
    //   **게이트 카드**이고, 없으면 그냥 **표 미리보기**다. 진행 승인을 요구하는 화면에서 탭이
    //   눌리면 사용자는 승인·거절 중 어느 것도 하지 않고 흐름을 벗어난다 — 그건 막는다.
    //   보기만 하는 쪽은 읽는 중에 탭을 못 누를 이유가 없다. 👉 분기 기준을 `isGate`로 못박는다.
    //   ⚠️ 분류는 **인스턴스의 현재 상태가 아니라 「그 순간 그 모달이 할 수 있는 것」** 으로 한다
    //   (`TypeReviewModal`을 `onApplyAll` 때문에 「막는다」로 재분류한 것과 같은 기준).
    <ModalBase
      onClose={onClose} blur animation="fade-up 200ms ease-out"
      bottomInset={isGate ? undefined : 'var(--nav-h)'}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        data-testid={isGate ? 'gate-card' : 'table-preview-card'}
        style={{
          background: T.card, borderRadius: 18, border: `1px solid ${T.line}`,
          width: '100%', maxWidth: 480, maxHeight: '84vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div
          style={{
            padding: '14px 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: `1px solid ${T.line}`,
          }}
        >
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: T.text }}>
              {isGate ? (regenerating ? '재생성 — 설정값 확인' : '입력 테이블 생성 — 설정값 확인') : '테이블 미리보기'}
            </div>
            <div style={{ fontSize: 12, color: T.textMute, marginTop: 2 }}>
              {/* v0.32.0 B1 — 게이트엔 테이블 본문이 없으므로 '(처음 N행 표시)'를 붙이지 않는다. */}
              {isGate
                ? `총 ${totalRows}행 생성`
                : `총 ${totalRows}행${totalRows > MAX_PREVIEW ? ` (처음 ${MAX_PREVIEW}행 표시)` : ''}`}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="닫기"
            style={{
              width: 36, height: 36, borderRadius: 18,
              border: 'none', background: 'rgba(255,255,255,0.06)',
              color: T.textDim, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {I.close(18, T.textDim)}
          </button>
        </div>

        {/* v0.32.0 설정탭 UX(Vance) B1 — 게이트 = 무스크롤 '설정값 확인'. 카운트 pill·세션명·컬럼
            목록(SettingsSummary — 설정 요약 팝업과 공용)을 내부 스크롤 없이 전부 보여준다(≤12컬럼
            1줄씩 / >12컬럼 2열 그리드로 밀도 전환). 50행 테이블 본문은 게이트에서 제거 — 필요하면
            아래 "생성될 테이블 미리보기"로 닫기 전용 미리보기를 게이트 위에 연다. */}
        {isGate && (
          <div
            style={{
              padding: '12px 16px',
              display: 'flex', flexDirection: 'column', gap: 10,
            }}
          >
            <SettingsSummary columns={columns} totalRows={totalRows} sessionLabel={sessionLabel} />
            {onOpenPreview && (
              <button
                type="button"
                onClick={onOpenPreview}
                style={{
                  minHeight: 44, borderRadius: 12,
                  border: `1px solid ${T.lineStrong}`, background: 'transparent',
                  color: T.textDim, fontSize: 14, fontWeight: 700, letterSpacing: -0.2,
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                {I.table(16, T.textDim)} 생성될 테이블 미리보기
              </button>
            )}
          </div>
        )}

        {!isGate && (
        <div style={{ flex: 1, overflow: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <div style={{ minWidth: 'max-content' }}>
            {/* Header */}
            <div
              style={{
                display: 'flex', position: 'sticky', top: 0, zIndex: 2,
                background: T.card, borderBottom: `1px solid ${T.line}`,
              }}
            >
              <div
                style={{
                  width: 36, padding: '8px 6px', fontSize: 11, fontWeight: 700,
                  color: T.textMute, textAlign: 'center', borderRight: `1px solid ${T.line}`,
                }}
              >
                #
              </div>
              {columns.map((c, ci) => (
                <div
                  key={c.id}
                  style={{
                    width: colWidths[ci], padding: '8px 8px',
                    fontSize: 12, fontWeight: 700, color: c.input === 'voice' ? T.blue : T.textDim,
                    borderRight: `1px solid ${T.line}`,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}
                >
                  {c.name}
                  {c.input === 'voice' && (
                    <span style={{ marginLeft: 4, fontSize: 10, color: T.blue }}>음성</span>
                  )}
                </div>
              ))}
            </div>
            {/* Rows */}
            {Array.from({ length: displayRows }, (_, i) => {
              const rowIndex = i + 1;
              const auto = buildCyclingValues(columns, rowIndex);
              return (
                <div
                  key={rowIndex}
                  style={{ display: 'flex', borderBottom: `1px solid ${T.line}` }}
                >
                  <div
                    style={{
                      width: 36, padding: '7px 6px', fontSize: 12,
                      color: T.textMute, textAlign: 'center',
                      borderRight: `1px solid ${T.line}`,
                      fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontWeight: 700,
                    }}
                  >
                    {rowIndex}
                  </div>
                  {columns.map((c, ci) => {
                    // 🔴 v0.46.0 FB-A — 종전엔 `voice`만 빈칸으로 그리고 **수동(touch)은 자동과
                    //    같은 가지**라 auto 설정 잔재가 표시됐다. 민구가 그걸 보고 *"수동인데 이미
                    //    입력됨"* 을 제보했다. 사람이 넣는 컬럼은 둘 다 미리보기에서 비운다 —
                    //    근거 SSOT는 `autoValue.ts`의 `isUserInputColumn`.
                    const val = isUserInputColumn(c)
                      ? <span style={{ color: T.textMute, opacity: 0.4 }}>—</span>
                      : (nestedAutoValue(columns, c, rowIndex) || auto[c.id] || (
                        <span style={{ color: T.textMute, opacity: 0.3 }}>빈값</span>
                      ));
                    return (
                      <div
                        key={c.id}
                        style={{
                          width: colWidths[ci], padding: '7px 8px',
                          fontSize: 13, fontWeight: 700,
                          // v0.46.0 FB-A — 값 색도 「사람이 넣는 칸」 기준으로 통일한다(위 val과 짝).
                          color: isUserInputColumn(c) ? T.textMute : T.text,
                          borderRight: `1px solid ${T.line}`,
                          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}
                      >
                        {val}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
        )}

        <div style={{ padding: '12px 16px', borderTop: `1px solid ${T.line}` }}>
          {isGate ? (
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={onClose}
                style={{
                  flex: 1, height: 48, borderRadius: 14,
                  border: `1px solid ${T.lineStrong}`, background: 'transparent',
                  color: T.textDim, fontSize: 15, fontWeight: 700, cursor: 'pointer',
                }}
              >
                취소
              </button>
              <button
                onClick={onConfirm}
                style={{
                  flex: 2, height: 48, borderRadius: 14, border: 'none',
                  background: T.green, color: '#06200F',
                  fontSize: 15, fontWeight: 800, cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(57,255,20,0.32)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                {/* v0.32.0 B1 — '생성' → '이대로 생성'(요약을 확인하고 그대로 진행한다는 의미).
                    '생성' 부분문자열은 유지 + 게이트 내 마지막 '생성' 버튼(hasText .last() 헬퍼 호환). */}
                {I.check(18, '#06200F')} {regenerating ? '재생성' : '이대로 생성'}
              </button>
            </div>
          ) : (
            <button
              onClick={onClose}
              style={{
                width: '100%', height: 48, borderRadius: 14, border: 'none',
                background: T.blue, color: '#fff',
                fontSize: 15, fontWeight: 800, cursor: 'pointer',
                boxShadow: `0 4px 14px ${T.blueGlow}`,
              }}
            >
              확인
            </button>
          )}
        </div>
      </div>
    </ModalBase>
  );
}
