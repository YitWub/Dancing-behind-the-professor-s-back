import type { Course } from '../types.ts';
import { validateCourses } from './course-validation.ts';

export const COURSE_STORAGE_KEY = 'erica.grade.courses.v1';
export interface CourseStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export type StorageAccess = () => CourseStorage;
type Failure = { ok: false; error: string };
type Loaded = { ok: true; courses: Course[]; snapshot: string | null };
const browserStorage: StorageAccess = () => window.localStorage;

/** No write-on-mount: absent data is an empty list, never mock courses.
 * Invalid/version-mismatched data is preserved; UI blocks writes until a successful reload.
 * Snapshot comparison detects edits in other tabs before a save (not a cross-tab transaction).
 */
export function loadCourses(access: StorageAccess = browserStorage): Loaded | Failure {
  try {
    const snapshot = access().getItem(COURSE_STORAGE_KEY);
    if (snapshot === null) return { ok: true, courses: [], snapshot };
    const data: unknown = JSON.parse(snapshot);
    if (typeof data !== 'object' || data === null || !('version' in data) || data.version !== 1 || !('courses' in data)) {
      return { ok: false, error: '지원하지 않는 과목 저장 형식입니다. 기존 데이터는 덮어쓰지 않았습니다.' };
    }
    const errors = validateCourses(data.courses);
    if (errors.length) return { ok: false, error: '저장된 과목 데이터가 올바르지 않습니다. 기존 데이터는 유지됩니다. ' + errors[0] };
    return { ok: true, courses: data.courses as Course[], snapshot };
  } catch {
    return { ok: false, error: '과목을 불러오지 못했습니다. 브라우저 저장소 권한이나 저장 데이터 형식을 확인한 뒤 다시 불러와 주세요.' };
  }
}

export function saveCourses(
  courses: Course[], expectedSnapshot: string | null, access: StorageAccess = browserStorage,
): { ok: true; snapshot: string } | Failure {
  const errors = validateCourses(courses);
  if (errors.length) return { ok: false, error: errors[0] };
  const loaded = loadCourses(access);
  if (!loaded.ok) return loaded;
  if (loaded.snapshot !== expectedSnapshot) {
    return { ok: false, error: '다른 탭에서 과목 정보가 변경되었습니다. 편집 내용을 확인하고 목록을 다시 불러온 뒤 저장해 주세요.' };
  }
  try {
    const snapshot = JSON.stringify({ version: 1, courses });
    access().setItem(COURSE_STORAGE_KEY, snapshot);
    return { ok: true, snapshot };
  } catch {
    return { ok: false, error: '저장에 실패했습니다. 저장 공간과 권한을 확인해 주세요. 편집 내용은 이 화면에 유지되며 다시 저장할 수 있습니다.' };
  }
}
