import { BOARD_WIDTH, BOARD_HEIGHT, CARD_WIDTH, CARD_HEIGHT } from './board.ts';
import { NOTE_WIDTH,NOTE_HEIGHT } from './board.ts';
import type { BoardNote, BoardPosition } from './board.ts';
/** View-only vacant slot. Never changes the saved positions or creates an Entry. */
export function emptyCardPosition(positions:readonly BoardPosition[],notes:readonly BoardNote[]=[]){
 for(let y=24;y<=BOARD_HEIGHT-CARD_HEIGHT;y+=220)for(let x=24;x<=BOARD_WIDTH-CARD_WIDTH;x+=200){
  if([...positions.map(p=>({...p,width:CARD_WIDTH,height:CARD_HEIGHT})),...notes.map(n=>({...n,width:NOTE_WIDTH,height:NOTE_HEIGHT}))].every(p=>x+CARD_WIDTH+12<=p.x||p.x+p.width+12<=x||y+CARD_HEIGHT+12<=p.y||p.y+p.height+12<=y))return {x,y};
 }
 return null;
}
export function threadPath(a:BoardPosition,b:BoardPosition){
 const x1=a.x+CARD_WIDTH/2,y1=a.y+12,x2=b.x+CARD_WIDTH/2,y2=b.y+12;
 const sag=Math.min(55,Math.hypot(x2-x1,y2-y1)*.09);
 return `M ${x1} ${y1} Q ${(x1+x2)/2} ${(y1+y2)/2+sag} ${x2} ${y2}`;
}
