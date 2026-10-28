/**
 * lib/honey/axes.ts — 강의평 텍스트 → HoneyAxes 5축 추출
 *
 * 두 가지 경로가 있다.
 *   1) LLM 경로   : scripts/score-lectures.ts 가 빌드 타임에 호출 (buildAxesPrompt 사용)
 *   2) 휴리스틱 경로: 키워드 사전 기반. API 키가 없어도 100% 결정론적으로 동작한다.
 *
 * ★ 런타임에 API 키를 요구하지 않는다. 앱은 data/lectures.json 만 읽는다.
 */

import type { HoneyAxes, LectureReview } from '../types.ts';

export const AXIS_KEYS = [
  'gradeGenerosity',
  'workload',
  'attendanceStrictness',
  'teachingQuality',
  'examDifficulty',
] as const;

export type AxisKey = (typeof AXIS_KEYS)[number];

export const AXIS_LABELS: Record<AxisKey, string> = {
  gradeGenerosity: '학점 후함',
  workload: '과제량',
  attendanceStrictness: '출결 빡셈',
  teachingQuality: '강의력',
  examDifficulty: '시험 난이도',
};

/** 값이 높을수록 "꿀"인가? false면 낮을수록 꿀 (과제량·출결·시험난이도) */
export const AXIS_HIGHER_IS_SWEETER: Record<AxisKey, boolean> = {
  gradeGenerosity: true,
  workload: false,
  attendanceStrictness: false,
  teachingQuality: true,
  examDifficulty: false,
};

/* ────────────────────────────────────────────────────────────────────────────
 * 휴리스틱 키워드 사전
 * ──────────────────────────────────────────────────────────────────────────*/

interface Cue {
  /** 부분 문자열로 매칭 (한국어는 형태소 분석 없이 어간 조각으로 잡는다) */
  pattern: string;
  /** +면 축 값을 올리고, -면 내린다. 절대값은 확신도. */
  weight: number;
}

const CUES: Record<AxisKey, Cue[]> = {
  gradeGenerosity: [
    { pattern: '학점 후', weight: 2 },
    { pattern: '후하게', weight: 2 },
    { pattern: '퍼주', weight: 2 },
    { pattern: '꿀강', weight: 1.2 },
    { pattern: '성적 잘', weight: 1.8 },
    { pattern: '잘 주십니다', weight: 1.8 },
    { pattern: '잘 주시', weight: 1.6 },
    { pattern: 'A는 나와', weight: 1.8 },
    { pattern: 'A+ 비율이 높', weight: 2 },
    { pattern: '넉넉하게 나왔', weight: 1.5 },
    { pattern: '살아나', weight: 1 },
    { pattern: '학점이 짜', weight: -2 },
    { pattern: '학점 기대', weight: -1.5 },
    { pattern: '인색', weight: -2 },
    { pattern: '학점이 안 나오', weight: -2 },
    { pattern: 'A 받기', weight: -1.5 },
    { pattern: '재수강', weight: -0.8 },
    { pattern: '상대평가가 빡', weight: -1.5 },
  ],
  workload: [
    { pattern: '과제가 매주', weight: 2 },
    { pattern: '과제 부담이 크', weight: 2 },
    { pattern: '팀플이 두', weight: 2 },
    { pattern: '팀플', weight: 0.8 },
    { pattern: '레포트 분량', weight: 1.8 },
    { pattern: '제출물이 계속', weight: 1.8 },
    { pattern: '과제가 무거', weight: 2 },
    { pattern: '주말이 통째', weight: 1.5 },
    { pattern: '시간 투자', weight: 1.2 },
    { pattern: '과제가 거의 없', weight: -2.2 },
    { pattern: '과제 부담이 적', weight: -2 },
    { pattern: '팀플이 없', weight: -1.8 },
    { pattern: '제출물이 적', weight: -1.8 },
    { pattern: '여유롭', weight: -1.2 },
    { pattern: '부담이 없', weight: -1 },
  ],
  attendanceStrictness: [
    { pattern: '전자출결', weight: 1.8 },
    { pattern: '출석을 빡', weight: 2 },
    { pattern: '출석을 매', weight: 1.8 },
    { pattern: '지각 세 번', weight: 1.8 },
    { pattern: '결석 처리', weight: 1.5 },
    { pattern: '결석 한 번에 감점', weight: 2 },
    { pattern: '대리출석', weight: 1.5 },
    { pattern: '무조건 가야', weight: 1.5 },
    { pattern: '출석을 거의 안', weight: -2.2 },
    { pattern: '출결 부담이 없', weight: -2 },
    { pattern: '출결이 자유', weight: -2 },
    { pattern: '녹화 강의', weight: -1.5 },
    { pattern: '출석 스트레스가 없', weight: -1.8 },
    { pattern: '결석해도', weight: -1.5 },
  ],
  teachingQuality: [
    { pattern: '설명이 깔끔', weight: 2 },
    { pattern: '이해가 잘', weight: 1.8 },
    { pattern: '이해가 정말 잘', weight: 2 },
    { pattern: '강의력이 좋', weight: 2.2 },
    { pattern: '질문도 잘 받아', weight: 1.5 },
    { pattern: '정리가 잘', weight: 1.5 },
    { pattern: '예시를 많이', weight: 1.5 },
    { pattern: '수업 준비가 성실', weight: 1.8 },
    { pattern: '복습하기 좋', weight: 1.2 },
    { pattern: '수업이 지루', weight: -2 },
    { pattern: '교재를 그대로', weight: -2 },
    { pattern: '설명이 부족', weight: -2 },
    { pattern: '전달력이 아쉬', weight: -2 },
    { pattern: '혼자 공부', weight: -1.5 },
    { pattern: '집중이 잘 안', weight: -1.5 },
    { pattern: '진도가 너무 빨', weight: -1.5 },
  ],
  examDifficulty: [
    { pattern: '시험이 어렵', weight: 2.2 },
    { pattern: '응용 문제', weight: 1.5 },
    { pattern: '평균이 많이 낮', weight: 1.8 },
    { pattern: '족보 없으면', weight: 1.8 },
    { pattern: '범위가 넓', weight: 1.5 },
    { pattern: '까다로', weight: 1.5 },
    { pattern: '수업에서 다룬 것만', weight: -2 },
    { pattern: '난이도가 평이', weight: -2.2 },
    { pattern: '오픈북', weight: -2 },
    { pattern: '복습만 해도', weight: -1.8 },
    { pattern: '기출과 비슷', weight: -1.8 },
    { pattern: '무난했습니다', weight: -0.8 },
  ],
};

/** 로지스틱: 가중치 합 → 0~1. 신호가 없으면 정확히 0.5(=모름). */
function squash(score: number, hits: number): number {
  if (hits === 0) return 0.5;
  return 1 / (1 + Math.exp(-score / 2.2));
}

export interface HeuristicAxesResult {
  axes: HoneyAxes;
  /** 축별로 키워드가 몇 번 잡혔는지. 0이면 "그 축은 모른다"는 뜻. */
  hits: Record<AxisKey, number>;
}

/**
 * 결정론적 휴리스틱 축 추출.
 * LLM 키가 없을 때의 폴백이자, LLM 결과를 검증할 때의 기준선이다.
 */
export function extractAxesHeuristic(reviews: LectureReview[]): HeuristicAxesResult {
  const totals: Record<string, number> = {};
  const hits: Record<string, number> = {};
  for (const key of AXIS_KEYS) {
    totals[key] = 0;
    hits[key] = 0;
  }

  for (const review of reviews) {
    const text = review.text;
    for (const key of AXIS_KEYS) {
      for (const cue of CUES[key]) {
        if (text.includes(cue.pattern)) {
          totals[key] += cue.weight;
          hits[key] += 1;
        }
      }
    }
  }

  // 별점 평균은 약한 사전 정보로만 쓴다 (강한 신호가 없을 때 살짝 기울임)
  const avg = reviews.length > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 3;
  const ratingNudge = (avg - 3) / 2; // -1 ~ +1

  const axes = {} as HoneyAxes;
  for (const key of AXIS_KEYS) {
    const sweeter = AXIS_HIGHER_IS_SWEETER[key];
    const nudge = (sweeter ? ratingNudge : -ratingNudge) * 0.6;
    // 키워드 신호가 하나도 없으면 별점 보정도 하지 않고 정확히 0.5 = "모른다"
    const value = squash(totals[key] / Math.max(1, Math.sqrt(reviews.length)) + nudge, hits[key]);
    axes[key] = round2(value);
  }

  return { axes, hits: hits as Record<AxisKey, number> };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/* ────────────────────────────────────────────────────────────────────────────
 * LLM 경로 — 프롬프트 빌더 & 응답 검증
 * ──────────────────────────────────────────────────────────────────────────*/

/** 매 요청 동일한 문자열이어야 프롬프트 캐시가 먹는다 — 날짜/난수를 넣지 말 것. */
export const AXES_SYSTEM_PROMPT = `당신은 한양대 ERICA 학생들의 강의평을 읽고 강의의 성격을 구조화하는 분석기입니다.

주어진 강의평 목록을 읽고 아래 5개 축을 각각 0.0~1.0 사이 실수로 평가하세요.

- gradeGenerosity: 학점을 후하게 주는가 (1.0 = 매우 후함, 0.0 = 매우 짬)
- workload: 과제/팀플 부담이 큰가 (1.0 = 매우 많음, 0.0 = 거의 없음)
- attendanceStrictness: 출결을 빡세게 보는가 (1.0 = 매우 엄격, 0.0 = 거의 안 봄)
- teachingQuality: 강의 전달력이 좋은가 (1.0 = 매우 좋음, 0.0 = 매우 나쁨)
- examDifficulty: 시험이 어려운가 (1.0 = 매우 어려움, 0.0 = 매우 쉬움)

중요한 규칙:
1. 강의평에 해당 축에 대한 언급이 전혀 없으면 정확히 0.5 를 주고, unknown 배열에 그 축 이름을 넣으세요.
   근거 없이 숫자를 지어내지 마세요. "모른다"가 틀린 숫자보다 낫습니다.
2. 소수 의견에 휘둘리지 말고 전체 강의평의 중심 경향을 보세요.
3. summary 는 이 강의를 고민하는 학생에게 도움이 되는 정확히 3줄입니다.
   각 줄은 40자 이내, 과장 없이. 표본이 적으면 그 사실을 한 줄에 적으세요.
4. concerns 에는 이 강의평들을 그대로 믿기 어려운 이유가 있으면 적으세요
   (극단 리뷰만 몰림 / 오래된 학기 / 학점 잘 받은 사람만 쓴 것 같음 등). 없으면 빈 배열.

반드시 아래 JSON 형식 하나만 출력하세요. 코드블록이나 설명을 덧붙이지 마세요.
{"axes":{"gradeGenerosity":0.0,"workload":0.0,"attendanceStrictness":0.0,"teachingQuality":0.0,"examDifficulty":0.0},"unknown":[],"summary":["","",""],"concerns":[]}`;

export interface LlmLectureAnalysis {
  axes: HoneyAxes;
  unknown: AxisKey[];
  summary: string[];
  concerns: string[];
}

/** 강의 1개분 사용자 메시지. 강의평이 많으면 잘라내되, 잘랐다는 사실을 명시한다. */
export function buildAxesUserPrompt(
  lecture: { name: string; professor: string; type: string },
  reviews: LectureReview[],
  maxReviews = 40,
): string {
  const used = reviews.slice(0, maxReviews);
  const truncatedNote =
    reviews.length > used.length
      ? `\n(전체 ${reviews.length}건 중 최근 ${used.length}건만 표시)`
      : '';
  const lines = used.map(
    (r, i) =>
      `${i + 1}. [${r.semester} · 별점 ${r.rating}${r.reportedGrade ? ` · 받은학점 ${r.reportedGrade}` : ''}] ${r.text}`,
  );
  return `강의: ${lecture.name} (${lecture.professor}, ${lecture.type})
강의평 ${used.length}건:${truncatedNote}

${lines.join('\n')}`;
}

/** LLM 응답 파싱 + 검증. 조금이라도 이상하면 null 을 돌려주고 호출부가 휴리스틱으로 떨어진다. */
export function parseLlmAnalysis(raw: string): LlmLectureAnalysis | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  const rawAxes = obj.axes;
  if (typeof rawAxes !== 'object' || rawAxes === null) return null;
  const axesObj = rawAxes as Record<string, unknown>;

  const axes = {} as HoneyAxes;
  for (const key of AXIS_KEYS) {
    const v = axesObj[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) return null;
    axes[key] = round2(v);
  }

  const unknown = Array.isArray(obj.unknown)
    ? obj.unknown.filter((x): x is AxisKey => AXIS_KEYS.includes(x as AxisKey))
    : [];
  const summary = Array.isArray(obj.summary)
    ? obj.summary.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, 3)
    : [];
  const concerns = Array.isArray(obj.concerns)
    ? obj.concerns.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : [];

  return { axes, unknown, summary, concerns };
}
