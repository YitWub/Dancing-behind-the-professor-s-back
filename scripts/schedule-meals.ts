/** Separate worker. Never imported by Next instrumentation, build or a GET route. */
import { setTimeout as delay } from 'node:timers/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMealCrawler } from '../lib/meal/crawler.ts';
import { dueMealSlot, readMealSchedule } from '../lib/meal/schedule.ts';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
async function main(){
  const config=readMealSchedule(process.env.MEALS_SYNC_CONFIG??join(root,'config','meal-sync.json'));
  if(process.argv.includes('--check')){console.log({schedule:config,workerRunning:false,persistentDirectoryConfigured:!!process.env.MEALS_STORAGE_DIR});return;}
  if(!process.env.MEALS_STORAGE_DIR)throw Error('자동 작업자에는 MEALS_STORAGE_DIR 영구 볼륨 경로가 필요합니다. Next 서버에도 같은 값을 설정하세요.');
  if(process.env.VERCEL||process.env.AWS_LAMBDA_FUNCTION_NAME)throw Error('이 작업자는 상시 Node 서버와 영구 파일 볼륨용입니다. 서버리스 스케줄러·객체 저장소 어댑터는 별도 연결해야 합니다.');
  console.log(`별도 식단 작업자 시작: ${config.timeZone} ${config.times.join(', ')} (중단 중에는 자동 실행되지 않음)`);
  const stop=new AbortController();let lastSlot:string|null=null;
  const shutdown=()=>stop.abort();process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
  try{
    do{
      const slot=dueMealSlot(new Date(),config.times);
      if(slot&&slot!==lastSlot){
        const result=await runMealCrawler({rootDir:root,scheduledSlot:slot});
        if(!result.error?.startsWith('다른 수집이 진행 중'))lastSlot=slot;
        if(!result.ok)console.error('스케줄 수집 실패. 마지막 정상 데이터 유지:',result.error);
        if(process.argv.includes('--once')){process.exitCode=result.ok?0:1;return;}
      }
      if(process.argv.includes('--once')){console.log('아직 도래한 수집 시각이 없습니다.');return;}
      try{await delay(config.pollSeconds*1000,undefined,{signal:stop.signal});}catch(error){if(!stop.signal.aborted)throw error;}
    }while(!stop.signal.aborted);
  }finally{process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'작업자 실행 실패');process.exitCode=1;});
