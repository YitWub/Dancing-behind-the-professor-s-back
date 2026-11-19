import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbDexRepository } from '../../storage/indexeddb.ts';
import { packContainer, unpackBackup } from '../../storage/photo-package.ts';
import { subject as validateSubject } from '../../core/validation.ts';
import type { Result } from '../../core/types.ts';
import { courseEntries, saveCourse, similarEnrollment } from '../course.ts';
import type { CourseSubject } from '../course.ts';

function value<T>(result: Result<T>): T {
  if (!result.ok) throw Error(result.error.message);
  return result.value;
}

const date = '2026-11-19';
const past: CourseSubject = { kind: 'course', title: '수치해석', year: 2024, term: 'spring', status: 'completed' };
const current: CourseSubject = { ...past, year: 2026, term: 'fall', status: 'active', credits: 3 };

test('validates enrollment fields and flags only similar records in the same term', () => {
  validateSubject(past);
  validateSubject({ ...past, term: 'winter', status: 'planned' });
  for (const patch of [{ title: ' ' }, { year: 2024.5 }, { term: 'unknown' }, { status: 'unknown' }, { credits: -1 }, { category: 'unknown' }])
    assert.throws(() => validateSubject({ ...past, ...patch }));
  assert.equal(similarEnrollment(past, current), false);
  assert.equal(similarEnrollment(past, { ...past, title: ' 수치해석 ' }), true);
  assert.equal(similarEnrollment(past, { ...past, code: '02' }), false);
});

test('CRUD survives reopening, retries are idempotent, and v11 restores without dropping other records', async () => {
  const factory = new IDBFactory();
  let fail = false;
  const repo = new IndexedDbDexRepository({ factory, beforeCommit: () => { if (fail) throw Error('Test abort'); } });
  const restored = new IndexedDbDexRepository({ factory: new IDBFactory() });
  const reopened = new IndexedDbDexRepository({ factory });
  try {
    const { ownerId } = value(await repo.open());
    const snapshot = async () => value(await repo.snapshot());
    const personDex = (await snapshot()).dexes.find(dex => dex.kind === 'people')!;
    const person = value(await repo.collect({
      ownerId, dexId: personDex.id, requestId: 'person', subject: { kind: 'person', displayName: '친구', age: 22 },
      experience: { kind: 'person', event: 'first-met', experiencedOn: date },
    }));
    const old = value(await repo.exportRecords(ownerId));
    const baseline = await snapshot();
    value(await saveCourse(repo, baseline, past, 'past', date));
    value(await saveCourse(repo, baseline, current, 'current', date));
    value(await saveCourse(repo, baseline, current, 'current', date));
    const courses = courseEntries(await snapshot());
    assert.equal(courses.length, 2);
    assert.notEqual(courses[0].id, courses[1].id);
    assert.equal((await snapshot()).dexes.filter(dex => dex.kind === 'course').length, 1);

    const active = courses.find(entry => entry.subject.status === 'active')!;
    const before = await snapshot();
    fail = true;
    assert.equal((await saveCourse(repo, before, { ...current, status: 'completed' }, 'update', date, active)).ok, false);
    assert.deepEqual(await snapshot(), before);
    fail = false;
    value(await saveCourse(repo, before, { ...current, status: 'completed', memo: '다시 듣고 싶은 강의' }, 'update', date, active));

    const backup = value(await repo.exportRecords(ownerId));
    assert.equal(await backup.slice(0, 9).text(), 'BOKAKP11\n');
    const { document } = await unpackBackup(backup);
    const mislabeled = packContainer({
      format: 'bokak-dex', schemaVersion: 10, exportedAt: '2026-11-19T00:00:00.000Z',
      containsSensitiveData: true, data: document, assets: [],
    }, [], 10);
    value(await restored.open());
    assert.equal((await restored.previewImport(mislabeled)).ok, false);
    for (const file of [old, backup]) {
      const preview = value(await restored.previewImport(file));
      value(await restored.commitImport({ token: preview.token, strategy: 'replace', confirmed: true }));
    }
    const restoredDoc = value(await restored.snapshot());
    assert.deepEqual({ ...restoredDoc, profile: document.profile }, document);
    assert.equal(restoredDoc.profile.ownerId, ownerId);

    const original = courses.find(entry => entry.subject.year === 2024)!;
    value(await repo.deleteEntry(ownerId, original.id, original.revision));
    repo.close();
    value(await reopened.open());
    const after = value(await reopened.snapshot());
    assert.deepEqual(courseEntries(after).map(entry => [entry.id, entry.subject.status]), [[active.id, 'completed']]);
    assert.deepEqual(after.entries.find(entry => entry.id === person.entry.id), person.entry);
    assert.deepEqual(after.experiences.find(exp => exp.id === person.experience.id), person.experience);
    assert.deepEqual(after.dexes.find(dex => dex.kind === 'meal'), baseline.dexes.find(dex => dex.kind === 'meal'));
  } finally {
    reopened.close();
    restored.close();
    repo.close();
  }
});

test('reviews are optional, isolated by entry, validated, and survive v12 export and reopening', async () => {
  const factory = new IDBFactory();
  let fail = false;
  const repo = new IndexedDbDexRepository({ factory, beforeCommit: () => { if (fail) throw Error('Test abort'); } });
  const reopened = new IndexedDbDexRepository({ factory });
  const target = new IndexedDbDexRepository({ factory: new IDBFactory() });
  try {
    const { ownerId } = value(await repo.open());
    const before = value(await repo.snapshot());
    const a = value(await saveCourse(repo, before, past, 'review-a', date));
    const b = value(await saveCourse(repo, before, current, 'review-b', date));
    assert.deepEqual(a.subject, past);
    const review = { shortReview: '실습이 재밌었음', difficulty: 4, workload: 'heavy', teamProject: false, tags: ['실습 중심', '과제 많음'] } as const;
    const reviewed = { ...past, review: { ...review, tags: [...review.tags] } };
    for (const invalid of [{ difficulty: 0 }, { teamProject: 'no' }, { tags: ['실습 중심', '실습 중심'] }, { shortReview: 'x'.repeat(301) }]) {
      assert.throws(() => validateSubject({ ...past, review: invalid }));
    }
    fail = true;
    assert.equal((await repo.updateEntry(ownerId, a.id, a.revision, { subject: reviewed })).ok, false);
    assert.equal((value(await repo.snapshot()).entries.find(e => e.id === a.id)?.subject as CourseSubject).review, undefined);
    fail = false;
    const saved = value(await repo.updateEntry(ownerId, a.id, a.revision, { subject: reviewed }));
    const updated = value(await repo.updateEntry(ownerId, a.id, saved.revision, {
      subject: { ...reviewed, professor: 'Kim', term: 'summer', review: { ...reviewed.review, difficulty: 3 } },
    }));
    const snapshot = value(await repo.snapshot());
    assert.equal(snapshot.entries.length, 2);
    assert.equal(snapshot.experiences.length, 2);
    assert.equal(snapshot.receipts.length, 2);
    assert.deepEqual(snapshot.entries.find(e => e.id === b.id)?.subject, current);

    const backup = value(await repo.exportRecords(ownerId));
    assert.equal(await backup.slice(0, 9).text(), 'BOKAKP12\n');
    const envelope = { format: 'bokak-dex', schemaVersion: 11, exportedAt: '2026-11-19T00:00:00.000Z', containsSensitiveData: true, data: snapshot, assets: [] };
    value(await target.open());
    assert.equal((await target.previewImport(packContainer(envelope, [], 11))).ok, false);
    const preview = value(await target.previewImport(backup));
    value(await target.commitImport({ token: preview.token, strategy: 'replace', confirmed: true }));
    assert.deepEqual(value(await target.snapshot()).entries, snapshot.entries);

    repo.close();
    value(await reopened.open());
    assert.deepEqual(value(await reopened.snapshot()).entries, snapshot.entries);
    const cleared = { ...(updated.subject as CourseSubject) };
    delete cleared.review;
    value(await reopened.updateEntry(ownerId, updated.id, updated.revision, { subject: cleared }));
    assert.equal(courseEntries(value(await reopened.snapshot())).find(e => e.id === a.id)?.subject.review, undefined);
    assert.equal(await value(await reopened.exportRecords(ownerId)).slice(0, 9).text(), 'BOKAKP11\n');
  } finally {
    target.close();
    reopened.close();
    repo.close();
  }
});
