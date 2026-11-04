/* ==========================================================================
 *  components/home/fed.ts — "오늘 먹였다고 표시한 끼니" 기록
 * --------------------------------------------------------------------------
 *  밥 게이지는 추정값이 아니다. 사용자가 직접 누른 것만 올라간다.
 *  그래서 라벨도 "오늘 먹은 끼니" 가 아니라 "먹였다고 표시한 끼니" 다 —
 *  앱이 아는 건 버튼을 눌렀다는 사실뿐이고 거기까지만 말한다.
 * ========================================================================== */

import type { MealTime } from '@/lib/types';

export interface FedEntry {
  /** MealItem.id — /meal 후기 화면과 같은 키를 쓴다 */
  mealItemId: string;
  mealTime: MealTime;
  /** 그때 화면에 떴던 메뉴 이름. 식단이 나중에 바뀌어도 기록은 그대로 남는다 */
  label: string;
  at: string;
}

const KEY = 'erica.home.fed.v1';
/** 날짜별로 쌓이므로 최근 며칠만 남기고 버린다 */
const KEEP_DAYS = 10;

type Book = Record<string, FedEntry[]>;

function isEntry(v: unknown): v is FedEntry {
  const e = v as Partial<FedEntry> | null;
  return (
    !!e &&
    typeof e.mealItemId === 'string' &&
    typeof e.label === 'string' &&
    typeof e.at === 'string' &&
    (e.mealTime === 'breakfast' || e.mealTime === 'lunch' || e.mealTime === 'dinner')
  );
}

function read(): Book {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const out: Book = {};
    for (const [date, list] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(list)) out[date] = list.filter(isEntry);
    }
    return out;
  } catch {
    return {};
  }
}

function write(book: Book): void {
  // 오래된 날짜부터 버린다. 기록이 무한히 쌓여 저장소를 채우면 꾸미기까지 같이 죽는다.
  const dates = Object.keys(book).sort().slice(-KEEP_DAYS);
  const trimmed: Book = {};
  for (const d of dates) if (book[d].length > 0) trimmed[d] = book[d];

  try {
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    /* 무시 — 기록이 안 남는 것뿐 */
  }
}

export function loadFed(date: string): FedEntry[] {
  return read()[date] ?? [];
}

/** 같은 끼니를 두 번 눌러도 한 번으로 센다. */
export function addFed(date: string, entry: FedEntry): FedEntry[] {
  const book = read();
  const list = (book[date] ?? []).filter((e) => e.mealItemId !== entry.mealItemId);
  const next = [...list, entry].sort((a, b) => a.at.localeCompare(b.at));
  book[date] = next;
  write(book);
  return next;
}

export function removeFed(date: string, mealItemId: string): FedEntry[] {
  const book = read();
  const next = (book[date] ?? []).filter((e) => e.mealItemId !== mealItemId);
  book[date] = next;
  write(book);
  return next;
}

/** 조식·중식·석식 중 몇 끼를 표시했나 (한 끼니에 두 코너를 눌러도 1 로 센다) */
export function fedSlots(entries: FedEntry[]): MealTime[] {
  const seen = new Set<MealTime>();
  for (const e of entries) seen.add(e.mealTime);
  return (['breakfast', 'lunch', 'dinner'] as MealTime[]).filter((t) => seen.has(t));
}
