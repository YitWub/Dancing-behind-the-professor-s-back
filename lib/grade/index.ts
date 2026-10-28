/**
 * lib/grade — A필러 공개 API
 *
 * "오늘 이 수업 째도 되나?"에 답하는 순수 TS 엔진.
 * React/Next 임포트 없음, 외부 npm 의존성 없음 — 클라이언트에서 그대로 돈다.
 *
 * 공개 API
 *   predict(course, opts?)            → GradePrediction   등급 확률 3층 출력
 *   contributions(course)             → DiscriminationContribution[]  변별 기여도
 *   whatIf(course, scenario, opts?)   → WhatIfDelta        비교 예측
 *   allocate(courses, opts?)          → AllocationRow[]    배분 대시보드
 *
 * 설계 근거는 ./README.md 참조. 정직성 규칙은 CONTRACT.md 2장.
 */

export { predict, predictInternal, blurProb, SMALL_CLASS_THRESHOLD } from './predict.ts';
export type { PredictOptions, PredictionInternals } from './predict.ts';

export { contributions, DEFAULT_IMPACT_BANDS } from './discrimination.ts';
export type { ContributionOptions, ImpactBandThresholds } from './discrimination.ts';

export { whatIf, whatIfAll, defaultScenarios, scenarioLabel } from './whatif.ts';
export type { Scenario } from './whatif.ts';

export { allocate, expectedGpa } from './allocation.ts';

export { computeBalance, effectiveAbsences, isAttendanceFailure, withExtraAttendance } from './balance.ts';
export type { BalanceDetail, AttendanceDetail } from './balance.ts';

export {
  CONVERTED_MAX,
  CEILING_MEAN_RATIO,
  partitionAssessments,
  detectCeilingEffect,
  ceilingDeduction,
} from './ceiling.ts';

export {
  KAPPA_PRESETS,
  DEFAULT_KAPPA,
  kappaForDifficulty,
  betaVariance,
  betaStdev,
  betaStdevInPoints,
  kappaFromMoments,
  betaParams,
  betaCdf,
  scoreToZ,
} from './beta.ts';
export type { DifficultyLabel, BetaParams } from './beta.ts';

export {
  RHO_LOW,
  RHO_HIGH,
  compositeZ,
  compositeZBoth,
  compositeDenominator,
  naiveCompositeZ,
  zRangeOf,
} from './composite.ts';
export type { ZComponent, CompositeResult } from './composite.ts';

export {
  resolveTier,
  resolveRank,
  resolveTauFloor,
  buildZComponents,
  zFromRank,
  TAU_FLOOR,
} from './tier.ts';
export type { RankInfo, TierContext, ZBuild, TauFloorOverride } from './tier.ts';

export { GRADE_ORDER, GPA_POINTS, DEFAULT_QUOTA, cutoffZ, slotsForA, gradeForZ } from './scale.ts';
export type { Quota } from './scale.ts';
