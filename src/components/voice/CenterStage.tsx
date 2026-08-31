import { type ReactNode, useEffect, useRef } from 'react';
import { AnomalyAlertPopup } from './AnomalyAlertPopup';
import { CompleteSummary } from './CompleteSummary';
import { ExitConfirmInline } from './ExitConfirmInline';
import { ModifyIndicatorPill } from './ModifyIndicatorPill';
import { VoiceHero } from './VoiceHero';
import { HeroHoldToBlackout } from './HeroHoldToBlackout';
import { AlarmInterimStrip } from './AlarmInterimStrip';
import { type ReaskReason } from './ReaskCue';
import type { GlowTone } from './EdgeGlow';
import type { Column } from '../../types';
import type { AnomalyAlert } from '../../stores/sessionStore';
import { logger } from '../../lib/logger';
import { endReachedRender } from '../../lib/logEvents';
import { T } from '../../tokens';

/** 금지된 알람 카드 내부 구현에 레이아웃 책임을 다시 섞지 않고, 중앙 stage가 공개 testid 계약을
 *  2열(라벨 1행 / 값 2행)로 배치한다. 인라인 style보다 우선해야 해서 이 범위 안에서만 `!important`를
 *  쓴다. 값/라벨 타이포는 `STATE_TYPE`의 열린 폭 비례 계약이 계속 맡는다.
 *
 *  🔴 **`line-height`를 이 블록에 다시 넣지 마라**(§C0, 2026-08-04). 종전 `line-height: 1
 *  !important`가 인라인 1.2(임계 1.15 위 — AnomalyAlertPopup `COMPARE_LINE_HEIGHT`)를 덮어
 *  글리프가 line box를 넘었고, 그 초과가 `useFitGroup`의 높이 판정을 전 배율에서 실패시켜
 *  compare 슬롯이 절대 하한(22/30px)에 갇혔다(제보 8건 화면의 잔여 원인). 제거로 fit이
 *  살아났다(375에서 값 30→60.6px, 오라클: v044-alarm-compare-fit · v0440-alarm-fit 단언C).
 *
 *  🔴 **`column-gap` 강제도 두지 마라**(리뷰② 실증, 2026-08-04). fit은 잉크를 트랙 경계까지
 *  키우므로(경계 추구 평형) 거터가 0이면 등길이 값쌍이 ~2px 간격으로 맞붙어 한 숫자로
 *  읽힌다(실캡처 "99.919.9"). 팝업 인라인 `columnGap: clamp(4px,1.5vw,12px)`가 최소 간격을
 *  보장한다. 오라클: v0440-alarm-fit 단언A의 잉크 간격 ≥ 4px.
 *
 *  ⚠️ 이 `<style>`은 알람 분기에서만 DOM에 존재한다 — 스타일 조사는 알람을 띄운 상태에서
 *  하라. (08-03 순회가 0건을 본 이유는 미확정이다 — 알람 밖 순회였거나 CORS 차단 시트에서
 *  순회가 끊겼을 수 있다. A0-probe.md §8-4) */
const ALARM_TWO_COLUMN_LAYOUT = `
  [data-central-state="alarm"] [data-testid="anomaly-alert"] {
    padding-block: 0 !important;
    row-gap: 0 !important;
    /* 🔴 v0.46.0 콜드 리뷰 L3-1 — 스테이지가 flex column이 됐다(CenterStage §근거).
       카드가 남은 공간을 받고, min-height:0으로 인식값 스트립이 커질 때 줄어들 수 있게 한다.
       ⚠️ 이 두 줄을 빼면 카드가 자기 내용만큼만 차지해 스트립이 아래를 다 먹는다. */
    flex: 1 1 auto !important;
    min-height: 0 !important;
  }
  [data-central-state="alarm"] [data-testid="anomaly-comparison"] {
    display: grid !important;
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    grid-template-rows: auto auto !important;
    width: 100% !important;
    row-gap: 0 !important;
    overflow: hidden !important;
  }
  [data-central-state="alarm"] [data-testid="anomaly-prev-label"] {
    grid-column: 1 !important;
    grid-row: 1 !important;
  }
  [data-central-state="alarm"] [data-testid="anomaly-next-label"] {
    grid-column: 2 !important;
    grid-row: 1 !important;
  }
  [data-central-state="alarm"] [data-testid="anomaly-prev-value"] {
    grid-column: 1 !important;
    grid-row: 2 !important;
  }
  [data-central-state="alarm"] [data-testid="anomaly-next-value"] {
    grid-column: 2 !important;
    grid-row: 2 !important;
  }
  [data-central-state="alarm"] [data-testid^="anomaly-"][data-testid$="-label"],
  [data-central-state="alarm"] [data-testid^="anomaly-"][data-testid$="-value"] {
    justify-self: center !important;
    text-align: center !important;
  }
  /* v0.44.0 §C6(F10, 민구 확정) — 빨강은 **원인 요소에만**: 현재값(next) 열이 원인이다.
     과거값(prev — 07-29/255.5)은 비교 기준일 뿐이라 빨강 금지 → 팝업 인라인 회색
     (textMute/textDim)이 그대로 보인다. 되돌려서 prev까지 빨갛게 칠하면
     v0440-c6-redscope 오라클이 red다. */
  [data-central-state="alarm"] [data-testid="anomaly-next-label"],
  [data-central-state="alarm"] [data-testid="anomaly-next-value"] {
    color: ${T.red} !important;
  }
`;

/** 와이어프레임 §공통규칙1·2·3 — **중앙 50%**.
 *  "정보는 가로+세로 중앙정렬(빈 공간에 따라 유동)", "폭 감안해 최대한 키운 뒤, 위/아래 여백
 *  고려해 화면 중앙 정렬".
 *
 *  상호배타 분기(정확히 하나만 렌더):
 *   1) paused  → **시각 비움**. 상태는 하단 도트 + 엣지글로우가 말하고 텍스트는 aria에만 남는다.
 *   2) anomaly → 경보행 + 2열 비교(§[2]).
 *   3) endReached → `X / N` + 종료. 완료 상태명은 aria·체크 도트·진행바가 맡는다.
 *   4) modify  → 중앙 값 surface. 항목명은 활성 칩, 상태명은 aria가 맡는다.
 *   5) hero    → 실시간 인식값 대형(§[1]).
 *
 *  🔴 이 분기는 **표시 전환**이다. ActiveState(=세션 트리)는 언제나 마운트돼 있고 여기서 자식만
 *  갈린다 — 세션 트리 자체를 조건부로 갈아치우면 인식기·워치독·클립 레코더가 teardown된다
 *  ([STT-16] 실기기 62초 사공백). */
export function CenterStage({
  exitConfirming, paused, anomalyAlert, endReached, modifyIndicator, currentCol,
  completedCount, totalRows, row, tone, reaskReason, completing, reviewCommit,
  modifyPrevValue, modifyCurrentValue,
}: {
  /** 저장확인 인라인 — 별도 레이어 없이 중앙과 하단 바의 의미만 바꾼다. */
  exitConfirming: boolean;
  paused: boolean;
  /** 표시할 이상치 알람(수동 입력 시트가 열려 있으면 부모가 null로 내린다). */
  anomalyAlert: AnomalyAlert | null;
  endReached: boolean;
  modifyIndicator: { colId: string; name: string } | null;
  currentCol?: Column;
  completedCount: number;
  totalRows: number;
  row: number;
  tone: GlowTone;
  reaskReason: ReaskReason;
  completing: boolean;
  reviewCommit: { name: string; value: string } | null;
  modifyPrevValue?: string;
  modifyCurrentValue: string;
}) {
  let branch: 'exit' | 'paused' | 'anomaly' | 'end' | 'modify' | 'hero' = 'hero';
  let content: ReactNode = null;
  if (exitConfirming) {
    branch = 'exit';
    content = <ExitConfirmInline completedCount={completedCount} totalRows={totalRows} />;
  } else if (paused) {
    branch = 'paused';
    // 시각적으로는 완전히 빈 중앙이다. 이 100% surface는 레이아웃·픽셀을 추가하지 않고
    // 스크린리더와 안정적인 상태 testid에만 "일시정지"를 남긴다(UI-c 규칙 1/3).
    content = (
      <div
        data-testid="paused-card"
        role="status"
        aria-label="일시정지"
        aria-live="polite"
        style={{ width: '100%', height: '100%' }}
      />
    );
  } else if (anomalyAlert && anomalyAlert.status !== 'corrected') {
    // 🔴 v0.46.1 FB-10(민구 제보 08-07) — **정정 완료(corrected)는 알람 카드를 타지 않는다.**
    //
    //  민구 원문: *"화면이 녹색으로 변경되며 **인식된 값만 크게** 나오고 다음 조사 항목으로 넘어가면
    //  좋겠는데 … 알람 해지 조건을 갖췄는데 배경톤이 붉은 상태로 다음 조사로 넘어가는건 사용자가
    //  느끼기엔 **부정과 긍정이 섞여 있는 느낌**이야."*
    //
    //  🔑 실측이 「배경톤」을 반증했다(`tests/_probe-fb10-transition.spec.ts`, 402×513):
    //  `data-voice-tone`은 corrected 즉시 green으로 뒤집히고 붉은 글로우도 400ms transition으로
    //  **카드가 닫히기 1711ms 전에** 이미 소등된다. 붉은 채로 남는 것은 톤이 아니라 **중앙이다** —
    //  `central=alarm`이 corrected 구간(1291~3405ms) 내내 유지돼 「직전 100 / 현재 80.5」 2열
    //  비교 그리드가 그대로 서 있었다. 민구가 "알람카드"라고 부른 것이 정확히 그 격자다.
    //
    //  👉 그래서 **표시를 새로 만들지 않고 hero의 확정 플래시로 합류시킨다**(A-3 계약).
    //  정상 커밋은 이미 `data-hero-state=confirm`으로 값 하나만 크게 띄운다 — 민구가 원하는
    //  그림이 앱 안에 이미 있었고, 정정 커밋만 거기서 빠져 있었다. 값 위계를 둘로 가르지 않는다.
    //
    //  ⚠️ **store는 건드리지 않는다.** `anomalyAlert`는 corrected인 채로 살아 있고, 해제는 종전대로
    //  advance 착지점의 `clearAnomalyAlert`가 `hadStatus='corrected'`와 함께 계측하며 내린다.
    //  여기서 미리 null로 만들면 그 착지점이 early-return이 되어 **해제 계측이 통째로 사라진다**.
    //  바뀐 것은 「그동안 무엇을 그리는가」 하나뿐이다.
    //
    //  ⚠️ 짝이 되는 변경은 `VoiceHero`의 `confirmBurst` prop이다 — 이 브랜치 전환만으로는 중앙이
    //  **빈 listening 화면**이 된다(실측). store `valueBurst`는 이 값을 실어 나르지 **못한다**:
    //  정정 커밋은 애초에 burst를 밀지 않고(v0.15.0 A4), 억제를 풀어 밀어봐도 corrected 전환과
    //  같은 React 배치라 hero 마운트 가드에 삼켜진다. 그래서 값은 알람 자신에게서 직접 내린다.
    //  게이트: `tests/v0461-fb10-corrected-hero.spec.ts`(반증 확인: 이 조건절을 빼면 corrected
    //  카드 프레임이 0 → 1로 올라가 red).
    branch = 'anomaly';
    content = (
      <div
        data-central-state="alarm"
        style={{
          width: '100%', height: '100%', minHeight: 0,
          // 🔴 v0.46.0 콜드 리뷰 L3-1(critical) — **grid가 아니라 flex다.** 아래 §근거 참조.
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          // ⏹ 종전 주석(grid 트랙 상한) — 왜 grid를 버렸는지가 여기 있다:
          //    종전 `minmax(0,1fr) auto`는 2행이 내용만큼 무한히 커질 수 있었고, 1행이 `1fr`이라
          //    0까지 눌렸다. 그런데 **스트립의 fit 컨테이너가 스트립 자신**이어서, 카드가 눌린
          //    만큼 스트립에 배정될 높이가 또 늘어나는 **순환 판정**이 됐다(평형점 = 스트립이
          //    스테이지 전량). 폭만 묶여 있어 **1~2글자에서는 아무것도 안 묶였다**:
          //    실측 402×874 폰트 304.8px · 카드 높이 **0** · 터치 도달 실패.
          //    👉 트랙을 `50%`로 clamp하면 ①카드가 항상 절반을 확보하고 ②스트립 박스가 유한해져
          //    `overflowsHeight`가 실제 제한을 보므로 **fit이 스스로 줄어든다**(순환이 끊긴다).
          //    🔑 **폰트 상한이 아니다** — 규칙 2(고정 상한 금지)를 어기지 않는다. 제한하는 것은
          //    「영역 배분」이고 그 안에서 글자는 여전히 유동적으로 최대가 된다.
          //    🔴 **그런데 `minmax(0, 50%)` 트랙은 내용과 무관하게 절반을 예약했다** — 인식값이
          //    없을 때도 카드가 정확히 스테이지 절반이 되는 부수 회귀가 생겼고(375×667:
          //    248.7 → 124.3px), 부모 `maxHeight`·자식 `lineHeight:0` 둘 다 트랙 크기를 못 줄였다
          //    (그리드 트랙은 자식의 **max-content**로 정해진다).
          //    👉 **flex로 바꾼다.** flex item의 `maxHeight:'50%'`는 **부모 높이 기준**이므로
          //    ①순환이 없고 ②인식값이 없을 때는 스트립이 `auto`로 접혀 카드가 스테이지를 다 쓴다.
          //    카드는 `flex:1 1 auto` + `min-height:0`으로 남은 공간을 받는다(아래 <style>).
          //    게이트: `tests/v0460-cr-alarm-card-floor.spec.ts`
          overflow: 'hidden',
        }}
      >
        <style>{ALARM_TWO_COLUMN_LAYOUT}</style>
        <AnomalyAlertPopup a={anomalyAlert} />
        {/* v0.37.0 FB-F — 알람 카드 아래 미확정 인식값 스트립(정정 발화 확인). interimValue 자체 구독. */}
        <AlarmInterimStrip />
      </div>
    );
  } else if (endReached) {
    branch = 'end';
    content = (
      <CompleteSummary
        completedCount={completedCount}
        totalRows={totalRows}
        reviewCommit={reviewCommit}
        // 🔴 v0.49 r5 Z5 — 끝 도달에서 설 수 있는 사유는 **저신뢰 명령 거절 하나뿐**이다
        //   (값 발화는 `absorbAtEnd`가 흡수한다). 그 하나를 그리지 않아 거절이 비프만 남았다.
        reaskReason={reaskReason}
      />
    );
  } else if (modifyIndicator) {
    branch = 'modify';
    content = (
      <ModifyIndicatorPill
        name={modifyIndicator.name}
        prevValue={modifyPrevValue}
        newValue={modifyCurrentValue}
        // 🔴 v0.49 r3 #5 — 이 분기에는 hero가 없어 `ReaskCue`가 통째로 빠져 있었다(그쪽 주석).
        reaskReason={reaskReason}
      />
    );
  } else if (currentCol) {
    branch = 'hero';
    // 🔴 v0.47.0 W7(민구 지시 08-08) — **히어로(중앙) 길게 누르기 = 검은 화면 진입.**
    //   (길이는 `HeroHoldToBlackout`의 `HOLD_TO_BLACKOUT_MS`가 소유한다 — 08-08 3초 →
    //    08-31 민구 재확정 2초. **여기에 숫자를 박지 마라.**)
    //   ⚠️ **hero 분기에만 붙인다.** 이 스테이지는 6분기 상호배타인데, 이상치 카드나 종료
    //   확인 위에서의 홀드가 화면을 끄면 사고다(그 화면들은 **봐야 하는** 화면이다).
    //   분기가 바뀌면 이 래퍼가 언마운트되며 진행 중인 홀드도 함께 취소된다(그쪽 계약 ①).
    content = (
      <HeroHoldToBlackout>
      <VoiceHero
        col={currentCol}
        review={completing}
        row={row}
        tone={tone}
        // 🔴 v0.49 r5 Z5(claude #5 · codex M11 잔여) — 종전 `completing ? null : reaskReason`은
        //   **행 검토 대기(reviewWait)의 명령 거절을 눌렀다.** 그 게이트의 근거였던 *"완료 화면에
        //   값 재질문 큐는 없어야 한다"* 는 여전히 참이지만, 그것을 보장하는 것은 이 게이트가
        //   아니라 **흡수**다: `phase==='complete'`인 두 국면(reviewWait·atEnd)에서 일반 값 발화는
        //   `resolveFinal`이 `absorbReviewWait`/`absorbAtEnd`로 먹어 거절 자체가 성립하지 않는다
        //   (`voiceFinalResolver.ts:79-80`). 즉 이 게이트가 실제로 누른 것은 **명령 거절 하나뿐**
        //   이었고, 그건 이 국면이 곧 「명령 대기」이므로 가장 보여줘야 하는 신호다.
        //   오라클: tests/v049-r5-z5-reject-surface.spec.ts
        reaskReason={reaskReason}
        reviewCommit={reviewCommit}
        // 🔴 v0.46.1 FB-10 — 정정 완료가 여기로 흘러들어온 경우, 알람 카드가 접히며 hero가
        //  **새로 마운트되기 때문에** store burst로는 확정 플래시가 전달되지 않는다(그쪽 주석).
        //  값은 알람 자신이 이미 들고 있다(`next` = 정정된 값, `colName` = 그 항목).
        confirmBurst={
          anomalyAlert?.status === 'corrected'
            ? { name: anomalyAlert.colName, value: anomalyAlert.next }
            : null
        }
      />
      </HeroHoldToBlackout>
    );
  }

  const telemetryRef = useRef<{
    alertStatus: 'none' | 'pending' | 'corrected';
    row: number;
  }>({ alertStatus: 'none', row });
  telemetryRef.current = {
    alertStatus: anomalyAlert ? (anomalyAlert.status ?? 'pending') : 'none',
    row,
  };
  // 저장확인은 기존 end 화면 위의 표시 전환이다. endReached 계측에 새 branch 바이트를 만들거나
  // 인라인 진입 때 같은 이벤트를 중복 기록하지 않는다(PRINCIPLES §4).
  const endReachedBranch: Exclude<typeof branch, 'exit'> = branch === 'exit' ? 'end' : branch;
  useEffect(() => {
    if (!endReached) return;
    const snapshot = telemetryRef.current;
    logger.log({
      type: 'session',
      extra: endReachedRender({ branch: endReachedBranch, alertStatus: snapshot.alertStatus }),
      row: snapshot.row,
    });
  }, [endReached, endReachedBranch]);

  return (
    <div
      data-testid="voice-center-stage"
      style={{
        minHeight: 0, overflow: 'hidden', width: '100%',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: 'clamp(4px, 1vh, 10px) clamp(12px, 3vw, 24px)',
      }}
    >
      {content}
    </div>
  );
}
