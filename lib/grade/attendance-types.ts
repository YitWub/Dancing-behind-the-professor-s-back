import type { FourAreaBalance } from './management-types.ts';

export type ExcusedRecognition = 'unconfirmed' | 'recognized' | 'as_absence';
export type LateRecognition =
  | { kind: 'unconfirmed' }
  | { kind: 'ignored' }
  | { kind: 'bundled' | 'proportional'; perAbsence: number };
export type AttendancePenalty =
  | { kind: 'unconfirmed' }
  | { kind: 'attendance_points' | 'final_points'; pointsPerAbsence: number };
export type AttendanceLatePenalty = Exclude<LateRecognition, { kind: 'ignored' }>
  | { kind: 'separate'; pointsPerLate: number };

export interface SimpleAttendance {
  mode: 'off' | 'record_only' | 'scored';
  assessmentId: string | null;
  records: { absences: number; lateness: number; excused: number };
  penalty: AttendancePenalty | { kind: 'weighted_points'; pointsPerAbsence: number };
  rawMaxScore: number;
  latePenalty: AttendanceLatePenalty;
  excusedForScore: ExcusedRecognition;
  /** Explicit user confirmation; never inferred from unrecorded classes. */
  finalized: boolean;
  eligibility: AttendanceManagement['eligibility'];
  totalSessions: number | null;
}

export interface AttendanceManagement {
  /** One explicit reference, no name/ceiling heuristic. null supports eligibility-only courses. */
  assessmentId: string | null;
  records: {
    total: number; held: number; absences: number; lateness: number; excused: number;
  };
  /** All three event counts are mutually exclusive; excused is NOT part of absences. */
  penalty: AttendancePenalty;
  /** Optional explicit raw scoring scale; archived assessment scores keep their old scale. */
  rawMaxScore?: number;
  latePenalty: AttendanceLatePenalty;
  excusedForScore: ExcusedRecognition;
  allocation: 'unconfirmed' | 'term_end' | 'per_session_equal';
  eligibility: {
    rule: { kind: 'unconfirmed' }
      | { kind: 'max_absences'; allowed: number; failureAt: 'exceeds' | 'reaches' }
      | { kind: 'minimum_ratio'; minimum: number };
    unit: 'sessions' | 'hours';
    excused: ExcusedRecognition;
    late: LateRecognition;
    /** Actual recognized hours, already incorporating the course's excused/late policy. */
    hours: { total: number; held: number; credited: number; recognitionConfirmed: boolean } | null;
  };
}

export interface AttendanceScore {
  balance: FourAreaBalance;
  unclassifiedPoints: number;
  known: boolean;
  complete: boolean;
  effectiveAbsences: number | null;
  rawDeduction: number | null;
  internalDeduction: number | null;
  /** Never capped at the attendance weight and never silently folded into another item. */
  finalDeduction: number | null;
  finalRawScore: number | null;
  messages: string[];
}

export interface AttendanceEligibility {
  status: 'normal' | 'risk' | 'failed' | 'needs_review';
  phase: 'in_progress' | 'complete';
  finalStatus: 'not_final' | 'eligible' | 'failed' | 'needs_review';
  effectiveAbsences: number | null;
  currentRatio: number | null;
  bestFinalRatio: number | null;
  unrecoverable: boolean;
  messages: string[];
}

export interface AttendanceCalculation {
  score: AttendanceScore;
  eligibility: AttendanceEligibility;
}
