import type { ManagedCourse, AssessmentProgress } from './management-types.ts';
import { headlineForecast } from './dashboard-insights.ts';
import { computeManagedBalance } from './managed-balance.ts';
import { prepareAttendanceEstimate } from './attendance-estimate.ts';
import { resolvePolicy, formatFamilyProbability } from './grading-policy.ts';

export interface ForecastFact {label:string;value:string}
const number=(n:number)=>Number(n.toFixed(2));
/** Presentation only: never adds observations or changes prediction mathematics. */
export function forecastPresentation(course:ManagedCourse) {
  const forecast=headlineForecast(course),actual=computeManagedBalance(course),policy=resolvePolicy(course);
  const attendanceId=prepareAttendanceEstimate(course).value.assessmentId;
  const confirmed:ForecastFact[]=[],assumed:ForecastFact[]=[],unknown:ForecastFact[]=[];
  const record=(name:string,max:number,progress:AssessmentProgress|null)=>{
    if(progress?.status==='graded')confirmed.push({label:name,value:`${number(progress.score)} / ${max}점`});
    else if(progress?.status==='zero_confirmed')confirmed.push({label:name,value:'0점 · 미응시/미제출 확정'});
    else if(progress?.status==='awaiting_grade')unknown.push({label:name,value:'채점 결과 대기'});
    else if(!progress)unknown.push({label:name,value:'진행 상태 확인 필요'});
  };
  for(const a of course.assessments){
    if(a.id===attendanceId)continue;
    if(a.assignmentGroup)for(const task of a.assignmentGroup.tasks)record(`${a.name} · ${task.name}`,task.maxScore,task.progress);
    else record(a.name,a.maxScore,a.progress);
  }
  const attendance=actual.ok?actual.value.items.find((item)=>item.assessmentId===attendanceId):undefined;
  const attendanceWeight=course.assessments.find((a)=>a.id===attendanceId)?.weight??0;
  if(attendance&&attendanceWeight>0)confirmed.push({label:'출석',value:`${number(attendance.balance.secured)} / ${number(attendanceWeight*100)}점 · 결석·지각 반영`});
  const relative=policy.kind.startsWith('relative');
  if(forecast.ok){
    for(const p of forecast.projections)assumed.push({label:p.name,value:`${number(p.score)} / ${p.maxScore}점 · ${p.basis}`});
    if(relative){
      if(course.assessments.some((a)=>a.id!==attendanceId&&!a.assignmentGroup&&!/과제|assignment|homework|project|프로젝트/i.test(a.name)&&a.weight>0&&(a.progress?.status==='scheduled'||a.progress?.status==='awaiting_grade')))assumed.unshift({label:'남은 시험의 위치',value:'지금의 반 내 위치를 유지'});
      assumed.push({label:'등급 나누기',value:'A·B 허용 인원을 모두 사용하고 +/0를 절반씩 배분'});
      unknown.push({label:'다른 수강생',value:'최종 점수와 실제 등수'},{label:'교수님 평가',value:'실제 A+/A0·B+/B0 배분'});
      for(const a of course.assessments)if(a.id!==attendanceId&&!a.assignmentGroup&&!/과제|assignment|homework|project|프로젝트/i.test(a.name)&&a.weight>0&&a.mean===null)unknown.push({label:`${a.name} 반 평균`,value:'아직 입력되지 않음'});
    }
    if(forecast.scenario.usesEstimatedAttendance)assumed.push({label:'출석',value:'현재 결석·지각 기록으로 간이 추정'});
  }
  const grade=forecast.ok&&(relative?forecast.relative?.ok:!['기준 확인','평균 입력 필요'].includes(forecast.label))?forecast.label:null;
  const top=forecast.ok&&forecast.relative?.ok?Math.max(0,Math.min(1,forecast.relative.top)):null;
  const relativePosition=top===null?null:`모형상 상위 ${Math.min(95,Math.floor(top*20)*5)}~${Math.min(100,Math.floor(top*20)*5+5)}% 부근 · 실제 등수 아님`;
  const familyProbabilities=forecast.ok?forecast.scenario.families.map((f)=>({label:f.label,value:formatFamilyProbability(f.probability)})):[];
  const fallback=actual.ok&&actual.value.complete?{
    low:Math.max(0,actual.value.balance.secured-(actual.value.finalDeduction??0)),
    high:Math.max(0,100-actual.value.balance.lost-(actual.value.finalDeduction??0)),
    remaining:actual.value.balance.remaining+actual.value.balance.ungraded,
  }:null;
  const highlight=confirmed.slice(0,1).map((r)=>({...r,kind:'확정'}));
  const preview=assumed.filter((r)=>r.label!=='등급 나누기'&&r.label!=='출석').slice(0,2).map((r)=>({...r,kind:'가정'}));
  const nextInfo=relative?'점수가 나온 시험의 반 평균 하나를 입력해 주세요.':policy.kind==='unknown'?'과목의 평가 방식 하나를 선택해 주세요.':!confirmed.length?'점수가 나온 시험·과제 하나를 기록해 주세요.':'과목의 실제 등급 기준을 확인해 주세요.';
  return {grade,confirmed,assumed,unknown,highlights:[...highlight,...preview].slice(0,3),fallback,projectedScore:forecast.ok?forecast.score:null,relativePosition,familyProbabilities,
    boundary:forecast.ok&&forecast.relative?.ok&&forecast.relative.boundary,
    relative,status:grade?'가정 기반 예측':'점수 범위 확인',nextInfo,
    manyAssumptions:assumed.length>=3,
    weights:course.assessments.map((a)=>({label:a.name,value:`${number(a.weight*100)}%`})),
    allRecorded:confirmed.length>0&&!course.assessments.some((a)=>a.id!==attendanceId&&(a.assignmentGroup?a.assignmentGroup.tasks.some((t)=>t.progress.status==='scheduled'||t.progress.status==='awaiting_grade'):a.progress?.status==='scheduled'||a.progress?.status==='awaiting_grade'||!a.progress)),
  };
}
