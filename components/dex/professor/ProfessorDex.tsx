'use client';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useDexDocument } from '../scaffold/useDexDocument';
import { getBrowserRepository } from '@/lib/dex/storage/browser';
import { kstToday } from '@/lib/datetime';
import { CollectionArtwork } from '../common/CollectionArtwork';
import { courseLabel, matchesFaculty, normalizeSearch, professorFaculty, professorSubject, SEMESTERS } from '@/lib/dex/professor/catalog';
import type { Faculty, ProfessorEntry, CourseExperience, Semester } from '@/lib/dex/professor/catalog';
import { CollectionFeedback } from '../discovery/CollectionFeedback';
import type { CollectCommand, CollectResult, Result } from '@/lib/dex/core/types';
import './professor.css';

function unwrap<T>(result:Result<T>):T {if(!result.ok)throw new Error(result.error.message);return result.value;}
function useDraftGuard(dirty:boolean,busy:boolean){
  useEffect(()=>{
    if(!dirty&&!busy)return;
    const unload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    const click=(event:MouseEvent)=>{
      const link=event.target instanceof Element?event.target.closest('a[href]'):null;
      if(!link||link.getAttribute('target')==='_blank')return;
      if(busy||!window.confirm('저장하지 않은 입력이 있어요. 이 페이지를 나갈까요?')){event.preventDefault();event.stopPropagation();}
    };
    window.addEventListener('beforeunload',unload);document.addEventListener('click',click,true);
    return()=>{window.removeEventListener('beforeunload',unload);document.removeEventListener('click',click,true);};
  },[dirty,busy]);
}
export function ProfessorDex({catalog,checkedOn}:{catalog:Faculty[];checkedOn:string}){
  const {data,loading,error,reload}=useDexDocument();
  const [view,setView]=useState<'mine'|'directory'>('mine');
  const [search,setSearch]=useState(''),[college,setCollege]=useState(''),[limit,setLimit]=useState(24);
  const [selected,setSelected]=useState<Faculty|null>(null),[manual,setManual]=useState(false),[message,setMessage]=useState('');
  const heading=useRef<HTMLHeadingElement>(null);
  const [discovery,setDiscovery]=useState<CollectResult|null>(null);
  const shown=useRef(new Set<string>());
  const entries=(data?.entries.filter(e=>e.subject.kind==='professor')??[]) as ProfessorEntry[];
  const experiences=(data?.experiences.filter(e=>e.kind==='professor')??[]) as CourseExperience[];
  const saved=new Map(entries.map(e=>[e.subject.professorId,e]));
  const all=new Map(catalog.map(f=>[f.id,f]));for(const entry of entries)all.set(entry.subject.professorId,professorFaculty(entry.subject));
  const available=[...all.values()];
  const colleges=[...new Set(available.map(f=>f.college))].sort((a,b)=>a.localeCompare(b,'ko'));
  const rows=(view==='mine'?entries.map(e=>professorFaculty(e.subject)):[...available].sort((a,b)=>a.name.localeCompare(b.name,'ko'))).filter(f=>matchesFaculty(f,search,college));
  const selectedEntry=selected?saved.get(selected.id):undefined;
  function open(faculty:Faculty|null){setSelected(faculty);setManual(!faculty);setMessage('');}
  function close(){setSelected(null);setManual(false);requestAnimationFrame(()=>heading.current?.focus());}
  return <div className="professor-dex">
    {discovery?<CollectionFeedback result={{ok:true,value:discovery}} itemName={discovery.entry.subject.kind==='professor'?`${discovery.entry.subject.displayName} 교수님`:''} title="새로운 교수님 카드 발견!" onDismiss={()=>setDiscovery(null)} detailHref="/dex/professor" artwork={<ProfessorDiscoveryFace result={discovery}/>}>
      <p>수업에서 만난 교수님이 나의 도감에 등록되었어요.</p>
    </CollectionFeedback>:null}
    <section className="professor-hero">
      <div><span className="dex-eyebrow">PEOPLE WHO TAUGHT ME</span><h2 ref={heading} tabIndex={-1}>수업으로 만난,<br/><em>나의 교수도감.</em></h2><p>한 과목의 배움이 한 장의 카드로.<br/>직접 수강한 수업과 교수님을 함께 기억해요.</p></div>
      <div className="professor-hero-art"><CollectionArtwork kind="professor"/><span>MY CAMPUS FACULTY ARCHIVE</span></div>
    </section>
    <div className="professor-stats" aria-label="나의 교수도감 현황"><div><strong>{data?entries.length:'—'}</strong><span>수강한 교수님</span></div><div><strong>{data?experiences.length:'—'}</strong><span>남긴 수업 기록</span></div><div><strong>{catalog.length}</strong><span>공식 페이지 확인 명단</span></div></div>
    <p className="dex-small dex-muted">수강 등록은 직접 확인하는 기록이에요. LMS 수강 내역과 자동 연동되지 않으며, 교수님에 대한 등급이나 순위는 매기지 않아요.</p>
    {loading?<p role="status">내 수강 기록을 불러오는 중…</p>:null}
    {error?<p role="alert">{error} <button onClick={()=>void reload()}>다시 읽기</button></p>:null}
    {message?<p className="professor-notice" role="status">{message}</p>:null}
    <section className="professor-album">
      <div className="professor-toolbar"><div className="professor-tabs" aria-label="교수도감 보기">
        <button aria-pressed={view==='mine'} onClick={()=>{setView('mine');setLimit(24);}}>나의 교수님 <span>{entries.length}</span></button>
        <button aria-pressed={view==='directory'} onClick={()=>{setView('directory');setLimit(24);}}>교수진 찾아보기</button>
      </div><button className="dex-button professor-manual" disabled={!data} onClick={()=>open(null)}>+ 명단에 없는 교수님 등록</button></div>
      <div className="professor-filters"><label>이름·학과 검색<input type="search" value={search} placeholder="교수님 이름 또는 학과" onChange={e=>{setSearch(e.target.value);setLimit(24);}}/></label><label>단과대학<select value={college} onChange={e=>{setCollege(e.target.value);setLimit(24);}}><option value="">모든 단과대학</option>{colleges.map(c=><option key={c}>{c}</option>)}</select></label></div>
      {view==='directory'?<p className="professor-source-note">공식 페이지 확인일 {checkedOn} · 일부 학과·강사·겸임교원이 누락될 수 있어요. 명단은 현재 개설 강의 목록이 아니며, 전체 교수진 대비 수집률을 뜻하지 않아요. <a href="https://www.hanyang.ac.kr/e_college_department-info" target="_blank" rel="noreferrer">ERICA 학과 안내 ↗</a></p>:null}
      {data&&rows.length===0?<div className="professor-empty"><CollectionArtwork kind="professor"/><h3>{view==='mine'&&!entries.length?'첫 수업의 주인공을 등록해 볼까요?':'조건에 맞는 교수님이 없어요.'}</h3><p>{view==='mine'&&!entries.length?'수업을 들은 교수님을 찾아 과목명과 학기를 남겨 보세요.':'검색 조건을 바꾸거나 명단에 없는 교수님을 직접 등록할 수 있어요.'}</p><button className="dex-button" onClick={()=>{setSearch('');setCollege('');setView('directory');}}>교수진 찾아보기 ↗</button></div>:null}
      {rows.length>0?<p className="dex-small dex-muted">{rows.length}명 표시 · 수강한 교수님은 카드에 도장이 남아요.</p>:null}
      <div className="professor-grid">{rows.slice(0,limit).map((faculty,index)=>{
        const entry=saved.get(faculty.id),courses=entry?experiences.filter(e=>e.entryId===entry.id):[];
        const latest=[...courses].sort((a,b)=>b.academicYear-a.academicYear||['winter','2','summer','1'].indexOf(a.semester)-['winter','2','summer','1'].indexOf(b.semester))[0];
        return <article key={faculty.id} className={`professor-card ${entry?'is-collected':''}`}>
          <div className="professor-card-top"><span>{faculty.college}</span><span className="professor-card-number">{String(index+1).padStart(3,'0')}</span></div>
          <div className="professor-portrait"><CollectionArtwork kind="professor"/>{entry?<span className="professor-stamp">수강 기록</span>:<span className="professor-uncollected">아직 만나지 않은 배움</span>}</div>
          <div className="professor-card-body"><p>{faculty.department}</p><h3>{faculty.name} <small>교수님</small></h3><p className="professor-course-summary">{latest?<>{latest.courseName}<br/><small>{courseLabel(latest)} · 총 {courses.length}개 수업</small></>:'수업을 수강하면 나의 도감에 등록돼요.'}</p>
          <button disabled={!data} onClick={()=>open(faculty)}>{entry?'수강 기록 보기 · 추가':'이 교수님 수업을 들었어요'} <span aria-hidden="true">↗</span></button></div>
        </article>;
      })}</div>
      {rows.length>limit?<button className="professor-more" onClick={()=>setLimit(v=>v+24)}>교수님 더 보기 ({Math.min(limit,rows.length)} / {rows.length})</button>:null}
    </section>
    {(selected||manual)&&data?<ProfessorPanel key={selected?.id??'manual'} faculty={selected} entry={selectedEntry} records={experiences.filter(e=>e.entryId===selectedEntry?.id)} ownerId={data.profile.ownerId} onClose={close} onChanged={reload} onSaved={(name,result)=>{
      close();setMessage(`${name} 교수님의 수강 기록을 저장했어요.`);
      setView('mine');setSearch('');setCollege('');setLimit(24);
      if(result&&!result.replayed&&!shown.current.has(result.experience.id)){
        shown.current.add(result.experience.id);setDiscovery(result);
      }
    }}/>:null}
  </div>;
}
function ProfessorPanel({faculty,entry,records,ownerId,onClose,onChanged,onSaved}:{faculty:Faculty|null;entry?:ProfessorEntry;records:CourseExperience[];ownerId:string;onClose:()=>void;onChanged:()=>Promise<void>;onSaved:(name:string,result?:CollectResult)=>void}){
  const [name,setName]=useState(''),[department,setDepartment]=useState(''),[college,setCollege]=useState('');
  const [course,setCourse]=useState(''),[year,setYear]=useState(Number(kstToday().slice(0,4))),[semester,setSemester]=useState<Semester>(Number(kstToday().slice(5,7))>=7?'2':'1');
  const [note,setNote]=useState(''),[confirmed,setConfirmed]=useState(false),[editing,setEditing]=useState<CourseExperience|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const active=useRef(false),dialog=useRef<HTMLDialogElement>(null),pending=useRef<{key:string;command:CollectCommand}|null>(null);
  const dirty=!!(name||department||college||course||note||confirmed||editing);
  useDraftGuard(dirty,busy);
  useEffect(()=>{const element=dialog.current;element?.showModal();return()=>{element?.close();};},[]);
  function dismiss(){if(active.current)return;if(dirty&&!window.confirm('저장하지 않은 입력을 닫을까요?'))return;onClose();}
  async function action(work:()=>Promise<void>){
    if(active.current)return;active.current=true;setBusy(true);setError('');
    try{await work();}catch(e){setError(e instanceof Error?e.message:'저장하지 못했어요. 입력은 유지되니 다시 시도해 주세요.');}finally{active.current=false;setBusy(false);}
  }
  async function save(event:FormEvent){
    event.preventDefault();if(!confirmed)return;
    await action(async()=>{
      const repo=getBrowserRepository();
      if(editing){unwrap(await repo.updateExperience(ownerId,editing.id,editing.revision,{courseName:course.trim(),academicYear:year,semester,note:note.trim()}));await onChanged();onSaved(faculty?.name??name);return;}
      const doc=unwrap(await repo.snapshot());
      const chosen=faculty??{id:'manual-'+crypto.randomUUID(),name:name.trim(),department:department.trim()||'소속 미입력',college:college.trim()||'소속 미입력'};
      const identity=normalizeSearch(chosen.name+'|'+chosen.college+'|'+chosen.department);
      const existing=doc.entries.find((e):e is ProfessorEntry=>e.subject.kind==='professor'&&(e.subject.professorId===chosen.id||(!faculty&&normalizeSearch(e.subject.displayName+'|'+e.subject.college+'|'+e.subject.department)===identity)));
      const dex=doc.dexes.find(d=>d.kind==='professor')??unwrap(await repo.createDex(ownerId,{kind:'professor',name:'교수도감',icon:'book'}));
      const subject=existing?.subject??professorSubject(chosen);
      const key=JSON.stringify([subject,course.trim(),year,semester,note.trim()]);
      if(pending.current?.key!==key)pending.current={key,command:{ownerId,dexId:dex.id,requestId:crypto.randomUUID(),...(existing?{entryId:existing.id}:{}),subject,experience:{kind:'professor',courseName:course.trim(),academicYear:year,semester,experiencedOn:kstToday(),note:note.trim()}}};
      const result=unwrap(await repo.collect(pending.current.command));await onChanged();onSaved(chosen.name,result);
    });
  }
  function edit(record:CourseExperience){
    if(dirty&&!window.confirm('현재 입력을 바꾸고 이 기록을 수정할까요?'))return;
    setEditing(record);setCourse(record.courseName);setYear(record.academicYear);setSemester(record.semester);setNote(record.note);setConfirmed(true);setError('');
  }
  function cancelEdit(){if(dirty&&!window.confirm('수정 중인 입력을 취소할까요?'))return;setEditing(null);setCourse('');setNote('');setConfirmed(false);}
  return <dialog ref={dialog} className="professor-dialog" aria-labelledby="professor-panel-title" onCancel={e=>{e.preventDefault();dismiss();}}>
    <div className="professor-dialog-heading"><div><span className="dex-eyebrow">MY LEARNING RECORD</span><h2 id="professor-panel-title">{faculty?`${faculty.name} 교수님`:'명단에 없는 교수님 등록'}</h2></div><button type="button" disabled={busy} onClick={dismiss} aria-label="수강 기록 창 닫기">✕</button></div>
    {faculty?<p className="dex-muted">{faculty.college} · {faculty.department}{faculty.sourceUrl?<> · <a href={faculty.sourceUrl} target="_blank" rel="noreferrer">공식 소개 ↗</a></>:null}</p>:<p className="dex-muted">강사·겸임교원도 직접 수강한 수업이 있으면 기록할 수 있어요. 직접 입력한 정보는 공식 명단으로 표시하지 않아요.</p>}
    <form onSubmit={e=>void save(e)}><fieldset disabled={busy}>
      {!faculty?<div className="professor-form-grid"><label>교수님 이름<input autoFocus required maxLength={80} value={name} onChange={e=>setName(e.target.value)} /></label><label>단과대학 <small>선택</small><input maxLength={80} value={college} onChange={e=>setCollege(e.target.value)} placeholder="예: 소프트웨어융합대학"/></label><label>학과 <small>선택</small><input maxLength={80} value={department} onChange={e=>setDepartment(e.target.value)} placeholder="예: 인공지능학과"/></label></div>:null}
      <h3>{editing?'수강 기록 수정':entry?'다른 수업도 들었나요?':'어떤 수업을 들었나요?'}</h3>
      <label>과목명<input autoFocus={!!faculty} required maxLength={120} value={course} onChange={e=>setCourse(e.target.value)} placeholder="예: 인공지능개론"/></label>
      <div className="professor-form-grid"><label>수강 연도<input type="number" required min={1939} max={Number(kstToday().slice(0,4))} value={year} onChange={e=>setYear(Number(e.target.value))}/></label><label>수강 학기<select value={semester} onChange={e=>setSemester(e.target.value as Semester)}>{Object.entries(SEMESTERS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div>
      <label>배운 것 · 기억할 점 <small>선택</small><textarea value={note} maxLength={500} rows={3} onChange={e=>setNote(e.target.value)} placeholder="기억에 남는 내용이나 다음 수업에 참고할 점을 남겨요."/></label>
      <label className="professor-confirm"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>이 교수님의 해당 수업을 수강했어요. (수강 중 포함)</label>
      <div className="professor-form-actions"><button className="dex-button" type="submit" disabled={!confirmed||!course.trim()||(!faculty&&!name.trim())}>{busy?'저장 중…':editing?'수정 내용 저장':entry?'수업 기록 추가':'교수도감에 등록'}</button>{editing?<button type="button" onClick={cancelEdit}>수정 취소</button>:null}</div>
    </fieldset></form>
    {error?<p role="alert" className="professor-error">{error}</p>:null}
    {entry?<section className="professor-records"><h3>함께한 수업 {records.length}개</h3>{records.length===0?<p>남아 있는 수업 기록이 없어요. 수업을 추가하거나 아래에서 카드를 삭제할 수 있어요.</p>:null}{[...records].sort((a,b)=>b.academicYear-a.academicYear||b.createdAt.localeCompare(a.createdAt)).map(record=><article key={record.id}><span>{courseLabel(record)}</span><h4>{record.courseName}</h4>{record.note?<p>{record.note}</p>:null}<div><button type="button" disabled={busy} onClick={()=>edit(record)}>수정</button><button type="button" disabled={busy} onClick={()=>{if(dirty){setError('작성 중인 수업을 먼저 저장하거나 창을 닫고 다시 열어 주세요.');return;}if(window.confirm('이 수업 기록을 삭제할까요? 교수님 카드는 유지돼요.'))void action(async()=>{unwrap(await getBrowserRepository().deleteExperience(ownerId,record.id,record.revision));await onChanged();});}}>수업 삭제</button></div></article>)}<button type="button" className="professor-delete" disabled={busy} onClick={()=>{if(window.confirm('교수님 카드와 모든 수강 기록을 삭제할까요?'))void action(async()=>{unwrap(await getBrowserRepository().deleteEntry(ownerId,entry.id,entry.revision));await onChanged();onClose();});}}>교수님 카드와 수강 기록 모두 삭제</button></section>:null}
    <p className="dex-small dex-muted">이 브라우저에 저장해요. 도감 홈에서 다른 도감과 함께 내보내기 할 수 있어요.</p>
  </dialog>;
}

function ProfessorDiscoveryFace({result}:{result:CollectResult}){
  const subject=result.entry.subject,experience=result.experience;
  if(subject.kind!=='professor'||experience.kind!=='professor')return null;
  return <div className="professor-discovery-face">
    <span className="professor-discovery-college">{subject.college}</span>
    <CollectionArtwork kind="professor"/>
    <p className="professor-discovery-department">{subject.department}</p>
    <div className="professor-discovery-course"><strong>{experience.courseName}</strong><span>{courseLabel(experience)}</span></div>
  </div>;
}
