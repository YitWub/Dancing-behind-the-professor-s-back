'use client';

import { useEffect, useState } from 'react';
import type { Lecture } from '@/lib/types';
import { loadLecture } from '@/components/data';
import { HoneyAxisBars } from '@/components/charts';
import { Badge, Card, EmptyNote, Icon, SectionTitle, SourceBanner, Stars } from '@/components/ui';
import {
  AiSummary, FlagChips, HoneyScore, ReliabilityBadge, ReliabilityReasons, SeedNotice,
} from '@/components/honey/Reliability';
import { confidenceLabel } from '@/components/format';

export function LectureDetail({ id }: { id: string }) {
  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [source, setSource] = useState<'api' | 'mock'>('api');
  const [note, setNote] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    loadLecture(id).then((r) => {
      if (!alive) return;
      setLecture(r.data);
      setSource(r.source);
      setNote(r.note);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  if (loading) return <EmptyNote>불러오는 중…</EmptyNote>;
  if (!lecture) return <EmptyNote>그런 강의를 찾지 못했습니다.</EmptyNote>;

  const r = lecture.reliability;
  const low = r.band === 'low';

  return (
    <div className="flex flex-col gap-3">
      <SourceBanner source={source} note={note} />

      <Card className="p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[18px] font-bold tracking-tight text-[var(--e-ink)]">{lecture.name}</h2>
            <p className="mt-1 text-[12.5px] text-[var(--e-muted)]">
              {lecture.professor} · {lecture.department}
            </p>
            <p className="mt-0.5 text-[12.5px] text-[var(--e-muted)]">
              {lecture.type} · {lecture.credits}학점
            </p>
          </div>
          <HoneyScore lecture={lecture} size="lg" />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ReliabilityBadge lecture={lecture} />
          <Badge tone="neutral" icon="info">{confidenceLabel(r.band)}</Badge>
          {lecture.avgRating != null ? (
            <span className="inline-flex items-center gap-1 text-[12px] text-[var(--e-muted)]">
              <Stars value={lecture.avgRating} size={13} />
              <span className="tabular-nums">{lecture.avgRating.toFixed(1)}</span>
              <span>· 강의평 {lecture.reviewCount}건</span>
            </span>
          ) : (
            <span className="text-[12px] text-[var(--e-muted)]">아직 강의평이 없습니다</span>
          )}
        </div>
      </Card>

      <SeedNotice lecture={lecture} />

      {/* 신뢰도를 점수보다 먼저 읽게 만든다 */}
      <Card className="p-4">
        <SectionTitle
          title="이 점수를 얼마나 믿어도 되나"
          hint="이 필러에서 제일 먼저 읽어야 할 칸입니다"
        />

        {low ? (
          <p
            className="mb-3 flex items-start gap-1.5 rounded-xl px-3 py-2.5 text-[12.5px] leading-relaxed"
            style={{ background: 'color-mix(in srgb, var(--e-warn) 16%, transparent)', color: 'var(--e-ink)' }}
          >
            <Icon name="warn" className="mt-[2px] h-3.5 w-3.5 shrink-0" />
            <span>
              지수를 가려뒀습니다. 숨기려는 게 아니라, 이 표본으로 낸 숫자를 그대로 보여주면
              실제보다 훨씬 확실해 보이기 때문입니다.
            </span>
          </p>
        ) : null}

        <div className="mb-2.5">
          <FlagChips r={r} />
        </div>
        <ReliabilityReasons r={r} />

        {r.flags.length === 0 && r.band === 'high' ? (
          <p className="text-[12.5px] leading-relaxed text-[var(--e-ink-2)]">
            표본이 충분하고 최근 학기까지 강의평이 이어집니다. 눈에 띄는 편향 신호도 없습니다.
            이 강의는 점수를 그대로 읽어도 됩니다.
          </p>
        ) : null}
      </Card>

      <Card className="p-4">
        <SectionTitle title="세 줄 요약" />
        <AiSummary summary={lecture.summary} reasons={r.reasons} />
      </Card>

      <Card className="p-4">
        <SectionTitle
          title="다섯 축"
          hint={low ? '표본이 적어 축 값도 같이 흔들립니다' : undefined}
        />
        {lecture.axes ? (
          <HoneyAxisBars axes={lecture.axes} dimmed={low} />
        ) : (
          <EmptyNote>
            강의평 본문이 짧아 축을 뽑지 못했습니다. 빈 축을 0으로 채우지 않았습니다.
          </EmptyNote>
        )}
      </Card>
    </div>
  );
}
