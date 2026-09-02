import { useDataStore } from '../stores/dataStore';
import { useSessionStore } from '../stores/sessionStore';
import { appendRows, updateCellsSparse, fetchHeaderRow } from './sheets';
import { saveSession } from './db';
import { getAccessToken } from './googleAuth';
import { logger } from './logger';
import { sheetSynced } from './logEvents';
import {
  hasSyncState,
  recountSynced,
  legacySyncedIndexSet,
  isSessionSyncBlocked,
  ACTIVE_SESSION_SYNC_MESSAGE,
} from './sessionSync';
import { mapColumnsToHeader, buildRowForMapping, buildSparseCellsForMapping, type ColumnMapping } from './columnMapping';
import type { Session, SessionRow } from '../types';
import { withoutPendingCandidate } from './pendingValidation';

// C3 — module-level in-flight guard. A second syncSelected() call (double-tap, two tabs, retry
// racing the first) must never re-append a session that's still being pushed. We register each
// sessionId on entry and skip any session already in this set, releasing it in finally. This is a
// safety net independent of the DataScreen `busy` gate (which only blocks the same component).
const inFlightSessionIds = new Set<string>();

export interface SyncFailure {
  sessionId: string;
  sessionDate: string;
  sessionLabel?: string;
  reason: string;
}

export interface SyncReport {
  ok: number;
  failed: number;
  rows: number;
  /** v0.6.0 — rows UPDATED in place (locally edited after their first upload). */
  updatedRows: number;
  /** v0.6.0 — rows that fell back to append because their in-sheet row update failed (404/400). */
  fallbackAppended: number;
  message?: string;
  failures: SyncFailure[];
  /** Session IDs that were actually pushed to the sheet — only these are safe to auto-delete. */
  successIds: string[];
  /** [SYNC-3] — human-readable notes when a session's local column name(s) were NOT found in the
   *  sheet's current header (columnMapping.ts). Those columns' values were intentionally skipped
   *  (never written anywhere) rather than guessed by position — surfaced here so the caller can
   *  warn the user instead of staying silent. Empty when every local column matched by name. */
  columnWarnings: string[];
  /** v0.20.0 Phase 2 — structured "needs (re)login" signal so DataScreen can mount the
   *  LoginRequiredModal WITHOUT brittle string-matching on `message`/`reason`. Set true when:
   *   ① the preflight access-token is null (not logged in / token expired before sync), or
   *   ② an append/update throws a 401/403 (token expired MID-push — the common real-device cause
   *      per the v0.19.0 analysis). The caller surfaces the modal + resumes after re-login. */
  needsLogin?: boolean;
}

/** v0.20.0 — does this sheets-API error message carry an auth failure (expired/invalid token)?
 *  sheets.ts embeds the HTTP status in the thrown message (e.g. "행 일괄 추가 실패 (401): …").
 *  We read the structured status, not free Korean text, to stay robust to wording changes. */
function isAuthFailure(message: string): boolean {
  return /\b(401|403)\b/.test(message);
}

/**
 * Push the listed session IDs to each session's immutable Sheets target.
 *
 * v0.6.0 row-level re-sync (2 passes per session):
 *   Pass 1 (append): rows with syncState !== 'synced' && sheetRow === undefined — including
 *     skip placeholders (complete:false) — are appended in row.index order in one request.
 *     Each row gets its sheetRow from the append's updatedRange + syncState='synced'.
 *     If updatedRange can't be parsed, rows are left un-synced (retried next sync).
 *   Pass 2 (update): rows with syncState === 'dirty' && sheetRow !== undefined are written in place
 *     via a sparse, per-cell `values.batchUpdate` (updateCellsSparse) — one targeted range per
 *     mapped column, never a contiguous full-row PUT, so sheet-only interstitial columns between
 *     mapped columns are never touched ([SYNC-3] follow-up). A 404/400 update failure resets that
 *     row's sheetRow → it appends next sync (fallback) and emits a `sync_row_mismatch` event.
 */
export async function syncSelected(sessionIds: string[]): Promise<SyncReport> {
  const data = useDataStore.getState();
  const report: SyncReport = {
    ok: 0, failed: 0, rows: 0, updatedRows: 0, fallbackAppended: 0, failures: [], successIds: [],
    columnWarnings: [],
  };

  if (sessionIds.length === 0) {
    report.message = '선택된 세션이 없습니다.';
    return report;
  }
  if (!getAccessToken()) {
    // ② structured signal — DataScreen mounts LoginRequiredModal and resumes after re-login.
    report.needsLogin = true;
    report.message = 'Google 로그인이 필요합니다. 설정 탭에서 로그인 후 다시 시도하세요.';
    return report;
  }
  // 한 번의 선택에 서로 다른 농가 세션이 섞일 수 있다. 헤더는 target별 1회만 읽되, 전역 설정이나
  // 다른 target의 캐시를 공유하지 않는다(같은 이름 양식이라도 목적지는 별개다).
  const headerRequests = new Map<string, Promise<string[]>>();
  const headersFor = (spreadsheetId: string, sheetTab: string): Promise<string[]> => {
    const key = `${spreadsheetId}\u0000${sheetTab}`;
    let request = headerRequests.get(key);
    if (!request) {
      request = fetchHeaderRow(spreadsheetId, sheetTab);
      headerRequests.set(key, request);
    }
    return request;
  };

  for (const id of sessionIds) {
    // Read fresh each iteration so concurrent edits (voice/touch) to this or other sessions are
    // seen (F7). getState() returns the current snapshot, not the one captured at call time.
    const storedSession = useDataStore.getState().sessions.find((x) => x.id === id);
    if (!storedSession) {
      report.failed++;
      report.failures.push({
        sessionId: id, sessionDate: '?',
        reason: '세션을 찾을 수 없습니다.',
      });
      continue;
    }
    const voice = useSessionStore.getState();
    if (isSessionSyncBlocked(id, voice.sessionId, voice.phase)) {
      report.failed++;
      report.failures.push({
        sessionId: storedSession.id,
        sessionDate: storedSession.date,
        sessionLabel: storedSession.label,
        reason: ACTIVE_SESSION_SYNC_MESSAGE,
      });
      if (sessionIds.length === 1) report.message = ACTIVE_SESSION_SYNC_MESSAGE;
      continue;
    }
    // 확인 전 수동 이상치 후보는 dirty여도 Sheets에 쓸 수 없다. 원 확정값/원 syncState로 투영한
    // 작업 복사본을 사용하고, 해당 행 자체도 append/update 대상에서 제외해 PUT/POST를 0으로 만든다.
    const pendingRow = storedSession.pendingValidation?.row;
    const session = withoutPendingCandidate(storedSession);
    const target = session.target;
    if (!target?.spreadsheetId || !target.sheetTab) {
      report.failed++;
      report.failures.push({
        sessionId: session.id,
        sessionDate: session.date,
        sessionLabel: session.label,
        reason: '이 세션의 대상 시트를 알 수 없습니다. 업로드 전에 대상 시트를 확인해 주세요.',
      });
      continue;
    }
    const { spreadsheetId, sheetTab } = target;

    // C3 — skip a session that a concurrent sync is already pushing (double-append safety net).
    if (inFlightSessionIds.has(id)) {
      report.failed++;
      report.failures.push({
        sessionId: id, sessionDate: session.date, sessionLabel: session.label,
        reason: '이미 동기화가 진행 중인 세션입니다. 완료 후 다시 시도하세요.',
      });
      continue;
    }
    inFlightSessionIds.add(id);
    try {
      let headers: string[];
      try {
        headers = await headersFor(spreadsheetId, sheetTab);
      } catch (err) {
        const msg = (err as Error).message || '알 수 없는 오류';
        const reason = `시트 헤더 조회 실패로 동기화를 중단했습니다: ${msg}`;
        report.failed++;
        report.failures.push({
          sessionId: session.id, sessionDate: session.date, sessionLabel: session.label, reason,
        });
        if (sessionIds.length === 1) report.message = reason;
        if (isAuthFailure(msg)) report.needsLogin = true;
        continue;
      }

    // [SYNC-3] fix — map local columns to the sheet's ACTUAL header by NAME (not by local
    // declaration order/position). A column whose name isn't in the header is "missing in sheet":
    // its value is never written anywhere (no positional guess) — reported via columnWarnings
    // instead of silently landing in someone else's column.
    const mapping: ColumnMapping = mapColumnsToHeader(session.columns, headers);
    if (mapping.missingNames.length > 0) {
      logger.log({
        type: 'app', extra: `sync_column_missing_in_sheet:${mapping.missingNames.join(',')}`, sessionId: session.id,
      });
      report.columnWarnings.push(
        `${session.date}${session.label ? ' ' + session.label : ''}: 시트에 없는 열 ${mapping.missingNames.length}개(${mapping.missingNames.join(', ')})는 업로드되지 않았습니다.`,
      );
    }
    if (mapping.indexForColId.size === 0 && session.columns.length > 0) {
      // Total schema mismatch — not even one local column name exists in the current sheet
      // header. Writing a fully-blank row here would be its own silent-corruption footgun, so
      // this session is reported as a hard failure instead of a "successful" blank append.
      report.failed++;
      report.failures.push({
        sessionId: session.id, sessionDate: session.date, sessionLabel: session.label,
        reason: '로컬 세션의 컬럼과 일치하는 시트 헤더가 하나도 없습니다. 시트 헤더 또는 세션 스키마를 확인하세요.',
      });
      continue;
    }
    // Mutable working copy of rows; passes update sheetRow/syncState in place.
    let rows = [...session.rows];

    // Legacy sessions (no syncState anywhere) fall back to the old syncedRows-based behavior.
    // F5: syncedRows is a COUNT of completed rows, not an index. Treat the first `syncedRows`
    // COMPLETE rows (in index order) as already-synced — robust to interleaved skip
    // placeholders. We can't track them per-row (no sheetRow known), so dirty propagation only
    // starts for rows appended from now on.
    if (!hasSyncState(rows) && session.syncedRows > 0) {
      const legacySynced = legacySyncedIndexSet(rows, session.syncedRows);
      rows = rows.map((r) =>
        legacySynced.has(r.index) ? { ...r, syncState: 'synced' as const } : r,
      );
    }

    // Pass 1 — append: every never-appended row, in index order. Skip placeholders / partial rows
    // (complete:false) are appended as intentional blanks ONLY when the session has finished — an
    // actively-recording session may still fill or remove them, so uploading a half-empty in-flight
    // row is premature (C2). For finished sessions, blank-on-purpose rows upload as designed.
    const appendTargets = rows
      .filter((r) => r.index !== pendingRow)
      .filter((r) => r.syncState !== 'synced' && r.sheetRow === undefined)
      .sort((a, b) => a.index - b.index);

    let appended = 0;
    let updated = 0;
    let fallback = 0;
    let pushedAnything = false;
    let sessionFailed = false;
    let failReason = '';
    // v0.51.1 L — 이번 동기화가 실제로 쓴 시트 행(1-based). `sheet_synced`의 rows=min-max 재료.
    const pushedSheetRows: number[] = [];

    if (appendTargets.length > 0) {
      const matrix = appendTargets.map((row) => buildRowForMapping(row.values, mapping));
      try {
        const res = await appendRows(spreadsheetId, sheetTab, matrix);
        if (res.firstSheetRow != null) {
          // F4: only count the append as a real push when we could parse the landing position.
          pushedAnything = true;
          appended += appendTargets.length;
          // Map each appended row to its 1-based sheet row in order; mark synced.
          const sheetRowFor = new Map<number, number>();
          appendTargets.forEach((row, i) => sheetRowFor.set(row.index, res.firstSheetRow! + i));
          pushedSheetRows.push(...sheetRowFor.values());
          rows = rows.map((r) =>
            sheetRowFor.has(r.index)
              ? { ...r, sheetRow: sheetRowFor.get(r.index), syncState: 'synced' as const }
              : r,
          );
        } else {
          // C1: append HTTP succeeded (rows ARE in the sheet) but updatedRange was unparseable so we
          // don't know WHICH sheet rows. Old behavior failed the session to force a retry — but the
          // retry re-appended the same rows (duplicate), since the HTTP append had already landed.
          // New policy: the truth is "the data is in the sheet". Mark these rows synced WITHOUT a
          // sheetRow (we can't map them for in-place UPDATE). Count them as appended + pushed so the
          // session reaches successIds (backup/auto-delete proceed normally — no duplicate on retry).
          // If such a row is later edited, applyRowPatch demotes it to 'dirty' but it still has no
          // sheetRow → pass-1 re-appends it (value is current; the rare duplicate is accepted, see
          // KNOWN-ISSUES [SYNC-2]). The `sync_append_no_range` log is retained for telemetry.
          logger.log({
            type: 'app', extra: 'sync_append_no_range', sessionId: session.id, parsed: String(appendTargets.length),
          });
          pushedAnything = true;
          appended += appendTargets.length;
          const syncedNoRow = new Set(appendTargets.map((r) => r.index));
          rows = rows.map((r) =>
            syncedNoRow.has(r.index) ? { ...r, syncState: 'synced' as const } : r,
          );
        }
      } catch (err) {
        sessionFailed = true;
        failReason = (err as Error).message || '알 수 없는 오류';
      }
    }

    // Pass 2 — update: locally-edited rows already on the sheet. Skip if pass 1 already failed
    // (network is likely down — don't compound errors; this session is reported failed).
    if (!sessionFailed) {
      const updateTargets = rows
        .filter((r) => r.index !== pendingRow)
        .filter((r) => r.syncState === 'dirty' && r.sheetRow !== undefined)
        .sort((a, b) => a.index - b.index);
      for (const row of updateTargets) {
        // [SYNC-3] follow-up — sparse, per-cell write (updateCellsSparse) instead of a contiguous
        // range PUT (updateRow). Only the columns this app maps are named in the request, so a
        // sheet-only interstitial column sitting between two mapped columns is never touched —
        // not even represented in the request, let alone overwritten with ''.
        const cells = buildSparseCellsForMapping(row.values, mapping);
        try {
          await updateCellsSparse(spreadsheetId, sheetTab, row.sheetRow!, cells);
          pushedAnything = true;
          updated++;
          pushedSheetRows.push(row.sheetRow!);
          rows = rows.map((r) => (r.index === row.index ? { ...r, syncState: 'synced' as const } : r));
        } catch (err) {
          const msg = (err as Error).message || '';
          // 404/400: the in-sheet row is gone/moved → reset sheetRow so it re-appends next sync.
          if (/\b(400|404)\b/.test(msg)) {
            logger.log({
              type: 'app', extra: 'sync_row_mismatch', sessionId: session.id, row: row.index,
              colId: undefined, parsed: String(row.sheetRow),
            });
            rows = rows.map((r) =>
              r.index === row.index ? { ...r, sheetRow: undefined, syncState: 'dirty' as const } : r,
            );
            fallback++;
          } else {
            sessionFailed = true;
            failReason = msg || '행 갱신 실패';
            break;
          }
        }
      }
    }

    if (sessionFailed) {
      report.failed++;
      report.failures.push({
        sessionId: session.id,
        sessionDate: session.date,
        sessionLabel: session.label,
        reason: failReason,
      });
      // ② token expired MID-push (401/403) — flag the structured needsLogin signal so the caller
      // prompts re-login. We still record the failure so retry/diagnostics keep working.
      if (isAuthFailure(failReason)) report.needsLogin = true;
      console.error('sync failed for', session.id, failReason);
      continue;
    }

    // F7 — stale re-write race: voice input / cell edits may have landed in the store while the
    // append/update awaits ran. Re-read the LATEST session and merge only the sheetRow/syncState
    // we just determined onto its current rows (keyed by row.index). Values and the row list come
    // from the latest store copy (don't clobber concurrent edits). A row that the sync uploaded is
    // marked 'synced' only when its current value still equals what we pushed — otherwise it was
    // edited mid-flight and must stay 'dirty' so the next sync UPDATEs it.
    const freshData = useDataStore.getState();
    const latest = freshData.sessions.find((x) => x.id === id) ?? session;
    // What value did this sync push for each row that we attempted to append/update?
    // C1: a row may be synced WITHOUT a sheetRow (append HTTP ok but updatedRange unparseable) —
    // it must still be considered "pushed" so the mid-flight-edit check below can confirm it synced.
    const pushedValuesFor = new Map<number, Record<string, string>>();
    for (const r of rows) {
      if (r.syncState === 'synced') {
        pushedValuesFor.set(r.index, r.values);
      }
    }
    const decided = new Map<number, { sheetRow?: number; syncState?: 'synced' | 'dirty' }>();
    for (const r of rows) {
      decided.set(r.index, { sheetRow: r.sheetRow, syncState: r.syncState });
    }
    const mergedRows: SessionRow[] = latest.rows.map((r) => {
      const d = decided.get(r.index);
      if (!d) return r; // row appeared after sync started — leave as-is (un-synced)
      // sheetRow is the sync's authoritative decision (it may have SET it on append or CLEARED it
      // on a 404 fallback) — do not fall back to the stale store value, or a 404-reset row would
      // keep its old sheetRow and never re-append.
      const next: SessionRow = { ...r };
      if (d.sheetRow === undefined) delete next.sheetRow;
      else next.sheetRow = d.sheetRow;
      if (d.syncState === 'synced') {
        // Only confirm synced if the row's current values match what we actually pushed.
        const pushed = pushedValuesFor.get(r.index);
        const colIdsNow = latest.columns.map((c) => c.id);
        const unchanged =
          pushed != null && colIdsNow.every((c) => (r.values[c] ?? '') === (pushed[c] ?? ''));
        next.syncState = unchanged ? 'synced' : 'dirty';
      } else if (d.syncState === 'dirty') {
        // sheetRow was reset (404 fallback) or never confirmed → leave dirty for next sync.
        next.syncState = 'dirty';
      }
      return next;
    });
    const syncedRows = recountSynced(mergedRows);
    const updatedSession: Session = { ...latest, rows: mergedRows, syncedRows };
    data.upsertSession(updatedSession);
    await saveSession(updatedSession);

    report.updatedRows += updated;
    report.fallbackAppended += fallback;
    if (pushedAnything) {
      report.ok++;
      report.rows += appended;
      // v0.51.1 L(민구 지시 09-02) — 동기화 완료 계측(세션당·동기화당 1건). 세션 id를 명시한다 — 세션이 끝난 뒤의
      //   동기화라 logger의 현재 세션 컨텍스트가 비어 있다. 행 번호를 모르면(no_range) rows=0-0(빌더 주석).
      logger.log({
        type: 'app', sessionId: session.id,
        extra: sheetSynced({
          sheet: spreadsheetId.slice(0, 8), tab: sheetTab,
          from: pushedSheetRows.length > 0 ? Math.min(...pushedSheetRows) : 0,
          to: pushedSheetRows.length > 0 ? Math.max(...pushedSheetRows) : 0,
          n: appended + updated,
        }),
      });
      // v0.34.0 리뷰(Codex 전용 리뷰 하네스, P1) — **보류(pendingValidation) 행이 있는 세션도 제외**.
      // 위 pass 1·2가 보류 행만 건너뛰고 나머지 행을 올리면 pushedAnything=true가 되는데, 여기서
      // 세션 전체를 successIds에 넣으면 DataScreen이 "동기화 완료"로 보고 **자동 삭제**한다. 백업에는
      // withoutPendingCandidate로 위생처리된 **직전 확정값만** 담기므로 확인 대기 중이던 후보값이
      // 영구 소실된다(자동삭제가 꺼져 있어도 UI가 미완 세션을 성공으로 거짓 보고). 보류가 해소된 뒤
      // 다음 sync에서 정상적으로 성공 처리된다.
      if (pendingRow === undefined) report.successIds.push(session.id);
    }

    } finally {
      // C3 — always release the in-flight lock, even on throw/continue.
      inFlightSessionIds.delete(id);
    }
  }
  return report;
}
