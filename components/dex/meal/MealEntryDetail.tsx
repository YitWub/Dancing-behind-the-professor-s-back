'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Card } from '@/components/ui';
import { useDexDocument } from '@/components/dex/scaffold/useDexDocument';
import { getBrowserRepository } from '@/lib/dex/storage/browser';
import { mealCards } from '@/lib/dex/meal/collection';
import type { MealExperience } from '@/lib/dex/meal/collection';
import type { Rating } from '@/lib/dex/core/types';
import { kstToday } from '@/lib/datetime';
import { CAFETERIA_NAMES, MEAL_TIME_NAMES } from '@/lib/dex/meal/catalog';
import { MealPhoto } from './MealPhoto';
import { CollectionArtwork, mealArtwork } from '@/components/dex/common/CollectionArtwork';
import { splitMenuLabel } from '@/lib/dex/meal/presentation';
import { RarityBadge } from '@/components/dex/common/RarityBadge';
import { mealPersonalCards } from '@/lib/dex/meal/game';

function ExperienceEditor({experience,ownerId,onChanged}:{experience:MealExperience;ownerId:string;onChanged:()=>Promise<void>}) {
  const [rating,setRating]=useState(experience.rating===null?'':String(experience.rating));
  const [note,setNote]=useState(experience.note);
  const [day,setDay]=useState(experience.experiencedOn);
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const active=useRef(false);
  const [editing,setEditing]=useState(false);
  async function save(event:React.FormEvent) {
    event.preventDefault();if(active.current)return;active.current=true;setBusy(true);setMessage('');
    try {
      if(day>kstToday()){setMessage('미래의 식사는 기록할 수 없습니다.');return;}
      const result=await getBrowserRepository().updateExperience(ownerId,experience.id,experience.revision,{experiencedOn:day,note,rating:rating===''?null:Number(rating) as Rating});
      if(result.ok)await onChanged();else setMessage(result.error.message);
    }finally{active.current=false;setBusy(false);}
  }
  async function remove() {
    if(active.current||!window.confirm('이 경험만 삭제할까요? 나머지 경험과 수집 카드는 남습니다.'))return;
    active.current=true;setBusy(true);
    try {const result=await getBrowserRepository().deleteExperience(ownerId,experience.id,experience.revision);if(result.ok)await onChanged();else setMessage(result.error.message);}finally{active.current=false;setBusy(false);}
  }
  const context=experience.context;
  const name=context.snapshot.name??'메뉴명 없음';
  function cancel(){setRating(experience.rating===null?'':String(experience.rating));setNote(experience.note);setDay(experience.experiencedOn);setMessage('');setEditing(false);}
  return <Card as="article" className="dex-experience-card">
    <div className="dex-experience-heading"><div><p className="dex-experience-date"><time dateTime={experience.experiencedOn}>{experience.experiencedOn}</time><span>{CAFETERIA_NAMES[context.cafeteria]} · {MEAL_TIME_NAMES[context.mealTime]}</span></p><h3>{splitMenuLabel(name).title}</h3></div>{!editing?<button className="dex-edit-button" onClick={()=>setEditing(true)} aria-expanded={false}>수정</button>:null}</div>
    {experience.rating!==null?<p className="dex-experience-rating"><span aria-hidden="true">{'★'.repeat(experience.rating)}</span><span>별점 {experience.rating} / 5</span></p>:null}
    {experience.note.trim()?<p className="dex-experience-note">{experience.note}</p>:null}
    <details className="dex-tray"><summary>당시 메뉴 구성 펼쳐보기</summary><p>{context.snapshot.menu.join(' · ')}</p><MealPhoto name={`${name} · 당시 식판 전체 사진`} imageUrl={context.snapshot.imageUrl} imageSourceUrl={context.snapshot.imageSourceUrl}/></details>
    <details className="dex-experience-source"><summary>상세 정보</summary><p>원문 메뉴: {name}</p><p>원본 제공일 {context.date}</p><p>출처 {context.source}</p><p>원본 ID {context.legacyMealItemId}</p></details>
    {editing?<form onSubmit={event=>void save(event)} className="dex-experience-editor space-y-3" aria-label="식사 경험 수정">
      <div className="flex flex-wrap gap-3">
        <label className="text-sm">먹은 날짜<input aria-label="먹은 날짜" type="date" required max={kstToday()} value={day} onChange={e=>setDay(e.target.value)} className="mt-1 block rounded border bg-[var(--e-surface)] p-2"/></label>
        <label className="text-sm">별점 (선택)<select aria-label="별점 (선택)" value={rating} onChange={e=>setRating(e.target.value)} className="mt-1 block rounded border bg-[var(--e-surface)] p-2"><option value="">평가 안 함</option>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n}점</option>)}</select></label>
      </div>
      <label className="block text-sm">한줄평 (선택)<textarea aria-label="한줄평 (선택)" maxLength={500} value={note} onChange={e=>setNote(e.target.value)} rows={2} className="mt-1 block w-full rounded border bg-[var(--e-surface)] p-2"/></label>
      <button disabled={busy} className="rounded-lg bg-[var(--e-accent)] px-3 py-2 text-white disabled:opacity-50" type="submit">평가·메모 저장</button>
      <button disabled={busy} className="dex-edit-button" type="button" onClick={cancel}>취소</button>
      <button disabled={busy} className="ml-3 underline disabled:opacity-50" type="button" onClick={()=>void remove()}>이 경험 삭제</button>
      {message?<p role="alert">{message}</p>:null}
    </form>:null}
  </Card>;
}

export function MealEntryDetail({entryId}:{entryId:string}) {
  const {data,loading,error,reload}=useDexDocument();
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const router=useRouter();
  const card=data?mealCards(data).find(c=>c.entry.id===entryId):null;
  const personal=data?mealPersonalCards(data).find(c=>c.entryIds.includes(entryId)):null;
  async function changed(){await reload();setMessage('개인 경험 기록을 저장했습니다.');}
  async function removeCard(){
    if(busy||!card||!data||!window.confirm('이 수집 카드와 연결된 모든 먹은 기록을 삭제할까요? 개별 경험만 지우려면 아래 경험 삭제를 사용하세요.'))return;
    setBusy(true);
    try{const result=await getBrowserRepository().deleteEntry(data.profile.ownerId,card.entry.id,card.entry.revision);if(result.ok)router.push('/dex/meal/collection');else setMessage(result.error.message);}finally{setBusy(false);}
  }
  if(loading)return <p role="status">개인 기록을 불러오는 중…</p>;
  if(error)return <p role="alert">{error} <button className="underline" onClick={()=>void reload()}>다시 읽기</button></p>;
  if(!card||!data)return <Card className="space-y-3 p-5"><p>이 브라우저에 해당 학식 카드가 없습니다.</p><Link className="underline" href="/dex/meal/collection">수집 목록으로</Link></Card>;
  return <div className="space-y-4">
    <Card className="dex-detail-card space-y-3 p-5">
      <Link className="underline" href="/dex/meal/collection">수집 목록으로</Link>
      <h2 className="text-2xl font-bold">{card.name}</h2>
      <div className="dex-detail-art"><CollectionArtwork kind={mealArtwork(card.name)}/><span className="dex-tag">나의 컬렉션 · 수집 완료</span></div>
      <div className="dex-card-game-tags"><RarityBadge tier="UNKNOWN"/>{personal?.affection?<span className="dex-affection">{personal.affection==='soul'?'♡ 나의 소울푸드':'↻ 나의 단골 메뉴'} · 서로 다른 날 {personal.distinctDays}일</span>:null}</div>
      <p data-testid="experience-count">먹은 기록 {card.experiences.length}회</p><p className="text-sm">첫 기록일 {card.entry.collectedOn} · 도감 등록 {new Date(card.entry.firstCollectedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} KST</p>
      <p>대표 별점: {card.rating===null?'평가 없음':`${card.rating} / 5`}</p><p className="text-sm">최근 평가가 있는 경험을 표시하며 평가 없는 경험은 건너뜁니다.</p>
      <button className="rounded-lg border px-3 py-2 disabled:opacity-50" disabled={busy} onClick={()=>void removeCard()}>수집 카드 삭제</button>
      {message?<p role="status">{message}</p>:null}
    </Card>
    <h2 className="text-xl font-semibold">나의 식사 경험 이력</h2>
    {card.experiences.length===0?<Card className="p-5">경험은 모두 삭제되었지만 수집 카드는 남아 있습니다. 카드를 지우려면 위의 수집 카드 삭제를 사용하세요.</Card>:null}
    <div className="dex-experience-timeline">{card.experiences.map(experience=><ExperienceEditor key={`${experience.id}:${experience.revision}`} experience={experience} ownerId={data.profile.ownerId} onChanged={changed}/>)}</div>
    <p className="text-sm text-[var(--e-muted)]">별점·메모는 이 브라우저의 개인 기록입니다. 공용 학식 후기에 게시하지 않습니다.</p>
  </div>;
}
