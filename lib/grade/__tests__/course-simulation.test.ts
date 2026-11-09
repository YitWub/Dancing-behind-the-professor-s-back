import test from 'node:test';
import assert from 'node:assert/strict';
import { newCourse } from '../course-validation.ts';
import { migrateV1Courses, validateManagedCourse } from '../management.ts';
import { prepareAttendanceEstimate } from '../attendance-estimate.ts';
import { simulateCourse, analyzeTarget } from '../course-simulation.ts';
import { computeManagedBalance } from '../managed-balance.ts';
import { saveManagedCourses, loadManagedCourses } from '../managed-storage.ts';

function course() {
  const r=migrateV1Courses([{...newCourse('scenario'),name:'성적 전략',enrolled:40}]);assert.ok(r.ok);const c=r.value[0];
  c.assessments=c.assessments.map((a,i)=>({id:a.id,name:a.name,weight:a.weight,maxScore:100,mean:i<2?70:null,stdev:i<2?10:null,ceilingClustered:i>=2,progress:i===0?{status:'graded',score:80}:i===2?{status:'graded',score:100}:{status:'scheduled'}}));
  c.attendanceEstimate=prepareAttendanceEstimate(c).value;return c;
}
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function run(c=course(),score=80,extraAbsences=0){const r=simulateCourse(c,{assessmentId:c.assessments[1].id,score,extraAbsences});assert.ok(r.ok,r.ok?'':r.errors.join(' '));return r.value;}

test('final 70/80/90 scenarios use real weights, deterministic predictions and preserve actual HP/source',()=>{
  const c=course();c.gradingPolicy={kind:'relative1',source:'official',presetVersion:'erica-2026-11-07'};const source=JSON.stringify(c);const hp=computeManagedBalance(c);
  for(const [score,total] of [[70,82],[80,86],[90,90]]){const r=run(c,score);close(r.low,total);close(r.high,total);close(r.unknownPoints,0);assert.ok(r.families.length);assert.equal(r.distribution,null);}
  const p70=run(c,70).families.find((d)=>d.family==='A')!.probability,p90=run(c,90).families.find((d)=>d.family==='A')!.probability;
  assert.ok(p90>=p70);assert.deepEqual(run(c),run(c));assert.equal(JSON.stringify(c),source);assert.deepEqual(computeManagedBalance(c),hp);
});
test('one absence uses same final assumption, changes total by weight/N and only conditional risk',()=>{
  const c=course();const before=run(c);const after=run(c,80,1);close(before.low-after.low,10/15);assert.equal(c.attendanceEstimate!.absences,0);
  c.attendanceEstimate!.totalSessions=30;close(run(c).low-run(c,80,1).low,10/30);
  c.attendanceEstimate!.totalSessions=15;c.attendanceEstimate!.absences=5;assert.equal(run(c).attendance.caution,'boundary');assert.equal(run(c,80,1).attendance.caution,'below_reference');assert.ok(run(c,80,1).low>0);
});
test('awaiting work remains a range; partial and unallocated groups never become fake zeros/independent observations',()=>{
  const c=course();c.assessments[2].progress={status:'awaiting_grade'};let r=run(c);close(r.low,66);close(r.high,86);close(r.unknownPoints,20);
  c.assessments[2].assignmentGroup={allocation:'equal',tasks:[{id:'a1',name:'과제1',maxScore:100,weight:null,progress:{status:'graded',score:80}},{id:'a2',name:'과제2',maxScore:100,weight:null,progress:{status:'scheduled'}}]};
  r=run(c);close(r.low,74);close(r.high,84);assert.equal(r.distribution,null);
  c.assessments[2].assignmentGroup.allocation='unconfirmed';r=run(c);close(r.low,66);close(r.high,86);
});
test('insufficient statistics, absolute grading and small classes do not produce invented probabilities',()=>{
  const c=course();for(const a of c.assessments){a.mean=null;a.stdev=null;}assert.equal(run(c).distribution,null);
  c.isAbsolute=true;assert.equal(run(c).distribution,null);assert.equal(analyzeTarget(c,'A0',c.assessments[1].id).kind,'unavailable');
  const small=course();small.enrolled=20;assert.equal(run(small).distribution,null);
});
test('target exact score requires explicit absolute cutoff and all other contributions; relative minimum is withheld',()=>{
  const c=course();assert.equal(analyzeTarget(c,'A0',c.assessments[1].id).kind,'unavailable');
  c.isAbsolute=true;c.absoluteTargets={'A+':95,A0:90};let target=analyzeTarget(c,'A0',c.assessments[1].id);assert.equal(target.kind,'score');if(target.kind==='score')close(target.required,90);
  assert.equal(analyzeTarget(c,'A+',c.assessments[1].id).kind,'unreachable');
  target=analyzeTarget(c,'A0',c.assessments[1].id,1);assert.equal(target.kind,'score');if(target.kind==='score')close(target.required,91.67);
  c.assessments[2].progress={status:'awaiting_grade'};assert.equal(analyzeTarget(c,'A0',c.assessments[1].id).kind,'unavailable');
  for(const cuts of [{'A+':85,A0:90},{A0:101},{A0:NaN},{F:20}])assert.ok(validateManagedCourse({...c,absoluteTargets:cuts}).length);
});
test('simulation rejects actual graded/waiting exams and invalid inputs instead of silently changing records',()=>{
  const c=course();for(const score of [-1,101,NaN])assert.equal(simulateCourse(c,{assessmentId:c.assessments[1].id,score}).ok,false);
  assert.equal(simulateCourse(c,{assessmentId:c.assessments[0].id,score:80}).ok,false);c.assessments[1].progress={status:'awaiting_grade'};assert.equal(simulateCourse(c,{assessmentId:c.assessments[1].id,score:80}).ok,false);
  assert.equal(simulateCourse(c,{extraAbsences:-1}).ok,false);
});
test('sessions/cutoffs round-trip in v2; running scenarios never writes virtual scores/absences to storage',()=>{
  const c=course();c.attendanceEstimate!.totalSessions=16;c.absoluteTargets={A0:90};
  const data=new Map<string,string>();let writes=0;const storage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{writes++;data.set(k,v);}};
  const saved=saveManagedCourses([c],null,()=>storage);assert.ok(saved.ok);run(c,90,1);analyzeTarget(c,'A0',c.assessments[1].id);
  assert.equal(writes,1);const loaded=loadManagedCourses(()=>storage);assert.ok(loaded.ok);assert.deepEqual(loaded.value.courses,[c]);assert.equal(loaded.value.courses[0].assessments[1].progress?.status,'scheduled');assert.equal(loaded.value.courses[0].attendanceEstimate!.absences,0);
});

test('target inversion respects the final zero clamp and separately confirmed external deductions',()=>{
  const c=course();c.isAbsolute=true;c.absoluteTargets={A0:10};c.attendanceEstimate!.confirmed={weight:10,secured:10,lost:0,ungraded:0,finalDeduction:60};
  const target=analyzeTarget(c,'A0',c.assessments[1].id);assert.equal(target.kind,'score');if(target.kind==='score')close(target.required,40);
  close(run(c,40).low,10);close(run(c,0).low,0);
  assert.equal(run(c,40).distribution,null);
});
