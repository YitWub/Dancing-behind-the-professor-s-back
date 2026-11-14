import type { CrawlResult } from '../types.ts';
import type { StoredCrawl } from './sync-store.ts';

export type MealDataState = 'stored' | 'stale' | 'cache' | 'seed' | 'missing' | 'unknown';
export interface MealReadStatus {
  readOnly: true;
  dataState: MealDataState;
  lastSuccessfulFetchAt: string | null;
  lastAttemptAt: string | null;
  lastSyncError?: string;
}

/** 저장 상태이며 현재 메뉴의 정확성이나 실시간 수집 성공을 보장하지 않는다. */
export function mealReadStatus(crawl: CrawlResult, now = Date.now()): MealReadStatus {
  const time = Date.parse(crawl.fetchedAt);
  const valid = Number.isFinite(time) && time <= now;
  const seed = crawl.fallback === 'seed' || crawl.source.startsWith('seed:');
  const success = crawl.ok && !seed && valid;
  const attempt=(crawl as StoredCrawl).syncStatus;
  const attemptValid=!!attempt&&Number.isFinite(Date.parse(attempt.at))&&Date.parse(attempt.at)<=now&&(!valid||Date.parse(attempt.at)>=time);
  const dataState: MealDataState = seed
    ? (crawl.items.length ? 'seed' : 'missing')
    : crawl.fallback === 'cache' ? 'cache'
    : !success ? 'unknown'
    : now - time >= 24 * 60 * 60 * 1000 ? 'stale' : 'stored';
  return {
    readOnly: true,
    dataState,
    lastSuccessfulFetchAt: success ? crawl.fetchedAt : null,
    // cache의 fetchedAt은 실패 시도 시각이므로 성공 시각으로 사용하지 않는다.
    lastAttemptAt: attemptValid?attempt!.at:valid ? crawl.fetchedAt : null,
    ...(attemptValid&&!attempt!.ok?{lastSyncError:attempt!.error??'최근 자동 수집에 실패했습니다.'}:{}),
  };
}

export function mealReadHeaders(crawl: CrawlResult): Record<string, string> {
  const state = mealReadStatus(crawl);
  return {
    'Cache-Control': 'no-store',
    'X-Meal-Ok': String(crawl.ok),
    'X-Meal-Fallback': crawl.fallback ?? 'none',
    'X-Meal-Fetched-At': crawl.fetchedAt,
    'X-Meal-Read-Only': 'true',
    'X-Meal-State': state.dataState,
    'X-Meal-Last-Successful-Fetch-At': state.lastSuccessfulFetchAt ?? '',
    'X-Meal-Last-Attempt-At': state.lastAttemptAt ?? '',
  };
}

/** 기존 화면의 출처 안내용. 시드/캐시의 시도를 성공 수집 시각으로 표시하지 않는다. */
export function mealDataNotice(crawl: CrawlResult): string {
  const status = mealReadStatus(crawl);
  const labels: Record<MealDataState, string> = {
    stored: '저장본 · 실시간 수집 아님',
    stale: '오래된 저장본 · 수집 후 24시간 이상 경과',
    cache: '수집 실패 후 보관된 캐시 · 실제 메뉴 확인 필요',
    seed: '예시 데이터 · 실제 학식 메뉴가 아닙니다',
    missing: '저장된 학식 데이터 없음',
    unknown: '수집 상태 확인 불가 · 실제 메뉴 확인 필요',
  };
  const successful = status.lastSuccessfulFetchAt;
  const timestamp = successful
    ? new Date(successful).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) + ' KST'
    : '확인 불가';
  const attempt = !successful && status.lastAttemptAt
    ? ` · 마지막 수집 시도: ${new Date(status.lastAttemptAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })} KST`
    : '';
  const failure=status.lastSyncError?` · 최근 수집 실패 (${status.lastAttemptAt?new Date(status.lastAttemptAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false})+' KST':'시각 확인 불가'}), 이전 정상 저장본 유지`:'';
  const checked=(crawl as StoredCrawl).checkedDates;
  return `${labels[status.dataState]} · 마지막 성공 수집: ${timestamp}${attempt}${failure}${checked?.length?` · 최근 확인 제공일: ${checked.join(', ')}`:''}`;
}
