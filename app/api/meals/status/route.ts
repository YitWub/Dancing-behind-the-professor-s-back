/**
 * GET /api/meals/status → ApiResponse<CrawlResult>
 *
 * 계약(lib/types.ts 하단)에는 없는 추가 라우트다.
 * MealItem[] 만으로는 "이게 진짜 크롤링 결과인지 시드인지"를 화면이 알 수 없어서
 * 정직성 배지를 띄우려면 이 정보가 필요하다. 기존 계약은 그대로 두고 덧붙였다.
 */

import { readMealCrawl } from '../../../../lib/meal/store.ts';
import { internal, ok } from '../../_lib/respond.ts';

export async function GET(): Promise<Response> {
  try {
    return ok(readMealCrawl());
  } catch (err) {
    return internal(err, '크롤링 상태 조회');
  }
}
