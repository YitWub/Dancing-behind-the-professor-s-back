import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { assessmentWeight, confirmedScore } from '../grade-record.ts';
import type { CourseGradeRecord } from '../grade-record.ts';
import { imageHash, inspectImage } from '../../people/photo.ts';
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

async function seedOtherDexes(repo: IndexedDbDexRepository, ownerId: string) {
  const initial = value(await repo.snapshot());
  const blob = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jPz0AAAAASUVORK5CYII=', 'base64')], { type: 'image/png' });
  const image = { blob, bytes: blob.size, ...inspectImage(new Uint8Array(await blob.arrayBuffer())), sha256: await imageHash(blob) };
  const assetId = 'img-' + image.sha256;
  value(await repo.collect({
    ownerId, dexId: initial.dexes.find(dex => dex.kind === 'people')!.id, requestId: 'mixed-person',
    subject: { kind: 'person', displayName: '친구', profileAssetId: assetId },
    experience: { kind: 'person', event: 'first-met', experiencedOn: date },
  }, image));
  value(await repo.collect({
    ownerId, dexId: initial.dexes.find(dex => dex.kind === 'meal')!.id, requestId: 'mixed-meal',
    subject: { kind: 'meal', dishId: 'mixed-dish', displayNameSnapshot: '제육볶음' },
    experience: { kind: 'meal', experiencedOn: date, rating: null, offeringId: 'mixed-offering',
      context: { date, cafeteria: 'haksik', mealTime: 'lunch', legacyMealItemId: 'mixed-menu',
        source: 'https://example.test/menu', snapshot: { name: '제육볶음', menu: ['밥'], price: null, kcal: null, imageUrl: null, imageSourceUrl: null },
      },
    },
  }));
  return { assetId, image };
}

test('reviews are optional, isolated by entry, validated, and survive v12 export and reopening', async () => {
  const factory = new IDBFactory();
  let fail = false;
  const repo = new IndexedDbDexRepository({ factory, beforeCommit: () => { if (fail) throw Error('Test abort'); } });
  const reopened = new IndexedDbDexRepository({ factory });
  const target = new IndexedDbDexRepository({ factory: new IDBFactory() });
  try {
    const { ownerId } = value(await repo.open());
    const { assetId, image } = await seedOtherDexes(repo, ownerId);
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
    assert.equal(snapshot.entries.length, before.entries.length + 2);
    assert.equal(snapshot.experiences.length, before.experiences.length + 2);
    assert.equal(snapshot.receipts.length, before.receipts.length + 2);
    assert.deepEqual(snapshot.entries.find(e => e.id === b.id)?.subject, current);

    const backup = value(await repo.exportRecords(ownerId));
    assert.equal(await backup.slice(0, 9).text(), 'BOKAKP12\n');
    const envelope = { format: 'bokak-dex', schemaVersion: 11, exportedAt: '2026-11-19T00:00:00.000Z', containsSensitiveData: true, data: snapshot, assets: [] };
    value(await target.open());
    assert.equal((await target.previewImport(packContainer(envelope, [], 11))).ok, false);
    const preview = value(await target.previewImport(backup));
    value(await target.commitImport({ token: preview.token, strategy: 'replace', confirmed: true }));
    const copied = value(await target.snapshot());
    assert.deepEqual(copied.entries, snapshot.entries);
    assert.deepEqual(copied.experiences, snapshot.experiences);
    assert.equal(await imageHash(value(await target.getPhotoAsset(ownerId, assetId))), image.sha256);

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

const gradeRecord: CourseGradeRecord = {
  method: 'relative',
  assessments: [
    { id: 'midterm', name: '시험', weightPercent: 30.25, maxScore: 50.5, result: { status: 'graded', score: 0 } },
    { id: 'final', name: '시험', weightPercent: 39.75, maxScore: 100, result: { status: 'pending' } },
    { id: 'quiz', name: '퀴즈', weightPercent: 10, maxScore: 20, result: { status: 'missed' } },
    { id: 'project', name: '프로젝트', weightPercent: 10, maxScore: 20, result: { status: 'planned' } },
  ],
};

test('validates partial weights, actual scores, explicit zero, and assessment identity', () => {
  validateSubject({ ...past, gradeRecord });
  assert.equal(assessmentWeight(gradeRecord.assessments), 90);
  assert.deepEqual(gradeRecord.assessments.map(item => confirmedScore(item.result)), [0, undefined, 0, undefined]);
  const [first, ...rest] = gradeRecord.assessments;
  for (const patch of [
    { weightPercent: 41 }, { weightPercent: -1 }, { weightPercent: 1.001 }, { weightPercent: NaN },
    { maxScore: 0 }, { maxScore: Infinity }, { result: { status: 'graded', score: 51 } },
    { result: { status: 'graded' } }, { result: { status: 'pending', score: 0 } }, { id: 'quiz' },
  ]) {
    assert.throws(() => validateSubject({ ...past, gradeRecord: { ...gradeRecord, assessments: [{ ...first, ...patch }, ...rest] } }));
  }
  const complete = [{ ...first, weightPercent: 40.25 }, ...rest];
  validateSubject({ ...past, gradeRecord: { ...gradeRecord, assessments: complete } });
  assert.equal(assessmentWeight(complete), 100);
});

test('grade edits preserve review and memo, reject stale revisions, and round-trip through v13', async () => {
  const factory = new IDBFactory();
  let fail = false;
  const repo = new IndexedDbDexRepository({ factory, beforeCommit: () => { if (fail) throw Error('Test abort'); } });
  const reopened = new IndexedDbDexRepository({ factory });
  const target = new IndexedDbDexRepository({ factory: new IDBFactory() });
  try {
    const { ownerId } = value(await repo.open());
    const { assetId, image } = await seedOtherDexes(repo, ownerId);
    const base = value(await repo.snapshot());
    const subject: CourseSubject = { ...past, memo: '개인 메모', review: { difficulty: 2 } };
    const a = value(await saveCourse(repo, base, subject, 'grade-a', date));
    const b = value(await saveCourse(repo, base, current, 'grade-b', date));
    const recorded = value(await repo.updateEntry(ownerId, a.id, a.revision, { subject: { ...subject, gradeRecord } }));
    assert.equal((await repo.updateEntry(ownerId, a.id, a.revision, { subject })).ok, false);
    fail = true;
    assert.equal((await repo.updateEntry(ownerId, a.id, recorded.revision, { subject })).ok, false);
    fail = false;
    const { review, ...info } = subject;
    const changed = value(await saveCourse(repo, base, { ...info, title: '개명', professor: '교수', term: 'winter', status: 'active' }, 'edit', date, recorded as ReturnType<typeof courseEntries>[number]));
    assert.deepEqual((changed.subject as CourseSubject).review, review);
    assert.deepEqual((changed.subject as CourseSubject).gradeRecord, gradeRecord);
    const editedGrade = { ...gradeRecord, assessments: [
      { ...gradeRecord.assessments[0], result: { status: 'graded' as const, score: 42.25 } },
      ...gradeRecord.assessments.slice(1, 3),
      { id: 'new', name: '발표', weightPercent: 5, maxScore: 10, result: { status: 'planned' as const } },
    ] };
    const reviewed = value(await repo.updateEntry(ownerId, a.id, changed.revision, { subject: { ...changed.subject as CourseSubject, review: { difficulty: 3 } } }));
    value(await repo.updateEntry(ownerId, a.id, reviewed.revision, { subject: { ...reviewed.subject as CourseSubject, gradeRecord: editedGrade } }));
    const data = value(await repo.snapshot());
    assert.equal(data.experiences.length, base.experiences.length + 2);
    assert.equal(data.receipts.length, base.receipts.length + 2);
    assert.deepEqual(data.entries.find(entry => entry.id === b.id), b);
    const backup = value(await repo.exportRecords(ownerId));
    assert.equal(await backup.slice(0, 9).text(), 'BOKAKP13\n');
    value(await target.open());
    const envelope = { format: 'bokak-dex', schemaVersion: 13, exportedAt: '2026-11-19T00:00:00.000Z', containsSensitiveData: true, data, assets: [] };
    const invalid = structuredClone(envelope);
    (invalid.data.entries.find(entry => entry.id === a.id)!.subject as CourseSubject).gradeRecord!.assessments[0].maxScore = 0;
    assert.equal((await target.previewImport(packContainer(invalid, [], 13))).ok, false);
    assert.equal((await target.previewImport(packContainer({ ...envelope, schemaVersion: 12 }, [], 12))).ok, false);
    const preview = value(await target.previewImport(backup));
    value(await target.commitImport({ token: preview.token, strategy: 'replace', confirmed: true }));
    const restoredData = value(await target.snapshot());
    assert.deepEqual(restoredData.entries, data.entries);
    assert.deepEqual(restoredData.experiences, data.experiences);
    assert.equal(await imageHash(value(await target.getPhotoAsset(ownerId, assetId))), image.sha256);
    repo.close();
    value(await reopened.open());
    const restored = courseEntries(value(await reopened.snapshot())).find(entry => entry.id === a.id)!;
    assert.deepEqual(restored.subject.gradeRecord, editedGrade);
    assert.deepEqual(restored.subject.review, { difficulty: 3 });
    assert.equal(restored.subject.memo, '개인 메모');
    const cleared = { ...restored.subject };
    delete cleared.gradeRecord;
    const saved = value(await reopened.updateEntry(ownerId, restored.id, restored.revision, { subject: cleared }));
    assert.equal(courseEntries(value(await reopened.snapshot())).length, 2);
    value(await reopened.deleteEntry(ownerId, saved.id, saved.revision));
    assert.deepEqual(courseEntries(value(await reopened.snapshot())).map(entry => entry.id), [b.id]);
  } finally {
    target.close();
    reopened.close();
    repo.close();
  }
});

test('relative statistics restore atomically in v14 with original assessments, other dexes and photo bytes', async () => {
  let fail = false;
  const repo = new IndexedDbDexRepository({ factory: new IDBFactory() });
  const target = new IndexedDbDexRepository({ factory: new IDBFactory(), beforeCommit: () => { if (fail) throw Error('Test abort'); } });
  try {
    const { ownerId } = value(await repo.open());
    const { assetId, image } = await seedOtherDexes(repo, ownerId);
    const snapshot = async () => value(await repo.snapshot());
    const original = await snapshot();
    const entry = value(await saveCourse(repo, original, { ...past, gradeRecord, review: { difficulty: 2 }, memo: '메모' }, 'relative-a', date));
    const retake = value(await saveCourse(repo, original, { ...current, gradeRecord }, 'relative-b', date));
    const oldBackup = value(await repo.exportRecords(ownerId));
    const subject = entry.subject as CourseSubject;
    const withStats: CourseGradeRecord = {
      ...gradeRecord, relative: { enrollment: 40, overallRank: { rank: 12, scope: '중간 이후' }, policy: { source: 'assumed', aCap: 30 } },
      assessments: gradeRecord.assessments.map((item, index) => index === 0
        ? { ...item, statistics: { mean: 24, standardDeviation: 6, publishedRank: { rank: 20, cohortSize: 40 } } } : item),
    };
    const saved = value(await repo.updateEntry(ownerId, entry.id, entry.revision, { subject: { ...subject, gradeRecord: withStats } }));
    const edited: CourseGradeRecord = {
      ...withStats, assessments: withStats.assessments.slice(0, 1).map(item => ({
        ...item, name: '변경한 시험명', result: { status: 'graded', score: 25 },
      })),
    };
    const modified = value(await repo.updateEntry(ownerId, saved.id, saved.revision, { subject: { ...subject, gradeRecord: edited } }));
    const preserved = value(await saveCourse(repo, original, { ...subject, title: '새 이름' }, 'rename', date, modified as ReturnType<typeof courseEntries>[number]));
    assert.deepEqual((preserved.subject as CourseSubject).gradeRecord, edited);
    const doc = await snapshot();
    assert.deepEqual(doc.entries.find(item => item.id === retake.id), retake);
    assert.equal(doc.experiences.length, original.experiences.length + 2);
    const backup = value(await repo.exportRecords(ownerId));
    assert.equal(await backup.slice(0, 9).text(), 'BOKAKP14\n');
    value(await target.open());
    const old = value(await target.previewImport(oldBackup));
    value(await target.commitImport({ token: old.token, strategy: 'replace', confirmed: true }));
    const before = value(await target.snapshot());
    const malformed = structuredClone(doc);
    const invalid = courseEntries(malformed).find(item => item.id === entry.id)!;
    invalid.subject.gradeRecord!.assessments[0].statistics!.mean = 1000;
    const bad = packContainer({ format: 'bokak-dex', schemaVersion: 14, exportedAt: '2026-11-19T00:00:00.000Z', containsSensitiveData: true, data: malformed, assets: [] }, [], 14);
    assert.equal((await target.previewImport(bad)).ok, false);
    const downgraded = packContainer({ format: 'bokak-dex', schemaVersion: 13, exportedAt: '2026-11-19T00:00:00.000Z', containsSensitiveData: true, data: doc, assets: [] }, [], 13);
    assert.equal((await target.previewImport(downgraded)).ok, false);
    const preview = value(await target.previewImport(backup));
    fail = true;
    assert.equal((await target.commitImport({ token: preview.token, strategy: 'replace', confirmed: true })).ok, false);
    assert.deepEqual(value(await target.snapshot()), before);
    fail = false;
    const retry = value(await target.previewImport(backup));
    value(await target.commitImport({ token: retry.token, strategy: 'replace', confirmed: true }));
    const restored = value(await target.snapshot());
    assert.deepEqual(restored.entries, doc.entries);
    assert.deepEqual(restored.experiences, doc.experiences);
    assert.equal(await imageHash(value(await target.getPhotoAsset(ownerId, assetId))), image.sha256);
  } finally {
    target.close();
    repo.close();
  }
});
