/**
 * GET /api/meals/battle?date=YYYY-MM-DD&mealTime=lunch → ApiResponse<BattleResult>
 *
 * 실행/요청 시마다 https://life.hanyang.ac.kr/theme/pages/home.php 및 하위 페이지 크롤링 결과를 반영한다.
 * 표본이 부족하면 decisive:false / winner:null 로 내려온다. 화면은 이 경우
 * 절대 승자를 표시하면 안 된다 (CONTRACT.md 정직성 3번).
 */

import type { NextRequest } from 'next/server';

import type { MealTime } from '../../../../lib/types.ts';
import { ensureFreshBattle } from '../../../../lib/meal/store.ts';
import { fail, internal, ok, parseDate } from '../../_lib/respond.ts';

const MEAL_TIMES: MealTime[] = ['breakfast', 'lunch', 'dinner'];

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const params = request.nextUrl.searchParams;

    const parsed = parseDate(params.get('date'));
    if (!parsed.ok) return fail(parsed.error, 400);

    const rawMealTime = params.get('mealTime') ?? 'lunch';
    if (!MEAL_TIMES.includes(rawMealTime as MealTime)) {
      return fail(`mealTime 은 ${MEAL_TIMES.join(' | ')} 중 하나여야 합니다: ${rawMealTime}`, 400);
    }

    const force = params.get('refresh') === '1';
    return ok(await ensureFreshBattle(parsed.date, rawMealTime as MealTime, { force }));
  } catch (err) {
    return internal(err, '대결 조회');
  }
}
