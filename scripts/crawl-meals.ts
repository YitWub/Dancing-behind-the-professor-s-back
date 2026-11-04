/**
 * scripts/crawl-meals.ts — 한양대 ERICA 학식 크롤러
 *
 *   node scripts/crawl-meals.ts [--date=YYYY-MM-DD] [--offline]
 *
 * ★설계 원칙 — "크롤링이 실패해도 앱은 절대 깨지지 않는다"
 *   이 스크립트는 어떤 경우에도 0으로 종료하고 data/meals.json 을 남긴다.
 *   대신 CrawlResult.ok / fallback / error 에 무슨 일이 있었는지 정직하게 적는다.
 *
 *   성공        → ok: true,  fallback 없음
 *   실패 + 캐시 → ok: false, fallback: 'cache'  (직전 성공분 유지)
 *   실패 + 시드 → ok: false, fallback: 'seed'   (화면에 "못 가져왔습니다" 배지)
 *
 * ── 수집 범위 및 DB 연동 설계 ────────────────────────────────────────────
 *   1. https://life.hanyang.ac.kr/theme/pages/home.php 및 구내식당 상세 페이지
 *      (facilities/detail.php?id=1..4)를 참조하여 구내식당별 식단을 가져오되,
 *      기준일(오늘)과 내일(2일치) 식단만 수집한다.
 *   2. 식단 사진이 존재할 경우 로컬(public/meals/...)에 내려받고,
 *      식단과 매칭된 사진 정보를 data/meal-photo-db.json 에 함께 기록하여
 *      추후 DB(RDBMS/NoSQL)에 그대로 적재할 수 있도록 설계한다.
 *      사진이 없는 식단은 imageUrl: null, imageSourceUrl: null 로 두어
 *      화면에서 '이미지가 없습니다.'를 표시하도록 한다.
 * ────────────────────────────────────────────────────────────────────────
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Cafeteria, CafeteriaInfo, CrawlResult, MealItem, MealTime } from '../lib/types.ts';
import { kstToday } from '../lib/datetime.ts';
import { toMealPhotoDbRecord, upsertMealPhotoDb, type MealPhotoDbRecord } from '../lib/meal/store.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const PUBLIC_MEALS = join(ROOT, 'public', 'meals');

const ORIGIN = 'https://life.hanyang.ac.kr';
const HOME_URL = `${ORIGIN}/theme/pages/home.php`;
const DETAIL_URL = `${ORIGIN}/theme/pages/facilities/detail.php`;
const TIMEOUT_MS = 12_000;

/** 기본 구내식당 facility_id 목록 (home.php 의 dbFacilitiesList 폴백용) */
const DEFAULT_FACILITY_IDS: { id: number; cafeteria: Cafeteria; name: string }[] = [
  { id: 1, cafeteria: 'haksik', name: '학생식당' },
  { id: 2, cafeteria: 'faculty', name: '교직원식당' },
  { id: 3, cafeteria: 'changbo', name: '창업보육센터식당' },
  { id: 4, cafeteria: 'dorm', name: '창의인재원식당' },
];

/* ── 식당명 → Cafeteria 매핑 ────────────────────────────────────────────── */

const CAFETERIA_ALIASES: [RegExp, Cafeteria][] = [
  [/창업보육|창보|이푸른/, 'changbo'],
  [/창의인재원|기숙사|생활관|창의관/, 'dorm'],
  [/교직원|교수|faculty/i, 'faculty'],
  [/학생식당|학식|복지관|웰스토리/, 'haksik'],
];

function toCafeteria(name: string, facilityId?: number | null): Cafeteria | null {
  for (const [re, id] of CAFETERIA_ALIASES) if (re.test(name)) return id;
  if (facilityId === 1) return 'haksik';
  if (facilityId === 2) return 'faculty';
  if (facilityId === 3) return 'changbo';
  if (facilityId === 4) return 'dorm';
  return null;
}

const MEAL_TIME_ALIASES: [RegExp, MealTime][] = [
  [/조식|아침|breakfast/i, 'breakfast'],
  [/중식|점심|lunch/i, 'lunch'],
  [/석식|저녁|dinner/i, 'dinner'],
];

function toMealTime(name: string): MealTime | null {
  for (const [re, id] of MEAL_TIME_ALIASES) if (re.test(name)) return id;
  return null;
}

/* ── 유틸 및 파서 ───────────────────────────────────────────────────────── */

function addDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .trim();
}

function normalizeMenu(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((x) => decodeHtmlEntities(String(x))).filter(Boolean);
  if (typeof raw === 'string') {
    return decodeHtmlEntities(raw)
      .split(/[\n,·>/]|<br\s*\/?>/i)
      .map((s) => s.replace(/<[^>]*>/g, '').trim())
      .filter(Boolean);
  }
  return [];
}

/** 대표 메뉴명은 원본이 줄 때만 쓴다. 빈 문자열은 "모른다"와 같다 → null */
function strOrNull(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = decodeHtmlEntities(raw.replace(/<[^>]*>/g, '')).trim();
  return t === '' ? null : t;
}

function numOrNull(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const n = Number.parseInt(raw.replace(/[^\d]/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 원본 이미지 경로를 절대 URL로 정규화한다. 기본 로고(폴백)는 사진 없음(null)으로 처리한다. */
function normalizeImageUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t || t.includes('HYU_logo') || t.includes('fallback')) return null;
  try {
    return new URL(t, ORIGIN).href;
  } catch {
    return null;
  }
}

/**
 * 같은 (date, cafeteria, mealTime) 안에서 중복 메뉴를 제거하고,
 * 코너가 여러 개인 경우 첫 번째는 기본 id, 두 번째부터 -2, -3 접미사를 부여한다.
 */
function assignCornerIds(items: MealItem[]): MealItem[] {
  const uniqueMap = new Map<string, MealItem>();
  for (const item of items) {
    const sig = `${item.date}|${item.cafeteria}|${item.mealTime}|${item.name ?? ''}|${item.menu.join('/')}`;
    const prev = uniqueMap.get(sig);
    if (!prev) {
      uniqueMap.set(sig, item);
    } else if (!prev.imageSourceUrl && item.imageSourceUrl) {
      uniqueMap.set(sig, { ...prev, imageSourceUrl: item.imageSourceUrl, imageUrl: item.imageUrl });
    }
  }

  const counts = new Map<string, number>();
  const out: MealItem[] = [];
  for (const item of uniqueMap.values()) {
    const baseId = `${item.date}-${item.cafeteria}-${item.mealTime}`;
    const seq = (counts.get(baseId) ?? 0) + 1;
    counts.set(baseId, seq);
    const id = seq === 1 ? baseId : `${baseId}-${seq}`;
    out.push({ ...item, id });
  }
  return out;
}

/** JSON 응답 파서. 배열이든 {menus:[...]} 든 {data:[...]} 든 받아준다. */
export function parseJsonMenus(payload: unknown): MealItem[] {
  const rows: unknown[] = Array.isArray(payload)
    ? payload
    : typeof payload === 'object' && payload !== null
      ? ((payload as Record<string, unknown>).menus as unknown[]) ??
        ((payload as Record<string, unknown>).data as unknown[]) ??
        ((payload as Record<string, unknown>).items as unknown[]) ??
        []
      : [];

  const out: MealItem[] = [];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as Record<string, unknown>;

    const date = typeof r.date === 'string'
      ? r.date.slice(0, 10)
      : typeof r.target_date === 'string'
        ? r.target_date.slice(0, 10)
        : null;
    const cafeteria = toCafeteria(
      String(r.facility_name ?? r.restaurant ?? r.cafeteria ?? r.place ?? ''),
      numOrNull(r.facility_id),
    );
    const mealTime = toMealTime(String(r.meal_type ?? r.mealTime ?? r.meal_time ?? r.course ?? r.type ?? ''));
    const name = strOrNull(r.name ?? r.menuName ?? r.title);
    let menu = normalizeMenu(r.description ?? r.items ?? r.menu ?? r.dishes);
    if (menu.length === 0 && name) menu = [name];

    if (!date || !cafeteria || !mealTime || menu.length === 0) continue;

    const imageSourceUrl = normalizeImageUrl(r.image_url ?? r.imageUrl ?? r.image);
    const isSoldOut = Boolean(Number(r.is_sold_out ?? 0)) || r.soldOut === true;

    out.push({
      id: `${date}-${cafeteria}-${mealTime}`,
      date,
      cafeteria,
      mealTime,
      name,
      menu,
      price: numOrNull(r.price),
      kcal: numOrNull(r.kcal ?? r.calorie ?? r.kilocalorie),
      imageUrl: imageSourceUrl,
      imageSourceUrl,
      soldOut: isSoldOut,
    });
  }
  return assignCornerIds(out);
}

/**
 * home.php 안에 인라인된 `const dbMenus = [...];` 와 `const dbFacilitiesList = [...];` 를 파싱한다.
 */
export function parseHomePhp(html: string): {
  items: MealItem[];
  facilities: { id: number; cafeteria: Cafeteria; name: string; location: string; buildingNo: string; imageSourceUrl: string | null }[];
} {
  let items: MealItem[] = [];
  const menusMatch = html.match(/const\s+dbMenus\s*=\s*(\[[\s\S]*?\]);/);
  if (menusMatch) {
    try {
      const parsed = JSON.parse(menusMatch[1]) as unknown[];
      items = parseJsonMenus(parsed);
    } catch {
      // JSON 파싱 실패 시 무시하고 상세 페이지 파서로 진행
    }
  }

  const facilities: { id: number; cafeteria: Cafeteria; name: string; location: string; buildingNo: string; imageSourceUrl: string | null }[] = [];
  const facMatch = html.match(/const\s+dbFacilitiesList\s*=\s*(\[[\s\S]*?\]);/);
  if (facMatch) {
    try {
      const rows = JSON.parse(facMatch[1]) as Record<string, unknown>[];
      for (const r of rows) {
        if (String(r.category ?? '') !== '구내식당') continue;
        const id = numOrNull(r.id);
        const name = strOrNull(r.name) ?? '';
        const cafeteria = toCafeteria(name, id);
        if (!id || !cafeteria) continue;
        facilities.push({
          id,
          cafeteria,
          name,
          location: strOrNull(r.location) ?? '',
          buildingNo: strOrNull(r.facility_no) ?? '',
          imageSourceUrl: normalizeImageUrl(r.image_url),
        });
      }
    } catch {
      // 무시
    }
  }

  return { items, facilities };
}

/**
 * detail.php?id=<facilityId>&date=<YYYY-MM-DD> 의 일별 식단(#view-pane-daily) 및 식당 정보를 파싱한다.
 */
export function parseDetailPhp(
  html: string,
  date: string,
  facilityId: number,
  fallbackCafeteria: Cafeteria,
): { items: MealItem[]; cafeteriaInfo: CafeteriaInfo | null } {
  const facName = strOrNull(html.match(/<div class="fac-name">([\s\S]*?)<\/div>/i)?.[1]) ?? '';
  const cafeteria = toCafeteria(facName, facilityId) ?? fallbackCafeteria;

  // 식당 기본 정보 추출
  const coverImg = normalizeImageUrl(
    html.match(/<img[^>]+src="([^"]+)"[^>]*class="fac-cover__img"/i)?.[1] ??
      html.match(/class="fac-cover__img"[^>]+src="([^"]+)"/i)?.[1],
  );
  const extractInfoRow = (label: string): string => {
    const re = new RegExp(
      `<td[^>]*class="info-label"[^>]*>\\s*${label}\\s*<\\/td>\\s*<td[^>]*class="info-value"[^>]*>([\\s\\S]*?)<\\/td>`,
      'i',
    );
    return html.match(re)?.[1] ?? '';
  };
  const location = strOrNull(extractInfoRow('위치')) ?? '';
  const buildingNo = strOrNull(extractInfoRow('건물 번호')) ?? '';
  const rawOpTime = extractInfoRow('영업시간');
  const operatingTime = rawOpTime
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .split(/[\r\n]+/)
    .map((s) => decodeHtmlEntities(s).trim())
    .filter(Boolean);
  const notice =
    strOrNull(html.match(/<div class="fac-notice-box__text">([\s\S]*?)<\/div>/i)?.[1]) ?? '';

  const cafeteriaInfo: CafeteriaInfo | null = facName
    ? {
        cafeteria,
        facilityId,
        name: facName,
        location,
        buildingNo,
        operatingTime,
        operatingStatus: '영업중',
        notice,
        contact: '',
        imageUrl: coverImg,
        imageSourceUrl: coverImg,
        sourceUrl: `${DETAIL_URL}?id=${facilityId}`,
      }
    : null;

  // #view-pane-daily 영역에서 선택된 날짜(date)의 식단 카드 파싱
  const paneMatch = html.match(/id="view-pane-daily"[^>]*>([\s\S]*?)<\/section>/i);
  const pane = paneMatch ? paneMatch[1] : html;
  const groups = pane.split('<div class="menu-group">').slice(1);

  const items: MealItem[] = [];
  for (const g of groups) {
    const badge = g.match(/meal-badge--(breakfast|lunch|dinner)/i)?.[1]?.toLowerCase() as
      | MealTime
      | undefined;
    const mealTime =
      badge ??
      toMealTime(g.match(/<div class="menu-group__title">([\s\S]*?)<\/div>/i)?.[1] ?? '');
    if (!mealTime) continue;

    const cards = g.split('<div class="menu-card-v">').slice(1);
    for (const card of cards) {
      const rawImg =
        card.match(/<img[^>]+src="([^"]+)"[^>]*class="menu-card-v__img"/i)?.[1] ??
        card.match(/class="menu-card-v__img"[^>]+src="([^"]+)"/i)?.[1] ??
        null;
      const imageSourceUrl = normalizeImageUrl(rawImg);

      const name = strOrNull(card.match(/<div class="menu-card-v__name">([\s\S]*?)<\/div>/i)?.[1]);
      const descRaw = card.match(/<div class="menu-card-v__desc">([\s\S]*?)<\/div>/i)?.[1] ?? '';
      let menu = normalizeMenu(descRaw);
      if (menu.length === 0 && name) menu = [name];
      if (menu.length === 0) continue;

      const priceRaw = card.match(/<span class="menu-card-v__price">([\s\S]*?)<\/span>/i)?.[1];
      const price = numOrNull(priceRaw);
      const soldOut = /품절|판매\s*종료/.test(card);

      items.push({
        id: `${date}-${cafeteria}-${mealTime}`,
        date,
        cafeteria,
        mealTime,
        name,
        menu,
        price,
        kcal: null,
        imageUrl: imageSourceUrl,
        imageSourceUrl,
        soldOut,
      });
    }
  }

  return { items: assignCornerIds(items), cafeteriaInfo };
}

/**
 * HTML 표 파서 (정규식 기반 — cheerio 등 외부 의존성 없이).
 * 기대 형태: 식당/끼니 이름이 들어간 행 + 메뉴 셀.
 */
export function parseHtmlMenus(html: string, date: string): MealItem[] {
  const out: MealItem[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRe.exec(html)) !== null) {
    const cells = [...rowMatch[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m) =>
      m[1]
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .trim(),
    );
    if (cells.length < 2) continue;

    const header = cells[0];
    const cafeteria = toCafeteria(header);
    const fromHeader = toMealTime(header);
    const mealTime = fromHeader ?? toMealTime(cells[1] ?? '');
    if (!cafeteria || !mealTime) continue;

    const menu = normalizeMenu(cells.slice(fromHeader ? 1 : 2).join('\n'));
    if (menu.length === 0) continue;

    out.push({
      id: `${date}-${cafeteria}-${mealTime}`,
      date,
      cafeteria,
      mealTime,
      name: null,
      menu,
      price: null,
      kcal: null,
      imageUrl: null,
      imageSourceUrl: null,
    });
  }
  return assignCornerIds(out);
}

/* ── 폴백 소스 ──────────────────────────────────────────────────────────── */

function readJsonFile<T>(file: string): T | null {
  const p = join(DATA, file);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as T;
  } catch {
    return null;
  }
}

function loadSeed(): MealItem[] {
  return readJsonFile<{ items: MealItem[] }>('meals.seed.json')?.items ?? [];
}

function loadCache(): CrawlResult | null {
  const prev = readJsonFile<CrawlResult>('meals.json');
  return prev && prev.ok && Array.isArray(prev.items) && prev.items.length > 0 ? prev : null;
}

/* ── 네트워크 및 이미지 다운로드 ─────────────────────────────────────────── */

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'erica-life-meal-bot/0.1 (Hanyang ERICA class project; contact via repo)',
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function downloadMealImage(
  sourceUrl: string,
  fileBaseName: string,
): Promise<{ localUrl: string; mimeType: string; sizeBytes: number } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(sourceUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'erica-life-meal-bot/0.1 (Hanyang ERICA class project; contact via repo)',
      },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? 'image/jpeg';
    const rawExt = extname(new URL(sourceUrl).pathname).toLowerCase();
    const ext = rawExt && /^\.(jpe?g|png|webp|gif)$/i.test(rawExt) ? rawExt : '.jpg';
    const fileName = `${fileBaseName}${ext}`;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0) return null;

    mkdirSync(PUBLIC_MEALS, { recursive: true });
    writeFileSync(join(PUBLIC_MEALS, fileName), buf);
    return {
      localUrl: `/meals/${fileName}`,
      mimeType: contentType.split(';')[0].trim() || 'image/jpeg',
      sizeBytes: buf.byteLength,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * https://life.hanyang.ac.kr/theme/pages/home.php 및 구내식당별 상세 페이지에서
 * 오늘(today)과 내일(tomorrow) 식단만 수집한다.
 */
async function crawlTodayAndTomorrow(
  today: string,
  tomorrow: string,
  allowWriteAssets: boolean,
): Promise<{ items: MealItem[]; cafeterias: CafeteriaInfo[]; dbRecords: MealPhotoDbRecord[]; source: string }> {
  const allowedDates = new Set([today, tomorrow]);
  const collectedItems: MealItem[] = [];
  const cafeteriaMap = new Map<Cafeteria, CafeteriaInfo>();

  console.log(`· 시도: ${HOME_URL} (대상 날짜: 오늘 ${today}, 내일 ${tomorrow})`);
  const homeHtml = await fetchText(HOME_URL);
  const homeParsed = parseHomePhp(homeHtml);

  for (const item of homeParsed.items) {
    if (allowedDates.has(item.date)) {
      collectedItems.push(item);
    }
  }

  const targetFacilities =
    homeParsed.facilities.length > 0
      ? homeParsed.facilities.map((f) => ({ id: f.id, cafeteria: f.cafeteria, name: f.name }))
      : DEFAULT_FACILITY_IDS;

  for (const fac of targetFacilities) {
    for (const targetDate of [today, tomorrow]) {
      const detailUrl = `${DETAIL_URL}?id=${fac.id}&date=${targetDate}&view=daily`;
      try {
        const detailHtml = await fetchText(detailUrl);
        const { items, cafeteriaInfo } = parseDetailPhp(detailHtml, targetDate, fac.id, fac.cafeteria);
        for (const item of items) {
          if (allowedDates.has(item.date)) {
            collectedItems.push(item);
          }
        }
        if (cafeteriaInfo && !cafeteriaMap.has(cafeteriaInfo.cafeteria)) {
          cafeteriaMap.set(cafeteriaInfo.cafeteria, cafeteriaInfo);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  ⚠ 상세 페이지 수집 건너뜀 (${detailUrl}): ${msg}`);
      }
    }
  }

  // 오늘과 내일 식단만 남기고 코너별 ID 부여
  const mergedItems = assignCornerIds(
    collectedItems.filter((item) => allowedDates.has(item.date)),
  );

  if (mergedItems.length === 0) {
    throw new Error(`오늘(${today})과 내일(${tomorrow}) 식단이 0건입니다.`);
  }

  // 식단 사진 다운로드 및 DB 저장용(MealPhotoDbRecord) 매핑
  const dbRecords: MealPhotoDbRecord[] = [];
  const syncedAt = new Date().toISOString();

  for (const item of mergedItems) {
    if (!item.imageSourceUrl) {
      item.imageUrl = null;
      item.imageSourceUrl = null;
      continue;
    }

    if (allowWriteAssets) {
      const downloaded = await downloadMealImage(item.imageSourceUrl, item.id);
      if (downloaded) {
        item.imageUrl = downloaded.localUrl;
        const record = toMealPhotoDbRecord(item, {
          mimeType: downloaded.mimeType,
          sizeBytes: downloaded.sizeBytes,
          syncedAt,
        });
        if (record) dbRecords.push(record);
      } else {
        item.imageUrl = item.imageSourceUrl;
        const record = toMealPhotoDbRecord(item, { syncedAt });
        if (record) dbRecords.push(record);
      }
    } else {
      item.imageUrl = item.imageSourceUrl;
    }
  }

  return {
    items: mergedItems,
    cafeterias: [...cafeteriaMap.values()],
    dbRecords,
    source: HOME_URL,
  };
}

/* ── 실행 ───────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dateArg = args.find((a) => a.startsWith('--date='))?.slice('--date='.length);
  const offline = args.includes('--offline');
  // 출력 경로 재지정 (테스트/드라이런용). 기본은 data/meals.json
  const outArg = args.find((a) => a.startsWith('--out='))?.slice('--out='.length);
  const outPath = outArg ? resolve(outArg) : join(DATA, 'meals.json');
  const isDefaultOut = !outArg;

  const today = dateArg ?? kstToday(); // UTC 가 아니라 KST 기준 오늘
  const tomorrow = addDays(today, 1);

  const attempts: string[] = [];
  let result: CrawlResult | null = null;

  if (!offline) {
    try {
      const { items, cafeterias, dbRecords, source } = await crawlTodayAndTomorrow(
        today,
        tomorrow,
        isDefaultOut,
      );
      result = {
        ok: true,
        fetchedAt: new Date().toISOString(),
        source,
        items,
        cafeterias,
      };
      if (isDefaultOut && dbRecords.length > 0) {
        const totalDb = upsertMealPhotoDb(dbRecords);
        console.log(
          `  ✓ 식단 사진 매칭 DB(data/meal-photo-db.json) 저장 완료 — 금회 ${dbRecords.length}건 (누적 ${totalDb.length}건)`,
        );
      }
      console.log(`  ✓ 성공 — 오늘(${today})·내일(${tomorrow}) 식단 총 ${items.length}건`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      attempts.push(`${HOME_URL} → ${msg}`);
      console.log(`  ✗ 실패 — ${msg}`);
    }
  } else {
    attempts.push('--offline 플래그로 네트워크 요청을 건너뛰었습니다');
  }

  if (!result) {
    const cached = loadCache();
    if (cached) {
      result = {
        ...cached,
        ok: false,
        fetchedAt: new Date().toISOString(),
        error: `크롤링 실패 — 직전 성공분을 그대로 씁니다. ${attempts.join(' | ')}`,
        fallback: 'cache',
      };
      console.log(`· 폴백: 캐시 ${cached.items.length}건`);
    } else {
      const seed = loadSeed();
      result = {
        ok: false,
        fetchedAt: new Date().toISOString(),
        source: 'seed:data/meals.seed.json',
        items: seed,
        error: `크롤링 실패 — 시드 데이터로 대체했습니다. ${attempts.join(' | ')}`,
        fallback: seed.length > 0 ? 'seed' : undefined,
      };
      console.log(`· 폴백: 시드 ${seed.length}건`);
    }
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

  console.log(
    `\n→ ${relative(ROOT, outPath)} 저장 (ok=${result.ok}${result.fallback ? `, fallback=${result.fallback}` : ''}, items=${result.items.length})`,
  );
  if (!result.ok) {
    console.log('  화면에는 "식단을 못 가져왔습니다(시드 데이터 표시 중)" 배지가 떠야 합니다.');
  }
}

/** 직접 실행됐을 때만 크롤링한다 (파서만 import 하는 경우를 위해). */
const isEntrypoint =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

/**
 * ★종료코드 계약 (CONTRACT.md 8장) — 함부로 바꾸지 말 것
 *
 *   **크롤 실패는 exit code 가 아니라 `CrawlResult.ok=false` 로 표현한다.**
 *   exit code 는 "스크립트가 제 일을 했는가"이지 "크롤링이 성공했는가"가 아니다.
 */
if (isEntrypoint) {
  main()
    .catch((err) => {
      console.error('크롤러 자체가 예외로 죽었습니다:', err);
      try {
        const seed = loadSeed();
        const fallbackResult: CrawlResult = {
          ok: false,
          fetchedAt: new Date().toISOString(),
          source: 'seed:data/meals.seed.json',
          items: seed,
          error: `크롤러 예외: ${err instanceof Error ? err.message : String(err)}`,
          fallback: seed.length > 0 ? 'seed' : undefined,
        };
        mkdirSync(DATA, { recursive: true });
        writeFileSync(join(DATA, 'meals.json'), `${JSON.stringify(fallbackResult, null, 2)}\n`, 'utf8');
      } catch (writeErr) {
        console.error('폴백 파일 기록도 실패했습니다:', writeErr);
      }
    })
    .finally(() => {
      process.exitCode = 0;
    });
}
