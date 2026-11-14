/**
 * GET /api/meals?date=YYYY-MM-DD → ApiResponse<MealItem[]>
 *
 * 저장된 식단만 읽는다. refresh=1도 수집이나 파일 쓰기를 실행하지 않는다.
 * 크롤링 상태는 본문 타입(MealItem[])에 담을 수 없으므로 응답 헤더로 함께 넘긴다.
 * X-Meal-Ok는 저장된 수집 결과이고 현재 신선도를 뜻하지 않는다.
 * X-Meal-State와 수집 시각 헤더로 오래됨·캐시·예시를 구분한다.
 * 상세 상태가 필요하면 GET /api/meals/status (CrawlResult 전문) 를 쓸 것.
 */

import type { NextRequest } from 'next/server';

import { readMealsByDate } from '../../../lib/meal/store.ts';
import { mealReadHeaders } from '../../../lib/meal/status.ts';
import { fail, internal, ok, parseDate } from '../_lib/respond.ts';

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const parsed = parseDate(request.nextUrl.searchParams.get('date'));
    if (!parsed.ok) return fail(parsed.error, 400);

    const { crawl, items } = readMealsByDate(parsed.date);
    return ok(items, {
      headers: mealReadHeaders(crawl),
    });
  } catch (err) {
    return internal(err, '식단 조회');
  }
}
