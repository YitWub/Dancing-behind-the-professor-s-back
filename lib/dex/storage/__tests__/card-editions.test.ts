import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { IDBFactory, IDBDatabase } from 'fake-indexeddb';
import { IndexedDbDexRepository,DATABASE_VERSION } from '../indexeddb.ts';
import type { CollectCommand, Result } from '../../core/types.ts';

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
  const request=factory.open('bokak.dex',DATABASE_VERSION);
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  try {await new Promise<void>((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);operation(tx.objectStore(store));});}
  finally{db.close();}
}


import { CARD_EDITION_POLICY, pickCardEdition } from '../../meal/card-editions.ts';
test('에디션 확률 합계와 모든 경계는 60/27/10/3이며 잘못된 추첨값은 거부',()=>{
  assert.equal(Object.values(CARD_EDITION_POLICY.weights).reduce((a,b)=>a+b,0),100);
  for(const [roll,edition] of [[0,'NORMAL'],[.599999,'NORMAL'],[.6,'SPECIAL'],[.869999,'SPECIAL'],[.87,'RARE'],[.969999,'RARE'],[.97,'GOLDEN'],[.999999,'GOLDEN']] as const)assert.equal(pickCardEdition(roll),edition);
  for(const roll of [-1,1,NaN,Infinity])assert.throws(()=>pickCardEdition(roll));
});
test('최초·재방문은 경험별 카드 1장, 동시 재시도·재접속은 에디션과 ID를 보존',async()=>{
  const {repo,factory,command}=await setup();
  const [a,b]=await Promise.all([repo.collect(command),repo.collect(command)]);const first=value(a),replay=value(b);
  assert.ok(first.experience.card);assert.deepEqual(first.experience.card,replay.experience.card);
  const second=value(await repo.collect({...command,requestId:'second'}));assert.notEqual(second.experience.card!.id,first.experience.card!.id);
  const before=value(await repo.snapshot());assert.equal(before.entries.length,1);assert.equal(before.experiences.length,2);
  repo.close();const reopened=new IndexedDbDexRepository({factory});value(await reopened.open());
  assert.deepEqual(value(await reopened.snapshot()).experiences,before.experiences);
  assert.deepEqual(value(await reopened.collect(command)).experience.card,first.experience.card);reopened.close();
});
test('저장 실패는 카드·경험·영수증 전체를 롤백하고 같은 요청은 재추첨하지 않는다',async()=>{
  const {repo,factory,command}=await setup();const source=value(await repo.exportRecords(command.ownerId));repo.close();
  const failed=new IndexedDbDexRepository({factory,beforeCommit:()=>{throw Error('disk full');}});
  error(await failed.collect(command),'STORAGE_UNAVAILABLE');assert.equal(value(await failed.snapshot()).experiences.length,0);failed.close();
  const good=new IndexedDbDexRepository({factory});value(await good.open());const attempted=value(await good.collect(command)).experience.card!;
  good.close();const comparison=new IndexedDbDexRepository({factory:new IDBFactory()});value(await comparison.open());
  const preview=value(await comparison.previewImport(source));value(await comparison.commitImport({token:preview.token,strategy:'replace',confirmed:true}));
  assert.equal(value(await comparison.collect(command)).experience.card!.edition,attempted.edition);comparison.close();
});
test('기존 DB 경험은 NORMAL로 안정 이전하며 기존 ID·시각·평가·영수증을 보존',async()=>{
  const {repo,factory,command}=await setup();const first=value(await repo.collect(command));repo.close();
  const legacy=structuredClone(first.experience);delete legacy.card;
  await mutateRaw(factory,'experiences',store=>store.put(legacy));
  const reopened=new IndexedDbDexRepository({factory});value(await reopened.open());
  const migrated=value(await reopened.snapshot());const exp=migrated.experiences[0];
  assert.equal(exp.card!.edition,'NORMAL');assert.equal(exp.card!.origin,'legacy');assert.equal(exp.card!.id,'card-v1:'+legacy.id);
  const {card,...withoutCard}=exp;assert.ok(card);assert.deepEqual(withoutCard,legacy);
  const backup=value(await reopened.exportRecords(command.ownerId));assert.equal(JSON.parse(await backup.text()).schemaVersion,2);
  reopened.close();const again=new IndexedDbDexRepository({factory});value(await again.open());assert.deepEqual(value(await again.snapshot()).experiences,migrated.experiences);again.close();
});
test('v1 백업은 NORMAL로 이전, v2 왕복은 카드 불변, 누락·변조 카드는 거부',async()=>{
  const {repo,command}=await setup();value(await repo.collect(command));
  const backup=value(await repo.exportRecords(command.ownerId));const parsed=JSON.parse(await backup.text());
  const target=new IndexedDbDexRepository({factory:new IDBFactory()});value(await target.open());
  const preview=value(await target.previewImport(backup));value(await target.commitImport({token:preview.token,strategy:'replace',confirmed:true}));
  assert.deepEqual(value(await target.snapshot()).experiences,value(await repo.snapshot()).experiences);
  const legacy=structuredClone(parsed);legacy.schemaVersion=1;delete legacy.data.experiences[0].card;
  const oldPreview=value(await target.previewImport(new Blob([JSON.stringify(legacy)])));value(await target.commitImport({token:oldPreview.token,strategy:'replace',confirmed:true}));
  assert.equal(value(await target.snapshot()).experiences[0].card!.edition,'NORMAL');
  const missing=structuredClone(parsed);delete missing.data.experiences[0].card;error(await target.previewImport(new Blob([JSON.stringify(missing)])),'INVALID_BACKUP');
  const bad=structuredClone(parsed);bad.data.experiences[0].card.id='other';error(await target.previewImport(new Blob([JSON.stringify(bad)])),'INVALID_BACKUP');repo.close();target.close();
});
test('경험 수정은 카드 불변, 삭제는 연결 카드만 제거하고 재전송 재지급 차단',async()=>{
  const {repo,command}=await setup();const a=value(await repo.collect(command)),b=value(await repo.collect({...command,requestId:'visit2'}));
  const updated=value(await repo.updateExperience(command.ownerId,a.experience.id,1,{note:'좋아요',experiencedOn:'2026-11-12',rating:5}));assert.deepEqual(updated.card,a.experience.card);
  error(await repo.updateExperience(command.ownerId,a.experience.id,updated.revision,{card:{edition:'GOLDEN'}} as never),'INVALID_INPUT');
  value(await repo.deleteExperience(command.ownerId,a.experience.id,updated.revision));error(await repo.collect(command),'RESULT_DELETED');
  const doc=value(await repo.snapshot());assert.equal(doc.entries.length,1);assert.equal(doc.experiences.length,1);assert.deepEqual(doc.experiences[0].card,b.experience.card);assert.equal(doc.receipts.length,2);repo.close();
});

test('이전 기록 NORMAL 보존 중 저장 실패해도 원본을 삭제하거나 반쪽 이전하지 않는다',async()=>{
  const {repo,factory,command}=await setup();const first=value(await repo.collect(command));repo.close();
  const legacy=structuredClone(first.experience);delete legacy.card;await mutateRaw(factory,'experiences',store=>store.put(legacy));
  const failed=new IndexedDbDexRepository({factory,beforeCommit:()=>{throw Error('migration write failed');}});
  error(await failed.open(),'STORAGE_UNAVAILABLE');const recovery=JSON.parse(await value(await failed.exportRecovery()).text());assert.deepEqual(recovery.raw.experiences,[legacy]);failed.close();
  const good=new IndexedDbDexRepository({factory});value(await good.open());const migrated=value(await good.snapshot()).experiences[0];assert.equal(migrated.card!.edition,'NORMAL');assert.equal(migrated.id,legacy.id);good.close();
});
