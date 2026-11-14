import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbDexRepository } from '../../storage/indexeddb.ts';
import type { CollectCommand, Result } from '../../core/types.ts';
import { mealAchievements, mealGameNotices, mealPersonalCards, mealPersonalHighlights } from '../game.ts';
import { unknownMealRarity } from '../rarity.ts';
import { claimGameNotices } from '../../game/notices.ts';

function value<T>(result:Result<T>):T{if(!result.ok)throw Error(result.error.code);return result.value;}
async function setup(){
  let tick=Date.parse('2026-11-14T02:00:00Z');
  const repo=new IndexedDbDexRepository({factory:new IDBFactory(),runtime:{id:()=>crypto.randomUUID(),now:()=>new Date(tick++).toISOString()}});
  const profile=value(await repo.open()),doc=value(await repo.snapshot()),dexId=doc.dexes.find(d=>d.kind==='meal')!.id;
  function command(dishId='dish-1',day='2026-11-04',cafeteria:'haksik'|'dorm'|'faculty'='haksik'):CollectCommand{return {ownerId:profile.ownerId,dexId,requestId:crypto.randomUUID(),subject:{kind:'meal',dishId,displayNameSnapshot:dishId},experience:{kind:'meal',experiencedOn:day,rating:null,note:'',offeringId:'offering-'+dishId,context:{date:day,cafeteria,mealTime:'lunch',legacyMealItemId:'legacy',source:'https://life.hanyang.ac.kr/theme/pages/home.php',snapshot:{name:dishId,menu:['밥'],price:4500,kcal:null,imageUrl:null,imageSourceUrl:null}}}};}
  return {repo,command,ownerId:profile.ownerId};
}
test('첫 수집·오늘의 첫 등록·첫 업적은 저장된 기록으로 판정하며 재전송·실패는 알림이 없다',async()=>{
  const {repo,command}=await setup();try{
    const cmd=command(),result=await repo.collect(cmd);const after=value(await repo.snapshot());
    assert.equal(mealAchievements(after)[0].status,'achieved');
    const notices=mealGameNotices(after,result,'2026-11-14');assert.ok(notices.some(n=>n.title==='첫 번째 발견'));assert.ok(notices.some(n=>n.title==='오늘의 첫 발견'));assert.ok(notices.some(n=>n.kind==='achievement'&&n.title==='첫 발견'));
    assert.deepEqual(mealGameNotices(after,await repo.collect(cmd),'2026-11-14'),[]);
    assert.deepEqual(mealGameNotices(after,{ok:false,error:{code:'STORAGE_UNAVAILABLE',message:'fail'}},'2026-11-14'),[]);
    assert.ok(!mealGameNotices(after,result,'2026-11-15').some(n=>n.title==='오늘의 첫 발견'),'식사일을 오늘 등록일로 혼동하지 않는다');
  }finally{repo.close();}
});
test('서로 다른 메뉴·식당 진행률과 삭제 후 상태를 실제 기록에서 다시 계산한다',async()=>{
  const {repo,command}=await setup();try{
    for(let i=1;i<=5;i++)value(await repo.collect(command('dish-'+i,'2026-11-04',i===1?'dorm':i===2?'faculty':'haksik')));
    let doc=value(await repo.snapshot());assert.equal(mealAchievements(doc).find(a=>a.id==='meal:five')!.status,'achieved');assert.equal(mealAchievements(doc).find(a=>a.id==='meal:explorer')!.progress,3);
    const entry=doc.entries[0];value(await repo.deleteEntry(doc.profile.ownerId,entry.id,entry.revision));doc=value(await repo.snapshot());assert.equal(mealAchievements(doc).find(a=>a.id==='meal:five')!.progress,4);assert.equal(mealAchievements(doc).find(a=>a.id==='meal:five')!.status,'locked');
    assert.ok(mealAchievements(doc).every(a=>a.achievedAt===null));
  }finally{repo.close();}
});
test('같은 날 반복 5회는 단골이 아니며 서로 다른 날 5일·10일에만 칭호가 열린다',async()=>{
  const {repo,command}=await setup();try{
    for(let i=0;i<5;i++)value(await repo.collect(command()));
    let doc=value(await repo.snapshot());assert.equal(doc.entries.length,1);assert.equal(doc.experiences.length,5);assert.equal(mealPersonalCards(doc)[0].distinctDays,1);assert.equal(mealAchievements(doc).find(a=>a.id==='meal:regular')!.progress,1);
    for(let day=5;day<=8;day++){const result=await repo.collect(command('dish-1',`2026-11-${String(day).padStart(2,'0')}`));doc=value(await repo.snapshot());const notices=mealGameNotices(doc,result,'2026-11-14');assert.equal(notices.some(n=>n.title==='돌아온 단골손님'),day===8);}
    for(let day=9;day<=13;day++){const result=await repo.collect(command('dish-1',`2026-11-${String(day).padStart(2,'0')}`));doc=value(await repo.snapshot());assert.equal(mealGameNotices(doc,result,'2026-11-14').some(n=>n.title==='나의 소울푸드'),day===13);}
    assert.equal(mealPersonalCards(doc)[0].affection,'soul');assert.equal(mealAchievements(doc).find(a=>a.id==='meal:soul')!.status,'achieved');
    const duplicate=await repo.collect(command('dish-1','2026-11-13'));assert.ok(!mealGameNotices(value(await repo.snapshot()),duplicate,'2026-11-14').some(n=>n.title==='나의 소울푸드'));
  }finally{repo.close();}
});
test('경험 날짜 수정·삭제는 서로 다른 날 업적을 되돌리고 수집 카드 자체는 남긴다',async()=>{
  const {repo,command}=await setup();try{
    for(let day=1;day<=5;day++)value(await repo.collect(command('dish-1',`2026-11-0${day}`)));
    let doc=value(await repo.snapshot());const exp=doc.experiences.find(e=>e.experiencedOn==='2026-11-05')!;value(await repo.updateExperience(doc.profile.ownerId,exp.id,exp.revision,{experiencedOn:'2026-11-04'}));
    doc=value(await repo.snapshot());assert.equal(mealPersonalCards(doc)[0].affection,null);assert.equal(mealAchievements(doc).find(a=>a.id==='meal:regular')!.progress,4);
    for(const e of doc.experiences)value(await repo.deleteExperience(doc.profile.ownerId,e.id,e.revision));doc=value(await repo.snapshot());assert.equal(mealAchievements(doc)[0].status,'achieved');assert.equal(mealPersonalCards(doc)[0].distinctDays,0);
  }finally{repo.close();}
});
test('같은 dishId의 여러 개인 도감 카드는 메뉴 종류 업적을 중복 증가시키지 않는다',async()=>{
  const {repo,command,ownerId}=await setup();try{
    value(await repo.collect(command()));const second=value(await repo.createDex(ownerId,{kind:'meal',name:'다른 학식도감',icon:'meal'}));const result=await repo.collect({...command(),dexId:second.id});const doc=value(await repo.snapshot());assert.equal(doc.entries.length,2);assert.equal(mealPersonalCards(doc).length,1);assert.equal(mealAchievements(doc).find(a=>a.id==='meal:five')!.progress,1);assert.equal(mealGameNotices(doc,result,'2026-11-14').length,0);
  }finally{repo.close();}
});
test('UNKNOWN은 희귀 업적 진행률을 만들지 않고 개인 평가 부재·동률을 꾸미지 않는다',async()=>{
  const {repo,command,ownerId}=await setup();try{
    const a=value(await repo.collect(command('a'))),b=value(await repo.collect(command('b')));let doc=value(await repo.snapshot());
    assert.equal(mealAchievements(doc).find(a=>a.id==='meal:rare-three')!.progress,null);assert.equal(mealAchievements(doc).find(a=>a.id==='meal:legendary')!.status,'preparing');assert.equal(unknownMealRarity('a').tier,'UNKNOWN');
    let highlights=mealPersonalHighlights(doc,'2026-11-14');assert.equal(highlights.most.length,2);assert.equal(highlights.highestRated.length,0);
    value(await repo.updateExperience(ownerId,a.experience.id,a.experience.revision,{rating:4}));value(await repo.updateExperience(ownerId,b.experience.id,b.experience.revision,{rating:4}));doc=value(await repo.snapshot());highlights=mealPersonalHighlights(doc,'2026-11-14');assert.equal(highlights.highestRated.length,2);assert.equal(mealPersonalHighlights(doc,'2027-01-01').recent.length,0);
  }finally{repo.close();}
});
test('업적 계산은 내보내기·가져오기·재연결 이후 동일하고 개인 저장 문서를 변경하지 않는다',async()=>{
  const {repo,command,ownerId}=await setup();const restored=new IndexedDbDexRepository({factory:new IDBFactory()});try{
    value(await repo.collect(command()));const doc=value(await repo.snapshot()),copy=structuredClone(doc);mealAchievements(doc);mealPersonalCards(doc);assert.deepEqual(doc,copy);
    const backup=value(await repo.exportRecords(ownerId));value(await restored.open());const preview=value(await restored.previewImport(backup));value(await restored.commitImport({token:preview.token,strategy:'replace',confirmed:true}));const actual=value(await restored.snapshot());assert.deepEqual(mealAchievements(actual),mealAchievements(doc));restored.close();value(await restored.open());assert.deepEqual(mealAchievements(value(await restored.snapshot())),mealAchievements(doc));
  }finally{repo.close();restored.close();}
});
test('확인한 알림은 재전송·다른 이벤트·다시 조건 충족에서도 반복하지 않으며 진행률을 저장하지 않는다',()=>{
  const data=new Map<string,string>();const storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);}};
  const notices=[{id:'achievement:meal:first',kind:'achievement' as const,title:'첫 발견',description:'1종'}];
  assert.equal(claimGameNotices('owner','event',notices,storage).length,1);assert.deepEqual(claimGameNotices('owner','event',notices,storage),[]);assert.deepEqual(claimGameNotices('owner','new-event',notices,storage),[]);assert.equal(claimGameNotices('another-owner','event',notices,storage).length,1);
  assert.ok(![...data.values()].join('').includes('progress'));assert.deepEqual(claimGameNotices('owner','fail',notices,{getItem:()=>{throw Error('blocked');},setItem:()=>{}}),[]);
});
