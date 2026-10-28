'use client';

/* ==========================================================================
 *  배분 대시보드 — 확정권 / 경계권 / 역전권
 * --------------------------------------------------------------------------
 *  gpaGainPerPoint 로 정렬은 하되 그 값을 숫자로 찍지 않는다.
 *  "0.037점 상승" 같은 건 계산기 안에서만 의미가 있고 화면에서는 false precision 이다.
 *  대신 순위와 상대 막대만 보여준다. 회의록대로 시간 환산도 하지 않는다.
 * ========================================================================== */

import type { Course, CourseZone } from '@/lib/types';
import { allocation } from '@/components/mock';
import { Card, SectionTitle } from '@/components/ui';

const ZONE: Record<CourseZone, { label: string; note: string; color: string }> = {
  locked:     { label: '확정권', note: '여기 더 써도 등급은 거의 안 움직입니다', color: 'var(--e-remaining)' },
  borderline: { label: '경계권', note: '1점이 등급을 바꿀 수 있는 자리입니다',   color: 'var(--e-ord-4)' },
  reversible: { label: '역전권', note: '아직 배점이 많이 남아 뒤집을 여지가 있습니다', color: 'var(--e-ord-2)' },
};

export function AllocationBoard({ courses }: { courses: Course[] }) {
  const rows = allocation(courses);
  const top = rows[0]?.gpaGainPerPoint ?? 1;

  return (
    <Card className="p-4">
      <SectionTitle
        title="지금 1점이 가장 값나가는 과목"
        hint="기말 1점을 어디에 쓸지의 순서입니다"
      />

      <ol className="flex flex-col gap-2">
        {rows.map((r, i) => {
          const z = ZONE[r.zone];
          const rel = top > 0 ? Math.max(8, (r.gpaGainPerPoint / top) * 100) : 8;
          return (
            <li key={r.courseId} className="rounded-xl border border-[var(--e-border)] px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="w-4 shrink-0 text-[12px] font-bold tabular-nums text-[var(--e-muted)]">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-[var(--e-ink)]">
                  {r.courseName}
                </span>
                <span
                  className="shrink-0 rounded-full px-2 py-[3px] text-[11px] font-semibold"
                  style={{
                    background: r.zone === 'locked' ? 'var(--e-surface-2)' : z.color,
                    color: r.zone === 'locked' ? 'var(--e-muted)' : '#fff',
                  }}
                >
                  {z.label}
                </span>
              </div>

              <div className="mt-2 ml-6 h-2 overflow-hidden rounded-[4px] bg-[var(--e-surface-2)]">
                <div className="h-full rounded-[4px]" style={{ width: `${rel}%`, background: z.color }} />
              </div>
              <p className="mt-1.5 ml-6 text-[11.5px] leading-snug text-[var(--e-muted)]">{z.note}</p>
            </li>
          );
        })}
      </ol>

      <p className="mt-3 text-[11px] leading-snug text-[var(--e-muted)]">
        막대는 서로 <b className="font-semibold text-[var(--e-ink-2)]">비교용</b>입니다. 1위 대비 얼마나 값나가는지만 읽으세요.
        “몇 시간 공부하면 얼마 오른다”로는 바꾸지 않았습니다 — 그 환산은 근거가 없습니다.
      </p>
    </Card>
  );
}
