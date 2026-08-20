/**
 * [ENV-11]/[ENV-3] 근절 — 앱 IndexedDB 이름·버전·스키마의 테스트측 진입점 (v0.35.1 신설).
 *
 * 종전에는 27개 spec이 `indexedDB.open('agri-voicenote', 6)`을 하드코딩하고 6곳이 스키마 미러를
 * 복붙해, DB_VERSION bump마다 전수 grep 갱신이 필요했고([ENV-11]) 미러가 신규 스토어를 빠뜨리면
 * 침묵 실패했다([ENV-3]). 이 fixture가 규약을 한 곳으로 모은다:
 *
 *  - 이름·버전·스키마(applyAppSchema) 전부 앱 `src/lib/db.ts`의 export를 **재수출** — 미러가
 *    아예 없으므로 드리프트가 원천 불가능하다(리뷰 라운드3에서 미러+가드 → 진짜 SSOT로 승격).
 *  - **버전 무지정 open**(`indexedDB.open(name)`)이 "이미 부팅된 앱 DB에 시딩"하는 spec의 표준.
 *    기존 DB를 그 버전 그대로 열므로 bump와 무관하다. (부팅 전 시딩만 버전+스키마가 필요.)
 *  - 부팅 전 시딩(앱보다 먼저 DB를 만드는 spec)은 APPLY_APP_SCHEMA_SOURCE를 브라우저 컨텍스트에
 *    인자로 넘겨 upgrade 핸들러에서 복원한다(아래 사용법).
 *  - tests/idb-fixture.spec.ts 가드가 spec의 하드코딩 재유입과 스키마 signature를 검증한다.
 *
 * 부팅 전 시딩 사용법(page.evaluate/addInitScript 콜백은 직렬화되어 import를 못 가져간다 —
 * 소스 문자열을 인자로 넘겨 복원):
 *
 *   import { IDB, APPLY_APP_SCHEMA_SOURCE } from './fixtures/idb';
 *   await page.evaluate(async ({ idb, schemaSrc, ...seed }) => {
 *     const applySchema = (0, eval)(`(${schemaSrc})`) as (db: IDBDatabase) => void;
 *     const open = indexedDB.open(idb.name, idb.version);
 *     open.onupgradeneeded = () => applySchema(open.result);
 *     ...
 *   }, { idb: IDB, schemaSrc: APPLY_APP_SCHEMA_SOURCE, ...seed });
 */

import { DB_NAME, DB_VERSION, applyAppSchema } from '../../src/lib/db';

export { DB_NAME, DB_VERSION, applyAppSchema };

/** 브라우저 컨텍스트 인자로 통째로 넘기기 좋은 형태. */
export const IDB = { name: DB_NAME, version: DB_VERSION } as const;

/** 브라우저 주입용 소스 문자열 — `(0, eval)(\`(${src})\`)`로 복원한다.
 *  (applyAppSchema는 클로저 없는 순수 함수 계약 — db.ts 주석 참조.) */
export const APPLY_APP_SCHEMA_SOURCE = applyAppSchema.toString();

/** 앱 스키마의 스토어 목록 — tests/idb-fixture.spec.ts signature 가드가 실제 앱 DB와 대조한다. */
export const APP_STORE_NAMES = [
  'sessions', 'audioClips', 'logEvents', 'kv', 'screenshots', 'feedbackQueue',
] as const;
