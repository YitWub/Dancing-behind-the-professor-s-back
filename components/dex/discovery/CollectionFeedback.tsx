'use client';
import Link from 'next/link';
import type { CardEdition } from '@/lib/dex/meal/card-editions';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { CollectResult, Result } from '@/lib/dex/core/types';
import type { GameNotice, RarityTier } from '@/lib/dex/game/types';
import { RarityBadge } from '@/components/dex/common/RarityBadge';
import { GameNoticeList } from './GameNoticeList';
import { mealGrade, personGrade } from '@/lib/dex/game/exp';
import type { ExpGrade } from '@/lib/dex/game/exp';
import type { PersonEntry } from '@/lib/dex/people/view';
import { GradeBadge } from '@/components/dex/common/GradeBadge';

/** A just-registered entry has only this experience and no board threads yet. */
function newEntryGrade({entry,experience}:CollectResult):ExpGrade|null{
  if(entry.subject.kind==='meal'&&experience.kind==='meal')return mealGrade(entry.subject.dishId,[experience]);
  return entry.subject.kind==='person'?personGrade(entry as PersonEntry,{dexes:[],experiences:[experience]},false):null;
}
function ExpGain({grade}:{grade:ExpGrade|null}){return grade?<p className="dex-visit-count">{grade.label} 등급 · 경험치 <strong>+{grade.exp}</strong> EXP</p>:null;}

export function DiscoveryReveal({itemName,onDismiss,detailHref,artwork,title,children,rarity,notices=[],preview=false,edition,card=!!edition,grade,isNewMenu=true,visitCount}:{children?:ReactNode;itemName:string;onDismiss:()=>boolean|void;detailHref?:string;artwork?:ReactNode;title:string;rarity?:RarityTier;notices?:readonly GameNotice[];preview?:boolean;edition?:CardEdition;card?:boolean;grade?:ExpGrade|null;isNewMenu?:boolean;visitCount?:number}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [skip,setSkip]=useState(false);
  useEffect(()=>{
    const element=dialog.current;
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    element?.showModal();
    return()=>{element?.close();if(previous?.isConnected)previous.focus();};
  },[]);
  return <dialog ref={dialog} className={`dex-reveal${skip?' dex-reveal--skip':''}`} aria-labelledby="discovery-title" aria-describedby="discovery-description" onCancel={event=>{event.preventDefault();onDismiss();}}>
    <button className="dex-reveal-close" aria-label={preview?'미리보기 닫기':'수집 알림 닫기'} onClick={onDismiss}>닫기 ×</button>
    <p className="dex-eyebrow">{preview?'PREVIEW · TEST CARD':card?(isNewMenu?'처음 만난 메뉴 · 카드 획득':'새 카드 획득'):'NEW DISCOVERY!'}</p><h2 id="discovery-title">{title}</h2>
    <div className={`dex-reveal-card${edition?` dex-edition--${edition.toLowerCase()} album-card-frame album-edition--${edition.toLowerCase()}`:''}${grade?` dex-rarity-frame--${grade.id}`:''}${rarity?` dex-rarity-frame--${rarity.toLowerCase()}`:''}`}><div className="dex-reveal-shine" aria-hidden="true"/>{artwork}<span className="dex-new">{preview?'미리보기':card&&!isNewMenu?'한 장 더':'첫 발견'}</span><h3>{itemName}</h3><p>{preview?'테스트 카드 · 저장되지 않아요':card?'새 카드 1장 획득 완료':'나의 컬렉션에 등록 완료'}</p>{edition?<span className={`dex-edition-badge dex-edition--${edition.toLowerCase()}`}>{edition} · 카드 에디션</span>:null}{grade?<GradeBadge grade={grade}/>:null}{rarity?<RarityBadge tier={rarity}/>:null}</div>
    <p id="discovery-description">{preview?'실제 메뉴 등급·수집 기록·업적에는 반영되지 않아요.':'새로운 카드와 함께, 그날의 기억도 한 장.'}</p><GameNoticeList notices={notices}/>{visitCount!==undefined?<p className="dex-visit-count">먹은 기록 <strong>{visitCount}</strong>회</p>:null}{children}
    <div className="dex-reveal-actions">{detailHref?<Link className="dex-button" href={detailHref} onClick={event=>{if(onDismiss()===false)event.preventDefault();}}>도감에서 확인</Link>:null}<button className="dex-button dex-button--quiet" onClick={onDismiss}>{preview?'미리보기 마치기':'계속 둘러보기'}</button><button className="dex-skip" onClick={()=>setSkip(true)}>연출 건너뛰기</button></div>
  </dialog>;
}
/** Presentation only. The committed result is the sole authority for a discovery. */
export function CollectionFeedback({result,itemName,onDismiss,detailHref,artwork,visitCount,children,canDismiss,rarity,notices=[],title='새로운 발견!'}:{result:Result<CollectResult>|null;itemName:string;onDismiss:()=>boolean|void;detailHref?:string;artwork?:ReactNode;visitCount?:number;title?:string;children?:ReactNode;canDismiss?:()=>boolean;rarity?:RarityTier;notices?:readonly GameNotice[]}) {
  if(!result)return null;
  const dismiss=()=>{if(canDismiss?.()===false)return false;onDismiss();return true;};
  if(result.ok&&!result.value.replayed&&result.value.experience.kind==='meal'&&result.value.experience.card){
    const value=result.value,grade=value.outcome==='new-entry'?newEntryGrade(value):null;
    return <DiscoveryReveal key={value.experience.id} itemName={itemName} onDismiss={dismiss} detailHref={detailHref} artwork={artwork} title={value.outcome==='new-entry'?title:'새로운 카드 획득!'} card grade={grade} isNewMenu={value.outcome==='new-entry'} visitCount={visitCount} notices={notices}>{value.outcome==='new-entry'?<ExpGain grade={grade}/>:null}{children}</DiscoveryReveal>;
  }
  if(result.ok&&!result.value.replayed&&result.value.outcome==='new-entry'&&result.value.discovery)return <DiscoveryReveal key={result.value.discovery.key} itemName={itemName} onDismiss={dismiss} detailHref={detailHref} artwork={artwork} title={title} rarity={rarity} notices={notices}><ExpGain grade={newEntryGrade(result.value)}/>{children}</DiscoveryReveal>;
  const revisit=result.ok&&!result.value.replayed&&result.value.outcome==='revisit';
  return <aside role={result.ok?'status':'alert'} aria-live={result.ok?'polite':'assertive'} className={`dex-toast${revisit?' dex-toast--revisit':''}`}>
    <div className="dex-toast-heading"><h2>{!result.ok?'수집에 실패했습니다.':result.value.replayed?'이미 처리된 요청이에요.':'또 만났네요!'}</h2><button onClick={dismiss} aria-label="수집 알림 닫기">닫기 ×</button></div>
    <p>{!result.ok?`${result.error.message} 동일한 기록은 같은 요청으로 다시 시도할 수 있어요.`:result.value.replayed?'기록을 중복으로 추가하지 않았습니다.':`${itemName}의 새로운 경험이 기존 카드에 쌓였어요.`}</p>
    {revisit&&visitCount!==undefined?<p className="dex-visit-count" key={result.value.experience.id}>먹은 기록 <strong>{visitCount}</strong>회</p>:null}
    {result.ok&&detailHref?<Link href={detailHref} onClick={event=>{if(dismiss()===false)event.preventDefault();}}>내 기록 보기 ↗</Link>:null}
    {revisit?<><GameNoticeList notices={notices}/>{children}</>:null}
  </aside>;
}
