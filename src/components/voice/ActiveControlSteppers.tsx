import { useRef } from 'react';
import { T } from '../../tokens';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSessionStore } from '../../stores/sessionStore';
import { logger } from '../../lib/logger';
import { inputControlPanelOpened, settingChanged } from '../../lib/logEvents';
import { speak, setBargeInEnabled } from '../../lib/speech';
import {
  CHIP_SWEEP_LEVEL_MAX, chipSweepSecondsForLevel, chipSweepLevelForSeconds,
} from '../../lib/chipSweep';
import { ACTIVE_ZONE_RATIOS, VOICE_TYPE } from './heroLayout';
import { StepperControl, clampStep } from './StepperControl';
import { BargeInToggle } from './BargeInToggle';

/** 🔴 v0.46.1 **FB-4**(민구 제보 08-07 *"서랍 펼칠시 스크롤 없이 보이게 변경"* → 확정 답변
 *  **「서랍을 더 높게 펼쳐라」**) — 펼친 서랍이 **위로** 자랄 수 있는 상한.
 *
 *  ## 왜 「더 높게」가 선택이 아니라 강제된 결론인가 (실측 08-07, `_probe-fb4-drawer-height.spec.ts`)
 *  펼친 서랍의 **필요 높이는 239px 고정**이다(스텝퍼 행 높이가 뷰포트에 안 따라간다).
 *  배정된 하단 트랙은 **네 뷰포트 전부 모자랐다**:
 *  ```
 *  402×513(민구 실기기) 배정 75px  → 부족 164px      375×667 배정 127px → 부족 112px
 *  402×812(standalone)  배정 176px → 부족  63px      402×874 배정 198px → 부족  41px
 *  ```
 *  내용 축소·그리드 재배치는 민구가 **기각**했고 트랙 비율은 `heroLayout.ts` zone 계약
 *  (WP-G 소유)이라 못 늘린다 → **남는 길은 트랙 밖으로(위로) 자라는 것 하나뿐이다.**
 *
 *  ## 상한을 왜 여기서 끊나 — **칩존은 절대 덮지 않는다**
 *  `1 + center/bottom` = 하단 트랙 + 중앙 트랙 = **칩존 바로 아래까지**.
 *  🔑 이 파일의 WP-D 주석이 **칩 왕복이 왜 이 서랍에 있는지**를 이미 적어놨다 —
 *  *"이 값은 «2~3m 떨어져서 읽히는가»가 판정 기준이라 **칩존을 보면서** 맞춰야 한다."*
 *  칩존을 덮으면 그 이유가 사라진다. 이 상한은 **오라클이 지킨다**
 *  (`v0460-fb-b-drawer-reachable.spec.ts` ②-b: 서랍이 열려도 칩존이 자기 자신으로 히트된다).
 *
 *  ## 🟢 비율을 **읽기만** 한다
 *  `ACTIVE_ZONE_RATIOS`(WP-G 소유)를 바꾸지 않으므로 WP-G가 배분을 조정하면 이 상한이
 *  자동으로 따라간다. **숫자를 여기 박으면 그 연동이 끊긴다.**
 *
 *  ## 🔴🔴 여유가 얇다 — **서랍에 항목을 추가하려는 사람이 반드시 읽어야 하는 곳**
 *  실측(08-07): 402×513에서 서랍 최종 높이 **290px** vs 상한 **308px** = **여유 약 18px**.
 *  서랍 행 하나가 **69px**이다.
 *  👉 **항목을 하나만 더 넣어도 402×513은 다시 스크롤이 생긴다 = FB-4가 그대로 회귀한다.**
 *  🔑 **민구는 이 18px을 알고 ⓐ를 확정했다**(08-07 17:55, `_ASK-D.md` D-1 — 대안 ⓑ「칩존까지
 *     덮기」를 나란히 보고 고른 답이다). 즉 이 얇은 여유는 **사고가 아니라 합의된 상태**다.
 *  👉 다음에 항목이 필요하면 셋 중 하나를 **민구에게 물어서** 골라라:
 *     ⓑ 상한을 칩존까지 올린다(칩 왕복을 칩존 보며 맞춘다는 전제를 포기하는 것) ·
 *     요약 필로 승격 · 항목 통합. **조용히 늘리지 마라.**
 *  🟢 그래서 `input-control-scroll`의 스크롤 fallback을 **지우지 않았다** — 넘쳐도 조용히
 *  잘리는 게 아니라 스크롤로 닿는다(FB-B가 세운 계약 보존). 오라클 ②-a가 그 순간 red를 낸다. */
const DRAWER_MAX_HEIGHT =
  `calc(100% * ${1 + ACTIVE_ZONE_RATIOS.base.center / ACTIVE_ZONE_RATIOS.base.bottom})`;

/** v0.20.0 입력탭#1·#2 — 입력 컨트롤바: [인식 허용범위] · [안내 속도] 두 다이얼을 수평 배치.
 *  허용범위(recognitionTolerance) 0.40~0.90 → %로 표시. 속도(ttsRate) 0.5~2.0 → x로 표시·샘플 음성.
 *  두 다이얼은 375 폭에서도 한 줄에 들어가게 동일 flex(각 minWidth:0).
 *  v0.44.0 §D1 — 세 번째 항목 [말끊기 ON/OFF](BargeInToggle, 기본 ON)를 그 아래 전폭 1행으로
 *  추가(민구 확정 08-02: "바지인 기능 토글을 입력탭의 서랍메뉴에 포함"). 접힌 요약 필은 종전
 *  두 값만 유지한다 — 문자열이 길어지면 375 폭 오버레이 필이 줄바꿈돼 §C5-b 겹침 관례를 해친다. */
export function ActiveControlSteppers({ open, canExpand, onOpenChange }: {
  /** 확장 여부 — **부모가 소유**한다. 열려 있는 동안 하단 인디케이터·`<`·`>`를 숨겨야 하는데
   *  (fb-27-6 오탭 원인 제거), 그 판단이 이 컴포넌트 밖에서 필요하기 때문이다. */
  open: boolean;
  /** anomaly/paused에서는 확인·수정/재시작·종료가 필수이므로 조절판 재확장을 막는다. */
  canExpand: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const s = useSettingsStore();
  /** 🔴 v0.47.0 W6(민구 제보 T-6=FB-G② · 확정 08-08) — **완료(체크 글리프) 동안 접힌 필을 숨긴다.**
   *
   *  실측(08-08): 402×874는 행피치 12px·예약 48px ≥ 필 42px라 설계대로지만, 402×513은 행피치가
   *  **5px**로 무너져 예약이 **20px**이 된다 — 필은 `minHeight:42`(44px 터치 하한)라 작아질 수
   *  없어 체크 글리프를 **13셀**(구 비트맵 기준 실측) 덮는다. 「N행 예약」이 짧은 화면에서
   *  성립하지 않는 것이다.
   *  🔴 민구 원안(«글리프 축소»)은 **기하학적으로 불가능**하다 — 격자는 세로 중앙정렬이고 필은
   *  하단 고정이라 `잉크하단 = 밴드중심 + 0.2143·G`인데, 402×513은 밴드중심(339.6)이 이미
   *  필top(335.3)보다 아래여서 `G→0`에서도 겹친다. **산술과 대안 4종은
   *  `tests/v0470-w6-complete-dot-pill.spec.ts` 헤더가 SSOT.**
   *  ⚠️ 계수는 v0.48.0 P1(`30fda46`)로 **0.1429 → 0.2143**이 됐다(체크 잉크 하단 r8 → r9).
   *  위 13셀도 그 이전 형상의 수라 지금은 더 커진다 — **다시 재지 않았다**: W6로 필이 아예
   *  렌더되지 않아 겹침이 관측 불가능한 반사실이고, 결론(축소로는 도달 불가)은 잉크가 내려간
   *  만큼 오히려 강해지기 때문이다. 필을 되살리는 변경을 하려면 그때 다시 재라.
   *  👉 08-07의 「짧은 화면 전 구간 숨김」안은 같은 날 20:10 민구가 취소했다(세션 중 서랍을
   *  터치로 못 연다) — **완료 한정으로 좁힌 것이 그 절충이다.**
   *
   *  조건은 `ActiveState`의 `glyph === 'check'`와 같아야 한다
   *  (`paused ? 'pause' : anomalyPending ? 'alert' : endReached ? 'check' : 'mic'`). `phase==='complete'`가
   *  paused를 이미 배제하므로 남는 것은 이상치 배제 하나다. prop이 아니라 스토어를 직접 읽는 것은
   *  경로상 `ActiveState`·`ActiveControlBar`를 거쳐야 하는데 **표시 전용 판정**이라 구독으로 족해서다.
   *  🔴 `endReached`는 complete를 벗어나는 순간 `setPhase`가 내린다(`sessionStore.ts:230`) —
   *  **복귀 배선이 따로 없다.** 🟡 FB-5(진행 중 도트 가림)는 이걸로 안 풀린다(별건·`@pending-fb5`). */
  const checkGlyphShown = useSessionStore((st) => (
    st.phase === 'complete'
    && st.endReached
    && !(st.anomalyAlert && st.anomalyAlert.status !== 'corrected')
  ));
  // 펼친 상태의 헤더는 남긴다 — 그게 사라지면 **닫을 수단이 없어진다.** 펼치면 도트가 통째로
  //   숨으므로(부모 `open` 계약) 겹칠 것도 애초에 없다.
  const hideCollapsedPill = checkGlyphShown && !open;
  const ttsDebounceRef = useRef<number | null>(null);
  const sampleTts = (rate: number) => {
    if (ttsDebounceRef.current !== null) window.clearTimeout(ttsDebounceRef.current);
    ttsDebounceRef.current = window.setTimeout(() => {
      void speak('이 속도로 안내합니다.', { interrupt: true, rate });
      // v0.33.0 B-5 — ttsRate 스탭퍼 변경 로깅(이전엔 무로깅). 샘플 TTS와 같은 디바운스 창에서
      // 최종값만 1회 기록해 연타가 링버퍼(2000)를 잠식하지 않게 한다.
      logger.log({ type: 'app', extra: settingChanged('ttsRate', rate) });
    }, 350);
  };
  // v0.33.0 B-6 — recognitionTolerance 로깅 디바운스(이전엔 탭마다 즉시 로깅 → 연타 시 링버퍼 잠식).
  // ttsDebounceRef와 동일 패턴·동일 350ms 창, 최종값만 기록.
  const tolLogDebounceRef = useRef<number | null>(null);
  /** 🔴 v0.51 — `source` 인자가 사라졌다. 유일한 `'voice'` 호출부가 위에서 제거된 uiCommand
   *  디스패치였고, 남은 호출부는 접힌 필 하나(터치)뿐이다.
   *  🟢 **로그 어휘는 그대로 둔다** — `inputControlPanelOpened`의 유니온은 `'touch' | 'voice'`를
   *  유지한다. 과거 로그에 `src=voice`가 남아 있고, 어휘를 좁히면 그 로그가 «모르는 값»이 된다
   *  (SOP-003 대조가 어휘 안정성에 기댄다). 여기서 더 이상 방출되지 않을 뿐이다. */
  const setOpen = (updater: boolean | ((v: boolean) => boolean)) => {
    const next = typeof updater === 'function' ? updater(open) : updater;
    const allowedNext = canExpand ? next : false;
    if (allowedNext && !open) {
      logger.log({ type: 'app', extra: inputControlPanelOpened('touch') });
    }
    onOpenChange(allowedNext);
  };
  const setTolerance = (next: number) => {
    const value = clampStep(next, 0.4, 0.9);
    s.set({ recognitionTolerance: value });
    if (tolLogDebounceRef.current !== null) window.clearTimeout(tolLogDebounceRef.current);
    tolLogDebounceRef.current = window.setTimeout(() => {
      logger.log({ type: 'app', extra: settingChanged('recognitionTolerance', value) });
    }, 350);
  };
  const setTtsRate = (next: number) => {
    const value = clampStep(next, 0.5, 2);
    s.set({ ttsRate: value });
    sampleTts(value);
  };
  // v0.44.0 §D1(민구 확정 08-02) — 말끊기(barge-in) 토글. 스토어 영속 + 라이브 speech 모듈
  // 동기화(TtsVoiceSelector의 setPreferredVoiceName 패턴). 토글은 연타 대상이 아니라서
  // 스텝퍼류 디바운스 없이 즉시 1회 로깅한다.
  const setBargeIn = (next: boolean) => {
    s.set({ bargeInEnabled: next });
    setBargeInEnabled(next);
    logger.log({ type: 'app', extra: settingChanged('bargeInEnabled', next) });
  };
  // 🔴 v0.46.0 WP-D(민구 R3 · 제보 F17) — **네 번째 서랍 항목: 칩 왕복**.
  //    민구 원문이 *"입력탭의 진행설정"* 이었고, 이 서랍이 그 자리다(08-05 확정 — 설정탭
  //    SessionOptionsSection이 아니다. 「진행설정」이라는 이름의 UI는 이 레포에 없었다).
  //    🔑 **왜 여기인가:** 이 값은 *"2~3m 떨어져서 읽히는가"* 가 판정 기준이라 **칩존을 보면서**
  //    맞춰야 한다. 설정탭에 두면 조사 중에 탭을 나갔다 와야 한다.
  //    값의 의미(편도 초·0=끔)와 상한은 src/lib/chipSweep.ts가 SSOT — 여기는 스텝퍼만.
  //    로깅은 ttsRate·recognitionTolerance와 같은 350ms 디바운스(연타가 링버퍼를 잠식하지 않게).
  const sweepLogDebounceRef = useRef<number | null>(null);
  // 🔴 v0.46.1 WP-4(민구 확정 08-07) — 스텝퍼는 이제 **단계 0~10**을 다룬다(초가 아니다).
  //    민구: *"0~10까지 설정 변경. 0은 정지, 10은 … 읽을 수 있는 가장 빠른 속도."*
  //    ⚠️ **단계가 클수록 빠르다**(직관과 반대) — 민구가 그렇게 정의했다. 변환은 chipSweep.ts가 SSOT.
  const setChipSweepLevel = (nextLevel: number) => {
    const level = Math.min(CHIP_SWEEP_LEVEL_MAX, Math.max(0, Math.round(nextLevel)));
    const value = chipSweepSecondsForLevel(level);
    s.set({ chipSweepSeconds: value });
    if (sweepLogDebounceRef.current !== null) window.clearTimeout(sweepLogDebounceRef.current);
    sweepLogDebounceRef.current = window.setTimeout(() => {
      logger.log({ type: 'app', extra: settingChanged('chipSweepSeconds', value) });
    }, 350);
  };
  // 🔴 v0.51 (민구 확정 08-31) — **여기 있던 uiCommand 디스패치가 통째로 사라졌다.**
  //   종전에는 `toggleInputControls`·`recognitionDown/Up`·`guidanceSlower/Faster` 5종을
  //   음성 신호로 받아 이 패널의 손 조작과 **같은 동작**을 시켰다(v0.38.0 #4-③의 설계).
  //   08-31 확정: ***"조절판은 손으로만."*** → 그 5개 명령이 `voiceCommands.ts`에서 제거되면서
  //   이 effect가 받을 신호가 **하나도 남지 않았다**(`VOICE_UI_COMMAND_IDS`는 이제 help·screenOff뿐이고
  //   둘 다 이 컴포넌트의 관심사가 아니다). 죽은 배선을 남기면 다음 사람이 «음성으로도 되나 보다»
  //   라고 읽는다 — `uiCommand` prop과 함께 지웠다.
  //   🔴 **기능은 그대로 산다** — 아래 스텝퍼·토글·요약 필이 전부 그대로다. 없앤 것은 «말로 부르는
  //   경로» 하나뿐이고, 도움말은 그 사실을 「손으로만 되는 것」 묶음으로 가르친다.
  const sweepLevel = chipSweepLevelForSeconds(s.chipSweepSeconds);
  const tolPct = Math.round(s.recognitionTolerance * 100);
  // v0.37.0 FB-K(민구) — 모호한 "입력 조절"·"인식"·"안내" 라벨을 뜻이 분명한 "허용 인식률"·
  //   "안내속도"로 교체(원거리·장갑 현장에서 무엇을 조절하는지 즉시 이해). 요약 접힘 버튼도
  //   포괄 라벨("입력 조절")을 제거하고 두 값만 나열한다.
  const summary = `허용 인식률 ${tolPct}% · 안내속도 ${s.ttsRate.toFixed(2)}x`;
  return (
    <div
      data-testid="input-control-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        /* 🔴 v0.46.0 FB-B → **v0.46.1 FB-4로 처방이 바뀌었다.** 두 사건의 원인은 같다:
         *  WP-D가 **서랍 항목을 3개 → 4개로 늘렸고 트랙은 안 늘었다.**
         *  실측(402×812): 패널 **289px** vs `voice-control-bar` 트랙 **226px** → **63px 손실**,
         *  4번째 항목(칩 왕복, 행 높이 69px)이 거의 통째로 사라졌다. 375×667은 112px 손실.
         *
         *  ⚠️ **탭바가 덮은 게 아니다.** 컨트롤바 bottom과 탭바 top이 정확히 맞닿아 있다
         *  (실측 723=723 · 785=785 · 578=578). 그 `overflow:hidden`은 v0.43.0 UI-b의 **의도된
         *  방어**이고 제대로 동작했다 — 탭바를 침범하는 대신 자기 내용을 잘랐을 뿐이다.
         *
         *  · **FB-B(08-06) 처방:** 트랙 안에서의 **내부 스크롤**. 잘림은 사라졌다.
         *  · **FB-4(08-07) 민구 판정:** *"서랍 펼칠시 **스크롤 없이** 보이게 변경"* →
         *    그 스크롤 자체가 현장에서 불편했다(2~3m·장갑). 확정 답변은 **「더 높게 펼쳐라」**.
         *  👉 처방 교체: 패널이 **위로 트랙 밖까지 자란다**(`DRAWER_MAX_HEIGHT` 주석이 근거 SSOT).
         *
         *  🔴 `flex`가 **`1 1 auto` → `0 0 auto`** 로 바뀐 것이 이 전환의 핵심이다.
         *     `1 1 auto`는 컨테이너 높이에 자기를 맞추므로 **트랙보다 커질 수 없었다.**
         *     `0 0 auto` + `maxHeight`라야 내용만큼 자라고 칩존 앞에서 멈춘다.
         *     ⚠️ 이 한 줄을 `1 1 auto`로 되돌리면 오라클 ②-a(스크롤 없음)가 red가 된다(반증 확인).
         *
         *  🔴 **부모(`ActiveControlBar`)의 협조가 필요하다** — 트랙 밖으로 자라려면
         *     `overflow:hidden`을 열고(`visible`) 넘침 방향을 위로 돌려야 한다
         *     (`justifyContent:'flex-end'`). **둘 다 `panelOpen`일 때만** 건다. 근거는 그쪽 주석.
         *
         *  ⚠️ **접힘 상태에는 걸지 않는다**(`open` 가드). 접힌 토글 49px은 `heroLayout.ts:124`가
         *  고정으로 쓰는 계약이라 flex 축을 건드리면 그 계산이 흔들린다. */
        ...(open ? {
          flex: '0 0 auto',
          minHeight: 0,
          maxHeight: DRAWER_MAX_HEIGHT,
          /* 중앙 트랙 위에 겹쳐 그려지므로 **불투명해야 한다** — 투명하면 뒤의 중앙 표시(값·항목명)가
             서랍 항목 사이로 비쳐 원거리에서 둘이 섞여 읽힌다. 좌우 12px은 부모 padding이라
             음수 마진으로 되찾아 **전폭 시트**로 만든다(가장자리에 뒷화면 띠가 남지 않게). */
          background: T.bg,
          borderTop: `1px solid ${T.lineStrong}`,
          marginLeft: -12,
          marginRight: -12,
          paddingLeft: 12,
          paddingRight: 12,
        } : null),
      }}
    >
      {/* v0.47.0 W6 — 완료(체크 글리프) 동안에는 접힌 필 자체를 렌더하지 않는다(위 상수 주석).
          🔴 `visibility:hidden`이나 `opacity:0`으로 하지 마라 — 그것들은 **박스를 남기므로**
          겹침 판정(사각형 교차)에도, 오탭 hit-test에도 그대로 걸린다. */}
      {!hideCollapsedPill && (
      <button
        type="button"
        data-testid="input-control-toggle"
        aria-expanded={open}
        disabled={!canExpand}
        onClick={() => {
          // v0.33.0 B-7 — 입력 조절 패널 열림/닫힘 계측(ui_suspend/ui_resume의 command 컨벤션).
          // updater 밖에서 로깅(StrictMode의 updater 중복 호출로 이벤트가 2배로 찍히지 않게).
          logger.log({ type: 'command', parsed: open ? 'ui_close' : 'ui_open', extra: 'input_control_panel' });
          setOpen((v) => !v);
        }}
        style={{
          minHeight: 42,
          borderRadius: 14,
          border: `1px solid ${T.lineStrong}`,
          background: T.card,
          color: T.textDim,
          fontSize: VOICE_TYPE.caption,
          fontWeight: 850,
          letterSpacing: -0.2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          cursor: canExpand ? 'pointer' : 'default',
          opacity: canExpand ? 1 : 0.6,
          touchAction: 'manipulation',
        }}
        title="허용 인식률·안내속도"
      >
        <span>{summary}</span>
        <span aria-hidden style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }}>⌄</span>
      </button>
      )}
      {open && (
        /* 🔴 v0.46.0 FB-B — 트랙이 모자라면 **여기서** 스크롤한다.
         *  🟢 **v0.46.1 FB-4 이후엔 이것이 「평소 경로」가 아니라 「fallback」이다.** 패널이 위로
         *    자라 네 뷰포트(402×513·812·874 · 375×667)에서 스크롤이 **실제로 사라졌다**(실측).
         *    ⚠️ **그래도 지우지 마라** — 402×513의 여유는 약 18px뿐이라 서랍 항목이 하나만
         *    늘어도(행 69px) 다시 넘친다. 그때 이게 없으면 FB-B의 「조용한 잘림」으로 되돌아간다.
         *  · `minHeight:0` 없이 `flex:1 1 auto`만 주면 flex item의 `min-height:auto`가 축소를
         *    막아 종전과 똑같이 잘린다 — 이 레포가 이미 데인 함정이다(UI-a 함정 1의 사촌).
         *  · `overscrollBehavior:'contain'` — 서랍 끝에서 스크롤이 **뒤 화면으로 새지 않게** 한다.
         *    현장은 장갑 낀 손이라 관성 스크롤이 부모로 넘어가면 칩존이 딸려 움직인다.
         *  · 접힌 토글은 이 컨테이너 **밖**이라 항상 보인다(49px 계약 불변).
         *  ⚠️ 스크롤이 생겼다는 사실 자체는 **실기기 판정 대상**이다 — 2~3m 거리·장갑에서
         *    4번째 항목에 닿는 것이 실제로 편한지는 민구가 본다. 대안(ⓒ재배치·ⓓ요약필 승격)은
         *    `_ASK-wp-d.md` Q4에 그대로 있다. */
        <div
          data-testid="input-control-scroll"
          style={{
            minHeight: 0,
            flex: '1 1 auto',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            WebkitOverflowScrolling: 'touch',
          }}
        >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <StepperControl
            testId="stepper-tolerance"
            label="허용 인식률"
            value={`${tolPct}%`}
            detail="높을수록 엄격"
            accent={T.green}
            minusLabel="인식 기준 낮추기"
            plusLabel="인식 기준 높이기"
            canMinus={s.recognitionTolerance > 0.4}
            canPlus={s.recognitionTolerance < 0.9}
            onMinus={() => setTolerance(s.recognitionTolerance - 0.05)}
            onPlus={() => setTolerance(s.recognitionTolerance + 0.05)}
          />
          <StepperControl
            testId="stepper-tts-rate"
            label="안내속도"
            value={`${s.ttsRate.toFixed(2)}x`}
            detail="음성 속도"
            accent={T.blue}
            minusLabel="음성 안내 속도 낮추기"
            plusLabel="음성 안내 속도 높이기"
            canMinus={s.ttsRate > 0.5}
            canPlus={s.ttsRate < 2}
            onMinus={() => setTtsRate(s.ttsRate - 0.05)}
            onPlus={() => setTtsRate(s.ttsRate + 0.05)}
          />
          <BargeInToggle on={s.bargeInEnabled} onToggle={() => setBargeIn(!s.bargeInEnabled)} />
          {/* v0.46.0 WP-D — 말끊기와 같은 전폭 1행(375 폭에서 3항목 가로 배치는 48px 터치 타깃이
              나오지 않는다). ⚠️ 접힌 요약 필(summary)에는 **넣지 않는다** — 문자열이 길어지면
              375 폭 오버레이 필이 줄바꿈돼 §C5-b 겹침 관례를 해치고, heroLayout.ts:124가 고정으로
              쓰는 **접힌 토글 49px**(WP-G 소유 계약)이 흔들린다. 이 행은 **펼친 높이만** 늘린다. */}
          <StepperControl
            testId="stepper-chip-sweep"
            fullWidth
            label="칩 왕복"
            // 단계와 실제 편도 초를 **함께** 보여준다 — 민구가 실기기에서 튜닝할 때
            // "몇 단계가 몇 초인가"를 화면에서 바로 읽어야 한다.
            value={sweepLevel > 0 ? `${sweepLevel} (${s.chipSweepSeconds}초)` : '정지'}
            // 🔴 단계가 클수록 **빠르다**(민구 정의). 라벨이 이 방향을 명시해야 오조작이 없다.
            detail="0=정지 · 10=가장 빠름"
            accent={s.chipSweepSeconds > 0 ? T.text : T.textMute}
            minusLabel="칩 왕복 느리게(0이면 정지)"
            plusLabel="칩 왕복 빠르게"
            canMinus={sweepLevel > 0}
            canPlus={sweepLevel < CHIP_SWEEP_LEVEL_MAX}
            onMinus={() => setChipSweepLevel(sweepLevel - 1)}
            onPlus={() => setChipSweepLevel(sweepLevel + 1)}
          />
        </div>
        </div>
      )}
    </div>
  );
}
