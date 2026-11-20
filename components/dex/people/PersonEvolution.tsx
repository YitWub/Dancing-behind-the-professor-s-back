'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DexDocument } from '@/lib/dex/core/types';
import { getBrowserRepository } from '@/lib/dex/storage/browser';
import { personGradeRises } from '@/lib/dex/game/exp';
import { PersonCardFace } from './PersonCard';

type Rise = ReturnType<typeof personGradeRises>[number];

/** Card evolution (GAME_SYSTEM.md 2-C). Call `celebrate(before)` right after a memory or board-link save succeeds; opening, import and drops never call it. */
export function usePersonEvolution() {
  const [rises, setRises] = useState<Rise[]>([]);
  const celebrate = useCallback(async (before: DexDocument) => {
    const after = await getBrowserRepository().snapshot();
    const next = after.ok ? personGradeRises(before, after.value) : [];
    if (next.length) setRises(next);
  }, []);
  const close = useCallback(() => setRises([]), []);
  return [rises.length ? <PersonEvolution rises={rises} onDone={close}/> : null, celebrate] as const;
}

/** One dialog for the whole queue, so the EXP gauge (which waits for open dialogs) follows the last evolution. */
function PersonEvolution({ rises, onDone }: { rises: readonly Rise[]; onDone: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(0), [skip, setSkip] = useState(false);
  useEffect(() => {
    const element = dialog.current, previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    return () => { element?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  const at = Math.min(index, rises.length - 1), { entry, from, to } = rises[at], last = at === rises.length - 1;
  return <dialog ref={dialog} className={`dex-reveal dex-evolution${skip ? ' dex-reveal--skip' : ''}`} aria-labelledby="evolution-title" aria-describedby="evolution-description" onCancel={event => { event.preventDefault(); onDone(); }}>
    <button className="dex-reveal-close" aria-label="진화 알림 닫기" onClick={onDone}>닫기 ×</button>
    <p className="dex-eyebrow">인연 카드 진화{rises.length > 1 ? ` · ${at + 1}/${rises.length}` : ''}</p>
    <h2 id="evolution-title">인연 카드가 진화했어요!</h2>
    <div key={at} className="dex-evolution-stage">
      <div className={`dex-reveal-card dex-evolution-from dex-rarity-frame--${from.id}`} aria-hidden="true"><PersonCardFace entry={entry} grade={from} variant="discovery"/></div>
      <div className={`dex-reveal-card dex-evolution-to dex-rarity-frame--${to.id}`}><PersonCardFace entry={entry} grade={to} variant="discovery"/></div>
    </div>
    <p id="evolution-description">함께한 추억이 쌓여 새로운 등급에 도달했어요.</p>
    <p className="dex-visit-count">{from.label} → {to.label} <span className="dex-tag">EXP +{to.exp - from.exp}</span></p>
    <div className="dex-reveal-actions"><button className="dex-button" onClick={() => last ? onDone() : setIndex(at + 1)}>{last ? '확인' : '다음 진화 보기'}</button><button className="dex-skip" onClick={() => setSkip(true)}>연출 건너뛰기</button></div>
  </dialog>;
}
