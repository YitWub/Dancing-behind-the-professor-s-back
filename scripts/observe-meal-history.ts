/** Explicit, bounded backfill only. Never imported by Next GET/build or the daily worker. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { parseHistoricalDay, failedHistoryDay, historySource } from '../lib/meal/history.ts';
import { observationRoot, readHistoryDay, saveHistoryDay } from '../lib/meal/history-store.ts';
import { acquireMealLock, atomicJson, mealStorageRoot } from '../lib/meal/sync-store.ts';
import { calendarDates } from '../lib/meal/history-statistics.ts';
import { OBSERVATION_USER_AGENT, robotsAllows } from '../lib/meal/history-policy.ts';
import { kstToday } from '../lib/datetime.ts';

const args=process.argv.slice(2),arg=(name:string,fallback:string)=>args.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3)??fallback;
async function main(){
  const dates=calendarDates(arg('from','2026-09-01'),arg('through','2026-11-14'));
  if(dates.at(-1)!>kstToday())throw Error('미래 날짜를 소급 관측할 수 없습니다.');
  const maximum=Number(arg('max-requests','80')),interval=Number(arg('interval-ms','1800'));
  if(!Number.isInteger(maximum)||maximum<1||maximum>100||!Number.isInteger(interval)||interval<1500)throw Error('요청은 실행당 1~100회, 간격은 최소 1500ms로 제한합니다.');
  if(process.env.VERCEL||process.env.AWS_LAMBDA_FUNCTION_NAME)throw Error('이 파일 저장 어댑터는 영구 볼륨의 Node 환경에서만 실행하세요.');
  const root=resolve(arg('root',observationRoot()));if(root===mealStorageRoot()||root.startsWith(mealStorageRoot()+sep))throw Error('최신 식단 저장소와 별도의 관측 경로를 사용하세요.');const release=acquireMealLock(root);if(!release)throw Error('다른 소급 관측이 진행 중입니다.');
  const startedAt=new Date().toISOString(),runId=randomUUID();let requests=0;const attempts:{date:string;status:string}[]=[];
  try{
    const response=await fetch('https://life.hanyang.ac.kr/robots.txt',{headers:{'User-Agent':OBSERVATION_USER_AGENT},signal:AbortSignal.timeout(15000),redirect:'error'});requests++;
    const robots=await response.text();
    if(response.status!==404&&(!response.ok||/^\s*<!doctype html/i.test(robots)))throw Error('robots 정책을 확인할 수 없어 수집을 중단합니다.');
    if(response.ok&&!robotsAllows(robots,new URL(historySource(dates[0])).pathname+new URL(historySource(dates[0])).search))throw Error('robots 정책이 해당 경로 수집을 금지합니다.');
    mkdirSync(join(root,'policy'),{recursive:true});writeFileSync(join(root,'policy',runId+'.txt'),robots);
    atomicJson(join(root,'policy',runId+'.json'),{url:'https://life.hanyang.ac.kr/robots.txt',status:response.status,checkedAt:new Date().toISOString(),interpretation:response.status===404?'robots 파일 없음; 재배포 허가를 의미하지 않음':'해당 공개 메뉴 경로 금지 규칙 없음',userAgent:OBSERVATION_USER_AGENT});
    for(const date of dates){
      const previous=readHistoryDay(root,'haksik',date);
      if(!args.includes('--force')&&(previous?.effective?.status==='complete'||previous?.effective?.status==='closed'))continue;
      if(requests>=maximum){console.log('실행당 요청 상한에 도달했습니다. 다음 실행에서 남은 날짜를 이어갈 수 있습니다.');break;}
      await wait(interval);const source=historySource(date);requests++;const observedAt=new Date().toISOString();
      if(response.ok&&!robotsAllows(robots,new URL(source).pathname+new URL(source).search))throw Error(`${date} 경로가 robots 정책에 의해 차단되어 중단합니다.`);
      let statusCode:number|null=null;let stop=false;let parsedResponse=false;
      try{
        const page=await fetch(source,{headers:{'User-Agent':OBSERVATION_USER_AGENT},signal:AbortSignal.timeout(15000),redirect:'error'});statusCode=page.status;
        if(!page.ok){if([401,403,429].includes(page.status))stop=true;throw Error(`HTTP ${page.status}`);}
        const html=await page.text();if(html.length>2_000_000)throw Error('페이지 크기 제한 초과');
        parsedResponse=true;
        const day=await parseHistoricalDay(html,date,'haksik',1,observedAt);saveHistoryDay(root,day,html);attempts.push({date,status:day.status});console.log(`${date} ${day.status} ${day.meals.reduce((sum,meal)=>sum+meal.items.length,0)}개`);
      }catch(error){const message=error instanceof Error?error.message:'network error';const status=parsedResponse?'parse-error':'network-error';const day=failedHistoryDay(date,'haksik',source,observedAt,status,message,statusCode);saveHistoryDay(root,day);attempts.push({date,status:day.status});console.log(`${date} ${status}: ${message}`);}
      if(stop){console.log('접근 제한/요청 제한 응답으로 이후 요청을 중단합니다. 우회·자동 재시도하지 않습니다.');break;}
    }
  }finally{try{atomicJson(join(root,'runs',runId+'.json'),{startedAt,finishedAt:new Date().toISOString(),from:dates[0],through:dates.at(-1),cafeteria:'haksik',requests,maximum,interval,attempts});}finally{release();}}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'소급 수집 실패');process.exitCode=1;});
