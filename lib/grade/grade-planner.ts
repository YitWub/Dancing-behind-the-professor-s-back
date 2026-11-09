import type { GradeLetter } from '../types.ts';
import type { ManagedCourse } from './management-types.ts';
import { simulateCourse } from './course-simulation.ts';
import { prepareAttendanceEstimate } from './attendance-estimate.ts';
import { computeAssignmentBalance } from './assignments.ts';
import { resolvePolicy, targetCut, gradeForScore, policyCaps } from './grading-policy.ts';
import { validateManagedCourse } from './management.ts';

export interface PlanningUnit {assessmentId:string;taskId?:string;name:string;kind:'assignment'|'exam';points:number;maxScore:number}
export type PlannerGoal={kind:'grade';grade:GradeLetter|'P'}|{kind:'points';points:number};
interface PlanStrategy {key:'balanced'|'assignment_first'|'exam_first';label:string;assumption:string;rows:(PlanningUnit&{low:number;high:number})[]}
export type GoalPlan={kind:'unavailable';message:string}|{kind:'already'|'impossible'|'waiting'|'unavailable'|'plan';cut:number;needed:number;bestNeeded:number;capacity:number;waiting:number;low:number;high:number;neededRateLow:number|null;neededRateHigh:number|null;issues:string[];strategies:PlanStrategy[];message:string};

export function planningUnits(course:ManagedCourse) {
  const attendanceId=prepareAttendanceEstimate(course).value.assessmentId;
  const units:PlanningUnit[]=[];const issues:string[]=[];
  let completedPoints=0,securedPoints=0;
  for(const a of course.assessments) {
    if(a.id===attendanceId||a.weight===0)continue;
    if(a.assignmentGroup){const detail=computeAssignmentBalance(a);if(!detail.ok){issues.push(...detail.errors);continue;}if(!detail.value.complete){issues.push(`${a.name}: 세부 과제 배점을 확인해 주세요.`);continue;}
      for(const t of a.assignmentGroup.tasks){const d=detail.value.tasks.find((d)=>d.taskId===t.id)!;const points=d.points!;
        if(t.progress.status==='scheduled')units.push({assessmentId:a.id,taskId:t.id,name:`${a.name} · ${t.name}`,kind:'assignment',points,maxScore:t.maxScore});
        if(t.progress.status==='graded'||t.progress.status==='zero_confirmed'){completedPoints+=points;securedPoints+=d.balance!.secured;}
      }
    }else if(a.progress?.status==='scheduled')units.push({assessmentId:a.id,name:a.name,kind:/과제|assignment|homework|project|프로젝트/i.test(a.name)?'assignment':'exam',points:a.weight*100,maxScore:a.maxScore});
    else if(a.progress?.status==='graded'||a.progress?.status==='zero_confirmed'){completedPoints+=a.weight*100;securedPoints+=a.progress.status==='graded'?a.weight*100*a.progress.score/a.maxScore:0;}
    else if(a.progress===null)issues.push(`${a.name}: 기존 진행 상태를 확인해 주세요.`);
  }
  return {units,issues,recordedRate:completedPoints>0?securedPoints/completedPoints:null};
}

/** Only scheduled work is assigned a hypothetical rate. Waiting results remain a range. */
export function projectRemaining(course:ManagedCourse,rate:number) {
  if(!Number.isFinite(rate)||rate<0||rate>1)return {ok:false as const,errors:['가상 득점률은 0~100%여야 합니다.']};
  const errors=validateManagedCourse(course);if(errors.length)return {ok:false as const,errors};
  const copy=structuredClone(course);const {units}=planningUnits(course);
  for(const u of units){const a=copy.assessments.find((a)=>a.id===u.assessmentId)!;if(u.taskId){a.assignmentGroup!.tasks=a.assignmentGroup!.tasks.map((t)=>t.id===u.taskId?{...t,progress:{status:'graded',score:t.maxScore*rate}}:t);}else{delete a.reviewRequired;a.progress={status:'graded',score:a.maxScore*rate};}}
  return simulateCourse(copy);
}

export function courseOutlook(course:ManagedCourse) {
  const base=simulateCourse(course,{useCurrentRank:true});if(!base.ok)return {base,recordedRate:null,scenarios:[]};const {recordedRate}=planningUnits(course);
  const assumptions=[{label:'보수적 가정',rate:Math.min(.6,recordedRate??.6)},...(recordedRate===null?[]:[{label:'현재 기록 득점률 유지 가정',rate:recordedRate}]),{label:'낙관적 가정',rate:Math.max(.9,recordedRate??.9)}];
  return {base,recordedRate,scenarios:assumptions.map((a)=>{const result=projectRemaining(course,a.rate);return {...a,result,gradeLow:result.ok?gradeForScore(course,result.value.low):null,gradeHigh:result.ok?gradeForScore(course,result.value.high):null};})};
}

export function planGoal(course:ManagedCourse,goal:PlannerGoal):GoalPlan {
  const basis=simulateCourse(course);const p=resolvePolicy(course),caps=policyCaps(course);
  const cut=goal.kind==='points'?goal.points:targetCut(course,goal.grade);
  if(!basis.ok)return {kind:'unavailable' as const,message:basis.errors.join(' ')};
  if(cut===undefined)return {kind:'unavailable' as const,message:p.kind.startsWith('relative')?`${caps?`A 최대 ${Math.round(caps.a*100)}%, A+B 최대 ${Math.round(caps.ab*100)}%는 배분 상한입니다. `:''}개별 등급의 최소 점수는 상대적 위치가 필요합니다. 아래에서 목표 총점을 선택하면 점수 전략을 계산합니다.`:p.kind==='pass_fail'?'P/F 합격점은 강좌별로 달라 확인이 필요합니다. 임의의 합격점을 적용하지 않습니다.':p.kind==='unknown'?'평가 방식은 확인이 필요하지만 목표 총점 플랜은 바로 사용할 수 있습니다.':'선택한 등급의 교수자 기준을 설정하거나 공식 최종점수 표를 선택해 주세요.'};
  if(!Number.isFinite(cut)||cut<0||cut>100)return {kind:'unavailable' as const,message:'목표 총점은 0~100점이어야 합니다.'};
  const {units,issues}=planningUnits(course);
  const capacity=units.reduce((s,u)=>s+u.points,0);
  const waiting=Math.max(0,basis.value.unknownPoints-capacity);
  const needed=cut===0?0:Math.max(0,cut-basis.value.subtotal),bestNeeded=Math.max(0,needed-waiting);
  const kind=needed<=1e-8?'already':basis.value.high<cut-1e-8?'impossible':issues.length?'unavailable':capacity<=1e-8?'waiting':'plan';
  const strategies=(['balanced','assignment_first','exam_first'] as const).map((key)=>{
    const favored=key==='assignment_first'?'assignment':key==='exam_first'?'exam':null;
    const priorityCapacity=favored?units.filter((u)=>u.kind===favored).reduce((s,u)=>s+u.points,0):0;
    const rate=(need:number,u:PlanningUnit)=>key==='balanced'||priorityCapacity===0?capacity>0?need/capacity:0:u.kind===favored?1:capacity>priorityCapacity?Math.max(0,need-priorityCapacity)/(capacity-priorityCapacity):0;
    return {key,label:key==='balanced'?'균형 전략':key==='assignment_first'?'과제 우선 전략':'시험 우선 전략',assumption:key==='balanced'?'남은 평가에 같은 득점률 적용':priorityCapacity===0?'이 종류의 남은 평가가 없어 균형 전략과 동일':key==='assignment_first'?'남은 과제를 만점으로 받는 가정':'남은 시험·기타 평가를 만점으로 받는 가정',rows:units.map((u)=>({...u,low:Math.max(0,Math.ceil((u.maxScore*rate(bestNeeded,u)-1e-9)*100)/100),high:Math.max(0,Math.ceil((u.maxScore*rate(needed,u)-1e-9)*100)/100)}))};
  });
  return {kind,cut,needed,bestNeeded,capacity,waiting,low:basis.value.low,high:basis.value.high,neededRateLow:capacity>0?bestNeeded/capacity:null,neededRateHigh:capacity>0?needed/capacity:null,issues,strategies,message:kind==='already'?'현재 점수와 출석 가정에서는 목표 총점에 닿습니다. 확정 등급은 아닙니다.':kind==='impossible'?'남은 평가를 모두 만점으로 받아도 현재 점수·출석 가정에서는 목표 총점에 닿지 않습니다.':kind==='waiting'?'앞으로 진행할 평가가 없고 채점 대기 결과에 따라 달라집니다.':issues.length?issues.join(' '):waiting>0?'채점 대기 배점의 결과를 0~만점으로 남겼습니다. 필요한 점수도 범위이며 만점 초과 조건은 불가능합니다.':'현재 출석 추정이 유지된다는 조건의 목표 점수 조합입니다.'};
}
