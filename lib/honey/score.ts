/**
 * lib/honey/score.ts — 꿀강 지수 0~100 (베이지안 축소)
 *
 * ★강의평 4건짜리 강의가 87.3점으로 1위에 뜨면 앱 전체의 신뢰가 무너진다.
 *  그래서 원점수를 그대로 쓰지 않고, 신뢰도로 가중된 유효표본 n_eff 를 써서
 *  중앙값 50 쪽으로 끌어당긴다(shrinkage).
 *
 *      honeyScore = (n_eff · rawScore + k · 50) / (n_eff + k)
 *      n_eff      = reviewCount × reliability.score
 *
 *  k 는 "원점수와 중앙값을 반반 믿는 지점"이다. k=12 의 근거는 README 참고.
 */

import type { HoneyAxes, ReliabilityVerdict } from '../types.ts';
import { AXIS_KEYS, type AxisKey } from './axes.ts';

/** 축소 계수. 클수록 보수적(더 50에 붙음). */
export const SHRINKAGE_K = 12;

/** 중앙값 — "평범한 강의". 정보가 없으면 여기로 수렴한다. */
export const NEUTRAL_SCORE = 50;

/**
 * 축 가중치. "학점 잘 주면서 꿀강" 이 목표이므로 학점 후함이 가장 무겁다.
 * 합은 1.0.
 */
export const AXIS_WEIGHTS: Record<AxisKey, number> = {
  gradeGenerosity: 0.35,
  workload: 0.2,
  attendanceStrictness: 0.15,
  teachingQuality: 0.2,
  examDifficulty: 0.1,
};

/** 값이 클수록 꿀인 축인지 (axes.ts 와 동일 정의를 점수용으로 다시 표기) */
const SWEETER_WHEN_HIGH: Record<AxisKey, boolean> = {
  gradeGenerosity: true,
  workload: false,
  attendanceStrictness: false,
  teachingQuality: true,
  examDifficulty: false,
};

/** 축만 보고 계산한 원점수 0~100. 축소 전 값이라 그대로 화면에 쓰면 안 된다. */
export function rawHoneyScore(axes: HoneyAxes): number {
  let acc = 0;
  for (const key of AXIS_KEYS) {
    const v = axes[key];
    const sweet = SWEETER_WHEN_HIGH[key] ? v : 1 - v;
    acc += AXIS_WEIGHTS[key] * sweet;
  }
  return acc * 100;
}

export interface ShrinkResult {
  /** 화면에 내보낼 값 (정수). 강의평이 0건이면 null. */
  honeyScore: number | null;
  /** 축소 전 원점수 — 디버깅/README 용, UI 에 단독 노출 금지 */
  rawScore: number | null;
  /** 유효 표본 수 */
  effectiveN: number;
  /** 원점수에서 중앙값 쪽으로 얼마나 당겨졌는지 (0~1, 1이면 완전히 50) */
  shrinkAmount: number;
}

/**
 * 베이지안 축소.
 *
 * 예) 강의평 4건 · 신뢰도 0.45 · 원점수 87
 *     n_eff = 1.8 → (1.8×87 + 12×50) / 13.8 ≈ 54.8
 *     "87.3점 1위"가 "54.8점 · 표본 부족" 으로 정직해진다.
 */
export function shrinkToNeutral(
  axes: HoneyAxes | null,
  reviewCount: number,
  reliability: ReliabilityVerdict,
  k: number = SHRINKAGE_K,
): ShrinkResult {
  if (axes === null || reviewCount === 0) {
    return { honeyScore: null, rawScore: null, effectiveN: 0, shrinkAmount: 1 };
  }
  const raw = rawHoneyScore(axes);
  const effectiveN = reviewCount * reliability.score;
  const score = (effectiveN * raw + k * NEUTRAL_SCORE) / (effectiveN + k);
  return {
    honeyScore: Math.round(score),
    rawScore: Math.round(raw * 10) / 10,
    effectiveN: Math.round(effectiveN * 100) / 100,
    shrinkAmount: Math.round((k / (effectiveN + k)) * 100) / 100,
  };
}

/**
 * 정렬 키. honeyScore 가 같으면 신뢰도가 높은 쪽을 위로.
 * null(강의평 없음)은 항상 맨 아래 — "모르는 강의"를 1위로 올리지 않는다.
 */
export function honeySortKey(honeyScore: number | null, reliabilityScore: number): number {
  if (honeyScore === null) return -1;
  return honeyScore + reliabilityScore * 0.001;
}

/** 점수를 언어로. 정직성 규칙 1(점 추정 금지)에 맞춰 UI 는 숫자 옆에 이 문구를 함께 쓴다. */
export function honeyBandLabel(honeyScore: number | null, shrinkAmount: number): string {
  if (honeyScore === null) return '판단 불가 — 강의평 없음';
  if (shrinkAmount >= 0.6) return '표본이 적어 평균 쪽으로 크게 보정됨';
  if (honeyScore >= 70) return '꿀강에 가깝습니다';
  if (honeyScore >= 55) return '무난한 편입니다';
  if (honeyScore >= 45) return '평범합니다';
  return '꿀강은 아닙니다';
}
