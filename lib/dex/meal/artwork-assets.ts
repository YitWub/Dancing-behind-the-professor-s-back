import { splitMenuLabel } from './presentation.ts';
/** Visual assets only. Does not participate in dish identity or edition selection. */
export const FOOD_ART_ASSETS={cutlet:'/dex/food/cutlet.webp','fried-rice':'/dex/food/fried-rice.webp','rice-bowl':'/dex/food/rice-bowl.webp',stew:'/dex/food/stew.webp',noodles:'/dex/food/noodles.webp',curry:'/dex/food/curry.webp',snack:'/dex/food/bunsik.webp',meat:'/dex/food/stir-fry.webp',
  bibimbap:'/dex/food/bibimbap.webp',dumplings:'/dex/food/dumplings.webp',gimbap:'/dex/food/gimbap.webp','cold-noodles':'/dex/food/cold-noodles.webp',pasta:'/dex/food/pasta.webp',udon:'/dex/food/udon.webp','hamburg-steak':'/dex/food/hamburg-steak.webp',omurice:'/dex/food/omurice.webp','grilled-fish':'/dex/food/grilled-fish.webp','rice-porridge':'/dex/food/rice-porridge.webp',salad:'/dex/food/salad.webp',sandwich:'/dex/food/sandwich.webp',
} as const;
export const DEFAULT_FOOD_ART='/dex/food/default.webp';
export type ArtworkMode='svg'|'image'|'soft';
const SPECIFIC_ART:readonly [keyof typeof FOOD_ART_ASSETS,RegExp][]=[
  ['bibimbap',/비빔밥(?:정식)?$/],['dumplings',/만두(?:정식)?$/],['gimbap',/김밥(?:정식)?$/],
  ['cold-noodles',/냉면(?:정식)?$/],['pasta',/(?:파스타|스파게티)(?:정식)?$/],['udon',/우동(?:정식)?$/],
  ['hamburg-steak',/(?:함박|함박스테이크|햄버그스테이크|함박스텍)(?:정식)?$/],['omurice',/오므라이스(?:정식)?$/],
  ['grilled-fish',/(?:고등어|삼치|꽁치|갈치|조기|가자미|연어|임연수|민어|생선)(?:소금|간장|양념|데리야끼|레몬)?구이(?:정식)?$/],
  ['rice-porridge',/^(?:닭|참치|야채|채소|전복|소고기|쇠고기|김치|단호박|해물|새우|녹두|팥|흑임자|버섯|영양|치즈|매콤|게살|들깨|흰|아침|누룽지)*죽$/],
  ['salad',/샐러드$/],['sandwich',/(?:샌드위치|샌드)(?:세트)?$/],
];
/** Refine only clearly named main dishes, retaining the old kind for SVG fallback. */
export function foodArtSource(kind:string,name?:string):string|null{
  if(kind==='people'||kind==='custom')return null;
  if(name){
    const title=splitMenuLabel(name).title.replace(/^\[[^\]]+\]\s*/,'').replace(/\s+/g,'').replace(/[&+]계란후라이$/,'');
    if(/[&/+]|모둠|모듬|와함께|과함께|(?:돈가스|돈까스|튀김|우동|파스타|냉면|김밥|만두|덮밥|볶음밥|스테이크)(?:와|과)/.test(title))return DEFAULT_FOOD_ART;
    const matches=SPECIFIC_ART.filter(([key,pattern])=>pattern.test(title)&&!(key==='udon'&&/볶음|야끼|야키|샐러드/.test(title)));
    if(matches.length===1)return FOOD_ART_ASSETS[matches[0][0]];
    if(matches.length>1)return DEFAULT_FOOD_ART;
  }
  return Object.hasOwn(FOOD_ART_ASSETS,kind)?FOOD_ART_ASSETS[kind as keyof typeof FOOD_ART_ASSETS]:kind==='food'||kind==='rice'?DEFAULT_FOOD_ART:null;
}
