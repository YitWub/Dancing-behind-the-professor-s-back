import {ensure} from '../core/errors.ts';
import type {PeopleBoardRecord} from './multi-board.ts';
import type {PeopleBoard,ThreadStyle} from './board.ts';
export interface ObjectRef {type:'person'|'note'|'photo';objectId:string}
export interface BoardConnection {id:string;boardId:string;from:ObjectRef;to:ObjectRef;style:ThreadStyle;label:string;createdAt:string}
export type ConnectionCommand={type:'connect-objects';connection:BoardConnection}|{type:'edit-connection';id:string;label:string;style:ThreadStyle}|{type:'delete-connection';id:string};
export const refKey=(ref:ObjectRef)=>JSON.stringify([ref.type,ref.objectId]);
export function objectExists(board:PeopleBoard,ref:ObjectRef){return ref.type==='person'?board.positions.some(p=>p.placementId===ref.objectId):ref.type==='note'?!!board.notes?.some(n=>n.id===ref.objectId):ref.type==='photo'?!!board.photos?.some(p=>p.id===ref.objectId):false;}
function fields(v:unknown,keys:string[]):asserts v is Record<string,unknown>{ensure(!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k)),'실 필드를 확인해 주세요.');}
export function validateConnections(board:PeopleBoard,boardId?:string){
 ensure(board.version===4&&Array.isArray(board.connections)&&board.connections.length<=10000&&board.edges.length===0,'확장 연결 형식을 확인해 주세요.');
 const ids=new Set<string>();
 for(const c of board.connections){fields(c,['id','boardId','from','to','style','label','createdAt']);ensure(typeof c.id==='string'&&c.id.length<=1000&&c.id.length>0&&!ids.has(c.id),'실 ID가 중복되거나 올바르지 않습니다.');ids.add(c.id);
 ensure(typeof c.boardId==='string'&&!!c.boardId&&(!boardId||c.boardId===boardId),'다른 보드의 연결입니다.');
 for(const ref of [c.from,c.to]){fields(ref,['type','objectId']);ensure(['person','note','photo'].includes(ref.type as string)&&typeof ref.objectId==='string'&&objectExists(board,ref as unknown as ObjectRef),'실의 객체 참조가 없습니다.');}
 ensure(refKey(c.from)!==refKey(c.to),'자기 자신과 연결할 수 없습니다.');
 ensure(['red','olive','twine'].includes(c.style)&&typeof c.label==='string'&&c.label.length<=80,'실 스타일 또는 설명(80자)을 확인해 주세요.');
 ensure(typeof c.createdAt==='string'&&Number.isFinite(Date.parse(c.createdAt))&&new Date(c.createdAt).toISOString()===c.createdAt,'실 생성 시각을 확인해 주세요.');
 }
}
export function migrateConnections(record:PeopleBoardRecord,createdAt:string){
 if(record.layout.version===4)return false;
 const b=record.layout;
 const connections=b.edges.map(edge=>{
 const a=b.positions.find(p=>p.entryId===edge.a),z=b.positions.find(p=>p.entryId===edge.b);
 ensure(a?.placementId&&z?.placementId,'이전 실의 연결 대상을 찾을 수 없습니다. 기존 보드는 변경하지 않았습니다.');
 return {id:'legacy:'+JSON.stringify([record.id,edge.id]),boardId:record.id,from:{type:'person' as const,objectId:a.placementId},to:{type:'person' as const,objectId:z.placementId},style:edge.style??'red',label:'',createdAt};
 });
 b.version=4;b.connections=connections;b.edges=[];b.notes??=[];b.photos??=[];validateConnections(b,record.id);return true;
}
export function applyConnection(board:PeopleBoard,boardId:string,command:ConnectionCommand){
 ensure(board.version===4,'보드 연결을 먼저 이전해 주세요.');
 if(command.type==='connect-objects'){fields(command,['type','connection']);const c=structuredClone(command.connection),existing=board.connections!.find(e=>e.id===c.id);
 if(existing){ensure(JSON.stringify(existing)===JSON.stringify(c),'같은 실 저장 요청의 내용이 다릅니다.','REQUEST_ID_CONFLICT');return;}
 board.connections!.push(c);
 }else if(command.type==='edit-connection'){fields(command,['type','id','label','style']);const c=board.connections!.find(c=>c.id===command.id);ensure(c,'실을 찾을 수 없습니다.');c.label=command.label;c.style=command.style;
 }else{fields(command,['type','id']);board.connections=board.connections!.filter(c=>c.id!==command.id);}
 validateConnections(board,boardId);
}
export function removeObjectConnections(board:PeopleBoard,ref:ObjectRef){if(board.connections)board.connections=board.connections.filter(c=>refKey(c.from)!==refKey(ref)&&refKey(c.to)!==refKey(ref));}
