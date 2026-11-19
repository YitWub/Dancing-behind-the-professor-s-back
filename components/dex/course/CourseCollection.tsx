'use client';

import { useRef, useState } from 'react';
import { CourseCompletion } from './CourseReviewPanel';
import { DIFFICULTIES } from '@/lib/dex/course/review';
import { CourseProgress } from './CourseProgress';
import { courseProgress } from '@/lib/dex/course/progress';
import { Card } from '@/components/ui';
import { CATEGORIES, STATUSES, TERMS } from '@/lib/dex/course/course';
import type { CourseEntry } from '@/lib/dex/course/course';
import { DEFAULT_FILTERS, selectCourses, SORTS, TERM_ORDER } from '@/lib/dex/course/collection';
import type { CourseFilters } from '@/lib/dex/course/collection';

export function CourseCollection({ entries, busy, onSelect }: {
  entries: readonly CourseEntry[];
  busy: boolean;
  onSelect: (id: string) => void;
}) {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const update = <K extends keyof CourseFilters>(key: K, value: CourseFilters[K]) =>
    setFilters(previous => ({ ...previous, [key]: value }));
  const heading = useRef<HTMLHeadingElement>(null);
  const progress = courseProgress(entries);
  const years = [...new Set([...progress.semesters.map(term => term.year), ...(filters.year ? [Number(filters.year)] : [])])]
    .sort((a, b) => b - a);
  const visible = selectCourses(entries, filters);
  const input = 'block w-full min-w-0 rounded border p-2';
  function options(labels: Record<string, string>) {
    return Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>);
  }

  return <div className="space-y-4"><section className="space-y-3" aria-labelledby="course-collection-title">
    <h2 ref={heading} tabIndex={-1} id="course-collection-title" className="font-semibold">강의 카드 컬렉션</h2>
    <div className="flex flex-wrap items-end gap-2">
      <label className="min-w-0 flex-1">강의 검색
        <input type="search" className={input} value={filters.query} placeholder="강의명, 교수명, 과목 코드"
          onChange={event => update('query', event.target.value)} />
      </label>
      <button type="button" className="dex-button" disabled={!filters.query} onClick={() => update('query', '')}>검색어 지우기</button>
    </div>
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
      <label>연도<select className={input} value={filters.year} onChange={event => update('year', event.target.value)}>
        <option value="">전체 연도</option>
        {years.map(year => <option key={year} value={year}>{year}년</option>)}
      </select></label>
      <label>학기<select className={input} value={filters.term} onChange={event => update('term', event.target.value as CourseFilters['term'])}>
        <option value="">전체 학기</option>
        {TERM_ORDER.map(term => <option key={term} value={term}>{TERMS[term]}</option>)}
      </select></label>
      <label>수강 상태<select className={input} value={filters.status} onChange={event => update('status', event.target.value as CourseFilters['status'])}>
        <option value="">전체 상태</option>{options(STATUSES)}
      </select></label>
      <label>강의 구분<select className={input} value={filters.category} onChange={event => update('category', event.target.value as CourseFilters['category'])}>
        <option value="">전체 구분</option>{options(CATEGORIES)}
      </select></label>
      <label>정렬<select className={input} value={filters.sort} onChange={event => update('sort', event.target.value as CourseFilters['sort'])}>
        {options(SORTS)}
      </select></label>
      <button type="button" className="dex-button self-end" onClick={() => setFilters(DEFAULT_FILTERS)}>조건 초기화</button>
    </div>
    <p role="status">전체 {entries.length}개 강의 · {visible.length}개 표시</p>
    {visible.length > 0 ? <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {visible.map(({ id, subject }) => <li key={id} className="min-w-0">
        <Card className="h-full">
          <button type="button" className="flex h-full w-full flex-col gap-1 break-words rounded-lg p-4 text-left"
            disabled={busy} onClick={() => onSelect(id)}>
            <span className="max-w-full font-semibold">{subject.title}</span>
            <span>{subject.year}년 {TERMS[subject.term]} · {STATUSES[subject.status]}</span>
            <CourseCompletion status={subject.status} />
            {subject.review?.shortReview && <span className="line-clamp-2 max-w-full">{subject.review.shortReview}</span>}
            {subject.review?.difficulty && <span>체감 난이도 · {DIFFICULTIES[subject.review.difficulty - 1]}</span>}
            {subject.professor && <span className="max-w-full">{subject.professor}</span>}
            {(subject.category || subject.credits !== undefined) && <span>
              {[subject.category && CATEGORIES[subject.category], subject.credits !== undefined && subject.credits + '학점'].filter(Boolean).join(' · ')}
            </span>}
          </button>
        </Card>
      </li>)}
    </ul> : <p>{entries.length ? '선택한 학기나 검색 조건에 맞는 강의가 없어요.' : '아직 등록한 강의가 없어요.'}</p>}
  </section>
    <CourseProgress progress={progress} onSemester={(year, term) => {
      setFilters(previous => ({ ...previous, year: String(year), term }));
      heading.current?.focus();
    }} />
  </div>;
}
