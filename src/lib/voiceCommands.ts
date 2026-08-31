/**
 * Voice command registry — the SINGLE SOURCE OF TRUTH for voice commands (I-1).
 *
 * Design (민구 결정: "완전 통일 — 단일 수용"): each function maps to exactly ONE accepted word.
 * Earlier the parser accepted several aliases per function (수정/정정, 스킵/건너/패스/다음, …); they
 * are removed so the app teaches — and the user learns — one word per action. detectCommand()
 * (koreanNum.ts), the on-screen hint chips, the help popup, and TTS prompts all read from here, so
 * the accepted word and the taught word can never drift apart.
 *
 * Robustness note: dropping aliases trades recognition breadth for teachability. Each canonical
 * `word` was chosen to be a distinct, STT-reliable token, and the help popup + TTS reinforce it.
 * `stt_command_miss` telemetry (handleFinal) records near-misses so the field data — not guesswork
 * — tells us whether any word needs a fallback later.
 *
 * IMPORTANT for matching (🔴 v0.49 F-1에서 **불변식이 교체됐다**): detectCommand(koreanNum.ts)는
 * startsWith로 맞추되 **가장 긴 word가 이긴다**(longest-match-wins).
 *   - 종전 불변식: *"어떤 word도 다른 word의 접두일 수 없다"* — '이전'(prevRow)·'다음'(nextRow)이
 *     서로 접두가 아니라서 성립했다.
 *   - **08-12 민구 결정이 그 불변식을 대체한다.** 「이전」/「다음」을 항목 이동에, 「이전행」/
 *     「다음행」을 행 이동에 배정하면서 `'이전'⊂'이전행'`·`'다음'⊂'다음행'` 접두 쌍이
 *     **의도적으로** 생겼다. 접두 관계는 이제 금지가 아니라 **최장 일치로 해소**된다.
 *   - 현재 접두 쌍은 **정확히 2개**(위 둘)뿐이다.
 *     (v0.51에서 '인식률…'·'안내속도…' 4개가 제거되면서 «앞부분만 공유하던» 예시도 사라졌다 —
 *      계수는 그대로 2개다. 오라클: `voiceFinalResolver.spec.ts`가 이 2개를 정확히 단언한다.)
 *
 * ⚠️ **정확 일치(exact match)로 바꾸지 마라** — 두 계약이 죽는다: ① `screenOff`의 word는 일부러
 *   짧은 '화면'이고 그래야 "화면 꺼"가 잡힌다(:117-120의 근거 주석), ② "수정해줘" 같은 활용형
 *   꼬리 허용(koreanNum.ts detectCommand 주석)이 사라진다.
 *
 * 새 word를 넣을 때: 접두 관계 자체는 허용되지만 **긴 쪽이 먼저 잡히길 원하는 게 맞는지**
 * 반드시 확인하라. (사용자가 「다음 행」처럼 띄어 말해도 detectCommand가 공백을 먼저 지우므로
 * '다음행'으로 정규화돼 동일하게 잡힌다.)
 */

export type VoiceCommand =
  | 'modify'
  | 'cancel'
  | 'prevField'
  | 'nextField'
  | 'prevRow'
  | 'nextRow'
  | 'keep'
  | 'pause'
  | 'resume'
  | 'end'
  | 'confirm'
  | 'help'
  // 🔴 v0.51 (민구 확정 2026-08-31) — `toggleInputControls`·`recognitionDown`·`recognitionUp`·
  //   `guidanceSlower`·`guidanceFaster` **5개를 여기서 지웠다.** 결정 계보를 남긴다:
  //   · v0.38.0 #4-③에서 «화면 버튼과 같은 동작을 음성으로도» 라며 6개를 넣었다(도움말 포함).
  //   · 08-31 민구 확정: ***"조절판은 손으로만."*** 원문 판정은 **「아예 없앤다」** 였다.
  //   · 왜: ㉠ **순환이 있다** — 이 명령이 필요한 순간은 「인식이 안 되는 순간」인데 명령 자체가
  //     신뢰도 0.7을 넘어야 실행된다. ㉡ 6~7음절로 18개 중 **최장**이라 그 문턱이 가장 높다.
  //     ㉢ 결과(%)는 조절판을 봐야 알고, 조절판이 닫혀 있으면 **바뀐 줄도 모른다.**
  //   🔴 **기능을 없앤 것이 아니라 「음성으로 부르는 경로」만 없앴다** — 스텝퍼·토글·요약 필은
  //   그대로 산다(`ActiveControlSteppers`). 이 구분이 흐려지면 다음 회차가 기능을 되살리려 든다.
  //   ⚠️ 도움말 팝업이 이 배열을 **전량 동적 렌더**하므로 여기서 빠지면 화면에서도 사라진다 —
  //   그리고 「손으로만 되는 것」 묶음(`HAND_ONLY_FEATURES`)에 그 자리가 마련돼 있다.
  | 'screenOff'
  | null;

/** 화면 표시만 바꾸는 명령들 — 값·행·세션 상태를 건드리지 않는다(도움말 열기, 조절판 토글,
 *  인식률/안내속도 조절). 같은 동작의 화면 버튼과 **완전히 동등**해야 한다.
 *
 *  v0.38.0 리뷰#1 — 이 목록이 타입으로만 존재해 런타임 판정이 불가능했고, 결국 dispatch switch에
 *  같은 6종이 **복붙**돼 있었다. 복붙된 판단이 이번 회차 결함들의 뿌리였으므로([PAST-2]) 배열을
 *  SSOT로 두고 타입을 여기서 파생시킨다 — 명령이 늘거나 줄면 이 배열 한 곳만 고친다. */
export const VOICE_UI_COMMAND_IDS = [
  'help',
  // v0.46.0 WP-F — 검은 화면 모드 진입. 값·행·세션을 건드리지 않고 표시만 바꾸므로
  //   UI 명령이 맞다(해제는 화면 길게 누르기 — BlackoutOverlay).
  'screenOff',
  // 🔴 v0.51 — 조절판 5종이 여기서도 빠졌다(위 유니온 주석이 근거 SSOT). 이 배열이 6→2가 되면서
  //   `ActiveControlSteppers`의 uiCommand 디스패치가 **통째로 죽었고**, 그래서 제거했다.
  //   🟢 이 배열의 **역할은 그대로다** — 「값·행·세션을 안 건드리는가」의 판정이고
  //   `voiceFinalResolver`의 이상치 분기가 그걸 읽는다(축소가 그 계약을 약화시키지 않는다).
] as const;

export type VoiceUiCommand = (typeof VOICE_UI_COMMAND_IDS)[number];

/** 이 명령이 화면 표시만 바꾸는가(= 값·이상치 판정에 관여하지 않는가). */
export function isVoiceUiCommand(cmd: VoiceCommand): cmd is VoiceUiCommand {
  return cmd != null && (VOICE_UI_COMMAND_IDS as readonly string[]).includes(cmd);
}

export interface VoiceUiCommandSignal {
  id: VoiceUiCommand;
  seq: number;
}

export interface CommandSpec {
  id: Exclude<VoiceCommand, null>;
  /** The one accepted spoken word for this command. */
  word: string;
  /** Label shown in the help popup / hint chips (same as `word` today, kept separate for i18n). */
  display: string;
  /** One-line explanation shown in the help popup. */
  desc: string;
  /** Shown in the compact inline hint row (the full set lives in the help popup). */
  primary?: boolean;
  /**
   * Per-command STT confidence floor (handleFinal). Defaults to 0.7 when omitted — commands
   * rewind/destroy state, so they clear a higher bar than the value gate (0.65).
   * T-12: '수정'(modify) is the exception — it is recoverable (clip preserved, [CLIP-MODIFY-1],
   * formerly [CLIP-1] before the 2026-07-26 ID uniquification) and the
   * ~10s replay cost that justified the strict bar is already gone (re-ask is short), so a
   * false-reject costs ≈0 while a false-accept is recoverable. Real-device logs showed deliberate
   * '수정' utterances rejected at 0.587/0.634 (just under the bar); 0.55 admits those while staying
   * a comfortable margin above the noise cluster (max 0.313).
   */
  minConfidence?: number;
  /**
   * 🔴 v0.49 fix49b(max 리뷰 #15) — **미확인 이상치 알림을 소모하지 않는다.**
   *
   * `voiceFinalResolver`의 trendConfirm 분기는 「나머지」 명령을 `trendDemoted:true`로 넘기고,
   * 호출부는 그걸 받아 dispatch **이전에** `clearAnomalyAlert('trend_dismissed')`로 팝업을 닫는다.
   * 즉 이 플래그가 없는 명령은 **핸들러가 거부하든 말든 알람이 이미 사라진 뒤**다 —
   * fix49 M-1이 고친 것이 정확히 그 형태였다(「다음」 한 마디로 미확인 이상치가 소멸).
   *
   * 그 판정을 resolver 내부의 id 리터럴로 두면 **선언과 계약이 떨어진다**: 다음에 비소모 명령을
   * 추가하거나 id를 바꾸는 사람이 resolver를 함께 고쳐야 한다는 걸 알 방법이 없고, 잊으면
   * M-1이 조용히 되살아난다(팝업은 닫히는데 오라클은 green인 형태). 선언부에 붙여 둔다.
   *
   * `VOICE_UI_COMMAND_IDS`와는 **다른 축**이다 — 그쪽은 "값·행·세션을 아예 건드리지 않는다",
   * 이쪽은 "건드리지만 그 전에 사용자에게 알람부터 답하게 한다".
   * ⚠️ 이 플래그만으로는 아무것도 막지 못한다. 실제 거부와 안내는 핸들러의 국면 가드
   * (`gotoAdjacentField`)가 한다 — 한쪽만 있으면 무의미하다는 것이 [PHASE-NAV-1]의 요지다.
   */
  preservesAlert?: boolean;
  /**
   * 🔴 v0.51 P2-2 (민구 요청 08-31) — **같은 동작을 손으로 하는 방법.**
   *
   * 민구 원문의 문제: *"말로 되는 건지 손으로 해야 하는 건지 화면만 봐서는 모른다."*
   * 이 필드가 **도움말 묶음의 SSOT**다 — `CommandHelpPopup`은 값의 유무로만 가른다:
   *   값이 **없으면** 「🎙 말로만 되는 것」 · **있으면** 「🎙👆 말·손 둘 다 되는 것」.
   * 👉 분기를 화면 쪽에 두면 명령이 늘 때 두 곳을 고쳐야 하고, 그게 [PAST-2](복붙된 판단)다.
   *
   * ⚠️ **짧게 쓴다(기호 1~2글자가 기본).** 402px 기기의 팝업 가용폭은 실측 ≈350px이고
   * (pill 78 + gap 12 + 설명), 이 값은 설명 뒤에 **인라인으로 흐른다.** 길어지면 설명이
   * 한 줄씩 더 감겨 목록 세로가 그만큼 늘어난다 — v0.26.0의 «잘림» 제보가 정확히 그 기전이었다.
   * 🔴 **4번째 열로 만들지 마라.** 60px 열을 떼면 설명 폭이 그만큼 줄어 같은 결과가 된다.
   */
  touch?: string;
  /** 표에 붙는 ⚠ 한 줄 단서 — **음성이 「반쪽」인 명령**의 한계를 그 자리에서 알린다.
   *  (예: '종료'는 음성이 확인 화면까지만 띄우고 확정은 ✓ 버튼이다.) */
  touchNote?: string;
}

/** 🔴 v0.51 P2-2 — **명령이 아닌, 손으로만 되는 기능들.** 도움말 표의 세 번째 묶음.
 *
 *  ## 왜 이 배열이 필요한가
 *  조사(§2-3 B)가 **도움말에 없는 버튼 전용 기능 9건**을 찾아냈다. 사용자는 그것들이 존재하는지
 *  화면에서 알 방법이 없었다 — *"가르치지 않는데 동작하는"* 쪽의 불일치다.
 *  🔑 여기에 **v0.51에서 음성 경로를 없앤 조절판 3종이 합류한다**(인식률 ± · 안내속도 ± ·
 *  조절판 열기/닫기). 민구가 *"조절판은 손으로만"* 을 고르면서 원한 것이 정확히 이 자리다 —
 *  기능이 사라진 게 아니라 **「손으로만」이라고 화면에 적히는 것**.
 *
 *  ⚠️ `VOICE_COMMANDS`와 **다른 배열인 것이 의도**다. 저쪽은 «파서가 받는 말»의 SSOT이고
 *  (도움말·힌트칩·`detectCommand`가 전부 읽는다), 이쪽은 **화면 안내 전용**이다.
 *  🔴 여기에 항목을 넣는다고 그 말이 인식되지는 않는다 — 섞으면 «가르치는데 안 먹는» 쪽의
 *  불일치를 이 표가 스스로 만들게 된다. */
export interface HandOnlyFeature {
  /** 기능 이름(굵게). */
  label: string;
  /** 어디를 어떻게 누르는가 — 한 줄. */
  how: string;
}

export const HAND_ONLY_FEATURES: HandOnlyFeature[] = [
  // ── v0.51에서 음성 경로가 제거된 3종(민구 확정 08-31) ──
  { label: '허용 인식률 ±', how: '조절판 − +' },
  { label: '안내속도 ±', how: '조절판 − +' },
  { label: '조절판 열기/닫기', how: '요약 필을 탭' },
  // ── 원래부터 버튼 전용이던 것들(조사 §2-3 (B) — 종전 도움말에 없었다) ──
  { label: '칩 왕복 속도', how: '조절판 스텝퍼 0~10' },
  { label: '말끊기 켜기/끄기', how: '조절판 토글' },
  { label: '값 직접 입력', how: '칩을 탭 → 숫자판' },
  { label: '종료 확정 / 취소', how: '종료를 누른 뒤 ✓ / ✕' },
  // 🔴 민구 확정(08-31 Q4) — **화면 켜기 음성 명령은 만들지 않는다.** 「손으로만」이라고 적는다.
  //   ⚠️ 이 줄을 지우지 마라: 이 기능의 유일한 실패 모드가 *"켜지지 않는 화면에 갇혔다"* 이고,
  //   V-FIX4가 「해제 안내는 계약이다」를 선언한 것이 그 이유다(`screenOff`의 desc 주석).
  //   문구는 `BlackoutOverlay`의 `WAKE_LINES`와 **같은 표현**(「가운데를 2초 누르면」)을 쓴다.
  { label: '화면 켜기', how: '검은 화면 가운데를 2초 누르기' },
];

/** 이 명령이 미확인 이상치 알림을 소모하지 않는가(= 알람을 띄운 채 통과시켜야 하는가). */
export function preservesAnomalyAlert(cmd: VoiceCommand): boolean {
  return cmd != null && (VOICE_COMMANDS.find((c) => c.id === cmd)?.preservesAlert ?? false);
}

export const VOICE_COMMANDS: CommandSpec[] = [
  { id: 'modify',  word: '수정',     display: '수정',     desc: '직전에 입력한 값을 고칩니다',      primary: true, minConfidence: 0.55 },
  // 🔴 v0.49 F-1 (민구 결정 2026-08-12) — **어휘 재배정**. 결정 계보를 지우지 말 것:
  //   · v0.33.0 백로그 A(민구 결정 1·3): '이전'=prevRow / '다음'=nextRow, 즉 **둘 다 행 이동**이었다.
  //     ('이전'은 버튼과 동일한 단순 행 이동 — v0.4.5 I3의 재입력 모드는 그때 폐지됐다.)
  //   · **08-12에 대체됨**: 민구 원문 *"「이전」, 「다음」은 사용자가 입력 대상 항목들을 하나씩
  //     이동하고, 「이전행」, 「다음행」은 아예 입력행 자체를 이동했으면 좋겠어."*
  //     → 짧은 말(2음절)이 잦은 동작(항목)에, 긴 말이 드문 동작(행)에 간다.
  //   · 행 이동 **로직 자체는 이전됐을 뿐 바뀌지 않았다** — 완료 행 착지 시 값을 읽어주고
  //     명령 대기하는 v0.33.0 결정 3의 계약은 '이전행'이 그대로 승계한다.
  //   ⚠️ desc는 **'유지'(keep)와 구별되게** 쓴다. 둘 다 "값을 안 건드리고 옆으로"처럼 들리지만
  //     실제 동작이 다르다: '유지'는 **값이 있어야** 동작하고(없으면 거부) `advance()`를 타
  //     채워진 칸을 건너뛴다(:1922-1936). 항목 이동은 값 유무와 무관하게 **인접 한 칸**만 간다.
  //     도움말에서 두 줄이 같은 말로 읽히면 민구 요구 ④(바뀐 기능을 가르치기)가 실패한다.
  //   ⚠️ `preservesAlert`는 M-1 계약이다(속성 선언부 주석 참조) — 지우면 「다음」 한 마디로
  //     미확인 이상치가 소멸하던 결함이 되살아난다. 짝은 `gotoAdjacentField`의 국면 가드다.
  { id: 'prevField', word: '이전',   display: '이전',     desc: '값 입력 없이 바로 앞 항목으로 돌아갑니다', preservesAlert: true },
  { id: 'nextField', word: '다음',   display: '다음',     desc: '값 입력 없이 바로 뒤 항목으로 건너뜁니다', preservesAlert: true },
  { id: 'prevRow', word: '이전행',   display: '이전행',   desc: '이전 행으로 이동합니다 (완료된 행은 값을 읽어주고 대기)', touch: '‹' },
  { id: 'nextRow', word: '다음행',   display: '다음행',   desc: '다음 행으로 넘어갑니다 (입력 중이던 행은 빈 행으로 남아 데이터 탭에서 채울 수 있어요)', primary: true, touch: '›' },
  { id: 'cancel',  word: '취소',     display: '취소',     desc: '현재 인식된 값을 지웁니다' },
  { id: 'keep',    word: '유지',     display: '유지',     desc: '현재 항목의 값을 그대로 두고 다음으로 넘어갑니다' },
  // v0.7.0 B4: 추세 검증 알림의 확인 응답("확인해주세요" → "확인"). 알림 상태 밖에서는 짧은
  // 재안내만 한다(useVoiceSession). prefix 불변식 검증: 기존 단어(수정·이전·다음·취소·유지·
  // 일시정지·재시작·종료) 어느 것과도 서로 prefix 관계가 아니다. (v0.49 F-1: 최장 일치 체계로
  // 바뀐 뒤에도 '확인'은 접두 쌍 2개 어디에도 끼지 않는다 — 위 헤더 주석의 계수와 일치.)
  { id: 'confirm', word: '확인',     display: '확인',     desc: '추세 알림에서 방금 입력한 값을 그대로 확정합니다', touch: '✓' },
  { id: 'pause',   word: '일시정지', display: '일시정지', desc: '입력을 잠시 멈춥니다',            primary: true, touch: '⏸' },
  { id: 'resume',  word: '재시작',   display: '재시작',   desc: '멈춘 입력을 다시 시작합니다',      primary: true, touch: '⏸' },
  { id: 'end',     word: '종료',     display: '종료',     desc: '입력을 끝내고 저장합니다',        primary: true, touch: '종료', touchNote: '말로는 1단계까지 — 확정은 ✓ 버튼' },
  // v0.38.0 #4-③ — 음성입력 중 보이는 비-네비 버튼의 누락 커버리지. 숫자·단위 발화와
  // 겹치지 않는 명시적 복합어만 허용한다. detectCommand가 공백을 제거하므로 word는 붙여 쓰고,
  // 사용자가 읽는 display는 자연스러운 띄어쓰기를 유지한다. 서로 완전-prefix 관계는 없다.
  // 🔴 v0.51 — 조절판 5종(`입력조절`·`인식률낮추기`·`인식률높이기`·`안내속도느리게`·
  //   `안내속도빠르게`)이 여기서 지워졌다. 근거는 위 `VoiceCommand` 유니온 주석.
  //   👉 사용자에게는 사라진 것이 아니라 **「손으로만 되는 것」으로 이사**했다 —
  //      `HAND_ONLY_FEATURES`가 도움말에서 그 자리를 진다.
  { id: 'help',                word: '도움말',           display: '도움말',           desc: '음성 명령어 도움말을 엽니다', touch: '?', touchNote: '닫기는 손으로만' },
  // v0.46.0 WP-F(F13② · 민구 R2) — word를 '화면끄기'가 아니라 **'화면'**으로 둔 것이 핵심이다.
  //   detectCommand는 공백을 지우고 startsWith로 맞추므로(koreanNum.ts), 민구가 말한 **"화면 꺼"**는
  //   '화면꺼'가 되어 '화면끄기'로는 **안 잡힌다.** '화면'이면 "화면 꺼"·"화면 끄기"·"화면꺼"가 전부 걸린다.
  //   접두 확인(v0.51 제거 후 재계수): 다른 **12개** word 중 '화면'을 접두로 갖거나 '화면'의
  //   접두인 것은 없다 — 최장 일치로 바뀐 뒤에도 '화면'은 단독으로 잡힌다.
  //   (v0.49 F-1 시점 17개 → v0.51에서 조절판 5종 제거로 12개.)
  //   🔴 v0.47.0 V-FIX4 — desc의 해제 안내는 **계약이다**: 도움말이 틀린 조작을 가르치면
  //     사용자는 «켜지지 않는 화면»에 갇힌 것으로 받아들인다 — 이 기능의 유일한 실패 모드가
  //     그것이라 문구 1건도 계약이다.
  //   🔴 v0.47.0 r3(콜드 리뷰 claude §3) — r2 P6가 해제를 「탭」→「중앙 2초 홀드」로 바꿨는데
  //     이 desc만 「탭하면」으로 남아 V-FIX4가 선언한 그 계약을 위반했다. BlackoutOverlay의
  //     `WAKE_LINES`(「가운데를 2초 누르면 화면이 켜집니다」)·aria-label과 **같은 표현**
  //     (「2초 누르면」)으로 맞춘다. 저쪽 문구를 바꾸면 여기도 함께 바꿔라.
  //     ⚠️ 진입 문구는 손대지 않는다: 음성 「화면」은 W7 이후에도 그대로 산다(홀드가 추가됐을 뿐).
  //     ⚠️ 명령 시작어 대조(레인A 08-09 「화면」 충돌 전례): desc는 CommandHelpPopup **화면 렌더
  //       전용**이고 TTS로 낭독되지 않는다. 바뀐 꼬리(「…2초 누르면 다시 켜집니다」)는 명령
  //       **13종**(v0.49 F-1에서 16→18 → v0.51에서 조절판 5종 제거로 13) 어느 word와도
  //       새 prefix 관계를 만들지 않는다
  //       ('화면' 시작은 종전과 동일).
  { id: 'screenOff',           word: '화면',             display: '화면 끄기',        desc: '화면을 꺼서 배터리를 아낍니다. 음성 입력은 계속됩니다 — 화면 가운데를 2초 누르면 다시 켜집니다',
    // 🔴 v0.51 P2-2 — 이 `touch`는 **끄는** 손 조작이고(히어로 중앙 홀드),
    //   desc 꼬리의 「2초 누르면 다시 켜집니다」는 **켜는** 조작이다(검은 화면 중앙 홀드).
    //   둘이 같은 「2초」로 읽혀 헷갈리므로 `touchNote`가 그 자리에서 가른다.
    //   🔴 **두 2초는 서로 다른 상수다** — `HOLD_TO_BLACKOUT_MS`(끄기)와 `HOLD_TO_WAKE_MS`(켜기).
    //   값이 같은 것은 **우연이고 근거가 다르다**(각 상수의 주석 참조). 한쪽만 바뀌면
    //   이 세 문자열(desc 꼬리 · touch · touchNote)도 함께 고쳐라 — V-FIX4의 계약 범위다.
    //   ⚠️ 그래서 **이 표는 H2(끄기 3000→2000) 없이 배포되면 안 된다** — 3초일 때 「중앙 2초」는 거짓이다.
    touch: '중앙 2초', touchNote: '끄기·켜기 모두 화면 가운데 2초' },
];

/** Commands shown in the compact on-screen hint row. */
export const PRIMARY_COMMANDS = VOICE_COMMANDS.filter((c) => c.primary);

/** "수정 <컬럼명>" 발화에서 허용하는 조사 꼬리(닫힌 목록).
 *  ⚠️ '도'(역시)는 **의도적으로 제외** — '횡경도' 같은 실제 컬럼명과 구분이 불가능해, 허용하면
 *  '횡경'만 있는 설정에서 "수정 횡경도"가 '횡경'으로 오매치된다(v0.34.0 리뷰 Codex High).
 *  같은 이유로 임의 접미사(startsWith)는 허용하지 않는다 — 모르는 꼬리는 매치 실패로 떨어뜨린다. */
const MODIFY_COL_PARTICLES = ['으로', '로', '을', '를', '은', '는', '이', '가', '에', '의', '만'];

/** v0.34.0 A3 — "수정 <컬럼명>" 파서. 완료 행 검토 대기(reviewWait) 스코프에서 특정 컬럼을 지목해
 *  수정 진입할 때 쓴다("수정 초장" → '초장'). 규칙:
 *   - 정규화: 공백 전부 제거(STT가 '초장'을 '초 장'으로 쪼개는 변형 대응) 후 '수정' 전치/후치 제거.
 *   - 매칭(v0.34.0 리뷰 Codex High·agy 공통 — 오지목=시트 오염이므로 보수적으로):
 *     ① **완전 일치** 우선. ② 없으면 **컬럼명 + 허용 조사**(MODIFY_COL_PARTICLES)만 인정.
 *     임의 접미사는 불허 — '횡경'만 있을 때 "수정 횡경도"는 매치 실패(null)로 떨어진다.
 *   - **모호하면 거부(null)**: 같은 이름의 컬럼이 둘 이상이면(시트 중복 헤더 — sheets.ts는
 *     occurrence별 다른 id를 부여) 어느 쪽인지 결정할 수 없으므로 지목하지 않는다. 호출자가
 *     첫 동명 컬럼을 잡아 엉뚱한 셀을 지우던 경로를 차단.
 *   - **숫자값 추출(extractModifyValue)과 상호배타** — 호출자는 값 추출이 null일 때만 이 함수를
 *     시도한다(컬럼명이 숫자로 파싱될 일은 없지만, 우선순위를 값>컬럼명으로 고정하는 계약).
 *  reviewWait 밖에서는 호출하지 않는다(일반 수정 의미론 불변). */
export function extractModifyColumn(text: string, colNames: string[]): string | null {
  const norm = text.replace(/[\s.,]+/g, '');
  let rest: string | null = null;
  if (norm.startsWith('수정')) rest = norm.slice(2);
  else if (norm.endsWith('수정')) rest = norm.slice(0, -2);
  if (!rest) return null;
  const target = rest;
  const norms = colNames.map((name) => ({ name, n: name.replace(/\s+/g, '') })).filter((c) => c.n);
  // 동명 컬럼이 둘 이상이면 어느 것도 지목하지 않는다(모호 → 거부).
  const isDuplicated = (n: string) => norms.filter((c) => c.n === n).length > 1;

  // ① 완전 일치.
  const exact = norms.filter((c) => c.n === target);
  if (exact.length === 1) return exact[0].name;
  if (exact.length > 1) return null; // 중복 헤더 — 모호

  // ② 컬럼명 + 허용 조사. 후보가 여럿이면 가장 긴 컬럼명(접두 섀도잉 방지), 그래도 동명 중복이면 거부.
  let best: string | null = null;
  let bestLen = 0;
  for (const { name, n } of norms) {
    if (!target.startsWith(n)) continue;
    const tail = target.slice(n.length);
    if (!MODIFY_COL_PARTICLES.includes(tail)) continue; // 임의 접미사 불허
    if (n.length > bestLen) {
      best = isDuplicated(n) ? null : name;
      bestLen = n.length;
    }
  }
  return best;
}
