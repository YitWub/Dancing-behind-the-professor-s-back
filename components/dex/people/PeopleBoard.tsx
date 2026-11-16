'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Dex, DexDocument } from '@/lib/dex/core/types';
import { getBrowserRepository } from '@/lib/dex/storage/browser';
import { peopleView } from '@/lib/dex/people/view';
import { BOARD_WIDTH,BOARD_HEIGHT,CARD_WIDTH,CARD_HEIGHT,clampPosition, type BoardCommand, type BoardPosition } from '@/lib/dex/people/board';
import { emptyCardPosition } from '@/lib/dex/people/board-presentation';
import { PersonAvatar } from './PersonCard';
import { BoardThreads } from './BoardThreads';
import { optimizePhoto } from '@/lib/dex/people/photo';
import type { PreparedImage,BoardPhoto } from '@/lib/dex/people/photo';
import { BoardPhotoCard,PhotoDetail } from './BoardPhotoCard';
import { BoardNoteCard,NoteEditor } from './BoardNoteCard';
import { THREAD_PRESETS } from './board-style';
import type { ThreadStyle,BoardNote,NoteColor } from '@/lib/dex/people/board';
import { usePeopleLeaveGuard } from './PeopleForms';

export function PeopleBoard({data,onChanged,onAddPerson}:{data:DexDocument;onChanged:()=>Promise<void>;onAddPerson:()=>void}){
 const dexes=data.dexes.filter(d=>d.kind==='people');
 const [dexId,setDexId]=useState(dexes[0]?.id??'');
 const dex=dexes.find(d=>d.id===dexId)??dexes[0];
 return <section aria-label="인연 배치 보드">{dexes.length>1?<label>보드 선택<select value={dex?.id??''} onChange={e=>setDexId(e.target.value)}>{dexes.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>:null}{dex?<BoardCanvas key={dex.id} dex={dex} data={data} onChanged={onChanged} onAddPerson={onAddPerson}/>:<p>인연도감을 다시 불러와 주세요.</p>}</section>;
}
function BoardCanvas({dex,data,onChanged,onAddPerson}:{dex:Dex;data:DexDocument;onChanged:()=>Promise<void>;onAddPerson:()=>void}){
 const entries=peopleView(data).filter(e=>e.dexId===dex.id),board=dex.peopleBoard;
 const router=useRouter(),viewport=useRef<HTMLDivElement>(null),active=useRef(false);
 const [mode,setMode]=useState<'move'|'connect'>('move'),[first,setFirst]=useState(''),[selected,setSelected]=useState(''),[zoom,setZoom]=useState(0.75),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[preview,setPreview]=useState<BoardPosition|null>(null),[failed,setFailed]=useState<BoardCommand|null>(null);
 const [threadStyle,setThreadStyle]=useState<ThreadStyle>('red'),[noteEditor,setNoteEditor]=useState<'new'|BoardNote|null>(null),[selectedNote,setSelectedNote]=useState('');
 const photoInput=useRef<HTMLInputElement>(null);
 const [uploading,setUploading]=useState(false),[uploadFailed,setUploadFailed]=useState<{id:string;image:PreparedImage}|null>(null),[photoEditor,setPhotoEditor]=useState<BoardPhoto|null>(null),[selectedPhoto,setSelectedPhoto]=useState('');
 async function storePhoto(payload:{id:string;image:PreparedImage}){
  if(active.current)return;active.current=true;setUploading(true);setMessage('사진 저장 중…');
  try{const result=await getBrowserRepository().addBoardPhoto(dex.ownerId,dex.id,dex.revision,{id:payload.id,assetId:'img-'+payload.image.sha256,caption:'',size:'medium'},payload.image);
   if(result.ok){setUploadFailed(null);setMessage('사진을 보드에 붙였어요.');await onChanged();}
   else{setUploadFailed(payload);setMessage('사진을 저장하지 못했어요. '+result.error.message);await onChanged();}
  }catch{setUploadFailed(payload);setMessage('사진을 저장하지 못했어요. 다시 시도해 주세요.');}
  finally{active.current=false;setUploading(false);}
 }
 async function upload(file:File){if(active.current)return;setUploading(true);setMessage('이 브라우저에서 사진을 최적화하는 중…');try{const image=await optimizePhoto(file);await storePhoto({id:'photo-'+crypto.randomUUID(),image});}catch(error){setMessage(error instanceof Error?error.message:'사진을 읽지 못했어요.');}finally{setUploading(false);}}
 const [noteRequest,setNoteRequest]=useState('');
 const drag=useRef<{id:string;pointer:number;startX:number;startY:number;x:number;y:number;moved:boolean}|null>(null),suppressClick=useRef(false);
 const save=useCallback(async(command:BoardCommand)=>{
  if(active.current)return false;active.current=true;setBusy(true);setMessage('저장 중…');
  try{const result=await getBrowserRepository().updatePeopleBoard(dex.ownerId,dex.id,dex.revision,command);
   if(result.ok){if(command.type==='add-note'||command.type==='edit-note')setNoteEditor(null);setFailed(null);setPreview(null);setMessage('저장했어요.');await onChanged();return true;}
   else{setFailed(command);setMessage('저장하지 못했어요. '+result.error.message);await onChanged();return false;}
  }catch{setFailed(command);setMessage('저장하지 못했어요. 다시 시도해 주세요.');return false;}
  finally{active.current=false;setBusy(false);}
 },[dex.ownerId,dex.id,dex.revision,onChanged]);
 const missing=entries.some(e=>!board?.positions.some(p=>p.entryId===e.id));
 useEffect(()=>{if(missing&&!failed&&!active.current&&!noteEditor&&!uploading&&!photoEditor&&!uploadFailed)void save({type:'initialize'});},[missing,failed,save,noteEditor,uploading,photoEditor,uploadFailed]);
 usePeopleLeaveGuard(!!failed||!!preview||!!uploadFailed,busy||uploading);
 const positions=new Map((board?.positions??[]).map(p=>[p.entryId,p]));
 if(preview&&entries.some(e=>e.id===preview.entryId))positions.set(preview.entryId,preview);
 const byId=new Map(entries.map(e=>[e.id,e]));
 async function choose(id:string){setSelected(id);if(mode==='move'){router.push('/dex/people/'+id);return;}
  if(!first){setFirst(id);setMessage('두 번째 인연을 선택해 주세요.');return;}
  if(first===id){setMessage('같은 인연끼리는 연결할 수 없어요. 다른 카드를 선택해 주세요.');return;}
  const a=first;setFirst('');await save({type:'connect',a,b:id,style:threadStyle});
 }
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
 const toolsDisabled=busy||uploading||!!failed||!!noteEditor||!!photoEditor||!!uploadFailed;
 const activePhoto=board?.photos?.find(p=>p.id===selectedPhoto);
 const activeNote=board?.notes?.find(n=>n.id===selectedNote);

 return <div className="connection-board"><div className="connection-board-heading"><div><span className="people-kicker">나의 캠퍼스 커넥션 보드</span><p>함께한 인연을, 한 장씩.</p></div><span className="connection-board-count">인연 {entries.length}명 · 실 {board?.edges.length??0}개</span></div><div className="people-actions connection-toolbar" role="group" aria-label="보드 도구"><div className="board-tool-group" role="group" aria-label="조작 모드"><button disabled={toolsDisabled} aria-pressed={mode==='move'} onClick={()=>{setMode('move');setFirst('');}}>카드 이동</button><button disabled={toolsDisabled} aria-pressed={mode==='connect'} onClick={()=>{setMode('connect');setFirst('');}}>실 연결</button>{first?<button onClick={()=>{setFirst('');setMessage('연결을 취소했어요.');}}>연결 취소</button>:null}</div><div className="board-tool-group"><label>실 스타일<select aria-label="새 실 스타일" disabled={toolsDisabled} value={threadStyle} onChange={e=>setThreadStyle(e.target.value as ThreadStyle)}>{Object.entries(THREAD_PRESETS).map(([key,preset])=><option key={key} value={key}>{preset.label}</option>)}</select></label></div><div className="board-tool-group board-tool-add" role="group" aria-label="보드에 추가"><button disabled={toolsDisabled} onClick={()=>{setNoteRequest('note-'+crypto.randomUUID());setNoteEditor('new');}}>메모 추가</button><button disabled={toolsDisabled} onClick={()=>photoInput.current?.click()}>사진 추가</button><input ref={photoInput} hidden type="file" aria-label="추억 사진 파일" accept="image/jpeg,image/png,image/webp" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void upload(file);}}/></div><div className="board-tool-group board-tool-zoom"><label>확대<select aria-label="보드 확대" value={zoom} onChange={e=>setZoom(Number(e.target.value))}><option value={0.5}>50%</option><option value={0.75}>75%</option><option value={1}>100%</option></select></label></div></div>
 <p className="people-privacy">{mode==='connect'?'연결할 두 인연을 직접 선택해 주세요. 자동으로 연결하지 않아요.':'카드를 끌어 이동해요. 카드를 누르면 상세 기록을 열어요. 방향키로도 이동할 수 있어요.'} 빈 보드를 스크롤해 이동할 수 있어요.</p>
 <p className="people-privacy">사진은 외부 전송 없이 이 브라우저에만 저장해요. JPG·PNG·WebP 정적 이미지 · 원본 10MB 이하 · 긴 변 1800px / 저장 1.5MB 이하로 최적화 · 전체 사진 50MB.</p>
 {uploadFailed?<div className="people-actions"><button disabled={uploading} onClick={()=>void storePhoto(uploadFailed)}>사진 저장 다시 시도</button><button disabled={uploading} onClick={()=>{setUploadFailed(null);setMessage('사진 추가를 취소했어요.');}}>사진 추가 취소</button></div>:null}
 {photoEditor?<PhotoDetail key={photoEditor.id} photo={photoEditor} ownerId={dex.ownerId} busy={busy} onCommand={save} onClose={()=>setPhotoEditor(null)} onDiscard={()=>{setPhotoEditor(null);if(failed?.type==='edit-photo'||failed?.type==='delete-photo'){setFailed(null);setMessage('사진 편집을 취소했어요.');}}}/>:null}
 <p role="status" aria-live="polite">{message}</p>{failed?<div className="people-actions"><button disabled={busy} onClick={()=>void save(failed)}>저장 다시 시도</button><button disabled={busy} onClick={()=>{setFailed(null);setPreview(null);setMessage('저장된 배치로 돌아왔어요.');}}>저장된 배치로 돌아가기</button></div>:null}
 {noteEditor?<NoteEditor key={noteEditor==='new'?noteRequest:noteEditor.id} initial={noteEditor==='new'?undefined:noteEditor} busy={busy} onSave={saveNote} onCancel={()=>{setNoteEditor(null);if(failed?.type==='add-note'||failed?.type==='edit-note'){setFailed(null);setMessage('메모 편집을 취소했어요.');}}}/>:null}
 <div className="connection-wood-frame"><div className="connection-viewport" ref={viewport} tabIndex={0} role="region" aria-label="스크롤 가능한 인연 보드"><div style={{width:BOARD_WIDTH*zoom,height:BOARD_HEIGHT*zoom}}><div className="connection-canvas" style={{width:BOARD_WIDTH,height:BOARD_HEIGHT,transform:`scale(${zoom})`}}>
 {(board?.notes??[]).map(note=><BoardNoteCard key={note.id} note={note} zoom={zoom} busy={toolsDisabled} unsavedMove={failed?.type==='move-note'&&failed.id===note.id} onCommand={save} onEdit={setNoteEditor}/>)}
 {(board?.photos??[]).map(photo=><BoardPhotoCard key={photo.id} photo={photo} ownerId={dex.ownerId} zoom={zoom} busy={toolsDisabled} unsavedMove={failed?.type==='move-photo'&&failed.id===photo.id} onCommand={save} onOpen={setPhotoEditor}/>)}
 <BoardThreads edges={board?.edges??[]} positions={positions} width={BOARD_WIDTH} height={BOARD_HEIGHT}/>
 {entries.map(entry=>{const p=positions.get(entry.id);if(!p)return null;return <div key={entry.id} className="connection-node" data-entry-id={entry.id} style={{left:p.x,top:p.y,width:CARD_WIDTH,height:CARD_HEIGHT}}><button className="connection-card" aria-label={entry.subject.displayName+' 인연 카드'} aria-pressed={first===entry.id} disabled={toolsDisabled} onPointerDown={e=>down(e,p)} onPointerMove={move} onPointerUp={up} onPointerCancel={()=>{drag.current=null;suppressClick.current=true;setPreview(null);setMessage('이동을 취소했어요.');}} onClick={()=>{if(suppressClick.current){suppressClick.current=false;return;}void choose(entry.id);}} onKeyDown={e=>{const delta:Record<string,[number,number]>={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]};if(mode==='move'&&delta[e.key]){e.preventDefault();nudge(entry.id,...delta[e.key]);}}}><span className="connection-pin" aria-hidden="true"/><PersonAvatar name={entry.subject.displayName}/><strong>{entry.subject.displayName}</strong>{entry.subject.relationship?<span>{entry.subject.relationship}</span>:null}</button><Link href={'/dex/people/'+entry.id}>기록 보기</Link></div>;})}
 {addPosition?<button type="button" className="connection-add-card" style={{left:addPosition.x,top:addPosition.y,width:CARD_WIDTH,height:CARD_HEIGHT}} disabled={toolsDisabled} onClick={onAddPerson}><span className="connection-add-image" aria-hidden="true">＋</span><strong>새 인연 카드 추가</strong><span>새로운 기억의 시작</span></button>:null}{!entries.length&&!(board?.notes?.length)&&!(board?.photos?.length)?<p className="connection-empty-caption">아직 비어 있는 보드예요.<br/>첫 인연을 여기에 꽂아 보세요.</p>:null}
 </div></div></div></div>
 <div className="connection-controls"><label>이동할 인연<select aria-label="이동할 인연" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">인연 선택</option>{entries.map(e=><option key={e.id} value={e.id}>{e.subject.displayName}</option>)}</select></label><div className="people-actions">{([['왼쪽',-40,0],['오른쪽',40,0],['위',0,-40],['아래',0,40]] as const).map(([label,dx,dy])=><button key={label} disabled={!selected||toolsDisabled} onClick={()=>nudge(selected,dx,dy)}>{label} 이동</button>)}<button disabled={!selected} onClick={focusCard}>선택 카드 찾기</button></div></div>
 {(board?.notes?.length??0)>0?<div className="connection-controls"><label>이동할 메모<select aria-label="이동할 메모" value={activeNote?.id??''} disabled={toolsDisabled} onChange={e=>setSelectedNote(e.target.value)}><option value="">메모 선택</option>{board!.notes!.map((n,i)=><option key={n.id} value={n.id}>{i+1}. {n.text.slice(0,24)}</option>)}</select></label><div className="people-actions">{([['왼쪽',-40,0],['오른쪽',40,0],['위',0,-40],['아래',0,40]] as const).map(([label,dx,dy])=><button key={label} disabled={!activeNote||toolsDisabled} onClick={()=>{const note=board?.notes?.find(n=>n.id===selectedNote);if(note)void save({type:'move-note',id:note.id,x:note.x+dx,y:note.y+dy});}}>메모 {label} 이동</button>)}<button disabled={!activeNote} onClick={()=>{const n=board?.notes?.find(n=>n.id===selectedNote);if(n&&viewport.current)viewport.current.scrollTo({left:Math.max(0,n.x*zoom-60),top:Math.max(0,n.y*zoom-60)});}}>선택 메모 찾기</button></div></div>:null}
 {(board?.photos?.length??0)>0?<div className="connection-controls"><label>보드 사진<select aria-label="선택할 사진" value={activePhoto?.id??''} onChange={e=>setSelectedPhoto(e.target.value)}><option value="">사진 선택</option>{board!.photos!.map((p,i)=><option key={p.id} value={p.id}>{i+1}. {p.caption||'추억 사진'}</option>)}</select></label><button disabled={!activePhoto||toolsDisabled} onClick={()=>{if(activePhoto)setPhotoEditor(activePhoto);}}>선택 사진 보기</button><button disabled={!activePhoto} onClick={()=>{if(activePhoto&&viewport.current)viewport.current.scrollTo({left:Math.max(0,activePhoto.x*zoom-60),top:Math.max(0,activePhoto.y*zoom-60)});}}>선택 사진 찾기</button></div>:null}
 <details open={mode==='connect'}><summary>직접 연결한 실 {(board?.edges??[]).length}개</summary><ul className="connection-edge-list">{(board?.edges??[]).map(edge=><li key={edge.id}><span>{byId.get(edge.a)?.subject.displayName} ↔ {byId.get(edge.b)?.subject.displayName}</span><label className="board-edge-style">실 스타일<select aria-label={'연결 실 스타일 '+(board!.edges.indexOf(edge)+1)} disabled={toolsDisabled} value={edge.style??'red'} onChange={e=>void save({type:'style-edge',id:edge.id,style:e.target.value as ThreadStyle})}>{Object.entries(THREAD_PRESETS).map(([key,preset])=><option key={key} value={key}>{preset.label}</option>)}</select></label><button disabled={toolsDisabled} onClick={()=>void save({type:'disconnect',id:edge.id})}>실 삭제</button></li>)}</ul></details></div>;
}
