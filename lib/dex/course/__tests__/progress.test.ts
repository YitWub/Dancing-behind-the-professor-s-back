import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { CollectionEntry, EntrySubject } from '../../core/types.ts';
import type { CourseSubject } from '../course.ts';
import { completionRate, courseProgress } from '../progress.ts';

function row(id: string, subject: EntrySubject): CollectionEntry {
  const instant = '2026-11-19T00:00:00.000Z';
  return { id, subject, dexId: 'dex', ownerId: 'owner', revision: 1, createdAt: instant,
    updatedAt: instant, firstCollectedAt: instant, collectedOn: '2026-11-19' };
}

const course: CourseSubject = { kind: 'course', title: '시스템', year: 2026, term: 'fall', status: 'completed' };

test('statistics count each enrollment once, distinguish retakes, and include all statuses in the rate', () => {
  const rows = [
    row('1', { ...course, review: { teamProject: false } }),
    row('2', { ...course, review: { tags: [], shortReview: '   ' } }),
    row('3', course),
    row('4', { ...course, status: 'active' }),
    row('5', { ...course, year: 2025 }),
    row('6', { ...course, year: 2027, term: 'winter', status: 'planned' }),
    row('person', { kind: 'person', displayName: '친구' }),
    row('other', { kind: 'custom', title: '기록' }),
  ];
  const original = structuredClone(rows);
  const progress = courseProgress([...rows, rows[0]]);
  assert.deepEqual(progress.overall, { total: 6, planned: 1, active: 1, completed: 4, reviewed: 1 });
  assert.equal(completionRate(progress.overall).toFixed(1), '66.7');
  assert.deepEqual(progress.semesters.map(s => [s.year, s.term, s.counts.total, completionRate(s.counts)]), [
    [2027, 'winter', 1, 0], [2026, 'fall', 4, 75], [2025, 'fall', 1, 100],
  ]);
  assert.deepEqual(progress.achievements.map(a => a.achieved), [true, true, true, true, true]);
  assert.deepEqual(rows, original);
});

test('zero records and subsequent edits, review resets, and deletions recalculate achievement progress', () => {
  const empty = courseProgress([]);
  assert.equal(completionRate(empty.overall), 0);
  assert.deepEqual(empty.semesters, []);
  assert.deepEqual(empty.achievements.map(a => [a.progress, a.achieved]), Array.from({ length: 5 }, () => [0, false]));
  const changed = courseProgress([
    row('1', { ...course, review: undefined, status: 'active' }),
    row('2', course),
    row('3', { ...course, term: 'spring' }),
  ]);
  assert.deepEqual(changed.achievements.map(a => [a.progress, a.target, a.achieved]), [
    [1, 1, true], [1, 1, true], [0, 1, false], [3, 5, false], [1, 3, false],
  ]);
});
