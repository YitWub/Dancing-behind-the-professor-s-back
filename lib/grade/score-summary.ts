import type { ManagedBalance, ManagedCourse, ManagementResult } from './management-types.ts';
import { computeManagedBalance } from './managed-balance.ts';
import { prepareAttendanceEstimate, estimateAttendance } from './attendance-estimate.ts';
import { gradeForScore } from './grading-policy.ts';

/** HP is the remaining attainable ceiling, never the secured subtotal or a predicted grade. */
export function summarizeScore(course: ManagedCourse, actual: ManagementResult<ManagedBalance> = computeManagedBalance(course)) {
  if (!actual.ok) return actual;
  const { balance, complete, finalDeduction } = actual.value;
  const attendanceSettings=prepareAttendanceEstimate(course).value;
  const attendanceId=attendanceSettings.assessmentId;
  const attendance=actual.value.items.find((item)=>item.assessmentId===attendanceId);
  const attendanceAssessment=course.assessments.find((a)=>a.id===attendanceId);
  const confirmedAttendance=attendanceSettings.confirmed;
  const historicalLoss=confirmedAttendance?((confirmedAttendance.weight>0?(attendanceAssessment?.weight??0)*100/confirmedAttendance.weight*confirmedAttendance.lost:0)+(confirmedAttendance.finalDeduction??0)):0;
  const attendanceDeductionSource=historicalLoss>0?(estimateAttendance(course).deduction>historicalLoss+1e-8?'configured-rule-with-confirmed-floor':'confirmed-record'):'configured-rule';
  const maximum=complete?Math.max(0,100-balance.lost-(finalDeduction??0)):null;
  return {
    ok: true as const,
    value: {
      actual: actual.value,
      hp: maximum,
      lostHp: maximum===null?null:100-maximum,
      attainableGrade: maximum===null?null:gradeForScore(course,maximum),
      attendanceRule: {source:'configured-rule' as const,model:attendanceSettings.model,totalSessions:attendanceSettings.totalSessions??15,latenessPerAbsence:3},
      attendanceDeductionSource,
      confirmedMaximum: maximum,
      estimatedMaximum: maximum,
      attendanceAdjustedScore: complete?Math.max(0,balance.secured-(finalDeduction??0)):null,
      attendanceDeduction: (attendance?.balance.lost??0)+(finalDeduction??0),
      attendanceContribution: attendance?.balance.secured??0,
      attendanceMaximum: (attendanceAssessment?.weight??0)*100,
      usesEstimatedAttendance: false,
    },
  };
}
