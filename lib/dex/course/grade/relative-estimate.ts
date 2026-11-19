import { calculateCourseBalance } from './balance.ts';
import { statisticsConcern, effectiveRelativePolicy } from './relative.ts';
import type { GradeScenario } from './simulation.ts';
import type { RelativeAssumptions } from './outlook.ts';
import { confirmedScore } from '../grade-record.ts';
import type { CourseGradeRecord } from '../grade-record.ts';

const samples = 512;
type Quantile = (p: number) => number;

// Maximum entropy on [0,1] with a fixed mean gives a truncated exponential.
// Reflect a decreasing exponential to avoid overflow for means above 0.5.
function meanQuantile(mean: number): Quantile {
  if (mean === 0 || mean === 1) return () => mean;
  if (mean > 0.5) {
    const reflected = meanQuantile(1 - mean);
    return p => 1 - reflected(1 - p);
  }
  if (0.5 - mean < 1e-9) return p => p;
  let low = 0, high = 1 / mean;
  if (!Number.isFinite(high)) return () => mean;
  for (let i = 0; i < 64; i++) {
    const mid = low + (high - low) / 2;
    const fitted = mid < 1e-4 ? 0.5 - mid / 12 : 1 / mid - 1 / Math.expm1(mid);
    if (fitted > mean) low = mid;
    else high = mid;
  }
  return p => -Math.log1p(p * Math.expm1(-high)) / high;
}

function quantiles(mean: number, sd?: number): [Quantile, Quantile] | null {
  if (sd === undefined) return [meanQuantile(mean), p => p > 1 - mean ? 1 : 0];
  if (sd === 0) return [() => mean, () => mean];
  const limit = mean * (1 - mean);
  if (limit === 0 || sd > Math.sqrt(limit) * (1 + 1e-12)) return null;
  const variance = Math.min(limit, sd * sd);
  const upper = Math.min(1, mean + variance / mean);
  const lower = Math.max(0, mean - variance / (1 - mean));
  // Two endpoint-anchored distributions with the same mean and population variance.
  return [p => p > 1 - mean / upper ? upper : 0,
    p => p > (1 - mean) / (1 - lower) ? 1 : lower];
}

function shuffled(ranks: number[], seed: number) {
  const copy = [...ranks];
  for (let i = copy.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = Math.floor(seed / 2 ** 32 * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

type Scope = 'all-weighted' | 'included-only';
type Band = 'a-cap' | 'ab-cap' | 'outside-ab';
export type RelativeEstimate =
  | { status: 'held'; reason: 'method' | 'records' | 'statistics' }
  | {
    status: 'modeled'; scope: Scope; band: Band | 'sensitive' | null;
    weight: number; secured: number; lost: number; unknownPeerWeight: number;
    meanOnlyCount: number; withDeviationCount: number; usesAssumedScores: boolean;
    scenarios: { shape: 'first' | 'alternative'; dependence: 'aligned' | 'shuffled'; missing: 'same' | 'maximum'; above: number; atOrAbove: number }[];
  };

export function estimateRelativeGrade(record: CourseGradeRecord, scores: GradeScenario = {}, assumptions: RelativeAssumptions = {}): RelativeEstimate {
  if (record.method !== 'relative') return { status: 'held', reason: 'method' };
  const balance = calculateCourseBalance(record);
  if (!('items' in balance)) return { status: 'held', reason: 'records' };
  const ranked = Array.from({ length: samples }, (_, i) => (i + 0.5) / samples);
  const rows = record.assessments.flatMap((item, index) => {
    if (!item.weightPercent) return [];
    const official = confirmedScore(item.result);
    const score = official ?? (Object.hasOwn(scores, item.id) ? scores[item.id] : undefined);
    if (score === undefined || !Number.isFinite(score) || score < 0 || score > item.maxScore) return [];
    const stats = official !== undefined ? item.statistics : Object.hasOwn(assumptions, item.id) ? assumptions[item.id] : undefined;
    const validMean = stats?.mean !== undefined && Number.isFinite(stats.mean) && stats.mean >= 0 && stats.mean <= item.maxScore;
    const sd = stats?.standardDeviation;
    const models = validMean && stats && (sd === undefined || (Number.isFinite(sd) && sd >= 0)) && !statisticsConcern(item.maxScore, stats)
      ? quantiles(stats.mean! / item.maxScore, sd === undefined ? undefined : sd / item.maxScore) : null;
    return [{ weight: item.weightPercent, score: score / item.maxScore, models, sd, assumed: official === undefined, index }];
  });
  if (!rows.some(row => row.models)) return { status: 'held', reason: 'statistics' };
  const weight = rows.reduce((sum, row) => sum + Math.round(row.weight * 100), 0) / 100;
  const unknownPeerWeight = rows.filter(row => !row.models).reduce((sum, row) => sum + Math.round(row.weight * 100), 0) / 100;
  const mine = rows.reduce((sum, row) => sum + row.weight * row.score, 0);
  const permutations = rows.map(row => shuffled(ranked, row.index + 1));
  const scenarios = [];
  for (const shape of ['first', 'alternative'] as const) {
    for (const dependence of (rows.filter(row => row.models).length > 1 ? ['aligned', 'shuffled'] as const : ['aligned'] as const)) {
      for (const missing of (unknownPeerWeight ? ['same', 'maximum'] as const : ['same'] as const)) {
        let above = 0, tied = 0;
        for (let i = 0; i < samples; i++) {
          let total = 0;
          for (let j = 0; j < rows.length; j++) {
            const row = rows[j];
            const p = dependence === 'aligned' ? ranked[i] : permutations[j][i];
            total += row.weight * (row.models ? row.models[shape === 'first' ? 0 : 1](p) : missing === 'maximum' ? 1 : row.score);
          }
          if (total > mine + 1e-10) above++;
          else if (Math.abs(total - mine) <= 1e-10) tied++;
        }
        scenarios.push({ shape, dependence, missing, above: above / samples * 100, atOrAbove: (above + tied) / samples * 100 });
      }
    }
  }
  const policy = effectiveRelativePolicy(record.relative);
  const classify = (share: number): Band | null => {
    if (!policy || policy.source === 'unconfirmed') return null;
    if (policy.aCap !== undefined && policy.aCap > 0 && share <= policy.aCap) return 'a-cap';
    if (policy.abCap !== undefined && share > policy.abCap) return 'outside-ab';
    if (policy.aCap !== undefined && policy.abCap !== undefined && share <= policy.abCap) return 'ab-cap';
    return null;
  };
  const bands = new Set(scenarios.flatMap(row => [classify(row.above), classify(row.atOrAbove)]));
  const band = bands.size > 1 ? 'sensitive' : [...bands][0] ?? null;
  return {
    status: 'modeled', scope: balance.status === 'complete' && weight === 100 ? 'all-weighted' : 'included-only',
    weight, secured: balance.secured, lost: balance.lost, unknownPeerWeight, band,
    meanOnlyCount: rows.filter(row => row.models && row.sd === undefined).length,
    withDeviationCount: rows.filter(row => row.models && row.sd !== undefined).length,
    usesAssumedScores: rows.some(row => row.assumed), scenarios,
  };
}
