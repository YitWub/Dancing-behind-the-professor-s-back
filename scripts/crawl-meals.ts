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
 *   가짜 데이터를 진짜인 척 보여주느니 "못 가져왔다"고 말하는 쪽을 택한다.
 *
 * ── 2026-09-23 조사 결과 ────────────────────────────────────────────────
 *   ERICA 캠퍼스 학식은 HY-SQUARE 포털(life.hanyang.ac.kr)이 담당한다.
 *   그런데 현재 이 포털은 Phase 1 디자인 시스템 단계로,
 *   식단이 서버 API 가 아니라 클라이언트의 mock-data.js 에 박혀 있다.
 *   (해당 파일 주석: "MOCK — DB 연동 시 /api/cafeteria/menus 응답으로 교체")
 *   실제로 /api/cafeteria/menus 를 호출하면 404 가 돌아온다.
 *   서울 캠퍼스용 fnb.hanyang.ac.kr 에는 ERICA 식단이 없다.
 *   → 즉 "공개된 파싱 가능한 ERICA 식단 엔드포인트가 현재 존재하지 않는다."
 *   파서는 API 가 열렸을 때 바로 동작하도록 JSON/HTML 양쪽을 다 구현해 두었고,
 *   지금은 매번 폴백 경로를 타게 된다. 이게 정직한 상태다.
 * ────────────────────────────────────────────────────────────────────────
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Cafeteria, CrawlResult, MealItem, MealTime } from '../lib/types.ts';
import { kstToday } from '../lib/datetime.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');

const TIMEOUT_MS = 12_000;

/** 후보 엔드포인트. 위에서부터 시도하고, 처음 성공한 것을 쓴다. */
const ENDPOINTS = [
  {
    url: 'https://life.hanyang.ac.kr/api/cafeteria/menus',
    kind: 'json' as const,
    note: 'HY-SQUARE(ERICA) 식단 API — 2026-09 현재 미구현(404)',
  },
  {
    url: 'https://life.hanyang.ac.kr/theme/pages/facilities/index.php',
    kind: 'html' as const,
    note: 'HY-SQUARE 시설/식당 페이지 — 현재 식단은 클라이언트 mock 데이터',
  },
];

/* ── 식당명 → Cafeteria 매핑 ────────────────────────────────────────────── */

const CAFETERIA_ALIASES: [RegExp, Cafeteria][] = [
  [/창업보육|창보|이푸른/, 'changbo'],
  [/창의인재원|기숙사|생활관|창의관/, 'dorm'],
  [/교직원|교수|faculty/i, 'faculty'],
  [/학생식당|학식|복지관|웰스토리/, 'haksik'],
];

function toCafeteria(name: string): Cafeteria | null {
  for (const [re, id] of CAFETERIA_ALIASES) if (re.test(name)) return id;
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

/* ── 파서 ───────────────────────────────────────────────────────────────── */

function normalizeMenu(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean);
  if (typeof raw === 'string') {
    return raw
      .split(/[\n,·>/]|<br\s*\/?>/i)
      .map((s) => s.replace(/<[^>]*>/g, '').trim())
      .filter(Boolean);
  }
  return [];
}

/** 대표 메뉴명은 원본이 줄 때만 쓴다. 빈 문자열은 "모른다"와 같다 → null */
function strOrNull(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
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

    const date = typeof r.date === 'string' ? r.date.slice(0, 10) : null;
    const cafeteria = toCafeteria(String(r.restaurant ?? r.cafeteria ?? r.place ?? ''));
    const mealTime = toMealTime(String(r.mealTime ?? r.meal_time ?? r.course ?? r.type ?? ''));
    const menu = normalizeMenu(r.items ?? r.menu ?? r.dishes);

    if (!date || !cafeteria || !mealTime || menu.length === 0) continue;
    out.push({
      id: `${date}-${cafeteria}-${mealTime}`,
      date,
      cafeteria,
      mealTime,
      name: strOrNull(r.name ?? r.menuName ?? r.title),
      menu,
      price: numOrNull(r.price),
      kcal: numOrNull(r.kcal ?? r.calorie ?? r.kilocalorie),
    });
  }
  return dedupe(out);
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
        .replace(/<br\s*\/?>/gi, '\n')   // 줄바꿈을 먼저 살린 뒤 태그를 지운다
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .trim(),
    );
    if (cells.length < 2) continue;

    const header = cells[0];
    const cafeteria = toCafeteria(header);
    // 끼니가 헤더에 있으면 메뉴는 1번 셀부터, 별도 셀에 있으면 2번 셀부터
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
    });
  }
  return dedupe(out);
}

function dedupe(items: MealItem[]): MealItem[] {
  const seen = new Map<string, MealItem>();
  for (const item of items) if (!seen.has(item.id)) seen.set(item.id, item);
  return [...seen.values()];
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

/* ── 실행 ───────────────────────────────────────────────────────────────── */

async function fetchOne(
  endpoint: (typeof ENDPOINTS)[number],
  date: string,
): Promise<{ items: MealItem[]; url: string }> {
  const url = `${endpoint.url}${endpoint.url.includes('?') ? '&' : '?'}date=${date}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // 봇임을 숨기지 않는다. robots/ToS 를 존중하고 가벼운 요청만 보낸다.
        // HTTP 헤더는 ByteString(latin1)이라 한글을 넣으면 fetch 가 던진다 — ASCII 로만.
        'User-Agent': 'erica-life-meal-bot/0.1 (Hanyang ERICA class project; contact via repo)',
        Accept: endpoint.kind === 'json' ? 'application/json' : 'text/html',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const body = await res.text();
    const items =
      endpoint.kind === 'json' ? parseJsonMenus(JSON.parse(body)) : parseHtmlMenus(body, date);
    if (items.length === 0) throw new Error('응답은 받았지만 파싱된 식단이 0건입니다');
    return { items, url };
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dateArg = args.find((a) => a.startsWith('--date='))?.slice('--date='.length);
  const offline = args.includes('--offline');
  // 출력 경로 재지정 (테스트/드라이런용). 기본은 data/meals.json
  const outArg = args.find((a) => a.startsWith('--out='))?.slice('--out='.length);
  const outPath = outArg ? resolve(outArg) : join(DATA, 'meals.json');
  const date = dateArg ?? kstToday(); // UTC 가 아니라 KST 기준 오늘

  const attempts: string[] = [];
  let result: CrawlResult | null = null;

  if (!offline) {
    for (const endpoint of ENDPOINTS) {
      try {
        console.log(`· 시도: ${endpoint.url}`);
        const { items, url } = await fetchOne(endpoint, date);
        result = { ok: true, fetchedAt: new Date().toISOString(), source: url, items };
        console.log(`  ✓ 성공 — ${items.length}건`);
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        attempts.push(`${endpoint.url} → ${msg} (${endpoint.note})`);
        console.log(`  ✗ 실패 — ${msg}`);
      }
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
const isEntrypoint = process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

/**
 * ★종료코드 계약 (CONTRACT.md 8장) — 함부로 바꾸지 말 것
 *
 *   **크롤 실패는 exit code 가 아니라 `CrawlResult.ok=false` 로 표현한다.**
 *   exit code 는 "스크립트가 제 일을 했는가"이지 "크롤링이 성공했는가"가 아니다.
 *
 * 왜 중요한가: `demo:refresh` / `data:all` 이 `npm run crawl && npm run score` 로 엮여 있다.
 * 크롤 실패(=지금 기본 상태, 404)에 non-zero 로 끝내면 `&&` 가 거기서 끊겨
 * **`npm run score` 가 조용히 실행되지 않는다.** 발표자는 돌렸다고 믿는데
 * lectures.json 만 갱신이 안 되고, 에러도 안 나서 알아차릴 방법이 없다.
 *
 * "크롤링이 실패했는데 왜 0으로 끝나지?" 는 그럴듯한 수정이라 더 위험하다.
 * 이 계약은 lib/meal/__tests__/crawl-exit-contract.test.ts 가 지킨다.
 */
if (isEntrypoint) {
  main()
    .catch((err) => {
      // 크롤러 자체가 예외로 죽어도 파일은 남긴다.
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
        // 파일조차 못 쓰는 상황(권한·디스크)이어도 체인은 끊지 않는다.
        // 앱은 store.ts 가 시드로 폴백하므로 여전히 살아 있다.
        console.error('폴백 파일 기록도 실패했습니다:', writeErr);
      }
    })
    .finally(() => {
      // 위 계약: 어떤 경로로도 non-zero 로 끝나지 않는다.
      process.exitCode = 0;
    });
}
