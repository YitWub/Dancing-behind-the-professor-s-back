'use client';

import Link from 'next/link';
import type { Lecture } from '@/lib/types';
import { Card, Icon, Stars } from '@/components/ui';
import { FlagChips, HoneyScore, ReliabilityBadge } from '@/components/honey/Reliability';

export function LectureCard({ lecture }: { lecture: Lecture }) {
  const low = lecture.reliability.band === 'low';

  return (
    <Card as="li" className={`overflow-hidden ${low ? 'opacity-95' : ''}`}>
      <Link href={`/honey/${lecture.id}`} className="block px-4 py-3.5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[15px] font-semibold tracking-tight text-[var(--e-ink)]">
              {lecture.name}
            </h3>
            <p className="mt-0.5 truncate text-[12px] text-[var(--e-muted)]">
              {lecture.professor} · {lecture.department} · {lecture.type} · {lecture.credits}학점
            </p>
          </div>
          <HoneyScore lecture={lecture} />
        </div>

        {/* ★ 신뢰도는 모든 카드에 예외 없이 */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <ReliabilityBadge lecture={lecture} />
          {lecture.avgRating != null ? (
            <span className="inline-flex items-center gap-1 text-[11.5px] text-[var(--e-muted)]">
              <Stars value={lecture.avgRating} size={12} />
              <span className="tabular-nums">{lecture.avgRating.toFixed(1)}</span>
            </span>
          ) : (
            <span className="text-[11.5px] text-[var(--e-muted)]">후기 없음</span>
          )}
        </div>

        {lecture.reliability.flags.length > 0 ? (
          <div className="mt-2">
            <FlagChips r={lecture.reliability} />
          </div>
        ) : null}

        {lecture.summary ? (
          <p className="mt-2.5 line-clamp-2 text-[12.5px] leading-relaxed text-[var(--e-ink-2)]">
            <span
              className="mr-1.5 rounded-[3px] px-1 py-[1px] text-[9.5px] font-bold align-middle"
              style={{ background: 'var(--e-accent-soft)', color: 'var(--e-accent)' }}
            >
              AI
            </span>
            {lecture.summary}
          </p>
        ) : null}

        <span className="mt-2.5 inline-flex items-center gap-1 text-[11.5px] font-medium text-[var(--e-accent)]">
          자세히 보기
          <Icon name="chevron" className="h-3 w-3" />
        </span>
      </Link>
    </Card>
  );
}
