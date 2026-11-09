import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAssessmentOcr, ocrNeedsReview } from '../assessment-ocr.ts';
import { buildWeightPreview, validateWeightPreview } from '../assessment-image.ts';

test('한국어 평가표: 합계 제외, 0% 보존, API 없이 100% 추출', () => {
  const result = parseAssessmentOcr('평가 그룹별 성적 비중:\n그룹 비중\n주차학습 15%\n과제 10%\n퀴즈 0%\n중간고사 35%\n기말고사 40%\n강의자료실 0%\n합계 100%');
  assert.deepEqual(result.items.map((r) => r.percent), [15, 10, 0, 35, 40, 0]);
  assert.equal(ocrNeedsReview(result), false);
});
test('실제 오독: 109%, 09%, % → 96은 검토 대상으로 남김', () => {
  const result = parseAssessmentOcr('과제 109%\n강의자료실 09%\n중간고사 3096\n기말고사 40%');
  assert.deepEqual(result.items.map((r) => [r.percent, r.needsReview]), [[109, true], [9, true], [30, true], [40, false]]);
  assert.equal(ocrNeedsReview(result), true);
});
test('공백·전각·소수 비율·다음 줄 비율을 읽고 합계·등급 제외', () => {
  const result = parseAssessmentOcr('중 간 고 사 | ３０％\n기말고사\n35,5%\n과제 34.5%\n합 계 100%\nA+ 95%');
  assert.deepEqual(result.items.map((r) => r.percent), [30, 35.5, 34.5]);
  assert.equal(ocrNeedsReview(result), false);
});
test('누락·중복·낮은 신뢰도·여러 열은 Gemini 또는 수동 검토 대상', () => {
  for (const result of [parseAssessmentOcr('과제 10%'), parseAssessmentOcr('과제 50%\n과 제 50%'), parseAssessmentOcr('중간 50%\n기말 50%', 50), parseAssessmentOcr('중간 30% 기말 70%'), parseAssessmentOcr('읽을 수 없는 사진')]) {
    assert.equal(ocrNeedsReview(result), true);
  }
});
test('인식 보정은 확인 없이 기존 적용 검증을 통과하지 않음', () => {
  const preview = buildWeightPreview([], parseAssessmentOcr('과제 1096\n중간 30%\n기말 60%'));
  assert.equal(validateWeightPreview(preview).total, 100);
  assert.ok(validateWeightPreview(preview).errors.some((e) => e.includes('확인 필요')));
});
