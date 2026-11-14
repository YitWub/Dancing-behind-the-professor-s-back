'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { RarityTier } from '@/lib/dex/game/types';
import { RarityBadge } from '@/components/dex/common/RarityBadge';
import { CollectionArtwork } from '@/components/dex/common/CollectionArtwork';
import { DiscoveryReveal } from '@/components/dex/discovery/CollectionFeedback';

const TIERS:readonly RarityTier[]=['COMMON','UNCOMMON','RARE','LEGENDARY','UNKNOWN'];
/** Pure visual sandbox. No repository, collect result, rarity policy, or persistence. */
export function RarityPreview(){
  const [tier,setTier]=useState<RarityTier>('UNKNOWN');
  const [opened,setOpened]=useState(false);
  if(process.env.NODE_ENV!=='development')return null;
  return <div className="dex-rarity-preview"><Link href="/dex/meal" className="dex-back">← 학식도감으로</Link>
    <span className="dex-eyebrow">DEVELOPMENT ONLY · VISUAL SANDBOX</span><h2>희귀도 카드 공개 미리보기</h2><p>테스트용 카드예요. 실제 메뉴에 등급을 적용하거나 수집·업적을 저장하지 않습니다.</p>
    <div className="dex-preview-tiers" role="group" aria-label="미리볼 희귀도">{TIERS.map(value=><button key={value} type="button" aria-pressed={tier===value} onClick={()=>setTier(value)}><span>{value}</span><RarityBadge tier={value}/></button>)}</div>
    <div className={`dex-preview-sample dex-rarity-frame--${tier.toLowerCase()}`}><CollectionArtwork kind="rice"/><div><span className="dex-tag">TEST CARD</span><h3>연출 테스트 카드</h3><RarityBadge tier={tier}/><p>음식 심볼은 재사용한 일러스트이며 실제 메뉴의 희귀도와 관계없어요.</p></div></div>
    <button className="dex-button" onClick={()=>setOpened(true)}>카드 공개 미리보기</button>
    <p className="dex-small dex-muted">모션 줄이기 설정을 따릅니다. 팝업에서 연출을 건너뛰거나 Escape로 닫을 수 있어요.</p>
    {opened?<DiscoveryReveal preview itemName="연출 테스트 카드" rarity={tier} title="희귀도 연출 미리보기" artwork={<CollectionArtwork kind="rice"/>} onDismiss={()=>setOpened(false)}/>:null}
  </div>;
}
