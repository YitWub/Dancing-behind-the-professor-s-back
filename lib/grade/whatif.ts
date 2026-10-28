/**
 * lib/grade/whatif.ts — 비교 예측 (회의록 4-3, 킬러 UX)
 *
 *   (약함) "당신은 A0입니다"                     ← 틀리면 신뢰가 무너진다
 *   (강함) "이번 주 결석하면 A0 가능성이 눈에 띄게 줄어듭니다"
 *
 * 같은 가정 하의 두 시나리오 **차분**은 공통 편향이 상쇄되어 수준 추정보다 robust하다.
 * σ를 잘못 잡았어도, ρ를 잘못 잡았어도, 정원 비율을 잘못 잡았어도, 두 시나리오에
 * 똑같이 잘못 들어가므로 차이에서는 상당 부분 지워진다.
 * 사용자가 실제로 필요한 것도 "내가 A0다"가 아니라 "이 선택을 해도 되나"이다.
 *
 * ★단서를 반드시 달 것 (회의록 4-6(2))
 * 등급은 컷오프가 있는 비선형 변환이라 경계선 근처에서는 차분도 불안정하다.
 * "공통 편향 상쇄로 덜 틀림"을 무조건 주장하지 말고, borderlineFlag를
 * "모델 한계의 고백 장치"로 명시적으로 연결한다. 이 플래그가 서면 화면에서
 * 차분 문구를 약하게 쓰거나 "이 경우엔 예측이 흔들립니다"를 같이 보여줄 것.
 *
 * 절대 등급 단정 금지: 이 모듈은 "A0가 된다/안 된다"를 말하지 않는다. 변화만 말한다.
 */

import type { Assessment, Course, CumulativeGradeProb, GradeLetter, WhatIfDelta } from '@/lib/types';
import { withExtraAttendance } from './balance.ts';
import { CONVERTED_MAX } from './ceiling.ts';
import { RHO_LOW, expectedZForUnobserved } from './composite.ts';
import { buildZComponents } from './tier.ts';
import { predictInternal, type PredictOptions } from './predict.ts';

export type Scenario =
  /** "이번 주 결석" — 기본 1회. 지각도 같이 넣을 수 있다 */
  | { kind: 'absence'; absences?: number; lateness?: number; label?: string }
  /** "기말 +5점" — 내가 원래 받을 것으로 보이는 점수 대비 ±points */
  | { kind: 'scoreDelta'; assessmentId: string; points: number; label?: string }
  /** "과제 미제출" — 해당 요소를 0점 처리 */
  | { kind: 'missSubmission'; assessmentId: string; label?: string };

export function scenarioLabel(s: Scenario, course: Course): string {
  if (s.label) return s.label;
  switch (s.kind) {
    case 'absence': {
      const a = s.absences ?? 1;
      const l = s.lateness ?? 0;
      return l > 0 ? `결석 ${a}회 + 지각 ${l}회` : a === 1 ? '이번 주 결석' : `결석 ${a}회`;
    }
    case 'scoreDelta': {
      const name = findName(course, s.assessmentId);
      return `${name} ${s.points >= 0 ? '+' : ''}${s.points}점`;
    }
    case 'missSubmission':
      return `${findName(course, s.assessmentId)} 미제출`;
  }
}

/**
 * 시나리오 하나의 차분.
 *
 * scoreDelta는 기준선을 따로 만든다. 아직 안 본 시험을 그냥 "평균+5점"으로 채우면
 * "+5점의 효과"에 "불확실성이 사라진 효과"가 섞여 차분이 부풀려지기 때문에,
 * 기준선도 같은 방식으로 채운 뒤(내 조건부 기대 점수) 두 쪽을 비교한다.
 */
export function whatIf(course: Course, scenario: Scenario, opts: PredictOptions = {}): WhatIfDelta {
  const { base, variant } = buildPair(course, scenario);

  const before = predictInternal(base, opts);
  const after = predictInternal(variant, opts);

  const balanceDelta =
    round2(after.balance.secured - before.balance.secured) -
    round2(after.balance.lost - before.balance.lost);

  const borderlineBefore = hasBorderline(before.prediction.warnings);
  const borderlineAfter = hasBorderline(after.prediction.warnings);

  const db = before.prediction.distribution;
  const da = after.prediction.distribution;

  if (!db || !da) {
    return {
      scenario: scenarioLabel(scenario, course),
      balanceDelta: round2(balanceDelta),
      gradeShift:
        '등급 변화는 말할 수 없습니다 — 아직 등급을 계산할 만한 정보가 없어 환산점수 변화만 보여줍니다.',
      borderlineFlag: borderlineBefore || borderlineAfter,
    };
  }

  const target = pivotGrade(db);
  const pBefore = probOf(db, target);
  const pAfter = probOf(da, target);
  const delta = pAfter - pBefore;

  // 컷오프를 넘나드는 시나리오는 차분 자체가 불안정하다 — 반드시 고백한다.
  const crossesCutoff = (pBefore - 0.5) * (pAfter - 0.5) < 0;

  return {
    scenario: scenarioLabel(scenario, course),
    balanceDelta: round2(balanceDelta),
    gradeShift: phrase(target, delta),
    borderlineFlag: borderlineBefore || borderlineAfter || crossesCutoff,
  };
}

/** 여러 시나리오를 한 번에. 화면에서 나란히 비교하기 위한 편의 함수 */
export function whatIfAll(course: Course, scenarios: Scenario[], opts: PredictOptions = {}): WhatIfDelta[] {
  return scenarios.map((s) => whatIf(course, s, opts));
}

/** 기본 제공 시나리오 — "오늘 이 수업 째도 되나"에 바로 답하는 세트 */
export function defaultScenarios(course: Course): Scenario[] {
  const out: Scenario[] = [];
  if (course.attendance) out.push({ kind: 'absence', absences: 1 });
  const pending = course.assessments.filter((a) => a.myScore === null && !a.ceilingClustered);
  const biggest = pending.slice().sort((a, b) => b.weight - a.weight)[0];
  if (biggest) {
    out.push({ kind: 'scoreDelta', assessmentId: biggest.id, points: 5 });
    out.push({ kind: 'scoreDelta', assessmentId: biggest.id, points: -5 });
  }
  return out;
}

/* ── 내부 ──────────────────────────────────────────────────────────────────*/

function buildPair(course: Course, scenario: Scenario): { base: Course; variant: Course } {
  switch (scenario.kind) {
    case 'absence': {
      const ledger = course.attendance;
      if (!ledger) return { base: course, variant: course };

      const extraAbs = scenario.absences ?? 1;
      const extraLate = scenario.lateness ?? 0;
      let variant: Course = {
        ...course,
        attendance: withExtraAttendance(ledger, extraAbs, extraLate),
      };

      // 출석 점수가 직접 입력돼 있으면 computeBalance가 장부 감점을 적용하지 않는다
      // (과거 결석이 이미 그 점수에 반영돼 있으므로 이중 차감이 되기 때문).
      // 하지만 "앞으로 한 번 더 빠지면"의 한계 손실은 여전히 발생하므로,
      // 그 경우에는 입력된 출석 점수 쪽에서 직접 깎아 준다. 안 그러면 차분이 0이 되어
      // "째도 되나"라는 질문에 "아무 일도 안 일어납니다"라고 답하게 된다.
      const scoredCeiling = course.assessments
        .filter((a) => a.ceilingClustered && a.myScore !== null && a.weight > 0 && a.maxScore > 0)
        .sort((a, b) => b.weight - a.weight)[0];

      if (scoredCeiling) {
        const extraEffective =
          extraAbs + (ledger.latePerAbsence > 0 ? extraLate / ledger.latePerAbsence : 0);
        const extraLossPoints = extraEffective * ledger.penaltyPerAbsence;
        const drop = (extraLossPoints * scoredCeiling.maxScore) / (scoredCeiling.weight * CONVERTED_MAX);
        variant = mapAssessment(variant, scoredCeiling.id, (a) => ({
          ...a,
          myScore: clampScore((a.myScore as number) - drop, a.maxScore),
        }));
      }

      return { base: course, variant };
    }
    case 'missSubmission': {
      return {
        base: course,
        variant: mapAssessment(course, scenario.assessmentId, (a) => ({ ...a, myScore: 0 })),
      };
    }
    case 'scoreDelta': {
      const target = course.assessments.find((a) => a.id === scenario.assessmentId);
      if (!target) return { base: course, variant: course };

      // 이미 본 시험이면 기준선을 만들 필요가 없다
      if (target.myScore !== null) {
        return {
          base: course,
          variant: mapAssessment(course, target.id, (a) => ({
            ...a,
            myScore: clampScore((a.myScore as number) + scenario.points, a.maxScore),
          })),
        };
      }

      const expected = expectedScore(course, target);
      if (expected === null) {
        // 통계가 없어 기준선을 못 만든다 → 등급 차분 없이 환산점수만 (predict가 격하 처리)
        return { base: course, variant: course };
      }
      return {
        base: mapAssessment(course, target.id, (a) => ({ ...a, myScore: clampScore(expected, a.maxScore) })),
        variant: mapAssessment(course, target.id, (a) => ({
          ...a,
          myScore: clampScore(expected + scenario.points, a.maxScore),
        })),
      };
    }
  }
}

/** 아직 안 본 시험에서 내가 받을 것으로 보이는 점수 = 평균 + E[Z|관측] · σ */
function expectedScore(course: Course, target: Assessment): number | null {
  if (target.mean === null || target.stdev === null || !(target.stdev > 0)) return null;
  const { components } = buildZComponents(course);
  const z = expectedZForUnobserved(components, RHO_LOW);
  return target.mean + z * target.stdev;
}

function mapAssessment(course: Course, id: string, fn: (a: Assessment) => Assessment): Course {
  return { ...course, assessments: course.assessments.map((a) => (a.id === id ? fn(a) : a)) };
}

function clampScore(x: number, maxScore: number): number {
  return Math.min(maxScore, Math.max(0, x));
}

function findName(course: Course, id: string): string {
  return course.assessments.find((a) => a.id === id)?.name ?? '해당 평가';
}

function hasBorderline(warnings: { code: string }[]): boolean {
  return warnings.some((w) => w.code === 'BORDERLINE');
}

/** 지금 실제로 걸려 있는 등급 = 누적확률이 50%에 가장 가까운 등급 */
function pivotGrade(dist: CumulativeGradeProb[]): GradeLetter {
  let best = dist[0];
  let bestGap = Infinity;
  for (const d of dist) {
    const gap = Math.abs(d.atLeastProb - 0.5);
    if (gap < bestGap) {
      bestGap = gap;
      best = d;
    }
  }
  return best.grade;
}

function probOf(dist: CumulativeGradeProb[], g: GradeLetter): number {
  return dist.find((d) => d.grade === g)?.atLeastProb ?? 0;
}

/**
 * 확률 변화의 언어화. 숫자를 쓰지 않는다 — 회의록 4-3 "점 추정 금지".
 * 3~4단계 언어로만 표현하고, 방향(늘어남/줄어듦)을 분명히 한다.
 */
function phrase(grade: GradeLetter, delta: number): string {
  const mag = Math.abs(delta);
  const dir = delta >= 0 ? '늘어납니다' : '줄어듭니다';
  if (mag < 0.03) return `${grade} 이상일 확률은 거의 그대로입니다.`;
  if (mag < 0.1) return `${grade} 이상일 확률이 조금 ${dir}.`;
  if (mag < 0.25) return `${grade} 이상일 확률이 눈에 띄게 ${dir}.`;
  return `${grade} 이상일 확률이 크게 ${dir}.`;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** 환산점수 척도를 화면에서 다시 쓰기 위한 재노출 */
export { CONVERTED_MAX };
