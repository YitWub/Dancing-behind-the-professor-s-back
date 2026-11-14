'use client';
import { useState } from 'react';
/** Decorative achievement art; failed assets keep the engine-supplied symbol. */
export function AchievementArtwork({source='/dex/achievements/default.webp',icon}:{source?:string;icon:string}){
  const [failed,setFailed]=useState(false);
  return source&&!failed?
    // eslint-disable-next-line @next/next/no-img-element
    <img className="dex-stamp-illustration" src={source} alt="" width={128} height={128} loading="lazy" onError={()=>setFailed(true)}/>:<span className="dex-stamp-symbol">{icon}</span>;
}
