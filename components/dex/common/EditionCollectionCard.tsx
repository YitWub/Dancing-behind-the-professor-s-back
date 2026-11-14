import Link from 'next/link';
import type { CardEdition } from '@/lib/dex/meal/card-editions';
import { CollectionArtwork, mealArtwork } from './CollectionArtwork';
import { splitMenuLabel } from '@/lib/dex/meal/presentation';

/** Compact storage-free card. The same presentation is used in real collections and the lab. */
export function EditionCollectionCard({name,edition,count,rating=null,evaluationCount,acquiredOn,href,onSelect,selected=false,preview=false}:{name:string;edition?:CardEdition;count?:number;rating?:number|null;evaluationCount?:number;acquiredOn:string;href?:string;onSelect?:()=>void;selected?:boolean;preview?:boolean}){
  const label=splitMenuLabel(name);
  const content=<><CollectionArtwork kind={mealArtwork(name)}/><div className="dex-card-copy"><h3>{label.title}</h3><div className="dex-card-meta">{edition?<span className={`dex-edition-badge dex-edition--${edition.toLowerCase()}`}>{edition}</span>:<span className="dex-tag">카드 없음</span>}{count!==undefined?<span>보유 {count}장</span>:<time dateTime={acquiredOn}>획득 {acquiredOn}</time>}</div>{evaluationCount!==undefined?<p className="dex-card-rating-summary">평가 {evaluationCount}회</p>:<p className="dex-card-personal-stars" aria-label={rating===null?'이 식사 미평가':`이 식사 별점 ${rating}점`}><span aria-hidden="true">{[1,2,3,4,5].map(n=>rating!==null&&n<=rating?'★':'☆').join('')}</span></p>}</div></>;
  const className='dex-collect-card dex-edition-card-body album-card-frame'+(edition?` album-edition--${edition.toLowerCase()}`:'');
  return <article data-preview={preview||undefined} className={`dex-edition-card dex-edition--${edition?.toLowerCase()??'normal'}${selected?' is-selected':''}`}>
    {href?<Link className={className} href={href} aria-label={`${label.title} ${edition??''} 상세`}>{content}</Link>:onSelect?<button className={className} type="button" aria-pressed={selected} aria-label={`${label.title} ${edition??''} 선택`} onClick={onSelect}>{content}</button>:<div className={className}>{content}</div>}
  </article>;
}
