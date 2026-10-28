/* ==========================================================================
 *  components/format.ts — 정직성 6원칙의 "출력 게이트"
 * --------------------------------------------------------------------------
 *  화면에 숫자를 쓰는 길은 전부 이 파일을 거친다. 목 데이터가 실제 엔진으로
 *  교체돼도 이 파일은 그대로 남는다. (mock.ts 와 달리 갈아끼우는 대상이 아님)
 *
 *  규칙 1 점 추정 금지  → pctBucket(): 10% 단위로 뭉갠다
 *  규칙 2 누적 표현      → atLeastText(): "A0 이상일 확률"
 *  규칙 3 false precision 금지 → bandLabel() / 소수점 노출 API 자체를 안 둔다
 *  규칙 6 경계선 고백    → isCoinFlip()
 * ========================================================================== */

import type {
  Cafeteria,
  Confidence,
  GradeLetter,
  ImpactBand,
  Lecture,
  MealTime,
  ReliabilityVerdict,
} from '@/lib/types';
// 라벨의 정본은 팀원2의 순수 모듈이다. 화면에서 따로 번역어를 만들면 갈라진다.
// (셋 다 node:fs 를 안 쓰는 클라이언트 안전 모듈 — CONTRACT.md 6장)
import { BAND_LABELS, FLAG_LABELS } from '@/lib/honey/reliability';
import { SHRINKAGE_K, honeyBandLabel } from '@/lib/honey/score';
import { CAFETERIA_LABELS } from '@/lib/meal/battle';

/* ── 규칙 1: 확률은 10% 단위로만 ─────────────────────────────────────────── */

/** 0~1 확률을 10% 단위 정수로 뭉갠다. 67.4% 같은 건 화면에 못 나간다. */
export function pctBucket(p: number): number {
  const clamped = Math.min(1, Math.max(0, p));
  return Math.round(clamped * 10) * 10;
}

/** 규칙 1 + 3. 확률은 항상 "약 70%" 꼴. 0%/100% 는 단정이므로 쓰지 않는다. */
export function pctText(p: number): string {
  const b = pctBucket(p);
  if (b <= 0) return '거의 없음';
  if (b >= 100) return '거의 확실';
  return `약 ${b}%`;
}

/** 규칙 1의 3단계 언어 버전. 숫자를 쓰기 애매한 자리에 쓴다. */
export function pctPhrase(p: number): string {
  if (p >= 0.85) return '거의 확실';
  if (p >= 0.65) return '가능성 높음';
  if (p > 0.35) return '반반';
  if (p > 0.15) return '가능성 낮음';
  return '사실상 어려움';
}

/** 규칙 6. 경계선(동전던지기) 여부. 이 구간은 반드시 고백한다. */
export function isCoinFlip(p: number): boolean {
  return p > 0.4 && p < 0.6;
}

/** 규칙 2. 누적 표현 강제 — "A0 55%" 가 아니라 "A0 이상일 확률". */
export function atLeastText(grade: GradeLetter): string {
  return `${grade} 이상일 확률`;
}

/* ── 규칙 3: 숫자 대신 구간 ──────────────────────────────────────────────── */

/** 변별 기여도. 여기서 % 를 절대 만들지 않는다 — 애초에 숫자를 받지 않는다. */
export function bandLabel(band: ImpactBand): string {
  switch (band) {
    case 'decisive':
      return '사실상 결정';
    case 'supporting':
      return '거들기';
    case 'negligible':
      return '영향 거의 없음';
  }
}

export function bandTone(band: ImpactBand): 'strong' | 'mid' | 'weak' {
  return band === 'decisive' ? 'strong' : band === 'supporting' ? 'mid' : 'weak';
}

export function confidenceLabel(c: Confidence): string {
  return BAND_LABELS[c];
}

/* ── 꿀강 신뢰도 ─────────────────────────────────────────────────────────── */

/** 칩에 박는 짧은 라벨. 정본은 lib/honey 쪽 FLAG_LABELS. */
export function flagChip(flag: ReliabilityVerdict['flags'][number]): string {
  return FLAG_LABELS[flag];
}

/** 칩만으로는 왜 깎였는지 모른다. 펼쳤을 때 보여줄 긴 설명. */
export function flagText(flag: ReliabilityVerdict['flags'][number]): string {
  switch (flag) {
    case 'SMALL_SAMPLE':
      return '강의평 수가 적어 평균이 쉽게 흔들립니다';
    case 'POLARIZED':
      return '극찬과 혹평으로 갈려 평균이 가운데를 가리키지 않습니다';
    case 'STALE':
      return '최근 강의평이 없어 지금 학기와 다를 수 있습니다';
    case 'PROFESSOR_CHANGED':
      return '담당 교수가 바뀐 이력이 있어 과거 평이 그대로 적용되지 않습니다';
    case 'SELF_SELECTION':
      return '만족한 사람만 쓴 흔적이 있어 점수가 위로 치우칩니다';
  }
}

/** 신뢰도가 낮으면 점수 자체를 흐린다. 표본 4건짜리가 1위로 뜨는 걸 막는 잠금장치. */
export function shouldBlurScore(r: ReliabilityVerdict): boolean {
  return r.band === 'low';
}

/** "표본 4건 — 참고용" 배지 문구. */
export function sampleBadge(reviewCount: number, r: ReliabilityVerdict): string | null {
  if (r.band === 'high') return null;
  return `표본 ${reviewCount}건 — ${r.band === 'low' ? '참고용' : '해석 주의'}`;
}

/**
 * 원점수가 중앙(50) 쪽으로 얼마나 당겨졌는지. lib/honey/score.ts 의 공식 그대로다.
 * Lecture 타입이 shrinkAmount 를 안 실어보내서 화면에서 되살린다.
 * (조율자에게 Lecture 에 shrinkAmount 를 넣어달라고 요청해 둠)
 */
export function shrinkAmountOf(l: Lecture): number {
  if (l.honeyScore == null || l.reviewCount === 0) return 1;
  const effectiveN = l.reviewCount * l.reliability.score;
  return SHRINKAGE_K / (effectiveN + SHRINKAGE_K);
}

/** 규칙 1: 꿀강지수는 숫자만 크게 띄우지 않고 항상 이 문구와 같이 나간다. */
export function honeyScoreCaption(l: Lecture): string {
  return honeyBandLabel(l.honeyScore, shrinkAmountOf(l));
}

/** 시드(가상) 데이터 고지. reliability.reasons 에 박혀 오는 걸 그대로 쓴다. */
export function seedDisclaimer(l: Lecture): string | null {
  return l.reliability.reasons.find((r) => r.includes('시드')) ?? null;
}

/* ── 라벨 ────────────────────────────────────────────────────────────────── */

export function cafeteriaLabel(c: Cafeteria): string {
  return CAFETERIA_LABELS[c];
}

export function cafeteriaShort(c: Cafeteria): string {
  switch (c) {
    case 'haksik':
      return '학식';
    case 'changbo':
      return '창보';
    case 'dorm':
      return '인재원';
    case 'faculty':
      return '교직원';
  }
}

export function mealTimeLabel(m: MealTime): string {
  switch (m) {
    case 'breakfast':
      return '조식';
    case 'lunch':
      return '중식';
    case 'dinner':
      return '석식';
  }
}

export const MEAL_TIMES: MealTime[] = ['breakfast', 'lunch', 'dinner'];

export const GRADE_ORDER: GradeLetter[] = [
  'A+', 'A0', 'B+', 'B0', 'C+', 'C0', 'D+', 'D0', 'F',
];

/* ── 날짜 ────────────────────────────────────────────────────────────────── */

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function shiftDate(s: string, days: number): string {
  const d = parseISODate(s);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function humanDate(s: string): string {
  const d = parseISODate(s);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
}

/** 점수는 정수로. 소수점 두 자리 환산점수는 false precision 이다. */
export function score(n: number): string {
  return String(Math.round(n));
}

/** 학점 평점만 예외적으로 소수 2자리 (GPA 는 원래 그 단위로 쓰는 값) */
export function gpa(n: number): string {
  return n.toFixed(2);
}
