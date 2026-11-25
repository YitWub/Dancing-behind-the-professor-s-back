'use client';

import { useRef, useState } from 'react';
import { CourseProgress, CourseOverview } from './CourseProgress';
import type { courseProgress } from '@/lib/dex/course/progress';
import { CATEGORIES, TERMS } from '@/lib/dex/course/course';
import type { CourseEntry } from '@/lib/dex/course/course';
import { DEFAULT_FILTERS, selectCourses, SORTS, TERM_ORDER } from '@/lib/dex/course/collection';
import type { CourseFilters } from '@/lib/dex/course/collection';
import { calculateCourseBalance } from '@/lib/dex/course/grade/balance';
import { BinderPage } from '@/components/dex/common/BinderPage';
import { CourseTcgCard } from './CourseTcgCard';

type Chip = 'all' | 'check' | 'goal' | 'done';
const CHIPS: readonly (readonly [Chip, string])[] = [
  ['all', '전체'], ['check', '확인 필요'], ['goal', '목표 설정'], ['done', '완료'],
];

/** 칩 분류는 저장된 기록에서만 파생한다. */
function chipOf(entry: CourseEntry): Exclude<Chip, 'all'> {
  if (entry.subject.status === 'completed') return 'done';
  return calculateCourseBalance(entry.subject.gradeRecord).hp === null ? 'check' : 'goal';
}

export function CourseCollection({ entries, progress, busy, onSelect, onCreate }: {
  entries: readonly CourseEntry[];
  progress: ReturnType<typeof courseProgress>;
  busy: boolean;
  onSelect: (id: string) => void;
  onCreate?: () => void;
}) {
  const [chip, setChip] = useState<Chip>('all');
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const update = <K extends keyof CourseFilters>(key: K, value: CourseFilters[K]) =>
    setFilters(previous => ({ ...previous, [key]: value }));
  const heading = useRef<HTMLHeadingElement>(null);
  const years = [...new Set([...progress.semesters.map(term => term.year), ...(filters.year ? [Number(filters.year)] : [])])]
    .sort((a, b) => b - a);
  const input = 'block w-full min-w-0 rounded border p-2';
  const options = (labels: Record<string, string>) =>
    Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>);

  const matched = selectCourses(entries, filters);
  const visible = chip === 'all' ? matched : matched.filter(entry => chipOf(entry) === chip);
  const counts = entries.reduce((acc, entry) => { acc[chipOf(entry)] += 1; return acc; }, { check: 0, goal: 0, done: 0 });

  return <div className="bk-screen">
    <h2 ref={heading} tabIndex={-1} className="sr-only">강의 카드 바인더</h2>

    <div className="bk-chip-row" role="group" aria-label="강의 분류">
      {CHIPS.map(([key, label]) => <button key={key} type="button" aria-pressed={chip === key}
        onClick={() => setChip(key)}>{label}</button>)}
    </div>

    {visible.length > 0 ? <BinderPage
      label="강의 카드 바인더"
      items={visible.map(({ id, subject }) =>
        <CourseTcgCard key={id} subject={subject} busy={busy} onOpen={() => onSelect(id)} />)}
      emptySlot={onCreate
        ? <button type="button" className="bk-pocket-add" onClick={onCreate}>
            <b aria-hidden="true">＋</b>과목 추가<span>과목명 · 학점 ·<br/>평가 방식 · 비율</span>
          </button>
        : undefined}
    /> : <div className="bk-empty">
      <p>{entries.length ? '이 조건에 맞는 강의가 없어요.' : '아직 등록한 강의가 없어요.'}</p>
      {onCreate ? <button type="button" className="bk-link" onClick={onCreate}>첫 강의 등록하기 ↗</button> : null}
    </div>}

    <details className="bk-row-sheet">
      <summary><span>학기 전체 보기</span><em>{entries.length}과목 · 목표 설정 {counts.goal} · 확인 필요 {counts.check}</em></summary>
      <div className="bk-row-body">
        <CourseOverview progress={progress} />
        <CourseProgress progress={progress} onSemester={(year, term) => {
          setFilters(previous => ({ ...previous, year: String(year), term }));
          setChip('all');
          heading.current?.focus();
        }} />
      </div>
    </details>

    <details className="bk-row-sheet">
      <summary><span>검색과 상세 조건</span><em>{visible.length} / {entries.length}개 표시</em></summary>
      <div className="bk-row-body space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1">강의 검색
            <input type="search" className={input} value={filters.query} placeholder="강의명, 교수명, 과목 코드"
              onChange={event => update('query', event.target.value)} />
          </label>
          <button type="button" className="dex-button" disabled={!filters.query} onClick={() => update('query', '')}>검색어 지우기</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label>연도<select className={input} value={filters.year} onChange={event => update('year', event.target.value)}>
            <option value="">전체 연도</option>
            {years.map(year => <option key={year} value={year}>{year}년</option>)}
          </select></label>
          <label>학기<select className={input} value={filters.term} onChange={event => update('term', event.target.value as CourseFilters['term'])}>
            <option value="">전체 학기</option>
            {TERM_ORDER.map(term => <option key={term} value={term}>{TERMS[term]}</option>)}
          </select></label>
          <label>강의 구분<select className={input} value={filters.category} onChange={event => update('category', event.target.value as CourseFilters['category'])}>
            <option value="">전체 구분</option>
            {options(CATEGORIES)}
          </select></label>
          <label>정렬<select className={input} value={filters.sort} onChange={event => update('sort', event.target.value as CourseFilters['sort'])}>
            {options(SORTS)}
          </select></label>
        </div>
        <button type="button" className="dex-button" onClick={() => { setFilters(DEFAULT_FILTERS); setChip('all'); }}>조건 초기화</button>
      </div>
    </details>
  </div>;
}
