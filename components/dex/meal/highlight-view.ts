import type { DexDocument } from '@/lib/dex/core/types';
import { mealPersonalCards, mealPersonalHighlights } from '../../../lib/dex/meal/game.ts';
import type { MealPersonalCard } from '../../../lib/dex/meal/game.ts';
export interface HighlightSlot {id:string;title:string;badge:string;card:MealPersonalCard|null;others:number;metric:string;emptyTitle:string;emptyHint:string;memorial?:boolean}
/** Presentation choices over the existing aggregates; achievement and ranking rules stay unchanged. */
export function mealHighlightSlots(document:DexDocument,asOf:string):HighlightSlot[]{
  const winners=mealPersonalHighlights(document,asOf),cards=mealPersonalCards(document);
  const first=winners.first[0]??null;
  const repeat=(winners.most[0]?.experiences.length??0)>1?winners.most:[];
  const from=new Date(asOf+'T00:00:00Z');from.setUTCDate(from.getUTCDate()-29);
  const recentCount=(card:MealPersonalCard)=>card.experiences.filter(exp=>exp.experiencedOn>=from.toISOString().slice(0,10)&&exp.experiencedOn<=asOf).length;
  const clearRecent=winners.recent.length===1&&recentCount(winners.recent[0])>1;
  const latest=[...cards].sort((a,b)=>b.firstCollectedAt.localeCompare(a.firstCollectedAt)||a.dishId.localeCompare(b.dishId))[0]??null;
  return [
    {id:'most',title:'가장 많이 만난 한 끼',badge:'나의 자주 찾는 메뉴',card:repeat[0]??null,others:Math.max(0,repeat.length-1),metric:repeat.length?`먹은 기록 ${repeat[0].experiences.length}회`:'',emptyTitle:'단골 메뉴 탐색 중',emptyHint:'마음에 드는 한 끼를 다시 만나 보세요.'},
    {id:'rating',title:'별점으로 남긴 기억',badge:'나의 별점',card:winners.highestRated[0]??null,others:Math.max(0,winners.highestRated.length-1),metric:winners.highestRated.length?`대표 별점 ${winners.highestRated[0].rating} / 5`:'',emptyTitle:'아직 평가 기록이 없어요',emptyHint:'내가 남긴 별점이 이곳에 모여요.'},
    {id:'first',title:'나의 첫 학식',badge:'FIRST DISCOVERY',card:first,others:Math.max(0,winners.first.length-1),metric:first?'컬렉션의 첫 페이지':'',emptyTitle:'첫 페이지를 기다려요',emptyHint:'처음 수집한 메뉴를 기념해 드려요.',memorial:true},
    {id:'recent',title:clearRecent?'요즘 자주 만나는 메뉴':'최근 발견한 카드',badge:clearRecent?'최근 30일':'새로 채운 한 페이지',card:clearRecent?winners.recent[0]:latest,others:0,metric:clearRecent?`최근 30일 ${recentCount(winners.recent[0])}회`:latest?'나의 새로운 발견':'',emptyTitle:'다음 발견을 기다려요',emptyHint:'직접 경험한 메뉴를 한 장씩 모아 보세요.'},
  ];
}
