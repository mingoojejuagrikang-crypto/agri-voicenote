import { create } from 'zustand';
import type { Session } from '../types';

export type VoicePhase = 'ready' | 'active' | 'paused' | 'complete' | 'stopping' | 'done';

/** v0.48.1 r3 F6(리뷰 잔여, claude 재검증) — "세션이 살아 있다"(입력 중이거나 곧 재개될 수
 *  있어 화면·동기화가 특별 취급해야 하는 상태)의 SSOT. App.tsx·useVoiceSession.ts·
 *  sessionSync.ts가 각자 `phase !== 'ready' && phase !== 'done'`을 따로 들고 있었다 —
 *  `'done'`은 어디서도 실제로 set되지 않는 죽은 상태라(전 코드베이스에서 `setPhase(` 호출을
 *  다 훑어도 인자 `'done'`은 0건 — `useVoiceSession.ts`가 쓰는 값은 ready/active/paused/
 *  complete/stopping뿐), 그 부정 조건 자체가 죽은 코드였다. 여기서는 **허용목록**으로 뒤집는다:
 *  앞으로 `VoicePhase`에 새 값이 추가돼도 여기 명시적으로 넣기 전까진 "살아있지 않음"으로 안전하게 처리된다
 *  (부정형은 반대로 fail-open이었다). DataScreen.tsx의 `isLiveProgress`(paused 제외, badge
 *  분리용)·VoiceScreen.tsx의 `sessionLive`(stopping 제외, blackout 안전장치용)는 **의도적으로
 *  더 좁은** 별도 허용목록이라 여기로 통합하지 않는다 — 이 술어는 "ready/done만 아니면 산 것"
 *  이라는 원래의 넓은 의미를 그대로 보존한 것뿐이다. */
export function isSessionLive(phase: VoicePhase): boolean {
  return phase === 'active' || phase === 'paused' || phase === 'complete' || phase === 'stopping';
}

interface SessionState {
  phase: VoicePhase;
  /** Active session id (`sess_<ms>`). Lives in the store — NOT only in a hook ref — so an
   *  in-app unmount/tab-switch during pause cannot lose it (RACE-7 / D-2). Empty when idle. */
  sessionId: string;
  /** Epoch ms the session started. Stored explicitly so persistSession never derives a NaN
   *  from an empty sessionId after the hook ref is lost. 0 when idle. */
  startedAt: number;
  /** Optional session label, mirrored here so it survives remount alongside sessionId. */
  sessionLabel?: string;
  /** 1-indexed current row */
  activeRow: number;
  /** 0-indexed current voice column */
  activeColIdx: number;
  /** value currently shown on screen (recognized or being entered) */
  recognizedValue: string;
  /** v0.36.0 FB#2(Vance) — **미확정(interim) 인식 텍스트**의 표시 전용 필드. handleInterim이 매
   *  interim마다 기록(조기확정·커밋·텔레메트리와 무관한 순수 표시용). 실시간 파형과 함께 "지금
   *  이렇게 들었다(틀렸을 수 있음)"를 원거리에서 보여준다. 확정값(valueBurst)과 시각적으로 명확히
   *  구분(점선·흐림)한다. 커밋(handleFinal 진입)·리셋 시 null로 정리한다. null=표시 안 함. */
  interimValue: string | null;
  /** last TTS message echoed to screen */
  lastTts: string;
  /** I-3: most recent recognized value, shown as a screen-centered "항목 : 값" burst.
   *  `seq` increments per recognition so the UI can re-key and replay the animation. */
  valueBurst: { name: string; value: string; colId?: string; seq: number } | null;
  /** v0.37.0 리뷰#1(Codex High, 민구: 커밋 영수증) — **방금 성공적으로 커밋된 셀**의 영수증.
   *  모든 커밋 경로(음성 최종·수동 시트·이상치 정정)가 커밋 직후 원자적으로 발행한다. 검토(complete)
   *  화면이 "방금 입력한 값"을 이 영수증에서 파생한다(valueBurst는 음성 확인 플래시·이상치 중복 억제
   *  전용이라 수동/정정 마지막 셀에서 stale·거부값을 오표시했다 — REGION-1/review-value). seq는 커밋마다
   *  증가해 fresh-commit(값 표시) vs navigation-revisit(중립 "N행 완료") 판별에 쓴다. valueBurst와
   *  **병렬**로 존재한다(확인 플래시·EdgeGlow 확산·이상치 dedup 계약 불변 — 표시 전용, 로그 이벤트 아님). */
  commitReceipt: { row: number; colId: string; name: string; value: string; seq: number } | null;
  /** v0.9.0 — 이상치 알람 팝업. 알람 발동 시 이전값→현재값과 변화량을 화면에 띄운다(발화만으론
   *  스쳐 지나가 확인이 어렵다는 요청). '확인'/'유지'/새 값 입력 또는 다음 필드 진입 시 해제(null).
   *  changeText = '9.9%'(변동률 트리거) 또는 절대차 '2.2'(증가/감소 트리거).
   *  v0.12.0 AREA2 V2 — 어떤 샘플·행을 보는지 식별할 수 있게 row(1-indexed) + sampleKey(샘플키
   *  플래그 컬럼 합성, 없으면 undefined → 팝업은 '행 N'으로 폴백) + prevDate(직전 회차 ISO 날짜,
   *  과거값이 어느 조사 회차의 것인지 표기)를 동봉한다. */
  anomalyAlert: {
    colName: string;
    prev: string;
    next: string;
    direction: 'up' | 'down';
    changeText: string;
    row: number;
    sampleKey?: string;
    prevDate?: string;
    /** v0.13.0 R2 — 팝업 상태. 'pending'(또는 미지정)=이상치(빨강), 'corrected'=정정 재측정이
     *  정상으로 판명(초록). 정정 응답이 정상이면 같은 알람 객체의 next를 정정값으로 갱신하고
     *  status='corrected'로만 바꿔, 옛 이상치 값이 남아 echo TTS와 어긋나던 불일치를 없앤다. */
    status?: 'pending' | 'corrected';
    /** v0.20.0 입력탭#6 — 어떤 규칙이 발동했는지. 'trend'=추세 방향 알람(increase/decrease),
     *  'range'=변동률 % 임계(pctThreshold) 알람. Mack이 useVoiceSession.ts에서 trigger로 채운다.
     *  AnomalyAlertPopup(Vance)이 이 값으로 "추세 알람 …" vs "범위 알람 ±NN%" 표시를 가른다.
     *  미지정이면 팝업은 추세 형태로 폴백한다(기존 동작 보존). */
    kind?: 'trend' | 'range';
    /** v0.20.0 — range 알람일 때 임계 변동률(%). kind==='range'에서 팝업이 "±NN%"로 표시한다. */
    threshold?: number;
    /** v0.33.0 항목7 — 이 알람이 응답 대기(trendConfirm) 중인지. true=음성('확인'/'수정')·터치 버튼
     *  둘 다 유효(팝업이 [확인][수정] 버튼을 그린다). false/미지정=정보성 팝업(수동 입력 커밋의
     *  이상치 — 민구 확정: 시각+비프만, 확인 루프 없음 → 버튼 미표시). */
    awaitingResponse?: boolean;
    /** v0.34.0 A1 — 수동 입력(ManualValueSheet) 커밋 이상치의 **진행 보류** 팝업. true면 echo/advance
     *  가 보류된 상태(포인터는 커밋한 칩에 유지)로, [확인][수정] 버튼이 음성 trendConfirm 콜백 대신
     *  useVoiceSession.confirmManualAnomaly/modifyManualAnomaly로 라우팅된다(VoiceScreen이 분기).
     *  음성 확인 루프(trendConfirm)는 무장하지 않는다 — 민구 기존 결정 유지. */
    manualHold?: boolean;
    /** v0.34.0 A1 — 알람 대상 컬럼 id. manualHold의 [수정]이 해당 셀 ManualValueSheet를 재오픈할 때
     *  VoiceScreen이 컬럼을 되찾는 키(colName은 표시용이라 조회 키로 부적합). */
    colId?: string;
  } | null;
  /** v0.12.0 AREA2 V4 — '수정 값' 인디케이터. 수정 재안내(announceField isModify) 중 어떤 항목을
   *  다시 말해야 하는지 화면에 파란 pill로 띄운다. 일반 안내로 진입하면 null로 해제. anomalyAlert가
   *  떠 있을 땐 렌더하지 않는다(중앙 팝업과 겹침 방지 — VoiceScreen에서 상호배타 처리). */
  modifyIndicator: { name: string; colId: string } | null;
  /** v0.37.0 리뷰#2(Critical, 민구: 탭 탭 = 시트 닫고 재개) — 탭 전환 시 열린 오버레이(수동 입력
   *  시트·？명령어 도움말)를 닫으라는 신호(단조 증가 nonce). App.tsx changeTab이 실제 탭 전환 직전
   *  1 증가시키고, ActiveState(세션 내내 마운트)의 구독 effect가 증가를 감지해 시트/도움말을 닫는다
   *  (→ onClose→resumeRecognitionForUi로 STT 재개). FB-I가 나비를 상시 탭 가능하게 만든 뒤, 시트가
   *  열린(STT suspend) 채 탭을 누르면 onClose 없이 전환돼 STT가 정지된 채 남아 발화가 유실되던
   *  데이터무결성 구멍의 차단축. 단일 작성자=App.tsx, 단일 소비자=ActiveState. */
  overlayCloseSeq: number;
  /** v0.34.0 A2 — 전역 UI 모달 열림 신호. 'feedback'=개선요청 팝업(App.tsx 탭 인터셉트) 열림.
   *  useVoiceSession의 구독 effect가 열림에 suspendRecognitionForUi('feedback_modal'), 닫힘에
   *  resumeRecognitionForUi를 배선한다(세션 없으면 자연 no-op — 단일 배선·기능 격리).
   *  단일 작성자 = App.tsx(모달 소유자)뿐이므로 resetAll이 건드리지 않는다(세션 수명과 무관). */
  uiModalOpen: 'feedback' | null;
  /** v0.46.0 WP-F (제보 F13② · 민구 R2) — **검은 화면 모드.** 화면만 끄고 **음성 세션은 계속 돈다.**
   *
   *  🔴 **이 주석은 낡아 있었다**(t9 조사 §1-2, 08-08 실측으로 반증): *"진입은 조절판 버튼 + …"*
   *  이라고 적혀 있었지만 **조절판에는 그런 버튼이 없었다** — `setBlackout(true)` 호출자는 전
   *  코드베이스에서 음성 `screenOff` 하나뿐이었다. 문서가 아니라 **주석이 틀린 쪽**이었고,
   *  그 상태로 세 회차가 「버튼을 옮기자」는 설계를 논의했다. 실측으로 정정한다.
   *
   *  **진입(v0.47.0 W7 기준 2경로):** ①음성 `screenOff`('화면' — `useVoiceSession`, `src:voice`)
   *  ②**히어로(중앙) 홀드**(`HeroHoldToBlackout`, `src:hold`). 두 경로는 같은 `screen_off`
   *  이벤트를 내고 `extra`의 `src:`로만 갈린다.
   *  🔴 **홀드 길이는 여기 적지 않는다** — 08-08 3초 → **08-31 민구 재확정 2초**(접촉 끊김 노출
   *  창 축소). 값과 근거의 SSOT는 `HeroHoldToBlackout`의 `HOLD_TO_BLACKOUT_MS` 주석이다.
   *  **해제:** 검은 화면 **중앙 영역 2초 홀드**(`BlackoutOverlay` — 08-08 짧은 탭을 민구가
   *  08-09에 대체했다) + 갇힘 방지용 키보드 Enter/Space.
   *  ⚠️ 끄기 2초와 켜기 2초는 **값이 같을 뿐 다른 상수다**(각 파일의 주석 참조).
   *  🔴 **여기(메모리 전용 스토어)에 두는 것이 계약이다.** `settingsStore`(persist)에 두면 앱을
   *  껐다 켜도 검은 화면이 남아 **사용자가 복구 방법을 모르는 상태로 갇힌다.** 새로고침 = 해제.
   *  🔑 `resetAll`에도 넣는다 — 세션이 끝났는데 화면이 검으면 당황한다(uiModalOpen과 다른 판단:
   *  그쪽은 세션 수명과 무관한 전역 모달이고, 이쪽은 세션 중 배터리 절약 수단이다). */
  blackout: boolean;
  /** 🔴 v0.51 [CLIP-MUTED-SPAN-1] — **지금 마이크를 OS가 가져갔는가**(트랙 `muted`).
   *
   *  통화·Siri·라우트 변경 동안 UA가 미디어 전달을 멈춘 상태다. 이 값이 `true`면 **녹음은
   *  이름뿐이고 소리는 들어오지 않는다** — 그런데 종전 절전 화면은 그 순간에도
   *  「음성 입력은 계속됩니다」를 띄우고 있었다(2026-09-01 A축: 화면·소리·집계 셋 다 거짓).
   *
   *  🔴 **작성자는 `useMicInterruptionNotice` 하나다**(`micInterruption` 구독의 유일한 소비자).
   *  `resetAll`에서 **건드리지 않는다** — 이건 세션 상태가 아니라 **물리적 사실**이라 세션이
   *  끝난다고 마이크가 돌아오지 않는다. 실제 해제는 트랙 `unmute` 또는 레코더 `dispose`가
   *  흘려주고, 그 경로가 곧 유일한 진실이다(두 곳에서 쓰면 화면이 사실과 갈린다).
   *  🔑 `blackout`과 같이 **메모리 전용**이다 — 영속되면 재시작 후에도 유령 경고가 남는다. */
  micInterrupted: boolean;
  /** v0.51.1 [CLIP-MUTED-SPAN-1] G2 — **히어로 홀드 문구(`HeroHoldToBlackout`)가 지금 떠 있는가.**
   *  관찰 전용이다. 작성자는 그 컴포넌트 하나(`useEffect([holding])` 미러), 소비자는
   *  `useMicInterruptionNotice`의 `mic_interrupt_ui:…,hold=` 계측 하나다 — 실기기 판정 ⓑ(문구가
   *  실제로 바뀌었나)를 로그로 닫으려면 전이 순간 그 문구가 보이고 있었는지가 필요하다.
   *  `blackout`과 같이 **메모리 전용**이고 `resetAll`에서 건드리지 않는다(포인터 상태는 세션 상태가
   *  아니다 — 컴포넌트 cleanup이 false로 되돌린다). */
  heroHolding: boolean;
  /** 🔴 v0.46.1 WP-1c(민구 지시 08-07) — 세션 시작 **준비 진행 상태**. `null`=미표시.
   *
   *  민구 원문(2차, 종전 3→2→1 카운트다운을 대체): *"마이크 입/출력 권한을 허락하고 **3초뒤 화면
   *  전환이 아닌**, 권한 수락하고 **실제 마이크/스피커 입출력이 가능한지 확인**하고, 진행 상황을
   *  **바형태로** 보여줘서 사용자가 바로 전환되지 않는 화면이 **오작동이 아님을 알게** 해줘."*
   *
   *  🔑 **고정 3초 대기와 근본적으로 다르다.** 각 단계가 **실제 확인**이다:
   *  소리 출력(`AudioContext.state`) · 마이크 획득(`gUM`) · 음성 안내(`warmupTts`의 `onstart`).
   *  08-07 실기기에서 세션 초반 2분간 TTS·비프가 함께 죽었는데(회차 SSOT §2) 사용자는 그것을
   *  **세션이 한참 진행된 뒤에야** 알았다. 이제 시작 화면에서 그 자리에 뜬다.
   *
   *  - `step`/`total` 진행바 채움 비율
   *  - `label`  지금 무엇을 하는 중인지(사용자가 읽는 문장)
   *  - `warn`   확인에 실패한 축(있어도 시작은 막지 않는다 — 값 입력은 계속 가능하다)
   *
   *  🔴 **메모리 전용이다**(`blackout`과 같은 계약) — 영속되면 재시작 시 유령 진행바가 남는다. */
  startProgress: { step: number; total: number; label: string; warn?: string } | null;
  /** v0.35.0 R3-FIX-2(리뷰 라운드3, Codex High·데이터무결성) — **최종 저장(stop) 실패** 상태.
   *  persistSession()이 false(IDB 쓰기 실패: 용량부족·DB 연결 종료·트랜잭션 실패)를 반환하면
   *  stop()이 phase를 'ready'로 내리지 **않고** 이 플래그를 세운다. VoiceScreen이 이 값으로 종료
   *  실패 배너(재시도 버튼)를 띄운다. null=정상.
   *
   *  왜 phase를 안 내리나: 'ready'가 되면 '음성 입력 시작' 버튼이 떠 사용자가 새 세션을 시작할 수
   *  있고, 그 start()의 resetAll이 **미저장 값·클립 포인터를 메모리에서 지워** 복구 기회가 영원히
   *  사라진다. v0.34.0 "durable 실패를 삼키지 않는다" 원칙(persistSession 성공 반환·persist_check)과
   *  같은 계약 — 실패는 화면에 남긴다.
   *
   *  retrying=재시도 IDB 쓰기 진행 중(버튼 잠금). 성공하면 stop()이 null로 지우고 ready로 전환. */
  persistError: { retrying: boolean } | null;
  /** v0.50 [CLIP-SILENT-1] — **직전 세션의 음성 클립 결산 경고.** null=경고 없음.
   *
   *  2026-08-19 실기기 사고: 값은 시트까지 정상으로 갔는데 음성 클립만 전량(60/60)·부분(9/60)
   *  소실됐고, **세션이 끝난 뒤 업로드 탭을 열어보기 전까지 아무도 몰랐다.** 값이 멀쩡하니
   *  화면에도 시트에도 이상이 없었기 때문이다. 종료 화면에 이 한 줄을 남겨 그 침묵을 깬다.
   *  🔴 `persistError`와 달리 **진행을 막지 않는다** — 이미 끝난 세션의 사후 통지이고, 잃은 것은
   *  값이 아니라 「값을 확인할 수단」이다(막을 대상이 없다). 다음 세션 start의 resetAll이 지운다. */
  clipWarning: string | null;
  /** v0.23.0 입력탭#2(재질문 사유, Mack) — 직전 음성 입력이 왜 재질문됐는지. 'low_confidence'=신뢰도가
   *  허용범위 미만, 'parse_failed'=인식은 됐으나 숫자/값으로 파싱 불가(항목명·잡음 거부 포함). null=정상.
   *  VoiceScreen(Vance)의 ReaskCue가 이 값으로 "소리가 불확실" vs "숫자로 인식 실패"를 구분 표시한다.
   *  성공 커밋·다음 필드 진입 시 null로 리셋한다(큐가 남지 않도록). 상단 인식률 %와는 독립. */
  reaskReason: 'low_confidence' | 'parse_failed' | null;
  /** v0.36.0 FB#4(Vance) — 소수점 유실 재질문의 **정수부**. null이 아니면 ReaskCue가 일반 사유 문구
   *  대신 소수 재질문 프롬프트(TTS와 글자 일치, voicePrompts.decimalReaskPrompt)를 표시한다. 소수
   *  재질문 진입 시 정수부로 설정, 그 외 모든 재질문·성공 커밋·리셋에서 null(setReaskReason이 함께
   *  정리 → 스테일 방지). 단일 작성 경로 = setDecimalReason. */
  reaskDecimalWhole: string | null;
  /** 와이어프레임 §[4] complete — **끝에 도달했는지**(빈 행 안내를 포함한 announceEndReached).
   *  phase 'complete'는 두 가지를 겸한다: ① 완료 행 **검토 대기**(enterReviewWait — '이전'/점프로 이미
   *  끝난 행에 착지) ② **끝 도달**(announceEndReached). 화면은 이 둘을 다르게 그려야 한다 —
   *  ①은 와이어프레임 [1] active 레이아웃 그대로(hero가 ✓+방금값을 보인다, v035-hero-confirm 동작
   *  계약) 이고, ②만 complete(UI-c: 시각 상태어 없는 `X / N` + 종료 버튼)다. ref(awaitingFieldRef)로는 리렌더가
   *  일어나지 않으므로 화면이 읽을 수 있는 store 상태로 둔다.
   *  단일 작성 경로 = useVoiceSession(announceEndReached=true / enterReviewWait=false) + setPhase가
   *  'complete'를 벗어날 때 자동 해제. */
  endReached: boolean;
  /** [EXIT-PERSIST-1] 이번 세션에서 끝 도달 안내를 한 번이라도 거쳤는지.
   *  endReached는 완료 행 검토에서 false로 내려가지만, 종료 수단은 세션 경계까지 남아야 한다.
   *  setEndReached(true)만 이 래치를 세우고 false/setPhase는 건드리지 않는다. */
  endReachedOnce: boolean;
  /** All row values, keyed by row index → col id → value */
  allRowValues: Record<number, Record<string, string>>;
  /** Row indices that have been fully completed */
  completedRows: number[];
  /** v0.5.0 NAV-1: rows the user skipped with '다음' while incomplete. Persisted as
   *  complete:false placeholder rows so the 데이터탭 shows the gap; removed when the
   *  row is later completed. */
  skippedRows: number[];
  /** When user jumps to another row (modify/chip), where to return after that row finishes.
   *  🔴 v0.47.0-r3(이중 콜드 리뷰 08-09, codex f3) — 단일 좌표 → **스택**. 복귀 예약이 이미 걸린
   *  상태에서 P1 교차행 직접수정 알람이 또 이동하면 예약이 2건 중첩되는데, 단일 returnRow로는
   *  안쪽 출발점을 표현할 수 없어 확인 후 바깥 예약 행으로 건너뛰었다(오귀속 위험).
   *  의미론: **최상단이 다음 복귀처**(LIFO). 깊이 ≤1에서는 종전 단일 좌표와 동작이 같다.
   *  ⚠️ 이 스토어는 메모리 전용이다(persist 미들웨어 없음) — 스택은 직렬화 경로에 닿지 않는다. */
  returnStack: Array<{ row: number; colIdx: number | null }>;

  setPhase: (p: VoicePhase) => void;
  setEndReached: (v: boolean) => void;
  setSessionMeta: (meta: { sessionId: string; startedAt: number; label?: string }) => void;
  setRecognized: (v: string) => void;
  setInterimValue: (v: string | null) => void;
  setLastTts: (v: string) => void;
  /** v0.45.0 UI③ — colId는 칩 V 마크(방금 음성 확정된 칩)의 판별 축. 음성 커밋 경로만 발행. */
  pushValueBurst: (name: string, value: string, colId?: string) => void;
  /** v0.37.0 리뷰#1 — 커밋 영수증 발행(seq 자동 증가). 모든 성공 커밋 경로가 커밋 직후 호출한다. */
  pushCommitReceipt: (row: number, colId: string, name: string, value: string) => void;
  setAnomalyAlert: (a: SessionState['anomalyAlert']) => void;
  setUiModalOpen: (m: SessionState['uiModalOpen']) => void;
  setBlackout: (b: boolean) => void;
  /** v0.51 [CLIP-MUTED-SPAN-1] — 트랙 muted 구독의 단일 작성자만 호출한다(위 필드 주석). */
  setMicInterrupted: (v: boolean) => void;
  /** v0.51.1 G2 — `HeroHoldToBlackout`만 호출한다(위 필드 주석). */
  setHeroHolding: (v: boolean) => void;
  setStartProgress: (p: { step: number; total: number; label: string; warn?: string } | null) => void;
  /** v0.37.0 리뷰#2 — 열린 오버레이 닫기 요청(탭 전환 직전). nonce를 1 증가시킨다. */
  requestOverlayClose: () => void;
  setPersistError: (e: SessionState['persistError']) => void;
  setClipWarning: (w: SessionState['clipWarning']) => void;
  setModifyIndicator: (m: SessionState['modifyIndicator']) => void;
  setReaskReason: (r: SessionState['reaskReason']) => void;
  /** v0.36.0 FB#4 — 소수 재질문 진입: reason='parse_failed' + 정수부를 함께 세운다(원자적). */
  /** 🔴 v0.49 r4 M3 — `reason`이 붙었다. 소수부 타깃 재질문 문맥에서 거절되는 사유는 파싱 실패만이
   *  아니다(저신뢰 거절도 같은 문맥에서 난다) — 사유를 'parse_failed'로 못박으면 `data-reason`이
   *  실제와 갈린다. 화면 **문구**는 정수부가 실려 있으면 어느 사유든 소수 프롬프트로 같다. */
  setDecimalReason: (whole: string, reason?: 'low_confidence' | 'parse_failed') => void;
  setActiveCol: (i: number) => void;
  setActiveRow: (r: number) => void;
  setRowValue: (row: number, colId: string, v: string) => void;
  getRowValues: (row: number) => Record<string, string>;
  markRowComplete: (row: number) => void;
  markRowIncomplete: (row: number) => void;
  markRowSkipped: (row: number) => void;
  isRowComplete: (row: number) => boolean;
  /** 종전 단일 좌표 의미 그대로 — null이면 **전체 클리어**, 값이면 스택을 [단일 항목]으로 **교체**.
   *  jumpToRow(덮어쓰기)·goNextRow(해제)의 기존 계약을 바꾸지 않기 위한 유지 축이다. */
  setReturn: (row: number | null, colIdx: number | null) => void;
  /** P1 교차행 직접수정 알람 전용 — 기존 예약을 덮지도 버리지도 않고 **위에 쌓는다**(중첩). */
  pushReturn: (row: number, colIdx: number | null) => void;
  /** advance() 소비부 전용 — 최상단 1건만 내린다(나머지 예약은 다음 행 완료가 소비). */
  popReturn: () => void;
  resetAll: () => void;
  restorePendingValidation: (session: Session) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  phase: 'ready',
  sessionId: '',
  startedAt: 0,
  sessionLabel: undefined,
  activeRow: 1,
  activeColIdx: 0,
  recognizedValue: '',
  interimValue: null,
  lastTts: '',
  valueBurst: null,
  commitReceipt: null,
  anomalyAlert: null,
  overlayCloseSeq: 0,
  uiModalOpen: null,
  blackout: false,
  micInterrupted: false,
  heroHolding: false,
  startProgress: null,
  persistError: null,
  clipWarning: null,
  modifyIndicator: null,
  reaskReason: null,
  reaskDecimalWhole: null,
  endReached: false,
  endReachedOnce: false,
  allRowValues: {},
  completedRows: [],
  skippedRows: [],
  returnStack: [],

  // phase가 'complete'를 벗어나면 endReached는 의미를 잃는다 — 단일 지점에서 자동 해제해
  // 호출부마다 짝 맞춰 끄는 실수를 구조적으로 없앤다(스테일 '완료' 화면 방지).
  setPhase: (phase) => set(phase === 'complete' ? { phase } : { phase, endReached: false }),
  // [EXIT-PERSIST-1] false는 현재 완료 화면만 내리고 세션 래치는 보존한다.
  setEndReached: (endReached) =>
    set(endReached ? { endReached: true, endReachedOnce: true } : { endReached: false }),
  setSessionMeta: ({ sessionId, startedAt, label }) =>
    set({ sessionId, startedAt, sessionLabel: label }),
  setRecognized: (recognizedValue) => set({ recognizedValue }),
  setInterimValue: (interimValue) => set({ interimValue }),
  setLastTts: (lastTts) => set({ lastTts }),
  pushValueBurst: (name, value, colId) =>
    set((s) => ({ valueBurst: { name, value, colId, seq: (s.valueBurst?.seq ?? 0) + 1 } })),
  pushCommitReceipt: (row, colId, name, value) =>
    set((s) => ({ commitReceipt: { row, colId, name, value, seq: (s.commitReceipt?.seq ?? 0) + 1 } })),
  // v0.36.0 리뷰 라운드1(Codex+Flash, 수용) — 알람이 **서는** 순간 미확정 interim 표시를 함께
  //   정리한다(모든 알람 경로의 단일 지점). 알람 대기 중 final이 안 오면 이전 발화 찌꺼기가 재개
  //   화면에 현재 값처럼 남던 경로의 차단축. 표시 전용 필드라 커밋/텔레메트리 계약 무해.
  setAnomalyAlert: (anomalyAlert) =>
    set(anomalyAlert ? { anomalyAlert, interimValue: null } : { anomalyAlert }),
  setUiModalOpen: (uiModalOpen) => set({ uiModalOpen }),
  setBlackout: (blackout) => set({ blackout }),
  setMicInterrupted: (micInterrupted) => set({ micInterrupted }),
  setHeroHolding: (heroHolding) => set({ heroHolding }),
  setStartProgress: (startProgress) => set({ startProgress }),
  requestOverlayClose: () => set((s) => ({ overlayCloseSeq: s.overlayCloseSeq + 1 })),
  setPersistError: (persistError) => set({ persistError }),
  setClipWarning: (clipWarning) => set({ clipWarning }),
  setModifyIndicator: (modifyIndicator) => set({ modifyIndicator }),
  // reaskReason의 모든 일반 갱신은 소수 정수부를 함께 정리한다(스테일 방지). 소수 재질문만
  //   setDecimalReason이 이 뒤에 정수부를 다시 세운다(호출 순서: 일반 setReaskReason → setDecimalReason).
  setReaskReason: (reaskReason) => set({ reaskReason, reaskDecimalWhole: null }),
  setDecimalReason: (whole, reason = 'parse_failed') => set({ reaskReason: reason, reaskDecimalWhole: whole }),
  setActiveCol: (activeColIdx) => set({ activeColIdx }),
  setActiveRow: (activeRow) => set({ activeRow }),

  setRowValue: (row, colId, v) =>
    set((s) => {
      const cur = s.allRowValues[row] || {};
      return {
        allRowValues: { ...s.allRowValues, [row]: { ...cur, [colId]: v } },
      };
    }),

  getRowValues: (row) => get().allRowValues[row] || {},

  markRowComplete: (row) =>
    set((s) => {
      // 완료되면 skip 표시는 해제 (placeholder가 실데이터로 채워짐).
      const skippedRows = s.skippedRows.includes(row)
        ? s.skippedRows.filter((r) => r !== row)
        : s.skippedRows;
      if (s.completedRows.includes(row)) return { skippedRows };
      return {
        completedRows: [...s.completedRows, row].sort((a, b) => a - b),
        skippedRows,
      };
    }),

  markRowIncomplete: (row) =>
    set((s) => ({ completedRows: s.completedRows.filter((r) => r !== row) })),

  markRowSkipped: (row) =>
    set((s) => {
      if (s.completedRows.includes(row) || s.skippedRows.includes(row)) return s;
      return { skippedRows: [...s.skippedRows, row].sort((a, b) => a - b) };
    }),

  isRowComplete: (row) => get().completedRows.includes(row),

  setReturn: (row, colIdx) =>
    set({ returnStack: row == null ? [] : [{ row, colIdx }] }),
  pushReturn: (row, colIdx) =>
    set((s) => ({ returnStack: [...s.returnStack, { row, colIdx }] })),
  popReturn: () => set((s) => ({ returnStack: s.returnStack.slice(0, -1) })),

  restorePendingValidation: (session) => {
    const pending = session.pendingValidation;
    if (!pending) return;
    // 새로고침 뒤 후보값과 팝업을 함께 복구한다. phase='active'여도 실제 STT 컨트롤러는 아직 없지만,
    // manualHold 중앙 게이트가 모든 입력/이동을 막으므로 사용자는 [확인]/[수정]으로만 재개할 수 있다.
    const allRowValues = Object.fromEntries(session.rows.map((r) => [r.index, { ...r.values }]));
    set({
      phase: 'active',
      sessionId: session.id,
      startedAt: session.startedAt,
      sessionLabel: session.label,
      activeRow: pending.row,
      activeColIdx: pending.activeColIdx,
      recognizedValue: pending.candidateValue,
      allRowValues,
      completedRows: session.rows.filter((r) => r.complete).map((r) => r.index),
      skippedRows: session.rows.filter((r) => !r.complete).map((r) => r.index),
      anomalyAlert: pending.alert,
      endReached: false,
      endReachedOnce: false,
    });
  },

  resetAll: () =>
    set({
      phase: 'ready',
      sessionId: '',
      startedAt: 0,
      sessionLabel: undefined,
      activeRow: 1,
      activeColIdx: 0,
      recognizedValue: '',
      interimValue: null,
      lastTts: '',
      valueBurst: null,
      commitReceipt: null,
      anomalyAlert: null,
      // v0.35.0 R3-FIX-2 — persistError는 세션 수명에 속하므로 여기서 지운다. 단 이 경로에 도달하려면
      //   phase가 'ready'여야 하고(start 버튼), 저장 실패 중엔 phase가 'ready'가 되지 않으므로
      //   실패 상태를 모르고 덮어쓰는 일은 없다(uiModalOpen과 달리 단일 작성자 = useVoiceSession).
      persistError: null,
      // v0.50 [CLIP-SILENT-1] — 직전 세션 경고는 **새 세션이 시작될 때** 사라진다(사후 통지의 수명).
      clipWarning: null,
      modifyIndicator: null,
      reaskReason: null,
      reaskDecimalWhole: null,
      endReached: false,
      endReachedOnce: false,
      allRowValues: {},
      completedRows: [],
      skippedRows: [],
      returnStack: [],
      // WP-F — 세션이 끝나면 검은 화면도 함께 풀린다(위 blackout 주석).
      blackout: false,
    }),
}));

/** 이상치 알람 객체(스토어 SSOT의 파생 타입) — 표시 컴포넌트가 prop 타입으로 재사용한다. */
export type AnomalyAlert = NonNullable<SessionState['anomalyAlert']>;
