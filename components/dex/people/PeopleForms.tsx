'use client';
/* eslint-disable @next/next/no-img-element -- Local-only preview must not use an external image optimizer. */
import {AvatarPicker} from './AvatarPicker';
import {IntroductionFields} from './IntroductionFields';
import type {ReactNode} from 'react';
import { PersonAvatar } from './PersonCard';
import { optimizePhoto } from '@/lib/dex/people/photo';
import type { PreparedImage } from '@/lib/dex/people/photo';
import { useEffect, useRef, useState } from 'react';
import type { EntrySubject, Result } from '@/lib/dex/core/types';
export type PersonSubject=Extract<EntrySubject,{kind:'person'}>;
export const emptyPerson:PersonSubject={kind:'person',displayName:''};
export function ProfileFields({value,onChange,portrait,children}:{value:PersonSubject;onChange:(value:PersonSubject)=>void;portrait?:ReactNode;children?:ReactNode}){
 return <div className="people-registration-fields"><label>이름<input required maxLength={80} autoComplete="off" value={value.displayName} onChange={e=>onChange({...value,displayName:e.target.value})}/></label>
 <label>이 사람에 대해 기억나는 점 <small>선택 · 500자 이내</small><textarea rows={3} maxLength={500} placeholder="커피를 자주 마시고, 밤에 같이 게임해요." value={value.trait??''} onChange={e=>onChange({...value,trait:e.target.value})}/></label>
 <AvatarPicker value={value} onChange={onChange}/>{portrait}<IntroductionFields value={value} onChange={onChange}/>
 <details className="people-additional"><summary>추가 정보</summary><div className="people-fields"><label>입학연도 <small>선택</small><input type="number" min={1900} max={2200} placeholder="예: 2026" value={value.admissionYear??''} onChange={e=>onChange({...value,admissionYear:e.target.value?Number(e.target.value):undefined})}/></label><label>학과 <small>선택</small><input maxLength={80} value={value.department??''} onChange={e=>onChange({...value,department:e.target.value})}/></label><label>관계 또는 만남의 맥락 <small>선택</small><input maxLength={80} value={value.relationship??''} onChange={e=>onChange({...value,relationship:e.target.value})}/></label>
 {value.tags!==undefined?<label>기존 특징 태그 <small>쉼표로 구분 · 3개, 각 16자</small><input maxLength={50} value={value.tags.join(',')} onChange={e=>onChange({...value,tags:e.target.value.split(',')})} onBlur={()=>onChange({...value,tags:[...new Set((value.tags??[]).map(t=>t.trim()).filter(Boolean))]})}/></label>:null}{children}</div></details></div>;
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

/** Prepared photos stay in component memory until the entry transaction commits. */
export function ProfilePhotoField({value,ownerId,image,onChange,onBusy}:{value:PersonSubject;ownerId?:string;image?:PreparedImage;onChange:(value:PersonSubject,image?:PreparedImage)=>void;onBusy:(busy:boolean)=>void}){
 const [error,setError]=useState('');const active=useRef(false);
 return <div className="people-profile-photo-field"><div className="people-profile-photo-preview">{image?<PreparedPortrait image={image}/>:<PersonAvatar name={value.displayName} subject={value} ownerId={ownerId}/>}</div><label>프로필 사진 <small>선택 · JPG·PNG·WebP, 원본 10MB 이하 · 외부 전송 없음</small><input type="file" accept="image/jpeg,image/png,image/webp" onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file||active.current)return;active.current=true;onBusy(true);setError('');try{const next=await optimizePhoto(file);onChange({...value,profileAssetId:'img-'+next.sha256},next);}catch{setError('사진 형식·크기를 확인해 주세요. 원래 사진과 입력은 유지돼요.');}finally{active.current=false;onBusy(false);}}}/></label>{value.profileAssetId?<button type="button" onClick={()=>{const next={...value};delete next.profileAssetId;onChange(next,undefined);}}>프로필 사진 제거</button>:null}<p role="alert">{error}</p></div>;
}

function PreparedPortrait({image}:{image:PreparedImage}){
 const ref=useRef<HTMLImageElement>(null);
 useEffect(()=>{const url=URL.createObjectURL(image.blob);if(ref.current)ref.current.src=url;return()=>URL.revokeObjectURL(url);},[image]);
 return <img ref={ref} alt="저장 전 프로필 미리보기"/>;
}
