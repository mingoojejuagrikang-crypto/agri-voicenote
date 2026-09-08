import { useCallback, useEffect, useRef, useState } from 'react';
import { TabBar, type TabId } from './components/TabBar';
import { UpdateBanner } from './components/UpdateBanner';
import { PortraitGuard } from './components/PortraitGuard';
import { SettingsScreen } from './screens/SettingsScreen';
import { VoiceScreen, type VoiceTelemetryReaders } from './screens/VoiceScreen';
import { DataScreen } from './screens/DataScreen';
import { T } from './tokens';
import { hydrateSessions } from './lib/hydrate';
import {
  hydratePastIndexFallback,
  getCachedIndex,
  getFallbackIndex,
  ensurePastIndex,
  refreshPastIndexAfterLogin,
  resetPastIndexRetries,
  shouldPreparePastIndex,
} from './lib/pastValues';
import { initAutoCapture } from './lib/screenshot';
import { installAudioInterruptionProbe } from './lib/audioInterruption';
import { installFocusInterruptionProbe } from './lib/focusInterruption';
import { captureForFeedback, initFeedbackQueueFlush, submitFeedback } from './lib/feedback';
import { FeedbackModal } from './components/FeedbackModal';
import { logger } from './lib/logger';
import { bgEnterSnapshot, lifecycleSignal, visibilityContext } from './lib/logEvents';
import { useSessionStore, isSessionLive } from './stores/sessionStore';
import { onTokenSettled } from './lib/googleAuth';
import { touchConnection } from './lib/googleConnection';
import { hydrateSttProfiles } from './lib/sttProfileStore';
import { ensureSpeakerId } from './lib/sttSpeaker';

export default function App() {
  const [tab, setTab] = useState<TabId>('settings');
  // v0.33.0 항목11 — 개선요청 모달 상태. closed=닫힘 / capturing=캡처 중(모달 미표시) /
  // {shot}=캡처 종료(성공 Blob 또는 실패 null) + 모달 표시. 캡처를 모달 '표시 전에' 끝내야
  // 스크린샷에 모달 자신이 찍히지 않는다.
  const [feedback, setFeedback] = useState<'closed' | 'capturing' | { shot: Blob | null }>('closed');
  // v0.33.0 항목4 [STT-16] — 음성 세션이 살아 있는 동안(활성/일시정지/완료 대기) VoiceScreen을
  // unmount하지 않기 위한 신호. 조건부 렌더(탭 전환)가 인식기·워치독을 통째로
  // teardown해 STT가 죽고 수동 pause/resume로만 회복되던 근인(07-13 로그 2/2 재현)의 해소 축.
  // v0.48.1 r3 F6 — SSOT는 sessionStore.ts의 `isSessionLive`(허용목록 형태로 통합).
  const sessionLive = useSessionStore((s) => isSessionLive(s.phase));
  const voiceTelemetryRef = useRef<VoiceTelemetryReaders | null>(null);
  const setVoiceTelemetryReaders = useCallback((readers: VoiceTelemetryReaders | null) => {
    voiceTelemetryRef.current = readers;
  }, []);

  // v0.38.0 #1 — 어떤 화면(설정 로그인·데이터 재로그인)에서 토큰이 확정돼도 과거값을 즉시 강제
  // 재조회한다. App 수명에 단 한 번 구독해 화면별 중복 배선을 피하고, pastValues의 single-flight가
  // 같은 로그인 콜백의 중복 호출도 흡수한다. 실제 소비자가 있는 이상치 규칙 설정에서만 전체 시트를
  // 읽는다(기존 부팅/세션 프리페치 게이트와 동일). 10분 캐시 우회는 refresh 함수 내부 계약이다.
  useEffect(() => onTokenSettled(() => {
    if (!shouldPreparePastIndex()) return;
    logger.log({ type: 'app', extra: 'past_index_reprefetch:token_settled' });
    resetPastIndexRetries();
    void refreshPastIndexAfterLogin();
  }), []);

  /* 🔴 v0.46.0 P1(민구 지시 08-06) — 전화·타앱 알람이 오디오 세션을 회수하는 **순간**을 관측한다.
   *  **복구는 하지 않는다**(그게 P1의 안전성이다 — 근거는 `lib/audioInterruption.ts`).
   *  · 앱 수명에 건다: 인터럽션은 세션 밖에서도 일어나므로 `VoiceScreen` 수명에 매달면 놓친다
   *    (민구 제보의 절반이 「앱 나갔다 올 때」축이었다).
   *  · 🔴 **자기 effect로 분리하고 cleanup에서 반드시 해제한다.** 아래 부팅 effect에 얹었더니
   *    **StrictMode의 이중 실행으로 리스너가 2개**가 됐고, 전이 1회에 로그가 2건 찍혔다
   *    (08-06 실측: 오라클 ②가 expected 1 / received 2로 red). 해제 함수를 안 쓰는 것은
   *    dev 전용 잡음이 아니라 **구독 누수** 그 자체다 — 테스트를 느슨하게 하지 말고 여기를 고친다. */
  useEffect(() => installAudioInterruptionProbe(), []);
  // v0.50 [CLIP-SILENT-1] — 포커스 인터럽션(알람 배너 등, `vis`는 그대로 `visible`) 지속시간 프로브.
  // 위 오디오 세션 프로브와 **같은 이유로 자기 effect다**(StrictMode 이중 구독 방지).
  useEffect(() => installFocusInterruptionProbe(), []);

  // Hydrate data store from IndexedDB once on mount. Errors are logged + recorded as
  // `hydrationError` (D-1) so DataScreen can offer a retry instead of a misleading empty state.
  // Auto-sync intentionally disabled — user explicitly picks sessions in DataScreen.
  useEffect(() => {
    // v0.5.0 W7(T-19): 앱 기동 계측 — 다음 로그 분석에서 "앱이 떴는데 세션이 없다"와
    // "앱 자체가 안 떴다"를 구분할 수 있게 한다.
    logger.log({ type: 'app', extra: 'app_boot', meta: { appVersion: logger.device().appVersion } });
    // v0.51 — 「앱 사용」 = 앱을 여는 것. 연결창을 4주 더 민다(시간당 1회 스로틀).
    // 🔴 **기록만 한다 — 토큰 갱신은 시도하지 않는다.** 부팅은 사용자 제스처가 아니라서 여기서
    //    signIn()을 부르면 제스처 밖 팝업 차단으로 되돌아간다(rauth P1). 갱신은 P1(동기화 클릭)·
    //    P2(세션 시작)에서만. 이미 만료된 창은 touchConnection이 스스로 거부한다(check-then-touch).
    touchConnection();
    void hydrateSessions();
    // v0.33.0 항목5 — 과거값 인덱스 영속 폴백 복원(idempotent, 토큰 무관). 부팅 시점에 미리
    // 하이드레이션해 두면 미로그인 세션의 첫 값 커밋부터 폴백 알람이 작동한다.
    // v0.34.0 C9(c) — 폴백 복원 직후 1회: 시트가 설정돼 있는데 인덱스(신선 캐시·영속 폴백)가
    // 전무하면 ensurePastIndex()로 미리 준비한다(민구: "시트가 연결되면 자동으로 작동해야 함").
    // 인증수단(토큰/API key)이 없으면 loadPastIndex가 not_signed_in으로 1회 skip하고 백오프도
    // 걸지 않으므로(shouldRetryLoad) 미로그인 부팅에 무해. 세션 시작·설정 저장 트리거와 중복돼도
    // 캐시/in-flight 가드가 흡수한다.
    void hydratePastIndexFallback().then(() => {
      // v0.34.0 리뷰(Codex+agy 공통 지적) — 부팅 프리페치도 다른 3개 호출부(세션시작 useVoiceSession
      // :2185·설정저장 SettingsScreen:1309·테이블생성 :1304)와 동일하게 anyAnomalyRule로 게이트한다.
      // 이상치 규칙이 없으면 과거값 인덱스는 애초에 쓰이지 않으므로 전체 시트 다운로드가 낭비이고
      // (Codex), 비공개 시트+API key 조합에서 무의미한 403 재시도가 도는 표면도 함께 줄어든다(agy).
      // v0.38.0 리뷰#1 — 조건은 shouldPreparePastIndex 단일 술어(호출부 복붙 금지).
      if (shouldPreparePastIndex() && !getCachedIndex() && !getFallbackIndex()) ensurePastIndex();
    });
    // v0.33.0 항목10-B — 입력화면 자동 캡처 배선(logger tap 단일 지점, idempotent).
    // 토글 off면 tap은 남되 캡처가 스킵된다(스위치는 settingsStore.autoScreenCapture).
    initAutoCapture();
    // v0.33.0 항목11 — 개선요청 큐 자동 재전송 배선(부팅 즉시 1회 + online 복귀 + 토큰 settle).
    initFeedbackQueueFlush();
    // v0.51.1 R6 — 화자 프로필 하이드레이션 + 화자 id 선계산(둘 다 idempotent · 세션 시작이 각각 await/재확인한다).
    void hydrateSttProfiles();
    void ensureSpeakerId();
  }, []);

  // v0.33.0 B(신규) — lifecycle:vis_* 계측(07-13 분석 §3 권고). 화면 끄기/OS 앱 전환/브라우저
  // 백그라운드 전환을 앱 레벨(문서 단위)에서 기록해, "탭 전환 unmount"([STT-16] 인앱)와
  // "visibility 상실"(OS 레벨)을 다음 로그부터 분별한다. VoiceScreen 수명과 무관하게 살아 있고,
  // logger가 세션 컨텍스트를 자동 첨부하므로 세션 중이면 sessionId가 실린다.
  useEffect(() => {
    const awaySignals = new Set<'blur' | 'pagehide' | 'freeze'>();
    const currentVisibility = (): 'hidden' | 'visible' =>
      document.visibilityState === 'hidden' ? 'hidden' : 'visible';
    const logSignal = (
      signal: 'blur' | 'focus' | 'pagehide' | 'pageshow' | 'freeze' | 'resume',
      persisted: 'yes' | 'no' | 'na' = 'na',
    ) => {
      logger.log({
        type: 'app',
        extra: lifecycleSignal({
          signal,
          visibility: currentVisibility(),
          focus: document.hasFocus(),
          persisted,
        }),
      });
    };
    const onBlur = () => {
      awaySignals.add('blur');
      logSignal('blur');
    };
    const onFocus = () => logSignal('focus');
    const onPageHide = (event: PageTransitionEvent) => {
      awaySignals.add('pagehide');
      logSignal('pagehide', event.persisted ? 'yes' : 'no');
    };
    const onPageShow = (event: PageTransitionEvent) =>
      logSignal('pageshow', event.persisted ? 'yes' : 'no');
    const onFreeze = () => {
      awaySignals.add('freeze');
      logSignal('freeze');
    };
    const onResume = () => logSignal('resume');
    const onVis = () => {
      logger.log({
        type: 'app',
        extra: `lifecycle:${document.visibilityState === 'hidden' ? 'vis_hidden' : 'vis_visible'}`,
      });
      logger.log({
        type: 'app',
        extra: visibilityContext({
          state: currentVisibility(),
          focus: document.hasFocus(),
          evidence: awaySignals.size > 0 ? [...awaySignals].join('+') : 'none',
        }),
      });
      if (document.visibilityState === 'hidden') {
        const snapshot = voiceTelemetryRef.current?.getRuntimeSnapshot() ?? {
          rec: 'none' as const,
          track: 'unknown' as const,
          stt: 'none' as const,
        };
        logger.log({
          type: 'app',
          extra: bgEnterSnapshot({
            ...snapshot,
            phase: useSessionStore.getState().phase,
          }),
        });
        // 🔴 v0.43.0 #4 — 스냅샷을 **남긴 뒤에** 중지한다. 순서를 뒤집으면 bg_enter_snapshot이
        //   앱이 방금 만든 상태를 찍어(`stt=suspended`) "진입 순간 무엇이 돌고 있었나"라는 이
        //   이벤트의 존재 이유가 사라진다 — 복귀 스냅샷과 대조할 축을 잃는다.
        //   세션이 안 돌고 있으면 suspendForBackground가 자연 no-op이다(bg_mic:stt=noop).
        // 🔑 v0.45.0 WP-2 [D1] — 세션 중(active·paused·complete)이면 suspendForBackground가
        //   **정지하지 않고 유지한다**(세션-활성 게이트 — bg_mic:stt=kept). 정지는 세션 밖과
        //   장기 임계(10분)에서만. 경계·근거는 lib/backgroundSessionPolicy.ts.
        voiceTelemetryRef.current?.suspendForBackground();
      }
      if (document.visibilityState === 'visible') {
        // v0.51 — 포그라운드 복귀도 「앱 사용」이다(부팅 touch와 같은 계약: 기록만, 갱신 없음,
        // 시간당 1회 스로틀, 죽은 창 부활 금지). 세션 중 GIS 팝업 왕복에서 돌아온 복귀도 여기를
        // 지나지만 스로틀과 aliveness 가드 덕에 무해하다.
        touchConnection();
        // #4 — 캡처 복구 + STT 복원. 복원에 성공하면 인식기의 onStart가 안내를 1회 발화한다.
        voiceTelemetryRef.current?.resumeFromBackground();
        awaySignals.clear();
      }
    };
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('freeze', onFreeze);
    document.addEventListener('resume', onResume);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('freeze', onFreeze);
      document.removeEventListener('resume', onResume);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  // v0.33.0 B-4 — 탭 전환 계측(이전엔 완전 무로깅 → 데이터탭 오터치·[STT-16] 재구성 불가).
  // 기존 command 타입 + extra:'tab:<from>-><to>' 컨벤션(신규 LogEntry type 없음, log-replay 호환).
  const changeTab = (next: TabId) => {
    // v0.33.0 항목11 — '개선요청' 탭 인터셉트(민구 확정: 화면 전환 없는 팝업 방식). setTab하지
    // 않으므로 현재 화면(음성 세션 포함)이 그대로 유지되고, 모달 표시 '전에' 화면을 캡처해
    // 스크린샷에 모달이 찍히지 않는다. 캡처는 best-effort(타임아웃 4s) — 실패해도 모달은 뜬다.
    if (next === 'feedback') {
      if (feedback !== 'closed') return; // 이미 캡처 중/모달 표시 중 — 중복 인터셉트 무시
      logger.log({ type: 'app', extra: `feedback_open:tab=${tab}` });
      // v0.34.0 A2 — 팝업 열림 신호(캡처 시작 시점부터). useVoiceSession 구독이 STT를 일시정지한다
      // (실기기 피드백: "피드백 팝업 작동 시 음성입력은 잠시 일시 정지"). keep-alive([STT-16]) 덕에
      // 어느 탭에서 열어도 세션 중이면 신호가 도달하고, 세션이 없으면 자연 no-op.
      useSessionStore.getState().setUiModalOpen('feedback');
      setFeedback('capturing');
      void captureForFeedback().then((shot) => setFeedback({ shot }));
      return;
    }
    if (next !== tab) {
      // v0.37.0 리뷰#2(민구) — 실제 탭 전환 직전, 음성 화면에 열린 오버레이(수동 입력 시트·？명령어
      //   도움말)를 먼저 닫는다(→ onClose→STT resume). FB-I로 나비가 상시 탭 가능해진 뒤, 시트가 열린
      //   채(STT suspend) 탭을 누르면 onClose 없이 전환돼 STT가 정지된 채 남아 발화가 유실되던 구멍의
      //   차단축. 열린 오버레이가 없으면 ActiveState 구독이 자연 no-op.
      useSessionStore.getState().requestOverlayClose();
      logger.log({ type: 'command', parsed: 'tab', extra: `tab:${tab}->${next}` });
    }
    setTab(next);
  };

  // v0.44.0 §B1 — 항상 풀블리드 셸(isMobile 분기 제거, 민구 §4-a 확정 3번: "외곽 셸은
  // 기기화면 전체 감지, 태블릿/모바일 구분 없음"). 【데스크톱 프리뷰 박스】(375×812 고정,
  // overflow:hidden)는 폐기(§4-b) — 태블릿을 그 박스에 가둬 실기기 제보 5건(F29·F30·F31·
  // F32(나)·F34)을 냈다.
  const phoneStyle: React.CSSProperties = {
    width: '100vw',
    display: 'flex',
    flexDirection: 'column',
    background: T.bg,
    color: T.text,
    // v0.15.0 A1 — standalone(홈화면 설치) safe-area 침범 방지. 브라우저 크롬이 없는
    // standalone에서 콘텐츠가 상태바·노치를 침범하던 문제. 상단/좌우만 셸에서 흡수하고,
    // 하단은 탭바가 max(28px, env(...))로 별도 처리한다(이중 패딩 방지). 일반 Safari 탭에선
    // env(...)가 0이라 무영향. 가로 inset은 노치 가로방향 안전마진(앱은 portrait 고정이지만 방어).
    // v0.33.0 — env() 직접 판독 대신 global.css :root의 safe-area 변수(SSOT) 소비.
    paddingTop: 'var(--sat)',
    paddingLeft: 'var(--sal)',
    paddingRight: 'var(--sar)',
  };

  return (
    <div className="mobile-app-shell" style={phoneStyle}>
      {/* v0.18.0 1f — 비강제 "새 버전" 배너(상단 고정, 모든 탭 공통). 새 SW waiting 시에만 노출. */}
      <UpdateBanner />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {/* v0.44.0 §C7 F25·F26: v0.32.0 B4 결정 폐기(민구 08-02) — 되살리려면 §4-b를 먼저 읽어라.
            생성 완료 후 "입력탭으로 이동" 버튼(onNavigateToInput)을 삭제 — 탭 이동은 TabBar가 소유. */}
        {tab === 'settings' && <SettingsScreen />}
        {/* v0.33.0 항목4 [STT-16] — keep-alive 렌더: 세션이 살아 있으면 다른 탭에서도 VoiceScreen을
            display:none으로 유지(unmount 금지). 인식기·워치독·클립 레코더가
            탭 전환에 인질로 잡히지 않는다(세션 상태 소유권이 컴포넌트 수명에서 분리). 세션이 없으면
            기존대로 unmount(자원 위생). v0.44.0 §C8 F18 — 마운트 prewarm이 폐지돼 이제는 어느 탭
            경로로도 getUserMedia가 미리 뜨지 않는다(권한 요청 = '음성 입력 시작' 클릭). */}
        {(tab === 'voice' || sessionLive) && (
          <div
            style={{
              display: tab === 'voice' ? 'flex' : 'none',
              flexDirection: 'column',
              flex: tab === 'voice' ? 1 : undefined,
              minHeight: 0,
            }}
          >
            <VoiceScreen onTelemetryReadersChange={setVoiceTelemetryReaders} />
          </div>
        )}
        {tab === 'data' && <DataScreen />}
      </div>
      <TabBar tab={tab} setTab={changeTab} />
      {/* v0.33.0 항목11 — 개선요청 모달. 현재 화면 위 오버레이(탭 인터셉트 — setTab 없음).
          전송은 submitFeedback(경량 zip + 이중 업로드/큐)이 담당, 실패도 큐로 수렴하므로
          onSubmit은 항상 resolve → 모달은 완료 후 닫힌다. */}
      {typeof feedback === 'object' && (
        <FeedbackModal
          screenshot={feedback.shot}
          onSubmit={(text) =>
            submitFeedback({
              text,
              screenshot: feedback.shot,
              context: { tab, sessionPhase: useSessionStore.getState().phase },
              getTrackState: voiceTelemetryRef.current?.getTrackState,
            }).then(() => undefined)
          }
          onClose={() => {
            setFeedback('closed');
            // v0.34.0 A2 — 닫힘 신호 → useVoiceSession 구독이 STT 재개(세션 없으면 no-op).
            useSessionStore.getState().setUiModalOpen(null);
          }}
        />
      )}
      {/* v0.38.2 F2 — 가로 회전 안내(fb-01). 오버레이일 뿐 아래 트리는 그대로 살아 있다:
          여기서 언마운트하면 [STT-16] keep-alive가 무너져 회전 한 번에 세션이 죽는다. */}
      <PortraitGuard />
    </div>
  );
}
