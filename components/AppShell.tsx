import type { ReactNode } from 'react';
import Link from 'next/link';
import { TabBar } from '@/components/TabBar';
import './theme.css';

/**
 * 모든 화면의 껍데기. app/layout.tsx 는 조율자 소유라 건드리지 않고,
 * 여기서 폰트/배경/탭바를 잡는다. (globals.css 의 body { font-family: Arial }
 * 를 덮기 위해 .erica 에서 font-family 를 다시 지정한다.)
 */
export function AppShell({
  title,
  subtitle,
  back,
  children,
}: {
  title: string;
  subtitle?: string;
  back?: { href: string; label: string };
  children: ReactNode;
}) {
  return (
    <div
      className="erica flex min-h-dvh flex-1 flex-col bg-[var(--e-bg)] text-[var(--e-ink)]"
      style={{ fontFamily: 'var(--font-geist-sans), system-ui, -apple-system, "Apple SD Gothic Neo", sans-serif' }}
    >
      <header className="sticky top-0 z-20 border-b border-[var(--e-border)] bg-[var(--e-bg)]/90 backdrop-blur">
        <div className="mx-auto w-full max-w-lg px-4 pb-3 pt-4">
          {back ? (
            <Link
              href={back.href}
              className="mb-1.5 inline-flex items-center gap-1 text-[12px] text-[var(--e-muted)]"
            >
              <span aria-hidden>←</span>
              {back.label}
            </Link>
          ) : null}
          <h1 className="text-[19px] font-bold tracking-tight">{title}</h1>
          {subtitle ? (
            <p className="mt-0.5 text-[12.5px] leading-snug text-[var(--e-muted)]">{subtitle}</p>
          ) : null}
        </div>
      </header>

      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-4">{children}</main>

      <TabBar />
    </div>
  );
}
