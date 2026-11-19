import { TERMS } from '@/lib/dex/course/course';
import type { CourseSubject } from '@/lib/dex/course/course';
import { completionRate, courseProgress } from '@/lib/dex/course/progress';

type Progress = ReturnType<typeof courseProgress>;
const percent = new Intl.NumberFormat('ko', { maximumFractionDigits: 1 });

function Counts({ counts }: { counts: Progress['overall'] }) {
  return <>
    <p>등록 {counts.total}개 · 예정 {counts.planned}개 · 수강 중 {counts.active}개 · 완료 {counts.completed}개 · 평가 {counts.reviewed}개</p>
    <label className="block">등록 강의 기준 완료율 {percent.format(completionRate(counts))}%
      <progress className="block w-full" value={completionRate(counts)} max={100} />
    </label>
  </>;
}

export function CourseProgress({ progress, onSemester }: {
  progress: Progress;
  onSemester: (year: number, term: CourseSubject['term']) => void;
}) {
  const { overall, semesters, achievements } = progress;
  return <div className="space-y-4">
    <section className="space-y-2 rounded-lg border p-4" aria-labelledby="course-progress-title">
      <h2 id="course-progress-title" className="font-semibold">강의 수집 현황</h2>
      <p>수강 기록이 있는 학기 {semesters.length}개</p>
      <Counts counts={overall} />
      {semesters.length ? <details className="space-y-2">
        <summary className="cursor-pointer">학기별 수강 현황</summary>
        <ul className="space-y-3">
          {semesters.map(({ year, term, counts }) => <li key={year + term} className="space-y-1 border-t pt-2">
            <button type="button" className="dex-back font-semibold" onClick={() => onSemester(year, term)}>{year}년 {TERMS[term]} 카드 보기</button>
            <Counts counts={counts} />
          </li>)}
        </ul>
      </details> : <p>강의를 등록하면 학기별 현황이 표시돼요.</p>}
    </section>
    <section className="space-y-2 rounded-lg border p-4" aria-labelledby="course-achievements-title">
      <h2 id="course-achievements-title" className="font-semibold">강의도감 업적</h2>
      <p>달성 {achievements.filter(goal => goal.achieved).length}/{achievements.length} · 현재 수강 기록 기준</p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {achievements.map(goal => <li key={goal.id} className="rounded border p-2">
          <h3 className="font-semibold">{goal.name}</h3>
          <p>{goal.condition}</p>
          {goal.achieved && <p>{goal.description}</p>}
          <p>{goal.achieved ? '달성' : '미달성'} · {goal.progress}/{goal.target}</p>
        </li>)}
      </ul>
    </section>
  </div>;
}
