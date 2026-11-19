import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeRelativeOutlook, analyzeRelativeScenario } from '../grade/outlook.ts';
import { simulateCourseGrade } from '../grade/simulation.ts';
import type { CourseGradeRecord } from '../grade-record.ts';

const record: CourseGradeRecord = {
  method: 'relative',
  assessments: [
    { id: 'mid', name: '중간', maxScore: 100, weightPercent: 30, result: { status: 'graded', score: 82 }, statistics: { mean: 74, standardDeviation: 12, publishedRank: { rank: 3 } } },
    { id: 'final', name: '기말', maxScore: 100, weightPercent: 70, result: { status: 'pending' }, statistics: { mean: 50, standardDeviation: 10 } },
  ],
};

test('records retain exam scope, weight and reason for withholding grades', () => {
  const outlook = analyzeRelativeOutlook(record);
  assert.equal(outlook.gradeStatus, 'held');
  assert.equal(outlook.rank, null);
  assert.equal(outlook.assessments[0].weight, 30);
  assert.equal(outlook.assessments[0].difference, 8);
  assert.equal(outlook.assessments[0].z, 8 / 12);
  assert.equal(outlook.assessments[0].publishedRank?.rank, 3);
  assert.equal(outlook.assessments[1].difference, null);
});

test('cohort must match before cap comparison, which never returns a grade', () => {
  const source = { ...record, relative: { enrollment: 40, overallRank: { rank: 12, scope: '중간 이후' }, policy: { source: 'assumed' as const, aCap: 30, abCap: 70 } } };
  assert.equal(analyzeRelativeOutlook(source).a, null);
  const matched = analyzeRelativeOutlook(source, true);
  assert.deepEqual(matched.a, { comparison: 'within', near: true });
  assert.deepEqual(matched.ab, { comparison: 'within', near: false });
  assert.equal(matched.rank?.policySource, 'assumed');
  assert.equal(matched.gradeStatus, 'held');
});

test('relative what-if uses only explicit assumptions and shares existing score scenario', () => {
  const original = structuredClone(record);
  const scores = Object.freeze({ final: 90 });
  assert.equal(analyzeRelativeScenario(record, scores, {})[0].difference, null);
  const [row] = analyzeRelativeScenario(record, scores, { final: { mean: 75, standardDeviation: 12 } });
  assert.equal(row.assessmentStatus, 'pending');
  assert.equal(row.difference, 15);
  assert.equal(row.z, 1.25);
  assert.equal(analyzeRelativeScenario(record, { final: 80 }, { final: { mean: 75 } })[0].difference, 5);
  assert.equal(analyzeRelativeScenario(record, scores, { final: { mean: 75, standardDeviation: 0 } })[0].z, null);
  assert.equal(analyzeRelativeScenario(record, scores, { final: { mean: 100, standardDeviation: 12 } })[0].status, 'check-statistics');
  assert.equal(analyzeRelativeScenario(record, scores, { final: { mean: 101 } })[0].status, 'invalid');
  assert.equal(analyzeRelativeScenario(record, { mid: 0 }, {}).length, 0);
  assert.deepEqual(analyzeRelativeScenario(record, {}, {}), []);
  const total = simulateCourseGrade(record, scores);
  assert.ok(total.status === 'ready' && Math.abs(total.maximum - 87.6) < 1e-10);
  assert.deepEqual(record, original);
});
