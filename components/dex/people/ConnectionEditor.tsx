'use client';
import {useState} from 'react';
import type {BoardConnection} from '@/lib/dex/people/connections';
import type {ThreadStyle,BoardCommand} from '@/lib/dex/people/board';
import {THREAD_PRESETS} from './board-style';
import {usePeopleLeaveGuard} from './PeopleForms';
export function ConnectionEditor({connection,isNew,busy,onSave,onClose}:{connection:BoardConnection;isNew:boolean;busy:boolean;onSave:(c:BoardCommand)=>Promise<boolean>;onClose:()=>void}){
 const [label,setLabel]=useState(connection.label),[style,setStyle]=useState<ThreadStyle>(connection.style);
 const dirty=label!==connection.label||style!==connection.style;usePeopleLeaveGuard(dirty,busy);
 return <form className="people-paper board-connection-editor" onSubmit={async e=>{e.preventDefault();if(await onSave(isNew?{type:'connect-objects',connection:{...connection,label,style}}:{type:'edit-connection',id:connection.id,label,style}))onClose();}}><h3>{isNew?'새 실 연결':'실 편집'}</h3><fieldset disabled={busy}><label>관계 설명 <small>선택 · 80자 이내</small><input autoFocus maxLength={80} value={label} onChange={e=>setLabel(e.target.value)}/></label><label>실 스타일<select aria-label="편집할 실 스타일" value={style} onChange={e=>setStyle(e.target.value as ThreadStyle)}>{Object.entries(THREAD_PRESETS).map(([key,s])=><option key={key} value={key}>{s.label}</option>)}</select></label><div className="people-actions"><button type="submit">{isNew?'실 연결 저장':'실 변경 저장'}</button><button type="button" onClick={()=>{if(!dirty||window.confirm('저장하지 않은 설명을 취소할까요?'))onClose();}}>연결 편집 닫기</button>{!isNew?<button type="button" onClick={async()=>{if(window.confirm('이 실만 삭제할까요? 연결된 객체는 남아요.')&&await onSave({type:'delete-connection',id:connection.id}))onClose();}}>실 삭제</button>:null}</div></fieldset></form>;
}
