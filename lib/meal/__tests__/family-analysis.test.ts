import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {analyzeFamilies} from '../family-analysis.ts';
import type {AnalysisRules} from '../family-analysis.ts';
import type {HistoryStatistics} from '../history-statistics.ts';
const stats=JSON.parse(readFileSync(new URL('../../../docs/dex/statistics/2026-09-01_2026-11-14/statistics.json',import.meta.url),'utf8')) as HistoryStatistics;
const rules=JSON.parse(readFileSync(new URL('../../../config/meals/analysis-mappings.v1.json',import.meta.url),'utf8')) as AnalysisRules;
test('실제 자료: SAME 16쌍·REVIEW 3쌍, 기존 ID와 원본 보존',()=>{
  const before=JSON.stringify({stats,rules}),r=analyzeFamilies(stats,rules);
  assert.deepEqual(r.counts,{SAME:16,SAME_FAMILY:0,REVIEW:3});
  assert.equal(r.baseline.unique,130);assert.equal(r.identity.unique,114);assert.equal(r.identity.singletons,78);
  assert.equal(JSON.stringify({stats,rules}),before);
  assert.ok(r.identity.items.every(i=>i.rarity==='UNKNOWN'));
});
test('SAME는 날짜 합집합, 같은 날 여러 메뉴·계열은 한 번',()=>{
  const copy=structuredClone(stats),mapping=rules.identities.find(m=>m.decision==='SAME')!;
  for(const menu of copy.menus.filter(m=>mapping.dishIds.includes(m.dishId)))menu.appearanceDates=['2026-09-01'];
  const r=analyzeFamilies(copy,rules);
  assert.equal(r.identity.items.find(i=>i.id===mapping.id)!.appearanceDays,1);
  for(const item of r.family.items)assert.equal(item.appearanceDays,new Set(item.dates).size);
});
test('SAME_FAMILY는 개별 동일성 그룹을 만들지 않는다',()=>{
  const copy=structuredClone(rules);copy.identities[0].decision='SAME_FAMILY';
  assert.equal(analyzeFamilies(stats,copy).identity.unique,115);
});
test('복합 세트는 돈가스로 추정하지 않고 REVIEW, 미분류는 가짜 계열이 아니다',()=>{
  const r=analyzeFamilies(stats,rules);
  const ids=rules.identities.find(m=>m.name==='등심돈가스&국물떡볶이')!.dishIds;
  assert.ok(ids.every(id=>r.unclassified.some(m=>m.dishId===id&&m.state==='REVIEW')));
  assert.ok(r.family.items.every(i=>!['REVIEW','UNKNOWN_FAMILY'].includes(i.id)));
  assert.ok(r.family.items.find(i=>i.name==='돈가스')!.dishIds.every(id=>!ids.includes(id)));
});
test('계열 규칙 수정은 원본 보존, 같은 입력·버전은 재현 가능',()=>{
  const a=analyzeFamilies(stats,rules);assert.deepEqual(a,analyzeFamilies(stats,structuredClone(rules)));
  const changed=structuredClone(rules);changed.version+='-review';changed.familyMappings[0]={dishId:changed.familyMappings[0].dishId,dishFamilyId:null,state:'UNKNOWN_FAMILY',reason:'검토'};
  const b=analyzeFamilies(stats,changed);assert.equal(b.family.unclassified,a.family.unclassified+1);assert.equal(b.baseline.unique,a.baseline.unique);
});
test('중복 또는 존재하지 않는 ID 매핑은 거부',()=>{
  const copy=structuredClone(rules);copy.identities.push(copy.identities[0]);assert.throws(()=>analyzeFamilies(stats,copy));
  const unknown=structuredClone(rules);unknown.familyMappings[0].dishFamilyId='unknown';assert.throws(()=>analyzeFamilies(stats,unknown));
});
test('계열 비율로 개별 요리 빈도나 희귀도를 대체하지 않는다',()=>{
  const r=analyzeFamilies(stats,rules);assert.equal(r.family.items.find(m=>m.name==='덮밥')!.appearanceDays,21);
  assert.equal(Math.max(...r.identity.items.map(i=>i.appearanceDays)),2);
  assert.equal(r.rarity,'UNKNOWN');
});
