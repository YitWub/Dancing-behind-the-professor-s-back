import type { GradePrediction } from '../types.ts';
import type { ManagedCourse, ManagementResult } from './management-types.ts';
import { prepareAttendanceEstimate, estimateAttendance } from './attendance-estimate.ts';
import { computeManagedBalance } from './managed-balance.ts';
import { toEngineCourse, transitionAssessment, validateManagedCourse } from './management.ts';
import { predictWithPolicy, resolvePolicy, targetCut, type FamilyProbability } from './grading-policy.ts';

export interface SimulationInput { assessmentId?: string; score?: number; extraAbsences?: number; useCurrentRank?: boolean }
export interface CourseScenario {
  low: number; high: number; unknownPoints: number;
  /** Before the final zero clamp; needed to invert a target with external deductions. */
  subtotal: number;
  attendance: ReturnType<typeof estimateAttendance>;
  /** Projected contribution bounded by previously confirmed attendance records. */
  attendanceContribution: number;
  /** Recorded attendance loss, including a separate final deduction exactly once. */
  attendanceDeduction: number;
  usesEstimatedAttendance: boolean;
  distribution: GradePrediction['distribution'];
  warnings: GradePrediction['warnings'];
  families: FamilyProbability[];
  probabilityNote: string;
}

/** Pure sandbox: actual records, HP, rank and storage are never overwritten. */
export function simulateCourse(course: ManagedCourse, input: SimulationInput = {}): ManagementResult<CourseScenario> {
  const errors=validateManagedCourse(course);
  if(errors.length)return {ok:false,errors};
  const extra=input.extraAbsences??0;
  if(!Number.isSafeInteger(extra)||extra<0)return {ok:false,errors:['가상 결석 횟수는 0 이상의 정수여야 합니다.']};
  const copy=structuredClone(course);
  copy.attendanceEstimate=prepareAttendanceEstimate(course).value;
  if(!Number.isSafeInteger(copy.attendanceEstimate.absences+extra))return {ok:false,errors:['가상 결석 횟수 범위를 초과했습니다.']};
  copy.attendanceEstimate.absences+=extra;
  if(input.assessmentId!==undefined || input.score!==undefined) {
    const a=copy.assessments.find((a)=>a.id===input.assessmentId);
    if(!a||a.assignmentGroup||a.id===copy.attendanceEstimate.assessmentId||a.progress?.status!=='scheduled'||input.score===undefined)return {ok:false,errors:['아직 진행하지 않은 단일 평가항목과 가상 점수를 선택해 주세요.']};
    const transitioned=transitionAssessment(a,{status:'graded',score:input.score});
    if(!transitioned.ok)return transitioned;
    copy.assessments=copy.assessments.map((item)=>item.id===a.id?transitioned.value:item);
  }
  const balance=computeManagedBalance(copy);if(!balance.ok)return balance;
  const estimate=estimateAttendance(copy);
  const linked=copy.assessments.find((a)=>a.id===copy.attendanceEstimate!.assessmentId);
  const actual=balance.value.items.find((item)=>item.assessmentId===linked?.id);
  const actualAttendance=actual?.balance??{secured:0,lost:0,ungraded:0,remaining:0};
  const attendancePoints=actualAttendance.secured;
  const unknownPoints=Math.max(0,balance.value.balance.remaining+balance.value.balance.ungraded+balance.value.review.unclassifiedPoints-actualAttendance.remaining-actualAttendance.ungraded-(actual?.unclassifiedPoints??0));
  const external=copy.attendanceEstimate.confirmed?.finalDeduction??0;
  const subtotal=balance.value.balance.secured-actualAttendance.secured+attendancePoints-external;
  const low=Math.max(0,subtotal),high=Math.max(0,subtotal+unknownPoints);
  // These observations are explicitly hypothetical; a current rank is not a final rank.
  if(!input.useCurrentRank||input.assessmentId!==undefined||extra>0)delete copy.myRank;
  if(linked) copy.attendanceEstimate.confirmed={weight:estimate.maximum,secured:attendancePoints,lost:Math.max(0,estimate.maximum-attendancePoints),ungraded:0,finalDeduction:external};
  const adapted=toEngineCourse(copy);
  const policyPrediction=adapted.ok?predictWithPolicy(adapted.value,course):null;
  const prediction=policyPrediction?.prediction??null;
  const distribution=prediction?.distribution??null;
  const probabilityNote=(!adapted.ok?adapted.errors.join(' '):policyPrediction!.note)+(Math.abs(attendancePoints-estimate.score)>1e-8?' 총점 계산에서는 기존 출석 상실과 중복 차감하지 않습니다.':'')+(estimate.caution==='below_reference'?' 시험 응시 제한 가능성은 이 점수 기반 확률에 반영하지 않았습니다.':'');
  return {ok:true,value:{low,high,subtotal,unknownPoints,attendance:estimate,attendanceContribution:attendancePoints,attendanceDeduction:actualAttendance.lost+external,usesEstimatedAttendance:false,distribution,families:policyPrediction?.families??[],warnings:prediction?.warnings??[],probabilityNote}};
}

export function analyzeTarget(course:ManagedCourse, target:'A+'|'A0'|'B+'|'B0', assessmentId:string|undefined, extraAbsences=0) {
  if(resolvePolicy(course).kind!=='absolute')return {kind:'unavailable' as const,message:'상대평가는 다른 학생의 분포와 등급 정원에 따라 달라져 최소 필요 점수를 확정할 수 없습니다. 조건부 확률을 참고하세요.'};
  const cut=targetCut(course,target);
  if(cut===undefined)return {kind:'unavailable' as const,message:`${target}의 실제 절대평가 기준점수를 설정하면 필요 점수를 계산할 수 있습니다.`};
  const final=course.assessments.find((a)=>a.id===assessmentId);
  if(!final||final.weight<=0)return {kind:'unavailable' as const,message:'남은 평가항목을 선택해 주세요.'};
  const scenario=simulateCourse(course,{assessmentId:final.id,score:0,extraAbsences});
  if(!scenario.ok)return {kind:'unavailable' as const,message:scenario.errors.join(' ')};
  if(scenario.value.unknownPoints>1e-8)return {kind:'unavailable' as const,message:'다른 미확정 평가의 점수가 남아 있어 기말 최소 점수를 하나로 계산할 수 없습니다.'};
  const required=cut===0?0:Math.max(0,Math.ceil(((cut-scenario.value.subtotal)*final.maxScore/(final.weight*100)-1e-9)*100)/100);
  return {kind:required>final.maxScore?'unreachable' as const:'score' as const,required,maximum:final.maxScore,cut,message:required>final.maxScore?'현재 다른 점수와 출석 가정에서는 이 평가 만점으로도 목표 기준에 닿지 않습니다.':'다른 점수와 출석 가정이 유지된다는 조건의 최소 원점수입니다. 실제 등급 확정은 아닙니다.'};
}
