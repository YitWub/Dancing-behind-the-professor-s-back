'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CARD_EDITIONS } from '@/lib/dex/meal/card-editions';
import { DEFAULT_WEIGHTS, generateCollectionPreview, groupPreviewMenus, sortPreviewCards, sortPreviewMenus, validWeights } from '@/lib/dex/dev/collection-fixtures';
import type { CollectionSort, EditionWeights, FixtureSettings } from '@/lib/dex/dev/collection-fixtures';
import { EditionCollectionCard } from '@/components/dex/common/EditionCollectionCard';
import { splitMenuLabel } from '@/lib/dex/meal/presentation';

export function CollectionPreviewLab(){
  const [settings,setSettings]=useState<FixtureSettings>({count:30,uniqueMenus:5,seed:'BOKAK-45A',weights:{...DEFAULT_WEIGHTS}});
  const [view,setView]=useState<'menus'|'album'>('menus');
  const [sort,setSort]=useState<CollectionSort>('recent');
  const [density,setDensity]=useState('normal');
  const [width,setWidth]=useState('desktop');
  const [selected,setSelected]=useState<string|null>(null);
  const [search,setSearch]=useState('');
  const detailRef=useRef<HTMLElement>(null);
  useEffect(()=>{if(selected)detailRef.current?.scrollIntoView({block:'nearest'});},[selected]);
  const valid=validWeights(settings.weights);
  const cards=useMemo(()=>valid?generateCollectionPreview(settings):[],[settings,valid]);
  const groups=useMemo(()=>groupPreviewMenus(cards),[cards]);
  function configure(patch:Partial<FixtureSettings>){setSettings(current=>({...current,...patch}));setSelected(null);}
  if(process.env.NODE_ENV!=='development')return null;
  const visibleCards=sortPreviewCards(cards,sort).filter(card=>card.name.toLowerCase().includes(search.toLowerCase()));
  const visibleMenus=sortPreviewMenus(groups,sort).filter(menu=>menu.name.toLowerCase().includes(search.toLowerCase()));
  const menu=view==='menus'?groups.find(group=>group.dishId===selected):null;
  const picked=view==='album'?cards.find(card=>card.card.id===selected):null;
  const detailCards=menu?.cards??(picked?[picked]:[]);
  const weightsTotal=CARD_EDITIONS.reduce((n,e)=>n+settings.weights[e],0);
  function preset(name:string){const presets:Record<string,EditionWeights>={default:{...DEFAULT_WEIGHTS},balanced:{NORMAL:25,SPECIAL:25,RARE:25,GOLDEN:25},golden:{NORMAL:10,SPECIAL:10,RARE:20,GOLDEN:60}};configure({weights:presets[name]});}
  return <div className="dex-lab">
    <Link href="/dex/dev/editions" className="dex-back">← 에디션 연출 미리보기</Link><Link href="/dex/dev/design" className="dex-back">공통 디자인 A/B 비교 ↗</Link><h2>개발자 컬렉션 실험실</h2>
    <p className="dex-lab-warning">가상 데이터 · 메모리 전용 · 실제 도감·업적·학식 통계에 저장되지 않습니다.</p>
    <fieldset className="dex-lab-controls"><legend>컬렉션 설정</legend>
      <label>카드 수<select aria-label="카드 수" value={settings.count} onChange={e=>{const count=Number(e.target.value);configure({count,uniqueMenus:Math.min(count,settings.uniqueMenus)});}}>{[1,5,30,50,100].map(n=><option key={n} value={n}>{n}장</option>)}</select></label>
      <label>고유 메뉴 수<input aria-label="고유 메뉴 수" type="number" min={1} max={settings.count} value={settings.uniqueMenus} onChange={e=>configure({uniqueMenus:Math.max(1,Math.min(settings.count,Math.trunc(Number(e.target.value))||1))})}/></label>
      <label>고정 시드<input aria-label="고정 시드" maxLength={80} value={settings.seed} onChange={e=>configure({seed:e.target.value})}/></label>
      <label>보기 방식<select aria-label="보기 방식" value={view} onChange={e=>{setView(e.target.value as typeof view);setSelected(null);}}><option value="menus">메뉴별 묶음</option><option value="album">전체 카드 앨범</option></select></label>
      <label>정렬<select aria-label="정렬" value={sort} onChange={e=>setSort(e.target.value as CollectionSort)}><option value="recent">최근 획득순</option><option value="edition">등급순</option><option value="name">메뉴명순</option><option value="visits">많이 먹은 순</option></select></label>
      <label>카드 밀도<select aria-label="카드 밀도" value={density} onChange={e=>setDensity(e.target.value)}><option value="small">작게</option><option value="normal">보통</option><option value="large">크게</option></select></label>
      <label>화면 폭<select aria-label="화면 폭" value={width} onChange={e=>setWidth(e.target.value)}><option value="desktop">데스크톱 · 최대 1100px</option><option value="mobile">모바일 · 최대 390px</option></select></label>
      <label>메뉴 검색<input aria-label="메뉴 검색" value={search} onChange={e=>setSearch(e.target.value)} placeholder="메뉴명으로 좁혀보기"/></label>
    </fieldset>
    <fieldset className="dex-lab-controls"><legend>실험용 에디션 비중</legend><div className="dex-lab-presets">{[['default','기본 확률'],['balanced','균등 분포'],['golden','GOLDEN 강조']].map(([key,label])=><button key={key} className="dex-edit-button" onClick={()=>preset(key)}>{label}</button>)}</div>
      {CARD_EDITIONS.map(edition=><label key={edition}>{edition} (%)<input aria-label={`${edition} 비중`} type="number" min={0} max={100} value={settings.weights[edition]} onChange={e=>configure({weights:{...settings.weights,[edition]:Math.max(0,Math.min(100,Math.trunc(Number(e.target.value)||0)))}})}/></label>)}
      <p className="dex-small">비중 합계 {weightsTotal}% · 실제 확률 설정은 바뀌지 않아요. 작은 표본은 최대잔여 방식으로 정수 배분한 후 시드로 섞습니다. 실제 추첨 분포의 예측은 아닙니다.</p>
    </fieldset>
    {!valid?<p role="alert">에디션 비중 합계를 100%로 맞춰 주세요. 유효한 설정일 때만 가상 카드를 생성합니다.</p>:null}
    <section className={`dex-lab-stage dex-lab-density--${density}`} style={{maxWidth:width==='mobile'?390:1100}} aria-label="컬렉션 배치 미리보기">
      <div className="dex-section-heading"><h3>{view==='menus'?'메뉴 도감':'카드 앨범'}</h3><span data-testid="lab-counts">발견 메뉴 {groups.length}종 · 보유 카드 {cards.length}장</span></div>
      <p data-testid="lab-distribution" className="dex-small">{CARD_EDITIONS.map(edition=>`${edition} ${cards.filter(card=>card.card.edition===edition).length}장`).join(' · ')}</p>
      <p className="dex-small dex-muted">{view==='menus'?'메뉴별 최고 에디션을 대표로 표시해요.':'같은 메뉴도 획득 카드마다 따로 표시해요.'} 표시 {view==='menus'?visibleMenus.length:visibleCards.length}개</p>
      <div className="dex-lab-grid" data-testid="lab-grid">{view==='menus'?visibleMenus.map(menu=><EditionCollectionCard key={menu.dishId} preview name={menu.name} edition={menu.representative.card.edition} count={menu.cards.length} acquiredOn={menu.representative.experiencedOn} selected={selected===menu.dishId} onSelect={()=>setSelected(menu.dishId)}/>):visibleCards.map(item=><EditionCollectionCard key={item.card.id} preview name={item.name} edition={item.card.edition} acquiredOn={item.experiencedOn} selected={selected===item.card.id} onSelect={()=>setSelected(item.card.id)}/>)}</div>
      {valid&&!(view==='menus'?visibleMenus.length:visibleCards.length)?<p>검색 결과가 없습니다.</p>:null}
      {detailCards.length>0?<section ref={detailRef} className="dex-lab-detail" aria-label="선택 항목 상세 미리보기"><div className="dex-section-heading"><h3>{splitMenuLabel(detailCards[0].name).title}</h3><button className="dex-edit-button" onClick={()=>setSelected(null)}>상세 닫기</button></div><p>{menu?`이 메뉴의 보유 카드 ${detailCards.length}장`:'선택한 카드의 식사 추억'}</p><ul>{sortPreviewCards(detailCards,'recent').map(item=><li key={item.card.id}><span className={`dex-edition-badge dex-edition--${item.card.edition.toLowerCase()}`}>{item.card.edition}</span><span>획득 {item.experiencedOn}</span><span aria-label={`별점 ${item.rating}점`}>{'★'.repeat(item.rating)}</span>{item.note?<p>{item.note}</p>:null}</li>)}</ul><details><summary>메뉴 원문</summary><p>{detailCards[0].name}</p></details><p className="dex-small dex-muted">가상 기록의 읽기 전용 미리보기예요. 실제 평가 편집은 기존 메뉴 상세에서 할 수 있어요.</p></section>:null}
    </section>
  </div>;
}
