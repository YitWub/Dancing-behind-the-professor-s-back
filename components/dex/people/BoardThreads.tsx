import {THREAD_PRESETS} from './board-style';
import {connectionGeometry} from '@/lib/dex/people/connection-presentation';
import type {PeopleBoard,BoardPosition} from '@/lib/dex/people/board';
import {refKey} from '@/lib/dex/people/connections';
import type {BoardConnection} from '@/lib/dex/people/connections';
export function BoardThreads({board,positions,previews,width,height,onSelect}:{board:PeopleBoard;positions:ReadonlyMap<string,BoardPosition>;previews:ReadonlyMap<string,{x:number;y:number}>;width:number;height:number;onSelect:(c:BoardConnection)=>void}){
 const groups=new Map<string,BoardConnection[]>(),lanes=new Map<string,{index:number;count:number}>();
 for(const c of board.connections??[]){const key=[refKey(c.from),refKey(c.to)].sort().join('|'),list=groups.get(key)??[];list.push(c);groups.set(key,list);}
 for(const group of groups.values())group.forEach((c,index)=>lanes.set(c.id,{index,count:group.length}));
 const curves=(board.connections??[]).map(c=>({c,g:connectionGeometry(c,board,positions,previews,lanes.get(c.id))})).filter(row=>row.g);
 return <><svg className="connection-lines" width={width} height={height} aria-hidden="true">{curves.map(({c,g})=>{const s=THREAD_PRESETS[c.style];return <g key={c.id} data-edge-id={c.id} data-thread-style={c.style}><path d={g!.path} fill="none" stroke={s.outline} strokeWidth={s.width+1.3}/><path className="connection-thread" d={g!.path} fill="none" stroke={s.color} strokeWidth={s.width}/><path d={g!.path} fill="none" stroke={s.highlight} strokeWidth=".7" strokeOpacity=".55" strokeDasharray={s.braid}/></g>;})}</svg>{curves.map(({c,g},i)=><button key={c.id} type="button" className="board-thread-label" style={{left:g!.x,top:g!.y}} onClick={()=>onSelect(c)} aria-label={'실'+' '+(i+1)+' 편집: '+(c.label||'설명 없음')}>{c.label.trim()?c.label:'실 '+(i+1)}</button>)}</>;
}
