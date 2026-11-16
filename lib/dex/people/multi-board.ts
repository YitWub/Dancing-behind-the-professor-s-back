import { ensure } from '../core/errors.ts';
import type { Dex,DexDocument,CollectionEntry } from '../core/types.ts';
import { initializeBoard,validatePeopleBoard,boardOccupants,vacantPosition,CARD_WIDTH,CARD_HEIGHT } from './board.ts';
import type { PeopleBoard } from './board.ts';
export interface PeopleBoardRecord {id:string;name:string;layout:PeopleBoard;view:{zoom:0.5|0.75|1}}
export interface PeopleBoardCollection {version:1;activeBoardId:string;boards:PeopleBoardRecord[]}
export type BoardManagementCommand=
 |{type:'initialize'}|{type:'create';id:string;name:string}|{type:'rename';boardId:string;name:string}
 |{type:'delete';boardId:string}|{type:'select';boardId:string}
 |{type:'place';boardId:string;entryId:string}|{type:'remove';boardId:string;entryId:string}
 |{type:'view';boardId:string;zoom:0.5|0.75|1};
export function placementId(boardId:string,entryId:string){return 'placement:'+JSON.stringify([boardId,entryId]);}
export function allBoardLayouts(dex:Dex):PeopleBoard[]{return dex.peopleBoards?dex.peopleBoards.boards.map(b=>b.layout):dex.peopleBoard?[dex.peopleBoard]:[];}
export function globalPeople(doc:DexDocument){const dexes=new Set(doc.dexes.filter(d=>d.kind==='people'&&d.ownerId===doc.profile.ownerId).map(d=>d.id));return doc.entries.filter(e=>e.subject.kind==='person'&&e.ownerId===doc.profile.ownerId&&dexes.has(e.dexId));}
function boardId(id:unknown):asserts id is string{ensure(typeof id==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(id),'보드 ID가 올바르지 않습니다.');}
function name(value:unknown):asserts value is string{ensure(typeof value==='string'&&!!value.trim()&&value.length<=80,'보드 이름은 1~80자로 작성해 주세요.');}
export function validateBoardCollection(value:unknown,dex:Dex,entries:CollectionEntry[]){
 ensure(!!value&&typeof value==='object'&&!Array.isArray(value),'보드 목록이 필요합니다.');
 const c=value as PeopleBoardCollection;ensure(Object.keys(c).every(k=>['version','activeBoardId','boards'].includes(k))&&c.version===1&&Array.isArray(c.boards)&&c.boards.length>0&&c.boards.length<=1000&&dex.kind==='people'&&!dex.peopleBoard,'보드 목록 형식을 확인해 주세요.');
 const ids=new Set<string>();for(const b of c.boards){
  ensure(b&&Object.keys(b).every(k=>['id','name','layout','view'].includes(k)),'보드 필드를 확인해 주세요.');boardId(b.id);name(b.name);ensure(!ids.has(b.id),'중복된 보드입니다.');ids.add(b.id);
  ensure(b.view&&Object.keys(b.view).length===1&&[.5,.75,1].includes(b.view.zoom),'보드 확대 값을 확인해 주세요.');
  validatePeopleBoard(b.layout,dex,entries);
  for(const p of b.layout.positions)ensure(p.placementId===placementId(b.id,p.entryId),'인연 배치 ID가 올바르지 않습니다.');
 }
 ensure(ids.has(c.activeBoardId),'선택한 보드가 없습니다.');
}
export function tagPlacements(board:PeopleBoardRecord){for(const p of board.layout.positions)p.placementId=placementId(board.id,p.entryId);}
export function migratePeopleBoards(doc:DexDocument){
 const modern=doc.dexes.find(d=>d.peopleBoards);if(modern)return {dex:modern,changed:false};
 const dexes=doc.dexes.filter(d=>d.kind==='people'&&d.ownerId===doc.profile.ownerId);const root=dexes[0];ensure(root,'인연도감이 없습니다.');
 const records:PeopleBoardRecord[]=[];
 for(const dex of dexes){
  const own=doc.entries.filter(e=>e.dexId===dex.id&&e.subject.kind==='person');
  if(dex!==root&&!dex.peopleBoard&&!own.length)continue;
  const layout=initializeBoard(dex.peopleBoard??{version:1,positions:[],edges:[]},doc.entries,dex.id);
  const record:PeopleBoardRecord={id:'board-legacy-'+dex.id,name:records.length?'기본 보드 '+(records.length+1):'기본 보드',layout,view:{zoom:.75}};
  tagPlacements(record);records.push(record);delete dex.peopleBoard;
 }
 root.peopleBoards={version:1,activeBoardId:records[0].id,boards:records};return {dex:root,changed:true};
}
export function selectedBoard(dex:Dex,id?:string){const c=dex.peopleBoards;ensure(c,'보드 목록을 먼저 초기화해 주세요.');const b=c.boards.find(b=>b.id===(id??c.activeBoardId));ensure(b,'보드를 찾을 수 없습니다.','NOT_FOUND');return b;}
export function placePerson(doc:DexDocument,dex:Dex,board:PeopleBoardRecord,entryId:string){
 ensure(globalPeople(doc).some(e=>e.id===entryId),'인연 원본을 찾을 수 없습니다.','NOT_FOUND');
 if(board.layout.positions.some(p=>p.entryId===entryId))return;
 const p=vacantPosition(boardOccupants(board.layout),CARD_WIDTH,CARD_HEIGHT);ensure(p,'보드의 빈 공간이 부족합니다.');
 board.layout.positions.push({entryId,placementId:placementId(board.id,entryId),...p});
}
export function manageBoards(doc:DexDocument,dex:Dex,command:BoardManagementCommand){
 ensure(dex.peopleBoards,'보드 목록을 먼저 초기화해 주세요.');const collection=dex.peopleBoards;
 const fields:Record<BoardManagementCommand['type'],string[]>={initialize:['type'],create:['type','id','name'],rename:['type','boardId','name'],delete:['type','boardId'],select:['type','boardId'],place:['type','boardId','entryId'],remove:['type','boardId','entryId'],view:['type','boardId','zoom']};
 ensure(command&&Object.hasOwn(fields,command.type)&&Object.keys(command).every(k=>fields[command.type].includes(k)),'지원하지 않는 보드 작업입니다.');
 if(command.type==='initialize')return;
 if(command.type==='create'){boardId(command.id);name(command.name);ensure(collection.boards.length<1000,'보드가 너무 많습니다.');const existing=collection.boards.find(b=>b.id===command.id);if(existing){ensure(existing.name===command.name.trim(),'같은 보드 생성 요청의 내용이 다릅니다.');return;}
  collection.boards.push({id:command.id,name:command.name.trim(),layout:{version:1,positions:[],edges:[]},view:{zoom:.75}});collection.activeBoardId=command.id;return;}
 const board=selectedBoard(dex,command.boardId);
 if(command.type==='select'){collection.activeBoardId=board.id;}
 else if(command.type==='rename'){name(command.name);board.name=command.name.trim();}
 else if(command.type==='delete'){ensure(collection.boards.length>1,'마지막 보드는 삭제할 수 없습니다.');collection.boards=collection.boards.filter(b=>b.id!==board.id);if(collection.activeBoardId===board.id)collection.activeBoardId=collection.boards[0].id;}
 else if(command.type==='place'){placePerson(doc,dex,board,command.entryId);}
 else if(command.type==='remove'){board.layout.positions=board.layout.positions.filter(p=>p.entryId!==command.entryId);board.layout.edges=board.layout.edges.filter(e=>e.a!==command.entryId&&e.b!==command.entryId);}
 else if(command.type==='view'){ensure([.5,.75,1].includes(command.zoom),'확대 값을 확인해 주세요.');board.view.zoom=command.zoom;}
}
