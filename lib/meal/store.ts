/**
 * lib/meal/store.ts — 저장된 식단 조회 및 명시적 후기·사진 DB 쓰기
 *
 * ⚠️ 서버 전용 모듈입니다. 'node:fs' 를 쓰므로 클라이언트 컴포넌트에서
 *    import 하면 빌드가 깨집니다. Route Handler / 서버 컴포넌트에서만 쓰세요.
 *
 * 읽기/수집 대상
 *   외부 수집은 scripts/crawl-meals.ts에서만 실행한다. 조회 함수는 수집하지 않는다.
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
import { computeBattle } from './battle.ts';
import { jsonFile, mealStorageRoot, readMealSnapshot, storedCrawl } from './sync-store.ts';
import type { StoredCrawl, SyncAttempt } from './sync-store.ts';

const DATA_DIR = join(process.cwd(), 'data');

export const SEED_SOURCE_LABEL = 'seed:data/meals.seed.json';


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
 * 저장된 식단 읽기. 수집은 명시적인 CLI만 담당한다
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
export function readMealCrawl(): StoredCrawl {
  const current=storedCrawl(mealStorageRoot());if(current)return current;
  const crawled = readJson<CrawlResult>('meals.json');
  const attempt=jsonFile<SyncAttempt>(join(mealStorageRoot(),'last-attempt.json'));
  if (crawled && Array.isArray(crawled.items)) return {...crawled,...(attempt?{syncStatus:attempt}:{})};

  const seed = readSeedMeals();
  return {
    ok: false,
    fetchedAt: '', // 시드에 현재 수집 시각을 부여하지 않는다.
    source: SEED_SOURCE_LABEL,
    items: seed,
    error: '저장된 식단을 읽을 수 없습니다. 예시 데이터이며 실제 메뉴가 아닙니다.',
    fallback: seed.length > 0 ? 'seed' : undefined,
  };
}

/** @deprecated 호환용 읽기 전용 래퍼. force/date는 수집을 실행하지 않는다. */
export async function ensureFreshMealCrawl(options?: {
  date?: string;
  force?: boolean;
}): Promise<CrawlResult> {
  void options;
  return readMealCrawl();
}
/** 특정 날짜의 식단 (동기 읽기). 날짜가 없으면 빈 배열 — 가짜로 메꾸지 않는다. */
export function readMealsByDate(date: string): { crawl: CrawlResult; items: MealItem[] } {
  const crawl = readMealCrawl();
  return { crawl, items: crawl.items.filter((m) => m.date === date) };
}

/** @deprecated 읽기 전용 호환 래퍼. force도 쓰기를 하지 않는다. */
export async function ensureFreshMealsByDate(
  date: string,
  options?: { force?: boolean },
): Promise<{ crawl: CrawlResult; items: MealItem[] }> {
  void options;
  return readMealsByDate(date);
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
  return readMealSnapshot(mealStorageRoot())?.photos??readJson<MealPhotoDbFile>('meal-photo-db.json')?.records??[];
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
  void options;
  return getBattle(date, mealTime);
}
