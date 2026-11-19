import type { CollectionEntry, DexDocument, DexRepository, Result } from '../core/types.ts';

import type { CourseReview } from './review.ts';

export const TERMS = { spring: '1학기', fall: '2학기', summer: '여름 계절학기', winter: '겨울 계절학기' } as const;
export const STATUSES = { planned: '수강 예정', active: '수강 중', completed: '수강 완료' } as const;
export const CATEGORIES = { major: '전공', general: '교양', other: '기타' } as const;

export interface CourseSubject {
  kind: 'course';
  title: string;
  year: number;
  term: keyof typeof TERMS;
  status: keyof typeof STATUSES;
  professor?: string;
  credits?: number;
  category?: keyof typeof CATEGORIES;
  code?: string;
  memo?: string;
  review?: CourseReview;
}
export type CourseEntry = CollectionEntry & { subject: CourseSubject };

export function courseEntries(document: DexDocument) {
  return document.entries.filter((entry): entry is CourseEntry => entry.subject.kind === 'course');
}

export function similarEnrollment(a: CourseSubject, b: CourseSubject) {
  const key = (value?: string) => (value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  return a.year === b.year && a.term === b.term &&
    key(a.title) === key(b.title) && key(a.professor) === key(b.professor) && key(a.code) === key(b.code);
}

export async function saveCourse(repository: DexRepository, document: DexDocument, subject: CourseSubject, requestId: string, recordedOn: string, entry?: CourseEntry): Promise<Result<CollectionEntry>> {
  const { ownerId } = document.profile;
  if (entry) return repository.updateEntry(ownerId, entry.id, entry.revision, { subject });
  let dex = document.dexes.find(d => d.kind === 'course');
  if (!dex) {
    const created = await repository.createDex(ownerId, { kind: 'course', name: '강의도감', icon: 'book' });
    if (!created.ok) return created;
    dex = created.value;
  }
  // This date records when the course was added, independently of its academic term.
  const result = await repository.collect({ ownerId, dexId: dex.id, requestId, subject, experience: { kind: 'course', experiencedOn: recordedOn } });
  return result.ok ? { ok: true, value: result.value.entry } : result;
}
