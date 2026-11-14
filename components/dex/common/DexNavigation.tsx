'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
const ITEMS=[['/dex','도감 홈'],['/dex/meal','학식도감'],['/dex/people','인연도감'],['/dex/custom','자유도감']] as const;
export function DexNavigation(){const path=usePathname();return <nav className="dex-nav" aria-label="대학도감 메뉴">{ITEMS.map(([href,label])=><Link key={href} href={href} aria-current={(href==='/dex'?path===href:path===href||path.startsWith(href+'/'))?'page':undefined}>{label}</Link>)}</nav>;}
