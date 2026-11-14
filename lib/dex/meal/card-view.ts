import type { DexDocument } from '../core/types.ts';
import type { MealExperience } from './collection.ts';
import { experienceCard } from './card-editions.ts';
import type { CardEdition, CardInstance } from './card-editions.ts';
import { splitMenuLabel } from './presentation.ts';
export const EDITION_RANK:Record<CardEdition,number>={NORMAL:0,SPECIAL:1,RARE:2,GOLDEN:3};
export type CardSort='recent'|'edition'|'name'|'visits';
export interface OwnedMealCard {card:CardInstance;experience:MealExperience;dishId:string;entryId:string;name:string;visits:number}
export interface MealMenuView {dishId:string;entryId:string;entryIds:string[];name:string;cards:OwnedMealCard[];representative:OwnedMealCard|null;latest:string;firstCollectedOn:string}
/** Read-only adapter: validated personal snapshot -> menus and individual cards, never fixtures. */
export function buildMealCollection(doc:DexDocument):{menus:MealMenuView[];cards:OwnedMealCard[]}{
  if(doc.profile.namespace!=='personal')return {menus:[],cards:[]};
  const dexes=new Set(doc.dexes.filter(d=>d.kind==='meal'&&d.ownerId===doc.profile.ownerId).map(d=>d.id));
  const entries=doc.entries.filter(e=>e.ownerId===doc.profile.ownerId&&dexes.has(e.dexId)&&e.subject.kind==='meal').sort((a,b)=>a.firstCollectedAt.localeCompare(b.firstCollectedAt)||a.id.localeCompare(b.id));
  const menus=new Map<string,MealMenuView>(),byEntry=new Map<string,MealMenuView>();
  for(const entry of entries){if(entry.subject.kind!=='meal')continue;const group=menus.get(entry.subject.dishId)??{dishId:entry.subject.dishId,entryId:entry.id,entryIds:[],name:entry.subject.displayNameSnapshot,cards:[],representative:null,latest:entry.firstCollectedAt,firstCollectedOn:entry.collectedOn};group.entryIds.push(entry.id);menus.set(group.dishId,group);byEntry.set(entry.id,group);}
  for(const exp of doc.experiences){const group=byEntry.get(exp.entryId);if(exp.kind!=='meal'||exp.ownerId!==doc.profile.ownerId||!group||!dexes.has(exp.dexId))continue;group.cards.push({card:experienceCard(exp)!,experience:exp,dishId:group.dishId,entryId:exp.entryId,name:group.name,visits:0});}
  for(const group of menus.values()){
    group.cards.sort((a,b)=>b.card.acquiredAt.localeCompare(a.card.acquiredAt)||a.card.id.localeCompare(b.card.id));
    for(const item of group.cards)item.visits=group.cards.length;
    group.representative=[...group.cards].sort((a,b)=>EDITION_RANK[b.card.edition]-EDITION_RANK[a.card.edition]||b.card.acquiredAt.localeCompare(a.card.acquiredAt)||a.card.id.localeCompare(b.card.id))[0]??null;
    group.latest=group.cards[0]?.card.acquiredAt??group.latest;
  }
  const result=[...menus.values()];return {menus:result,cards:result.flatMap(m=>m.cards)};
}
export function compareCardViews(a:{name:string;edition:CardEdition|null;date:string;id:string;visits:number},b:typeof a,sort:CardSort){
  const rank=(e:CardEdition|null)=>e===null?-1:EDITION_RANK[e];
  return (sort==='edition'?rank(b.edition)-rank(a.edition):sort==='name'?splitMenuLabel(a.name).title.localeCompare(splitMenuLabel(b.name).title,'ko'):sort==='visits'?b.visits-a.visits:0)||b.date.localeCompare(a.date)||a.id.localeCompare(b.id);
}
export function queryMealCollection(collection:ReturnType<typeof buildMealCollection>,{sort,search,edition}:{sort:CardSort;search:string;edition:CardEdition|'all'}){
  const matches=(name:string)=>name.toLocaleLowerCase('ko').includes(search.trim().toLocaleLowerCase('ko'));
  const menus=collection.menus.filter(m=>matches(m.name)&&(edition==='all'||m.cards.some(c=>c.card.edition===edition))).sort((a,b)=>compareCardViews({name:a.name,edition:a.representative?.card.edition??null,date:a.latest,id:a.dishId,visits:a.cards.length},{name:b.name,edition:b.representative?.card.edition??null,date:b.latest,id:b.dishId,visits:b.cards.length},sort));
  const cards=collection.cards.filter(c=>matches(c.name)&&(edition==='all'||c.card.edition===edition)).sort((a,b)=>compareCardViews({name:a.name,edition:a.card.edition,date:a.card.acquiredAt,id:a.card.id,visits:a.visits},{name:b.name,edition:b.card.edition,date:b.card.acquiredAt,id:b.card.id,visits:b.visits},sort));
  return {menus,cards};
}
export function mealDetailHref(card:OwnedMealCard){return `/dex/meal/collection/${encodeURIComponent(card.entryId)}?experience=${encodeURIComponent(card.experience.id)}`;}
