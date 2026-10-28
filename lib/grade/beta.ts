/**
 * lib/grade/beta.ts — 베타분포 점수 모델 (회의록 4-2(3))
 *
 * 왜 정규분포가 아닌가
 * ────────────────────
 * 점수는 0~100에 갇힌 유계 변수다. 정규분포는 지지집합이 (−∞, ∞)라
 * 평균 85·σ 12인 시험에서 "100점 초과"에 약 10%의 확률질량을 둔다.
 * 이 질량이 상위권 백분위를 체계적으로 왜곡하는 실제 주범이다.
 * 점수를 0~1로 정규화하면 Beta(α, β)로 모델링되고, 유계 지지집합이 이 오류를
 * 원천에서 제거한다. 표시 개선이 아니라 추정량 개선이다.
 *
 * 무엇이 이득인가
 * ───────────────
 *   평균 m, 집중도 κ = α + β  →  α = mκ, β = (1−m)κ
 *   분산 = m(1−m) / (κ + 1)
 * 즉 "σ를 모른다"가 "κ 하나를 모른다"로 치환된다. 치환의 실질 이득:
 *   · 정규 가정에서 σ는 자유 파라미터라 평균이 50이든 85든 같은 범위를 갖다 붙인다.
 *   · 베타에서는 같은 κ 범위라도 m에 따라 σ 범위가 자동으로 달라진다.
 *   · "평균이 극단에 가까우면 σ가 작을 수밖에 없다"가 가정이 아니라 모델에 내장된다.
 *
 * 한계 (과장 금지 — 회의록 4-6(2))
 * ────────────────────────────────
 * 천장효과는 "해결"이 아니라 "완화"다. 연속분포라 만점자 8명 같은 동점 밀집은
 * 여전히 표현하지 못한다. 그래서 천장 밀집 요소는 ceiling.ts에서 z경로 밖으로 뺀다.
 */

import { clamp, incompleteBeta, normalQuantile } from './math.ts';

export interface BetaParams {
  alpha: number;
  beta: number;
  /** 정규화 평균 m = mean / maxScore */
  m: number;
  kappa: number;
}

/** 체감난이도 라벨 — 사용자는 무차원 값 κ를 직접 못 고르므로 이 라벨로 고른다 */
export type DifficultyLabel = '쉬움' | '보통' | '어려움' | '매우 어려움';

/**
 * κ 프리셋 — ★잠정값(합성 샘플 기준)★
 *
 * 조율자의 백테스트 하네스(lib/backtest/kappa.ts `buildKappaReport`)가 합성 샘플에서
 * 역추정한 사분위 Q1=5.9 / 중앙값=8.9 / Q3=12.9 를 그대로 옮긴 것이다.
 * 실제 팀원 과거 성적이 들어오면 `buildKappaReport`가 이 값을 갱신하므로,
 * 지금 이 숫자를 "근거 있는 프리셋"이라고 말하면 안 된다. UI에도 "잠정"을 노출할 것.
 *
 * 개념적 한계도 같이 기록해 둔다: κ는 "집중도"이고 체감난이도는 주로 평균 m에 실린다.
 * 난이도 → κ 매핑 자체가 하나의 가정이며, 데이터로 확인된 것은 κ의 분포 범위뿐이지
 * 난이도와의 대응관계가 아니다. (κ가 클수록 평균 주위로 몰려 변별이 안 되므로
 *  어려운 시험일수록 낮은 κ를 배치했다 — 이 방향성도 가정이다.)
 */
export const KAPPA_PRESETS: Record<DifficultyLabel, { low: number; high: number }> = {
  '쉬움': { low: 12.9, high: 16.3 },
  '보통': { low: 8.9, high: 12.9 },
  '어려움': { low: 5.9, high: 8.9 },
  '매우 어려움': { low: 5.5, high: 5.9 },
};

/** 난이도 정보가 없을 때의 기본값 = 중앙값 부근 */
export const DEFAULT_KAPPA = 8.9;

export function kappaForDifficulty(label: DifficultyLabel | null | undefined): number {
  if (!label) return DEFAULT_KAPPA;
  const p = KAPPA_PRESETS[label];
  return (p.low + p.high) / 2;
}

/** 베타 분산 = m(1−m)/(κ+1). 이 한 줄이 베타 전환의 전부다 */
export function betaVariance(m: number, kappa: number): number {
  return (m * (1 - m)) / (kappa + 1);
}

/** 정규화 척도의 표준편차 */
export function betaStdev(m: number, kappa: number): number {
  return Math.sqrt(betaVariance(m, kappa));
}

/** 원점수 척도의 표준편차 (만점 환산) */
export function betaStdevInPoints(m: number, kappa: number, maxScore: number): number {
  return betaStdev(m, kappa) * maxScore;
}

export type ShapeVerdict =
  | { ok: true; kappa: number; implausibleShape: boolean; note?: string }
  | { ok: false; reason: string };

/**
 * (m, s)로부터 κ 역산: κ = m(1−m)/s² − 1.
 *
 * ★2층 판정 — 이 둘은 다른 층이다 (조율자 지적 반영)
 *   1층 분산 상한: s² ≥ m(1−m) 는 베타로 표현 불가능. 수학적 거부.
 *   2층 형태 타당성: α = mκ < 1 또는 β = (1−m)κ < 1 이면 U자형(양 끝 밀집)이 된다.
 *        수학적으로는 합법이지만 시험 점수 분포로는 비현실적이다.
 *
 *   회의록의 "평균 85점 시험에서 σ가 25일 수 없다"는 1층이 아니라 2층에 걸린다.
 *   m=0.85의 분산 상한은 0.1275 → σ 상한 약 35.7점이므로 σ=25는 1층을 통과한다.
 *   실제로 걸리는 지점은 α<1이 되는 κ≈1.04 부근이다.
 *   (1층/2층 구분은 lib/backtest/kappa.ts 의 estimateKappa 와 동일한 규약이다.)
 *
 *   2층은 거부가 아니라 표시만 한다. 수강포기자 다수처럼 진짜 이봉분포인 시험이
 *   존재하기 때문이다. 엔진은 이때 정규 근사로 폴백한다.
 */
export function kappaFromMoments(m: number, s: number): ShapeVerdict {
  if (!(m > 0 && m < 1)) return { ok: false, reason: '평균이 0 또는 만점 — 베타 정의역 밖' };
  if (!(s > 0)) return { ok: false, reason: '표준편차 0 — 전원 동점' };

  const variance = s * s;
  const maxVariance = m * (1 - m);
  if (variance >= maxVariance) {
    return {
      ok: false,
      reason: `분산 ${variance.toFixed(4)} ≥ 베타 상한 ${maxVariance.toFixed(4)} — 이 평균에서 나올 수 없는 표준편차`,
    };
  }

  const kappa = maxVariance / variance - 1;
  const implausibleShape = m * kappa < 1 || (1 - m) * kappa < 1;
  return {
    ok: true,
    kappa,
    implausibleShape,
    note: implausibleShape ? 'α<1 또는 β<1 — U자형이라 시험 분포로는 비현실적' : undefined,
  };
}

export function betaParams(m: number, kappa: number): BetaParams {
  return { alpha: m * kappa, beta: (1 - m) * kappa, m, kappa };
}

/** Beta(α,β) CDF. x는 정규화 점수 0~1 */
export function betaCdf(x: number, p: BetaParams): number {
  return incompleteBeta(clamp(x, 0, 1), p.alpha, p.beta);
}

/**
 * 내 점수의 백분위 → z 변환.
 *
 * 여기가 베타 전환이 실제로 값을 바꾸는 지점이다. 순진한 z = (내점수−평균)/σ 대신
 *   p = BetaCDF(내점수/만점)  →  z = Φ⁻¹(p)
 * 를 쓴다. 분포가 치우쳐 있을 때 같은 원점수라도 백분위가 달라지고,
 * 무엇보다 100점 초과에 질량이 없으므로 상위권 z가 과대평가되지 않는다.
 *
 * 만점자는 p=1 → z=∞ 가 되므로, 만점은 "만점자 집단의 중앙"으로 본다
 * (연속성 보정). 이것이 연속분포로 동점 밀집을 다루는 최선이며, 여전히 근사다.
 */
export function scoreToZ(myScore: number, maxScore: number, p: BetaParams): number {
  const x = clamp(myScore / maxScore, 0, 1);
  let cdf: number;
  if (x >= 1) {
    // 만점: [P(X<1), 1] 구간의 중앙. 연속분포의 한계에 대한 보정이지 해결이 아니다.
    const below = betaCdf(1 - 1 / (2 * maxScore), p);
    cdf = (below + 1) / 2;
  } else if (x <= 0) {
    cdf = betaCdf(1 / (2 * maxScore), p) / 2;
  } else {
    cdf = betaCdf(x, p);
  }
  return normalQuantile(clamp(cdf, 1e-6, 1 - 1e-6));
}

/** 베타가 불가능/비현실적일 때의 폴백 — 고전 정규 z */
export function naiveZ(myScore: number, mean: number, stdev: number): number {
  if (!(stdev > 0)) return 0;
  return (myScore - mean) / stdev;
}
