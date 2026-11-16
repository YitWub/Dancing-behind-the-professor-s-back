import { allBoardLayouts } from './multi-board.ts';
import type { CollectResult, DexDocument, Result } from '../core/types.ts';
import type { Achievement } from '../game/types.ts';
import { isPerson } from './view.ts';

/** One indexed, read-only scope for achievements and the global timeline. */
export function peopleRecords(document:DexDocument){
 const owner=document.profile.ownerId;
 const dexes=document.dexes.filter(d=>d.kind==='people'&&d.ownerId===owner);
 const dexIds=new Set(dexes.map(d=>d.id));
 const entries=document.entries.filter(isPerson).filter(e=>e.ownerId===owner&&dexIds.has(e.dexId));
 const byId=new Map(entries.map(e=>[e.id,e]));
 const experiences=document.experiences.filter(e=>e.kind==='person'&&e.ownerId===owner&&byId.get(e.entryId)?.dexId===e.dexId);
 return {dexes,entries,byId,experiences};
}
export function peopleAchievements(document:DexDocument):Achievement[]{
 const records=peopleRecords(document);
 const memories=records.experiences.filter(e=>e.kind==='person'&&e.event==='memory').length;
 let connections=0;
 for(const dex of records.dexes)for(const board of allBoardLayouts(dex))connections+=new Set(board.edges.filter(e=>e.a!==e.b&&records.byId.has(e.a)&&records.byId.has(e.b)).map(e=>JSON.stringify([e.a,e.b].sort()))).size;
 function goal(id:string,name:string,icon:string,condition:string,count:number,target:number):Achievement{return {id,name,icon,condition,progress:Math.min(count,target),target,status:count>=target?'achieved':'locked',achievedAt:null};}
 return [
  goal('people:first','첫 페이지','▤','첫 번째 인연 등록',records.entries.length,1),
  goal('people:memory','기억 한 조각','✎','인연에 추가 추억 1개 기록',memories,1),
  goal('people:thread','붉은 실','⌁','보드에서 직접 실 1개 연결',connections,1),
  goal('people:collector','추억 수집가','▧','추가 추억 5개 기록',memories,5),
 ];
}
export function peopleTimeline(document:DexDocument,entryId='',order:'newest'|'oldest'='newest'){
 const {byId,experiences}=peopleRecords(document);
 return experiences.filter(e=>!entryId||e.entryId===entryId).sort((a,b)=>{
  const compared=a.experiencedOn.localeCompare(b.experiencedOn)||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id);
  return order==='oldest'?compared:-compared;
 }).map(experience=>({experience,entry:byId.get(experience.entryId)!}));
}
/** Only a newly committed person registration can open a reveal. No mount/import triggers. */
export function personDiscovery(result:Result<CollectResult>):CollectResult|null{
 if(!result.ok)return null;
 const value=result.value;
 return !value.replayed&&value.outcome==='new-entry'&&value.discovery&&value.entry.subject.kind==='person'&&value.experience.kind==='person'&&value.experience.event==='first-met'&&value.experience.entryId===value.entry.id?value:null;
}
