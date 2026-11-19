import { kstToday } from '../datetime.ts';
import { runMealDataPipeline } from './pipeline.ts';
import { readMealCrawl } from './store.ts';

const RETRY_MS = 30 * 60_000;
let running: Promise<unknown> | null = null;
let lastTry = -Infinity;

/**
 * System-date auto crawl: a read for today's (KST) menus crawls today once when the stored data was not fetched today.
 * Concurrent reads share one run; failures and closed days retry at most every 30 minutes. Other dates stay read-only.
 */
export async function syncTodayIfStale(date: string, deps: { now?: number; read?: typeof readMealCrawl; run?: () => Promise<unknown> } = {}) {
  const now = deps.now ?? Date.now();
  if (date !== kstToday(new Date(now))) return;
  const fetched = Date.parse((deps.read ?? readMealCrawl)().fetchedAt);
  if (Number.isFinite(fetched) && kstToday(new Date(fetched)) === date) return;
  if (!running && now - lastTry >= RETRY_MS) {
    lastTry = now;
    running = (deps.run ?? (() => runMealDataPipeline({ rootDir: process.cwd(), dates: [date], silent: true })))()
      .catch(() => null) // the last good snapshot stays; the read below still answers
      .finally(() => { running = null; });
  }
  await running;
}
