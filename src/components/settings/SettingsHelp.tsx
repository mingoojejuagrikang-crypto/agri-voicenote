import { T } from '../../tokens';
import type { HelpItem } from './helpCopy';
import { ModalBase } from '../ModalBase';

/** v0.23.0 설정탭#4(Vance) — `?` 도움말 아이콘 버튼. 접근성: 진짜 <button>, aria-label, ≥44px 터치
 *  타깃(장갑 손가락). 탭하면 호출자가 SettingsHelpModal을 연다. */
export function HelpButton({ onOpen, label, testid = 'help-button' }: { onOpen: () => void; label?: string; testid?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
      aria-label={label ?? '도움말 보기'}
      data-testid={testid}
      style={{
        flexShrink: 0,
        width: 44, height: 44, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: `1px solid ${T.lineStrong}`, background: 'transparent',
        color: T.textDim, fontSize: 17, fontWeight: 800, cursor: 'pointer',
        lineHeight: 1,
      }}
      title="도움말"
    >
      ?
    </button>
  );
}

/** v0.23.0 설정탭#4(Vance) — 설명 팝업. 기존 TypeReviewModal 오버레이 패턴 재사용
 *  (position:fixed; inset:0; zIndex:60, 중앙 정렬 박스 + safe-area 패딩). 제목 + HelpItem 목록.
 *  사용자가 `?`를 눌러 명시적으로 열기 때문에(자동 노출 아님) 기존 Playwright 흐름을 막지 않는다.
 *  배경/✕ 탭으로 닫힌다. 긴 문구도 잘리지 않게 박스 내부 스크롤(maxHeight 80% + overflowY). */
export function SettingsHelpModal({
  title, items, onClose, testid = 'settings-help-modal',
}: {
  title: string;
  items: HelpItem[];
  onClose: () => void;
  testid?: string;
}) {
  return (
    // 🔴 v0.51 P0-1(민구 확정 08-31) — **보기 전용 오버레이는 나비를 덮지 않는다.**
    //   이 모달은 액션 prop이 `onClose` 하나뿐이다(= 읽기만 한다). 읽는 중에 탭을 못 누를 이유가
    //   없고, 08-31 실기기에서 그게 **개선요청 채널을 막았다**(입력탭 「?」 팝업 건).
    //   🟢 여기엔 STT 누수 위험이 없다 — `requestOverlayClose` 배선은 입력탭 `ActiveState`만
    //   구독하지만, 설정·데이터탭 도움말은 애초에 음성 인식을 정지시키지 않는다(입력탭과 결정적
    //   차이). 다른 정리 의무도 없다: 이 컴포넌트는 타이머·구독·캡처를 하나도 들지 않는다(실측).
    <ModalBase
      onClose={onClose} testid={testid} role="dialog" ariaModal ariaLabel={title} zIndex={60} pad={24}
      bottomInset="var(--nav-h)"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 380, maxHeight: '80%', overflowY: 'auto',
          background: T.card, borderRadius: 20, border: `1px solid ${T.lineStrong}`, padding: '20px 18px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: T.text }}>{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            style={{
              width: 36, height: 36, borderRadius: '50%', border: `1px solid ${T.lineStrong}`,
              background: 'transparent', color: T.textDim, fontSize: 16, cursor: 'pointer',
              flexShrink: 0,
            }}
            title="닫기"
          >
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {items.map((it) => (
            <div key={it.title} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: T.text, letterSpacing: -0.2 }}>
                {it.title}
              </div>
              <div
                style={{
                  fontSize: 14, color: T.textDim, lineHeight: 1.6,
                  wordBreak: 'keep-all', overflowWrap: 'anywhere',
                }}
              >
                {it.body}
              </div>
            </div>
          ))}
        </div>
      </div>
    </ModalBase>
  );
}
