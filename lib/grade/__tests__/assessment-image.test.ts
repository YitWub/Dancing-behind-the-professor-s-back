import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWeightPreview,parseImageExtraction,validateWeightPreview,applyWeightPreview,IMAGE_MAX_BYTES } from '../assessment-image.ts';
import { createImageHandler } from '../assessment-image-server.ts';
import type { ManagedAssessment } from '../management-types.ts';
const extraction=(items:[string,number|null][])=>parseImageExtraction({status:'ok',items:items.map(([name,percent])=>({name,percent,parent:null,needsReview:percent===null}))});
const existing:ManagedAssessment[]=[{id:'mid',name:'중간고사',weight:.3,maxScore:100,mean:50,stdev:null,ceilingClustered:false,progress:{status:'graded',score:80}},{id:'final',name:'기말고사',weight:.3,maxScore:100,mean:null,stdev:null,ceilingClustered:false,progress:{status:'scheduled'}},{id:'task',name:'과제',weight:.3,maxScore:100,mean:null,stdev:null,ceilingClustered:true,progress:{status:'scheduled'},assignmentGroup:{allocation:'equal',tasks:[{id:'t1',name:'보고서',maxScore:20,weight:null,progress:{status:'graded',score:15}}]}},{id:'attendance',name:'출석',weight:.1,maxScore:100,mean:null,stdev:null,ceilingClustered:true,progress:{status:'scheduled'}}];
test('30/30/30/10 structured extraction validates; apply preserves real exam and nested assignment records',()=>{
 const before=structuredClone(existing),rows=buildWeightPreview(existing,extraction([['중간',30],['기말',30],['과제',30],['출석',10]]));assert.deepEqual(validateWeightPreview(rows).errors,[]);const applied=applyWeightPreview(existing,rows,()=>crypto.randomUUID());assert.ok(applied.ok);assert.deepEqual(applied.value[0].progress,existing[0].progress);assert.deepEqual(applied.value[2].assignmentGroup,existing[2].assignmentGroup);assert.deepEqual(existing,before);
});
test('quiz, presentation and unknown original labels survive as separate items',()=>{
 const rows=buildWeightPreview([],extraction([['중간고사',30],['기말고사',30],['퀴즈',10],['발표',10],['팀프로젝트',10],['출석',10]]));const r=applyWeightPreview([],rows,()=>crypto.randomUUID());assert.ok(r.ok);assert.equal(r.value.length,6);assert.equal(r.value[4].name,'팀프로젝트');assert.ok(r.value.every((a)=>a.progress?.status==='scheduled'&&!a.assignmentGroup));
});
test('under/over totals, blanks, invalid numbers and normalized duplicates are held without correction',()=>{
 for(const p of [99,101,-1,Infinity]){const rows=buildWeightPreview([],extraction([['중간',30],['기말',30],['출석',10],['과제',Number.isFinite(p)?p-70:30]]));if(!Number.isFinite(p))rows[0].percent='Infinity';assert.ok(validateWeightPreview(rows).errors.length);}
 const uncertain=buildWeightPreview([],extraction([['중간',null],['중간고사',70]]));assert.ok(validateWeightPreview(uncertain).errors.some((e)=>e.includes('중복')));uncertain[0].name='기말';uncertain[0].percent='30';uncertain[0].needsReview=false;assert.deepEqual(validateWeightPreview(uncertain).errors,[]);
});
test('nested shares are shown excluded and cannot be double counted or promoted to final weights',()=>{
 const x=extraction([['과제',100],['보고서',50]]);x.items[1].parent='과제';const rows=buildWeightPreview([],x);assert.equal(rows[1].included,false);assert.deepEqual(validateWeightPreview(rows).errors,[]);rows[1].included=true;assert.ok(validateWeightPreview(rows).errors.some((e)=>e.includes('상위')));rows[0].included=false;rows[1].percent='100';assert.ok(validateWeightPreview(rows).errors.some((e)=>e.includes('내부 비율')));
});
test('image weights replace defaults without adding midterm or attendance to the uploaded table',()=>{
 const defaults=existing.map((a):ManagedAssessment=>({...a,assignmentGroup:undefined,reviewRequired:undefined,progress:{status:'scheduled'}}));
 const before=structuredClone(defaults),photo=extraction([['주차학습',20],['과제',25],['기말고사',50],['학습참여도',5],['강의자료실',0]]);
 const rows=buildWeightPreview(defaults,photo);
 assert.deepEqual(rows.map((r)=>r.name),photo.items.map((r)=>r.name));
 assert.deepEqual(validateWeightPreview(rows),{errors:[],total:100});
 const applied=applyWeightPreview(defaults,rows,()=>crypto.randomUUID());assert.ok(applied.ok);
 assert.deepEqual(applied.value.map((a)=>[a.name,a.weight]),photo.items.map((r)=>[r.name,r.percent!/100]));
 assert.equal(applied.value.find((a)=>a.name==='기말고사')?.id,'final');
 assert.deepEqual(defaults,before);
});
test('unmatched scores and assignment tasks are preserved at zero weight without inflating the image total',()=>{
 const before=structuredClone(existing),rows=buildWeightPreview(existing,extraction([['기말고사',100]]));
 assert.equal(rows.length,1);assert.deepEqual(validateWeightPreview(rows),{errors:[],total:100});
 const applied=applyWeightPreview(existing,rows,()=>crypto.randomUUID());assert.ok(applied.ok);
 assert.deepEqual(applied.value.find((a)=>a.id==='mid'),{...existing[0],weight:0});
 assert.deepEqual(applied.value.find((a)=>a.id==='task'),{...existing[2],weight:0});
 assert.equal(applied.value.some((a)=>a.id==='attendance'),false);
 assert.equal(applied.value.reduce((sum,a)=>sum+a.weight,0),1);assert.deepEqual(existing,before);
});
test('excluding a recognized row preserves its actual score at zero weight',()=>{
 const rows=buildWeightPreview(existing,extraction([['중간고사',30],['기말고사',100]]));rows[0].included=false;
 const applied=applyWeightPreview(existing,rows,()=>crypto.randomUUID());assert.ok(applied.ok);
 assert.deepEqual(applied.value.find((a)=>a.id==='mid'),{...existing[0],weight:0});
});
test('provider schema rejects malformed and nonnumeric output rather than pretending to recognize',()=>{
 assert.throws(()=>parseImageExtraction({status:'ok',items:[{name:'시험',percent:'30',parent:null,needsReview:false}]}));assert.throws(()=>parseImageExtraction({status:'unknown',items:[]}));assert.equal(parseImageExtraction({status:'no_table',items:[]}).status,'no_table');
  assert.ok(validateWeightPreview(buildWeightPreview([],extraction([['A+',100]]))).errors.some((e)=>e.includes('등급')));
  assert.ok(validateWeightPreview(buildWeightPreview([],extraction([['2026-11-07',100]]))).errors.some((e)=>e.includes('날짜')));
});
const image=Buffer.from([255,216,255,224,0,1]).toString('base64');
const request=(body:unknown={mediaType:'image/jpeg',data:image},origin='http://localhost')=>new Request('http://localhost/api/grade/assessment-image',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});

test('3.5 Flash-Lite extracts structured results without the incompatible 2.5 thinking budget',async()=>{
 let calls=0;
 const handler=createImageHandler({key:()=>'server-test-key',model:()=>'gemini-3.5-flash-lite',fetcher:async(url,options)=>{
  calls++;assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
  const payload=JSON.parse(options!.body as string);
  assert.equal('thinkingConfig' in payload.generationConfig,false);
  assert.equal(payload.generationConfig.responseMimeType,'application/json');
  assert.equal(payload.contents[0].parts[0].inlineData.data,image);
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(extraction([['중간',30],['기말',30],['과제',30],['출석',10]]))}]}}]});
 }});
 assert.equal((await (await handler(new Request('http://localhost/api/grade/assessment-image'))).json()).available,true);
 const response=await handler(request());assert.equal(response.status,200);assert.equal((await response.json()).items.length,4);assert.equal(calls,1);
});
test('server uses real provider request shape; validates structured tool result and never returns raw image',async()=>{
 let called=false;const handler=createImageHandler({key:()=>'server-test-key',model:()=>'gemini-2.5-flash',fetcher:async(url,options)=>{called=true;assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');assert.equal(new Headers(options!.headers).get('x-goog-api-key'),'server-test-key');assert.equal(String(url).includes('server-test-key'),false);const payload=JSON.parse(options!.body as string);assert.equal(payload.contents[0].parts[0].inlineData.data,image);assert.equal(payload.generationConfig.responseMimeType,'application/json');assert.equal(payload.generationConfig.responseJsonSchema.properties.items.type,'array');assert.equal(payload.generationConfig.thinkingConfig.thinkingBudget,0);assert.equal(payload.generationConfig.candidateCount,1);return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(extraction([['중간',30],['기말',30],['과제',30],['출석',10]]))}]}}]});}});
 const response=await handler(request());assert.equal(response.status,200);assert.equal(called,true);const body=await response.json();assert.equal(body.items.length,4);assert.equal('data' in body,false);
});
test('server rejects absent key, cross origin, bad image, oversized body and upstream failure safely',async()=>{
 const unavailable=createImageHandler({key:()=>undefined,model:()=>undefined});assert.equal((await unavailable(request())).status,503);assert.equal((await unavailable(new Request('http://localhost/api/grade/assessment-image'))).status,200);
 const h=createImageHandler({key:()=>'k',model:()=>'gemini-2.5-flash',fetcher:async()=>new Response('',{status:500})});assert.equal((await h(request({},'https://evil.example'))).status,403);assert.equal((await h(request({mediaType:'image/svg+xml',data:image}))).status,400);assert.equal((await h(request({mediaType:'image/png',data:image}))).status,400);assert.equal((await h(request({mediaType:'image/jpeg',data:'a'.repeat(IMAGE_MAX_BYTES*2)}))).status,400);assert.equal((await h(request())).status,502);
});
test('global instance limit caps paid calls; truncation/invalid output do not produce fabricated results',async()=>{
 const h=createImageHandler({key:()=>'k',model:()=>'gemini-2.5-flash',now:()=>100,fetcher:async()=>Response.json({candidates:[{finishReason:'MAX_TOKENS'}]})});for(let i=0;i<10;i++)assert.equal((await h(request())).status,422);assert.equal((await h(request())).status,429);
 const bad=createImageHandler({key:()=>'k',model:()=>'gemini-2.5-flash',fetcher:async()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'{"broken":true}'}]}}]})});assert.equal((await bad(request())).status,502);
});
test('Gemini quota exhaustion returns 429, pauses further calls and never retries or falls back to paid models',async()=>{
 let now=100,calls=0;const h=createImageHandler({key:()=>'k',model:()=>'gemini-2.5-flash',now:()=>now,fetcher:async()=>{calls++;return new Response('',{status:429,headers:{'Retry-After':'120'}});}});
 const first=await h(request());assert.equal(first.status,429);assert.equal(first.headers.get('Retry-After'),'120');assert.match((await first.json()).error,/무료 요청 한도/);
 assert.equal((await h(request())).status,429);assert.equal(calls,1);now+=121000;assert.equal((await h(request())).status,429);assert.equal(calls,2);
});
test('Flash-Lite is supported explicitly; unknown models and blocked/empty output do not trigger substitute calls',async()=>{
 let calls=0;const h=createImageHandler({key:()=>'k',model:()=>'gemini-2.5-flash-lite',fetcher:async(url)=>{calls++;assert.match(String(url),/gemini-2.5-flash-lite:generateContent$/);return Response.json({promptFeedback:{blockReason:'SAFETY'}});}});assert.equal((await h(request())).status,422);assert.equal(calls,1);
 const wrong=createImageHandler({key:()=>'k',model:()=>'another-model',fetcher:async()=>{throw Error('must not call');}});assert.equal((await wrong(request())).status,503);assert.equal((await (await wrong(new Request('http://localhost/api/grade/assessment-image'))).json()).available,false);
 const empty=createImageHandler({key:()=>'k',model:()=>'gemini-2.5-flash',fetcher:async()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[]}}]})});assert.equal((await empty(request())).status,502);
});
