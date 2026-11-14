/** B 인수 영역: PHASE 2에서는 타입 계약만 제공한다. 공급 데이터 연결/정규화 구현 없음. */
import type { Id, Versioned, LocalDate, Instant } from '../core/types.ts';

export type Cafeteria = 'haksik' | 'changbo' | 'dorm' | 'faculty';
export type MealTime = 'breakfast' | 'lunch' | 'dinner';
export interface Dish extends Versioned {
  canonicalName: string;
  variant: string | null;
  normalizationVersion: number;
  status: 'active' | 'redirected';
  redirectToDishId: Id | null;
}
export interface DishAlias extends Versioned {
  source: string;
  rawName: string;
  normalizedKey: string;
  cafeteria: Cafeteria | null;
  dishId: Id;
  normalizationVersion: number;
  decision: 'curated' | 'exact-rule';
}
export interface MealSnapshot {
  name: string | null;
  menu: string[];
  price: number | null;
  kcal: number | null;
  imageUrl: string | null;
  imageSourceUrl: string | null;
}
export interface MealOffering extends Versioned {
  legacyMealItemId: string;
  sourceRecordKey: string;
  date: LocalDate;
  cafeteria: Cafeteria;
  mealTime: MealTime;
  resolution:
    | { state: 'resolved'; dishId: Id; aliasId: Id; aliasRevision: number }
    | { state: 'unresolved'; reason: 'missing-name' | 'ambiguous' | 'unmapped' };
  snapshot: MealSnapshot;
  soldOut: boolean;
  provenance: {
    source: string;
    mode: 'live' | 'cache' | 'seed' | 'mock';
    lastSuccessfulFetchAt: Instant | null;
    lastAttemptAt: Instant | null;
  };
}
