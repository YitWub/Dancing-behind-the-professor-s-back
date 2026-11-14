import type { CardEdition } from '@/lib/dex/meal/card-editions';
import { CollectionCard } from './CollectionCard';
import { CollectionArtwork, mealArtwork } from './CollectionArtwork';
import { splitMenuLabel } from '@/lib/dex/meal/presentation';

/** Storage-free presentation shared by the lab and a future real card album. */
export function EditionCollectionCard({name,edition,count,acquiredOn,onSelect,selected=false,preview=false}:{name:string;edition:CardEdition;count?:number;acquiredOn:string;onSelect:()=>void;selected?:boolean;preview?:boolean}){
  const label=splitMenuLabel(name);
  return <div className={`dex-edition-card dex-edition--${edition.toLowerCase()}${selected?' is-selected':''}`}>
    <CollectionCard title={label.title} artwork={<CollectionArtwork kind={mealArtwork(name)}/>} meta={<><span className={`dex-edition-badge dex-edition--${edition.toLowerCase()}`}>{edition}</span><span>{count!==undefined?`보유 ${count}장`:`획득 ${acquiredOn}`}</span></>}>
      {preview?<span className="dex-small dex-muted">TEST · 가상 카드</span>:null}
      <button className="dex-edition-card-open" type="button" aria-pressed={selected} aria-label={`${label.title} ${count!==undefined?'보유 카드 보기':'카드 상세 보기'}`} onClick={onSelect}>{count!==undefined?'보유 카드 보기':'카드 상세 보기'} ↗</button>
    </CollectionCard>
  </div>;
}
