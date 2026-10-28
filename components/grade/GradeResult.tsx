'use client';

/* ==========================================================================
 *  등급 출력 3층 구조 — 회의록 4-2 정밀도 사다리를 그대로 화면으로
 * --------------------------------------------------------------------------
 *  ★통합(조율자) 정정: tier 값은 lib/types.ts PrecisionTier 규약을 따른다.
 *    엔진은 "평균 없음"과 "점수 없음"을 둘 다 tier 0 으로 낸다(둘 다 절대점수 경로).
 *    blur 는 tier 1 이다 — 2가 아니다. 엔진은 tier 2(친구 점수)를 절대 내보내지 않는다.
 *    0층/1층의 구분은 정밀도가 아니라 화면 상태(점수를 넣었는가)이므로 myScore 로 가른다.
 *
 *   표준편차 있음 → 구간 + 누적분포        (tier 3~4)
 *   평균만 있음   → blur + "표편 넣으면 보임" (tier 1)
 *   아무것도 없음 → 절대점수 계산기,
 *                   등급이라는 단어 자체를 꺼내지 않는다        (tier 0)
 * ========================================================================== */

import type { QuickResult } from '@/components/mock';
import { CumulativeGradeChart } from '@/components/charts';
import { Badge, BlurGate, Card, ConfidenceBadge, Icon, SectionTitle, WarningList } from '@/components/ui';

/** blur 아래에 깔 장식용 막대. 사용자 데이터에서 나온 값이 아니다. */
const DECOY = [80, 70, 55, 40, 25, 15];

export function GradeResult({
  result,
  maxScore,
  myScore,
  onFocusStdev,
}: {
  result: QuickResult;
  maxScore: number;
  myScore: number | null;
  onFocusStdev: () => void;
}) {
  /* ── 0층: 점수조차 없음 ────────────────────────────────────────────── */
  if (result.tier === 0 && myScore == null) {
    return (
      <Card className="p-4">
        <p className="text-[13px] leading-relaxed text-[var(--e-muted)]">
          내 점수 한 칸만 넣어도 바로 뭔가 나옵니다. 세 칸을 다 채우면 등급까지 보입니다.
        </p>
      </Card>
    );
  }

  /* ── 1층: 점수는 있으나 평균이 없음 → 절대점수 계산기 ────────────────
   *  엔진 tier 0. 평균이 없으면 이 점수가 높은지 낮은지 말할 방법이 없다. */
  if (result.tier === 0) {
    const pct = myScore != null ? Math.round((myScore / maxScore) * 100) : 0;
    return (
      <Card className="p-4">
        <SectionTitle title="지금은 점수 계산기입니다" />
        <div className="flex items-baseline gap-2">
          <span className="text-[34px] font-bold leading-none tabular-nums text-[var(--e-ink)]">{pct}</span>
          <span className="text-[13px] text-[var(--e-muted)]">/ 100점 환산</span>
        </div>
        <p className="mt-3 text-[12.5px] leading-relaxed text-[var(--e-ink-2)]">
          반 평균이 없으면 이 점수가 높은 건지 낮은 건지 알 방법이 없습니다.
          그래서 여기서는 <b className="font-semibold">등급을 추측하지 않습니다.</b>
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-[var(--e-muted)]">
          반 평균을 넣으면 내가 위인지 아래인지까지, 표준편차까지 넣으면 등급 구간이 나옵니다.
        </p>
      </Card>
    );
  }

  /* ── 2층: 평균은 있고 표준편차가 없음 → blur ──────────────────────────
   *  엔진 tier 1. 회의록이 가장 강조한 정직성 장치라 반드시 도달해야 한다. */
  if (result.tier === 1) {
    const above = myScore != null;
    return (
      <Card className="p-4">
        <SectionTitle
          title="평균 대비 위치까지는 알 수 있습니다"
          right={<Badge tone="warn" icon="warn">등급 계산 불가</Badge>}
        />
        <p className="mb-4 text-[13px] leading-relaxed text-[var(--e-ink-2)]">
          {above ? '내 점수가 반 평균보다 위인지 아래인지는 확실합니다. ' : ''}
          하지만 <b className="font-semibold">몇 등인지</b>는 점수가 얼마나 퍼져 있느냐에 따라 완전히 달라집니다.
          평균만으로 등급을 말하면 그건 찍는 겁니다.
        </p>

        <BlurGate
          ready={false}
          message="표준편차를 넣으면 등급이 보입니다"
          cta={
            <button
              type="button"
              onClick={onFocusStdev}
              className="rounded-full px-3 py-1.5 text-[12px] font-semibold text-white"
              style={{ background: 'var(--e-accent)' }}
            >
              표준편차 넣으러 가기
            </button>
          }
        >
          <ul className="flex flex-col gap-1.5 py-1">
            {DECOY.map((w, i) => (
              <li key={i} className="flex items-center gap-2.5">
                <span className="w-7 shrink-0 text-right text-[12px] font-semibold text-[var(--e-ink-2)]">––</span>
                <span className="h-5 min-w-0 flex-1 overflow-hidden rounded-[4px] bg-[var(--e-surface-2)]">
                  <span className="block h-full rounded-[4px]" style={{ width: `${w}%`, background: 'var(--e-ord-3)' }} />
                </span>
                <span className="w-[68px] shrink-0 text-right text-[12px] text-[var(--e-ink-2)]">––%</span>
              </li>
            ))}
          </ul>
        </BlurGate>

        <div className="mt-4">
          <WarningList warnings={result.warnings} />
        </div>
      </Card>
    );
  }

  /* ── 3층: 구간 + 누적분포 ────────────────────────────────────────────── */
  const { zRange, distribution, headcount } = result;

  return (
    <Card className="p-4">
      <SectionTitle
        title="등급 구간"
        hint="딱 하나로 찍지 않고 구간으로 냅니다"
        right={<ConfidenceBadge c={result.confidence} />}
      />

      {zRange ? (
        <div className="mb-4 rounded-xl bg-[var(--e-surface-2)] px-3 py-2.5">
          <p className="text-[12px] leading-relaxed text-[var(--e-ink-2)]">
            최종 위치는 남은 평가와 지금 점수가 얼마나 같이 가느냐에 달려 있습니다.
            그 정도를 모르기 때문에 두 극단을 다 보여줍니다 —{' '}
            <b className="font-semibold tabular-nums text-[var(--e-ink)]">
              평균에서 {zRange.low.toFixed(1)} ~ {zRange.high.toFixed(1)} 표준편차
            </b>{' '}
            사이.
          </p>
        </div>
      ) : null}

      {distribution ? <CumulativeGradeChart dist={distribution} /> : null}

      {headcount ? (
        <p className="mt-4 flex items-start gap-1.5 rounded-xl bg-[var(--e-accent-soft)] px-3 py-2.5 text-[12.5px] leading-relaxed text-[var(--e-ink)]">
          <Icon name="info" className="mt-[2px] h-3.5 w-3.5 shrink-0 text-[var(--e-accent)]" />
          <span>
            {headcount.classSize}명 중 A 정원은 대략 {headcount.slotsForA}명.
            지금 내 위로 <b className="font-semibold">{headcount.estimatedAbove}명쯤</b> 있다고 봅니다.
            <span className="text-[var(--e-muted)]"> (정원 비율은 학과마다 달라 대략치입니다)</span>
          </span>
        </p>
      ) : null}

      <div className="mt-4">
        <WarningList warnings={result.warnings} />
      </div>
    </Card>
  );
}
