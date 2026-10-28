/**
 * lib/meal/store.ts — data/*.json 파일 저장소 (DB 없음)
 *
 * ⚠️ 서버 전용 모듈입니다. 'node:fs' 를 쓰므로 클라이언트 컴포넌트에서
 *    import 하면 빌드가 깨집니다. Route Handler / 서버 컴포넌트에서만 쓰세요.
 *
 * 읽기 대상
 *   data/meals.json           크롤러 산출물 (CrawlResult)
 *   data/meals.seed.json      시드 식단 (크롤링 실패 시 폴백)
 *   data/meal-reviews.json    사용자 후기 (쓰기 대상, 없으면 시드에서 초기화)
 *   data/meal-reviews.seed.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { BattleResult, CrawlResult, MealItem, MealReview, MealTime } from '../types.ts';
import { computeBattle } from './battle.ts';

const DATA_DIR = join(process.cwd(), 'data');

export const SEED_SOURCE_LABEL = 'seed:data/meals.seed.json';

function readJson<T>(file: string): T | null {
  const path = join(DATA_DIR, file);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(join(DATA_DIR, file), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/* ────────────────────────────────────────────────────────────────────────────
 * 식단
 * ──────────────────────────────────────────────────────────────────────────*/

interface SeedMealFile {
  note?: string;
  items: MealItem[];
}

/** 시드 식단. 파일이 없으면 빈 배열 (앱은 여전히 살아 있어야 한다). */
export function readSeedMeals(): MealItem[] {
  return readJson<SeedMealFile>('meals.seed.json')?.items ?? [];
}

/**
 * 화면에 내보낼 식단 상태.
 *
 * ★정직성 핵심: 이 함수는 절대 예외를 던지지 않고, 데이터가 어디서 왔는지를
 *   CrawlResult.ok / fallback 으로 정직하게 표시한다.
 *   - 크롤링 성공      → ok: true,  fallback: undefined
 *   - 크롤링 실패+시드 → ok: false, fallback: 'seed'   ("못 가져왔습니다" 배지)
 *   - 파일 자체가 없음 → ok: false, items: [], error 설명
 */
export function readMealCrawl(): CrawlResult {
  const crawled = readJson<CrawlResult>('meals.json');
  if (crawled && Array.isArray(crawled.items)) return crawled;

  const seed = readSeedMeals();
  return {
    ok: false,
    fetchedAt: new Date().toISOString(),
    source: SEED_SOURCE_LABEL,
    items: seed,
    error: 'data/meals.json 이 없습니다. 크롤러(scripts/crawl-meals.ts)를 먼저 실행하세요.',
    fallback: seed.length > 0 ? 'seed' : undefined,
  };
}

/** 특정 날짜의 식단. 날짜가 없으면 빈 배열 — 가짜로 메꾸지 않는다. */
export function readMealsByDate(date: string): { crawl: CrawlResult; items: MealItem[] } {
  const crawl = readMealCrawl();
  return { crawl, items: crawl.items.filter((m) => m.date === date) };
}

export function findMealItem(mealItemId: string): MealItem | null {
  return readMealCrawl().items.find((m) => m.id === mealItemId) ?? null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 후기
 * ──────────────────────────────────────────────────────────────────────────*/

interface MealReviewFile {
  note?: string;
  reviews: MealReview[];
}

/** 후기 전체. data/meal-reviews.json 이 없으면 시드로 초기화한다. */
export function readMealReviews(): MealReview[] {
  const live = readJson<MealReviewFile>('meal-reviews.json');
  if (live && Array.isArray(live.reviews)) return live.reviews;
  return readJson<MealReviewFile>('meal-reviews.seed.json')?.reviews ?? [];
}

export function writeMealReviews(reviews: MealReview[]): void {
  writeJson('meal-reviews.json', {
    note: '학식 후기. 시드에서 출발해 POST /api/meals/review 로 누적된다.',
    updatedAt: new Date().toISOString(),
    reviews,
  });
}

export function readMealReviewsFor(mealItemId: string): MealReview[] {
  return readMealReviews().filter((r) => r.mealItemId === mealItemId);
}

/* ────────────────────────────────────────────────────────────────────────────
 * 대결 (battle.ts 의 순수 계산에 파일 데이터를 물려주는 서버용 래퍼)
 * ──────────────────────────────────────────────────────────────────────────*/

export function getBattle(date: string, mealTime: MealTime): BattleResult {
  return computeBattle({
    date,
    mealTime,
    items: readMealCrawl().items,
    reviews: readMealReviews(),
  });
}
