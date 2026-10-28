/**
 * lib/grade/ceiling.ts — 천장 밀집 요소 분리 (회의록 4-2(2))
 *
 * 출석·과제는 대부분이 만점이라 분포가 극단적으로 찌그러져 있다.
 * 여기에 z-score를 적용하면 만점을 못 받은 사람의 z가 −3처럼 튀어
 * 합성 전체를 망가뜨린다. 반영비율 20%짜리 출석에서 한 번 빠진 것이
 * 기말을 20점 망친 것처럼 계산되는 것이다.
 *
 * 대응: 천장 밀집 요소는 z 경로에서 "완전히" 제외하고,
 *       만점 대비 감점분을 환산점수에서 직접 차감만 한다.
 *       실제 성적 산출 방식(감점제)과도 더 가깝다.
 */

import type { Assessment, EngineWarning } from '@/lib/types';

/** 환산점수 척도. 모든 과목을 0~100으로 통일한다 */
export const CONVERTED_MAX = 100;

/** 평균이 만점의 이 비율 이상이면 천장효과로 본다 (회의록 4-3) */
export const CEILING_MEAN_RATIO = 0.8;

export interface Partitioned {
  /** z 경로에 들어가는 요소 (변별이 일어나는 곳) */
  variable: Assessment[];
  /** z 경로에서 빠지고 감점으로만 처리되는 요소 */
  ceiling: Assessment[];
}

export function partitionAssessments(assessments: Assessment[]): Partitioned {
  return {
    variable: assessments.filter((a) => !a.ceilingClustered),
    ceiling: assessments.filter((a) => a.ceilingClustered),
  };
}

/** 환산점수 기여분 = 반영비율 × (내점수/만점) × 100 */
export function convertedGain(a: Assessment): number {
  if (a.myScore === null || !(a.maxScore > 0)) return 0;
  return a.weight * (a.myScore / a.maxScore) * CONVERTED_MAX;
}

/** 환산점수 감점분 = 반영비율 × ((만점−내점수)/만점) × 100. 미응시는 0(아직 잃지 않음) */
export function convertedLoss(a: Assessment): number {
  if (a.myScore === null || !(a.maxScore > 0)) return 0;
  return a.weight * ((a.maxScore - a.myScore) / a.maxScore) * CONVERTED_MAX;
}

/** 아직 배점이 남아 있는 요소의 환산점수 */
export function convertedRemaining(a: Assessment): number {
  if (a.myScore !== null) return 0;
  return a.weight * CONVERTED_MAX;
}

/** 천장 밀집 요소들의 총 감점 (z경로에 넣지 않고 여기서만 처리) */
export function ceilingDeduction(assessments: Assessment[]): number {
  return partitionAssessments(assessments).ceiling.reduce((s, a) => s + convertedLoss(a), 0);
}

/**
 * 천장효과 자동 감지.
 *
 * ceilingClustered 플래그가 사용자 입력이라 빠질 수 있으므로, 평균이 만점의 80% 이상인
 * 요소를 별도로 잡아낸다. 플래그가 안 붙은 요소가 걸리면 그것이 더 중요한 신호다
 * (변별 요소인 줄 알았는데 실은 천장 밀집인 경우).
 *
 * 경고 문구는 "당신은 A0" 대신 "지금 1점의 가치가 매우 크다"로 간다.
 * 역설적으로 상위권에게 더 쓸모 있는 정보이고, 행동을 바꾸는 쪽은 이쪽이다.
 */
export function detectCeilingEffect(assessments: Assessment[]): EngineWarning[] {
  const hits = assessments.filter(
    (a) => a.mean !== null && a.maxScore > 0 && a.mean / a.maxScore >= CEILING_MEAN_RATIO,
  );
  if (hits.length === 0) return [];

  const unflagged = hits.filter((a) => !a.ceilingClustered);
  const names = hits.map((a) => a.name).join('·');
  const extra =
    unflagged.length > 0
      ? ` ${unflagged.map((a) => a.name).join('·')}은(는) 천장 밀집 요소로 표시돼 있지 않은데 평균이 만점에 가깝습니다.`
      : '';

  return [
    {
      code: 'CEILING_EFFECT',
      message: `${names}의 평균이 만점의 ${Math.round(CEILING_MEAN_RATIO * 100)}% 이상입니다. 등급을 단정하기보다 "1~2점 차이로 등급이 갈릴 수 있음"으로 읽으세요.${extra}`,
    },
  ];
}

/**
 * 천장 밀집 요소의 "반 평균 대비 내 편차" (환산점수).
 *
 * z경로에서 뺀다고 해서 영향이 0이 되는 건 아니다. 출석에서 2점을 잃으면
 * 총 환산점수가 반 평균보다 2점 낮아지고, 그만큼 등수가 밀린다.
 * 다만 이것은 **분포를 가진 확률변수가 아니라 결정론적 이동분**이다.
 * 그래서 z를 계산하지 않고(=만점 못 받은 사람의 z가 −3으로 튀는 문제를 피하고),
 * 환산점수 편차를 deltaZPerPoint로 환산해 합성 z를 평행이동만 시킨다.
 *
 * 평균을 모르면 "다들 만점"을 기준으로 삼는다 — 그것이 애초에 이 요소가
 * 천장 밀집으로 분류된 이유이므로, 여기서는 가정이 아니라 분류의 정의다.
 */
export function ceilingOffsetPoints(assessments: Assessment[]): number {
  let offset = 0;
  for (const a of partitionAssessments(assessments).ceiling) {
    if (a.myScore === null || !(a.maxScore > 0)) continue;
    const reference = a.mean ?? a.maxScore;
    offset += a.weight * ((a.myScore - reference) / a.maxScore) * CONVERTED_MAX;
  }
  return offset;
}
