import type { CollectResult, DexDocument, Result, Rating } from '../core/types.ts';
import type { Achievement, GameNotice } from '../game/types.ts';
import type { MealExperience } from './collection.ts';
import { unknownMealRarity } from './rarity.ts';
import type { RarityAssessment } from './rarity.ts';
import { kstToday } from '../../datetime.ts';

export interface MealPersonalCard {dishId:string;name:string;entryIds:string[];firstCollectedAt:string;experiences:MealExperience[];distinctDays:number;rating:Rating|null;note:string|null;affection:'soul'|'regular'|null}
export type MealRarityProvider=(dishId:string)=>RarityAssessment;
export function mealPersonalCards(document:DexDocument):MealPersonalCard[]{
  const dexes=new Set(document.dexes.filter(d=>d.kind==='meal'&&d.ownerId===document.profile.ownerId).map(d=>d.id));
  const groups=new Map<string,MealPersonalCard>();
  for(const entry of document.entries){
    if(entry.subject.kind!=='meal'||!dexes.has(entry.dexId)||entry.ownerId!==document.profile.ownerId)continue;
    const key=entry.subject.dishId;
    const group=groups.get(key)??{dishId:key,name:entry.subject.displayNameSnapshot,entryIds:[],firstCollectedAt:entry.firstCollectedAt,experiences:[],distinctDays:0,rating:null,note:null,affection:null};
    group.entryIds.push(entry.id);if(entry.firstCollectedAt<group.firstCollectedAt)group.firstCollectedAt=entry.firstCollectedAt;groups.set(key,group);
  }
  for(const group of groups.values()){
    group.experiences=document.experiences.filter((exp):exp is MealExperience=>exp.kind==='meal'&&exp.ownerId===document.profile.ownerId&&group.entryIds.includes(exp.entryId)&&dexes.has(exp.dexId));
    group.experiences.sort((a,b)=>b.experiencedOn.localeCompare(a.experiencedOn)||b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
    group.distinctDays=new Set(group.experiences.map(exp=>exp.experiencedOn)).size;
    group.rating=group.experiences.find(exp=>exp.rating!==null)?.rating??null;
    group.note=group.experiences.find(exp=>exp.note.trim())?.note??null;
    group.affection=group.distinctDays>=10?'soul':group.distinctDays>=5?'regular':null;
  }
  return [...groups.values()].sort((a,b)=>a.firstCollectedAt.localeCompare(b.firstCollectedAt)||a.dishId.localeCompare(b.dishId));
}
export function mealAchievements(document:DexDocument,rarity:MealRarityProvider=unknownMealRarity):Achievement[]{
  const cards=mealPersonalCards(document),visits=cards.flatMap(c=>c.experiences);
  const days=Math.max(0,...cards.map(card=>card.distinctDays)),restaurants=new Set(visits.map(exp=>exp.context.cafeteria)).size;
  const assessments=cards.map(card=>rarity(card.dishId));
  const rarityReady=assessments.length>0&&assessments.every(r=>r.confirmed&&r.tier!=='UNKNOWN'&&!!r.policyVersion);
  function goal(id:string,name:string,icon:string,condition:string,raw:number|null,target:number):Achievement{return {id,name,icon,condition,progress:raw===null?null:Math.min(raw,target),target,status:raw===null?'preparing':raw>=target?'achieved':'locked',achievedAt:null};}
  return [
    goal('meal:first','첫 발견','✦','메뉴 1종 수집',cards.length,1),
    goal('meal:five','도감 입문자','▧','서로 다른 메뉴 5종 수집',cards.length,5),
    goal('meal:ten','메뉴 수집가','▦','서로 다른 메뉴 10종 수집',cards.length,10),
    goal('meal:regular','단골손님','↻','같은 메뉴를 서로 다른 날 5일 경험',days,5),
    goal('meal:soul','소울푸드','♡','같은 메뉴를 서로 다른 날 10일 경험',days,10),
    goal('meal:explorer','캠퍼스 미식 탐험가','⌁','서로 다른 식당 3곳 경험',restaurants,3),
    goal('meal:rare-three','희귀 메뉴 수집가','◇','통계로 확정된 RARE 이상 메뉴 3종',rarityReady?assessments.filter(r=>r.tier==='RARE'||r.tier==='LEGENDARY').length:null,3),
    goal('meal:legendary','전설의 미식가','✧','통계로 확정된 LEGENDARY 메뉴 1종',rarityReady?assessments.filter(r=>r.tier==='LEGENDARY').length:null,1),
  ];
}
/** Attribute unlocks to this committed experience, not to component mount/import or a retry. */
export function mealGameNotices(after:DexDocument,result:Result<CollectResult>,now:string,rarity:MealRarityProvider=unknownMealRarity):GameNotice[]{
  if(!result.ok||result.value.replayed||result.value.entry.subject.kind!=='meal'||result.value.experience.kind!=='meal')return [];
  const event=result.value;
  if(event.entry.ownerId!==after.profile.ownerId||!after.experiences.some(exp=>exp.id===event.experience.id))return [];
  const before:DexDocument={...after,entries:event.outcome==='new-entry'?after.entries.filter(entry=>entry.id!==event.entry.id):after.entries,experiences:after.experiences.filter(exp=>exp.id!==event.experience.id)};
  const previous=mealPersonalCards(before),current=mealPersonalCards(after);
  const dishId=event.entry.subject.kind==='meal'?event.entry.subject.dishId:'';
  const card=current.find(card=>card.dishId===dishId);if(!card)return [];
  const older=previous.find(card=>card.dishId===dishId);
  const notices:GameNotice[]=[];
  const title=(id:string,text:string,description:string)=>notices.push({id:'title:'+id,kind:'title',title:text,description});
  const isNewDish=event.outcome==='new-entry'&&!older;
  if(isNewDish){
    if(!previous.length)title('meal:first','첫 번째 발견','나의 학식 컬렉션이 시작됐어요.');
    const day=kstToday(new Date(event.committedAt));
    if(day===now&&!previous.some(card=>kstToday(new Date(card.firstCollectedAt))===day))title('meal:day:'+day,'오늘의 첫 발견','식사한 날과 별개로, 오늘 처음 등록한 새 메뉴예요.');
    const rating=rarity(dishId);
    if(rating.confirmed&&rating.policyVersion&&rating.tier==='RARE')title('meal:rare:'+dishId,'희귀 메뉴 발견!','확정된 관측 범위에서 드물게 제공된 메뉴예요.');
    if(rating.confirmed&&rating.policyVersion&&rating.tier==='LEGENDARY')title('meal:legendary:'+dishId,'전설의 학식을 발견했다!','확정된 관측 통계의 전설 등급 메뉴예요.');
  }
  if((older?.distinctDays??0)<5&&card.distinctDays>=5)title('meal:regular:'+dishId,'돌아온 단골손님','이 메뉴와 서로 다른 날 5일을 함께했어요.');
  if((older?.distinctDays??0)<10&&card.distinctDays>=10)title('meal:soul:'+dishId,'나의 소울푸드','이 메뉴와 서로 다른 날 10일의 기억이 쌓였어요.');
  const was=mealAchievements(before,rarity),achievements=mealAchievements(after,rarity);
  if(was.find(a=>a.id==='meal:explorer')?.status!=='achieved'&&achievements.find(a=>a.id==='meal:explorer')?.status==='achieved')title('meal:explorer','캠퍼스 미식 탐험가','내 기록에 세 식당의 식사가 모였어요.');
  for(const achievement of achievements){if(achievement.status==='achieved'&&was.find(a=>a.id===achievement.id)?.status!=='achieved')notices.push({id:'achievement:'+achievement.id,kind:'achievement',title:achievement.name,description:achievement.condition});}
  return notices;
}
export function mealPersonalHighlights(document:DexDocument,asOf:string){
  const cards=mealPersonalCards(document);
  function top(score:(card:MealPersonalCard)=>number){const best=Math.max(0,...cards.map(score));return best>0?cards.filter(card=>score(card)===best):[];}
  const from=new Date(asOf+'T00:00:00Z');from.setUTCDate(from.getUTCDate()-29);const start=from.toISOString().slice(0,10);
  const first=cards.length?cards.filter(card=>card.firstCollectedAt===cards[0].firstCollectedAt):[];
  return {most:top(card=>card.experiences.length),highestRated:top(card=>card.rating??0),first,recent:top(card=>card.experiences.filter(exp=>exp.experiencedOn>=start&&exp.experiencedOn<=asOf).length)};
}
