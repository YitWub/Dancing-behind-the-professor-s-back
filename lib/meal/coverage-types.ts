import type { Cafeteria, MealTime } from '../types.ts';
export interface MealDateCoverage {date:string;units:{cafeteria:Cafeteria;mealTime:MealTime;state:'complete'|'closed'|'unknown'|'partial'|'failed'|'not-observed'|'stored';menus:number;observedAt:string|null;lastAttemptAt:string|null;lastAttemptStatus:string|null;source:string|null}[]}
