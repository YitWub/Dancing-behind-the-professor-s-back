import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { foodArtSource, FOOD_ART_ASSETS, DEFAULT_FOOD_ART } from '../artwork-assets.ts';
test('명확한 대표 메뉴 12종만 구체적인 WebP로 연결한다',()=>{
  const examples=[['산채비빔밥','rice','bibimbap'],['찐만두','food','dumplings'],['참치김밥','food','gimbap'],['물냉면','food','cold-noodles'],['크림파스타','noodles','pasta'],['유부우동','noodles','udon'],['함박스테이크','food','hamburg-steak'],['오므라이스','rice','omurice'],['고등어구이','food','grilled-fish'],['전복죽','food','rice-porridge'],['치킨샐러드','food','salad'],['햄치즈샌드위치','food','sandwich']];
  for(const [name,kind,file]of examples)assert.equal(foodArtSource(kind,name),'/dex/food/'+file+'.webp',name);
  assert.equal(foodArtSource('rice','[천원의 아침밥] 산채 비빔밥 (Wild Vegetable Bibimbap)'),FOOD_ART_ASSETS.bibimbap);
  assert.equal(foodArtSource('rice','나물비빔밥&계란후라이'),FOOD_ART_ASSETS.bibimbap);
});
test('재료 이름·다른 조리법·복합 메뉴를 억지로 합치지 않는다',()=>{
  assert.equal(foodArtSource('stew','만두전골'),FOOD_ART_ASSETS.stew);
  assert.equal(foodArtSource('cutlet','만두카츠'),FOOD_ART_ASSETS.cutlet);
  assert.equal(foodArtSource('food','만둣국'),DEFAULT_FOOD_ART);
  assert.equal(foodArtSource('noodles','해물볶음우동'),FOOD_ART_ASSETS.noodles);
  assert.equal(foodArtSource('food','죽순볶음'),DEFAULT_FOOD_ART);
  assert.equal(foodArtSource('food','고등어조림'),DEFAULT_FOOD_ART);
  for(const name of ['돈가스&우동','돈가스와우동','우동과바삭한새우튀김세트','김밥/떡볶이','모둠정식','오늘의 정식'])assert.equal(foodArtSource('food',name),DEFAULT_FOOD_ART,name);
});
test('기존 8종 매핑과 기본 이미지·비음식 처리는 유지한다',()=>{
  const old={cutlet:'cutlet','fried-rice':'fried-rice','rice-bowl':'rice-bowl',stew:'stew',noodles:'noodles',curry:'curry',snack:'bunsik',meat:'stir-fry'};
  for(const [kind,file]of Object.entries(old))assert.equal(foodArtSource(kind),'/dex/food/'+file+'.webp');
  assert.equal(foodArtSource('food'),DEFAULT_FOOD_ART);assert.equal(foodArtSource('people','비빔밥'),null);assert.equal(foodArtSource('custom','우동'),null);
});
