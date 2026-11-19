import { calculateCourseBalance, convertedAssessmentScore } from './balance.ts';
import { weightBasisPoints } from '../grade-record.ts';
import type { CourseGradeRecord } from '../grade-record.ts';

export type GradeScenario = Readonly<Record<string, number>>;
export type CourseGradeSimulation =
  | { status: 'not-started' | 'empty' | 'invalid' | 'partial' }
  | { status: 'invalid-scenario'; assessmentId: string }
  | {
    status: 'ready';
    secured: number;
    assumed: number;
    remaining: number;
    pendingWeight: number;
    plannedWeight: number;
    minimum: number;
    maximum: number;
  };

export function simulateCourseGrade(record?: CourseGradeRecord, scenario: GradeScenario = {}): CourseGradeSimulation {
  const balance = calculateCourseBalance(record);
  if (!record) return { status: 'not-started' };
  if (balance.status !== 'complete') return { status: balance.status };

  const eligible = new Map(record.assessments.filter(item =>
    item.result.status === 'planned' || item.result.status === 'pending',
  ).map(item => [item.id, item]));
  let assumed = 0;
  let pendingPoints = weightBasisPoints(balance.pendingWeight);
  let plannedPoints = weightBasisPoints(balance.plannedWeight);
  for (const [id, score] of Object.entries(scenario)) {
    const item = eligible.get(id);
    if (!item || !Number.isFinite(score) || score < 0 || score > item.maxScore) return { status: 'invalid-scenario', assessmentId: id };
    assumed += convertedAssessmentScore(item.weightPercent, score, item.maxScore);
    if (item.result.status === 'pending') pendingPoints -= weightBasisPoints(item.weightPercent);
    else plannedPoints -= weightBasisPoints(item.weightPercent);
  }
  const remaining = (pendingPoints + plannedPoints) / 100;
  const minimum = Math.min(100, balance.secured + assumed);
  return {
    status: 'ready', secured: balance.secured, assumed, remaining, minimum,
    maximum: Math.min(100, minimum + remaining),
    pendingWeight: pendingPoints / 100, plannedWeight: plannedPoints / 100,
  };
}

export type TargetRequirement =
  | { status: 'held' | 'invalid-target' }
  | { status: 'met' | 'impossible'; target: number }
  | { status: 'possible'; target: number; requiredRate: number };

export function calculateTargetRequirement(simulation: CourseGradeSimulation, target: number): TargetRequirement {
  if (!Number.isFinite(target) || target < 0 || target > 100) return { status: 'invalid-target' };
  if (simulation.status !== 'ready') return { status: 'held' };
  // Bound numerical drift from summing at most 100 nonnegative contributions.
  // Display rounding never participates in this comparison.
  const tolerance = (score: number) => 100 * Number.EPSILON * Math.max(target, score);
  if (target <= simulation.minimum || (simulation.minimum > 0 && target - simulation.minimum <= tolerance(simulation.minimum))) {
    return { status: 'met', target };
  }
  if (!simulation.remaining || target > simulation.maximum && target - simulation.maximum > tolerance(simulation.maximum)) {
    return { status: 'impossible', target };
  }
  return { status: 'possible', target, requiredRate: Math.min(100, (target - simulation.minimum) / simulation.remaining * 100) };
}
