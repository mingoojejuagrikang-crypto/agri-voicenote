import { useEffect } from 'react';
import { T } from '../../tokens';
import { I } from '../icons';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSessionStore } from '../../stores/sessionStore';
import { isSpeechSupported } from '../../lib/speech';
import { ConnectionStatusCard } from '../ConnectionStatusCard';
import { isSheetSourceBlocked } from '../../lib/sheetConnection';
import { NO_VOICE_COLUMNS_MESSAGE } from '../../lib/voicePrompts';
import { VOICE_TYPE } from './heroLayout';
import { emitReadyProbe } from './readyProbe';

export function ReadyState({ totalRows, onStart }: { totalRows: number; onStart: () => void }) {
  const s = useSettingsStore();
  // 🔴 v0.46.1 WP-1c — 시작 준비 **진행 상태**. `useVoiceSession.start()`가 단계마다 채우고,
  //    어느 경로로 빠져나가도 finally에서 null로 지운다.
  const progress = useSessionStore((st) => st.startProgress);
  // v0.50 [CLIP-SILENT-1] — 직전 세션에서 음성 클립이 저장 실패했으면 그 사실을 남긴다.
  // 값은 정상이라 화면·시트 어디에도 이상이 없다 — 여기가 유일한 사후 표면이다.
  const clipWarning = useSessionStore((st) => st.clipWarning);
  const sessionHealthLine = useSessionStore((st) => st.sessionHealthLine);
  const counting = progress != null;
  // v0.45.0 WP-1① — 시작 전 입·출력 상태 프로브(F15 근원 판정용). 스로틀·계약은 readyProbe.ts.
  useEffect(() => { emitReadyProbe(); }, []);
  const sourceBlocked = isSheetSourceBlocked(s);
  const autoCount = s.columns.filter((c) => c.input === 'auto').length;
  const voiceCount = s.columns.filter((c) => c.input === 'voice').length;
  // 🔴 v0.51.1 B1(제보① 2026-09-02 14:53) — **음성 열 0개면 시작할 수 없다.** `start()`는 종전부터
  //   `vc.length === 0`에서 false를 돌려줬는데 이 조건이 그걸 보지 않아 버튼이 활성이었고, 눌러도
  //   오디오 unlock·gUM보다 앞에서 무음 반환이라 「권한 요청조차 없다」로 보였다(read-fb F1).
  //   버튼을 잠그고 사유를 아래 배너로 말한다 — 같은 문구를 `start()`의 차단 갈래가 `setLastTts`로 쓴다.
  const noVoiceColumns = voiceCount === 0;
  const ready = s.tableGenerated && !sourceBlocked && totalRows > 0 && !noVoiceColumns && isSpeechSupported();
  const ttsHint = !isSpeechSupported()
    ? '이 브라우저는 음성 인식을 지원하지 않습니다 (Chrome 권장)'
    : sourceBlocked
    ? '시트 연결을 다시 확인해 주세요'
    : !s.tableGenerated
    ? '먼저 설정 탭에서 테이블을 생성하세요'
    : noVoiceColumns
    ? NO_VOICE_COLUMNS_MESSAGE
    : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* v0.19.0 W1 — 상단 큰 탭 타이틀("음성 입력") 제거(하단 TabBar 하이라이트와 중복).
          단 ttsHint(기능 안내: 미지원 브라우저 / 테이블 미생성)는 삭제하지 않고 본문 상단
          경고 배너로 이전한다 — 순수 탭 이름만 사라지고 기능 안내는 보존. */}
      <div
        style={{
          // 🔴 `minHeight: 0`이 없으면 flex 자식의 `min-height: auto`가 콘텐츠 자연 높이를
          //    하한으로 잡아 컨테이너가 수축을 거부한다 — 짧은 뷰포트에서 시작 버튼이 아래로
          //    밀려 TabBar에 가려지고 **클릭 자체가 불가능**해진다.
          //    §B1이 셸을 실제 뷰포트에 맞추면서 발현 조건이 노출됐다(B1 산출물 §4).
          //    🔑 B1 산출물은 이걸 "640×600 = 작은 데스크톱 창, 실기기엔 없음"으로 우선순위를
          //    낮췄으나 **틀렸다** — 390×568(실기기 폰 크기, PortraitGuard에 안 걸린다)에서도
          //    재현된다. §C1 probe가 실측으로 반증했다(2026-08-03).
          flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '0 24px', gap: 28,
        }}
      >
        {ttsHint && (
          <div
            role="alert"
            style={{
              width: '100%', maxWidth: 320,
              padding: '12px 16px', borderRadius: 12,
              background: 'rgba(255,234,0,0.10)', border: `1px solid ${T.amber}`,
              color: T.amber, fontSize: VOICE_TYPE.bodySm, fontWeight: 600,
              lineHeight: 1.5, letterSpacing: -0.1, textAlign: 'center',
            }}
          >
            {ttsHint}
          </div>
        )}
        {/* v0.50 [CLIP-SILENT-1] — 직전 세션 클립 결산 경고. `ttsHint`(기능 안내)와 **독립**이고
            둘 다 뜰 수 있다 — 서로 다른 사실이라 하나가 다른 하나를 가리면 안 된다.
            빨강이 아니라 앰버인 이유: 값은 안전하고 잃은 것은 확인 수단이다(진행을 막지 않는다). */}
        {clipWarning && (
          <div
            role="alert"
            data-testid="clip-warning"
            style={{
              width: '100%', maxWidth: 320,
              padding: '12px 16px', borderRadius: 12,
              background: 'rgba(255,234,0,0.10)', border: `1px solid ${T.amber}`,
              color: T.amber, fontSize: VOICE_TYPE.bodySm, fontWeight: 600,
              lineHeight: 1.5, letterSpacing: -0.1, textAlign: 'center',
              wordBreak: 'keep-all', overflowWrap: 'anywhere',
            }}
          >
            {clipWarning}
          </div>
        )}
        {/* v0.53.0 A (민구 Q3 ⓐ) — 직전 세션 건강 결산 요약 한 줄 (clipWarning과 독립, 둘 다 표시 가능) */}
        {sessionHealthLine && (
          <div
            data-testid="session-health-line"
            style={{
              width: '100%', maxWidth: 320,
              color: T.textMute, fontSize: VOICE_TYPE.bodySm,
              lineHeight: 1.5, letterSpacing: -0.1, textAlign: 'center',
              wordBreak: 'keep-all', overflowWrap: 'anywhere',
            }}
          >
            {sessionHealthLine}
          </div>
        )}
        <div style={{ position: 'relative' }}>
          <div
            style={{
              width: 168, height: 168, borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(255,255,255,0.06), rgba(255,255,255,0.02) 70%, transparent)',
              border: `1px solid ${T.line}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {I.micFilled(76, '#3A3E45')}
          </div>
          {[0, 1].map((i) => (
            <div
              key={i}
              style={{
                position: 'absolute', inset: -16 - i * 12, borderRadius: '50%',
                border: `1px solid rgba(255,255,255,${0.05 - i * 0.02})`,
              }}
            />
          ))}
        </div>

        <div
          style={{
            background: T.card, border: `1px solid ${T.line}`, borderRadius: 14,
            padding: '16px 20px',
            display: 'flex', flexDirection: 'column', gap: 12,
            width: '100%', maxWidth: 320,
          }}
        >
          <SummaryRow label="오늘 테이블" value={totalRows} unit="행" />
          <SummaryRow label="자동입력 항목" value={autoCount} unit="개" />
          <SummaryRow label="음성입력 항목" value={voiceCount} unit="개" accent />
        </div>

        {/* v0.33.0 항목5 — 세션 시작 전 연결 3상태(Google/시트/과거값). 07-13 §4처럼 토큰이 만료된
            채 시작해 알람이 침묵하는 상황을 시작 카드에서 미리 보이게 한다(설정탭과 공용 컴포넌트). */}
        <div style={{ width: '100%', maxWidth: 320 }}>
          <ConnectionStatusCard />
        </div>
      </div>

      <div style={{ padding: '0 16px 12px' }}>
        <button
          disabled={!ready || counting}
          onClick={onStart}
          data-testid="voice-start-button"
          style={{
            width: '100%', height: 60, borderRadius: 28, border: 'none',
            background: counting ? T.blue : ready ? T.blue : '#2A2D32',
            color: ready || counting ? '#fff' : T.textMute,
            fontSize: VOICE_TYPE.actionLabel, fontWeight: 800, letterSpacing: -0.3,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            cursor: counting ? 'default' : ready ? 'pointer' : 'not-allowed',
            boxShadow: ready || counting ? `0 8px 28px ${T.blueGlow}` : 'none',
          }}
        >
          {/* 🔴 카운트다운 중에도 **버튼 문구를 바꾸지 않는다.** 종전 시도에서 "N 잠시만요…"로
              바꿨더니 `F18 리뷰 B1`(정착 창 탭 이탈)이 red가 됐다 — 그 오라클이
              `text=음성 입력 시작`으로 ready 화면을 식별하기 때문이다. 진행 표시는 아래
              오버레이가 전담하고, 버튼은 `disabled`로만 잠근다. */}
          {I.mic(22, ready ? '#fff' : T.textMute)} 음성 입력 시작
        </button>
      </div>

      {/* 🔴 v0.46.1 WP-1c(민구 지시 08-07) — 시작 준비 **진행바**.
          원문: *"마이크 입/출력 권한을 허락하고 3초뒤 화면 전환이 아닌, 권한 수락하고 **실제
          마이크/스피커 입출력이 가능한지 확인**하고, 진행 상황을 **바형태로** 보여줘서 사용자가
          바로 전환되지 않는 화면이 **오작동이 아님을 알게** 해줘."*
          🔑 각 칸이 **실제 확인**이다 — 소리 출력(AudioContext) · 마이크(gUM) · 음성 안내(onstart).
             08-07엔 이 셋이 죽어도 세션이 한참 진행된 뒤에야 알 수 있었다(회차 SSOT §2). */}
      {counting && progress && (
        <div
          data-testid="start-countdown-overlay"
          style={{
            position: 'fixed', inset: 0, zIndex: 60,
            background: 'rgba(11,12,14,0.92)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18,
            // 🔴 **포인터를 먹지 않는다.** 이 오버레이는 정보 표시일 뿐 입력 차단이 목적이 아니다.
            //    실측(08-07): `inset:0`이 탭 바까지 덮어 카운트다운 3초 동안 **탭 전환이 막혔고**,
            //    그 때문에 `F18 리뷰 B1`(정착 창 탭 이탈 → 고아 세션 방지)이 red가 됐다 —
            //    클릭이 오버레이에 막혀 언마운트가 일어나지 않았고 세션이 그대로 시작됐다.
            //    🔑 테스트가 잡은 것은 테스트 문제가 아니라 **사용자가 3초간 갇히는 UX 결함**이다.
            //    시작 버튼 자체는 `disabled`로 잠그므로 중복 시작은 그쪽이 막는다.
            pointerEvents: 'none',
          }}
        >
          {/* 진행바 — 채움 비율이 곧 준비 단계다. 폭은 화면에 비례(고정 px 금지). */}
          <div
            data-testid="start-progress-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.step}
            aria-label={progress.label}
            style={{
              width: 'min(78vw, 420px)', height: 14, borderRadius: 999,
              background: 'rgba(255,255,255,0.14)', overflow: 'hidden',
            }}
          >
            <div
              data-testid="start-progress-fill"
              style={{
                width: `${Math.round((progress.step / progress.total) * 100)}%`,
                height: '100%', borderRadius: 999,
                background: progress.warn ? T.amber : T.blue,
                transition: 'width 220ms ease-out',
              }}
            />
          </div>
          <div
            data-testid="start-progress-label"
            style={{ fontSize: VOICE_TYPE.actionLabel, fontWeight: 800, color: '#fff', textAlign: 'center' }}
          >
            {progress.label}
          </div>
          {/* 🔑 실패해도 **시작을 막지 않는다** — 값 입력은 계속 된다. 다만 조용히 넘어가지도 않는다
              (`[CLIP-INIT-SILENT-1]` v0.44.1 처방과 같은 계보: 실패는 화면에 남긴다). */}
          {progress.warn && (
            <div
              data-testid="start-progress-warn"
              role="status"
              style={{
                maxWidth: 'min(84vw, 460px)', textAlign: 'center',
                fontSize: VOICE_TYPE.bodySm, fontWeight: 700, color: T.amber, lineHeight: 1.45,
              }}
            >
              {progress.warn}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryRow({ label, value, unit, accent }: { label: string; value: number; unit?: string; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
      <span style={{ fontSize: VOICE_TYPE.bodySm, color: T.textDim, fontWeight: 600, letterSpacing: -0.1 }}>{label}</span>
      <span
        style={{
          fontSize: VOICE_TYPE.readyValue, fontWeight: 800,
          color: accent ? T.blue : T.text,
          letterSpacing: -0.6,
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        }}
      >
        {value}
        {unit && <span style={{ fontSize: VOICE_TYPE.captionSm, color: T.textDim, fontWeight: 500, marginLeft: 4 }}>{unit}</span>}
      </span>
    </div>
  );
}

// ─── A-hero helpers (v0.17.0) ─────────────────────────────────
// 입력 화면 타이포 계약은 components/voice/heroLayout에서 공유한다. v0.34.0 A4 이후
// ReadyState 자체는 hero 숫자 크기를 소유하지 않는다.
