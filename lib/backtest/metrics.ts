import type { CumulativeGradeProb, GradeLetter, GradePrediction } from '@/lib/types';
import type { CalibrationBin, CaseOutcome } from './types.ts';

/** 좋은 등급부터. 인덱스 차이가 곧 "등급 단위 오차"가 된다 */
export const GRADE_ORDER: GradeLetter[] = ['A+', 'A0', 'B+', 'B0', 'C+', 'C0', 'D+', 'D0', 'F'];

export function gradeIndex(g: GradeLetter): number {
  return GRADE_ORDER.indexOf(g);
}

/**
 * 누적확률 → 등급별 확률.
 * 앱은 "A0 이상일 확률 70%" 형태로만 표시하지만(회의록 4-3), 적중/Brier 계산에는
 * 등급별 확률이 필요하므로 여기서만 차분한다. 이 값을 UI로 흘리지 말 것.
 */
export function toPointMass(dist: CumulativeGradeProb[]): Map<GradeLetter, number> {
  const sorted = [...dist].sort((a, b) => gradeIndex(a.grade) - gradeIndex(b.grade));
  const out = new Map<GradeLetter, number>();
  let prev = 0;
  for (const d of sorted) {
    out.set(d.grade, Math.max(0, d.atLeastProb - prev));
    prev = d.atLeastProb;
  }
  return out;
}

/**
 * 최빈 등급. 동률일 때는 항상 더 좋은 등급을 택한다(결정론적).
 * 누적확률을 차분하면 부동소수 오차로 0.35 vs 0.3500000000000001 같은 가짜 동률이
 * 생기는데, 그때 결과가 흔들리면 백테스트 수치 자체가 재현되지 않는다.
 */
const TIE_EPS = 1e-9;

export function modeGrade(dist: CumulativeGradeProb[]): GradeLetter | null {
  const pm = toPointMass(dist);
  let best: GradeLetter | null = null;
  let bestP = -1;
  for (const g of GRADE_ORDER) {
    const p = pm.get(g);
    if (p === undefined) continue;
    if (p > bestP + TIE_EPS) {
      bestP = p;
      best = g;
    }
  }
  return best;
}

/** 중앙 80% 구간 [상한등급, 하한등급]. 앱이 "구간"으로 출력하는 그 구간과 같은 정의 */
export function centralInterval(
  dist: CumulativeGradeProb[],
  mass = 0.8,
): [GradeLetter, GradeLetter] | null {
  const tail = (1 - mass) / 2;
  const sorted = [...dist].sort((a, b) => gradeIndex(a.grade) - gradeIndex(b.grade));
  if (sorted.length === 0) return null;
  const hi = sorted.find((d) => d.atLeastProb >= tail)?.grade ?? sorted[0].grade;
  const lo = sorted.find((d) => d.atLeastProb >= 1 - tail)?.grade ?? sorted[sorted.length - 1].grade;
  return [hi, lo];
}

/** 다중클래스 Brier score. 낮을수록 확률이 정직하다 */
export function brierForCase(dist: CumulativeGradeProb[], actual: GradeLetter): number {
  const pm = toPointMass(dist);
  let sum = 0;
  for (const g of GRADE_ORDER) {
    const p = pm.get(g) ?? 0;
    const o = g === actual ? 1 : 0;
    sum += (p - o) ** 2;
  }
  return sum;
}

/**
 * 캘리브레이션 — 앱이 실제로 화면에 쓰는 문장("X 이상일 확률 p")을 그대로 검증한다.
 * 각 케이스의 각 등급에 대해 (예측 p, 실제로 그 등급 이상이었는가)를 한 쌍으로 모아 구간별 집계.
 */
export function buildCalibration(
  pairs: { predicted: number; hit: boolean }[],
  binCount = 5,
): CalibrationBin[] {
  const bins: CalibrationBin[] = [];
  for (let i = 0; i < binCount; i++) {
    const low = i / binCount;
    const high = (i + 1) / binCount;
    const inBin = pairs.filter((p) =>
      i === binCount - 1 ? p.predicted >= low && p.predicted <= high : p.predicted >= low && p.predicted < high,
    );
    bins.push({
      low,
      high,
      count: inBin.length,
      meanPredicted: inBin.length ? inBin.reduce((s, p) => s + p.predicted, 0) / inBin.length : 0,
      observedFrequency: inBin.length ? inBin.filter((p) => p.hit).length / inBin.length : 0,
    });
  }
  return bins;
}

export function calibrationPairs(dist: CumulativeGradeProb[], actual: GradeLetter) {
  const ai = gradeIndex(actual);
  return dist.map((d) => ({
    predicted: d.atLeastProb,
    hit: ai <= gradeIndex(d.grade), // 실제가 d.grade "이상"이었는가
  }));
}

/** 엔진 출력 1건을 채점한다 */
export function scoreCase(
  caseId: string,
  prediction: GradePrediction,
  actual: GradeLetter,
): CaseOutcome {
  const borderline = prediction.warnings.some((w) => w.code === 'BORDERLINE');
  const base = { caseId, tier: prediction.tier, actual, borderline };

  // blur/격하된 케이스는 애초에 등급을 단정하지 않았으므로 "틀렸다"고 채점하지 않는다.
  // 이걸 오답으로 세면 정직하게 침묵한 엔진이 벌점을 받는다.
  if (!prediction.distribution || prediction.distribution.length === 0) {
    return {
      ...base,
      predicted: null,
      gradeError: null,
      withinInterval: null,
      atLeastProbForActual: null,
      skipped: true,
      skipReason: `Tier ${prediction.tier} — 등급을 단정하지 않은 케이스 (blur/격하)`,
    };
  }

  const dist = prediction.distribution;
  const predicted = modeGrade(dist);
  const interval = centralInterval(dist);
  const ai = gradeIndex(actual);

  return {
    ...base,
    predicted,
    gradeError: predicted ? ai - gradeIndex(predicted) : null,
    withinInterval: interval ? ai >= gradeIndex(interval[0]) && ai <= gradeIndex(interval[1]) : null,
    atLeastProbForActual: dist.find((d) => d.grade === actual)?.atLeastProb ?? null,
    skipped: false,
  };
}
