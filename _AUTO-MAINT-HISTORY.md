# 자동 유지보수 이력 (`auto/maintenance` 레인)

> 이 레인이 **코드를 바꾼 회차만** 최신순으로 한 줄씩 적는다. 제안·문서만인 회차는 적지 않는다.
> 🔴 `CHANGELOG.md`는 이 레인이 건드리지 않는다 — `check:release`가 `package.json` 버전과의 일치를
> 강제하는데 이 레인은 버전 bump가 금지라 항목을 추가하는 순간 배포가 막힌다.

- **2026-08-19** · **죽은 `import` 문 8건 제거**(6파일) + `_KNIP-VERDICT.md` §15(신규 검출 3건 판정).
  계측기는 `npx tsc -p tsconfig.json --noUnusedLocals --noEmit`(설정 변경 0 · `src` 한정) —
  정규 `tsc -b`·ESLint는 `tsconfig.json:15 "noUnusedLocals": false`라 이 축을 못 잡는다.
  **실측 21 → 13**. 지운 것: `App.tsx`(`useSettingsStore`) · `ColumnCard.tsx`(`COLUMN_HELP`) ·
  `OptionsPanel.tsx`(`autoValue`) · `TablePreviewModal.tsx`(`SegmentToggle` + `ColumnDetailRow`·
  `ColumnGridCell` 2줄) · `ActiveState.tsx`(`T`) · `SettingsScreen.tsx`(`useEffect` 부분 · `Column` 타입).
  **심볼 삭제 0 · `export` 제거 0 · 이동 0 — `import` 문만 지웠다.**
  🔴 08-16 wrapup이 남긴 「선재 죽은 import 6건」은 **전부 `useVoiceSession.ts` 안**이라
  오디오 3파일 제외 규칙에 걸려 **무접촉**이다(잔존 13건 = 그 6 + `audioRecorder` 지역 2 +
  import이 아닌 지역 선언 5). 다음 회차가 이 6을 「놓친 것」으로 읽지 마라.
  검증: `npm run build` EXIT 0 · `check:release` EXIT 0(lint 무경고) · **`check:unused` 출력
  바이트 동일**(before/after diff 0 — import은 knip 축이 아니고, 마지막 임포터 제거·모듈 고아화가
  없음을 사전 실측했다: `ColumnPreviewParts`는 `SettingsSummary`가, `SegmentToggle`은 4파일이,
  `helpCopy`는 4파일이 계속 import한다). e2e 게이트 미실행 — 이동·분리·export 변경이 없어
  E5 정리 회차(`62b3526`) 전례와 같은 판단이다.
- **2026-08-10** · `knip@6.32.0` 도입 (Phase 0-b) — devDependency + `knip.jsonc` + `npm run check:unused`.
  미사용 판정을 grep에서 모듈 그래프 해석으로 옮긴다(`[TEAMOPS-5]`·`[TEAMOPS-18]`). **검출물은
  하나도 지우지 않았다** — 판정은 사람 몫(동적 참조 가능성·오디오 3파일 리뷰 대상).
  설정 근거: ①`paths: {"/src/*": ["src/*"]}` — `page.evaluate` 안의 Vite 절대경로 동적 임포트
  6건이 「미해석」 오탐이었고, 매핑 후 namespace 사용 추적까지 정확해짐(`auth.signOut()`은 사용,
  `getClientId`는 미사용으로 갈림) ②`playwright.config` 2건 등록 — probe config 오탐 제거
  ③`design-handoff/**` ignore — 앱 빌드 밖 참고 산출물. **실측:** 무설정 baseline 대비 미사용
  파일 11→3(오탐 8 소거), 미해석 6→0. 잔존 검출: 파일 3(`test-sheets-url.mjs`·`Chip.tsx`·
  `BeepPicker.tsx`) · export 64 · 타입 15 · 중복 export 1(`chipSweep.ts`). 미사용 의존성 0.
  🔴 `check:release`에 연결하지 않았다(검출 존재 시 exit 1이라 연결하면 배포가 막힌다) —
  실측 `check:release` EXIT=0 유지. src·tests 무변경이라 e2e 재실행 없음.
- **2026-08-09** · `tests/v043-typo-contract.spec.ts`에 「죽은 allowlist 항목」 가드를 추가했다
  (08-08 회차 제안 이행). 항목별 히트를 `allowlistHits` 맵으로 따로 세어, 소스 0줄 매치 항목을
  `expect(deadItems, …).toEqual([])`로 red 처리한다. **기대값 4개는 손대지 않았다.**
  **왜:** 08-08에 드러난 「lint의 lint 부재」 — `allowlistCount`는 «매치된 소스 줄» 단위라 죽은
  항목이 개수에 안 잡혀, v0.46.0 WP-B 때 사체가 목록에 남아도 4개 단언 전부 green이었다.
  **실측:** 편집 전후 런의 요약줄이 `contract=65 allowlist=4 comment=3 violation=0`으로 **바이트
  동일**, 두 런 모두 `✘` 0건 · 1 passed · 예외 0건. **red 반증:** 임시 죽은 항목을 삽입한 런에서
  `✘` 1건이 **단언 실패**(deadItems toEqual, 예외 아님)로 발화하고 실패 메시지에 죽은 항목
  문자열이 그대로 찍히는 것을 확인한 뒤 임시 항목을 제거했다. `check:docs` OK · `lint` OK.
- **2026-08-08** · `tests/v043-typo-contract.spec.ts`의 `ALLOWLIST_ITEMS`에서 죽은 항목 1건
  (`CompleteSummary:87`의 `'max(15px, calc(clamp(17px, min(5vw, 2.6vh), 26px) * var(--fit-lo, 1)))'`)을
  제거하고 그 자리에 소멸 경위 주석을 남겼다. **기대값 4개는 손대지 않았다.**
  **왜:** v0.46.0 WP-B가 그 인라인 26px 상한을 `STATE_TYPE.completeReceipt` 참조로 승격시켜 부채가
  소멸했는데, 구현자는 `expect(allowlistCount).toBe(5→4)`만 내리고 배열의 문자열은 안 지웠다.
  `allowlistCount`는 «매치된 소스 줄»로 세므로 죽은 항목은 개수에 안 잡힌다 — 지우든 말든 4라서
  **검사기가 스스로는 이걸 못 알린다**(자기 목록을 검사할 오라클이 없다).
  **실측:** 항목별 리터럴 grep으로 히트 수가 `0 / 1 / 1 / 1 / 1`임을 먼저 확인했고, 편집 전후 런의
  요약줄이 `contract=61 allowlist=4 comment=3 violation=0`으로 **바이트 동일**했다(제거해도 값이 안
  바뀌는 것이 「죽었다」의 반증 조건이었다). 두 런 모두 `✘` **0건** · 1 passed · 예외 0건.
  `check:docs` OK · `lint` OK. **미처리로 남김:** 파생 항목인 `TODO.md` 「상한 5건」 표의 실측 정정
  (잔존은 3건인데 표는 4건으로 적혀 있다)은 그 파일이 이 워크트리 **밖**(`workspace_teamops/TODO.md`)이라
  규칙 1에 따라 건드리지 않았다. 근거는 `_ASK-auto-maint-001.md` 후보 2에 이미 실려 있다.
- **2026-08-07** · 테스트 스크린샷 3장의 쓰기 경로를 `Deliverables/assets/2026-08-02-ui-e4/` →
  `test-results/ui-e4/`로 옮겼다 (`tests/v043-exit-inline.spec.ts` 2곳 · `tests/trend-alert.spec.ts` 1곳).
  **왜:** 그 경로가 git 추적 중인 08-02 회차 증거 PNG였고 매 런이 덮어썼다 — `b217278`에 교체본이 실려
  나가 `e06019a`가 되돌리는 커밋을 따로 냈고, 콜드 리뷰 R1은 그 `M`을 "다른 실행 주체가 붙었다"는
  운영 알림으로 오독했다. 세 스크린샷은 단언이 아니라 증거 덤프라(`toMatchSnapshot` 0건 · 결과를 읽는
  단언 0건 · `*.md` 인용처 0건) 경로만 옮기면 잃는 것이 없다. `test-results/`는 이미 `.gitignore:13`에 있다.
  **실측:** 편집 전 런이 `alarm-402x874.png`·`exit-inline-402x874.png` 2장을 실제로 바이트 변경시켰고
  (`exit-inline-375x650.png`는 이번 런에서 우연히 바이트 동일), 편집 후 런은 `Deliverables/assets/` 오염
  **0건**. 두 런 모두 `✘` 1건으로 같고 그 1건은 기지 실패 `[CHIP-TYPO-1]`/`[ALERT-COMPARE-1]`
  (`KNOWN-ISSUES.md:1092`)의 **동일 단언**이다 — 예외 전환 없음, 신규 실패 0.
