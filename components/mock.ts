/* ==========================================================================
 *  components/mock.ts — 목 데이터 + 임시 계산 "단일" 집결지
 * --------------------------------------------------------------------------
 *  통합 담당(yongwon-1a)에게:
 *  화면이 쓰는 모든 가짜 데이터와 가짜 계산이 이 파일 하나에만 있다.
 *  아래 §A/§B/§C 의 export 를 실제 엔진 호출로 바꾸면 UI 는 손 안 대도 된다.
 *
 *    §A 학점  → lib/grade   : diagnose / predictCourse / whatIf /
 *                             discrimination / allocation / completeness
 *    §B 꿀강  → lib/honey   : MOCK_LECTURES (API /api/lectures 로 대체)
 *    §C 학식  → lib/meal    : mockCrawl / mockBattle / MOCK_MEAL_REVIEWS
 *
 *  실제 호출은 components/data.ts 가 먼저 API 를 때려보고, 실패하면 여기로
 *  떨어지게 돼 있다. 즉 API 가 붙는 순간 §B/§C 는 저절로 빠진다.
 *  §A 는 순수 클라이언트 계산이라 lib/grade 가 생기면 import 만 갈아끼우면 된다.
 *
 *  ⚠ 여기 계산식은 "화면이 움직이는 걸 보기 위한" 임시값이다.
 *    정확도를 주장하지 않는다. 팀원1의 엔진이 정본이다.
 * ========================================================================== */

import type {
  AllocationRow,
  BattleResult,
  Confidence,
  Course,
  CrawlResult,
  CumulativeGradeProb,
  DiscriminationContribution,
  EngineWarning,
  GradeBalance,
  GradeLetter,
  GradePrediction,
  Lecture,
  MealItem,
  MealReview,
  MealTime,
  PrecisionTier,
  WhatIfDelta,
} from '@/lib/types';

/* ★통합(조율자): §A 는 더 이상 임시 계산이 아니다 — 팀원1의 정본 엔진을 부른다.
 *  lib/grade 는 순수 함수라 클라이언트에서 그대로 돌아간다(CONTRACT 6장). */
import {
  predict,
  contributions,
  allocate,
  defaultScenarios,
  whatIf as engineWhatIf,
  computeBalance as engineBalance,
} from '@/lib/grade';

/* ==========================================================================
 *  §A. 학점 — lib/grade 가 생기면 이 블록을 통째로 교체
 * ========================================================================== */

/** 3칸 비로그인 진단의 입력. 전부 선택 입력이라 null 이 정상 상태다. */
export interface QuickInput {
  myScore: number | null;
  mean: number | null;
  stdev: number | null;
  /** 있으면 인원수 표현("40명 중 A 정원 12명")이 켜진다 */
  enrolled: number | null;
  maxScore: number;
}

export interface Completeness {
  /** 현재 입력으로 낼 수 있는 정확도(%) — 확률이 아니라 "입력 충족률"이다 */
  now: number;
  /** 다음에 넣으면 가장 많이 오르는 칸 */
  next: { key: keyof QuickInput; label: string; to: number } | null;
}

export interface QuickResult {
  tier: PrecisionTier;
  z: number | null;
  zRange: { low: number; high: number } | null;
  distribution: CumulativeGradeProb[] | null;
  headcount: { classSize: number; slotsForA: number; estimatedAbove: number } | null;
  confidence: Confidence;
  warnings: EngineWarning[];
  completeness: Completeness;
}

export function diagnose(input: QuickInput): QuickResult {
  const { myScore, mean, stdev } = input;
  const p = predict(quickCourse(input));

  const z =
    myScore != null && mean != null && stdev != null && stdev > 0
      ? (myScore - mean) / stdev
      : null;

  return {
    tier: p.tier,
    z,
    zRange: p.zRange,
    distribution: p.distribution,
    headcount: p.headcount,
    confidence: p.confidence,
    warnings: p.warnings,
    completeness: computeCompleteness(input),
  };
}

/** QuickInput → 평가요소 1개짜리 Course. 엔진에 태우기 위한 얇은 래퍼. */
function quickCourse(input: QuickInput): Course {
  const { myScore, mean, stdev, enrolled, maxScore } = input;
  return {
    id: 'quick',
    name: '빠른 진단',
    professor: '',
    credits: 3,
    enrolled,
    isAbsolute: false,
    assessments: [
      {
        id: 'quick-a',
        name: '시험',
        weight: 1,
        maxScore,
        myScore,
        mean,
        stdev,
        ceilingClustered: false,
      },
    ],
    attendance: null,
  };
}
export function computeCompleteness(input: QuickInput): Completeness {
  const steps: { key: keyof QuickInput; label: string; weight: number }[] = [
    { key: 'myScore', label: '내 점수', weight: 30 },
    { key: 'mean', label: '반 평균', weight: 20 },
    { key: 'stdev', label: '표준편차', weight: 32 },
    { key: 'enrolled', label: '수강인원', weight: 18 },
  ];
  let now = 0;
  for (const s of steps) if (input[s.key] != null) now += s.weight;

  const missing = steps.filter((s) => input[s.key] == null);
  missing.sort((a, b) => b.weight - a.weight);
  const head = missing[0];

  return {
    now,
    next: head ? { key: head.key, label: head.label, to: now + head.weight } : null,
  };
}

/** 과목 단위 예측(등록은 어디까지나 선택사항인 심화 경로). */
export function predictCourse(course: Course): GradePrediction {
  return predict(course);
}

/** 학점 잔고. 격하 케이스에서도 항상 유효하다. */
export function computeBalance(course: Course): GradeBalance {
  return engineBalance(course);
}

export function whatIf(course: Course): WhatIfDelta[] {
  return defaultScenarios(course).map((s) => engineWhatIf(course, s));
}

/** 변별 기여도. band 3구간 + note 만 온다 — 수치는 엔진이 일부러 안 보낸다. */
export function discrimination(course: Course): DiscriminationContribution[] {
  return contributions(course);
}

/** 배분 대시보드. 시간 환산은 하지 않는다(개인차라 앱이 알 수 없음). */
export function allocation(courses: Course[]): AllocationRow[] {
  return allocate(courses);
}

/* ── 과목 목 데이터 (등록은 선택사항이지만, 데모용으로 미리 3개) ──────────── */

export const MOCK_COURSES: Course[] = [
  {
    id: 'c-ml',
    name: '기계학습',
    professor: '김도현',
    credits: 3,
    enrolled: 42,
    isAbsolute: false,
    assessments: [
      { id: 'a1', name: '중간고사', weight: 0.3, maxScore: 100, myScore: 78, mean: 71, stdev: 12, ceilingClustered: false },
      { id: 'a2', name: '기말고사', weight: 0.35, maxScore: 100, myScore: null, mean: null, stdev: null, ceilingClustered: false },
      { id: 'a3', name: '과제', weight: 0.2, maxScore: 100, myScore: 96, mean: 94, stdev: 4, ceilingClustered: true },
      { id: 'a4', name: '출석', weight: 0.15, maxScore: 100, myScore: 93, mean: 97, stdev: 3, ceilingClustered: true },
    ],
    attendance: {
      totalSessions: 30, absences: 2, lateness: 2, allowedAbsences: 6,
      penaltyPerAbsence: 2, latePerAbsence: 3,
    },
  },
  {
    id: 'c-db',
    name: '데이터베이스',
    professor: '이수정',
    credits: 3,
    enrolled: 55,
    isAbsolute: false,
    assessments: [
      { id: 'b1', name: '중간고사', weight: 0.35, maxScore: 100, myScore: 62, mean: 68, stdev: 14, ceilingClustered: false },
      { id: 'b2', name: '기말고사', weight: 0.35, maxScore: 100, myScore: null, mean: null, stdev: null, ceilingClustered: false },
      { id: 'b3', name: '팀프로젝트', weight: 0.3, maxScore: 100, myScore: null, mean: null, stdev: null, ceilingClustered: false },
    ],
    attendance: {
      totalSessions: 30, absences: 4, lateness: 1, allowedAbsences: 6,
      penaltyPerAbsence: 2, latePerAbsence: 3,
    },
  },
  {
    id: 'c-writing',
    name: '과학기술글쓰기',
    professor: '박서윤',
    credits: 2,
    enrolled: 18,
    isAbsolute: true,
    assessments: [
      { id: 'd1', name: '에세이1', weight: 0.4, maxScore: 100, myScore: 88, mean: null, stdev: null, ceilingClustered: false },
      { id: 'd2', name: '에세이2', weight: 0.4, maxScore: 100, myScore: null, mean: null, stdev: null, ceilingClustered: false },
      { id: 'd3', name: '출석', weight: 0.2, maxScore: 100, myScore: 100, mean: null, stdev: null, ceilingClustered: true },
    ],
    attendance: {
      totalSessions: 15, absences: 0, lateness: 0, allowedAbsences: 3,
      penaltyPerAbsence: 4, latePerAbsence: 2,
    },
  },
];

/** 홈의 "다음 수업 째도 되나" 한 줄. 별도 타입이 없어 화면 전용으로 둔다. */
export interface NextClass {
  courseId: string;
  courseName: string;
  startsAt: string;
  room: string;
}

export const MOCK_NEXT_CLASS: NextClass = {
  courseId: 'c-db',
  courseName: '데이터베이스',
  startsAt: '14:00',
  room: '제6공학관 401',
};

/* ==========================================================================
 *  §B. 꿀강 — /api/lectures 가 붙으면 저절로 안 쓰임
 * ========================================================================== */

export const MOCK_LECTURES: Lecture[] = [
  {
    id: 'l-1', name: '인간과심리', professor: '정하늘', department: '교양학부',
    credits: 3, type: '교양선택', reviewCount: 142, avgRating: 4.4,
    axes: { gradeGenerosity: 0.82, workload: 0.18, attendanceStrictness: 0.30, teachingQuality: 0.78, examDifficulty: 0.25 },
    reliability: {
      score: 0.88, band: 'high',
      reasons: ['강의평 142건', '최근 3개 학기 모두 강의평 있음', '담당 교수 동일'],
      flags: [],
    },
    honeyScore: 86,
    summary: '출석만 채우면 학점이 잘 나온다는 말이 3년째 반복됩니다. 시험은 수업 필기 범위 안에서 나오고, 과제는 학기당 두 번 정도로 가볍습니다. 다만 지각에는 생각보다 엄격하다는 언급이 꾸준히 있습니다.',
  },
  {
    id: 'l-2', name: '데이터구조론', professor: '김도현', department: '인공지능학과',
    credits: 3, type: '전공필수', reviewCount: 68, avgRating: 3.6,
    axes: { gradeGenerosity: 0.42, workload: 0.72, attendanceStrictness: 0.55, teachingQuality: 0.88, examDifficulty: 0.80 },
    reliability: {
      score: 0.74, band: 'medium',
      reasons: ['강의평 68건', '평이 호평과 혹평으로 갈림'],
      flags: ['POLARIZED'],
    },
    honeyScore: 48,
    summary: '강의력 자체는 거의 모든 평에서 호평입니다. 다만 과제량이 많고 기말 난이도가 높아 학점은 짜게 나옵니다. "배우려면 최고, 학점 노리면 비추"로 평이 갈립니다.',
  },
  {
    id: 'l-3', name: '스타트업개론', professor: '최민규', department: '경영학부',
    credits: 2, type: '교양선택', reviewCount: 4, avgRating: 4.9,
    axes: { gradeGenerosity: 0.90, workload: 0.10, attendanceStrictness: 0.20, teachingQuality: 0.70, examDifficulty: 0.10 },
    reliability: {
      score: 0.21, band: 'low',
      reasons: ['강의평 4건', '전부 개설 첫 학기에 작성됨', '평점 5점이 3건으로 치우침'],
      flags: ['SMALL_SAMPLE', 'SELF_SELECTION'],
    },
    honeyScore: 61,
    summary: '4건 모두 "꿀강"이라고 적고 있지만 표본이 너무 적어 그대로 믿기 어렵습니다. 개설 첫 학기 수강생만 작성해 운영 방식이 바뀌었을 가능성이 있습니다. 판단 근거로 쓰기에는 아직 이릅니다.',
  },
  {
    id: 'l-4', name: '공학수학1', professor: '한지우', department: '기계공학과',
    credits: 3, type: '전공필수', reviewCount: 231, avgRating: 3.1,
    axes: { gradeGenerosity: 0.35, workload: 0.55, attendanceStrictness: 0.75, teachingQuality: 0.52, examDifficulty: 0.85 },
    reliability: {
      score: 0.91, band: 'high',
      reasons: ['강의평 231건', '최근 5개 학기 연속 강의평 있음'],
      flags: [],
    },
    honeyScore: 31,
    summary: '난이도가 높고 출결을 꼼꼼히 본다는 평이 일관됩니다. 대신 시험 범위와 유형이 매 학기 비슷해 기출을 풀면 대비가 된다는 언급이 많습니다. 재수강 비율이 높은 과목입니다.',
  },
  {
    id: 'l-5', name: '영화로읽는사회', professor: '서가영', department: '교양학부',
    credits: 3, type: '교양선택', reviewCount: 57, avgRating: 4.2,
    axes: { gradeGenerosity: 0.75, workload: 0.35, attendanceStrictness: 0.45, teachingQuality: 0.80, examDifficulty: 0.30 },
    reliability: {
      score: 0.44, band: 'low',
      reasons: ['2023-2 이후 강의평 없음', '담당 교수 변경 이력'],
      flags: ['STALE', 'PROFESSOR_CHANGED'],
    },
    honeyScore: 63,
    summary: '과거 평은 대체로 좋지만 2023-2 이후로 강의평이 끊겼고 담당 교수도 바뀌었습니다. 지금 학기 운영 방식이 그대로일 거라고 보기는 어렵습니다.',
  },
  {
    id: 'l-6', name: '알고리즘', professor: '이수정', department: '인공지능학과',
    credits: 3, type: '전공선택', reviewCount: 96, avgRating: 3.9,
    axes: { gradeGenerosity: 0.55, workload: 0.65, attendanceStrictness: 0.40, teachingQuality: 0.85, examDifficulty: 0.70 },
    reliability: {
      score: 0.83, band: 'high',
      reasons: ['강의평 96건', '최근 4개 학기 강의평 있음', '담당 교수 동일'],
      flags: [],
    },
    honeyScore: 57,
    summary: '설명이 좋고 과제 피드백이 성실하다는 평이 많습니다. 과제 분량은 적지 않지만 난이도가 계단식이라 따라가면 됩니다. 학점은 중간 정도로 짜지도 후하지도 않습니다.',
  },
  {
    id: 'l-7', name: '현대사회와법', professor: '오세진', department: '교양학부',
    credits: 3, type: '교양필수', reviewCount: 19, avgRating: 4.0,
    axes: null,
    reliability: {
      score: 0.38, band: 'low',
      reasons: ['강의평 19건', '축별 분석을 낼 만큼 본문이 길지 않음'],
      flags: ['SMALL_SAMPLE'],
    },
    honeyScore: null,
    summary: null,
  },
];

/* ==========================================================================
 *  §C. 학식 / 창보 vs 학식 — /api/meals* 가 붙으면 저절로 안 쓰임
 * ========================================================================== */

const MENU_ROTATION: Record<MealTime, string[][]> = {
  breakfast: [
    ['모닝롤', '스크램블에그', '샐러드', '우유'],
    ['흰쌀밥', '북엇국', '계란말이', '김치'],
    ['토스트', '잼/버터', '삶은달걀', '주스'],
  ],
  lunch: [
    ['흰쌀밥', '돈까스', '크림스프', '양배추샐러드', '단무지'],
    ['비빔밥', '콩나물국', '계란후라이', '김치'],
    ['제육덮밥', '미역국', '치커리무침', '깍두기'],
    ['김치찌개', '고등어구이', '시금치나물', '흰쌀밥'],
    ['치킨마요덮밥', '유부장국', '단무지', '요구르트'],
  ],
  dinner: [
    ['흰쌀밥', '순두부찌개', '제육볶음', '김치'],
    ['우동', '유부초밥', '단무지'],
    ['카레라이스', '미소장국', '피클'],
    ['부대찌개', '흰쌀밥', '계란찜', '깍두기'],
  ],
};

const CHANGBO_ROTATION: Record<MealTime, string[][]> = {
  breakfast: [['샌드위치', '아메리카노'], ['베이글', '크림치즈', '라떼']],
  lunch: [
    ['로제파스타', '갈릭브레드', '샐러드'],
    ['수제버거', '감자튀김', '콜라'],
    ['치킨텐더덮밥', '미소장국', '샐러드'],
    ['마라샹궈', '공기밥'],
  ],
  dinner: [
    ['등심돈까스', '우동국물', '샐러드'],
    ['닭갈비볶음밥', '계란국'],
    ['쌀국수', '짜조'],
  ],
};

function dayIndex(date: string): number {
  const d = new Date(date + 'T00:00:00');
  return Math.floor(d.getTime() / 86400000);
}

function priceFor(c: 'haksik' | 'changbo' | 'dorm', t: MealTime): number {
  if (c === 'changbo') return t === 'breakfast' ? 4500 : 6500;
  if (c === 'dorm') return t === 'breakfast' ? 3500 : 4500;
  return t === 'breakfast' ? 3000 : 4500;
}

/**
 * 크롤링 결과 흉내. `seedFallback` 을 켜면 CrawlResult.fallback='seed' 경로
 * (= "식단을 못 가져와 시드 데이터를 보여주는 중" 배너)를 화면에서 확인할 수 있다.
 */
export function mockCrawl(date: string, seedFallback = false): CrawlResult {
  const i = dayIndex(date);
  const d = new Date(date + 'T00:00:00');
  const weekend = d.getDay() === 0 || d.getDay() === 6;

  const items: MealItem[] = [];
  const times: MealTime[] = weekend ? ['lunch'] : ['breakfast', 'lunch', 'dinner'];

  for (const t of times) {
    const hk = MENU_ROTATION[t];
    items.push({
      id: `${date}-haksik-${t}`, date, cafeteria: 'haksik', mealTime: t,
      name: null,
      menu: hk[i % hk.length], price: priceFor('haksik', t),
      kcal: 600 + ((i * 37 + t.length * 11) % 320),
    });

    const cb = CHANGBO_ROTATION[t];
    items.push({
      id: `${date}-changbo-${t}`, date, cafeteria: 'changbo', mealTime: t,
      name: null,
      menu: cb[i % cb.length], price: priceFor('changbo', t),
      kcal: 700 + ((i * 53 + t.length * 7) % 340),
    });

    if (t !== 'breakfast') {
      const dm = MENU_ROTATION[t];
      items.push({
        id: `${date}-dorm-${t}`, date, cafeteria: 'dorm', mealTime: t,
        name: null,
        menu: dm[(i + 2) % dm.length], price: priceFor('dorm', t),
        kcal: 650 + ((i * 29) % 300),
      });
    }
  }

  return {
    ok: !seedFallback,
    fetchedAt: new Date().toISOString(),
    source: 'https://www.hanyang.ac.kr/web/www/re11',
    items,
    error: seedFallback ? '학식 페이지 응답 없음 (timeout)' : undefined,
    fallback: seedFallback ? 'seed' : undefined,
  };
}

/**
 * 대결 스코어보드 (폴백용). 덤프 평점 데이터를 두지 않으므로 초기에는 후기 0건으로 내려보낸다.
 */
export function mockBattle(date: string, mealTime: MealTime): BattleResult {
  const mt = mealTime === 'breakfast' ? '조식' : mealTime === 'lunch' ? '중식' : '석식';
  const standings = [
    {
      cafeteria: 'changbo' as const,
      label: '창업보육센터',
      avgRating: null,
      reviewCount: 0,
      trend: 'flat' as const,
    },
    {
      cafeteria: 'haksik' as const,
      label: '학생식당',
      avgRating: null,
      reviewCount: 0,
      trend: 'flat' as const,
    },
  ];

  return {
    date,
    mealTime,
    standings,
    winner: null,
    decisive: false,
    headline: `오늘 ${mt}은 아직 후기가 없습니다 — 첫 후기를 남겨보세요`,
  };
}

export const MOCK_MEAL_REVIEWS: MealReview[] = [];

/* ==========================================================================
 *  §A-2. 3칸 진단 위에서 도는 비교 예측 — 학점 화면의 주인공
 * --------------------------------------------------------------------------
 *  절대 예측("당신은 A0입니다")을 만들 수 있는 함수를 아예 두지 않는다.
 *  낼 수 있는 건 "지금 대비 얼마나 움직이나"뿐이다.
 * ========================================================================== */

/** WhatIfDelta 에 비교용 전/후 누적확률을 덧붙인 화면 전용 확장. */
export interface QuickWhatIf extends WhatIfDelta {
  /** 지금 실제로 걸려 있는 등급(누적 확률이 50%에 가장 가까운 칸) */
  pivotGrade: GradeLetter | null;
  probBefore: number | null;
  probAfter: number | null;
}

export interface WhatIfAssumptions {
  /** 결석 1회당 환산점수 감점. 강의계획서마다 달라서 사용자가 고치게 둔다. */
  penaltyPerAbsence: number;
  /** 지각 몇 번이 결석 1회인지 */
  latePerAbsence: number;
}

export const DEFAULT_ASSUMPTIONS: WhatIfAssumptions = {
  penaltyPerAbsence: 2,
  latePerAbsence: 3,
};

/** 지금 걸려 있는 등급: 누적확률이 50%에 가장 가까운 칸. */
function pivotOf(dist: CumulativeGradeProb[] | null): CumulativeGradeProb | null {
  if (!dist || dist.length === 0) return null;
  return dist.reduce((best, d) =>
    Math.abs(d.atLeastProb - 0.5) < Math.abs(best.atLeastProb - 0.5) ? d : best,
  );
}

export function whatIfQuick(
  input: QuickInput,
  a: WhatIfAssumptions = DEFAULT_ASSUMPTIONS,
): QuickWhatIf[] {
  const base = diagnose(input);
  const pivot = pivotOf(base.distribution);
  const borderline = pivot != null && pivot.atLeastProb > 0.4 && pivot.atLeastProb < 0.6;

  const scenarios: { scenario: string; delta: number }[] = [
    { scenario: '오늘 이 수업 한 번 결석', delta: -a.penaltyPerAbsence },
    { scenario: '이번 주까지 두 번 결석', delta: -a.penaltyPerAbsence * 2 },
    { scenario: '결석 대신 지각 한 번', delta: -a.penaltyPerAbsence / Math.max(1, a.latePerAbsence) },
    { scenario: '남은 시험을 5점 더 받음', delta: +5 },
  ];

  return scenarios.map(({ scenario, delta }) => {
    if (input.myScore == null || pivot == null) {
      return {
        scenario,
        balanceDelta: delta,
        gradeShift: '지금 입력으로는 등급이 어떻게 움직이는지 말할 수 없습니다',
        borderlineFlag: false,
        pivotGrade: null,
        probBefore: null,
        probAfter: null,
      };
    }

    const after = diagnose({ ...input, myScore: input.myScore + delta });
    const probAfter =
      after.distribution?.find((d) => d.grade === pivot.grade)?.atLeastProb ?? null;

    return {
      scenario,
      balanceDelta: delta,
      gradeShift: shiftText(pivot.grade, pivot.atLeastProb, probAfter),
      borderlineFlag: borderline,
      pivotGrade: pivot.grade,
      probBefore: pivot.atLeastProb,
      probAfter,
    };
  });
}

function shiftText(grade: GradeLetter, before: number, after: number | null): string {
  if (after == null) return '지금 입력으로는 등급이 어떻게 움직이는지 말할 수 없습니다';

  const b = Math.round(before * 10) * 10;
  const a = Math.round(after * 10) * 10;
  const diff = a - b;

  if (diff === 0) return `${grade} 이상일 가능성은 눈에 띄게 달라지지 않습니다`;
  if (diff <= -20) return `${grade} 이상일 가능성이 확 줄어듭니다`;
  if (diff < 0) return `${grade} 이상일 가능성이 눈에 띄게 줄어듭니다`;
  if (diff >= 20) return `${grade} 이상일 가능성이 확 올라갑니다`;
  return `${grade} 이상일 가능성이 눈에 띄게 올라갑니다`;
}

/** 홈 화면 한 줄 답. 여기서도 결론을 단정하지 않는다. */
export function skipVerdict(w: QuickWhatIf | undefined): {
  line: string;
  tone: 'ok' | 'careful' | 'unknown';
} {
  if (!w || w.probBefore == null || w.probAfter == null) {
    return {
      line: '아직 판단할 근거가 없습니다 — 점수 세 칸만 넣으면 답할 수 있습니다',
      tone: 'unknown',
    };
  }
  const b = Math.round(w.probBefore * 10) * 10;
  const a = Math.round(afterOf(w) * 10) * 10;

  if (w.borderlineFlag) {
    return { line: '지금은 경계선이라 한 번이 그대로 표가 납니다 — 가는 쪽을 권합니다', tone: 'careful' };
  }
  if (a < b) {
    return { line: `한 번 빠지면 ${w.pivotGrade} 이상 가능성이 눈에 띄게 줄어듭니다`, tone: 'careful' };
  }
  return { line: '한 번 빠진다고 등급이 움직일 자리는 아닙니다', tone: 'ok' };
}

function afterOf(w: QuickWhatIf): number {
  return w.probAfter ?? 0;
}
