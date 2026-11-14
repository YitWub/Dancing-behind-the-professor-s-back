/**
 * scripts/crawl-meals.ts — 한양대 ERICA 학식 크롤러 CLI 진입점
 *
 *   node scripts/crawl-meals.ts [--date=YYYY-MM-DD] [--offline] [--out=PATH]
 *
 * ★설계 원칙 — "크롤링이 실패해도 앱은 절대 깨지지 않는다"
 *   크롤 실패도 exit 0이지만 마지막 정상 스냅샷은 교체하지 않는다.
 *   대신 CrawlResult.ok / fallback / error 에 무슨 일이 있었는지 정직하게 적는다.
 *
 *   성공        → ok: true,  fallback 없음
 *   실패 + 캐시 → ok: false, fallback: 'cache'  (직전 성공분 유지)
 *   실패 + 시드 → ok: false, fallback: 'seed'   (화면에 "못 가져왔습니다" 배지)
 *
 * ── 수집 범위 및 DB 연동 설계 ────────────────────────────────────────────
 *   1. https://life.hanyang.ac.kr/theme/pages/home.php 및 하위 페이지
 *      (facilities/index.php, payment/ticket-shops.php, facilities/detail.php?id=1..4)를
 *      실시간 크롤링하여 구내식당별 식단을 가져오되, 기준일(오늘)과 내일 식단을 수집한다.
 *   2. 식단 사진이 존재할 경우 로컬(public/meals/...)에 내려받고,
 *      식단과 매칭된 사진 정보를 data/meal-photo-db.json 에 함께 기록하여
 *      추후 DB(RDBMS/NoSQL)에 그대로 적재할 수 있도록 설계한다.
 *      사진이 없는 식단은 imageUrl: null, imageSourceUrl: null 로 두어
 *      화면에서 '이미지가 없습니다.'를 표시하도록 한다.
 * ────────────────────────────────────────────────────────────────────────
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  crawlHomeAndSubpages,
  parseDetailPhp,
  parseFacilitiesIndexPhp,
  parseHomePhp,
  parseHtmlMenus,
  parseJsonMenus,
  parseSubpageFacilityIds,
  runMealCrawler,
} from '../lib/meal/crawler.ts';

export {
  crawlHomeAndSubpages,
  parseDetailPhp,
  parseFacilitiesIndexPhp,
  parseHomePhp,
  parseHtmlMenus,
  parseJsonMenus,
  parseSubpageFacilityIds,
  runMealCrawler,
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dateArg = args.find((a) => a.startsWith('--date='))?.slice('--date='.length);
  const offline = args.includes('--offline');
  const outArg = args.find((a) => a.startsWith('--out='))?.slice('--out='.length);

  await runMealCrawler({
    baseDate: dateArg,
    offline,
    extraDates:args.filter(a=>a.startsWith('--extra-date=')).map(a=>a.slice('--extra-date='.length)),
    outPath: outArg ? resolve(outArg) : undefined,
    rootDir: ROOT,
  });
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
      console.error('마지막 정상 식단은 교체하지 않았습니다. 수집 로그를 확인하세요.');
    })
    .finally(() => {
      process.exitCode = 0;
    });
}
