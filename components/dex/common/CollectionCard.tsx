import Link from 'next/link';
import type { ReactNode } from 'react';
import type { RarityTier } from '@/lib/dex/game/types';
import { RarityBadge } from './RarityBadge';
export function CollectionCard({title,artwork,href,locked=false,isNew=false,meta,children,rarity}:{title:string;artwork:ReactNode;href?:string;locked?:boolean;isNew?:boolean;meta?:ReactNode;children?:ReactNode;rarity?:RarityTier}) {
  const content=<><div className="dex-card-top"><span>{locked?'아직 만나지 않은 발견':'나의 컬렉션'}</span>{isNew?<span className="dex-new">NEW</span>:<span aria-hidden="true">✦</span>}</div>{artwork}<div className="dex-card-copy"><h3>{title}</h3>{meta?<div className="dex-card-meta">{meta}</div>:null}{children}</div><div className="dex-card-foot"><span>{locked?'다음 발견을 기다리는 중':'수집 완료'}</span>{href?<span aria-hidden="true">↗</span>:null}</div></>;
  const badge=rarity?<RarityBadge tier={rarity} hidden={locked}/>:null;
  return <article className={`dex-collect-card${locked?' is-locked':rarity?` dex-rarity-frame--${rarity.toLowerCase()}`:''}`}>{href?<Link href={href} className="dex-card-link">{content}{badge}</Link>:<>{content}{badge}</>}</article>;
}
export function CollectionEmptyState({onExplore}:{onExplore?:()=>void}) {
  return <div className="dex-empty"><span className="dex-eyebrow">YOUR FIRST DISCOVERY</span><h3>첫 번째 카드의 주인공은?</h3><p>직접 먹은 메뉴 하나부터.<br/>대학생활의 작은 발견이 나만의 컬렉션이 돼요.</p>{onExplore?<button className="dex-button" onClick={onExplore}>오늘의 발견에서 시작하기 ↗</button>:<Link className="dex-button" href="/dex/meal?view=discover">오늘의 발견에서 시작하기 ↗</Link>}</div>;
}
