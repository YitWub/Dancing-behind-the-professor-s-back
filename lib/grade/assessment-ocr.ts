import { buildWeightPreview, validateWeightPreview, type ImageExtraction } from './assessment-image.ts';

/** OCR은 숫자나 누락된 비율을 추측하지 않는다. 의심스러운 행은 검토 대상으로 남긴다. */
export function parseAssessmentOcr(text: string, confidence = 100): ImageExtraction {
  const items: ImageExtraction['items'] = [];
  let previousLabel = '';
  for (const raw of text.normalize('NFKC').split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;
    // 실제 평가표에서 관찰된 % → 96 오독. 보정한 행은 반드시 사람이 확인한다.
    const corrected = /\d\s*96\s*$/.test(line);
    if (corrected) line = line.replace(/(\d+(?:[.,]\d+)?)\s*96\s*$/, '$1%');
    const percentages = line.match(/\d+(?:[.,]\d+)?\s*%/g) ?? [];
    if (percentages.length > 1) return { status: 'ambiguous', items: [] };
    const match = line.match(/^(.*?)\s*(\d+(?:[.,]\d+)?)\s*%\s*[|｜]*$/);
    if (!match) {
      previousLabel = /^[가-힣A-Za-z][가-힣A-Za-z\s()·_-]{0,79}$/.test(line) && !/그룹|비율|비중|합계|총계|total|weight/i.test(line) ? line : '';
      continue;
    }
    const name = match[1].replace(/^[|｜\s:：]+|[|｜\s:：]+$/g, '').trim() || previousLabel;
    previousLabel = '';
    if (!name || /^(합\s*계|총\s*계|총\s*합|전체|total)$/i.test(name) || /^(?:[ABCD][+0]?|[PF])$/i.test(name)) continue;
    const percent = Number(match[2].replace(',', '.'));
    items.push({ name, percent, parent: null, needsReview: corrected || confidence < 70 || percent > 100 || /^0\d/.test(match[2]) });
  }
  if (items.length > 40) return { status: 'ambiguous', items: [] };
  return { status: items.length ? 'ok' : 'no_table', items };
}

export function ocrNeedsReview(extraction: ImageExtraction): boolean {
  return extraction.status !== 'ok' || validateWeightPreview(buildWeightPreview([], extraction)).errors.length > 0;
}
