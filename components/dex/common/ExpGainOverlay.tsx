'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { levelFromExp, totalExp } from '@/lib/dex/game/exp';
import { useDexDocument } from '@/components/dex/scaffold/useDexDocument';

const FILL_MS = 800, HOLD_MS = 2200;
const ratio = (level: ReturnType<typeof levelFromExp>) => level.isMaxLevel ? 1 : level.expIntoLevel / level.expForNextLevel;
const won = (exp: number) => exp.toLocaleString('ko-KR');

/** EXP the gauge should start from, or null: a first read, a hidden tab (another tab's save) or no net gain only moves the baseline. Quick successive gains merge. */
export function expGainStart(before: number | null, exp: number, pending: number | null, visible: boolean) {
  const from = before === null || !visible ? null : pending ?? before;
  return from !== null && exp > from ? from : null;
}

/** Center EXP gauge for any rise in total EXP: new items, grade upgrades and courses alike, since EXP is derived from records. */
export function ExpGainOverlay() {
  const { data } = useDexDocument();
  const exp = data ? totalExp(data) : null;
  const last = useRef<number | null>(null), pending = useRef<number | null>(null);
  const [gain, setGain] = useState<{ from: number; to: number; id: number } | null>(null);
  const close = useCallback(() => setGain(null), []);
  useEffect(() => {
    if (exp === null) return;
    const start = expGainStart(last.current, exp, pending.current, document.visibilityState === 'visible');
    last.current = exp;
    pending.current = start;
    if (start === null) return;
    let timer = 0;
    const play = () => {
      // The save's own card reveal (a modal dialog) goes first; the gauge follows once it closes.
      if (document.querySelector('dialog[open]')) { timer = window.setTimeout(play, 300); return; }
      pending.current = null;
      setGain(shown => ({ from: shown?.from ?? start, to: exp, id: (shown?.id ?? 0) + 1 }));
    };
    timer = window.setTimeout(play, 500);
    return () => window.clearTimeout(timer);
  }, [exp]);
  return <div className="dex-exp-gain-layer" role="status">{gain ? <ExpGauge key={gain.id} from={gain.from} to={gain.to} onDone={close}/> : null}</div>;
}

/** A level-up fills the old level to the end, then the new level from empty. Phases run on timers so reduced motion still advances. */
export function ExpGauge({ from, to, onDone }: { from: number; to: number; onDone: () => void }) {
  const before = levelFromExp(from), after = levelFromExp(to), leveled = after.level > before.level;
  const [up, setUp] = useState(false);
  useEffect(() => {
    const timers = [window.setTimeout(onDone, (leveled ? 2 : 1) * FILL_MS + HOLD_MS)];
    if (leveled) timers.push(window.setTimeout(() => setUp(true), FILL_MS));
    return () => timers.forEach(timer => window.clearTimeout(timer));
  }, [leveled, onDone]);
  const filling = leveled && !up, shown = filling ? before : after;
  const bar = { '--from': up ? 0 : ratio(before), '--to': filling ? 1 : ratio(after) } as CSSProperties;
  return <div className={`dex-exp-gain${up ? ' is-up' : ''}`} onClick={onDone}>
    <span className="dex-eyebrow">{up ? '레벨 업!' : '경험치 획득'}</span>
    <strong>+{won(to - from)} EXP</strong>
    <p>Lv.{shown.level} {shown.title}</p>
    <div className="dex-exp-gain-bar" aria-hidden="true"><span key={String(up)} style={bar}/></div>
    <p className="dex-small dex-muted">{filling ? `총 ${won(to)} EXP` : after.isMaxLevel ? `최고 레벨 달성 · 총 ${won(to)} EXP` : `다음 Lv.${after.level + 1}까지 ${won(after.expToNextLevel)} EXP`}</p>
  </div>;
}
