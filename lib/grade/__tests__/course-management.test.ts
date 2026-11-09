import test from 'node:test';
import assert from 'node:assert/strict';
import type { Course } from '../../types.ts';
import { fromCourseDraft, newCourse, toCourseDraft, validateCourse, validateCourses } from '../course-validation.ts';
import { COURSE_STORAGE_KEY, loadCourses, saveCourses, type CourseStorage } from '../course-storage.ts';
import { predict } from '../predict.ts';
import { allocate } from '../allocation.ts';

function course(id = 'course-1'): Course {
  return { ...newCourse(id), name: '자료구조', enrolled: 40 };
}
function memory(): CourseStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } };
}

test('new course has editable presets totalling 100%, with unknown scores and no invented attendance', () => {
  const c = course();
  assert.deepEqual(validateCourse(c), []);
  assert.ok(Math.abs(c.assessments.reduce((sum, a) => sum + a.weight, 0) - 1) < 1e-12);
  assert.ok(c.assessments.every((a) => a.myScore === null && a.mean === null && a.stdev === null));
  assert.equal(c.attendance, null);
});

test('editor round trip retains IDs, rank, attendance, zero scores and stats', () => {
  const c = course();
  c.myRank = 3;
  c.attendance = { totalSessions: 30, absences: 1, lateness: 2, allowedAbsences: 6, penaltyPerAbsence: 2, latePerAbsence: 3 };
  c.assessments[0] = { ...c.assessments[0], myScore: 0, mean: 70, stdev: 12 };
  assert.deepEqual(fromCourseDraft(toCourseDraft(c)), c);
});

test('percent input converts to engine weights; trim names and preserve fractional percentages', () => {
  const d = toCourseDraft(course());
  d.name = '  자료구조  ';
  d.assessments = d.assessments.slice(0, 3);
  ['33.33', '33.33', '33.34'].forEach((p, i) => { d.assessments[i].percent = p; });
  const c = fromCourseDraft(d);
  assert.equal(c.name, '자료구조');
  assert.equal(c.assessments[0].weight, 0.3333);
  assert.deepEqual(validateCourse(c), []);
});

test('reject totals below/above 100%, negative, over 100, NaN and infinite weights', () => {
  for (const weight of [0.2999, 0.4, -0.1, 1.01, NaN, Infinity]) {
    const c = course();
    c.assessments[0].weight = weight;
    assert.ok(validateCourse(c).length > 0, `weight ${weight}`);
  }
});

test('blank required fields do not silently become valid zeroes', () => {
  for (const field of ['percent', 'maxScore'] as const) {
    const d = toCourseDraft(course());
    d.assessments[0][field] = '';
    assert.ok(validateCourse(fromCourseDraft(d)).length > 0);
  }
  const d = toCourseDraft(course());
  d.credits = '';
  assert.ok(validateCourse(fromCourseDraft(d)).length > 0);
});

test('optional blank scores are null, actual zero scores stay zero', () => {
  const d = toCourseDraft(course());
  d.assessments[0].myScore = '0';
  const c = fromCourseDraft(d);
  assert.equal(c.assessments[0].myScore, 0);
  assert.equal(c.assessments[1].myScore, null);
  assert.deepEqual(validateCourse(c), []);
});

test('duplicate assessment names normalize spaces, case and Unicode; renamed assignments are allowed', () => {
  const c = course();
  c.assessments[0].name = '과제 A';
  c.assessments[1].name = ' 과제ａ ';
  assert.ok(validateCourse(c).some((e) => e.includes('중복')));
  c.assessments[1].name = '과제 B';
  assert.deepEqual(validateCourse(c), []);
  c.assessments[1].id = c.assessments[0].id;
  assert.ok(validateCourse(c).some((e) => e.includes('ID')));
});

test('removing and adding assessment rows is validated before storage', () => {
  const d = toCourseDraft(course());
  const removedId = d.assessments.pop()!.id;
  assert.ok(validateCourse(fromCourseDraft(d)).length > 0);
  d.assessments.push({ id: 'custom', name: '발표', percent: '10', maxScore: '20', myScore: '18', mean: '', stdev: '', ceilingClustered: false });
  const c = fromCourseDraft(d);
  assert.deepEqual(validateCourse(c), []);
  assert.ok(!c.assessments.some((a) => a.id === removedId));
  assert.equal(c.assessments.at(-1)!.name, '발표');
});

test('reject invalid course metadata, missing fields, invalid scores, stats and empty assessments', () => {
  for (const patch of [{ name: ' ' }, { credits: -1 }, { enrolled: 1.5 }, { enrolled: NaN }, { isAbsolute: 'yes' }, { assessments: [] }, { attendance: {} }, { myRank: 41 }]) {
    assert.ok(validateCourse({ ...course(), ...patch }).length > 0);
  }
  for (const patch of [{ myScore: -1 }, { myScore: 101 }, { mean: NaN }, { stdev: 0 }, { stdev: Infinity }, { maxScore: 0 }, { name: '' }, { ceilingClustered: 'true' }]) {
    const c = course();
    assert.ok(validateCourse({ ...c, assessments: [{ ...c.assessments[0], ...patch }, ...c.assessments.slice(1)] }).length > 0);
  }
  for (const bad of [null, [], {}, 'course', { ...course(), assessments: [null] }]) assert.ok(validateCourse(bad).length > 0);
});

test('duplicate course IDs rejected; same course names with different IDs allowed', () => {
  assert.ok(validateCourses([course(), course()]).length > 0);
  assert.deepEqual(validateCourses([course('1'), course('2')]), []);
  assert.deepEqual(validateCourses([]), []);
});

test('empty storage loads no mocks and does not write on load', () => {
  const storage = memory();
  assert.deepEqual(loadCourses(() => storage), { ok: true, courses: [], snapshot: null });
  assert.equal(storage.data.size, 0);
});

test('CRUD persists across fresh reads, including deleting the last course', () => {
  const storage = memory();
  const access = () => storage;
  const c = course();
  const added = saveCourses([c], null, access);
  assert.ok(added.ok);
  const restored = loadCourses(access);
  assert.ok(restored.ok);
  assert.deepEqual(restored.courses, [c]);
  const changed = { ...c, name: '자료구조론', assessments: c.assessments.map((a) => ({ ...a, myScore: 80 })) };
  const updated = saveCourses([changed], added.snapshot, access);
  assert.ok(updated.ok);
  const again = loadCourses(access);
  assert.ok(again.ok);
  assert.deepEqual(again.courses, [changed]);
  assert.ok(saveCourses([], updated.snapshot, access).ok);
  const empty = loadCourses(access);
  assert.ok(empty.ok);
  assert.deepEqual(empty.courses, []);
});

test('malformed JSON, unknown versions and invalid payloads are not overwritten', () => {
  for (const raw of ['{bad', 'null', JSON.stringify({ version: 2, courses: [] }), JSON.stringify({ version: 1, courses: {} }), JSON.stringify({ version: 1, courses: [{ ...course(), assessments: [] }] })]) {
    const storage = memory();
    storage.setItem(COURSE_STORAGE_KEY, raw);
    assert.equal(loadCourses(() => storage).ok, false);
    assert.equal(saveCourses([course()], raw, () => storage).ok, false);
    assert.equal(storage.getItem(COURSE_STORAGE_KEY), raw);
  }
});

test('invalid input is rejected before any write and preserves previous data', () => {
  const storage = memory();
  const first = saveCourses([course()], null, () => storage);
  assert.ok(first.ok);
  assert.equal(saveCourses([{ ...course(), name: '' }], first.snapshot, () => storage).ok, false);
  assert.equal(storage.getItem(COURSE_STORAGE_KEY), first.snapshot);
});

test('storage getter/read failures are reported rather than treated as an empty list', () => {
  const denied = () => { throw new Error('SecurityError'); };
  assert.equal(loadCourses(denied).ok, false);
  assert.equal(saveCourses([], null, denied).ok, false);
  assert.equal(loadCourses(() => ({ getItem() { throw new Error('read'); }, setItem() {} })).ok, false);
});

test('quota failure preserves data and caller draft, then retry succeeds', () => {
  const storage = memory();
  const c = course();
  const first = saveCourses([c], null, () => storage);
  assert.ok(first.ok);
  const next = [{ ...c, name: '수정한 이름' }];
  const failing: CourseStorage = { getItem: storage.getItem, setItem() { throw new Error('QuotaExceededError'); } };
  assert.equal(saveCourses(next, first.snapshot, () => failing).ok, false);
  assert.equal(storage.getItem(COURSE_STORAGE_KEY), first.snapshot);
  assert.equal(next[0].name, '수정한 이름');
  assert.ok(saveCourses(next, first.snapshot, () => storage).ok);
});

test('stale tab cannot overwrite a newer change or deletion', () => {
  const storage = memory();
  const first = saveCourses([course()], null, () => storage);
  assert.ok(first.ok);
  const second = saveCourses([], first.snapshot, () => storage);
  assert.ok(second.ok);
  const stale = saveCourses([course('other')], first.snapshot, () => storage);
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.match(stale.error, /다른 탭/);
  assert.equal(storage.getItem(COURSE_STORAGE_KEY), second.snapshot);
});

test('restored user scores reach existing balance, distribution and allocation engines unchanged', () => {
  const c = course();
  c.assessments.forEach((a) => { a.myScore = 80; a.mean = 70; a.stdev = 12; });
  const original = structuredClone(c);
  const storage = memory();
  assert.ok(saveCourses([c], null, () => storage).ok);
  const restored = loadCourses(() => storage);
  assert.ok(restored.ok);
  const p = predict(restored.courses[0]);
  assert.equal(p.courseId, c.id);
  assert.equal(p.balance.secured, 80);
  assert.equal(p.balance.lost, 20);
  assert.ok(p.distribution);
  assert.equal(allocate(restored.courses)[0].courseId, c.id);
  assert.deepEqual(predict(c), p);
  assert.deepEqual(c, original);
  const noStats = predict(course());
  assert.equal(noStats.distribution, null);
});
