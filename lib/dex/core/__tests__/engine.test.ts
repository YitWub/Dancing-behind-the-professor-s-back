import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { canonical, collectInput, fingerprint, parseBackup } from '../validation.ts';
import { applyCollection, initialDocument, collectMeal } from '../engine.ts';
import type { CollectCommand, CollectMealCommand, DexRepository } from '../types.ts';

test('정렬 직렬화와 SHA-256은 필드 순서에 독립적이고 내용 변경을 구분한다',async()=>{
  assert.equal(canonical({z:1,a:{y:2,x:3}}),canonical({a:{x:3,y:2},z:1}));
  assert.equal(await fingerprint({a:1,b:2}),await fingerprint({b:2,a:1}));
  assert.notEqual(await fingerprint({a:1}),await fingerprint({a:2}));
});
test('공통 엔진은 최초·재방문·재전송 결과만 반환하며 이름으로 인연을 합치지 않는다',async()=>{
  let sequence=0;
  const runtime={id:()=>`id-${++sequence}`,now:()=> '2026-11-13T00:00:00.000Z'};
  const doc=initialDocument(runtime,'personal');
  const command:CollectCommand={ownerId:doc.profile.ownerId,dexId:doc.dexes[1].id,requestId:'request1',subject:{kind:'person',displayName:'같은 별명'},experience:{kind:'person',event:'first-met',experiencedOn:'2026-11-13'}};
  const input=collectInput(command);
  const first=applyCollection(doc,input,await fingerprint(input),runtime);
  assert.equal(first.value.outcome,'new-entry');assert.ok(first.value.discovery);
  const replay=applyCollection(doc,input,await fingerprint(input),runtime);
  assert.equal(replay.changed,false);assert.equal(replay.value.replayed,true);assert.equal(replay.value.discovery,null);
  const next=collectInput({...command,requestId:'request2'});
  applyCollection(doc,next,await fingerprint(next),runtime);
  assert.equal(doc.entries.length,2);
  const revisit=collectInput({...command,entryId:first.value.entry.id,requestId:'request3'});
  assert.equal(applyCollection(doc,revisit,await fingerprint(revisit),runtime).value.outcome,'revisit');
  assert.equal(doc.entries.length,2);assert.equal(doc.experiences.length,3);
});
test('인연 별점·가짜 날짜·추가 필드를 런타임에서 거부한다',()=>{
  const good={ownerId:'owner',dexId:'dex',requestId:'r',subject:{kind:'person',displayName:'별명'},experience:{kind:'person',event:'memory',experiencedOn:'2026-11-13'}};
  assert.throws(()=>collectInput({...good,experience:{...good.experience,rating:5}}));
  assert.throws(()=>collectInput({...good,experience:{...good.experience,experiencedOn:'2026-02-30'}}));
  assert.throws(()=>collectInput({...good,subject:{...good.subject,phone:'010'}}));
  assert.throws(()=>parseBackup('{broken'));
});
test('학식 포트는 미식별/예시 메뉴를 저장소 호출 전에 차단한다',async()=>{
  const repository={collect:async()=>{throw Error('must not call storage');}} as unknown as DexRepository;
  const command={selection:{dishId:'d',dishName:'테스트',offering:{resolution:{state:'unresolved'}}}} as unknown as CollectMealCommand;
  const unresolved=await collectMeal(command,repository);assert.equal(unresolved.ok,false);
  const demo={...command,selection:{...command.selection,offering:{resolution:{state:'resolved',dishId:'d'},provenance:{mode:'seed'}}}} as unknown as CollectMealCommand;
  const result=await collectMeal(demo,repository);assert.equal(result.ok,false);if(!result.ok)assert.equal(result.error.code,'DEMO_DATA');
});
