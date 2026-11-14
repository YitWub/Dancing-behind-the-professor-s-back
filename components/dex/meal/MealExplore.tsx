'use client';
import { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui';
import { useDexDocument } from '@/components/dex/scaffold/useDexDocument';
import { getBrowserRepository } from '@/lib/dex/storage/browser';
import type { CollectResult, Result } from '@/lib/dex/core/types';
import { readOfferings, CAFETERIA_NAMES, MEAL_TIME_NAMES } from '@/lib/dex/meal/catalog';
import type { CatalogOffering, MealCatalog } from '@/lib/dex/meal/catalog';
import type { Cafeteria, MealTime } from '@/lib/dex/meal/types';
import { MealCollectionRequests } from '@/lib/dex/meal/requests';
import { CollectionFeedback } from '@/components/dex/discovery/CollectionFeedback';
import { MealPhoto } from './MealPhoto';
import { MealCollectionPanel } from './MealCollection';
import { CollectionArtwork, mealArtwork } from '@/components/dex/common/CollectionArtwork';
import { splitMenuLabel } from '@/lib/dex/meal/presentation';
import { QuickMealRating } from './QuickMealRating';
import type { RatingGuard } from './QuickMealRating';
import type { GameNotice } from '@/lib/dex/game/types';
import { claimGameNotices } from '@/lib/dex/game/notices';
import { mealGameNotices, mealPersonalCards } from '@/lib/dex/meal/game';
import { kstToday } from '@/lib/datetime';
import { RarityBadge } from '@/components/dex/common/RarityBadge';

export function MealExplore({initialDate,initialTab='collection'}:{initialDate:string;initialTab?:'collection'|'discover'}) {
  const [tab,setTab]=useState(initialTab);
  const {data,loading,error,reload}=useDexDocument();
  const [date,setDate]=useState(initialDate);
  const [cafeteria,setCafeteria]=useState<Cafeteria|''>('');
  const [mealTime,setMealTime]=useState<MealTime|''>('lunch');
  const [catalog,setCatalog]=useState<MealCatalog|null>(null);
  const [catalogError,setCatalogError]=useState('');
  const [reading,setReading]=useState(true);
  const [nonce,setNonce]=useState(0);
  const [busy,setBusy]=useState<string|null>(null);
  const [failed,setFailed]=useState<Set<string>>(()=>new Set());
  const [feedback,setFeedback]=useState<{result:Result<CollectResult>;name:string;visitCount?:number;notices:GameNotice[]}|null>(null);
  const requests=useRef(new MealCollectionRequests());
  const submitting=useRef(false);
  const ratingGuard=useRef<RatingGuard>({dirty:false,busy:false});
  function canDismissFeedback(){return !ratingGuard.current.busy&&(!ratingGuard.current.dirty||window.confirm('작성 중인 평가를 저장하지 않고 닫을까요? 수집한 카드는 그대로 남아요.'));}
  function dismissFeedback(){setFeedback(null);ratingGuard.current={dirty:false,busy:false};}
  const mealDex=data?.dexes.find(d=>d.kind==='meal');
  const entries=data?.entries.filter(e=>e.subject.kind==='meal')??[];
  const personal=data?mealPersonalCards(data):[];
  useEffect(()=>{
    const controller=new AbortController();let alive=true;
    void readOfferings({date},{signal:controller.signal}).then(result=>{
      if(!alive)return;
      setCatalog(result.ok?result.value:null);setCatalogError(result.ok?'':result.error.message);setReading(false);
    });
    return ()=>{alive=false;controller.abort();};
  },[date,nonce]);
  function changeDate(next:string){if(next!==date&&(!feedback||canDismissFeedback())){setReading(true);setDate(next);dismissFeedback();}}
  function reread(){setReading(true);setNonce(n=>n+1);}
  async function record(row:CatalogOffering) {
    if(submitting.current||!data||!mealDex||!row.selection)return;
    if(feedback&&!canDismissFeedback())return;
    const selected=row.selection;
    const exists=entries.find(e=>e.subject.kind==='meal'&&e.subject.dishId===selected.dishId);
    if(exists&&!requests.current.hasPending(row.offering.id)){
      if(!window.confirm(`${selected.dishName}을 실제로 다시 먹은 기록을 추가할까요?`))return;
      requests.current.beginVisit(row.offering.id);
    }
    submitting.current=true;setBusy(row.offering.id);dismissFeedback();
    try {
      const result=await requests.current.run(row.offering.id,()=>({ownerId:data.profile.ownerId,dexId:mealDex.id,requestId:crypto.randomUUID(),selection:selected,experiencedOn:row.offering.date,rating:null,note:''}),command=>getBrowserRepository().commitMealCollection(command));
      const experiences=result.ok?await getBrowserRepository().listExperiences(data.profile.ownerId,result.value.entry.id):null;
      const snapshot=result.ok&&!result.value.replayed?await getBrowserRepository().snapshot():null;
      const notices=snapshot?.ok&&result.ok?claimGameNotices(data.profile.ownerId,result.value.experience.requestId,mealGameNotices(snapshot.value,result,kstToday())):[];
      setFailed(previous=>{const next=new Set(previous);if(result.ok)next.delete(row.offering.id);else next.add(row.offering.id);return next;});setFeedback({result,name:selected.dishName,visitCount:experiences?.ok?experiences.value.length:undefined,notices});
      await reload();
    }finally{submitting.current=false;setBusy(null);}
  }
  async function prepareDex(){
    if(!data||submitting.current)return;submitting.current=true;
    try {const result=await getBrowserRepository().createDex(data.profile.ownerId,{kind:'meal',name:'학식도감',icon:'meal'});if(!result.ok)setCatalogError(result.error.message);await reload();}finally{submitting.current=false;}
  }
  const offerings=catalog?.offerings.filter(row=>(!cafeteria||row.offering.cafeteria===cafeteria)&&(!mealTime||row.offering.mealTime===mealTime))??[];
  return <div className="space-y-5 pb-28">
    <section className="dex-meal-intro">
      <div><span className="dex-eyebrow">THE CAMPUS TABLE · 01</span><h2>나의 학식도감<span>오늘의 한 끼도, 하나의 발견.</span></h2><p>직접 먹은 메뉴만 수집해요. 같은 메뉴를 다시 먹으면 경험이 쌓여요.</p></div>
      <div className="dex-intro-art"><CollectionArtwork kind="rice"/></div>
    </section>
    <div className="dex-segments" aria-label="학식도감 보기">
      <button aria-pressed={tab==='collection'} onClick={()=>setTab('collection')}>나의 도감 <span>{data?entries.length:'–'}</span></button>
      <button aria-pressed={tab==='discover'} onClick={()=>setTab('discover')}>오늘의 발견 ↗</button>
    </div>
    <div className="dex-small dex-muted">
      <p className={tab==='collection'?'sr-only':undefined} data-testid="meal-unique-count">{data?`고유 메뉴 ${entries.length}개`:loading?'내 기록을 불러오는 중…':'내 기록을 읽지 못했습니다.'}</p>
      {error?<p role="alert">{error} <button className="underline" onClick={()=>void reload()}>다시 읽기</button></p>:null}
      {data&&!mealDex?<p>개인 학식도감이 없습니다. <button className="underline" onClick={()=>void prepareDex()}>빈 학식도감 만들기</button></p>:null}
    </div>
    {tab==='collection'&&data?<MealCollectionPanel data={data} onExplore={()=>setTab('discover')}/>:null}
    {tab==='discover'?<>
    <Card className="dex-explore-toolbar">
      <div className="dex-explore-heading"><div><span className="dex-eyebrow">FIND YOUR NEXT CARD</span><h3>제공 식단 탐색</h3></div><span className="dex-tag">직접 먹은 메뉴만 수집해요</span></div>
      <div className="dex-explore-filters">
        <label className="text-sm">제공 날짜 (한국 시간)<input aria-label="제공 날짜" type="date" value={date} onChange={e=>changeDate(e.target.value)} className="mt-1 block rounded-lg border bg-[var(--e-surface)] p-2"/></label>
        <label className="text-sm">식당<select aria-label="식당" value={cafeteria} onChange={e=>setCafeteria(e.target.value as Cafeteria|'')} className="mt-1 block rounded-lg border bg-[var(--e-surface)] p-2"><option value="">전체 식당</option>{Object.entries(CAFETERIA_NAMES).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
        <label className="text-sm">끼니<select aria-label="끼니" value={mealTime} onChange={e=>setMealTime(e.target.value as MealTime|'')} className="mt-1 block rounded-lg border bg-[var(--e-surface)] p-2"><option value="">전체 끼니</option>{Object.entries(MEAL_TIME_NAMES).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
        <button className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40" disabled={reading} onClick={reread}>저장본 다시 읽기</button>
      </div>
      {catalog?<>
        <details className="dex-source-info"><summary>저장본 정보{catalog.dataState==='stale'?' · 오래된 데이터':catalog.dataState==='seed'?' · 예시 데이터':''}</summary><p data-testid="meal-source-notice">{catalog.notice}</p><p className="break-all">저장 출처: {catalog.source}</p><p>조회만으로 수집되지 않아요. 선택한 제공일에 실제로 먹은 메뉴만 등록해 주세요.</p></details>
        {catalog.availableDates.length?<div className="flex flex-wrap gap-2 text-sm"><span>저장된 제공일:</span>{catalog.availableDates.map(day=><button key={day} className="underline" onClick={()=>changeDate(day)}>{day}</button>)}</div>:null}
      </>:null}
    </Card>
    {reading?<p role="status">저장된 식단을 읽는 중…</p>:catalogError?<p role="alert">{catalogError}</p>:offerings.length===0?<Card className="space-y-2 p-5"><p>선택한 날짜·식당·끼니에 저장된 식단이 없습니다.</p><p className="text-sm">오늘 메뉴를 임의로 만들거나 자동 수집하지 않습니다. 위의 저장된 제공일을 선택할 수 있어요.</p></Card>:<div className="dex-offering-grid">
      {offerings.map(row=>{
        const item=row.offering;
        const collected=row.selection?entries.some(e=>e.subject.kind==='meal'&&e.subject.dishId===row.selection!.dishId):false;
        const name=item.snapshot.name??'대표 메뉴 확인 필요';
        const label=splitMenuLabel(name);
        const memory=row.selection?personal.find(card=>card.dishId===row.selection!.dishId):null;
        return <Card as="article" key={item.id} className="dex-offering-card">
          <div className="dex-offering-head"><CollectionArtwork kind={mealArtwork(name)}/><span className="dex-tag">{collected?'수집 완료':'새로운 발견 후보'}</span></div>
          <p className="text-sm text-[var(--e-muted)]">{item.date} · {CAFETERIA_NAMES[item.cafeteria]} · {MEAL_TIME_NAMES[item.mealTime]}</p>
          <h3 className="dex-offering-title">{label.title}</h3>
          <div className="dex-offering-game-hint"><RarityBadge tier="UNKNOWN" hidden={!collected}/><span>{collected?'이미 발견한 메뉴!':'나의 도감에 없는 메뉴예요.'}</span></div>
          {memory&&memory.experiences.length>0?<p className="dex-menu-memory">{item.date===initialDate?'반가운 메뉴가 다시 등장했어요! ':''}내 기록에 {memory.experiences.length}회 · 서로 다른 날 {memory.distinctDays}일{memory.note?<span>지난번 한줄평: {memory.note}</span>:null}</p>:null}
          {row.reason?<p className="text-sm text-[var(--e-muted)]">{row.reason}</p>:null}
          <details className="dex-tray"><summary>메뉴 구성·원문·식판 사진</summary><p>{item.snapshot.menu.join(' · ')}</p><p className="dex-menu-original">원문 메뉴: {label.original}</p>{label.translation?<p lang="en">{label.translation}</p>:null}<p>식판 전체 사진이며, 개별 메뉴 사진이 아니에요.</p><MealPhoto imageUrl={item.snapshot.imageUrl} imageSourceUrl={item.snapshot.imageSourceUrl} name={`${name} · 당시 식판 전체 사진`}/></details>
          <div className="dex-offering-actions"><div className="dex-offering-price"><strong>{item.snapshot.price!==null?`${item.snapshot.price.toLocaleString('ko-KR')}원`:'가격 정보 없음'}</strong><span>{collected?'수집 완료':'아직 미수집'}</span></div>
          <button className="w-full rounded-xl bg-[var(--e-accent)] px-3 py-3 font-semibold text-white disabled:opacity-40" disabled={!!busy||!row.selection||!mealDex||!!error} onClick={()=>void record(row)}>
            {busy===item.id?'수집 중…':failed.has(item.id)?'같은 요청으로 다시 시도':collected?'다시 먹었어요 · 기록 추가':'먹었어요 · 도감에 수집'}
          </button>
          {failed.has(item.id)?<p className="text-sm" role="alert">저장 실패 · 성공 처리하지 않았습니다.</p>:null}
          {item.soldOut?<p className="text-xs text-[var(--e-muted)]">원본 저장 당시 품절 표시가 있었습니다. 과거에 먹은 경험만 기록하세요.</p>:null}
          </div>
        </Card>;
      })}
    </div>}
    </>:null}
    <CollectionFeedback rarity="UNKNOWN" notices={feedback?.notices??[]} result={feedback?.result??null} itemName={feedback?.name??''} visitCount={feedback?.visitCount} title="새로운 메뉴 발견!" artwork={<CollectionArtwork kind={mealArtwork(feedback?.name??'')}/>} onDismiss={dismissFeedback} canDismiss={canDismissFeedback} detailHref={feedback?.result.ok?`/dex/meal/collection/${feedback.result.value.entry.id}`:undefined}>
      {feedback?.result.ok&&!feedback.result.value.replayed&&feedback.result.value.experience.kind==='meal'?<QuickMealRating key={feedback.result.value.experience.id} experience={feedback.result.value.experience} onGuardChange={guard=>{ratingGuard.current=guard;}} onSaved={reload} onLater={()=>{if(canDismissFeedback())dismissFeedback();}}/>:null}
    </CollectionFeedback>
  </div>;
}
