'use client';
import { useState } from 'react';

function PhotoFallback({urls,name}:{urls:string[];name:string}) {
  const [index,setIndex]=useState(0);
  if(!urls[index])return <div className="flex h-36 items-center justify-center rounded-xl bg-[var(--e-surface-2)] text-sm text-[var(--e-muted)]" aria-label={`${name} 사진 없음`}>🍽️ 사진이 없습니다</div>;
  // 원본/로컬 URL 전환과 이미지 누락 처리를 위해 기본 img를 사용한다.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={urls[index]} alt={name} loading="lazy" className="h-36 w-full rounded-xl object-cover" onError={()=>setIndex(n=>n+1)}/>;
}
export function MealPhoto({imageUrl,imageSourceUrl,name}:{imageUrl?:string|null;imageSourceUrl?:string|null;name:string}) {
  const urls=[...new Set([imageUrl,imageSourceUrl].filter((url):url is string=>!!url&&/^(\/[^/]|https?:\/\/)/.test(url)))];
  return <PhotoFallback key={JSON.stringify(urls)} urls={urls} name={name}/>;
}
