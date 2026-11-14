import { CollectionArtwork, mealArtwork } from './CollectionArtwork';
import { splitMenuLabel } from '@/lib/dex/meal/presentation';
import type { DesignSample } from '@/lib/dex/dev/design-samples';

/** Visual-only frame: domain information is supplied by the caller, never persisted here. */
export function DesignPreviewCard({sample,featured=false,selected=false,showRecord=false,onSelect}:{sample:DesignSample;featured?:boolean;selected?:boolean;showRecord?:boolean;onSelect?:()=>void}){
  const title=sample.kind==='meal'?splitMenuLabel(sample.title).title:sample.title;
  const content=<><div className="design-card-art"><CollectionArtwork kind={sample.kind==='meal'?mealArtwork(title):sample.kind==='people'?'people':'custom'}/></div><div className="design-card-copy"><h3>{title}</h3><p className="design-card-meta">{sample.meta}</p>{sample.kind==='meal'&&sample.edition?<span className={`dex-edition-badge dex-edition--${sample.edition.toLowerCase()}`}>{sample.edition}</span>:<span className="design-card-stamp">{sample.stamp}</span>}{showRecord?<p className="design-card-note">{sample.note}</p>:null}</div></>;
  const props={className:`design-card album-card-frame${sample.kind==='meal'&&sample.edition?` album-edition--${sample.edition.toLowerCase()}`:''}${featured?' is-featured':''}`, 'data-edition':sample.kind==='meal'?sample.edition:undefined};
  return onSelect?<button {...props} type="button" aria-pressed={selected} aria-label={`${title} 디자인 카드 선택`} onClick={onSelect}>{content}</button>:<article {...props}>{content}</article>;
}
