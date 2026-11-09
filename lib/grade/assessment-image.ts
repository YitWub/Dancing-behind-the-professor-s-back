import type { ManagedAssessment } from './management-types.ts';

export const IMAGE_MAX_BYTES=3*1024*1024;
export const IMAGE_TYPES=['image/png','image/jpeg','image/webp'] as const;
export interface ExtractedWeight {name:string;percent:number|null;parent:string|null;needsReview:boolean}
export interface ImageExtraction {status:'ok'|'no_table'|'ambiguous'|'unreadable';items:ExtractedWeight[]}
export interface WeightPreview {id:string;targetId:string|null;name:string;percent:string;needsReview:boolean;included:boolean;parent:string|null;source:'image'|'existing'}
export function assessmentName(name:string){const n=name.normalize('NFKC').toLowerCase().replace(/[\s_\-()]/g,'');return ({midterm:'중간고사',중간:'중간고사',final:'기말고사',기말:'기말고사',attendance:'출석',assignment:'과제',assignments:'과제',homework:'과제'} as Record<string,string>)[n]??n;}
export function parseImageExtraction(value:unknown):ImageExtraction {
  if(!value||typeof value!=='object')throw Error('인식 결과 형식이 올바르지 않습니다.');
  const x=value as ImageExtraction;
  if(!['ok','no_table','ambiguous','unreadable'].includes(x.status)||!Array.isArray(x.items)||x.items.length>40)throw Error('인식 결과 형식이 올바르지 않습니다.');
  if(x.items.some((r)=>!r||typeof r.name!=='string'||r.name.length>100||!(r.percent===null||typeof r.percent==='number'&&Number.isFinite(r.percent))||!(r.parent===null||typeof r.parent==='string'&&r.parent.length<=100)||typeof r.needsReview!=='boolean'))throw Error('평가항목과 비율을 다시 확인해 주세요.');
  return {status:x.status,items:x.items.map((r)=>({name:r.name,percent:r.percent,parent:r.parent,needsReview:r.needsReview}))};
}
export function buildWeightPreview(existing:ManagedAssessment[],extraction:ImageExtraction):WeightPreview[] {
  const used=new Set<string>();
  const rows=extraction.items.map((r,i)=>{const matches=existing.filter((a)=>assessmentName(a.name)===assessmentName(r.name));const target=matches.length===1&&!used.has(matches[0].id)&&!r.parent?matches[0]:null;if(target)used.add(target.id);return {id:`image-${i}`,targetId:target?.id??null,name:r.name,percent:r.percent===null?'':String(r.percent),needsReview:r.needsReview||r.percent===null||matches.length>1,included:r.parent===null,parent:r.parent,source:'image' as const};});
  return rows;
}
export function validateWeightPreview(rows:WeightPreview[]) {
  const included=rows.filter((r)=>r.included),errors:string[]=[];
  if(!included.length)errors.push('평가항목을 하나 이상 선택해 주세요.');
  const names=new Set<string>(),targets=new Set<string>();let total=0;
  for(const r of included){const n=assessmentName(r.name);const p=r.percent.trim()===''?NaN:Number(r.percent);if(!n||r.name.length>100)errors.push('항목명을 확인해 주세요.');if(names.has(n))errors.push(`${r.name}: 중복 평가항목입니다.`);names.add(n);if(!Number.isFinite(p)||p<0||p>100)errors.push(`${r.name}: 비율은 0~100% 숫자여야 합니다.`);else total+=p;if(r.needsReview)errors.push(`${r.name}: 확인 필요 표시를 검토해 주세요.`);if(r.targetId){if(targets.has(r.targetId))errors.push('같은 기존 항목을 두 번 연결할 수 없습니다.');targets.add(r.targetId);}if(r.parent&&included.some((x)=>assessmentName(x.name)===assessmentName(r.parent!)))errors.push(`${r.name}: 상위 항목과 세부 항목을 함께 합산할 수 없습니다.`);}
  if(Math.abs(total-100)>1e-6)errors.push(`합계 ${Number(total.toFixed(4))}% · 100%가 되도록 확인해 주세요.`);
  if(included.some((r)=>r.parent))errors.push('세부 항목의 내부 비율은 전체 반영비율로 사용할 수 없습니다. 상위 평가항목만 적용해 주세요.');
  if(included.some((r)=>/^(?:[ABCD][+0]|[PF]|\d{1,4}[./-]\d{1,2}(?:[./-]\d{1,2})?)$/i.test(r.name.trim())))errors.push('성적 등급이나 날짜로 보이는 항목이 있습니다. 평가항목 이름을 확인해 주세요.');
  return {errors,total};
}
/** The image defines the weights; retain unmatched recorded assessments at zero weight. */
export function applyWeightPreview(existing:ManagedAssessment[],rows:WeightPreview[],newId:()=>string,preserveAssessmentIds:readonly string[]=[]) {
  const checked=validateWeightPreview(rows);if(checked.errors.length)return {ok:false as const,errors:checked.errors};
  const selected=rows.filter((r)=>r.included);
  if(selected.some((r)=>r.targetId&&!existing.some((a)=>a.id===r.targetId)))return {ok:false as const,errors:['기존 평가항목이 변경되었습니다. 이미지를 다시 검토해 주세요.']};
  const value=selected.map((r):ManagedAssessment=>{const old=existing.find((a)=>a.id===r.targetId);return old?{...old,name:r.name.trim(),weight:Number(r.percent)/100}:{id:newId(),name:r.name.trim(),weight:Number(r.percent)/100,maxScore:100,mean:null,stdev:null,ceilingClustered:/출석|attendance/i.test(r.name),progress:{status:'scheduled'}};});
  const retained=existing.filter((a)=>!selected.some((r)=>r.targetId===a.id)&&(a.progress?.status!=='scheduled'||!!a.assignmentGroup?.tasks.length||preserveAssessmentIds.includes(a.id)));
  value.push(...retained.map((a)=>({...a,weight:0})));
  return {ok:true as const,value};
}
