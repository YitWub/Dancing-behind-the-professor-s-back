/**
 * lib/meal/crawler.ts — 한양대 ERICA 학식 실시간 크롤러 (home.php 및 하위 페이지)
 *
 * ⚠️ 서버 전용 모듈입니다. 'node:fs' 를 쓰므로 클라이언트 컴포넌트에서
 *    import 하면 빌드가 깨집니다. Route Handler / 서버 컴포넌트 / 스크립트에서만 쓰세요.
 *
 * 수집 대상 (실행할 때마다 실시간 크롤링):
 *   1. 메인 페이지: https://life.hanyang.ac.kr/theme/pages/home.php
 *      - 인라인 dbMenus, dbFacilitiesList 추출 및 하위 페이지 링크 탐색
 *   2. 하위 페이지 (시설안내): https://life.hanyang.ac.kr/theme/pages/facilities/index.php
 *      - 인라인 dbFacilities 에서 구내식당(학생식당·교직원식당·창업보육센터식당·창의인재원식당) 메타데이터 추출
 *   3. 하위 페이지 (식권구매): https://life.hanyang.ac.kr/theme/pages/payment/ticket-shops.php
 *      - 구내식당 상세 페이지 링크(facilities/detail.php?id=...) 탐색
 *   4. 하위 페이지 (식당별 상세): https://life.hanyang.ac.kr/theme/pages/facilities/detail.php?id=1..4&date=YYYY-MM-DD&view=daily
 *      - 일별 식단(#view-pane-daily) 카드 + 식단 사진 URL + 품절 여부 추출
 *      - 주간 식단표(#view-pane-weekly) 보조 추출
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';

import type { Cafeteria, CafeteriaInfo, CrawlResult, MealItem, MealTime } from '../types.ts';
import { kstToday } from '../datetime.ts';
import {
  readMealPhotoDb,
  toMealPhotoDbRecord,
  upsertMealPhotoDb,
  type MealPhotoDbRecord,
} from './store.ts';

export const ORIGIN = 'https://life.hanyang.ac.kr';
export const HOME_URL = `${ORIGIN}/theme/pages/home.php`;
export const FACILITIES_INDEX_URL = `${ORIGIN}/theme/pages/facilities/index.php`;
export const TICKET_SHOPS_URL = `${ORIGIN}/theme/pages/payment/ticket-shops.php`;
export const DETAIL_URL = `${ORIGIN}/theme/pages/facilities/detail.php`;
const TIMEOUT_MS = 12_000;

/** 기본 구내식당 facility_id 목록 (폴백용) */
export const DEFAULT_FACILITY_IDS: { id: number; cafeteria: Cafeteria; name: string }[] = [
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

export function toCafeteria(name: string, facilityId?: number | null): Cafeteria | null {
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

export function toMealTime(name: string): MealTime | null {
  for (const [re, id] of MEAL_TIME_ALIASES) if (re.test(name)) return id;
  return null;
}

/* ── 유틸 및 파서 ───────────────────────────────────────────────────────── */

export function addDays(iso: string, delta: number): string {
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
export function assignCornerIds(items: MealItem[]): MealItem[] {
  const uniqueMap = new Map<string, MealItem>();
  for (const item of items) {
    const sig = `${item.date}|${item.cafeteria}|${item.mealTime}|${item.name ?? ''}|${item.menu.join('/')}`;
    const prev = uniqueMap.get(sig);
    if (!prev) {
      uniqueMap.set(sig, item);
    } else {
      const mergedImg = prev.imageSourceUrl ?? item.imageSourceUrl ?? null;
      const mergedLocal = prev.imageUrl ?? item.imageUrl ?? mergedImg;
      uniqueMap.set(sig, {
        ...prev,
        price: prev.price ?? item.price,
        kcal: prev.kcal ?? item.kcal,
        imageSourceUrl: mergedImg,
        imageUrl: mergedLocal,
        soldOut: Boolean(prev.soldOut || item.soldOut),
      });
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

    const date =
      typeof r.date === 'string'
        ? r.date.slice(0, 10)
        : typeof r.target_date === 'string'
          ? r.target_date.slice(0, 10)
          : null;
    const cafeteria = toCafeteria(
      String(r.facility_name ?? r.restaurant ?? r.cafeteria ?? r.place ?? ''),
      numOrNull(r.facility_id),
    );
    const mealTime = toMealTime(
      String(r.meal_type ?? r.mealTime ?? r.meal_time ?? r.course ?? r.type ?? ''),
    );
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
 * home.php 안에 인라인된 `const dbMenus = [...];`, `const dbFacilitiesList = [...];`
 * 및 하위 페이지 링크들을 파싱한다.
 */
export function parseHomePhp(html: string): {
  items: MealItem[];
  facilities: {
    id: number;
    cafeteria: Cafeteria;
    name: string;
    location: string;
    buildingNo: string;
    imageSourceUrl: string | null;
  }[];
  subpageUrls: string[];
} {
  let items: MealItem[] = [];
  const menusMatch = html.match(/const\s+dbMenus\s*=\s*(\[[\s\S]*?\]);/);
  if (menusMatch) {
    try {
      const parsed = JSON.parse(menusMatch[1]) as unknown[];
      items = parseJsonMenus(parsed);
    } catch {
      // JSON 파싱 실패 시 무시하고 하위 페이지 파서로 진행
    }
  }

  const facilities: {
    id: number;
    cafeteria: Cafeteria;
    name: string;
    location: string;
    buildingNo: string;
    imageSourceUrl: string | null;
  }[] = [];
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

  // home.php 내의 하위 페이지 링크(/theme/pages/...) 추출
  const subpageSet = new Set<string>();
  for (const m of html.matchAll(/href=["'](\/theme\/pages\/[^"'#${}?]+(?:\?id=\d+)?)["']/gi)) {
    try {
      const u = new URL(m[1], ORIGIN).href;
      if (u !== HOME_URL) subpageSet.add(u);
    } catch {
      // 무시
    }
  }

  return { items, facilities, subpageUrls: [...subpageSet] };
}

/**
 * 하위 페이지 facilities/index.php 의 `const dbFacilities = [...];` 를 파싱하여
 * 구내식당 상세 정보(CafeteriaInfo) 목록을 추출한다.
 */
export function parseFacilitiesIndexPhp(html: string): CafeteriaInfo[] {
  const out: CafeteriaInfo[] = [];
  const match = html.match(/const\s+dbFacilities\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) return out;

  try {
    const rows = JSON.parse(match[1]) as Record<string, unknown>[];
    for (const r of rows) {
      if (String(r.category ?? '') !== '구내식당') continue;
      const facilityId = numOrNull(r.id);
      const name = strOrNull(r.name) ?? '';
      const cafeteria = toCafeteria(name, facilityId);
      if (!facilityId || !cafeteria) continue;

      const operatingTime = String(r.operating_time ?? '')
        .split(/[\r\n]+/)
        .map((s) => decodeHtmlEntities(s).trim())
        .filter(Boolean);
      const coverImg = normalizeImageUrl(r.image_url);

      out.push({
        cafeteria,
        facilityId,
        name,
        location: strOrNull(r.location) ?? '',
        buildingNo: strOrNull(r.facility_no) ?? '',
        operatingTime,
        operatingStatus: strOrNull(r.operating_status) ?? '영업중',
        notice: strOrNull(r.notice) ?? '',
        contact: strOrNull(r.contact) ?? '',
        imageUrl: coverImg,
        imageSourceUrl: coverImg,
        sourceUrl: `${DETAIL_URL}?id=${facilityId}`,
      });
    }
  } catch {
    // 무시
  }
  return out;
}

/**
 * 하위 페이지 payment/ticket-shops.php 등에서 detail.php?id=... 링크의 시설 ID를 추출한다.
 */
export function parseSubpageFacilityIds(html: string): number[] {
  const ids = new Set<number>();
  for (const m of html.matchAll(/\/theme\/pages\/facilities\/detail\.php\?id=(\d+)/gi)) {
    const id = Number.parseInt(m[1], 10);
    if (Number.isFinite(id) && id > 0) ids.add(id);
  }
  return [...ids];
}

/**
 * detail.php?id=<facilityId>&date=<YYYY-MM-DD> 의 일별 식단(#view-pane-daily),
 * 주간 식단(#view-pane-weekly) 및 식당 정보를 파싱한다.
 */
export function parseDetailPhp(
  html: string,
  date: string,
  facilityId: number,
  fallbackCafeteria: Cafeteria,
): { items: MealItem[]; weeklyItems: MealItem[]; cafeteriaInfo: CafeteriaInfo | null } {
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
  const contact = strOrNull(extractInfoRow('연락처')) ?? '';
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
        contact,
        imageUrl: coverImg,
        imageSourceUrl: coverImg,
        sourceUrl: `${DETAIL_URL}?id=${facilityId}`,
      }
    : null;

  // 1) #view-pane-daily 영역에서 선택된 날짜(date)의 식단 카드 파싱
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

  // 2) #view-pane-weekly 영역에서 주간 식단 카드 보조 추출 (일~토 7일치)
  const weeklyItems: MealItem[] = [];
  const weekDates = [...pane.matchAll(/selectDay\(['"](\d{4}-\d{2}-\d{2})['"]\)/g)].map(
    (m) => m[1],
  );
  const weeklyPaneMatch = html.match(
    /id="view-pane-weekly"[^>]*>([\s\S]*?)id="view-pane-daily"/i,
  );
  if (weeklyPaneMatch && weekDates.length > 0) {
    const dayCards = weeklyPaneMatch[1].split('<div class="weekly-day-card').slice(1);
    dayCards.forEach((dayCard, idx) => {
      const cardDate = weekDates[idx];
      if (!cardDate) return;
      const mealBlocks = dayCard.split('<div class="weekly-m-meal-block">').slice(1);
      for (const block of mealBlocks) {
        const badge = block
          .match(/meal-badge--(breakfast|lunch|dinner)/i)?.[1]
          ?.toLowerCase() as MealTime | undefined;
        const mealTime =
          badge ??
          toMealTime(block.match(/<div class="weekly-m-meal-label">([\s\S]*?)<\/div>/i)?.[1] ?? '');
        if (!mealTime) continue;

        const mItems = block.split('<div class="weekly-m-item">').slice(1);
        for (const mItem of mItems) {
          const name = strOrNull(
            mItem.match(/<span class="weekly-m-item__name">([\s\S]*?)<\/span>/i)?.[1],
          );
          const price = numOrNull(
            mItem.match(/<span class="weekly-m-item__price">([\s\S]*?)<\/span>/i)?.[1],
          );
          const descRaw =
            mItem.match(/<div class="weekly-m-item__desc">([\s\S]*?)<\/div>/i)?.[1] ?? '';
          let menu = normalizeMenu(descRaw);
          if (menu.length === 0 && name) menu = [name];
          if (menu.length === 0) continue;

          weeklyItems.push({
            id: `${cardDate}-${cafeteria}-${mealTime}`,
            date: cardDate,
            cafeteria,
            mealTime,
            name,
            menu,
            price,
            kcal: null,
            imageUrl: null,
            imageSourceUrl: null,
            soldOut: false,
          });
        }
      }
    });
  }

  return {
    items: assignCornerIds(items),
    weeklyItems: assignCornerIds(weeklyItems),
    cafeteriaInfo,
  };
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

/* ── 네트워크 및 이미지 다운로드 ─────────────────────────────────────────── */

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
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
  publicMealsDir: string,
  existingRecord?: MealPhotoDbRecord,
): Promise<{ localUrl: string; mimeType: string; sizeBytes: number } | null> {
  // 이미 같은 원본 URL로 내려받은 파일이 로컬에 존재하면 재다운로드를 생략하여 응답 속도를 높인다.
  if (
    existingRecord &&
    existingRecord.photo.imageSourceUrl === sourceUrl &&
    existingRecord.photo.imageUrl.startsWith('/meals/')
  ) {
    const existingFile = join(publicMealsDir, existingRecord.photo.fileName);
    if (existsSync(existingFile)) {
      try {
        const st = statSync(existingFile);
        if (st.size > 0) {
          return {
            localUrl: existingRecord.photo.imageUrl,
            mimeType: existingRecord.photo.mimeType || 'image/jpeg',
            sizeBytes: st.size,
          };
        }
      } catch {
        // 파일 확인 실패 시 다시 다운로드
      }
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(sourceUrl, {
      signal: controller.signal,
      cache: 'no-store',
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

    mkdirSync(publicMealsDir, { recursive: true });
    writeFileSync(join(publicMealsDir, fileName), buf);
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

function mergeCafeteriaInfo(base: CafeteriaInfo, patch: CafeteriaInfo): CafeteriaInfo {
  return {
    cafeteria: base.cafeteria,
    facilityId: base.facilityId || patch.facilityId,
    name: base.name || patch.name,
    location: base.location || patch.location,
    buildingNo: base.buildingNo || patch.buildingNo,
    operatingTime: base.operatingTime.length > 0 ? base.operatingTime : patch.operatingTime,
    operatingStatus: base.operatingStatus || patch.operatingStatus,
    notice: base.notice || patch.notice,
    contact: base.contact || patch.contact,
    imageUrl: base.imageUrl ?? patch.imageUrl,
    imageSourceUrl: base.imageSourceUrl ?? patch.imageSourceUrl,
    sourceUrl: base.sourceUrl || patch.sourceUrl,
  };
}

/**
 * https://life.hanyang.ac.kr/theme/pages/home.php 및 하위 페이지
 * (facilities/index.php, payment/ticket-shops.php, facilities/detail.php?id=1..4)에서
 * 대상 날짜(오늘·내일 및 요청된 날짜)의 식단과 사진을 실시간 수집한다.
 */
export async function crawlHomeAndSubpages(
  targetDates: string[],
  options?: {
    rootDir?: string;
    allowWriteAssets?: boolean;
    silent?: boolean;
  },
): Promise<{
  items: MealItem[];
  cafeterias: CafeteriaInfo[];
  dbRecords: MealPhotoDbRecord[];
  source: string;
}> {
  const rootDir = options?.rootDir ?? process.cwd();
  const publicMealsDir = join(rootDir, 'public', 'meals');
  const allowWriteAssets = options?.allowWriteAssets ?? true;
  const log = options?.silent ? () => {} : console.log;

  const allowedDates = new Set(targetDates);
  const collectedItems: MealItem[] = [];
  const cafeteriaMap = new Map<Cafeteria, CafeteriaInfo>();

  log(`· 시도: ${HOME_URL} 및 하위 페이지 (대상 날짜: ${targetDates.join(', ')})`);

  // 1단계: 메인 페이지(home.php) 및 주요 하위 페이지(facilities/index.php, payment/ticket-shops.php) 병렬 수집
  const [homeRes, facIndexRes, ticketShopsRes] = await Promise.allSettled([
    fetchText(HOME_URL),
    fetchText(FACILITIES_INDEX_URL),
    fetchText(TICKET_SHOPS_URL),
  ]);

  if (homeRes.status !== 'fulfilled' && facIndexRes.status !== 'fulfilled') {
    const reason =
      homeRes.status === 'rejected'
        ? homeRes.reason instanceof Error
          ? homeRes.reason.message
          : String(homeRes.reason)
        : '메인 및 하위 페이지 응답 실패';
    throw new Error(reason);
  }

  const facilityTargets = new Map<number, { id: number; cafeteria: Cafeteria; name: string }>();
  for (const def of DEFAULT_FACILITY_IDS) {
    facilityTargets.set(def.id, def);
  }

  if (homeRes.status === 'fulfilled') {
    const homeParsed = parseHomePhp(homeRes.value);
    for (const item of homeParsed.items) {
      if (allowedDates.has(item.date)) {
        collectedItems.push(item);
      }
    }
    for (const f of homeParsed.facilities) {
      facilityTargets.set(f.id, { id: f.id, cafeteria: f.cafeteria, name: f.name });
    }
  }

  if (facIndexRes.status === 'fulfilled') {
    const indexCafeterias = parseFacilitiesIndexPhp(facIndexRes.value);
    for (const info of indexCafeterias) {
      facilityTargets.set(info.facilityId, {
        id: info.facilityId,
        cafeteria: info.cafeteria,
        name: info.name,
      });
      const prev = cafeteriaMap.get(info.cafeteria);
      cafeteriaMap.set(info.cafeteria, prev ? mergeCafeteriaInfo(prev, info) : info);
    }
  }

  if (ticketShopsRes.status === 'fulfilled') {
    for (const id of parseSubpageFacilityIds(ticketShopsRes.value)) {
      if (!facilityTargets.has(id)) {
        const caf = toCafeteria('', id);
        if (caf) facilityTargets.set(id, { id, cafeteria: caf, name: '' });
      }
    }
  }

  // 2단계: 구내식당별 상세 하위 페이지(facilities/detail.php?id=...&date=...&view=daily) 병렬 크롤링
  const detailTasks: { fac: { id: number; cafeteria: Cafeteria; name: string }; date: string; url: string }[] = [];
  for (const fac of facilityTargets.values()) {
    for (const targetDate of targetDates) {
      detailTasks.push({
        fac,
        date: targetDate,
        url: `${DETAIL_URL}?id=${fac.id}&date=${targetDate}&view=daily`,
      });
    }
  }

  const detailResults = await Promise.allSettled(
    detailTasks.map(async (task) => {
      const detailHtml = await fetchText(task.url);
      return {
        task,
        parsed: parseDetailPhp(detailHtml, task.date, task.fac.id, task.fac.cafeteria),
      };
    }),
  );

  for (const res of detailResults) {
    if (res.status === 'fulfilled') {
      const { items, weeklyItems, cafeteriaInfo } = res.value.parsed;
      for (const item of items) {
        if (allowedDates.has(item.date)) {
          collectedItems.push(item);
        }
      }
      for (const wItem of weeklyItems) {
        if (allowedDates.has(wItem.date)) {
          collectedItems.push(wItem);
        }
      }
      if (cafeteriaInfo) {
        const prev = cafeteriaMap.get(cafeteriaInfo.cafeteria);
        cafeteriaMap.set(
          cafeteriaInfo.cafeteria,
          prev ? mergeCafeteriaInfo(prev, cafeteriaInfo) : cafeteriaInfo,
        );
      }
    } else {
      const msg = res.reason instanceof Error ? res.reason.message : String(res.reason);
      log(`  ⚠ 하위 상세 페이지 수집 건너뜀: ${msg}`);
    }
  }

  // 대상 날짜 식단만 남기고 코너별 ID 부여 (사진이 있는 항목 우선 보존)
  const mergedItems = assignCornerIds(
    collectedItems.filter((item) => allowedDates.has(item.date)),
  );

  if (mergedItems.length === 0) {
    throw new Error(`대상 날짜(${targetDates.join(', ')}) 식단이 0건입니다.`);
  }

  // 3단계: 식단 사진 병렬 다운로드 및 DB 저장용(MealPhotoDbRecord) 매핑
  const dbRecords: MealPhotoDbRecord[] = [];
  const syncedAt = new Date().toISOString();
  const existingDbMap = new Map<string, MealPhotoDbRecord>();
  if (allowWriteAssets) {
    for (const r of readMealPhotoDb()) {
      existingDbMap.set(r.mealItemId, r);
    }
  }

  await Promise.all(
    mergedItems.map(async (item) => {
      if (!item.imageSourceUrl) {
        item.imageUrl = null;
        item.imageSourceUrl = null;
        return;
      }

      if (allowWriteAssets) {
        const downloaded = await downloadMealImage(
          item.imageSourceUrl,
          item.id,
          publicMealsDir,
          existingDbMap.get(item.id),
        );
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
    }),
  );

  dbRecords.sort((a, b) => a.mealItemId.localeCompare(b.mealItemId));

  return {
    items: mergedItems,
    cafeterias: [...cafeteriaMap.values()],
    dbRecords,
    source: HOME_URL,
  };
}

function readJsonFile<T>(dataDir: string, file: string): T | null {
  const p = join(dataDir, file);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as T;
  } catch {
    return null;
  }
}

export interface RunCrawlOptions {
  /** 기준일 (생략 시 KST 오늘) */
  baseDate?: string;
  /** 추가로 함께 수집할 날짜 목록 */
  extraDates?: string[];
  /** 네트워크 요청 생략 여부 (테스트용) */
  offline?: boolean;
  /** 결과 저장 경로 (기본: data/meals.json) */
  outPath?: string;
  /** 프로젝트 루트 경로 (기본: process.cwd()) */
  rootDir?: string;
  /** 콘솔 로그 숨김 여부 */
  silent?: boolean;
}

/**
 * 크롤링을 수행하고 결과(CrawlResult)를 파일에 기록한 뒤 반환한다.
 * 실패 시에도 예외를 던지지 않고 캐시 또는 시드 폴백 결과를 기록·반환한다.
 */
export async function runMealCrawler(options: RunCrawlOptions = {}): Promise<CrawlResult> {
  const rootDir = options.rootDir ?? process.cwd();
  const dataDir = join(rootDir, 'data');
  const outPath = options.outPath ? resolve(options.outPath) : join(dataDir, 'meals.json');
  const isDefaultOut = !options.outPath;
  const log = options.silent ? () => {} : console.log;

  const today = options.baseDate ?? kstToday();
  const tomorrow = addDays(today, 1);
  const targetDates = [...new Set([today, tomorrow, ...(options.extraDates ?? [])])];

  const attempts: string[] = [];
  let result: CrawlResult | null = null;

  if (!options.offline) {
    try {
      const { items, cafeterias, dbRecords, source } = await crawlHomeAndSubpages(targetDates, {
        rootDir,
        allowWriteAssets: isDefaultOut,
        silent: options.silent,
      });
      result = {
        ok: true,
        fetchedAt: new Date().toISOString(),
        source,
        items,
        cafeterias,
      };
      if (isDefaultOut && dbRecords.length > 0) {
        const totalDb = upsertMealPhotoDb(dbRecords);
        log(
          `  ✓ 식단 사진 매칭 DB(data/meal-photo-db.json) 저장 완료 — 금회 ${dbRecords.length}건 (누적 ${totalDb.length}건)`,
        );
      }
      log(`  ✓ 성공 — 대상(${targetDates.join(', ')}) 식단 총 ${items.length}건`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      attempts.push(`${HOME_URL} → ${msg}`);
      log(`  ✗ 실패 — ${msg}`);
    }
  } else {
    attempts.push('--offline 플래그로 네트워크 요청을 건너뛰었습니다');
  }

  if (!result) {
    const prev = readJsonFile<CrawlResult>(dataDir, 'meals.json');
    const cached =
      prev && prev.ok && Array.isArray(prev.items) && prev.items.length > 0 ? prev : null;

    if (cached) {
      result = {
        ...cached,
        ok: false,
        fetchedAt: new Date().toISOString(),
        error: `크롤링 실패 — 직전 성공분을 그대로 씁니다. ${attempts.join(' | ')}`,
        fallback: 'cache',
      };
      log(`· 폴백: 캐시 ${cached.items.length}건`);
    } else {
      const seed = readJsonFile<{ items: MealItem[] }>(dataDir, 'meals.seed.json')?.items ?? [];
      result = {
        ok: false,
        fetchedAt: new Date().toISOString(),
        source: 'seed:data/meals.seed.json',
        items: seed,
        error: `크롤링 실패 — 시드 데이터로 대체했습니다. ${attempts.join(' | ')}`,
        fallback: seed.length > 0 ? 'seed' : undefined,
      };
      log(`· 폴백: 시드 ${seed.length}건`);
    }
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

  log(
    `\n→ ${relative(rootDir, outPath)} 저장 (ok=${result.ok}${result.fallback ? `, fallback=${result.fallback}` : ''}, items=${result.items.length})`,
  );
  if (!result.ok) {
    log('  화면에는 "식단을 못 가져왔습니다(시드 데이터 표시 중)" 배지가 떠야 합니다.');
  }

  return result;
}

