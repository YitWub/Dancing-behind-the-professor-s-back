'use client';
import { useEffect, useRef, useState } from 'react';
import type { EntrySubject, Result } from '@/lib/dex/core/types';
export type PersonSubject=Extract<EntrySubject,{kind:'person'}>;
export const emptyPerson:PersonSubject={kind:'person',displayName:''};
export function ProfileFields({value,onChange}:{value:PersonSubject;onChange:(value:PersonSubject)=>void}){
 return <div className="people-fields"><label>이름 또는 별명<input required maxLength={80} autoComplete="off" value={value.displayName} onChange={e=>onChange({...value,displayName:e.target.value})}/></label><label>입학연도 <small>선택</small><input type="number" min={1900} max={2200} placeholder="예: 2026" value={value.admissionYear??''} onChange={e=>onChange({...value,admissionYear:e.target.value?Number(e.target.value):undefined})}/></label><label>학과 <small>선택</small><input maxLength={80} value={value.department??''} onChange={e=>onChange({...value,department:e.target.value})}/></label><label>관계 또는 만남의 맥락 <small>선택</small><input maxLength={80} placeholder="예: 동아리, 같은 수업" value={value.relationship??''} onChange={e=>onChange({...value,relationship:e.target.value})}/></label></div>;
}
export function usePeopleAction(){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');const active=useRef(false);
 async function run<T>(operation:()=>Promise<Result<T>>,success:(value:T)=>void|Promise<void>){
  if(active.current)return;active.current=true;setBusy(true);setMessage('');
  try{const result=await operation();if(result.ok)await success(result.value);else setMessage(result.error.message);}
  catch{setMessage('저장하지 못했어요. 입력은 그대로 있으니 다시 시도해 주세요.');}
  finally{active.current=false;setBusy(false);}
 }
 return {busy,message,setMessage,run};
}
export function usePeopleLeaveGuard(dirty:boolean,busy:boolean){
 useEffect(()=>{if(!dirty&&!busy)return;
 const unload=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};
 const link=(e:MouseEvent)=>{if(!(e.target instanceof Element)||!e.target.closest('a[href]'))return;if(busy||!window.confirm('저장하지 않은 입력을 두고 이동할까요?')){e.preventDefault();e.stopPropagation();}};
 window.addEventListener('beforeunload',unload);document.addEventListener('click',link,true);
 return()=>{window.removeEventListener('beforeunload',unload);document.removeEventListener('click',link,true);};
 },[dirty,busy]);
}
