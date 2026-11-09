import type { Course, GradeLetter, GradePrediction } from '../types.ts';
import type { ManagedCourse } from './management-types.ts';
import { predict, blurProb } from './predict.ts';

export type GradingPolicy=NonNullable<ManagedCourse['gradingPolicy']>;
export const POLICY_VERSION='erica-2026-11-07' as const;
export const POLICY_URL='https://site.hanyang.ac.kr/web/ehaksa/-grade-process';
export const GRADE_CUTOFFS={'A+':95,A0:90,'B+':85,B0:80,'C+':75,C0:70,'D+':65,D0:60} as const;
export const POLICY_LABELS={unknown:'평가 방식 확인 필요',relative1:'상대평가 1',relative2:'상대평가 2',relative3:'상대평가 3',absolute:'절대평가',pass_fail:'P/F 평가'};
export const RELATIVE_CAPS={relative1:{a:.3,ab:.7},relative2:{a:.4,ab:.8},relative3:{a:.5,ab:.9}};

export function officialPolicy(kind:GradingPolicy['kind']):GradingPolicy{return {kind,source:kind==='unknown'?'unconfirmed':'official',presetVersion:POLICY_VERSION};}
export function resolvePolicy(course:ManagedCourse):GradingPolicy {
  if(course.gradingPolicy)return course.gradingPolicy;
  if(course.isAbsolute)return {kind:'absolute',source:course.absoluteTargets&&Object.keys(course.absoluteTargets).length?'custom':'unconfirmed',presetVersion:POLICY_VERSION,...(course.absoluteTargets?{absoluteCutoffs:{...course.absoluteTargets}}:{})};
  return officialPolicy('unknown');
}
export function policyCuts(course:ManagedCourse){const p=resolvePolicy(course);return p.kind==='absolute'?p.source==='official'?GRADE_CUTOFFS:p.absoluteCutoffs??{}:{};}
export function policyCaps(course:ManagedCourse){const p=resolvePolicy(course);return p.source!=='unconfirmed'&&p.kind.startsWith('relative')?p.source==='custom'?p.relativeCaps:RELATIVE_CAPS[p.kind as keyof typeof RELATIVE_CAPS]:undefined;}
export function targetCut(course:ManagedCourse,target:string):number|undefined {
  const p=resolvePolicy(course);if(target==='P'&&p.kind==='pass_fail')return p.passScore;
  return p.kind==='absolute'?(policyCuts(course) as Record<string,number>)[target]:undefined;
}
export function gradeForScore(course:ManagedCourse,score:number):string|null {
  const p=resolvePolicy(course);
  if(p.kind==='pass_fail')return p.passScore===undefined?null:score>=p.passScore?'P':'F';
  if(p.kind!=='absolute')return null;
  const cuts=policyCuts(course);
  let missingHigher=false;
  for(const grade of Object.keys(GRADE_CUTOFFS)){const cut=(cuts as Record<string,number>)[grade];if(cut===undefined)missingHigher=true;else if(score>=cut)return missingHigher?`${grade} 이상`:grade;}
  return missingHigher?null:'F';
}

export function validateGradingPolicy(value:unknown):string[] {
  if(!value||typeof value!=='object'||Array.isArray(value))return ['평가 방식 형식을 확인해 주세요.'];
  const p=value as GradingPolicy;const errors:string[]=[];
  if(!Object.keys(POLICY_LABELS).includes(p.kind)||!['official','custom','unconfirmed'].includes(p.source)||p.presetVersion!==POLICY_VERSION)return ['지원하지 않는 평가 방식 또는 프리셋 버전입니다.'];
  if(p.source==='official'&&(p.absoluteCutoffs!==undefined||p.relativeCaps!==undefined||p.passScore!==undefined))errors.push('직접 수정한 기준은 교수자 별도 기준으로 저장해 주세요.');
  if(p.relativeCaps!==undefined){const c=p.relativeCaps;if(!c||![c.a,c.ab].every((n)=>Number.isFinite(n)&&n>=0&&n<=1)||c.a>c.ab)errors.push('상대평가 상한은 0~100% 이내이며 A+B가 A보다 작을 수 없습니다.');}
  if(p.source==='custom'&&p.kind.startsWith('relative')&&!p.relativeCaps)errors.push('교수자 상대평가 상한을 입력해 주세요.');
  if(p.absoluteCutoffs!==undefined){const c=p.absoluteCutoffs;if(!c||typeof c!=='object'||Array.isArray(c))errors.push('등급 기준 형식을 확인해 주세요.');else{let previous=Infinity;for(const [k,n] of Object.entries(c))if(!(k in GRADE_CUTOFFS)||!Number.isFinite(n)||n<0||n>100)errors.push('등급 기준은 0~100점이어야 합니다.');for(const k of Object.keys(GRADE_CUTOFFS)){const n=(c as Record<string,number>)[k];if(n!==undefined){if(n>previous)errors.push('높은 등급의 기준은 낮은 등급보다 작을 수 없습니다.');previous=n;}}}}
  if(p.passScore!==undefined&&(!Number.isFinite(p.passScore)||p.passScore<0||p.passScore>100))errors.push('P/F 합격 기준은 0~100점이어야 합니다.');
  return errors;
}

export interface FamilyProbability { family:'A'|'B'; label:string; probability:number }
/** Do not turn coarse conditional model output into a 0%/100% guarantee. */
export function formatFamilyProbability(p:number):string {
  if(!Number.isFinite(p)||p<0||p>1)return '계산 보류';
  return p<=.025?'5% 미만':p>=.975?'95% 초과':`약 ${Math.round(blurProb(p)*100)}%`;
}
/** Official caps are not grade probabilities or +/0 splits. Use only family cuts. */
export function predictWithPolicy(engine:Course,course:ManagedCourse):{prediction:GradePrediction|null;families:FamilyProbability[];note:string} {
  const p=resolvePolicy(course),caps=policyCaps(course);
  if(!caps)return {prediction:null,families:[],note:p.kind==='unknown'?'평가 방식이 미확인입니다. 점수 범위와 목표 총점 플랜은 계속 사용할 수 있습니다.':p.kind==='pass_fail'?'P/F 과목은 상대 등급 확률을 계산하지 않습니다.':'절대평가는 최종점수 기준표로 분석하며 상대 등급 확률을 계산하지 않습니다.'};
  const quota:Record<GradeLetter,number>={'A+':caps.a,A0:caps.a,'B+':caps.ab,B0:caps.ab,'C+':1,C0:1,'D+':1,D0:1,F:1};
  const prediction=predict({...engine,isAbsolute:false},{quota});
  prediction.warnings=prediction.warnings.map((w)=>w.code==='BORDERLINE'?{...w,message:'A/B 계열 경계에 가까워 작은 점수 변화에도 예측이 흔들릴 수 있습니다.'}:w);
  const d=prediction.distribution;
  return {prediction:{...prediction,distribution:null},families:d?[{family:'A',label:'A계열 이상',probability:d.find((x)=>x.grade==='A0')!.atLeastProb},{family:'B',label:'B계열 이상',probability:d.find((x)=>x.grade==='B0')!.atLeastProb}]:[],note:d?'통계와 배분 상한을 모두 사용한다는 조건의 비교 모델입니다. 실제 부여율·개인 확률과 다르며 A+/A0 또는 B+/B0로 나누지 않습니다.':'통계가 부족하거나 기존 모델의 소규모 강좌 조건에 해당합니다. 가짜 확률 대신 점수 분석을 제공합니다.'};
}
