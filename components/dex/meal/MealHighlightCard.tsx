import Link from 'next/link';
import type { HighlightSlot } from './highlight-view';
const SYMBOLS:Record<string,string>={most:'↻',rating:'★',first:'✦',recent:'⌁'};
export function MealHighlightCard({slot}:{slot:HighlightSlot}){
  const content=<><div className="dex-record-heading"><span className="dex-record-symbol" aria-hidden="true">{SYMBOLS[slot.id]??'✧'}</span><span className="dex-highlight-label">{slot.title}</span>{slot.memorial?<span className="dex-record-memento">첫 페이지</span>:null}</div>
    <div className="dex-highlight-copy">{slot.card?<><h4 title={slot.card.name}>{slot.card.name}</h4><div className="dex-highlight-meta"><strong>{slot.metric}</strong>{slot.others>0?<span>공동 · 외 {slot.others}종</span>:null}</div></>:<><h4>{slot.emptyTitle}</h4><p>{slot.emptyHint}</p></>}</div>
    {slot.card?<span className="dex-highlight-open">메뉴 기록 보기 <span aria-hidden="true">↗</span></span>:null}</>;
  const classes='dex-highlight-card dex-highlight--'+slot.id+(!slot.card?' is-empty':'');
  return slot.card?<Link className={classes} href={'/dex/meal/collection/'+slot.card.entryIds[0]} aria-label={slot.title+': '+slot.card.name+' 카드 상세'}>{content}</Link>:<div className={classes}>{content}</div>;
}
