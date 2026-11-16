import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbDexRepository } from '../../storage/indexeddb.ts';
import type { CollectCommand, Result } from '../../core/types.ts';
import { peopleView,personMemories } from '../view.ts';
function value<T>(result:Result<T>):T{if(!result.ok)throw Error(result.error.code);return result.value;}
async function setup(){const factory=new IDBFactory();let fail=false;const repo=new IndexedDbDexRepository({factory,beforeCommit:()=>{if(fail)throw Error('test abort');}});const {ownerId}=value(await repo.open()),doc=value(await repo.snapshot());const command:CollectCommand={ownerId,dexId:doc.dexes.find(d=>d.kind==='people')!.id,requestId:'person-1',subject:{kind:'person',displayName:'같은 별명',relationship:'동아리',department:'컴퓨터',admissionYear:2026},experience:{kind:'person',event:'first-met',experiencedOn:'2026-09-01',note:'OT에서 만났어요'}};return {repo,factory,command,setFail:(v:boolean)=>{fail=v;}};}
test('동명이인·상세·프로필 수정·명시적 entryId 추억·멱등 재시도',async()=>{const {repo,command}=await setup();try{
 const first=value(await repo.collect(command));value(await repo.collect({...command,requestId:'person-2'}));
 const updated=value(await repo.updateEntry(command.ownerId,first.entry.id,first.entry.revision,{subject:{kind:'person',displayName:'새 별명',memo:'함께하는 친구'}}));
 assert.equal(value(await repo.getEntry(command.ownerId,updated.id)).subject.kind,'person');
 const memory={...command,entryId:updated.id,subject:updated.subject,requestId:'memory-1',experience:{kind:'person' as const,event:'memory' as const,experiencedOn:'2026-10-01',note:'축제에서 만남'}};
 const added=value(await repo.collect(memory)),replay=value(await repo.collect(memory));assert.equal(replay.replayed,true);assert.equal(replay.experience.id,added.experience.id);
 const doc=value(await repo.snapshot());assert.equal(doc.entries.length,2);assert.equal(doc.experiences.length,3);assert.equal(doc.experiences.some(e=>e.card),false);assert.equal(personMemories(doc,updated.id).length,2);
 assert.equal(doc.entries.find(e=>e.id===updated.id)!.subject.kind==='person'&&(doc.entries.find(e=>e.id===updated.id)!.subject as {displayName:string}).displayName,'새 별명');
}finally{repo.close();}});
test('추억 수정·삭제·인연 삭제는 관련 데이터만 정리하고 삭제 요청 재시도는 거부',async()=>{const {repo,command}=await setup();try{
 const first=value(await repo.collect(command)),other=value(await repo.collect({...command,requestId:'other'}));
 const exp=value(await repo.updateExperience(command.ownerId,first.experience.id,first.experience.revision,{note:'수정한 기억',experiencedOn:'2026-09-02'}));assert.equal(exp.note,'수정한 기억');
 value(await repo.deleteExperience(command.ownerId,exp.id,exp.revision));assert.equal(value(await repo.listExperiences(command.ownerId,first.entry.id)).length,0);
 const replay=await repo.collect(command);assert.equal(replay.ok,false);if(!replay.ok)assert.equal(replay.error.code,'RESULT_DELETED');
 value(await repo.deleteEntry(command.ownerId,other.entry.id,other.entry.revision));const doc=value(await repo.snapshot());assert.equal(doc.entries.length,1);assert.equal(doc.experiences.length,0);
}finally{repo.close();}});
test('실패 시 부분 저장 없이 입력 명령 재시도로 한 번만 영속화, 재연결 후 유지',async()=>{const {repo,command,factory,setFail}=await setup();setFail(true);assert.equal((await repo.collect(command)).ok,false);assert.equal(value(await repo.snapshot()).entries.length,0);setFail(false);const first=value(await repo.collect(command));value(await repo.collect(command));repo.close();const reopened=new IndexedDbDexRepository({factory});try{value(await reopened.open());const doc=value(await reopened.snapshot());assert.equal(doc.entries.length,1);assert.equal(doc.experiences.length,1);assert.equal(doc.entries[0].id,first.entry.id);}finally{reopened.close();}});
test('공통 내보내기·가져오기는 인연과 추억을 보존하고 학식 도감을 유지',async()=>{const {repo,command}=await setup();const target=new IndexedDbDexRepository({factory:new IDBFactory()});try{
 value(await repo.collect(command));const backup=value(await repo.exportRecords(command.ownerId));value(await target.open());const preview=value(await target.previewImport(backup));value(await target.commitImport({token:preview.token,strategy:'replace',confirmed:true}));const doc=value(await target.snapshot());assert.equal(doc.entries.length,1);assert.equal(doc.experiences[0].note,'OT에서 만났어요');assert.equal(doc.dexes.filter(d=>d.kind==='meal').length,1);
}finally{repo.close();target.close();}});
test('검색·관계 필터·이름순·첫 만남순은 원본과 학식 레코드를 변경하지 않음',async()=>{const {repo,command}=await setup();try{
 const a=value(await repo.collect(command));value(await repo.collect({...command,requestId:'b',subject:{kind:'person',displayName:'가나다',relationship:'수업'},experience:{kind:'person',event:'first-met',experiencedOn:'2026-08-01'}}));
 const edited=value(await repo.updateExperience(command.ownerId,a.experience.id,a.experience.revision,{experiencedOn:'2026-07-01'}));assert.equal(edited.experiencedOn,'2026-07-01');
 const doc=value(await repo.snapshot()),before=JSON.stringify(doc);assert.equal(peopleView(doc,'별명').length,1);assert.equal(peopleView(doc,'','수업')[0].subject.displayName,'가나다');assert.equal(peopleView(doc,'','','name')[0].subject.displayName,'가나다');assert.equal(peopleView(doc,'','','first')[0].id,a.entry.id);assert.equal(JSON.stringify(doc),before);
}finally{repo.close();}});
