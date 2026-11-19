import type { DexDocument } from '../core/types.ts';
import type { CourseSubject } from '../course/course.ts';
import { hasCourseReview } from '../course/progress.ts';
import { allBoardLayouts } from '../people/multi-board.ts';
import { mealPersonalCards } from '../meal/game.ts';
import { unknownMealRarity } from '../meal/rarity.ts';
import type { RarityAssessment } from '../meal/rarity.ts';
import type { MealExperience } from '../meal/collection.ts';
import type { PersonEntry } from '../people/view.ts';

/** Acquisition grades (docs/dex/GAME_SYSTEM.md "획득 등급과 EXP"). EXP is always derived from current records. */
export const EXP_GRADES = [
  { id: 'common', label: '일반', exp: 10 },
  { id: 'uncommon', label: '고급', exp: 20 },
  { id: 'rare', label: '희귀', exp: 50 },
  { id: 'epic', label: '영웅', exp: 100 },
  { id: 'legendary', label: '전설', exp: 300 },
] as const;
export type ExpGrade = typeof EXP_GRADES[number];
const [COMMON, UNCOMMON, RARE, EPIC, LEGENDARY] = EXP_GRADES;
type Records = Pick<DexDocument, 'dexes' | 'experiences'>;

/** Meals use 일반/희귀/전설 only: the higher of confirmed serving rarity and taste repeated on different days. */
export function mealGrade(dishId: string, experiences: readonly MealExperience[], rarity: RarityAssessment = unknownMealRarity(dishId)): ExpGrade {
  const days = (minRating: number) => new Set(experiences.filter(e => (e.rating ?? 0) >= minRating).map(e => e.experiencedOn)).size;
  const tier = rarity.confirmed && rarity.policyVersion ? rarity.tier : 'UNKNOWN';
  if (tier === 'LEGENDARY' || days(5) >= 3) return LEGENDARY;
  if (tier === 'RARE' || days(4) >= 2) return RARE;
  return COMMON;
}

// shortcut: only the /grade-unlinked fallback (max 희귀); activity EXP, achievement axis and prediction lock wait for the linkedGradeCourseId migration (GAME_SYSTEM.md 3-E).
export function courseGrade(subject: CourseSubject): ExpGrade {
  if (subject.status === 'planned') return COMMON;
  return subject.status === 'completed' && hasCourseReview(subject) ? RARE : UNCOMMON;
}

/** At least 10 non-whitespace characters, so one-letter dummy text does not count. */
const meaningful = (text?: string) => (text?.replace(/\s/g, '').length ?? 0) >= 10;

/** People whose card has a person-to-person thread on any board. */
function connectedPeople(records: Records) {
  const ids = new Set<string>();
  for (const dex of records.dexes) {
    if (dex.kind !== 'people') continue;
    for (const board of allBoardLayouts(dex)) {
      for (const edge of board.edges) if (edge.a !== edge.b) ids.add(edge.a).add(edge.b);
      const byPlacement = new Map(board.positions.map(p => [p.placementId, p.entryId]));
      for (const { from, to } of board.connections ?? []) {
        const a = from.type === 'person' ? byPlacement.get(from.objectId) : undefined;
        const b = to.type === 'person' ? byPlacement.get(to.objectId) : undefined;
        if (a && b && a !== b) ids.add(a).add(b);
      }
    }
  }
  return ids;
}

/** Record depth, never the person's worth. Age, gender and real photos are not grade conditions. */
export function personGrade(entry: PersonEntry, records: Records, connected = connectedPeople(records).has(entry.id)): ExpGrade {
  const s = entry.subject;
  const details = [s.relationship?.trim(), s.department?.trim(), s.admissionYear, s.mbti, s.energyType, meaningful(s.trait)].filter(Boolean).length;
  const image = !!s.profileAssetId || (!!s.avatar && s.avatar !== 'classic');
  if (details < 2 && !image) return COMMON;
  const notes = records.experiences.filter(e => e.entryId === entry.id && e.kind === 'person' && meaningful(e.note));
  if (!notes.length) return UNCOMMON;
  const memoryDays = new Set(notes.filter(e => e.kind === 'person' && e.event === 'memory').map(e => e.experiencedOn)).size;
  if (memoryDays >= 5 && connected) return LEGENDARY;
  if (memoryDays >= 3 || (memoryDays >= 2 && connected)) return EPIC;
  return RARE;
}

/** Sum of grade EXP over owned menus, people and courses; deletions and edits re-derive it. */
export function totalExp(document: DexDocument): number {
  const owner = document.profile.ownerId;
  const connected = connectedPeople(document);
  let sum = 0;
  for (const card of mealPersonalCards(document)) sum += mealGrade(card.dishId, card.experiences).exp; // once per dishId
  for (const entry of document.entries) {
    if (entry.ownerId !== owner) continue;
    const s = entry.subject;
    if (s.kind === 'course') sum += courseGrade(s).exp;
    else if (s.kind === 'person') sum += personGrade(entry as PersonEntry, document, connected.has(entry.id)).exp;
  }
  return sum;
}
