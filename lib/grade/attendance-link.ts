import type { ManagedAssessment, ManagedCourse, ManagementResult } from './management-types.ts';

type Estimate = NonNullable<ManagedCourse['attendanceEstimate']>;
type LinkItem = { id: string; name: string; weight: number; assignmentGroup?: unknown; progress?: { status: string } | null };
const exactAttendanceName = (name: string) => /^(출석|출결|attendance)$/i.test(name.normalize('NFKC').trim());

/** Stored IDs win over names. Only a never-selected null may use a single exact name. */
export function resolveAttendanceAssessmentId(items: LinkItem[], estimate?: Pick<Estimate, 'assessmentId' | 'selection' | 'confirmed'>): string | null {
  if (estimate?.assessmentId) return items.some((a) => a.id === estimate.assessmentId && !a.assignmentGroup) ? estimate.assessmentId : null;
  if (estimate?.selection === 'manual') return null;
  if (estimate?.confirmed && (estimate.confirmed.secured > 0 || estimate.confirmed.lost > 0 || estimate.confirmed.ungraded > 0 || (estimate.confirmed.finalDeduction ?? 0) > 0)) return null;
  const candidates = items.filter((a) => !a.assignmentGroup && a.weight > 0 && exactAttendanceName(a.name));
  if (candidates.length !== 1) return null;
  // Never silently reinterpret a newly renamed exam with an existing result.
  if (estimate && candidates[0].progress?.status !== 'scheduled') return null;
  return candidates[0].id;
}

export function reconcileAttendanceLink(items: LinkItem[], estimate: Estimate): Estimate {
  const assessmentId = resolveAttendanceAssessmentId(items, estimate);
  return { ...estimate, assessmentId, ...(assessmentId !== estimate.assessmentId ? { confirmed: undefined } : {}) };
}

export function attendanceLinkOptions(items: ManagedAssessment[], currentId: string | null) {
  return items.map((a) => ({
    id: a.id, name: a.name, weight: a.weight,
    reason: !Number.isFinite(a.weight) || a.weight <= 0 ? '0% 또는 비율 확인 필요' : a.assignmentGroup ? '세부 과제 기록 있음' : a.id !== currentId && a.progress?.status !== 'scheduled' ? '기존 점수·진행 기록 있음' : '',
  }));
}

/** Restore a representable historical result before its item stops being attendance.
 * Partial ledgers and external penalties cannot safely become a single exam score.
 */
function detachConfirmedRecord(course: ManagedCourse): ManagementResult<ManagedAssessment[]> {
  const e = course.attendanceEstimate, c = e?.confirmed;
  if (!c || (c.secured === 0 && c.lost === 0 && c.ungraded === 0 && !c.finalDeduction)) return { ok: true, value: course.assessments };
  const old = course.assessments.find((a) => a.id === e?.assessmentId);
  const blocked = { ok: false as const, errors: ['이전 확정 출석 기록을 보존하기 위해 연결 변경을 제한합니다.'] };
  if (!old || old.assignmentGroup || !Number.isFinite(old.maxScore) || old.maxScore <= 0 || c.weight <= 0 || (c.finalDeduction ?? 0) > 0) return blocked;
  let progress: ManagedAssessment['progress'];
  if (c.ungraded === 0 && Math.abs(c.secured + c.lost - c.weight) < 1e-8) {
    const score = old.maxScore * c.secured / c.weight;
    if (old.progress?.status === 'graded') return Math.abs(old.progress.score - score) < 1e-8 ? { ok: true, value: course.assessments } : blocked;
    if (old.progress?.status === 'zero_confirmed') return score === 0 ? { ok: true, value: course.assessments } : blocked;
    if (old.progress?.status === 'awaiting_grade') return blocked;
    progress = { status: 'graded', score };
  } else if (c.secured === 0 && c.lost === 0 && Math.abs(c.ungraded - c.weight) < 1e-8) {
    if (old.progress && !['scheduled', 'awaiting_grade'].includes(old.progress.status)) return blocked;
    progress = { status: 'awaiting_grade' };
  } else return blocked;
  return { ok: true, value: course.assessments.map((a): ManagedAssessment => {
    if (a.id !== old.id) return a;
    const restored: ManagedAssessment = { ...a, reviewRequired: undefined, progress };
    delete restored.reviewRequired;
    return restored;
  }) };
}

export function attendanceLinkChangeError(course: ManagedCourse): string {
  const result = detachConfirmedRecord(course);
  return result.ok ? '' : result.errors[0];
}

/** A single explicit selection; names, counts and unrelated assessment records stay intact. */
export function selectAttendanceAssessment(course: ManagedCourse, id: string | null): ManagementResult<ManagedCourse> {
  const e = course.attendanceEstimate;
  if (!e) return { ok: false, errors: ['출석 설정을 먼저 불러와 주세요.'] };
  if (id === e.assessmentId) return { ok: true, value: { ...course, attendanceEstimate: { ...e, selection: 'manual' } } };
  if (id !== null) {
    const option = attendanceLinkOptions(course.assessments, e.assessmentId).find((a) => a.id === id);
    if (!option || option.reason) return { ok: false, errors: ['점수·과제 기록이 없고 비율이 0%보다 큰 항목을 선택해 주세요.'] };
  }
  const detached = detachConfirmedRecord(course);
  if (!detached.ok) return detached;
  const settings = { ...e };
  delete settings.confirmed;
  return { ok: true, value: { ...course, assessments: detached.value, attendanceEstimate: { ...settings, assessmentId: id, selection: 'manual' } } };
}

export function removeAssessmentWithAttendanceLink(course: ManagedCourse, id: string): ManagementResult<ManagedCourse> {
  const e = course.attendanceEstimate, c = e?.confirmed;
  const item = course.assessments.find((a) => a.id === id);
  const hasResult = item && (item.assignmentGroup || item.progress?.status !== 'scheduled');
  if (e?.assessmentId === id && (hasResult || (c && (c.secured > 0 || c.lost > 0 || c.ungraded > 0 || (c.finalDeduction ?? 0) > 0)))) {
    return { ok: false, errors: ['기존 출석 기록을 보존하려면 먼저 출석 점수 연결을 해제해 주세요.'] };
  }
  return { ok: true, value: {
    ...course, assessments: course.assessments.filter((a) => a.id !== id),
    ...(e?.assessmentId === id ? { attendanceEstimate: { ...e, assessmentId: null, selection: 'manual' as const, confirmed: undefined } } : {}),
  } };
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, v[key]])) : v);
}

/** Suppress generic correction prompts only for the exact safe selector operation. */
export function isSafeAttendanceSelectionChange(before: ManagedCourse, after: ManagedCourse): boolean {
  if (after.attendanceEstimate?.selection !== 'manual') return false;
  const planned = selectAttendanceAssessment(before, after.attendanceEstimate.assessmentId);
  return planned.ok && canonical(planned.value) === canonical(after);
}
