import test from 'node:test';
import assert from 'node:assert/strict';
import { newCourse } from '../course-validation.ts';
import { migrateV1Courses, validateManagedCourse } from '../management.ts';
import { prepareAttendanceEstimate } from '../attendance-estimate.ts';
import { officialPolicy, resolvePolicy, policyCaps, gradeForScore, targetCut, GRADE_CUTOFFS } from '../grading-policy.ts';
import { planGoal, courseOutlook, projectRemaining, planningUnits } from '../grade-planner.ts';
import { computeManagedBalance } from '../managed-balance.ts';
import { saveManagedCourses, loadManagedCourses } from '../managed-storage.ts';

function course(){const r=migrateV1Courses([{...newCourse('policy'),name:'프리셋 플래너',enrolled:40}]);assert.ok(r.ok);const c=r.value[0];c.assessments=c.assessments.map((a,i)=>({id:a.id,name:a.name,weight:[.3,.3,.3,.1][i],maxScore:100,mean:i<2?70:null,stdev:i<2?10:null,ceilingClustered:i>=2,progress:i===0?{status:'graded',score:80}:{status:'scheduled'}}));c.attendanceEstimate=prepareAttendanceEstimate(c).value;return c;}
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('official relative presets are family caps, not probabilities or plus/zero splits',()=>{
  for(const [kind,a,ab] of [['relative1',.3,.7],['relative2',.4,.8],['relative3',.5,.9]] as const){const c=course();c.gradingPolicy=officialPolicy(kind);assert.deepEqual(policyCaps(c),{a,ab});const outlook=courseOutlook(c);const current=outlook.scenarios.find((s)=>s.label==='현재 기록 득점률 유지 가정')!;assert.ok(current.result.ok);assert.deepEqual(current.result.value.families.map((f)=>f.family),['A','B']);assert.ok(current.result.value.families.every((f)=>!f.label.includes('+')));assert.notEqual(current.result.value.families[0].probability,a);assert.equal(targetCut(c,'A0'),undefined);assert.equal(planGoal(c,{kind:'grade',grade:'A0'}).kind,'unavailable');}
});
test('official absolute thresholds and teacher overrides have distinct provenance',()=>{
  const c=course();c.gradingPolicy=officialPolicy('absolute');
  for(const [g,n] of Object.entries(GRADE_CUTOFFS)){assert.equal(gradeForScore(c,n),g);assert.equal(targetCut(c,g),n);}assert.equal(gradeForScore(c,59.9),'F');
  c.gradingPolicy={...officialPolicy('absolute'),source:'custom',absoluteCutoffs:{...GRADE_CUTOFFS,'A+':98,A0:92}};assert.equal(gradeForScore(c,95),'A0');assert.equal(targetCut(c,'A0'),92);assert.deepEqual(validateManagedCourse(c),[]);
  const invalid={...c,gradingPolicy:{...c.gradingPolicy,source:'official'}};assert.ok(validateManagedCourse(invalid).length);
});
test('unknown legacy relative data never silently becomes relative1; legacy explicit absolute cuts remain usable',()=>{
  const c=course();assert.equal(resolvePolicy(c).kind,'unknown');assert.equal(projectRemaining(c,.8).ok,true);const r=projectRemaining(c,.8);assert.ok(r.ok);assert.equal(r.value.families.length,0);
  c.isAbsolute=true;c.absoluteTargets={A0:88};assert.equal(resolvePolicy(c).source,'custom');assert.equal(targetCut(c,'A0'),88);assert.equal(targetCut(c,'A+'),undefined);
  c.gradingPolicy=officialPolicy('unknown');assert.equal(targetCut(c,'A0'),undefined);
});
test('P/F never borrows S/U or letter-grade thresholds and can use an explicit course pass mark',()=>{
  const c=course();c.gradingPolicy=officialPolicy('pass_fail');assert.equal(targetCut(c,'P'),undefined);assert.equal(gradeForScore(c,100),null);assert.equal(planGoal(c,{kind:'grade',grade:'P'}).kind,'unavailable');
  c.gradingPolicy={...c.gradingPolicy,source:'custom',passScore:60};assert.equal(gradeForScore(c,60),'P');assert.equal(gradeForScore(c,59),'F');assert.equal(planGoal(c,{kind:'grade',grade:'P'}).kind,'plan');const r=projectRemaining(c,.8);assert.ok(r.ok);assert.deepEqual(r.value.families,[]);
});
test('balanced, assignment-first and exam-first invert multiple remaining weights and unequal raw scales',()=>{
  const c=course();c.gradingPolicy=officialPolicy('absolute');c.assessments[2].assignmentGroup={allocation:'equal',tasks:[{id:'t1',name:'과제1',maxScore:20,weight:null,progress:{status:'graded',score:16}},{id:'t2',name:'과제2',maxScore:20,weight:null,progress:{status:'scheduled'}}]};
  const plan=planGoal(c,{kind:'grade',grade:'B+'});assert.equal(plan.kind,'plan');if(plan.kind!=='plan')return;
  close(plan.needed,39);close(plan.capacity,45);close(plan.neededRateHigh!,39/45);
  const balanced=plan.strategies[0],tasks=plan.strategies[1],exams=plan.strategies[2];
  close(tasks.rows.find((r)=>r.kind==='assignment')!.high,20);close(tasks.rows.find((r)=>r.kind==='exam')!.high,80);
  close(exams.rows.find((r)=>r.kind==='exam')!.high,100);close(exams.rows.find((r)=>r.kind==='assignment')!.high,12);
  for(const s of [balanced,tasks,exams]){const added=s.rows.reduce((n,r)=>n+r.points*r.high/r.maxScore,0);assert.ok(46+added>=85-1e-8);assert.ok(s.rows.every((r)=>r.high<=r.maxScore));}
});
test('single remaining exam, unattainable targets and already-met targets are handled without requiring a hypothetical score',()=>{
  const c=course();c.gradingPolicy=officialPolicy('absolute');c.assessments[2].progress={status:'graded',score:100};
  const p=planGoal(c,{kind:'grade',grade:'A0'});assert.equal(p.kind,'plan');if(p.kind==='plan'){close(p.needed,26);close(p.strategies[0].rows[0].high,86.67);}
  assert.equal(planGoal(c,{kind:'grade',grade:'A+'}).kind,'impossible');assert.equal(planGoal(c,{kind:'points',points:60}).kind,'already');
});
test('waiting results are not future effort or assumed zero; unallocated groups withhold invented task targets',()=>{
  const c=course();c.gradingPolicy=officialPolicy('absolute');c.assessments[2].progress={status:'awaiting_grade'};
  const p=planGoal(c,{kind:'points',points:85});assert.equal(p.kind,'plan');if(p.kind==='plan'){close(p.waiting,30);close(p.bestNeeded,21);close(p.needed,51);assert.equal(p.strategies[0].rows.length,1);assert.ok(p.strategies[0].rows[0].high>100);}
  c.assessments[2].assignmentGroup={allocation:'unconfirmed',tasks:[{id:'x',name:'미설정',maxScore:100,weight:null,progress:{status:'scheduled'}}]};assert.equal(planGoal(c,{kind:'points',points:85}).kind,'unavailable');assert.ok(planningUnits(c).issues.length);
});
test('no-stat relative courses still have target-total plans; current-rate scenarios require actual completed work',()=>{
  const c=course();c.gradingPolicy=officialPolicy('relative2');for(const a of c.assessments){a.mean=null;a.stdev=null;}
  const outlook=courseOutlook(c);close(outlook.recordedRate!,.8);for(const s of outlook.scenarios){assert.ok(s.result.ok);assert.deepEqual(s.result.value.families,[]);}
  assert.equal(planGoal(c,{kind:'points',points:85}).kind,'plan');c.assessments[0].progress={status:'scheduled'};assert.equal(courseOutlook(c).recordedRate,null);assert.equal(courseOutlook(c).scenarios.length,2);
});
test('policy changes, projections and planner never mutate actual grades, HP or stored records',()=>{
  const c=course();c.gradingPolicy=officialPolicy('absolute');const original=structuredClone(c),hp=computeManagedBalance(c);
  const data=new Map<string,string>();const store={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);}};
  const s=saveManagedCourses([c],null,()=>store);assert.ok(s.ok);courseOutlook(c);planGoal(c,{kind:'grade',grade:'A0'});projectRemaining(c,.9);assert.deepEqual(c,original);assert.deepEqual(computeManagedBalance(c),hp);
  const loaded=loadManagedCourses(()=>store);assert.ok(loaded.ok);assert.deepEqual(loaded.value.courses,[original]);const next={...c,gradingPolicy:officialPolicy('relative3')};assert.ok(saveManagedCourses([next],s.value.snapshot,()=>store).ok);assert.deepEqual(next.assessments,original.assessments);
});
test('invalid caps, custom cuts and pass marks are rejected',()=>{
  const c=course();for(const p of [{...officialPolicy('relative1'),source:'custom',relativeCaps:{a:.8,ab:.7}},{...officialPolicy('absolute'),source:'custom',absoluteCutoffs:{'A+':80,A0:90}},{...officialPolicy('pass_fail'),source:'custom',passScore:101},{...officialPolicy('relative2'),presetVersion:'old'}])assert.ok(validateManagedCourse({...c,gradingPolicy:p}).length);
});

test('existing confirmed attendance bounds and zero-point goals survive hypothetical projections',()=>{
  const c=course();c.gradingPolicy=officialPolicy('absolute');c.attendanceEstimate!.confirmed={weight:10,secured:4,lost:2,ungraded:0,finalDeduction:0};
  let r=projectRemaining(c,1);assert.ok(r.ok);close(r.value.low,92);
  c.attendanceEstimate!.absences=15;r=projectRemaining(c,1);assert.ok(r.ok);close(r.value.low,84);
  c.attendanceEstimate!.confirmed.finalDeduction=100;assert.equal(planGoal(c,{kind:'points',points:0}).kind,'already');
});

test('an actual current rank can inform current outlook but is never frozen as a hypothetical final rank',()=>{
  const c=course();c.gradingPolicy=officialPolicy('relative2');c.myRank=3;for(const a of c.assessments){a.mean=null;a.stdev=null;}
  const current=courseOutlook(c);assert.ok(current.base.ok);assert.ok(current.base.value.families.length);
  const projected=projectRemaining(c,.9);assert.ok(projected.ok);assert.deepEqual(projected.value.families,[]);assert.equal(c.myRank,3);
});
