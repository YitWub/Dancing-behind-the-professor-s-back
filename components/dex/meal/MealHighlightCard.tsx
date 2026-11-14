import Link from 'next/link';
import { CollectionArtwork, mealArtwork } from '@/components/dex/common/CollectionArtwork';
import type { HighlightSlot } from './highlight-view';
export function MealHighlightCard({slot}:{slot:HighlightSlot}){
  const content=<><span className="dex-highlight-label">{slot.title}</span><div className="dex-highlight-art"><CollectionArtwork kind={slot.card?mealArtwork(slot.card.name):slot.id==='rating'?'rice':'food'}/>{slot.memorial?<span className="dex-first-stamp" aria-hidden="true">✦<small>FIRST</small></span>:null}</div>
    <div className="dex-highlight-copy">{slot.card?<><span className="dex-highlight-badge">{slot.badge}</span><h4 title={slot.card.name}>{slot.card.name}</h4><div className="dex-highlight-meta"><strong>{slot.metric}</strong>{slot.others>0?<span>공동 · 외 {slot.others}종</span>:null}</div></>:<><h4>{slot.emptyTitle}</h4><p>{slot.emptyHint}</p></>}</div>
    {slot.card?<span className="dex-highlight-open">카드 펼쳐보기 <span aria-hidden="true">↗</span></span>:null}</>;
  const classes=`dex-highlight-card dex-highlight--${slot.id}${!slot.card?' is-empty':''}`;
  return slot.card?<Link className={classes} href={`/dex/meal/collection/${slot.card.entryIds[0]}`} aria-label={`${slot.title}: ${slot.card.name} 카드 상세`}>{content}</Link>:<div className={classes}>{content}</div>;
}
