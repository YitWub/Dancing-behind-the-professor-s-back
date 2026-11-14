import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mergeArchivedMeals, readArchivedMealCatalog } from '../archive-catalog.ts';
import type { HistoryDayFile } from '../history-store.ts';
import type { HistoricalDay } from '../history.ts';
import type { CrawlResult, Cafeteria } from '../../types.ts';
import { adaptMealCatalog } from '../../dex/meal/catalog.ts';
import { resolveDish } from '../../dex/meal/identity.ts';
const date='2026-09-01',source='https://life.hanyang.ac.kr/theme/pages/facilities/detail.php?id=1&date='+date+'&view=daily';
const base:CrawlResult={ok:true,source:'https://life.hanyang.ac.kr/theme/pages/home.php',fetchedAt:'2026-11-14T00:00:00Z',items:[]};
function record(cafeteria:Cafeteria='haksik'):HistoryDayFile{
  const day:HistoricalDay={schemaVersion:1,parserVersion:'daily-evidence-v1',date,cafeteria,source,observedAt:'2026-11-14T00:00:00Z',httpStatus:200,htmlHash:'evidence',status:'complete',reason:'fixture',meals:[{mealTime:'lunch',state:'complete',rawCardCount:1,reason:'fixture',items:[{date,cafeteria,mealTime:'lunch',rawName:'치즈돈가스',canonicalName:'치즈돈가스',dishId:'resolved',legacyId:'legacy',sourceRecordId:'source-id',menu:['밥'],price:4500,source,observedAt:'2026-11-14T00:00:00Z',reviewFlags:[]}]}]};
  return {schemaVersion:1,latest:day,effective:day};
}
test('과거 메뉴는 기존 식사 저장 계약으로 수집 가능하며 dishId가 바뀌지 않는다',async()=>{
  const crawl=mergeArchivedMeals(base,date,[record()]);const catalog=await adaptMealCatalog(crawl,{date},Date.parse('2026-11-15T00:00:00Z'));
  const expected=await resolveDish('치즈돈가스',base.source);assert.ok(expected.ok);assert.equal(catalog.offerings[0].selection?.dishId,expected.dish.id);assert.equal(catalog.offerings[0].offering.date,date);
});
test('현재 식단·사진은 우선 보존하고 같은 끼니의 과거 기록을 중복 추가하지 않는다',()=>{
  const prior=mergeArchivedMeals(base,date,[record()]);prior.items[0].imageUrl='/existing.jpg';const before=structuredClone(prior);const result=mergeArchivedMeals(prior,date,[record(),record()]);assert.deepEqual(result,prior);assert.deepEqual(prior,before);assert.equal(result.items[0].imageUrl,'/existing.jpg');
});
test('빈 응답·실패·부분 파싱 끼니는 실제 메뉴로 승격하지 않는다',()=>{
  for(const status of ['empty-unknown','network-error','parse-error','closed'] as const){const r=record();r.effective!.status=status;assert.deepEqual(mergeArchivedMeals(base,date,[r]).items,[]);}
  const r=record();r.effective!.meals[0].state='partial';assert.deepEqual(mergeArchivedMeals(base,date,[r]).items,[]);
});
test('시드 메뉴를 실제 메뉴로 승격하지 않고 식당을 구분하며 미래 수집은 차단한다',async()=>{
  const seed={...base,source:'seed:fixture',fallback:'seed' as const};const result=mergeArchivedMeals(seed,date,[record(),record('dorm')]);assert.equal(result.items.length,2);assert.equal(result.fallback,undefined);const future=await adaptMealCatalog(result,{date},Date.parse('2026-08-31T00:00:00Z'));assert.ok(future.offerings.every(row=>!row.selection));
});
test('최근 수집이 실패해도 정상 effective 이력은 읽고 파일은 쓰지 않는다',()=>{
  const root=mkdtempSync(join(tmpdir(),'bokak-archive-read-'));
  try{const r=record();r.latest={...r.effective!,status:'network-error',meals:[]};const dir=join(root,'days','haksik',date);mkdirSync(dir,{recursive:true});const file=join(dir,'current.json');writeFileSync(file,JSON.stringify(r));const before=readFileSync(file);assert.equal(readArchivedMealCatalog(base,date,root).items.length,1);assert.deepEqual(readFileSync(file),before);assert.deepEqual(readArchivedMealCatalog(base,'2026-09-02',root),base);assert.throws(()=>readArchivedMealCatalog(base,'../bad',root));}finally{rmSync(root,{recursive:true,force:true});}
});
