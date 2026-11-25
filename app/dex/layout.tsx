import Link from 'next/link';
import type { ReactNode } from 'react';
import '@/components/theme.css';
import './dex.css';
import './theme-bokak.css';
import '@/components/dex/common/AlbumFrame.css';
import { DexNavigation } from '@/components/dex/common/DexNavigation';
import { DexHeader } from '@/components/dex/common/DexHeader';

export default function DexLayout({children}:{children:ReactNode}) {
  return <div lang="ko" data-bokak-theme="military" className="erica dex-world min-h-dvh bg-[var(--e-bg)] text-[var(--e-ink)]">
    <div className="dex-shell space-y-6">
      <DexHeader/>
      <DexNavigation/>
      <main>{children}</main>
      <footer className="dex-footer"><strong>복학수첩 · 나만의 대학도감</strong><p><Link href="/legacy" className="underline">기존 대학생활 도구 · 학점·꿀강·학식</Link></p><p>현재 사이트 주소와 브라우저 프로필에 저장돼요. 로그인·기기 간 동기화는 제공하지 않아요.<br/>같은 브라우저 프로필을 사용하는 사람은 기록에 접근할 수 있어요. 소중한 기록은 내보내기로 보관해 주세요.</p></footer>
    </div>
  </div>;
}
