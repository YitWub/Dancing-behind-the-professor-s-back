import type { RarityTier } from '../game/types.ts';
import type { Cafeteria, MealTime } from './types.ts';
import { isIsoDate } from '../../datetime.ts';

export interface MealObservation {
  date:string;cafeteria:Cafeteria;mealTime:MealTime;source:string;observedAt:string;
  state:'complete'|'partial'|'failed'|'closed'|'unknown';
  identitiesResolved:boolean;dishIds:string[];
}
export interface ObservationScope {cafeterias:readonly Cafeteria[];mealTimes:readonly MealTime[];from:string;through:string}
export interface ObservationRepository {list(scope:ObservationScope):Promise<MealObservation[]>}
export interface RarityPolicy {
  status:'approved';version:string;minimumUnits:number;minimumDates:number;
  maximumFrequency:{LEGENDARY:number;RARE:number;UNCOMMON:number};
}
export interface RarityAssessment {
  dishId:string;tier:RarityTier;confirmed:boolean;reason:string;
  validUnits:number;distinctDates:number;appearances:number;frequency:number|null;
  policyVersion:string|null;scope:ObservationScope|null;
}
export function unknownMealRarity(dishId:string):RarityAssessment{return {dishId,tier:'UNKNOWN',confirmed:false,reason:'관측 데이터·등급 기준을 준비 중이에요.',validUnits:0,distinctDates:0,appearances:0,frequency:null,policyVersion:null,scope:null};}
/** There is deliberately no production policy. Caller must supply an explicitly approved policy. */
export function assessMealRarity(dishId:string,observations:readonly MealObservation[],scope:ObservationScope,asOf:string,policy?:RarityPolicy):RarityAssessment{
  const result={...unknownMealRarity(dishId),scope};
  if(!isIsoDate(scope.from)||!isIsoDate(scope.through)||!isIsoDate(asOf)||scope.from>scope.through||!scope.cafeterias.length||!scope.mealTimes.length)return {...result,reason:'관측 범위를 확인해 주세요.'};
  const effective=new Map<string,MealObservation>();
  for(const row of observations){
    if(!isIsoDate(row.date)||row.date<scope.from||row.date>scope.through||row.date>asOf||!scope.cafeterias.includes(row.cafeteria)||!scope.mealTimes.includes(row.mealTime)||!Number.isFinite(Date.parse(row.observedAt))||Date.parse(row.observedAt)>Date.parse(asOf+'T23:59:59.999+09:00'))continue;
    try{if(new URL(row.source).origin!=='https://life.hanyang.ac.kr')continue;}catch{continue;}
    if(row.state!=='closed'&&(row.state!=='complete'||!row.identitiesResolved||!row.dishIds.length||row.dishIds.some(id=>!id)))continue;
    const key=[row.date,row.cafeteria,row.mealTime].join('|'),old=effective.get(key);
    if(!old||Date.parse(row.observedAt)>Date.parse(old.observedAt))effective.set(key,row);
    else if(Date.parse(row.observedAt)===Date.parse(old.observedAt)&&JSON.stringify([row.state,[...new Set(row.dishIds)].sort()])!==JSON.stringify([old.state,[...new Set(old.dishIds)].sort()]))effective.set(key,{...row,state:'partial',identitiesResolved:false});
  }
  const valid=[...effective.values()].filter(row=>row.state==='complete');
  result.validUnits=valid.length;result.distinctDates=new Set(valid.map(row=>row.date)).size;
  result.appearances=valid.filter(row=>new Set(row.dishIds).has(dishId)).length;
  result.frequency=result.validUnits?result.appearances/result.validUnits:null;
  if(!policy)return result;
  const bands=policy.maximumFrequency;
  if(policy.status!=='approved'||!policy.version||!Number.isInteger(policy.minimumUnits)||policy.minimumUnits<1||!Number.isInteger(policy.minimumDates)||policy.minimumDates<1||!(0<=bands.LEGENDARY&&bands.LEGENDARY<bands.RARE&&bands.RARE<bands.UNCOMMON&&bands.UNCOMMON<1))return {...result,reason:'확정된 등급 기준이 아닙니다.'};
  if(result.validUnits<policy.minimumUnits||result.distinctDates<policy.minimumDates||result.appearances===0)return {...result,reason:'통계 표본이 부족해 희귀도를 조사 중이에요.'};
  const rate=result.frequency!;
  return {...result,tier:rate<=bands.LEGENDARY?'LEGENDARY':rate<=bands.RARE?'RARE':rate<=bands.UNCOMMON?'UNCOMMON':'COMMON',confirmed:true,policyVersion:policy.version,reason:'확정 관측 범위의 제공 빈도 기준이며 맛·가치를 뜻하지 않아요.'};
}
