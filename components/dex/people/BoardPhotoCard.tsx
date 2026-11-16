'use client';
/* eslint-disable @next/next/no-img-element -- Private local Blob URLs must not use a server image optimizer. */
import { useEffect,useRef,useState } from 'react';
import { getBrowserRepository } from '@/lib/dex/storage/browser';
import { PHOTO_SIZES } from '@/lib/dex/people/photo';
import type { BoardPhoto,PhotoSize } from '@/lib/dex/people/photo';
import { clampPosition } from '@/lib/dex/people/board';
import type { BoardCommand } from '@/lib/dex/people/board';
function usePhotoUrl(ownerId:string,assetId:string){
 const [state,setState]=useState({url:'',error:''});
 useEffect(()=>{let alive=true,url='';void getBrowserRepository().getPhotoAsset(ownerId,assetId).then(result=>{
  if(!alive)return;if(result.ok){url=URL.createObjectURL(result.value);setState({url,error:''});}else setState({url:'',error:result.error.message});
 }).catch(()=>{if(alive)setState({url:'',error:'사진을 불러오지 못했어요.'});});
 return()=>{alive=false;if(url)URL.revokeObjectURL(url);};},[ownerId,assetId]);
 return state;
}
export function PhotoImage({photo,ownerId}:{photo:BoardPhoto;ownerId:string}){
 const {url,error}=usePhotoUrl(ownerId,photo.assetId);
 return error?<p role="alert">{error}</p>:url?<img src={url} alt={photo.caption||'보드에 붙인 추억 사진'} draggable={false}/>:<span role="status">사진 불러오는 중…</span>;
}
export function BoardPhotoCard({photo,ownerId,zoom,busy,unsavedMove=false,onCommand,onOpen}:{photo:BoardPhoto;ownerId:string;zoom:number;busy:boolean;unsavedMove?:boolean;onCommand:(command:BoardCommand)=>Promise<boolean>;onOpen:(photo:BoardPhoto)=>void}){
 const [preview,setPreview]=useState<{x:number;y:number}|null>(null),[dragging,setDragging]=useState(false);
 const drag=useRef<{pointer:number;x:number;y:number;cx:number;cy:number;moved:boolean}|null>(null),active=useRef(false),size=PHOTO_SIZES[photo.size];
 const position=preview&&(dragging||busy||unsavedMove)?preview:photo;
 async function move(x:number,y:number){if(active.current)return;active.current=true;const p=clampPosition(x,y,size.width,size.height);setPreview(p);try{if(await onCommand({type:'move-photo',id:photo.id,...p}))setPreview(null);}finally{active.current=false;}}
 return <article className="board-photo" data-photo-id={photo.id} style={{left:position.x,top:position.y,width:size.width,height:size.height}}>
 <button className="board-photo-handle" disabled={busy} aria-label="사진 이동" onPointerDown={e=>{if(busy||e.button!==0)return;setDragging(true);drag.current={pointer:e.pointerId,x:position.x,y:position.y,cx:e.clientX,cy:e.clientY,moved:false};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{const d=drag.current;if(!d||d.pointer!==e.pointerId)return;const dx=(e.clientX-d.cx)/zoom,dy=(e.clientY-d.cy)/zoom;if(Math.hypot(dx,dy)>5)d.moved=true;if(d.moved){e.preventDefault();setPreview(clampPosition(d.x+dx,d.y+dy,size.width,size.height));}}} onPointerUp={e=>{const d=drag.current;if(!d||d.pointer!==e.pointerId)return;drag.current=null;setDragging(false);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);if(d.moved)void move(d.x+(e.clientX-d.cx)/zoom,d.y+(e.clientY-d.cy)/zoom);}} onPointerCancel={()=>{drag.current=null;setDragging(false);setPreview(null);}} onKeyDown={e=>{const ds:Record<string,[number,number]>={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]};if(ds[e.key]){e.preventDefault();void move(position.x+ds[e.key][0],position.y+ds[e.key][1]);}}}>⠿ 사진 이동</button>
 <button className="board-photo-open" disabled={busy} onClick={()=>onOpen(photo)} aria-label="사진 상세 보기"><PhotoImage photo={photo} ownerId={ownerId}/></button>{photo.caption?<p>{photo.caption}</p>:null}<button className="board-photo-detail" disabled={busy} onClick={()=>onOpen(photo)}>사진 보기·편집</button></article>;
}
export function PhotoDetail({photo,ownerId,busy,onCommand,onClose,onDiscard}:{photo:BoardPhoto;ownerId:string;busy:boolean;onCommand:(command:BoardCommand)=>Promise<boolean>;onClose:()=>void;onDiscard:()=>void}){
 const ref=useRef<HTMLDialogElement>(null),[caption,setCaption]=useState(photo.caption),[size,setSize]=useState<PhotoSize>(photo.size);
 const [error,setError]=useState('');
 const dirty=caption!==photo.caption||size!==photo.size;
 function close(){if(!busy&&(!dirty||window.confirm('저장하지 않은 사진 설명·크기 변경을 취소할까요?')))onDiscard();}
 useEffect(()=>{const el=ref.current,previous=document.activeElement as HTMLElement|null;el?.showModal();return()=>{el?.close();if(previous?.isConnected)previous.focus();};},[]);
 useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
 return <dialog ref={ref} className="board-photo-dialog" aria-labelledby="photo-detail-title" onCancel={e=>{e.preventDefault();close();}}><h2 id="photo-detail-title">추억 사진</h2><div className="board-photo-preview"><PhotoImage photo={photo} ownerId={ownerId}/></div><form onSubmit={async e=>{e.preventDefault();if(await onCommand({type:'edit-photo',id:photo.id,caption,size}))onClose();else setError('저장하지 못했어요. 입력은 그대로 있으니 다시 시도해 주세요.');}}><fieldset disabled={busy}><label>사진 설명 <small>선택 · 140자 이내</small><textarea rows={2} maxLength={140} value={caption} onChange={e=>setCaption(e.target.value)}/></label><label>사진 크기<select aria-label="사진 크기" value={size} onChange={e=>setSize(e.target.value as PhotoSize)}><option value="small">작게</option><option value="medium">보통</option><option value="large">크게</option></select></label><div className="people-actions"><button type="submit" className="dex-button">사진 변경 저장</button><button type="button" onClick={close}>닫기</button><button type="button" onClick={async()=>{if(window.confirm('이 사진을 보드에서 삭제할까요? 인연·추억·실·메모는 남습니다.')&&await onCommand({type:'delete-photo',id:photo.id}))onClose();}}>사진 삭제</button></div></fieldset><p role="alert">{error}</p></form></dialog>;
}
