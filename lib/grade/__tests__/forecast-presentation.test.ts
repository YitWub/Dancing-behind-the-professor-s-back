import test from 'node:test';
import assert from 'node:assert/strict';
import { forecastPresentation } from '../forecast-presentation.ts';
import { newCourse } from '../course-validation.ts';
import { migrateV1Courses } from '../management.ts';
import { officialPolicy } from '../grading-policy.ts';
function course(){const r=migrateV1Courses([{...newCourse('facts'),name:'근거'}]);assert.ok(r.ok);const c=r.value[0];c.assessments=c.assessments.map((a)=>({id:a.id,name:a.name,weight:a.weight,maxScore:a.maxScore,mean:a.mean,stdev:a.stdev,ceilingClustered:a.ceilingClustered,progress:{status:'scheduled'}}));c.assessments[0].progress={status:'graded',score:80};c.assessments[0].mean=60;c.gradingPolicy=officialPolicy('relative1');return c;}
test('presentation separates confirmed, assumed and unknown with at most three summary facts',()=>{
 const c=course(),snapshot=structuredClone(c),v=forecastPresentation(c);assert.ok(v.grade);assert.ok(v.confirmed.some((r)=>r.value.includes('80')));assert.ok(v.assumed.some((r)=>r.label==='남은 시험의 위치'));assert.ok(v.unknown.some((r)=>r.label==='다른 수강생'));assert.ok(v.highlights.length<=3);assert.equal(v.allRecorded,false);assert.deepEqual(c,snapshot);
});
test('missing mean hides grade but exposes actual score range without inventing a probability',()=>{
 const c=course();c.assessments[0].mean=null;const v=forecastPresentation(c);assert.equal(v.grade,null);assert.ok(v.fallback);assert.ok(v.fallback.high>=v.fallback.low);assert.match(v.nextInfo,/반 평균/);
});
test('absolute forecast and completed scores are distinguished from future assumptions',()=>{
 const c=course();c.gradingPolicy=officialPolicy('absolute');const v=forecastPresentation(c);assert.ok(v.grade);assert.equal(v.relative,false);
 c.assessments=c.assessments.map((a)=>({id:a.id,name:a.name,weight:a.weight,maxScore:a.maxScore,mean:a.mean,stdev:a.stdev,ceilingClustered:a.ceilingClustered,progress:{status:'graded',score:80}}));const done=forecastPresentation(c);assert.equal(done.allRecorded,true);assert.equal(done.assumed.some((r)=>r.label==='기말고사'),false);
});
test('perfect completed task produces disclosed assumption, awaiting and real zero stay distinct',()=>{
 const c=course();c.assessments[2].assignmentGroup={allocation:'equal',tasks:[{id:'done',name:'완료',maxScore:100,weight:null,progress:{status:'graded',score:100}},{id:'later',name:'남은 과제',maxScore:100,weight:null,progress:{status:'scheduled'}}]};const v=forecastPresentation(c);assert.ok(v.assumed.some((r)=>r.label.includes('남은 과제')&&r.value.includes('100 / 100')));assert.ok(!v.confirmed.some((r)=>r.label.includes('남은 과제')));
 c.assessments[1].progress={status:'awaiting_grade'};c.assessments[0].progress={status:'graded',score:0};const pending=forecastPresentation(c);assert.ok(pending.unknown.some((r)=>r.value==='채점 결과 대기'));assert.ok(pending.confirmed.some((r)=>r.value==='0 / 100점'));
});
