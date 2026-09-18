/**
 * v0.38.0 [ENV-12] Stage 3 서브 훅 #1 — **음성 클립 캡처·보존 장부**.
 *
 * `useVoiceSession`에서 분리한 첫 서브 훅이다(ENV-12가 정한 순서: 클립 캡처 → persist → 내비게이션).
 * 한 가지 책임만 진다 — "이 세션에서 만든 클립을 언제·어떤 키로 남기고, 저장이 끝났는지 어떻게 아는가".
 *
 * 소유 상태(이 훅 밖으로 ref를 노출하지 않는다 — ENV-12의 "ref 공유 없는 인터페이스"):
 *  - 셀별 재시도 인덱스(`:a<n>`) · 셀별 명령 클립 인덱스(`:cmd<n>`)
 *  - in-flight 클립 저장 집합(아카이브·stop·pause 세 경로가 공용으로 기다린다)
 *
 * 세션 컨텍스트(sessionId·recorder·활성 클립 좌표)는 여전히 `useVoiceSession`이 소유하므로
 * **getter/callback으로 주입**받는다. 훅이 남의 ref를 직접 들여다보지 않게 하기 위함이다.
 */
import { useCallback, useRef } from 'react';
import type { AudioRecorder } from './audioRecorder';
import { saveAudioClip, loadAudioClip } from './db';
import { clipRawSkipped, clipRawSaveFailed } from './logEvents';
import type { logger } from './logger';

/** 이 크기 이하의 webm은 헤더만 있는 빈 캡처로 본다(값·명령 클립 공용 판정 기준). */
export const EMPTY_CLIP_BYTES = 200;

/** v0.6.0 CLIP-CMD — a captured '수정'/'정정' utterance whose save is deferred until the modify
 *  target cell is known, so a direct "수정 <값>" clip is keyed to the cell it corrects. */
export interface PendingCommandClip {
  /** Save the utterance under (targetRow:targetColId):cmd<n> and return that cmdKey (or null if
   *  empty/already saved). Used by the direct-modify path to re-link the corrected cell's pointer. */
  saveFor: (targetRow: number, targetColId: string) => string | null;
  /** Save against the cell that was awaiting when '수정' was said. Correct ONLY when that awaiting
   *  cell IS the correction target — true for "redo current field" (no previous field to go back
   *  to) and for a repeated '수정' while already in modify mode (awaiting was already re-pointed to
   *  the target by the earlier enterModifyMode call). The plain cascade path (bare "수정" with the
   *  target being a DIFFERENT, previous field) must use `saveFor(targetRow, target.id)` instead —
   *  see [CLIP-CORRECTION-1]. */
  saveDefault: () => void;
}

type LogCell = (entry: Omit<Parameters<typeof logger.log>[0], 'sessionId'>) => void;

export interface ClipCaptureDeps {
  /** 현재 세션 id — 클립 키 prefix. 세션 경계마다 바뀌므로 값이 아니라 getter로 받는다. */
  getSessionId: () => string;
  getRecorder: () => AudioRecorder | null;
  /** sessionId를 자동 동봉하는 세션 로거(useVoiceSession의 logCell). */
  logCell: LogCell;
  /** 명령 클립을 위해 활성 클립의 stop을 가로챈 직후 호출 — 호출부가 활성 클립 좌표를 비운다. */
  onCommandClipDetached: () => void;
}

export function useClipCapture(deps: ClipCaptureDeps) {
  /** 셀별 값 클립 재시도 횟수 — 아카이브 키 `:a<n>`의 n. */
  const attemptRef = useRef<Record<string, number>>({});
  /** 셀별 명령('수정') 클립 횟수 — 명령 클립 키 `:cmd<n>`의 n. */
  const cmdIndexRef = useRef<Record<string, number>>({});
  /** 진행 중인 클립 저장들. 아카이브 전 · 세션 stop · pause에서 유예 상한까지 기다린다. */
  const pendingSavesRef = useRef<Set<Promise<unknown>>>(new Set());

  // 주입된 deps를 ref로 받아 **노출 함수의 identity를 영구 고정**한다(모든 useCallback이 `[]`).
  // 호출부가 인라인 화살표를 넘기거나(=매 렌더 새 identity) 비메모이즈 logCell을 넘겨도, 그 변화가
  // 이 훅의 반환값으로 전파되면 안 된다 — 반환 함수들은 useVoiceSession의 handleFinal 의존성
  // 배열에 들어가므로, identity가 흔들리면 매 렌더 handleFinal이 재생성돼 STT 배선이 요동친다.
  // 분리 전 원본이 `useCallback(..., [])`로 고정이었던 계약을 그대로 보존하는 것이 목적이다.
  const depsRef = useRef(deps);
  depsRef.current = deps;

  /** in-flight 클립 저장을 유예 상한까지 기다린다(아카이브/stop/pause 3경로 공용).
   *  타임아웃 타이머는 저장이 먼저 끝나면 clearTimeout으로 해제한다 — no-op이지만 세션 시작·정지를
   *  반복할 때 고아 타이머가 누적되지 않게(리뷰 라운드1 Pro·라운드2 Flash 반복 지적).
   *
   *  `exclude`: 자기 자신의 저장 Promise를 기다리면 교착이므로 제외한다(실패 캡처 해소 경로). */
  const flushSaves = useCallback(
    async (graceMs: number, opts?: { exclude?: Promise<unknown> | null }): Promise<void> => {
      const pending = Array.from(pendingSavesRef.current).filter((p) => p !== opts?.exclude);
      if (pending.length === 0) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.allSettled(pending),
        new Promise<void>((resolve) => { timer = setTimeout(resolve, graceMs); }),
      ]);
      clearTimeout(timer);
    },
    [],
  );

  /** 저장 Promise를 장부에 올리고 정착 시 자동으로 내린다. */
  const trackSave = useCallback((savePromise: Promise<unknown>): void => {
    pendingSavesRef.current.add(savePromise);
    void savePromise.finally(() => pendingSavesRef.current.delete(savePromise));
  }, []);

  /** 이 셀에 지금까지 저장된 명령 클립 개수(없으면 undefined) — 실패 캡처 해소가 `:cmd<n>` 키를
   *  조립할 때 쓴다. 커밋 시점에 고정해야 지연 재개 시 다음 세션 인덱스로 오염되지 않는다. */
  const commandClipIndex = useCallback(
    (row: number, colId: string): number | undefined => cmdIndexRef.current[`${row}:${colId}`],
    [],
  );

  /** 세션 경계 리셋 — 인덱스만 비운다(진행 중 저장은 stop/pause 경로가 flush로 정착시킨다). */
  const resetCounters = useCallback((): void => {
    attemptRef.current = {};
    cmdIndexRef.current = {};
  }, []);

  /** Archive the clip currently stored at the bare cell key (`sessionId:row:colId`) under a fresh
   *  attempt key (`sessionId:row:colId:a<n>`) BEFORE a correction overwrites/clears it, so the
   *  misrecognised original audio survives in IDB. Background (not awaited) — never blocks the
   *  voice flow. Emits a `clip_preserved` event carrying the attempt index + archive key so the
   *  next analyst can re-join attempts in order. Returns the archive key (or null if nothing to
   *  archive). The bare key is left intact for the next attempt's save to overwrite. */
  const archiveCellClip = useCallback((row: number, colId: string): string | null => {
    const { getSessionId, logCell } = depsRef.current;
    const bareKey = `${getSessionId()}:${row}:${colId}`;
    const cellKey = `${row}:${colId}`;
    const attempt = (attemptRef.current[cellKey] ?? 0) + 1;
    attemptRef.current[cellKey] = attempt;
    const archiveKey = `${bareKey}:a${attempt}`;
    void (async () => {
      try {
        // The prior attempt's clip save may still be in-flight (savePromise resolves after the
        // echo TTS, but a fast correction can race it). Flush pending saves before reading the
        // bare key so we archive the real blob rather than null. Background — no UX impact.
        await flushSaves(1500);
        const blob = await loadAudioClip(bareKey);
        if (!blob) return; // nothing recorded yet (e.g. direct-modify before any clip) — skip
        await saveAudioClip(archiveKey, blob);
        logCell({
          type: 'clip', extra: 'clip_preserved', kind: 'value', attempt, clipKey: archiveKey,
          row, colId,
        });
      } catch (e) {
        logCell({ type: 'error', extra: `clip_preserve_failed:${String((e as Error)?.message ?? e)}`, row, colId });
      }
    })();
    return archiveKey;
  }, [flushSaves]);

  /** Preserve the '수정'/'정정' command utterance itself as an audio clip. The command is spoken
   *  into the clip the last announceField started for `awaiting`, but that clip was previously
   *  dropped (enterModifyMode starts a new clip without stopping/saving the old one). We stop it
   *  here and persist it under `sessionId:row:colId:cmd<n>` (kind:'command') so analysis can hear
   *  the exact utterance that declared the correction alongside the surrounding value attempts.
   *  Fully background — the save promise is tracked but NEVER awaited before announcing, so the
   *  voice flow is not delayed (top-priority constraint). */
  const preserveCommandClip = useCallback((row: number, colId: string): PendingCommandClip | null => {
    const { getSessionId, getRecorder, logCell, onCommandClipDetached } = depsRef.current;
    const rec = getRecorder();
    if (!rec) return null;
    // Detach the active clip's stop now, before enterModifyMode's announceField starts a new one.
    // We CAPTURE the stop here (the '수정' utterance is spoken into the AWAITING cell's clip) but
    // DEFER the save until the modify TARGET cell is resolved — for a direct "수정 <값>" the clip
    // is the new value's audio and must be keyed to the cell it corrects, not the awaiting cell
    // (CLIP-CMD: keying it to the awaiting colId left the corrected cell's pointer orphaned).
    const stopPromise = rec.stopClip();
    onCommandClipDetached();

    let saved = false;
    /** Persist the captured utterance under the given cell's :cmd<n> key. Returns the cmdKey on
     *  success (clip non-empty), or null if empty/failed. Idempotent — saves at most once. */
    const saveFor = (targetRow: number, targetColId: string): string | null => {
      if (saved) return null;
      saved = true;
      const cellKey = `${targetRow}:${targetColId}`;
      const idx = (cmdIndexRef.current[cellKey] ?? 0) + 1;
      cmdIndexRef.current[cellKey] = idx;
      const cmdKey = `${getSessionId()}:${targetRow}:${targetColId}:cmd${idx}`;
      const savePromise = (async () => {
        try {
          const { blob, raw, rawSkip } = await stopPromise;
          if (!blob || blob.size <= EMPTY_CLIP_BYTES) {
            logCell({ type: 'clip', extra: `clip_cmd_empty:${blob ? blob.size : 'null'}`, kind: 'command', row: targetRow, colId: targetColId });
            return;
          }
          await saveAudioClip(cmdKey, blob);
          logCell({ type: 'clip', extra: 'clip_preserved', kind: 'command', attempt: idx, clipKey: cmdKey, row: targetRow, colId: targetColId });
          // v0.5.0 W6 원본 보존(민구 결정): 트림 전 전체본(프리롤 포함)을 `…:raw`로 함께 보관.
          // deleteSession의 prefix cascade와 exportLog의 `key.split(':')[0]` 세션 필터가 모두
          // `sessionId:` prefix 기준이라 추가 배선 없이 zip clips/ 포함·삭제가 따라온다.
          if (raw) {
            try {
              await saveAudioClip(`${cmdKey}:raw`, raw);
              logCell({ type: 'clip', extra: `clip_raw_saved:${raw.size}`, kind: 'command', clipKey: `${cmdKey}:raw`, row: targetRow, colId: targetColId });
            } catch (e) {
              logCell({
                type: 'error',
                extra: clipRawSaveFailed(String((e as Error)?.message ?? e)),
                kind: 'command',
                clipKey: `${cmdKey}:raw`,
                row: targetRow,
                colId: targetColId,
              });
            }
          } else {
            logCell({
              type: 'clip',
              extra: clipRawSkipped(rawSkip ?? 'unknown'),
              kind: 'command',
              clipKey: cmdKey,
              row: targetRow,
              colId: targetColId,
            });
          }
        } catch (e) {
          logCell({ type: 'error', extra: `clip_cmd_save_failed:${String((e as Error)?.message ?? e)}`, row: targetRow, colId: targetColId });
        }
      })();
      trackSave(savePromise);
      // Return the cmdKey synchronously so the caller can re-link the cell pointer; the actual
      // bytes land asynchronously (background save, never awaited — voice flow not delayed).
      return cmdKey;
    };

    return {
      // Key the saved clip + return the cmdKey for the cell being corrected.
      saveFor,
      // Save against the (row, colId) this closure captured — the awaiting cell at preserve-time.
      // Callers only use this when awaiting === target (see PendingCommandClip.saveDefault doc);
      // the plain-cascade path uses `saveFor(targetRow, target.id)` directly instead.
      saveDefault: () => { saveFor(row, colId); },
    };
  }, [trackSave]);

  return {
    archiveCellClip,
    preserveCommandClip,
    commandClipIndex,
    trackSave,
    flushSaves,
    resetCounters,
  };
}
