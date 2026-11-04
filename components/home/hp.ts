/* ==========================================================================
 *  components/home/hp.ts — 하트 = 출석 목숨
 * --------------------------------------------------------------------------
 *  하트는 분위기용 장식이 아니다. 전부 출결 장부에서 직접 나온 수다.
 *
 *    하트 총 개수 = allowedAbsences   (F 처리 기준 결석 한도)
 *    없어진 하트   = effectiveAbsences (지각 n회 = 결석 1회 규칙 적용분 포함)
 *    하트 0 개     = 출석 F 구간
 *
 *  그래서 "하트가 다 없어지면 F" 는 게임 규칙을 흉내 낸 비유가 아니고
 *  실제 학사 규정을 한 줄로 줄인 것이다. 반대로 출결 장부가 없는 과목은
 *  하트를 0 개로 그리지 않고 "셀 수 없음"으로 둔다 — 정직성 4원칙(모르면 흐리게).
 *
 *  계산 정본은 팀원1 엔진(lib/grade/balance.ts)이고 여기서 다시 세지 않는다.
 * ========================================================================== */

import type { Course } from '@/lib/types';
import { effectiveAbsences, isAttendanceFailure } from '@/lib/grade';

/** 하트가 얼마나 남았는지의 4단계. 색은 이 값에서만 나온다. */
export type HpLevel = 'ok' | 'watch' | 'risk' | 'fail';

export interface CourseHp {
  courseId: string;
  courseName: string;
  /** 하트 칸 수 = 결석 한도 */
  total: number;
  /** 남은 하트 (0.5 칸 단위 — 지각 환산분이 반 칸으로 보인다) */
  left: number;
  /** 뭉개지 않은 실제 남은 횟수 */
  leftExact: number;
  /** 유효 결석 횟수 (지각 환산 포함) */
  used: number;
  level: HpLevel;
  /** 한도를 이미 넘겼는가 — 이 경우 등급 예측 자체가 의미 없다 */
  failed: boolean;
}

/** 0.5 칸 단위로 뭉갠다. 하트는 눈으로 세는 것이라 1/2 보다 잘게 쪼개면 거짓말이 된다. */
function halves(x: number): number {
  return Math.round(Math.max(0, x) * 2) / 2;
}

/**
 * 과목 하나의 하트. 출결 장부가 없거나 한도가 0 이면 null —
 * "하트 0 개(=F)" 와 "하트를 셀 수 없음" 은 완전히 다른 상태라 섞지 않는다.
 */
export function courseHp(course: Course): CourseHp | null {
  const ledger = course.attendance;
  if (!ledger || ledger.allowedAbsences <= 0) return null;

  const used = effectiveAbsences(ledger);
  const leftExact = ledger.allowedAbsences - used;
  const failed = isAttendanceFailure(course);

  const level: HpLevel =
    failed || leftExact <= 0 ? 'fail'
    : leftExact <= 1 ? 'risk'
    : leftExact <= 2 ? 'watch'
    : 'ok';

  return {
    courseId: course.id,
    courseName: course.name,
    total: ledger.allowedAbsences,
    left: halves(leftExact),
    leftExact,
    used,
    level,
    failed,
  };
}

/** 등록한 과목 전체의 하트. 장부 없는 과목은 빠진다. */
export function allHp(courses: Course[]): CourseHp[] {
  return courses
    .map(courseHp)
    .filter((h): h is CourseHp => h !== null)
    .sort((a, b) => a.leftExact - b.leftExact || a.total - b.total);
}

/**
 * 캐릭터 체력으로 쓸 과목 = 제일 아슬아슬한 과목.
 * 평균을 내지 않는다. F 는 과목별로 떨어지는 것이라 평균이 가리키는 대상이 없다.
 */
export function weakestHp(courses: Course[]): CourseHp | null {
  return allHp(courses)[0] ?? null;
}

export const HP_COLOR: Record<HpLevel, string> = {
  ok: 'var(--e-good)',
  watch: 'var(--e-warn)',
  risk: 'var(--e-serious)',
  fail: 'var(--e-critical)',
};

export const HP_WORD: Record<HpLevel, string> = {
  ok: '여유 있음',
  watch: '슬슬 아낄 때',
  risk: 'F 바로 앞',
  fail: '한도 초과',
};

/** 1.5 는 1.5 로, 2 는 2 로. 2.0 같은 false precision 을 만들지 않는다. */
export function heartCount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
