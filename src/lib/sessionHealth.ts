/**
 * src/lib/sessionHealth.ts — 세션 결산 이벤트(session_health) + 화면 요약 한 줄.
 *
 * 카운터 로직은 브라우저·스토어 의존 없는 순수 모듈로 구현하여 Node 스펙에서 단독 검증 가능.
 * 모듈 싱글턴으로 앱 수명 동안 1회 logger.subscribe에 연결된다.
 */
import { logger, type LogEntry } from './logger';

export interface SessionHealthSavedColumn {
  id: string;
  name: string;
  input?: string;
}

export interface SessionHealthSavedRow {
  index: number;
  values: Record<string, string>;
}

export interface SessionHealthSavedInput {
  columns?: ReadonlyArray<SessionHealthSavedColumn>;
  rows?: ReadonlyArray<SessionHealthSavedRow>;
}

export interface SessionHealthSummary {
  cells: number;
  reask: number;
  lowconf: number;
  alarm: { fired: number; confirmed: number };
  sttErr: number;
  wakeFail: number;
  authSkip: number;
  corr: string;
  confQ: string;
  modMishear: number;
  saveErr: number;
  discarded: number;
}

export interface SessionHealthScreenValues {
  reask: number;
  correctedCells: number;
  alarmFired: number;
}

export const MOD_MISHEAR_REGEX =
  /^\s*(소정|부정|조정|효정|표정|주정|구정|그\s?정|수\s정|순정|우정|추정|두정|수증|수정이|소증|정)\s*[\d일이삼사오육칠팔구십백점]/;

const CORR_PATHS = ['reask', 'direct_modify', 'rerecord', 'touch', 'confusion'] as const;
type CorrPath = typeof CORR_PATHS[number];

interface AskedConfusionHint {
  row: number;
  colId?: string;
  colName?: string;
  cands: string[];
}

export function createSessionHealth() {
  let curSessionId = '';
  const valueCells = new Set<string>();
  let reaskCount = 0;
  let lowconfCount = 0;
  let alarmFiredCount = 0;
  let alarmConfirmedCount = 0;
  let sttErrCount = 0;
  let wakeFailCount = 0;
  let authSkipCount = 0;
  let modMishearCount = 0;
  let saveErrCount = 0;
  let discardedCount = 0;

  // corr tracking per path
  const pathLines = new Map<CorrPath, number>();
  const pathCells = new Map<CorrPath, Set<string>>();
  for (const p of CORR_PATHS) {
    pathLines.set(p, 0);
    pathCells.set(p, new Set());
  }

  // confQ tracking
  let askedHintsCount = 0;
  const askedHints: AskedConfusionHint[] = [];
  const firstParsedByCell = new Map<string, string>();

  function reset(sessionId: string): void {
    curSessionId = sessionId;
    valueCells.clear();
    reaskCount = 0;
    lowconfCount = 0;
    alarmFiredCount = 0;
    alarmConfirmedCount = 0;
    sttErrCount = 0;
    wakeFailCount = 0;
    authSkipCount = 0;
    modMishearCount = 0;
    saveErrCount = 0;
    discardedCount = 0;

    for (const p of CORR_PATHS) {
      pathLines.set(p, 0);
      pathCells.get(p)!.clear();
    }

    askedHintsCount = 0;
    askedHints.length = 0;
    firstParsedByCell.clear();
  }

  function onEntry(entry: LogEntry): void {
    const x = entry.extra ?? '';

    // authSkip: past_index_skip:not_signed_in — 이 세션 id 이벤트 + 리셋 뒤 받은 sessionId가 '__app__' 또는 ''인 이벤트
    if (x.startsWith('past_index_skip:not_signed_in')) {
      if (
        entry.sessionId === curSessionId ||
        entry.sessionId === '__app__' ||
        entry.sessionId === '' ||
        !entry.sessionId
      ) {
        authSkipCount++;
      }
    }

    // 그 밖의 필드는 entry.sessionId === curSessionId인 이벤트만
    if (!curSessionId || entry.sessionId !== curSessionId) {
      return;
    }

    // cells / value tracking: R4 firstParsedByCell에는 colId 키만 담음
    if (entry.type === 'value') {
      const r = entry.row ?? 0;
      if (entry.colId) {
        const kId = `${r}:${entry.colId}`;
        valueCells.add(kId);
        if (!firstParsedByCell.has(kId)) {
          firstParsedByCell.set(kId, entry.parsed ?? '');
        }
      }

      if (x.startsWith('low_conf_parsed')) {
        lowconfCount++;
      }
    }

    // reask
    if (x.startsWith('beep_play:kind=reject')) {
      reaskCount++;
    }

    // alarm
    if (x.startsWith('trend_alert_fired')) {
      alarmFiredCount++;
    }
    if (x.startsWith('trend_alert_confirmed')) {
      alarmConfirmedCount++;
    }

    // sttErr
    if (x.startsWith('lifecycle:error:')) {
      sttErrCount++;
    }

    // wakeFail: wake_lock과 result=failed를 모두 포함 (접두가 아닌 포함 매칭)
    if (x.includes('wake_lock') && x.includes('result=failed')) {
      wakeFailCount++;
    }

    // corr: stt_correction:from=...,to=...,path=...
    if (x.startsWith('stt_correction')) {
      const m = x.match(/path=([a-z_]+)/);
      const path = (m ? m[1] : '') as CorrPath;
      if (CORR_PATHS.includes(path)) {
        pathLines.set(path, (pathLines.get(path) ?? 0) + 1);
        const cellKey = `${entry.row ?? ''}:${entry.colName ?? entry.colId ?? ''}`;
        pathCells.get(path)!.add(cellKey);
      }
    }

    // confQ: stt_confusion_hint:heard=...,cands=a|b,rule=...,asked=0|1,chosen=...
    if (x.startsWith('stt_confusion_hint')) {
      const askedMatch = x.match(/asked=([01])/);
      if (askedMatch && askedMatch[1] === '1') {
        askedHintsCount++;
        const candsMatch = x.match(/cands=([^,]+)/);
        const cands = candsMatch ? candsMatch[1].split('|') : [];
        askedHints.push({
          row: entry.row ?? 0,
          colId: entry.colId,
          colName: entry.colName,
          cands,
        });
      }
    }

    // modMishear: type==='stt' 이고 extra가 비었고 text가 정규식에 맞는 이벤트 수
    if (entry.type === 'stt' && (!entry.extra || entry.extra === '') && typeof entry.text === 'string') {
      if (MOD_MISHEAR_REGEX.test(entry.text)) {
        modMishearCount++;
      }
    }

    // v0.54.0 F2 — saveErr: clip_save_failed:<메시지> 만 (clip_raw_save_failed, clip_cmd_save_failed 제외)
    if (x.startsWith('clip_save_failed:')) {
      saveErrCount++;
    }

    // v0.54.0 F2 — discarded: clip_stale_pending
    if (x.startsWith('clip_stale_pending')) {
      discardedCount++;
    }
  }

  function summary(saved?: SessionHealthSavedInput): SessionHealthSummary {
    let cells = 0;
    const hitCells = new Set<string>();

    if (saved?.columns && saved?.rows) {
      const voiceColumns = saved.columns.filter((c) => c.input === 'voice');
      const voiceColIds = new Set(voiceColumns.map((c) => c.id));
      const validRows = new Set(saved.rows.map((r) => r.index));

      // R2: cells = 값 이벤트의 distinct (row, colId) 중 saved.columns의 음성 열이고 saved.rows에 있는 행인 것
      for (const k of valueCells) {
        const colon = k.indexOf(':');
        const r = Number(k.slice(0, colon));
        const cId = k.slice(colon + 1);
        if (validRows.has(r) && voiceColIds.has(cId)) {
          cells++;
        }
      }

      // R4: confQ 분자 계산 — 음성 열의 name -> id 매핑
      const voiceColIdByName = new Map<string, string>();
      for (const col of voiceColumns) {
        if (col.name && !voiceColIdByName.has(col.name)) {
          voiceColIdByName.set(col.name, col.id);
        }
      }

      for (const hint of askedHints) {
        // ⓒ 힌트의 colName -> saved.columns 음성 열의 name으로 id를 찾음
        let cId: string | undefined;
        if (hint.colName) {
          cId = voiceColIdByName.get(hint.colName);
        } else if (hint.colId && voiceColIds.has(hint.colId)) {
          cId = hint.colId;
        }
        if (!cId) continue; // 음성 열이 아니면 분자에서 뺀다

        // ⓐ 그 칸의 첫 value 이벤트 parsed (없으면 분자에서 뺀다 - heard 대체 금지)
        const cellKey = `${hint.row}:${cId}`;
        const firstParsed = firstParsedByCell.get(cellKey);
        if (firstParsed === undefined) continue;

        // ⓑ 최종값은 saved.rows에서만 — 행이 없거나 값이 없으면 분자에서 뺀다 (마지막 parsed 대체 금지)
        const rowObj = saved.rows.find((r) => r.index === hint.row);
        const finalVal = rowObj?.values?.[cId];
        if (finalVal == null || finalVal === '') continue;

        // ⓐ 첫 value parsed !== 최종값 (둘 다 숫자로 읽히면 숫자 비교, 아니면 문자열 비교)
        const nFirst = Number(firstParsed);
        const nFinal = Number(finalVal);
        const isFirstNum = !isNaN(nFirst) && firstParsed.trim() !== '';
        const isFinalNum = !isNaN(nFinal) && finalVal.trim() !== '';

        const isDiff =
          isFirstNum && isFinalNum
            ? nFirst !== nFinal
            : firstParsed !== finalVal;

        if (!isDiff) continue;

        // ⓑ 최종값이 힌트의 cands 중 하나와 일치 (둘 다 숫자로 읽히면 숫자 비교)
        const isCandHit = hint.cands.some((c) => {
          const nc = Number(c);
          const isCNum = !isNaN(nc) && c.trim() !== '';
          if (isCNum && isFinalNum) {
            return nc === nFinal;
          }
          return c === finalVal;
        });

        if (isCandHit) {
          hitCells.add(cellKey);
        }
      }
    }
    // R1: saved === undefined면 cells=0, hitCells.size=0 (confQ 분자 0, 분모는 그대로)

    // corr: 경로마다 <줄 수>/<서로 다른 (row, colName) 수>, 순서 고정, 0인 경로 생략, 전부 0이면 '-'
    const corrParts: string[] = [];
    for (const p of CORR_PATHS) {
      const lines = pathLines.get(p) ?? 0;
      if (lines > 0) {
        const distinctCells = pathCells.get(p)?.size ?? 0;
        corrParts.push(`${p}:${lines}/${distinctCells}`);
      }
    }
    const corr = corrParts.length > 0 ? corrParts.join('|') : '-';

    // R3: confQ 형식 — 물은 힌트가 0이어도 0/0. '-'는 corr에만.
    const confQ = `${askedHintsCount}/${hitCells.size}`;

    return {
      cells,
      reask: reaskCount,
      lowconf: lowconfCount,
      alarm: { fired: alarmFiredCount, confirmed: alarmConfirmedCount },
      sttErr: sttErrCount,
      wakeFail: wakeFailCount,
      authSkip: authSkipCount,
      corr,
      confQ,
      modMishear: modMishearCount,
      saveErr: saveErrCount,
      discarded: discardedCount,
    };
  }

  function getScreenValues(): SessionHealthScreenValues {
    let correctedCellsSum = 0;
    for (const p of CORR_PATHS) {
      correctedCellsSum += pathCells.get(p)?.size ?? 0;
    }
    return {
      reask: reaskCount,
      correctedCells: correctedCellsSum,
      alarmFired: alarmFiredCount,
    };
  }

  function getSessionId(): string {
    return curSessionId;
  }

  return {
    reset,
    onEntry,
    summary,
    getScreenValues,
    getSessionId,
  };
}

// 모듈 최상위 구독은 모듈 평가 1회에 1번 — 프로덕션에선 1회뿐이고, 개발 HMR에서만 재평가로 중복될 수 있다(screenshot.ts의 initialized 가드는 App 부팅 함수라서 필요했다).
// 모듈 싱글턴 + logger.subscribe 연결
export const sessionHealthTracker = createSessionHealth();
logger.subscribe((entry) => sessionHealthTracker.onEntry(entry));

export function resetSessionHealth(sessionId: string): void {
  sessionHealthTracker.reset(sessionId);
}

export function summarySessionHealth(saved?: SessionHealthSavedInput): SessionHealthSummary {
  return sessionHealthTracker.summary(saved);
}

export function getSessionHealthScreenValues(): SessionHealthScreenValues {
  return sessionHealthTracker.getScreenValues();
}

export function getSessionHealthSessionId(): string {
  return sessionHealthTracker.getSessionId();
}

