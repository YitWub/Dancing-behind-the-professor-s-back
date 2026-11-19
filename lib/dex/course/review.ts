export const DIFFICULTIES = ['매우 쉬움', '쉬움', '보통', '어려움', '매우 어려움'] as const;
export const WORKLOADS = { light: '적음', moderate: '보통', heavy: '많음' } as const;
export const REVIEW_TAGS = ['실습 중심', '이론 중심', '발표 많음', '시험 중심', '과제 많음', '토론 중심', '프로젝트 중심'] as const;

export interface CourseReview {
  shortReview?: string;
  difficulty?: 1 | 2 | 3 | 4 | 5;
  workload?: keyof typeof WORKLOADS;
  teamProject?: boolean;
  tags?: (typeof REVIEW_TAGS)[number][];
}

export function completedCourse(status: string) {
  return status === 'completed';
}
