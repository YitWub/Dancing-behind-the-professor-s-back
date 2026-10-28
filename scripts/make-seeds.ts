/**
 * scripts/make-seeds.ts — 시드 데이터 빌더 (결정론적)
 *
 *   node scripts/make-seeds.ts
 *
 * 출력:
 *   data/meals.seed.json         2주치 학식 식단 (크롤링 실패 시 폴백)
 *   data/meal-reviews.seed.json  학식 후기 (창보 vs 학식 대결용)
 *   data/reviews.seed.json       강의평 시드 (꿀강 파이프라인 입력)
 *
 * 고정 시드 PRNG 를 쓰므로 몇 번을 돌려도 같은 결과가 나온다.
 * ★정직성: 여기서 나오는 데이터는 전부 가상입니다. 실제 수집물이 아닙니다.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  Cafeteria,
  GradeLetter,
  LectureReview,
  MealItem,
  MealReview,
  MealTime,
  Semester,
} from '../lib/types.ts';
import { kstToday } from '../lib/datetime.ts';
import { CAFETERIAS, LECTURE_SEEDS, MENU_POOL, REVIEW_PHRASES } from './seed-corpus.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');

/**
 * 시드 기준일. 이 날짜를 중심으로 2주치를 만든다.
 *
 * ⚠️ 시드 식단은 ANCHOR 앞뒤 2주만 덮는다. 오늘 날짜가 이 범위를 벗어나면
 *    `/api/meals?date=<오늘>` 이 빈 배열을 돌려주고, 대결 시나리오도 전부
 *    "아직 후기가 없습니다" 가 된다. 발표일이 범위 밖이면 기준일을 옮겨서 다시 구울 것:
 *
 *      node scripts/make-seeds.ts --anchor=2026-11-05
 *      SEED_ANCHOR=today node scripts/make-seeds.ts     # 오늘 기준으로
 *
 *    기준일을 옮겨도 대결 시나리오(판정승 / 표본부족 유보 / 무승부)는 ANCHOR 상대로
 *    정의돼 있어서 그대로 따라온다. PRNG 시드도 고정이라 같은 기준일이면 항상 같은 결과다.
 */
const DEFAULT_ANCHOR = '2026-09-23';

function resolveAnchor(): string {
  const raw =
    process.argv.slice(2).find((a) => a.startsWith('--anchor='))?.slice('--anchor='.length) ??
    process.env.SEED_ANCHOR ??
    DEFAULT_ANCHOR;
  // KST 기준. UTC 로 잡으면 발표 당일 아침 9시 이전에 돌렸을 때 기준일이 하루 밀린다.
  if (raw === 'today') return kstToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(new Date(`${raw}T00:00:00Z`).getTime())) {
    throw new Error(`--anchor 는 YYYY-MM-DD 또는 'today' 여야 합니다: ${raw}`);
  }
  return raw;
}

const ANCHOR = resolveAnchor();
const DAYS_BACK = 9;   // ANCHOR 포함 이전 9일
const DAYS_FWD = 4;    // ANCHOR 이후 4일  → 총 14일

/* ── 결정론적 PRNG (mulberry32) ─────────────────────────────────────────── */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(rng: () => number, arr: T[]): T => arr[Math.floor(rng() * arr.length) % arr.length];

/* ── 날짜 유틸 ──────────────────────────────────────────────────────────── */
function addDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
function dow(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0=일
}

const DATES: string[] = [];
for (let i = -DAYS_BACK; i <= DAYS_FWD; i++) DATES.push(addDays(ANCHOR, i));

/* ────────────────────────────────────────────────────────────────────────────
 * 1) 학식 식단
 * ──────────────────────────────────────────────────────────────────────────*/

function buildMeals(): MealItem[] {
  const items: MealItem[] = [];
  const rng = makeRng(20260923);

  DATES.forEach((date, dayIdx) => {
    const weekend = dow(date) === 0 || dow(date) === 6;
    for (const caf of CAFETERIAS) {
      if (weekend && !caf.weekend) continue;
      for (const mealTime of caf.serves) {
        // 주말 창의인재원은 조식/석식만
        if (weekend && caf.id === 'dorm' && mealTime === 'lunch') continue;
        const pool = MENU_POOL[`${caf.id}:${mealTime}`];
        if (!pool) continue;
        const menu = pool[dayIdx % pool.length];
        const price = caf.priceByMeal[mealTime];
        items.push({
          id: `${date}-${caf.id}-${mealTime}`,
          date,
          cafeteria: caf.id,
          mealTime,
          name: null,
          menu: [...menu],
          price,
          // kcal 은 실제 식단표에 없는 경우가 많다 → 일부만 채우고 나머지는 null(모르면 흐리게)
          kcal: rng() < 0.55 ? 520 + Math.round(rng() * 380) : null,
        });
      }
    }
  });
  return items;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 2) 학식 후기 — 대결 시나리오를 의도적으로 설계
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * 정직성 시연을 위해 세 가지 상황을 심는다.
 *   ① 2026-09-23 중식: 창보 우세 + 표본 충분   → decisive: true  (창보 판정승)
 *   ② 2026-09-23 석식: 양쪽 표본 2~3건         → decisive: false (판정 유보)
 *   ③ 2026-09-22 중식: 평점 차이가 오차 범위   → decisive: false (무승부)
 */
interface ReviewPlan {
  date: string;
  mealTime: MealTime;
  cafeteria: Cafeteria;
  n: number;
  mean: number;
  spread: number;
}

const NICKNAMES = [
  '배고픈공대생', '창보단골', '학식러', '에리카3학번', '점심뭐먹지', '밥심으로산다',
  '한대생A', '자취생김씨', '도서관지박령', '오늘도마감', '학관2층', '아침형인간',
  '국물파', '고기파', '샐러드파', '라면끊기실패', '통학러', '기숙사생',
];

const MEAL_COMMENTS: Record<'good' | 'mid' | 'bad', string[]> = {
  good: [
    '가격 대비 훌륭합니다. 또 먹으러 올게요.',
    '오늘 메인 메뉴가 진짜 잘 나왔어요.',
    '줄 서서 기다린 보람 있었습니다.',
    '국이 따뜻하고 간도 딱 맞았어요.',
    '양도 넉넉하고 반찬 구성이 좋았습니다.',
  ],
  mid: [
    '무난했습니다. 특별히 나쁘진 않아요.',
    '가격 생각하면 이 정도면 괜찮습니다.',
    '평소랑 비슷한 퀄리티였어요.',
    '배는 채웠는데 감동은 없었습니다.',
  ],
  bad: [
    '오늘은 좀 아쉬웠어요. 식었습니다.',
    '줄이 너무 길어서 20분 기다렸습니다.',
    '간이 세서 짰어요.',
    '양이 생각보다 적었습니다.',
    '재료가 신선하지 않은 느낌이었어요.',
  ],
};

function buildMealReviewPlans(): ReviewPlan[] {
  const plans: ReviewPlan[] = [];
  const rng = makeRng(77);

  // 기본 배경 데이터: 과거 날짜들에 적당히 뿌린다 (추세 계산용)
  for (const date of DATES) {
    if (date > ANCHOR) continue; // 미래 날짜엔 후기가 없다
    const weekend = dow(date) === 0 || dow(date) === 6;
    if (weekend) continue;
    const daysAgo = Math.round(
      (new Date(`${ANCHOR}T00:00:00Z`).getTime() - new Date(`${date}T00:00:00Z`).getTime()) / 86400000,
    );
    // 창보는 최근 상승세, 학식은 완만한 하락세로 설계
    const changboMean = 3.6 + (7 - Math.min(daysAgo, 7)) * 0.06;
    const haksikMean = 3.7 - (7 - Math.min(daysAgo, 7)) * 0.045;
    plans.push({ date, mealTime: 'lunch', cafeteria: 'changbo', n: 3 + Math.floor(rng() * 4), mean: changboMean, spread: 0.8 });
    plans.push({ date, mealTime: 'lunch', cafeteria: 'haksik', n: 3 + Math.floor(rng() * 5), mean: haksikMean, spread: 0.9 });
    plans.push({ date, mealTime: 'dinner', cafeteria: 'changbo', n: 1 + Math.floor(rng() * 3), mean: changboMean - 0.1, spread: 0.9 });
    plans.push({ date, mealTime: 'dinner', cafeteria: 'haksik', n: 1 + Math.floor(rng() * 3), mean: haksikMean - 0.05, spread: 0.9 });
    plans.push({ date, mealTime: 'lunch', cafeteria: 'dorm', n: Math.floor(rng() * 3), mean: 3.4, spread: 0.8 });
  }

  // 시나리오 ①②③ 로 ANCHOR 인접 날짜를 덮어쓴다
  const override = (p: ReviewPlan) => {
    const i = plans.findIndex(
      (q) => q.date === p.date && q.mealTime === p.mealTime && q.cafeteria === p.cafeteria,
    );
    if (i >= 0) plans[i] = p;
    else plans.push(p);
  };

  // ① 오늘 중식 — 창보 판정승 (표본 충분 + 격차 큼)
  override({ date: ANCHOR, mealTime: 'lunch', cafeteria: 'changbo', n: 11, mean: 4.35, spread: 0.55 });
  override({ date: ANCHOR, mealTime: 'lunch', cafeteria: 'haksik', n: 13, mean: 3.35, spread: 0.7 });
  // ② 오늘 석식 — 표본 부족 → 판정 유보
  override({ date: ANCHOR, mealTime: 'dinner', cafeteria: 'changbo', n: 3, mean: 4.4, spread: 0.5 });
  override({ date: ANCHOR, mealTime: 'dinner', cafeteria: 'haksik', n: 2, mean: 3.0, spread: 0.5 });
  // ③ 어제 중식 — 격차가 오차 범위 → 무승부
  const yesterday = addDays(ANCHOR, -1);
  override({ date: yesterday, mealTime: 'lunch', cafeteria: 'changbo', n: 8, mean: 3.9, spread: 1.0 });
  override({ date: yesterday, mealTime: 'lunch', cafeteria: 'haksik', n: 9, mean: 3.78, spread: 1.0 });

  return plans;
}

function buildMealReviews(items: MealItem[]): MealReview[] {
  const byId = new Set(items.map((m) => m.id));
  const out: MealReview[] = [];
  const rng = makeRng(31337);
  let seq = 0;

  for (const plan of buildMealReviewPlans()) {
    const mealItemId = `${plan.date}-${plan.cafeteria}-${plan.mealTime}`;
    if (!byId.has(mealItemId)) continue;
    for (let i = 0; i < plan.n; i++) {
      // 평균 주변으로 흔들고 1~5 로 클램프
      const raw = plan.mean + (rng() + rng() + rng() - 1.5) * plan.spread;
      const rating = Math.min(5, Math.max(1, Math.round(raw)));
      const tone: 'good' | 'mid' | 'bad' = rating >= 4 ? 'good' : rating === 3 ? 'mid' : 'bad';
      const hour = plan.mealTime === 'breakfast' ? 9 : plan.mealTime === 'lunch' ? 13 : 19;
      const createdAt = new Date(
        `${plan.date}T${String(hour).padStart(2, '0')}:${String(5 + i * 3).padStart(2, '0')}:00+09:00`,
      ).toISOString();
      out.push({
        id: `MR${String(++seq).padStart(4, '0')}`,
        mealItemId,
        rating,
        text: pick(rng, MEAL_COMMENTS[tone]),
        createdAt,
        nickname: pick(rng, NICKNAMES),
      });
    }
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 3) 강의평 시드
 * ──────────────────────────────────────────────────────────────────────────*/

const AXIS_KEYS = [
  'gradeGenerosity',
  'workload',
  'attendanceStrictness',
  'teachingQuality',
  'examDifficulty',
] as const;

const GRADES: GradeLetter[] = ['A+', 'A0', 'B+', 'B0', 'C+', 'C0', 'D+', 'F'];

function gradeFor(rng: () => number, generosity: number, selfSelection: boolean): GradeLetter | null {
  if (!selfSelection && rng() < 0.45) return null; // 학점을 안 밝히는 사람이 다수
  if (selfSelection && rng() < 0.12) return null;
  const roll = rng() * 0.75 + generosity * 0.55 + (selfSelection ? 0.6 : 0);
  if (roll > 1.15) return 'A+';
  if (roll > 0.92) return 'A0';
  if (roll > 0.72) return 'B+';
  if (roll > 0.55) return 'B0';
  if (roll > 0.4) return 'C+';
  if (roll > 0.28) return 'C0';
  return GRADES[6 + Math.floor(rng() * 2)];
}

function buildLectureReviews(): LectureReview[] {
  const out: LectureReview[] = [];

  for (const seed of LECTURE_SEEDS) {
    const rng = makeRng(seed.id.charCodeAt(1) * 7919 + seed.id.charCodeAt(2) * 104729);
    const traps = seed.traps ?? [];
    const polarized = traps.includes('polarized');
    const selfSelection = traps.includes('self_selection');
    const professorChanged = traps.includes('professor_changed');

    for (let i = 0; i < seed.reviewCount; i++) {
      const [y0, y1] = seed.years;
      const year = y0 + Math.floor(rng() * (y1 - y0 + 1));
      const term = rng() < 0.5 ? 1 : 2;
      const semester = `${year}-${term}` as Semester;

      // 문장 조립: 각 축마다 확률적으로 고/저 문장을 뽑는다
      const parts: string[] = [];
      AXIS_KEYS.forEach((key, axisIdx) => {
        const v = seed.truth[axisIdx];
        // 극단적인 축일수록 언급될 확률이 높다
        const mention = Math.abs(v - 0.5) * 1.5 + 0.18;
        if (rng() > mention) return;
        const polarity = rng() < v ? 'high' : 'low';
        parts.push(pick(rng, REVIEW_PHRASES[`${key}:${polarity}`]));
      });
      if (parts.length === 0) parts.push(pick(rng, REVIEW_PHRASES['filler:neutral']));
      if (rng() < 0.35) parts.push(pick(rng, REVIEW_PHRASES['filler:neutral']));

      // 별점: 꿀강성(학점↑, 과제↓, 강의력↑, 시험↓)에 노이즈
      const honeyish =
        0.35 * seed.truth[0] + 0.2 * (1 - seed.truth[1]) + 0.25 * seed.truth[3] + 0.2 * (1 - seed.truth[4]);
      let rating: number;
      if (polarized) {
        // 극단 리뷰만 몰리는 강의: 1~2 아니면 4~5
        rating = rng() < honeyish ? (rng() < 0.5 ? 5 : 4) : (rng() < 0.5 ? 1 : 2);
      } else {
        rating = Math.min(5, Math.max(1, Math.round(1 + honeyish * 4 + (rng() + rng() - 1) * 0.9)));
      }
      if (selfSelection) rating = Math.min(5, rating + (rng() < 0.4 ? 1 : 0));

      out.push({
        id: `${seed.id}-R${String(i + 1).padStart(3, '0')}`,
        lectureId: seed.id,
        semester,
        rating,
        text: parts.join(' '),
        reportedGrade: gradeFor(rng, seed.truth[0], selfSelection),
      });
    }

    if (professorChanged) {
      // 교수 변경 이력을 만들기 위해 과거 학기 리뷰를 일부 더 심는다
      for (let i = 0; i < 5; i++) {
        out.push({
          id: `${seed.id}-R9${String(i + 1).padStart(2, '0')}`,
          lectureId: seed.id,
          semester: `2023-${i % 2 === 0 ? 1 : 2}` as Semester,
          rating: 2,
          text: `${REVIEW_PHRASES['teachingQuality:low'][i % 4]} ${REVIEW_PHRASES['gradeGenerosity:low'][i % 5]}`,
          reportedGrade: 'C+',
        });
      }
    }
  }
  return out;
}

/* ── 실행 ───────────────────────────────────────────────────────────────── */

function write(name: string, value: unknown): void {
  const p = join(DATA, name);
  writeFileSync(p, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  console.log(`  ✓ data/${name}`);
}

mkdirSync(DATA, { recursive: true });

const meals = buildMeals();
const mealReviews = buildMealReviews(meals);
const lectureReviews = buildLectureReviews();

console.log('시드 생성 (전부 가상 데이터):');
write('meals.seed.json', {
  note: '시드(가상) 식단 데이터. 크롤링 실패 시 폴백으로만 사용한다.',
  generatedBy: 'scripts/make-seeds.ts',
  anchorDate: ANCHOR,
  items: meals,
});
write('meal-reviews.seed.json', {
  note: '시드(가상) 학식 후기. 대결 판정 로직 시연용.',
  generatedBy: 'scripts/make-seeds.ts',
  reviews: mealReviews,
});
write('reviews.seed.json', {
  note: '시드(가상) 강의평. 에브리타임 등 실제 사이트는 로그인·ToS 문제로 수집하지 않았다.',
  generatedBy: 'scripts/make-seeds.ts',
  lectures: LECTURE_SEEDS.map((l) => ({
    id: l.id,
    name: l.name,
    professor: l.professor,
    department: l.department,
    credits: l.credits,
    type: l.type,
    professorChanged: (l.traps ?? []).includes('professor_changed'),
  })),
  reviews: lectureReviews,
});

console.log(
  `\n식단 ${meals.length}건 / 학식후기 ${mealReviews.length}건 / 강의 ${LECTURE_SEEDS.length}개 · 강의평 ${lectureReviews.length}건`,
);
console.log(`기준일 ${ANCHOR} · 식단 범위 ${DATES[0]} ~ ${DATES[DATES.length - 1]}`);

const todayIso = kstToday();
if (todayIso < DATES[0] || todayIso > DATES[DATES.length - 1]) {
  console.log(
    `\n⚠️  오늘(${todayIso})이 시드 범위 밖입니다. 오늘 날짜로 조회하면 식단이 비어 나옵니다.\n` +
      `    발표/데모 전에 기준일을 옮겨 다시 구우세요:  node scripts/make-seeds.ts --anchor=${todayIso}`,
  );
}
