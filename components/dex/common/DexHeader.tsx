'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useDexDocument } from '@/components/dex/scaffold/useDexDocument';

/** Figma BOKAK v6 (160:6) 헤더 — 포켓 글리프 + 제품명 + 수집 현황. */
export function DexHeader() {
  const path = usePathname();
  const { data } = useDexDocument();
  const count = data?.entries.length;
  // 하위 도감 화면은 자기 화면 헤더(DexPageHeader)를 쓴다.
  if (path !== '/dex') return null;
  return <header className="dex-header">
    <Link href="/dex" className="bk-header-brand">
      <span className="bk-header-pocket" aria-hidden="true"><i/><i/><i/></span>
      <span className="bk-header-text">
        <strong>복학수첩</strong>
        <span className="bk-header-sub">{count === undefined ? '기록을 불러오는 중…' : `${count}장 수집 · 이 브라우저에 저장`}</span>
      </span>
    </Link>
  </header>;
}
