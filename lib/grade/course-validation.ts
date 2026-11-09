import type { Assessment, Course } from '../types.ts';

/** UI percentages are converted once at the boundary; the engine still uses 0..1. */
export interface AssessmentDraft {
  id: string;
  name: string;
  percent: string;
  maxScore: string;
  myScore: string;
  mean: string;
  stdev: string;
  ceilingClustered: boolean;
}

export interface CourseDraft {
  id: string;
  name: string;
  professor: string;
  credits: string;
  enrolled: string;
  isAbsolute: boolean;
  assessments: AssessmentDraft[];
  original: Course;
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const positive = (value: unknown): value is number => finite(value) && value > 0;
const whole = (value: unknown): value is number => finite(value) && Number.isInteger(value) && value >= 0;
const nameKey = (value: string) => value.normalize('NFKC').replace(/\s/g, '').toLocaleLowerCase('ko');

/** Validate untrusted localStorage data as well as editor input before the engine sees it. */
export function validateCourse(value: unknown): string[] {
  if (!record(value)) return ['과목 데이터 형식이 올바르지 않습니다.'];
  const errors: string[] = [];
  if (!text(value.id)) errors.push('과목 ID가 필요합니다.');
  if (!text(value.name)) errors.push('과목명을 입력해 주세요.');
  if (typeof value.professor !== 'string') errors.push('교수명 형식이 올바르지 않습니다.');
  if (!positive(value.credits)) errors.push('학점은 0보다 큰 숫자로 입력해 주세요.');
  if (value.enrolled !== null && (!positive(value.enrolled) || !Number.isInteger(value.enrolled))) {
    errors.push('수강인원은 양의 정수이거나 빈칸이어야 합니다.');
  }
  if (typeof value.isAbsolute !== 'boolean') errors.push('평가 방식이 올바르지 않습니다.');
  if (value.myRank !== undefined && value.myRank !== null &&
      (!positive(value.myRank) || !Number.isInteger(value.myRank) || !positive(value.enrolled) || value.myRank > value.enrolled)) {
    errors.push('등수는 수강인원 이내의 양의 정수여야 합니다.');
  }
  if (!Array.isArray(value.assessments) || value.assessments.length === 0) {
    errors.push('평가항목을 하나 이상 추가해 주세요.');
  } else {
    const ids = new Set<string>();
    const names = new Set<string>();
    let total = 0;
    for (const [index, a] of value.assessments.entries()) {
      const prefix = `평가항목 ${index + 1}: `;
      if (!record(a)) { errors.push(prefix + '데이터 형식이 올바르지 않습니다.'); continue; }
      if (!text(a.id) || ids.has(a.id)) errors.push(prefix + 'ID가 없거나 중복됩니다.');
      if (text(a.id)) ids.add(a.id);
      if (!text(a.name)) errors.push(prefix + '이름을 입력해 주세요.');
      else {
        const key = nameKey(a.name);
        if (names.has(key)) errors.push(prefix + '중복 평가항목입니다. 서로 다른 이름을 입력해 주세요.');
        names.add(key);
      }
      if (!finite(a.weight) || a.weight < 0 || a.weight > 1) errors.push(prefix + '반영비율은 0~100%여야 합니다.');
      else total += a.weight;
      if (!positive(a.maxScore)) errors.push(prefix + '만점은 0보다 커야 합니다.');
      for (const key of ['myScore', 'mean'] as const) {
        const n = a[key];
        if (n !== null && (!finite(n) || n < 0 || !positive(a.maxScore) || n > a.maxScore)) {
          errors.push(prefix + `${key === 'myScore' ? '내 점수' : '반 평균'}는 0~만점 범위이거나 빈칸이어야 합니다.`);
        }
      }
      if (a.stdev !== null && (!positive(a.stdev) || !positive(a.maxScore) || a.stdev > a.maxScore)) {
        errors.push(prefix + '표준편차는 0보다 크고 만점 이하이거나 빈칸이어야 합니다.');
      }
      if (typeof a.ceilingClustered !== 'boolean') errors.push(prefix + '천장 밀집 설정이 올바르지 않습니다.');
    }
    // Tolerance only covers floating point arithmetic, not a missing 0.01%.
    if (Math.abs(total - 1) > 1e-8) errors.push('평가항목 반영비율 합계가 100%여야 저장할 수 있습니다.');
  }
  if (value.attendance !== null) {
    const a = value.attendance;
    if (!record(a) || !positive(a.totalSessions) || !Number.isInteger(a.totalSessions) ||
        !whole(a.absences) || !whole(a.lateness) || !whole(a.allowedAbsences) ||
        !finite(a.penaltyPerAbsence) || a.penaltyPerAbsence < 0 ||
        !positive(a.latePerAbsence) || !Number.isInteger(a.latePerAbsence)) {
      errors.push('출결 장부 형식이 올바르지 않습니다.');
    }
  }
  return errors;
}

export function validateCourses(value: unknown): string[] {
  if (!Array.isArray(value)) return ['과목 목록 형식이 올바르지 않습니다.'];
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const [index, course] of value.entries()) {
    errors.push(...validateCourse(course).map((e) => `과목 ${index + 1}: ${e}`));
    if (record(course) && text(course.id)) {
      if (ids.has(course.id)) errors.push('과목 ID가 중복됩니다.');
      ids.add(course.id);
    }
  }
  return errors;
}

export function newCourse(id: string): Course {
  return {
    id, name: '', professor: '', credits: 3, enrolled: null, isAbsolute: false, attendance: null,
    assessments: [
      ['중간고사', 0.3], ['기말고사', 0.4], ['과제', 0.2], ['출석', 0.1],
    ].map(([name, weight], index) => ({
      id: `${id}-${index}`, name: name as string, weight: weight as number,
      maxScore: 100, myScore: null, mean: null, stdev: null, ceilingClustered: name === '출석',
    })),
  };
}

const display = (n: number | null | undefined) => n == null ? '' : String(n);
const requiredNumber = (s: string) => s.trim() === '' ? NaN : Number(s);
const optionalNumber = (s: string) => s.trim() === '' ? null : Number(s);

export function toCourseDraft(course: Course): CourseDraft {
  return {
    id: course.id, name: course.name, professor: course.professor,
    credits: display(course.credits), enrolled: display(course.enrolled), isAbsolute: course.isAbsolute,
    original: course,
    assessments: course.assessments.map((a) => ({
      ...a, percent: String(Number((a.weight * 100).toFixed(8))), maxScore: display(a.maxScore),
      myScore: display(a.myScore), mean: display(a.mean), stdev: display(a.stdev),
    })),
  };
}

export function fromCourseDraft(draft: CourseDraft): Course {
  return {
    ...draft.original, id: draft.id, name: draft.name.trim(), professor: draft.professor.trim(),
    credits: requiredNumber(draft.credits), enrolled: optionalNumber(draft.enrolled), isAbsolute: draft.isAbsolute,
    assessments: draft.assessments.map((a): Assessment => ({
      id: a.id, name: a.name.trim(), weight: requiredNumber(a.percent) / 100,
      maxScore: requiredNumber(a.maxScore), myScore: optionalNumber(a.myScore),
      mean: optionalNumber(a.mean), stdev: optionalNumber(a.stdev), ceilingClustered: a.ceilingClustered,
    })),
  };
}
