'use client';

/* ==========================================================================
 *  components/home/HpHearts.tsx — 하트 줄 + 끝의 F
 * --------------------------------------------------------------------------
 *  하트는 게이지가 아니라 "눈으로 세는 수" 다. 그래서 반 칸까지만 쪼개고
 *  옆에 숫자를 항상 같이 적는다 — 색만으로 의미를 나르지 않는다는 규칙은
 *  차트에만 걸리는 게 아니다.
 *
 *  줄 끝의 F 칩이 이 화면의 핵심이다. 하트가 "줄어드는 것" 과 "F 로 떨어지는 것"
 *  이 같은 줄에 있어야 둘이 같은 사건이라는 게 보인다.
 * ========================================================================== */

import { useId } from 'react';
import Link from 'next/link';
import type { CourseHp } from '@/components/home/hp';
import { HP_COLOR, HP_WORD, heartCount } from '@/components/home/hp';
import { Icon } from '@/components/ui';

const HEART_PATH =
  'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';

/** 한 칸. fill 1=꽉, 0.5=반, 0=빈칸 */
function Heart({ fill, size = 22 }: { fill: 0 | 0.5 | 1; size?: number }) {
  const id = useId();
  const paint =
    fill === 1 ? 'var(--e-hp)' : fill === 0 ? 'var(--e-hp-empty)' : `url(#${id})`;

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0">
      {fill === 0.5 ? (
        <defs>
          {/* 반 칸은 지각 환산분이다. 그라데이션이 아니라 딱 끊긴 경계여야 한다 */}
          <linearGradient id={id} x1="0" x2="1" y1="0" y2="0">
            <stop offset="50%" stopColor="var(--e-hp)" />
            <stop offset="50%" stopColor="var(--e-hp-empty)" />
          </linearGradient>
        </defs>
      ) : null}
      <path d={HEART_PATH} fill={paint} />
    </svg>
  );
}

function slots(hp: CourseHp): (0 | 0.5 | 1)[] {
  const out: (0 | 0.5 | 1)[] = [];
  let left = hp.left;
  for (let i = 0; i < hp.total; i += 1) {
    out.push(left >= 1 ? 1 : left >= 0.5 ? 0.5 : 0);
    left -= 1;
  }
  return out;
}

/** 출결 장부가 아예 없을 때. 하트를 0 개로 그리면 "F" 라고 거짓말하는 셈이 된다. */
export function HeartsUnknown() {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <div className="flex items-center gap-[3px] opacity-45">
        {[0, 1, 2].map((i) => (
          <Heart key={i} fill={0} size={20} />
        ))}
        <span className="ml-1 text-[13px] font-semibold text-[var(--e-muted)]">?</span>
      </div>
      <p className="text-[12px] leading-snug text-[var(--e-muted)]">
        출결 장부가 없어 하트를 못 셉니다 —{' '}
        <Link href="/grade" className="font-medium text-[var(--e-accent)]">
          결석 한도 넣기
        </Link>
      </p>
    </div>
  );
}

export function HpHearts({ hp }: { hp: CourseHp }) {
  const row = slots(hp);
  const color = HP_COLOR[hp.level];
  const dead = hp.level === 'fail';

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <div
          className="flex items-center gap-[3px]"
          role="img"
          aria-label={`${hp.courseName} 결석 한도 ${hp.total}회 중 ${heartCount(hp.left)}회 남음`}
        >
          {row.map((f, i) => (
            <Heart key={i} fill={f} />
          ))}
        </div>

        {/* 하트 줄의 종착지. 비어 있으면 회색, 다 떨어지면 켜진다 */}
        <span
          className={`ml-0.5 inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-md border px-1.5 text-[12px] font-bold leading-none ${dead ? 'e-pop' : ''}`}
          style={{
            borderColor: dead ? 'var(--e-critical)' : 'var(--e-border-strong)',
            background: dead ? 'var(--e-critical)' : 'transparent',
            color: dead ? '#fff' : 'var(--e-muted)',
          }}
          aria-hidden
        >
          F
        </span>
      </div>

      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] leading-snug">
        <span className="font-semibold tabular-nums" style={{ color }}>
          {heartCount(hp.left)} / {hp.total}
        </span>
        <span className="text-[var(--e-muted)]">·</span>
        <span className="inline-flex items-center gap-1 font-medium" style={{ color }}>
          <Icon
            name={hp.level === 'fail' ? 'stop' : hp.level === 'ok' ? 'good' : 'warn'}
            className="h-3.5 w-3.5"
          />
          {HP_WORD[hp.level]}
        </span>
        <span className="text-[var(--e-muted)]">
          — {hp.courseName} 유효 결석 {heartCount(hp.used)}회
        </span>
      </p>
    </div>
  );
}

/** 과목이 여러 개일 때 나머지를 한 줄씩. 평균을 내지 않는 이유는 hp.ts 주석에 있다. */
export function HpRoster({ list }: { list: CourseHp[] }) {
  if (list.length === 0) return null;

  return (
    <ul className="flex flex-col gap-1">
      {list.map((hp) => (
        <li key={hp.courseId} className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--e-ink-2)]">
            {hp.courseName}
          </span>
          <span className="flex items-center gap-[2px]">
            {slots(hp).map((f, i) => (
              <Heart key={i} fill={f} size={13} />
            ))}
          </span>
          <span
            className="w-[52px] shrink-0 text-right text-[11px] font-semibold tabular-nums"
            style={{ color: HP_COLOR[hp.level] }}
          >
            {heartCount(hp.left)}/{hp.total}
          </span>
        </li>
      ))}
    </ul>
  );
}
