/**
 * GET /api/lectures?q=&type=&sort=honey → ApiResponse<Lecture[]>
 *
 * sort
 *   honey   (기본) 꿀강 지수 내림차순. ★축소된 값 기준이라 표본 4건짜리가 1위로 못 올라온다.
 *   rating  별점 평균 내림차순 — "원시 평균으로 줄 세우면 이렇게 됩니다" 비교용
 *   trust   신뢰도 내림차순
 *   name    가나다순
 * 어떤 정렬이든 강의평이 없는 강의(honeyScore=null)는 항상 맨 뒤로 보낸다.
 */

import type { NextRequest } from 'next/server';

import type { Lecture } from '../../../lib/types.ts';
import { readLectureBundle } from '../../../lib/honey/store.ts';
import { honeySortKey } from '../../../lib/honey/score.ts';
import { fail, internal, ok } from '../_lib/respond.ts';

const SORTS = ['honey', 'rating', 'trust', 'name'] as const;
type Sort = (typeof SORTS)[number];

const TYPES: Lecture['type'][] = ['전공필수', '전공선택', '교양필수', '교양선택', '일반선택'];

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const params = request.nextUrl.searchParams;

    const rawSort = params.get('sort') ?? 'honey';
    if (!SORTS.includes(rawSort as Sort)) {
      return fail(`sort 는 ${SORTS.join(' | ')} 중 하나여야 합니다: ${rawSort}`, 400);
    }
    const sort = rawSort as Sort;

    const rawType = params.get('type');
    if (rawType && !TYPES.includes(rawType as Lecture['type'])) {
      return fail(`type 은 ${TYPES.join(' | ')} 중 하나여야 합니다: ${rawType}`, 400);
    }

    const q = (params.get('q') ?? '').trim().toLowerCase();

    const bundle = readLectureBundle();
    let lectures = bundle.lectures;

    if (rawType) lectures = lectures.filter((l) => l.type === rawType);
    if (q) {
      lectures = lectures.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          l.professor.toLowerCase().includes(q) ||
          l.department.toLowerCase().includes(q),
      );
    }

    const sorted = [...lectures].sort((a, b) => {
      switch (sort) {
        case 'rating':
          return (b.avgRating ?? -1) - (a.avgRating ?? -1);
        case 'trust':
          return b.reliability.score - a.reliability.score;
        case 'name':
          return a.name.localeCompare(b.name, 'ko');
        case 'honey':
        default:
          return (
            honeySortKey(b.honeyScore, b.reliability.score) -
            honeySortKey(a.honeyScore, a.reliability.score)
          );
      }
    });

    return ok(sorted, {
      headers: {
        'X-Lecture-Mode': bundle.mode,
        'X-Lecture-Source': 'seed',
        'X-Lecture-Runtime-Computed': String(bundle.computedAtRuntime),
      },
    });
  } catch (err) {
    return internal(err, '강의 목록 조회');
  }
}
