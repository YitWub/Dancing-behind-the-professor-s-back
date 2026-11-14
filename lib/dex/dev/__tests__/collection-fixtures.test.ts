import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_WEIGHTS, EDITION_RANK, generateCollectionPreview, groupPreviewMenus, sortPreviewCards, sortPreviewMenus, validWeights } from '../collection-fixtures.ts';
import type { FixtureSettings, CollectionSort } from '../collection-fixtures.ts';
import { CARD_EDITION_POLICY } from '../../meal/card-editions.ts';
const defaults:FixtureSettings={count:30,uniqueMenus:5,seed:'BOKAK-45A',weights:{...DEFAULT_WEIGHTS}};
test('모든 카드 수에서 요청한 고유 메뉴를 보장하고 입력을 변경하지 않는다',()=>{
  const before=structuredClone(defaults);
  for(const count of [1,5,30,50,100])for(const uniqueMenus of [1,count]){
    const cards=generateCollectionPreview({...defaults,count,uniqueMenus});assert.equal(cards.length,count);assert.equal(new Set(cards.map(c=>c.dishId)).size,uniqueMenus);assert.equal(new Set(cards.map(c=>c.card.id)).size,count);assert.ok(cards.every(c=>c.card.id.startsWith('preview-')));
  }
  assert.deepEqual(defaults,before);
});
test('같은 시드는 같은 결과, 다른 시드는 다른 결과이며 메뉴에 여러 에디션이 섞인다',()=>{
  const a=generateCollectionPreview(defaults);assert.deepEqual(a,generateCollectionPreview(structuredClone(defaults)));assert.notDeepEqual(a,generateCollectionPreview({...defaults,seed:'another'}));
  assert.ok(groupPreviewMenus(a).some(menu=>new Set(menu.cards.map(c=>c.card.edition)).size>=3));
});
test('100장 기본 비중은 60/27/10/3, GOLDEN 전용 실험도 실제 정책은 불변',()=>{
  const before=structuredClone(CARD_EDITION_POLICY);const cards=generateCollectionPreview({...defaults,count:100});
  for(const [edition,n] of Object.entries(DEFAULT_WEIGHTS))assert.equal(cards.filter(c=>c.card.edition===edition).length,n);
  const golden=generateCollectionPreview({...defaults,weights:{NORMAL:0,SPECIAL:0,RARE:0,GOLDEN:100}});assert.ok(golden.every(c=>c.card.edition==='GOLDEN'));assert.deepEqual(CARD_EDITION_POLICY,before);
});
test('잘못된 비중·분수 메뉴 수·카드 범위는 안전하게 거부한다',()=>{
  assert.equal(validWeights({...DEFAULT_WEIGHTS,NORMAL:59}),false);
  for(const patch of [{count:0},{count:101},{uniqueMenus:0},{uniqueMenus:31},{uniqueMenus:1.5},{weights:{NORMAL:-1,SPECIAL:88,RARE:10,GOLDEN:3}}])assert.throws(()=>generateCollectionPreview({...defaults,...patch}));
});
test('메뉴 묶음은 최고 에디션을 대표로 사용하며 날짜·카드 수를 보존한다',()=>{
  const cards=generateCollectionPreview(defaults),menus=groupPreviewMenus(cards);assert.equal(menus.length,5);assert.equal(menus.reduce((n,m)=>n+m.cards.length,0),30);
  for(const menu of menus)assert.equal(EDITION_RANK[menu.representative.card.edition],Math.max(...menu.cards.map(c=>EDITION_RANK[c.card.edition])));
});
test('정렬 4종은 원본·카드 식별자를 보존하고 비교 기준을 실제 반영한다',()=>{
  const cards=generateCollectionPreview({...defaults,count:100}),before=structuredClone(cards),menus=groupPreviewMenus(cards);
  for(const sort of ['recent','edition','name','visits'] as CollectionSort[]){
    const sorted=sortPreviewCards(cards,sort),groups=sortPreviewMenus(menus,sort);assert.equal(sorted.length,100);assert.equal(new Set(sorted.map(c=>c.card.id)).size,100);
    for(let i=1;i<sorted.length;i++){
      const a=sorted[i-1],b=sorted[i];
      if(sort==='recent')assert.ok(a.card.acquiredAt>=b.card.acquiredAt);
      if(sort==='edition')assert.ok(EDITION_RANK[a.card.edition]>=EDITION_RANK[b.card.edition]);
      if(sort==='name')assert.ok(a.name.localeCompare(b.name,'ko')<=0);
      if(sort==='visits')assert.ok(menus.find(m=>m.dishId===a.dishId)!.cards.length>=menus.find(m=>m.dishId===b.dishId)!.cards.length);
    }
    for(let i=1;i<groups.length;i++){const a=groups[i-1],b=groups[i];if(sort==='edition')assert.ok(EDITION_RANK[a.representative.card.edition]>=EDITION_RANK[b.representative.card.edition]);if(sort==='visits')assert.ok(a.cards.length>=b.cards.length);if(sort==='recent')assert.ok(a.cards[0].card.acquiredAt>=b.cards[0].card.acquiredAt);if(sort==='name')assert.ok(a.name.localeCompare(b.name,'ko')<=0);}
  }
  assert.deepEqual(cards,before);
});
