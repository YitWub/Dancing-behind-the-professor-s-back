'use client';

/* ==========================================================================
 *  학식 화면 — 오늘/내일 날짜 + 조/중/석식 + 구내식당별 메뉴(사진) + 4버튼 평점 + 대결
 * ========================================================================== */

import { useCallback, useEffect, useState } from 'react';
import type { BattleResult, Cafeteria, CrawlResult, MealItem, MealReview, MealTime } from '@/lib/types';
import { mealDataNotice } from '@/lib/meal/status';
import {
  CAFETERIA_ORDER,
  MEAL_RATING_OPTIONS,
  ratingToLabel,
  type MealRatingLabel,
  type MealRatingOption,
} from '@/lib/meal/battle';
import {
  loadBattle,
  loadMealReviews,
  loadMealStatus,
  loadMeals,
  submitReview,
} from '@/components/data';
import {
  MEAL_TIMES,
  cafeteriaLabel,
  cafeteriaShort,
  humanDate,
  mealTimeLabel,
  shiftDate,
  toISODate,
} from '@/components/format';
import { Card, EmptyNote, Icon, PillTabs, SectionTitle, SourceBanner, Stars } from '@/components/ui';
import { Scoreboard } from '@/components/meal/Scoreboard';
import { ReviewForm } from '@/components/meal/ReviewForm';

/**
 * 사이트 접속 시 식단당 1회만 평점을 매길 수 있도록 접속 세션(메모리) 단위로 기록한다.
 * 탭 전환(홈 ↔ 학식, 조식 ↔ 중식 ↔ 석식) 시에도 유지된다.
 */
const ratedMealsThisVisit = new Map<string, MealRatingLabel>();

function defaultMealTime(): MealTime {
  const h = new Date().getHours();
  if (h < 10) return 'breakfast';
  if (h < 15) return 'lunch';
  return 'dinner';
}

export function MealScreen({ initialDate }: { initialDate: string }) {
  const [today, setToday] = useState(initialDate);
  const [date, setDate] = useState(initialDate);
  const [mealTime, setMealTime] = useState<MealTime>('lunch');
  const [selectedCafeteria, setSelectedCafeteria] = useState<'all' | Cafeteria>('all');

  const [crawl, setCrawl] = useState<CrawlResult | null>(null);
  const [mealSource, setMealSource] = useState<'api' | 'mock'>('api');
  const [mealNote, setMealNote] = useState<string | undefined>();

  const [status, setStatus] = useState<CrawlResult | null>(null);
  const [battle, setBattle] = useState<BattleResult | null>(null);
  const [reviews, setReviews] = useState<MealReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const tomorrow = shiftDate(today, 1);

  // "오늘"과 끼니는 서버가 아니라 보는 사람 시계 기준이라야 맞는다.
  useEffect(() => {
    const t = toISODate(new Date());
    setToday(t);
    setDate(t);
    setMealTime(defaultMealTime());
    loadMealStatus().then(setStatus);
    loadMealReviews().then((res) => setReviews(res.data));
  }, []);

  const refreshBattle = useCallback(
    (targetDate: string, targetMealTime: MealTime) => {
      loadBattle(targetDate, targetMealTime).then((b) => setBattle(b.data));
    },
    [],
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([loadMeals(date), loadBattle(date, mealTime), loadMealStatus()]).then(
      ([m, b, st]) => {
        if (!alive) return;
        setCrawl(m.data);
        setMealSource(m.source);
        setMealNote(m.note);
        setBattle(b.data);
        if (st) setStatus(st);
        setLoading(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [date, mealTime]);

  const handleStoredReload = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const [m, b, st] = await Promise.all([
        loadMeals(date, { refresh: true }),
        loadBattle(date, mealTime, { refresh: true }),
        loadMealStatus({ refresh: true }),
      ]);
      setCrawl(m.data);
      setMealSource(m.source);
      setMealNote(m.note);
      setBattle(b.data);
      if (st) setStatus(st);
    } finally {
      setRefreshing(false);
    }
  }, [date, mealTime, refreshing]);

  const handleReviewAdded = useCallback(
    (newReview: MealReview) => {
      setReviews((prev) => [newReview, ...prev]);
      refreshBattle(date, mealTime);
    },
    [date, mealTime, refreshBattle],
  );

  // 요구사항 1: 오늘과 내일 식단만 허용하며, 구내식당별로 정렬/필터링
  const mealItemsForTime = (crawl?.items ?? [])
    .filter((i) => (i.date === today || i.date === tomorrow) && i.mealTime === mealTime)
    .sort((a, b) => CAFETERIA_ORDER.indexOf(a.cafeteria) - CAFETERIA_ORDER.indexOf(b.cafeteria));

  const items =
    selectedCafeteria === 'all'
      ? mealItemsForTime
      : mealItemsForTime.filter((i) => i.cafeteria === selectedCafeteria);

  const isToday = date === today;
  const isTomorrow = date === tomorrow;

  return (
    <div className="flex flex-col gap-3">
      {/* 날짜 (오늘 · 내일 전용) + 끼니 탭 */}
      <Card className="p-3">
        <div className="flex items-center gap-2">
          <NavBtn
            label="오늘 식단 보기"
            disabled={isToday}
            onClick={() => setDate(today)}
          >
            <Icon name="chevron" className="h-4 w-4 rotate-180" />
          </NavBtn>
          <div className="min-w-0 flex-1 text-center">
            <p className="text-[14px] font-semibold text-[var(--e-ink)]">{humanDate(date)}</p>
            <p className="text-[11px] text-[var(--e-muted)]">
              {isToday ? '오늘 식단' : isTomorrow ? '내일 식단' : '오늘·내일 식단만 제공됩니다'}
            </p>
          </div>
          <NavBtn
            label="내일 식단 보기"
            disabled={isTomorrow}
            onClick={() => setDate(tomorrow)}
          >
            <Icon name="chevron" className="h-4 w-4" />
          </NavBtn>
        </div>

        {/* 오늘 / 내일 빠른 선택 버튼 */}
        <div className="mt-2.5 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => setDate(today)}
            className="rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors"
            style={{
              background: isToday ? 'var(--e-accent-soft)' : 'var(--e-surface-2)',
              color: isToday ? 'var(--e-accent)' : 'var(--e-muted)',
              borderColor: isToday ? 'var(--e-accent)' : 'var(--e-border)',
            }}
          >
            오늘 ({humanDate(today)})
          </button>
          <button
            type="button"
            onClick={() => setDate(tomorrow)}
            className="rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors"
            style={{
              background: isTomorrow ? 'var(--e-accent-soft)' : 'var(--e-surface-2)',
              color: isTomorrow ? 'var(--e-accent)' : 'var(--e-muted)',
              borderColor: isTomorrow ? 'var(--e-accent)' : 'var(--e-border)',
            }}
          >
            내일 ({humanDate(tomorrow)})
          </button>
        </div>

        <div className="mt-2.5">
          <PillTabs
            value={mealTime}
            onChange={setMealTime}
            ariaLabel="식사 시간"
            options={MEAL_TIMES.map((t) => ({ value: t, label: mealTimeLabel(t) }))}
          />
        </div>

        {/* 저장본 상태 안내와 재조회. 네트워크 수집은 명시적 CLI로만 실행한다. */}
        <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-[var(--e-border)] pt-2 text-[11px] text-[var(--e-muted)]">
          <span>
            {crawl ? mealDataNotice(crawl) : '저장된 식단 조회 중…'}
          </span>
          <button
            type="button"
            disabled={refreshing || loading}
            onClick={handleStoredReload}
            className="shrink-0 rounded-md border border-[var(--e-border)] bg-[var(--e-surface-2)] px-2 py-1 text-[11px] font-semibold text-[var(--e-ink-2)] transition-colors hover:border-[var(--e-accent)] hover:text-[var(--e-accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {refreshing ? '조회 중…' : '저장본 다시 읽기'}
          </button>
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
            <b className="font-semibold">저장된 데이터의 출처를 확인해 주세요.</b>{' '}
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

      {/* 구내식당별 식단 */}
      <div>
        <SectionTitle
          title={`구내식당별 ${isToday ? '오늘' : '내일'} ${mealTimeLabel(mealTime)} 식단`}
        />

        {/* 구내식당 필터 탭 */}
        <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="구내식당 선택">
          {(
            [
              { value: 'all', label: '전체 식당' },
              ...CAFETERIA_ORDER.map((c) => ({ value: c, label: cafeteriaShort(c) })),
            ] as { value: 'all' | Cafeteria; label: string }[]
          ).map((tab) => {
            const active = selectedCafeteria === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSelectedCafeteria(tab.value)}
                className="rounded-full border px-3 py-1 text-[12px] font-medium transition-colors"
                style={{
                  background: active ? 'var(--e-ink)' : 'var(--e-surface)',
                  color: active ? 'var(--e-surface)' : 'var(--e-ink-2)',
                  borderColor: active ? 'var(--e-ink)' : 'var(--e-border)',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {loading ? (
          <EmptyNote>불러오는 중…</EmptyNote>
        ) : items.length === 0 ? (
          <EmptyNote>
            이 날 {mealTimeLabel(mealTime)}은 운영하지 않거나 식단이 올라오지 않았습니다.
          </EmptyNote>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((item) => (
              <MealCard
                key={item.id}
                item={item}
                reviews={reviews.filter((r) => r.mealItemId === item.id)}
                onReview={handleReviewAdded}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MealCard({
  item,
  reviews,
  onReview,
}: {
  item: MealItem;
  reviews: MealReview[];
  onReview: (r: MealReview) => void;
}) {
  const [open, setOpen] = useState(false);
  const [imgSrc, setImgSrc] = useState<string | null>(item.imageUrl ?? item.imageSourceUrl ?? null);
  const [imgFailed, setImgFailed] = useState(false);
  const [pickedLabel, setPickedLabel] = useState<MealRatingLabel | null>(
    () => ratedMealsThisVisit.get(item.id) ?? null,
  );
  const [ratingBusy, setRatingBusy] = useState(false);
  const [rateFeedback, setRateFeedback] = useState<string | null>(() => {
    const existing = ratedMealsThisVisit.get(item.id);
    return existing ? `'${existing}' 평점을 이미 매겼습니다.` : null;
  });

  useEffect(() => {
    setImgSrc(item.imageUrl ?? item.imageSourceUrl ?? null);
    setImgFailed(false);
  }, [item.imageUrl, item.imageSourceUrl]);

  useEffect(() => {
    const existing = ratedMealsThisVisit.get(item.id) ?? null;
    setPickedLabel(existing);
    setRateFeedback(existing ? `'${existing}' 평점을 이미 매겼습니다.` : null);
  }, [item.id]);

  const hasRatedThisVisit = pickedLabel !== null;

  const avg =
    reviews.length > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : null;

  // 4개 평점 버튼별 집계 (좋좋, 느좋, 안좋, 좆)
  const counts: Record<MealRatingLabel, number> = {
    좋좋: 0,
    느좋: 0,
    안좋: 0,
    좆: 0,
  };
  for (const r of reviews) {
    counts[ratingToLabel(r.rating)] += 1;
  }

  async function handleQuickRate(opt: MealRatingOption) {
    if (ratingBusy || hasRatedThisVisit) return;
    setRatingBusy(true);
    setRateFeedback(null);
    const res = await submitReview({
      mealItemId: item.id,
      rating: opt.rating,
      text: `[${opt.label}]`,
      nickname: '익명',
    });
    ratedMealsThisVisit.set(item.id, opt.label);
    setRatingBusy(false);
    setPickedLabel(opt.label);
    setRateFeedback(`'${opt.label}' 평점이 등록되었습니다.`);
    onReview(res.data);
  }

  function handleImageError() {
    if (imgSrc && item.imageSourceUrl && imgSrc !== item.imageSourceUrl) {
      setImgSrc(item.imageSourceUrl);
    } else {
      setImgFailed(true);
    }
  }

  const hasValidPhoto = Boolean(imgSrc) && !imgFailed;

  return (
    <Card as="li" className="p-4">
      {/* 식당명 · 대표 메뉴 · 가격 */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{
                background:
                  item.cafeteria === 'changbo' ? 'var(--e-changbo)' : 'var(--e-haksik)',
              }}
              aria-hidden
            />
            <h3 className="text-[14.5px] font-semibold text-[var(--e-ink)]">
              {cafeteriaLabel(item.cafeteria)}
            </h3>
            {item.soldOut ? (
              <span className="rounded-full bg-[var(--e-surface-2)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--e-critical)]">
                품절
              </span>
            ) : null}
          </div>
          {item.name ? (
            <p className="mt-1 text-[13.5px] font-semibold leading-snug text-[var(--e-ink)]">
              {item.name}
            </p>
          ) : null}
          <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--e-ink-2)]">
            {item.menu.join(' · ')}
          </p>
        </div>
        <div className="shrink-0 text-right">
          {item.price != null ? (
            <p className="text-[14px] font-semibold tabular-nums text-[var(--e-ink)]">
              {item.price.toLocaleString('ko-KR')}원
            </p>
          ) : null}
          {item.kcal != null ? (
            <p className="mt-0.5 text-[11px] tabular-nums text-[var(--e-muted)]">
              {item.kcal} kcal
            </p>
          ) : null}
        </div>
      </div>

      {/* 요구사항 2: 식단 사진 표시 (사진이 없을 경우 '이미지가 없습니다.' 표시) */}
      <div className="mt-3 overflow-hidden rounded-xl border border-[var(--e-border)] bg-[var(--e-surface-2)]">
        {hasValidPhoto ? (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imgSrc!}
              alt={item.name ?? `${cafeteriaLabel(item.cafeteria)} 식단 사진`}
              onError={handleImageError}
              className="h-44 w-full object-cover"
              loading="lazy"
            />
          </div>
        ) : (
          <div className="flex h-32 items-center justify-center px-4 text-center">
            <p className="text-[13px] font-medium text-[var(--e-muted)]">이미지가 없습니다.</p>
          </div>
        )}
      </div>

      {/* 요구사항 3: 식단별 좋좋, 느좋, 안좋, 좆 총 4개의 평점 버튼 (사이트 접속 시 1회 제한) */}
      <div className="mt-3 border-t border-[var(--e-border)] pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[12px] font-semibold text-[var(--e-ink)]">이 식단 평점 매기기</span>
          {rateFeedback ? (
            <span className="text-[11px] font-medium text-[var(--e-accent)]">{rateFeedback}</span>
          ) : (
            <span className="text-[11px] text-[var(--e-muted)]">버튼을 눌러 바로 평가하세요 (접속당 1회)</span>
          )}
        </div>
        <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="식단 평점 버튼">
          {MEAL_RATING_OPTIONS.map((opt) => {
            const selected = pickedLabel === opt.label;
            const count = counts[opt.label];
            return (
              <button
                key={opt.label}
                type="button"
                disabled={ratingBusy || hasRatedThisVisit}
                onClick={() => handleQuickRate(opt)}
                className="flex flex-col items-center justify-center rounded-xl border px-2 py-2 text-[13px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                style={{
                  background: selected ? 'var(--e-accent)' : 'var(--e-surface-2)',
                  color: selected ? '#ffffff' : 'var(--e-ink)',
                  borderColor: selected ? 'var(--e-accent)' : 'var(--e-border)',
                }}
              >
                <span>{opt.label}</span>
                <span
                  className="mt-0.5 text-[11px] font-medium tabular-nums"
                  style={{ color: selected ? 'rgba(255,255,255,0.9)' : 'var(--e-muted)' }}
                >
                  {count}명
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 평균 평점 및 상세 후기 토글 */}
      <div className="mt-3 flex items-center gap-2 border-t border-[var(--e-border)] pt-3">
        {avg != null ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--e-muted)]">
            <Stars value={avg} size={13} />
            <span className="tabular-nums font-semibold text-[var(--e-ink)]">
              {avg.toFixed(1)}
            </span>
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
          <ReviewForm
            item={item}
            alreadyRated={hasRatedThisVisit}
            onDone={(r) => {
              const label = ratingToLabel(r.rating);
              ratedMealsThisVisit.set(item.id, label);
              setPickedLabel(label);
              setRateFeedback(`'${label}' 평점이 등록되었습니다.`);
              onReview(r);
            }}
          />
        </div>
      ) : null}

      {reviews.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2">
          {reviews.slice(0, 3).map((r) => (
            <li key={r.id} className="rounded-lg bg-[var(--e-surface-2)] px-2.5 py-2">
              <div className="flex items-center gap-1.5">
                <span className="rounded bg-[var(--e-surface)] px-1.5 py-0.5 text-[10.5px] font-bold text-[var(--e-accent)]">
                  {ratingToLabel(r.rating)}
                </span>
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
  label,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="shrink-0 rounded-full border border-[var(--e-border)] p-2 text-[var(--e-ink-2)] disabled:cursor-not-allowed disabled:opacity-35"
    >
      {children}
    </button>
  );
}
