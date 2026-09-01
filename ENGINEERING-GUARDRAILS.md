# ENGINEERING-GUARDRAILS — 다시 어기면 안 되는 계약

> **이 문서는 "해결된 문제"가 아니라 "계속 지켜야 하는 규칙"이다.**
>
> 여기 있는 항목은 전부 **실제로 터졌고, 고쳐졌고, 다시 어기면 같은 방식으로 다시 터진다.**
> [KNOWN-ISSUES.md](./KNOWN-ISSUES.md)(지금 열려 있는 문제)와 분리한 이유가 그것이다 —
> 해결됐다는 이유로 아카이브에 묻으면, 다음 사람이 같은 함정을 다시 판다.
>
> **읽는 법:** 전체를 매번 컨텍스트에 넣지 말고, 지금 만지는 영역의 절만 읽어라.
> 코드를 쓰기 **전에** 훑는 것이 이 문서의 용도다.

## 상태 모델 (4상태)

이 프로젝트의 이슈 문서 전체가 쓰는 상태 값이다.

| 상태 | 뜻 | 사는 곳 |
|------|-----|---------|
| `OPEN` | 지금 재현되는 문제 | [KNOWN-ISSUES.md](./KNOWN-ISSUES.md) |
| `MONITORING` | 수정했지만 **실기기 판정 대기** | [KNOWN-ISSUES.md](./KNOWN-ISSUES.md) |
| `GUARDRAIL` | 해결됐지만 다시 어기면 안 되는 계약 | **이 문서** |
| `RESOLVED` | 종결·아카이브 | [KNOWN-ISSUES-ARCHIVE.md](./KNOWN-ISSUES-ARCHIVE.md) |

`MONITORING`을 `RESOLVED`로 올리는 유일한 근거는 **실기기 확인**이다. 데스크톱 테스트 통과는
`MONITORING` 유지 사유이지 종결 사유가 아니다 ([AGENTS.md](./AGENTS.md) 계약 4).

---

## ① 실패를 숨기지 않는다

### [REVIEW-1] 빈 catch가 근본 버그를 수개월 가렸다
- **규칙:** **모든 영속화/네트워크 실패는 로깅한다.** "에러 없음"은 "성공"이 아니다.
  진단 계측(breadcrumb)을 먼저 깔고 실기기 로그로 근본 원인을 확정하라.
- **사건:** 빈 `catch{}`가 iOS 클립 저장 실패를 삼켜 "에러 0건"으로 보이게 했다. 근본 원인
  확정까지 수개월이 걸렸다. 아카이브의 `[CLIP-IDB-1]`(구 `[CLIP-1]`)의 핵심.
- **출처:** `growth-survey-010@c8dd276`, `@fd3177a`
- **관련 원칙:** [PRINCIPLES.md](./PRINCIPLES.md) §1 (durable 실패를 삼키지 않는다), §4 (텔레메트리)

### [REVIEW-4] 진행 멈춤(silent return)은 reprompt로 — 무음 return 금지
- **규칙:** 거부 경로가 **silent return**하면 음성 세션이 그냥 멈춰 사용자가 영문을 모른다.
  거부 시 **reprompt**(다시 안내)로 흐름을 살려라.
- **사건:** `stt_rejected_col_name` 등 거부 경로의 무음 return.
- **출처:** `growth-survey-010@7dd6e8b`(입력-A)
- **당시 상태:** 조상 레포에서 확인·수정. **현재 상태:** survey-011 전체 거부 경로에 대한
  일괄 점검은 아직 수행되지 않았다 — 거부 경로를 새로 추가할 때 이 규칙을 적용하라.

---

## ② 안전 게이트와 파괴적 경로

### [REVIEW-2] adversarial review는 데이터 유실을 잡는다 — 여러 회차 돌려라
- **규칙:** 한 번의 리뷰로 끝내지 마라. 특히 **삭제·업로드·정정 경로**는 반복 검증한다.
- **사건:** Codex adversarial review가 조상 v5.2에서만 **3~5차**에 걸쳐 CRITICAL/HIGH
  데이터 유실·유출을 연속 발견했다(autoDelete 미업로드 삭제, 미동의 데이터 유출, dispose race,
  recorder 오염, partial sync 백업 누락).
- **출처:** `growth-survey-010@a36b4da, @55bb61e, @e207513, @a5950f0, @9a9c004, @8ce8dca, @79cbf2c`(Ultrareview), `@dae3e2f`(gpt-5.5)

### [REVIEW-3] "best-effort"라는 말이 게이트를 같은 날 두 번 뒤집게 했다
- **규칙:** **삭제의 cascade 범위를 먼저 확인**하고, 안전 게이트를 제거하는 변경은 특히 의심하라.
  리뷰 판단 한 줄("백업은 best-effort")을 근거로 게이트를 걷어내지 않는다.
- **사건:** 게이트를 제거했다가 cascade 삭제의 실제 blast radius 때문에 **같은 날 도로 복원**했다.
  아카이브 `[AUTH-1]`의 핵심.
- **출처:** `growth-survey-010@55bb61e → @ad60ba5 → @222f337`

### [CELL-OVERWRITE-1] 🔴 **커서를 값이 든 셀 위에 `kind:'value'`로 세우지 마라**
- **규칙:** 커밋 지점(`sessionStore.setRowValue`)에는 **셀 단위 거절 게이트가 없다** — 값이
  있든 없든 무조건 덮는다(`useVoiceSession.ts`의 `prevValue` 읽기는 **로그용**이지 게이트가
  아니다). 그래서 확정된 측정값을 지키는 **유일한 불변식**이 「`awaitingFieldRef`를 filled 셀에
  `kind:'value'`로 세우지 않는다」이다. `activeColIdx`를 쓰는 코드를 추가할 때는 착지 셀의 값
  유무를 반드시 판정하라 — 정본 헬퍼는 **`announceOrCellWait`** 이고, 값이 있으면
  `enterCellWait`(값 낭독 + 명령 대기 + bare 값 흡수)으로 받는다.
- **사건:** v0.49 F-1이 항목 이동(`gotoAdjacentField`)을 신설하며 인접 인덱스를 값 유무와
  무관하게 썼다 — `activeColIdx` 기록자 중 **처음으로** 그 문을 열었다. 실측 재현: 35.1 커밋 →
  「이전」 → 무심코 "99.9" → **확정 셀이 조용히 99.9로 덮였다.** 같은 라운드에서 파생 경로 3개가
  더 나왔다(행 경계 재안내 `gotoAdjacentRow` · 직접 수정 복귀 `announceField(vc[curIdx])` ·
  interim 조기확정). **하나만 막으면 나머지로 샌다.**
- ⚠️ **`reviewWait`으로 대체하지 마라.** 그쪽은 이동 자체를 거부하는 **행** 상태라, 셀 착지에
  재사용하면 값 있는 셀에 한 번 서는 순간 항목 이동 기능이 통째로 죽는다.
- 🔴 **`announceField`를 부르는 코드는 「그 컬럼이 빈 칸임을 이 함수가 보장하는가」를 답할 수
  있어야 한다.** v0.49 fix49b(max 리뷰)가 잔여 2경로를 더 찾았다 — `goNextRow`의 마지막 행
  경계와 `advance()`의 `returnStack` 소비다. 둘 다 **커서를 세우는 코드가 아니라 남이 세운
  커서를 읽어 재안내하는 코드**였고, F-1 이전에는 기록자 전량이 빈 칸만 가리켰기 때문에 값
  유무를 물을 이유가 없었다. 지금은 물어야 한다(사유는 `[NAV-FILLED-CELL-1]`).
  판정 기준: `firstIncompleteColIdx` 등으로 **방금 계산한** 인덱스면 `announceField`가 맞고,
  `activeColIdx`·`ret.colIdx`처럼 **저장돼 있던** 인덱스면 `announceOrCellWait`이다.
- 🔴 **cellWait에서의 모든 탈출은 cellWait 재진입이다**(fix49b가 세운 통합 불변식). 음성
  「수정 <값>」·bare 「수정」 후 재기록·키패드 재커밋·수동 보류 [확인] — 전부 「그 셀을 고치고
  그 셀의 검토 대기로 돌아온다」. 정본은 `proceedAfterCommit`이며, 그 kind 분기를 우회해
  직접 `advance()`를 부르지 마라.
  ⚠️ **범위는 «정정» 경로다**(v0.49 r3 #7에서 명시). 위 열거 넷은 전부 「그 셀을 고친다」이고,
  「그대로 두고 넘어간다」인 **'유지'(`cmdKeep`)는 예약이 살아 있을 때만** 이 종단을 탄다 —
  예약 없는 cellWait/reviewWait/atEnd의 '유지'는 종전대로 `advance()`로 전진한다(그러지 않으면
  그 상태의 전진 수단이 '다음'뿐이 된다). 경계를 가르는 오라클은
  `tests/v049-r3-07-keep-reservation.spec.ts` **②(대조군)** 이다 — 해석을 뒤집으려면 거기부터 바뀐다.
  🔑 이 각주가 없으면 `cmdKeep`의 bare `advance()`가 **위 문장과 모순된 코드**로 보인다
  (v0.49 r2 A13이 정정한 「같은 라운드 코드와 모순된 주석」과 같은 형태). 잔여 결정(포괄 해석으로
  갈지)은 민구 확정 대기 — `_ASK-fixr3.md` 참조. 사용자가 **의도적으로 이동해 들어온** 검토 문맥을 그 문맥이
  초대한 정정이 파괴하면 안 된다. ⚠️ 같은 이유로 bare 「수정」의 캐스케이드는 이 상태에서
  **그 셀 하나로 좁힌다**(캐스케이드는 행 전체 검토의 계약이다).
- **오라클:** `tests/v049-fix49-cell-guard.spec.ts`(10케이스) — 특히 ①(덮어쓰기 금지)과
  ③(빈 셀은 종전대로 값 수신)이 짝이다. 한쪽만 보면 과잉 차단을 못 잡는다.
  표면 계약은 `tests/v049-fix49b-cellwait-surface.spec.ts`(4)·`-cellwait-alert.spec.ts`.
- **출처:** `2ae8649`(처방) · fix49b 커밋(잔여 2경로 + 표면) ·
  리뷰 `…/2026-08-12-v049-review-claude.md` B-1 · `…/2026-08-12-v049-review-max-findings.json` #2·#3·#4·#7

### [PHASE-NAV-1] 답을 기다리는 국면에서 이동 명령을 통과시키지 마라 — **거부는 두 곳에서 성립한다**
- **규칙:** 이상치 알람 응답 대기(`trendConfirm`)·수정 재청취(`modify`)·소수부 재질문
  (`fractionWhole` 보유)에서 이동 명령을 받으면 **거부 + 한 마디 안내**다(무음 금지 `[REVIEW-4]`).
  🔴 **핸들러 가드만 넣으면 무의미하다** — `voiceFinalResolver`가 `trendConfirm` 중의 「나머지
  명령」을 `trendDemoted:true`로 분류하고, 호출부가 **dispatch 이전에**
  `clearAnomalyAlert('trend_dismissed')`를 부른다. 알람을 보존하려면 resolver에서
  `trendDemoted:false`로 통과시키는 짝 처리가 **함께** 있어야 한다(UI 명령과 같은 모양).
- **사건:** v0.49 F-1의 어휘 재배정으로 「다음」이 *옆 칸 한 칸*이 되어 심리적 비용이 사라졌고,
  미확인 이상치가 그 한 마디로 사라지는 문이 구조적으로 자주 열렸다(실측: `anomaly-alert` 노드
  소멸). `isManualHoldBlocked`가 터치 이동에 대해 막던 우회를 음성이 그대로 열어 둔 형태.
- ⚠️ **행 이동(`prevRow`/`nextRow`)은 이 규칙 밖이다**(민구 결정 2026-08-12) — 종전 의미 유지.
  resolver 특성화의 대조군(nextRow/prevRow는 여전히 강등)이 그 경계를 지킨다.
- 🔴 **그 「짝 처리」의 판정은 명령 선언부에 산다** — `CommandSpec.preservesAlert`
  (`preservesAnomalyAlert()`). v0.49 fix49b 이전엔 resolver 안에 id 리터럴 두 개가 박혀 있어,
  같은 성질의 명령을 추가하는 사람이 **그 줄의 존재를 알 방법이 없었다.** 새 명령이 알람을
  소모하면 안 된다면 선언에 플래그를 달아라. `VOICE_UI_COMMAND_IDS`와는 다른 축이다 —
  그쪽은 "값·행·세션을 아예 안 건드린다", 이쪽은 "건드리지만 그 전에 알람부터 답하게 한다".
- **오라클:** `tests/v049-fix49-phase-guard.spec.ts`(4) + `tests/voiceFinalResolver.spec.ts`
- **출처:** `b9714c1` · 리뷰 같은 문서 M-1·M-2

---

## ③ 문구·값의 조립부는 하나여야 한다

### [UI-ALERT-1] 같은 문구를 두 곳에서 조립하면 "글자까지 동일" 계약은 반드시 깨진다
- **규칙:** **"두 곳에서 같은 문자열을 만든다"가 보이면 그 자체가 결함이다.** 주석으로 계약을
  선언하지 말고 **조립부를 하나로 만들어 물리적으로 불가능하게** 하라. 그리고 계약 위반을 발견한
  테스트가 단언을 느슨하게 바꾸고 있다면, 그건 테스트 수정이 아니라 **결함 승인**이다.
- **사건:** 경보 문구의 시각·청각 일치 계약([PRINCIPLES.md](./PRINCIPLES.md) §2)이 콜론만큼
  어긋나 있었다 — 화면 `범위 알람 : +20%` / TTS·텔레메트리 `범위 알람 +20%`. 화면을 안 보고
  귀로만 듣는 현장에서 "들리는 말"과 "보이는 글"이 달라진다.
- **왜 놓쳤나(핵심):** `AnomalyAlertPopup.tsx`가 **"이 라벨은 alertText와 글자까지 동일해야
  한다"는 주석을 달아놓고, 바로 그 아래에서 문구를 따로 조립**하고 있었다. 계약을 아는 코드가
  계약을 깼다. 더 나쁜 건 회귀 테스트가 이를 잡는 대신 *"문장부호 차이 — 단어는 동일"* 이라는
  주석으로 **위반을 정당화해 고정**한 것이다.
- **수정(v0.39.0):** 조립부를 `src/lib/anomalyAlert.ts`의 `anomalyAlarmLabel()` **하나로 통합**.
  팝업은 같은 페이로드로 그 함수를 호출해 **렌더만** 한다. 콜론만 맞추는 수정은 거부했다 — 두
  조립부가 남아 있는 한 다음 변경에서 또 어긋난다. 화면 == TTS == 로그 `text=` **동등성을 직접
  단언**하는 테스트를 추가했고, SSOT 호출을 옛 자체조립으로 되돌리는 **반증 4건 실패**로
  안전망을 확인했다.
- **⚠️ 텔레메트리 바이트가 바뀌었다:** `trend_alert_fired`의 `text=` 값에 ` : `가 들어간다
  (민구 결정). v0.39.0 **이전 로그와 문자열이 불연속**이므로 과거 로그를 문자열로 매칭하는
  분석은 컷오버를 감안해야 한다. SOP-003 매핑표에는 이 이벤트·필드가 없어 파서는 무영향(확인 완료).
- **출처:** survey-011 v0.39.0, 2026-07-25 (F3 리뷰 라운드 `f3-ui` Codex 지적 #1 — agy Flash는
  오히려 이 변경을 "계약을 바르게 반영한 것"으로 승인했다. **합집합 판정이 아니었으면 통째로
  놓쳤다**).
- **당시 상태:** ✅수정 + 반증 4건 확인. **현재 상태:** v0.39.0 배포 포함.
  **실기기 상태:** ⚠️미확인 — TTS가 `:`를 어떻게 발음/멈춤 처리하는지는 기기 게이트.

### [REVIEW-5] 날짜 컬럼 '오늘' sentinel을 type=date 입력이 덮어쓴다
- **규칙:** `col.auto.value === '오늘'`인 **동적 날짜 sentinel**을 `type=date` 입력에 물리지
  마라. `value !== '오늘'`일 때만 `type=date`를 쓴다.
- **사건:** `type=date`가 sentinel을 표시·편집하지 못해 빈 상태가 되고, 사용자가 날짜를 고르면
  ISO 리터럴로 덮어써 **동적성이 사라졌다.**
- **출처:** `growth-survey-010@2eea438`
- **당시 상태:** 조상 레포에서 확인·수정. **현재 상태:** survey-011의 날짜 컬럼 설정 경로에
  대한 직접 점검은 아직 수행되지 않았다 — 날짜 컬럼 UI를 건드리면 이 규칙을 먼저 확인하라.

### [DATE-LOCAL-1] 사용자에게 보이는 "오늘"은 **로컬**이다 — `toISOString()` 금지
- **규칙:** 화면·세션명·시트에 남는 날짜를 만들 때 `new Date().toISOString().slice(0, 10)`을
  **쓰지 마라.** UTC라 **KST 00:00~08:59에 하루 전날**이 나온다. SSOT는
  `weekTuesday.localTodayIso()`다. 예외는 사람이 안 읽는 축뿐이다(내보내기 파일명·로그 타임스탬프).
- **사건(3회 재발):** ① v0.7.0 — `persistSession`의 `session.date`가 UTC라 새벽 세션이 어제로
  찍혀 「오늘 세션」 매칭에서 사라졌다. ② v0.44.0 §C8 F27/F28 — 날짜 컬럼 기본값·입력값 설정
  스탬프. ③ **v0.49 r5 Z1** — `buildSessionLabel`만 정정을 못 받아, 같은 설정 요약 모달 안에서
  「세션명 2026-08-13」과 「조사일자 오늘 (2026-08-14)」이 갈렸다(실측 08-14 01:3x).
  릴리스 게이트 W3-3·W3-4가 그 시간대에만 red였다(구 [TEST-MIDNIGHT-UTC-1]).
- **🔴 헬퍼만 고치면 반쪽이다:** 세 번째 재발에서 실제로 게이트를 red로 만든 건
  `sessionLabel.ts`의 기본값이 아니라 **호출부**(`useSettingsActions.prospectiveSessionLabel`)였다 —
  호출부가 `isoDate`를 직접 계산해 넘기기 때문이다. 이런 헬퍼를 고칠 땐 **인자를 만들어 넘기는
  호출부 전량을 함께 grep**하라: `grep -rn "toISOString().slice(0, 10)" src`.
- **당시 상태:** ✅수정 + 반증 2축(단위 오라클 red · 게이트 W3-3/W3-4 red) 확인.
- **오라클:** `tests/sessionLabel.spec.ts` 「Z1 — 접두 날짜는 로컬(UTC 금지)」 —
  벽시계에 기대지 않는다(런타임 오프셋에서 갈리는 순간을 역산 + `opts.now` 주입).
  「낮에 돌리면 조용히 통과하는 오라클」은 이 함정에서 특히 위험하다.

### [LANDING-OWNER-1] 착지 국면 전이는 `armLanding` 하나가 소유한다 — 사본을 만들지 마라
- **규칙:** 「착지」(커서가 서서 다음 입력/명령을 기다리기 시작하는 순간)의 리셋 묶음
  — **알람 해제 · 거절 큐 해제 · 수정 표식 해제 · phase(+`endReached`) 전이** — 을 착지 함수 안에
  손으로 적지 마라. `useVoiceSession.armLanding`이 소유한다. 새 착지를 만들면 그 헬퍼를 부르고,
  **`false`면 즉시 return**한다(awaiting·클립·TTS 전부 열지 않는다).
- **사건(한 라운드에 3건):** v0.49 r4의 M4·M8 두 건이 **전부 같은 형태**였다 — 네 착지
  (`announceField`·`enterCellWait`·`enterReviewWait`·`announceEndReached`)가 같은 묶음을 각자
  베껴 갖고 있었고, 사본 하나가 한 줄씩 빠져 있었다. 큐가 남의 셀 위에 얹히고(M4), 값을 여는
  착지가 phase를 안 열어 거절이 **비프만 남고 화면에서 사라졌다**(M8). 고칠 때마다 **다음 사본**이
  같은 자리에서 다시 빠졌다.
- **🔴 평탄화가 아니라 인자화다:** 네 착지는 실제로 다르고 그 차이가 계약이다 —
  목표 phase(active/complete) · `clearAnomalyAlert` 사유(**로그 축**) · 수정 표식 값 ·
  **소수부 재질문 문맥**. 특히 마지막은 「지우는 게 아니라 다시 그린다」이고, 무조건 지우기로
  평탄화하면 M4 오라클은 통과하면서 M3가 닫은 「무고지 합성」(데이터 오염)이 재개 경로로 열린다.
- **🔴 종료·일시정지가 착지를 이긴다:** fixr4가 phase를 **무조건** 쓰게 만들어 잠긴 국면을
  뒤늦은 continuation이 덮게 됐다(codex R4-F2 · claude #2). `stopping`은 착지 **전체**를 거절하고,
  `paused`는 **국면 전이만** 보류한다(전체를 거절하면 `awaiting`이 비어 `resume` 폴스루가
  `[CELL-OVERWRITE-1]`을 새 경로로 재개방한다 — 실측 확인).
  ⚠️ **`endReached`는 phase와 한 쌍이다.** phase 한 줄만 가드하면 짝의 반쪽이 그대로 나가
  같은 형태의 결함이 남는다.
- **⚠️ epoch 재확인과 혼동하지 마라 — 다른 축이다.** epoch는 **barge-in/타 명령** 경쟁을 닫고
  (`await say(...)` 뒤 재무장 지점마다 필요하다), 국면 가드는 **종료·일시정지**를 닫는다.
  실측: 음성 축은 `handleFinal` 파이프라인이 epoch를 올리므로 epoch가 닫고, 국면 가드는 그 위의
  구조적 backstop이다. 둘 중 하나로 다른 하나를 대신할 수 없다.
  🔴 **bump·재확인 지점은 네 파일에 흩어져 있다**([ENV-12] E단계 2026-08-15 분리 이후):
  명령 bump(`if (cmd) epochRef.current++`)와 paused 분기 bump는 `useFinalCommands.ts`,
  barge-in bump는 `useFinalValueGate.ts`, 값 커밋 bump(`++epochRef.current`)는
  `useValueCommit.ts`다. 착지의 재확인(`epochRef.current !== myEpoch`)은 `useCommitLanding.ts`.
  ⚠️ **여기 줄 번호를 다시 적지 마라.** 종전 이 자리에 있던 `:2665`는 참조 시점부터 어긋나
  있었고(2026-08-15 실측: 기준 sha에서 그 줄은 무관한 v0.47.0 주석), 그것이 이 문단이
  파일 앵커로 바뀐 이유다. 찾을 때는 `grep -rn "epochRef.current++\|++epochRef.current" src/lib/`.
- **당시 상태:** ✅수정(v0.49 r5 Z2) + 반증 사다리 3단 실측 —
  ①둘 다 있음 green ②경계 epoch 가드만 제거 → `landing_refused:stopping:*`가 잡는다
  ③둘 다 제거 → `review_wait`가 `stop` 뒤에 찍히고 「입력을 종료합니다.」가 TTS에서 사라진다.
- **오라클:** `tests/v049-r5-z2-landing-guard.spec.ts` (①종료 ②③일시정지 ④소스 계약 ⑤epoch 재확인)

### [DERIVED-FREEZE-1] 이미 기록된 행의 **파생값**은 다시 파생하지 마라 — 시트를 능동으로 덮는다
- **규칙:** `persistSession`은 한 행을 **여러 번** 쓴다(증분 영속화). 자동 컬럼처럼 **스키마·시계에서
  파생되는 값**을 그때마다 다시 계산하면, 기록 시점과 달라진 값이 `buildRow`의 diff를 통해
  `synced → dirty` 강등을 일으키고 **다음 동기화가 프로덕션 시트의 확정 행을 in-place UPDATE**한다.
  기존 행의 자동 컬럼 값은 **승계**하라. 사람이 넣는 컬럼(voice/touch)만 라이브 스토어가 이긴다.
- **사건(v0.49 r5 Z3):** 날짜 컬럼 `'오늘'`이 `autoValue`에서 **호출 시각**의 로컬 날짜로 치환된다.
  자정을 넘긴 세션의 기존 행 전부가 다음 날짜로 다시 쓰이고, 그 diff가 강등을 부른다. 사용자가
  아무것도 안 했는데 시트의 조사일자가 바뀐다 — 농가 의사결정에 쓰이는 표다.
- **🔑 이 결함의 형태를 알아보는 법:** *"쓰기가 멱등한가"* 가 아니라 *"두 번째 쓰기의 **입력**이
  같은가"* 를 물어라. `composeRowValues`는 순수 함수지만 인자(`columns`·시계)가 시간에 따라
  변한다. 「값 저장」 코드에 파생 계산이 섞여 있으면 항상 이 질문을 하라.
- **⚠️ diff 자체를 끄지 마라:** 강등 diff에는 **본래 목적**이 있다(사용자 정정을 다음 sync가
  시트에 밀어넣는다 — F1). 자동 컬럼을 diff에서 빼는 안은 IDB엔 새 값이 남고 시트엔 옛 값이
  남는 **조용한 불일치**를 만든다. 값 자체를 승계해야 IDB·시트·화면이 같이 간다.
- **당시 상태:** ✅수정 + 반증 확인(승계 제거 시 기존 행 날짜가 다음 날로 다시 쓰인다).
- **오라클:** `tests/v049-r5-z3-auto-drift.spec.ts` (①자정 통과 ②과잉 방어 반증)
- **관련:** [KNOWN-ISSUES.md](./KNOWN-ISSUES.md) `[AUTO-DRIFT-OVERWRITE-1]`(실측으로 갈린 두 축) ·
  `[AUTOVALUE-SPAN-MIGRATION-1]`(재개 세션의 남은 마이그레이션 축)

---

## ④ 가시성·레이아웃 판정

### [UI-GLOW-1] `position:fixed`에 `offsetParent === null` 가시성 판정을 쓰면 상시 오탐
- **규칙:** 가시성 판정에 `offsetParent`를 쓰는 코드는 **대상이 fixed로 바뀌는 순간 조용히
  망가진다.** `el.getClientRects().length === 0`을 써라 — `display:none`(또는 조상 none)이면
  박스가 생성되지 않아 0개, **보이는 fixed면 1개 이상**이라 두 경우를 정확히 가른다.
  비용은 동일한 레이아웃 읽기 1회다.
- **더 넓은 규칙:** 레이아웃 방식 변경(absolute→fixed)은 **원격에 있는 판정 로직을 함께
  깨뜨릴 수 있다.** 포지셔닝을 바꿀 때 그 엘리먼트를 관찰하는 코드를 같이 찾아라.
- **사건:** 목소리에 반응하는 테두리 글로우(`EdgeGlow`)가 **0.5초 살고 0.5초 죽는** 주기로
  끊겼다. `useAudioLevelVar`가 keep-alive `display:none`(탭 이탈)을 감지하려고 30프레임마다
  `el.offsetParent === null`을 봤는데, **HTML 스펙상 `position:fixed`는 보이는 상태에서도
  `offsetParent`가 항상 null**이다. v0.37.0에서 `EdgeGlow`를 full-bleed(`position:fixed`)로
  바꾸면서 판정이 상시 오탐이 됐다 → 30프레임마다 `--voice-level`을 0으로 쓰고 500ms 정지.
- **놓친 경위:** e2e `v034-wave-glow` B7·B8 2건이 v0.38.0에서 **이미 실패 중이었고 그 상태로
  릴리스됐다.**
- **수정(v0.38.1):** `getClientRects()` 판정으로 교체. 회귀 `v034-wave-glow` 21/21 통과.
- **출처:** survey-011 v0.38.1, 2026-07-24
- **현재 상태:** v0.38.1 포함, 회귀 통과.

---

## ⑤ 오디오 클립 트림

두 항목 모두 `src/lib/audioTrim.ts`의 같은 검출부를 건드린다. **여기를 수정하려면 둘 다 읽어라.**

### [CLIP-MIDSPEECH-1] 트림이 발화 *중간*을 잘라 이어붙이면 사람이 값을 못 알아듣는다
- **규칙:** `buildKeptRanges`는 **모든 세그먼트를 감싸는 단일 포괄 범위**를 반환한다
  (`[max(0,min(start)−PAD_FRONT), min(len,max(end)+PAD_BACK)]`). 세그먼트 사이를 이어붙이는
  `concatRanges` 경로로 되돌리지 마라 — **발화 중간의 자연스러운 멈춤(선언↔값, 호흡)이 잘린다.**
- **사각지대 교훈:** STT 재인식은 갭 제거에 강건해서 **자동 하니스가 이 결함을 통과시켰다.**
  사람 청취 품질은 기계 재인식으로 대체 검증되지 않는다.
- **사건(v0.20.0 실기기 2세션, 2026-06-25):** 민구 "인식값은 정상인데 음성클립을 들으면 값을
  알 수 없음." 코드 시뮬 + raw 클립 72개 분석: `concatRanges`가 세그먼트 사이 150ms↑ 무음을
  "긴 공백"으로 보고 제거 → **72클립 중 15개(21%)에서 발화 중간을 splice**.
- **영향:** 데이터 무결성 무관(라이브 STT 정답, CSV 일치). 클립 감사·재청취 품질 문제.
- **수정(v0.21.0):** 단일 포괄 범위로 통합 → splice 0, 중간 무음 보존, 앞 침묵/TTS·뒤 EOS
  꼬리 가장자리 트림만 유지. `concatRanges`/`findSpeechSegments`는 휴면 폴백으로 잔존.
  KEEP_RATIO·MIN_KEPT_MS 가드 불변. 회귀 `tests/audioTrim.spec.ts`.
- **출처:** `2026-06-25 v0.20.0 2세션 분석` → survey-011 v0.21.0
- **현재 상태:** v0.21.0 포함. **실기기 상태:** ✅확인됨 — [CLIP-BLANK-2]의 v0.24.0 실기기
  측정에서 값 잘림 회귀 0건으로 함께 확인됐다.
- **연관:** [CLIP-9](decode-fail 계측)·[CLIP-10](첫값 truncation, 별개 메커니즘) — 둘 다
  [KNOWN-ISSUES.md](./KNOWN-ISSUES.md).

### [CLIP-BLANK-2] 약한 초반 세그먼트 하나가 트림 시작을 값 발화보다 한참 앞으로 끌어당긴다
- **규칙:** `findSpeechSegments`의 **약한 세그먼트 솎기**(`SEG_KEEP_RATIO = 0.25`)를 제거하지
  마라. 세그먼트별 내부 최대 RMS를 추적해, 가장 강한 세그먼트 대비 25% 미만의 약한 세그먼트를
  버린다(2개 이상일 때만, 전부 약하면 원본 유지). **0.25는 287클립 스윕으로 결정된 값**이다 —
  0.3 이상은 값 잘림을 6건 이상 유발했다.
- **사건(v0.23.0 실기기, 2026-06-29):** "일부 클립 전단에 공백이 너무 길다." 8개 세션 **287
  클립** 정량 분석: **51/287(18%)** 가 앞에 0.6s↑ 공백, 최악 **10.8s**.
- **원인:** `thr = robustPeak(97pct) * 0.08`이 **조용한/노이즈 클립에서 노이즈 수준으로 붕괴**
  (예 peak 0.023) → 초반 잡음·TTS 잔향이 약한 세그먼트로 검출되고, `buildKeptRanges`가
  `min(seg.start)`로 앵커하므로 트림 시작이 앞으로 끌려갔다.
- **수정(v0.24.0):** 약한 세그먼트 솎기 도입. 효과: 앞 공백 사례 **63→16건, 값 잘림 0건**.
  회귀는 별도 하네스 `clip-regression`이 실제 `audioTrim`에 누적 raw 클립을 돌려 RED→GREEN·
  known-good 비퇴행을 고정한다.
- **출처:** `2026-06-29 v0.23.0 실기기 제보` + 287클립 분석 → survey-011 v0.24.0
- **현재 상태:** v0.24.0 포함.
  **실기기 상태:** ✅**확인됨(2026-06-30 v0.24.0 2세션 측정)** — 값클립 71개 silencedetect
  결과 앞공백 **max 0.31/0.32s, 0/71 ≥ 0.6s**(v0.21+ 18%·최악 10.8s 대비 소멸), 잔여 ~0.30s는
  의도한 `PAD_FRONT`. **값 잘림 회귀 0**(`clip_trim_failed` 0/0).

---

## ⑥ 테스트 계약

### [TEST-UI-1] 테스트는 시각 장식이 아니라 `data-testid` 계약에 붙인다
- **규칙:** UI 상태에는 **안정적인 테스트 계약**을 둔다. 활성 화면 `data-testid="voice-active-state"`,
  활성 행 `data-testid="active-row"`, 칩 `data-testid="column-chip"` + `data-active="true"` +
  `data-col-name="<컬럼명>"`, 칩 구역 `data-testid="voice-chip-grid"`.
  **`REC` 텍스트·`▶` 아이콘 같은 임시 시각 표현에 결합하지 마라.**
- **레이아웃 스펙에도 적용:** 요소 **탐색**은 반드시 testid 계약으로 하고, **계산 스타일은
  단언(assert) 대상으로만** 쓴다.
- **사건 1(v0.31.0):** 입력탭 UI 정리로 `REC`·`▶`를 제거하자, `document.querySelectorAll('span')`
  에서 `▶`를 찾아 활성 칩을 판별하던 helper가 깨졌다. `v54-30rows` 장기 테스트가 행마다 3초씩
  누적 대기해 3분 타임아웃.
- **사건 2(재발 변형, 2026-07-20 v0.36.0):** `v019-active-layout`/`v020-dials-layout`이 칩 구역을
  셀렉터가 아니라 **계산 스타일 탐색**(`display:grid && overflowY:auto`인 div 검색)으로 잡고
  있었다. 칩 구역이 grid → flex-wrap pill 플로우로 바뀌자 탐색이 null을 반환하며 실패.
  두 스펙 모두 `data-testid="voice-chip-grid"`로 교체해 해결.
- **출처:** `2026-07-08 v0.31.0 입력탭 UI 재정리`(커밋 `bbf6a1e`), `2026-07-20 v0.36.0 재작업`
- **현재 상태:** 수정 완료. **새 입력탭 테스트를 작성할 때마다 계속 준수해야 한다.**

### [ENV-4] 문서의 테스트 명령은 package scripts를 가리킨다
- **규칙:** 개발 문서는 **내부 파일을 직접 실행하는 명령을 박아두지 않는다.** 실행 방법의
  SSOT는 `package.json`의 npm scripts다(`npm run test:e2e`, `npm run lint`, `npm run build`,
  `npm run predeploy`). 그래야 실행 방식이 바뀔 때 문서를 여러 곳에서 고치지 않는다.
- **사건:** 문서는 `npx tsx scripts/test-*.mjs`를 안내했는데 실제 회귀는 Playwright였다.
  두 수동 스크립트는 이미 제거된 옛 명령 별칭(`정정`·`스톱` 등)을 계속 검사하고 있어 **현재
  정책과도 충돌**했고, 파일 주석은 `node scripts/...`, README는 `npx tsx`로 서로 달랐다.
- **수정(v0.39.0 문서 정리):** `scripts/test-koreanNum.mjs`·`scripts/test-autoValue.mjs` 삭제
  (`tests/koreanNum.spec.ts`·`tests/autoValue.spec.ts`가 완전 대체). 문서의 테스트 절차는
  [CONTRIBUTING.md](./CONTRIBUTING.md)로 단일화. `scripts/test-sheets-url.mjs`는 당시 대체
  스펙이 없어 존치했다가, v0.49 R1(2026-08-14)에서 민구 승인(knip 판정표 §5 상속 유물)으로
  삭제했다 — 수동 스크립트는 이제 0개다.
- **출처:** `2026-06-04~05 세션` → 정리 `2026-07-26`
- **현재 상태:** 해소. 새 개발 문서를 쓸 때 이 규칙을 유지하라.

### [UI-FIT-ALIGN-1] fit 컨테이너의 정렬이 넘침을 **위**로 보내면 높이 판정이 통째로 죽는다
- **규칙:** `useFitGroup`의 fit 컨테이너에 **넘침을 block-start 방향으로 보내는 정렬**을
  주지 마라(`align-items: flex-end`, `justify-content: flex-end` + column 등).
  하단 정렬이 필요하면 **자식의 `margin-top: auto`**로 만든다 — auto 여백은 남는 공간이
  **양수일 때만** 분배되므로 ⓐ여유가 있으면 하단 정렬이고 ⓑ넘치면 0이 되어 넘침이
  **아래로** 간다.
- **왜:** 판정이 컨테이너의 `scrollHeight > clientHeight`이기 때문이다
  (`fitGroup.ts` §`overflowsHeight`). block-start 방향 오버플로는 **스크롤 영역에 잡히지
  않아** `scrollHeight === clientHeight`가 되고, fit은 "맞는다"고 읽어 배율을 **1 위로**
  밀어올린다. 폭 판정도 `word-break: break-all`이면 줄바꿈되어 항상 통과하므로,
  **두 판정이 동시에 무력화되면 배율이 폭주한다.**
- **사건(FB-11, 2026-08-07 레인 V 실측):** `ManualValueSheet`의 값 표시 zone이
  `align-items: flex-end`였다. `zOvY=0`(넘침 미검출)인 채 `--fit-sheet=3.6028`까지 올라가
  폰트가 128.64px → **463.5px**, 높이 111px zone 밖으로 **`outTop=1148.3px`**.
  화면에는 `311575.25` 중 **`25`만** 보였고 잘렸다는 표시조차 없었다 —
  고치려던 `311…`보다 나쁜 상태였다.
- 🔴 **`fitGroup.ts:44`가 *폭*에 대해 적어둔 교훈이 높이에는 아직 적용돼 있지 않다**
  (*"inline-start 오버플로는 스크롤 불가 영역이라 `scrollWidth`에 잡히지 않는다"* →
  폭은 잉크 경계로 바꿨다). 같은 파일 `overflowsHeight` 주석이 *"§A2에서 보류했다"*고 밝힌다.
  **근본 처방은 높이도 잉크 경계로 재는 것이고, 아직 안 됐다.**
- **오라클:** `tests/v0461-fb11-manual-display.spec.ts`(402×513, 28.5s). 정렬을 되돌리면
  `outTop`이 1000px대로 뛰어 red가 된다(반증 확인 완료).
  🔴 **판정축 주의 — `textOverflow`·`scrollWidth`로 재지 마라.** 줄바꿈이 걸린 표시에서는
  둘 다 **공허하게 통과한다**(실측 18행 전부 통과하면서 값은 사라지고 있었다).
  정본은 **컨테이너 대비 rect 차이**(`out*`)다.
- **같은 계열:** [UI-FLEX-FIT-1](./KNOWN-ISSUES.md)(flex 자식의 `overflow:hidden`이 같은
  판정을 무력화). **fit 높이 판정은 이 레포에서 두 번 다른 옷을 입고 나타났다.**
- **현재 상태:** 수정 완료(`672e4cf`·`53f543e`). 🔴 **실기기 미확인 — `MONITORING`.**

### [UI-FIT-ALIGN-2] 정렬을 바꿀 때는 그 컨테이너의 **모든** 자식을 세라
- **규칙:** fit 컨테이너의 `align-items`를 바꾸면, 그 안의 **조건부 분기까지 포함해** 자식을
  전부 세고 각각에 대응(예: `margin-top: auto`)을 넣어라.
- **사건:** 위 [UI-FIT-ALIGN-1] 처방에서 `ManualValueSheet`의 **비키패드 분기**(키패드가
  아닐 때 현재값을 그리는 `div` — text·date·options 컬럼)에 `margin-top: auto`를 빠뜨렸다.
  짧은 요소라 free space가 항상 양수 → **하단 정렬이던 것이 상단으로 올라갔다.**
- 🔴 **왜 실측이 못 잡았나 — `fixtures/activeZones.ts`의 컬럼이 전부 `float`이다.**
  18행 실측이 그 분기를 렌더조차 하지 않았다. **컬럼 타입을 가정한 셈**이고, 이는
  [PRINCIPLES.md](./PRINCIPLES.md)의 시트 불특정 계약(민구 08-05: *"하나의 시트를 기준으로
  정하진 말아줘"*)이 정확히 금지하는 사각이다.
- **다음 사람에게:** 이 픽스처로 **레이아웃**을 재는 스펙은 `float` 외 타입을 밟지 못한다.
  타입 분기가 있는 화면을 검증한다면 **픽스처에 타입을 섞어라.**
- **현재 상태:** 수정 완료(`53f543e`). 픽스처 타입 다양화는 **미수행 — 다음 회차 과제.**

---

## 참고

- 앱 고유 설계 원칙: [PRINCIPLES.md](./PRINCIPLES.md)
- 지금 열려 있는 문제: [KNOWN-ISSUES.md](./KNOWN-ISSUES.md)
- 종결된 사건 기록(역사): [KNOWN-ISSUES-ARCHIVE.md](./KNOWN-ISSUES-ARCHIVE.md)
- 개발·테스트·릴리스 절차: [CONTRIBUTING.md](./CONTRIBUTING.md)

### [CLIP-MUTED-SPAN-1] 🔴 `muted`는 **실패가 아니라 판정 보류**다 — 어느 쪽으로 세도 결함이 된다

- **계약(세 줄):**
  ① `isStreamLost()`의 판정을 바꾸지 마라 — `ended`만 사망이다. `muted`를 사망으로 승격시키면
     **멀쩡한 마이크에 재연결 배너**가 뜬다(통화·Siri는 unmute 대기가 옳다).
  ② muted 구간 클립을 `clipHealth.recordFailure()`로 세지 마라 — 연속 카운터가 임계에 닿아
     `micLost`가 서고, 그 래치가 자동 재연결 effect를 깨워 **destructive-first `recoverStream`**을
     제스처 밖에서 부른다(v0.22.0 P0 재개방 · [IOS-5]).
  ③ `recordSaved()`로도 세지 마라 — **집계가 무음을 성공이라고 말하고**, 연속 카운터까지
     리셋해 진짜 사망 구간의 래치를 늦춘다. 그게 2026-09-01 B축의 기전이다.
- **그래서 칸이 셋이다:** `saved` / `failed` / **`unreliable`**. 셋째 칸은 `streak`를 증가도
  리셋도 하지 않는다 — **아무 쪽으로도 세지 않는 것**이 「판정 보류」의 구현이다.
- **왜 반복해서 틀리나:** 이 자리는 *"muted면 마이크가 죽은 거 아닌가"* 라는 직관과 정면으로
  어긋난다. 2026-09-01 회차 종합 초판도 *"`isStreamLost()`가 muted를 반영하게"* 라고 적었다가
  철회했다. 🔑 **두 판정은 축이 다르다** — 「스트림이 죽었나」(복구가 필요한가)와
  「이 클립을 증거로 쓸 수 있나」(신뢰도). 소비자도 다르다(재연결 배너 vs 저장·집계).
- **종료 시점 스냅샷으로 구간을 판정하지 마라.** `clip_duration`의 `trackState`는 `onstop`
  순간의 값이라 `mute→(클립 전체)→unmute`를 `live`로 기록한다. 구간은 **래치**로만 잡힌다.
- **오라클:** `tests/v051-mic-muted-span.spec.ts` — 모든 muted 케이스가 `expectNoRecoveryPath()`로
  ①②를 동봉 단언한다. muted를 failed로 세는 순간 `mic_lost:clip_muted`가 관측돼 red다(실측).
