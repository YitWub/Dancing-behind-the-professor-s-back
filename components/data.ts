/* ==========================================================================
 *  components/data.ts — API 호출 단일 창구
 * --------------------------------------------------------------------------
 *  팀원2의 라우트가 아직 404 일 수 있으므로, 전부 "API 먼저 → 실패하면 mock"
 *  순서로 떨어진다. API 가 붙는 순간 코드 수정 없이 실데이터로 바뀐다.
 *
 *  ★ 중요: 목으로 떨어졌으면 화면이 그 사실을 숨기지 않는다.
 *    Sourced.source === 'mock' 이면 배너를 띄운다.
 *    "모르면 모른다고 보이는 게 이 앱의 정체성"이라 데이터 출처도 예외가 아니다.
 * ========================================================================== */

import type {
  ApiResponse,
  BattleResult,
  CrawlResult,
  Lecture,
  MealItem,
  MealReview,
  MealTime,
} from '@/lib/types';
import {
  MOCK_LECTURES,
  MOCK_MEAL_REVIEWS,
  mockBattle,
} from '@/components/mock';

export interface Sourced<T> {
  data: T;
  source: 'api' | 'mock';
  /** 목으로 떨어진 이유 (배너에 그대로 노출) */
  note?: string;
}

/** ApiResponse 는 판별 유니온이므로 ok 를 먼저 좁히고 쓴다. */
async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status}`);
  const body = (await res.json()) as ApiResponse<T>;
  if (!body.ok) throw new Error(body.error);
  return body.data;
}

function reason(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m === '404' ? 'API 아직 준비 중' : `API 응답 실패 (${m})`;
}

/* ── 학식 ────────────────────────────────────────────────────────────────── */

/**
 * 크롤링 성공 여부는 본문이 아니라 응답 헤더로 온다.
 *   X-Meal-Ok: false      크롤링 실패
 *   X-Meal-Fallback: seed 시드로 대체됨
 * 본문만 보면 200 + 식단 배열이라 "정상"으로 보이기 때문에, 헤더를 읽어
 * CrawlResult 로 복원해서 화면이 배너를 띄울 수 있게 한다.
 */
export async function loadMeals(
  date: string,
  options?: { refresh?: boolean },
): Promise<Sourced<CrawlResult>> {
  try {
    const refreshParam = options?.refresh ? '&refresh=1' : '';
    const res = await fetch(
      `/api/meals?date=${encodeURIComponent(date)}${refreshParam}`,
      { cache: 'no-store' },
    );
    if (!res.ok) throw new Error(`${res.status}`);
    const body = (await res.json()) as ApiResponse<MealItem[]>;
    if (!body.ok) throw new Error(body.error);

    const crawledOk = res.headers.get('x-meal-ok') !== 'false';
    const fb = res.headers.get('x-meal-fallback');
    return {
      source: 'api',
      data: {
        ok: crawledOk,
        fetchedAt: res.headers.get('x-meal-fetched-at') ?? '',
        source: 'https://life.hanyang.ac.kr/theme/pages/home.php',
        items: body.data,
        fallback: fb === 'seed' || fb === 'cache' ? fb : undefined,
      },
    };
  } catch (e) {
    return {
      source: 'mock',
      note: reason(e),
      data: { ok: false, fetchedAt: '', source: 'unavailable', items: [], error: reason(e) },
    };
  }
}

/** 배너에 쓸 상세 사유(시도한 원본 URL 포함). items 는 전체 시드라 쓰지 않는다. */
export async function loadMealStatus(options?: { refresh?: boolean }): Promise<CrawlResult | null> {
  try {
    const q = options?.refresh ? '?refresh=1' : '';
    return await getJson<CrawlResult>(`/api/meals/status${q}`);
  } catch {
    return null;
  }
}

export async function loadMealReviews(mealItemId?: string): Promise<Sourced<MealReview[]>> {
  try {
    const q = mealItemId ? `?mealItemId=${encodeURIComponent(mealItemId)}` : '';
    const data = await getJson<MealReview[]>(`/api/meals/review${q}`);
    return { source: 'api', data };
  } catch (e) {
    return { source: 'mock', data: MOCK_MEAL_REVIEWS, note: reason(e) };
  }
}

export async function loadBattle(
  date: string,
  mealTime: MealTime,
  options?: { refresh?: boolean },
): Promise<Sourced<BattleResult>> {
  try {
    const refreshParam = options?.refresh ? '&refresh=1' : '';
    const data = await getJson<BattleResult>(
      `/api/meals/battle?date=${date}&mealTime=${mealTime}${refreshParam}`,
    );
    return { source: 'api', data };
  } catch (e) {
    return { source: 'mock', data: mockBattle(date, mealTime), note: reason(e) };
  }
}

export interface ReviewDraft {
  mealItemId: string;
  rating: number;
  text: string;
  nickname: string;
}

export async function submitReview(draft: ReviewDraft): Promise<Sourced<MealReview>> {
  try {
    const res = await fetch('/api/meals/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const body = (await res.json()) as ApiResponse<MealReview>;
    if (!body.ok) throw new Error(body.error);
    return { source: 'api', data: body.data };
  } catch (e) {
    // 목 모드에서도 방금 쓴 후기가 화면에 남도록 로컬 객체를 만들어 돌려준다.
    return {
      source: 'mock',
      note: reason(e),
      data: {
        id: `local-${Date.now()}`,
        mealItemId: draft.mealItemId,
        rating: draft.rating,
        text: draft.text,
        createdAt: new Date().toISOString(),
        nickname: draft.nickname || '익명',
      },
    };
  }
}

/* ── 꿀강 ────────────────────────────────────────────────────────────────── */

export type LectureSort = 'honey' | 'rating' | 'generosity' | 'workload';

export interface LectureQuery {
  q?: string;
  type?: string;
  sort?: LectureSort;
}

export async function loadLectures(query: LectureQuery): Promise<Sourced<Lecture[]>> {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.type) params.set('type', query.type);
  params.set('sort', query.sort ?? 'honey');

  try {
    const data = await getJson<Lecture[]>(`/api/lectures?${params.toString()}`);
    return { source: 'api', data };
  } catch (e) {
    return { source: 'mock', data: MOCK_LECTURES, note: reason(e) };
  }
}

export async function loadLecture(id: string): Promise<Sourced<Lecture | null>> {
  try {
    const data = await getJson<Lecture>(`/api/lectures/${id}`);
    return { source: 'api', data };
  } catch (e) {
    return {
      source: 'mock',
      data: MOCK_LECTURES.find((l) => l.id === id) ?? null,
      note: reason(e),
    };
  }
}

/* ── 정렬/필터는 목이든 API든 화면에서 한 번 더 건다 ───────────────────────
 *  목으로 떨어졌을 때 필터가 죽어 보이면 안 되기 때문.
 *  API 가 이미 정렬해 줬다면 같은 순서라 결과가 바뀌지 않는다.
 * ------------------------------------------------------------------------ */

export function applyLectureQuery(list: Lecture[], q: LectureQuery): Lecture[] {
  let out = list;

  if (q.q) {
    const needle = q.q.trim().toLowerCase();
    out = out.filter(
      (l) =>
        l.name.toLowerCase().includes(needle) ||
        l.professor.toLowerCase().includes(needle) ||
        l.department.toLowerCase().includes(needle),
    );
  }
  if (q.type) out = out.filter((l) => l.type === q.type);

  const key = q.sort ?? 'honey';

  // ★ 'rating' 은 일부러 보정하지 않는다.
  //   "별점 평균만 믿으면 이렇게 된다"를 보여주는 게 이 정렬의 존재 이유라,
  //   여기에 안전장치를 걸면 비교 자체가 사라진다. 대신 화면이 경고를 붙인다.
  if (key === 'rating') {
    return [...out].sort((a, b) => (b.avgRating ?? -1) - (a.avgRating ?? -1));
  }

  return [...out].sort((a, b) => {
    // 신뢰도 낮은 강의를 1위로 올려보내지 않는다 — 정렬 단계의 안전장치.
    const rank = (l: Lecture) => (l.reliability.band === 'low' ? 1 : 0);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);

    if (key === 'generosity') {
      return (b.axes?.gradeGenerosity ?? -1) - (a.axes?.gradeGenerosity ?? -1);
    }
    if (key === 'workload') {
      // 과제 적은 순 = workload 오름차순. null 은 뒤로.
      return (a.axes?.workload ?? 2) - (b.axes?.workload ?? 2);
    }
    return (b.honeyScore ?? -1) - (a.honeyScore ?? -1);
  });
}
