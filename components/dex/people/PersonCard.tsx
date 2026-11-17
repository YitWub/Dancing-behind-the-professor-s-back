'use client';
/* eslint-disable @next/next/no-img-element -- Private Blob images stay in the browser. */
import {CharacterAvatar} from './CharacterAvatar';
import {isCharacterAvatar} from '@/lib/dex/people/avatars';
import { useState } from 'react';
import { usePhotoUrl } from './BoardPhotoCard';
import type { PersonSubject } from './PeopleForms';
import Link from 'next/link';
import type { PersonEntry } from '@/lib/dex/people/view';
function BaseAvatar({name}:{name:string}){return <div className="people-avatar" aria-hidden="true"><svg viewBox="0 0 120 104" fill="none"><ellipse cx="60" cy="100" rx="47" ry="7" fill="#879977" opacity=".14"/><path d="M23 102c1-24 14-35 37-35s36 11 37 35" fill="#aebda0"/><path d="M47 68l13 12 13-12-4-9H51z" fill="#f2d8b3"/><path d="M40 39c0-17 9-25 21-25 16 0 22 11 20 28l-3 9H43z" fill="#655d4e"/><path d="M43 39c0-10 6-18 17-18s17 8 17 18v11c0 12-8 20-17 20S43 62 43 50z" fill="#f3dfbf"/><path d="M41 36c3-18 11-23 21-23 16 0 22 13 18 26-7-1-13-7-16-14-5 9-14 11-23 11" fill="#716651"/><path d="M53 48h.1m14 0h.1" stroke="#665e4e" strokeWidth="3" strokeLinecap="round"/><path d="M57 58c2 2 4 2 6 0" stroke="#b68e73" strokeWidth="1.6" strokeLinecap="round"/><path d="M44 75l16 7 16-7" stroke="#f4f3e7" strokeWidth="4" strokeLinejoin="round"/></svg><span className="people-avatar-monogram">{Array.from(name.trim())[0]||'♡'}</span></div>;}
export function PersonAvatar({name,subject,ownerId}:{name:string;subject?:PersonSubject;ownerId?:string}){
 const assetId=subject?.profileAssetId??'',{url,error}=usePhotoUrl(ownerId??'',assetId);
 const [failed,setFailed]=useState('');
 return <div className={'people-character-portrait avatar-'+(subject?.avatar??'classic')}>{assetId&&url&&!error&&failed!==url?<img key={url} draggable={false} src={url} alt={name+' 프로필'} onError={()=>setFailed(url)}/>:<>{isCharacterAvatar(subject?.avatar)?<CharacterAvatar id={subject.avatar}/>:<BaseAvatar name={name}/>}{subject?.avatar&&!isCharacterAvatar(subject.avatar)&&subject.avatar!=='classic'?<span className="people-avatar-token" aria-hidden="true">{{sprout:'🌱',night:'☾',sun:'☀',classic:''}[subject.avatar]}</span>:null}</>}</div>;
}
export function PersonFeatures({subject,compact=false}:{subject:PersonSubject;compact?:boolean}){return <>{subject.nickname?<small className="people-real-name">{subject.displayName}</small>:null}{subject.characterIntro||subject.trait?<p className="people-character-trait">{subject.characterIntro||subject.trait}</p>:null}{subject.tags?.length?<div className="people-character-tags">{(compact?subject.tags.slice(0,1):subject.tags).map(tag=><span key={tag}>#{tag}</span>)}</div>:null}</>;}
/** Presentation only: a future manually positioned board can reuse the same card. */
export function PersonCard({entry,note}:{entry:PersonEntry;note?:string}){const p=entry.subject;return <Link className="people-polaroid" href={`/dex/people/${entry.id}`}><span className="people-pin" aria-hidden="true"/><PersonAvatar name={p.displayName} subject={p} ownerId={entry.ownerId}/><h3>{p.nickname||p.displayName}</h3><PersonFeatures subject={p}/>{p.admissionYear||p.department?<p>{[p.admissionYear&&p.admissionYear+'학번',p.department].filter(Boolean).join(' · ')}</p>:null}{p.relationship?<span className="people-context">{p.relationship}</span>:null}{note?<p className="people-card-note">{note}</p>:null}</Link>;}
