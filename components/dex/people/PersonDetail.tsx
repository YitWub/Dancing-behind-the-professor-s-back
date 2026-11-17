'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import type { PreparedImage } from '@/lib/dex/people/photo';
import type { CollectCommand, Experience } from '@/lib/dex/core/types';
import { getBrowserRepository } from '@/lib/dex/storage/browser';
import { useDexDocument } from '@/components/dex/scaffold/useDexDocument';
import { isPerson, personMemories, firstMeetingDate, type PersonEntry } from '@/lib/dex/people/view';
import { kstToday } from '@/lib/datetime';
import {GENDER_LABELS,ENERGY_LABELS} from '@/lib/dex/people/person-fields';
import { PersonCardFace } from './PersonCard';
import { ProfileFields,ProfilePhotoField,usePeopleAction,usePeopleLeaveGuard } from './PeopleForms';

function ProfileEditor({entry,onDone}:{entry:PersonEntry;onDone:()=>Promise<void>}){
 const [image,setImage]=useState<PreparedImage|undefined>(),[preparing,setPreparing]=useState(false);
 const [base]=useState(entry);const [subject,setSubject]=useState(entry.subject),action=usePeopleAction();const dirty=JSON.stringify(subject)!==JSON.stringify(base.subject);
 usePeopleLeaveGuard(dirty,action.busy);
 return <form className="people-paper" onSubmit={e=>{e.preventDefault();if(preparing)return;void action.run(()=>getBrowserRepository().updateEntry(base.ownerId,base.id,base.revision,{subject:{...subject,displayName:subject.displayName.trim()}},image),onDone);}}><h3>인연 정보 수정</h3><fieldset disabled={action.busy||preparing}><ProfileFields value={subject} onChange={setSubject} portrait={<ProfilePhotoField value={subject} ownerId={entry.ownerId} image={image} onChange={(value,next)=>{setSubject(value);setImage(next);}} onBusy={setPreparing}/>}><label>짧은 소개 또는 개인 메모<textarea rows={2} maxLength={500} value={subject.memo??''} onChange={e=>setSubject({...subject,memo:e.target.value})}/></label></ProfileFields><div className="people-actions"><button className="dex-button" type="submit" disabled={preparing}>{action.busy?'저장 중…':'정보 저장'}</button><button type="button" onClick={()=>{if(!dirty||window.confirm('수정한 입력을 취소할까요?'))void onDone();}}>취소</button></div></fieldset><p role="status">{action.message}</p></form>;
}
function MemoryEditor({experience,onDone}:{experience:Experience;onDone:()=>Promise<void>}){
 const [base]=useState(experience);const [day,setDay]=useState(experience.experiencedOn),[note,setNote]=useState(experience.note),action=usePeopleAction();
 const dirty=day!==base.experiencedOn||note!==base.note;usePeopleLeaveGuard(dirty,action.busy);
 return <form className="people-memory-edit" onSubmit={e=>{e.preventDefault();void action.run(()=>getBrowserRepository().updateExperience(base.ownerId,base.id,base.revision,{experiencedOn:day,note}),onDone);}}><fieldset disabled={action.busy}><label>기억 날짜<input required type="date" max={kstToday()} value={day} onChange={e=>setDay(e.target.value)}/></label><label>기억 내용<textarea rows={3} maxLength={500} value={note} onChange={e=>setNote(e.target.value)}/></label><div className="people-actions"><button className="dex-button" type="submit">{action.busy?'저장 중…':'기억 저장'}</button><button type="button" onClick={()=>{if(!dirty||window.confirm('수정한 입력을 취소할까요?'))void onDone();}}>취소</button></div></fieldset><p role="status">{action.message}</p></form>;
}
function NewMemory({entry,onSaved}:{entry:PersonEntry;onSaved:()=>Promise<void>}){
 const [note,setNote]=useState(''),[day,setDay]=useState(kstToday),action=usePeopleAction(),pending=useRef<{key:string;command:CollectCommand}|null>(null);
 usePeopleLeaveGuard(!!note,action.busy);
 async function save(e:React.FormEvent){e.preventDefault();const key=JSON.stringify([day,note,entry.subject]);if(pending.current?.key!==key)pending.current={key,command:{ownerId:entry.ownerId,dexId:entry.dexId,entryId:entry.id,requestId:crypto.randomUUID(),subject:entry.subject,experience:{kind:'person',event:'memory',experiencedOn:day,note}}};
 await action.run(()=>getBrowserRepository().collect(pending.current!.command),async()=>{pending.current=null;setNote('');action.setMessage('함께한 기억을 남겼어요.');await onSaved();});}
 return <form className="people-paper" onSubmit={save}><h3>오늘의 기억 한 조각</h3><fieldset disabled={action.busy}><label>기억 날짜<input required type="date" max={kstToday()} value={day} onChange={e=>setDay(e.target.value)}/></label><label>함께한 기억<textarea required maxLength={500} rows={2} value={note} onChange={e=>setNote(e.target.value)} placeholder="축제에서 같이 웃었던 순간…"/></label><button className="dex-button" type="submit" disabled={!note.trim()}>{action.busy?'저장 중…':'추억 남기기'}</button></fieldset><p role="status">{action.message}</p></form>;
}
export function PersonDetail({entryId}:{entryId:string}){
 const {data,loading,error,reload}=useDexDocument(),router=useRouter(),action=usePeopleAction();const [editing,setEditing]=useState(false),[memoryId,setMemoryId]=useState('');
 const entry=data?.entries.find(e=>e.id===entryId);const person=entry&&isPerson(entry)&&data?.dexes.some(d=>d.id===entry.dexId&&d.kind==='people')?entry:null;
 if(loading)return <p role="status">인연을 불러오는 중…</p>;
 if(error)return <p role="alert">{error} <button onClick={()=>void reload()}>다시 읽기</button></p>;
 if(!person||!data)return <div className="people-page"><h2>이 인연 기록을 찾을 수 없어요.</h2><Link href="/dex/people">인연도감으로 돌아가기</Link></div>;
 const p=person.subject,memories=personMemories(data,person.id);
 async function removeMemory(experience:Experience){if(!window.confirm('이 추억을 삭제할까요? 인연 카드는 남아 있어요.'))return;await action.run(()=>getBrowserRepository().deleteExperience(experience.ownerId,experience.id,experience.revision),async()=>{setMemoryId('');await reload();action.setMessage('추억을 삭제했어요.');});}
 return <div className="people-page"><Link className="dex-back" href="/dex/people">← 인연도감</Link><section className="people-profile people-card-detail"><div className="people-detail-card"><PersonCardFace entry={person} variant="detail" firstMet={firstMeetingDate(data,person)}/></div><div className="people-profile-note"><div className="people-detail-heading"><span>인연의 기록</span><h2>{p.displayName}</h2></div><dl className="person-detail-facts">{p.age!==undefined?<><dt>나이</dt><dd>{p.age}세</dd></>:null}{p.gender?<><dt>성별</dt><dd>{GENDER_LABELS[p.gender]}</dd></>:null}{p.relationship?<><dt>관계</dt><dd>{p.relationship}</dd></>:null}{p.mbti?<><dt>MBTI</dt><dd>{p.mbti}</dd></>:null}{p.energyType?<><dt>에겐·테토</dt><dd>{ENERGY_LABELS[p.energyType]}</dd></>:null}</dl>{p.admissionYear||p.department?<p>{[p.admissionYear&&p.admissionYear+'학번',p.department].filter(Boolean).join(' · ')}</p>:null}{p.trait?<div className="people-original-traits"><h3>내가 기억하는 모습</h3><p>{p.trait}</p></div>:null}{p.characterIntro?<div><h3>발견 소개</h3><p>{p.characterIntro}</p></div>:null}<p>{p.memo||'함께한 순간을 천천히 쌓아 보세요.'}</p><button onClick={()=>setEditing(!editing)} disabled={action.busy||editing}>정보 수정</button></div></section>
 {editing?<ProfileEditor entry={person} onDone={async()=>{setEditing(false);await reload();}}/>:null}
 <section><div className="people-heading"><h2>함께한 기억</h2><span>{memories.length}개의 기록</span></div><NewMemory entry={person} onSaved={reload}/><ol className="people-timeline">{memories.map(experience=><li key={experience.id}><div className="people-memory-heading"><span className="people-context">{experience.kind==='person'&&experience.event==='first-met'?'첫 만남 기록':'함께한 추억'}</span><time dateTime={experience.experiencedOn}>{experience.experiencedOn}</time></div>{memoryId===experience.id?<MemoryEditor experience={experience} onDone={async()=>{setMemoryId('');await reload();}}/>:<><p className="people-memory-note">{experience.note||'아직 적어 둔 기억이 없어요.'}</p><div className="people-actions"><button disabled={action.busy||!!memoryId} onClick={()=>setMemoryId(experience.id)}>수정</button><button disabled={action.busy||!!memoryId} onClick={()=>void removeMemory(experience)}>삭제</button></div></>}</li>)}</ol>{!memories.length?<p>아직 추억이 없어요. 첫 기억을 남겨 보세요.</p>:null}</section>
 <p role="status">{action.message}</p><details className="people-management"><summary>기록 관리</summary><p>인연을 삭제하면 연결된 모든 추억도 삭제돼요. 복원이 필요하다면 먼저 도감 홈에서 내보내 주세요.</p><button disabled={action.busy||editing||!!memoryId} onClick={()=>{if(!window.confirm('이 인연과 연결된 모든 추억을 삭제할까요? 되돌릴 수 없어요.'))return;void action.run(()=>getBrowserRepository().deleteEntry(person.ownerId,person.id,person.revision),()=>router.push('/dex/people'));}}>인연과 추억 삭제</button></details></div>;
}
