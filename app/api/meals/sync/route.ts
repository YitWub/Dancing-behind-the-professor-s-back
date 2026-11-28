/**
 * POST /api/meals/sync { date: YYYY-MM-DD } → ApiResponse<{ items: number }>
 *
 * 식단 탐색 탭(오늘 자동·'선택 날짜 조회' 버튼)이 그 날짜의 공식 식단을 수집한다.
 * 기존 관측 파이프라인(잠금·robots·요청 상한·간격·최근 관측 재사용)을 그대로 쓰므로 반복 요청도 학교 서버를 두드리지 않는다.
 * GET 조회 라우트는 계속 읽기 전용이다. 실패해도 마지막 정상 스냅샷은 유지된다.
 */

import { isIsoDate } from '../../../../lib/datetime.ts';
import { nothingNewPublished, runMealDataPipeline } from '../../../../lib/meal/pipeline.ts';
import { fail, internal, ok } from '../../_lib/respond.ts';

export async function POST(request: Request): Promise<Response> {
  try {
    const body: unknown = await request.json().catch(() => null);
    const date = body && typeof body === 'object' && 'date' in body ? body.date : null;
    if (typeof date !== 'string' || !isIsoDate(date)) return fail('올바른 제공 날짜가 필요합니다.', 400);
    const result = await runMealDataPipeline({ rootDir: process.cwd(), baseDate: date, dates: [date], silent: true });
    if (result.ok) return ok({ items: result.items.filter(item => item.date === date).length });
    return nothingNewPublished(result.error) ? ok({ items: 0 }) : fail(result.error ?? '식단을 가져오지 못했어요.', 502);
  } catch (err) {
    return internal(err, '식단 수집');
  }
}
