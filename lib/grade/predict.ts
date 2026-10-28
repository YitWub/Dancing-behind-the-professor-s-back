/**
 * lib/grade/predict.ts — 예측 본체
 *
 * 앞의 모듈들을 조립한다:
 *   ceiling  → 천장 밀집 요소를 z경로에서 제거
 *   beta     → 요소별 점수를 백분위로, 백분위를 z로
 *   composite→ 가중합을 올바른 분모로 표준화하고 ρ 구간을 낸다
 *   scale    → 정원 비율로 z를 등급 누적확률로
 *   tier     → 정보가 모자라면 출력의 종류 자체를 낮춘다
 *
 * 출력 규칙(회의록 4-3): 누적확률로만 낸다. "A0 55%"가 아니라 "A0 이상일 확률 70%".
 * 사람은 최빈값 하나만 읽고 "나 A0구나"로 축약하는 경향이 있기 때문이다.
 */

import type {
  Confidence,
  Course,
  CumulativeGradeProb,
  EngineWarning,
  GradeLetter,
  GradePrediction,
} from '@/lib/types';
import { computeBalance, isAttendanceFailure, type BalanceDetail } from './balance.ts';
import { ceilingOffsetPoints, detectCeilingEffect } from './ceiling.ts';
import { compositeZBoth, deltaZPerPoint, zRangeOf, type CompositeResult } from './composite.ts';
import { normalCdf } from './math.ts';
import { DEFAULT_QUOTA, GRADE_ORDER, cutoffZ, slotsForA, type Quota } from './scale.ts';
import {
  buildZComponents,
  resolveRank,
  resolveTauFloor,
  resolveTier,
  zFromRank,
  type RankInfo,
  type TauFloorOverride,
} from './tier.ts';

/** 수강인원이 이 이하면 예측하지 않는다 (회의록 4-3) */
export const SMALL_CLASS_THRESHOLD = 20;

export interface PredictOptions {
  /**
   * 등수 외부 주입 (Tier 4). 보통은 Course.myRank + Course.enrolled 로 자동 판정되므로
   * 비워 두면 된다. 백테스트가 BacktestCase.actualRank 를 주입할 때 쓰는 경로다.
   * 지정하면 Course.myRank 보다 우선한다.
   */
  rank?: RankInfo | null;
  /** 과목별 정원 비율을 아는 경우 교체 */
  quota?: Quota;
  /**
   * τ 하한 오버라이드 (민감도 측정용).
   * 이 상수는 근거가 없어서 고정해 두었고, 대신 백테스트가 값을 훑으며
   * "결과가 얼마나 흔들리는가"를 재도록 열어 둔 구멍이다. 평상시에는 지정하지 않는다.
   */
  tauFloor?: TauFloorOverride;
}

/** 예측 내부 상태 — whatif / allocation 이 재사용한다 */
export interface PredictionInternals {
  prediction: GradePrediction;
  balance: BalanceDetail;
  /** ρ=0.3 / ρ=0.8 두 합성 결과. 격하된 경우 null */
  composites: [CompositeResult, CompositeResult] | null;
  /** 두 ρ의 중앙 z. 격하된 경우 null */
  zMid: number | null;
  quota: Quota;
  /** 이번 예측에 실제로 적용된 τ 하한. 배분 대시보드가 같은 값으로 재계산하기 위해 노출한다 */
  tauFloor: number;
}

export function predict(course: Course, opts: PredictOptions = {}): GradePrediction {
  return predictInternal(course, opts).prediction;
}

export function predictInternal(course: Course, opts: PredictOptions = {}): PredictionInternals {
  const quota = opts.quota ?? DEFAULT_QUOTA;
  const balance = computeBalance(course);
  const warnings: EngineWarning[] = [...balance.warnings, ...detectCeilingEffect(course.assessments)];

  const rank = resolveRank(course, opts.rank);
  const tierCtx = resolveTier(course, rank);
  warnings.push(...tierCtx.warnings);
  const tauFloor = resolveTauFloor(tierCtx.tier, opts.tauFloor);

  // ── 예측 자체를 하면 안 되는 케이스 ───────────────────────────────────────
  const blockers: EngineWarning[] = [];
  if (course.isAbsolute) {
    blockers.push({
      code: 'ABSOLUTE_GRADING',
      message: '절대평가 과목입니다. 등수와 무관하게 절대점수로 등급이 정해지므로 상대 예측을 하지 않고 환산점수만 보여줍니다.',
    });
  }
  if (course.enrolled !== null && course.enrolled <= SMALL_CLASS_THRESHOLD) {
    blockers.push({
      code: 'SMALL_CLASS',
      message: `수강인원 ${course.enrolled}명 — ${SMALL_CLASS_THRESHOLD}명 이하에서는 분포 가정이 성립하지 않습니다. 참고용 환산점수만 보여줍니다.`,
    });
  }
  if (isAttendanceFailure(course)) {
    blockers.push({
      code: 'ATTENDANCE_RISK',
      message: '결석 한도를 넘어 F 처리 대상일 수 있습니다. 이 상태에서 등급 확률을 내는 것은 의미가 없습니다.',
    });
  }

  if (blockers.length > 0 || tierCtx.tier <= 1) {
    return {
      prediction: degraded(course, tierCtx.tier, balance, [...warnings, ...blockers]),
      balance,
      composites: null,
      zMid: null,
      quota,
      tauFloor,
    };
  }

  // ── 정석 경로 ─────────────────────────────────────────────────────────────
  const { components, betaFallbacks, effectiveWeightTotal } = buildZComponents(course);
  if (betaFallbacks.length > 0) {
    warnings.push({
      code: 'LOW_TIER',
      message: `${betaFallbacks.join('·')}의 (평균, 표준편차) 조합이 베타분포로는 U자형이라 정규 근사로 계산했습니다. 입력을 다시 확인해 보세요.`,
    });
  }

  let composites: [CompositeResult, CompositeResult];
  if (tierCtx.tier === 4 && rank) {
    // 등수를 알면 합성이 필요 없다. 다만 아직 안 본 시험이 있으면 그만큼은 여전히 모른다.
    const unobserved = components.filter((c) => c.z === null).reduce((s, c) => s + c.weight, 0);
    const z = zFromRank(rank);
    const tau = Math.hypot(tauFloor, unobserved);
    const base: CompositeResult = {
      rho: 0,
      zStd: z,
      tau,
      denominator: 1,
      unobservedWeight: unobserved,
    };
    composites = [base, base];
    if (unobserved > 0) {
      warnings.push({
        code: 'LOW_TIER',
        message: '등수는 지금까지의 성적 기준입니다. 남은 평가가 있어 최종 등수는 바뀔 수 있습니다.',
      });
    }
  } else {
    composites = compositeZBoth(components);
  }

  // 천장 밀집 요소의 감점을 여기서 되돌려 넣는다.
  // z를 계산하지는 않지만(회의록 4-2(2)), 환산점수 편차만큼은 등수를 실제로 밀어낸다.
  // 이 평행이동이 없으면 "결석해도 예상 등급이 꿈쩍도 안 하는" 엔진이 되어
  // "오늘 이 수업 째도 되나"라는 앱의 질문 자체에 답하지 못한다.
  const offsetPoints =
    ceilingOffsetPoints(course.assessments) -
    (balance.attendance?.applied ? balance.attendance.ledgerLoss : 0);
  if (offsetPoints !== 0) {
    composites = composites.map((c) => ({
      ...c,
      zStd: c.zStd + offsetPoints * deltaZPerPoint(effectiveWeightTotal, c.denominator),
    })) as [CompositeResult, CompositeResult];
  }

  const distribution = buildDistribution(composites, tauFloor, quota);
  const zRange = zRangeOf(composites);
  const zMid = (composites[0].zStd + composites[1].zStd) / 2;

  const borderline = findBorderline(distribution);
  if (borderline) {
    warnings.push({
      code: 'BORDERLINE',
      message: `${borderline} 경계선입니다 — 이 예측은 사실상 동전던지기입니다. 지금 1~2점의 가치가 매우 큽니다.`,
    });
  }

  const headcount =
    course.enrolled !== null && course.enrolled > 0
      ? {
          classSize: course.enrolled,
          slotsForA: slotsForA(course.enrolled, quota),
          estimatedAbove: Math.round(course.enrolled * (1 - normalCdf(zMid))),
        }
      : null;

  return {
    prediction: {
      courseId: course.id,
      tier: tierCtx.tier,
      balance: toBalance(balance),
      distribution,
      zRange,
      headcount,
      confidence: gradeConfidence(tierCtx.tier, zRange, composites, tauFloor, borderline !== null, course),
      warnings,
    },
    balance,
    composites,
    zMid,
    quota,
    tauFloor,
  };
}

/** 격하 출력 — 등급을 단정하지 않는다. distribution=null 이 blur의 실체다 */
function degraded(
  course: Course,
  tier: GradePrediction['tier'],
  balance: BalanceDetail,
  warnings: EngineWarning[],
): GradePrediction {
  return {
    courseId: course.id,
    tier,
    balance: toBalance(balance),
    distribution: null,
    zRange: null,
    headcount: null,
    confidence: 'low',
    warnings,
  };
}

function toBalance(b: BalanceDetail) {
  return { secured: b.secured, lost: b.lost, remaining: b.remaining };
}

/**
 * 누적 등급 확률.
 *
 * 최종 표준화 성적을 z ~ N(ẑ, τ²) 로 본다. τ는 ①아직 안 본 시험(composite.tau)과
 * ②모형 자체의 오차(TAU_FLOOR)를 합친 값이다.
 * ρ에 대한 무지는 숨기지 않고 ρ=0.3 / ρ=0.8 두 분포의 **균등 혼합**으로 반영한다.
 * 특정 ρ 하나를 고르면 그 선택 자체가 false precision이 된다.
 */
export function buildDistribution(
  composites: CompositeResult[],
  tauFloor: number,
  quota: Quota,
): CumulativeGradeProb[] {
  const parts = composites.map((c) => ({ z: c.zStd, tau: Math.hypot(c.tau, tauFloor) }));

  let prev = 0;
  return GRADE_ORDER.map((grade) => {
    const cut = cutoffZ(grade, quota);
    let p =
      cut === -Infinity
        ? 1
        : parts.reduce((s, part) => s + normalCdf((part.z - cut) / Math.max(part.tau, 1e-9)), 0) /
          parts.length;
    // 누적확률은 등급이 낮아질수록 단조증가해야 한다 (부동소수 보정)
    p = Math.min(1, Math.max(prev, p));
    prev = p;
    return { grade, atLeastProb: p };
  });
}

/**
 * 경계선 판정 — "모델 한계의 고백 장치"(회의록 4-3).
 * 어떤 등급의 "이상일 확률"이 0.35~0.65 사이면 그 등급에서 동전던지기다.
 */
export function findBorderline(dist: CumulativeGradeProb[]): GradeLetter | null {
  let best: GradeLetter | null = null;
  let bestGap = Infinity;
  for (const d of dist) {
    if (d.atLeastProb >= 0.35 && d.atLeastProb <= 0.65) {
      const gap = Math.abs(d.atLeastProb - 0.5);
      if (gap < bestGap) {
        bestGap = gap;
        best = d.grade;
      }
    }
  }
  return best;
}

function gradeConfidence(
  tier: number,
  zRange: { low: number; high: number },
  composites: CompositeResult[],
  tauFloor: number,
  borderline: boolean,
  course: Course,
): Confidence {
  const rhoWidth = Math.abs(zRange.high - zRange.low);
  const tau = Math.max(...composites.map((c) => Math.hypot(c.tau, tauFloor)));

  if (tier === 4 && tau < 0.2) return 'high';
  if (rhoWidth > 0.6 || tau > 0.5 || course.enrolled === null) return 'low';
  if (borderline || rhoWidth > 0.3 || tau > 0.3) return 'medium';
  return 'high';
}

/**
 * 화면용 확률 뭉개기. 정직성 규칙 1: 점 추정 금지, 5~10% 단위.
 * 엔진 내부와 백테스트는 원값을 쓰고, 표시 직전에만 이 함수를 통과시킨다.
 */
export function blurProb(p: number, step = 0.05): number {
  return Math.round(p / step) * step;
}
