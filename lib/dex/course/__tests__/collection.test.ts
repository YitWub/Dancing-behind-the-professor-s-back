import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DEFAULT_FILTERS, selectCourses } from '../collection.ts';
import type { CourseEntry, CourseSubject } from '../course.ts';

function record(id: string, subject: Partial<CourseSubject>, day = '01'): CourseEntry {
  const instant = '2026-11-' + day + 'T00:00:00.000Z';
  return {
    id, ownerId: 'owner', dexId: 'course', revision: 1, createdAt: instant,
    updatedAt: instant, firstCollectedAt: instant, collectedOn: instant.slice(0, 10),
    subject: { kind: 'course', title: '시스템', year: 2026, term: 'fall', status: 'active', ...subject },
  };
}

const rows = [
  record('spring', { term: 'spring', status: 'completed' }),
  record('old', { year: 2025, status: 'completed', title: '가나다' }, '05'),
  record('fall', { professor: 'Kim', code: 'CS101', category: 'major' }),
  record('summer', { term: 'summer', status: 'completed' }),
  record('winter', { term: 'winter', status: 'planned' }),
  record('fall-02', { professor: 'Lee', code: 'CS102', category: 'general' }),
];

test('orders all four terms and preserves individual enrollment IDs', () => {
  const before = structuredClone(rows);
  const ids = (sort: typeof DEFAULT_FILTERS.sort) => selectCourses(rows, { ...DEFAULT_FILTERS, sort }).map(row => row.id);
  assert.deepEqual(ids('newest'), ['winter', 'fall', 'fall-02', 'summer', 'spring', 'old']);
  assert.deepEqual(ids('oldest'), ['old', 'spring', 'summer', 'fall', 'fall-02', 'winter']);
  assert.equal(ids('title')[0], 'old');
  assert.equal(ids('registered')[0], 'old');
  assert.deepEqual(rows, before);
});

test('combines term, year, status and category with local partial search', () => {
  const filters = { ...DEFAULT_FILTERS, year: '2026', term: 'fall', status: 'active', category: 'major' } as const;
  for (const query of [' 시스템 ', ' kIM ', ' cs10 ']) {
    assert.deepEqual(selectCourses(rows, { ...filters, query }).map(row => row.id), ['fall']);
  }
  assert.deepEqual(selectCourses(rows, { ...filters, query: 'Lee' }), []);
  assert.deepEqual(selectCourses(rows, { ...filters, year: '2025' }), []);
  assert.deepEqual(selectCourses(rows, { ...DEFAULT_FILTERS, status: 'planned' }).map(row => row.id), ['winter']);
});
