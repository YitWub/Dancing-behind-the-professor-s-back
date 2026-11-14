import { createHash, randomUUID } from 'node:crypto';
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, basename, resolve, sep } from 'node:path';
import type { CafeteriaInfo, CrawlResult, MealItem } from '../types.ts';
import { isIsoDate } from '../datetime.ts';
import { toMealPhotoDbRecord } from './store.ts';
import type { MealPhotoDbRecord } from './store.ts';
import { acquireMealLock, atomicJson, jsonFile, mealAssetPath, mealStorageRoot, publishMealSnapshot, readMealSnapshot } from './sync-store.ts';
import type { MealSnapshot } from './sync-store.ts';

const SOURCE='https://life.hanyang.ac.kr/theme/pages/home.php';
export interface SyncOptions {rootDir:string;dates:string[];outPath?:string;storageDir?:string;scheduledSlot?:string;offline?:boolean;silent?:boolean}
export interface Harvest {items:MealItem[];cafeterias:CafeteriaInfo[];source:string}
function offeringKey(item:MealItem){return JSON.stringify([item.date,item.cafeteria,item.mealTime,item.name]);}
export function mergeMealHistory(previous:MealItem[],incoming:MealItem[]){
  const merged=new Map(previous.map(item=>[offeringKey(item),structuredClone(item)]));
  const used=new Set(previous.map(item=>item.id));
  for(const row of incoming){
    const item=structuredClone(row),key=offeringKey(item),old=merged.get(key);
    if(old){
      item.id=old.id;
      // Only a matching offering with matching composition can inherit a missing image.
      if(!item.imageSourceUrl&&JSON.stringify(old.menu)===JSON.stringify(item.menu)){item.imageUrl=old.imageUrl;item.imageSourceUrl=old.imageSourceUrl;}
    }else if(used.has(item.id))item.id+='-'+createHash('sha256').update(key).digest('hex').slice(0,16);
    used.add(item.id);merged.set(key,item);
  }
  return [...merged.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
}
function validateHarvest(value:Harvest,dates:string[]){
  if(value.source!==SOURCE||!Array.isArray(value.items))throw Error('공식 식단 수집 결과가 아닙니다.');
  for(const item of value.items){
    if(!dates.includes(item.date)||!isIsoDate(item.date)||!['haksik','faculty','changbo','dorm'].includes(item.cafeteria)||!['breakfast','lunch','dinner'].includes(item.mealTime)||!item.name?.trim()||!item.menu?.length||item.menu.some(s=>typeof s!=='string')||(item.price!==null&&(!Number.isFinite(item.price)||item.price<0)))throw Error('수집 날짜·메뉴·가격 검증 실패');
    if(item.imageSourceUrl){const url=new URL(item.imageSourceUrl);if(url.origin!=='https://life.hanyang.ac.kr'||!url.pathname.startsWith('/uploads/'))throw Error('공식 제공 식단 사진 경로가 아닙니다.');}
  }
}
function imageExtension(bytes:Buffer,mime:string){
  if(mime==='image/jpeg'&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'jpg';
  if(mime==='image/png'&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'png';
  if(mime==='image/webp'&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return 'webp';
  if(mime==='image/gif'&&/^GIF8[79]a/.test(bytes.toString('ascii',0,6)))return 'gif';
  return null;
}
async function preparePhoto(item:MealItem,old:MealItem|undefined,options:SyncOptions,root:string,staging:string,fetcher:typeof fetch){
  if(!item.imageSourceUrl)return;
  if(old?.imageSourceUrl===item.imageSourceUrl&&JSON.stringify(old.menu)===JSON.stringify(item.menu)&&old.imageUrl){
    const local=old.imageUrl.startsWith('/api/meals/photos/')?mealAssetPath(root,basename(old.imageUrl)):old.imageUrl.startsWith('/meals/')?join(options.rootDir,'public','meals',basename(old.imageUrl)):null;
    if(local&&existsSync(local)&&readFileSync(local).length){item.imageUrl=old.imageUrl;return;}
  }
  try{
    const response=await fetcher(item.imageSourceUrl,{signal:AbortSignal.timeout(12000),redirect:'error'});
    if(!response.ok)throw Error(`HTTP ${response.status}`);
    const maximum=8*1024*1024;
    if(Number(response.headers.get('content-length'))>maximum)throw Error('사진이 너무 큽니다.');
    const reader=response.body?.getReader();if(!reader)throw Error('빈 사진 응답');
    const chunks:Uint8Array[]=[];let size=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maximum)throw Error('사진이 너무 큽니다.');chunks.push(value);}}finally{await reader.cancel();}
    const bytes=Buffer.concat(chunks),mime=(response.headers.get('content-type')??'').split(';')[0].trim();
    const extension=imageExtension(bytes,mime);if(!extension)throw Error('실제 이미지 형식을 확인할 수 없습니다.');
    const name=createHash('sha256').update(bytes).digest('hex')+'.'+extension;
    writeFileSync(join(staging,name),bytes);
    item.imageUrl='/api/meals/photos/'+name;
  }catch{
    // Do not borrow a different meal's tray. UI retains its image failure fallback.
    if(old?.imageUrl&&JSON.stringify(old.menu)===JSON.stringify(item.menu)){item.imageUrl=old.imageUrl;item.imageSourceUrl=old.imageSourceUrl;}
    else item.imageUrl=item.imageSourceUrl;
    if(!options.silent)console.warn(`사진 로컬 저장 보류: ${item.date} ${item.cafeteria} ${item.name}`);
  }
}
export async function synchronizeMeals(options:SyncOptions,harvest:()=>Promise<Harvest>,fetcher:typeof fetch=fetch):Promise<CrawlResult>{
  const root=options.storageDir??mealStorageRoot(options.rootDir);
  const preview=!!options.outPath;
  if(options.outPath){const output=resolve(options.outPath);if(output.startsWith(root+sep)||['meals.json','meal-photo-db.json'].some(name=>output===join(options.rootDir,'data',name)))throw Error('--out은 운영 저장소·기존 식단과 다른 임시 경로를 사용하세요.');}
  if(options.dates.some(date=>!isIsoDate(date)))throw Error('잘못된 수집 날짜');
  if(!preview&&(process.env.VERCEL||process.env.AWS_LAMBDA_FUNCTION_NAME))throw Error('현재 파일 저장 어댑터는 비영구 서버리스 실행을 지원하지 않습니다. 영구 저장소를 먼저 연결하세요.');
  const release=preview?()=>{}:acquireMealLock(root);
  if(!release)return {ok:false,source:SOURCE,fetchedAt:new Date().toISOString(),items:[],error:'다른 수집이 진행 중입니다. 기존 데이터를 유지합니다.'};
  let staging:string|null=null;
  try{
    const active=readMealSnapshot(root);
    const legacy=jsonFile<CrawlResult>(join(options.rootDir,'data','meals.json'));
    const previous=active?.crawl??(legacy?.ok&&legacy.source===SOURCE?legacy:null);
    const photos=active?.photos??jsonFile<{records:MealPhotoDbRecord[]}>(join(options.rootDir,'data','meal-photo-db.json'))?.records??[];
    if(options.scheduledSlot&&active?.scheduledSlots.includes(options.scheduledSlot))return previous!;
    const attempt=jsonFile<{scheduledSlot?:string;ok:boolean;error?:string}>(join(root,'last-attempt.json'));
    if(options.scheduledSlot&&attempt?.scheduledSlot===options.scheduledSlot&&!attempt.ok)return {...(previous??{source:SOURCE,fetchedAt:'',items:[]}),ok:false,error:attempt.error};
    let candidate:CrawlResult;
    try{
      if(options.offline)throw Error('--offline: 네트워크 요청 생략');
      const fresh=await harvest();validateHarvest(fresh,options.dates);
      // A partly missing historical response is not a replacement for the full successful date.
      for(const date of options.dates){const before=previous?.items.filter(i=>i.date===date).length??0;if(before>fresh.items.filter(i=>i.date===date).length)throw Error(`${date} 식단 수가 감소하여 게시 보류`);}
      if(!preview){
        staging=join(root,'staging',randomUUID());mkdirSync(staging,{recursive:true});
        const oldByKey=new Map(previous?.items.map(i=>[offeringKey(i),i]));
        // Bound image requests; no unbounded downloads across menus.
        for(let start=0;start<fresh.items.length;start+=4)await Promise.all(fresh.items.slice(start,start+4).map(item=>preparePhoto(item,oldByKey.get(offeringKey(item)),options,root,staging!,fetcher)));
      }
      candidate={ok:true,fetchedAt:new Date().toISOString(),source:SOURCE,items:mergeMealHistory(previous?.items??[],fresh.items),cafeterias:fresh.cafeterias};
      if(preview){atomicJson(options.outPath!,candidate);return candidate;}
      const photoMap=new Map(photos.map(record=>[record.mealItemId,record]));
      const incomingKeys=new Set(fresh.items.map(offeringKey));
      for(const item of candidate.items){
        if(!incomingKeys.has(offeringKey(item)))continue;
        const existing=photoMap.get(item.id);
        if(existing?.name===item.name&&existing.photo.imageUrl===item.imageUrl&&existing.photo.imageSourceUrl===item.imageSourceUrl)continue;
        const name=item.imageUrl?.startsWith('/api/meals/photos/')?basename(item.imageUrl):null;
        const local=name?(existsSync(join(staging!,name))?join(staging!,name):mealAssetPath(root,name)):null;
        const extension=name?.split('.').at(-1);
        const record=toMealPhotoDbRecord(item,{syncedAt:candidate.fetchedAt,...(extension?{mimeType:extension==='jpg'?'image/jpeg':`image/${extension}`} :{}),...(local?{sizeBytes:readFileSync(local).length}:{})});
        if(record)photoMap.set(item.id,record);
      }
      const snapshot:MealSnapshot={schemaVersion:1,crawl:candidate,photos:[...photoMap.values()],checkedDates:options.dates,scheduledSlots:[...(active?.scheduledSlots??[]),...(options.scheduledSlot?[options.scheduledSlot]:[])].slice(-128)};
      mkdirSync(join(root,'assets'),{recursive:true});
      const {readdirSync}=await import('node:fs');
      for(const name of readdirSync(staging!)){
        const from=join(staging!,name),to=mealAssetPath(root,name);
        if(existsSync(to)){if(!readFileSync(from).equals(readFileSync(to)))throw Error('사진 해시 충돌');}
        else copyFileSync(from,to,constants.COPYFILE_EXCL);
      }
      // Snapshot validation + one atomic pointer swap publishes menus and photo mappings together.
      atomicJson(join(root,'last-attempt.json'),{at:candidate.fetchedAt,ok:true,...(options.scheduledSlot?{scheduledSlot:options.scheduledSlot}:{})});
      publishMealSnapshot(root,snapshot);
      if(!options.silent)console.log(`식단 게시 완료: 총 ${candidate.items.length}개, 이번 조회 ${options.dates.join(', ')}`);
      return candidate;
    }catch(error){
      const message=error instanceof Error?error.message:'식단 수집 실패',at=new Date().toISOString();
      candidate=previous?{...previous,ok:false,error:message,fallback:'cache'}:{ok:false,source:SOURCE,fetchedAt:at,items:[],error:message};
      if(preview)atomicJson(options.outPath!,candidate);
      else atomicJson(join(root,'last-attempt.json'),{at,ok:false,error:message,...(options.scheduledSlot?{scheduledSlot:options.scheduledSlot}:{})});
      if(!options.silent)console.error(`수집 실패 · 마지막 정상 스냅샷 유지: ${message}`);
      return candidate;
    }
  }finally{
    // A UUID directory created by this invocation only; snapshots and backups are never deleted.
    try{if(staging)rmSync(staging,{recursive:true,force:true});}finally{release();}
  }
}
