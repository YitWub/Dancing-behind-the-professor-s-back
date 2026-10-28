import test from 'node:test';
import assert from 'node:assert/strict';
import type { Course, GradePrediction } from '../../types.ts';
import { estimateKappa, buildKappaReport } from '../kappa.ts';
import { centralInterval, modeGrade, scoreCase, toPointMass } from '../metrics.ts';
import { runBacktest } from '../run.ts';
import type { BacktestCase, EngineAdapter } from '../types.ts';

const emptyCourse = (id: string): Course => ({
  id, name: 'x', professor: 'p', credits: 3, enrolled: 40,
  isAbsolute: false, assessments: [], attendance: null,
});

const pred = (over: Partial<GradePrediction>): GradePrediction => ({
  courseId: 'c', tier: 3, balance: { secured: 0, lost: 0, remaining: 100 },
  distribution: null, zRange: null, headcount: null, confidence: 'medium',
  warnings: [], ...over,
});

test('κ 역추정: 베타 분산식의 역함수', () => {
  // m=0.6, κ=9 → var = 0.6*0.4/10 = 0.024, sd = 0.1549 → 만점 100에서 15.49
  const { kappa } = estimateKappa(60, 15.4919, 100);
  assert.ok(kappa !== null);
  assert.ok(Math.abs((kappa as number) - 9) < 0.01, `κ=${kappa}`);
});

test('κ 1층: 유계 분포가 수학적으로 불가능한 조합을 거부한다', () => {
  // m=0.85에서 분산 상한은 0.1275 → σ 상한 35.7점. 40점은 불가능
  const { kappa, invalidReason } = estimateKappa(85, 40, 100);
  assert.equal(kappa, null);
  assert.match(invalidReason ?? '', /베타 상한/);
});

test('κ 2층: 수학적으로는 가능하지만 U자형이면 비현실 표시', () => {
  // 회의록의 "평균 85점 시험에서 σ가 25일 수 없다"가 실제로 걸리는 지점.
  // 1층(상한 35.7)은 통과하지만 κ≈1.04 → α<1 이라 U자형.
  const { kappa, implausibleShape } = estimateKappa(85, 25, 100);
  assert.ok(kappa !== null && kappa < 2);
  assert.equal(implausibleShape, true);
  // 평범한 시험은 걸리지 않아야 한다
  assert.equal(estimateKappa(60, 15, 100).implausibleShape, false);
});

test('κ 집계: 천장 밀집 요소는 프리셋 산출에서 제외된다', () => {
  const mk = (ceiling: boolean, mean: number, sd: number): BacktestCase => ({
    id: 'k', actualGrade: 'A0', source: 'sample',
    course: { ...emptyCourse('c'), assessments: [{
      id: 'a', name: ceiling ? '출석' : '중간', weight: 1, maxScore: 100,
      myScore: 90, mean, stdev: sd, ceilingClustered: ceiling,
    }]},
  });
  const report = buildKappaReport([mk(false, 60, 15), mk(true, 97, 3)]);
  assert.equal(report.estimates.length, 2);
  // 출석(κ가 수백대)이 섞였다면 중앙값이 크게 올라갔을 것
  assert.ok((report.quartiles?.median ?? 0) < 20);
  assert.equal(report.grounded, false, '표본 2건짜리를 근거 있다고 주장하면 안 된다');
});

test('누적확률 → 등급별 확률 차분', () => {
  const pm = toPointMass([
    { grade: 'A+', atLeastProb: 0.1 },
    { grade: 'A0', atLeastProb: 0.45 },
    { grade: 'B+', atLeastProb: 0.8 },
    { grade: 'B0', atLeastProb: 1 },
  ]);
  assert.ok(Math.abs((pm.get('A0') ?? 0) - 0.35) < 1e-9);
  assert.equal(modeGrade([
    { grade: 'A+', atLeastProb: 0.1 },
    { grade: 'A0', atLeastProb: 0.6 },
    { grade: 'B+', atLeastProb: 0.85 },
    { grade: 'B0', atLeastProb: 1 },
  ]), 'A0');
  // 부동소수 가짜 동률에서도 재현 가능해야 한다 — 동률이면 더 좋은 등급
  assert.equal(modeGrade([
    { grade: 'A+', atLeastProb: 0.1 },
    { grade: 'A0', atLeastProb: 0.45 },
    { grade: 'B+', atLeastProb: 0.8 },
    { grade: 'B0', atLeastProb: 1 },
  ]), 'A0');
  assert.deepEqual(centralInterval([
    { grade: 'A+', atLeastProb: 0.1 },
    { grade: 'A0', atLeastProb: 0.45 },
    { grade: 'B+', atLeastProb: 0.8 },
    { grade: 'B0', atLeastProb: 1 },
  ]), ['A+', 'B0']);
});

test('blur(Tier<=1) 케이스는 오답이 아니라 채점 제외로 처리된다', () => {
  // 정직하게 침묵한 엔진이 벌점을 받으면 안 된다
  const out = scoreCase('x', pred({ tier: 1, distribution: null }), 'B0');
  assert.equal(out.skipped, true);
  assert.equal(out.gradeError, null);
});

test('runBacktest: 적중/오차/구간포함을 집계한다', () => {
  const dist = [
    { grade: 'A+' as const, atLeastProb: 0.1 },
    { grade: 'A0' as const, atLeastProb: 0.7 },
    { grade: 'B+' as const, atLeastProb: 1 },
  ];
  const engine: EngineAdapter = { predict: () => pred({ distribution: dist }) };
  const cases: BacktestCase[] = [
    { id: '1', course: emptyCourse('1'), actualGrade: 'A0', source: 'sample' },
    { id: '2', course: emptyCourse('2'), actualGrade: 'B+', source: 'sample' },
  ];
  const r = runBacktest(cases, engine);
  assert.equal(r.evaluated, 2);
  assert.equal(r.hitRate, 0.5);
  assert.equal(r.nearHitRate, 1);
  assert.equal(r.intervalCoverage, 1);
  assert.ok(r.brierScore !== null && r.brierScore > 0);
});

test('헤드라인: 오답이 경계구간이 아니면 "전부 경계구간"이라고 말하지 않는다', () => {
  // 과장 금지가 이 앱의 정체성이므로 발표 문구에서도 깨지면 안 된다
  const dist = [{ grade: 'A0' as const, atLeastProb: 1 }];
  const engine: EngineAdapter = { predict: () => pred({ distribution: dist, warnings: [] }) };
  const r = runBacktest(
    [{ id: '1', course: emptyCourse('1'), actualGrade: 'C+', source: 'sample' }],
    engine,
  );
  assert.doesNotMatch(r.headline, /전부/);
  assert.match(r.headline, /0건만 경계 구간/);
});
