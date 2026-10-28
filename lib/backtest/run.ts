import type { BacktestCase, BacktestReport, CaseOutcome, EngineAdapter } from './types.ts';
import { brierForCase, buildCalibration, calibrationPairs, scoreCase } from './metrics.ts';

/**
 * 백테스트 실행기.
 *
 * 회의록 4-6(1): "기능 구현과 성능 검증은 다른 일이다."
 * 앱이 예측한 학점의 정답은 발표 이후에 나오므로, 발표 때 "우리 예측이 맞았다"를
 * 보여줄 유일한 방법이 지난 학기 데이터로 돌리는 사후 백테스트다.
 */
export function runBacktest(cases: BacktestCase[], engine: EngineAdapter): BacktestReport {
  const outcomes: CaseOutcome[] = [];
  const calPairs: { predicted: number; hit: boolean }[] = [];
  const briers: number[] = [];

  for (const c of cases) {
    const prediction = engine.predict(c.course);
    const outcome = scoreCase(c.id, prediction, c.actualGrade);
    outcomes.push(outcome);

    if (!outcome.skipped && prediction.distribution) {
      calPairs.push(...calibrationPairs(prediction.distribution, c.actualGrade));
      briers.push(brierForCase(prediction.distribution, c.actualGrade));
    }
  }

  const evaluated = outcomes.filter((o) => !o.skipped);
  const n = evaluated.length;

  const hits = evaluated.filter((o) => o.gradeError === 0);
  const nearHits = evaluated.filter((o) => o.gradeError !== null && Math.abs(o.gradeError) <= 1);
  const misses = evaluated.filter((o) => o.gradeError !== 0);
  const covered = evaluated.filter((o) => o.withinInterval === true);

  const meanAbsGradeError = n
    ? evaluated.reduce((s, o) => s + Math.abs(o.gradeError ?? 0), 0) / n
    : 0;

  const byTier: BacktestReport['byTier'] = {};
  for (const o of evaluated) {
    const key = `T${o.tier}`;
    byTier[key] ??= { count: 0, hitRate: 0, meanAbsGradeError: 0 };
    byTier[key].count += 1;
  }
  for (const key of Object.keys(byTier)) {
    const group = evaluated.filter((o) => `T${o.tier}` === key);
    byTier[key].hitRate = group.filter((o) => o.gradeError === 0).length / group.length;
    byTier[key].meanAbsGradeError =
      group.reduce((s, o) => s + Math.abs(o.gradeError ?? 0), 0) / group.length;
  }

  const missesFlagged = misses.length
    ? misses.filter((o) => o.borderline).length / misses.length
    : 1;

  return {
    totalCases: cases.length,
    evaluated: n,
    skipped: outcomes.length - n,
    hitRate: n ? hits.length / n : 0,
    nearHitRate: n ? nearHits.length / n : 0,
    meanAbsGradeError,
    intervalCoverage: n ? covered.length / n : 0,
    missesFlaggedBorderline: missesFlagged,
    brierScore: briers.length ? briers.reduce((s, b) => s + b, 0) / briers.length : null,
    calibration: buildCalibration(calPairs),
    byTier,
    outcomes,
    headline: buildHeadline(n, hits.length, meanAbsGradeError, misses, outcomes.length - n),
  };
}

/**
 * 발표 슬라이드에 그대로 붙일 한 문장.
 * ★"틀린 건 전부 경계 구간"은 사실일 때만 말한다. 사실이 아니면 사실대로 쓴다.
 *   이 앱은 과장하지 않는 것이 정체성이므로, 발표 문구에서 그걸 깨면 안 된다.
 */
function buildHeadline(
  n: number,
  hits: number,
  mae: number,
  misses: CaseOutcome[],
  skipped: number,
): string {
  if (n === 0) return '평가 가능한 케이스가 없습니다 — 표준편차가 공개된 과거 성적을 더 모아야 합니다.';

  const parts = [`${n}건 중 ${hits}건 적중`, `평균 오차 ${mae.toFixed(2)}등급`];

  if (misses.length === 0) {
    parts.push('오답 없음');
  } else {
    const flagged = misses.filter((o) => o.borderline).length;
    parts.push(
      flagged === misses.length
        ? `틀린 ${misses.length}건은 전부 엔진이 미리 경계 구간이라고 표시한 케이스`
        : `틀린 ${misses.length}건 중 ${flagged}건만 경계 구간으로 사전 표시됨`,
    );
  }

  if (skipped > 0) {
    parts.push(`${skipped}건은 표준편차 미공개로 등급을 단정하지 않아 채점 제외`);
  }

  return parts.join(', ') + '.';
}
