/**
 * lib/grade/composite.ts — 합성 정규화 (회의록 4-2(1))
 *
 *   z_std = Σwᵢzᵢ / √(Σwᵢ² + 2Σᵢ<ⱼ wᵢwⱼρᵢⱼ)
 *
 * 왜 나눠야 하나
 * ──────────────
 * Σwᵢzᵢ 의 분산은 1이 아니다. 4요소 균등가중(w=0.25)·독립이면 Σwᵢ² = 0.25,
 * 즉 표준편차가 0.5다. 이 값을 그대로 표준정규로 읽으면
 *   · 모두가 평균 근처로 몰려 보이고
 *   · 상위권은 실제보다 낮게, 하위권은 실제보다 높게 예측된다.
 * 분모를 빠뜨리는 것은 반올림 오차가 아니라 체계적 편향이다.
 *
 * ρ를 숨기지 않는다
 * ─────────────────
 * 평가요소 간 상관 ρ는 대략 0.5~0.7이다(중간 잘 본 사람이 기말도 잘 본다).
 * ρ=0으로 놓으면 σ_S를 과소추정해 앱이 근거 없이 낙관적인 답을 준다.
 * 그렇다고 특정 ρ를 골라 쓰면 그 자체가 false precision이므로,
 * ρ=0.3 / ρ=0.8 두 경우를 모두 계산해 **구간**으로 내보낸다.
 * 몬테카를로는 쓰지 않는다 (회의록 4-5 스코프 절단선) — 해석해로 충분하다.
 *
 * 등상관 구조를 쓰는 이유
 * ───────────────────────
 * 요소별 ρᵢⱼ를 따로 알 방법이 없으므로 모든 쌍에 같은 ρ를 가정한다(equicorrelation).
 * 이 구조는 1-요인 모형 Zᵢ = √ρ·F + √(1−ρ)·Eᵢ 와 동치이고,
 * 덕분에 **아직 안 본 시험**의 조건부 분포를 닫힌 형태로 낼 수 있다.
 * 즉 "중간 잘 봤으니 기말도 그 정도 하겠지"를 가정이 아니라 모형에서 유도한다.
 */

import { sum } from './math.ts';

/** 회의록이 지정한 두 시나리오. 이 둘 사이가 곧 ρ에 대한 무지의 폭이다 */
export const RHO_LOW = 0.3;
export const RHO_HIGH = 0.8;

export interface ZComponent {
  assessmentId: string;
  /**
   * 유효 가중치. 호출자가 wᵢ·σᵢ 를 합=1로 정규화해 넣는다(index.ts 참조).
   * σᵢ가 모두 같으면 명목 반영비율과 일치하며, 그때 이 함수는 회의록 수식 그대로가 된다.
   */
  weight: number;
  /** 관측된 표준화 점수. 아직 안 본 평가요소면 null */
  z: number | null;
}

export interface CompositeResult {
  rho: number;
  /** 표준화 합성점수의 기대값 */
  zStd: number;
  /** 미응시 요소 때문에 남는 불확실성 (표준화 척도의 표준편차) */
  tau: number;
  /** 분모 D = √(Σwᵢ² + 2Σᵢ<ⱼwᵢwⱼρ) */
  denominator: number;
  /** 아직 배점이 남은 유효가중치 합 — 역전 가능성의 크기 */
  unobservedWeight: number;
}

/** D = √(Σwᵢ² + 2Σᵢ<ⱼwᵢwⱼρ) = √(Σwᵢ² + ρ((Σwᵢ)² − Σwᵢ²)) */
export function compositeDenominator(weights: number[], rho: number): number {
  const s1 = sum(weights);
  const s2 = sum(weights.map((w) => w * w));
  const v = s2 + rho * (s1 * s1 - s2);
  return Math.sqrt(Math.max(v, 1e-12));
}

/**
 * ★비교용★ 분모를 빠뜨린 순진한 버전. Σwᵢzᵢ 를 그대로 표준정규로 읽는다.
 * 테스트에서 "정규화 있는 버전과 값이 다르다"를 보이는 데 쓰고, 엔진은 절대 쓰지 않는다.
 */
export function naiveCompositeZ(components: ZComponent[]): number {
  return sum(components.filter((c) => c.z !== null).map((c) => c.weight * (c.z as number)));
}

/**
 * 합성 정규화 본체.
 *
 * 관측된 요소(A)와 미관측 요소(B)를 함께 다룬다. 1-요인 등상관 모형에서
 *   F | z_A ~ N( √ρ·Σz / (1−ρ + n_A·ρ),  (1−ρ)/(1−ρ + n_A·ρ) )
 *   E[Zⱼ | z_A] = √ρ·μ_F,  Var(Σ_B wⱼZⱼ | z_A) = (1−ρ)Σwⱼ² + ρ·v_F·(Σwⱼ)²
 * 이므로 기대값과 불확실성을 모두 닫힌 형태로 얻는다.
 */
export function compositeZ(components: ZComponent[], rho: number): CompositeResult {
  const weights = components.map((c) => c.weight);
  const denominator = compositeDenominator(weights, rho);

  const observed = components.filter((c) => c.z !== null);
  const unobserved = components.filter((c) => c.z === null);

  const nA = observed.length;
  const sumZ = sum(observed.map((c) => c.z as number));
  const observedPart = sum(observed.map((c) => c.weight * (c.z as number)));

  const wB = sum(unobserved.map((c) => c.weight));
  const wB2 = sum(unobserved.map((c) => c.weight * c.weight));

  // F의 사후분포. 관측이 없으면 사전분포 N(0,1) 그대로.
  const prec = 1 - rho + nA * rho;
  const muF = prec > 0 ? (Math.sqrt(rho) * sumZ) / prec : 0;
  const vF = prec > 0 ? (1 - rho) / prec : 1;

  const expectedNumerator = observedPart + wB * Math.sqrt(rho) * muF;
  const varNumerator = (1 - rho) * wB2 + rho * vF * wB * wB;

  return {
    rho,
    zStd: expectedNumerator / denominator,
    tau: Math.sqrt(Math.max(varNumerator, 0)) / denominator,
    denominator,
    unobservedWeight: wB,
  };
}

/** ρ=0.3 / ρ=0.8 두 경우. 회의록이 요구한 "구간으로 출력"의 원천 */
export function compositeZBoth(components: ZComponent[]): [CompositeResult, CompositeResult] {
  return [compositeZ(components, RHO_LOW), compositeZ(components, RHO_HIGH)];
}

/** 두 ρ 결과에서 zRange. 어느 쪽이 큰지는 z의 부호에 따라 뒤집히므로 min/max로 낸다 */
export function zRangeOf(results: CompositeResult[]): { low: number; high: number } {
  const zs = results.map((r) => r.zStd);
  return { low: Math.min(...zs), high: Math.max(...zs) };
}

/**
 * 관측된 요소로부터 추정한 "아직 안 본 평가요소의 기대 z".
 *   E[Zⱼ | z_A] = √ρ · μ_F
 * what-if에서 "기말 +5점"의 기준선을 잡는 데 쓴다. 기준선 없이 미응시 → 특정 점수로
 * 바꿔 버리면 "+5점의 효과"와 "불확실성이 사라진 효과"가 섞여 차분이 과장된다.
 */
export function expectedZForUnobserved(components: ZComponent[], rho: number): number {
  const observed = components.filter((c) => c.z !== null);
  const nA = observed.length;
  if (nA === 0) return 0;
  const sumZ = sum(observed.map((c) => c.z as number));
  const prec = 1 - rho + nA * rho;
  const muF = prec > 0 ? (Math.sqrt(rho) * sumZ) / prec : 0;
  return Math.sqrt(rho) * muF;
}

/**
 * 환산점수 1점이 표준화 척도로 몇 칸인가.
 *   Δz_std = Δ환산점수 / (100 · T · D),  T = Σwⱼσ̃ⱼ (정규화 전 유효가중치 합)
 *
 * 유도: 요소 i에서 Δs점을 더 받으면 환산점수는 wᵢ·Δs·100/maxᵢ 만큼,
 * zᵢ는 Δs/stdevᵢ 만큼 움직인다. wᵢ_eff = wᵢσ̃ᵢ/T, σ̃ᵢ = stdevᵢ/maxᵢ 이므로
 * Δz_std = wᵢ_eff·(Δs/stdevᵢ)/D = Δ환산점수/(100·T·D) — 요소와 무관하게 계수가 같다.
 *
 * 이 계수 덕분에 ①천장 밀집 요소의 감점을 z경로를 거치지 않고 결정론적 이동으로 넣을 수 있고
 * ②"+1점의 값어치"를 과목 간에 비교할 수 있다 (allocation.ts).
 */
export function deltaZPerPoint(effectiveWeightTotal: number, denominator: number): number {
  const d = 100 * effectiveWeightTotal * denominator;
  return d > 0 ? 1 / d : 0;
}
