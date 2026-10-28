/**
 * 백테스트 CLI.
 *   node --experimental-strip-types scripts/backtest.ts
 *
 * 회의록 4-6(1)이 "확정 시 반드시 지킬 것"으로 못박은 두 산출물을 뽑는다.
 *   1) κ 프리셋 근거   — 엔진이 σ를 모를 때 쓰는 값의 출처
 *   2) 발표용 성능지표 — "n건 중 m건 적중, 평균 오차 X등급"
 *
 * 데이터 우선순위: data/backtest.team.json (실제 팀원 성적) > data/backtest.sample.json (합성)
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { BacktestCase, EngineAdapter } from '../lib/backtest/types.ts';
import { buildKappaReport } from '../lib/backtest/kappa.ts';
import { runBacktest } from '../lib/backtest/run.ts';

const root = new URL('../', import.meta.url);
const teamPath = fileURLToPath(new URL('data/backtest.team.json', root));
const samplePath = fileURLToPath(new URL('data/backtest.sample.json', root));

const usingReal = existsSync(teamPath);
const path = usingReal ? teamPath : samplePath;

if (!existsSync(path)) {
  console.error('데이터가 없습니다. 먼저 node --experimental-strip-types scripts/gen-backtest-sample.ts 를 실행하세요.');
  process.exit(1);
}

const cases: BacktestCase[] = JSON.parse(readFileSync(path, 'utf8')).cases;

console.log('='.repeat(72));
console.log('  슬기로운 에리카 생활 — 학점 예측 엔진 백테스트');
console.log('='.repeat(72));
if (!usingReal) {
  console.log('\n⚠ 합성 샘플로 돌고 있습니다. 이 수치는 발표에 쓸 수 없습니다.');
  console.log('  생성 과정이 엔진과 같은 상관구조를 쓰기 때문에 잘 맞는 게 당연하고,');
  console.log('  검증된 것은 모델의 정확도가 아니라 하네스의 동작뿐입니다.');
  console.log('  팀원 실제 성적을 data/backtest.team.json 으로 넣고 다시 돌리세요.\n');
}

// ── 1. κ 프리셋 ────────────────────────────────────────────────────────────
const kappa = buildKappaReport(cases);
console.log('\n[1] κ 역추정 — 엔진 프리셋의 근거');
console.log(`  유효 표본 ${kappa.estimates.filter((e) => e.kappa !== null && !e.ceilingClustered && !e.implausibleShape).length}건 / 전체 평가요소 ${kappa.estimates.length}건`);
if (kappa.quartiles) {
  const q = kappa.quartiles;
  console.log(`  사분위  Q1=${q.q1.toFixed(1)}  중앙값=${q.median.toFixed(1)}  Q3=${q.q3.toFixed(1)}`);
  console.log('  프리셋 (체감난이도 → κ 범위)');
  for (const p of kappa.presets) {
    console.log(`    ${p.label.padEnd(7)} κ ${p.kappaLow} ~ ${p.kappaHigh}`);
  }
}
console.log(`  근거 충분: ${kappa.grounded ? '예' : '아니오 — UI에 "잠정값"으로 표시할 것'}`);
console.log(`  단서: ${kappa.caveat}`);

// ── 2. 엔진 성능 ───────────────────────────────────────────────────────────
let engine: EngineAdapter;
try {
  // 팀원1의 엔진이 아직 없을 수 있으므로 정적 해석을 피해 런타임에 찾는다
  const enginePath = new URL('lib/grade/index.ts', root).href;
  const mod = await import(enginePath);
  const predict = (mod as Record<string, unknown>).predict;
  if (typeof predict !== 'function') throw new Error('lib/grade 가 predict를 export하지 않습니다');
  engine = { predict: predict as EngineAdapter['predict'] };
} catch (e) {
  console.log('\n[2] 엔진 성능 — 건너뜀');
  console.log(`  lib/grade 엔진을 아직 불러올 수 없습니다: ${(e as Error).message}`);
  console.log('  팀원1의 엔진이 들어오면 이 스크립트가 그대로 성능지표를 뽑습니다.');
  process.exit(0);
}

const report = runBacktest(cases, engine);
console.log('\n[2] 엔진 성능');
console.log(`  전체 ${report.totalCases}건 · 채점 ${report.evaluated}건 · 제외 ${report.skipped}건(등급 미단정)`);
console.log(`  정확 적중률      ${(report.hitRate * 100).toFixed(1)}%`);
console.log(`  ±1등급 이내      ${(report.nearHitRate * 100).toFixed(1)}%`);
console.log(`  평균 절대오차    ${report.meanAbsGradeError.toFixed(2)}등급`);
console.log(`  80% 구간 포함률  ${(report.intervalCoverage * 100).toFixed(1)}%  (이상적으로 80% 근처)`);
console.log(`  Brier score      ${report.brierScore?.toFixed(4) ?? '-'}`);
console.log(`  오답 중 경계표시 ${(report.missesFlaggedBorderline * 100).toFixed(1)}%`);

console.log('\n  티어별');
for (const [tier, s] of Object.entries(report.byTier)) {
  console.log(`    ${tier}  n=${String(s.count).padStart(3)}  적중 ${(s.hitRate * 100).toFixed(1)}%  오차 ${s.meanAbsGradeError.toFixed(2)}`);
}

console.log('\n  캘리브레이션 (화면에 쓰는 "X 이상일 확률 p" 문장을 그대로 검증)');
for (const b of report.calibration) {
  if (b.count === 0) continue;
  const bar = '█'.repeat(Math.round(b.observedFrequency * 20));
  console.log(`    ${(b.low * 100).toFixed(0).padStart(3)}~${(b.high * 100).toFixed(0).padStart(3)}%  n=${String(b.count).padStart(4)}  예측 ${(b.meanPredicted * 100).toFixed(0).padStart(3)}% → 실제 ${(b.observedFrequency * 100).toFixed(0).padStart(3)}%  ${bar}`);
}

console.log('\n' + '─'.repeat(72));
console.log('발표 슬라이드용 한 문장:');
console.log(`  "${report.headline}"`);
console.log('─'.repeat(72));
