'use client';
import { useEffect, useRef, useState } from 'react';

const HOLD_MS = 600; // Figma 구현 스펙(106:29) · 길게 누르기 0.6초

/** 탭 1회로는 확정되지 않는다. 0.6초 눌러야 수집이 성립한다. 키보드는 Enter/Space 1회로 확정. */
export function HoldButton({ onConfirm, disabled, children, holdLabel = '꾹 눌러 수집', className = '' }: {
  onConfirm: () => void; disabled?: boolean; children: React.ReactNode; holdLabel?: string; className?: string;
}) {
  const [progress, setProgress] = useState(0);
  const raf = useRef(0);
  const start = useRef(0);
  const done = useRef(false);

  const stop = () => { cancelAnimationFrame(raf.current); setProgress(0); };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  function begin() {
    if (disabled) return;
    done.current = false;
    start.current = performance.now();
    const tick = () => {
      const p = Math.min(1, (performance.now() - start.current) / HOLD_MS);
      setProgress(p);
      if (p >= 1) { done.current = true; setProgress(0); onConfirm(); return; }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }

  return <button
    type="button"
    className={`bk-hold ${className}`}
    disabled={disabled}
    aria-describedby="bk-hold-hint"
    data-holding={progress > 0 ? '' : undefined}
    onPointerDown={event => { try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 합성 포인터는 캡처가 안 될 수 있다 */ } begin(); }}
    onPointerUp={stop}
    onPointerLeave={stop}
    onPointerCancel={stop}
    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!disabled) onConfirm(); } }}
  >
    <span className="bk-hold-fill" style={{ width: `${progress * 100}%` }} aria-hidden="true"/>
    <span className="bk-hold-label">{children}</span>
    <span className="bk-hold-hint" id="bk-hold-hint">{holdLabel}</span>
  </button>;
}
