/**
 * ============================================================================
 *  슬기로운 에리카 생활 — 공유 타입 계약 (Shared Contract)
 * ============================================================================
 *  이 파일은 조율자만 수정한다. 팀원1/2/3은 읽기 전용으로 사용하고,
 *  변경이 필요하면 조율자에게 요청한다. (직접 고치면 병렬 작업이 깨짐)
 *
 *  A필러 = 학점 잔고 + 예측 엔진   (팀원1: lib/grade/**)
 *  B필러 = 꿀강 탐색 + 신뢰성 평가 (팀원2: lib/honey/**)
 *  C필러 = 학식/창보 + 후기 대결   (팀원2: lib/meal/**)
 *  화면  = 전 필러 UI              (팀원3: app/**, components/**)
 * ============================================================================
 */

/* ────────────────────────────────────────────────────────────────────────────
 * 공통
 * ──────────────────────────────────────────────────────────────────────────*/

/** 앱 전역 정직성 규칙: 점 추정 금지. 확률은 반드시 이 3단계 or 5~10% 단위. */
export type Confidence = 'low' | 'medium' | 'high';

/** 회의록 4-4: 변별 기여도는 숫자(62%) 금지, 3구간 정성 표현만. */
export type ImpactBand = 'negligible' | 'supporting' | 'decisive';

export type Semester = `${number}-${1 | 2 | 'S' | 'W'}`;

/* ────────────────────────────────────────────────────────────────────────────
 * A필러 — 학점 잔고 + 예측 엔진   (소유: 팀원1 / lib/grade)
 * ──────────────────────────────────────────────────────────────────────────*/

/** 평가요소 1개. 회의록 6장 데이터 모델(사용자→학기→과목→평가항목) 4층의 최하층. */
export interface Assessment {
  id: string;
  name: string;              // "중간고사", "출석", "팀프로젝트"
  weight: number;            // 반영비율 0~1 (과목 내 합=1)
  maxScore: number;          // 만점
  myScore: number | null;    // 내 점수 (미응시=null)
  mean: number | null;       // 반 평균 (미공개=null)
  stdev: number | null;      // 표준편차 (미공개=null)
  /** 천장 밀집 요소(출석·과제). true면 z경로에서 제외하고 감점으로만 처리. 회의록 4-2(2) */
  ceilingClustered: boolean;
}

export interface AttendanceLedger {
  totalSessions: number;     // 총 수업 횟수
  absences: number;          // 결석
  lateness: number;          // 지각
  allowedAbsences: number;   // F 처리 기준 결석 한도
  /** 결석 1회당 감점(환산점수 기준), 지각 n회=결석1회 규칙은 latePerAbsence로 */
  penaltyPerAbsence: number;
  latePerAbsence: number;
}

export interface Course {
  id: string;
  name: string;
  professor: string;
  credits: number;
  enrolled: number | null;   // 수강인원. 20명 이하면 예측 제외(회의록 4-3)
  isAbsolute: boolean;       // 절대평가 여부. true면 예측 제외
  /**
   * 내 등수. 교수가 등수를 공개한 경우에만 채운다.
   * 이게 있으면 정밀도 사다리 Tier 4 — 분포 추정이 아예 불필요하고 백분위가 직접 나온다.
   * 최빈 케이스는 null이다.
   */
  myRank?: number | null;
  assessments: Assessment[];
  attendance: AttendanceLedger | null;
}

/** 회의록 4-2 정밀도 사다리 */
export type PrecisionTier = 0 | 1 | 2 | 3 | 4;

export type GradeLetter = 'A+' | 'A0' | 'B+' | 'B0' | 'C+' | 'C0' | 'D+' | 'D0' | 'F';

/** 누적 확률로만 표시한다: "A0 55%"가 아니라 "A0 이상일 확률 70%" (회의록 4-3) */
export interface CumulativeGradeProb {
  grade: GradeLetter;
  atLeastProb: number;       // 0~1, 표시 시 5~10% 단위로 뭉갤 것
}

/** 학점 잔고: ①확보 ②상실 ③잔여 */
export interface GradeBalance {
  secured: number;           // 이미 확보한 환산점수
  lost: number;              // 이미 잃은 점수(결석·지각·미제출)
  remaining: number;         // 남은 배점
}

export interface EngineWarning {
  code:
    | 'CEILING_EFFECT'       // 천장효과 감지 (평균이 만점 80%↑)
    | 'BORDERLINE'           // 경계선 = 사실상 동전던지기
    | 'SMALL_CLASS'          // 수강인원 20명 이하
    | 'ABSOLUTE_GRADING'     // 절대평가
    | 'LOW_TIER'             // 표준편차 없음 → blur
    | 'ATTENDANCE_RISK';     // 결석 한도 임박
  message: string;
}

export interface GradePrediction {
  courseId: string;
  tier: PrecisionTier;
  balance: GradeBalance;
  /** tier<=1이면 null (blur 처리 — 등급 단정 금지) */
  distribution: CumulativeGradeProb[] | null;
  /** ρ=0.3 / ρ=0.8 두 경우의 구간. 회의록 4-2(1) */
  zRange: { low: number; high: number } | null;
  /** 정원 기반 인원수 표현: "40명 중 A 정원 12명, 내 위로 추정 8명" */
  headcount: { classSize: number; slotsForA: number; estimatedAbove: number } | null;
  confidence: Confidence;
  warnings: EngineWarning[];
}

/** 킬러 기능: 변별 기여도 (숫자 대신 3구간) */
export interface DiscriminationContribution {
  assessmentId: string;
  assessmentName: string;
  declaredWeight: number;    // 명목 반영비율
  band: ImpactBand;          // 실질 영향력
  note: string;              // "다들 만점이라 등급엔 사실상 영향 없음"
}

/** 비교 예측: "이번 주 결석하면?" — 절대 예측 대신 차분 (회의록 4-3) */
export interface WhatIfDelta {
  scenario: string;          // "이번 주 결석"
  balanceDelta: number;      // 환산점수 변화
  gradeShift: string;        // "A0 이상 확률이 눈에 띄게 줄어듭니다"
  borderlineFlag: boolean;   // 경계선이면 차분도 불안정 — 반드시 표시
}

/** 배분 대시보드 (2순위 필수) */
export type CourseZone = 'locked' | 'borderline' | 'reversible'; // 확정권/경계권/역전권

export interface AllocationRow {
  courseId: string;
  courseName: string;
  zone: CourseZone;
  /** 기말 +1점당 예상 학기평점 상승폭. 시간 환산은 의도적으로 안 함 */
  gpaGainPerPoint: number;
}

/* ────────────────────────────────────────────────────────────────────────────
 * B필러 — 꿀강 탐색 + 신뢰성 평가   (소유: 팀원2 / lib/honey)
 * ──────────────────────────────────────────────────────────────────────────*/

/** 강의평 원문 1건 */
export interface LectureReview {
  id: string;
  lectureId: string;
  semester: Semester;
  rating: number;            // 1~5
  text: string;
  reportedGrade: GradeLetter | null; // 작성자가 밝힌 받은 학점
}

/** LLM이 강의평에서 뽑아내는 축. "신뢰성은 LLM으로" 요구사항의 실체 */
export interface HoneyAxes {
  gradeGenerosity: number;   // 학점 후함 0~1
  workload: number;          // 과제량(낮을수록 꿀) 0~1
  attendanceStrictness: number; // 출결 빡셈 0~1
  teachingQuality: number;   // 강의력 0~1
  examDifficulty: number;    // 시험 난이도 0~1
}

/**
 * 강의평의 신뢰성 평가. 별점 평균만 믿으면 안 되는 이유를 LLM이 판정.
 * 표본이 작거나, 극단 리뷰가 몰려있거나, 학기가 오래됐으면 신뢰도가 깎인다.
 */
export interface ReliabilityVerdict {
  score: number;             // 0~1
  band: Confidence;
  reasons: string[];         // "표본 4건", "최근 2년 강의평 없음", "교수 변경 이력"
  /** LLM이 판단한 어뷰징/편향 신호 */
  flags: ('SMALL_SAMPLE' | 'POLARIZED' | 'STALE' | 'PROFESSOR_CHANGED' | 'SELF_SELECTION')[];
}

export interface Lecture {
  id: string;
  name: string;
  professor: string;
  department: string;
  credits: number;
  type: '전공필수' | '전공선택' | '교양필수' | '교양선택' | '일반선택';
  reviewCount: number;
  avgRating: number | null;
  axes: HoneyAxes | null;
  reliability: ReliabilityVerdict;
  /** 종합 꿀강 지수 0~100. 신뢰도로 중앙(50)쪽으로 축소(shrinkage)된 값 */
  honeyScore: number | null;
  summary: string | null;    // LLM 3줄 요약
}

/* ────────────────────────────────────────────────────────────────────────────
 * C필러 — 학식/창보 + 후기 대결   (소유: 팀원2 / lib/meal)
 * ──────────────────────────────────────────────────────────────────────────*/

export type MealTime = 'breakfast' | 'lunch' | 'dinner';

/** 대결 진영. 창보(창업보육센터) vs 학식(학생식당) */
export type Cafeteria = 'haksik' | 'changbo' | 'dorm' | 'faculty';

export interface MealItem {
  /**
   * `${date}-${cafeteria}-${mealTime}` + 2번째부터 `-2`, `-3`...
   *
   * 한 식당의 한 끼니에 코너가 여러 개인 경우가 실제로 있다
   * (학생식당 중식 = 중화비빔밥 4,500원 / 고구마돈가스 6,500원).
   * 첫 코너가 접미사 없는 기본 id 를 갖는 건 기존 후기 시드
   * (mealItemId: "2026-09-14-changbo-lunch")를 깨지 않기 위한 것이다.
   */
  id: string;
  date: string;              // YYYY-MM-DD
  cafeteria: Cafeteria;
  mealTime: MealTime;
  /** 대표 메뉴명. HY-SQUARE 가 한/영을 한 칸에 넣어 주므로 그대로 보존한다. 없으면 null */
  name: string | null;
  menu: string[];            // 곁들이 구성 (밥·국·김치·샐러드…)
  price: number | null;
  kcal: number | null;       // 원본이 열량을 안 주므로 크롤링분은 항상 null
  /** 화면에 쓸 사진 경로. 내려받기 성공 시 `/meals/...`, 실패 시 원본 절대 URL */
  imageUrl?: string | null;
  /** 원본 사진 URL. imageUrl 이 로컬 파일인데 없을 때의 대체 경로로 쓴다 */
  imageSourceUrl?: string | null;
  soldOut?: boolean;
}

/**
 * 식당 자체의 정보 (식단이 아니라 "가게"). 사진·위치·운영시간·공지.
 * HY-SQUARE 시설 페이지(facilities/index.php)의 구내식당 카테고리에서 온다.
 */
export interface CafeteriaInfo {
  cafeteria: Cafeteria;
  /** 원본 시설 id (detail.php?id= 에 그대로 쓰인다) */
  facilityId: number;
  name: string;              // "학생식당", "창업보육센터식당"
  location: string;          // "학생복지관 2층"
  buildingNo: string;        // "102"
  /** 원문 그대로의 여러 줄 운영시간. 줄 단위로 끊어 담는다 */
  operatingTime: string[];
  operatingStatus: string;   // "영업중"
  notice: string;
  contact: string;
  imageUrl: string | null;
  imageSourceUrl: string | null;
  /** 이 식당의 원본 상세 페이지 */
  sourceUrl: string;
}

/** 먹은 사람의 후기 — 별점 */
export interface MealReview {
  id: string;
  mealItemId: string;
  rating: number;            // 1~5
  text: string;
  createdAt: string;         // ISO
  nickname: string;
}

/** 크롤링 봇 결과. 실패해도 화면이 비지 않도록 상태를 명시적으로 넘긴다 */
export interface CrawlResult {
  ok: boolean;
  fetchedAt: string;         // ISO
  source: string;            // 원본 URL
  items: MealItem[];
  /**
   * 식당 정보/사진. 식단(items)과 수명이 다르다 — 날짜가 바뀌어도 그대로다.
   * 시드 폴백일 때는 비어 있을 수 있으므로 화면은 없는 경우를 견뎌야 한다.
   */
  cafeterias?: CafeteriaInfo[];
  error?: string;
  /** 크롤링 실패 시 캐시/시드로 대체했는지 */
  fallback?: 'cache' | 'seed';
}

/** 창보 vs 학식 대결 스코어보드 */
export interface BattleStanding {
  cafeteria: Cafeteria;
  label: string;             // "학생식당", "창업보육센터"
  avgRating: number | null;
  reviewCount: number;
  /** 최근 7일 평점 추세 */
  trend: 'up' | 'down' | 'flat';
}

export interface BattleResult {
  date: string;
  mealTime: MealTime;
  standings: BattleStanding[];
  winner: Cafeteria | null;  // 표본 부족이면 null (승부 판정 유보)
  /** 표본이 적으면 승패를 단정하지 않는다 — A필러와 같은 정직성 규칙 */
  decisive: boolean;
  headline: string;          // "오늘 중식은 창보 판정승"
}

/* ────────────────────────────────────────────────────────────────────────────
 * API 계약 — 팀원2가 구현, 팀원3이 소비
 * ──────────────────────────────────────────────────────────────────────────*/

export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = { ok: false; error: string };
export type ApiResponse<T> = ApiOk<T> | ApiErr;

/**
 * GET  /api/meals?date=YYYY-MM-DD           → ApiResponse<MealItem[]>
 *      응답 헤더로 X-Meal-Ok / X-Meal-Fallback 을 함께 흘린다
 * GET  /api/meals/status                     → ApiResponse<CrawlResult>
 *      MealItem[]만으로는 "진짜 크롤링 결과인지 시드인지"를 화면이 알 수 없어
 *      정직성 배지를 못 띄운다. 그래서 상태를 별도 엔드포인트로 노출한다.
 * GET  /api/meals/battle?date=&mealTime=    → ApiResponse<BattleResult>
 * POST /api/meals/review  {mealItemId,rating,text,nickname}
 *                                            → ApiResponse<MealReview>
 * GET  /api/lectures?q=&type=&sort=honey    → ApiResponse<Lecture[]>
 * GET  /api/lectures/[id]                   → ApiResponse<Lecture>
 */
