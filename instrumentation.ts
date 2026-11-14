/** 서버 시작은 데이터를 변경하지 않는다. 외부 수집은 npm run meals:sync로 분리한다. */
export async function register(): Promise<void> {
  // Intentionally no I/O, including when NEXT_RUNTIME is nodejs.
}