import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * KNOWN-ISSUES [TYPO-CONTRACT-1]:
 * "계약이 지켜지는지 확인하는 테스트가 없다면 그 계약은 주석일 뿐이다."
 *
 * 이 검사기는 src/components/voice/ 이하의 인라인 fontSize 사용이
 * heroLayout.ts의 계약 상수를 참조하는지 정적으로 검증합니다.
 *
 * ESLint 규칙 대신 [node] 백그라운드 테스트로 작성된 이유:
 * eslint.config.js:5 에 명시된 "규칙은 max-lines 하나뿐인 최소 구성 ... 필요 이상 도입 금지"
 * (GL-006 헌장 §5, 민구 채택) 원칙을 준수하기 위함입니다.
 *
 * ALLOWLIST는 라인 번호가 아닌 "내용 기반"으로 관리됩니다. 각 항목이 소스에서
 * 1줄 이상 매치되는지도 단언하므로(죽은 항목 가드, 아래 deadItems), 남아있던
 * 상한(clamp) 부채가 제거되면 그 항목이 0줄이 되어 여기가 red로 알리고,
 * 목록에서 지우면 다시 green이 됩니다 — 부채 소멸이 조용히 지나가지 않습니다.
 */

const ALLOWLIST_ITEMS = [
  // (구 1. CompleteSummary:87 — v0.46.0 WP-B에서 인라인 26px 상한이
  //  `STATE_TYPE.completeReceipt` 참조로 **승격**돼 부채 소멸(allowlist −1, 계약 +1).
  //  🔴 그때 기대값은 5 → 4로 내렸는데 **문자열은 목록에 남아 0줄을 세고 있었다.**
  //  `allowlistCount`는 «매치된 소스 줄» 단위라 죽은 항목은 개수에 안 잡힌다 —
  //  지우든 말든 4다. 그래서 검사기가 스스로는 이걸 못 알린다(lint의 lint가 없다).
  //  제거해도 `toBe(4)`가 green인 것이 곧 「죽었다」의 반증 조건이었다 — 실측 green.
  //  👉 이 구멍은 이제 「죽은 항목 가드」(아래 deadItems 단언)가 막는다 — 0줄 항목은 red다.)
  // (구 2. CompleteSummary:132 — v0.44.0 §C3에서 중앙 종료 버튼 자체가 삭제돼 부채도 소멸.
  //  상한 5건 부채 중 1건이 이렇게 닫혔다 — TODO.md 「상한 5건」 표 참조.)
  // 3. ReaskCue:39 — 부채: 상한 17px 잔존 (규칙 2 위반, UI-g 이후 제거 대상)
  "'calc(clamp(13px, min(4.2vw, 2.1vh), 17px) * var(--fit-lo, 1))'",
  // 4. ModifyIndicatorPill:57 — 부채: 상한 18px 잔존 (규칙 2 위반, UI-g 이후 제거 대상)
  "'max(12px, calc(clamp(14px, 2.1vh, 18px) * var(--fit-lo, 1)))'",
  // 5. ModifyIndicatorPill:88 — 부채: 상한 17px 잔존 (규칙 2 위반, UI-g 이후 제거 대상)
  "'max(12px, calc(clamp(14px, 2vh, 17px) * var(--fit-lo, 1)))'",
  // 6. ActiveControlBar — 영구 예외: calc(70cqh...)는 컨테이너 비례라 이미 상한이 없음.
  //    (v0.44.0 §C2 F02: 50→70% 상향. 비율 단정은 v039 UI-e1과 v0440-c2c3-buttons가 잰다.)
  'calc(70cqh + ',
] as const;

const VALID_CONTRACT_PREFIXES = [
  'HERO_TYPE.',
  'CHIP_TYPE.',
  'STATE_TYPE.',
  'VOICE_TYPE.',
] as const;

function getTsxFilesRecursive(dir: string): string[] {
  let results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(getTsxFilesRecursive(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.tsx')) {
      results.push(fullPath);
    }
  }
  return results;
}

test('[node] 인라인 fontSize 계약 강제 검사기 (UI-g)', () => {
  const voiceDir = path.resolve(process.cwd(), 'src/components/voice');
  const tsxFiles = getTsxFilesRecursive(voiceDir);

  let contractCount = 0;
  let allowlistCount = 0;
  let commentCount = 0;
  let violationCount = 0;

  const violations: string[] = [];
  // 🔴 comment·allowlist도 **목록으로** 남긴다 — 숫자만 보면 분류가 조용히 바뀐 것을
  //    못 알아챈다. 실패했을 때 무엇이 어디로 갔는지 바로 보여야 한다. (독립 리뷰 C1)
  const comments: string[] = [];
  const allowlisted: string[] = [];
  // 🔴 죽은 항목 가드(lint의 lint) — 08-08에 CompleteSummary:87 항목이 0줄을 세며 목록에
  //    남아 있던 것이 발단이다. `allowlistCount`는 «매치된 소스 줄» 단위라 죽은 항목이
  //    개수에 안 잡히므로, 항목별 히트를 따로 세어 0줄인 항목을 red로 알린다.
  //    히트는 이 검사기의 시야(비주석 fontSize 줄) 기준이다 — 주석으로 밀려나 산 줄이
  //    없어진 항목도 죽은 것으로 본다.
  const allowlistHits = new Map<string, number>(
    ALLOWLIST_ITEMS.map((item) => [item, 0] as const),
  );

  for (const filePath of tsxFiles) {
    const relativePath = path.relative(process.cwd(), filePath);
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const lines = fileContent.split('\n');

    lines.forEach((line, index) => {
      if (!line.includes('fontSize')) {
        return;
      }

      // 1. 주석 처리 — 🔴 **줄 선두**로만 판정한다.
      //    종전엔 `line.indexOf('//') < indexOf('fontSize')`였는데, 그러면 줄 어디든 `//`가
      //    앞서기만 하면(예: URL `https://…`) **위반이 violation이 아니라 comment로 조용히
      //    집계**된다. 위반 목록도 안 찍히므로 "숫자만 갱신"하면 그대로 통과한다.
      //    (독립 리뷰 C1)
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) {
        commentCount++;
        comments.push(`${relativePath}:${index + 1} ${line.trim()}`);
        return;
      }

      // 2. ALLOWLIST 검사 — 줄 단위다.
      //    값 추출(`[^,}\n]+`)은 계약 문자열 내부의 콤마에서 끊기므로 allowlist는 줄로 본다.
      const hitItems = ALLOWLIST_ITEMS.filter((allowItem) => line.includes(allowItem));
      if (hitItems.length > 0) {
        allowlistCount++; // 줄 단위 1회 — 항목별 히트(allowlistHits)와는 세는 단위가 다르다.
        for (const item of hitItems) {
          allowlistHits.set(item, (allowlistHits.get(item) ?? 0) + 1);
        }
        allowlisted.push(`${relativePath}:${index + 1} ${line.trim()}`);
        return;
      }

      // 3. 🔴 한 줄에 `fontSize:`가 여러 개일 수 있으므로 **전부** 순회한다.
      //    종전엔 첫 매치만 봐서 두 번째 이후가 검사를 빠져나갔다. (독립 리뷰 M2)
      const matches = [...line.matchAll(/fontSize:\s*([^,}\n]+)/g)];
      if (matches.length === 0) {
        // `fontSize`는 있으나 `fontSize:` 형태가 아니다(예: 백틱 문자열 안의 언급).
        // 계약 대상이 아니므로 세지 않는다.
        return;
      }
      for (const m of matches) {
        const value = m[1];
        if (VALID_CONTRACT_PREFIXES.some((prefix) => value.includes(prefix))) {
          contractCount++;
        } else {
          violationCount++;
          violations.push(`${relativePath}:${index + 1} ${line.trim()}`);
        }
      }
    });
  }

  console.log(
    `[typo-contract-summary] contract=${contractCount} allowlist=${allowlistCount} ` +
      `comment=${commentCount} violation=${violationCount}`,
  );
  comments.forEach((c) => console.log(`  [comment]   ${c}`));
  allowlisted.forEach((a) => console.log(`  [allowlist] ${a}`));

  if (violations.length > 0) {
    console.error('🔴 [TYPO-CONTRACT-VIOLATIONS]:');
    violations.forEach((v) => console.error(`  - ${v}`));
  }

  const deadItems = ALLOWLIST_ITEMS.filter((item) => allowlistHits.get(item) === 0);
  if (deadItems.length > 0) {
    console.error('🔴 [TYPO-CONTRACT-DEAD-ALLOWLIST] 소스 0줄 매치 — 부채가 소멸했다. 목록에서 지워라:');
    deadItems.forEach((d) => console.error(`  - ${d}`));
  }

  // 🔴 리터럴 단언 (제품 상수를 import하지 마라 [TEAMOPS-38])
  //
  // ⚠️ 합계(total) 단언은 **두지 않는다.** 위 네 값의 산술 귀결이라 지워도 green인
  //    「압력 없는 오라클」이었다(독립 리뷰 C2). 재발 방지 검사기가 그런 단언을 들고
  //    나가는 모양이 나쁘다 — `UI-b` 리뷰가 지적한 것과 같은 계열이다.
  // v0.44.0 §C2·C3: ExitConfirmInline 3행(+2 계약) · CompleteSummary 중앙 버튼 삭제(allowlist −1).
  // v0.44.0 §D1: ActiveControlSteppers 말끊기 토글(BargeInToggle) 4건(+4 계약 — captionXs·
  // stepperValue·captionXxs·stepperValueLg 전부 VOICE_TYPE 참조, 위반 0 유지).
  // v0.44.1 [CLIP-INIT-SILENT-1]: MicReconnectBanner 부제 1건(+1 계약 — VOICE_TYPE.caption,
  // "값 입력은 계속 됩니다·앱 재시작" 안내줄. 위반 0 유지).
  // v0.46.0 WP-B(중앙 유동 크기): **정당 파손 — 방향이 계약 쪽이다. 위반은 0 그대로.**
  //   ① CompleteSummary 영수증이 인라인 리터럴 `max(15px, calc(clamp(17px,…,26px)*--fit-lo))`
  //      → `STATE_TYPE.completeReceipt` 참조로 **승격**(allowlist −1, 계약 +1).
  //   ② AlarmInterimStrip이 `STATE_TYPE.alarmInterim`을 새로 참조(계약 +1).
  //   ③ VoiceHero의 fontRenderProbe 유지 근거 주석 2줄(주석 +2 — 실렌더는 안쪽 span인데
  //      계측이 바깥 요소의 computed fontSize를 읽으므로 바깥 fontSize를 남긴다).
  // v0.46.0 WP-F: BlackoutOverlay 힌트 1건(+1 계약 — VOICE_TYPE.caption,
  //   "길게 눌러 화면 켜기 / 음성 입력은 계속됩니다". 위반 0 유지).
  // v0.46.0 WP-1c(시작 준비 「실제 확인 + 진행바」 · `01da2ea`): **정당 파손 — 위반 0 그대로.**
  //   ReadyState 2건(+2 계약 — `:177` VOICE_TYPE.actionLabel 취소 버튼 ·
  //   `:189` VOICE_TYPE.bodySm 안내줄). 59 → 61.
  //   🔴🔴 **이 red는 08-07 하루 종일 살아 있었고 아무도 못 봤다.** 이 스펙이
  //   `test:e2e:gate` 목록 **밖**이라 회차 내내 한 번도 안 돌았고, 배포 직전
  //   `VoiceHero.tsx` max-lines 리팩토링을 검증하다 우연히 드러났다.
  //   👉 게이트 편입 판단은 `TODO.md`에 등재했다. 계약 검사기는 실행 비용이 9ms다.
  // v0.46.1 리팩토링: `AlarmInterimStrip`이 `VoiceHero.tsx`에서 **같은 디렉터리의 자기 파일로
  //   분리**됐다(VoiceHero가 515줄로 max-lines 500을 넘겨 배포가 막혔다). 이 검사기는
  //   `src/components/voice/`를 **재귀 순회**하므로 계약 2건은 그대로 세어진다 —
  //   🔴 그 파일을 이 디렉터리 밖으로 옮기면 계약이 −2 되어 여기가 red가 된다.
  // v0.47.0 W7(민구 지시 08-08 — 히어로 3초 홀드 진입): **정당 파손 — 방향이 계약 쪽이다.**
  //   신규 `HeroHoldToBlackout.tsx`의 홀드 안내 문구 1건(+1 계약 — `VOICE_TYPE.caption`,
  //   "계속 누르면 화면을 끕니다"). 위반 0 그대로. 61 → 62.
  //   🔴 이 검사기는 `src/components/voice/`를 **재귀 순회**한다 — 그 파일을 이 디렉터리 밖으로
  //   옮기면 계약이 −1 되어 여기가 red가 된다(AlarmInterimStrip 분리 때와 같은 함정).
  // v0.47.0 C-FIX2b(`ef86d59` — 셀 저장 실패 지속 배너): **정당 파손 — 방향이 계약 쪽이다.**
  //   신규 `CellPersistErrorBanner.tsx`의 계약 참조 3건(+3 계약, 위반 0 그대로):
  //   `:61` VOICE_TYPE.bannerTitle(제목 '저장 실패 — 값이 저장되지 않음') ·
  //   `:71` VOICE_TYPE.bodyText(본문) · `:90` VOICE_TYPE.bannerAction([다시 저장] 버튼) —
  //   PersistErrorBanner(stop 전용)와 동일한 시각 계약을 따르는 셀 스코프 변형이라
  //   같은 세 타입 토큰을 참조한다. 62 → 65.
  //   🔴 위 W7과 같은 함정: 이 파일을 `src/components/voice/` 밖으로 옮기면 계약 −3.
  // 리팩토링 R1 P1-1(08-14): 스텝퍼 프리미티브(StepperControl·StepperButton·clampStep)가
  //   `ActiveControlSteppers.tsx`(499줄 — max-lines 500까지 여유 1)에서 **같은 디렉터리의
  //   `StepperControl.tsx`로 분리**됐다. 이 검사기는 재귀 순회라 계약 4건(captionXs·
  //   stepperValue·captionXxs·stepperValueLg 참조)은 그대로 세어진다. 65 그대로.
  //   🔴 그 파일을 디렉터리 밖으로 옮기면 계약 −4(AlarmInterimStrip 분리 때와 같은 함정).
  // 리팩토링 R1 P1-1 ②(08-14): `BargeInToggle`도 같은 디렉터리의 자기 파일로 분리됐다
  //   (본 파일 413→351줄 안전권 착지). 계약 4건(captionXs·stepperValue·captionXxs·
  //   stepperValueLg 참조) 그대로 — 🔴 디렉터리 밖 이동 금지 함정 동일. 65 그대로.
  // v0.50 [CLIP-SILENT-1](08-19 — 클립 소실 고지 표면): **정당 파손 — 방향이 계약 쪽이다.**
  //   `ReadyState.tsx`의 직전 세션 클립 결산 경고 1건(+1 계약 — `VOICE_TYPE.bodySm`,
  //   "이번 세션의 음성 클립 N건 중 M건이 저장되지 않았습니다…"). 위반 0 그대로. 65 → 66.
  //   근거: 값은 시트까지 정상으로 가고 화면·시트 어디에도 이상이 없어, 세션이 끝난 뒤
  //   **이 한 줄이 유일한 사후 통지**다(조사 산출물 §6 — 2026-08-19 실기기 2세션 소실).
  // v0.51 P2-2(민구 요청 08-31 — 도움말 음성/버튼 구분표): **정당 파손 — 방향이 계약 쪽이다.**
  //   `CommandHelpPopup.tsx`가 «명령 한 줄 반복»에서 «묶음 3개 + 손전용 목록 + 국면 단서»로
  //   재구성되면서 계약 참조 **7건**이 늘었다(위반 0 그대로 — 신규 인라인이 전부 VOICE_TYPE 참조):
  //     GroupHeading 3(captionSm 마크 · captionSm 제목 · captionXs 부연) ·
  //     HAND_ONLY_FEATURES 행 2(captionSm 라벨 · captionSm 설명) ·
  //     CommandRow의 `touchNote` 1(captionXs) · 하단 국면 단서 블록 1(captionXs). 66 → 73.
  //   🔴 같은 회차에 **조절판 음성 명령 5종이 제거**됐지만 이 수에는 영향이 없다 —
  //   그것들은 `voiceCommands.ts`(배열 데이터)에 있었고 이 검사기는 `.tsx`의 인라인
  //   `fontSize:`만 센다. 도움말은 그 배열을 **동적 렌더**하므로 줄 수가 아니라 항목 수가 준다.
  // v0.53.0 A(민구 Q3 ⓐ — 세션 결산 종료 화면 한 줄): **정당 파손 — 방향이 계약 쪽이다.**
  //   `ReadyState.tsx`의 session-health-line 1건(+1 계약 — `VOICE_TYPE.bodySm`,
  //   "이번 세션 · 다시 묻기 … · 고친 칸 … · 알람 …"). 위반 0 그대로. 73 → 74.
  //   🔴 이 검사기는 `src/components/voice/`를 **재귀 순회**한다 — `ReadyState.tsx`를 이 디렉터리
  //   밖으로 옮기면 계약이 −1 되어 여기가 red가 된다(AlarmInterimStrip 분리 때와 같은 함정).
  expect(contractCount, '계약 참조 (통과)').toBe(74);
  expect(allowlistCount, 'ALLOWLIST (허용)').toBe(4);
  expect(commentCount, '주석 (skip)').toBe(3);
  expect(violationCount, '위반 (0건이어야 함)').toBe(0);

  // 🔴 죽은 항목 가드 (08-08 제안 → 08-09 자동 회차): 부채가 소멸해 항목이 소스 0줄을
  //    세게 되면 여기가 red다 — 기대값만 내리고 문자열을 안 지우는 실수(위 4개 단언이
  //    전부 green인 채 사체가 목록에 남는 경로, 실제로 v0.46.0 WP-B 때 일어났다)를 잡는다.
  //    toEqual([])이라 실패 메시지에 죽은 항목 문자열이 그대로 찍힌다.
  expect(deadItems, 'ALLOWLIST 죽은 항목 (소스 0줄 매치 — 목록에서 지워라)').toEqual([]);
});
