'use client';

import { useState } from 'react';
import type { MealItem, MealReview } from '@/lib/types';
import { MEAL_RATING_OPTIONS, ratingToLabel } from '@/lib/meal/battle';
import { submitReview } from '@/components/data';
import { cafeteriaLabel, mealTimeLabel } from '@/components/format';
import { Icon } from '@/components/ui';

export function ReviewForm({
  item,
  alreadyRated = false,
  onDone,
}: {
  item: MealItem;
  alreadyRated?: boolean;
  onDone: (r: MealReview, source: 'api' | 'mock') => void;
}) {
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const locked = alreadyRated || submitted;

  async function send() {
    if (locked) {
      setMsg('사이트 접속 시 평점은 한 번만 매길 수 있습니다.');
      return;
    }
    if (rating === 0) {
      setMsg('평점 버튼(좋좋 · 느좋 · 안좋 · 좆) 중 하나를 먼저 골라주세요.');
      return;
    }
    setBusy(true);
    setMsg(null);
    const selectedLabel = ratingToLabel(rating);
    const res = await submitReview({
      mealItemId: item.id,
      rating,
      text: text.trim() || `[${selectedLabel}]`,
      nickname: nickname.trim() || '익명',
    });
    setBusy(false);
    setSubmitted(true);
    setRating(0);
    setText('');
    setMsg(
      res.source === 'mock'
        ? '아직 서버에 저장되지 않았습니다. 이 화면에만 남습니다.'
        : `'${selectedLabel}' 후기가 등록되었습니다. 대결 점수에 반영됩니다.`,
    );
    onDone(res.data, res.source);
  }

  return (
    <div className="rounded-xl border border-[var(--e-border)] bg-[var(--e-surface-2)] px-3 py-3">
      <p className="text-[12.5px] font-semibold text-[var(--e-ink)]">
        {cafeteriaLabel(item.cafeteria)} {mealTimeLabel(item.mealTime)}{item.name ? ` · ${item.name}` : ''} 어땠나요
      </p>

      <div className="mt-2 grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="식단 평점 선택">
        {MEAL_RATING_OPTIONS.map((opt) => {
          const active = rating === opt.rating;
          return (
            <button
              key={opt.label}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={busy || locked}
              onClick={() => setRating(opt.rating)}
              className="flex flex-col items-center justify-center rounded-lg border px-2 py-1.5 text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                background: active ? 'var(--e-accent)' : 'var(--e-surface)',
                color: active ? '#ffffff' : 'var(--e-ink)',
                borderColor: active ? 'var(--e-accent)' : 'var(--e-border)',
              }}
            >
              <span>{opt.label}</span>
              <span
                className="text-[10px] font-normal"
                style={{ color: active ? 'rgba(255,255,255,0.85)' : 'var(--e-muted)' }}
              >
                {opt.desc}
              </span>
            </button>
          );
        })}
      </div>

      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={60}
        disabled={busy || locked}
        placeholder={locked ? '이미 평점을 매겼습니다' : '한 줄 후기 (선택)'}
        aria-label="한 줄 후기"
        className="mt-2.5 w-full rounded-lg border border-[var(--e-border)] bg-[var(--e-surface)] px-3 py-2 text-[13px] text-[var(--e-ink)] outline-none placeholder:text-[var(--e-muted)] focus:border-[var(--e-accent)] disabled:opacity-50"
      />

      <div className="mt-2 flex items-center gap-2">
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          maxLength={12}
          disabled={busy || locked}
          placeholder="닉네임"
          aria-label="닉네임"
          className="w-28 rounded-lg border border-[var(--e-border)] bg-[var(--e-surface)] px-2.5 py-1.5 text-[12.5px] text-[var(--e-ink)] outline-none placeholder:text-[var(--e-muted)] focus:border-[var(--e-accent)] disabled:opacity-50"
        />
        <button
          type="button"
          onClick={send}
          disabled={busy || locked}
          className="ml-auto rounded-full px-4 py-2 text-[12.5px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: 'var(--e-accent)' }}
        >
          {busy ? '보내는 중…' : locked ? '평가 완료' : '후기 남기기'}
        </button>
      </div>

      {msg ? (
        <p className="mt-2 flex items-start gap-1.5 text-[11.5px] leading-snug text-[var(--e-muted)]">
          <Icon name="info" className="mt-[1px] h-3 w-3 shrink-0" />
          {msg}
        </p>
      ) : null}
    </div>
  );
}
