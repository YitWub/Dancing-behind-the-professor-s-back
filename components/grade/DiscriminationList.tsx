'use client';

/* ==========================================================================
 *  변별 기여도 — 명목 비율 vs 실질 영향력
 * --------------------------------------------------------------------------
 *  회의록 4-4: 숫자(62%) 금지, 3구간 정성 표현만.
 *  단, 명목 반영비율은 강의계획서에 적힌 "선언값"이라 그대로 보여준다.
 *  이 화면의 핵심은 "명목 30%인데 실질은 영향 거의 없음" 같은 어긋남이다.
 * ========================================================================== */

import type { Course, ImpactBand } from '@/lib/types';
import { discrimination } from '@/components/mock';
import { bandLabel } from '@/components/format';
import { Card, Icon, SectionTitle } from '@/components/ui';

const BAND_STYLE: Record<ImpactBand, { bg: string; fg: string; width: string }> = {
  decisive:   { bg: 'var(--e-ord-4)',    fg: '#fff',               width: '100%' },
  supporting: { bg: 'var(--e-ord-2)',    fg: 'var(--e-ink)',       width: '58%' },
  negligible: { bg: 'var(--e-surface-2)',fg: 'var(--e-muted)',     width: '18%' },
};

export function DiscriminationList({ course }: { course: Course }) {
  const rows = discrimination(course);

  return (
    <Card className="p-4">
      <SectionTitle
        title="어디서 등급이 갈리나"
        hint="반영비율이 크다고 등급을 가르는 게 아닙니다"
      />

      <ul className="flex flex-col gap-2.5">
        {rows.map((r) => {
          const s = BAND_STYLE[r.band];
          const mismatch = r.declaredWeight >= 0.2 && r.band === 'negligible';
          return (
            <li key={r.assessmentId} className="rounded-xl border border-[var(--e-border)] px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13.5px] font-semibold text-[var(--e-ink)]">{r.assessmentName}</span>
                <span
                  className="shrink-0 rounded-full px-2 py-[3px] text-[11px] font-semibold"
                  style={{ background: s.bg, color: s.fg }}
                >
                  {bandLabel(r.band)}
                </span>
              </div>

              <div className="mt-2 flex items-center gap-2">
                <span className="w-[62px] shrink-0 text-[11px] text-[var(--e-muted)]">
                  명목 {Math.round(r.declaredWeight * 100)}%
                </span>
                <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-[4px] bg-[var(--e-surface-2)]">
                  <span className="block h-full rounded-[4px]" style={{ width: s.width, background: s.bg }} />
                </span>
                <span className="w-[54px] shrink-0 text-right text-[11px] text-[var(--e-muted)]">실질</span>
              </div>

              <p className="mt-2 text-[12px] leading-relaxed text-[var(--e-ink-2)]">{r.note}</p>

              {mismatch ? (
                <p className="mt-1.5 flex items-start gap-1.5 text-[11.5px] leading-snug text-[var(--e-muted)]">
                  <Icon name="info" className="mt-[1px] h-3 w-3 shrink-0" />
                  반영비율은 큰데 실질 영향은 작습니다. 여기 시간을 더 쓰는 건 손해일 수 있습니다.
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-[11px] leading-snug text-[var(--e-muted)]">
        실질 영향력은 <b className="font-semibold text-[var(--e-ink-2)]">세 구간</b>으로만 말합니다.
        “62% 기여” 같은 숫자는 계산해서 나온 값처럼 보이지만 실제로는 그만큼 알 수 없습니다.
      </p>
    </Card>
  );
}
