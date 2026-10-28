'use client';

/* ==========================================================================
 *  학점 잔고 — 통장 잔고 은유
 * --------------------------------------------------------------------------
 *  ①확보 ②상실 ③잔여. "얼마 남았나"가 아니라 "얼마 까먹었나"까지 같이 본다.
 * ========================================================================== */

import type { Course } from '@/lib/types';
import { computeBalance } from '@/components/mock';
import { BalanceBar } from '@/components/charts';
import { score } from '@/components/format';
import { Badge, Card, Icon, SectionTitle } from '@/components/ui';

export function BalanceCard({ course }: { course: Course }) {
  const balance = computeBalance(course);
  const att = course.attendance;
  const effectiveAbsences = att
    ? att.absences + Math.floor(att.lateness / Math.max(1, att.latePerAbsence))
    : null;
  const atRisk =
    att != null && effectiveAbsences != null && effectiveAbsences >= att.allowedAbsences - 1;

  return (
    <Card className="p-4">
      <SectionTitle
        title={`${course.name} 잔고`}
        hint={`${course.professor} · ${course.credits}학점${course.enrolled ? ` · ${course.enrolled}명` : ''}`}
        right={course.isAbsolute ? <Badge tone="neutral" icon="info">절대평가</Badge> : null}
      />

      <BalanceBar balance={balance} />

      {att ? (
        <div className="mt-4 rounded-xl bg-[var(--e-surface-2)] px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-semibold text-[var(--e-ink-2)]">출결 장부</span>
            <span className="text-[12px] tabular-nums text-[var(--e-ink-2)]">
              결석 {att.absences} · 지각 {att.lateness}
            </span>
          </div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--e-ink-2)]">
            지각 {att.latePerAbsence}회가 결석 1회로 환산돼서, 지금 실질 결석은{' '}
            <b className="font-semibold tabular-nums text-[var(--e-ink)]">{effectiveAbsences}회</b>입니다.
            한도는 {att.allowedAbsences}회.
          </p>
          {atRisk ? (
            <p
              className="mt-2 flex items-start gap-1.5 rounded-lg px-2.5 py-2 text-[12px] leading-snug"
              style={{ background: 'color-mix(in srgb, var(--e-critical) 13%, transparent)', color: 'var(--e-ink)' }}
            >
              <Icon name="stop" className="mt-[1px] h-3.5 w-3.5 shrink-0 text-[var(--e-critical)]" />
              한도까지 여유가 거의 없습니다. 여기서부터는 등급이 아니라 F 여부의 문제입니다.
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="mt-3 text-[11px] leading-snug text-[var(--e-muted)]">
        잔고는 100점 만점 환산입니다. 상실 {score(balance.lost)}점은 이미 나간 돈이라 되돌릴 수 없고,
        움직일 수 있는 건 잔여 {score(balance.remaining)}점뿐입니다.
      </p>
    </Card>
  );
}
