import { THREAD_PRESETS } from './board-style';
import { threadPath } from '@/lib/dex/people/board-presentation';
import type { BoardEdge, BoardPosition } from '@/lib/dex/people/board';
export function BoardThreads({edges,positions,width,height}:{edges:readonly BoardEdge[];positions:ReadonlyMap<string,BoardPosition>;width:number;height:number}){
 return <svg className="connection-lines" width={width} height={height} aria-hidden="true">{edges.map(edge=>{
  const a=positions.get(edge.a),b=positions.get(edge.b);if(!a||!b)return null;
  const d=threadPath(a,b),style=THREAD_PRESETS[edge.style??'red'];
  return <g key={edge.id} data-edge-id={edge.id} data-thread-style={edge.style??'red'}><path d={d} fill="none" stroke={style.outline} strokeWidth={style.width+1.3} strokeLinecap="round"/><path className="connection-thread" d={d} fill="none" stroke={style.color} strokeWidth={style.width} strokeLinecap="round"/><path d={d} fill="none" stroke={style.highlight} strokeOpacity=".55" strokeWidth=".7" strokeDasharray={style.braid} strokeLinecap="round"/></g>;
 })}</svg>;
}
