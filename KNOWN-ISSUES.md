# KNOWN-ISSUES — survey-011 함정 지식베이스

> **목적:** 다른 AI(그리고 사람)가 **같은 실수를 반복하지 않도록** 한다. 이 앱(노지감귤 음성 생육조사 PWA)과 그 조상 프로젝트(`growth-survey-010`)에서 실제로 터졌던 버그·함정을 사실 기반·출처 명시로 수확해 모은 살아있는 로그다.
>
> **사용법:** ⚠️ **이 파일 전체를 컨텍스트에 넣지 마라.** 지금 만지는 영역의 **카테고리와 ID만 검색해서** 읽어라(①음성/STT ②클립·IDB ③iOS/TTS ④정정·race ⑤빌드·테스트 ⑥인증·Drive ⑧입력흐름 ⑨테스트 함정). 새 함정을 만나면 같은 형식으로 **append**하고, 기존 항목의 재발이면 해당 항목의 출처에 hash/세션을 덧붙여 병합하라. 추측은 본문에 쓰지 말고 맨 끝 **"확인 필요(미검증)"** 목록에 분리하라.
>
> **이 파일에 무엇이 사는가 (4상태 모델):**
>
> | 상태 | 뜻 | 사는 곳 |
> |------|-----|---------|
> | `OPEN` | 지금 재현되는 문제 | **이 파일** |
> | `MONITORING` | 수정했지만 **실기기 판정 대기** | **이 파일** |
> | `GUARDRAIL` | 해결됐지만 다시 어기면 안 되는 계약 | [ENGINEERING-GUARDRAILS.md](./ENGINEERING-GUARDRAILS.md) |
> | `RESOLVED` | 종결·아카이브 | [KNOWN-ISSUES-ARCHIVE.md](./KNOWN-ISSUES-ARCHIVE.md) |
>
> `MONITORING` → `RESOLVED` 승격의 유일한 근거는 **실기기 확인**이다. 데스크톱 테스트 통과는
> `MONITORING` 유지 사유이지 종결 사유가 아니다.
>
> **상태 표기 규약 — 사건 당시와 현재를 반드시 분리한다:**
> ```
> - **당시 상태(YYYY-MM-DD):** 사건·수정 시점의 사실 (예: "브랜치, 미배포")
> - **현재 상태:** 지금의 사실 (예: "v0.38.0에 포함되어 배포됨, 현재 앱 v0.39.0")
> - **실기기 상태:** ✅확인됨 / ⚠️미확인 / ➖해당없음
> ```
> 한 줄에 뭉뚱그리면 시간이 지나 **AI가 "아직 배포 안 됐다"로 오해**한다(실제로 v0.38.0 항목들이
> v0.39.0 시점까지 "미배포"로 읽혔다). 세부 아이콘 범례: ✅수정됨 | ⚠️주시·미확인 | ➖해당없음 | 🔲미구현.
>
> **출처 표기 규약:**
> - `growth-survey-010@<short-hash>` — 조상 레포 git 커밋.
> - `growth-survey-010 vX.Y.Z` / `survey-011 vX.Y.Z` — **반드시 레포를 명시**한다. 두 레포의 버전 라인이 다르다(조상은 v0.12.0까지, survey-011은 자체 v0.3.0 라인).
> - **레포 안에 있는 파일은 실제 상대 링크로 걸어라**(예: `src/lib/audioTrim.ts`). 낡기 쉬운 줄 번호보다 **함수·테스트 이름**으로 지칭한다.
> - **레포 밖 근거는 추가 출처로만 쓴다.** 핵심 결론과 재현 절차는 반드시 이 레포 안에 남긴다 — 레포만 클론한 에이전트는 아래 경로를 열 수 없다:
>   - `debug-log` — `citrus-growth-survey-codex/shared/debug-log.md` *(external/private)*
>   - `Deliverables/...` 날짜별 분석 문서 — myPKA 볼트 *(external/private)*
>   - `survey-011-test-harness` — 별도 하니스 레포 *(external/private)*

---

## 아카이브로 이동된 항목

종결(✅해결·반증·비버그·환경 제약 종결) 항목은 본문에서 [KNOWN-ISSUES-ARCHIVE.md](./KNOWN-ISSUES-ARCHIVE.md)로 이동했다. 아래 [ID]가 본문에 없으면 아카이브에서 찾아라.

> **ID 고유화(2026-07-26):** 서로 다른 두 문제가 `[CLIP-1]`을 함께 쓰고 있어 검색·자동 링크가
> 불가능했다. 고유 ID로 분리하고 옛 ID는 `aliases:`로 남겨 과거 커밋·문서 검색을 유지한다.

- [STT-1] 200대 한국어 자리값 수사 오인식 ("이백" → 100) → KNOWN-ISSUES-ARCHIVE.md
- [STT-13] iOS Safari Web Speech가 confidence를 비워 반환 → 코드의 `?? 1` 강제변환으로 인식 허용범위 게이트 무력화 → KNOWN-ISSUES-ARCHIVE.md
- [CLIP-IDB-1] iOS Safari에서 음성 클립이 IDB에 저장 안 됨 (근본 버그) — 구 `CLIP-1` → [KNOWN-ISSUES-ARCHIVE.md](./KNOWN-ISSUES-ARCHIVE.md)
- [CLIP-PERSIST-KEY-1] persistSession 타이밍 탓 클립 키 누락 — 구 `CLIP-2` → [KNOWN-ISSUES-ARCHIVE.md](./KNOWN-ISSUES-ARCHIVE.md)
- [CLIP-EPOCH-1] stale-epoch 클립이 올바른 클립을 덮어씀 — 구 `CLIP-3` → [KNOWN-ISSUES-ARCHIVE.md](./KNOWN-ISSUES-ARCHIVE.md)
- [CLIP-4] AudioRecorder 인스턴스 간 상태 오염 → KNOWN-ISSUES-ARCHIVE.md
- [CLIP-7] Logger 이벤트가 reload 후 소실 (메모리 전용) → KNOWN-ISSUES-ARCHIVE.md
- [LOAD-1] 앱 업데이트 후 "세션이 사라짐" — 실제론 App.tsx 빈 catch가 hydrate 실패를 삼킴 → KNOWN-ISSUES-ARCHIVE.md
- [IOS-1] iOS Safari SpeechSynthesis `onend` 미발생 → advance() 무기한 대기 → KNOWN-ISSUES-ARCHIVE.md
- [IOS-2] TTS watchdog 상태머신 mute/unmute 불일치 → KNOWN-ISSUES-ARCHIVE.md
- [IOS-3] TTS 재생 중 STT가 자기 음성을 phantom 입력으로 잡음 → KNOWN-ISSUES-ARCHIVE.md
- [RACE-1] 정정/명령 후 진행 멈춤 race condition (핵심) → KNOWN-ISSUES-ARCHIVE.md
- [RACE-2] STT 결과가 이전 행에 저장됨 (행 전환 가드 누락) → KNOWN-ISSUES-ARCHIVE.md
- [ALERT-1] 이상치 정정 재측정 시 팝업과 echo TTS 불일치 — 정정 경로가 팝업을 갱신 안 함 → KNOWN-ISSUES-ARCHIVE.md
- [RACE-4] 정정 시 오인식 원본 오디오 유실 → 분석 불가 → KNOWN-ISSUES-ARCHIVE.md
- [RACE-5] 동기화: 업로드 실패 세션을 autoDelete가 삭제 (데이터 손실) → KNOWN-ISSUES-ARCHIVE.md
- [RACE-7] 일시정지(Pause) 상태에서 화면 전환 시 sessionIdRef가 초기화되어 빈 ID 및 startedAt: NaN이 DB에 영속화됨 → KNOWN-ISSUES-ARCHIVE.md
- [CLIP-MODIFY-1] direct modify("수정 <값>") 시 수정한 셀의 음성 클립/재생버튼이 사라짐 — 구 `CLIP-1` → [KNOWN-ISSUES-ARCHIVE.md](./KNOWN-ISSUES-ARCHIVE.md)
- [CLIP-VAL-1] 수정 재녹음 중 빈 캡처 → 이전 값 음성이 새 값 셀의 재생버튼으로 남음 (3중 결함) → KNOWN-ISSUES-ARCHIVE.md
- [ENV-3] 버전 테스트 하드코딩 → 버전 bump 시 실패 → KNOWN-ISSUES-ARCHIVE.md
- [ENV-9] settings persist migrate가 시드 trendRule을 삼킴 — Playwright 시드는 최신 version으로 → KNOWN-ISSUES-ARCHIVE.md
- [ENV-5] "세션 리플레이" 클립이 실제론 오디오 전용 (영상 트랙 0) → KNOWN-ISSUES-ARCHIVE.md
- [ENV-6] vite-plugin-pwa peer-dependency 충돌 (조상 초기) → KNOWN-ISSUES-ARCHIVE.md
- [ENV-7] gh-pages 배포 — workflow scope 토큰 거부 → KNOWN-ISSUES-ARCHIVE.md
- [AUTH-1] 백업 실패 시 자동삭제 게이트 — 추가→제거→복원 (같은 날 뒤집힘, 핵심 교훈) → KNOWN-ISSUES-ARCHIVE.md
- [AUTH-2] 미동의 세션 오디오/이벤트 데이터 유출 → KNOWN-ISSUES-ARCHIVE.md
- [NAV-1] "다음" 건너뛰기 후 완료된 행으로 반복 복귀하는 루프 → KNOWN-ISSUES-ARCHIVE.md
- [SESSION-LABEL-OPTIONS-1] 세션명 디폴트가 단일선택 옵션 상수를 누락 → KNOWN-ISSUES-ARCHIVE.md
- [LASTROW-AUTOEND-1] 마지막 행 입력 시 자동 종료로 수정 불가 (v0.23.0 변경) → KNOWN-ISSUES-ARCHIVE.md

---

## ① 음성 / STT 파서

### [STT-2] 후치 수정 명령 미감지 ("178.1 정정")
- **증상:** "178.1 정정"처럼 값이 앞, 명령어가 뒤에 오는 발화를 수정 명령으로 인식 못 함.
- **원인:** `detectCommand`가 prefix 패턴만 매칭.
- **해결·회피:** `detectCommand`에 suffix 매칭 추가하되 **숫자로 시작하는 경우만** 적용(오탐 방지), `extractModifyValue`가 prefix/suffix 모두 지원. 단위 43케이스 추가.
- **출처:** `growth-survey-010@a954e05`
- **현재 상태:** ⚠️주시 — **의식적 변경(v0.4.0):** 명령어 단일화로 별칭 `정정` 제거. 후치 정정은 이제 `"178.1 수정"`만 인식(`detectCommand`/`extractModifyValue`). 후치 매칭 자체는 유지되므로 [STT-2] 본 동작은 보존, 단 트리거 단어가 `수정`으로 한정됨. (회귀 `tests/koreanNum.spec.ts`)

### [STT-3] 한국어 노이즈 단어 오인식 (변경/성경/광경 등)
- **증상:** 빗소리·환경음이 `변경`, `성경`, `광경`, `구정`, `혜정`, `당장`, `경정` 같은 단어로 오인식되어 값/명령으로 처리됨.
- **원인:** 짧은 환경 노이즈가 그럴듯한 한국어 단어로 STT됨. 거부 경로 간 일관성 부족(노이즈 거부 시 인식 표시가 안 지워짐).
- **해결·회피:** `KNOWN_NOISE` 정규식 필터로 해당 단어 거부 + 거부 시 `setRecognized('')`로 다른 거부 경로와 UX 일관성 유지. 소음 모드 토글(임계값 0.65→0.80, 1글자 거부)도 도입.
- **출처:** `growth-survey-010@2ed62a5`(F010 노이즈 필터), `growth-survey-010@dcaafea`(소음 모드), `growth-survey-010@79cbf2c`(거부 UX 일관성)
- **현재 상태:** ✅수정됨 (`src/lib/useVoiceSession.ts` `KNOWN_NOISE`)
- **⚠️ 후속(v0.19.0, 소음 환경 모드 제거 — 민구 결정):** 민구 판단(TTS가 인식값을 되읽어 줘 오인식 즉시 식별·소음모드가 오히려 입력 방해) → `noisyMode` 토글·필드·STT 소비처 전부 제거. **부작용:** STT 거부 임계값이 항상 `0.65`로 통일(소음모드의 0.80 상향 + 1글자 거부 방어선 소멸). `KNOWN_NOISE` 필터 + lone-syllable 동음이의 가드(noisyMode 독립)는 **보존**. **주시:** 다음 *실소음(비닐하우스·우천)* 로그에서 garbage-commit/환각단어 커밋률을 관측 — 0.65 통일로 환각 커밋이 늘면 재검토(합성 자가테스트론 노출 불가, 실소음 로그 필요).

### [STT-4] 컬럼명과 같은 STT 값 거부가 text/options 컬럼까지 차단
- **증상:** STT 값이 컬럼명과 일치하면 거부하는 가드가 text/options(자유서술·선택) 컬럼에서도 발동해 정당한 입력을 막음.
- **원인:** 컬럼명 일치 거부 규칙을 모든 타입에 일괄 적용.
- **해결·회피:** 컬럼명 일치 거부를 **숫자·날짜 컬럼에만** 적용, text/options는 제외.
- **출처:** `growth-survey-010@ad60ba5`
- **현재 상태:** ⚠️주시 (survey-011 STT 거부 로직 점검 권장)

### [STT-5] 이상치 상한이 실측 범위보다 좁음 (200대 측정값 오염)
- **증상:** 실측 횡경/종경이 200대인데 검증이 150 초과를 이상치로 표시.
- **원인:** 초기 임시 이상치 범위가 실제 측정 로그보다 좁게 설정됨.
- **해결·회피:** widthMm/lengthMm 이상치 상한을 300으로 완화.
- **출처:** `debug-log`(2026-04-20)
- **현재 상태:** ⚠️주시 (survey-011은 컬럼 스키마가 동적 — 이상치 범위 설정 시 실측 분포 확인)

### [STT-6] 백 단위 "백"이 유사 명사("액", "에봇", "개")로 오인식되어 100 단위가 유실된 채 값 커밋
- **증상:** `177.7`을 입력하려고 `"백칠십칠 점 칠"`이라고 발화했으나 STT가 `"액 77.7"`로 인식하여 백 단위 없이 `77.7`로 커밋됨. `155.5` 입력 시 `"에봇 15.5"` 또는 `"개 95.5"`로 인식되어 `15.5`/`95.5`로 커밋됨.
- **원인:** STT가 leading `"백"`을 유사한 한절 명사로 잘못 인식하고, 파서가 비숫자 토큰을 버리면서 오류가 침묵 커밋됨.
- **해결·회피:** 앞단의 무관한 한절 명사가 "백"과 발음이 유사한 단어("액", "개", "엑", "에봇" 등)이면 ambiguous 처리하여 재질문하거나 기대 범위 오차 임계(이상치) 검사 적용 필요. **v0.5.0 가드(부분):** 같은 계열의 "유실된 채 침묵 커밋" 경로 2종을 차단 — ① 유효 숫자 토큰 2개 이상이면 `null`(재질문), ② `정수 + 점 + 비숫자 잔여`(소수부가 비숫자로 오인식)도 `null`(재질문). 단 leading "백"이 통째로 비숫자 1토큰으로 오인식되는 원형 케이스는 여전히 커밋될 수 있음.
- **출처:** `2026-06-05 세션` (실기기 로그 분석); `2026-06-10 실기기 로그` — **수정 경로 재발(소수부 유실형)**: `"111 점 에"`로 인식돼 소수부가 비숫자로 유실된 채 정수 `111`만 침묵 커밋됨; `2026-06-11 실기기 로그` — **v0.5.0 소수부 가드 작동 확인**: `"111 점 에"`·`"300 점 부다"` 둘 다 `stt_parse_failed:decimal_fraction_lost`로 **재질문**(침묵커밋 안 함) → 정상값 커밋. **단 점-없는 잔여형 잔존**: `"277 정체"`(row14, 277.7 의도)는 `점`이 없어 가드 밖 → 정수 `277` 커밋(사용자가 직후 수정으로 277.7 정정). 정수+무관 비숫자 토큰형은 미차단; `2026-06-12 분석`(06-11 v0.6.0 실기기 로그) — **점-없는 잔여형 재발 2건**: `"제17.7"`→`17.7` 침묵 커밋(의도 77.7, 선행 음절 유실)·`"현백 33.3"`→`33.3` 침묵 커밋(의도 333.3) — 둘 다 사용자가 수정 명령으로 즉시 정정(누적 4건, 빈도 상승 → v0.7.0 가드 승격 후보).
- **현재 상태:** ✅수정됨(점-없는 잔여형 가드, **survey-011 v0.7.0 STT-C**) — 단일 숫자 + 무관 비숫자 잔여 토큰("제17.7", "현백 33.3")은 ambiguous(`null`) 처리해 재질문(`stt_parse_failed:extraneous_token`). 단위어·조사·기존 커밋 보장 어휘는 의도적으로 좁은 화이트리스트(`HARMLESS_RESIDUAL_TOKENS`, `src/lib/koreanNum.ts`)로 통과시켜 "당도 8" 류 정상 커밋은 유지. 침묵 커밋 3계열(multi_numeric·decimal_fraction_lost·extraneous_token) 모두 재질문으로 전환 — STT 오인식 자체는 잔존([STT-10] 화이트리스트 정밀도 관측). 회귀 `tests/koreanNum.spec.ts`.
- **`2026-06-15 v0.8.0 실기기 로그`(decimal_fraction_lost 재발 ×5):** 소수점 뒤 숫자가 조사로 오인식되는 `decimal_fraction_lost`가 한 세션 5회(`"11 점 의"`·`"211 점에/점 의/점 에"`). **가드는 정상 작동**(전부 `stt_parse_failed`로 재질문, 침묵 커밋 0) — 즉 *데이터 유실은 없으나* 같은 소수 발화를 STT가 반복 실패해 사용자가 재발화하는 **마찰**이 빈발. STT 엔진(ko Web Speech) 한계라 코드 수정으로 근절 불가. 재질문 문구는 적정. 빈도 관측 지속(조기확정[딜레이] 토글과는 독립).
- **✅ `2026-06-17 v0.11.0 실기기 로그`(비 오는 비닐하우스 — 가드 스택 실전 소음 스트레스 통과):** 빗소리·잔향이 다량 유입된 실전 최악 소음에서 STT가 `"뮤직"`·`"보리 9.9"`·`"미래 11 편에"`·`"다시다 점 사"` 같은 명백한 환각 음절을 인식했으나 — **garbage 값 커밋 0건·환각 명령 0건·저신뢰(<0.5) 커밋 0건.** 모든 환각이 거부 레인(`stt_parse_failed`/`ambiguous_syllable`, L1:4·6 / L2:11)에 머물고, 명령 26건은 전부 정당한 `confirm`(median conf 0.98). multi_numeric·decimal_fraction_lost·extraneous_token 3계열 가드 + 신뢰도 게이트가 **현장 폭우에서 데이터 무결성 유지**를 입증. (향후 회귀 가시화용 확인된 양호 동작.)
- **✅ `2026-06-29 v0.23.0 실기기 로그`(가드 재확인, n=1):** decimal_fraction_lost×3·multi_numeric×3·extraneous_token×1 = 숫자파싱 마찰 7건 + 저신뢰 거부 3건 = **재질문 10건(value 40 중 25%)**. **전부 재질문 전환·침묵 커밋 0·데이터 유실 0** — 가드 정상. v0.23.0 신규 `stt_parse_failed` 유형 세분 로깅으로 마찰 유형별 빈도 가시화. 근절 불가(ko Web Speech 한계) 재확인 — 입력 효율 저하의 주원인이나 정확성은 보존.

### [STT-7] 수정 명령 `"수정"`이 `"수변"` / `"수 벽"`으로 오인식되어 무시되거나 파싱 실패
- **증상:** 수정하고 싶을 때 `"수정"`이라고 말했으나 STT가 `"수변"`으로 오인식하여 TTS가 켜져 있어 차단(`stt_blocked_tts_muted`)되거나, `"수 벽"`으로 오인식하여 파싱 실패(`stt_parse_failed`)되어 정정 진입이 안 됨.
- **원인:** `detectCommand`가 `"수정"`, `"정정"`만 완벽히 매칭하기 때문.
- **해결·회피:** **방향 전환(민구 결정 v0.4.0):** 동음이의 별칭(`수변`/`수벽`)을 하드코딩하면 false-positive(`수변`=水邊) whack-a-mole이 된다. 대신 **명령어를 기능당 단일 단어로 통일**(`src/lib/voiceCommands.ts` SSOT)하고, 도움말 팝업·TTS가 그 단어(`수정`)를 학습시킨다. 오인식은 별칭을 늘리는 대신 텔레메트리로 관측해 사후 보정한다. (활용형 꼬리 `수정해줘`는 startsWith로 허용.)
- **출처:** `2026-06-05 세션` (실기기 로그 분석) → **survey-011 v0.4.0** 정책 전환
- **현재 상태:** ⚠️주시 (단일화로 마찰 완화 — STT 엔진 오인식 자체는 잔존, 필드 텔레메트리로 추적)

### [STT-8] "구십"(90)과 "오십"(50)의 한국어 발음 혼동
- **증상:** `99.9`를 입력하려고 발화했으나 STT가 `"59.9"`로 연속 인식하여 정정 왕복 발생.
- **원인:** 한국어 숫자 발음의 유사성으로 인한 STT 엔진의 한계.
- **해결·회피:** 이상치 필터링 또는 사용자 확인 등 UX 보완 필요.
- **출처:** `2026-06-05 세션`
- **현재 상태:** ⚠️주시
- **`2026-07-02 v0.25.0 실기기 재발`(×2+유사계열):** S1 r5 c7 의도 99.9가 "59.9"로 연속 2회 인식(conf 0.947/0.872) — 둘 다 커밋됐으나 **범위알람이 즉시 포착**해 99.9로 정정. 같은 세션에서 유사 계열("95.5"↔55.5 의도, "8.8"↔88.8 의도)도 전부 범위알람 정정. STT 엔진 한계 잔존이나 **범위알람이 실전 방어선으로 작동** 확인(침묵 유실 0).

### [STT-9] 저신뢰(confidence) "수정" 발화가 임계값에 걸려 거부됨 (T-12 잔존)
- **증상:** "수정"이라고 말했으나 STT confidence가 낮게 산출되어 명령이 거부됨. v0.4.3에서 수정 명령 전용 임계값을 0.55로 낮췄으나(T-12), 이후에도 드물게 재발.
- **원인:** STT 엔진이 또렷한 발화에도 낮은 confidence를 산출하는 경우가 잔존 — 엔진 한계.
- **해결·회피:** 임계값 추가 인하는 노이즈 오탐([STT-3]) 위험과 트레이드오프 — 현행 0.55 유지하고 텔레메트리로 빈도 관측 지속.
- **출처:** `survey-011 v0.4.3`(T-12 임계값 0.55 도입); `2026-06-10 실기기 로그` — 저신뢰 거부 재발 1건 관측(세션 480 이벤트 중 1건, 빈도는 크게 완화된 상태). `2026-06-15 v0.7.0 실기기 로그` — 저신뢰 거부 2건("수정" conf .28 id48 / "유지" conf .29 id323), 둘 다 재발화로 즉시 복구. 빈도 완화 상태 유지.
- **현재 상태:** ⚠️주시

### [STT-10] STT-C 재질문 가드의 융합 잔여 토큰 — 단위어+조사 융합형("밀리요", "프로요", "mm입니다")은 현재 재질문됨
- **증상:** v0.7.0 STT-C 가드(`extraneous_token`)의 화이트리스트(`HARMLESS_RESIDUAL_TOKENS`, `src/lib/koreanNum.ts` 161~172)는 단위어·조사를 **개별 토큰**으로만 통과시킨다. STT가 단위어와 조사를 한 토큰으로 융합하면("33.3 밀리요", "8 프로요", "20.5 mm입니다") 화이트리스트 밖이라 정상 발화도 재질문된다.
- **원인:** 의도적으로 좁은 화이트리스트 — [STT-6]의 선행 음절 오인식("액", "제", "현백" 등)을 통과시키지 않는 것이 우선이라, 융합형을 선제 추가하면 침묵 커밋 구멍이 다시 열릴 위험.
- **해결·회피:** 재질문은 안전한 쪽 실패(값 유실 없음). **다음 실기기 로그 분석에서 `extraneous_token`의 정밀도/재현율을 측정한 뒤** 화이트리스트 확장(또는 "단위어 prefix + 조사 suffix" 분해 매칭)을 결정한다 — 측정 전 확장 금지.
- **출처:** `2026-06-12 v0.7.0` Codex 교차점검(watch-item); `2026-06-15 v0.7.0 실기기 로그` — **정밀도 측정 n=1: true positive**(`"우정 77.7"` row4 → `extraneous_token` 재질문 → 재발화로 정상 커밋, 정상 발화 오탐 아님). 융합 토큰("밀리요" 류)은 이번 세션 미발생. **화이트리스트 확장 보류 방침 유지**(샘플 더 필요).
- **현재 상태:** ⚠️주시 (텔레메트리 관측 우선 — 필드 로그에서 `stt_parse_failed:extraneous_token` 빈도·오탐 수확)

### [STT-11] 음성입력→TTS 출력 체감 딜레이 = 브라우저 무음 종료감지(EOS), 앱 처리는 ~1ms
- **증상:** 민구 — "음성 입력 후 안내 음성까지 딜레이가 느껴진다, 줄여달라."
- **진단(2026-06-15 v0.8.0 로그):** TTS 이벤트의 `ts`는 발화 *종료* 시점(durationMs 보정 필요). 보정하면 **STT 최종인식 → TTS 발화시작(앱 처리) = 중앙값 1ms / p90 2ms** — 앱 파이프라인(추세검사·클립정지·persist 포함)은 발화를 거의 막지 않는다. TTS 큐 지연(`startDelayMs`)도 중앙값 28ms. **체감 딜레이는 전적으로 브라우저 Web Speech API의 무음 종료감지(말 멈춤 → `isFinal`)**. iOS Safari 특성상 0.5~1.5s 추정이나 **현 로그엔 interim 타임스탬프가 없어 미측정.**
- **해결·회피:** 앱 코드의 유일한 레버 = interim(중간) 안정화 기반 **조기확정**. v0.9.0: ① (무위험) `stt_eos_tail` 계측 — 마지막 interim → final 간격을 `stt` 이벤트에 동봉해 다음 로그에서 EOS 꼬리 정량화. ② (실험, **기본 OFF**) 설정탭 "빠른 인식" 토글 — interim 숫자가 `EARLY_COMMIT_STABLE_MS=400` 안정되면 final 대기 없이 커밋(`restartRecognition`으로 in-flight final abort → 이중 커밋 방지), `stt_early_commit` 계측. 절단(소수점 추가 전 커밋) 리스크가 있어 실기기 A/B 후 채택 결정.
- **출처:** `2026-06-15 v0.8.0 실기기 로그` 분석(민구 요청).
- **현재 상태:** 🔬계측+실험 (default off) — 다음 로그의 `stt_eos_tail`(EOS 꼬리)·토글 ON 시 `stt_early_commit` 절단/정정율로 가치 판단.
- **`2026-06-19 v0.14.0 실기기 로그`(빠른인식 존치 판단):** fastRecognition ON인데 `stt_early_commit` **0건**, eosTail median ~1.7–1.9s(마찰 실재하나 조기확정 한 번도 안 걸림). 현 계측으론 'wired-but-never-fired(소음이 interim 안정화 차단=정상) vs 미배선(버그)' 구분 불가 → 민구 결정 **옵션 유지(기본 OFF, 제거 안 함) + 계측 1회**. **v0.15.0 A8 계측 추가:** early-commit **시도** 가시화(`stt_early_commit extra:'attempt:armed:<v>' / 'attempt:reset:new_interim/parse_null/final_first' / 'attempt:cancel:tts_muted'`) — 상태 전이 시에만 기록(폭주 방지), fastRecognition OFF면 무발화. 다음 fastRecognition ON 현장 로그에서 `attempt:armed` 출현=배선 확정(미발동은 소음 탓 정상), `attempt` 0건=미배선 의심. 그 결과로 존치/수정/제거 확정.
- **`2026-06-17 v0.11.0 실기기 로그`(비 오는 비닐하우스, 재분류):** fastRecognition(빠른 인식) **ON**인데 `stt_early_commit` **0건**, eosTail median 1716(L1)/1810ms(L2). 처음엔 "조기확정 미배선" 의심했으나, **현 텔레메트리로는 '소음이 interim 안정화를 막아 조기확정 미발동'(정상)과 '미배선'을 구분 불가**(interim/early-commit 시도 이벤트 부재) → **instrumentation-gap으로 재분류**(behavior-bug 단정 금지). eosTail이 신뢰도와 무관하게 일률적으로 김(소음 분산 신호 아님 = 고정 EOS 타임아웃 정황). 단 `eosTailMs` 존재 자체가 interim 발화 증거라 iOS interim 미지원 가설은 약함. **v0.12.0 조치:** speakerphone near-miss(가드 통과·250~500ms band) msSinceTtsEnd를 기존 stt 이벤트에 동봉(계측) — 다음 현장 로그에서 EOS/가드 정량화. 조기확정 가치 판단은 fastRecognition ON 상태 현장 로그 누적 후.

### [STT-12] OpenDots 외장 마이크가 선택 가능해도 6세션 연속 내장 마이크만 잡힘 — **종결→소음 성능저하로 완화**
- **증상:** `device.json`에 OpenDots ONE by Shokz가 audioinput으로 열거되나, `session.input_device`는 6세션 연속 `iPhone 마이크`(내장). 외장 마이크가 실제 입력으로 선택되지 않음.
- **원인:** 앱은 `getUserMedia` 기본 장치를 쓰며 장치 선택 UI가 없다. OpenDots(골전도 이어폰) 마이크 자체가 iOS 입력 기본으로 승격되지 않거나 페어링/오작동. 6세션 연속 동일 → 기기/이어폰 측 문제로 판단.
- **현재 상태:** ✅종결(민구 확인, 2026-06-16) — 이어폰(OpenDots) 마이크 오작동으로 확정. 앱 코드 조치 없음.
- **`2026-06-17 v0.11.0 로그`(완화):** Log2에서 OpenDots ONE이 **실제 입력 장치로 선택됨**(`session.input_device`=OpenDots) — "내장만 잡힘"과 대비. 단 비 오는 비닐하우스 소음에서 내장 마이크(L1)보다 **성능 저하**: `stt_parse_failed` L1:4 vs **L2:11(2.75×)**, 커밋 신뢰도 floor 0.820 vs 0.679. → "이어폰 오작동"이라기보다 **소음 환경 마이크 성능 저하**(완주는 함, 18행 43커밋). v0.12.0 입력장치 배지가 어떤 마이크로 듣는지 표시(🎧 블루투스 vs 📱 내장)해 사용자가 인지 가능. 소음 현장 내장 마이크 권장은 백로그(AUDIO-INPUT-1, n=1이라 2차 표본 후).

### [AUDIO-INPUT-2] 입력장치 배지가 음성입력 중 장치 변경(블루투스 해제 등)을 반영 못 함 — frozen 라벨
- **증상(민구 제보):** "음성 입력 시작 전엔 배지에 입력 기기가 반영되는데, 입력 중 OS에서 블루투스를 끊으면 상단 배지가 그대로 멈춰 있다."
- **원인(코드 추적 확정):** 배지 라벨은 `init()` 시 `getUserMedia` 트랙의 `track.label`을 1회 스냅샷한 **불변값**(`audioRecorder.ts` `activeInput`)이었다. `VoiceScreen`의 300ms 폴링은 그 frozen 필드를 반복해서 다시 읽을 뿐이고, `navigator.mediaDevices` `devicechange`/트랙 `ended`·`mute` 구독이 전무했다. 라벨이 새로 잡히는 유일한 순간은 새 `AudioRecorder` init(=start/resume)뿐 → "시작 전/재개 시엔 반영, active 중 변경은 미반영"이라는 증상과 정확히 일치.
- **해결·회피(v0.13.0 R8):** init 성공 직후 `devicechange` + 활성 트랙 `ended`/`mute`/`unmute`를 **구독**하고, 신호 수신 시 **비파괴 `enumerateDevices` 재읽기**로 `activeInput.label`을 갱신. 재-`getUserMedia`는 금지([IOS-5] 종결 정책 + 진행 중 클립 손실 회귀 방지) — 라벨만 다시 읽는다. 활성 장치가 목록에서 사라지거나 트랙이 `ended`면 라벨을 비워 `classifyInputDevice`가 자연히 '📱 내장'으로 폴백(BT 끊김→내장 표시). `dispose()`에서 리스너 해제(track.stop의 ended가 핸들러를 깨우지 않도록 stop 전에 detach). **주의(코드리뷰 R8):** `track.muted`는 '장치 분리'가 아니라 일시 인터럽션(통화/Siri/라우트 변경)이므로 라벨을 비우는 조건에서 **제외**한다(BT 연결 중 일시 mute에 '내장' 깜빡임 방지) — 진짜 분리는 `ended`+enumerate deviceId 부재로만 판정.
- **출처:** `2026-06-18 세션`(민구 제보) → **survey-011 v0.13.0** 수정
- **현재 상태:** ✅수정됨 (`src/lib/audioRecorder.ts` attach/detachDeviceListeners·refreshActiveInputLabel) — **iOS Safari PWA에서 active getUserMedia 중 `devicechange`/track `ended` 실제 발화 여부는 device 확인 필요**(미발화여도 no-op이라 회귀는 없음).
- **⚙️ 후속(v0.18.0, 배지 표시 삭제 — 민구 결정):** 수차례 수정에도 입력장치 배지가 현장에서 정상 동작 안 함(비대칭 미반영 등) → **시각 배지만 제거**. `VoiceScreen.tsx`의 `InputDeviceBadge` 컴포넌트·렌더·`getActiveInputLabel` 폴링 제거. **복구 로직은 불가침으로 보존** — `audioRecorder.ts`의 `recoverStream`/`attachDeviceListeners`/`handleDeviceChange`/`refreshActiveInputLabel`·`getActiveInputLabel` 메서드는 그대로 둠(CLIP-LOSS-1 클립 복구가 의존). `src/lib/inputDevice.ts`/`classifyInputDevice`는 `tests/inputDevice.spec.ts`가 참조하므로 **삭제하지 않음**(미참조 조건 미충족). 즉 "어떤 마이크로 듣는지" 표시는 사라졌지만 BT↔내장 전환 시 클립 복구 동작은 유지.
- **⚠️ 후속(v0.14.0 D):** v0.13.0 후 민구 보고 — BT→스피커폰→BT 재전환 시 **2번째 BT 복귀가 배지에 반영 안 됨**(비대칭). 비파괴 enumerate는 같은 deviceId/라벨이면 변화를 못 잡는 한계. v0.14.0에서 `handleDeviceChange`가 **유휴 중(녹음 아님) 장치변경 시 스트림 재획득**(recoverStream)으로 실제 활성 장치를 다시 잡아 배지를 갱신([CLIP-LOSS-1]와 동일 경로). 녹음 중엔 비파괴 라벨 갱신 유지(클립 보호). 비대칭 원인은 실기기 재검증 필요.
- **⚙️ 후속(v0.19.0 W7, 입력장치 실시간 로깅 — 민구 요청):** v0.18.0 로그가 **BT·스피커폰을 실제로 썼는데도 두 세션 모두 "iPhone 마이크"**로만 기록(B-1 갭) → 분석 시 입력 경로 식별 불가. 라벨이 실제 변할 때만(`old !== new`) `audioRecorder.ts`가 `session`/`input_device_changed:<reason>:<oldCat>→<newCat>` 이벤트 방출(refreshActiveInputLabel·recoverStream 전이점, `classifyInputDevice` 카테고리 동봉). 신규 이벤트 타입은 안 만들어 **log-replay 호환**. **한계(명시):** iOS는 STT(Web Speech)가 자체 오디오 캡처라 클립 레코더(getUserMedia)의 `track.label`이 STT 실제 경로와 다를 수 있어, **BT 연결돼도 "내장"으로 찍힐 수 있음** — 계측 신호는 늘지만 BT/내장 완전 구분은 [IOS-5]/AUDIO-ROUTE-1(네이티브 셸) 영역. **실기기 검증:** 세션 중 BT↔스피커폰 전환 시 이벤트 출현 여부 + device.json `audioInputDevices` 열거 대조.
- **🔴 2026-06-30 v0.24.0 실기기 2세션 — BT/스피커폰 구분 불가 재확인:** 민구가 S1 BT·S2 스피커폰(일부 BT)을 썼으나 양 세션 `session:input_device`=`"iPhone 마이크"`+동일 deviceId, `input_device_changed` **0건**. 클립 레코더 track.label이 STT 실경로와 달라 BT 미반영 — 텔레메트리로 입력경로 식별 불가([STT-13]/W7 한계, AUDIO-ROUTE-1 네이티브 셸 영역).
- **🟢 2026-07-02 v0.25.0 실기기 — BT 라벨 첫 포착(부분 해소):** S2 세션메타 `session:input_device`가 **`OpenDots ONE by Shokz`**(deviceId 24A69DAA…)로 기록됨 — 06-30 "BT 써도 iPhone 마이크로만 기록" 갭과 대비, BT/내장이 세션 라벨 수준에서 처음 구분됨(S1은 iPhone 마이크). 원인은 v0.25.0 기능2 mic prewarm이 세션 시작 전 getUserMedia를 선점해 실제 활성 장치를 잡는 영향으로 **추정(확인 필요)** — STT(Web Speech) 실경로와의 일치 여부는 여전히 미보증([STT-13] 한계 자체는 유지).

### [STT-14] TTS 연발 중 인식기 재시작 예약이 취소돼 STT가 **영구 사망** — "이전" 명령 후 앱 사용 불가
- **증상(v0.31.0 실기기, 2026-07-09):** "이전" 음성 명령(conf 0.883, 정상 처리) 직후 수정 모드 재안내 TTS가 연달아 나온 뒤, **세션 종료까지 약 5분간 STT 이벤트 0건** — 어떤 음성 명령도 인식 안 됨. TTS·클립 레코더·터치 버튼은 전부 정상(사용자는 터치로만 진행하다 종료). `ui_suspend` 0건(v0.31.0 도움말 suspend와 무관), BT 끊김은 사망 4분 뒤(무관).
- **원인(코드 확정, 2중 결함):** iOS는 TTS 재생 중 SpeechRecognition을 죽인다. 인식기 `end` 시 `onEnd`가 100ms 재시작을 예약하는데, **모든 TTS 발화 시작 시 호출되는 `muteForTts()`가 그 예약을 무조건 취소**하고 `unmuteForTts()`는 재예약하지 않음(`speech.ts`) — 죽은 인식기는 다시 `end`를 못 내므로 회복 경로가 없다. "이전"(reentry)은 유일하게 행 안내+필드별 재안내 **연속 TTS 버스트**를 내는 경로라 이 레이스에 집중 노출(단 취약점 자체는 모든 TTS 경로 공통). 보조 결함: `scheduleRestart()` 타이머 본문의 `rec.start()` 예외를 catch가 삼키고 재시도 없음("try again next tick" 주석과 달리 재시도 부재).
- **해결·회피(v0.32.0):** ① `muteForTts()`가 예약을 취소하면 `restartPendingAfterTts`로 기억 → `unmuteForTts()`에서 재예약. ② start() 예외 시 backoff(×2, 상한 5s, 무제한 — 재시도 상한을 두면 사망 경로가 재생김) 실재시도. ③ **워치독**(4s 간격): active인데 인식기가 안 돌고 예약도 없으면 강제 재시작 — `stop()`에서 함께 해제되므로 v0.31.0 `suspendRecognitionForUi`와 충돌 불가. ④ stale-instance 가드(버려진 인식기의 늦은 이벤트가 이중 재시작 못 하게). ⑤ **lifecycle 텔레메트리 신설**(`stt`/`extra:lifecycle:*`): `restart_cancelled_by_mute`(사망 시그니처)·`restart_resched_after_tts`·`restart_retry`·`watchdog_restart`·`error:<code>`는 항상, start/end는 10s 스로틀. 회귀 `tests/speech-lifecycle.spec.ts`(유닛 6케이스).
- **교훈(계측):** 이 사망은 기존 텔레메트리로 직접 관측 불가였다(인식기 lifecycle 이벤트 전무) — "STT 이벤트가 오래 없음"이라는 부재 증거로만 추론 가능했다. 다음 실기기 로그에서 `lifecycle:restart_cancelled_by_mute` → `restart_resched_after_tts`(정상 회복) 연쇄와 `watchdog_restart`(좀비 경로 발동) 빈도를 확인할 것.
- **출처:** `2026-07-09 v0.31.0 실기기 로그`(sess_1783570914828) → **survey-011 v0.32.0** 수정
- **현재 상태:** ✅수정됨 — **실기기 검증 완료(2026-07-14, v0.33.0)**: "이전" 음성 명령 7회 사용 후 STT 즉시 생존, `watchdog_restart` 0건, `restart_cancelled_by_mute`→`restart_resched_after_tts` 정상 회복 연쇄 확인. 종결.

### [STT-15] 소수 재질문 중 STT alternative 전체값이 오커밋 ("하나"→"1")
- **증상(v0.32.0 실기기, 2026-07-13):** 소수부 재질문(`decimal_fraction_lost`) 대기 중 조각 발화가 저신뢰로 거부되면서 `stt_alt_used` 폴백이 **재질문 문맥을 무시하고 alt 전체값을 커밋**("하나"의 alt "1"이 소수부가 아닌 정수 1로 커밋).
- **해결·회피(v0.33.0):** 재질문 대기 중엔 소수부 문맥 강제 — alt 수용도 fractionWhole 합성 경로로만. 결정론 테스트 고정.
- **출처:** `2026-07-13 실기기 로그` → v0.33.0 수정 → **실기기 검증 완료(2026-07-14)**: "311 점에"→311.1, "111 점 에"→111.1 회복 2/2, 07-13 회귀 입력 "211 점 의"가 211.1 정상 커밋(완전 A/B).
- **현재 상태:** ✅수정됨·검증 완료. **단 alt 폴백의 구조적 함정은 [STT-ALT-1]로 일반화** — 이 항목은 lost 계열 봉합만.

### [STT-16] 탭 전환 시 VoiceScreen unmount로 STT 영구 사망
- **증상(v0.32.0 실기기, 2026-07-13):** 입력 세션 중 데이터탭 등으로 이동하면 VoiceScreen이 unmount되며 인식기·클립 레코더가 파괴 — 복귀해도 재시작 안 됨.
- **해결·회피(v0.33.0):** **keep-alive 렌더**(세션 활성 중 VoiceScreen unmount 금지, 비활성 탭은 display:none) + `visibilitychange`/`pageshow`에서 `kick()` + 트랙 판정 정밀화(ended만 래치). `App.tsx` 주석 + `tests/stt16-tab-keepalive.spec.ts`.
- **출처:** `2026-07-13 실기기 로그` → v0.33.0 수정 → **실기기 검증 완료(2026-07-14)**: 탭 왕복(09:21:35→39) 후 무조작 재개, `kick_result:vis:running`, `mic_track:muted→unmuted` 회복.
- **현재 상태:** ✅수정됨·검증 완료. 파생 효과: 세션 중 어느 탭에서든 useVoiceSession 신호 배선 가능(v0.34.0 피드백 모달 suspend가 이 성질에 의존).

### [STT-17] 긍정 응답어("예/네")가 수사로 오커밋 — "예"→4
- **증상(v0.33.0 실기기, 2026-07-14):** 값 대기 중 "예"(conf 0.729) 발화가 `stt_alt_used` alt "네"를 거쳐 **수사 4로 커밋**(09:34:59). 알람 있는 컬럼이라 잡혔지만, 알람 없는 컬럼이면 침묵 오염 경로.
- **원인:** "네"는 한국어 수사 4의 정당 표기(네 개)라 파서는 4로 파싱 — 문제는 값-대기 문맥에서 **단독 응답어**를 값으로 수용한 것.
- **해결·회피(v0.34.0):** `koreanNum.ts` `isBareResponseWord`(예/네/응/어/넵 등) 신설 — **파서 불변**(네/사 수사 계약 보존), 차단은 handleFinal 값-대기 가드에서 primary·alt 모두 재질문(`stt_rejected_ambiguous_syllable`+`response_word`). trendConfirm 확인 응답('확인'/'유지')과 무충돌.
- **출처:** `2026-07-14 실기기 로그`(S2 r1c8) → v0.34.0 수정. 회귀 `tests/koreanNum.spec.ts`·`correction-flow.spec.ts`.
- **현재 상태:** ✅수정됨(v0.34.0) — 실기기 검증 대기.

### [STT-18] 알림음 등 오디오 세션 점유 후 인식기가 **좀비(started-but-silent)로 영구 사망** — recRunning=true인데 onresult 0건
- **증상(v0.35.3 실기기, FB#3):** iOS 실기기에서 문자 수신음 등이 오디오 세션을 점유하면 `webkitSpeechRecognition`이 `error:audio-capture` 발생. 이후 `end→restart_scheduled→start`로 fresh 인스턴스가 **start까지 성공(recRunning=true)** 하지만 `onresult`를 0건 방출하는 좀비가 된다. 한 세션은 40초 내 자동 회복 ✅, 다른 세션은 **57초간 onresult 0건**으로 영구 사망(사용자 포기) ❌. 파형(audioRecorder의 별도 getUserMedia 스트림)은 계속 작동 → STT만 죽음.
- **원인(코드 확정):** [STT-14]의 watchdog/kick은 `if(recRunning) return`으로 조기 종료 → **recRunning=true로 고착된** 좀비는 감지 불가였다. [STT-14] watchdog은 `recRunning=false`(end 후 재시작 예약도 없는) 사망만 봤고, 이 running-but-silent 케이스는 사각지대였다. fresh 인스턴스 재생성(attemptStart)·백오프 ×2 cap 5s는 이미 있었으나 "좀비 감지" 하나가 부족했다.
- **해결·회피(v0.36.0):** `speech.ts` SpeechController에 **`lastResultAt` liveness 타임스탬프** 신설 — `onResult`(interim 포함, 가장 이르고 잦은 liveness 증거)와 `onStart`(갓 시작한 무음 인식기 오판 방지 앵커)에서 갱신. 좀비 자격은 실기기에서 확인된 **`audio-capture` 오류 이력 + fresh 인스턴스 결과 0건**으로 한정한다(`no-speech`·앱 `aborted`·권한 오류 제외). `watchdogTick`/`kick`이 이 자격과 유효 stale 임계(연속 실패마다 ×2, 최대 60초)를 모두 만족할 때만 현재 인스턴스 `abort()` 후 fresh 재시작한다. **마이크 재취득 없음**([IOS-5] — STT 인스턴스만 재생성). 기본 임계 `12000ms`는 **device-gated**이며, TTS 중에는 watchdog을 멈추되 `unmute` 때 liveness를 현재로 덮지 않고 **실제 mute 구간만** stale에서 제외해 반복 TTS가 복구를 무기한 미루지 않게 했다. 텔레메트리 `lifecycle:zombie_restart:stale_ms=<N>,n=<streak>`(항상 기록)는 `logEvents.ts` 빌더로 바이트 계약을 고정한다. 회귀 `tests/speech-lifecycle.spec.ts`가 audio-capture 양성·비자격 오류 3종·정상 무음·interim liveness·백오프·반복 TTS를 고정한다.
- **출처:** `2026-07-xx v0.35.3 실기기 로그 FB#3` → **survey-011 v0.36.0** 수정.
- **현재 상태:** ✅수정됨(v0.36.0) — **실기기 검증 대기**: 다음 로그에서 `lifecycle:error:audio-capture`→`zombie_restart:stale_ms=<N>,n=<streak>`→회복(onresult 재개) 연쇄 + 비자격 오류/정상 무음의 zombie_restart 0건 + 기본 임계 튜닝 필요성 확인.

### [STT-ALT-1] `stt_alt_used` 폴백이 primary 재질문 가드의 **우회로** (구조적 함정)
- **증상:** primary가 재질문 가드(`decimal_fraction_lost` 등)에 걸려도, alts 루프가 문맥 없이 alt를 수용하면 재질문이 무산되고 잘못된 값이 침묵 커밋된다. 실사례 2건: [STT-15]("하나"→alt "1"), 07-14 "266 점요"(primary lost 재질문 → alt "266" 정수 커밋).
- **해결·회피(v0.34.0):** alts 루프에 소수-의도 게이트(`parseFailReason==='decimal_fraction_lost'`면 소수점 없는 alt skip) + 응답어 alt skip([STT-17]). **일반 교훈: 재질문 계열 가드를 추가할 때는 반드시 alts 루프 게이트를 함께 검토할 것** — primary만 막으면 alt가 우회한다.
- **출처:** `2026-07-14 v0.34.0 세션`(O3 진단 정정 — "점요" 사전 누락이 아니라 alt 우회가 실제 메커니즘이었음).
- **현재 상태:** ✅수정됨(lost·응답어 계열) — 다른 parseFailReason 계열은 전체 재발화 유도라 alt 폴백이 정당(변경 불요).

### [STT-PARSE-1] `extractModifyValue`는 "수정" 뒤 임의 텍스트를 값 후보로 반환 — 컬럼명 지정 신기능의 함정
- **증상:** "수정 <컬럼명>" 류 기능을 값-우선으로 배선하면 컬럼명("종경")이 값 파싱 실패→cascade 오타깃으로 흡수된다.
- **해결·회피(v0.34.0):** reviewWait 스코프에서 **컬럼명 매치를 값 적용보다 먼저** 검사(`extractModifyColumn`, 공백 제거 정규화 — STT가 '초장'을 '초 장'으로 쪼개는 변형 대응). 숫자 발화는 컬럼명과 매치 불가라 "수정 30.7" 경로 무손상. 코드 주석 박제.
- **출처:** `2026-07-14 v0.34.0 세션`(A3 구현 중 발견).
- **현재 상태:** ✅수정됨(reviewWait 스코프) — 향후 다른 스코프로 확장 시 동일 순서 준수.

---

## ② 클립 · IndexedDB 영속화 (최대 광맥)

### [CLIP-BT-1] 블루투스→내장 마이크 전환 시 audio-capture 에러 버스트 + 클립 유실 (세션은 자가 회복)
- **증상(v0.33.0 실기기, 2026-07-14):** Shokz OpenDots 연결 해제로 트랙 ended → `stt lifecycle:error:audio-capture` ×3 + `clip_empty` 2건(r1 c8/c9 클립 유실, **값은 무손실**). `restart_scheduled`로 자가 회복(07-13식 수동 소생 불필요) — 별도 세션 09:35:15 단발도 0초 자동 회복.
- **관련:** [STT-12](OpenDots 소음 성능), [AUDIO-INPUT-2](장치 변경 배지 미반영), [CLIP-POINTER-1](clip_empty broken pointer).
- **현재 상태:** ⚠️주시 — 값 무손실·자가 회복이라 v0.34.0 수정 없음(등재만). 전환 구간 클립 유실이 반복 관측되면 장치 전환 시 레코더 선제 재획득 검토.

### [CLIP-5] dispose() 시 in-flight 클립 save가 좀비화(hang)
- **증상:** `dispose()` 후에도 onstop 이벤트가 큐에 남아 클립 저장 awaiter가 무기한 대기.
- **원인:** dispose가 pending `resolveStop`을 해소하지 않음.
- **해결·회피:** `dispose`에서 pending `resolveStop`을 null(blob)로 우선 해소. `stop()`은 dispose 전 `Promise.allSettled`로 클립 flush(5초 타임아웃).
- **출처:** `growth-survey-010@e207513` (v5.2 3차, HIGH)
- **현재 상태:** ⚠️주시 (survey-011 `audioRecorder.ts`/`useVoiceSession.ts`에 flush 경로 존재 — 회귀 권장)

### [CLIP-6] 음성클립 동시 재생 (순차 재생 보장 안 됨)
- **증상:** 데이터탭에서 여러 클립이 동시에 재생됨. 화면 밖(언마운트/세션삭제)에서도 재생 지속.
- **원인:** 재생 제어가 단일 큐로 직렬화되지 않음.
- **해결·회피:** 모듈 싱글톤 `clipPlayer`(현재 1개 + 큐)로 직렬화. await 후 stale continuation 가드(current!==key), `clipPlayer.stop()`을 언마운트/세션삭제 시 호출.
- **출처:** `growth-survey-010@fd3177a` (v0.11.2)
- **현재 상태:** ✅**해소 확인**(2026-07-26 코드 감사) — `src/lib/clipPlayer.ts`가 **모듈 레벨 단일 재생 매니저**다(v0.11.2). 한 번에 하나만 재생하고 나머지는 큐 대기, 재생 중 재탭은 정지+큐 취소. `await` 사이 stale continuation 폐기 가드도 있다(Codex HIGH 지적 반영).
- ⚠️ **전용 회귀 테스트는 없다**(`tests/`에 `clipPlayer` 참조 0건). 재생 큐 로직을 건드리면 회귀를 먼저 만들 것.

### [CLIP-8] IDB 스키마 업그레이드 후 구버전 롤백 시 VersionError
- **증상:** v3로 업그레이드된 디바이스를 구버전(v2) 코드로 롤백하면 `VersionError`.
- **원인:** IndexedDB는 버전 다운그레이드를 허용하지 않음.
- **해결·회피:** 스키마 bump는 **단방향**임을 인지하고 배포. 롤백이 필요하면 마이그레이션 전략 별도 수립. (이 항목은 해결책이 아니라 **주의**다.)
- **출처:** `growth-survey-010@9a9c004` (v5.2 5차, 커밋 본문 경고)
- **현재 상태:** ⚠️주시 (survey-011 DB도 버전드. 스키마 변경 시 동일 위험)

### [CLIP-9] 클립 편집(트림) 시 `decodeAudioData` 실패가 침묵 폴백 — 원본 webm을 트림 성공인 양 저장 (계측 부재)
- **증상(v0.19.0 실기기, Trace 분석):** 비고 "음성클립 편집 실패" 6행 중 3행(이원창 c7 3·4·5)이 `.webm`로 저장(정상은 `.wav` 트림본, `.webm`×3 vs `.wav`×94). 트림이 생략됐는데 **아무 이벤트도 안 남아** 분석에서 원인 불가시.
- **원인:** `audioTrim.ts:378` `decodeAudioData` 실패(소음·코덱·BT 트랙 손상 등) 시 트림을 건너뛰고 원본 webm을 저장하는데, 실패 경로에 로그가 없어 "정상 저장"과 구분 불가.
- **해결·회피(v0.20.0 BL-2):** decode catch에만 `trimFailed`/`trimFailReason` 디스크리미네이터 설정(`raw===null`의 5개 정상 경로와 분리) → `ClipResult`로 전달 → `useVoiceSession` 클립저장 블록에서 `clip_trim_failed:<reason>`(row/colId 컨텍스트) 방출. 저장 blob은 사용 가능한 원본 webm 유지(보수적, 가시화 전용).
- **출처:** `2026-06-24 v0.19.0 실기기 분석` → **survey-011 v0.20.0** 계측
- **⚙️ 하니스 후속(2026-06-24, BL-6 확정):** 루프백 재인식 결과 **편집(트림)은 오디오 무손상**(final 재인식 == raw 재인식 전 케이스 일치) → "음성클립 편집 실패"의 *편집* 프레이밍 기각. 이 `.webm` decode-fail은 **[CLIP-10] 첫값(c7) 클립 truncation의 하위 증상**(짧고 손상된 webm이라 decode까지 실패)으로 재분류.
- **현재 상태:** ⚠️주시(계측만) — `clip_trim_failed` 빈도는 계속 관측하되, 근본은 [CLIP-10]에서 다룸.

### [CLIP-10] 행의 첫 측정값(c7) 클립이 발화를 잘라먹어 재생/재인식 불가 — truncation (라이브 인식은 정상, 클립만 손상)
- **증상(v0.19.0 실기기 하니스, 2026-06-24):** 저장 클립을 앱과 동일 엔진(Chrome Web Speech)으로 재인식 시 **행의 첫 값 c7(횡경) 클립이 전부 ∅**(이원창 3·4·5·14, 강남호 4·13), c8(종경)은 대부분 정상. ffmpeg: c7 클립 **0.80s**(오디오 있음 max −5.4dB)인데 정상 c8은 1.50~1.64s — "이백칠십칠 점 칠"(277.7)이 0.8s면 명백 truncation. 가장자리 절단도 동반(88.8→8.8 앞자리, 288.8→288 끝자리). r14 c7은 `.wav`인데도 ∅ → webm 재생 아티팩트 아님.
- **원인(가설, 코드추적 필요):** **라이브 인식은 정답**(연속 스트림, CSV 전부 일치)이나 **저장 클립이 첫 발화 시작을 못 담음** — 첫값은 TTS 안내 직후라 레코더 arming/프리롤이 발화 시작을 놓치는 정황. c8(둘째값)은 레코더가 이미 안정 가동이라 정상.
- **영향:** **데이터 무결성 영향 없음**(라이브 커밋 정답) — **클립 감사·재생 품질** 문제(나중에 클립으로 값 검증·재청취 불가).
- **해결·회피(방향, 미구현):** 첫값 클립 arming을 TTS 안내 *이전*으로 당기고(W6/[CLIP-LOSS-1] 프리롤 0.5s 계보), 프리롤 버퍼가 첫 발화 시작을 확실히 포함, 클립 경계 패딩 강화(현 `audioTrim` PAD 앞300/뒤180ms가 첫값엔 부족). 가장자리 절단(앞자리/끝소수)도 같은 패딩으로 완화.
- **출처:** `2026-06-24 v0.19.0 하니스 재인식 대조`(BL-6 확정) → 차기 릴리스 백로그
- **현재 상태:** 🔲 미구현(차기) — 데이터 무결성 무관이라 우선순위 Med. `Deliverables/2026-06-24-v0190-real-device-analysis.md` §클립 재인식 대조.

### [CLIP-MIDSPEECH-1] 트림이 발화 *중간*을 잘라 이어붙임 → **가드레일로 이동**
- ✅v0.21.0 해결. `audioTrim.buildKeptRanges`를 **단일 포괄 범위**로 유지해야 하는 계약이라
  [ENGINEERING-GUARDRAILS.md](./ENGINEERING-GUARDRAILS.md) ⑤로 옮겼다. `audioTrim.ts`를
  고치려면 그쪽을 먼저 읽어라.

### [CLIP-BLANK-2] 약한 초반 세그먼트가 트림 시작을 앞으로 끌어당김 → **가드레일로 이동**
- ✅v0.24.0 해결, 2026-06-30 실기기 측정으로 확인됨. `findSpeechSegments`의 약한 세그먼트
  솎기(`SEG_KEEP_RATIO=0.25`)를 유지해야 하는 계약이라
  [ENGINEERING-GUARDRAILS.md](./ENGINEERING-GUARDRAILS.md) ⑤로 옮겼다.

### [VALUE-PERSIST-1] 이상치 교정값 미반영 의혹 — 인시던트 데이터 미재현, 진단 우선(v0.24.0)
- **의혹(v0.23.0 실기기, 2026-06-29 민구 제보):** "이상치 알람으로 새 값을 음성입력했으나 데이터엔 옛값, 음성클립만 교정값."
- **인시던트 데이터 검증(2026-06-29 zip, 결정적):** trend_alert_corrected 3건(r3→55.5·r9→188.8·r11→222.2) **전부 새 `value`(parsed=교정값) 이벤트 + persisted `sessions.json` 값도 교정값 일치** → 값 커밋·persist 모두 정상, **미재현**. 값은 `useSessionStore`(setRowValue)→`composeRowValues`→`persistSession`→`useDataStore`(데이터탭 표시) 경로.
- **잠재 경합(이론):** 값 커밋마다 fire-and-forget `persistSession()`이 겹쳐 돌 때 `await saveSession`→`upsertSession` 순서가 뒤집히면 옛 스냅샷이 last-writer-wins로 교정값을 덮을 수 있음(교정 간격 수 초라 이번 미발생).
- **조치(v0.24.0, 방어+가시화):** ① `persistSession` **단조 가드**(`persistSeqRef`/`persistAppliedSeqRef`) — 더 오래된 스냅샷이 최신 dataStore upsert를 덮지 못하게. ② trend 교정 커밋 직후 committed vs persisted 비교 로깅(`trend_corrected_persist_check:ok|mismatch`) → 다음 실기기 재현 시 근인 즉시 포착.
- **현재 상태:** ⚠️주시(진단 우선) — 추측 수정 금지(데이터 정상). 다음 실기기 mismatch 로그로 확정.
- **✅ 2026-06-30 v0.24.0 실기기 2세션 — 미재현·가드 정상:** `trend_corrected_persist_check` **ok×17(S1 4·S2 13)·mismatch 0**. 교차검증: 정정행 persisted=최종 committed(S1 r8c8 `1600→16→166.6` persist=166.6 등). 단조가드 안전·레이스 미발현, mismatch 0=미발생(미포착 아님). 다음 mismatch 시에만 재오픈.

### [STT-DEC-NONBUG] 소수점 복구값 오커밋 의혹 — 1차 증거로 반증(코드 변경 없음)
- **의혹(v0.20.0 분석 1차 패스):** `decimal_fraction_recovered:311.1`이 로그됐으나 셀엔 `하나`가 커밋된 듯 보임(A r16c7, B r11c7=`하나`, B r15c7=`아홉`) → 복구값이 stray STT 단어에 덮이는 레이스 의심.
- **반증(Mack 추론 + Larry 실측 확정):** ① **이 2세션 `sessions.json` 최종 저장값 직접 확인(결정적): A r16c7=`311.1`, B r11c7=`211.1`, B r15c7=`299.9` — 전부 복구된 정답.** `value text='하나'/'아홉'` 이벤트는 복구값 커밋 ~2초 뒤 들어온 stray STT지만 **셀에 살아남지 못한** stale 중간 이벤트(시트 생존 0건). ② 코드상 커밋 경로(`setRowValue`)는 `parseValueForCol` 출력만 쓰고, 소수 복구→커밋이 동기·무await(1300→1373→awaiting=null)라 이후 stray final은 `if(!awaiting) return`에 차단 — 셀 보존이 구조적으로 보장됨. (Mack의 v0.17.0 doc 인용은 다른 세션이라 무효였고, 이 2세션 실측으로 대체.)
- **현재 상태:** ✅반증(없는 버그, 2세션 최종값 실측 확인) — 수정·회귀테스트 추가 안 함.
- **별건 잠재 갭(⚠️주시, 미수정):** `handleInterim`(~1739) 조기확정 경로가 `awaiting.fractionWhole`을 무시 → fastRecognition **ON**이면 소수부 재질문 중 합성값(`311.1`) 대신 bare `"1"` 조기 커밋 가능. **현재 휴면**(fastRecognition 기본 OFF, 실데이터 조기커밋 0건). 차기 트리아지용 기록.

---

### [STORE-1] 앱 업데이트 시 savedSheets(저장 시트 목록)가 비워짐 — async IDB 복원 완료 전 빈 setItem이 미러를 덮음
- **증상(민구 제보, 2026-06-23):** "홈 설치형(설치 앱 아이콘)에서 **앱 업데이트 시에만** 저장된 구글 스프레드시트 링크 목록이 사라진다. 평상시 실행은 유지된다."
- **원인(코드 추적):** persist 스토리지가 `mirroredStorage`(localStorage 1차 + IDB 미러, `settingsStore.ts`). 업데이트 부팅 시 localStorage가 evict되면 `getItem`이 **비동기 IDB 복원 Promise**를 반환하는데, 복원이 끝나기 **전** 부팅 초기 `set()`(인증/컬럼 reconcile 등)이 기본값 `savedSheets:[]`를 직렬화해 `setItem` write-through가 **IDB 미러를 빈 배열로 덮어** 영구 소실. (migrate의 savedSheets 검증 블록은 버그 아님 — 빈 배열 `.every()`는 vacuously true라 강제 초기화 안 함.)
- **해결·회피(v0.19.0 W2):** ① **하이드레이션 게이트** — `hydrationComplete` 플래그 전엔 `setItem`의 IDB write-through 보류(localStorage 1차 쓰기는 유지=동기 동작 보존). `onRehydrateStorage`에서 1회 해제(세 부팅 경로 공통, 기존 `settings_hydrated` breadcrumb와 동일 위치). ② **전용 IDB 레코드**(`db.ts` `saveSheetsRecord`/`loadSheetsRecord`, key `__saved_sheets__`) — saveSheet/removeSavedSheet에서만 써서 bulk write-through에 안 덮임. 부팅 시 settings savedSheets가 비면 이 레코드(+sheetUrl)로 결정론적 복원(`saved_sheets_restored_from_record:N` 계측). ③ persist `version` 9→10. 재현 테스트 `tests/settings-migration.spec.ts`(전용 레코드 복원 red→green 입증).
- **출처:** `2026-06-23 세션`(민구 제보) → **survey-011 v0.19.0** 수정
- **현재 상태:** ✅수정됨(전용 레코드 복원은 단위테스트 입증, 하이드레이션 게이트는 코드추적 정확·레이스 비결정성으로 단위 미커버) — **iOS 실기기 검증 대기.**
- **⚠️ 미검증 전제(다음 세션 분기):** 수정은 "iOS PWA 업데이트 시 **IndexedDB는 살아남고 localStorage만 evict된다**"를 가정. 만약 다음 실기기 업데이트에서 **여전히** 목록이 사라지면 IDB도 함께 비워지는 더 강한 제약 → **대비책: 재로그인 후 Drive에서 최근 사용 시트 목록 재발견(시트는 사용자 Drive에 있으므로 저장소 독립 복원)**. (token은 별도 키라 업데이트 시 여전히 만료 → 재로그인 후 살아남은 목록에서 1-탭 재연결, 설계 의도와 일치.)
- **⚙️ 후속(v0.19.0 실기기 → v0.20.0):** 민구 제보 "새 세션 추가 후 시트에 추가 **버튼 무반응·메시지 없음**" = **토큰 만료**(IDB evict 아님, 민구 재확인). 근본은 ① 토큰 만료 사유가 화면에 안 떴고(`report.ok===0` 메시지 미표출) ② 재로그인 유도 없음. **v0.20.0 수정:** `SyncReport.needsLogin`(토큰 null 프리플라이트 + 401/403 `isAuthFailure`, 문자열매칭 아님) → 시트동기화·Drive백업·복구 공통 `LoginRequiredModal` 마운트 + `report.message` 무조건 표출 + 재로그인 후 stashed 액션 resume(sheetUrl 살아있으면 그대로, 비었으면 `savedSheets[0]` 재연결). 회귀 `tests/sync-token-expiry.spec.ts`. **⚠️ 잔존(보수):** 백업-only 재로그인 resume은 표시상 닫히나 이미 synced면 백업 재푸시 안 됨(향후 백업 전용 retry 항목). 주 케이스(동기화 시작 시 만료)는 시트 프리플라이트에서 잡혀 sheet+backup 완전 재개.

### [CLIP-DEVICECHANGE-1] v0.14.0 회귀 — 유휴 중 입력장치 변경 시 전 세션 클립 소실
- **증상:** 측정 중 BT 연결/해제 등으로 `devicechange`가 한 번 발생하면 그 뒤 세션 내내 `clip_no_stream`·`clip_empty`로 모든 음성클립이 빈다(STT 값은 정상 저장 — 인식은 자체 오디오 경로라 무관).
- **원인:** `audioRecorder.ts handleDeviceChange()`가 유휴(녹음 중 아님)일 때 `recoverStream('devicechange')` 호출 → recoverStream이 **살아있는 스트림을 먼저 파괴한 뒤** `getUserMedia` 재호출. iOS Safari는 **사용자 제스처 밖 getUserMedia를 NotAllowedError로 거부** → 멀쩡한 스트림까지 잃고 영구 복구 불가. 이후 빈 클립마다 `useVoiceSession recoverStream('clip_empty')` 재시도도 전부 실패(제스처 없음). v0.14.0이 [IOS-5] "devicechange 시 재-getUserMedia 안 함" 정책을 깬 것이 근인.
- **해결:** v0.22.0 — 유휴 devicechange에서 자동 재-getUserMedia 제거(비파괴 라벨 갱신만, [IOS-5] 복귀). clip_empty 자동 재시도 게이트(폭주 차단). 스트림이 실제로 죽으면 `micLost` 노출 → **사용자 제스처(입력탭 "마이크 재연결" 버튼)에서만** 재획득(iOS의 유일한 복구 경로).
- **출처:** `2026-06-25 v0.21.0 실기기 로그`(sess_1782355366530, 세션시작 +2.6s devicechange → `clip_recorder_recover_failed:devicechange` → clip_no_stream×56·clip_empty×41; firsthand 코드 확인).
- **현재 상태:** ✅**수정 확정(v0.22.0 실기기 검증, 2026-06-26).** 2026-06-26 v0.22.0 실기기 2세션 로그에서 확인: S1 `clip_no_stream` **56→1**로 격감(`clip_empty` 0). S2는 실제 `input_device_changed:refresh:track_ended:블루투스→내장` 발생 → `clip_empty`×1 → `mic_lost:clip_empty` 래치 → 사용자가 "마이크 재연결" 탭 → `mic_reconnect_ok`+`clip_recorder_recovered`로 **복구 성공**. 전환 순간 1~2건만 손실(이전엔 전 세션 소실). ⚠️ 전환 순간 `clip_empty` 잔존(AUDIO-ROUTE-1 네이티브 셸 영역). 출처 `Deliverables/2026-06-26-v0220-real-device-analysis.md`.

### [CLIP-MANIFEST-1] `clips-manifest`의 `sttText`/`confidence`가 **커밋 이후 같은 셀에 들어온 비커밋 발화**로 덮인다 → 다음 클립 감사가 거짓 MISMATCH를 낸다
- **증상(2026-07-27 클립 감사 중 발견, 미제보):** `sess_1785113726954`의 row16 `c1la8byb`(횡경)는 **10:07:44에 "311.1"(conf 0.995)로 커밋**됐는데, 매니페스트에는 `committedValue:"311.1"` / **`sttText:"완료"`, `confidence:0.935`** 로 적혀 있다. "완료"는 **10:09:16**에 완료행 재방문(`review_wait:row=16`) 중 들어온 발화로, **값으로도 명령으로도 처리되지 않고 거부**된 것이다(대응 `value`/`command` 이벤트 없음).
- **🟢 오디오는 무손상이다.** 파일 크기 **47,404 / 438,924 바이트**가 10:07:44의 `clip_saved:47404` / `clip_raw_saved:438924`와 **정확히 일치**한다. 덮인 것은 매니페스트의 `sttText`/`confidence` **필드뿐**이고, 시트 값도 정상(같은 회차 36/36 완전 일치).
- **원인(소스 확정):** `src/lib/clipsManifest.ts`의 `findLastCellEvent()`가 이벤트 배열을 **뒤에서부터 스캔해 첫 `value|stt` 이벤트를 채택**한다 — **커밋 여부를 보지 않는다.** 그래서 커밋 뒤에 같은 (row, colId)로 들어온 **거부된 STT 결과가 최신값으로 이긴다.**
- **왜 고쳐야 하나:** SOP-003 §3 클립 감사의 1차 오라클이 **`sttText` ↔ `committedValue` 대조**다. 이 오염이 남으면 감사자가 **거짓 MISMATCH**를 잡고 `:raw.wav` 재전사에 시간을 쓴다. 실제로 이번 회차에서 그 경로를 밟았다.
- **정상 케이스와 구별할 것:** 같은 회차의 다른 4건(`sttText:"하나"` / `committedValue:"311.1"` 등)은 **결함이 아니다** — `decimal_fraction_recovered` 경로라 `value` 이벤트의 `text`가 원발화("하나"), `parsed`가 복구값(311.1)인 **설계대로의 값**이다.
- **권장 수정 방향:** `value` 이벤트를 우선 채택하고 `stt`는 해당 셀에 `value`가 없을 때만 폴백. (또는 커밋 시점 ts 이하로 스캔 범위를 제한.)
- **[CLIP-CORRECTION-1]과 별건:** 그쪽은 **오디오 클립의 컬럼 오태깅**이고, 이건 **매니페스트 메타데이터 선택 규칙**이다.
- **출처:** `2026-07-27 실기기 로그` Trace 클립 감사(텍스트 레벨). 분석: `Deliverables/2026-07-27-survey-011-log-analysis.md` §4 F5. **현재 상태:** 🔴미수정(v0.39.0).

### [CLIP-INIT-SILENT-1] 장기 백그라운드 복귀 뒤 세션 시작 — 마이크 획득 실패가 **무음**이라 전 세션 클립 소실 (F11 "음성클립 소실 위미리3407")
- **증상(2026-08-05 실기기, v0.44.0):** 85분 백그라운드(04:39→06:04, **data 탭에서**) 복귀 뒤 06:06 시작한 세션(sess_1785877588821)이 **시작부터 `preroll=unavailable`·`clip_no_stream`**, 첫 커밋마다 `clip_empty`(×62) — **37분·63행 전체가 클립 0개**(`clipCount:0`). 값 커밋·시트 동기화는 **전량 정상**(63행 synced) — 소실은 증거 채널(클립)만. 같은 세션에서 "마이크 끊김 알람인데 입력은 됨" 혼란 제보(F10)도 발생 — 배너가 클립 스트림 사망을 "마이크 연결 끊김"으로 표기해서다.
- **원인:** F18(v0.44.0)의 시작 클릭 선행 `init()`의 getUserMedia가 **즉시 거부**(NotAllowedError 추정 — [MIC-B2] "iOS 오디오 세션 물림" 클래스, 2026-07-24 세션B와 동일 표면). 그런데 ①이 실패가 **어떤 이벤트도 안 남기고**(`init()`은 `lastInitError`에 담을 뿐) ②경고 없이 세션이 그대로 시작됐다. 이후 자동 1회 + 수동 배너 탭 **재연결 16회 전부** `clip_recorder_recover_failed:...NotAllowedError` — **물림은 페이지 수명 내내 지속**돼 페이지 안에서는 복구 불가(실효 복구 = 앱 완전 종료 후 재실행). ③ [MIC-B2]의 복귀 선-정리(`teardownAudioGraph`)는 `useVoiceSession`(VoiceScreen) 소속이라 **data 탭 복귀에는 아예 안 돌았고**(06:04:41 복귀에 `foreground_return` 이벤트 자체가 없음 — 04:06:55·06:26:12 voice 탭 복귀에는 있음), 돌았어도 세션 종료로 `rec=none`이라 no-op이었을 것(= v0.38.1 사다리의 "found=none → 세션-레벨 물림 → reload 폴백" 갈래. **그 폴백은 미구현**).
- **v0.44.1 처방(경보·안내 — 물림 자체의 해소가 아님):** 시작 `init()` 실패 시 ①`mic_init_failed:err=<name>` 계측(다음 로그에서 물림/거부 판정 축) ②`mic_lost:init_failed` 래치 → 재연결 배너를 **세션 첫 화면부터** 노출(종전엔 첫 커밋 40초 뒤) ③TTS 1회 고지("음성 클립이 저장되지 않습니다…앱을 껐다 다시") — 세션은 막지 않는다(값 채널 정상). 배너 문구 정직화: "클립 녹음 끊김 / 값 입력은 계속 됩니다 · 재연결이 안 되면 앱을 껐다 다시 여세요"(F10 처방). 오라클 `tests/v0441-mic-init-failed.spec.ts`(거부·승인 양방향, 반증 확인).
- **미해결(다음 회차):** ⑴복귀 선-정리의 탭 커버리지 — App 레벨 이동 + 고아 AudioContext 레지스트리(`detach()`가 참조를 먼저 버려 close 실패 시 영구 고아 — `micPrerollTap.detach` 주석 참조) ⑵"세션-레벨 물림 → 탭 게이트 reload 폴백"(v0.38.1 사다리 명시분) 구현 여부 ⑶`mic_init_failed`가 실기기에서 실제 어떤 err를 내는지 확인 후 물림 판정 자동화.
- **출처:** teamops `deliverables/2026-08-05-survey-011-v0441-clip-loss-analysis.md`(회차 판독). 원 로그 `inbox/2026-08-05-growth-log/` sess_1785877588821. **현재 상태:** 🟡 **MONITORING** — v0.44.1 경보 배포, 물림 재발 시 `mic_init_failed` 바이트로 판정. **실기기 상태:** ⚠️미확인.

---

## ③ iOS / TTS / Safari

### [IOS-7] `screen.orientation.lock('portrait')`은 iOS Safari에서 **아무 일도 하지 않는다** — 넣어둔 lock이 무효였다 🔴

- **증상(실기기 fb-01, 2026-07-24):** "세로모드 미고정 · 화면 회전 시 출력물 진동 오류". 조사 중 폰이
  가로로 돌아가면 입력 화면(세로 기준 설계)이 어그러진다.
- **함정의 핵심:** `src/lib/wakeLock.ts:51`에 `lockPortrait()`가 **v0.22.0부터 있었고**
  `VoiceScreen.tsx:63`이 세션 시작 시 호출해 왔다. 코드만 보면 "세로 고정은 이미 처리됨"으로 읽힌다.
  실제로는 **iOS Safari가 `ScreenOrientation.lock()`을 구현하지 않고**(구현한 브라우저도 fullscreen을
  요구한다), 함수가 `try/catch`로 조용히 삼켜 **성공도 실패도 남기지 않았다.**
  → **"호출했다 = 동작한다"가 아니다.** 특히 iOS는 표준 API를 no-op으로 두는 경우가 많고, best-effort
  `catch {}`가 그 사실을 감춘다. 같은 계열: [IOS-5](제스처 밖 gUM), [MIC-B2](AudioContext interrupted).
- **해결(v0.38.2):** `src/components/PortraitGuard.tsx` — `(orientation: landscape) and (pointer: coarse)`
  미디어쿼리로 가로를 감지해 **오버레이로 덮는다**(`lockPortrait()`는 지원 기기용 best-effort로 유지).
  - 🔴 **오버레이이지 언마운트가 아니다.** 트리를 조건부로 갈아치우면 `VoiceScreen`이 unmount돼
    인식기·워치독·클립 레코더가 teardown된다 = [STT-16]이 실기기 62초 사공백으로 겪은 실패.
    **회전은 조사 중 수시로 일어나므로 탭 전환보다 더 자주 세션을 죽인다.**
    회귀 테스트가 이 계약을 잠근다(`v038-portrait-guard.spec.ts` — 회전 왕복 후 발화가 그대로 커밋되는지).
  - **판정에 화면 폭을 쓰지 않는다.** 폰이 가로가 되면 `innerWidth`가 402→874로 커져 `App.tsx`의
    `isMobile`(≤480) 판정이 **뒤집힌다** — 방어하려는 바로 그 순간 조건이 무너진다. `pointer`는 회전에 불변.
  - **보조공학 격리 필수.** `position: fixed`로 덮어도 VoiceOver·스위치 제어 포커스는 뒤쪽 앱을 훑고
    **실행까지 된다**(라운드A 리뷰 Codex #4 · agy #1 수렴 지적). 형제 노드를 `inert` + `aria-hidden`으로
    막고, 세로 복귀 시 **우리가 켠 것만** 원복한다(격리가 남으면 앱 전체가 조작 불가로 굳는다).
  - **태블릿 가로도 차단한다(민구 확정).** 입력화면이 세로 기준 설계라 태블릿 가로를 열어주면
    **검증한 적 없는 레이아웃이 현장에 노출된다.**
- **잔여:** "회전 시 출력물 **진동**"은 별건이다 — `useFitScale.ts:65-67`의 ResizeObserver가 `el`과
  `el.parentElement`를 동시에 관측하는데 fit 루프가 `el`의 CSS 변수를 바꿔 RO를 재발화시킨다.
  **F3(입력화면 UI)가 이 훅들을 다시 쓰므로 F3 수용기준으로 이월**했다(지금 감쇠를 넣으면 F3가 덮어쓴다).
  - 🔴 **위 원인 특정은 F3(2026-07-25)에서 반증됐다 — 추가 기록(위 진단은 원문 보존).**
    자기관측(`ro.observe(el)`)을 **그대로 둔 상태로** 회전(양축 뷰포트 변경) 전후 `--fit-lo`를
    25ms 간격 2초씩 샘플링했다(이상치·수정 재안내·hero 3종 카드, 375×667↔667×375 왕복).
    **시계열이 한 번도 흔들리지 않았고 style 재기록도 0건이었다.**
    - **왜 진동하지 않나:** `fit()`은 후보 단계를 **적용한 뒤** `fits()`로 측정한다. 즉 선택된
      단계는 자기 padding·자기 폰트가 반영된 레이아웃에서 판정된 **자기일관적** 값이다. RO가
      다시 깨워도 같은 가용 박스에서 같은 단계로 수렴하고 멈춘다 — 자기관측은 중복 1회를
      더할 뿐 쌍안정 루프를 만들지 않는다.
    - **일반 교훈:** "RO가 자기가 바꾸는 것을 관측한다"는 **구조만으로는 진동의 증거가 아니다.**
      피드백이 진동이 되려면 두 상태가 서로를 되부르는 **쌍안정**이어야 한다. 코드 형태로 원인을
      특정했으면 계측으로 확인하기 전엔 "원인"이라고 쓰지 않는다.
    - **F3에서 한 일:** 자기관측은 제거했지만(부모만 관측 + epsilon dedupe) 이는 **방어적 단순화**이지
      검증된 수정이 아니다. 대신 진동의 사용자에게 보이는 형태("안 바뀐 요소가 따라 움직인다")를
      구조적으로 끊었다 — 파형 밴드가 `window.innerHeight` 파생인데 **자기 grid 트랙(auto)** 을
      차지해서 밴드 높이가 흔들리면 컨트롤바가 따라 움직이고 중앙 흡수영역이 늘었다 줄었다 했다.
      새 레이아웃은 밴드를 하단 25% 트랙 **안**에 넣어 그 전달 경로를 없앤다
      (`tests/v039-active-zones.spec.ts` — 높이 스윕에서 밴드 높이는 변하는데 25/50/25는 불변,
      상태 전환에도 구역 경계 픽셀 불변. 옛 트랙 구성으로 되돌리면 실패하는 것까지 확인).
    - **현재 상태:** ⚠️ **진동 자체는 재현하지 못했다(실기기 게이트).** 실제 원인 미확정.
- **출처:** 2026-07-24 실기기 fb-01 → v0.38.2 라운드A(Larry 구현 · Codex+agy Flash 리뷰).

### [IOS-6] 이상치 알람 TTS가 "확인해주세요"로 끝나 self-confirm 환각 위험 + 알람 중 barge-in 미작동(계측 대기)
- **증상(민구 제보):** 스피커폰/이어폰 모두 일반 안내 중 barge-in(끼어들기 발화)은 어느 정도 되는데, **이상치 알람 중에는 barge-in이 정상 작동 안 하는 느낌**.
- **원인(코드 추적):** ① 알람 TTS가 literally **"…확인해주세요."로 끝남**(`useVoiceSession.ts` alertText). `detectCommand`는 startsWith 매칭이라 `detectCommand("확인해주세요")==='confirm'` → 스피커폰에서 이 TTS가 마이크로 새어 들어가면 **알람이 스스로 confirm되어 닫히는** self-confirm 환각([IOS-3]의 알람판). 현 post-TTS 가드는 이를 막는 보호 역할도 겸함. ② 알람 TTS가 길어(추정 3~4s) post-TTS 가드 윈도우(재생중 전체 + 종료후 250ms)가 알람 발화 거의 전 구간을 덮어, 스피커폰에서 알람 도중 '확인'/'유지'/새값이 `stt_blocked_tts_muted`로 폐기 → "barge-in 안 됨" 체감. ③ trendConfirm 응답은 `handleInterim` early-return이라 조기확정을 못 받고 풀 EOS 꼬리(~1.7s)를 먹어 지연 가중. ④ 이어폰 알람 barge-in 비정상은 코드상 명확한 차단 지점 특정 실패 — needs-real-device-data.
- **해결·회피(v0.13.0 R7, 민구 결정):** alertText를 **"이상치 알림. {값}. 직전 조사보다 {N} 증가/감소했습니다."**로 — 끝의 "확인해주세요" 제거(self-confirm 환각 원인 제거), 앞에 "이상치 알림" 접두(화면 안 보는 현장 식별). **barge-in 가드 자체는 변경하지 않음** — v0.11.0 비 오는 비닐하우스에서 가드 스택이 환각 0건 유지([STT-6])한 성과를 후퇴시키지 않기 위함. 가드 단축은 실기기 near-miss 분포 확인 후 별도 판단(측정 우선 원칙).
- **출처:** `2026-06-18 세션`(민구 제보 + 결정) → **survey-011 v0.13.0** (TTS 재구성). barge-in 가드 튜닝은 미적용(계측 대기).
- **⚙️ 후속(v0.15.0 A6 — 스피커폰 모드 + post-TTS 가드 제거):** 민구가 "스피커폰 모드 ON 시 바지인 안 됨"을 불편으로 지목 + Trace v0.14.0 로그분석(`stt_blocked_tts_muted` 전체 **1건뿐**, 입력실패 실체는 `rejected_low_confidence` 7건·모드무관)으로 **스피커폰 모드 자체와 post-TTS 가드(`postTtsGuard.ts`)·TTS중 명령차단을 제거**(`speakerphoneMode` 삭제, settings persist v8→9). 즉 barge-in을 막던 주 가드가 사라져 알람 중 barge-in이 기본 동작으로 열림. self-confirm 환각 위험은 v0.13.0 alertText 재구성("확인해주세요" 제거)으로 **이미 구조적 차단**되어 가드 없이도 방어됨. 알람 TTS 문구도 v0.15.0에서 "추세 알림"으로(명칭 통일).
- **현재 상태:** ⚠️주시 — TTS 문구 ✅(self-confirm 구조적 제거), 가드 제거로 barge-in 기본 개방. **다음 현장 테스트 필요:** 알람 도중 의도적 발화가 정상 끼어드는지 + self-confirm 환각(알람이 스스로 닫힘) 재발 0 확인. 가드 부재가 소음 환경 오인식을 늘리는지도 관측(이전 가드 스택의 [STT-6] 환각 0 성과 대비).

### [IOS-4] SpeechSynthesisUtterance.voice에 plain object 할당 시 TypeError
- **증상:** `utterance.voice`에 plain object를 넣으면 TypeError(특히 mock/테스트 환경).
- **원인:** `voice`는 실제 `SpeechSynthesisVoice` 인스턴스만 허용.
- **해결·회피:** `speak()`/`warmupTts()`에서 voice 할당 시 타입 가드.
- **출처:** `growth-survey-010@0eaa59a`
- **현재 상태:** ✅**가드 확인**(2026-07-26 코드 감사) — `src/lib/speech.ts`의 두 발화 경로(`:551`·`:601`) 모두 `try { u.voice = v } catch {}`로 감싸 plain-object voice에서도 TypeError가 흐름을 끊지 않는다.

### [IOS-5] 스피커폰 모드 ON인데 출력이 이어피스(리시버)로 강제 전환 — getUserMedia `echoCancellation:true`의 voice-processing 세션
- **증상:** 사용자가 설정에서 스피커폰 모드를 켰는데도(소음 현장 대응) TTS 안내 음성이 스피커가 아니라 **이어피스(리시버)** 로 나가 잘 안 들림. iOS 18.7 / WebKit 26.5 실기기.
- **원인 — 🔴 2026-08-19 정정(기제만 바뀐다 · 결론은 그대로).**
  앱이 출력 라우팅을 전혀 제어하지 않는다는 사실(`setSinkId`/`sinkId`/`setAudioOutput` grep = NONE;
  `speakerphoneMode`는 소프트웨어 half-duplex/STT 임계값 전용)과 **iOS Safari엔 출력을 강제할 Web
  API가 없다**는 결론은 유효하다. 바뀐 것은 **왜 리시버로 가는가**다.
  - **종전 설명(틀렸다):** *"`echoCancellation:true`를 요청받으면 마이크를 voice-processing 오디오
    세션으로 열고, 그 모드에서 OS가 출력을 리시버로 라우팅한다."*
  - **실제(WebKit `safari-7624.4.5-branch` = 26.6 대응 브랜치 소스 직접 대조, `rmic` 리서치
    2026-08-19):** `MediaSessionManagerCocoa::updateSessionState()`에 **`echoCancellation`을 보는
    분기가 없다.** **캡처가 하나라도 있으면** 무조건 `PlayAndRecord` + `VideoChat`
    (→ `AVAudioSessionModeVideoChat`)이다. 즉 세션 카테고리·모드는 **EC 설정과 무관**하게 정해진다.
    `echoCancellation`이 실제로 바꾸는 것은 **AudioUnit 한 겹 아래**다 —
    `CoreAudioCaptureUnit.cpp`의 `m_shouldUseVPIO = enableEchoCancellation();`
    → `kAudioUnitSubType_VoiceProcessingIO` vs `kAudioUnitSubType_RemoteIO`.
  - 👉 **`echoCancellation:false`를 「라우팅/세션 해법」으로 기대할 근거는 없다**(종전보다 더
    분명해졌다). 🔴 **블라인드 플립 금지 판단은 그대로 유지한다.**
  - ⚠️ **결론을 뒤집지 마라**: 바뀐 것은 *왜 그런가*이지 *무엇이 관측됐는가*가 아니다.
    v0.12.0 종결(토글 제거 · EC 항상 ON)은 실측 A/B에 근거하며 유효하다.
  - 📎 관련: 같은 소스 대조가 `[CLIP-SILENT-1]`의 「살아 있는 무음」에 대해 **파괴 없는 캡처 유닛
    재구성**(`applyConstraints`로 `reconfigure()` 유발) 가능성을 열었다 —
    `deliverables/2026-08-19-research-rmic.md` §3-C. **미검증이고 민구 결정 대기다.**
- **해결·회피(미확정 — 트레이드오프):** `echoCancellation:false`(또는 speakerphoneMode일 때만 false)로 열면 voice-processing 세션을 피해 스피커 출력이 유지될 *가능성*. 단 [CLIP-4]의 의도적 `echoCancellation:on`(빗소리 에코 되먹임 감소)과 [IOS-3] phantom 입력 위험과 충돌 → **블라인드 플립 금지, 측정 A/B 필요**(라우팅·에코·노이즈 오인식 3축 비교).
- **v0.9.0 실험(A/B 빌드):** 민구 결정 — "일단 입력탭에 스피커/이어폰 토글을 넣어 실기기에서 측정". 입력탭 우상단 토글(`speakerOutput`, 기본 이어폰=현행). 스피커 선택 시 `audioRecorder.setOutputMode(true)`가 마이크 스트림을 **`echoCancellation:false`로 재취득**(`acquireStream`/`reacquire`)해 voice-processing 세션 회피를 시도한다. `speakerphoneMode`(소프트 half-duplex)와는 **독립**(혼동 금지). `audio_route_changed`/`audio_reacquired:ec=<bool>` 텔레메트리로 다음 로그에서 출력 dB·STT 오인식률을 A/B 측정. ⚠️ 미검증: iOS에서 실제 스피커 전환 여부(OS 의존, 안 바뀔 수도)·세션 중 재취득 시 0.3~0.5s 인식 끊김. 재취득 실패 시 stream=null로 남아 `clip_no_stream`(안전선).
- **v0.12.0 종결(민구 결정, 2026-06-17):** `speakerOutput` 토글 + `setOutputMode`/`reacquire` **전부 삭제**. 근거 — ① v0.11.0 비 오는 비닐하우스 로그 Log2에서 토글을 실제 A/B(스피커↔이어피스, `audio_reacquired:ec=true/false`)했으나 출력 라우팅이 실제로 바뀐다는 증거 없음(iOS 미제공 재확인) + 토글이 "눌러도 글자만 바뀌고 작동 안 한다"는 민구 보고와 일치. ② `echoCancellation`은 이제 **항상 ON 고정**(이어피스 기본). 출력 강제는 PWA 불가 확정 → **AUDIO-ROUTE-1 네이티브 셸(Capacitor)** 경로로만 해결(B0 WKWebView STT 스파이크가 게이트, 본 항목 비범위). 입력탭 토글 자리는 **읽기전용 입력장치 CATEGORY 배지**(🎧 블루투스 / 📱 내장 마이크 / 🎧 유선)로 교체 — 출력이 아니라 어떤 마이크로 듣는지 표시. `speakerphoneMode`(소프트 half-duplex)+post-TTS 가드는 **독립이라 유지**. persist v6→7(speakerOutput 영속값 삭제).
- **출처:** `2026-06-15 v0.7.0 실기기 로그` (민구 제보; 코드 firsthand 확인) → `2026-06-17 v0.11.0 로그`(A/B 무효과 + 민구 토글 제거 결정). ✅ **메커니즘 교차확인 완료(2026-08-19)** — WebKit `safari-7624.4.5-branch` 소스 직접 대조(`deliverables/2026-08-19-research-rmic.md` §2-4). 종전 「미수행」 표기를 해소한다.
- **현재 상태:** ✅PWA 레벨 종결(토글 제거, echoCancellation 항상 ON) — 출력 강제는 AUDIO-ROUTE-1 네이티브 셸로 이관. `src/lib/audioRecorder.ts` acquireStream(echoCancellation:true 고정).

### [WAKELOCK-REACQUIRE-1] 브라우저가 해제한 stale sentinel 때문에 화면 wake lock을 영구 재획득하지 못한다
- **증상:** 조사 중 브라우저가 화면 wake lock을 한 번 해제하면 이후 `hidden→visible` 복귀에서도
  재획득하지 못해 화면 자동 꺼짐을 막지 못한다.
- **원인:** 해제된 `WakeLockSentinel`은 객체가 사라지지 않고 `released=true`인 채 남는데,
  `useWakeLock`이 `release` 이벤트를 구독하지 않아 `sentinelRef.current`가 계속 truthy였다.
- **수정(2026-07-28, 미배포):** sentinel의 `release` 이벤트에서 현재 ref를 `null` 처리한다.
  실제 훅을 켠 회귀 테스트가 브라우저 해제 후 `hidden→visible`을 두 번 반복해 요청 수
  **1→2→3**을 단언한다. 수정 제거 반증은 첫 복귀에서 기대 2/실제 1로 실패했다.
- **현재 상태:** 🟡**MONITORING** — 데스크톱 회귀·반증 완료, iOS 실기기 화면 자동 꺼짐/복귀 판정 대기.

### [WAKELOCK-LOG-1] wake lock 획득·해제·재획득 실패가 로그에 전혀 남지 않는다
- **증상:** wake lock이 성공했는지, 브라우저가 해제했는지, visible 복귀 재요청이 거부됐는지
  로그만으로 판정할 수 없었다.
- **수정(2026-07-28, 미배포):** 신규 빌더 이벤트
  `wake_lock:action=<acquire|reacquire|release>,result=<attempt|ok|failed|unsupported>`를 추가했다.
  해제 source와 실패 Error.name도 저카디널리티 필드로 남기며 기존 이벤트 extra는 바꾸지 않았다.
  Playwright가 초기 획득, 브라우저 해제, 재획득 성공, `NotAllowedError` 실패를 실제 발화 순서로 고정한다.
- **현재 상태:** 🟡**MONITORING** — 자동화 및 바이트 특성화 완료, iOS 실기기 이벤트 수집 대기.

### [SCREEN-LOCK-1] 화면 잠금과 앱 전환이 모두 `lifecycle:vis_hidden`이라 원인을 구별할 수 없다
- **증상:** 같은 visibility 사이클이 화면 잠금인지 앱 전환인지 로그에 근거가 없어 실기기 제보 축을
  재구성하지 못했다. `[MIC-B2]`의 60초 백그라운드 문제와는 별도 항목이다.
- **수정(2026-07-28, 미배포):** 기존 `lifecycle:vis_*` 바이트는 보존하고, 각 visibility 순간의
  `focus`와 그 사이 실제 관측된 `blur/pagehide/freeze` 증거를 `visibility_context`로 함께 기록한다.
  `focus/pageshow/resume`을 포함한 원시 신호도 `lifecycle_signal`로 남긴다. 선행 증거가 없으면
  추측 라벨 대신 **`evidence=none`(구별 불가)** 을 명시한다.
- **현재 상태:** 🟡**MONITORING** — 합성 신호 회귀·바이트 특성화 완료. 웹 표준만으로 100% 분류하지
  않으며 iOS 실기기 패턴 수집 후 분석 측에서 판정한다.

---

## ④ 정정 · race · 데이터 유실

### [RACE-3] cascade 정정 중 stop/크래시 시 원본 측정값 유실 (4회 반복 수정)
- **증상:** cascade 수정 진행 중 사용자가 stop하거나 앱이 크래시/리로드되면 정정 전 **원본 행 데이터가 사라짐**.
- **원인:** cascade 수정이 in-memory 행을 초기화한 뒤 재완료(advance) 전에 중단되면, persistSession이 빈 행을 저장하거나 백업 행을 누락. 여러 엣지케이스(완료행 0개·flush lag·조기 반환)가 순차적으로 드러남.
- **해결·회피 (진화 과정):**
  1. cascade modify는 in-memory(sessionStore)만 초기화, IDB/dataStore는 재완료 시 persistSession이 덮어쓰도록 → 중단 시 원본 보존 (`a45cd24`).
  2. `correctionBackupRef`에 수정 시작 전 IDB 행 스냅샷 저장, stop 시 백업 행 포함 persist (`0e05b2e`).
  3. flush lag 구간 대비: 완료 직후 아직 flush 안 된 행은 실시간 sessionStore 값으로 백업 구성 (`f90c6cd`).
  4. completedRows가 비어도 correctionBackupRef가 있으면 persist 진행(조기 반환 이동) (`2075f8a`).
- **출처:** `growth-survey-010@a45cd24` → `@0e05b2e` → `@f90c6cd` → `@2075f8a` (같은 이슈 4회 반복). 추가 보강 `@ad60ba5`(행 values 초기화 + complete:false + completedRows/syncedRows 재계산).
- **현재 상태:** ✅**가드 확인**(2026-07-26 코드 감사) — `src/lib/useVoiceSession.ts`에 `correctionBackupRef` 배선 7곳, 회귀 `tests/correction-flow.spec.ts` 존재. 조상에서 4회 반복된 이슈라 **cascade 정정 경로를 건드릴 때는 이 백업 경로를 함께 확인**한다.

### [RACE-6] ensureTeamSubFolder race → 중복 Drive 폴더
- **증상:** 동시 업로드 시 팀 하위 폴더가 중복 생성되거나 검색 실패가 silent fall-through.
- **원인:** 폴더 ensure 로직에 캐시·정렬·에러 throw 부재.
- **해결·회피:** `settingsStore.teamFolderId` 캐시(다음 업로드부터 검색 생략), 검색 시 `orderBy=createdTime asc`(중복 시 가장 오래된 것으로 통일), admin 실패 시 캐시 무효화, Drive Q 문자열 escape 강화(backslash), 검색 실패 시 throw.
- **출처:** `growth-survey-010@8ce8dca` (v0.10.1, HIGH-2)
- **회귀 확보(2026-07-16, v0.35.1 Stage 1-3):** ensure 로직을 `src/lib/driveFolders.ts` `ensureEmailSubFolder`(캐시 주입형)로 통합 — 캐시는 호출부가 parent별 분리 주입(로그=teamFolderId, 개선요청=무캐시)해 다른 parent로의 오업로드를 구조로 차단. `tests/driveFolders.spec.ts`(Node 러너 6케이스: 캐시 분리·최고참 선택·검색 실패 throw·생성·escape)가 계약을 고정.
- **현재 상태:** ✅수정됨+회귀 확보 (2026-07-16)

### [CLIP-SILENCE-1] 음성 클립에 발화 전후 무음이 과다하게 포함됨
- **aliases:** `CLIP-2` (2026-07-26 고유화 전 ID — 아카이브의 `CLIP-PERSIST-KEY-1`과 ID가 겹쳤다)
- **증상:** 저장된 클립 재생 시 앞뒤 공백이 김. 06-08 로그 녹음 길이 평균 5.7초·최대 20.9초인데 실제 발화는 1–3초.
- **원인:** TTS 종료 후 녹음 시작 + STT final 후 종료라 발화 전후 무음이 통째로 저장됨. VAD/트리밍 없음.
- **해결·회피:** 저장 직전 진폭(RMS) 기반으로 발화 구간만 남기고 앞뒤 무음을 트림해 16kHz mono WAV로 재인코딩(`audioTrim.ts`). decode 불가/음성 미검출 시 원본 반환(iOS 안전 — 녹음 게이팅은 첫 음절 손실 위험이라 회피). 트림 발생은 `clip_trimmed` 이벤트로 추적.
- **출처:** `2026-06-08 세션` (민구 제보 + 로그) → **survey-011 v0.4.2** 추가
- **현재 상태:** ✅수정됨 (`src/lib/audioTrim.ts`, `src/lib/audioRecorder.ts` `stopClip` 통합; Chromium 실클립 검증 6998ms→1440ms, 128KB→46KB). ⚠️주시 — iOS Safari `decodeAudioData(webm/opus)` 작동은 다음 실기기 로그의 `clip_trimmed`로 사후 확인.
- **v0.5.0 주석(프리롤 도입):** 2026-06-10 로그에서 0.32~0.60s 초단 클립 7건 관측 — barge-in 시 발화 **앞부분**이 녹음 시작 전에 잘린 정황(트림 과다가 아니라 수록 자체가 늦음). v0.5.0에서 **0.5s 프리롤**(AudioWorklet PCM 링버퍼, 실패 시 ScriptProcessor → 그것도 실패 시 프리롤 없이 현행 동작 + `clip_preroll_unavailable` 로그)을 클립 앞에 결합하고, 트림 PAD를 비대칭화(앞 300ms / 뒤 180ms). **트림 전 원본(프리롤 포함)도 `:raw` 키로 보존**(민구 결정)하고 로그 zip에 포함, `clip_duration`에 `prerollMs` 동봉. iOS 실기기 효과는 다음 로그에서 정량 확인. **v0.5.0 실기기 확인(2026-06-11):** `clip_preroll_ready:worklet:44100` + 44개 `clip_duration` 전부 `prerollMs:500`, 초단(0.32~0.60s) 클립 **0건**(06-10 7건→0건), `clip_trimmed` 39건·`:raw` 원본 보존 39건 정상. iOS Safari 프리롤·트림 경로 정상 작동 확정.
- **[CLIP-BLANK-1] v0.9.0 — 발화 *사이* 긴 공백 잔존(내부 무음):** 2026-06-15 v0.8.0 실기기 후 민구 재제보(클립 공백 여전히 김). 원인: 기존 `findSpeechRange`가 **[첫 발화~마지막 발화] 단일 구간**만 돌려줘 그 *내부*의 긴 무음(예: 선언 후 한참 뜸 → 값)이 통째 보존됐다(앞뒤 무음만 잘림). v0.9.0: `audioTrim.findSpeechSegments`(다중 세그먼트, `MERGE_GAP_MS=150` 미만 갭은 한 발화로 병합) + `buildKeptRanges`(세그먼트별 비대칭 PAD 후 겹침 병합) + `concatRanges`(범위 사이 긴 무음 제거하고 이어붙임)으로 교체. 단일 세그먼트면 기존과 바이트 동일(회귀 없음), `KEEP_RATIO` no-effect·프리롤 폴백·`:raw` 보존 그대로. 회귀 `tests/audioTrim.spec.ts`(다중구간 갭압축 검증). ⚠️ 실기기 미검증: 선언+값 클립에서 공백만 제거되고 발화는 보존되는지, 첫 음절 유지.

### [CLIP-POINTER-1] 세션 첫 클립이 빈 캡처(`clip_empty`)로 저장 실패 → broken pointer(재생버튼 끊김)
- **aliases:** `CLIP-3` (2026-07-26 고유화 전 ID — 아카이브의 `CLIP-EPOCH-1`과 ID가 겹쳤다)
- **증상:** 세션의 **맨 첫 음성 클립**이 빈 버퍼로 stop돼 저장 안 됨. sessions.json은 해당 셀(row1 횡경 c7) audioClip 포인터를 `sess_…:1:c7…`로 등록하지만 디스크에 파일이 없어 데이터탭 재생버튼이 끊김(404). 값(11.1)은 정상 커밋 — audit-trail 클립만 손실.
- **원인(가설):** 0.5s 프리롤 링버퍼 워밍업과 **세션 첫 녹음 stop** 사이 타이밍 — 첫 캡처가 프리롤 PCM이 채워지기 전 stop돼 빈 버퍼 반환(`clip_stop_resolved:null` → `error clip_empty`). 둘째 클립부터는 정상. 빈 catch 아님(정상 계측됨 — REVIEW-1 준수).
- **해결·회피:** ① 빈 캡처 감지 시 셀 audioClip **포인터 등록 회수**(broken pointer 방지 — [CLIP-2/persistSession] 회수 패턴), 또는 ② 첫 녹음 전 프리롤 1프레임 워밍업 보장. 값은 영향 없으므로 우선순위 낮음(P2).
- **출처:** `2026-06-11 실기기 로그` (단일 세션 1건: row1 c7 `clip_empty`)
- **현재 상태:** ⚠️주시(가드는 들어갔으나 **레이스에 덮이는 실기기 증거 발견**, 2026-06-12) — 빈 캡처(`clip_empty`) 감지 시 `unlinkBrokenPointer`가 셀 audioClip 포인터를 **메모리(pendingClipsRef)와 이미 영속화된 세션 양쪽에서** 회수하되, 포인터가 여전히 우리 clipKey와 같을 때만 해제(이후 restart/modify가 재지정한 경우 보존)한다. 데이터탭이 404 재생버튼을 더는 렌더하지 않음. 값(audit-trail 외 측정값)은 원래부터 영향 없음. (이전: 06-11 백로그 CLIP-EMPTY(P2)) (`src/lib/useVoiceSession.ts`, `src/lib/audioRecorder.ts` `stopClip` 빈 버퍼 가드)
- **레이스(2026-06-12 발견):** 값 커밋이 포인터 사전등록 + fire-and-forget `persistSession()`을 먼저 실행하므로(첫 await 전에 포인터 포함 행을 동기 빌드), 그 persist가 in-flight인 동안 `clip_empty`→`unlinkBrokenPointer()`가 실행되면 **늦은 `upsertSession`/`saveSession`이 unlink를 되덮어 포인터가 부활**한다. 06-11 v0.6.0 실기기 로그 row8 c7에서 관측(수확된 sessions.json에 포인터 잔존). 해결은 [CLIP-VAL-1] ③(tombstone 또는 persist 직렬화)과 동일 — **v0.7.0에서 tombstone으로 봉합**([CLIP-VAL-1] ✅ 참조, 회귀 `tests/clip-modify-rerecord.spec.ts`).
- **🟢 2026-07-02 v0.25.0 실기기 — 기능2(mic prewarm) 효과 1차 확인(n=2):** `mic_prewarm_attempt`×3 → `_ok`×3(100%, denied 0; 소요 3394/394/1556ms), **`clip_empty` 0건**(양 세션) — v0.24.0(06-30 S1 r1c7 clip_empty)과 대비, 세션 첫 클립 유실 증상 소멸. 양 세션 r1c7 클립 실제 저장(트림 41KB/35KB + raw). 귀속 특이점: 경계에 걸친 prewarm은 attempt=`__app__`·ok=세션ID로 갈릴 수 있어 분석 시 ts로 짝지을 것(`useVoiceSession.ts:2208-2214`).

### [CLIP-DECIMAL-FRAG-1] 소수부 재질문 후 조각만 발화 시 원본 전체값 클립 유실 (값은 정상)
- **증상:** STT가 소수부를 조사로 오인식(`decimal_fraction_lost`) → 앱이 "N 점, 소수점 아래 숫자만 말씀해 주세요" 재질문 → 사용자가 **소수 한 자리만** 발화("구") → 커밋된 캐노니컬 키 클립에 **조각만** 저장되고 원래 전체값 발화("이십구 점 부")가 사라짐. `:raw` 안전망도 재시작마다 덮어써 **ZIP에서도 원본 복구 불가**. **시트 값은 합성으로 정상**(299.9). 민구가 row18 비고란(c9)에 직접 기록: *"소수점만 따로 발화시 앞의 정수 부분 클입은 잘림."*
- **원인:** `src/lib/useVoiceSession.ts:1338`의 무조건 `recorderRef.current?.startClip(); // restart clip`(모든 `stt_parse_failed` 재질문 직전)이 새 빈 슬롯(`src/lib/audioRecorder.ts:431 startClip()` → `chunks:[]`)을 만들어 재질문 직전의 **원본 전체발화 버퍼를 폐기**. modify/`clip_relink_cmd` 경로와 **무관**(일반 값-커밋 경로). 다른 재질문(multi_numeric·extraneous_token 등)은 전체 재발화를 유도하므로 새 클립이 정상 — **소수 재질문만 부분(조각) 발화를 유도**해 이 분기에서만 결정적으로 터짐. [RACE-4]/[CLIP-VAL-1]의 거울상(그쪽은 재시작 안 해 새 발화 유실, 이쪽은 재시작해 원본 유실).
- **해결(survey-011 v0.16.0):** 소수 재질문(`decimal_fraction_lost`) 분기에서만 **재질문 직전 `startClip()`을 생략**한다(`src/lib/useVoiceSession.ts`). 활성 녹음 슬롯이 재질문 TTS·조각 발화를 거쳐 계속 녹음하다가 commit 지점 `stopClip()`에서 **단일 연속 녹음**으로 stop되고, 기검증된 `audioTrim.findSpeechSegments`(긴 재질문 갭 ≫ `MERGE_GAP_MS` → 원본·조각 2세그먼트) + `concatRanges`(사이 무음 제거하고 이어붙임, CLIP-BLANK-1 경로)가 전체값으로 합성한다. **별도 cross-restart webm concat이 없어 iOS `decodeAudioData(webm/opus)` 위험([CLIP-SILENCE-1] ⚠️)을 구조적으로 회피**, `:raw`도 재시작이 없어 1회만 보존. 보존 동작은 `clip_decimal_kept` 이벤트로 계측. 전체 재발화 분기(multi_numeric·extraneous_token 등)는 종전대로 `startClip()` 재시작 유지(무회귀).
- **출처:** `2026-06-22 v0.15.0 실기기 로그`(4/4 결정적: 2879:15·18, 4316:11·16; ffprobe trim 0.80–1.76s vs 베이스라인 1.2–1.7s; 민구 row18 비고 현장 확증) — Trace 재분석.
- **현재 상태:** ✅수정됨(**survey-011 v0.16.0**) — 로직 검증 완료(회귀 `tests/clip-decimal-frag.spec.ts` 3건 + `tests/audioTrim.spec.ts:214` decimal-frag 2세그먼트 보존 + `clip-modify-rerecord` 4건 무회귀, 28 passed). **⚠️ 실기기 audit 대기:** 저장 webm이 iOS Safari에서 실제 전체값을 담는지는 다음 실기기 로그의 `clip_decimal_kept`+클립 길이로 최종 확인(단 기검증 CLIP-BLANK-1 경로 재사용이라 위험 낮음). **주의:** [STT-6] line 60의 `decimal_fraction_lost` 결론("데이터 유실 없음 — 마찰만")은 **값**에 대해서만 참 — 이 항목은 같은 트리거가 **클립 audit**를 유실시킴을 밝혀 v0.16.0에서 봉합한 것(모순 아님·정제).

### [SYNC-1] sheetRow 매핑이 외부 변경(시트 정렬·행 삽입/삭제)에 취약 — update가 엉뚱한 행을 덮을 수 있음
- **증상:** v0.6.0 행 단위 재동기화는 각 행이 처음 append된 1-based 시트 행번호(`sheetRow`)를 기억해 두고, 그 행을 수정하면 같은 행을 PUT(UPDATE)한다. 그런데 사용자가 **구글 시트에서 직접 행을 정렬·삽입·삭제**하면 그 행번호가 어긋나, UPDATE가 의도와 다른 행을 덮을 수 있다.
- **원인:** Sheets values API는 안정적 행 ID가 없어 위치(A1)로만 쓴다. 외부 편집은 앱이 알 수 없다.
- **해결·회피(완화):** updateRow가 404/400을 받으면(행이 사라짐/이동) 해당 행의 `sheetRow`를 초기화해 **다음 동기화에서 append로 폴백**하고 `sync_row_mismatch` 텔레메트리를 남긴다. 위치가 살아있는 채 내용만 밀린 경우(정렬)는 감지 못 하므로, **동기화 후에는 구글 시트에서 행 순서를 바꾸지 말 것**을 권장. C5(탭명 따옴표)로 탭명 특수문자發 가짜 mismatch는 제거됨.
- **출처:** `survey-011 v0.6.0` Codex 교차점검(C5 연계); 회피 경로 회귀 `tests/sync-skip-rows.spec.ts`("update 404 → sheetRow 초기화 후 append 폴백").
- **현재 상태:** ⚠️주시(설계상 한계 — 404/400 폴백으로 데이터 손실은 막되, 정렬發 덮어쓰기는 사용자 운용으로 회피) (`src/lib/sync.ts` pass-2 404/400 폴백, `src/lib/sheets.ts` `rowA1Range`/`quoteSheetTitle`)

### [SYNC-2] append HTTP 성공인데 updatedRange 파싱 실패 — synced-without-sheetRow 엣지(이후 수정 시 재append 중복 수용)
- **증상:** `values:append`가 200으로 성공(데이터는 이미 시트에 있음)했으나 응답의 `updatedRange`를 파싱하지 못해 각 행이 시트 어느 위치에 떨어졌는지 모르는 극히 드문 경우.
- **원인:** 예기치 못한 응답 페이로드 등으로 `parseUpdatedRangeFirstRow`가 null 반환.
- **해결·회피:** **방침(C1):** 진실은 "데이터는 시트에 있다"이므로 해당 행들을 `syncState:'synced'`로 마크하되 `sheetRow`는 미설정(in-place UPDATE 불가). 성공으로 집계(appended 카운트·successIds 정상) → 백업/자동삭제 정상 진행, **재시도해도 synced 행이라 재append 안 함**(중복 방지의 핵심). 단, 이런 행이 **이후 수정되면** dirty이지만 sheetRow가 없어 pass-1 재append 대상이 됨 → 값은 최신으로 정확히 올라가나 **그 한 번의 중복 행은 수용**한다(극히 드문 엣지, 데이터 무손실 우선). 이전 방침(F4: 세션 실패→재시도)은 append HTTP가 이미 성공했으므로 재시도가 같은 행을 다시 올리는 더 흔한 중복을 유발해 폐기.
- **출처:** `survey-011 v0.6.0` Codex 교차점검(C1); 회귀 `tests/sync-skip-rows.spec.ts`("C1 — synced-without-sheetRow … 재append 안 함").
- **현재 상태:** ⚠️주시(수용된 엣지 — 발생 빈도 극저, 데이터 무손실) (`src/lib/sync.ts` pass-1 no-range 분기)

### [SYNC-3] 컬럼 스키마 순서/구성 변경 시 값이 위치기반으로 밀려 엉뚱한 열에 안착
- **증상(원 보고, v0.6.0):** 세션 생성 후 설정에서 **컬럼 순서를 바꾸면**, 이미 `synced`로 시트에 올라간 행들은 시트의 열 순서(append 당시 순서)와 로컬 열 순서가 어긋날 수 있었다.
- **증상(실사용 재현·재오픈, 2026-07-07 v0.28.0 A5, Sonar 실 Google 계정 업로드 테스트):** 로컬 세션이 구스키마(6컬럼)로 만들어진 채 실 10컬럼 시트(컬럼이 나중에 추가/변경됨)로 동기화하니, 값이 실제 헤더와 무관하게 A,B,C… 순서로 밀려 들어가 C,D,E열은 비고 F,G,H열에 안착 — **침묵 오정렬**(에러 없이 조용히 엉뚱한 열에 저장). 민구가 실사용에서 컬럼을 나중에 추가/변경한다고 확인해 "운용 회피"만으로는 부족해졌다.
- **원인(코드 확인):** `sync.ts`가 append/update 직전 값 배열을 **로컬 세션의 컬럼 순서(`session.columns.map(c=>c.id)`)만으로** 만들었다 — 실제 시트의 헤더 행과 전혀 대조하지 않는 순수 위치기반(positional) 쓰기였다. 로컬 스키마가 시트의 실제 현재 헤더와 다르면(순서만 다르거나, 시트에 컬럼이 추가/삭제됐거나), 값이 이름과 무관하게 물리적 위치로만 안착해 조용히 틀린 열에 들어갔다. 행 단위 재동기화는 값 변경(dirty)만 추적하고 **열 매핑 변화는 추적하지 않았다** — sheetRow는 위치만 가리키고 열 순서 메타는 행에 없었다.
- **해결(v0.29.0, Mack) — 근본 수정, 문서화 아님:** append/update 직전 `sync.ts`가 `sheets.ts`의 신규 `fetchHeaderRow()`로 **시트의 실제 현재 헤더 행을 syncSelected() 배치당 1회** 읽고(세션/행마다가 아니라 "시트에 추가" 클릭당 1회 — API 호출 비용 상한), 신규 `src/lib/columnMapping.ts`(`mapColumnsToHeader`/`buildRowForMapping`, 순수 함수)로 **로컬 컬럼을 이름 기준**으로 그 헤더에 매핑한다(순서 아님). 값은 각 컬럼의 **실제 헤더 위치**에 안착 — 시트 컬럼이 재배치·삽입돼도 이름만 같으면 정확히 맞아 들어간다. 로컬 컬럼명이 시트 헤더에 없으면("신규 컬럼") 그 값은 **아무 위치에도 쓰지 않고**(위치 추측 금지) `sync_column_missing_in_sheet` 텔레메트리 + `report.columnWarnings`로 사용자에게 경고(DataScreen 배너에 표면화) — "침묵 오정렬"을 없애는 게 핵심이므로 조용히 다른 열에 넣거나 조용히 버리지 않는다. 로컬 컬럼이 헤더와 **단 하나도** 매칭되지 않으면(총체적 스키마 불일치) 세션 전체를 명시적 실패로 보고한다(빈 값으로 "성공" 처리하지 않음 — 그 자체가 또 다른 침묵 오염이므로). 헤더 조회 자체가 실패하면(네트워크 등) 검증되지 않은 위치기반 쓰기로 되돌아가는 대신 배치 전체를 중단한다(정확성 > 가용성).
- **비용/캐싱 설계:** 헤더는 **호출마다** 새로 읽는다(세션 간 캐시 없음) — 오래된 캐시가 정확히 이 버그를 재도입할 위험이 있어 "정확성이 성능보다 우선" 원칙에 따름. 추가 비용은 "시트에 추가" 클릭당 GET 1회로 상한.
- **잔여 한계(정직하게 명시, v0.29.0 시점):** 이 수정은 **이제부터의 쓰기(append/update)만** 보장한다 — 이 수정 이전에 이미 잘못 안착한 과거 시트 행은 소급 복구되지 않는다(그 행들이 실제 어떤 매핑으로 쓰였는지 사후에 알 방법이 없음). ~~또한 UPDATE 경로는 로컬이 관리하는 최상위 매칭 컬럼까지의 범위를 한 번에 PUT하므로, 그 범위 안쪽 인터스티셜 위치에 이 앱이 추적하지 않는 시트 전용 컬럼이 있다면 그 자리는 빈 문자열로 재기록된다~~ **← 아래 후속수정(v0.29.x)으로 해소됨.**
- **후속수정(v0.29.x, Mack) — UPDATE 경로의 인터스티셜 컬럼 덮어쓰기 위험 근본 제거:** 민구에게 "이 앱이 append한 행에 나중에 시트에서 직접 다른 열(인터스티셜)에 값을 채워넣고, 그 후 앱에서 같은 행을 수정해 재동기화하는 워크플로가 있다/있을 수 있다"를 확인받아(2026-07-07), "드묾"이라는 원래 가정을 접고 UPDATE 경로 자체를 고쳤다. `sync.ts`의 UPDATE 패스가 더 이상 `sheets.ts`의 `updateRow`(연속 A1 범위 단일 PUT — `buildRowForMapping`의 밀집 배열로 매핑 안 된 인터스티셜 위치까지 `''`로 덮어씀)를 호출하지 않는다. 대신 신규 `updateCellsSparse`(Google Sheets API `spreadsheets.values.batchUpdate` — 한 번의 HTTP 호출로 여러 개별 range를 동시에 쓸 수 있다)를 호출하며, 요청의 `data` 배열은 신규 `columnMapping.ts`의 `buildSparseCellsForMapping`이 만든 **매핑된 컬럼만의 목록**이다. 인터스티셜(매핑 안 된) 컬럼은 이 목록에 아예 등장하지 않으므로 — "빈 문자열로 쓰지 않는다"가 아니라 **애초에 그 셀을 가리키는 range 자체가 요청에 없다** — 물리적으로 건드릴 방법이 없다. APPEND 경로는 그대로(`buildRowForMapping`의 밀집 배열 + 단일 `values:append`) — 신규 행은 이전 데이터가 없어 인터스티셜 위치를 비워써도 무해하므로 손대지 않았다. `src/lib/sheets.ts`의 기존 `updateRow`/`rowA1Range`는 함수 자체는 남겨뒀지만(다른 호출부 없음을 확인) 이제 이 UPDATE 경로에서 쓰이지 않는다.
- **회귀 테스트:** `tests/columnMapping.spec.ts`(순수 함수, DOM 무의존 — (a)스키마 완전일치 (b)시트가 로컬보다 컬럼多 (c)순서만 다름·이름 동일 (d)로컬에 없는 컬럼 (e)총체적 불일치 5×2=11케이스 + 신규 `buildSparseCellsForMapping` describe 3케이스: 인터스티셜 미표현, `buildRowForMapping`과의 대조로 밀집vs희소 차이 실증, 총체적 불일치 시 빈 배열), `tests/sync-header-mapping.spec.ts`(전체 앱 e2e로 (b)(c) + 총체적 불일치 시 명시적 실패 3케이스 + 신규 "인터스티셜 컬럼 절대 미접촉" 케이스: 로컬 6컬럼이 헤더 9컬럼에서 A,B,F,G,H,I에 매핑되고 C,D,E가 인터스티셜인 상태에서 이미 synced된 행을 dirty로 만들어 UPDATE 경로를 태우고, `values:batchUpdate` 요청의 `data` 배열에 C2:C2/D2:D2/E2:E2 range가 **전혀 없음**을 직접 단언 — 이게 이번 후속수정의 핵심 검증), 기존 `tests/sync-skip-rows.spec.ts`/`tests/sync-token-expiry.spec.ts`는 헤더 GET stub을 로컬 스키마와 정확히 일치하게 갱신해 **기존 동작(스키마 일치 케이스) 무회귀** 확인 — `sync-skip-rows.spec.ts`의 UPDATE 관련 2케이스는 PUT 단언을 `values:batchUpdate` sparse 단언으로 갱신(연속범위 A2:B2 단일 PUT → A2:A2/B2:B2 개별 range 2건).
- **출처:** `survey-011 v0.6.0` Codex 교차점검(C6, 원 보고) → `2026-07-07 v0.28.0 A5 업로드 테스트(Sonar, 실 Google 계정)`(재오픈, 실사용 재현) → **survey-011 v0.29.0** 근본 수정(이름기반 매핑) → **survey-011 v0.29.x** 후속수정(민구 확인 기반, UPDATE 경로 인터스티셜 컬럼 절대 미접촉).
- **현재 상태:** ✅수정됨(`src/lib/columnMapping.ts` `mapColumnsToHeader`/`buildRowForMapping`/신규 `buildSparseCellsForMapping`, `src/lib/sheets.ts` `fetchHeaderRow`/신규 `updateCellsSparse`, `src/lib/sync.ts` append 경로는 이름기반 매핑 유지·update 경로는 `updateCellsSparse` sparse per-cell 전환, `src/screens/DataScreen.tsx` columnWarnings 배너) — APPEND·UPDATE 양쪽 모두 실기기에서 실제 컬럼 추가/변경 + 인터스티셜 컬럼이 있는 프로덕션 시트로 재검증 권장(단위/e2e는 전부 통과).

### [SYNC-4] 재로그인 자동 재연결이 컬럼 ID를 새로 만들어 입력 중 값이 빈칸으로 동기화될 수 있음
- **증상:** 음성 입력 중 Google 재로그인/시트 자동 재연결이 발생하면, 이미 말해 둔 값이 앱 세션 안에는 남아 있는데 이후 시트 동기화에서 같은 항목을 빈 문자열로 읽어 시트에 덮어쓸 수 있었다. UI 표시 문제가 아니라 프로덕션 시트 값이 영구 손상될 수 있는 데이터 유실 경로다.
- **원인:** `SettingsScreen`의 재연결 경로가 `inferColumns()` 결과로 `useSettingsStore.columns`를 교체하는데, 기존 `inferColumns()`가 `Date.now()` 기반 컬럼 ID를 매번 새로 만들었다. 음성 세션 값은 구 ID 아래 저장되고, 이후 `persistSession`/`sync`는 새 컬럼 ID로 값을 조회해 `''`를 쓰게 된다. [AUTH-7]의 재로그인 후 자동 재연결 완화가 만든 부작용이다.
- **해결(v0.30.0, Mack):** `inferColumns()`의 ID를 헤더명+중복순번 기반 결정적 해시로 바꾸고, 재분석 시 기존 컬럼명과 신규 컬럼명이 양쪽 모두 유일한 경우 `preserveInferredColumnIds()`로 기존 ID를 보존한다. 이렇게 하면 구버전 `Date.now()` ID로 이미 시작한 활성 세션도 같은 이름의 항목 값을 계속 주소 지정할 수 있고, 신규 세션은 결정적 ID를 쓴다. 중복 헤더명은 이름만으로 안전하게 매칭할 수 없으므로 보존하지 않고 새 결정적 ID를 쓴다.
- **회귀 테스트:** `tests/sheets-infer-columns.spec.ts` — 동일 헤더의 결정적 ID, 구 ID 보존, 중복 헤더명 보존 금지. 기존 이름기반 시트 매핑 회귀 `tests/columnMapping.spec.ts`도 함께 통과.
- **출처:** `2026-07-07 v0.29.0 실기기 점검 후속 CODEX-HANDOFF.md` 문제 A → **survey-011 v0.30.0**.
- **현재 상태:** ✅수정됨(`src/lib/sheets.ts` `inferColumns`/`preserveInferredColumnIds`, `src/screens/SettingsScreen.tsx` `loadHeaders`) — 실기기에서 재로그인/자동 재연결을 일부러 발생시키는 장시간 입력 시나리오로 최종 검증 권장.

---

## ⑤ 빌드 / 테스트 / 배포 환경 (이번 세션 직격탄)

### [ENV-1] dev 포트 불일치 → e2e ERR_CONNECTION_REFUSED — ✅해소
- **증상:** Playwright e2e가 `ERR_CONNECTION_REFUSED`로 전부 실패.
- **원인:** 문서·`npm run dev`(vite)는 **5173**인데 `playwright.config.ts`의 `baseURL`은 **5175**. 사람이 수동으로 포트를 맞춰야 했다.
- **출처:** `2026-06-04~05 세션`
- **당시 상태:** ⚠️주시 — 수동 정렬로 회피.
- **현재 상태:** ✅**해소**([ORCH-27], 커밋 `5c8ae46`, 2026-07-25). Playwright가 `webServer`로 **테스트 전용 5177**을 직접 띄운다. 포트 SSOT는 `tests/baseUrl.ts`의 `BASE` 하나이고 `playwright.config.ts`의 `webServer.command`가 같은 포트를 쓴다 — 사람이 맞출 대상이 없다. `npm run dev`(5173)는 관전용으로 분리됐다.
  ⚠️ **이 항목은 2026-07-26 문서 감사 전까지 "여전히 불일치"로 남아 있었다** — 수정이 다른 ID([ORCH-27])로 들어와 이 항목이 따라오지 못했다. `[UI-ALERT-1]`·"미배포" 건과 같은 계열의 문서 드리프트다.

### [ENV-2] playwright.config에 webServer 없음 (서버 자동기동 안 됨) — ✅해소
- **증상:** `npx playwright test`만 실행하면 서버가 없어 연결 거부.
- **원인:** `playwright.config.ts`에 `webServer` 블록 없음("// No webServer — dev server started separately").
- **출처:** `2026-06-04~05 세션`
- **당시 상태:** ⚠️주시 — dev 서버 수동 기동으로 회피.
- **현재 상태:** ✅**해소**([ORCH-27], 커밋 `5c8ae46`, 2026-07-25). `webServer` 블록이 있고 `reuseExistingServer:false` + `--strictPort`라 **남이 띄운 서버를 물려받는 경로가 없다**. 종전에는 사람이 띄운 5175를 중첩 클론이 잡고 있어 **브라우저 테스트가 옛 코드를 조용히 검증**한 적이 있다. 이제 포트가 점유돼 있으면 시끄럽게 실패하고, `tests/globalSetup.ts`가 2차로 서빙 cwd까지 대조한다.
  ⚠️ [ENV-1]과 함께 문서에만 낡은 상태로 남아 있던 항목이다.

### [ENV-4] 문서의 테스트 명령 드리프트 → **가드레일로 이동**
- ✅2026-07-26 문서 정리에서 해소(레거시 `.mjs` 2개 삭제, 절차는 CONTRIBUTING.md로 단일화).
  "문서의 실행 명령은 package scripts를 가리킨다"는 계약이라
  [ENGINEERING-GUARDRAILS.md](./ENGINEERING-GUARDRAILS.md) ⑥으로 옮겼다.

### [ENV-8] PWA 업데이트 반영 지연으로 실기기에서 구버전 실행
- **증상:** 새 버전(v0.4.2)을 배포(deploy)했으나, 실기기(iOS Safari 등)에서 이전 버전(v0.4.1)이 계속 활성화되어 실행되며 신규 버그 패치 및 기능이 누락된 채 테스트 로그가 수집됨.
- **원인:** PWA 서비스 워커의 캐시 라이프사이클(`skipWaiting` 미강제 또는 자동 감지 UI 부재)로 인해 즉각적인 업데이트 및 새로고침이 브라우저에서 일어나지 않음.
- **해결·회피:** 서비스 워커 배포 시 업데이트 감지 이벤트를 UI에 팝업("새로운 버전이 있습니다. 새로고침하여 적용하세요")으로 띄우고 사용자가 인지하도록 가이드.
- **출처:** `2026-06-08 세션` (실기기 로그 분석)
- **현재 상태:** ✅수정됨 (5086 로그 분석 결과 v0.4.2 업데이트 및 실기기 정상 구동 완료 확인)
- **⚠️ 재발(v0.17.0 실기기, 민구 제보):** 홈 화면 **설치형(standalone)** 사용 시 새 버전 배포해도 반영 안 됨 — `vite.config.ts` `registerType:'autoUpdate'`는 iOS standalone에서 완전 종료·재실행 전엔 새 SW를 silent 리로드로만 반영하는데, 현장에선 그 리로드가 안 걸림.
- **해결·회피(v0.18.0 1f, 비강제 프롬프트):** `registerType:'prompt'` + `injectRegister:null`로 전환하고 `src/lib/pwaUpdate.ts`에서 `virtual:pwa-register`의 `registerSW({onNeedRefresh,onRegisteredSW})`를 `main.tsx`에서 **수동 1회** 등록(이중 등록 방지). ① 능동 체크 = standalone 실행 + `visibilitychange`(포그라운드) 시 `registration.update()`. ② 비강제 배너(`src/components/UpdateBanner.tsx`, App 상단 고정) = 새 SW waiting 시에만 노출, 탭 시 `updateSW(true)`(skipWaiting+1회 리로드). ③ Settings footer에 현재 버전 + "업데이트 확인/새로고침" 버튼(`UpdateControl`). **음성 측정 중 강제 리로드 금지** — 적용은 사용자 탭 시점에만. 진행 세션은 v0.4.4 증분 persist로 영속화돼 리로드해도 유실 없음. **autoUpdate의 silent 강제 리로드 제거가 핵심 변경.**
- **미검증(실기기 대기):** iOS standalone에서 (a) 새 버전 배포 후 실행/포그라운드 시 배너 실제 노출, (b) `registration.update()`가 새 SW를 실제 탐지하는지 — 다음 실기기 세션에서 이전→신 버전 전환 실증 필요.

### [ENV-10] `recover-drive.spec.ts` W8("로그인 상태") 테스트가 시간 경과로 결정론적으로 깨짐 — 테스트 픽스처의 달력 드리프트(앱 회귀 아님)
- **증상:** `tests/recover-drive.spec.ts`의 W8("로그인 상태: 모달 목록 조회 → 선택 복구...") 케이스가 `expect(locator('text=구버전 로그 1개 제외')).toBeVisible()`에서 timeout으로 실패. 3회 연속 단독 실행해도 매번 동일 지점에서 동일하게 실패(전형적 "플래키"와 다른 100% 결정론적 실패).
- **원인(2026-07-06 Sonar 데스크탑 재현 QA로 특정):** 이 스펙의 zip fixture(`zip-legacy`)는 파일 내 고정 앵커 `const NOW = Date.parse('2026-06-11T12:00:00Z')` 기준 상대 오프셋(`ISO(6)` = NOW의 6일 전 = 2026-06-05T12:00Z)으로 `createdTime`을 만든다. 그러나 앱이 실제로 "최근 30일" 필터를 계산하는 기준(`src/screens/DataScreen.tsx:1064` `since = Date.now() - chip.days*86400_000`, `src/lib/recoverFromDrive.ts:128-134` `inRange`)은 **실제 벽시계 시각**이다. 테스트 작성 시점(대략 2026-06-11 전후 추정)엔 통과했겠지만, 실제 날짜가 흘러 `zip-legacy`의 고정 offset이 진짜 "최근 30일" 창 밖으로 밀려난 시점부터는 **매 실행마다** 실패하도록 되어 있었다(`zip-legacy`가 legacy로 "분류돼 배제"된 게 아니라 애초에 기간 필터에서 통째로 걸러짐 — DOM엔 `구버전 로그 N개 제외`도 `failedZips`도 안 뜸). 코드베이스에 이미 정답 패턴이 있었다: `tests/session-local-date.spec.ts`가 `page.clock.setFixedTime(...)`로 이런 드리프트를 원천 차단하는데, `recover-drive.spec.ts`는 이 패턴을 안 썼다(`NOW` 상수만 파일 안에 정의해두고 앱이 실제로 참조하는 `Date.now()`는 고정하지 않음).
- **해결:** `recover-drive.spec.ts`의 `bootApp()`(모든 W6/W8 테스트가 공유하는 부팅 헬퍼) 맨 앞에 `await page.clock.setFixedTime(new Date(NOW))`를 추가 — `session-local-date.spec.ts`와 동일 패턴으로, zip fixture의 고정 앵커와 앱이 보는 "현재 시각"을 동기화한다. **앱 코드(`recoverFromDrive.ts`/`DataScreen.tsx`)는 무변경** — 순수 테스트 픽스처 버그이며 "최근 30일은 실제 시각 기준"이라는 앱 로직 자체는 의도대로 정상 동작 중이었다(회귀 아님).
- **검증:** 단독 실행 3회 연속 전부 통과(결정론적 수정 확인) + 전체 회귀(`npx playwright test`, 479 passed) 통과.
- **출처:** `2026-07-06 v0.27.0 데스크탑 재현 QA(Sonar 2차 라운드)`, `~/projects/survey-011-test-harness/qa-antigravity/results/c1-w8-flaky-results.md` → **survey-011 v0.28.0** 수정.
- **현재 상태:** ✅수정됨(`tests/recover-drive.spec.ts` `bootApp()`). 방치 시 `zip-new`(ISO(2))도 며칠 내로 같은 방식으로 30일 창 밖으로 밀려나 더 이른 단계에서 실패했을 것 — 이번 수정으로 실행 시점과 무관하게 항상 통과.

### [ENV-11] 테스트들이 IDB open 버전을 하드코딩 — 앱 DB_VERSION bump 시 일괄 VersionError
- **증상(선제 발견, 실패 전 차단):** `src/lib/db.ts`의 `DB_VERSION`을 4→5로 올리자(v0.33.0 10-B `screenshots` 스토어 신설) 테스트 ~15개 파일이 `indexedDB.open('survey-011', 4)`를 하드코딩하고 있어, 앱이 먼저 부팅해 DB를 v5로 올린 뒤 테스트 시딩이 낮은 버전으로 열며 **VersionError**로 전부 깨질 상황이었다([ENV-3] "버전 하드코딩" 계열의 IDB 판).
- **원인:** 시딩 헬퍼들이 앱 스키마 버전을 복제(하드코딩). 일부(pre-boot 시딩 5곳)는 자체 `onupgradeneeded`로 앱 스키마 미러까지 들고 있어, 스토어 추가 시 미러도 함께 갱신해야 한다.
- **해결·회피:** ① 전 테스트 `open('survey-011', 4)` → `5` 일괄 치환 + 스키마 미러 6곳(`v54-voice-data`·`settings-migration`·`recover-list-stage`·`sync-header-mapping`·`sync-skip-rows`·`sync-token-expiry`)에 `screenshots` 스토어 추가. ② 앱 `deleteSession`은 `objectStoreNames.contains('screenshots')` 방어 — 구스키마 DB(미갱신 미러)에서도 cascade가 throw하지 않는다. **다음 DB_VERSION bump 때도 같은 일괄 갱신 필요**(grep `indexedDB.open('survey-011'`). 사후 시딩(post-boot)은 버전 인자 없이 여는 게 근본 회피지만, pre-boot 시딩은 스키마 미러가 필요해 버전 명시가 불가피 — 미러와 앱 upgrade 블록을 함께 고칠 것.
- **출처:** `2026-07-13 세션` (survey-011 v0.33.0 항목10-B 작업 중)
- **재발 1회(2026-07-13, v0.33.0 항목11 DB v5→6):** 리터럴 grep(`indexedDB.open('survey-011'`)로 27곳을 치환했는데 `v54-voice-data.spec.ts`만 **상수 변수 형태**(`const DB_VERSION = 5` → `open(dbName, dbVersion)`)라 grep을 빠져나가 11케이스 VersionError. **체크리스트 보강: 리터럴 grep + `grep -rn "DB_VERSION" tests/`(변수 형태) 둘 다 돌릴 것.** 스키마 미러 6곳에는 `feedbackQueue`(keyPath:'id', autoIncrement)도 추가됨.
- **근절(2026-07-16, v0.35.1 Stage 1-5):** `tests/fixtures/idb.ts` 신설 — 이름·버전은 앱 `db.ts`의 export를 재수출(SSOT), 스키마 미러는 `applyAppSchema` **한 벌**(브라우저 주입용 소스 문자열 제공). 사후(post-boot) 시딩 27곳은 **버전 무지정 open**으로, pre-boot 시딩 6곳은 fixture 주입으로 전환. `tests/idb-fixture.spec.ts` 가드가 버전 하드코딩 재유입을 테스트로 차단한다. **다음 bump 절차 = `db.ts` DB_VERSION 올리고 fixture `applyAppSchema`에 신규 스토어 반영, 끝** (grep 체크리스트 불필요).
- **현재 상태:** ✅근절(픽스처 SSOT + 가드 spec — 2026-07-16)

### [ENV-12] ESLint max-lines(500) 예외 목록 — GL-006 헌장 §5 도입 시점의 기존 초과 파일
- **배경:** 공통 개발 헌장(GL-006, 민구 채택 2026-07-16) §5 — 파일 크기는 책임 크기의 신호(권장 150~250줄, 300줄 분리 검토, **500줄 리팩토링 대상**). v0.35.1 Stage 1-8에서 ESLint `max-lines`(500, `src/` 한정)를 오류 게이트로 도입(`npm run lint`, predeploy에 포함).
- **예외(파일 상단 `eslint-disable max-lines`, 해소 시 주석 제거 + 이 목록에서 삭제):**
  0. ~~`src/lib/useDataActions.ts`~~ — ✅ v0.49 R1 리팩토링 P2에서 해소(2026-08-14, 기재된 계획 그대로 export 절 `useExportActions`·recover 절 `useRecoverActions` 서브 훅 분리, 531→400줄 + disable 제거)
  1. `src/lib/useVoiceSession.ts` (**3,236** — 2026-07-26 실측; v0.38.0 시점 3,112에서 v0.38.1~v0.39.0 기능 유입으로 재증가) — **Stage 3(v0.35.3)에서 코어
     재설계 완료**(판별 유니온·resolveFinal 결정표·clipPointer/trendEvaluate 모듈·logCell·
     proceedAfterCommit — 무효 상태 조합은 이제 컴파일이 차단). 줄수 해소는 후속 서브 훅 시리즈
     (클립 캡처 `useClipCapture` → persist → 내비게이션 순, ref 공유 없는 인터페이스)로 계속 —
     v0.34~35 기능 유입으로 플랜 당시 추정(1,200~1,500 잔존)보다 몸집이 커서 한 릴리스에 끝내지
     않고 릴리스당 1개 서브 훅씩 검증하며 진행.
     - ✅ **v0.38.0: `useClipCapture` 분리 완료**(서브 훅 #1 — 셀별 재시도·명령 클립 인덱스,
       in-flight 저장 장부). 다음은 **persist**(`persistSession`), 그다음 내비게이션.
     - 🔴 **2026-08-15 실측 갱신 — 위 「3,236@07-26」은 그 시점 스냅샷이다. 현재 3,535.**
       (07-26 이후 기능 유입으로 5,816까지 갔다가 아래 서브 훅 시리즈로 내려온 값이다 —
       숫자만 보면 300줄 늘어난 것처럼 보이지만 실제로는 **−2,281**이다. 원장의 규율대로
       *왜 바뀌었는지*를 적는다.)
     - ✅ **서브 훅 시리즈 현행 — #1~#10 분리 완료**(2026-08-15):
       #1 `useClipCapture`(v0.38.0) · #2 `usePersistSession` · #3 `useRowNav` ·
       #4 `useFieldNav` · #5 `useTrendGate` · #6 `useAnnouncements`(uvs A~D) ·
       #7 `useFinalCommands` · #8 `useFinalValueGate` · #9 `useValueCommit` ·
       #10 `useCommitLanding`(E단계 — `handleFinal` 1,192줄 구획을 4스테이지 파이프라인으로).
       `useRowNav`에서 `useRowLanding`이 추가로 갈렸다(r2-nearcap).
       👉 **`handleFinal`의 dep 배열은 이제 정확히 스테이지 함수 4개다**(아래 identity 계약의
       기계적 완성형). 다섯 번째가 생기면 그 자체가 리뷰 대상이다.
     - ⚠️ **신규 4파일은 `eslint-disable` 예외가 아니다**(전부 500 미만) — 이 예외 목록은
       무접촉이다(r2-nearcap의 「가진 적이 없으면 등재/삭제 대상 아님」 판정과 같은 형태).
       🔴 다만 **헤드룸이 얇은 둘은 기억해 둬야 한다**(민구 Q1-ⓐ 처분, 2026-08-15):
       `useFinalCommands.ts`(478 · 여유 22) · `useFinalValueGate.ts`(462 · 여유 38).
       둘 다 계획서가 스스로 세운 「여유 50줄 미만은 위험」 선 아래다 — 원인은 주입 심볼이
       28·15개라 `Deps` interface가 크기 때문이고, 이동 본문은 주석 비중 46%의 계약 문서라
       줄일 수 없다. **주석 한 줄을 더하기 전에 `wc -l`을 먼저 봐라.**
       (`useValueCommit` 342 · `useCommitLanding` 321은 여유 충분 — 대상 아님.)
     - ⚠️ **분리 시 identity 계약 주의:** 노출 함수를 `useCallback(..., [])`로 고정해야 한다.
       호출부 `logCell`이 비메모이즈라 의존성에 그대로 넣으면 매 렌더 새 identity가 되고, 그
       함수들이 `handleFinal`의 의존성 배열에 있어 **매 렌더 handleFinal 재생성 → STT 배선이
       요동**친다. 주입 deps는 ref로 받아 흡수한다(`useClipCapture`의 `depsRef` 패턴).
  2. ~~`src/screens/SettingsScreen.tsx`~~ — ✅ v0.35.2 Stage 2에서 해소(components/settings 16파일 + useSettingsActions 훅 분리, 3,114→489줄)
  3. ~~`src/screens/DataScreen.tsx`~~ — ✅ v0.35.2 Stage 2에서 해소(components/data 15파일 + useDataActions 훅 분리, 2,420→315줄)
  4. ~~`src/screens/VoiceScreen.tsx`~~ — ✅ v0.35.2 Stage 2에서 해소(components/voice 7파일 추출, 1,342→174줄)
  5. `src/lib/audioRecorder.ts` (**868** — 2026-07-26 실측; v0.38.0 시점 673에서 마이크 수명주기·recover 보강으로 재증가) — 마이크 PCM 캡처 탭을
     `micPrerollTap.ts`(287줄)로 분리했다(링버퍼·입력 레벨·시간영역 파형). 공개 API는 위임
     메서드로 유지해 호출부 수정 0.
     - ⚠️ **남은 673줄의 분리 경계는 자명하지 않다.** 원안이던 "장치·스트림 생명주기 / 클립 녹음"
       2분할은 **`init`·`recoverStream`·`dispose`가 양쪽을 가로질러** 오케스트레이션이 두 클래스로
       찢어진다. 프리롤 탭을 먼저 자른 이유가 그것 — 클립 경로와의 접점이 `startClip`의
       AudioContext 재개 1곳뿐이라 경계가 깨끗했다. 다음 분리는 **별도 설계 필요**.
     - **순서 계약(불변):** 캡처 그래프 `detach()`는 **항상 `stream.stop()`보다 먼저**다
       (source가 stream을 참조 — 뒤집히면 그래프 누수).
  6. ~~`src/lib/pastValues.ts`~~ — ✅ v0.49 R2 리팩토링(2026-08-15)에서 해소. 경계는 **브라우저 경계**
     (파일이 이미 자기 안에 구획 주석으로 선언해 두었던 그 선): 순수 로직 → `src/lib/pastValuesIndex.ts`
     (421줄), 영속 직렬화 → `src/lib/pastValuesPersist.ts`(104줄), fetch·캐시·세대·백오프는
     `pastValues.ts`(885→397줄)에 남았다. disable 제거. 호출부 수정 0 — `pastValues.ts`가
     `keyColumns`·`buildSampleKey`·`previousRound`·`pastValue`·`previousSurveyRound`·`PrevSurveyRound`를
     **단방향** 재수출한다. 인용 스펙 5건은 leaf로 재표적했다.
  7. ~~`src/lib/sheets.ts`~~ — ✅ v0.49 R2 리팩토링(2026-08-15)에서 해소. 경계는 **네트워크 경계**:
     컬럼 유추 순수 함수(`inferColumns`·`preserveInferredColumnIds`·`uniqueValuesRecentFirst`·
     `guessType`·`stableColumnId`·`OPTIONS_MIN_REPEAT`)를 `src/lib/sheetsInfer.ts`(229줄)로 이동,
     622→414줄 + disable 제거. 호출부 수정 0 — `sheets.ts`가 **단방향 재수출**로 import 경로를 보존한다
     (leaf는 `sheets.ts`를 역import하지 않는다 → `[LOGEVENTS-CYCLE-1]` 형태의 순환 아님).
  8. ~~`src/stores/settingsStore.ts`~~ — ✅ v0.49 R2 리팩토링(2026-08-15)에서 해소. 경계는
     **「zustand를 아는가」**: `settingsState.ts`(279 — `SettingsState`·기본값 SSOT·입력값 설정
     초기화 패치) · `settingsStorage.ts`(65 — localStorage/IDB 미러 + 하이드레이션 게이트) ·
     `settingsMigrate.ts`(223 — persist 버전 이력) · `settingsStore.ts`(729→230 — create/persist
     옵션·액션). disable 제거. 호출부 수정 0(`makeSettingsDefaults`·`inputSettingsResetPatch`·
     `minConfidenceForTolerance` **단방향** 재수출).
     - 🔴 **migrate 이력은 본문 무수정으로 옮겼다**(들여쓰기 6칸 제거만 — 167줄 대조 확인).
       `version < N` 게이트 등장 순서 `6→7→9→10→12` 보존. 근거: 순서가 바뀌면 기존 사용자
       저장본의 치유 결과가 달라진다(v6 블록은 위쪽 `reconcileColumnFlags`가 이미 정규화한
       columns를 전제한다). 오라클 `tests/settings-migration.spec.ts` 10건 green(v4·v5·v6·v8·
       v11·v12 저장본 + 다운그레이드 라운드트립).
  9. `src/lib/speech.ts` (614 — 2026-07-26 실측) — STT 컨트롤러, 분리 경계 검토 후 해소
- **규칙:** 신규 파일은 예외 금지(500 초과 = lint 실패). 기존 예외 파일에 코드를 얹기 전에 분리를 먼저 검토한다(GL-006 AI 행동 규칙 #4). 기계적 part1/part2 분할 금지 — 경계는 항상 책임 단위.
- **출처:** GL-006 채택 + v0.35.1 리팩토링 (2026-07-16)
- **현재 상태:** ⚠️주시 (Stage 2·3 진행에 따라 순차 해소).
  ⚠️ **줄 수는 낡는다.** 위 숫자는 2026-07-26 실측이며, 기능이 들어오면 다시 늘어난다(실제로
  `useVoiceSession.ts`는 3,244→3,112로 줄었다가 3,236으로 되돌아왔다). **판단은 이 목록이 아니라
  `wc -l src/lib/*.ts src/stores/*.ts` 실측으로 하고**, 이 항목은 "어느 파일이 예외인지"의 목록으로만
  쓴다. 예외 여부의 진짜 SSOT는 각 파일 상단의 `eslint-disable max-lines` 주석이다
  (`grep -rln "eslint-disable.*max-lines" src/`).

---

## ⑥ 인증 · Drive

### [AUTH-3] 자동 로그 업로드가 기본 ON + 대상 폴더 불투명
- **증상:** 사용자가 모르는 사이 로그/클립이 특정 Drive 폴더로 전송, 대상이 안 보임.
- **원인:** `autoUploadLogs` 기본값 true, 대상 `LOG_FOLDER_ID`가 코드 안에 숨음.
- **해결·회피:** 기본값 **false**(명시 활성화 후에만 동작), 토글 활성 시 폴더 ID를 UI 모노스페이스 박스에 표시(대상 가시화). 토큰에서 검증된 이메일(`getCurrentEmail()`) 사용 + 이메일 형식 검증(폴더명 인젝션 방지).
- **출처:** `growth-survey-010@e207513`(기본 OFF + 가시화), `growth-survey-010@55bb61e`(토글), `growth-survey-010@8ce8dca`(검증된 이메일)
- **현재 상태:** ⚠️주시 (survey-011 `src/lib/driveUpload.ts`/설정 화면의 기본값·가시화 점검 권장)

### [AUTH-4] 앱 OAuth 토큰에 refresh token 없음 → 헤드리스 수확 불가
- **증상:** 앱 브라우저 OAuth로 받은 토큰엔 refresh token이 없어, 헤드리스로 Drive 데이터를 자동 수확 못 함.
- **원인:** 인앱 OAuth 플로우가 refresh token을 발급/저장하지 않음(설계상).
- **해결·회피:** 헤드리스/자동 수확은 **GCP 서비스 계정**으로 한다. MCP는 zip을 못 읽으니 **디스크로 받아서** 처리. (이건 Mack의 계측/연결 선결 영역.)
- **출처:** `2026-06-04~05 세션`
- **현재 상태:** ⚠️주시 (자동 수확 파이프라인은 미배선 — Mack 선결)

### [AUTH-5] 내보낸 voice-log zip의 오디오는 audioFileId가 아닌 log.id로 명명
- **증상:** zip 안 오디오 파일이 `audioFileId` 필드가 가리키는 곳에 없음.
- **원인:** zip 익스포트가 오디오를 `log.id`로 명명.
- **해결·회피:** 익스포트 zip의 오디오 클립은 `log.id`로 매칭해서 샘플링/디버깅하라.
- **출처:** `debug-log`(2026-04-17)
- **현재 상태:** ⚠️주시 (survey-011 ZIP 구조 점검 시 클립 키 명명 규칙 확인)

---

### [AUTH-6] 구글 첫 로그인 시 `popup_failed_to_open` → 2번 눌러야 로그인
- **증상:** 설정탭에서 구글 로그인을 처음 누르면 `popup_failed_to_open` 알림이 뜨고, 한 번 더 눌러야 로그인 창이 열림.
- **원인:** `signIn()`이 팝업을 열기 **전에** `await loadGisScript()`(네트워크 스크립트 로드)를 기다려, 팝업이 user-gesture task를 벗어남 → 브라우저가 팝업 차단. 둘째 클릭은 스크립트가 캐시돼 있어 동작.
- **해결·회피:** GIS 스크립트 + 토큰 클라이언트를 **사전 로드**(`warmupGoogleAuth()`를 SettingsScreen 마운트에서 호출). `signIn()`은 토큰 클라이언트를 한 번만 생성하고 **클릭 제스처 내에서 동기적으로** `requestAccessToken()` 호출. cold 케이스(워밍업 미완료)만 기존처럼 로드 후 호출(2번째 클릭에서 fast-path). `error_callback`의 `popup_failed_to_open`/`popup_closed`는 사용자 친화 메시지로 매핑.
- **출처:** `2026-06-05 세션`(피드백) → **survey-011 v0.4.1** 수정
- **현재 상태:** ✅수정됨 (`src/lib/googleAuth.ts` `warmupGoogleAuth`/동기 `requestAccessToken`, `src/screens/SettingsScreen.tsx` 마운트 워밍업) — 실기기 OAuth 팝업은 device 확인 필요.

---

### [AUTH-7] "스프레드시트 링크가 풀린다" — 실체는 OAuth 토큰 만료([AUTH-4])를 UI가 '연결됨'으로 거짓 표시
- **증상(민구 제보):** 앱 업데이트·새로고침·강제종료 뒤 스프레드시트 연결이 풀려, 매번 Drive에서 공유링크를 복사해 다시 붙여넣어야 함.
- **원인(코드 추적 확정):** 진짜 원인은 localStorage 소실(eviction)이 **아님**. 민구 확인 — "**연결 직후 새로고침은 안 풀리고 한참 뒤에만** 풀린다"(시간 의존=토큰 만료, eviction이면 즉시 새로고침에도 풀려야 함). 암시적 OAuth 토큰은 refresh token이 없어 약 1시간이면 만료([AUTH-4], `googleAuth.ts:89` expires_at<now+60s면 null)인데, `googleConnected`는 zustand persist로 통째 저장돼 true로 재하이드레이트된다. 마운트 effect(`SettingsScreen.tsx`)는 토큰 있으면 true로 **승격만** 하고 토큰 소실 시 false로 **강등하는 경로가 없었다** → UI는 '연결됨 · 이메일'을 거짓 표시하지만 `getAccessToken()`=null이라 모든 시트 읽기/쓰기(`sheets.ts:29 authFetch`)가 실패. 사용자는 '풀렸다'고 느끼고 URL 재붙여넣기를 시도하나 그것도 authFetch라 토큰 없이는 실패.
- **해결·회피(v0.13.0 R1):** ① 마운트 effect에 **강등 분기** — 토큰 없으면 `googleConnected:false`로 내려 '재로그인 필요'를 정직하게 노출. ② **저장 시트 목록(savedSheets)** — 연결 성공 시 파일명(`fetchSpreadsheetMeta`의 properties.title)으로 자동 등록(sheetId dedupe), localStorage 영속(persist v7→**v8**). 매번 붙여넣지 않고 목록에서 탭 1회로 재선택. ③ **재로그인 후 자동 재연결** — `onGoogleClick` 성공 시 직전 `sheetUrl`이 있으면 `onUrlConfirmWithUrl(prevUrl)` 자동 호출(재붙여넣기 불필요). 토큰 만료 중 저장목록 선택 시엔 sheetUrl·availableSheets·sheetTab을 함께 비워 'active 배지'와 탭 셀렉터 불일치를 방지(코드리뷰 R1). **한계:** refresh token 부재(설계, [AUTH-4])라 토큰 만료 시 **재로그인 1회는 여전히 필요** — savedSheets는 붙여넣기 수고만 제거. (savedSheets도 localStorage라 진짜 eviction이면 함께 사라지나, 민구 증상은 토큰 만료로 확정돼 해당 없음.)
- **출처:** `2026-06-18 세션`(민구 제보 + 즉시-새로고침 판별) → **survey-011 v0.13.0** 수정
- **현재 상태:** ✅수정됨 (`src/screens/SettingsScreen.tsx` 강등 분기·자동 재연결·저장목록 UI, `src/stores/settingsStore.ts` savedSheets/persist v8, `src/types.ts` SavedSheet) — 실기기 토큰 만료→강등→재로그인→자동재연결 흐름 device 확인 필요. silent token refresh(prompt:none)는 백로그.
- **⚠️ 후속 정정([AUTH-8] 참조, v0.14.0):** 위에서 "eviction은 해당 없음"으로 단정했으나, v0.13.0 실기기 후 민구 추가 제보 — **강제종료뿐 아니라 "일정시간 경과 후 로그인 + URL 등록이 함께" 풀림**. 토큰 강등 코드(`SettingsScreen.tsx:826`)는 sheetUrl을 안 지우므로(확인) URL 동반 소실은 토큰 만료로 설명 불가 → 토큰(별도 localStorage 키 `gs10_google_token`)과 설정(`survey-011-settings-v3`)이 **동시에** 사라지는 = localStorage eviction 정황. [AUTH-8]에서 IDB 미러 + breadcrumb로 대응.

### [AUTH-8] 강제종료/시간경과 후 시트 등록 전체 초기화 — localStorage eviction (추정→계측)
- **증상(민구 제보, v0.13.0 후속):** 앱(사파리) 강제종료 시, 그리고 **일정시간 경과 후에도** 로그인과 스프레드시트 URL 등록이 함께 풀린다([AUTH-7] 토큰 만료와 별개 — URL까지 동반 소실).
- **원인(추정, 계측으로 확정 예정):** 토큰·설정 모두 localStorage 저장 → iOS Safari가 ITP(비설치 탭 7일 캡) 또는 저장압박으로 키를 evict하면 한꺼번에 초기화. zustand persist는 무엇을 저장하는지는 정상(partialize 없음, 전체 저장) — 문제는 저장소 내구성. v0.13.0 로그엔 강제종료→재실행 사이클·설정 하이드레이션 계측이 없어 직접 증명 불가였음.
- **해결·회피(v0.14.0 C):** ① **IDB 내구 미러** — `settingsStore` persist에 커스텀 storage 어댑터(`mirroredStorage`)를 달아 localStorage 1차(동기·기존 동작 보존) + IDB 'kv' 스토어(`db.ts` v3→**v4**) write-through. getItem에서 localStorage가 비면 IDB에서 복원(+`settings_restored_from_idb` 로그). ② **하이드레이션 breadcrumb** — boot 시 `settings_hydrated:url=Y/N,cols=N,saved=N,token=Y/N`(`onRehydrateStorage`)로 다음 테스트에서 eviction 여부·복원 작동을 판별. **한계:** 비설치 Safari는 ITP 7일 캡이 IDB에도 적용 — **홈화면 설치(standalone) PWA가 가장 강한 내구**(7일 캡 면제). 미설치면 IDB도 evict될 수 있어, 설치 권장이 근본 대비책.
- **출처:** `2026-06-18 세션`(민구 추가 제보) → **survey-011 v0.14.0** 대응. 다음 강제종료/시간경과 실기기 로그의 `settings_hydrated`/`settings_restored_from_idb`로 확정.
- **현재 상태:** ⚠️주시 (`src/stores/settingsStore.ts` mirroredStorage+breadcrumb, `src/lib/db.ts` kv 스토어) — eviction 진위·standalone 설치 여부 device 확인 필요.
- **✅ 후속(`2026-06-19 v0.14.0 실기기 로그`):** boot `settings_hydrated`가 11:07~13:54 구간 전부 `token=Y,url=Y`(Y→N flip 없음) → **이 윈도우에선 eviction 미재발**(IDB 미러 내구 보유). 단 민구는 "홈화면 설치형에서 시간경과 후 로그인 풀림"을 보고 — eviction 자체는 별 윈도우에서 재발 가능(장기경과 표본 필요). **재로그인 불가('로그인 중…' 멈춤)는 eviction이 아니라 별개 레이어 = 신규 [AUTH-9]**(GIS 콜백 wedge)로 분리.

### [AUTH-9] eviction 후 재로그인 시 "Google 로그인 중…" 영구 멈춤 — GIS tokenClient 콜백 wedge (standalone PWA)
- **증상(민구 제보, v0.14.0 실기기):** 아이폰 홈화면 설치형(standalone)에서 시간경과 후 구글 로그인이 풀린 뒤([AUTH-8] eviction, 저장된 시트는 유지), **재로그인을 누르면 "Google 로그인 중…" 문구가 뜬 채 진행이 멈춰 로그인 불가**. **아이폰 재부팅 후에야** 로그인 완료.
- **원인(Trace 로그분석 + 코드 추적 확정):** `onGoogleClick`(`SettingsScreen.tsx:847`)이 `await googleSignIn()`만 기다리는데, `googleSignIn()`(`googleAuth.ts:135-166`)은 GIS `tokenClient`의 **콜백으로만 settle**된다. standalone PWA에서 그 콜백이 미발화하면 promise가 **영구 hang** → `onGoogleClick`의 `finally{ setLoading(null) }`이 안 돌아 "로그인 중…"에 고착. `tokenClient`/`pending`이 **module-level 싱글톤**이라 reload 없는 standalone에선 **프로세스 kill(재부팅)만이 해소** = 증상 정확 일치. (eviction[AUTH-8]과 **별개 레이어** — eviction은 IDB 미러로 방어, 본 항목은 콜백 wedge.)
- **해결·회피(v0.15.0 A7):** ① `signIn()`에 **15s 타임아웃**(`SIGNIN_TIMEOUT_MS`) — 미발화 시 reject + `resetTokenClient()`로 `tokenClient` 싱글톤 폐기(재시도 시 새 클라이언트 생성, 재부팅 불필요). ② `settlePending()` 단일 settle 게이트(`settled` 가드) — 늦게 온 콜백 안전 무시. ③ `onGoogleClick` `finally`로 로딩해제 항상 보장. ④ **인증 계측 5종**(`auth_signin_start`/`auth_token_settled:ms=,late=`/`auth_signin_timeout:ms=15000`/`auth_tokenclient_reset`/`auth_signin_error:<type>`) — `late=true`로 standalone 콜백이 '영구 미발화'인지 '지각 발화'인지 다음 로그로 판별.
- **출처:** `2026-06-19 v0.14.0 실기기 로그`(민구 제보 + Trace 분석) → **survey-011 v0.15.0** 수정.
- **✅ 후속 수정(v0.29.0, Mack) — 15s 타임아웃이 실제 2FA보다 짧았고, A7 자체의 settle-게이트가 지각 성공의 구독자 알림까지 함께 삼켰다:**
  - **증상(출처: `2026-07-07 v0.28.0 A5 업로드 테스트(Sonar, 실 Google 계정)`):** 실 2FA가 ~60초 걸린 실행에서, 설정 탭에 "로그인 응답이 지연되어 취소되었습니다" 오류가 표시됐다. 그런데 `localStorage`(`gs10_google_token`)를 직접 열어보면 토큰이 **정상 저장돼 있었다** — UI는 실패로 믿지만 실제 인증 상태는 성공. 설정 탭을 재마운트(새로고침/탭 이동)해야만 `googleConnected`가 뒤늦게 true로 동기화됐다.
  - **원인(코드 추적 확정):** ① `SIGNIN_TIMEOUT_MS=15_000`(v0.15.0 A7)이 관측된 실제 2FA 소요시간(~60초, OTP 앱 전환 포함 시 더 김)보다 짧아 진행 중인 정상 로그인을 조기에 "지연 취소"로 오분류했다. ② 더 근본적으로, A7 자체가 심어둔 잠복 결함: 타임아웃이 먼저 발화하면 `settlePending()`이 `pending=null`로 비우는데, 그 **뒤에** 도착하는 GIS 콜백은 `storeToken(...)`을 무조건 실행해 토큰을 실제로 저장하지만, 뒤이은 `settlePending({ok:true,...})` 호출은 `if (!p || p.settled) return`(이미 null) 가드에 막혀 **완전 no-op**이 된다 — v0.22.0 P1이 만든 `notifyTokenSettled` 구독 메커니즘조차 **이 경로에선 정의상 한 번도 발화할 수 없었다**(호출 자체가 이 가드 안쪽에 있었으므로). 그 결과 원래 `signIn()` 호출자는 reject된 promise만 보고 "로그인 실패" 토스트를 띄우고, 토큰이 실제로 있다는 사실은 재마운트가 `getStoredToken()`을 다시 읽을 때까지 아무도 몰랐다.
  - **해결(v0.29.0):** ① `SIGNIN_TIMEOUT_MS` 15s → **120s**로 완화(현실적 2FA 상한). ② `notifyTokenSettled` 호출을 `settlePending`의 settle-게이트 **밖으로 분리** — `tokenClient` 콜백에서 `storeToken()` 직후 pending 상태(이미 타임아웃으로 settle됐는지)와 **무관하게 항상** 호출한다. `settlePending()`은 이제 "이번 `signIn()` promise를 resolve/reject할지"만 결정하고, "토큰이 실제로 확정됐다"는 알림은 별도로 나간다. ③ `SettingsScreen.tsx`가 `onTokenSettled`를 구독해 리마운트 없이 `googleConnected`/`userEmail`을 반응적으로 갱신(기존엔 mount effect에서만 `getStoredToken()`을 1회 읽었음).
  - **잔여 한계(정직하게 명시):** 120s도 유한한 상한이므로 이론상 이보다 더 느린 2FA는 여전히 최초 타임아웃 배너를 볼 수 있다 — 다만 이제는 그 뒤 지각 성공이 도착하면 리마운트 없이 자동으로 정정된다(늦게라도 정직하게 복구). 원 `signIn()` 호출자의 promise 자체는 이미 reject된 채로 남는다(JS promise는 재resolve 불가) — 현재 `onTokenSettled` 구독자는 `SettingsScreen`과 `useVoiceSession`(과거값 재프리페치용) 둘뿐이니, `signIn()`을 직접 await하는 다른 호출부가 추가되면 그쪽도 late-success 반영을 위해 별도로 구독해야 한다.
  - **회귀:** `tests/auth-signin-timeout.spec.ts` — `page.clock`으로 120s 가상 경과 후 지각 콜백이 리마운트 없이 반영되는지, 그리고 타임아웃 전 정상 도착하는 흔한 케이스가 무회귀인지 둘 다 검증.
  - **출처:** `2026-07-07 v0.28.0 A5 업로드 테스트(Sonar, 실 Google 계정)` → **survey-011 v0.29.0** 수정.
- **현재 상태:** ✅수정됨(`src/lib/googleAuth.ts` SIGNIN_TIMEOUT_MS/notifyTokenSettled 분리, `src/screens/SettingsScreen.tsx` onTokenSettled 구독) — 실기기에서 ① 실제 60초+ 2FA가 120s 창 안에서 타임아웃 없이 완료되는지 ② 만에 하나 120s를 넘겨도 지각 성공이 리마운트 없이 반영되는지 device 확인 권장.

### [AUTH-10] ⚠️ 운영 전제 — 과거값 무인증 read(API key)는 "시트 링크 공개"와 "로그아웃은 읽기 경계가 아님"을 전제한다 (v0.34.0 C9)

- **무엇:** v0.34.0부터 과거값 인덱스(이상치 알람 비교선) 조회가 OAuth 토큰이 없을 때 **Google API key + 공개 시트 read**로 폴백한다(`sheets.ts` `planValuesReadonly`/`readonlySheetsAuth`, `pastValues.ts`). 미로그인·토큰 만료 상태에서도 알람이 살아 있게 하려는 조치(민구: "시트가 연결되면 자동으로 작동해야 함").
- **⚠️ 이건 결함이 아니라 명시해야 할 운영 전제다(v0.34.0 코드리뷰 Codex Medium + agy-Flash Critical/Medium 지적, 민구 확정 2026-07-14 = **시트 공개 상태이며 허용됨 → 경로 유지 + 문서화**):**
  1. **시트가 "링크 있는 누구나(뷰어)" 공개여야 이 경로가 성립한다.** 비공개면 403이며 폴백 알람은 동작하지 않는다(이 경우 조용히 skip — v0.34.0 리뷰 반영으로 재시도도 즉시 차단, `past_index_retry_blocked:permission`).
  2. **로그아웃은 읽기 권한 경계가 아니다.** 로그아웃해도 저장된 시트 URL + 번들 API key로 해당 탭을 계속 읽는다. "로그아웃했으니 이 기기에서 시트 내용을 못 본다"는 기대는 **틀리다**.
  3. **spreadsheetId가 노출되면 제3자도 무인증으로 그 시트를 읽을 수 있다**(공개 시트의 본질적 성질 — 앱 결함이 아니라 공개 설정의 귀결). 농가명 등 식별정보가 들어가는 시트라면 이 점을 인지하고 운용해야 한다.
  4. **API key는 클라이언트 번들에 포함된다**(Vite `VITE_*`). 네트워크 탭·번들 검사로 취득 가능하므로 **GCP 콘솔에서 반드시 제한을 걸 것**: ① API 제한 = Sheets API(read) + Drive Picker 용도만 ② HTTP 리퍼러 제한 = 배포 도메인(`mingoojejuagrikang-crypto.github.io`). 제한이 없으면 키 도용·쿼터 소모가 가능하다.
  5. **쓰기는 여전히 OAuth 전용**(`sync.ts` `authFetch`) — 무인증 경로로는 시트를 수정할 수 없다(agy-Pro 확인).
- **키 스코프 주의(Codex Medium):** 무인증 read는 기존 **Drive Picker용 키를 재사용**한다(`drivePicker.ts`). 그 키가 Drive API로만 제한돼 있으면 **Sheets GET이 실패**한다 — 위 4번의 API 제한에 Sheets read를 반드시 포함시켜야 한다.
- **계측:** `past_index_fetch_start:auth=token|apikey`로 어느 수단으로 준비됐는지 로그만으로 판정 가능. 권한 실패는 `past_index_skip:<HTTP 403…>` + `past_index_retry_blocked:permission`.
- **회귀:** `tests/v034-past-index-apikey.spec.ts` — key 경로의 `?key=` 쿼리·Authorization 부재, 토큰 경로의 key 미노출, 403 재시도 차단.
- **현재 상태:** ✅전제 확정·문서화됨(민구 2026-07-14: 시트 공개 상태·허용). **잔여 운영 액션:** GCP 콘솔에서 위 4번 키 제한(Sheets read 포함 + 리퍼러) 실제 적용 여부 확인 — 미적용 시 키 도용 위험이 남는다.

### [CLIP-LOSS-1] 입력장치 변경(BT↔스피커폰)이 MediaRecorder를 죽여 이후 클립 연속 소실
- **증상:** 한 세션 중반부터 음성 클립이 연속으로 통째 소실(값 인식·시트 기록은 정상, 클립만 없음). v0.13.0 로그 세션 `8409` row 11~18(18개 연속) 트림·raw 모두 부재.
- **원인(로그+민구 현장 관찰):** error 이벤트 `clip_empty`→`clip_too_small:5`/`clip_cmd_empty:null` 반복 = MediaRecorder가 5바이트 빈 청크만 생성(레코더 dead). 초기 행은 `clip_stop_resolved:30000~50000`바이트로 건강 → 중간에 오디오그래프가 죽음. 민구: 입력장치(스피커폰/블루투스) 변경 의심. 앱은 자기 speakerphone 토글만 로깅하고 **OS 라우팅 변경(BT 분리/재연결)은 미로깅** → iOS에서 라우팅 변경이 활성 트랙을 끊으면 MediaRecorder가 빈 데이터만 뱉는데, 앱은 **재-getUserMedia를 안 해([IOS-5])** 복구 못 함 → 이후 전 클립 사망.
- **해결·회피(v0.14.0 B-1):** `audioRecorder.recoverStream(reason)` 신설 — 빈/극소 클립 감지(`useVoiceSession` clip_empty/clip_too_small 분기) 또는 유휴 중 devicechange 시 스트림을 **재획득**(re-getUserMedia + 프리롤·리스너 재구성). 쿨다운 `RECOVER_COOLDOWN_MS=3000`으로 폭주 방지. 녹음 중 devicechange는 비파괴 라벨 갱신만(진행 클립 보호), 유휴면 전체 재획득(`handleDeviceChange`). 텔레메트리 `clip_recorder_recovered:<reason>:<label>` / `clip_recorder_recover_failed`. **D 배지 staleness와 동일 원인·동일 수정 경로.**
- **주의:** [IOS-5]는 "재-getUserMedia 금지(진행 클립 손실 회귀 방지)"였으나, 본 버그(연속 소실)가 더 큰 손실이라 v0.14.0에서 **제한적 반전**(유휴/실패 시에만 재획득, 녹음 중엔 비파괴). 실기기에서 의도적 BT↔스피커폰 전환으로 검증 필요.
- **출처:** `2026-06-18 v0.13.0 실기기 로그`(세션 8409 연속 clip_empty/too_small) + 민구 현장 관찰 → **survey-011 v0.14.0** 대응.
- **✅ 대폭 완화(`2026-06-19 v0.14.0 실기기 로그`):** `clip_recorder_recovered` 발화 확인 — v0.13.0 **18연속 소실 → 실제 소실 1건**(강남호 row1 c7, 직후 회복)으로 급감. recoverStream 작동 확정. ⚠️ 양승보 세션 "클립이상" 비고 행(rows4/6/9)은 **파일이 전부 건강(28~71KB) = 소실 아님** → 트림/재생 품질 의심([CLIP-TRIM-1] 계열, 별도 청취검증 후보). 민구 보고 "스피커폰 입력 중 일부 소실"과 정합(잔여 1건). 단 이번 3세션은 전부 내장마이크라 BT↔스피커폰 **실제 라우팅 전환** 표본은 부족 — 다음 테스트에서 의도적 전환 검증 지속.
- **현재 상태:** ⚠️주시(완화) (`src/lib/audioRecorder.ts` recoverStream/handleDeviceChange, `src/lib/useVoiceSession.ts` 트리거; 2026-06-19 18→1건 급감) — BT 실제전환 표본 추가 필요.

### [TREND-RETRY-1] 이상치 알람 미작동 — 과거 인덱스 로드 1회 실패 후 세션 내내 재시도 없음
- **증상:** 이상치 알람을 설정(감소+변동률)하고 값을 입력해도 어느 값에도 알람이 안 뜸.
- **원인(로그 확정):** v0.13.0 로그 `past_index_ready` **0건** + `past_index_skip:Load failed` 2건(두 세션 모두 start 직후 ~27ms). 모든 commit이 `trend_skip:no_index`. **인증·연결은 정상**(같은 세션 `syncedRows:18 synced` — 시트 쓰기 성공) → prefetch가 너무 일찍 발사돼 `fetchAllRowsUnbounded`가 iOS Safari transient "Load failed"로 던졌고, `loadPastIndex` 실패는 캐시 안 되지만 **아무도 다시 안 부름**(prefetch 1회 + `evaluateTrend`는 `getCachedIndex`만 읽음) → 세션 내내 인덱스 없음. (토큰/re-auth와 무관 — [AUTH-7]과 별개.)
- **해결·회피(v0.14.0 A):** `pastValues.ensurePastIndex()` — 반복 호출 안전한 백오프 재시도(0.6→4.0s, 최대 5회, 캐시/in-flight/예약 중 no-op). `prefetchPastIndex`가 이를 호출하고, `evaluateTrend`도 캐시 미스마다 nudge → 입력 이어가는 동안 인덱스가 살아남. `resetPastIndexRetries()`로 세션 시작 시 카운터 리셋. 비교 키는 현행 샘플키(`inferSampleKey`=auto·비date = 농가명·라벨·처리·조사나무·조사과실)로, 민구 멘탈모델("음성값 외 항목 조합")과 일치 — 변경 없음. 인덱스 복구 시 [ALERT-1/AREA2 V2] 직전 조사일(`prevDate`) 표시도 함께 살아남(이미 구현됨, no_index로 안 떴을 뿐).
- **출처:** `2026-06-18 v0.13.0 실기기 로그`(past_index_ready 0건) → **survey-011 v0.14.0** 수정.
- **✅ 종결(`2026-06-19 v0.14.0 실기기 로그`, 3세션):** `past_index_ready` **6회**(v0.13.0 0회 대비), `trend_alert_fired` 45 / confirmed 20 / corrected 25, payload에 `previousValue` 포함. 한 세션은 start 직후 `trend_skip:no_index` 후 ~2초 만에 `past_index_ready`로 **백오프 재시도 복구** 확인 — 세션 내내 알람 정상 작동. 민구 현장 보고 "이상치·변동률 알람 모두 작동"과 일치. 직전 조사일(prevDate) 팝업 표시만 시각 잔여(경미).
- **현재 상태:** ✅수정됨·실기기 확정 (`src/lib/pastValues.ts` ensurePastIndex/resetPastIndexRetries, `src/lib/useVoiceSession.ts` nudge+reset; 2026-06-19 로그 past_index_ready 6회 작동확인).

### [CLIP-TRIM-1] 트림이 값 구간을 잘라 재생 시 값 안 들림 — 단, 실패의 대부분은 캡처 문제
- **증상:** 기록된 음성 클립 재생 시 정상 값 청취 불가(편집 오류).
- **원인(전사 분석 확정):** v0.13.0 클립 91개를 ffmpeg+whisper로 전사·대조 → OK 35%, SILENT/환각 25%, MISMATCH 20%, NO_CLIP 20%. **실패의 ~45%(SILENT+NO_CLIP)는 캡처 문제**(값이 raw에도 없음 = [CLIP-LOSS-1] 계열, whisper가 무음에 "고맙습니다"/"오케이" 환각). 트림 자체 결함은 일부 — `audioTrim.findSpeechSegments`가 peak=max(|sample|) 기준이라 초반 transient(클릭/팝/TTS잔향)가 peak를 올리면 실제 발화가 thr 미만으로 묻혀 엉뚱한(무음) 구간만 보존.
- **해결·회피(v0.14.0 B-2):** ① `robustPeak` — 기준 피크를 max 대신 상위 97백분위(transient 둔감). ② **과소 트림 floor** — 트림 결과가 `MIN_KEPT_MS=600` 미만이고 원본은 그 이상이면 트림 포기(전체본 유지) → 값 잘림 방지. **검증:** 실제 raw 73개에 신규 로직 재적용+재전사 → OLD 44%→NEW 45%, **회귀 0·구제 1**(무회귀 안전, 트림은 2차 문제 확인). **지배적 수정은 [CLIP-LOSS-1] 캡처 신뢰성.**
- **출처:** `2026-06-18 v0.13.0 클립 전사 분석`(/tmp/clip_analysis.json) → **survey-011 v0.14.0**.
- **현재 상태:** ✅수정됨(무회귀 검증) (`src/lib/audioTrim.ts` robustPeak/MIN_KEPT_MS) — 캡처 회복(B-1)과 함께 실기기에서 청취 개선 확인 필요.

### [TREND-AUTH-1] 이상치 알람이 구글 로그인 지연 시 전 세션 미작동
- **증상:** 음성입력 시 이상치(추세·범위) 알람이 일부 세션에서 안 뜬다.
- **원인:** `useVoiceSession evaluateTrend`가 직전값을 과거 시트 인덱스(`pastValue`)에서 가져오는데, 인덱스가 없으면 `trend_skip:no_index`로 조용히 스킵. 그 인덱스는 세션 start() 시 `getAccessToken()`이 토큰을 반환할 때만 프리페치(트리거 1곳뿐, `:1820`). 토큰이 늦거나(`auth_token_settled late=true`) 타임아웃(`auth_signin_timeout`)이면 프리페치 안 됨 → 전 세션 알람 미작동.
- **해결:** v0.22.0 — `googleAuth.settlePending` 성공경로에 `onTokenSettled` 구독훅 추가, useVoiceSession이 구독해 **토큰 지각 도착 시 재프리페치**(`resetPastIndexRetries`+`prefetchPastIndex`, 남은 셀부터 알람 복구). start()의 1회 프리페치는 유지.
- **한계(설계상):** 토큰 도착 **전** 입력한 셀, 타임아웃/오프라인 세션은 여전히 알람 불가 — 회차간 비교는 시트 과거값이 필요하므로 불가피.
- **출처:** `2026-06-25 v0.21.0 실기기 로그`(`auth_signin_timeout:15000`×2·late settle 17~19s; 단 토큰 일찍 온 이 세션에선 trend 10회 정상 발화 → "일부 세션"과 일치; firsthand 코드 확인).
- **현재 상태:** ✅수정됨(v0.22.0 `googleAuth.ts`·`useVoiceSession.ts`) — 지각 토큰 복구 실기기 검증 대기.

---

## ⑦ 리뷰 프로세스 교훈 → **[ENGINEERING-GUARDRAILS.md](./ENGINEERING-GUARDRAILS.md)로 이동**

이 절 전체(`[REVIEW-1]`~`[REVIEW-5]`)는 "지금 열려 있는 문제"가 아니라 **계속 지켜야 하는
계약**이라 [ENGINEERING-GUARDRAILS.md](./ENGINEERING-GUARDRAILS.md)로 옮겼다. 내용은 그대로다.

- `[REVIEW-1]` 빈 catch가 근본 버그를 수개월 가렸다 → 가드레일 ①
- `[REVIEW-2]` adversarial review는 데이터 유실을 잡는다 — 여러 회차 돌려라 → 가드레일 ②
- `[REVIEW-3]` "best-effort"라는 말이 게이트를 같은 날 두 번 뒤집게 했다 → 가드레일 ②
- `[REVIEW-4]` 진행 멈춤(silent return)은 reprompt로 → 가드레일 ①
- `[REVIEW-5]` 날짜 컬럼 '오늘' sentinel을 type=date 입력이 덮어쓴다 → 가드레일 ③

---

## ⑧ 입력 흐름 · 내비게이션

### [NAV-2] "유지" 명령이 인식되고도 무동작(no-op)
- **증상:** 재입력(reentry) 모드 밖에서 "유지"라고 말하면 명령으로 인식은 되지만 아무 동작·음성 피드백 없이 무시됨.
- **원인:** keep 처리가 reentry 모드 한정 분기라 그 밖에서는 silent return — [REVIEW-4] "무음 return 금지"의 재발.
- **해결·회피:** **v0.5.0에서 keep을 일반화** — 현재 칸에 값이 있으면(또는 reentry 중) 그 값을 유지하고 advance, 값이 없으면 "유지할 값이 없습니다. {항목명} 말씀해 주세요." 명시 피드백 + `keep_no_value` 로그(무음 return 금지). `voiceCommands.ts` desc 갱신.
- **출처:** `2026-06-10 실기기 로그` → **survey-011 v0.5.0** 수정
- **현재 상태:** ✅수정됨 (`src/lib/useVoiceSession.ts` keep 분기 line 871~, `src/lib/voiceCommands.ts`) — **2026-06-12 실기기 확인(재입력 안)**: 06-11 v0.6.0 로그 row12에서 "이전"으로 완료행 재진입 후 "유지" 2회(c7 conf .96 / c8 conf .94) → 값 233.3/244.4 보존·정상 진행. ⚠️ 재입력 **밖**(빈 칸) `keep_no_value` 경로는 여전히 미발화 — 다음 테스트 1회 요청.

### [POPUP-CLIP-1] 음성입력 알람 팝업 내부 문자 잘림
- **증상:** 음성입력 중 이상치 알람 팝업에서 긴 항목명·긴 값이 …로 잘리거나 가로로 넘쳐 안 보임.
- **원인:** `AnomalyAlertPopup` 항목명 라벨이 `whiteSpace:nowrap+overflow:hidden+textOverflow:ellipsis`, hero 현재값이 무줄바꿈 `clamp(40~60px)`로 가로 넘침. (z-index/레이어 문제 아님 — 팝업은 이미 fixed 오버레이고 PausedCard>AnomalyAlert는 의도된 상호배타.)
- **해결:** v0.22.0 — 항목명 ellipsis→줄바꿈 허용(`whiteSpace:normal`·`wordBreak:keep-all`·`overflowWrap:anywhere`), 큰 숫자 `maxWidth:100%`+줄바꿈+clamp 하한 축소. CommandHelpPopup·ModifyReentry 동일 점검. z-index 불변(PausedCard 우선순위 보존).
- **출처:** `2026-06-25 v0.21.0 민구 제보` + 375px 시뮬레이션 실측(잘림 0 확인).
- **현재 상태:** ✅수정됨(v0.22.0 `AnomalyAlertPopup.tsx`·`CommandHelpPopup.tsx`·`VoiceScreen.tsx`).
- **⚠️ 2026-07-02 v0.25.0 실기기 — 재오픈 후보(화면 미특정):** 민구 "화면 잘림 문제가 아직 개선되지 않았다" 재제보. 단 **어느 화면인지 미상**이고 로그 단서 0(비고 c9 전 행 공란·TTS 텍스트 미로깅·클립 오디오 전용) — 이 항목(알람팝업)인지 다른 표면(v0.25.0 신규: 데이터탭 큰팝업 `DataScreen.tsx:712,877,1120` maxHeight 78~82vh · 옵션 순번뱃지 `SettingsScreen.tsx` · `SettingsHelp.tsx`)인지 판별 불가. v0.22.0 검증은 375px **시뮬**이라 실기기 402px + iOS 텍스트 크기 확대(Dynamic Type) 조합은 미검증. **화면 특정(민구 1문답: 화면+스크린샷+텍스트크기) 전 코드 수정 금지.**
- **🟢 2026-07-03 자율 화면 스윕(402×874·375×812, Larry/Vance) — 유력 표면 실측·수정:** 전 탭+전 팝업 강제오픈 스크린샷 스윕에서 **CommandHelpPopup(？명령어)이 "잘려 보임" 실측** — `maxHeight:90%+overflowY:auto`라 기술상 스크롤이지만 스크롤 단서가 전혀 없어 마지막 항목(재시작·종료)이 화면 중간에서 끊겨 사용자에겐 잘림으로 보인다(타이포 21px·gap 15로 10개 항목이 90vh 초과). **v0.26.0 수정:** 타이포 압축(pill 16·설명 15·gap 9)으로 375×812에서 전 항목+하단 닫기 한 화면 수용 + 목록만 스크롤 컨테이너화. 가드: `v026-tolerance-strict.spec.ts` T4. 그 외 표면(알람카드·데이터탭 큰팝업·재질문 큐·기능4 안내팝업)은 두 뷰포트 모두 잘림 0 실측. **민구 재확인 필요:** 제보된 잘림이 이 팝업이었는지(아니라면 iOS 텍스트 확대 조합 의심).
- **🔴→✅ 2026-07-06 v0.27.0 데스크탑 재현 QA(Sonar 2차 라운드) — 이 팝업(AnomalyAlertPopup)의 별개 확인된 버그, 375×667 전용, 수정 완료:** 07-03 스윕이 확인한 402×874/375×812와 **다른, 더 작은 뷰포트** 375×667(iPhone SE급 — 이 앱이 지원하는 최소 화면)에서 Sonar가 실 하네스(BlackHole 오디오 주입) + CDP로 직접 재현·실측(`scripts/sonar-a1-outlier-real.js`): 이상치 카드는 일반 카드보다 콘텐츠가 많아(샘플키+추세라벨+직전→현재+안내문) `useFitScale.ts`의 공용 FIT_STEPS 최저(0.58)로도 375×667에서 다 안 들어감(실측 `scrollHeight=131` vs `clientHeight=77`, 내부 스크롤 발생·하단 컨트롤과 겹침). 412×915/430×932는 기존대로 PASS(재확인) — **375×667만의 좁은 breakpoint 버그.**
  - **해결(v0.28.0):** 이 카드 전용으로 (a) `useFitScale`에 호출자별 확장 축소 단계를 넘길 수 있는 선택적 파라미터 추가(공용 `FIT_STEPS`·다른 카드는 무변경 — 이미 첫 단계에서 fit되는 카드는 회귀 위험 0), (b) 패딩·행간격도 `--fit-lo`에 연동(하한 有)해 극단 압축 시 여백까지 함께 줄게 함, (c) GL-005 우선순위 하위 요소(P4 "직전 (날짜)" 라벨, P5 hero 위 중복 항목명 라벨)를 `max-height:700px` 미디어쿼리로만 숨김(측정 기반 토글이 아니라 뷰포트 높이 고정 조건이라 되튐 없음 — 정보 손실은 없음, 핵심 비교 숫자는 유지), (d) 현재값(P1) 폰트 하한은 기존 `v027-voice-cards-fit.spec.ts`가 이미 단언하는 GL-005 가독 하한(≥26px)을 그대로 유지 — "현재값은 항상 크게"(민구 원칙) 불변.
  - **회귀 테스트:** `tests/v027-voice-cards-fit.spec.ts`에 375×667 전용 케이스 추가(짧은 컬럼명+통상값의 실제 재현 시나리오) — `scrollHeight≤clientHeight` 무스크롤 + 핵심 정보(현재값·알람라벨·직전값·항목명) visible 단언. 기존 402×874/375×812(긴 항목명+큰 음수 워스트케이스) 케이스도 재확인 통과(무변경 확인).
  - **알려진 잔여 한계(범위 밖):** 이 라운드가 검증한 "긴 항목명+큰 음수" 워스트케이스를 375×667에도 동시 적용하면(둘 다 극단) `useFitScale`의 +1px 관용오차 탓에 1px 잔여가 남는 조합이 있다(예: scrollHeight 128 vs clientHeight 127) — 이번에 실제 보고된 버그(통상적인 컬럼명·값)에서는 발생하지 않으며, 별도 관측 대상으로만 남긴다.
  - **출처:** `2026-07-06 v0.27.0 데스크탑 재현 QA(Sonar 2차 라운드)`, `Deliverables/2026-07-06-qa-desktop-repro-round2-reviewed.md` → **survey-011 v0.28.0** 수정.
  - **현재 상태:** ✅수정됨(`src/components/voice/useFitScale.ts`, `src/components/voice/AnomalyAlertPopup.tsx`, `src/styles/global.css`). 실기기(iPhone SE 등 375급 실단말) 확인은 다음 실기기 세션 대기.

### [DEPLOY-PAGES-STUCK-1] gh-pages "Published" ≠ 라이브 반영 — GitHub Pages 빌드 무통보 스턱/실패
- **증상:** `npm run deploy`(gh-pages)가 "Published"를 찍고 gh-pages 브랜치 push도 성공했는데, 라이브는 이전 버전 번들을 계속 서빙. v0.26.0 배포(07-03 04:29Z)에서 Pages 빌드가 "building" 스턱 후 "Page build failed"(duration 0, 즉시 실패)로 종료 — 로컬엔 아무 오류도 안 보임.
- **원인:** gh-pages push 이후의 GitHub Pages 빌드는 GitHub 측 비동기 단계라 로컬 성공 출력과 무관하게 실패할 수 있음(이번 건은 트리가 직전 성공 배포와 구조 동일 → GitHub 측 일시 오류로 판정).
- **해결·회피:** ① 재빌드 트리거 `gh api -X POST repos/<owner>/survey-011/pages/builds` → status "built" 확인 → 라이브 `index.html` 번들 해시 대조로 종결. ② **배포 검증 규칙: "라이브 번들 해시 확인까지가 배포다"** — dist 해시 확인만으로 배포 완료를 선언하지 말 것(이번 실수). 상태 조회: `gh api repos/<owner>/survey-011/pages/builds/latest`.
- **출처:** `2026-07-03 v0.26.0 배포`(민구 실기기에서 미반영 확인 → 진단·재빌드로 정상화, 라이브 `index-C54ez99l.js` 확인).
- **현재 상태:** ✅해소(재빌드로 정상화). 재발 시 위 절차. 배포 후 라이브 해시 확인을 표준 단계로 승격(⚠️주시).

### [CLIP-CORRECTION-1] 정정(재커밋) 발화가 클립에 미수록 → 근본원인 특정: 명령 클립이 정정 대상이 아닌 다음 대기 컬럼에 오태깅
- **증상:** 07-02 S1 r18c8 — 사용자가 166.6 커밋 후 366.6으로 정정, **시트값은 366.6 정상**. 그러나 클립 감사(whisper 전사 + raw 재전사 + 이벤트 3각 대조)에서 final 클립·:a1 클립 모두 원 발화(166.6)만 담고 있고 **정정 발화(366.6, conf 0.99)를 담은 클립이 없음**(n=1 관측). 데이터 무결성 문제 아님 — 클립 감사 품질 문제([CLIP-VAL-1] 계열 잔존, 그 항목은 v0.7.0 3중 수정 후 아카이브).
- **근본원인(2026-07-06 Sonar 데스크탑 재현 QA로 코드 레벨 특정):** `src/lib/useVoiceSession.ts`의 `enterModifyMode`에 두 경로가 있다 — ① **direct-modify**("수정 <값>" 한 발화로 값까지 결합, L677~) 경로는 v0.6.0 CLIP-CMD 수정으로 명령 클립을 **정정 대상 셀**(`targetRow:target.id`)로 올바르게 재연결한다(L690 `pendingCmd.saveFor(targetRow, target.id)`). ② **cascade** 경로("수정"만 먼저 말하고 새 값을 별도 발화로 나중에 말함, 훨씬 흔한 패턴)는 CLIP-CMD 수정이 안 닿아 있었다 — `pendingCmd.saveDefault()`(L756, 수정 전)가 명령 클립을 "수정"이 발화된 **시점에 대기 중이던 다음 컬럼**(`awaiting.row/colId` — 정정 대상이 아니라 그다음 프롬프트될 필드)의 키로 저장했다. 즉 클립이 사라진 게 아니라 **정정 대상 컬럼 기준으로 찾으면 "없다"로 보이는, 엉뚱한 컬럼에 파일링**된 것 — 07-02 n=1 관측과 정확히 일치하는 재현(`~/projects/survey-011-test-harness/qa-antigravity/scripts/sonar-a4-direct2.js`로 재현 가능, clips-manifest.json에서 cmd 클립 colId가 c9(대기 컬럼)로 찍히고 c8(정정 대상)엔 없음을 직접 확인).
- **해결(v0.28.0):** cascade 경로(L756)의 `pendingCmd?.saveDefault()`를 `pendingCmd?.saveFor(targetRow, target.id)`로 교체 — direct-modify 경로와 동일한 불변식(명령 클립 = 정정 대상 셀)을 적용한다. target/targetRow는 그 시점에 이미 확정돼 있고(재질문·재수정 중에도 같은 셀을 향해 재답함) 값이 실제로 커밋될 값 클립은 별도 bare 키로 새로 녹음되므로 포인터 재연결은 불필요 — cmd 클립 자체만 올바른 컬럼으로 재배치하면 된다. `preserveCommandClip`/`PendingCommandClip.saveDefault`의 JSDoc도 "awaiting===target일 때만 안전"으로 갱신.
- **회귀 테스트:** `tests/clip-modify-rerecord.spec.ts`에 `[CLIP-CORRECTION-1]` 신규 케이스 추가(cascade "수정"만 발화 → 별도 발화로 재입력 → 명령 클립이 정정 대상 컬럼(c8)에 저장되고 대기 컬럼(c9)엔 없음을 단언). 기존 "②③ cmd 클립이 없는 빈 캡처" 케이스는 수정 후 cmd 클립이 이제 c8에도 정상 생성되므로, "cmd 클립 자체가 없는" 시나리오(수정 발화 자체도 빈 캡처)로 갱신해 원래 검증 의도(재연결 대상 부재 시 unlink)를 보존했다. 인접 "①②③" 케이스의 cmd 인덱스(cmd1→cmd2)도 이 수정으로 인한 정당한 재번호 매김에 맞춰 갱신.
- **출처:** `2026-07-03 클립 감사`(`Deliverables/2026-07-03-clip-audit-reviewed.md`), 07-02 S1 sess_…851856 r18c8 → **2026-07-06 v0.27.0 데스크탑 재현 QA(Sonar 2차 라운드)**로 근본원인 특정·수정.
- **현재 상태:** ✅수정됨(`src/lib/useVoiceSession.ts` L756 부근, `tests/clip-modify-rerecord.spec.ts`). 실기기 재현(다음 실기기 세션의 클립 감사)으로 최종 확인 대기.

### [MIC-BANNER-POPUP-OVERLAP-1] 마이크 재연결 배너가 ？명령어 팝업 상단(✕ 닫기)을 가림
- **증상:** 마이크 유실 배너(role=alert, 상단 고정)가 떠 있는 동안 CommandHelpPopup 상단 ✕ 닫기가 배너에 덮여 탭 불가(배너가 포인터를 가로챔). 백드롭 탭으로는 닫히지만 사용자가 모를 수 있음.
- **원인:** 배너와 팝업이 화면 상단을 공유, 배너 z-index가 팝업(z 50) 위.
- **해결·회피:** v0.26.0 — CommandHelpPopup에 **하단 전폭 "닫기" 버튼**(`cmd-help-close`, minHeight 48) 추가로 배너와 안 겹치는 닫기 경로 확보(장갑 친화 겸용). 배너 z-index 정책 자체는 불변(마이크 유실 안내가 최우선이라는 의도 존중).
- **출처:** `2026-07-03 자율 화면 스윕` — Playwright 클릭이 배너 interception으로 실패하며 실측(mock 환경에서 배너 상시 유지 특성으로 발견; 실기기서도 마이크 유실+팝업 동시 상황이면 동일).
- **현재 상태:** ✅완화됨(v0.26.0 `CommandHelpPopup.tsx`). 근본(배너-팝업 상단 경합 레이아웃 정책)은 ⚠️주시.

### [REGION-1] 입력탭 영역 충돌 — 수동 입력 시트가 하단 나비를 덮음 + 알람이 인접 영역 침범 (재발 v0.33.0→v0.36.0)
- **증상(민구 제보, v0.33.0~v0.36.0 반복):** ① 칩 수동 입력 시트를 열면 하단 나비(TabBar)가 사라진다("나비가 유지되길 바람"). ② 이상치/범위 알람 카드가 인접 영역(파형·컨트롤)을 침범하는 것처럼 보인다.
- **원인(부분 확정):** ① 수동 입력 시트는 `ModalBase`(fixed inset:0 backdrop)로 뷰포트 전체를 덮는 **모달**이라 하단 나비도 dim/피복된다 — 모달의 정상 동작이나, 민구는 나비가 남길 원함. **상충:** 하단 시트는 뷰포트 바닥에 붙어 나비를 '띄운 채' 두면 시트의 하단 액션 버튼(취소·음성재입력)이 나비 뒤로 숨는다 → "나비 유지"와 "시트 버튼 노출"이 배치상 상충. ② v0.37.0 full-bleed EdgeGlow(fixed z-54) 전환으로 글로우가 하단 나비/수동 시트(구 z-50) 위를 씻고 지나가는 **새 교차**가 생겼다.
- **해결·회피(v0.37.0 FB-I):** ② 계열 봉합 — 수동 입력 시트 z-50→**55**(글로우 54 위, 일반 모달 100 아래)로 올려 글로우가 입력 UI를 덮지 않게 함. TabBar에 `position:relative; z-index:54`를 부여해 full-bleed 글로우가 **지속 chrome(나비)를 씻지 않게** 함.
  **① 계열 확정 해소(민구 결정 "네비는 항상 보여야 함"):** 종전 상충("나비 유지" vs "시트 버튼이 나비 뒤로 숨음")은 시트를 **뷰포트 바닥이 아니라 나비 상단에 올려앉히는** 배치로 풀었다. (a) `ModalBase`에 opt-in `bottomInset` prop 신설 — 지정 시 오버레이(dim+flex 컨테이너)의 `bottom`을 그 CSS 길이만큼 끌어올린다(기본 undefined = `bottom:0` = 기존 동작, 다른 8개 모달 바이트 불변; 유일 `align='end'` 호출부가 이 시트뿐이라 회귀면 0). (b) `TabBar`가 마운트 시 `ResizeObserver`로 **실측 offsetHeight**를 `--nav-h`로 발행(손계산은 버튼 padding/border/폰트/`--sab`로 언더슈트해 나비 상단을 자름 = 잘림 실패방향 → 실측 SSOT). `:root{--nav-h:100px}`는 err-large 첫 페인트 폴백. (c) 시트가 `bottomInset='var(--nav-h)'`로 나비 위에 붙고, 나비가 이미 `--sab`를 흡수하므로 시트 자체 하단 패딩은 flat 16px(이중 safe-area 제거). 결과: 수동 입력 중 나비가 **덮이지도 dim되지도 않고 상시 노출·탭 가능**(탭 전환 가능). 회귀 `tests/v037-chip-2row.spec.ts` FB-I — geometry 오라클(나비 top ≥ 시트 bottom) + tab-* 가시·trial 탭, 402×874(sab 0)·375×667(sab 34) 양쪽(수정 전엔 두 케이스 다 실패 확인). z-index 단언은 하지 않는다(bottomInset로 나비/시트가 공간상 안 겹쳐 z 순서 무의미 — geometry가 진짜 오라클).
  **알람 침범(②의 알람 부분): resolved-by-construction.** `AnomalyAlertPopup`은 fixed 오버레이가 아니라 row3 흡수영역(overflow:hidden, 파형·컨트롤·나비보다 **위**의 in-flow 카드)이라 구조상 나비를 덮을 수 없다 — 실측 침범 재현 불가. device-gated 관측 항목으로 유지(제품 코드 수정 대상 아님).
  **후속 봉합(v0.37.0 리뷰#2, 민구 — STT suspend 유실):** 위 caveat의 "시트를 열어둔 채 탭을 옮기면 STT는 suspend 유지"는 **무해가 아니라 데이터무결성 구멍**이었다(민구 제보). 시트가 STT를 hard-suspend한 채 탭을 누르면 `onManualClose`(resume 배선)가 발화하지 않아 STT가 정지된 채 화면만 전환돼 이후 발화가 유실됐다. 수정: store `overlayCloseSeq` nonce 신설 — App.tsx `changeTab`이 실제 탭 전환 직전 nonce를 증가시키고, 세션 내내 마운트된 `ActiveState`의 구독 effect가 열린 수동 시트/？명령어 도움말을 닫는다(→ `onClose`→`resumeRecognitionForUi`로 STT 재개). 회귀 `tests/v037-chip-2row.spec.ts` 리뷰#2 — 실제 탭 전환(trial 아님) 후 ① 시트 닫힘 ② 음성 탭 복귀 즉시 STT 결과 커밋(활성 칩 전진). CommandHelpPopup(z-55 inset:0)은 종전대로 backdrop 탭이 onClose→resume을 발화하므로 별도 변경 불필요(nonce가 방어적 추가 커버).
- **출처:** `v0.33.0~v0.36.0 민구 반복 제보`(개선요청 채널) → **survey-011 v0.37.0 FB-I** 확정 봉합(민구 "네비는 항상 보여야 함").
- **현재 상태:** ✅수정됨(수동 입력 중 나비 상시 노출·탭 가능; 글로우/시트/나비 z-계층 정리) — 실기기 검증 대기(iOS standalone에서 `--nav-h` 실측·시트 정착 육안 확인). 알람 침범은 resolved-by-construction(in-flow 카드).

### [VIS-AUDIO-REVIEW-1] ⚠️ 검토(complete) 화면값과 TTS 발화가 글자까지 일치하지 않음 (민구 Option 1 수용, 관측)
- **증상(코덱스 리뷰 v0.37.0 리뷰#3, 유효):** 입력 검토(phase 'complete') 화면은 FB-E로 "방금 입력한 값"을 크게 보인다. 그러나 그 순간 실제 TTS는 화면의 단일 값과 **글자까지 일치하지 않는다** — 세 진입 경로 모두: ① 정상 행완료 `announceRowComplete()`는 auto-컬럼 변경분 또는 "완료."만 발화(음성 값 미발화), ② '이전' 완료행 재방문 `enterReviewWait()`는 그 행 **모든** 음성 컬럼을 낭독(화면은 한 값), ③ 마지막행 `announceEndReached()`는 종료 안내 발화. 즉 화면의 "확정 중인 단일 값"을 발화가 그대로 확인해 주지 않는다(PRINCIPLES §2 시각·청각 일치 관점 편차).
- **원인(설계 상충):** FB-E("검토에 방금 입력한 값 크게 표시", 민구 확정 + 특성화 테스트 2건이 박제)와 §2 글자일치가 **본질적으로 상충**한다. 화면에서 값을 없애면 §2를 지키지만 FB-E를 뒤집고, 값을 유지하면 발화가 그 단일 값을 확인하지 않는다. 완전 해소는 **TTS 발화 자체 변경**이 필요한데 그건 §10(발화 문자열/조건 무수정)이라 자동 수정 범위 밖 = 민구 판단 영역.
- **결정(민구, v0.37.0 리뷰 Option 1):** FB-E 값 표시를 **유지**하고, 오표시(잘못된 값)만 고친다. **#3의 음성 글자불일치는 잔여로 수용**하고 TTS는 건드리지 않는다.
- **값 오표시 해소 경과(2단계):** ① r2(`[리뷰#2]`)는 검토값을 `valueBurst`에서 파생 — 하지만 `valueBurst`는 **음성 커밋에서만** 발행돼, 마지막 셀을 **수동 입력**으로 채우면 앞 음성 셀의 stale 값을, **이상치 정정**으로 채우면 정정 전 값을 여전히 오표시했다(부분 해소). ② v0.37.0 리뷰#1(`[리뷰#1, 민구]`, 커밋 영수증)이 완결 — store `commitReceipt`를 **모든** 커밋 경로(음성·수동·이상치 정정 [확인])가 원자적으로 발행하고 검토 파생이 이를 소비한다. 파생 훅은 `ActiveState`(세션 내내 마운트)로 올려 이상치/일시정지 카드로 VoiceHero가 remount돼도 영수증을 놓치지 않는다. **검토 화면 값은 이제 어떤 경로로 채웠든 실제 방금 커밋된 셀 값**이다(회귀 `tests/v037-review-receipt.spec.ts` 3종: 수동 마지막 셀·이상치 정정 마지막 셀·'이전' 재방문 중립 폴백).
- **여전히 잔여(§2 시각·청각 글자일치):** 위는 **값 정확성**만 해소한다. 화면에 표시된 값 **문자열이 그 순간 `say()` 발화 문자열과 글자까지 일치**하는지(#3)는 **별개 잔여**로 남는다 — 세 진입 경로의 발화가 화면의 단일 값을 그대로 확인해 주지 않으며, 완전 해소는 TTS 발화 변경(§10, 민구 판단 영역)이 필요하다. **글자일치는 해결되지 않았다**(값 정확성만 해결).
- **주시 포인트:** 실기기에서 검토 화면 값과 발화의 불일치가 사용자 혼동(특히 '이전' 재방문 시 화면=중립 "N행 완료" vs 발화=전체 낭독)을 유발하는지 관측. 유발되면 TTS 통일(민구 결정 필요, §10) 또는 검토 화면 중립화(FB-E 재검토)를 재상정.
- **출처:** `survey-011 v0.37.0` 코덱스 이중리뷰 리뷰#3 지적 → 민구 Option 1 결정(값 유지·오표시만 수정·#3 잔여 수용).
- **현재 상태:** 검토값 **오표시는 완결 수정**(`[리뷰#1]` 커밋 영수증 — 음성·수동·이상치 정정 전 경로). §2 **글자일치는 ⚠️주시 잔여**(설계상 수용된 편차 — 코드 결함 아님, TTS 변경은 민구 판단 영역).

### [REASK-TOLERANCE-LOG-1] 인식 허용범위 설정값 미로깅 → "설정값 vs 인식률" 비교 불가 + 고신뢰 재질문 혼동
- **증상:** 민구 "허용범위 50% 설정 후 인식률 80~90%인데 재인식 요구". 로그로 검증 시도 → **허용범위 설정값이 어디에도 안 남아** 설정값 대조 불가. 분석 결과 허용범위 게이트는 **정상**(S1 신뢰도<0.60 = 정확히 5건 → 저신뢰 재질문 5건 일치). 고신뢰 재질문은 대부분 **파싱 실패**(`"200 10일 전에"`·`"200대 17.7"`·`"100-4.4"`)로 신뢰도 게이트와 무관.
- **원인:** ① `recognitionTolerance`는 zustand persist로만 보관, `setting_changed`엔 `fastRecognition`만 로깅. ② 저신뢰 재질문 분기(`useVoiceSession:1338`)가 **이벤트 미로깅**. ③ 상단 인식률 %는 STT 신뢰도라 높게 떠도 값은 파싱 실패로 재질문되는 인지 부조화.
- **해결:** v0.23.0 — ① 세션시작 메타에 `recognitionTolerance` 박제 + 허용범위 다이얼 변경 시 `setting_changed:recognitionTolerance=<v>` 로깅. ② 저신뢰 재질문에 신규 이벤트 `stt_rejected_low_confidence`(`confidence`+`extra:tolerance:<v>`). ③ 재질문 시 화면에 사유 큐(`sessionStore.reaskReason`: low_confidence/parse_failed) 표시(`ReaskCue`).
- **출처:** `2026-06-26 v0.22.0 실기기 로그`(2세션 `setting_changed:recognitionTolerance` 0건; 저신뢰 5건/파싱실패 7건; firsthand 코드 확인). Playwright `v023-voice.spec.ts` B2.
- **현재 상태:** ✅수정됨(v0.23.0 `useVoiceSession.ts`·`logger.ts`·`sessionStore.ts`·`VoiceScreen.tsx`·`ReaskCue.tsx`). **🟡 2026-06-29 v0.23.0 실기기 부분확정:** 저신뢰 로깅 작동 — `stt_rejected_low_confidence` 3건 모두 `confidence`(0.074·0.269·0.462)+`tolerance:0.5` 동봉, 3건 다 conf<0.5 게이트 정상. 세션메타 `recognitionTolerance:0.5` 스냅샷 ✅. `stt_parse_failed` 유형 세분(decimal_fraction_lost×3·multi_numeric×3·extraneous_token×1) ✅. **검증 갭:** 이번 세션 `setting_changed:recognitionTolerance` 0건(민구가 다이얼 미변경) → 변경 로깅 경로·설정값↔신뢰도 대조는 **다음 실기기에서 허용범위 1회 변경 후 완결** 필요.
- **✅ 2026-06-30 v0.24.0 실기기 2세션 — 검증 완료:** `setting_changed:recognitionTolerance` **양 세션 각 5회**(S1 0.55→0.8→0.65→0.75→0.8 / S2 0.9→0.85→0.5→0.4→0.55), 게이트가 **라이브 tolerance 추종**(S1 conf 0.777 거부@0.8 / S2 0.893 거부@0.9). 직전 갭 해소. **⚠️관찰(F1, Vance 후보):** 다이얼↑(0.8~0.9)=게이트 더 엄격→적정신뢰도(0.78~0.89) 거부 다발, "허용범위↑=관대" 직관과 반대 → 민구 멘탈모델 확인 선행(추측수정 금지).
- **🟡 2026-07-02 v0.25.0 실기기 — F1 반전 배포 결과(→ v0.26.0 원복 확정):** v0.25.0이 다이얼을 "높을수록 관대"로 반전(minConf = 0.4+0.9−tolerance). 실기기 2세션: 다이얼 **0.55 방치**(변경 0회, 직전 세션 종료 위치) → 실효 minConf **0.75로 점프**. 거부 8건 전부 `tolerance:0.55,minConf:0.75` 동봉·conf<0.75 정합(게이트 배선 정확). 부작용 실증: 0.55~0.75 대역 거부 3건 중 **정답값 "100"@0.62 거부 1건**(반전이 추가한 순수 마찰; "8.8"@0.639·"3000"@0.575는 오답이라 우연히 유익). 거부율 자체는 8/87(9.2%)로 폭증 없음. **교훈: 게이트 방향 반전은 기존 다이얼 위치의 의미를 뒤집는다**(마이그레이션 없는 반전 = 사용자가 안 만졌는데 임계 이동). 민구 최종 결정 — **원래 방향(높을수록 엄격) 복귀 + 다이얼 캡션/aria에 방향 명시**(v0.26.0, `settingsStore.minConfidenceForTolerance` 단일 지점).
- **✅ 2026-07-03 v0.26.0 원복 구현:** `minConfidenceForTolerance = tolerance` 직접 매핑(다이얼 90%=minConf 0.90 가장 엄격), 다이얼 캡션 "높을수록 엄격 (확실한 발음만 인정)"+aria 동기 명시(방향 오해 재발 방지), 대역·기본값·persist 불변. 방향 고정 전용 스펙 `v026-tolerance-strict.spec.ts` T1~T3 신설(이 스펙이 깨지면 방향이 또 바뀐 것). 참고: 07-03 실 STT 시뮬(Tier3 무인)서 실측 신뢰도 0.70~0.85 관측 — 다이얼 85%+ 설정 시 정상 발화도 거부될 수 있어 **기본 60% 유지 권장**.

### [LOG-UPLOAD-SELECTED-1] 다중세션 "시트에 추가" 시 일부 세션 로그만 Drive 업로드
- **증상:** 민구 "복수 세션을 시트에 추가 시 일부 세션 로그 파일만 업로드되는 듯". v0.21.0 테스트에서 스피커폰 세션 로그가 Drive에 누락된 바 있음.
- **원인:** 로그 업로드가 `report.successIds`(=시트에 **새 행이 실제 추가된** 세션)에만 게이팅(`DataScreen:220,225`) → 이미 동기화돼 새 행 0인 세션을 함께 선택하면 그 로그가 누락. 또 세션별 업로드 전체 실패가 `drive_upload:partial:user_drive,admin_drive`로 오라벨돼 사용자에게 실패가 분명히 안 보임.
- **해결:** v0.23.0 — 로그 업로드 대상을 **선택한 모든 세션(행 보유)**으로 확장(`uploadIds = ids.filter(hasRows)`). 세션별 백업 성공을 `backedUpOk` Set으로 추적, `backupOk`(autoDelete 게이트)는 여전히 `successIds.every(backedUpOk)`로 데이터 유실 방지 불변식 보존. 사용자 메시지에 **"로그 N/N 세션 백업"** + 실패 세션 수 명시.
- **출처:** `2026-06-26 v0.22.0 실기기 로그`(이번엔 2세션 모두 업로드 성공이나 근인=successIds 게이팅 코드 확인; 06-25 `drive_upload:partial:user_drive,admin_drive` 흔적). firsthand 코드 확인.
- **현재 상태:** ✅수정됨(v0.23.0 `DataScreen.tsx`). **⚪ 2026-06-29 v0.23.0 미검증:** 단일 세션이라 "새 행 0 세션 + 신규 세션 동반 선택" 시나리오 자체가 미발생 → 선택업로드/`N/N` 표기 **다음 실기기에서 2개+ 세션 동시선택**으로 검증 필요. **🟡 partial 라벨 inconclusive:** 세션종료 자동 export가 `drive_upload:partial:user_drive,admin_drive`(핸들러 `DataScreen.tsx:258` = 그 export의 양 레그 에러)로 찍혔으나 4.3초 뒤 2차 export(`_1782708326230.zip`)가 admin 취합폴더 정상 안착 → 로그는 자기 업로드 성공을 기록 못 해 "전송실패-후-재시도성공 vs 실제 부분실패" 판별 불가. 차기 로그에서 단일세션 자동 export의 partial 빈도·레그 패턴 누적 관측(06-25·06-26·06-29 연속 관측).
- **🟡 2026-06-30 v0.24.0 실기기 2세션 — 다중세션 업로드 기능적 성공 + partial 4연속:** 2세션 함께 export·**둘 다 Drive 안착**(rclone 수확)=동시선택 업로드 성공. 단 export 시점 `drive_upload:partial:user_drive,admin_drive`×3 또 기록(**06-25/26/29/30 4연속**) — 데이터는 도달하나 라벨이 진짜 실패와 외관 동일. "로그 N/N 세션 백업" 토스트는 미계측(육안 필요). 라벨 정밀화(레그별 성공/실패 분리) 백로그 F2.
- **🟢 2026-07-02 v0.25.0 — partial 4연속의 사후 입증 + 신규 라벨 검증은 다음 export로:** 07-02 zip의 누적 이력에서 06-30 `partial:user_drive,admin_drive`×3 **뒤 13~21초 내 `drive_upload:ok`×3** 확인 — 4연속 partial은 "재시도 성공이 그 zip 스냅샷 밖"이었던 오해로 종결. v0.25.0 F2 레그 분리 라벨(`drive_upload:ok`/`partial:fail=<legs>:ok=<legs>`, `DataScreen.tsx:289-303`)은 배포됐으나 **export zip은 자기 업로드 결과를 담을 수 없는 구조**(스냅샷이 업로드 완료 전 생성, 07-02 자기 이벤트 0건)라 실기기 검증은 다음 export 로그에서.

### [CLIP-R1] recoverStream 쿨다운이 **첫 회복**을 막는다 — 로드 직후 3초 사각지대 (자동 재연결 무력화)

- **무엇:** `AudioRecorder.recoverStream`의 쿨다운 가드가 `performance.now() - lastRecoverAt < 3000`인데 `lastRecoverAt` 초기값이 **0**이다. `performance.now()`는 **페이지 로드 후 경과 ms**라, 로드 직후 3초 동안은 `now - 0 < 3000`이 성립해 **모든 재획득이 조용히 차단**(false 반환, getUserMedia 호출 자체가 없음)된다.
- **왜 이제 문제인가:** v0.14.0~v0.37.0에서는 recoverStream 진입점이 **사용자 제스처(수동 재연결 버튼)뿐**이라 잠복해 있었다(사람이 로드 3초 안에 버튼을 누를 일이 드물다). v0.38.0 #5의 **자동 재연결은 사고 시점에 즉시 발화**하므로 이 구간에 정면으로 걸린다. 걸리면 **getUserMedia를 부르지도 못한 채 자동 1회 가드(`micAutoReconnectAttemptedRef`)만 소진**하고 수동 배너로 떨어져, 자동화가 목적인 기능이 조용히 무력화된다.
- **테스트가 결함을 가리고 있었다(중요):** #5 회귀 2종은 **병렬 전체 실행에서는 통과**한다 — 머신 부하로 3초가 지나가기 때문이다. **격리(`--workers=1`) 단독 실행에서 3/3 실패**했다. 즉 이 건은 "격리하면 통과 = 부하성 flake"의 **정반대 패턴**이며, 전체 스위트 green만 보고 있으면 절대 안 잡힌다.
- **해결(v0.38.0 `e1dbff0`):** `lastRecoverAt` 초기값을 `-RECOVER_COOLDOWN_MS`로. 쿨다운은 **연속** 재획득 폭주를 막기 위한 것이지 첫 회복을 막으려는 게 아니다. 수정 후 격리 6/6 통과.
- **실기기 연결점:** v0.37.0 로그(2026-07-22 10:16)에 블루투스 전환 직후 `mic_reconnect_ok` → `clip_empty` → `audio-capture` 연쇄가 실재한다. **연속 실패 구간에서는 쿨다운이 실제로 걸리는 조건**이므로, 자동 재연결의 실기기 효능은 다음 회차 로그에서 `mic_auto_reconnect:result=*`로 확인해야 한다.
- **출처:** `survey-011 v0.38.0` 2026-07-22 세션(#5 회귀 격리 검증).
- **당시 상태(2026-07-22):** ✅수정됨 — v0.38.0 브랜치, 미배포.
- **현재 상태:** **v0.38.0에 포함되어 배포됨**(브랜치는 main에 병합, 현재 앱 v0.39.0). 격리 회귀 6/6 통과.
- **실기기 상태:** ⚠️**미확인** — 자동 재연결의 실기기 효능은 다음 회차 로그의 `mic_auto_reconnect*` 연쇄로 판정한다.

### [PAST-2] 과거값 인덱스 준비 조건이 호출부마다 복붙돼 갈라짐 — 신규 호출부가 게이트를 통째로 누락

- **무엇:** "과거값 인덱스를 지금 만들 가치가 있는가"라는 **같은 판단**이 App 부팅·로그인·설정 저장·테이블 생성·시트 재연결 **5곳에 복붙**돼 있었고, 모양이 갈렸다 — `anyRule`만 보는 곳, `anyRule && readonlySheetsAuth()`인 곳, `anyRule && sheetUrl && sheetTab`인 곳.
- **결과:** v0.38.0에서 시트 재연결에 재조회를 추가할 때 **게이트를 통째로 빠뜨렸고**(이상치 규칙이 없는 시트도 헤더 읽을 때마다 전체 시트 조회 = 데이터·배터리·쿼터 낭비, 기능 격리 원칙 위반), 그 다음 수정은 **게이트를 절반만 복제**했다. Codex 리뷰가 두 건을 각각 지적했다.
- **해결(v0.38.0 `ce6ced8`·`bf47450`):** `pastValues.shouldPreparePastIndex()` 단일 술어로 접고 호출부는 그것만 쓴다.
- **⚠️ 통일할 때 밟은 함정:** 인증 검사(`readonlySheetsAuth`)를 **모든** 호출부에 적용했더니 v0.34.0 apikey 계측 테스트가 깨졌다. **부팅 경로는 인증이 없어도 `loadPastIndex`까지 진입시켜 `past_index_skip:not_signed_in`을 남기는 것이 의도**다 — 그 계측이 "왜 이 세션에 알람이 없었나"를 판별하는 유일한 단서이고 SOP-003 파서와의 바이트 계약이다(v0.34.0 C9). → `requireAuth` 옵션으로 분리(부팅·로그인은 인증 무관, 시트 저장·테이블 생성은 인증 확인).
- **교훈:** 같은 파일/모듈에 유사 가드가 3개 이상이면 **헬퍼로 접는다.** 단, 접을 때 "미묘하게 다른 이유"가 있는지 먼저 확인 — 여기선 그 차이가 **계측 계약**이었다.
- **출처:** `survey-011 v0.38.0` SOP-004 리뷰 r1(Codex Medium ×2) → 수정.
- **당시 상태(2026-07-22):** ✅수정됨 — v0.38.0 브랜치, 미배포.
- **현재 상태:** **v0.38.0에 포함되어 배포됨**(현재 앱 v0.39.0).

### [PAST-3] 낡은 과거값 요청의 403이 최신 지문의 재시도 예산을 소진

- **무엇:** 구지문 조회가 느리게 진행되는 동안 신지문 조회가 시작된 뒤 구요청이 403으로 끝나면,
  catch가 요청 세대와 무관하게 전역 `retryAttempts=MAX_RETRIES`를 썼다. 이어 신요청이 일시적 5xx로
  실패해도 백오프가 차단돼 최신 지문의 이상치 비교선이 준비되지 않았다.
- **근인:** `retryAttempts`는 지문별 이력이 아니라 단일 `retryTimer`와 함께 **지금 준비 중인 인덱스**의
  예산인데, 성공 게시만 generation으로 보호하고 성공 reset·권한 오류 소진은 보호하지 않았다.
- **해결(v0.38.0 태스크 06):** 성공 예산 reset을 최신 generation 게시 가드 뒤로 옮기고, 권한 오류의
  예산 소진·`past_index_retry_blocked:permission` 계측도 최신 generation일 때만 적용한다. 최신 요청의
  정상 403은 종전대로 즉시 차단한다(텔레메트리 문자열 불변).
- **회귀:** 구요청·신요청을 각각 인위적으로 보류하고 `구 403 → 신 500 → 백오프 성공` 순서를 강제하는
  `tests/v038-past-index-retry-generation.spec.ts`. 기존 정상 403 차단 계약은
  `tests/v034-past-index-apikey.spec.ts`가 계속 고정한다.
- **출처:** `survey-011 v0.38.0` 리뷰#3 태스크 06(2026-07-23, 당시 미배포 브랜치).
- **당시 상태(2026-07-23):** ✅코드 수정·회귀 작성. ⚠️제한 샌드박스의 Chromium Mach rendezvous
  EPERM으로 브라우저 회귀·수정 제거 반증은 실행 미확인([TEST-SANDBOX-1]).
- **현재 상태:** **v0.38.0에 포함되어 배포됨**(현재 앱 v0.39.0). v0.38.2부터 `predeploy`가 전체
  Playwright 스위트를 배포 전에 강제하므로 이 스펙은 릴리스 게이트에서 실행된다(2026-07-26 전체 스위트 858 passed).
- **실기기 상태:** ➖해당없음 — 데스크톱 회귀로 고정되는 축이다.

### [PAST-4] 시트 삭제 중이던 조회가 삭제한 과거값 스냅샷을 다시 게시

- **무엇:** 설정 초기화에서 시트 정보를 지우고 IDB 과거값만 fire-and-forget 삭제했지만, 이미 진행
  중인 `loadPastIndex` 세대는 그대로였다. 늦은 응답이 게시 가드를 통과해 메모리 캐시·폴백·IDB에
  방금 삭제한 농가 데이터를 되살렸다.
- **근인:** 시트 미설정 skip은 새 조회를 시작하지 않아 generation을 올리지 않는다. 호출부가 IDB만
  개별 삭제해, 진행 요청 무효화와 메모리·재시도 상태 정리가 한 원자적 의도로 묶이지 않았다.
- **해결(v0.38.0 태스크 06):** `invalidatePastIndex()` 단일 진입점이 generation을 먼저 올린 뒤
  cached·fallback·inflight·로그인 refresh 참조와 재시도 타이머/예산을 정리하고 IDB를 삭제한다.
  `clearSheets`는 이를 `await`해, 모달 직후 재연결로 만든 새 스냅샷과 늦은 delete의 경쟁도 닫는다.
- **회귀:** 진행 조회를 인위적으로 보류한 채 clearSheets를 완료하고 응답을 해제한 뒤 IDB put 0회와
  레코드 부재를 확인하는 `tests/v038-past-index-invalidate.spec.ts`.
- **출처:** `survey-011 v0.38.0` 리뷰#3 태스크 06(2026-07-23, 당시 미배포 브랜치).
- **당시 상태(2026-07-23):** ✅코드 수정·회귀 작성. ⚠️제한 샌드박스의 Chromium Mach rendezvous
  EPERM으로 브라우저 회귀·수정 제거 반증은 실행 미확인([TEST-SANDBOX-1]).
- **현재 상태:** **v0.38.0에 포함되어 배포됨**(현재 앱 v0.39.0). 2026-07-26 전체 스위트 858 passed.

### [PAST-5] 키 컬럼이 **하나라도 빈** 시트 행은 과거값 인덱스에서 통째로 탈락한다 — 부분 키 조회가 그 행을 영영 못 본다

- **무엇(2026-08-13 v0.49 r2 리뷰 합집합 C8 — 등재만, 수정은 v0.50):** `buildSampleKey`는 키
  컬럼 값이 하나라도 비어 있으면 `null`을 돌려주고(`pastValues.ts`, 오라클
  `tests/pastValues.spec.ts:76-78`), `buildPastIndex`는 그 행을 인덱스에 **넣지 않는다.**
  키 조합이 `농가명+라벨+조사나무`인데 과거 시트의 어떤 행에 라벨만 비어 있으면, 그 행은
  이상치 비교선에도·「이전 조사」 조회에도 존재하지 않는다.
- **왜 지금 문제가 됐나:** v0.49 W3의 「이전 조사일」은 **세션 고정 키만으로**(예: 농가명+라벨)
  대조하는 **부분 키 조회**다. 인덱스가 「전체 키가 온전한 행」만 담고 있으므로, 부분 키로는
  일치할 수 있었을 행이 애초에 후보 집합에 없다. 사용자에게는 「기록 없음」으로 보이고
  (v0.49 r2 A5 이후에도 이건 정직한 「기록 없음」이 아니라 **누락**이다), 시트를 열어 보면
  그 회차 기록이 멀쩡히 있다.
- **왜 이번에 안 고쳤나:** 고치려면 인덱스의 저장 단위를 「완전 키 → 행」에서 「컬럼 단위 레코드
  집합」으로 바꿔야 한다(부분 키 매칭을 인덱스가 지원해야 한다). 스키마 변경 + 마이그레이션 +
  IDB 백업 직렬화(`serializePastIndexEntry`) 호환이 딸려 오는 선행 구조 작업이라, r2의 수정
  레인 범위 밖으로 명시 제외됐다(브리핑 A16 = 「이번엔 등재만」).
- **지금 할 수 있는 회피:** 키 컬럼에 빈 칸이 생기지 않게 시트를 채운다(샘플키 토글을 줄이면
  탈락 확률도 준다 — 키가 적을수록 「하나라도 빈」 조건에 걸리기 어렵다).
- **다음 회차가 확인할 것:** ① 실기기 시트에서 실제 탈락 행 수(인덱스 `rowCount` vs 시트 행 수
  대조 — 이미 로그에 `past_index_ready` 계측이 있다) ② 부분 키 인덱스로 바꿀 때의 마이그레이션
  경로 ③ 이상치 비교선(`previousRound`)에도 같은 누락이 있는지(같은 인덱스를 공유한다).
- 🔴 **확장(2026-08-13 v0.49 r4 · claude r3 #7 — R 등재, 수정 없음): 같은 인덱스의 두 번째 구멍
  = 공백 포함 키의 join 버킷 충돌.** `KEY_SEP`이 **공백**이고(`pastValuesIndex.ts` —
  2026-08-15 [ENV-12] 분리 전 `pastValues.ts`)
  `buildSampleKey`가 값들을 그 구분자로 join한다(`:48-60`). 그래서 값 자체에 공백이 있으면
  **다른 샘플이 같은 버킷 문자열**을 만든다: 예를 들어 키가 `농가명+라벨`일 때
  `('강 남호','A')`와 `('강','남호 A')`는 둘 다 `"강 남호 A"`다.
  `buildPastIndex`는 `(키,회차)` 충돌을 **last-row-wins**로 덮으므로(`:172` 부근,
  `duplicateCount`만 올린다) 앞 행의 `rec`가 통째로 사라진다.
  - **왜 지금 아프냐:** r3 #4·r4 M9가 대조를 **`rec`의 colId 단위**로 정교화했는데
    (`fixedKeyCellMatches` — 서식·수치 표기까지 넘어선다), 그 정교함이 **버킷 단계에서 이미
    잘못 합쳐진 레코드** 위에서 돌면 무력하다. 정확한 대조가 틀린 행에 적용된다.
  - **왜 이번에 안 고쳤나:** 처방이 위 본문과 **같은 축**이다 — 저장 단위를 join 문자열에서
    「컬럼 단위 레코드 집합/선행 인덱스」로 바꿔야 한다(구분자를 바꾸는 것은 회피일 뿐이고,
    영속 백업 `serializePastIndexEntry`의 키 문자열 호환까지 딸려 온다). 같은 선행 구조 작업이라
    이 항목에 합류시킨다.
  - **회피:** 샘플키 컬럼 값에 공백을 쓰지 않는다(현 스키마의 `농가명`은 실제로 공백이 흔하다 —
    회피가 약하다는 점을 기록해 둔다).
- **현재 상태:** ⚠️등재만(코드 변경 없음). v0.50 후보. r4에서 join 충돌 축이 합류했다.

### [ALARM-REJECT-1] 알람 팝업 국면의 값 거절은 표면이 없고, 거절 비프가 알람 트릴과 같은 소리다
- **무엇(2026-08-13 v0.49 r4 · claude r3 #5 — R 등재, 수정 없음):** 이상치 알람 팝업이 서 있는
  동안(`CenterStage.tsx:139` 분기 — 6분기 상호배타의 alert 분기) 값 발화가 거절되면 사용자에게
  가는 신호가 **둘 다 무력하다**:
  ① **화면 큐가 없다.** r3 #5가 `ReaskCue`를 hero와 `ModifyIndicatorPill` 두 표면에 배선했지만,
     alert 분기는 알람 카드가 중앙을 통째로 차지해 어느 쪽도 렌더되지 않는다.
  ② **소리가 겹친다.** 거절 비프(`playBeep('reject')`, r2 B2 신설)와 알람 트릴
     (`playBeep('alert')`)이 같은 국면에서 연달아 나면, 폰을 2~3m 떨어뜨려 둔 사용자는 둘을
     구분하지 못한다(PRINCIPLES §2 — 이 앱에서 소리는 유일한 조작 설명서다).
- **왜 이번에 안 고쳤나:** 처방이 **UI 설계**다 — 알람 카드 안에 거절 큐 자리를 만들 것인지,
  카드를 밀고 큐를 띄울 것인지, 아니면 알람 국면에서는 거절음 자체를 다르게 할 것인지가
  민구 결정 사항이다(§2 소리 체계는 민구가 지정해 온 축이다). r4는 수렴 회차라 범위 밖.
- **다음 회차가 확인할 것:** ① 알람 국면에서 실제로 값 거절이 얼마나 나는지(로그
  `beep_play:kind=reject` × `anomalyAlert` 동시 구간) ② 알람 카드의 세로 예산에 큐 한 줄이
  들어가는지(`v0440-alarm-fit`가 그 예산의 오라클이다).
- **현재 상태:** ⚠️등재만(코드 변경 없음). v0.50 후보 — UI 설계 선행.

### [SETTINGS-1] 재로그인 자동 재연결이 사용자 컬럼 설정을 덮어써 과거값 인덱스까지 무효화

- **무엇:** 재로그인은 이전 시트를 자동 재연결(v0.13.0 R1 `onGoogleClick` → `onUrlConfirmWithUrl`)하는데, `loadHeaders`가 `inferColumns`로 컬럼을 **처음부터 다시 유추해 통째로 교체**했다. `preserveInferredColumnIds`는 **`id`만** 보존한다(`sheetsInfer.ts` — 2026-08-15 [ENV-12] 분리 전 `sheets.ts`).
- **왜 위험한가:** `inferColumns`는 숫자 컬럼의 **고유값이 1개뿐이면 `input='auto'`**(고정값 컬럼)로 본다(`sheetsInfer.ts`의 `inferColumns`). 따라서 **데이터 행이 1~4개뿐인 시즌 첫 회차 시트**에서는 사용자가 '음성'으로 둔 측정 컬럼(횡경·종경)이 **매 로그인마다 '자동'으로 되돌아갔다**. 회차가 쌓여 값이 다양해지면 재유추가 같은 값을 내므로 증상이 사라진다 — **그래서 오래 안 잡혔다.**
- **파생 피해(v0.38.0 #1이 안 되던 근인):** `input`이 바뀌면 `effectiveSampleKey`가 뒤집히고, 그게 과거값 인덱스의 **설정 지문(fp)** 에 들어간다(`pastValues.loadContext`). 로그인 직후 강제 갱신(#1)이 만든 인덱스가 **캐시·폴백 동시에 fp 검사 탈락** → 화면은 "과거값 준비: 미준비" 고착. **데이터 계층은 정상 동작(GET·IDB 갱신됨)인데 화면만 안 바뀌는** 형태라 오진하기 쉽다.
- **진단법:** `getPastIndexStatus()`가 `none`인데 `cached`가 방금 만들어졌으면(fp 불일치) 지문 두 개를 덤프해 **어느 필드가 다른지** 본다. 이번 건은 `["c3","횡경","float",false→true]` 단 한 칸 차이였다.
- **해결(v0.38.0, `001327e`·`cf8c9d0`):** ①`columnFlags.preserveUserColumnSettings` — **시트가 정하는 값은 `name`·`type`뿐**, 나머지(입력방식·샘플키·자동값·추세)는 보존. `type`이 바뀌면 컬럼 의미가 달라진 것이라 재유추값 사용(structural-change 규칙과 동일). ②컬럼을 교체하는 `loadHeaders`에서 `resetPastIndexRetries()`+`prefetchPastIndex()`로 **정착 설정 기준 재생성**(`ensurePastIndex`가 유효 캐시면 no-op이라 추가 조회 없음).
- **함정(회귀 테스트):** 이 회귀는 **수정 없이도 통과하는 레이스**가 있다 — 재연결이 컬럼을 교체하기 *전에* 배지를 읽으면 옛 지문 기준으로 "준비됨"이 잡힌다. 테스트는 **교체 완료를 명시적으로 대기**한 뒤 판정해야 한다(`input[value="횡경(mm)"]` 노출). 대기 추가 후 **수정 제거 시 2/2 실패 · 적용 시 6/6 통과**로 반증 확인.
- **주의:** 샘플키 유추 규칙(`inferSampleKey` = auto·비date, `src/lib/sheets.ts`) 자체는 **민구 확정이라 변경 금지**. 규칙은 그대로 두고 "재연결이 사용자 선택을 덮지 않게" 보존만 추가한 것이다. (종전 이 자리에 있던 `[PAST-1]` 인용은 **이 레포에 정의가 없는 ID**였다 — 2026-07-26 참조 검사에서 발견해 제거. 과거값 인덱스 관련 실재 항목은 [PAST-2]·[PAST-3]·[PAST-4]다.)
- **출처:** `survey-011 v0.38.0` 2026-07-22 세션(개선요청 #1 회귀 테스트 red 추적) → 근인 확정·수정.
- **당시 상태(2026-07-22):** ✅수정됨 — 브랜치 `survey-011-v038-voice-ui`, 미배포.
- **현재 상태:** **v0.38.0에 포함되어 배포됨**(브랜치는 main에 병합, 현재 앱 v0.39.0). 회귀 6/6 통과.
- **실기기 상태:** ⚠️**미확인** — 확인 항목: **시즌 첫 회차처럼 행이 적은 시트에서 재로그인 후 입력방식이 '음성'으로 유지되는지.**

### [SETTINGS-2] 다른 스프레드시트·탭 전환 시 이전 시트의 fixed 자동값이 새 시트로 오염

- **증상:** 같은 양식의 A농가 시트에서 B농가 시트로 전환하면 `농가명` 자동값이 A의 값으로 남아,
  이후 B 시트 동기화 행에 잘못 기록될 수 있었다. 화면과 API는 성공으로 보여 조용한 데이터 오염이다.
- **원인:** [SETTINGS-1] 수정이 `preserveInferredColumnIds`로 정규화 헤더명이 같은 컬럼의 id를 재사용한
  뒤 `preserveUserColumnSettings`로 `auto`를 포함한 사용자 설정을 항상 복사했다. 현재 columns의 출처를
  저장하지 않아 다른 spreadsheetId 또는 같은 파일의 다른 탭인지 판별할 수 없었다. `sheetUrl`·`sheetTab`은
  `loadHeaders` 전에 새 대상으로 바뀌므로 그 값을 비교하는 방식도 항상 같은 시트처럼 보이는 함정이 있다.
- **해결(v0.38.0):** persist v12에 `columnsSheetId`·`columnsSheetTab`을 추가하고, v11 이하 저장본은 출처를
  추측해 backfill하지 않는다. `loadHeaders`는 두 출처가 정확히 같을 때만 id·사용자 설정을
  보존하며, 다른 파일/탭은 새 유추값을 사용한다. 새 columns와 출처는 한 번의 store set으로 함께 갱신한다.
- **회귀:** `tests/sheets-infer-columns.spec.ts`가 다른 파일·다른 탭·같은 시트 3축을 고정하고,
  `tests/v038-sheet-source-guard.spec.ts`가 저장목록/탭 선택 뒤 store 자동값과 같은 시트 설정 보존을 검증한다.
  가드 제거 시 핵심 테스트 **1/1 실패**(`강남호` 대신 `이원창`), 적용 시 순수 스위트 **9/9 통과**.
- **출처:** `survey-011 v0.38.0` 태스크 01(2026-07-23, 당시 미배포 브랜치).
- **당시 상태(2026-07-23):** ✅코드 수정·반증 확인. ⚠️샌드박스 포트 bind `listen EPERM`으로
  브라우저 e2e 13건은 수집만 확인.
- **현재 상태:** **v0.38.0에 포함되어 배포됨**(현재 앱 v0.39.0). 테스트 서버는 이후 [ORCH-27]로
  Playwright `webServer`(5177)가 직접 소유하므로 당시의 포트 문제는 재현되지 않는다 —
  2026-07-26 전체 스위트 858 passed.

### [SETTINGS-3] 시트 전환 실패·늦은 응답 뒤 이전 columns로 입력을 시작할 수 있음

- **증상:** A농가 테이블이 생성된 상태에서 B농가 연결을 시작해 메타/헤더 조회가 실패하면,
  `tableGenerated=true`와 A columns가 남아 입력을 시작할 수 있었다. 늦은 이전 메타 응답은 최신
  `sheetTab`까지 덮을 수 있어 화면 대상·컬럼 출처가 다시 갈라졌다.
- **근인:** URL·탭을 조회 성공 전에 전역 설정에 게시했고, `tableGenerated` 폐기는 전환 시작과 묶이지
  않았다. 헤더 요청에만 세대 가드가 있어 메타→헤더 전체 파이프라인은 원자적이지 않았다.
- **v0.37.0에도 있던 기존 결함:** v0.38.0의 컬럼 출처 기능이 만든 회귀가 아니라, 배포본 v0.37.0부터
  입력 시작 게이트가 `tableGenerated`만 본 구조적 공백이었다.
- **해결(v0.38.0 태스크 07):** URL draft와 활성 연결을 분리하고 대상 전환 즉시
  `tableGenerated=false`로 폐기한다. 메타→헤더에 단일 요청 세대를 적용해 최신 성공만 URL·탭·컬럼·
  출처를 한 번에 게시한다. Ready/start/테이블 생성은 URL id·탭과 컬럼 출처의 정확 일치를 요구한다.
- **회귀:** `tests/v038-session-sheet-gate.spec.ts`가 기존 `tableGenerated=true`에서 메타 500·헤더 500을
  재현해 시작 버튼 비활성·세션 0건을 확인하고, 이전 메타 응답을 명시 신호로 늦춰 최신 원자 게시를
  검증한다. 순수 술어 경계는 `tests/sheetConnection.spec.ts`가 고정한다.
- **당시 상태(2026-07-23):** ✅순수 경계 수정 제거 시 2/2 실패·적용 시 2/2 통과. ⚠️브라우저 3건은
  제한 샌드박스의 Chromium Mach rendezvous EPERM으로 실행 미확인([TEST-SANDBOX-1]). 브랜치 미배포.
- **현재 상태:** **v0.38.0에 포함되어 배포됨**(현재 앱 v0.39.0). 2026-07-26 전체 스위트 858 passed.

### [SETTINGS-4] URL만 있고 탭이 빈 반연결 상태를 로컬 기록 모드로 오인

- **증상:** A columns가 남은 상태에서 토큰 만료 중 저장 목록의 B 시트를 고르면
  `sheetUrl=B, sheetTab=''`가 저장된다. 기존 입력 게이트는 URL id와 탭이 모두 있어야 “연결됨”으로
  보고, 탭이 비면 로컬 모드로 허용해 A columns로 targetless 세션을 만들 수 있었다. 재로그인 뒤 B에
  결합하면 이름이 같은 헤더를 통해 A 값이 B의 정상 행처럼 append될 수 있다.
- **근인:** [SETTINGS-3]의 fail-closed 게이트를 로컬 기록 복구([PRINCIPLES §5]) 때문에 축소하면서,
  “연결 완료가 아님”을 “완전 미연결”과 동일시했다. `onSelectSavedSheet`는 재로그인 자동 재연결을 위해
  만료 상태에서도 새 URL을 의도적으로 저장하므로 URL-only 상태는 실제 도달 가능하다.
- **해결(v0.38.0 태스크 08):** 로컬 모드는 `sheetUrl`과 `sheetTab`이 모두 빈 경우로만 한정한다.
  어느 한쪽이라도 있으면 URL id·탭·columns 출처가 모두 일치해야 입력·테이블 생성을 허용한다.
  완전 미연결과 출처만 남은 로컬 기록 경로는 계속 허용한다.
- **대안 검토:** 선택 URL을 검증 전 draft/pending으로만 두면 반연결 자체를 없앨 수 있지만, 토큰 만료
  뒤 재로그인 자동 재연결에 쓸 내구 URL이 필요하다. 새 pending persist 필드는 migrate까지 요구하고
  범위를 넓히므로 이번 릴리스 블로커에는 단일 게이트 수정을 택했다.
- **회귀:** `tests/sheetConnection.spec.ts`가 URL-only·탭-only 차단과 완전 미연결 허용을 함께 고정한다.
- **출처:** `survey-011 v0.38.0` 리뷰 후속 태스크 08(2026-07-23, 당시 미배포 브랜치).
- **당시 상태(2026-07-23):** ✅경계 테스트 통과. 브랜치 미배포.
- **현재 상태:** **v0.38.0에 포함되어 배포됨**(현재 앱 v0.39.0).

### [SYNC-5] 세션에 대상 시트가 없어 현재 전역 설정으로 다른 농가를 append/update

- **증상:** A농가에서 만든 미업로드 세션을 남긴 채 B농가로 설정을 전환하고 동기화하면 A 값을 B에
  append했다. 이미 A에서 받은 `sheetRow`가 있으면 B의 같은 행 번호를 update해 더 조용한 오염이 됐다.
- **근인:** `Session`에 목적지가 없고 `syncSelected()`가 호출 순간의 `settings.sheetUrl/sheetTab`을
  사용했다. `persistSession()`도 매번 현재 `settings.columns`를 읽어 활성 세션 중 설정 전환 시 한 세션의
  자동값·컬럼 스키마가 섞일 수 있었다.
- **v0.37.0에도 있던 기존 결함:** v0.38.0이 만든 회귀가 아니라, 배포본 v0.37.0의 Session/IDB 스키마와
  동기화 계층 사이에 대상 결합이 없던 구조적 공백이었다.
- **해결(v0.38.0 태스크 07):** 새 세션은 시작 시 optional additive `target={spreadsheetId,sheetTab}`과
  columns를 스냅샷으로 고정한다. sync는 세션별 target의 헤더·append·update만 사용하므로 `sheetRow`도
  그 target과 결합된다. target 없는 legacy IDB 레코드는 그대로 읽되, 현재 검증된 시트를 사용자에게
  명시 확인받아 target을 먼저 내구 저장한 뒤에만 업로드한다. IDB/settings version은 올리지 않았다.
- **회귀:** `tests/v038-session-target-sync.spec.ts`가 A target 세션+B 전역 설정에서 B POST/PUT 0건,
  legacy 확인 전 Sheets 0건과 확인 target IDB 저장, 활성 A 세션 중 B 전환 뒤 A target·columns 보존을
  검증한다. 기존 sync e2e fixture에도 명시 target을 추가했다.
- **당시 상태(2026-07-23):** ✅실제 sync 코어를 전역 설정 방식으로 되돌리면 2/2 실패·적용 시 2/2 통과.
  ⚠️브라우저 3건은 Chromium Mach rendezvous EPERM으로 실행 미확인([TEST-SANDBOX-1]). 브랜치 미배포.
- **현재 상태:** **v0.38.0에 포함되어 배포됨**(현재 앱 v0.39.0). 2026-07-26 전체 스위트 858 passed.

### [SYNC-6] 업로드 이력이 있는 targetless 세션에 새 target만 붙이면 다른 시트의 같은 절대 행을 덮음

- **증상:** v0.37에서 A 시트 42행에 올라간 세션을 수정한 뒤 v0.38에서 현재 B 시트로 legacy 대상 확인하면,
  기존 `sheetRow:42`가 그대로 남아 B 시트 42행을 sparse batchUpdate했다. 부분 동기화 세션은 이미
  `synced`인 행을 건너뛰고 나머지만 B에 append해 한 세션이 두 시트로 갈라질 수도 있었다.
- **근인:** [SYNC-5] 후속 확인 경로가 `{ ...latest, target }`만 저장했다. `sheetRow`는 Session.target과
  결합된 절대 좌표인데, 대상 확인 UI가 “원래 시트”와 “다른 시트”를 구분하지 않아 좌표의 의미가 바뀐
  뒤에도 update 경로가 그대로 소비했다.
- **해결(v0.38.0 태스크 08):** 업로드 이력이 있는 legacy 세션은 현재 시트가 원래 시트인지 명시 선택한다.
  원래 시트면 좌표를 보존하고, 다른 시트면 행별 `sheetRow`·`syncState`, 세션 `syncedRows`, 보류값의
  `previousSyncState`까지 초기화한 뒤 target을 내구 저장해 모든 행을 append한다. 이력 없는 legacy는
  종전의 단순 확인 경로를 유지한다.
- **회귀:** `tests/sessionSync.spec.ts`가 두 선택의 상태 변환을 고정하고,
  `tests/sessionSyncTarget.spec.ts`가 실제 sync 코어에서 다른 시트 선택 시 append 1건/update 0건 및
  이력 없는 legacy append를 검증한다. UI·IDB e2e는 `tests/v038-session-target-sync.spec.ts`에 추가했다.
- **출처:** `survey-011 v0.38.0` 리뷰 후속 태스크 08(2026-07-23, 당시 미배포 브랜치).
- **당시 상태(2026-07-23):** ✅순수 상태 계약 2/2·sync 코어 2/2 통과. ⚠️브라우저 e2e는 제한
  샌드박스의 Chromium Mach rendezvous EPERM으로 실행 미확인([TEST-SANDBOX-1]).
- **현재 상태:** **v0.38.0에 포함되어 배포됨**(현재 앱 v0.39.0). 2026-07-26 전체 스위트 858 passed.

### [SYNC-7] 활성 세션에 legacy target을 붙이는 저장이 STT 저장과 경합해 최신 측정값을 덮음

- **증상:** 입력 화면이 keep-alive된 채 데이터 탭에서 target 없는 활성 세션을 동기화하면,
  `applyLegacyTarget`이 잡은 옛 세션 스냅샷과 그 사이 들어온 STT final 저장이 서로 다른 `put`으로
  경합했다. target 저장이 나중이면 최신 행이 사라지고, STT 저장이 나중이면 target이 사라졌다.
- **근인:** 모달이 활성 세션을 기본 선택했고, legacy target 저장은 `persistSession`의 세션 내부 순번
  가드 밖에서 독립 실행됐다. 기존 sync의 활성 판정도 헤더 GET 뒤에서 미완 행만 거르는 부분 방어라
  완료행 업로드·Drive 백업·외부 직접 호출을 막지 못했다.
- **해결(v0.38.0 리뷰#9):** 기존 음성 store 신호(`sessionId` + `phase active|paused`)를
  `isSessionSyncBlocked`로 단일화했다. 모달 선택·legacy target 결합·`useDataActions`의 재시도/로그인
  재개·Drive 백업·`syncSelected`의 세션별 Sheets 진입을 모두 같은 신호로 fail-closed한다. 사용자는
  "입력을 끝낸 뒤 업로드"하라는 이유를 화면에서 본다. 종료 세션은 종전 target 저장·동기화를 유지한다.
- **회귀:** `tests/v038-legacy-batch-target.spec.ts`가 직접 `applyLegacyTarget`/`syncSelected` 호출의
  Sheets 요청 0건, 40ms 지연 target 저장이 활성 세션에서 시작되지 않아 최신 행이 store/내구 모사본에
  남는 것, 종료 뒤 35ms 지연 저장으로 최신 행+target이 함께 남고 append가 진행되는 것을 검증한다.
- **당시 상태(2026-07-23):** ✅수정·반증 확인(제품 가드 제거 시 신규 3/3 실패, 적용 시 3/3 통과). 브랜치 미배포.
- **현재 상태:** **v0.38.0에 포함되어 배포됨**(현재 앱 v0.39.0).

### [REGION-2] 조절판(진행 설정 탭) 확장 시 하단 컨트롤바가 겹치고, **겹친 도트 인디케이터가 곧 일시정지 버튼이라 오터치로 진행이 막힌다** 🔴
- **증상(민구 제보 fb-27-5·fb-27-6, 2026-07-27 v0.39.0 실기기):** ① 진행 설정 탭을 펼치면 하단 영역이 겹쳐 보인다. ② 겹친 영역의 도트 아이콘이 눌려 진행에 문제가 생긴다.
- **원인(소스 확정):**
  - **겹침** — `ActiveControlBar.tsx`의 인디케이터 행은 `flex:'1 1 0', minHeight:0`이라 **줄어들 수 있는데**, 그 안의 `StateIndicator`는 `useBandHeight()`가 준 **뷰포트 파생 고정값**(402×874에서 `min(100, max(60, 874×0.105))` = **92px**)을 쓴다. 패널을 펼치면 스테퍼(≈114px)가 자리를 가져가 인디케이터 행에 **약 59px**만 남는다. 밴드 박스는 `maxHeight:'100%'`로 잘리지만 **`StateDots`에는 클램프 전 값 92가 그대로 전달**되고(`size={height}`) 그리드에 `overflow:hidden`이 없어, **91px 도트가 59px 박스를 넘쳐 토글 버튼 위에 그려진다.**
    ⚠️ **px 수치(177/114/59/92/91)는 소스 상수 계산이지 실측이 아니다.** 넘침 발생 자체는 스크린샷으로 독립 확인됐으나 정확한 픽셀은 실측으로 다시 잡을 것.
    🔴 **`maxHeight`는 자식 overflow를 막지 못한다** — 부모를 자르는 것과 자식을 자르는 것은 다른 일이다.
  - **오터치(고리 확정)** — 그 도트 인디케이터는 표시물이 아니라 **일시정지 버튼**이다(`ActiveControlBar.tsx`가 `control={{title:'일시정지', onClick:onTogglePause}}`를 넘기고 `StateIndicator`가 밴드 전체를 `<button data-testid="voice-status-control">`로 감싼다). 와이어프레임 §공통규칙5에 "active에는 일시정지 터치 버튼이 없다 → 인디케이터 자체를 겸용"이라 적혀 있는 그 설계다.
    **넘친 도트는 그림자가 아니라 박스다.** `StateDots`의 그리드 `<div>`와 각 `<span>`은 그 `<button>`의 **자손**이고, 조상이 `overflow:visible`이면 자식 박스는 부모 박스 **밖에서도 그려지고 히트테스트 대상으로 남는다**(hit test는 박스 단위이며 `overflow:visible` 조상이 자르지 않는다). 그 지점을 탭하면 span → 그리드 → button으로 **버블링해 `onTogglePause`가 발화**한다. 즉 **사용자가 토글이나 패널 상단을 겨냥해 탭하면 일시정지가 눌린다.**
- **🔴 시각 증거 — 오터치 직전 프레임을 자동캡처가 잡았다:** `screens/sess_1785112420945:1785113514359:resume.jpg`는 `09:51:53 phase:touch resume` **직후**·`09:51:54 phase:touch pause` **직전**에 찍혔다. 초록 마이크 글리프 도트가 "허용 인식률 40% · 안내속도 1.15x" 토글 스트립을 **위아래로 가로질러** 그려져 있고 아래로는 스테퍼 패널 상단까지 침범한다. `<` `>` 버튼도 토글 스트립 좌우 끝과 겹친다. (`…:1785113499894:pause.jpg`(09:51:39 오터치 직후)도 앰버 `||` 글리프로 같은 겹침을 보여준다. 반면 패널 **접힘** 상태 프레임에는 겹침이 전혀 없다.) 도트가 토글 **위에** 그려지므로 페인트 순서상으로도 도트가 위다(`StateDots`의 `willChange:'transform, opacity'`가 합성 레이어를 만드는 것이 유력한 설명).
- **로그 증거(두 축으로 봉쇄):**
  - **구간 봉쇄** — 조절판이 열려 있던 구간은 `09:49:25→09:51:45`, `09:51:50→09:52:09`, `09:52:24→09:53:41` 셋이고, 네 번의 `phase:touch parsed=pause`(09:51:39·09:51:54·09:52:07·09:53:39)는 **4/4 전부 그 안에** 있다. 세션 A의 **다섯 번째** 일시정지(09:46:23)는 **음성 명령**("일시 정지")이었고 그때는 조절판이 한 번도 열린 적 없다. → **터치 일시정지는 전부 패널 열림 중, 패널이 닫혀 있을 때의 유일한 일시정지는 터치가 아니었다.** 특히 `09:51:53 resume → 09:51:54 pause`는 **1초 만의 반전**이라 의도 조작으로 설명되지 않는다.
  - **세션 간 대조** — 조절판을 한 번도 안 연 세션 B는 `input_control_panel` **0** · `phase:touch` **0**.
  - **비용(실측):** row17 횡경이 09:49:26 첫 안내 → 09:54:29 커밋으로 **5분 3초** 걸렸고 "횡경." 안내가 **6회** 반복됐다. 개선요청 작성 182초를 빼도 **약 2분**이 오터치 씨름에 소모.
- **🟢 데이터 영향 없음:** 일시정지 토글은 커밋 경로가 아니다. 같은 회차 36/36행이 시트와 완전 일치(불일치 0).
- **[REGION-1]과 별건이다.** 그쪽은 *수동입력 시트 ↔ 하단 나비* 및 *알람 카드 침범*(후자는 in-flow 카드라 resolved-by-construction). 이건 **하단 컨트롤바 내부**의 겹침이다. [MIC-BANNER-POPUP-OVERLAP-1](배너 z-index)과도 다르다.
- **권장 수정 방향(민구 요청 포함):** 패널 `open` 동안 `indicatorInteractive=false`로 내려 버튼 자체를 없앤다(접히면 자동 복귀). ~~`open`이 현재 `ActiveControlSteppers` 내부 `useState`라 **부모 승격 배선이 필요**하다.~~ → ✅ **선행분 이행됨(R1 08-14 실측):** `open`은 이미 부모 소유 prop(`ActiveControlSteppers.tsx:60` `open`+`onOpenChange` 계약). 잔여는 `ActiveState.tsx:389`의 `indicatorInteractive` 조건에 패널 open 축이 실제로 걸렸는지 재감사 — 이슈 본체 해소 여부는 별도 판정 몫. ⚠️ **`pointer-events:none`으로 때우지 말 것** — 레이아웃 겹침이 남으면 `<` `>`도 같은 위험에 노출된다. **겹침과 히트테스트를 함께 고친다.**
- **출처:** `2026-07-27 실기기 로그`(`sess_1785112420945`) + 개선요청 fb-27-5/fb-27-6 스크린샷 2장(펼침=겹침 / 접힘=겹침 없음으로 원인 분리). 분석: `Deliverables/2026-07-27-survey-011-log-analysis.md` §3.5~3.6.
- **현재 상태:** 🔴**미수정**(v0.39.0). Vance 배정.

### [VIS-AUDIO-MANUAL-1] 수동 커밋이 유발한 이상치 알람이 **무음**이다 — 진행을 막으면서 소리로는 알려주지 않는다
- **증상(민구 제보 fb-27-9, 2026-07-27):** "사람이 수동 입력시에도 안내 tts 작동 하도록 변경."
- **로그가 요청보다 좁게 특정한다.** 수동 입력의 **에코·다음 프롬프트 TTS는 정상**이다(`10:06:35 manual_commit "299.9"` → `10:06:36 tts "299.9"` → `10:06:37 tts "종경."`). 말이 안 나오는 것은 **수동 커밋이 이상치를 유발했을 때뿐**이다:
  ```
  10:06:42  command touch parsed=manual_commit text="299"
  10:06:42  trend   trend_alert_fired:...,text=추세 알람 감소 : 1.00,src=manual,hold=1
            ← 이 알람에 대한 TTS 0건 (12초 창)
  10:06:52  app     feedback_open  → 10:07:16 제출
  ```
  같은 회차 `trend_alert_fired` **20건 중 19건**은 로그 `text=`와 **바이트 동일한** `ttsText`로 발화됐다. **유일한 미발화가 이 `src=manual,hold=1` 1건.**
- **원인(소스 확정):** `src/lib/useVoiceSession.ts` — 음성 경로는 `const { alertText, logExtra, alert } = buildAnomalyAlert(...)` 뒤 `await say(alertText)`를 호출하는데, **수동 경로는 `const { logExtra, alert } = ...`로 `alertText`를 구조분해에서 뺀다.** 그래서 렌더·로깅만 하고 발화가 없다.
- **왜 심각한가:** 그 알람은 `hold=1`(`awaitingResponse:true, manualHold:true`)이라 **사용자 응답 전까지 진행을 막는다.** 즉 "멈춰 있는데 왜 멈췄는지 소리로는 알 수 없는" 상태다. 현장에서는 폰을 2~3m 떨어뜨려 두므로 화면을 못 본다 — PRINCIPLES §2 시각·청각 일치 계약 위반.
- **[VIS-AUDIO-REVIEW-1]과 별건:** 그쪽은 *검토(complete) 화면*의 발화 **편차**이고, 이건 *수동 커밋 이상치*의 **완전 무음**이다.
- **권장 수정 방향:** 수동 경로도 `alertText`를 받아 음성 경로와 동일하게 `setLastTts` + `say()`. **최소 `hold===true`는 필수**(응답 요구 알람). **비-hold 정보성 알람까지 말할지는 UX 결정 → 민구.**
- **출처:** `2026-07-27 실기기 로그`(`sess_1785113726954`) + fb-27-9. **현재 상태:** 🔴미수정(v0.39.0).

### [UI-WAVE-1] 도트↔파형 전환이 **STT 상태가 아니라 오디오 레벨의 연속함수**라, 조용한 환경에서 둘이 동시에 보인다
- **증상(민구 제보 fb-27-1, 2026-07-27):** "음성 입력전에 이미 두 애니메이션이 동시 출력중. 기본 도트 마이크 상태에서 음성 인식시만 파형 애니메이션이 나와야 함."
- **원인(소스 확정):** `StateIndicator.tsx`의 크로스페이드가 이진 전환이 아니다.
  ```
  도트  opacity: max(0, calc(1 - var(--voice-level, 0) * 8))
  파형  opacity: min(1, calc(var(--voice-level, 0) * 8))
  ```
  `--voice-level ∈ (0, 0.125)`에서 **둘 다 부분 가시**다(L=0.0625면 50%/50%). 게다가 `VoiceWaveform`의 `BASE_LEVEL = 0.35`라 듣는 중이면 무입력이어도 막대가 서 있다. **게이트가 "인식 중"이 아니라 "주변 소음"이고, 현장 소음은 0이 아니다.**
- **로그가 그 게이트의 입력값을 그대로 준다:** 세션 A(BT) `wave_stats:peak=0.99,avg=0.20` → `0.20×8=1.6` → 파형 100%(도트 0%). 세션 B(내장) `avg=0.06` → `0.48` → **도트 52% + 파형 48% 동시**. fb-27-1 제출 스크린샷에 도트 글리프와 13개 막대가 겹쳐 그려진 것이 육안 확인된다.
- **[UI-GLOW-1]과 무관:** 그쪽은 `offsetParent` 가시성 오탐(v0.38.1 `getClientRects()`로 해소). 이건 **레벨→opacity 매핑**이다.
- **권장 수정 방향:** 게이트를 **인식 상태**(interim 존재 등)로 교체하거나 최소한 **히스테리시스 임계**로 중간 구간을 없앤다. 🔴 **조건부 렌더로 바꾸지 말 것** — `VoiceWaveform`의 rAF·IntersectionObserver가 발화마다 teardown되면 [STT-16] 계열 사고가 된다(`StateIndicator` 헤더 주석이 같은 경고를 한다). fb-27-3(파형을 도트 집합으로)과 함께 설계하면 교차 자체가 불필요해질 수 있다.
- **출처:** `2026-07-27 실기기 로그` + fb-27-1. **현재 상태:** 🔴미수정(v0.39.0).

### [UI-DOT-GHOST-1] 꺼진 셀에도 `dot-breathe`가 붙어 유령 도트가 켜진다
- **증상(2026-07-28 R2 재실측):** 공용 테스트 하네스의 전역 `animation-duration:0ms!important`만 끄고 실제 duration으로 실행하자, 대기 mic 글리프 진입 약 1.5초 뒤 꺼진 셀 index 45의 computed opacity가 인라인 `0`이 아니라 키프레임 시작값 **`0.62`**였다. 글리프 전이 때는 켜짐→꺼짐으로 바뀐 셀이 이미 active 구간에 있어 더 넓게 재현될 수 있다.
- **유입 시점:** `f9dd114`(파형을 도트로 통합)가 13×7 **91셀을 항상 DOM에 렌더**하고 opacity 0/1로 전환하는 구조를 도입했다. v0.39.0(`ff75c46`)은 `if (ch !== '#') return null`로 꺼진 셀을 아예 렌더하지 않아 이 결함이 존재할 수 없었다. 즉 오래된 취약 전제가 아니라 어젯밤 새로 들어온 회귀이며, 아직 실기기 배포본에는 노출되지 않았다.
- **원인:** `@keyframes dot-breathe`가 `opacity:0.62~1`을 소유해 인라인 `opacity:0`보다 우선한다. 모든 셀에 animation을 붙이고 꺼진 셀을 `paused`만 해도, delay가 0인 셀이나 이미 active 구간에 진입한 셀은 키프레임 opacity에서 멈춘다.
- **수정(v0.40.0 R2 C1):** 꺼진 셀은 `animation:'none'`, 켜진 셀만 상태별 `dot-breathe`를 받는다. 글리프·파형 paint가 켜짐 집합을 바꿀 때 animation도 함께 on/off한다. 인라인 `!important`나 키프레임 opacity 삭제는 사용하지 않아 특이성 싸움을 남기거나 켜진 셀 호흡을 죽이지 않는다.
- **검증:** `tests/v039-active-zones.spec.ts`가 실제 duration에서 전이 전/직후 150ms/안정 후를 측정해 ①꺼진 셀 computed opacity 정확히 `0` ②animation 대상 인덱스 = 켜진 셀 인덱스 ③전후 켜진 집합 변화까지 단언한다. 수정 전 증거는 `Deliverables/evidence/2026-07-28-r2-c1-before-t1.5s.png`와 `…-opacity.json`.
- **C5와의 관계:** animation 대상이 대기 mic 기준 91→18셀로 줄었지만 당시 무음 시 opacity 재기록 비용은 측정하지 않았다. 후속 실측·수정은 `[UI-DOT-WRITE-1]`에 분리한다.
- **출처:** `f9dd114` 도입 → 2026-07-28 R2 실-duration 재현(Codex), Larry R1 기각 폐기·수정안 (A) 확정. **현재 상태:** 🟡MONITORING — 수정·데스크톱 반증 완료, 미배포.

### [UI-DOT-WRITE-1] 무음 대기에서도 91셀의 같은 opacity를 매 프레임 DOM에 재기록한다
- **증상(2026-07-28 R2 C5 실측):** C1 수정 뒤 실제 duration·무음 2초 동안 `state-dots` 셀의 opacity setter가 402×874에서 **4,641회(91×51프레임, 약 2,316회/초)**, 375×667에서 **4,732회(91×52프레임, 약 2,360회/초)** 호출됐다. C1 전 추정치 약 5,460회/초에는 animation 쓰기도 포함됐으므로 현재 opacity 기준선과 섞지 않는다.
- **원인:** `paint()`가 직전 켜짐 집합과 새 집합이 같은지 보지 않고, rAF 프레임마다 91셀 전부에 `style.opacity`를 다시 썼다. 무음 글리프는 셀 집합이 고정인데도 전량 쓰기가 계속됐다.
- **수정(v0.40.0 R2 C5):** `StateDots` effect 안에 직전 boolean 셀 집합을 보관하고 달라진 셀만 opacity를 쓴다. 전역 스토어에는 올리지 않는다. 마운트·effect 재생성(glyph/active 변경)·글리프↔파형 진입은 cache를 신뢰하지 않고 91셀 전량 쓰기로 DOM을 재동기화한다.
- **검증:** 실제 duration에서 무음 2초 쓰기가 두 폭 모두 **0회**다. 파형 진입은 91셀 이상 전량 쓰기를 확인했고, 이후 약 1.05초에 62회 실제 셀 변경과 7~8개 서로 다른 표본 프레임을 관측했다. opacity 가드를 제거하면 무음 수치가 정확히 4,641/4,732회로 복귀해 두 테스트가 red다.
- **정직한 범위:** 줄인 것은 **동일 opacity DOM 쓰기 횟수**뿐이다. 배터리·전력·발열은 측정 도구로 재지 않았으므로 개선을 주장하지 않는다. 파형 모드의 실제 셀 변화는 계속 DOM에 쓴다.
- **현재 상태:** 🟡MONITORING — DOM 쓰기 수정·데스크톱 계측·반증 완료, 전력 미측정·미배포.

### [TYPO-CONTRACT-1] "상태별 인라인 폰트 정의 금지" 계약을 우회한 컴포넌트에서 **계약이 막으려던 증상이 그대로 재현됐다**
- **증상(민구 제보 fb-27-7, 2026-07-27):** "인식된 음성인식 실시간 표현되는 문자도 너무 작음. 정상 진행될때의 수준만큼 커야 함."
- **원인(소스 확정):** interim 렌더러가 **둘**이고 크기가 다르다.
  | 상태 | 컴포넌트 | fontSize | 402×874 실효 |
  |---|---|---|---|
  | 정상 진행 | `VoiceHero.tsx` `InterimLine` → `heroLayout.ts` `HERO_TYPE.interim` | `max(24px, clamp(44px, min(19vw,11vh), 96px) × --fit-hi)` | **≈76px** |
  | 알람 중 | `VoiceHero.tsx` `AlarmInterimStrip` | `clamp(24px, min(8vw, 4.8vh), 42px)` **인라인 하드코딩** | **≈32px** |
  `heroLayout.ts`의 `STATE_TYPE`/`HERO_TYPE` 헤더 주석이 *"**상태별 인라인 정의 금지**, 여기 상수만 소비"* 라고 못박고, 그 근거로 민구 지적 *"상태에 따라 식별이 불가할 만큼 작아지는 경우가 존재"* 를 인용해 두었다. **`AlarmInterimStrip`이 그 계약을 우회했고, 정확히 그 증상이 다시 나왔다.**
- **연쇄 효과("알람값도 작다"의 근인):** `AlarmInterimStrip`이 `height:'clamp(46px,6.5vh,68px)'`를 `flexShrink:0`으로 고정 점유하므로 `AnomalyAlertPopup`에 남는 높이가 줄고, `useFitScale`이 `ANOMALY_FIT_STEPS`(**최저 0.13 = 13%**)에서 더 낮은 단계를 고른다.
- **일반 교훈([UI-ALERT-1]과 같은 계열):** 주석으로 "여기 상수만 써라"라고 선언해도 **인라인 정의를 물리적으로 막지 못하면** 언젠가 우회된다. 문구든 타이포든 **SSOT를 소비하지 않으면 컴파일/테스트가 실패하도록** 만드는 쪽이 낫다. 계약이 지켜지는지 확인하는 테스트가 없다면 그 계약은 주석일 뿐이다.
- **빈도:** 같은 회차에 알람 카드가 **20회** 표시됐다(값 입력 89건 대비 22%).
- **권장 수정 방향:** 인라인 폰트를 `STATE_TYPE`의 신규 상수로 승격(+`--fit-hi` 연결). 고정 높이 점유가 알람 fit 단계를 낮추는 연쇄도 함께 본다.
- **출처:** `2026-07-27 실기기 로그` + fb-27-7. **현재 상태:** 🔴미수정(v0.39.0).
- **⚠️ 2차 위반(별건·C6 범위 밖):** `ModifyIndicatorPill.tsx:61`의 인라인 **36.2px**가 계약값 **52.3px의 69%**로 남아 있다. 이번 칩/알람 여백 수정에 섞지 않고 후속 과제로 유지한다.

### [CHIP-TYPO-1] [ALERT-COMPARE-1] 칩·알람 비교값이 자기 영역의 여백을 글자 크기와 중앙정렬로 쓰지 못했다
- **aliases:** `ALERT-COMPARE-1`
- **민구 원문(2026-07-28):** 칩은 “항목명이 너무 작음”, “상/하로 버려지는 공간이 너무 많음”, “부드러운 사각형”; 알람은 “직전/현재 값이 화면 좌우 끝으로 벌어지고 글자가 작다”, “보이지 않는 영역 분할 후 각 영역 안에서 최대 크기 + 가로/세로 중앙정렬”.
- **근인:** 칩 타이포 3곳이 `ColumnChip` 인라인에 흩어지고 `heroLayout.ts`에는 `CHIP_TYPE` 계약이 없어서, v0.40.0이 확보한 세로 공간이 항목명 크기로 전환되지 않았다. 알람은 `max-content + 1fr`, 라벨 `left`, 값 `right/end` 고정이라 두 요소를 외곽으로 밀었고, `compareValue`의 `min(11vw,6vh)`는 402×874에서 **44.2px**에 머물러 62px 상한을 쓰지 못했다.
- **수정(2026-07-28):** 칩을 16px rounded rect로 바꾸고 `CHIP_TYPE`(양축 `clamp + min(vw,vh) + --fit`)으로 항목명/입력값/값을 통합했다. 알람 각 행은 동일 폭 2영역으로 나누고 라벨·값을 셀 중앙에 놓았으며 `compareValue`는 `min(16vw,8vh)`로 402×874에서 62px 상한에 닿게 했다.
- **전체 스위트 회귀 수정(2026-07-28):** `CHIP_TYPE.name`의 `min(7vw,3.5vh)`가 375×667/430×667에서 모두 **23.345px**로 고정돼 “일정 비율” 계약을 어겨 `4.6vh`로 높였고, 전체 직렬 906/906 green·원식 복원 시 23.345=23.345 RED로 확인했다.
- **회귀·반증:** 402×874 computed style에서 칩 항목명 `>22px`, 알람 값 `≥61.5px`, 셀 중심 위치를 단언하고 390×568 카드/비교/페이지 넘침 0을 확인한다. 수정 제거 시 칩 항목명 **12.852px**, 알람 라벨 중심은 목표 25%에서 **17.872%p 이탈**해 신규 2건 모두 RED.
- **T3 맥락:** 레이아웃 밀도 제보가 v0.35.3~v0.40.0에 **6회차 연속** 이어졌다. 개별 위치 요구를 따로 패치하지 않고 두 표면에 “자기 영역 안에서 최대 크기 + 중앙정렬” 한 원칙을 적용한 이유다.
- **현재 상태:** 🟡MONITORING — 데스크톱 Playwright 관련 spec 병렬/단일 worker 통과, iPhone 402×874 현장 확인 대기.

### [FG-RETURN-LOG-1] teardown을 **건너뛴** 포그라운드 복귀가 아무 기록도 남기지 않아, "판단해서 건너뜀"과 "훅이 안 돔"을 구별할 수 없다
- **증상(2026-07-27 분석 중 발견, 미제보):** [MIC-B2] 판정 사다리를 돌리려는데 `mic_teardown`이 0건이었다. 그것이 **임계 미달로 건너뛴 것**임을 알아내려면 `lifecycle:vis_hidden`/`vis_visible` 두 이벤트를 **손으로 차감**해야 했다(58,231ms). 계측이 알려준 게 아니다.
- **원인:** `useVoiceSession`의 복귀 훅은 `decision.shouldTeardown`이 참일 때만 `teardownAudioGraph`(→`mic_teardown`)를 부른다. `foregroundReturnPolicy.reduceForegroundReturn`이 계산한 `backgroundMs`와 결정 자체는 **어디에도 방출되지 않는다.** F5 `audio_route_revalidate`도 (경로변경 ∨ 임계초과)에서만 발행한다. 세션 phase가 active/complete/paused가 아니면 `kick_result`조차 없어 **복귀 자체가 무관측**이 된다.
- **왜 중요한가:** [MIC-B2] 항목이 스스로 *"이 바이트 없이는 '고쳐도 안 풀린 것'과 '애초에 아무것도 안 한 것'을 구분할 수 없다"* 고 썼는데, 정작 **"안 찍힌 것"** 축이 비어 있었다. 다음 회차에 또 0건이면 같은 곤란이 반복된다.
- **권장 수정 방향:** 복귀마다 1건 발행 — `foreground_return:bg_s=<초>,teardown=skipped|done,evt=vis|pageshow` (또는 `mic_teardown`의 `found`에 `skipped` 값 추가). **가장 싸고 [MIC-B2] 판정 가능성에 가장 크게 기여하는 계측이다.**
- **일반 교훈:** 🔴 **"조건부로 실행되는 수정"에는 조건이 거짓이었다는 사실도 함께 기록해야 한다.** 안 그러면 미발화가 두 가지(스킵 / 고장)를 뜻하게 되고, 판정 사다리는 그 순간 판정을 못 한다.
- **출처:** `2026-07-27 실기기 로그` Trace 분석. **현재 상태:** 🔴미수정(v0.39.0).

### [ROUTE-CHANGE-LOG-2] **세션 사이**(포그라운드) 입력경로 전환은 v0.38.2 F5도 못 잡는다 — 07-24 계측 공백의 다른 트리거
- **증상(2026-07-27 분석 중 발견, 미제보):** 세션 A는 **블루투스(OpenDots ONE by Shokz)로 종료**했고(`session stop` meta), 28초 뒤 시작된 세션 B는 **내장 마이크**로 시작했다(`session start` 직후 `input_device`). 그 28초는 **포그라운드**였는데 `input_device_changed`가 **0건**이다(세션 사이라 레코더/`devicechange` 구독 부재로 추정). 개선요청 `device` 스냅샷도 이를 뒷받침한다 — fb-27-1~6(09:36~09:53)은 BT+내장 2개를 열거하고 fb-27-7~9(10:02~10:07)는 **내장 단독**이다.
- **왜 F5가 못 잡나:** `audio_route_revalidate`는 **포그라운드 복귀 이벤트에서만** 발행된다. 오늘은 그 창에서 전환이 일어나지 않았다. 07-24 §2.3이 지적한 공백("백그라운드 중 전환이 어떤 이벤트로도 안 남는다")은 F5가 덮었지만, **"세션 사이 포그라운드 전환"** 이라는 다른 창이 그대로 남아 있었다.
- **권장 수정 방향:** 세션 시작 시 경로 CATEGORY를 1회 기록하거나(현재 `input_device`는 raw 라벨만 남긴다), `devicechange` 구독 수명을 세션 밖까지 연장.
- **⚠️ 파생 파서 함정 — `device.json`은 세션의 입력장치를 말해주지 않는다.** 두 zip의 `device.json`은 **`iPhone 마이크` 단독**을 열거하지만 세션 A는 BT로 종료했다. `device.json`은 **export 시점(10:09:4x) 스냅샷**이고 그때는 BT가 이미 빠진 뒤였다. **입력장치의 SSOT는 `session start`/`stop` meta의 `inputDeviceLabel`과 `input_device_changed`다.** `device.json`만 읽으면 "하루 종일 내장 마이크"로 오독한다.
- **출처:** `2026-07-27 실기기 로그` Trace 분석. **현재 상태:** 🔴미수정(v0.39.0). 07-24 F5 계측 공백의 **재발(트리거 상이)**.

### [LOG-PARSE-1] 다중 세션 zip을 합칠 때 `__app__` 스트림이 **이중 계상**된다 — 반드시 `id` union
- **증상(2026-07-27 분석 중 발견):** 한 회차에 growth-log zip이 2개 나오면, **각 zip이 자기 세션 이벤트 + 전체 앱(`__app__`) 스트림을 모두 담는다.** 2026-07-27 두 폴더의 `__app__` 이벤트는 **1,132건으로 개수·`id` 집합·JSON 바이트까지 완전 동일**했다(id 대칭차 0). 두 폴더를 단순 `+`로 이으면 **모든 앱레벨 집계가 정확히 2배**가 된다(오늘치 33 → 66).
- **회피:** 파서는 **`id` 기준 union**으로 중복을 제거한다. 2026-07-27 실측: 865 + 821 = 1,686 → union **1,653**(차 33 = 공유 `__app__`).
- **함께 지킬 것:** `events.json`은 v0.18.0부터 **누적 롤링 스토어**다(오늘 zip도 2026-06-23까지 거슬러 올라간다). **분석 날짜로 ts 필터 필수**이고, 리포트에 **필터 전/후 개수를 함께 적어** 오염 배제를 증명한다.
- **출처:** `2026-07-27 실기기 로그` Trace 분석. **현재 상태:** 파서 규약(제품 코드 수정 대상 아님). **SOP-003 §2 파서 주의에 승격 권고.**

---

## ⑨ 테스트 / 릴리스 회귀 함정

### [TEST-GUM-1] gUM 스텁 없는 음성 spec은 로컬 헤드리스에서 **세션 시작 자체가 막힌다** — 전부 `clickStart`에서 red
- **증상(2026-08-13 v0.49 r2):** `v049-*` 음성 spec **13/13**이 `clickStart`의
  `[data-testid="voice-active-state"]` 대기에서 실패. 화면은 「마이크 권한을 확인하는 중…」에
  멈추고 시작 버튼이 disabled. 코드 변경과 **무관하게** 전멸하므로 회귀로 오독하기 쉽다.
- **원인:** `start()`의 `recorderRef.current.init()`(`useVoiceSession.ts:3576`)이 실기기 gUM을
  그대로 탄다. 로컬 헤드리스에서 그 호출이 **응답하지 않는다**(권한 프롬프트 대기).
  `.catch(() => false)`는 *거부*는 받지만 ***무응답*은 못 받는다** — 그래서 hang이다.
  (`fixtures/gum.ts` 헤더의 「헤드리스는 gUM을 기본 거부한다」는 **거부** 전제라 이 축과 다르다.)
- **판정법(먼저 이걸 해라):** 내가 **손대지 않은** 음성 spec 하나를 같이 돌려라. 같은 줄에서
  같이 red면 코드가 아니라 환경이다(AGENTS.md 30초 체크). 08-13엔 `v049-fix49-cell-guard`가 그
  역할을 했다.
- **회피:** `tests/fixtures/gum.ts`의 `GUM_GRANT_SCRIPT`를 `addInitScript`로 깐다(v0.44.1 공용
  픽스처). 🔴 **단, 마이크 «실패»를 재는 spec은 `GUM_DENY_SCRIPT`다** — grant를 깔면 재연결
  배너가 아예 안 뜬다(`v023-voice` B3가 그 사례). 거부는 즉시 reject라 시작은 그대로 진행된다.
- **범위(🔴 2026-08-13 r2 A15 정정 — 종전 등재문이 양방향으로 틀렸다):**
  - **적용분은 7개다**(종전 "6개"는 수치 오류 — 열거된 이름은 처음부터 7개였다):
    `v049-f1-field-nav`·`fix49-cell-guard`·`fix49-phase-guard`·`fix49b-nav-race`·
    `fix49b-cellwait-surface`·`v023-voice`·`decimal-targeted-reask`. r2에서 신설 스펙
    `v049-r2-a1-atend-row`가 여덟 번째다(`v049-r2-a2-cellwait-resume`은 `fixtures/activeZones`의
    `boot`가 gUM을 담당한다).
  - **배포 게이트 안은 현재 전량 보호된다** — 종전 문장 *"게이트의 나머지 세션 시작 spec은 아직
    무방비다"* 는 **사실이 아니다.** 근거: 게이트의 세션 시작 스펙 33개 전부가 스텁(직접 또는
    `activeZones.boot`)을 깔고 있고, 08-13 게이트 전량 실행이 507/507 green이었다(무방비였다면
    `clickStart`에서 전멸한다).
  - 🔴 **무방비는 게이트 *밖*이다 — 파일 24개**(2026-08-13 실측). 이게 종전 등재문에 통째로
    빠져 있었다. 목록(파일 23 + 부분 1):
    `anomaly-touch-buttons` · `correction-flow` · `diag-chip` · `feature-isolation` ·
    `log-replay` · `manual-input` · `nav-unidirectional` · `past-index-fallback` ·
    `trend-alert` · `v019-active-layout` · `v020-dials-layout` · `v027-voice-cards-fit` ·
    `v033-feedback` · `v037-review-receipt` · `v037-suspend-latch` · `v038-portrait-guard` ·
    `v038-session-sheet-gate` · `v038-session-target-sync` · `v0440-c7-cleanup` · `v5-ui` ·
    `v54-30rows` · `v54-scenarios` · `v54-voice-data`,
    그리고 **`v0440-c8-flow`의 앞 3개 테스트**(같은 파일 `:304`에 `GUM_GRANT_SCRIPT`가 있지만
    **그 아래 테스트들에만** 깔린다 — 판정 단위가 파일이 아니라 **테스트**임을 보여주는 사례).
  - 🔴 **2026-08-13 v0.49 r4 M7 진행분 — 3개가 목록에서 빠진다(24 → 21).** r3가 단언을 고친
    3스펙이 「검증자 없는 수정」이라 최소 스텁을 깔았다:
    `manual-input`(14 red → 14 green) · `past-index-fallback`(3 red → 5 green, 전량) ·
    `v0440-c8-flow`의 앞 3개 테스트(F13, red → green). 앞 둘은 배포 게이트에 편입했다.
    ⚠️ **`v0440-c8-flow`는 게이트 밖에 남는다** — F18 2건(`:364` 승인 후 준비 확인 ·
    `:415` 우회 심)이 스텁을 깔고도 red다. 사유가 gUM 스텁 축이 아니다: 화면 전환 지연이
    20~21초로 측정된다(= 준비 확인이 끝나지 않는다). fake 트랙이 진짜 MediaStream이 아니라
    레코더 준비 판정이 완주하지 못하는 축으로 보이며, 이는 **준비 심(readiness seam)** 문제라
    r4 범위(M7 = "최소 gUM 스텁") 밖이다 → [TEST-GUM-2]로 분리 등재.
  - **실측 red 36건**(2026-08-13, HEAD `5f6d67f` 워크트리에서도 동일 = 코드 회귀 아님):
    `anomaly-touch-buttons` 11 · `correction-flow`+`nav-unidirectional` 17 · `past-index-fallback` 3 ·
    `v0440-c8-flow` 3 · `log-replay` 2. 전부 같은 줄
    (`[data-testid="voice-active-state"]` 대기)에서 실패한다.
    (r4 M7 이후 실측: `manual-input` 0 · `past-index-fallback` 0 · `v0440-c8-flow` 2 —
    남은 2건은 위 [TEST-GUM-2] 축이다.)
- **더 나은 해법(미적용 — r2 A15는 「검토만」이 지시였다):** `playwright.config.ts`의
  `launchOptions.args`에 `--use-fake-device-for-media-stream`을 얹으면 24곳을 개별로 고치지 않고
  구조적으로 닫힌다.
  🔑 **deny 스펙과 충돌하지 않는다(검토 결과):** 마이크 «실패»를 재는 스펙(`v023-voice` B3 등)은
  `GUM_DENY_SCRIPT`가 `navigator.mediaDevices.getUserMedia` **자체를 reject로 덮어쓴다** —
  JS 오버라이드가 브라우저 플래그보다 뒤에 적용되므로 거부 시나리오는 그대로 성립한다.
  ⚠️ 다만 공유 파일(모든 프로젝트 공통)이라 **적용 전에 게이트 전량 1회**가 필요하다 —
  이번 라운드에서는 실행하지 않았다. Larry/민구 판단 대기.
- **현재 상태:** ⚠️함정 등재 + 8 spec 회피 적용(게이트 안은 전량 보호). **게이트 밖 21곳 무방비**
  (r4 M7이 3곳 해소 — `manual-input`·`past-index-fallback`은 게이트 편입, `v0440-c8-flow` F13 3건).
  config 레벨 해결은 제안만.

### [TEST-GUM-2] gUM 스텁을 깔아도 **준비 확인이 완주하지 않는** 스펙이 있다 — `v0440-c8-flow` F18 2건
- **증상(2026-08-13 v0.49 r4 M7):** `GUM_GRANT_SCRIPT`가 이미 깔린 `tests/v0440-c8-flow.spec.ts`
  `:364`(*승인 후 준비 확인이 끝나야 전환된다*)·`:415`(*우회 심 `__micSettleSkipForTest`는 지연만
  생략한다*) 2건이 여전히 red다. 실패 메시지가 축을 그대로 말한다:
  「승인→화면 전환 지연 **21095ms** — 준비 확인이 안 끝난다」·「우회 경로인데 지연 **20080ms** —
  심이 죽었다」. 같은 파일의 F13 3건은 스텁만으로 green이 됐다(= [TEST-GUM-1] 축은 해소됐다).
- **가설(미확정):** `fixtures/gum.ts` 헤더가 명시하듯 fake 트랙은 **진짜 MediaStream이 아니다** —
  `createMediaStreamSource`·`MediaRecorder`가 던지고 제품이 catch한다. 그 폴백 경로에서
  「준비 완료」 판정이 완주하지 못하는 것으로 보인다(F18은 정확히 그 판정의 오라클이다).
  gUM 승인/거부 축이 아니라 **준비 심(readiness seam)** 축이다.
- **범위:** `v0440-c8-flow`의 F18 2건. 이 파일은 그래서 **배포 게이트 밖에 남는다** —
  나머지 F13 3건 + WP-1c 등은 green이다.
- **다음 수순 제안:** [TEST-GUM-1]이 이미 제안한 `--use-fake-device-for-media-stream`
  (config `launchOptions.args`)이 이 축까지 한 번에 닫을 가능성이 높다(진짜 스트림이 서므로
  레코더 준비가 실제로 완주한다). 공유 파일이라 적용 전 게이트 전량 1회가 필요하다.
- **현재 상태:** ⚠️함정 등재(v0.49 r4 M7에서 분리). 미해결 — `v0440-c8-flow` 게이트 밖 유지.

### [TEST-ANIMATION-ZERO-1] 전역 `animation-duration:0ms!important`가 실제 시각 결함을 false-green으로 가린다
- **증상(C1에서 확정):** 기존 `v039-active-zones` 픽스처로는 꺼진 셀 computed opacity 테스트가 green이었고, 셀별 delay를 제거해도 계속 green이라 반증이 불가능했다. 전역 0ms를 끄자 제품 수정 전 코드에서 즉시 `0.62`가 관측돼 `[UI-DOT-GHOST-1]` 실제 결함이 드러났다.
- **범위:** `tests/fixtures/stt.ts`가 `* { animation-duration:0ms!important; transition-duration:0ms!important }`를 주입하고, 같은 문자열 복제까지 합치면 **13개 주입 지점·19개 spec 파일**이 영향을 받는다(2026-07-28 직접 grep). 타이밍 flake를 줄이는 목적은 유효하지만, 이 상태에서 애니메이션 기반 시각 단언을 하면 제품이 아니라 정지된 별도 화면을 측정한다.
- **회피:** 비시각 STT/상태머신 테스트의 기본 0ms는 유지한다. animation 자체가 오라클인 테스트만 `installVoiceMocks(..., { preserveAnimations:true })`로 명시적으로 실제 duration을 켜고, 수정 제거 red까지 확인한다. C1이 첫 적용 사례다.
- **범위 밖 기록:** `[UI-WAVE-1]`의 구조적 소멸은 소스에서 두 opacity 교차 레이어가 없어졌다는 근거가 있어 판정이 유효할 수 있으나, 이를 뒷받침한 시각 테스트는 0ms에서 돌았다. R2에서 재개봉하지 않고 Larry의 릴리스 게이트로 넘긴다.
- **현재 상태:** ⚠️함정 등재 + C1 opt-out 추가. 나머지 영향 spec의 시각 오라클은 미감사.

### [TEST-UI-1] 테스트를 시각 장식(`REC`, `▶`)에 붙이면 UI 정리 때 깨진다 → **가드레일로 이동**
- ✅v0.31.0 해결(+2026-07-20 재발 변형 포함). `data-testid` 계약에 붙이는 규칙이라
  [ENGINEERING-GUARDRAILS.md](./ENGINEERING-GUARDRAILS.md) ⑥으로 옮겼다. **새 입력탭 테스트를
  쓸 때마다 적용된다.**

### [TEST-UI-2] 활성 상태 하단에는 `입력 종료` 버튼이 없다 — 종료 버튼 테스트는 일시정지 패널 경로로
- **증상:** `v023-voice.spec.ts`, `correction-flow.spec.ts`가 활성 상태에서 `button[title="입력 종료"]`를 기다리다 실패했다.
- **원인:** v0.31.0 입력탭 하단은 기본 상태에서 `이전` / `일시정지` / `다음`만 보인다. 종료는 실수 방지를 위해 일시정지 패널에서 `종료` 버튼을 누르고 확인 모달을 거치는 경로로 유지된다. 테스트가 이전 UI의 상시 종료 버튼을 전제로 했다.
- **해결·회피(v0.31.0):** 활성 화면의 하단 기준점은 `input-control-toggle` 또는 `일시정지` 버튼으로 잡는다. 버튼 종료 경로를 검증할 때는 `일시정지` → `button[title="입력 종료"]` → `button[title="종료 확인"]` 순서로 테스트한다. 음성 종료 경로는 STT `"종료"` 명령으로 별도 검증한다.
- **출처:** `2026-07-08 survey-011 v0.31.0 입력탭 UI 재정리`, 커밋 `bbf6a1e`; `2026-07-09 v0.32.0 세션` — 누락 2건 추가 수리(`v019-active-layout.spec.ts` W5는 컨트롤바 Y 앵커를 `input-control-toggle`로 교체, `correction-flow.spec.ts` D-2는 일시정지 패널 경로 적용).
- **현재 상태:** ✅수정됨(`tests/v023-voice.spec.ts`, `tests/correction-flow.spec.ts`, `tests/v54-30rows.spec.ts`, `tests/v019-active-layout.spec.ts`).
- **⚠️ 부분 변경(v0.35.0 FB-G, Vance):** **완료(completing, phase 'complete') 상태**에선 하단 중앙 버튼이 `일시정지` 대신 `입력 종료`로 바뀐다(마지막 행 대기 시 일시정지가 무의미). 즉 completing에선 일시정지 패널을 거치지 않고 하단 `button[title="입력 종료"]`가 **직접** 보인다(→ `button[title="종료 확인"]`). **활성(active) 상태**의 상시-종료-없음 원칙은 그대로. completing 종료 경로 테스트는 `v023-voice.spec.ts` B4가 갱신됨(일시정지 우회 제거).

### [TEST-UI-3] 진입 애니메이션(scale(0)→1) 중 getBoundingClientRect가 0×0을 반환 — 측정/스크린샷은 애니메이션 종료 후
- **증상:** v0.35.0 확인 카드 ✓ 배지가 `check-pop`(0%: `scale(0)`) 진입 애니메이션을 쓰는데, 커밋 직후 즉시 스크린샷/측정하면 배지가 `width:0,height:0`으로 잡혀 "렌더 안 됨"으로 오판된다(스타일은 정상 적용됨 — bg/border 존재). 값 텍스트는 `chip-pop`(scale 1→1.16→1, 0 미경유)이라 항상 보여 혼동을 키운다.
- **원인:** `getBoundingClientRect`/스크린샷은 현재 transform을 반영하므로 `scale(0)` 프레임에선 0 크기. 애니메이션(320ms)이 끝나기 전 캡처하면 그 순간을 찍는다.
- **해결·회피:** 진입 애니메이션이 있는 요소는 **애니메이션 시간(≥320ms) 경과 후** 측정/캡처한다. 항상-보여야-하는 배지엔 `scale(0)` 진입을 피하거나(페이드/미세 스케일) 측정 타이밍을 늦춘다. 확인 카드 캡처는 `waitFor(confirm)` 후 ~450ms 대기(1500ms 확인 창 안).
- **파생(민구 판단 필요):** 확인 플래시는 **행 중간 음성 컬럼** 커밋에만 1.5초 지속된다. **행의 마지막 음성 컬럼** 커밋은 `advance()`가 phase를 'complete'로 두고 "N행 완료" 안내를 낸 뒤 다음 행에서 'active'로 복귀하므로(useVoiceSession `advance` 699~742), 그 커밋엔 ✓ 확인 플래시 대신 "N행 완료 — 명령 대기"가 뜬다. 렌더 우선순위(review > confirm)로 이렇게 되며 기존 review 라벨과는 일관되나, **"커밋 직후 ✓+값" 민구 결정과는 행-마지막 컬럼에서 어긋난다** — 행-마지막에도 ✓를 띄우려면 advance/phase 순서 재작업 필요(이번 범위 밖, 민구 확정 대기). 스크린샷/테스트로 확인 플래시를 재현하려면 음성 컬럼 2개 이상 + 첫 컬럼 커밋을 쓴다.
  - **⚠️ 정밀화(2026-07-15 v0.35.0 R3-FIX-5, 실측 타임라인으로 정정):** 위 "✓ **대신** N행 완료"는 정확하지 않다. 행-마지막 커밋에서도 ✓는 **뜬다** — 커밋 직후엔 phase가 아직 'active'라 confirm이 페인트되고, echo TTS가 끝나 `advance()`가 phase를 'complete'로 올리는 순간 review가 **덮어쓴다**. 즉 정확한 동작은 "✓가 echo TTS 길이만큼 잠깐 떴다가 'N행 완료'로 **승계**된다(1.5초를 못 채운다)"이다. rAF 전이 기록(음성컬럼 2개, mock TTS onend 200ms): `listening(산도) → confirm(4.2) → review(1행 완료) → listening(당도)`. 회귀 `tests/v035-hero-confirm.spec.ts`가 이 **순서**(confirm→review, review 이후 confirm 재생 없음)를 고정한다 — "confirm이 없다"로 단언하면 거짓이 된다.

### [TEST-TTS-MOCK-1] 동기(synchronous) `onend` TTS mock이 상태머신 전이를 왜곡 — 존재하지 않는 화면을 검증하게 된다
- **증상:** `tests/v035-hero-confirm.spec.ts`가 **음성 컬럼 1개** fixture로 "커밋 → 확인 카드(✓) → ~1.5초 뒤 대기 복귀"를 단언하며 통과했다. 그러나 음성 컬럼이 1개면 그 커밋은 곧 **행-마지막** 커밋이라, 실기기라면 ✓가 1.5초를 못 채우고 "N행 완료"로 승계된다([TEST-UI-3] 파생). 테스트는 그 review를 **한 번도 보지 못한 채** 통과했다.
- **원인(코드 확정):** mock `speechSynthesis.speak()`가 `onend`를 **함수 본문 안에서 동기 호출**했다. 실제 speechSynthesis는 발화 시간이 있어 절대 그러지 않는다. 동기 onend면 `advance()`의 `setPhase('complete')` → `await announceRowComplete()` → `setPhase('active')`가 **페인트 없이 한 흐름에 끝나** review가 단 한 프레임도 렌더되지 않는다 → 화면이 실기기와 정반대인데 테스트는 초록. mock의 `onend`를 `setTimeout(…, 200)`으로만 바꿔도 전이가 즉시 드러난다(`confirm → review → listening`).
- **해결·회피:** TTS mock의 `onend`는 **항상 비동기**로 발화시킨다(≥1 태스크, 200ms 권장 — 실기기 수백ms~수초의 축약). 동기 mock은 "TTS를 기다리는 모든 상태 전이"(advance/review/확인 플래시/재질문)를 통째로 접어버려, 그 구간을 겨냥한 테스트를 **공허하게** 만든다. 더불어 **일시적 상태**(review 등)는 `expect(...).toBeVisible()` 폴링으로 겨냥하지 말고 rAF로 전이를 기록해 사후 판정하라(`recordHeroTimeline` 패턴) — 수백 ms 상태는 폴링이 놓쳐 플래키가 된다.
- **출처:** `2026-07-15 v0.35.0 리뷰 라운드3`(Vance, R3-FIX-5 사실확인 중 실측). Codex 지적의 **결론**(공허·타이밍 의존)은 옳았으나 **사유**("음성컬럼 1개면 review가 burst를 소비해 확인 플래시가 안 뜬다")는 사실과 달랐다 — 플래시는 뜬다. 1차 증거 = rAF 타임라인.
- **현재 상태:** ✅수정됨(`tests/v035-hero-confirm.spec.ts` — 음성 컬럼 2개 + async onend + 타임라인 오라클). ⚠️주시 — **다른 스펙 다수가 여전히 동기 onend mock을 쓴다**(`manual-input.spec.ts` 등). 그 스펙들이 TTS-대기 전이를 단언하지 않는 한 무해하나, 새로 그런 단언을 추가할 땐 반드시 async로 바꿀 것.
- **출처:** `2026-07-15 v0.35.0 UI 개선 세션`(Vance, 확인 카드 스크린샷 캡처 중 발견). 회귀 `tests/v035-hero-confirm.spec.ts`.
- **현재 상태:** ✅패턴 확립(테스트/캡처 타이밍 규칙).

### [TEST-DATE-LITERAL-1] 픽스처가 `오늘 − 1일`로 만든 날짜를 테스트가 **리터럴로** 박으면 자정에 깨진다
- **증상:** `v039-active-zones`의 알람 카드 날짜 단언이 `07-26`을 기대했는데 `07-27`을 받아 실패했다. 코드는 그대로였고 **날짜만 바뀌었다**(07-27 → 07-28 롤오버). 커밋 직후엔 green이었다가 다음 날 아침 red가 되므로, 회귀로 오인해 멀쩡한 코드를 뒤지게 된다.
- **원인:** 픽스처의 `PREV_ROUND = localISO(Date.now() − 86_400_000)`는 **실행 시각 파생**이다. 그 값을 화면에 그리는 계약(`mm-dd`)을 검증하면서 기댓값만 리터럴로 굳히면 두 값이 하루에 한 번 어긋난다.
- **해결·회피:** 기댓값을 **같은 픽스처 상수에서 파생**시킨다(`PREV_ROUND.slice(5)`). 그리고 그 파생값이 진짜 `mm-dd` 형식인지 **한 줄 더 단언**한다 — 안 하면 픽스처가 깨졌을 때 "빈 문자열이 빈 문자열을 포함한다"로 조용히 통과하는 공허한 테스트가 된다. 일반화: **시각 파생 픽스처를 쓰는 단언은 형식/관계로 판정하고 값은 픽스처에서 가져온다.**
- **출처:** `2026-07-28 v0.40.0`(Vance). 자정을 넘긴 뒤 첫 실행에서 드러났다.
- **현재 상태:** ✅수정됨(`v039-active-zones.spec.ts` §[2] anomaly).

### [TEST-PORT-STALE-1] 앞선 백그라운드 러너가 5177을 물고 있으면 **멀쩡한 코드가 무더기로 실패**한다
- **증상:** `manual-input.spec.ts` 8건이 각각 **2분 타임아웃**으로 실패했다. 방금 만진 코드(수동 알람 발화)와 파일이 겹쳐서 "내 수정이 깨뜨렸다"로 읽기 딱 좋았다. 실제로는 전부 통과하는 코드였다.
- **원인:** 앞서 600초 도구 타임아웃으로 **백그라운드로 밀려난 러너**가 살아서 5177을 잡고 있었다. `playwright.config.ts`가 `reuseExistingServer:false` + `--strictPort`라 새 러너는 서버를 못 띄우고, 각 테스트는 죽은 URL을 기다리다 타임아웃한다. 실패 메시지에 포트 이야기가 **한 줄도 없어서**(각 테스트는 그냥 타임아웃으로 보인다) 오진하기 쉽다. 단독 실행하면 그제야 `http://localhost:5177 is already used`가 보인다.
- **해결·회피:** ① 대량 실패가 **한 파일에 몰려 있고 전부 타임아웃**이면 코드보다 **환경을 먼저 의심**한다(AGENTS.md #12-bis "실패군이 한 기능에 몰려 있으면 전제 조건을 먼저 의심"의 러너 판). ② `-g`로 **한 건만** 돌려 진짜 에러 메시지를 꺼낸다 — 전체 실행은 포트 에러를 개별 타임아웃으로 가린다. ③ 새 스위트 전에 `pkill -f "playwright test"`로 청소한다. ④ 도구 타임아웃으로 백그라운드에 밀린 러너는 **끝난 게 아니다** — 결과를 읽기 전에 살아 있는지 본다.
- **출처:** `2026-07-27 v0.40.0 구현`(Vance). 같은 회차에서 두 번 겪었다.
- **현재 상태:** ✅회피 확립(절차). 앱 코드 무관.

### [TEST-FALSIFY-DEGENERATE-1] "앞으로 진행" 경로만 재면 자동 스크롤 회귀가 **수정 없이도 통과**한다
- **증상:** 칩존 자동 스크롤(진행중 칩을 우측 끝에)의 회귀를 만들고 반증했는데, 수정을 제거해 종전 `scrollIntoView({inline:'nearest'})`로 되돌려도 **테스트가 그대로 통과**했다.
- **원인:** 앞으로만 진행하면 다음 칩이 항상 가시영역 **오른쪽 밖**에서 들어온다. 그때 `'nearest'`의 "최소 스크롤량"이 **곧 우측 정렬과 같은 결과**다 — 두 규칙이 그 경로에서 구별되지 않는다. 오라클이 우연히 참인 구간만 보고 있었다.
- **해결·회피:** 두 규칙이 **갈라지는** 상태를 만들어 재라. 여기서는 "다음 칩이 **이미 화면 안 왼쪽에** 보이는 상태"에서 커밋 → `'nearest'`는 안 움직이고(rightGap=310) 우측 끝 규칙은 재정렬한다(rightGap=8). 일반화: **위치 규칙을 검증할 땐 "이미 만족된 상태에서 다시 요구했을 때"를 반드시 포함**한다. 단조 진행 경로는 여러 규칙을 같은 결과로 수렴시켜 반증을 무력화한다.
- **출처:** `2026-07-27 v0.40.0 칩존 재설계`(Vance). 반증 1차 실패 → 케이스 교체 후 성공.
- **현재 상태:** ✅회귀 확보(`v039-active-zones.spec.ts` 자동 스크롤 케이스).

### [TEST-TTS-WINDOW-1] 목 TTS `onend` 지연을 **initScript로** 늘리면 알람·커밋 자체가 발화하지 않는다
- **증상:** 과도 상태(정정 완료 `정상 : 복귀` 카드처럼 에코 TTS 동안에만 떠 있는 화면)를 캡처하려고 `installVoiceMocks(page, { ttsOnendDelayMs: 2500 })`로 창을 넓혔더니, 그 화면이 아니라 **그 앞 단계인 이상치 알람조차 뜨지 않았다**(`[data-testid="anomaly-alert"]` element(s) not found).
- **원인:** `ttsOnendDelayMs`는 `addInitScript`로 **부팅 전부터** 걸린다. 그러면 `boot()`의 항목 안내 TTS("측정항목01.")가 2.5초 동안 in-flight로 남고, 그 사이 들어온 STT 결과는 postTtsGuard(TTS 중 인식 무시)에 막혀 **커밋이 일어나지 않는다.** 커밋이 없으니 이상치 판정도 없다. 증상만 보면 "알람 로직이 깨졌다"로 오독하기 쉽지만 **테스트 하네스가 입력 경로를 막은 것**이다.
- **해결·회피:** 지연을 **런타임에** 올린다 — 목은 `speak()` 시점에 `window.__ttsOnendDelayMs`를 읽으므로, 원하는 상태 **직전에** `page.evaluate`로 값을 바꾸면 그 뒤 발화부터 적용된다(`tests/capture-current-states.spec.ts`의 `widenTtsWindow`). 부팅·선행 단계는 기본 200ms로 빠르게 통과시키고, 붙잡고 싶은 발화 앞에서만 넓힌다.
- **일반화:** TTS 지연은 **전역 상수가 아니라 구간 설정**으로 다뤄라. 전역으로 키우면 postTtsGuard가 사실상 STT를 상시 차단해, 목을 "느리게" 만든 것이 아니라 **입력을 꺼버린 것**이 된다. [TEST-TTS-MOCK-1](동기 onend가 전이를 접는다)의 **반대 방향 실패**다 — 너무 빨라도, 너무 느려도 화면이 실기기와 달라진다.
- **출처:** `2026-07-27 F3 입력화면 실렌더 캡처`(Vance). 첫 실행에서 9건 중 `05-anomaly-corrected` 1건만 실패해 드러났다.
- **현재 상태:** ✅회피 확립. 앱 코드 무관(테스트 하네스 계약).

### [TEST-DOM-SNAPSHOT-1] `outerHTML` 직렬화는 `scrollTop`을 담지 않는다 — 스크롤 상태 화면이 조용히 맨 위로 돌아간다
- **증상:** 칩존 오버플로(2줄 밖으로 밀린 칩) 상태를 DOM 직렬화로 카드화했더니, 재렌더한 프리뷰는 **스크롤이 0으로 돌아간 다른 화면**이었다. 어떤 에러도 나지 않고, 마크업·CSS·폰트는 전부 정확하다 — 보여주려던 결함만 사라진다.
- **원인:** `scrollTop`/`scrollLeft`는 DOM **속성이 아니라 런타임 상태**라 마크업 직렬화에 포함되지 않는다. `overflow:auto` 컨테이너가 있는 화면을 정적 스냅샷으로 옮길 때마다 재현된다.
- **해결·회피:** 직렬화 **전에** 스크롤이 걸린 노드를 훑어 `data-ds-scroll="top,left"` 같은 속성으로 굳히고, 산출물에 그 값을 되돌리는 **인라인** 스크립트를 동봉한다(`tests/fixtures/previewCapture.ts`). 인라인이라 외부 호스트 요청이 없어 CSP 제약과 무관하다. 그리고 스크롤 값이 실제로 0이 아닌지 **단언**하라 — 이 결함은 "통과했는데 빈 카드"로 나타나므로 공허 방지 단언이 유일한 방어선이다.
- **함께 빠지는 것들(같은 원인 계열):** `<input>`의 현재 `value`, `<canvas>` 픽셀, 그리고 뷰포트 단위(`vw`/`vh`/`dvh`)로 잡힌 크기 — 마지막 것은 뷰어 창 크기가 다르면 통째로 틀어지므로 계산값을 px로 동결해야 한다.
- **출처:** `2026-07-27 F3 입력화면 실렌더 캡처`(Vance).
- **현재 상태:** ✅회피 확립(캡처 도구에 내장 + 회귀 단언).

### [TEST-STT-UI-1] 도움말 hard suspend 검증에서 총 1행 설정이면 `다음` 후 행 번호 변화가 없다
- **증상:** 도움말 모달을 닫은 뒤 STT 복원 검증 테스트가 `다음` 발화 후 `active-row`가 1→2로 바뀌기를 기대했지만 실패했다.
- **원인:** 테스트 fixture의 `totalRows`가 1이었다. 이 경우 앱은 정상적으로 `nextRow` 명령을 처리해도 2행으로 이동하지 않고 `end_reached_waiting` 안내로 남는다. 즉 실패는 STT resume 실패가 아니라 잘못된 테스트 오라클이었다.
- **해결·회피(v0.31.0):** hard suspend/resume 검증은 행 번호 변화만 보지 말고 `logEvents`의 `ui_suspend`, `ui_resume`, 이후 `command parsed=nextRow text=다음행` 기록을 확인한다(🔴 v0.49 F-1에서 행 이동 어휘가 '다음'→**'다음행'**으로 재배정됐다 — 이 절차를 그대로 쓰려면 발화도 '다음행'이어야 한다). 행 이동 자체를 검증하려면 최소 2행 이상 fixture를 사용한다.
- **출처:** `2026-07-08 survey-011 v0.31.0 입력탭 UI 재정리`, `tests/v026-tolerance-strict.spec.ts` T5 갱신.
- **현재 상태:** ✅수정됨. 도움말 중 STT 명령 무시와 닫은 뒤 복원은 로그 기반으로 검증.

### [TEST-SANDBOX-1] 제한 샌드박스에서 Vite 포트 bind·Chromium Mach rendezvous가 EPERM으로 전면 차단
- **증상:** `npm run dev -- --port 5175 --strictPort`가 `listen EPERM 0.0.0.0:5175`, Playwright의 모든 케이스가 실행 0ms에 Chromium `bootstrap_check_in ... MachPortRendezvousServer: Permission denied (1100)`로 실패한다.
- **원인:** 코드/테스트 assertion 실패가 아니라 현재 실행 컨테이너의 네트워크 listen 및 macOS Mach service 권한 제한. 서버 미기동 상태에서도 브라우저 launch 자체가 먼저 SIGTRAP으로 종료된다.
- **해결·회피:** 포트 bind와 Chromium launch가 허용된 호스트 세션에서 5175 strictPort 서버를 띄워 전체 스위트를 재실행한다. 이 패턴은 passed/failed 제품 회귀 수치에 포함하지 말고 인프라 차단으로 별도 보고한다.
- **출처:** `2026-07-15 survey-011 v0.34.0 High 3건 수정 세션`(Vite·Playwright 명령 stdout 직접 확인).
- **현재 상태:** ⚠️환경 차단 — `npx tsc --noEmit`은 clean, Playwright 제품 검증은 권한 있는 실행 환경으로 이관 필요.

### [TEST-PAST-NODE-1] pastValues 실제 모듈은 브라우저 없는 Playwright worker에서 IDB 삭제가 settle되지 않음

- **증상:** 태스크 06의 generation 상태를 브라우저 없이 검증하려고 실제 `pastValues` 모듈을 import한
  뒤 테스트 `beforeEach`에서 `invalidatePastIndex()`를 await하자, 3건 모두 본문 진입 전에 30초 timeout.
- **원인:** `invalidatePastIndex → deletePastIndexBackup → idb.openDB`가 브라우저 IndexedDB가 없는 Node
  worker에서 완료되지 않았다. 단순 `localStorage` polyfill만으로 실제 모듈 상태 테스트를 만들 수 없다.
- **해결·회피:** 프로덕션 전용 seam·가짜 IDB 의존성을 추가하지 말고, 실제 Chromium+IDB를 쓰는 e2e로
  검증한다. 제한 샌드박스에서 Chromium이 [TEST-SANDBOX-1]로 막히면 실행 미확인과 수동 반증 절차를 남긴다.
- **출처:** `survey-011 v0.38.0` 태스크 06(2026-07-23), 브라우저 비기동 Playwright 3/3 timeout.
- **현재 상태:** ✅실패한 실험 스펙 제거. 제품 코드 변경 없음.

### [TEST-PERSIST-SEAM-1] 빈 세션에서는 persist 실패·지연 seam이 호출되지 않아 종료 테스트가 공허해진다
- **증상:** `tests/v035-r3-fixes.spec.ts`의 P1-1/P1-4가 각각 `__survey011DelaySessionPutMs`/`__survey011FailSessionPut`을 주입했지만, stopping 또는 저장 실패 화면을 관측하지 못했다. P1-3도 같은 빈 세션+지연 seam 구조라 종료 재진입 창이 결정론적으로 유지되지 않았다.
- **원인:** `useVoiceSession.persistSession()`은 완료행·백업·활성행 데이터·skip 행이 모두 없으면 `saveSession()` 호출 전에 `true`를 반환한다. `startSession()` helper는 값을 커밋하지 않으므로, seam을 켜기만 해서는 `db.saveSession()`의 지연/실패 분기에 도달하지 않는다.
- **해결·회피:** persist seam에 의존하는 테스트는 seam 주입 전에 `fireStt`로 실제 값을 커밋하고, 필요하면 완료행까지 만든다. Observer 등 다른 폴백 seam은 주입 후 런타임 전제(`typeof ... === 'undefined'`)도 직접 단언해 공허 통과를 차단한다.
- **출처:** `2026-07-16 v0.35.0 P1/P2 회귀 테스트 보정` — 권한 있는 호스트 전체 스위트에서 수정 전 681 passed/2 failed/16 skipped; 실패 스크린샷과 `src/lib/useVoiceSession.ts` 조기 반환 분기 대조.
- **현재 상태:** ✅테스트 보정됨(`tests/v035-r3-fixes.spec.ts` P1-1/P1-3/P1-4 값 커밋, P2 seam 전제 단언). 제품 코드는 변경하지 않음.

### [TEST-REVIEW-RECEIPT-1] `v037-review-receipt:252`가 전체 격리 실행에서 간헐 실패 — 검토 화면 미도달

- **증상:** `tests/v037-review-receipt.spec.ts:252`("(e) 검토 중 터치 컬럼 인라인 편집")가
  `fireStt('30.7')` 직후 `[data-hero-state="review"]`를 4초 안에 못 찾아 실패한다. 실패 시점의 페이지
  스냅샷은 **설정 화면**("오늘의 측정 항목과 시트 연결")이다 — 즉 검토 화면이 안 뜬 게 아니라 **세션이
  리셋돼 초기 탭으로 돌아가 있다**(`App.tsx`의 기본 탭이 `settings`).
- **재현 조건:** **전체 스위트 격리(`--workers=1`) 실행에서만**, 그것도 간헐적이다.
  - 전체 격리 1회차: 821 passed / **1 failed**(이 건)
  - 전체 격리 2회차: **822 passed / 0 failed**(동일 코드·동일 조건)
  - 단독 격리(`npx playwright test v037-review-receipt --workers=1`): **4 passed** — 재현 안 됨
  - 전체 병렬: 822 passed / 0 failed
- **이번 하네스 변경과 무관함(구조적 근거):** 발견 시점의 워킹트리는 `tests/` 58개 + `playwright.config.ts`
  **1개만** 변경됐고 `src/`는 **배포본 `75c53c4`와 바이트 동일**하다(`git status -- src/` 무출력로 확인).
  테스트 쪽 변경은 `const BASE = 'http://localhost:5175'` → `import { BASE } from './baseUrl'` 상수 치환과
  주석 정정뿐이라 앱 런타임 동작을 바꿀 수 없다.
  ⚠️ 다만 **환경은 바뀌었다** — 종전엔 사람이 오래 띄워둔 dev 서버(5175)를 재사용했고, 이제는
  `webServer`가 매 실행마다 **차가운 vite를 5177에 새로 띄운다**. 이 차이가 간헐성에 기여하는지는
  **미검증**이다(추측을 확정으로 쓰지 말 것).
- **미확정(원인):** "세션이 리셋된 것처럼 보인다"는 관찰까지가 사실이다. 페이지 리로드(vite 의존성
  재최적화로 인한 full reload, service worker 갱신 등)를 의심할 수 있으나 **로그로 확증되지 않았다.**
- **영향:** 검토(complete) 화면 회귀 테스트 1건의 신뢰도. **제품 코드 결함 근거는 없다** — 같은 파일의
  (a)~(d) 4건은 안정적으로 통과하고, 이 건도 단독 실행에서는 항상 통과한다.
- **출처:** 2026-07-25 하네스 보강 세션(Larry). 전체 격리 2회 실행 중 1회 발생.
- **현재 상태:** ⚠️주시 — 재발하면 실패 직전 구간의 콘솔·네트워크 로그를 남겨 리로드 여부를 확증한다.
  [TEST-CLIP-POSTROLL-1]과 달리 **단독 격리에서 재현되지 않는다**는 점이 다르다.

### [TEST-CLIP-POSTROLL-1] `clip-postroll:212`가 격리 실행에서도 간헐 실패 — 클립 저장 이벤트 0건

- **증상:** `tests/clip-postroll.spec.ts:212`("post-roll 자연 완료")가 `clip_saved` 이벤트를 하나도 관측하지 못해 실패한다(`Expected >= 1, Received 0`). 전체 병렬에서도, **단독 격리(`--workers=1`)에서도** 나온다 — 부하성 flake의 전형적 신호(격리 시 회복)를 따르지 않는다.
- **v0.38.0과 무관함(환경 대조로 확정):** `src`·`tests`를 통째로 **기준선 `2c2eabc`로 되돌려** 같은 조건(`--workers=1 --repeat-each=2`)으로 실행해도 **동일하게 실패**한다(기준선 1/2 실패, v0.38.0 반영본 2/2 실패 — 표본이 작아 실패율 차이는 유의하지 않다). 즉 v0.38.0 리뷰 반영 커밋들(`374fd09`·`49d33a2`·`89f2097`)이 만든 회귀가 아니다.
  ⚠️ 중간 대조에서 `audioRecorder.ts` **한 파일만** 되돌렸을 때도 실패해 "무관"으로 볼 뻔했으나, 그건 나머지 변경이 남은 불완전한 대조였다. **환경 대조는 변경 전체를 되돌려야 성립한다.**
- **미확정(원인):** 실패 지점이 "저장 이벤트 자체가 없음"이라 post-roll 타이머가 아니라 **클립 저장 경로 전단**(headless에서 `MediaRecorder`가 fake 스트림으로 데이터를 못 만드는 조건)일 가능성이 있다. 같은 파일의 `:236`("우아한 절단")은 안정적으로 통과해, 900ms echo TTS를 기다리는 `:212`만의 타이밍 전제가 의심된다. **미검증 — 추측을 확정으로 쓰지 말 것.**
- **영향:** 클립 감사(audit) 축의 테스트 신뢰도만 영향. **측정값 저장 경로와 무관**하다.
- **출처:** 2026-07-23 v0.38.0 Phase 2 검증(Larry). 전체 727 passed / 6 failed → 격리에서 이 건만 잔존.

#### 🔑 근인 규명 완료 (2026-08-01, v0.43.0 코더3 레인) — 위 두 추측 중 **하나가 맞았다**

**"간헐 실패"가 아니다. 격리에서 `a018d68` 기준 `--repeat-each=10`에 `10/10` — 결정적 실패다.**
(줄 번호는 그 뒤 테스트 추가로 `:212` → **`:214`** 로 밀렸다.)

| 07-23의 추측 | 판정 |
|---|---|
| *"`MediaRecorder`가 fake 스트림으로 데이터를 못 만드는 조건"* | ❌ **틀렸다** |
| *"900ms echo TTS를 기다리는 이 테스트만의 타이밍 전제가 의심된다"* | ✅ **맞았다** |

**근인:** 이 테스트가 `setupAndStart(page, 900)` → `mockScript(900)`으로 **모든 발화**의 TTS
지속시간을 900ms로 늘려놓고, 정작 STT는 활성 칩 확인 후 **고정 800ms** 뒤에 쏜다.
시작 안내 체인(조사나무 → 조사과실 → 횡경)이 각 900ms라 **안내 TTS가 끝나기 전에 발화가 도착한다.**
`800 < 900`이라 **격리에서는 결정적으로 실패**한다.

- **증거(화면):** 실패 시점 횡경 칩 값이 `—` 다. 진행이 막힌 게 아니라 **값이 아예 커밋되지 않았다.**
- **증거(반증):** 그 `800`을 `3500`으로 **한 군데만** 바꾸고 실행 → **3/3 통과**(수정 전 10/10 실패). 원복함.
- ⚠️ **드롭 지점은 미확정이다** — 발화가 `awaiting` 미무장 / self-echo 가드 / 클립 전이 중
  **어디서** 소실되는지는 계측하지 않았다. 판정과 수정 방향은 어느 쪽이든 바뀌지 않는다.

🔴 **`[ORCH-50]` 역방향 사례의 실물이다.** 부하가 **가장 적은** 격리에서 10/10 실패인데,
970여 개가 앞서 도는 전체 스위트에서는 **통과하기도 한다.**
→ *"격리 통과 = flake"* 만 조심할 게 아니라 **"스위트 통과 = 건강"도 틀린다.**
⚠️ v0.43.0 회차에 *"머신 부하 탓(load 2.4~3.9)"* 이라는 가설이 있었으나 **이 실측이 반증했다.**

- **현재 상태:** ⚠️주시 — **근인 규명됨 · 미수정.** v0.43.0 릴리스 블로커 아님
  (기능 5건 **이전**부터 red이고 회귀가 아님이 실측됐다).
  **수정은 별건이다** — 고칠 곳은 앱이 아니라 **테스트의 `800` 상수**다.

### [TEST-LINT-RACE-1] Playwright와 ESLint 병렬 실행 시 `test-results/` 삭제 경쟁으로 lint가 중단됨

- **증상:** `npm run lint`와 `npx playwright test ...`를 동시에 실행하면 ESLint가
  `test-results/`를 순회하는 순간 Playwright가 해당 디렉터리를 정리해
  `ENOENT: no such file or directory, scandir '.../test-results'`로 종료될 수 있다.
- **원인:** ESLint 대상이 `.` 전체이고, Playwright는 실행 시작/종료 과정에서 `test-results/`를
  생성·삭제한다. 두 프로세스가 같은 임시 산출물 경로를 동시에 건드리는 환경 경쟁이다.
- **해결·회피:** Playwright와 `npm run lint`는 직렬 실행한다. 이 오류가 나오면 두 프로세스가 모두
  끝난 뒤 lint를 단독 재실행해 제품 코드 판정을 확정한다.
- **출처:** 2026-07-23 태스크 02 검증. **현재 상태:** ✅회피 절차 확립.

### [TEST-HMR-MODULE-1] e2e의 절대 URL 동적 import가 앱과 별도 모듈 인스턴스를 만들어 UI 상태를 갈라놓음

- **증상:** 테스트가 `import('/src/lib/pastValues.ts')`로 직접 시작한 로더는 최종 `ready`이고 IDB도
  최신 지문인데, 같은 화면의 `ConnectionStatusCard`는 계속 `미준비`였다. 직접 import한
  `settingsStore` 변경은 카드에 반영돼, 설정은 공유되지만 pastValues 모듈 상태·리스너만 갈렸다.
- **원인:** 장시간 실행된 Vite dev 서버에서 HMR된 앱 import에는 timestamp 쿼리가 붙을 수 있다.
  테스트가 쿼리 없는 절대 URL을 다시 import하면 브라우저 ESM은 이를 별도 모듈 identity로 평가해,
  모듈 전역 캐시·inflight·구독자 Set이 앱 인스턴스와 분리된다.
- **해결·회피:** 앱 UI와 모듈 전역 상태를 함께 검증하는 e2e는 소스 모듈을 직접 import해 상태를
  만들지 말고, 실제 사용자 경로(이번 건은 로그인 → 자동 재연결 → 컬럼 교체)로 발화시킨다. 비동기
  순서는 네트워크 응답 보류·완료 probe처럼 테스트 경계에서 제어한다.
- **출처:** 2026-07-23 태스크 02b. **현재 상태:** ✅회귀 테스트를 실제 앱 경로로 교체.

### [MIC-B2] 백그라운드 복귀 + 오디오 경로전환 후 클립 recover가 `NotAllowedError`로 전멸 — 낡은 AudioContext 참조를 첫 시도가 버린다
- **증상(실기기 확증):** 앱을 50분 백그라운드에 둔 뒤(12:12→13:02) BT이어폰→폰 스피커로 경로가 바뀐 세션에서, 제스처 경로 재연결 `getUserMedia`가 **8시도/0성공/0클립**, 매 시도가 **~10ms 내 즉시 reject**. 권한은 진짜 허용 상태였고(같은 세션에서 마이크 라벨 열거됨) **STT는 생존**, 시트값 18/18 무손실 — 죽은 건 클립 녹음뿐. 같은 날 BT 유지 세션은 78클립 정상.
- **판정:** 즉시 reject라 **hang이 아니다** — 초기 코드추적 가설(attach withTimeout 누락)은 텔레메트리로 **반증**됐다. `NotAllowedError`지만 실제 권한 거부가 아니라 **오디오세션/컨텍스트 실패**다.
- **구조적 근인(가설과 무관하게 확실):** `MicPrerollTap.detach()`가 `this.capture = null`을 **먼저** 하고 `ctx.close()`를 fire-and-forget으로 던졌다. 그래서 **첫 재연결 시도가 낡은 컨텍스트의 참조를 버린다** → 2회차부터는 닫을 대상조차 없다(8회 중 7회). 즉 낡은 컨텍스트를 실제로 닫을 수 있는 창은 **재연결 시도 이전 = 포그라운드 복귀 직후**뿐이다(그때는 prewarm 캡처가 살아 있다).
- **수정(v0.38.1):** `detach()`를 awaitable로 승격(close 실패도 호출부로 전파) + `AudioRecorder.teardownAudioGraph()`가 **장기 백그라운드(≥60s) 복귀 시에만** 낡은 그래프를 `withTimeout` 경계로 정리하고 소유권(`acquireGen`+stream 스냅샷)이 그대로일 때만 재부착. **재획득은 하지 않는다**([IOS-5] 유지). `attach()`는 publish 직전 세대를 최종 확인해 늦은 옛 attach가 새 capture를 덮지 못하게 한다.
- **⚠️ 이 수정은 미검증 가설이다.** "물린 AudioContext가 gUM을 막는다"(P1)와 "close가 그것을 푼다"(P2) 모두 1차 출처가 없는 추론이다. 그래서 **판정 바이트**를 함께 넣었다: `mic_teardown:found=…,closed=…,reattach=…,evt=…,bg_s=…`. `found=none`=닫을 게 없었음(이 수정이 no-op → 세션-레벨 물림, 폴백 리로드로 분기) · `closed=timeout`=close 자체가 물림 · `reattach≠ok`=마이크는 멀쩡한데 프리롤·파형만 죽음. **이 바이트 없이는 "고쳐도 안 풀린 것"과 "애초에 아무것도 안 한 것"을 구분할 수 없다.**
- **주의(안티패턴):** gUM **직전에** `await ctx.close()`를 넣지 말 것 — 제스처 창을 소모하거나 hung close가 획득을 지연시켜 **정상 경로(78클립 세션)를 깨뜨린다.** 정리는 획득 콜스택에서 분리해야 한다. 또 `ctx.state`를 분기 근거로 쓰지 말 것(복귀 직후 좀비 `'running'` 보고 사례) — 게이트는 **경과시간**이 쥔다.
- **출처:** survey-011 v0.38.1, 2026-07-24 실기기 로그(`sess_1784865837431`) + Trace 분석 + Pax iOS gUM 리서치.
- **🔴 2026-07-27 실기기 회차 (v0.39.0) — 판정 사다리 `미발화`. 판정 불가. "성공했으니 해결"로 읽지 말 것.**
  - `mic_teardown` **0건** · `audio_route_revalidate` **0건**. 계측 고장이 아니라 **설계상 정상**이다:
    오늘 유일한 백그라운드가 `vis_hidden 09:33:53.961 → vis_visible 09:34:52.192` = **58,231ms**로
    `LONG_BACKGROUND_TEARDOWN_MS`(60,000) **미달** → `shouldTeardown=false` → teardown 미호출.
    F5도 같은 임계 + 경로변경 조건인데 복귀 시점 before/after가 둘 다 `내장 마이크`(BT 전환은 2.3초 뒤)라 미발행.
  - **대신 자동 재연결이 실기기에서 처음 성공했다** — `vis_visible` → `mic_track:ended:vis` →
    `mic_auto_reconnect:attempt` → **2.28초 뒤** `clip_recorder_recovered:user_gesture:OpenDots ONE by Shokz` +
    `mic_reconnect_ok`. 07-24(8시도/0성공)와 정반대. 이후 세션 종료까지 클립 42개 정상.
  - **사다리 문항별:** "임계 미달 복귀인데 **실패**→임계 하향" 문항은 **반증**됐다(미달 복귀였고 **성공**).
    → **`LONG_BACKGROUND_TEARDOWN_MS` 하향 근거 없음.** 나머지 문항은 입력 바이트 부재로 전부 판정 불가.
  - **07-24 실패 조건(약 50분 백그라운드 + BT→스피커)은 재현되지 않았다.** 재현 요청 유지.
  - **파생 신규 함정 → [FG-RETURN-LOG-1]** (아래 ⑧): `shouldTeardown=false` 복귀가 **무기록**이라
    "판단해서 건너뜀"과 "훅 자체가 안 돔"을 구별할 수 없다. 이 항목이 스스로 경고한 실패 모드의 **"안 찍힌 것" 축**이다.
- **현재 상태:** ⚠️계측 배포됨, **실기기 판정 대기(2026-07-27 회차 미발화로 여전히 미결)**.

### [UI-GLOW-1] `position:fixed`에 `offsetParent` 가시성 판정은 상시 오탐 → **가드레일로 이동**
- ✅v0.38.1 수정, `v034-wave-glow` 21/21 통과. 가시성 판정은 `getClientRects().length`를 쓰는
  일반 규칙이라 [ENGINEERING-GUARDRAILS.md](./ENGINEERING-GUARDRAILS.md) ④로 옮겼다.

### [UI-ALERT-1] 같은 문구를 두 곳에서 조립하면 "글자까지 동일" 계약은 깨진다 → **가드레일로 이동**
- ✅v0.39.0 수정 + 반증 4건 확인. 조립부를 하나로 두는 일반 규칙이라
  [ENGINEERING-GUARDRAILS.md](./ENGINEERING-GUARDRAILS.md) ③으로 옮겼다.
  ⚠️ `trend_alert_fired`의 `text=` 바이트가 v0.39.0에서 바뀐 점(로그 컷오버)도 그쪽에 있다.
  **실기기 상태: TTS의 `:` 발음은 미확인(기기 게이트).**

---

## 확인 필요 (미검증)

아래는 출처로 충분히 뒷받침되지 않았거나 survey-011 적용 여부를 직접 확인하지 못한 항목. **본문 항목으로 신뢰하지 말 것.** 검증 후 해당 카테고리로 승격하거나 폐기하라.

1. **pause/resume 시 recorder 누수** — 조상 `@7dd6e8b`(입력-B: pause 중 recorder dispose + resume 시 재생성)에서 누수 차단을 언급. survey-011 `audioRecorder.ts`/`useVoiceSession.ts`의 pause/resume 경로가 동일 패턴을 따르는지 미확인.
2. **IDB 클립 구형 Blob 하위호환 경로** — `db.ts`가 ArrayBuffer로 저장하면서 구형 Blob도 읽는다는데, survey-011이 신규 레포라 구형 데이터가 존재하는지/하위호환 코드가 실제로 필요한지 미검증.
3. **GitHub issues/PR 기반 추가 함정** — 010 issues 0건, 011 issues/PR 0건, 010 PR 1건(`v0.9-improvements` = `@2ed62a5`, 이미 반영). gh 출처에서 **신규 distinct 이슈 없음**. 향후 issue 생기면 여기서 수확.
4. **survey-011 자체 v0.1~v0.2 라인의 함정** — 본 문서는 조상(010)과 이번(06-04~05) 세션 중심. survey-011의 v0.3.0 이전 자체 커밋 이력은 별도 수확 대상(미수행).
5. **행 미완료(complete:false) 상태에서 clips-manifest committedValue가 정정 전 값으로 남음** — 2026-07-07 [CLIP-CORRECTION-1] 수정 재검증(Sonar A4 라운드3) 중 관측: 종경(다음 컬럼)에 값을 아직 안 주고 행을 넘긴 export에서 `committedValue`가 33.3(정정 전 값)으로 남아 있었음. [CLIP-CORRECTION-1] 수정(cmd 클립 컬럼 태깅)과는 무관 — colId 태깅 자체는 이 케이스에서도 정확했음. "필드 이탈 시 커밋" 기존 설계와 다른 조건인지, 별도 버그인지 미확정(n=1). 다음 실기기 로그 또는 추가 데스크탑 재현으로 확인 필요.
6. **"~점이요" 공손 종결 발화가 소수로 합성될 수 있음** — 2026-07-14 v0.34.0 O3 작업 중 관측: "266 점이요"가 266.2로 파싱('이요'의 '이'가 소수 2로 합성). "점 이 요"(=.2 의도) 정당 발화와 문자열상 구분 불가라 **블라인드 수정 금지** — 실기기 로그에서 "점이요" 발화 빈도·오커밋 여부 관측 후 판단.
7. **Playwright 병렬 부하 플레이크** — `correction-flow.spec.ts`(:276, :411)·`trend-alert.spec.ts`(:458)가 2-worker 병렬 부하에서 간헐 실패(고정 `waitForTimeout` 기반 오라클). 단독·재실행 모두 PASS(2026-07-14 확인, 코드 변경과 무관). 전체 스윕에서 재발 시 flaky로 취급하고 이벤트 기반 대기로 교체 후보.

---

## 2026-07-28 추가

### [CLIP-WINDOW-1] 개선요청 모달 대기 시간이 커밋 클립 녹음창에 포함돼 값 발화를 밀어냄
- **증상(2026-07-27~28 실기기 로그·클립 감사):** 길이 이상 클립 10/10이 `ui_suspend`~
  `ui_resume` 창과 61~92% 겹쳤다. 최악 323.6초 클립은 모달 대기만 296.3초였고, 값 발화는
  마지막 5초 안에 있었다.
- **근인:** [`useVoiceSession.ts`](./src/lib/useVoiceSession.ts)의 `suspendRecognitionForUi`가
  STT·TTS만 중단하고 독립 `MediaRecorder` 녹음창은 계속 열어 뒀다.
- **🔴 2026-07-27 오진 정정:** 이 현상을 **“커밋 클립 트림 무작동”으로 본 결론은 오진**이다.
  [`audioTrim.ts`](./src/lib/audioTrim.ts)는 모든 발화를 감싸는 단일 범위의 가장자리만 트림하는
  계약대로 작동했다. 내부 모달 대기를 잘라 이어붙이는 수정은 [ENGINEERING-GUARDRAILS.md](./ENGINEERING-GUARDRAILS.md)
  ⑤ `[CLIP-MIDSPEECH-1]`을 위반하므로 금지한다. 근인은 트림이 아니라 **녹음창 수명**이다.
- **수정:** 첫 UI suspend에서 활성 클립을 stop하되 반환 blob은 저장하지 않고 폐기한다. 중첩 UI가
  모두 닫힌 뒤에도 같은 `(row,colId)` 값을 기다릴 때만 새 클립을 시작한다. 따라서 모달 전 조각과
  대기 구간을 splice하지 않으며, 가짜 셀 클립도 저장하지 않는다.
- **회귀·반증:** `tests/clip-modify-rerecord.spec.ts` `[CLIP-WINDOW-1]`. 구현 제거 시 2/2 red
  (단일 녹음창 4,151ms·4,269ms), 적용 시 2/2 green.
- **현재 상태:** 🟡 **MONITORING** — 데스크톱 Playwright 수정·반증 완료. iOS 실기기 판정 전에는
  `RESOLVED`로 올리지 않는다.

### [MODIFY-TARGET-1] 마지막 행 완료 뒤 “수정”이 마지막 항목 대신 첫 항목을 타깃함
- **증상(2026-07-27 실기기):** 마지막 행 입력 완료 뒤 bare “수정”을 말하면 마지막 항목이 아니라
  첫 음성 항목부터 행 끝까지 화면에서 `—`로 바뀌어, 사용자가 행 전체 데이터가 사라졌다고 오인했다.
- **데이터 손실 0:** 캐스케이드 clear는 sessionStore **in-memory only**다. 실측 `sessions.json`의
  마지막 행 값·`complete=true`·`audioClips`는 모두 온전하며, 재완료 전에는 IDB/dataStore의
  기존 측정값을 덮지 않는 보존 계약도 불변이다.
- **근인 A:** `atEnd` 센티넬은 마지막 컬럼 `colId`를 이미 가리키지만 `enterModifyMode`가 이를
  참조하지 않고 `activeColIdx - 1`을 써서 첫 컬럼을 골랐다.
- **근인 B:** 기존 캐스케이드가 선택된 `targetIdx`부터 행 끝까지 비우므로, 잘못 고른 첫 컬럼 때문에
  두 값 모두 화면에서 사라졌다. 타깃 선택을 바로잡으면 bare 수정은 마지막 한 칸만 비운다.
- **수정:** `atEnd` 센티넬 `(row,colId)`을 bare 수정 타깃으로 우선하고, 기존
  `extractModifyColumn` 호출 스코프를 `reviewWait`에서 `reviewWait | atEnd`로 넓혔다.
  파서 어휘·캐스케이드·영속 계층은 변경하지 않았다.
- **재현 범위:** 일반 `active` 중 수정은 기존에도 마지막 항목을 올바르게 골랐고, 결함은 마지막 행
  완료 후 `atEnd`에 한정된다. 회귀 `tests/v037-review-receipt.spec.ts` 2건, 구현 제거 2/2 red,
  적용 2/2 green.
- **현재 상태:** 🟡 **MONITORING** — 데스크톱 Playwright 수정·반증 완료. 음성 명령 실기기 판정 전에는
  `RESOLVED`로 올리지 않는다.

### [EXIT-REACH-1] 완료 행 검토 중 중앙 종료 버튼이 행마다 사라졌다 되살아남
- **민구 확정 노출 조건(2026-07-28):** 종료는 ① 일시정지 뒤 하단 좌/우 `재시작`·`종료`,
  ② 마지막 행을 처음 완료한 직후 중앙 `종료`에서만 보인다. 평시 입력과 완료 행 검토에서는 숨긴다.
- **실측:** 마지막 행 완료(`end_reached_waiting`) → 17행 검토(`review_wait`) → 16행 완료 경로
  (`row_complete`→`end_reached_waiting`)의 9초 동안 중앙 종료가 **있음→없음→있음, 총 3회 토글**됐다.
- **근인 A(의도된 축):** `enterReviewWait`은 완료 행 검토를 조사 완료 화면과 구분하려고
  `endReached=false`로 내린다. `setPhase`가 `complete` 밖에서 자동 해제하는 store 계약도 정상이다.
- **근인 B(결함):** 검토 중 완료 행의 `[다음]`이 아래 미완료 행을 못 찾으면 완료 행 진입을 새
  끝 도달로 오해해 `announceEndReached()`를 재호출했고, 중앙 종료를 되살렸다.
- **수정:** `endReached=false`인 완료 행 검토에서는 `[다음]`이 다음 완료 행의 검토로 이동하고,
  마지막 경계에서도 검토를 재무장한다. 중앙 종료의 정상 최초 노출은 유지한다. 검토 상태 도트에는
  민구 확정 A안인 작은 `눌러 일시정지` 라벨을 같은 고정 밴드 안에 넣고, 평시에는 렌더하지 않는다.
  `panelOpen`의 하단 행동 행 전체 숨김 게이트는 그대로다.
- **회귀 가드:** `tests/v037-review-receipt.spec.ts` `[EXIT-REACH-1]`이 최초 중앙 종료, 다른 행 이동 후
  미노출, 완료 행 재진입 미부활, 일시정지 후 `재시작`·`종료`, 평시 힌트 미노출, 도트·라벨 밴드
  containment, 조절판 열림 시 행동 행 전체 숨김을 검증한다. 핵심 분기 제거 시 반복 2/2 red.
- **현재 상태:** 🟡 **MONITORING** — 데스크톱 Playwright 수정·반증 완료. 짧은 실기기 화면에서
  도트·라벨 공간과 오탭 재발 0건을 확인하기 전에는 `RESOLVED`로 올리지 않는다.

---

## 2026-07-29 v0.41.0 실기기 회차 판정 (회차 SSOT: `workspace_teamops/deliverables/2026-07-29-survey-011-log-analysis.md`)

### 기존 항목 상태 갱신 (실기기 첫 판정)

- **[WAKELOCK-REACQUIRE-1] → ✅ RESOLVED.** `wake_lock:action=reacquire,result=ok` **3/3**
  (09:22:26 · 09:35:20 · 11:33:06, 28ms). **117.6분 백그라운드 복귀에서도 성공.**
  07-28엔 계측이 0건이라 확인 자체가 불가능했던 항목이다.
- **[MODIFY-TARGET-1] → ✅ 의도대로 동작.** 제보 #7 스크린샷에서 마지막 행 수정 시
  `횡경`만 `—`이고 `조사나무=3`·`조사과실=3`은 유지됨을 확인.
- **[CLIP-WINDOW-1] → 🔴 MONITORING 유지 (미해결·부분 개선).** `stopClip()` 자체는 작동한다 —
  모달 진입 시 활성 창이 **501~503ms 안에 종료**됐다(해당 4건 전부). 그러나 **`ui_suspend` 직후
  17~18ms에 신규 녹음창이 열려 모달 구간을 100% 덮는다.** 2건 재현(A 154.3s/145.1s → 파일
  `sess_1785284488617:7:c1la8byb.wav` **154.827초** = 회차 최악 / B 64.6s/64.6s는 `clip_saved` 미발생으로
  **파일이 안 생겨 계측 축에서만 관측**). → 후속 **[CLIP-WINDOW-2]**.
- **[EXIT-REACH-1] → ⚠️ 의도대로 동작하나 숨김 조건이 실사용에 과하다.** 회귀 아님(민구 확인).
  → 후속 **[EXIT-PERSIST-1]**.
- **[CHIP-TYPO-1] → ⚠️ 부분 미해결.** 28.1px로 키웠으나 제보 #6에서 "더 키워라" 재요청.
- **[ALERT-COMPARE-1] → ⚠️ 수정 방향 오류.** 제보 #3 "이상치 알람의 좌우 불균형".
- **[MIC-B2] → 🔴 3회차 만에 판정 가능 → 결함 있음.** `foreground_return:bg_s=7058`(117.6분) —
  07-27 58.2초·07-28 36.3초의 임계 미달을 118배로 돌파. 복귀 시 `teardown=no_recorder`(선-정리 no-op),
  **32.5초 뒤 `stt lifecycle:error:audio-capture`**, `track_ended`→`restart` 후 **15초 뒤 복구**
  (11:33:53 `raw_confidence 0.977` → 11:34:00부터 value 12건 연속). 사용자는 그 사이 입력 방식을
  3회 전환하고 인식 임계를 0.4로 낮췄다.
- **[CLIP-BG-MUTE-1] → 판정 보류(여전히 n=1).** 이번 hidden 창(7,058초)은 **앱 이탈**이라
  `clip_started` 0건 — 녹음 시도 자체가 없어 대조군이 되지 못한다. **세션 진행 도중 화면을 끄는**
  시나리오가 필요하다.
- **[SCREEN-LOCK-1] 계측 → ✅ 정상 발화(2026-07-29 재확인으로 정정).**
  ⚠️ 이 줄은 처음에 *"🔴 0건 미발화 → 화면 끄기 축 판정 불가"* 로 기록됐고 **틀렸다.**
  `screen_lock`이라는 **이름의 이벤트는 애초에 존재하지 않는다**(`grep -rn "screen_lock" src` → 0건).
  이 항목이 실제로 내보내는 계측은 `visibility_context`·`lifecycle_signal`이고,
  07-29 로그에 각각 **17건 · 31건**이 정상적으로 찍혀 있다(`evidence=blur` 포함).
  → **판정이 막힌 이유는 계측 부재가 아니라 그날 데이터에 화면 끔 사례가 없었던 것뿐이다.**
  🔑 `[MIC-BG-STOP-1]`의 선행 검증(화면 끔 ↔ 앱 이탈 구별)은 **현재 배포본으로 이미 가능하다** —
  새 계측을 기다릴 필요가 없다. 다음 실기기 회차에 시나리오만 찍으면 된다.
  ⚠️ **후행 정정(2026-07-31):** 그 선행 검증은 **결국 실행되지 않았다.** plan §3-1에서
  `visibility_context` 11건이 전부 `evidence=blur`로 나와 갈리지 않았고, 민구가 **구분하지 않고
  둘 다 중지**하기로 지시했다. v0.43.0 #4는 그 지시대로 구현했다 → `[MIC-BG-STOP-1]` 참조.
  🔑 **교훈: 이벤트 "이름"으로 계측 유무를 판정하지 마라.** 소스에서 실제 방출 지점을 확인하라.

### [EXIT-PERSIST-1] 마지막 행 완료 후 종료 수단이 사라진다 — `corrected` 알람이 종료 화면을 가린다
- **민구 요구(2026-07-29 제보 #4 + 확인):** *"마지막 행에서는 종료 버튼 존재. 다른 행의 입력값을
  확인하러 이동하면 그 버튼이 사라짐. 마지막 행 완료 이후 일시정지는 필요 없지만 종료 버튼은 필요함.
  가능하면 마지막 행 입력 후 종료 버튼이 상시 보였으면 좋겠음."*
  제보 본문에 *"어디서 논리 오류가 발생했는지 찾아서 내게 알릴것"* 이 직접 지시로 포함됐다.
- **🔴 논리 오류 — 세 곳이 서로 다른 플래그를 본다:**
  `VoiceScreen.tsx:87` `anomalyPending`은 status를 **본다** / `ActiveState.tsx:229` `alertVisible`은
  🔴 **status를 보지 않는다** / `ActiveState.tsx:230` `anomalyActionable`은 status를 **본다**.
  `CenterStage.tsx:48-94` 우선순위가 `paused` → `anomalyAlert` → `endReached` → `modify` → `hero`이므로,
  **`status='corrected'` 알람이 해제되지 않고 남으면 알람 분기가 종료 분기(`CompleteSummary`)를 가린다.**
  헤더 `완료` 배지(`ActiveHeaderStrip.tsx:52`)는 `endReached`만 보므로 그대로 뜬다.
- **더 나쁜 것:** `anomalyActionable`이 `status !== 'corrected'`를 요구해 알람을 닫는 `확인`/`수정`
  버튼도 동시에 사라진다(`edgeMode='nav'`) → **종료도 못 하고 알람도 못 닫는 막다른 길.**
- **검증(3중):** 로그 `trend_alert_corrected` 3건·해제 이벤트 0건·3.2초 뒤 `end_reached_waiting` /
  소스 분기 우선순위 / 제출 스크린샷의 **7개 화면 요소가 소스 예측과 전부 일치**
  (완료 배지 있음·종료 버튼 없음·2열 비교·두 값 동일 344.4·녹색 진행바·체크 도트·하단 `<` `>`).
- **한계:** 알람 잔류를 **"해제 이벤트의 부재"로 추론**했다. 부재는 약한 증거다 — 해제 로직은 있는데
  계측만 없을 가능성을 배제하지 못한다. 계측 추가(회차 SSOT §5-B·C)가 이를 확정한다.
- **민구 승인 배치안:** 하단 중앙 **도트 자리를 종료 버튼이 승계**(완료 후엔 일시정지가 불필요해 자리가 빈다).
  판정 조건을 *"지금 보는 행이 마지막인가"* → **"세션의 모든 행이 완료됐는가"**(세션 단위)로 변경.
  **오탭 방지 확인 1단계 필수**(07-27 조절판 오탭 4회 전례). 보조로 헤더 `완료` 배지·음성 "종료"도 연결.
- **현재 상태:** 🔴 **OPEN** — 구현 미착수. 다음 세션 우선순위 1번.

### [FEEDBACK-MIC-KILL-1] 개선요청 모달을 닫으면 마이크 트랙이 죽는다 (모달 닫힘 10건 중 5건)
- **실측 5/10** (모달 닫힘 전수 10건 중 사망 신호 동반 5건. ⚠️ 초안의 *"4/4"* 는 **분모 오류**였다 —
  관측된 4건만 세고 전수를 세지 않았다. 재대조에서 **09:34:51 `audio-capture` 건이 추가 발견**됐다):
  09:25:50 모달 닫힘 → `input_device_changed:refresh:track_ended` → 09:26:12
  `clip_too_small:5` / 11:47:18 → `track_ended` / 11:49:07 → 11:49:14 `clip_too_small:5` + `mic_lost` /
  11:53:11 → `track_ended` → 11:53:18 `clip_empty:after:refresh:track_ended`.
- **왜 최우선인가:** 개선요청 탭은 SOP-003이 지정한 **제보 1차 채널이자 증거 수집 경로**다.
  **제보를 남기는 행위가 다음 관측을 망가뜨린다** — 사용자가 문제를 많이 제보할수록 데이터가 나빠진다.
- **소스 후보:** `useVoiceSession.ts` `suspendRecognitionForUi()`와 그 해제 경로.
  v0.41.0 `[CLIP-WINDOW-1]` 수정(모달 진입 시 `stopClip()` 추가)의 부작용일 가능성이 높다.
- **계측 공백:** 모달↔마이크 트랙의 **인과를 말하는 이벤트가 없다**(회차 SSOT §5-G).
  5/10 시간 인접으로 추론했다. → **v0.42.0 `feedback_upload_mic`로 해소**(아래).
- 🔑 **다음 조사 축(v0.42.0 갱신):** 초안은 *"왜 5건은 죽고 5건은 멀쩡한가 — 구분 요인 미확정"*
  으로 닫았으나, 구현 회차에서 모달 닫힘 10건을 갈라보니 **판별자는 업로드 수행 여부**였다:
  실제 업로드(`feedback_uploaded`) **6건 중 5건 사망** / 취소·미로그인 큐잉 **4건 중 0건**.
  모달 길이도, 진입 시 녹음 활성 여부도 안 갈린다(클립 없이 죽은 건도, 6건 돌던 중 산 건도 있다).
  **가설:** 6.77~7.12MB zip 업로드가 메인스레드·메모리를 압박해 iOS가 오디오 트랙을 회수한다.
  ⚠️ 사망 3건이 `feedback_uploaded`와 **같은 초**에 찍혀 **초 단위로는 인과가 안 갈린다** —
  그래서 v0.42.0 계측이 **ms 경과와 zip 바이트**를 싣는다.
- **현재 상태:** 🔴 **OPEN** — 수정은 근인 확정 후. v0.42.0은 **계측만** 넣었다(민구 지시).
  근인 미확정 상태의 수정은 `[CLIP-WINDOW-1]` 반쪽 수정의 재현이 된다.

### [CENTER-POPUP-1] 입력 화면 중앙의 카드 외형 — 제보 #7

- **민구 원문(2026-07-29):** *"모든 시나리오에서 중앙에 팝업 화면 출력 되는 경우가 있는지
  **확인해서 보고하고, 각 상황 수정할지 물어볼 것.**"*
- **조사:** `CenterStage` 5분기 + `ModalBase` 실사용 10곳 + `Backdrop` 경유 7곳 전수.
  산출물 = 볼트 `Deliverables/2026-07-30-survey-011-center-popup-audit.md`.
  **입력 화면 중앙에서 "둥근 박스 카드" 외형을 가진 것은 `ModifyIndicatorPill` 하나**였다
  (`AnomalyAlertPopup`·`VoiceHero`는 이미 chrome 없이 렌더된다).
- **민구 결정:** 범위 = **입력 화면 한정** / `ModifyIndicatorPill`만 제거 /
  `CompleteSummary`의 `종료` 버튼은 **유지**(정보 출력이 아니라 **누르는 대상**) /
  설정탭·데이터탭 모달은 범위 밖.
- **당시 상태(2026-07-29):** v0.42.0에서 `borderRadius`·`border`·`boxShadow`·불투명 배경 제거.
  🔑 **`animation`(`card-breathe-*`)도 함께 제거했다** — 그 keyframes는 `box-shadow`를
  애니메이션하므로 배경·테두리만 지우면 **투명한 허공에 그림자만 호흡한다.**
  keyframes 정의는 `PausedCard`·`AnomalyAlertPopup`이 공유하므로 건드리지 않았다.
- **현재 상태:** 🟡 **MONITORING** — 데스크톱 스펙 16건 통과. **실기기에서 민구가 보고 판단해야
  종결된다**(글자만 남았을 때 배경과 대비가 충분한지는 현장 조도에서만 알 수 있다).
- **실기기 상태:** ⚠️ 미확인

### v0.42.0 계측 5건 — 판정 불가로 닫혔던 축들을 열었다

> **상태 표기:** 아래는 전부 🟡**MONITORING**이다. 계측은 코드가 아니라 **실기기 로그가**
> 값을 증명한다 — 다음 회차에서 실제로 판정에 쓰이기 전까지 RESOLVED가 아니다.
> 발화 검증은 `tests/v042-instrumentation-emit.spec.ts`(I·H는 실제 앱 경로로 단언).

| 계측 | 여는 축 | 판독 요령 |
|---|---|---|
| `beep_play` | 제보 #5 *"알람음 안 들림"* 3갈래 | `result=played`인데 안 들렸다 → 원인은 앱 밖. 🔴 `ctx=interrupted`(전화·Siri가 세션 회수)와 `ctx=suspended`(제스처 전 미개시)는 **원인이 다르다** |
| `feedback_upload_mic` | `[FEEDBACK-MIC-KILL-1]` 업로드 가설 | `phase=start`↔종료를 **같은 `bytes`로 짝지어** 읽는다. 그 사이 `track`이 `live`→`ended`면 직접 증거 |
| `bg_enter_snapshot` | `[MIC-B2]` — `no_recorder`의 원인 창 | **진입 전용.** `rec=none`이면 복귀의 `teardown=no_recorder`는 백그라운드 회수가 **아니다** |
| `orientation_change` | 회전 진동(fb-01) — 3회차 연속 판정 불가 | `to`(전환)와 `guard`(안내 표시)는 **별개 사실**. `to=landscape,guard=hidden`이면 돌렸는데 안내가 안 뜬 것 |
| `audio_route_revalidate:status=error` | 이 이벤트 0건의 정체 | 🔑 **0건이면 같은 복귀의 `foreground_return`을 먼저 보라** — `teardown=no_recorder`(레코더 없음)와 `bg_s`(임계 미달)가 대부분을 설명한다. `status=error`는 **그 둘로 설명되지 않는 침묵**이다 |

### [BEEP-NODE-LEAK-1] AudioContext가 멈춘 동안 예약한 비프 노드가 회수되지 않을 수 있다

- **어떻게 드러났나(2026-07-29, SOP-004 r1 agy Pro):** v0.42.0 계측 A가 `ctx.state`를 기록하게
  되면서 리뷰어가 짚었다. **계측이 자기 옆의 기존 결함을 드러낸 사례다.**
- **증상 가설:** `playSchedule`은 `ctx.state`가 `suspended`/`interrupted`여도 오실레이터를
  **그대로 예약한다.** 그런데 멈춘 컨텍스트에서는 `ctx.currentTime`이 흐르지 않으므로
  `osc.stop(t1+0.03)` 시점이 오지 않고 → `onended`가 불리지 않고 → `disconnect()`가 실행되지
  않는다. 그 상태에서 알람이 연달아 울리면 노드가 쌓인다.
- **당시 상태(2026-07-29):** 기존 코드의 성질이며 v0.42.0이 만든 것이 **아니다**(계측만 추가했다).
- **현재 상태:** 🔴 **OPEN — 미검증 가설.** 실기기에서 `beep_play:result=suspended`가 실제로
  몇 건 찍히는지 먼저 본다. 0건이면 이 경로는 현실에서 안 밟히는 것이고, 쌓이면 실물 문제다.
- ⛔ **이번 회차에 고치지 않은 이유:** 조기 반환(루프 진입 차단)을 넣으면 **resume 시 울릴
  소리가 사라진다** — 관측 회차에 동작을 바꾸면 다음 회차가 무엇을 보고 있는지 알 수 없게 된다.
  `[CLIP-WINDOW-1]` 반쪽 수정이 그렇게 나왔다.
- **수정 방향(다음 회차):** `suspended`/`interrupted`면 예약을 건너뛰고 `result`만 남긴다.
  ⚠️ 그 전에 *"멈춘 컨텍스트에 예약해두면 resume 후 울리는가"* 를 실기기로 확인해야 한다 —
  울린다면 조기 반환은 **기능 축소**다.

- ⚠️ **`sa_insets`가 이미 standalone 여부를 남긴다**(`device.json` 아님). 2026-07-29에 이를
  모르고 *"계측 부재"* 로 판정한 오진이 있었다(계측 J) — 범위에서 제외했다.
- 🔴 **계측을 추가하기 전에 "이미 다른 이벤트가 이 사실을 싣고 있지 않은가"를 물어라.**
  로그는 2000개 링버퍼다 — **계측을 늘리면 다른 계측이 밀려난다.** 계측 F 초안이 침묵 3갈래를
  전부 방출하려다 `[F5]` 스펙(임계 미만 무발행 = 링버퍼 보호)에 걸려 반증됐다.

### [MIC-BG-STOP-1] 앱을 이탈해도 마이크·STT가 계속 돈다
- **민구 요구(2026-07-29):** *"앱 밖으로 나가면 앱에서 사용하는 마이크는 중지되고, 앱 복귀 시 마이크
  기능이 재개되게 해줄래?"* 단서: *"사용자가 화면을 전원 버튼으로 끄고 음성 입력하는건 문제가 없어."*
  → **화면 끔은 유지, 앱 이탈만 중지.**
- **실측:** 7,058초 hidden 구간에서 `stt raw_confidence` **33건** 발생(09:39:30~10:21:17).
  민구는 그 시간 통화·타 앱 사용 중이었다. `mic_track` 이벤트는 회차 전체에 **3건뿐** —
  15초 이탈에는 `muted:vis`+`unmuted`가 찍혔으나(**OS가 꺼준 것**) **7,058초 이탈에는 전무**하다.
- **근인 ①** `speech.ts:382-403` — 워치독이 주기적으로 인식기를 부활시킨다.
  **의도적으로 `visibilitychange` 리스너를 두지 않았다**(주석 명시). 세션 활성이면 화면 상태와 무관.
- **근인 ②** *(v0.43.0 #4에서 해소 — 아래 「구현」 참조)* 당시 `useVoiceSession.ts`에는
  **백그라운드 진입 시 마이크를 중지하는 코드가 없었다.**
  `mic_track:muted`는 앱이 끈 기록이 아니라 **OS가 껐다는 것을 복귀 시 관찰한 계측**이다
  (주석: *"UA 일시 정지(통화/Siri/라우트 변경)"*).
- **영향:** 프라이버시(통화 음성이 인식 엔진으로 전송될 수 있음) · 배터리 · 오입력 위험.
  ✅ **이번 회차 실피해는 없다** — 해당 구간 value 커밋 0건·clip_saved 0건.
- **설계 제약:** ⛔ **`track.stop()` 금지** — iOS는 재획득에 사용자 제스처가 필요해(`[IOS-5]`)
  복귀 시 자동 재개가 불가능해진다. **`track.enabled` 토글**을 쓴다.
- **🔴 선행 검증 필수였던 것 → 민구 지시로 해소:** 화면 끔과 앱 이탈은 웹에서 **둘 다 `hidden`**이다.
  구분 기반은 있으나(`App.tsx` `awaySignals` = blur/pagehide/freeze, 로그 `evidence=blur`)
  plan §3-1 재분석 결과 `visibility_context` **11건이 전부 `evidence=blur`** 라 실측으로 갈리지
  않았다. → 민구 지시로 **구분하지 않고 둘 다 비활성화**한다(화면 끔도 중지 대상이 됐다).
  ⚠️ 원 단서(*"전원 버튼으로 화면 끄고 입력하는 건 문제없다"*)와 **다른 선택**이다.
  실기기에서 화면 끄고 입력하는 사용감이 나빠지면 이 결정부터 다시 본다.
- **구현 (v0.43.0 #4, 2026-07-31):**
  - `src/App.tsx` `onVis` — `visibilitychange`의 유일한 호출자.
    `hidden` → `suspendForBackground()` · `visible` → `resumeFromBackground()`.
  - `src/lib/useVoiceSession.ts` `suspendForBackground`/`resumeFromBackground` —
    🔴 **순서가 계약이다.** 진입은 suspend(STT·클립) **먼저**, 그 다음 캡처 off.
    뒤집으면 진행 중 클립이 **무음으로 채워진 채** 닫혀 `clip_too_small`/`clip_empty`가 재발한다.
    복귀는 그 역순(캡처 on 먼저 → STT 복원). 캡처 복구는 **무조건** 돈다.
  - `src/lib/audioRecorder.ts` `setCaptureEnabled` — **`track.enabled` 토글.**
    설계 제약대로 `track.stop()`은 쓰지 않았다.
  - 복귀 안내(*"자리를 비운 동안 입력이 중지됐습니다. 다시 시작합니다."*)는 복원된 인식기의
    `onStart`에 **one-shot**으로 건다 — "시도"가 아니라 "재개 성공"에 건다(`[MIC-B2]` 전례).
  - 계측 `bg_mic`(`logEvents.ts` `bgMicAction`) — `edge`/`stt`/`capture` 3축.
    `stt` 축의 의미 오염은 리뷰 지적으로 같은 날 후속 수정했다(`9603d77`).
  - 자동화 범위: `tests/v043-background-mic.spec.ts` A~F 6건 + `v037-suspend-latch` F/G.
- **🔴 남은 실기기 확인 (iOS Safari, `docs/REAL-DEVICE-TEST.md` 절차):**
  데스크톱 mock으로는 판정 불가다. ⛔ **아래를 통과하기 전에는 `RESOLVED`로 올리지 마라.**
  1. 복귀 후 캡처·STT가 실제로 재개되고 안내 TTS가 **1회** 들리는가.
  2. `bg_mic:return` → `lifecycle:start` → 첫 `raw_confidence`/`value`가 이어지는가
     (`[MIC-B2]`: 복귀 32.5초 뒤 지연 `audio-capture` 오류 전례 — `onStart` 뒤를 함께 봐야 한다).
  3. 짧은 왕복 / 긴 백그라운드 / **화면 잠금** / 앱 이탈 4갈래.
  4. 이탈 구간에 `raw_confidence` 0건 · `clip_too_small`/`clip_empty` 0건인가.
- **당시 상태(2026-07-29):** 🔴 OPEN — 우선순위 4번, 착수 전. 백그라운드 중지 코드 자체가 없었다.
- **🔑 v0.45.0 [D1] 재검토 실행 (2026-08-05) — 위 "이 결정부터 다시 본다" 갈래가 실행됐다.**
  민구 정정(08-05): *"세션이 진행중엔 음성 입력 출력 모두 가능하게. 세션 종료 이후에도 작동했다는 게
  문제였을 뿐."* — 원 요구의 의도는 **"세션 밖에서 돌지 마라"**였고, v0.43.0 #4는 세션 **안**까지
  정지한 **과잉 교정**으로 판정됐다(그 정지가 만든 복귀 왕복 = F15 "한 번에 안 붙어"의 구조적 근원
  후보 — 08-05 세션7 실측 6회). 새 정책 = **세션-활성 게이트**:
  - 세션 중(`active`·`paused`·`complete`) hidden → **유지**(`bg_mic:stt=kept`). 배경 발화 커밋이
    이제 **정상 동작**이다(화면 끄고 진행 — 이 항목의 "실측" 절이 결함으로 기록한 형태와 같지만,
    **세션 중**이라는 조건이 다르다. 세션 밖 33건 유입이 원 결함이었고 그 축은 계속 정지다).
  - 세션 밖(`ready`·`stopping`) → 종전 정지 경로 그대로(이 항목의 원 처방 유지).
  - 장기 임계 **10분**(Q2 민구 확정) → 고지+알림+저장+완전 정지(dispose = preroll 선-정리) +
    복귀 자동 재획득. 경계 SSOT: `src/lib/backgroundSessionPolicy.ts`.
  - 자동화: `tests/v043-background-mic.spec.ts`(A'~F' — v0.43.0 오라클 A·B·C·F의 **의도적
    뒤집기**) + `tests/v045-bg-gate.spec.ts`(P·T·R·Q3). 위 "남은 실기기 확인" 4항목 중
    1·2는 **게이트 도입으로 시나리오가 바뀌었다** — 새 실기기 확인 축은 v0.45.0 회차 SSOT의
    시나리오 표(화면끔 1·3·10분 발화 인식 / 화면끔 중 TTS 가청 / 세션 종료 후 인디케이터 소등 /
    `mic_init_failed` 재발 관찰)를 따른다.
- **현재 상태:** 🟡 **MONITORING** — v0.45.0 [D1] 게이트로 정책 교체·데스크톱 자동화 완료.
  iOS 실기기 판정 대기(위 v0.45.0 시나리오 축).
- **실기기 상태:** ⚠️ **미확인** — 새 시나리오 축을 통과하기 전에는 `RESOLVED` 금지.

### [BT-STT-1] 블루투스 입력 시 음성 인식이 되지 않는다
- **민구 진술(2026-07-29):** *"첫 세션은 블루투스로 시작했는데 음성 인식이 되질 않아서 스피커폰으로
  전환 후 정상 입력됨을 확인했다. 이후 스피커폰/블루투스를 몇 번 오갔다. 보통 블루투스로 입력하려다
  인식이 안 되면 스피커폰으로 전환하는 형태가 많았다."*
- **로그 근거:** `recover:user_gesture:내장 마이크→블루투스`(09:22:28) →
  `refresh:device_gone:블루투스→내장 마이크`(09:22:28) → `track_ended:블루투스→내장 마이크`(09:25:51).
  회차 전체 `audio-capture` 오류 5건·`clip_too_small` 3건·`mic_lost` 4건·`clip_empty` 1건.
- **계측 공백:** `device.json`의 `audioInputDevices`에 **`iPhone 마이크` 1개만** 열거됐다 —
  블루투스가 없다. 세션 시작 시점 스냅샷이라 이후 연결분이 빠졌거나 권한 문제로 라벨이 안 나온 것.
- **실체:** 매번 **수동 전환이 필요했다**는 것이 결함이다. 자동 폴백이 없다.
- **현재 상태:** 🔴 **OPEN** — 우선순위 7번. 원인 미확정.

### [CLIP-WINDOW-2] 모달 진입 후 신규 녹음창이 즉시 열린다
- **실측:** `ui_suspend` → **+17~18ms**에 `clip_started`. 그 신규 창이 모달 구간을 **100% 덮는다.**
  A: 모달 145.064s / 신규 창 **154.319s** / 커버 100.0% (파일 154.827초로 저장됨) ·
  B: 모달 64.554s / 신규 창 64.550s / 커버 100.0% (`clip_saved` 미발생 → 파일 없음).
- **v0.41.0이 고친 것과의 관계:** `e7595b2`는 **"기존 창 종료"**를 고쳤고(501~503ms, 4/4 작동)
  **"신규 창 개시 차단"**은 다루지 않았다.
- **🔑 판독 교훈:** 세션 B 건은 파일이 생성되지 않아 **파일 분포만 봤다면 통째로 놓쳤다.**
  파일 축과 계측 축을 반드시 함께 본다.
- **부수 실측:** 클립 확장자 **혼재** — wav 131 + webm 22(webm은 전부 `:raw`, opus/48kHz/mono).
  단일 확장자를 가정하면 22개를 놓친다. webm은 컨테이너에 duration이 없어 `ffprobe`가 `N/A`를 반환한다.
- **현재 상태:** 🔴 **OPEN** — 우선순위 3번.

## 2026-07-31 v0.42.0 후속 조사 (실기기 회차 아님 — 테스트 인프라)

### [TEST-CLIP-F-1] `v037-suspend-latch.spec.ts` F가 **신설된 순간부터 red**였다
- **증상:** `tests/v037-suspend-latch.spec.ts:315` F 케이스가 350행에서 실패한다.
  `expect(clipStartAttemptCount).toBe(startsBeforeResume + 1)` → **Expected 5, Received 4.**
  새 세션에서 feedback resume 후 **재무장이 한 번도 일어나지 않는다.**
- **🔑 3방향 재현 — 100%다. flake가 아니다.**
  | 조건 | 결과 |
  |---|---|
  | 파일 전체 `--workers=1` | ❌ 실패 (5 passed / 1 failed) |
  | **F 단독** `--grep` | ❌ 실패 → **테스트 간 순서 의존 기각** |
  | **신설 커밋 `90b0f1d` worktree** | ❌ 실패 → **코드 회귀 아님** |
- **환경도 통제했다:** `node_modules` mtime 07-21 · `package-lock.json` 07-20 ·
  `@playwright/test` 명세 `^1.60.0` 동일 · `.env.local` 05-14.
  **07-29 17:17(신설 시점) 이후 의존성 환경이 움직이지 않았다.**
  → worktree 실험이 코드만 통제하고 환경은 못 통제한다는 약점이 여기서는 성립하지 않는다.
- 🔴 **그래서 직전 세션(`90b0f1d`)의 "914 passed 양방향 통과" 기록은 틀렸다.**
  그 세션이 이 스펙을 신설하면서 **red인 채로 커밋했다.** 전체 스위트를 안 돌렸거나(`[ORCH-43]`),
  돌리고도 결과를 확인하지 않은 것이다. `HANDOFF.md`의 *"환경 의존 또는 순서 의존 의심"*도 틀렸다.
- **디버그 로그(재무장 직전 25건):**
  `feedback_open:tab=voice` → `feedback_modal` → `clip_arm_blocked:reason=feedback_modal,row=1,col=c8`
  → `lifecycle:start` → `feedback_modal`. **c8이 pending에 들어갔는데 resume에서 복원되지 않는다.**
- **미확정 — 둘 중 어느 쪽인지 아직 모른다:**
  ⑴ **앱 결함**: `clearUiSuspendLatch`가 c9 pending은 지웠지만 새 세션 c8 pending의
     복원 경로가 실제로 끊겨 있다 → 테스트가 옳고 코드가 틀렸다
  ⑵ **테스트 결함**: 기대값 `+1`이 이 시나리오에서 성립하지 않는다 (테스트가 처음부터 잘못 쓰였다)
  🔴 **가리기 전에는 고치지 않는다.** 테스트를 기대값에 맞춰 고치면 ⑴일 때 진짜 결함을 덮는다.
- **영향:** 릴리스 게이트 숫자가 오보였다. `HANDOFF.md`의 *"924 tests · 병렬 924/0 · 직렬 924/0
  양방향 완전 green"*은 성립할 수 없다 — 이 테스트가 그 시점에도 실패하고 있었다.
- 🟢 **실측 baseline (2026-07-31, `--workers=1` 단독 실행 30.9분):**
  **923 passed / 1 failed / 924 실행.** 실패는 **이 F 하나뿐**이다 — 숨은 실패가 없다.
  → **다음 회차의 판정 기준은 `923/1`이다.** 패치 후 이 숫자가 유지되면 회귀 없음.
- **현재 상태:** 🟡 **판정 완료·원인 미확정.** 다음 회차가 ⑴/⑵를 가린다.
  **실기기 패치의 전제 조건은 충족됐다** — 이 실패가 새 변경 탓이 아님이 증명됐으므로,
  패치 후 이 1건이 남아 있어도 판정을 오염시키지 않는다.

#### 🔴 원인 확정 (2026-07-31, 검증 레인) — **⑴ 앱 결함이다. 테스트의 단언 `+1`은 옳았다**

**`start()`가 UI suspend 래치를 존중하지 않는다**(`src/lib/useVoiceSession.ts:2525-2531`). 세션 시작
TTS 구간(`:2522-2523`)에 오버레이가 열리면 **모달 뒤에서 STT 인식기가 새로 생성·기동된다.** 결과는
둘이다 — ⓐ `hadController`가 `false`로 스냅샷돼(`:1323`) resume의 `shouldRestore`가 죽고(`:2326-2334`)
**재무장 0** → F가 red. ⓑ **모달이 열린 채 배경 발화가 셀에 커밋된다** — 같은 스펙 A의 오라클
(`:203-205`)과 이 파일 헤더(`:1-7`)의 보호 대상(*발화 유실/오커밋 — 데이터무결성*)을 정면 위반한다.
최소 재현 로그: `ui_suspend:feedback_modal` → `clip_arm_blocked` → **`lifecycle:start`** →
**`value parsed=33.3 row=1 col=c8`**. 개선요청 나비는 상시 탭 가능하고(`src/stores/sessionStore.ts:85`)
실기기 시작 TTS는 수 초라 **현장 도달 가능한 창**이다.
- **`5`와 `4`의 정체:** 4 = 세션1의 무장 4건(`clip_no_stream` ×4, 전부 좌표 미포함 —
  `audioRecorder.ts:672`). 빠진 무장은 **둘**이다 — 세션2 `start()`의 r1c8 무장이
  `clip_arm_blocked:reason=feedback_modal,row=1,col=c8`으로 대체돼 `startsBeforeResume`이 5가 아닌 **4**로
  읽혔고, resume 복원 무장도 무발생. 건강한 경로는 **5 → 6**이다.
  `expect.poll`의 Received는 **마지막 폴링 값**이므로(Playwright 1.61.0 `invokePollMatcher`) IDB flush
  지연 가설은 성립하지 않는다.
- **반증 양방향 완료:** **테스트를 한 글자도 고치지 않고** `:2525`에 래치 가드만 넣자
  `--workers=1`에서 **6 passed (F 포함, A~E 회귀 없음)**. 가드를 빼면 다시 red. 병렬·직렬 모두 F만 red.
- 🔴 **테스트만 고쳐 green으로 만들면 안 되는 이유가 하나 더 있다:** 앱 수정 + `clearUiSuspendLatch`의
  pending 폐기(`:1304` — `uiBlockedClipArmRef` 한 줄, 위 `:1303`은 미측정)를 **고의로 제거**하고
  돌리면 **원본 F는 통과한다.** 대기 없는 경로에서는
  세션2 자신의 차단된 무장이 `uiBlockedClipArmRef`를 덮어써 `:2330-2331`의 `??`가 stale 슬롯까지
  내려가지 않기 때문이다. **F는 신설 이후 자기 주제(stale pending 폐기)를 단 한 번도 검사한 적이 없다.**
  세션2 진입에 무장 완료 대기를 넣어야 비로소 검사한다(넣으면 위 파손을 잡아낸다 — 실측).
- **수정안(집행 전, 승인 필요):** ① `start()` 래치 가드(필수) ② F의 세션2 진입에 무장 완료 대기
  (`:344` 뒤) ③ 오커밋 결함 전용 회귀 G 신설 — F는 ②를 넣는 순간 이 결함을 **못 잡게 된다**
  ④ 🔴 **v0.43.0 #4가 `App.tsx`(현재 `:95-156`은 계측만)에 백그라운드 suspend를 배선하면 같은 구멍을
  물려받는다** — ①을 #4보다 먼저 넣기를 권한다.
- **판정 기준 갱신:** `923/1`의 그 1건은 *원인 미확정 잔여 실패*가 아니라 **미수정 앱 결함의 지표**다.
  ①이 들어가면 **924/0**이어야 한다. STT 생명주기 변경이므로 실기기 판정 전까지 `MONITORING`
  (`CLAUDE.md` 계약 4, `docs/REAL-DEVICE-TEST.md`).
- **전문:** `~/workspace_teamops/deliverables/2026-07-31-survey-011-test-clip-f-1-verdict.md`

## 2026-07-31 v0.43.0 코더 레인 관측 (실기기 회차 아님)

### [UI-FLEX-FIT-1] flex 자식의 `overflow: hidden`이 fit 높이 판정을 무력화할 수 있음

- **카테고리:** 빌드·테스트 / 테스트 함정
- **상태:** `GUARDED` (회귀 테스트 있음)
- **관측:** VoiceHero 확인 화면에서 항목명 폰트는 커졌지만, `overflow: hidden`인 flex 자식의
  자동 최소 높이가 0으로 내려가 375px 폭에서 실제 박스 높이는 0px가 됐다. 컨테이너의
  `scrollHeight <= clientHeight`만 보던 fit 판정은 이를 overflow 없음으로 오인했다.
- **대응:** 항목명은 `flex-shrink: 0`과 별도 예약 비율로 높이를 보전한다. 회귀 테스트는 폰트
  크기만 보지 않고 `offsetHeight / fontSize >= 0.9`라는 하한도 함께 검사한다. 이 하한은
  잘린 큰 글씨가 다시 통과하는 것을 막으며, 글자 크기의 상한으로 사용하지 않는다.

### [TEST-PARALLEL-CLIP-1] 병렬 워커 경합에서 클립 타이밍 spec 5건이 간헐 실패 — 직렬이면 통과

- **카테고리:** 빌드·테스트 / 테스트 함정
- **상태:** `OBSERVED` (원인 확정, 앱 결함 아님)
- **관측:** v0.43.0 최종 게이트 1(전체 스위트, 기본 workers) — `978 passed / 5 failed`.
  실패는 전부 **실시간 타이밍에 의존하는 클립·TTS spec**이었다:
  `clip-modify-rerecord:318 · :413 · :455` · `clip-postroll:214` · `decimal-targeted-reask:238`.
- **재판정(같은 커밋, 부하 더 높은 시점):** 그 3개 파일 + `nav-unidirectional`을 **단독
  `--workers=1`** 로 돌려 **20/20 통과**. load 4.43 → 3.50 구간이었다.
- 🔑 **판별자는 절대 부하가 아니라 워커 경합이다.** load 4.43에서도 직렬이면 통과했고,
  병렬은 load 2.31에서 시작해 8.41까지 올랐다. 앞 세션이 `clip-postroll:214`의 실패 근거로
  댄 "load 2.4~3.9"는 **상관이지 인과가 아니었다** — 진짜 축은 동시 워커 수다.
- **대응:** 이 5건은 `--workers=1` 결과를 판정 기준으로 쓴다. 병렬 결과만으로 회귀를
  선언하지 마라(`CLAUDE.md` 30초 체크의 *"격리 통과 = flake를 양방향으로 쓰지 마라"* 의
  반대 방향 사례 — 여기서는 **병렬 실패가 결함이 아니다**).
- ⚠️ **`decimal-targeted-reask:238`은 사정권 오해를 부른다.** v0.43.0 #3-2가 파서 실패
  사유를 건드렸으므로 이 실패는 회귀로 읽히기 쉽다. 실제 실패 지점은 `:244`
  (`fireStt(..., 400)` 직후 TTS 로그 확인)로 **파싱 판정 이전**이고, `koreanNum.spec`의
  `decimal_fraction_lost` 단언 14곳은 전부 green이다.

### [SIZE-USEVOICESESSION-1] `useVoiceSession.ts`가 v0.43.0에서 다시 커졌다 — 3485줄

- **카테고리:** 빌드·테스트 / 설계 부채
- **상태:** `OPEN` (인지·기록. 이번 회차 분리는 하지 않았다)
- GL-006 §5 기준(권장 150~250 · 300 분리 검토 · **500 리팩토링**)을 한참 넘는다.
- v0.43.0 #3에서 파싱 판정을 `src/lib/valueParseAttempt.ts`로 **분리**했으나(약 −60줄),
  #4가 백그라운드 마이크 배선으로 **+109줄**을 다시 넣어 순증했다.
- **왜 이번에 분리하지 않았나:** #4의 추가분은 `suspendRecognitionForUi`/
  `resumeRecognitionForUi`/`clearUiSuspendLatch` **세 콜백의 래치 상태와 강결합**이라,
  떼어내려면 래치(`uiSuspendRef`)를 통째로 옮겨야 한다. v0.43.0 UI 재설계 레인이 같은
  파일군을 동시에 만지고 있어(브리핑 §7) 그 규모의 이동은 충돌을 만든다.
- **다음 분리 후보:** 래치 + 백그라운드 마이크 일체를 `useUiSuspendLatch`(가칭)로.
  UI 레인 병합 이후에 착수하는 것이 안전하다.

### [UI-PROGRESS-COMPLETE-1] 진행바 3톤 통일 뒤 normal/completing의 별도 시각 구분 필요성 미판정

- **카테고리:** 입력 흐름 · UI-e 착수 조건
- **상태:** `OPEN` (UI-e에서 필요성부터 판정)
- **관측(2026-08-01, 402×874 실렌더):** UI-d가 상태색 3톤을 집행하면서 정상 진행바의
  `T.blue`를 `T.green`으로 통일했다. 일반 `completing` 화면은 중앙에 방금 값을 표시하지만
  도트는 normal과 같은 `mic`, 상태 컨트롤도 `listening`, 톤도 green이다. 따라서 진행바 색만으로
  normal/completing을 가르던 채널은 사라진다.
- **정밀화:** confirm과 completing 자체는 화면상 갈린다. confirm은 중앙에 **항목명+값**이 남고
  활성 칩은 다음 항목으로 이동하지만, 일반 completing은 중앙에 **값만** 남고 활성 칩이 그 항목을
  가리킨다. 즉 UI-e의 질문은 “confirm과 구분되는가”가 아니라 **“normal과 completing의 별도
  시각 구분이 실제로 필요한가”** 다.
- **금지 대안:** `StateDots`의 `check`를 completing에 재사용하지 마라. `check`는
  `endReached`(세션 전체 완료)와 ui-standard §3-5에 이미 배정돼 있어, 재사용하면 행 완료와 세션
  완료가 같은 문양이 된다(GL-007 원칙 1: 한 채널의 의미를 뒤집지 않는다).
- **UI-e 착수 조건:** 먼저 별도 구분의 사용자 가치가 있는지 판정한다. 필요하면 `check` 재사용이나
  3톤 밖의 새 색이 아닌 문양·형태·모션 채널을 화면 6종 사양 안에서 설계하고 화면 실측한다.
- **현재 조치:** UI-d는 `progressAccent = anomaly ? red : paused ? amber : green`까지만 집행한다.
  UI-e 전 단계들은 push·배포되지 않으므로 중간 상태가 사용자에게 도달하지 않는다.

### [UI-DOT-ELLIPSE-1] 짧은 화면에서 도트가 원형 계약을 깬다 — 밴드 < ~150px에서 skew 1.113 타원

- **카테고리:** 입력 흐름 · UI (도트 격자)
- **상태:** `OPEN` (등재만 — v0.46.1에서 **의도적으로 고치지 않았다**, 민구 지시 08-07)
- **FB-5와의 관계:** 🔴 **별건이다.** FB-5(「도트 애니메이션 잘림」)의 실체는 접힌 조절판 필의
  **가림**이고 그건 별도로 처방한다. 이 항목은 같은 화면에서 함께 관측된 **다른** 결함이다.
- **관측(2026-08-07 · 402×513 실기기 뷰포트, `_probe-out/fb5/`):**

  | 축 | 402×874 | 402×513 |
  |---|---|---|
  | 행 피치 | 12px | **5px** |
  | 열 피치 | 10.72px | 10.72px (불변) |
  | 도트 computed | 7.7 × 7.7 | **4 × 3.59** |
  | **skew (w/h)** | **1.000** | **1.113** |
  | 세로 이웃 간격 | 4.30px | **1.41px** |
  | 가로 이웃 간격 | 3.02px | **6.72px** |

  세로로는 이웃 도트가 거의 붙고(1.41px 간격에 glow blur 4px) 가로로는 6.72px 떨어져
  **비등방이 4.8배**다. 대각선 획(`check`)이 계단처럼 끊겨 보인다.
- **기제:** `StateDots.tsx`의 셀이 **두 축을 서로 다른 기준으로 제한**한다 —
  `width: min(${dot}px, 72%)`의 72%는 **열 피치** 기준, `maxHeight: '72%'`의 72%는 **행 피치**
  기준이고 `aspectRatio: '1 / 1'`은 둘 중 하나만 만족시킬 수 있다.
  **행 피치 < 열 피치가 되는 순간 `maxHeight`가 `aspectRatio`를 이겨 타원이 된다.**
  임계는 `size/FIELD_ROWS < (2/3 × 폭)/FIELD_COLS`, 402폭에서 **밴드 높이 ≈ 150px 미만**.
  874는 174.8px로 겨우 넘고 513은 80.8px로 한참 아래다.
- 🔴 **기준 주석 반증:** `StateDots.tsx:166-167`의 *"도트 자체는 원형을 유지한다(ui-standard
  §3-1)"* 는 **402×874에서만 참**이다. 실측이 반증했다.
- 🔴 **오라클 구멍:** 원형 계약을 재는 `v034-wave-glow`의 `maxDotSkew`가 **402×874에서만 돈다.**
  겹침을 재는 `v0460-g-dot-pill`도 5개 테스트 전부 402×874 단일 뷰포트다 — **짧은 화면 회귀를
  구조적으로 못 잡는 구멍이 뷰포트 축에 남아 있다.**
- **[UI-DOT-SHORT-BAND-1]과 같은 임계에서 나온다:** 밴드 ≈150px 미만이라는 조건은 FB-5 가림의
  임계(`RESERVED_ROWS × 행피치 < 필 42px` → 밴드 ≈147px)와 **사실상 같은 지점**이다.
  근본은 하나 — 짧은 화면에서 하단 밴드에 배정된 픽셀이 격자 설계 전제를 밑돈다.
- **고칠 때 주의:** 두 축 중 **작은 쪽 피치**로 지름을 한 번에 산출해야 한다(예:
  `0.72 × min(행피치, 열피치)`). 열 피치는 격자 폭(`min(66.6667vw, 100%)`)에서 나오므로
  런타임 측정이 필요하다. **반올림하지 말 것** — 소수를 유지해야 402×874에서 현재 7.72px와
  픽셀 단위로 같아 발광 면적 계약(§3-D)이 중립으로 남는다.

## 2026-08-07 v0.46.1 레인 V 관측 (FB-11 검증)

### [TEST-MANUAL-CHIP-1] `manual-input.spec.ts` 3건이 부하 민감 flaky — 실패 항목이 실행마다 바뀐다

- **카테고리:** 빌드·테스트 / 테스트 함정
- **상태:** `OPEN` (원인 미규명 — 증상과 판정 절차만 확인)
- **대상:** `tests/manual-input.spec.ts`의
  「options 그리드 — 선택지 버튼 탭 즉시 커밋」 ·
  「검토 대기(항목2)와 상호작용」 ·
  「[리뷰 High] manualHold 지연 put 중 즉시 [확인]」
- **증상:** 셋 다 **같은 지점**에서 죽는다 — `waitForActiveChip(page, '횡경')`
  (`manual-input.spec.ts:147`) 5s 타임아웃. 활성 칩이 다음 항목으로 안 넘어간다.
- 🔴 **회귀로 읽지 마라 — 실패 항목이 실행마다 바뀐다.** 08-07 실측 A/B:

  | 실행 조건 | options 그리드 | 검토 대기(항목2) | manualHold 지연 put |
  |---|---|---|---|
  | `6d69165` 베이스라인, `--grep` 3건 | 🔴 32.0s | 🟢 34.5s | 🟢 12.6s |
  | `53f543e`, `--grep` 3건 (동일 조건) | 🟢 32.8s | 🟢 29.9s | 🔴 21.3s |
  | `53f543e`, 4스펙 24테스트 전량 | 🔴 | 🔴 | 🔴 |

  👉 ① **코드 변경 없이도 red**가 난다 ② **실패 항목이 교체된다** = 결정론적 회귀가 아니다
  ③ **부하에 비례**한다(24테스트 3건 / 3테스트 1건).
- **판정 절차(다음 사람):** red를 보면 **`--grep`으로 그 3건만 좁혀 A/B부터 하라.**
  전량에서만 보고 판단하면 자기 변경의 회귀로 오인한다. `CLAUDE.md` §30초 체크의
  *"「격리 통과 = flake」를 양방향으로 쓰지 마라"* 가 그대로 걸리는 자리다.
- **왜 안 보였나:** 게이트 9파일에 `manual-input.spec.ts`가 **없다** — 배포마다 안 돈다.
- **주의:** 이 스펙은 자체 컬럼 설정에 **「횡경」**을 쓴다. `fixtures/activeZones.ts`
  (`측정항목01`~`12`)와 **다른 픽스처**다 — 셀렉터를 여기서 복사해 가면 저쪽에서 안 잡힌다
  (08-07에 `_probe-fb11-manual-display.spec.ts`가 정확히 그래서 3분 타임아웃 ×3으로 죽었다).

### [TEST-FIXTURE-TYPE-1] `fixtures/activeZones.ts`의 컬럼이 전부 `float` — 타입 분기가 안 밟힌다

- **카테고리:** 빌드·테스트 / 테스트 함정
- **상태:** `OPEN` (미수정 — 이번 회차는 개별 처방으로만 우회)
- **관측:** 이 픽스처의 측정 컬럼은 `측정항목01`~`12`가 **모두 `type:'float'`**이다.
  그래서 `ManualValueSheet`의 **`isKeypad === false` 분기**(text·date·options 컬럼에서
  현재값을 그리는 경로)를 **레이아웃 축으로는 한 번도 재지 않는다.**
- **사건:** 08-07 FB-11 처방에서 그 분기의 `margin-top: auto`를 빠뜨렸는데, 3뷰포트 ×
  6시퀀스 = **18행 실측이 전혀 못 잡았다**(리뷰에서 발견 → `53f543e`).
  ⚠️ 정확히 하자면 `manual-input.spec.ts`의 「options 그리드」가 그 분기를 **렌더는 한다** —
  다만 **위치를 단언하는 스펙이 없어서** 정렬이 바뀌어도 통과한다.
- 🔴 **§시트 불특정 계약과 충돌한다.** 민구 08-05: *"하나의 시트를 기준으로 정하진 말아줘."*
  컬럼 **타입**을 한 종류로 고정한 픽스처는 그 계약을 검증할 수 없다.
- **대응(미수행):** 픽스처에 `text`·`date`·options 컬럼을 섞는다. 다만 이 픽스처를 쓰는
  스펙이 많아(v039 우측끝 6단언 · 72조합 스윕 · 프리뷰 캡처 등) **컬럼 개수·순서를 바꾸면
  그쪽이 흔들린다** — 별도 픽스처를 추가하는 쪽이 안전할 수 있다. **다음 회차 과제.**

## 2026-08-09 v0.47.0-r3 수정 라운드 관측 (이중 콜드 리뷰 후속 · 회차 SSOT: `workspace_teamops/deliverables/2026-08-09-survey-011-v0470-r2-review-union.md`)

### [UI-BLACKOUT-CAPTURE-1] wake 홀드의 iOS 암묵 포인터 캡처 방어 — 실기기 판정 전 MONITORING

- **카테고리:** UI / iOS 실기기 축
- **상태:** `MONITORING` (방어 코드는 들어감 — 실기기 확인 전 RESOLVED 금지)
- **관측(콜드 리뷰 claude §2):** Pointer Events 스펙상 터치 포인터는 `pointerdown` 타깃에
  **암묵 캡처**가 자동으로 걸려, `beginHold`의 "나가면 `pointerleave`가 취소한다" 설계가
  iOS 실기기에서 무효일 개연. 데스크톱 Playwright는 마우스라 이 축을 **재지 못한다.**
- **대응(r3 · `ccab4c8`):** `beginHold`에 `releasePointerCapture` 방어 1줄 — 경계 이벤트 복원.
  오라클은 강제하지 않았다(데스크톱으로 못 재는 축).
- **실기기 확인 절차(다음 실기기 회차):** 중앙 홀드 시작 → 1초 내 손가락을 가장자리로 끌고
  유지 → 게이지가 **멈추면** 해소 확정, 계속 차서 켜지면 재발(절차 상세는 `BlackoutOverlay.tsx`
  beginHold 주석).

### [TEST-W7-TIMING-1] w7 ⑦·⑧-b 1회 실패 후 재현 불가 — 타이밍 창 스펙의 부하 민감 개연

- **카테고리:** 빌드·테스트 / flake 의심
- **상태:** `OPEN` (기록만 — 판정 미확정)
- **관측(r3 레인 B′):** `v0470-w7-hold-blackout` ⑦(reduced-motion)·⑧-b(장기 홀드 차단막)가
  1회차 실행에서 각 1회 실패 후 같은 조건 재실행 2회 연속 green(5182 · workers=1).
- **판정 절차(다음 사람):** red를 보면 [TEST-MANUAL-CHIP-1]과 같은 절차 — `--grep`으로
  그 2건만 좁혀 A/B부터. 전량에서만 보고 자기 변경의 회귀로 오인하지 마라.

## 2026-08-12 v0.49 P-1 (회차 SSOT: `workspace_teamops/deliverables/2026-08-12-patchA-watchdog.md`)

### [TTS-WATCHDOG-1] TTS 워치독이 `onstart` 이후에도 안 풀려 **정상 발화를 상시 절단** — 30자+ 발화 100%

- **카테고리:** ③ iOS/TTS
- **상태:** `MONITORING` (처방 `1f52295` 들어감 — **실기기 확인 전 RESOLVED 금지**)
- **관측(08-12 실기기 iOS 26.6, 10.1분, tts 161건):** `tts_watchdog_fired:started=yes,ms=2500±6`
  **15건**. 글자수별 워치독율이 **1-9자 0/95(0%) → 25-29자 6/9 → 30자+ 7/7(100%)** 로 단조
  증가하고, 15건 **전원의 `startDelayMs`가 정상**(2~628ms · 전체 p50=106)이었다.
  즉 **시작 실패가 아니라 재생이 안 끝난 것**이다. 잘린 것은 전부 안내·재질문 문구
  ("입력이 끝났습니다. 종료하려면…" 42자 등).
- **기전:** `TTS_WATCHDOG_MS`가 `enqueuedAt`에 걸린 채 `onstart` 이후에도 풀리지 않아
  설계 의도(시작 감시)와 달리 **「발화 전체 시간 상한 2.5초」**로 동작했다.
  `done()`이 `unmuteForTts()`를 부르므로 **TTS 재생 중 STT가 열리고**, 다음 발화의
  `interrupt:true`가 재생 중인 문장을 `cancel()`로 끊는다.
- ⚠️ **"종료사유 미수신"이 아니다.** `u.onerror`는 이미 듣고 있었고 Web Speech utterance에
  `oncancel`은 **존재하지 않는다**(cancel은 onend/onerror로 나온다). 추가할 이벤트가 없다.
- **대응(`1f52295`):** 값이 아니라 **앵커를 옮겼다** — 1단(enqueue 기준 2.5초 = `onstart`
  미도착 감시, FB-3 방어선)은 그대로, `onstart`에서 2단(**onstart 기준** 길이비례 상한)으로
  재무장. 워치독은 안전망으로 유지. 오라클 `tests/v049-p1-tts-watchdog.spec.ts` 4케이스.
- 🔴 **UNCLEAR:** 「onend가 늦게 온다」와 「끝내 안 온다」는 이 로그로 **가릴 수 없다**
  (워치독이 2.5초에 관측을 잘라 그 뒤 기록이 없다). → `tts_late_end` 계측을 신설했다.
- **실기기 확인 절차(다음 회차):** ① `tts_watchdog_fired`의 `stage=end` 건수(0이 이상적)
  ② `tts_late_end` 유무 → 위 UNCLEAR 판정 ③ 30자+ 안내가 **끝까지 재생되는지 민구 청취.**

### [TEST-SPEECH-SYNTH-1] 모듈 상수 `synth`가 import 시점에 굳어 **speak() 경로에 오라클을 둘 수 없었다**

- **카테고리:** ⑨ 테스트 함정
- **상태:** `RESOLVED` (`1f52295` — 다만 **같은 형태의 모듈 상수는 어디서든 재발한다**)
- **관측:** `speech.ts`의 `const synth = typeof window !== 'undefined' ? window.speechSynthesis : null`
  는 **import 시점**에 고정된다. 테스트의 `window` shim은 구조적으로 그보다 늦다 —
  **같은 워커에서 다른 spec이 `speech.ts`를 먼저 import하면 끝이다.**
  그 탓에 TTS 발화 경로를 지키는 스펙이 **0개**였고, 그 눈먼 축에서 [TTS-WATCHDOG-1]이 살아남았다.
- 🔴 **증상이 「flake」로 위장한다.** 신규 스펙 ①이 **단독 4.1s green** → `speech-lifecycle`과
  같이 돌리자 **504ms fail**이었다. `synth`가 null이면 `speak()`가 **즉시 return**하므로
  단언이 그냥 통과하거나 시간만 안 맞는다 — `[TEAMOPS-27]`의 역방향이고, 방치하면
  전체 스위트에서 **green으로 보이는 무판정**(`[TEAMOPS-64]`)이 된다.
- **대응:** `speak()` 안에서 engine을 **호출 시점에 재평가**(실브라우저 동작 무변화).
- 👉 **다음 사람에게:** 모듈 스코프에서 `window.*`를 상수로 잡은 코드에 오라클을 붙일 때는
  **스펙 순서를 양방향으로 돌려라**(정순·역순). 한 방향만 green인 것은 통과가 아니다.

---

## 2026-08-12 v0.49 F-1 (회차 SSOT: `workspace_teamops/deliverables/2026-08-12-f1nav-nav-commands.md`)

### [TEST-UTTERANCE-WRAPPER-1] 발화 스펙의 **호출 래퍼가 파일마다 다르다** — `fireStt`만 grep하면 샌다

- **카테고리:** ⑨ 테스트 함정
- **상태:** `RESOLVED` (이번 회차에서 전부 갱신 — 다만 **어휘를 바꿀 때마다 재발한다**)
- **관측:** v0.49 F-1이 「이전」/「다음」의 의미를 재배정하면서 기존 발화 스펙을 전수 갱신해야
  했다. 1차 grep을 `fireStt(page, '이전'` 형태로 잡아 **21건 34곳**을 고쳤는데, 회귀 실행에서
  **4건이 red**로 드러났다. 놓친 이유는 두 가지였다:
  1. `v0440-c8-flow.spec.ts`는 `fireStt`를 직접 부르지 않고 **`speakWhenArmed(page, '다음')`**
     이라는 파일 로컬 래퍼로 발화한다(13건). 같은 목적의 래퍼가 파일마다 이름이 다르다
     (`speakWhenArmed`·`fireSttConf`·직접 `fireStt`).
  2. `voiceFinalResolver.spec.ts:112`는 **어휘 문자열이 아니라 「접두 충돌 0」 불변식 자체**를
     재고 있었다. 문자열 grep으로는 절대 안 걸린다.
- 🔴 **교훈:** 어휘/계약 재배정에서 **결정적 안전망은 grep이 아니라 「관련 스펙 전량 실행」**이다.
  grep은 1차 스크리닝일 뿐이고, 놓친 걸 찾아준 건 회귀 배치 실행이었다.
- 👉 **다음 사람에게:** 음성 어휘를 바꿀 때는 ① `grep -rn "(page, '<단어>'" tests/`로 **호출
  형태를 가리지 말고** 잡고(래퍼 이름을 모르므로 `fireStt`를 패턴에 넣지 마라), ② 명령
  **불변식을 코드로 강제하는 가드 스펙**(`voiceFinalResolver.spec.ts`)을 따로 확인하고,
  ③ 그러고도 **관련 스펙을 전량 돌려라.** 세 번째가 실제로 잡아낸다.

### [UI-HELP-OVERFLOW-1] 도움말 팝업이 v0.26.0 「전 항목 한 화면」 계약을 **이미** 어기고 있다 — F-1이 2행 더 밀었다

- **카테고리:** ⑤ 빌드·테스트 / UI 계약
- **상태:** `OPEN` — **선행 파손**(F-1이 만든 것이 아니다). 처방은 타이포/레이아웃 소관이라
  이 회차 범위 밖.
- **계약:** `CommandHelpPopup.tsx:7-11` — v0.26.0이 타이포를 압축한 이유가 *"명령어 10개가
  90vh를 넘겨 마지막 항목이 화면 중간에서 끊겨 보였다 — 스크롤은 됐지만 스크롤 단서가 없어
  **사용자에겐 «잘림»으로 보인다**"* 이고, **402×874·375×812에서 전 항목이 한 화면**에
  들어가는 것을 목표로 명시한다.
- 🔴 **실측(2026-08-12, 목록 컨테이너 `scrollHeight` vs `clientHeight`):**

  | 뷰포트 | 현재 18행 | **기준 16행**(F-1의 2행을 DOM에서 제거) | 첫 화면 노출 |
  |--------|----------|------------------------------------|------------|
  | 375×812 | overflow **388px** | overflow **278px** | 6행 |
  | 402×874 | overflow **269px** | overflow **191px** | 7행 |
  | 390×568 | overflow 608px | overflow 498px | 2행 |

  **기준 16행에서 이미 오버플로우다** — 계약은 v0.49 F-1 이전에 깨져 있었고, 명령이 10종에서
  16종으로 늘어나는 동안 아무도 재지 않았다. F-1은 그 위에 +110px(375×812)를 더했다.
- **F-1 관점의 영향은 없다:** 재배정된 어휘 4종(이전·다음·이전행·다음행)이 배열 앞쪽(2~5번째)이라
  **계약 해상도 두 곳에서 전부 첫 화면에 보인다**(위 표의 노출 목록에 4종 모두 포함).
  즉 「바뀐 기능을 가르친다」(민구 요구 ④)는 충족된다.
- 👉 **다음 사람에게:** ① `safe-area.spec.ts`의 팝업 스펙은 이걸 **못 잡는다** — 컨테이너가
  `maxHeight:'90%'` + 내부 `overflowY:'auto'`라 **구조적으로** safe-bounds를 넘지 못한다.
  ② `innerText()` 기반 단언도 못 잡는다 — 스크롤 밖 내용까지 문자열로 잡힌다.
  **목록 컨테이너의 `scrollHeight > clientHeight`를 직접 재야** 보인다.
  ③ 명령을 새로 추가할 때는 이 수치를 다시 재라 — 지금은 "스크롤 단서 없는 잘림"이
  **명령 12개 분량**만큼 쌓여 있다.

---

## 2026-08-12 v0.49 fix49 리뷰 수정 라운드 (회차 SSOT: `workspace_teamops/deliverables/2026-08-12-fix49-review-fixes.md`)

### [TTS-CANCEL-MUTE-1] `cancelTts()`가 STT 뮤트를 안 풀어 **앱이 자른 발화가 마이크를 워치독까지 죽였다**

- **카테고리:** ③ iOS/TTS · ① 음성/STT
- **상태:** `MONITORING` (처방 들어감 — **실기기 확인 전 RESOLVED 금지**, AGENTS 계약 4)
- **기전:** 뮤트를 거는 쪽은 `speak()`(`engine.speak` 직전)인데 푸는 쪽은 `done()`
  (`onend`/`onerror` **또는 워치독**)이다. 따라서 **종료 워치독 지속시간 = STT가 죽어 있는 시간의
  상한**. [TTS-WATCHDOG-1]의 처방이 그 상한을 2.5초 고정 → 최대 20초로 넓혔으므로(정상 발화
  절단을 막는 옳은 방향), 「`onstart`는 왔는데 `onend`가 끝내 안 오는」 축의 피해가 8배가 됐다.
  `cancelTts()`는 `synth.cancel()`만 불렀다 — **앱이 스스로 자른 발화**인데도 해제를 엔진에 맡겼다.
- 🔴 **실측으로 드러난 두 번째 축(물림):** 엔진이 `cancel()`에 `onend`를 안 쏘면(iOS Safari
  알려진 버그 — `speak()`가 50ms 지연으로 완화 중) **잘린 발화의 2단 워치독이 살아남는다.**
  그 다음 안내가 재생되는 도중 만료되면 `done()`이 unmute를 불러 **재생 중인 TTS가 STT로 새는
  창**이 열린다. 재현: A(12자, 2단 상한 ~5.1s) 재생 → `cancelTts()` → B 재생 시작 →
  A 워치독 만료 → `muted=false`(B는 아직 재생 중). 같은 기전으로 `await say(...)`도
  워치독까지 매달렸다(**4903ms**/12자, clamp면 최대 20초).
- **대응:** ①`cancel()` **뒤에** 즉시 unmute(`isTtsMuted()` 게이트 — 이 함수는 명령 핸들러
  선두에서 방어적으로 수십 곳에서 불려, 무조건 호출하면 그 전량에 `halfDuplexHold` 해제·
  `scheduleRestart()` 부작용이 붙는다) ②in-flight `speak()`의 `done()` 드레인(워치독·프라미스
  동시 종결). 오라클 `tests/v049-fix49-cancel-unmute.spec.ts` 7케이스.
- ⚠️ **clamp 20s는 유지했다.** 내리면 긴 발화에서 워치독이 재생 중 `done()`을 불러
  **뮤트만 풀리고 TTS는 계속** = 위 물림의 재개방이다. 20s 판정은 [TTS-WATCHDOG-1]의
  `tts_late_end` 계측이 다음 로그 수거에서 한다.
- **실기기 확인 절차(다음 회차):** ① 명령 발화 직후(= `cancelTts` 경로) STT가 곧바로 듣는지
  민구 체감 ② `lifecycle:restart_resched_after_tts` 빈도가 늘었는지(설계된 증가 — _ASK-fix49 Q3)
  ③ 안내 재생 중 자기 목소리가 인식되는 물림이 **없는지**.

### [NAV-FILLED-CELL-1] 항목 이동이 연 「확정 셀 덮어쓰기」 — 파생 경로가 4개였다

- **카테고리:** ⑦ 입력흐름
- **상태:** `GUARDRAIL`로 승격 — 규칙 본문은 [ENGINEERING-GUARDRAILS.md](./ENGINEERING-GUARDRAILS.md)
  `[CELL-OVERWRITE-1]`. 여기엔 **왜 4개였는지**만 남긴다(다음 사람이 같은 형태를 셀 것).
- **관측:** 리뷰가 지목한 것은 `gotoAdjacentField`의 두 경로였는데, 실측하니 같은 불변식을 깨는
  경로가 넷이었다 — ①일반 이동 ②항목 경계 재안내 ③**행** 경계 재안내(`gotoAdjacentRow`,
  v0.33.0 낡은 코드인데 **커서를 filled 셀에 주차시키는 경로가 없어서** 그동안 도달 불가였다)
  ④직접 수정(「수정 41.4」) 복귀의 `announceField(vc[curIdx])`.
- 👉 **다음 사람에게:** 「커서를 세우는 새 경로」를 만들면 **그 커서를 쓰는 기존 재안내 지점 전부**가
  새 도달 조건을 얻는다. 리뷰의 「기록자 N곳 전수 확인」 표는 **그 변경 이전 기준**이라 이 조합이
  구조적으로 빠진다 — 표를 물려받지 말고 **새 상태에서 다시 세라.**

### [CELLWAIT-HOLD-RELOAD-1] 셀 검토 대기 + 수동 보류 + reload = 문맥이 `modify`로 복원된다

- **카테고리:** ⑦ 입력흐름 / ② 클립·IDB
- **상태:** `OPEN`(부분 수정) — 메모리 경로는 v0.49 fix49b가 닫았고, **reload 복원만 남았다**.
- **관측:** 값 있는 셀에 항목 이동으로 착지(`cellWait`)한 뒤 키패드로 **이상치 값**을 커밋하면
  `manualHold` 보류가 걸린다. 여기서 [확인]을 누르면 정상이다(`proceedAfterCommit`이 kind를
  보고 셀 검토 대기로 복귀 — fix49b가 그 SSOT를 세웠다). 그러나 보류 상태에서 **reload**하면
  복원부(`useVoiceSession.ts` hydrate effect)가 `pendingValidation.reviewWait` boolean만 보고
  `reviewWait`/`modify` 둘 중 하나로만 복원하므로, 셀 검토 문맥이 `modify`가 된다.
- **피해:** 데이터 오염은 아니다(그 셀은 어차피 정정 대상이고 값은 후보로 살아 있다). 사용자가
  이동해 들어온 **검토 문맥**만 잃는다 — [확인] 후 착지가 셀 재낭독이 아니라 advance가 된다.
- **왜 안 고쳤나(파생 실패 근거 — 다시 시도할 사람을 위해):** `pendingValidation`에 필드를
  더하는 것은 **persist 스키마 변경 = 마이그레이션 동반**(AGENTS.md 계약 3)이라 이 라운드
  범위를 넘는다. 기존 필드 파생을 두 축으로 시도했고 둘 다 막혔다:
  ① 「행 미완료 + 그 칸에 값 있음」 → **후보값이 이미 셀에 서 있어**(`setRowValue`가 보류 전에
  돈다) 「값 있음」이 항상 참이다. ② `previousValue !== ''` → 캐스케이드 clear는 in-memory만
  지우고 **IDB는 남기므로** `modify` 출신도 non-empty가 될 수 있다.
- 👉 **다음 사람에게:** 고치려면 스키마에 `awaitingKind` 같은 **kind 자체**를 싣고 마이그레이션을
  동반하라. boolean 하나로 3상태를 표현하려던 것이 이 문제의 뿌리다 — `reviewWait: boolean`은
  상태가 둘일 때 옳았고, fix49가 셋째를 만들면서 표현력이 부족해졌다.
- 🔴 **축 확장(v0.49 r6 Y13, claude #15) — reload는 「어디로 돌아갈지」도 함께 잃는다.**
  위 항목은 *복원되는 문맥이 틀린다*(cellWait → modify)는 축이다. 같은 reload에 **복원 시도조차
  없는** 축이 하나 더 있다: **복귀 예약**(`sessionStore.returnStack`)이다.
  - `sessionStore`는 **메모리 전용**이다(그 파일 :191이 계약으로 명시 — 스택은 직렬화 경로에
    닿지 않는다). `pendingValidation`은 IDB에 있어 보류 자체는 살아남지만, 그 보류가 풀린 뒤
    `advance()`가 소비할 예약은 남아 있지 않다.
  - 그래서 「'이전행'으로 완료 행에 들어가 정정 → 이상치 보류 → reload → [확인]」에서 사용자는
    **떠나온 행으로 돌아가지 못한다.** 자연 전진이 대신 아래 미완료 행을 찾으므로 흐름이 멈추지는
    않고, 값도 오염되지 않는다 — 잃는 것은 「하던 자리로 돌아간다」는 약속뿐이다(P).
  - **왜 지금 안 고치나:** 예약을 살리려면 `pendingValidation`(또는 세션 레코드)에 스택을 실어야
    하고, 그건 위 항목과 **같은 persist 스키마 변경 = 마이그레이션 동반**이다(AGENTS 계약 3).
    두 축의 처방이 같은 자리에서 만나므로, 스키마를 손볼 때 **함께** 싣는 것이 옳다.
  - ⚠️ v0.49 r6 Y8이 행 이동 예약을 `pushReturn`으로 정합시키면서 스택 깊이가 2 이상이 될 수
    있게 됐다 — 스키마를 설계할 때 **단일 항목이 아니라 배열**로 실어라(깊이 1만 실으면 P1
    중첩 예약에서 안쪽만 남고 바깥이 다시 사라진다).

### [TTS-DRAIN-SCOPE-1] 엔진 cancel의 드레인 계약은 `cancelTts()` 밖에도 필요했다 — 그리고 :354는 예외다

- **카테고리:** ① 음성/STT
- **상태:** `MONITORING`(실기기 미확인 — 계약 4). 처방은 v0.49 fix49b 커밋.
- **관측:** fix49가 심은 드레인이 `cancelTts()` 안에만 있어, **엔진을 자르는 다른 지점 전부**가
  같은 결함을 그대로 안고 있었다 — `speak({interrupt:true})`(= `say()`의 기본값)가 매 호출
  `engine.cancel()`을 부른다. 잘린 발화의 2단 워치독(최대 20s)이 살아남아 다음 발화 재생 중
  만료되면 `done()`이 unmute → 앱 목소리가 살아 있는 인식기로 샌다(물림).
- 🔴 **`speech.ts:354`(interim barge-in 컷)는 같은 처방을 받을 수 없다 — 실측 판정.**
  브리핑이 그 지점도 드레인 대상으로 지목했으나 두 이유로 기각했다:
  ① `done()`은 `unmuteForTts()`를 포함하는데, `handleInterim`이 같은 동기 흐름에서
  `isTtsMuted()`를 읽는다 — `bargeInEpochRef`(U1 4절)뿐 아니라 **조기확정 게이트**(`:3067`)도
  그 값을 읽으므로, false로 뒤집히면 barge-in interim이 곧장 커밋되는 **데이터 경로**가 열린다.
  ② interim이 final에 도달하지 못하면(말하다 만 경우) 그 stale 워치독이 **사실상 유일한 unmute
  경로**다 — 워치독만 종결하면 영구 뮤트(WP-1이 막던 마비와 동종).
  `speech.ts:772-774`가 남긴 「그 4절부터 다시 읽어라」 경고가 정확했다.
- 👉 **다음 사람에게:** 「모든 cancel 지점에 같은 계약」이 옳아 보여도, **unmute를 수반하는
  처방은 그 unmute를 읽는 소비자를 먼저 세라.** 드레인(워치독 종결)과 unmute는 한 덩어리로
  묶여 있어 분리할 수 없고, 분리하면 뮤트 소유자가 사라진다.

### [TTS-MUTE-REFCOUNT-1] 뮤트는 **enqueue 시점에** 걸리는데 해제는 **발화마다** 일어난다 (boolean, refcount 아님)

- **카테고리:** ① 음성/STT
- **상태:** `OPEN` — v0.49 fix49b가 실측으로 발견(리뷰 15건에 없던 축). 처방 없음.
- **관측:** `speak()`는 `engine.speak(u)` **직전**에 `muteForTts()`를 부른다 — 큐잉된
  (`interrupt:false`) 발화도 **자기 차례가 오기 전에** 이미 뮤트를 건다. 그런데 해제는 각
  발화의 `done()`이고 `ttsMuted`는 **평범한 boolean**이다. 그래서 A·B가 큐에 있을 때
  **A의 `onend` 하나가 B 몫의 뮤트까지 함께 푼다.** B가 실제로 시작해도 재-뮤트가 없다 —
  뮤트를 `onstart`에서 `speak()` 직전으로 옮긴 v0.4.x 계약이 그 자리를 비워 뒀기 때문이다.
  → **큐의 두 번째 발화부터는 재생 내내 STT가 열려 있다**(자기 목소리가 들어갈 수 있다).
  실측(`v049-fix49b-tts-drain.spec.ts` ③ 주석): A 종료 직후 `muted=false`, B `onstart` 후에도
  `false`.
- **fix49b의 #5와 무엇이 다른가:** #5(시작 워치독 앵커)는 「앞 발화가 **재생되는 동안**」의
  누출을 닫았다 — 그 창은 실제로 닫혔고 오라클 ③이 지킨다. 남은 것은 「앞 발화가 **끝난
  뒤부터** 뒤 발화가 끝날 때까지」이고, 그건 앵커가 아니라 **뮤트 소유권 모델**의 문제다.
  즉 fix49b는 이 축을 **좁혔지 닫지 않았다**(정직한 서술은 그쪽이다).
- **왜 지금 안 고쳤나:** 처방은 refcount(또는 「현재 발화 id」 소유권)로 가는 것인데, 그건
  `muteForTts`/`unmuteForTts`의 계약 변경이고 `halfDuplexHold`·`restartPendingAfterTts`·
  `cancelTts`의 게이트가 전부 그 boolean을 읽는다([TTS-CANCEL-MUTE-1] 참조). 리뷰 범위 밖의
  설계 변경이라 실기기 계측 없이 손대지 않는다.
- **실기기에서 볼 것:** 큐잉이 실제로 얼마나 자주 일어나는가 — 앱에서 `interrupt:false`는
  ①복귀 안내+브리핑 연속(`useVoiceSession:210-213`) ②수동 커밋 에코 ③마이크 경고다.
  물림이 그 직후에 몰리는지 로그로 갈릴 수 있다.

### [AUTOVALUE-SPAN-MIGRATION-1] `?? 1` 스팬 정정이 **재개 세션**에서 pre-upgrade 스키마와 발산한다
- **무엇(2026-08-13 v0.49 r4 · claude r3 #12 — R 등재, 수정 없음):** r3 #8이 `spanOf`·`autoValue`의
  `|| 1`을 `?? 1`로 고쳤다(`autoValue.ts:26-33`). `from: 0`은 **정상값**이므로(ColumnCard가 seq
  전환 시 넣는 기본값) 옳은 수정이다. 그런데 그 수정은 **자릿수(span)와 순환값의 의미를 바꾼다**:
  `from=0, to=2`가 종전 2에서 3으로 바뀐다.
- **왜 마이그레이션 축인가:** 총 행 수(`computeTotalRows`)와 각 행의 자동값이 이 스팬에서
  파생된다. **업그레이드 전에 시작해 IDB에 남아 있는 세션**을 업그레이드 후 이어서 열면,
  이미 영속된 행들은 옛 스팬으로 만들어진 자동값을 갖고 있는데 새 계산은 다른 값을 낸다 —
  같은 세션 안에서 **행 번호↔자동값 대응이 어긋난다**(시트 업로드 시 샘플 식별이 갈린다).
  `from=0`을 쓰는 스키마에 한정되지만, 그게 정확히 r3 #8이 겨냥한 스키마다.
- **왜 이번에 안 고쳤나:** 처방이 「세션에 스팬 계산 버전을 실어 두고 재개 시 옛 규칙으로
  파생」이거나 「업그레이드 시 진행 중 세션의 자동값을 재계산해 재영속」이다. 둘 다 persist
  스키마 변경 + 마이그레이션(AGENTS 계약 3)이라 r4(수렴 회차) 범위 밖이다.
- **다음 회차가 확인할 것:** ① 실제로 `from=0` 스키마로 시작된 미완료 세션이 IDB에 남아 있는지
  (없으면 위험이 이론에 그친다 — 그 확인이 가장 싸다) ② 재계산 마이그레이션의 대상이
  `rows[].values`의 auto 컬럼뿐인지(voice 값은 불변) ③ `skippedRows`/`completedRows` 인덱스가
  총 행 수 변화에 어떻게 반응하는지.
- **✅ 부분 완화(v0.49 r5 Z3):** `persistSession`의 `buildRow`가 **이미 기록된 행의 자동 컬럼
  값을 승계**하게 됐다(아래 `[AUTO-DRIFT-OVERWRITE-1]`). 위 서술의 *"이미 영속된 행들은 옛
  스팬으로 만들어진 자동값을 갖고 있는데 새 계산은 다른 값을 낸다"* 가 **기존 행에 대해서는**
  더 이상 참이 아니다 — 그 행들은 재계산되지 않는다. **남는 축**: 재개 후 **새로 만들어지는**
  행은 새 스팬으로 파생되므로 한 세션 안에서 행 번호↔자동값 규칙이 두 벌이 된다.
  총 행 수(`computeTotalRows`) 변화도 그대로다. 마이그레이션 축은 여전히 열려 있다.
- **현재 상태:** ⚠️등재(부분 완화). v0.50 후보 — 마이그레이션 축.

### [ATEND-REACH-SKIPPED-1] 스킵했던 행을 일부만 다시 채우면 **완료 요약 화면에 다시 못 간다**
- **카테고리:** ⑦ 입력흐름
- **상태:** `OPEN`(등재만 — v0.49 r5 Z7에서 **실측 후 수정하지 않기로 판단**). 현행 동작은
  계약 오라클 `tests/v049-r5-z7-gap-return-scope.spec.ts`가 고정한다 — **다음 회차가 반증할
  기준선**이다.
- **원 발견(claude #7):** *"M2 gap-return이 skippedRows를 존중하지 않아 스킵 행을 강제
  재개방하고 완료화면 도달이 불가능해진다."* 실측에서 두 반쪽이 갈렸다.
- **🔵 반쪽 ①「강제 재개방」 — 기각(구조적으로 불가):** `advance()`는 `proceedAfterCommit`
  (=커밋 뒤) 또는 `'유지'`(그 셀에 값이 있을 때만)로만 도달하고, 교차행 수동 커밋은 `ownsFlow`
  게이트(M1)에 막혀 `advance()`를 아예 타지 않는다. 즉 gap-return이 발동하는 순간 그 행에는
  **사용자가 방금 넣은 값이 반드시 있다** — 「손대지 않은 스킵 행에 강제 재진입」하는 경로가 없고,
  그 순간의 스킵 행은 **다른 부분입력 미완료 행과 구별할 근거가 없다.**
- **🔴 반쪽 ②「완료화면 도달불가」 — 확인:** 스킵했던 행에 되돌아와 일부만 채우면, 그 행이
  완성되기 전까지 `X / N` 요약 화면(끝 도달)에 다시 도달할 수 없다. `announceEndReached`의
  유일한 호출부가 `advance()`이고 M2가 미완료 행에서 그것을 막는다.
  재현 트레이스(실측): `row_skipped:1,src=voice` → `end_reached_waiting:empty=1` →
  ('이전행' → '다음' → 값) → `row_gap_return:col=m1` → 이후 `end_reached_waiting` 재발 없음.
- **왜 이번에 안 고쳤나 — 후보 처방 셋이 각각 독립된 선행 결정에 막힌다:**
  | 후보 | 막는 것 |
  |---|---|
  | 스킵 행에서 atEnd 허용 | **M2 재개방** — atEnd 센티넬 `colId`=마지막 컬럼이라 bare '수정'이 방금 넣은 값을 지운다(직전 회차 🔴) |
  | atEnd 센티넬 컬럼을 gap으로 이동 | `[MODIFY-TARGET-1]` — `announceEndReached` 주석이 *"반대 방향은 안 된다"* 고 명시 |
  | `goNextRow` 경계에서 end-reached 재발화 | **F13이 명시적으로 제거**(*"'다음'은 더 이상 announceEndReached를 부르지 않는다"*) |
- **피해 한계:** 데이터 손실도 막다른 길도 아니다. `endReachedOnce`가 종료 수단을 세션 경계까지
  붙잡아 ⏹이 항상 열려 있다(오라클 ③이 그 안전망을 고정한다). **잃는 것은 요약 화면 하나다.**
- **다음 회차가 확인할 것:** ① **atEnd 센티넬 컬럼 재설계**가 선행 조건이다(`colId`를 「마지막
  음성 필드」에서 「행 스코프 없음」 또는 「첫 미완료 칸」으로 바꾸면 세 후보 중 첫째가 열린다).
  ② 그때 `[MODIFY-TARGET-1]`·M2·F13 세 계약을 **동시에** 다시 세워야 한다 — 하나씩 고치면
  이 라운드가 겪은 「사본 드리프트」와 같은 형태가 된다.

### [AUTO-DRIFT-OVERWRITE-1] 자동값 재계산이 **이미 동기화된 시트 행을 능동으로 덮어쓴다**
- **카테고리:** ⑦ 입력흐름 / ② 클립·IDB (데이터 무결성)
- **상태:** `GUARDRAIL`로 승격 — 규칙 본문은 [ENGINEERING-GUARDRAILS.md](./ENGINEERING-GUARDRAILS.md)
  `[DERIVED-FREEZE-1]`. 여기엔 **실측으로 갈린 두 축**만 남긴다.
- **무엇(2026-08-14 v0.49 r5 Z3 · claude #1):** `composeRowValues`가 자동 컬럼을 **매 persist마다
  재계산**한다. 결과가 기록 시점과 달라지면 `buildRow`의 diff가 `synced`를 `dirty`로 강등하고,
  다음 동기화가 그 행을 시트에서 **in-place UPDATE**한다. 「기록 안 됨」이 아니라 **능동 덮어씀**
  이다 — 사용자가 아무것도 안 했는데 프로덕션 시트의 확정 행이 바뀐다.
- **🔴 축 ①(도달 가능 — 수정함): 날짜 드리프트.** `autoValue`의 `'오늘'` 치환은 **호출 시각의
  로컬 날짜**다. 자정을 넘긴 세션(현장 새벽 작업·긴 세션)의 기존 행 **전부**가 다음 날짜로 다시
  쓰인다. 재현: 1행 커밋 → `Date`를 하루 앞으로 → 2행 커밋 → 1행 `조사일자`가 바뀐다(실측).
- **🔵 축 ②(도달 불가 — 방어만): span 드리프트.** 원 보고가 지목한 축이다. 실측하니 **현행
  UI에서는 닿지 않는다**: `sessionColumnsRef`가 세션 시작에 컬럼을 동결하고(`useVoiceSession`
  start), `App`이 세션 중 VoiceScreen을 keep-alive로 유지하므로(`tab === 'voice' || sessionLive`)
  훅이 리마운트되지 않는다 — 설정탭에서 스팬을 바꿔도 라이브 세션의 persist에 닿지 않는다.
  남은 이론적 창은 `getSessionColumns()`의 폴백(`sessionColumnsRef === null`)인데, 그 상태가
  되려면 훅 리마운트 + `dataStore`에서 그 세션을 못 찾아야 하고, 그 경우엔 `existingRow`도 없어
  강등 diff 자체가 성립하지 않는다. **그래도 처방은 두 축 공통**이라 함께 닫혔다.
- **처방:** 기존 행에 이미 있는 **자동(비-사용자입력) 컬럼 값은 그대로 승계**한다. 사람이 넣는
  컬럼(voice/touch)은 라이브 스토어가 이긴다 — 강등 diff의 **본래 목적**(사용자 정정을 시트에
  밀어넣기)은 손대지 않는다. 정상 경우엔 무해하다: seq·options 값은 행 인덱스에서 나오므로
  재계산 결과가 기존 값과 같다.
- **반증:** 승계를 빼면 ① red(`2026-08-14` → `2026-08-15`). ②(과잉 방어 반증 — 기존 행의 측정값
  정정이 그대로 반영되는가)는 양방향 green.
- **관련:** [[AUTOVALUE-SPAN-MIGRATION-1]]의 「기존 행」 축을 이 수정이 함께 완화한다.

### [TEST-MIDNIGHT-UTC-1] `v049-prev-survey` W3-3·W3-4가 **KST 00:00~08:59에만** red — 세션명이 UTC 날짜다
- **증상(2026-08-14 00:22 KST, v0.49 r4 게이트 2회차에서 실측):** `tests/v049-prev-survey.spec.ts`의
  W3-3·W3-4가 `expect(locator).not.toContainText(PREV_ROUND)`에서 실패한다. 두 테스트 모두
  **정작 재려던 계약은 만족**한다(「기록 없음 (백업)」·「미확인」이 화면에 그대로 있다) —
  걸리는 곳은 모달 하단의 **세션명** 행이다:
  `"…세션명2026-08-13 없는농가 A…조사일자자동오늘 (2026-08-14)…"`
- **원인:** `sessionLabel.buildSessionLabel`이 접두 날짜를
  `new Date().toISOString().slice(0, 10)` = **UTC**로 만든다. KST 00:00~08:59에는 UTC가 아직
  전날이므로 세션명 접두 = **로컬 어제**가 되고, 스펙의 `PREV_ROUND = daysAgoLocal(1)`(로컬 어제)와
  **글자가 같아진다.** 모달 전체 텍스트를 보는 부정 단언이 그 행에서 걸린다.
  🔴 이건 v0.7.0이 `persistSession`의 `session.date`에서 정확히 같은 이유로 고쳤던 함정이다
  (그 자리 주석: *"toISOString()은 UTC라 KST 00:00~08:59 세션이 어제 날짜로 찍혔다"*).
  `buildSessionLabel`만 그 정정을 못 받았다.
- **판정법:** 기준 브랜치에서 같이 돌려라(AGENTS 30초 체크). 2026-08-14 00:22 실측으로
  `cc5d4ff` 워크트리에서도 **같은 2건이 같은 단언에서 red**였다 = 코드 회귀가 아니다.
  낮에 돌리면 두 값이 갈려 green이다(같은 날 23시대 게이트 1회차는 617/617 green이었다).
- **두 축이 있다 — 테스트 함정 + 제품 결함:**
  ① 테스트 축: 부정 단언이 「이전 조사」 행이 아니라 **모달 전체**를 본다. 스코프를 그 행으로
     좁히면 시각과 무관해진다.
  ② 제품 축: 새벽 세션의 **세션명이 실제로 어제 날짜로 찍힌다**(시트·데이터탭에 그대로 남는다).
     농가의 아침 작업 시간대(KST 06~09시)에 정확히 걸리는 값이라 실사용 영향이 있다.
     처방은 v0.7.0과 동일하게 `localTodayISO()` 계열로 교체하는 것이다.
- **왜 r4에서 안 고쳤나:** v0.49 r4는 수렴 회차이고 브리핑이 **M 목록 밖은 등재·보고**로
  못박았다(제품 축은 세션명 바이트 계약 + 기존 세션 라벨과의 호환 판단이 필요하다).
- **✅ 해소(v0.49 r5 Z1, 2026-08-14 01:5x KST):** 제품 축(②)을 고쳤고 테스트 축(①)은 그것으로
  **구조적으로 사라졌다** — 세션명 접두 = 로컬 오늘이므로 `PREV_ROUND`(로컬 어제)와 글자가
  겹칠 수 없다. 부정 단언의 스코프는 손대지 않았다(좁히면 이 축의 반증 능력이 사라진다).
  - 고친 곳 4개: `sessionLabel.buildSessionLabel`(기본값) + `isoDate`를 **직접 계산해 넘기던
    호출부 3곳**(`useSettingsActions:376` · `SessionOptionsSection` select/input onChange).
    🔴 게이트를 red로 만든 건 헬퍼가 아니라 **호출부**였다(반증 실측) — 계약은
    [ENGINEERING-GUARDRAILS.md] `[DATE-LOCAL-1]`로 이관했다.
  - 반증 2축: 단위 오라클 red(`sessionLabel.ts` 되돌림) · 게이트 W3-3·W3-4 red
    (`useSettingsActions` 되돌림). 수정 후 42/42 green(포트 5197, KST 01:5x = 창 안).
- **현재 상태:** ✅RESOLVED → 계약은 `[DATE-LOCAL-1]`. 이 항목은 「자정 UTC red」를 다시 만난
  사람이 원 증상으로 검색할 수 있게 남긴다.

## 2026-08-14 v0.49 R1 리팩토링 라운드 (회차 SSOT: `workspace_teamops/deliverables/2026-08-14-r1-review-{claude,codex}.md`)

### [LOGEVENTS-CYCLE-1] logEvents 배럴 순환 import 4쌍 — 현재 안전·구조 부채로 등재
- **무엇:** 도메인 leaf 3파일(`logEventsAudio`·`Session`·`Ui`)이 `kv`를 배럴 `./logEvents`에서
  import하고 배럴이 그들을 재수출한다 — R1 P1-3이 순환 3쌍을 추가(기존 `logEventsInstrumentation`
  1쌍과 같은 패턴, 총 4쌍). 발견: R1 콜드 리뷰 CX-2(codex).
- **왜 지금 안전한가:** 전 leaf가 최상위 실행 0 + 함수 선언 호이스팅 — ESM live binding으로 동작
  (claude 측 리뷰가 같은 축을 독립 검증). 특성화·게이트 green.
- **위험 조건:** leaf 최상위에 `kv` 호출 initializer나 모듈 초기화 계측이 생기면 TDZ/초기화 순서
  결함이 배럴 소비처 전체에 전파될 수 있다.
- **처방(후속):** `kv`/`withErr`를 의존성 없는 leaf 모듈로 내리고 배럴·도메인이 그것만 import.
  R1에서는 diff 최소화 원칙(§3-4)으로 보류 — 다음 logEvents 접촉 회차에 함께.
- **현재 상태:** 🟡 등재만(08-14). 소스 주석(`logEventsAudio.ts:9`)이 안전 조건을 이미 문서화.

## 2026-08-14 v0.49 r7 소형 패치 라운드 (회차 SSOT: `workspace_teamops/deliverables/2026-08-14-fixr7-fixes.md`)

### [MANUALHOLD-JUMP-BYPASS-1] 자동칩 행 점프가 `isManualHoldBlocked`를 지나지 않아 **미확인 이상치 팝업을 소리 없이 내린다**
- **증상(2026-08-14 브라우저 실측, 포트 5197):** 키패드 커밋이 이상치에 걸려 `manualHold` 팝업이
  뜬 상태에서 **조사나무(자동 seq) 칩을 인라인 편집해 `2`로 바꾸면**, 팝업이 사라지고 TTS가
  「조사나무 2. / 측정항목01.」로 2행을 연다. 사용자는 [확인]/[수정] 중 어느 것도 누르지 않았다.
- **원인:** `manualHold` 중 포인터를 옮기는 진입로는 넷인데 게이트가 셋에만 있다.
  - `handleFinal`(STT) · `gotoAdjacentRow`(터치 [이전]) · `goNextRow`(터치 [다음]) ·
    `gotoAdjacentField` · `pause` → 전부 `isManualHoldBlocked(...)`로 거부.
  - **`ActiveState.onCommit`의 자동 컬럼 분기** → `computeRowFromAutoChange` →
    `VoiceScreen.onJumpToRow` → `voiceSession.jumpToRow` → **게이트 없음.**
    `jumpToRow`는 훅이 **외부로 노출한** 공용 코어라 내부 콜러들이 각자 붙인 게이트를 안 받는다.
  점프의 `announceField`가 `clearAnomalyAlert('announce_field')`를 부르는 것이 팝업 소멸의 직접 원인이다.
- **왜 문제인가:** 이 게이트의 존재 이유가 정확히 **「미확인 이상치 우회 차단」**이다
  (v0.34.0 리뷰 라운드2 Codex High + 민구 결정 2026-07-14 「수동 보류는 터치 [확인]/[수정] 전용」).
  후보값은 `pendingValidation` 태그를 단 채 IDB에 남고, 검증 절차만 증발한다.
- **왜 r7에서 안 고쳤나:** r7 브리핑은 7건 밖 확장을 금지했고, #6의 지정 처방은
  「확인 시 보류 셀 소유 재검증」(적용 완료 — `confirmManualAnomaly`)이다. 게이트를 다는 것은
  **별개 처방**이고 07-14 민구 결정의 적용 범위를 건드리므로 결정을 받아야 한다.
- **처방 후보:** ⓐ `jumpToRow` 진입에 `isManualHoldBlocked('jump')` — 가장 좁고, 공용 코어라
  미래의 새 콜러까지 함께 막힌다. ⓑ `ActiveState`의 자동칩 커밋 분기에서 `anomalyPending`이면
  편집 자체를 막는다(표면에서 차단 — 「왜 안 되는지」를 보여줄 수 있다).
  ⓐ가 구조적으로 맞고, ⓑ는 안내 품질용으로 함께 갈 수 있다.
- **재현 절차:** `tests/v049-r7-06-hold-confirm-owner.spec.ts` 헤더의 실측 기록 참조.
  칩 클릭은 `{force:true}`가 필요하다 — 팝업이 막아서가 아니라 **칩 스윕 애니메이션** 때문에
  Playwright의 stability 판정을 못 받을 뿐이고, 히트 테스트는 칩 자신이 받는다(실기기 탭은 닿는다).
- **현재 상태:** 🔴OPEN — 처방 미적용. r7은 소유 재검증(backstop)만 넣었다.

## 2026-08-15 uvs 시리즈(ENV-12 서브 훅 분리) 회차 (조사 SSOT: `workspace_teamops/_ASK-fixc.md`)

### [TEST-LANDING-PROXY-1] `v049-r7-01`이 **배너 소멸을 착지 완료의 프록시**로 써서 마진 1~5ms의 레이스 — 리팩토링 회귀로 두 번 오진됐다
- **증상:** `tests/v049-r7-01-retry-landing.spec.ts`가 게이트에서 산발 red다. **실패 항목이 실행마다 바뀐다** — 08-14 stage B 게이트 `②` · 08-15 stage C 게이트 `①` · 같은 날 단독 재판정 `①③`. 실패 실행의 소요가 성공보다 **0.8s 짧다**(① 6.1s vs 6.9s) = 지연이 아니라 **조기 반환**이다.
- **원인(브라우저 내 연속 계측으로 확정):** 재시도 버튼은 `commitManualValue`를 다시 태우는데, **배너를 내리는 것은 `persistCellValue` 성공**(`useVoiceSession.ts`의 `useCellPersistError.clearIfMatches`)이고 **완료 낭독은 그 뒤** `finalizeRowCompletion`(IDB await) → `proceedAfterCommit`에서 나온다. 그 사이는 TTS가 하나도 없는 유휴 구간이다.

  | 관측(각 tip 5회) | 배너 소멸 시 `__ttsInFlight` | 배너 소멸 → '완료' | **유휴 창** |
  |---|---|---|---|
  | `e9bad5e`(분리 후) | 0 (5/5) | 274~281ms | **51~55ms** |
  | `e1d769f`(분리 전) | 0 (5/5) | 273~279ms | **52~56ms** |

  `waitForTtsIdle`(`tests/fixtures/stt.ts`)은 `idle 확인 → 50ms 대기 → 재확인`이다. **유휴 창 51~56ms vs 재확인 50ms = 마진 1~5ms.** 여기에 폴링 위상(rAF 0~16ms)이 겹치면 회당 한 자릿수 % 확률로 `waitForTtsIdle`이 완료 낭독 **전에** 반환하고, 스펙은 낭독을 통째로 놓친다. `②`는 그 뒤 발화가 착지 완료 전에 나가 2행 커밋이 비는 형태로 파생된다.
- **🔴 왜 두 번 오진됐나 — 판정법:** 이 red는 **커밋과 무관**한데 리팩토링 회차 중에 터져 두 번 다 「직전 커밋의 회귀」로 취급됐다. 실측이 그것을 반증한다 — 분리 **이전** tip `e1d769f`(= `uvs-stage-b-green` 태그)에서 반복 실행하면 12회 중 1회 `①`이 같은 형상(6.1s)으로 red다. 반면 분리 후 tip은 40회(단독·부하·배치 문맥) 전부 green이었다. **표본상 두 tip의 실패율은 구별 불가이고, 등가성의 근거는 비율이 아니라 위 계측 동일성이다.** `uvs-stage-b-red-20260814-213442`와 `uvs-stage-b-green`이 **같은 sha**인 것이 1차 단서였다(같은 커밋이 하루 사이 red→green으로 재태깅됨).
- **⚠️ 러너 운영:** flake 판정 휴리스틱 「배치 red · 단독 green → flake」가 **이 스펙은 못 거른다** — 단독 재실행도 같은 레이스에 걸려(08-15 08:04 `①③`) 진성 red로 HALT됐다.
- **해결(2026-08-15, fixc):** `waitForLandingTts(page, sinceLen)` 헬퍼를 스펙에 넣고 `①②③`의 「배너 소멸 대기」 뒤에서 **완료 낭독을 직접 기다린 뒤** `waitForTtsIdle`을 태운다. 대기는 실패해도 삼킨다 — **판정은 원 단언이 그대로** 한다(여기서 red를 내면 오라클의 실패 메시지가 죽는다). 픽스처(`waitForTtsIdle`의 50ms)는 **건드리지 않았다**: 전 스펙 공용이라 다른 스펙의 숨은 마진을 흔든다. 앱의 배너 clear 시점 이동은 기능 변경이라 별도 라운드 몫이다.
- **일반화:** **비동기 체인의 중간 신호를 종단의 프록시로 쓰지 마라.** 「배너가 사라졌다」는 체인의 1/3 지점이고, 남은 IDB await 구간에는 TTS가 없어 `waitForTtsIdle` 같은 「조용해질 때까지」 대기가 **즉시 만족된다**. 종단(완료 낭독·상태 전이)을 **직접** 기다려라. [TEST-TTS-MOCK-1]의 「너무 빨라도 화면이 실기기와 달라진다」와 같은 계열이고, 증상 표면은 [TEST-MANUAL-CHIP-1]·[TEST-W7-TIMING-1](실패 항목이 실행마다 바뀌는 부하 민감 flaky)과 같다 — 다만 이 건은 **원인이 계측으로 확정**됐다.
- **현재 상태:** ✅수정됨(`tests/v049-r7-01-retry-landing.spec.ts` — `waitForLandingTts` 동기화). 수정 후 단독 반복 12회 + 배치 문맥 1회 green.

---

## 2026-08-19 v0.50 실기기 클립 소실 회차 (조사 SSOT: `workspace_teamops/deliverables/2026-08-19-clipfail-investigation.md` · 구현 SSOT: `…/2026-08-19-clipfix-implementation.md`)

### [CLIP-SILENT-1] 마이크 트랙이 **살아 있는 채 무음**이면 클립이 전량 죽는데 아무도 모른다
- **증상(실측 2건, 같은 날):**
  · **이원창 A**(09:41~10:21) — 클립 **60/60 전량 소실**. `clip_stop_resolved`가 60개 모두 **5바이트**,
    `clip_trim_failed:decode:EncodingError` + `clip_too_small:5` 60건, `clip_saved` **0**.
    세션 `wave_stats:peak=0.00,avg=0.00,activePct=0`(정상 3세션은 `peak=1.00`).
  · **양혁진 A**(06:53~07:23) — **연속 9셀 · 2분 26초**(r16 종경~r20 종경) 소실 후 **저절로** 회복.
    5바이트 6건 + `clip_stop_resolved:null`(chunk 0) 3건이 한 구간에 섞였다.
  · 값(STT)은 두 세션 모두 **시트까지 정상 도달**(빈칸 0). 화면·시트에 이상이 없어
    **세션이 끝날 때까지 아무도 몰랐다** — 잃은 것은 「값이 맞는지 확인할 수단」이다.
- **근인:** `getUserMedia` 트랙이 **`ended`가 아닌 채 무음 프레임만** 흘렸다. 그래서
  `AudioRecorder.isStreamLost()`(= `readyState === 'ended'`)가 false → `maybeAutoRecoverOrLatch`가
  **69회 호출되어 69회 no-op**. 복귀 복구 경로(`onForegroundReturn`)는 `visibilitychange`/`pageshow`
  전용이라 **blur-only 인터럽션**(알람 배너 등, `vis`는 계속 `visible`)에 깨어나지 않는다.
  🔴 관측 수단도 죽어 있었다 — `navigator.audioSession`은 iOS 26.6에서 `state=unknown`만 주고
  `statechange`가 **08-06~08-19 누적 0건**이다(v0.46.0 P1 프로브가 이 기기에서 무용).
- **정황(확정 아님):** 민구 증언 — 두 세션 모두 *"타이머 알람 → 해제 → 유튜브 자동재생"*이 있었다.
  🔴 본인이 *"그게 클립 유실의 원인인지는 모르겠다"*고 유보했고, 앱 로그에 그 앱을 지목하는
  자국은 없다. 양혁진 쪽은 무음 구간과 **네트워크 스톨**(`past_index_skip` 20s 타임아웃 7건)이
  정확히 겹치고 회복 시각도 같은 초다 — 오디오·네트워크를 동시에 쓰는 무언가가 있었다는 정황.
- **해결(v0.50 A+B안):** 신호가 아니라 **결과**로 감지한다.
  · `clipHealth.ts` — 연속 빈클립 카운터(임계 **2**, 🔴 리셋은 `clip_saved`에서만).
    `maybeAutoRecoverOrLatch(reason, {force})`가 임계 도달 시 스트림이 `live`여도 래치.
  · `useClipFailureAlert.ts` — 래치 시 **블랙아웃 자동 해제 + TTS 1문장**
    (`BlackoutOverlay` z-9999가 `MicReconnectBanner` z-60을 완전히 가렸다).
  · 세션 종료 `clip_summary:saved=N,failed=M` + 종료 화면 경고(`clipWarning`).
  · 관측 보강 — `clip_duration`에 `trackState`·`clipPeak`, `clip_silent:track=<state>`,
    `mic_track_evt:<type>`(리스너는 있었는데 **무기록**이었다), `focus_interrupt:ms=`(1초 이상만).
- **회귀:** `tests/v050-clip-silent-latch.spec.ts` — 경계 양쪽 반증 실측(임계 99 → ⓑ red ·
  임계 1 → ⓐ red). 인접 78스펙 green.
- **출처:** 실기기 로그 `workspace_teamops/inbox/2026-08-19-device/` 4세션 + 재업로드 1세션.
- **현재 상태:** 🟡 **MONITORING** — 데스크톱 회귀·반증 완료. **실기기 판정 대기**:
  유튜브 백그라운드 재생 중 세션 → 2회째 실패에서 **고지(TTS+블랙아웃 해제+배너)** 가 뜨는지.
  🔴 **해제 조건 정정(r2 · 콜드 리뷰 CF-3)**: 종전엔 *"`clip_silent:track=muted|live`가 남는지"*로
  적었는데, 그 마커는 `clipPeak === 0`에서만 나가고 `inputLevel`은 지수평활이라 **한 번이라도
  소리가 있었으면 다시 0이 되지 않는다**(denormal 1.5e-323 고정점) — 즉 **양혁진형(도중 발병)에서
  구조적으로 충족 불가**했다. r2에서 임계(`< 1e-4`)로 고쳤지만, **판정의 정본은
  `clip_duration`에 항상 실리는 `trackState` + `clipPeak` 값**이다(그 둘은 모든 클립에 실린다).
  ⚠️ `[미확인]`: 실기기의 무음이 정확한 0 샘플인지 미세 잡음인지는 확인하지 못했다. 미세 잡음이
  임계를 넘으면 `clip_silent`는 그 세션에서도 안 나간다 — 그래서 **값 판독이 정본**이다.
  ⚠️ e2e에는 이 관측 축이 **없다**(fake 스트림은 프리롤 탭이 안 붙어 `clipPeak`가 실리지 않는다) —
  B안 검증은 **실기기 전용**이다.

### [UPLOAD-AUTH-1] 로그 백업이 **만료된 토큰으로 시작**해 첫 시도가 상시 죽는다
- **증상:** 2026-08-19 백업 시도 **5회 중 4회 첫 시도 실패**
  (`drive_upload:partial:fail=user_drive,admin_drive:ok=-`). 사용자가 로그인 버튼을 누르면
  (`login_prompt_login_clicked` → `auth_signin_start` → `auth_token_settled:ms=939~2000`)
  재시도가 **전부 성공**했다. 그 클릭이 없던 세션(양혁진 07:24) 하나만 로그가 **6시간 뒤 수동
  재업로드 전까지 Drive에 없었다** — 클립 소실 조사의 핵심 증거가 그동안 통째로 비어 있었다.
- **근인:** 업로드 시작 전에 토큰 유효성을 확인하지 않는다. 두 레그(user·admin)가 **함께** 죽는
  것이 공통 상위 원인(인증)을 가리켰다. 실패 사유가 로그에 안 남는 것도 겹쳤다 —
  `e.split(':')[0]`으로 **레그 이름만** 남아 「왜 죽었는지」를 로그만으로 알 수 없었다.
- **해결(v0.50):** `ensureAccessToken({force})`(googleAuth) — 업로드 진입 시 선제 확보
  (`getStoredToken()`은 만료 1분 전부터 null, `signIn()`은 `prompt:''`라 무팝업 갱신).
  `uploadAuthRetry.ts` — 401/403이면 **강제 갱신 후 정확히 1회** 재시도(그 이상은 v0.22.0 P0가
  되돌린 폭주), 재시도가 아무 레그도 못 얻으면 **첫 결과를 지킨다**(부분 성공 보존).
  `drive_upload_error:<사유>` 신규 이벤트 — 이메일·토큰 마스킹, 120자 상한.
  🔴 기존 `drive_upload:*` 문자열은 **바이트 그대로**(SOP-003 파서 계약).
- **회귀:** `tests/v050-upload-auth-retry.spec.ts` 6건(주입형 — fetch·GIS 불필요).
- **현재 상태:** 🟡 **MONITORING** — 다음 업로드 회차에서 `drive_upload:ok`가 **첫 시도에** 나는지,
  실패 시 `drive_upload_error:`에 사유가 남는지로 판정.

### [DECIMAL-DISPLAY-1] 시트에 `40.0`이 아니라 `40`으로 보인다 — 문자열 패딩으로는 못 고친다
- **증상(민구 제보 08-19 07:30):** *"값 입력시 실수는 소수점까지 저장. 예: 40 >> 40.0 /
  각 항목마다 유효 소수점이 존재"*
- **🔴 함정:** `appendRow`/`appendRows`가 `valueInputOption=USER_ENTERED`라 **`"40.0"` 문자열을
  보내도 Sheets가 숫자 40으로 강제**하고 표시는 셀 서식이 정한다. 값 쪽을 깎으면
  「고쳤는데 안 고쳐진」 형상이 된다. (같은 강제 변환이 반대 방향으로 이미 알려져 있다 —
  `pastValuesIndex.ts` r4 M9: 앱의 `'1.0'`이 시트에서 `'1'`로 그려져 2차 대조가 깨졌다.)
- **해결(v0.50):** 값은 숫자로 두고 **표시만** 바꾼다 — `sheetNumberFormat.ts`가 `float` +
  `decimals` 컬럼만 골라 `repeatCell` + `numberFormat{type:NUMBER,pattern:'0.0'}`을 만들고,
  **테이블 생성 확정 1회**(`onGenerateConfirm`)에 `void`로 적용한다(best-effort · 흐름 비차단).
  열은 **이름**으로 맞춘다(`sync.ts`의 `mapColumnsToHeader`와 같은 계약 — 위치로 맞추면 시트 열
  순서가 바뀐 순간 남의 열에 서식을 씌운다). 헤더 행 제외 · `fields`를 `numberFormat`으로 좁혀
  남의 색·테두리는 건드리지 않는다.
- **부작용 확인:** 과거값 2차 대조는 `canonicalDecimal`이 양쪽을 정규화하므로(`'40.0'` → `'40'`)
  서식 변경이 대조를 깨지 않는다. 값 자체를 안 건드리므로 sync dirty 판정에도 영향 없다.
- **회귀:** `tests/v050-sheet-number-format.spec.ts` 5건.
- **현재 상태:** 🟡 **MONITORING** — **실호출 미검증**(개발 환경에서 실계정 `batchUpdate` 불가).
  민구가 테이블 생성을 1회 하면 `sheet_number_format:ok|failed:cols=N[:status=]`로 즉시 판정된다.

### [AUTH-SF-1] signIn() single-flight가 「즉시 reject」라 동시 갱신 호출이 조용히 실패
- **증상:** 로그인/갱신이 진행 중일 때 두 번째 `signIn()` 호출이 `'이미 로그인 진행 중입니다.'`로
  즉시 reject — 앞 호출이 성공하는 중인데도 뒤 호출부는 실패 경로(재로그인 배너)로 수렴한다.
- **원인:** module-level `pending` 싱글톤의 single-flight가 **합류 없는 즉시 reject**로 구현돼
  있었다. 호출 지점이 설정탭 버튼 하나일 땐 무해했지만, v0.51의 제스처 안 선제 갱신
  (rauth P1 동기화 클릭 · P2 세션 시작)이 호출 지점을 늘리면서 경합이 실경로가 됐다
  (rauth P1ⓓ③이 선결 수리로 지목).
- **해결·회피(v0.51):** 동시 호출은 진행 중 flight의 **같은 promise에 합류** — 같은 결과(성공이면
  같은 토큰, 실패면 같은 사유)를 받는다. `auth_signin_start`는 선두만 내고 합류는
  `auth_signin_join`으로 분리 계측(start 1건:settle 1건 파서 계약 유지). 파생 방어:
  flight `origin`(user/silent) 구분 — silent 선두 flight만 12초 상한에서 통째 정리, 사람 합류 시
  origin 승격 · 콜백 세대/epoch 격리(버려진 클라이언트의 지각 콜백은 settle 금지, 로그아웃 경계를
  넘은 콜백은 저장까지 드랍).
- **회귀:** `tests/v051-signin-join.spec.ts` · `tests/auth-signin-timeout.spec.ts`(무수정 green =
  타임아웃·지각 콜백 계약 보존의 증거).
- **출처:** `plans/2026-08-27-agri-voicenote-login-sliding-window.md` §2-4 ·
  리뷰 합집합 `deliverables/2026-08-27-login-sliding-window-review-union.md`(teamops)
- **현재 상태:** ✅수정됨 (v0.51 로그인 슬라이딩 회차)

---

## 2026-09-01 v0.50.0 정식 실기기 회차 — A축 (회차 정본: `workspace_teamops/deliverables/2026-09-01-device-round-synthesis.md` · 설계·구현 SSOT: `…/2026-09-01-axis-a-design.md`)

### [CLIP-MUTED-SPAN-1] 마이크를 OS가 가져간 동안에도 녹음을 계속하고, 그 결과를 정상 커밋으로 처리한다
- **증상(폐기 세션 `sess_1788216390429` 실측 · 07:46:30~07:49:47):**
  ```
  07:46:34  clip  mic_track_evt:mute                                    ← 마이크 전달 정지
  07:46:35  stt   lifecycle:error:audio-capture
  07:46:35  app   bg_enter_snapshot:rec=recording,track=muted            ← 앱은 「녹음 중」
  07:46:54  app   beep_play:kind=commit,result=suspended,ctx=interrupted ← 확인음이 안 울렸다
  07:46:55  error clip_too_small:5                                       ← 5바이트
  07:47:05  error clip_too_small:5
  07:49:11  error clip_empty
  ```
  🔴 **사용자가 받은 신호 셋이 전부 거짓이었다** — 👁 절전 화면은 「음성 입력은 계속됩니다」,
  👂 확인음은 `suspended`(안 울림), 📊 결산은 실패를 세지 않았다. 값(STT)은 별도 오디오 경로라
  **시트까지 정상 도달**했고, 그래서 화면·시트 어디에도 이상이 없었다.
- **방아쇠는 백그라운드가 아니라 오디오 인터럽트다**(회차 종합 §1-4, 5세션 실측):
  `vis=hidden` 3회에도 `track=muted` 0인 세션은 클립 사망 0. **`track=muted`가 동반될 때만 죽는다.**
- **근인 2가지 — 둘 다 「없는 코드」였다:**
  ① `mic_track_evt:mute`는 v0.50부터 로그에 남고 있었으나 **아무도 소비하지 않았다.** 트랙이
     muted여도 `startClip()`은 그냥 시작하고, 그 클립은 정상 커밋 경로를 그대로 탄다.
  ② `clip_duration`의 `trackState`는 **종료 시점 스냅샷**이라 `mute→(클립 전체)→unmute`가 클립
     안에서 끝나면 `live`로 찍힌다 — **무음 클립인데 로그는 「정상 트랙」이라고 말한다.**
- 🔴 **고치면 안 되는 것 2개**(둘 다 의도된 방어 설계 — 초판 처방이 여기서 틀렸다):
  · `isStreamLost()`가 muted를 「살아 있음」으로 보는 것 → 래치하면 **멀쩡한 마이크에 재연결
    배너**가 뜬다(`getTrackState()` 주석 :354~358이 SSOT).
  · 자동 재연결 스킵(`mic_auto_reconnect:skipped=stream_live` · v0.50 r2 [CF-1]) →
    `recoverStream`은 destructive-first라 제스처 밖 `getUserMedia` 거부 시 **멀쩡한 스트림까지
    잃는다**(v0.22.0 P0가 롤백한 사고 · [IOS-5]).
  👉 이 두 자리는 **새 개념을 옆에 두는 방식**으로 우회했다(아래).
- **함께 닫은 것(B축 — 회차 종합 §2-보정):** muted 구간 클립이 `EMPTY_CLIP_BYTES(200)`을
  **넘겨** 나오면 종전 코드는 `clip_saved`로 세고 `recordSaved()`가 **연속 실패 카운터까지
  리셋**했다. 실측이 5바이트였던 것은 iOS의 그 구간에서 그랬을 뿐, **크기는 기기·구간 길이에
  따라 변한다.** (초판이 B축 실증으로 든 양훈성 `saved=66,failed=0`은 `track=muted` 0이라
  **거짓말이 아니었다** — 대조군으로 유지한다.)
- **해결(v0.51 · 민구 확정 2026-09-01 ①A②A③A):**
  · **감지** — `ClipSlot.sawMuted` 단방향 래치 3경로(시작 시점 판정 · 트랙 `mute` 이벤트 ·
    닫을 때 보강) → `ClipResult.mutedSpan` → `clip_duration`에 muted일 때만 필드 동봉.
  · **회계** — `clipHealth.unreliable` **제3의 칸**. 🔴 `recordUnreliable()`은 `streak`를
    증가도 리셋도 하지 않는다(증가 → 재연결 배너 / 리셋 → 「리셋은 clip_saved에서만」 위반).
    **파일은 그대로 저장한다** — 바꾸는 것은 저장 여부가 아니라 회계다(보존 우선).
  · **고지** — `micInterruption.ts`(pub/sub) + `useMicInterruptionNotice.ts`(단일 배선):
    절전 화면·홀드 문구가 실상태를 말하고, 3초(`MIC_INTERRUPT_BLACKOUT_RELEASE_MS`) 넘으면
    절전을 **구간당 1회** 자동 해제하며, **회복 직후에만** 한 문장 말한다(muted 중에는 오디오
    출력도 죽어 있어 발화가 들리지 않는다).
  · **집계·감사** — 신규 `clip_unreliable_summary:muted=<n>,spans=<m>`(`clip_summary`는 바이트
    불변) · 종료 화면 경고 문구 분리 · `clips-manifest.json`에 `mutedSpan`(clipKey 정확 매칭).
- **회귀:** `tests/v051-mic-muted-span.spec.ts` 7건. **반증 6종 실측 red 확인**(시작 판정 제거 →
  2건이 1건 · 이벤트 래치 제거 → 0건 · 종전 회계 복원 → 종료 화면 침묵 · muted를 failed로 계수 →
  `mic_lost:clip_muted` 관측 = 금지사항 위반이 즉시 드러남 · 문구 분기 제거 · 자동 해제 제거).
  ⚠️ **종료 시점 보강만은 고립 반증 케이스가 없다** — 이중 방어라 단독으로 red를 못 만든다.
- **⚠️ e2e가 재는 것과 못 재는 것:** `window.__setFakeTrackMuted()`는 **표면**(readyState는 live,
  muted만 true)을 만들 뿐 **iOS가 언제 그것을 만드는지는 재현할 수 없다**
  (`v050-clip-silent-latch` 헤더의 같은 한계).
- **현재 상태:** 🟡 **MONITORING** — 데스크톱 회귀·반증 완료. **실기기 판정 대기**:
  세션 중 전화/Siri로 인터럽트를 만들어 ⓐ `clip_unreliable:muted`가 남는가
  ⓑ 절전 화면 문구가 실제로 바뀌는가 ⓒ 3초 뒤 화면이 열리는가 ⓓ 회복 후 고지가 들리는가.
  🔴 임계 3000ms는 **실측 1건(41초 인터럽트)에서 고른 값**이다 —
  `mic_interrupt:off:*:ms=<N>` 분포가 쌓이면 다음 회차가 조정한다.
