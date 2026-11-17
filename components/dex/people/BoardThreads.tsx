'use client';
import {useState} from 'react';
import {THREAD_PRESETS} from './board-style';
import {connectionGeometry} from '@/lib/dex/people/connection-presentation';
import type {PeopleBoard,BoardPosition} from '@/lib/dex/people/board';
import {refKey} from '@/lib/dex/people/connections';
import type {BoardConnection} from '@/lib/dex/people/connections';
export function BoardThreads({board,positions,previews,width,height,onSelect}:{board:PeopleBoard;positions:ReadonlyMap<string,BoardPosition>;previews:ReadonlyMap<string,{x:number;y:number}>;width:number;height:number;onSelect:(c:BoardConnection)=>void}){
 const [selected,setSelected]=useState<string|null>(null);
 const groups=new Map<string,BoardConnection[]>(),lanes=new Map<string,{index:number;count:number}>();
 for(const c of board.connections??[]){const key=[refKey(c.from),refKey(c.to)].sort().join('|'),list=groups.get(key)??[];list.push(c);groups.set(key,list);}
 for(const group of groups.values())group.forEach((c,index)=>lanes.set(c.id,{index,count:group.length}));
 const curves=(board.connections??[]).map(c=>({c,g:connectionGeometry(c,board,positions,previews,lanes.get(c.id))})).filter(row=>row.g);
 return <><svg className="connection-lines" width={width} height={height}>{curves.map(({c,g},i)=>{const s=THREAD_PRESETS[c.style];return <g key={c.id} data-edge-id={c.id} data-thread-style={c.style}>
 <path d={g!.path} fill="none" stroke={s.outline} strokeWidth={s.width+1.3} aria-hidden="true"/>
 <path className="connection-thread" d={g!.path} fill="none" stroke={s.color} strokeWidth={s.width} aria-hidden="true"/>
 <path d={g!.path} fill="none" stroke={s.highlight} strokeWidth=".7" strokeOpacity=".55" strokeDasharray={s.braid} aria-hidden="true"/>
 <path className="connection-hit" d={g!.path} fill="none" stroke="transparent" strokeWidth="18" role="button" tabIndex={0} aria-label={'실 '+(i+1)+' 선택'} aria-pressed={selected===c.id} onClick={()=>setSelected(c.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelected(c.id);}if(e.key==='Escape')setSelected(null);}}/>
 </g>;})}</svg>{curves.filter(({c})=>!!c.label.trim()||selected===c.id).map(({c,g})=><button key={c.id} type="button" className={'board-thread-label'+(!c.label.trim()?' board-thread-add':'')} style={{left:g!.x,top:g!.y}} onClick={()=>onSelect(c)} aria-label={c.label.trim()?'실 설명 수정: '+c.label:'실 설명 추가'}>{c.label.trim()?c.label:'+'}</button>)}</>;
}
