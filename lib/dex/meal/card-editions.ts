import type { DexDocument, Experience } from '../core/types.ts';

export const CARD_EDITION_POLICY = {
  version: 'card-edition-v1',
  weights: { NORMAL: 60, SPECIAL: 27, RARE: 10, GOLDEN: 3 },
} as const;
export type CardEdition = keyof typeof CARD_EDITION_POLICY.weights;
export interface CardInstance {
  id: string; edition: CardEdition; acquiredAt: string;
  policyVersion: string; origin: 'random' | 'legacy';
}
export const CARD_EDITIONS = Object.keys(CARD_EDITION_POLICY.weights) as CardEdition[];
export function pickCardEdition(roll: number): CardEdition {
  const weights = CARD_EDITION_POLICY.weights;
  if (Object.values(weights).reduce((a,b)=>a+b,0)!==100 || !Number.isFinite(roll) || roll<0 || roll>=1) throw Error('카드 확률 또는 추첨값이 잘못되었습니다.');
  let threshold=0;
  for(const edition of CARD_EDITIONS){threshold+=weights[edition];if(roll*100<threshold)return edition;}
  throw Error('카드 확률 합계를 확인해 주세요.');
}
export function makeCard(id:string,createdAt:string,roll:number):CardInstance {
  return {id:'card-v1:'+id,edition:pickCardEdition(roll),acquiredAt:createdAt,policyVersion:CARD_EDITION_POLICY.version,origin:'random'};
}
export function experienceCard(exp:Experience):CardInstance|null {
  if(exp.kind!=='meal')return null;
  return exp.card??{id:'card-v1:'+exp.id,edition:'NORMAL',acquiredAt:exp.createdAt,policyVersion:'legacy-normal-v1',origin:'legacy'};
}
/** Deterministic legacy normalization. No randomness, IDs or experience revisions change. */
export function normalizeLegacyCards(doc:DexDocument):boolean {
  let changed=false;
  for(const exp of doc.experiences)if(exp.kind==='meal'&&!exp.card){exp.card=experienceCard(exp)!;changed=true;}
  return changed;
}
