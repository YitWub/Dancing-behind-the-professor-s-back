import type { ExpGrade } from '@/lib/dex/game/exp';

export function GradeBadge({ grade }: { grade: ExpGrade }) {
  return <span className={`dex-rarity-badge dex-rarity--${grade.id}`}>{grade.label} · {grade.exp} EXP</span>;
}
