import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requestMealSync } from '../../dex/meal/catalog.ts';
import { nothingNewPublished } from '../pipeline.ts';

test('requestMealSync posts the chosen date and reports failures without throwing', async () => {
  const calls: [string, RequestInit][] = [];
  const reply = (body: unknown) => (async (url: string, init: RequestInit) => { calls.push([url, init]); return Response.json(body); }) as unknown as typeof fetch;
  assert.deepEqual(await requestMealSync('2026-11-28', { fetcher: reply({ ok: true, data: { items: 3 } }) }), { ok: true });
  assert.deepEqual([calls[0][0], calls[0][1].method, calls[0][1].body], ['/api/meals/sync', 'POST', JSON.stringify({ date: '2026-11-28' })]);
  const busy = await requestMealSync('2026-11-28', { fetcher: reply({ ok: false, error: '다른 관측 수집이 진행 중입니다.' }) });
  assert.ok(!busy.ok && busy.error.includes('다른 관측 수집이 진행 중'));
  assert.equal((await requestMealSync('2026-11-28', { fetcher: (async () => { throw Error('offline'); }) as unknown as typeof fetch })).ok, false);
});

test('a run where the site published nothing (weekend) is not a failure; network or parse problems are', () => {
  const run = (...issues: string[]) => '정상 관측된 메뉴·명시적 휴무가 없어 이전 저장본 유지: ' + issues.join('; ');
  assert.equal(nothingNewPublished(run('2026-11-28 haksik: empty-unknown', '2026-11-28 faculty: empty-unknown')), true);
  assert.equal(nothingNewPublished(run('2026-11-28 haksik: empty-unknown', '2026-11-28 dorm: HTTP 500')), false);
  assert.equal(nothingNewPublished(run('2026-11-28 haksik: parse-error')), false);
  assert.equal(nothingNewPublished('fetch failed'), false);
  assert.equal(nothingNewPublished(undefined), false);
});

test('POST /api/meals/sync rejects bad dates before any request and keeps the snapshot when the site is unreachable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bokak-meal-sync-route-'));
  const env = process.env as Record<string, string | undefined>, saved = [env.MEALS_STORAGE_DIR, env.MEALS_OBSERVATIONS_DIR], realFetch = globalThis.fetch;
  env.MEALS_STORAGE_DIR = join(dir, 'sync');
  env.MEALS_OBSERVATIONS_DIR = join(dir, 'observations');
  let fetches = 0;
  globalThis.fetch = (async () => { fetches++; throw Error('network forbidden'); }) as typeof fetch;
  try {
    const { POST } = await import('../../../app/api/meals/sync/route.ts');
    const post = (body: unknown) => POST(new Request('http://test/api/meals/sync', { method: 'POST', body: JSON.stringify(body) }));
    for (const body of [{}, { date: '2026-02-30' }, { date: 20261128 }]) assert.equal((await post(body)).status, 400);
    assert.equal(fetches, 0, 'invalid input never reaches the school site');
    const response = await post({ date: '2026-11-28' });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).ok, false);
    assert.equal(fetches, 1, 'the robots check fails, so no menu page is requested');
  } finally {
    globalThis.fetch = realFetch;
    [env.MEALS_STORAGE_DIR, env.MEALS_OBSERVATIONS_DIR] = saved;
    if (saved[0] === undefined) delete env.MEALS_STORAGE_DIR;
    if (saved[1] === undefined) delete env.MEALS_OBSERVATIONS_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
});
