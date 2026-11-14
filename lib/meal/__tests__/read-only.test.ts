import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { CrawlResult, MealItem } from '../../types.ts';
import { mealReadStatus, mealDataNotice } from '../status.ts';

const item: MealItem = {
  id: '2026-11-03-haksik-lunch', date: '2026-11-03', cafeteria: 'haksik',
  mealTime: 'lunch', name: '제육볶음', menu: ['밥'], price: 4500, kcal: null,
};
const stored: CrawlResult = {
  ok: true, fetchedAt: '2026-11-03T01:00:00Z', source: 'https://example.test/menu', items: [item],
};

test('수집 상태는 오래됨/불명/예시를 구분하고 성공 시각을 꾸며내지 않는다', () => {
  const now = Date.parse('2026-11-03T02:00:00Z');
  assert.equal(mealReadStatus(stored, now).dataState, 'stored');
  assert.equal(mealReadStatus(stored, now + 24 * 3600000).dataState, 'stale');
  const cached = mealReadStatus({ ...stored, ok: false, fallback: 'cache' }, now);
  assert.equal(cached.dataState, 'cache');
  assert.equal(cached.lastSuccessfulFetchAt, null);
  assert.equal(cached.lastAttemptAt, stored.fetchedAt);
  for (const fetchedAt of ['', 'invalid', '2099-01-01T00:00:00Z']) {
    const status = mealReadStatus({ ...stored, fetchedAt }, now);
    assert.equal(status.dataState, 'unknown');
    assert.equal(status.lastSuccessfulFetchAt, null);
  }
  const seed = { ...stored, ok: false, fallback: 'seed' as const };
  assert.equal(mealReadStatus(seed, now).dataState, 'seed');
  assert.equal(mealReadStatus({ ...seed, items: [] }, now).dataState, 'missing');
  assert.match(mealDataNotice(seed), /예시 데이터.*실제 학식 메뉴가 아닙니다/);
  assert.match(mealDataNotice(stored), /마지막 성공 수집:.*2026/);
});

for (const mode of ['stored', 'cache', 'seed', 'missing', 'corrupt'] as const) {
  test(`${mode}: 서버 시작·GET·refresh·호환 래퍼가 네트워크/데이터 쓰기를 하지 않는다`, () => {
    const root = mkdtempSync(join(tmpdir(), 'bokak-read-only-'));
    try {
      mkdirSync(join(root, 'data'));
      mkdirSync(join(root, 'public', 'meals'), { recursive: true });
      writeFileSync(join(root, 'public', 'meals', 'sentinel.jpg'), 'unchanged image');
      writeFileSync(join(root, 'data', 'meal-photo-db.json'), '{"records":[]}');
      writeFileSync(join(root, 'data', 'meal-reviews.json'), '{"reviews":[]}');
      if (mode !== 'missing') {
        writeFileSync(join(root, 'data', 'meals.seed.json'), JSON.stringify({ items: [item] }));
      }
      if (mode === 'stored' || mode === 'cache') {
        writeFileSync(join(root, 'data', 'meals.json'), JSON.stringify(mode === 'cache'
          ? { ...stored, ok: false, fallback: 'cache' } : stored));
      }
      if (mode === 'corrupt') writeFileSync(join(root, 'data', 'meals.json'), '{broken');
      const script = `
        import { strict as assert } from 'node:assert';
        import { readdirSync, readFileSync } from 'node:fs';
        import { join } from 'node:path';
        import { createHash } from 'node:crypto';
        const snapshot = (dir = '.') => readdirSync(dir, {withFileTypes:true}).flatMap(e => {
          const path = join(dir, e.name);
          return e.isDirectory() ? snapshot(path) : [[path, createHash('sha256').update(readFileSync(path)).digest('hex')]];
        }).sort((a,b)=>a[0].localeCompare(b[0]));
        const before = snapshot();
        Date.now = () => Date.parse('2026-11-05T01:00:00Z');
        let fetches = 0;
        globalThis.fetch = async () => { fetches++; throw Error('Network forbidden'); };
        process.env.NEXT_RUNTIME = 'nodejs';
        const { register } = await import(${JSON.stringify(new URL('../../../instrumentation.ts', import.meta.url).href)});
        await register();
        const store = await import(${JSON.stringify(new URL('../store.ts', import.meta.url).href)});
        const meals = await import(${JSON.stringify(new URL('../../../app/api/meals/route.ts', import.meta.url).href)});
        const status = await import(${JSON.stringify(new URL('../../../app/api/meals/status/route.ts', import.meta.url).href)});
        const battle = await import(${JSON.stringify(new URL('../../../app/api/meals/battle/route.ts', import.meta.url).href)});
        for (const refresh of ['', '&refresh=1']) {
          const request = { nextUrl: new URL('http://localhost/api/meals?date=2026-11-03'+refresh) };
          const response = await meals.GET(request);
          assert.equal(response.status, 200);
          assert.equal(response.headers.get('x-meal-read-only'), 'true');
          assert.equal(response.headers.get('cache-control'), 'no-store');
          const body = await response.json();
          assert.equal(body.ok, true);
          assert.ok(Array.isArray(body.data));
          const stateResponse = await status.GET(request);
          const stateBody = await stateResponse.json();
          assert.equal(stateBody.data.readOnly, true);
          assert.equal(stateBody.data.dataState, ${JSON.stringify(mode === 'stored' ? 'stale' : mode === 'corrupt' ? 'seed' : mode)});
          if (${JSON.stringify(mode)} !== 'stored') assert.equal(stateBody.data.lastSuccessfulFetchAt, null);
          if (${JSON.stringify(mode)} === 'missing') assert.equal(stateBody.data.fetchedAt, '');
          const battleResponse = await battle.GET(request);
          assert.equal(battleResponse.status, 200);
          assert.equal((await battleResponse.json()).ok, true);
        }
        const invalid = { nextUrl: new URL('http://localhost/api/meals?date=2026-02-30&refresh=1') };
        assert.equal((await meals.GET(invalid)).status, 400);
        assert.equal((await battle.GET({nextUrl:new URL('http://localhost/api/meals/battle?mealTime=invalid')})).status,400);
        await store.ensureFreshMealCrawl({ force:true });
        await store.ensureFreshMealsByDate('2026-11-03', { force:true });
        await store.ensureFreshBattle('2026-11-03', 'lunch', { force:true });
        assert.equal(fetches, 0, 'No external fetch, including caught failures');
        assert.deepEqual(snapshot(), before, 'No changed, deleted, or new files');
      `;
      const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '--eval', script], {
        cwd: root, encoding: 'utf8', timeout: 30000,
      });
      assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
