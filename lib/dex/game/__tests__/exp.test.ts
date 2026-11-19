import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { courseGrade, mealGrade, personGrade, totalExp } from '../exp.ts';
import type { DexDocument } from '../../core/types.ts';
import type { PersonEntry } from '../../people/view.ts';
import type { CourseSubject } from '../../course/course.ts';
import type { MealExperience } from '../../meal/collection.ts';
import type { RarityAssessment } from '../../meal/rarity.ts';

const NOTE = '도서관에서 같이 공부한 날'; // 10+ non-space characters
const person = (subject: object, id = 'p1') => ({ id, ownerId: 'me', dexId: 'people', subject: { kind: 'person', displayName: '친구', ...subject } }) as unknown as PersonEntry;
const memory = (day: number, note = NOTE, entryId = 'p1') => ({ entryId, kind: 'person', event: 'memory', experiencedOn: `2026-10-${String(day).padStart(2, '0')}`, note });
const firstMet = (note: string) => ({ entryId: 'p1', kind: 'person', event: 'first-met', experiencedOn: '2026-09-01', note });
const records = (experiences: object[], dexes: object[] = []) => ({ dexes, experiences }) as unknown as DexDocument;
const thread = { kind: 'people', peopleBoard: { version: 1, positions: [], edges: [{ id: 'e', a: 'p1', b: 'p2' }] } };
const details = { relationship: '동아리', department: '컴퓨터학부' };

test('person grade follows record depth, not personal data', () => {
  assert.equal(personGrade(person({}), records([])).label, '일반');
  assert.equal(personGrade(person({ age: 22, gender: 'female', relationship: '동아리' }), records([])).label, '일반', 'sensitive fields never raise the grade');
  assert.equal(personGrade(person({ relationship: '동아리', trait: '짧음' }), records([])).label, '일반', 'trait under 10 chars does not count');
  assert.equal(personGrade(person(details), records([])).label, '고급');
  assert.equal(personGrade(person({ avatar: 'reader' }), records([])).label, '고급');
  assert.equal(personGrade(person({ avatar: 'classic' }), records([])).label, '일반');
  assert.equal(personGrade(person(details), records([firstMet('ㅇ ㅇ')])).label, '고급', 'dummy first-met note');
  assert.equal(personGrade(person(details), records([firstMet(NOTE)])).label, '희귀');
  assert.equal(personGrade(person(details), records([memory(1), memory(1), memory(2)])).label, '희귀', 'same-day memories count once');
  assert.equal(personGrade(person(details), records([memory(1), memory(2), memory(3)])).label, '영웅');
  assert.equal(personGrade(person(details), records([memory(1), memory(2)], [thread])).label, '영웅');
  assert.equal(personGrade(person(details), records([1, 2, 3, 4, 5].map(d => memory(d)))).label, '영웅', 'legendary needs a thread');
  assert.equal(personGrade(person(details), records([1, 2, 3, 4, 5].map(d => memory(d)), [thread])).label, '전설');
  assert.equal(personGrade(person(details), records([1, 2, 3, 4, 5].map(d => memory(d, 'x')), [thread])).label, '고급', 'dummy memories do not count');
});

test('v4 board connections count only person-to-person threads', () => {
  const placements = [{ entryId: 'p1', placementId: 'pl1' }, { entryId: 'p2', placementId: 'pl2' }];
  const board = (to: object) => ({ kind: 'people', peopleBoards: { boards: [{ layout: { version: 4, positions: placements, edges: [], connections: [{ from: { type: 'person', objectId: 'pl1' }, to }] } }] } });
  const five = [1, 2, 3, 4, 5].map(d => memory(d));
  assert.equal(personGrade(person(details), records(five, [board({ type: 'person', objectId: 'pl2' })])).label, '전설');
  assert.equal(personGrade(person(details), records(five, [board({ type: 'note', objectId: 'n1' })])).label, '영웅');
});

test('meal grade is 일반/희귀/전설 from repeated taste or confirmed rarity', () => {
  const meal = (day: number, rating: number | null) => ({ kind: 'meal', rating, experiencedOn: `2026-10-0${day}` }) as unknown as MealExperience;
  const grade = (rows: MealExperience[], tier?: string) => mealGrade('d', rows, tier ? { dishId: 'd', tier, confirmed: true, policyVersion: 'v' } as RarityAssessment : undefined).label;
  assert.equal(grade([]), '일반');
  assert.equal(grade([meal(1, 5)]), '일반', 'one high rating is not enough');
  assert.equal(grade([meal(1, 4), meal(1, 5)]), '일반', 'same day counts once');
  assert.equal(grade([meal(1, 4), meal(2, 5)]), '희귀');
  assert.equal(grade([meal(1, 5), meal(2, 5), meal(3, 4)]), '희귀');
  assert.equal(grade([meal(1, 5), meal(2, 5), meal(3, 5)]), '전설');
  assert.equal(grade([], 'RARE'), '희귀');
  assert.equal(grade([], 'LEGENDARY'), '전설');
  assert.equal(grade([], 'UNCOMMON'), '일반', 'meals have no 고급');
  assert.equal(mealGrade('d', [], { dishId: 'd', tier: 'LEGENDARY', confirmed: false, policyVersion: null } as RarityAssessment).label, '일반', 'unconfirmed rarity is ignored');
});

test('course fallback grade', () => {
  const course = (status: string, review?: object) => ({ kind: 'course', title: 'x', year: 2026, term: 'fall', status, review }) as CourseSubject;
  assert.equal(courseGrade(course('planned')).label, '일반');
  assert.equal(courseGrade(course('active', { shortReview: '좋아요' })).label, '고급');
  assert.equal(courseGrade(course('completed')).label, '고급');
  assert.equal(courseGrade(course('completed', { shortReview: '  ' })).label, '고급');
  assert.equal(courseGrade(course('completed', { difficulty: 3 })).label, '희귀');
});

test('total EXP is derived from owned menus, people and courses', () => {
  const mealExp = (id: string, entryId: string, day: number) => ({ id, entryId, ownerId: 'me', dexId: 'meals', kind: 'meal', rating: 5, experiencedOn: `2026-10-0${day}`, createdAt: '', note: '', context: { cafeteria: 'haksik' } });
  const doc = {
    profile: { ownerId: 'me' }, dexes: [{ id: 'meals', kind: 'meal', ownerId: 'me' }],
    experiences: [firstMet(NOTE), mealExp('x1', 'm', 1), mealExp('x2', 'm2', 2)],
    entries: [
      { id: 'm', ownerId: 'me', dexId: 'meals', firstCollectedAt: '1', subject: { kind: 'meal', dishId: 'rice' } },
      { id: 'm2', ownerId: 'me', dexId: 'meals', firstCollectedAt: '2', subject: { kind: 'meal', dishId: 'rice' } },
      person(details),
      { id: 'c', ownerId: 'me', subject: { kind: 'course', status: 'planned' } },
      { id: 'x', ownerId: 'me', subject: { kind: 'custom' } },
      { id: 'o', ownerId: 'other', subject: { kind: 'meal' } },
    ],
  } as unknown as DexDocument;
  // one dish across two entries counts once; two 5-star days make it 희귀
  assert.equal(totalExp(doc), 50 + 50 + 10);
  assert.equal(totalExp({ ...doc, experiences: [] }), 10 + 20 + 10, 'deleting records lowers EXP');
});
