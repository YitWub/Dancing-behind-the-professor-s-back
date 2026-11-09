import type { ManagedCourse } from './management-types.ts';
import { policyCaps } from './grading-policy.ts';
import { prepareAttendanceEstimate, confirmedAttendanceBalance } from './attendance-estimate.ts';

/** Maximum-entropy distribution on [0,1] constrained by the supplied mean.
 * This is an explicit scenario, never a measured class distribution or probability of a grade.
 */
export function meanOnlyPercentile(score:number,mean:number):number {
  if(!Number.isFinite(score)||!Number.isFinite(mean)||score<0||score>1||mean<0||mean>1)throw new RangeError('점수·평균은 0~1이어야 합니다.');
  if(mean===0)return score===0?.5:1;
  if(mean===1)return score===1?.5:0;
  const expected=(k:number)=>Math.abs(k)<1e-5?.5+k/12:1/(1-Math.exp(-k))-1/k;
  let lo=-10000,hi=10000;
  for(let i=0;i<90;i++){const mid=(lo+hi)/2;if(expected(mid)<mean)lo=mid;else hi=mid;}
  const k=(lo+hi)/2;
  if(Math.abs(k)<1e-5)return score;
  if(k>0)return Math.exp(k*(score-1))*(-Math.expm1(-k*score))/(-Math.expm1(-k));
  return Math.expm1(k*score)/Math.expm1(k);
}

/** Invert the very same scenario used by the headline; never a guaranteed raw cutoff. */
export function relativeGoal(course:ManagedCourse,grade:string) {
  const caps=policyCaps(course);
  const cut=caps?({'A+':caps.a/2,A0:caps.a,'B+':caps.a+(caps.ab-caps.a)/2,B0:caps.ab} as Record<string,number>)[grade]:undefined;
  const base=relativeOutlook(course);
  const attendanceId=prepareAttendanceEstimate(course).value.assessmentId;
  const exams=course.assessments.filter((a)=>a.id!==attendanceId&&!a.assignmentGroup&&!/과제|assignment|homework|project|프로젝트/i.test(a.name)&&a.weight>0&&a.progress?.status==='scheduled');
  const final=exams.find((a)=>/기말|final/i.test(a.name))??exams[0];
  if(cut===undefined)return {kind:'unavailable' as const,message:'C·D계열의 세부 배분 기준이 없어 필요한 점수를 임의로 계산하지 않습니다.'};
  if(!base.ok)return {kind:'unavailable' as const,message:base.message};
  if(!final)return {kind:'unavailable' as const,message:'앞으로 치를 시험이 없습니다. 채점 대기는 목표 점수로 바꿀 수 있는 평가가 아닙니다.'};
  const full=relativeOutlook(course,{finalId:final.id,score:final.maxScore});
  if(!full.ok)return {kind:'unavailable' as const,message:full.message};
  if(full.top>cut+1e-9)return {kind:'impossible' as const,message:`${final.name}을 만점으로 받아도 이 시험 중심 가정에서는 목표 구간에 닿지 않습니다. 실제 최종 학점 불가 판정은 아닙니다.`};
  let lo=0,hi=final.maxScore;
  for(let i=0;i<55;i++){const mid=(lo+hi)/2;const result=relativeOutlook(course,{finalId:final.id,score:mid});if(result.ok&&result.top<=cut+1e-9)hi=mid;else lo=mid;}
  // Display an upward-rounded whole raw point, rather than a falsely precise cutoff.
  const required=Math.min(final.maxScore,Math.ceil(hi-1e-7));
  const known=course.assessments.filter((a)=>a.id!==attendanceId&&!a.assignmentGroup&&!/과제|assignment|homework|project|프로젝트/i.test(a.name)&&a.weight>0&&a.mean!==null&&(a.progress?.status==='graded'||a.progress?.status==='zero_confirmed'));
  const assumedMean=final.mean??final.maxScore*known.reduce((s,a)=>s+a.weight*a.mean!/a.maxScore,0)/known.reduce((s,a)=>s+a.weight,0);
  return {kind:'plan' as const,message:'다른 시험은 현재 상대 위치를 유지한다는 조건의 도전 플랜입니다.',name:final.name,assessmentId:final.id,required,maxScore:final.maxScore,cut,mean:assumedMean,rawBoundary:hi,assumedMean:full.assumedMean,already:base.top<=cut+1e-9};
}

export function relativeOutlook(course:ManagedCourse,options:{finalId?:string;score?:number;extraAbsences?:number}={}) {
  const caps=policyCaps(course);
  if(!caps)return {ok:false as const,message:'상대평가 방식을 먼저 확인해 주세요.'};
  const attendanceId=prepareAttendanceEstimate(course).value.assessmentId;
  const exams=course.assessments.filter((a)=>a.id!==attendanceId&&!a.assignmentGroup&&!/과제|assignment|homework|project|프로젝트/i.test(a.name)&&a.weight>0);
  const known=exams.filter((a)=>a.mean!==null&&(a.progress?.status==='graded'||a.progress?.status==='zero_confirmed'));
  if(!known.length)return {ok:false as const,message:'점수가 확정된 시험에 반 평균을 입력하면 상대평가 간이 전망을 볼 수 있어요.'};
  const weight=known.reduce((s,a)=>s+a.weight,0);
  const baseline=known.reduce((s,a)=>s+a.weight*meanOnlyPercentile(a.progress!.status==='graded'?a.progress!.score/a.maxScore:0,a.mean!/a.maxScore),0)/weight;
  const averageMean=known.reduce((s,a)=>s+a.weight*a.mean!/a.maxScore,0)/weight;
  const attendance=prepareAttendanceEstimate(course).value;
  attendance.absences+=options.extraAbsences??0;
  const recordedAttendance=confirmedAttendanceBalance({...course,attendanceEstimate:attendance});
  // Comparison assumption: peers retain full attendance credit. Convert the same
  // recorded total-point loss to exam-equivalent points, without charging it again.
  const attendanceLoss=recordedAttendance.lost+(attendance.confirmed?.finalDeduction??0);
  const examWeight=exams.reduce((s,a)=>s+a.weight,0);
  const shift=examWeight>0?attendanceLoss/(100*examWeight):0;
  let sum=0,total=0;let assumedMean=false;
  for(const a of exams){
    const observed=known.includes(a);
    let position=baseline;
    if(observed)position=meanOnlyPercentile(a.progress!.status==='graded'?a.progress!.score/a.maxScore:0,a.mean!/a.maxScore);
    else if(a.id===options.finalId&&options.score!==undefined){assumedMean=a.mean===null;position=meanOnlyPercentile(options.score/a.maxScore,a.mean===null?averageMean:a.mean/a.maxScore);}
    if(shift>0){
      const mean=a.mean===null?averageMean:a.mean/a.maxScore;
      let low=0,high=1;
      for(let i=0;i<34;i++){const mid=(low+high)/2;if(meanOnlyPercentile(mid,mean)<position)low=mid;else high=mid;}
      position=meanOnlyPercentile(Math.max(0,(low+high)/2-shift),mean);
    }
    sum+=a.weight*position;total+=a.weight;
  }
  const top=1-sum/total;
  const cuts=[{label:'A+',cut:caps.a/2},{label:'A0',cut:caps.a},{label:'B+',cut:caps.a+(caps.ab-caps.a)/2},{label:'B0',cut:caps.ab}];
  const label=cuts.find((c)=>top<=c.cut+1e-9)?.label??'C계열 이하';
  const boundary=cuts.some((c)=>Math.abs(c.cut-top)<=.025);
  return {ok:true as const,label,top,boundary,assumedMean,examCount:known.length,attendanceLoss,
    explanation:'시험 평균과 만점에 따른 분포, 미완료 시험의 현재 상대 위치 유지, A·B 상한 사용 및 +/0 반반을 가정합니다. 다른 학생의 출석은 만점으로 두고 내 출석 감점을 시험 환산점수에 반영한 비교입니다. 실제 등수나 확정 등급이 아닙니다.'};
}
