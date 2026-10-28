'use client';

/* ==========================================================================
 *  학식 화면 — 날짜 + 조/중/석식 + 식당별 메뉴 + 대결
 * ========================================================================== */

import { useEffect, useState } from 'react';
import type { BattleResult, CrawlResult, MealItem, MealReview, MealTime } from '@/lib/types';
import { loadBattle, loadMealStatus, loadMeals } from '@/components/data';
import { MOCK_MEAL_REVIEWS } from '@/components/mock';
import {
  MEAL_TIMES, cafeteriaLabel, humanDate, mealTimeLabel, shiftDate, toISODate,
} from '@/components/format';
import { Card, EmptyNote, Icon, PillTabs, SectionTitle, SourceBanner, Stars } from '@/components/ui';
import { Scoreboard } from '@/components/meal/Scoreboard';
import { ReviewForm } from '@/components/meal/ReviewForm';

function defaultMealTime(): MealTime {
  const h = new Date().getHours();
  if (h < 10) return 'breakfast';
  if (h < 15) return 'lunch';
  return 'dinner';
}

export function MealScreen({ initialDate }: { initialDate: string }) {
  const [date, setDate] = useState(initialDate);
  const [today, setToday] = useState(initialDate);
  const [mealTime, setMealTime] = useState<MealTime>('lunch');

  const [crawl, setCrawl] = useState<CrawlResult | null>(null);
  const [mealSource, setMealSource] = useState<'api' | 'mock'>('api');
  const [mealNote, setMealNote] = useState<string | undefined>();

  const [status, setStatus] = useState<CrawlResult | null>(null);
  const [battle, setBattle] = useState<BattleResult | null>(null);
  const [reviews, setReviews] = useState<MealReview[]>(MOCK_MEAL_REVIEWS);
  const [loading, setLoading] = useState(true);

  // "오늘"과 끼니는 서버가 아니라 보는 사람 시계 기준이라야 맞는다.
  // 첫 렌더는 서버가 준 날짜로 그리고, 마운트 직후 브라우저 시각으로 맞춘다.
  useEffect(() => {
    const t = toISODate(new Date());
    setToday(t);
    setDate(t);
    setMealTime(defaultMealTime());
    // 크롤링이 왜 실패했는지(시도한 원본 URL까지)는 별도 엔드포인트에만 있다.
    loadMealStatus().then(setStatus);
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([loadMeals(date), loadBattle(date, mealTime)]).then(([m, b]) => {
      if (!alive) return;
      setCrawl(m.data);
      setMealSource(m.source);
      setMealNote(m.note);
      setBattle(b.data);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [date, mealTime]);

  const items = (crawl?.items ?? []).filter((i) => i.mealTime === mealTime);

  return (
    <div className="flex flex-col gap-3">
      {/* 날짜 */}
      <Card className="p-3">
        <div className="flex items-center gap-2">
          <NavBtn label="전날" onClick={() => setDate((d) => shiftDate(d, -1))}>
            <Icon name="chevron" className="h-4 w-4 rotate-180" />
          </NavBtn>
          <div className="min-w-0 flex-1 text-center">
            <p className="text-[14px] font-semibold text-[var(--e-ink)]">{humanDate(date)}</p>
            {date !== today ? (
              <button
                type="button"
                onClick={() => setDate(today)}
                className="text-[11px] text-[var(--e-accent)] underline underline-offset-2"
              >
                오늘로
              </button>
            ) : (
              <p className="text-[11px] text-[var(--e-muted)]">오늘</p>
            )}
          </div>
          <NavBtn label="다음날" onClick={() => setDate((d) => shiftDate(d, 1))}>
            <Icon name="chevron" className="h-4 w-4" />
          </NavBtn>
        </div>

        <div className="mt-3">
          <PillTabs
            value={mealTime}
            onChange={setMealTime}
            ariaLabel="식사 시간"
            options={MEAL_TIMES.map((t) => ({ value: t, label: mealTimeLabel(t) }))}
          />
        </div>
      </Card>

      <SourceBanner source={mealSource} note={mealNote} />

      {/* 크롤링이 실패해 시드로 떨어졌을 때 — 헤더 X-Meal-Ok 로 판별 */}
      {crawl && !crawl.ok ? (
        <p
          className="flex items-start gap-1.5 rounded-xl px-3 py-2.5 text-[12px] leading-snug"
          style={{ background: 'color-mix(in srgb, var(--e-warn) 16%, transparent)', color: 'var(--e-ink)' }}
        >
          <Icon name="warn" className="mt-[1px] h-3.5 w-3.5 shrink-0" />
          <span>
            <b className="font-semibold">오늘 식단을 못 가져왔습니다.</b>{' '}
            {crawl.fallback === 'seed'
              ? '미리 저장해둔 시드 데이터를 대신 띄우는 중이라 실제 메뉴와 다를 수 있습니다.'
              : '보여줄 수 있는 건 예전에 받아둔 값뿐입니다.'}
            {status?.error ? (
              <span className="mt-1 block break-all text-[11px] text-[var(--e-muted)]">
                사유: {status.error}
              </span>
            ) : null}
          </span>
        </p>
      ) : null}

      {/* 대결 */}
      {battle ? <Scoreboard battle={battle} /> : null}

      {/* 메뉴 */}
      <div>
        <SectionTitle
          title={`${mealTimeLabel(mealTime)} 식단`}
          hint={crawl ? `${new Date(crawl.fetchedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 기준` : undefined}
        />
        {loading ? (
          <EmptyNote>불러오는 중…</EmptyNote>
        ) : items.length === 0 ? (
          <EmptyNote>이 날 {mealTimeLabel(mealTime)}은 운영하지 않거나 식단이 올라오지 않았습니다.</EmptyNote>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {items.map((item) => (
              <MealCard
                key={item.id}
                item={item}
                reviews={reviews.filter((r) => r.mealItemId === item.id)}
                onReview={(r) => setReviews((prev) => [r, ...prev])}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MealCard({
  item, reviews, onReview,
}: { item: MealItem; reviews: MealReview[]; onReview: (r: MealReview) => void }) {
  const [open, setOpen] = useState(false);
  const avg = reviews.length > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : null;

  return (
    <Card as="li" className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[14.5px] font-semibold text-[var(--e-ink)]">{cafeteriaLabel(item.cafeteria)}</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--e-ink-2)]">{item.menu.join(' · ')}</p>
        </div>
        <div className="shrink-0 text-right">
          {item.price != null ? (
            <p className="text-[14px] font-semibold tabular-nums text-[var(--e-ink)]">
              {item.price.toLocaleString('ko-KR')}원
            </p>
          ) : null}
          {item.kcal != null ? (
            <p className="mt-0.5 text-[11px] tabular-nums text-[var(--e-muted)]">{item.kcal} kcal</p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 border-t border-[var(--e-border)] pt-3">
        {avg != null ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--e-muted)]">
            <Stars value={avg} size={13} />
            <span className="tabular-nums">{avg.toFixed(1)}</span>
            <span>· {reviews.length}건</span>
            {reviews.length < 5 ? (
              <span className="text-[11px]">— 아직 평균이라고 하기 이릅니다</span>
            ) : null}
          </span>
        ) : (
          <span className="text-[12px] text-[var(--e-muted)]">아직 후기가 없습니다</span>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="ml-auto shrink-0 text-[12px] font-medium text-[var(--e-accent)]"
        >
          {open ? '접기' : '후기 쓰기'}
        </button>
      </div>

      {open ? (
        <div className="mt-3">
          <ReviewForm item={item} onDone={(r) => onReview(r)} />
        </div>
      ) : null}

      {reviews.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2">
          {reviews.slice(0, 3).map((r) => (
            <li key={r.id} className="rounded-lg bg-[var(--e-surface-2)] px-2.5 py-2">
              <div className="flex items-center gap-1.5">
                <Stars value={r.rating} size={11} />
                <span className="text-[11px] font-medium text-[var(--e-ink-2)]">{r.nickname}</span>
              </div>
              {r.text ? (
                <p className="mt-1 text-[12px] leading-snug text-[var(--e-ink-2)]">{r.text}</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function NavBtn({
  label, onClick, children,
}: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="shrink-0 rounded-full border border-[var(--e-border)] p-2 text-[var(--e-ink-2)]"
    >
      {children}
    </button>
  );
}
