import { T } from '../../tokens';
import { VOICE_COMMANDS } from '../../lib/voiceCommands';
import { NAV_MIN_HEIGHT } from '../TabBar';
import { VOICE_TYPE } from './heroLayout';

/** I-1: 음성 명령어 전체 목록 팝업. voiceCommands.ts(SSOT)에서 동적 생성 — 기능당 단어 1개.
 *
 *  v0.26.0 화면잘림 대응(민구 07-03 제보 후보): 종전 타이포(pill 21px·설명 20px·gap 15)는 명령어
 *  10개가 90vh를 넘겨 마지막 항목이 화면 중간에서 끊겨 보였다 — 스크롤은 됐지만 스크롤 단서가 없어
 *  사용자에겐 "잘림"으로 보인다. ① 타이포를 압축해 402×874·375×812에서 전 항목이 한 화면에 들어오게
 *  하고, ② 하단 전폭 "닫기" 버튼을 추가한다 — 상단 ✕는 마이크 재연결 배너(role=alert)가 뜨면 가려져
 *  탭이 막히는 것을 스윕에서 실측(배너와 안 겹치는 하단 닫기가 장갑 손가락에도 더 크다). */
export function CommandHelpPopup({ onClose }: { onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        // v0.37.0 리뷰 #4(Codex) — 모달 대역(≥55)으로 올려 나비 위에 뜨게 한다. 종전 z-50은
        //   🔴 **종전 주석의 「TabBar(z-54)」는 틀렸다**(2026-08-31 독립 리뷰 [P2-8] 실측 정정):
        //   `TabBar`는 **z-53**이고 **z-54는 `EdgeGlow`**다. 두 값이 뒤바뀐 채 남아 있었다.
        //   나비 아래라, 도움말 모달이 열린 채 탭을 누르면 모달을 닫지 않고 화면만 바뀌어
        //   onCommandHelpClose가 안 불려 STT가 suspend된 채 방치됐다(다른 UI suspend 표면 — 저장확인·
        //   ManualValueSheet z-55와 동일 대역).
        //   🔴 **종전 주석의 「수동 입력 시트가 bottomInset으로 나비를 남긴다」도 거짓이었다** —
        //   `grep -rn bottomInset src` 실측 결과 **호출부가 0건**이고, 그 시트는 그리드 인라인이라
        //   애초에 오버레이가 아니다. 아래가 그 prop의 **첫 소비자**다(2026-08-31 실측 정정).
        //
        // 🔴 v0.51 P0-1 — **여기서 z 대역이 아니라 「높이」를 양보한다.** 민구 08-31 실기기:
        //   「?」 팝업이 뜨면 **개선요청 탭이 눌리지 않는다.** 탭 자리를 눌러도 이 백드롭이 먹고
        //   (`onClick={onClose}`) 팝업만 닫혔다 — 탭은 눌린 적이 없다. **이번 회차 제보 0건의
        //   원인이 이것이다**(제보 채널 자체가 막혀 있었다).
        //   👉 하단을 나비 높이만큼 비워 **탭바를 남긴다.**
        //   🟢 위 리뷰 #4가 세운 STT 누수 방어는 **0중이 되지 않는다** — 그건 이미 중복이었다:
        //   `App.tsx`의 `requestOverlayClose()`가 탭 전환 **직전에** 열린 오버레이를 닫아
        //   `onCommandHelpClose`→resume을 태운다(독립 축, v0.37.0 리뷰#2). 2중이 1중이 된 것이다.
        //   ⚠️ 반증 신호: 탭은 눌리는데 STT가 정지된 채 남으면 그 경로가 실제로는 안 도는 것이다
        //   (`ui_resume`/`command_help` 로그로 확인 — 없으면 이 한 줄을 `inset:0`으로 되돌린다).
        //   🔴 `--nav-h`는 `TabBar`가 ResizeObserver로 발행한다(`global.css`의 100px는 **첫 페인트
        //   폴백**). 실측 나비는 85px대라 폴백이 남아 있으면 팝업이 15px **더** 잘린다 — 반대로
        //   RO가 아직 안 돈 순간에 값이 없으면 언더슈트한다. 그래서 `NAV_MIN_HEIGHT`(=72)를
        //   **하한**으로 깐다. 큰 쪽으로 틀리면 여백이 남을 뿐이지만 작은 쪽으로 틀리면 나비를 덮는다.
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: `max(var(--nav-h), ${NAV_MIN_HEIGHT}px)`,
        zIndex: 55,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        // v0.33.0 safe-area — fixed 오버레이라 App 셸 패딩 밖. 노치 침범 방지.
        //   Safari 탭에선 var(--sa*)=0 → 기존 12px 유지.
        paddingTop: 'max(12px, var(--sat))',
        // 🔴 v0.51 P0-1 — 하단은 `max(12px, var(--sab))`가 **아니다.** 오버레이 바닥이 이제 나비
        //   위에서 끝나므로 홈 인디케이터에 닿을 일이 없다(그 자리는 나비가 진다). 그대로 두면
        //   `--sab`(≈34px)이 **이중으로** 먹혀 세로를 22px 더 잃는다 — 이 변경의 진짜 대가가
        //   z-index가 아니라 **높이**라서(카드가 `maxHeight:90%`고 그 90%의 분모가 줄었다)
        //   되찾을 수 있는 곳은 되찾는다. 순손실 ≈85px → ≈63px.
        paddingBottom: 12,
        paddingLeft: 'max(12px, var(--sal))',
        paddingRight: 'max(12px, var(--sar))',
      }}
    >
      <div
        data-testid="command-help-popup"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 'min(600px, 96vw)',
          // 🔴 v0.51 P0-1 — **`90%` → `100%`.** P0-1이 오버레이 높이를 나비만큼 깎았고(실측
          //   874→789), `maxHeight:90%`는 그 위에서 **또** 10%를 버린다(688.5px). 그런데 이 90%는
          //   지킬 것이 없다: 오버레이가 이미 `max(12px, var(--sat))`/`12px`/좌우 safe-area 패딩을
          //   두르고 있어서 **콘텐츠 박스 100%가 곧 「안전한 최대 높이」** 다
          //   (`SessionDetailModal`이 v0.33.0에 `90vh → 100%`로 간 것과 **같은 논거**다).
          //   👉 실측 이득 **+76px** — P0-1이 잃은 만큼을 정확히 되찾는다.
          //   오라클: `safe-area.spec.ts`(게이트 안)가 이 팝업의 safe bounds를 계속 잰다.
          maxHeight: '100%',
          display: 'flex', flexDirection: 'column',
          background: T.card, borderRadius: 24, border: `1px solid ${T.lineStrong}`,
          padding: '20px 18px 14px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: VOICE_TYPE.popupTitle, fontWeight: 800, color: T.text }}>음성 명령어</div>
          <button
            onClick={onClose}
            style={{
              width: 40, height: 40, borderRadius: '50%', border: `1px solid ${T.lineStrong}`,
              background: 'transparent', color: T.textDim, fontSize: VOICE_TYPE.popupClose, cursor: 'pointer',
            }}
            title="닫기"
          >
            ✕
          </button>
        </div>
        <div style={{ fontSize: VOICE_TYPE.caption, color: T.textMute, marginBottom: 12, lineHeight: 1.45 }}>
          <span style={{ color: T.amber, fontWeight: 800 }}>도움말 중 입력 정지</span>
          <br />
          명령은 아래 단어로 동작합니다.
        </div>
        {/* 목록만 스크롤 컨테이너 — 넘치는 기기(가로모드·텍스트 확대)에서도 하단 닫기 버튼은 항상 보인다. */}
        <div
          data-testid="cmd-help-list"
          style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 9 }}
        >
          {VOICE_COMMANDS.map((cmd) => (
            <div key={cmd.id} style={{ display: 'flex', alignItems: 'baseline', gap: 12, minWidth: 0 }}>
              <span
                style={{
                  flexShrink: 0, minWidth: 78, textAlign: 'center',
                  padding: '5px 12px', borderRadius: 999,
                  background: T.blueGlow, color: '#fff', fontSize: VOICE_TYPE.bodyText, fontWeight: 800,
                  // v0.22.0(P2 잘림 점검): 명령어 단어가 길어도 pill 안에서 줄바꿈(잘림 0).
                  whiteSpace: 'normal', wordBreak: 'keep-all', overflowWrap: 'anywhere',
                }}
              >
                {cmd.display}
              </span>
              {/* v0.22.0(P2 잘림 점검): 설명이 길어도 flex 자식이 부모를 넘기지 않게 minWidth:0 +
                  줄바꿈 보장. 잘림(ellipsis) 없음 — 전체 표시. */}
              <span style={{ flex: 1, minWidth: 0, fontSize: VOICE_TYPE.bodySm, color: T.textDim, lineHeight: 1.4, wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>{cmd.desc}</span>
            </div>
          ))}
        </div>
        <button
          onClick={onClose}
          data-testid="cmd-help-close"
          style={{
            marginTop: 14, flexShrink: 0, width: '100%', minHeight: 48,
            borderRadius: 14, border: `1px solid ${T.lineStrong}`,
            background: 'transparent', color: T.text, fontSize: VOICE_TYPE.actionLabel, fontWeight: 800, cursor: 'pointer',
          }}
        >
          닫기
        </button>
      </div>
    </div>
  );
}
