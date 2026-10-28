/**
 * lib/grade/discrimination.ts — 변별 기여도 (회의록 4-4, 킬러 기능)
 *
 * 분산 분해:  기여도ᵢ = (wᵢ²σᵢ² + 공분산항 배분) / σ_S²
 *   vᵢ = wᵢσᵢ 로 두면
 *   σ_S² = Σvᵢ² + 2Σᵢ<ⱼ vᵢvⱼρ,   기여도ᵢ = (vᵢ² + ρ·vᵢ·Σⱼ≠ᵢ vⱼ) / σ_S²
 *   (합이 정확히 1이 되도록 공분산항을 두 요소에 절반씩 배분한 형태)
 *
 * 드러나는 사실: 반영비율과 실제 등급 영향력은 전혀 다르다.
 * 출석이 20%여도 다들 만점이면 등급에 미치는 실질 영향은 0에 수렴하고,
 * 기말은 30%여도 변별 기여도가 그 두 배를 넘을 수 있다.
 * "출석만 잘 하면 되겠지"라는 흔한 오해를 정면으로 깨는 지점이고,
 * 시험 전에 유효해서 조회 시점과 행동 가능 시점이 일치한다.
 *
 * ★★구조적 모순과 그 대응★★
 * 이 계산에는 요소별 σᵢ가 필요한데, σ를 모르는 것이 이 앱의 최대 난점이다.
 * 그래서 **절대 숫자를 반환하지 않는다.** ImpactBand 3구간만 낸다.
 * "62%"를 내보내는 순간, 앱 전체가 공들여 막아온 false precision이
 * 킬러 기능이라는 뒷문으로 재진입하고 "확신을 못 주는 게 옳다"는 일관성도 깨진다.
 *
 * 부분 구제: 출석·과제가 "다들 만점"이라는 사실 자체가 σ≈0 이라는 정보다.
 * 정확한 숫자는 못 내도 "사실상 기말이 결정한다"는 방향성은 낼 수 있다.
 */

import type { Assessment, Course, DiscriminationContribution, ImpactBand } from '@/lib/types';
import { RHO_HIGH, RHO_LOW } from './composite.ts';
import { sum } from './math.ts';

/**
 * 밴드 경계. 숫자는 여기서만 존재하고 **밖으로 절대 나가지 않는다.**
 * 이 값들도 근거가 없는 가정이라, τ 하한과 같은 이유로 민감도 측정용 구멍만 열어 둔다
 * (평상시에는 지정하지 않는다).
 */
export const DEFAULT_IMPACT_BANDS = { negligible: 0.1, decisive: 0.4 } as const;

export interface ImpactBandThresholds {
  negligible: number;
  decisive: number;
}

export interface ContributionOptions {
  bands?: Partial<ImpactBandThresholds>;
}

/** 경계가 뒤집힌 입력(negligible ≥ decisive)은 밴드 구조가 무너지므로 정렬해서 쓴다 */
function resolveBands(o?: ContributionOptions): ImpactBandThresholds {
  const negligible = o?.bands?.negligible ?? DEFAULT_IMPACT_BANDS.negligible;
  const decisive = o?.bands?.decisive ?? DEFAULT_IMPACT_BANDS.decisive;
  return {
    negligible: Math.min(negligible, decisive),
    decisive: Math.max(negligible, decisive),
  };
}

function bandOf(share: number, t: ImpactBandThresholds): ImpactBand {
  if (share < t.negligible) return 'negligible';
  if (share < t.decisive) return 'supporting';
  return 'decisive';
}

const BAND_RANK: Record<ImpactBand, number> = { negligible: 0, supporting: 1, decisive: 2 };

function hasSigma(a: Assessment): boolean {
  return a.stdev !== null && a.stdev > 0 && a.maxScore > 0;
}

/** σᵢ 정규화값. 알면 쓰고, 천장 밀집인데 모르면 "다들 만점" = σ≈0 이라는 정보를 쓴다 */
function sigmaOf(a: Assessment): number | null {
  if (hasSigma(a)) return (a.stdev as number) / a.maxScore;
  if (a.ceilingClustered) return 0;
  return null;
}

export function contributions(
  course: Course,
  opts: ContributionOptions = {},
): DiscriminationContribution[] {
  const thresholds = resolveBands(opts);
  const list = course.assessments;
  const sigmas = list.map(sigmaOf);
  const knownVariable = list.filter((a, i) => !a.ceilingClustered && sigmas[i] !== null);

  // σ를 하나도 모르는 경우: 숫자를 만들어 내지 않고 방향성만 낸다 (부분 구제)
  if (knownVariable.length === 0) {
    const variable = list.filter((a) => !a.ceilingClustered);
    return list.map((a) => {
      if (a.ceilingClustered) {
        return row(a, 'negligible', '다들 만점에 가까워 점수 차이가 거의 나지 않습니다 — 등급엔 사실상 영향이 없습니다.');
      }
      if (variable.length === 1) {
        return row(a, 'decisive', '변별이 일어나는 평가요소가 이것뿐입니다. 사실상 이 하나가 등급을 정합니다.');
      }
      return row(
        a,
        'supporting',
        '표준편차가 없어 시험들 사이의 순위는 가릴 수 없습니다. 다만 출석·과제는 사실상 영향이 없으므로 등급은 시험에서 갈립니다.',
      );
    });
  }

  // σ를 아는 변별 요소가 있으면, 모르는 변별 요소는 아는 것들의 평균으로 채운다.
  // (값을 창조하는 게 아니라 "다른 시험과 비슷하다"는 최소 가정이며, 밴드로만 나가므로
  //  이 가정이 소수점 숫자로 사용자에게 전달되지는 않는다.)
  const fill =
    sum(knownVariable.map((a) => (a.stdev as number) / a.maxScore)) / knownVariable.length;

  const v = list.map((a, i) => a.weight * (sigmas[i] ?? fill));
  const total = sum(v);

  // ρ=0.3 / ρ=0.8 양쪽에서 계산해 더 보수적인(낮은) 밴드를 채택한다.
  const shares = [RHO_LOW, RHO_HIGH].map((rho) => {
    const varS = sum(v.map((x) => x * x)) + rho * (total * total - sum(v.map((x) => x * x)));
    return v.map((vi) => (varS > 0 ? (vi * vi + rho * vi * (total - vi)) / varS : 0));
  });

  return list.map((a, i) => {
    const b0 = bandOf(shares[0][i], thresholds);
    const b1 = bandOf(shares[1][i], thresholds);
    const band = BAND_RANK[b0] <= BAND_RANK[b1] ? b0 : b1;
    return row(a, band, noteFor(a, band, sigmas[i] === null));
  });
}

function row(a: Assessment, band: ImpactBand, note: string): DiscriminationContribution {
  return {
    assessmentId: a.id,
    assessmentName: a.name,
    declaredWeight: a.weight,
    band,
    note,
  };
}

function noteFor(a: Assessment, band: ImpactBand, sigmaAssumed: boolean): string {
  const pct = Math.round(a.weight * 100);
  const assumed = sigmaAssumed ? ' (이 요소의 표준편차는 다른 시험과 비슷하다고 보고 계산했습니다.)' : '';

  if (a.ceilingClustered && band === 'negligible') {
    return `반영비율 ${pct}%지만 다들 만점이라 등급엔 사실상 영향이 없습니다. 단, 감점은 환산점수에서 그대로 빠집니다.`;
  }
  switch (band) {
    case 'negligible':
      return `반영비율 ${pct}%지만 점수 차이가 거의 안 나서 등급을 가르지 못합니다.${assumed}`;
    case 'supporting':
      return `반영비율 ${pct}%. 등급에 영향은 주지만 혼자서 뒤집지는 못합니다.${assumed}`;
    case 'decisive':
      return `반영비율 ${pct}%인데 점수가 크게 흩어져서, 사실상 여기서 등급이 갈립니다.${assumed}`;
  }
}
