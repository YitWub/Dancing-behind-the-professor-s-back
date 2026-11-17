'use client';
import {ConnectionEditor} from './ConnectionEditor';
import {objectExists,refKey} from '@/lib/dex/people/connections';
import type {ObjectRef,BoardConnection} from '@/lib/dex/people/connections';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Dex, DexDocument } from '@/lib/dex/core/types';
import { getBrowserRepository } from '@/lib/dex/storage/browser';
import { peopleView } from '@/lib/dex/people/view';
import { BOARD_WIDTH,BOARD_HEIGHT,CARD_WIDTH,CARD_HEIGHT,clampPosition, type BoardCommand, type BoardPosition } from '@/lib/dex/people/board';
import { emptyCardPosition } from '@/lib/dex/people/board-presentation';
import { PersonAvatar,PersonFeatures } from './PersonCard';
import { BoardThreads } from './BoardThreads';
import { optimizePhoto } from '@/lib/dex/people/photo';
import type { PreparedImage,BoardPhoto } from '@/lib/dex/people/photo';
import { BoardPhotoCard,PhotoDetail } from './BoardPhotoCard';
import { BoardNoteCard,NoteEditor } from './BoardNoteCard';
import { THREAD_PRESETS } from './board-style';
import type { ThreadStyle,BoardNote,NoteColor } from '@/lib/dex/people/board';
import type { BoardManagementCommand,PeopleBoardRecord } from '@/lib/dex/people/multi-board';
import { usePeopleLeaveGuard } from './PeopleForms';

export function PeopleBoard({data,onChanged,onAddPerson}:{data:DexDocument;onChanged:()=>Promise<void>;onAddPerson:()=>void}){
 const dex=data.dexes.find(d=>d.peopleBoards)??data.dexes.find(d=>d.kind==='people');
 const collection=dex?.peopleBoards,record=collection?.boards.find(b=>b.id===collection.activeBoardId);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[guard,setGuard]=useState(false),[form,setForm]=useState<'create'|'rename'|null>(null),[name,setName]=useState(''),[creationId,setCreationId]=useState(''),[entryId,setEntryId]=useState('');
 const active=useRef(false),menu=useRef<HTMLDetailsElement>(null),migrationAttempt=useRef('');const [placing,setPlacing]=useState(false);
 const needsConnections=!!collection?.boards.some(b=>b.layout.version!==4);
 const rootId=dex?.id,rootRevision=dex?.revision,ownerId=data.profile.ownerId;
 const request=useCallback(async(targetId:string,targetRevision:number,command:BoardManagementCommand)=>{
  if(active.current)return false;active.current=true;setBusy(true);setMessage('');
  try{const result=await getBrowserRepository().managePeopleBoards(ownerId,targetId,targetRevision,command);if(!result.ok){setMessage(result.error.message);await onChanged();return false;}setMessage(command.type==='initialize'?'':'보드 변경을 저장했어요.');await onChanged();return true;}
  catch{setMessage('보드 변경을 저장하지 못했어요. 기존 기록은 유지됩니다.');return false;}
  finally{active.current=false;setBusy(false);}
 },[ownerId,onChanged]);
 const run=(command:BoardManagementCommand)=>rootId&&rootRevision!==undefined?request(rootId,rootRevision,command):Promise.resolve(false);
 useEffect(()=>{if(rootId&&rootRevision!==undefined&&!collection&&!active.current)void request(rootId,rootRevision,{type:'initialize'});},[rootId,rootRevision,collection,request]);
 useEffect(()=>{const key=rootId+':'+rootRevision;if(rootId&&rootRevision!==undefined&&needsConnections&&!busy&&!active.current&&migrationAttempt.current!==key){migrationAttempt.current=key;void request(rootId,rootRevision,{type:'migrate-connections'});}},[rootId,rootRevision,needsConnections,busy,request]);
 usePeopleLeaveGuard(!!form&&!!name,busy);
 if(!dex)return <p>인연도감을 찾을 수 없어요.</p>;
 if(!collection||!record)return <section><p role="status">{message||'기존 보드를 안전하게 불러오는 중…'}</p><button disabled={busy} onClick={()=>void run({type:'initialize'})}>보드 이전 다시 시도</button></section>;
 const blocked=busy||guard||!!form;
 const available=peopleView(data).filter(e=>!record.layout.positions.some(p=>p.entryId===e.id));
 return <section className="people-notebook-board" aria-label="인연 배치 보드"><div className="people-board-bar">
<label className="people-board-switch"><span className="people-sr-only">현재 보드</span><select aria-label="현재 보드" value={record.id} disabled={blocked||placing} onChange={e=>void run({type:'select',boardId:e.target.value})}>{collection.boards.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><span className="people-board-summary">카드 {record.layout.positions.length} · 실 {record.layout.connections?.length??0}</span>
<button className="people-place-trigger" disabled={blocked} aria-expanded={placing} aria-controls="people-placement-panel" onClick={()=>setPlacing(!placing)}>인연 배치 <span aria-hidden="true">＋</span></button>
<details ref={menu} className="people-board-menu" onKeyDown={e=>{if(e.key==='Escape'){e.currentTarget.open=false;e.currentTarget.querySelector('summary')?.focus();}}} onBlur={e=>{if(e.relatedTarget instanceof Node&&!e.currentTarget.contains(e.relatedTarget))e.currentTarget.open=false;}}><summary aria-label="보드 관리" aria-disabled={blocked||placing} onClick={e=>{if(blocked||placing)e.preventDefault();}}>보드 관리 <span aria-hidden="true">···</span></summary><div className="people-board-menu-items"><button disabled={blocked||placing} onClick={()=>{if(menu.current)menu.current.open=false;setCreationId('board-'+crypto.randomUUID());setName('');setForm('create');}}>새 보드 만들기</button><button disabled={blocked||placing} onClick={()=>{if(menu.current)menu.current.open=false;setName(record.name);setForm('rename');}}>보드 이름 바꾸기</button><button className="people-danger-action" disabled={blocked||placing||collection.boards.length===1} onClick={()=>{if(menu.current)menu.current.open=false;if(window.confirm('이 보드의 배치·실·메모·사진을 삭제할까요? 인연 원본과 추억, 다른 보드는 유지돼요.'))void run({type:'delete',boardId:record.id});}}>현재 보드 삭제</button></div></details></div>
 {form?<form className="people-paper" onSubmit={async e=>{e.preventDefault();if(await run(form==='create'?{type:'create',id:creationId,name}:{type:'rename',boardId:record.id,name}))setForm(null);}}><label>보드 이름<input autoFocus required maxLength={80} value={name} disabled={busy} onChange={e=>setName(e.target.value)}/></label><div className="people-actions"><button disabled={busy} type="submit">보드 저장</button><button disabled={busy} type="button" onClick={()=>setForm(null)}>취소</button></div></form>:null}
 {placing?<form id="people-placement-panel" className="people-placement-panel" onSubmit={async e=>{e.preventDefault();if(await run({type:'place',boardId:record.id,entryId})){setPlacing(false);setEntryId('');}}}><label>기존 인연을 이 보드에 배치<select autoFocus aria-label="배치할 기존 인연" disabled={blocked} value={available.some(e=>e.id===entryId)?entryId:''} onChange={e=>setEntryId(e.target.value)}><option value="">현재 보드에 없는 인연 선택</option>{available.map((e,i)=><option key={e.id} value={e.id}>{i+1}. {e.subject.nickname||e.subject.displayName}{e.subject.nickname?' · '+e.subject.displayName:''}</option>)}</select></label><div className="people-actions"><button type="submit" disabled={blocked||!available.some(e=>e.id===entryId)}>현재 보드에 배치</button><button type="button" disabled={busy} onClick={()=>setPlacing(false)}>배치 닫기</button></div><p>{available.length?'원본 인연을 새로 만들지 않고, 이 보드에 카드만 배치해요.':'모든 인연이 이 보드에 있어요. 새 만남은 새 인연 발견으로 기록해 주세요.'}</p></form>:null}
 <p role="status">{message}</p>{needsConnections?<button disabled={busy} onClick={()=>void run({type:'migrate-connections'})}>실 이전 다시 시도</button>:null}<BoardCanvas key={record.id} dex={dex} record={record} data={data} onChanged={onChanged} onAddPerson={onAddPerson} managementBusy={busy||!!form||needsConnections||placing} onGuardChange={setGuard} onRemove={entryId=>run({type:'remove',boardId:record.id,entryId})} onZoom={zoom=>run({type:'view',boardId:record.id,zoom})}/></section>;
}
function BoardCanvas({dex,record,data,onChanged,onAddPerson,managementBusy,onGuardChange,onRemove,onZoom}:{dex:Dex;record:PeopleBoardRecord;data:DexDocument;onChanged:()=>Promise<void>;onAddPerson:()=>void;managementBusy:boolean;onGuardChange:(blocked:boolean)=>void;onRemove:(entryId:string)=>Promise<boolean>;onZoom:(zoom:.5|.75|1)=>Promise<boolean>}){
 const board=record.layout,entries=peopleView(data).filter(e=>board.positions.some(p=>p.entryId===e.id));
 const router=useRouter(),viewport=useRef<HTMLDivElement>(null),active=useRef(false);
 const [mode,setMode]=useState<'move'|'connect'>('move'),[first,setFirst]=useState<ObjectRef|null>(null),[selected,setSelected]=useState(''),[zoom,setZoom]=useState<.5|.75|1>(record.view.zoom),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[preview,setPreview]=useState<BoardPosition|null>(null),[failed,setFailed]=useState<BoardCommand|null>(null);
 const [connectionEditor,setConnectionEditor]=useState<{connection:BoardConnection;isNew:boolean}|null>(null),[objectPreviews,setObjectPreviews]=useState(new Map<string,{x:number;y:number}>());
 const selectedFirst=first&&objectExists(board,first)?first:null;
 const [threadStyle,setThreadStyle]=useState<ThreadStyle>('red'),[noteEditor,setNoteEditor]=useState<'new'|BoardNote|null>(null),[selectedNote,setSelectedNote]=useState('');
 const photoInput=useRef<HTMLInputElement>(null);
 const [showPhotoInfo,setShowPhotoInfo]=useState(false);
 const [uploading,setUploading]=useState(false),[uploadFailed,setUploadFailed]=useState<{id:string;image:PreparedImage}|null>(null),[photoEditor,setPhotoEditor]=useState<BoardPhoto|null>(null),[selectedPhoto,setSelectedPhoto]=useState('');
 async function storePhoto(payload:{id:string;image:PreparedImage}){
  if(active.current)return;active.current=true;setUploading(true);setMessage('사진 저장 중…');
  try{const result=await getBrowserRepository().addBoardPhoto(dex.ownerId,dex.id,dex.revision,{id:payload.id,assetId:'img-'+payload.image.sha256,caption:'',size:'medium'},payload.image,record.id);
   if(result.ok){setUploadFailed(null);setShowPhotoInfo(false);setMessage('사진을 보드에 붙였어요.');await onChanged();}
   else{setUploadFailed(payload);setMessage('사진을 저장하지 못했어요. '+result.error.message);await onChanged();}
  }catch{setUploadFailed(payload);setMessage('사진을 저장하지 못했어요. 다시 시도해 주세요.');}
  finally{active.current=false;setUploading(false);}
 }
 async function upload(file:File){if(active.current)return;setUploading(true);setMessage('이 브라우저에서 사진을 최적화하는 중…');try{const image=await optimizePhoto(file);await storePhoto({id:'photo-'+crypto.randomUUID(),image});}catch(error){setMessage(error instanceof Error?error.message:'사진을 읽지 못했어요.');}finally{setUploading(false);}}
 const [noteRequest,setNoteRequest]=useState('');
 const drag=useRef<{id:string;pointer:number;startX:number;startY:number;x:number;y:number;moved:boolean}|null>(null),suppressClick=useRef(false);
 const save=useCallback(async(command:BoardCommand)=>{
  if(active.current)return false;active.current=true;setBusy(true);setMessage('저장 중…');
  try{const result=await getBrowserRepository().updatePeopleBoard(dex.ownerId,dex.id,dex.revision,command,record.id);
   if(result.ok){if(command.type==='connect-objects'||command.type==='edit-connection'||command.type==='delete-connection'){setConnectionEditor(null);setFirst(null);}if(command.type==='add-note'||command.type==='edit-note')setNoteEditor(null);setFailed(null);setPreview(null);setMessage('저장했어요.');await onChanged();return true;}
   else{setFailed(command);setMessage('저장하지 못했어요. '+result.error.message);await onChanged();return false;}
  }catch{setFailed(command);setMessage('저장하지 못했어요. 다시 시도해 주세요.');return false;}
  finally{active.current=false;setBusy(false);}
 },[dex.ownerId,dex.id,dex.revision,record.id,onChanged]);
 const missing=entries.some(e=>!board?.positions.some(p=>p.entryId===e.id));
 useEffect(()=>{if(missing&&!failed&&!active.current&&!noteEditor&&!uploading&&!photoEditor&&!uploadFailed)void save({type:'initialize'});},[missing,failed,save,noteEditor,uploading,photoEditor,uploadFailed]);
 usePeopleLeaveGuard(!!failed||!!preview||!!uploadFailed,busy||uploading);
 const positions=new Map((board?.positions??[]).map(p=>[p.entryId,p]));
 if(preview&&entries.some(e=>e.id===preview.entryId))positions.set(preview.entryId,preview);
 function chooseObject(ref:ObjectRef){
  if(toolsDisabled)return;
  if(!selectedFirst){setFirst(ref);setMessage('두 번째 객체를 선택해 주세요.');return;}
  if(refKey(selectedFirst)===refKey(ref)){setMessage('같은 객체에는 연결할 수 없어요. 다른 객체를 선택해 주세요.');return;}
  const connection:BoardConnection={id:'connection-'+crypto.randomUUID(),boardId:record.id,from:selectedFirst,to:ref,style:threadStyle,label:'',createdAt:new Date().toISOString()};
  setFirst(null);void save({type:'connect-objects',connection});
 }
 function choose(id:string){setSelected(id);if(mode==='move'){router.push('/dex/people/'+id);return;}const p=board.positions.find(p=>p.entryId===id);if(p?.placementId)chooseObject({type:'person',objectId:p.placementId});}
 function objectPreview(ref:ObjectRef,position:{x:number;y:number}|null){setObjectPreviews(prev=>{const next=new Map(prev);if(position)next.set(refKey(ref),position);else next.delete(refKey(ref));return next;});}
 function objectName(ref:ObjectRef){return ref.type==='person'?entries.find(e=>board.positions.find(p=>p.entryId===e.id)?.placementId===ref.objectId)?.subject.displayName??'인연':ref.type==='note'?'메모: '+(board.notes?.find(n=>n.id===ref.objectId)?.text.slice(0,20)??''):'사진: '+(board.photos?.find(p=>p.id===ref.objectId)?.caption||'추억 사진');}
 const choices=[...board.positions.filter(p=>p.placementId).map(p=>({type:'person' as const,objectId:p.placementId!})),...(board.notes??[]).map(n=>({type:'note' as const,objectId:n.id})),...(board.photos??[]).map(p=>({type:'photo' as const,objectId:p.id}))];

 function down(e:React.PointerEvent<HTMLButtonElement>,position:BoardPosition){
  if(mode!=='move'||busy||failed||e.button!==0)return;
  drag.current={id:position.entryId,pointer:e.pointerId,startX:e.clientX,startY:e.clientY,x:position.x,y:position.y,moved:false};
  e.currentTarget.setPointerCapture(e.pointerId);setSelected(position.entryId);suppressClick.current=false;
 }
 function move(e:React.PointerEvent<HTMLButtonElement>){
  const d=drag.current;if(!d||d.pointer!==e.pointerId)return;
  const dx=(e.clientX-d.startX)/zoom,dy=(e.clientY-d.startY)/zoom;if(Math.hypot(dx,dy)>5)d.moved=true;
  if(d.moved){e.preventDefault();setPreview({entryId:d.id,...clampPosition(d.x+dx,d.y+dy)});}
 }
 function up(e:React.PointerEvent<HTMLButtonElement>){
  const d=drag.current;if(!d||d.pointer!==e.pointerId)return;drag.current=null;
  if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
  suppressClick.current=d.moved;setTimeout(()=>{suppressClick.current=false;},0);
  if(d.moved){const p=clampPosition(d.x+(e.clientX-d.startX)/zoom,d.y+(e.clientY-d.startY)/zoom);setPreview({entryId:d.id,...p});void save({type:'move',entryId:d.id,...p});}
 }
 function nudge(id:string,dx:number,dy:number){const p=positions.get(id);if(!p||busy||failed)return;const next=clampPosition(p.x+dx,p.y+dy);setSelected(id);setPreview({entryId:id,...next});void save({type:'move',entryId:id,...next});}
 function focusCard(){const p=positions.get(selected);if(p&&viewport.current)viewport.current.scrollTo({left:Math.max(0,(p.x+CARD_WIDTH/2)*zoom-viewport.current.clientWidth/2),top:Math.max(0,(p.y+CARD_HEIGHT/2)*zoom-viewport.current.clientHeight/2)});}
 const addPosition=emptyCardPosition([...positions.values()],board?.notes??[],board?.photos??[]);
 async function saveNote(text:string,color:NoteColor){const command:BoardCommand=noteEditor==='new'?{type:'add-note',id:noteRequest,text,color}:{type:'edit-note',id:(noteEditor as BoardNote).id,text,color};const ok=await save(command);if(ok)setNoteEditor(null);return ok;}
 const toolsDisabled=busy||uploading||!!failed||!!noteEditor||!!photoEditor||!!uploadFailed||!!connectionEditor||managementBusy;
 useEffect(()=>{onGuardChange(busy||uploading||!!failed||!!preview||!!noteEditor||!!photoEditor||!!uploadFailed||!!connectionEditor);},[busy,uploading,failed,preview,noteEditor,photoEditor,uploadFailed,connectionEditor,onGuardChange]);
 const activePhoto=board?.photos?.find(p=>p.id===selectedPhoto);
 const activeNote=board?.notes?.find(n=>n.id===selectedNote);

 return <div className="connection-board"><div className="connection-toolbar notebook-toolbar" role="group" aria-label="보드 도구"><div className="notebook-primary-tools" role="group" aria-label="조작과 꾸미기">
<button disabled={toolsDisabled} aria-pressed={mode==='move'} onClick={()=>{setMode('move');setFirst(null);}}><BoardToolIcon kind="move"/>선택·이동</button><button disabled={toolsDisabled} aria-pressed={mode==='connect'} onClick={()=>{setMode('connect');setFirst(null);}}><BoardToolIcon kind="thread"/>실 연결</button><button disabled={toolsDisabled} onClick={()=>{setNoteRequest('note-'+crypto.randomUUID());setNoteEditor('new');}}><BoardToolIcon kind="note"/>메모 추가</button><button disabled={toolsDisabled} onClick={()=>{setShowPhotoInfo(true);photoInput.current?.click();}}><BoardToolIcon kind="photo"/>사진 추가</button></div>
<input ref={photoInput} hidden type="file" aria-label="추억 사진 파일" accept="image/jpeg,image/png,image/webp" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void upload(file);}}/>
<div className="notebook-secondary-tools"><label><span className="people-sr-only">보드 확대</span><select aria-label="보드 확대" value={zoom} disabled={toolsDisabled} onChange={async e=>{const zoom=Number(e.target.value) as .5|.75|1;if(await onZoom(zoom))setZoom(zoom);}}><option value={0.5}>50%</option><option value={0.75}>75%</option><option value={1}>100%</option></select></label>
<details className="notebook-help"><summary>도움말 <span aria-hidden="true">?</span></summary><div><h3>보드 사용법</h3><p>카드·메모·사진은 손잡이를 끌어 움직여요. 인연 카드를 누르면 상세 기록을 열어요.</p><p>실 연결 모드에서 두 객체를 선택하면 바로 연결돼요. 실을 누른 뒤 +로 설명을 추가하거나, 아래 실 목록에서 편집할 수 있어요.</p><p>방향키 또는 보드 아래 이동·찾기 도구를 사용할 수 있어요. 빈 보드는 스크롤로 탐색하고 50·75·100%로 확대할 수 있어요.</p><h3>사진 안내</h3><p>외부 전송 없이 이 브라우저에만 저장해요. JPG·PNG·WebP 정적 이미지, 원본 10MB 이하. 긴 변 1800px / 저장 1.5MB 이하로 최적화하며 전체 사진은 50MB까지예요.</p></div></details></div></div>
{showPhotoInfo?<div className="notebook-photo-hint"><p>JPG·PNG·WebP · 원본 10MB 이하 · 이 브라우저에서만 최적화·저장해요. 자세한 제한은 도움말에서 확인할 수 있어요.</p><button type="button" onClick={()=>setShowPhotoInfo(false)}>사진 안내 닫기</button></div>:null}
 {uploadFailed?<div className="people-actions"><button disabled={uploading} onClick={()=>void storePhoto(uploadFailed)}>사진 저장 다시 시도</button><button disabled={uploading} onClick={()=>{setUploadFailed(null);setMessage('사진 추가를 취소했어요.');}}>사진 추가 취소</button></div>:null}
 {photoEditor?<PhotoDetail key={photoEditor.id} photo={photoEditor} ownerId={dex.ownerId} busy={busy} onCommand={save} onClose={()=>setPhotoEditor(null)} onDiscard={()=>{setPhotoEditor(null);if(failed?.type==='edit-photo'||failed?.type==='delete-photo'){setFailed(null);setMessage('사진 편집을 취소했어요.');}}}/>:null}
 <p role="status" aria-live="polite">{message}</p>{failed?<div className="people-actions"><button disabled={busy} onClick={()=>void save(failed)}>저장 다시 시도</button><button disabled={busy} onClick={()=>{setFailed(null);setPreview(null);setObjectPreviews(new Map());setMessage('저장된 배치로 돌아왔어요.');}}>저장된 배치로 돌아가기</button></div>:null}
 {noteEditor?<NoteEditor key={noteEditor==='new'?noteRequest:noteEditor.id} initial={noteEditor==='new'?undefined:noteEditor} busy={busy} onSave={saveNote} onCancel={()=>{setNoteEditor(null);if(failed?.type==='add-note'||failed?.type==='edit-note'){setFailed(null);setMessage('메모 편집을 취소했어요.');}}}/>:null}
 {mode==='connect'?<div className="connection-object-picker notebook-thread-options"><label>실 스타일<select aria-label="새 실 스타일" disabled={toolsDisabled} value={threadStyle} onChange={e=>setThreadStyle(e.target.value as ThreadStyle)}>{Object.entries(THREAD_PRESETS).map(([key,preset])=><option key={key} value={key}>{preset.label}</option>)}</select></label><label>연결할 객체<select aria-label="연결할 객체" disabled={toolsDisabled} defaultValue="" onChange={e=>{if(e.target.value)chooseObject(JSON.parse(e.target.value) as ObjectRef);e.target.value='';}}><option value="">인연 · 메모 · 사진 선택</option>{choices.map(ref=><option key={refKey(ref)} value={JSON.stringify(ref)}>{objectName(ref)}</option>)}</select></label><p>{selectedFirst?'선택: '+objectName(selectedFirst):'두 객체를 선택하면 바로 연결돼요.'}</p>{selectedFirst?<button onClick={()=>{setFirst(null);setMessage('연결을 취소했어요.');}}>연결 취소</button>:null}</div>:null}
 {connectionEditor?<ConnectionEditor key={connectionEditor.connection.id} {...connectionEditor} busy={busy} onSave={save} onClose={()=>{setConnectionEditor(null);setFirst(null);if(failed?.type==='connect-objects'||failed?.type==='edit-connection'||failed?.type==='delete-connection')setFailed(null);}}/>:null}
 <div className="connection-wood-frame"><div className="connection-viewport" ref={viewport} tabIndex={0} role="region" aria-label="스크롤 가능한 인연 보드"><div style={{width:BOARD_WIDTH*zoom,height:BOARD_HEIGHT*zoom}}><div className="connection-canvas" style={{width:BOARD_WIDTH,height:BOARD_HEIGHT,transform:`scale(${zoom})`}}>
 {(board?.notes??[]).map(note=><BoardNoteCard key={note.id} note={note} zoom={zoom} busy={toolsDisabled} unsavedMove={failed?.type==='move-note'&&failed.id===note.id} onCommand={save} onEdit={setNoteEditor} connecting={mode==='connect'} selected={selectedFirst?.type==='note'&&selectedFirst.objectId===note.id} onConnect={()=>chooseObject({type:'note',objectId:note.id})} onPreview={p=>objectPreview({type:'note',objectId:note.id},p)}/>)}
 {(board?.photos??[]).map(photo=><BoardPhotoCard key={photo.id} photo={photo} ownerId={dex.ownerId} zoom={zoom} busy={toolsDisabled} unsavedMove={failed?.type==='move-photo'&&failed.id===photo.id} onCommand={save} onOpen={setPhotoEditor} connecting={mode==='connect'} selected={selectedFirst?.type==='photo'&&selectedFirst.objectId===photo.id} onConnect={()=>chooseObject({type:'photo',objectId:photo.id})} onPreview={p=>objectPreview({type:'photo',objectId:photo.id},p)}/>)}
 <BoardThreads board={board} positions={positions} previews={objectPreviews} width={BOARD_WIDTH} height={BOARD_HEIGHT} onSelect={connection=>{if(!toolsDisabled)setConnectionEditor({connection,isNew:false});}}/>
 {entries.map(entry=>{const p=positions.get(entry.id);if(!p)return null;return <div key={entry.id} className="connection-node" data-entry-id={entry.id} style={{left:p.x,top:p.y,width:CARD_WIDTH,height:CARD_HEIGHT}}><button className="connection-card" aria-label={entry.subject.displayName+' 인연 카드'} aria-pressed={!!selectedFirst&&selectedFirst.type==='person'&&selectedFirst.objectId===p.placementId} disabled={toolsDisabled} onPointerDown={e=>down(e,p)} onPointerMove={move} onPointerUp={up} onPointerCancel={()=>{drag.current=null;suppressClick.current=true;setPreview(null);setMessage('이동을 취소했어요.');}} onClick={()=>{if(suppressClick.current){suppressClick.current=false;return;}void choose(entry.id);}} onKeyDown={e=>{const delta:Record<string,[number,number]>={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]};if(mode==='move'&&delta[e.key]){e.preventDefault();nudge(entry.id,...delta[e.key]);}}}><span className="connection-pin" aria-hidden="true"/><PersonAvatar name={entry.subject.displayName} subject={entry.subject} ownerId={entry.ownerId}/><strong>{entry.subject.nickname||entry.subject.displayName}</strong><PersonFeatures subject={entry.subject} compact/>{entry.subject.relationship?<span>{entry.subject.relationship}</span>:null}</button><Link href={'/dex/people/'+entry.id}>기록 보기</Link><button className="board-remove-placement" disabled={toolsDisabled} onClick={()=>{if(window.confirm('이 보드에서 카드와 연결된 실만 제거할까요? 인연 원본·추억·다른 보드는 남습니다.'))void onRemove(entry.id);}}>보드에서 제거</button></div>;})}
 {addPosition?<button type="button" className="connection-add-card" style={{left:addPosition.x,top:addPosition.y,width:CARD_WIDTH,height:CARD_HEIGHT}} disabled={toolsDisabled} onClick={onAddPerson}><span className="connection-add-image" aria-hidden="true">＋</span><strong>새 인연 카드 추가</strong><span>새로운 기억의 시작</span></button>:null}{!entries.length&&!(board?.notes?.length)&&!(board?.photos?.length)?<p className="connection-empty-caption">아직 비어 있는 보드예요.<br/>첫 인연을 여기에 꽂아 보세요.</p>:null}
 </div></div></div></div>
 <details className="notebook-assist-controls"><summary>이동·찾기 도구</summary> <div className="connection-controls"><label>이동할 인연<select aria-label="이동할 인연" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">인연 선택</option>{entries.map(e=><option key={e.id} value={e.id}>{e.subject.displayName}</option>)}</select></label><div className="people-actions">{([['왼쪽',-40,0],['오른쪽',40,0],['위',0,-40],['아래',0,40]] as const).map(([label,dx,dy])=><button key={label} disabled={!selected||toolsDisabled} onClick={()=>nudge(selected,dx,dy)}>{label} 이동</button>)}<button disabled={!selected} onClick={focusCard}>선택 카드 찾기</button></div></div>
 {(board?.notes?.length??0)>0?<div className="connection-controls"><label>이동할 메모<select aria-label="이동할 메모" value={activeNote?.id??''} disabled={toolsDisabled} onChange={e=>setSelectedNote(e.target.value)}><option value="">메모 선택</option>{board!.notes!.map((n,i)=><option key={n.id} value={n.id}>{i+1}. {n.text.slice(0,24)}</option>)}</select></label><div className="people-actions">{([['왼쪽',-40,0],['오른쪽',40,0],['위',0,-40],['아래',0,40]] as const).map(([label,dx,dy])=><button key={label} disabled={!activeNote||toolsDisabled} onClick={()=>{const note=board?.notes?.find(n=>n.id===selectedNote);if(note)void save({type:'move-note',id:note.id,x:note.x+dx,y:note.y+dy});}}>메모 {label} 이동</button>)}<button disabled={!activeNote} onClick={()=>{const n=board?.notes?.find(n=>n.id===selectedNote);if(n&&viewport.current)viewport.current.scrollTo({left:Math.max(0,n.x*zoom-60),top:Math.max(0,n.y*zoom-60)});}}>선택 메모 찾기</button></div></div>:null}
 {(board?.photos?.length??0)>0?<div className="connection-controls"><label>보드 사진<select aria-label="선택할 사진" value={activePhoto?.id??''} onChange={e=>setSelectedPhoto(e.target.value)}><option value="">사진 선택</option>{board!.photos!.map((p,i)=><option key={p.id} value={p.id}>{i+1}. {p.caption||'추억 사진'}</option>)}</select></label><button disabled={!activePhoto||toolsDisabled} onClick={()=>{if(activePhoto)setPhotoEditor(activePhoto);}}>선택 사진 보기</button><button disabled={!activePhoto} onClick={()=>{if(activePhoto&&viewport.current)viewport.current.scrollTo({left:Math.max(0,activePhoto.x*zoom-60),top:Math.max(0,activePhoto.y*zoom-60)});}}>선택 사진 찾기</button></div>:null}
</details>
 <details open={mode==='connect'}><summary>직접 연결한 실 {board.connections?.length??0}개</summary><ul className="connection-edge-list">{(board.connections??[]).map((c,i)=><li key={c.id}><span>{objectName(c.from)} ↔ {objectName(c.to)} · {c.label||'설명 없음'} · {THREAD_PRESETS[c.style].label}</span><button disabled={toolsDisabled} onClick={()=>setConnectionEditor({connection:c,isNew:false})}>실 {i+1} 편집</button><button disabled={toolsDisabled} onClick={()=>{if(window.confirm('이 실만 삭제할까요?'))void save({type:'delete-connection',id:c.id});}}>실 {i+1} 삭제</button></li>)}</ul></details></div>;
}

function BoardToolIcon({kind}:{kind:'move'|'thread'|'note'|'photo'}){
 const paths={move:'M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4',thread:'M4 18C4 3 20 21 20 6M4 18h.01M20 6h.01',note:'M5 3h14v12l-6 6H5V3Zm8 18v-6h6M8 8h8M8 11h5',photo:'M3 5h18v14H3V5Zm0 11 6-6 5 5 3-3 4 4M16 8h.01'};
 return <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]}/></svg>;
}
