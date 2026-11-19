'use client';
import { PeopleBoard } from './PeopleBoard';
import { PeopleAchievements } from './PeopleAchievements';
import { PeopleMemories } from './PeopleMemories';
import { CollectionFeedback } from '@/components/dex/discovery/CollectionFeedback';
import { personDiscovery } from '@/lib/dex/people/game';
import { useRef, useState } from 'react';
import { useDexDocument } from '@/components/dex/scaffold/useDexDocument';
import { getBrowserRepository } from '@/lib/dex/storage/browser';
import type { PreparedImage } from '@/lib/dex/people/photo';
import type { CollectCommand, CollectResult } from '@/lib/dex/core/types';
import { peopleView,personMemories,firstMeetingDate,isPerson } from '@/lib/dex/people/view';
import { kstToday } from '@/lib/datetime';
import { PersonCardFace, PersonCard } from './PersonCard';
import { personGrade } from '@/lib/dex/game/exp';
import { emptyPerson, ProfileFields, ProfilePhotoField, usePeopleAction, usePeopleLeaveGuard } from './PeopleForms';
export function PeopleDex(){
 const {data,loading,error,reload}=useDexDocument();const [adding,setAdding]=useState(false),[person,setPerson]=useState(emptyPerson),[day,setDay]=useState(''),[note,setNote]=useState(''),[search,setSearch]=useState(''),[relationship,setRelationship]=useState(''),[sort,setSort]=useState('recent');
 const [view,setView]=useState<'cards'|'board'|'memories'>('board');
 const [discovery,setDiscovery]=useState<CollectResult|null>(null),shown=useRef(new Set<string>());
 const [image,setImage]=useState<PreparedImage|undefined>(),[preparing,setPreparing]=useState(false);
 const registration=useRef<HTMLFormElement>(null);
 function openRegistration(){setAdding(true);requestAnimationFrame(()=>{registration.current?.scrollIntoView({block:'center',behavior:'instant'});registration.current?.querySelector('input')?.focus();});}
 const action=usePeopleAction(),pending=useRef<{key:string;command:CollectCommand}|null>(null);
 const dirty=adding&&(JSON.stringify(person)!==JSON.stringify(emptyPerson)||!!day||!!note);
 usePeopleLeaveGuard(dirty,action.busy);
 async function save(e:React.FormEvent){e.preventDefault();if(!data||preparing)return;const dex=data.dexes.find(d=>d.kind==='people');if(!dex){action.setMessage('인연도감을 찾지 못했어요. 다시 불러와 주세요.');return;}
 const key=JSON.stringify([person,day,note]);if(pending.current?.key!==key)pending.current={key,command:{ownerId:data.profile.ownerId,dexId:dex.id,requestId:crypto.randomUUID(),subject:{...person,displayName:person.displayName.trim()},experience:{kind:'person',event:'first-met',experiencedOn:day||kstToday(),note}}};
 const command=pending.current!.command;await action.run(()=>getBrowserRepository().collect(command,image),async(value)=>{const event=personDiscovery({ok:true,value});if(event?.discovery&&!shown.current.has(event.discovery.key)){shown.current.add(event.discovery.key);setDiscovery(event);}pending.current=null;setPerson(emptyPerson);setImage(undefined);setDay('');setNote('');setAdding(false);action.setMessage('새로운 인연을 기록했어요.');await reload();});}
 const rows=data?peopleView(data,search,relationship,sort):[],contexts=data?[...new Set(peopleView(data).map(e=>e.subject.relationship).filter((s):s is string=>!!s))].sort():[];
 return <div className="people-page people-dex-page"><header className="people-heading people-dex-heading"><div><h2>나의 인연도감</h2><p>함께한 순간을 한 페이지에.</p></div><button className="dex-button" disabled={loading||!!error||action.busy} onClick={()=>{if(adding&&dirty&&!window.confirm('등록 중인 입력을 닫을까요?'))return;setAdding(!adding);}}>{adding?'등록 닫기':'새 인연 발견'}</button></header>
 {discovery?<CollectionFeedback result={{ok:true,value:discovery}} itemName={discovery.entry.subject.kind==='person'?discovery.entry.subject.displayName:''} onDismiss={()=>setDiscovery(null)} detailHref={'/dex/people/'+discovery.entry.id} artwork={isPerson(discovery.entry)?<PersonCardFace entry={discovery.entry} variant="discovery"/>:undefined} title="새로운 인연 발견!"><p>나만의 도감에 등록되었어요.</p></CollectionFeedback>:null}
 <details className="people-privacy people-local-note"><summary>로컬 저장 안내</summary><p>이 브라우저에만 저장돼요. 같은 브라우저 프로필을 쓰는 사람은 볼 수 있어요. 홈에서 기록을 내보내 보관할 수 있어요.</p></details>
 {loading?<p role="status">인연을 불러오는 중…</p>:null}{error?<p role="alert">{error} <button onClick={()=>void reload()}>다시 읽기</button></p>:null}<p role="status">{action.message}</p>
 {adding?<form ref={registration} className="people-paper people-registration" onSubmit={save}><h3>새로운 인연을 기록해 볼까요?</h3><fieldset disabled={action.busy||preparing}><ProfileFields value={person} onChange={setPerson} portrait={<ProfilePhotoField value={person} ownerId={data?.profile.ownerId} image={image} onChange={(value,next)=>{setPerson(value);setImage(next);}} onBusy={setPreparing}/>}><label>첫 만남 날짜 <small>선택 · 비우면 오늘을 기록일로 저장해요</small><input type="date" value={day} max={kstToday()} onChange={e=>setDay(e.target.value)}/></label><label>처음 만난 계기 또는 짧은 기억 <small>선택</small><textarea rows={2} maxLength={500} value={note} onChange={e=>setNote(e.target.value)} placeholder="동아리 OT에서 옆자리에 앉았어요."/></label></ProfileFields><button className="dex-button" type="submit" disabled={preparing}>{action.busy?'저장 중…':'인연 등록'}</button></fieldset></form>:null}
 {data?<><div className="people-view-tabs" role="tablist" aria-label="인연 수첩 섹션">{([{id:'cards',label:'카드 앨범'},{id:'board',label:'인연 보드'},{id:'memories',label:'추억 기록'}] as const).map((tab,index)=><button key={tab.id} id={'people-tab-'+tab.id} type="button" role="tab" aria-selected={view===tab.id} aria-controls="people-active-section" tabIndex={view===tab.id?0:-1} onClick={()=>setView(tab.id)} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?2:(index+(e.key==='ArrowRight'?1:2))%3;setView((['cards','board','memories'] as const)[next]);e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus();}}>{tab.label}</button>)}</div><section id="people-active-section" role="tabpanel" aria-labelledby={'people-tab-'+view}>{view==='memories'?<PeopleMemories data={data}/>:view==='board'?<PeopleBoard data={data} onChanged={reload} onAddPerson={openRegistration}/>:<><div className="people-tools"><label>인연 검색<input type="search" placeholder="이름 또는 별명" value={search} onChange={e=>setSearch(e.target.value)}/></label><label>만남의 맥락<select value={relationship} onChange={e=>setRelationship(e.target.value)}><option value="">모든 인연</option>{contexts.map(s=><option key={s}>{s}</option>)}</select></label><label>정렬<select value={sort} onChange={e=>setSort(e.target.value)}><option value="recent">최근 기록순</option><option value="name">이름순</option><option value="first">첫 만남 기록순</option></select></label></div><div className="people-album-heading"><div><span>나의 인연 카드</span><h3>함께한 장면을 한 장씩.</h3></div><p>{rows.length}장의 이야기</p></div><section className="people-card-album" aria-label="인연 카드 목록">{rows.length?rows.map(entry=><PersonCard key={entry.id} entry={entry} grade={personGrade(entry,data)} firstMet={firstMeetingDate(data,entry)} note={entry.subject.memo||personMemories(data,entry.id).find(e=>e.note.trim())?.note}/>):<p className="people-empty">{search||relationship?'조건에 맞는 인연이 없어요.':'아직 비어 있는 추억 보드예요. 첫 인연을 기록해 보세요.'}</p>}</section></>}</section><PeopleAchievements data={data}/></>:null}</div>;
}
