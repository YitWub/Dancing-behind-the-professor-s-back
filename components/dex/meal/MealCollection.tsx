'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useDexDocument } from '@/components/dex/scaffold/useDexDocument';
import type { DexDocument } from '@/lib/dex/core/types';
import { mealCards } from '@/lib/dex/meal/collection';
import { readOfferings } from '@/lib/dex/meal/catalog';
import type { CatalogOffering } from '@/lib/dex/meal/catalog';
import { kstToday } from '@/lib/datetime';
import { CollectionArtwork, mealArtwork } from '@/components/dex/common/CollectionArtwork';
import { CollectionCard, CollectionEmptyState } from '@/components/dex/common/CollectionCard';
import { mealPersonalCards } from '@/lib/dex/meal/game';
import { unknownMealRarity } from '@/lib/dex/meal/rarity';
import { MealGamePanel } from './MealGamePanel';

/** Known cards come only from a real stored offering date; this is not a complete school catalogue. */
export function MealCollectionPanel({data,onExplore}:{data:DexDocument;onExplore?:()=>void}) {
  const cards=mealCards(data);
  const personal=mealPersonalCards(data);
  const [now]=useState(()=>Date.now());
  const [known,setKnown]=useState<CatalogOffering[]>([]);
  const [knownDate,setKnownDate]=useState('');
  const [notice,setNotice]=useState('저장본에서 알려진 메뉴를 확인하고 있어요.');
  useEffect(()=>{
    const controller=new AbortController();let alive=true;
    void (async()=>{
      const today=await readOfferings({date:kstToday()},{signal:controller.signal});
      if(!today.ok){if(alive)setNotice('알려진 메뉴를 읽지 못했어요. 나의 수집 기록은 그대로 보관돼요.');return;}
      const day=today.value.availableDates.find(d=>d<=kstToday());
      const result=day&&day!==kstToday()?await readOfferings({date:day},{signal:controller.signal}):today;
      if(!alive)return;
      if(!result.ok){setNotice('알려진 메뉴를 읽지 못했어요.');return;}
      setKnownDate(day??'');setNotice(result.value.notice);
      setKnown([...new Map(result.value.offerings.filter(row=>row.selection).map(row=>[row.selection!.dishId,row])).values()]);
    })();
    return()=>{alive=false;controller.abort();};
  },[]);
  const owned=new Set(cards.map(c=>c.entry.subject.kind==='meal'?c.entry.subject.dishId:''));
  const unknown=known.filter(row=>!owned.has(row.selection!.dishId));
  return <div className="dex-collection-panel">
    <div className="dex-section-heading"><div><span className="dex-eyebrow">MY COLLECTION</span><h2>한 끼씩, 차곡차곡.</h2></div><span className="dex-count">고유 메뉴 <strong>{cards.length}</strong>개</span></div>
    {cards.length===0?<CollectionEmptyState onExplore={onExplore}/>:<div className="dex-card-grid">{cards.map(card=><CollectionCard key={card.entry.id} title={card.name} rarity={unknownMealRarity(card.entry.subject.kind==='meal'?card.entry.subject.dishId:'').tier} isNew={now-Date.parse(card.entry.firstCollectedAt)>=0&&now-Date.parse(card.entry.firstCollectedAt)<7*86400000} artwork={<CollectionArtwork kind={mealArtwork(card.name)}/>} href={`/dex/meal/collection/${card.entry.id}`} meta={<><span>먹은 기록 {card.experiences.length}회</span><span>{card.rating===null?'아직 평가 전':`★ ${card.rating} / 5`}</span></>}><p className="dex-card-note">{card.note??`첫 기록 ${card.entry.collectedOn}`}</p>{personal.find(p=>p.entryIds.includes(card.entry.id))?.affection?<p className="dex-affection">{personal.find(p=>p.entryIds.includes(card.entry.id))?.affection==='soul'?'♡ 나의 소울푸드':'↻ 나의 단골 메뉴'}</p>:null}</CollectionCard>)}</div>}
    <MealGamePanel document={data}/>
    <section className="dex-known"><div className="dex-section-heading"><div><span className="dex-eyebrow">WAITING TO BE FOUND</span><h3>다음에 만날 메뉴</h3></div><span className="dex-tag">확인된 저장본</span></div>
      <p className="dex-muted">{knownDate?`${knownDate} 제공 식단에서 확인한 메뉴예요. 오늘 제공 여부와는 달라요.`:'확인 가능한 저장 식단을 기준으로 표시해요.'} 전체 메뉴 수나 완료율을 뜻하지 않아요.</p>
      <p className="dex-small dex-muted">{notice}</p>
      {unknown.length?<div className="dex-card-grid">{unknown.map(row=><CollectionCard key={row.selection!.dishId} title={row.selection!.dishName} rarity="UNKNOWN" locked artwork={<CollectionArtwork kind={mealArtwork(row.selection!.dishName)} locked/>} meta="직접 먹은 날, 나의 도감으로"/>)}</div>:<p className="dex-muted">현재 저장본에서 추가로 표시할 미수집 메뉴가 없어요.</p>}
    </section>
  </div>;
}
export function MealCollection() {
  const {data,loading,error,reload}=useDexDocument();
  return <div className="space-y-5"><Link className="dex-back" href="/dex/meal">← 학식도감</Link>{loading?<p role="status">수집 기록을 불러오는 중…</p>:null}{error?<p role="alert">{error} <button onClick={()=>void reload()}>다시 읽기</button></p>:null}{data?<MealCollectionPanel data={data}/>:null}</div>;
}
