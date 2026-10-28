/**
 * lib/honey/pipeline.ts — 강의평 → Lecture 조립 (축 추출 → 신뢰성 → 축소 → 요약)
 *
 * scripts/score-lectures.ts(빌드 타임, LLM 사용 가능) 와
 * lib/honey/store.ts(런타임 폴백, 항상 휴리스틱) 가 같은 함수를 공유한다.
 */

import type { HoneyAxes, Lecture, LectureReview } from '../types.ts';
import { extractAxesHeuristic, type LlmLectureAnalysis } from './axes.ts';
import { assessReliability } from './reliability.ts';
import { shrinkToNeutral } from './score.ts';
import { pickSummary } from './summary.ts';

/** 강의 메타 (data/reviews.seed.json 의 lectures 배열) */
export interface LectureMeta {
  id: string;
  name: string;
  professor: string;
  department: string;
  credits: number;
  type: Lecture['type'];
  professorChanged?: boolean;
}

/** UI 배지로 그대로 쓰이는 출처 문구. 시드임을 숨기지 않는다. */
export const SEED_PROVENANCE = '데이터 출처: 시드(가상) 강의평 — 실제 수집 데이터가 아닙니다';
export const HEURISTIC_PROVENANCE = '축 추출: 키워드 휴리스틱 (LLM 미사용)';
export const LLM_PROVENANCE = '축 추출: LLM 분석';

export interface BuildLectureOptions {
  currentYear: number;
  /** 강의 id → LLM 분석 결과. 없으면 전부 휴리스틱. */
  llmById?: Record<string, LlmLectureAnalysis | undefined>;
  /** reasons 맨 앞에 붙일 출처 문구 */
  provenanceNotes?: string[];
}

export function buildLecture(
  meta: LectureMeta,
  reviews: LectureReview[],
  options: BuildLectureOptions,
): Lecture {
  const llm = options.llmById?.[meta.id];
  const heuristic = extractAxesHeuristic(reviews);

  let axes: HoneyAxes | null = null;
  const provenance = [...(options.provenanceNotes ?? [])];

  if (reviews.length > 0) {
    if (llm) {
      axes = { ...llm.axes };
      // LLM 이 "모르겠다"고 한 축은 0.5 로 되돌린다 (지어낸 숫자 금지)
      for (const key of llm.unknown) axes[key] = 0.5;
      provenance.push(LLM_PROVENANCE);
    } else {
      axes = heuristic.axes;
      provenance.push(HEURISTIC_PROVENANCE);
    }
  }

  const reliability = assessReliability({
    reviews,
    currentYear: options.currentYear,
    professorChanged: meta.professorChanged,
    llmConcerns: llm?.concerns,
    provenanceNotes: provenance,
  });

  const shrunk = shrinkToNeutral(axes, reviews.length, reliability);
  const avgRating =
    reviews.length > 0
      ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 100) / 100
      : null;

  return {
    id: meta.id,
    name: meta.name,
    professor: meta.professor,
    department: meta.department,
    credits: meta.credits,
    type: meta.type,
    reviewCount: reviews.length,
    avgRating,
    axes,
    reliability,
    honeyScore: shrunk.honeyScore,
    summary: pickSummary(llm?.summary, axes, reviews.length, reliability),
  };
}

export function buildAllLectures(
  metas: LectureMeta[],
  reviews: LectureReview[],
  options: BuildLectureOptions,
): Lecture[] {
  const byLecture = new Map<string, LectureReview[]>();
  for (const r of reviews) {
    const list = byLecture.get(r.lectureId);
    if (list) list.push(r);
    else byLecture.set(r.lectureId, [r]);
  }
  // 최신 학기가 위로 오도록 정렬해 두면 LLM 프롬프트 잘림도 최신 우선이 된다
  for (const list of byLecture.values()) {
    list.sort((a, b) => String(b.semester).localeCompare(String(a.semester)));
  }
  return metas.map((meta) => buildLecture(meta, byLecture.get(meta.id) ?? [], options));
}
