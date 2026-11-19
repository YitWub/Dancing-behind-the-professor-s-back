/**
 * GET /api/meals/status → ApiResponse<CrawlResult>
 *
 * 계약(lib/types.ts 하단)에는 없는 추가 라우트다.
 * MealItem[] 만으로는 "이게 진짜 크롤링 결과인지 시드인지"를 화면이 알 수 없어서
 * 정직성 배지를 띄우려면 이 정보가 필요하다.
 * 저장된 결과와 출처·시각·상태를 반환한다. 단, 오늘(KST) 날짜 조회인데 오늘 수집한 적이 없으면
 * 오늘 식단을 한 번 수집한 뒤 응답한다(lib/meal/auto-sync.ts). 다른 날짜는 수집하지 않는다.
 */
import { syncTodayIfStale } from '../../../../lib/meal/auto-sync.ts';

import { availableMealDates, readMealCoverage } from '../../../../lib/meal/coverage.ts';
import { readArchivedMealCatalog } from '../../../../lib/meal/archive-catalog.ts';
import { isIsoDate } from '../../../../lib/datetime.ts';
import { readMealCrawl } from '../../../../lib/meal/store.ts';
import { mealReadHeaders, mealReadStatus } from '../../../../lib/meal/status.ts';
import { fail, internal, ok } from '../../_lib/respond.ts';

export async function GET(request?:Request): Promise<Response> {
  try {
    const date=request?.url?new URL(request.url).searchParams.get('date'):null;
    if(date!==null&&!isIsoDate(date))return fail('올바른 제공 날짜가 필요합니다.',400);
    if(date)await syncTodayIfStale(date);
    const stored=readMealCrawl();
    const crawl=date?readArchivedMealCatalog(stored,date):stored;
    return ok({ ...crawl, ...mealReadStatus(crawl), availableDates:availableMealDates(crawl), ...(date?{dateCoverage:readMealCoverage(crawl,date)}:{}) }, { headers: mealReadHeaders(crawl) });
  } catch (err) {
    return internal(err, '크롤링 상태 조회');
  }
}
