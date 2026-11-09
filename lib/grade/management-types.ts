import type { Assessment, Course } from '../types.ts';
import type { AttendanceCalculation, AttendanceManagement, SimpleAttendance } from './attendance-types.ts';

/** Actual records only. Hypothetical scores belong in a separate scenario copy. */
export type AssessmentProgress =
  | { status: 'scheduled' }
  | { status: 'awaiting_grade' }
  | { status: 'graded'; score: number }
  | { status: 'zero_confirmed'; reason: 'absent' | 'not_submitted' };

/** null is migration uncertainty, NOT a fifth assessment progress state. */
export interface AssignmentTask {
  id: string;
  name: string;
  maxScore: number;
  progress: AssessmentProgress;
  /** Share within the assignment group (0..1), not the final course weight. */
  weight: number | null;
}

export interface AssignmentGroup {
  allocation: 'unconfirmed' | 'equal' | 'individual';
  /** Count is derived from this array; no second count field can drift out of sync. */
  tasks: AssignmentTask[];
}

export type ManagedAssessment = Omit<Assessment, 'myScore'> & {
  /** When present, tasks are authoritative; the parent progress is an archived single score. */
  assignmentGroup?: AssignmentGroup;
} & (
  | { progress: AssessmentProgress; reviewRequired?: never }
  | { progress: null; reviewRequired: 'legacy_null_score' }
);

export type ManagedCourse = Omit<Course, 'assessments'> & {
  gradingPolicy?: {
    kind: 'unknown'|'relative1'|'relative2'|'relative3'|'absolute'|'pass_fail';
    source: 'official'|'custom'|'unconfirmed';
    presetVersion: 'erica-2026-11-07';
    absoluteCutoffs?: Partial<Record<'A+'|'A0'|'B+'|'B0'|'C+'|'C0'|'D+'|'D0',number>>;
    relativeCaps?: { a:number; ab:number };
    passScore?:number;
  };
  assessments: ManagedAssessment[];
  /** Explicit opt-in; legacy attendance and direct scores remain archived unchanged. */
  attendanceManagement?: AttendanceManagement;
  /** Explicit opt-in. Old rules/scores remain archived and are not applied twice. */
  simpleAttendance?: SimpleAttendance;
  /** One attendance workflow; the assessment ID is independent of its display name. */
  attendanceEstimate?: {
    /** Versioned app rule, not a verified instructor policy; totalSessions defaults to 15. */
    model: 'equal-15-v1'; assessmentId: string | null; absences: number; lateness: number;
    /** A manual null is intentional and must never trigger name-based relinking. */
    selection?: 'manual';
    /** Missing in older v2 documents means the original 15-session assumption. */
    totalSessions?: number;
    /** Previously confirmed contribution, preserved on explicit legacy conversion. */
    confirmed?: { weight: number; secured: number; lost: number; ungraded: number; finalDeduction: number | null };
  };
  /** Optional UX metadata; absent legacy values stay unknown. No calculation defaults. */
  semester?: string;
  /** Explicit course-specific absolute cutoffs only; never default to an invented scale. */
  absoluteTargets?: Partial<Record<'A+' | 'A0' | 'B+' | 'B0', number>>;
  attendancePreferences?: { checked: 'yes' | 'no' | 'unknown'; scored: 'yes' | 'no' | 'unknown'; eligibility: 'yes' | 'no' | 'unknown' };
  /** Counts without a confirmed timetable/rules. Never used to manufacture deductions. */
  attendanceNotes?: { absences: number; lateness: number; excused: number };
};

export interface FourAreaBalance {
  secured: number;
  lost: number;
  ungraded: number;
  remaining: number;
}

export interface ManagedBalance {
  balance: FourAreaBalance;
  totalPoints: number;
  complete: boolean;
  items: { assessmentId: string; balance: FourAreaBalance; unclassifiedPoints: number; complete: boolean }[];
  attendance?: AttendanceCalculation;
  /** Gross assessment allocation above excludes this independent final-grade deduction. */
  finalDeduction?: number | null;
  netFinalScore?: number | null;
  review: {
    assessmentIds: string[];
    /** Accounting diagnostic, not part of ungraded or remaining. */
    unclassifiedPoints: number;
    /** Legacy ledger is retained but not applied by this assessment-only calculator. */
    attendanceLedgerPreserved: boolean;
  };
}

export type ManagementResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export interface ManagedCoursesDocument {
  version: 2;
  courses: ManagedCourse[];
}
