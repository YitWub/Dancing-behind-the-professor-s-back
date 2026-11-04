/**
 * GET /api/meals/status → ApiResponse<CrawlResult>
 *
 * 계약(lib/types.ts 하단)에는 없는 추가 라우트다.
 * MealItem[] 만으로는 "이게 진짜 크롤링 결과인지 시드인지"를 화면이 알 수 없어서
 * 정직성 배지를 띄우려면 이 정보가 필요하다.
 * 실행 시마다 https://life.hanyang.ac.kr/theme/pages/home.php 및 하위 페이지를 크롤링한 최신 상태를 반환한다.
 */

import type { NextRequest } from 'next/server';

import { ensureFreshMealCrawl } from '../../../../lib/meal/store.ts';
import { internal, ok } from '../../_lib/respond.ts';

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const force = request.nextUrl.searchParams.get('refresh') === '1';
    return ok(await ensureFreshMealCrawl({ force }));
  } catch (err) {
    return internal(err, '크롤링 상태 조회');
  }
}
