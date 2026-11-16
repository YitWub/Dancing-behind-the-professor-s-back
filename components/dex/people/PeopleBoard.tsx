'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Dex, DexDocument } from '@/lib/dex/core/types';
import { getBrowserRepository } from '@/lib/dex/storage/browser';
import { peopleView } from '@/lib/dex/people/view';
import { BOARD_WIDTH,BOARD_HEIGHT,CARD_WIDTH,CARD_HEIGHT,clampPosition, type BoardCommand, type BoardPosition } from '@/lib/dex/people/board';
import { usePeopleLeaveGuard } from './PeopleForms';

export function PeopleBoard({data,onChanged}:{data:DexDocument;onChanged:()=>Promise<void>}){
 const dexes=data.dexes.filter(d=>d.kind==='people');
 const [dexId,setDexId]=useState(dexes[0]?.id??'');
 const dex=dexes.find(d=>d.id===dexId)??dexes[0];
 return <section aria-label="인연 배치 보드">{dexes.length>1?<label>보드 선택<select value={dex?.id??''} onChange={e=>setDexId(e.target.value)}>{dexes.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>:null}{dex?<BoardCanvas key={dex.id} dex={dex} data={data} onChanged={onChanged}/>:<p>인연도감을 다시 불러와 주세요.</p>}</section>;
}
function BoardCanvas({dex,data,onChanged}:{dex:Dex;data:DexDocument;onChanged:()=>Promise<void>}){
 const entries=peopleView(data).filter(e=>e.dexId===dex.id),board=dex.peopleBoard;
 const router=useRouter(),viewport=useRef<HTMLDivElement>(null),active=useRef(false);
 const [mode,setMode]=useState<'move'|'connect'>('move'),[first,setFirst]=useState(''),[selected,setSelected]=useState(''),[zoom,setZoom]=useState(0.75),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[preview,setPreview]=useState<BoardPosition|null>(null),[failed,setFailed]=useState<BoardCommand|null>(null);
 const drag=useRef<{id:string;pointer:number;startX:number;startY:number;x:number;y:number;moved:boolean}|null>(null),suppressClick=useRef(false);
 const save=useCallback(async(command:BoardCommand)=>{
  if(active.current)return;active.current=true;setBusy(true);setMessage('저장 중…');
  try{const result=await getBrowserRepository().updatePeopleBoard(dex.ownerId,dex.id,dex.revision,command);
   if(result.ok){setFailed(null);setPreview(null);setMessage('저장했어요.');await onChanged();}
   else{setFailed(command);setMessage('저장하지 못했어요. '+result.error.message);await onChanged();}
  }catch{setFailed(command);setMessage('저장하지 못했어요. 다시 시도해 주세요.');}
  finally{active.current=false;setBusy(false);}
 },[dex.ownerId,dex.id,dex.revision,onChanged]);
 const missing=entries.some(e=>!board?.positions.some(p=>p.entryId===e.id));
 useEffect(()=>{if(missing&&!failed&&!active.current)void save({type:'initialize'});},[missing,failed,save]);
 usePeopleLeaveGuard(!!failed||!!preview,busy);
 const positions=new Map((board?.positions??[]).map(p=>[p.entryId,p]));
 if(preview&&entries.some(e=>e.id===preview.entryId))positions.set(preview.entryId,preview);
 const byId=new Map(entries.map(e=>[e.id,e]));
 async function choose(id:string){setSelected(id);if(mode==='move'){router.push('/dex/people/'+id);return;}
  if(!first){setFirst(id);setMessage('두 번째 인연을 선택해 주세요.');return;}
  if(first===id){setMessage('같은 인연끼리는 연결할 수 없어요. 다른 카드를 선택해 주세요.');return;}
  const a=first;setFirst('');await save({type:'connect',a,b:id});
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
 if(!entries.length)return <p className="people-empty">아직 보드에 놓을 인연이 없어요. 새 인연부터 기록해 주세요.</p>;
 return <div className="connection-board"><div className="people-actions"><button disabled={busy||!!failed} aria-pressed={mode==='move'} onClick={()=>{setMode('move');setFirst('');}}>카드 이동</button><button disabled={busy||!!failed} aria-pressed={mode==='connect'} onClick={()=>{setMode('connect');setFirst('');}}>실 연결</button>{first?<button onClick={()=>{setFirst('');setMessage('연결을 취소했어요.');}}>연결 취소</button>:null}<label>확대<select aria-label="보드 확대" value={zoom} onChange={e=>setZoom(Number(e.target.value))}><option value={0.5}>50%</option><option value={0.75}>75%</option><option value={1}>100%</option></select></label></div>
 <p className="people-privacy">{mode==='connect'?'연결할 두 인연을 직접 선택해 주세요. 자동으로 연결하지 않아요.':'카드를 끌어 이동해요. 카드를 누르면 상세 기록을 열어요. 방향키로도 이동할 수 있어요.'} 빈 보드를 스크롤해 이동할 수 있어요.</p>
 <p role="status" aria-live="polite">{message}</p>{failed?<div className="people-actions"><button disabled={busy} onClick={()=>void save(failed)}>저장 다시 시도</button><button disabled={busy} onClick={()=>{setFailed(null);setPreview(null);setMessage('저장된 배치로 돌아왔어요.');}}>저장된 배치로 돌아가기</button></div>:null}
 <div className="connection-viewport" ref={viewport} tabIndex={0} role="region" aria-label="스크롤 가능한 인연 보드"><div style={{width:BOARD_WIDTH*zoom,height:BOARD_HEIGHT*zoom}}><div className="connection-canvas" style={{width:BOARD_WIDTH,height:BOARD_HEIGHT,transform:`scale(${zoom})`}}>
 <svg className="connection-lines" width={BOARD_WIDTH} height={BOARD_HEIGHT} aria-hidden="true">{(board?.edges??[]).map(edge=>{const a=positions.get(edge.a),b=positions.get(edge.b);return a&&b?<line key={edge.id} data-edge-id={edge.id} x1={a.x+CARD_WIDTH/2} y1={a.y+12} x2={b.x+CARD_WIDTH/2} y2={b.y+12} stroke="#ac4a42" strokeWidth={3}/>:null;})}</svg>
 {entries.map(entry=>{const p=positions.get(entry.id);if(!p)return null;return <div key={entry.id} className="connection-node" data-entry-id={entry.id} style={{left:p.x,top:p.y,width:CARD_WIDTH,height:CARD_HEIGHT}}><button className="connection-card" aria-label={entry.subject.displayName+' 인연 카드'} aria-pressed={first===entry.id} disabled={busy||!!failed} onPointerDown={e=>down(e,p)} onPointerMove={move} onPointerUp={up} onPointerCancel={()=>{drag.current=null;suppressClick.current=true;setPreview(null);setMessage('이동을 취소했어요.');}} onClick={()=>{if(suppressClick.current){suppressClick.current=false;return;}void choose(entry.id);}} onKeyDown={e=>{const delta:Record<string,[number,number]>={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]};if(mode==='move'&&delta[e.key]){e.preventDefault();nudge(entry.id,...delta[e.key]);}}}><span className="connection-initial" aria-hidden="true">{Array.from(entry.subject.displayName)[0]}</span><strong>{entry.subject.displayName}</strong>{entry.subject.relationship?<span>{entry.subject.relationship}</span>:null}</button><Link href={'/dex/people/'+entry.id}>기록 보기</Link></div>;})}
 </div></div></div>
 <div className="connection-controls"><label>이동할 인연<select aria-label="이동할 인연" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">인연 선택</option>{entries.map(e=><option key={e.id} value={e.id}>{e.subject.displayName}</option>)}</select></label><div className="people-actions">{([['왼쪽',-40,0],['오른쪽',40,0],['위',0,-40],['아래',0,40]] as const).map(([label,dx,dy])=><button key={label} disabled={!selected||busy||!!failed} onClick={()=>nudge(selected,dx,dy)}>{label} 이동</button>)}<button disabled={!selected} onClick={focusCard}>선택 카드 찾기</button></div></div>
 <details open={mode==='connect'}><summary>직접 연결한 실 {(board?.edges??[]).length}개</summary><ul className="connection-edge-list">{(board?.edges??[]).map(edge=><li key={edge.id}><span>{byId.get(edge.a)?.subject.displayName} ↔ {byId.get(edge.b)?.subject.displayName}</span><button disabled={busy||!!failed} onClick={()=>void save({type:'disconnect',id:edge.id})}>실 삭제</button></li>)}</ul></details></div>;
}
