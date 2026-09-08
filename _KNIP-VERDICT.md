# knip 검출물 판정표 (baseline 2026-08-11 · 재검증 2026-08-12)

> 08-10 회차(`825dc9e`)가 `npm run check:unused`(knip)를 도입하면서 **검출물을 하나도 지우지 않고**
> "판정과 제거는 사람 몫"이라고 남겼다. 이 문서가 그 판정이다. **코드는 한 줄도 바꾸지 않았다.**
>
> 대상: `knip@6.32.0` · 검출 **83건**(파일 3 · export 64 · 타입 15 · 중복 export 1) · 전량 판정.
>
> **08-12 회차** — 판정을 새로 하지 않고 **직전 판정을 반증했다.** §12가 스스로 적어둔 한계 ③을
> 실측해 **판정 5건이 틀렸음**을 찾아 §13에 실었다(조치가 뒤집힌 것 2건). 코드는 여전히 무변경.

---

## 🔴 이 문서를 읽는 사람이 가장 먼저 알아야 할 것

**knip의 「unused export」는 「죽은 코드」가 아니다. 「어디서도 import되지 않음」이다.**

export·타입 검출 79건 중 **52건은 자기 파일 안에서 정상적으로 쓰이고 있다**(§8). 이들에 대해
knip의 발견이 뒷받침하는 유일한 조치는 **`export` 키워드 제거**이고, **심볼 삭제가 아니다.**
`npm run check:unused` 출력의 "Unused exports (64)"만 읽고 심볼을 지우면 **앱이 깨진다.**

실제로 심볼째 사라져도 되는 후보는 **11건**뿐이며, 그것도 전부 「후보」다(§4).

---

## 1. 판정 요약

| # | 판정 | 건수 | 조치 |
|---|------|------|------|
| §2 | **의도적 보존** — 되살리는 방법이 소스에 적혀 있다 | 2 | 유지. 건드리지 마라 |
| §3 | **계약 상수** — 스펙이 *일부러* import 안 하고 값을 복제한다 | 8 | 유지. `export` 제거도 재검토 대상 |
| §4 | **완전 미사용 후보** — 파일 안팎 어디서도 안 쓰임 | 11 | 다음 회차 제거 후보(민구 승인 필요) — 🔴 **단 2건은 §13-A에서 철회(실질 9건)** |
| §5 | **상속 복제 유물** — survey-011에서 한 번도 쓰인 적 없다 | 2(파일) | 제거 후보. 근거 최강 |
| §6 | **죽은 호환 재노출** — "기존 경로 호환"인데 그 경로 이용자가 0 | 2 | 제거 후보 |
| §6′ | **살아 있는 재노출** — 스펙이 배선을 감시한다 (`applyAppSchema`) | 1 | 🔴 유지. §6과 혼동 금지 |
| §7 | **픽스처 미채택 부채** — SSOT 픽스처를 두고 스펙이 로컬 복제 | 4 | 🔴 제거 금지. 반대로 채택이 답이다 |
| §8 | **`export` 키워드만 불필요** — 파일 안에서는 살아 있다 | 52 | 심볼 삭제 금지 — 🔴 **4건은 §13-B·C에서 값 계약 보유로 승격**(§3 취급) |
| §9 | **중복 export**(별칭) | 1 | 유지. 통합은 제안만 |
| §10 | **판정 제외** — 오디오 3파일 규칙 | (§8 내 1건) | 판정하지 않음 |

합계 검산: 2 + 8 + 11 + 2 + 2 + 1 + 4 + 52 + 1 = **83** = knip 출력 83건. **전량 판정, 누락 0.**
각 검출물은 **정확히 한 절**에만 계수된다(§10의 `createRecognition`은 §8 안에 있고 그 자리에 「제외」로 표시했다).

> 🔴 **2026-08-12 재판정 — §13을 먼저 읽어라.** §12 한계 ③(「값만 박힌 계약」 누락)을 실측으로
> 닫으면서 **판정 5건이 틀린 것으로 드러났다.** 그 중 `RECOGNITION_TOLERANCE_MIN`·`MAX`는
> **조치가 정반대로 뒤집힌다**(제거 후보 → 🔴 제거 금지). 계수는 위 표 그대로 두었다 —
> §13은 계수 절이 아니라 **조치 갱신 절**이다(각 검출물의 계수 절은 여전히 하나뿐이다).

knip 출력 축으로도 검산된다 — **파일 3**(§2 1 + §5 2) · **export 64**(§2 1 + §3 8 + §4 9 + §6 2 +
§6′ 1 + §7 4 + §8 39) · **타입 15**(§4 2 + §8 13) · **중복 1**(§9).

---

## 2. 의도적 보존 (2건) — 🔴 지우지 마라

| 대상 | 근거 |
|------|------|
| `src/components/settings/BeepPicker.tsx` (파일) | v0.46.0 WP-I(민구 지시 08-05)가 **렌더만 제거하고 파일은 남겼다.** `SessionOptionsSection.tsx:213-221`에 되살리는 절차가 적혀 있고, `tests/v033-beep-help.spec.ts:117`도 같은 절차를 참조한다 |
| `previewBeep` — `src/lib/beep.ts:216` | 유일한 소비자가 위 `BeepPicker.tsx`다. 파일 보존이 결정된 이상 이 export도 함께 남는다. ⚠️ 알려진 갭: `tests/feature-isolation.spec.ts:12`가 "직접 단언 미보유(beep.ts previewBeep try/catch 계약, 백로그)"라고 **스스로 무가드임을 기록**해뒀다 |

---

## 3. 계약 상수 (8건) — 스펙이 일부러 import하지 않는다

이 축이 이번 판정에서 **가장 틀리기 쉬운 곳**이다. import가 0인 이유가 「죽어서」가 아니라
**「import하면 오라클이 죽어서」**다. 스펙이 그 이유를 직접 적어놨다:

> `tests/v043-fit-group.spec.ts:8` — *"🔴 리터럴로 고정: 제품 상수를 import하면 상수가 바뀔 때
> 기대값이 자동 추종해 파손을 감춘다."*
>
> `tests/v0480-p1-check-vertex.spec.ts:34` — *"제품 상수를 import하지 않는 건 의도다: 제품이
> 상수를 바꿔도 계약은 여기 남아야 오라클이 신호를 낸다."*

| 심볼 | 값 | 감시하는 스펙 |
|------|-----|--------------|
| `HERO_MIN_FONT_PX` — `heroLayout.ts:6` | (복합) | `v043-fit-group.spec.ts:9,10,359,377,430` — 로컬 `const`로 복제 |
| `USABLE_ROWS` — `StateDots.tsx:69` | 10 | `v0480-p1-check-vertex.spec.ts:34,64,66,75,155` · `v0460-g-dot-pill.spec.ts:59,119` |
| `FIELD_ROWS` — `StateDots.tsx:46` | 14 | `_probe-fb5-threshold.spec.ts:6,56` · `v0460-g-dot-pill.spec.ts:119` |
| `RESERVED_ROWS` — `StateDots.tsx:71` | 4 | `_probe-fb5-threshold.spec.ts:6` · `v0461-p-dot-pill-short.spec.ts:31` |
| `FIELD_COLS` — `StateDots.tsx:45` | — | `KNOWN-ISSUES.md:1818` |
| `VOICE_COMMIT_MARK_MS` — `useVoiceCommitMark.ts:15` | 1500 | `v047-w4-commit-mark-session.spec.ts:6,99` · `v035-hero-confirm.spec.ts:431,433` |
| `HOLD_TO_WAKE_MS` — `BlackoutOverlay.tsx:75` | 2000 | `v0470-w7-hold-blackout.spec.ts:62` — *"제품 상수와 같아야 한다"* · 🔴 **`v0460-cr-blackout-escape.spec.ts:82`**(`const WAKE_HOLD_MS = 2000`) — 08-12 재판정에서 보강. 소스 주석 `BlackoutOverlay.tsx:70-72`가 **두 스펙을 이름으로 지목**하는데 이 표는 하나만 적고 있었다 |
| `HOLD_TO_BLACKOUT_MS` — `HeroHoldToBlackout.tsx:65` | 3000 | `v0470-w7-hold-blackout.spec.ts:58` — *"import하지 않는 건 의도다"* |

**조치:** 전부 유지. `export` 키워드 제거조차 신중하다 — 값이 스펙에 리터럴로 복제돼 있어 **상수를
지우면 소스와 스펙이 조용히 갈라지고, 갈라진 것을 알려줄 오라클이 없다.**

⚠️ `BEEP_VOLUME_MAX`(값 12)도 같은 성격의 계약이지만(`v0440-d1-bargein.spec.ts:221`이
*"기대값을 숫자로 박는다. BEEP_VOLUME_MAX를 import해 비교하면 상수만 바꿔도 초록이 된다"*,
`beep-release.spec.ts:15,162`도 값 12를 리터럴로 박음), **knip이 잡은 것은 SSOT인
`beepVariants.ts:128`이 아니라 `beep.ts:24`의 재노출**이다. SSOT 쪽은 `beep-volume.spec.ts:8`이
실제로 import하므로 검출되지 않았다. 따라서 검출물로서의 판정은 §6이다 — **혼동 금지.**

---

## 4. 완전 미사용 후보 (11건) — 파일 안팎 어디서도 안 쓰임

| 심볼 | 위치 | 마지막 관련 커밋 | 비고 |
|------|------|-----------------|------|
| `AppSettings` | `src/types.ts:60` | `04fbdef` 2026-06-04 | **초기화 이후 무변경** — §5와 같은 상속 유물 |
| `VoiceState` | `src/types.ts:145` | `04fbdef` 2026-06-04 | 동상 |
| `loadUnsyncedSessions` | `src/lib/db.ts:159` | `04fbdef` 2026-06-04 | 동상 |
| `deleteAudioClip` | `src/lib/db.ts:216` | `c45fa27` 2026-06-04 | v0.3.0 정정 클립 보존 |
| `appendRow` | `src/lib/sheets.ts:435` | `e431b1a` 2026-07-07 | **구세대 API** — 후속은 `appendRows`(`sync.ts:3`이 그걸 쓴다) |
| `OVERLAY_DIM_STRONG` | `src/components/ModalBase.tsx:7` | `0eab777` 2026-08-02 | 값 `rgba(0,0,0,0.68)` — 종료 확인용. 인라인 종료 확인 도입 때 소멸한 듯 |
| `HERO_FIT_STEPS` | `src/components/voice/useFitScale.ts:23` | `36a01b1` 2026-08-01 | upward-open fit group 도입 때 대체된 듯 |
| `PRIMARY_COMMANDS` | `src/lib/voiceCommands.ts:136` | `bbf6a1e` 2026-07-08 | v0.31.0 입력탭 UI 개편 |
| ~~`RECOGNITION_TOLERANCE_MIN`~~ | `src/stores/settingsStore.ts:85` | `a903d76` 2026-07-03 | 🔴 **판정 철회 — §13-A 참조.** 사체가 아니라 **채택 못 된 SSOT**(§7 성격)다. 제거 금지 |
| ~~`RECOGNITION_TOLERANCE_MAX`~~ | `src/stores/settingsStore.ts:86` | `a903d76` 2026-07-03 | 🔴 **판정 철회 — §13-A 참조.** 동상 |
| `trimSilenceToWav` | `src/lib/audioTrim.ts:434` | `8360b64` 2026-06-10 | ⚠️ **제거 제안 붙이지 않음** — 소비자였을 `audioRecorder.ts`가 규칙 5 제외 대상이라 소멸 경위 추적이 막혔다 |

**조치:** 전부 「후보」다. 이번 회차는 제거하지 않았다. 🔴 제거는 민구 승인 뒤에 한다 —
**삭제된 심볼은 어떤 테스트도 잡아주지 못한다.**

> 🔴 **2026-08-12 정정 — 이 절은 11건이 아니라 9건이다.** `RECOGNITION_TOLERANCE_MIN`·`MAX`는
> §13-A에서 판정이 철회됐다(제거 후보 → **제거 금지**). 「파일 안팎 어디서도 안 쓰임」이라는
> **관측은 맞았지만 결론이 틀렸다** — 값이 소스에 리터럴로 복제돼 살아 있어서, 미사용의 사인이
> 「죽음」이 아니라 「SSOT 미채택」이었다. 이 절에 남은 9건은 그 축을 다시 재서 **복제본 0**임을
> 확인했다(§13-D). 계수는 §1 표 그대로 11로 둔다.

---

## 5. 상속 복제 유물 (파일 2건) — 근거가 가장 강하다

| 파일 | 이력 |
|------|------|
| `src/components/Chip.tsx` | `04fbdef` 2026-06-04 *"survey-011 초기화 (growth-survey-010 독립 복제, v0.1.0)"* **이후 커밋 0건** |
| `scripts/test-sheets-url.mjs` | 동상 — `04fbdef` 이후 커밋 0건 |

즉 **조상 레포에서 복제돼 온 뒤 survey-011에서 단 한 번도 손대거나 쓰인 적이 없다.**
「기능이 소멸한 사체」가 아니라 「처음부터 이 레포의 코드가 아니었던 것」이다.

⚠️ `Chip.tsx`와 `ColumnChip.tsx`는 **다른 파일**이다. `ColumnChip.tsx`는 현역이고 여러 스펙이 참조한다
(`heroLayout.ts:81` · `v037-chip-2row.spec.ts:34` · `v0461-edit-chip-width.spec.ts:238`).
이름이 비슷해 grep으로는 갈라지지 않는다 — 이것이 08-10 회차가 grep에서 모듈 그래프로 옮긴 이유다.

---

## 6. 죽은 호환 재노출 (2건)

두 곳 모두 주석이 **"기존 import 경로 호환"**이라고 말하는데, 실측한 importer는 **전부 SSOT 모듈을
직접 import한다.** 호환시켜 줄 대상이 0이다.

| 재노출 | 주석이 말하는 것 | 실측 |
|--------|-----------------|------|
| `export { BEEP_VOLUME_MAX }` — `src/lib/beep.ts:24` | *"재노출(기존 import 경로 호환). 매핑·상한 SSOT는 beepVariants.ts"* | 유일 소비자 `tests/beep-volume.spec.ts:8`이 `'../src/lib/beepVariants'`에서 직접 import. `beep.ts` 경로 이용자 **0** |
| `export { recountSynced } from './sessionSync'` — `src/lib/sync.ts:19` | *"Re-export so existing importers of recountSynced from sync.ts keep working (SSOT now in sessionSync)"* | `dataStore.ts:3`·`useVoiceSession.ts:6` 모두 `'./sessionSync'`에서 직접 import. `sync.ts` 경로 이용자 **0** |

**조치:** 제거 후보. 단 이번 회차는 제거하지 않았다.

---

## 6′. 살아 있는 재노출 (1건) — 🔴 §6과 혼동 금지

`tests/fixtures/idb.ts:30`의 `export { DB_NAME, DB_VERSION, applyAppSchema }`도 형태는 §6과 같지만 **유지**다:

- 같은 줄의 `DB_NAME`·`DB_VERSION`은 knip이 **미사용으로 잡지 않았다** — 스펙들이 실제로 import한다.
  즉 **재노출 배선 자체는 살아 있다.**
- `applyAppSchema`는 파일 안에서 `APPLY_APP_SCHEMA_SOURCE`를 만드는 데 쓰인다(내부 참조 4건).
- 결정적으로 `tests/idb-fixture.spec.ts:39-40`이 이 배선을 **감시 대상으로 명시**한다:
  *"이 가드는 계속 가치가 있다: ① **재수출 배선이 깨지거나** ② upgrade가 applyAppSchema 밖에서…"*

스펙이 지키겠다고 적어둔 배선이다. 지우면 그 가드가 무의미해진다.

---

## 7. 픽스처 미채택 부채 (4건) — 🔴 제거가 아니라 채택이 답이다

`tests/fixtures/`의 공용 픽스처가 export하는데 **아무 스펙도 import하지 않는다.** 그런데 같은 이름이
스펙마다 **로컬 `const`로 재선언**돼 있다. 픽스처가 SSOT여야 할 자리에서 복제본이 번식했다.

| 픽스처 export | 위치 | import | 로컬 재선언 |
|--------------|------|--------|------------|
| `MOCK_INIT_SCRIPT` | `tests/fixtures/activeZones.ts:98` | **0** | **35개 스펙** (`log-replay:45` · `v037-chip-2row:90` · `v035-r3-fixes:56` · `safe-area:221` …) |
| `HEADERS` | `tests/fixtures/activeZones.ts:91` | **0** | **19개 스펙** — 값도 제각각(`['조사일자','농가명','횡경']` ↔ 6열 버전 등) |
| `SHEET_ROWS` | `tests/fixtures/activeZones.ts:92` | **0** | **12개 스펙** |
| `fireSttAlts` | `tests/fixtures/stt.ts:152` | **0** | `decimal-targeted-reask.spec.ts:112`가 동명 함수를 로컬 정의 |

⚠️ 이 4건은 grep으로 세면 각각 85·56·26·6건이 잡혀 **"활발히 쓰이는 중"으로 보인다.** 전부
로컬 재선언이거나 그 로컬 심볼의 호출이다. **grep 히트 수를 판정으로 쓰면 여기서 정확히 틀린다**(`TEAMOPS-5`).

같은 파일의 `boot`·`stubSheets`·`PHONE_402`·`fillAllRows`·`installVoiceMocks`·`fireStt`는 정상적으로
import돼 쓰인다 — 픽스처 파일 전체가 죽은 게 아니라 **이 4개 심볼만 채택되지 못했다.**

**조치:** 🔴 제거하지 마라. 제거하면 「복제본 35벌」이라는 실제 부채가 검출기 시야에서 사라진다.
`MOCK_INIT_SCRIPT` 복제본 35벌이 서로 드리프트하고 있는지는 **이 문서의 범위 밖**이며,
독립 회차가 필요하다(§11 제안 ①).

> 🔴 **2026-08-12 — 이 절의 구조가 `tests/`에만 있는 게 아니었다.** §13-A가 `src/`에서 같은 것을
> 찾았다(`RECOGNITION_TOLERANCE_MIN`·`MAX`). 08-11 판정은 그것을 §4「제거 후보」로 보냈다 —
> **이 절과 §4를 가르는 축은 「미사용이냐」가 아니라 「그 값이 어딘가에 복제돼 살아 있느냐」다.**

---

## 8. `export` 키워드만 불필요 (52건) — 🔴 심볼 삭제 금지

전부 **자기 파일 안에서 쓰이고 있다.** 외부 import만 0이다.

### 8-a. 문서·스펙이 이름으로 언급하는 것 (14건)

`export`를 떼도 이 참조들은 유효하게 남는다(이름을 지우는 게 아니므로). 다만 **심볼째 지우면 문서가 매달린다.**

| 심볼 | 위치 | 언급하는 곳 |
|------|------|------------|
| `buildAnomalyDisplay` | `anomalyAlert.ts:63` | `useVoiceSession.ts:2588`(주석) |
| `loadPastIndex` | `pastValues.ts:465` | `pastValues.spec.ts:3` — *"브라우저 의존부(loadPastIndex fetch+캐시)는 제외"* · `v034-past-index-apikey.spec.ts:54`(주석). 내부 참조 10건 |
| `robustPeak` | `audioTrim.ts:126` | `ENGINEERING-GUARDRAILS.md:156` · `KNOWN-ISSUES.md:708,710` |
| `LOG_FOLDER_ID` | `driveUpload.ts:10` | `KNOWN-ISSUES.md:614` |
| `readBundleId` | `feedback.ts:66` | `v0470-w5-hero-echo.spec.ts:40` — *"document를 읽으므로 Node에서 못 잰다. 브라우저 오라클 미신설"* (알려진 갭) |
| `getClientId` | `googleAuth.ts:78` | `_AUTO-MAINT-HISTORY.md:12` (08-10 회차가 판정 사례로 인용) |
| `parseUpdatedRangeFirstRow` | `sheets.ts:465` | `KNOWN-ISSUES.md:490` |
| `updateRow` | `sheets.ts:555` | `KNOWN-ISSUES.md:484,502` · `sync.ts:283`(주석) — **구세대 API**. `sync.ts:3`은 `updateCellsSparse`를 쓴다 |
| `createRecognition` | `speech.ts:59` | 🔴 **§10 판정 제외 — 오디오 3파일** |
| `parseNumeric` | `trendCheck.ts:38` | `anomalyAlert.ts:33`·`anomalyAlert.spec.ts:166`(주석) |
| `SETTINGS_TIP_SEEN_KEY` | `useSettingsActions.ts:47` | `helpCopy.ts:105` · `settings-ux.spec.ts:246` |
| `applySemanticDefaults` | `settingsStore.ts:219` | `helpCopy.ts:59` · `v033-beep-help.spec.ts:102` |
| `makeSettingsDefaults` | `settingsStore.ts:273` | `useSettingsActions.ts:421`(주석) |
| `SessionMeta` (타입) | `logger.ts:71` | `v023-voice.spec.ts:160` |

### 8-b. 언급 없음 (38건)

> 🔴 **2026-08-12 정정 — 이 제목은 부정확했다.** 「이름 언급이 없음」과 「계약이 없음」은 다른데
> 이 절은 둘을 같이 취급했다. 아래 🔴 표시 4건은 **이름은 없지만 값이 스펙에 리터럴로 박혀 감시
> 중**이다 — §3과 같은 취급이 맞다(**값을 바꾸려면 그 스펙의 리터럴도 함께 바꿔야 한다**).
> 나머지 34건은 재실측에서 계약 없음이 확인됐다(§13-D). 근거는 §13-B·C.

| 심볼 | 위치 |
|------|------|
| `formatAge` | `ConnectionStatusCard.tsx:31` |
| `OVERLAY_DIM` | `ModalBase.tsx:5` — ⚠️ 소스 복제 1건(§13-E) |
| 🔴 `RELEASE_STEPS` · `RELEASE_STEP_MS` | `BlackoutOverlay.tsx:78,80` — **값 계약 보유(§13-B)** |
| `COMPLETE_RECEIPT_MS` | `CompleteSummary.tsx:8` |
| `COMPLETE_SUMMARY_MIN_FONT_PX` · `COMPLETE_RECEIPT_MIN_FONT_PX` · `HERO_LABEL_PROVISIONAL_RESERVE_PX` | `heroLayout.ts:8,14,19` |
| `CHIP_SWEEP_FASTEST_SECONDS` · `CHIP_SWEEP_SLOWEST_SECONDS` · `CHIP_SWEEP_MAX_SECONDS` | `chipSweep.ts:43,46,64` — 계약 없음 확인. 🔑 스펙이 리터럴을 **금지**하고 SSOT를 import한다(§13-D 반례) |
| 🔴 `CHIP_SWEEP_MIN_TRAVEL_PX` | `chipSweep.ts:81` — **값 계약 보유(부분·§13-C)** |
| `uploadLogToUserDrive` · `uploadLogToAdminTeamFolder` | `driveUpload.ts:159,234` |
| `CAPTURE_TIMEOUT_MS` · `feedbackFilename` · `buildFeedbackZip` · `flushFeedbackQueue` | `feedback.ts:43,46,103,263` |
| `legacySessionLabel` | `legacySyncFlow.ts:37` |
| `SEQ_BUTTON_MAX` | `manualInput.ts:19` |
| `excludedFor` | `optionExclusions.ts:22` |
| `CAPTURE_JPEG_QUALITY` | `screenshot.ts:24` |
| `fetchAllRows` | `sheets.ts:393` — **구세대 API**(후속 `fetchAllRowsUnbounded`, `sheets.ts:418`) |
| `parseValueForColWithReason` | `valueParseAttempt.ts:182` |
| 🔴 `SIMULATED_INSETS` | `tests/fixtures/safeArea.ts:14` — **값 계약 보유(§13-C)** |
| `VOICE_MOCK_INIT_SCRIPT` | `tests/fixtures/stt.ts:33` — §7 아님. `stt.ts:122-123`의 `installVoiceMocks`가 쓰고 스펙은 그 함수를 import한다(정상 배선·§13-D) |
| **타입 12건** — `FitMemberRef`(`useFitGroup.ts:4`) · `BeepSegment`(`beepVariants.ts:13`) · `FailedCellCommit`(`cellPersistError.ts:21`) · `ClipManifestEntry`(`clipsManifest.ts:40`) · `ManualChoiceKind`(`manualInput.ts:21`) · `ListRecoverResult`(`recoverFromDrive.ts:46`) · `SheetInfo`(`sheets.ts:17`) · `ColParseResult`·`ParseAttemptEvent`(`valueParseAttempt.ts:35,44`) · `AutoValue`·`TrendRule`(`types.ts:6,14`) · `NodePrint`(`tests/fixtures/previewVerify.ts:46`) | |

---

## 9. 중복 export (1건)

`src/lib/chipSweep.ts` — `CHIP_SWEEP_MAX_SECONDS = CHIP_SWEEP_SLOWEST_SECONDS`(`:64`, 값 40)의
**별칭 관계**를 knip이 중복 export로 본다. 통합은 §11 제안 ③으로만 남긴다.

---

## 10. 판정 제외 — 오디오 3파일 규칙

`useVoiceSession.ts` · `audioRecorder.ts` · `speech.ts`는 리뷰 라운드 필수 대상이라 이 레인이 판정하지 않는다.
해당 검출물은 **`createRecognition`(`src/lib/speech.ts:59`) 1건**이며, §8-a에 위치만 적고 판정은 비웠다.

`audioTrim.ts`(`robustPeak`·`trimSilenceToWav`)는 위 3파일 닫힌 목록에 **없으므로** 판정 대상이다.
다만 `trimSilenceToWav`의 소비자였을 `audioRecorder.ts`가 제외 대상이라 소멸 경위를 추적할 수 없어,
§4에서 제거 제안을 붙이지 않고 후보로만 남겼다.

---

## 11. 다음 회차 제안 (이번 회차는 실행하지 않았다)

① **`MOCK_INIT_SCRIPT` 복제본 35벌 드리프트 조사** — 픽스처 SSOT와 각 스펙 로컬본이 실제로 갈라져 있는지.
   갈라져 있다면 그 자체가 오라클 신뢰도 문제다. §7이 근거.

② **§6 죽은 호환 재노출 2건 제거** — `beep.ts:24` · `sync.ts:19`. 두 파일 모두 스펙이 있어 규칙 6은 통과한다.
   🔴 `applyAppSchema`는 함께 지우면 안 된다(§6 혼동 주의).

   **실행 명세**(08-12 회차 실측 — 승인 회차가 그대로 집행할 수 있게 남긴다. 이번에도 미실행):
   - `src/lib/beep.ts` — **`:24` 한 줄만** 지운다(`export { BEEP_VOLUME_MAX };`).
     🔴 `:16`의 **import는 남겨라** — `:141`이 `Math.min(Math.max(0, mult), BEEP_VOLUME_MAX)`로 실제로 쓴다.
     지우면 클리핑 상한이 깨진다. 실측 importer: `beep.ts` 경로로 이 심볼을 가져가는 곳 **0**
     (`beep.ts`를 import하는 둘은 `BeepPicker.tsx:3`→`previewBeep` · `useVoiceSession.ts:16`→`playBeep`,`unlockAudioPlayback`).
   - `src/lib/sync.ts` — **`:19` 한 줄만** 지운다(`export { recountSynced } from './sessionSync';`).
     🔴 `:9`의 **import는 남겨라** — `:371`이 `recountSynced(mergedRows)`로 쓴다. 실측 importer: `sync.ts`
     경로 이용자 **0**(`FailureModal.tsx:3`→타입만 · `useDataActions.ts:12`→`syncSelected`,`SyncReport`).
   - 🔑 두 줄 다 `export { … }` / `export … from` 구문이라 **로컬 바인딩을 만들지 않는다** — 지워도
     같은 파일의 import·사용은 영향받지 않는다. 회귀는 `npm run build`(tsc)가 잡는다:
     누군가 이 경로로 import하고 있었다면 컴파일이 깨진다.

③ **`chipSweep.ts` 별칭 통합** — 스펙 보유(규칙 6 통과)라 방어 가능하지만 이번 과제는 판정이라 미실행.

④ **§4·§5 제거** — 민구 승인 필요. `Chip.tsx`·`test-sheets-url.mjs`·`AppSettings`·`VoiceState`·
   `loadUnsyncedSessions`는 `04fbdef` 이후 무변경이라 근거가 가장 강하다.

⑤ **`check:unused`를 `check:release`에 연결하지 마라 (현행 유지)** — 판정이 끝나도 §3·§7·§8의
   68건은 정당하게 남는다. 연결하면 exit 1로 배포가 막힌다. 「보고용」이 이 검사기의 올바른 자리다.

⑥ 🆕 **`RECOGNITION_TOLERANCE_MIN`·`MAX` SSOT 채택** (08-12 §13-A) — `settingsStore.ts:557-558`의
   coercion이 리터럴 `0.4`/`0.9` 대신 이 두 상수를 쓰게 한다. 그러면 미사용이 자연 소멸하고
   대역이 한 곳에서만 산다. 🔴 **`v026-tolerance-strict.spec.ts`의 리터럴 0.4/0.9는 그대로 둬라** —
   그건 [TEAMOPS-38] 관례(제품 상수 import 금지)라 없애면 오라클이 값 변경을 못 잡는다.
   같은 파일 안 편집이고 `v026-tolerance-strict.spec.ts`가 그 게이트를 재므로 규칙 6은 통과한다.

⑦ 🆕 **§13-B·C의 4건을 §3 계약 목록에 정식 편입** — `RELEASE_STEPS`·`RELEASE_STEP_MS`·
   `SIMULATED_INSETS`·`CHIP_SWEEP_MIN_TRAVEL_PX`. 지금은 §8-b에 🔴 표시로만 붙어 있다.
   문서 정리라 코드 변경이 없다.

---

## 12. 방법론과 한계

**어떻게 판정했나** — 각 심볼에 대해 세 축을 기계적으로 재고, 갈리는 것만 눈으로 확인했다:
① 자기 파일 **밖** 참조를 `import` / 로컬 동명 선언 / 주석 / 문서 / 실코드로 자동 분류
② 자기 파일 **안** 참조 수(선언 줄 제외) — §8과 §4를 가르는 축
③ `git log -S'<심볼>'` — "언제 죽었는지". §5의 근거가 여기서 나왔다

**knip 표본 검증** — `src/types.ts`의 `AppSettings`·`VoiceState`·`AutoValue`·`TrendRule`이 미사용으로
잡힌 것이 의심스러워 손으로 확인했다. **`types.ts` 밖 참조 0건 — knip이 맞았다.** 중앙 타입처럼
보이는 이름도 실제로는 아무도 참조하지 않는다.

**스캔 범위** — `src` `tests` `scripts` `shared` `docs` 루트 `*.md` `index.html`.
🔴 **`Deliverables/` · `design-handoff/` · `public/`은 보지 않았다.** `design-handoff/`는 knip도
ignore 대상(앱 빌드 밖 참고 산출물)이고 나머지도 앱 코드가 아니라 재실행하지 않았다.
이 범위 밖에서 참조하는 심볼이 있다면 이 판정표는 그것을 놓친다.

**이 회차의 실측** — 코드 무변경(이 문서 1개만 추가). `npm run check:docs` **EXIT=0**(문서 12→13개) ·
`npm run check:release` **EXIT=0** · `npm run check:unused` 출력이 판정 전후 **바이트 동일**(검출 83건 불변,
EXIT=1은 검출 존재 시 정상이며 게이트 밖이라 배포 무영향). src·tests 무변경이라 e2e는 재실행하지 않았다.

**한계** — ①런타임 동적 참조 중 `knip.jsonc`의 `paths` 매핑(`/src/*`)이 못 잡는 형태가 있다면 놓친다.
②§7의 복제본들이 서로 다른 값을 갖는지는 조사하지 않았다(제안 ①).
③~~값 리터럴 계약은 **스펙이 이름을 언급한 경우**만 확인했다 — 이름 언급 없이 값만 박힌 계약은 놓칠 수 있다.~~
   🔴 **2026-08-12 닫힘 — 이 한계가 실제로 판정을 5건 틀리게 했다. §13이 그 실측이다.**

---

## 13. 값 리터럴 계약 재검증 (2026-08-12) — §12 한계 ③을 닫는다

§12가 스스로 적어둔 한계 ③(*"이름 언급 없이 값만 박힌 계약은 놓칠 수 있다"*)을 실측했다.
**놓치고 있었다 — 판정 5건이 틀렸고, 그 중 2건은 조치가 정반대로 뒤집힌다.**

**방법** — §4·§8-b의 **값 상수 전량**(19건)에 대해 이름이 아니라 **값**으로 두 축을 쟀다:
① **소스 안 리터럴 복제** — 상수가 미사용인데 같은 값이 소스에 박혀 있으면 그건 「죽은 상수」가
   아니라 **「채택 못 된 SSOT」**(§7과 같은 구조)다. ②**스펙 안 리터럴 계약** — 값이 스펙에 박혀
   감시 중이면 §3과 같은 취급이다. 히트는 전부 **그 스펙이 그 심볼의 소유 모듈을 재는지**까지 확인했다
   (`0.68`·`24`·`4000` 같은 흔한 수는 무관 맥락 히트가 압도적이라 개수로는 아무것도 판정할 수 없다).

### 13-A. 🔴 판정 철회 2건 — `RECOGNITION_TOLERANCE_MIN` · `MAX` (§4 → §7 성격)

§4는 이 둘을 *"v0.26.0 허용범위 다이얼 **반전 원복**의 사체로 보인다"*며 **제거 후보**로 올렸다.
「파일 안팎 어디서도 안 쓰임」이라는 관측은 **맞다**. 사인(死因) 진단이 틀렸다:

| 축 | 실측 |
|----|------|
| 소스 리터럴 복제 | 🔴 **같은 파일** `settingsStore.ts:557-558` — `s.recognitionTolerance < 0.4 \|\| s.recognitionTolerance > 0.9` 로 **대역을 리터럴로 복제해 coercion 게이트를 돌린다** |
| 소스 주석 복제 | `ActiveControlSteppers.tsx:55` — *"허용범위(recognitionTolerance) **0.40~0.90** → %로 표시"* |
| 소스가 계약이라 선언 | `settingsStore.ts:82` — *"저장값·다이얼 위치·기본값(0.60)·**대역[0.40~0.90]은 전 과정 내내 불변**"* |
| 스펙 리터럴 계약 | `v026-tolerance-strict.spec.ts:163`(`setupAndStart(page, 0.9)` — T1 엄격 끝) · `:184`·`:203`(`0.4` — T2 관대 끝) · `:179` `expect(lowConf?.extra).toBe('tolerance:0.9,minConf:0.9')`. 그 스펙은 **`settingsStore`의 tolerance 매핑 전용 오라클**이고 헤더가 *"반드시 민구 결정 이력(settingsStore.ts 주석)을 확인하고 수정할 것"*이라 적었다 |

**대역 [0.4, 0.9]는 죽지 않았다 — 지금도 게이트·UI·스펙 셋이 함께 지키는 살아 있는 계약이고,
상수만 그 SSOT 자리에서 채택되지 못했다.** 이는 §7(픽스처 미채택 부채)과 **정확히 같은 구조**이며,
§7의 조치가 여기에도 그대로 적용된다:

> 🔴 **제거하지 마라. 제거하면 「대역이 리터럴로 복제돼 있다」는 실제 부채가 검출기 시야에서 사라진다.**
> 올바른 방향은 반대다 — `:557-558`이 이 상수를 **쓰도록** 채택하는 것(제안 ⑥).

⚠️ 제거해도 **앱도 스펙도 즉시 깨지지는 않는다**(리터럴 복제본이 남으므로). 그래서 위험하다 —
§4가 시키는 대로 지웠으면 **아무 오라클도 신호를 내지 않은 채** SSOT만 소멸했을 것이다.

> ✅ **집행됨 2026-08-14 R1(`15343ff`)** — 제안 ⑥ 그대로 위 리터럴(집행 시점 실위치
> `:583-584`로 드리프트돼 있었음)이 `RECOGNITION_TOLERANCE_MIN/MAX` 참조로 교체됐다.
> `v026-tolerance-strict` 8/8 green. ⚠️ **knip unused-export 검출은 남는다** — 같은 파일 내
> 사용은 임포터로 세지 않으므로 검출 성격이 §4(사체)→§8(export 키워드 불필요)로 이동했을
> 뿐이다. export 키워드 제거는 §8 자동 레인(Q3 승인분) 몫 — 여기서 지우지 마라.

### 13-B. `RELEASE_STEPS`(4) · `RELEASE_STEP_MS`(500) — §8-b「언급 없음」 → 값 계약 보유

소스 `BlackoutOverlay.tsx:236`이 `Math.round(p * RELEASE_STEPS) / RELEASE_STEPS`로 진행 격자를 만들고
`:231`이 `RELEASE_STEP_MS` 간격으로 틱한다. 스펙이 **그 격자를 값으로 감시한다**:

- `v0470-w7-hold-blackout.spec.ts:249` — *"**계단은 500ms 간격이므로** 900ms 시점엔 최소 한 칸 차 있어야 한다"*
  → 이어지는 `:251` `data-progress > 0` 단언이 `RELEASE_STEP_MS=500`에 걸려 있다.
- `:333-335` — *"여러 번 읽어도 **0.25 배수**만 나온다 = 연속 애니메이션이 아니다"* →
  `Math.abs(Number(v) * 4 - Math.round(Number(v) * 4)) > 1e-6` 로 **`RELEASE_STEPS=4`를 리터럴 4로 박아** 격자 밖 값을 red 처리.

**조치:** §8(export 제거 가능)은 유지하되 **§3 취급을 더한다** — 값을 바꾸면 위 두 리터럴도 의도를 갖고
함께 바꿔야 한다. `RELEASE_STEP_MS`는 `HOLD_TO_WAKE_MS / RELEASE_STEPS` 파생이라 §3의 `HOLD_TO_WAKE_MS`와
**같은 계약 뭉치**다 — 원래부터 §3 옆에 있었어야 했다.

### 13-C. `SIMULATED_INSETS` · `CHIP_SWEEP_MIN_TRAVEL_PX` — 같은 축, 밀도는 다름

| 심볼 | 값 | 스펙 계약 | 밀도 |
|------|-----|----------|------|
| `SIMULATED_INSETS` — `tests/fixtures/safeArea.ts:14` | `top:62,bottom:34` | `safe-area.spec.ts:113` — `expect(…).toBe('sa_insets:top=62,bottom=34,left=0,right=0,standalone=browser')` **바이트 단언** · `:112` *"픽스처가 주입한 --sat:62/--sab:34를 …그대로 기록해야 한다"* · `v0440-chip-viewport-sweep.spec.ts:176` *"픽스처와 같은 값: top 62 / bottom 34"* | **강함** — 픽스처 값을 바꾸면 즉시 red |
| `CHIP_SWEEP_MIN_TRAVEL_PX` — `chipSweep.ts:81` | `1` | `v046-chip-sweep.spec.ts:107` — `expect(chipSweepOffset(3000, 8, 1), '1px 이하는 왕복 아님').toBe(0)`. `chipSweepOffset`이 `shouldChipSweep`을 거치고 그 문이 `maxScroll > CHIP_SWEEP_MIN_TRAVEL_PX`(`:97`)다 | **부분** — 상수를 **0으로 낮추면 red**지만 2로 올리면 green 유지(한쪽 방향만 감시) |

### 13-D. 반례 — 판정이 옳았음이 확인된 것들 (이 축에서 닫힌 범위)

「전량 재검증」이 되려면 틀린 것만이 아니라 **맞은 것도 실측돼야 한다**:

- **`OVERLAY_DIM_STRONG`(`rgba(0,0,0,0.68)`) · `HERO_FIT_STEPS`(`[1.18, 1.1, …]`)** — 소스·스펙 리터럴 복제
  **0건**(`1.18` 히트 3건은 전부 `global.css`의 `filter: saturate(1.18)`로 무관). **§4 제거 후보 근거 유지.**
- **`CHIP_SWEEP_FASTEST_SECONDS`(12) 등 3건** — 🔑 **§3의 반대 사례다.** `v046-chip-sweep.spec.ts:132`가
  *"🔴 단계의 초는 **리터럴로 적지 마라** — chipSweep.ts의 배분식이 SSOT다(이중 기록 금지)"*라고 적고
  `:136`에서 실제로 `chipSweepSecondsForLevel(10)`을 **import해서 쓴다**. 주석의 "12초"는 설명 문자열일 뿐
  단언값이 아니다. 이 레포가 §3(리터럴 고정)과 SSOT import를 **축마다 갈라서** 쓰고 있다는 증거다.
- **`COMPLETE_RECEIPT_MS`(3000) · `SEQ_BUTTON_MAX`(24) · `CAPTURE_TIMEOUT_MS`(4000) ·
  `CAPTURE_JPEG_QUALITY`(0.45) · `COMPLETE_SUMMARY_MIN_FONT_PX`(24) · `COMPLETE_RECEIPT_MIN_FONT_PX`(15) ·
  `HERO_LABEL_PROVISIONAL_RESERVE_PX`(55)** — 히트는 전부 무관 맥락(playwright `timeout: 3000/4000`,
  `borderRadius: 24`, 존 비율 `24%`, `saturate` 계수 …). **§8-b 유지.**
- **`VOICE_MOCK_INIT_SCRIPT`** — §7(픽스처 미채택)이 아니다. `stt.ts:122-123`에서 `installVoiceMocks`가
  소비하고 스펙들은 그 함수를 import한다 → **배선 정상.** §8 유지.
- **§4의 비값 항목**(`AppSettings`·`VoiceState`·`loadUnsyncedSessions`·`deleteAudioClip`·`appendRow`·
  `PRIMARY_COMMANDS`·`trimSilenceToWav`) — 값이 아니라 이 축의 대상이 아니다. §4 판정 그대로.

### 13-E. 부수 발견 — `OVERLAY_DIM` SSOT 미채택 1건

`ModalBase.tsx:5`의 `OVERLAY_DIM = 'rgba(0,0,0,0.6)'`은 *"기존 셸들의 실측값을 이름으로 고정한다"*는
dim 토큰인데, `CommandHelpPopup.tsx:23`이 같은 용도(`background: 'rgba(0,0,0,0.6)'`)에서 **토큰을 안 쓰고
값을 박았다.** 13-A와 같은 구조지만 **스펙 계약이 0**이라 판정을 바꾸지는 않는다(§8-b 유지) — 메모만 남긴다.
(`PersistErrorBanner.tsx:48`·`CellPersistErrorBanner.tsx:53`의 같은 값은 `boxShadow`라 **다른 용도**다.)

### 13-F. 이 재검증의 한계

- **값 상수만 쟀다.** 함수·타입 검출물은 이 축의 대상이 아니다(§4의 `appendRow`류는 §12 방법 그대로).
- **소스가 값을 *변형*해 복제한 경우는 못 잡는다** — 예컨대 `0.4`를 `40/100`으로 적었다면 이 실측은 놓친다.
- **§12의 스캔 범위 한계(`Deliverables/`·`public/`)는 그대로다.** 이번에도 보지 않았다.
- `RELEASE_STEP_MS`(500)는 파생값이라 소스에 리터럴이 없다 — 스펙 쪽 리터럴만 쟀다.

## §14. 08-14 R1 이후 추기 — 잔존 기준선 명문화

### 14-A. 잔존 미사용 파일 기준선 = 1건(`BeepPicker.tsx`) — §2 판정 그대로, 신규 검출 아님

🔴 **정정(같은 날):** 이 절의 초판은 BeepPicker를 "판정표 기준 2건 대비 +1 신규 검출"로 적었다 —
**틀렸다.** BeepPicker(+`previewBeep`)는 **§2(의도적 보존)에 이미 행이 있고** baseline 83건의
파일 3에 계수돼 있었다(§1 검산: 파일 3 = §2 1 + §5 2). R1 착수 보고가 §2를 §5로 오독했고
초판이 그걸 옮겼다.
남는 유효 정보는 기준선뿐이다: **R1 P4가 §5의 2파일을 삭제한 뒤, knip 미사용 파일 잔존
1건(BeepPicker)은 기대 기준선이다** — 이후 대조 회차는 이 1건을 드리프트로 세지 마라.
삭제 금지·재도입 결정은 민구 몫(§2 그대로).

---

## §15. 08-19 자동 레인 추기 — 신규 검출 3건 판정 + 현행 인구조사

> 회차: `auto/maintenance` 자동 유지보수(무인) · 기점 `c25d612` · knip@6.32.0.
> 근거 과제: `deliverables/2026-08-16-r2-session-wrapup.md` 미결 #5(「신규 검출 3건 판정」).
> **이 절은 판정만이다 — knip 축의 코드는 한 줄도 바꾸지 않았다.**

### 15-0. 현행 HEAD 인구조사

`npm run check:unused` 실측: **미사용 파일 1 + 미사용 export 27 = 28**. 미사용 타입 0 ·
중복 export 0 · 미사용 의존성 0(baseline 83건에서 exp 레인·R1 정리를 거친 뒤의 현행값).

- 파일 1건은 `BeepPicker.tsx` — **§14-A 기준선 그대로**다. 드리프트로 세지 마라.
- export 27건 중 **24건은 이 문서에 이미 행이 있다**. 남은 **3건이 이 절의 대상**이다.
- 대조 방법(재현 가능): 검출 심볼 27개를 이 문서 전문에 `grep -c "\b<심볼>\b"` —
  히트 0인 것이 **정확히 3건**(`readPrevSurveyState` · `WOULD_SALVAGE_PREFIX` · `localISO`).
- ⚠️ **계수 드리프트 1건 기록.** 위 wrapup 미결 #5는 「잔존 27 + 신규 3」으로 적었다. 현행 HEAD는
  **「총 27 = 기존 24 + 신규 3」**이다. 재검출이 정본이므로(러너 규칙 10) 이 절의 수를 쓴다.
  잔존 24건은 **이 항목 밖** — 다음 knip 회차 몫.

### 15-A. `WOULD_SALVAGE_PREFIX` — `logEventsSession.ts:59` → **§3(계약 상수)**. 유지 · `export` 제거 금지

값 `'would_salvage:'`가 스펙에 **리터럴로 복제**돼 있다(§13이 연 값 리터럴 스캔 축 — 심볼 grep만
했으면 §8로 오판했을 자리다):

| 복제처 | 형태 |
|--------|------|
| `tests/v023-voice.spec.ts:570,585,604,614` | `startsWith('would_salvage:')` — B2-W4·A4-r2 단언의 판별자 |
| `tests/v023-voice.spec.ts:587` | `toBe('would_salvage:3.3')` — 값까지 박음 |
| `tests/v027-clips-manifest.spec.ts:233,251,302` | 픽스처 `extra: 'would_salvage:3.3'` |
| `tests/koreanNum.spec.ts:286` | 다음 회차 집계 명령(`extra^='would_salvage:'`) |

**임포터 0은 의도된 상태다.** `logEvents.ts:57`이 그 결정과 이유를 미리 적어뒀다 — *"r3 #10이
접두 판별을 구조 판별로 대체 — 배럴 재수출 없이 정의 파일에만 둔다. **knip 검출 파리티**."*
즉 이 검출은 **예고된 것**이지 드리프트가 아니다.

🔴 **부수 발견 — 소스 주석 1건이 낡았다(범위 밖이라 고치지 않았다).**
`logEventsSession.ts:57-58`은 접두를 상수로 올린 이유를 *"소비자(`clipsManifest.findLastCellEvent`)가
그걸 판별해야 하기 때문"* 이라고 적는다. 그런데 **r3 #10이 그 판별을 접두 allowlist에서 구조
판별(`extra` 유무)로 바꿨다**(`clipsManifest.ts:132-140`). 실측: `clipsManifest.ts`의
`would_salvage` 히트는 **주석 2줄뿐, 코드 0줄**이다. 지금 이 상수를 살려두는 근거는 그 주석이
지목하는 앱 소비자가 아니라 **위 표의 스펙 리터럴**이다. 근거가 갈아치워졌을 뿐 판정(유지)은
같다 — 주석 정정은 다음 회차 제안으로 남긴다.

### 15-B. `readPrevSurveyState` — `SettingsSummaryModal.tsx:69` → **§8(`export` 키워드만 불필요)**. 심볼 삭제 금지

같은 파일 `:126`에서 `usePrevSurvey`의 `useMemo`가 부른다 — **살아 있는 코드다.** import가 0인
것은 **v0.49 r2 A9가 이 계산의 소유자를 `SettingsScreen` → 팝업으로 옮겼기** 때문이고, 그때
`export`만 유물로 남았다. 08-11 baseline에 행이 없는 이유도 그것이다(그때는 화면이 import했다).

🔴 **`export` 제거를 검토하는 회차는 이걸 먼저 읽어라 — 이 이름에는 「부정 이름 계약」이 붙어 있다.**
`tests/v049-prev-survey.spec.ts:345-357`이 화면 3파일(`SettingsScreen.tsx` ·
`SettingsActionBar.tsx` · `SettingsFooter.tsx`)의 소스를 **문자열로 읽어**
`screen.includes('readPrevSurveyState(') === false`를 단언한다(C13 전수 스캔 회귀 가드).

실측 판정: **그 단언은 정의 파일의 `export` 키워드를 보지 않으므로 `export` 제거로는 깨지지 않는다.**
다만 두 가지를 못 박는다 — ⓐ이 스펙은 **import 스캔에 안 걸리는 「텍스트 읽기 스캔」 대상**이다
(재표적 두 갈래 규율의 ⓑ갈래) ⓑ**심볼을 옮기거나 이름을 바꾸면 이 가드는 공허하게 통과한다**
(없는 이름을 못 찾는 것은 언제나 참이다). 이름 변경·이동은 반드시 이 스펙과 함께 간다.

### 15-C. `localISO` — `tests/fixtures/localDate.ts:16` → **§7(픽스처 미채택 부채)**. 🔴 제거 금지 — 채택이 답이다

실측: 같은 함수의 **로컬 복제가 16곳**에 있다(스펙 15 + 픽스처 `activeZones.ts` 1).
`_probe-fb10-transition` · `_probe-fb67-center-clip` · `anomaly-touch-buttons` ·
`fixtures/activeZones` · `manual-input` · `trend-alert` · `v023-voice` · `v026-tolerance-strict` ·
`v027-voice-cards-fit` · `v034-past-index-apikey` · `v034-wave-glow` · `v037-review-receipt` ·
`v0440-alarm-fit` · `v0460-cr-alarm-card-floor` · `v0460-fit-headroom` · `v0461-fb10-corrected-hero`.

SSOT 파일 헤더(`localDate.ts:11-13`)가 **스스로 이 부채를 적어놨다** — *"아직 이 파일을 쓰지 않는
스펙이 14개 있다"*. 그 사이 2곳 늘었다(14 → 16). 같은 파일의 `daysAgoLocal`은 실제로 import되고
(`v049-prev-survey` · `past-index-fallback`), `localISO`는 **같은 파일 `:26`이 쓴다**.
즉 심볼도 파일도 죽지 않았다 — 죽은 것은 **채택률**이다.

⚠️ **단순 import 치환이 아니다.** 복제본은 전부 `localISO(new Date(Date.now() - 86_400_000))`
관용구와 한 몸인데, **그 관용구 자체가 헤더가 경고하는 DST 함정**이다(전이일의 하루는 23h·25h).
옮기려면 `daysAgoLocal(1)`로 바꿔야 하고 그건 16파일 × 오라클 영향이다 — **이 항목 밖**,
별도 리팩토링 회차 몫.

### 15-D. 이 절이 바꾸지 않은 것

- **knip 축 코드 무변경.** 같은 커밋의 `src/` 6파일 변경은 **범위 ①(죽은 `import` 문 제거)**이고
  knip 축과 무관하다 — 실측으로 `check:unused` 출력이 **바이트 동일**(before/after diff 0)임을
  확인했다. 이것이 제약 ③「의도한 검출만 줄었는지」의 가장 날카로운 형태다: **줄지 않아야 맞다.**
- **계약 상수 불가침 준수** — §3 8건 + 승격 4건(`RELEASE_STEPS`·`RELEASE_STEP_MS`·
  `SIMULATED_INSETS`·`CHIP_SWEEP_MIN_TRAVEL_PX`)은 손대지 않았다. 15-A로 §3에 1건이 늘어
  **§3 계열은 9건**이 된다.
