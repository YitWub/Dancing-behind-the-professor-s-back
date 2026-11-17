import {CARD_WIDTH,NOTE_WIDTH} from './board.ts';
import {PHOTO_SIZES} from './photo.ts';
import type {PeopleBoard,BoardPosition} from './board.ts';
import {refKey} from './connections.ts';
import type {ObjectRef,BoardConnection} from './connections.ts';
export function connectionGeometry(c:BoardConnection,board:PeopleBoard,positions:ReadonlyMap<string,BoardPosition>,previews:ReadonlyMap<string,{x:number;y:number}>,lane?:{index:number;count:number}){
 function point(ref:ObjectRef){if(ref.type==='person'){const p=board.positions.find(p=>p.placementId===ref.objectId),v=p&&positions.get(p.entryId);return v?{x:v.x+CARD_WIDTH/2,y:v.y+12}:null;}
 const o=ref.type==='note'?board.notes?.find(n=>n.id===ref.objectId):board.photos?.find(p=>p.id===ref.objectId);if(!o)return null;const p=previews.get(refKey(ref))??o;
 return {x:p.x+(ref.type==='note'?NOTE_WIDTH:PHOTO_SIZES[(o as {size:keyof typeof PHOTO_SIZES}).size].width)/2,y:p.y+12};}
 const a=point(c.from),b=point(c.to);if(!a||!b)return null;
 const pair=[refKey(c.from),refKey(c.to)].sort().join('|'),group=lane?[]:(board.connections??[]).filter(e=>[refKey(e.from),refKey(e.to)].sort().join('|')===pair),i=lane?.index??group.findIndex(e=>e.id===c.id),count=lane?.count??group.length,offset=(i-(count-1)/2)*48;
 // Canonical orientation keeps parallel curves separate even when endpoints are reversed.
 const [start,end]=refKey(c.from)<refKey(c.to)?[a,b]:[b,a],dx=end.x-start.x,dy=end.y-start.y,length=Math.hypot(dx,dy)||1;
 const cx=(start.x+end.x)/2-dy/length*offset,cy=(start.y+end.y)/2+Math.min(55,length*.09)+dx/length*offset;
 return {path:'M '+start.x+' '+start.y+' Q '+cx+' '+cy+' '+end.x+' '+end.y,x:(start.x+2*cx+end.x)/4,y:(start.y+2*cy+end.y)/4};
}
