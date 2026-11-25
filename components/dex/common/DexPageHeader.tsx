'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';

/** Figma BOKAK v6 도감 화면 헤더(160:727) — 뒤로 + 제목 + 현황 + 우측 동작. */
export function DexPageHeader({ backHref, title, summary, action }: {
  backHref: string; title: string; summary?: string; action?: ReactNode;
}) {
  return <header className="bk-page-header">
    <Link href={backHref} className="bk-page-back" aria-label="뒤로">‹</Link>
    <span className="bk-page-text">
      <strong>{title}</strong>
      {summary ? <span>{summary}</span> : null}
    </span>
    {action ? <span className="bk-page-action">{action}</span> : null}
  </header>;
}
