import {migrateConnections,removeObjectConnections} from '../people/connections.ts';
import { migratePeopleBoards,manageBoards,selectedBoard,tagPlacements,placePerson,allBoardLayouts } from '../people/multi-board.ts';
import type { BoardManagementCommand } from '../people/multi-board.ts';
import { packBackup,packContainer,unpackBackup,isPhotoPackage,photoReferences,hasCharacterData,MAX_PACKAGE } from './photo-package.ts';
import { verifyPrepared,imageHash,MAX_PHOTO_TOTAL,MAX_PHOTO_ASSETS } from '../people/photo.ts';
import type { PhotoAsset,PreparedImage,BoardPhoto,ImageInfo } from '../people/photo.ts';
import { applyBoardCommand,addBoardPhoto } from '../people/board.ts';
import type { BoardCommand } from '../people/board.ts';
import { normalizeLegacyCards } from '../meal/card-editions.ts';
import { DexError, ensure, resultOf } from '../core/errors.ts';
import { applyCollection, initialDocument, owner, find, version, touch, checkRevision, collectMeal } from '../core/engine.ts';
import { canonical, collectInput, fingerprint, validateDocument, parseBackup, object } from '../core/validation.ts';
import type { Runtime } from '../core/engine.ts';
import type { BackupEnvelope, CollectCommand, CollectMealCommand, Dex, DexDocument, DexRepository, EntrySubject, ImportPreview, LocalDate, Namespace, Rating } from '../core/types.ts';

export const DATABASE_NAME = 'bokak.dex';
export const DATABASE_VERSION = 2;
const STORES = ['meta', 'dexes', 'entries', 'experiences', 'requestReceipts'] as const;
type StoreName = typeof STORES[number];
type RawState = Record<StoreName, unknown[]>;
interface Options {
  databaseName?: string;
  namespace?: Namespace;
  factory?: IDBFactory;
  runtime?: Runtime;
  onCommitted?: () => void;
  /** 동기 테스트 훅. 모든 쓰기를 큐에 넣은 뒤 호출하므로 예외 시 전체 transaction이 abort된다. */
  beforeCommit?: () => void;
}
interface PendingImport { document: DexDocument; expectedRaw: string; assets:PhotoAsset[] }

/** await는 transaction 밖에서만 사용한다. 내부 작업은 IDB request callback에서 동기적으로 큐잉한다. */
export class IndexedDbDexRepository implements DexRepository {
  private db: IDBDatabase | null = null;
  private connecting: Promise<IDBDatabase> | null = null;
  private pending = new Map<string, PendingImport>();
  private failures=new WeakMap<IDBTransaction,unknown>();
  private options: Options;
  private runtime: Runtime;
  private namespace: Namespace;
  constructor(options: Options = {}) {
    this.options = options;
    this.namespace = options.namespace ?? 'personal';
    this.runtime = options.runtime ?? { id: () => crypto.randomUUID(), now: () => new Date().toISOString() };
  }
  close() { this.db?.close(); this.db = null; this.pending.clear(); }
  private connect(): Promise<IDBDatabase> {
    if (this.db) return Promise.resolve(this.db);
    if (this.connecting) return this.connecting;
    const factory = this.options.factory ?? globalThis.indexedDB;
    if (!factory) return Promise.reject(new DexError('STORAGE_UNAVAILABLE', '이 환경에서는 IndexedDB를 사용할 수 없습니다.'));
    this.connecting = new Promise<IDBDatabase>((resolve, reject) => {
      let finished = false;
      const request = factory.open(this.options.databaseName ?? DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = event => {
        if(event.oldVersion>0&&!STORES.every(name=>request.result.objectStoreNames.contains(name))){request.transaction?.abort();return;}
        const db = request.result;
        if(!db.objectStoreNames.contains('meta')){
        db.createObjectStore('meta', { keyPath: 'id' });
        const dexes = db.createObjectStore('dexes', { keyPath: 'id' });
        dexes.createIndex('ownerId', 'ownerId');
        const entries = db.createObjectStore('entries', { keyPath: 'id' });
        entries.createIndex('byDex', ['ownerId','dexId']);
        entries.createIndex('mealUniqueKey', 'mealUniqueKey', { unique: true });
        const experiences = db.createObjectStore('experiences', { keyPath: 'id' });
        experiences.createIndex('byEntry', ['ownerId','entryId']);
        experiences.createIndex('byDex', ['ownerId','dexId']);
        db.createObjectStore('requestReceipts', { keyPath: 'id' });
        }
        if(!db.objectStoreNames.contains('photoAssets'))db.createObjectStore('photoAssets',{keyPath:'id'});
        if(!db.objectStoreNames.contains('photoAssetInfo'))db.createObjectStore('photoAssetInfo',{keyPath:'id'});
      };
      request.onblocked = () => { finished = true; reject(new DexError('STORAGE_BLOCKED', '다른 탭이 저장소를 사용 중입니다. 해당 탭을 닫거나 새로고침해 주세요.')); };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        if (finished) { db.close(); return; }
        if (![...STORES,'photoAssets','photoAssetInfo'].every(name => db.objectStoreNames.contains(name))) {
          db.close(); reject(new DexError('CORRUPT_STORAGE', '저장소 구조가 올바르지 않습니다. 자동 초기화하지 않았습니다.')); return;
        }
        db.onversionchange = () => { db.close(); if (this.db === db) this.db = null; this.pending.clear(); };
        this.db = db; resolve(db);
      };
    }).finally(() => { this.connecting = null; });
    return this.connecting;
  }
  private async transaction<T>(mode: IDBTransactionMode, execute: (raw: RawState, tx: IDBTransaction) => { value: T; changed?: boolean }): Promise<T> {
    const db = await this.connect();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction([...STORES,'photoAssets','photoAssetInfo'], mode);
      const raw = {} as RawState;
      let waiting = STORES.length;
      let response: { value: T; changed?: boolean };
      let failure: unknown;
      tx.onabort = () => reject(failure ?? this.failures.get(tx) ?? tx.error ?? new Error('Transaction aborted'));
      tx.onerror = () => { /* 기본 abort를 유지한다. request 성공을 commit으로 취급하지 않는다. */ };
      tx.oncomplete = () => {
        resolve(response.value);
        if (response.changed) { try { this.options.onCommitted?.(); } catch { /* UI 알림 실패가 저장을 되돌리지 않는다. */ } }
      };
      for (const name of STORES) {
        const request = tx.objectStore(name).getAll();
        request.onsuccess = () => {
          raw[name] = request.result;
          if (--waiting !== 0) return;
          try { response = execute(raw, tx); }
          catch (error) {
            failure = error;
            // 외부 오류로 이미 abort된 경우 두 번째 abort가 InvalidStateError를 던질 수 있다.
            // 그 예외를 새 브라우저 오류로 만들지 않고 등록된 onabort에서 실패를 확정한다.
            try { tx.abort(); } catch { /* 이미 중단된 transaction */ }
          }
        };
      }
    });
  }
  private abort(tx:IDBTransaction,error:unknown){this.failures.set(tx,error);try{tx.abort();}catch{/* Already aborted. */}}
  private removePlacements(doc:DexDocument,ids:Set<string>){
    for(const dex of doc.dexes){let changed=false;for(const board of allBoardLayouts(dex)){for(const p of board.positions)if(ids.has(p.entryId)&&p.placementId)removeObjectConnections(board,{type:'person',objectId:p.placementId});const positions=board.positions.filter(p=>!ids.has(p.entryId)),edges=board.edges.filter(e=>!ids.has(e.a)&&!ids.has(e.b));if(positions.length!==board.positions.length||edges.length!==board.edges.length){board.positions=positions;board.edges=edges;changed=true;}}if(changed)touch(dex,this.runtime);}
  }
  private putProfileImage(tx:IDBTransaction,ownerId:string,image:PreparedImage){
    const info:ImageInfo={id:'img-'+image.sha256,ownerId,mime:image.mime,bytes:image.bytes,width:image.width,height:image.height,sha256:image.sha256};
    const infos=tx.objectStore('photoAssetInfo'),request=infos.getAll();
    request.onsuccess=()=>{const rows=request.result as ImageInfo[],old=rows.find(i=>i.id===info.id);if((old&&old.ownerId!==ownerId)||rows.reduce((n,i)=>n+(i.id===info.id?0:i.bytes),image.bytes)>MAX_PHOTO_TOTAL||rows.length+(old?0:1)>MAX_PHOTO_ASSETS)this.abort(tx,new DOMException('사진 저장 한도를 초과했습니다.','QuotaExceededError'));};
    tx.objectStore('photoAssets').put({id:info.id,blob:image.blob});infos.put(info);
  }
  private cleanAssets(tx:IDBTransaction,doc:DexDocument){
    const refs=photoReferences(doc),assets=tx.objectStore('photoAssets'),infos=tx.objectStore('photoAssetInfo');
    for(const id of refs){const info=infos.get(id);info.onsuccess=()=>{if(!info.result||info.result.ownerId!==doc.profile.ownerId)this.abort(tx,new DexError('CORRUPT_STORAGE','사진 참조를 확인할 수 없습니다. 자동 초기화하지 않았습니다.'));};const blob=assets.getKey(id);blob.onsuccess=()=>{if(blob.result===undefined)this.abort(tx,new DexError('CORRUPT_STORAGE','사진 파일이 누락되었습니다.'));};}
    const keys=assets.getAllKeys();keys.onsuccess=()=>{for(const key of keys.result)if(!refs.has(String(key))){assets.delete(key);infos.delete(key);}};
    const meta=infos.getAllKeys();meta.onsuccess=()=>{for(const key of meta.result)if(!refs.has(String(key)))infos.delete(key);};
  }
  private decode(raw: RawState): DexDocument {
    try {
      ensure(raw.meta.length === 1, '프로필이 없거나 중복되었습니다.');
      const entries = raw.entries.map(row => {
        const copy = { ...(row as Record<string, unknown>) }; delete copy.mealUniqueKey; return copy;
      });
      const doc = { profile: raw.meta[0], dexes: raw.dexes, entries, experiences: raw.experiences, receipts: raw.requestReceipts };
      validateDocument(doc);
      ensure(doc.profile.namespace === this.namespace, '저장소 용도가 다릅니다.');
      normalizeLegacyCards(doc);
      return doc;
    } catch { throw new DexError('CORRUPT_STORAGE', '저장된 기록의 구조·참조를 확인할 수 없습니다. 자동 초기화하지 않았습니다. 복구용 내보내기 또는 검증된 백업 복원을 이용하세요.'); }
  }
  private persist(tx: IDBTransaction, doc: DexDocument) {
    validateDocument(doc);
    for (const name of STORES) tx.objectStore(name).clear();
    tx.objectStore('meta').put(doc.profile);
    for (const row of doc.dexes) tx.objectStore('dexes').put(row);
    for (const row of doc.entries) tx.objectStore('entries').put({ ...row,
      ...(row.subject.kind === 'meal' ? { mealUniqueKey: canonical([row.ownerId,row.dexId,row.subject.dishId]) } : {}),
    });
    for (const row of doc.experiences) tx.objectStore('experiences').put(row);
    for (const row of doc.receipts) tx.objectStore('requestReceipts').put(row);
    this.cleanAssets(tx,doc);
    this.options.beforeCommit?.();
  }
  private document<T>(write: boolean, operation: (doc: DexDocument, tx: IDBTransaction) => { value: T; changed?: boolean }, initialize = false): Promise<T> {
    return this.transaction(write ? 'readwrite' : 'readonly', (raw, tx) => {
      const empty = STORES.every(name => raw[name].length === 0);
      const bootstrap = initialize && empty;
      const legacyMigration=write&&raw.experiences.some(row=>{const exp=row as {kind?:string;card?:unknown};return exp.kind==='meal'&&!exp.card;});
      if(bootstrap){for(const store of ['photoAssets','photoAssetInfo']){const existing=tx.objectStore(store).count();existing.onsuccess=()=>{if(existing.result)this.abort(tx,new DexError('CORRUPT_STORAGE','프로필 없는 사진이 남아 있어 자동 초기화하지 않았습니다.'));};}}
      const doc = bootstrap ? initialDocument(this.runtime, this.namespace) : this.decode(raw);
      const response = operation(doc,tx);
      if(legacyMigration)response.changed=true;
      if (bootstrap || response.changed) {
        if (response.changed) doc.profile.revision++;
        this.persist(tx, doc);
      }
      return { ...response, changed: bootstrap || response.changed };
    });
  }
  open() { return resultOf(() => this.document(true, doc => ({ value: { ownerId: doc.profile.ownerId, schemaVersion: 1 as const } }), true)); }
  snapshot() { return resultOf(() => this.document(false, doc => ({ value: doc }))); }
  listDexes(ownerId: string) { return resultOf(() => this.document(false, doc => { owner(doc, ownerId); return { value: doc.dexes }; })); }
  createDex(ownerId: string, draft: { kind: Dex['kind']; name: string; icon: string }) {
    return resultOf(() => this.document(true, doc => {
      owner(doc, ownerId); object(draft, ['kind','name','icon']);
      const existing = draft.kind === 'course' ? doc.dexes.find(d => d.kind === 'course') : undefined;
      if (existing) return { value: existing, changed: false };
      const dex: Dex = { ...version(this.runtime), ...draft, ownerId, visibility: 'private', progress: { mode: 'count-only' } };
      doc.dexes.push(dex); return { value: dex, changed: true };
    }));
  }
  updateDex(ownerId: string, id: string, revision: number, patch: { name?: string; icon?: string }) {
    return resultOf(() => this.document(true, doc => {
      owner(doc,ownerId); object(patch,['name','icon']); const dex = find(doc.dexes,id); checkRevision(dex,revision);
      Object.assign(dex,patch); touch(dex,this.runtime); return {value:dex,changed:true};
    }));
  }
  managePeopleBoards(ownerId:string,dexId:string,revision:number,command:BoardManagementCommand){return resultOf(()=>this.document(true,doc=>{
    owner(doc,ownerId);const selected=find(doc.dexes,dexId);ensure(selected.kind==='people','인연 보드만 지원합니다.');
    if(command.type==='initialize'){const migration=migratePeopleBoards(doc);if(migration.changed)touch(migration.dex,this.runtime);return {value:migration.dex,changed:migration.changed};}
    checkRevision(selected,revision);if(command.type==='migrate-connections'){ensure(selected.peopleBoards,'보드 목록이 필요합니다.');let changed=false;for(const b of selected.peopleBoards.boards)changed=migrateConnections(b,selected.createdAt)||changed;if(changed)touch(selected,this.runtime);return {value:selected,changed};}
    const before=canonical(selected.peopleBoards);manageBoards(doc,selected,command);const changed=canonical(selected.peopleBoards)!==before;if(changed)touch(selected,this.runtime);return {value:selected,changed};
  }));}
  addBoardPhoto(ownerId:string,dexId:string,revision:number,photo:Pick<BoardPhoto,'id'|'assetId'|'caption'|'size'>,image:PreparedImage,boardId?:string){
    return resultOf(async()=>{
      await verifyPrepared(image);ensure(photo.assetId==='img-'+image.sha256,'사진 식별자와 해시가 다릅니다.');
      return this.transaction('readwrite',(raw,tx)=>{
        const doc=this.decode(raw);owner(doc,ownerId);const dex=find(doc.dexes,dexId);checkRevision(dex,revision);
        const record=dex.peopleBoards?selectedBoard(dex,boardId):null;
        const view=record?{...dex,peopleBoard:record.layout}:dex;
        const entries=record?doc.entries.filter(e=>record.layout.positions.some(p=>p.entryId===e.id)):doc.entries;
        const next=addBoardPhoto(view,entries,photo);const info:ImageInfo={id:photo.assetId,ownerId,mime:image.mime,bytes:image.bytes,width:image.width,height:image.height,sha256:image.sha256};
        const infos=tx.objectStore('photoAssetInfo'),all=infos.getAll();
        all.onsuccess=()=>{const rows=all.result as ImageInfo[];const old=rows.find(i=>i.id===info.id);if((old&&old.ownerId!==ownerId)||rows.reduce((n,i)=>n+(i.id===info.id?0:i.bytes),image.bytes)>MAX_PHOTO_TOTAL||rows.length+(old?0:1)>MAX_PHOTO_ASSETS)this.abort(tx,new DOMException('사진 저장 한도를 초과했습니다.','QuotaExceededError'));};
        tx.objectStore('photoAssets').put({id:info.id,blob:image.blob});infos.put(info);if(record){record.layout=next;tagPlacements(record);}else dex.peopleBoard=next;touch(dex,this.runtime);doc.profile.revision++;this.persist(tx,doc);
        return {value:dex,changed:true};
      });
    });
  }
  getPhotoAsset(ownerId:string,assetId:string){return resultOf(async()=>{
    const captured=await this.transaction('readonly',(raw,tx)=>{
      const doc=this.decode(raw);owner(doc,ownerId);ensure(photoReferences(doc).has(assetId),'이 기록에서 사용하는 사진이 아닙니다.','NOT_FOUND');
      const value={info:null as ImageInfo|null,blob:null as Blob|null},image=tx.objectStore('photoAssets').get(assetId),info=tx.objectStore('photoAssetInfo').get(assetId);let count=0;
      const loaded=()=>{if(++count!==2)return;if(!(image.result?.blob instanceof Blob)||!info.result||info.result.ownerId!==ownerId){this.abort(tx,new DexError('CORRUPT_STORAGE','사진 파일·소유 정보가 누락되었습니다.'));return;}value.info=info.result;value.blob=image.result.blob;};image.onsuccess=loaded;info.onsuccess=loaded;return {value};
    });
    ensure(captured.blob&&captured.info,'사진 파일이 누락되었습니다.','CORRUPT_STORAGE');await verifyPrepared({...captured.info,blob:captured.blob});return captured.blob;
  });}
  updatePeopleBoard(ownerId:string,dexId:string,revision:number,command:BoardCommand,boardId?:string){return resultOf(()=>this.document(true,doc=>{
    owner(doc,ownerId);const dex=find(doc.dexes,dexId);checkRevision(dex,revision);
    const record=dex.peopleBoards?selectedBoard(dex,boardId):null;
    const current=record?.layout??dex.peopleBoard;
    const view=record?{...dex,peopleBoard:record.layout}:dex;
    const entries=record?doc.entries.filter(e=>record.layout.positions.some(p=>p.entryId===e.id)):doc.entries;
    const next=applyBoardCommand(view,entries,command,record?.id);if(record){const tagged={...record,layout:next};tagPlacements(tagged);}
    if(canonical(next)===canonical(current??null))return {value:dex,changed:false};
    if(record)record.layout=next;else dex.peopleBoard=next;touch(dex,this.runtime);return {value:dex,changed:true};
  }));}
  deleteDex(ownerId: string, id: string, revision: number) {
    return resultOf(() => this.document(true, doc => {
      owner(doc,ownerId); checkRevision(find(doc.dexes,id),revision);
      doc.dexes = doc.dexes.filter(d => d.id !== id); doc.entries = doc.entries.filter(e => e.dexId !== id); doc.experiences = doc.experiences.filter(e => e.dexId !== id);
      return {value:undefined,changed:true};
    }));
  }
  collect(command: CollectCommand, image?:PreparedImage) {
    return resultOf(async () => {
      if(image){await verifyPrepared(image);ensure(command.subject.kind==='person'&&command.subject.profileAssetId==='img-'+image.sha256,'프로필 사진 참조가 다릅니다.');}
      const input = collectInput(command); // 복사·검증·WebCrypto는 transaction을 열기 전에 끝낸다.
      const hash = await fingerprint(input);
      // Stable request entropy: failed transactions/reloads cannot reroll the same request.
      // Local collection only; not a server-authoritative or paid lottery.
      const entropy=await fingerprint(['bokak-card-v1',input.ownerId,input.requestId]);
      const roll=parseInt(entropy.slice(-64,-56),16)/4294967296;
      return this.document(true,(doc,tx)=>{
        const applied=applyCollection(doc,input,hash,{...this.runtime,cardRoll:()=>roll});
        if(applied.changed&&image){ensure(applied.value.outcome==='new-entry','새 인연 사진은 최초 등록에서만 저장합니다.');this.putProfileImage(tx,input.ownerId,image);}
        const root=doc.dexes.find(d=>d.peopleBoards);
        if(applied.changed&&applied.value.outcome==='new-entry'&&applied.value.entry.subject.kind==='person'&&root){placePerson(doc,root,selectedBoard(root),applied.value.entry.id);touch(root,this.runtime);}
        return applied;
      });
    });
  }
  commitMealCollection(command: CollectMealCommand) { return collectMeal(command, this); }
  listEntries(ownerId: string, dexId: string) { return resultOf(() => this.document(false, doc => { owner(doc,ownerId); find(doc.dexes,dexId); return {value:doc.entries.filter(e=>e.dexId===dexId)}; })); }
  getEntry(ownerId: string, entryId: string) { return resultOf(() => this.document(false, doc => { owner(doc,ownerId); return {value:find(doc.entries,entryId)}; })); }
  updateEntry(ownerId: string, id: string, revision: number, patch: { subject?: EntrySubject; collectedOn?: LocalDate }, image?:PreparedImage) {
    return resultOf(async () => {if(image){await verifyPrepared(image);ensure(patch.subject?.kind==='person'&&patch.subject.profileAssetId==='img-'+image.sha256,'프로필 사진 참조가 다릅니다.');}
    return this.document(true, (doc,tx) => {
      owner(doc,ownerId); object(patch,['subject','collectedOn']); const entry=find(doc.entries,id); checkRevision(entry,revision);
      if (patch.subject) {
        ensure(entry.subject.kind === patch.subject.kind, '항목 종류를 변경할 수 없습니다.');
        if (entry.subject.kind==='meal' && patch.subject.kind==='meal') ensure(entry.subject.dishId===patch.subject.dishId,'메뉴 병합은 별도 이전 작업입니다.');
      }
      if(image)this.putProfileImage(tx,ownerId,image);
      Object.assign(entry,structuredClone(patch)); touch(entry,this.runtime); return {value:entry,changed:true};
    });});
  }
  deleteEntry(ownerId: string, id: string, revision: number) {
    return resultOf(() => this.document(true, doc => {
      owner(doc,ownerId); checkRevision(find(doc.entries,id),revision);
      doc.entries=doc.entries.filter(e=>e.id!==id); doc.experiences=doc.experiences.filter(e=>e.entryId!==id);
      this.removePlacements(doc,new Set([id]));
      return {value:undefined,changed:true};
    }));
  }
  listExperiences(ownerId: string, entryId: string) { return resultOf(() => this.document(false, doc => { owner(doc,ownerId); find(doc.entries,entryId); return {value:doc.experiences.filter(e=>e.entryId===entryId)}; })); }
  updateExperience(ownerId: string, id: string, revision: number, patch: { note?: string; experiencedOn?: LocalDate; rating?: Rating | null }) {
    return resultOf(() => this.document(true, doc => {
      owner(doc,ownerId); const exp=find(doc.experiences,id); checkRevision(exp,revision);
      object(patch,exp.kind==='meal'?['note','experiencedOn','rating']:['note','experiencedOn']);
      Object.assign(exp,structuredClone(patch)); touch(exp,this.runtime); return {value:exp,changed:true};
    }));
  }
  deleteExperience(ownerId: string, id: string, revision: number) {
    return resultOf(() => this.document(true, doc => { owner(doc,ownerId); checkRevision(find(doc.experiences,id),revision); doc.experiences=doc.experiences.filter(e=>e.id!==id); return {value:undefined,changed:true}; }));
  }
  exportRecords(ownerId:string){return resultOf(async()=>{
    const captured=await this.transaction('readonly',(raw,tx)=>{
      const data=this.decode(raw);owner(data,ownerId);const assets:PhotoAsset[]=[];
      for(const id of photoReferences(data)){const image=tx.objectStore('photoAssets').get(id),info=tx.objectStore('photoAssetInfo').get(id);
        let count=0;const loaded=()=>{if(++count!==2)return;if(!image.result?.blob||!info.result||info.result.ownerId!==ownerId){this.abort(tx,new DexError('CORRUPT_STORAGE','누락된 사진이 있어 완전한 백업을 만들 수 없습니다.'));return;}assets.push({info:info.result,blob:image.result.blob});};image.onsuccess=loaded;info.onsuccess=loaded;
      }
      return {value:{data,assets}};
    });
    const {data,assets}=captured;
    if(hasCharacterData(data)||data.dexes.some(d=>d.kind==='course'||d.peopleBoards||d.peopleBoard?.version===3)){for(const asset of assets)await verifyPrepared({...asset.info,blob:asset.blob});return packBackup(data,assets,this.runtime.now());}
    const envelope:BackupEnvelope={format:'bokak-dex',schemaVersion:data.dexes.some(d=>d.peopleBoard?.version===2)?4:data.dexes.some(d=>d.peopleBoard)?3:2,exportedAt:this.runtime.now(),containsSensitiveData:true,data};
    return new Blob([JSON.stringify(envelope,null,2)],{type:'application/json'});
  });}
  exportRecovery(){return resultOf(async()=>{
    const captured=await this.transaction('readonly',(raw,tx)=>{
      const value={raw,images:[] as {id:string;blob:Blob}[],infos:[] as ImageInfo[]};
      const images=tx.objectStore('photoAssets').getAll(),infos=tx.objectStore('photoAssetInfo').getAll();images.onsuccess=()=>{value.images=images.result;};infos.onsuccess=()=>{value.infos=infos.result;};return {value};
    });
    if(!captured.images.length)return new Blob([JSON.stringify({format:'bokak-dex-recovery',exportedAt:this.runtime.now(),containsSensitiveData:true,raw:captured.raw},null,2)],{type:'application/json'});
    const assets=[];for(const image of captured.images){ensure(image.blob instanceof Blob,'복구용 사진을 읽지 못했습니다.');assets.push({id:image.id,bytes:image.blob.size,sha256:await imageHash(image.blob)});}
    return packContainer({format:'bokak-dex-recovery',schemaVersion:5,exportedAt:this.runtime.now(),containsSensitiveData:true,raw:captured.raw,photoAssetInfo:captured.infos,assets},captured.images.map(i=>i.blob));
  });}
  previewImport(file:Blob){return resultOf(async()=>{
    ensure(file instanceof Blob&&file.size<=MAX_PACKAGE,'백업 용량 한도를 확인해 주세요.','INVALID_BACKUP');
    let document:DexDocument,assets:PhotoAsset[]=[];
    try{
      if(await isPhotoPackage(file)){const parsed=await unpackBackup(file);document=parsed.document;assets=parsed.assets;}
      else{ensure(file.size<=5*1024*1024,'JSON 백업은 5MB 이하여야 합니다.');const envelope=parseBackup(await file.text());ensure(envelope.schemaVersion<5,'v5는 사진 포함 .bokak 패키지를 선택하세요.');document=envelope.data;}
    }catch(error){if(error instanceof DexError&&error.code==='UNSUPPORTED_SCHEMA')throw error;throw new DexError('INVALID_BACKUP','백업 구조·사진 해시·용량·참조를 확인해 주세요. 기존 기록은 변경하지 않았습니다.');}
    ensure(document.profile.namespace===this.namespace,'개발 검증 기록과 개인 기록은 서로 가져올 수 없습니다.','INVALID_BACKUP');
    const raw=await this.transaction('readonly',value=>({value})),token=this.runtime.id();
    if(this.pending.size>=2)this.pending.delete(this.pending.keys().next().value!);
    this.pending.set(token,{document:structuredClone(document),expectedRaw:canonical(raw),assets});
    return {token,counts:{dexes:document.dexes.length,entries:document.entries.length,experiences:document.experiences.length,photos:document.dexes.reduce((n,d)=>n+allBoardLayouts(d).reduce((m,b)=>m+(b.photos?.length??0),0),0),photoBytes:assets.reduce((n,a)=>n+a.blob.size,0),boards:document.dexes.reduce((n,d)=>n+(d.peopleBoards?.boards.length??(d.peopleBoard?1:0)),0)},warnings:['사진·인연·개인 메모가 포함될 수 있는 암호화되지 않은 백업입니다.','확인하면 사진을 포함한 현재 기록 전체를 교체합니다. 먼저 내보내 주세요.']} satisfies ImportPreview;
  });}
  commitImport(input: { token: string; strategy: 'replace'; confirmed: true }) {
    return resultOf(async () => {
      object(input,['token','strategy','confirmed']);
      ensure(input.confirmed===true && input.strategy==='replace','전체 교체 확인이 필요합니다.','INVALID_INPUT');
      const pending=this.pending.get(input.token); ensure(pending,'가져오기 파일을 다시 검증해 주세요.','IMPORT_CONFLICT');
      const value=await this.transaction('readwrite',(raw,tx)=>{
        ensure(canonical(raw)===pending.expectedRaw,'미리보기 이후 기록이 변경되었습니다. 다시 검증해 주세요.','IMPORT_CONFLICT');
        const doc=structuredClone(pending.document);
        const existing=(raw.meta[0] as {revision?:unknown}|undefined)?.revision;
        doc.profile.revision=Math.max(doc.profile.revision,Number.isSafeInteger(existing)?existing as number:0)+1;
        tx.objectStore('photoAssets').clear();tx.objectStore('photoAssetInfo').clear();
        for(const asset of pending.assets){tx.objectStore('photoAssets').put({id:asset.info.id,blob:asset.blob});tx.objectStore('photoAssetInfo').put(asset.info);}
        this.persist(tx,doc);
        return {value:{ownerId:doc.profile.ownerId},changed:true};
      });
      this.pending.clear(); return value;
    });
  }
}
