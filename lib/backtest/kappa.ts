import type { BacktestCase } from './types.ts';
import type { KappaEstimate, KappaPreset, KappaReport } from './types.ts';

/**
 * κ 역추정.
 *
 * 베타분포에서 분산 = m(1−m)/(κ+1) 이므로 κ = m(1−m)/s² − 1.
 * 즉 과거 시험의 (평균, 표준편차, 만점)만 있으면 κ를 직접 뽑을 수 있다.
 *
 * 이 함수가 존재하는 이유(회의록 4-6):
 *   엔진은 σ를 모를 때 κ 프리셋으로 대체하는데, 그 프리셋 값의 근거가 없으면
 *   "숫자로 위장한 추측"이다. 실제 시험 데이터에서 κ를 역산해 범위를 확보한다.
 */
export function estimateKappa(
  mean: number,
  stdev: number,
  maxScore: number,
): { kappa: number | null; m: number; s: number; invalidReason?: string; implausibleShape?: boolean } {
  const m = mean / maxScore;
  const s = stdev / maxScore;

  if (!(maxScore > 0)) return { kappa: null, m, s, invalidReason: '만점이 0 이하' };
  if (!(m > 0 && m < 1)) return { kappa: null, m, s, invalidReason: '평균이 0 또는 만점 (베타 정의역 밖)' };
  if (!(s > 0)) return { kappa: null, m, s, invalidReason: '표준편차 0 (전원 동점)' };

  const variance = s * s;
  const maxVariance = m * (1 - m);

  // 유계 분포의 물리적 상한. 회의록: "평균 85점 시험에서 σ가 25일 수 없다"
  // 이 제약이 가정이 아니라 모델에 내장되어 있다는 것이 베타 전환의 핵심 이득.
  if (variance >= maxVariance) {
    return {
      kappa: null,
      m,
      s,
      invalidReason: `분산 ${variance.toFixed(4)} ≥ 베타 상한 ${maxVariance.toFixed(4)} — 이 평균에서 나올 수 없는 표준편차 (입력 오류이거나 심한 이봉분포)`,
    };
  }

  const kappa = maxVariance / variance - 1;

  // 2층 판정.
  //   (1층) 위의 분산 상한 = 수학적으로 불가능 → 거부
  //   (2층) α=mκ<1 또는 β=(1−m)κ<1 → 베타가 U자형(양 끝에 질량이 쏠린 형태)이 된다.
  //         수학적으로는 합법이지만 시험 점수 분포로는 비현실적이다.
  //         회의록의 "평균 85점 시험에서 σ가 25일 수 없다"는 실제로 이 층에 걸린다
  //         (σ=25의 분산 상한은 35.7이라 1층은 통과하고, κ≈1.04로 U자형이 되어 2층에 걸림).
  //         거부하지 않고 표시만 해서 프리셋 집계에서만 빼는 이유는,
  //         진짜로 이봉분포인 시험(수강포기자 다수 등)이 존재하기 때문이다.
  const alpha = m * kappa;
  const beta = (1 - m) * kappa;
  const implausibleShape = alpha < 1 || beta < 1;

  return { kappa, m, s, implausibleShape };
}

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** 프리셋을 "근거 있음"이라고 주장하려면 최소 이만큼의 유효 표본이 필요하다 */
const GROUNDING_THRESHOLD = 12;

export function buildKappaReport(cases: BacktestCase[]): KappaReport {
  const estimates: KappaEstimate[] = [];

  for (const c of cases) {
    for (const a of c.course.assessments) {
      if (a.mean === null || a.stdev === null) continue;
      const { kappa, m, s, invalidReason, implausibleShape } = estimateKappa(a.mean, a.stdev, a.maxScore);
      estimates.push({
        assessmentName: a.name,
        courseName: c.course.name,
        m,
        s,
        kappa,
        invalidReason,
        implausibleShape,
        ceilingClustered: a.ceilingClustered,
      });
    }
  }

  // 천장 밀집 요소(출석·과제)는 제외한다. 다들 만점이라 κ가 수백으로 튀어
  // 시험 κ 프리셋을 오염시킨다. 애초에 엔진에서도 z경로 밖이다.
  const valid = estimates
    .filter((e) => e.kappa !== null && !e.ceilingClustered && !e.implausibleShape)
    .map((e) => e.kappa as number)
    .sort((a, b) => a - b);

  const quartiles =
    valid.length > 0
      ? { q1: quantile(valid, 0.25), median: quantile(valid, 0.5), q3: quantile(valid, 0.75) }
      : null;

  const grounded = valid.length >= GROUNDING_THRESHOLD;

  // κ가 클수록 점수가 평균 주위로 몰린다 = 변별이 안 된다.
  // 체감 난이도가 높은 시험일수록 점수가 흩어지는 경향을 반영해 어려움 쪽에 낮은 κ를 배치한다.
  const presets: KappaPreset[] = quartiles
    ? [
        { label: '쉬움', kappaLow: r(quartiles.q3), kappaHigh: r(quantile(valid, 0.9)), n: valid.length },
        { label: '보통', kappaLow: r(quartiles.median), kappaHigh: r(quartiles.q3), n: valid.length },
        { label: '어려움', kappaLow: r(quartiles.q1), kappaHigh: r(quartiles.median), n: valid.length },
        { label: '매우 어려움', kappaLow: r(quantile(valid, 0.1)), kappaHigh: r(quartiles.q1), n: valid.length },
      ]
    : [];

  return {
    estimates,
    quartiles,
    presets,
    grounded,
    caveat: buildCaveat(valid.length, grounded),
  };
}

function r(x: number): number {
  return Math.round(x * 10) / 10;
}

function buildCaveat(n: number, grounded: boolean): string {
  const lines: string[] = [];
  if (!grounded) {
    lines.push(
      `유효 표본 ${n}건 — 프리셋을 "근거 있음"이라고 주장할 수 없습니다. UI에서 "잠정값"으로 표시하고, 팀원 과거 성적을 더 모아야 합니다.`,
    );
  } else {
    lines.push(`유효 표본 ${n}건으로 사분위를 냈습니다.`);
  }
  // 이 한계를 숨기면 앱 전체의 정직성 원칙이 깨진다.
  lines.push(
    '개념적 한계: κ는 "집중도"이고 체감난이도는 주로 평균 m에 반영됩니다. 난이도→κ 매핑 자체가 하나의 가정이며, 데이터로 검증된 것은 κ의 분포 범위일 뿐 난이도와의 대응관계가 아닙니다.',
  );
  lines.push(
    '천장 밀집 요소(출석·과제)는 κ가 비정상적으로 커서, α<1 또는 β<1인 U자형 추정치는 시험 분포로 비현실적이어서 각각 집계에서 제외했습니다.',
  );
  return lines.join(' ');
}
