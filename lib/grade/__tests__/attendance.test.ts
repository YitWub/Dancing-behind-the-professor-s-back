import test from 'node:test';
import assert from 'node:assert/strict';
import type { AttendanceManagement } from '../attendance-types.ts';
import type { ManagedCourse } from '../management-types.ts';
import { computeAttendance, provisionalAttendanceScore, attendanceChangeMessages, validateAttendanceManagement } from '../attendance.ts';
import { computeManagedBalance } from '../managed-balance.ts';
import { migrateV1Courses, toEngineCourse, transitionAssessment, validateManagedCourse } from '../management.ts';
import { newCourse } from '../course-validation.ts';
import { COURSE_STORAGE_KEY, saveCourses, type CourseStorage } from '../course-storage.ts';
import { MANAGED_COURSE_STORAGE_KEY, loadManagedCourses, prepareV1Migration, saveManagedCourses, saveV1Migration } from '../managed-storage.ts';

function course(): ManagedCourse {
  const converted = migrateV1Courses([{ ...newCourse('c1'), name: '출석 테스트', enrolled: 40 }]); assert.ok(converted.ok);
  const c = converted.value[0];
  c.assessments = c.assessments.map((a) => { const next = transitionAssessment(a, { status: 'scheduled' }); assert.ok(next.ok); return next.value; });
  return c;
}
function config(): AttendanceManagement {
  return {
    assessmentId: 'c1-3', records: { total: 30, held: 15, absences: 2, lateness: 3, excused: 1 },
    penalty: { kind: 'attendance_points', pointsPerAbsence: 2 }, latePenalty: { kind: 'bundled', perAbsence: 3 },
    excusedForScore: 'recognized', allocation: 'per_session_equal',
    eligibility: { rule: { kind: 'max_absences', allowed: 6, failureAt: 'exceeds' }, unit: 'sessions', excused: 'recognized', late: { kind: 'bundled', perAbsence: 3 }, hours: null },
  };
}
function managed(): ManagedCourse { return { ...course(), attendanceManagement: config() }; }
function calculate(c = managed()) { const r = computeAttendance(c); assert.ok(r.ok); return r.value; }
const close = (n: number, expected: number) => assert.ok(Math.abs(n - expected) < 1e-9, `${n} != ${expected}`);
function memory(): CourseStorage & { data: Map<string, string> } { const data = new Map<string, string>(); return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } }; }

test('attendance counters are exclusive, whole, nonnegative and bounded by held and total', () => {
  const c = managed();
  assert.deepEqual(validateManagedCourse(c), []);
  for (const patch of [{ held: 31 }, { absences: 16 }, { lateness: 16 }, { excused: 16 }, { absences: 12, lateness: 3, excused: 1 }, { total: 0 }, { held: -1 }, { absences: 1.5 }, { lateness: NaN }, { excused: Infinity }]) {
    const bad = { ...config(), records: { ...config().records, ...patch } };
    assert.ok(validateAttendanceManagement(bad, c.assessments).length > 0);
    assert.equal(computeAttendance({ ...c, attendanceManagement: bad }).ok, false);
  }
});

test('separate excused records are never subtracted from absences or counted twice', () => {
  const c = managed();
  close(calculate(c).score.effectiveAbsences!, 3);
  c.attendanceManagement!.excusedForScore = 'as_absence';
  close(calculate(c).score.effectiveAbsences!, 4);
  close(calculate(c).score.internalDeduction!, 0.8);
  assert.equal(calculate(c).eligibility.effectiveAbsences, 3, 'eligibility has its own excused policy');
});

test('raw attendance deduction converts using the actual item weight and max score', () => {
  const c = managed();
  c.assessments[3].maxScore = 20;
  const result = calculate(c);
  close(result.score.rawDeduction!, 6);
  close(result.score.internalDeduction!, 3);
  close(result.score.finalDeduction!, 0);
  close(result.score.balance.secured, 2);
  close(result.score.balance.remaining, 5);
});

test('bundled, proportional and separate late deductions have distinct outcomes', () => {
  const c = managed(); c.attendanceManagement!.records.lateness = 2;
  close(calculate(c).score.effectiveAbsences!, 2);
  c.attendanceManagement!.latePenalty = { kind: 'proportional', perAbsence: 3 };
  close(calculate(c).score.effectiveAbsences!, 2 + 2 / 3);
  c.attendanceManagement!.latePenalty = { kind: 'separate', pointsPerLate: 0.5 };
  close(calculate(c).score.rawDeduction!, 5);
  close(calculate(c).score.internalDeduction!, 0.5);
});

test('no unknown scoring rule silently becomes zero loss or full attendance credit', () => {
  const c = managed(); c.attendanceManagement!.penalty = { kind: 'unconfirmed' };
  const result = calculate(c);
  assert.equal(result.score.known, false); assert.equal(result.score.internalDeduction, null);
  close(result.score.balance.secured, 0); close(result.score.balance.ungraded, 5); close(result.score.balance.remaining, 5);
  assert.equal(toEngineCourse(c).ok, false);
  c.attendanceManagement!.penalty = { kind: 'attendance_points', pointsPerAbsence: 2 };
  c.attendanceManagement!.latePenalty = { kind: 'unconfirmed' };
  assert.equal(calculate(c).score.known, false);
  c.attendanceManagement!.latePenalty = { kind: 'separate', pointsPerLate: 0 };
  c.attendanceManagement!.excusedForScore = 'unconfirmed';
  assert.equal(calculate(c).score.known, false);
});

test('internal loss never exceeds its item weight, even when loss exceeds held allocation', () => {
  const c = managed();
  c.attendanceManagement!.records = { total: 30, held: 1, absences: 1, lateness: 0, excused: 0 };
  c.attendanceManagement!.penalty = { kind: 'attendance_points', pointsPerAbsence: 200 };
  const s = calculate(c).score;
  close(s.balance.lost, 10); close(s.balance.secured, 0); close(s.balance.remaining, 0);
  close(Object.values(s.balance).reduce((sum, n) => sum + n, 0), 10);
});

test('term-end scoring does not grant future attendance points midway through a term', () => {
  const c = managed(); c.attendanceManagement!.allocation = 'term_end';
  const s = calculate(c).score;
  close(s.balance.secured, 0); close(s.balance.lost, 0.6); close(s.unclassifiedPoints, 9.4);
  assert.equal(s.complete, false); assert.equal(s.finalRawScore, null);
  c.attendanceManagement!.records.held = 30;
  const final = calculate(c).score;
  close(final.balance.secured, 9.4); close(final.balance.lost, 0.6); close(final.unclassifiedPoints, 0);
  close(final.finalRawScore!, 94); assert.equal(final.complete, true);
});

test('no absences is not full secured credit in an unfinished term-end course', () => {
  const c = managed(); c.attendanceManagement!.allocation = 'term_end';
  c.attendanceManagement!.records = { total: 30, held: 15, absences: 0, lateness: 0, excused: 0 };
  close(calculate(c).score.balance.secured, 0); close(calculate(c).score.unclassifiedPoints, 10);
  c.attendanceManagement!.records.held = 0;
  close(calculate(c).score.balance.remaining, 10);
});

test('equal-per-session scoring only secures the explicitly allocated held budget', () => {
  const result = calculate();
  close(result.score.balance.secured, 4.4); close(result.score.balance.lost, 0.6); close(result.score.balance.remaining, 5);
  const total = computeManagedBalance(managed()); assert.ok(total.ok);
  close(total.value.balance.secured, 4.4); close(total.value.balance.lost, 0.6); close(total.value.balance.remaining, 95);
  close(Object.values(total.value.balance).reduce((sum, n) => sum + n, 0), 100);
});

test('separate final-grade deductions are not capped by attendance weight or double-counted in four areas', () => {
  const c = managed(); c.attendanceManagement!.penalty = { kind: 'final_points', pointsPerAbsence: 2 };
  const result = calculate(c);
  close(result.score.internalDeduction!, 0); close(result.score.finalDeduction!, 6);
  const total = computeManagedBalance(c); assert.ok(total.ok);
  close(total.value.balance.lost, 0); close(total.value.finalDeduction!, 6);
  assert.equal(total.value.netFinalScore, null);
  c.attendanceManagement!.records.held = 30;
  c.assessments = c.assessments.map((a) => ({ ...a, progress: { status: 'graded', score: 80 } } as typeof a));
  const final = computeManagedBalance(c); assert.ok(final.ok);
  close(final.value.balance.secured, 82); close(final.value.netFinalScore!, 76);
  assert.equal(toEngineCourse(c).ok, false, 'do not invent a new probability adjustment for final deductions');
});

test('0% attendance still has independent eligibility and separate final deductions', () => {
  const c = managed(); c.assessments[3].weight = 0; c.assessments[0].weight += 0.1;
  c.attendanceManagement!.penalty = { kind: 'final_points', pointsPerAbsence: 20 };
  c.attendanceManagement!.eligibility.rule = { kind: 'max_absences', allowed: 2, failureAt: 'exceeds' };
  const result = calculate(c);
  close(result.score.finalDeduction!, 60); close(result.score.internalDeduction!, 0);
  assert.equal(result.eligibility.status, 'failed');
  c.attendanceManagement!.assessmentId = null;
  assert.equal(calculate(c).eligibility.status, 'failed');
});

test('max absence boundary distinguishes exactly allowed from exceeding, with explicit reaches support', () => {
  const c = managed(); c.attendanceManagement!.eligibility.late = { kind: 'ignored' };
  c.attendanceManagement!.records.absences = 6;
  assert.equal(calculate(c).eligibility.status, 'risk', 'exactly six allowed: next absence fails, not already failed');
  assert.equal(calculate(c).eligibility.finalStatus, 'not_final');
  c.attendanceManagement!.records.absences = 7;
  assert.equal(calculate(c).eligibility.status, 'failed');
  c.attendanceManagement!.records.absences = 6;
  c.attendanceManagement!.eligibility.rule = { kind: 'max_absences', allowed: 6, failureAt: 'reaches' };
  assert.equal(calculate(c).eligibility.status, 'failed');
});

test('at semester end, eligibility is final and exact allowed count remains eligible for exceeds', () => {
  const c = managed(); c.attendanceManagement!.records.held = 30; c.attendanceManagement!.records.absences = 6;
  c.attendanceManagement!.eligibility.late = { kind: 'ignored' };
  const result = calculate(c).eligibility;
  assert.equal(result.status, 'normal'); assert.equal(result.phase, 'complete'); assert.equal(result.finalStatus, 'eligible');
});

test('minimum ratio distinguishes recoverable current risk, irrecoverable deficit and equality', () => {
  const c = managed(); const a = c.attendanceManagement!;
  a.eligibility.rule = { kind: 'minimum_ratio', minimum: 0.8 }; a.eligibility.late = { kind: 'ignored' };
  a.records = { total: 30, held: 10, absences: 3, lateness: 0, excused: 0 };
  assert.equal(calculate(c).eligibility.status, 'risk'); close(calculate(c).eligibility.bestFinalRatio!, 0.9);
  a.records = { total: 30, held: 20, absences: 7, lateness: 0, excused: 0 };
  assert.equal(calculate(c).eligibility.status, 'failed'); assert.equal(calculate(c).eligibility.unrecoverable, true);
  a.records = { total: 30, held: 30, absences: 6, lateness: 0, excused: 0 };
  assert.equal(calculate(c).eligibility.finalStatus, 'eligible'); close(calculate(c).eligibility.currentRatio!, 0.8);
});

test('unknown eligibility rules never announce F, regardless of scoring or absence volume', () => {
  const c = managed(); c.attendanceManagement!.eligibility.rule = { kind: 'unconfirmed' };
  assert.equal(calculate(c).eligibility.status, 'needs_review'); assert.equal(calculate(c).eligibility.unrecoverable, false);
  assert.equal(calculate(c).score.known, true);
});

test('eligibility has its own late and excused recognition, independent of scoring', () => {
  const c = managed(); const a = c.attendanceManagement!;
  a.eligibility.late = { kind: 'proportional', perAbsence: 2 }; a.eligibility.excused = 'as_absence';
  close(calculate(c).eligibility.effectiveAbsences!, 4.5); close(calculate(c).score.effectiveAbsences!, 3);
  a.eligibility.late = { kind: 'unconfirmed' }; assert.equal(calculate(c).eligibility.status, 'needs_review');
});

test('actual recognized hours are supported without guessing hours from session counts', () => {
  const c = managed(); const e = c.attendanceManagement!.eligibility;
  e.unit = 'hours'; e.rule = { kind: 'minimum_ratio', minimum: 0.8 };
  e.hours = { total: 45, held: 20, credited: 15, recognitionConfirmed: false };
  assert.equal(calculate(c).eligibility.status, 'needs_review');
  e.hours.recognitionConfirmed = true;
  const result = calculate(c).eligibility;
  close(result.currentRatio!, 0.75); close(result.bestFinalRatio!, 40 / 45); assert.equal(result.status, 'risk');
  e.hours.credited = 30; assert.ok(validateManagedCourse(c).length > 0);
});

test('invalid scoring, units, late factors, hour records and cross-course links are rejected', () => {
  const c = managed();
  for (const patch of [{ assessmentId: 'other-course-attendance' }, { penalty: { kind: 'attendance_points', pointsPerAbsence: -1 } }, { latePenalty: { kind: 'bundled', perAbsence: 0 } }, { latePenalty: { kind: 'proportional', perAbsence: 1.5 } }, { latePenalty: { kind: 'separate', pointsPerLate: -1 } }, { allocation: 'guessed' }]) {
    assert.ok(validateAttendanceManagement({ ...config(), ...patch }, c.assessments).length > 0);
  }
  const a = config(); a.eligibility.rule = { kind: 'max_absences', allowed: 0, failureAt: 'reaches' }; assert.ok(validateAttendanceManagement(a, c.assessments).length > 0);
  a.eligibility.unit = 'hours'; assert.ok(validateAttendanceManagement(a, c.assessments).length > 0);
  a.eligibility.rule = { kind: 'minimum_ratio', minimum: 1.1 }; assert.ok(validateAttendanceManagement(a, c.assessments).length > 0);
  a.eligibility.rule = { kind: 'minimum_ratio', minimum: 0.8 }; a.eligibility.hours = { total: 45, held: 46, credited: 30, recognitionConfirmed: true }; assert.ok(validateAttendanceManagement(a, c.assessments).length > 0);
});

test('legacy scores and ledgers remain archived and are never double-deducted', () => {
  const c = managed(); const original = c.assessments[3]; assert.ok(original.progress !== null);
  c.assessments[3] = { ...original, progress: { status: 'graded', score: 50 } };
  c.attendance = { totalSessions: 30, absences: 10, lateness: 0, allowedAbsences: 6, penaltyPerAbsence: 4, latePerAbsence: 3 };
  const snapshot = structuredClone(c);
  const result = computeManagedBalance(c); assert.ok(result.ok);
  close(result.value.balance.lost, 0.6); assert.equal(result.value.review.attendanceLedgerPreserved, false);
  c.attendanceManagement!.records.held = 30;
  const adapted = toEngineCourse(c); assert.ok(adapted.ok);
  assert.equal(adapted.value.attendance, null); close(adapted.value.assessments[3].myScore!, 94);
  assert.deepEqual(snapshot.assessments[3].progress, { status: 'graded', score: 50 });
  assert.equal(c.attendance.absences, 10);
});

test('linked legacy-null attendance is replaced by records while exams and grouped assignments are retained', () => {
  const c = managed();
  c.assessments[3] = { ...c.assessments[3], progress: null, reviewRequired: 'legacy_null_score' };
  c.assessments[2].assignmentGroup = { allocation: 'equal', tasks: [{ id: 't1', name: '과제', maxScore: 100, weight: null, progress: { status: 'graded', score: 80 } }] };
  const result = computeManagedBalance(c); assert.ok(result.ok);
  close(result.value.balance.secured, 20.4); close(result.value.balance.lost, 4.6); close(result.value.balance.remaining, 75);
  assert.equal(result.value.items.length, 4);
  assert.equal(toEngineCourse(c).ok, false, 'do not project future attendance at full marks');
  c.attendanceManagement!.records.held = 30;
  const adapted = toEngineCourse(c); assert.ok(adapted.ok);
  assert.equal(adapted.value.assessments.length, 4); close(adapted.value.assessments[2].myScore!, 80);
});

test('saving attendance activation and rule corrections requires explicit confirmation', () => {
  const store = memory(); const original = course();
  const first = saveManagedCourses([original], null, () => store); assert.ok(first.ok);
  const c = managed();
  assert.ok(attendanceChangeMessages([original], [c]).some((e) => e.includes('중복 적용하지')));
  assert.equal(saveManagedCourses([c], first.value.snapshot, () => store).ok, false);
  assert.equal(store.getItem(MANAGED_COURSE_STORAGE_KEY), first.value.snapshot);
  const activated = saveManagedCourses([c], first.value.snapshot, () => store, false, true); assert.ok(activated.ok);
  const edited = structuredClone(c); edited.attendanceManagement!.penalty = { kind: 'final_points', pointsPerAbsence: 3 };
  assert.equal(saveManagedCourses([edited], activated.value.snapshot, () => store).ok, false);
  assert.ok(saveManagedCourses([edited], activated.value.snapshot, () => store, false, true).ok);
});

test('ordinary counter increments save, decreasing records and disabling attendance require confirmation', () => {
  const store = memory(); const c = managed(); const first = saveManagedCourses([c], null, () => store); assert.ok(first.ok);
  const updated = structuredClone(c); updated.attendanceManagement!.records.held++; updated.attendanceManagement!.records.absences++;
  const second = saveManagedCourses([updated], first.value.snapshot, () => store); assert.ok(second.ok);
  assert.equal(saveManagedCourses([c], second.value.snapshot, () => store).ok, false);
  assert.equal(saveManagedCourses([course()], second.value.snapshot, () => store).ok, false);
});

test('failed attendance save preserves original v1/v2 and edited records; retry and restore work', () => {
  const store = memory(); assert.ok(saveCourses([{ ...newCourse('legacy'), name: 'v1' }], null, () => store).ok);
  const source = store.getItem(COURSE_STORAGE_KEY); const c = managed(); const first = saveManagedCourses([c], null, () => store); assert.ok(first.ok);
  const edited = structuredClone(c); edited.attendanceManagement!.records.held++;
  const denied: CourseStorage = { getItem: store.getItem, setItem() { throw new Error('QuotaExceededError'); } };
  assert.equal(saveManagedCourses([edited], first.value.snapshot, () => denied).ok, false);
  assert.equal(store.getItem(MANAGED_COURSE_STORAGE_KEY), first.value.snapshot); assert.equal(store.getItem(COURSE_STORAGE_KEY), source);
  assert.equal(edited.attendanceManagement!.records.held, 16);
  assert.ok(saveManagedCourses([edited], first.value.snapshot, () => store).ok);
  const restored = loadManagedCourses(() => store); assert.ok(restored.ok); assert.deepEqual(restored.value.courses, [edited]);
});

test('legacy migration never infers absence counts from a direct score or activates new rules', () => {
  const store = memory(); const legacy = { ...newCourse('old'), name: '기존 출석' };
  legacy.assessments[3].myScore = 80;
  legacy.attendance = { totalSessions: 30, absences: 2, lateness: 1, allowedAbsences: 6, penaltyPerAbsence: 2, latePerAbsence: 3 };
  assert.ok(saveCourses([legacy], null, () => store).ok); const source = store.getItem(COURSE_STORAGE_KEY);
  const preview = prepareV1Migration(() => store); assert.ok(preview.ok);
  assert.equal(preview.value.courses[0].attendanceManagement, undefined);
  assert.deepEqual(preview.value.courses[0].assessments[3].progress, { status: 'graded', score: 80 });
  assert.ok(saveV1Migration(preview.value, () => store).ok); assert.equal(store.getItem(COURSE_STORAGE_KEY), source);
  const restored = loadManagedCourses(() => store); assert.ok(restored.ok); assert.deepEqual(restored.value.courses[0].attendance, legacy.attendance);
});

test('course-specific links cannot leak attendance records across courses', () => {
  const first = managed(); const other = course(); other.id = 'c2'; other.assessments = other.assessments.map((a) => ({ ...a, id: `c2-${a.id}` }));
  other.attendanceManagement = config(); assert.ok(validateManagedCourse(other).length > 0);
  assert.equal(calculate(first).score.effectiveAbsences, 3);
});

test('a new raw scale preserves the archived score scale and converts only the calculated result', () => {
  const c = managed(); const original = c.assessments[3]; assert.ok(original.progress !== null);
  c.assessments[3] = { ...original, progress: { status: 'graded', score: 80 } };
  c.attendanceManagement!.rawMaxScore = 20; c.attendanceManagement!.records.held = 30;
  const result = calculate(c); close(result.score.internalDeduction!, 3); close(result.score.finalRawScore!, 14);
  const adapted = toEngineCourse(c); assert.ok(adapted.ok); close(adapted.value.assessments[3].myScore!, 70);
  assert.deepEqual(c.assessments[3].progress, { status: 'graded', score: 80 }); assert.equal(c.assessments[3].maxScore, 100);
});

test('overflowing deductions return an error rather than publishing infinity', () => {
  const c = managed(); c.attendanceManagement!.penalty = { kind: 'final_points', pointsPerAbsence: Number.MAX_VALUE };
  assert.equal(computeAttendance(c).ok, false);
});


test('full-mark provisional display changes with records without altering secured balance', () => {
  const c = managed(); const first = calculate(c).score;
  close(provisionalAttendanceScore(first, 10)!, 9.4);
  close(first.balance.secured, 4.4);
  c.attendanceManagement!.records.absences = 0;
  c.attendanceManagement!.records.lateness = 0;
  close(provisionalAttendanceScore(calculate(c).score, 10)!, 10);
  c.attendanceManagement!.records.lateness = 3;
  close(provisionalAttendanceScore(calculate(c).score, 10)!, 9.8);
  c.attendanceManagement!.penalty = {kind: 'attendance_points', pointsPerAbsence: 10000};
  close(provisionalAttendanceScore(calculate(c).score, 10)!, 0);
  c.attendanceManagement!.penalty = {kind: 'unconfirmed'};
  assert.equal(provisionalAttendanceScore(calculate(c).score, 10), null);
});

test('separate final deduction never reduces the attendance provisional baseline', () => {
  const c=managed(); c.attendanceManagement!.penalty={kind:'final_points',pointsPerAbsence:2};
  const result=calculate(c).score;
  close(provisionalAttendanceScore(result,10)!,10);
  close(result.finalDeduction!,6); close(result.balance.lost,0);
  const store=memory(); const saved=saveManagedCourses([c],null,() => store); assert.ok(saved.ok);
  const restored=loadManagedCourses(() => store); assert.ok(restored.ok);
  const actual=computeAttendance(restored.value.courses[0]); assert.ok(actual.ok);
  close(provisionalAttendanceScore(actual.value.score,10)!,10);
});
