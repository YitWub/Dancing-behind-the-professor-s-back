import { loadCourses, type StorageAccess } from './course-storage.ts';
import { migrateV1Courses, validateManagedCourses } from './management.ts';
import type { ManagedCourse, ManagedCoursesDocument, ManagementResult } from './management-types.ts';
import { assignmentChangeMessages } from './assignments.ts';
import { attendanceChangeMessages } from './attendance.ts';
import { estimateChangeMessages } from './attendance-estimate.ts';

export const MANAGED_COURSE_STORAGE_KEY = 'erica.grade.courses.v2';
const browserStorage: StorageAccess = () => window.localStorage;
export interface ManagedCoursesSnapshot { courses: ManagedCourse[]; snapshot: string | null }
export interface V1MigrationPreview { courses: ManagedCourse[]; sourceSnapshot: string }

/** Reads only v2. Never falls back to stale v1 when v2 is corrupt, and never writes on load. */
export function loadManagedCourses(access: StorageAccess = browserStorage): ManagementResult<ManagedCoursesSnapshot> {
  try {
    const snapshot = access().getItem(MANAGED_COURSE_STORAGE_KEY);
    if (snapshot === null) return { ok: true, value: { courses: [], snapshot } };
    const document: unknown = JSON.parse(snapshot);
    if (!document || typeof document !== 'object' || !('version' in document) || document.version !== 2 || !('courses' in document)) {
      return { ok: false, errors: ['지원하지 않는 v2 저장 형식입니다. 저장 데이터는 변경하지 않았습니다.'] };
    }
    const errors = validateManagedCourses(document.courses);
    return errors.length ? { ok: false, errors } : {
      ok: true, value: { courses: document.courses as ManagedCourse[], snapshot },
    };
  } catch {
    return { ok: false, errors: ['v2 과목을 불러오지 못했습니다. 저장소 권한과 데이터 형식을 확인해 주세요.'] };
  }
}

/** Writes only the v2 key. A stale snapshot cannot overwrite a known newer document.
 * localStorage has no cross-tab transaction: comparison is best-effort conflict detection.
 */
export function saveManagedCourses(
  courses: ManagedCourse[], expectedSnapshot: string | null, access: StorageAccess = browserStorage,
  confirmedAssignmentChanges = false,
  confirmedAttendanceChanges = false,
): ManagementResult<{ snapshot: string }> {
  const errors = validateManagedCourses(courses);
  if (errors.length) return { ok: false, errors };
  const loaded = loadManagedCourses(access);
  if (!loaded.ok) return loaded;
  if (loaded.value.snapshot !== expectedSnapshot) {
    return { ok: false, errors: ['다른 탭에서 v2 과목이 변경되었습니다. 다시 불러온 뒤 저장해 주세요.'] };
  }
  const changes = assignmentChangeMessages(loaded.value.courses, courses);
  if (changes.length > 0 && !confirmedAssignmentChanges) {
    return { ok: false, errors: ['과제 삭제·전환·배점 변경 내용을 확인한 뒤 저장해 주세요.', ...changes] };
  }
  const legacyBefore=loaded.value.courses.filter((c)=>!courses.find((n)=>n.id===c.id)?.attendanceEstimate);
  const attendanceChanges = [...attendanceChangeMessages(legacyBefore,courses),...estimateChangeMessages(loaded.value.courses,courses)];
  if (attendanceChanges.length > 0 && !confirmedAttendanceChanges) return { ok: false, errors: ['출석 기록 전환·정정·규칙 변경을 확인한 뒤 저장해 주세요.', ...attendanceChanges] };
  try {
    const document: ManagedCoursesDocument = { version: 2, courses };
    const snapshot = JSON.stringify(document);
    access().setItem(MANAGED_COURSE_STORAGE_KEY, snapshot);
    return { ok: true, value: { snapshot } };
  } catch {
    return { ok: false, errors: ['v2 저장에 실패했습니다. 기존 v1·v2 데이터와 편집 내용을 유지하고 다시 시도해 주세요.'] };
  }
}

/** Preview is read-only; the caller must explicitly confirm before calling saveV1Migration. */
export function prepareV1Migration(access: StorageAccess = browserStorage): ManagementResult<V1MigrationPreview> {
  const v2 = loadManagedCourses(access);
  if (!v2.ok) return v2;
  if (v2.value.snapshot !== null) return { ok: false, errors: ['v2 데이터가 이미 있어 v1으로 덮어쓰지 않습니다.'] };
  const v1 = loadCourses(access);
  if (!v1.ok) return { ok: false, errors: [v1.error] };
  if (v1.snapshot === null) return { ok: false, errors: ['변환할 v1 저장 데이터가 없습니다.'] };
  const converted = migrateV1Courses(v1.courses);
  return converted.ok ? { ok: true, value: { courses: converted.value, sourceSnapshot: v1.snapshot } } : converted;
}

/** Opt-in migration. Source v1 is checked again and never overwritten or removed. */
export function saveV1Migration(
  preview: V1MigrationPreview, access: StorageAccess = browserStorage,
): ManagementResult<{ snapshot: string }> {
  const v1 = loadCourses(access);
  if (!v1.ok) return { ok: false, errors: [v1.error] };
  if (v1.snapshot !== preview.sourceSnapshot) {
    return { ok: false, errors: ['변환 준비 후 v1 과목이 변경되었습니다. 변환 내용을 다시 확인해 주세요.'] };
  }
  return saveManagedCourses(preview.courses, null, access);
}
