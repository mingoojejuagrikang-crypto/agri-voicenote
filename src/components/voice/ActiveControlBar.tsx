import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { T } from '../../tokens';
import type { GlowTone } from './EdgeGlow';
import { ActiveControlSteppers } from './ActiveControlSteppers';
import { StateIndicator } from './StateIndicator';
import type { DotGlyph } from './StateDots';
import { CONTROL_ROW_FRACTION, VOICE_TYPE } from './heroLayout';

/** ui-standard §2·§3 — **하단 30%**(v0.43.0 UI-b에서 25→30).
 *
 * ```
 * |              . . .                     (대기: 도트 마이크)
 * |       [‹] [⏹] [⏸] [›]
 * |       인식률 45% / 안내 1.15x
 * ```
 *  - normal/paused/complete는 같은 4버튼 `[‹][⏹][⏸][›]`를 유지한다.
 *    🔴 v0.44.0 §C2(F02): 4버튼 테두리는 **무채색 한 계열**이다 — `⏹` 빨강·`⏸` 노랑 기능색은
 *    §4-b에서 폐기됐다(ui-standard §4의 옛 규정을 뒤집는 민구 확정 08-02). 심볼은 버튼 높이의 70%.
 *  - 알람은 해결 전 탐색을 허용하지 않으므로 확인/수정 2버튼을 유지한다(ui-standard §3-2).
 *  - 저장확인은 도트 없이 `[✕][✓]` **2버튼**이 4버튼 총 폭을 나눠 갖는다(v0.44.0 §C3, F16·F22 —
 *    `‹ ›`는 렌더하지 않는다. 종료 확인은 탐색이 아니라 결정의 순간이다).
 *  - 상태별 **도트 인디케이터** → 음성 입력 시 **역동 세로파형**(StateIndicator).
 *  - 그 아래 옵션(인식률/안내)을 **얇게**(ActiveControlSteppers, 기본 접힘).
 *  - `title`/`aria-label`은 토글 상태에 따라 `일시정지`/`재시작`으로 바뀐다. */
export type EdgeMode = 'nav' | 'anomaly' | 'paused' | 'exit';

export function ActiveControlBar({
  tone, mode, glyph, indicatorInteractive, indicatorExit, waveActive,
  getAudioLevel, getTimeDomainData,
  onPrevRow, onNextRow, onTogglePause, onExit, onExitCancel, onExitConfirm,
  onAnomalyConfirm, onAnomalyModify,
}: {
  /** 상태 톤(VoiceScreen SSOT) — 도트·파형 색이 엣지글로우와 함께 상태를 말한다. */
  tone: GlowTone;
  /** 행동행 구성 전환. anomaly만 확인/수정 2버튼 예외다. */
  mode: EdgeMode;
  glyph: DotGlyph;
  /** 알람 중 인디케이터의 일시정지 터치 경로. */
  indicatorInteractive: boolean;
  /** [EXIT-PERSIST-1] 끝 도달 뒤 하단 종료 버튼에 영속 상태 셀렉터를 부여한다. */
  indicatorExit: boolean;
  waveActive: boolean;
  getAudioLevel: () => number;
  getTimeDomainData: (out: Uint8Array) => boolean;
  // 🔴 v0.51 — `uiCommand` prop이 사라졌다. 이 컴포넌트는 그 신호를 **통과만** 시켰고
  //   (`ActiveControlSteppers`가 유일한 소비자였다), 조절판 음성 명령 5종이 제거되면서
  //   소비자가 없어졌다. 신호 자체는 살아 있다 — 「도움말」이 `ActiveState`에서 직접 받는다.
  onPrevRow: () => void;
  onNextRow: () => void;
  onTogglePause: () => void;
  onExit: () => void;
  onExitCancel: () => void;
  onExitConfirm: () => void;
  onAnomalyConfirm: () => void;
  onAnomalyModify: () => void;
}) {
  // 조절판 확장 상태를 여기서 소유한다 — 열리면 인디케이터·행동 행을 숨겨야 하므로.
  const [controlsOpen, setControlsOpen] = useState(false);
  const controlsExpandable = mode === 'nav';
  // C3 — 열린 조절판 뒤에서 필수 행동 행이 사라지지 않게 상태 역할이 바뀌는 즉시 접는다.
  // ActiveState/VoiceScreen 트리는 그대로 두고 이 로컬 표시 상태만 바꾼다([STT-16]).
  useEffect(() => {
    if (!controlsExpandable) setControlsOpen(false);
  }, [controlsExpandable]);
  // effect 전 한 프레임에도 필수 행동 행이 가려지지 않도록 렌더값은 mode로 함께 제한한다.
  const panelOpen = controlsExpandable && controlsOpen;
  return (
    <div
      data-testid="voice-control-bar"
      data-mode={mode}
      style={{
        borderTop: `1px solid ${T.line}`,
        height: '100%', minHeight: 0,
        // 🔴 v0.43.0 UI-b CSS 방어 2/3 — 배정 트랙 밖으로 그리지 않는다(ui-standard §6 · GL-007).
        //   ActiveState의 그리드 자식 4개 중 **여기만 방어가 없었다**(ChipZone·CenterStage는 있다).
        //   하단이 25→30%가 됐고 UI-e에서 4행 키패드가 들어올 자리라, 넘치면 아래 탭바를 덮는다.
        //   목표는 정확성이 아니라 **틀려도 영역을 못 넘게** 하는 것 — 잘리면 눈에 띈다.
        //   🟢 UI-a 함정 1(`overflow:hidden`이 `min-height:auto`를 0으로 만들어 fit 무력화)의
        //      사정권이 아니다: 이 컴포넌트는 `useFitScale`·`useFitGroup`을 쓰지 않는다.
        //      **fit이 사는 CenterStage 경계에는 새로 붙이지 않았다.**
        //
        // 🔴 v0.46.1 **FB-4** — 조절판이 **열렸을 때만** 이 방어를 연다(`panelOpen` 가드).
        //   민구 확정 08-07: *"서랍 펼칠시 스크롤 없이 보이게"* → 「더 높게 펼쳐라」.
        //   실측상 서랍 필요높이 239px은 **네 뷰포트 전부에서** 배정 트랙보다 크다
        //   (402×513 배정 75px → 부족 164px). 트랙 비율은 WP-G 계약이라 못 늘린다
        //   → 서랍이 **위로** 트랙 밖으로 자라는 것이 유일한 길이다(ActiveControlSteppers의
        //   `DRAWER_MAX_HEIGHT` 주석이 근거 SSOT).
        //
        //   ⚠️ **UI-b 방어를 없앤 게 아니다 — 방향을 하나로 좁힌 것이다.**
        //   ① `panelOpen`이면 인디케이터 행·행동 행은 **렌더 자체가 안 된다**(아래 `!panelOpen`).
        //      즉 이 상태에서 트랙을 넘칠 수 있는 자식은 조절판 하나뿐이다.
        //   ② 그 조절판은 아래 래퍼의 `justifyContent:'flex-end'`로 **바닥에 붙어** 있고 넘침은
        //      **위로만** 간다 → 탭바(컨트롤바 bottom == 탭바 top) 침범 경로가 **구조적으로 없다.**
        //   ③ 위쪽은 패널의 `maxHeight`가 **칩존 앞에서** 멈춘다.
        //   🔴 접힘·알람·일시정지 등 나머지 모든 상태에서는 `hidden` 그대로다 — 특히
        //      §C5-b가 기록한 「91px 도트가 40.75px 밴드를 넘친다」 경로는 이 가드 밖이라
        //      **영향을 받지 않는다**(도트는 `panelOpen`이면 아예 없다).
        //   ⚠️ **정렬은 여기 걸면 안 된다**(08-07 실측으로 배웠다): 아래 래퍼가 `flex:1 1 auto`로
        //      트랙을 꽉 채우므로 이 컨테이너의 `justifyContent`는 **아무 일도 하지 않는다.**
        //      넘치는 것은 래퍼가 아니라 그 **안**의 패널이라 정렬은 래퍼에 걸어야 한다.
        overflow: panelOpen ? 'visible' : 'hidden',
        // §C5-b — 접힌 조절판 토글의 오버레이 기준점(아래 주석 참조).
        position: 'relative',
        // §C5-b — gap 2·하단 padding 2를 없앴다. 이 4px 프레임이 도트행 몫에서 빠져나가
        // 402×874에서 24% 계약이 0.6%p 미달했다(zone-ratios 층2b 실측 23.38%). 행 구분은
        // 버튼 자체 테두리가 이미 하고 있다.
        display: 'flex', flexDirection: 'column',
        padding: '0 12px',
      }}
    >
      {/* 🔴 조절판이 열리면 이 행을 **통째로 숨긴다**(민구 확정 2026-07-27).
          fb-27-5(겹침) + fb-27-6(오탭)을 한 번에 없앤다 — 겹칠 상자가 존재하지 않으므로
          "91px 도트가 40.75px 밴드를 넘쳐 토글 위에 그려지고, 그 도트가 곧 일시정지 버튼이라
          오탭된다"는 경로가 **구조적으로 불가능**해진다(실기기 오터치 4회의 원인).
          ⚠️ `maxHeight`나 `pointer-events:none`으로 때우지 마라 — 자식 overflow를 못 막고,
             겹침이 남으면 `<` `>`도 같은 위험에 노출된다. 접히면 그대로 돌아온다. */}
      {!panelOpen && (
        <>
            {mode !== 'exit' && (
              <div
                data-testid="voice-indicator-row"
                style={{
                  flex: '1 1 0', minHeight: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <StateIndicator
                  glyph={glyph}
                  tone={tone}
                  waveActive={waveActive}
                  levelActive={waveActive}
                  getAudioLevel={getAudioLevel}
                  getTimeDomainData={getTimeDomainData}
                  control={
                    mode === 'anomaly' && indicatorInteractive
                      ? {
                          title: '일시정지',
                          label: '일시정지',
                          status: 'alert',
                          onClick: onTogglePause,
                        }
                      : undefined
                  }
                />
              </div>
            )}

            <div
              data-testid="voice-nav-row"
              style={{
                flex: mode === 'exit' ? '1 1 0' : `0 0 ${CONTROL_ROW_FRACTION * 100}%`, minHeight: 44,
                display: 'grid',
                gridTemplateColumns: mode === 'anomaly' || mode === 'exit'
                  ? 'repeat(2, minmax(0, 1fr))'
                  : 'repeat(4, minmax(0, 1fr))',
                alignItems: 'stretch', gap: 8,
              }}
            >
              {mode === 'exit' ? (
                <>
                  <EdgeButton kind="icon" testId="exit-confirm-cancel" label="계속 입력" title="계속 입력" onClick={onExitCancel} icon="✕" accent={T.red} accentBg={T.redGlowFaint} />
                  <EdgeButton kind="icon" testId="exit-confirm-submit" label="종료" title="종료 확인" onClick={onExitConfirm} icon="✓" accent={T.green} accentBg={T.greenGlowFaint} />
                </>
              ) : mode === 'anomaly' ? (
                <>
                  <EdgeButton kind="text" testId="anomaly-modify-btn" label="수정" visualLabel="✎ 수정" title="수정" onClick={onAnomalyModify} accent={T.red} accentBg={T.redGlowFaint} />
                  <EdgeButton kind="text" testId="anomaly-confirm-btn" label="확인" visualLabel="✓ 확인" title="확인" onClick={onAnomalyConfirm} accent={T.green} accentBg={T.greenGlowFaint} />
                </>
              ) : (
                <>
                  {/* 🔴 v0.49 F-1(민구 08-12) — **표기만** 「이전행」으로 맞춘다. 기능·testId·onClick은
                      불변(행 이동 그대로). 음성 「이전」이 이제 **항목 이동**을 뜻하므로, 버튼에
                      「이전」 표기가 남으면 같은 말이 화면에선 행·음성에선 항목을 가리켜 오해를 부른다.
                      ⚠️ 항목 이동 버튼은 만들지 않는다 — 버튼을 누를 수 있는 상황이면 손으로 칩존을
                      스크롤할 수 있다(민구 근거). */}
                  <EdgeButton kind="icon" testId="voice-control-prev" label="이전행" title="이전 행으로 이동" onClick={onPrevRow} icon="‹" />
                  <EdgeButton
                    kind="icon"
                    testId={indicatorExit ? 'voice-status-control' : 'voice-control-stop'}
                    status={indicatorExit ? 'exit' : undefined}
                    tone={indicatorExit ? tone : undefined}
                    label="종료"
                    title="입력 종료"
                    onClick={onExit}
                    // U+23F9 + U+FE0E — 텍스트 프레젠테이션 강제(§C2 ③, 이모지 렌더 차단).
                    icon={'⏹︎'}
                  />
                  <EdgeButton
                    kind="icon"
                    testId={!indicatorExit && mode !== 'paused' ? 'voice-status-control' : 'voice-control-toggle-pause'}
                    status={!indicatorExit && mode !== 'paused' ? (tone === 'red' ? 'alert' : 'listening') : undefined}
                    tone={!indicatorExit && mode !== 'paused' ? tone : undefined}
                    label={mode === 'paused' ? '재시작' : '일시정지'}
                    title={mode === 'paused' ? '재시작' : '일시정지'}
                    onClick={onTogglePause}
                    // U+23F8 + U+FE0E — 텍스트 프레젠테이션 강제(§C2 ③).
                    icon={'⏸︎'}
                  />
                  {/* v0.49 F-1 — prev와 동일 근거(표기만 「다음행」, 기능·testId 불변). */}
                  <EdgeButton kind="icon" testId="voice-control-next" label="다음행" title="다음 행으로 이동" onClick={onNextRow} icon="›" />
                </>
              )}
            </div>
        </>
      )}

      {/* §C5-b(F08) — 접힌 토글을 **플로우에서 뺀다.** 종전엔 세 번째 행으로 쌓여 하단 트랙의
          ~49px를 고정으로 먹었고, 그래서 도트행이 pool의 24%를 산술적으로 가질 수 없었다
          (34% = 24% + 10% — 토글 몫이 0이어야 정확히 떨어진다). 접힌 토글은 인디케이터 행의
          하단 중앙에 겹쳐 뜨는 필 하나다:
          - nav 모드에서만 보인다(canExpand). anomaly/paused/exit에서는 종전에도 비활성 스트립
            이었으므로 숨겨도 잃는 게 없고, 인디케이터가 버튼이 되는 anomaly에서 오탭 겹침이
            원천적으로 없다(fb-27-6 계열 방지).
          - 도트는 표시일 뿐 터치 대상이 아니라서 겹쳐도 오탭 경로가 없다.
          열리면(panelOpen) 종전대로 행들을 통째로 숨기고 패널이 플로우를 가져간다(민구 확정
          2026-07-27 — 겹칠 상자를 없애는 방식 유지). */}
      {/* 🔴 인스턴스는 **하나**다 — 래퍼 스타일만 오버레이↔플로우로 바뀐다. 조건부 분기 두 개로
          그렸더니 음성 명령('입력 조절')이 열리는 순간 재마운트된 새 인스턴스가 같은 uiCommand
          신호를 한 번 더 처리해 도로 닫혔다(v026 T6 실측).
          ⚠️ v0.51에서 그 음성 명령이 제거돼 **이 재현 경로는 더 이상 존재하지 않는다.**
          그래도 단일 인스턴스는 유지한다 — 재마운트는 패널 내부 상태(스텝퍼 포커스·디바운스
          타이머)도 함께 날리므로, 이유가 하나 사라졌을 뿐 근거가 없어진 것이 아니다.
          anomaly/paused/exit에서는 display:none — 마운트 유지 + hit-test·오탭 없음. */}
      <div
        style={
          panelOpen
            /* 🔴 v0.46.0 FB-B — `minHeight:0`만으로는 부족하다. 이 래퍼가 **트랙의 남은 높이를
             *  실제로 받아야**(`flex:1 1 auto`) 안쪽 스크롤 컨테이너에 경계가 생긴다. 종전엔
             *  래퍼가 내용 높이(289px)를 그대로 갖고 트랙(226px) 밖으로 나가 부모의
             *  `overflow:hidden`에 잘렸다. `display:flex`는 패널이 이 높이를 물려받게 한다.
             *  🔴 v0.46.1 **FB-4** — 이 래퍼는 여전히 트랙 높이를 받되(`flex:1 1 auto` 유지 —
             *  패널의 `maxHeight:%`가 이 높이를 기준으로 삼는다), **안의 패널을 바닥에 붙인다.**
             *  패널이 트랙보다 커지면 넘침이 **위로만** 가고, 아래(탭바)로는 갈 수 없다.
             *  ⚠️ 이 한 줄을 빼면 넘침이 아래로 흘러 탭바를 덮는다 — 08-07 실측으로 확인했다
             *  (375×667: panelBottom 690.8 > barBottom 578). 오라클 축 ①-a가 그것을 잡는다. */
            ? {
                minHeight: 0, flex: '1 1 auto', display: 'flex', flexDirection: 'column',
                justifyContent: 'flex-end',
              }
            : controlsExpandable
              ? {
                  position: 'absolute',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  bottom: `calc(${CONTROL_ROW_FRACTION * 100}% + 10px)`,
                  zIndex: 5,
                  maxWidth: 'calc(100% - 24px)',
                }
              : { display: 'none' }
        }
      >
        <ActiveControlSteppers
          open={panelOpen}
          canExpand={controlsExpandable}
          onOpenChange={setControlsOpen}
        />
      </div>
    </div>
  );
}

/** 하단 행동 버튼. 높이는 10% 행동행이 정하고 44px 터치 하한만 사람이 정한다(GL-007 규칙 2). */
export function EdgeButton({
  kind, label, visualLabel, title, onClick, icon, accent, accentBg, testId, status, tone, disabled = false,
}: {
  kind: 'icon' | 'text';
  label: string;
  visualLabel?: ReactNode;
  title: string;
  onClick: () => void;
  icon?: ReactNode;
  /** 위험/상태 강조가 필요한 버튼(재시작=amber, 종료·수정=red)만 지정. 인라인 일회색 금지 — 토큰. */
  accent?: string;
  accentBg?: string;
  testId?: string;
  status?: string;
  tone?: GlowTone;
  disabled?: boolean;
}) {
  const color = accent ?? T.textDim;
  return (
    <button
      type="button"
      data-testid={testId}
      data-status={status}
      data-tone={tone}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      style={{
        width: '100%',
        minWidth: kind === 'text' ? 84 : 64,
        height: '100%',
        minHeight: 44,
        padding: 0,
        boxSizing: 'border-box',
        containerType: 'size',
        borderRadius: 16,
        border: `${accent ? 2 : 1}px solid ${accent ? accent : T.lineStrong}`,
        background: accentBg ?? T.card,
        color,
        opacity: disabled ? 0.45 : 1,
        fontSize: VOICE_TYPE.controlButton,
        fontWeight: 900,
        letterSpacing: -0.3,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: disabled ? 'default' : 'pointer', touchAction: 'manipulation',
      }}
    >
      {kind === 'icon' ? (
        <span
          data-testid="control-symbol"
          aria-hidden
          style={{
            fontFamily: 'Arial, sans-serif',
            // §C2(F02) — 문양 = 버튼 높이의 70%(50%에서 상향, 민구 확정 08-02).
            // U+FE0E(텍스트 프레젠테이션)를 붙여 ⏹⏸가 iOS에서 이모지로 갈라지지 않게 한다 —
            // `‹ ›`와 같은 단색 텍스트 계열로 렌더되는 것까지가 F02의 요구다.
            fontSize: `calc(70cqh + ${accent ? 2 : 1}px)`,
            lineHeight: 1,
          }}
        >
          {icon}
        </span>
      ) : (visualLabel ?? label)}
    </button>
  );
}
