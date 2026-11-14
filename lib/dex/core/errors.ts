import type { DexErrorCode, Result } from './types.ts';
export class DexError extends Error {
  readonly code: DexErrorCode;
  constructor(code: DexErrorCode, message: string) { super(message); this.code = code; }
}
export function ensure(condition: unknown, message: string, code: DexErrorCode = 'INVALID_INPUT'): asserts condition {
  if (!condition) throw new DexError(code, message);
}
export async function resultOf<T>(operation: () => Promise<T>): Promise<Result<T>> {
  try { return { ok: true, value: await operation() }; }
  catch (error) {
    if (error instanceof DexError) return { ok: false, error: { code: error.code, message: error.message } };
    const name = error instanceof Error ? error.name : '';
    if (name === 'QuotaExceededError') return { ok: false, error: { code: 'QUOTA_EXCEEDED', message: '저장 공간이 부족합니다. 기존 기록은 유지됩니다.' } };
    if (name === 'VersionError') return { ok: false, error: { code: 'UNSUPPORTED_SCHEMA', message: '더 새로운 저장 버전입니다. 초기화하지 말고 앱을 업데이트하세요.' } };
    return { ok: false, error: { code: 'STORAGE_UNAVAILABLE', message: '저장소를 사용할 수 없습니다. 편집 내용을 보존하고 다시 시도해 주세요.' } };
  }
}
