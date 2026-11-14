import { ensure } from './errors.ts';
import { canonical, kindFor, collectInput } from './validation.ts';
import type { CollectCommand, CollectMealCommand, CollectResult, CollectionEntry, Dex, DexDocument, DexRepository, Experience, Namespace, Versioned } from './types.ts';
import { resultOf } from './errors.ts';

export interface Runtime { id: () => string; now: () => string }
export function version(runtime: Runtime): Versioned {
  const now = runtime.now();
  return { id: runtime.id(), revision: 1, createdAt: now, updatedAt: now };
}
export function initialDocument(runtime: Runtime, namespace: Namespace): DexDocument {
  const ownerId = runtime.id();
  const make = (kind: 'meal' | 'people', name: string, icon: string): Dex => ({
    ...version(runtime), ownerId, kind, name, icon, visibility: 'private', progress: { mode: 'count-only' },
  });
  return {
    profile: { id: 'local-profile', ownerId, scope: 'local-browser', namespace, schemaVersion: 1, revision: 0, createdAt: runtime.now() },
    dexes: [make('meal', '학식도감', 'meal'), make('people', '인연도감', 'people')],
    entries: [], experiences: [], receipts: [],
  };
}
export function owner(doc: DexDocument, ownerId: string) {
  ensure(doc.profile.ownerId === ownerId, '다른 로컬 프로필의 기록입니다.', 'OWNER_MISMATCH');
}
export function find<T extends { id: string }>(rows: T[], id: string): T {
  const item = rows.find(row => row.id === id);
  ensure(item, '기록을 찾을 수 없습니다.', 'NOT_FOUND'); return item;
}
export function checkRevision(item: Versioned, expected: number) {
  ensure(item.revision === expected, '다른 탭 또는 화면에서 변경되었습니다. 다시 불러와 주세요.', 'REVISION_CONFLICT');
}
export function touch(item: Versioned, runtime: Runtime) { item.revision++; item.updatedAt = runtime.now(); }

/** 동기 순수 유스케이스. 실제 저장 성공은 어댑터의 transaction complete에서 확정된다. */
export function applyCollection(doc: DexDocument, input: CollectCommand, hash: string, runtime: Runtime): { value: CollectResult; changed: boolean } {
  owner(doc, input.ownerId);
  const receiptId = canonical([input.ownerId, input.requestId]);
  const receipt = doc.receipts.find(r => r.id === receiptId);
  if (receipt) {
    ensure(receipt.payloadFingerprint === hash, '같은 requestId로 다른 내용을 저장할 수 없습니다.', 'REQUEST_ID_CONFLICT');
    const entry = doc.entries.find(v => v.id === receipt.entryId);
    const experience = doc.experiences.find(v => v.id === receipt.experienceId);
    ensure(entry && experience, '이 요청의 기록은 삭제되었습니다. 재방문은 새 요청으로 등록해 주세요.', 'RESULT_DELETED');
    return { changed: false, value: {
      entry, experience, outcome: receipt.originalEntryWasCreated ? 'new-entry' : 'revisit',
      replayed: true, committedAt: receipt.committedAt, discovery: null,
    } };
  }
  const dex = find(doc.dexes, input.dexId);
  ensure(dex.kind === kindFor(input.subject), '도감과 항목의 종류가 다릅니다.');
  const selected = input.entryId ? find(doc.entries, input.entryId) : undefined;
  if (selected) {
    ensure(selected.dexId === dex.id, '다른 도감의 카드를 참조했습니다.');
    ensure(selected.subject.kind === input.subject.kind, '항목 종류를 바꿀 수 없습니다.');
    if (selected.subject.kind === 'meal' && input.subject.kind === 'meal') ensure(selected.subject.dishId === input.subject.dishId, '메뉴 식별자가 다릅니다.');
    else ensure(canonical(selected.subject) === canonical(input.subject), '카드를 다시 조회한 후 기록해 주세요.', 'REVISION_CONFLICT');
  }
  const matching = input.subject.kind === 'meal'
    ? doc.entries.find(e => e.dexId === dex.id && e.subject.kind === 'meal' && input.subject.kind === 'meal' && e.subject.dishId === input.subject.dishId)
    : undefined;
  let entry = selected ?? matching;
  const created = !entry;
  if (!entry) {
    entry = { ...version(runtime), ownerId: input.ownerId, dexId: dex.id, subject: structuredClone(input.subject),
      firstCollectedAt: runtime.now(), collectedOn: input.experience.experiencedOn } satisfies CollectionEntry;
    doc.entries.push(entry);
  }
  const experience = { ...version(runtime), ...structuredClone(input.experience), note: input.experience.note ?? '',
    ownerId: input.ownerId, dexId: dex.id, entryId: entry.id, requestId: input.requestId } as Experience;
  doc.experiences.push(experience);
  const committedAt = runtime.now();
  doc.receipts.push({
    id: receiptId, ownerId: input.ownerId, requestId: input.requestId, dexId: dex.id,
    operation: 'collect', payloadFingerprint: hash, entryId: entry.id, experienceId: experience.id,
    originalEntryWasCreated: created, committedAt,
  });
  return { changed: true, value: { entry, experience, outcome: created ? 'new-entry' : 'revisit', replayed: false, committedAt,
    discovery: created ? { key: input.requestId, title: '새로운 발견을 기록했습니다!', entryId: entry.id } : null } };
}

export function collect(command: CollectCommand, repository: DexRepository) { return repository.collect(command); }
/** B의 resolved Offering을 공통 저장 요청으로 연결하는 포트. 공급 데이터 조회는 하지 않는다. */
export async function collectMeal(command: CollectMealCommand, repository: DexRepository) {
  const prepared = await resultOf(async () => {
    const { selection } = command;
    ensure(selection?.offering?.resolution?.state === 'resolved', '메뉴 식별을 먼저 완료해 주세요.', 'UNRESOLVED_MENU');
    const offering = selection.offering;
    ensure(offering.resolution.state === 'resolved' && selection.dishId === offering.resolution.dishId, '메뉴 식별자가 다릅니다.');
    ensure(['live','cache'].includes(offering.provenance.mode), '예시 메뉴는 개인 기록에 수집하지 않습니다.', 'DEMO_DATA');
    return collectInput({ ownerId: command.ownerId, dexId: command.dexId, requestId: command.requestId,
      subject: { kind: 'meal', dishId: selection.dishId, displayNameSnapshot: selection.dishName },
      experience: { kind: 'meal', experiencedOn: command.experiencedOn, rating: command.rating, note: command.note,
        offeringId: offering.id, context: { date: offering.date, cafeteria: offering.cafeteria, mealTime: offering.mealTime,
          legacyMealItemId: offering.legacyMealItemId, snapshot: offering.snapshot, source: offering.provenance.source } },
    });
  });
  return prepared.ok ? repository.collect(prepared.value) : prepared;
}
