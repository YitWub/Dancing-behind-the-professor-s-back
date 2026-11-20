import type { ReactNode } from 'react';

export type ArtworkKind = 'food'|'noodles'|'rice'|'stew'|'cutlet'|'fried-rice'|'rice-bowl'|'curry'|'snack'|'meat'|'people'|'professor'|'custom';
/** Conservative visual hint only: never used for identity or menu classification in storage. */
export function mealArtwork(name:string):ArtworkKind {
  const hints:{kind:ArtworkKind;pattern:RegExp}[]=[
    {kind:'curry',pattern:/카레|커리/},{kind:'snack',pattern:/떡볶이|순대|분식/},
    {kind:'rice-bowl',pattern:/덮밥|가츠동|가라아게동/},{kind:'fried-rice',pattern:/볶음밥|필라프/},
    {kind:'cutlet',pattern:/돈까스|돈가스|커틀릿|커틀렛|카츠|튀김/},
    {kind:'noodles',pattern:/국수|우동|라면|라멘|파스타|막국수|쌀국수|짜장면|짬뽕/},
    {kind:'stew',pattern:/찌개|탕|전골|해장국|미역국|어묵국/},
    {kind:'meat',pattern:/제육볶음|불고기|닭갈비|두루치기|(?:닭고기|돼지고기|소고기|훈제오리).*볶음/},
  ];
  const matches=hints.filter(hint=>hint.pattern.test(name));
  if(/[&/]/.test(name)&&matches.length>1)return 'food';
  return matches[0]?.kind??(/비빔밥|오므라이스/.test(name)?'rice':'food');
}
const LABELS:Record<ArtworkKind,string>={'fried-rice':'볶음밥','rice-bowl':'덮밥',curry:'카레',snack:'떡볶이·분식',meat:'고기 볶음',food:'음식',noodles:'면 요리',rice:'밥 요리',stew:'국물 요리',cutlet:'커틀릿 요리',people:'인연',professor:'교수님과 배움',custom:'추억 노트'};
export function CollectionArtwork({kind='food',locked=false,children}:{kind?:ArtworkKind;locked?:boolean;children?:ReactNode}) {
  return <div className={`dex-art dex-art--${kind}${locked?' dex-art--locked':''}`} role="img" aria-label={`${LABELS[kind]} 심볼${locked?' · 미수집':''}`}>
    {children??<svg viewBox="0 0 240 180" aria-hidden="true" fill="none">
      <ellipse cx="120" cy="151" rx="66" ry="9" fill="currentColor" opacity=".09"/>
      <circle cx="52" cy="49" r="24" fill="white" opacity=".5"/><circle cx="189" cy="121" r="30" fill="white" opacity=".45"/>
      <path d="m183 30 3 9 9 3-9 3-3 9-3-9-9-3 9-3Z M44 111l2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" fill="currentColor" opacity=".35"/>
      <g className="dex-art-symbol" stroke="#385b49" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
        {kind==='people'?<><path d="M53 139c0-29 19-40 40-40s37 11 37 40" fill="#f1c59b"/><circle cx="93" cy="72" r="26" fill="#fff6dd"/><path d="M117 139c0-26 17-35 36-35s34 9 34 35" fill="#c3c3e9"/><circle cx="153" cy="82" r="23" fill="#fff6dd"/><path d="m116 47 6-9 7 9"/></>:kind==='custom'?<><path d="m69 45 86-9 18 111-86 9Z" fill="#d3c8eb"/><path d="m62 42 84-9 17 111-84 9Z" fill="#fff6dd"/><path d="m79 62 51-6M82 76l35-4M92 43l13 106"/><path d="m119 94 6 12 13 1-10 9 2 13-12-6-11 6 1-13-10-9 14-2Z" fill="#eab963"/></>:<>
          <FoodScene kind={kind}/>
        </>}
      </g>
    </svg>}
    {locked?<span className="dex-lock">미수집</span>:null}
  </div>;
}

function FoodScene({kind}:{kind:ArtworkKind}){
  if(kind==='professor')return <><path d="M48 151h144v10H48z" fill="#c5ad7c"/><path d="M59 117h38v34H59z" fill="#c5d4bc"/><path d="M64 124h26m-26 9h26" stroke="#8da77e"/><path d="M139 129h43v22h-43z" fill="#e3cd8e"/><path d="M144 136h29m-29 8h29" stroke="#af945e"/><circle cx="121" cy="66" r="26" fill="#e6bf94"/><path d="M96 64c-8-37 55-40 52 0l-12-14-28 5Z" fill="#556456"/><path d="M83 143c0-65 76-65 76 0" fill="#6d947e"/><path d="m107 98 14 19 14-19m-14 19v26" stroke="#f4edce"/><path d="m108 66 10 0m9 0h10m-19 0h9" stroke="#42594a" strokeWidth="3"/><path d="m103 136 17-6 18 6v18l-18-5-17 5Z" fill="#fff7dd"/><path d="M120 131v18" stroke="#cbbf9c"/><path d="m162 46 4-11 4 11 11 4-11 4-4 11-4-11-11-4Z" fill="#dcbf69"/></>;
  if(kind==='cutlet')return <><ellipse cx="120" cy="112" rx="85" ry="37" fill="#fff9e8"/><ellipse cx="120" cy="109" rx="75" ry="29" stroke="#d6c99f"/><path d="M58 95q0-26 56-24 46 0 48 27 0 28-58 29-47-2-46-32Z" fill="#d8a359"/><path d="m76 79 14 42m3-46 14 48m4-47 14 44m4-43 14 34" stroke="#99652d"/><path d="m160 96 14-16 8 14-14 17m-4 5 21-8-6 17-19-1" fill="#a8bc74"/><path d="m176 76 14 12-18 4Z" fill="#edcb67"/></>;
  if(kind==='fried-rice')return <><ellipse cx="120" cy="123" rx="79" ry="26" fill="#fff8e2"/><path d="M65 116c-2-69 112-70 112 0-33 22-77 22-112 0Z" fill="#dbb56b"/><path d="m86 100 6-4m23-13 5 4m24 13 6-4m-41 21 5-3" stroke="#fff4c8"/><circle cx="91" cy="112" r="5" fill="#d57d4d"/><circle cx="140" cy="84" r="4" fill="#d57d4d"/><path d="m109 98 9 4m27 8 7 3m-41-36 7-3" stroke="#7da467"/><path d="M69 88 48 59m7 2 17 12" stroke="#a68b63"/></>;
  if(kind==='rice-bowl')return <><path d="M50 98h140c-5 43-27 57-70 57S56 137 50 98Z" fill="#c8d8bd"/><ellipse cx="120" cy="97" rx="70" ry="24" fill="#fff9df"/><path d="m62 85 25-12 13 14-24 13m21-18 24-12 13 15-24 14m22-17 24-9 14 15-24 12" fill="#bd8453"/><ellipse cx="141" cy="94" rx="20" ry="13" fill="#fffdf0"/><circle cx="141" cy="94" r="8" fill="#e7b34c"/><path d="m81 106 13 5m16-12 7 7m49-13 7 6" stroke="#75a36b"/><path d="M105 134h30" opacity=".35"/></>;
  if(kind==='stew')return <><path d="M66 105H43v18h25m106-18h23v18h-25" fill="#a1b49c"/><path d="M65 96h110v42q-55 24-110 0Z" fill="#688c7e"/><ellipse cx="120" cy="96" rx="55" ry="23" fill="#c67751"/><path d="m84 88 22-4 3 16-22 4m40-18 19 6-5 16-20-5" fill="#f8e8be"/><path d="m104 109 15-6m30-14 9 6" stroke="#a1b97a"/><path d="M96 62c-14-13 11-20 0-33m26 34c-14-13 11-20 0-33m25 34c-14-13 11-20 0-33" stroke="#b4bc9e"/></>;
  if(kind==='noodles')return <><path d="M53 101h134c-9 38-33 50-67 50s-58-12-67-50Z" fill="#e8dfc3"/><ellipse cx="120" cy="100" rx="67" ry="21" fill="#e7c88f"/><path d="M69 94c20-27 69 28 98-6M70 103c27-28 61 27 99-7M78 111c27-25 54 21 81-5M132 85c0-20 25-17 23-34" stroke="#b78a43"/><path d="m148 52 38-24m-33 31 38-24" stroke="#906f4c"/><path d="m77 78 13-5 10 19-13 5Z" fill="#76905b"/><circle cx="118" cy="94" r="10" fill="#fff4d4"/><circle cx="118" cy="94" r="4" fill="#dfb54f"/></>;
  if(kind==='curry')return <><ellipse cx="120" cy="111" rx="84" ry="36" fill="#fff8df"/><path d="M58 108c-8-34 57-45 62-8l-8 24-42-1Z" fill="#fffdf0"/><path d="M121 89q62-13 65 23c-12 24-59 24-78 9Z" fill="#c79143"/><path d="m142 95 13 2-3 13-13-2m18 7 12 2-2 10-12-3" fill="#dfb96a"/><path d="m134 82 14-12 10 7-12 8 9 9-9 7-13-9" fill="#e6b877"/><path d="m76 101 7-4m7 15 7-5" stroke="#d0d2b8"/></>;
  if(kind==='snack')return <><path d="m49 87 141 2-10 52-120 2Z" fill="#d4d0bb"/><path d="m57 91 125 2-8 38-109 2Z" fill="#bb5944"/><path d="m74 103 23-4m7 16 24-5m8-9 26 5m-85 14 20 3m48-2 20 2" stroke="#f2ae86" strokeWidth="11"/><ellipse cx="111" cy="96" rx="15" ry="11" fill="#fff4d6"/><circle cx="112" cy="96" r="6" fill="#e6b24e"/><path d="m82 93 8 4m47 22 10-4m-20-25 6 6" stroke="#729b65"/></>;
  if(kind==='meat')return <><path d="m169 119 30 18 11-12-31-20" fill="#736f5c"/><ellipse cx="113" cy="108" rx="72" ry="36" fill="#5b6b59"/><ellipse cx="113" cy="105" rx="62" ry="28" fill="#9f744b"/><path d="m65 96 30-16 17 15-25 18m21-3 28-23 20 12-23 24m-51-2 19 7 17-13m24 10 17-5" fill="#c28d57"/><path d="m75 85 8 24m38-17 10 22m17-9 10 13" stroke="#855b3d"/><path d="m62 117 13 9m46-47 13 5m16 34 14 4" stroke="#8cac6b"/><ellipse cx="96" cy="112" rx="14" ry="7" stroke="#e5d9ad"/></>;
  return <><path d="M57 98c4 34 25 51 63 51s59-17 63-51" fill="#fffdf4"/><ellipse cx="120" cy="98" rx="63" ry="19" fill="#f1d69f"/><path d="M76 96c6-41 80-41 88 0" fill="#fff9e6"/>{kind==='rice'?<><ellipse cx="122" cy="85" rx="24" ry="15" fill="#fffdf4"/><circle cx="122" cy="85" r="10" fill="#edba55"/></>:<path d="m103 85 12 6 15-11" stroke="#92b782"/>}</>;
}
