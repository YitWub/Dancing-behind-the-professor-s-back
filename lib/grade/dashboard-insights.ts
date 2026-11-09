import type { ManagedCourse } from './management-types.ts';
import type { PlannerGoal } from './grade-planner.ts';
import { planningUnits, planGoal } from './grade-planner.ts';
import { computeAssignmentBalance } from './assignments.ts';
import { simulateCourse } from './course-simulation.ts';
import { prepareAttendanceEstimate } from './attendance-estimate.ts';
import { resolvePolicy, gradeForScore, targetCut } from './grading-policy.ts';
import { validateManagedCourse } from './management.ts';
import { relativeOutlook, relativeGoal } from './relative-outlook.ts';

/** A named, disclosed hypothesis, not a claim that waiting results are controllable. */
export function headlineForecast(course:ManagedCourse,options:{finalId?:string;score?:number;extraAbsences?:number}={}) {
  const errors=validateManagedCourse(course);
  if(errors.length)return {ok:false as const,message:errors.join(' ')};
  if(!Number.isSafeInteger(options.extraAbsences??0)||(options.extraAbsences??0)<0)return {ok:false as const,message:'추가 결석은 0 이상의 정수여야 합니다.'};
  if(options.finalId!==undefined){const a=course.assessments.find((a)=>a.id===options.finalId);if(!a||a.assignmentGroup||a.progress?.status!=='scheduled'||options.score===undefined||!Number.isFinite(options.score)||options.score<0||options.score>a.maxScore)return {ok:false as const,message:'예정 시험의 유효한 점수를 선택해 주세요.'};}
  const rate=planningUnits(course).recordedRate;
  if(rate===null)return {ok:false as const,message:'시험·과제 점수를 하나 기록하면 지금 흐름의 예상 학점이 나타납니다.'};
  const copy=structuredClone(course);copy.attendanceEstimate=prepareAttendanceEstimate(course).value;
  copy.attendanceEstimate.absences+=options.extraAbsences??0;
  const attendanceId=copy.attendanceEstimate.assessmentId;
  const category=(a:ManagedCourse['assessments'][number])=>a.assignmentGroup||/과제|assignment|homework|project|프로젝트/i.test(a.name)?'assignment':'exam';
  const totals={exam:{secured:0,points:0},assignment:{secured:0,points:0}};
  const groupRates=new Map<string,number>();
  for(const a of course.assessments){
    if(a.id===attendanceId||a.weight===0)continue;
    let secured=0,points=0;
    if(a.assignmentGroup){const d=computeAssignmentBalance(a);if(d.ok&&d.value.complete){for(const t of d.value.tasks){const task=a.assignmentGroup.tasks.find((task)=>task.id===t.taskId)!;if(task.progress.status==='graded'||task.progress.status==='zero_confirmed'){secured+=t.balance!.secured;points+=t.points!;}}if(points>0)groupRates.set(a.id,secured/points);}}
    else if(a.progress?.status==='graded'||a.progress?.status==='zero_confirmed'){points=a.weight*100;secured=a.progress.status==='graded'?points*a.progress.score/a.maxScore:0;}
    totals[category(a)].secured+=secured;totals[category(a)].points+=points;
  }
  const projections:{name:string;score:number;maxScore:number;basis:string}[]=[];
  let waiting=false;
  for(const a of copy.assessments){if(a.id===attendanceId)continue;
    const total=totals[category(a)];
    const assumedRate=groupRates.get(a.id)??(total.points>0?total.secured/total.points:rate);
    const basis=groupRates.has(a.id)?'이 과제의 완료분 평균':total.points>0?(category(a)==='exam'?'확정 시험 평균':'확정 과제 평균'):'확정 시험·과제 평균 (같은 종류 기록 없음)';
    if(a.assignmentGroup){for(const t of a.assignmentGroup.tasks)if(t.progress.status==='scheduled'||t.progress.status==='awaiting_grade'){waiting||=t.progress.status==='awaiting_grade';const score=t.maxScore*assumedRate;t.progress={status:'graded',score};projections.push({name:`${a.name} · ${t.name}`,score,maxScore:t.maxScore,basis});}}
    else if(a.progress?.status==='scheduled'||a.progress?.status==='awaiting_grade'){
      waiting||=a.progress.status==='awaiting_grade';const score=a.id===options.finalId?options.score!:a.maxScore*assumedRate;
      delete a.reviewRequired;a.progress={status:'graded',score};projections.push({name:a.name,score,maxScore:a.maxScore,basis:a.id===options.finalId?'선택한 가상 점수':basis});
    }
  }
  const result=simulateCourse(copy);if(!result.ok)return {ok:false as const,message:result.errors.join(' ')};
  if(result.value.unknownPoints>1e-8)return {ok:false as const,message:'배점·진행 상태를 확인하면 현재 흐름의 등급을 비교할 수 있습니다.'};
  const p=resolvePolicy(course),s=result.value;
  const relative=p.kind.startsWith('relative')?relativeOutlook(course,options):null;
  const label=relative?(relative.ok?relative.label:'평균 입력 필요'):gradeForScore(course,s.low);
  const basis=relative?'시험 평균 기반 간이 추정 · 분포·등급 배분 가정':p.kind==='unknown'?'평가 방식 확인 필요':'현재 득점률 유지 가정';
  return {ok:true as const,label:label??'기준 확인',basis,rate,waiting,projections,relative,score:s.low,scenario:s};
}

/** Relative targets use an explicit benchmark, never an invented actual grade cutoff. */
export function gradeActionPlan(course:ManagedCourse,grade:string) {
  const p=resolvePolicy(course);
  if(p.kind.startsWith('relative'))return {plan:{kind:'unavailable' as const,message:''},relative:relativeGoal(course,grade),benchmark:false,cut:undefined};
  if(p.kind==='unknown')return {plan:{kind:'unavailable' as const,message:'평가 방식을 설정하면 목표 학점 플랜을 볼 수 있어요.'},relative:null,benchmark:false,cut:undefined};
  const plan=planGoal(course,{kind:'grade',grade} as PlannerGoal);
  return {plan,relative:null,benchmark:false,cut:targetCut(course,grade)};
}

export function forecastActions(course:ManagedCourse) {
  const base=headlineForecast(course);
  const attendanceId=prepareAttendanceEstimate(course).value.assessmentId;
  const final=course.assessments.find((a)=>a.id!==attendanceId&&!a.assignmentGroup&&a.progress?.status==='scheduled'&&/기말|final/i.test(a.name));
  const options=base.ok&&final?[...new Set([.7,.8,.9,Math.min(1,base.rate+.1)].map((r)=>Math.round(final.maxScore*r*100)/100))].sort((a,b)=>a-b):[];
  return {base,final,exams:options.map((score)=>({score,result:headlineForecast(course,{finalId:final!.id,score})})),absence:headlineForecast(course,{extraAbsences:1})};
}
