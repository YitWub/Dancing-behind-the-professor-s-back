import test from 'node:test';
import assert from 'node:assert/strict';
import { meanOnlyPercentile, relativeOutlook, relativeGoal } from '../relative-outlook.ts';
import { newCourse } from '../course-validation.ts';
import { migrateV1Courses } from '../management.ts';
import { officialPolicy } from '../grading-policy.ts';
test('same raw score has a higher relative position against a lower class mean',()=>{
 assert.ok(meanOnlyPercentile(.5,.3)>meanOnlyPercentile(.5,.8));
 assert.equal(meanOnlyPercentile(.5,.5),.5);
 for(const m of [.001,.1,.3,.5,.8,.999]){let before=-1;for(let i=0;i<=100;i++){const p=meanOnlyPercentile(i/100,m);assert.ok(p>=before-1e-9&&p>=0&&p<=1+1e-9);before=p;}}
 assert.throws(()=>meanOnlyPercentile(.5,2));
});
test('relative grade uses mean and quota assumptions, pending final preserves position and no records mutate',()=>{
 const r=migrateV1Courses([{...newCourse('relative'),name:'상대'}]);assert.ok(r.ok);const c=r.value[0];c.gradingPolicy=officialPolicy('relative1');
 c.assessments[0].progress={status:'graded',score:50};c.assessments[0].mean=30;c.assessments[0].maxScore=100;
 const copy=structuredClone(c);const good=relativeOutlook(c);assert.ok(good.ok);
 c.assessments[0].mean=80;const bad=relativeOutlook(c);assert.ok(bad.ok);assert.ok(good.top<bad.top);assert.notEqual(good.label,bad.label);
 c.assessments[0].mean=30;assert.deepEqual(c,copy);
 const base=relativeOutlook(c);assert.deepEqual(base,good);
 c.assessments[0].mean=null;assert.equal(relativeOutlook(c).ok,false);
});
test('relative goal inverts the same headline and responds to grade selection without mutating records',()=>{
 const r=migrateV1Courses([{...newCourse('goal'),name:'목표'}]);assert.ok(r.ok);const c=r.value[0];c.gradingPolicy=officialPolicy('relative1');
 c.assessments[0].progress={status:'graded',score:95};c.assessments[0].mean=60;c.assessments[0].maxScore=100;c.assessments[1].progress={status:'scheduled'};
 const snapshot=structuredClone(c);const a=relativeGoal(c,'A+'),b=relativeGoal(c,'B0');assert.equal(a.kind,'plan');assert.equal(b.kind,'plan');
 if(a.kind==='plan'&&b.kind==='plan'){assert.ok(a.required>=b.required);assert.ok(a.required<=a.maxScore);assert.equal(a.assumedMean,true);const final=c.assessments.find((x)=>/기말/.test(x.name))!;assert.equal(a.mean,final.maxScore*.6);assert.equal(a.assessmentId,final.id);assert.equal(a.cut,.15);assert.equal(a.required,Math.min(a.maxScore,Math.ceil(a.rawBoundary-1e-7)));const scenario=relativeOutlook(c,{finalId:final.id,score:a.required});assert.ok(scenario.ok);assert.ok(scenario.top<=.15+1e-8);}
 assert.deepEqual(c,snapshot);assert.equal(relativeGoal(c,'C0').kind,'unavailable');
 c.assessments[1].progress={status:'awaiting_grade'};assert.equal(relativeGoal(c,'A0').kind,'unavailable');
 c.assessments[0].mean=null;assert.equal(relativeGoal(c,'A0').kind,'unavailable');
});
test('goal audit uses explicit final mean and raw scale, independent of own assignment and attendance points',()=>{
 const r=migrateV1Courses([{...newCourse('audit'),name:'검증'}]);assert.ok(r.ok);const c=r.value[0];c.gradingPolicy=officialPolicy('relative2');
 c.assessments[0].maxScore=100;c.assessments[0].mean=40;c.assessments[0].progress={status:'graded',score:90};
 c.assessments[1].maxScore=50;c.assessments[1].mean=15;c.assessments[1].progress={status:'scheduled'};
 const goal=relativeGoal(c,'A0');assert.equal(goal.kind,'plan');if(goal.kind!=='plan')return;
 assert.equal(goal.mean,15);assert.equal(goal.maxScore,50);assert.equal(goal.assumedMean,false);assert.equal(goal.cut,.4);
 c.assessments[2].progress={status:'graded',score:0};assert.deepEqual(relativeGoal(c,'A0'),goal);
});
