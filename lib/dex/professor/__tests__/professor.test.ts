import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbDexRepository } from '../../storage/indexeddb.ts';
import { isPhotoPackage, packContainer, unpackBackup } from '../../storage/photo-package.ts';
import { parseBackup } from '../../core/validation.ts';
import { saveCourse } from '../../course/course.ts';
import { matchesFaculty } from '../catalog.ts';
import type { CollectCommand, Result } from '../../core/types.ts';
function value<T>(result:Result<T>):T{if(!result.ok)throw new Error(result.error.message);return result.value;}
async function setup(){
  const factory=new IDBFactory();const repo=new IndexedDbDexRepository({factory});
  const {ownerId}=value(await repo.open());
  const dex=value(await repo.createDex(ownerId,{kind:'professor',name:'교수도감',icon:'book'}));
  const command:CollectCommand={ownerId,dexId:dex.id,requestId:'course-1',subject:{kind:'professor',professorId:'hyu-test',displayName:'테스트 교수',college:'소프트웨어융합대학',department:'인공지능학과',sourceUrl:'https://www.hanyang.ac.kr/e_college_department-info'},experience:{kind:'professor',courseName:'인공지능개론',academicYear:2026,semester:'2',experiencedOn:'2026-11-18',note:'분류와 회귀를 배웠어요.'}};
  return {repo,factory,ownerId,dex,command};
}
test('교수도감은 기존 빈 학식·인연도감을 보존하고 한 개만 생성한다',async()=>{
 const {repo,ownerId,dex}=await setup();
 const again=value(await repo.createDex(ownerId,{kind:'professor',name:'교수도감',icon:'book'}));assert.equal(again.id,dex.id);
 const doc=value(await repo.snapshot());assert.deepEqual(doc.dexes.map(d=>d.kind).sort(),['meal','people','professor'].sort());repo.close();
});
test('동시 수강 등록·재시도는 카드와 수업을 중복시키지 않고 다른 과목·재수강을 누적한다',async()=>{
 const {repo,factory,command}=await setup();const other=new IndexedDbDexRepository({factory});value(await other.open());
 const replies=await Promise.all([repo.collect(command),other.collect(command)]);assert.equal(replies.filter(r=>r.ok&&!r.value.replayed).length,1);
 assert.equal((await repo.collect({...command,requestId:'duplicate'})).ok,false);
 const e=command.experience;assert.equal(e.kind,'professor');if(e.kind!=='professor')return;
 value(await other.collect({...command,requestId:'course-2',experience:{...e,courseName:'머신러닝'}}));
 value(await repo.collect({...command,requestId:'course-3',experience:{...e,academicYear:2025}}));
 const doc=value(await repo.snapshot());assert.equal(doc.entries.length,1);assert.equal(doc.experiences.length,3);
 repo.close();other.close();
});
test('수업 수정은 중복·잘못된 학기를 거부하고 메모와 과목 수정은 보존한다',async()=>{
 const {repo,command,ownerId}=await setup();const a=value(await repo.collect(command));
 value(await repo.updateExperience(ownerId,a.experience.id,a.experience.revision,{courseName:'수정한 수업',note:'시험 복습'}));
 const updated=value(await repo.snapshot()).experiences[0];assert.equal(updated.note,'시험 복습');
 assert.equal((await repo.updateExperience(ownerId,updated.id,updated.revision,{semester:'bad' as '1'})).ok,false);
 const preserved=value(await repo.snapshot()).experiences[0];assert.equal(preserved.kind,'professor');if(preserved.kind==='professor')assert.equal(preserved.courseName,'수정한 수업');repo.close();
});
test('교수도감과 강의도감은 v16 백업으로 함께 복원되고 기존 백업도 읽힌다',async()=>{
 const {repo,command,ownerId}=await setup();value(await repo.collect(command));
 const professorOnly=value(await repo.snapshot());
 const exportedAt='2026-11-20T00:00:00.000Z';
 const legacyProfessor=packContainer({format:'bokak-dex',schemaVersion:11,containsSensitiveData:true,exportedAt,data:professorOnly,assets:[]},[],11);
 assert.deepEqual((await unpackBackup(legacyProfessor)).document,professorOnly);
 value(await saveCourse(repo,professorOnly,{kind:'course',title:'아카데믹 글쓰기',year:2026,term:'fall',status:'active'},'enroll-1','2026-11-20'));
 const blob=value(await repo.exportRecords(ownerId));assert.equal(await isPhotoPackage(blob),true);
 assert.equal(await blob.slice(0,9).text(),'BOKAKP16\n');
 const parsed=await unpackBackup(blob);
 const fresh=new IndexedDbDexRepository({factory:new IDBFactory()});value(await fresh.open());
 const preview=value(await fresh.previewImport(blob));value(await fresh.commitImport({token:preview.token,strategy:'replace',confirmed:true}));
 const restored=value(await fresh.snapshot());
 assert.deepEqual(restored.entries.map(entry=>entry.subject.kind).sort(),['course','professor']);
 assert.equal(restored.experiences.find(entry=>entry.kind==='professor')?.note,'분류와 회귀를 배웠어요.');
 assert.deepEqual(restored.entries.map(entry=>entry.subject),parsed.document.entries.map(entry=>entry.subject));
 const legacy=structuredClone(professorOnly);legacy.dexes=legacy.dexes.filter(d=>d.kind!=='professor');legacy.entries=[];legacy.experiences=[];legacy.receipts=[];
 const envelope={format:'bokak-dex',schemaVersion:2,containsSensitiveData:true,exportedAt,data:legacy};assert.equal(parseBackup(JSON.stringify(envelope)).schemaVersion,2);
 assert.throws(()=>parseBackup(JSON.stringify({...envelope,data:professorOnly})));
 repo.close();fresh.close();
});
test('카드 삭제는 관련 수업만 삭제하고 공식 출처가 아닌 URL은 거부한다',async()=>{
 const {repo,command,ownerId}=await setup();const result=value(await repo.collect(command));
 assert.equal((await repo.collect({...command,requestId:'bad-source',subject:{...command.subject,kind:'professor',professorId:'bad',displayName:'검증',college:'대학',department:'학과',sourceUrl:'https://hanyang.ac.kr.evil.test/'}})).ok,false);
 value(await repo.deleteEntry(ownerId,result.entry.id,result.entry.revision));const doc=value(await repo.snapshot());assert.equal(doc.entries.length,0);assert.equal(doc.experiences.length,0);assert.equal(doc.dexes.length,3);repo.close();
});
test('교수 검색은 이름의 공백과 학과 검색·단과대학 필터를 지원한다',()=>{
 const f={id:'faculty',name:'김 교수',college:'공학대학',department:'전자공학부'};
 assert.equal(matchesFaculty(f,'김교수','공학대학'),true);assert.equal(matchesFaculty(f,'전자',''),true);assert.equal(matchesFaculty(f,'','경상대학'),false);
});

test('공식 명단의 식별자·이름·출처를 검증하고 부분 명단임을 명시한다',()=>{
 const data=JSON.parse(readFileSync(new URL('../../../../data/professors.json',import.meta.url),'utf8'));
 assert.equal(data.coverage,'partial');assert.ok(data.professors.length>0);
 assert.equal(new Set(data.professors.map((f:{id:string})=>f.id)).size,data.professors.length);
 for(const f of data.professors){assert.match(f.id,/^hyu-[a-f0-9]{20}$/);assert.ok(f.name.trim()&&f.name.length<=80&&!f.name.includes('\ufffd'));const u=new URL(f.sourceUrl);assert.equal(u.protocol,'https:');assert.ok(u.hostname.endsWith('.hanyang.ac.kr'));}
});
test('수강 기록 수정으로 같은 학기의 같은 과목을 중복시킬 수 없다',async()=>{
 const {repo,command,ownerId}=await setup();const first=value(await repo.collect(command));
 const exp=command.experience;if(exp.kind!=='professor')throw new Error('wrong fixture');
 value(await repo.collect({...command,requestId:'second-course',experience:{...exp,courseName:'두 번째 수업'}}));
 assert.equal((await repo.updateExperience(ownerId,first.experience.id,first.experience.revision,{courseName:' 두 번째   수업 '})).ok,false);
 assert.equal(value(await repo.snapshot()).experiences.length,2);repo.close();
});
