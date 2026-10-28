/**
 * lib/datetime.ts — "오늘"을 한국 시간(KST) 기준으로 계산한다 (캠퍼스 공통 유틸)
 *
 * ⚠️ `new Date().toISOString().slice(0, 10)` 는 **UTC 날짜**다.
 *    KST 는 UTC+9 라서 00:00~09:00 사이에는 어제 날짜가 나온다.
 *
 *      2026-11-05 08:00 KST  →  toISOString() → "2026-11-04"  ✗
 *                            →  kstToday()    → "2026-11-05"  ✓
 *
 *    한양대 ERICA 학생이 쓰는 앱에서 오전 8시에 "어제 식단"이 뜨면 그냥 틀린 앱이다.
 *    (아침 먹으러 가는 시간대가 정확히 이 구간이다.)
 *
 * 한국은 서머타임이 없으므로 고정 +9시간 오프셋으로 충분하다.
 * ICU/로케일 데이터에 의존하지 않아 어느 런타임에서든 같은 값이 나온다.
 *
 * 📌 소유: 조율자. lib/types.ts 와 같은 급의 공유 계약이다.
 *    팀원2가 학식에서 발견해 lib/meal/kst.ts 로 만든 것을 승격했다.
 *    A필러(학기/주차 계산)·화면의 "오늘" 표시도 같은 함정을 밟으므로 셋이 공유한다.
 *    ★"오늘"이 필요하면 반드시 여기를 쓸 것. `new Date().toISOString()` 직접 호출 금지.
 */

/** 한국 표준시 오프셋. DST 없음. */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** KST 기준 오늘 (YYYY-MM-DD) */
export function kstToday(now: Date = new Date()): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** KST 기준 현재 연도. 강의평 최근성(STALE) 판정에 쓴다. */
export function kstYear(now: Date = new Date()): number {
  return Number.parseInt(kstToday(now).slice(0, 4), 10);
}

/** YYYY-MM-DD 형식인가 (달력상 실재하는 날짜인지까지 확인) */
export function isIsoDate(raw: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const d = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === raw;
}
