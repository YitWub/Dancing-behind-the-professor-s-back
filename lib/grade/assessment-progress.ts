import type { AssessmentProgress, FourAreaBalance } from './management-types.ts';

const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function validateProgress(value: unknown, maxScore: unknown): string[] {
  if (!record(value)) return ['평가 진행 상태가 올바르지 않습니다.'];
  switch (value.status) {
    case 'scheduled':
    case 'awaiting_grade':
      return Object.keys(value).some((key) => key !== 'status')
        ? ['예정·채점 대기 항목에는 점수나 0점 사유를 입력할 수 없습니다.'] : [];
    case 'graded':
      if (Object.keys(value).some((key) => key !== 'status' && key !== 'score') ||
          typeof value.score !== 'number' || !Number.isFinite(value.score) || value.score < 0 ||
          typeof maxScore !== 'number' || !Number.isFinite(maxScore) || maxScore <= 0 || value.score > maxScore) {
        return ['확정 점수는 0~만점 범위의 유한한 숫자여야 합니다.'];
      }
      return [];
    case 'zero_confirmed':
      return (value.reason !== 'absent' && value.reason !== 'not_submitted') ||
        Object.keys(value).some((key) => key !== 'status' && key !== 'reason')
        ? ['0점 확정은 미응시 또는 미제출 사유가 필요하며 별도 점수를 가질 수 없습니다.'] : [];
    default:
      return ['지원하지 않는 평가 진행 상태입니다.'];
  }
}

/** Called only after validation. Actual accounting, never an estimate. */
export function progressBalance(progress: AssessmentProgress, maxScore: number, points: number): FourAreaBalance {
  const balance = { secured: 0, lost: 0, ungraded: 0, remaining: 0 };
  switch (progress.status) {
    case 'scheduled': balance.remaining = points; break;
    case 'awaiting_grade': balance.ungraded = points; break;
    case 'zero_confirmed': balance.lost = points; break;
    case 'graded': balance.secured = points * (progress.score / maxScore); balance.lost = points - balance.secured; break;
  }
  return balance;
}
