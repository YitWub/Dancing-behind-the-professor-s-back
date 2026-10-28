import test from 'node:test';
import assert from 'node:assert/strict';
import { isIsoDate, kstToday, kstYear } from '../datetime.ts';

/**
 * 시간대 유틸은 경계 시각에서만 틀린다. 그래서 경계만 고정한다.
 * 이 테스트가 없으면 "오전 9시 이전에만 틀리는 앱"이 조용히 돌아온다.
 */
test('kstToday: UTC 가 아니라 KST 기준 날짜를 낸다', () => {
  // 발표 당일 아침 8시 — demo:refresh 를 돌리는 바로 그 시각
  const morning = new Date('2026-11-04T23:00:00Z');
  assert.equal(morning.toISOString().slice(0, 10), '2026-11-04', 'UTC 로는 어제');
  assert.equal(kstToday(morning), '2026-11-05', 'KST 로는 오늘');
});

test('kstToday: 자정 경계 양쪽', () => {
  assert.equal(kstToday(new Date('2026-11-04T15:00:00Z')), '2026-11-05'); // 00:00 KST
  assert.equal(kstToday(new Date('2026-11-04T14:59:59Z')), '2026-11-04'); // 23:59:59 KST
});

test('kstToday: 로케일 기반 계산과 일치한다', () => {
  // 고정 +9h 오프셋이 ICU 와 어긋나지 않는지 (한국은 DST 없음)
  for (const iso of [
    '2026-11-04T23:00:00Z',
    '2026-11-04T15:00:00Z',
    '2026-11-04T14:59:59Z',
    '2025-12-31T16:00:00Z',
    '2026-06-30T12:00:00Z',
  ]) {
    const d = new Date(iso);
    assert.equal(kstToday(d), d.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }), iso);
  }
});

test('kstYear: 새해 경계에서 해가 밀리지 않는다', () => {
  // 강의평 STALE 판정이 한 해 밀리면 "오래된 강의평" 배지가 통째로 틀어진다
  const newYear = new Date('2025-12-31T16:00:00Z'); // 2026-01-01 01:00 KST
  assert.equal(newYear.getUTCFullYear(), 2025);
  assert.equal(kstYear(newYear), 2026);
});

test('isIsoDate: 달력에 없는 날짜를 거른다', () => {
  // JS Date 는 2026-02-30 을 3월 2일로 굴려버려 NaN 이 안 난다.
  // 검증을 형식만 보면 400 대신 200 + 빈 배열이 조용히 나간다.
  assert.equal(isIsoDate('2026-02-30'), false);
  assert.equal(isIsoDate('2026-13-01'), false);
  assert.equal(isIsoDate('2026-02-28'), true);
  assert.equal(isIsoDate('2024-02-29'), true); // 윤년
  assert.equal(isIsoDate('2026-2-8'), false);
  assert.equal(isIsoDate('오늘'), false);
});
