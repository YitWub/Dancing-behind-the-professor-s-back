import test from 'node:test';
import assert from 'node:assert/strict';
import type { AssignmentGroup, AssignmentTask, AssessmentProgress, ManagedAssessment, ManagedCourse } from '../management-types.ts';
import { assignmentChangeMessages, assignmentAggregateScore, computeAssignmentBalance, transitionAssignmentTask, validateAssignmentGroup } from '../assignments.ts';
import { computeManagedBalance } from '../managed-balance.ts';
import { migrateV1Courses, toEngineCourse, transitionAssessment, validateManagedCourse } from '../management.ts';
import { newCourse } from '../course-validation.ts';
import { COURSE_STORAGE_KEY, saveCourses, type CourseStorage } from '../course-storage.ts';
import { MANAGED_COURSE_STORAGE_KEY, loadManagedCourses, prepareV1Migration, saveManagedCourses, saveV1Migration } from '../managed-storage.ts';
import { predict } from '../predict.ts';

function fixture(): ManagedCourse {
  const converted = migrateV1Courses([{ ...newCourse('c1'), name: '과제 테스트', enrolled: 40 }]);
  assert.ok(converted.ok);
  return { ...converted.value[0], assessments: converted.value[0].assessments.map((a) => {
    const next = transitionAssessment(a, { status: 'scheduled' });
    assert.ok(next.ok);
    return next.value;
  }) };
}
function task(index: number, progress: AssessmentProgress = { status: 'scheduled' }): AssignmentTask {
  return { id: `t${index}`, name: `과제 ${index}`, weight: null, maxScore: 100, progress };
}
function grouped(allocation: AssignmentGroup['allocation'] = 'equal', count = 5): ManagedCourse {
  const c = fixture();
  c.assessments[2].assignmentGroup = { allocation, tasks: Array.from({ length: count }, (_, i) => task(i + 1)) };
  return c;
}
function memory(): CourseStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } };
}
const close = (n: number, expected: number) => assert.ok(Math.abs(n - expected) < 1e-9, `${n} != ${expected}`);

test('equal 20% group / 5 tasks reproduces 3.2 secured, 0.8 lost, 4 ungraded, 12 remaining', () => {
  const c = grouped();
  const a = c.assessments[2];
  a.assignmentGroup!.tasks[0].progress = { status: 'graded', score: 80 };
  a.assignmentGroup!.tasks[1].progress = { status: 'awaiting_grade' };
  const result = computeAssignmentBalance(a);
  assert.ok(result.ok);
  close(result.value.balance.secured, 3.2); close(result.value.balance.lost, 0.8);
  close(result.value.balance.ungraded, 4); close(result.value.balance.remaining, 12);
  close(result.value.tasks[0].points!, 4);
  const total = computeManagedBalance(c);
  assert.ok(total.ok);
  close(total.value.balance.remaining, 92);
  close(Object.values(total.value.balance).reduce((sum, n) => sum + n, 0), 100);
  assert.equal(total.value.complete, true);
  assert.equal(toEngineCourse(c).ok, false, 'partial group never becomes five probability inputs');
});

test('individual shares respect unequal max scores and zero submission loss', () => {
  const c = grouped('individual', 3);
  const group = c.assessments[2].assignmentGroup!;
  group.tasks = [
    { ...task(1, { status: 'graded', score: 8 }), maxScore: 10, weight: 0.5 },
    { ...task(2, { status: 'zero_confirmed', reason: 'not_submitted' }), weight: 0.3 },
    { ...task(3, { status: 'awaiting_grade' }), weight: 0.2 },
  ];
  const result = computeAssignmentBalance(c.assessments[2]);
  assert.ok(result.ok);
  close(result.value.balance.secured, 8); close(result.value.balance.lost, 8);
  close(result.value.balance.ungraded, 4); close(result.value.balance.remaining, 0);
});

test('unconfirmed allocation stores actual records but does not guess any task share', () => {
  const c = grouped('unconfirmed');
  c.assessments[2].assignmentGroup!.tasks[0].progress = { status: 'graded', score: 80 };
  const detail = computeAssignmentBalance(c.assessments[2]);
  assert.ok(detail.ok);
  assert.equal(detail.value.complete, false);
  assert.deepEqual(detail.value.balance, { secured: 0, lost: 0, ungraded: 0, remaining: 0 });
  assert.equal(detail.value.unclassifiedPoints, 20);
  assert.ok(detail.value.tasks.every((t) => t.points === null && t.share === null && t.balance === null));
  const total = computeManagedBalance(c);
  assert.ok(total.ok);
  close(total.value.balance.remaining, 80);
  close(total.value.review.unclassifiedPoints, 20);
  assert.equal(total.value.complete, false);
  assert.equal(toEngineCourse(c).ok, false);
});

test('malformed counts, allocation, task names, IDs and nested groups are rejected', () => {
  for (const group of [null, {}, { allocation: 'other', tasks: [task(1)] }, { allocation: 'equal', tasks: [] }, { allocation: 'equal', tasks: {} },
    { allocation: 'equal', tasks: [task(1), task(1)] }, { allocation: 'equal', tasks: [{ ...task(1), name: '' }] },
    { allocation: 'equal', tasks: [{ ...task(1), assignmentGroup: {} }] }, { allocation: 'equal', tasks: [null] }]) {
    assert.ok(validateAssignmentGroup(group).length > 0);
  }
});

test('invalid shares are not normalized; group and course weight sums are separate', () => {
  for (const weight of [-1, 1.1, NaN, Infinity, null, 0.9]) {
    const c = grouped('individual', 1);
    c.assessments[2].assignmentGroup!.tasks[0].weight = weight;
    assert.ok(validateManagedCourse(c).length > 0);
    assert.equal(computeManagedBalance(c).ok, false);
  }
  const c = grouped('individual', 2);
  c.assessments[2].assignmentGroup!.tasks.forEach((t) => { t.weight = 0.5; });
  assert.deepEqual(validateManagedCourse(c), []);
  c.assessments[2].weight = 0.3;
  assert.ok(validateManagedCourse(c).length > 0, 'valid inner shares cannot hide invalid course sum');
  assert.ok(validateAssignmentGroup({ allocation: 'equal', tasks: [{ ...task(1), weight: 1 }] }).length > 0);
});

test('all task progress transitions preserve the source and 0 is distinct from non-submission', () => {
  const states: AssessmentProgress[] = [{ status: 'scheduled' }, { status: 'awaiting_grade' }, { status: 'graded', score: 0 }, { status: 'zero_confirmed', reason: 'not_submitted' }];
  for (const before of states) for (const after of states) {
    const original = task(1, before);
    const snapshot = structuredClone(original);
    const next = transitionAssignmentTask(original, after);
    assert.ok(next.ok);
    assert.deepEqual(next.value.progress, after);
    assert.deepEqual(original, snapshot);
    const c = grouped('equal', 1);
    c.assessments[2].assignmentGroup!.tasks[0] = next.value;
    const result = computeAssignmentBalance(c.assessments[2]);
    assert.ok(result.ok);
    close(Object.values(result.value.balance).reduce((s, n) => s + n, 0), 20);
  }
});

test('task score, max score and non-submission reason validation is enforced', () => {
  for (const progress of [{ status: 'graded', score: -1 }, { status: 'graded', score: 101 }, { status: 'graded', score: NaN }, { status: 'awaiting_grade', score: 0 }, { status: 'zero_confirmed', reason: 'absent' }]) {
    assert.equal(transitionAssignmentTask(task(1), progress as AssessmentProgress).ok, false);
  }
  for (const maxScore of [0, -1, NaN, Infinity]) assert.ok(validateAssignmentGroup({ allocation: 'equal', tasks: [{ ...task(1), maxScore }] }).length > 0);
});

test('archived parent grade and child grades never contribute twice, including legacy-null parents', () => {
  const c = grouped('equal', 1);
  const single = c.assessments[2];
  assert.ok(single.progress !== null);
  c.assessments[2] = { ...single, progress: { status: 'graded', score: 100 } };
  c.assessments[2].assignmentGroup!.tasks[0].progress = { status: 'graded', score: 80 };
  const result = computeManagedBalance(c);
  assert.ok(result.ok);
  close(result.value.balance.secured, 16); close(result.value.balance.lost, 4);
  assert.equal(transitionAssessment(c.assessments[2], { status: 'scheduled' }).ok, false);
  const legacyNull = { ...c.assessments[2], progress: null, reviewRequired: 'legacy_null_score' } as ManagedAssessment;
  c.assessments[2] = legacyNull;
  const migrated = computeManagedBalance(c);
  assert.ok(migrated.ok);
  assert.equal(migrated.value.complete, true);
  assert.ok(toEngineCourse(c).ok);
});

test('fully scored group becomes exactly one aggregate observation with unchanged group stats', () => {
  const c = grouped('individual', 2);
  const a = c.assessments[2];
  a.mean = 65; a.stdev = 12;
  a.assignmentGroup!.tasks = [{ ...task(1, { status: 'graded', score: 80 }), weight: 0.25 }, { ...task(2, { status: 'graded', score: 60 }), weight: 0.75 }];
  const aggregate = assignmentAggregateScore(a);
  assert.ok(aggregate.ok); close(aggregate.value, 65);
  const adapted = toEngineCourse(c);
  assert.ok(adapted.ok);
  assert.equal(adapted.value.assessments.length, c.assessments.length);
  close(adapted.value.assessments[2].myScore!, 65);
  assert.equal(adapted.value.assessments[2].mean, 65);
  assert.equal(adapted.value.assessments[2].stdev, 12);
  const equivalent = { ...adapted.value, assessments: adapted.value.assessments.map((item) => item.id === a.id ? { ...item, myScore: 65 } : item) };
  const actual = predict(adapted.value);
  const expected = predict(equivalent);
  close(actual.balance.secured, expected.balance.secured);
  assert.equal(actual.tier, expected.tier);
  assert.ok(actual.distribution && expected.distribution);
  actual.distribution.forEach((entry, index) => close(entry.atLeastProb, expected.distribution![index].atLeastProb));
});

test('pending groups refuse aggregation even with rank information or archived full marks', () => {
  for (const status of ['scheduled', 'awaiting_grade'] as const) {
    const c = grouped('equal', 1);
    c.myRank = 1;
    const single = c.assessments[2];
    assert.ok(single.progress !== null);
    c.assessments[2] = { ...single, progress: { status: 'graded', score: 100 } };
    c.assessments[2].assignmentGroup!.tasks[0].progress = { status };
    assert.equal(toEngineCourse(c).ok, false);
  }
});

test('task insertion/removal and equal redistribution are explicit, source records remain unchanged', () => {
  const c = grouped();
  c.assessments[2].assignmentGroup!.tasks[0].progress = { status: 'graded', score: 80 };
  const original = structuredClone(c);
  const next = structuredClone(c);
  next.assessments[2].assignmentGroup!.tasks.push(task(6));
  const changes = assignmentChangeMessages([c], [next]);
  assert.ok(changes.some((m) => m.includes('과제 1') && m.includes('최종 배점')));
  assert.deepEqual(c, original);
  next.assessments[2].assignmentGroup!.tasks.shift();
  assert.ok(assignmentChangeMessages([c], [next]).some((m) => m.includes('기록이 삭제')));
});

test('storage requires confirmation for group conversion, redistribution, deleting tasks/groups/courses', () => {
  const store = memory();
  const base = fixture();
  const first = saveManagedCourses([base], null, () => store); assert.ok(first.ok);
  const c = grouped();
  assert.equal(saveManagedCourses([c], first.value.snapshot, () => store).ok, false);
  assert.equal(store.getItem(MANAGED_COURSE_STORAGE_KEY), first.value.snapshot);
  const converted = saveManagedCourses([c], first.value.snapshot, () => store, true); assert.ok(converted.ok);
  const next = structuredClone(c);
  next.assessments[2].assignmentGroup!.tasks.push(task(6));
  assert.equal(saveManagedCourses([next], converted.value.snapshot, () => store).ok, false);
  assert.equal(saveManagedCourses([], converted.value.snapshot, () => store).ok, false);
  const restoredSingle = fixture();
  assert.equal(saveManagedCourses([restoredSingle], converted.value.snapshot, () => store).ok, false);
  assert.ok(saveManagedCourses([next], converted.value.snapshot, () => store, true).ok);
});

test('ordinary task status updates and renames persist without destructive confirmation', () => {
  const store = memory();
  const c = grouped();
  const first = saveManagedCourses([c], null, () => store); assert.ok(first.ok);
  const next = structuredClone(c);
  next.assessments[2].assignmentGroup!.tasks[0] = { ...task(1, { status: 'awaiting_grade' }), name: '첫 과제' };
  assert.deepEqual(assignmentChangeMessages([c], [next]), []);
  assert.ok(saveManagedCourses([next], first.value.snapshot, () => store).ok);
});

test('group save and restore preserve archived scores, allocation, IDs and each task progress', () => {
  const store = memory();
  const c = grouped('unconfirmed');
  c.assessments[2].assignmentGroup!.tasks[0].progress = { status: 'graded', score: 80 };
  const saved = saveManagedCourses([c], null, () => store); assert.ok(saved.ok);
  const restored = loadManagedCourses(() => store); assert.ok(restored.ok);
  assert.deepEqual(restored.value.courses, [c]);
});

test('failed group save retains last snapshot and edited draft; successful retry preserves v1', () => {
  const store = memory();
  const legacy = { ...newCourse('legacy'), name: '기존 과제' };
  assert.ok(saveCourses([legacy], null, () => store).ok);
  const source = store.getItem(COURSE_STORAGE_KEY);
  const c = grouped();
  const saved = saveManagedCourses([c], null, () => store); assert.ok(saved.ok);
  const draft = structuredClone(c);
  draft.assessments[2].assignmentGroup!.tasks[0].progress = { status: 'graded', score: 80 };
  const failedStorage: CourseStorage = { getItem: store.getItem, setItem() { throw new Error('QuotaExceededError'); } };
  assert.equal(saveManagedCourses([draft], saved.value.snapshot, () => failedStorage).ok, false);
  assert.equal(store.getItem(MANAGED_COURSE_STORAGE_KEY), saved.value.snapshot);
  assert.equal(draft.assessments[2].assignmentGroup!.tasks[0].progress.status, 'graded');
  assert.ok(saveManagedCourses([draft], saved.value.snapshot, () => store).ok);
  assert.equal(store.getItem(COURSE_STORAGE_KEY), source);
});

test('v1 conversion and pre-group v2 restoration remain single assignments without automatic splitting', () => {
  const store = memory();
  const legacy = { ...newCourse('c1'), name: '단일 과제' };
  legacy.assessments[2].myScore = 80;
  assert.ok(saveCourses([legacy], null, () => store).ok);
  const preview = prepareV1Migration(() => store); assert.ok(preview.ok);
  assert.equal(preview.value.courses[0].assessments[2].assignmentGroup, undefined);
  assert.equal(preview.value.courses[0].assessments.length, 4);
  assert.ok(saveV1Migration(preview.value, () => store).ok);
  const restored = loadManagedCourses(() => store); assert.ok(restored.ok);
  assert.deepEqual(restored.value.courses, preview.value.courses);
  assert.deepEqual(restored.value.courses[0].assessments[2].progress, { status: 'graded', score: 80 });
});

test('zero-weight groups and fractional shares keep conservation without rounding each task', () => {
  const c = grouped('individual', 3);
  c.assessments[2].assignmentGroup!.tasks.forEach((t, i) => { t.weight = [0.3333, 0.3333, 0.3334][i]; t.progress = { status: 'graded', score: 73 }; });
  const detail = computeAssignmentBalance(c.assessments[2]); assert.ok(detail.ok);
  close(detail.value.balance.secured, 14.6); close(detail.value.balance.lost, 5.4);
  const zero = computeAssignmentBalance({ ...c.assessments[2], weight: 0 }); assert.ok(zero.ok);
  close(Object.values(zero.value.balance).reduce((sum, n) => sum + n, 0), 0);
});
