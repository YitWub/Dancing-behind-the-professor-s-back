import test from 'node:test';
import assert from 'node:assert/strict';
import { newCourse } from '../course-validation.ts';
import { migrateV1Courses, toEngineCourse, validateManagedCourse } from '../management.ts';
import { prepareAttendanceEstimate, estimateAttendance, estimateChangeMessages } from '../attendance-estimate.ts';
import { computeManagedBalance } from '../managed-balance.ts';
import { loadManagedCourses, saveManagedCourses, prepareV1Migration, saveV1Migration } from '../managed-storage.ts';
import { saveCourses, COURSE_STORAGE_KEY } from '../course-storage.ts';
import type { ManagedCourse } from '../management-types.ts';

function base():ManagedCourse {
  const r=migrateV1Courses([{...newCourse('estimate'),name:'출석 간이 추정'}]);assert.ok(r.ok);
  const c=r.value[0];c.assessments=c.assessments.map((a)=>({...a,progress:{status:'scheduled'},reviewRequired:undefined}));
  for(const a of c.assessments)delete a.reviewRequired;
  return c;
}
function course(){const c=base();c.attendanceEstimate=prepareAttendanceEstimate(c).value;return c;}
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
function storage(){const data=new Map<string,string>();return {data,getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);}};}

test('15 equal sessions: zero absence full estimate, one absence deduction and 3/15 gives 8/10',()=>{
  const c=course();close(estimateAttendance(c).score,10);
  c.attendanceEstimate!.absences=1;close(estimateAttendance(c).deduction,10/15);
  c.attendanceEstimate!.absences=3;close(estimateAttendance(c).score,8);
  c.attendanceEstimate!.absences=20;close(estimateAttendance(c).score,0);
});
test('lateness uses integer groups of three and caution is conditional at 5/6',()=>{
  const c=course();c.attendanceEstimate!.lateness=2;close(estimateAttendance(c).score,10);
  c.attendanceEstimate!.lateness=3;assert.equal(estimateAttendance(c).effectiveAbsences,1);
  c.attendanceEstimate!.lateness=0;c.attendanceEstimate!.absences=4;assert.equal(estimateAttendance(c).caution,'warning');
  c.attendanceEstimate!.absences=5;assert.equal(estimateAttendance(c).caution,'boundary');
  c.attendanceEstimate!.absences=6;assert.equal(estimateAttendance(c).caution,'below_reference');
});

test('configurable sessions preserve old default and calculate 15/16/30/32 boundaries without credit inference',()=>{
  const c=course();c.credits=1;c.attendanceEstimate!.absences=3;
  close(estimateAttendance(c).score,8);assert.equal(estimateAttendance(c).totalSessions,15);
  for(const n of [15,16,30,32]) {
    c.attendanceEstimate!.totalSessions=n;
    const r=estimateAttendance(c);close(r.score,10*(1-3/n));assert.equal(r.minimumAttendance,Math.ceil(n*2/3));assert.equal(r.allowedAbsences,n-Math.ceil(n*2/3));
    c.attendanceEstimate!.absences=r.allowedAbsences;assert.equal(estimateAttendance(c).caution,'boundary');
    c.attendanceEstimate!.absences++;assert.equal(estimateAttendance(c).caution,'below_reference');assert.ok(estimateAttendance(c).score>0,'attendance risk is not zero score');
    c.attendanceEstimate!.absences=3;
  }
  c.attendanceEstimate!.absences=0;
  for(const late of [2,3,6]){c.attendanceEstimate!.lateness=late;assert.equal(estimateAttendance(c).effectiveAbsences,Math.floor(late/3));}
  for(const n of [0,-1,1.5,NaN,Infinity])assert.ok(validateManagedCourse({...c,attendanceEstimate:{...c.attendanceEstimate,totalSessions:n}}).length);
});
test('zero-weight or absent attendance keeps records without a fictitious grade',()=>{
  const c=course();c.assessments[3].weight=0;c.assessments[1].weight=.5;c.attendanceEstimate!.absences=6;
  assert.deepEqual(validateManagedCourse(c),[]);close(estimateAttendance(c).maximum,0);assert.equal(estimateAttendance(c).caution,'below_reference');
  c.assessments.pop();c.attendanceEstimate!.assessmentId=null;assert.deepEqual(validateManagedCourse(c),[]);close(estimateAttendance(c).score,0);
});
test('estimated score/loss never enter actual HP and do not overwrite exams or grouped assignments',()=>{
  const c=course();c.assessments[0].progress={status:'graded',score:80};
  c.assessments[2].assignmentGroup={allocation:'equal',tasks:[{id:'t1',name:'과제 1',maxScore:100,weight:null,progress:{status:'graded',score:80}},{id:'t2',name:'과제 2',maxScore:100,weight:null,progress:{status:'scheduled'}}]};
  const before=computeManagedBalance(c);assert.ok(before.ok);
  c.attendanceEstimate!.absences=3;const after=computeManagedBalance(c);assert.ok(after.ok);
  assert.deepEqual(after,before);close(after.value.balance.secured,32);close(Object.values(after.value.balance).reduce((a,b)=>a+b,0),100);
  assert.equal(toEngineCourse(c).ok,false);
});
test('legacy per-session credit and final deduction are preserved separately on confirmed conversion',()=>{
  const c=base();c.attendanceManagement={assessmentId:c.assessments[3].id,records:{total:30,held:15,absences:2,lateness:3,excused:1},penalty:{kind:'attendance_points',pointsPerAbsence:2},latePenalty:{kind:'bundled',perAbsence:3},excusedForScore:'recognized',allocation:'per_session_equal',eligibility:{rule:{kind:'max_absences',allowed:6,failureAt:'exceeds'},unit:'sessions',excused:'recognized',late:{kind:'bundled',perAbsence:3},hours:null}};
  const original=structuredClone(c);const before=computeManagedBalance(c);assert.ok(before.ok);
  const p=prepareAttendanceEstimate(c);assert.ok(p.review.some((m)=>m.includes('공결')));c.attendanceEstimate=p.value;
  const after=computeManagedBalance(c);assert.ok(after.ok);assert.deepEqual(after.value.balance,before.value.balance);assert.deepEqual(c.attendanceManagement,original.attendanceManagement);
  close(after.value.balance.secured,4.4);close(after.value.balance.lost,.6);
  c.attendanceEstimate.absences=10;const changed=computeManagedBalance(c);assert.ok(changed.ok);assert.deepEqual(changed.value.balance,after.value.balance);
  assert.ok(estimateChangeMessages([original],[c]).length);
});
test('direct graded zero and actual grades survive while a missing legacy score is never converted to zero',()=>{
  for(const score of [0,80]){const c=base();c.assessments[3].progress={status:'graded',score};c.attendanceEstimate=prepareAttendanceEstimate(c).value;const b=computeManagedBalance(c);assert.ok(b.ok);close(b.value.balance.secured,score/10);close(b.value.balance.lost,10-score/10);}
  const c=base();c.assessments[3]={...c.assessments[3],progress:null,reviewRequired:'legacy_null_score'};c.attendanceEstimate=prepareAttendanceEstimate(c).value;const b=computeManagedBalance(c);assert.ok(b.ok);close(b.value.balance.lost,0);close(b.value.balance.remaining,100);
});
test('migration saves only v2, needs confirmation, retains v1/old settings and failed saves retain source and draft',()=>{
  const store=storage();const v1={...newCourse('estimate'),name:'기존 과목',attendance:{totalSessions:30,absences:2,lateness:3,allowedAbsences:6,penaltyPerAbsence:.2,latePerAbsence:3}};
  assert.ok(saveCourses([v1],null,()=>store).ok);const raw=store.getItem(COURSE_STORAGE_KEY);
  const preview=prepareV1Migration(()=>store);assert.ok(preview.ok);const c=preview.value.courses[0];c.attendanceEstimate=prepareAttendanceEstimate(c).value;
  assert.equal(c.attendanceEstimate.absences,2);assert.equal(c.attendanceEstimate.lateness,3);
  const first=saveV1Migration(preview.value,()=>store);assert.ok(first.ok);assert.equal(store.getItem(COURSE_STORAGE_KEY),raw);
  const loaded=loadManagedCourses(()=>store);assert.ok(loaded.ok);assert.deepEqual(loaded.value.courses[0].attendance,v1.attendance);
  const draft=structuredClone(c);draft.attendanceEstimate!.absences=4;
  assert.equal(saveManagedCourses([draft],first.value.snapshot,()=>({...store,setItem:()=>{throw new Error('quota');}})).ok,false);
  assert.deepEqual(loadManagedCourses(()=>store),loaded);assert.equal(draft.attendanceEstimate!.absences,4);
  assert.ok(saveManagedCourses([draft],first.value.snapshot,()=>store).ok);const restored=loadManagedCourses(()=>store);assert.ok(restored.ok);assert.equal(restored.value.courses[0].attendanceEstimate!.absences,4);
});
test('legacy v2 conversion cannot silently replace data and malformed estimates are blocked',()=>{
  const old=base();old.attendanceNotes={absences:2,lateness:1,excused:1};const next=structuredClone(old);next.attendanceEstimate=prepareAttendanceEstimate(old).value;
  const store=storage();const first=saveManagedCourses([old],null,()=>store);assert.ok(first.ok);
  assert.equal(saveManagedCourses([next],first.value.snapshot,()=>store).ok,false);assert.ok(saveManagedCourses([next],first.value.snapshot,()=>store,false,true).ok);
  for(const patch of [{absences:-1},{lateness:1.2},{model:'other'},{assessmentId:'foreign'},{confirmed:{weight:10,secured:11,lost:0,ungraded:0,finalDeduction:null}}])assert.ok(validateManagedCourse({...next,attendanceEstimate:{...next.attendanceEstimate,...patch}}).length);
});
