'use client';
import { useEffect, useRef, useState } from 'react';
import type { Rating } from '@/lib/dex/core/types';
import type { MealExperience } from '@/lib/dex/meal/collection';
import { saveMealRating } from '@/lib/dex/meal/quick-rating';
import { getBrowserRepository } from '@/lib/dex/storage/browser';

export interface RatingGuard {dirty:boolean;busy:boolean}
export function QuickMealRating({experience,onGuardChange,onSaved,onLater}:{experience:MealExperience;onGuardChange:(guard:RatingGuard)=>void;onSaved:()=>Promise<void>;onLater:()=>void}) {
  const [current,setCurrent]=useState(experience);
  const [rating,setRating]=useState<Rating|null>(experience.rating);
  const [note,setNote]=useState(experience.note);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const active=useRef(false);
  const dirty=rating!==current.rating||note!==current.note;
  useEffect(()=>{
    if(!dirty)return;
    const preventLoss=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',preventLoss);
    return()=>window.removeEventListener('beforeunload',preventLoss);
  },[dirty]);
  function changeRating(next:Rating|null){setRating(next);setMessage('');onGuardChange({dirty:next!==current.rating||note!==current.note,busy:false});}
  function changeNote(next:string){setNote(next);setMessage('');onGuardChange({dirty:rating!==current.rating||next!==current.note,busy:false});}
  async function save(event:React.FormEvent){
    event.preventDefault();if(active.current)return;active.current=true;setBusy(true);setMessage('');onGuardChange({dirty,busy:true});
    const result=await saveMealRating(getBrowserRepository(),current,{rating,note});
    active.current=false;setBusy(false);
    if(result.ok&&result.value.kind==='meal'){
      setCurrent(result.value);setMessage('이번 식사의 평가를 저장했어요.');onGuardChange({dirty:false,busy:false});await onSaved();
    }else{setMessage(`${result.ok?'평가 결과를 확인해 주세요.':result.error.message} 수집은 완료되어 있고, 입력한 평가는 그대로 남아 있어요.`);onGuardChange({dirty,busy:false});}
  }
  return <form className="dex-quick-rating" onSubmit={event=>void save(event)} aria-label="이번 식사 빠른 평가">
    <h3>방금 먹은 메뉴, 어땠나요?</h3><p>선택 사항이에요. 수집은 이미 완료됐어요.</p>
    <fieldset disabled={busy}><legend className="sr-only">이번 식사 별점</legend><div className="dex-rating-stars">{([1,2,3,4,5] as const).map(n=><label key={n} className={rating!==null&&n<=rating?'is-selected':''}><input type="radio" name={`rating-${experience.id}`} aria-label={`${n}점`} checked={rating===n} onChange={()=>changeRating(n)}/><span aria-hidden="true">★</span></label>)}<button type="button" className="dex-rating-clear" onClick={()=>changeRating(null)}>평가 안 함</button></div>
    <label className="dex-quick-note">한줄평 <span>선택 · 최대 500자</span><textarea aria-label="빠른 한줄평" maxLength={500} rows={2} value={note} onChange={e=>changeNote(e.target.value)} placeholder="그날의 한 끼를 짧게 남겨 보세요."/></label></fieldset>
    <div className="dex-quick-actions"><button className="dex-button" type="submit" disabled={busy||!dirty}>{busy?'평가 저장 중…':'평가 저장'}</button><button type="button" className="dex-button dex-button--quiet" disabled={busy} onClick={onLater}>나중에 작성하기</button></div>
    {message?<p role={message.includes('저장했어요.')?'status':'alert'}>{message}</p>:null}
  </form>;
}
