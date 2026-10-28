import type { Course, GradeLetter, GradePrediction, PrecisionTier } from '@/lib/types';

/**
 * 백테스트 1건 = 과거에 실제로 일어난 한 과목의 수강 기록.
 * 예측 시점에 알 수 있었던 정보(course)와, 발표 이후에나 알 수 있는 정답(actualGrade)을 분리한다.
 * 이 분리가 지켜지지 않으면(예: actual을 보고 κ를 맞추면) 백테스트가 아니라 과적합이다.
 */
export interface BacktestCase {
  id: string;
  /** 예측 시점에 가용했던 입력. actualGrade를 여기에 섞지 말 것 */
  course: Course;
  /** 정답 — 실제로 받은 등급 */
  actualGrade: GradeLetter;
  /** 실제 등수가 공개된 경우에만. κ 역추정 검증용 */
  actualRank?: number;
  source: 'team-member' | 'sample';
  note?: string;
}

/** 엔진 어댑터 — 팀원1의 lib/grade 구현을 주입받는다. 백테스트는 엔진 내부를 몰라야 한다 */
export interface EngineAdapter {
  predict(course: Course): GradePrediction;
}

export interface CaseOutcome {
  caseId: string;
  tier: PrecisionTier;
  actual: GradeLetter;
  /** 누적분포에서 뽑은 최빈 등급. tier<=1(blur)이면 null — 애초에 등급을 단정하지 않으므로 */
  predicted: GradeLetter | null;
  /** 등급 단위 오차. A+=0, A0=1 ... 부호 있음(+면 실제가 예측보다 낮음) */
  gradeError: number | null;
  /** 실제 등급이 예측 구간 안에 들어왔는가 */
  withinInterval: boolean | null;
  /** 엔진이 경계선(동전던지기)이라고 자백한 케이스인가 */
  borderline: boolean;
  /** 예측한 "actual 등급 이상일 확률" — 캘리브레이션 입력 */
  atLeastProbForActual: number | null;
  skipped: boolean;
  skipReason?: string;
}

/** 캘리브레이션 1개 구간 (reliability diagram의 점 하나) */
export interface CalibrationBin {
  /** 구간 하한/상한 (예측 확률) */
  low: number;
  high: number;
  count: number;
  meanPredicted: number;
  /** 실제로 그 등급 이상이었던 비율 */
  observedFrequency: number;
}

export interface BacktestReport {
  totalCases: number;
  evaluated: number;
  skipped: number;
  /** 정확히 맞춘 비율 (blur 케이스 제외) */
  hitRate: number;
  /** ±1등급 이내 비율 */
  nearHitRate: number;
  /** 평균 절대 오차 (등급 단위) */
  meanAbsGradeError: number;
  /** 구간 적중률 — 예측 구간이 실제를 포함한 비율 */
  intervalCoverage: number;
  /**
   * 회의록이 발표에 넣으라고 한 핵심 문장의 근거:
   * "틀린 건 전부 경계 구간" 이 사실인지 검증한다.
   * 틀린 케이스 중 엔진이 미리 borderline이라고 자백했던 비율.
   */
  missesFlaggedBorderline: number;
  /** Brier score — 낮을수록 확률이 정직함 */
  brierScore: number | null;
  calibration: CalibrationBin[];
  byTier: Record<string, { count: number; hitRate: number; meanAbsGradeError: number }>;
  outcomes: CaseOutcome[];
  /** 발표 슬라이드에 그대로 붙일 한 문장 */
  headline: string;
}

/** κ 역추정 결과 */
export interface KappaEstimate {
  assessmentName: string;
  courseName: string;
  /** 정규화 평균 m = mean/maxScore */
  m: number;
  /** 정규화 표준편차 */
  s: number;
  /** κ = m(1-m)/s² - 1 */
  kappa: number | null;
  /** 베타분포로 표현 불가능한 조합이면 이유를 남긴다 (분산이 m(1−m) 이상) */
  invalidReason?: string;
  /** κ는 나왔지만 α<1 또는 β<1이라 U자형 — 시험 점수 분포로는 비현실적. 집계에서 제외 */
  implausibleShape?: boolean;
  ceilingClustered: boolean;
}

export interface KappaPreset {
  /** 체감난이도 라벨 — 사용자는 κ를 못 고르므로 이 라벨로 고른다 */
  label: '쉬움' | '보통' | '어려움' | '매우 어려움';
  kappaLow: number;
  kappaHigh: number;
  /** 이 프리셋을 뒷받침하는 표본 수. 적으면 UI에서 "잠정"으로 표시해야 함 */
  n: number;
}

export interface KappaReport {
  estimates: KappaEstimate[];
  /** 천장 밀집 요소를 제외한 유효 표본만으로 만든 사분위 */
  quartiles: { q1: number; median: number; q3: number } | null;
  presets: KappaPreset[];
  /** 표본이 부족하면 프리셋을 "근거 있음"이라고 주장하지 않는다 */
  grounded: boolean;
  caveat: string;
}
