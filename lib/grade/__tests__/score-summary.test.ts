import test from 'node:test';
import assert from 'node:assert/strict';
import { newCourse } from '../course-validation.ts';
import { migrateV1Courses } from '../management.ts';
import { prepareAttendanceEstimate } from '../attendance-estimate.ts';
import { summarizeScore } from '../score-summary.ts';
import { simulateCourse } from '../course-simulation.ts';
import { headlineForecast, gradeActionPlan } from '../dashboard-insights.ts';
import { forecastPresentation } from '../forecast-presentation.ts';
import { officialPolicy } from '../grading-policy.ts';
import { planGoal } from '../grade-planner.ts';
import { autoSaveChanges, createAutoSaveQueue } from '../autosave.ts';
import { loadManagedCourses, saveManagedCourses } from '../managed-storage.ts';
import type { ManagedCourse } from '../management-types.ts';

function course(): ManagedCourse {
  const migrated = migrateV1Courses([{ ...newCourse('summary'), name: '출석 요약', enrolled: 40 }]);
  assert.ok(migrated.ok);
  const c = migrated.value[0];
  c.assessments = c.assessments.map((a) => ({ ...a, reviewRequired: undefined, progress: { status: 'scheduled' } }));
  for (const a of c.assessments) delete a.reviewRequired;
  c.assessments[0].progress = { status: 'graded', score: 80 };
  c.assessments[0].mean = 60;
  c.attendanceEstimate = prepareAttendanceEstimate(c).value;
  c.gradingPolicy = officialPolicy('relative1');
  return c;
}
function summary(c: ManagedCourse) {
  const result = summarizeScore(c);
  assert.ok(result.ok, result.ok ? '' : result.errors.join(' '));
  return result.value;
}
const close = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('one absence deducts 10/15 from actual HP and every summary score under the same attendance rule', () => {
  const c = course(), original = structuredClone(c), before = summary(c);
  close(before.actual.balance.secured, 34); close(before.confirmedMaximum, 94); close(before.estimatedMaximum, 94);
  c.attendanceEstimate!.absences = 1;
  const after = summary(c), snapshot = structuredClone(c);
  close(after.attendanceContribution, 10 - 10 / 15); close(after.attendanceDeduction, 10 / 15);
  close(after.estimatedMaximum, 94 - 10 / 15); close(after.confirmedMaximum, 94 - 10 / 15);
  close(before.actual.balance.secured-after.actual.balance.secured,10/15);
  close(after.actual.balance.lost-before.actual.balance.lost,10/15);
  assert.deepEqual(after.actual.items.slice(0,3),before.actual.items.slice(0,3));
  assert.deepEqual(c, snapshot); assert.equal(after.usesEstimatedAttendance, false);
  assert.deepEqual(original.assessments,c.assessments);
});

test('session changes, three-lateness conversion and excessive absences recalculate without negative scores', () => {
  const c = course(); c.attendanceEstimate!.lateness = 2;
  close(summary(c).attendanceDeduction, 0);
  c.attendanceEstimate!.lateness = 3; close(summary(c).attendanceDeduction, 10 / 15);
  c.attendanceEstimate!.totalSessions = 30; close(summary(c).attendanceDeduction, 10 / 30);
  c.attendanceEstimate!.absences = 100;
  close(summary(c).attendanceContribution, 0); close(summary(c).attendanceDeduction, 10); close(summary(c).estimatedMaximum, 84);
});

test('zero-weight and absent attendance do not deduct points or invent a contribution', () => {
  const c = course(); c.assessments[3].weight = 0; c.assessments[1].weight = .5;
  c.attendanceEstimate!.absences = 100;
  for (const missing of [false, true]) {
    if (missing) { c.assessments.pop(); c.attendanceEstimate!.assessmentId = null; }
    const result = summary(c);
    close(result.attendanceDeduction, 0); close(result.attendanceContribution, 0);
    close(result.estimatedMaximum, 94); assert.equal(result.usesEstimatedAttendance, false);
  }
});

test('confirmed attendance and external deduction are retained exactly once even when absence count increases', () => {
  const c = course();
  c.attendanceEstimate!.confirmed = { weight: 10, secured: 8, lost: 2, ungraded: 0, finalDeduction: 3 };
  const before = summary(c);
  c.attendanceEstimate!.absences = 30;
  const after = summary(c);
  close(before.attendanceDeduction,5);
  close(after.actual.balance.secured,27); close(after.confirmedMaximum,84); close(after.estimatedMaximum,84);
  close(after.attendanceContribution,3); close(after.attendanceDeduction,10);
  assert.equal(after.usesEstimatedAttendance,false); assert.equal(after.actual.finalDeduction,3);
});

test('saved full attendance does not freeze the summary: 41.35 becomes 40.68 after one absence', () => {
  const c = course();
  c.assessments[0].progress = { status: 'graded', score: 54.5 };
  c.assessments[1].weight = .45;
  c.assessments[2].weight = .15;
  c.assessments[2].progress = { status: 'graded', score: 100 };
  c.attendanceEstimate!.confirmed = { weight: 10, secured: 10, lost: 0, ungraded: 0, finalDeduction: null };
  const before = summary(c);
  close(before.attendanceAdjustedScore, 41.35); close(before.estimatedMaximum, 86.35);
  c.attendanceEstimate!.absences = 1;
  const after = summary(c);
  close(after.attendanceAdjustedScore, 41.35 - 10 / 15);
  close(after.estimatedMaximum, 86.35 - 10 / 15); close(after.attendanceDeduction, 10 / 15);
  close(after.actual.balance.secured,41.35-10/15); close(after.actual.balance.lost-before.actual.balance.lost,10/15);
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
  assert.ok(saveManagedCourses([c], null, () => storage).ok);
  const restored = loadManagedCourses(() => storage); assert.ok(restored.ok);
  assert.deepEqual(summary(restored.value.courses[0]), after);
});

test('stored historical losses are retained once while new attendance deductions use the full allocation', () => {
  const c = course();
  c.attendanceEstimate!.confirmed = { weight: 10, secured: 4, lost: 2, ungraded: 0, finalDeduction: null };
  c.attendanceEstimate!.absences = 1;
  close(summary(c).attendanceDeduction,2); close(summary(c).estimatedMaximum,92);
  c.attendanceEstimate!.absences = 6;
  close(summary(c).attendanceDeduction,4); close(summary(c).attendanceContribution,6); close(summary(c).estimatedMaximum,90);
  c.attendanceEstimate!.absences = 100;
  close(summary(c).attendanceContribution,0); close(summary(c).attendanceDeduction,10); close(summary(c).estimatedMaximum,84);
});

test('relative outlook and target respond to the same attendance loss as the actual score and absolute planner', () => {
  const c=course(); c.assessments[0].progress={status:'graded',score:60};
  const relativeBefore=headlineForecast(c), targetBefore=gradeActionPlan(c,'A0');
  c.attendanceEstimate!.absences = 1;
  const relativeAfter = headlineForecast(c);
  assert.ok(relativeBefore.ok && relativeAfter.ok);
  assert.ok(relativeAfter.relative?.ok&&relativeBefore.relative?.ok);
  assert.ok(relativeAfter.relative.top>relativeBefore.relative.top);
  const targetAfter=gradeActionPlan(c,'A0');
  assert.equal(targetBefore.relative?.kind,'plan');assert.equal(targetAfter.relative?.kind,'plan');
  if(targetBefore.relative?.kind==='plan'&&targetAfter.relative?.kind==='plan')assert.ok(targetAfter.relative.rawBoundary>targetBefore.relative.rawBoundary);
  close(relativeBefore.score - relativeAfter.score, 10 / 15);
  const view=forecastPresentation(c);
  close(view.projectedScore,relativeAfter.score);
  assert.ok(view.confirmed.some((fact)=>fact.label==='출석'&&fact.value.includes('9.33')));
  assert.equal(view.assumed.some((fact)=>fact.label==='출석'),false);
  c.gradingPolicy = officialPolicy('absolute'); c.attendanceEstimate!.absences = 0;
  const absoluteBefore = headlineForecast(c), planBefore = planGoal(c, { kind: 'points', points: 80 });
  c.attendanceEstimate!.absences = 1;
  const absoluteAfter = headlineForecast(c), planAfter = planGoal(c, { kind: 'points', points: 80 }), scenario = simulateCourse(c);
  assert.ok(absoluteBefore.ok && absoluteAfter.ok && scenario.ok);
  close(absoluteBefore.score - absoluteAfter.score, 10 / 15);
  assert.ok('needed' in planBefore && 'needed' in planAfter); close(planAfter.needed - planBefore.needed, 10 / 15);
  close(summary(c).estimatedMaximum, scenario.value.high);
});

test('live attendance projection appears before autosave; latest revision and session assumption survive reload', () => {
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
  const original = course(); let saved = saveManagedCourses([original], null, () => storage); assert.ok(saved.ok);
  let base = original, snapshot = saved.value.snapshot, job: (() => void) | null = null;
  const queue = createAutoSaveQueue({ set(fn) { job = fn; return 1; }, clear() { job = null; } });
  const live = structuredClone(original); live.attendanceEstimate!.absences = 1;
  close(summary(live).attendanceDeduction, 10 / 15);
  assert.deepEqual(JSON.parse(storage.getItem('erica.grade.courses.v2')!).courses[0], original);
  const schedule = (next: ManagedCourse) => queue.schedule(() => {
    const changes = autoSaveChanges(base, next);
    saved = saveManagedCourses([next], snapshot, () => storage, changes.assignments, changes.attendance);
    assert.ok(saved.ok); snapshot = saved.value.snapshot; base = next;
  }, 0);
  schedule(live);
  const latest = structuredClone(live); latest.attendanceEstimate!.lateness = 3; latest.attendanceEstimate!.totalSessions = 30;
  schedule(latest); assert.ok(job); queue.flush();
  const restored = loadManagedCourses(() => storage); assert.ok(restored.ok);
  assert.deepEqual(restored.value.courses[0], latest); assert.deepEqual(summary(restored.value.courses[0]), summary(latest));
  close(summary(restored.value.courses[0]).attendanceDeduction, 20 / 30);
});

test('incomplete actual records withhold exact ceilings and invalid sessions are rejected', () => {
  const c = course(); c.assessments[0] = { ...c.assessments[0], progress: null, reviewRequired: 'legacy_null_score' };
  assert.equal(summary(c).confirmedMaximum, null); assert.equal(summary(c).estimatedMaximum, null);
  c.attendanceEstimate!.totalSessions = 0; assert.equal(summarizeScore(c).ok, false);
});

test('attendance is credited before any exams and moves from secured to lost after the first recorded absence',()=>{
  const c=course();c.assessments[0].progress={status:'scheduled'};
  const initial=summary(c);close(initial.attendanceAdjustedScore,10);close(initial.actual.balance.remaining,90);
  c.attendanceEstimate!.absences=1;
  const recorded=summary(c);close(recorded.attendanceAdjustedScore,10-10/15);close(recorded.actual.balance.lost,10/15);
  close(Object.values(recorded.actual.balance).reduce((sum,n)=>sum+n,0),100);
  assert.equal(headlineForecast(c).ok,false,'full attendance alone must not invent future exam grades');
});

test('lateness and session changes update the HP, outlook and target together and round-trip through storage',()=>{
  const c=course();c.assessments[0].progress={status:'graded',score:60};c.attendanceEstimate!.lateness=2;
  const initial=summary(c),forecast=headlineForecast(c),target=gradeActionPlan(c,'A0');assert.ok(forecast.ok);
  c.attendanceEstimate!.lateness=3;
  const changed=summary(c),nextForecast=headlineForecast(c),nextTarget=gradeActionPlan(c,'A0');assert.ok(nextForecast.ok);
  close(initial.actual.balance.secured-changed.actual.balance.secured,10/15);close(forecast.score-nextForecast.score,10/15);
  assert.ok(target.relative?.kind==='plan'&&nextTarget.relative?.kind==='plan');
  assert.ok(nextTarget.relative.rawBoundary>target.relative.rawBoundary);
  c.attendanceEstimate!.totalSessions=30;close(summary(c).attendanceDeduction,10/30);
  const data=new Map<string,string>(),store={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);}};
  assert.ok(saveManagedCourses([c],null,()=>store).ok);
  const loaded=loadManagedCourses(()=>store);assert.ok(loaded.ok);
  assert.deepEqual(summary(loaded.value.courses[0]),summary(c));
  assert.deepEqual(headlineForecast(loaded.value.courses[0]),headlineForecast(c));
  assert.deepEqual(gradeActionPlan(loaded.value.courses[0],'A0'),gradeActionPlan(c,'A0'));
});
