'use client';

/* ==========================================================================
 *  홈 "오늘의 에리카"
 * --------------------------------------------------------------------------
 *  오늘 하루치 결정 세 개를 한 화면에. 각 카드가 그 필러의 입구다.
 *  답이 없을 때 그럴듯한 말로 채우지 않고 "아직 근거가 없다"고 쓴다.
 * ========================================================================== */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { BattleResult, CrawlResult, MealTime } from '@/lib/types';
import { loadBattle, loadMeals } from '@/components/data';
import type { QuickInput } from '@/components/mock';
import { MOCK_LECTURES, MOCK_NEXT_CLASS, skipVerdict, whatIfQuick } from '@/components/mock';
import { cafeteriaLabel, humanDate, mealTimeLabel, toISODate } from '@/components/format';
import { Badge, Card, Icon, SectionTitle } from '@/components/ui';
import { ScoreLine } from '@/components/meal/Scoreboard';
import { ReliabilityBadge } from '@/components/honey/Reliability';

const STORAGE_KEY = 'erica.grade.quick.v1';

function mealTimeNow(): MealTime {
  const h = new Date().getHours();
  if (h < 10) return 'breakfast';
  if (h < 15) return 'lunch';
  return 'dinner';
}

/** 학점 화면에 저장해둔 3칸 입력을 읽어온다. 없으면 없는 대로 간다. */
function readQuickInput(): QuickInput | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Record<string, string>;
    const n = (s?: string) => {
      const t = (s ?? '').trim();
      if (t === '') return null;
      const v = Number(t);
      return Number.isFinite(v) ? v : null;
    };
    return {
      myScore: n(d.myScore), mean: n(d.mean), stdev: n(d.stdev),
      enrolled: n(d.enrolled), maxScore: n(d.maxScore) ?? 100,
    };
  } catch {
    return null;
  }
}

export function HomeScreen({ initialDate }: { initialDate: string }) {
  const [date, setDate] = useState(initialDate);
  const [mealTime, setMealTime] = useState<MealTime>('lunch');
  const [crawl, setCrawl] = useState<CrawlResult | null>(null);
  const [battle, setBattle] = useState<BattleResult | null>(null);
  const [quick, setQuick] = useState<QuickInput | null>(null);

  useEffect(() => {
    setDate(toISODate(new Date()));
    setMealTime(mealTimeNow());
    setQuick(readQuickInput());
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([loadMeals(date), loadBattle(date, mealTime)]).then(([m, b]) => {
      if (!alive) return;
      setCrawl(m.data);
      setBattle(b.data);
    });
    return () => {
      alive = false;
    };
  }, [date, mealTime]);

  const todayMeals = (crawl?.items ?? []).filter((i) => i.mealTime === mealTime);
  const verdict = skipVerdict(quick ? whatIfQuick(quick)[0] : undefined);
  const pick = MOCK_LECTURES.filter((l) => l.reliability.band !== 'low')[0];

  const tone =
    verdict.tone === 'careful'
      ? { bg: 'color-mix(in srgb, var(--e-warn) 15%, transparent)', icon: 'warn' as const }
      : verdict.tone === 'ok'
        ? { bg: 'color-mix(in srgb, var(--e-good) 11%, transparent)', icon: 'good' as const }
        : { bg: 'var(--e-surface-2)', icon: 'blur' as const };

  return (
    <div className="flex flex-col gap-3">
      {/* ① 째도 되나 */}
      <Card className="p-4">
        <SectionTitle
          title="다음 수업, 째도 되나"
          right={<Link href="/grade" className="text-[12px] font-medium text-[var(--e-accent)]">자세히</Link>}
        />
        <p className="text-[12.5px] text-[var(--e-muted)]">
          {MOCK_NEXT_CLASS.startsAt} · {MOCK_NEXT_CLASS.courseName} · {MOCK_NEXT_CLASS.room}
        </p>

        <div className="mt-3 flex items-start gap-2 rounded-xl px-3 py-3" style={{ background: tone.bg }}>
          <Icon name={tone.icon} className="mt-[2px] h-4 w-4 shrink-0" />
          <p className="text-[13.5px] font-semibold leading-snug text-[var(--e-ink)]">{verdict.line}</p>
        </div>

        {verdict.tone === 'unknown' ? (
          <Link
            href="/grade"
            className="mt-3 flex items-center justify-center gap-1 rounded-full px-4 py-2.5 text-[13px] font-semibold text-white"
            style={{ background: 'var(--e-accent)' }}
          >
            10초 진단하러 가기
            <Icon name="chevron" className="h-3.5 w-3.5" />
          </Link>
        ) : null}
      </Card>

      {/* ② 오늘 뭐 먹지 + 대결 */}
      <Card className="p-4">
        <SectionTitle
          title={`오늘 ${mealTimeLabel(mealTime)}`}
          hint={humanDate(date)}
          right={<Link href="/meal" className="text-[12px] font-medium text-[var(--e-accent)]">전체</Link>}
        />

        {todayMeals.length === 0 ? (
          <p className="text-[13px] text-[var(--e-muted)]">식단을 아직 못 가져왔습니다.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {todayMeals.slice(0, 2).map((m) => (
              <li key={m.id} className="rounded-xl bg-[var(--e-surface-2)] px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12.5px] font-semibold text-[var(--e-ink)]">
                    {cafeteriaLabel(m.cafeteria)}
                  </span>
                  {m.price != null ? (
                    <span className="text-[12px] tabular-nums text-[var(--e-muted)]">
                      {m.price.toLocaleString('ko-KR')}원
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 line-clamp-1 text-[12.5px] text-[var(--e-ink-2)]">{m.menu.join(' · ')}</p>
              </li>
            ))}
          </ul>
        )}

        {battle ? (
          <div className="mt-3 border-t border-[var(--e-border)] pt-3">
            <p className="mb-2 text-[12px] font-semibold text-[var(--e-ink-2)]">창보 vs 학식</p>
            <ScoreLine battle={battle} />
            <p className="mt-2 text-[11.5px] leading-snug text-[var(--e-muted)]">{battle.headline}</p>
          </div>
        ) : null}
      </Card>

      {/* ③ 꿀강 */}
      <Card className="p-4">
        <SectionTitle
          title="꿀강 찾기"
          hint="별점 평균 말고 신뢰도부터 봅니다"
          right={<Link href="/honey" className="text-[12px] font-medium text-[var(--e-accent)]">전체</Link>}
        />

        {pick ? (
          <Link href={`/honey/${pick.id}`} className="block rounded-xl bg-[var(--e-surface-2)] px-3 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[13.5px] font-semibold text-[var(--e-ink)]">{pick.name}</p>
                <p className="mt-0.5 truncate text-[11.5px] text-[var(--e-muted)]">
                  {pick.professor} · {pick.type}
                </p>
              </div>
              {pick.honeyScore != null ? (
                <span className="shrink-0 text-[20px] font-bold leading-none tabular-nums" style={{ color: 'var(--e-ord-4)' }}>
                  {Math.round(pick.honeyScore)}
                </span>
              ) : null}
            </div>
            <div className="mt-2">
              <ReliabilityBadge lecture={pick} />
            </div>
          </Link>
        ) : null}

        <div className="mt-3">
          <Badge tone="neutral" icon="info">표본이 모자란 강의는 지수를 가려서 위로 올리지 않습니다</Badge>
        </div>
      </Card>
    </div>
  );
}
