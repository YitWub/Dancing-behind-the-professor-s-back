import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbDexRepository } from '../../storage/indexeddb.ts';
import { mealAchievements } from '../game.ts';
import { MEAL_ACHIEVEMENT_ART } from '../achievement-art.ts';
test('실제 업적 8개 ID·한국어 이름·이미지는 제공 manifest와 일치하며 판정을 바꾸지 않는다',async()=>{
  const repository=new IndexedDbDexRepository({factory:new IDBFactory()});
  try{const opened=await repository.open();assert.ok(opened.ok);const snapshot=await repository.snapshot();assert.ok(snapshot.ok);const before=structuredClone(snapshot.value);const goals=mealAchievements(snapshot.value);
    const manifest=JSON.parse(readFileSync(new URL('../../../../assets/dex/achievements/manifest.json',import.meta.url),'utf8')) as Record<string,{name_ko:string;webp:string}>;
    assert.equal(goals.length,8);assert.deepEqual(Object.keys(MEAL_ACHIEVEMENT_ART).sort(),goals.map(goal=>goal.id).sort());
    for(const goal of goals){const record=Object.values(manifest).find(item=>item.name_ko===goal.name);assert.ok(record);assert.equal(MEAL_ACHIEVEMENT_ART[goal.id],'/dex/achievements/'+record.webp.slice('webp/'.length));}
    assert.ok(goals.filter(goal=>goal.id==='meal:rare-three'||goal.id==='meal:legendary').every(goal=>goal.status==='preparing'&&goal.progress===null));assert.deepEqual(snapshot.value,before);
  }finally{repository.close();}
});
