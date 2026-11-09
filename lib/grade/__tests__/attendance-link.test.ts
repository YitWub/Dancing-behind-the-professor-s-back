import test from 'node:test';
import assert from 'node:assert/strict';
import { newCourse } from '../course-validation.ts';
import { migrateV1Courses, validateManagedCourse, toEngineCourse } from '../management.ts';
import type { ManagedCourse } from '../management-types.ts';
import { prepareAttendanceEstimate, estimateAttendance } from '../attendance-estimate.ts';
import { resolveAttendanceAssessmentId, reconcileAttendanceLink, attendanceLinkOptions, attendanceLinkChangeError, selectAttendanceAssessment, removeAssessmentWithAttendanceLink } from '../attendance-link.ts';
import { computeManagedBalance } from '../managed-balance.ts';
import { buildWeightPreview, parseImageExtraction, applyWeightPreview } from '../assessment-image.ts';
import { autoSaveChanges, createAutoSaveQueue } from '../autosave.ts';
import { saveManagedCourses, loadManagedCourses } from '../managed-storage.ts';

const names = ['주차학습', '과제', '팀프로젝트', '중간고사', '학습참여도', '강의자료실'];
function course(): ManagedCourse {
  return {
    ...newCourse('link'), name: '출석 연결',
    assessments: names.map((name, i) => ({ id: `item-${i}`, name, weight: [.1, .1, .4, .3, .1, 0][i], maxScore: 100, mean: null, stdev: null, ceilingClustered: false, progress: { status: 'scheduled' } })),
    attendanceEstimate: { model: 'equal-15-v1', assessmentId: null, absences: 1, lateness: 2 },
  };
}
function selected(c: ManagedCourse, id: string | null) {
  const result = selectAttendanceAssessment(c, id);
  assert.ok(result.ok, result.ok ? '' : result.errors.join(' '));
  return result.value;
}
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
};

test('only exact attendance names auto-link; weekly learning, participation and ambiguous names do not', () => {
  for (const [name, expected] of [['출석', true], ['출결', true], ['Attendance', true], [' attendance ', true], ['주차학습', false], ['학습참여도', false], ['수업태도', false], ['출석 및 참여', false], ['Attendance score', false]] as const) {
    const c = course(); delete c.attendanceEstimate; c.assessments[0].name = name;
    assert.equal(prepareAttendanceEstimate(c).value.assessmentId, expected ? 'item-0' : null, name);
  }
  const c = course(); delete c.attendanceEstimate; c.assessments[0].name = '출석'; c.assessments[4].name = '출결';
  assert.equal(prepareAttendanceEstimate(c).value.assessmentId, null);
  c.assessments[0].weight = 0; c.assessments[4].weight = 0;
  assert.equal(prepareAttendanceEstimate(c).value.assessmentId, null);
});

test('unselected null can auto-link once and the captured ID survives renaming', () => {
  const c = course(); c.assessments[0].name = '출석';
  c.attendanceEstimate = reconcileAttendanceLink(c.assessments, c.attendanceEstimate!);
  assert.equal(c.attendanceEstimate.assessmentId, 'item-0');
  c.assessments[0].name = '온라인 학습';
  assert.equal(prepareAttendanceEstimate(c).value.assessmentId, 'item-0');
  assert.equal(resolveAttendanceAssessmentId(c.assessments, c.attendanceEstimate), 'item-0');
});

test('legacy unselected null resolves consistently in scoring and engine adaptation without rewriting the stored record',()=>{
  const c=course();c.assessments[0].name='출석';const before=structuredClone(c);
  close(estimateAttendance(c).maximum,10);
  const balance=computeManagedBalance(c);assert.ok(balance.ok);close(balance.value.balance.secured,10-10/15);
  const adapted=toEngineCourse(c);assert.ok(adapted.ok);close(adapted.value.assessments[0].myScore!,100*(1-1/15));
  assert.deepEqual(c,before);
});

test('manual weekly-learning selection uses its actual percentage without renaming or modifying other records', () => {
  const c = course(); c.assessments[3].progress = { status: 'graded', score: 80 };
  const before = structuredClone(c), next = selected(c, 'item-0');
  assert.equal(next.attendanceEstimate!.selection, 'manual'); assert.deepEqual(next.assessments, before.assessments);
  assert.deepEqual(validateManagedCourse(next), []); close(estimateAttendance(next).deduction, 10 / 15);
  const balance = computeManagedBalance(next); assert.ok(balance.ok); close(balance.value.balance.secured, 24 + 10 - 10 / 15);
  assert.deepEqual(c, before); assert.equal(next.assessments[0].name, '주차학습');
});

test('manual none remains disconnected through clear-name additions, renames and reload', () => {
  const c = selected(course(), null); c.assessments[0].name = '출석'; c.assessments[4].name = '출결';
  const prepared = prepareAttendanceEstimate(c);
  assert.equal(prepared.value.assessmentId, null); assert.equal(prepared.value.selection, 'manual');
  assert.deepEqual(validateManagedCourse(c), []);
  close(estimateAttendance(c).maximum, 0); close(estimateAttendance(c).deduction, 0);
  c.attendanceEstimate!.absences = 6; assert.equal(estimateAttendance(c).caution, 'below_reference');
  const store = memory(); assert.ok(saveManagedCourses([c], null, () => store).ok);
  const loaded = loadManagedCourses(() => store); assert.ok(loaded.ok);
  assert.equal(prepareAttendanceEstimate(loaded.value.courses[0]).value.assessmentId, null);
  assert.equal(loaded.value.courses[0].attendanceEstimate!.absences, 6);
});

test('ID-based manual choice wins over names and multiple automatic candidates', () => {
  const c = selected(course(), 'item-0'); c.assessments[0].name = '주간 미션'; c.assessments[4].name = 'Attendance';
  c.assessments[1].name = '출결';
  const next = reconcileAttendanceLink(c.assessments, c.attendanceEstimate!);
  assert.equal(next.assessmentId, 'item-0'); assert.equal(next.selection, 'manual');
});

test('options follow names, percentages, additions and deletions; zero and scored/grouped items are disabled', () => {
  const c = course(); c.assessments[3].progress = { status: 'graded', score: 80 };
  c.assessments[1].assignmentGroup = { allocation: 'equal', tasks: [{ id: 'task', name: '보고서', maxScore: 100, weight: null, progress: { status: 'scheduled' } }] };
  let options = attendanceLinkOptions(c.assessments, null);
  assert.ok(options.find((a) => a.id === 'item-5')!.reason); assert.ok(options.find((a) => a.id === 'item-3')!.reason);
  assert.ok(options.find((a) => a.id === 'item-1')!.reason);
  c.assessments[0].name = '주별 활동'; c.assessments[0].weight = .2;
  c.assessments = c.assessments.filter((a) => a.id !== 'item-5');
  c.assessments.push({ ...c.assessments[4], id: 'new', name: '새 활동', weight: .1 });
  options = attendanceLinkOptions(c.assessments, null);
  assert.equal(options.find((a) => a.id === 'item-0')!.name, '주별 활동');
  close(options.find((a) => a.id === 'item-0')!.weight, .2);
  assert.ok(options.some((a) => a.id === 'new')); assert.equal(options.some((a) => a.id === 'item-5'), false);
});

test('selecting a recorded exam, pending result or assignment group is safely rejected without any mutation', () => {
  for (const status of ['graded', 'awaiting_grade', 'zero_confirmed'] as const) {
    const c = course(); c.assessments[3].progress = status === 'graded' ? { status, score: 80 } : status === 'zero_confirmed' ? { status, reason: 'absent' } : { status };
    const before = structuredClone(c); assert.equal(selectAttendanceAssessment(c, 'item-3').ok, false); assert.deepEqual(c, before);
  }
  const c = course(); c.assessments[2].assignmentGroup = { allocation: 'unconfirmed', tasks: [] };
  assert.equal(selectAttendanceAssessment(c, 'item-2').ok, false); assert.equal(selectAttendanceAssessment(c, 'item-5').ok, false);
});

test('ordinary 10% link switch and unlink preserve counts, names and results without duplicate deductions', () => {
  const c = selected(course(), 'item-4'), before = structuredClone(c);
  const next = selected(c, 'item-0');
  assert.deepEqual(next.assessments, c.assessments); assert.equal(next.attendanceEstimate!.absences, 1); assert.equal(next.attendanceEstimate!.lateness, 2);
  const balance = computeManagedBalance(next); assert.ok(balance.ok); close(balance.value.balance.lost, 10 / 15);
  const none = selected(next, null); close(estimateAttendance(none).score, 0); close(estimateAttendance(none).deduction, 0);
  const disconnected = computeManagedBalance(none); assert.ok(disconnected.ok); close(disconnected.value.balance.lost, 0);
  assert.deepEqual(c, before);
});

test('a complete historical attendance result is preserved on its original assessment when switching or unlinking', () => {
  const c = course(); c.assessments[4].name = '출석';
  c.attendanceEstimate = { ...c.attendanceEstimate!, assessmentId: 'item-4', confirmed: { weight: 10, secured: 8, lost: 2, ungraded: 0, finalDeduction: null } };
  for (const target of ['item-0', null]) {
    const next = selected(c, target), original = next.assessments.find((a) => a.id === 'item-4')!;
    assert.deepEqual(original.progress, { status: 'graded', score: 80 }); assert.equal(original.name, '출석');
    assert.equal(next.attendanceEstimate!.confirmed, undefined); assert.equal(next.attendanceEstimate!.absences, 1);
    assert.deepEqual(validateManagedCourse(next), []);
    assert.deepEqual(autoSaveChanges(c,next).messages,[]);
  }
  assert.deepEqual(c.assessments[4].progress, { status: 'scheduled' }); assert.equal(c.attendanceEstimate.confirmed!.secured, 8);
});

test('newly named scored items do not auto-link, and conflicting historical grades are never overwritten',()=>{
  const c=course();c.assessments[0].name='출석';c.assessments[0].progress={status:'graded',score:80};
  assert.equal(prepareAttendanceEstimate(c).value.assessmentId,null);
  c.attendanceEstimate={...c.attendanceEstimate!,assessmentId:'item-0',confirmed:{weight:10,secured:7,lost:3,ungraded:0,finalDeduction:null}};
  const before=structuredClone(c);
  assert.equal(selectAttendanceAssessment(c,'item-4').ok,false);assert.equal(selectAttendanceAssessment(c,null).ok,false);
  assert.deepEqual(c,before);
});

test('partial historical ledgers and separately confirmed final deductions restrict unsafe link changes', () => {
  for (const confirmed of [{ weight: 10, secured: 4, lost: 2, ungraded: 0, finalDeduction: null }, { weight: 10, secured: 8, lost: 2, ungraded: 0, finalDeduction: 3 }]) {
    const c = course(); c.attendanceEstimate = { ...c.attendanceEstimate!, assessmentId: 'item-4', confirmed };
    const before = structuredClone(c); assert.ok(attendanceLinkChangeError(c));
    assert.equal(selectAttendanceAssessment(c, null).ok, false); assert.equal(selectAttendanceAssessment(c, 'item-0').ok, false);
    assert.equal(removeAssessmentWithAttendanceLink(c, 'item-4').ok, false); assert.deepEqual(c, before);
  }
});

test('deleting an unrecorded linked item clears the link explicitly and never reattaches to another name', () => {
  const c = selected(course(), 'item-0'); c.assessments[4].name = '출석';
  const deleted = removeAssessmentWithAttendanceLink(c, 'item-0'); assert.ok(deleted.ok);
  assert.equal(deleted.value.attendanceEstimate!.assessmentId, null);
  assert.equal(prepareAttendanceEstimate(deleted.value).value.assessmentId, null);
  assert.equal(deleted.value.attendanceEstimate!.absences, 1); assert.equal(deleted.value.attendanceEstimate!.lateness, 2);
});

test('existing v1/v2 IDs and confirmed results remain compatible, while unknown selector metadata is rejected', () => {
  const legacy = newCourse('legacy'); legacy.name = '기존 과목'; legacy.assessments[3].myScore = 80;
  const migrated = migrateV1Courses([legacy]); assert.ok(migrated.ok);
  const prepared = prepareAttendanceEstimate(migrated.value[0]); assert.equal(prepared.value.assessmentId, legacy.assessments[3].id);
  assert.equal(prepared.value.confirmed!.secured, 8);
  const c = course(); c.attendanceEstimate!.assessmentId = 'item-4'; c.assessments[4].name = '기존 연결 유지';
  assert.equal(prepareAttendanceEstimate(c).value.assessmentId, 'item-4');
  assert.ok(validateManagedCourse({ ...c, attendanceEstimate: { ...c.attendanceEstimate, selection: 'unexpected' } }).length);
});

test('safe selector changes autosave without a prompt; newest selection and explicit none survive reload', () => {
  const store = memory(), c = course(); const first = saveManagedCourses([c], null, () => store); assert.ok(first.ok);
  let snapshot = first.value.snapshot, job: (() => void) | null = null;
  const queue = createAutoSaveQueue({ set(fn) { job = fn; return 1; }, clear() { job = null; } });
  const one = selected(c, 'item-0'), latest = selected(one, 'item-4');
  const schedule = (next: ManagedCourse) => queue.schedule(() => {
    const changes = autoSaveChanges(c, next); assert.deepEqual(changes.messages, []); assert.equal(changes.attendance, true);
    const saved = saveManagedCourses([next], snapshot, () => store, changes.assignments, changes.attendance); assert.ok(saved.ok); snapshot = saved.value.snapshot;
  }, 0);
  schedule(one); schedule(latest); assert.ok(job); queue.flush();
  const loaded = loadManagedCourses(() => store); assert.ok(loaded.ok); assert.deepEqual(loaded.value.courses[0], latest);
  const none = selected(latest, null), changes = autoSaveChanges(latest, none); assert.deepEqual(changes.messages, []);
  assert.ok(saveManagedCourses([none], snapshot, () => store, false, changes.attendance).ok);
  const restored = loadManagedCourses(() => store); assert.ok(restored.ok);
  assert.equal(prepareAttendanceEstimate(restored.value.courses[0]).value.assessmentId, null);
  assert.equal(restored.value.courses[0].attendanceEstimate!.selection, 'manual');
});

test('a failed selector autosave preserves the stored course and the editable new choice', () => {
  const c = course(), store = memory(), saved = saveManagedCourses([c], null, () => store); assert.ok(saved.ok);
  const next = selected(c, 'item-0'), changes = autoSaveChanges(c, next);
  assert.equal(saveManagedCourses([next], saved.value.snapshot, () => ({ ...store, setItem() { throw Error('quota'); } }), false, changes.attendance).ok, false);
  const loaded = loadManagedCourses(() => store); assert.ok(loaded.ok); assert.deepEqual(loaded.value.courses[0], c);
  assert.equal(next.attendanceEstimate!.assessmentId, 'item-0');
});

test('Gemini preview is read-only, keeps original names and preserves a manual ID or explicit none on apply', () => {
  for (const target of ['item-0', null]) {
    const c = selected(course(), target), before = structuredClone(c);
    const extraction = parseImageExtraction({ status: 'ok', items: c.assessments.map((a) => ({ name: a.name, percent: a.weight * 100, parent: null, needsReview: false })) });
    const rows = buildWeightPreview(c.assessments, extraction); assert.deepEqual(c, before);
    const applied = applyWeightPreview(c.assessments, rows, () => crypto.randomUUID(), target ? [target] : []); assert.ok(applied.ok);
    const e = reconcileAttendanceLink(applied.value, c.attendanceEstimate!);
    assert.equal(e.assessmentId, target); assert.equal(e.selection, 'manual');
    assert.deepEqual(applied.value.map((a) => a.name), names);
    assert.equal(e.absences, 1); assert.equal(e.lateness, 2);
  }
});

test('image replacement keeps an omitted manually linked item by ID at zero weight instead of resetting the choice', () => {
  const c = selected(course(), 'item-0'), before = structuredClone(c);
  const rows = buildWeightPreview(c.assessments, { status: 'ok', items: [{ name: '중간고사', percent: 100, parent: null, needsReview: false }] });
  assert.deepEqual(c, before);
  const applied = applyWeightPreview(c.assessments, rows, () => crypto.randomUUID(), ['item-0']); assert.ok(applied.ok);
  assert.equal(applied.value.find((a) => a.id === 'item-0')!.weight, 0);
  const e = reconcileAttendanceLink(applied.value, c.attendanceEstimate!);
  assert.equal(e.assessmentId, 'item-0'); assert.equal(e.selection, 'manual');
  const next = { ...c, assessments: applied.value, attendanceEstimate: e };
  assert.deepEqual(validateManagedCourse(next), []); close(estimateAttendance(next).deduction, 0);
});
