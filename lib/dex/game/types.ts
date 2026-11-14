/** Presentation contracts only. These do not change the storage schema or rank people. */
export type RarityTier='UNKNOWN'|'COMMON'|'UNCOMMON'|'RARE'|'LEGENDARY';
export interface GameNotice {id:string;kind:'title'|'achievement';title:string;description:string}
export interface Achievement {
  id:string;name:string;icon:string;condition:string;progress:number|null;target:number;
  status:'locked'|'achieved'|'preparing';
  /** Historical first-unlock time is not inferable after edits/import; do not invent it. */
  achievedAt:null;
}
