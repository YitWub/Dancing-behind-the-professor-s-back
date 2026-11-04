'use client';

/* ==========================================================================
 *  components/home/CustomizeSheet.tsx — 꾸미기
 * --------------------------------------------------------------------------
 *  고를 수 있는 건 이름·몸 색·모자·소품 네 개뿐이다. 표정은 없다.
 *  표정을 고를 수 있으면 하트가 0 개인 캐릭터를 웃게 만들 수 있고,
 *  그 순간 이 화면은 상태를 보여주는 화면이 아니게 된다.
 * ========================================================================== */

import type { Avatar, HatId, ItemId, SkinId } from '@/components/home/avatar';
import { HATS, ITEMS, NAME_MAX, SKINS } from '@/components/home/avatar';
import { Icon } from '@/components/ui';

const SKIN_IDS = Object.keys(SKINS) as SkinId[];

function Chips<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[11.5px] font-medium text-[var(--e-muted)]">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = o.id === value;
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(o.id)}
              className="rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors"
              style={{
                borderColor: on ? 'var(--e-accent)' : 'var(--e-border)',
                background: on ? 'var(--e-accent-soft)' : 'var(--e-surface-2)',
                color: on ? 'var(--e-accent)' : 'var(--e-ink-2)',
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function CustomizeSheet({
  avatar,
  onChange,
}: {
  avatar: Avatar;
  onChange: (next: Avatar) => void;
}) {
  const set = <K extends keyof Avatar>(k: K, v: Avatar[K]) => onChange({ ...avatar, [k]: v });

  return (
    <div className="flex flex-col gap-3.5">
      {/* 이름 */}
      <div>
        <label
          htmlFor="avatar-name"
          className="mb-1.5 block text-[11.5px] font-medium text-[var(--e-muted)]"
        >
          이름 (최대 {NAME_MAX}자)
        </label>
        <input
          id="avatar-name"
          value={avatar.name}
          maxLength={NAME_MAX}
          onChange={(e) => set('name', e.target.value)}
          onBlur={(e) => {
            // 빈 이름으로 저장되면 말풍선이 "님, ..." 처럼 깨진다
            if (e.target.value.trim() === '') set('name', '에리');
          }}
          className="w-full rounded-xl border border-[var(--e-border)] bg-[var(--e-surface-2)] px-3 py-2.5 text-[14px] font-semibold text-[var(--e-ink)] outline-none focus:border-[var(--e-accent)]"
          placeholder="에리"
        />
      </div>

      {/* 몸 색 */}
      <div>
        <p className="mb-1.5 text-[11.5px] font-medium text-[var(--e-muted)]">몸 색</p>
        <div className="flex flex-wrap gap-2">
          {SKIN_IDS.map((id) => {
            const s = SKINS[id];
            const on = id === avatar.skin;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={on}
                aria-label={s.label}
                title={s.label}
                onClick={() => set('skin', id)}
                className="relative h-10 w-10 rounded-full border-2 transition-transform active:scale-95"
                style={{
                  background: s.body,
                  borderColor: on ? 'var(--e-accent)' : 'var(--e-border-strong)',
                  boxShadow: on ? '0 0 0 3px var(--e-accent-soft)' : undefined,
                }}
              >
                {on ? (
                  // 체크 색은 몸 색의 잉크를 따라간다 — '숯' 위에 검은 체크를 올리면 안 보인다
                  <span className="absolute inset-0 flex items-center justify-center" style={{ color: s.ink }}>
                    <Icon name="good" className="h-4 w-4" />
                  </span>
                ) : null}
                <span className="sr-only">{s.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <Chips<HatId>
        label="모자"
        value={avatar.hat}
        options={HATS}
        onChange={(v) => set('hat', v)}
      />
      <Chips<ItemId>
        label="소품"
        value={avatar.item}
        options={ITEMS}
        onChange={(v) => set('item', v)}
      />

      <p className="flex items-start gap-1.5 text-[11.5px] leading-snug text-[var(--e-muted)]">
        <Icon name="info" className="mt-[1px] h-3.5 w-3.5 shrink-0" />
        표정은 고를 수 없습니다. 하트와 오늘 먹인 끼니가 정합니다.
      </p>
    </div>
  );
}
