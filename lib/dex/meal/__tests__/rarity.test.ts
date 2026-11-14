import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { assessMealRarity, unknownMealRarity } from '../rarity.ts';
import type { MealObservation, ObservationScope, RarityPolicy } from '../rarity.ts';
import { mealAchievements } from '../game.ts';
import type { DexDocument } from '../../core/types.ts';

// TEST ONLY: these boundaries are never imported by application code or assigned to real dishes.
const fixturePolicy:RarityPolicy={status:'approved',version:'TEST-FIXTURE-NOT-PRODUCTION',minimumUnits:20,minimumDates:20,maximumFrequency:{LEGENDARY:.05,RARE:.2,UNCOMMON:.5}};
const scope:ObservationScope={cafeterias:['haksik'],mealTimes:['lunch'],from:'2026-11-01',through:'2026-11-30'};
const observations:MealObservation[]=Array.from({length:20},(_,i)=>{const day=`2026-11-${String(i+1).padStart(2,'0')}`;return {date:day,cafeteria:'haksik',mealTime:'lunch',source:'https://life.hanyang.ac.kr/menu',observedAt:day+'T01:00:00Z',state:'complete',identitiesResolved:true,dishIds:['common',...(i<10?['uncommon']:[]),...(i<4?['rare']:[]),...(i===0?['legendary','legendary']:[])]};});
test('확정 운영 기준이 없으면 표본이 많아도 UNKNOWN이며 fixture로만 4등급 계약을 검증한다',()=>{
  assert.equal(assessMealRarity('legendary',observations,scope,'2026-11-30').tier,'UNKNOWN');
  for(const [dish,tier] of [['legendary','LEGENDARY'],['rare','RARE'],['uncommon','UNCOMMON'],['common','COMMON']]){const result=assessMealRarity(dish,observations,scope,'2026-11-30',fixturePolicy);assert.equal(result.tier,tier);assert.equal(result.confirmed,true);assert.equal(result.validUnits,20);}
  assert.equal(assessMealRarity('never-seen',observations,scope,'2026-11-30',fixturePolicy).tier,'UNKNOWN');
  assert.equal(assessMealRarity('legendary',observations.slice(0,2),scope,'2026-11-30',fixturePolicy).tier,'UNKNOWN');
});
test('실패·부분·휴무·미해결·범위 밖·미래 관측은 분모가 아니며 반복 수집은 중복 집계하지 않는다',()=>{
  const extra=observations[0];
  const invalid:MealObservation[]=[{...extra,date:'2026-11-21',state:'failed'},{...extra,date:'2026-11-22',state:'partial'},{...extra,date:'2026-11-23',state:'closed'},{...extra,date:'2026-11-24',identitiesResolved:false},{...extra,date:'2026-11-25',cafeteria:'dorm'},{...extra,date:'2026-11-26',mealTime:'dinner'},{...extra,date:'2026-11-27',source:'https://example.test'},{...extra,date:'2026-12-01'},{...extra,date:'2026-11-28',observedAt:'2099-01-01T00:00:00Z'}];
  const result=assessMealRarity('legendary',[...observations,...observations,...invalid,{...extra,state:'failed',observedAt:'2026-11-01T03:00:00Z'}],scope,'2026-11-30',fixturePolicy);
  assert.equal(result.validUnits,20);assert.equal(result.appearances,1);assert.equal(result.frequency,1/20);
  const closed=assessMealRarity('common',[...observations,{...extra,state:'closed',observedAt:'2026-11-01T03:00:00Z'}],scope,'2026-11-30',fixturePolicy);assert.equal(closed.validUnits,19);assert.equal(closed.tier,'UNKNOWN');
  const ambiguous=assessMealRarity('legendary',[...observations,{...extra,dishIds:['different']}],scope,'2026-11-30',fixturePolicy);assert.equal(ambiguous.validUnits,19);assert.equal(ambiguous.tier,'UNKNOWN');
});
test('확정 등급 fixture일 때만 희귀 업적이 진행되고 UNKNOWN이 섞이면 준비 중으로 구분한다',()=>{
  const ownerId='fixture';
  const document={profile:{ownerId},dexes:[{id:'meal',kind:'meal',ownerId}],entries:['rare','legendary','uncommon'].map((dishId,i)=>({id:'entry'+i,ownerId,dexId:'meal',subject:{kind:'meal',dishId,displayNameSnapshot:dishId},firstCollectedAt:'2026-11-01T00:00:00Z'})),experiences:[],receipts:[]} as unknown as DexDocument;
  const provider=(dishId:string)=>assessMealRarity(dishId,observations,scope,'2026-11-30',fixturePolicy);
  assert.equal(mealAchievements(document,provider).find(a=>a.id==='meal:rare-three')!.progress,2);assert.equal(mealAchievements(document,provider).find(a=>a.id==='meal:legendary')!.status,'achieved');
  assert.equal(mealAchievements(document,dishId=>dishId==='uncommon'?unknownMealRarity(dishId):provider(dishId)).find(a=>a.id==='meal:rare-three')!.status,'preparing');
});
