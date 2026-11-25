'use client';
import { useRef, useState, type ReactNode } from 'react';

/**
 * Figma BOKAK v6 (106:8 / 106:11) 4칸 슬리브 포켓 페이지.
 * 넘김 모션 스펙: translateX -60% + rotateY -38°, 280ms, cubic-bezier(.22,.61,.36,1),
 * 가로 이동이 폭의 40%를 넘으면 자동 완료, 미만이면 복귀.
 */
const THRESHOLD = 0.4;

export function BinderPage({ items, emptySlot, perPage = 4, label }: {
  items: ReactNode[]; emptySlot?: ReactNode; perPage?: number; label: string;
}) {
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const [page, setPage] = useState(0);
  const [drag, setDrag] = useState(0);
  const [flip, setFlip] = useState<'next' | 'prev' | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const from = useRef<number | null>(null);

  const current = Math.min(page, pages - 1);
  const slice = items.slice(current * perPage, current * perPage + perPage);
  const slots = Array.from({ length: perPage }, (_, i) => slice[i]);
  const lastPage = current === pages - 1;

  function turn(direction: 'next' | 'prev') {
    const target = direction === 'next' ? current + 1 : current - 1;
    if (target < 0 || target >= pages) { setDrag(0); return; }
    setFlip(direction);
    setDrag(0);
    window.setTimeout(() => { setPage(target); setFlip(null); }, 280);
  }

  function onDown(event: React.PointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    from.current = event.clientX;
  }
  function onMove(event: React.PointerEvent) {
    if (from.current === null) return;
    const width = area.current?.clientWidth ?? 1;
    const delta = (event.clientX - from.current) / width;
    if (Math.abs(delta) > 0.02) setDrag(Math.max(-1, Math.min(1, delta)));
  }
  function onUp() {
    if (from.current === null) return;
    const delta = drag;
    from.current = null;
    if (delta <= -THRESHOLD) turn('next');
    else if (delta >= THRESHOLD) turn('prev');
    else setDrag(0);
  }

  const dragging = drag !== 0;
  const style = flip
    ? undefined
    : dragging ? { transform: `translateX(${drag * 60}%) rotateY(${drag * 38}deg)` } : undefined;

  return <div className="bk-binder-board" aria-label={label}>
    <span className="bk-rings" aria-hidden="true"><i/><i/><i/></span>
    <div className="bk-flip-area" ref={area}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={onUp}>
      <div className="bk-sleeve-page" data-flip={flip ?? undefined} data-dragging={dragging ? '' : undefined} style={style}>
        {slots.map((node, i) => <div className="bk-pocket" key={i}>
          {node ?? (lastPage && emptySlot ? emptySlot : <span className="bk-pocket-empty" aria-hidden="true"/>)}
          <span className="bk-pocket-lip" aria-hidden="true"/>
        </div>)}
      </div>
      {pages > 1 ? <span className="bk-swipe-hint" aria-hidden="true">옆으로 쓸어 넘기기</span> : null}
    </div>
    <div className="bk-page-nav">
      <button type="button" onClick={() => turn('prev')} disabled={current === 0}>‹ 이전 장</button>
      <span aria-live="polite">{current + 1} / {pages}</span>
      <button type="button" onClick={() => turn('next')} disabled={current >= pages - 1}>다음 장 ›</button>
    </div>
  </div>;
}
