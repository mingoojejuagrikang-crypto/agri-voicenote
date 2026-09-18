/**
 * [ENV-12] Stage 3 서브 훅 #2 — **세션 영속화(persistSession)**.
 *
 * `useVoiceSession`에서 분리한 두 번째 서브 훅이다(ENV-12가 정한 순서: 클립 캡처 → persist →
 * 내비게이션). 한 가지 책임만 진다 — "지금 메모리에 있는 세션 형상을 언제·어떤 순서로 IDB와
 * 메모리 store에 내구화하는가".
 *
 * 소유 상태(이 훅 밖으로 ref를 노출하지 않는다 — ENV-12의 "ref 공유 없는 인터페이스"):
 *  - persist 단조 순번 장부(호출 seq · 반영 seq — v0.24.0 데이터-3 가드)
 *  - 게시 전(=IDB write in-flight) 직전 persist 스냅샷(v0.49 r6 Y7)
 *
 * 세션 컨텍스트(sessionId·컬럼·정정 백업·클립 장부·세션 시계·라벨·타깃)는 여전히
 * `useVoiceSession`이 소유하므로 **getter/callback으로 주입**받는다(`useClipCapture`와 같은
 * 계약 — 훅이 남의 ref를 직접 들여다보지 않게 하기 위함이다).
 */
import { useCallback, useRef } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { useDataStore } from '../stores/dataStore';
import { recountSynced } from './sessionSync';
import { isUserInputColumn } from './autoValue';
import { saveSession } from './db';
import { logger } from './logger';
import { noteSessionPersisted } from './rawRetention';
import type { Column, Session, SessionRow, SessionTarget } from '../types';

export interface PersistSessionDeps {
  /** 현재 세션 id — 세션 경계마다 바뀌므로 값이 아니라 getter로 받는다. */
  getSessionId: () => string;
  /** 세션 시작에 동결한 컬럼(sessionColumnsRef ?? 설정 store) — persist 스냅샷의 스키마 축. */
  getSessionColumns: () => Column[];
  /** cascade 정정 중 백업 행 스냅샷 — 정정 구획이 세우고 stop() 전 persist가 승계한다. */
  getCorrectionBackup: () => SessionRow | null;
  /** rowIndex → colId → IDB 클립 키 장부(클립 캡처 경로가 채운다). */
  getPendingClips: () => Record<number, Record<string, string>>;
  /** 실패 캡처 tombstone 키 집합([CLIP-VAL-1]③) — 재영속 금지 판정에 쓴다. */
  getBrokenClipKeys: () => Set<string>;
  getSessionTarget: () => SessionTarget | null;
  getSessionLabel: () => string | undefined;
  /** 세션 시작 시점의 로컬 오늘 ISO(start()에서 1회 계산) — 미설정 센티넬은 ''다(r7 #2 `||`). */
  getSessionToday: () => string;
  composeRowValues: (columns: Column[], row: number) => Record<string, string>;
  localTodayISO: () => string;
}

export function usePersistSession(deps: PersistSessionDeps) {
  // 주입된 deps를 ref로 받아 **노출 함수의 identity를 영구 고정**한다(모든 useCallback이 `[]`).
  // persistSession은 useVoiceSession의 handleFinal 의존성 배열에 들어가므로, identity가 흔들리면
  // 매 렌더 handleFinal이 재생성돼 STT 배선이 요동친다(useClipCapture와 동일 계약 — 분리 전
  // 원본이 `useCallback(..., [])`로 고정이었던 계약을 그대로 보존하는 것이 목적이다).
  const depsRef = useRef(deps);
  depsRef.current = deps;

  // v0.24.0 데이터-3 방어 — persistSession 단조 가드. 값 커밋마다 fire-and-forget persist가 겹쳐 돌 때,
  // 더 일찍 시작된(=옛 값) 호출이 더 늦게 시작된(=새 값) 호출의 dataStore upsert를 last-writer-wins로
  // 덮어쓰면 이상치 교정값이 옛값으로 되돌아간다. 호출마다 단조 증가 seq를 받아, durable 반영 직전에
  // 더 큰 seq가 이미 반영됐으면 스킵한다. (data-3은 06-29 로그에서 미재현 — 방어+가시화.)
  const persistSeqRef = useRef(0);
  const persistAppliedSeqRef = useRef(0);
  /** Y7 — 아직 메모리 store에 게시되지 않은(=IDB write in-flight) 직전 persist 스냅샷. */
  const inFlightSessionRef = useRef<Session | null>(null);

  const persistSession = useCallback(async (
    pendingOverride?: Session['pendingValidation'] | null,
    publishPendingStage = false,
  ): Promise<boolean> => {
    const {
      getSessionId, getSessionColumns, getCorrectionBackup, getPendingClips,
      getBrokenClipKeys, getSessionTarget, getSessionLabel, getSessionToday,
      composeRowValues, localTodayISO,
    } = depsRef.current;
    // v0.24.0 데이터-3 — 이 호출의 단조 순번(호출 순서=스냅샷 신선도 순서, setRowValue가 호출 전 실행됨).
    const mySeq = ++persistSeqRef.current;
    const columns = getSessionColumns();
    const sess = useSessionStore.getState();
    const completed = [...sess.completedRows].sort((a, b) => a - b);
    // Check backup BEFORE early return: if cascade correction is in progress and the correcting row
    // was the only completed row, we still need to persist the backup snapshot.
    const backup = getCorrectionBackup();
    // v0.4.4 증분 영속화: 진행 중(활성·미완료) 행도 부분값/클립이 있으면 저장 대상에 포함해, 행을 다
    // 채우기 전 새로고침/앱 업데이트로 입력이 유실되는 것을 막는다. (sync는 complete 행만 업로드.)
    const activeRow = sess.activeRow;
    const activeHasData =
      !completed.includes(activeRow) &&
      (Object.values(sess.getRowValues(activeRow) ?? {}).some((v) => v !== '') ||
        Object.keys(getPendingClips()[activeRow] ?? {}).length > 0);
    // v0.5.0 NAV-1: '다음'으로 건너뛴 행도 complete:false placeholder로 영속화 — 자동/고정값은
    // 채워지고 음성 칸만 빈 채 데이터탭에 보여, 사용자가 터치로 채울 수 있다. (v0.6.0부터
    // sync가 placeholder도 공백 행으로 시트에 업로드해 sheetRow를 예약한다 — 행 단위 재동기화.)
    const skipped = sess.skippedRows.filter((r) => !completed.includes(r)).sort((a, b) => a - b);
    if (completed.length === 0 && !backup && !activeHasData && skipped.length === 0) return true;
    // F1: read the existing persisted session once so each row can preserve its sheetRow/syncState
    // (the same source we merge audioClips from). Without this, every persist after a sync wiped
    // row-level tracking → the next sync re-appended already-uploaded rows (duplicates).
    // 🔴 v0.49 r6 Y7(codex R5-F2) — **아직 게시되지 않은 직전 스냅샷도 승계원이다.**
    //   메모리 store 게시(:이 함수 말미 `upsertSession`)는 `await saveSession` **뒤**다. 첫 put이
    //   느리면(기기 IDB 지연·대용량 클립) 그 사이에 시작된 두 번째 persist가 `existingSession=null`을
    //   잡고 **모든 행을 `composeRowValues`로 다시 만든다** — Z3의 자동값 동결이 통째로 무력화된다.
    //   codex 재현: 첫 put을 8초 늦추고 1행 커밋 → 자정 넘김 → 2행 커밋 → **1행의 조사일자가
    //   다음 날로 덮였다**(Z3 오라클은 첫 persist가 IDB에 정착한 뒤에만 자정을 넘겨 이 창을 못 봤다).
    //   👉 조립 직후(첫 await 전) 스냅샷을 ref에 남기고, store가 아직 비어 있으면 그걸 승계원으로
    //     쓴다. durable 실패로 그 put이 버려지더라도 승계 대상은 **기록 시점 자동값**이라 옳다.
    const existingSession = useDataStore.getState().sessions.find(
      (s) => s.id === getSessionId(),
    ) ?? (inFlightSessionRef.current?.id === getSessionId() ? inFlightSessionRef.current : undefined);
    const buildRow = (r: number, complete: boolean): SessionRow => {
      const existingRow = existingSession?.rows.find((row) => row.index === r);
      // Merge stored clips (from previous persists) with newly recorded clips
      const mergedClips = {
        ...(existingRow?.audioClips ?? {}),
        ...(getPendingClips()[r] ?? {}),
      };
      // [CLIP-VAL-1]③: tombstoned keys (failed captures) must never be persisted — without this
      // a persist whose existingRow predates an unlink would resurrect the broken pointer.
      for (const k of Object.keys(mergedClips)) {
        if (getBrokenClipKeys().has(mergedClips[k])) delete mergedClips[k];
      }
      // 🔴 v0.49 r5 Z3(claude #1) — **이미 기록된 행의 파생값은 다시 파생하지 않는다.**
      //   `composeRowValues`는 자동 컬럼을 **매 persist마다 재계산**한다. 사람이 넣은 값이 아니라
      //   스키마·시계에서 나오는 값이라, 재계산 결과가 기록 시점과 달라질 수 있다:
      //     · 날짜 컬럼 `'오늘'` — `autoValue`가 **호출 시각의 로컬 날짜**를 돌려준다. 자정을
      //       넘긴 세션(현장 새벽 작업·긴 세션)의 **모든 기존 행**이 다음 날짜로 다시 쓰인다.
      //     · 순환 컬럼 자릿수(`spanOf`) — 세션 중 스키마가 갈리면 전 행의 값이 밀린다.
      //       (실측: `sessionColumnsRef`가 세션 시작에 컬럼을 동결하고 VoiceScreen이 keep-alive라
      //        **현행 UI에서는 이 축이 도달 불가**다. 아래 방어는 두 축 공통의 기전을 막는다.)
      //   피해는 「기록 안 됨」이 아니라 **능동 덮어씀**이다: 아래 diff가 `synced`를 `dirty`로
      //   강등하면 다음 동기화가 그 행을 시트에서 **in-place UPDATE**한다 — 농가 의사결정에 쓰이는
      //   프로덕션 시트의 확정 행이, 사용자가 아무것도 안 했는데 조용히 다른 날짜로 바뀐다.
      //   👉 처방: 기존 행에 이미 있는 **자동(비-사용자입력) 컬럼 값은 그대로 승계**한다. 사람이
      //      넣는 컬럼(voice/touch)은 종전대로 라이브 스토어가 이긴다 — 강등 diff의 **본래 목적**
      //      (사용자 정정을 시트에 밀어넣기)은 손대지 않는다.
      //   ⚠️ 정상 경우엔 **완전 무해**다: seq·options 값은 행 인덱스에서 나오므로 재계산 결과가
      //      기존 값과 같다. 갈리는 것은 위 두 드리프트뿐이고, 그때 옳은 것은 **기록 시점 값**이다.
      //   ⚠️ 기존 행에 **없는** 키(스키마에 컬럼이 새로 생긴 경우)는 승계 대상이 아니다 — 새로
      //      계산한 값이 그대로 들어간다(빈 칸으로 굳지 않는다).
      //   오라클: tests/v049-r5-z3-auto-drift.spec.ts
      const fresh = composeRowValues(columns, r);
      const values = existingRow
        ? Object.fromEntries(Object.entries(fresh).map(([id, v]) => {
          const col = columns.find((c) => c.id === id);
          const kept = existingRow.values[id];
          return [id, col && !isUserInputColumn(col) && kept !== undefined ? kept : v];
        }))
        : fresh;
      // F1: preserve the row's sheetRow/syncState across re-persists. If a previously-synced row's
      // value changed in this persist, demote synced→dirty so the next sync UPDATEs it in place
      // (no duplicate append). Unchanged synced rows keep 'synced'.
      let sheetRow = existingRow?.sheetRow;
      let syncState = existingRow?.syncState;
      if (existingRow && syncState === 'synced') {
        const colIds = columns.map((c) => c.id);
        const changed = colIds.some((c) => (existingRow.values[c] ?? '') !== (values[c] ?? ''));
        if (changed) syncState = 'dirty';
      }
      return {
        index: r,
        values,
        complete,
        audioClips: Object.keys(mergedClips).length > 0 ? mergedClips : undefined,
        ...(sheetRow !== undefined ? { sheetRow } : {}),
        ...(syncState !== undefined ? { syncState } : {}),
      };
    };
    const rows: SessionRow[] = completed.map((r) => buildRow(r, true));
    // If stop() fires while a cascade correction is in progress (row not yet re-completed),
    // include the backup snapshot so original measurements survive the persist.
    if (backup && !completed.includes(backup.index)) {
      rows.push({ ...backup });
    }
    if (activeHasData && !rows.some((row) => row.index === activeRow)) {
      rows.push(buildRow(activeRow, false));
    }
    for (const r of skipped) {
      if (!rows.some((row) => row.index === r)) rows.push(buildRow(r, false));
    }
    rows.sort((a, b) => a.index - b.index);
    // D-2 (RACE-7): prefer the ref, but fall back to the store-persisted id/startedAt so a session
    // that lost its hook ref (unmount during pause) still persists with a valid id and a finite
    // startedAt instead of `id:''` + `startedAt:NaN`.
    const resolvedId = getSessionId() || sess.sessionId;
    const resolvedStartedAt =
      sess.startedAt || parseInt(resolvedId.replace('sess_', ''), 10) || Date.now();
    const target = getSessionTarget() ?? existingSession?.target;
    const session: Session = {
      id: resolvedId,
      // v0.7.0: LOCAL date, not UTC — toISOString() stamped KST 00:00~08:59 sessions with
      // yesterday's date, so localTodayISO() 오늘-세션 매칭에서 그날 아침 세션이 사라졌다.
      // 코드베이스 지배 규약도 로컬(autoValue.ts 날짜 컬럼).
      // 🔴 v0.49 r6 Y7(claude #6) — **세션의 날짜는 세션이 시작된 날이다. 매 persist마다 다시
      //   스탬프하지 않는다.** 종전 `localTodayISO()`는 호출 **시각**을 찍었다 — 자정을 넘긴 세션
      //   (현장 새벽 작업·긴 세션)은 persist 한 번에 세션 전체의 `date`가 다음 날로 바뀌고,
      //   그 필드는 「오늘 세션」 매칭·목록·시트 라벨의 기준이라 **그날 아침 세션이 사라지는**
      //   v0.7.0 결함과 같은 증상이 시각 축에서 되살아난다. 행의 조사일자는 Z3가 이미 동결했고,
      //   세션 헤더만 남아 있던 자리다.
      //   승계 순서: 이미 기록된 값(`existingSession.date`) → 세션 고정 시계(`sessionTodayRef`,
      //   start()에서 1회 계산) → 최후에만 현재 로컬 날짜.
      //   🔴 v0.49 r7 #2(codex r6#13) — 술어는 `||`다. `??`는 **빈 문자열을 통과시킨다**:
      //     `sessionTodayRef`의 미설정 센티넬은 `null`이 아니라 `''`(`useRef<string>('')`)이고,
      //     `existingSession.date`도 한 번 `''`로 내구화되면 그 뒤 모든 persist가 `??`를 통과해
      //     **빈 날짜가 영구히 굳는다**. `date`는 「오늘 세션」 매칭·목록·시트 라벨의 기준이라
      //     빈 값은 그 세션을 목록에서 지운다(v0.7.0 UTC 결함과 같은 증상, 원인만 다르다).
      //     형제 호출부 둘(:안내 브리핑의 `today`)은 처음부터 `||`였다 — 이 자리만 안 옮겨졌다.
      //   ⚠️ 현행 코드에서 이 폴스루는 **도달 불가**다(`start()`가 첫 커밋 전에 ref를 세우고,
      //     세션 레코드를 만드는 유일한 작성자가 이 함수다). 그래서 오라클은 렌더가 아니라
      //     **술어 자체**를 잠근다 — 도달로가 하나 생기는 순간 값 유실로 바뀌는 자리다.
      //     오라클: tests/v049-r7-small.spec.ts
      date: existingSession?.date || getSessionToday() || localTodayISO(),
      label: getSessionLabel() || sess.sessionLabel,
      columns,
      ...(target ? { target } : {}),
      rows,
      completedRows: rows.filter((r) => r.complete).length,
      // F1: derive syncedRows from per-row syncState (recountSynced) instead of hardcoding 0,
      // which used to erase the uploaded-row count after every voice persist.
      syncedRows: recountSynced(rows),
      startedAt: resolvedStartedAt,
      finishedAt: Date.now(),
      // manualHold 중 lifecycle persist가 다시 돌더라도 보류 태그를 버리지 않는다. 태그 유실은
      // 후보 dirty 값이 확정값처럼 sync/export되는 것과 같으므로 기존 Session에서 그대로 승계한다.
      ...((pendingOverride === undefined ? existingSession?.pendingValidation : pendingOverride)
        ? { pendingValidation: (pendingOverride === undefined ? existingSession?.pendingValidation : pendingOverride)! }
        : {}),
    };
    // Y7 — 첫 await 전에 남긴다(위 `existingSession` 폴백의 짝). 이 시점의 `session`이 곧
    //   「이번 persist가 내구화하려는 형상」이고, 게시 전 창에서 시작된 persist는 이것을 봐야 한다.
    inFlightSessionRef.current = session;
    if (publishPendingStage && session.pendingValidation) {
      // ManualValueSheet는 async onCommit을 await하지 않는다. 첫 await(IDB put) 전에 후보와 pending
      // 태그를 같은 메모리 스냅샷으로 공개해야 그 짧은 동안 Data sync/export가 후보를 확정값으로
      // 보지 않는다. persisting 플래그는 [확인]도 durable 완료 전 진행하지 못하게 한다.
      useDataStore.getState().upsertSession({ ...session, pendingValidationPersisting: true });
    }
    try {
      await saveSession(session);
    } catch (err) {
      // IDB 실패 뒤 dataStore만 갱신하면 UI/로그는 성공인데 재시작 후 값이 사라진다. 호출자에게
      // durable=false를 돌려주고 메모리 upsert도 하지 않아 두 저장소가 거짓으로 갈라지지 않게 한다.
      logger.log({
        type: 'error', extra: `session_persist_failed:${String((err as Error)?.message ?? err)}`,
        sessionId: session.id, row: activeRow,
      });
      return false;
    }
    // [CLIP-VAL-1]③ re-check AFTER the await, synchronously with the upsert: a clip_empty
    // unlink may have tombstoned a key while saveSession was in flight (this session's rows
    // were built synchronously before it). Without this re-strip the upsert below would
    // resurrect the unlinked pointer in dataStore ([CLIP-POINTER-1] race, 06-11 row8 c7). When
    // pendingClipsRef meanwhile re-pointed the cell to a healthy key (e.g. the cmd-clip
    // relink), substitute that instead of dropping the pointer. The strip, the upsert and
    // the creation of the compensating save share one synchronous block, so no tombstone can
    // be added in between; the compensating IDB save is created after the unlink's own save,
    // so the clean state lands last — and it is AWAITED before this function resolves, so a
    // page death right after persistSession cannot leave the broken pointer as the last
    // durably-persisted state.
    let finalSession = session;
    if (getBrokenClipKeys().size > 0) {
      let changed = false;
      const strippedRows = session.rows.map((r) => {
        if (!r.audioClips) return r;
        const next: Record<string, string> = {};
        let rowChanged = false;
        for (const [colId, key] of Object.entries(r.audioClips)) {
          if (!getBrokenClipKeys().has(key)) { next[colId] = key; continue; }
          rowChanged = true;
          const fresh = getPendingClips()[r.index]?.[colId];
          if (fresh && !getBrokenClipKeys().has(fresh)) next[colId] = fresh;
        }
        if (!rowChanged) return r;
        changed = true;
        return { ...r, audioClips: Object.keys(next).length > 0 ? next : undefined };
      });
      if (changed) {
        finalSession = { ...session, rows: strippedRows };
      }
    }
    // v0.24.0 데이터-3 단조 가드 — await(saveSession) 뒤 시점. 이 사이 더 나중에 시작된(=새 값) persist가
    // 이미 dataStore에 반영됐다면(persistAppliedSeqRef가 더 큼), 옛 스냅샷으로 덮어쓰지 않는다.
    if (mySeq < persistAppliedSeqRef.current) {
      // 🔴 v0.49 r6 Y12(claude #9) — **여기서 세션을 통째로 다시 올리지 않는다.** 이 분기는
      //   「내 스냅샷은 낡았다」는 판정이고, 그런 스냅샷으로 `upsertSession`을 하면 더 나중
      //   persist가 이미 반영한 값을 **옛 값으로 되돌린다**(단조 가드가 막으려던 바로 그 일).
      //   그럼에도 뭔가 해야 하는 이유는 `publishPendingStage`가 첫 await 전에 올려 둔
      //   `pendingValidationPersisting` 게이트 플래그 때문이다 — 그건 [확인]을 막는 UI 잠금이라
      //   누군가 걷지 않으면 사용자가 영영 확인할 수 없다. 그래서 **그 플래그만 벗긴다.**
      if (publishPendingStage) {
        const cur = useDataStore.getState().sessions.find((x) => x.id === session.id);
        if (cur?.pendingValidationPersisting) {
          const { pendingValidationPersisting: _drop, ...rest } = cur;
          useDataStore.getState().upsertSession(rest);
        }
      }
      return true;
    }
    persistAppliedSeqRef.current = mySeq;
    if (finalSession !== session) {
      try {
        await saveSession(finalSession);
      } catch (err) {
        logger.log({
          type: 'error', extra: `session_persist_compensation_failed:${String((err as Error)?.message ?? err)}`,
          sessionId: finalSession.id, row: activeRow,
        });
        return false;
      }
    }
    // 마지막으로 내구 저장된 형상만 메모리 store에 공개한다. 보상 save 실패 시 깨진 포인터 형상을
    // UI에 성공처럼 올렸다가 reload에서 되돌아가는 split-brain을 막는다.
    useDataStore.getState().upsertSession(finalSession);
    void noteSessionPersisted(finalSession.id);
    return true;
  }, []);
  return { persistSession };
}
