import type { Cafeteria, MealTime, MealSnapshot, MealOffering } from '../meal/types.ts';
export type { Dish, DishAlias, MealOffering } from '../meal/types.ts';
export type Id = string;
export type LocalDate = string;
export type Instant = string;
export type DexKind = 'meal' | 'people' | 'custom';
export type Rating = 1 | 2 | 3 | 4 | 5;
export type Namespace = 'personal' | 'development';
export interface Versioned {
  id: Id;
  revision: number;
  createdAt: Instant;
  updatedAt: Instant;
}
export interface Dex extends Versioned {
  ownerId: Id;
  kind: DexKind;
  name: string;
  icon: string;
  visibility: 'private';
  progress: { mode: 'count-only' } | { mode: 'bounded'; targetSetId: Id; targetSetVersion: number };
}
export type EntrySubject =
  | { kind: 'meal'; dishId: Id; displayNameSnapshot: string }
  | { kind: 'person'; displayName: string; admissionYear?: number; department?: string; relationship?: string; memo?: string }
  | { kind: 'custom'; title: string; memo?: string };
export interface CollectionEntry extends Versioned {
  ownerId: Id;
  dexId: Id;
  subject: EntrySubject;
  firstCollectedAt: Instant;
  collectedOn: LocalDate;
}
export type ExperienceData =
  | { kind: 'meal'; rating: Rating | null; offeringId: Id; context: {
      date: LocalDate; cafeteria: Cafeteria; mealTime: MealTime;
      legacyMealItemId: string; snapshot: MealSnapshot; source: string;
    } }
  | { kind: 'person'; event: 'first-met' | 'memory' }
  | { kind: 'custom' };
export type Experience = Versioned & ExperienceData & {
  ownerId: Id; dexId: Id; entryId: Id; requestId: Id;
  experiencedOn: LocalDate; note: string;
};
export type ExperienceDraft = ExperienceData & { experiencedOn: LocalDate; note?: string };
export interface CollectCommand {
  ownerId: Id; dexId: Id; requestId: Id;
  subject: EntrySubject;
  /** 인연/자유 재방문은 명시적인 카드 ID를 전달한다. 이름으로 합치지 않는다. */
  entryId?: Id;
  experience: ExperienceDraft;
}
export interface ResolvedMealSelection {
  dishId: Id;
  dishName: string;
  offering: MealOffering & { resolution: Extract<MealOffering['resolution'], { state: 'resolved' }> };
}
export interface CollectMealCommand {
  ownerId: Id; dexId: Id; requestId: Id;
  selection: ResolvedMealSelection;
  experiencedOn: LocalDate; rating: Rating | null; note: string;
}
export interface CollectionRequestReceipt {
  id: string;
  ownerId: Id; requestId: Id; dexId: Id;
  operation: 'collect'; payloadFingerprint: string;
  entryId: Id; experienceId: Id;
  originalEntryWasCreated: boolean;
  committedAt: Instant;
}
export interface LocalProfile {
  id: 'local-profile';
  /** 브라우저 내부의 분리 키이며 서버 인증 정보가 아니다. */
  ownerId: Id;
  scope: 'local-browser';
  namespace: Namespace;
  schemaVersion: 1;
  revision: number;
  createdAt: Instant;
}
export interface DexDocument {
  profile: LocalProfile;
  dexes: Dex[];
  entries: CollectionEntry[];
  experiences: Experience[];
  receipts: CollectionRequestReceipt[];
}
export interface CollectResult {
  entry: CollectionEntry;
  experience: Experience;
  outcome: 'new-entry' | 'revisit';
  replayed: boolean;
  committedAt: Instant;
  discovery: { key: Id; title: string; entryId: Id } | null;
}
export type CollectMealResult = CollectResult;
export interface DiscoveryPresenter {
  present(event: NonNullable<CollectResult['discovery']>, options: { reducedMotion: boolean }): Promise<void>;
}
export type DexErrorCode =
  | 'INVALID_INPUT' | 'NOT_FOUND' | 'OWNER_MISMATCH' | 'REVISION_CONFLICT'
  | 'REQUEST_ID_CONFLICT' | 'RESULT_DELETED' | 'UNRESOLVED_MENU' | 'DEMO_DATA'
  | 'STORAGE_UNAVAILABLE' | 'STORAGE_BLOCKED' | 'QUOTA_EXCEEDED' | 'CORRUPT_STORAGE'
  | 'UNSUPPORTED_SCHEMA' | 'INVALID_BACKUP' | 'IMPORT_CONFLICT';
export type Result<T> = { ok: true; value: T } | { ok: false; error: { code: DexErrorCode; message: string } };
export interface BackupEnvelope {
  format: 'bokak-dex'; schemaVersion: 1; exportedAt: Instant;
  containsSensitiveData: true;
  data: DexDocument;
}
export interface ImportPreview {
  token: Id;
  counts: { dexes: number; entries: number; experiences: number };
  warnings: string[];
}
export interface DexRepository {
  open(): Promise<Result<{ ownerId: Id; schemaVersion: 1 }>>;
  snapshot(): Promise<Result<DexDocument>>;
  listDexes(ownerId: Id): Promise<Result<Dex[]>>;
  createDex(ownerId: Id, draft: { kind: DexKind; name: string; icon: string }): Promise<Result<Dex>>;
  updateDex(ownerId: Id, id: Id, revision: number, patch: { name?: string; icon?: string }): Promise<Result<Dex>>;
  deleteDex(ownerId: Id, id: Id, revision: number): Promise<Result<void>>;
  collect(command: CollectCommand): Promise<Result<CollectResult>>;
  commitMealCollection(command: CollectMealCommand): Promise<Result<CollectMealResult>>;
  listEntries(ownerId: Id, dexId: Id): Promise<Result<CollectionEntry[]>>;
  getEntry(ownerId: Id, entryId: Id): Promise<Result<CollectionEntry>>;
  updateEntry(ownerId: Id, id: Id, revision: number, patch: { subject?: EntrySubject; collectedOn?: LocalDate }): Promise<Result<CollectionEntry>>;
  deleteEntry(ownerId: Id, id: Id, revision: number): Promise<Result<void>>;
  listExperiences(ownerId: Id, entryId: Id): Promise<Result<Experience[]>>;
  updateExperience(ownerId: Id, id: Id, revision: number, patch: { note?: string; experiencedOn?: LocalDate; rating?: Rating | null }): Promise<Result<Experience>>;
  deleteExperience(ownerId: Id, id: Id, revision: number): Promise<Result<void>>;
  exportRecords(ownerId: Id): Promise<Result<Blob>>;
  exportRecovery(): Promise<Result<Blob>>;
  previewImport(file: Blob): Promise<Result<ImportPreview>>;
  commitImport(input: { token: Id; strategy: 'replace'; confirmed: true }): Promise<Result<{ ownerId: Id }>>;
  close(): void;
}
