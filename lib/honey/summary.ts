/**
 * lib/honey/summary.ts — 강의 3줄 요약
 *
 * LLM 이 만든 3줄이 있으면 그걸 쓰고, 없으면 축·신뢰도에서 결정론적으로 생성한다.
 * 어느 쪽이든 "표본이 적다"는 사실은 반드시 한 줄을 차지한다.
 */

import type { HoneyAxes, ReliabilityVerdict } from '../types.ts';
import { AXIS_HIGHER_IS_SWEETER, AXIS_KEYS, AXIS_LABELS, type AxisKey } from './axes.ts';
import { FLAG_LABELS } from './reliability.ts';

/** 받침 유무에 따라 조사를 고른다 ("시험 난이도은" 같은 비문 방지) */
function withTopicParticle(word: string): string {
  const last = word.codePointAt(word.length - 1) ?? 0;
  const isHangulSyllable = last >= 0xac00 && last <= 0xd7a3;
  const hasFinal = isHangulSyllable && (last - 0xac00) % 28 !== 0;
  return `${word}${hasFinal ? '은' : '는'}`;
}

/** 축 값 → 3단계 언어 (정직성 규칙 1: 점 추정 금지) */
function level(value: number): 'high' | 'mid' | 'low' {
  if (value >= 0.62) return 'high';
  if (value <= 0.38) return 'low';
  return 'mid';
}

const PHRASES: Record<AxisKey, Record<'high' | 'mid' | 'low', string>> = {
  gradeGenerosity: { high: '학점은 후한 편', mid: '학점은 보통', low: '학점은 짠 편' },
  workload: { high: '과제 부담이 큼', mid: '과제는 보통', low: '과제 부담이 작음' },
  attendanceStrictness: { high: '출결이 엄격', mid: '출결은 보통', low: '출결이 느슨' },
  teachingQuality: { high: '강의력이 좋음', mid: '강의력은 보통', low: '강의력이 아쉬움' },
  examDifficulty: { high: '시험이 어려움', mid: '시험은 보통', low: '시험이 쉬운 편' },
};

/** 결정론적 3줄 요약 (LLM 폴백) */
export function buildHeuristicSummary(
  axes: HoneyAxes | null,
  reviewCount: number,
  reliability: ReliabilityVerdict,
): string {
  if (axes === null || reviewCount === 0) {
    return [
      '강의평이 아직 없어 이 강의는 판단할 수 없습니다.',
      '꿀강 지수도 계산하지 않았습니다.',
      '수강한 적이 있다면 강의평을 남겨주세요.',
    ].join('\n');
  }

  // 중앙(0.5)에서 가장 멀리 떨어진 축 2개 = 이 강의를 가장 잘 설명하는 특징
  const ranked = [...AXIS_KEYS].sort(
    (a, b) => Math.abs(axes[b] - 0.5) - Math.abs(axes[a] - 0.5),
  );
  const notable = ranked.filter((k) => level(axes[k]) !== 'mid').slice(0, 3);

  const line1 =
    notable.length > 0
      ? `${notable.map((k) => PHRASES[k][level(axes[k])]).join(', ')}.`
      : '뚜렷한 특징 없이 평범한 강의로 보입니다.';

  const sweetSpots = notable.filter((k) =>
    AXIS_HIGHER_IS_SWEETER[k] ? level(axes[k]) === 'high' : level(axes[k]) === 'low',
  );
  const painSpots = notable.filter((k) => !sweetSpots.includes(k));
  const line2 =
    sweetSpots.length > 0 && painSpots.length > 0
      ? `${withTopicParticle(AXIS_LABELS[sweetSpots[0]])} 장점이지만 ${withTopicParticle(AXIS_LABELS[painSpots[0]])} 감안해야 합니다.`
      : sweetSpots.length > 0
        ? `${sweetSpots.map((k) => AXIS_LABELS[k]).join('·')} 쪽에서 점수를 얻는 강의입니다.`
        : '전반적으로 부담이 있는 강의입니다.';

  const line3 =
    reliability.flags.length > 0
      ? `주의: ${reliability.flags.map((f) => FLAG_LABELS[f]).join(', ')} (강의평 ${reviewCount}건).`
      : `강의평 ${reviewCount}건 기준이며 특별한 편향 신호는 없습니다.`;

  return [line1, line2, line3].join('\n');
}

/** LLM 3줄이 쓸 만하면 그대로, 아니면 휴리스틱으로. */
export function pickSummary(
  llmSummary: string[] | undefined,
  axes: HoneyAxes | null,
  reviewCount: number,
  reliability: ReliabilityVerdict,
): string {
  if (llmSummary && llmSummary.length >= 2) {
    const lines = llmSummary.slice(0, 3).map((s) => s.trim()).filter(Boolean);
    if (lines.length >= 2) {
      // LLM 이 신뢰성 경고를 빠뜨렸으면 우리가 붙인다 — 이건 양보하지 않는다.
      if (reliability.flags.length > 0 && !lines.some((l) => l.includes('표본') || l.includes('적'))) {
        lines[lines.length - 1] =
          `${lines[lines.length - 1]} (주의: ${reliability.flags.map((f) => FLAG_LABELS[f]).join(', ')})`;
      }
      return lines.join('\n');
    }
  }
  return buildHeuristicSummary(axes, reviewCount, reliability);
}
