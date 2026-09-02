/**
 * v0.51.1 X1 오라클 (Node · 서버 불필요) — 세션 필터 export의 이벤트 선택 술어(`exportLogEvents.ts`).
 *
 * 결함(read-fb F6): `sessionId:""` 이벤트(세션 시작 직전 진단 `audio_unlock`·`start_ready`·`notify_perm`)가
 * 세션 필터 zip에서 통째로 빠졌다 — `null`이 아니라 `__app__` 센티널이 안 붙고 필터 집합에도 없다.
 *
 * 🔴 반증(2026-09-02 실측): `includeEventInSessionExport`의 `''` 분기를 종전 계약(`filterSet.has || __app__`)으로
 *    되돌리면 ①·③·④가 red. ②(다른 `sess_*` 제외)는 종전과 같은 불변이라 green.
 * zip 실물(IDB 경로 + 폴백 경로의 배선)은 `tests/v0511-x1-export-blank-session.spec.ts`(e2e)가 잰다.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  APP_SENTINEL, BLANK_SESSION_LEAD_MS, blankSessionWindow, includeEventInSessionExport,
} from '../src/lib/exportLogEvents';

const T0 = 1_788_300_000_000; // 세션 시작(epoch ms)
const SESSION = { startedAt: T0, finishedAt: T0 + 20 * 60_000 };
const FILTER = new Set(['sess_a']);
const WINDOW = blankSessionWindow([SESSION], T0 + 60 * 60_000);

test('창 — 범위 세션 시작 −10분 ~ 종료(없으면 now) · 세션이 없으면 null(전량)', () => {
  expect(WINDOW).toEqual({ from: T0 - BLANK_SESSION_LEAD_MS, to: T0 + 20 * 60_000 });
  expect(blankSessionWindow([{ startedAt: T0 }], T0 + 5_000)).toEqual({ from: T0 - BLANK_SESSION_LEAD_MS, to: T0 + 5_000 });
  expect(blankSessionWindow([{ startedAt: T0 + 100, finishedAt: T0 + 200 }, { startedAt: T0 - 50, finishedAt: T0 + 900 }], T0))
    .toEqual({ from: T0 - 50 - BLANK_SESSION_LEAD_MS, to: T0 + 900 });
  expect(blankSessionWindow([], T0)).toBeNull();
});

test('① 빈 sessionId 이벤트 — 창 안이면 동봉(시작 직전 진단이 살아난다)', () => {
  expect(includeEventInSessionExport({ sessionId: '', ts: T0 - 3_000 }, FILTER, WINDOW)).toBe(true);   // audio_unlock 3초 전
  expect(includeEventInSessionExport({ sessionId: '', ts: T0 - BLANK_SESSION_LEAD_MS }, FILTER, WINDOW)).toBe(true); // 경계 포함
  expect(includeEventInSessionExport({ sessionId: '', ts: T0 + 10 * 60_000 }, FILTER, WINDOW)).toBe(true); // 세션 중 세션 밖 이벤트
});

test('② 다른 sess_* 는 여전히 제외 · 범위 세션과 __app__ 은 항상 동봉(종전 계약 불변)', () => {
  expect(includeEventInSessionExport({ sessionId: 'sess_other', ts: T0 }, FILTER, WINDOW)).toBe(false);
  expect(includeEventInSessionExport({ sessionId: 'sess_a', ts: 0 }, FILTER, WINDOW)).toBe(true);
  expect(includeEventInSessionExport({ sessionId: APP_SENTINEL, ts: 0 }, FILTER, WINDOW)).toBe(true);
  expect(includeEventInSessionExport({ sessionId: undefined, ts: T0 }, FILTER, WINDOW)).toBe(false);
  expect(includeEventInSessionExport({ sessionId: null, ts: T0 }, FILTER, WINDOW)).toBe(false);
});

test('③ 창 밖의 빈 sessionId 이벤트는 제외 — 기기 수명 내내 쌓인 과거분이 세션 zip마다 실리지 않는다', () => {
  expect(includeEventInSessionExport({ sessionId: '', ts: T0 - BLANK_SESSION_LEAD_MS - 1 }, FILTER, WINDOW)).toBe(false);
  expect(includeEventInSessionExport({ sessionId: '', ts: T0 + 20 * 60_000 + 1 }, FILTER, WINDOW)).toBe(false);
  expect(includeEventInSessionExport({ sessionId: '', ts: T0 - 86_400_000 }, FILTER, WINDOW)).toBe(false); // 하루 전
});

test('④ 창이 없으면(세션 못 찾음) 빈 sessionId는 전량 — 진단용 fail-open', () => {
  expect(includeEventInSessionExport({ sessionId: '', ts: T0 - 86_400_000 }, FILTER, null)).toBe(true);
  expect(includeEventInSessionExport({ sessionId: 'sess_other', ts: T0 }, FILTER, null)).toBe(false);
});

/** r2 P2-2 (2026-09-02 콜드 리뷰) — **게이트 자기단언.** 이 파일은 X1 export 선택 술어의 유일한 리터럴 오라클인데 `test:e2e:gate` 밖이라
 *  `predeploy`가 한 번도 안 돌았다(`v043-typo-contract.spec.ts:180`의 재현 조건). `v051-mic-muted-span.spec` ⓪과 같은 꼴 —
 *  목록에서 이 이름을 지우면 여기서 red다. */
test('[node] ⓪-게이트 이 오라클이 릴리스 게이트 목록에 등재돼 있다 (r2 P2-2)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8')) as {
    scripts: Record<string, string>;
  };
  const listed = (pkg.scripts['test:e2e:gate'] ?? '').split(/\s+/).filter((x) => x.startsWith('tests/'));
  expect(listed, 'tests/exportLogEvents.spec.ts가 릴리스 게이트 목록에 없다 — predeploy에서 한 번도 돌지 않는다').toContain('tests/exportLogEvents.spec.ts');
});
