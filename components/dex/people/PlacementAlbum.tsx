'use client';
import {useEffect,useRef,useState} from 'react';
import {PersonAvatar} from './PersonCard';
import type {PersonEntry} from '@/lib/dex/people/view';
export function PlacementAlbum({entries,placedIds,busy,message,onPlace,onClose,onNewPerson}:{entries:PersonEntry[];placedIds:ReadonlySet<string>;busy:boolean;message:string;onPlace:(id:string)=>Promise<boolean>;onClose:()=>void;onNewPerson:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),[search,setSearch]=useState('');
 useEffect(()=>{const el=dialog.current,previous=document.activeElement as HTMLElement|null;el?.showModal();return()=>{el?.close();if(previous?.isConnected)previous.focus();};},[]);
 const rows=entries.filter(e=>e.subject.displayName.toLocaleLowerCase('ko').includes(search.trim().toLocaleLowerCase('ko'))).sort((a,b)=>Number(placedIds.has(a.id))-Number(placedIds.has(b.id))||a.subject.displayName.localeCompare(b.subject.displayName,'ko'));
 return <dialog ref={dialog} className="person-placement-dialog" aria-labelledby="placement-album-title" onCancel={e=>{e.preventDefault();if(!busy)onClose();}}><header><div><h2 id="placement-album-title">내 카드 앨범</h2><p>현재 보드에 배치할 인연을 골라 주세요.</p></div><button disabled={busy} onClick={onClose} aria-label="앨범 닫기">닫기 ×</button></header>
 <label>이름 검색<input autoFocus type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="이름으로 찾기" disabled={busy}/></label><p role="status">{message}</p>
 {entries.length?<div className="person-placement-list">{rows.map(entry=><button key={entry.id} type="button" className="person-placement-item" disabled={busy||placedIds.has(entry.id)} aria-label={entry.subject.displayName+(placedIds.has(entry.id)?' 배치됨':' 배치')} onClick={()=>void onPlace(entry.id)}><PersonAvatar name={entry.subject.displayName} subject={entry.subject} ownerId={entry.ownerId}/><strong>{entry.subject.displayName}</strong><span>{placedIds.has(entry.id)?'배치됨':'이 보드에 배치'}</span></button>)}</div>:<div className="person-placement-empty"><p>아직 등록한 인연이 없어요.</p><button className="dex-button" onClick={onNewPerson} disabled={busy}>새 인연 기록</button></div>}
 {entries.length&&!rows.length?<p>이름과 일치하는 인연이 없어요.</p>:null}<p className="people-privacy">원본 인연과 추억은 유지되고, 이 보드에 카드만 배치돼요.</p></dialog>;
}
