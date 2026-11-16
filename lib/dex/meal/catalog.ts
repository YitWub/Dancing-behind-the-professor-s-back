import type { MealDateCoverage } from '../../meal/coverage-types.ts';
import type { CrawlResult, MealItem } from '../../types.ts';
import { isIsoDate, kstToday } from '../../datetime.ts';
import { mealDataNotice, mealReadStatus } from '../../meal/status.ts';
import type { MealDataState } from '../../meal/status.ts';
import type { ResolvedMealSelection } from '../core/types.ts';
import type { Cafeteria, MealOffering, MealTime } from './types.ts';
import { resolveDish, stableHash } from './identity.ts';

export interface MealCatalogQuery {date:string;cafeteria?:Cafeteria;mealTime?:MealTime}
export interface CatalogOffering {offering:MealOffering;selection:ResolvedMealSelection|null;reason:string|null}
export interface MealCatalog {offerings:CatalogOffering[];availableDates:string[];source:string;notice:string;dataState:MealDataState;coverage?:MealDateCoverage}
export const CAFETERIA_NAMES:Record<Cafeteria,string>={haksik:'학생식당',changbo:'창업보육센터식당',dorm:'창의인재원식당',faculty:'교직원식당'};
export const MEAL_TIME_NAMES:Record<MealTime,string>={breakfast:'아침',lunch:'점심',dinner:'저녁'};

function officialSource(source:string) {
  try {return new URL(source).origin==='https://life.hanyang.ac.kr';}catch{return false;}
}
/** API 데이터를 읽기만 하는 순수 어댑터. legacy ID는 보존하되 dish/offering 식별에 순번을 쓰지 않는다. */
export async function adaptMealCatalog(crawl:CrawlResult & {availableDates?:string[];dateCoverage?:MealDateCoverage},query:MealCatalogQuery,now=Date.now()):Promise<MealCatalog> {
  const status=mealReadStatus(crawl,now);
  const seeded=crawl.fallback==='seed'||crawl.source.startsWith('seed:');
  const mocked=crawl.source.startsWith('mock:');
  const real=officialSource(crawl.source)&&!seeded&&!mocked&&(crawl.ok||crawl.fallback==='cache');
  const mode:MealOffering['provenance']['mode']=mocked?'mock':seeded?'seed':crawl.ok?'live':'cache';
  const validTime=Number.isFinite(Date.parse(crawl.fetchedAt));
  const modelTime=validTime?new Date(crawl.fetchedAt).toISOString():'1970-01-01T00:00:00.000Z';
  const today=kstToday(new Date(now));
  const offerings=await Promise.all(crawl.items.filter(item=>item.date===query.date&&(!query.cafeteria||item.cafeteria===query.cafeteria)&&(!query.mealTime||item.mealTime===query.mealTime)).map(async(item):Promise<CatalogOffering>=>{
    const resolved=await resolveDish(item.name,crawl.source);
    const sourceRecordKey=await stableHash(JSON.stringify([crawl.source,item.date,item.cafeteria,item.mealTime,item.name,item.menu,item.price,item.kcal]));
    const offering:MealOffering={id:'offering-v1-'+sourceRecordKey,revision:1,createdAt:modelTime,updatedAt:modelTime,
      sourceRecordKey,legacyMealItemId:item.id,date:item.date,cafeteria:item.cafeteria,mealTime:item.mealTime,
      snapshot:{name:item.name,menu:[...item.menu],price:item.price,kcal:item.kcal,imageUrl:item.imageUrl??null,imageSourceUrl:item.imageSourceUrl??null},
      soldOut:!!item.soldOut,
      resolution:resolved.ok?{state:'resolved',dishId:resolved.dish.id,aliasId:resolved.alias.id,aliasRevision:resolved.alias.revision}:{state:'unresolved',reason:resolved.reason},
      provenance:{source:crawl.source,mode,lastSuccessfulFetchAt:status.lastSuccessfulFetchAt,lastAttemptAt:status.lastAttemptAt},
    };
    const reason=!real?'예시 또는 출처 미확인 데이터는 실제 식사 기록으로 수집할 수 없습니다.':item.date>today?'미래 제공일의 식사는 아직 기록할 수 없습니다.':!resolved.ok?resolved.message:null;
    return {offering,reason,selection:!reason&&resolved.ok&&offering.resolution.state==='resolved'
      ?{dishId:resolved.dish.id,dishName:resolved.dish.canonicalName,offering:{...offering,resolution:offering.resolution}}:null};
  }));
  return {offerings:[...new Map(offerings.map(row=>[row.offering.id,row])).values()],
    coverage:crawl.dateCoverage,availableDates:[...new Set([...(crawl.availableDates??[]),...crawl.items.map(i=>i.date)].filter(isIsoDate))].sort().reverse(),
    source:crawl.source,notice:mealDataNotice(crawl),dataState:status.dataState};
}
function validItem(value:unknown):value is MealItem {
  if(!value||typeof value!=='object')return false;
  const v=value as MealItem;
  return typeof v.id==='string'&&typeof v.date==='string'&&isIsoDate(v.date)&&Object.hasOwn(CAFETERIA_NAMES,v.cafeteria)&&Object.hasOwn(MEAL_TIME_NAMES,v.mealTime)
    &&(v.name===null||typeof v.name==='string')&&Array.isArray(v.menu)&&v.menu.every(s=>typeof s==='string')
    &&(v.price===null||typeof v.price==='number'&&Number.isFinite(v.price)&&v.price>=0)&&(v.kcal===null||typeof v.kcal==='number'&&Number.isFinite(v.kcal)&&v.kcal>=0)
    &&(v.imageUrl==null||typeof v.imageUrl==='string')&&(v.imageSourceUrl==null||typeof v.imageSourceUrl==='string');
}
/** 기존 읽기 전용 status API를 재사용한다. 외부 수집·mock 폴백·개인 저장 없음. */
export async function readOfferings(query:MealCatalogQuery,options:{signal?:AbortSignal;fetcher?:typeof fetch}={}) {
  try {
    if(!isIsoDate(query.date))throw Error('올바른 날짜를 선택해 주세요.');
    const response=await (options.fetcher??fetch)('/api/meals/status?date='+encodeURIComponent(query.date),{cache:'no-store',signal:options.signal});
    if(!response.ok)throw Error('저장된 식단 조회에 실패했습니다.');
    const body:unknown=await response.json();
    if(!body||typeof body!=='object'||!('ok'in body)||body.ok!==true||!('data'in body))throw Error('식단 응답을 확인할 수 없습니다.');
    const crawl=body.data as CrawlResult;
    if(!crawl||typeof crawl.ok!=='boolean'||typeof crawl.source!=='string'||typeof crawl.fetchedAt!=='string'||!Array.isArray(crawl.items)||!crawl.items.every(validItem))throw Error('저장된 식단 형식 확인이 필요합니다.');
    return {ok:true as const,value:await adaptMealCatalog(crawl,query)};
  }catch(error){return {ok:false as const,error:{message:error instanceof Error?error.message:'식단 조회에 실패했습니다. 자동으로 재수집하지 않습니다.'}};}
}

/** Honest empty-state wording over the selected restaurant/meal units. */
export function mealCoverageMessage(coverage:MealDateCoverage|undefined,cafeteria:string,mealTime:string){
  const units=coverage?.units.filter(unit=>(!cafeteria||unit.cafeteria===cafeteria)&&(!mealTime||unit.mealTime===mealTime))??[];
  if(units.length&&units.every(unit=>unit.state==='closed'))return '공식 원문에서 선택한 날짜·끼니의 미운영이 확인됐어요.';
  if(units.some(unit=>unit.lastAttemptStatus==='network-error'||unit.lastAttemptStatus==='parse-error'))return '최근 조회 또는 파싱에 실패했어요. 이전 정상 기록은 보존하며, 메뉴가 없었다는 뜻은 아니에요.';
  if(units.some(unit=>unit.state==='partial'))return '일부 식단만 확인되어 해당 메뉴의 수집을 보류했어요. 미운영으로 집계하지 않아요.';
  if(units.length&&units.every(unit=>unit.state==='not-observed'))return '아직 이 날짜의 식단을 수집하지 않았어요. 날짜 조회만으로 자동 크롤링하지 않아요.';
  return '공식 응답에 해당 식단이 없거나 일부 끼니가 확인되지 않았어요. 미운영일로 단정하지 않아요.';
}
