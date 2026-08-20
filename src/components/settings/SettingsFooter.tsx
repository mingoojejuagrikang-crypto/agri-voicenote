import { T } from '../../tokens';
import { UpdateControl } from './UpdateControl';

/** [ENV-12 · r2-nearcap] 설정탭 푸터 — 버전·프리뷰 배지·빌드일자·계정 + 수동 업데이트 확인.
 *  SettingsScreen에서 **순수 이동(DOM 불변)**. 주입 없음: 전부 빌드 타임 전역(`__APP_VERSION__`·
 *  `__PREVIEW_BUILD__`·`__BUILD_DATE__`)과 `UpdateControl` 자체 상태라 prop이 0개다.
 *  🔴 위치가 계약이다 — 스크롤 영역 안, '설정 초기화'보다 **앞**이다(v0.46.0 WP-H, 그쪽 주석 참조). */
export function SettingsFooter() {
  return (
    <>
        {/* Footer: version + build date */}
        <div
          style={{
            marginTop: 18, padding: '12px 16px 8px',
            textAlign: 'center',
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>
            v{__APP_VERSION__}{' '}
            {/* 🔴 v0.46.0 (민구 지시 08-06) — **테스트 배포본은 버전 옆에 「프리뷰」라고 적는다.**
                프리뷰는 bump를 안 하므로 프로덕션과 버전 숫자가 같아진다(08-06 실측: 둘 다 0.45.0).
                숫자만 보고는 어느 빌드인지 알 수 없어 제보 판정이 번들 grep까지 갔다. 이 배지가
                **민구가 화면에서 즉시 구분**하게 하고, 짝이 되는 로그 표식(logger.ts)이
                **분석자가 로그에서 구분**하게 한다. */}
            {__PREVIEW_BUILD__ && (
              <span
                data-testid="preview-build-badge"
                style={{
                  color: T.amber,
                  border: `1px solid ${T.amber}`,
                  borderRadius: 6, padding: '1px 6px',
                  fontSize: 11, fontWeight: 800, marginRight: 6,
                  letterSpacing: -0.2,
                }}
              >
                프리뷰
              </span>
            )}
            <span style={{ color: T.textMute, fontWeight: 500, fontSize: 12 }}>({__BUILD_DATE__})</span>
          </div>
          <div style={{ fontSize: 11, color: T.textMute, marginTop: 4 }}>
            Agri VoiceNote · mingoo.jejuagri.kang@gmail.com
          </div>
          {/* v0.18.0 1f — 수동 업데이트 확인/새로고침. 새 버전이 대기 중이면 바로 적용, 아니면
              능동 체크만 트리거(설치형에서 새 버전 반영 경로를 사용자가 직접 호출). */}
          {/* 🔴 v0.50 (2026-08-19) — **프리뷰에서도 `UpdateControl`을 렌더한다.**
              종전엔 프리뷰에 SW가 없어(v0.46.0 `disable`) 이 컴포넌트를 숨기고 *"화면을 아래로
              당겨 새로고침"* 을 안내했는데, **standalone에는 새로고침 자체가 없다** —
              민구 제보: *"프리뷰앱은 새로 고침을 할 수가 없어… 지금 보니 08-14에 만든 버전이야."*
              그 안내는 **틀린 문장**이었고 갱신 경로는 0개였다.
              👉 이제 ①프리뷰도 SW를 켜고(`vite.config.ts`) ②`UpdateControl`이 **SW에 묻지 않고**
              배포본 번들 해시와 직접 대조한다(`liveVersionProbe`) — 그래서 **빌드 종류와 무관하게**
              같은 컨트롤이 선다. 프리뷰 표식(`__PREVIEW_BUILD__`)은 위 버전 배지가 계속 쓴다. */}
          <UpdateControl />
        </div>
    </>
  );
}
