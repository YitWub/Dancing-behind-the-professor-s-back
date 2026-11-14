import type { Cafeteria, MealTime } from '../types.ts';
import { isIsoDate } from '../datetime.ts';
import type { HistoricalDay, HistoricalMenu } from './history.ts';
import type { HistoryDayFile } from './history-store.ts';
export interface DayStatisticsScope {from:string;through:string;cafeteria:Cafeteria;mealTimes:MealTime[]}
export interface DishDayStatistic {dishId:string;name:string;rawNames:string[];cafeteria:Cafeteria;firstSeen:string;lastSeen:string;appearanceDates:string[];appearanceDays:number;comparableDays:number;frequency:number;reviewFlags:string[];wilson95:{lower:number;upper:number};rarity:'UNKNOWN'}
export interface IdentityReview {key:string;names:string[];dishIds:string[];reason:string}
export interface HistoryStatistics {schemaVersion:1;generatedAt:string;metric:'restaurant-date';scope:DayStatisticsScope;requestedDates:number;storedDates:number;validDates:string[];closedDates:string[];missingDates:string[];latestProblems:{date:string;status:string;reason:string}[];latestStatusCounts:Record<string,number>;totalMenuRecords:number;uniqueDishIds:number;eligibleMenuRecords:number;menus:DishDayStatistic[];identityReviews:IdentityReview[];singleAppearanceMenus:number;gradeApplication:'UNKNOWN-only'}
export function calendarDates(from:string,through:string){
  if(!isIsoDate(from)||!isIsoDate(through)||from>through)throw Error('올바른 날짜 범위가 필요합니다.');
  const result:string[]=[];const cursor=new Date(from+'T00:00:00Z');
  while(cursor.toISOString().slice(0,10)<=through){result.push(cursor.toISOString().slice(0,10));cursor.setUTCDate(cursor.getUTCDate()+1);if(result.length>3660)throw Error('조회 범위가 너무 큽니다.');}
  return result;
}
export function wilson95(k:number,n:number){if(n<=0)return {lower:0,upper:1};const z=1.959963984540054,p=k/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,r=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;return {lower:Math.max(0,c-r),upper:Math.min(1,c+r)};}
/** Review-only key. Never substitutes for dishId or mutates the live alias table. */
export function identityReviewKey(raw:string){return raw.normalize('NFKC').replace(/^\[천원의\s*아침밥\]\s*/,'').replace(/\s*\([^가-힣]*[A-Za-z][^가-힣]*\)\s*$/,'').replace(/\s+[A-Za-z][A-Za-z0-9 ,.&'’/()\-]*$/,'').replace(/까스/g,'가스').replace(/\s+/g,'').toLowerCase();}
export function buildHistoryStatistics(files:readonly HistoryDayFile[],scope:DayStatisticsScope,generatedAt=new Date().toISOString()):HistoryStatistics{
  if(!scope.mealTimes.length)throw Error('비교 끼니 범위가 필요합니다.');
  const dates=calendarDates(scope.from,scope.through),byDate=new Map<string,HistoryDayFile>();
  for(const file of files){if(file.latest.cafeteria!==scope.cafeteria||!dates.includes(file.latest.date))continue;const old=byDate.get(file.latest.date);if(!old||Date.parse(file.latest.observedAt)>Date.parse(old.latest.observedAt))byDate.set(file.latest.date,file);}
  const valid:HistoricalDay[]=[],closedDates:string[]=[],missingDates:string[]=[];
  const rawRecords=new Map<string,HistoricalMenu>();const latestStatusCounts:Record<string,number>={};
  for(const date of dates){
    const file=byDate.get(date),day=file?.effective;const status=file?.latest.status??'not-attempted';latestStatusCounts[status]=(latestStatusCounts[status]??0)+1;
    if(day)for(const meal of day.meals)for(const item of meal.items)rawRecords.set(item.sourceRecordId,item);
    const units=scope.mealTimes.map(time=>day?.meals.find(meal=>meal.mealTime===time));
    if(units.every(unit=>unit?.state==='closed'))closedDates.push(date);
    else if(day&&units.every(unit=>unit&&(unit.state==='closed'||(unit.state==='complete'&&unit.items.length>0&&unit.items.every(item=>!!item.dishId))))&&units.some(unit=>unit?.state==='complete'))valid.push(day);
    else missingDates.push(date);
  }
  const groups=new Map<string,{items:HistoricalMenu[];dates:Set<string>}>();let eligibleMenuRecords=0;
  for(const day of valid)for(const unit of day.meals.filter(meal=>scope.mealTimes.includes(meal.mealTime)&&meal.state==='complete'))for(const item of unit.items){if(!item.dishId)continue;eligibleMenuRecords++;const group=groups.get(item.dishId)??{items:[],dates:new Set<string>()};group.items.push(item);group.dates.add(day.date);groups.set(item.dishId,group);}
  const menus:DishDayStatistic[]=[...groups].map(([dishId,group])=>{const observed=[...group.dates].sort();return {dishId,name:group.items[0].canonicalName??group.items[0].rawName,rawNames:[...new Set(group.items.map(item=>item.rawName))],cafeteria:scope.cafeteria,firstSeen:observed[0],lastSeen:observed.at(-1)!,appearanceDates:observed,appearanceDays:observed.length,comparableDays:valid.length,frequency:observed.length/valid.length,reviewFlags:[...new Set(group.items.flatMap(item=>item.reviewFlags))],wilson95:wilson95(observed.length,valid.length),rarity:'UNKNOWN' as const};}).sort((a,b)=>b.appearanceDays-a.appearanceDays||a.name.localeCompare(b.name));
  const reviewGroups=new Map<string,HistoricalMenu[]>();
  for(const item of rawRecords.values()){const key=identityReviewKey(item.rawName),group=reviewGroups.get(key)??[];group.push(item);reviewGroups.set(key,group);}
  const identityReviews:IdentityReview[]=[...reviewGroups].filter(([,items])=>new Set(items.flatMap(item=>item.dishId?[item.dishId]:[])).size>1).map(([key,items])=>({key,names:[...new Set(items.map(item=>item.rawName))],dishIds:[...new Set(items.flatMap(item=>item.dishId?[item.dishId]:[]))],reason:'한국어 검토 키는 유사하지만 기존 v1 dishId가 다름; 자동 병합 금지'}));
  return {schemaVersion:1,generatedAt,metric:'restaurant-date',scope,requestedDates:dates.length,storedDates:byDate.size,validDates:valid.map(day=>day.date),closedDates,missingDates,latestProblems:[...byDate.values()].filter(file=>['network-error','parse-error','partial','empty-unknown'].includes(file.latest.status)).map(file=>({date:file.latest.date,status:file.latest.status,reason:file.latest.reason})),latestStatusCounts,totalMenuRecords:rawRecords.size,uniqueDishIds:new Set([...rawRecords.values()].flatMap(item=>item.dishId?[item.dishId]:[])).size,eligibleMenuRecords,menus,identityReviews,singleAppearanceMenus:menus.filter(menu=>menu.appearanceDays===1).length,gradeApplication:'UNKNOWN-only'};
}
/** Analysis-only contract for 4.4. Does not approve or assign a user's rarity. */
export interface ProposedDayRarityPolicy {version:string;status:'proposal';metric:'restaurant-date';minimumDays:number;maximumFrequency:{LEGENDARY:number;RARE:number;UNCOMMON:number}}
export function reviewDayRarityCandidate(stat:DishDayStatistic,proposal:ProposedDayRarityPolicy){
  const b=proposal.maximumFrequency;
  if(proposal.status!=='proposal'||proposal.metric!=='restaurant-date'||proposal.minimumDays<1||!(0<=b.LEGENDARY&&b.LEGENDARY<b.RARE&&b.RARE<b.UNCOMMON&&b.UNCOMMON<1))throw Error('검토용 기준이 잘못되었습니다.');
  const candidate=stat.frequency<=b.LEGENDARY?'LEGENDARY':stat.frequency<=b.RARE?'RARE':stat.frequency<=b.UNCOMMON?'UNCOMMON':'COMMON';
  return {dishId:stat.dishId,metric:'restaurant-date' as const,tier:'UNKNOWN' as const,analysisCandidate:candidate,policyVersion:proposal.version,eligibleForReview:stat.comparableDays>=proposal.minimumDays&&!stat.reviewFlags.includes('mixed-language-name'),requiresApproval:true as const};
}
