import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { DexDocument, Rating } from '../../core/types.ts';
import { mealHighlightSlots } from '../../../../components/dex/meal/highlight-view.ts';
import { mealAchievements } from '../game.ts';
function fixture(specs:{id:string;count:number;rating?:Rating;days?:string[]}[]):DexDocument{
  return {profile:{ownerId:'owner'},dexes:[{id:'meal',ownerId:'owner',kind:'meal'}],receipts:[],entries:specs.map((spec,i)=>({id:'entry-'+spec.id,ownerId:'owner',dexId:'meal',subject:{kind:'meal',dishId:spec.id,displayNameSnapshot:spec.id},firstCollectedAt:`2026-11-${String(i+1).padStart(2,'0')}T00:00:00Z`})),experiences:specs.flatMap(spec=>Array.from({length:spec.count},(_,i)=>({id:spec.id+'-'+i,kind:'meal',entryId:'entry-'+spec.id,ownerId:'owner',dexId:'meal',experiencedOn:spec.days?.[i]??'2026-11-14',createdAt:'2026-11-14T01:00:00Z',rating:spec.rating??null,note:'',context:{cafeteria:'haksik'}})))} as unknown as DexDocument;
}
test('모두 1회인 초기 상태는 단골 탐색·미평가 빈 상태와 최근 발견 카드를 표시한다',()=>{
  const slots=mealHighlightSlots(fixture([{id:'a',count:1},{id:'b',count:1}]),'2026-11-14');
  assert.equal(slots[0].card,null);assert.equal(slots[0].emptyTitle,'단골 메뉴 탐색 중');assert.equal(slots[1].card,null);assert.equal(slots[2].card!.dishId,'a');assert.equal(slots[2].memorial,true);assert.equal(slots[3].title,'최근 발견한 카드');assert.equal(slots[3].card!.dishId,'b');
});
test('반복·별점 공동 1위는 대표 카드와 외 N종으로 표시하고 실제 entryId를 유지한다',()=>{
  const slots=mealHighlightSlots(fixture([{id:'a',count:2,rating:4},{id:'b',count:2,rating:4},{id:'c',count:1,rating:2}]),'2026-11-14');
  assert.equal(slots[0].card!.dishId,'a');assert.equal(slots[0].others,1);assert.equal(slots[0].metric,'먹은 기록 2회');assert.equal(slots[1].others,1);assert.equal(slots[1].metric,'대표 별점 4 / 5');assert.equal(slots[1].card!.entryIds[0],'entry-a');
});
test('최근 30일의 뚜렷한 반복만 강조하고 과거 총횟수를 최근 횟수로 표시하지 않는다',()=>{
  const clear=mealHighlightSlots(fixture([{id:'a',count:3},{id:'b',count:1}]),'2026-11-14');assert.equal(clear[3].title,'요즘 자주 만나는 메뉴');assert.equal(clear[3].metric,'최근 30일 3회');
  const unclear=mealHighlightSlots(fixture([{id:'a',count:3,days:['2026-10-01','2026-10-02','2026-11-14']},{id:'b',count:1}]),'2026-11-14');assert.equal(unclear[3].title,'최근 발견한 카드');assert.equal(unclear[3].card!.dishId,'b');
});
test('빈 기록과 UI 조회는 기존 업적 상태·개인 문서를 변경하지 않는다',()=>{
  assert.ok(mealHighlightSlots(fixture([]),'2026-11-14').every(slot=>slot.card===null));
  const data=fixture([{id:'a',count:2}]),before=structuredClone(data),achievements=mealAchievements(data);mealHighlightSlots(data,'2026-11-14');assert.deepEqual(data,before);assert.deepEqual(mealAchievements(data),achievements);
});
