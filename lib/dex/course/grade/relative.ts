import { confirmedScore } from '../grade-record.ts';
import type { CourseAssessment } from '../grade-record.ts';

export interface PublishedRank { rank: number; cohortSize?: number }
export interface AssessmentStatistics { mean?: number; standardDeviation?: number; publishedRank?: PublishedRank }
export interface RelativePolicy {
  source: 'unconfirmed' | 'official-guidance' | 'assumed';
  description?: string;
  aCap?: number;
  abCap?: number;
}
export interface CourseRelativeData {
  enrollment?: number;
  policy?: RelativePolicy;
  overallRank?: { rank: number; scope: string };
}

export function statisticsConcern(max: number, stats: AssessmentStatistics): boolean {
  const { mean, standardDeviation } = stats;
  if (mean === undefined || standardDeviation === undefined || standardDeviation === 0) return false;
  // Bhatia–Davis bound, widened for an unknown sample/population convention (n >= 2).
  return standardDeviation / max > Math.sqrt(2 * (mean / max) * ((max - mean) / max)) + 1e-12;
}

export function analyzeAssessmentPosition(item: CourseAssessment) {
  const score = confirmedScore(item.result);
  const stats = item.statistics;
  const mean = stats?.mean;
  const difference = score === undefined || mean === undefined ? null : score - mean;
  const concern = !!stats && statisticsConcern(item.maxScore, stats);
  const deviation = stats?.standardDeviation;
  const standardized = difference !== null && deviation && !concern ? difference / deviation : null;
  return {
    score: score ?? null, mean: mean ?? null, difference,
    position: difference === null ? null : difference > 0 ? 'above' : difference < 0 ? 'below' : 'equal',
    z: standardized !== null && Number.isFinite(standardized) ? standardized : null,
    publishedRank: stats?.publishedRank ?? null, concern,
  };
}

export function analyzePublishedRank(data?: CourseRelativeData) {
  const rank = data?.overallRank;
  if (!rank) return null;
  const cohortSize = data.enrollment;
  const policy = data.policy;
  const ordinalShare = cohortSize === undefined ? null : rank.rank / cohortSize * 100;
  function compare(cap?: number) {
    if (ordinalShare === null || policy?.source === 'unconfirmed' || cap === undefined) return null;
    return ordinalShare <= cap + Number.EPSILON * 100 ? 'within' : 'outside';
  }
  return { ...rank, cohortSize, ordinalShare, policySource: policy?.source ?? 'unconfirmed', a: compare(policy?.aCap), ab: compare(policy?.abCap) };
}
