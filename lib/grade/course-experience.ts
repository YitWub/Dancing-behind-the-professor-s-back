import { prepareAttendanceEstimate } from './attendance-estimate.ts';
import type { ManagedAssessment, ManagedCourse } from './management-types.ts';
import { validateGradingPolicy } from './grading-policy.ts';

export function validateCourseExperience(value: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if('gradingPolicy' in value)errors.push(...validateGradingPolicy(value.gradingPolicy));
  if('absoluteTargets' in value) {
    const cuts=value.absoluteTargets;
    if(!cuts||typeof cuts!=='object'||Array.isArray(cuts)) errors.push('절대평가 목표 기준 형식을 확인해 주세요.');
    else {
      const order=['A+','A0','B+','B0'];let previous=Infinity;
      for(const [key,n] of Object.entries(cuts))if(!order.includes(key)||typeof n!=='number'||!Number.isFinite(n)||n<0||n>100)errors.push('목표 등급 기준은 0~100점 환산점수로 입력해 주세요.');
      for(const key of order){const n=(cuts as Record<string,number>)[key];if(n!==undefined){if(n>previous)errors.push('높은 등급의 기준점수는 낮은 등급보다 작을 수 없습니다.');previous=n;}}
    }
  }
  if ('semester' in value && (typeof value.semester !== 'string' || !/^\d{4}-(1|2|S|W)$/.test(value.semester))) errors.push('학기는 2026-2 형식으로 입력해 주세요.');
  if ('attendancePreferences' in value) {
    const p = value.attendancePreferences;
    if (!p || typeof p !== 'object' || !['checked', 'scored', 'eligibility'].every((k) => ['yes', 'no', 'unknown'].includes((p as Record<string, string>)[k]))) errors.push('출석 유형을 예 / 아니요 / 모름 중에서 선택해 주세요.');
  }
  if ('attendanceNotes' in value) {
    const n = value.attendanceNotes;
    if (!n || typeof n !== 'object' || !['absences', 'lateness', 'excused'].every((k) => Number.isSafeInteger((n as Record<string, number>)[k]) && (n as Record<string, number>)[k] >= 0)) errors.push('출결 기록은 0 이상의 정수로 입력해 주세요.');
  }
  return errors;
}

export function assessmentSummary(a: ManagedAssessment, course: ManagedCourse): string {
  const e=course.attendanceEstimate??prepareAttendanceEstimate(course).value;
  if(a.id===e.assessmentId)return `결석 ${e.absences}회 · 지각 ${e.lateness}회 · 기록 반영`;
  if (a.assignmentGroup) {
    const tasks = a.assignmentGroup.tasks;
    const done = tasks.filter((t) => t.progress.status === 'graded' || t.progress.status === 'zero_confirmed').length;
    return `${tasks.length}개 중 ${done}개 확정`;
  }
  const p = a.progress;
  if (!p) return '진행 상태 검토 필요';
  if (p.status === 'graded') return `${p.score}/${a.maxScore}점 확정`;
  if (p.status === 'zero_confirmed') return p.reason === 'absent' ? '미응시 · 0점 확정' : '미제출 · 0점 확정';
  return p.status === 'scheduled' ? '아직 미진행' : '채점 대기';
}
