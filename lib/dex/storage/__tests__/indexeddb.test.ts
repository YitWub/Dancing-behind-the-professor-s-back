import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { IDBFactory, IDBDatabase } from 'fake-indexeddb';
import { IndexedDbDexRepository } from '../indexeddb.ts';
import type { CollectCommand, CollectMealCommand, Result } from '../../core/types.ts';

function value<T>(result:Result<T>):T { if(!result.ok)throw Error(`${result.error.code}: ${result.error.message}`);return result.value; }
function error<T>(result:Result<T>,code:string){assert.equal(result.ok,false);if(!result.ok)assert.equal(result.error.code,code);}
async function setup(options:ConstructorParameters<typeof IndexedDbDexRepository>[0]={}){
  const factory=options.factory??new IDBFactory();
  const repo=new IndexedDbDexRepository({...options,factory});
  const profile=value(await repo.open());
  const doc=value(await repo.snapshot());
  const command:CollectCommand={ownerId:profile.ownerId,dexId:doc.dexes.find(d=>d.kind==='meal')!.id,requestId:'first-request',
    subject:{kind:'meal',dishId:'dish-1',displayNameSnapshot:'제육볶음'},experience:{kind:'meal',experiencedOn:'2026-11-13',rating:null,offeringId:'offering-1',context:{date:'2026-11-13',cafeteria:'haksik',mealTime:'lunch',legacyMealItemId:'2026-11-13-haksik-lunch',source:'https://example.test/menu',snapshot:{name:'제육볶음',menu:['밥'],price:4500,kcal:null,imageUrl:null,imageSourceUrl:null}}}};
  return {repo,factory,profile,doc,command};
}
async function mutateRaw(factory:IDBFactory,store:string,operation:(store:IDBObjectStore)=>void){
  const request=factory.open('bokak.dex',1);
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  try {await new Promise<void>((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);operation(tx.objectStore(store));});}
  finally{db.close();}
}

test('초기화는 빈 기본 도감만 만들고 연결을 다시 열어도 기록을 복원한다',async()=>{
  const {repo,factory,doc,command}=await setup();
  assert.equal(doc.dexes.length,2);assert.equal(doc.entries.length,0);assert.equal(doc.profile.scope,'local-browser');
  const first=value(await repo.collect(command));repo.close();
  const reopened=new IndexedDbDexRepository({factory});value(await reopened.open());
  const restored=value(await reopened.snapshot());assert.equal(restored.entries[0].id,first.entry.id);assert.equal(restored.experiences.length,1);reopened.close();
});
test('최초 카드/경험, 재방문, 동일 요청 재전송, 다른 내용 충돌',async()=>{
  const {repo,command}=await setup();
  const first=value(await repo.collect(command));assert.equal(first.outcome,'new-entry');assert.ok(first.discovery);
  const second=value(await repo.collect({...command,requestId:'visit2'}));assert.equal(second.outcome,'revisit');assert.equal(second.entry.id,first.entry.id);assert.equal(second.discovery,null);
  const replay=value(await repo.collect(command));assert.equal(replay.replayed,true);assert.equal(replay.experience.id,first.experience.id);assert.equal(replay.discovery,null);
  error(await repo.collect({...command,experience:{...command.experience,note:'다른 내용'}}),'REQUEST_ID_CONFLICT');
  const doc=value(await repo.snapshot());assert.equal(doc.entries.length,1);assert.equal(doc.experiences.length,2);assert.equal(doc.receipts.length,2);repo.close();
});
test('동시 연결의 같은 요청과 별도 방문이 중복 카드·이력을 만들지 않는다',async()=>{
  const {repo,factory,command}=await setup();const other=new IndexedDbDexRepository({factory});value(await other.open());
  const replies=await Promise.all(Array.from({length:8},(_,i)=>(i%2?repo:other).collect(command)));
  assert.equal(replies.filter(r=>r.ok&&!r.value.replayed).length,1);
  await Promise.all(Array.from({length:8},(_,i)=>(i%2?repo:other).collect({...command,requestId:`visit-${i}`})));
  const doc=value(await repo.snapshot());assert.equal(doc.entries.length,1);assert.equal(doc.experiences.length,9);repo.close();other.close();
});
test('큐잉 이후 저장 오류도 카드·경험·영수증 전체를 롤백한다',async()=>{
  let fail=false,commits=0;
  const {repo,command}=await setup({beforeCommit:()=>{if(fail)throw new DOMException('test quota','QuotaExceededError');},onCommitted:()=>commits++});
  const before=value(await repo.snapshot());const previousCommits=commits;fail=true;
  error(await repo.collect(command),'QUOTA_EXCEEDED');assert.deepEqual(value(await repo.snapshot()),before);assert.equal(commits,previousCommits);
  fail=false;assert.equal(value(await repo.collect(command)).outcome,'new-entry');repo.close();
});
test('도감·카드·경험 CRUD, revision 및 소유 범위와 cascade를 보호한다',async()=>{
  const {repo,profile,command}=await setup();const saved=value(await repo.collect(command));
  const changed=value(await repo.updateEntry(profile.ownerId,saved.entry.id,1,{subject:{kind:'meal',dishId:'dish-1',displayNameSnapshot:'제육 기록'}}));
  assert.equal(changed.revision,2);error(await repo.updateEntry(profile.ownerId,changed.id,1,{collectedOn:'2026-11-12'}),'REVISION_CONFLICT');
  error(await repo.updateEntry(profile.ownerId,changed.id,2,{subject:{kind:'meal',dishId:'dish-2',displayNameSnapshot:'다른 메뉴'}}),'INVALID_INPUT');
  error(await repo.listDexes('another-owner'),'OWNER_MISMATCH');
  const exp=value(await repo.updateExperience(profile.ownerId,saved.experience.id,1,{note:'수정한 한줄평',rating:5}));assert.equal(exp.revision,2);
  value(await repo.deleteExperience(profile.ownerId,exp.id,2));assert.equal(value(await repo.snapshot()).entries.length,1);
  error(await repo.collect(command),'RESULT_DELETED');
  value(await repo.collect({...command,requestId:'new-after-deletion'}));
  value(await repo.deleteEntry(profile.ownerId,changed.id,2));const after=value(await repo.snapshot());assert.equal(after.entries.length,0);assert.equal(after.experiences.length,0);assert.ok(after.receipts.length);
  const custom=value(await repo.createDex(profile.ownerId,{kind:'custom',name:'카페 도감',icon:'coffee'}));
  const renamed=value(await repo.updateDex(profile.ownerId,custom.id,1,{name:'나의 카페'}));assert.equal(renamed.name,'나의 카페');
  value(await repo.collect({ownerId:profile.ownerId,dexId:custom.id,requestId:'custom-1',subject:{kind:'custom',title:'가상 카페'},experience:{kind:'custom',experiencedOn:'2026-11-13'}}));
  value(await repo.deleteDex(profile.ownerId,custom.id,2));assert.equal(value(await repo.snapshot()).experiences.length,0);repo.close();
});
test('인연 별점과 고아 참조를 거부하고 이름이 같은 인연은 독립 카드다',async()=>{
  const {repo,profile,doc}=await setup();
  const cmd:CollectCommand={ownerId:profile.ownerId,dexId:doc.dexes.find(d=>d.kind==='people')!.id,requestId:'p1',subject:{kind:'person',displayName:'별명'},experience:{kind:'person',event:'memory',experiencedOn:'2026-11-13'}};
  const first=value(await repo.collect(cmd));value(await repo.collect({...cmd,requestId:'p2'}));
  error(await repo.updateExperience(profile.ownerId,first.experience.id,1,{rating:5}),'INVALID_INPUT');
  error(await repo.collect({...cmd,requestId:'p3',entryId:'missing'}),'NOT_FOUND');
  assert.equal(value(await repo.snapshot()).entries.length,2);repo.close();
});
test('내보내기·미리보기는 기록을 바꾸지 않고 확인된 교체만 원자적으로 복원한다',async()=>{
  const {repo,command,profile}=await setup();value(await repo.collect(command));
  const backup=value(await repo.exportRecords(profile.ownerId));const original=value(await repo.snapshot());
  const envelope=JSON.parse(await backup.text());assert.equal(envelope.containsSensitiveData,true);
  const preview=value(await repo.previewImport(backup));assert.deepEqual(value(await repo.snapshot()),original);
  value(await repo.commitImport({token:preview.token,strategy:'replace',confirmed:true}));
  const restored=value(await repo.snapshot());assert.deepEqual(restored.entries,original.entries);assert.deepEqual(restored.experiences,original.experiences);
  assert.equal(value(await repo.collect(command)).replayed,true);repo.close();
});
test('잘못된 백업·미지원 버전·중복·고아·개발 namespace는 기존 기록을 훼손하지 않는다',async()=>{
  const {repo,command,profile}=await setup();value(await repo.collect(command));const before=value(await repo.snapshot());
  const source=JSON.parse(await value(await repo.exportRecords(profile.ownerId)).text());
  const variants=[{...source,schemaVersion:2},{...source,data:{...source.data,entries:[...source.data.entries,...source.data.entries]}},{...source,data:{...source.data,experiences:source.data.experiences.map((e:Record<string,unknown>)=>({...e,entryId:'missing'}))}},{...source,data:{...source.data,profile:{...source.data.profile,namespace:'development'}}}];
  for(const candidate of variants)assert.equal((await repo.previewImport(new Blob([JSON.stringify(candidate)]))).ok,false);
  error(await repo.previewImport(new Blob(['{broken'])),'INVALID_BACKUP');
  assert.deepEqual(value(await repo.snapshot()),before);repo.close();
});
test('가져오기 미리보기 이후 수정 충돌과 저장 중 실패를 감지하고 롤백한다',async()=>{
  let fail=false;const {repo,command,profile}=await setup({beforeCommit:()=>{if(fail)throw new Error('test abort');}});
  const backup=value(await repo.exportRecords(profile.ownerId));const preview=value(await repo.previewImport(backup));
  value(await repo.collect(command));error(await repo.commitImport({token:preview.token,strategy:'replace',confirmed:true}),'IMPORT_CONFLICT');
  const next=value(await repo.previewImport(backup));const before=value(await repo.snapshot());fail=true;
  error(await repo.commitImport({token:next.token,strategy:'replace',confirmed:true}),'STORAGE_UNAVAILABLE');assert.deepEqual(value(await repo.snapshot()),before);repo.close();
});
test('손상 데이터는 자동 초기화하지 않고 복구용 export와 검증된 백업 복원을 제공한다',async()=>{
  const {repo,factory,command,profile}=await setup();value(await repo.collect(command));const backup=value(await repo.exportRecords(profile.ownerId));
  await mutateRaw(factory,'entries',store=>store.put({id:'broken',dexId:'missing'}));
  error(await repo.open(),'CORRUPT_STORAGE');error(await repo.snapshot(),'CORRUPT_STORAGE');
  const raw=JSON.parse(await value(await repo.exportRecovery()).text());assert.ok(raw.raw.entries.some((e:{id:string})=>e.id==='broken'));
  const preview=value(await repo.previewImport(backup));value(await repo.commitImport({token:preview.token,strategy:'replace',confirmed:true}));
  assert.equal(value(await repo.snapshot()).entries.length,1);repo.close();
});
test('손상된 프로필 없이 고아 데이터만 남아도 초기화하지 않는다',async()=>{
  const {repo,factory}=await setup();await mutateRaw(factory,'meta',store=>store.clear());
  error(await repo.open(),'CORRUPT_STORAGE');const raw=JSON.parse(await value(await repo.exportRecovery()).text());assert.equal(raw.raw.dexes.length,2);repo.close();
});
test('미래 DB 스키마는 지우거나 다운그레이드하지 않는다',async()=>{
  const factory=new IDBFactory();const request=factory.open('bokak.dex',2);
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{request.onupgradeneeded=()=>request.result.createObjectStore('future');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});db.close();
  const repo=new IndexedDbDexRepository({factory});error(await repo.open(),'UNSUPPORTED_SCHEMA');repo.close();
});
test('수집에 반환된 레코드 변경은 저장된 객체를 직접 변경하지 못한다',async()=>{
  const {repo,command}=await setup();const first=value(await repo.collect(command));first.experience.note='외부에서 변경';
  assert.notEqual(value(await repo.snapshot()).experiences[0].note,'외부에서 변경');repo.close();
});
test('SSR/저장소 미지원 환경의 실패를 Result로 반환한다',async()=>{
  const repo=new IndexedDbDexRepository();error(await repo.open(),'STORAGE_UNAVAILABLE');
});

test('이미 abort된 transaction의 후속 오류도 이중 abort 예외 없이 실패 Result와 롤백으로 끝난다',async()=>{
  const original=IDBDatabase.prototype.transaction;
  let current:IDBTransaction|null=null,armed=false;
  IDBDatabase.prototype.transaction=function(...args:Parameters<typeof original>){const tx=original.apply(this,args);if(args[1]==='readwrite')current=tx;return tx;};
  try{
    const {repo,command}=await setup({beforeCommit:()=>{if(armed){current!.abort();throw Error('already aborted');}}});
    const before=value(await repo.snapshot());armed=true;
    error(await repo.collect(command),'STORAGE_UNAVAILABLE');assert.deepEqual(value(await repo.snapshot()),before);repo.close();
  }finally{IDBDatabase.prototype.transaction=original;}
});

test('B의 resolved Offering은 호환 포트로 카드 하나와 식단별 경험에 연결된다',async()=>{
  const {repo,command}=await setup();assert.equal(command.experience.kind,'meal');
  if(command.experience.kind!=='meal')return;
  const context=command.experience.context;
  const input:CollectMealCommand={ownerId:command.ownerId,dexId:command.dexId,requestId:'adapter-first',experiencedOn:'2026-11-13',rating:null,note:'',selection:{dishId:'dish-1',dishName:'제육볶음',offering:{
    id:'offering-1',revision:1,createdAt:'2026-11-13T00:00:00.000Z',updatedAt:'2026-11-13T00:00:00.000Z',legacyMealItemId:context.legacyMealItemId,sourceRecordKey:'source-key',date:context.date,cafeteria:context.cafeteria,mealTime:context.mealTime,snapshot:context.snapshot,soldOut:false,
    resolution:{state:'resolved',dishId:'dish-1',aliasId:'alias-1',aliasRevision:1},provenance:{source:context.source,mode:'live',lastSuccessfulFetchAt:'2026-11-13T00:00:00.000Z',lastAttemptAt:'2026-11-13T00:00:00.000Z'},
  }}};
  const first=value(await repo.commitMealCollection(input));assert.equal(first.outcome,'new-entry');
  assert.equal(value(await repo.commitMealCollection(input)).replayed,true);
  value(await repo.commitMealCollection({...input,requestId:'adapter-revisit'}));
  const doc=value(await repo.snapshot());assert.equal(doc.entries.length,1);assert.equal(doc.experiences.length,2);repo.close();
});
