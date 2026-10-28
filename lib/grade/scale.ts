/**
 * lib/grade/scale.ts — 상대평가 정원 모형과 등급 척도
 *
 * 상대평가에서 등급은 "몇 점"이 아니라 "몇 등"으로 결정된다. 따라서 합성 z를
 * 등급으로 바꾸려면 정원 비율이 필요하다.
 *
 * ★이 비율은 가정이다.★ 학교·학과·교수마다 다르고 공개된 단일 기준이 없다.
 * 회의록의 예시("40명 중 A 정원 12명" = 30%)에 맞춘 기본값을 쓰되,
 * 과목별로 바꿀 수 있게 열어 두고 UI에서 "가정"임을 밝힐 것.
 */

import type { GradeLetter } from '@/lib/types';
import { normalQuantile } from './math.ts';

/** 좋은 등급부터. lib/backtest/metrics.ts 의 GRADE_ORDER 와 같은 순서여야 한다 */
export const GRADE_ORDER: GradeLetter[] = ['A+', 'A0', 'B+', 'B0', 'C+', 'C0', 'D+', 'D0', 'F'];

/**
 * 상위 누적 정원 비율. "이 등급 이상"에 배정되는 인원의 비율.
 * A 30% / B 40% / C 20% / D 10% 를 +·0 으로 반씩 나눈 값이다.
 * F는 상대평가 정원이 아니라 출석 미달·미응시로 발생하므로 별도 처리한다.
 */
export const DEFAULT_QUOTA: Record<GradeLetter, number> = {
  'A+': 0.15,
  'A0': 0.3,
  'B+': 0.5,
  'B0': 0.7,
  'C+': 0.8,
  'C0': 0.9,
  'D+': 0.95,
  'D0': 1.0,
  F: 1.0,
};

export type Quota = Record<GradeLetter, number>;

/** 등급 g를 받으려면 넘어야 하는 표준화 합성점수. 상위 q%의 경계 = Φ⁻¹(1−q) */
export function cutoffZ(grade: GradeLetter, quota: Quota = DEFAULT_QUOTA): number {
  const q = quota[grade];
  if (q >= 1) return -Infinity;
  return normalQuantile(1 - q);
}

/** 평점 환산 (4.5 만점) */
export const GPA_POINTS: Record<GradeLetter, number> = {
  'A+': 4.5,
  'A0': 4.0,
  'B+': 3.5,
  'B0': 3.0,
  'C+': 2.5,
  'C0': 2.0,
  'D+': 1.5,
  'D0': 1.0,
  F: 0,
};

/** z에 대응하는 등급 (점 추정 — 내부 계산용. 이 값을 그대로 화면에 내보내지 말 것) */
export function gradeForZ(z: number, quota: Quota = DEFAULT_QUOTA): GradeLetter {
  for (const g of GRADE_ORDER) {
    if (z >= cutoffZ(g, quota)) return g;
  }
  return 'F';
}

/** A 정원(=A+ 와 A0 합) 인원수 */
export function slotsForA(classSize: number, quota: Quota = DEFAULT_QUOTA): number {
  return Math.round(classSize * quota['A0']);
}
