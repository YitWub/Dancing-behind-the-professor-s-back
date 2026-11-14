'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const TABS: { href: string; label: string; icon: ReactNode }[] = [
  {
    href: '/legacy',
    label: '오늘',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3.5 8.5 10 3l6.5 5.5" /><path d="M5 8.2V16h10V8.2" />
      </svg>
    ),
  },
  {
    href: '/grade',
    label: '학점',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="4.5" width="14" height="11" rx="2" /><path d="M3 8.5h14" /><path d="M6.5 12h3" />
      </svg>
    ),
  },
  {
    href: '/honey',
    label: '꿀강',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M10 2.8 15.4 6v7L10 16.2 4.6 13V6L10 2.8Z" /><path d="M10 8.4 12.6 10v2.6L10 14l-2.6-1.4V10L10 8.4Z" />
      </svg>
    ),
  },
  {
    href: '/meal',
    label: '밥',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 11.5h14a6.2 6.2 0 0 1-6.2 5H9.2A6.2 6.2 0 0 1 3 11.5Z" /><path d="M7 8.2c0-1.2 1.2-1.5 1.2-2.6" /><path d="M10.4 8.2c0-1.2 1.2-1.5 1.2-2.6" />
      </svg>
    ),
  },
];

export function TabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="주요 화면"
      className="sticky bottom-0 z-30 border-t border-[var(--e-border)] bg-[var(--e-surface)]/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto flex max-w-lg">
        {TABS.map((t) => {
          const active = t.href === '/' ? pathname === '/' : pathname.startsWith(t.href);
          return (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                aria-current={active ? 'page' : undefined}
                className="flex flex-col items-center gap-0.5 py-2.5 transition-colors"
                style={{ color: active ? 'var(--e-accent)' : 'var(--e-muted)' }}
              >
                {t.icon}
                <span className="text-[11px] font-medium">{t.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
