/**
 * lib/grade/allocation.ts — 배분 대시보드 (회의록 4-5 [2순위], 재방문 논리의 핵심)
 *
 * "어느 과목에 힘을 쏟을 것인가"에 답한다. 변별 기여도가 "그 과목 안에서 무엇을"을
 * 정하므로 둘이 정확히 맞물린다.
 *
 * 과목을 세 구역으로 나눈다
 *   확정권 locked      이미 등급이 사실상 굳었다 — 더 해도 안 오르고 덜 해도 안 내린다
 *   경계권 borderline  컷오프 위에 걸쳐 있다 — 1~2점이 등급을 바꾼다
 *   역전권 reversible  남은 배점이 커서 아직 뒤집을 수 있다
 *
 * 정렬 기준: "기말 +1점당 예상 학기평점 상승폭"(gpaGainPerPoint).
 *
 * ★시간 환산은 의도적으로 하지 않는다 (회의록 4-5)
 *   "1시간 투자 → 몇 점"은 개인차·과목차가 커서 앱이 알 수 없다.
 *   모르는 것을 곱하면 뒤의 모든 숫자가 오염되므로 점수 단위에서 멈춘다.
 *   "어디에 1점을 넣는 게 가장 남는가"까지가 앱이 정직하게 말할 수 있는 한계다.
 *
 * 미분의 의미: 환산점수 1점이 표준화 척도로는 몇 칸인가를 모형에서 유도한다.
 *   Δz_std = 1 / (100 · T · D),  T = Σwⱼσ̃ⱼ,  D = √(Σwᵢ²+2Σwᵢwⱼρ)
 * 어느 평가요소에서 얻은 1점이든 이 계수가 같다는 점이 이 지표를 과목 간 비교 가능하게 한다.
 */

import type { AllocationRow, Course, CourseZone, CumulativeGradeProb } from '@/lib/types';
import { deltaZPerPoint, type CompositeResult } from './composite.ts';
import { buildZComponents } from './tier.ts';
import { buildDistribution, predictInternal, type PredictOptions } from './predict.ts';
import { GPA_POINTS, GRADE_ORDER } from './scale.ts';

/** 최빈 등급의 확률이 이 이상이면 확정권으로 본다 */
const LOCKED_MODE_PROB = 0.7;
/** 남은 배점이 이 미만이면 (환산점수 기준) 뒤집을 여지가 없다 */
const LOCKED_REMAINING = 3;

export function allocate(courses: Course[], opts: PredictOptions = {}): AllocationRow[] {
  const totalCredits = courses.reduce((s, c) => s + c.credits, 0);

  return courses
    .map((course) => row(course, totalCredits, opts))
    .sort((a, b) => b.gpaGainPerPoint - a.gpaGainPerPoint);
}

function row(course: Course, totalCredits: number, opts: PredictOptions): AllocationRow {
  const internals = predictInternal(course, opts);
  const { prediction, composites } = internals;
  const remaining = prediction.balance.remaining;

  const zone = classify(prediction.distribution, prediction.warnings, remaining);

  let gpaGainPerPoint = 0;
  if (composites && prediction.distribution && remaining > 0 && totalCredits > 0) {
    const { effectiveWeightTotal } = buildZComponents(course);
    const before = expectedGpa(prediction.distribution);

    // 환산점수 +1점에 해당하는 z 이동을 ρ별로 각각 적용한다
    const shifted: CompositeResult[] = composites.map((c) => ({
      ...c,
      zStd: c.zStd + deltaZPerPoint(effectiveWeightTotal, c.denominator),
    }));
    const after = expectedGpa(buildDistribution(shifted, internals.tauFloor, internals.quota));

    // 과목 평점 상승분 × 학점 비중 = 학기 평점 상승분
    gpaGainPerPoint = ((after - before) * course.credits) / totalCredits;
  }

  return {
    courseId: course.id,
    courseName: course.name,
    zone,
    gpaGainPerPoint: round4(Math.max(0, gpaGainPerPoint)),
  };
}

function classify(
  dist: CumulativeGradeProb[] | null,
  warnings: { code: string }[],
  remaining: number,
): CourseZone {
  if (warnings.some((w) => w.code === 'BORDERLINE')) return 'borderline';

  // 등급을 계산하지 못한 과목(격하/blur)은 등급 기준으로 구역을 나눌 수 없다.
  // 남은 배점만으로 판단하고, 화면에서는 "정보 부족"을 함께 표시해야 한다.
  if (!dist) return remaining > LOCKED_REMAINING ? 'reversible' : 'locked';

  if (remaining <= LOCKED_REMAINING) return 'locked';

  const pm = pointMass(dist);
  const top = Math.max(...pm.values());
  return top >= LOCKED_MODE_PROB ? 'locked' : 'reversible';
}

/** 누적확률 → 등급별 확률. 기대평점 계산에만 쓰고 화면으로 내보내지 않는다 */
export function pointMass(dist: CumulativeGradeProb[]): Map<string, number> {
  const order = new Map(GRADE_ORDER.map((g, i) => [g, i]));
  const sorted = [...dist].sort((a, b) => (order.get(a.grade) ?? 0) - (order.get(b.grade) ?? 0));
  const out = new Map<string, number>();
  let prev = 0;
  for (const d of sorted) {
    out.set(d.grade, Math.max(0, d.atLeastProb - prev));
    prev = d.atLeastProb;
  }
  return out;
}

export function expectedGpa(dist: CumulativeGradeProb[]): number {
  let g = 0;
  for (const [grade, p] of pointMass(dist)) {
    g += p * (GPA_POINTS[grade as keyof typeof GPA_POINTS] ?? 0);
  }
  return g;
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
