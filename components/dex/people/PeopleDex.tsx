'use client';
import { PeopleBoard } from './PeopleBoard';
import { PeopleAchievements } from './PeopleAchievements';
import { PeopleMemories } from './PeopleMemories';
import { CollectionFeedback } from '@/components/dex/discovery/CollectionFeedback';
import { personDiscovery } from '@/lib/dex/people/game';
import { useRef, useState } from 'react';
import { useDexDocument } from '@/components/dex/scaffold/useDexDocument';
import { getBrowserRepository } from '@/lib/dex/storage/browser';
import type { CollectCommand, CollectResult } from '@/lib/dex/core/types';
import { peopleView,personMemories } from '@/lib/dex/people/view';
import { kstToday } from '@/lib/datetime';
import { PersonAvatar, PersonCard } from './PersonCard';
import { emptyPerson, ProfileFields, usePeopleAction, usePeopleLeaveGuard } from './PeopleForms';
export function PeopleDex(){
 const {data,loading,error,reload}=useDexDocument();const [adding,setAdding]=useState(false),[person,setPerson]=useState(emptyPerson),[day,setDay]=useState(''),[note,setNote]=useState(''),[search,setSearch]=useState(''),[relationship,setRelationship]=useState(''),[sort,setSort]=useState('recent');
 const [view,setView]=useState<'cards'|'board'|'memories'>('board');
 const [discovery,setDiscovery]=useState<CollectResult|null>(null),shown=useRef(new Set<string>());
 const registration=useRef<HTMLFormElement>(null);
 function openRegistration(){setAdding(true);requestAnimationFrame(()=>{registration.current?.scrollIntoView({block:'center',behavior:'instant'});registration.current?.querySelector('input')?.focus();});}
 const action=usePeopleAction(),pending=useRef<{key:string;command:CollectCommand}|null>(null);
 const dirty=adding&&(JSON.stringify(person)!==JSON.stringify(emptyPerson)||!!day||!!note);
 usePeopleLeaveGuard(dirty,action.busy);
 async function save(e:React.FormEvent){e.preventDefault();if(!data)return;const dex=data.dexes.find(d=>d.kind==='people');if(!dex){action.setMessage('인연도감을 찾지 못했어요. 다시 불러와 주세요.');return;}
 const key=JSON.stringify([person,day,note]);if(pending.current?.key!==key)pending.current={key,command:{ownerId:data.profile.ownerId,dexId:dex.id,requestId:crypto.randomUUID(),subject:{...person,displayName:person.displayName.trim()},experience:{kind:'person',event:'first-met',experiencedOn:day||kstToday(),note}}};
 const command=pending.current!.command;await action.run(()=>getBrowserRepository().collect(command),async(value)=>{const event=personDiscovery({ok:true,value});if(event?.discovery&&!shown.current.has(event.discovery.key)){shown.current.add(event.discovery.key);setDiscovery(event);}pending.current=null;setPerson(emptyPerson);setDay('');setNote('');setAdding(false);action.setMessage('새로운 인연을 기록했어요.');await reload();});}
 const rows=data?peopleView(data,search,relationship,sort):[],contexts=data?[...new Set(peopleView(data).map(e=>e.subject.relationship).filter((s):s is string=>!!s))].sort():[];
 return <div className="people-page people-dex-page"><header className="people-heading people-dex-heading"><div><span className="people-kicker">함께한 순간을 모아요</span><h2>나의 인연도감</h2><p>이름보다 오래 남는, 우리만의 작은 기억.</p></div><button className="dex-button" disabled={loading||!!error||action.busy} onClick={()=>{if(adding&&dirty&&!window.confirm('등록 중인 입력을 닫을까요?'))return;setAdding(!adding);}}>{adding?'등록 닫기':'새 인연 기록'}</button></header>
 {discovery?<CollectionFeedback result={{ok:true,value:discovery}} itemName={discovery.entry.subject.kind==='person'?discovery.entry.subject.displayName:''} onDismiss={()=>setDiscovery(null)} detailHref={'/dex/people/'+discovery.entry.id} artwork={<PersonAvatar name={discovery.entry.subject.kind==='person'?discovery.entry.subject.displayName:''}/>} title="새로운 인연을 기록했어요!"><p>나의 대학생활에 새로운 페이지가 생겼어요.</p></CollectionFeedback>:null}
 <p className="people-privacy people-local-note">이 브라우저에만 저장돼요. 같은 브라우저 프로필을 쓰는 사람은 볼 수 있어요. 홈에서 기록을 내보내 보관할 수 있어요.</p>
 {loading?<p role="status">인연을 불러오는 중…</p>:null}{error?<p role="alert">{error} <button onClick={()=>void reload()}>다시 읽기</button></p>:null}<p role="status">{action.message}</p>
 {adding?<form ref={registration} className="people-paper people-registration" onSubmit={save}><h3>새로운 인연을 기록해 볼까요?</h3><fieldset disabled={action.busy}><ProfileFields value={person} onChange={setPerson}/><label>첫 만남 날짜 <small>선택 · 비우면 오늘을 기록일로 저장해요</small><input type="date" value={day} max={kstToday()} onChange={e=>setDay(e.target.value)}/></label><label>처음 만난 계기 또는 짧은 기억 <small>선택</small><textarea rows={2} maxLength={500} value={note} onChange={e=>setNote(e.target.value)} placeholder="동아리 OT에서 옆자리에 앉았어요."/></label><button className="dex-button" type="submit">{action.busy?'저장 중…':'인연 등록'}</button></fieldset></form>:null}
 {data?<><div className="people-actions people-view-tabs" aria-label="인연 보기 방식"><button aria-pressed={view==='cards'} onClick={()=>setView('cards')}>카드 보기</button><button aria-pressed={view==='board'} onClick={()=>setView('board')}>보드 보기</button><button aria-pressed={view==='memories'} onClick={()=>setView('memories')}>추억 모아보기</button></div>{view==='memories'?<PeopleMemories data={data}/>:view==='board'?<PeopleBoard data={data} onChanged={reload} onAddPerson={openRegistration}/>:<><div className="people-tools"><label>인연 검색<input type="search" placeholder="이름 또는 별명" value={search} onChange={e=>setSearch(e.target.value)}/></label><label>만남의 맥락<select value={relationship} onChange={e=>setRelationship(e.target.value)}><option value="">모든 인연</option>{contexts.map(s=><option key={s}>{s}</option>)}</select></label><label>정렬<select value={sort} onChange={e=>setSort(e.target.value)}><option value="recent">최근 기록순</option><option value="name">이름순</option><option value="first">첫 만남 기록순</option></select></label></div><p className="people-count">인연 {rows.length}명</p><section className="people-board" aria-label="인연 카드 목록">{rows.length?rows.map(entry=><PersonCard key={entry.id} entry={entry} note={entry.subject.memo||personMemories(data,entry.id).find(e=>e.note.trim())?.note}/>):<p className="people-empty">{search||relationship?'조건에 맞는 인연이 없어요.':'아직 비어 있는 추억 보드예요. 첫 인연을 기록해 보세요.'}</p>}</section></>}<PeopleAchievements data={data}/></>:null}</div>;
}
