'use client';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui';
import { useDexDocument } from '@/components/dex/scaffold/useDexDocument';
import { getBrowserRepository } from '@/lib/dex/storage/browser';
import { buildMealCollection } from '@/lib/dex/meal/card-view';
import type { MealExperience } from '@/lib/dex/meal/collection';
import type { Rating } from '@/lib/dex/core/types';
import { saveMealRating } from '@/lib/dex/meal/quick-rating';
import { kstToday } from '@/lib/datetime';
import { CAFETERIA_NAMES, MEAL_TIME_NAMES } from '@/lib/dex/meal/catalog';
import { MealPhoto } from './MealPhoto';
import { EditionCollectionCard } from '@/components/dex/common/EditionCollectionCard';
import { splitMenuLabel } from '@/lib/dex/meal/presentation';
import { mealPersonalCards } from '@/lib/dex/meal/game';
import { mealGrade } from '@/lib/dex/game/exp';

function ExperienceEditor({experience,management,onSaved,onChanged,onDeleted,onGuardChange}:{experience:MealExperience;management:HTMLDivElement|null;onSaved:(experience:MealExperience)=>void;onChanged:()=>Promise<void>;onDeleted:()=>Promise<void>;onGuardChange:(state:{dirty:boolean;busy:boolean})=>void}){
  const [current,setCurrent]=useState(experience);
  const [rating,setRating]=useState<Rating|null>(experience.rating);
  const [note,setNote]=useState(experience.note);
  const [day,setDay]=useState(experience.experiencedOn);
  const [editing,setEditing]=useState(experience.rating===null&&!experience.note.trim());
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const active=useRef(false);
  const dirty=rating!==current.rating||note!==current.note||day!==current.experiencedOn;
  useEffect(()=>{onGuardChange({dirty,busy});},[dirty,busy,onGuardChange]);
  useEffect(()=>{if(!dirty)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
  function reset(){if(dirty&&!window.confirm('저장하지 않은 입력을 버릴까요?'))return;setCurrent(experience);setRating(experience.rating);setNote(experience.note);setDay(experience.experiencedOn);setMessage('');setEditing(experience.rating===null&&!experience.note.trim());}
  async function save(event?:React.FormEvent){
    event?.preventDefault();if(active.current||!dirty)return;active.current=true;setBusy(true);setMessage('');
    try{
      if(day>kstToday()){setMessage('미래의 식사는 기록할 수 없습니다.');return;}
      const repository=getBrowserRepository();
      const result=day===current.experiencedOn?await saveMealRating(repository,current,{rating,note}):await repository.updateExperience(current.ownerId,current.id,current.revision,{experiencedOn:day,rating,note});
      // The committed repository event refreshes the document; do not await a duplicate full read.
      if(result.ok&&result.value.kind==='meal'){setCurrent(result.value);setRating(result.value.rating);setNote(result.value.note);setDay(result.value.experiencedOn);setEditing(false);onSaved(result.value);setMessage('이 식사 평가를 저장했어요.');onGuardChange({dirty:false,busy:false});}
      else{setMessage(`${result.ok?'결과 확인이 필요해요.':result.error.message} 입력은 그대로 남아 있어요.`);if(!result.ok&&result.error.code==='REVISION_CONFLICT')await onChanged();}
    }catch{setMessage('저장하지 못했어요. 입력은 그대로 남아 있어요. 다시 시도해 주세요.');}finally{active.current=false;setBusy(false);}
  }
  async function remove(){
    if(active.current||!window.confirm('이 식사 경험과 연결된 카드 1장을 삭제할까요? 다른 경험과 메뉴 등록은 남습니다.'))return;
    active.current=true;setBusy(true);setMessage('');
    try{const result=await getBrowserRepository().deleteExperience(current.ownerId,current.id,current.revision);if(result.ok){onGuardChange({dirty:false,busy:false});await onDeleted();}else setMessage(result.error.message);}finally{active.current=false;setBusy(false);}
  }
  const context=current.context;
  return <><article className={`dex-experience-card dex-memory${editing?' is-editing':''}`}>
    <h3 className="dex-memory-heading">나의 한 끼 기억</h3>
    {!editing?<div className="dex-memory-reading">{current.rating!==null?<p className="dex-memory-stars" aria-label={`이 식사 별점 ${current.rating}점`}>{[1,2,3,4,5].map(n=>n<=current.rating!?'★':'☆').join('')}</p>:null}{current.note.trim()?<blockquote>{current.note}</blockquote>:null}<button type="button" className="dex-edit-button" onClick={()=>{setEditing(true);setMessage('');}}>수정</button></div>:<form onSubmit={event=>void save(event)} className="dex-quick-rating" aria-label="선택한 식사 평가">
      <fieldset disabled={busy}><legend>별점</legend><div className="dex-rating-stars">{([1,2,3,4,5] as const).map(n=><label key={n} className={rating!==null&&n<=rating?'is-selected':''}><input type="radio" name={`detail-rating-${experience.id}`} aria-label={`${n}점`} checked={rating===n} onChange={()=>setRating(n)}/><span aria-hidden="true">{rating!==null&&n<=rating?'★':'☆'}</span></label>)}<button type="button" className="dex-rating-clear" onClick={()=>setRating(null)}>평가 안 함</button></div>
        <label className="dex-quick-note">한줄평<textarea aria-label="이 식사 한줄평" maxLength={500} rows={2} value={note} onChange={e=>setNote(e.target.value)} placeholder="오늘의 한 끼, 짧게 남겨 볼까요?"/></label>

      </fieldset>
      <div className="dex-quick-actions"><button className="dex-button" disabled={busy||!dirty} type="submit">{busy?'저장 중…':'평가·메모 저장'}</button>{(current.rating!==null||current.note.trim()||dirty)?<button type="button" className="dex-edit-button" disabled={busy} onClick={reset}>취소</button>:null}</div>
    </form>}
    {message?<p role={message==='이 식사 평가를 저장했어요.'?'status':'alert'}>{message}</p>:null}

  </article>{/* Keep the same editor state while placing record controls below the owned cards. */}{management?createPortal(<div className="dex-selected-record-info">        <details className="dex-tray"><summary>기록 정보 보기</summary><p>{current.experiencedOn} · {CAFETERIA_NAMES[context.cafeteria]} · {MEAL_TIME_NAMES[context.mealTime]}</p><label>먹은 날짜<input aria-label="먹은 날짜" disabled={busy} type="date" required max={kstToday()} value={day} onChange={e=>setDay(e.target.value)}/></label><button className="dex-edit-button" type="button" disabled={busy} onClick={()=>void remove()}>이 경험과 카드 삭제</button>{day!==current.experiencedOn?<button type="button" className="dex-edit-button" disabled={busy} onClick={()=>void save()}>날짜 변경 저장</button>:null}</details>    <details className="dex-tray"><summary>메뉴 원문 보기</summary><p>{context.snapshot.name}</p><p>{context.snapshot.menu.join(' · ')}</p><MealPhoto name="당시 식판 사진" imageUrl={context.snapshot.imageUrl} imageSourceUrl={context.snapshot.imageSourceUrl}/><p className="dex-small">원본 제공일 {context.date} · 출처 {context.source}</p></details></div>,management):null}</>;
}

export function MealEntryDetail({entryId,initialExperienceId}:{entryId:string;initialExperienceId?:string}){
  const {data,loading,error,reload}=useDexDocument();
  const [selectedId,setSelectedId]=useState(initialExperienceId??'');
  const [limit,setLimit]=useState(24);
  const [management,setManagement]=useState<HTMLDivElement|null>(null);
  const [saved,setSaved]=useState<MealExperience|null>(null);
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const guard=useRef({dirty:false,busy:false});
  const reportGuard=useCallback((state:{dirty:boolean;busy:boolean})=>{guard.current=state;},[]);
  const focusRef=useRef<HTMLElement>(null);
  useEffect(()=>{if(selectedId){focusRef.current?.focus({preventScroll:true});focusRef.current?.scrollIntoView({block:'start'});}},[selectedId]);
  const router=useRouter();
  const menu=data?buildMealCollection(data).menus.find(m=>m.entryIds.includes(entryId)):null;
  const selected=menu?.cards.find(c=>c.experience.id===selectedId)??menu?.representative??null;
  const personal=data&&menu?mealPersonalCards(data).find(c=>c.dishId===menu.dishId):null;
  const grade=menu?mealGrade(menu.dishId,menu.cards.map(c=>c.experience)):undefined;
  function canLeave(){return !guard.current.busy&&(!guard.current.dirty||window.confirm('저장하지 않은 입력을 버리고 이동할까요?'));}
  function choose(id:string){if(id===selected?.experience.id||!canLeave())return;guard.current={dirty:false,busy:false};setSelectedId(id);setMessage('');}
  async function deleted(){guard.current={dirty:false,busy:false};setSelectedId('');await reload();setMessage('이 경험과 연결된 카드 1장을 삭제했어요.');}
  async function removeMenu(){
    if(busy||!menu||!data||!canLeave()||!window.confirm('현재 열린 메뉴 등록과 연결된 모든 식사·카드를 삭제할까요? 다른 도감의 같은 메뉴 등록은 유지합니다.'))return;
    const entry=data.entries.find(e=>e.id===entryId);if(!entry)return;
    setBusy(true);try{const result=await getBrowserRepository().deleteEntry(data.profile.ownerId,entry.id,entry.revision);if(result.ok)router.push('/dex/meal/collection');else setMessage(result.error.message);}finally{setBusy(false);}
  }
  if(loading)return <p role="status">개인 기록을 불러오는 중…</p>;
  if(error)return <p role="alert">{error} <button onClick={()=>void reload()}>다시 읽기</button></p>;
  if(!menu||!data)return <Card className="p-5"><p>이 브라우저에 해당 메뉴가 없습니다.</p><Link href="/dex/meal/collection">수집 목록으로</Link></Card>;
  const shownCards=menu.cards.slice(0,limit);
  if(selected&&!shownCards.some(item=>item.card.id===selected.card.id))shownCards.unshift(selected);
  return <div className="dex-meal-detail space-y-5">
    <Link href="/dex/meal/collection" className="dex-back" onClick={event=>{if(!canLeave())event.preventDefault();}}>← 메뉴 도감 · 카드 앨범</Link>
    <h2 className="sr-only">{splitMenuLabel(menu.name).title} 카드 상세</h2>
    <section ref={focusRef} tabIndex={-1} className="dex-card-detail-hero dex-detail-focus" aria-label="선택 카드와 식사 평가">
      <div className="dex-detail-feature"><EditionCollectionCard name={menu.name} grade={grade} rating={saved?.id===selected?.experience.id?saved?.rating:selected?.experience.rating} acquiredOn={selected?kstToday(new Date(selected.card.acquiredAt)):menu.firstCollectedOn}/></div>
      <div className="dex-detail-rating">{selected?<ExperienceEditor key={selected.experience.id} experience={selected.experience} management={management} onSaved={setSaved} onChanged={reload} onDeleted={deleted} onGuardChange={reportGuard}/>:<Card className="p-5"><h3>다음 한 끼를 기다려요</h3><p>메뉴 등록은 남아 있지만 식사 기록이 없어 아직 평가할 수 없어요.</p></Card>}</div>
    </section>
    {message?<p role="status">{message}</p>:null}
    {menu.cards.length>1?<section className="dex-detail-owned" aria-label="보유 카드 선택"><div className="dex-section-heading"><h2>보유 카드 {menu.cards.length}장</h2><span className="dex-small dex-muted">좌우로 넘겨 선택해 보세요</span></div><div className="dex-detail-card-strip" aria-label="카드 선택 목록">{shownCards.map(item=><EditionCollectionCard key={item.card.id} name={menu.name} grade={grade} rating={saved?.id===item.experience.id?saved.rating:item.experience.rating} acquiredOn={kstToday(new Date(item.card.acquiredAt))} selected={selected?.card.id===item.card.id} onSelect={()=>choose(item.experience.id)}/>)}</div>{menu.cards.length>limit?<button className="dex-edit-button" onClick={()=>setLimit(n=>n+24)}>보유 카드 더 보기</button>:null}</section>:null}
    <div className="dex-detail-secondary">
      <div ref={setManagement}/>
      <details className="dex-tray"><summary>메뉴 정보·등록 관리</summary><p>{menu.name}</p><p>보유 카드 {menu.cards.length}장 · 메뉴 첫 기록 {menu.firstCollectedOn}</p>{personal?.affection?<p className="dex-affection">{personal.affection==='soul'?'♡ 나의 소울푸드':'↻ 나의 단골 메뉴'}</p>:null}<button className="dex-edit-button" disabled={busy} onClick={()=>void removeMenu()}>현재 메뉴 등록 삭제</button></details>
      <details className="dex-tray"><summary>모든 식사 기록 ({menu.cards.length}회)</summary><ul className="dex-experience-picker">{menu.cards.map(item=><li key={item.card.id}><button aria-pressed={selected?.card.id===item.card.id} onClick={()=>choose(item.experience.id)}><time>{item.experience.experiencedOn}</time>{item.experience.rating!==null?` · ★ ${item.experience.rating}`:''}{item.experience.note?` · ${item.experience.note}`:''}</button></li>)}</ul></details>
      <p className="dex-small dex-muted">평가는 선택한 식사에만 저장돼요. 서로 다른 날 별점 4점 이상 2번이면 희귀, 5점 3번이면 전설로 메뉴 등급이 올라가요.</p>
    </div>
  </div>;
}
