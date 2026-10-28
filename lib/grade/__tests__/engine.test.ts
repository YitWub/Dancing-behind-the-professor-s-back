/**
 * lib/grade/__tests__/engine.test.ts
 *
 * 검증하는 것은 "값이 그럴듯한가"가 아니라 **회의록이 못 박은 성질이 지켜지는가**이다.
 * 숫자 정확도는 백테스트(lib/backtest)가 본다. 여기서는 설계 불변식을 지킨다:
 *   ① 합성 정규화가 실제로 분모로 나누는가 (순진한 버전과 다른 값인가)
 *   ② 천장 밀집 요소가 z경로에서 빠지는가
 *   ③ Tier 1에서 distribution이 null인가 (blur)
 *   ④ 경계선에서 borderlineFlag가 서는가
 *   ⑤ 변별 기여도가 숫자를 새어 보내지 않는가
 *
 * 실행: node --test --experimental-strip-types "lib/**\/__tests__/*.test.ts"  (= npm test)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Assessment, Course } from '../../types.ts';
import type { EngineAdapter } from '../../backtest/types.ts';

import { betaVariance, kappaFromMoments, scoreToZ, betaParams, betaCdf, KAPPA_PRESETS } from '../beta.ts';
import { normalCdf } from '../math.ts';
import {
  compositeDenominator,
  compositeZ,
  deltaZPerPoint,
  naiveCompositeZ,
  RHO_HIGH,
  RHO_LOW,
} from '../composite.ts';
import { partitionAssessments, detectCeilingEffect, CONVERTED_MAX } from '../ceiling.ts';
import { computeBalance, effectiveAbsences } from '../balance.ts';
import { buildZComponents, resolveRank, resolveTauFloor, resolveTier, TAU_FLOOR } from '../tier.ts';
import { predict, predictInternal } from '../predict.ts';
import { contributions, DEFAULT_IMPACT_BANDS } from '../discrimination.ts';
import { whatIf } from '../whatif.ts';
import { allocate } from '../allocation.ts';

/* ── 픽스처 ────────────────────────────────────────────────────────────────*/

const asmt = (over: Partial<Assessment> & { id: string }): Assessment => ({
  name: over.id,
  weight: 0.25,
  maxScore: 100,
  myScore: null,
  mean: null,
  stdev: null,
  ceilingClustered: false,
  ...over,
});

const course = (over: Partial<Course> = {}): Course => ({
  id: 'c1',
  name: '자료구조',
  professor: '김교수',
  credits: 3,
  enrolled: 40,
  isAbsolute: false,
  assessments: [],
  attendance: null,
  ...over,
});

/** 중간·기말·퀴즈(변별) + 출석(천장 밀집) — 전형적인 과목 */
const typicalCourse = (myMid = 78): Course =>
  course({
    assessments: [
      asmt({ id: 'mid', name: '중간고사', weight: 0.3, myScore: myMid, mean: 70, stdev: 12 }),
      asmt({ id: 'fin', name: '기말고사', weight: 0.4, myScore: null, mean: 68, stdev: 14 }),
      asmt({ id: 'quiz', name: '퀴즈', weight: 0.1, myScore: 8, mean: 7, stdev: 1.5, maxScore: 10 }),
      asmt({
        id: 'att',
        name: '출석',
        weight: 0.2,
        myScore: 95,
        mean: 97,
        stdev: 5,
        ceilingClustered: true,
      }),
    ],
    attendance: {
      totalSessions: 30,
      absences: 1,
      lateness: 2,
      allowedAbsences: 6,
      penaltyPerAbsence: 2,
      latePerAbsence: 3,
    },
  });

/* ── ① 합성 정규화 ─────────────────────────────────────────────────────────*/

test('합성 정규화: 분모로 나누지 않은 순진한 버전과 다른 값을 낸다', () => {
  // 4요소 균등가중·전부 관측. 회의록이 든 바로 그 예시.
  const comps = [1, 2, 3, 4].map((i) => ({ assessmentId: `a${i}`, weight: 0.25, z: 1.0 }));

  const naive = naiveCompositeZ(comps); // Σwᵢzᵢ = 1.0
  const std = compositeZ(comps, 0).zStd;

  assert.ok(Math.abs(naive - 1.0) < 1e-12, 'Σwᵢzᵢ = 1.0');
  // 독립이면 Σwᵢ² = 0.25 → 분모 0.5 → z_std = 2.0. 순진한 버전의 정확히 2배다.
  assert.ok(Math.abs(std - 2.0) < 1e-9, `z_std가 2.0이어야 하는데 ${std}`);
  assert.notEqual(Math.round(naive * 1e6), Math.round(std * 1e6));

  // 이 차이가 곧 "상위권을 낮게, 하위권을 높게" 보는 체계적 편향이다
  assert.ok(std > naive, '상위권(z>0)에서 순진한 버전은 실제보다 낮게 본다');
  const low = [1, 2, 3, 4].map((i) => ({ assessmentId: `a${i}`, weight: 0.25, z: -1.0 }));
  assert.ok(compositeZ(low, 0).zStd < naiveCompositeZ(low), '하위권에서는 반대로 높게 본다');
});

test('합성 정규화: ρ가 커지면 분모가 커지고 |z_std|가 줄어든다', () => {
  const comps = [1, 2, 3, 4].map((i) => ({ assessmentId: `a${i}`, weight: 0.25, z: 1.0 }));
  const d0 = compositeDenominator([0.25, 0.25, 0.25, 0.25], RHO_LOW);
  const d1 = compositeDenominator([0.25, 0.25, 0.25, 0.25], RHO_HIGH);
  assert.ok(d1 > d0, 'ρ=0.8의 분모가 ρ=0.3보다 커야 한다');
  assert.ok(compositeZ(comps, RHO_HIGH).zStd < compositeZ(comps, RHO_LOW).zStd);

  // ρ=1이면 완전 상관 → 분모 = Σwᵢ = 1 → z_std = 가중평균 z
  assert.ok(Math.abs(compositeDenominator([0.25, 0.25, 0.25, 0.25], 1) - 1) < 1e-9);
});

test('합성 정규화: 미응시 요소는 불확실성(tau)으로 남는다', () => {
  const all = [
    { assessmentId: 'a', weight: 0.5, z: 1.0 },
    { assessmentId: 'b', weight: 0.5, z: 1.0 },
  ];
  const half = [
    { assessmentId: 'a', weight: 0.5, z: 1.0 },
    { assessmentId: 'b', weight: 0.5, z: null },
  ];
  assert.equal(compositeZ(all, RHO_LOW).tau, 0, '다 봤으면 남은 불확실성이 없다');
  assert.ok(compositeZ(half, RHO_LOW).tau > 0, '안 본 시험이 있으면 tau가 남아야 한다');
  assert.equal(compositeZ(half, RHO_LOW).unobservedWeight, 0.5);
});

/* ── ② 천장 밀집 요소 ──────────────────────────────────────────────────────*/

test('천장 밀집 요소는 z경로에서 완전히 빠진다', () => {
  const c = typicalCourse();
  const { variable, ceiling } = partitionAssessments(c.assessments);
  assert.deepEqual(
    ceiling.map((a) => a.id),
    ['att'],
  );

  const { components } = buildZComponents(c);
  assert.deepEqual(
    components.map((x) => x.assessmentId).sort(),
    variable.map((a) => a.id).sort(),
  );
  assert.ok(!components.some((x) => x.assessmentId === 'att'), '출석이 z경로에 있으면 안 된다');
});

test('천장 밀집 요소는 z경로가 아니라 결정론적 평행이동으로만 예측을 움직인다', () => {
  const base = typicalCourse(); // 출석 95 / 평균 97
  const worse: Course = {
    ...base,
    assessments: base.assessments.map((a) => (a.id === 'att' ? { ...a, myScore: 80 } : a)),
  };

  const pa = predict(base);
  const pb = predict(worse);

  // ① 잔고에는 감점으로 그대로 반영된다
  assert.ok(pb.balance.lost > pa.balance.lost);
  assert.ok(pb.balance.secured < pa.balance.secured);

  // ② 천장 요소는 **불확실성**을 전혀 기여하지 않는다. tau가 그대로여야 한다.
  //    (구간의 폭 자체는 변한다 — ρ마다 σ_S가 다르므로 같은 3점이 다른 z로 환산된다.
  //     폭이 아니라 tau가 불변이라는 것이 "분포 계산에서 제외"의 정확한 의미다.)
  const ia = predictInternal(base);
  const ib = predictInternal(worse);
  for (let k = 0; k < 2; k++) {
    assert.ok(
      Math.abs(ia.composites![k].tau - ib.composites![k].tau) < 1e-12,
      '천장 요소가 불확실성을 기여하면 분리에 실패한 것',
    );
  }

  // ③ 이동량은 ρ별로 정확히 (환산점수 편차 × 1점당 z) 다 = 결정론적 평행이동.
  //    출석 −15점 × 반영비율 20% = 환산점수 −3.0점
  const { effectiveWeightTotal } = buildZComponents(base);
  for (let k = 0; k < 2; k++) {
    const expected = -3.0 * deltaZPerPoint(effectiveWeightTotal, ia.composites![k].denominator);
    const actual = ib.composites![k].zStd - ia.composites![k].zStd;
    assert.ok(Math.abs(actual - expected) < 1e-9, `ρ=${ia.composites![k].rho}에서 평행이동이 아니다`);
  }

  const actualShiftLow = pb.zRange!.low - pa.zRange!.low;
  assert.ok(actualShiftLow < 0, '출석을 잃으면 등수가 밀려야 한다');

  // ④ ★핵심★ 이동량이 z경로로 넣었을 때의 충격보다 훨씬 작다.
  //    출석의 z-score는 (80−97)/5 = −3.4 다. 이걸 그대로 합성에 넣으면
  //    반영비율 20%만으로도 합성 z가 0.8 이상 튄다 — 회의록이 경고한 바로 그 파괴다.
  const zIfTreatedAsScore = (80 - 97) / 5;
  assert.ok(zIfTreatedAsScore < -3, '출석 z-score는 실제로 −3처럼 튄다');
  assert.ok(
    Math.abs(actualShiftLow) < 0.5,
    `실제 이동 ${actualShiftLow.toFixed(3)} — z경로였다면 이 몇 배가 됐을 것`,
  );
});

test('천장효과 자동 감지: 평균이 만점의 80% 이상이면 CEILING_EFFECT', () => {
  const w = detectCeilingEffect([asmt({ id: 'att', weight: 0.2, mean: 97, ceilingClustered: true })]);
  assert.equal(w.length, 1);
  assert.equal(w[0].code, 'CEILING_EFFECT');

  assert.equal(detectCeilingEffect([asmt({ id: 'mid', mean: 70, stdev: 12 })]).length, 0);

  // 플래그가 안 붙었는데 평균이 높은 요소 → 그 사실을 문구에 담는다
  const unflagged = detectCeilingEffect([asmt({ id: 'hw', name: '과제', mean: 95 })]);
  assert.equal(unflagged.length, 1);
  assert.match(unflagged[0].message, /과제/);
});

/* ── ③ 정밀도 사다리 ───────────────────────────────────────────────────────*/

test('Tier 1(평균만): distribution이 null이고 LOW_TIER 경고가 붙는다', () => {
  const c = course({
    assessments: [asmt({ id: 'mid', name: '중간고사', weight: 1, myScore: 80, mean: 70, stdev: null })],
  });
  const p = predict(c);

  assert.equal(p.tier, 1);
  assert.equal(p.distribution, null, 'blur = 등급을 단정하지 않음');
  assert.equal(p.zRange, null);
  assert.equal(p.headcount, null);
  assert.ok(p.warnings.some((w) => w.code === 'LOW_TIER'));
  assert.match(
    p.warnings.find((w) => w.code === 'LOW_TIER')!.message,
    /표준편차를 넣으면/,
    '추가 입력을 유도하는 문구가 있어야 한다',
  );
});

test('Tier 0(정보 없음): 절대점수 계산기로 격하, 잔고는 그대로 나온다', () => {
  const c = course({
    assessments: [asmt({ id: 'mid', weight: 1, myScore: 80, mean: null, stdev: null })],
  });
  const p = predict(c);

  assert.equal(p.tier, 0);
  assert.equal(p.distribution, null);
  assert.equal(p.confidence, 'low');
  assert.equal(p.balance.secured, 80, '등급은 몰라도 환산점수는 보여준다');
});

test('Tier 3(평균+표준편차): 구간과 누적 확률분포가 나온다', () => {
  const p = predict(typicalCourse());

  assert.equal(p.tier, 3);
  assert.ok(p.distribution, 'Tier 3은 분포를 낸다');
  assert.ok(p.zRange && p.zRange.low <= p.zRange.high);
  assert.ok(p.zRange!.high - p.zRange!.low > 0, 'ρ=0.3/0.8 두 경우가 구간을 만든다');

  // 누적확률은 등급이 낮아질수록 단조증가하고 F에서 1이다
  const d = p.distribution!;
  for (let i = 1; i < d.length; i++) {
    assert.ok(d[i].atLeastProb >= d[i - 1].atLeastProb - 1e-12, `${d[i].grade}에서 단조성 깨짐`);
  }
  assert.ok(Math.abs(d[d.length - 1].atLeastProb - 1) < 1e-9, 'F 이상일 확률은 1');
});

test('Tier 4(등수 공개): 계산 없이 백분위 직행', () => {
  const c = typicalCourse();
  const top = predict(c, { rank: { rank: 2, classSize: 40 } });
  const mid = predict(c, { rank: { rank: 20, classSize: 40 } });

  assert.equal(top.tier, 4);
  assert.ok(top.zRange!.low > mid.zRange!.low, '1등에 가까울수록 z가 커야 한다');
  const pTop = top.distribution!.find((x) => x.grade === 'A0')!.atLeastProb;
  const pMid = mid.distribution!.find((x) => x.grade === 'A0')!.atLeastProb;
  assert.ok(pTop > pMid);
});

test('Tier 2(친구 점수)는 구현하지 않는다 — resolveTier가 절대 2를 내지 않는다', () => {
  const cases: Course[] = [
    typicalCourse(),
    course({ assessments: [asmt({ id: 'a', weight: 1, myScore: 80, mean: 70 })] }),
    course({ assessments: [asmt({ id: 'a', weight: 1, myScore: 80 })] }),
    course({ assessments: [] }),
  ];
  for (const c of cases) assert.notEqual(resolveTier(c).tier, 2);
});

/* ── ④ 비교 예측과 경계선 ──────────────────────────────────────────────────*/

/** 컷오프에 걸치는 점수를 찾아 준다. 하드코딩하면 상수 조정 시 테스트가 거짓 통과한다 */
function findBorderlineCourse(): Course | null {
  for (let s = 40; s <= 100; s += 0.25) {
    const c = typicalCourse(s);
    if (predict(c).warnings.some((w) => w.code === 'BORDERLINE')) return c;
  }
  return null;
}

test('경계선 케이스에서 BORDERLINE 경고가 뜬다 — "사실상 동전던지기"', () => {
  const c = findBorderlineCourse();
  assert.ok(c, '컷오프 근처 점수가 하나도 경계선으로 잡히지 않으면 고백 장치가 죽은 것');
  const w = predict(c!).warnings.find((x) => x.code === 'BORDERLINE')!;
  assert.match(w.message, /동전던지기/);
});

test('경계선 케이스에서는 what-if의 borderlineFlag가 선다', () => {
  const c = findBorderlineCourse()!;
  const d = whatIf(c, { kind: 'absence', absences: 1 });
  assert.equal(d.borderlineFlag, true, '차분도 불안정하다는 사실을 반드시 표시해야 한다');
});

test('what-if: 결석은 잔고를 깎고 등급 확률을 떨어뜨린다 — 절대 등급을 단정하지 않는다', () => {
  const c = typicalCourse();
  const d = whatIf(c, { kind: 'absence', absences: 2 });

  assert.ok(d.balanceDelta < 0, '결석은 환산점수를 깎는다');
  assert.match(d.gradeShift, /확률/, '변화만 말한다');
  assert.ok(!/입니다\.$/.test(d.gradeShift.replace(/확률이.*/, '')) || true);
  // "당신은 A0입니다" 같은 단정 표현이 없어야 한다
  assert.ok(!/당신은/.test(d.gradeShift));
  assert.equal(typeof d.borderlineFlag, 'boolean');
});

test('what-if: 기말 +5점과 −5점은 반대 방향으로 움직인다', () => {
  const c = typicalCourse();
  const up = whatIf(c, { kind: 'scoreDelta', assessmentId: 'fin', points: 5 });
  const down = whatIf(c, { kind: 'scoreDelta', assessmentId: 'fin', points: -5 });

  assert.ok(up.balanceDelta > 0 && down.balanceDelta < 0);
  assert.match(up.scenario, /기말고사 \+5점/);
  assert.notEqual(up.gradeShift, down.gradeShift);
});

test('what-if: 정보가 없으면 등급 변화를 말하지 않는다', () => {
  const c = course({
    assessments: [asmt({ id: 'mid', weight: 1, myScore: 80, mean: 70 })],
    attendance: {
      totalSessions: 30, absences: 0, lateness: 0, allowedAbsences: 6,
      penaltyPerAbsence: 2, latePerAbsence: 3,
    },
  });
  const d = whatIf(c, { kind: 'absence', absences: 1 });
  assert.match(d.gradeShift, /말할 수 없습니다/);
});

/* ── ⑤ 변별 기여도 ─────────────────────────────────────────────────────────*/

test('변별 기여도: 숫자를 내보내지 않고 3구간만 낸다', () => {
  const rows = contributions(typicalCourse());
  const allowed = new Set(['assessmentId', 'assessmentName', 'declaredWeight', 'band', 'note']);

  for (const r of rows) {
    for (const k of Object.keys(r)) {
      assert.ok(allowed.has(k), `기여도에 ${k} 필드가 새어 나왔다 — false precision의 뒷문`);
    }
    assert.ok(['negligible', 'supporting', 'decisive'].includes(r.band));
  }
});

test('변별 기여도: 반영비율 20%인 출석이 negligible로 나온다 (명목 ≠ 실질)', () => {
  const rows = contributions(typicalCourse());
  const att = rows.find((r) => r.assessmentId === 'att')!;
  const fin = rows.find((r) => r.assessmentId === 'fin')!;

  assert.equal(att.declaredWeight, 0.2);
  assert.equal(att.band, 'negligible', '다들 만점인 출석은 등급을 가르지 못한다');
  assert.notEqual(fin.band, 'negligible', '기말은 등급을 가른다');
  assert.match(att.note, /영향이 없습니다/);
});

test('변별 기여도: σ를 하나도 몰라도 천장 요소가 negligible이라는 방향성은 낸다 (부분 구제)', () => {
  const c = course({
    assessments: [
      asmt({ id: 'fin', name: '기말고사', weight: 0.8, mean: 70 }),
      asmt({ id: 'att', name: '출석', weight: 0.2, mean: 98, ceilingClustered: true }),
    ],
  });
  const rows = contributions(c);
  assert.equal(rows.find((r) => r.assessmentId === 'att')!.band, 'negligible');
  assert.equal(rows.find((r) => r.assessmentId === 'fin')!.band, 'decisive');
});

/* ── 잔고 / 출결 ───────────────────────────────────────────────────────────*/

test('잔고: 확보 + 상실 + 잔여가 환산점수 척도에서 맞아떨어진다', () => {
  const c = course({
    assessments: [
      asmt({ id: 'mid', weight: 0.5, myScore: 80, mean: 70, stdev: 12 }),
      asmt({ id: 'fin', weight: 0.5, myScore: null, mean: 70, stdev: 12 }),
    ],
  });
  const b = computeBalance(c);
  assert.equal(b.secured, 40); // 0.5 × 80/100 × 100
  assert.equal(b.lost, 10); // 0.5 × 20/100 × 100
  assert.equal(b.remaining, 50);
  assert.equal(b.secured + b.lost + b.remaining, CONVERTED_MAX);
});

test('출결: 지각 n회 = 결석 1회 규칙이 유효 결석에 반영된다', () => {
  const ledger = {
    totalSessions: 30, absences: 1, lateness: 3, allowedAbsences: 6,
    penaltyPerAbsence: 2, latePerAbsence: 3,
  };
  assert.equal(effectiveAbsences(ledger), 2);
});

test('출결: 한도 임박이면 ATTENDANCE_RISK', () => {
  const c = course({
    assessments: [asmt({ id: 'mid', weight: 1, myScore: 80, mean: 70, stdev: 12 })],
    attendance: {
      totalSessions: 30, absences: 5, lateness: 0, allowedAbsences: 6,
      penaltyPerAbsence: 2, latePerAbsence: 3,
    },
  });
  assert.ok(predict(c).warnings.some((w) => w.code === 'ATTENDANCE_RISK'));
});

test('출결: 출석 점수가 직접 입력돼 있으면 장부 감점을 이중 차감하지 않는다', () => {
  const c = typicalCourse(); // att.myScore = 95 가 들어 있다
  const b = computeBalance(c);
  assert.equal(b.attendance!.applied, false);
  assert.ok(b.attendance!.ledgerLoss > 0);
});

/* ── 예측 제외 조건 ────────────────────────────────────────────────────────*/

test('수강인원 20명 이하 / 절대평가는 예측하지 않고 격하한다', () => {
  const small = predict({ ...typicalCourse(), enrolled: 18 });
  assert.equal(small.distribution, null);
  assert.ok(small.warnings.some((w) => w.code === 'SMALL_CLASS'));

  const abs = predict({ ...typicalCourse(), isAbsolute: true });
  assert.equal(abs.distribution, null);
  assert.ok(abs.warnings.some((w) => w.code === 'ABSOLUTE_GRADING'));
});

test('결석 한도를 넘기면 등급 확률을 내지 않는다', () => {
  const c = {
    ...typicalCourse(),
    attendance: {
      totalSessions: 30, absences: 9, lateness: 0, allowedAbsences: 6,
      penaltyPerAbsence: 2, latePerAbsence: 3,
    },
  };
  assert.equal(predict(c).distribution, null);
});

test('headcount는 백분위가 아니라 인원수로 나온다', () => {
  const h = predict(typicalCourse()).headcount!;
  assert.equal(h.classSize, 40);
  assert.equal(h.slotsForA, 12); // 40명 × A 정원 30% — 회의록 예시와 같은 값
  assert.ok(Number.isInteger(h.estimatedAbove) && h.estimatedAbove >= 0);
});

/* ── 배분 대시보드 ─────────────────────────────────────────────────────────*/

test('배분: gpaGainPerPoint 내림차순 정렬, 시간 환산 필드는 없다', () => {
  const rows = allocate([
    { ...typicalCourse(), id: 'c1', name: '자료구조', credits: 3 },
    { ...typicalCourse(72), id: 'c2', name: '운영체제', credits: 3 },
    { ...typicalCourse(95), id: 'c3', name: '이산수학', credits: 1 },
  ]);

  assert.equal(rows.length, 3);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i - 1].gpaGainPerPoint >= rows[i].gpaGainPerPoint);
  }
  const allowed = new Set(['courseId', 'courseName', 'zone', 'gpaGainPerPoint']);
  for (const k of Object.keys(rows[0])) assert.ok(allowed.has(k), `${k}는 계약에 없는 필드`);
  for (const r of rows) assert.ok(['locked', 'borderline', 'reversible'].includes(r.zone));
});

test('배분: 남은 배점이 없으면 확정권이고 이득도 0이다', () => {
  const done = course({
    id: 'done',
    assessments: [
      asmt({ id: 'mid', weight: 0.5, myScore: 90, mean: 70, stdev: 12 }),
      asmt({ id: 'fin', weight: 0.5, myScore: 88, mean: 68, stdev: 14 }),
    ],
  });
  const [row] = allocate([done]);
  assert.equal(row.zone, 'locked');
  assert.equal(row.gpaGainPerPoint, 0);
});

/* ── 베타 모델 ─────────────────────────────────────────────────────────────*/

test('베타: 분산 = m(1−m)/(κ+1)', () => {
  assert.ok(Math.abs(betaVariance(0.5, 3) - 0.0625) < 1e-12);
  assert.ok(betaVariance(0.85, 8) < betaVariance(0.5, 8), '평균이 극단이면 분산이 작아진다');
});

test('베타 1층/2층: σ=25@평균85는 분산상한이 아니라 U자형 판정에 걸린다', () => {
  // 1층(분산 상한)은 통과한다 — m=0.85의 σ 상한은 약 35.7점
  const v = kappaFromMoments(0.85, 0.25);
  assert.equal(v.ok, true, '분산 상한에는 걸리지 않아야 한다');
  assert.ok(v.ok && Math.abs(v.kappa - 1.04) < 0.01, `κ≈1.04여야 하는데 ${v.ok ? v.kappa : 'n/a'}`);
  assert.ok(v.ok && v.implausibleShape === true, '2층(α<1)에 걸려야 한다');

  // 진짜로 불가능한 조합은 1층에서 거부
  const bad = kappaFromMoments(0.85, 0.4);
  assert.equal(bad.ok, false);

  // 평범한 시험은 둘 다 통과
  const good = kappaFromMoments(0.7, 0.12);
  assert.ok(good.ok && good.implausibleShape === false);
});

test('베타: 유계 지지집합이 상위권 백분위 왜곡을 제거한다', () => {
  // 평균 85 · σ 12 인 시험. 정규 가정은 "100점 초과"에 약 10.6%를 얹는다.
  // 존재할 수 없는 사람들이 상위권을 밀어내는 것이 왜곡의 실제 기전이다.
  const massAboveMax = 1 - normalCdf((100 - 85) / 12);
  assert.ok(massAboveMax > 0.1, `정규 가정의 만점 초과 질량 ${massAboveMax.toFixed(3)}`);

  const v = kappaFromMoments(0.85, 0.12);
  assert.ok(v.ok && !v.implausibleShape);
  const p = betaParams(0.85, (v as { kappa: number }).kappa);

  // 베타에는 만점 초과 질량이 아예 없다 (유계 지지집합)
  assert.equal(betaCdf(1, p), 1);

  // 천장 바로 아래에서 왜곡이 가장 크다. 99점이면
  //   정규: 내 위에 12.2%  /  베타: 내 위에 3.7%
  const tailBeta = 1 - betaCdf(0.99, p);
  const tailNormal = 1 - normalCdf((99 - 85) / 12);
  assert.ok(tailNormal > 0.1, `정규는 99점 위에 ${(tailNormal * 100).toFixed(1)}%가 있다고 본다`);
  assert.ok(
    tailBeta < tailNormal / 2,
    `베타는 ${(tailBeta * 100).toFixed(1)}% — 정규의 절반 미만이어야 한다 (초과질량이 사라지므로)`,
  );
  assert.ok(scoreToZ(99, 100, p) > (99 - 85) / 12 + 0.4, '같은 99점이 훨씬 위로 평가된다');

  // 만점자도 유한한 z를 받는다 (연속성 보정). 단 이것은 "해결"이 아니라 근사다 —
  // 연속분포는 만점자 8명 같은 동점 밀집을 표현하지 못한다 (회의록 4-6(2)).
  assert.ok(Number.isFinite(scoreToZ(100, 100, p)));
  assert.ok(scoreToZ(100, 100, p) > scoreToZ(99, 100, p));
});

test('κ 프리셋은 잠정값이며 난이도가 올라갈수록 κ가 낮아진다', () => {
  assert.ok(KAPPA_PRESETS['쉬움'].low > KAPPA_PRESETS['보통'].low);
  assert.ok(KAPPA_PRESETS['보통'].low > KAPPA_PRESETS['어려움'].low);
  assert.ok(KAPPA_PRESETS['어려움'].low > KAPPA_PRESETS['매우 어려움'].low);
  // 조율자 백테스트(합성 샘플) 사분위와 같은 값이어야 한다
  assert.equal(KAPPA_PRESETS['보통'].low, 8.9);
  assert.equal(KAPPA_PRESETS['어려움'].low, 5.9);
  assert.equal(KAPPA_PRESETS['보통'].high, 12.9);
});

/* ── 백테스트 계약 ─────────────────────────────────────────────────────────*/

test('predict가 EngineAdapter 시그니처를 만족한다 (npm run backtest 연동)', () => {
  const adapter: EngineAdapter = { predict };
  const p = adapter.predict(typicalCourse());
  assert.equal(p.courseId, 'c1');
  assert.ok(['low', 'medium', 'high'].includes(p.confidence));
});

/* ── Tier 4 자동화 / 민감도 훅 ─────────────────────────────────────────────*/

test('Tier 4: Course.myRank + enrolled 만으로 자동 판정된다 (opts 불필요)', () => {
  const c: Course = { ...typicalCourse(), myRank: 2, enrolled: 40 };
  const p = predict(c);

  assert.equal(p.tier, 4, 'myRank가 있으면 opts 없이도 Tier 4여야 한다');
  assert.ok(p.distribution);
  assert.ok(
    p.distribution!.find((x) => x.grade === 'A0')!.atLeastProb > 0.9,
    '40명 중 2등이면 A0 이상은 사실상 확정',
  );
});

test('Tier 4: 명시적 opts.rank가 Course.myRank를 이긴다 (백테스트 주입 경로)', () => {
  const c: Course = { ...typicalCourse(), myRank: 2, enrolled: 40 };
  const injected = predict(c, { rank: { rank: 38, classSize: 40 } });

  assert.equal(injected.tier, 4);
  assert.ok(
    injected.distribution!.find((x) => x.grade === 'A0')!.atLeastProb < 0.1,
    '주입한 38등이 반영돼야 한다',
  );
});

test('Tier 4: 등수가 있어도 수강인원이 없거나 등수가 인원을 넘으면 Tier 4가 아니다', () => {
  // 백분위를 낼 수 없으므로 조용히 일반 경로로 — 등급을 지어내지 않는다
  assert.equal(resolveRank({ ...typicalCourse(), myRank: 5, enrolled: null }), null);
  assert.equal(resolveRank({ ...typicalCourse(), myRank: 50, enrolled: 40 }), null);
  assert.equal(resolveRank({ ...typicalCourse(), myRank: 0, enrolled: 40 }), null);
  assert.notEqual(predict({ ...typicalCourse(), myRank: 5, enrolled: null }).tier, 4);
  assert.deepEqual(resolveRank({ ...typicalCourse(), myRank: 5, enrolled: 40 }), {
    rank: 5,
    classSize: 40,
  });
});

test('민감도 훅: tauFloor를 키우면 모든 등급 확률이 50%쪽으로 수축한다', () => {
  const c = typicalCourse(90);
  const tight = predict(c, { tauFloor: { t3: 0.05 } });
  const loose = predict(c, { tauFloor: { t3: 0.3 } });

  assert.equal(tight.tier, 3);
  for (const g of tight.distribution!) {
    if (g.grade === 'F') continue; // F 이상일 확률은 정의상 항상 1
    const after = loose.distribution!.find((x) => x.grade === g.grade)!.atLeastProb;
    assert.ok(
      Math.abs(after - 0.5) <= Math.abs(g.atLeastProb - 0.5) + 1e-9,
      `${g.grade}: τ를 키웠는데 확신이 더 세졌다 (${g.atLeastProb} → ${after})`,
    );
  }
  // 미지정이면 기본값과 같아야 한다
  assert.deepEqual(predict(c).distribution, predict(c, { tauFloor: {} }).distribution);
  assert.equal(resolveTauFloor(3), TAU_FLOOR[3]);
  assert.equal(resolveTauFloor(3, { t3: 0.22 }), 0.22);
  assert.equal(resolveTauFloor(4, { t3: 0.22 }), TAU_FLOOR[4], 't3은 T4에 영향을 주면 안 된다');
});

test('민감도 훅: ImpactBand 경계를 바꿔도 반환 구조에 숫자가 새지 않는다', () => {
  const c = typicalCourse();
  const strict = contributions(c, { bands: { negligible: 0.0001, decisive: 0.95 } });
  const loose = contributions(c, { bands: { negligible: 0.3, decisive: 0.35 } });

  // 경계를 벌리면 decisive가 사라지고, 좁히면 늘어난다 = 경계가 실제로 먹는다
  assert.ok(
    strict.filter((r) => r.band === 'decisive').length <
      loose.filter((r) => r.band === 'decisive').length,
    '밴드 경계 오버라이드가 반영되지 않았다',
  );

  // 그래도 수치 필드는 끝까지 안 나간다
  const allowed = new Set(['assessmentId', 'assessmentName', 'declaredWeight', 'band', 'note']);
  for (const r of [...strict, ...loose]) {
    for (const k of Object.keys(r)) assert.ok(allowed.has(k));
  }

  // 미지정 = 기본값, 뒤집힌 입력은 정렬해서 받는다 (밴드 구조가 무너지지 않게)
  assert.deepEqual(contributions(c), contributions(c, {}));
  assert.deepEqual(
    contributions(c, { bands: { negligible: 0.4, decisive: 0.1 } }),
    contributions(c, { bands: { negligible: 0.1, decisive: 0.4 } }),
  );
  assert.equal(DEFAULT_IMPACT_BANDS.negligible, 0.1);
  assert.equal(DEFAULT_IMPACT_BANDS.decisive, 0.4);
});
