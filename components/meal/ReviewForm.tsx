'use client';

import { useState } from 'react';
import type { MealItem, MealReview } from '@/lib/types';
import { submitReview } from '@/components/data';
import { cafeteriaLabel, mealTimeLabel } from '@/components/format';
import { Icon, Stars } from '@/components/ui';

export function ReviewForm({
  item,
  onDone,
}: {
  item: MealItem;
  onDone: (r: MealReview, source: 'api' | 'mock') => void;
}) {
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function send() {
    if (rating === 0) {
      setMsg('별점을 먼저 골라주세요.');
      return;
    }
    setBusy(true);
    setMsg(null);
    const res = await submitReview({
      mealItemId: item.id,
      rating,
      text: text.trim(),
      nickname: nickname.trim() || '익명',
    });
    setBusy(false);
    setRating(0);
    setText('');
    setMsg(
      res.source === 'mock'
        ? '아직 서버에 저장되지 않았습니다. 이 화면에만 남습니다.'
        : '후기 고맙습니다. 대결 점수에 반영됩니다.',
    );
    onDone(res.data, res.source);
  }

  return (
    <div className="rounded-xl border border-[var(--e-border)] bg-[var(--e-surface-2)] px-3 py-3">
      <p className="text-[12.5px] font-semibold text-[var(--e-ink)]">
        {cafeteriaLabel(item.cafeteria)} {mealTimeLabel(item.mealTime)} 어땠나요
      </p>

      <div className="mt-2 flex items-center gap-2">
        <Stars value={rating} onChange={setRating} />
        <span className="text-[11.5px] text-[var(--e-muted)]">
          {rating === 0 ? '별점을 골라주세요' : `${rating}점`}
        </span>
      </div>

      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={60}
        placeholder="한 줄 (선택)"
        aria-label="한 줄 후기"
        className="mt-2.5 w-full rounded-lg border border-[var(--e-border)] bg-[var(--e-surface)] px-3 py-2 text-[13px] text-[var(--e-ink)] outline-none placeholder:text-[var(--e-muted)] focus:border-[var(--e-accent)]"
      />

      <div className="mt-2 flex items-center gap-2">
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          maxLength={12}
          placeholder="닉네임"
          aria-label="닉네임"
          className="w-28 rounded-lg border border-[var(--e-border)] bg-[var(--e-surface)] px-2.5 py-1.5 text-[12.5px] text-[var(--e-ink)] outline-none placeholder:text-[var(--e-muted)] focus:border-[var(--e-accent)]"
        />
        <button
          type="button"
          onClick={send}
          disabled={busy}
          className="ml-auto rounded-full px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-50"
          style={{ background: 'var(--e-accent)' }}
        >
          {busy ? '보내는 중…' : '후기 남기기'}
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
