import test from 'node:test';
import assert from 'node:assert/strict';
import { newCourse } from '../course-validation.ts';
import { migrateV1Courses, validateManagedCourse, transitionAssessment } from '../management.ts';
import { assessmentSummary } from '../course-experience.ts';
import { computeManagedBalance } from '../managed-balance.ts';
import { loadManagedCourses, saveManagedCourses } from '../managed-storage.ts';
import type { ManagedCourse } from '../management-types.ts';

function course(): ManagedCourse {
  const result = migrateV1Courses([{ ...newCourse('ux'), name: '간편 과목' }]);
  assert.ok(result.ok);
  return result.value[0];
}

test('minimal course saves without statistics, assignment counts or attendance configuration', () => {
  const c = course();
  assert.deepEqual(validateManagedCourse(c), []);
  const balance = computeManagedBalance(c); assert.ok(balance.ok);
  assert.equal(balance.value.balance.secured, 0);
  assert.equal(balance.value.review.unclassifiedPoints, 100);
  assert.equal(assessmentSummary(c.assessments[0], c), '진행 상태 검토 필요');
  assert.equal(c.semester, undefined);
});

test('optional semester, preferences and rule-free records round-trip without changing calculations', () => {
  const c = course(); const old = structuredClone(c);
  c.semester = '2026-2';
  c.attendancePreferences = { checked: 'yes', scored: 'no', eligibility: 'unknown' };
  c.attendanceNotes = { absences: 2, lateness: 1, excused: 3 };
  assert.deepEqual(validateManagedCourse(c), []);
  assert.deepEqual(computeManagedBalance(c), computeManagedBalance(old));
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  const saved = saveManagedCourses([c], null, () => storage); assert.ok(saved.ok);
  const restored = loadManagedCourses(() => storage); assert.ok(restored.ok);
  assert.deepEqual(restored.value.courses, [c]);
  const edited = { ...c, attendanceNotes: { ...c.attendanceNotes, absences: 4 } };
  assert.equal(saveManagedCourses([edited], saved.value.snapshot, () => ({...storage, setItem: () => { throw new Error('quota'); }})).ok, false);
  assert.deepEqual(loadManagedCourses(() => storage), restored);
  assert.equal(edited.attendanceNotes.absences, 4);
});

test('invalid UX metadata is rejected and no-check does not discard legacy scores or records', () => {
  const c = course();
  for (const patch of [{ semester: 'now' }, { attendancePreferences: { checked: 'maybe' } }, { attendanceNotes: { absences: -1, lateness: 0, excused: 0 } }, { attendanceNotes: { absences: 0.5, lateness: 0, excused: 0 } }]) assert.ok(validateManagedCourse({ ...c, ...patch }).length);
  c.attendancePreferences = { checked: 'no', scored: 'unknown', eligibility: 'unknown' };
  c.attendanceNotes = { absences: 1, lateness: 0, excused: 0 };
  const result = transitionAssessment(c.assessments[0], { status: 'graded', score: 54.5 }); assert.ok(result.ok);
  c.assessments[0] = result.value;
  assert.deepEqual(validateManagedCourse(c), []);
  assert.equal(assessmentSummary(c.assessments[0], c), '54.5/100점 확정');
  assert.equal(c.attendanceNotes.absences, 1);
});

test('summary distinguishes waiting, scheduled, zero and optional assignment groups', () => {
  const c = course(); const a = c.assessments[2];
  for (const [status, text] of [['scheduled', '아직 미진행'], ['awaiting_grade', '채점 대기']] as const) {
    const r = transitionAssessment(a, {status}); assert.ok(r.ok); assert.equal(assessmentSummary(r.value, c), text);
  }
  const r = transitionAssessment(a, {status: 'graded', score: 0}); assert.ok(r.ok);
  assert.equal(assessmentSummary(r.value, c), '0/100점 확정');
  a.assignmentGroup = { allocation: 'unconfirmed', tasks: [
    {id: 't1', name: '과제 1', maxScore: 100, weight: null, progress: {status: 'graded', score: 80}},
    {id: 't2', name: '과제 2', maxScore: 100, weight: null, progress: {status: 'awaiting_grade'}},
  ]};
  assert.equal(assessmentSummary(a, c), '2개 중 1개 확정');
  const balance = computeManagedBalance(c); assert.ok(balance.ok);
  assert.equal(balance.value.balance.secured, 0);
});
