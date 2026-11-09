import test from 'node:test';
import assert from 'node:assert/strict';
import type { Course } from '../../types.ts';
import type { AssessmentProgress, ManagedAssessment, ManagedCourse } from '../management-types.ts';
import { newCourse } from '../course-validation.ts';
import { COURSE_STORAGE_KEY, loadCourses, saveCourses, type CourseStorage } from '../course-storage.ts';
import { migrateV1Courses, toEngineCourse, transitionAssessment, validateManagedCourse, validateManagedCourses } from '../management.ts';
import { computeManagedBalance } from '../managed-balance.ts';
import { MANAGED_COURSE_STORAGE_KEY, loadManagedCourses, prepareV1Migration, saveManagedCourses, saveV1Migration } from '../managed-storage.ts';
import { predict } from '../predict.ts';

const states: AssessmentProgress[] = [
  { status: 'scheduled' }, { status: 'awaiting_grade' },
  { status: 'graded', score: 80 }, { status: 'zero_confirmed', reason: 'not_submitted' },
];
function legacy(): Course {
  return { ...newCourse('c1'), name: '자료구조', enrolled: 40 };
}
function managed(): ManagedCourse {
  const converted = migrateV1Courses([legacy()]);
  assert.ok(converted.ok);
  return {
    ...converted.value[0],
    assessments: converted.value[0].assessments.map((a, index) => {
      const next = transitionAssessment(a, states[index]);
      assert.ok(next.ok);
      return next.value;
    }),
  };
}
function memory(): CourseStorage & { data: Map<string, string>; writes: string[] } {
  const data = new Map<string, string>();
  const writes: string[] = [];
  return { data, writes, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { writes.push(key); data.set(key, value); } };
}
function close(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}

test('all progress transitions replace the old state without mutating records or leaking scores/reasons', () => {
  for (const before of states) for (const after of states) {
    const c = managed();
    const a = { ...c.assessments[0], progress: before } as ManagedAssessment;
    const original = structuredClone(a);
    const next = transitionAssessment(a, after);
    assert.ok(next.ok);
    assert.deepEqual(next.value.progress, after);
    assert.notEqual(next.value.progress, after);
    assert.ok(!('reviewRequired' in next.value));
    assert.deepEqual(a, original);
    assert.deepEqual(validateManagedCourse({ ...c, assessments: [next.value, ...c.assessments.slice(1)] }), []);
  }
});

test('4-area accounting splits confirmed scores, ungraded and scheduled points and conserves 100', () => {
  const c = managed();
  const result = computeManagedBalance(c);
  assert.ok(result.ok);
  assert.deepEqual(result.value.balance, { secured: 16, lost: 14, ungraded: 40, remaining: 30 });
  close(Object.values(result.value.balance).reduce((sum, n) => sum + n, 0), 100);
  close(result.value.totalPoints, 100);
  assert.equal(result.value.complete, true);
});

test('scheduled -> awaiting -> graded moves allocation without treating pending as a zero', () => {
  let c = managed();
  const assertions = [
    [{ status: 'scheduled' }, { secured: 0, lost: 0, ungraded: 0, remaining: 100 }],
    [{ status: 'awaiting_grade' }, { secured: 0, lost: 0, ungraded: 100, remaining: 0 }],
    [{ status: 'graded', score: 80 }, { secured: 80, lost: 20, ungraded: 0, remaining: 0 }],
    [{ status: 'zero_confirmed', reason: 'absent' }, { secured: 0, lost: 100, ungraded: 0, remaining: 0 }],
  ] as const;
  for (const [progress, expected] of assertions) {
    c = { ...c, assessments: c.assessments.map((a) => {
      const next = transitionAssessment(a, progress);
      assert.ok(next.ok);
      return next.value;
    }) };
    const b = computeManagedBalance(c);
    assert.ok(b.ok);
    for (const key of ['secured', 'lost', 'ungraded', 'remaining'] as const) close(b.value.balance[key], expected[key]);
  }
});

test('graded zero and absence/non-submission have equal loss but distinct persisted progress', () => {
  const store = memory();
  for (const progress of [{ status: 'graded', score: 0 }, { status: 'zero_confirmed', reason: 'absent' }, { status: 'zero_confirmed', reason: 'not_submitted' }] as AssessmentProgress[]) {
    const c = managed();
    c.assessments = c.assessments.map((a) => {
      const next = transitionAssessment(a, progress);
      assert.ok(next.ok);
      return next.value;
    });
    const b = computeManagedBalance(c);
    assert.ok(b.ok);
    close(b.value.balance.lost, 100);
    assert.equal(b.value.balance.secured, 0);
    const snapshot = loadManagedCourses(() => store);
    assert.ok(snapshot.ok);
    assert.ok(saveManagedCourses([c], snapshot.value.snapshot, () => store).ok);
    const restored = loadManagedCourses(() => store);
    assert.ok(restored.ok);
    assert.deepEqual(restored.value.courses[0].assessments[0].progress, progress);
  }
});

test('fractional weights and different score scales conserve allocation without early rounding', () => {
  const c = managed();
  c.assessments = c.assessments.slice(0, 3).map((a, index) => {
    const next = transitionAssessment({ ...a, weight: [0.3333, 0.3333, 0.3334][index], maxScore: 7 }, { status: 'graded', score: index + 1 });
    assert.ok(next.ok);
    return next.value;
  });
  const original = structuredClone(c);
  const b = computeManagedBalance(c);
  assert.ok(b.ok);
  close(b.value.balance.secured, (33.33 + 33.33 * 2 + 33.34 * 3) / 7);
  close(Object.values(b.value.balance).reduce((sum, n) => sum + n, 0), 100);
  assert.deepEqual(c, original);
});

test('bad scores, malformed statuses and contradictory score fields are rejected', () => {
  for (const progress of [
    null, {}, { status: 'unknown' }, { status: 'graded' },
    ...[-1, 101, NaN, Infinity, '80', null].map((score) => ({ status: 'graded', score })),
    { status: 'scheduled', score: 0 }, { status: 'awaiting_grade', score: 80 },
    { status: 'graded', score: 0, reason: 'absent' },
    { status: 'zero_confirmed' }, { status: 'zero_confirmed', reason: 'other' },
    { status: 'zero_confirmed', reason: 'absent', score: 0 },
  ]) {
    const c = managed();
    const a = { ...c.assessments[0], progress };
    assert.ok(validateManagedCourse({ ...c, assessments: [a, ...c.assessments.slice(1)] }).length > 0);
    assert.equal(transitionAssessment(c.assessments[0], progress as AssessmentProgress).ok, false);
  }
});

test('invalid weights and structural metadata never produce a balance or save', () => {
  for (const weight of [-0.1, 1.1, NaN, Infinity, 0.2]) {
    const c = managed();
    c.assessments[0].weight = weight;
    assert.equal(computeManagedBalance(c).ok, false);
    assert.equal(saveManagedCourses([c], null, () => memory()).ok, false);
  }
  for (const value of [null, {}, [], { ...managed(), assessments: [] }, { ...managed(), credits: -1 }]) {
    assert.ok(validateManagedCourse(value).length > 0);
  }
  const c = managed();
  assert.ok(validateManagedCourses([c, c]).length > 0);
  c.assessments[1].id = c.assessments[0].id;
  assert.ok(validateManagedCourse(c).length > 0);
});

test('v2 rejects conflicting legacy score and stale review markers', () => {
  const c = managed();
  for (const patch of [{ myScore: 100 }, { reviewRequired: 'legacy_null_score' }, { progress: null }, { progress: null, reviewRequired: 'other' }]) {
    assert.ok(validateManagedCourse({ ...c, assessments: [{ ...c.assessments[0], ...patch }, ...c.assessments.slice(1)] }).length > 0);
  }
});

test('v1 migration preserves numeric score, zero, null uncertainty, IDs and single assignment', () => {
  const c = legacy();
  c.assessments[0].myScore = 80;
  c.assessments[1].myScore = 0;
  c.myRank = 5;
  c.attendance = { totalSessions: 30, absences: 2, lateness: 1, allowedAbsences: 6, penaltyPerAbsence: 2, latePerAbsence: 3 };
  const original = structuredClone(c);
  const converted = migrateV1Courses([c]);
  assert.ok(converted.ok);
  const result = converted.value[0];
  assert.deepEqual(validateManagedCourse(result), []);
  assert.deepEqual(result.assessments[0].progress, { status: 'graded', score: 80 });
  assert.deepEqual(result.assessments[1].progress, { status: 'graded', score: 0 });
  assert.equal(result.assessments[2].progress, null);
  assert.equal(result.assessments[2].reviewRequired, 'legacy_null_score');
  assert.equal(result.assessments.length, c.assessments.length);
  assert.equal(result.assessments.filter((a) => a.name === '과제').length, 1);
  assert.deepEqual(result.assessments.map((a) => a.id), c.assessments.map((a) => a.id));
  assert.equal(result.myRank, 5);
  assert.deepEqual(result.attendance, c.attendance);
  assert.notEqual(result.attendance, c.attendance);
  assert.deepEqual(c, original);
  assert.deepEqual(migrateV1Courses([c]), converted);
});

test('legacy null is unclassified rather than scheduled, graded zero or awaiting_grade', () => {
  const migrated = migrateV1Courses([legacy()]);
  assert.ok(migrated.ok);
  const c = migrated.value[0];
  const b = computeManagedBalance(c);
  assert.ok(b.ok);
  assert.deepEqual(b.value.balance, { secured: 0, lost: 0, ungraded: 0, remaining: 0 });
  close(b.value.review.unclassifiedPoints, 100);
  assert.equal(b.value.review.assessmentIds.length, 4);
  assert.equal(b.value.complete, false);
  assert.equal(toEngineCourse(c).ok, false);
  c.assessments = c.assessments.map((a) => {
    const next = transitionAssessment(a, { status: 'scheduled' });
    assert.ok(next.ok);
    return next.value;
  });
  const reviewed = computeManagedBalance(c);
  assert.ok(reviewed.ok);
  assert.equal(reviewed.value.complete, true);
  close(reviewed.value.balance.remaining, 100);
  assert.equal(reviewed.value.review.unclassifiedPoints, 0);
});

test('partially reviewed migration conserves classified plus unclassified allocations', () => {
  const c = legacy();
  c.assessments[0].myScore = 80;
  const migrated = migrateV1Courses([c]);
  assert.ok(migrated.ok);
  const b = computeManagedBalance(migrated.value[0]);
  assert.ok(b.ok);
  close(b.value.balance.secured, 24);
  close(b.value.balance.lost, 6);
  close(b.value.review.unclassifiedPoints, 70);
  close(Object.values(b.value.balance).reduce((sum, n) => sum + n, 0) + b.value.review.unclassifiedPoints, 100);
});

test('legacy attendance is preserved and explicitly flagged, not double deducted by new accounting', () => {
  const c = managed();
  c.attendance = { totalSessions: 30, absences: 2, lateness: 0, allowedAbsences: 6, penaltyPerAbsence: 2, latePerAbsence: 3 };
  const b = computeManagedBalance(c);
  assert.ok(b.ok);
  assert.equal(b.value.review.attendanceLedgerPreserved, true);
  assert.equal(b.value.complete, false);
  close(b.value.balance.lost, 14);
});

test('adapter maps actual scores and zero, leaves both pending states null, and does not mutate data', () => {
  const c = managed();
  const original = structuredClone(c);
  const adapted = toEngineCourse(c);
  assert.ok(adapted.ok);
  assert.deepEqual(adapted.value.assessments.map((a) => a.myScore), [null, null, 80, 0]);
  assert.ok(adapted.value.assessments.every((a) => !('progress' in a) && !('reviewRequired' in a)));
  assert.deepEqual(c, original);
});

test('legacy fully graded data round-trips and yields identical existing engine predictions', () => {
  const c = legacy();
  c.assessments.forEach((a, i) => { a.myScore = i === 0 ? 0 : 80; a.mean = 70; a.stdev = 12; });
  const migrated = migrateV1Courses([c]);
  assert.ok(migrated.ok);
  const adapted = toEngineCourse(migrated.value[0]);
  assert.ok(adapted.ok);
  assert.deepEqual(adapted.value, c);
  assert.deepEqual(predict(adapted.value), predict(c));
});

test('all scheduled or awaiting records stay unobserved and cannot create a predicted grade', () => {
  for (const progress of states.slice(0, 2)) {
    const c = managed();
    c.assessments = c.assessments.map((a) => ({ ...a, progress } as ManagedAssessment));
    const adapted = toEngineCourse(c);
    assert.ok(adapted.ok);
    const prediction = predict(adapted.value);
    assert.equal(prediction.distribution, null);
    assert.equal(prediction.balance.secured, 0);
    assert.equal(prediction.balance.lost, 0);
  }
});

test('empty v2 load and migration preview do not write or change v1', () => {
  const store = memory();
  assert.deepEqual(loadManagedCourses(() => store), { ok: true, value: { courses: [], snapshot: null } });
  assert.equal(prepareV1Migration(() => store).ok, false);
  assert.deepEqual(store.writes, []);
  assert.ok(saveCourses([legacy()], null, () => store).ok);
  const source = store.getItem(COURSE_STORAGE_KEY);
  const writes = store.writes.length;
  assert.ok(prepareV1Migration(() => store).ok);
  assert.equal(store.writes.length, writes);
  assert.equal(store.getItem(COURSE_STORAGE_KEY), source);
});

test('explicit migration writes only v2; restoring both formats retains original v1 CRUD compatibility', () => {
  const store = memory();
  assert.ok(saveCourses([legacy()], null, () => store).ok);
  const source = store.getItem(COURSE_STORAGE_KEY);
  const preview = prepareV1Migration(() => store);
  assert.ok(preview.ok);
  assert.ok(saveV1Migration(preview.value, () => store).ok);
  assert.equal(store.getItem(COURSE_STORAGE_KEY), source);
  assert.equal(store.writes.at(-1), MANAGED_COURSE_STORAGE_KEY);
  const restored = loadManagedCourses(() => store);
  assert.ok(restored.ok);
  assert.deepEqual(restored.value.courses, preview.value.courses);
  const v1 = loadCourses(() => store);
  assert.ok(v1.ok);
  assert.deepEqual(v1.courses, [legacy()]);
  assert.ok(saveCourses([], v1.snapshot, () => store).ok);
  assert.equal(store.getItem(MANAGED_COURSE_STORAGE_KEY), restored.value.snapshot);
});

test('migration quota failure retains v1 and preview and retry can restore v2', () => {
  const store = memory();
  assert.ok(saveCourses([legacy()], null, () => store).ok);
  const preview = prepareV1Migration(() => store);
  assert.ok(preview.ok);
  const original = structuredClone(preview.value);
  const source = store.getItem(COURSE_STORAGE_KEY);
  const denied: CourseStorage = { getItem: store.getItem, setItem() { throw new Error('QuotaExceededError'); } };
  assert.equal(saveV1Migration(preview.value, () => denied).ok, false);
  assert.equal(store.getItem(COURSE_STORAGE_KEY), source);
  assert.equal(store.getItem(MANAGED_COURSE_STORAGE_KEY), null);
  assert.deepEqual(preview.value, original);
  assert.ok(saveV1Migration(preview.value, () => store).ok);
  assert.equal(store.getItem(COURSE_STORAGE_KEY), source);
});

test('failed v2 update retains previous v2, v1 and edited records; retry works', () => {
  const store = memory();
  assert.ok(saveCourses([legacy()], null, () => store).ok);
  const source = store.getItem(COURSE_STORAGE_KEY);
  const first = saveManagedCourses([managed()], null, () => store);
  assert.ok(first.ok);
  const next = [{ ...managed(), name: '수정한 과목' }];
  const denied: CourseStorage = { getItem: store.getItem, setItem() { throw new Error('full'); } };
  assert.equal(saveManagedCourses(next, first.value.snapshot, () => denied).ok, false);
  assert.equal(store.getItem(MANAGED_COURSE_STORAGE_KEY), first.value.snapshot);
  assert.equal(store.getItem(COURSE_STORAGE_KEY), source);
  assert.equal(next[0].name, '수정한 과목');
  assert.ok(saveManagedCourses(next, first.value.snapshot, () => store).ok);
});

test('migration detects a changed/deleted v1 source and does not recreate or overwrite existing v2', () => {
  const store = memory();
  const first = saveCourses([legacy()], null, () => store);
  assert.ok(first.ok);
  const preview = prepareV1Migration(() => store);
  assert.ok(preview.ok);
  assert.ok(saveCourses([], first.snapshot, () => store).ok);
  assert.equal(saveV1Migration(preview.value, () => store).ok, false);
  assert.equal(store.getItem(MANAGED_COURSE_STORAGE_KEY), null);
  const fresh = prepareV1Migration(() => store);
  assert.ok(fresh.ok);
  assert.ok(saveV1Migration(fresh.value, () => store).ok);
  const saved = store.getItem(MANAGED_COURSE_STORAGE_KEY);
  assert.equal(saveV1Migration(fresh.value, () => store).ok, false);
  assert.equal(prepareV1Migration(() => store).ok, false);
  assert.equal(store.getItem(MANAGED_COURSE_STORAGE_KEY), saved);
});

test('stale v2 writes and invalid payloads never overwrite a valid snapshot', () => {
  const store = memory();
  const first = saveManagedCourses([managed()], null, () => store);
  assert.ok(first.ok);
  const next = saveManagedCourses([], first.value.snapshot, () => store);
  assert.ok(next.ok);
  assert.equal(saveManagedCourses([managed()], first.value.snapshot, () => store).ok, false);
  assert.equal(saveManagedCourses([{ ...managed(), name: '' }], next.value.snapshot, () => store).ok, false);
  assert.equal(store.getItem(MANAGED_COURSE_STORAGE_KEY), next.value.snapshot);
  const restored = loadManagedCourses(() => store);
  assert.ok(restored.ok);
  assert.deepEqual(restored.value.courses, []);
});

test('corrupt/unsupported v2 never falls back to v1 or gets overwritten by migration', () => {
  for (const raw of ['{bad', 'null', '[]', JSON.stringify({ version: 3, courses: [] }), JSON.stringify({ version: 2, courses: [legacy()] }), JSON.stringify({ version: 2, courses: {} })]) {
    const store = memory();
    assert.ok(saveCourses([legacy()], null, () => store).ok);
    store.setItem(MANAGED_COURSE_STORAGE_KEY, raw);
    assert.equal(loadManagedCourses(() => store).ok, false);
    assert.equal(prepareV1Migration(() => store).ok, false);
    assert.equal(saveManagedCourses([], raw, () => store).ok, false);
    assert.equal(store.getItem(MANAGED_COURSE_STORAGE_KEY), raw);
  }
});

test('malformed v1 and storage access/read denial do not create v2', () => {
  for (const raw of ['{bad', 'null', JSON.stringify({ version: 1, courses: [{ ...legacy(), credits: -1 }] })]) {
    const store = memory();
    store.setItem(COURSE_STORAGE_KEY, raw);
    assert.equal(prepareV1Migration(() => store).ok, false);
    assert.equal(store.getItem(COURSE_STORAGE_KEY), raw);
    assert.equal(store.getItem(MANAGED_COURSE_STORAGE_KEY), null);
  }
  const denied = () => { throw new Error('SecurityError'); };
  assert.equal(loadManagedCourses(denied).ok, false);
  assert.equal(saveManagedCourses([], null, denied).ok, false);
  assert.equal(prepareV1Migration(denied).ok, false);
  assert.equal(loadManagedCourses(() => ({ getItem() { throw new Error('read'); }, setItem() {} })).ok, false);
});
