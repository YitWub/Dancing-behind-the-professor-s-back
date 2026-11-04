/**
 * scripts/make-seeds.ts — 시드 데이터 빌더 (결정론적)
 *
 *   node scripts/make-seeds.ts
 *
 * 출력:
 *   data/meals.seed.json         2주치 학식 식단 (크롤링 실패 시 폴백)
 *   data/meal-reviews.seed.json  학식 후기 (미리 들어간 덤프 데이터 없음 — 빈 배열)
 *   data/reviews.seed.json       강의평 시드 (꿀강 파이프라인 입력)
 *
 * 고정 시드 PRNG 를 쓰므로 몇 번을 돌려도 같은 결과가 나온다.
 * ★정직성: 여기서 나오는 데이터는 전부 가상입니다. 실제 수집물이 아닙니다.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  GradeLetter,
  LectureReview,
  MealItem,
  MealReview,
  Semester,
} from '../lib/types.ts';
import { kstToday } from '../lib/datetime.ts';
import { CAFETERIAS, LECTURE_SEEDS, MENU_POOL, REVIEW_PHRASES } from './seed-corpus.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');

const DEFAULT_ANCHOR = '2026-09-23';

function resolveAnchor(): string {
  const raw =
    process.argv.slice(2).find((a) => a.startsWith('--anchor='))?.slice('--anchor='.length) ??
    process.env.SEED_ANCHOR ??
    DEFAULT_ANCHOR;
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
        // 주말 기숙사는 조식/석식만
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
          kcal: rng() < 0.55 ? 520 + Math.round(rng() * 380) : null,
        });
      }
    }
  });
  return items;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 2) 학식 후기 — 미리 들어간 덤프 데이터 없음 (빈 배열)
 * ──────────────────────────────────────────────────────────────────────────*/

function buildMealReviews(): MealReview[] {
  return [];
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

      const parts: string[] = [];
      AXIS_KEYS.forEach((key, axisIdx) => {
        const v = seed.truth[axisIdx];
        const mention = Math.abs(v - 0.5) * 1.5 + 0.18;
        if (rng() > mention) return;
        const polarity = rng() < v ? 'high' : 'low';
        parts.push(pick(rng, REVIEW_PHRASES[`${key}:${polarity}`]));
      });
      if (parts.length === 0) parts.push(pick(rng, REVIEW_PHRASES['filler:neutral']));
      if (rng() < 0.35) parts.push(pick(rng, REVIEW_PHRASES['filler:neutral']));

      const honeyish =
        0.35 * seed.truth[0] + 0.2 * (1 - seed.truth[1]) + 0.25 * seed.truth[3] + 0.2 * (1 - seed.truth[4]);
      let rating: number;
      if (polarized) {
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
const mealReviews = buildMealReviews();
const lectureReviews = buildLectureReviews();

console.log('시드 생성 (전부 가상 데이터):');
write('meals.seed.json', {
  note: '시드(가상) 식단 데이터. 크롤링 실패 시 폴백으로만 사용한다.',
  generatedBy: 'scripts/make-seeds.ts',
  anchorDate: ANCHOR,
  items: meals,
});
write('meal-reviews.seed.json', {
  note: '학식 후기 초기 시드 (덤프 데이터 제거됨)',
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
