'use client';

/* ==========================================================================
 *  창보 vs 학식 — 이 필러의 훅
 * --------------------------------------------------------------------------
 *  스포츠 스코어보드처럼 보이되, decisive === false 면 승자를 띄우지 않는다.
 *  후기 2건으로 "창보 승"을 띄우는 순간 A필러에서 지킨 규칙이 여기서 무너진다.
 *
 *  색: 학식 #2a78d6 / 창보 #eb6834 — 검증기 전 항목 PASS(명·암).
 *      색만으로 편을 가르지 않도록 이름표를 항상 같이 붙인다.
 * ========================================================================== */

import type { BattleResult, BattleStanding } from '@/lib/types';
import { BATTLE_SIDES } from '@/lib/meal/battle';
import { cafeteriaShort, mealTimeLabel } from '@/components/format';
import { TrendGlyph } from '@/components/charts';
import { Card, Icon, SectionTitle } from '@/components/ui';

function sideColor(c: BattleStanding['cafeteria']): string {
  return c === 'changbo' ? 'var(--e-changbo)' : 'var(--e-haksik)';
}

export function Scoreboard({ battle, compact = false }: { battle: BattleResult; compact?: boolean }) {
  // 대결의 주인공은 창보와 학식 둘뿐. standings 에는 인재원식당 등이 같이 온다.
  const [leftId, rightId] = BATTLE_SIDES;
  const a = battle.standings.find((s) => s.cafeteria === leftId);
  const b = battle.standings.find((s) => s.cafeteria === rightId);
  const others = battle.standings.filter((s) => s.cafeteria !== leftId && s.cafeteria !== rightId);
  if (!a || !b) return null;

  return (
    <Card className="overflow-hidden">
      {/* 헤드라인 */}
      <div
        className="px-4 py-3"
        style={{
          background: battle.decisive ? 'var(--e-surface-2)' : 'color-mix(in srgb, var(--e-warn) 14%, transparent)',
        }}
      >
        <div className="flex items-start gap-1.5">
          {!battle.decisive ? <Icon name="warn" className="mt-[2px] h-3.5 w-3.5 shrink-0" /> : null}
          <p className="text-[13.5px] font-bold leading-snug text-[var(--e-ink)]">{battle.headline}</p>
        </div>
        <p className="mt-0.5 text-[11px] text-[var(--e-muted)]">
          {mealTimeLabel(battle.mealTime)} · 후기 기준
        </p>
      </div>

      {/* 스코어 */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-0">
        <Side s={a} winner={battle.winner === a.cafeteria} decisive={battle.decisive} align="left" />
        <div className="flex flex-col items-center justify-center px-2">
          <span className="text-[11px] font-bold tracking-widest text-[var(--e-muted)]">VS</span>
        </div>
        <Side s={b} winner={battle.winner === b.cafeteria} decisive={battle.decisive} align="right" />
      </div>

      {/* 대결에 안 낀 식당도 숨기지 않는다 */}
      {others.length > 0 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--e-border)] px-4 py-2.5">
          {others.map((o) => (
            <li key={o.cafeteria} className="text-[11.5px] text-[var(--e-muted)]">
              {o.label}{' '}
              <span className="tabular-nums text-[var(--e-ink-2)]">
                {o.avgRating != null ? `${o.avgRating.toFixed(1)} · 후기 ${o.reviewCount}건` : '후기 없음'}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* 승부 유보 고백 */}
      {!battle.decisive ? (
        <div className="border-t border-[var(--e-border)] px-4 py-3">
          <p className="text-[12px] leading-relaxed text-[var(--e-ink-2)]">
            <b className="font-semibold text-[var(--e-ink)]">승부 유보.</b>{' '}
            {Math.min(a.reviewCount, b.reviewCount) < 10
              ? '한쪽 후기가 너무 적어서 오늘 평균이 내일 뒤집힐 수 있습니다.'
              : '평점 차이가 후기 몇 건이면 뒤집힐 만큼 작습니다.'}{' '}
            이겼다고 말할 근거가 아직 없습니다.
          </p>
          {!compact ? (
            <p className="mt-1.5 text-[11px] leading-snug text-[var(--e-muted)]">
              후기를 남기면 이 판정이 바뀔 수 있습니다. 아래에서 오늘 먹은 걸 평가해 주세요.
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function Side({
  s, winner, decisive, align,
}: { s: BattleStanding; winner: boolean; decisive: boolean; align: 'left' | 'right' }) {
  const color = sideColor(s.cafeteria);
  const right = align === 'right';

  return (
    <div className={`flex flex-col gap-1 px-4 py-4 ${right ? 'items-end text-right' : 'items-start text-left'}`}>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: color }} aria-hidden />
        <span className="text-[12.5px] font-semibold text-[var(--e-ink)]">{s.label}</span>
      </span>

      {s.avgRating != null ? (
        <>
          <span className="flex items-baseline gap-1">
            <span className="text-[30px] font-bold leading-none tabular-nums" style={{ color }}>
              {s.avgRating.toFixed(1)}
            </span>
            <span className="text-[11px] text-[var(--e-muted)]">/ 5</span>
          </span>
          <span className="text-[11px] tabular-nums text-[var(--e-muted)]">후기 {s.reviewCount}건</span>
        </>
      ) : (
        <>
          <span className="text-[15px] font-semibold leading-tight text-[var(--e-muted)]">후기 없음</span>
          <span className="text-[11px] text-[var(--e-muted)]">아직 평가가 없습니다</span>
        </>
      )}
      <TrendGlyph trend={s.trend} />

      {/* 승자 표시는 decisive 일 때만 */}
      {decisive && winner ? (
        <span
          className="mt-1 rounded-full px-2 py-[3px] text-[10.5px] font-bold"
          style={{ background: color, color: '#fff' }}
        >
          오늘 판정승
        </span>
      ) : null}
    </div>
  );
}

/** 홈에 얹는 한 줄 요약본. */
export function ScoreLine({ battle }: { battle: BattleResult }) {
  const [leftId, rightId] = BATTLE_SIDES;
  const a = battle.standings.find((s) => s.cafeteria === leftId);
  const b = battle.standings.find((s) => s.cafeteria === rightId);
  if (!a || !b) return null;

  return (
    <div className="flex items-center gap-2 text-[13px]">
      <span className="flex items-center gap-1 tabular-nums">
        <span className="h-2 w-2 rounded-[2px]" style={{ background: sideColor(a.cafeteria) }} aria-hidden />
        <span className="text-[var(--e-muted)]">{cafeteriaShort(a.cafeteria)}</span>
        <b className="font-semibold text-[var(--e-ink)]">{a.avgRating?.toFixed(1) ?? '후기 없음'}</b>
      </span>
      <span className="text-[11px] font-bold text-[var(--e-muted)]">VS</span>
      <span className="flex items-center gap-1 tabular-nums">
        <span className="h-2 w-2 rounded-[2px]" style={{ background: sideColor(b.cafeteria) }} aria-hidden />
        <span className="text-[var(--e-muted)]">{cafeteriaShort(b.cafeteria)}</span>
        <b className="font-semibold text-[var(--e-ink)]">{b.avgRating?.toFixed(1) ?? '후기 없음'}</b>
      </span>
      {!battle.decisive ? (
        <span className="ml-auto shrink-0 text-[11px] font-medium text-[var(--e-muted)]">승부 유보</span>
      ) : null}
    </div>
  );
}
