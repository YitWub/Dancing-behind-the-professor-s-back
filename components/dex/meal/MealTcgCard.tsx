'use client';
import Link from 'next/link';
import { MealImageArtwork } from '@/components/dex/common/MealImageArtwork';
import { mealArtwork } from '@/components/dex/common/CollectionArtwork';
import { splitMenuLabel } from '@/lib/dex/meal/presentation';
import type { CardEdition } from '@/lib/dex/meal/card-editions';

/** Figma BOKAK v6 (160:262) 학식 카드. 수치는 실제 기록에서만 만든다. */
export function MealTcgCard({ name, edition, ratings, visits, acquiredOn, index, total, href }: {
  name: string; edition?: CardEdition; ratings: number[]; visits: number;
  acquiredOn: string; index: number; total: number; href: string;
}) {
  const rated = ratings.filter(value => Number.isFinite(value));
  const hp = rated.length ? Math.round((rated.reduce((sum, v) => sum + v, 0) / rated.length) * 20) : null;
  const first = rated.length ? Math.round(rated[rated.length - 1] * 20) : null;
  const revisit = Math.min(60, Math.max(0, visits - 1) * 10);
  const label = splitMenuLabel(name);

  return <Link href={href} className="bk-card" data-edition={(edition ?? 'normal').toLowerCase()}>
    <span className="bk-card-inner">
      <span className="bk-card-top">
        <span className="bk-card-no">{String(index + 1).padStart(3, '0')} / {total}</span>
        <span className="bk-card-hp">{hp === null ? 'HP —' : `HP ${hp}`}</span>
      </span>
      <strong className="bk-card-name">{label.title}</strong>
      <span className="bk-card-art bk-card-art--image" aria-hidden="true">
        <MealImageArtwork name={name} kind={mealArtwork(name)} />
      </span>
      <span className="bk-card-policy">{edition ?? '에디션 확인 필요'}</span>
      <span className="bk-card-moves">
        <span className="bk-card-move">
          <i aria-hidden="true"/><b>첫 입</b>
          <em>{first === null ? '평가 없음' : '별점 기준'}</em>
          <u>{first === null ? '—' : first}</u>
        </span>
        <span className="bk-card-move">
          <i aria-hidden="true"/><b>재방문</b>
          <em>{visits}회 기록</em>
          <u>{revisit}</u>
        </span>
      </span>
      <span className="bk-card-bottom">
        <span>첫 기록 {acquiredOn}</span>
        <span className="bk-card-edition">{visits}장</span>
      </span>
    </span>
  </Link>;
}
