import type { HistoryStatistics, DishDayStatistic } from './history-statistics.ts';

export type MappingState = 'SAME' | 'SAME_FAMILY' | 'REVIEW';
export interface IdentityMapping {
  id: string; name: string; dishIds: string[]; decision: MappingState;
  confidence: 'high' | 'medium'; reason: string; followUp: string;
}
export interface DishFamily {
  dishFamilyId: string; name: string; description: string;
}
export interface FamilyMapping {
  dishId: string; dishFamilyId: string | null;
  state: 'MAPPED' | 'REVIEW' | 'UNKNOWN_FAMILY'; reason: string;
}
export interface AnalysisRules {
  version: string; status: 'analysis-only'; identities: IdentityMapping[];
  families: DishFamily[]; familyMappings: FamilyMapping[];
}
export interface AnalysisItem {
  id: string; name: string; dishIds: string[]; dates: string[];
  appearanceDays: number; comparableDays: number; frequency: number; rarity: 'UNKNOWN';
}
function aggregate(rows: readonly DishDayStatistic[], key: (row: DishDayStatistic) => {id:string;name:string}|null): AnalysisItem[] {
  const groups = new Map<string, AnalysisItem>();
  for (const row of rows) {
    const target = key(row); if (!target) continue;
    const group = groups.get(target.id) ?? {...target,dishIds:[],dates:[],appearanceDays:0,comparableDays:row.comparableDays,frequency:0,rarity:'UNKNOWN' as const};
    if (group.comparableDays !== row.comparableDays) throw Error('비교 분모가 다릅니다.');
    group.dishIds = [...new Set([...group.dishIds,row.dishId])].sort();
    group.dates = [...new Set([...group.dates,...row.appearanceDates])].sort();
    group.appearanceDays = group.dates.length;
    group.frequency = group.comparableDays ? group.appearanceDays/group.comparableDays : 0;
    groups.set(target.id,group);
  }
  return [...groups.values()].sort((a,b)=>b.appearanceDays-a.appearanceDays||a.id.localeCompare(b.id));
}
export function analyzeFamilies(stats: HistoryStatistics, rules: AnalysisRules) {
  if (rules.status !== 'analysis-only' || !rules.version) throw Error('분석 전용 규칙만 허용합니다.');
  const ids = new Set(stats.menus.map(row=>row.dishId));
  const same = new Map<string,IdentityMapping>(); const seen = new Set<string>();
  for (const mapping of rules.identities) {
    if (!mapping.id || !['SAME','SAME_FAMILY','REVIEW'].includes(mapping.decision) ||
      (mapping.decision==='SAME'&&mapping.confidence!=='high') ||
      new Set(mapping.dishIds).size!==mapping.dishIds.length || mapping.dishIds.length<2) throw Error('동일성 매핑이 잘못되었습니다.');
    for (const id of mapping.dishIds) {
      if (!ids.has(id)||seen.has(id)) throw Error('알 수 없거나 중복된 동일성 매핑입니다.');
      seen.add(id); if(mapping.decision==='SAME')same.set(id,mapping);
    }
  }
  const familyDefinitions = new Map(rules.families.map(f=>[f.dishFamilyId,f]));
  if(familyDefinitions.size!==rules.families.length)throw Error('계열 ID가 중복됩니다.');
  const families = new Map<string,FamilyMapping>();
  for(const mapping of rules.familyMappings){
    if(!['MAPPED','REVIEW','UNKNOWN_FAMILY'].includes(mapping.state)||!ids.has(mapping.dishId)||families.has(mapping.dishId)||
      (mapping.state==='MAPPED'&&(!mapping.dishFamilyId||!familyDefinitions.has(mapping.dishFamilyId)))||
      (mapping.state!=='MAPPED'&&mapping.dishFamilyId!==null))throw Error('계열 매핑이 잘못되었습니다.');
    families.set(mapping.dishId,mapping);
  }
  const baseline=aggregate(stats.menus,row=>({id:row.dishId,name:row.name}));
  const identity=aggregate(stats.menus,row=>{const mapping=same.get(row.dishId);return mapping?{id:mapping.id,name:mapping.name}:{id:row.dishId,name:row.name};});
  const family=aggregate(stats.menus,row=>{const mapping=families.get(row.dishId);if(mapping?.state!=='MAPPED'||!mapping.dishFamilyId)return null;const def=familyDefinitions.get(mapping.dishFamilyId)!;return {id:def.dishFamilyId,name:def.name};});
  const unclassified=stats.menus.filter(row=>families.get(row.dishId)?.state!=='MAPPED').map(row=>({dishId:row.dishId,name:row.name,state:families.get(row.dishId)?.state??'UNKNOWN_FAMILY'}));
  const summary=(rows:AnalysisItem[])=>({unique:rows.length,singletons:rows.filter(row=>row.appearanceDays===1).length,singletonRate:rows.length?rows.filter(row=>row.appearanceDays===1).length/rows.length:0,maximumDays:Math.max(0,...rows.map(row=>row.appearanceDays)),top10:rows.slice(0,10),bottom10:[...rows].sort((a,b)=>a.appearanceDays-b.appearanceDays||a.id.localeCompare(b.id)).slice(0,10)});
  return {analysisVersion:'family-analysis-v1',mappingVersion:rules.version,status:'analysis-only',metric:stats.metric,scope:stats.scope,validDates:stats.validDates,rarity:'UNKNOWN' as const,
    counts:{SAME:rules.identities.filter(m=>m.decision==='SAME').length,SAME_FAMILY:rules.identities.filter(m=>m.decision==='SAME_FAMILY').length,REVIEW:rules.identities.filter(m=>m.decision==='REVIEW').length},
    baseline:{...summary(baseline),items:baseline,unclassified:0,reviewItems:seen.size},identity:{...summary(identity),items:identity,unclassified:0,reviewItems:new Set(rules.identities.filter(m=>m.decision==='REVIEW').flatMap(m=>m.dishIds)).size},family:{...summary(family),items:family,unclassified:unclassified.length,reviewItems:unclassified.filter(m=>m.state==='REVIEW').length},unclassified};
}
