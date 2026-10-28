/**
 * POST /api/meals/review {mealItemId, rating, text, nickname} → ApiResponse<MealReview>
 * GET  /api/meals/review?mealItemId=...                       → ApiResponse<MealReview[]>
 *   (GET 은 계약에 없는 편의 라우트. 화면에서 후기 목록을 보여줄 때 쓴다.)
 */

import type { NextRequest } from 'next/server';

import { createMealReview, listMealReviews, validateCreateInput } from '../../../../lib/meal/review.ts';
import { fail, internal, ok } from '../../_lib/respond.ts';

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const mealItemId = request.nextUrl.searchParams.get('mealItemId') ?? undefined;
    return ok(listMealReviews(mealItemId));
  } catch (err) {
    return internal(err, '후기 조회');
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail('JSON 본문을 해석할 수 없습니다.', 400);
  }

  const validated = validateCreateInput(body);
  if (!validated.ok) return fail(validated.error, 400);

  try {
    return ok(createMealReview(validated.value), { status: 201 });
  } catch (err) {
    return internal(err, '후기 저장');
  }
}
