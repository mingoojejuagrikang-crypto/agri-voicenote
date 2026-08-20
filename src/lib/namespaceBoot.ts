/**
 * v0.50 개명 — localStorage 네임스페이스 복사의 **부팅 진입점**.
 *
 * 🔴 **main.tsx의 첫 import여야 한다.** ES 모듈은 import 순서대로 깊이우선 평가되고,
 * zustand persist는 settingsStore 모듈 평가 시점에 localStorage를 **동기로** 읽는다.
 * 이 모듈이 App(→ stores)보다 늦게 평가되면 복사가 하이드레이션을 놓친다 — 그 경우
 * 첫 부팅이 기본값으로 뜨고, 구 설정은 다음 부팅에야 보인다(유실은 아니지만 오동작).
 *
 * import 의존은 namespaceMigrate 하나뿐이어야 한다(그 안엔 idb 타입뿐) — 여기서 스토어나
 * logger를 import하면 평가 순서 계약이 무너진다.
 */
import { migrateLocalStorageNamespace } from './namespaceMigrate';

migrateLocalStorageNamespace();
