/**
 * v0.51.1 R6 — 로그 이벤트 빌더 «STT 정정·혼동» 도메인. 소비처는 `./logEvents`(배럴)에서 import한다 —
 * 바이트 계약·파서 매핑의 정본은 `PRINCIPLES.md` §4(승인 목록에 두 이벤트가 등재돼 있다).
 *
 * 둘 다 **`type:'stt'` + `extra` 접두**로 방출한다(신규 `LogEntry.type` 없음 — log-replay 호환).
 * `clipsManifest.findLastCellEvent`는 `extra`가 붙은 `stt`를 앱 주석으로 보고 건너뛰므로(v0.49 r3 #10)
 * 이 두 줄이 클립 감사 메타데이터의 원 STT text·confidence를 가리지 않는다.
 *
 * `kv`를 logEvents에서 가져오는 순환 import는 안전하다(함수 정의만 export — logEventsInstrumentation 헤더).
 */
import { kv } from './logEvents';
import { escapeExtraValue } from './logEventsInstrumentation';

/** 정정 경로. `reask`는 커밋 없이 거절된 시도(from=-) → 다음 커밋값이 정답이라는 쌍. `confusion`은 R6
 *  확인 질문(「둘째」/재발화)으로 값이 바뀐 것. */
export type SttCorrectionPath = 'direct_modify' | 'rerecord' | 'touch' | 'reask' | 'confusion';

/** 🔴 v0.51.1 R6 — **정정 쌍 명시 이벤트.** 값이 정정되는 순간 1건: 들린(파싱된) 값 → 최종값과, 그 값을
 *  만든 **원 STT 원문·신뢰도·alt 순번**. 종전엔 판독 레인이 `stt`·`value`·`command` 순서를 재구성해야
 *  훈련 쌍을 얻었다(`stt_cells.py` 300줄) — 앱이 직접 남기면 쌍이 견고해진다.
 *  `text`는 시트 불특정 자유 문자열이라 `escapeExtraValue`(`%`·`,`·`=` 이스케이프 + 24자 절단)를 거친다.
 *  형태: `stt_correction:from=<parsed|->,to=<final>,path=<…>,text=<escaped>,conf=<c|->,alt=<idx|->` */
export function sttCorrection(fields: {
  from: string | null;
  to: string;
  path: SttCorrectionPath;
  text: string | null;
  conf: number | null;
  alt: number | null;
}): string {
  return `stt_correction:${kv({
    from: fields.from ?? '-',
    to: fields.to,
    path: fields.path,
    text: fields.text ? escapeExtraValue(fields.text) : '-',
    conf: fields.conf ?? '-',
    alt: fields.alt ?? '-',
  })}`;
}

/** 🔴 v0.51.1 R6 — **혼동 후보 발동 계측.** 후보가 생성될 때마다 **정확히 1건**: 물었으면(`asked=1`)
 *  답이 정해진 뒤(「첫째」=heard · 「둘째」=alt · 값을 다시 말함=respoken · 명령/종료로 소멸=-)에 남기고,
 *  안 물었으면(`asked=0` — 셀·세션 상한) 그 자리에서 `chosen=-`로 남긴다.
 *  형태: `stt_confusion_hint:heard=<v>,cands=<a|b>,rule=<r1|r2>,asked=<0|1>,chosen=<heard|alt|respoken|->` */
export function sttConfusionHint(fields: {
  heard: string;
  cands: string[];
  rules: string[];
  asked: boolean;
  chosen: 'heard' | 'alt' | 'respoken' | null;
}): string {
  return `stt_confusion_hint:${kv({
    heard: fields.heard,
    cands: fields.cands.join('|'),
    rule: fields.rules.join('|'),
    asked: fields.asked ? 1 : 0,
    chosen: fields.chosen ?? '-',
  })}`;
}
