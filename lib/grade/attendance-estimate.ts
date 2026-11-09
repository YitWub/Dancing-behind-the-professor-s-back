import type { ManagedCourse, FourAreaBalance } from './management-types.ts';
import { computeAttendance } from './attendance.ts';

type Estimate = NonNullable<ManagedCourse['attendanceEstimate']>;
export const ATTENDANCE_REFERENCE_URL = 'https://site.hanyang.ac.kr/web/ehaksa/-grade-process';

/** Only compatibility entry point. Never writes, mutates, splits grades or guesses excuses. */
export function prepareAttendanceEstimate(course: ManagedCourse): { value: Estimate; review: string[] } {
  if (course.attendanceEstimate) return {value: structuredClone(course.attendanceEstimate), review: []};
  const id = course.simpleAttendance?.assessmentId ?? course.attendanceManagement?.assessmentId;
  const candidates = course.assessments.filter((a)=>!a.assignmentGroup && /출석|attendance/i.test(a.name));
  const linked = course.assessments.find((a)=>a.id===id) ?? (candidates.length===1?candidates[0]:undefined);
  const records = course.simpleAttendance?.records ?? course.attendanceManagement?.records ?? course.attendanceNotes ?? course.attendance;
  const value: Estimate = {model:'equal-15-v1', assessmentId:linked?.id??null, absences:records?.absences??0, lateness:records?.lateness??0};
  const review: string[]=[];
  if (!linked && candidates.length>1) review.push('출석 항목이 여러 개입니다. 과목 설정에서 하나로 정리한 후 연결해 주세요.');
  if (course.simpleAttendance || course.attendanceManagement) {
    const old=computeAttendance(course);
    if(old.ok) {
      const b=old.value.score.balance;
      value.confirmed={weight:(linked?.weight??0)*100,secured:b.secured,lost:b.lost,ungraded:b.ungraded,finalDeduction:old.value.score.finalDeduction};
    }
    review.push('기존 출석 규칙은 편집 대상에서 제외하고 원본으로 보관합니다. 기존 확정 점수·감점은 유지하고 새 간이 추정은 별도로 표시합니다.');
  } else if (linked?.progress?.status==='graded' || linked?.progress?.status==='zero_confirmed') {
    const p=linked.progress;const maximum=linked.weight*100;
    const secured=p.status==='graded'?maximum*p.score/linked.maxScore:0;
    value.confirmed={weight:maximum,secured,lost:maximum-secured,ungraded:0,finalDeduction:null};
    review.push('기존 직접 출석 점수는 확정 성적으로 보관하며 간이 추정으로 덮어쓰지 않습니다.');
  } else if(linked?.progress?.status==='awaiting_grade') {
    value.confirmed={weight:linked.weight*100,secured:0,lost:0,ungraded:linked.weight*100,finalDeduction:null};
  }
  if(records && (value.absences>0 || value.lateness>0)) review.push(`기존 기록에서 결석 ${value.absences}회·지각 ${value.lateness}회를 가져옵니다. 지각은 이제 3회당 결석 1회로 추정합니다.`);
  const excused=records&&'excused' in records?records.excused:0;
  if(excused)review.push(`공결 ${excused}회는 원본에 보관하며 새 추정에서는 감점하지 않습니다. 결석에 공결을 포함하지 않았는지 확인해 주세요.`);
  return {value,review};
}

export function validateAttendanceEstimate(course: ManagedCourse): string[] {
  const e=course.attendanceEstimate;
  if (!e || typeof e!=='object' || e.model!=='equal-15-v1') return ['출석 간이 추정 데이터 형식을 확인해 주세요.'];
  if(e.totalSessions!==undefined&&(!Number.isSafeInteger(e.totalSessions)||e.totalSessions<=0))return ['총 수업 횟수는 1 이상의 정수여야 합니다.'];
  if (![e.absences,e.lateness].every((n)=>Number.isSafeInteger(n)&&n>=0) || !Number.isSafeInteger(e.absences+Math.floor(e.lateness/3)))return ['결석·지각 횟수는 0 이상의 정수여야 합니다.'];
  if (!Array.isArray(course.assessments))return ['평가항목을 확인해 주세요.'];
  const linked=course.assessments.find((a)=>a&&a.id===e.assessmentId);
  if(e.assessmentId!==null&&(!linked||linked.assignmentGroup))return ['출석 평가항목 연결을 확인해 주세요.'];
  if(e.assessmentId===null&&course.assessments.some((a)=>a&&/출석|attendance/i.test(a.name)&&a.weight>0))return ['출석 평가항목을 하나로 정리해 주세요. 비율은 자동 재배분하지 않습니다.'];
  const c=e.confirmed;
  if ('confirmed' in e && c!==undefined && (!c||typeof c!=='object'||Array.isArray(c)))return ['이전 확정 출석 점수 보관 형식을 확인해 주세요.'];
  if(c && (![c.weight,c.secured,c.lost,c.ungraded].every((n)=>Number.isFinite(n)&&n>=0)||c.secured+c.lost+c.ungraded>c.weight+1e-8||(c.finalDeduction!==null&&(!Number.isFinite(c.finalDeduction)||c.finalDeduction<0))))return ['이전 확정 출석 점수 보관 형식을 확인해 주세요.'];
  return [];
}

export function estimateAttendance(course: ManagedCourse) {
  const e=course.attendanceEstimate??prepareAttendanceEstimate(course).value;
  const maximum=(course.assessments.find((a)=>a.id===e.assessmentId)?.weight??0)*100;
  const effectiveAbsences=e.absences+Math.floor(e.lateness/3);
  const totalSessions=e.totalSessions??15;
  const allowedAbsences=Math.floor(totalSessions/3);
  const minimumAttendance=totalSessions-allowedAbsences;
  const remainingAllowance=Math.max(0,allowedAbsences-effectiveAbsences);
  const valid=Number.isSafeInteger(totalSessions)&&totalSessions>0;
  const deduction=Math.min(maximum,maximum*effectiveAbsences/totalSessions);
  return {valid,maximum,totalSessions,minimumAttendance,allowedAbsences,remainingAllowance,effectiveAbsences,deduction,score:Math.max(0,maximum-deduction),caution:effectiveAbsences>allowedAbsences?'below_reference':effectiveAbsences===allowedAbsences?'boundary':remainingAllowance<=2?'warning':'none'} as const;
}

/** Actual HP contribution only; the estimate is deliberately never read here. */
export function confirmedAttendanceBalance(course: ManagedCourse): FourAreaBalance {
  const e=course.attendanceEstimate!;const c=e.confirmed;
  const maximum=(course.assessments.find((a)=>a.id===e.assessmentId)?.weight??0)*100;
  const scale=c&&c.weight>0?maximum/c.weight:0;
  const secured=(c?.secured??0)*scale,lost=(c?.lost??0)*scale,ungraded=(c?.ungraded??0)*scale;
  return {secured,lost,ungraded,remaining:Math.max(0,maximum-secured-lost-ungraded)};
}

export function estimateChangeMessages(before:ManagedCourse[],after:ManagedCourse[]):string[] {
  return before.flatMap((old)=>{
    const next=after.find((c)=>c.id===old.id);
    if(!next)return old.attendanceEstimate?[`${old.name}: 과목 삭제와 함께 현재 출석 기록이 삭제됩니다.`]:[];
    if(!old.attendanceEstimate&&next.attendanceEstimate){const messages=prepareAttendanceEstimate(old).review;return messages.length?[...messages,`저장할 기록: 결석 ${next.attendanceEstimate.absences}회·지각 ${next.attendanceEstimate.lateness}회. 원본 기록은 보존됩니다.`]:[];}
    if(old.attendanceEstimate&&!next.attendanceEstimate)return ['현재 출석 기록을 제거할 수 없습니다. 결석·지각 횟수를 정정해 주세요.'];
    const a=old.attendanceEstimate,b=next.attendanceEstimate;
    if(a&&b&&(b.absences<a.absences||b.lateness<a.lateness||a.assessmentId!==b.assessmentId||(a.totalSessions??15)!==(b.totalSessions??15)||JSON.stringify(a.confirmed)!==JSON.stringify(b.confirmed)))return [`${old.name}: 출석 횟수 가정 ${a.totalSessions??15}회 → ${b.totalSessions??15}회 또는 기록·연결·확정 점수 보관 내용의 정정을 확인해 주세요.`];
    return [];
  });
}
