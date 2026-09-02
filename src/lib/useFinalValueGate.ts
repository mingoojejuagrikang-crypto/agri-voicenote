/**
 * [ENV-12] Stage 3 서브 훅 #8 — **값 게이트(final value gate)**: `handleFinal` 구획의 블록 D
 * (barge-in · STT/EOS 계측 · 흡수 3종) + 블록 E(값 가드 4종 · 파싱 · 거절 4분기)를 그대로 옮긴
 * 것이다. 명령 경로(`useFinalCommands`)가 폴스루시킨 발화를 받아 **값으로 설 자격**을 판정한다.
 *
 * 🔴 **`runValueGate`의 identity는 영구 고정이다** — `useFinalCommands` 헤더와 같은 이유(이 훅의
 * 반환값이 본체 `handleFinal`의 dep 배열에 들어가고, handleFinal의 identity가 흔들리면 `onFinal`
 * 배선 4곳 + 조기확정 1곳이 재생성돼 인식이 끊긴다). `useCallback([])` + `depsRef` 고정.
 * ⚠️ 주입 심볼 중 `logCell`·`voiceColsList`·`getSessionColumns`·`getColById`는 본체에서
 *   `useCallback`이 **아니다**(매 렌더 재생성). 임시 destructure + 정직한 dep 배열이라는 중간
 *   형태를 거칠 수 없는 이유가 그것이다(`useFinalCommands`가 세운 판단 그대로).
 *
 * 🔴 **D와 E는 한 파일이어야 한다 — 판별 유니온 내로잉이 둘에 걸쳐 있다.** E의 소수 문맥 해제
 * (`{ ...awaiting, fractionWhole: undefined }`)는 그 시점 `awaiting.kind`가 value|modify|
 * trendConfirm임에 기대는데, 그 좁힘을 만드는 것은 **D의 흡수 가드 3개**(atEnd·reviewWait·
 * cellWait가 각각 return)다. 둘을 가르면 그 증명이 파일 경계를 넘어 사라진다.
 *
 * 🔴 **모듈 헬퍼 `fractionWholeOf`는 import가 아니라 주입이다(순환).** `useVoiceSession.ts`의
 * 비-export 함수라 값 import하면 `useVoiceSession → useFinalValueGate → useVoiceSession`
 * 순환이다([LOGEVENTS-CYCLE-1] 유형). **type-only import만 허용**한다.
 *
 * ⚠️ 규범 이탈 자진 신고 — 아래 ref는 getter가 아니라 **ref 그대로** 받는다(영구):
 *  ① `awaitingFieldRef` — 본체·형제 스테이지와 함께 읽고 쓰는 **다중 기록자** 조정 상태다.
 *     이 구획은 소수 문맥의 1회 해제·재설정을 여기에 **쓴다**(E의 세 지점).
 *  ② `epochRef` — barge-in이 진행 중 advance/안내 체인을 무효화할 때 bump(소유자는 본체).
 *  ③ `lastInterimRef` — 이 구획이 EOS 꼬리를 재고 **소거하는** 지점이다(D). 소유자는 interim
 *     핸들러(본체)이고 여기서 수명이 끝난다.
 *  ④ `ctrlRef`(`isTtsMuted()` 읽기 전용) · `lastConfidenceRef`·`earlyCommitStableRef`(계측 쓰기).
 */
import { useCallback, useRef } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { useSettingsStore, minConfidenceForTolerance } from '../stores/settingsStore';
import { computeTotalRows } from './autoValue';
import { isAmbiguousSingleSyllable, isBareResponseWord } from './koreanNum';
import { bargeInTextSource, lowConfidenceParsed, wouldSalvage } from './logEvents';
import { cancelTts } from './speech';
import { attemptParseValue } from './valueParseAttempt';
import { cellWaitPrompt, reviewWaitAbsorbTts } from './voicePrompts';
import type { Column } from '../types';
import { endAbsorb } from './logEvents';
import type { logger } from './logger';
import type { AwaitingField, FinalCtx } from './useVoiceSession';

type LogCell = (entry: Omit<Parameters<typeof logger.log>[0], 'sessionId'>) => void;

export interface FinalValueGateDeps {
  logCell: LogCell;
  say: (text: string, interrupt?: boolean) => Promise<boolean>;
  rejectValue: (
    reason: 'low_confidence' | 'parse_failed',
    awaiting?: AwaitingField | null,
    opts?: { restartClip?: boolean; tail?: string; whole?: string },
  ) => Promise<void>;

  listEmptyRows: (total: number, vCols: Column[]) => number[];
  buildEndReachedTts: (empties: number[]) => string;
  voiceColsList: () => Column[];
  getSessionColumns: () => Column[];
  getColById: (id: string) => Column | null;
  /** 🔴 모듈 레벨 비-export 헬퍼 — 값 import는 순환이다(헤더). */
  fractionWholeOf: (a: AwaitingField) => string | undefined;
  ctrlRef: { current: { isTtsMuted: () => boolean } | null };
  lastInterimRef: { current: { text: string; at: number; confidence?: number } | null };
  lastConfidenceRef: { current: number };
  earlyCommitStableRef: { current: { value: string; since: number } | null };
  epochRef: { current: number };
  awaitingFieldRef: { current: AwaitingField | null };
}

export function useFinalValueGate(deps: FinalValueGateDeps) {
  // 주입 deps를 ref로 받아 **노출 함수 identity를 영구 고정**한다(헤더 🔴 첫 항목).
  const depsRef = useRef(deps);
  depsRef.current = deps;

  /**
   * 블록 D+E — 값 자격 판정 전량. **반환값이 곧 「이 final을 여기서 끝냈다」 신호**다.
   *  · `true`  = 흡수(atEnd·reviewWait·cellWait) 또는 거절(가드 4종·저신뢰·파싱 실패 3분기)로
   *              끝났다 — 본체는 즉시 return(종전 handleFinal 안의 조기 return과 등가).
   *  · `false` = **값이 파싱됐다.** 산출물(`col`·`fractionWhole`·`parsed`·`lowConfParsedExtra`)을
   *              `ctx`에 실어 본체의 커밋 경로로 넘긴다.
   * 🔑 `false`를 반환할 때 `ctx.parsed`는 **반드시 non-null**이다(파싱 실패는 전부 `true`로
   *    끝난다). 본체가 그 불변식을 다시 확인한다 — 침범하면 무음 값 유실이기 때문이다.
   */
  const runValueGate = useCallback(async (ctx: FinalCtx): Promise<boolean> => {
    const {
      logCell, say, rejectValue, listEmptyRows, buildEndReachedTts, voiceColsList,
      getSessionColumns, getColById, fractionWholeOf, ctrlRef, lastInterimRef,
      lastConfidenceRef, earlyCommitStableRef, epochRef, awaitingFieldRef,
    } = depsRef.current;
    // 이동 계약 §3-7 치환 ① — ctx를 본문에 흩뿌리는 대신 **진입부에서 1회 분해**한다. 종전
    // handleFinal 안의 지역변수 이름을 그대로 복원하므로 아래 본문은 바이트 동일이다.
    // `awaiting`은 `const`다 — 이 구획은 지역 재대입 없이 `awaitingFieldRef`에만 쓴다(실측).
    const { text, alts, confidence, awaiting } = ctx;

    // Input-2 → barge-in (v0.4.3): TTS 재생 중 들어온 값을 폐기하지 않고, 재생 중 TTS를 끊고
    // 그대로 처리한다. 사용자가 안내 TTS를 끝까지 들을 필요 없이 즉시 다음 값을 말할 수 있게 함.
    // 기존엔 폐기(stt_blocked_tts_muted) 후 재발화를 강요했음. 명령어는 위에서 이미 barge-in 처리됨.
    // 한계: 값은 final 단계에서 컷되므로 STT 확정까지 ~1~2초 TTS가 더 재생될 수 있음(명령어의 interim 컷보다 느림).
    // 잔여 에코 위험(TTS 숫자의 마이크 되먹임)은 아래 신뢰도 게이트(0.65 / noisy 0.80)가 1차 방어.
    // v0.4.4: barge-in 발화도 클립에 담기도록 클립은 announceField에서 announce TTS 이전에 시작됨.
    // v0.15.0 A6 — 스피커폰 모드 삭제. 모드로 게이트되던 값-경로 post-TTS 가드(종료 직후 잔향 폐기)와
    // 그 near-miss 계측을 제거했다. 이제 기본(이어폰) barge-in 동작만 남는다: TTS 재생 중(muted) 값이
    // 들어오면 폐기하지 않고 TTS를 끊고 그대로 처리한다. 잔여 에코 위험은 아래 신뢰도 게이트(0.65 /
    // noisy 0.80)가 1차 방어. (self-confirm 환각은 v0.13.0 alertText 재구성으로 이미 구조적 해소.)
    {
      const muted = ctrlRef.current?.isTtsMuted() ?? false;
      if (muted) {
        // 이어폰 barge-in: 재생 중 들어온 값을 폐기하지 않고 TTS를 끊고 그대로 처리.
        // §5-1 ②(v0.44.0) — "무엇을 들었는지"를 채운다. 08-02 실기기 stt_barge_in 167건 전부
        // text=''/confidence=0(브라우저가 빈 final을 확정)이라 §D2(종경 컬럼) 판정이 미결이었다.
        // 빈 final이면 **같은 발화의 마지막 interim**(handleFinal 하단 :1697에서야 소거되므로
        // 이 시점엔 아직 살아 있다)이 유일한 인식 증거다 — text·confidence를 그 값으로 폴백하고
        // 출처 마커(text_src=interim)를 남긴다. final 원문이 있으면 종전 그대로(마커 없음 —
        // 기존 이벤트 바이트 불변), interim조차 없으면 기존 폴백(''/0) 유지.
        const interim = lastInterimRef.current;
        const fromInterim = !text && !!interim?.text;
        logCell({
          type: 'stt_barge_in',
          text: fromInterim ? interim!.text : text,
          confidence: fromInterim ? interim!.confidence ?? 0 : confidence,
          row: awaiting.row,
          colId: awaiting.colId,
          ...(fromInterim ? { extra: bargeInTextSource('interim') } : {}),
        });
        cancelTts();
        epochRef.current++; // 진행 중인 advance/안내 체인 무효화
      }
    }

    // Log STT event
    lastConfidenceRef.current = confidence;
    // v0.9.0 EOS 계측: 마지막 interim → 이 final까지의 간격 = 브라우저 무음 종료감지 꼬리.
    // 앱 처리는 ~1ms이므로 사용자 체감 딜레이의 실제 병목. 조기확정 시엔 ≈0으로 찍힌다.
    const eosTailMs = lastInterimRef.current ? Math.max(0, Date.now() - lastInterimRef.current.at) : null;
    lastInterimRef.current = null;
    // A8 계측: final이 안정화 후보보다 먼저 도착해 조기확정이 무산된 케이스. 후보가 무장돼 있었을
    // 때만 기록(매 final 폭주 방지). early-commit 자체 경로면 이미 ref가 비어 있어 여기선 안 찍힌다.
    if (earlyCommitStableRef.current) {
      logCell({ type: 'stt_early_commit',
        row: awaiting.row, colId: awaiting.colId,
        extra: `attempt:reset:final_first:${earlyCommitStableRef.current.value}` });
      earlyCommitStableRef.current = null;
    }
    logCell({
      type: 'stt',
      row: awaiting.row,
      colId: awaiting.colId,
      colName: awaiting.name,
      text,
      confidence,
      alts,
      ...(eosTailMs != null ? { eosTailMs } : {}),
    });

    // v0.23.0 입력탭#4 — 마지막 행 종료 대기(atEnd): 명령(종료/수정/이동 등)은 위에서 이미 dispatch됐다.
    // 여기 도달한 것은 일반 값 발화이므로 새 행으로 커밋하지 않고 종료 안내만 재생한다(자동 종료 제거).
    if (awaiting.kind === 'atEnd') {
      useSessionStore.getState().setRecognized('');
      // 🔴 v0.51.1 B2(제보② 2026-09-02 15:50 · read-fb F3) — atEnd 흡수는 **「못 알아들었다」 신호를 먼저
      //   낸다.** 종전 Y6(v0.49 r6)은 「흡수 = 처리됨 → 큐 해제」였는데, atEnd에서 흡수되는 발화의 실체는
      //   **명령 오인식**이다: 양승보 r18에서 「수정」이 STT '회'(0.243)로 와 명령 미매치 → 여기서 무로그
      //   흡수 → 「마지막행 입력…」만 반복. 끝 도달 안내에는 조작 어휘가 없어(W2) 사용자는 「수정이 안
      //   먹는다」만 겪었다. 저신뢰 명령 거절(M11·Z5)과 **같은 종단 `rejectValue`**를 탄다 — 부정 비프 + 화면
      //   「소리가 불확실」(`armRejectCue`는 종단만 부른다: z5 단일 호출 계약) + 꼬리 = 끝 도달 안내(사유 TTS 없음 ·
      //   atEnd엔 소수 문맥이 없어 종단이 꼬리를 그대로 말한다 · 클립 재시작 없음) + 로그 1줄(`cell_wait_absorb`와
      //   같은 꼴). 즉 큐가 먼저, 끝 도달 안내가 뒤따른다(확인음→말 순서 계약).
      //   ⚠️ reviewWait·cellWait 흡수(아래)는 Y6 그대로다 — 그 두 국면은 값 발화 흡수가 정상이고 제보 형상도
      //   없다. 숫자 발화가 atEnd에서 흡수될 때도 같은 큐가 뜬다(빌드 산출물 §4 미결).
      logCell({
        type: 'command', parsed: 'end_absorb',
        extra: endAbsorb(awaiting.colId), text,
        row: awaiting.row, colId: awaiting.colId,
      });
      // 🔴 v0.49 r2 W2(확정표 #5+6) — 진입 안내와 **같은 문구**다. 종전엔 여기가 "입력이
      //   끝났습니다…", 진입이 "마지막 행까지 입력했습니다…"로 갈려 있어 같은 상태를 두 이름으로
      //   불렀다. 빈 행 목록은 **이 시점에 다시 센다** — 흡수 시점엔 값이 더 채워졌을 수 있다.
      const vcEnd = voiceColsList();
      await rejectValue('low_confidence', awaiting, {
        tail: buildEndReachedTts(listEmptyRows(computeTotalRows(getSessionColumns()), vcEnd)),
      });
      return true;
    }

    // v0.33.0 백로그 A(민구 결정 3) — 완료 행 검토 대기(reviewWait): 명령은 위에서 이미 dispatch됐다.
    // 여기 도달한 것은 일반 값 발화 — 완료 행을 bare 값으로 덮어쓰지 않고 안내만 한다(수정은
    // '수정' 명령으로만). atEnd 가드와 동일한 흡수 패턴.
    if (awaiting.kind === 'reviewWait') {
      useSessionStore.getState().setRecognized('');
      // 🔴 v0.49 r6 Y6(claude #5) — **흡수는 사건을 처리한 것이다 → 거절 큐를 내린다.** 착지의 큐 해제는
      //   `armLanding`이 소유하는데(Z5) 흡수는 착지가 아니라 그 깔때기를 안 탄다. 직전 거절의 큐가 남은 채
      //   흡수 안내만 귀로 나가면 화면·귀가 갈린다(§2 표면 모순). ⚠️ atEnd(위)는 v0.51.1 B2로 반대다.
      useSessionStore.getState().setReaskReason(null);
      // 🔴 v0.49 fix49b(max 리뷰 #8) — **어휘 재배정(F-1, 08-12) 미이관.** 「다음」이 항목 이동으로
      //   재배정되면서 이 안내가 가르치던 단어가 행을 넘기지 못하게 됐고, 행을 넘기는 말
      //   ('다음행')은 **어떤 안내에도** 등장하지 않아 음성 전용 사용자가 완료 행에 갇혔다
      //   (V-FIX4급 안내계약 위반). 그래서 문구가 '다음행'을 가르치도록 바뀌었다.
      // 🔴 v0.49 r2 A13(codex F6) — 종전 이 자리의 *"항목 이동은 이 상태(reviewWait)에서
      //   거부된다"* 는 서술은 **현행과 반대다**: W1(08-13 민구 결정)이 reviewWait·atEnd에서의
      //   항목 이동을 허용했다(`gotoAdjacentField`의 reviewScope 분기 — 그 오라클이 f1-field-nav ⑩).
      //   지금 이 상태가 거부하는 것은 **bare 값 발화**(아래 흡수)이지 이동이 아니다.
      await say(reviewWaitAbsorbTts(awaiting.row));
      return true;
    }

    // 🔴 v0.49 fix49(리뷰 B-1) — 셀 검토 대기(값 있는 셀에 항목 이동으로 착지): 명령은 위에서
    //   이미 dispatch됐다. 여기 도달한 것은 일반 값 발화이므로 **커밋하지 않는다.** 이 흡수가
    //   없으면 `setRowValue`가 확정·저장된 값을 무조건 덮는다(커밋 지점에 셀 단위 게이트 없음).
    //   문구는 행 검토("N행은 완료된 행입니다")와 **다르다** — 여기서 행을 말하면 사용자는
    //   행이 끝난 줄 안다. 정정 진입로('수정')를 한 마디로 가르친다(H-2 — 길이 압력).
    if (awaiting.kind === 'cellWait') {
      useSessionStore.getState().setRecognized('');
      useSessionStore.getState().setReaskReason(null); // Y6 — 위 atEnd 흡수와 같은 계약.
      logCell({
        type: 'command', parsed: 'cell_wait_absorb',
        extra: `cell_wait_absorb:${awaiting.colId}`, text,
        row: awaiting.row, colId: awaiting.colId,
      });
      // ⚠️ 문구는 `cellWaitPrompt`(#9 SSOT — voicePrompts.ts)를 쓴다. 이 흡수 안내가 그 문장의
      //   **의미상 원본**이지만, 여기 리터럴을 남겨 두면 「선언은 하나인데 사본이 있는」
      //   [PAST-2] 형태가 된다. ([ENV-12] E1 — 선언은 handleFinal 안에서 voicePrompts로 올랐다.)
      await say(cellWaitPrompt(awaiting.name));
      return true;
    }

    // Item 12: 컬럼명 완전 일치 STT 거부 — 숫자/날짜 컬럼에만 적용 (text/options 컬럼은 컬럼명이 유효한 값일 수 있음)
    const allColumns = getSessionColumns();
    const currentCol = allColumns.find((c) => c.id === awaiting.colId);
    if (currentCol && currentCol.type !== 'text' && currentCol.type !== 'options') {
      const colNames = allColumns.map((c) => c.name.trim());
      if (colNames.includes(text.trim())) {
        logCell({ type: 'stt_rejected_col_name', text, row: awaiting.row, colId: awaiting.colId });
        useSessionStore.getState().setRecognized('');
        // #6 — 거절 종단 단일화(비프 + §2 쌍 TTS). 종전엔 무비프 + W2 이전 인라인 리터럴이었다.
        // M3 — `awaiting`을 넘긴다: 소수 문맥이면 종단이 그 문맥의 문구·큐로 간다(그 헤더).
        await rejectValue('parse_failed', awaiting);
        return true;
      }
      const KNOWN_NOISE = /^(변경|성경|광경|구정|혜정|당장|경정)$/;
      if (KNOWN_NOISE.test(text.trim())) {
        logCell({ type: 'stt_rejected_col_name', text, row: awaiting.row, colId: awaiting.colId, extra: 'known_noise' });
        useSessionStore.getState().setRecognized('');
        // M3 — 클립 재시작 **요청**은 여기 남지만(전체 재발화 유도 분기), 소수 문맥에서는 종단이
        //   그 요청을 무시한다([CLIP-DECIMAL-FRAG-1]). 종전엔 여기서 무조건 재시작해 원본
        //   전체발화 버퍼를 폐기했다.
        await rejectValue('parse_failed', awaiting, { restartClip: true });
        return true;
      }
      // v0.34.0 O2 [STT-17] — 값 대기 중 단독 응답어("예/네/응/어" 등)는 수사로 커밋하지 않는다.
      //   07-14 실기기: "예"(conf 0.729)가 alt "네"→native 4로 커밋(알람 없는 컬럼이면 침묵 오염).
      //   파서 전역 차단은 불가("사"/"넷"은 유효) — 숫자 컬럼 값-대기 문맥에서만 재질문. trendConfirm
      //   중에도 동일 적용(응답어는 '확인' 명령이 아니다 — 팝업 유지, 정정값 4 오염 방지). 소수 재질문
      //   문맥(fractionWhole)에선 "네"가 .4로 합성되는 것을 막되, awaiting을 건드리지 않고 return해
      //   문맥·연속 클립을 보존한다([CLIP-DECIMAL-FRAG-1] — startClip 금지, 타깃 재질문 반복).
      if (isBareResponseWord(text)) {
        logCell({ type: 'stt_rejected_ambiguous_syllable', text, confidence, row: awaiting.row, colId: awaiting.colId, extra: 'response_word' });
        useSessionStore.getState().setRecognized('');
        // #6 — 표면(큐+비프)은 두 갈래 **앞에서** 한 번 무장한다. 소수부 타깃 재질문도 「값을
        //   안 받았다」는 점에서 같은 거절이고, 갈린 뒤에 배선하면 다음 갈래가 조용히 빠진다
        //   (파싱 실패 분기가 같은 이유로 이미 그렇게 한다).
        // M3 — 그 두 갈래가 이제 **종단 안**에 있다. 여기 인라인으로 두면 형제 분기가 같은 갈래를
        //   또 손으로 적어야 하고, 그게 이 결함의 형태였다(FB#4 문구 계약은 종단이 그대로 승계).
        await rejectValue('parse_failed', awaiting, { restartClip: true });
        return true;
      }
    }

    // v0.19.0 W4 — "소음 환경 모드"(noisyMode) 완전 제거(민구 결정). TTS가 인식값을 되읽어주므로
    // 오인식 판독에 문제가 없어 소음모드는 오히려 방해였다. noisyMode로만 발동하던 단일문자 거부
    // 분기도 함께 제거한다. (아래 lone-syllable homophone 가드는 noisyMode와 독립이므로 그대로 보존.)
    // v0.20.0 입력탭#1 — 값 게이트 신뢰도 임계를 하드코딩(0.65) 대신 사용자 조절 가능한
    // settingsStore.recognitionTolerance(기본 0.60, 범위 0.40~0.90)로 이전한다. 장갑 낀 손가락용
    // 가로 다이얼(Vance)이 이 값을 쓴다. **값 게이트만** 바꾼다 — 위 명령 게이트(commandMinConfidence,
    // 기본 0.7)와 lone-syllable 동음이의 가드, 아래 `confidence > 0` 미보고 센티넬은 그대로 둔다.
    // v0.26.0 F1 재변경(민구 최종 결정) — 다이얼은 "높을수록 엄격". 저장값(recognitionTolerance)은
    // 다이얼 위치이고, 실제 최소 신뢰도 변환은 minConfidenceForTolerance()가 단독 소유한다(이력 그쪽).
    const recognitionTolerance = useSettingsStore.getState().recognitionTolerance;
    const minConfidence = minConfidenceForTolerance(recognitionTolerance);

    // T-3 (single-syllable homophone, "이"→2): on a MEASUREMENT column (int/float) a lone
    // Sino-Korean syllable that doubles as a common non-number word ("이","사","오","일"…) was
    // committed at HIGH confidence with no challenge — but a bare single digit is essentially
    // never a real mm/Brix reading, so it is far more likely a particle/filler misheard as a
    // number. The existing single-char reject above only fires in noisyMode; this re-confirms
    // the lone-syllable homophone case REGARDLESS of noisyMode. Scope is deliberately narrow —
    // single alt, exactly one SINO syllable — so genuine numerals ("이백삼십삼") and arabic
    // single digits ("2") are untouched. Reuses the null→re-ask contract (no commit).
    // v0.10.0 A1: 소수점 타깃 재질문 중(awaiting.fractionWhole)에는 이 게이트를 건너뛴다 — 사용자가
    // "소수점 아래만" 명시적으로 한 자리(예: "오"=5)를 말하는 상황이라 단일 음절이 모호하지 않다.
    // (정수부 컨텍스트가 이미 있어, 아래 fractionWhole 분기가 `111.5`로 합성한다.)
    if (currentCol && (currentCol.type === 'int' || currentCol.type === 'float') && fractionWholeOf(awaiting) == null) {
      if (alts.length <= 1 && isAmbiguousSingleSyllable(text)) {
        logCell({ type: 'stt_rejected_ambiguous_syllable', text, confidence, row: awaiting.row, colId: awaiting.colId });
        useSessionStore.getState().setRecognized('');
        // M3 — 이 분기의 가드(`fractionWholeOf(awaiting) == null`)가 소수 문맥을 이미 배제하므로
        //   종단의 문맥 판정은 여기서 no-op이다. 그래도 **같은 종단**을 쓴다(형태 통일 —
        //   가드가 언젠가 완화되면 조용히 새는 것이 정확히 이 결함의 형태였다).
        await rejectValue('parse_failed', awaiting, { restartClip: true });
        return true;
      }
    }

    // Plain value — with alts fallback on parse failure (item 11)
    const col = getColById(awaiting.colId);
    const fractionWhole = fractionWholeOf(awaiting);
    // [ENV-12] v0.43.0 #3 — 파싱 판정은 valueParseAttempt(순수)가 소유한다. 여기서는 호출하고
    //   부수효과(문맥 해제·로그 방출)만 적용한다. 판정 순서·alt 스킵 규칙은 그 모듈의 계약이다.
    //
    // 🔴 **v0.43.0 #3 — 신뢰도 게이트보다 파싱이 먼저다.** (민구 확정, plan §2-5)
    //   종전에는 저신뢰 거절이 파서보다 **앞에** 있어, `300`(conf 0.097)처럼 완벽히 파싱되는
    //   숫자가 **파싱 시도조차 없이** 버려졌다. 07-30 실기기에서 6건이 그렇게 죽었고 재질문이
    //   21초를 태웠다. 다이얼로는 못 푼다 — `190`(conf 0.021)을 통과시키려면 임계를 2%까지
    //   내려야 하고, 그건 게이트를 없애는 것과 같다.
    //   🔑 **판별자는 신뢰도가 아니라 "파싱되는가"다.** 같은 로그가 양방향으로 보여줬다:
    //   고신뢰인데 쓰레기(`담백` 0.887 · `담배` 0.715), 저신뢰인데 정확(`300` 0.097 · `190` 0.021).
    //   BT 마이크 환경에서 Web Speech의 confidence는 **신호 품질**을 재지 텍스트의 옳음을 재지 않는다.
    //   → 파싱되면 신뢰도와 무관하게 커밋한다. **확인 단계는 넣지 않는다** — 에코 TTS(:800 계열)가
    //   이미 매 커밋마다 값을 읽어주므로 귀로 듣는 확인이 이미 있다(민구: "확인 질문은 중복").
    //   파싱 실패 시에만 기존 저신뢰 게이트가 그대로 돈다(게이트를 없앤 것이 아니다).
    const attempt = attemptParseValue({ col, text, alts, fractionWhole: fractionWhole ?? null });
    const lowConfidence = confidence > 0 && confidence < minConfidence;

    // Low confidence — re-ask. **파싱에 실패했을 때만** 여기로 온다(#3 이후).
    if (attempt.parsed === null && lowConfidence) {
      // v0.23.0 입력탭#2 — 저신뢰 재질문을 명시 이벤트로 로깅(이전엔 무로깅). confidence + 다이얼 값 +
      // 실제 게이트를 함께 박제해 차기 분석이 "설정값 vs 실제 신뢰도"를 정량 대조하게 한다(갭 해소).
      // v0.25.0 F1 — 다이얼 값(tolerance)과 반전된 실제 임계(minConf)를 둘 다 싣는다. 반전 이후엔
      // `confidence < minConf` 불변식이 이벤트 자체로 읽혀야 하고(예 conf 0.65 < minConf 0.70), 다이얼
      // 값만 두면 "0.65인데 tolerance 0.60에서 거부"처럼 모순으로 보인다(Trace가 반전식을 몰라도 명료).
      // v0.43.0 #3 — 이 이벤트의 **의미가 좁아졌다**: 종전 "저신뢰라 버림" → 현재 "저신뢰이고
      //   파싱도 안 돼서 버림". 거절률 분모로 쓸 때 그 차이를 알고 써야 한다.
      logCell({
        type: 'stt_rejected_low_confidence', text, confidence,
        row: awaiting.row, colId: awaiting.colId,
        colName: awaiting.name, extra: `tolerance:${recognitionTolerance},minConf:${minConfidence}`,
      });
      useSessionStore.getState().setRecognized('');
      // 🔴 v0.49 r4 M3 — 클립 재시작이 **종단으로 옮겨졌다**(요청만 넘긴다). 여기가 리뷰가
      //   지목하지 않은 세 번째 구멍이었다: 소수부 타깃 재질문 중 저신뢰 파싱 실패도 이 분기로
      //   오는데, 무조건 재시작이 [CLIP-DECIMAL-FRAG-1]을 어기고 소수 큐까지 지웠다(그 헤더).
      // 🔴 v0.49 r2 B2(민구 결정 08-13 ⓐ) — **거절 비프.** 아래 주석이 "부정 비프가 전담한다"고
      //   적어 온 그 비프다(합집합 C2: 배선된 적이 없어 전제가 허구였다). TTS **이전에** 낸다 —
      //   커밋 확인음이 세운 「신호음 → 말」 순서 계약과 같다(민구 지정 순서).
      // v0.48.0 P3(NEW-2, 민구 제보 08-10) — 재질문 사유를 TTS로 읽는다(종전엔 화면만 알았다).
      // 🔴 v0.49 r2 W2(확정표 #1) — **사유만 말한다.** 꼬리("잘 못 들었습니다. {항목} 다시 말씀해
      //   주세요.")는 삭제됐다: 사용자는 이미 그 셀에 답하는 중이고, 재시도 신호는 화면 큐
      //   (`ReaskCue`, 상세본 유지)와 부정 비프가 전담한다.
      // 🔴 v0.49 r3 #6 — 큐·비프·TTS 세 신호를 `rejectValue` 한 곳으로 모았다(형제 4분기가
      //   그 셋 중 둘을 빠뜨린 채 살아 있던 것이 결함이다 — 그 헤더 참조).
      await rejectValue('low_confidence', awaiting, { restartClip: true });
      return true;
    }

    // 🔴 계측(plan §2-5-b 4번) — **저신뢰인데 파싱돼서 통과한 건.** 다음 회차에 이 판단이
    //   옳았는지 가릴 유일한 모수다. 신규 이벤트 타입 없이 아래 `value` 커밋 이벤트에 싣는다.
    const lowConfParsedExtra = attempt.parsed !== null && lowConfidence
      ? lowConfidenceParsed({
        conf: confidence,
        minConf: minConfidence,
        tolerance: recognitionTolerance,
        via: attempt.events.some((e) => e.kind === 'alt_used')
          ? 'alt'
          : attempt.events.some((e) => e.kind === 'decimal_fraction_recovered') ? 'frac' : 'primary',
      })
      : null;
    let parsed = attempt.parsed;
    const parseFailReason = attempt.failReason;
    const parseFailWhole = attempt.failWhole;
    if (fractionWhole != null) {
      // 여기 도달 시 kind는 value|modify|trendConfirm — 위 가드가 atEnd/reviewWait를 return(내로잉 증명).
      // 소수부 문맥은 **한 번만** 적용하고 즉시 해제한다(합성 실패 시 아래 실패 분기가 다시 세운다).
      awaitingFieldRef.current = { ...awaiting, fractionWhole: undefined };
    }
    for (const ev of attempt.events) {
      if (ev.kind === 'decimal_fraction_recovered') {
        logCell({ type: 'stt', extra: 'decimal_fraction_recovered', text: ev.text, originalText: ev.originalText, row: awaiting.row, colId: awaiting.colId });
      } else {
        logCell({ type: 'stt_alt_used', altIdx: ev.altIdx, text: ev.text, originalText: ev.originalText, row: awaiting.row, colId: awaiting.colId, ...(ev.extra ? { extra: ev.extra } : {}) });
      }
    }
    if (parsed === null) {
      // v0.20.0 Phase 5 #2 — parse_failed 보강: 원본 transcript(text)는 이미 동봉. 여기에 항목명
      // (colName)과 직전 컨텍스트(소수부 재질문 중이면 정수부 fractionWhole)를 더해 "주로 실패하는
      // 숫자/항목"을 다음 세션부터 정량화한다. (런타임에 '기대값'은 알 수 없어 추가하지 않는다 —
      // 실세션은 정답이 없는 자유 측정이므로 transcript+context로 패턴을 집계하는 것이 정직하다.)
      // v0.43.0 #3-2 — `extra`(사유)는 이제 **항상 실린다.** 종전엔 파서의 3개 경로에서만
      // 나왔고 07-30 실기기 22건 중 14건이 공백이었다(plan §2-6). 사유가 비어 보이면 그건
      // 새 실패 경로가 사유 없이 추가된 것이다 — koreanNum의 `fail()` 규약을 확인해라.
      logCell({
        type: 'stt_parse_failed', text, altsCount: alts.length,
        extra: parseFailReason ?? undefined,
        row: awaiting.row, colId: awaiting.colId,
        colName: awaiting.name,
        ...(fractionWhole != null ? { originalText: `frac_ctx:${fractionWhole}` } : {}),
      });
      // 🔴 v0.49 r2 W4 — **섀도 계측**(민구 재결정 08-13, `_ASK-voice.md` BLOCKING #1 → ⓐ).
      //   거절·재질문은 **현행 그대로**이고, 「자동 채택했더라면 무엇이었을지」만 남긴다. 다음
      //   회차가 이 값과 **재발화 후 실제 커밋값**을 대조해 오채택률을 시트 위험 0으로 잰다
      //   (08-13 실측으로는 4/4 오답 — `koreanNum.ts`의 `getLastSalvageCandidate` 주석에 대조표).
      //   🔴 별도 라인으로 남기는 이유: 위 `stt_parse_failed`의 `extra`는 사유 **단독**이 바이트
      //   계약이다(PRINCIPLES §4 — 꼬리 확장은 이벤트별 개별 승인). 꼬리를 붙이면 사유를
      //   정확일치로 세는 기존 집계가 조용히 갈린다. 신규 type도 만들지 않는다(log-replay 호환)
      //   — `enterReviewWait`이 `command`를 재사용한 것과 같은 판단이다.
      //   🔴 v0.49 r2 A4(합집합 C10) — **소수부 재질문 문맥에서는 남기지 않는다.** 그 문맥의
      //   발화는 조각("구")이고 `salvageCandidate`도 그 조각에서 나온다. 이 계측의 판정 방법은
      //   *"이 후보를 재발화 후 실제 커밋값과 대조해 오채택률을 잰다"* 인데, 조각 후보를 전체값
      //   커밋과 대조하면 **비교 자체가 성립하지 않는다**(정수부 111 + 조각 후보 9 vs 커밋 111.9).
      //   다음 회차 모수가 조용히 오염되므로 억제한다. 합성값(정수부+조각)을 대신 기록하는 쪽은
      //   택하지 않았다 — 그건 「자동 채택했더라면」이 아니라 **소수부 합성이 성공했을 값**이라
      //   같은 컬럼에 다른 의미의 수를 섞는다(합집합 처방도 「억제가 단순」).
      if (attempt.salvageCandidate != null && fractionWhole == null) {
        logCell({
          type: 'stt', extra: wouldSalvage(attempt.salvageCandidate), text,
          row: awaiting.row, colId: awaiting.colId, colName: awaiting.name,
        });
      }
      // v0.23.0 입력탭#2 — 파싱 실패도 재질문 사유로 표면화(높은 신뢰도인데 재질문되는 혼동 해소).
      // 🔴 v0.49 r2 B2 — 거절 표면(화면 큐 + 비프). **아래 3분기가 갈리기 전에** 한 번 무장한다:
      //   소수부 타깃 재질문도 「값을 안 받았다」는 점에서 같은 거절이고, 분기마다 배선하면 다음
      //   분기가 추가될 때 조용히 빠진다(이 파일이 반복해 겪은 드리프트).
      //   🔴 v0.49 r3 #6 — 그 경고가 이 분기 **안에만** 적혀 있어서 형제 4분기가 통째로 빠져
      //   있었다. 표면 무장을 `armRejectCue`로 뽑아 여섯 분기가 같은 종단을 쓰게 했다.
      // 🔴 v0.49 r5 Z5(codex R4-F3 둘째 축) — 표면 무장(`armRejectCue`)이 여기 홀로 서 있고 아래
      //   세 분기가 소수 문맥을 **각자** 처리했다. 「모든 값 거절을 `rejectValue` 한 곳에서
      //   종결」이 그래서 아직 성립하지 않았다. 이제 세 분기 전부 그 종단을 부른다 —
      //   `armRejectCue`·`setDecimalReason`·`say`·클립 재시작이 전부 종단 소유다.
      //   ⚠️ 분기가 여전히 남는 이유는 **소수 문맥의 출처가 다르기 때문**이다(새로 여는 것 /
      //     유지하는 것 / 없는 것). 그 판정과 `awaiting` 변이·클립 계측은 여기 고유 계약이고,
      //     화면·TTS·비프는 종단이 낸다. 각 분기가 종단에 넘기는 것은 그 차이뿐이다.
      // v0.10.0 A1: 소수 의도인데 소수부 유실("111 점 에") → 정수부를 유지하고 "소수점 아래만" 타깃
      // 재질문(전체 재발화 회피). 값 추측(에→1)은 하지 않는다 — 같은 STT 문자열이 111.1·111.5
      // 양쪽에서 나와 조용한 오커밋이 되기 때문(민구 결정).
      if (parseFailReason === 'decimal_fraction_lost' && parseFailWhole != null) {
        // [CLIP-DECIMAL-FRAG-1] v0.16.0 — 소수 재질문은 부분(조각) 발화("구")만 유도하므로, 다른
        // 재질문(multi_numeric·extraneous_token 등 전체 재발화 유도)과 달리 클립을 재시작하면 직전의
        // 원본 전체발화("이십구 점 부") 버퍼가 폐기돼 커밋 클립에 조각만 남는다(시트값은 정상·클립
        // audit만 유실). 그래서 이 분기에서만 startClip()을 생략한다 — 활성 슬롯이 재질문 TTS·조각
        // 발화를 거쳐 계속 녹음하다가 commit 지점 stopClip()에서 단일 연속 녹음으로 stop된다.
        // v0.21.0 CLIP-MIDSPEECH-1 — audioTrim.buildKeptRanges가 원본·조각을 포함한 모든 발화를
        // 감싸는 단일 포괄 범위로 트림하므로(중간 무음 보존, splice 없음), 저장 클립이 원본+조각을
        // 사이 무음째 그대로 담아 전체값으로 재생/전사된다(사람 청취 보존). 별도 cross-restart webm
        // concat이 없어 iOS decodeAudioData(webm/opus) 위험(CLIP-2 ⚠️주시)을 구조적으로 피한다.
        // `:raw`도 재시작이 없어 1회만 보존됨.
        logCell({ type: 'clip', extra: 'clip_decimal_kept', row: awaiting.row, colId: awaiting.colId });
        awaitingFieldRef.current = { ...awaiting, fractionWhole: parseFailWhole };
        // FB#4 — 화면 큐와 TTS의 글자 일치(정수부를 store에 싣는다)는 종단이 한다. 이 분기는
        //   문맥을 **새로 여는** 쪽이라 `awaiting`엔 아직 없다 — 그래서 `whole`로 넘긴다.
        await rejectValue('parse_failed', awaiting, { whole: String(parseFailWhole) });
      } else if (fractionWhole != null) {
        // v0.33.0 [STT-15] 재질문 유지 — 소수부 재질문 응답이 소수부(합성)로도 전체값(primary)로도
        // 해석되지 않으면 문맥(fractionWhole)을 버리지 않고 같은 타깃 재질문을 반복한다. 이전엔
        // 문맥이 원샷 해제돼 다음 발화가 전체값으로 처리됐다(조각 "1"이 값으로 설 위험).
        // 클립도 decimal_fraction_lost 분기와 동일하게 재시작하지 않는다(원본+조각 연속 보존).
        logCell({ type: 'clip', extra: 'clip_decimal_kept', row: awaiting.row, colId: awaiting.colId });
        awaitingFieldRef.current = { ...awaiting };
        // 기존 문맥 유지 — 종단이 `awaiting.fractionWhole`을 읽어 같은 꼬리로 수렴한다.
        await rejectValue('parse_failed', awaiting);
      } else {
        // 전체 재발화 유도 분기 — 새 클립이 옳다(종단의 `restartClip`).
        // v0.48.0 P3(NEW-2, 민구 제보 08-10) — 사유를 TTS로 읽는다.
        // 🔴 v0.49 r2 W2(확정표 #2) — **사유만 말한다.** 종전 꼬리("{항목} 다시 말씀해 주세요.")는
        //   삭제됐다(#1과 같은 근거). 이 꼬리를 부분일치로 검증하던
        //   `decimal-targeted-reask.spec.ts`의 [alt 의미보존] 케이스는 같은 커밋에서 갱신했다.
        await rejectValue('parse_failed', awaiting, { restartClip: true });
      }
      return true;
    }

    // 값으로 설 자격을 통과했다 = 본체의 커밋 경로로 폴스루. 산출물을 ctx에 싣는다
    // (블록 F~H가 종전 지역변수 이름으로 되받는다 — 본체의 되받기 주석 참조).
    ctx.col = col;
    ctx.parsed = parsed;
    ctx.lowConfParsedExtra = lowConfParsedExtra;
    // 🔴 [ENV-12] E5 정리 — `ctx.fractionWhole`은 여기서 뺐다. E2가 「F~H 소비 0」을 실측하고도
    //   *"E3/E4가 읽게 될 수 있다"*는 근거로 실었는데, 두 회차 다 읽지 않았다(E4는 인자 경로).
    //   소수 문맥은 이 구획 **안에서만** 산다 — 지역 `fractionWhole`과 `awaitingFieldRef`가 소유한다.
    return false;
  }, []);

  return { runValueGate };
}
