/**
 * lib/meal/store.ts — data/*.json 파일 저장소 및 실시간 크롤링 연동
 *
 * ⚠️ 서버 전용 모듈입니다. 'node:fs' 를 쓰므로 클라이언트 컴포넌트에서
 *    import 하면 빌드가 깨집니다. Route Handler / 서버 컴포넌트에서만 쓰세요.
 *
 * 읽기/수집 대상
 *   https://life.hanyang.ac.kr/theme/pages/home.php (및 하위 페이지 실시간 크롤링)
 *   data/meals.json           크롤러 산출물 (CrawlResult)
 *   data/meals.seed.json      시드 식단 (크롤링 실패 시 폴백)
 *   data/meal-photo-db.json   식단 사진이 존재할 때 식단+사진을 함께 저장하는 DB 매핑 테이블
 *   data/meal-reviews.json    사용자 후기 (쓰기 대상, 없으면 시드에서 초기화)
 *   data/meal-reviews.seed.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import type {
  BattleResult,
  Cafeteria,
  CrawlResult,
  MealItem,
  MealReview,
  MealTime,
} from '../types.ts';
import { kstToday } from '../datetime.ts';
import { computeBattle } from './battle.ts';

const DATA_DIR = join(process.cwd(), 'data');

export const SEED_SOURCE_LABEL = 'seed:data/meals.seed.json';

/* ── 실시간 크롤링 중복 호출 방지(In-flight & 단기 Cooldown) 상태 ─────────── */
let inFlightCrawl: Promise<CrawlResult> | null = null;
let lastCrawledAtMs = 0;
let lastCrawledDates = new Set<string>();
/** 한 화면 마운트 시 동시에 발생하는 /api/meals, /api/meals/status, /api/meals/battle 요청 공유 창 */
const LIVE_CRAWL_DEDUP_MS = 2_500;

/* ────────────────────────────────────────────────────────────────────────────
 * 식단 + 사진 DB 연동 스키마 (사진이 존재하는 식단 전용 매핑 레코드)
 * ────────────────────────────────────────────────────────────────────────────
 * 그날의 식단 사진이 존재할 때, 식단 정보와 그 식단에 맞는 사진을
 * 추후 DB(RDBMS / NoSQL)에 함께 저장(INSERT / UPSERT)할 수 있도록 설계한 모델.
 *
 * [추후 RDBMS 연동 시 테이블 DDL 예시]
 * CREATE TABLE meal_with_photos (
 *   meal_item_id     VARCHAR(64) PRIMARY KEY,
 *   target_date      DATE NOT NULL,
 *   cafeteria        VARCHAR(32) NOT NULL,
 *   meal_time        VARCHAR(16) NOT NULL,
 *   menu_name        VARCHAR(255),
 *   menu_items_json  TEXT NOT NULL,
 *   price            INTEGER,
 *   kcal             INTEGER,
 *   image_local_url  VARCHAR(512) NOT NULL,
 *   image_source_url VARCHAR(1024) NOT NULL,
 *   image_file_name  VARCHAR(255) NOT NULL,
 *   image_mime_type  VARCHAR(64) DEFAULT 'image/jpeg',
 *   image_size_bytes INTEGER,
 *   synced_at        TIMESTAMP NOT NULL
 * );
 * ──────────────────────────────────────────────────────────────────────────*/

export interface MealPhotoDbRecord {
  /** 식단 고유 ID (PK, 예: "2026-11-03-haksik-lunch") */
  mealItemId: string;
  /** 식단 날짜 (YYYY-MM-DD) */
  date: string;
  /** 구내식당 구분 */
  cafeteria: Cafeteria;
  /** 끼니 구분 (breakfast | lunch | dinner) */
  mealTime: MealTime;
  /** 대표 메뉴명 */
  name: string | null;
  /** 상세 반찬/구성 메뉴 배열 */
  menu: string[];
  /** 가격(원) */
  price: number | null;
  /** 열량(kcal) */
  kcal: number | null;
  /** 식단과 1:1 매칭된 사진 데이터 (사진이 존재할 때만 생성) */
  photo: {
    /** 앱에서 서빙하는 로컬 이미지 경로 (예: "/meals/2026-11-03-haksik-lunch.jpg") */
    imageUrl: string;
    /** 학교 포털 원본 이미지 URL */
    imageSourceUrl: string;
    /** 저장된 파일명 */
    fileName: string;
    /** 이미지 MIME 타입 */
    mimeType: string;
    /** 파일 크기 (bytes) */
    sizeBytes: number | null;
  };
  /** 수집 및 매핑 시각 (ISO 8601) */
  syncedAt: string;
}

interface MealPhotoDbFile {
  note: string;
  schemaVersion: number;
  updatedAt: string;
  records: MealPhotoDbRecord[];
}

function readJson<T>(file: string): T | null {
  const path = join(DATA_DIR, file);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(join(DATA_DIR, file), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/* ────────────────────────────────────────────────────────────────────────────
 * 식단 읽기 및 실행 시 실시간 크롤링
 * ──────────────────────────────────────────────────────────────────────────*/

interface SeedMealFile {
  note?: string;
  items: MealItem[];
}

/** 시드 식단. 파일이 없으면 빈 배열 (앱은 여전히 살아 있어야 한다). */
export function readSeedMeals(): MealItem[] {
  return readJson<SeedMealFile>('meals.seed.json')?.items ?? [];
}

/**
 * 디스크에 저장된 식단 상태 동기 읽기.
 *
 * ★정직성 핵심: 이 함수는 절대 예외를 던지지 않고, 데이터가 어디서 왔는지를
 *   CrawlResult.ok / fallback 으로 정직하게 표시한다.
 */
export function readMealCrawl(): CrawlResult {
  const crawled = readJson<CrawlResult>('meals.json');
  if (crawled && Array.isArray(crawled.items)) return crawled;

  const seed = readSeedMeals();
  return {
    ok: false,
    fetchedAt: new Date().toISOString(),
    source: SEED_SOURCE_LABEL,
    items: seed,
    error: 'data/meals.json 이 없습니다. 크롤러(scripts/crawl-meals.ts)를 먼저 실행하세요.',
    fallback: seed.length > 0 ? 'seed' : undefined,
  };
}

/**
 * 실행/요청 시마다 https://life.hanyang.ac.kr/theme/pages/home.php 및 하위 페이지에서
 * 실시간 크롤링하여 최신 식단을 가져오고 data/meals.json 을 갱신한다.
 */
export async function ensureFreshMealCrawl(options?: {
  date?: string;
  force?: boolean;
}): Promise<CrawlResult> {
  const today = kstToday();
  const requestedDate = options?.date;
  const force = Boolean(options?.force);

  const hasDateCovered = !requestedDate || lastCrawledDates.has(requestedDate);
  const isWithinDedupWindow = Date.now() - lastCrawledAtMs < LIVE_CRAWL_DEDUP_MS;

  if (!force && hasDateCovered) {
    if (inFlightCrawl) return await inFlightCrawl;
    if (isWithinDedupWindow) return readMealCrawl();
  }

  if (inFlightCrawl && !force) {
    await inFlightCrawl;
    if (!requestedDate || lastCrawledDates.has(requestedDate)) {
      return readMealCrawl();
    }
  }

  const extraDates = requestedDate && requestedDate !== today ? [requestedDate] : [];
  const nextDates = new Set<string>([today, ...extraDates]);

  inFlightCrawl = (async () => {
    try {
      const { runMealCrawler } = await import('./crawler.ts');
      const result = await runMealCrawler({
        baseDate: today,
        extraDates,
        silent: true,
      });
      lastCrawledAtMs = Date.now();
      for (const d of nextDates) lastCrawledDates.add(d);
      for (const item of result.items) lastCrawledDates.add(item.date);
      return result;
    } catch {
      return readMealCrawl();
    } finally {
      inFlightCrawl = null;
    }
  })();

  return await inFlightCrawl;
}

/** 특정 날짜의 식단 (동기 읽기). 날짜가 없으면 빈 배열 — 가짜로 메꾸지 않는다. */
export function readMealsByDate(date: string): { crawl: CrawlResult; items: MealItem[] } {
  const crawl = readMealCrawl();
  return { crawl, items: crawl.items.filter((m) => m.date === date) };
}

/** 특정 날짜의 식단 (실시간 크롤링 포함). */
export async function ensureFreshMealsByDate(
  date: string,
  options?: { force?: boolean },
): Promise<{ crawl: CrawlResult; items: MealItem[] }> {
  const crawl = await ensureFreshMealCrawl({ date, force: options?.force });
  return { crawl, items: crawl.items.filter((m) => m.date === date) };
}

export function findMealItem(mealItemId: string): MealItem | null {
  return readMealCrawl().items.find((m) => m.id === mealItemId) ?? null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 식단 + 사진 DB 매핑 레코드 읽기/쓰기
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * 식단에 사진이 존재할 때만 식단+사진 DB 레코드로 변환한다.
 * 사진이 없는 식단(imageUrl === null)은 null 을 반환하여 제외한다.
 */
export function toMealPhotoDbRecord(
  item: MealItem,
  meta?: { mimeType?: string; sizeBytes?: number | null; syncedAt?: string },
): MealPhotoDbRecord | null {
  const imageUrl = item.imageUrl ?? null;
  const imageSourceUrl = item.imageSourceUrl ?? imageUrl;
  if (!imageUrl || !imageSourceUrl) return null;

  return {
    mealItemId: item.id,
    date: item.date,
    cafeteria: item.cafeteria,
    mealTime: item.mealTime,
    name: item.name,
    menu: [...item.menu],
    price: item.price,
    kcal: item.kcal,
    photo: {
      imageUrl,
      imageSourceUrl,
      fileName: basename(imageUrl.split('?')[0]),
      mimeType: meta?.mimeType ?? 'image/jpeg',
      sizeBytes: meta?.sizeBytes ?? null,
    },
    syncedAt: meta?.syncedAt ?? new Date().toISOString(),
  };
}

export function readMealPhotoDb(): MealPhotoDbRecord[] {
  return readJson<MealPhotoDbFile>('meal-photo-db.json')?.records ?? [];
}

export function writeMealPhotoDb(records: MealPhotoDbRecord[]): void {
  const payload: MealPhotoDbFile = {
    note: '식단 사진이 존재할 때 식단 정보와 매칭된 사진 메타데이터를 함께 DB에 적재할 수 있도록 저장한 테이블입니다.',
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    records,
  };
  writeJson('meal-photo-db.json', payload);
}

/**
 * 새로 수집된 식단 목록에서 사진이 존재하는 식단만 추출해
 * 기존 meal-photo-db 레코드에 mealItemId 기준으로 UPSERT 한다.
 */
export function upsertMealPhotoDb(newRecords: MealPhotoDbRecord[]): MealPhotoDbRecord[] {
  const byId = new Map<string, MealPhotoDbRecord>();
  for (const r of readMealPhotoDb()) byId.set(r.mealItemId, r);
  for (const r of newRecords) byId.set(r.mealItemId, r);
  const merged = [...byId.values()].sort((a, b) => a.mealItemId.localeCompare(b.mealItemId));
  writeMealPhotoDb(merged);
  return merged;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 후기
 * ──────────────────────────────────────────────────────────────────────────*/

interface MealReviewFile {
  note?: string;
  reviews: MealReview[];
}

/** 후기 전체. data/meal-reviews.json 이 없으면 시드로 초기화한다. */
export function readMealReviews(): MealReview[] {
  const live = readJson<MealReviewFile>('meal-reviews.json');
  if (live && Array.isArray(live.reviews)) return live.reviews;
  return readJson<MealReviewFile>('meal-reviews.seed.json')?.reviews ?? [];
}

export function writeMealReviews(reviews: MealReview[]): void {
  writeJson('meal-reviews.json', {
    note: '학식 후기. 시드에서 출발해 POST /api/meals/review 로 누적된다.',
    updatedAt: new Date().toISOString(),
    reviews,
  });
}

export function readMealReviewsFor(mealItemId: string): MealReview[] {
  return readMealReviews().filter((r) => r.mealItemId === mealItemId);
}

/* ────────────────────────────────────────────────────────────────────────────
 * 대결 (battle.ts 의 순수 계산에 파일 데이터를 물려주는 서버용 래퍼)
 * ──────────────────────────────────────────────────────────────────────────*/

export function getBattle(date: string, mealTime: MealTime): BattleResult {
  return computeBattle({
    date,
    mealTime,
    items: readMealCrawl().items,
    reviews: readMealReviews(),
  });
}

export async function ensureFreshBattle(
  date: string,
  mealTime: MealTime,
  options?: { force?: boolean },
): Promise<BattleResult> {
  const crawl = await ensureFreshMealCrawl({ date, force: options?.force });
  return computeBattle({
    date,
    mealTime,
    items: crawl.items,
    reviews: readMealReviews(),
  });
}
