'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/** Figma BOKAK v6 (106:2) 의 하단 언더바. 글리프는 전부 사각 기반이고 원형은 쓰지 않는다. */
function Spines() { // 홈 — 책등 세 권
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="4" height="12" rx="1"/><rect x="9" y="4" width="4" height="15" rx="1"/><rect x="15" y="8" width="4" height="11" rx="1"/><rect x="2" y="20" width="20" height="2" rx="1"/></svg>;
}
function Binder() { // 도감 — 바인더와 링
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="3" width="14" height="18" rx="2"/><rect x="2" y="6" width="6" height="3.2" rx="1.6"/><rect x="2" y="13" width="6" height="3.2" rx="1.6"/></svg>;
}
function TrainerCard() { // 나 — 학생증
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2.5"/><circle cx="8.5" cy="12" r="3" fill="var(--bk-surface)"/><rect x="13.5" y="9.5" width="6" height="2" rx="1" fill="var(--bk-surface)"/><rect x="13.5" y="13.5" width="4.5" height="2" rx="1" fill="var(--bk-surface)" opacity=".7"/></svg>;
}
function Pin() { // 보드 — 압정
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="5.5"/><rect x="10.8" y="12" width="2.4" height="9" rx="1.2"/></svg>;
}
function Pocket() { // 수집 FAB — 슬리브에 꽂힌 카드
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="2" width="12" height="11" rx="1.5"/><rect x="3" y="10" width="18" height="11" rx="2" opacity=".55"/><rect x="3" y="10" width="18" height="2.4" rx="1.2"/></svg>;
}

type Item = { href: string; label: string; icon: ReactNode };
const LEFT: Item[] = [
  { href: '/dex', label: '홈', icon: <Spines/> },
  { href: '/dex/meal', label: '도감', icon: <Binder/> },
];
const RIGHT: Item[] = [
  { href: '/dex/people', label: '보드', icon: <Pin/> },
  { href: '/dex/me', label: '나', icon: <TrainerCard/> },
];
export function DexNavigation() {
  const path = usePathname();
  const on = (href: string) => href === '/dex' ? path === href : path === href || path.startsWith(href + '/');
  const tab = (it: Item) => <Link key={it.href} href={it.href} className="bk-tab" aria-current={on(it.href) ? 'page' : undefined}>
    <span className="bk-tab-icon">{it.icon}</span><span className="bk-tab-label">{it.label}</span>
  </Link>;
  return <nav className="bk-underbar" aria-label="대학도감 메뉴">
      <div className="bk-underbar-inner">
        {LEFT.map(tab)}
        <Link href="/dex/meal/collection" className="bk-fab" aria-label="오늘 한 장 꽂기">
          <span className="bk-fab-icon"><Pocket/></span>
        </Link>
        {RIGHT.map(tab)}
    </div>
  </nav>;
}
