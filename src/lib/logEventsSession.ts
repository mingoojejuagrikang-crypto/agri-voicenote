/**
 * v0.49 R1 리팩토링 P1-3 — 로그 이벤트 빌더 «세션·행 진행» 도메인
 * (logEvents.ts에서 순수 이동 — 500줄 게이트).
 *
 * 🔴 소비처는 계속 `./logEvents`(배럴)에서 import한다 — 바이트 계약·SOP-003 파서 매핑·계약
 * 전문은 `logEvents.ts` 헤더가 정본이다. 방출 문자열은 이동 전과 바이트 동일
 * (tests/logEvents.spec.ts 특성화 테스트가 고정). `kv` 순환 import는 logEventsAudio.ts 헤더 참조.
 */
import { kv, escapeExtraValue } from './logEvents';

/** `${kind}:${row},src=${source}` — 행 완료/스킵 계측(SOP-003 진행 파서 대상).
 *  v0.44.0 §C8 F13 — `row_last_stop` 추가: '다음'이 마지막 행 경계에서 이동 없이 멈춘 사건
 *  (jump 이벤트가 없어 이 계측이 유일한 흔적이다). */
export function rowMarked(kind: 'row_complete' | 'row_skipped' | 'row_last_stop', row: number, source: string): string {
  return `${kind}:${row},src=${source}`;
}

/** [EXIT-PERSIST-1] 끝 도달 상태에서 CenterStage가 실제 선택한 렌더 분기. */
export function endReachedRender(fields: {
  branch: 'paused' | 'anomaly' | 'end' | 'modify' | 'hero';
  alertStatus: 'none' | 'pending' | 'corrected';
}): string {
  return `end_reached_render:${kv(fields)}`;
}

/** [EXIT-PERSIST-1] 이상치 알람 객체가 화면에서 내려간 경로와 직전 상태. */
export function anomalyAlertCleared(fields: {
  reason: string;
  hadStatus: 'pending' | 'corrected';
}): string {
  return `trend_alert_cleared:${kv(fields)}`;
}

/** v0.43.0 #3 — **저신뢰인데 파싱돼서 커밋된 값.** 종전에는 신뢰도 게이트가 파서보다 앞에 있어
 *  이 발화들이 파싱 시도조차 없이 버려졌다(07-30 실기기: `300` conf 0.097 · `190` conf 0.021).
 *  순서를 뒤집었으니 이제 통과한다 — **그 판단이 옳았는지 다음 회차에 가릴 모수가 필요하다.**
 *
 *  🔴 **왜 `value` 이벤트에 붙이는가**(plan §2-5-b 4번 · [ORCH-47]):
 *   - 신규 LogEntry 타입을 안 만든다 → log-replay 호환. 링버퍼 2000개 압박도 **0 증가**
 *     (이미 발행되는 커밋 이벤트에 문자열 하나를 더할 뿐, 별도 이벤트를 늘리지 않는다).
 *   - ⛔ **기존 `stt_rejected_low_confidence`를 확장하지 않는다.** 커밋된 건에 "rejected"
 *     이벤트를 내면 **거절률의 분모가 오염된다** — 이 계측이 만들려는 바로 그 모수가 망가진다.
 *
 *  판정 방법: 이 마커가 달린 커밋값을 `SOP-003 §3` 클립 감사로 시트값과 대조한다.
 *  어긋나면 확정안(파싱되면 신뢰도 무관 커밋)이 오인식을 통과시킨 것이고, 맞으면 옳았던 것이다. */
export function lowConfidenceParsed(fields: {
  conf: number;
  minConf: number;
  /** 다이얼 위치(recognitionTolerance). minConf와 함께 실어 반전식을 몰라도 읽히게 한다. */
  tolerance: number;
  /** 어느 경로로 파싱됐나 — primary 그대로인지, alt 폴백인지, 소수부 합성인지. */
  via: 'primary' | 'alt' | 'frac';
}): string {
  return `low_conf_parsed:${kv(fields)}`;
}

/** v0.49 r2 W4 섀도 계측(보조 `type:'stt'` 라인) — **관측이 아니라 합성값**이다. 접두를 상수로
 *  올린 이유는 소비자(`clipsManifest.findLastCellEvent`)가 그걸 판별해야 하기 때문 — 사유는 그쪽 A3 주석. */
export const WOULD_SALVAGE_PREFIX = 'would_salvage:';
export const wouldSalvage = (candidate: string): string => `${WOULD_SALVAGE_PREFIX}${candidate}`;

/** v0.51.1 B1 (제보① 2026-09-02) — 세션 시작이 **구성 때문에** 차단된 사건. 종전 `vc.length === 0`
 *  갈래는 무로그 return이라 14:51:10 `ready_probe` 뒤 16초가 통째로 비어 있었다(read-fb F1).
 *  `__app__` 세션으로 남긴다 — 차단 시점엔 새 세션 id가 없고, 직전 세션 id에 얹으면 남의 세션에 귀속된다. */
export function sessionStartBlocked(reason: 'no_voice_columns'): string {
  return `session_start_blocked:reason=${reason}`;
}

/** v0.51.1 B2 (제보② 2026-09-02) — 끝 도달(atEnd)에서 명령이 아닌 발화가 **흡수**된 사건. 종전엔 무로그라
 *  「수정」이 '회'(0.243)로 오인식된 15:49:39는 `stt` 줄 다음에 곧장 끝 도달 안내 TTS만 남았다(read-fb F3).
 *  `cell_wait_absorb:<colId>`와 같은 꼴 — `command` 이벤트에 `parsed:'end_absorb'`로 실린다. */
export function endAbsorb(colId: string): string {
  return `end_absorb:${colId}`;
}

/** v0.51.1 L (민구 지시 2026-09-02) — **동기화 완료 계측**(세션당·동기화당 1건). 종전엔 어느 시트에 몇 행이
 *  붙었는지가 `sessions.json`에만 있었고 events.json엔 `sync|sheet|append` 문자열이 0건이었다.
 *  `sheet`는 spreadsheetId **앞 8자**(PII 최소화) · `tab`은 `escapeExtraValue`로 감싼다(`,`·`=`·`%` 이스케이프 —
 *  ⚠️ 24자를 넘는 탭 이름은 `~`로 잘린다) · `rows`는 이번 동기화가 쓴 시트 행의 최소-최대(1-based).
 *  🔴 행 번호를 모르면(`sync_append_no_range` — updatedRange 파싱 실패) `rows=0-0`이다(0은 유효한 시트 행이 아니다).
 *  `n`은 이번 동기화가 밀어 올린 행 수(append + update). 예: `sheet_synced:sheet=1ov3FvV-,tab=품질조사,rows=200-217,n=18`. */
export function sheetSynced(fields: { sheet: string; tab: string; from: number; to: number; n: number }): string {
  return `sheet_synced:sheet=${fields.sheet},tab=${escapeExtraValue(fields.tab)},rows=${fields.from}-${fields.to},n=${fields.n}`;
}

/** v0.53.0 C13 (민구 Q4 ⓐ) — **시트 올리기 합계 계측**(동기화 1회당 1건).
 *  방출: sync.ts syncSelected() 마지막 return report 직전 1곳.
 *  형태: sync_summary:ok=<ok>,failed=<failed>,rows=<rows>,updated=<updated>,fallback=<fallback> */
export function syncSummary(fields: {
  ok: number;
  failed: number;
  rows: number;
  updated: number;
  fallback: number;
}): string {
  return `sync_summary:ok=${fields.ok},failed=${fields.failed},rows=${fields.rows},updated=${fields.updated},fallback=${fields.fallback}`;
}

export interface SessionHealthSummaryInput {
  cells: number;
  reask: number;
  lowconf: number;
  alarm: string | { fired: number; confirmed: number };
  sttErr: number;
  wakeFail: number;
  authSkip: number;
  corr: string;
  confQ: string | { asked: number; hit: number };
  modMishear: number;
}

/** v0.53.0 C1a (민구 Q2 ⓐ · Q3 ⓐ · Q6 ⓐ) — **세션 결산 계측**(세션 1회당 1건).
 *  방출: stop()의 persistSession() 직후(`if (!durable)` 앞).
 *  형태: session_health:cells=<n>,reask=<n>,lowconf=<n>,alarm=<fired>/<confirmed>,sttErr=<n>,wakeFail=<n>,authSkip=<n>,corr=<…>,confQ=<asked>/<hit>,modMishear=<n> */
export function sessionHealth(fields: SessionHealthSummaryInput): string {
  const alarmStr = typeof fields.alarm === 'string'
    ? fields.alarm
    : `${fields.alarm.fired}/${fields.alarm.confirmed}`;
  const confQStr = typeof fields.confQ === 'string'
    ? fields.confQ
    : `${fields.confQ.asked}/${fields.confQ.hit}`;
  return `session_health:cells=${fields.cells},reask=${fields.reask},lowconf=${fields.lowconf},alarm=${alarmStr},sttErr=${fields.sttErr},wakeFail=${fields.wakeFail},authSkip=${fields.authSkip},corr=${fields.corr},confQ=${confQStr},modMishear=${fields.modMishear}`;
}

/** v0.53.0 R7 (민구 Q7 ⓐ) — 세션 결산 생략 계측(새로고침 복원 등 비정상 추적 세션).
 *  방출: stop()의 persistSession() 직후(`if (!durable)` 앞)에서 trackerSessionId !== sessionIdRef.current일 때.
 *  형태: session_health_skip:reason=restored */
export function sessionHealthSkip(fields: { reason: 'restored' }): string {
  return `session_health_skip:reason=${fields.reason}`;
}


