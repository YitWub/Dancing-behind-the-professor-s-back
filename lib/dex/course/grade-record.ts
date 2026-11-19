export const GRADING_METHODS = { unknown: '미확인', relative: '상대평가', absolute: '절대평가', passFail: 'Pass / Fail' } as const;
export const SCORE_STATES = { planned: '평가 예정', pending: '채점 대기', graded: '점수 확정', missed: '미응시·미제출 (0점 확정)' } as const;
export const ASSESSMENT_NAMES = ['중간고사', '기말고사', '과제', '출석', '퀴즈', '팀 프로젝트', '발표', '기타'];

export type AssessmentScore =
  | { status: 'planned' | 'pending' | 'missed' }
  | { status: 'graded'; score: number };

export interface CourseAssessment {
  id: string;
  name: string;
  weightPercent: number;
  maxScore: number;
  result: AssessmentScore;
}

export interface CourseGradeRecord {
  method: keyof typeof GRADING_METHODS;
  assessments: CourseAssessment[];
}

export function weightBasisPoints(percent: number) {
  return Math.round(percent * 100);
}

export function assessmentWeight(assessments: readonly Pick<CourseAssessment, 'weightPercent'>[]) {
  return assessments.reduce((total, item) => total + weightBasisPoints(item.weightPercent), 0) / 100;
}

export function confirmedScore(result: AssessmentScore): number | undefined {
  if (result.status === 'graded') return result.score;
  if (result.status === 'missed') return 0;
}
