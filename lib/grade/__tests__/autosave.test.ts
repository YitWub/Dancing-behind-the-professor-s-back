import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoSaveQueue,autoSaveChanges,encodeDraft,readEditorDraft,writeEditorDraft,removeEditorDraft,draftKey } from '../autosave.ts';
import { newCourse } from '../course-validation.ts';
import { migrateV1Courses } from '../management.ts';
import { prepareAttendanceEstimate } from '../attendance-estimate.ts';
import { saveManagedCourses,loadManagedCourses } from '../managed-storage.ts';
function course(){const r=migrateV1Courses([{...newCourse('auto'),name:'자동 저장'}]);assert.ok(r.ok);const c=r.value[0];c.assessments=c.assessments.map((a)=>({id:a.id,name:a.name,weight:a.weight,maxScore:100,mean:null,stdev:null,ceilingClustered:a.ceilingClustered,progress:{status:'scheduled'}}));c.attendanceEstimate=prepareAttendanceEstimate(c).value;return c;}
function clock(){let id=0;const jobs=new Map<number,()=>void>();return {jobs,set(fn:()=>void){jobs.set(++id,fn);return id;},clear(n:unknown){jobs.delete(n as number);},run(){for(const fn of [...jobs.values()])fn();}};}
test('debounce drops older revisions, flushes latest once and cancels invalid updates',()=>{
 const timer=clock(),q=createAutoSaveQueue(timer),writes:number[]=[];
 q.schedule(()=>writes.push(1),450);q.schedule(()=>writes.push(2),450);timer.run();assert.deepEqual(writes,[2]);
 q.schedule(()=>writes.push(3),0);q.flush();q.flush();timer.run();assert.deepEqual(writes,[2,3]);
 q.schedule(()=>writes.push(4),450);q.cancel();timer.run();assert.deepEqual(writes,[2,3]);
});
test('ordinary attendance +/- bypasses destructive prompt but still acknowledges storage correction rules',()=>{
 const c=course();c.attendanceEstimate!.absences=3;const n=structuredClone(c);n.attendanceEstimate!.absences=2;
 const changes=autoSaveChanges(c,n);assert.deepEqual(changes.messages,[]);assert.equal(changes.attendance,true);
 n.attendanceEstimate!.totalSessions=30;assert.ok(autoSaveChanges(c,n).messages.length);
});
test('invalid ratio never overwrites last valid v2, correction resumes and preserves other courses',()=>{
 const data=new Map<string,string>();const storage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);}};
 const a=course(),b={...course(),id:'other',name:'다른 과목'};let saved=saveManagedCourses([a,b],null,()=>storage);assert.ok(saved.ok);const original=saved.value.snapshot;
 a.assessments[0].weight=.4;assert.equal(saveManagedCourses([a,b],original,()=>storage).ok,false);assert.equal(loadManagedCourses(()=>storage).ok,true);assert.equal(data.values().next().value,original);
 a.assessments[1].weight=.3;saved=saveManagedCourses([a,b],original,()=>storage);assert.ok(saved.ok);const restored=loadManagedCourses(()=>storage);assert.ok(restored.ok);assert.deepEqual(restored.value.courses[1],b);
 const denied={...storage,setItem:()=>{throw Error('quota');}};a.professor='새 교수';assert.equal(saveManagedCourses([a,b],saved.value.snapshot,()=>denied).ok,false);assert.equal(data.values().next().value,saved.value.snapshot);
 assert.equal(saveManagedCourses([a,b],saved.value.snapshot,()=>storage).ok,true);
});
test('recovery journal preserves empty fields and invalid numbers, never writes official course keys',()=>{
 const data=new Map<string,string>(),storage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);}};
 const previous=Object.getOwnPropertyDescriptor(globalThis,'window');Object.defineProperty(globalThis,'window',{configurable:true,value:{localStorage:storage}});
 try{const c=course(),d={score:'',ratio:'40',total:NaN};assert.equal(writeEditorDraft(c.id,c,d),true);const r=readEditorDraft(c.id,c,(v):v is typeof d=>!!v&&typeof v==='object');assert.ok(r);assert.equal(r.score,'');assert.ok(Number.isNaN(r.total));assert.equal(data.has(draftKey(c.id)),true);assert.equal(data.has('erica.grade.courses.v2'),false);assert.equal(readEditorDraft(c.id,{...c,name:'external change'},(v):v is typeof d=>!!v),null);removeEditorDraft(c.id);assert.equal(data.size,0);assert.notEqual(encodeDraft(NaN),encodeDraft(null));}
 finally{if(previous)Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window');}
});
