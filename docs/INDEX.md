# 문서 색인

survey-011의 문서는 **네 층**으로 나뉜다. 무엇을 찾는지에 따라 들어가는 문이 다르다.

## 1. 현재 계약 — 무엇을 지켜야 하는가

| 문서 | 내용 |
|------|------|
| [AGENTS.md](../AGENTS.md) | **에이전트 진입점.** 6항목 계약 + 코드 손대기 전 30초 체크 |
| [PRINCIPLES.md](../PRINCIPLES.md) | 앱 고유 설계 원칙 (우선순위 순) — 외부 헌장이 없을 때의 **최소 계약** |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | 개발·테스트·릴리스 절차 (명령의 SSOT = `package.json`) |

## 2. 현재 문제 — 지금 무엇이 위험한가

| 문서 | 내용 |
|------|------|
| [KNOWN-ISSUES.md](../KNOWN-ISSUES.md) | `OPEN`(재현되는 문제) + `MONITORING`(실기기 판정 대기) |

⚠️ 전체를 컨텍스트에 넣지 마라. 지금 만지는 **카테고리와 ID만 검색**해서 읽는다.

## 3. 재발 방지 규칙 — 이미 겪었으니 다시 밟지 마라

| 문서 | 내용 |
|------|------|
| [ENGINEERING-GUARDRAILS.md](../ENGINEERING-GUARDRAILS.md) | `GUARDRAIL` — 해결됐지만 계속 지켜야 하는 계약 |

**코드를 쓰기 전에** 관련 절을 훑는 것이 이 문서의 용도다.

## 4. 역사 기록 — 무슨 일이 있었나

| 문서 | 내용 |
|------|------|
| [KNOWN-ISSUES-ARCHIVE.md](../KNOWN-ISSUES-ARCHIVE.md) | `RESOLVED` — 종결된 사건 (⚠️ 줄 번호·경로는 당시 기준) |
| [CHANGELOG.md](../CHANGELOG.md) | 버전별 변경 이력 (사용자가 읽는 문서) |

---

## 상세 문서 (`docs/`)

| 문서 | 내용 |
|------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 현재 코드 구조 — 화면·상태·`lib/` 모듈 지도 |
| [REAL-DEVICE-TEST.md](./REAL-DEVICE-TEST.md) | 실기기 검증 절차와 판정 기록 방법 |
| [STT-SPEAKER-PROFILE.md](./STT-SPEAKER-PROFILE.md) | 화자 프로필 — 발음 혼동을 사람별로 무엇을 모으고, 어디에 남기며, 되묻기에 어떻게 쓰는가(사용자 고지) |

## 상태 모델

```text
OPEN        지금 재현되는 문제                    → KNOWN-ISSUES.md
MONITORING  수정했지만 실기기 판정 대기            → KNOWN-ISSUES.md
GUARDRAIL   해결됐지만 다시 어기면 안 되는 계약    → ENGINEERING-GUARDRAILS.md
RESOLVED    종결·아카이브                        → KNOWN-ISSUES-ARCHIVE.md
```

`MONITORING` → `RESOLVED` 승격의 유일한 근거는 **실기기 확인**이다.
데스크톱 테스트 통과는 `MONITORING` 유지 사유이지 종결 사유가 아니다.

## 사용자용

| 문서 | 내용 |
|------|------|
| [README.md](../README.md) | 앱 소개·설치·음성 명령·빠른 사용법 |
