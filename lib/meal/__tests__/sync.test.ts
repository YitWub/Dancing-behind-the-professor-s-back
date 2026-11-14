import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MealItem, CrawlResult } from '../../types.ts';
import { mergeMealHistory, synchronizeMeals } from '../sync.ts';
import { acquireMealLock, jsonFile, readMealSnapshot, storedCrawl } from '../sync-store.ts';
import { toMealPhotoDbRecord } from '../store.ts';
import { dueMealSlot, readMealSchedule } from '../schedule.ts';
import { mealReadStatus, mealDataNotice } from '../status.ts';
import { resolveDish } from '../../dex/meal/identity.ts';

const source='https://life.hanyang.ac.kr/theme/pages/home.php';
const old:MealItem={id:'2026-11-04-haksik-lunch',date:'2026-11-04',cafeteria:'haksik',mealTime:'lunch',name:'들기름막국수',menu:['만두'],price:4500,kcal:null,imageUrl:'/meals/old.jpg',imageSourceUrl:'https://life.hanyang.ac.kr/uploads/old.jpg'};
function fixture(){
  const project=mkdtempSync(join(tmpdir(),'bokak-safe-sync-')),root=join(project,'persistent');
  mkdirSync(join(project,'data'));mkdirSync(join(project,'public','meals'),{recursive:true});
  const crawl:CrawlResult={ok:true,source,fetchedAt:'2026-11-04T00:00:00Z',items:[old]};
  writeFileSync(join(project,'data','meals.json'),JSON.stringify(crawl));
  writeFileSync(join(project,'data','meal-photo-db.json'),JSON.stringify({records:[toMealPhotoDbRecord(old)]}));
  writeFileSync(join(project,'public','meals','old.jpg'),'preserve old file');
  const fresh:MealItem={...old,id:'2026-11-14-haksik-lunch',date:'2026-11-14',imageUrl:null,imageSourceUrl:null};
  const options={rootDir:project,storageDir:root,dates:['2026-11-14'],silent:true};
  const cleanup=()=>rmSync(project,{recursive:true,force:true});
  return {project,root,crawl,fresh,options,cleanup};
}
test('정상 수집은 과거 식단·기존 파일·dishId를 유지한 원자 스냅샷으로 게시한다',async()=>{
  const f=fixture();try{
    const before=readFileSync(join(f.project,'data','meals.json'),'utf8');
    const result=await synchronizeMeals(f.options,async()=>({source,items:[f.fresh],cafeterias:[]}));assert.equal(result.ok,true);assert.equal(result.items.length,2);
    assert.equal(readFileSync(join(f.project,'data','meals.json'),'utf8'),before);assert.equal(readFileSync(join(f.project,'public','meals','old.jpg'),'utf8'),'preserve old file');
    const saved=readMealSnapshot(f.root)!;assert.equal(saved.photos[0].photo.imageUrl,old.imageUrl);assert.deepEqual(saved.checkedDates,['2026-11-14']);
    const a=await resolveDish(old.name,source),b=await resolveDish(result.items[0].name,source);assert.ok(a.ok&&b.ok);if(a.ok&&b.ok)assert.equal(a.dish.id,b.dish.id);
  }finally{f.cleanup();}
});
test('네트워크 실패·반복 실패·검증 실패는 정상 포인터와 식단·사진 매핑을 교체하지 않는다',async()=>{
  const f=fixture();try{
    await synchronizeMeals(f.options,async()=>({source,items:[f.fresh],cafeterias:[]}));const pointer=readFileSync(join(f.root,'current.json'),'utf8'),snapshot=readMealSnapshot(f.root);
    for(const harvest of [async()=>{throw Error('network down');},async()=>({source:'seed:fake',items:[f.fresh],cafeterias:[]}),async()=>({source,items:[{...f.fresh,date:'2099-01-01'}],cafeterias:[]})]){
      const result=await synchronizeMeals(f.options,harvest);assert.equal(result.ok,false);assert.equal(readFileSync(join(f.root,'current.json'),'utf8'),pointer);assert.deepEqual(readMealSnapshot(f.root),snapshot);
    }
    const stored=storedCrawl(f.root)!;assert.equal(stored.ok,true);const state=mealReadStatus(stored,Date.now()+1000);assert.equal(state.lastSuccessfulFetchAt,snapshot!.crawl.fetchedAt);assert.ok(state.lastSyncError);assert.match(mealDataNotice(stored),/이전 정상 저장본 유지/);
  }finally{f.cleanup();}
});
test('동일 날짜 재수집 병합은 기존 항목 ID를 지키며 다른 메뉴의 충돌 ID를 분리한다',()=>{
  const updated={...old,id:'changed-order',price:4800,imageUrl:null,imageSourceUrl:null};
  const other={...old,name:'돈가스',menu:['밥'],imageUrl:null,imageSourceUrl:null};
  const merged=mergeMealHistory([old],[updated,other]);assert.equal(merged.length,2);assert.equal(merged.find(i=>i.name===old.name)!.id,old.id);assert.equal(merged.find(i=>i.name===old.name)!.imageUrl,old.imageUrl);assert.equal(merged.find(i=>i.name===old.name)!.price,4800);assert.notEqual(merged.find(i=>i.name==='돈가스')!.id,old.id);
});
test('감소한 같은 날짜의 부분 수집은 게시를 보류한다',async()=>{
  const f=fixture();try{const result=await synchronizeMeals({...f.options,dates:[old.date]},async()=>({source,items:[],cafeterias:[]}));assert.equal(result.ok,false);assert.equal(readMealSnapshot(f.root),null);assert.match(result.error!,/감소/);}finally{f.cleanup();}
});
test('확인된 새 날짜에 메뉴가 없으면 과거 기록을 남기고 오늘 메뉴를 만들지 않는다',async()=>{
  const f=fixture();try{const result=await synchronizeMeals(f.options,async()=>({source,items:[],cafeterias:[]}));assert.equal(result.ok,true);assert.equal(result.items.filter(i=>i.date==='2026-11-14').length,0);assert.equal(result.items[0].date,old.date);}finally{f.cleanup();}
});
test('사진은 내용 해시 경로에 저장하며 재수집·다운로드 실패가 기존 사진을 덮어쓰지 않는다',async()=>{
  const f=fixture();try{
    const photo={...f.fresh,imageSourceUrl:'https://life.hanyang.ac.kr/uploads/new.jpg'};
    const bytes=Buffer.from([255,216,255,1,2,3,255,217]);let calls=0;
    const fetcher=(async()=>{calls++;return new Response(bytes,{headers:{'content-type':'image/jpeg'}});}) as typeof fetch;
    await synchronizeMeals(f.options,async()=>({source,items:[photo],cafeterias:[]}),fetcher);
    const first=readMealSnapshot(f.root)!,url=first.crawl.items.find(i=>i.date===photo.date)!.imageUrl!;assert.match(url,/\/api\/meals\/photos\/[a-f0-9]{64}\.jpg$/);assert.equal(readdirSync(join(f.root,'assets')).length,1);
    await synchronizeMeals(f.options,async()=>({source,items:[photo],cafeterias:[]}),fetcher);assert.equal(calls,1);assert.equal(readdirSync(join(f.root,'assets')).length,1);
    await synchronizeMeals(f.options,async()=>({source,items:[{...photo,imageSourceUrl:'https://life.hanyang.ac.kr/uploads/changed.jpg'}],cafeterias:[]}),async()=>new Response('<html>403</html>',{status:403}));
    const last=readMealSnapshot(f.root)!;assert.equal(last.crawl.items.find(i=>i.date===photo.date)!.imageUrl,url);assert.equal(last.photos.find(p=>p.date===photo.date)!.photo.imageUrl,url);assert.equal(last.photos.find(p=>p.date===old.date)!.photo.imageUrl,old.imageUrl);
  }finally{f.cleanup();}
});
test('동시 실행은 첫 작업만 수집하고 잠금 해제 후 다음 수집을 허용한다',async()=>{
  const f=fixture();try{
    let finish!:()=>void;const wait=new Promise<void>(resolve=>{finish=resolve;});let calls=0;
    const first=synchronizeMeals(f.options,async()=>{calls++;await wait;return {source,items:[f.fresh],cafeterias:[]};});
    const second=await synchronizeMeals(f.options,async()=>{calls++;return {source,items:[f.fresh],cafeterias:[]};});assert.equal(second.ok,false);assert.match(second.error!,/다른 수집/);finish();assert.equal((await first).ok,true);assert.equal(calls,1);
    const release=acquireMealLock(f.root);assert.ok(release);release!();
  }finally{f.cleanup();}
});
test('스케줄 슬롯은 성공·실패 모두 같은 슬롯을 다시 수집하지 않는다',async()=>{
  const f=fixture();try{let calls=0;const opts={...f.options,scheduledSlot:'2026-11-14T07:00+09:00'};const harvest=async()=>{calls++;return {source,items:[f.fresh],cafeterias:[]};};await synchronizeMeals(opts,harvest);await synchronizeMeals(opts,harvest);assert.equal(calls,1);
    const failed={...opts,scheduledSlot:'2026-11-14T11:00+09:00'};const fail=async()=>{calls++;throw Error('failure');};await synchronizeMeals(failed,fail);await synchronizeMeals(failed,fail);assert.equal(calls,2);
  }finally{f.cleanup();}
});
test('임시 출력은 영구 저장소·사진·실패 상태를 생성하거나 변경하지 않는다',async()=>{
  const f=fixture();try{const out=join(f.project,'preview.json');const result=await synchronizeMeals({...f.options,outPath:out},async()=>({source,items:[f.fresh],cafeterias:[]}));assert.equal(result.ok,true);assert.ok(jsonFile(out));assert.equal(readMealSnapshot(f.root),null);assert.equal(readdirSync(f.project).includes('persistent'),false);}finally{f.cleanup();}
});
test('KST 오전7시·11시, 자정·재시작 지연 슬롯과 설정 변경을 처리한다',()=>{
  assert.equal(dueMealSlot(new Date('2026-11-13T21:59:00Z'),['07:00','11:00']),null);
  assert.equal(dueMealSlot(new Date('2026-11-13T22:00:00Z'),['07:00','11:00']),'2026-11-14T07:00+09:00');
  assert.equal(dueMealSlot(new Date('2026-11-14T02:00:00Z'),['07:00','11:00']),'2026-11-14T11:00+09:00');
  assert.equal(dueMealSlot(new Date('2026-11-14T15:00:00Z'),['07:00','11:00']),null);
  const f=fixture();try{const path=join(f.project,'schedule.json');writeFileSync(path,JSON.stringify({timeZone:'Asia/Seoul',times:['07:00','11:00'],pollSeconds:30}));assert.deepEqual(readMealSchedule(path,'08:00,12:30').times,['08:00','12:30']);assert.throws(()=>readMealSchedule(path,'25:00'));}finally{f.cleanup();}
});
test('운영 스냅샷의 GET·사진 GET·서버 시작은 네트워크와 파일 쓰기를 하지 않는다',async()=>{
  const f=fixture();try{
    await synchronizeMeals(f.options,async()=>({source,items:[f.fresh],cafeterias:[]}));
    const photoBytes=Buffer.from([255,216,255,1,2,3,255,217]);const photoName=createHash('sha256').update(photoBytes).digest('hex')+'.jpg';writeFileSync(join(f.root,'assets',photoName),photoBytes);
    const script=`
      import {strict as assert} from 'node:assert';import{readdirSync,readFileSync}from'node:fs';import{join}from'node:path';import{createHash}from'node:crypto';
      const scan=(dir)=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?scan(join(dir,e.name)):[[join(dir,e.name),createHash('sha256').update(readFileSync(join(dir,e.name))).digest('hex')]]).sort();
      const before=scan(process.cwd());let fetches=0;globalThis.fetch=async()=>{fetches++;throw Error('forbidden');};
      const {register}=await import(${JSON.stringify(new URL('../../../instrumentation.ts',import.meta.url).href)});await register();
      const {GET}=await import(${JSON.stringify(new URL('../../../app/api/meals/status/route.ts',import.meta.url).href)});const response=await GET();assert.equal(response.status,200);assert.equal((await response.json()).data.items.length,2);
      const photo=await import(${JSON.stringify(new URL('../../../app/api/meals/photos/[name]/route.ts',import.meta.url).href)});assert.equal((await photo.GET(new Request('http://test'),{params:Promise.resolve({name:'../private'})})).status,404);
      const image=await photo.GET(new Request('http://test'),{params:Promise.resolve({name:${JSON.stringify(photoName)}})});assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/jpeg');assert.equal((await image.arrayBuffer()).byteLength,8);
      assert.equal(fetches,0);assert.deepEqual(scan(process.cwd()),before);
    `;
    const result=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',script],{cwd:f.project,env:{...process.env,MEALS_STORAGE_DIR:f.root},encoding:'utf8',timeout:30000});assert.equal(result.status,0,result.stdout+result.stderr);
  }finally{f.cleanup();}
});
