import type { ManagedCourse } from './management-types.ts';
import type { AttendanceCalculation, AttendanceEligibility, SimpleAttendance } from './attendance-types.ts';
import { evaluateAttendanceEligibility, validateAttendanceManagement } from './attendance.ts';

export function validateSimpleAttendance(course: ManagedCourse): string[] {
  const s = course.simpleAttendance;
  if (!s) return [];
  if (!Array.isArray(course.assessments) || course.assessments.some((a)=>!a||typeof a!=='object')) return ['평가항목 형식을 확인해 주세요.'];
  if (!['off','record_only','scored'].includes(s.mode) || typeof s.finalized !== 'boolean' || !s.records) return ['간편 출석 형식을 확인해 주세요.'];
  const values = [s.records.absences, s.records.lateness, s.records.excused];
  if (!values.every((n) => Number.isSafeInteger(n) && n >= 0) || !Number.isSafeInteger(values.reduce((a,b)=>a+b,0))) return ['출결 횟수는 0 이상의 정수여야 합니다.'];
  if (s.totalSessions !== null && (!Number.isSafeInteger(s.totalSessions) || s.totalSessions <= 0 || values.reduce((a,b)=>a+b,0) > s.totalSessions)) return ['총 수업 횟수와 출결 기록을 확인해 주세요.'];
  const linked = course.assessments.find((a) => a.id === s.assessmentId);
  if (course.attendanceManagement?.assessmentId && course.attendanceManagement.assessmentId!==s.assessmentId && course.assessments.some((a)=>a.id===course.attendanceManagement!.assessmentId&&a.weight>0)) return ['기존 출석 연결 항목의 비율이 남아 있습니다. 기존 항목을 그대로 연결하거나 기존 비율을 직접 0%로 조정해 주세요.'];
  if (s.mode === 'scored' && !linked) return ['출석 점수를 반영할 평가항목을 선택해 주세요.'];
  const sourceIds = [s.assessmentId, course.attendanceManagement?.assessmentId];
  if (s.mode !== 'scored' && course.assessments.some((a) => sourceIds.includes(a.id) && a.weight > 0)) return ['점수를 반영하지 않는 출석 유형입니다. 연결 항목 비율을 0%로 변경하고 전체 합계 100%를 직접 맞춰 주세요.'];
  if (s.mode !== 'scored' && course.assessments.some((a) => /출석|attendance/i.test(a.name) && a.weight > 0)) return ['점수 미반영 유형과 출석 평가비율이 충돌합니다. 출석 비율을 직접 0%로 변경하고 합계 100%를 맞춰 주세요.'];
  if (!s.eligibility || !['sessions','hours'].includes(s.eligibility.unit)) return ['출석 미달 기준 단위를 확인해 주세요.'];
  if (s.eligibility.unit==='hours' && s.eligibility.rule?.kind==='max_absences') return ['결석 횟수 기준은 수업 횟수 단위로 설정해 주세요.'];
  const total = s.totalSessions ?? Math.max(1, values.reduce((a,b)=>a+b,0));
  const errors = validateAttendanceManagement({ assessmentId: s.assessmentId, records: {total, held: total, ...s.records}, penalty: s.penalty?.kind === 'weighted_points' ? {kind:'final_points', pointsPerAbsence:s.penalty.pointsPerAbsence} : s.penalty, rawMaxScore:s.rawMaxScore, latePenalty:s.latePenalty, excusedForScore:s.excusedForScore, allocation:'term_end', eligibility:{...s.eligibility, hours:null, unit:'sessions'} }, course.assessments);
  const hours = s.eligibility?.hours;
  if (hours && (!Number.isFinite(hours.total) || hours.total <= 0 || !Number.isFinite(hours.held) || !Number.isFinite(hours.credited) || hours.credited < 0 || hours.held < hours.credited || hours.total < hours.held || typeof hours.recognitionConfirmed !== 'boolean')) errors.push('총·진행·인정 시간을 확인해 주세요.');
  if (linked?.assignmentGroup) errors.push('과제 그룹은 출석에 연결할 수 없습니다.');
  return errors;
}

const convertLate = (n: number, rule: SimpleAttendance['latePenalty'] | SimpleAttendance['eligibility']['late']) => n === 0 ? 0 : rule.kind === 'unconfirmed' ? null : rule.kind === 'bundled' ? Math.floor(n / rule.perAbsence) : rule.kind === 'proportional' ? n / rule.perAbsence : 0;

export function computeSimpleAttendance(course: ManagedCourse): AttendanceCalculation {
  const s = course.simpleAttendance!;
  const a = course.assessments.find((a) => a.id === s.assessmentId);
  const maximum = s.mode === 'scored' ? (a?.weight ?? 0) * 100 : 0;
  const late = convertLate(s.records.lateness, s.latePenalty);
  const excusedKnown = s.records.excused === 0 || s.excusedForScore !== 'unconfirmed';
  const known = s.mode !== 'scored' || (s.penalty.kind !== 'unconfirmed' && late !== null && excusedKnown);
  const baseAbsences = s.records.absences + (s.excusedForScore === 'as_absence' ? s.records.excused : 0);
  const effective = baseAbsences + (late ?? 0);
  const raw = s.mode !== 'scored' || s.penalty.kind === 'unconfirmed' ? 0 : effective * s.penalty.pointsPerAbsence + (s.latePenalty.kind === 'separate' ? s.records.lateness * s.latePenalty.pointsPerLate : 0);
  const internal = s.mode !== 'scored' || s.penalty.kind === 'final_points' ? 0 : Math.min(maximum, s.penalty.kind === 'attendance_points' ? maximum * raw / s.rawMaxScore : raw);
  const external = s.mode === 'scored' && s.penalty.kind === 'final_points' ? raw : 0;
  const old = course.attendanceManagement;
  const confirmedBudget = old?.allocation === 'per_session_equal' && old.assessmentId === s.assessmentId ? maximum * old.records.held / old.records.total : 0;
  const secured = s.finalized && known ? maximum - internal : known ? Math.max(0, confirmedBudget - internal) : 0;
  const pending = Math.max(0, maximum - internal - secured);
  const messages: string[] = [];
  if (s.mode === 'scored' && s.penalty.kind === 'unconfirmed') messages.push('결석 감점 규칙을 설정해 주세요.');
  if (s.mode === 'scored' && late === null) messages.push('기록된 지각의 감점 규칙을 확인해 주세요.');
  if (s.mode === 'scored' && !excusedKnown) messages.push('기록된 공결의 인정 규칙을 확인해 주세요.');
  let eligibility: AttendanceEligibility = {status:'needs_review',phase:s.finalized?'complete':'in_progress',finalStatus:'needs_review',effectiveAbsences:null,currentRatio:null,bestFinalRatio:null,unrecoverable:false,messages:[]};
  const e = s.eligibility;
  if (s.mode !== 'off' && e.rule.kind !== 'unconfirmed') {
    const riskLate = convertLate(s.records.lateness, e.late);
    if (e.unit === 'hours' || riskLate !== null && (s.records.excused === 0 || e.excused !== 'unconfirmed')) {
      const deficit = s.records.absences + (riskLate??0) + (e.excused === 'as_absence' ? s.records.excused : 0);
      if (e.unit === 'sessions' && e.rule.kind === 'max_absences') {
        const failed = e.rule.failureAt === 'reaches' ? deficit >= e.rule.allowed : deficit > e.rule.allowed;
        const risk = !failed && (e.rule.failureAt === 'reaches' ? deficit + 1 >= e.rule.allowed : deficit + 1 > e.rule.allowed);
        eligibility = {...eligibility,status:failed?'failed':risk?'risk':'normal',effectiveAbsences:deficit,unrecoverable:failed,finalStatus:s.finalized?failed?'failed':'eligible':'not_final'};
      } else if ((e.unit === 'sessions' && s.totalSessions) || (e.unit === 'hours' && e.hours?.recognitionConfirmed)) {
        const total=s.totalSessions ?? Math.max(1,s.records.absences+s.records.lateness+s.records.excused);
        eligibility=evaluateAttendanceEligibility({assessmentId:s.assessmentId,records:{total,held:total,...s.records},penalty:{kind:'unconfirmed'},latePenalty:s.latePenalty,excusedForScore:s.excusedForScore,allocation:'term_end',eligibility:{...e,excused:s.records.excused===0?'recognized':e.excused,late:s.records.lateness===0?{kind:'ignored'}:e.late}});
        eligibility.phase=s.finalized?'complete':'in_progress';
        if (!s.finalized) {eligibility.finalStatus='not_final';eligibility.currentRatio=null;}
        if (!s.finalized && e.unit==='sessions' && e.rule.kind==='minimum_ratio' && eligibility.status==='normal' && (total-deficit-1)/total < e.rule.minimum-1e-10) eligibility.status='risk';
      }
    }
  }
  return {score:{balance:{secured,lost:internal,ungraded:s.finalized?pending:0,remaining:s.finalized?0:pending},unclassifiedPoints:0,known,complete:known,effectiveAbsences:known?effective:null,rawDeduction:s.penalty.kind==='unconfirmed'&&s.mode==='scored'?null:raw,internalDeduction:s.penalty.kind==='unconfirmed'&&s.mode==='scored'?null:internal,finalDeduction:s.penalty.kind==='unconfirmed'&&s.mode==='scored'?null:external,finalRawScore:s.mode==='scored'&&s.finalized&&known?s.rawMaxScore*(maximum>0?(maximum-internal)/maximum:1):null,messages},eligibility};
}
