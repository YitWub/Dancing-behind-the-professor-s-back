import { DexError, ensure, resultOf } from '../core/errors.ts';
import { applyCollection, initialDocument, owner, find, version, touch, checkRevision, collectMeal } from '../core/engine.ts';
import { canonical, collectInput, fingerprint, validateDocument, parseBackup, object } from '../core/validation.ts';
import type { Runtime } from '../core/engine.ts';
import type { BackupEnvelope, CollectCommand, CollectMealCommand, Dex, DexDocument, DexRepository, EntrySubject, ImportPreview, LocalDate, Namespace, Rating } from '../core/types.ts';

export const DATABASE_NAME = 'bokak.dex';
export const DATABASE_VERSION = 1;
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
interface PendingImport { document: DexDocument; expectedRaw: string }

/** await는 transaction 밖에서만 사용한다. 내부 작업은 IDB request callback에서 동기적으로 큐잉한다. */
export class IndexedDbDexRepository implements DexRepository {
  private db: IDBDatabase | null = null;
  private connecting: Promise<IDBDatabase> | null = null;
  private pending = new Map<string, PendingImport>();
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
      request.onupgradeneeded = () => {
        const db = request.result;
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
      };
      request.onblocked = () => { finished = true; reject(new DexError('STORAGE_BLOCKED', '다른 탭이 저장소를 사용 중입니다. 해당 탭을 닫거나 새로고침해 주세요.')); };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        if (finished) { db.close(); return; }
        if (!STORES.every(name => db.objectStoreNames.contains(name))) {
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
      const tx = db.transaction([...STORES], mode);
      const raw = {} as RawState;
      let waiting = STORES.length;
      let response: { value: T; changed?: boolean };
      let failure: unknown;
      tx.onabort = () => reject(failure ?? tx.error ?? new Error('Transaction aborted'));
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
  private decode(raw: RawState): DexDocument {
    try {
      ensure(raw.meta.length === 1, '프로필이 없거나 중복되었습니다.');
      const entries = raw.entries.map(row => {
        const copy = { ...(row as Record<string, unknown>) }; delete copy.mealUniqueKey; return copy;
      });
      const doc = { profile: raw.meta[0], dexes: raw.dexes, entries, experiences: raw.experiences, receipts: raw.requestReceipts };
      validateDocument(doc);
      ensure(doc.profile.namespace === this.namespace, '저장소 용도가 다릅니다.');
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
    this.options.beforeCommit?.();
  }
  private document<T>(write: boolean, operation: (doc: DexDocument) => { value: T; changed?: boolean }, initialize = false): Promise<T> {
    return this.transaction(write ? 'readwrite' : 'readonly', (raw, tx) => {
      const empty = STORES.every(name => raw[name].length === 0);
      const bootstrap = initialize && empty;
      const doc = bootstrap ? initialDocument(this.runtime, this.namespace) : this.decode(raw);
      const response = operation(doc);
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
  deleteDex(ownerId: string, id: string, revision: number) {
    return resultOf(() => this.document(true, doc => {
      owner(doc,ownerId); checkRevision(find(doc.dexes,id),revision);
      doc.dexes = doc.dexes.filter(d => d.id !== id); doc.entries = doc.entries.filter(e => e.dexId !== id); doc.experiences = doc.experiences.filter(e => e.dexId !== id);
      return {value:undefined,changed:true};
    }));
  }
  collect(command: CollectCommand) {
    return resultOf(async () => {
      const input = collectInput(command); // 복사·검증·WebCrypto는 transaction을 열기 전에 끝낸다.
      const hash = await fingerprint(input);
      return this.document(true, doc => applyCollection(doc,input,hash,this.runtime));
    });
  }
  commitMealCollection(command: CollectMealCommand) { return collectMeal(command, this); }
  listEntries(ownerId: string, dexId: string) { return resultOf(() => this.document(false, doc => { owner(doc,ownerId); find(doc.dexes,dexId); return {value:doc.entries.filter(e=>e.dexId===dexId)}; })); }
  getEntry(ownerId: string, entryId: string) { return resultOf(() => this.document(false, doc => { owner(doc,ownerId); return {value:find(doc.entries,entryId)}; })); }
  updateEntry(ownerId: string, id: string, revision: number, patch: { subject?: EntrySubject; collectedOn?: LocalDate }) {
    return resultOf(() => this.document(true, doc => {
      owner(doc,ownerId); object(patch,['subject','collectedOn']); const entry=find(doc.entries,id); checkRevision(entry,revision);
      if (patch.subject) {
        ensure(entry.subject.kind === patch.subject.kind, '항목 종류를 변경할 수 없습니다.');
        if (entry.subject.kind==='meal' && patch.subject.kind==='meal') ensure(entry.subject.dishId===patch.subject.dishId,'메뉴 병합은 별도 이전 작업입니다.');
      }
      Object.assign(entry,structuredClone(patch)); touch(entry,this.runtime); return {value:entry,changed:true};
    }));
  }
  deleteEntry(ownerId: string, id: string, revision: number) {
    return resultOf(() => this.document(true, doc => {
      owner(doc,ownerId); checkRevision(find(doc.entries,id),revision);
      doc.entries=doc.entries.filter(e=>e.id!==id); doc.experiences=doc.experiences.filter(e=>e.entryId!==id);
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
  exportRecords(ownerId: string) {
    return resultOf(async () => {
      const data=await this.document(false,doc=>{owner(doc,ownerId);return {value:doc};});
      const envelope: BackupEnvelope = { format:'bokak-dex', schemaVersion:1, exportedAt:this.runtime.now(), containsSensitiveData:true, data };
      return new Blob([JSON.stringify(envelope,null,2)],{type:'application/json'});
    });
  }
  exportRecovery() {
    return resultOf(async () => {
      const raw=await this.transaction('readonly',state=>({value:state}));
      return new Blob([JSON.stringify({format:'bokak-dex-recovery', exportedAt:this.runtime.now(), containsSensitiveData:true, raw},null,2)],{type:'application/json'});
    });
  }
  previewImport(file: Blob) {
    return resultOf(async () => {
      ensure(file instanceof Blob && file.size <= 5*1024*1024, '5MB 이하의 JSON 백업을 선택해 주세요.', 'INVALID_BACKUP');
      const envelope=parseBackup(await file.text());
      ensure(envelope.data.profile.namespace===this.namespace,'개발 검증 기록과 개인 기록은 서로 가져올 수 없습니다.','INVALID_BACKUP');
      const raw=await this.transaction('readonly',value=>({value}));
      const token=this.runtime.id();
      if(this.pending.size>=10)this.pending.delete(this.pending.keys().next().value!);
      this.pending.set(token,{document:structuredClone(envelope.data),expectedRaw:canonical(raw)});
      return {token,counts:{dexes:envelope.data.dexes.length,entries:envelope.data.entries.length,experiences:envelope.data.experiences.length},
        warnings:['개인 메모·인연 정보가 포함될 수 있는 평문 파일입니다.','확인하면 현재 기록 전체를 교체합니다. 먼저 내보내기로 보존해 주세요.']} satisfies ImportPreview;
    });
  }
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
        this.persist(tx,doc);
        return {value:{ownerId:doc.profile.ownerId},changed:true};
      });
      this.pending.clear(); return value;
    });
  }
}
