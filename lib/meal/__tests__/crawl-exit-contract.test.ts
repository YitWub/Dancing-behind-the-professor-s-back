/**
 * crawl-meals.ts 종료코드 계약 및 식단·사진·평점 요구사항 테스트
 *
 * 지키는 것: **크롤 실패를 exit code 로 표현하지 않는다.**
 *
 * 이 계약이 깨지면 `demo:refresh` / `data:all` 의
 * `npm run crawl && npm run score` 체인이 크롤 실패 지점에서 끊긴다.
 * 그런데 **아무 에러도 안 난다** — 발표자는 돌렸다고 믿는데 lectures.json 만 안 갱신된다.
 *
 * "크롤링이 실패했는데 왜 exit 0 이지?" 는 그럴듯한 수정이라 더 위험하다.
 * 그래서 사람의 기억이 아니라 테스트로 고정한다.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';

import type { CrawlResult, MealItem, MealReview } from '../../types.ts';
import { CAFETERIA_LABELS, MEAL_RATING_OPTIONS, computeBattle, ratingToLabel } from '../battle.ts';
import { toMealPhotoDbRecord } from '../store.ts';
import { parseDetailPhp } from '../../../scripts/crawl-meals.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'crawl-meals.ts');

// 레포의 data/meals.json 을 건드리지 않도록 임시 디렉터리로 출력한다
const workDir = mkdtempSync(join(tmpdir(), 'erica-crawl-'));
after(() => rmSync(workDir, { recursive: true, force: true }));

function runCrawler(extraArgs: string[]): { status: number | null; out: string; outPath: string } {
  const outPath = join(workDir, `meals-${Math.random().toString(36).slice(2)}.json`);
  const res = spawnSync(
    process.execPath,
    ['--experimental-strip-types', SCRIPT, `--out=${outPath}`, ...extraArgs],
    { cwd: ROOT, encoding: 'utf8' },
  );
  return { status: res.status, out: `${res.stdout}${res.stderr}`, outPath };
}

describe('crawl-meals.ts 종료코드 계약', () => {
  it('크롤링이 실패해도 exit 0 으로 끝난다 (&& 체인을 끊지 않기 위해)', () => {
    // --offline 은 네트워크를 건너뛰므로 "반드시 실패하는" 결정론적 경로다
    const { status, out } = runCrawler(['--offline']);
    assert.equal(
      status,
      0,
      `크롤 실패 시 exit ${status} 로 끝났습니다. ` +
        'CONTRACT 8장 위반 — demo:refresh 의 `crawl && score` 체인이 조용히 끊깁니다.\n' +
        `스크립트 출력:\n${out}`,
    );
  });

  it('실패는 exit code 대신 CrawlResult.ok=false 로 표현된다', () => {
    const { outPath } = runCrawler(['--offline']);
    const result = JSON.parse(readFileSync(outPath, 'utf8')) as CrawlResult;

    assert.equal(result.ok, false, '크롤에 실패했으므로 ok 는 false 여야 합니다');
    assert.ok(result.error, '실패 사유가 error 에 기록되어야 합니다');
    assert.ok(
      result.fallback === 'seed' || result.fallback === 'cache',
      `폴백 출처가 표시되어야 합니다 (받은 값: ${String(result.fallback)})`,
    );
  });

  it('실패해도 화면에 내보낼 식단을 비우지 않는다 (앱이 안 깨져야 함)', () => {
    const { outPath } = runCrawler(['--offline']);
    const result = JSON.parse(readFileSync(outPath, 'utf8')) as CrawlResult;

    assert.ok(result.items.length > 0, '폴백 식단이 비어 있으면 화면이 빈 채로 뜹니다');
    assert.ok(
      result.items.every((m) => m.menu.length > 0),
      '메뉴가 빈 항목이 섞여 있습니다',
    );
  });

  it('--out 이 지정되면 레포의 data/meals.json 을 건드리지 않는다', () => {
    const before = readFileSync(join(ROOT, 'data', 'meals.json'), 'utf8');
    runCrawler(['--offline']);
    const after_ = readFileSync(join(ROOT, 'data', 'meals.json'), 'utf8');
    assert.equal(after_, before, '테스트가 레포 데이터를 덮어썼습니다');
  });
});

describe('식단 사진 DB 매칭 및 4버튼 평점 요구사항 검증', () => {
  it('식단 사진이 있을 때만 식단+사진 DB 레코드(MealPhotoDbRecord)가 생성된다', () => {
    const withPhoto: MealItem = {
      id: '2026-11-03-haksik-lunch',
      date: '2026-11-03',
      cafeteria: 'haksik',
      mealTime: 'lunch',
      name: '새우튀김카레라이스',
      menu: ['오이맛고추무침', '배추김치', '일식장국'],
      price: 4500,
      kcal: null,
      imageUrl: '/meals/2026-11-03-haksik-lunch.jpg',
      imageSourceUrl: 'https://life.hanyang.ac.kr/uploads/facilities/menu_1.jpg',
    };
    const withoutPhoto: MealItem = {
      ...withPhoto,
      id: '2026-11-04-haksik-lunch',
      date: '2026-11-04',
      imageUrl: null,
      imageSourceUrl: null,
    };

    const rec = toMealPhotoDbRecord(withPhoto, { mimeType: 'image/jpeg', sizeBytes: 96333 });
    assert.ok(rec !== null, '사진이 있는 식단은 DB 레코드로 변환되어야 합니다');
    assert.equal(rec.mealItemId, '2026-11-03-haksik-lunch');
    assert.equal(rec.photo.imageUrl, '/meals/2026-11-03-haksik-lunch.jpg');
    assert.equal(rec.photo.sizeBytes, 96333);

    const nullRec = toMealPhotoDbRecord(withoutPhoto);
    assert.equal(nullRec, null, '사진이 없는 식단은 사진 DB 레코드에서 제외되어야 합니다');
  });

  it('상세 페이지 파서는 실제 사진과 로고 폴백(사진 없음)을 정확히 구분한다', () => {
    const sampleHtml = `
      <div class="fac-name">학생식당</div>
      <section class="hy-section menu-section">
        <div id="view-pane-daily" class="menu-view-pane">
          <div class="menu-group">
            <div class="menu-group__title"><span class="meal-badge meal-badge--lunch">중식</span></div>
            <div class="menu-grid-2col">
              <div class="menu-card-v">
                <div class="menu-card-v__img-wrap"><img src="/uploads/facilities/menu_abc.jpg" class="menu-card-v__img" alt="메뉴1"></div>
                <div class="menu-card-v__body">
                  <div class="menu-card-v__name">메뉴1</div>
                  <div class="menu-card-v__desc">밥/국/김치</div>
                  <div class="menu-card-v__bottom"><span class="menu-card-v__price">4,500원</span></div>
                </div>
              </div>
              <div class="menu-card-v">
                <div class="menu-card-v__img-wrap"><div class="menu-card-v__fallback"><img src="/theme/assets/img/HYU_logo_singlecolor.svg" alt="한양대학교"></div></div>
                <div class="menu-card-v__body">
                  <div class="menu-card-v__name">메뉴2</div>
                  <div class="menu-card-v__desc">밥/찌개/깍두기</div>
                  <div class="menu-card-v__bottom"><span class="menu-card-v__price">6,500원</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    `;
    const parsed = parseDetailPhp(sampleHtml, '2026-11-03', 1, 'haksik');
    assert.equal(parsed.items.length, 2);
    assert.equal(
      parsed.items[0].imageSourceUrl,
      'https://life.hanyang.ac.kr/uploads/facilities/menu_abc.jpg',
    );
    assert.equal(parsed.items[1].imageSourceUrl, null);
    assert.equal(parsed.items[1].imageUrl, null);
  });

  it('4단계 평점 버튼(좋좋, 느좋, 안좋, 좆)이 정의되어 있고 점수와 매핑된다', () => {
    assert.deepEqual(
      MEAL_RATING_OPTIONS.map((o) => o.label),
      ['좋좋', '느좋', '안좋', '좆'],
    );
    assert.equal(ratingToLabel(5), '좋좋');
    assert.equal(ratingToLabel(4), '느좋');
    assert.equal(ratingToLabel(2), '안좋');
    assert.equal(ratingToLabel(1), '좆');
    assert.equal(CAFETERIA_LABELS.dorm, '기숙사식당');
  });

  it('하나의 구내식당에 식단 메뉴가 2개 이상이면 가장 높은 평점의 식단 메뉴로 비교한다', () => {
    const items: MealItem[] = [
      {
        id: '2026-11-03-haksik-lunch',
        date: '2026-11-03',
        cafeteria: 'haksik',
        mealTime: 'lunch',
        name: '메뉴 A (낮은 평점)',
        menu: ['밥', '국'],
        price: 4500,
        kcal: null,
      },
      {
        id: '2026-11-03-haksik-lunch-2',
        date: '2026-11-03',
        cafeteria: 'haksik',
        mealTime: 'lunch',
        name: '메뉴 B (높은 평점)',
        menu: ['특식', '샐러드'],
        price: 6500,
        kcal: null,
      },
      {
        id: '2026-11-03-changbo-lunch',
        date: '2026-11-03',
        cafeteria: 'changbo',
        mealTime: 'lunch',
        name: '창보 메뉴',
        menu: ['돈까스'],
        price: 6500,
        kcal: null,
      },
    ];

    const reviews: MealReview[] = [
      // 학식 메뉴 A: 평균 1.4 (5건)
      ...[1, 1, 2, 1, 2].map((rating, i) => ({
        id: `ra-${i}`,
        mealItemId: '2026-11-03-haksik-lunch',
        rating,
        text: '별로',
        createdAt: '2026-11-03T12:00:00Z',
        nickname: '익명',
      })),
      // 학식 메뉴 B: 평균 4.8 (5건)
      ...[5, 5, 5, 4, 5].map((rating, i) => ({
        id: `rb-${i}`,
        mealItemId: '2026-11-03-haksik-lunch-2',
        rating,
        text: '최고',
        createdAt: '2026-11-03T12:05:00Z',
        nickname: '익명',
      })),
      // 창보 메뉴: 평균 3.6 (5건)
      ...[4, 4, 3, 4, 3].map((rating, i) => ({
        id: `rc-${i}`,
        mealItemId: '2026-11-03-changbo-lunch',
        rating,
        text: '무난',
        createdAt: '2026-11-03T12:10:00Z',
        nickname: '익명',
      })),
    ];

    const battle = computeBattle({
      date: '2026-11-03',
      mealTime: 'lunch',
      items,
      reviews,
    });

    const haksikStanding = battle.standings.find((s) => s.cafeteria === 'haksik');
    assert.ok(haksikStanding);
    // 두 메뉴를 합산하면 (1.4 + 4.8)/2 = 3.1 이 되어 창보(3.6)에 지지만,
    // 가장 높은 식단 메뉴(메뉴 B, 평균 4.8)로 비교하므로 학식 평균은 4.8이고 학식이 판정승해야 한다.
    assert.equal(haksikStanding.avgRating, 4.8);
    assert.equal(haksikStanding.reviewCount, 5);
    assert.equal(battle.winner, 'haksik');
    assert.equal(battle.decisive, true);
  });
});
