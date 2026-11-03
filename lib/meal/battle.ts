/**
 * lib/meal/battle.ts — 창보 vs 학식 대결 스코어보드
 *
 * ✅ 순수 모듈입니다 (node:fs 없음). 클라이언트 컴포넌트에서 import 해도 안전합니다.
 *    CONTRACT.md 3장 "계산은 전부 클라이언트에서 가능한 순수 함수".
 *    파일 저장소에서 읽어 계산하는 서버용 래퍼는 store.ts 의 getBattle() 입니다.
 *
 * ★이 파일의 존재 이유는 "이기는 쪽을 뽑는 것"이 아니라
 *   "표본이 부족할 때 승부를 유보하는 것" 입니다. (CONTRACT.md 정직성 3번)
 *   후기 2건으로 "창보 승"이라고 말하는 순간 앱 전체의 신뢰가 무너집니다.
 *
 * 판정 임계치 (근거는 lib/meal/README.md 참고)
 *   ① 두 진영 모두 후기 ≥ MIN_REVIEWS_PER_SIDE
 *   ② 평점 차이 ≥ MIN_RATING_GAP
 *   ③ 평점 차이가 95% 신뢰구간(표본오차) 밖
 *   셋을 모두 통과해야 decisive: true.
 */

import type {
  BattleResult,
  BattleStanding,
  Cafeteria,
  MealItem,
  MealReview,
  MealTime,
} from '../types.ts';

/* ── 임계치 ─────────────────────────────────────────────────────────────── */

/** 진영당 최소 후기 수. 이보다 적으면 무조건 판정 유보. */
export const MIN_REVIEWS_PER_SIDE = 5;
/** 평점 차이 최소폭 (1~5 척도). 이보다 작으면 "사실상 동점". */
export const MIN_RATING_GAP = 0.4;
/** 표본표준편차 하한. 후기가 우연히 다 같은 점수여도 과신하지 않기 위한 바닥값. */
const STDEV_FLOOR = 0.5;
/** 95% 양측 신뢰구간 z값 */
const Z95 = 1.96;
/** 추세 판정 폭 */
const TREND_DELTA = 0.25;
/** 추세를 계산할 최소 후기 수 (각 구간) */
const TREND_MIN_N = 3;

export const CAFETERIA_LABELS: Record<Cafeteria, string> = {
  haksik: '학생식당',
  changbo: '창업보육센터',
  dorm: '기숙사식당',
  faculty: '교직원식당',
};

export const CAFETERIA_ORDER: Cafeteria[] = ['haksik', 'changbo', 'dorm', 'faculty'];

/** 대결의 주인공 두 진영. 나머지 식당은 스코어보드에만 함께 표시한다. */
export const BATTLE_SIDES: [Cafeteria, Cafeteria] = ['changbo', 'haksik'];

/** 식단별 4단계 평점 버튼 (좋좋 / 느좋 / 안좋 / 좆) */
export type MealRatingLabel = '좋좋' | '느좋' | '안좋' | '좆';

export interface MealRatingOption {
  label: MealRatingLabel;
  rating: number;
  desc: string;
}

export const MEAL_RATING_OPTIONS: readonly MealRatingOption[] = [
  { label: '좋좋', rating: 5, desc: '최고' },
  { label: '느좋', rating: 4, desc: '괜찮음' },
  { label: '안좋', rating: 2, desc: '별로' },
  { label: '좆', rating: 1, desc: '최악' },
] as const;

export function ratingToLabel(rating: number): MealRatingLabel {
  if (rating >= 5) return '좋좋';
  if (rating >= 3) return '느좋';
  if (rating === 2) return '안좋';
  return '좆';
}

const MEAL_TIME_LABELS: Record<MealTime, string> = {
  breakfast: '조식',
  lunch: '중식',
  dinner: '석식',
};

/* ── 통계 도우미 ────────────────────────────────────────────────────────── */

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** 화면용 평점은 소수 첫째 자리까지. 4.2727... 을 그대로 내보내는 건 false precision 이다. */
function displayMean(xs: number[]): number | null {
  const m = mean(xs);
  return m === null ? null : Math.round(m * 10) / 10;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return STDEV_FLOOR;
  const m = mean(xs) as number;
  const varSum = xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.max(Math.sqrt(varSum), STDEV_FLOOR);
}

function addDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/* ── 내부 계산 ──────────────────────────────────────────────────────────── */

interface Side {
  cafeteria: Cafeteria;
  ratings: number[];
}

/**
 * 하나의 구내식당에 해당 날짜·끼니의 식단 메뉴(MealItem)가 두 개 이상이라면,
 * 가장 평점이 높은 식단 메뉴의 평점 목록으로 비교한다.
 * (평균 평점이 같을 경우 후기 수가 더 많은 식단 메뉴를 선택)
 */
function ratingsFor(
  items: MealItem[],
  reviews: MealReview[],
  date: string,
  mealTime: MealTime,
  cafeteria: Cafeteria,
): number[] {
  const matchingItems = items.filter(
    (m) => m.date === date && m.mealTime === mealTime && m.cafeteria === cafeteria,
  );
  if (matchingItems.length === 0) return [];
  if (matchingItems.length === 1) {
    const onlyId = matchingItems[0].id;
    return reviews.filter((r) => r.mealItemId === onlyId).map((r) => r.rating);
  }

  let bestRatings: number[] = [];
  let bestMean = -Infinity;

  for (const item of matchingItems) {
    const itemRatings = reviews.filter((r) => r.mealItemId === item.id).map((r) => r.rating);
    if (itemRatings.length === 0) continue;
    const itemMean = mean(itemRatings) as number;
    if (
      itemMean > bestMean ||
      (itemMean === bestMean && itemRatings.length > bestRatings.length)
    ) {
      bestMean = itemMean;
      bestRatings = itemRatings;
    }
  }

  return bestRatings;
}

/** 최근 7일(당일 제외 직전 7일 + 당일) 추세. 표본이 모자라면 정직하게 flat. */
function trendFor(
  items: MealItem[],
  reviews: MealReview[],
  date: string,
  mealTime: MealTime,
  cafeteria: Cafeteria,
): 'up' | 'down' | 'flat' {
  const recent: number[] = [];
  const earlier: number[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(date, -i);
    const rs = ratingsFor(items, reviews, d, mealTime, cafeteria);
    if (i < 3) recent.push(...rs);
    else earlier.push(...rs);
  }
  if (recent.length < TREND_MIN_N || earlier.length < TREND_MIN_N) return 'flat';
  const diff = (mean(recent) as number) - (mean(earlier) as number);
  if (diff >= TREND_DELTA) return 'up';
  if (diff <= -TREND_DELTA) return 'down';
  return 'flat';
}

/** 두 진영의 평점 차이가 표본오차 밖인가 (Welch 근사) */
function isSeparated(a: number[], b: number[]): boolean {
  const gap = Math.abs((mean(a) as number) - (mean(b) as number));
  const se = Math.sqrt(stdev(a) ** 2 / a.length + stdev(b) ** 2 / b.length);
  return gap >= Z95 * se;
}

/* ── 헤드라인 ───────────────────────────────────────────────────────────── */

function headlineFor(
  mealTime: MealTime,
  winner: Cafeteria | null,
  decisive: boolean,
  sides: Side[],
  streak: number,
): string {
  const meal = MEAL_TIME_LABELS[mealTime];
  const [a, b] = sides;
  const totalN = a.ratings.length + b.ratings.length;

  if (totalN === 0) {
    return `오늘 ${meal}은 아직 후기가 없습니다 — 첫 후기를 남겨보세요`;
  }
  if (!decisive) {
    const tooSmall =
      a.ratings.length < MIN_REVIEWS_PER_SIDE || b.ratings.length < MIN_REVIEWS_PER_SIDE;
    if (tooSmall) {
      return `오늘 ${meal}은 무승부 — 표본이 너무 적습니다 (${CAFETERIA_LABELS[a.cafeteria]} ${a.ratings.length}건 / ${CAFETERIA_LABELS[b.cafeteria]} ${b.ratings.length}건)`;
    }
    return `오늘 ${meal}은 무승부 — 평점 차이가 오차 범위 안입니다`;
  }
  const label = CAFETERIA_LABELS[winner as Cafeteria];
  const short = winner === 'changbo' ? '창보' : '학식';
  const loser = winner === 'changbo' ? '학식' : '창보';
  if (streak >= 3) return `오늘 ${meal}도 ${short} 판정승 — ${loser} ${streak}연패`;
  if (streak === 2) return `오늘 ${meal}은 ${short} 2연승`;
  return `오늘 ${meal}은 ${label} 판정승`;
}

/* ── 공개 API ───────────────────────────────────────────────────────────── */

export interface BattleInput {
  date: string;
  mealTime: MealTime;
  items: MealItem[];
  reviews: MealReview[];
}

/** 순수 함수 버전 — 테스트/클라이언트 계산에 쓸 수 있다. */
export function computeBattle({ date, mealTime, items, reviews }: BattleInput): BattleResult {
  const sides: Side[] = BATTLE_SIDES.map((cafeteria) => ({
    cafeteria,
    ratings: ratingsFor(items, reviews, date, mealTime, cafeteria),
  }));

  // 스코어보드에는 그날 그 끼니에 운영한 모든 식당을 싣는다.
  const servingCafeterias = new Set<Cafeteria>(BATTLE_SIDES);
  for (const m of items) {
    if (m.date === date && m.mealTime === mealTime) servingCafeterias.add(m.cafeteria);
  }

  const standings: BattleStanding[] = [...servingCafeterias].map((cafeteria) => {
    const ratings = ratingsFor(items, reviews, date, mealTime, cafeteria);
    return {
      cafeteria,
      label: CAFETERIA_LABELS[cafeteria],
      avgRating: displayMean(ratings),
      reviewCount: ratings.length,
      trend: trendFor(items, reviews, date, mealTime, cafeteria),
    };
  });

  // 대결 진영을 앞으로, 그 안에서는 평점 높은 순 (후기 없는 곳은 맨 뒤)
  standings.sort((x, y) => {
    const sideX = BATTLE_SIDES.includes(x.cafeteria) ? 0 : 1;
    const sideY = BATTLE_SIDES.includes(y.cafeteria) ? 0 : 1;
    if (sideX !== sideY) return sideX - sideY;
    return (y.avgRating ?? -1) - (x.avgRating ?? -1);
  });

  const [a, b] = sides;
  const enoughSample =
    a.ratings.length >= MIN_REVIEWS_PER_SIDE && b.ratings.length >= MIN_REVIEWS_PER_SIDE;

  let decisive = false;
  let winner: Cafeteria | null = null;

  if (enoughSample) {
    const ma = mean(a.ratings) as number;
    const mb = mean(b.ratings) as number;
    const gap = Math.abs(ma - mb);
    if (gap >= MIN_RATING_GAP && isSeparated(a.ratings, b.ratings)) {
      decisive = true;
      winner = ma > mb ? a.cafeteria : b.cafeteria;
    }
  }

  const streak = winner ? winStreak(items, reviews, date, mealTime, winner) : 0;

  return {
    date,
    mealTime,
    standings,
    winner,
    decisive,
    headline: headlineFor(mealTime, winner, decisive, sides, streak),
  };
}

/** 같은 끼니 기준 연승 수 (당일 포함, 최대 10일 소급). 판정이 유보된 날은 연승을 끊는다. */
function winStreak(
  items: MealItem[],
  reviews: MealReview[],
  date: string,
  mealTime: MealTime,
  winner: Cafeteria,
): number {
  let streak = 0;
  for (let i = 0; i < 10; i++) {
    const d = addDays(date, -i);
    const sides = BATTLE_SIDES.map((c) => ratingsFor(items, reviews, d, mealTime, c));
    const [ra, rb] = sides;
    if (ra.length < MIN_REVIEWS_PER_SIDE || rb.length < MIN_REVIEWS_PER_SIDE) break;
    const ma = mean(ra) as number;
    const mb = mean(rb) as number;
    if (Math.abs(ma - mb) < MIN_RATING_GAP || !isSeparated(ra, rb)) break;
    const dayWinner = ma > mb ? BATTLE_SIDES[0] : BATTLE_SIDES[1];
    if (dayWinner !== winner) break;
    streak += 1;
  }
  return streak;
}
