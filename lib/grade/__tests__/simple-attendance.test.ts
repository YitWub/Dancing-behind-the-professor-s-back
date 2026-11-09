import test from 'node:test';
import assert from 'node:assert/strict';
import { newCourse } from '../course-validation.ts';
import { migrateV1Courses, validateManagedCourse, toEngineCourse } from '../management.ts';
import type { ManagedCourse } from '../management-types.ts';
import type { SimpleAttendance } from '../attendance-types.ts';
import { computeAttendance, provisionalAttendanceScore, attendanceChangeMessages } from '../attendance.ts';
import { computeManagedBalance } from '../managed-balance.ts';
import { saveManagedCourses, loadManagedCourses, prepareV1Migration, saveV1Migration } from '../managed-storage.ts';
import { COURSE_STORAGE_KEY, saveCourses } from '../course-storage.ts';

function newSimpleAttendance(course: ManagedCourse, mode: SimpleAttendance['mode']): SimpleAttendance {
  if (course.simpleAttendance) return { ...structuredClone(course.simpleAttendance), mode };
  const old = course.attendanceManagement;
  return {
    mode, assessmentId: old?.assessmentId ?? null,
    records: { absences:old?.records.absences??course.attendanceNotes?.absences??course.attendance?.absences??0, lateness:old?.records.lateness??course.attendanceNotes?.lateness??course.attendance?.lateness??0, excused:old?.records.excused??course.attendanceNotes?.excused??0 },
    penalty: structuredClone(old?.penalty ?? { kind: 'unconfirmed' }), rawMaxScore: old?.rawMaxScore ?? course.assessments.find((a) => a.id === old?.assessmentId)?.maxScore ?? 100,
    latePenalty: structuredClone(old?.latePenalty ?? {kind: 'unconfirmed'}), excusedForScore: old?.excusedForScore ?? 'unconfirmed',
    finalized: old ? old.records.total === old.records.held : false,
    eligibility: structuredClone(old?.eligibility ?? { rule: {kind: 'unconfirmed'}, unit: 'sessions', excused: 'unconfirmed', late: {kind: 'unconfirmed'}, hours: null }),
    totalSessions: old?.records.total ?? course.attendance?.totalSessions ?? null,
  };
}

function course() {
  const r=migrateV1Courses([{...newCourse('simple'),name:'간편 출석'}]);assert.ok(r.ok);const c=r.value[0];
  c.assessments=c.assessments.map((a)=>({...a,progress:{status:'scheduled'},reviewRequired:undefined}));
  for(const a of c.assessments)delete a.reviewRequired;
  c.simpleAttendance=newSimpleAttendance(c,'scored');
  c.simpleAttendance.assessmentId=c.assessments[3].id;
  c.simpleAttendance.penalty={kind:'weighted_points',pointsPerAbsence:.2};
  return c;
}
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
function result(c=course()){const r=computeAttendance(c);assert.ok(r.ok,r.ok?'':r.errors.join(' '));return r.value;}

test('zero exceptions require no timetable or late/excused policies; absence deducts from full marks',()=>{
  const c=course();close(provisionalAttendanceScore(result(c).score,10)!,10);
  c.simpleAttendance!.records.absences=1;close(provisionalAttendanceScore(result(c).score,10)!,9.8);
  c.simpleAttendance!.records.absences=3;close(provisionalAttendanceScore(result(c).score,10)!,9.4);
  assert.equal(c.simpleAttendance!.totalSessions,null);
  const b=computeManagedBalance(c);assert.ok(b.ok);close(b.value.balance.secured,0);close(b.value.balance.lost,.6);close(b.value.balance.remaining,99.4);
});
test('unknown late/excused portions withhold exact score but retain known absence loss',()=>{
  const c=course();c.simpleAttendance!.records={absences:3,lateness:1,excused:1};
  const r=result(c);assert.equal(provisionalAttendanceScore(r.score,10),null);close(r.score.balance.lost,.6);assert.equal(r.score.messages.length,2);
  c.simpleAttendance!.latePenalty={kind:'bundled',perAbsence:3};c.simpleAttendance!.excusedForScore='recognized';
  close(provisionalAttendanceScore(result(c).score,10)!,9.4);
  c.simpleAttendance!.records.lateness=3;close(provisionalAttendanceScore(result(c).score,10)!,9.2);
  c.simpleAttendance!.penalty={kind:'unconfirmed'};assert.equal(provisionalAttendanceScore(result(c).score,10),null);
});
test('score clamps at zero, raw and separate final deductions remain distinct',()=>{
  const c=course();c.simpleAttendance!.records.absences=100;close(provisionalAttendanceScore(result(c).score,10)!,0);
  c.simpleAttendance!.records.absences=3;c.simpleAttendance!.penalty={kind:'attendance_points',pointsPerAbsence:2};
  close(provisionalAttendanceScore(result(c).score,10)!,9.4);
  c.simpleAttendance!.penalty={kind:'final_points',pointsPerAbsence:.2};const r=result(c);
  close(provisionalAttendanceScore(r.score,10)!,10);close(r.score.finalDeduction!,.6);close(r.score.balance.lost,0);
});
test('record only and off require explicit 0% allocation and preserve source records',()=>{
  const c=course();c.simpleAttendance!.records.absences=3;const old=structuredClone(c.assessments);
  c.simpleAttendance!.mode='record_only';assert.ok(validateManagedCourse(c).length);
  c.assessments[3].weight=0;assert.ok(validateManagedCourse(c).length,'sum remains invalid until user fixes it');
  c.assessments[1].weight=.5;assert.deepEqual(validateManagedCourse(c),[]);
  close(result(c).score.internalDeduction!,0);
  c.simpleAttendance!.mode='off';assert.deepEqual(validateManagedCourse(c),[]);assert.equal(c.simpleAttendance!.records.absences,3);
  close(result(c).score.balance.lost,0);assert.equal(result(c).eligibility.status,'needs_review');assert.equal(old[3].weight,.1);
});
test('risk is independent of weight, unknown zero-event policies do not block boundary decisions',()=>{
  const c=course();c.simpleAttendance!.mode='record_only';c.assessments[3].weight=0;c.assessments[1].weight=.5;
  c.simpleAttendance!.eligibility.rule={kind:'max_absences',allowed:4,failureAt:'exceeds'};
  c.simpleAttendance!.records.absences=4;assert.equal(result(c).eligibility.status,'risk');
  c.simpleAttendance!.records.absences=5;assert.equal(result(c).eligibility.status,'failed');
  c.simpleAttendance!.records.absences=4;c.simpleAttendance!.eligibility.rule.failureAt='reaches';assert.equal(result(c).eligibility.status,'failed');
  c.simpleAttendance!.eligibility.rule={kind:'unconfirmed'};assert.equal(result(c).eligibility.status,'needs_review');
});
test('legacy per-session confirmed allocations are preserved; pending assumption is not secured',()=>{
  const c=course();delete c.simpleAttendance;
  c.attendanceManagement={assessmentId:c.assessments[3].id,records:{total:30,held:15,absences:2,lateness:0,excused:0},penalty:{kind:'attendance_points',pointsPerAbsence:2},latePenalty:{kind:'unconfirmed'},excusedForScore:'unconfirmed',allocation:'per_session_equal',eligibility:{rule:{kind:'unconfirmed'},unit:'sessions',excused:'unconfirmed',late:{kind:'unconfirmed'},hours:null}};
  const previous=structuredClone(c.attendanceManagement);const original=result(c);
  c.simpleAttendance=newSimpleAttendance(c,'scored');const next=result(c);
  assert.deepEqual(next.score.balance,original.score.balance);assert.deepEqual(c.attendanceManagement,previous);
  assert.equal(toEngineCourse(c).ok,false);
  c.simpleAttendance.finalized=true;close(result(c).score.balance.secured,9.6);
  if(c.simpleAttendance.penalty.kind!=='unconfirmed')c.simpleAttendance.penalty.pointsPerAbsence=3;
  assert.deepEqual(c.attendanceManagement,previous,'editing simple rules does not mutate archived rules');
});
test('types and exception corrections require confirmation, save failures preserve source and draft',()=>{
  const c=course();const store=new Map<string,string>();const storage={getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>{store.set(k,v);}};
  const first=saveManagedCourses([c],null,()=>storage);assert.ok(first.ok);
  const next=structuredClone(c);next.simpleAttendance!.records.absences=3;
  const second=saveManagedCourses([next],first.value.snapshot,()=>storage);assert.ok(second.ok);
  const corrected=structuredClone(next);corrected.simpleAttendance!.records.absences=1;
  assert.ok(attendanceChangeMessages([next],[corrected]).length);
  assert.equal(saveManagedCourses([corrected],second.value.snapshot,()=>storage).ok,false);
  assert.equal(saveManagedCourses([corrected],second.value.snapshot,()=>({...storage,setItem:()=>{throw new Error('quota');}}),false,true).ok,false);
  const loaded=loadManagedCourses(()=>storage);assert.ok(loaded.ok);assert.deepEqual(loaded.value.courses,[next]);assert.equal(corrected.simpleAttendance!.records.absences,1);
});

test('invalid records, rules, foreign links and malformed persisted data are rejected safely',()=>{
  const c=course();
  for(const patch of [{records:{absences:-1,lateness:0,excused:0}},{records:{absences:1.5,lateness:0,excused:0}},{assessmentId:'other-course'},{rawMaxScore:0},{totalSessions:0},{totalSessions:2,records:{absences:3,lateness:0,excused:0}},{eligibility:null},{latePenalty:{kind:'bundled',perAbsence:0}}]) {
    assert.ok(validateManagedCourse({...c,simpleAttendance:{...c.simpleAttendance,...patch}}).length);
  }
  assert.ok(validateManagedCourse({...c,assessments:[null]}).length);
  c.simpleAttendance!.penalty={kind:'weighted_points',pointsPerAbsence:1e308};c.simpleAttendance!.records.absences=10;
  assert.equal(computeAttendance(c).ok,false);
});

test('ratio and actual-hour rules stay separate from unrecorded attendance assumptions',()=>{
  const c=course();const s=c.simpleAttendance!;
  s.totalSessions=30;s.eligibility.rule={kind:'minimum_ratio',minimum:.75};s.records.absences=7;
  assert.equal(result(c).eligibility.status,'risk');assert.equal(result(c).eligibility.finalStatus,'not_final');
  s.records.absences=8;assert.equal(result(c).eligibility.status,'failed');
  s.records.absences=0;s.eligibility.unit='hours';s.eligibility.hours={total:40,held:20,credited:15,recognitionConfirmed:false};
  assert.equal(result(c).eligibility.status,'needs_review');
  s.eligibility.hours.recognitionConfirmed=true;assert.equal(result(c).eligibility.finalStatus,'not_final');
  s.eligibility.hours.credited=0;assert.equal(result(c).eligibility.status,'failed');
});

test('v1 legacy exceptions survive explicit v2 adoption and other courses stay isolated',()=>{
  const legacy={...newCourse('old'),name:'기존 과목',attendance:{totalSessions:30,absences:2,lateness:3,allowedAbsences:6,penaltyPerAbsence:.2,latePerAbsence:3}};
  legacy.assessments=legacy.assessments.map((a)=>({...a,myScore:80}));
  const map=new Map<string,string>();const store={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);}};
  assert.equal(saveCourses([legacy],null,()=>store).ok,true);
  const source=store.getItem(COURSE_STORAGE_KEY);const preview=prepareV1Migration(()=>store);assert.ok(preview.ok);
  const c=preview.value.courses[0];c.simpleAttendance=newSimpleAttendance(c,'scored');c.simpleAttendance.assessmentId=c.assessments[3].id;
  assert.equal(c.simpleAttendance.records.absences,2);assert.equal(c.simpleAttendance.records.lateness,3);assert.equal(c.simpleAttendance.penalty.kind,'unconfirmed','legacy unit not guessed');
  const saved=saveV1Migration(preview.value,()=>store);assert.ok(saved.ok);assert.equal(store.getItem(COURSE_STORAGE_KEY),source);
  const loaded=loadManagedCourses(()=>store);assert.ok(loaded.ok);assert.deepEqual(loaded.value.courses[0].attendance,legacy.attendance);assert.equal(loaded.value.courses[0].assessments[3].progress?.status,'graded');
  const other=course();assert.equal(other.simpleAttendance!.records.absences,0);
});
