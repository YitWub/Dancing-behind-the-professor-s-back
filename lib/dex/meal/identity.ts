import type { Dish, DishAlias } from './types.ts';
import { MENU_ALIASES } from './aliases.ts';
import type { MenuAliasRule } from './aliases.ts';

export const IDENTITY_VERSION = 1;
const RULE_EPOCH = '2026-11-13T00:00:00.000Z'; // 식단 수집 시각이 아닌 v1 식별 규칙의 버전 시각
function displayName(raw: string) {
  let name=raw.normalize('NFKC').replace(/&amp;|&#38;/gi,'&').replace(/&nbsp;/gi,' ').replace(/\s+/g,' ').trim();
  name=name.replace(/^\[천원의\s*아침밥\]\s*/,'');
  // 한국어 이름 뒤 명시적인 영문 번역 괄호만 제외. (매운맛) 등 한글 변형은 보존한다.
  if(/[가-힣]/.test(name))name=name.replace(/\s*\([A-Za-z][A-Za-z0-9 ,.&'’/\-]*\)\s*$/,'').trim();
  return name;
}
export function menuKeyV1(raw: string) { return displayName(raw).toLowerCase().replace(/\s+/g,''); }
export async function stableHash(value: string): Promise<string> {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export type DishResolution = {ok:true;dish:Dish;alias:DishAlias} | {ok:false;reason:'missing-name'|'ambiguous';message:string};

export async function resolveDish(raw: string|null, source: string, rules:readonly MenuAliasRule[]=MENU_ALIASES):Promise<DishResolution> {
  if(!raw?.trim())return {ok:false,reason:'missing-name',message:'대표 메뉴명이 없어 수집을 보류합니다. 반찬을 대표 메뉴로 추정하지 않습니다.'};
  const name=displayName(raw), key=menuKeyV1(raw);
  if(!key||name.length>200||/^(메뉴미정|추후공지|미정|휴무|운영안함|메뉴없음|오늘의메뉴|메뉴|식단|간편식|선택메뉴|등록예정)[.!]*$/.test(key)||/[<>]/.test(name))
    return {ok:false,reason:'ambiguous',message:'대표 음식 또는 명확한 세트 이름을 확인해 주세요.'};
  const matches=rules.filter(rule=>menuKeyV1(rule.rawName)===key);
  const targets=new Set(matches.map(rule=>menuKeyV1(rule.identityKey)));
  if(targets.size>1)return {ok:false,reason:'ambiguous',message:'별칭이 여러 메뉴를 가리켜 확인이 필요합니다.'};
  const identityKey=matches[0]?menuKeyV1(matches[0].identityKey):key;
  if(!identityKey)return {ok:false,reason:'ambiguous',message:'메뉴 식별 규칙 확인이 필요합니다.'};
  const dishId='dish-v1-'+await stableHash(identityKey);
  const base={revision:1,createdAt:RULE_EPOCH,updatedAt:RULE_EPOCH};
  return {ok:true,
    dish:{...base,id:dishId,canonicalName:matches[0]?.canonicalName??name,variant:null,normalizationVersion:1,status:'active',redirectToDishId:null},
    alias:{...base,id:'alias-v1-'+await stableHash(source+'|'+key),source,rawName:raw,normalizedKey:key,cafeteria:null,dishId,normalizationVersion:1,decision:matches.length?'curated':'exact-rule'},
  };
}
