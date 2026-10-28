'use client';

/* ==========================================================================
 *  "째도 되나" 비교 예측 — 학점 화면의 주인공
 * --------------------------------------------------------------------------
 *  규칙 5: 절대 예측 대신 차분만 낸다.
 *  화면 어디에도 "당신은 A0입니다" 꼴의 문장이 나올 수 없게, 표시하는 값은
 *  전부 "지금 → 그 경우"의 이동뿐이다.
 * ========================================================================== */

import type { QuickInput, WhatIfAssumptions } from '@/components/mock';
import { whatIfQuick } from '@/components/mock';
import { atLeastText, pctText, score } from '@/components/format';
import { Badge, Card, CoinFlipNote, EmptyNote, Icon, SectionTitle } from '@/components/ui';

export function WhatIfPanel({
  input,
  assumptions,
  onAssumptions,
}: {
  input: QuickInput;
  assumptions: WhatIfAssumptions;
  onAssumptions: (a: WhatIfAssumptions) => void;
}) {
  const rows = whatIfQuick(input, assumptions);
  const usable = rows.some((r) => r.probBefore != null);
  const borderline = rows.some((r) => r.borderlineFlag);

  return (
    <Card className="p-4">
      <SectionTitle
        title="오늘 이 수업 째도 되나"
        hint="결론을 찍어주는 대신, 그렇게 했을 때 뭐가 얼마나 움직이는지를 보여줍니다"
      />

      {!usable ? (
        <EmptyNote>
          위 세 칸을 채우면 여기서 <b className="font-semibold text-[var(--e-ink-2)]">결석 한 번의 값</b>을 계산합니다.
        </EmptyNote>
      ) : (
        <>
          {borderline ? (
            <div className="mb-3">
              <CoinFlipNote>
                지금 걸려 있는 등급이 경계선입니다. 이 구간에서는 차분 자체도 불안정해서,
                아래 숫자들이 뒤집힐 수 있습니다.
              </CoinFlipNote>
            </div>
          ) : null}

          <ul className="flex flex-col gap-2">
            {rows.map((r) => {
              const gain = r.balanceDelta > 0;
              return (
                <li
                  key={r.scenario}
                  className="rounded-xl border border-[var(--e-border)] px-3 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-[13.5px] font-semibold text-[var(--e-ink)]">{r.scenario}</span>
                    <span
                      className="shrink-0 rounded-full px-2 py-[3px] text-[11px] font-semibold tabular-nums"
                      style={{
                        background: gain
                          ? 'color-mix(in srgb, var(--e-secured) 15%, transparent)'
                          : 'color-mix(in srgb, var(--e-lost) 13%, transparent)',
                        color: gain ? 'var(--e-secured)' : 'var(--e-lost)',
                      }}
                    >
                      {gain ? '+' : '−'}{score(Math.abs(r.balanceDelta))}점
                    </span>
                  </div>

                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--e-ink-2)]">
                    {r.gradeShift}
                  </p>

                  {r.pivotGrade && r.probBefore != null && r.probAfter != null ? (
                    <div className="mt-2.5 flex items-center gap-2 text-[12px]">
                      <span className="text-[var(--e-muted)]">{atLeastText(r.pivotGrade)}</span>
                      <span className="flex items-center gap-1.5 tabular-nums">
                        <span className="text-[var(--e-ink-2)]">{pctText(r.probBefore)}</span>
                        <Icon name="chevron" className="h-3 w-3 text-[var(--e-muted)]" />
                        <b className="font-semibold text-[var(--e-ink)]">{pctText(r.probAfter)}</b>
                      </span>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* 가정을 숨기지 않는다 — 감점 폭은 강의계획서마다 다르다 */}
      <div className="mt-4 rounded-xl bg-[var(--e-surface-2)] px-3 py-3">
        <div className="mb-2 flex items-center gap-1.5">
          <Icon name="info" className="h-3.5 w-3.5 text-[var(--e-muted)]" />
          <span className="text-[12px] font-semibold text-[var(--e-ink-2)]">이 계산이 깔고 있는 가정</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-[12px] text-[var(--e-ink-2)]">
          <span>결석 1회 =</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={50}
            value={assumptions.penaltyPerAbsence}
            onChange={(e) =>
              onAssumptions({ ...assumptions, penaltyPerAbsence: Number(e.target.value) || 0 })
            }
            aria-label="결석 1회당 감점"
            className="w-14 rounded-lg border border-[var(--e-border-strong)] bg-[var(--e-surface)] px-2 py-1 text-right tabular-nums outline-none focus:border-[var(--e-accent)]"
          />
          <span>점 감점,</span>
          <span>지각</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={10}
            value={assumptions.latePerAbsence}
            onChange={(e) =>
              onAssumptions({ ...assumptions, latePerAbsence: Number(e.target.value) || 1 })
            }
            aria-label="지각 몇 회가 결석 1회인지"
            className="w-14 rounded-lg border border-[var(--e-border-strong)] bg-[var(--e-surface)] px-2 py-1 text-right tabular-nums outline-none focus:border-[var(--e-accent)]"
          />
          <span>회 = 결석 1회</span>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-[var(--e-muted)]">
          기본값은 흔한 경우를 넣어둔 것뿐입니다. 강의계획서 숫자로 바꾸면 위 결과가 같이 바뀝니다.
        </p>
      </div>

      <div className="mt-3">
        <Badge tone="neutral" icon="info">
          등급을 확정해 알려주지 않는 건 못 해서가 아니라, 그렇게 말할 근거가 없어서입니다
        </Badge>
      </div>
    </Card>
  );
}
