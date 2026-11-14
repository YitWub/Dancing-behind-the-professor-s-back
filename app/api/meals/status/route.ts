/**
 * GET /api/meals/status → ApiResponse<CrawlResult>
 *
 * 계약(lib/types.ts 하단)에는 없는 추가 라우트다.
 * MealItem[] 만으로는 "이게 진짜 크롤링 결과인지 시드인지"를 화면이 알 수 없어서
 * 정직성 배지를 띄우려면 이 정보가 필요하다.
 * 저장된 결과와 출처·시각·상태만 반환한다. 수집하지 않는다.
 */

import { readArchivedMealCatalog } from '../../../../lib/meal/archive-catalog.ts';
import { isIsoDate } from '../../../../lib/datetime.ts';
import { readMealCrawl } from '../../../../lib/meal/store.ts';
import { mealReadHeaders, mealReadStatus } from '../../../../lib/meal/status.ts';
import { fail, internal, ok } from '../../_lib/respond.ts';

export async function GET(request?:Request): Promise<Response> {
  try {
    const date=request?.url?new URL(request.url).searchParams.get('date'):null;
    if(date!==null&&!isIsoDate(date))return fail('올바른 제공 날짜가 필요합니다.',400);
    const stored=readMealCrawl();
    const crawl=date?readArchivedMealCatalog(stored,date):stored;
    return ok({ ...crawl, ...mealReadStatus(crawl) }, { headers: mealReadHeaders(crawl) });
  } catch (err) {
    return internal(err, '크롤링 상태 조회');
  }
}
