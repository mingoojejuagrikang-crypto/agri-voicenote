# AGENTS.md — Agri VoiceNote (구 survey-011) 에이전트 진입점

이 레포에서 코드를 만지는 **모든 에이전트(그리고 사람)의 시작 지점**이다.
외부 문서·볼트·다른 컴퓨터에 접근할 수 없어도, **이 레포 안의 문서만으로 작업을 시작할 수 있어야 한다.**

## 이 앱이 무엇인가

농가 현장에서 **한 손·음성으로** 생육조사 값을 기록하는 PWA (React + Vite + TypeScript).
사용자는 장갑을 끼고 야외에서, 폰을 2~3m 떨어진 곳에 두고 쓴다. 기록된 값은 **실제 프로덕션
구글시트**에 올라가 농가 의사결정에 쓰인다 — 장난감이 아니다.

## 계약 (6항목)

1. **먼저 [PRINCIPLES.md](./PRINCIPLES.md)를 읽는다.** 설계·구현·리뷰의 판단 기준이다.
2. **[KNOWN-ISSUES.md](./KNOWN-ISSUES.md)는 전체를 컨텍스트에 넣지 않는다.** 지금 만지는
   영역의 **카테고리와 ID만 검색해서** 읽는다(음성/STT, 클립·IDB, iOS, 정정·race, 빌드·테스트,
   인증·Drive, 입력흐름, 테스트 함정). 새 함정을 만나면 같은 형식으로 append한다.
   해결됐지만 계속 지켜야 하는 계약은 [ENGINEERING-GUARDRAILS.md](./ENGINEERING-GUARDRAILS.md)에
   따로 있다 — **코드를 쓰기 전에 이쪽을 먼저 훑어라.** 종결된 사건은
   [KNOWN-ISSUES-ARCHIVE.md](./KNOWN-ISSUES-ARCHIVE.md)(역사 기록)다.
3. **데이터 무결성 변경은 테스트와 마이그레이션을 동반한다.** 측정값 저장·동기화·persist
   스키마를 건드리면 회귀 테스트 없이 끝내지 않는다. persist 스키마 변경에는 마이그레이션이
   함께 간다.
4. **iOS·STT·마이크 문제는 실기기 확인 없이 "해결"로 선언하지 않는다.** 데스크톱 Playwright는
   근사치다. 절차는 [docs/REAL-DEVICE-TEST.md](./docs/REAL-DEVICE-TEST.md). 판정이 나기 전까지
   상태는 `MONITORING`이지 `RESOLVED`가 아니다.
5. **배포와 버전 증가는 사용자 승인이 필요하다.** 브랜치 작업 중 자동 배포 금지.
   릴리스 절차는 [CONTRIBUTING.md](./CONTRIBUTING.md) §릴리스.
6. **외부 팀 헌장(GL-006 등)에 접근할 수 없으면 [PRINCIPLES.md](./PRINCIPLES.md)를 최소
   계약으로 사용한다.** 이 레포 밖 문서가 없다는 이유로 작업을 멈추지 않는다.

## 코드 손대기 전 30초 체크

실제로 시간을 태운 것만 남겼다.

- **테스트 실패를 "회귀"로 단정하기 전에 기준 브랜치와 대조하라.** 같은 테스트가 `main`에서
  green이면 코드가 아니라 환경 문제다.
- **"격리 통과 = flake"를 양방향으로 쓰지 마라.** 반대(병렬 통과·격리 실패)도 실재한다 —
  부하 지연이 결함을 가리기 때문이다. 신규·고위험 테스트는 `--workers=1`로도 돌린다.
- **회귀 테스트는 반증까지 해야 회귀 테스트다.** 수정을 빼고 돌려 실패하는 것까지 확인한다.
- **더티 워크트리 보존.** 세션 시작 시 발견된 미커밋 변경은 검사만 — reset/checkout/stash/clean 금지.
- **같은 브랜치에 다른 세션이 붙어 있는지 확인.** `git log -1 --format=%cd`가 방금이면
  다른 에이전트가 작업 중일 수 있다. 커밋이 서로 덮인다.
- **워크트리에서 작업하면 `.env.local`부터 복사.** 없으면 로그인 의존 테스트가 코드와
  무관하게 전멸한다.

## 문서 지도

| 문서 | 역할 |
|------|------|
| [PRINCIPLES.md](./PRINCIPLES.md) | 앱 고유 설계 원칙 (우선순위 순) — **최소 계약** |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | 개발·테스트·릴리스 절차 (명령의 SSOT = package.json) |
| [KNOWN-ISSUES.md](./KNOWN-ISSUES.md) | 지금 열려 있거나 관측 중인 문제 |
| [ENGINEERING-GUARDRAILS.md](./ENGINEERING-GUARDRAILS.md) | 해결됐지만 다시 어기면 안 되는 계약 |
| [KNOWN-ISSUES-ARCHIVE.md](./KNOWN-ISSUES-ARCHIVE.md) | 종결된 사건 기록 (역사) |
| [CHANGELOG.md](./CHANGELOG.md) | 버전별 변경 이력 |
| [docs/INDEX.md](./docs/INDEX.md) | 아키텍처·실기기 검증 등 상세 문서 색인 |

> 이 레포를 로컬 팀 환경에서 쓰는 경우, 볼트 경로·정체성 오버레이 같은 운영 지침은
> `_AGENTS-local.md`(git 미추적)에 있다. **없으면 무시하고 위 6항목으로 작업한다.**
