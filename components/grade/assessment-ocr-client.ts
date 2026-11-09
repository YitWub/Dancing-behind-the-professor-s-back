import type { Worker } from 'tesseract.js';

/** 브라우저 전용. 이미지·OCR 원문을 서버로 보내지 않는다. */
export async function recognizeAssessmentImage(image: Blob, signal: AbortSignal, onProgress: (message: string) => void) {
  if (signal.aborted) throw new DOMException('취소되었습니다.', 'AbortError');
  let worker: Worker | null = null;
  let stopped = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => { stopped = true; reject(new DOMException('취소되었습니다.', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    timeout = setTimeout(() => { stopped = true; reject(Error('OCR 준비 시간이 길어지고 있습니다. 연결을 확인하거나 Gemini·수동 입력을 이용해 주세요.')); }, 90000);
  });
  const recognition = (async () => {
    const { createWorker, PSM } = await import('tesseract.js');
    if (stopped) throw new DOMException('취소되었습니다.', 'AbortError');
    onProgress('OCR 준비 중… 처음에는 한국어 인식 파일을 내려받습니다.');
    worker = await createWorker('kor+eng', 1, { logger: (message) => {
      if (!stopped && message.status === 'recognizing text') onProgress(`OCR로 평가표 읽는 중… ${Math.round(message.progress * 100)}%`);
    } });
    if (stopped) { await worker.terminate(); worker = null; throw new DOMException('취소되었습니다.', 'AbortError'); }
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
    const { data } = await worker.recognize(image);
    return { text: data.text, confidence: data.confidence };
  })();
  try { return await Promise.race([recognition, cancelled]); }
  finally {
    stopped = true;
    clearTimeout(timeout);
    if (abort) signal.removeEventListener('abort', abort);
    const activeWorker = worker as Worker | null;
    if (activeWorker) await activeWorker.terminate().catch(() => {});
  }
}
