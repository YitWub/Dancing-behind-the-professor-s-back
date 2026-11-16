import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { isIsoDate } from '../datetime.ts';
import type { CrawlResult, Cafeteria, MealTime } from '../types.ts';
import { observationRoot, readHistoryDay } from './history-store.ts';
import { jsonFile } from './sync-store.ts';
import type { MealDateCoverage } from './coverage-types.ts';
const CAFETERIAS:Cafeteria[]=['haksik','faculty','changbo','dorm'];const TIMES:MealTime[]=['breakfast','lunch','dinner'];
export function availableMealDates(base:CrawlResult,root=observationRoot()){
  const dates=new Set(base.items.map(item=>item.date).filter(isIsoDate));
  const index=jsonFile<{schemaVersion:1;rows:Record<string,{date:string;menus:number}>}>(join(root,'catalog-index.json'));
  if(index?.schemaVersion===1){for(const row of Object.values(index.rows))if(row.menus>0&&isIsoDate(row.date))dates.add(row.date);}
  else for(const cafeteria of CAFETERIAS){const dir=join(root,'days',cafeteria);if(existsSync(dir))for(const date of readdirSync(dir).filter(isIsoDate)){const day=readHistoryDay(root,cafeteria,date)?.effective;if(day?.meals.some(meal=>meal.state==='complete'&&meal.items.length))dates.add(date);}}
  return [...dates].sort().reverse();
}
export function readMealCoverage(base:CrawlResult,date:string,root=observationRoot()):MealDateCoverage{
  return {date,units:CAFETERIAS.flatMap(cafeteria=>{const record=readHistoryDay(root,cafeteria,date);return TIMES.map(mealTime=>{
    const unit=(record?.effective??record?.latest)?.meals.find(meal=>meal.mealTime===mealTime),menus=base.items.filter(row=>row.date===date&&row.cafeteria===cafeteria&&row.mealTime===mealTime).length;
    return {cafeteria,mealTime,state:unit?.state==='failed'?'failed' as const:unit?.state??(menus?'stored' as const:'not-observed' as const),menus,observedAt:unit?.provenance?.observedAt??record?.effective?.observedAt??null,lastAttemptAt:record?.latest.observedAt??null,lastAttemptStatus:record?.latest.status??null,source:unit?.provenance?.source??record?.effective?.source??null};
  });})};
}
