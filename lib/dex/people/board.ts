import {applyConnection,removeObjectConnections,validateConnections} from './connections.ts';
import type {BoardConnection,ConnectionCommand} from './connections.ts';
import { PHOTO_SIZES } from './photo.ts';
import type { BoardPhoto,PhotoSize } from './photo.ts';
import { ensure } from '../core/errors.ts';
import type { CollectionEntry, Dex } from '../core/types.ts';
export const BOARD_WIDTH=2400, BOARD_HEIGHT=1800, CARD_WIDTH=160, CARD_HEIGHT=180;
export const NOTE_WIDTH=200, NOTE_HEIGHT=180;
export const THREAD_STYLES=['red','olive','twine'] as const;
export type ThreadStyle=typeof THREAD_STYLES[number];
export const NOTE_COLORS=['yellow','green','pink','blue'] as const;
export type NoteColor=typeof NOTE_COLORS[number];
export interface BoardPosition {entryId:string;x:number;y:number;placementId?:string}
export interface BoardEdge {id:string;a:string;b:string;style?:ThreadStyle}
export interface BoardNote {id:string;text:string;color:NoteColor;x:number;y:number}
export interface PeopleBoard {version:1|2|3|4;connections?:BoardConnection[];positions:BoardPosition[];edges:BoardEdge[];notes?:BoardNote[];photos?:BoardPhoto[]}
export type BoardCommand=ConnectionCommand
 |{type:'initialize'}|{type:'move';entryId:string;x:number;y:number}
 |{type:'connect';a:string;b:string;style?:ThreadStyle}|{type:'disconnect';id:string}
 |{type:'style-edge';id:string;style:ThreadStyle}
 |{type:'add-note';id:string;text:string;color:NoteColor}
 |{type:'edit-note';id:string;text:string;color:NoteColor}
 |{type:'move-note';id:string;x:number;y:number}|{type:'delete-note';id:string}
 |{type:'move-photo';id:string;x:number;y:number}|{type:'edit-photo';id:string;caption:string;size:PhotoSize}|{type:'delete-photo';id:string};
export function edgeKey(a:string,b:string){return JSON.stringify([a,b].sort());}
export function clampPosition(x:number,y:number,width=CARD_WIDTH,height=CARD_HEIGHT){return {x:Math.round(Math.min(BOARD_WIDTH-width,Math.max(0,x))),y:Math.round(Math.min(BOARD_HEIGHT-height,Math.max(0,y)))};}
function fields(value:unknown,keys:string[]):asserts value is Record<string,unknown>{ensure(!!value&&typeof value==='object'&&!Array.isArray(value),'보드 형식이 올바르지 않습니다.');ensure(Object.keys(value).every(key=>keys.includes(key)),'지원하지 않는 보드 필드입니다.');}
function coordinate(x:unknown,y:unknown,width:number,height:number){ensure(typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=BOARD_WIDTH-width&&typeof y==='number'&&Number.isFinite(y)&&y>=0&&y<=BOARD_HEIGHT-height,'보드 좌표 범위를 확인해 주세요.');}
function noteInput(id:unknown,text:unknown,color:unknown){ensure(typeof id==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(id),'메모 식별자를 확인해 주세요.');ensure(typeof text==='string'&&text.trim().length>0&&text.length<=500,'메모는 1~500자로 작성해 주세요.');ensure(NOTE_COLORS.includes(color as NoteColor),'메모 색상을 확인해 주세요.');}
export function validatePeopleBoard(value:unknown,dex:Dex,entries:CollectionEntry[]):asserts value is PeopleBoard{
 fields(value,['version','positions','edges',...(!!value&&typeof value==='object'&&((value as {version?:number}).version??0)>=2?['notes',...(((value as {version?:number}).version??0)>=3?['photos',...((value as {version?:number}).version===4?['connections']:[])]:[])]:[])]);
 ensure(dex.kind==='people'&&(value.version===1||value.version===2||value.version===3||value.version===4),'인연도감 보드 버전을 확인해 주세요.');
 ensure(Array.isArray(value.positions)&&value.positions.length<=10000&&Array.isArray(value.edges)&&value.edges.length<=10000,'보드 크기를 확인해 주세요.');
 const people=new Set(entries.filter(e=>(dex.peopleBoards||e.dexId===dex.id)&&e.ownerId===dex.ownerId&&e.subject.kind==='person').map(e=>e.id));
 const placed=new Set<string>(),edges=new Set<string>(),noteIds=new Set<string>();
 for(const raw of value.positions as unknown[]){fields(raw,['entryId','x','y',...(dex.peopleBoards?['placementId']:[])]);ensure(typeof raw.entryId==='string'&&people.has(raw.entryId)&&!placed.has(raw.entryId),'보드 카드 참조 또는 중복을 확인해 주세요.');coordinate(raw.x,raw.y,CARD_WIDTH,CARD_HEIGHT);placed.add(raw.entryId);}
 for(const raw of value.edges as unknown[]){fields(raw,['id','a','b',...((value.version as number)>=2?['style']:[])]);ensure(typeof raw.a==='string'&&typeof raw.b==='string'&&raw.a!==raw.b&&people.has(raw.a)&&people.has(raw.b)&&placed.has(raw.a)&&placed.has(raw.b),'실의 인연 참조를 확인해 주세요.');const key=edgeKey(raw.a as string,raw.b as string);ensure(raw.id===key&&!edges.has(key),'같은 실을 중복 연결할 수 없습니다.');if(raw.style!==undefined)ensure(THREAD_STYLES.includes(raw.style as ThreadStyle),'실 스타일을 확인해 주세요.');edges.add(key);}
 if(value.notes!==undefined){ensure((value.version as number)>=2&&Array.isArray(value.notes)&&value.notes.length<=500,'메모는 보드당 500개까지 저장할 수 있어요.');for(const raw of value.notes as unknown[]){fields(raw,['id','text','color','x','y']);noteInput(raw.id,raw.text,raw.color);ensure(!noteIds.has(raw.id as string)&&!people.has(raw.id as string),'중복된 메모 식별자입니다.');coordinate(raw.x,raw.y,NOTE_WIDTH,NOTE_HEIGHT);noteIds.add(raw.id as string);}}
 if(value.photos!==undefined){ensure((value.version as number)>=3&&Array.isArray(value.photos)&&value.photos.length<=100,'보드 사진은 100개까지 지원합니다.');const ids=new Set<string>();for(const raw of value.photos as unknown[]){fields(raw,['id','assetId','caption','size','x','y']);validatePhoto(raw);ensure(!ids.has(raw.id as string)&&!people.has(raw.id as string)&&!noteIds.has(raw.id as string),'사진 식별자가 중복됩니다.');const size=PHOTO_SIZES[raw.size as PhotoSize];coordinate(raw.x,raw.y,size.width,size.height);ids.add(raw.id as string);}}
 if(value.version===4){ensure(!!dex.peopleBoards,'자유 연결은 다중 보드가 필요합니다.');validateConnections(value as unknown as PeopleBoard);}
}
export function boardOccupants(board:PeopleBoard){return [...board.positions.map(p=>({...p,width:CARD_WIDTH,height:CARD_HEIGHT})),...(board.notes??[]).map(n=>({...n,width:NOTE_WIDTH,height:NOTE_HEIGHT})),...(board.photos??[]).map(p=>({...p,...PHOTO_SIZES[p.size]}))];}
export function vacantPosition(occupied:readonly {x:number;y:number;width:number;height:number}[],width:number,height:number){
 for(let y=24;y<=BOARD_HEIGHT-height;y+=40)for(let x=24;x<=BOARD_WIDTH-width;x+=40)if(occupied.every(p=>x+width+12<=p.x||p.x+p.width+12<=x||y+height+12<=p.y||p.y+p.height+12<=y))return {x,y};
 return null;
}
export function initializeBoard(board:PeopleBoard,entries:CollectionEntry[],dexId:string):PeopleBoard{
 const next=structuredClone(board);
 for(const entry of entries.filter(e=>e.dexId===dexId&&e.subject.kind==='person').sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id))){
  if(next.positions.some(p=>p.entryId===entry.id))continue;
  let placed=false;
  for(let y=24;y<=BOARD_HEIGHT-CARD_HEIGHT&&!placed;y+=220)for(let x=24;x<=BOARD_WIDTH-CARD_WIDTH;x+=200){
   if(boardOccupants(next).every(p=>x+CARD_WIDTH+12<=p.x||p.x+p.width+12<=x||y+CARD_HEIGHT+12<=p.y||p.y+p.height+12<=y)){next.positions.push({entryId:entry.id,x,y});placed=true;break;}
  }
  ensure(placed,'보드의 빈 공간이 부족합니다. 기존 카드를 옮겨 공간을 만들어 주세요.');
 }
 return next;
}
export function applyBoardCommand(dex:Dex,entries:CollectionEntry[],command:BoardCommand,boardId?:string):PeopleBoard{
 ensure(dex.kind==='people','인연도감에서만 보드를 사용할 수 있습니다.');
 if(command.type==='connect-objects'||command.type==='edit-connection'||command.type==='delete-connection'){ensure(boardId&&dex.peopleBoard,'확장 연결은 보드가 필요합니다.');const next=structuredClone(dex.peopleBoard);applyConnection(next,boardId,command);validatePeopleBoard(next,dex,entries);return next;}
 const allowed:Record<Exclude<BoardCommand,ConnectionCommand>['type'],string[]>={initialize:['type'],move:['type','entryId','x','y'],connect:['type','a','b','style'],disconnect:['type','id'],'style-edge':['type','id','style'],'add-note':['type','id','text','color'],'edit-note':['type','id','text','color'],'move-note':['type','id','x','y'],'delete-note':['type','id'],'move-photo':['type','id','x','y'],'edit-photo':['type','id','caption','size'],'delete-photo':['type','id']};
 ensure(command&&allowed[command.type],'지원하지 않는 보드 작업입니다.');fields(command,allowed[command.type]);
 const next=initializeBoard(dex.peopleBoard??{version:1,positions:[],edges:[]},entries,dex.id);
 const extend=()=>{next.version=next.version>=3?next.version:2;next.notes??=[];};
 if(command.type==='move'){
  ensure(Number.isFinite(command.x)&&Number.isFinite(command.y),'좌표가 올바르지 않습니다.');
  const position=next.positions.find(p=>p.entryId===command.entryId);ensure(position,'인연 카드를 찾을 수 없습니다.');Object.assign(position,clampPosition(command.x,command.y));
 }else if(command.type==='connect'){
  ensure(next.version!==4,'새 연결 명령을 사용해 주세요.');
  ensure(command.a!==command.b,'같은 인연끼리는 연결할 수 없습니다.');
  ensure(next.positions.some(p=>p.entryId===command.a)&&next.positions.some(p=>p.entryId===command.b),'같은 보드의 인연만 연결할 수 있습니다.');
  if(command.style!==undefined)ensure(THREAD_STYLES.includes(command.style),'실 스타일을 확인해 주세요.');
  const id=edgeKey(command.a,command.b);if(!next.edges.some(e=>e.id===id)){const [a,b]=[command.a,command.b].sort();if(command.style!==undefined)extend();next.edges.push({id,a,b,...(command.style?{style:command.style}:{})});}
 }else if(command.type==='disconnect'){next.edges=next.edges.filter(e=>e.id!==command.id);}
 else if(command.type==='style-edge'){ensure(THREAD_STYLES.includes(command.style),'실 스타일을 확인해 주세요.');const edge=next.edges.find(e=>e.id===command.id);ensure(edge,'연결을 찾을 수 없습니다.');extend();edge.style=command.style;}
 else if(command.type==='add-note'){
  noteInput(command.id,command.text,command.color);ensure(!next.positions.some(p=>p.entryId===command.id),'인연과 메모 식별자가 겹칩니다.');
  const existing=next.notes?.find(n=>n.id===command.id);
  if(existing)ensure(existing.text===command.text&&existing.color===command.color,'같은 메모 요청의 내용이 다릅니다.','REQUEST_ID_CONFLICT');
  else{ensure((next.notes?.length??0)<500,'메모는 보드당 500개까지 저장할 수 있어요.');const position=vacantPosition(boardOccupants(next),NOTE_WIDTH,NOTE_HEIGHT);ensure(position,'빈 공간이 부족합니다. 기존 카드를 옮겨 주세요.');extend();next.notes!.push({id:command.id,text:command.text,color:command.color,...position});}
 }else if(command.type==='edit-note'||command.type==='move-note'){
  const note=next.notes?.find(n=>n.id===command.id);ensure(note,'메모를 찾을 수 없습니다.');
  if(command.type==='edit-note'){noteInput(command.id,command.text,command.color);Object.assign(note,{text:command.text,color:command.color});}
  else{ensure(Number.isFinite(command.x)&&Number.isFinite(command.y),'좌표가 올바르지 않습니다.');Object.assign(note,clampPosition(command.x,command.y,NOTE_WIDTH,NOTE_HEIGHT));}
 }else if(command.type==='delete-note'){removeObjectConnections(next,{type:'note',objectId:command.id});if(next.notes)next.notes=next.notes.filter(n=>n.id!==command.id);}
 else if(command.type==='move-photo'||command.type==='edit-photo'){
  const photo=next.photos?.find(p=>p.id===command.id);ensure(photo,'사진을 찾을 수 없습니다.');
  if(command.type==='edit-photo'){validatePhoto({...photo,caption:command.caption,size:command.size});Object.assign(photo,{caption:command.caption,size:command.size});}
  else ensure(Number.isFinite(command.x)&&Number.isFinite(command.y),'사진 좌표를 확인해 주세요.');
  Object.assign(photo,clampPosition(command.type==='move-photo'?command.x:photo.x,command.type==='move-photo'?command.y:photo.y,PHOTO_SIZES[photo.size].width,PHOTO_SIZES[photo.size].height));
 }else if(command.type==='delete-photo'){removeObjectConnections(next,{type:'photo',objectId:command.id});if(next.photos)next.photos=next.photos.filter(p=>p.id!==command.id);}

 validatePeopleBoard(next,dex,entries);return next;
}

export function validatePhoto(photo:unknown):asserts photo is BoardPhoto{
 fields(photo,['id','assetId','caption','size','x','y']);
 ensure(typeof photo.id==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(photo.id)&&typeof photo.assetId==='string'&&/^img-[a-f0-9]{64}$/.test(photo.assetId),'사진 식별자를 확인해 주세요.');
 ensure(typeof photo.caption==='string'&&photo.caption.length<=140&&typeof photo.size==='string'&&Object.hasOwn(PHOTO_SIZES,photo.size),'사진 설명은 140자 이내, 크기는 프리셋을 사용해 주세요.');
}
export function addBoardPhoto(dex:Dex,entries:CollectionEntry[],draft:Pick<BoardPhoto,'id'|'assetId'|'caption'|'size'>){
 ensure(dex.kind==='people','인연 보드만 지원합니다.');const next=initializeBoard(dex.peopleBoard??{version:1,positions:[],edges:[]},entries,dex.id);
 validatePhoto({...draft,x:0,y:0});const existing=next.photos?.find(p=>p.id===draft.id);
 if(existing){ensure(existing.assetId===draft.assetId&&existing.caption===draft.caption&&existing.size===draft.size,'같은 사진 요청의 내용이 다릅니다.','REQUEST_ID_CONFLICT');return next;}
 ensure((next.photos?.length??0)<100,'보드 사진은 100개까지 지원합니다.');const size=PHOTO_SIZES[draft.size],position=vacantPosition(boardOccupants(next),size.width,size.height);ensure(position,'보드의 빈 공간이 부족합니다.');
 next.version=next.version===4?4:3;next.notes??=[];next.photos??=[];next.photos.push({...draft,...position});validatePeopleBoard(next,dex,entries);return next;
}
