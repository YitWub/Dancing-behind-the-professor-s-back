import { validateCourseGrade } from '../../core/validation.ts';
import { assessmentWeight, confirmedScore, weightBasisPoints } from '../grade-record.ts';
import type { CourseAssessment, CourseGradeRecord } from '../grade-record.ts';

export interface AssessmentBalance {
  id: string;
  name: string;
  status: CourseAssessment['result']['status'];
  weight: number;
  secured: number | null;
  lost: number;
  unconfirmed: number;
}

export type CourseGradeBalance =
  | { status: 'not-started' | 'empty' | 'invalid'; hp: null }
  | {
    status: 'partial' | 'complete';
    registeredWeight: number;
    unallocatedWeight: number;
    secured: number;
    lost: number;
    plannedWeight: number;
    pendingWeight: number;
    unconfirmed: number;
    hp: number | null;
    items: AssessmentBalance[];
  };

export function calculateCourseBalance(record?: CourseGradeRecord): CourseGradeBalance {
  if (record === undefined) return { status: 'not-started', hp: null };
  try {
    validateCourseGrade(record);
  } catch {
    return { status: 'invalid', hp: null };
  }
  if (!record.assessments.length) return { status: 'empty', hp: null };

  const registeredWeight = assessmentWeight(record.assessments);
  const unallocatedWeight = (10_000 - weightBasisPoints(registeredWeight)) / 100;
  let secured = 0;
  let lost = 0;
  let plannedPoints = 0;
  let pendingPoints = 0;
  const items = record.assessments.map((item): AssessmentBalance => {
    const score = confirmedScore(item.result);
    const { status } = item.result;
    const weight = item.weightPercent;
    const gain = score === undefined ? null : weight * (score / item.maxScore);
    const loss = gain === null ? 0 : weight - gain;
    secured += gain ?? 0;
    lost += loss;
    if (status === 'planned') plannedPoints += weightBasisPoints(weight);
    if (status === 'pending') pendingPoints += weightBasisPoints(weight);
    return { id: item.id, name: item.name, status, weight, secured: gain, lost: loss, unconfirmed: gain === null ? weight : 0 };
  });
  const unconfirmed = (plannedPoints + pendingPoints) / 100;
  const complete = unallocatedWeight === 0;
  return {
    status: complete ? 'complete' : 'partial',
    registeredWeight, unallocatedWeight, secured, lost,
    plannedWeight: plannedPoints / 100, pendingWeight: pendingPoints / 100, unconfirmed,
    // Equivalent to 100 minus lost points for a complete scheme.
    hp: complete ? Math.min(100, secured + unconfirmed) : null,
    items,
  };
}
