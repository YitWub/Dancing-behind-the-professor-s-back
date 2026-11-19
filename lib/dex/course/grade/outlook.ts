import type { CourseGradeRecord } from '../grade-record.ts';
import { analyzeAssessmentPosition, analyzePublishedRank } from './relative.ts';
import type { GradeScenario } from './simulation.ts';

export type RelativeAssumptions = Readonly<Record<string, { mean?: number; standardDeviation?: number }>>;

export function analyzeRelativeOutlook(record: CourseGradeRecord, sameCohort = false) {
  const assessments = record.assessments.map(item => ({
    id: item.id, name: item.name, weight: item.weightPercent, standardDeviation: item.statistics?.standardDeviation,
    ...analyzeAssessmentPosition(item),
  }));
  const rank = analyzePublishedRank(record.relative);
  const policy = record.relative?.policy;
  const boundary = (cap: number | undefined, comparison: 'within' | 'outside' | null | undefined) =>
    sameCohort && rank?.cohortSize && cap !== undefined && comparison
      ? { comparison, near: Math.abs(rank.rank - rank.cohortSize * (cap / 100)) <= 1 }
      : null;
  return {
    assessments, rank,
    a: boundary(policy?.aCap, rank?.a), ab: boundary(policy?.abCap, rank?.ab),
    gradeStatus: 'held' as const,
    reason: rank ? 'final-rank-and-allocation-unverified' as const : 'joint-distribution-and-final-rank-unavailable' as const,
  };
}

export function analyzeRelativeScenario(record: CourseGradeRecord, scenario: GradeScenario, assumptions: RelativeAssumptions) {
  return record.assessments.map(item => {
    if ((item.result.status !== 'planned' && item.result.status !== 'pending') || !Object.hasOwn(scenario, item.id)) return null;
    const score = scenario[item.id];
    const { mean, standardDeviation } = Object.hasOwn(assumptions, item.id) ? assumptions[item.id] : {};
    const metadata = { id: item.id, name: item.name, assessmentStatus: item.result.status, score, mean, standardDeviation };
    if (!Number.isFinite(score) || score < 0 || score > item.maxScore ||
      (mean !== undefined && (!Number.isFinite(mean) || mean < 0 || mean > item.maxScore)) ||
      (standardDeviation !== undefined && (!Number.isFinite(standardDeviation) || standardDeviation < 0 ||
        standardDeviation > item.maxScore / Math.SQRT2 * (1 + Number.EPSILON)))) {
      return { ...metadata, status: 'invalid' as const, difference: null, z: null };
    }
    const position = analyzeAssessmentPosition({ ...item, result: { status: 'graded', score }, statistics: { mean, standardDeviation } });
    return {
      ...metadata,
      status: position.concern ? 'check-statistics' as const : position.z === null ? 'incomplete' as const : 'ready' as const,
      difference: position.difference, z: position.z,
    };
  }).filter(row => row !== null);
}
