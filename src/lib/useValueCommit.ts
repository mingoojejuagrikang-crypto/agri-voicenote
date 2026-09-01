/**
 * [ENV-12] Stage 3 서브 훅 #9 — **값 커밋(value commit)**: `handleFinal` 구획의 블록 F를 그대로
 * 옮긴 것이다. 값 게이트(`useFinalValueGate`)가 자격을 인정한 값을 **store에 커밋하고**
 * (setRowValue · ✓ 집합 · 영수증 · burst), 증분 영속화를 발사하며, 그 셀의 **오디오 클립을
 * 종결**한다(stop → 저장 → 실패 시 포인터 복구). 세션 컨텍스트는 주입받는다.
 *
 * 🔴 **`runValueCommit`의 identity는 영구 고정이다** — 형제 스테이지와 같은 이유(반환값이 본체
 * `handleFinal`의 dep 배열에 들어가고, 흔들리면 `onFinal` 배선 4곳 + 조기확정 1곳이 재생성돼
 * 인식이 끊긴다). `useCallback([])` + `depsRef`.
 *
 * 🔴 **이 구획은 조기 return이 없다 — 직선 커밋이다.** 잔존 `return;` 5개는 전부 **중첩 함수
 * 내부**다(`runCorrectedPersistCheck` 1 · `resolveFailedCapture` 1 · `savePromise` IIFE 3).
 * 그래서 이동에서 handled 신호 치환이 **0건**이고 본문이 바이트 100% 동일하다 —
 * [CLIP-VAL-1] 계열 계약(톰스톤·재연결·stale 가드)과 클립 로그 문구가 한 글자도 안 바뀐다.
 *
 * 🔑 **`parsed`를 ctx가 아니라 인자로 받는 이유.** `FinalCtx.parsed`는 선택 필드라
 * (`string | null | undefined`) 여기서 non-null을 **타입으로 증명할 수 없다**. 본체는 값 게이트
 * 직후 이미 그것을 확인했으므로 그 값을 그대로 넘겨 컴파일러가 계약을 강제하게 한다 —
 * 스테이지 안에서 다시 좁히면 **도달 불가 분기**가 하나 더 생긴다.
 * 🔑 **산출물 3종을 반환하는 이유.** (E3 원문은 *"반환도 한다 — ctx에도 싣지만"*이었다.
 * 🔴 E5 정리로 ctx 쓰기는 제거됐다 — E4가 인자 경로를 골라 그 사본의 독자가 0이 됐기 때문이다.
 * 반환값이 **유일한 인계 경로**다.) 이번 회차의 직접
 * 소비자는 **아직 본체에 있는 블록 G+H**다. ctx의 선택 필드로 넘기면 본체가 도달 불가 가드를
 * 하나 더 쓰거나 캐스트해야 하고, 그 가드가 침범당하면 「값은 커밋됐는데 착지(echo·advance)만
 * 증발」이라는 **가장 나쁜 형상**이 된다. 반환값은 그 상태를 계약이 아니라 **구성으로** 막는다.
 *
 * ⚠️ 규범 이탈 자진 신고
 *  ① 형제 훅 파일에서 **값을 import**하는 첫 스테이지다(`EMPTY_CLIP_BYTES` ← `useClipCapture`).
 *     `useClipCapture`는 이 파일을 역참조하지 않으므로 순환이 아니다(§5-3 판정 기준 그대로).
 *     함수는 여전히 전부 주입이다 — `clipCapture`의 세 메서드도 주입으로 받는다.
 *  ② 아래 ref는 getter가 아니라 **ref 그대로** 받는다(영구): `pendingClipsRef`·
 *     `brokenClipKeysRef`·`activeClipRef` — 클립 슬롯/장부 **공유 상태**다. 이 구획이 등록·
 *     톰스톤·해제를 전부 하고 본체의 재획득 복구·persist가 같은 맵을 읽는다. 한쪽만 옮기면
 *     좌표가 두 벌이 된다(clip_empty 재개방). `awaitingFieldRef`(다중 기록자 — 여기서 커밋
 *     완료로 null) · `epochRef`(레이스 가드 SSOT — 여기서 bump) · `sessionIdRef`·`recorderRef`.
 */
import { useCallback, useRef } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { useSessionCommitMarks } from '../components/voice/useVoiceCommitMark';
import { relinkClipPointer, unlinkClipPointer } from './clipPointer';
import { loadAudioClip, loadSession, saveAudioClip } from './db';
import { logger } from './logger';
import { EMPTY_CLIP_BYTES } from './useClipCapture';
import type { ClipHealth } from './clipHealth';
import type { AudioRecorder, ClipResult } from './audioRecorder';
import type { Session } from '../types';
import type { AwaitingField, FinalCtx } from './useVoiceSession';

type LogCell = (entry: Omit<Parameters<typeof logger.log>[0], 'sessionId'>) => void;

export interface ValueCommitDeps {
  logCell: LogCell;
  persistSession: (
    pendingOverride?: Session['pendingValidation'] | null,
    publishPendingStage?: boolean,
  ) => Promise<boolean>;
  archiveCellClip: (row: number, colId: string) => string | null;
  /** 클립 장부 소유자의 세 메서드 — 함수는 주입이다(헤더 ①). */
  clipCapture: {
    commandClipIndex: (row: number, colId: string) => number | undefined;
    flushSaves: (graceMs: number, opts?: { exclude?: Promise<unknown> | null }) => Promise<void>;
    trackSave: (savePromise: Promise<unknown>) => void;
  };
  /** v0.50 [CLIP-SILENT-1] — `force`는 「연속 실패가 임계에 닿았으니 `isStreamLost()`가 false여도
   *  마이크 소실로 봐라」다. 무음 트랙은 `ended`가 아니라 종전 판정이 **영원히 no-op**이었다. */
  maybeAutoRecoverOrLatch: (reason: string, opts?: { force?: boolean }) => void;
  /** v0.50 [CLIP-SILENT-1] — 세션 단위 클립 건강도 장부(연속 실패 카운터 + 결산).
   *  🔴 리셋은 **`clip_saved`에서만**이다 — 근거는 `clipHealth.ts` 헤더. */
  clipHealth: ClipHealth;
  /** 🔴 모듈 레벨 비-export 헬퍼 — 값 import는 순환이다(§5-3). */
  isModifyLike: (a: AwaitingField) => boolean;
  epochRef: { current: number };
  awaitingFieldRef: { current: AwaitingField | null };
  sessionIdRef: { current: string };
  recorderRef: { current: AudioRecorder | null };
  activeClipRef: { current: { row: number; colId: string } | null };
  pendingClipsRef: { current: Record<number, Record<string, string>> };
  brokenClipKeysRef: { current: Set<string> };
}

/** 블록 G+H(착지)가 이 구획에서 받아 가는 것 — `FinalCtx`의 같은 이름 필드와 짝이다. */
export interface ValueCommitResult {
  /** 레이스 가드 스냅샷 — 착지가 「다른 handleFinal이 끼어들었나」를 판정한다. */
  myEpoch: number;
  /** final 진입 → store 커밋까지의 앱 파이프라인 경과ms(echo TTS 길이가 섞이기 전에 캡처). */
  commitLatencyMs: number;
  /** 정정 커밋의 durable 검사 — **정의는 여기, 호출은 착지**(알람 TTS 이후 / 정상 종단). */
  runCorrectedPersistCheck: () => void;
}

export function useValueCommit(deps: ValueCommitDeps) {
  // 주입 deps를 ref로 받아 **노출 함수 identity를 영구 고정**한다(헤더 🔴 첫 항목).
  const depsRef = useRef(deps);
  depsRef.current = deps;

  /**
   * 블록 F — 값 커밋 + 클립 종결. **조기 종료가 없다**(직선 실행: 이 구획에 들어오면 커밋된다).
   * @param parsed 값 게이트가 통과시킨 확정 문자열 — 본체가 non-null을 이미 확인했다(헤더 🔑).
   */
  const runValueCommit = useCallback(async (
    ctx: FinalCtx,
    parsed: string,
  ): Promise<ValueCommitResult> => {
    const {
      logCell, persistSession, archiveCellClip, clipCapture, maybeAutoRecoverOrLatch, clipHealth, isModifyLike,
      epochRef, awaitingFieldRef, sessionIdRef, recorderRef, activeClipRef, pendingClipsRef,
      brokenClipKeysRef,
    } = depsRef.current;
    // 이동 계약 §3-7 치환 ① — ctx를 본문에 흩뿌리는 대신 **진입부에서 1회 분해**한다. 종전
    // handleFinal 안의 지역변수 이름을 그대로 복원하므로 아래 본문은 바이트 동일이다.
    const { text, awaiting, handleFinalAt } = ctx;

    const myEpoch = ++epochRef.current;
    const sess = useSessionStore.getState();
    sess.setRowValue(awaiting.row, awaiting.colId, parsed);
    // v0.47.0 W4(FB-E) — 음성 확정 커밋의 ✓ 집합 등록(value·modify·trendConfirm 정정 공통.
    //   아래 추세위반 분기도 "커밋된 값은 그대로 선다"이므로 이 지점이 맞다).
    useSessionCommitMarks.getState().add(awaiting.row, awaiting.colId);
    // v0.37.0 리뷰#1 — 검토 영수증(모든 커밋 경로 공통). trendConfirm(정정)도 **무조건** 발행한다:
    //   valueBurst는 아래에서 중복 팝업 억제로 정정 커밋을 건너뛰지만(불변), 검토 화면은 정정된
    //   실제 커밋값을 보여야 하므로 영수증은 정정 여부와 무관하게 발행한다.
    sess.pushCommitReceipt(awaiting.row, awaiting.colId, awaiting.name, parsed);
    sess.setRecognized(parsed);
    sess.setReaskReason(null); // v0.23.0 입력탭#2 — 성공 커밋 시 재질문 사유 큐 해제.
    // v0.20.0 Phase 5 #4 — 반응속도: final 진입→값 store 커밋까지 앱 파이프라인 경과ms(파싱·가드·
    // 동음이의/소수 합성 포함). 아래 value 이벤트(정상·추세위반 둘 다)에 durationMs로 싣는다 — echo
    // TTS 대기 전에 캡처해 TTS 길이가 섞이지 않게 한다(순수 커밋 지연).
    const commitLatencyMs = Date.now() - handleFinalAt;
    // v0.15.0 A4 — 이상치→정정→정상 흐름 중복 팝업 억제. 추세 알림에 새 값으로 응답한 정정 커밋
    // (trendConfirm)은 아래에서 anomalyAlert 팝업을 초록(corrected)으로 전환해 이미 같은 값을 크게
    // 보여준다. 그 뒤 진행 착지점의 clearAnomalyAlert가 팝업을 닫으면, VoiceScreen의
    // `valueBurst && !anomalyAlert` 조건이 참이 되며 같은 값이 CenterValueBurst로 한 번 더 떠
    // "정상 입력 내용이 한 번 더 팝업"되던 중복(민구 제보)이 발생한다. 정정-출처 커밋에선 burst를
    // 건너뛰어 중앙 팝업이 1회(초록 corrected)만 뜨게 한다. 일반(비-정정) 커밋의 burst는 그대로 유지.
    //
    // 🔴 v0.46.1 FB-10 — **이 억제는 그대로 둔다. 여기서 고치려 하지 마라.**
    //  FB-10(정정 완료도 확정 표시를 받아야 한다)은 이 줄을 푸는 방식으로는 안 고쳐진다 —
    //  **실측으로 확인했다**: burst를 여기서 밀면 그 시점의 중앙은 아직 알람 카드라 `VoiceHero`가
    //  언마운트 상태이고, corrected 전환과 burst push는 같은 React 배치에 들어가 hero가 붙는
    //  렌더에서 `useConfirmFlash`의 *마운트 시점 burst 미재생* 가드(VoiceHero의 `seenSeqRef===null`,
    //  v0.35.0 FIX-3)에 **조용히 삼켜진다**. 프로브 실측: 알람 카드는 사라졌는데 `hero=listening`,
    //  확정 플래시 0회(`tests/_probe-fb10-transition.spec.ts`, 402×513).
    //  👉 그래서 표시 계층에서 푼다 — `CenterStage`가 corrected를 hero 브랜치로 보내며 값을
    //  `confirmBurst` prop으로 직접 넘긴다. store 흐름(억제 포함)은 **한 줄도 안 바뀐다.**
    if (awaiting.kind !== 'trendConfirm') {
      sess.pushValueBurst(awaiting.name, parsed, awaiting.colId); // I-3: 중앙 버스트 + 칩 V(UI③)
    }
    awaitingFieldRef.current = null;

    // v0.7.0 B4: 추세 알림에 새 값으로 응답한 재커밋 — 정정 기록(오알림률 분모) + 이전 값 발화
    // 클립 보존. 새 저장이 같은 bare key(`sess:row:colId`)를 덮어쓰므로 :a<n>로 먼저 보관한다
    // (RACE-4 보존 원칙 — enterModifyMode의 archive 패턴과 동일, 백그라운드).
    if (awaiting.kind === 'trendConfirm') {
      logCell({
        type: 'trend', extra: 'trend_alert_corrected',
        row: awaiting.row, colId: awaiting.colId,
        text, parsed,
        ...(awaiting.previousValue != null ? { previousValue: awaiting.previousValue } : {}),
      });
      archiveCellClip(awaiting.row, awaiting.colId);
    }

    // v0.10 클립 누락 수정: stopClip을 echo TTS 이전에 시작 (병렬 실행)
    // 이전 버그: await speak(echo) 동안 마이크 stream이 idle → 다음 startClip이 호출되면 이전 슬롯 손실
    const clipKey = `${sessionIdRef.current}:${awaiting.row}:${awaiting.colId}`;
    const clipAwaitingRow = awaiting.row;
    const clipAwaitingColId = awaiting.colId;
    // [CLIP-VAL-1]②: whether this commit is a modify re-record — on a failed capture the cell's
    // pointer is re-linked to the modify-command clip (`…:cmd<n>`) instead of being left on the
    // canonical key (which still holds the PREVIOUS value's audio — the "155.5 cell plays 177.7"
    // defect) or silently unlinked.
    const wasModify = isModifyLike(awaiting);
    pendingClipsRef.current[clipAwaitingRow] = {
      ...pendingClipsRef.current[clipAwaitingRow],
      [clipAwaitingColId]: clipKey,
    };
    // v0.4.4 증분 영속화: 값 커밋 직후(행이 완료되기 전이라도) 진행 행을 IDB에 저장한다. advance()가
    // 행 완료 시 다시 저장하므로 중복이지만, 마지막 필드 입력 전 새로고침/앱 업데이트로 부분 입력이
    // 유실되는 것을 막는 핵심 보호다. (fire-and-forget — echo TTS/진행을 막지 않음.)
    // v0.24.0 데이터-3 진단 — 이상치 교정 커밋이면 persist 후 dataStore 값이 교정값과 일치하는지
    // 가시화(불일치=옛값 잔존, 단조 가드가 막아야 함). 다음 실기기 세션에서 재현 시 근인 즉시 포착.
    // v0.34.0 O1 — 검사 **시점 이동**: 이전엔 persist resolve 직후 즉시 검사해, 커밋 경로가 아직
    // 진행 중(echo/알람 TTS·후속 persist 정착 전)에 dataStore를 읽어 mismatch 오탐 ×2를 기록했다
    // (07-14 실기기 r8c8 — 정정 09:23:38 검사 vs value 09:23:40, 실피해 0). persist는 그대로
    // fire-and-forget으로 발사하되, 검사는 커밋 경로 종단(value 이벤트 이후 — 알람 분기는 알람 TTS
    // 이후)에 스케줄해 durable 반영이 정착한 뒤 1회만 판정한다(로직 최소 변경 — 비교식 동일).
    const wasTrendCorrected = awaiting.kind === 'trendConfirm';
    const persistPromise = persistSession();
    void persistPromise.catch(() => {});
    const runCorrectedPersistCheck = () => {
      if (!wasTrendCorrected) return;
      void persistPromise.then(async (durable) => {
        // dataStore는 IDB 실패 뒤에도 과거 코드에서 갱신될 수 있어 검증 근거가 아니다. save 성공
        // 결과를 먼저 요구하고 같은 레코드를 IDB에서 재조회해 재시작 후에도 남을 값을 판정한다.
        let persisted: string | undefined;
        let readFailed = false;
        if (durable) {
          try {
            const saved = await loadSession(sessionIdRef.current);
            persisted = saved?.rows.find((r) => r.index === clipAwaitingRow)?.values[clipAwaitingColId];
          } catch (err) {
            readFailed = true;
            logCell({
              type: 'error', extra: `trend_corrected_persist_read_failed:${String((err as Error)?.message ?? err)}`,
              row: clipAwaitingRow, colId: clipAwaitingColId,
            });
          }
        }
        logCell({
          type: 'trend',
          extra: !durable
            ? 'trend_corrected_persist_check:write_failed'
            : readFailed
              ? 'trend_corrected_persist_check:read_failed'
            : persisted === parsed
              ? 'trend_corrected_persist_check:ok'
              : 'trend_corrected_persist_check:mismatch',
          row: clipAwaitingRow, colId: clipAwaitingColId, parsed,
          ...(persisted !== parsed ? { previousValue: String(persisted ?? '') } : {}),
        });
      });
    };
    // Codex MEDIUM-4: clip for this field is being committed (stopped) — no longer active.
    // The next announceField will re-set it after its own startClip().
    activeClipRef.current = null;
    const clipStopPromise: Promise<ClipResult> =
      recorderRef.current?.stopClip()
      ?? Promise.resolve({ blob: null, raw: null, prerollMs: 0 });
    // 포인터 정리/재연결은 clipPointer 모듈(Stage 3-3 순수 이동)이 담당 — 소유권 가드 계약 포함.
    // 여기서는 이 커밋의 좌표(clipKey·row·colId)를 고정 인자로 묶는다.
    const pointerArgs = {
      sessionId: sessionIdRef.current,
      row: clipAwaitingRow, colId: clipAwaitingColId, clipKey,
      pendingClips: pendingClipsRef.current,
    };
    // 지연 재개 방어(v0.35.3 리뷰 s3r2 Codex Medium) — 이 커밋의 세션·cmd 인덱스도 **캡처 시점에
    // 고정**한다. 클립 저장이 stop() 유예(5s)를 넘긴 뒤 다음 세션이 시작되면 pendingClipsRef는 새
    // 객체로 재할당되지만 pointerArgs는 옛 세션의 맵을 계속 보므로 소유권 가드가 통과하는데, 이때
    // cmdKey를 라이브 sessionIdRef(새 세션)로 조립하면 옛 세션 행이 새 세션 클립 키를 참조하는
    // provenance 오염이 생긴다. 캡처 고정으로 지연 콜백은 이 커밋의 문맥만 본다.
    const sessionIdAtCommit = sessionIdRef.current;
    const cmdIdxAtCommit = clipCapture.commandClipIndex(clipAwaitingRow, clipAwaitingColId);
    // [CLIP-VAL-1]②③ — a capture under the canonical key failed. Tombstone the key FIRST (so an
    // in-flight persistSession can never re-persist it), then: if this was a modify re-record and
    // its command clip (`…:cmd<n>` — for "수정 <값>" it carries the NEW value's utterance) actually
    // saved, re-link the cell's playback pointer to it (06-11 row8: the correct audio WAS on disk
    // as `8:c7:cmd1`); otherwise unlink so no stale previous-value audio remains canonical.
    const resolveFailedCapture = async (savePromiseSelf: Promise<unknown> | null) => {
      brokenClipKeysRef.current.add(clipKey);
      if (wasModify) {
        const n = cmdIdxAtCommit;
        if (n) {
          const cmdKey = `${sessionIdAtCommit}:${clipAwaitingRow}:${clipAwaitingColId}:cmd${n}`;
          // The cmd-clip save may still be in flight — flush other pending saves (not ourselves)
          // before the existence check (archiveCellClip's flush pattern, bounded).
          await clipCapture.flushSaves(1500, { exclude: savePromiseSelf });
          const cmdBlob = await loadAudioClip(cmdKey).catch(() => null);
          if (cmdBlob && relinkClipPointer(pointerArgs, cmdKey)) {
            // 지연 재개 시 라이브 sessionId(다음 세션)로 오귀속되지 않게 캡처된 세션으로 기록.
            logger.log({
              type: 'clip', extra: 'clip_relink_cmd', kind: 'command', clipKey: cmdKey,
              sessionId: sessionIdAtCommit, row: clipAwaitingRow, colId: clipAwaitingColId,
            });
            return;
          }
        }
      }
      unlinkClipPointer(pointerArgs);
    };
    // Holder for the savePromise's own identity (assigned right after creation, before the
    // IIFE's first await resumes) so resolveFailedCapture can exclude itself from the flush.
    let savePromiseSelf: Promise<unknown> | null = null;
    const savePromise = (async () => {
      try {
        logCell({ type: 'clip', extra: 'clip_stop_await', row: clipAwaitingRow, colId: clipAwaitingColId });
        const { blob: clipBlob, raw: rawBlob, trimFailed, trimFailReason, mutedSpan } = await clipStopPromise;
        logCell({ type: 'clip', extra: `clip_stop_resolved:${clipBlob ? clipBlob.size : 'null'}`, row: clipAwaitingRow, colId: clipAwaitingColId });
        // v0.20.0 BL-2 — 트림이 예외(decodeAudioData 등)로 생략됐으면(저장본=미트림 원본 webm) 가시화한다.
        // 이전엔 무이벤트 침묵 폴백이라 "음성클립 편집 실패"(이원창 c7 3·4·5 = 비고 3행)가 로그에 안 보였다.
        // 클립 자체는 저장되어 재생 가능(capture 플로우 불깨짐) — 이건 순수 관측용 신호다(보수적).
        if (trimFailed) {
          logCell({
            type: 'clip', extra: `clip_trim_failed:${trimFailReason ?? 'unknown'}`,
            row: clipAwaitingRow, colId: clipAwaitingColId, clipKey,
          });
        }
        if (!clipBlob) {
          // v0.20.0 Phase 5 #5 — clip_empty에 직전 입력장치 전이(있으면)를 컨텍스트로 동봉한다.
          // BT clip_empty는 내장↔블루투스 thrash 직후 트랙 사망으로 발생 — 전이를 같은 이벤트에 붙여
          // 다음 분석이 BT 라우팅 원인을 즉시 잇게 한다(이전엔 별도 input_device_changed와 ts로만 상관).
          const lic = recorderRef.current?.getLastInputChange();
          logCell({
            type: 'error',
            extra: lic ? `clip_empty:after:${lic.reason}:${lic.transition}` : 'clip_empty',
            row: clipAwaitingRow, colId: clipAwaitingColId,
          });
          // v0.22.0 P0 — 빈 클립 자동 재시도 폭주 차단. 자동 recoverStream은 iOS에서 **제스처 밖
          // getUserMedia**라 NotAllowedError로 거부되어 살아있던 스트림까지 잃고 매 빈 클립마다
          // 재시도가 폭주했다(실기기: clip_empty×41). → 스트림이 실제로 죽었으면 자동 재시도를 멈추고
          // micLost로 표시(once 가드) → 사용자 제스처(reconnectMic)로만 복구. 스트림이 멀쩡하면
          // no-op(다음 클립이 자가 치유). 자동 recoverStream은 더 이상 부르지 않는다(수칙 3).
          // v0.50 [CLIP-SILENT-1] — 연속 실패가 임계에 닿으면 스트림이 `live`여도 소실로 래치한다.
          // 🔴 v0.51 [CLIP-MUTED-SPAN-1] — **사유를 붙인다.** 「비었다」와 「마이크를 OS가 가져간
          //   동안이라 비었다」는 판독에 전혀 다른 사실이다(전자는 앱 결함 후보, 후자는 외부 사건).
          //   기존 `clip_empty` 바이트는 건드리지 않고 **옆에 한 줄** 남긴다(PRINCIPLES §4).
          //   ⚠️ 여기서 `recordUnreliable()`은 부르지 않는다 — 이미 `recordFailure()`로 셌다.
          //   같은 클립을 두 칸에 세면 결산의 합이 커밋 수를 넘는다.
          if (mutedSpan) logCell({ type: 'clip', extra: 'clip_muted_fail:empty', row: clipAwaitingRow, colId: clipAwaitingColId });
          maybeAutoRecoverOrLatch('clip_empty', { force: clipHealth.recordFailure() });
          await resolveFailedCapture(savePromiseSelf);
          return;
        }
        if (clipBlob.size <= EMPTY_CLIP_BYTES) {
          logCell({ type: 'error', extra: `clip_too_small:${clipBlob.size}`, row: clipAwaitingRow, colId: clipAwaitingColId });
          // v0.50 [CLIP-SILENT-1] — 위 clip_empty와 **같은 카운터**를 쓴다(사유가 섞여 나오므로 —
          // 2026-08-19 양혁진 실측: 5B 6건 + chunk-0 3건이 한 구간에서 뒤섞였다).
          // v0.51 [CLIP-MUTED-SPAN-1] — 같은 이유로 사유만 부착(위 clip_empty 주석이 SSOT).
          //   2026-09-01 폐기 세션의 실측 형상이 정확히 이것이다(mute → 21초 뒤 clip_too_small:5).
          if (mutedSpan) logCell({ type: 'clip', extra: 'clip_muted_fail:too_small', row: clipAwaitingRow, colId: clipAwaitingColId });
          maybeAutoRecoverOrLatch('clip_too_small', { force: clipHealth.recordFailure() });
          await resolveFailedCapture(savePromiseSelf);
          return;
        }
        // v0.11.0 Codex HIGH: pendingClipsRef로 stale save 차단.
        // restart/modify가 pendingMap[colId]를 정리하거나 새 키로 교체하면, 옛 savePromise는
        // m[colId] !== clipKey가 되어 폐기됨. epoch 가드보다 정밀해서 정상 클립을 차단하지 않음.
        const guard = pendingClipsRef.current[clipAwaitingRow];
        if (!guard || guard[clipAwaitingColId] !== clipKey) {
          logCell({ type: 'error', extra: 'clip_stale_pending', row: clipAwaitingRow, colId: clipAwaitingColId });
          return;
        }
        await saveAudioClip(clipKey, clipBlob);
        // [CLIP-VAL-1]③: fresh bytes landed under this key — lift the tombstone so the pointer
        // may persist again (a previous failed attempt on the same cell reuses the same key).
        brokenClipKeysRef.current.delete(clipKey);
        logCell({ type: 'clip', extra: `clip_saved:${clipBlob.size}`, row: clipAwaitingRow, colId: clipAwaitingColId });
        // 🔴 v0.51 [CLIP-MUTED-SPAN-1] — **바이트가 멀쩡해도 muted 구간에 걸쳤으면 증거가 아니다.**
        //   여기가 2026-09-01 B축의 실제 구멍이다: 종전에는 이 클립이 `clip_saved`로 세어지고
        //   `recordSaved()`가 **연속 실패 카운터까지 리셋**했다 — 저장된 것은 무음인데 집계는
        //   성공이라고 말한다. 실측이 5바이트였던 것은 iOS의 그 구간에서 그랬을 뿐,
        //   크기는 기기·구간 길이에 따라 변한다.
        //   🔑 **파일은 그대로 저장한다**(민구 확정 ②A — 보존 우선). muted가 구간의 일부만
        //   덮었으면 부분 발화는 살아 있고, 그건 사람이 들어 판단할 몫이다. 바꾸는 것은
        //   **저장 여부가 아니라 회계**다: `saved`가 아니라 `unreliable`로 센다.
        if (mutedSpan) {
          logCell({
            type: 'clip', extra: 'clip_unreliable:muted',
            row: clipAwaitingRow, colId: clipAwaitingColId, clipKey,
          });
          clipHealth.recordUnreliable();
        } else {
          // v0.50 [CLIP-SILENT-1] — **여기가 유일한 리셋 지점이다.** `clip_started`로 리셋하면
          // 재질문이 잦은 세션에서 래치가 영영 안 걸린다(clipHealth.ts 헤더 🔴).
          clipHealth.recordSaved();
        }
        // v0.5.0 W6 원본 보존(민구 결정): 트림 전 전체본(프리롤 포함)을 `…:raw`로 함께 보관.
        // pendingClips에는 등록하지 않으므로 데이터탭 재생 UI에는 노출되지 않고, 로그 zip의
        // clips/(prefix 매칭)과 deleteSession cascade에만 따라간다. 분석 전용.
        if (rawBlob) {
          await saveAudioClip(`${clipKey}:raw`, rawBlob);
          logCell({ type: 'clip', extra: `clip_raw_saved:${rawBlob.size}`, clipKey: `${clipKey}:raw`, row: clipAwaitingRow, colId: clipAwaitingColId });
        }
      } catch (e) {
        logCell({ type: 'error', extra: `clip_save_failed:${String((e as Error)?.message ?? e)}`, row: clipAwaitingRow, colId: clipAwaitingColId });
        await resolveFailedCapture(savePromiseSelf);
      }
    })();
    savePromiseSelf = savePromise;
    clipCapture.trackSave(savePromise);

    // 착지(블록 G+H = `useCommitLanding`)가 받아 갈 산출물.
    // 🔴 [ENV-12] E5 정리 — **E4가 인자 경로를 골랐다.** E3 시점에는 「ctx = 선언된 구획 간 계약 /
    //   반환값 = 이번 회차 소비자를 위한 타입 안전 인계」로 둘 다 채우고 *"E4가 어느 쪽을 읽을지는
    //   그 회차가 정한다"*로 미뤘는데, E4는 `CommitLandingInput`(= 이 반환 타입의 확장)을 **인자로**
    //   받는 쪽을 택했다. 그래서 ctx 쓰기 3줄은 그 순간부터 **독자가 0**이었다(E5 실측 확인).
    //   죽은 쓰기를 남기면 「ctx가 이 값을 나른다」는 거짓 계약이 타입에 박힌 채로 남는다.
    return { myEpoch, commitLatencyMs, runCorrectedPersistCheck };
  }, []);

  return { runValueCommit };
}
