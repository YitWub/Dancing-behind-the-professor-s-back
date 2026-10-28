'use client';

/* ==========================================================================
 *  components/charts.tsx — 차트 마크 (외부 패키지 0개)
 * --------------------------------------------------------------------------
 *  색은 components/theme.css 의 검증된 슬롯만 쓴다. 여기서 새 색을 만들지 않는다.
 *
 *  마크 규칙(dataviz):
 *   · 데이터 끝은 4px 라운드, 베이스라인에 앵커
 *   · 인접 채움 사이 2px 표면 간격
 *   · 값은 선택적으로 직접 라벨 — 모든 점에 숫자를 박지 않는다
 *   · 격자/축은 물러나 있게
 *   · 2개 이상 시리즈에는 범례가 항상 있고, 4개 이하면 직접 라벨도 함께
 *
 *  ⚠ BalanceBar 의 확보/상실 색쌍은 CVD ΔE 6.9(경고 구간)이다.
 *    "직접 라벨 + 2px 간격"이 있어야만 합법인 조합이라 둘 다 필수다. 빼지 말 것.
 * ========================================================================== */

import type { CumulativeGradeProb, GradeBalance, HoneyAxes } from '@/lib/types';
import { AXIS_HIGHER_IS_SWEETER, AXIS_KEYS, AXIS_LABELS } from '@/lib/honey/axes';
import { atLeastText, isCoinFlip, pctBucket, pctText, score } from '@/components/format';
import { Icon } from '@/components/ui';

/* ── 학점 잔고: 부분-전체 누적 막대 ──────────────────────────────────────── */

const BALANCE_SLOTS = [
  { key: 'secured' as const,   label: '확보', color: 'var(--e-secured)',   help: '이미 받아둔 점수' },
  { key: 'lost' as const,      label: '상실', color: 'var(--e-lost)',      help: '결석·감점으로 이미 나간 점수' },
  { key: 'remaining' as const, label: '잔여', color: 'var(--e-remaining)', help: '아직 안 치른 배점' },
];

export function BalanceBar({ balance }: { balance: GradeBalance }) {
  const total = balance.secured + balance.lost + balance.remaining || 1;
  const pct = (v: number) => (v / total) * 100;

  return (
    <div>
      {/* 누적 막대 — 세그먼트 사이 2px 표면 간격 */}
      <div className="flex h-9 w-full gap-[2px] overflow-hidden rounded-[4px]" role="img"
           aria-label={`확보 ${score(balance.secured)}점, 상실 ${score(balance.lost)}점, 잔여 ${score(balance.remaining)}점`}>
        {BALANCE_SLOTS.map((s) => {
          const v = balance[s.key];
          if (v <= 0) return null;
          return (
            <div
              key={s.key}
              title={`${s.label} ${score(v)}점`}
              className="flex items-center justify-center rounded-[4px] text-[11px] font-semibold"
              style={{
                width: `${pct(v)}%`,
                background: s.color,
                color: s.key === 'remaining' ? 'var(--e-ink-2)' : '#fff',
              }}
            >
              {pct(v) >= 14 ? score(v) : null}
            </div>
          );
        })}
      </div>

      {/* 범례 + 직접 라벨 — 색만으로 의미를 나르지 않기 위한 필수 요소 */}
      <ul className="mt-3 grid grid-cols-3 gap-2">
        {BALANCE_SLOTS.map((s) => (
          <li key={s.key} className="flex flex-col gap-1">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: s.color }} aria-hidden />
              <span className="text-[11px] font-medium text-[var(--e-ink-2)]">{s.label}</span>
            </span>
            <span className="text-[17px] font-semibold leading-none tabular-nums text-[var(--e-ink)]">
              {score(balance[s.key])}
              <span className="ml-0.5 text-[11px] font-normal text-[var(--e-muted)]">점</span>
            </span>
            <span className="text-[10px] leading-tight text-[var(--e-muted)]">{s.help}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── 누적 등급 분포 ──────────────────────────────────────────────────────── */

/**
 * 규칙 2: 반드시 누적으로 읽힌다. "A0 이상일 확률"이지 "A0일 확률"이 아니다.
 * 규칙 1: 막대 길이는 10% 버킷에 스냅시켜, 화면에서 재는 값과 쓰는 값을 맞춘다.
 */
export function CumulativeGradeChart({ dist }: { dist: CumulativeGradeProb[] }) {
  const shown = dist.filter((d) => pctBucket(d.atLeastProb) > 0);
  if (shown.length === 0) {
    return <p className="text-[13px] text-[var(--e-muted)]">계산할 수 있는 구간이 없습니다.</p>;
  }

  return (
    <div>
      <ul className="flex flex-col gap-1.5">
        {shown.map((d) => {
          const b = pctBucket(d.atLeastProb);
          const coin = isCoinFlip(d.atLeastProb);
          return (
            <li key={d.grade} className="flex items-center gap-2.5">
              <span className="w-7 shrink-0 text-right text-[12px] font-semibold tabular-nums text-[var(--e-ink-2)]">
                {d.grade}
              </span>
              <span className="relative h-5 min-w-0 flex-1 overflow-hidden rounded-[4px] bg-[var(--e-surface-2)]">
                <span
                  title={`${atLeastText(d.grade)} ${pctText(d.atLeastProb)}`}
                  className="absolute inset-y-0 left-0 rounded-[4px]"
                  style={{
                    width: `${b}%`,
                    background: coin ? 'var(--e-ord-2)' : 'var(--e-ord-3)',
                  }}
                />
              </span>
              <span className="w-[68px] shrink-0 text-right text-[12px] tabular-nums text-[var(--e-ink-2)]">
                {pctText(d.atLeastProb)}
              </span>
              <span className="w-4 shrink-0">
                {coin ? <Icon name="warn" className="h-3.5 w-3.5 text-[var(--e-warn)]" /> : null}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2.5 text-[11px] leading-snug text-[var(--e-muted)]">
        전부 <b className="font-semibold text-[var(--e-ink-2)]">“이 등급 이상”</b>일 확률입니다.
        10% 단위로만 표시합니다 — 그보다 정밀하게 맞힐 수 있는 계산이 아닙니다.
        <span className="ml-1 inline-flex items-center gap-1 align-middle">
          <Icon name="warn" className="h-3 w-3 text-[var(--e-warn)]" />
          표시는 동전던지기 구간.
        </span>
      </p>
    </div>
  );
}

/* ── 꿀강 5축 ────────────────────────────────────────────────────────────── */

/**
 * 5축을 레이더 대신 가로 막대로 그린다.
 * 레이더는 면적이 축 순서에 따라 달라져서 없는 차이를 만들어낸다 —
 * "근거 없는 정밀도 금지"(규칙 3)와 정면으로 부딪힌다.
 * 축마다 꿀 방향이 반대라 색이 아니라 글로 방향을 밝힌다.
 *
 * ★ 값이 정확히 0.5 인 축은 "중간"이 아니라 "강의평에 언급이 없어서 기본값"이다.
 *   이걸 다른 축과 똑같이 그리면 없는 정보를 있는 것처럼 보여주게 된다.
 */
export function HoneyAxisBars({ axes, dimmed = false }: { axes: HoneyAxes; dimmed?: boolean }) {
  const unmentioned = AXIS_KEYS.filter((k) => axes[k] === 0.5).length;

  return (
    <div>
      <ul className={`flex flex-col gap-2 ${dimmed ? 'opacity-60' : ''}`}>
        {AXIS_KEYS.map((key) => {
          const v = axes[key];
          const silent = v === 0.5;
          const higherIsSweeter = AXIS_HIGHER_IS_SWEETER[key];
          const sweet = !silent && (higherIsSweeter ? v >= 0.6 : v <= 0.4);

          return (
            <li key={key} className="flex items-center gap-2.5">
              <span className={`w-[72px] shrink-0 text-[12px] ${silent ? 'text-[var(--e-muted)]' : 'text-[var(--e-ink-2)]'}`}>
                {AXIS_LABELS[key]}
              </span>

              <span className="relative h-4 min-w-0 flex-1 overflow-hidden rounded-[4px] bg-[var(--e-surface-2)]">
                <span
                  title={
                    silent
                      ? `${AXIS_LABELS[key]} — 강의평에 언급 없음`
                      : `${AXIS_LABELS[key]} — ${higherIsSweeter ? '높을수록' : '낮을수록'} 꿀`
                  }
                  className={`absolute inset-y-0 left-0 rounded-[4px] ${silent ? 'e-blur' : ''}`}
                  style={{ width: `${Math.round(v * 100)}%`, background: 'var(--e-ord-3)' }}
                />
              </span>

              <span className="w-[76px] shrink-0 text-[10px] leading-tight text-[var(--e-muted)]">
                {silent ? (
                  <b className="font-semibold text-[var(--e-ink-2)]">언급 없음</b>
                ) : (
                  <>
                    {higherIsSweeter ? '높을수록 꿀' : '낮을수록 꿀'}
                    {sweet ? <b className="ml-1 font-semibold text-[var(--e-ink-2)]">✓</b> : null}
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="mt-2.5 text-[11px] leading-snug text-[var(--e-muted)]">
        막대가 길수록 그 축의 값이 큽니다. 축마다 꿀강 방향이 반대라 색으로는 구분하지 않았습니다.
        {unmentioned > 0 ? (
          <>
            {' '}
            <b className="font-semibold text-[var(--e-ink-2)]">{unmentioned}개 축은 강의평에 언급이 없어</b>
            {' '}가운데값이 들어간 것뿐입니다 — “보통”이라는 뜻이 아닙니다.
          </>
        ) : null}
        {' '}축 값은 강의평 본문에서 뽑은 것이라 정확한 눈금이 아닙니다.
      </p>
    </div>
  );
}

/* ── 게이지 (단일 비율 대 한도) ──────────────────────────────────────────── */

export function Meter({
  value, max = 100, label, caption, tone = 'accent',
}: { value: number; max?: number; label: string; caption?: string; tone?: 'accent' | 'warn' }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium text-[var(--e-ink-2)]">{label}</span>
        <span className="text-[13px] font-semibold tabular-nums text-[var(--e-ink)]">{Math.round(pct)}%</span>
      </div>
      <div
        className="h-2.5 w-full overflow-hidden rounded-[4px] bg-[var(--e-surface-2)]"
        role="meter"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className="h-full rounded-[4px]"
          style={{ width: `${pct}%`, background: tone === 'warn' ? 'var(--e-warn)' : 'var(--e-ord-3)' }}
        />
      </div>
      {caption ? <p className="mt-1.5 text-[11px] leading-snug text-[var(--e-muted)]">{caption}</p> : null}
    </div>
  );
}

/* ── 추세 글리프 ─────────────────────────────────────────────────────────── */

/**
 * BattleStanding.trend 는 up/down/flat 세 값뿐이라 스파크라인을 그릴 수 없다.
 * 없는 시계열을 지어내지 않고 가진 것만 그린다. (조율자에게 필드 추가 요청함)
 */
export function TrendGlyph({ trend }: { trend: 'up' | 'down' | 'flat' }) {
  // flat 은 "변화가 없다"가 아니라 "판단할 만큼 후기가 없다"일 수도 있다.
  // 둘을 구분할 정보가 없으므로 단정하지 않고, 화살표도 물러난 색으로 둔다.
  const label =
    trend === 'up' ? '최근 7일 오름세'
    : trend === 'down' ? '최근 7일 내림세'
    : '추세를 말할 만큼 후기가 없음';

  return (
    <span
      className="inline-flex items-center gap-1 text-[11px]"
      style={{ color: trend === 'flat' ? 'var(--e-border-strong)' : 'var(--e-muted)' }}
      title={trend === 'flat' ? '변화가 없다는 뜻이 아니라, 판단할 근거가 모자라다는 뜻입니다' : undefined}
    >
      <Icon name={trend} className="h-3.5 w-3.5" />
      <span style={{ color: 'var(--e-muted)' }}>{label}</span>
    </span>
  );
}
