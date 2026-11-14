import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import type { CrawlResult, MealItem } from '../../../types.ts';
import type { CollectMealCommand, CollectResult, Result } from '../../core/types.ts';
import { IndexedDbDexRepository } from '../../storage/indexeddb.ts';
import { adaptMealCatalog, readOfferings } from '../catalog.ts';
import { resolveDish } from '../identity.ts';
import { mealCards } from '../collection.ts';
import { MealCollectionRequests } from '../requests.ts';

const source='https://life.hanyang.ac.kr/theme/pages/home.php';
const now=Date.parse('2026-11-13T00:00:00.000Z');
const meal:MealItem={id:'2026-11-04-haksik-lunch',date:'2026-11-04',cafeteria:'haksik',mealTime:'lunch',name:'제육볶음',menu:['밥','김치'],price:4500,kcal:null,imageUrl:'/meals/saved.jpg',imageSourceUrl:'https://life.hanyang.ac.kr/saved.jpg'};
const crawl:CrawlResult={ok:true,source,fetchedAt:'2026-11-04T00:00:00.000Z',items:[meal]};
function value<T>(result:Result<T>):T{if(!result.ok)throw Error(result.error.code);return result.value;}
async function dishId(name:string){const resolved=await resolveDish(name,source);assert.equal(resolved.ok,true);return resolved.ok?resolved.dish.id:'';}

test('공백·대소문자·전각·명시적 영문 번역·검토 별칭만 안전하게 합친다',async()=>{
  assert.equal(await dishId('제육 볶음'),await dishId(' 제육볶음 '));
  assert.equal(await dishId('Curry Rice'),await dishId('ｃｕｒｒｙ　ｒｉｃｅ'));
  assert.equal(await dishId('[천원의 아침밥] 제육볶음 (Stir-fried Pork)'),await dishId('제육볶음'));
  assert.equal(await dishId('돈까스'),await dishId('돈가스'));
  assert.equal(await dishId('치즈돈가스 Cheese Pork Cutlet'),await dishId('치즈돈까스'));
});
test('맛·재료·조리법·세트 구성을 과도하게 합치지 않는다',async()=>{
  for(const [a,b] of [['매운 제육볶음','간장 제육볶음'],['돈까스','치즈돈까스'],['비빔밥','돌솥비빔밥'],['돈가스','돈가스&국물떡볶이'],['제육볶음','제육볶음(매운맛)']])assert.notEqual(await dishId(a),await dishId(b));
});
test('대표 메뉴 부재·일반 안내·충돌 별칭은 임의 메뉴 ID를 만들지 않는다',async()=>{
  for(const raw of [null,'','메뉴 미정','오늘의 메뉴','휴무'])assert.equal((await resolveDish(raw,source)).ok,false);
  const ambiguous=await resolveDish('테스트 메뉴',source,[{rawName:'테스트 메뉴',canonicalName:'A',identityKey:'A'},{rawName:'테스트메뉴',canonicalName:'B',identityKey:'B'}]);assert.equal(ambiguous.ok,false);
  const catalog=await adaptMealCatalog({...crawl,items:[{...meal,name:null}]},{date:meal.date},now);assert.equal(catalog.offerings[0].selection,null);assert.equal(catalog.offerings[0].offering.resolution.state,'unresolved');
});
test('날짜별 원본 ID와 코너 순서가 바뀌어도 음식 ID와 스냅샷 연결을 유지한다',async()=>{
  const original=structuredClone(crawl);
  const first=(await adaptMealCatalog(crawl,{date:meal.date},now)).offerings[0];
  const next=(await adaptMealCatalog({...crawl,items:[{...meal,id:'2026-11-05-haksik-lunch-2',date:'2026-11-05',name:'제육 볶음'}]},{date:'2026-11-05'},now)).offerings[0];
  assert.equal(first.selection?.dishId,next.selection?.dishId);assert.notEqual(first.offering.id,next.offering.id);assert.notEqual(first.selection?.dishId,meal.id);
  assert.deepEqual(first.offering.snapshot.menu,meal.menu);assert.equal(first.offering.legacyMealItemId,meal.id);assert.equal(first.offering.snapshot.imageUrl,meal.imageUrl);
  const other={...meal,id:meal.id+'-2',name:'치즈돈가스'};
  const a=await adaptMealCatalog({...crawl,items:[meal,other]},{date:meal.date},now);
  const b=await adaptMealCatalog({...crawl,items:[{...other,id:meal.id},{...meal,id:other.id}]},{date:meal.date},now);
  assert.equal(a.offerings[0].offering.id,b.offerings[1].offering.id);assert.equal(a.offerings[0].selection?.dishId,b.offerings[1].selection?.dishId);
  assert.deepEqual(crawl,original,'어댑터가 원본 데이터를 변경하면 안 된다');
});
test('실제 저장본과 예시·미확인·미래 식단을 구분하며 날짜·식당·끼니 필터를 유지한다',async()=>{
  const actual=await adaptMealCatalog(crawl,{date:meal.date},now);assert.ok(actual.offerings[0].selection);assert.equal(actual.dataState,'stale');
  for(const bad of [{...crawl,ok:false,fallback:'seed' as const},{...crawl,source:'mock:fixture'},{...crawl,source:'https://example.test/mock'}])assert.equal((await adaptMealCatalog(bad,{date:meal.date},now)).offerings[0].selection,null);
  const future={...meal,date:'2026-11-14'};assert.equal((await adaptMealCatalog({...crawl,items:[future]},{date:future.date},now)).offerings[0].selection,null);
  assert.equal((await adaptMealCatalog(crawl,{date:meal.date,cafeteria:'dorm'},now)).offerings.length,0);
  assert.equal((await adaptMealCatalog(crawl,{date:meal.date,mealTime:'breakfast'},now)).offerings.length,0);
  assert.equal((await adaptMealCatalog(crawl,{date:'2026-11-13'},now)).offerings.length,0);
});
test('한국 시간 자정 전후의 제공일만 실제 식사로 허용한다',async()=>{
  const item={...meal,date:'2026-11-14'};
  const early=await adaptMealCatalog({...crawl,items:[item]},{date:item.date},Date.parse('2026-11-13T14:59:59Z'));
  const midnight=await adaptMealCatalog({...crawl,items:[item]},{date:item.date},Date.parse('2026-11-13T15:00:00Z'));
  assert.equal(early.offerings[0].selection,null);assert.ok(midnight.offerings[0].selection);
});
test('기존 GET status 한 번만 사용하고 오류를 mock 메뉴로 메우지 않는다',async()=>{
  const calls:string[]=[];
  const fetcher=(async(url,init)=>{calls.push(String(url));assert.equal(init?.cache,'no-store');assert.ok(!init?.method||init.method==='GET');return Response.json({ok:true,data:crawl});}) as typeof fetch;
  const result=await readOfferings({date:meal.date},{fetcher});assert.equal(result.ok,true);assert.deepEqual(calls,['/api/meals/status']);
  const failed=await readOfferings({date:meal.date},{fetcher:async()=>{throw Error('offline');}});assert.equal(failed.ok,false);
  const malformed=await readOfferings({date:meal.date},{fetcher:async()=>Response.json({ok:true,data:{...crawl,items:[{}]}})});assert.equal(malformed.ok,false);
});

async function prepared(){
  const repo=new IndexedDbDexRepository({factory:new IDBFactory()});const {ownerId}=value(await repo.open());const doc=value(await repo.snapshot());
  const row=(await adaptMealCatalog(crawl,{date:meal.date},now)).offerings[0];assert.ok(row.selection);
  const command:CollectMealCommand={ownerId,dexId:doc.dexes.find(d=>d.kind==='meal')!.id,requestId:'initial-request',selection:row.selection,experiencedOn:meal.date,rating:null,note:''};
  return {repo,command};
}
test('실제 DTO→공통 저장 포트: 다른 날짜도 카드 하나·경험 두 개, 평가·메모·삭제는 개인 기록만 변경한다',async()=>{
  const {repo,command}=await prepared();const before=value(await repo.snapshot());assert.equal(before.entries.length,0);
  const first=value(await repo.commitMealCollection(command));assert.equal(first.outcome,'new-entry');assert.ok(first.discovery);
  const secondRow=(await adaptMealCatalog({...crawl,items:[{...meal,date:'2026-11-05',id:'2026-11-05-haksik-lunch',name:'제육 볶음'}]},{date:'2026-11-05'},now)).offerings[0];assert.ok(secondRow.selection);
  const second=value(await repo.commitMealCollection({...command,requestId:'second',selection:secondRow.selection,experiencedOn:'2026-11-05'}));assert.equal(second.outcome,'revisit');
  const replay=value(await repo.commitMealCollection(command));assert.equal(replay.replayed,true);assert.equal(replay.discovery,null);
  let doc=value(await repo.snapshot());assert.equal(doc.entries.length,1);assert.equal(doc.experiences.length,2);assert.equal(mealCards(doc)[0].rating,null);
  value(await repo.updateExperience(command.ownerId,first.experience.id,1,{rating:4,note:'처음 먹은 날의 메모'}));
  doc=value(await repo.snapshot());assert.equal(mealCards(doc)[0].rating,4,'최근 무평가 경험은 대표 별점에서 제외');assert.equal(mealCards(doc)[0].note,'처음 먹은 날의 메모');
  value(await repo.deleteExperience(command.ownerId,second.experience.id,1));assert.equal(value(await repo.snapshot()).experiences.length,1);
  value(await repo.deleteEntry(command.ownerId,first.entry.id,1));doc=value(await repo.snapshot());assert.equal(doc.entries.length,0);assert.equal(doc.experiences.length,0);assert.deepEqual(doc.dexes,before.dexes);repo.close();
});
test('화면 요청 조정은 빠른 클릭·확인된 재방문·실패 재시도를 구분한다',async()=>{
  const {repo,command}=await prepared();let clock=1000,calls=0;const requests=new MealCollectionRequests(()=>clock);
  const make=()=>({...command,requestId:crypto.randomUUID()});
  const commit=(input:CollectMealCommand)=>{calls++;return repo.commitMealCollection(input);};
  const [a,b]=await Promise.all([requests.run('one',make,commit),requests.run('one',make,commit)]);assert.equal(calls,1);assert.equal(value(a).experience.id,value(b).experience.id);
  const duplicate=value(await requests.run('one',make,commit));assert.equal(duplicate.replayed,true);assert.equal(calls,1);
  requests.beginVisit('one');clock++;value(await requests.run('one',make,commit));assert.equal(calls,2);assert.equal(value(await repo.snapshot()).experiences.length,2);
  const attempted:string[]=[];let fail=true;
  const flaky=async(input:CollectMealCommand):Promise<Result<CollectResult>>=>{attempted.push(input.requestId);if(fail){fail=false;return {ok:false,error:{code:'QUOTA_EXCEEDED',message:'test'}};}return repo.commitMealCollection(input);};
  const failed=await requests.run('retry',make,flaky);assert.equal(failed.ok,false);assert.equal(requests.hasPending('retry'),true);
  value(await requests.run('retry',make,flaky));assert.equal(attempted[0],attempted[1]);repo.close();
});
test('응답이 불확실한 저장의 재시도는 원래 requestId로 처리해 중복을 만들지 않는다',async()=>{
  const {repo,command}=await prepared();const requests=new MealCollectionRequests();let uncertain=true;
  const commit=async(input:CollectMealCommand)=>{const saved=await repo.commitMealCollection(input);if(uncertain){uncertain=false;throw Error('response interrupted');}return saved;};
  assert.equal((await requests.run('uncertain',()=>command,commit)).ok,false);
  const result=value(await requests.run('uncertain',()=>({...command,requestId:'wrong-new-request'}),commit));assert.equal(result.replayed,true);assert.equal(result.discovery,null);assert.equal(value(await repo.snapshot()).experiences.length,1);repo.close();
});

test('학식 수집·평가·삭제가 인연·자유도감의 기존 카드와 경험을 변경하지 않는다',async()=>{
  const {repo,command}=await prepared();const start=value(await repo.snapshot());
  const people=start.dexes.find(d=>d.kind==='people')!;
  value(await repo.collect({ownerId:command.ownerId,dexId:people.id,requestId:'person-keep',subject:{kind:'person',displayName:'검증용 별명'},experience:{kind:'person',event:'memory',experiencedOn:'2026-11-03',note:'보존할 인연 메모'}}));
  const custom=value(await repo.createDex(command.ownerId,{kind:'custom',name:'검증용 자유도감',icon:'book'}));
  value(await repo.collect({ownerId:command.ownerId,dexId:custom.id,requestId:'custom-keep',subject:{kind:'custom',title:'보존할 기록'},experience:{kind:'custom',experiencedOn:'2026-11-03',note:'보존할 자유 메모'}}));
  const before=value(await repo.snapshot());const saved=value(await repo.commitMealCollection(command));
  value(await repo.updateExperience(command.ownerId,saved.experience.id,1,{rating:5,note:'학식만 수정'}));
  value(await repo.deleteEntry(command.ownerId,saved.entry.id,1));const after=value(await repo.snapshot());
  assert.deepEqual(after.entries,before.entries);assert.deepEqual(after.experiences,before.experiences);assert.deepEqual(after.dexes,before.dexes);repo.close();
});
