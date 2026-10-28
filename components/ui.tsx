'use client';

/* ==========================================================================
 *  components/ui.tsx — 공용 조각
 * --------------------------------------------------------------------------
 *  BlurGate / UncertainNote / WarningList 는 장식이 아니라 스펙이다.
 *  CONTRACT.md 2절 정직성 6원칙을 컴포넌트로 굳혀둔 것이라, 여기를 손대면
 *  앱의 정체성이 바뀐다.
 * ========================================================================== */

import type { ReactNode } from 'react';
import type { Confidence, EngineWarning } from '@/lib/types';
import { confidenceLabel } from '@/components/format';

/* ── 아이콘 (상태색은 절대 단독으로 의미를 나르지 않는다) ─────────────────── */

export function Icon({ name, className = '' }: { name: 'warn' | 'info' | 'good' | 'stop' | 'blur' | 'up' | 'down' | 'flat' | 'star' | 'chevron'; className?: string }) {
  const common = {
    width: 16, height: 16, viewBox: '0 0 16 16',
    fill: 'none', stroke: 'currentColor', strokeWidth: 1.6,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    className, 'aria-hidden': true,
  };
  switch (name) {
    case 'warn':
      return <svg {...common}><path d="M8 2.8 14.2 13.2H1.8L8 2.8Z" /><path d="M8 6.6v3" /><path d="M8 11.6h.01" /></svg>;
    case 'stop':
      return <svg {...common}><circle cx="8" cy="8" r="5.8" /><path d="M5.6 5.6l4.8 4.8" /></svg>;
    case 'good':
      return <svg {...common}><circle cx="8" cy="8" r="5.8" /><path d="M5.6 8.2l1.7 1.7 3.2-3.5" /></svg>;
    case 'info':
      return <svg {...common}><circle cx="8" cy="8" r="5.8" /><path d="M8 7.4v3.4" /><path d="M8 5.2h.01" /></svg>;
    case 'blur':
      return <svg {...common}><path d="M2.2 8s2.4-4 5.8-4 5.8 4 5.8 4-2.4 4-5.8 4S2.2 8 2.2 8Z" strokeDasharray="2.4 2" /><circle cx="8" cy="8" r="1.6" /></svg>;
    case 'up':
      return <svg {...common}><path d="M8 12.5V3.5" /><path d="M4.2 7.3 8 3.5l3.8 3.8" /></svg>;
    case 'down':
      return <svg {...common}><path d="M8 3.5v9" /><path d="M4.2 8.7 8 12.5l3.8-3.8" /></svg>;
    case 'flat':
      return <svg {...common}><path d="M3 8h10" /></svg>;
    case 'star':
      return <svg {...common} fill="currentColor" stroke="none"><path d="M8 1.9l1.85 3.75 4.14.6-3 2.92.71 4.12L8 11.34l-3.7 1.95.7-4.12-2.99-2.92 4.14-.6L8 1.9Z" /></svg>;
    case 'chevron':
      return <svg {...common}><path d="M6 3.5 10.5 8 6 12.5" /></svg>;
  }
}

/* ── 레이아웃 ────────────────────────────────────────────────────────────── */

export function Card({
  children, className = '', as: As = 'section',
}: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'li' | 'article' }) {
  return (
    <As
      className={`rounded-2xl border border-[var(--e-border)] bg-[var(--e-surface)] ${className}`}
    >
      {children}
    </As>
  );
}

export function SectionTitle({
  title, hint, right,
}: { title: string; hint?: string; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight text-[var(--e-ink)]">{title}</h2>
        {hint ? <p className="mt-0.5 text-[12px] leading-snug text-[var(--e-muted)]">{hint}</p> : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

/* ── 배지 ────────────────────────────────────────────────────────────────── */

type Tone = 'neutral' | 'info' | 'good' | 'warn' | 'serious' | 'critical';

const TONE: Record<Tone, { bg: string; fg: string; bd: string }> = {
  neutral:  { bg: 'var(--e-surface-2)', fg: 'var(--e-ink-2)',   bd: 'var(--e-border)' },
  info:     { bg: 'var(--e-accent-soft)', fg: 'var(--e-accent)', bd: 'transparent' },
  good:     { bg: 'color-mix(in srgb, var(--e-good) 12%, transparent)',     fg: 'var(--e-good)',     bd: 'transparent' },
  warn:     { bg: 'color-mix(in srgb, var(--e-warn) 18%, transparent)',     fg: 'var(--e-ink)',      bd: 'color-mix(in srgb, var(--e-warn) 55%, transparent)' },
  serious:  { bg: 'color-mix(in srgb, var(--e-serious) 16%, transparent)',  fg: 'var(--e-ink)',      bd: 'color-mix(in srgb, var(--e-serious) 55%, transparent)' },
  critical: { bg: 'color-mix(in srgb, var(--e-critical) 14%, transparent)', fg: 'var(--e-critical)', bd: 'transparent' },
};

export function Badge({
  tone = 'neutral', icon, children,
}: { tone?: Tone; icon?: 'warn' | 'info' | 'good' | 'stop' | 'blur'; children: ReactNode }) {
  const t = TONE[tone];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-[3px] text-[11px] font-medium leading-none"
      style={{ background: t.bg, color: t.fg, borderColor: t.bd }}
    >
      {icon ? <Icon name={icon} className="h-3 w-3" /> : null}
      {children}
    </span>
  );
}

export function ConfidenceBadge({ c }: { c: Confidence }) {
  const tone: Tone = c === 'high' ? 'good' : c === 'medium' ? 'neutral' : 'warn';
  return <Badge tone={tone} icon={c === 'low' ? 'warn' : c === 'high' ? 'good' : 'info'}>{confidenceLabel(c)}</Badge>;
}

/* ── 정직성 4원칙: 모르면 흐리게 ─────────────────────────────────────────── */

/**
 * ready=false 이면 children 을 blur 처리하고 그 위에 "무엇을 넣어야 보이는지"를
 * 띄운다. 가정으로 메꾸는 대신 모른다고 말하고 입력을 유도하는 자리.
 * hover 로 걷히지 않는다 — 데이터를 넣어야만 걷힌다.
 */
export function BlurGate({
  ready, message, cta, children,
}: { ready: boolean; message: string; cta?: ReactNode; children: ReactNode }) {
  if (ready) return <>{children}</>;
  return (
    <div className="relative isolate">
      <div className="e-blur" aria-hidden>{children}</div>
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 px-4 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--e-border-strong)] bg-[var(--e-surface)] px-3 py-1.5 text-[12px] font-medium text-[var(--e-ink)] shadow-sm">
          <Icon name="blur" className="h-3.5 w-3.5 text-[var(--e-muted)]" />
          {message}
        </span>
        {cta}
      </div>
    </div>
  );
}

/** 규칙 6 — 경계선은 고백한다. */
export function CoinFlipNote({ children }: { children?: ReactNode }) {
  return (
    <p
      className="flex items-start gap-1.5 rounded-lg px-2.5 py-2 text-[12px] leading-snug"
      style={{
        background: 'color-mix(in srgb, var(--e-warn) 14%, transparent)',
        color: 'var(--e-ink)',
      }}
    >
      <Icon name="warn" className="mt-[1px] h-3.5 w-3.5 shrink-0" />
      <span>{children ?? '이 예측은 사실상 동전던지기입니다. 작은 변화에도 결과가 뒤집힙니다.'}</span>
    </p>
  );
}

export function WarningList({ warnings }: { warnings: EngineWarning[] }) {
  if (warnings.length === 0) return null;
  const toneFor = (c: EngineWarning['code']): Tone =>
    c === 'ATTENDANCE_RISK' ? 'critical'
    : c === 'BORDERLINE' || c === 'SMALL_CLASS' ? 'warn'
    : 'neutral';

  return (
    <ul className="flex flex-col gap-1.5">
      {warnings.map((w, i) => {
        const t = TONE[toneFor(w.code)];
        return (
          <li
            key={`${w.code}-${i}`}
            className="flex items-start gap-1.5 rounded-lg px-2.5 py-2 text-[12px] leading-snug"
            style={{ background: t.bg, color: 'var(--e-ink)' }}
          >
            <Icon name={w.code === 'ATTENDANCE_RISK' ? 'stop' : 'warn'} className="mt-[1px] h-3.5 w-3.5 shrink-0" />
            <span>{w.message}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** 목 데이터로 떨어졌을 때 숨기지 않는다. */
export function SourceBanner({ source, note }: { source: 'api' | 'mock'; note?: string }) {
  if (source === 'api') return null;
  return (
    <div
      className="flex items-start gap-1.5 rounded-xl px-3 py-2 text-[12px] leading-snug"
      style={{ background: 'var(--e-surface-2)', color: 'var(--e-ink-2)' }}
    >
      <Icon name="info" className="mt-[1px] h-3.5 w-3.5 shrink-0" />
      <span>
        <b className="font-semibold text-[var(--e-ink)]">지금 보이는 건 예시 데이터입니다.</b>{' '}
        {note ? `${note}라 임시 데이터를 대신 띄우고 있습니다.` : '실제 값이 아닙니다.'}
      </span>
    </div>
  );
}

/* ── 조각들 ──────────────────────────────────────────────────────────────── */

export function StatTile({
  label, value, unit, sub, accent,
}: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; accent?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium text-[var(--e-muted)]">{label}</span>
      <span className="flex items-baseline gap-1">
        <span
          className="text-[22px] font-semibold leading-none tracking-tight tabular-nums"
          style={{ color: accent ?? 'var(--e-ink)' }}
        >
          {value}
        </span>
        {unit ? <span className="text-[12px] text-[var(--e-muted)]">{unit}</span> : null}
      </span>
      {sub ? <span className="mt-0.5 text-[11px] leading-snug text-[var(--e-muted)]">{sub}</span> : null}
    </div>
  );
}

export function PillTabs<T extends string>({
  value, options, onChange, ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex gap-1 rounded-full border border-[var(--e-border)] bg-[var(--e-surface-2)] p-1"
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className="flex-1 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors"
            style={{
              background: on ? 'var(--e-surface)' : 'transparent',
              color: on ? 'var(--e-ink)' : 'var(--e-muted)',
              boxShadow: on ? '0 1px 2px rgb(0 0 0 / 0.08)' : undefined,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Stars({
  value, onChange, size = 18,
}: { value: number; onChange?: (v: number) => void; size?: number }) {
  const interactive = typeof onChange === 'function';
  return (
    <span className="inline-flex items-center gap-0.5" role={interactive ? 'radiogroup' : undefined} aria-label={interactive ? '별점' : undefined}>
      {[1, 2, 3, 4, 5].map((n) => {
        const on = n <= Math.round(value);
        const star = (
          <Icon
            name="star"
            className="shrink-0"
          />
        );
        const style = { color: on ? 'var(--e-warn)' : 'var(--e-border-strong)', width: size, height: size };
        return interactive ? (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={n === Math.round(value)}
            aria-label={`${n}점`}
            onClick={() => onChange!(n)}
            className="p-0.5 leading-none"
            style={style}
          >
            {star}
          </button>
        ) : (
          <span key={n} className="leading-none" style={style}>{star}</span>
        );
      })}
    </span>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-[var(--e-border-strong)] px-3 py-6 text-center text-[13px] text-[var(--e-muted)]">
      {children}
    </p>
  );
}
