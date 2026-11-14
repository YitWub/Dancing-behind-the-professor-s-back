import { strict as assert } from 'node:assert';
import { test, after } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createElement, isValidElement } from 'react';
import type { ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Render the real UI source with fixture props, never install fixture rarity in the app.
const require=createRequire(import.meta.url),ts=require('typescript');
const temporary=mkdtempSync(join(tmpdir(),'bokak-game-ui-'));
after(()=>rmSync(temporary,{recursive:true,force:true}));
const targets=new Map([
  ['RarityBadge','components/dex/common/RarityBadge.tsx'],
  ['CollectionCard','components/dex/common/CollectionCard.tsx'],
  ['GameNoticeList','components/dex/discovery/GameNoticeList.tsx'],
  ['CollectionFeedback','components/dex/discovery/CollectionFeedback.tsx'],
  ['CollectionArtwork','components/dex/common/CollectionArtwork.tsx'],
  ['MealHighlightCard','components/dex/meal/MealHighlightCard.tsx'],
]);
const urls=new Map([...targets.keys()].map(name=>[name,pathToFileURL(join(temporary,name+'.mjs')).href]));
for(const [name,path] of targets){
  const input=readFileSync(new URL('../../../../'+path,import.meta.url),'utf8');
  let output=ts.transpileModule(input,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText as string;
  output=output.replace(/from (["'])([^"']+)\1/g,(_match:string,_quote:string,specifier:string)=>{
    const target=[...urls].find(([component])=>specifier.endsWith('/'+component)||specifier==='./'+component)?.[1];
    return `from '${target??pathToFileURL(require.resolve(specifier)).href}'`;
  });
  writeFileSync(join(temporary,name+'.mjs'),output);
}
const {RarityBadge}=await import(urls.get('RarityBadge')!);
const {CollectionCard}=await import(urls.get('CollectionCard')!);
const {CollectionFeedback,DiscoveryReveal}=await import(urls.get('CollectionFeedback')!);
const {MealHighlightCard}=await import(urls.get('MealHighlightCard')!);
const render=(component:ComponentType<Record<string,unknown>>,props:Record<string,unknown>)=>renderToStaticMarkup(createElement(component,props));
const success={entry:{id:'fixture-entry'},experience:{id:'fixture-experience'},outcome:'new-entry',replayed:false,committedAt:'2026-11-14T00:00:00Z',discovery:{key:'fixture-request',entryId:'fixture-entry',title:'fixture'}};
test('희귀도 다섯 상태의 실제 공통 배지·프레임은 fixture에서만 검증하고 잠긴 등급은 노출하지 않는다',()=>{
  for(const tier of ['UNKNOWN','COMMON','UNCOMMON','RARE','LEGENDARY']){
    assert.ok(render(RarityBadge,{tier}).includes('dex-rarity--'+tier.toLowerCase()));
    assert.ok(render(CollectionCard,{title:'fixture',artwork:createElement('span'),rarity:tier}).includes('dex-rarity-frame--'+tier.toLowerCase()));
    const hidden=render(CollectionCard,{title:'이름은 공개',artwork:createElement('span'),rarity:tier,locked:true});assert.ok(hidden.includes('??? · 미발견'));assert.ok(hidden.includes('이름은 공개'));assert.ok(!hidden.includes('dex-rarity-frame--'));assert.ok(!hidden.includes('dex-rarity--'+tier.toLowerCase()));
  }
});
test('신규 성공만 희귀도·업적을 한 발견 화면에 표시하며 실패·재전송은 공개하지 않는다',()=>{
  const notices=[{id:'fixture-award',kind:'achievement',title:'테스트 업적',description:'fixture only'}];
  const props={itemName:'fixture meal',onDismiss:()=>{},rarity:'LEGENDARY',notices};
  const fresh=render(CollectionFeedback,{...props,result:{ok:true,value:success}});assert.ok(fresh.includes('NEW DISCOVERY!'));assert.ok(fresh.includes('LEGENDARY · 전설'));assert.ok(fresh.includes('테스트 업적'));
  const replay=render(CollectionFeedback,{...props,result:{ok:true,value:{...success,replayed:true}}});assert.ok(!replay.includes('LEGENDARY'));assert.ok(!replay.includes('테스트 업적'));
  const failure=render(CollectionFeedback,{...props,result:{ok:false,error:{code:'STORAGE_UNAVAILABLE',message:'fixture failure'}}});assert.ok(!failure.includes('NEW DISCOVERY!'));assert.ok(!failure.includes('테스트 업적'));
});
test('재방문은 카드 공개를 반복하지 않고 새 업적과 실제 횟수만 표시한다',()=>{
  const html=render(CollectionFeedback,{itemName:'fixture meal',onDismiss:()=>{},result:{ok:true,value:{...success,outcome:'revisit',discovery:null}},visitCount:5,notices:[{id:'fixture-regular',kind:'title',title:'돌아온 단골손님',description:'서로 다른 날 5일'}]});assert.ok(!html.includes('NEW DISCOVERY!'));assert.ok(html.includes('돌아온 단골손님'));assert.ok(html.includes('<strong>5</strong>'));
});

test('대표 메뉴 카드는 SVG·실제 상세 링크·짧은 동률 안내를 제공하고 빈 상태는 링크를 만들지 않는다',()=>{
  const base={id:'first',title:'나의 첫 학식',badge:'FIRST DISCOVERY',others:2,metric:'컬렉션의 첫 페이지',emptyTitle:'아직 없어요',emptyHint:'기록을 기다려요',memorial:true};
  const card=render(MealHighlightCard,{slot:{...base,card:{name:'테스트 국수',entryIds:['actual-entry']}}});assert.ok(card.includes('<svg'));assert.ok(card.includes('/dex/meal/collection/actual-entry'));assert.ok(card.includes('공동 · 외 2종'));assert.ok(card.includes('dex-first-stamp'));
  const empty=render(MealHighlightCard,{slot:{...base,card:null}});assert.ok(!empty.includes('href='));assert.ok(empty.includes('아직 없어요'));
});
test('다섯 등급 미리보기는 실제 수집 완료나 업적 획득으로 표시하지 않는다',()=>{
  for(const tier of ['COMMON','UNCOMMON','RARE','LEGENDARY','UNKNOWN']){const html=render(DiscoveryReveal,{preview:true,itemName:'연출 테스트 카드',title:'희귀도 연출 미리보기',rarity:tier,onDismiss:()=>{}});assert.ok(html.includes('PREVIEW · TEST CARD'));assert.ok(html.includes('저장되지 않아요'));assert.ok(!html.includes('나의 컬렉션에 등록 완료'));assert.ok(html.includes('dex-rarity-frame--'+tier.toLowerCase()));}
});
test('미리보기 페이지는 프로덕션에서 컴포넌트를 열기 전에 404로 차단한다',async()=>{
  const source=readFileSync(new URL('../../../../app/dex/dev/rarity/page.tsx',import.meta.url),'utf8');
  const component=pathToFileURL(join(temporary,'preview-stub.mjs'));writeFileSync(component,"export function RarityPreview(){return null;}");
  let output=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText as string;
  for(const specifier of ['next/navigation','react/jsx-runtime'])output=output.replaceAll(`from '${specifier}'`,`from '${pathToFileURL(require.resolve(specifier)).href}'`).replaceAll(`from "${specifier}"`,`from "${pathToFileURL(require.resolve(specifier)).href}"`);
  output=output.replace("import('@/components/dex/dev/RarityPreview')",`import('${component.href}')`);
  const file=pathToFileURL(join(temporary,'preview-page.mjs'));writeFileSync(file,output);const {default:Page}=await import(file.href);
  const env=process.env as Record<string,string|undefined>;const previous=env['NODE_ENV'];try{env['NODE_ENV']='production';await assert.rejects(()=>Page(),{digest:'NEXT_HTTP_ERROR_FALLBACK;404'});env['NODE_ENV']='development';assert.ok(isValidElement(await Page()));}finally{if(previous===undefined)delete env['NODE_ENV'];else env['NODE_ENV']=previous;}
});
