import { useLayoutEffect, useRef } from 'react';
import { T } from '../tokens';
import { I } from './icons';

export type TabId = 'settings' | 'voice' | 'data' | 'feedback';

interface Props {
  tab: TabId;
  setTab: (t: TabId) => void;
}

const tabs: { id: TabId; label: string; icon: (s?: number, c?: string) => JSX.Element }[] = [
  { id: 'settings', label: '설정', icon: I.settings },
  { id: 'voice', label: '입력', icon: I.mic },
  { id: 'data', label: '업로드', icon: I.data },
  // v0.33.0 항목11 — 개선요청. 화면 전환 없는 팝업 방식(민구 확정): App.tsx가 setTab 없이
  // 인터셉트해 현재 화면 위에 캡처+FeedbackModal을 띄운다 → active 하이라이트가 생기지 않는다.
  { id: 'feedback', label: '개선요청', icon: I.feedback },
];

/** v0.36.0 코덱스 시안(2026-07-20, 민구 확정) — 탭바 심볼 중심(§7.3): 아이콘을 키우고 선택 탭은
 *  초고대비 흰색 pill 채움(원거리에서 현재 탭 즉시 판독).
 *  v0.38.0 #6 — 불투명 chrome은 유지하되 EdgeGlow(z-54) 아래(z-53)에 놓아, 글로우가 네비를 포함한
 *  물리 화면 4변 끝까지 끊기지 않고 그려진다. 글로우가 pointer-events:none이라 탭 터치는 그대로다.
 *
 * 🔴 **v0.47.0 r2 P7 — v0.38.0 #6의 「가시 라벨 제거」를 민구가 뒤집었다** (08-09 실기기 점검 FB-H).
 *
 *  민구 원문: *"네비게이션 버튼 아래 버튼 이름 출력 설정/ 입력/ 업로드/ 개선요청 - 스크린샷에는
 *  안보이지만 지금 하단에 빈 공간이 많이 보임. 아이폰의 키보드 펼쳤을때 언어와 마이크 버튼이 있는
 *  공간까지는 사용을 못하고 있음."*
 *
 *  종전 근거(심볼만으로 충분)는 **원거리 판독**을 위한 것이었고 그건 지금도 유효하다 — 라벨은
 *  아이콘을 대체하지 않고 **아래에 덧붙는다**(pill 58×44·아이콘 28은 불변). 바뀐 것은 근거리에서
 *  「이 심볼이 무엇인가」를 확인할 수단이 하나도 없었다는 점이고, 민구가 현장에서 그걸 요구했다.
 *  ⚠️ aria-label은 **그대로 둔다.** 가시 텍스트와 중복되지만 accessible name은 aria-label이 이기므로
 *  이름으로 조회하는 기존 스펙이 그대로 산다(실측: 탭 라벨 문자열로 조회하는 스펙 0건이라 어느 쪽도
 *  안전하지만, 이름 계산을 렌더 구조에 의존시키지 않는 편이 덜 부서진다).
 *
 * 🔴 **하단 패딩이 「홈인디케이터 위」에서 「홈인디케이터 안」으로 내려왔다** — 계약 반전이다.
 *
 *  종전 `max(28px, var(--sab))`는 **`--sab`가 지배**했다(402×874 iOS에서 --sab≈34px). 즉 28px를
 *  낮추는 것만으로는 **실기기에서 아무 일도 일어나지 않는다** — 민구가 되찾으라고 한 공간을 실제로
 *  되찾는 유일한 레버가 `--sab` 아래로 내려가는 것이다. 그 대가인 **iOS 하단 스와이프 오터치 위험은
 *  민구가 명시적으로 감수**했다(08-09). 👉 `tests/safe-area.spec.ts` ①의 「탭 버튼이 홈인디케이터
 *  **위에** 완전히 위치」 단언이 이 반전으로 정당하게 파손되며, 그 스펙이 새 계약으로 갱신됐다.
 *
 *  실측(402×874, `tests/v0470-r2-nav-label.spec.ts`가 계약으로 잰다):
 *    변경 전 --sab=34 → 탭바 95px (4 + 버튼 56 + 패딩 34 + border 1)
 *    변경 후 --sab=34 → 탭바 85px (4 + 버튼 68[라벨 포함] + 패딩 12 + border 1)
 *  라벨이 +12px를 먹고 패딩이 −22px를 돌려줘 **순 10px 회수 + 라벨 획득**이다.
 *  ⚠️ 12px는 실측 근거로 고른 값이지 민구가 지정한 수치가 아니다 — 더/덜 원하면 이 상수 한 줄이다.
 *  🔑 `minHeight`도 함께 내렸다. 88을 두면 새 내용 높이(85)가 clamp돼 **축소분이 통째로 상쇄**된다.
 *  새 값 72 = paddingTop 4 + 버튼 최소 타깃 56 + paddingBottom 12 — 라벨이 사라져도 56px 타깃이
 *  보장되는 하한이다(터치 타깃 계약은 이 반전과 무관하게 유지). */

/** 탭 버튼 최소 터치 타깃. 이 반전과 **무관하게 유지**되는 계약이다. */
export const NAV_TOUCH_TARGET = 56;
/** 탭바 상단 패딩. */
export const NAV_PAD_TOP = 4;
/** 하단 safe-area를 얼마나 되찾는가. 🔴 `var(--sab)`(≈34px)보다 **작아야** 의미가 있다 — 위 §반전 참조. */
export const NAV_PAD_BOTTOM = 12;
/** 라벨 자리를 뺀 하한. 🔑 종전 88을 그대로 두면 새 내용 높이가 clamp돼 축소분이 통째로 상쇄된다. */
export const NAV_MIN_HEIGHT = NAV_PAD_TOP + NAV_TOUCH_TARGET + NAV_PAD_BOTTOM;

export function TabBar({ tab, setTab }: Props) {
  // v0.37.0 FB-I(민구, "네비는 항상 보여야 함) — 나비의 **실측 높이**를 --nav-h로 발행(SSOT).
  //   🔴 **종전 주석의 「수동 입력 시트가 이 값을 소비한다」는 거짓이었다**(2026-08-31 실측 정정):
  //   `grep -rn bottomInset src` → 정의만 있고 **호출부 0건**이었고, 그 시트는 그리드 인라인이라
  //   애초에 오버레이가 아니다. 세 회차가 "이미 쓰고 있다"고 믿었다.
  //   **첫 소비자는 v0.51 P0-1의 보기 전용 오버레이 5종이다** — 「?」 도움말 · 설정 도움말
  //   (설정탭·데이터탭 공용) · 설정 요약 · 표 미리보기(**비게이트만**) · 세션 상세.
  //   그것들이 이 값만큼 위로 앉아 나비를 남긴다. 손계산은
  //   버튼 padding/border/폰트/노치(--sab)로 언더슈트해 나비 상단을 자르므로(잘림=실패 방향), 렌더된
  //   offsetHeight(패딩·보더·라이브 --sab 포함)를 ResizeObserver로 추종한다 — 회전·safe-area·폰트
  //   변화에도 정확. :root의 --nav-h:100px는 err-large 첫 페인트 폴백.
  const barRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const publish = () => document.documentElement.style.setProperty('--nav-h', `${el.offsetHeight}px`);
    publish();
    // v0.37.0 리뷰 #1(Codex) — 구형 WebView(ResizeObserver 미탑재)에서 앱 부트 크래시 방지.
    //   TabBar는 모든 화면에 마운트되므로 여기서 던지면 전 화면이 죽는다(PRINCIPLES §6 iOS Safari,
    //   v035-r3-fixes P2 "Observer 둘 다 없어도 크래시 없이 렌더" 계약). 리포 내 다른 RO 사용처
    //   (useFitScale·useChipFlowFit)와 동일하게 feature-detect하고, RO 미가용 시 window resize로 폴백
    //   추종한다(회전·safe-area 변화 재수렴). 초기 publish()는 위에서 이미 첫 페인트 값을 발행했다.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(publish) : null;
    ro?.observe(el);
    if (!ro) window.addEventListener('resize', publish);
    return () => {
      ro?.disconnect();
      if (!ro) window.removeEventListener('resize', publish);
    };
  }, []);
  return (
    <div
      ref={barRef}
      data-testid="tab-bar"
      style={{
        // v0.38.0 #6 — EdgeGlow(fixed z-54)가 하단 물리 가장자리까지 네비 위로 통과한다. 불투명 배경과
        //   blur는 그대로라 네비 가독성을 잃지 않고, 모달/시트(55~120)는 계속 둘 다 덮는다.
        position: 'relative',
        zIndex: 53,
        // v0.15.0 A1 — 하단 홈인디케이터 safe-area(max(28px, --sab)).
        // 🔴 v0.47.0 r2 P7 — `--sab` 추종을 **끊었다**(위 §반전). 상수 두 개가 SSOT다.
        minHeight: NAV_MIN_HEIGHT,
        paddingBottom: NAV_PAD_BOTTOM,
        paddingTop: NAV_PAD_TOP,
        background: 'rgba(14,15,17,0.92)',
        backdropFilter: 'blur(20px) saturate(160%)',
        WebkitBackdropFilter: 'blur(20px) saturate(160%)',
        borderTop: `1px solid ${T.line}`,
        display: 'flex',
        flexShrink: 0,
      }}
    >
      {tabs.map((t) => {
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            data-testid={`tab-${t.id}`}
            onClick={() => setTab(t.id)}
            aria-label={t.label}
            aria-current={active ? 'page' : undefined}
            style={{
              flex: 1,
              border: 'none',
              background: 'transparent',
              display: 'flex',
              // P7 — 아이콘 **아래** 라벨. 세로 배치는 라벨 복원으로 생긴 유일한 구조 변경이다.
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              padding: '5px 0',
              cursor: 'pointer',
              color: active ? T.text : T.textDim,
              minHeight: NAV_TOUCH_TARGET,
            }}
          >
            <div
              style={{
                width: 58,
                height: 44,
                borderRadius: 22,
                background: active ? T.text : 'transparent',
                color: active ? T.bg : T.textDim,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 200ms, color 200ms',
                flexShrink: 0,
              }}
            >
              {t.icon(28)}
            </div>
            {/* P7 — 색은 버튼에서 상속한다(active 대비가 한 곳에서만 정해지게). 리터럴 fontSize는
                이 디렉토리의 관례다(`v043-typo-contract` 검사 범위는 `src/components/voice/`뿐 —
                실측). 11px은 아이콘이 주 판독 수단이라는 §7.3 전제 아래의 보조 라벨 크기다. */}
            <span
              data-testid={`tab-label-${t.id}`}
              style={{
                fontSize: 11,
                fontWeight: 700,
                lineHeight: 1.1,
                letterSpacing: -0.2,
                whiteSpace: 'nowrap',
              }}
            >
              {t.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
