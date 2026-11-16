/** Explicit bounded backfill, using the same safe publisher and observation archive. */
import { dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calendarDates } from '../lib/meal/history-statistics.ts';
import { runMealDataPipeline } from '../lib/meal/pipeline.ts';
import { loadMealEnvironment } from '../lib/meal/runtime.ts';
import { kstToday } from '../lib/datetime.ts';
import { DEFAULT_FACILITY_IDS } from '../lib/meal/crawler.ts';
import type { Cafeteria } from '../lib/types.ts';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');loadMealEnvironment(root);
const args=process.argv.slice(2),arg=(name:string,fallback:string)=>args.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3)??fallback;
async function main(){const dates=calendarDates(arg('from',kstToday()),arg('through',kstToday()));if(dates.at(-1)!>kstToday())throw Error('과거 관측 명령에서 미래 날짜는 허용하지 않습니다.');const cafeterias=arg('cafeterias','haksik').split(',') as Cafeteria[];if(cafeterias.some(value=>!DEFAULT_FACILITY_IDS.some(fac=>fac.cafeteria===value)))throw Error('지원하지 않는 식당');const result=await runMealDataPipeline({rootDir:root,baseDate:dates[0],dates,cafeterias,observationsDir:args.some(a=>a.startsWith('--root='))?resolve(arg('root','')):undefined,maxRequests:Number(arg('max-requests','80')),intervalMs:Number(arg('interval-ms','1800')),force:args.includes('--force')});console.log(JSON.stringify({ok:result.ok,items:result.items.length,error:result.error??null}));if(!result.ok)process.exitCode=1;}
main().catch(error=>{console.error(error instanceof Error?error.message:'소급 관측 실패');process.exitCode=1;});
