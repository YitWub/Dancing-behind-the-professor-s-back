/**
 * 백테스트 "샘플" 데이터 생성기.
 *
 * ★이 데이터로는 모델의 정확도를 검증할 수 없습니다.
 *  생성 과정이 우리가 가정한 상관구조를 그대로 쓰기 때문에, 엔진이 잘 맞히는 것은
 *  당연하고 아무것도 증명하지 못합니다. 이 파일의 용도는 단 하나,
 *  **백테스트 하네스가 실제로 돌아가는지 확인하는 것** 입니다.
 *
 *  발표에 넣을 성능지표는 반드시 팀원들의 실제 지난 학기 성적
 *  (data/backtest.team.json)으로 다시 돌려서 얻어야 합니다. (회의록 4-6)
 *
 *  실행: node --experimental-strip-types scripts/gen-backtest-sample.ts
 */
import { writeFileSync } from 'node:fs';
import type { Assessment, Course, GradeLetter } from '../lib/types.ts';
import type { BacktestCase } from '../lib/backtest/types.ts';

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260923);

function normal(): number {
  const u = Math.max(rnd(), 1e-9);
  const v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const COURSES: { name: string; professor: string; credits: number; enrolled: number }[] = [
  { name: '자료구조', professor: '김선우', credits: 3, enrolled: 46 },
  { name: '공학수학1', professor: '박정민', credits: 3, enrolled: 58 },
  { name: '일반물리학', professor: '이도현', credits: 3, enrolled: 72 },
  { name: '컴퓨터구조', professor: '정하늘', credits: 3, enrolled: 41 },
  { name: '확률과통계', professor: '최윤서', credits: 3, enrolled: 63 },
  { name: '운영체제', professor: '한지우', credits: 3, enrolled: 38 },
  { name: '데이터베이스', professor: '오세훈', credits: 3, enrolled: 52 },
  { name: '알고리즘', professor: '김선우', credits: 3, enrolled: 44 },
  { name: '선형대수', professor: '배수진', credits: 3, enrolled: 67 },
  { name: '디지털논리회로', professor: '노경민', credits: 3, enrolled: 35 },
  { name: '소프트웨어공학', professor: '유진아', credits: 3, enrolled: 49 },
  { name: '인공지능개론', professor: '서동욱', credits: 3, enrolled: 88 },
  { name: '네트워크', professor: '강태오', credits: 3, enrolled: 40 },
  { name: '기술경영', professor: '문가영', credits: 2, enrolled: 95 },
];

/** ERICA 상대평가 통상 정원: A 35%, B 35% (나머지 자유) */
function gradeFromPercentile(p: number): GradeLetter {
  if (p <= 0.15) return 'A+';
  if (p <= 0.35) return 'A0';
  if (p <= 0.52) return 'B+';
  if (p <= 0.7) return 'B0';
  if (p <= 0.84) return 'C+';
  if (p <= 0.93) return 'C0';
  if (p <= 0.98) return 'D+';
  return 'D0';
}

const RHO = 0.6; // 요소 간 상관. 중간 잘 본 사람이 기말도 잘 본다

const cases: BacktestCase[] = COURSES.map((meta, i) => {
  // 표준편차 공개 여부를 현실적으로 섞는다.
  // 회의록: "교수가 표준편차를 공개하지 않는 과목이 많다" — 이게 최빈 케이스다.
  const disclosure: 'full' | 'meanOnly' | 'none' = i % 4 === 3 ? 'meanOnly' : i % 7 === 5 ? 'none' : 'full';

  const midMean = 55 + Math.round(rnd() * 25);
  const midSd = 10 + Math.round(rnd() * 8);
  const finMean = 52 + Math.round(rnd() * 26);
  const finSd = 11 + Math.round(rnd() * 8);

  const ability = normal(); // 이 과목에서의 내 실력
  const zMid = RHO * ability + Math.sqrt(1 - RHO * RHO) * normal();
  const zFin = RHO * ability + Math.sqrt(1 - RHO * RHO) * normal();

  const clamp = (x: number) => Math.max(0, Math.min(100, Math.round(x)));
  const myMid = clamp(midMean + zMid * midSd);
  const myFin = clamp(finMean + zFin * finSd);

  // 출석·과제는 천장 밀집 — 대부분 만점
  const myAttend = rnd() < 0.72 ? 100 : 100 - Math.round(rnd() * 3) * 10;
  const myHw = rnd() < 0.6 ? 100 : 100 - Math.round(rnd() * 4) * 5;

  const assessments: Assessment[] = [
    {
      id: `${i}-mid`, name: '중간고사', weight: 0.35, maxScore: 100, myScore: myMid,
      mean: disclosure === 'none' ? null : midMean,
      stdev: disclosure === 'full' ? midSd : null,
      ceilingClustered: false,
    },
    {
      id: `${i}-fin`, name: '기말고사', weight: 0.4, maxScore: 100, myScore: myFin,
      mean: disclosure === 'none' ? null : finMean,
      stdev: disclosure === 'full' ? finSd : null,
      ceilingClustered: false,
    },
    {
      id: `${i}-hw`, name: '과제', weight: 0.15, maxScore: 100, myScore: myHw,
      mean: disclosure === 'none' ? null : 92, stdev: disclosure === 'full' ? 7 : null,
      ceilingClustered: true,
    },
    {
      id: `${i}-att`, name: '출석', weight: 0.1, maxScore: 100, myScore: myAttend,
      mean: disclosure === 'none' ? null : 96, stdev: disclosure === 'full' ? 6 : null,
      ceilingClustered: true,
    },
  ];

  // 정답 생성: 합성 z를 백분위로. 천장 요소는 감점으로만 반영(엔진과 같은 철학)
  const wMid = 0.35, wFin = 0.4;
  const sigmaS = Math.sqrt(wMid ** 2 + wFin ** 2 + 2 * wMid * wFin * RHO);
  const penalty = (100 - myAttend) * 0.001 + (100 - myHw) * 0.0015;
  const zTotal = (wMid * zMid + wFin * zFin) / sigmaS - penalty;
  const percentile = 1 - 0.5 * (1 + erf(zTotal / Math.SQRT2));

  const absences = myAttend === 100 ? 0 : Math.round((100 - myAttend) / 10);

  const course: Course = {
    id: `c${i}`,
    name: meta.name,
    professor: meta.professor,
    credits: meta.credits,
    enrolled: meta.enrolled,
    isAbsolute: false,
    assessments,
    attendance: {
      totalSessions: 30, absences, lateness: rnd() < 0.3 ? 1 : 0,
      allowedAbsences: 6, penaltyPerAbsence: 3.3, latePerAbsence: 3,
    },
  };

  return {
    id: `bt-${String(i + 1).padStart(2, '0')}`,
    course,
    actualGrade: gradeFromPercentile(percentile),
    source: 'sample',
    note: `공개수준=${disclosure} · 생성 백분위 ${(percentile * 100).toFixed(1)}%`,
  };
});

function erf(x: number): number {
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}

writeFileSync(
  new URL('../data/backtest.sample.json', import.meta.url),
  JSON.stringify(
    {
      _warning:
        '합성 데이터입니다. 하네스 동작 확인 전용이며 모델 정확도의 근거가 될 수 없습니다. 발표 지표는 data/backtest.team.json(실제 팀원 성적)으로 다시 산출하세요.',
      generatedAt: new Date().toISOString(),
      cases,
    },
    null,
    2,
  ) + '\n',
);
console.log(`생성 완료: ${cases.length}건 → data/backtest.sample.json`);
console.log('등급 분포:', cases.reduce<Record<string, number>>((m, c) => ((m[c.actualGrade] = (m[c.actualGrade] ?? 0) + 1), m), {}));
