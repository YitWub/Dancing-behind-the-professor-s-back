'use client';
import Link from 'next/link';
import { useState } from 'react';
import { CARD_EDITIONS } from '@/lib/dex/meal/card-editions';
import type { CardEdition } from '@/lib/dex/meal/card-editions';
import { DiscoveryReveal } from '@/components/dex/discovery/CollectionFeedback';
import { CollectionArtwork } from '@/components/dex/common/CollectionArtwork';
export function EditionPreview(){
  const [edition,setEdition]=useState<CardEdition>('NORMAL');
  const [opened,setOpened]=useState(false);
  if(process.env.NODE_ENV!=='development')return null;
  return <div className="space-y-4"><Link href="/dex/dev" className="dex-back">← 개발자 도구</Link><Link href="/dex/dev/collection" className="dex-back">컬렉션 실험실 열기 ↗</Link><h2>개발 전용 · 랜덤 카드 에디션 미리보기</h2><p>테스트 카드이며 실제 수집·저장·업적에는 반영되지 않아요. 메뉴 출현 희귀도와 별개예요.</p><div className="dex-preview-tiers">{CARD_EDITIONS.map(value=><button key={value} aria-pressed={edition===value} onClick={()=>setEdition(value)}>{value}</button>)}</div><button className="dex-button" onClick={()=>setOpened(true)}>카드 공개 미리보기</button>{opened?<DiscoveryReveal preview edition={edition} itemName="에디션 테스트 카드" title="랜덤 에디션 연출 미리보기" artwork={<CollectionArtwork kind="rice"/>} onDismiss={()=>setOpened(false)}/>:null}</div>;
}
