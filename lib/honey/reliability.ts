/**
 * lib/honey/reliability.ts — 별점 평균을 그냥 믿으면 안 되는 이유를 판정한다
 *
 * 이 앱에서 가장 중요한 파일입니다. 꿀강 순위는 "평점이 높은 강의"가 아니라
 * "평점이 높다고 믿을 만한 강의" 순이어야 합니다.
 *
 * 5가지 신호 (lib/types.ts 의 ReliabilityVerdict.flags)
 *   SMALL_SAMPLE       표본이 적다
 *   POLARIZED          극단 리뷰(1~2점 / 4~5점)만 몰려 있다 — 평균이 아무도 대표하지 못함
 *   STALE              최근 2년 강의평이 없다
 *   PROFESSOR_CHANGED  교수가 바뀌었다 — 옛 강의평은 다른 강의에 대한 평가
 *   SELF_SELECTION     학점 잘 받은 사람만 썼다 — 상방 편향
 *
 * 각 신호는 신뢰도 점수(0~1)에 곱셈으로 반영된다. 곱셈이라 신호가 겹치면
 * 신뢰도가 빠르게 떨어지고, score.ts 의 축소(shrinkage)가 그만큼 세게 걸린다.
 */

import type { Confidence, GradeLetter, LectureReview, ReliabilityVerdict, Semester } from '../types.ts';

export type ReliabilityFlag = ReliabilityVerdict['flags'][number];

/* ── 임계치 (근거는 lib/honey/README.md) ─────────────────────────────────── */

/** 이 미만이면 SMALL_SAMPLE */
export const SMALL_SAMPLE_N = 8;
/** 표본 신뢰도 곡선의 반감 상수: n/(n+SAMPLE_HALF) */
export const SAMPLE_HALF = 4;
/** 최근성 기준 — 이 학기 수보다 오래되면 STALE */
export const STALE_YEARS = 2;
/** POLARIZED: 양 극단 비중 합이 이 값 이상이면서 양쪽 꼬리가 각각 MIN_TAIL 이상 */
export const POLARIZED_EXTREME_SHARE = 0.8;
export const POLARIZED_MIN_TAIL = 0.25;
/** SELF_SELECTION: 학점을 밝힌 사람 중 A 계열 비중이 이 값 이상 */
export const SELF_SELECTION_A_SHARE = 0.7;
export const SELF_SELECTION_MIN_DISCLOSED = 5;

const PENALTY: Record<ReliabilityFlag, number> = {
  SMALL_SAMPLE: 1, // 표본은 아래 sampleFactor 로 연속 반영하므로 여기선 1(중복 감점 방지)
  POLARIZED: 0.8,
  STALE: 0.75,
  PROFESSOR_CHANGED: 0.7,
  SELF_SELECTION: 0.85,
};

const A_GRADES: GradeLetter[] = ['A+', 'A0'];

/* ── 유틸 ───────────────────────────────────────────────────────────────── */

function semesterYear(s: Semester): number {
  const y = Number.parseInt(String(s).slice(0, 4), 10);
  return Number.isFinite(y) ? y : 0;
}

/* ── 판정 ───────────────────────────────────────────────────────────────── */

export interface ReliabilityInput {
  reviews: LectureReview[];
  /** 기준 연도 (보통 현재 연도). 결정론적 빌드를 위해 명시적으로 받는다. */
  currentYear: number;
  /** 시드/메타에서 알려진 교수 변경 이력 */
  professorChanged?: boolean;
  /** LLM 이 추가로 지적한 우려 사항 (axes.ts 의 concerns) */
  llmConcerns?: string[];
  /** 데이터 출처를 reasons 맨 앞에 붙인다 (UI 배지에 그대로 쓰임) */
  provenanceNotes?: string[];
}

export function assessReliability(input: ReliabilityInput): ReliabilityVerdict {
  const { reviews, currentYear, professorChanged = false } = input;
  const n = reviews.length;

  const flags: ReliabilityFlag[] = [];
  const reasons: string[] = [...(input.provenanceNotes ?? [])];

  if (n === 0) {
    return {
      score: 0,
      band: 'low',
      reasons: [...reasons, '강의평이 아직 없습니다 — 꿀강 지수를 계산할 수 없습니다'],
      flags: ['SMALL_SAMPLE'],
    };
  }

  /* ① 표본 크기 — 연속 함수로 반영 */
  const sampleFactor = n / (n + SAMPLE_HALF);
  if (n < SMALL_SAMPLE_N) {
    flags.push('SMALL_SAMPLE');
    reasons.push(`표본 ${n}건 — 평균을 신뢰하기엔 적습니다`);
  }

  /* ② 극단 분포 */
  const low = reviews.filter((r) => r.rating <= 2).length / n;
  const high = reviews.filter((r) => r.rating >= 4).length / n;
  if (low + high >= POLARIZED_EXTREME_SHARE && low >= POLARIZED_MIN_TAIL && high >= POLARIZED_MIN_TAIL) {
    flags.push('POLARIZED');
    reasons.push(
      `호불호가 갈립니다 — 1~2점 ${Math.round(low * 100)}% / 4~5점 ${Math.round(high * 100)}%. 평균이 아무도 대표하지 못합니다`,
    );
  }

  /* ③ 최근성 */
  const latestYear = Math.max(...reviews.map((r) => semesterYear(r.semester)));
  const age = currentYear - latestYear;
  if (age >= STALE_YEARS) {
    flags.push('STALE');
    reasons.push(`최근 강의평이 ${latestYear}년입니다 — 지금과 다를 수 있습니다`);
  }

  /* ④ 교수 변경 */
  if (professorChanged) {
    flags.push('PROFESSOR_CHANGED');
    reasons.push('교수 변경 이력이 있습니다 — 이전 학기 강의평은 다른 강의에 대한 평가입니다');
  }

  /* ⑤ 자기선택 편향 */
  const disclosed = reviews.filter((r) => r.reportedGrade !== null);
  if (disclosed.length >= SELF_SELECTION_MIN_DISCLOSED) {
    const aShare = disclosed.filter((r) => A_GRADES.includes(r.reportedGrade as GradeLetter)).length / disclosed.length;
    if (aShare >= SELF_SELECTION_A_SHARE) {
      flags.push('SELF_SELECTION');
      reasons.push(
        `학점을 밝힌 ${disclosed.length}명 중 ${Math.round(aShare * 100)}%가 A 계열입니다 — 잘 받은 사람만 썼을 가능성(상방 편향)`,
      );
    }
  }

  /* LLM 이 본 추가 우려 (점수에는 반영하지 않고 근거로만 노출 — 근거 없는 감점 금지) */
  for (const concern of input.llmConcerns ?? []) {
    if (!reasons.includes(concern)) reasons.push(`LLM 지적: ${concern}`);
  }

  let score = sampleFactor;
  for (const flag of flags) score *= PENALTY[flag];
  score = Math.min(1, Math.max(0, score));

  if (flags.length === 0) {
    reasons.push(`강의평 ${n}건, 특별한 편향 신호 없음`);
  }

  return {
    score: Math.round(score * 100) / 100,
    band: toBand(score),
    reasons,
    flags,
  };
}

export function toBand(score: number): Confidence {
  if (score >= 0.7) return 'high';
  if (score >= 0.45) return 'medium';
  return 'low';
}

export const BAND_LABELS: Record<Confidence, string> = {
  high: '신뢰도 높음',
  medium: '신뢰도 보통',
  low: '신뢰도 낮음 — 참고용',
};

export const FLAG_LABELS: Record<ReliabilityFlag, string> = {
  SMALL_SAMPLE: '표본 부족',
  POLARIZED: '호불호 갈림',
  STALE: '오래된 강의평',
  PROFESSOR_CHANGED: '교수 변경',
  SELF_SELECTION: '상방 편향 의심',
};
