import type { ManagedCourse, ManagementResult } from './management-types.ts';
import type { AttendanceCalculation, AttendanceEligibility, AttendanceManagement, AttendanceScore, LateRecognition } from './attendance-types.ts';
import { computeSimpleAttendance, validateSimpleAttendance } from './simple-attendance.ts';

const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const count = (v: unknown): v is number => finite(v) && Number.isSafeInteger(v) && v >= 0;
const positive = (v: unknown): v is number => finite(v) && v > 0;
const recognition = (v: unknown) => ['unconfirmed', 'recognized', 'as_absence'].includes(v as string);
const EPS = 1e-10;
const empty = () => ({ secured: 0, lost: 0, ungraded: 0, remaining: 0 });

function validateLate(v: unknown, scoring: boolean): string[] {
  if (!record(v)) return ['지각 처리 규칙을 확인해 주세요.'];
  if (v.kind === 'unconfirmed' || (!scoring && v.kind === 'ignored')) return [];
  if (v.kind === 'bundled' || v.kind === 'proportional') return count(v.perAbsence) && v.perAbsence > 0 ? [] : ['지각 환산 N은 양의 정수여야 합니다.'];
  if (scoring && v.kind === 'separate') return finite(v.pointsPerLate) && v.pointsPerLate >= 0 ? [] : ['지각당 별도 감점은 0 이상의 숫자여야 합니다.'];
  return ['지원하지 않는 지각 규칙입니다.'];
}

export function validateAttendanceManagement(value: unknown, assessments: unknown): string[] {
  if (!record(value)) return ['출석 관리 설정 형식이 올바르지 않습니다.'];
  const errors: string[] = [];
  const r = value.records;
  if (!record(r) || !count(r.total) || r.total === 0 || !count(r.held) || !count(r.absences) || !count(r.lateness) || !count(r.excused)) errors.push('총·진행·결석·지각·공결 횟수는 0 이상의 정수이고 총 횟수는 0보다 커야 합니다.');
  else {
    if (r.held > r.total) errors.push('진행 횟수는 총 수업 횟수를 초과할 수 없습니다.');
    if (r.absences + r.lateness + r.excused > r.held) errors.push('결석·지각·공결은 별도 기록입니다. 세 횟수의 합은 진행 횟수를 초과할 수 없습니다.');
  }
  const linked = Array.isArray(assessments) ? assessments.find((a) => record(a) && a.id === value.assessmentId) : null;
  if (value.assessmentId !== null && (typeof value.assessmentId !== 'string' || !record(linked))) errors.push('이 과목에 속한 출석 평가항목을 선택해 주세요.');
  if (record(linked) && 'assignmentGroup' in linked) errors.push('과제 그룹을 출석 항목으로 연결할 수 없습니다.');
  const p = value.penalty;
  if (!record(p) || !['unconfirmed', 'attendance_points', 'final_points'].includes(p.kind as string)) errors.push('출석 감점 규칙을 확인해 주세요.');
  else if (p.kind !== 'unconfirmed' && (!finite(p.pointsPerAbsence) || p.pointsPerAbsence < 0)) errors.push('결석당 감점은 0 이상의 숫자여야 합니다.');
  if (record(p) && p.kind === 'attendance_points' && value.assessmentId === null) errors.push('출석 원점수 감점에는 연결된 평가항목이 필요합니다.');
  if ('rawMaxScore' in value && !positive(value.rawMaxScore)) errors.push('출석 원점수 만점은 0보다 커야 합니다.');
  errors.push(...validateLate(value.latePenalty, true));
  if (!recognition(value.excusedForScore)) errors.push('공결의 감점 인정 방식을 확인해 주세요.');
  if (!['unconfirmed', 'term_end', 'per_session_equal'].includes(value.allocation as string)) errors.push('출석 배점 확정 시점을 확인해 주세요.');
  const e = value.eligibility;
  if (!record(e) || !record(e.rule)) return [...errors, '출석 미달 규칙 형식이 올바르지 않습니다.'];
  if (!['sessions', 'hours'].includes(e.unit as string)) errors.push('미달 판정 단위를 확인해 주세요.');
  if (!recognition(e.excused)) errors.push('미달 판정의 공결 인정 방식을 확인해 주세요.');
  errors.push(...validateLate(e.late, false));
  if (e.rule.kind === 'max_absences') {
    if (!count(e.rule.allowed) || (e.rule.failureAt === 'reaches' && e.rule.allowed === 0)) errors.push('결석 기준 횟수를 확인해 주세요. 0회 허용은 ‘초과’ 기준으로 설정합니다.');
    if (!['exceeds', 'reaches'].includes(e.rule.failureAt as string)) errors.push('정확히 도달한 경우와 초과한 경우 중 미달 기준을 선택해 주세요.');
    if (e.unit === 'hours') errors.push('시간 기준은 최소 출석 비율로 설정하고 실제 인정시간을 입력해 주세요.');
  } else if (e.rule.kind === 'minimum_ratio') {
    if (!finite(e.rule.minimum) || e.rule.minimum < 0 || e.rule.minimum > 1) errors.push('최소 출석 비율은 0~100%여야 합니다.');
  } else if (e.rule.kind !== 'unconfirmed') errors.push('지원하지 않는 출석 미달 규칙입니다.');
  if (e.hours !== null) {
    const h = e.hours;
    if (!record(h) || !positive(h.total) || !finite(h.held) || h.held < 0 || !finite(h.credited) || h.credited < 0 || h.credited > h.held || h.held > h.total || typeof h.recognitionConfirmed !== 'boolean') errors.push('인정시간은 0 ≤ 인정시간 ≤ 진행시간 ≤ 총시간이어야 합니다.');
    else if (e.unit === 'hours' && record(r) && ((r.held === 0 && h.held !== 0) || ((r.held === r.total) !== (Math.abs(h.held - h.total) <= EPS)))) errors.push('수업 진행 횟수와 시간 기록의 시작·종료 상태가 일치해야 합니다.');
  }
  return errors;
}

function lateAbsences(lateness: number, rule: LateRecognition): number | null {
  if (lateness === 0) return 0;
  switch (rule.kind) {
    case 'unconfirmed': return null;
    case 'ignored': return 0;
    case 'bundled': return Math.floor(lateness / rule.perAbsence);
    case 'proportional': return lateness / rule.perAbsence;
  }
}

/** Scoring and eligibility intentionally have separate policies and outputs. */
export function calculateAttendanceScore(config: AttendanceManagement, weight: number, maxScore: number): AttendanceScore {
  const r = config.records;
  const points = 100 * weight;
  const done = r.held === r.total;
  const messages: string[] = [];
  const late = config.latePenalty.kind === 'separate' ? 0 : lateAbsences(r.lateness, config.latePenalty);
  const known = config.penalty.kind !== 'unconfirmed' && late !== null && (r.excused === 0 || config.excusedForScore !== 'unconfirmed');
  const effectiveAbsences = known ? r.absences + (config.excusedForScore === 'as_absence' ? r.excused : 0) + late! : null;
  let rawDeduction: number | null = null;
  let internalDeduction: number | null = null;
  let finalDeduction: number | null = null;
  if (known && config.penalty.kind !== 'unconfirmed') {
    rawDeduction = effectiveAbsences! * config.penalty.pointsPerAbsence + (config.latePenalty.kind === 'separate' ? r.lateness * config.latePenalty.pointsPerLate : 0);
    internalDeduction = config.penalty.kind === 'attendance_points' ? Math.min(points, points * (rawDeduction / maxScore)) : 0;
    finalDeduction = config.penalty.kind === 'final_points' ? rawDeduction : 0;
  } else messages.push('감점·지각·공결 규칙 확인 필요: 감점을 0점으로 단정하지 않습니다.');
  const balance = empty();
  let unclassifiedPoints = 0;
  const loss = internalDeduction ?? 0;
  if (done) {
    balance.lost = loss;
    if (known) balance.secured = points - loss;
    else balance.ungraded = points;
  } else if (config.allocation === 'per_session_equal') {
    const heldPoints = points * (r.held / r.total);
    if (known) {
      balance.lost = loss;
      balance.secured = Math.max(0, heldPoints - loss);
      balance.remaining = Math.max(0, points - balance.secured - loss);
    } else {
      balance.ungraded = heldPoints;
      balance.remaining = points - heldPoints;
    }
  } else if (r.held === 0) {
    balance.remaining = points;
  } else {
    balance.lost = loss;
    unclassifiedPoints = points - loss;
    messages.push('회차별 배점이 없어 진행분과 미래 배점을 나눌 수 없습니다. 나머지 출석 배점은 확인 필요로 남깁니다.');
  }
  return {
    balance, unclassifiedPoints, known, complete: known && unclassifiedPoints <= EPS,
    effectiveAbsences, rawDeduction, internalDeduction, finalDeduction,
    finalRawScore: done && known ? config.penalty.kind === 'attendance_points' ? Math.max(0, maxScore - rawDeduction!) : maxScore : null,
    messages,
  };
}

export function evaluateAttendanceEligibility(config: AttendanceManagement): AttendanceEligibility {
  const r = config.records;
  const e = config.eligibility;
  const done = r.held === r.total;
  const base: AttendanceEligibility = { status: 'needs_review', phase: done ? 'complete' : 'in_progress', finalStatus: 'needs_review', effectiveAbsences: null, currentRatio: null, bestFinalRatio: null, unrecoverable: false, messages: [] };
  if (e.rule.kind === 'unconfirmed') return { ...base, messages: ['규정 확인 필요: 출석 미달이나 F를 확정하지 않습니다.'] };
  let total: number;
  let held: number;
  let credited: number;
  let deficit: number;
  let nextLoss: number;
  if (e.unit === 'hours') {
    const h = e.hours;
    if (!h || !h.recognitionConfirmed) return { ...base, messages: ['시간 규정 확인 필요: 공결·지각 규정을 반영한 실제 인정시간을 입력하고 확인해 주세요.'] };
    total = h.total; held = h.held; credited = h.credited; deficit = held - credited;
    nextLoss = 0; // Never invent hours per session from the session count.
  } else {
    const late = lateAbsences(r.lateness, e.late);
    if (late === null || r.excused > 0 && e.excused === 'unconfirmed') return { ...base, messages: ['미달 판정용 지각·공결 인정 규정을 확인해 주세요. 감점 규칙과 별도입니다.'] };
    total = r.total; held = r.held;
    deficit = r.absences + late + (e.excused === 'as_absence' ? r.excused : 0);
    credited = held - deficit;
    nextLoss = 1;
  }
  const remaining = total - held;
  const currentRatio = held > 0 ? credited / held : null;
  const bestFinalRatio = (credited + remaining) / total;
  const rule = e.rule;
  const fails = (loss: number) => rule.kind === 'max_absences'
    ? rule.failureAt === 'reaches' ? loss >= rule.allowed - EPS : loss > rule.allowed + EPS
    : (total - loss) / total < rule.minimum - EPS;
  const failed = fails(deficit);
  const nextWouldFail = remaining > 0 && (nextLoss > 0 ? fails(deficit + nextLoss) : rule.kind === 'minimum_ratio' && Math.abs(bestFinalRatio - rule.minimum) <= EPS);
  const belowCurrentRatio = !done && rule.kind === 'minimum_ratio' && currentRatio !== null && currentRatio < rule.minimum - EPS;
  const status = failed ? 'failed' : nextWouldFail || belowCurrentRatio ? 'risk' : 'normal';
  return {
    status, phase: done ? 'complete' : 'in_progress', finalStatus: done ? failed ? 'failed' : 'eligible' : 'not_final',
    effectiveAbsences: deficit, currentRatio, bestFinalRatio, unrecoverable: failed,
    messages: [failed ? '설정한 미달 기준에 해당합니다. 실제 F 처리 여부는 적용 규정을 확인하세요.' : status === 'risk' ? '다음 결석 시 기준에 닿거나 현재 출석 비율이 기준보다 낮습니다. 학기 종료 결과와 구분해 확인하세요.' : '현재 기록은 설정한 기준 이내입니다.', ...(!done ? ['학기 진행 중이며 학기 종료 확정 결과가 아닙니다.'] : [])],
  };
}

export function computeAttendance(course: ManagedCourse): ManagementResult<AttendanceCalculation> {
  if (course.simpleAttendance) {
    const errors = validateSimpleAttendance(course);
    if (errors.length) return {ok:false,errors};
    const value=computeSimpleAttendance(course);
    if ([value.score.rawDeduction,value.score.internalDeduction,value.score.finalDeduction].some((n)=>n!==null&&!Number.isFinite(n))) return {ok:false,errors:['감점 계산 범위를 초과했습니다.']};
    return {ok:true,value};
  }
  const config = course.attendanceManagement;
  const errors = validateAttendanceManagement(config, course.assessments);
  if (!config || errors.length) return { ok: false, errors };
  const linked = course.assessments.find((a) => a.id === config.assessmentId);
  const score = calculateAttendanceScore(config, linked?.weight ?? 0, config.rawMaxScore ?? linked?.maxScore ?? 100);
  if ([score.rawDeduction, score.internalDeduction, score.finalDeduction].some((n) => n !== null && !Number.isFinite(n))) return { ok: false, errors: ['감점 계산 범위를 초과했습니다. 입력한 점수와 횟수를 확인해 주세요.'] };
  return { ok: true, value: { score, eligibility: evaluateAttendanceEligibility(config) } };
}

/** Display-only full-mark baseline. Never feeds secured points or probability predictions. */
export function provisionalAttendanceScore(score: AttendanceScore, maximum: number): number | null {
  if (!score.known || score.internalDeduction === null || !Number.isFinite(score.internalDeduction) || !Number.isFinite(maximum) || maximum < 0) return null;
  return Math.max(0, maximum - score.internalDeduction);
}

export function attendanceChangeMessages(before: ManagedCourse[], after: ManagedCourse[]): string[] {
  const messages: string[] = [];
  for (const old of before) {
    const next = after.find((c) => c.id === old.id);
    const previous = old.attendanceManagement;
    const current = next?.attendanceManagement;
    const title = next?.name || old.name;
    if (JSON.stringify(old.simpleAttendance) !== JSON.stringify(next?.simpleAttendance)) {
      const beforeSimple=old.simpleAttendance, afterSimple=next?.simpleAttendance;
      const policyChanged=!beforeSimple||!afterSimple||JSON.stringify({...beforeSimple,records:undefined})!==JSON.stringify({...afterSimple,records:undefined});
      const reduced=beforeSimple&&afterSimple&&(['absences','lateness','excused'] as const).some((k)=>afterSimple.records[k]<beforeSimple.records[k]);
      const evidence=old.attendanceManagement||old.attendance||old.attendanceNotes&&Object.values(old.attendanceNotes).some((n)=>n>0)||old.assessments.some((a)=>a.id===afterSimple?.assessmentId&&(a.progress?.status==='graded'||a.progress?.status==='zero_confirmed'));
      const labels={off:'출석 체크 안 함',record_only:'출석 체크만 함',scored:'출석 점수 반영'};
      if ((beforeSimple||evidence)&&(policyChanged || reduced)) messages.push(`${title}: 간편 출석 유형·규칙 또는 기존 기록이 변경됩니다. ${beforeSimple?labels[beforeSimple.mode]:'기존 방식'} → ${afterSimple?labels[afterSimple.mode]:'기존 방식'}. 이전 점수·규칙은 보존하고 선택한 방식만 계산에 적용합니다. 기존 회차별 확보 배점은 유지하며, 유형 변경 시 연결 비율은 직접 확인합니다.`);
    }
    if (!previous && current) {
      const archived = old.assessments.find((a) => a.id === current.assessmentId);
      messages.push(`${title}: 출석 기록 기반 계산으로 전환합니다. 기존 출결 장부와 직접 점수(${archived?.progress?.status === 'graded' ? archived.progress.score : '미확정'})는 보관하고 중복 적용하지 않습니다. 진행 ${current.records.held}/${current.records.total}, 결석 ${current.records.absences}, 지각 ${current.records.lateness}, 별도 공결 ${current.records.excused}회.`);
    } else if (previous && !current) messages.push(`${title}: 새 출석 관리 설정과 기록(진행 ${previous.records.held}/${previous.records.total}, 결석 ${previous.records.absences}, 지각 ${previous.records.lateness}, 공결 ${previous.records.excused}회)을 제거합니다. 보관된 기존 점수·출결 장부 기준으로 돌아갑니다.`);
    else if (previous && current) {
      const { records: previousRecords, ...previousRules } = previous;
      const { records: currentRecords, ...currentRules } = current;
      if (JSON.stringify(previousRules) !== JSON.stringify(currentRules) || previousRecords.total !== currentRecords.total) messages.push(`${title}: 출석 연결 항목·감점·배점·미달 규칙 또는 총 횟수가 변경됩니다. 기존 기록에 적용되는 결과를 확인해 주세요.`);
      if (currentRecords.held < previousRecords.held || currentRecords.absences < previousRecords.absences || currentRecords.lateness < previousRecords.lateness || currentRecords.excused < previousRecords.excused) messages.push(`${title}: 기존 출석 횟수 기록이 감소합니다. 정정 내용을 확인해 주세요.`);
      const oldItem = old.assessments.find((a) => a.id === previous.assessmentId);
      const newItem = next?.assessments.find((a) => a.id === current.assessmentId);
      if (oldItem && newItem && (oldItem.weight !== newItem.weight || oldItem.maxScore !== newItem.maxScore || JSON.stringify(oldItem.progress) !== JSON.stringify(newItem.progress))) messages.push(`${title}: 출석 배점·만점 또는 보관된 직접 점수가 변경됩니다.`);
    }
  }
  return messages;
}
