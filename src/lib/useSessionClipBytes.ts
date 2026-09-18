/**
 * src/lib/useSessionClipBytes.ts — v0.54.0 H1: 세션 목록의 클립 저장 바이트 수 집계 훅.
 *
 * 원칙:
 *  - 화면 렌더/동작을 블로킹하지 않음 (마운트 후 백그라운드 비동기)
 *  - 세션을 하나씩 순차적으로 sumSessionClipBytes 호출 (Promise.all 병렬 금지)
 *  - 각 세션 계산 완료 시 점진적으로 상태 갱신
 *  - 언마운트 시 즉시 중단 (취소 플래그)
 *  - 의존 키: 세션 id와 finishedAt 이어붙인 문자열 (커밋마다 재계산 방지)
 */
import { useState, useEffect } from 'react';
import { sumSessionClipBytes } from './db';

export function useSessionClipBytes(
  sessions: ReadonlyArray<{ id: string; finishedAt?: number }>,
  liveSessionId?: string,
): ReadonlyMap<string, number> {
  const [bytesMap, setBytesMap] = useState<ReadonlyMap<string, number>>(() => new Map());

  const depKey = sessions
    .map((s) => (s.id === liveSessionId ? s.id : `${s.id}:${s.finishedAt ?? 0}`))
    .join('|');

  useEffect(() => {
    let cancelled = false;

    async function run() {
      for (const s of sessions) {
        if (cancelled) break;
        try {
          const { total } = await sumSessionClipBytes(s.id);
          if (cancelled) break;
          setBytesMap((prev) => {
            const next = new Map(prev);
            next.set(s.id, total);
            return next;
          });
        } catch {
          // 조회 실패 시 해당 세션은 건너뜀
        }
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [depKey]);

  return bytesMap;
}
