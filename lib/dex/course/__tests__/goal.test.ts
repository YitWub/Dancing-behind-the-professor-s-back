import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CourseGradeRecord } from '../grade-record.ts';
import { planCourseTarget } from '../grade/goal.ts';
import { simulateCourseGrade } from '../grade/simulation.ts';

const record: CourseGradeRecord = { method: 'relative', assessments: [
  { id: 'mid', name: '중간', weightPercent: 30, maxScore: 100, result: { status: 'graded', score: 82 } },
  { id: 'final', name: '기말', weightPercent: 40, maxScore: 50, result: { status: 'planned' } },
  { id: 'quiz', name: '퀴즈', weightPercent: 30, maxScore: 20, result: { status: 'pending' } },
] };

test('raw-score guidance is available only when one weighted assessment is unassigned', () => {
  const base = planCourseTarget(record, simulateCourseGrade(record), 90);
  assert.equal(base.requirement.status, 'possible');
  assert.equal(base.raw, null);
  const scenario = { quiz: 20 };
  const withQuiz = planCourseTarget(record, simulateCourseGrade(record, scenario), 90, scenario);
  assert.equal(withQuiz.raw?.name, '기말');
  assert.ok(Math.abs(withQuiz.raw!.needed - 44.25) < 1e-10);
  assert.equal(withQuiz.raw?.maxScore, 50);
  const otherScenario = { final: 50 };
  const waiting = planCourseTarget(record, simulateCourseGrade(record, otherScenario), 90, otherScenario);
  assert.equal(waiting.raw?.pending, true);
});

test('the fully graded 54.5 example never yields a future score recommendation', () => {
  const completed: CourseGradeRecord = { method: 'relative', assessments: [
    { ...record.assessments[0], weightPercent: 100, result: { status: 'graded', score: 54.5 }, statistics: { mean: 33 } },
  ] };
  const result = simulateCourseGrade(completed);
  assert.ok(result.status === 'ready');
  assert.ok(Math.abs(result.minimum - 54.5) < 1e-10);
  assert.equal(result.remaining, 0);
  assert.deepEqual(planCourseTarget(completed, result, 90), { requirement: { status: 'impossible', target: 90 }, raw: null });
  assert.deepEqual(planCourseTarget(completed, result, 50), { requirement: { status: 'met', target: 50 }, raw: null });
});
