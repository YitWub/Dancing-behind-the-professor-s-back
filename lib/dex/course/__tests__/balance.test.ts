import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateCourseBalance } from '../grade/balance.ts';
import type { AssessmentScore, CourseAssessment, CourseGradeRecord } from '../grade-record.ts';

function item(id: string, weightPercent: number, result: AssessmentScore, maxScore = 100): CourseAssessment {
  return { id, name: id, weightPercent, maxScore, result };
}

function balance(...assessments: CourseAssessment[]) {
  return calculateCourseBalance({ method: 'unknown', assessments });
}

function near(actual: number | null, expected: number) {
  assert.ok(actual !== null && Math.abs(actual - expected) < 1e-10, String(actual));
}

test('82/100 at 30% gives 24.6 secured, 5.4 lost and HP 94.6', () => {
  const result = balance(item('mid', 30, { status: 'graded', score: 82 }),
    item('final', 40, { status: 'planned' }), item('quiz', 30, { status: 'pending' }));
  assert.ok('items' in result);
  near(result.secured, 24.6);
  near(result.lost, 5.4);
  near(result.hp, 94.6);
  assert.deepEqual([result.plannedWeight, result.pendingWeight, result.unconfirmed], [40, 30, 70]);
  assert.deepEqual(result.items.slice(1).map(row => [row.secured, row.lost]), [[null, 0], [null, 0]]);
  near(result.secured + result.lost + result.unconfirmed, 100);
  near(result.hp, result.secured + result.unconfirmed);
});

test('explicit zero and missed lose their weights, while unfinished work preserves HP', () => {
  const complete = balance(item('zero', 30, { status: 'graded', score: 0 }),
    item('missed', 20, { status: 'missed' }), item('other', 50, { status: 'graded', score: 81.5 }));
  assert.ok('items' in complete);
  assert.equal(complete.items[0].secured, 0);
  assert.equal(complete.items[1].lost, 20);
  near(complete.hp, complete.secured);
  near(complete.hp, 40.75);
  near(balance(item('missed', 100, { status: 'missed' })).hp, 0);
  near(balance(item('pending', 100, { status: 'pending' })).hp, 100);
});

test('partial weights, empty assessment lists and absent records withhold HP', () => {
  const partial = balance(item('mid', 30, { status: 'graded', score: 82 }), item('quiz', 20, { status: 'pending' }));
  assert.ok('items' in partial);
  assert.equal(partial.status, 'partial');
  assert.equal(partial.unallocatedWeight, 50);
  assert.equal(partial.hp, null);
  near(partial.secured, 24.6);
  assert.equal(balance(item('near', 99.99, { status: 'planned' })).hp, null);
  assert.deepEqual(balance(), { status: 'empty', hp: null });
  assert.deepEqual(calculateCourseBalance(), { status: 'not-started', hp: null });
});

test('decimal weights use exact hundredths, raw scores are not rounded for display', () => {
  const result = balance(item('a', 33.33, { status: 'graded', score: 1.5 }, 4.5),
    item('b', 33.33, { status: 'pending' }), item('c', 33.34, { status: 'planned' }));
  assert.ok('items' in result);
  assert.equal(result.status, 'complete');
  assert.equal(result.registeredWeight, 100);
  near(result.secured, 11.11);
  near(result.hp, 77.78);
});

test('invalid data produces no numeric results', () => {
  const good = item('a', 100, { status: 'graded', score: 60 });
  for (const bad of [
    { ...good, weightPercent: NaN }, { ...good, weightPercent: -1 }, { ...good, weightPercent: 100.01 },
    { ...good, maxScore: 0 }, { ...good, maxScore: Infinity },
    { ...good, result: { status: 'graded' as const, score: 101 } },
  ]) assert.deepEqual(balance(bad), { status: 'invalid', hp: null });
  assert.equal(balance(good, item('extra', 0.01, { status: 'planned' })).status, 'invalid');
});

test('independent inputs recalculate after score changes without mutating either record', () => {
  const first: CourseGradeRecord = { method: 'absolute', assessments: [item('final', 100, { status: 'graded', score: 82 })] };
  const second: CourseGradeRecord = { ...first, assessments: [item('final', 100, { status: 'graded', score: 91 })] };
  const edited: CourseGradeRecord = { ...first, assessments: [item('final', 100, { status: 'pending' })] };
  const saved = structuredClone(first);
  near(calculateCourseBalance(first).hp, 82);
  near(calculateCourseBalance(second).hp, 91);
  near(calculateCourseBalance(edited).hp, 100);
  assert.deepEqual(first, saved);
});
