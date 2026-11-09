import type { AssignmentGroup, AssignmentTask, AssessmentProgress, FourAreaBalance, ManagedAssessment, ManagedCourse, ManagementResult } from './management-types.ts';
import { progressBalance, validateProgress } from './assessment-progress.ts';

const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const named = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const nameKey = (v: string) => v.normalize('NFKC').replace(/\s/g, '').toLocaleLowerCase('ko');
const emptyBalance = (): FourAreaBalance => ({ secured: 0, lost: 0, ungraded: 0, remaining: 0 });
const shown = (n: number) => Number(n.toFixed(6));

export function validateAssignmentGroup(value: unknown): string[] {
  if (!record(value)) return ['과제 그룹 형식이 올바르지 않습니다.'];
  const errors: string[] = [];
  if (!['unconfirmed', 'equal', 'individual'].includes(value.allocation as string)) errors.push('과제 배점 방식을 확인해 주세요.');
  if (!Array.isArray(value.tasks) || value.tasks.length === 0) return [...errors, '세부 과제를 하나 이상 등록해 주세요.'];
  const ids = new Set<string>();
  const names = new Set<string>();
  let total = 0;
  value.tasks.forEach((task, index) => {
    const prefix = `세부 과제 ${index + 1}: `;
    if (!record(task)) { errors.push(prefix + '형식이 올바르지 않습니다.'); return; }
    if (!named(task.id) || ids.has(task.id)) errors.push(prefix + 'ID가 없거나 중복됩니다.');
    if (named(task.id)) ids.add(task.id);
    if (!named(task.name) || names.has(nameKey(task.name))) errors.push(prefix + '이름이 없거나 중복됩니다.');
    if (named(task.name)) names.add(nameKey(task.name));
    if (!finite(task.maxScore) || task.maxScore <= 0) errors.push(prefix + '만점은 0보다 커야 합니다.');
    errors.push(...validateProgress(task.progress, task.maxScore).map((e) => prefix + e));
    if (record(task.progress) && task.progress.status === 'zero_confirmed' && task.progress.reason !== 'not_submitted') errors.push(prefix + '과제 0점 확정 사유는 미제출이어야 합니다.');
    if ('myScore' in task || 'assignmentGroup' in task) errors.push(prefix + '중첩 그룹이나 별도 점수를 중복 저장할 수 없습니다.');
    if (task.weight !== null && (!finite(task.weight) || task.weight < 0 || task.weight > 1)) errors.push(prefix + '내부 비율은 0~100%여야 합니다.');
    if (value.allocation === 'equal' && task.weight !== null) errors.push(prefix + '균등 배점에서는 개별 비율을 입력하지 않습니다.');
    if (value.allocation === 'individual') {
      if (!finite(task.weight)) errors.push(prefix + '개별 배점 비율을 입력해 주세요.');
      else total += task.weight;
    }
  });
  if (value.allocation === 'individual' && Math.abs(total - 1) > 1e-8) errors.push('개별 과제 내부 비율 합계는 100%여야 합니다. 자동으로 수정하지 않았습니다.');
  return errors;
}

export interface AssignmentBalance {
  balance: FourAreaBalance;
  unclassifiedPoints: number;
  complete: boolean;
  tasks: { taskId: string; share: number | null; points: number | null; balance: FourAreaBalance | null }[];
}

function shareOf(group: AssignmentGroup, task: AssignmentTask): number | null {
  return group.allocation === 'equal' ? 1 / group.tasks.length : group.allocation === 'individual' ? task.weight : null;
}

export function computeAssignmentBalance(assessment: ManagedAssessment): ManagementResult<AssignmentBalance> {
  const group = assessment.assignmentGroup;
  const errors = validateAssignmentGroup(group);
  if (!finite(assessment.weight) || assessment.weight < 0 || assessment.weight > 1) errors.push('과제 전체 반영비율은 0~100%여야 합니다.');
  if (errors.length || !group) return { ok: false, errors };
  const balance = emptyBalance();
  const points = assessment.weight * 100;
  const tasks = group.tasks.map((task) => {
    const share = shareOf(group, task);
    if (share === null) return { taskId: task.id, share: null, points: null, balance: null };
    const taskPoints = points * share;
    const detail = progressBalance(task.progress, task.maxScore, taskPoints);
    for (const key of Object.keys(balance) as (keyof FourAreaBalance)[]) balance[key] += detail[key];
    return { taskId: task.id, share, points: taskPoints, balance: detail };
  });
  return { ok: true, value: { balance, unclassifiedPoints: group.allocation === 'unconfirmed' ? points : 0, complete: group.allocation !== 'unconfirmed', tasks } };
}

/** One aggregate observation only; never flatten tasks into independent probability inputs. */
export function assignmentAggregateScore(assessment: ManagedAssessment): ManagementResult<number> {
  const detail = computeAssignmentBalance(assessment);
  if (!detail.ok) return detail;
  const group = assessment.assignmentGroup!;
  if (!detail.value.complete) return { ok: false, errors: [`${assessment.name}: 과제 배점 확인 필요 — 등급 예측을 보류합니다.`] };
  if (group.tasks.some((task) => task.progress.status !== 'graded' && task.progress.status !== 'zero_confirmed')) {
    return { ok: false, errors: [`${assessment.name}: 일부 과제가 예정 또는 채점 대기 상태여서 그룹 전체 점수의 등급 예측을 보류합니다.`] };
  }
  if (!finite(assessment.maxScore) || assessment.maxScore <= 0) return { ok: false, errors: ['과제 그룹 만점을 확인해 주세요.'] };
  const fraction = group.tasks.reduce((sum, task) => sum + shareOf(group, task)! * (task.progress.status === 'graded' ? task.progress.score / task.maxScore : 0), 0);
  return { ok: true, value: Math.min(assessment.maxScore, fraction * assessment.maxScore) };
}

export function transitionAssignmentTask(task: AssignmentTask, progress: AssessmentProgress): ManagementResult<AssignmentTask> {
  const errors = validateProgress(progress, task.maxScore);
  if (progress?.status === 'zero_confirmed' && progress.reason !== 'not_submitted') errors.push('과제 0점 확정 사유는 미제출이어야 합니다.');
  return errors.length ? { ok: false, errors } : { ok: true, value: { ...task, progress: { ...progress } } };
}

/** Review messages are derived from the actual before/after records, not a UI assertion. */
export function assignmentChangeMessages(before: ManagedCourse[], after: ManagedCourse[]): string[] {
  const messages: string[] = [];
  for (const course of before) {
    const nextCourse = after.find((c) => c.id === course.id);
    for (const a of course.assessments) {
      const next = nextCourse?.assessments.find((item) => item.id === a.id);
      const group = a.assignmentGroup;
      const newGroup = next?.assignmentGroup;
      const title = `${course.name} / ${a.name}`;
      if (!group && newGroup) {
        const previous = a.progress?.status === 'graded' ? `${a.progress.score}/${a.maxScore}` : a.progress?.status === 'zero_confirmed' ? '0점 확정' : a.progress?.status ?? '상태 확인 필요';
        messages.push(`${title}: 기존 단일 기록(${previous})은 보관하고 계산에서 제외하며, ${newGroup.tasks.length}개 세부 과제만 합산합니다. 전체 비율 ${shown(a.weight * 100)}% → ${shown(next.weight * 100)}%.`);
        continue;
      }
      if (!group) continue;
      if (!newGroup) { messages.push(`${title}: 세부 과제 ${group.tasks.length}개가 제거됩니다.${next ? ' 보관한 단일 과제 점수가 다시 적용됩니다.' : ''}`); continue; }
      if (group.allocation !== newGroup.allocation) messages.push(`${title}: 배점 방식 ${group.allocation} → ${newGroup.allocation} 변경.`);
      if (JSON.stringify(a.progress) !== JSON.stringify(next.progress) || a.maxScore !== next.maxScore) messages.push(`${title}: 보관된 단일 점수 또는 그룹 만점이 변경됩니다.`);
      for (const task of group.tasks) {
        const replacement = newGroup.tasks.find((t) => t.id === task.id);
        if (!replacement) { messages.push(`${title} / ${task.name}: 과제 및 기록이 삭제됩니다.`); continue; }
        const oldShare = shareOf(group, task);
        const newShare = shareOf(newGroup, replacement);
        if (oldShare !== newShare || a.weight !== next.weight) {
          const oldPoints = oldShare === null ? '확인 필요' : `${shown(a.weight * oldShare * 100)}점`;
          const newPoints = newShare === null ? '확인 필요' : `${shown(next.weight * newShare * 100)}점`;
          messages.push(`${title} / ${task.name}: 최종 배점 ${oldPoints} → ${newPoints}.`);
        }
        if (task.maxScore !== replacement.maxScore || JSON.stringify(task.progress) !== JSON.stringify(replacement.progress)) {
          if (task.progress.status === 'graded' || task.progress.status === 'zero_confirmed') messages.push(`${title} / ${task.name}: 확정 점수·만점 또는 진행 상태가 변경됩니다.`);
        }
      }
    }
  }
  return messages;
}
