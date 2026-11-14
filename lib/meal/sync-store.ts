/** Server-only persistent snapshots. No reads create directories or start a crawl. */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { CrawlResult } from '../types.ts';
import type { MealPhotoDbRecord } from './store.ts';

export interface SyncAttempt {at:string;ok:boolean;error?:string;scheduledSlot?:string}
export interface MealSnapshot {schemaVersion:1;crawl:CrawlResult;photos:MealPhotoDbRecord[];checkedDates:string[];scheduledSlots:string[]}
export type StoredCrawl=CrawlResult&{syncStatus?:SyncAttempt;checkedDates?:string[]};
export function mealStorageRoot(projectRoot=process.cwd()){
  return resolve(process.env.MEALS_STORAGE_DIR||join(projectRoot,'data','meal-sync'));
}
export function jsonFile<T>(path:string):T|null{
  if(!existsSync(path))return null;
  return JSON.parse(readFileSync(path,'utf8')) as T;
}
export function atomicJson(path:string,value:unknown){
  mkdirSync(dirname(path),{recursive:true});
  const temporary=path+`.${randomUUID()}.tmp`;
  try{writeFileSync(temporary,JSON.stringify(value,null,2)+'\n',{flag:'wx'});renameSync(temporary,path);}
  finally{if(existsSync(temporary))unlinkSync(temporary);}
}
export function readMealSnapshot(root:string):MealSnapshot|null{
  const pointer=jsonFile<{generation:string;sha256:string}>(join(root,'current.json'));
  if(!pointer)return null;
  if(!/^[0-9a-f-]{36}$/.test(pointer.generation))throw Error('식단 스냅샷 포인터가 잘못되었습니다.');
  const bytes=readFileSync(join(root,'snapshots',pointer.generation+'.json'));
  if(createHash('sha256').update(bytes).digest('hex')!==pointer.sha256)throw Error('식단 스냅샷 무결성 검사 실패');
  const data=JSON.parse(bytes.toString('utf8')) as MealSnapshot;
  if(data.schemaVersion!==1||!data.crawl?.ok||!Array.isArray(data.crawl.items)||!Array.isArray(data.photos))throw Error('유효한 식단 스냅샷이 아닙니다.');
  return data;
}
export function publishMealSnapshot(root:string,snapshot:MealSnapshot){
  if(!snapshot.crawl.ok)throw Error('실패 결과를 게시할 수 없습니다.');
  const generation=randomUUID(),directory=join(root,'snapshots');mkdirSync(directory,{recursive:true});
  const file=join(directory,generation+'.json');atomicJson(file,snapshot);
  const bytes=readFileSync(file);const checked=JSON.parse(bytes.toString('utf8')) as MealSnapshot;
  if(!checked.crawl.ok||checked.crawl.items.length!==snapshot.crawl.items.length)throw Error('임시 스냅샷 검증 실패');
  // Readers see either the entire previous generation or the entire next generation.
  atomicJson(join(root,'current.json'),{generation,sha256:createHash('sha256').update(bytes).digest('hex')});
}
export function acquireMealLock(root:string):(()=>void)|null{
  mkdirSync(root,{recursive:true});const path=join(root,'sync.lock'),token=randomUUID();let fd:number;
  try{fd=openSync(path,'wx');}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')return null;throw error;}
  try{writeFileSync(fd,JSON.stringify({token,pid:process.pid,startedAt:new Date().toISOString()}));}
  catch(error){closeSync(fd);unlinkSync(path);throw error;}
  closeSync(fd);
  return()=>{const held=jsonFile<{token:string}>(path);if(held?.token===token)unlinkSync(path);};
}
export function storedCrawl(root:string):StoredCrawl|null{
  const snapshot=readMealSnapshot(root);if(!snapshot)return null;
  const syncStatus=jsonFile<SyncAttempt>(join(root,'last-attempt.json'));
  return {...snapshot.crawl,checkedDates:snapshot.checkedDates,...(syncStatus?{syncStatus}:{})};
}
export const PHOTO_NAME=/^[a-f0-9]{64}\.(jpg|png|webp|gif)$/;
export function mealAssetPath(root:string,name:string){if(!PHOTO_NAME.test(name))throw Error('잘못된 식단 사진 경로');return join(root,'assets',name);}
