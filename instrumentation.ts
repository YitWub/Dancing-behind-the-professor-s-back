/**
 * instrumentation.ts — Next.js 서버 기동 시 자동 크롤링 훅
 *
 * 서버 인스턴스가 시작될 때마다 https://life.hanyang.ac.kr/theme/pages/home.php 및
 * 하위 페이지(facilities/index.php, payment/ticket-shops.php, facilities/detail.php)를
 * 크롤링하여 최신 학식 메뉴와 사진을 준비한다.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { ensureFreshMealCrawl } = await import('./lib/meal/store.ts');
      await ensureFreshMealCrawl({ force: true });
    } catch {
      // 서버 기동은 어떤 경우에도 중단되지 않아야 함
    }
  }
}

