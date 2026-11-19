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
