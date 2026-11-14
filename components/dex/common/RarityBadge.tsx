import type { RarityTier } from '@/lib/dex/game/types';
export const RARITY_LABELS:Record<RarityTier,string>={UNKNOWN:'희귀도 조사 중',COMMON:'COMMON · 일반',UNCOMMON:'UNCOMMON · 고급',RARE:'RARE · 희귀',LEGENDARY:'LEGENDARY · 전설'};
/** Visual contract only. Food statistics determine tiers; never assign a tier to a person. */
export function RarityBadge({tier='UNKNOWN',hidden=false}:{tier?:RarityTier;hidden?:boolean}) {
  return <span className={`dex-rarity-badge${hidden?' is-hidden':` dex-rarity--${tier.toLowerCase()}`}`} title={hidden?'먹은 메뉴를 수집한 뒤 공개돼요.':tier==='UNKNOWN'?'관측 데이터와 등급 기준을 준비 중이에요.':'제공 빈도 등급이며 맛이나 개인의 애정을 뜻하지 않아요.'}>{hidden?'??? · 미발견':RARITY_LABELS[tier]}</span>;
}
