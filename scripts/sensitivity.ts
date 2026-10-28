/**
 * 민감도 스윕 — 근거 없는 상수가 결과를 얼마나 흔드는가.
 *   node --experimental-strip-types scripts/sensitivity.ts
 *
 * 배경(CONTRACT.md 7-4): TAU_FLOOR·ImpactBand 경계는 근거가 없다.
 * 합성 샘플 9건에 맞춰 튜닝하면 그게 바로 이 프로젝트가 내내 반대해온
 * "숫자로 위장한 추측"이므로 값은 동결했다. 대신 **얼마나 흔들리는지는 잰다.**
 *
 * 읽는 법:
 *   흔들리지 않으면 → "근거는 없지만 결론이 이 값에 의존하지 않는다" (약점이 방어 논거가 됨)
 *   흔들리면       → "상충 관계를 알고 보수적인 쪽을 골랐다" 로 발표 논거를 바꿔야 한다
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Course } from '../lib/types.ts';
import type { BacktestCase } from '../lib/backtest/types.ts';
import { runBacktest } from '../lib/backtest/run.ts';

const root = new URL('../', import.meta.url);
const teamPath = fileURLToPath(new URL('data/backtest.team.json', root));
const samplePath = fileURLToPath(new URL('data/backtest.sample.json', root));
const usingReal = existsSync(teamPath);
const cases: BacktestCase[] = JSON.parse(
  readFileSync(usingReal ? teamPath : samplePath, 'utf8'),
).cases;

const mod = await import(new URL('lib/grade/index.ts', root).href);
const predict = mod.predict as (c: Course, opts?: unknown) => never;

console.log('='.repeat(76));
console.log('  민감도 스윕 — 근거 없는 상수가 결론을 흔드는가');
console.log('='.repeat(76));
if (!usingReal) {
  console.log('\n⚠ 합성 샘플 기준입니다. 절대 수치는 발표에 쓸 수 없습니다.');
  console.log('  다만 "값을 바꾸면 얼마나 움직이는가"라는 상대적 질문에는 답할 수 있습니다.\n');
}

/* ── TAU_FLOOR(T3) 스윕 ─────────────────────────────────────────────────── */
console.log('[1] TAU_FLOOR.t3 — 모형 자체 오차의 하한 (현재 동결값 0.15)');
console.log('    τ를 키우면 모든 확률이 50%로 수축한다 → 적중률↓ / 구간포함률↑ 상충 예상');
console.log();
console.log('      τ      적중률   ±1등급   평균오차   구간포함   Brier');
console.log('    ' + '─'.repeat(62));

// ★스윕 범위를 넓게 잡는 이유(팀원1 지적):
//   0.05~0.30 만 보면 Brier 가 단조 증가로 보이지만, 그건 U자의 오른쪽 가지일 뿐이다.
//   범위가 좁으면 "고원 위에 있다"와 "무관하다"를 구분할 수 없고 결론이 뒤집힌다.
const taus = [0.0001, 0.001, 0.005, 0.01, 0.02, 0.03, 0.05, 0.1, 0.15, 0.2, 0.3, 0.45, 0.6, 0.8, 1.0];
const FROZEN_TAU = 0.15;
let bestBrier = { tau: NaN, v: Infinity };
const rows: { tau: number; hit: number; cov: number; brier: number }[] = [];

for (const t3 of taus) {
  const r = runBacktest(cases, { predict: (c: Course) => predict(c, { tauFloor: { t3 } }) });
  const brier = r.brierScore ?? NaN;
  if (brier < bestBrier.v) bestBrier = { tau: t3, v: brier };
  rows.push({ tau: t3, hit: r.hitRate, cov: r.intervalCoverage, brier });
  const mark = t3 === FROZEN_TAU ? ' ← 동결값' : '';
  console.log(
    `    ${String(t3).padEnd(6)} ${(r.hitRate * 100).toFixed(1).padStart(6)}%  ` +
      `${(r.nearHitRate * 100).toFixed(1).padStart(6)}%  ` +
      `${r.meanAbsGradeError.toFixed(2).padStart(7)}   ` +
      `${(r.intervalCoverage * 100).toFixed(1).padStart(7)}%  ` +
      `${brier.toFixed(4).padStart(7)}${mark}`,
  );
}

const hitSpread = Math.max(...rows.map((r) => r.hit)) - Math.min(...rows.map((r) => r.hit));
const covSpread = Math.max(...rows.map((r) => r.cov)) - Math.min(...rows.map((r) => r.cov));

console.log();
console.log(`    적중률 변동폭   ${(hitSpread * 100).toFixed(1)}%p (전 구간)`);
console.log(`    구간포함 변동폭 ${(covSpread * 100).toFixed(1)}%p (전 구간)`);
console.log(`    Brier 최저점    τ=${bestBrier.tau} (${bestBrier.v.toFixed(4)})`);
console.log();
console.log('    판정:');
console.log(verdict());

/**
 * 경계 이분 탐색 (팀원1 제안).
 *
 * 격자 스윕만으로는 경계를 놓친다 — 15점 격자에서 "0.3 OK / 0.45 깨짐"으로 보였던 경계가
 * 실제로는 0.38 이었다. 격자 간격보다 작은 구조는 격자로 볼 수 없다.
 * 그래서 경계 후보 구간을 찾으면 그 사이만 이분 탐색으로 한 번 더 좁힌다.
 *
 * @param ok   tau 가 "아직 고원 안"이면 true
 * @param inside 고원 안쪽으로 확실한 τ
 * @param outside 고원 밖으로 확실한 τ
 */
function bisectEdge(
  ok: (tau: number) => boolean,
  inside: number,
  outside: number,
  tol = 1e-5,
): { inOk: number; outBad: number; inRaw: number; outRaw: number } {
  let a = inside;
  let b = outside;
  for (let i = 0; i < 60 && Math.abs(b - a) > tol; i++) {
    const mid = (a + b) / 2;
    if (ok(mid)) a = mid;
    else b = mid;
  }
  // ★경계는 점이 아니라 "마지막 통과 표본"과 "첫 실패 표본" 사이의 구간이다.
  //  이걸 한 점으로 눌러 담으면 한 칸 치우친 값이 나오고, b(바깥 끝점)를 경계로 쓰면
  //  항상 고원을 넓게 보고하는 편향이 된다. (팀원1 지적)
  //
  //  게다가 그냥 반올림하면 a와 b가 같은 값으로 뭉개져 "0.3801 / 0.3801 사이" 처럼
  //  구간이 사라지고, 고원 끝이 실제로는 깨진 값으로 찍힌다.
  //  → **방향성 반올림**: 안쪽은 고원을 좁히는 쪽으로, 바깥쪽은 넓히는 쪽으로 민다.
  //    이러면 보고한 브래킷이 항상 참값을 포함하고, 고원 폭은 절대 과대보고되지 않는다.
  //    (재스윕의 관전 포인트가 "고원이 좁아지는가"라서 도구가 넓은 쪽으로 치우치면 안 된다)
  const inward = a < b ? floor4 : ceil4;   // 상단 경계면 내림, 하단 경계면 올림
  const outward = a < b ? ceil4 : floor4;
  return { inOk: inward(a), outBad: outward(b), inRaw: a, outRaw: b };
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

function floor4(x: number): number {
  return Math.floor(x * 10000) / 10000;
}

function ceil4(x: number): number {
  return Math.ceil(x * 10000) / 10000;
}

/** τ 하나로 백테스트를 돌려 두 지표만 뽑는다 */
function metricsAt(t3: number) {
  const r = runBacktest(cases, {
    predict: (c: Course) => predict(c, { tauFloor: { t3 } }),
  });
  return { hit: r.hitRate, cov: r.intervalCoverage };
}

/**
 * 판정.
 *
 * ★이전 버전의 오류(팀원1 지적으로 정정):
 *   스윕 범위를 0.05~0.30 으로 좁게 잡고 "Brier 가 단조다 → 최소가 끝점이다"라고 판정했다.
 *   범위를 넓히니 0.02 부근에 진짜 극소가 있는 U자였고, 좁은 창은 오른쪽 가지만 보고 있었다.
 *   판정 근거가 스윕 범위에 의존하면 그 판정은 범위를 바꾸는 순간 뒤집힌다.
 *
 *   그래서 이제 단조/극소 여부로 판정하지 않는다. 대신 두 가지를 본다:
 *     (1) 결론(적중률·구간포함률)이 변하지 않는 "고원"의 경계가 어디인가
 *     (2) 동결값이 그 고원의 어디쯤에 있는가
 *   Brier 극소는 위치만 보고하고 최적값으로 채택하지 않는다 (아래 이유).
 */
function verdict(): string {
  const at = (t: number) => rows.find((r) => r.tau === t)!;
  const base = at(FROZEN_TAU);

  // 동결값과 적중률·구간포함률이 모두 같은, 동결값을 포함하는 연속 구간 = 고원
  const idx = rows.findIndex((r) => r.tau === FROZEN_TAU);
  const same = (r: (typeof rows)[number]) =>
    Math.abs(r.hit - base.hit) < 1e-9 && Math.abs(r.cov - base.cov) < 1e-9;
  let lo = idx;
  let hi = idx;
  while (lo > 0 && same(rows[lo - 1])) lo--;
  while (hi < rows.length - 1 && same(rows[hi + 1])) hi++;

  const evaluated = runBacktest(cases, {
    predict: (c: Course) => predict(c, { tauFloor: { t3: FROZEN_TAU } }),
  }).evaluated;

  const onPlateau = (t: number) => {
    const m = metricsAt(t);
    return Math.abs(m.hit - base.hit) < 1e-9 && Math.abs(m.cov - base.cov) < 1e-9;
  };

  const lines: string[] = [];

  // 격자로 찾은 후보 구간을 이분 탐색으로 좁힌다
  const lowEdge = lo > 0 ? bisectEdge(onPlateau, rows[lo].tau, rows[lo - 1].tau) : null;
  const highEdge =
    hi < rows.length - 1 ? bisectEdge(onPlateau, rows[hi].tau, rows[hi + 1].tau) : null;

  const plateauLow = lowEdge ? lowEdge.inOk : rows[lo].tau;
  const plateauHigh = highEdge ? highEdge.inOk : rows[hi].tau;

  lines.push(
    `      고원: τ ${plateauLow} ~ ${plateauHigh} 구간에서 적중률·구간포함률이 완전히 동일하다.`,
  );
  lines.push(
    `      (격자로는 ${rows[lo].tau}~${rows[hi].tau} 까지만 보였고, 경계는 이분 탐색으로 좁혔다)`,
  );
  lines.push(`      동결값 ${FROZEN_TAU} 은 이 고원의 ${positionOnPlateau(plateauLow, plateauHigh)}에 있다.`);

  if (lowEdge || highEdge) {
    lines.push('      고원 바깥에서는 실제로 변한다 — 두 지표가 순차적으로 무너진다:');
    if (lowEdge) {
      const m = metricsAt(lowEdge.outRaw);
      lines.push(
        `        ${lowEdge.outBad} / ${lowEdge.inOk} 사이 → 구간포함 ${(m.cov * 100).toFixed(1)}% 로 하락 (구간이 좁아 실제 등급을 놓친다)`,
      );
    }
    if (highEdge) {
      const m = metricsAt(highEdge.outRaw);
      lines.push(
        `        ${highEdge.inOk} / ${highEdge.outBad} 사이 → 적중 ${(m.hit * 100).toFixed(1)}% 로 하락 (분포가 평평해져 최빈 등급이 정원 최대 버킷으로 끌린다)`,
      );
      // 구간포함률이 100%가 되는 지점은 적중률 붕괴와 다른 지점이다
      const sat = bisectEdge((t) => metricsAt(t).cov < 1 - 1e-9, highEdge.outRaw, 1.0);
      lines.push(
        `        ${sat.inOk} / ${sat.outBad} 사이 → 구간포함 100% 포화 (적중률 붕괴와 다른 지점)`,
      );
    }
  }

  lines.push('');
  lines.push('      ★발표 문구:');
  lines.push(
    `        ❌ "이 값에 의존하지 않는다"          (고원 밖에서 깨지므로 질의응답에 취약)`,
  );
  lines.push(
    `        ✅ "τ ${plateauLow}~${plateauHigh} 전 구간에서 결론이 같고, 동결값은 그 한복판이다.`,
  );
  lines.push('            고원 밖에서는 변하며 그 경계도 측정했다."');
  lines.push('        "어디까지 괜찮은지 안다"가 "아무 값이나 괜찮다"보다 방어가 쉽다.');
  lines.push('');
  lines.push('      ⚠ 경계값의 유효자릿수는 통계적 정밀도가 아니다.');
  lines.push(`        이 경계는 채점 ${evaluated}건 중 특정 1건의 구간/최빈값이 뒤집히는 이산적 사건이라`);
  lines.push('        위치 자체는 날카롭지만 그 위치는 이 표본에 고유하다.');
  lines.push('        발표에서는 자릿수가 아니라 "고원이 존재하고 동결값이 그 안에 있다"를 말할 것.');

  // Brier 극소는 보고만 하고 채택하지 않는다
  lines.push('');
  lines.push(`      Brier 극소는 τ=${bestBrier.tau} 에 있으나 최적값으로 채택하지 않는다:`);
  if (!usingReal) {
    lines.push('        · 생성기가 엔진과 같은 ρ=0.6 을 쓴다 → 모형오차가 구조적으로 0 이다.');
    lines.push('          그런 데이터로 "모형오차 하한"을 고르는 것은 순환논증이다.');
  }
  lines.push(
    `        · 채점 표본이 ${evaluated}건뿐이라 ${bestBrier.v.toFixed(4)} 와 ${base.brier.toFixed(4)} 의 차이는 노이즈 수준이다.`,
  );
  lines.push('        → τ 선택에는 실제 성적이 반드시 필요하다. 실데이터가 들어오면 전 구간 재스윕할 것.');

  return lines.join('\n');
}

/** 고원 안에서 동결값의 위치. 선형·로그 두 척도로 본다(τ는 배율 성격이라 로그도 의미가 있다). */
function positionOnPlateau(low: number, high: number): string {
  const lin = (FROZEN_TAU - low) / (high - low);
  const log = (Math.log(FROZEN_TAU) - Math.log(low)) / (Math.log(high) - Math.log(low));
  const label = (r: number) => (r < 0.25 ? '왼쪽' : r > 0.75 ? '오른쪽' : '한복판');
  return `${label(lin)} (선형 ${(lin * 100).toFixed(0)}% 지점, 로그 ${(log * 100).toFixed(0)}% 지점)`;
}

/* ── ImpactBand 경계 스윕 ───────────────────────────────────────────────── */
const contributions = mod.contributions as (c: Course, opts?: unknown) => { band: string }[];
console.log();
console.log('[2] ImpactBand 경계 — 변별 기여도 3구간의 컷 (현재 동결값 0.10 / 0.40)');
console.log('    밴드가 바뀌면 "사실상 기말이 결정한다"는 결론 자체가 바뀌는지 본다');
console.log();
console.log('      negligible / decisive      negligible  supporting  decisive');
console.log('    ' + '─'.repeat(62));

const bandSets = [
  { negligible: 0.05, decisive: 0.3 },
  { negligible: 0.1, decisive: 0.4 },
  { negligible: 0.15, decisive: 0.5 },
  { negligible: 0.2, decisive: 0.6 },
];
for (const bands of bandSets) {
  const tally: Record<string, number> = { negligible: 0, supporting: 0, decisive: 0 };
  for (const c of cases) for (const x of contributions(c.course, { bands })) tally[x.band]++;
  const mark = bands.negligible === 0.1 && bands.decisive === 0.4 ? ' ← 동결값' : '';
  console.log(
    `      ${bands.negligible.toFixed(2)} / ${bands.decisive.toFixed(2)}` +
      `${String(tally.negligible).padStart(20)}${String(tally.supporting).padStart(12)}` +
      `${String(tally.decisive).padStart(10)}${mark}`,
  );
}

// 밴드 컷에 따라 결론이 바뀌는지 판정
const tallies = bandSets.map((bands) => {
  const t: Record<string, number> = { negligible: 0, supporting: 0, decisive: 0 };
  for (const c of cases) for (const x of contributions(c.course, { bands })) t[x.band]++;
  return t;
});
const negRange = [Math.min(...tallies.map((t) => t.negligible)), Math.max(...tallies.map((t) => t.negligible))];
const decRange = [Math.min(...tallies.map((t) => t.decisive)), Math.max(...tallies.map((t) => t.decisive))];

console.log();
console.log('    판정:');
const negSpread = negRange[1] - negRange[0];
const decSpread = decRange[1] - decRange[0];
const total = tallies[0].negligible + tallies[0].supporting + tallies[0].decisive;

console.log(
  `      "영향 없음"   ${negRange[0]}~${negRange[1]}건 (변동 ${negSpread}/${total})` +
    (negSpread <= decSpread / 3
      ? ' — 컷을 바꿔도 거의 그대로. 비교적 견고한 결론.'
      : ' — 컷에 따라 흔들린다.'),
);
console.log(
  `      "사실상 결정" ${decRange[0]}~${decRange[1]}건 (변동 ${decSpread}/${total})` +
    (decSpread > total / 5 ? ' — 컷에 크게 의존한다.' : ' — 비교적 안정적.'),
);
console.log();
if (decSpread > negSpread * 2) {
  console.log('      ★발표 지침: "기말이 사실상 결정한다"를 단정하지 말 것.');
  console.log(`       컷을 0.20/0.60 으로만 옮겨도 decisive 가 ${decRange[0]}건이 된다 — 근거가 컷 선택에 달려 있다.`);
  console.log('       더 안전한 주장: "출석·과제는 등급을 거의 가르지 않는다".');
  console.log(`       이쪽은 ${negRange[0]}~${negRange[1]}건으로 훨씬 덜 움직이고, 회의록 4-4의 "부분 구제"`);
  console.log('       (다들 만점이라는 사실 자체가 σ≈0 정보)와도 논리가 맞는다.');
}
console.log();
console.log('='.repeat(76));
