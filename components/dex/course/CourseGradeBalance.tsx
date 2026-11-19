import { calculateCourseBalance } from '@/lib/dex/course/grade/balance';
import { SCORE_STATES } from '@/lib/dex/course/grade-record';
import type { CourseGradeRecord } from '@/lib/dex/course/grade-record';

const points = new Intl.NumberFormat('ko', { maximumFractionDigits: 2 });

export function CourseGradeBalance({ record }: { record?: CourseGradeRecord }) {
  const result = calculateCourseBalance(record);
  if (result.status === 'not-started') return null;
  if (!('items' in result)) return <p>
    {result.status === 'invalid' ? '성적 데이터가 유효하지 않아 계산을 보류했어요.' : '평가항목을 등록하면 성적 현황을 확인할 수 있어요.'}
  </p>;

  return <section className="course-sheet space-y-2 break-words p-3" aria-label="현재 성적 현황">
    <p className="font-semibold">성적 HP · {result.hp === null ? '계산 보류' : points.format(result.hp) + '점'}</p>
    {result.hp !== null && <p className="course-muted text-sm">미확정 평가가 모두 만점일 때 가능한 최고 환산점수예요.</p>}
    <p>확정 확보 {points.format(result.secured)}점 · 확정 상실 {points.format(result.lost)}점 · 미확정 배점 {points.format(result.unconfirmed)}점</p>
    {result.status === 'partial' && <p>등록된 평가항목 기준이에요. 반영비율 {points.format(result.registeredWeight)}% 등록 · {points.format(result.unallocatedWeight)}% 미배정. 합계가 100%가 되면 HP를 확인할 수 있어요.</p>}
    <details>
      <summary>항목별 환산점수</summary>
      <ul className="space-y-1 pt-2">
        {result.items.map(item => <li key={item.id}>
          {item.name} · {SCORE_STATES[item.status]} · {item.secured === null
            ? '환산점수 미확정 (배점 ' + points.format(item.weight) + '점)'
            : points.format(item.secured) + ' / ' + points.format(item.weight) + '점'}
        </li>)}
      </ul>
    </details>
  </section>;
}
