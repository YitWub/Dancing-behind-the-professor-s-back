import { createHash } from 'node:crypto';
import type { Cafeteria, MealTime } from '../types.ts';
import { isIsoDate } from '../datetime.ts';
import { parseDetailPhp } from './crawler.ts';
import { resolveDish } from '../dex/meal/identity.ts';
import type { MealObservation } from '../dex/meal/rarity.ts';

export const HISTORY_PARSER_VERSION='daily-evidence-v1';
export const HISTORY_TIMES:readonly MealTime[]=['breakfast','lunch'];
export type HistoryStatus='complete'|'partial'|'closed'|'empty-unknown'|'parse-error'|'network-error';
export interface HistoricalMenu {date:string;cafeteria:Cafeteria;mealTime:MealTime;rawName:string;canonicalName:string|null;dishId:string|null;legacyId:string;sourceRecordId:string;menu:string[];price:number|null;source:string;observedAt:string;reviewFlags:string[]}
export interface HistoricalMeal {mealTime:MealTime;state:MealObservation['state'];rawCardCount:number;items:HistoricalMenu[];reason:string}
export interface HistoricalDay {schemaVersion:1;parserVersion:string;date:string;cafeteria:Cafeteria;source:string;observedAt:string;httpStatus:number|null;htmlHash:string|null;status:HistoryStatus;meals:HistoricalMeal[];reason:string}
const ALL_TIMES:readonly MealTime[]=['breakfast','lunch','dinner'];
export function historySource(date:string,facilityId=1){return `https://life.hanyang.ac.kr/theme/pages/facilities/detail.php?id=${facilityId}&date=${date}&view=daily`;}
export function failedHistoryDay(date:string,cafeteria:Cafeteria,source:string,observedAt:string,status:'network-error'|'parse-error',reason:string,httpStatus:number|null=null):HistoricalDay{
  return {schemaVersion:1,parserVersion:HISTORY_PARSER_VERSION,date,cafeteria,source,observedAt,httpStatus,htmlHash:null,status,meals:ALL_TIMES.map(mealTime=>({mealTime,state:status==='network-error'?'failed':'partial',rawCardCount:0,items:[],reason})),reason};
}
/** Reuses the live parser, but independently verifies selected date, restaurant and full daily card count. */
export async function parseHistoricalDay(html:string,date:string,cafeteria:Cafeteria,facilityId:number,observedAt:string):Promise<HistoricalDay>{
  const source=historySource(date,facilityId);
  if(!isIsoDate(date))throw Error('잘못된 제공일');
  const hash=createHash('sha256').update(html).digest('hex');
  const pane=html.match(/id=["']view-pane-daily["'][^>]*>([\s\S]*?)<\/section>/i)?.[1];
  const selected=[...(pane??'').matchAll(/<button\b[^>]*>/g)].filter(m=>/\bis-selected\b/.test(m[0])).map(m=>m[0].match(/selectDay\(['"](\d{4}-\d{2}-\d{2})['"]\)/)?.[1]);
  const expected:Record<Cafeteria,string>={haksik:'학생식당',faculty:'교직원식당',changbo:'창업보육센터식당',dorm:'창의인재원식당'};
  const facName=html.match(/<div class=["']fac-name["']>([^<]+)<\/div>/)?.[1].trim();
  if(!pane||selected.length!==1||selected[0]!==date||facName!==expected[cafeteria])return {...failedHistoryDay(date,cafeteria,source,observedAt,'parse-error','선택 날짜·식당·일별 식단 구조 확인 실패',200),htmlHash:hash};
  const parsed=parseDetailPhp(html,date,facilityId,cafeteria);
  const groups=pane.split('<div class="menu-group">').slice(1);
  const explicitDayClosed=new RegExp(`선택하신 일자\\(${date}\\).{0,12}(?:휴무|미운영|운영하지 않습니다)`).test(pane);
  const meals:HistoricalMeal[]=[];
  for(const mealTime of ALL_TIMES){
    const chunks=groups.filter(group=>group.match(/meal-badge--(breakfast|lunch|dinner)/)?.[1]===mealTime);
    const rawCount=chunks.reduce((sum,group)=>sum+(group.match(/<div class="menu-card-v">/g)?.length??0),0);
    const raw=parsed.items.filter(item=>item.mealTime===mealTime);
    const items:HistoricalMenu[]=[];
    for(const item of raw){
      const resolved=await resolveDish(item.name,'https://life.hanyang.ac.kr/theme/pages/home.php');
      const canonical=resolved.ok?resolved.dish.canonicalName:null;
      const reviewFlags:string[]=[];
      if(!resolved.ok)reviewFlags.push('unresolved-name');
      // Flags are review suggestions only; never rewrite an existing identityKey.
      if(canonical&&/[가-힣]/.test(canonical)&&/[A-Za-z]/.test(canonical))reviewFlags.push('mixed-language-name');
      if(/[&*+/]/.test(canonical??''))reviewFlags.push('set-or-composition-review');
      const sourceRecordId=createHash('sha256').update(JSON.stringify([date,cafeteria,mealTime,item.name,item.menu,item.price])).digest('hex');
      items.push({date,cafeteria,mealTime,rawName:item.name??'',canonicalName:canonical,dishId:resolved.ok?resolved.dish.id:null,legacyId:item.id,sourceRecordId,menu:item.menu,price:item.price,source,observedAt,reviewFlags});
    }
    const explicitClosed=explicitDayClosed||chunks.some(group=>rawCount===0&&/(?:조식|중식|석식).{0,12}(?:휴무|미운영|운영하지 않습니다)/.test(group.replace(/<[^>]*>/g,' ')));
    const complete=rawCount>0&&rawCount===raw.length&&items.every(item=>!!item.dishId);
    meals.push({mealTime,rawCardCount:rawCount,items,state:complete?'complete':explicitClosed?'closed':rawCount>0?'partial':'unknown',reason:complete?'모든 일별 메뉴 카드를 파싱하고 v1 dishId로 식별':explicitClosed?'해당 날짜·끼니의 명시적인 미운영 안내 확인':rawCount?'원본 카드 수·메뉴 식별 결과 불일치':'해당 끼니 데이터 없음; 미운영 여부는 불명'});
  }
  const required=meals.filter(meal=>HISTORY_TIMES.includes(meal.mealTime));
  const hasAny=meals.some(meal=>meal.items.length>0);
  const complete=required.every(meal=>meal.state==='complete'||meal.state==='closed')&&required.some(meal=>meal.state==='complete');
  const closed=required.every(meal=>meal.state==='closed');
  const status:HistoryStatus=complete?'complete':closed?'closed':hasAny?'partial':meals.some(meal=>meal.rawCardCount>0)?'parse-error':'empty-unknown';
  return {schemaVersion:1,parserVersion:HISTORY_PARSER_VERSION,date,cafeteria,source,observedAt,httpStatus:200,htmlHash:hash,status,meals,reason:complete?'조식·중식 비교 범위의 상태 확인 완료':closed?'조식·중식 모두 명시적 미운영':hasAny?'일부 끼니만 확인; 전체 날짜 통계에서 제외':'빈 식단의 원인 불명; 미등장/휴무로 집계하지 않음'};
}
export function historyToMealObservations(days:readonly HistoricalDay[]):MealObservation[]{return days.flatMap(day=>day.meals.map(meal=>({date:day.date,cafeteria:day.cafeteria,mealTime:meal.mealTime,source:day.source,observedAt:day.observedAt,state:meal.state,identitiesResolved:meal.items.every(item=>!!item.dishId&&!item.reviewFlags.includes('mixed-language-name')),dishIds:[...new Set(meal.items.flatMap(item=>item.dishId?[item.dishId]:[]))]})));}
