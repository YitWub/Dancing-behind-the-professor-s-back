import test from 'node:test';
import assert from 'node:assert/strict';
import { newCourse } from '../course-validation.ts';
import { migrateV1Courses } from '../management.ts';
import { prepareAttendanceEstimate } from '../attendance-estimate.ts';
import { officialPolicy, GRADE_CUTOFFS } from '../grading-policy.ts';
import { headlineForecast, forecastActions, gradeActionPlan } from '../dashboard-insights.ts';
import { computeManagedBalance } from '../managed-balance.ts';

function course(){
 const r=migrateV1Courses([{...newCourse('dashboard'),name:'대시보드',enrolled:40}]);assert.ok(r.ok);
 const c=r.value[0];
 c.assessments=c.assessments.map((a,i)=>({id:a.id,name:['중간고사','기말고사','과제','출석'][i],weight:[.3,.4,.2,.1][i],maxScore:100,mean:null,stdev:null,ceilingClustered:i>=2,progress:i===0?{status:'graded',score:80}:{status:'scheduled'}}));
 c.attendanceEstimate=prepareAttendanceEstimate(c).value;c.gradingPolicy=officialPolicy('absolute');return c;
}
test('headline explains current-rate grade and actionable final/absence comparisons without changing records',()=>{
 const c=course(),original=structuredClone(c),balance=computeManagedBalance(c);
 const {base,exams,absence}=forecastActions(c);assert.ok(base.ok);assert.equal(base.label,'B0');assert.equal(base.score,82);
 const ninety=exams.find((e)=>e.score===90)!.result;assert.ok(ninety.ok);assert.equal(ninety.label,'B+');assert.equal(ninety.score,86);
 assert.ok(absence.ok);assert.ok(Math.abs(base.score-absence.score-10/15)<1e-8);
 assert.deepEqual(c,original);assert.deepEqual(computeManagedBalance(c),balance);
});
test('no recorded results means no invented grade, zero is a real recorded result',()=>{
 const c=course();c.assessments[0].progress={status:'scheduled'};assert.equal(headlineForecast(c).ok,false);
 c.assessments[0].progress={status:'graded',score:0};const f=headlineForecast(c);assert.ok(f.ok);assert.equal(f.label,'F');assert.equal(f.rate,0);
});
test('midterm-only record projects final and untouched assignments instead of grading secured subtotal',()=>{
 const c=course();c.assessments[0].progress={status:'graded',score:90};const f=headlineForecast(c);assert.ok(f.ok);
 assert.equal(f.score,91);assert.equal(f.label,'A0');
 assert.deepEqual(f.projections.map((p)=>[p.name,p.score]),[['기말고사',90],['과제',90]]);
 assert.match(f.projections[1].basis,/같은 종류 기록 없음/);
 const actual=computeManagedBalance(c);assert.ok(actual.ok);assert.equal(actual.value.balance.secured,37);
});
test('partial assignment completion uses its own average, final uses midterm average, raw scales respected',()=>{
 const c=course();c.assessments[0].maxScore=50;c.assessments[0].progress={status:'graded',score:45};
 c.assessments[2].assignmentGroup={allocation:'equal',tasks:[{id:'done',name:'완료',maxScore:20,weight:null,progress:{status:'graded',score:12}},{id:'later',name:'남은 과제',maxScore:50,weight:null,progress:{status:'scheduled'}}]};
 const original=structuredClone(c);const f=headlineForecast(c);assert.ok(f.ok);
 assert.equal(f.score,85);assert.equal(f.label,'B+');
 assert.equal(f.projections.find((p)=>p.name==='기말고사')!.score,90);
 assert.equal(f.projections.find((p)=>p.name.includes('남은 과제'))!.score,30);
 assert.deepEqual(c,original);
});
test('confirmed zero remains lost; future work is projected rather than silently changing the zero',()=>{
 const c=course();c.assessments[2].assignmentGroup={allocation:'equal',tasks:[{id:'miss',name:'미제출',maxScore:100,weight:null,progress:{status:'zero_confirmed',reason:'not_submitted'}},{id:'future',name:'다음 과제',maxScore:100,weight:null,progress:{status:'scheduled'}}]};
 const f=headlineForecast(c);assert.ok(f.ok);assert.equal(f.projections.find((p)=>p.name.includes('다음 과제'))!.score,0);assert.equal(f.projections.find((p)=>p.name==='기말고사')!.score,80);
});
test('waiting result hypothesis is disclosed, never turned into an actionable future task',()=>{
 const c=course();c.assessments[2].progress={status:'awaiting_grade'};
 const f=headlineForecast(c);assert.ok(f.ok);assert.equal(f.waiting,true);assert.equal(f.score,82);
 const p=gradeActionPlan(c,'A0').plan;assert.equal(p.kind,'plan');if(p.kind==='plan'){assert.equal(p.waiting,20);assert.ok(p.strategies.every((s)=>s.rows.every((r)=>r.assessmentId!==c.assessments[2].id)));}
 assert.equal(c.assessments[2].progress.status,'awaiting_grade');
});
test('relative grade comparison uses explicit benchmark, never fabricated individual probability',()=>{
 const c=course();c.gradingPolicy=officialPolicy('relative1');const copy=structuredClone(c);
 const f=headlineForecast(c);assert.ok(f.ok);assert.match(f.basis,/간이 추정/);assert.equal(f.label,'평균 입력 필요');assert.deepEqual(f.scenario.families,[]);
 const p=gradeActionPlan(c,'A0');assert.equal(p.benchmark,false);assert.equal(p.cut,undefined);assert.equal(p.plan.kind,'unavailable');assert.deepEqual(c,copy);
});
test('goal actions preserve professor criteria and compute task-first relief',()=>{
 const c=course();const {plan}=gradeActionPlan(c,'A0');assert.equal(plan.kind,'plan');if(plan.kind==='plan'){
 assert.equal(plan.strategies[0].rows.find((r)=>r.kind==='exam')!.high,93.34);
 assert.equal(plan.strategies[1].rows.find((r)=>r.kind==='exam')!.high,90);
 }
 c.gradingPolicy={...officialPolicy('absolute'),source:'custom',absoluteCutoffs:{...GRADE_CUTOFFS,A0:92}};assert.equal(gradeActionPlan(c,'A0').cut,92);
 assert.equal(gradeActionPlan(c,'A+').plan.kind,'impossible');
});
test('invalid scores and unsupported scenario edits are rejected; PF has no invented threshold',()=>{
 const c=course();assert.equal(headlineForecast(c,{finalId:c.assessments[1].id,score:101}).ok,false);assert.equal(headlineForecast(c,{extraAbsences:-1}).ok,false);
 c.assessments[0].progress={status:'graded',score:101};assert.equal(headlineForecast(c).ok,false);
 const pf=course();pf.gradingPolicy=officialPolicy('pass_fail');const f=headlineForecast(pf);assert.ok(f.ok);assert.equal(f.label,'기준 확인');assert.equal(gradeActionPlan(pf,'P').plan.kind,'unavailable');
});
