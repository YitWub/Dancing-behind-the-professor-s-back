import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { syncTodayIfStale } from '../auto-sync.ts';
import type { CrawlResult } from '../../types.ts';

test('only a stale read of today crawls, once per concurrent burst and at most every 30 minutes', async () => {
  const now = Date.parse('2026-11-20T01:00:00Z'); // KST 10:00
  const read = (fetchedAt: string) => () => ({ fetchedAt }) as CrawlResult;
  let runs = 0;
  const run = async () => { runs++; };
  await syncTodayIfStale('2026-11-19', { now, read: read(''), run });
  assert.equal(runs, 0, 'other dates stay read-only');
  await syncTodayIfStale('2026-11-20', { now, read: read('2026-11-19T23:30:00Z'), run });
  assert.equal(runs, 0, 'already fetched today (KST 08:30)');
  await Promise.all([1, 2, 3].map(() => syncTodayIfStale('2026-11-20', { now, read: read('2026-11-19T10:00:00Z'), run })));
  assert.equal(runs, 1, 'stale: concurrent reads share one crawl');
  await syncTodayIfStale('2026-11-20', { now: now + 10 * 60_000, read: read(''), run });
  assert.equal(runs, 1, 'no retry within 30 minutes');
  await syncTodayIfStale('2026-11-20', { now: now + 31 * 60_000, read: read(''), run: async () => { runs++; throw Error('network'); } });
  assert.equal(runs, 2, 'retries after 30 minutes and swallows failure');
});
