'use client';

/* ==========================================================================
 *  학점 화면 본체
 * --------------------------------------------------------------------------
 *  과목 목록과 v2 관리가 기본 진입점이다.
 *  기존 빠른 진단은 저장 키와 계산 경로를 유지한 접이식 보조 메뉴다.
 * ========================================================================== */

import { useEffect, useRef, useState } from 'react';
import type { QuickInput, WhatIfAssumptions } from '@/components/mock';
import { DEFAULT_ASSUMPTIONS, diagnose } from '@/components/mock';
import { Meter } from '@/components/charts';
import { Card, SectionTitle } from '@/components/ui';
import { GradeResult } from '@/components/grade/GradeResult';
import { WhatIfPanel } from '@/components/grade/WhatIfPanel';
import { CourseList } from '@/components/grade/CourseList';

const STORAGE_KEY = 'erica.grade.quick.v1';

type Draft = {
  myScore: string;
  mean: string;
  stdev: string;
  enrolled: string;
  maxScore: string;
};

const EMPTY: Draft = { myScore: '', mean: '', stdev: '', enrolled: '', maxScore: '100' };

function num(s: string): number | null {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function GradeScreen() {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [quickReady, setQuickReady] = useState(false);
  const [assumptions, setAssumptions] = useState<WhatIfAssumptions>(DEFAULT_ASSUMPTIONS);
  const stdevRef = useRef<HTMLInputElement>(null);

  // 브라우저 저장은 "다시 켰을 때 다시 안 쓰게" 하는 편의일 뿐이라
  // 실패해도 화면은 그대로 동작해야 한다.
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            const restored = { ...EMPTY };
            for (const key of Object.keys(EMPTY) as (keyof Draft)[]) {
              if (key in parsed && typeof (parsed as Record<string, unknown>)[key] === 'string') {
                restored[key] = (parsed as Record<string, string>)[key];
              }
            }
            setDraft(restored);
          }
        }
      } catch {
        /* 저장소를 못 읽어도 그냥 빈 칸에서 시작하면 된다 */
      }
      setQuickReady(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!quickReady) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } catch {
      /* 시크릿 모드 등 — 무시 */
    }
  }, [draft, quickReady]);

  const input: QuickInput = {
    myScore: num(draft.myScore),
    mean: num(draft.mean),
    stdev: num(draft.stdev),
    enrolled: num(draft.enrolled),
    maxScore: num(draft.maxScore) ?? 100,
  };

  const result = diagnose(input);
  const set = (k: keyof Draft) => (v: string) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <div className="flex flex-col gap-3">
      <CourseList />
      <details className="rounded-2xl border border-[var(--e-border)] bg-[var(--e-surface)] p-4">
        <summary className="cursor-pointer text-[14px] font-semibold">간단 성적 분석</summary>
        <div className="mt-3 flex flex-col gap-3">
      {/* ── 3칸 진단 ───────────────────────────────────────────────────── */}
      <Card className="p-4">
        <SectionTitle
          title="칸 세 개면 됩니다"
          hint="로그인도, 과목 등록도 필요 없습니다. 넣는 대로 바로 아래가 바뀝니다"
        />

        <div className="grid grid-cols-3 gap-2">
          <BigField label="내 점수" value={draft.myScore} onChange={set('myScore')} placeholder="78" />
          <BigField label="반 평균" value={draft.mean} onChange={set('mean')} placeholder="71" />
          <BigField label="표준편차" value={draft.stdev} onChange={set('stdev')} placeholder="12" inputRef={stdevRef} />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <SmallField label="수강인원" value={draft.enrolled} onChange={set('enrolled')} placeholder="선택" />
          <SmallField label="만점" value={draft.maxScore} onChange={set('maxScore')} placeholder="100" />
          {draft.myScore || draft.mean || draft.stdev ? (
            <button
              type="button"
              onClick={() => setDraft(EMPTY)}
              className="ml-auto text-[12px] text-[var(--e-muted)] underline underline-offset-2"
            >
              지우기
            </button>
          ) : null}
        </div>

        <div className="mt-4">
          <Meter
            value={result.completeness.now}
            label="입력 완성도"
            caption={
              result.completeness.next
                ? `${result.completeness.next.label}을(를) 넣으면 ${result.completeness.next.to}%까지 올라갑니다. 이건 확률이 아니라 "칸을 얼마나 채웠나"입니다.`
                : '넣을 수 있는 건 다 넣었습니다. 여기서 더 정밀해지려면 과목 단위로 들어가야 합니다.'
            }
          />
        </div>
      </Card>

      {/* ── 등급 출력 3층 ───────────────────────────────────────────────── */}
      <GradeResult
        result={result}
        maxScore={input.maxScore}
        myScore={input.myScore}
        onFocusStdev={() => {
          stdevRef.current?.focus();
          stdevRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }}
      />

      {/* ── 주인공 ─────────────────────────────────────────────────────── */}
      <WhatIfPanel input={input} assumptions={assumptions} onAssumptions={setAssumptions} />

        </div>
      </details>
    </div>
  );
}

/* ── 입력 칸 ─────────────────────────────────────────────────────────────── */

function BigField({
  label, value, onChange, placeholder, autoFocus, inputRef,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11.5px] font-medium text-[var(--e-muted)]">{label}</span>
      <input
        ref={inputRef}
        type="number"
        inputMode="decimal"
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-[var(--e-border-strong)] bg-[var(--e-surface)] px-3 py-3 text-center text-[20px] font-semibold tabular-nums text-[var(--e-ink)] outline-none placeholder:font-normal placeholder:text-[var(--e-border-strong)] focus:border-[var(--e-accent)]"
      />
    </label>
  );
}

function SmallField({
  label, value, onChange, placeholder,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-[12px] text-[var(--e-muted)]">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-20 rounded-lg border border-[var(--e-border)] bg-[var(--e-surface)] px-2 py-1.5 text-center text-[13px] tabular-nums text-[var(--e-ink)] outline-none placeholder:text-[var(--e-border-strong)] focus:border-[var(--e-accent)]"
      />
    </label>
  );
}
