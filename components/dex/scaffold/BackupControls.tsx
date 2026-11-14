'use client';
import { useState } from 'react';
import { Card } from '@/components/ui';
import { getBrowserRepository } from '@/lib/dex/storage/browser';
import type { ImportPreview } from '@/lib/dex/core/types';

export function BackupControls({ownerId,onChanged}:{ownerId?:string;onChanged:()=>Promise<void>}) {
  const [message,setMessage]=useState('');
  const [preview,setPreview]=useState<ImportPreview|null>(null);
  const [confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false);
  async function exportFile(recovery=false) {
    setBusy(true);
    try {
      const repository=getBrowserRepository();
      const result=recovery?await repository.exportRecovery():ownerId?await repository.exportRecords(ownerId):null;
      if(!result)return;
      if(!result.ok){setMessage(result.error.message);return;}
      const url=URL.createObjectURL(result.value);
      const anchor=document.createElement('a');anchor.href=url;anchor.download=recovery?'bokak-dex-recovery.json':'bokak-dex-backup.json';anchor.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      setMessage('평문 백업 파일을 안전한 개인 위치에 보관해 주세요.');
    } finally {setBusy(false);}
  }
  async function inspect(file:File) {
    setBusy(true);setPreview(null);setConfirmed(false);
    try {
      const result=await getBrowserRepository().previewImport(file);
      if(result.ok){setPreview(result.value);setMessage('아직 기록을 변경하지 않았습니다. 아래 건수와 교체 정책을 확인하세요.');}
      else setMessage(result.error.message);
    } finally {setBusy(false);}
  }
  async function restore() {
    if(!preview||!confirmed)return;
    setBusy(true);
    try {
      const result=await getBrowserRepository().commitImport({token:preview.token,strategy:'replace',confirmed:true});
      setMessage(result.ok?'가져오기를 완료했습니다.':result.error.message);
      setPreview(null);setConfirmed(false);await onChanged();
    } finally {setBusy(false);}
  }
  return <Card className="space-y-3 p-5">
    <h2 className="font-semibold">기록 보존</h2>
    <p className="text-sm text-[var(--e-ink-2)]">내보내기에는 개인 메모·인연 정보가 들어갈 수 있어요. 암호화되지 않은 JSON이며, 사이트 데이터 삭제 전 별도로 보관해 주세요.</p>
    <div className="flex flex-wrap gap-3">
      <button className="rounded-lg border px-3 py-2 disabled:opacity-50" disabled={busy||!ownerId} onClick={()=>void exportFile()}>JSON 내보내기</button>
      {!ownerId?<button className="rounded-lg border px-3 py-2" disabled={busy} onClick={()=>void exportFile(true)}>손상 기록 복구용 내보내기</button>:null}
      <label className="text-sm">JSON 가져오기<input className="mt-1 block max-w-full" disabled={busy} type="file" accept=".json,application/json" onChange={e=>{const file=e.target.files?.[0];if(file)void inspect(file);e.target.value='';}}/></label>
    </div>
    {preview?<div className="space-y-2 rounded-lg border p-3">
      <p>도감 {preview.counts.dexes}개 · 카드 {preview.counts.entries}개 · 경험 {preview.counts.experiences}개</p>
      {preview.warnings.map(w=><p key={w} className="text-sm">{w}</p>)}
      <label className="block"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> 현재 기록 전체 교체를 확인했습니다.</label>
      <button disabled={busy||!confirmed} className="rounded-lg border px-3 py-2 disabled:opacity-50" onClick={()=>void restore()}>기존 기록 전체 교체</button>
      <button className="ml-3 underline" onClick={()=>{setPreview(null);setConfirmed(false);}}>취소</button>
    </div>:null}
    {message?<p role="status" className="text-sm">{message}</p>:null}
  </Card>;
}
