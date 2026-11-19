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

/** GAME_SYSTEM.md 2-D local fallback: record depth, never the person's worth. Age, gender and real photos are not grade conditions. */
// shortcut: 2-A~2-C (other user's connections·level·achievements·admission year, 12-point snapshot) need shared profiles; switch when accounts/profile sharing and the EntrySubject snapshot migration land.
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

export interface LevelTier {
  readonly level: number;
  readonly minExp: number;
  readonly title: string;
}

/** Lv.1~Lv.30 progression table (docs/dex/GAME_SYSTEM.md "레벨 시스템"). Max level is 15,000 EXP. */
export const LEVEL_TABLE: readonly LevelTier[] = [
  { level: 1, minExp: 0, title: '새내기' },
  { level: 2, minExp: 30, title: '새내기' },
  { level: 3, minExp: 80, title: '새내기' },
  { level: 4, minExp: 150, title: '새내기' },
  { level: 5, minExp: 250, title: '새내기' },
  { level: 6, minExp: 400, title: '캠퍼스 탐험가' },
  { level: 7, minExp: 600, title: '캠퍼스 탐험가' },
  { level: 8, minExp: 850, title: '캠퍼스 탐험가' },
  { level: 9, minExp: 1150, title: '캠퍼스 탐험가' },
  { level: 10, minExp: 1500, title: '캠퍼스 탐험가' },
  { level: 11, minExp: 1900, title: '도감 수집가' },
  { level: 12, minExp: 2350, title: '도감 수집가' },
  { level: 13, minExp: 2800, title: '도감 수집가' },
  { level: 14, minExp: 3300, title: '도감 수집가' },
  { level: 15, minExp: 3800, title: '도감 수집가' },
  { level: 16, minExp: 4350, title: '캠퍼스 베테랑' },
  { level: 17, minExp: 4900, title: '캠퍼스 베테랑' },
  { level: 18, minExp: 5500, title: '캠퍼스 베테랑' },
  { level: 19, minExp: 6100, title: '캠퍼스 베테랑' },
  { level: 20, minExp: 6750, title: '캠퍼스 베테랑' },
  { level: 21, minExp: 7450, title: '캠퍼스 고인물' },
  { level: 22, minExp: 8150, title: '캠퍼스 고인물' },
  { level: 23, minExp: 8900, title: '캠퍼스 고인물' },
  { level: 24, minExp: 9650, title: '캠퍼스 고인물' },
  { level: 25, minExp: 10450, title: '캠퍼스 고인물' },
  { level: 26, minExp: 11300, title: '살아있는 화석' },
  { level: 27, minExp: 12150, title: '살아있는 화석' },
  { level: 28, minExp: 13050, title: '살아있는 화석' },
  { level: 29, minExp: 14000, title: '살아있는 화석' },
  { level: 30, minExp: 15000, title: '캠퍼스 전설' },
];

export const MAX_LEVEL = LEVEL_TABLE[LEVEL_TABLE.length - 1].level;

/** Purely derived from total EXP. At max level the next-level fields are 0 and EXP beyond 15,000 is kept. */
export function levelFromExp(rawExp: number) {
  const exp = Number.isFinite(rawExp) && rawExp > 0 ? Math.floor(rawExp) : 0;
  const index = LEVEL_TABLE.findLastIndex(tier => exp >= tier.minExp);
  const { level, title, minExp } = LEVEL_TABLE[index], next = LEVEL_TABLE[index + 1];
  return {
    level, title, exp, expIntoLevel: exp - minExp,
    expForNextLevel: next ? next.minExp - minExp : 0,
    expToNextLevel: next ? next.minExp - exp : 0,
    isMaxLevel: !next,
  };
}

export function documentLevel(document: DexDocument) {
  return levelFromExp(totalExp(document));
}
