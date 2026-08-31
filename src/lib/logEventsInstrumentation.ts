/**
 * v0.44.0 §5-1 계측 빌더 3종 — logEvents.ts에서 분리(GL-006 §5 500줄 게이트).
 * 소비처는 계속 `./logEvents`에서 import한다(아래 re-export) — 바이트 계약·파서 매핑 불변.
 * ⚠️ `kv`를 logEvents에서 가져오는 순환 import는 안전하다: 두 파일 모두 최상위 실행 없이
 * 함수 정의만 export한다(ESM 함수 호이스팅 — 호출은 런타임에만 일어난다).
 */
import { kv } from './logEvents';

/** §5-1 ③ — **활성 입력장치 종류.** §D의 인과(스피커폰이면 half-duplex가 필요하다)를 다음
 *  실기기 로그에서 로그만으로 확정하기 위한 축. 세션 시작 시 1회 + 장치 변경 감지 시
 *  (`emitInputDeviceChanged`의 라벨 실제 전이 게이트에 동승 — 링버퍼 잠식 없음) 방출한다.
 *
 *  🔴 유니온에 `speakerphone`이 **없다** — 출력 경로(스피커 vs 이어피스)는 Web API로 직접 못
 *  잰다(`classifyAudioInputClass` 주석). 스피커폰은 사후에 `cls=builtin` + TTS 재생창 안
 *  `stt_barge_in` 밀도(08-02 실측: 771발화/45셀 시그니처)로 추정한다.
 *
 *  원시 라벨은 extra가 아니라 이벤트의 `text` 필드에 싣는다(`input_device_changed` 계보 —
 *  extra는 저카디널리티로 유지해 SOP-003 파서 대조를 지키고, 분류가 틀렸을 때 사후 재분류의
 *  근거는 text가 남긴다). */
export function audioInputClass(fields: {
  cls: 'earphone' | 'builtin';
  src: 'session_start' | 'device_change';
}): string {
  return `audio_input_class:${kv({ cls: fields.cls, src: fields.src })}`;
}

/** §5-1 ④ — **음성 화면 주요 슬롯의 실렌더 fontSize(px).** 실기기 점검 항목 "곡선 3항만 값
 *  변화"를 세 회차째 판정 못 한 공백 — 폰트 실렌더값이 로그에 없었다.
 *
 *  세션당 1회(안정 시점 — `fontRenderProbe.ts`가 계약을 코드로 보장)만 방출한다.
 *  px는 소수 1자리 반올림(부동소수 꼬리 방지 — beepPlay gain 계보). 뷰포트(w/h)를 함께 실어
 *  같은 곡선이 그 기기에서 왜 그 값으로 해석됐는지를 로그만으로 재현 가능하게 한다.
 *
 *  🔴 `probe`는 **그 슬롯 값이 실렌더 요소가 아니라 프로브(보이지 않는 측정용 노드)로 해석된
 *  값**임을 남긴다('+' 연결, 없으면 'none' — visibilityContext evidence 표기 계보). 세션 시작
 *  직후엔 히어로 값 슬롯이 비어 있고 알람 카드도 없으므로 둘은 대개 프로브다 — 출처를 숨기면
 *  "실측"과 "곡선 해석"이 로그에서 같아 보인다(계측이 자기 한계를 숨기지 않는다는 원칙). */
export function fontRenderSnapshot(fields: {
  hero: number;
  alarmLabel: number;
  alarmValue: number;
  chipLabel: number;
  chipValue: number;
  w: number;
  h: number;
  probe: string;
}): string {
  const px = (v: number) => Math.round(v * 10) / 10;
  return `font_render:${kv({
    hero: px(fields.hero),
    alarmLabel: px(fields.alarmLabel),
    alarmValue: px(fields.alarmValue),
    chipLabel: px(fields.chipLabel),
    chipValue: px(fields.chipValue),
    w: fields.w,
    h: fields.h,
    probe: fields.probe,
  })}`;
}

/** §5-1 ② — `stt_barge_in`의 text가 **빈 final 대신 같은 발화의 마지막 interim**에서 채워졌다는
 *  출처 마커. 08-02 실기기 167건 전부 text=''/confidence=0이라 "무엇을 들었는지"가 로그에 없었고
 *  §D2(종경 컬럼) 판정이 미결로 남았다. 이 마커가 없으면 "final이 원래 그 텍스트였다"와
 *  "interim 폴백이었다"가 로그에서 같아 보인다. final 원문이 그대로면 extra 자체가 없다
 *  (과거 로그와 동형 — 기존 이벤트 바이트 불변). */
export function bargeInTextSource(src: 'interim'): string {
  return kv({ text_src: src });
}

/** v0.45.0 WP-1① — **ready 화면(세션 시작 전) 입·출력 프로브.** F15("한 번에 안 붙어, 너무
 *  잦아")의 실랑이가 일어나는 곳이 정확히 이 화면인데 여기엔 계측이 없었다(연구 A6 — 세션 중
 *  이벤트는 깨끗한데 사용자는 안 됐다고 한다). "안 붙음"이 STT 미지원인지, TTS 엔진이 얼었는지
 *  (iOS 백그라운드 복귀 후 synth paused 물림), 마이크 장치가 안 보이는지를 로그로 가른다.
 *
 *  [ORCH-47] 겹침 대조: 시작 클릭 후 실패는 `mic_init_failed`·`ui_fx:preroll`이, 음성 목록
 *  로드는 `tts_voices_loaded`가 이미 덮는다 — 이 이벤트는 **시작 클릭 전의 상태**만 신규다.
 *  세션 전이라 sessionId는 `__app__` sentinel로 남는다(시간축으로 다음 세션과 조인).
 *
 *  - `synth`  TTS 엔진 상태. `paused`가 물림 시그니처다(iOS는 백그라운드에서 synthesis를
 *             얼리고, resumeTtsEngine 전까지 speak가 조용히 무음이 된다).
 *  - `voicesKo` 한국어 음성 수. iOS는 목록이 늦게 채워진다 — 0은 "미지원"과 "아직 안 채워짐"
 *             둘 다일 수 있으므로 단독 판정 금지(다음 ready_probe·tts_voices_loaded와 대조).
 *  - `mics`   enumerateDevices의 audioinput 수. 권한 전엔 label이 비지만 개수는 나온다.
 *  - `perm`   Permissions API의 마이크 상태. 미지원 브라우저는 unknown. */
export function readyProbe(fields: {
  stt: 'yes' | 'no';
  synth: 'none' | 'idle' | 'speaking' | 'paused';
  voicesKo: number;
  mics: number | 'unknown';
  perm: 'granted' | 'denied' | 'prompt' | 'unknown';
}): string {
  return `ready_probe:${kv({
    stt: fields.stt,
    synth: fields.synth,
    voicesKo: fields.voicesKo,
    mics: fields.mics,
    perm: fields.perm,
  })}`;
}

/** v0.45.0 WP-1② — **확정(에코) 순간의 hero 실렌더 fontSize.** C3(F4·F6 확정값 잘림)이 로그만으로
 *  판정 불가였던 공백: 기존 `font_render`는 세션 시작 3초 시점 1회 스냅샷이라 확정값 슬롯이 대개
 *  프로브(곡선 해석)였다. 이 이벤트는 확정 플래시(data-hero-state=confirm)가 **실제로 값을 그린
 *  프레임**에서 실렌더만 읽는다 — 요소가 없으면 방출하지 않는다(프로브 폴백 없음: 폴백을 남기면
 *  "확정 순간 실렌더"라는 존재 이유가 사라진다). 세션당 1회(fontRenderProbe.ts가 가드 소유). */
/** 🔴 v0.46.1 WP-3(민구 FB-6·FB-7 · 08-07) — **넘침 지표 3종을 추가한다.**
 *
 *  민구 제보: *"중앙 출력 잘림. 인식 및 출력되어야 할 값 33.3 / 실제 기기에서 보이는 값 33…"* ·
 *  *"화면 중앙 확정값 표시 **불안정**. … 정수자리가 2자리 일때와, 3자리 일때를 비교해볼것."*
 *
 *  🔑 **종전 이 이벤트는 폰트 크기만 남겼다 — 「넘쳤는가」가 없다.** 그래서 로그가 있어도
 *  제보를 판정할 수 없었다. 08-07 회차가 Chromium에서 재현을 시도했으나 **가로 넘침이
 *  구조적으로 발생하지 않았고**(fit이 항상 폭에 맞춘다 — 10글자 `1234567.89`조차 `ovX=0`),
 *  fit의 검사 가능한 축은 전부 이미 처방돼 있었다(폭 판정 tolerance 0.05 · `fonts.ready` 후
 *  재fit · deps에 값 포함). **남은 것은 실기기 실측뿐이다.**
 *
 *  - `ovX` `scrollWidth - clientWidth`. **> 0이면 `text-overflow: ellipsis`가 실제로 그려진다**
 *    = 민구가 본 `33…`의 직접 증거. 이 값이 0이면 잘림은 다른 층에서 온 것이다.
 *  - `ovY` `scrollHeight - clientHeight`. 세로 축(402×513 실측에서 1·2자리만 부모를 +1.6px 넘겼다).
 *  - `len` 표시 문자열 길이. **민구가 지목한 자릿수 축**을 로그에서 바로 가른다.
 *
 *  ⚠️ 추측으로 fit 구조를 고치지 마라 — 이 세 값이 다음 로그에 찍힌 뒤에 처방한다. */
/** 🔴 v0.47.0 W5ⓐ(민구 FB-F 제보 08-08 · 확정 «계측+축약제거 동시») — **세션 1회 → 에코마다.**
 *
 *  왜: triage가 FB-F("29.9가 29로")를 **표시 계층 단독 결함**까지 좁혔으나 후보 3안에서 멈췄다.
 *  세션당 1건인 표본으로는 *"nn.n만 갈린다"* 는 민구의 관찰을 로그에서 가를 수 없다 — 갈린
 *  그 에코가 표본에 들어올 확률 자체가 낮다. 전수화 비용은 세션당 ~40건이고 링버퍼는 2000건
 *  (`logger.ts:196`)이라 2% 대의 잠식이다. **민구가 이 대가를 확정했다.**
 *
 *  🔴 **계약: 「접두 불변 + 꼬리 확장 허용」** (v0.47.0 V-FIX6 개정 — 이중 콜드 리뷰 U4).
 *  앞 6필드(`hero,w,h,ovX,ovY,len`)의 **순서·이름·값 형식은 바이트 불변**이고 신규 필드는
 *  **그 뒤에만** 붙는다. 사이에 끼워 넣지 마라. 소비자는 `$` 앵커가 아니라 **접두 매칭**으로 읽는다.
 *  ⚠️ **이건 이 이벤트 하나에만 승인된 예외다** — 다른 이벤트로 관행처럼 번지면 안 된다.
 *  레포 기본값은 여전히 **바이트 영구 불변**이고, 예외는 «실소비 파서 0건» 실측을 근거로
 *  건별 승인한다(V-FIX6b — 2차 재검증이 «문서/코드 계약 충돌»로 지적한 지점).
 *  📍 정본: `PRINCIPLES.md` §4의 예외 목록 · 오라클: `tests/v0470-w5-hero-echo.spec.ts` ①
 *
 *  ⚠️ 종전 이 자리의 문장은 *"기존 6필드 호출은 바이트 동일 — 그게 반증 조건"* 이었고 **거짓
 *  안심이었다.** 아래 `scheduleEchoFontRender`는 **언제나** 꼬리를 붙여 방출한다 — 6필드짜리
 *  호출은 테스트 안에만 존재하므로, 그 green은 프로덕션 이벤트의 호환성을 하나도 보장하지
 *  않았다. 개정을 택한 근거는 **이 이벤트를 실제로 소비하는 파서가 0건**이라는 전수 grep이다
 *  (Larry 실측 08-08). 지킬 대상이 없는 호환성 때문에 계측을 약하게 둘 이유가 없다.
 *   - `n`     세션 내 에코 순번. 로그에 빠진 구간(=방출 실패)이 있는지를 가른다.
 *   - `ell`   `text-overflow: ellipsis`가 계산 스타일에 살아 있는가(1/0). W5ⓑ가 그걸 제거했으므로
 *             **배포된 번들이 처방을 담았는지**의 직접 증거다(zip 번들 식별자와 짝으로 읽는다).
 *   - `fit`   확정 프레임의 `--fit-value` 실측 배율 — 후보 ①(전환 프레임 fit 미적용)의 판정 축.
 *   - `px0` `ovX0` `fit0`  **rAF 2회 시점**(전환 직후) 읽기. 종전 계측은 300ms 정착 후만 읽어서
 *             *"첫 프레임에 넘쳤다가 곧 수렴한다"* 는 후보 ①을 **구조적으로 못 봤다.** 정착값과
 *             한 이벤트에 나란히 두면 두 시점을 대조할 수 있다(이벤트 수는 그대로 1건).
 *   - `txt`   화면에 **실제로 그려진 문자열**. `len`만으로는 "29.9를 29로 그렸다"와 "29.9인데
 *             넘쳐 잘려 보인다"가 갈리지 않는다.
 *             🔴 시트 불특정 계약상 값에 무엇이 들어올지 모른다 — `extra`의 `k=v,k=v` 문법을
 *             깨는 `%`·`,`·`=`를 **%-이스케이프**한다(가역). 길이는 아래 상수에서 자르고 잘림은
 *             `~` 접미로 표시한다(링버퍼 보호). */
const ECHO_TEXT_MAX = 24;

/** `extra` 파서를 깨지 않게 값 문자열을 감싼다. 되돌리는 순서는 `%2C`→',' `%3D`→'=' `%25`→'%'. */
export function escapeExtraValue(s: string): string {
  const cut = s.length > ECHO_TEXT_MAX ? `${s.slice(0, ECHO_TEXT_MAX)}~` : s;
  return cut.replace(/%/g, '%25').replace(/,/g, '%2C').replace(/=/g, '%3D');
}

export function fontRenderEcho(fields: {
  hero: number; w: number; h: number; ovX: number; ovY: number; len: number;
  n?: number; ell?: boolean; fit?: number;
  px0?: number; ovX0?: number; fit0?: number; txt?: string;
}): string {
  const px = (v: number) => Math.round(v * 10) / 10;
  const ratio = (v: number) => Math.round(v * 1000) / 1000;
  const pairs: Record<string, string | number> = {
    hero: px(fields.hero), w: fields.w, h: fields.h,
    ovX: fields.ovX, ovY: fields.ovY, len: fields.len,
  };
  // 🔴 순서가 계약이다(SOP-003 파서). 신규 필드는 **기존 6필드 뒤에만** 붙인다.
  if (fields.n !== undefined) pairs.n = fields.n;
  if (fields.ell !== undefined) pairs.ell = fields.ell ? 1 : 0;
  if (fields.fit !== undefined) pairs.fit = ratio(fields.fit);
  if (fields.px0 !== undefined) pairs.px0 = px(fields.px0);
  if (fields.ovX0 !== undefined) pairs.ovX0 = fields.ovX0;
  if (fields.fit0 !== undefined) pairs.fit0 = ratio(fields.fit0);
  if (fields.txt !== undefined) pairs.txt = escapeExtraValue(fields.txt);
  return `font_render_echo:${kv(pairs)}`;
}

/** 🔴 v0.47.0 W7 / V-FIX1ⓒ — **홀드 안내 TTS를 큐잉하지 않고 버렸다**(다른 발화가 재생·큐 대기 중).
 *
 *  왜 계측하나: 버리는 것이 **정상 동작**이라 화면에는 흔적이 없다(문구·진행바가 대신 진다).
 *  그래서 *"홀드 안내가 사실상 안 들린다"* 는 상태가 조용히 지속될 수 있다 — 이 이벤트의 빈도가
 *  그 판정의 유일한 근거다. 실패(=안내 손실)를 숨기지 않는다는 `PRINCIPLES.md` §4 후단 계약.
 *
 *  ⚠️ **빌더로 올린 이유**(V-FIX6b 마무리): 같은 회차에 §4를 *"확장은 건별 승인"* 으로 조인
 *  커밋이 **자기 우회 사례**를 남기면 다음 독자가 계약을 안 믿는다. 종전에는 컴포넌트가
 *  `'hold_tts_skipped:tts_busy'` 문자열을 인라인으로 썼다 — `logEvents.ts` 헤더의
 *  *"새 extra는 이 모듈을 경유한다"* 규약(v0.35.2+) 위반이었다.
 *  🟢 반면 `screen_off`/`screen_on`의 `src:…`는 **새 이벤트 이름이 아니라 기존 `parsed` 이벤트의
 *  필드 문자열**이라 이 규약의 대상이 아니다(그 구분을 `logEvents.ts` 헤더에 명시했다).
 *
 *  `reason` 유니온을 좁게 둔다 — 사유를 늘리는 것이 **의도적 행위**여야 로그 어휘가 안 흩어진다. */
export function holdTtsSkipped(reason: 'tts_busy'): string {
  return `hold_tts_skipped:${reason}`;
}

/** 🔴 v0.51 H3 (민구 실기기 08-31) — **홀드의 「시작」과 「취소」를 남긴다.**
 *
 *  ## 왜 계측하나 — 지금 취소가 로그에 **한 줄도 안 남는다**
 *  민구 제보: *"진행바가 0으로 갔다가 저절로 다시 차오른다."* 소스 전수(§12-2)가 그 왕복이
 *  **`pointerup`(또는 cancel) → `pointerdown`** 이었음을 **증명**했지만, 그 왕복의 **물리적 원인**은
 *  두 갈래로 갈리고 **로그만으로는 구분되지 않는다**:
 *   · **C1″** — 엄지 접촉의 간헐 끊김(사람 손가락 쪽)
 *   · **X2**  — iOS가 `pointercancel` 뒤 같은 손가락에 **새 `pointerdown`을 발행**(브라우저 쪽)
 *  🔑 **둘을 가르는 유일한 신호가 「취소 직후 새 홀드가 얼마 만에 시작됐는가」** 이고,
 *  그래서 `abort`만으로는 부족하다 — **`…_start`가 이 묶음의 핵심**이다.
 *  그리고 H2(3초→2초)·H7′(유예 창)의 **효과를 재려면** 취소율의 전후 비교가 필요하다.
 *
 *  ## 🔴 새 이벤트 **타입**을 만들지 않는다 (SOP-003 파서 계약)
 *  기존 `type=command`에 `parsed=screen_off_start|screen_off_abort|screen_on_abort`를 싣는다.
 *  🟢 기존 오라클 안전 확인(실측): `v0470-w7-hold-blackout.spec.ts:136`의 필터는
 *  **`e.parsed === parsed` 정확 일치**라 `screen_off_start`/`_abort`가 `screen_off` 집계에
 *  **안 걸린다.** 테스트 ②의 *"취소된 홀드가 screen_off를 남기면 안 된다"* 는 그대로 산다.
 *  🔴 **다만 분석 쪽(SOP-003)이 `parsed`를 접두 매칭하면 오염된다** — 그 SOP의 접두 매칭 조항은
 *  `extra`에 대한 것이고(§237 ③) `parsed`에 `screen_off` 집계는 없음을 확인했다. 그래도
 *  로그 판독 레인과 **교차 확인이 필요하다**(이 회차 인계 사항).
 *
 *  ## 대가 — 링버퍼 잠식
 *  취소가 잦으면 그만큼 다른 로그를 밀어낸다. 그래서 **`at`은 50ms 단위로 반올림**해
 *  카디널리티를 낮춘다(정밀도는 판정에 필요 없다 — 우리가 보는 것은 «수십 ms인가 수백 ms인가»다).
 *
 *  @param reason 취소 사유. `secondary` = H1 가드가 남의 포인터를 걸러낸 경우(참고: 그 경로는
 *         `stopHold` 자체에 도달하지 않으므로 **방출되지 않는다** — 유니온에 두는 것은 다음
 *         편집자가 그 사실을 알고 넣게 하기 위해서다).
 *  @param atMs 홀드 시작으로부터 경과 ms. 호출부가 반올림하지 않아도 여기서 한다. */
export function holdAbort(fields: {
  phase: 'screen_off' | 'screen_on';
  reason: 'up' | 'cancel' | 'leave' | 'unmount' | 'secondary';
  atMs: number;
  /** 🔴 v0.51 [P1-2] — **새 홀드가 시작되면서 밀려난 취소**다(유예가 만료돼 스스로 끝난 것이 아니다).
   *
   *  왜 굳이 가르나: 이 abort는 바로 뒤 `screen_off_start`와 **같은 밀리초**에 찍힌다.
   *  그 모양이 **X2 시그니처(「취소 직후 곧바로 재시작」 = iOS가 `pointercancel` 뒤 새
   *  `pointerdown`을 발행)와 구분되지 않는다** — 그런데 C1″와 X2를 가르는 것이 H3의 존재
   *  이유다. 표식이 없으면 **계측이 자기 판정을 스스로 오염시킨다.**
   *  👉 판독 시 `displaced=1`인 쌍은 **간격 0을 X2 근거로 쓰면 안 된다.** */
  displaced?: boolean;
}): string {
  return kv({
    src: 'hold',
    reason: fields.reason,
    at: Math.round(fields.atMs / 50) * 50,
    ...(fields.displaced ? { displaced: 1 } : null),
  });
}

/** 🔴 v0.51 H3 — 홀드 **시작**. 위 `holdAbort`의 짝이고, **C1″/X2 판별의 축**이다
 *  (취소 직후 이 이벤트까지의 간격이 곧 «접촉 끊김이었나, 브라우저 재발행이었나»를 가른다).
 *
 *  @param via `'grace'`면 **H7′ 유예가 흡수한 재접촉**이다. 🔑 흡수된 왕복은 `abort`를
 *         남기지 않으므로(그게 처방의 목적이다) **이 표식이 그 건수를 세는 유일한 수단**이다.
 *         「유예를 넣었더니 리셋이 사라졌다」와 「원래 안 났다」를 이것이 가른다. */
export function holdStart(via?: 'grace'): string {
  return via ? kv({ src: 'hold', resume: via }) : kv({ src: 'hold' });
}

/** 🔴 v0.47.0-r2 P2(FB-C · 민구 실기기 08-09) — **수동입력 이상치 보류 중 음성 차단을 안내했다.**
 *
 *  왜 계측하나: 07-14 결정(수동입력 이상치는 터치 [확인]/[수정] 전용)은 유지하되, 종전엔 차단이
 *  **완전 무음**이었다 — 08-09 실측에서 민구가 홀드 중 「확인」×6·「100」×3을 말했고 12건이
 *  `blocked:manual_hold:stt`로 조용히 버려졌다. 민구는 그걸 **TTS 고장**으로 읽었다(FB-C).
 *  이제 알람 1건당 1회 안내를 낸다. 이 이벤트의 빈도 대비 `blocked:manual_hold:stt` 빈도가
 *  *"안내를 듣고도 계속 말했는가"* 를 가른다 — 그게 다음 회차에 07-14 결정을 재검토할 근거다.
 *
 *  `reason` 유니온을 'stt'로 좁게 둔다: 홀드 중 음성 명령은 STT 게이트에서 **먼저** 잘려
 *  `prev`/`next`/`pause` 차단은 사실상 터치 전용이다(실측 12건 전부 stt). 터치 차단까지
 *  안내하려면 사유를 **의도적으로** 늘려라 — 어휘가 저절로 흩어지지 않게. */
export function manualHoldGuide(reason: 'stt'): string {
  return `manual_hold_guide:${reason}`;
}

/** v0.45.0 WP-1④ — **세션-활성 게이트(WP-2)가 hidden에 유지한 구간의 생존 요약.** hidden
 *  사이클당 1건(복귀 또는 임계 도달 시점) — 시계열이 아니라 요약이다([F5] 링버퍼 보호).
 *  WP-2가 "유지"를 선택한 사이클에서 OS가 실제로 무엇을 살려뒀는지가 다음 실기기 판정 축이다:
 *   - `finals`  hidden 동안 도착한 STT final 수 — 유지가 실효였다는 가장 강한 증거(0이면
 *               "발화가 없었다"와 "OS가 죽였다"를 track과 대조해 가른다).
 *   - `stt`     복귀/임계 시점 인식기 인스턴스 존재 여부(ctrl/gone).
 *   - `track`   마이크 트랙 상태(live/muted/ended/none — bg_enter_snapshot과 동일 어휘). */
export function bgKeep(fields: {
  backgroundMs: number;
  finals: number;
  stt: 'ctrl' | 'gone';
  track: string;
}): string {
  return `bg_keep:${kv({
    bg_s: Math.round(fields.backgroundMs / 1000),
    finals: fields.finals,
    stt: fields.stt,
    track: fields.track,
  })}`;
}

/** v0.45.0 WP-2 — 알림 권한 요청·임계 알림 표시 결과. 요청은 세션 시작 클릭(제스처 구간)에서
 *  1회, 표시는 임계 도달 시(backgroundNotify.ts 계약). 조건 거짓도 기록한다([FG-RETURN-LOG-1] —
 *  skipped/no_permission이 없으면 "알림이 안 갔다"와 "배선이 안 붙었다"가 로그에서 같아 보인다). */
export function notifyPerm(fields: {
  src: 'session_start' | 'threshold';
  result: string;
}): string {
  return `notify_perm:${kv({ src: fields.src, result: fields.result })}`;
}
