/**
 * app/api/_lib/respond.ts — ApiResponse<T> 판별 유니온 응답 헬퍼
 *
 * 모든 라우트는 lib/types.ts 의 ApiResponse<T> 로 감싸고,
 * 에러는 200 이 아니라 적절한 상태코드로 내려준다.
 * (언더스코어로 시작하는 폴더라 라우트로 잡히지 않는다)
 */

import type { ApiResponse } from '../../../lib/types.ts';
import { isIsoDate, kstToday } from '../../../lib/datetime.ts';

export function ok<T>(data: T, init?: ResponseInit): Response {
  const body: ApiResponse<T> = { ok: true, data };
  return Response.json(body, init);
}

export function fail(error: string, status = 400, init?: ResponseInit): Response {
  const body: ApiResponse<never> = { ok: false, error };
  return Response.json(body, { ...init, status });
}

/** 예기치 못한 예외를 500 + 정직한 메시지로. 스택은 서버 로그에만. */
export function internal(err: unknown, context: string): Response {
  console.error(`[api] ${context}`, err);
  const detail = err instanceof Error ? err.message : String(err);
  return fail(`${context} 중 서버 오류가 발생했습니다: ${detail}`, 500);
}

/**
 * YYYY-MM-DD 검증. 없으면 **KST 기준** 오늘로 기본값.
 * UTC 로 계산하면 오전 9시 이전에 어제 식단이 뜬다 (lib/datetime.ts 참고).
 */
export function parseDate(raw: string | null): { ok: true; date: string } | { ok: false; error: string } {
  if (raw === null || raw === '') {
    return { ok: true, date: kstToday() };
  }
  if (!isIsoDate(raw)) {
    return { ok: false, error: `date 형식이 올바르지 않습니다 (YYYY-MM-DD): ${raw}` };
  }
  return { ok: true, date: raw };
}
