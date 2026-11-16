import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isIsoDate } from '../datetime.ts';
import type { Cafeteria } from '../types.ts';
import type { HistoricalDay } from './history.ts';
import { atomicJson, jsonFile } from './sync-store.ts';
export interface HistoryDayFile {schemaVersion:1;latest:HistoricalDay;effective:HistoricalDay|null}
export function observationRoot(){return resolve(process.env.MEALS_OBSERVATIONS_DIR||join(process.cwd(),'data','meal-observations'));}
function directory(root:string,cafeteria:Cafeteria,date:string){if(!isIsoDate(date)||!['haksik','faculty','changbo','dorm'].includes(cafeteria))throw Error('잘못된 관측 경로');return join(root,'days',cafeteria,date);}
export function readHistoryDay(root:string,cafeteria:Cafeteria,date:string){return jsonFile<HistoryDayFile>(join(directory(root,cafeteria,date),'current.json'));}
/** Caller holds this observation store's exclusive lock. Raw evidence and attempts are append-only. */
export function saveHistoryDay(root:string,day:HistoricalDay,html?:string){
  const dir=directory(root,day.cafeteria,day.date);mkdirSync(join(dir,'attempts'),{recursive:true});
  if(html&&day.htmlHash){const raw=join(root,'raw',day.htmlHash+'.html');mkdirSync(join(root,'raw'),{recursive:true});if(!existsSync(raw))writeFileSync(raw,html,{flag:'wx'});else if(createHash('sha256').update(readFileSync(raw)).digest('hex')!==day.htmlHash)throw Error('원문 증거 해시 충돌');}
  const id=createHash('sha256').update(JSON.stringify(day)).digest('hex');const attempt=join(dir,'attempts',id+'.json');if(!existsSync(attempt))atomicJson(attempt,day);
  const old=readHistoryDay(root,day.cafeteria,day.date);
  const known=day.status==='complete'||day.status==='closed';const priorKnown=old?.effective?.status==='complete'||old?.effective?.status==='closed';
  let effective=known?day:priorKnown?old!.effective:day.status==='partial'?day:old?.effective??null;
  if(day.status==='partial'&&old?.effective){
    const previous=old.effective;
    effective={...previous,observedAt:day.observedAt,meals:previous.meals.map(unit=>{const next=day.meals.find(meal=>meal.mealTime===unit.mealTime);return next&&(next.state==='complete'||next.state==='closed')?next:{...unit,provenance:unit.provenance??{source:previous.source,observedAt:previous.observedAt,htmlHash:previous.htmlHash??''}};}),reason:'확인된 끼니별 최신 관측을 병합; 누락 단위는 이전 정상 관측 유지'};
  }
  atomicJson(join(dir,'current.json'),{schemaVersion:1,latest:day,effective} satisfies HistoryDayFile);
  const index=jsonFile<{schemaVersion:1;rows:Record<string,{date:string;cafeteria:Cafeteria;menus:number;status:string;observedAt:string}>}>(join(root,'catalog-index.json'))??{schemaVersion:1 as const,rows:{}};
  index.rows[day.cafeteria+'|'+day.date]={date:day.date,cafeteria:day.cafeteria,menus:effective?.meals.filter(meal=>meal.state==='complete').reduce((sum,meal)=>sum+meal.items.length,0)??0,status:day.status,observedAt:day.observedAt};atomicJson(join(root,'catalog-index.json'),index);
}
export function listHistoryDays(root:string,cafeteria:Cafeteria,from:string,through:string):HistoryDayFile[]{
  const base=join(root,'days',cafeteria);if(!existsSync(base))return [];
  return readdirSync(base).filter(date=>isIsoDate(date)&&date>=from&&date<=through).sort().flatMap(date=>{const record=readHistoryDay(root,cafeteria,date);return record?[record]:[];});
}
