'use client';
import { kstToday } from '@/lib/datetime';

/** Figma BOKAK v6 홈의 잔디 그리드. 실제 기록 날짜만 쓰고 비어 있는 날은 비워 둔다. */
export function GrassGrid({ dates, days = 120, columns = 12 }: { dates: string[]; days?: number; columns?: number }) {
  const today = kstToday();
  const counts = new Map<string, number>();
  for (const day of dates) counts.set(day, (counts.get(day) ?? 0) + 1);

  const end = new Date(today + 'T00:00:00Z');
  const cells = Array.from({ length: days }, (_, i) => {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - (days - 1 - i));
    const iso = d.toISOString().slice(0, 10);
    const n = counts.get(iso) ?? 0;
    return { iso, n, level: n === 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : n === 3 ? 3 : 4, isToday: iso === today };
  });
  const filled = cells.filter(c => c.n > 0).length;

  return <section className="bk-grass-card" aria-labelledby="bk-grass-heading">
    <header>
      <h2 id="bk-grass-heading">이번 학기 채움</h2>
      <strong>{filled} / {days}칸</strong>
    </header>
    <ol className="bk-grass" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
      {cells.map(c => <li key={c.iso} data-level={c.level} data-today={c.isToday ? '' : undefined}
        title={`${c.iso} · ${c.n === 0 ? '기록 없음' : `${c.n}장`}`}><span className="sr-only">{c.iso} {c.n}장</span></li>)}
    </ol>
    <footer>
      <span>적음</span>
      <i data-level={0}/><i data-level={1}/><i data-level={2}/><i data-level={3}/><i data-level={4}/>
      <span>많음</span>
      <em>점선 = 오늘 열린 칸</em>
    </footer>
  </section>;
}
