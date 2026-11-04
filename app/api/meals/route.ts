/**
 * GET /api/meals?date=YYYY-MM-DD → ApiResponse<MealItem[]>
 *
 * 요청/실행될 때마다 https://life.hanyang.ac.kr/theme/pages/home.php 및 하위 페이지에서
 * 실시간 크롤링하여 최신 식단을 반환한다.
 * 크롤링 상태는 본문 타입(MealItem[])에 담을 수 없으므로 응답 헤더로 함께 넘긴다.
 * 화면은 X-Meal-Ok 가 false 면 "식단을 못 가져왔습니다(시드 데이터 표시 중)" 를 띄워야 한다.
 * 상세 상태가 필요하면 GET /api/meals/status (CrawlResult 전문) 를 쓸 것.
 */

import type { NextRequest } from 'next/server';

import { ensureFreshMealsByDate } from '../../../lib/meal/store.ts';
import { fail, internal, ok, parseDate } from '../_lib/respond.ts';

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const parsed = parseDate(request.nextUrl.searchParams.get('date'));
    if (!parsed.ok) return fail(parsed.error, 400);

    const force = request.nextUrl.searchParams.get('refresh') === '1';
    const { crawl, items } = await ensureFreshMealsByDate(parsed.date, { force });
    return ok(items, {
      headers: {
        'X-Meal-Ok': String(crawl.ok),
        'X-Meal-Fallback': crawl.fallback ?? 'none',
        'X-Meal-Fetched-At': crawl.fetchedAt,
      },
    });
  } catch (err) {
    return internal(err, '식단 조회');
  }
}
