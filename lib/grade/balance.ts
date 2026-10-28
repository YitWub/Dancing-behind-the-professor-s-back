/**
 * lib/grade/balance.ts — 학점 잔고 (회의록 4-1)
 *
 * 과목마다 ①이미 확보한 점수 ②이미 잃은 점수 ③남은 배점 을 잔고처럼 관리한다.
 * 출석 한 번 빠지면 잔고에서 즉시 차감되고 예상 등급이 그 자리에서 움직인다.
 *
 * 이 모델의 구조적 이점(회의록 4-1): 출결 트래커 단독은 "기본값=출석"이라
 * 결석 입력을 잊으면 잔고를 위험한 방향으로 과대 표시한다. 그런데 "째도 되나"를
 * 조회하려면 잔고가 최신이어야 하므로, 조회 니즈가 입력을 견인해 결함이 자동 해소된다.
 *
 * 모든 수치는 환산점수(0~100) 척도다.
 */

import type { AttendanceLedger, Course, EngineWarning, GradeBalance } from '@/lib/types';
import {
  CONVERTED_MAX,
  convertedGain,
  convertedLoss,
  convertedRemaining,
  partitionAssessments,
} from './ceiling.ts';

export interface AttendanceDetail {
  /** 지각을 결석으로 환산해 합산한 유효 결석 횟수 */
  effectiveAbsences: number;
  /** 한도까지 남은 횟수 */
  remainingAllowed: number;
  /** 출결 규칙으로 계산한 환산점수 감점 */
  ledgerLoss: number;
  /**
   * 잔고에 실제로 반영했는가.
   * 천장 밀집 요소(출석 등)에 이미 점수가 입력돼 있으면 이중 차감이 되므로 반영하지 않는다.
   * 사용자가 출석 점수를 직접 넣었다면 그 값이 더 확정적인 정보다.
   */
  applied: boolean;
}

export interface BalanceDetail extends GradeBalance {
  attendance: AttendanceDetail | null;
  warnings: EngineWarning[];
}

/** 지각 n회 = 결석 1회 규칙을 적용한 유효 결석 */
export function effectiveAbsences(ledger: AttendanceLedger): number {
  const fromLate = ledger.latePerAbsence > 0 ? ledger.lateness / ledger.latePerAbsence : 0;
  return ledger.absences + fromLate;
}

export function computeBalance(course: Course): BalanceDetail {
  const warnings: EngineWarning[] = [];

  let secured = 0;
  let lost = 0;
  let remaining = 0;
  for (const a of course.assessments) {
    secured += convertedGain(a);
    lost += convertedLoss(a);
    remaining += convertedRemaining(a);
  }

  let attendance: AttendanceDetail | null = null;

  if (course.attendance) {
    const ledger = course.attendance;
    const eff = effectiveAbsences(ledger);
    const ledgerLoss = eff * ledger.penaltyPerAbsence;

    // 이중 차감 방지: 출석·과제 같은 천장 밀집 요소에 이미 점수가 들어와 있으면
    // 그 점수에 결석분이 이미 반영돼 있다고 본다.
    const { ceiling } = partitionAssessments(course.assessments);
    const alreadyScored = ceiling.some((a) => a.myScore !== null);
    const applied = !alreadyScored && ledgerLoss > 0;

    if (applied) {
      // 출석 배점은 아직 remaining에 묶여 있으므로 remaining → lost 로 옮긴다
      let toDeduct = ledgerLoss;
      const fromRemaining = Math.min(toDeduct, remaining);
      remaining -= fromRemaining;
      toDeduct -= fromRemaining;
      const fromSecured = Math.min(toDeduct, secured);
      secured -= fromSecured;
      toDeduct -= fromSecured;
      lost += ledgerLoss - toDeduct; // 실제로 차감 가능했던 만큼만
    }

    const remainingAllowed = ledger.allowedAbsences - eff;
    attendance = { effectiveAbsences: eff, remainingAllowed, ledgerLoss, applied };

    if (remainingAllowed <= 0) {
      warnings.push({
        code: 'ATTENDANCE_RISK',
        message: `유효 결석 ${fmt(eff)}회로 한도(${ledger.allowedAbsences}회)를 넘었습니다. 등급 예측보다 F 처리 여부를 먼저 확인하세요.`,
      });
    } else if (remainingAllowed <= 1) {
      warnings.push({
        code: 'ATTENDANCE_RISK',
        message: `유효 결석 ${fmt(eff)}회 — 한도(${ledger.allowedAbsences}회)까지 ${fmt(remainingAllowed)}회 남았습니다. 이번 주 결석은 F 위험에 직접 닿습니다.`,
      });
    }

    if (!applied && ledgerLoss > 0) {
      // 침묵하면 사용자는 결석이 반영된 줄 안다. 어느 쪽을 썼는지 밝힌다.
      warnings.push({
        code: 'ATTENDANCE_RISK',
        message: `출석 점수가 직접 입력돼 있어 출결 장부의 감점(${fmt(ledgerLoss)}점)은 중복 차감하지 않았습니다. 입력한 출석 점수를 기준으로 계산합니다.`,
      });
    }
  }

  return {
    secured: round2(secured),
    lost: round2(lost),
    remaining: round2(Math.max(0, remaining)),
    attendance,
    warnings,
  };
}

/** 결석 한도를 넘겨 F가 확정적인 상태인가 — 등급 예측을 하면 안 되는 케이스 */
export function isAttendanceFailure(course: Course): boolean {
  if (!course.attendance) return false;
  return effectiveAbsences(course.attendance) > course.attendance.allowedAbsences;
}

/** what-if용: 결석·지각을 추가한 장부 사본 */
export function withExtraAttendance(
  ledger: AttendanceLedger,
  extraAbsences: number,
  extraLateness = 0,
): AttendanceLedger {
  return {
    ...ledger,
    absences: ledger.absences + extraAbsences,
    lateness: ledger.lateness + extraLateness,
  };
}

/** 확보 + 남은 배점의 상한 = 이론상 최대 환산점수 */
export function ceilingScore(balance: GradeBalance): number {
  return Math.min(CONVERTED_MAX, balance.secured + balance.remaining);
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function fmt(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}
