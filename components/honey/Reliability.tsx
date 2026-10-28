'use client';

/* ==========================================================================
 *  신뢰도 — 이 필러의 차별점
 * --------------------------------------------------------------------------
 *  표본 4건짜리 강의가 "꿀강지수 87"로 1위에 떠 있으면 앱이 죽는다.
 *  그래서 점수는 신뢰도를 통과해야만 선명하게 나온다.
 *  ★ ReliabilityVerdict 는 카드마다 예외 없이 노출된다.
 *
 *  라벨 정본은 lib/honey (FLAG_LABELS / BAND_LABELS / honeyBandLabel).
 *  화면에서 번역어를 새로 만들지 않는다.
 * ========================================================================== */

import type { Lecture, ReliabilityVerdict } from '@/lib/types';
import {
  flagChip, flagText, honeyScoreCaption, sampleBadge, seedDisclaimer, shouldBlurScore,
} from '@/components/format';
import { Badge, Icon } from '@/components/ui';

/** 카드마다 붙는 한 줄짜리 신뢰도 배지. */
export function ReliabilityBadge({ lecture }: { lecture: Lecture }) {
  const r = lecture.reliability;
  const badge = sampleBadge(lecture.reviewCount, r);

  if (!badge) {
    return <Badge tone="good" icon="good">강의평 {lecture.reviewCount}건 — 믿을 만함</Badge>;
  }
  return (
    <Badge tone={r.band === 'low' ? 'warn' : 'neutral'} icon="warn">
      {badge}
    </Badge>
  );
}

/** flags 를 코드가 아니라 팀 공용 한국어 라벨 칩으로. */
export function FlagChips({ r }: { r: ReliabilityVerdict }) {
  if (r.flags.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {r.flags.map((f) => (
        <li
          key={f}
          className="rounded-full border px-2 py-[3px] text-[10.5px] font-medium"
          style={{
            background: 'color-mix(in srgb, var(--e-warn) 14%, transparent)',
            borderColor: 'color-mix(in srgb, var(--e-warn) 45%, transparent)',
            color: 'var(--e-ink)',
          }}
        >
          {flagChip(f)}
        </li>
      ))}
    </ul>
  );
}

/**
 * 꿀강지수.
 *  · null 이면 숫자 자리에 "판단 불가 — 강의평 없음"
 *  · 신뢰도가 낮으면 숫자를 흐리게 (규칙 4)
 *  · 어떤 경우에도 숫자만 크게 띄우지 않고 honeyBandLabel 문구를 같이 붙인다 (규칙 1)
 */
export function HoneyScore({ lecture, size = 'md' }: { lecture: Lecture; size?: 'md' | 'lg' }) {
  const caption = honeyScoreCaption(lecture);
  const big = size === 'lg';

  if (lecture.honeyScore == null) {
    return (
      <div className={`flex flex-col ${big ? 'items-end' : 'items-end'} max-w-[132px]`}>
        <span className={`${big ? 'text-[15px]' : 'text-[12.5px]'} text-right font-semibold leading-tight text-[var(--e-muted)]`}>
          {caption}
        </span>
      </div>
    );
  }

  const blur = shouldBlurScore(lecture.reliability);
  return (
    <div className="flex max-w-[136px] flex-col items-end">
      <span className={blur ? 'e-blur' : undefined}>
        <span
          className={`${big ? 'text-[34px]' : 'text-[22px]'} font-bold leading-none tabular-nums`}
          style={{ color: blur ? 'var(--e-muted)' : 'var(--e-ord-4)' }}
        >
          {Math.round(lecture.honeyScore)}
        </span>
      </span>
      <span className="mt-1 text-right text-[10.5px] leading-tight text-[var(--e-muted)]">
        {blur ? '표본 부족으로 가림' : caption}
      </span>
    </div>
  );
}

/** 칩만으로는 왜 깎였는지 모른다. 펼쳤을 때의 긴 설명. */
export function ReliabilityReasons({ r, compact = false }: { r: ReliabilityVerdict; compact?: boolean }) {
  const items = r.flags.map(flagText);
  if (items.length === 0 && r.band === 'high') return null;

  const shown = compact ? items.slice(0, 1) : items;

  return (
    <ul className="flex flex-col gap-1">
      {shown.map((t, i) => (
        <li key={i} className="flex items-start gap-1.5 text-[11.5px] leading-snug text-[var(--e-muted)]">
          <Icon name="warn" className="mt-[1px] h-3 w-3 shrink-0 text-[var(--e-warn)]" />
          <span>{t}</span>
        </li>
      ))}
      {compact && items.length > 1 ? (
        <li className="pl-[18px] text-[11.5px] text-[var(--e-muted)]">외 {items.length - 1}가지 더</li>
      ) : null}
      {!compact && r.reasons.length > 0 ? (
        <li className="mt-1.5 pl-[18px] text-[11px] leading-snug text-[var(--e-muted)]">
          근거: {r.reasons.join(' · ')}
        </li>
      ) : null}
    </ul>
  );
}

/** 시드(가상) 강의평 기반이라는 고지. 데이터 출처를 숨기지 않는다. */
export function SeedNotice({ lecture }: { lecture: Lecture }) {
  const t = seedDisclaimer(lecture);
  if (!t) return null;
  return (
    <p className="flex items-start gap-1.5 rounded-xl bg-[var(--e-surface-2)] px-3 py-2.5 text-[11.5px] leading-snug text-[var(--e-ink-2)]">
      <Icon name="info" className="mt-[1px] h-3.5 w-3.5 shrink-0 text-[var(--e-muted)]" />
      <span>{t}</span>
    </p>
  );
}

/** LLM 요약은 반드시 출처를 밝힌다 — 사람이 쓴 문장처럼 보이면 안 된다. */
export function AiSummary({ summary, reasons }: { summary: string | null; reasons?: string[] }) {
  // 축 추출이 LLM 이 아니라 휴리스틱이면 "AI 요약"이라고 부르면 안 된다.
  const heuristic = reasons?.some((r) => r.includes('휴리스틱') || r.includes('LLM 미사용')) ?? false;
  const tag = heuristic ? '자동 요약' : 'AI 요약';
  const how = heuristic
    ? '강의평 본문에서 키워드를 세어 만든 문장입니다 (모델을 쓰지 않았습니다)'
    : '강의평 본문을 모델이 읽고 정리했습니다';

  if (!summary) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--e-border-strong)] px-3 py-3 text-[12px] leading-relaxed text-[var(--e-muted)]">
        요약을 만들 만큼 강의평 본문이 쌓이지 않았습니다. 없는 요약을 지어내지 않았습니다.
      </p>
    );
  }

  return (
    <div className="rounded-xl bg-[var(--e-surface-2)] px-3 py-3">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span
          className="rounded-[4px] px-1.5 py-[2px] text-[10px] font-bold tracking-wide"
          style={{ background: 'var(--e-accent-soft)', color: 'var(--e-accent)' }}
        >
          {tag}
        </span>
        <span className="text-[10.5px] text-[var(--e-muted)]">{how}</span>
      </div>
      <p className="whitespace-pre-line text-[12.5px] leading-relaxed text-[var(--e-ink-2)]">{summary}</p>
      <p className="mt-2 text-[10.5px] leading-snug text-[var(--e-muted)]">
        원문을 줄인 것이라 사실관계가 틀릴 수 있습니다. 판단은 아래 축과 신뢰도를 같이 보고 하세요.
      </p>
    </div>
  );
}
