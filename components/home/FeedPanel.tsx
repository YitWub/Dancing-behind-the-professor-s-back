'use client';

/* ==========================================================================
 *  components/home/FeedPanel.tsx — "밥 먹이기" = C필러 입구
 * --------------------------------------------------------------------------
 *  먹이는 밥은 꾸며낸 아이템이 아니라 오늘 실제로 올라온 식단이다.
 *  그래서 식단을 못 가져온 날은 먹일 게 없다고 쓴다 — 가짜 메뉴를 만들지 않는다.
 *
 *  누르면 "먹였다" 로 기록되고(브라우저에만 남는다) 바로 후기 쓰기로 이어진다.
 *  게이지가 올라가는 건 앱이 뭘 알아낸 게 아니라 사용자가 눌렀다는 사실뿐이라,
 *  라벨도 "먹인 끼니" 로만 쓴다.
 * ========================================================================== */

import Link from 'next/link';
import type { MealItem, MealTime } from '@/lib/types';
import type { FedEntry } from '@/components/home/fed';
import { fedSlots } from '@/components/home/fed';
import { MEAL_TIMES, cafeteriaLabel, mealTimeLabel } from '@/components/format';
import { Icon, PillTabs } from '@/components/ui';

/** 먹인 끼니 3칸. 추정이 아니라 누른 기록이라 반 칸이 없다. */
export function FullnessBar({ fed }: { fed: FedEntry[] }) {
  const done = fedSlots(fed);

  return (
    <div className="flex items-center gap-2">
      <div
        className="flex flex-1 gap-[3px]"
        role="img"
        aria-label={`오늘 먹인 끼니 ${done.length}끼 (조식·중식·석식 중)`}
      >
        {MEAL_TIMES.map((t) => {
          const on = done.includes(t);
          return (
            <div key={t} className="flex-1">
              <div
                className="h-2.5 rounded-full transition-colors"
                style={{ background: on ? 'var(--e-changbo)' : 'var(--e-surface-2)' }}
              />
              <span
                className="mt-1 block text-center text-[10.5px] font-medium"
                style={{ color: on ? 'var(--e-ink-2)' : 'var(--e-muted)' }}
              >
                {mealTimeLabel(t)}
              </span>
            </div>
          );
        })}
      </div>
      <span className="w-[66px] shrink-0 pb-4 text-right text-[11.5px] font-semibold tabular-nums text-[var(--e-ink-2)]">
        {done.length}/3끼
      </span>
    </div>
  );
}

export function FeedPanel({
  mealTime,
  onMealTime,
  items,
  fed,
  onFeed,
  onUndo,
}: {
  mealTime: MealTime;
  onMealTime: (t: MealTime) => void;
  /** 오늘 식단 전체. 끼니 필터는 여기서 건다 */
  items: MealItem[];
  fed: FedEntry[];
  onFeed: (item: MealItem) => void;
  onUndo: (mealItemId: string) => void;
}) {
  const list = items.filter((i) => i.mealTime === mealTime);
  const fedIds = new Set(fed.map((e) => e.mealItemId));

  return (
    <div className="flex flex-col gap-3">
      <PillTabs
        ariaLabel="끼니 고르기"
        value={mealTime}
        onChange={onMealTime}
        options={MEAL_TIMES.map((t) => ({ value: t, label: mealTimeLabel(t) }))}
      />

      {list.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--e-border-strong)] px-3 py-5 text-center text-[12.5px] leading-snug text-[var(--e-muted)]">
          오늘 {mealTimeLabel(mealTime)} 식단을 못 가져왔습니다.
          <br />
          없는 메뉴를 지어내서 먹일 수는 없습니다.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((m) => {
            const eaten = fedIds.has(m.id);
            const title = m.name ?? cafeteriaLabel(m.cafeteria);
            const photo = m.imageUrl ?? m.imageSourceUrl ?? null;

            return (
              <li
                key={m.id}
                className="flex items-center gap-2.5 rounded-xl px-2.5 py-2.5"
                style={{
                  background: eaten ? 'var(--e-accent-soft)' : 'var(--e-surface-2)',
                }}
              >
                {/* 썸네일 크기·없을 때 문구는 haksik 브랜치가 실제 사진에 맞춰둔 값을 그대로 쓴다 */}
                <div className="h-14 w-16 shrink-0 overflow-hidden rounded-lg border border-[var(--e-border)] bg-[var(--e-surface)]">
                  {photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo} alt={title} className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center px-1 text-center text-[10px] leading-tight text-[var(--e-muted)]">
                      이미지가 없습니다.
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="truncate text-[12.5px] font-semibold text-[var(--e-ink)]">{title}</span>
                    {m.price != null ? (
                      <span className="shrink-0 text-[11px] tabular-nums text-[var(--e-muted)]">
                        {m.price.toLocaleString('ko-KR')}원
                      </span>
                    ) : null}
                  </div>
                  {/* 대표 메뉴명이 없으면 제목이 이미 식당 이름이다 — 같은 말을 두 번 쓰지 않는다 */}
                  <p className="mt-0.5 line-clamp-1 text-[11.5px] text-[var(--e-ink-2)]">
                    {[m.name ? cafeteriaLabel(m.cafeteria) : null, ...m.menu]
                      .filter(Boolean)
                      .join(' · ') || '구성이 안 올라왔습니다'}
                  </p>
                </div>

                {eaten ? (
                  <button
                    type="button"
                    onClick={() => onUndo(m.id)}
                    className="shrink-0 rounded-full border border-[var(--e-border-strong)] bg-[var(--e-surface)] px-2.5 py-1.5 text-[11.5px] font-medium text-[var(--e-muted)]"
                  >
                    취소
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onFeed(m)}
                    className="shrink-0 rounded-full px-3 py-1.5 text-[12px] font-semibold text-white"
                    style={{ background: 'var(--e-changbo)' }}
                  >
                    먹이기
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {fed.length > 0 ? (
        <div className="flex items-start gap-1.5 rounded-xl bg-[var(--e-surface-2)] px-3 py-2.5">
          <Icon name="info" className="mt-[1px] h-3.5 w-3.5 shrink-0 text-[var(--e-muted)]" />
          <p className="text-[11.5px] leading-snug text-[var(--e-ink-2)]">
            먹인 기록은 이 브라우저에만 남습니다. 맛을 남기려면{' '}
            <Link href="/meal" className="font-semibold text-[var(--e-accent)]">
              후기 쓰기
            </Link>
            로 가야 대결 점수에 반영됩니다.
          </p>
        </div>
      ) : null}
    </div>
  );
}
