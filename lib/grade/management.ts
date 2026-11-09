import type { Course } from '../types.ts';
import { validateCourse, validateCourses } from './course-validation.ts';
import type { AssessmentProgress, ManagedAssessment, ManagedCourse, ManagementResult } from './management-types.ts';
import { validateProgress } from './assessment-progress.ts';
import { assignmentAggregateScore, validateAssignmentGroup } from './assignments.ts';
import { computeAttendance, validateAttendanceManagement } from './attendance.ts';
import { validateCourseExperience } from './course-experience.ts';
import { validateSimpleAttendance } from './simple-attendance.ts';
import { validateAttendanceEstimate, confirmedAttendanceBalance } from './attendance-estimate.ts';

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Reuse v1 structural validation without changing any v1 public contracts. */
export function validateManagedCourse(value: unknown): string[] {
  if (!record(value)) return ['관리 과목 데이터 형식이 올바르지 않습니다.'];
  const errors: string[] = validateCourseExperience(value);
  if ('attendanceEstimate' in value) errors.push(...validateAttendanceEstimate(value as ManagedCourse));
  if (!('attendanceEstimate' in value) && 'simpleAttendance' in value) {
    if (!value.simpleAttendance || typeof value.simpleAttendance !== 'object' || !Array.isArray(value.assessments)) errors.push('간편 출석 형식이 올바르지 않습니다.');
    else errors.push(...validateSimpleAttendance(value as ManagedCourse));
  }
  if (!('attendanceEstimate' in value) && 'attendanceManagement' in value) errors.push(...validateAttendanceManagement(value.attendanceManagement, value.assessments));
  const assessments = Array.isArray(value.assessments) ? value.assessments.map((a, index) => {
    if (!record(a)) return a;
    const prefix = `평가항목 ${index + 1}: `;
    if ('myScore' in a) errors.push(prefix + 'v2의 실제 점수는 progress에서만 관리합니다.');
    if ('assignmentGroup' in a) errors.push(...validateAssignmentGroup(a.assignmentGroup).map((error) => prefix + error));
    if (a.progress === null) {
      if (a.reviewRequired !== 'legacy_null_score') errors.push(prefix + '미분류 상태에는 기존 점수 확인 사유가 필요합니다.');
    } else {
      errors.push(...validateProgress(a.progress, a.maxScore).map((error) => prefix + error));
      if ('reviewRequired' in a) errors.push(prefix + '진행 상태가 정해진 항목에는 마이그레이션 확인 표시를 남길 수 없습니다.');
    }
    const p = a.progress;
    return { ...a, myScore: record(p) && p.status === 'graded' ? p.score : record(p) && p.status === 'zero_confirmed' ? 0 : null };
  }) : value.assessments;
  return [...errors, ...validateCourse({ ...value, assessments })];
}

export function validateManagedCourses(value: unknown): string[] {
  if (!Array.isArray(value)) return ['관리 과목 목록 형식이 올바르지 않습니다.'];
  const errors = value.flatMap((course, index) => validateManagedCourse(course).map((error) => `과목 ${index + 1}: ${error}`));
  const ids = new Set<string>();
  for (const course of value) {
    if (record(course) && typeof course.id === 'string') {
      if (ids.has(course.id)) errors.push('관리 과목 ID가 중복됩니다.');
      ids.add(course.id);
    }
  }
  return errors;
}

/** Pure and deterministic. Never split assignments or guess the meaning of a null score. */
export function migrateV1Courses(value: unknown): ManagementResult<ManagedCourse[]> {
  const errors = validateCourses(value);
  if (errors.length) return { ok: false, errors };
  const courses = (value as Course[]).map((course): ManagedCourse => ({
    ...course,
    attendance: course.attendance ? { ...course.attendance } : null,
    assessments: course.assessments.map(({ myScore, ...assessment }): ManagedAssessment => myScore === null
      ? { ...assessment, progress: null, reviewRequired: 'legacy_null_score' }
      : { ...assessment, progress: { status: 'graded', score: myScore } }),
  }));
  return { ok: true, value: courses };
}

/** Explicit correction is allowed in either direction; no score survives in a pending state. */
export function transitionAssessment(
  assessment: ManagedAssessment, progress: AssessmentProgress,
): ManagementResult<ManagedAssessment> {
  if (assessment.assignmentGroup) return { ok: false, errors: ['과제 그룹은 개별 과제의 진행 상태를 변경해 주세요. 보관된 단일 점수는 덮어쓰지 않습니다.'] };
  const errors = validateProgress(progress, assessment.maxScore);
  if (errors.length) return { ok: false, errors };
  // Whitelist fields: remove the legacy review marker and any previous score/reason.
  return { ok: true, value: {
    id: assessment.id, name: assessment.name, weight: assessment.weight, maxScore: assessment.maxScore,
    mean: assessment.mean, stdev: assessment.stdev, ceilingClustered: assessment.ceilingClustered,
    progress: { ...progress },
  } };
}

/** Compatibility adapter only: does not predict, fill missing scores, or change the model.
 * The legacy engine treats both scheduled and awaiting_grade as unobserved. Its remaining
 * field combines these categories and must NOT be used as the new four-area balance.
 */
export function toEngineCourse(course: ManagedCourse): ManagementResult<Course> {
  const errors = validateManagedCourse(course);
  if (errors.length) return { ok: false, errors };
  const attendanceId=course.attendanceEstimate ? course.attendanceEstimate.assessmentId : course.simpleAttendance?.assessmentId ?? course.attendanceManagement?.assessmentId;
  if (course.assessments.some((a) => a.id !== attendanceId && !a.assignmentGroup && a.progress === null)) {
    return { ok: false, errors: ['기존 평가항목의 진행 상태를 확인한 뒤 엔진에 연결해 주세요.'] };
  }
  const aggregateScores = new Map<string, number>();
  if (course.attendanceEstimate) {
    if((course.attendanceEstimate.confirmed?.finalDeduction??0)>0)return {ok:false,errors:['이전 확정 최종 감점은 따로 보관합니다. 기존 확률모델에 임의로 합성하지 않습니다.']};
    const b=confirmedAttendanceBalance(course);
    const linked=course.assessments.find((a)=>a.id===attendanceId);
    if(linked&&linked.weight>0) {
      if(b.remaining>1e-8||b.ungraded>1e-8||(course.attendanceEstimate.confirmed?.finalDeduction??0)>0)return {ok:false,errors:['출석 카드는 간이 추정입니다. 확정 출석 점수가 없어 실제 성적의 등급 확률은 보류합니다.']};
      aggregateScores.set(linked.id,linked.maxScore*b.secured/(linked.weight*100));
    }
  } else if (course.simpleAttendance) {
    const result=computeAttendance(course); if(!result.ok)return result;
    if (result.value.eligibility.status==='failed') return {ok:false,errors:['설정한 출석 미달 기준에 해당해 예측을 보류합니다.']};
    if(course.simpleAttendance.mode==='scored') {
      if(!course.simpleAttendance.finalized||!result.value.score.known||(result.value.score.finalDeduction??0)>0) return {ok:false,errors:['잠정 출석 점수는 최종 확보 점수가 아닙니다. 등급 예측은 학기 종료 점수 확정 후 제공합니다.']};
      const linked=course.assessments.find((a)=>a.id===attendanceId)!;
      aggregateScores.set(linked.id,linked.maxScore*(result.value.score.finalRawScore!/course.simpleAttendance.rawMaxScore));
    }
  } else if (course.attendanceManagement) {
    const attendance = computeAttendance(course);
    if (!attendance.ok) return attendance;
    const { score, eligibility } = attendance.value;
    if (eligibility.status === 'needs_review' || eligibility.status === 'failed') return { ok: false, errors: eligibility.messages };
    if (!score.known || !score.complete || course.attendanceManagement.records.held !== course.attendanceManagement.records.total) return { ok: false, errors: ['출석 규칙 또는 학기 종료 점수가 아직 확정되지 않아 등급 예측을 보류합니다. 남은 출석을 만점으로 채우지 않습니다.'] };
    if ((score.finalDeduction ?? 0) > 0) return { ok: false, errors: ['별도 최종 성적 감점은 실제 성적 현황에서 따로 표시합니다. 기존 확률모델에 임의 합성하지 않고 예측을 보류합니다.'] };
    if (course.attendanceManagement.assessmentId !== null) {
      const linked = course.assessments.find((a) => a.id === course.attendanceManagement!.assessmentId)!;
      aggregateScores.set(linked.id, linked.maxScore * (score.finalRawScore! / (course.attendanceManagement.rawMaxScore ?? linked.maxScore)));
    }
  }
  for (const assessment of course.assessments) {
    if (!assessment.assignmentGroup) continue;
    const aggregate = assignmentAggregateScore(assessment);
    if (!aggregate.ok) return aggregate;
    aggregateScores.set(assessment.id, aggregate.value);
  }
  return { ok: true, value: {
    ...course,
    attendance: course.attendanceEstimate || course.simpleAttendance || course.attendanceManagement ? null : course.attendance ? { ...course.attendance } : null,
    assessments: course.assessments.map((a) => ({
      id: a.id, name: a.name, weight: a.weight, maxScore: a.maxScore,
      mean: a.mean, stdev: a.stdev, ceilingClustered: a.id === attendanceId ? true : a.ceilingClustered,
      myScore: course.attendanceEstimate && a.id===attendanceId ? aggregateScores.get(a.id)??null : course.simpleAttendance && a.id===attendanceId && course.simpleAttendance.mode!=='scored' ? null : a.assignmentGroup || a.id === attendanceId ? aggregateScores.get(a.id)!
        : a.progress?.status === 'graded' ? a.progress.score : a.progress?.status === 'zero_confirmed' ? 0 : null,
    })),
  } };
}
