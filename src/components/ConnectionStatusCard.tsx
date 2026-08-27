/**
 * v0.33.0 항목5 — 연결 3상태 분리 표시 (07-10 QA P1 #1).
 *
 * 종전엔 "연결" 상태가 googleConnected(persist) 하나로 뭉뚱그려져, 토큰 만료 후에도 '연결됨'을
 * 거짓 표시했고([AUTH-7] stale 표시), 이상치 알람의 실제 가용성(과거값 인덱스)은 아예 보이지
 * 않았다(07-13 §4: 알람 침묵을 사용자가 알 방법이 없음). 이 카드는 세 상태를 분리해 보인다:
 *
 *  1. Google 연결 — **실시간 판정**(persist 값을 그대로 믿지 않는다). 30s 폴링 + onTokenSettled
 *     구독으로 갱신 → stale 표시 해소.
 *     🔴 v0.51 — 판정 축이 「유효 토큰」에서 **「유효 토큰 ∪ 살아 있는 4주 연결창」**으로 바뀌었다.
 *     강등 분기(`useSettingsSheetConnection`)와 같은 술어여야 화면 두 곳이 갈리지 않는다.
 *  2. 시트 연결 — 시트 URL(파싱 성공) + 탭 선택 여부. 저장 목록의 파일명으로 표기.
 *  3. 과거값 준비 — pastValues 상태 스냅샷: "N행 · M회차 준비됨(x시간 전)". 신선 캐시(green) /
 *     영속 폴백(amber, 오래된 비교선) / 불러오는 중 / 미준비 + **재시도 버튼**(백오프 리셋).
 *
 * 설정탭 + 입력탭 시작 카드 양쪽에서 재사용. 텍스트에 '연결됨'을 쓰지 않는다 — 설정탭 Google
 * 버튼("연결됨 · email")과 `text=연결됨` 로케이터(auth-signin-timeout.spec) strict mode 충돌 방지.
 */
import { useEffect, useState } from 'react';
import { T } from '../tokens';
import { useSettingsStore } from '../stores/settingsStore';
import { getStoredToken, onTokenSettled } from '../lib/googleAuth';
import { isConnectionAlive } from '../lib/googleConnection';
import { parseSpreadsheetId, readonlySheetsAuth } from '../lib/sheets';
import {
  getPastIndexStatus,
  prefetchPastIndex,
  resetPastIndexRetries,
  subscribePastIndexStatus,
} from '../lib/pastValues';
import { logger } from '../lib/logger';

/** epoch ms → "방금" / "N분 전" / "N시간 전" / "N일 전". */
function formatAge(builtAt: number, now: number): string {
  const diff = Math.max(0, now - builtAt);
  if (diff < 60_000) return '방금';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  return `${Math.floor(diff / 86_400_000)}일 전`;
}

/** v0.35.0 항목8(Vance) — 과거값 준비 완료(ready) 표식. 중앙 카드 커밋 ✓(VoiceHero CheckMark)와
 *  동일한 시각 언어: 굵은 녹색 원 + 흰 체크 + 녹색 글로우. 상태 카드용으로 18px 고정(인라인). 지속
 *  표식이라 진입 애니메이션은 두지 않는다(커밋 ✓의 check-pop과 달리 상시 상태). */
function ReadyCheckBadge() {
  return (
    <span
      aria-hidden
      data-testid="conn-past-check"
      style={{
        flexShrink: 0, width: 18, height: 18, borderRadius: '50%',
        background: T.green,
        // v0.35.0 FIX-8(리뷰 라운드1) — glow 반경 축소(8→4px): Dynamic Type 확대 시 윗행 겹침 방지.
        boxShadow: '0 0 4px rgba(57,255,20,0.55)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <svg viewBox="0 0 24 24" width="62%" height="62%" fill="none" stroke="#fff" strokeWidth={3.6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 12.5l5 5L20 6" />
      </svg>
    </span>
  );
}

function StatusRow({ label, value, tone, testId, action, lead }: {
  label: string;
  value: string;
  tone: 'ok' | 'warn' | 'off';
  testId: string;
  action?: React.ReactNode;
  /** 값 텍스트 바로 앞(오른쪽 정렬 유지)에 붙는 표식(예: 과거값 ready ✓). */
  lead?: React.ReactNode;
}) {
  const color = tone === 'ok' ? T.green : tone === 'warn' ? T.amber : T.textMute;
  return (
    <div data-testid={testId} data-tone={tone} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, minHeight: 28 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: T.textDim, flexShrink: 0, width: 64 }}>
        {label}
      </span>
      <span
        style={{
          flex: 1, minWidth: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6,
        }}
      >
        {lead}
        <span
          style={{
            minWidth: 0, fontSize: 13, fontWeight: 700, color,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}
          title={value}
        >
          {value}
        </span>
      </span>
      {action}
    </div>
  );
}

export function ConnectionStatusCard() {
  const s = useSettingsStore();
  // 실시간 재평가 틱: 토큰 만료(시간 경과)·배지 나이 표기를 30s 주기로 갱신 +
  // 과거값 인덱스 상태 변화(fetch 시작/완료/폴백 하이드레이션)는 구독으로 즉시 반영.
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    const unsubIndex = subscribePastIndexStatus(bump);
    const unsubToken = onTokenSettled(bump);
    const timer = window.setInterval(bump, 30_000);
    return () => { unsubIndex(); unsubToken(); window.clearInterval(timer); };
  }, []);

  // 1) Google 연결 — **연결창 기준 실시간 판정**(v0.51). 강등 분기(useSettingsSheetConnection)와
  //    **같은 술어**를 쓴다: 유효 토큰이 있거나 4주 연결창이 살아 있으면 연결된 것이다.
  //
  //    v0.33.0 항목5의 원래 판정은 「토큰만」이었고, 그건 [AUTH-7](persist가 true인데 모든 호출이
  //    실패하는 거짓 표시)의 해소였다. v0.51에서 그 전제가 바뀐다 — 창 안에서 토큰이 만료돼도
  //    제스처 지점(동기화 클릭·세션 시작)에서 무팝업으로 조용히 갱신되므로, 매시간 '재로그인 필요'로
  //    깜빡이는 쪽이 오히려 사실과 멀다. 🔴 남는 대가는 **제스처 밖 경로**(부팅 프리페치 등)가
  //    여전히 토큰 없이 실패할 수 있다는 것이고, 그건 계획서 §3 한계로 민구가 승인한 축이다.
  //    (아래 30s 폴링 틱이 창 만료 순간도 그대로 잡는다 — 판정이 시각 함수라서.)
  const token = getStoredToken();
  const connectionAlive = isConnectionAlive();
  const linked = !!token || connectionAlive;
  const knewAccount = !!(s.userEmail || s.googleConnected);
  // ⚠️ 텍스트에 '연결됨'을 쓰지 않는다 — 파일 머리 주석의 strict mode 계약(설정탭 Google 버튼과
  //    `text=연결됨` 로케이터 충돌). 창만 살아 있는 경우도 같은 '로그인됨' 문구를 쓴다.
  const googleValue = linked
    ? `로그인됨 · ${token?.email ?? s.userEmail ?? ''}`
    : knewAccount ? '재로그인 필요' : '미로그인';
  const googleTone: 'ok' | 'warn' | 'off' = linked ? 'ok' : knewAccount ? 'warn' : 'off';

  // 2) 시트 연결 — URL 파싱 + 탭 선택. 저장 목록의 파일명으로 표기(요약 팝업과 동일 규칙).
  const sheetId = parseSpreadsheetId(s.sheetUrl);
  const sheetName = sheetId ? s.savedSheets.find((x) => x.sheetId === sheetId)?.name ?? '시트' : null;
  const sheetValue = sheetId
    ? `${sheetName}${s.sheetTab ? ` · ${s.sheetTab}` : ''}`
    : '미선택';
  const sheetTone: 'ok' | 'warn' | 'off' = sheetId && s.sheetTab ? 'ok' : sheetId ? 'warn' : 'off';

  // 3) 과거값 준비 — 알람 비교선의 실제 가용성.
  const idx = getPastIndexStatus();
  const now = Date.now();
  /** 🔴 v0.46.1 WP-2(민구 제보 FB-1 · 08-07) — **「미준비」가 이유를 안 알려줬다.**
   *
   *  민구 원문: *"과거값 준비가 자동으로 실행 되지 않음. **구글 로그인했고, 스프레드시트 링크가
   *  이미 있음에도** 과거값 자동 로드가 그린이 아냐."*
   *
   *  🔑 **로그 분석 결과 버그가 아니었다.** 08-07 실기기에서 조회는 4회 전부 1초 만에 성공했고
   *  (`past_index_ready:rows=2902` ×4), 실패·skip은 0건이었다. 다만 프리페치 게이트
   *  (`shouldPreparePastIndex`)가 **이상치 규칙이 있는 컬럼**을 요구하는데, 민구가 제보한 10:24엔
   *  아직 테이블 생성 전이라 컬럼이 없었다. 생성하자(10:28) 곧바로 돌았다.
   *
   *  👉 민구가 확정한 처방: **"표시를 정직하게"**. 동작은 그대로 두고 **왜 아직 아닌지**만 밝힌다.
   *  🔴 게이트를 푸는 선택지는 **기각됐다** — 이상치 규칙이 없는 시트에서도 전체 시트를 받게 돼
   *  통신량·배터리를 낭비한다(그 게이트는 Codex·agy 리뷰가 의도적으로 넣은 것이다). */
  const anyAnomalyRule = s.columns.some(
    (c) => c.trendRule === 'increase' || c.trendRule === 'decrease' || c.pctThreshold != null,
  );
  // 🔴 **인증 판정은 `readonlySheetsAuth()`가 SSOT다** — 토큰이 없어도 **API key로 공개 시트를
  //    읽는 경로**가 살아 있다(v0.34.0 C9). 여기서 `token`만 보면 그 경로를 「로그인 필요」로
  //    잘못 막는다(실측: `past-index-fallback` 오라클 2건이 이걸 잡았다).
  //    그리고 `s.googleConnected`(persist)도 쓰지 않는다 — 만료 시 같은 카드의 Google 행과
  //    갈려 `[AUTH-7]`(stale 표시)이 재발한다.
  const readAuth = readonlySheetsAuth();
  const notReadyReason = !readAuth ? '로그인 필요'
    : !sheetId || !s.sheetTab ? '시트 연결 필요'
    : !s.tableGenerated ? '테이블 생성 후 준비됩니다'
    : !anyAnomalyRule ? '이상치 알람 규칙이 없어 사용 안 함'
    : '미준비';
  /** 지금 조회를 **시도할 수 있는가**. 전제가 안 갖춰졌으면 재시도 버튼은 눌러도 아무 일이
   *  안 일어나므로 보이지 않는 게 정직하다(`[TEAMOPS-7]` — 무의미한 어포던스는 신뢰를 깎는다). */
  const canPreparePastIndex =
    !!readAuth && !!sheetId && !!s.sheetTab && s.tableGenerated && anyAnomalyRule;
  const idxValue =
    idx.state === 'ready' || idx.state === 'stale'
      ? `${idx.rowCount}행 · ${idx.roundCount}회차 준비됨(${formatAge(idx.builtAt ?? now, now)})`
      : idx.state === 'loading' ? '불러오는 중…' : notReadyReason;
  const idxTone: 'ok' | 'warn' | 'off' =
    idx.state === 'ready' ? 'ok' : idx.state === 'stale' ? 'warn' : 'off';
  const showRetry = idx.state === 'stale' || (idx.state === 'none' && canPreparePastIndex);

  const retry = showRetry ? (
    <button
      type="button"
      data-testid="past-index-retry"
      onClick={() => {
        logger.log({ type: 'app', extra: 'past_index_retry:manual' });
        resetPastIndexRetries();
        prefetchPastIndex();
      }}
      style={{
        flexShrink: 0, minHeight: 28, padding: '0 10px', borderRadius: 999,
        border: `1px solid ${T.lineStrong}`, background: 'transparent',
        color: T.textDim, fontSize: 12, fontWeight: 800, cursor: 'pointer',
      }}
    >
      재시도
    </button>
  ) : undefined;

  return (
    <div
      data-testid="connection-status-card"
      style={{
        background: T.card, border: `1px solid ${T.line}`, borderRadius: 14,
        padding: '10px 14px',
        display: 'flex', flexDirection: 'column', gap: 4,
        width: '100%',
      }}
    >
      <StatusRow label="Google 연결" value={googleValue} tone={googleTone} testId="conn-google" />
      <StatusRow label="시트 연결" value={sheetValue} tone={sheetTone} testId="conn-sheet" />
      <StatusRow
        label="과거값 준비"
        value={idxValue}
        tone={idxTone}
        testId="conn-past"
        action={retry}
        // v0.35.0 항목8 — ready(신선 캐시=로그인+시트연결로 프리페치 완료)일 때만 굵은 녹색 ✓.
        //   stale(영속 폴백)/loading/none엔 표식 없음(기존 표기 유지). 프리페치 트리거/TTL 무변경.
        lead={idx.state === 'ready' ? <ReadyCheckBadge /> : undefined}
      />
    </div>
  );
}
