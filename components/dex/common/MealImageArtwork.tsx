'use client';
import { useState } from 'react';
import { CollectionArtwork } from './CollectionArtwork';
import type { ArtworkKind } from './CollectionArtwork';
import { foodArtSource } from '@/lib/dex/meal/artwork-assets';
import type { ArtworkMode } from '@/lib/dex/meal/artwork-assets';

/** Optional visual layer. Missing/unmapped images retain the existing SVG. */
export function MealImageArtwork({kind,mode='svg'}:{kind:ArtworkKind;mode?:ArtworkMode}){
  const source=foodArtSource(kind);
  return mode==='svg'||!source?<CollectionArtwork kind={kind}/>:<ImageCandidate key={source} kind={kind} source={source} soft={mode==='soft'}/>;
}
function ImageCandidate({kind,source,soft}:{kind:ArtworkKind;source:string;soft:boolean}){
  const [failed,setFailed]=useState(false);
  if(failed)return <CollectionArtwork kind={kind}/>;
  return <div className={'dex-art dex-art--'+kind+' dex-food-image'+(soft?' is-soft':'')} role="img" aria-label="음식 일러스트 후보">
    {/* Local transparent artwork: preserve its aspect ratio and switch immediately on load failure. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={source} alt="" width={1280} height={1280} loading="lazy" onError={()=>setFailed(true)}/>
  </div>;
}
