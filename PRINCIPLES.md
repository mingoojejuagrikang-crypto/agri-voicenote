# survey-011 기본 원칙과 철학

이 문서는 survey-011의 설계·구현·리뷰에서 판단 기준이 되는 앱 고유 원칙의 SSOT다.
(팀 공통 개발 원칙은 별도 — 공통 개발 헌장 GL-006이 SSOT이며, 코드 리뷰 시 함께 적용된다.)

## 앱이 무엇인가

농가 현장에서 **한 손·음성으로** 생육조사 값을 기록하는 PWA (React + Vite + TypeScript).
사용자는 장갑을 끼고 야외에서, 폰을 2~3m 떨어진 곳에 두고도 쓴다. 기록된 값은 **실제
프로덕션 구글시트**에 올라가 농가 의사결정에 쓰인다 — 장난감이 아니다.

## 원칙 (우선순위 순)

### 1. 데이터 무결성 최우선
- 측정값은 유실되지도, 오염되지도 않아야 한다. 컬럼ID 매핑·재로그인·상태 레이스로 시트 값이
  틀어지는 결함이 가장 심각한 버그다.
- **확정 전 값은 유출되지 않는다**: 검증 대기(pendingValidation)·보류 중 값이 sync/export에
  확정값으로 새어나가면 안 된다.
- **durable 실패를 삼키지 않는다**: IDB 쓰기 실패·업로드 실패는 화면에 남기고 재시도 경로를
  제공한다. 조용한 catch로 은닉 금지.
- 파괴적 경로(삭제·덮어쓰기)보다 보존 우선: 원본 스냅샷·백업 레코드·tombstone.

### 2. 현장 UX — 한 손, 음성, 원거리
- 음성이 1차 입력이고 터치는 보조다. TTS 안내·에코·비프와 시각 UI는 **의미 동등 + 구조적 분리**다
  (v0.49 개정 — 민구 2026-08-13. 종전 문언은 「글자까지 일치」였다).
  - **의미 동등**: 두 표면은 같은 사실을 말한다. 한쪽만 아는 상태가 있으면 안 된다 —
    화면이 재질문 중인데 귀는 아무 말도 안 듣거나, 수가 서로 다르면 위반이다.
  - **분리를 허용하는 이유**: 사용자는 폰을 2~3m 떨어뜨려 놓고 장갑을 낀 채 일한다. 화면은 자주
    못 보고 귀만 열려 있어서 **긴 TTS는 그대로 대기 시간**이고, [TTS-WATCHDOG-1]에서 긴 발화일수록
    절단률이 단조 증가한다. 반대로 화면은 눈이 갔을 때 정보가 많을수록 낫다.
    민구 원문: *"이번에 TTS와 화면 문구는 일치하지 않을거야. 음성안내를 가능하면 축약해서
    업무 속도를 올리고 싶거든."* → **축약 압력은 귀에만 건다. 화면 상세를 TTS에 맞춰 깎지 마라.**
  - **구조적 분리**: 갈라진 문구는 `src/lib/voicePrompts.ts`에 `*_TTS`/`*_SCREEN` **쌍 상수**로만
    둔다. 콜사이트에 인라인 리터럴을 흩뿌려 가르면 v0.36.0 이전으로 되돌아간다(그때 화면과 TTS가
    조용히 어긋났고 아무도 몰랐다).
- 원거리 판독성(큰 글자·고대비), 44px 터치 타깃, 장갑 조작 가능한 컨트롤.
- STT는 죽지 않아야 한다(탭 전환·백그라운드 복귀·TTS 중 mute 후 재시작 보장). 인식기 사망은
  P0 계열.

### 3. 기능 격리 (활성/비활성 무영향)
- 각 기능은 ① 설정 플래그/env로 on·off 가능 ② 앱 본체와 **단일 배선 지점**으로만 연결
  ③ 꺼짐/실패 시 조용한 no-op(non-fatal). 기능 내부를 다른 기능이 직접 import하지 않는다
  (공유는 lib 순수 모듈로만). 전례: 자동 캡처, 개선요청 탭, 비프음.

### 4. 텔레메트리는 외부 계약
- 로그 이벤트의 `extra` 문자열 형식은 외부 로그 파서(SOP-003)와의 **바이트 계약**이다.
  리팩토링·기능 추가에서 기존 이벤트 문자열은 바이트 불변으로 보존한다.
- 🔴 **「꼬리 확장」은 일반 규칙이 아니다 — 이벤트별 개별 승인이다.** (v0.47.0 · 이중 콜드 리뷰 U4)
  기본값은 위 줄 그대로 **바이트 영구 불변**이다. 예외를 두려면 **그 이벤트에 실소비 파서가
  없다는 실측**(레포·teamops 전수 grep)을 근거로 **건별 승인**을 받고 여기 목록에 적는다.
  - **승인된 예외 ①:** `font_render_echo` — 계약은 「**접두 불변 + 꼬리 확장 허용**」.
    앞 6필드(`hero,w,h,ovX,ovY,len`)의 순서·이름·값 형식은 바이트 불변, 신규 필드는 **맨 뒤에만**,
    소비자는 `$` 앵커가 아니라 **접두 매칭**으로 읽는다. 승인 근거: 08-08 전수 grep에서 실소비
    파서 **0건**(계획·산출물·테스트·producer만 검색됨).
  - **승인된 예외 ②:** `field_nav` · `field_nav_edge` — 계약은 「**접두 + 기존 필드 불변 +
    스코프 출신에만 조건부 꼬리**」. 형태는 `field_nav:<from>-><to>[:<scope>]` ·
    `field_nav_edge:first|last[:<scope>]`이고 `<scope>`는 `reviewWait|atEnd`다. 소비자는
    접두·기존 필드로 읽고 꼬리는 **있으면 읽고 없으면 무시**한다(`$` 앵커 금지).
    승인 근거 둘:
    ⓐ **종전에 방출되던 바이트는 하나도 변하지 않는다.** 꼬리가 붙는 경우(검토 대기·끝 도달
      스코프에서의 항목 이동)는 v0.49 r2 W1 **이전에는 존재하지 않았다** — 그 상태의 이동은
      거부됐다. 즉 기존 로그와의 불연속이 없고, 과거 로그를 문자열로 세는 집계도 안 갈린다.
    ⓑ 08-13 전수 grep(레포 + teamops)에서 실소비 파서 **0건**(producer·테스트 주석·계획/산출물
      문서만 검색됨). SOP-003 매핑표에는 이 이벤트가 없다.
    ⚠️ 이 예외는 **위 두 이벤트에만** 적용된다. 형제인 `field_nav_blocked:<국면>`은 꼬리가
    아니라 값 하나짜리 별개 형태이고, 확장이 필요하면 그때 다시 등재해야 한다.
    (등재 계기: v0.49 r2 리뷰 합집합 A14 = C9 — 꼬리를 **먼저 넣고 등재를 나중에** 한 순서
     자체가 지적 대상이었다. 다음엔 늘리기 전에 여기부터 적는다.)
  - **승인된 예외 ③:** `audio_session`(부팅 1회 프로브) — 계약은 「**접두 + 기존 필드 불변 +
    꼬리 확장 허용**」. 형태는 `audio_session:supported=<y|n>[,state=<s>,type=<t>][,stateReadable=<y|n>]`
    이고, 신규 필드는 **맨 뒤에만** 붙는다. 소비자는 접두·기존 필드로 읽고 꼬리는 있으면 읽고
    없으면 무시한다(`$` 앵커 금지).
    승인 근거:
    ⓐ **종전에 방출되던 바이트는 하나도 변하지 않는다** — `supported`·`state`·`type`의 순서·이름·
      값 형식이 그대로다. 꼬리 `stateReadable`만 추가됐다.
    ⓑ 2026-08-19(r2) 전수 grep(레포 + teamops)에서 실소비 파서 **0건** — producer 1곳
      (`audioInterruption.ts`), 테스트는 **접두 매칭**(`logsStartingWith('audio_session:')`),
      나머지는 산출물 문서 언급뿐이다. SOP-003 매핑표에도 없다.
    🔑 **왜 필요했나**: 이 기기(iOS 26.6)는 `state`를 **못 읽는데**(`DOMAudioSessionFullEnabled`
      미노출) 이벤트는 **발화한다**. 그 둘을 구분할 필드가 없어서 08-19 조사가
      *"`statechange`가 오지 않는다"*로 잘못 결론냈다 — `stateReadable`은 **「값을 못 읽는 것」과
      「이벤트가 안 오는 것」을 영구히 분리**한다.
    ⚠️ 같은 회차에 추가된 `audio_session_evt:n=…`는 **신규 이벤트**라 이 예외와 무관하다.
  - **승인된 예외 ④:** `mic_interrupt_notice` — 계약은 「**접두 불변 + 값 변형 4종**」(v0.51.1 · 2026-09-02 콜드
    리뷰 P2-3). 형태는 `mic_interrupt_notice:lost=<n>,unrel=<a>,fail=<b>`(판정 · 종전 바이트 그대로) ·
    `mic_interrupt_notice:skipped,lost=<n>,unrel=<a>,fail=<b>`(판정 0) · `mic_interrupt_notice:deferred`(유예) ·
    `mic_interrupt_notice:dropped:<reason>`(유예 폐기 · `session_end|unmount`). 소비자는 **`lost=` 토큰 유무로
    먼저 분기**한다 — 있으면 판정(값 3개 · `skipped,` 접두가 붙을 수 있다), 없으면 상태(`deferred`·`dropped:*`).
    `$` 앵커 금지. 종전 방출 바이트(`lost=…`)는 한 글자도 안 바뀐다.
    승인 근거: 2026-09-02 콜드 리뷰 전수 grep(레포 `*.ts/tsx/mjs/js/sh/py/md` + teamops) 실소비 파서 **0건**
    (producer 1곳 · `tests/v051-mic-muted-span.spec.ts` 오라클 · 문서·판독 산출물뿐). 대안(새 이벤트명
    `mic_interrupt_defer:*`)은 「`mic_interrupt:off` 1건당 unmute 시점 정확히 1줄」 판독 불변식을 두 접두로
    쪼개므로 기각. ⚠️ teamops `SOP-003`:249의 「`lost<=0`이면 아무 줄도 안 남긴다」 규칙은 이 등재로 낡는다 —
    머지 뒤 Larry가 갱신(레포 밖).
  - **신규 이벤트 ⑤·⑥(v0.51.1 R6 · 2026-09-02):** `stt_correction` · `stt_confusion_hint` — 둘 다 **`type:'stt'` + `extra` 접두**로
    방출한다(신규 `LogEntry.type` 없음 — log-replay 호환 · `clipsManifest`는 extra가 붙은 stt를 앱 주석으로 보고 건너뛴다).
    형태(바이트 고정 · 빌더 `logEventsStt.ts` · 리터럴 `tests/logEvents.spec.ts`):
    `stt_correction:from=<parsed|->,to=<final>,path=<direct_modify|rerecord|touch|reask|confusion>,text=<escapeExtraValue 24자>,conf=<c|->,alt=<idx|->`
    (값이 정정되는 순간 1건 · 재질문은 거절된 시도마다 1건 · `text`는 그 값을 만든 **원 STT 원문**) ·
    `stt_confusion_hint:heard=<v>,cands=<a|b>,rule=<r1|r2>,asked=<0|1>,chosen=<heard|alt|respoken|->`
    (후보 발동당 **정확히 1건** — 물었으면 답이 정해진 뒤, 상한으로 안 물었으면 그 자리에서 asked=0).
    같은 회차의 `session start` `meta.speaker`(이메일 sha256 앞 8자)는 meta 필드 추가(additive)다.
    ⚠️ `field_nav_blocked:<국면>`에 값 `confusionConfirm`이 **추가**됐다 — 꼬리가 아니라 값 하나짜리 형태의 새 값이다(예외 ②의 주의 그대로).
  - **신규 이벤트 ⑦·⑧(v0.53.0 · 2026-09-17):** `session_health` · `sync_summary` — 둘 다 신규 `LogEntry.type` 없이 기존 `type:'session'` / `type:'app'`의 `extra` 접두로 방출한다(log-replay 호환).
    형태(바이트 고정 · 빌더 `logEventsSession.ts` · 리터럴 `tests/logEvents.spec.ts`):
    `session_health:cells=<n>,reask=<n>,lowconf=<n>,alarm=<fired>/<confirmed>,sttErr=<n>,wakeFail=<n>,authSkip=<n>,corr=<…>,confQ=<asked>/<hit>,modMishear=<n>`
    (세션 종료 `stop()` 시점 persistSession 직후 정확히 1건 · 순수 모듈 `sessionHealth.ts` 집계 · 종료 화면 `session-health-line` 문구 동봉 · 단 새로고침 복원 등으로 트래커 세션 ID 불일치 시 `session_health_skip:reason=restored` 방출 및 화면 요약 생략) ·
    `sync_summary:ok=<report.ok>,failed=<report.failed>,rows=<report.rows>,updated=<report.updatedRows>,fallback=<report.fallbackAppended>`
    (시트 동기화 `syncSelected()` 완료 시점 명시적 `sessionId:'__app__'` 귀속으로 정확히 1건 방출).
  - 목록에 없는 이벤트는 **바이트 불변**이다. 확장이 필요하면 필드를 늘리지 말고 **새 이벤트
    이름**을 써라 — 그게 계약을 안 깨고 늘리는 유일한 길이다.
  - 🔴 **오라클은 「프로덕션이 실제로 방출하는 형상」을 재라.** 확장 필드가 항상 붙는 이벤트를
    두고 «옛 필드만 넘긴 호출»의 바이트를 단언하면, 그 green은 아무것도 보장하지 않는다
    (`font_render_echo`가 그 사례였다 — 프로덕션 이벤트는 전부 꼬리가 붙는데 테스트는
    테스트에만 존재하는 6필드 조합을 재고 있었다). 이건 **모든 이벤트에 적용되는** 규칙이다.
  - 📍 **이 절이 정본이다.** `src/lib/logEvents.ts` 헤더는 여기를 참조만 한다.
- 로그는 실기기 분석의 1차 소스다: 새 동작에는 계측을 동봉하고, 실패도 기록한다
  (숨긴 실패는 다음 분석에서 보이지 않는 버그가 된다).

### 5. 오프라인·미로그인 내성
- 네트워크·토큰은 언제든 죽는다. 큐(재전송)·폴백(과거값 인덱스 IDB 백업)·복구(Drive zip)
  경로를 유지한다. 미로그인이어도 핵심 기능(기록·이상치 알람)은 동작해야 한다.

### 6. 플랫폼 제약 존중 (iOS Safari 우선)
- Blob-in-IDB 금지({buf,type} 분해 저장), localStorage evict 대비 IDB 미러,
  standalone PWA safe-area, 사용자 제스처 밖 getUserMedia 금지.
- **예외(v0.38.0, 민구 확정): 이미 권한이 부여된 세션 안에서의 마이크 재획득.** 현장에서 마이크가
  죽으면 사용자가 알아채고 버튼을 찾기 전에 복구돼야 한다(개선요청 #5). 단 **두 조건이 필수**다 —
  ①`getUserMedia`에 응답 대기 상한(타임아웃)을 둘 것: 보류는 거부보다 위험해서, 결말이 없으면
  복구 가드가 잠긴 채 실패 폴백조차 발화하지 않는다. ②실패 시 **제스처 경로(수동 재연결 배너)로
  반드시 수렴**할 것. 자동 시도는 편의이고, 사용자 제스처가 여전히 정식 복구 경로다.

### 7. 테스트 규약
- 러너는 Playwright 단일(순수함수 단위 테스트도 동일 러너, 새 도구 도입 금지).
- 특성화 테스트는 안전망이다 — 리팩토링 중 테스트를 고치고 싶어지면 동작이 바뀐 것이다
  (중단·보고).
- 회귀 테스트는 실제 버그를 잡아야 한다: 토톨로지·과다 목킹·구현 재기술 금지.
- 픽스처 SSOT: IDB 규약은 tests/fixtures/idb.ts, STT 목은 tests/fixtures/stt.ts.

### 8. 변경 위생
- 동작 불변 리팩토링과 동작 변경을 한 커밋에 섞지 않는다.
- persist 스키마 변경은 마이그레이션과 함께(버전 동결 규칙·다운그레이드 라운드트립 고려).
- 작업 전 **KNOWN-ISSUES의 관련 카테고리와 ID를 검색해** 읽는다. **전체 파일을 매번 컨텍스트에
  넣지 않는다**(1,000줄이 넘는다). 새 함정은 거기 기록한다.
- 코드를 쓰기 전에 `ENGINEERING-GUARDRAILS.md`의 해당 절을 훑는다 — 해결됐지만 다시 어기면
  같은 방식으로 다시 터지는 계약들이다. 문서 지도는 `docs/INDEX.md`.
