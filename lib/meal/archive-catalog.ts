/** Server-only, read-only bridge from observed history to selectable meal offerings. */
import type { CrawlResult, Cafeteria, MealItem } from '../types.ts';
import type { HistoryDayFile } from './history-store.ts';
import { observationRoot, readHistoryDay } from './history-store.ts';
import { isIsoDate } from '../datetime.ts';

export function mergeArchivedMeals(base:CrawlResult,date:string,records:HistoryDayFile[]):CrawlResult{
  if(!isIsoDate(date))throw Error('올바른 제공 날짜가 필요합니다.');
  const official=(source:string)=>{try{return new URL(source).origin==='https://life.hanyang.ac.kr';}catch{return false;}};
  const real=official(base.source)&&base.fallback!=='seed'&&(base.ok||base.fallback==='cache');
  const items:MealItem[]=real?[...base.items]:[];
  const occupied=new Set(items.filter(item=>item.date===date).map(item=>item.cafeteria+'|'+item.mealTime));
  const observed:string[]=[];let archiveSource='';
  for(const record of records){
    const day=record.effective;
    if(!day||day.date!==date||!['complete','partial'].includes(day.status)||!official(day.source)||!day.htmlHash||!Number.isFinite(Date.parse(day.observedAt)))continue;
    for(const meal of day.meals){
      const key=day.cafeteria+'|'+meal.mealTime;
      if(meal.state!=='complete'||occupied.has(key))continue;
      const valid=meal.items.filter(item=>item.date===date&&item.cafeteria===day.cafeteria&&item.mealTime===meal.mealTime&&item.dishId&&item.rawName.trim()&&official(item.source));
      if(!valid.length)continue;
      items.push(...valid.map((item):MealItem=>({id:item.legacyId+'-archive-'+item.sourceRecordId,date,cafeteria:item.cafeteria,mealTime:item.mealTime,name:item.rawName,menu:[...item.menu],price:item.price,kcal:null,imageUrl:null,imageSourceUrl:null})));
      occupied.add(key);observed.push(day.observedAt);archiveSource=day.source;
    }
  }
  if(!observed.length)return base;
  const times=[...observed,...(real&&Number.isFinite(Date.parse(base.fetchedAt))?[base.fetchedAt]:[])].sort();
  return {ok:true,source:real?base.source:archiveSource,fetchedAt:times[0],items,cafeterias:base.cafeterias};
}
export function readArchivedMealCatalog(base:CrawlResult,date:string,root=observationRoot()):CrawlResult{
  if(!isIsoDate(date))throw Error('올바른 제공 날짜가 필요합니다.');
  const cafeterias:Cafeteria[]=['haksik','changbo','dorm','faculty'];
  const records=cafeterias.flatMap(cafeteria=>{const record=readHistoryDay(root,cafeteria,date);return record?[record]:[];});
  return mergeArchivedMeals(base,date,records);
}
