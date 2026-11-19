import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateRelativeGrade } from '../grade/relative-estimate.ts';
import type { CourseGradeRecord } from '../grade-record.ts';

const base: CourseGradeRecord = {
  method: 'relative', relative: { preset: 'relative1' },
  assessments: [{ id: 'mid', name: '중간', weightPercent: 100, maxScore: 100, result: { status: 'graded', score: 54.5 }, statistics: { mean: 33 } }],
};

test('54.5 against mean 33 works without a published rank and shows sensitivity', () => {
  const result = estimateRelativeGrade(base);
  assert.ok(result.status === 'modeled');
  assert.equal(result.band, 'sensitive');
  assert.equal(result.scope, 'all-weighted');
  assert.equal(result.meanOnlyCount, 1);
  assert.ok(Math.abs(result.secured - 54.5) < 1e-9);
  assert.ok(result.scenarios[0].above < 30);
  assert.ok(result.scenarios[1].above > 30);
  for (const preset of ['relative2', 'relative3'] as const) {
    const higher = estimateRelativeGrade({ ...base, relative: { preset, enrollment: 3 } });
    assert.ok(higher.status === 'modeled' && higher.band === 'a-cap');
  }
});

test('bounded variance scenarios support dispersion, ties and score boundaries', () => {
  for (const score of [0, 82, 100]) {
    const result = estimateRelativeGrade({ ...base, assessments: [{ ...base.assessments[0], result: { status: 'graded', score }, statistics: { mean: 74, standardDeviation: 12 } }] });
    assert.ok(result.status === 'modeled');
    assert.equal(result.withDeviationCount, 1);
    assert.ok(result.scenarios.every(row => row.above >= 0 && row.atOrAbove <= 100));
    if (score === 100) assert.ok(result.scenarios.every(row => row.above === 0));
  }
  const tie = estimateRelativeGrade({ ...base, assessments: [{ ...base.assessments[0], statistics: { mean: 54.5, standardDeviation: 0 } }] });
  assert.ok(tie.status === 'modeled' && tie.scenarios.every(row => row.above === 0 && row.atOrAbove === 100));
  assert.equal(estimateRelativeGrade({ ...base, assessments: [{ ...base.assessments[0], statistics: { mean: 100, standardDeviation: 20 } }] }).status, 'held');
});

test('weighted scores include losses once and assumptions cannot replace official scores', () => {
  const record: CourseGradeRecord = { ...base, assessments: [
    { ...base.assessments[0], weightPercent: 60 },
    { id: 'attendance', name: '출석', weightPercent: 10, maxScore: 10, result: { status: 'graded', score: 8 } },
    { id: 'final', name: '기말', weightPercent: 30, maxScore: 100, result: { status: 'pending' }, statistics: { mean: 10 } },
  ] };
  const original = structuredClone(record);
  const baseline = estimateRelativeGrade(record);
  assert.ok(baseline.status === 'modeled');
  assert.equal(baseline.weight, 70);
  assert.equal(baseline.unknownPeerWeight, 10);
  assert.ok(Math.abs(baseline.secured - 40.7) < 1e-10);
  assert.ok(Math.abs(baseline.lost - 29.3) < 1e-10);
  assert.notEqual(baseline.scenarios[0].above, baseline.scenarios[1].above);
  for (const invalid of [{ mean: 101 }, { mean: 100, standardDeviation: 12 }]) {
    assert.deepEqual(estimateRelativeGrade(record, { final: 80 }, { final: invalid }),
      { status: 'held', reason: 'invalid-assumption' });
  }
  const missing = estimateRelativeGrade(record, { final: 80 });
  assert.ok(missing.status === 'modeled' && missing.unknownPeerWeight === 40);
  const low = estimateRelativeGrade(record, { final: 10, mid: 0 }, { final: { mean: 65 } });
  const high = estimateRelativeGrade(record, { final: 95 }, { final: { mean: 65 } });
  assert.ok(low.status === 'modeled' && high.status === 'modeled');
  assert.equal(high.weight, 100);
  assert.equal(high.unknownPeerWeight, 10);
  assert.equal(high.secured, baseline.secured);
  assert.ok(high.scenarios.some(row => row.dependence === 'shuffled'));
  assert.ok(high.scenarios[0].above < low.scenarios[0].above);
  assert.deepEqual(estimateRelativeGrade(record, { final: 10 }), estimateRelativeGrade(record, { final: 10, mid: 0 }));
  assert.deepEqual(record, original);
});
