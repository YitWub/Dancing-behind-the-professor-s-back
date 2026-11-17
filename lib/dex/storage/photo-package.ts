import {PERSON_DETAIL_FIELDS,hasPersonDetails} from '../people/person-fields.ts';
import {isCharacterAvatar} from '../people/avatars.ts';
import { allBoardLayouts } from '../people/multi-board.ts';
import { ensure } from '../core/errors.ts';
import { parseBackup } from '../core/validation.ts';
import type { DexDocument } from '../core/types.ts';
import { verifyPrepared,MAX_PHOTO_TOTAL,MAX_PHOTO_ASSETS } from '../people/photo.ts';
import type { PhotoAsset } from '../people/photo.ts';
export const PACKAGE_MIME='application/vnd.bokak.backup',MAGIC='BOKAKPK5\n',MAX_MANIFEST=5*1024*1024,MAX_PACKAGE=MAX_PHOTO_TOTAL+MAX_MANIFEST+13;
const encoder=new TextEncoder();
export const MAGIC_V10='BOKAKP10\n';
const PACKAGE_MAGICS=[MAGIC,'BOKAKPK6\n','BOKAKPK7\n','BOKAKPK8\n','BOKAKPK9\n',MAGIC_V10];
export function hasCharacterData(doc:DexDocument){return doc.entries.some(e=>e.subject.kind==='person'&&['nickname','trait','tags','avatar','profileAssetId','characterIntro',...PERSON_DETAIL_FIELDS].some(k=>k in e.subject));}
export function photoReferences(doc:DexDocument){return new Set([...doc.dexes.flatMap(d=>allBoardLayouts(d).flatMap(b=>b.photos?.map(p=>p.assetId)??[])),...doc.entries.flatMap(e=>e.subject.kind==='person'&&e.subject.profileAssetId?[e.subject.profileAssetId]:[])]);}
export function packBackup(data:DexDocument,assets:PhotoAsset[],exportedAt:string){
 const version=data.entries.some(e=>hasPersonDetails(e.subject))?10:data.entries.some(e=>e.subject.kind==='person'&&(e.subject.characterIntro!==undefined||isCharacterAvatar(e.subject.avatar)||(e.subject.trait?.length??0)>100))?9:data.dexes.some(d=>d.peopleBoards?.boards.some(b=>b.layout.version===4))?8:hasCharacterData(data)?7:data.dexes.some(d=>d.peopleBoards)?6:5;
 const manifest={format:'bokak-dex',schemaVersion:version,exportedAt,containsSensitiveData:true,data,assets:assets.map(a=>a.info)};
 return packContainer(manifest,assets.map(a=>a.blob),version);
}
export function packContainer(manifest:unknown,blobs:Blob[],version=5){
 ensure(blobs.reduce((n,b)=>n+b.size,0)<=MAX_PHOTO_TOTAL,'사진 백업 한도를 초과합니다.');
 const metadata=encoder.encode(JSON.stringify(manifest));ensure(metadata.length<=MAX_MANIFEST,'기록 메타데이터가 5MB를 초과합니다.');
 ensure([5,6,7,8,9,10].includes(version),'지원하지 않는 패키지 버전입니다.');
 const head=new Uint8Array(13);head.set(encoder.encode(version===10?MAGIC_V10:version>=6?'BOKAKPK'+version+'\n':MAGIC));new DataView(head.buffer).setUint32(9,metadata.length,true);
 return new Blob([head,metadata,...blobs],{type:PACKAGE_MIME});
}
export async function isPhotoPackage(blob:Blob){return PACKAGE_MAGICS.includes(new TextDecoder().decode(await blob.slice(0,9).arrayBuffer()));}
export async function unpackBackup(file:Blob){
 ensure(file.size<=MAX_PACKAGE&&file.size>=13,'사진 백업 크기를 확인해 주세요.');
 const head=new Uint8Array(await file.slice(0,13).arrayBuffer());const magic=new TextDecoder().decode(head.subarray(0,9));ensure(PACKAGE_MAGICS.includes(magic),'BOKAK 사진 백업이 아닙니다.');
 const length=new DataView(head.buffer).getUint32(9,true);ensure(length>0&&length<=MAX_MANIFEST&&13+length<=file.size,'백업 헤더를 확인해 주세요.');
 const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await file.slice(13,13+length).arrayBuffer()));
 ensure(raw&&Object.keys(raw).every(k=>['format','schemaVersion','exportedAt','containsSensitiveData','data','assets'].includes(k))&&raw.schemaVersion===(magic===MAGIC_V10?10:Number(magic.slice(7,8))),'사진 백업 버전을 확인해 주세요.');
 const {assets:infos,...envelope}=raw;
 const document=parseBackup(JSON.stringify(envelope)).data;ensure(Array.isArray(infos)&&infos.length<=MAX_PHOTO_ASSETS,'사진 목록을 확인해 주세요.');
 const refs=photoReferences(document),seen=new Set<string>(),assets:PhotoAsset[]=[];let offset=13+length,total=0;
 for(const info of infos){
  ensure(info&&Object.keys(info).every(k=>['id','ownerId','mime','bytes','width','height','sha256'].includes(k))&&info.id==='img-'+info.sha256&&info.ownerId===document.profile.ownerId&&refs.has(info.id)&&!seen.has(info.id)&&Number.isSafeInteger(info.bytes)&&info.bytes>0,'사진 참조·식별자·용량이 올바르지 않습니다.');
  total+=info.bytes;ensure(total<=MAX_PHOTO_TOTAL&&offset+info.bytes<=file.size,'사진이 누락되었거나 백업 용량을 초과합니다.');
  const blob=file.slice(offset,offset+info.bytes,info.mime);await verifyPrepared({...info,blob});
  assets.push({info,blob});seen.add(info.id);offset+=info.bytes;
 }
 ensure(offset===file.size&&seen.size===refs.size,'누락되거나 불필요한 사진 파일이 있습니다.');
 return {document,assets};
}
