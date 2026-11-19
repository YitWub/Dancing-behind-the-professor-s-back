import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateCourseGrade } from '../../core/validation.ts';
import { analyzeRelativeOutlook } from '../grade/outlook.ts';
import { effectiveRelativePolicy, analyzeAssessmentPosition, analyzePublishedRank } from '../grade/relative.ts';
import type { CourseAssessment } from '../grade-record.ts';

const item: CourseAssessment = {
  id: 'mid', name: '중간', weightPercent: 100, maxScore: 100, result: { status: 'graded', score: 82 },
  statistics: { mean: 74, standardDeviation: 12, publishedRank: { rank: 2, cohortSize: 40 } },
};

test('mean, z and disclosed exam rank are independent observations', () => {
  const result = analyzeAssessmentPosition(item);
  assert.equal(result.difference, 8);
  assert.equal(result.z, 8 / 12);
  assert.equal(result.publishedRank?.rank, 2);
  assert.equal(analyzePublishedRank(), null);
  for (const statistics of [{ mean: 74 }, { mean: 74, standardDeviation: 0 }, { standardDeviation: 12 }]) {
    validateCourseGrade({ method: 'relative', assessments: [{ ...item, statistics }] });
    assert.equal(analyzeAssessmentPosition({ ...item, statistics }).z, null);
  }
  assert.equal(analyzeAssessmentPosition({ ...item, result: { status: 'pending' } }).difference, null);
  assert.equal(analyzeAssessmentPosition({ ...item, result: { status: 'missed' } }).difference, -74);
  const suspicious = { ...item, statistics: { mean: 100, standardDeviation: 12 } };
  validateCourseGrade({ method: 'relative', assessments: [suspicious] });
  assert.equal(analyzeAssessmentPosition(suspicious).concern, true);
  assert.equal(analyzeAssessmentPosition(suspicious).z, null);
});

test('invalid statistics and inconsistent rank or cap data are rejected', () => {
  for (const statistics of [{ mean: 101 }, { mean: -1 }, { mean: NaN }, { standardDeviation: Infinity },
    { standardDeviation: -1 }, { standardDeviation: 71 }, { publishedRank: { rank: 4, cohortSize: 3 } },
    { publishedRank: { rank: 1.5 } }]) {
    assert.throws(() => validateCourseGrade({ method: 'relative', assessments: [{ ...item, statistics }] }));
  }
  for (const relative of [{ enrollment: 0 }, { enrollment: 2, overallRank: { rank: 3, scope: '중간 이후' } },
    { policy: { source: 'assumed', aCap: 30, abCap: 20 } }, { policy: { source: 'assumed', aCap: -1 } }]) {
    assert.throws(() => validateCourseGrade({ method: 'relative', assessments: [item], relative }));
  }
});

test('published aggregate rank comparison does not infer seats or grades', () => {
  const overallRank = { rank: 12, scope: '중간고사·과제 반영' };
  const base = { enrollment: 40, overallRank };
  assert.equal(analyzePublishedRank(base)?.a, null);
  for (const source of ['unconfirmed', 'assumed', 'official-guidance'] as const) {
    const result = analyzePublishedRank({ ...base, policy: { source, aCap: 30, abCap: 70 } });
    assert.equal(result?.a, source === 'unconfirmed' ? null : 'within');
    assert.equal(result?.policySource, source);
  }
  assert.equal(analyzePublishedRank({ enrollment: 3, overallRank: { ...overallRank, rank: 1 }, policy: { source: 'assumed', aCap: 30 } })?.a, 'outside');
  assert.equal(analyzePublishedRank({ overallRank, policy: { source: 'assumed', aCap: 30 } })?.a, null);
});

test('ERICA preset selection supersedes legacy caps without issuing a grade', () => {
  const relative = { enrollment: 40, overallRank: { rank: 15, scope: '중간 이후' },
    policy: { source: 'assumed' as const, aCap: 20, abCap: 60 } };
  for (const [preset, aCap, abCap, comparison] of [
    ['relative1', 30, 70, 'outside'], ['relative2', 40, 80, 'within'], ['relative3', 50, 90, 'within'],
  ] as const) {
    const data = { ...relative, preset };
    const policy = effectiveRelativePolicy(data);
    assert.deepEqual([policy?.aCap, policy?.abCap], [aCap, abCap]);
    const record = { method: 'relative' as const, assessments: [item], relative: data };
    assert.equal(analyzeRelativeOutlook(record).a, null);
    assert.equal(analyzeRelativeOutlook(record, true).a?.comparison, comparison);
    assert.equal(analyzeRelativeOutlook(record, true).gradeStatus, 'held');
    assert.equal(data.policy.aCap, 20);
  }
  assert.equal(effectiveRelativePolicy({ ...relative, preset: 'unknown' }), undefined);
  assert.equal(effectiveRelativePolicy(relative)?.aCap, 20);
  assert.throws(() => validateCourseGrade({ method: 'relative', assessments: [item], relative: { preset: 'relative4' } }));
});
