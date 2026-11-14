'use client';
import { useState } from 'react';
import { CollectionArtwork } from './CollectionArtwork';
import type { ArtworkKind } from './CollectionArtwork';
import { foodArtSource } from '@/lib/dex/meal/artwork-assets';
import type { ArtworkMode } from '@/lib/dex/meal/artwork-assets';

/** Optional visual layer. Missing/unmapped images retain the existing SVG. */
export function MealImageArtwork({kind,name,locked=false,mode='image'}:{kind:ArtworkKind;name?:string;locked?:boolean;mode?:ArtworkMode}){
  const source=foodArtSource(kind,name);
  return mode==='svg'||!source?<CollectionArtwork kind={kind} locked={locked}/>:<ImageCandidate key={source} kind={kind} locked={locked} source={source} soft={mode==='soft'}/>;
}
function ImageCandidate({kind,locked,source,soft}:{kind:ArtworkKind;locked:boolean;source:string;soft:boolean}){
  const [failed,setFailed]=useState(false);
  if(failed)return <CollectionArtwork kind={kind} locked={locked}/>;
  return <div className={'dex-art dex-art--'+kind+' dex-food-image'+(soft?' is-soft':'')+(locked?' dex-art--locked':'')} role="img" aria-label="음식 일러스트">
    {/* Local transparent artwork: preserve its aspect ratio and switch immediately on load failure. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={source} alt="" width={1280} height={1280} loading="lazy" onError={()=>setFailed(true)}/>
  </div>;
}
