import type { CollectionEntry, DexDocument, Experience } from '../core/types.ts';
export type PersonEntry = CollectionEntry & { subject: Extract<CollectionEntry['subject'], {kind:'person'}> };
export function isPerson(entry:CollectionEntry):entry is PersonEntry{return entry.subject.kind==='person';}
export function personMemories(data:DexDocument,id:string):Experience[]{return data.experiences.filter(e=>e.entryId===id&&e.kind==='person').sort((a,b)=>b.experiencedOn.localeCompare(a.experiencedOn)||b.createdAt.localeCompare(a.createdAt));}
export function peopleView(data:DexDocument,search='',relationship='',sort='recent'){
 const dexes=new Set(data.dexes.filter(d=>d.kind==='people').map(d=>d.id));
 const rows=data.entries.filter(isPerson).filter(e=>dexes.has(e.dexId));
 const recent=(e:PersonEntry)=>data.experiences.filter(x=>x.entryId===e.id).reduce((last,x)=>x.updatedAt>last?x.updatedAt:last,e.updatedAt);
 return rows.filter(e=>[e.subject.displayName,e.subject.nickname??''].join(' ').toLocaleLowerCase('ko').includes(search.trim().toLocaleLowerCase('ko'))&&(!relationship||e.subject.relationship===relationship))
 .sort((a,b)=>sort==='name'?a.subject.displayName.localeCompare(b.subject.displayName,'ko'):sort==='first'?firstMeetingDate(data,a).localeCompare(firstMeetingDate(data,b))||a.createdAt.localeCompare(b.createdAt):recent(b).localeCompare(recent(a))||b.id.localeCompare(a.id));
}

export function firstMeetingDate(data:DexDocument,entry:PersonEntry){return data.experiences.filter(e=>e.entryId===entry.id&&e.kind==='person'&&e.event==='first-met').map(e=>e.experiencedOn).sort()[0]??entry.collectedOn;}
