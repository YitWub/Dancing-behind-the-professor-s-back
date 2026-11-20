import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { courseGrade, documentLevel, LEVEL_TABLE, levelFromExp, MAX_LEVEL, mealGrade, personGrade, personGradeRises, totalExp } from '../exp.ts';
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
const details = { relationship: '동아리', department: '컴퓨터학부' };

const days = (n: number, note = NOTE) => Array.from({ length: n }, (_, i) => memory(i + 1, note));
const linkedTo = (...others: string[]) => ({ kind: 'people', peopleBoard: { version: 1, positions: [], edges: others.map((b, i) => ({ id: 'e' + i, a: 'p1', b })) } });

test('person card evolves from memory days (+2, max 10) and unique board links (+1, max 3), never profile data', () => {
  const grade = (experiences: object[], dexes: object[] = []) => personGrade(person(details), records(experiences, dexes)).label;
  assert.equal(personGrade(person({ ...details, age: 22, gender: 'female', avatar: 'reader', admissionYear: 2021 }), records([firstMet(NOTE)])).label, '일반', 'profile fields, avatar, admission year and the first-met note never count');
  assert.equal(grade(days(1)), '고급', '2 points');
  assert.equal(grade([memory(1), memory(1), memory(2, 'ㅇ ㅇ')]), '고급', 'same-day memories once, dummy notes ignored');
  assert.equal(grade(days(2)), '희귀', '4 points');
  assert.equal(grade(days(3)), '희귀', '6 points');
  assert.equal(grade(days(3), [linkedTo('p2')]), '영웅', '6 + 1');
  assert.equal(grade(days(4)), '영웅', '8 points');
  assert.equal(grade(days(5)), '전설', 'memories alone reach 10');
  assert.equal(grade(days(4), [linkedTo('p2', 'p3')]), '전설', '8 + 2 (doc example)');
  assert.equal(grade(days(7)), '전설', 'memory points cap at 10');
  assert.equal(grade([], [linkedTo('p2', 'p3', 'p4', 'p5')]), '고급', 'link points cap at 3');
  assert.equal(grade(days(5, 'x')), '일반', 'dummy memories do not count');
});

test('board links count unique person-to-person threads across boards', () => {
  const placements = [{ entryId: 'p1', placementId: 'pl1' }, { entryId: 'p2', placementId: 'pl2' }];
  const layout = (to: object) => ({ layout: { version: 4, positions: placements, edges: [], connections: [{ from: { type: 'person', objectId: 'pl1' }, to }] } });
  const boards = (...tos: object[]) => ({ kind: 'people', peopleBoards: { boards: tos.map(layout) } });
  const toP2 = { type: 'person', objectId: 'pl2' };
  assert.equal(personGrade(person({}), records(days(3), [boards(toP2)])).label, '영웅', '6 + 1');
  assert.equal(personGrade(person({}), records(days(3), [boards({ type: 'note', objectId: 'n1' })])).label, '희귀', 'note threads do not count');
  assert.equal(personGrade(person({}), records(days(3), [linkedTo('p1')])).label, '희귀', 'self links do not count');
  assert.equal(personGrade(person({}), records(days(1), [boards(toP2, toP2), linkedTo('p2')])).label, '고급', 'the same person on two boards and a legacy edge counts once (2 + 1)');
});

test('card evolution lists only people whose grade rose', () => {
  const doc = (experiences: object[], extra: object[] = []) => ({ profile: { ownerId: 'me' }, dexes: [], experiences, entries: [person({}), person({}, 'p2'), ...extra] }) as unknown as DexDocument;
  const before = doc(days(1));
  assert.deepEqual(personGradeRises(before, doc(days(1))), [], 'no grade change');
  assert.deepEqual(personGradeRises(before, doc(days(2))).map(r => [r.entry.id, r.from.label, r.to.label, r.to.exp - r.from.exp]), [['p1', '고급', '희귀', 30]]);
  assert.deepEqual(personGradeRises(doc(days(2)), before), [], 'a drop never plays');
  assert.deepEqual(personGradeRises(before, doc([...days(1), memory(1, NOTE, 'p3')], [person({}, 'p3')])), [], 'a new person is a discovery, not an evolution');
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
  // one dish across two entries counts once; two 5-star days make it 희귀. A first-met note alone leaves the person 일반.
  assert.equal(totalExp(doc), 50 + 10 + 10);
  assert.equal(totalExp({ ...doc, experiences: [] }), 10 + 10 + 10, 'deleting records lowers EXP');
});

test('level table is contiguous, strictly increasing, and ends at Lv.30 (15,000 EXP)', () => {
  assert.equal(LEVEL_TABLE.length, 30);
  assert.equal(MAX_LEVEL, 30);
  assert.equal(LEVEL_TABLE[LEVEL_TABLE.length - 1].minExp, 15000);
  assert.equal(LEVEL_TABLE[0].level, 1);
  assert.equal(LEVEL_TABLE[0].minExp, 0);
  let prevDelta = 0;
  for (let i = 1; i < LEVEL_TABLE.length; i++) {
    assert.equal(LEVEL_TABLE[i].level, i + 1);
    const delta = LEVEL_TABLE[i].minExp - LEVEL_TABLE[i - 1].minExp;
    assert.ok(delta > 0, `level ${i + 1} minExp must increase`);
    assert.ok(delta >= prevDelta, `level ${i + 1} delta (${delta}) must be >= previous delta (${prevDelta})`);
    prevDelta = delta;
  }
});

test('levelFromExp handles boundaries, invalid inputs, and max-level overflow', () => {
  assert.deepEqual(levelFromExp(0), {
    level: 1, title: '새내기', exp: 0,
    expIntoLevel: 0, expForNextLevel: 30, expToNextLevel: 30, isMaxLevel: false,
  });
  assert.equal(levelFromExp(-50).level, 1);
  assert.equal(levelFromExp(Number.NaN).level, 1);

  const justBeforeLv2 = levelFromExp(29);
  assert.equal(justBeforeLv2.level, 1);
  assert.equal(justBeforeLv2.expToNextLevel, 1);

  const exactLv2 = levelFromExp(30);
  assert.equal(exactLv2.level, 2);
  assert.equal(exactLv2.expIntoLevel, 0);
  assert.equal(exactLv2.expForNextLevel, 50);

  const lv10 = levelFromExp(1500);
  assert.equal(lv10.level, 10);
  assert.equal(lv10.title, '캠퍼스 탐험가');

  const justBeforeMax = levelFromExp(14999);
  assert.equal(justBeforeMax.level, 29);
  assert.equal(justBeforeMax.title, '살아있는 화석');
  assert.equal(justBeforeMax.expToNextLevel, 1);
  assert.equal(justBeforeMax.isMaxLevel, false);

  const maxExact = levelFromExp(15000);
  assert.deepEqual(maxExact, {
    level: 30, title: '캠퍼스 전설', exp: 15000,
    expIntoLevel: 0, expForNextLevel: 0, expToNextLevel: 0, isMaxLevel: true,
  });

  const overflow = levelFromExp(18250);
  assert.equal(overflow.level, 30);
  assert.equal(overflow.exp, 18250);
  assert.equal(overflow.expIntoLevel, 3250);
  assert.equal(overflow.isMaxLevel, true);
});

test('documentLevel derives level from owned records and updates when records are deleted', () => {
  const mealExp = (id: string, entryId: string, day: number) => ({ id, entryId, ownerId: 'me', dexId: 'meals', kind: 'meal', rating: 5, experiencedOn: `2026-10-0${day}`, createdAt: '', note: '', context: { cafeteria: 'haksik' } });
  const doc = {
    profile: { ownerId: 'me' }, dexes: [{ id: 'meals', kind: 'meal', ownerId: 'me' }],
    experiences: [firstMet(NOTE), mealExp('x1', 'm', 1), mealExp('x2', 'm', 2)],
    entries: [
      { id: 'm', ownerId: 'me', dexId: 'meals', firstCollectedAt: '1', subject: { kind: 'meal', dishId: 'rice' } },
      person(details),
    ],
  } as unknown as DexDocument;
  // 50 (meal 희귀) + 10 (person 일반: first-met only) = 60 EXP -> Lv.2 (30..79)
  assert.equal(documentLevel(doc).level, 2);
  assert.equal(documentLevel(doc).expToNextLevel, 20);
  // Deleting experiences drops EXP to 10 + 10 = 20 -> Lv.1
  assert.equal(documentLevel({ ...doc, experiences: [] }).level, 1);
});
