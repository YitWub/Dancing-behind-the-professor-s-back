/**
 * lib/meal/review.ts — 학식 후기 CRUD + 입력 검증
 *
 * 별점 1~5 · 텍스트 · 닉네임. 저장은 파일(store.ts).
 */

import type { MealReview } from '../types.ts';
import { findMealItem, readMealReviews, writeMealReviews } from './store.ts';

export interface CreateMealReviewInput {
  mealItemId: string;
  rating: number;
  text: string;
  nickname: string;
}

export type ValidationResult =
  | { ok: true; value: CreateMealReviewInput }
  | { ok: false; error: string };

const MAX_TEXT = 500;
const MAX_NICKNAME = 20;

/** 요청 본문 검증. 실패 이유를 사람이 읽을 수 있는 한국어로 돌려준다. */
export function validateCreateInput(body: unknown): ValidationResult {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: '요청 본문이 비어 있습니다.' };
  }
  const b = body as Record<string, unknown>;

  const mealItemId = typeof b.mealItemId === 'string' ? b.mealItemId.trim() : '';
  if (!mealItemId) return { ok: false, error: 'mealItemId 가 필요합니다.' };
  if (!findMealItem(mealItemId)) {
    return { ok: false, error: `존재하지 않는 식단입니다: ${mealItemId}` };
  }

  const rating = typeof b.rating === 'number' ? b.rating : Number(b.rating);
  if (!Number.isFinite(rating) || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: '별점은 1~5 사이의 정수여야 합니다.' };
  }

  const rawText = typeof b.text === 'string' ? b.text.trim() : '';
  if (rawText.length > MAX_TEXT) {
    return { ok: false, error: `후기는 ${MAX_TEXT}자를 넘을 수 없습니다.` };
  }

  const rawNickname = typeof b.nickname === 'string' ? b.nickname.trim() : '';
  if (!rawNickname) return { ok: false, error: '닉네임이 필요합니다.' };
  if (rawNickname.length > MAX_NICKNAME) {
    return { ok: false, error: `닉네임은 ${MAX_NICKNAME}자를 넘을 수 없습니다.` };
  }

  return { ok: true, value: { mealItemId, rating, text: rawText, nickname: rawNickname } };
}

function nextId(existing: MealReview[]): string {
  let max = 0;
  for (const r of existing) {
    const m = /^MR(\d+)$/.exec(r.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `MR${String(max + 1).padStart(4, '0')}`;
}

/** 후기 1건 추가. 저장된 객체를 그대로 돌려준다. */
export function createMealReview(input: CreateMealReviewInput): MealReview {
  const all = readMealReviews();
  const review: MealReview = {
    id: nextId(all),
    mealItemId: input.mealItemId,
    rating: input.rating,
    text: input.text,
    createdAt: new Date().toISOString(),
    nickname: input.nickname,
  };
  writeMealReviews([...all, review]);
  return review;
}

export function listMealReviews(mealItemId?: string): MealReview[] {
  const all = readMealReviews();
  const filtered = mealItemId ? all.filter((r) => r.mealItemId === mealItemId) : all;
  return [...filtered].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 평균 별점. 후기가 0건이면 null — 0.0 으로 메꾸지 않는다(모르면 흐리게). */
export function averageRating(reviews: MealReview[]): number | null {
  if (reviews.length === 0) return null;
  return reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
}
