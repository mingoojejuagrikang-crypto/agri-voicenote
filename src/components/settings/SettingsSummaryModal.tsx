import { useEffect, useMemo, useState } from 'react';
import { T } from '../../tokens';
import { I } from '../icons';
import type { Column } from '../../types';
import { SettingsSummary, SummaryStatusRow } from './SettingsSummary';
import { ModalBase } from '../ModalBase';
import {
  ensurePastIndex,
  getFallbackBuiltAt,
  previousSurveyRound,
  readIndexWithProvenance,
  subscribePastIndexStatus,
  type PrevSurveyRound,
} from '../../lib/pastValues';
import { logger } from '../../lib/logger';
import { localTodayIso } from '../../lib/weekTuesday';
import { effectiveSampleKey } from '../../lib/columnFlags';

/**
 * v0.49.0 W3(FB-3) — 「이전 조사」 행의 3상태. 민구 원문(08-13): *"'설정요약' 팝업시 이전 조사일
 * 정보도 표기 해줄 것. 조사전 이전 조사일을 사용자가 알아야 할 경우가 있음."*
 *
 * `null`·`undefined`로 「기록 없음」과 「미확인」을 구분하지 않는다 — 호출부가 뒤바꿔 넘겨도
 * 타입이 잡아주지 못하고, 두 상태의 의미가 서로 다르기 때문이다(전자는 조회 결과, 후자는 미조회).
 */
export type PrevSurveyState =
  /** 과거값 인덱스 미로드(오프라인·미로그인·시트 미설정) **또는** 인덱스는 있으나 조회 불가.
   *  🔴 v0.49 r4 M8(claude r3 #11) — `reason`이 붙었다. 화면 문구는 둘 다 「미확인」이지만
   *  (A5 계약 — 사용자에게는 같은 상태다), **왜** 조회가 성립하지 않았는지가 로그에서 통째로
   *  비어 있었다: 순수층이 6사유를 갈라 두고도 이 소비자가 전부 버렸다. 「미확인」이 영구
   *  고정된 스키마를 다음 회차가 고치려면 그 사유가 유일한 단서다. */
  | { kind: 'unknown'; reason?: 'no_index' | PrevSurveyRoundReason }
  /** 인덱스는 있으나 이 세션 고정 키와 일치하는 과거 기록 0건.
   *  🔴 v0.49 r3 F7(codex r2) — **`stale`을 여기도 싣는다.** 종전엔 `date`에만 있어서, 최대 14일
   *  묵은 IDB 백업으로 계산한 0건을 **방금 시트를 조회해 0건인 것처럼** 그렸다. 백업 이후 시트에
   *  새 일치 행이 추가됐는데 지금 fetch가 실패한 경우가 정확히 그 상황이다 — 값 손실은 없지만
   *  조사 **전에** 보는 화면이라 판단을 오도한다. 날짜에만 출처를 밝히고 0건에는 안 밝히면
   *  「화면은 아는 만큼만 말한다」가 반쪽이 된다(A6와 같은 근거·같은 표기). */
  | { kind: 'none'; stale: boolean }
  /** 직전 조사일(오늘 미만 최신 회차). `stale` = 신선 캐시가 아니라 **IDB 영속 백업**에서 왔다. */
  | { kind: 'date'; iso: string; stale: boolean };

/** 🔴 v0.49 r2 A5(codex F4) — 「기록 없음」은 **조회 결과**일 때만 쓴다. 조회가 성립하지 않는
 *  상태(고정 키 0개·헤더 미매핑)는 「미확인」이다 — 그걸 「기록 없음」이라고 말하면 사용자가
 *  "과거 기록이 없구나"라는 **틀린 결론**을 내리고, 그 화면은 스키마를 고치기 전까지 영구 고정된다.
 *  두 상태의 판정은 `pastValues.previousSurveyRound`가 소유한다(여기서 다시 추론하지 않는다). */
function prevSurveyText(s: PrevSurveyState): string {
  // 🔴 v0.49 r2 A6(합집합 C4) — **백업 출처를 표시에 밝힌다.** 종전엔 14일까지 유효한 IDB 백업의
  //   날짜가 신선 조회분과 **픽셀 단위로 같은 문자열**이었다. 이 화면은 "조사 전에 직전 조사일을
  //   확인"하는 용도이므로, 최대 2주 묵은 인덱스에서 온 날짜를 방금 시트에서 읽은 값처럼 보이게
  //   하면 사용자가 검증할 방법이 없다(§2 — 화면은 아는 만큼만 말한다).
  if (s.kind === 'date') return s.stale ? `${s.iso} (백업)` : s.iso;
  // F7 — 0건도 출처를 밝힌다(위 타입 주석). 표기는 날짜와 **같은 꼬리**를 쓴다: 사용자가 배워야
  //   하는 규칙이 하나여야 하고, 두 상태에 다른 표기를 쓰면 그 자체가 새 어휘가 된다.
  if (s.kind === 'none') return s.stale ? '기록 없음 (백업)' : '기록 없음';
  return '미확인';
}

/**
 * 팝업을 여는 시점에 **동기로** 읽는 「이전 조사」 상태.
 *
 * 🔴 여기서 fetch하지 않는다 — 팝업 열림을 인덱스 로드가 막으면 안 된다. 프리페치가 채운 신선
 * 캐시를 보고, 없으면 IDB 영속 폴백을 본다(`trendEvaluate`와 같은 폴백 체인). 둘 다 없으면
 * 「미확인」으로 정직하게 그린다 — 재시도 nudge(`ensurePastIndex`)도 렌더 중엔 부르지 않는다.
 *
 * 기준일은 `localTodayIso` — `toISOString()`은 UTC라 KST 새벽에 하루 밀리고, strictly-< 규칙에서
 * 어제 조사분이 잘못 제외된다(농가의 아침 작업 시간대에 정확히 틀리는 값이 된다).
 */
export function readPrevSurveyState(
  columns: Column[],
  roundDateColId: string | null,
): PrevSurveyState {
  // 🔴 v0.49 r4 M6(claude r3 #10) — 출처는 `readIndexWithProvenance`가 판정한다. 종전
  //   `stale = getCachedIndex() === null`은 **다른 질문의 답**이었다: 성공한 조회는 `cached`와
  //   `fallback`에 같은 엔트리를 심으므로, 조회 10분 뒤(TTL 경과)부터 **방금 이 세션이 직접
  //   읽어 온 인덱스**가 「(백업)」으로 그려지고 아래 계측이 `age_h=0`을 남겼다 — 「최대 14일
  //   묵은 백업」이라는 강한 주장이 0시간짜리 자기 조회에 붙는다(그 헤더 참조).
  const src = readIndexWithProvenance();
  if (!src) return { kind: 'unknown', reason: 'no_index' };
  const round = previousSurveyRound(src.index, columns, roundDateColId, localTodayIso());
  // 조회 불가(고정 키 0개·헤더 미매핑)는 인덱스 미로드와 **같은 계열**이다 — 둘 다 「이 화면은
  // 답을 모른다」이지 「과거가 없다」가 아니다(A5). 사유 자체는 순수층이 들고 있다.
  // M8(#11) — 그 사유를 **버리지 않고 실어 보낸다**(화면 문구는 불변, 계측만 추가).
  if (round.kind === 'unqueryable') return { kind: 'unknown', reason: round.reason };
  // F7 — 신선도는 **답의 종류와 무관하게** 같은 출처에서 온다. 0건도 그대로 실어 보낸다.
  if (round.kind === 'none') return { kind: 'none', stale: src.stale };
  return { kind: 'date', iso: round.iso, stale: src.stale };
}

/**
 * 🔴 v0.49 r2 — 「이전 조사」 상태의 **소유자**. 종전엔 `SettingsScreen`이 렌더 중에
 * `readPrevSurveyState(...)`를 직접 호출해 prop으로 내려줬다. 그래서:
 *
 *  - **A9(합집합 C13)** 팝업이 열려 있는 동안 설정 store에 쓰기가 한 번 일어날 때마다 화면이
 *    다시 렌더되고, 그때마다 인덱스 **전수 스캔**(`previousSurveyRound`의 이중 루프)이 돌았다.
 *    입력 하나 바꿀 때마다 수천 행을 다시 훑는다. 여기서 `useMemo`로 잠근다 — 키는 실제로 답을
 *    바꾸는 셋(columns · roundDateColId · 인덱스 상태 버전)뿐이다.
 *  - **B1(민구 결정 08-13 ⓐ)** 팝업을 여는 순간 준비를 **깨운다**. 종전엔 부팅 프리페치의
 *    `shouldPreparePastIndex`(이상치 규칙이 하나라도 있어야 true)에 막혀, 규칙 없는 기본
 *    스키마에서는 캐시를 만들 경로가 아예 없어 영원히 「미확인」이었다. 이 진입로에서는 그
 *    술어를 적용하지 않는다(민구 확정) — 시트 미지정·미로그인은 `loadPastIndex`가 스스로
 *    skip하며 사유를 로깅하므로 여전히 「미확인」이고, 헛된 네트워크도 없다.
 *    🔑 **5개 기존 호출부(부팅·로그인·설정 저장 등)의 술어는 불변이다** — 설계 결정 범위 밖.
 *  - 준비가 끝나면 `subscribePastIndexStatus`가 깨워 **열려 있는 팝업의 값이 갱신된다**
 *    (`notifyStatusChanged` 전례 — 3상태 배지가 쓰는 그 신호다).
 *  - **A6(합집합 C4)** 답이 백업에서 왔으면 `past_index_used_stale`를 남긴다. `pastValues.ts`가
 *    폴백 계약으로 *"폴백 사용 시 호출자가 로깅한다"* 를 명시하는데 이 신규 소비자만 빠져 있었다.
 *    ⚠️ 이벤트 **이름을 새로 만든다** — `trend_used_stale_index`에 얹으면 이상치 알람의
 *    stale 사용 집계가 설정 팝업 열람으로 오염된다(PRINCIPLES §4: 늘릴 땐 새 이름).
 */
type PrevSurveyRoundReason = Extract<PrevSurveyRound, { kind: 'unqueryable' }>['reason'];

/** #9 — stale 계측의 세션 스코프 dedupe 집합(의미 키). `trendSkipLoggedRef`와 같은 컨벤션이고,
 *  차이는 소유자가 훅 ref가 아니라 모듈이라는 점뿐이다 — 이 팝업은 열 때마다 **새로 마운트**되므로
 *  ref로 들면 열람 횟수만큼 다시 기록된다(그게 이 결함의 절반이다). */
const staleLogged = new Set<string>();
/** M8(#11) — 조회 불가 사유 계측의 dedupe. `staleLogged`와 같은 컨벤션·같은 이유(모듈 스코프). */
const unqueryableLogged = new Set<string>();

function usePrevSurvey(columns: Column[], roundDateColId: string | null): PrevSurveyState {
  const [version, setVersion] = useState(0);
  useEffect(() => subscribePastIndexStatus(() => setVersion((v) => v + 1)), []);
  // 열림 = 마운트(호출부가 조건부 렌더한다). 준비 nudge는 열 때 1회.
  useEffect(() => { ensurePastIndex(); }, []);
  const state = useMemo(
    () => readPrevSurveyState(columns, roundDateColId),
    [columns, roundDateColId, version],
  );
  // 🔴 v0.49 r3 #9(= codex F9) — **의미 키로 dedupe한다.** 종전 dep은 `[state]`였는데, 위
  //   `useMemo`의 키에 `version`이 들어 있고 로더가 시작·종료 **양쪽에서** `notifyStatusChanged()`를
  //   부르므로, 같은 답이어도 매 통지마다 **새 객체**가 나와 effect가 다시 돈다. 오프라인 1회
  //   열람에서 같은 `past_index_used_stale:summary`가 여러 번 기록됐다(A6 지표가 팝업 열람 수보다
  //   부풀고, 그 로그를 세는 A9 단언도 함께 무의미해진다). 계약은 「한 번의 상태에 한 번」이다.
  //   키는 `stale + iso + builtAt` — 백업이 갱신되거나 답이 바뀌면 **다시** 기록돼야 한다
  //   (그건 새 사건이다). 모듈 스코프라 팝업 재열람에도 살아 있다(= 앱 세션 1회, A6 의도).
  //   F7 — 0건(`none`)도 stale이면 같은 계측을 낸다. 날짜에만 계측하면 「백업으로 답했다」는
  //   집계가 답의 종류에 따라 갈려, stale 사용률 자체가 절반만 보인다.
  const staleKey = state.kind === 'unknown' || !state.stale
    ? null
    : `${state.kind}:${state.kind === 'date' ? state.iso : 'none'}:${getFallbackBuiltAt() ?? -1}`;
  useEffect(() => {
    if (staleKey === null || staleLogged.has(staleKey)) return;
    staleLogged.add(staleKey);
    const builtAt = getFallbackBuiltAt();
    const ageH = builtAt == null ? -1 : Math.round((Date.now() - builtAt) / 3_600_000);
    logger.log({ type: 'app', extra: `past_index_used_stale:summary,age_h=${ageH}` });
  }, [staleKey]);
  // 🔴 v0.49 r4 M8(claude r3 #11) — **조회 불가 사유를 남긴다.** 순수층이 7사유를 갈라 두고도
  //   (A5 + r3 #3 + M8) 이 소비자가 전부 「미확인」으로 접어 버려, 화면이 영구 고정된 스키마를
  //   다음 회차가 어느 축(샘플키·헤더·회차·인덱싱)에서 고쳐야 하는지 로그로 알 수 없었다.
  //   ⚠️ 이벤트 이름은 **새로 만든다**(PRINCIPLES §4) — `past_index_skip:*`은 로더의 진입 스킵
  //   (미설정·미로그인)이라 의미가 다르고, 얹으면 두 축의 집계가 섞인다. 화면 문구는 불변이다.
  // 🔴 v0.49 r5 Z9(claude #12) — **dedupe 키가 사유 하나뿐이라 「새 사건」을 삼켰다.**
  //   형제 `staleKey`는 `getFallbackBuiltAt()`를 키에 넣어 *"백업이 갱신되거나 답이 바뀌면
  //   다시 기록돼야 한다 — 그건 새 사건이다"* 를 지킨다. 이쪽은 `reason`만 봐서, 스키마를
  //   고쳤다가 **다른 스키마에서 같은 사유로 또 막히면** 앱 수명 내내 두 번째가 안 남는다.
  //   그러면 이 계측의 목적(*"다음 회차가 어느 축에서 고쳐야 하는지"*)이 첫 스키마에 갇힌다.
  //   키에 **스키마 축**을 얹는다 — 사유는 *어느 스키마가 조회 불가인가*에 대한 답이므로,
  //   고정 키 컬럼 구성이나 회차 컬럼이 바뀌면 그건 다른 사건이다.
  //   ⚠️ 모듈 스코프는 유지한다(팝업은 열 때마다 재마운트된다 — 그게 #9 결함의 절반이었다).
  const unqueryableKey = state.kind === 'unknown' && state.reason
    // 🔴 v0.49 r6 Y11(claude #12) — 키의 스키마 축은 **`effectiveSampleKey`**로 센다. 판정을
    //   실제로 하는 `pastValues.fixedKeyColumns`가 그 술어를 쓰는데(columnFlags SSOT: 사용자
    //   토글 > 자동 유추), 여기만 원시 플래그 `c.sampleKey`를 읽었다. 그래서 **자동 유추로만
    //   키가 갈린 스키마 변경**은 dedupe 키가 그대로라 「새 사건」이 또 삼켜진다 — Z9 #12가
    //   고치려던 그 형태가 한 겹 안쪽에 남아 있었다.
    ? `${state.reason}:${roundDateColId ?? '-'}:${columns.filter((c) => effectiveSampleKey(c)).map((c) => c.id).join(',')}`
    : null;
  const unqueryableReason = state.kind === 'unknown' ? (state.reason ?? null) : null;
  useEffect(() => {
    if (unqueryableKey === null || unqueryableReason === null || unqueryableLogged.has(unqueryableKey)) return;
    unqueryableLogged.add(unqueryableKey);
    // 로그 바이트는 불변이다(사유 단독) — 갈린 것은 **얼마나 자주 남기는가**뿐이다(§4).
    logger.log({ type: 'app', extra: `past_index_unqueryable:summary,reason=${unqueryableReason}` });
  }, [unqueryableKey, unqueryableReason]);
  return state;
}

export function SettingsSummaryModal({
  googleConnected, userEmail, sheetLabel, columns, totalRows, sessionLabel,
  recognitionTolerance, ttsRate, fastRecognition, tableGenerated, generatedRows,
  roundDateColId, onClose,
}: {
  googleConnected: boolean;
  userEmail: string | null;
  sheetLabel: string | null;
  columns: Column[];
  totalRows: number;
  sessionLabel: string;
  recognitionTolerance: number;
  ttsRate: number;
  fastRecognition: boolean;
  tableGenerated: boolean;
  generatedRows: number;
  /** v0.49 r2 A9/B1 — 상태를 **prop으로 받지 않는다.** 렌더마다 전수 스캔하던 소유권을 이 컴포넌트
   *  안으로 옮겼다(usePrevSurvey 주석). 팝업이 재료(컬럼·회차 컬럼)만 받고 답은 스스로 만든다. */
  roundDateColId: string | null;
  onClose: () => void;
}) {
  const prevSurvey = usePrevSurvey(columns, roundDateColId);
  return (
    // 🔴 v0.51 P0-1(민구 확정 08-31) — **보기 전용이므로 나비를 남긴다.** 액션 prop이 `onClose`
    //   하나뿐인 요약 표시 모달이다(작성 중 입력도, 파괴적 확인도 없다 — 이탈로 잃을 것이 없다).
    <ModalBase
      onClose={onClose}
      testid="settings-summary-modal"
      role="dialog"
      ariaModal
      ariaLabel="설정 요약"
      blur
      animation="fade-up 200ms ease-out"
      bottomInset="var(--nav-h)"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        data-testid="settings-summary-card"
        style={{
          background: T.card, borderRadius: 18, border: `1px solid ${T.line}`,
          width: '100%', maxWidth: 480, maxHeight: '84vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div
          style={{
            padding: '14px 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: `1px solid ${T.line}`,
          }}
        >
          <div style={{ fontSize: 17, fontWeight: 700, color: T.text }}>설정 요약</div>
          <button
            onClick={onClose}
            aria-label="닫기"
            style={{
              width: 36, height: 36, borderRadius: 18,
              border: 'none', background: 'rgba(255,255,255,0.06)',
              color: T.textDim, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {I.close(18, T.textDim)}
          </button>
        </div>

        {/* v0.49.0 W3 — 「이전 조사」 행이 늘면서 375×812 무스크롤 예산(카드 maxHeight 84vh)을
            5px 초과했다. 세로 gap을 조여 회수한다(10→8 · 6→4). 무스크롤은 팝업의 계약이다.
            🔴 v0.49 r3 #12(claude r2 LOW) — **본문에 넘침 출구를 준다**(`minHeight:0` + `overflowY:auto`).
            카드는 `maxHeight:84vh`인데 넘침 처리가 **없어서**, 컬럼이 많은 스키마에서는 내용이
            그냥 잘렸다(375×812 실측: 측정 컬럼 12개 → 카드 682px = 예산 상한, `scrollHeight -
            clientHeight = 4px`). 잘린 부분은 사용자가 볼 방법이 없다. 스크롤 컨테이너를 **본문에만**
            두면 헤더(×)와 하단 [닫기]는 항상 고정으로 남는다 — 넘쳐도 출구를 잃지 않는다.
            ⚠️ 「무스크롤」 계약은 그대로다: 기본 스키마에서는 넘치지 않아 스크롤바가 서지 않는다
            (같은 실측: 카드 502px · 예산 682px · 넘침 0 — 여유 180px). 이건 계약의 완화가 아니라
            **계약이 깨졌을 때의 출구**다. `minHeight:0`이 없으면 flex 자식이 안 줄어 `overflowY`가
            무효다(그래서 둘은 한 쌍이다). */}
        <div
          style={{
            padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8,
            minHeight: 0, overflowY: 'auto',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <SummaryStatusRow
              label="Google"
              value={googleConnected ? `연결됨 · ${userEmail ?? ''}` : '미연결'}
              ok={googleConnected}
            />
            <SummaryStatusRow label="시트" value={sheetLabel ?? '미연결'} ok={!!sheetLabel} />
            <SummaryStatusRow
              label="테이블"
              value={tableGenerated ? `생성됨 · 총 ${generatedRows}행` : '미생성'}
              ok={tableGenerated}
            />
            {/* v0.49.0 W3(FB-3) — 조사 시작 전에 "직전에 언제 조사했는지"를 알아야 하는 경우가 있다.
                세션 고정 샘플키 조합 기준(pastValues.previousSurveyRound). */}
            <SummaryStatusRow
              label="이전 조사"
              value={prevSurveyText(prevSurvey)}
              ok={prevSurvey.kind === 'date'}
            />
          </div>
          <SettingsSummary columns={columns} totalRows={totalRows} sessionLabel={sessionLabel} />
          {/* 다이얼·토글 한 줄 요약(입력탭 다이얼 값 포함 — 설정을 한눈에). */}
          <div
            style={{
              textAlign: 'center', fontSize: 12, fontWeight: 700, color: T.textDim,
              fontFamily: 'JetBrains Mono, ui-monospace, monospace', letterSpacing: -0.2,
            }}
          >
            인식 {Math.round(recognitionTolerance * 100)}% · 안내 {ttsRate}x · 빠른 인식 {fastRecognition ? 'ON' : 'OFF'}
          </div>
        </div>

        <div style={{ padding: '12px 16px', borderTop: `1px solid ${T.line}` }}>
          <button
            onClick={onClose}
            style={{
              width: '100%', height: 48, borderRadius: 14, border: 'none',
              background: T.blue, color: '#fff',
              fontSize: 15, fontWeight: 800, cursor: 'pointer',
              boxShadow: `0 4px 14px ${T.blueGlow}`,
            }}
          >
            닫기
          </button>
        </div>
      </div>
    </ModalBase>
  );
}

/** 초기화 모달의 체크박스 행(44px 터치 타깃, 라벨 전체가 탭 영역). */
