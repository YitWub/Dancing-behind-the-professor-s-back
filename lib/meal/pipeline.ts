import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Cafeteria, MealItem } from '../types.ts';
import { isIsoDate, kstToday } from '../datetime.ts';
import { DEFAULT_FACILITY_IDS, parseDetailPhp, HOME_URL } from './crawler.ts';
import { parseHistoricalDay, failedHistoryDay, historySource } from './history.ts';
import { readHistoryDay, saveHistoryDay, observationRoot } from './history-store.ts';
import { acquireMealLock, atomicJson, mealStorageRoot } from './sync-store.ts';
import { synchronizeMeals } from './sync.ts';
import { OBSERVATION_USER_AGENT, robotsAllows } from './history-policy.ts';
import type { ConfirmedMealUnit } from './sync.ts';

export interface PipelineOptions {rootDir:string;baseDate?:string;dates?:string[];extraDates?:string[];cafeterias?:Cafeteria[];lookbackDays?:number;maxRequests?:number;intervalMs?:number;force?:boolean;scheduledSlot?:string;observationsDir?:string;storageDir?:string;now?:Date;fetcher?:typeof fetch;pause?:(ms:number)=>Promise<void>;silent?:boolean}
export function shiftMealDate(date:string,days:number){const value=new Date(date+'T00:00:00Z');value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10);}
export function reusableObservation(record:ReturnType<typeof readHistoryDay>,date:string,today:string,now:number){
  const day=record?.effective;if(!day)return false;
  const useful=day.status==='complete'||day.status==='closed'||(day.meals.some(meal=>meal.state==='complete')&&!day.meals.some(meal=>meal.state==='partial'||meal.state==='failed'));
  if(!useful)return false;
  if(date<today)return kstToday(new Date(day.observedAt))>=date;
  return now-Date.parse(day.observedAt)<(date===today?15*60000:6*3600000);
}
/** Bounded public-page observation + existing locked/staged snapshot publication. No GET imports this runner. */
export async function runMealDataPipeline(options:PipelineOptions){
  const now=options.now??new Date(),today=kstToday(now),base=options.baseDate??today;
  const maximum=options.maxRequests??24,interval=options.intervalMs??1800,lookback=options.lookbackDays??2;
  if(!isIsoDate(base)||[...(options.dates??[]),...(options.extraDates??[])].some(date=>!isIsoDate(date))||!Number.isInteger(maximum)||maximum<1||maximum>100||!Number.isInteger(interval)||interval<1500||!Number.isInteger(lookback)||lookback<0||lookback>7)throw Error('날짜·요청 상한(1~100)·간격(최소 1500ms)·보충 범위(0~7일)를 확인하세요.');
  const facilities=DEFAULT_FACILITY_IDS.filter(fac=>!options.cafeterias||options.cafeterias.includes(fac.cafeteria));if(!facilities.length)throw Error('수집할 식당이 없습니다.');
  const root=options.observationsDir??observationRoot();if(resolve(root)===resolve(options.storageDir??mealStorageRoot(options.rootDir)))throw Error('관측 저장소와 스냅샷 저장소는 분리해야 합니다.');const release=acquireMealLock(root);if(!release)throw Error('다른 관측 수집이 진행 중입니다.');
  const fetcher=options.fetcher??fetch,pause=options.pause??(ms=>delay(ms));let requests=0,stop=false,policy='',robotsStatus=0;
  const attempted:{date:string;cafeteria:Cafeteria;status:string;menus:number}[]=[],skipped:{date:string;cafeteria:Cafeteria}[]=[],issues:string[]=[],queue:{date:string;facility:typeof facilities[number]}[]=[],queued=new Set<string>();
  const enqueue=(date:string,facility:typeof facilities[number])=>{const key=date+'|'+facility.id;if(!queued.has(key)){queued.add(key);queue.push({date,facility});}};
  for(const facility of facilities)enqueue(base,facility);
  for(const date of options.extraDates??[])for(const facility of facilities)enqueue(date,facility);
  if(options.dates){for(const date of options.dates)for(const facility of facilities)enqueue(date,facility);}
  else{for(const facility of facilities)enqueue(shiftMealDate(base,1),facility);for(let ago=1;ago<=lookback;ago++)for(const facility of facilities)enqueue(shiftMealDate(base,-ago),facility);}
  const runId=now.toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID();
  try{
    return await synchronizeMeals({rootDir:options.rootDir,storageDir:options.storageDir,dates:[base],scheduledSlot:options.scheduledSlot,silent:options.silent,downloadPhotos:false},async()=>{
      const response=await fetcher('https://life.hanyang.ac.kr/robots.txt',{headers:{'User-Agent':OBSERVATION_USER_AGENT},redirect:'error',signal:AbortSignal.timeout(15000)});requests++;robotsStatus=response.status;policy=await response.text();
      if(response.status!==404&&(!response.ok||/^\s*<!doctype html/i.test(policy)))throw Error('robots 정책을 확인할 수 없어 중단합니다.');
      atomicJson(join(root,'policy',runId+'.json'),{url:'https://life.hanyang.ac.kr/robots.txt',status:robotsStatus,checkedAt:now.toISOString(),note:robotsStatus===404?'robots 파일 없음; 재배포 허가를 의미하지 않음':'공개 경로 규칙 검증'});
      const items:MealItem[]=[],confirmedUnits:ConfirmedMealUnit[]=[];const dates=new Set<string>();
      for(let index=0;index<queue.length&&!stop;index++){
        const {date,facility}=queue[index],prior=readHistoryDay(root,facility.cafeteria,date);
        if(!options.force&&reusableObservation(prior,date,today,now.getTime())){
          if(!options.dates&&date===base){let published=prior?.effective?.publishedDates;const hash=prior?.effective?.htmlHash;if(!published&&hash&&/^[a-f0-9]{64}$/.test(hash)){const file=join(root,'raw',hash+'.html');if(existsSync(file)){const bytes=readFileSync(file);if(createHash('sha256').update(bytes).digest('hex')!==hash)throw Error('보관 원문 무결성 실패');published=parseDetailPhp(bytes.toString('utf8'),date,facility.id,facility.cafeteria).weeklyItems.map(item=>item.date);}}
            for(const day of new Set(published??[]))if(day>=base&&day<=shiftMealDate(base,6))enqueue(day,facility);
          }
          skipped.push({date,cafeteria:facility.cafeteria});continue;
        }
        if(requests>=maximum)break;
        const source=historySource(date,facility.id);if(robotsStatus!==404&&!robotsAllows(policy,new URL(source).pathname+new URL(source).search))throw Error('robots 정책이 요청을 금지합니다.');
        await pause(interval);requests++;const observedAt=(options.now??new Date()).toISOString();let status:number|null=null,html:string|undefined;
        try{
          const result=await fetcher(source,{headers:{'User-Agent':OBSERVATION_USER_AGENT},redirect:'error',signal:AbortSignal.timeout(15000)});status=result.status;if([401,403,429].includes(status))stop=true;if(!result.ok)throw Error('HTTP '+status);html=await result.text();if(html.length>2000000)throw Error('응답 크기 초과');
          const day=await parseHistoricalDay(html,date,facility.cafeteria,facility.id,observedAt);saveHistoryDay(root,day,html);
          const parsed=parseDetailPhp(html,date,facility.id,facility.cafeteria);const accepted=day.meals.filter(meal=>meal.state==='complete'||meal.state==='closed');
          for(const meal of accepted){confirmedUnits.push({date,cafeteria:facility.cafeteria,mealTime:meal.mealTime,closed:meal.state==='closed'});items.push(...parsed.items.filter(item=>item.mealTime===meal.mealTime&&meal.state==='complete'));dates.add(date);}
          attempted.push({date,cafeteria:facility.cafeteria,status:day.status,menus:day.meals.reduce((sum,meal)=>sum+meal.items.length,0)});
          if(day.status==='parse-error'||day.status==='empty-unknown')issues.push(date+' '+facility.cafeteria+': '+day.status);
          if(!options.dates&&date===base&&day.status!=='parse-error')for(const published of [...new Set(parsed.weeklyItems.map(item=>item.date))].sort())if(published>=base&&published<=shiftMealDate(base,6))enqueue(published,facility);
        }catch(error){const reason=error instanceof Error?error.message:'네트워크 오류';const failed=failedHistoryDay(date,facility.cafeteria,source,observedAt,'network-error',reason,status);saveHistoryDay(root,failed);attempted.push({date,cafeteria:facility.cafeteria,status:'network-error',menus:0});issues.push(date+' '+facility.cafeteria+': '+reason);}
      }
      if(!confirmedUnits.length){if(attempted.length)throw Error('정상 관측된 메뉴·명시적 휴무가 없어 이전 저장본 유지: '+issues.join('; '));return {source:HOME_URL,items:[],cafeterias:[],confirmedUnits:[],issues:[]};}
      return {source:HOME_URL,items,cafeterias:[],confirmedUnits,issues,observedDates:[...dates]};
    });
  }finally{
    try{atomicJson(join(root,'runs',runId+'.json'),{schemaVersion:1,at:now.toISOString(),requests,maximum,interval,attempted,skipped,issues,stopped:stop,pending:queue.filter(task=>!attempted.some(row=>row.date===task.date&&row.cafeteria===task.facility.cafeteria)&&!skipped.some(row=>row.date===task.date&&row.cafeteria===task.facility.cafeteria)).map(task=>({date:task.date,cafeteria:task.facility.cafeteria}))});}finally{release();}
  }
}
