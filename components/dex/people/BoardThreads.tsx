import { threadPath } from '@/lib/dex/people/board-presentation';
import type { BoardEdge, BoardPosition } from '@/lib/dex/people/board';
export function BoardThreads({edges,positions,width,height}:{edges:readonly BoardEdge[];positions:ReadonlyMap<string,BoardPosition>;width:number;height:number}){
 return <svg className="connection-lines" width={width} height={height} aria-hidden="true">{edges.map(edge=>{
  const a=positions.get(edge.a),b=positions.get(edge.b);if(!a||!b)return null;
  const d=threadPath(a,b);
  return <g key={edge.id} data-edge-id={edge.id}><path d={d} fill="none" stroke="#772e2a" strokeWidth="4" strokeLinecap="round"/><path className="connection-thread" d={d} fill="none" stroke="#b14a42" strokeWidth="2.7" strokeLinecap="round"/><path d={d} fill="none" stroke="#f2b3a0" strokeOpacity=".55" strokeWidth=".7" strokeDasharray="1 3" strokeLinecap="round"/></g>;
 })}</svg>;
}
