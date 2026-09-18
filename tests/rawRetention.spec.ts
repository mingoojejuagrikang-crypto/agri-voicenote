/**
 * tests/rawRetention.spec.ts — v0.54.0 G4: rawRetention 순수 모듈 및 오라클 검증.
 *
 * 이 스펙이 고정하는 문장:
 *  ① ⓪-게이트 목록 등재 자기단언
 *  ② selectRawKeysToPrune:
 *     - 12세션 (시작 시각 서로 다름)
 *     - 최근 10세션은 올렸어도 제외 (0개 선택)
 *     - 오래된 2세션 중 올린 1개 세션만 선택 (트림 안 된 본클립의 :raw 및 :cmd2:raw)
 *     - 올리지 않은 오래된 세션은 0개 선택
 *     - 트림 클립, :a1 키 등 :raw로 끝나지 않는 키는 0개 선택
 *     - 세션 목록에 없는 고아 키는 0개 선택
 *     - 접두 충돌 (sess_1 vs sess_10) 방어
 *     - 레코드 형상 틀림 (array가 아니거나 string 아닌 원소) 시 0개 선택
 *  ③ parseRawUploadedRecord: 형상 검증 (null, string, array of non-string 등)
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  selectRawKeysToPrune,
  parseRawUploadedRecord,
  RAW_KEEP_SESSIONS,
} from '../src/lib/rawRetention';

const ROOT = process.cwd();

test('[node] ⓪-게이트 이 오라클이 릴리스 게이트 목록에 등재돼 있다 (v0.54.0)', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as {
    scripts: Record<string, string>;
  };
  const listed = (pkg.scripts['test:e2e:gate'] ?? '').split(/\s+/).filter((x) => x.startsWith('tests/'));
  expect(listed, 'tests/rawRetention.spec.ts가 릴리스 게이트 목록에 없다').toContain('tests/rawRetention.spec.ts');
});

test('parseRawUploadedRecord — 레코드 형상 검증', () => {
  expect(parseRawUploadedRecord(null)).toEqual([]);
  expect(parseRawUploadedRecord(undefined)).toEqual([]);
  expect(parseRawUploadedRecord('invalid')).toEqual([]);
  expect(parseRawUploadedRecord(123)).toEqual([]);
  expect(parseRawUploadedRecord({})).toEqual([]);
  expect(parseRawUploadedRecord({ ids: 'not-an-array' })).toEqual([]);
  expect(parseRawUploadedRecord({ ids: [1, 2, 3] })).toEqual([]);
  expect(parseRawUploadedRecord({ ids: ['sess_1', 2] })).toEqual([]);
  expect(parseRawUploadedRecord({ ids: ['sess_1', 'sess_2'] })).toEqual(['sess_1', 'sess_2']);
});

test('selectRawKeysToPrune — 10번째(보존)와 11번째(정리) 경계 잠금 (K2 · slice(keep±1) 방어)', () => {
  // 12개 세션: startedAt 오름차순 (sess_1=100 ... sess_12=1200)
  // 내림차순 정렬 시:
  // 1번째: sess_12 (1200) ... 10번째: sess_3 (300) -> 보존 대상
  // 11번째: sess_2 (200) ... 12번째: sess_1 (100) -> 정리 대상
  const sessions = Array.from({ length: 12 }, (_, i) => ({
    id: `sess_${i + 1}`,
    startedAt: (i + 1) * 100,
  }));

  // 10번째 최신(sess_3)과 11번째 최신(sess_2)을 모두 올림 상태로 둠
  const uploadedIds = new Set(['sess_2', 'sess_3']);

  const clipKeys = [
    // sess_3 (10번째 최신 & 올림): keep=10 보존 -> 정리되지 않아야 함!
    'sess_3:1:m1:raw',
    'sess_3:1:m1:cmd1:raw',

    // sess_2 (11번째 최신 & 올림): keep 밖 & 올림 -> 정리 대상!
    'sess_2:1:m1:raw',
    'sess_2:1:m1:cmd2:raw',
    'sess_2:1:m1', // 트림 본체 -> 제외

    // sess_1 (12번째 최신 & 안 올림): 제외!
    'sess_1:1:m1:raw',

    // 접두 충돌 검증용 sess_20 (고아 키): 제외!
    'sess_20:1:m1:raw',
  ];

  const result = selectRawKeysToPrune(sessions, clipKeys, uploadedIds, RAW_KEEP_SESSIONS);

  // 대상은 오직 sess_2의 :raw 키 2개뿐이어야 함
  // slice(keep-1) 변이 시: 10번째인 sess_3 키까지 포함되어 실패
  // slice(keep+1) 변이 시: 11번째인 sess_2 키가 누락되어 0개로 실패
  expect(result.keys.sort()).toEqual([
    'sess_2:1:m1:cmd2:raw',
    'sess_2:1:m1:raw',
  ]);
  expect(result.sessionIds).toEqual(['sess_2']);

  // 레코드 형상이 틀려서 uploadedIds가 비어있는 경우 -> 0개 선택
  const malformedUploaded = new Set(parseRawUploadedRecord({ ids: 'broken' }));
  const malformedResult = selectRawKeysToPrune(sessions, clipKeys, malformedUploaded);
  expect(malformedResult.keys).toEqual([]);
  expect(malformedResult.sessionIds).toEqual([]);
});
