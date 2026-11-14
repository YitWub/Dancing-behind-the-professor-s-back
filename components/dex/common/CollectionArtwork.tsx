import type { ReactNode } from 'react';

export type ArtworkKind = 'food'|'noodles'|'rice'|'stew'|'cutlet'|'people'|'custom';
/** Conservative visual hint only: never used for identity or menu classification in storage. */
export function mealArtwork(name:string):ArtworkKind {
  if(/돈까스|돈가스|커틀릿/.test(name))return 'cutlet';
  if(/국수|우동|라면|파스타|막국수|쌀국수|짜장면|짬뽕/.test(name))return 'noodles';
  if(/찌개|탕|전골/.test(name))return 'stew';
  if(/볶음밥|비빔밥|덮밥|오므라이스/.test(name))return 'rice';
  return 'food';
}
const LABELS:Record<ArtworkKind,string>={food:'음식',noodles:'면 요리',rice:'밥 요리',stew:'국물 요리',cutlet:'커틀릿 요리',people:'인연',custom:'추억 노트'};
export function CollectionArtwork({kind='food',locked=false,children}:{kind?:ArtworkKind;locked?:boolean;children?:ReactNode}) {
  return <div className={`dex-art dex-art--${kind}${locked?' dex-art--locked':''}`} role="img" aria-label={`${LABELS[kind]} 심볼${locked?' · 미수집':''}`}>
    {children??<svg viewBox="0 0 240 180" aria-hidden="true" fill="none">
      <ellipse cx="120" cy="151" rx="66" ry="9" fill="currentColor" opacity=".09"/>
      <circle cx="52" cy="49" r="24" fill="white" opacity=".5"/><circle cx="189" cy="121" r="30" fill="white" opacity=".45"/>
      <path d="m183 30 3 9 9 3-9 3-3 9-3-9-9-3 9-3Z M44 111l2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" fill="currentColor" opacity=".35"/>
      <g className="dex-art-symbol" stroke="#385b49" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
        {kind==='people'?<><path d="M53 139c0-29 19-40 40-40s37 11 37 40" fill="#f1c59b"/><circle cx="93" cy="72" r="26" fill="#fff6dd"/><path d="M117 139c0-26 17-35 36-35s34 9 34 35" fill="#c3c3e9"/><circle cx="153" cy="82" r="23" fill="#fff6dd"/><path d="m116 47 6-9 7 9"/></>:kind==='custom'?<><path d="m69 45 86-9 18 111-86 9Z" fill="#d3c8eb"/><path d="m62 42 84-9 17 111-84 9Z" fill="#fff6dd"/><path d="m79 62 51-6M82 76l35-4M92 43l13 106"/><path d="m119 94 6 12 13 1-10 9 2 13-12-6-11 6 1-13-10-9 14-2Z" fill="#eab963"/></>:<>
          <path d="M57 98c4 34 25 51 63 51s59-17 63-51" fill={kind==='cutlet'?'#f7ecd0':'#fffdf4'}/>
          <ellipse cx="120" cy="98" rx="63" ry="19" fill={kind==='stew'?'#e9a575':'#f1d69f'}/>
          {kind==='cutlet'?<><path d="M81 91c0-20 62-24 73-5 15 26-71 36-73 5Z" fill="#d6a05d"/><path d="m98 80 8 27m9-29 8 27m8-24 7 20" stroke="#ab753c"/><path d="m155 87 15-10 8 11-15 11" fill="#a8bd83"/></>:kind==='rice'?<><path d="M76 96c6-41 80-41 88 0" fill="#fff9e6"/><ellipse cx="122" cy="85" rx="24" ry="15" fill="#fffdf4"/><circle cx="122" cy="85" r="10" fill="#edba55"/><path d="m88 91 6-4m58 6-5-5" stroke="#6c9b6d"/></>:kind==='noodles'?<><path d="M83 92c23-20 46 20 71-1M84 99c24-20 46 20 72-1M88 105c22-17 42 17 61-1" stroke="#c58f43"/><path d="m149 76 34-46m-25 50 35-46" stroke="#a16c44"/><path d="M102 61c-12-12 11-16 0-28" stroke="#fffdf4"/></>:kind==='stew'?<><ellipse cx="103" cy="94" rx="12" ry="7" fill="#fff1c9"/><path d="m132 84 13 3-4 12-13-4" fill="#a7b97e"/><path d="M103 65c-12-12 10-15 0-26m26 22c-12-12 10-15 0-26" stroke="#fffdf4"/></>:<><path d="M87 98c4-33 61-35 65 0" fill="#fff9e6"/><path d="m103 85 12 6 15-11" stroke="#92b782"/><circle cx="144" cy="100" r="7" fill="#eab98d"/></>}
          <path d="M104 117h32" opacity=".35"/>
        </>}
      </g>
    </svg>}
    {locked?<span className="dex-lock">미수집</span>:null}
  </div>;
}
