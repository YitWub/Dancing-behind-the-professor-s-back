import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbDexRepository } from '../../storage/indexeddb.ts';
import type { CollectCommand, Result } from '../../core/types.ts';
import { saveMealRating } from '../quick-rating.ts';
import { splitMenuLabel } from '../presentation.ts';

function value<T>(result:Result<T>):T{if(!result.ok)throw Error(result.error.code);return result.value;}
async function prepare(){
  const repo=new IndexedDbDexRepository({factory:new IDBFactory()});
  const profile=value(await repo.open()),doc=value(await repo.snapshot());
  const command:CollectCommand={ownerId:profile.ownerId,dexId:doc.dexes.find(d=>d.kind==='meal')!.id,requestId:'first',subject:{kind:'meal',dishId:'stable-dish',displayNameSnapshot:'들기름막국수'},experience:{kind:'meal',experiencedOn:'2026-11-04',rating:null,note:'',offeringId:'offering',context:{date:'2026-11-04',cafeteria:'haksik',mealTime:'lunch',legacyMealItemId:'legacy',source:'https://life.hanyang.ac.kr/theme/pages/home.php',snapshot:{name:'들기름막국수 (Perilla Oil Noodles)',menu:['밥'],price:4500,kcal:null,imageUrl:null,imageSourceUrl:null}}}};
  const first=value(await repo.collect(command));if(first.experience.kind!=='meal')throw Error('fixture');
  return {repo,command,first,experience:first.experience};
}
test('수집 후 빠른 평가는 생성된 경험만 수정하고 카드·요청 영수증은 보존한다',async()=>{
  const {repo,experience}=await prepare();try{
    const before=value(await repo.snapshot());const updated=value(await saveMealRating(repo,experience,{rating:4,note:'다시 먹고 싶은 한 끼'}));
    const after=value(await repo.snapshot());assert.equal(updated.id,experience.id);assert.equal(after.entries.length,1);assert.equal(after.experiences.length,1);assert.deepEqual(after.entries,before.entries);assert.deepEqual(after.receipts,before.receipts);assert.equal(after.experiences[0].note,'다시 먹고 싶은 한 끼');assert.equal(updated.revision,experience.revision+1);
  }finally{repo.close();}
});
test('재방문 빠른 평가는 이번 경험에만 연결하고 이전 별점은 유지한다',async()=>{
  const {repo,command,experience}=await prepare();try{
    value(await saveMealRating(repo,experience,{rating:5,note:'첫 식사'}));const visit=value(await repo.collect({...command,requestId:'second'}));if(visit.experience.kind!=='meal')throw Error('fixture');
    value(await saveMealRating(repo,visit.experience,{rating:3,note:'두 번째 식사'}));const doc=value(await repo.snapshot());assert.equal(doc.entries.length,1);assert.equal(doc.experiences.length,2);assert.equal(doc.experiences.find(e=>e.id===experience.id)?.note,'첫 식사');assert.equal(doc.experiences.find(e=>e.id===visit.experience.id)?.note,'두 번째 식사');
  }finally{repo.close();}
});
test('평가 실패·revision 충돌은 수집 성공을 취소하거나 입력 draft를 변형하지 않는다',async()=>{
  const {repo,experience}=await prepare();try{
    const draft={rating:4 as const,note:'실패해도 남겨야 할 입력'};const before=value(await repo.snapshot());
    const failed=await saveMealRating({updateExperience:async()=>{throw Error('offline');}},experience,draft);assert.equal(failed.ok,false);assert.deepEqual(value(await repo.snapshot()),before);assert.equal(draft.note,'실패해도 남겨야 할 입력');
    value(await saveMealRating(repo,experience,{rating:2,note:'다른 편집'}));const conflict=await saveMealRating(repo,experience,draft);assert.equal(conflict.ok,false);if(!conflict.ok)assert.equal(conflict.error.code,'REVISION_CONFLICT');assert.equal(value(await repo.snapshot()).entries.length,1);assert.equal(draft.rating,4);
  }finally{repo.close();}
});
test('표시용 영문 분리는 원문을 보존하고 한국어 괄호·불확실한 병기는 유지한다',()=>{
  const original='들기름막국수 (Perilla Oil Noodles)';assert.deepEqual(splitMenuLabel(original),{title:'들기름막국수',translation:'Perilla Oil Noodles',original});
  for(const text of ['제육볶음(매운맛)','소고기육개장 Spicy Beef Soup','Pasta (Special)'])assert.equal(splitMenuLabel(text).title,text);
});
