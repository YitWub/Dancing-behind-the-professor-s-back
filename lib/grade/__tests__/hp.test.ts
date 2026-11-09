import test from 'node:test';
import assert from 'node:assert/strict';
import { newCourse } from '../course-validation.ts';
import type { ManagedCourse } from '../management-types.ts';
import { prepareAttendanceEstimate } from '../attendance-estimate.ts';
import { selectAttendanceAssessment } from '../attendance-link.ts';
import { summarizeScore } from '../score-summary.ts';
import { headlineForecast, gradeActionPlan } from '../dashboard-insights.ts';
import { forecastPresentation } from '../forecast-presentation.ts';
import { officialPolicy } from '../grading-policy.ts';
import { autoSaveChanges, createAutoSaveQueue } from '../autosave.ts';
import { saveManagedCourses, loadManagedCourses } from '../managed-storage.ts';

function course(): ManagedCourse {
  const base = newCourse('hp');
  const c: ManagedCourse = { ...base, name: 'HP 과목', enrolled: 40, assessments: base.assessments.map((a, i) => ({
    id: a.id, name: a.name, weight: a.weight, maxScore: a.maxScore, mean: i < 2 ? 70 : null,
    stdev: i < 2 ? 10 : null, ceilingClustered: i >= 2, progress: { status: 'scheduled' },
  })) };
  c.attendanceEstimate = prepareAttendanceEstimate(c).value;
  return c;
}
function summary(c: ManagedCourse) {
  const result = summarizeScore(c); assert.ok(result.ok, result.ok ? '' : result.errors.join(' ')); return result.value;
}
const close = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('new course starts at HP 100 regardless of unearned scheduled exam and assignment points', () => {
  const c = course(), before = structuredClone(c), value = summary(c);
  close(value.hp, 100); close(value.lostHp, 0); close(value.actual.balance.secured, 10);
  assert.deepEqual(c, before); assert.equal(value.attainableGrade, null);
});

test('80/100 midterm weighted at 30% loses six HP: 100 becomes 94, not the secured subtotal', () => {
  const c = course(); c.assessments[0].progress = { status: 'graded', score: 80 };
  const value = summary(c); close(value.hp, 94); close(value.lostHp, 6); close(value.actual.balance.secured, 34);
  c.assessments[1].progress = { status: 'awaiting_grade' }; close(summary(c).hp, 94);
});

test('full assignment marks and scheduled tasks do not lose HP; confirmed task loss uses the group allocation once', () => {
  const c = course(); c.assessments[2].progress = { status: 'graded', score: 100 }; close(summary(c).hp, 100);
  c.assessments[2].assignmentGroup = { allocation: 'equal', tasks: [
    { id: 'done', name: '제출 과제', maxScore: 20, weight: null, progress: { status: 'graded', score: 20 } },
    { id: 'later', name: '남은 과제', maxScore: 100, weight: null, progress: { status: 'scheduled' } },
  ] };
  close(summary(c).hp, 100);
  c.assessments[2].assignmentGroup.tasks[1].progress = { status: 'graded', score: 80 };
  close(summary(c).hp, 98); close(summary(c).lostHp, 2);
});

test('one absence costs 10/15 HP, correcting it restores HP and three latenesses use the same rule', () => {
  const c = course(); c.attendanceEstimate!.absences = 1;
  close(summary(c).hp, 100 - 10 / 15); close(summary(c).lostHp, 10 / 15);
  assert.deepEqual(summary(c).attendanceRule, { source: 'configured-rule', model: 'equal-15-v1', totalSessions: 15, latenessPerAbsence: 3 });
  assert.equal(summary(c).attendanceDeductionSource,'configured-rule');
  c.attendanceEstimate!.absences = 0; close(summary(c).hp, 100);
  c.attendanceEstimate!.lateness = 2; close(summary(c).hp, 100);
  c.attendanceEstimate!.lateness = 3; close(summary(c).hp, 100 - 10 / 15);
  c.attendanceEstimate!.totalSessions = 30; close(summary(c).hp, 100 - 10 / 30);
  c.attendanceEstimate!.absences = 100; close(summary(c).hp, 90); close(summary(c).lostHp, 10);
});

test('disconnecting attendance removes its HP deduction and retains absence and lateness records', () => {
  const c = course(); c.attendanceEstimate!.absences = 1; c.attendanceEstimate!.lateness = 3;
  close(summary(c).hp, 100 - 20 / 15);
  const disconnected = selectAttendanceAssessment(c, null); assert.ok(disconnected.ok);
  close(summary(disconnected.value).hp, 100); close(summary(disconnected.value).attendanceDeduction, 0);
  assert.equal(disconnected.value.attendanceEstimate!.absences, 1); assert.equal(disconnected.value.attendanceEstimate!.lateness, 3);
  assert.equal(disconnected.value.attendanceEstimate!.selection, 'manual');
});

test('existing confirmed attendance loss takes precedence and internal or external loss is never charged twice', () => {
  const c = course(); c.attendanceEstimate!.confirmed = { weight: 10, secured: 8, lost: 2, ungraded: 0, finalDeduction: null };
  c.attendanceEstimate!.absences = 1; close(summary(c).hp, 98);
  assert.equal(summary(c).attendanceDeductionSource,'confirmed-record');
  c.attendanceEstimate!.absences = 0; close(summary(c).hp, 98);
  c.attendanceEstimate!.confirmed.finalDeduction = 3; close(summary(c).hp, 95);
  c.attendanceEstimate!.absences = 15; close(summary(c).hp, 90);
  assert.equal(summary(c).attendanceDeductionSource,'configured-rule-with-confirmed-floor');
  assert.equal(c.attendanceEstimate!.confirmed.secured, 8); assert.equal(c.attendanceEstimate!.confirmed.lost, 2);
});

test('HP cannot imply a relative A+; current relative model, statistics, saved caps and target planner remain active', () => {
  const c = course(); c.gradingPolicy = { ...officialPolicy('relative1'), source: 'custom', relativeCaps: { a: .35, ab: .75 } };
  close(summary(c).hp, 100); assert.equal(forecastPresentation(c).grade, null); assert.equal(summary(c).attainableGrade, null);
  c.assessments[0].progress = { status: 'graded', score: 80 }; c.assessments[2].progress = { status: 'graded', score: 100 };
  const original = structuredClone(c), before = headlineForecast(c), goal = gradeActionPlan(c, 'A0'), view = forecastPresentation(c);
  assert.ok(before.ok && before.relative?.ok); assert.ok(before.scenario.families.length > 0);
  assert.equal(view.familyProbabilities.length, before.scenario.families.length); assert.match(view.relativePosition!, /실제 등수 아님/);
  assert.equal(goal.relative?.kind, 'plan'); assert.deepEqual(c, original);
  c.assessments[0].mean = 85;
  const changed = headlineForecast(c); assert.ok(changed.ok && changed.relative?.ok);
  assert.ok(changed.relative.top > before.relative.top); close(summary(c).hp, 94);
  assert.deepEqual(c.gradingPolicy, original.gradingPolicy);
});

test('absolute attainable grade compares HP to saved professor cutoffs before the default score table', () => {
  const c = course(); c.assessments[0].progress = { status: 'graded', score: 80 };
  c.gradingPolicy = { ...officialPolicy('absolute'), source: 'custom', absoluteCutoffs: { 'A+': 99, A0: 96, 'B+': 93, B0: 88, 'C+': 75, C0: 70, 'D+': 65, D0: 60 } };
  const savedPolicy = structuredClone(c.gradingPolicy); close(summary(c).hp, 94); assert.equal(summary(c).attainableGrade, 'B+');
  assert.deepEqual(c.gradingPolicy, savedPolicy);
  delete c.gradingPolicy; c.isAbsolute=true; c.absoluteTargets={'A+':99,A0:96,'B+':93,B0:88};
  assert.equal(summary(c).attainableGrade,'B+','legacy custom professor criteria remain authoritative');
  c.gradingPolicy = officialPolicy('absolute'); assert.equal(summary(c).attainableGrade, 'A0');
});

test('live HP, autosaved absence correction and reload use the same records without storing a second HP value', () => {
  const c = course(); c.assessments[0].progress = { status: 'graded', score: 80 };
  const data = new Map<string, string>(), store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
  let saved = saveManagedCourses([c], null, () => store); assert.ok(saved.ok); let snapshot = saved.value.snapshot, previous = c;
  let job: (() => void) | null = null;
  const queue = createAutoSaveQueue({ set(fn) { job = fn; return 1; }, clear() { job = null; } });
  for (const absences of [1, 0]) {
    const live = structuredClone(previous); live.attendanceEstimate!.absences = absences;
    close(summary(live).hp, 94 - absences * 10 / 15);
    queue.schedule(() => {
      const changes = autoSaveChanges(previous, live); assert.deepEqual(changes.messages, []);
      saved = saveManagedCourses([live], snapshot, () => store, changes.assignments, changes.attendance);
      assert.ok(saved.ok); snapshot = saved.value.snapshot;
    }, 0);
    assert.ok(job); queue.flush();
    const loaded = loadManagedCourses(() => store); assert.ok(loaded.ok); assert.deepEqual(summary(loaded.value.courses[0]), summary(live));
    const document = JSON.parse(snapshot); assert.equal(document.version, 2); assert.equal('hp' in document.courses[0], false);
    previous = live;
  }
});

test('HP is clamped at zero and unresolved historical records never display a falsely exact ceiling', () => {
  const c = course(); c.attendanceEstimate!.confirmed = { weight: 10, secured: 10, lost: 0, ungraded: 0, finalDeduction: 150 };
  close(summary(c).hp, 0); close(summary(c).lostHp, 100);
  const unresolved = course(); unresolved.assessments[0] = { ...unresolved.assessments[0], progress: null, reviewRequired: 'legacy_null_score' };
  assert.equal(summary(unresolved).hp, null); assert.equal(summary(unresolved).lostHp, null);
});
