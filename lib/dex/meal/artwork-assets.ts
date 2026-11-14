/** Visual assets only. Does not participate in dish identity or edition selection. */
export const FOOD_ART_ASSETS={cutlet:'/dex/food/cutlet.webp','fried-rice':'/dex/food/fried-rice.webp','rice-bowl':'/dex/food/rice-bowl.webp',stew:'/dex/food/stew.webp',noodles:'/dex/food/noodles.webp',curry:'/dex/food/curry.webp',snack:'/dex/food/bunsik.webp',meat:'/dex/food/stir-fry.webp'} as const;
export const DEFAULT_FOOD_ART='/dex/food/default-meal.webp';
export type ArtworkMode='svg'|'image'|'soft';
export function foodArtSource(kind:string):string|null{return Object.hasOwn(FOOD_ART_ASSETS,kind)?FOOD_ART_ASSETS[kind as keyof typeof FOOD_ART_ASSETS] :kind==='food'||kind==='rice'?DEFAULT_FOOD_ART:null;}
