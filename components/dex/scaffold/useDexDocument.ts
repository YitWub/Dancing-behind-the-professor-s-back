'use client';
import { useCallback, useEffect, useState } from 'react';
import type { DexDocument, Result } from '@/lib/dex/core/types';
import { getBrowserRepository, subscribeToLocalChanges } from '@/lib/dex/storage/browser';

/** A 임시 골격용 로더. 도메인 화면은 repository 공개 포트로 교체할 수 있다. */
export function useDexDocument() {
  const [state,setState] = useState<{ loading:boolean; data:DexDocument|null; error:string|null }>({loading:true,data:null,error:null});
  const read = useCallback(async (): Promise<Result<DexDocument>> => {
    const repository=getBrowserRepository();
    const opened=await repository.open();
    return opened.ok ? repository.snapshot() : opened;
  },[]);
  const reload = useCallback(async () => {
    const result=await read();
    setState({loading:false,data:result.ok?result.value:null,error:result.ok?null:result.error.message});
  },[read]);
  useEffect(()=>{
    let alive=true;
    const load=()=>{ void read().then(result=>{
      if(alive)setState({loading:false,data:result.ok?result.value:null,error:result.ok?null:result.error.message});
    }); };
    load();
    const unsubscribe=subscribeToLocalChanges(load);
    return ()=>{alive=false;unsubscribe();};
  },[read]);
  return {...state,reload};
}
