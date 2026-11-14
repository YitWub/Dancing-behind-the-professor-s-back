import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDesignSamples} from '../design-samples.ts';
import {CARD_EDITION_POLICY} from '../../meal/card-editions.ts';
test('세 도감은 5·30·100개 가상 샘플과 고정된 결과를 제공한다',()=>{
  for(const kind of ['meal','people','course'] as const)for(const count of [5,30,100]){const samples=createDesignSamples(kind,count);assert.equal(samples.length,count);assert.equal(new Set(samples.map(s=>s.id)).size,count);assert.ok(samples.every(s=>s.kind===kind&&s.id.startsWith('design-')));assert.deepEqual(samples,createDesignSamples(kind,count));}
});
test('학식 에디션 미리보기만 변경하며 실제 확률과 인연·강의에는 등급을 적용하지 않는다',()=>{
  const before=structuredClone(CARD_EDITION_POLICY);
  for(const edition of ['NORMAL','SPECIAL','RARE','GOLDEN'] as const){assert.ok(createDesignSamples('meal',30,edition).every(s=>s.edition===edition));for(const kind of ['people','course'] as const)assert.ok(createDesignSamples(kind,30,edition).every(s=>s.edition===undefined));}
  assert.deepEqual(CARD_EDITION_POLICY,before);
});
test('기록장 샘플은 별명·발견 문구 또는 강의·학기를 보존하고 지원 외 규모를 거부한다',()=>{
  const people=createDesignSamples('people',5),course=createDesignSamples('course',5);assert.ok(people.every(s=>s.stamp&&s.note));assert.ok(course.every(s=>s.meta.includes('학기')));assert.throws(()=>createDesignSamples('meal',500));
});
