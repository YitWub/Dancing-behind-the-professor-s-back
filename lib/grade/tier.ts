/**
 * lib/grade/tier.ts — 정밀도 사다리 (회의록 4-2 / 4-3)
 *
 * "표준편차를 모를 때 어떻게 할 것인가"에 대한 답. 없는 정보를 가정으로 메우는 대신,
 * 가진 정보의 양에 따라 **출력의 종류 자체**를 바꾼다.
 *
 *   Tier 0  아무 정보 없음   → 절대점수 계산기로 격하. 등급은 언급하지 않는다.
 *   Tier 1  평균만 있음      → blur. distribution = null + LOW_TIER.
 *   Tier 2  평균 + 친구 점수 → ★구현하지 않음★ (아래 참조)
 *   Tier 3  평균 + 표준편차  → 정석 경로. 구간 + 확률분포.
 *   Tier 4  등수 공개        → 계산 불필요. 백분위 직행.
 *
 * ★Tier 1에서 σ를 12~18로 가정해 구간을 내면 안 되는 이유
 *   그 구간의 폭은 데이터가 아니라 우리 가정에서 나온 것이다. 사용자는 그것을
 *   "데이터 기반 불확실성"으로 읽지만 실제로는 "모른다"를 숫자로 위장한 것이다.
 *   정직해 보이는 형식으로 포장된 false precision이 제일 나쁘다.
 *   blur가 더 정직하고, 추가 입력 동기도 된다.
 *
 * ★Tier 2(친구 점수)를 구현하지 않은 이유 — 회의록 4-5 [잘라낼 것]
 *   백테스트로 실제 축소폭을 확인한 뒤 채택 여부를 정하기로 보류됐다.
 *   self-selection 편향(점수 낮으면 안 알려줌 → 상방 편향)이 미처리 상태이고,
 *   n=3~5의 표본 불확실성 때문에 "±1.2등급 → ±0.5등급" 약속만큼 안 좁아질 수 있다.
 *   약속한 만큼 안 좁아지면 아예 안 좁아진 것보다 신뢰 손상이 크다.
 */

import type { Assessment, Course, EngineWarning, PrecisionTier } from '@/lib/types';
import type { ZComponent } from './composite.ts';
import { betaParams, kappaFromMoments, naiveZ, scoreToZ } from './beta.ts';
import { partitionAssessments } from './ceiling.ts';
import { normalQuantile } from './math.ts';

/**
 * 등수 정보. 두 경로로 들어온다.
 *   ① Course.myRank + Course.enrolled — 사용자가 앱에 입력한 값 (기본 경로)
 *   ② PredictOptions.rank — 외부 주입. 백테스트가 BacktestCase.actualRank를 넣을 때 쓴다
 * 둘 다 있으면 명시적 주입(②)이 이긴다.
 */
export interface RankInfo {
  /** 1 = 1등 */
  rank: number;
  classSize: number;
}

/**
 * 등수 해석. Tier 4로 갈 수 있는지를 여기서만 판단한다.
 * 등수만 있고 수강인원이 없으면 백분위를 못 내므로 Tier 4가 성립하지 않는다
 * — 그때는 조용히 일반 경로로 내려간다(등급을 지어내지 않는다).
 */
export function resolveRank(course: Course, explicit?: RankInfo | null): RankInfo | null {
  const candidates: (RankInfo | null)[] = [
    explicit ?? null,
    course.myRank !== null && course.myRank !== undefined && course.enrolled !== null
      ? { rank: course.myRank, classSize: course.enrolled }
      : null,
  ];
  for (const c of candidates) {
    if (c && c.classSize > 0 && c.rank >= 1 && c.rank <= c.classSize) return c;
  }
  return null;
}

export interface TierContext {
  tier: PrecisionTier;
  warnings: EngineWarning[];
}

/** 요소별 표준편차를 모두 아는가 = z 경로를 탈 수 있는가 */
function hasFullStats(a: Assessment): boolean {
  return a.mean !== null && a.stdev !== null && a.stdev > 0 && a.maxScore > 0;
}

/**
 * 정밀도 사다리 판정.
 * 채점이 끝난 변별 요소(천장 밀집 제외)만 본다. 아직 안 본 시험은 통계가 없는 게 당연하므로
 * 티어를 끌어내리지 않는다 — 그 불확실성은 composite.ts가 tau로 따로 다룬다.
 */
export function resolveTier(course: Course, rank?: RankInfo | null): TierContext {
  const warnings: EngineWarning[] = [];

  if (resolveRank(course, rank)) {
    return { tier: 4, warnings };
  }

  const { variable } = partitionAssessments(course.assessments);
  const scored = variable.filter((a) => a.myScore !== null);

  const withMean = scored.filter((a) => a.mean !== null && a.maxScore > 0);
  if (scored.length === 0 || withMean.length === 0) {
    warnings.push({
      code: 'LOW_TIER',
      message:
        '반 평균이 없어 등급을 말할 수 없습니다. 지금은 절대점수 계산기로만 동작합니다. 평균을 넣으면 내 위치가, 표준편차까지 넣으면 등급이 보입니다.',
    });
    return { tier: 0, warnings };
  }

  const missingStdev = withMean.filter((a) => !hasFullStats(a));
  if (missingStdev.length > 0) {
    warnings.push({
      code: 'LOW_TIER',
      message: `${missingStdev.map((a) => a.name).join('·')}의 표준편차가 없어 등급 칸을 흐리게 처리했습니다. 표준편차를 넣으면 등급이 보입니다. (표준편차를 임의로 가정해 구간을 내면, 그 폭은 데이터가 아니라 가정에서 나온 숫자입니다.)`,
    });
    return { tier: 1, warnings };
  }

  return { tier: 3, warnings };
}

/**
 * 티어별 추정오차 하한 (표준화 척도).
 *
 * 미응시 요소로 인한 불확실성(composite.tau)과 별개로, 모형 자체의 오차가 있다:
 * ρ 미지, 정원 비율 가정, κ/σ 추정오차, 등상관 가정. 이걸 0으로 두면
 * 모든 시험이 끝난 과목에서 확률이 0%/100%로 붙어 버린다 — 그건 정직하지 않다.
 * ※ 이 값 자체가 가정이므로 README에 근거 없음을 명시한다.
 *   합성 샘플에 맞춰 튜닝하는 것은 "숫자로 위장한 추측"이므로 하지 않는다(조율자 결정).
 *   대신 tauFloor 오버라이드를 열어 두어, 백테스트가 이 값을 훑으면서
 *   "근거는 없지만 결과가 얼마나 흔들리는가"를 측정할 수 있게 한다.
 */
export const TAU_FLOOR: Record<PrecisionTier, number> = {
  0: Infinity,
  1: Infinity,
  2: Infinity,
  3: 0.15,
  4: 0.05,
};

/** 민감도 스윕용 오버라이드. 미지정 항목은 TAU_FLOOR 기본값을 쓴다 */
export interface TauFloorOverride {
  t3?: number;
  t4?: number;
}

export function resolveTauFloor(tier: PrecisionTier, override?: TauFloorOverride): number {
  if (tier === 3 && override?.t3 !== undefined) return override.t3;
  if (tier === 4 && override?.t4 !== undefined) return override.t4;
  return TAU_FLOOR[tier];
}

export interface ZBuild {
  components: ZComponent[];
  /** 요소별 정규화 표준편차 σ̃ᵢ. 변별 기여도(discrimination.ts)가 그대로 재사용한다 */
  sigmas: Map<string, number>;
  /** 베타가 비현실적(U자형)이라 정규 근사로 폴백한 요소 */
  betaFallbacks: string[];
  /**
   * 정규화 전 유효가중치 합 T = Σ wⱼσ̃ⱼ.
   * "환산점수 1점 = z 몇 칸"을 환산할 때 필요하다 (allocation.ts).
   * Δz_std = Δ환산점수 / (100 · T · D) — 어느 요소에서 얻은 1점이든 계수가 같다.
   */
  effectiveWeightTotal: number;
}

/**
 * z 경로 구성. 천장 밀집 요소는 이미 partitionAssessments에서 빠져 있다.
 *
 * 유효 가중치 wᵢ_eff ∝ wᵢ·σ̃ᵢ 를 쓴다.
 * 회의록 수식은 Σwᵢzᵢ 로 명목 반영비율을 쓰지만, 그것은 요소별 σ가 같다는 가정 위에서만
 * 원점수 합성과 일치한다. σ가 다르면 σ가 큰 요소가 실제로 등급을 더 많이 흔든다.
 * σᵢ가 모두 같으면 wᵢ_eff = wᵢ 가 되어 회의록 수식 그대로로 환원된다.
 */
export function buildZComponents(course: Course): ZBuild {
  const { variable } = partitionAssessments(course.assessments);
  const betaFallbacks: string[] = [];

  const raw = variable.map((a) => {
    const sigma = hasFullStats(a) ? (a.stdev as number) / a.maxScore : null;

    let z: number | null = null;
    if (a.myScore !== null && hasFullStats(a)) {
      const m = (a.mean as number) / a.maxScore;
      const s = (a.stdev as number) / a.maxScore;
      const verdict = kappaFromMoments(m, s);
      if (verdict.ok && !verdict.implausibleShape) {
        z = scoreToZ(a.myScore, a.maxScore, betaParams(m, verdict.kappa));
      } else {
        // 베타로 표현 불가능하거나 U자형 — 정규 근사로 폴백하고 사실을 기록한다
        betaFallbacks.push(a.name);
        z = naiveZ(a.myScore, a.mean as number, a.stdev as number);
      }
    }
    return { assessment: a, sigma, z };
  });

  // σ를 모르는 요소는 아는 요소들의 평균 σ로 채운다. 하나도 모르면 전부 동일 취급.
  // (여기서 특정 σ 값을 창조하지 않는 것이 핵심 — 아는 것의 평균이거나, 아니면 균등)
  const known = raw.map((r) => r.sigma).filter((s): s is number => s !== null);
  const fill = known.length > 0 ? known.reduce((x, y) => x + y, 0) / known.length : 1;

  const sigmas = new Map<string, number>();
  const weighted = raw.map((r) => {
    const sigma = r.sigma ?? fill;
    sigmas.set(r.assessment.id, sigma);
    return { id: r.assessment.id, w: r.assessment.weight * sigma, z: r.z };
  });

  const total = weighted.reduce((s, w) => s + w.w, 0);
  const components: ZComponent[] = weighted.map((w) => ({
    assessmentId: w.id,
    weight: total > 0 ? w.w / total : 0,
    z: w.z,
  }));

  return { components, sigmas, betaFallbacks, effectiveWeightTotal: total };
}

/** Tier 4 — 등수에서 바로 z. 계산이 필요 없는 경로 */
export function zFromRank(rank: RankInfo): number {
  // 연속성 보정: r등은 상위 (r−0.5)/n 지점으로 본다
  const p = 1 - (rank.rank - 0.5) / rank.classSize;
  return normalQuantile(Math.min(Math.max(p, 1e-6), 1 - 1e-6));
}
