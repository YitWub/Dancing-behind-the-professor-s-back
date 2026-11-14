import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialDocument,applyCollection} from '../../core/engine.ts';
import {collectInput,fingerprint} from '../../core/validation.ts';
import {buildMealCollection,queryMealCollection,mealDetailHref} from '../card-view.ts';
import {splitMenuLabel} from '../presentation.ts';
async function fixture(count=3){
  let n=0;const runtime={id:()=>`test-${++n}`,now:()=> '2026-11-14T12:00:00.000Z',cardRoll:()=>.1};const doc=initialDocument(runtime,'personal');
  for(let i=0;i<count;i++){
    const input=collectInput({ownerId:doc.profile.ownerId,dexId:doc.dexes[0].id,requestId:'req-'+i,subject:{kind:'meal',dishId:i%2?'dish-b':'dish-a',displayNameSnapshot:i%2?'치즈돈가스':'만두카츠&소스 Fried Dumplings Cutlet & Sauce'},experience:{kind:'meal',experiencedOn:'2026-11-14',rating:null,note:'',offeringId:'offering-'+i,context:{date:'2026-11-14',cafeteria:'haksik',mealTime:'lunch',legacyMealItemId:'old-'+i,source:'https://life.hanyang.ac.kr',snapshot:{name:'원문',menu:['밥'],price:5000,kcal:null,imageUrl:null,imageSourceUrl:null}}}});
    applyCollection(doc,input,await fingerprint(input),{...runtime,cardRoll:()=>[.1,.7,.9,.99][i%4]});
  }
  return doc;
}
test('개인 실제 스냅샷에서 메뉴는 dishId로 묶고 경험마다 카드 하나를 읽는다',async()=>{
  const doc=await fixture(100),before=structuredClone(doc),model=buildMealCollection(doc);
  assert.equal(model.menus.length,2);assert.equal(model.cards.length,100);assert.equal(model.menus[0].cards.length,50);assert.deepEqual(doc,before);
  assert.ok(model.cards.every(c=>c.card.id==='card-v1:'+c.experience.id));
});
test('다른 학식도감의 같은 메뉴도 중복 표시하지 않고 원래 등록·경험 링크를 유지한다',async()=>{
  const doc=await fixture();const extra={...structuredClone(doc.dexes[0]),id:'second-dex'};doc.dexes.push(extra);
  const entry={...structuredClone(doc.entries[0]),id:'second-entry',dexId:extra.id};doc.entries.push(entry);
  const exp={...structuredClone(doc.experiences[0]),id:'second-exp',entryId:entry.id,dexId:extra.id,card:undefined};doc.experiences.push(exp);
  const model=buildMealCollection(doc),menu=model.menus.find(m=>m.dishId==='dish-a')!;assert.equal(model.menus.length,2);assert.equal(menu.entryIds.length,2);assert.equal(menu.cards.length,3);
  const added=menu.cards.find(c=>c.experience.id==='second-exp')!;assert.equal(added.card.edition,'NORMAL');assert.ok(mealDetailHref(added).includes('second-entry?experience=second-exp'));
});
test('최고 에디션·획득일·카드 ID 기준 대표 선택은 배열 순서가 달라도 고정',async()=>{
  const doc=await fixture(8);const first=buildMealCollection(doc);const reversed=structuredClone(doc);reversed.entries.reverse();reversed.experiences.reverse();
  assert.deepEqual(buildMealCollection(reversed),first);assert.equal(first.menus.find(m=>m.dishId==='dish-b')!.representative!.card.edition,'GOLDEN');
});
test('다른 소유자·개발 namespace를 제외하고 카드가 없는 메뉴 등록도 보존한다',async()=>{
  const doc=await fixture();const extra={...structuredClone(doc.entries[0]),id:'foreign',ownerId:'other'};doc.entries.push(extra);
  const foreign={...structuredClone(doc.experiences[0]),id:'foreign-exp',ownerId:'other'};doc.experiences.push(foreign);
  assert.equal(buildMealCollection(doc).cards.length,3);doc.profile.namespace='development';assert.equal(buildMealCollection(doc).cards.length,0);doc.profile.namespace='personal';doc.experiences=[];
  const model=buildMealCollection(doc);assert.equal(model.menus.length,2);assert.ok(model.menus.every(m=>m.representative===null));assert.equal(model.cards.length,0);
});
test('검색·정렬·필터는 기록을 변경하지 않고 메뉴 필터와 카드 필터를 구분한다',async()=>{
  const doc=await fixture(8),model=buildMealCollection(doc),before=structuredClone(doc);
  const golden=queryMealCollection(model,{sort:'edition',search:'치즈',edition:'GOLDEN'});assert.equal(golden.menus.length,1);assert.equal(golden.cards.length,2);assert.equal(golden.menus[0].cards.length,4);
  const empty=queryMealCollection(model,{sort:'recent',search:'없는음식',edition:'all'});assert.equal(empty.cards.length,0);
  for(const sort of ['recent','edition','name','visits'] as const)assert.equal(queryMealCollection(model,{sort,search:'',edition:'all'}).cards.length,8);
  assert.deepEqual(doc,before);
});
test('표시는 확정된 영문 번역만 분리하고 원문·혼합 이름·불명확한 문구는 유지',()=>{
  const raw='만두카츠&소스 Fried Dumplings Cutlet & Sauce';assert.equal(splitMenuLabel(raw).title,'만두카츠&소스');assert.equal(splitMenuLabel(raw).original,raw);
  assert.equal(splitMenuLabel('가츠동 (Katsudon(Pork Cutlet Over Rice))').title,'가츠동');
  for(const name of ['BBQ 치킨','LA 갈비','치킨 BBQ','제육볶음 Spicy Special Menu','Pasta (Special)','제육볶음(매운맛)'])assert.equal(splitMenuLabel(name).title,name);
});
