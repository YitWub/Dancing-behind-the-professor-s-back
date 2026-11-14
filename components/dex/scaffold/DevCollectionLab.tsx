'use client';
import { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui';
import { IndexedDbDexRepository } from '@/lib/dex/storage/indexeddb';
import type { CollectCommand, DexDocument, Result, CollectResult } from '@/lib/dex/core/types';
import { kstToday } from '@/lib/datetime';

export function DevCollectionLab() {
  const repository=useRef<IndexedDbDexRepository|null>(null);
  const fail=useRef(false);
  const [lastRequest,setLastRequest]=useState<CollectCommand|null>(null);
  const [data,setData]=useState<DexDocument|null>(null);
  const [message,setMessage]=useState('격리 저장소를 준비하는 중…');
  const [busy,setBusy]=useState(false);
  const [note,setNote]=useState('개발용 메모');
  useEffect(()=>{
    let alive=true;
    const repo=new IndexedDbDexRepository({databaseName:'bokak.dex.development-lab',namespace:'development',beforeCommit:()=>{
      if(fail.current){fail.current=false;throw new DOMException('개발 검증용 저장 오류','QuotaExceededError');}
    }});
    repository.current=repo;
    void (async()=>{
      const opened=await repo.open();
      if(!alive){repo.close();return;}
      if(!opened.ok){if(alive)setMessage(opened.error.message);return;}
      let snapshot=await repo.snapshot();
      if(!alive){repo.close();return;}
      if(snapshot.ok&&!snapshot.value.dexes.some(d=>d.kind==='custom')){
        const created=await repo.createDex(opened.value.ownerId,{kind:'custom',name:'개발 검증 전용 도감',icon:'book'});
        if(!created.ok){if(alive)setMessage(created.error.message);return;}
        snapshot=await repo.snapshot();
      }
      if(alive){if(snapshot.ok){setData(snapshot.value);setMessage('가상 검증 데이터만 사용하는 별도 DB입니다.');}else setMessage(snapshot.error.message);}
    })();
    return ()=>{alive=false;repo.close();repository.current=null;};
  },[]);
  const dex=data?.dexes.find(d=>d.kind==='custom');
  const entries=data?.entries.filter(e=>e.dexId===dex?.id)??[];
  const experiences=data?.experiences.filter(e=>e.dexId===dex?.id)??[];
  async function refresh() {const result=await repository.current!.snapshot();if(result.ok)setData(result.value);else setMessage(result.error.message);}
  async function run(operation:()=>Promise<Result<unknown>>) {
    if(busy)return;setBusy(true);
    try {
      const result=await operation();
      if(result.ok){
        const value=result.value as Partial<CollectResult>|undefined;
        setMessage(value?.outcome?JSON.stringify({outcome:value.outcome,replayed:value.replayed,discovery:!!value.discovery}):'저장 완료');
      }else setMessage(`${result.error.code}: ${result.error.message}`);
      await refresh();
    }finally{setBusy(false);}
  }
  function command(revisit:boolean):CollectCommand {
    return {ownerId:data!.profile.ownerId,dexId:dex!.id,requestId:crypto.randomUUID(),
      subject:revisit?entries[0].subject:{kind:'custom',title:'가상 검증 항목'},
      ...(revisit?{entryId:entries[0].id}:{}),experience:{kind:'custom',experiencedOn:kstToday(),note:'검증 전용 경험'}};
  }
  function save(revisit:boolean,inject=false){
    const input=command(revisit);setLastRequest(input);
    if(inject)fail.current=true;
    void run(()=>repository.current!.collect(input));
  }
  const latest=[...experiences].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
  const button='rounded-lg border px-3 py-2 disabled:opacity-40';
  return <Card className="space-y-4 p-5">
    <h2 className="text-xl font-bold">개발 전용 수집 검증</h2>
    <p>가상 데이터 · 개인 도감 DB와 분리 · 프로덕션에서는 접근할 수 없습니다.</p>
    <p data-testid="lab-counts">카드 {entries.length}개 · 경험 {experiences.length}개</p>
    <div className="flex flex-wrap gap-2">
      <button className={button} disabled={busy||!dex||entries.length>0} onClick={()=>save(false)}>최초 수집</button>
      <button className={button} disabled={busy||!entries.length} onClick={()=>save(true)}>재방문 기록</button>
      <button className={button} disabled={busy||!lastRequest} onClick={()=>void run(()=>repository.current!.collect(lastRequest!))}>동일 요청 재전송</button>
      <button className={button} disabled={busy||!dex} onClick={()=>save(entries.length>0,true)}>저장 실패 주입</button>
      <button className={button} disabled={busy} onClick={()=>window.location.reload()}>새로고침 확인</button>
    </div>
    <label className="block">최근 경험 메모<input className="ml-2 rounded border p-2" value={note} onChange={e=>setNote(e.target.value)}/></label>
    <button className={button} disabled={busy||!latest} onClick={()=>void run(()=>repository.current!.updateExperience(data!.profile.ownerId,latest.id,latest.revision,{note}))}>메모 수정</button>
    <button className={button} disabled={busy||!latest} onClick={()=>void run(()=>repository.current!.deleteExperience(data!.profile.ownerId,latest.id,latest.revision))}>최근 경험 삭제</button>
    <p role="status" data-testid="lab-result">{message}</p>
    <ul aria-label="검증 경험 목록">{experiences.map(e=><li key={e.id}>{e.experiencedOn} · {e.note} · 수정 {e.revision}</li>)}</ul>
  </Card>;
}
