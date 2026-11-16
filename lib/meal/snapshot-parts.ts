import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MealSnapshot } from './sync-store.ts';
import type { CrawlResult, MealItem } from '../types.ts';
import type { MealPhotoDbRecord } from './store.ts';
interface DayPart {date:string;items:MealItem[];photos:MealPhotoDbRecord[]}
interface Manifest {schemaVersion:2;crawl:Omit<CrawlResult,'items'>;parts:{date:string;hash:string}[];checkedDates:string[];scheduledSlots:string[]}
export function encodeSnapshotParts(root:string,snapshot:MealSnapshot):Manifest{
  const dir=join(root,'chunks');mkdirSync(dir,{recursive:true});
  const dates=[...new Set([...snapshot.crawl.items.map(row=>row.date),...snapshot.photos.map(row=>row.date)])].sort();
  const parts=dates.map(date=>{const part:DayPart={date,items:snapshot.crawl.items.filter(row=>row.date===date),photos:snapshot.photos.filter(row=>row.date===date)};const bytes=Buffer.from(JSON.stringify(part)+'\n'),hash=createHash('sha256').update(bytes).digest('hex'),file=join(dir,hash+'.json');if(existsSync(file)){if(!readFileSync(file).equals(bytes))throw Error('식단 데이터 해시 충돌');}else writeFileSync(file,bytes,{flag:'wx'});return {date,hash};});
  const {items,...crawl}=snapshot.crawl;void items;
  return {schemaVersion:2,crawl,parts,checkedDates:snapshot.checkedDates,scheduledSlots:snapshot.scheduledSlots};
}
/** On-disk v1 remains readable; callers keep the existing v1 in-memory contract. */
export function decodeSnapshotParts(root:string,value:MealSnapshot|Manifest):MealSnapshot{
  if(value.schemaVersion===1)return value;
  if(value.schemaVersion!==2||!Array.isArray(value.parts))throw Error('지원하지 않는 식단 스냅샷');
  const items:MealItem[]=[],photos:MealPhotoDbRecord[]=[],seen=new Set<string>();
  for(const part of value.parts){if(!/^\d{4}-\d{2}-\d{2}$/.test(part.date)||!/^\w{64}$/.test(part.hash)||!/^[a-f0-9]+$/.test(part.hash)||seen.has(part.date))throw Error('식단 파트 참조가 잘못되었습니다.');seen.add(part.date);const bytes=readFileSync(join(root,'chunks',part.hash+'.json'));if(createHash('sha256').update(bytes).digest('hex')!==part.hash)throw Error('식단 파트 무결성 검사 실패');const data=JSON.parse(bytes.toString('utf8')) as DayPart;if(data.date!==part.date||!Array.isArray(data.items)||!Array.isArray(data.photos)||data.items.some(row=>row.date!==part.date)||data.photos.some(row=>row.date!==part.date))throw Error('식단 날짜 파트 불일치');items.push(...data.items);photos.push(...data.photos);}
  return {schemaVersion:1,crawl:{...value.crawl,items},photos,checkedDates:value.checkedDates,scheduledSlots:value.scheduledSlots};
}
