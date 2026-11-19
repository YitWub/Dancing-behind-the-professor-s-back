import type { CourseEntry, CourseSubject } from './course.ts';

export const TERM_ORDER = ['spring', 'summer', 'fall', 'winter'] as const satisfies readonly CourseSubject['term'][];
export const SORTS = {
  newest: '최신 학기순',
  oldest: '오래된 학기순',
  title: '강의명 가나다순',
  registered: '최근 등록순',
} as const;

export interface CourseFilters {
  query: string;
  year: string;
  term: CourseSubject['term'] | '';
  status: CourseSubject['status'] | '';
  category: NonNullable<CourseSubject['category']> | '';
  sort: keyof typeof SORTS;
}

export const DEFAULT_FILTERS: CourseFilters = {
  query: '', year: '', term: '', status: '', category: '', sort: 'newest',
};

const collator = new Intl.Collator('ko', { sensitivity: 'base', numeric: true });
const searchKey = (value: string) => value.normalize('NFKC').trim().toLowerCase();
export const termIndex = (year: number, term: CourseSubject['term']) => year * TERM_ORDER.length + TERM_ORDER.indexOf(term);

export function selectCourses(entries: readonly CourseEntry[], filters: CourseFilters) {
  const query = searchKey(filters.query);
  return entries.filter(({ subject }) =>
    (!filters.year || String(subject.year) === filters.year) &&
    (!filters.term || subject.term === filters.term) &&
    (!filters.status || subject.status === filters.status) &&
    (!filters.category || subject.category === filters.category) &&
    (!query || [subject.title, subject.professor, subject.code].some(value => value && searchKey(value).includes(query))),
  ).sort((a, b) => {
    const byTerm = termIndex(b.subject.year, b.subject.term) - termIndex(a.subject.year, a.subject.term);
    const byTitle = collator.compare(a.subject.title, b.subject.title);
    const byRegistration = b.firstCollectedAt.localeCompare(a.firstCollectedAt);
    const byId = a.id.localeCompare(b.id);
    switch (filters.sort) {
      case 'oldest': return -byTerm || byTitle || byRegistration || byId;
      case 'title': return byTitle || byTerm || byRegistration || byId;
      case 'registered': return byRegistration || byTerm || byTitle || byId;
      default: return byTerm || byTitle || byRegistration || byId;
    }
  });
}
