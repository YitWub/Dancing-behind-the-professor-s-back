import type { ManagedBalance, ManagedCourse, ManagementResult } from './management-types.ts';
import { validateManagedCourse } from './management.ts';
import { computeAssignmentBalance } from './assignments.ts';
import { progressBalance } from './assessment-progress.ts';
import type { FourAreaBalance } from './management-types.ts';
import { computeAttendance } from './attendance.ts';
import { confirmedAttendanceBalance } from './attendance-estimate.ts';

/** Deterministic assessment accounting. No estimates or probability model are involved.
 * Do not round individual components: 4 areas + unclassifiedPoints conserve total weight.
 * A legacy attendance ledger is retained for review, never silently applied here.
 */
export function computeManagedBalance(course: ManagedCourse): ManagementResult<ManagedBalance> {
  const errors = validateManagedCourse(course);
  if (errors.length) return { ok: false, errors };
  const balance = { secured: 0, lost: 0, ungraded: 0, remaining: 0 };
  const attendance = !course.attendanceEstimate && (course.simpleAttendance || course.attendanceManagement) ? computeAttendance(course) : null;
  const attendanceId=course.attendanceEstimate ? course.attendanceEstimate.assessmentId : course.simpleAttendance?.assessmentId ?? course.attendanceManagement?.assessmentId;
  if (attendance && !attendance.ok) return attendance;
  const items: ManagedBalance['items'] = [];
  const assessmentIds: string[] = [];
  let unclassifiedPoints = 0;
  let totalPoints = 0;
  for (const a of course.assessments) {
    const points = a.weight * 100;
    totalPoints += points;
    if (course.attendanceEstimate && a.id===attendanceId) {
      items.push({assessmentId:a.id,balance:confirmedAttendanceBalance(course),unclassifiedPoints:0,complete:true});
    } else if (a.id === attendanceId && attendance?.ok) {
      const score = attendance.value.score;
      items.push({ assessmentId: a.id, balance: score.balance, unclassifiedPoints: score.unclassifiedPoints, complete: score.complete });
    } else if (a.assignmentGroup) {
      const detail = computeAssignmentBalance(a);
      if (!detail.ok) return detail;
      items.push({ assessmentId: a.id, balance: detail.value.balance, unclassifiedPoints: detail.value.unclassifiedPoints, complete: detail.value.complete });
    } else if (a.progress === null) {
      items.push({ assessmentId: a.id, balance: { secured: 0, lost: 0, ungraded: 0, remaining: 0 }, unclassifiedPoints: points, complete: false });
    } else {
      items.push({ assessmentId: a.id, balance: progressBalance(a.progress, a.maxScore, points), unclassifiedPoints: 0, complete: true });
    }
    const item = items[items.length - 1];
    for (const key of Object.keys(balance) as (keyof FourAreaBalance)[]) balance[key] += item.balance[key];
    if (!item.complete) assessmentIds.push(a.id);
    unclassifiedPoints += item.unclassifiedPoints;
  }
  const legacyPending = course.attendance !== null && !course.attendanceManagement && !course.simpleAttendance && !course.attendanceEstimate;
  const complete = assessmentIds.length === 0 && !legacyPending && (!attendance?.ok || attendance.value.score.complete);
  const finalDeduction = course.attendanceEstimate?.confirmed?.finalDeduction ?? (attendance?.ok ? attendance.value.score.finalDeduction : null);
  return { ok: true, value: {
    balance, totalPoints, items, complete,
    review: { assessmentIds, unclassifiedPoints, attendanceLedgerPreserved: legacyPending },
    ...(attendance?.ok ? { attendance: attendance.value, finalDeduction,
      netFinalScore: complete && balance.remaining <= 1e-10 && balance.ungraded <= 1e-10 && finalDeduction !== null ? Math.max(0, balance.secured - finalDeduction) : null,
    } : {}),
    ...(course.attendanceEstimate ? {finalDeduction,netFinalScore:complete&&balance.remaining<=1e-10&&balance.ungraded<=1e-10&&finalDeduction!==null?Math.max(0,balance.secured-finalDeduction):null} : {}),
  } };
}
