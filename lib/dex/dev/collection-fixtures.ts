import { CARD_EDITION_POLICY, CARD_EDITIONS } from '../meal/card-editions.ts';
import type { CardEdition, CardInstance } from '../meal/card-editions.ts';

export type EditionWeights = Record<CardEdition,number>;
export type CollectionSort = 'recent'|'edition'|'name'|'visits';
export interface FixtureSettings {count:number;uniqueMenus:number;seed:string;weights:EditionWeights}
export interface PreviewCard {card:CardInstance;dishId:string;name:string;experiencedOn:string;rating:number;note:string}
export interface PreviewMenu {dishId:string;name:string;cards:PreviewCard[];representative:PreviewCard}
import { EDITION_RANK, compareCardViews } from '../meal/card-view.ts';
export { EDITION_RANK } from '../meal/card-view.ts';
export const DEFAULT_WEIGHTS:EditionWeights={...CARD_EDITION_POLICY.weights};
const NAMES=['치즈돈가스','깐풍돈가스','들기름막국수 (Perilla Oil Mixed Buckwheat Noodles)','데리야끼치킨덮밥','나물된장비빔밥&계란후라이','매콤한 해물볶음우동과 바삭한 새우튀김 세트 (Spicy Seafood Udon and Crispy Shrimp Set)','우삼겹된장찌개','버터장조림볶음밥','새우튀김카레라이스','닭갈비','바지락칼국수','제육볶음','토스트와 모카번 브런치 세트','산채비빔밥','고구마치즈돈가스','통소시지키마카레','사골떡만둣국','김치볶음밥','치킨마요덮밥','순두부찌개'];
/** Integer PRNG; identical settings reproduce fixtures without a clock or storage. */
function random(seed:string){let state=2166136261;for(const c of seed)state=Math.imul(state^c.charCodeAt(0),16777619);return ()=>{state+=0x6D2B79F5;let n=state;n=Math.imul(n^(n>>>15),n|1);n^=n+Math.imul(n^(n>>>7),n|61);return ((n^(n>>>14))>>>0)/4294967296;};}
export function validWeights(weights:EditionWeights){return CARD_EDITIONS.every(e=>Number.isInteger(weights[e])&&weights[e]>=0&&weights[e]<=100)&&CARD_EDITIONS.reduce((n,e)=>n+weights[e],0)===100;}
/** Analysis-only fixture generator. No real Dish, database, collection or achievement calls. */
export function generateCollectionPreview(settings:FixtureSettings):PreviewCard[]{
  const {count,uniqueMenus,seed,weights}=settings;
  if(!Number.isInteger(count)||count<1||count>100||!Number.isInteger(uniqueMenus)||uniqueMenus<1||uniqueMenus>count||!validWeights(weights))throw Error('카드 1~100장, 메뉴 1~카드 수, 에디션 비중 합계 100%가 필요합니다.');
  const next=random(seed);
  // Largest-remainder allocation makes requested proportions visible even at small sizes.
  const buckets=CARD_EDITIONS.map((edition,index)=>({edition,index,n:Math.floor(count*weights[edition]/100),remainder:count*weights[edition]/100%1}));
  let remaining=count-buckets.reduce((n,b)=>n+b.n,0);
  for(const bucket of [...buckets].sort((a,b)=>b.remainder-a.remainder||a.index-b.index)){if(!remaining)break;bucket.n++;remaining--;}
  const editions=buckets.flatMap(b=>Array<CardEdition>(b.n).fill(b.edition));
  for(let i=editions.length-1;i>0;i--){const j=Math.floor(next()*(i+1));[editions[i],editions[j]]=[editions[j],editions[i]];}
  return Array.from({length:count},(_,index)=>{
    const menuIndex=index<uniqueMenus?index:Math.floor(next()*uniqueMenus);
    const acquiredAt=new Date(Date.UTC(2026,10,14,12)-index*86400000).toISOString();
    return {dishId:'preview-menu-'+menuIndex,name:(menuIndex>=NAMES.length?['매콤한','고소한','담백한','특제'][Math.floor(menuIndex/NAMES.length)-1]+' ':'')+NAMES[menuIndex%NAMES.length],
      card:{id:'preview-card-'+index,edition:editions[index],acquiredAt,policyVersion:'preview-distribution-v1',origin:'random'},experiencedOn:acquiredAt.slice(0,10),rating:3+index%3,note:index%3===0?'오늘의 한 끼가 기억에 남았어요. (가상 메모)':''};
  });
}
export function groupPreviewMenus(cards:readonly PreviewCard[]):PreviewMenu[]{
  const groups=new Map<string,PreviewMenu>();
  for(const item of cards){const group=groups.get(item.dishId)??{dishId:item.dishId,name:item.name,cards:[],representative:item};group.cards.push(item);if(EDITION_RANK[item.card.edition]>EDITION_RANK[group.representative.card.edition]||(item.card.edition===group.representative.card.edition&&item.card.acquiredAt>group.representative.card.acquiredAt))group.representative=item;groups.set(item.dishId,group);}
  return [...groups.values()];
}
export function sortPreviewCards(cards:readonly PreviewCard[],sort:CollectionSort):PreviewCard[]{
  const counts=new Map(groupPreviewMenus(cards).map(group=>[group.dishId,group.cards.length]));
  return [...cards].sort((a,b)=>compareCardViews({name:a.name,edition:a.card.edition,date:a.card.acquiredAt,id:a.card.id,visits:counts.get(a.dishId)??0},{name:b.name,edition:b.card.edition,date:b.card.acquiredAt,id:b.card.id,visits:counts.get(b.dishId)??0},sort));
}
export function sortPreviewMenus(menus:readonly PreviewMenu[],sort:CollectionSort):PreviewMenu[]{
  const recent=(m:PreviewMenu)=>m.cards.reduce((latest,item)=>item.card.acquiredAt>latest?item.card.acquiredAt:latest,'');
  return [...menus].sort((a,b)=>compareCardViews({name:a.name,edition:a.representative.card.edition,date:recent(a),id:a.dishId,visits:a.cards.length},{name:b.name,edition:b.representative.card.edition,date:recent(b),id:b.dishId,visits:b.cards.length},sort));
}
