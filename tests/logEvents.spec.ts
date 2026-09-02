/**
 * v0.35.2 Stage 2 — logEvents 빌더 특성화 테스트 (Node, 서버 불필요 — sessionSync.spec 패턴).
 *
 * 목적: 빌더가 방출하는 extra 문자열을 **리터럴로 고정**한다(SOP-003 파서·과거 zip 바이트 계약).
 * 기대값은 리팩토링 이전 콜사이트의 템플릿 리터럴 산출을 그대로 옮긴 것 — 빌더 구현을 바꿔서
 * 이 테스트를 고치고 싶어지면, 그것은 외부 파서 계약 위반 신호다(anomalyAlert.spec 패턴).
 */
import { test, expect } from '@playwright/test';
import {
  kv,
  withErr,
  settingChanged,
  rowMarked,
  zombieRestart,
  micAutoReconnect,
  micInitFailed,
  recoverTimeout,
  audioRouteRevalidate,
  foregroundReturn,
  wakeLockEvent,
  visibilityContext,
  lifecycleSignal,
  inputControlPanelOpened,
  endReachedRender,
  anomalyAlertCleared,
  clipArmBlocked,
  micTeardown,
  beepPlay,
  feedbackUploadMic,
  bgEnterSnapshot,
  orientationChange,
  lowConfidenceParsed,
  audioInputClass,
  fontRenderSnapshot,
  bargeInTextSource,
  bgMicAction,
  bgKeep,
  notifyPerm,
  readyProbe,
  holdTtsSkipped,
  fontRenderEcho,
  sessionStartBlocked,
  endAbsorb,
  sheetSynced,
} from '../src/lib/logEvents';

/** v0.51.1 L (민구 지시 2026-09-02) — 동기화 완료 계측. 예시는 STT 레인 §6 L의 형태 그대로. */
test('sheetSynced — 동기화 완료 바이트 계약 (L 신규 이벤트)', () => {
  expect(sheetSynced({ sheet: '1ov3FvV-', tab: '품질조사', from: 200, to: 217, n: 18 }))
    .toBe('sheet_synced:sheet=1ov3FvV-,tab=품질조사,rows=200-217,n=18');
  // 행 번호를 모르는 경우(updatedRange 파싱 실패)의 결정적 센티널.
  expect(sheetSynced({ sheet: 'SHEET_TA', tab: '농가', from: 0, to: 0, n: 3 }))
    .toBe('sheet_synced:sheet=SHEET_TA,tab=농가,rows=0-0,n=3');
  // 탭 이름의 `,`·`=`는 extra 문법을 깨지 않게 %-이스케이프된다(escapeExtraValue 계약).
  expect(sheetSynced({ sheet: 'abcdefgh', tab: 'a,b=c', from: 5, to: 5, n: 1 }))
    .toBe('sheet_synced:sheet=abcdefgh,tab=a%2Cb%3Dc,rows=5-5,n=1');
});

/** v0.51.1 B2 (제보② 2026-09-02) — atEnd 흡수. `cell_wait_absorb:<colId>`와 같은 꼴. */
test('endAbsorb — atEnd 흡수 바이트 계약 (B2 신규 이벤트)', () => {
  expect(endAbsorb('m2')).toBe('end_absorb:m2');
});

/** v0.51.1 B1 (제보① 2026-09-02) — 음성 열 0개 구성의 세션 시작 차단. 종전엔 무로그 return이었다. */
test('sessionStartBlocked — 세션 시작 차단 사유 바이트 계약 (B1 신규 이벤트)', () => {
  expect(sessionStartBlocked('no_voice_columns')).toBe('session_start_blocked:reason=no_voice_columns');
});

test('settingChanged — 기존 4개 콜사이트 산출과 바이트 동일', () => {
  expect(settingChanged('ttsRate', 1.2)).toBe('setting_changed:ttsRate=1.2');
  expect(settingChanged('recognitionTolerance', 0.6)).toBe('setting_changed:recognitionTolerance=0.6');
  expect(settingChanged('fastRecognition', true)).toBe('setting_changed:fastRecognition=true');
  expect(settingChanged('autoScreenCapture', false)).toBe('setting_changed:autoScreenCapture=false');
});

test('rowMarked — row_complete/row_skipped/row_last_stop 산출과 바이트 동일', () => {
  expect(rowMarked('row_complete', 3, 'voice')).toBe('row_complete:3,src=voice');
  expect(rowMarked('row_skipped', 12, 'touch')).toBe('row_skipped:12,src=touch');
  // v0.44.0 §C8 F13 — '다음'의 마지막 행 경계 멈춤(이동 없음 → jump 이벤트가 없어 유일한 흔적).
  expect(rowMarked('row_last_stop', 5, 'voice')).toBe('row_last_stop:5,src=voice');
});

test('withErr — Error/비Error 모두 기존 String((err as Error)?.message ?? err) 산출과 동일', () => {
  expect(withErr('session_persist_failed', new Error('QuotaExceededError'))).toBe(
    'session_persist_failed:QuotaExceededError',
  );
  // 비 Error 값(문자열 reject 등) — message가 없으므로 값 자체를 문자열화.
  expect(withErr('drive_upload:failed', '401 unauthorized')).toBe('drive_upload:failed:401 unauthorized');
  // undefined message 케이스: new Error() → message '' — 기존 표현식과 동일하게 빈 문자열.
  expect(withErr('x', new Error())).toBe('x:');
});

test('kv — 신규 이벤트 표준 표기(key=val 쉼표 연결, 삽입 순서 보존)', () => {
  expect(kv({ row: 3, src: 'voice' })).toBe('row=3,src=voice');
  expect(kv({ total: 12, ko: 4 })).toBe('total=12,ko=4');
  expect(kv({ ok: true })).toBe('ok=true');
});

test('zombieRestart — lifecycle 텔레메트리 바이트 계약(stale_ms → n 순서)', () => {
  expect(zombieRestart(12_345, 2)).toBe('lifecycle:zombie_restart:stale_ms=12345,n=2');
});

test('micAutoReconnect — 자동 재연결 시도/결과 신규 바이트 계약', () => {
  expect(micAutoReconnect('attempt')).toBe('mic_auto_reconnect:attempt');
  expect(micAutoReconnect('ok')).toBe('mic_auto_reconnect:result=ok');
  expect(micAutoReconnect('failed')).toBe('mic_auto_reconnect:result=failed');
});

test('recoverTimeout — 마이크 재획득 타임아웃 신규 바이트 계약', () => {
  expect(recoverTimeout('auto', 7_000)).toBe('clip_recorder_recover_timeout:auto:ms=7000');
});

test('micInitFailed — v0.44.1 세션 시작 마이크 획득 실패 신규 바이트 계약', () => {
  expect(micInitFailed('NotAllowedError')).toBe('mic_init_failed:err=NotAllowedError');
  expect(micInitFailed('unknown')).toBe('mic_init_failed:err=unknown');
});

test('wakeLockEvent — 획득/재획득/해제 전 경로 바이트 계약', () => {
  expect(wakeLockEvent({ action: 'acquire', result: 'attempt' }))
    .toBe('wake_lock:action=acquire,result=attempt');
  expect(wakeLockEvent({ action: 'acquire', result: 'ok' }))
    .toBe('wake_lock:action=acquire,result=ok');
  expect(wakeLockEvent({ action: 'acquire', result: 'failed', reason: 'NotAllowedError' }))
    .toBe('wake_lock:action=acquire,result=failed,reason=NotAllowedError');
  expect(wakeLockEvent({ action: 'acquire', result: 'unsupported' }))
    .toBe('wake_lock:action=acquire,result=unsupported');
  expect(wakeLockEvent({ action: 'reacquire', result: 'failed', reason: 'NotAllowedError' }))
    .toBe('wake_lock:action=reacquire,result=failed,reason=NotAllowedError');
  expect(wakeLockEvent({ action: 'release', result: 'ok', source: 'browser' }))
    .toBe('wake_lock:action=release,result=ok,source=browser');
  expect(wakeLockEvent({ action: 'release', result: 'failed', source: 'cleanup', reason: 'AbortError' }))
    .toBe('wake_lock:action=release,result=failed,source=cleanup,reason=AbortError');
});

test('SCREEN-LOCK-1 — visibility 문맥과 원시 lifecycle 신호 바이트 계약', () => {
  expect(visibilityContext({ state: 'hidden', focus: true, evidence: 'none' }))
    .toBe('visibility_context:state=hidden,focus=true,evidence=none');
  expect(visibilityContext({ state: 'visible', focus: false, evidence: 'blur+pagehide' }))
    .toBe('visibility_context:state=visible,focus=false,evidence=blur+pagehide');
  expect(lifecycleSignal({ signal: 'pagehide', visibility: 'hidden', focus: false, persisted: 'yes' }))
    .toBe('lifecycle_signal:signal=pagehide,vis=hidden,focus=false,persisted=yes');
});

test('inputControlPanelOpened — 조절판 펼침 분모 바이트 계약', () => {
  expect(inputControlPanelOpened('touch')).toBe('input_control_panel:action=open,source=touch');
  expect(inputControlPanelOpened('voice')).toBe('input_control_panel:action=open,source=voice');
});

test('[EXIT-PERSIST-1] 종료 렌더·알람 해제 신규 바이트 계약', () => {
  expect(endReachedRender({ branch: 'end', alertStatus: 'none' }))
    .toBe('end_reached_render:branch=end,alertStatus=none');
  expect(endReachedRender({ branch: 'anomaly', alertStatus: 'corrected' }))
    .toBe('end_reached_render:branch=anomaly,alertStatus=corrected');
  expect(anomalyAlertCleared({ reason: 'end_reached', hadStatus: 'corrected' }))
    .toBe('trend_alert_cleared:reason=end_reached,hadStatus=corrected');
});

test('[CLIP-WINDOW-2] suspend 중 신규 녹음창 차단 바이트 계약', () => {
  expect(clipArmBlocked({ reason: 'feedback_modal', row: 3, col: 'c9' }))
    .toBe('clip_arm_blocked:reason=feedback_modal,row=3,col=c9');
});

/** 🔴 v0.43.0 #3 — 저신뢰인데 파싱돼서 통과한 커밋의 마커.
 *  이 마커가 다음 회차에 "순서 반전이 옳았는가"를 가릴 **유일한 모수**다(plan §2-5-b 4번).
 *  ⛔ 기존 `stt_rejected_low_confidence`를 확장하지 않았다 — 커밋된 건에 "rejected" 이벤트를
 *  내면 거절률의 분모가 오염돼, 이 계측이 만들려는 바로 그 모수가 망가진다.
 *  `value` 이벤트의 extra에 실리므로 **신규 LogEntry 타입 0개 · 링버퍼 증가 0**이다. */
test('v0.43.0 #3 — low_conf_parsed 바이트 계약(신규 이벤트 타입 없이 value.extra에 실린다)', () => {
  expect(lowConfidenceParsed({ conf: 0.097, minConf: 0.6, tolerance: 0.6, via: 'primary' }))
    .toBe('low_conf_parsed:conf=0.097,minConf=0.6,tolerance=0.6,via=primary');
  // via는 어느 경로로 파싱됐는지 — alt 폴백·소수부 합성은 원인 분석이 달라진다.
  expect(lowConfidenceParsed({ conf: 0.021, minConf: 0.4, tolerance: 0.4, via: 'alt' }))
    .toBe('low_conf_parsed:conf=0.021,minConf=0.4,tolerance=0.4,via=alt');
  expect(lowConfidenceParsed({ conf: 0.5, minConf: 0.9, tolerance: 0.9, via: 'frac' }))
    .toBe('low_conf_parsed:conf=0.5,minConf=0.9,tolerance=0.9,via=frac');
});

/** v0.38.1 [MIC-B2] 실기기 판정 바이트 — 이 문자열이 SOP-003 파서와의 계약이다.
 *  R1 초안은 필드를 ':'로 잇고 evt를 `vis:bg=3000s`로 박아 split(':') 파서가 필드를 쪼갰다.
 *  배포 전에 kv(',') 규약으로 교정했고, 여기서 리터럴로 고정해 되돌아가지 못하게 한다. */
test('foregroundReturn — 복귀마다 1건, teardown 여부를 바이트로 남긴다(F6)', () => {
  // 🔴 이 이벤트가 없어서 2026-07-27 회차의 [MIC-B2] 판정이 통째로 불가능했다.
  //    복귀 처리 결과 4값과 **이벤트 없음**(훅 미동작)의 구분이 다음 회차 판정을 가능하게 만든다.
  expect(foregroundReturn({ backgroundMs: 58_231, teardown: 'skipped', evt: 'vis' }))
    .toBe('foreground_return:bg_s=58,teardown=skipped,evt=vis');
  expect(foregroundReturn({ backgroundMs: 61_000, teardown: 'no_recorder', evt: 'pageshow' }))
    .toBe('foreground_return:bg_s=61,teardown=no_recorder,evt=pageshow');
  expect(foregroundReturn({ backgroundMs: 62_000, teardown: 'completed', evt: 'vis' }))
    .toBe('foreground_return:bg_s=62,teardown=completed,evt=vis');
  expect(foregroundReturn({ backgroundMs: 63_000, teardown: 'failed', evt: 'pageshow' }))
    .toBe('foreground_return:bg_s=63,teardown=failed,evt=pageshow');
});

test('micTeardown — 포그라운드 선-정리 판정 바이트 계약', () => {
  expect(micTeardown({
    found: 'interrupted', closed: 'ok', reattach: 'ok', evt: 'vis', backgroundMs: 3_000_000,
  })).toBe('mic_teardown:found=interrupted,closed=ok,reattach=ok,evt=vis,bg_s=3000');

  // no-op(닫을 게 없었음) 판정도 같은 형식으로 읽혀야 실기기 사다리가 분기할 수 있다.
  expect(micTeardown({
    found: 'none', closed: 'ok', reattach: 'skipped', evt: 'pageshow', backgroundMs: 120_000,
  })).toBe('mic_teardown:found=none,closed=ok,reattach=skipped,evt=pageshow,bg_s=120');

  // 필드 구분자가 ':'로 새지 않는다 — 접두 1개만 ':'를 쓴다(파서 계약).
  const s = micTeardown({
    found: 'running', closed: 'timeout', reattach: 'error', evt: 'vis', backgroundMs: 61_000,
  });
  expect(s.split(':')).toHaveLength(2);
});

/** v0.38.2 F5 — 백그라운드 경로 전환의 **유일한 관측점**. 백그라운드에선 devicechange가 발화하지
 *  않아 2026-07-24 세션B의 BT→스피커 전환이 어떤 이벤트로도 남지 않았다(트리거를 추론으로만 세운 이유).
 *  `mic_teardown`과 같은 복귀 이벤트에서 짝으로 읽히므로 필드 표기도 같은 규약(kv ',')이어야 한다. */
test('audioRouteRevalidate — 오디오 경로 재검증 바이트 계약', () => {
  // 실기기 세션B가 남겼어야 할 바이트: 50분 백그라운드 뒤 BT → 내장으로 전환.
  expect(audioRouteRevalidate({
    before: '블루투스', after: '내장 마이크', track: 'live', status: 'ok', evt: 'vis', backgroundMs: 3_000_000,
  })).toBe('audio_route_revalidate:before=블루투스,after=내장 마이크,track=live,status=ok,evt=vis,bg_s=3000');

  // 진입 스냅샷이 없는 복귀(앱 첫 로드 직후 pageshow 등) — before=unknown으로 읽힌다.
  expect(audioRouteRevalidate({
    before: 'unknown', after: '유선 이어폰', track: 'muted', status: 'ok', evt: 'pageshow', backgroundMs: 60_000,
  })).toBe('audio_route_revalidate:before=unknown,after=유선 이어폰,track=muted,status=ok,evt=pageshow,bg_s=60');

  // 필드 구분자가 ':'로 새지 않는다 — 접두 1개만 ':'를 쓴다(micTeardown과 동일한 파서 계약).
  const s = audioRouteRevalidate({
    before: '내장 마이크', after: '블루투스', track: 'ended', status: 'error', evt: 'vis', backgroundMs: 1_000,
  });

  // 🔴 재검증 실패/미관측은 **'내장 마이크'로 확정되지 않는다**(라운드A 리뷰 Codex #1·#2).
  // 이 구분이 없으면 "재검증했는데 그대로였다"와 "재검증 자체가 실패했다"가 로그에서 같아 보인다.
  expect(audioRouteRevalidate({
    before: '블루투스', after: 'unknown', track: 'none', status: 'unavailable', evt: 'vis', backgroundMs: 90_000,
  })).toBe('audio_route_revalidate:before=블루투스,after=unknown,track=none,status=unavailable,evt=vis,bg_s=90');
  expect(s.split(':')).toHaveLength(2);
});

/* ────────────────────────────────────────────────────────────────────────────
 * v0.42.0 계측 — 2026-07-29 실기기 회차가 "판정 불가"로 닫은 축들.
 * 아래 리터럴이 SOP-003 파서와의 계약이다. 고치고 싶어지면 파서도 함께 고쳐야 한다.
 * ──────────────────────────────────────────────────────────────────────────── */

/** 계측 F — `catch` 침묵을 메운다(조기 반환 세 갈래 중 **다른 이벤트가 안 덮는 하나**).
 *
 *  `!rec`과 방출 게이트는 같은 복귀의 `foreground_return`이 각각 `teardown=no_recorder`·`bg_s`로
 *  이미 남긴다 — 07-29 복귀 5건 대조로 확인했다. 중복 방출은 2000개 링버퍼를 잠식하므로
 *  `[F5]` 스펙이 "임계 미만 무발행"을 계약으로 못박고 있다. 그래서 `catch`만 남긴다. */
test('audioRouteRevalidate — catch 침묵을 status=error로 메운다 (계측 F)', () => {
  // 07-29 bg_s=67(레코더 있음·게이트 통과)의 침묵이 여기였는지 다음 회차가 판정한다.
  // 관측 자체가 실패했으므로 before/after는 unknown, track은 none이다 — 추정으로 채우지 않는다.
  expect(audioRouteRevalidate({
    before: 'unknown', after: 'unknown', track: 'none', status: 'error', evt: 'vis', backgroundMs: 67_000,
  })).toBe('audio_route_revalidate:before=unknown,after=unknown,track=none,status=error,evt=vis,bg_s=67');
});

/** 계측 A — 제보 #5 "알람음 안 들림"의 3갈래(호출 안 됨 / 무음 / TTS에 묻힘). */
test('beepPlay — 알람음 재생 결과 바이트 계약 (계측 A)', () => {
  // 정상 재생. 안 들렸다면 원인은 앱 밖(무음 스위치·볼륨·TTS 중첩)이라는 근거가 된다.
  expect(beepPlay({
    kind: 'negative', result: 'played', ctx: 'running', gain: 0.6, tones: 3,
  })).toBe('beep_play:kind=negative,result=played,ctx=running,gain=0.6,tones=3');

  // 🔴 가장 유력한 무음 원인 — ctx가 suspended면 스케줄해도 소리가 안 난다.
  expect(beepPlay({
    kind: 'corrected', result: 'suspended', ctx: 'suspended', gain: 0.6, tones: 2,
  })).toBe('beep_play:kind=corrected,result=suspended,ctx=suspended,gain=0.6,tones=2');

  // 게인 0 — 볼륨 설정이 0이거나 배수가 0으로 클램프됐다. gain이 판정 근거로 남는다.
  expect(beepPlay({
    kind: 'modify', result: 'silent', ctx: 'running', gain: 0, tones: 1,
  })).toBe('beep_play:kind=modify,result=silent,ctx=running,gain=0,tones=1');

  // AudioContext 자체가 없다(iOS 제스처 미획득 등).
  expect(beepPlay({
    kind: 'negative', result: 'no_ctx', ctx: 'none', gain: 0.6, tones: 0,
  })).toBe('beep_play:kind=negative,result=no_ctx,ctx=none,gain=0.6,tones=0');

  // 🔴 iOS 전용 interrupted — 전화·Siri가 오디오 세션을 뺏은 상태. 농가 현장에선 일상이다.
  // `suspended`(제스처 전 미개시)로 정규화하면 원인이 로그에서 영원히 구분되지 않는다.
  // result는 같아도(소리 안 남) ctx가 이유를 가른다 — 두 필드는 직교한다.
  expect(beepPlay({
    kind: 'negative', result: 'suspended', ctx: 'interrupted', gain: 0.6, tones: 3,
  })).toBe('beep_play:kind=negative,result=suspended,ctx=interrupted,gain=0.6,tones=3');

  // gain은 소수 3자리로 반올림한다 — 부동소수 꼬리가 파서 대조를 깨지 않도록.
  expect(beepPlay({
    kind: 'negative', result: 'played', ctx: 'running', gain: 0.123456, tones: 3,
  })).toBe('beep_play:kind=negative,result=played,ctx=running,gain=0.123,tones=3');
});

/** 계측 G — 개선요청 업로드가 마이크를 죽이는가. **ms와 zip 바이트**가 핵심이다. */
test('feedbackUploadMic — 업로드 전후 트랙 상태를 ms·바이트로 짝짓는다 (계측 G)', () => {
  // 업로드 직전 스냅샷. bytes가 뒤 이벤트와 짝을 이루는 키다.
  expect(feedbackUploadMic({
    phase: 'start', track: 'live', bytes: 7_118_336, elapsedMs: 0,
  })).toBe('feedback_upload_mic:phase=start,track=live,bytes=7118336,ms=0');

  // 🔴 가설이 참이면 이 모양으로 찍힌다 — 같은 bytes, live→ended, 그 사이 경과 ms.
  expect(feedbackUploadMic({
    phase: 'uploaded', track: 'ended', bytes: 7_118_336, elapsedMs: 3_412,
  })).toBe('feedback_upload_mic:phase=uploaded,track=ended,bytes=7118336,ms=3412');

  // 취소·미로그인 큐잉 — 07-29 실측에서 이 경로는 마이크 사망 0건이었다(분모).
  expect(feedbackUploadMic({
    phase: 'queued', track: 'live', bytes: 6_770_112, elapsedMs: 12,
  })).toBe('feedback_upload_mic:phase=queued,track=live,bytes=6770112,ms=12');

  // 🔴 unknown은 "트랙이 없다"(none)가 아니라 "레코더를 못 읽었다"다 —
  // 이 구분이 없으면 계측 실패가 결함으로 오독된다.
  expect(feedbackUploadMic({
    phase: 'failed', track: 'unknown', bytes: 0, elapsedMs: 88,
  })).toBe('feedback_upload_mic:phase=failed,track=unknown,bytes=0,ms=88');
});

/** 계측 H — 백그라운드 **진입 시점**의 오디오 스택. 복귀 스냅샷과 앞뒤로 대조한다. */
test('bgEnterSnapshot — 진입 시점 레코더·트랙·인식기 (계측 H)', () => {
  // 정상 진입 — 복귀에서 no_recorder가 나온다면 그건 백그라운드 회수다.
  expect(bgEnterSnapshot({
    rec: 'recording', track: 'live', stt: 'listening', phase: 'active',
  })).toBe('bg_enter_snapshot:rec=recording,track=live,stt=listening,phase=active');

  // 🔑 진입 시점에 이미 없었다 — 이 경우 복귀의 no_recorder는 백그라운드 회수가 **아니다**.
  expect(bgEnterSnapshot({
    rec: 'none', track: 'none', stt: 'none', phase: 'idle',
  })).toBe('bg_enter_snapshot:rec=none,track=none,stt=none,phase=idle');

  // 모달로 STT가 suspend된 채 이탈한 경우 — [FEEDBACK-MIC-KILL-1] 축과 교차 판독한다.
  expect(bgEnterSnapshot({
    rec: 'idle', track: 'muted', stt: 'suspended', phase: 'active',
  })).toBe('bg_enter_snapshot:rec=idle,track=muted,stt=suspended,phase=active');
});

/* ────────────────────────────────────────────────────────────────────────────
 * v0.44.0 §5-1 계측 — "이게 들어가야 다음 실기기 로그부터는 로그만으로 판정된다" 백로그.
 * 아래 리터럴이 SOP-003 파서와의 계약이다. 고치고 싶어지면 파서도 함께 고쳐야 한다.
 * ──────────────────────────────────────────────────────────────────────────── */

/** §5-1 ③ — 입력장치 종류(earphone/builtin). §D의 인과(스피커폰 half-duplex 필요)를 다음
 *  실기기 로그에서 로그만으로 확정하기 위한 축. 🔴 `speakerphone`은 유니온에 **없다** —
 *  출력 경로는 Web API로 직접 못 재므로(classifyAudioInputClass 주석), 스피커폰은 사후에
 *  `cls=builtin` + barge-in 패턴(TTS 재생창 안 stt_barge_in 밀도)으로 추정한다. */
test('audioInputClass — 입력장치 분류 바이트 계약 (§5-1 ③)', () => {
  expect(audioInputClass({ cls: 'earphone', src: 'session_start' }))
    .toBe('audio_input_class:cls=earphone,src=session_start');
  expect(audioInputClass({ cls: 'builtin', src: 'session_start' }))
    .toBe('audio_input_class:cls=builtin,src=session_start');
  // 장치 변경 감지(라벨 실제 전이 시에만 — input_device_changed와 같은 게이트) 경로.
  expect(audioInputClass({ cls: 'earphone', src: 'device_change' }))
    .toBe('audio_input_class:cls=earphone,src=device_change');
  expect(audioInputClass({ cls: 'builtin', src: 'device_change' }))
    .toBe('audio_input_class:cls=builtin,src=device_change');
});

/** §5-1 ④ — 폰트 실렌더값. 실기기 점검 "곡선 3항만 값 변화"를 세 회차째 판정 못 한 공백.
 *  px는 소수 1자리로 반올림한다(부동소수 꼬리가 파서 대조를 깨지 않도록 — beepPlay gain 계보).
 *  `probe`는 그 슬롯이 실렌더 요소가 아니라 **프로브로 해석된 값**임을 남긴다('+' 연결 —
 *  visibilityContext evidence 표기 계보). 계측이 자기 출처를 숨기면 판독이 거짓이 된다. */
test('fontRenderSnapshot — 폰트 실렌더값 바이트 계약 (§5-1 ④)', () => {
  expect(fontRenderSnapshot({
    hero: 64, alarmLabel: 56.0004, alarmValue: 77.96, chipLabel: 46.23, chipValue: 52.26,
    w: 402, h: 874, probe: 'hero+alarmLabel+alarmValue',
  })).toBe('font_render:hero=64,alarmLabel=56,alarmValue=78,chipLabel=46.2,chipValue=52.3,w=402,h=874,probe=hero+alarmLabel+alarmValue');
  // 전 슬롯이 실렌더였다면 probe=none — "프로브가 없었다"도 정보다(0건 이중의미 금지 원칙).
  expect(fontRenderSnapshot({
    hero: 90.13, alarmLabel: 89.2, alarmValue: 124.16, chipLabel: 46.2, chipValue: 52.3,
    w: 640, h: 1024, probe: 'none',
  })).toBe('font_render:hero=90.1,alarmLabel=89.2,alarmValue=124.2,chipLabel=46.2,chipValue=52.3,w=640,h=1024,probe=none');
});

/** §5-1 ② — stt_barge_in의 text가 빈 final 대신 같은 발화의 마지막 interim에서 채워졌다는 마커.
 *  이 마커가 없으면 "final이 원래 그 텍스트였다"와 "interim 폴백이었다"가 로그에서 같아 보인다. */
test('bargeInTextSource — stt_barge_in text 출처 마커 바이트 계약 (§5-1 ②)', () => {
  expect(bargeInTextSource('interim')).toBe('text_src=interim');
});

/* ────────────────────────────────────────────────────────────────────────────
 * v0.45.0 WP-1·WP-2 계측 — [D1] 세션-활성 게이트와 그 판정 축. 리터럴 = SOP-003 파서 계약.
 * ──────────────────────────────────────────────────────────────────────────── */

/** WP-2 — bg_mic 값 공간 확장(additive). 기존 바이트(stopped/restored/noop·off/on/noop)는
 *  위 v043 스펙들이 계속 고정한다 — 여기서는 신규 값만 잰다. */
test('bgMicAction — v0.45.0 신규 값(kept·threshold) 바이트 계약 (WP-2)', () => {
  // 세션-활성 게이트가 유지를 선택했다 — 정지 없음, 계측만.
  expect(bgMicAction({ edge: 'enter', stt: 'kept', capture: 'kept' }))
    .toBe('edge=enter,stt=kept,capture=kept');
  // 장기 임계(10분) 도달 시점의 정지 — dispose라 capture는 off.
  expect(bgMicAction({ edge: 'threshold', stt: 'stopped', capture: 'off' }))
    .toBe('edge=threshold,stt=stopped,capture=off');
  // 유지 사이클의 복귀 — 멈춘 게 없어 복원할 것도 없다(noop이 정상).
  expect(bgMicAction({ edge: 'return', stt: 'noop', capture: 'noop' }))
    .toBe('edge=return,stt=noop,capture=noop');
});

/** WP-1④ — 유지 구간 생존 요약. hidden 사이클당 1건(시계열 금지 — [F5] 링버퍼 보호). */
test('bgKeep — 세션-활성 게이트 유지 구간 생존 요약 바이트 계약 (WP-1④)', () => {
  // bg_s는 초 단위 반올림(foregroundReturn bg_s 계보).
  expect(bgKeep({ backgroundMs: 84_600, finals: 3, stt: 'ctrl', track: 'live' }))
    .toBe('bg_keep:bg_s=85,finals=3,stt=ctrl,track=live');
  // finals=0 + track=ended — "발화가 없었다"가 아니라 "OS가 죽였다"로 읽히는 형태.
  expect(bgKeep({ backgroundMs: 300_000, finals: 0, stt: 'gone', track: 'ended' }))
    .toBe('bg_keep:bg_s=300,finals=0,stt=gone,track=ended');
});

/** WP-2 — 알림 권한·표시 결과. 조건 거짓(no_permission 등)도 기록([FG-RETURN-LOG-1]). */
test('notifyPerm — 알림 권한 요청·임계 표시 결과 바이트 계약 (WP-2)', () => {
  expect(notifyPerm({ src: 'session_start', result: 'granted' }))
    .toBe('notify_perm:src=session_start,result=granted');
  expect(notifyPerm({ src: 'threshold', result: 'no_permission' }))
    .toBe('notify_perm:src=threshold,result=no_permission');
  expect(notifyPerm({ src: 'threshold', result: 'shown' }))
    .toBe('notify_perm:src=threshold,result=shown');
});

/** WP-1① — ready 화면 입출력 프로브. 세션 전(sessionId=__app__)이라 시간축으로 조인한다. */
test('readyProbe — 시작 전 입출력 상태 바이트 계약 (WP-1①)', () => {
  expect(readyProbe({ stt: 'yes', synth: 'idle', voicesKo: 3, mics: 2, perm: 'granted' }))
    .toBe('ready_probe:stt=yes,synth=idle,voicesKo=3,mics=2,perm=granted');
  // 🔴 물림 시그니처 — synth=paused(iOS가 백그라운드에서 얼린 채 복귀).
  expect(readyProbe({ stt: 'yes', synth: 'paused', voicesKo: 0, mics: 'unknown', perm: 'prompt' }))
    .toBe('ready_probe:stt=yes,synth=paused,voicesKo=0,mics=unknown,perm=prompt');
});

/** WP-1② — 확정(에코) 순간 hero 실렌더. px 소수 1자리(fontRenderSnapshot 계보). */
test('fontRenderEcho — 확정 순간 실렌더 바이트 계약 (WP-1② · v0.46.1 넘침 3종 추가)', () => {
  // 🔴 v0.46.1 WP-3(민구 FB-6·7) — `ovX`/`ovY`/`len` 신설. SOP-003 파서가 이 순서를 읽는다.
  //    `ovX > 0` = ellipsis가 실제로 그려짐(민구가 본 `33…`의 직접 증거).
  expect(fontRenderEcho({ hero: 90.1349, w: 402, h: 874, ovX: 0, ovY: 0, len: 4 }))
    .toBe('font_render_echo:hero=90.1,w=402,h=874,ovX=0,ovY=0,len=4');
  expect(fontRenderEcho({ hero: 64, w: 375, h: 812, ovX: 0, ovY: 0, len: 3 }))
    .toBe('font_render_echo:hero=64,w=375,h=812,ovX=0,ovY=0,len=3');
  // 🔑 민구 실기기 시나리오: 402×513에서 정수 2자리(`22.4`)가 가로로 넘친 경우.
  expect(fontRenderEcho({ hero: 167.9, w: 402, h: 513, ovX: 12, ovY: 2, len: 4 }))
    .toBe('font_render_echo:hero=167.9,w=402,h=513,ovX=12,ovY=2,len=4');
});

/** v0.47.0 W7 V-FIX1ⓒ — 홀드 안내 TTS를 큐잉하지 않고 버린 사건.
 *  🔴 이 빌더가 존재하는 것 자체가 계약이다: 종전엔 컴포넌트가 문자열을 인라인으로 썼고,
 *  그건 이 파일 헤더의 *"새 extra는 이 모듈을 경유한다"* 규약 위반이었다(V-FIX6b에서 정리). */
test('holdTtsSkipped — 홀드 안내 스킵 바이트 계약 (W7 V-FIX1ⓒ)', () => {
  expect(holdTtsSkipped('tts_busy')).toBe('hold_tts_skipped:tts_busy');
});

/** 계측 I — 회전이 실제로 일어났는가 + 안내가 실제로 떴는가(별개 사실). */
test('orientationChange — 방향 전환과 가드 표시를 함께 남긴다 (계측 I)', () => {
  // 민구가 눈으로 본 그 화면. 07-29까지 이 이벤트는 0건이었다.
  expect(orientationChange({
    to: 'landscape', guard: 'shown', w: 874, h: 402,
  })).toBe('orientation_change:to=landscape,guard=shown,w=874,h=402');

  expect(orientationChange({
    to: 'portrait', guard: 'hidden', w: 402, h: 874,
  })).toBe('orientation_change:to=portrait,guard=hidden,w=402,h=874');

  // 🔑 "돌렸는데 안내가 안 떴다"도 판정 가능해야 한다 — (pointer: coarse) 게이트가 별도이기 때문.
  expect(orientationChange({
    to: 'landscape', guard: 'hidden', w: 1280, h: 720,
  })).toBe('orientation_change:to=landscape,guard=hidden,w=1280,h=720');
});
