'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { DexDocument } from '@/lib/dex/core/types';
import { peopleRecords, peopleTimeline } from '@/lib/dex/people/game';
export function PeopleMemories({data}:{data:DexDocument}){
 const [person,setPerson]=useState(''),[order,setOrder]=useState<'newest'|'oldest'>('newest'),[limit,setLimit]=useState(30);
 const entries=useMemo(()=>peopleRecords(data).entries.sort((a,b)=>a.subject.displayName.localeCompare(b.subject.displayName,'ko')||a.id.localeCompare(b.id)),[data]);
 const nameCounts=useMemo(()=>{const counts=new Map<string,number>();for(const entry of entries)counts.set(entry.subject.displayName,(counts.get(entry.subject.displayName)??0)+1);return counts;},[entries]);
 const selected=entries.some(e=>e.id===person)?person:'';
 const rows=useMemo(()=>peopleTimeline(data,selected,order),[data,selected,order]);
 return <section aria-labelledby="people-memories-title"><h2 id="people-memories-title">추억 모아보기</h2><div className="people-tools"><label>인연별 필터<select aria-label="추억 인연 필터" value={selected} onChange={e=>{setPerson(e.target.value);setLimit(30);}}><option value="">모든 인연</option>{entries.map((entry,i)=><option key={entry.id} value={entry.id}>{entry.subject.displayName}{entry.subject.relationship?' · '+entry.subject.relationship:''}{(nameCounts.get(entry.subject.displayName)??0)>1?' · 인연 '+(i+1):''}</option>)}</select></label><label>날짜 정렬<select aria-label="추억 날짜 정렬" value={order} onChange={e=>{setOrder(e.target.value as typeof order);setLimit(30);}}><option value="newest">최근 날짜순</option><option value="oldest">오래된 날짜순</option></select></label></div><p className="people-count">기록 {rows.length}개 · 최초 만남과 이후 추억을 함께 돌아봐요.</p>{rows.length?<><ol className="people-timeline">{rows.slice(0,limit).map(({entry,experience})=><li key={experience.id}><div className="people-memory-heading"><Link href={'/dex/people/'+entry.id} className="dex-back">{entry.subject.displayName} · 인연 상세 ↗</Link><time dateTime={experience.experiencedOn}>{experience.experiencedOn}</time><span className="people-context">{experience.kind==='person'&&experience.event==='first-met'?'첫 만남 기록':'함께한 추억'}</span></div><p className="people-memory-note">{experience.note||'아직 적어 둔 기억이 없어요.'}</p></li>)}</ol>{limit<rows.length?<button className="dex-button" onClick={()=>setLimit(n=>n+30)}>추억 30개 더 보기</button>:null}</>:<p className="people-empty">{selected?'이 인연에 남긴 기록이 아직 없어요.':'아직 모아 볼 기억이 없어요. 인연을 등록하고 함께한 순간을 남겨 보세요.'}</p>}</section>;
}
