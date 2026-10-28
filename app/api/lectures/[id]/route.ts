/**
 * GET /api/lectures/[id] → ApiResponse<Lecture>
 * 없는 id 는 404.
 */

import { findLecture } from '../../../../lib/honey/store.ts';
import { fail, internal, ok } from '../../_lib/respond.ts';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const lecture = findLecture(id);
    if (!lecture) return fail(`강의를 찾을 수 없습니다: ${id}`, 404);
    return ok(lecture);
  } catch (err) {
    return internal(err, '강의 상세 조회');
  }
}
