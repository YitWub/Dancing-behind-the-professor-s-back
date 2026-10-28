'use client';

/* ==========================================================================
 *  꿀강 탐색 목록
 * --------------------------------------------------------------------------
 *  꿀강지수 정렬에서는 신뢰도 낮은 강의가 언제나 뒤로 밀린다.
 *  반대로 '별점순'은 일부러 보정하지 않는다 — 보정 안 한 순위가 어떻게
 *  망가지는지 보여주는 게 이 화면의 논증이기 때문이다.
 * ========================================================================== */

import { useEffect, useMemo, useState } from 'react';
import type { Lecture } from '@/lib/types';
import type { LectureSort } from '@/components/data';
import { applyLectureQuery, loadLectures } from '@/components/data';
import { confidenceLabel } from '@/components/format';
import { Card, EmptyNote, Icon, PillTabs, SectionTitle, SourceBanner } from '@/components/ui';
import { LectureCard } from '@/components/honey/LectureCard';
import { SeedNotice } from '@/components/honey/Reliability';

const TYPES = ['전공필수', '전공선택', '교양필수', '교양선택', '일반선택'] as const;

const SORTS: { value: LectureSort; label: string }[] = [
  { value: 'honey', label: '꿀강지수' },
  { value: 'rating', label: '별점순' },
  { value: 'generosity', label: '학점 후함' },
  { value: 'workload', label: '과제 적음' },
];

export function HoneyScreen() {
  const [q, setQ] = useState('');
  const [type, setType] = useState<string>('');
  const [sort, setSort] = useState<LectureSort>('honey');
  const [showCompare, setShowCompare] = useState(false);

  const [raw, setRaw] = useState<Lecture[]>([]);
  const [source, setSource] = useState<'api' | 'mock'>('api');
  const [note, setNote] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadLectures({ q, type: type || undefined, sort }).then((r) => {
      if (!alive) return;
      setRaw(r.data);
      setSource(r.source);
      setNote(r.note);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [q, type, sort]);

  const query = useMemo(() => ({ q, type: type || undefined }), [q, type]);
  const list = useMemo(() => applyLectureQuery(raw, { ...query, sort }), [raw, query, sort]);
  const byRating = useMemo(() => applyLectureQuery(raw, { ...query, sort: 'rating' }), [raw, query]);
  const byHoney = useMemo(() => applyLectureQuery(raw, { ...query, sort: 'honey' }), [raw, query]);

  const lowCount = list.filter((l) => l.reliability.band === 'low').length;

  return (
    <div className="flex flex-col gap-3">
      {/* 필터 한 줄 */}
      <Card className="p-3">
        <label className="flex items-center gap-2 rounded-xl bg-[var(--e-surface-2)] px-3 py-2">
          <Icon name="chevron" className="h-3.5 w-3.5 rotate-90 text-[var(--e-muted)]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="강의명 · 교수 · 학과"
            aria-label="강의 검색"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-[var(--e-ink)] outline-none placeholder:text-[var(--e-muted)]"
          />
          {q ? (
            <button type="button" onClick={() => setQ('')} className="text-[12px] text-[var(--e-muted)]">
              지우기
            </button>
          ) : null}
        </label>

        <div className="mt-2.5 flex gap-1.5 overflow-x-auto pb-1">
          <Chip on={type === ''} onClick={() => setType('')}>전체</Chip>
          {TYPES.map((t) => (
            <Chip key={t} on={type === t} onClick={() => setType(type === t ? '' : t)}>
              {t}
            </Chip>
          ))}
        </div>

        <div className="mt-2.5">
          <PillTabs value={sort} options={SORTS} onChange={setSort} ariaLabel="정렬 기준" />
        </div>
      </Card>

      <SourceBanner source={source} note={note} />
      {raw[0] ? <SeedNotice lecture={raw[0]} /> : null}

      {/* ★ 발표 데모의 핵심 장면 */}
      <SortCompare
        byRating={byRating}
        byHoney={byHoney}
        open={showCompare}
        onToggle={() => setShowCompare((v) => !v)}
      />

      {/* 별점순은 보정하지 않은 순위라는 걸 숨기지 않는다 */}
      {sort === 'rating' ? (
        <p
          className="flex items-start gap-1.5 rounded-xl px-3 py-2.5 text-[12px] leading-snug"
          style={{ background: 'color-mix(in srgb, var(--e-warn) 16%, transparent)', color: 'var(--e-ink)' }}
        >
          <Icon name="warn" className="mt-[1px] h-3.5 w-3.5 shrink-0" />
          <span>
            <b className="font-semibold">지금은 보정을 끈 순위입니다.</b>{' '}
            별점 평균만 그대로 줄 세웠기 때문에 강의평 몇 건짜리가 위로 올라옵니다.
            비교해 보라고 남겨둔 정렬이지 추천 순서가 아닙니다.
          </span>
        </p>
      ) : lowCount > 0 ? (
        <p
          className="flex items-start gap-1.5 rounded-xl px-3 py-2.5 text-[12px] leading-snug"
          style={{ background: 'color-mix(in srgb, var(--e-warn) 14%, transparent)', color: 'var(--e-ink)' }}
        >
          <Icon name="warn" className="mt-[1px] h-3.5 w-3.5 shrink-0" />
          <span>
            이 중 {lowCount}개는 강의평이 모자라 지수를 가려뒀습니다. 이런 강의는 위로 올라오지 않습니다.
          </span>
        </p>
      ) : null}

      {loading ? (
        <EmptyNote>불러오는 중…</EmptyNote>
      ) : list.length === 0 ? (
        <EmptyNote>조건에 맞는 강의가 없습니다.</EmptyNote>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {list.map((l) => (
            <LectureCard key={l.id} lecture={l} />
          ))}
        </ul>
      )}

      <Card className="p-4">
        <SectionTitle title="이 목록을 읽는 법" />
        <ul className="flex flex-col gap-2 text-[12px] leading-relaxed text-[var(--e-ink-2)]">
          <li>· 꿀강지수는 신뢰도만큼 가운데(50)로 끌어당긴 값입니다. 표본이 적을수록 50에 가까워집니다.</li>
          <li>· 별점 평균이 높아도 강의평이 적으면 지수를 가립니다. 몇 명이 좋다고 한 건 아직 아무것도 아닙니다.</li>
          <li>· 축 값과 요약은 강의평 본문에서 뽑은 것이라 눈금이 정확하지 않습니다.</li>
        </ul>
      </Card>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 *  정렬 비교 — "왜 별점 평균을 믿으면 안 되는가"를 말이 아니라 화면으로
 * ────────────────────────────────────────────────────────────────────────── */

function SortCompare({
  byRating, byHoney, open, onToggle,
}: { byRating: Lecture[]; byHoney: Lecture[]; open: boolean; onToggle: () => void }) {
  if (byRating.length === 0) return null;

  const left = byRating.slice(0, 5);
  const right = byHoney.slice(0, 5);
  const shakyInRating = left.filter((l) => l.reliability.band !== 'high').length;

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3.5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold text-[var(--e-ink)]">
            별점순 vs 꿀강순, 같은 데이터인데 다릅니다
          </span>
          <span className="mt-0.5 block text-[12px] leading-snug text-[var(--e-muted)]">
            {open ? '접기' : '상위 5개를 나란히 놓고 보기'}
          </span>
        </span>
        <Icon name="chevron" className={`h-4 w-4 shrink-0 text-[var(--e-muted)] ${open ? 'rotate-90' : ''}`} />
      </button>

      {open ? (
        <div className="border-t border-[var(--e-border)] px-4 py-4">
          <div className="grid grid-cols-2 gap-3">
            <RankColumn title="별점 평균순" subtitle="보정 없음" rows={left} warnLow />
            <RankColumn title="꿀강지수순" subtitle="신뢰도로 축소" rows={right} />
          </div>

          <p className="mt-3.5 rounded-xl bg-[var(--e-surface-2)] px-3 py-2.5 text-[12px] leading-relaxed text-[var(--e-ink-2)]">
            {shakyInRating > 0 ? (
              <>
                왼쪽 상위 5개 중 <b className="font-semibold text-[var(--e-ink)]">{shakyInRating}개</b>는
                강의평이 모자라 평균이 쉽게 흔들리는 강의입니다. 몇 사람이 별 다섯을 주면 그대로 1위가 됩니다.
                오른쪽은 표본이 적을수록 점수를 가운데로 끌어당겨서, 같은 데이터로도 순위가 달라집니다.
              </>
            ) : (
              <>
                지금 필터에서는 두 순위가 크게 다르지 않습니다. 표본이 고르면 원래 그렇습니다 —
                차이는 강의평이 적은 강의가 섞일 때 벌어집니다.
              </>
            )}
          </p>
        </div>
      ) : null}
    </Card>
  );
}

function RankColumn({
  title, subtitle, rows, warnLow = false,
}: { title: string; subtitle: string; rows: Lecture[]; warnLow?: boolean }) {
  return (
    <div>
      <p className="text-[12px] font-semibold text-[var(--e-ink)]">{title}</p>
      <p className="mb-2 text-[10.5px] text-[var(--e-muted)]">{subtitle}</p>
      <ol className="flex flex-col gap-1.5">
        {rows.map((l, i) => {
          const shaky = l.reliability.band !== 'high';
          const flag = warnLow && shaky;
          return (
            <li
              key={l.id}
              className="rounded-lg px-2 py-1.5"
              style={{
                background: flag
                  ? 'color-mix(in srgb, var(--e-warn) 16%, transparent)'
                  : 'var(--e-surface-2)',
              }}
            >
              <span className="flex items-start gap-1.5">
                <span className="text-[10.5px] font-bold tabular-nums text-[var(--e-muted)]">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11.5px] font-medium text-[var(--e-ink)]">{l.name}</span>
                  <span className="mt-0.5 block text-[10px] tabular-nums text-[var(--e-muted)]">
                    강의평 {l.reviewCount}건 · {confidenceLabel(l.reliability.band)}
                  </span>
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className="shrink-0 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors"
      style={{
        background: on ? 'var(--e-accent)' : 'var(--e-surface)',
        color: on ? '#fff' : 'var(--e-ink-2)',
        borderColor: on ? 'var(--e-accent)' : 'var(--e-border)',
      }}
    >
      {children}
    </button>
  );
}
