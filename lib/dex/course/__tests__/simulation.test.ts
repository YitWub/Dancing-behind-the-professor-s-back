import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulateCourseGrade, calculateTargetRequirement } from '../grade/simulation.ts';
import type { GradeScenario } from '../grade/simulation.ts';
import type { CourseGradeRecord } from '../grade-record.ts';

const record: CourseGradeRecord = { method: 'relative', assessments: [
  { id: 'mid', name: '중간', weightPercent: 30, maxScore: 100, result: { status: 'graded', score: 82 } },
  { id: 'final', name: '기말', weightPercent: 40, maxScore: 100, result: { status: 'planned' } },
  { id: 'task', name: '과제', weightPercent: 20, maxScore: 50, result: { status: 'pending' } },
  { id: 'attendance', name: '출석', weightPercent: 10, maxScore: 20, result: { status: 'planned' } },
] };

function near(a: number, b: number) { assert.ok(Math.abs(a - b) < 1e-10, String(a)); }

test('target uses the weighted rate of all remaining evaluations, including pending grades', () => {
  const base = simulateCourseGrade(record);
  assert.ok(base.status === 'ready');
  assert.equal(base.pendingWeight, 20);
  assert.equal(base.plannedWeight, 50);
  const result = calculateTargetRequirement(base, 90);
  assert.ok(result.status === 'possible');
  near(result.requiredRate, 93.42857142857143);
  assert.equal(calculateTargetRequirement(base, 24.6).status, 'met');
  assert.equal(calculateTargetRequirement(base, 94.6).status, 'possible');
  assert.equal(calculateTargetRequirement(base, 94.600001).status, 'impossible');
});

test('scenario bounds and target reflect only unassigned assessments', () => {
  for (const [score, min, max] of [[70, 52.6, 82.6], [80, 56.6, 86.6], [90, 60.6, 90.6]]) {
    const result = simulateCourseGrade(record, { final: score });
    assert.ok(result.status === 'ready');
    near(result.minimum, min);
    near(result.maximum, max);
    assert.equal(result.remaining, 30);
    assert.equal(calculateTargetRequirement(result, 90).status, score === 90 ? 'possible' : 'impossible');
  }
  const assigned = simulateCourseGrade(record, { final: 90, task: 50, attendance: 20 });
  assert.ok(assigned.status === 'ready');
  assert.equal(assigned.remaining, 0);
  near(assigned.minimum, assigned.maximum);
  assert.equal(calculateTargetRequirement(assigned, 90.6).status, 'met');
  assert.equal(calculateTargetRequirement(assigned, 91).status, 'impossible');
});

test('invalid records, targets, and ineligible or out-of-range scores are rejected', () => {
  for (const target of [NaN, Infinity, -1, 100.01]) assert.equal(calculateTargetRequirement(simulateCourseGrade(record), target).status, 'invalid-target');
  const invalidScenarios: GradeScenario[] = [{ mid: 0 }, { unknown: 0 }, { task: 51 }, { final: NaN }, { final: Infinity }, { final: -1 }];
  for (const scenario of invalidScenarios) {
    assert.equal(simulateCourseGrade(record, scenario).status, 'invalid-scenario');
  }
  assert.equal(calculateTargetRequirement(simulateCourseGrade({ ...record, assessments: record.assessments.slice(0,1) }), 90).status, 'held');
  assert.equal(simulateCourseGrade({ ...record, assessments: [{ ...record.assessments[0], maxScore: 0 }] }).status, 'invalid');
});

test('scenarios are immutable, validate against official changes, and reset independently', () => {
  const copy = structuredClone(record);
  const scenario = Object.freeze({ final: 0, task: 25 });
  assert.equal(simulateCourseGrade(record, scenario).status, 'ready');
  const changed: CourseGradeRecord = { ...record, assessments: record.assessments.map(item => item.id === 'final'
    ? { ...item, result: { status: 'missed' } } : item) };
  assert.equal(simulateCourseGrade(changed, scenario).status, 'invalid-scenario');
  const baseline = simulateCourseGrade(record);
  assert.ok(baseline.status === 'ready');
  assert.equal(baseline.assumed, 0);
  near(baseline.maximum, 94.6);
  const zero: CourseGradeRecord = { method: 'absolute', assessments: [{ ...record.assessments[0], weightPercent: 100, result: { status: 'graded', score: 0 } }] };
  assert.equal(calculateTargetRequirement(simulateCourseGrade(zero), Number.MIN_VALUE).status, 'impossible');
  const ungraded: CourseGradeRecord = { ...zero, assessments: [{ ...zero.assessments[0], result: { status: 'pending' } }] };
  const requirement = calculateTargetRequirement(simulateCourseGrade(ungraded), 90);
  assert.ok(requirement.status === 'possible');
  near(requirement.requiredRate, 90);
  assert.deepEqual(record, copy);
});
