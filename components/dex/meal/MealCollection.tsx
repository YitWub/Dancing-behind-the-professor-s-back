'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useDexDocument } from '@/components/dex/scaffold/useDexDocument';
import type { DexDocument } from '@/lib/dex/core/types';
import { buildMealCollection, queryMealCollection, mealDetailHref } from '@/lib/dex/meal/card-view';
import type { CardSort } from '@/lib/dex/meal/card-view';
import { EditionCollectionCard } from '@/components/dex/common/EditionCollectionCard';
import { splitMenuLabel } from '@/lib/dex/meal/presentation';
import { readOfferings } from '@/lib/dex/meal/catalog';
import type { CatalogOffering } from '@/lib/dex/meal/catalog';
import { kstToday } from '@/lib/datetime';
import { mealArtwork } from '@/components/dex/common/CollectionArtwork';
import { MealImageArtwork } from '@/components/dex/common/MealImageArtwork';
import { CollectionCard, CollectionEmptyState } from '@/components/dex/common/CollectionCard';
import { mealGrade } from '@/lib/dex/game/exp';
import { MealGamePanel } from './MealGamePanel';

/** Known cards come only from a real stored offering date; this is not a complete school catalogue. */
export function MealCollectionPanel({data,onExplore}:{data:DexDocument;onExplore?:()=>void}) {
  const collection=buildMealCollection(data);
  const [view,setView]=useState<'menus'|'album'>('menus');
  const [sort,setSort]=useState<CardSort>('recent');
  const [search,setSearch]=useState('');
  const [limit,setLimit]=useState(24);
  const result=queryMealCollection(collection,{sort,search,edition:'all'});
  const grades=new Map(collection.menus.map(menu=>[menu.dishId,mealGrade(menu.dishId,menu.cards.map(card=>card.experience))]));
  const total=view==='menus'?result.menus.length:result.cards.length;
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
  const owned=new Set(collection.menus.map(menu=>menu.dishId));
  const unknown=known.filter(row=>!owned.has(row.selection!.dishId));
  return <div className="dex-collection-panel">
    <div className="dex-section-heading"><div><span className="dex-eyebrow">차곡차곡 모은 한 끼</span><h2>나의 학식 앨범</h2></div><span className="dex-count">메뉴 <strong>{collection.menus.length}</strong>종 · 카드 {collection.cards.length}장</span></div>
    <details className="dex-tray"><summary>메뉴 등급 안내</summary><p>일반 10 EXP · 희귀 50 EXP · 전설 300 EXP</p><p>서로 다른 날 별점 4점 이상 2번이면 희귀, 5점 3번이면 전설이에요. 출현 통계로 확정된 희귀·전설 메뉴도 그 등급이 돼요. 매 식사 기록에 카드 1장이 쌓이고, 경험을 삭제하면 연결 카드와 등급도 다시 계산돼요.</p></details>
    <div className="dex-collection-switch" role="group" aria-label="컬렉션 보기"><button aria-pressed={view==='menus'} onClick={()=>{setView('menus');setLimit(24);}}>메뉴 도감</button><button aria-pressed={view==='album'} onClick={()=>{setView('album');setLimit(24);}}>카드 앨범</button></div>
    <div className="dex-collection-tools"><label>메뉴 검색<input aria-label="메뉴 검색" value={search} onChange={e=>{setSearch(e.target.value);setLimit(24);}} placeholder="메뉴 이름"/></label><label>정렬<select aria-label="컬렉션 정렬" value={sort} onChange={e=>{setSort(e.target.value as CardSort);setLimit(24);}}><option value="recent">최근 획득순</option><option value="name">메뉴 이름순</option><option value="visits">많이 먹은 메뉴순</option></select></label></div>
    <p className="dex-small" role="status">{view==='menus'?'메뉴':'카드'} {Math.min(limit,total)} / {total}{view==='menus'?'종':'장'} 표시</p>
    {collection.menus.length===0?<CollectionEmptyState onExplore={onExplore}/>:total===0?<div className="dex-empty dex-empty--small"><h3>{view==='album'&&collection.cards.length===0?'보유 카드가 없어요':'검색 결과가 없어요'}</h3><p>검색어를 확인해 주세요. 경험을 모두 삭제한 메뉴 등록은 남아 있어요.</p></div>:<div className="dex-owned-grid" data-testid="owned-grid">{view==='menus'?result.menus.slice(0,limit).map(menu=><EditionCollectionCard key={menu.dishId} name={menu.name} grade={grades.get(menu.dishId)} count={menu.cards.length} evaluationCount={menu.cards.filter(item=>item.experience.rating!==null).length} rating={menu.cards.some(item=>item.experience.rating!==null)?menu.cards.reduce((sum,item)=>sum+(item.experience.rating??0),0)/menu.cards.filter(item=>item.experience.rating!==null).length:null} acquiredOn={menu.firstCollectedOn} href={`/dex/meal/collection/${encodeURIComponent(menu.entryId)}`}/>):result.cards.slice(0,limit).map(item=><EditionCollectionCard key={item.card.id} name={item.name} grade={grades.get(item.dishId)} rating={item.experience.rating} acquiredOn={kstToday(new Date(item.card.acquiredAt))} href={mealDetailHref(item)}/>)}</div>}
    {total>limit?<button className="dex-button dex-button--quiet" onClick={()=>setLimit(n=>n+24)}>더 보기 ({total-limit}개 남음)</button>:null}
    <MealGamePanel document={data}/>
    <section className="dex-known"><div className="dex-section-heading"><div><span className="dex-eyebrow">다음에 만날 발견</span><h3>다음에 만날 메뉴</h3></div><span className="dex-tag">확인된 저장본</span></div>
      <p className="dex-muted">{knownDate?`${knownDate} 제공 식단에서 확인한 메뉴예요. 오늘 제공 여부와는 달라요.`:'확인 가능한 저장 식단을 기준으로 표시해요.'} 전체 메뉴 수나 완료율을 뜻하지 않아요.</p>
      <p className="dex-small dex-muted">{notice}</p>
      {unknown.length?<div className="dex-card-grid">{unknown.map(row=><CollectionCard key={row.selection!.dishId} title={splitMenuLabel(row.selection!.dishName).title} rarity="UNKNOWN" locked artwork={<MealImageArtwork name={row.selection!.dishName} kind={mealArtwork(row.selection!.dishName)} locked/>} meta="직접 먹은 날, 나의 도감으로"/>)}</div>:<p className="dex-muted">현재 저장본에서 추가로 표시할 미수집 메뉴가 없어요.</p>}
    </section>
  </div>;
}
export function MealCollection() {
  const {data,loading,error,reload}=useDexDocument();
  return <div className="space-y-5"><Link className="dex-back" href="/dex/meal">← 학식도감</Link>{loading?<p role="status">수집 기록을 불러오는 중…</p>:null}{error?<p role="alert">{error} <button onClick={()=>void reload()}>다시 읽기</button></p>:null}{data?<MealCollectionPanel data={data}/>:null}</div>;
}
