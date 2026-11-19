import type { CollectionEntry } from '../core/types.ts';
import type { CourseSubject } from './course.ts';
import { termIndex } from './collection.ts';

function emptyCounts() {
  return { total: 0, planned: 0, active: 0, completed: 0, reviewed: 0 };
}
type Counts = ReturnType<typeof emptyCounts>;
type Semester = { year: number; term: CourseSubject['term']; counts: Counts };

function add(counts: Counts, subject: CourseSubject) {
  counts.total++;
  counts[subject.status]++;
  const review = subject.review;
  if (review && (review.shortReview?.trim() || review.difficulty !== undefined ||
    review.workload !== undefined || review.teamProject !== undefined || review.tags?.length)) {
    counts.reviewed++;
  }
}

export function completionRate({ completed, total }: Counts) {
  return total ? completed / total * 100 : 0;
}

export function courseProgress(entries: readonly CollectionEntry[]) {
  const overall = emptyCounts();
  const terms = new Map<number, Semester>();
  const seen = new Set<string>();
  let mostCompletedInTerm = 0;
  for (const { id, subject } of entries) {
    if (subject.kind !== 'course' || seen.has(id)) continue;
    seen.add(id);
    add(overall, subject);
    const { year, term } = subject;
    const key = termIndex(year, term);
    const semester = terms.get(key) ?? { year, term, counts: emptyCounts() };
    add(semester.counts, subject);
    terms.set(key, semester);
    mostCompletedInTerm = Math.max(mostCompletedInTerm, semester.counts.completed);
  }
  const semesters = [...terms].sort(([a], [b]) => b - a).map(([, semester]) => semester);

  // Like the people dex, achievements reflect the current records.
  const goal = (id: string, name: string, condition: string, description: string, count: number, target: number) =>
    ({ id, name, condition, description, progress: Math.min(count, target), target, achieved: count >= target });
  const achievements = [
    goal('first-course', '첫 페이지', '수강 기록 1개 등록', '첫 번째 강의를 도감에 기록했어요.', overall.total, 1),
    goal('first-complete', '첫 완주', '수강 완료 강의 1개', '첫 번째 강의의 수강을 완료했어요.', overall.completed, 1),
    goal('first-review', '강의 기록가', '강의 1개에 개인 평가 작성', '강의에 대한 나만의 평가를 남겼어요.', overall.reviewed, 1),
    goal('five-courses', '수집하는 대학생', '수강 기록 5개 등록', '다섯 개의 강의를 도감에 모았어요.', overall.total, 5),
    goal('semester-three', '한 학기의 발자취', '같은 학기의 수강 완료 강의 3개', '한 학기에 세 개 이상의 강의 수강을 완료했어요.', mostCompletedInTerm, 3),
  ];
  return { overall, semesters, achievements };
}
