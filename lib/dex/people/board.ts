import { ensure } from '../core/errors.ts';
import type { CollectionEntry, Dex } from '../core/types.ts';
export const BOARD_WIDTH=2400, BOARD_HEIGHT=1800, CARD_WIDTH=160, CARD_HEIGHT=180;
export interface BoardPosition {entryId:string;x:number;y:number}
export interface BoardEdge {id:string;a:string;b:string}
export interface PeopleBoard {version:1;positions:BoardPosition[];edges:BoardEdge[]}
export type BoardCommand={type:'initialize'}|{type:'move';entryId:string;x:number;y:number}|{type:'connect';a:string;b:string}|{type:'disconnect';id:string};
export function edgeKey(a:string,b:string){return JSON.stringify([a,b].sort());}
export function clampPosition(x:number,y:number){return {x:Math.round(Math.min(BOARD_WIDTH-CARD_WIDTH,Math.max(0,x))),y:Math.round(Math.min(BOARD_HEIGHT-CARD_HEIGHT,Math.max(0,y)))};}
function fields(value:unknown,keys:string[]):asserts value is Record<string,unknown>{ensure(!!value&&typeof value==='object'&&!Array.isArray(value),'보드 형식이 올바르지 않습니다.');ensure(Object.keys(value).every(key=>keys.includes(key)),'지원하지 않는 보드 필드입니다.');}
export function validatePeopleBoard(value:unknown,dex:Dex,entries:CollectionEntry[]):asserts value is PeopleBoard{
 fields(value,['version','positions','edges']);ensure(dex.kind==='people'&&value.version===1,'인연도감의 보드만 지원합니다.');
 ensure(Array.isArray(value.positions)&&value.positions.length<=10000&&Array.isArray(value.edges)&&value.edges.length<=10000,'보드 크기를 확인해 주세요.');
 const people=new Set(entries.filter(e=>e.dexId===dex.id&&e.subject.kind==='person').map(e=>e.id));
 const placed=new Set<string>(),edges=new Set<string>();
 for(const raw of value.positions as unknown[]){fields(raw,['entryId','x','y']);ensure(typeof raw.entryId==='string'&&people.has(raw.entryId)&&!placed.has(raw.entryId),'보드 카드 참조 또는 중복을 확인해 주세요.');ensure(typeof raw.x==='number'&&Number.isFinite(raw.x)&&raw.x>=0&&raw.x<=BOARD_WIDTH-CARD_WIDTH&&typeof raw.y==='number'&&Number.isFinite(raw.y)&&raw.y>=0&&raw.y<=BOARD_HEIGHT-CARD_HEIGHT,'보드 좌표 범위를 확인해 주세요.');placed.add(raw.entryId);}
 for(const raw of value.edges as unknown[]){fields(raw,['id','a','b']);ensure(typeof raw.a==='string'&&typeof raw.b==='string'&&raw.a!==raw.b&&people.has(raw.a)&&people.has(raw.b)&&placed.has(raw.a)&&placed.has(raw.b),'실의 인연 참조를 확인해 주세요.');const key=edgeKey(raw.a as string,raw.b as string);ensure(raw.id===key&&!edges.has(key),'같은 실을 중복 연결할 수 없습니다.');edges.add(key);}
}
export function initializeBoard(board:PeopleBoard,entries:CollectionEntry[],dexId:string):PeopleBoard{
 const next=structuredClone(board);
 for(const entry of entries.filter(e=>e.dexId===dexId&&e.subject.kind==='person').sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id))){
  if(next.positions.some(p=>p.entryId===entry.id))continue;
  let placed=false;
  for(let y=24;y<=BOARD_HEIGHT-CARD_HEIGHT&&!placed;y+=220)for(let x=24;x<=BOARD_WIDTH-CARD_WIDTH;x+=200){
   if(next.positions.every(p=>x+CARD_WIDTH+12<=p.x||p.x+CARD_WIDTH+12<=x||y+CARD_HEIGHT+12<=p.y||p.y+CARD_HEIGHT+12<=y)){next.positions.push({entryId:entry.id,x,y});placed=true;break;}
  }
  ensure(placed,'보드의 빈 공간이 부족합니다. 기존 카드를 옮겨 공간을 만들어 주세요.');
 }
 return next;
}
export function applyBoardCommand(dex:Dex,entries:CollectionEntry[],command:BoardCommand):PeopleBoard{
 ensure(dex.kind==='people','인연도감에서만 보드를 사용할 수 있습니다.');
 fields(command,command.type==='move'?['type','entryId','x','y']:command.type==='connect'?['type','a','b']:command.type==='disconnect'?['type','id']:['type']);
 const next=initializeBoard(dex.peopleBoard??{version:1,positions:[],edges:[]},entries,dex.id);
 if(command.type==='move'){
  ensure(Number.isFinite(command.x)&&Number.isFinite(command.y),'좌표가 올바르지 않습니다.');
  const position=next.positions.find(p=>p.entryId===command.entryId);ensure(position,'인연 카드를 찾을 수 없습니다.');
  Object.assign(position,clampPosition(command.x,command.y));
 }else if(command.type==='connect'){
  ensure(command.a!==command.b,'같은 인연끼리는 연결할 수 없습니다.');
  ensure(next.positions.some(p=>p.entryId===command.a)&&next.positions.some(p=>p.entryId===command.b),'같은 보드의 인연만 연결할 수 있습니다.');
  const id=edgeKey(command.a,command.b);if(!next.edges.some(e=>e.id===id)){const [a,b]=[command.a,command.b].sort();next.edges.push({id,a,b});}
 }else if(command.type==='disconnect'){next.edges=next.edges.filter(e=>e.id!==command.id);}
 else ensure(command.type==='initialize','지원하지 않는 보드 작업입니다.');
 validatePeopleBoard(next,dex,entries);return next;
}

